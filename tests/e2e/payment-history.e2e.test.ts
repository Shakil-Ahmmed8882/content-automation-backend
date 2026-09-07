import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/app";
import { prisma } from "../../src/app/lib/prisma";
import { PaymentStatus } from "../../src/generated/prisma/enums";
import { createVerifiedUser } from "../helpers/authUser";
import { deleteUsersByEmail } from "../helpers/db";
import { resetAuthRateLimit } from "../helpers/rateLimiter";

beforeEach(resetAuthRateLimit);

const runId = Date.now();
const createdEmails: string[] = [];
const GATEWAY_SECRET = "history-gateway-secret-should-never-leak";

const freshEmail = (label: string) => {
	const email = `e2e-payhist-${runId}-${label}-${createdEmails.length}@example.com`;
	createdEmails.push(email);
	return email;
};
const makeUser = async (label: string) => {
	const email = freshEmail(label);
	const agent = await createVerifiedUser(email);
	const user = await prisma.user.findUniqueOrThrow({ where: { email } });
	return { agent, userId: user.id };
};

let invoiceSeq = 0;
/** Seed a payment row directly (history is a read layer; we don't need the full
 * create/verify flow to exercise it). `createdAt` is explicit for stable order. */
const seedPayment = (userId: string, status: PaymentStatus, createdAt: Date) =>
	prisma.payment.create({
		data: {
			userId,
			amount: "500.00",
			currency: "BDT",
			status,
			merchantInvoiceNumber: `INV-hist-${runId}-${invoiceSeq++}`,
			gatewayResponse: { secret: GATEWAY_SECRET },
		},
	});

afterAll(async () => {
	await deleteUsersByEmail(createdEmails);
});

describe("payment-history: list", () => {
	it("rejects an unauthenticated request", async () => {
		const res = await request(app).get("/api/v1/payments");
		expect(res.status).toBe(401);
	});

	it("lists the caller's payments newest-first (incl. failed/cancelled) with meta, no secrets", async () => {
		const { agent, userId } = await makeUser("list");
		const base = Date.now();
		await seedPayment(userId, PaymentStatus.SUCCESS, new Date(base));
		await seedPayment(userId, PaymentStatus.FAILED, new Date(base + 1000));
		const newest = await seedPayment(userId, PaymentStatus.CANCELLED, new Date(base + 2000));

		const res = await agent.get("/api/v1/payments?page=1&limit=10");
		expect(res.status).toBe(200);
		expect(res.body.meta).toMatchObject({ page: 1, limit: 10, total: 3 });
		expect(res.body.data).toHaveLength(3);
		// newest first
		expect(res.body.data[0].id).toBe(newest.id);
		expect(res.body.data[0].status).toBe("CANCELLED");
		// failures/cancellations are included
		const statuses = res.body.data.map((p: { status: string }) => p.status);
		expect(statuses).toEqual(expect.arrayContaining(["SUCCESS", "FAILED", "CANCELLED"]));
		// no raw gateway payload leaks
		expect(JSON.stringify(res.body)).not.toContain(GATEWAY_SECRET);
		for (const row of res.body.data) {
			expect(row).not.toHaveProperty("gatewayResponse");
		}
	});

	it("filters by status", async () => {
		const { agent, userId } = await makeUser("filter");
		const base = Date.now();
		await seedPayment(userId, PaymentStatus.SUCCESS, new Date(base));
		await seedPayment(userId, PaymentStatus.FAILED, new Date(base + 1000));

		const res = await agent.get("/api/v1/payments?status=SUCCESS");
		expect(res.status).toBe(200);
		expect(res.body.data.length).toBeGreaterThanOrEqual(1);
		for (const row of res.body.data) {
			expect(row.status).toBe("SUCCESS");
		}
	});

	it("never returns another user's payments", async () => {
		const owner = await makeUser("owner");
		const other = await makeUser("other");
		await seedPayment(owner.userId, PaymentStatus.SUCCESS, new Date());

		const res = await other.agent.get("/api/v1/payments");
		expect(res.status).toBe(200);
		expect(res.body.data).toHaveLength(0);
		expect(res.body.meta.total).toBe(0);
	});
});
