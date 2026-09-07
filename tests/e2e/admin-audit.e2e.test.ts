import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/app";
import { prisma } from "../../src/app/lib/prisma";
import { ConnectionService } from "../../src/app/module/connection/connection.service";
import { Role } from "../../src/generated/prisma/enums";
import { DEFAULT_TEST_PASSWORD, createVerifiedUser } from "../helpers/authUser";
import { deletePlatformsByKey, deleteUsersByEmail } from "../helpers/db";
import { resetAuthRateLimit } from "../helpers/rateLimiter";

beforeEach(resetAuthRateLimit);

const runId = Date.now();
const createdEmails: string[] = [];
const createdUserIds: string[] = [];
const createdKeys: string[] = [];

const freshEmail = (label: string) => {
	const email = `e2e-admin-${runId}-${label}-${createdEmails.length}@example.com`;
	createdEmails.push(email);
	return email;
};
const makeUser = async (label: string, role?: Role) => {
	const email = freshEmail(label);
	const agent = await createVerifiedUser(email);
	if (role) {
		await prisma.user.update({ where: { email }, data: { role } });
	}
	const user = await prisma.user.findUniqueOrThrow({ where: { email } });
	createdUserIds.push(user.id);
	return { agent, userId: user.id, email };
};

afterAll(async () => {
	// audit rows are append-only; delete the ones this run produced (by actor or
	// target) BEFORE the users, since actorId is SetNull on user delete.
	await prisma.auditLog.deleteMany({
		where: {
			OR: [{ actorId: { in: createdUserIds } }, { entityId: { in: createdUserIds } }],
		},
	});
	await deletePlatformsByKey(createdKeys);
	await deleteUsersByEmail(createdEmails);
});

const auditCount = (where: { action?: string; entityId?: string; actorId?: string }) =>
	prisma.auditLog.count({ where });

describe("admin-audit: user management gates", () => {
	it("denies a non-admin the admin user list (403)", async () => {
		const { agent } = await makeUser("nonadmin");
		const res = await agent.get("/api/v1/admin/users");
		expect(res.status).toBe(403);
	});

	it("lists users (paginated, no secrets) for an admin", async () => {
		const { agent } = await makeUser("admin-list", Role.ADMIN);
		const res = await agent.get("/api/v1/admin/users?page=1&limit=5");
		expect(res.status).toBe(200);
		expect(res.body.meta).toMatchObject({ page: 1, limit: 5 });
		expect(Array.isArray(res.body.data)).toBe(true);
		const blob = JSON.stringify(res.body);
		expect(blob.toLowerCase()).not.toContain("passwordhash");
		expect(blob).not.toContain("accessToken");
	});
});

describe("admin-audit: block / unblock", () => {
	it("blocks a user (writes audit), prevents their login, then unblocks", async () => {
		const admin = await makeUser("blk-admin", Role.ADMIN);
		const victim = await makeUser("blk-victim");

		const blocked = await admin.agent
			.patch(`/api/v1/admin/users/${victim.userId}/status`)
			.send({ status: "BLOCKED" });
		expect(blocked.status).toBe(200);
		expect(
			await auditCount({ action: "USER_BLOCKED", entityId: victim.userId }),
		).toBeGreaterThanOrEqual(1);

		// blocked user cannot log in
		const login = await request(app)
			.post("/api/v1/auth/login")
			.send({ email: victim.email, password: DEFAULT_TEST_PASSWORD });
		expect(login.status).toBe(403);

		// unblock restores access
		const unblocked = await admin.agent
			.patch(`/api/v1/admin/users/${victim.userId}/status`)
			.send({ status: "ACTIVE" });
		expect(unblocked.status).toBe(200);
		const login2 = await request(app)
			.post("/api/v1/auth/login")
			.send({ email: victim.email, password: DEFAULT_TEST_PASSWORD });
		expect(login2.status).toBe(200);
	});

	it("refuses an admin blocking themselves (self-lockout guard)", async () => {
		const admin = await makeUser("self-blk", Role.ADMIN);
		const res = await admin.agent
			.patch(`/api/v1/admin/users/${admin.userId}/status`)
			.send({ status: "BLOCKED" });
		expect(res.status).toBe(400);
	});
});

describe("admin-audit: role & premium administration", () => {
	it("only a SUPER_ADMIN can change roles", async () => {
		const admin = await makeUser("role-admin", Role.ADMIN);
		const superAdmin = await makeUser("role-super", Role.SUPER_ADMIN);
		const target = await makeUser("role-target");

		const asAdmin = await admin.agent
			.patch(`/api/v1/admin/users/${target.userId}/role`)
			.send({ role: "ADMIN" });
		expect(asAdmin.status).toBe(403);

		const asSuper = await superAdmin.agent
			.patch(`/api/v1/admin/users/${target.userId}/role`)
			.send({ role: "ADMIN" });
		expect(asSuper.status).toBe(200);
		expect(
			await auditCount({ action: "USER_ROLE_CHANGED", entityId: target.userId }),
		).toBeGreaterThanOrEqual(1);

		const updated = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
		expect(updated.role).toBe("ADMIN");
	});

	it("grants premium without a payment (writes audit)", async () => {
		const admin = await makeUser("prem-admin", Role.ADMIN);
		const target = await makeUser("prem-target");
		expect((await prisma.user.findUniqueOrThrow({ where: { id: target.userId } })).isPremium).toBe(
			false,
		);

		const res = await admin.agent
			.patch(`/api/v1/admin/users/${target.userId}/premium`)
			.send({ isPremium: true });
		expect(res.status).toBe(200);

		const after = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
		expect(after.isPremium).toBe(true);
		expect(after.premiumSince).not.toBeNull();
		expect(
			await auditCount({ entityId: target.userId, action: "USER_PREMIUM_GRANTED" }),
		).toBeGreaterThanOrEqual(1);
	});
});

describe("admin-audit: audit viewer & cross-flow wiring", () => {
	it("lists and filters the audit trail (admin only)", async () => {
		const admin = await makeUser("audit-admin", Role.ADMIN);
		const target = await makeUser("audit-target");
		await admin.agent
			.patch(`/api/v1/admin/users/${target.userId}/premium`)
			.send({ isPremium: true });

		const nonAdmin = await makeUser("audit-nonadmin");
		expect((await nonAdmin.agent.get("/api/v1/admin/audit-logs")).status).toBe(403);

		const res = await admin.agent.get("/api/v1/admin/audit-logs?action=USER_PREMIUM_GRANTED");
		expect(res.status).toBe(200);
		expect(res.body.data.length).toBeGreaterThanOrEqual(1);
		for (const entry of res.body.data) {
			expect(entry.action).toBe("USER_PREMIUM_GRANTED");
		}
	});

	it("audits a sensitive cross-flow action (connection disconnect)", async () => {
		const { agent, userId } = await makeUser("disc");
		// a LIVE platform + a seeded connection to disconnect
		const key = `e2e-admin-plat-${runId}`;
		createdKeys.push(key);
		const platform = await prisma.platform.create({
			data: { key, name: "Admin Audit Platform", status: "LIVE", isActive: true },
		});
		await ConnectionService.storeConnection(userId, platform.id, {
			platformAccountId: "acct-disc",
			platformAccountName: "Disc Account",
			accessToken: "token-to-remove",
		});

		const res = await agent.delete(`/api/v1/connections/${key}`);
		expect(res.status).toBe(200);
		expect(
			await auditCount({ action: "CONNECTION_DISCONNECTED", actorId: userId }),
		).toBeGreaterThanOrEqual(1);
	});
});
