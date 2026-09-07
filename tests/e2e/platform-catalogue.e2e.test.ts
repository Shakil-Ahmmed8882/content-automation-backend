import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/app";
import config from "../../src/app/config";
import { prisma } from "../../src/app/lib/prisma";
import { PlatformStatus } from "../../src/generated/prisma/enums";
import { createAdminUser, createVerifiedUser } from "../helpers/authUser";
import { deletePlatformsByKey, deleteUsersByEmail } from "../helpers/db";
import { resetAuthRateLimit } from "../helpers/rateLimiter";

beforeEach(resetAuthRateLimit);

// One run id so repeated test runs never collide with each other or with the
// seeded `linkedin`/`facebook` rows (see src/app/utils/seed.ts).
const runId = Date.now();
const createdEmails: string[] = [];
const createdKeys: string[] = [];

const freshEmail = (label: string) => {
	const email = `e2e-platform-${runId}-${label}-${createdEmails.length}@example.com`;
	createdEmails.push(email);
	return email;
};

const freshKey = (label: string) => {
	const key = `e2e-plat-${runId}-${label}-${createdKeys.length}`;
	createdKeys.push(key);
	return key;
};

afterAll(async () => {
	await deletePlatformsByKey(createdKeys);
	await deleteUsersByEmail(createdEmails);
});

// Avatar/logo upload genuinely calls Cloudinary — this repo's .env has no
// real account configured yet (placeholders). See docs/decisions.md.
const hasCloudinaryCreds = Boolean(
	config.cloudinary_cloud_name && config.cloudinary_api_key && config.cloudinary_api_secret,
);

const ONE_PX_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

describe("platform-catalogue: admin create", () => {
	it("rejects an unauthenticated request", async () => {
		const res = await request(app)
			.post("/api/v1/admin/platforms")
			.send({ key: freshKey("unauth"), name: "Unauth Platform" });
		expect(res.status).toBe(401);
	});

	it("rejects a non-admin user", async () => {
		const agent = await createVerifiedUser(freshEmail("non-admin-create"));
		const res = await agent
			.post("/api/v1/admin/platforms")
			.send({ key: freshKey("non-admin"), name: "Non-Admin Platform" });
		expect(res.status).toBe(403);
	});

	it("creates a platform and returns it", async () => {
		const admin = await createAdminUser(freshEmail("create-ok"));
		const key = freshKey("create-ok");

		const res = await admin.post("/api/v1/admin/platforms").send({ key, name: "Instagram" });

		expect(res.status).toBe(201);
		expect(res.body.data.key).toBe(key);
		expect(res.body.data.name).toBe("Instagram");
		expect(res.body.data.status).toBe(PlatformStatus.COMING_SOON);
		expect(res.body.data.isActive).toBe(true);
	});

	it("rejects a duplicate key", async () => {
		const admin = await createAdminUser(freshEmail("create-dup"));
		const key = freshKey("dup");

		const first = await admin.post("/api/v1/admin/platforms").send({ key, name: "First" });
		expect(first.status).toBe(201);

		const second = await admin.post("/api/v1/admin/platforms").send({ key, name: "Second" });
		expect(second.status).toBe(409);
	});
});

describe("platform-catalogue: admin list & get", () => {
	it("lists every platform, including inactive ones", async () => {
		const admin = await createAdminUser(freshEmail("list-all"));
		const key = freshKey("list-inactive");

		await admin.post("/api/v1/admin/platforms").send({ key, name: "Retired-ish", isActive: false });

		const res = await admin.get("/api/v1/admin/platforms");
		expect(res.status).toBe(200);
		expect(res.body.data.some((p: { key: string }) => p.key === key)).toBe(true);
	});

	it("gets a single platform by id", async () => {
		const admin = await createAdminUser(freshEmail("get-one"));
		const key = freshKey("get-one");

		const created = await admin.post("/api/v1/admin/platforms").send({ key, name: "Get Me" });

		const res = await admin.get(`/api/v1/admin/platforms/${created.body.data.id}`);
		expect(res.status).toBe(200);
		expect(res.body.data.key).toBe(key);
	});

	it("rejects a non-admin user", async () => {
		const agent = await createVerifiedUser(freshEmail("non-admin-list"));
		const res = await agent.get("/api/v1/admin/platforms");
		expect(res.status).toBe(403);
	});
});

describe("platform-catalogue: admin update", () => {
	it("persists name/status/sortOrder/isActive changes", async () => {
		const admin = await createAdminUser(freshEmail("update-ok"));
		const key = freshKey("update-ok");
		const created = await admin.post("/api/v1/admin/platforms").send({ key, name: "Before" });

		const res = await admin.patch(`/api/v1/admin/platforms/${created.body.data.id}`).send({
			name: "After",
			status: PlatformStatus.LIVE,
			sortOrder: 5,
			isActive: false,
		});

		expect(res.status).toBe(200);
		expect(res.body.data.name).toBe("After");
		expect(res.body.data.status).toBe(PlatformStatus.LIVE);
		expect(res.body.data.sortOrder).toBe(5);
		expect(res.body.data.isActive).toBe(false);

		const persisted = await prisma.platform.findUnique({ where: { id: created.body.data.id } });
		expect(persisted?.name).toBe("After");
	});

	it("rejects a non-admin user", async () => {
		const admin = await createAdminUser(freshEmail("update-target"));
		const key = freshKey("update-target");
		const created = await admin.post("/api/v1/admin/platforms").send({ key, name: "Target" });

		const nonAdmin = await createVerifiedUser(freshEmail("non-admin-update"));
		const res = await nonAdmin
			.patch(`/api/v1/admin/platforms/${created.body.data.id}`)
			.send({ name: "Hijacked" });

		expect(res.status).toBe(403);
	});
});

describe("platform-catalogue: logo", () => {
	it("rejects a non-image file without touching Cloudinary", async () => {
		const admin = await createAdminUser(freshEmail("bad-logo"));
		const key = freshKey("bad-logo");
		const created = await admin.post("/api/v1/admin/platforms").send({ key, name: "Bad Logo" });

		const res = await admin
			.patch(`/api/v1/admin/platforms/${created.body.data.id}/logo`)
			.attach("logo", Buffer.from("not an image"), {
				filename: "not-an-image.txt",
				contentType: "text/plain",
			});

		expect(res.status).toBe(400);

		const platform = await prisma.platform.findUnique({ where: { id: created.body.data.id } });
		expect(platform?.logoUrl).toBeNull();
	});
});

describe.skipIf(!hasCloudinaryCreds)("platform-catalogue: logo (live Cloudinary)", () => {
	it("uploads a logo, then replaces it and deletes the old asset", async () => {
		const admin = await createAdminUser(freshEmail("logo-replace"));
		const key = freshKey("logo-replace");
		const created = await admin.post("/api/v1/admin/platforms").send({ key, name: "Logo Co" });

		const first = await admin
			.patch(`/api/v1/admin/platforms/${created.body.data.id}/logo`)
			.attach("logo", ONE_PX_PNG, { filename: "logo1.png", contentType: "image/png" });
		expect(first.status).toBe(200);
		expect(first.body.data.logoUrl).toEqual(expect.any(String));
		const firstPublicId = first.body.data.logoPublicId;

		const second = await admin
			.patch(`/api/v1/admin/platforms/${created.body.data.id}/logo`)
			.attach("logo", ONE_PX_PNG, { filename: "logo2.png", contentType: "image/png" });
		expect(second.status).toBe(200);
		expect(second.body.data.logoPublicId).not.toBe(firstPublicId);
	});
});

describe("platform-catalogue: retire", () => {
	it("hides a retired platform from the active list but keeps the record", async () => {
		const admin = await createAdminUser(freshEmail("retire"));
		const key = freshKey("retire");
		const created = await admin
			.post("/api/v1/admin/platforms")
			.send({ key, name: "Retire Me", status: PlatformStatus.LIVE });

		const beforeRetire = await admin.get("/api/v1/platforms");
		expect(beforeRetire.body.data.some((p: { key: string }) => p.key === key)).toBe(true);

		const retireRes = await admin
			.patch(`/api/v1/admin/platforms/${created.body.data.id}`)
			.send({ isActive: false });
		expect(retireRes.status).toBe(200);

		const afterRetire = await admin.get("/api/v1/platforms");
		expect(afterRetire.body.data.some((p: { key: string }) => p.key === key)).toBe(false);

		const record = await prisma.platform.findUnique({ where: { id: created.body.data.id } });
		expect(record).not.toBeNull();
	});
});

describe("platform-catalogue: public active list", () => {
	it("rejects an unauthenticated request", async () => {
		const res = await request(app).get("/api/v1/platforms");
		expect(res.status).toBe(401);
	});

	it("returns only active platforms ordered by sortOrder", async () => {
		const admin = await createAdminUser(freshEmail("active-list"));
		const lowKey = freshKey("order-low");
		const highKey = freshKey("order-high");
		const inactiveKey = freshKey("order-inactive");

		await admin
			.post("/api/v1/admin/platforms")
			.send({ key: highKey, name: "High Sort", status: PlatformStatus.LIVE, sortOrder: 100 });
		await admin
			.post("/api/v1/admin/platforms")
			.send({ key: lowKey, name: "Low Sort", status: PlatformStatus.LIVE, sortOrder: 1 });
		await admin.post("/api/v1/admin/platforms").send({
			key: inactiveKey,
			name: "Inactive",
			status: PlatformStatus.LIVE,
			isActive: false,
		});

		const user = await createVerifiedUser(freshEmail("active-list-viewer"));
		const res = await user.get("/api/v1/platforms");

		expect(res.status).toBe(200);
		const keys: string[] = res.body.data.map((p: { key: string }) => p.key);
		expect(keys).not.toContain(inactiveKey);
		expect(keys.indexOf(lowKey)).toBeLessThan(keys.indexOf(highKey));
	});
});
