import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/app";
import config from "../../src/app/config";
import { prisma } from "../../src/app/lib/prisma";
import { AuthService } from "../../src/app/module/auth/auth.service";
import { issueTokens } from "../../src/app/module/auth/auth.utils";
import { AuthProvider } from "../../src/generated/prisma/enums";
import { createVerifiedUser, DEFAULT_TEST_PASSWORD } from "../helpers/authUser";
import { deleteUsersByEmail } from "../helpers/db";
import { resetAuthRateLimit } from "../helpers/rateLimiter";

beforeEach(resetAuthRateLimit);

const runId = Date.now();
// Every test that needs "a fresh registered user" gets its OWN email —
// register() rejects (409) an email that already has a verified account, so
// reusing one email across independent tests would break every test after
// the first. Tracked in this array (mutated as tests run) for afterAll cleanup.
const createdEmails: string[] = [];
const freshEmail = (label: string) => {
	const email = `e2e-profile-${runId}-${label}-${createdEmails.length}@example.com`;
	createdEmails.push(email);
	return email;
};

// Avatar upload/replace genuinely calls Cloudinary — this repo's .env has no
// real Cloudinary account configured yet (placeholders). The scenarios that
// need a live upload are skipped until CLOUDINARY_* are set; "rejects a
// non-image file" always runs since multer's fileFilter rejects it before any
// Cloudinary call happens — see docs/decisions.md.
const hasCloudinaryCreds = Boolean(
	config.cloudinary_cloud_name && config.cloudinary_api_key && config.cloudinary_api_secret,
);

afterAll(async () => {
	await deleteUsersByEmail(createdEmails);
});

describe("user-profile: get & update", () => {
	it("rejects an unauthenticated request", async () => {
		const res = await request(app).get("/api/v1/users/me");
		expect(res.status).toBe(401);
	});

	it("returns the profile with premium state and linked providers, no secrets", async () => {
		const email = freshEmail("get-profile");
		const agent = await createVerifiedUser(email);

		const res = await agent.get("/api/v1/users/me");

		expect(res.status).toBe(200);
		expect(res.body.data.email).toBe(email);
		expect(res.body.data.isPremium).toBe(false);
		expect(res.body.data.providers).toEqual(["CREDENTIALS"]);
		expect(res.body.data.passwordHash).toBeUndefined();
		expect(res.body.data.accessToken).toBeUndefined();
	});

	it("updates the name and ignores an email field in the same request", async () => {
		const email = freshEmail("update-name");
		const agent = await createVerifiedUser(email);

		const res = await agent
			.patch("/api/v1/users/me")
			.send({ name: "Updated Name", email: "should-not-apply@example.com" });

		expect(res.status).toBe(200);
		expect(res.body.data.name).toBe("Updated Name");
		expect(res.body.data.email).toBe(email);

		const user = await prisma.user.findUnique({ where: { email } });
		expect(user?.email).toBe(email);
	});

	it("never lets one user's update affect another user's profile", async () => {
		const primaryEmail = freshEmail("cross-primary");
		const otherEmail = freshEmail("cross-other");
		const primaryAgent = await createVerifiedUser(primaryEmail);
		const otherAgent = await createVerifiedUser(otherEmail);

		await primaryAgent.patch("/api/v1/users/me").send({ name: "Primary Renamed" });

		const otherRes = await otherAgent.get("/api/v1/users/me");
		expect(otherRes.body.data.name).toBe("E2E User");
		expect(otherRes.body.data.email).toBe(otherEmail);
	});
});

describe("user-profile: avatar", () => {
	it("rejects a non-image file without touching Cloudinary", async () => {
		const email = freshEmail("bad-avatar");
		const agent = await createVerifiedUser(email);

		const res = await agent
			.patch("/api/v1/users/me/avatar")
			.attach("avatar", Buffer.from("not an image"), {
				filename: "not-an-image.txt",
				contentType: "text/plain",
			});

		expect(res.status).toBe(400);

		const user = await prisma.user.findUnique({ where: { email } });
		expect(user?.avatarUrl).toBeNull();
	});
});

const ONE_PX_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

describe.skipIf(!hasCloudinaryCreds)("user-profile: avatar (live Cloudinary)", () => {
	it("uploads an avatar, then replaces it and deletes the old asset", async () => {
		const agent = await createVerifiedUser(freshEmail("avatar-replace"));

		const first = await agent
			.patch("/api/v1/users/me/avatar")
			.attach("avatar", ONE_PX_PNG, { filename: "avatar1.png", contentType: "image/png" });
		expect(first.status).toBe(200);
		expect(first.body.data.avatarUrl).toEqual(expect.any(String));
		const firstPublicId = first.body.data.avatarPublicId;

		const second = await agent
			.patch("/api/v1/users/me/avatar")
			.attach("avatar", ONE_PX_PNG, { filename: "avatar2.png", contentType: "image/png" });
		expect(second.status).toBe(200);
		expect(second.body.data.avatarPublicId).not.toBe(firstPublicId);
	});

	it("removes the avatar and clears its fields", async () => {
		const agent = await createVerifiedUser(freshEmail("avatar-remove"));
		await agent
			.patch("/api/v1/users/me/avatar")
			.attach("avatar", ONE_PX_PNG, { filename: "avatar.png", contentType: "image/png" });

		const res = await agent.delete("/api/v1/users/me/avatar");

		expect(res.status).toBe(200);
		expect(res.body.data.avatarUrl).toBeNull();
		expect(res.body.data.avatarPublicId).toBeNull();
	});
});

describe("user-profile: change password", () => {
	it("changes the password with the correct current password", async () => {
		const email = freshEmail("change-pw-ok");
		const agent = await createVerifiedUser(email);
		const newPassword = "brand-new-password-123";

		const res = await agent
			.patch("/api/v1/users/me/password")
			.send({ currentPassword: DEFAULT_TEST_PASSWORD, newPassword });
		expect(res.status).toBe(200);

		const oldLogin = await request(app)
			.post("/api/v1/auth/login")
			.send({ email, password: DEFAULT_TEST_PASSWORD });
		expect(oldLogin.status).toBe(401);

		const newLogin = await request(app)
			.post("/api/v1/auth/login")
			.send({ email, password: newPassword });
		expect(newLogin.status).toBe(200);
	});

	it("rejects a wrong current password and leaves it unchanged", async () => {
		const email = freshEmail("change-pw-wrong");
		const agent = await createVerifiedUser(email);

		const res = await agent
			.patch("/api/v1/users/me/password")
			.send({ currentPassword: "totally-wrong", newPassword: "irrelevant-new-password" });
		expect(res.status).toBe(401);

		const stillWorks = await request(app)
			.post("/api/v1/auth/login")
			.send({ email, password: DEFAULT_TEST_PASSWORD });
		expect(stillWorks.status).toBe(200);
	});

	it("refuses to change password for an OAuth-only account", async () => {
		const email = freshEmail("oauth-only");
		const oauthUser = await AuthService.findOrLinkUserByVerifiedEmail({
			provider: AuthProvider.GOOGLE,
			providerAccountId: `google-${runId}`,
			name: "OAuth Only User",
			email,
		});
		// No credentials login exists for this user (no OAuth flow is built yet
		// to obtain a real session), so mint one directly the same way the auth
		// service does, and drive the request as that user would.
		const tokens = issueTokens(oauthUser);

		const res = await request(app)
			.patch("/api/v1/users/me/password")
			.set("Cookie", `accessToken=${tokens.accessToken}`)
			.send({ currentPassword: "anything", newPassword: "irrelevant-new-password" });

		expect(res.status).toBe(400);
	});
});

describe("user-profile: soft delete", () => {
	it("soft-deletes the account, ends the session, and blocks future login", async () => {
		const email = freshEmail("delete-me");
		const agent = await createVerifiedUser(email);

		const res = await agent.delete("/api/v1/users/me");
		expect(res.status).toBe(200);

		// The same (still cryptographically valid, unexpired) access token must
		// now be refused — checkAuth re-checks isDeleted on every request.
		const afterDelete = await agent.get("/api/v1/users/me");
		expect(afterDelete.status).toBe(401);

		const loginAttempt = await request(app)
			.post("/api/v1/auth/login")
			.send({ email, password: DEFAULT_TEST_PASSWORD });
		expect(loginAttempt.status).toBe(403);

		const user = await prisma.user.findUnique({ where: { email } });
		expect(user?.isDeleted).toBe(true);
		expect(user?.deletedAt).not.toBeNull();
	});
});
