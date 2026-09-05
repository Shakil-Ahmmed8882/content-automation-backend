import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/app";
import { AuthProvider, UserStatus } from "../../src/generated/prisma/enums";
import { prisma } from "../../src/app/lib/prisma";
import { AuthService } from "../../src/app/module/auth/auth.service";
import { deleteUsersByEmail } from "../helpers/db";
import { resetAuthRateLimit } from "../helpers/rateLimiter";

// Only the dedicated "rate limiting" describe below is meant to exhaust the
// shared authLimiter bucket — see tests/helpers/rateLimiter.ts.
beforeEach(resetAuthRateLimit);

// One run id so repeated test runs never collide with leftover data (and so
// cleanup only ever touches the users this file created — see helpers/db.ts).
const runId = Date.now();
const PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "new-horse-battery-staple";

const primaryEmail = `e2e-${runId}-primary@example.com`;
const blockedEmail = `e2e-${runId}-blocked@example.com`;
const seamEmail = `e2e-${runId}-seam@example.com`;
const createdEmails = [primaryEmail, blockedEmail, seamEmail];
const SIX_DIGIT_OTP = /^\d{6}$/;

/** supertest/superagent types `set-cookie` as a single string; at runtime
 * it's always the array node's http gives back for a repeated header. */
const setCookies = (res: request.Response): string[] =>
	(res.headers["set-cookie"] as unknown as string[]) ?? [];

afterAll(async () => {
	await deleteUsersByEmail(createdEmails);
});

/** Registers + verifies a fresh user through the real HTTP flow and returns
 * the cookie-jar agent already logged in as that user. */
const registerAndVerify = async (email: string) => {
	const agent = request.agent(app);

	const registerRes = await agent
		.post("/api/v1/auth/register")
		.send({ name: "E2E User", email, password: PASSWORD });
	const otp = registerRes.body.data.otp;

	const verifyRes = await agent.post("/api/v1/auth/verify-email").send({ email, otp });

	return { agent, verifyRes };
};

describe("auth: registration", () => {
	it("starts a pending registration and creates no user row yet", async () => {
		const res = await request(app)
			.post("/api/v1/auth/register")
			.send({ name: "E2E User", email: primaryEmail, password: PASSWORD });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.email).toBe(primaryEmail);
		// Dev/test-only escape hatch (EXPOSE_OTP_IN_RESPONSE) — lets this suite
		// read the OTP without an inbox.
		expect(res.body.data.otp).toMatch(SIX_DIGIT_OTP);

		const user = await prisma.user.findUnique({ where: { email: primaryEmail } });
		expect(user).toBeNull();
	});

	it("rejects a weak password and sends no code", async () => {
		const res = await request(app)
			.post("/api/v1/auth/register")
			.send({ name: "E2E User", email: `${primaryEmail}.weak`, password: "short" });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("rejects an incorrect verification code and creates no user", async () => {
		const res = await request(app)
			.post("/api/v1/auth/verify-email")
			.send({ email: primaryEmail, otp: "000000" });

		expect(res.status).toBe(400);
		const user = await prisma.user.findUnique({ where: { email: primaryEmail } });
		expect(user).toBeNull();
	});

	it("verifies with the correct code, creates the account, and starts a session", async () => {
		const otpRes = await request(app)
			.post("/api/v1/auth/register")
			.send({ name: "E2E User", email: primaryEmail, password: PASSWORD });
		// register() rejects if a user already exists, but we haven't verified
		// yet in this test's own flow — re-registering just re-issues an OTP.
		const otp = otpRes.body.data.otp;

		const res = await request(app)
			.post("/api/v1/auth/verify-email")
			.send({ email: primaryEmail, otp });

		expect(res.status).toBe(201);
		expect(res.body.data.email).toBe(primaryEmail);
		expect(res.body.data.passwordHash).toBeUndefined();
		expect(res.body.data.accessToken).toBeUndefined();
		expect(setCookies(res).some((c) => c.startsWith("accessToken="))).toBe(true);

		const user = await prisma.user.findUnique({ where: { email: primaryEmail } });
		expect(user).not.toBeNull();
		expect(user?.emailVerified).toBe(true);
	});

	it("refuses registration for an already-verified email", async () => {
		const res = await request(app)
			.post("/api/v1/auth/register")
			.send({ name: "E2E User", email: primaryEmail, password: PASSWORD });

		expect(res.status).toBe(409);
	});
});

describe("auth: login & session", () => {
	it("logs in with the correct password", async () => {
		const res = await request(app)
			.post("/api/v1/auth/login")
			.send({ email: primaryEmail, password: PASSWORD });

		expect(res.status).toBe(200);
		expect(res.body.data.passwordHash).toBeUndefined();
		expect(setCookies(res).some((c) => c.startsWith("accessToken="))).toBe(true);
	});

	it("rejects a wrong password and an unknown email with the same generic message", async () => {
		const wrongPassword = await request(app)
			.post("/api/v1/auth/login")
			.send({ email: primaryEmail, password: "not-the-password" });
		const unknownEmail = await request(app)
			.post("/api/v1/auth/login")
			.send({ email: `nobody-${runId}@example.com`, password: PASSWORD });

		expect(wrongPassword.status).toBe(401);
		expect(unknownEmail.status).toBe(401);
		expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
	});

	it("rejects GET /me without a session", async () => {
		const res = await request(app).get("/api/v1/auth/me");
		expect(res.status).toBe(401);
	});

	it("returns the caller's profile with no secrets for a valid session", async () => {
		const agent = request.agent(app);
		await agent.post("/api/v1/auth/login").send({ email: primaryEmail, password: PASSWORD });

		const res = await agent.get("/api/v1/auth/me");

		expect(res.status).toBe(200);
		expect(res.body.data.email).toBe(primaryEmail);
		expect(res.body.data.passwordHash).toBeUndefined();
		expect(res.body.data.accessToken).toBeUndefined();
		expect(res.body.data.refreshToken).toBeUndefined();
	});

	it("rotates tokens on refresh and rejects an invalid refresh token", async () => {
		const agent = request.agent(app);
		await agent.post("/api/v1/auth/login").send({ email: primaryEmail, password: PASSWORD });

		const refreshed = await agent.post("/api/v1/auth/refresh-token");
		expect(refreshed.status).toBe(200);
		expect(setCookies(refreshed).some((c) => c.startsWith("accessToken="))).toBe(true);

		const invalid = await request(app)
			.post("/api/v1/auth/refresh-token")
			.set("Cookie", "refreshToken=not-a-real-token");
		expect(invalid.status).toBe(401);
	});

	it("clears the session on logout", async () => {
		const agent = request.agent(app);
		await agent.post("/api/v1/auth/login").send({ email: primaryEmail, password: PASSWORD });

		const res = await agent.post("/api/v1/auth/logout");
		expect(res.status).toBe(200);

		expect(setCookies(res).some((c) => c.startsWith("accessToken=;"))).toBe(true);
	});

	it("refuses login for a blocked account", async () => {
		await registerAndVerify(blockedEmail);
		await prisma.user.update({
			where: { email: blockedEmail },
			data: { status: UserStatus.BLOCKED },
		});

		const res = await request(app)
			.post("/api/v1/auth/login")
			.send({ email: blockedEmail, password: PASSWORD });

		expect(res.status).toBe(403);
	});
});

describe("auth: password recovery", () => {
	it("returns the same response for a known and an unknown email (no enumeration)", async () => {
		const known = await request(app)
			.post("/api/v1/auth/forgot-password")
			.send({ email: primaryEmail });
		const unknown = await request(app)
			.post("/api/v1/auth/forgot-password")
			.send({ email: `nobody-${runId}b@example.com` });

		expect(known.status).toBe(200);
		expect(unknown.status).toBe(200);
		expect(known.body.message).toBe(unknown.body.message);
		// Dev/test-only OTP surfaced only for the eligible (known) account.
		expect(known.body.data.otp).toMatch(SIX_DIGIT_OTP);
		// Ineligible (unknown/non-credentials) accounts get `data: null` outright,
		// not an object with a missing `otp` key — see auth.controller.ts.
		expect(unknown.body.data?.otp).toBeUndefined();
	});

	it("rejects an invalid reset code and leaves the password unchanged", async () => {
		const res = await request(app).post("/api/v1/auth/reset-password").send({
			email: primaryEmail,
			otp: "000000",
			newPassword: NEW_PASSWORD,
		});
		expect(res.status).toBe(400);
	});

	it("resets the password with a valid code, then the old password no longer works", async () => {
		const otpRes = await request(app)
			.post("/api/v1/auth/forgot-password")
			.send({ email: primaryEmail });
		const otp = otpRes.body.data.otp;

		const resetRes = await request(app).post("/api/v1/auth/reset-password").send({
			email: primaryEmail,
			otp,
			newPassword: NEW_PASSWORD,
		});
		expect(resetRes.status).toBe(200);

		const oldLogin = await request(app)
			.post("/api/v1/auth/login")
			.send({ email: primaryEmail, password: PASSWORD });
		expect(oldLogin.status).toBe(401);

		const newLogin = await request(app)
			.post("/api/v1/auth/login")
			.send({ email: primaryEmail, password: NEW_PASSWORD });
		expect(newLogin.status).toBe(200);
	});
});

describe("auth: provider seam (identity model)", () => {
	it("links a second verified-email identity to the same user instead of duplicating", async () => {
		const first = await AuthService.findOrLinkUserByVerifiedEmail({
			provider: AuthProvider.CREDENTIALS,
			providerAccountId: seamEmail,
			name: "Seam User",
			email: seamEmail,
			passwordHash: "irrelevant-hash",
		});

		const second = await AuthService.findOrLinkUserByVerifiedEmail({
			provider: AuthProvider.GOOGLE,
			providerAccountId: `google-${runId}`,
			name: "Seam User",
			email: seamEmail,
		});

		expect(second.id).toBe(first.id);
		const accountCount = await prisma.account.count({ where: { userId: first.id } });
		expect(accountCount).toBe(2);
	});
});

describe("auth: rate limiting", () => {
	it("throttles repeated calls to the auth-limited endpoints", async () => {
		// The 5 auth-limited routes share one 20-req/15min bucket per IP (see
		// middleware/rateLimiter.ts). This test's own beforeEach just reset it,
		// so fire comfortably more than 20 (harmless, unknown-email) requests to
		// guarantee crossing the boundary.
		const statuses: number[] = [];
		for (let i = 0; i < 25; i++) {
			// biome-ignore lint/performance/noAwaitInLoops: exercises a stateful per-IP counter, must stay sequential
			const res = await request(app)
				.post("/api/v1/auth/forgot-password")
				.send({ email: `throttle-${runId}-${i}@example.com` });
			statuses.push(res.status);
		}

		expect(statuses).toContain(429);
	});
});
