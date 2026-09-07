import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/app";
import { prisma } from "../../src/app/lib/prisma";
import {
	BKASH_SUCCESS_CODE,
	resetPaymentGateway,
	setPaymentGateway,
} from "../../src/app/module/payment/payment.gateway";
import { createVerifiedUser } from "../helpers/authUser";
import { deleteUsersByEmail } from "../helpers/db";
import { resetAuthRateLimit } from "../helpers/rateLimiter";

beforeEach(resetAuthRateLimit);

const runId = Date.now();
const createdEmails: string[] = [];
const GATEWAY_SECRET = "bkash-app-secret-should-never-leak";

// Deterministic gateway (real bKash sandbox needs live creds + a human paying).
// `executeMode` lets a test decide whether the gateway confirms success.
let executeMode: "success" | "fail" = "success";
let createCounter = 0;

setPaymentGateway({
	create: async () => ({
		providerPaymentId: `bkash-pay-${runId}-${createCounter++}`,
		redirectUrl: "https://bkash.sandbox.test/checkout/session",
		raw: { paymentID: "session", secret: GATEWAY_SECRET },
	}),
	execute: async (providerPaymentId) =>
		executeMode === "success"
			? {
					statusCode: BKASH_SUCCESS_CODE,
					transactionId: `TRX-${providerPaymentId}`,
					transactionStatus: "Completed",
					raw: {
						statusCode: BKASH_SUCCESS_CODE,
						trxID: `TRX-${providerPaymentId}`,
						secret: GATEWAY_SECRET,
					},
				}
			: {
					statusCode: "2001",
					transactionStatus: "Failed",
					raw: { statusCode: "2001", secret: GATEWAY_SECRET },
				},
});

const freshEmail = (label: string) => {
	const email = `e2e-pay-${runId}-${label}-${createdEmails.length}@example.com`;
	createdEmails.push(email);
	return email;
};
const makeUser = async (label: string) => {
	const email = freshEmail(label);
	const agent = await createVerifiedUser(email);
	const user = await prisma.user.findUniqueOrThrow({ where: { email } });
	return { agent, userId: user.id, email };
};
const isPremium = async (userId: string) =>
	(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).isPremium;

afterAll(async () => {
	resetPaymentGateway();
	// payments cascade-delete with their user (FK onDelete: Cascade).
	await deleteUsersByEmail(createdEmails);
});

describe("premium-payment: create", () => {
	it("rejects an unauthenticated create", async () => {
		const res = await request(app).post("/api/v1/payments/create").send();
		expect(res.status).toBe(401);
	});

	it("creates a PENDING payment and returns the gateway URL (no premium yet)", async () => {
		const { agent, userId } = await makeUser("create");
		const res = await agent.post("/api/v1/payments/create").send();

		expect(res.status).toBe(201);
		expect(res.body.data.paymentId).toEqual(expect.any(String));
		expect(res.body.data.redirectUrl).toContain("bkash");

		const payment = await prisma.payment.findUniqueOrThrow({
			where: { id: res.body.data.paymentId },
		});
		expect(payment.status).toBe("PENDING");
		expect(payment.providerPaymentId).toEqual(expect.any(String));
		expect(await isPremium(userId)).toBe(false);
	});
});

describe("premium-payment: verify + activate", () => {
	it("activates premium only after gateway-confirmed success", async () => {
		executeMode = "success";
		const { agent, userId } = await makeUser("verify-ok");
		const create = await agent.post("/api/v1/payments/create").send();
		const paymentId = create.body.data.paymentId;

		const res = await agent.post("/api/v1/payments/verify").send({ paymentId });
		expect(res.status).toBe(200);
		expect(res.body.data.status).toBe("SUCCESS");
		expect(res.body.data.providerTransactionId).toEqual(expect.any(String));

		const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
		expect(user.isPremium).toBe(true);
		expect(user.premiumSince).not.toBeNull();
	});

	it("does NOT activate premium when the gateway does not confirm success", async () => {
		executeMode = "fail";
		const { agent, userId } = await makeUser("verify-fail");
		const create = await agent.post("/api/v1/payments/create").send();

		const res = await agent
			.post("/api/v1/payments/verify")
			.send({ paymentId: create.body.data.paymentId });
		expect(res.status).toBe(200);
		expect(res.body.data.status).toBe("FAILED");
		expect(await isPremium(userId)).toBe(false);
	});

	it("is idempotent — replaying verify does not grant premium twice or duplicate the row", async () => {
		executeMode = "success";
		const { agent, userId } = await makeUser("idempotent");
		const create = await agent.post("/api/v1/payments/create").send();
		const paymentId = create.body.data.paymentId;

		await agent.post("/api/v1/payments/verify").send({ paymentId });
		const first = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
		const firstPremiumSince = first.premiumSince;

		// replay
		await agent.post("/api/v1/payments/verify").send({ paymentId });
		await agent.post("/api/v1/payments/verify").send({ paymentId });

		const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
		expect(after.isPremium).toBe(true);
		expect(after.premiumSince?.getTime()).toBe(firstPremiumSince?.getTime()); // unchanged
		const count = await prisma.payment.count({ where: { userId } });
		expect(count).toBe(1); // no duplicate payment row
	});
});

describe("premium-payment: callback (server-verified redirect)", () => {
	it("confirms via the gateway and redirects to success, activating premium", async () => {
		executeMode = "success";
		const { agent, userId } = await makeUser("cb-success");
		const create = await agent.post("/api/v1/payments/create").send();
		const payment = await prisma.payment.findUniqueOrThrow({
			where: { id: create.body.data.paymentId },
		});

		const res = await request(app).get(
			`/api/v1/payments/callback?paymentID=${payment.providerPaymentId}&status=success`,
		);
		expect(res.status).toBe(302);
		expect(res.headers.location).toContain("/payment/success");
		expect(await isPremium(userId)).toBe(true);
	});

	it("redirects to failure and grants nothing on a non-success callback status", async () => {
		const { agent, userId } = await makeUser("cb-cancel");
		const create = await agent.post("/api/v1/payments/create").send();
		const payment = await prisma.payment.findUniqueOrThrow({
			where: { id: create.body.data.paymentId },
		});

		const res = await request(app).get(
			`/api/v1/payments/callback?paymentID=${payment.providerPaymentId}&status=cancel`,
		);
		expect(res.status).toBe(302);
		expect(res.headers.location).toContain("/payment/failure");
		expect(await isPremium(userId)).toBe(false);
		const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
		expect(after.status).toBe("CANCELLED");
	});
});

describe("premium-payment: security & owner-scoping", () => {
	it("a client cannot self-report success — premium comes only from server verification", async () => {
		executeMode = "fail"; // gateway says NOT successful
		const { agent, userId } = await makeUser("spoof");
		const create = await agent.post("/api/v1/payments/create").send();

		// client sends a body that "claims" success — it's ignored; gateway rules.
		const res = await agent
			.post("/api/v1/payments/verify")
			.send({ paymentId: create.body.data.paymentId, status: "SUCCESS", isPremium: true });
		expect(res.status).toBe(200);
		expect(res.body.data.status).toBe("FAILED");
		expect(await isPremium(userId)).toBe(false);
	});

	it("owner-scopes reads and verification (404 for another user's payment) and leaks no gateway secret", async () => {
		executeMode = "success";
		const owner = await makeUser("owner");
		const other = await makeUser("intruder");
		const create = await owner.agent.post("/api/v1/payments/create").send();
		const paymentId = create.body.data.paymentId;

		const stranger = await other.agent.get(`/api/v1/payments/${paymentId}`);
		expect(stranger.status).toBe(404);
		const strangerVerify = await other.agent.post("/api/v1/payments/verify").send({ paymentId });
		expect(strangerVerify.status).toBe(404);

		const owned = await owner.agent.get(`/api/v1/payments/${paymentId}`);
		expect(owned.status).toBe(200);
		expect(JSON.stringify(owned.body)).not.toContain(GATEWAY_SECRET);
	});
});
