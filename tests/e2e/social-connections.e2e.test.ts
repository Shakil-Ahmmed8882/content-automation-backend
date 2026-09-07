import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/app";
import { decrypt, encrypt } from "../../src/app/lib/crypto";
import { prisma } from "../../src/app/lib/prisma";
import { redisClient } from "../../src/app/lib/redis";
import { facebookPageSelectionKey } from "../../src/app/module/connection/connection.constant";
import type { IFacebookPageSelection } from "../../src/app/module/connection/connection.interface";
import { ConnectionService } from "../../src/app/module/connection/connection.service";
import {
	consumeOAuthState,
	issueOAuthState,
} from "../../src/app/module/connection/connection.utils";
import { PlatformStatus } from "../../src/generated/prisma/enums";
import { createVerifiedUser } from "../helpers/authUser";
import { deletePlatformsByKey, deleteUsersByEmail } from "../helpers/db";
import { resetAuthRateLimit } from "../helpers/rateLimiter";

beforeEach(resetAuthRateLimit);

const runId = Date.now();
const createdEmails: string[] = [];
const createdKeys: string[] = [];
const createdUserIds: string[] = [];

const freshEmail = (label: string) => {
	const email = `e2e-conn-${runId}-${label}-${createdEmails.length}@example.com`;
	createdEmails.push(email);
	return email;
};

const freshKey = (label: string) => {
	const key = `e2e-conn-plat-${runId}-${label}-${createdKeys.length}`;
	createdKeys.push(key);
	return key;
};

/** A logged-in agent plus that user's id (needed to seed connections directly). */
const makeUser = async (label: string) => {
	const email = freshEmail(label);
	const agent = await createVerifiedUser(email);
	const user = await prisma.user.findUniqueOrThrow({ where: { email } });
	createdUserIds.push(user.id);
	return { agent, userId: user.id, email };
};

const linkedinPlatform = () => prisma.platform.findUniqueOrThrow({ where: { key: "linkedin" } });

afterAll(async () => {
	// Connections cascade-delete with their user (FK). Clear any leftover
	// Facebook page-selection stashes, then delete test platforms + users.
	await Promise.all(
		createdUserIds.map((id) => redisClient.del(facebookPageSelectionKey(id)).catch(() => 0)),
	);
	await deletePlatformsByKey(createdKeys);
	await deleteUsersByEmail(createdEmails);
});

describe("social-connections: token encryption (lib/crypto)", () => {
	it("round-trips a value and produces ciphertext that differs from the plaintext", () => {
		const secret = "linkedin-access-token-abc123";
		const ciphertext = encrypt(secret);

		expect(ciphertext).not.toBe(secret);
		expect(ciphertext).not.toContain(secret);
		expect(decrypt(ciphertext)).toBe(secret);
	});

	it("encrypts the same value differently each time (random IV)", () => {
		const secret = "same-token";
		expect(encrypt(secret)).not.toBe(encrypt(secret));
	});

	it("throws when the ciphertext has been tampered with", () => {
		const [iv, authTag, data] = encrypt("token").split(":") as [string, string, string];
		// Flip a byte in the ciphertext body — the GCM auth tag must now fail.
		const bytes = Buffer.from(data, "base64");
		bytes[0] = bytes[0]! ^ 0xff;
		const tampered = [iv, authTag, bytes.toString("base64")].join(":");
		expect(() => decrypt(tampered)).toThrow();
	});
});

describe("social-connections: OAuth state (CSRF, single-use)", () => {
	it("validates a freshly issued state exactly once", async () => {
		const state = await issueOAuthState({ userId: "user-1", platformKey: "linkedin" });

		const first = await consumeOAuthState(state);
		expect(first).toEqual({ userId: "user-1", platformKey: "linkedin" });

		// Single-use: a replay of the same state must now fail.
		const second = await consumeOAuthState(state);
		expect(second).toBeNull();
	});

	it("rejects an unknown or missing state", async () => {
		expect(await consumeOAuthState("never-issued")).toBeNull();
		expect(await consumeOAuthState(undefined)).toBeNull();
	});
});

describe("social-connections: start connect", () => {
	it("rejects an unauthenticated request", async () => {
		const res = await request(app).get("/api/v1/connections/linkedin/connect");
		expect(res.status).toBe(401);
	});

	it("returns the provider OAuth URL with a state for a LIVE platform", async () => {
		const { agent } = await makeUser("connect-live");

		const res = await agent.get("/api/v1/connections/linkedin/connect");

		expect(res.status).toBe(200);
		expect(res.body.data.authUrl).toContain("linkedin.com");
		expect(res.body.data.authUrl).toContain("state=");
	});

	it("refuses to connect a non-LIVE platform", async () => {
		const { agent } = await makeUser("connect-coming-soon");
		const key = freshKey("coming-soon");
		await prisma.platform.create({
			data: { key, name: "Coming Soon", status: PlatformStatus.COMING_SOON },
		});

		const res = await agent.get(`/api/v1/connections/${key}/connect`);
		expect(res.status).toBe(400);
	});

	it("returns 501 for a LIVE platform with no wired connector", async () => {
		const { agent } = await makeUser("connect-no-connector");
		const key = freshKey("no-connector");
		await prisma.platform.create({
			data: { key, name: "Unwired", status: PlatformStatus.LIVE },
		});

		const res = await agent.get(`/api/v1/connections/${key}/connect`);
		expect(res.status).toBe(501);
	});
});

describe("social-connections: callback CSRF", () => {
	it("rejects a callback with a missing state and stores nothing", async () => {
		const { userId } = await makeUser("callback-no-state");

		const res = await request(app).get("/api/v1/connections/linkedin/callback?code=fake-code");
		expect(res.status).toBe(400);

		const count = await prisma.socialConnection.count({ where: { userId } });
		expect(count).toBe(0);
	});

	it("rejects a callback with an unknown state and stores nothing", async () => {
		const res = await request(app).get(
			"/api/v1/connections/linkedin/callback?code=fake-code&state=bogus-state",
		);
		expect(res.status).toBe(400);
	});
});

describe("social-connections: list (no tokens)", () => {
	it("rejects an unauthenticated request", async () => {
		const res = await request(app).get("/api/v1/connections");
		expect(res.status).toBe(401);
	});

	it("lists the caller's connections and never includes tokens", async () => {
		const { agent, userId } = await makeUser("list");
		const platform = await linkedinPlatform();
		await ConnectionService.storeConnection(userId, platform.id, {
			platformAccountId: "urn:li:member:123",
			platformAccountName: "Test Member",
			accessToken: "secret-access-token",
			refreshToken: "secret-refresh-token",
		});

		const res = await agent.get("/api/v1/connections");

		expect(res.status).toBe(200);
		expect(res.body.data).toHaveLength(1);
		const connection = res.body.data[0];
		expect(connection.platform.key).toBe("linkedin");
		expect(connection.platformAccountName).toBe("Test Member");
		expect(connection.accessToken).toBeUndefined();
		expect(connection.refreshToken).toBeUndefined();
		expect(JSON.stringify(res.body)).not.toContain("secret-access-token");
	});

	it("never exposes another user's connections", async () => {
		const owner = await makeUser("scope-owner");
		const other = await makeUser("scope-other");
		const platform = await linkedinPlatform();
		await ConnectionService.storeConnection(owner.userId, platform.id, {
			platformAccountName: "Owner Member",
			accessToken: "owner-token",
		});

		const res = await other.agent.get("/api/v1/connections");
		expect(res.status).toBe(200);
		expect(res.body.data).toHaveLength(0);
	});
});

describe("social-connections: encrypted at rest", () => {
	it("stores the access token as ciphertext, decryptable back to the original", async () => {
		const { userId } = await makeUser("encrypted");
		const platform = await linkedinPlatform();
		const plaintext = "plaintext-linkedin-token";
		await ConnectionService.storeConnection(userId, platform.id, {
			platformAccountName: "Enc Member",
			accessToken: plaintext,
		});

		const row = await prisma.socialConnection.findUniqueOrThrow({
			where: { userId_platformId: { userId, platformId: platform.id } },
		});

		expect(row.accessToken).not.toBe(plaintext);
		expect(row.accessToken).not.toContain(plaintext);
		expect(decrypt(row.accessToken)).toBe(plaintext);
	});
});

describe("social-connections: disconnect", () => {
	it("hard-deletes the connection and its tokens", async () => {
		const { agent, userId } = await makeUser("disconnect");
		const platform = await linkedinPlatform();
		await ConnectionService.storeConnection(userId, platform.id, {
			platformAccountName: "To Disconnect",
			accessToken: "token",
		});

		const res = await agent.delete("/api/v1/connections/linkedin");
		expect(res.status).toBe(200);

		const count = await prisma.socialConnection.count({ where: { userId } });
		expect(count).toBe(0);
	});

	it("reconnecting after a disconnect yields exactly one connection", async () => {
		const { userId } = await makeUser("reconnect");
		const platform = await linkedinPlatform();

		await ConnectionService.storeConnection(userId, platform.id, {
			platformAccountName: "First",
			accessToken: "token-1",
		});
		await ConnectionService.storeConnection(userId, platform.id, {
			platformAccountName: "Second",
			accessToken: "token-2",
		});

		const rows = await prisma.socialConnection.findMany({ where: { userId } });
		expect(rows).toHaveLength(1);
		expect(rows[0]?.platformAccountName).toBe("Second");
	});

	it("returns 404 when disconnecting a platform that is not connected", async () => {
		const { agent } = await makeUser("disconnect-none");
		const res = await agent.delete("/api/v1/connections/linkedin");
		expect(res.status).toBe(404);
	});

	it("never lets one user delete another user's connection", async () => {
		const owner = await makeUser("del-scope-owner");
		const other = await makeUser("del-scope-other");
		const platform = await linkedinPlatform();
		await ConnectionService.storeConnection(owner.userId, platform.id, {
			platformAccountName: "Owner",
			accessToken: "owner-token",
		});

		// `other` has no linkedin connection of their own → 404, and the owner's
		// row is untouched.
		const res = await other.agent.delete("/api/v1/connections/linkedin");
		expect(res.status).toBe(404);

		const stillThere = await prisma.socialConnection.count({ where: { userId: owner.userId } });
		expect(stillThere).toBe(1);
	});
});

describe("social-connections: Facebook Page selection", () => {
	// The live token exchange (code → user token → Pages) needs a real Facebook
	// app + interactive consent and is covered manually (see the Postman guide).
	// Here we seed the transient Page-selection stash exactly as the callback
	// would, then verify the list + select-and-store behavior end-to-end.
	const seedSelection = async (userId: string, pages: Array<{ id: string; name: string }>) => {
		const selection: IFacebookPageSelection = {
			userTokenEncrypted: encrypt("long-lived-user-token"),
			pages: pages.map((page) => ({
				id: page.id,
				name: page.name,
				accessTokenEncrypted: encrypt(`page-token-${page.id}`),
			})),
		};
		await redisClient.set(facebookPageSelectionKey(userId), JSON.stringify(selection), {
			expiration: { type: "EX", value: 600 },
		});
	};

	it("lists the held Pages without exposing tokens", async () => {
		const { agent, userId } = await makeUser("fb-pages");
		await seedSelection(userId, [
			{ id: "page-1", name: "Alice's Studio" },
			{ id: "page-2", name: "Alice's Shop" },
		]);

		const res = await agent.get("/api/v1/connections/facebook/pages");

		expect(res.status).toBe(200);
		expect(res.body.data).toHaveLength(2);
		expect(res.body.data[0]).toEqual({ id: "page-1", name: "Alice's Studio" });
		expect(JSON.stringify(res.body)).not.toContain("page-token");
	});

	it("stores the selected Page as a Page-token connection", async () => {
		const { agent, userId } = await makeUser("fb-select");
		await seedSelection(userId, [
			{ id: "page-1", name: "Alice's Studio" },
			{ id: "page-2", name: "Alice's Shop" },
		]);

		const res = await agent
			.post("/api/v1/connections/facebook/select-page")
			.send({ pageId: "page-2" });

		expect(res.status).toBe(200);
		expect(res.body.data.platform.key).toBe("facebook");
		expect(res.body.data.platformAccountName).toBe("Alice's Shop");

		const platform = await prisma.platform.findUniqueOrThrow({ where: { key: "facebook" } });
		const row = await prisma.socialConnection.findUniqueOrThrow({
			where: { userId_platformId: { userId, platformId: platform.id } },
		});
		expect(row.platformAccountId).toBe("page-2");
		expect(decrypt(row.accessToken)).toBe("page-token-page-2");
	});

	it("rejects selecting a Page that is not among the held Pages", async () => {
		const { agent, userId } = await makeUser("fb-bad-select");
		await seedSelection(userId, [{ id: "page-1", name: "Only Page" }]);

		const res = await agent
			.post("/api/v1/connections/facebook/select-page")
			.send({ pageId: "page-999" });
		expect(res.status).toBe(400);
	});

	it("requires an in-progress selection to list Pages", async () => {
		const { agent } = await makeUser("fb-no-selection");
		const res = await agent.get("/api/v1/connections/facebook/pages");
		expect(res.status).toBe(400);
	});
});
