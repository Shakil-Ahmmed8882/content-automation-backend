import request from "supertest";
import app from "../../src/app";

export const DEFAULT_TEST_PASSWORD = "correct-horse-battery-staple";

/** Registers + verifies a fresh user through the real HTTP auth flow and
 * returns a cookie-jar agent already logged in as that user. Shared across
 * every module's E2E suite that needs "a logged-in test user" as a fixture —
 * auth itself is exercised end-to-end in tests/e2e/auth.e2e.test.ts. */
export const createVerifiedUser = async (email: string, password = DEFAULT_TEST_PASSWORD) => {
	const agent = request.agent(app);

	const registerRes = await agent
		.post("/api/v1/auth/register")
		.send({ name: "E2E User", email, password });
	const otp = registerRes.body.data.otp;

	await agent.post("/api/v1/auth/verify-email").send({ email, otp });

	return agent;
};
