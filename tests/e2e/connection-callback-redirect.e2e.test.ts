import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/app";
import config from "../../src/app/config";
import { prisma } from "../../src/app/lib/prisma";
import { redisClient } from "../../src/app/lib/redis";
import { facebookPageSelectionKey } from "../../src/app/module/connection/connection.constant";
import { facebookConnector } from "../../src/app/module/connection/connectors/facebook.connector";
import { linkedinConnector } from "../../src/app/module/connection/connectors/linkedin.connector";
import {
	classifyCallbackFailure,
	isBrowserNavigation,
	issueOAuthState,
	OAuthCallbackError,
} from "../../src/app/module/connection/connection.utils";
import { AppError } from "../../src/app/utils/appError";
import { seedPlatforms } from "../../src/app/utils/seed";
import { createVerifiedUser } from "../helpers/authUser";
import { deleteUsersByEmail } from "../helpers/db";
import { resetAuthRateLimit } from "../helpers/rateLimiter";

// The provider token exchange can't run headlessly (it needs interactive
// consent), so the connectors are spied on. Everything else — Redis state,
// the service, encryption, Postgres, the controller's navigation-vs-programmatic
// branch — is real.

const FRONTEND = "http://localhost:3000";
const originalFrontendUrl = config.frontend_url;

const runId = Date.now();
const createdEmails: string[] = [];
const createdUserIds: string[] = [];

const makeUser = async (label: string) => {
	const email = `e2e-cbredir-${runId}-${label}-${createdEmails.length}@example.com`;
	createdEmails.push(email);
	await createVerifiedUser(email);
	const user = await prisma.user.findUniqueOrThrow({ where: { email } });
	createdUserIds.push(user.id);
	return user.id;
};

const NAVIGATE = { "Sec-Fetch-Mode": "navigate" };

const linkedinConnection = {
	kind: "connection" as const,
	connection: {
		platformAccountId: "urn:li:member:redirect-test",
		platformAccountName: "Redirect Test",
		accessToken: "redirect-test-access-token-xyz",
	},
};

const facebookPages = [
	{ id: "page-1", name: "First Page", accessToken: "fb-page-token-1" },
	{ id: "page-2", name: "Second Page", accessToken: "fb-page-token-2" },
];

beforeAll(async () => {
	// Idempotent upsert of the LIVE linkedin/facebook rows (a fresh test DB has none).
	await seedPlatforms();
});

beforeEach(async () => {
	config.frontend_url = FRONTEND;
	await resetAuthRateLimit();
});

afterEach(() => {
	vi.restoreAllMocks();
});

afterAll(async () => {
	config.frontend_url = originalFrontendUrl;
	await Promise.all(
		createdUserIds.map((id) => redisClient.del(facebookPageSelectionKey(id)).catch(() => 0)),
	);
	await deleteUsersByEmail(createdEmails);
});

describe("callback redirect: browser navigation", () => {
	it("redirects a successful LinkedIn connect to /connections?connected=linkedin and stores it", async () => {
		const userId = await makeUser("li-ok");
		vi.spyOn(linkedinConnector, "handleCallback").mockResolvedValue(linkedinConnection);
		const state = await issueOAuthState({ userId, platformKey: "linkedin" });

		const res = await request(app)
			.get(`/api/v1/connections/linkedin/callback?code=real-looking-code&state=${state}`)
			.set(NAVIGATE);

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${FRONTEND}/connections?connected=linkedin`);
		expect(res.headers.location).not.toContain("real-looking-code");
		expect(res.headers.location).not.toContain(state);
		expect(res.headers["cache-control"]).toBe("no-store");
		expect(res.headers.vary?.toLowerCase()).toContain("sec-fetch-mode");
		expect(res.headers.vary?.toLowerCase()).toContain("accept");

		const row = await prisma.socialConnection.findFirstOrThrow({ where: { userId } });
		expect(row.platformAccountName).toBe("Redirect Test");
	});

	it("redirects Facebook with several Pages to /connections?select=facebook and holds the Pages", async () => {
		const userId = await makeUser("fb-select");
		vi.spyOn(facebookConnector, "handleCallback").mockResolvedValue({
			kind: "select-page",
			userToken: "fb-user-token",
			pages: facebookPages,
		});
		const state = await issueOAuthState({ userId, platformKey: "facebook" });

		const res = await request(app)
			.get(`/api/v1/connections/facebook/callback?code=fb-code&state=${state}`)
			.set(NAVIGATE);

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${FRONTEND}/connections?select=facebook`);
		expect(await redisClient.get(facebookPageSelectionKey(userId))).not.toBeNull();
		expect(await prisma.socialConnection.count({ where: { userId } })).toBe(0);
	});

	it("redirects Facebook with exactly one Page (auto-selected) to ?connected=facebook", async () => {
		const userId = await makeUser("fb-one");
		vi.spyOn(facebookConnector, "handleCallback").mockResolvedValue({
			kind: "select-page",
			userToken: "fb-user-token",
			pages: [facebookPages[0] as (typeof facebookPages)[number]],
		});
		const state = await issueOAuthState({ userId, platformKey: "facebook" });

		const res = await request(app)
			.get(`/api/v1/connections/facebook/callback?code=fb-code&state=${state}`)
			.set(NAVIGATE);

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${FRONTEND}/connections?connected=facebook`);
		expect(await prisma.socialConnection.count({ where: { userId } })).toBe(1);
	});

	it("maps provider access_denied (no code) to ?error=cancelled and still consumes the state", async () => {
		const userId = await makeUser("cancel");
		const exchange = vi.spyOn(linkedinConnector, "handleCallback");
		const state = await issueOAuthState({ userId, platformKey: "linkedin" });

		const res = await request(app)
			.get(
				`/api/v1/connections/linkedin/callback?error=access_denied&error_description=User+denied&state=${state}`,
			)
			.set(NAVIGATE);

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${FRONTEND}/connections?error=cancelled`);
		expect(res.headers.location).not.toContain("denied");
		expect(exchange).not.toHaveBeenCalled();

		// State is single-use: replaying it is now an invalid state.
		const replay = await request(app)
			.get(`/api/v1/connections/linkedin/callback?code=late&state=${state}`)
			.set(NAVIGATE);
		expect(replay.headers.location).toBe(`${FRONTEND}/connections?error=invalid-state`);
	});

	it("maps LinkedIn user_cancelled_login to ?error=cancelled", async () => {
		const userId = await makeUser("li-cancel");
		const state = await issueOAuthState({ userId, platformKey: "linkedin" });

		const res = await request(app)
			.get(`/api/v1/connections/linkedin/callback?error=user_cancelled_login&state=${state}`)
			.set(NAVIGATE);

		expect(res.headers.location).toBe(`${FRONTEND}/connections?error=cancelled`);
	});

	it("maps any other provider error (no code) to ?error=failed without echoing it", async () => {
		const userId = await makeUser("prov-fail");
		const state = await issueOAuthState({ userId, platformKey: "linkedin" });

		const res = await request(app)
			.get(
				`/api/v1/connections/linkedin/callback?error=server_error&error_description=boom&state=${state}`,
			)
			.set(NAVIGATE);

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${FRONTEND}/connections?error=failed`);
		expect(res.headers.location).not.toContain("server_error");
	});

	it("maps an unknown state to ?error=invalid-state and stores nothing", async () => {
		const res = await request(app)
			.get("/api/v1/connections/linkedin/callback?code=fake-code&state=bogus-state")
			.set(NAVIGATE);

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${FRONTEND}/connections?error=invalid-state`);
	});

	it("maps a missing state to ?error=invalid-state", async () => {
		const res = await request(app)
			.get("/api/v1/connections/linkedin/callback?code=fake-code")
			.set(NAVIGATE);

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${FRONTEND}/connections?error=invalid-state`);
	});

	it("maps a state issued for a different platform to ?error=invalid-state", async () => {
		const userId = await makeUser("wrong-platform");
		const exchange = vi.spyOn(facebookConnector, "handleCallback");
		const state = await issueOAuthState({ userId, platformKey: "linkedin" });

		const res = await request(app)
			.get(`/api/v1/connections/facebook/callback?code=fb-code&state=${state}`)
			.set(NAVIGATE);

		expect(res.headers.location).toBe(`${FRONTEND}/connections?error=invalid-state`);
		expect(exchange).not.toHaveBeenCalled();
	});

	it("maps a provider exchange failure to ?error=failed and stores nothing", async () => {
		const userId = await makeUser("exchange-fail");
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(linkedinConnector, "handleCallback").mockRejectedValue(
			new AppError(502, "Failed to exchange LinkedIn authorization code"),
		);
		const state = await issueOAuthState({ userId, platformKey: "linkedin" });

		const res = await request(app)
			.get(`/api/v1/connections/linkedin/callback?code=bad-code&state=${state}`)
			.set(NAVIGATE);

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${FRONTEND}/connections?error=failed`);
		expect(res.headers.location).not.toContain("bad-code");
		expect(await prisma.socialConnection.count({ where: { userId } })).toBe(0);
	});

	it("never reflects an odd platform path segment into the redirect", async () => {
		const res = await request(app)
			.get("/api/v1/connections/%2F%2Fevil.example/callback?code=x&state=bogus")
			.set(NAVIGATE);

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${FRONTEND}/connections?error=invalid-state`);
	});

	it("never reflects request input into the redirect target (no open redirect)", async () => {
		const res = await request(app)
			.get(
				"/api/v1/connections/linkedin/callback?code=https://evil.example&state=//evil.example&error=//evil.example&redirect=https://evil.example&returnTo=//evil.example",
			)
			.set(NAVIGATE);

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${FRONTEND}/connections?error=invalid-state`);
		expect(res.headers.location).not.toContain("evil");
	});

	it("tolerates a trailing slash on FRONTEND_URL", async () => {
		config.frontend_url = `${FRONTEND}/`;

		const res = await request(app)
			.get("/api/v1/connections/linkedin/callback?code=x&state=bogus")
			.set(NAVIGATE);

		expect(res.headers.location).toBe(`${FRONTEND}/connections?error=invalid-state`);
	});

	it("falls back to the JSON error when FRONTEND_URL is not configured", async () => {
		config.frontend_url = undefined;

		const res = await request(app)
			.get("/api/v1/connections/linkedin/callback?code=x&state=bogus")
			.set(NAVIGATE);

		expect(res.status).toBe(400);
		expect(res.body.message).toBe("Invalid or expired OAuth state");
	});

	it("treats an Accept: text/html request without Sec-Fetch-Mode as a navigation", async () => {
		const res = await request(app)
			.get("/api/v1/connections/linkedin/callback?code=x&state=bogus")
			.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");

		expect(res.status).toBe(302);
		expect(res.headers.location).toBe(`${FRONTEND}/connections?error=invalid-state`);
	});
});

describe("callback redirect: programmatic callers keep the exact JSON", () => {
	it("returns 200 + the connected payload for a request with no navigation headers", async () => {
		const userId = await makeUser("json-ok");
		vi.spyOn(linkedinConnector, "handleCallback").mockResolvedValue(linkedinConnection);
		const state = await issueOAuthState({ userId, platformKey: "linkedin" });

		const res = await request(app).get(
			`/api/v1/connections/linkedin/callback?code=real-looking-code&state=${state}`,
		);

		expect(res.status).toBe(200);
		expect(res.headers.location).toBeUndefined();
		expect(res.body).toMatchObject({
			success: true,
			statusCode: 200,
			message: "Platform connected successfully",
			data: {
				kind: "connected",
				connection: {
					platform: { key: "linkedin", name: "LinkedIn" },
					platformAccountName: "Redirect Test",
					status: "CONNECTED",
				},
			},
		});
		expect(JSON.stringify(res.body)).not.toContain("redirect-test-access-token-xyz");
	});

	it("returns 200 + the select-page payload for Facebook with several Pages", async () => {
		const userId = await makeUser("json-select");
		vi.spyOn(facebookConnector, "handleCallback").mockResolvedValue({
			kind: "select-page",
			userToken: "fb-user-token",
			pages: facebookPages,
		});
		const state = await issueOAuthState({ userId, platformKey: "facebook" });

		const res = await request(app).get(
			`/api/v1/connections/facebook/callback?code=fb-code&state=${state}`,
		);

		expect(res.status).toBe(200);
		expect(res.body.message).toBe("Select a Page to finish connecting");
		expect(res.body.data).toEqual({
			kind: "select-page",
			pages: [
				{ id: "page-1", name: "First Page" },
				{ id: "page-2", name: "Second Page" },
			],
		});
	});

	it("keeps 400 'Invalid or expired OAuth state' as JSON", async () => {
		const res = await request(app).get(
			"/api/v1/connections/linkedin/callback?code=fake-code&state=bogus-state",
		);

		expect(res.status).toBe(400);
		expect(res.headers.location).toBeUndefined();
		expect(res.body.success).toBe(false);
		expect(res.body.message).toBe("Invalid or expired OAuth state");
	});

	it("keeps 400 'Missing authorization code' as JSON (state consumed)", async () => {
		const userId = await makeUser("json-missing-code");
		const state = await issueOAuthState({ userId, platformKey: "linkedin" });

		const res = await request(app).get(
			`/api/v1/connections/linkedin/callback?error=access_denied&state=${state}`,
		);

		expect(res.status).toBe(400);
		expect(res.body.message).toBe("Missing authorization code");
	});

	it("keeps 502 provider failures as JSON", async () => {
		const userId = await makeUser("json-502");
		vi.spyOn(linkedinConnector, "handleCallback").mockRejectedValue(
			new AppError(502, "Failed to exchange LinkedIn authorization code"),
		);
		const state = await issueOAuthState({ userId, platformKey: "linkedin" });

		const res = await request(app).get(
			`/api/v1/connections/linkedin/callback?code=bad&state=${state}`,
		);

		expect(res.status).toBe(502);
		expect(res.body.message).toBe("Failed to exchange LinkedIn authorization code");
	});

	it("treats a script request (Sec-Fetch-Mode: cors) as programmatic even with Accept: text/html", async () => {
		const res = await request(app)
			.get("/api/v1/connections/linkedin/callback?code=x&state=bogus")
			.set({ "Sec-Fetch-Mode": "cors", Accept: "text/html" });

		expect(res.status).toBe(400);
		expect(res.headers.location).toBeUndefined();
	});

	it("treats Accept: application/json (the frontend callback page) as programmatic", async () => {
		const res = await request(app)
			.get("/api/v1/connections/linkedin/callback?code=x&state=bogus")
			.set("Accept", "application/json, text/html");

		expect(res.status).toBe(400);
		expect(res.headers.location).toBeUndefined();
	});
});

describe("callback redirect: helpers", () => {
	const headers = (values: Record<string, string>) => ({
		get: (name: string) => values[name.toLowerCase()],
	});

	it("isBrowserNavigation: Sec-Fetch-Mode wins; Accept is only a fallback", () => {
		expect(isBrowserNavigation(headers({ "sec-fetch-mode": "navigate" }))).toBe(true);
		expect(isBrowserNavigation(headers({ "sec-fetch-mode": "Navigate" }))).toBe(true);
		expect(isBrowserNavigation(headers({ "sec-fetch-mode": "cors", accept: "text/html" }))).toBe(
			false,
		);
		expect(isBrowserNavigation(headers({ accept: "text/html,application/xhtml+xml" }))).toBe(true);
		expect(isBrowserNavigation(headers({ accept: "text/html, application/json" }))).toBe(false);
		expect(isBrowserNavigation(headers({ accept: "*/*" }))).toBe(false);
		expect(isBrowserNavigation(headers({}))).toBe(false);
	});

	it("OAuthCallbackError serializes exactly like the AppError it replaced", () => {
		const tagged = new OAuthCallbackError(400, "Missing authorization code", "missing-code");
		const plain = new AppError(400, "Missing authorization code");

		expect(JSON.stringify(tagged)).toBe(JSON.stringify(plain));
		expect(tagged.reason).toBe("missing-code");
	});

	it("classifyCallbackFailure maps to the fixed codes only", () => {
		const badState = new OAuthCallbackError(400, "Invalid or expired OAuth state", "invalid-state");
		const noCode = new OAuthCallbackError(400, "Missing authorization code", "missing-code");

		expect(classifyCallbackFailure(badState, undefined)).toBe("invalid-state");
		expect(classifyCallbackFailure(badState, "access_denied")).toBe("invalid-state");
		expect(classifyCallbackFailure(noCode, "access_denied")).toBe("cancelled");
		expect(classifyCallbackFailure(noCode, "user_cancelled_authorize")).toBe("cancelled");
		expect(classifyCallbackFailure(noCode, "server_error")).toBe("failed");
		expect(classifyCallbackFailure(noCode, undefined)).toBe("failed");
		expect(classifyCallbackFailure(new AppError(502, "x"), "access_denied")).toBe("failed");
		expect(classifyCallbackFailure(new Error("boom"), undefined)).toBe("failed");
	});
});
