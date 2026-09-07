import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/app";
import { prisma } from "../../src/app/lib/prisma";
import { createAdminUser, createVerifiedUser } from "../helpers/authUser";
import { deleteUsersByEmail } from "../helpers/db";
import { resetAuthRateLimit } from "../helpers/rateLimiter";

beforeEach(resetAuthRateLimit);

const runId = Date.now();
const createdEmails: string[] = [];
const createdSlugs: string[] = [];

const freshEmail = (label: string) => {
	const email = `e2e-upf-${runId}-${label}-${createdEmails.length}@example.com`;
	createdEmails.push(email);
	return email;
};
const freshSlug = (label: string) => {
	const slug = `e2e-upf-${runId}-${label}-${createdSlugs.length}`;
	createdSlugs.push(slug);
	return slug;
};
const premiumUser = async (label: string) => {
	const email = freshEmail(label);
	const agent = await createVerifiedUser(email);
	await prisma.user.update({
		where: { email },
		data: { isPremium: true, premiumSince: new Date() },
	});
	return agent;
};

const makeFeature = (slug: string, sortOrder: number) => ({
	slug,
	title: `Feature ${slug}`,
	shortDescription: "short",
	description: "the long description",
	status: "COMING_SOON",
	sortOrder,
	isPremiumVisible: true,
});

afterAll(async () => {
	await prisma.upcomingFeature.deleteMany({ where: { slug: { in: createdSlugs } } });
	await deleteUsersByEmail(createdEmails);
});

describe("upcoming-features: admin CRUD", () => {
	it("blocks a non-admin from creating (403)", async () => {
		const user = await createVerifiedUser(freshEmail("nonadmin"));
		const res = await user
			.post("/api/v1/admin/upcoming-features")
			.send(makeFeature(freshSlug("x"), 1));
		expect(res.status).toBe(403);
	});

	it("creates, rejects a duplicate slug, lists (incl. hidden), updates, and deletes", async () => {
		const admin = await createAdminUser(freshEmail("admin"));
		const slug = freshSlug("crud");

		const created = await admin.post("/api/v1/admin/upcoming-features").send(makeFeature(slug, 5));
		expect(created.status).toBe(201);
		expect(created.body.data.slug).toBe(slug);
		const id = created.body.data.id;

		// duplicate slug
		const dup = await admin.post("/api/v1/admin/upcoming-features").send(makeFeature(slug, 6));
		expect(dup.status).toBe(409);

		// list all (admin sees everything)
		const list = await admin.get("/api/v1/admin/upcoming-features");
		expect(list.status).toBe(200);
		expect(list.body.data.some((f: { id: string }) => f.id === id)).toBe(true);

		// get one
		const one = await admin.get(`/api/v1/admin/upcoming-features/${id}`);
		expect(one.status).toBe(200);

		// update
		const updated = await admin
			.patch(`/api/v1/admin/upcoming-features/${id}`)
			.send({ title: "Renamed Feature" });
		expect(updated.status).toBe(200);
		expect(updated.body.data.title).toBe("Renamed Feature");

		// delete (hard)
		const removed = await admin.delete(`/api/v1/admin/upcoming-features/${id}`);
		expect(removed.status).toBe(200);
		const gone = await admin.get(`/api/v1/admin/upcoming-features/${id}`);
		expect(gone.status).toBe(404);
	});
});

describe("upcoming-features: premium browsing", () => {
	it("lets a premium user list features ordered by sortOrder and get one by slug", async () => {
		const admin = await createAdminUser(freshEmail("admin2"));
		const slugA = freshSlug("a");
		const slugB = freshSlug("b");
		// create out of order; expect the list sorted by sortOrder
		await admin.post("/api/v1/admin/upcoming-features").send(makeFeature(slugB, 20));
		await admin.post("/api/v1/admin/upcoming-features").send(makeFeature(slugA, 10));

		const premium = await premiumUser("premium");
		const list = await premium.get("/api/v1/upcoming-features");
		expect(list.status).toBe(200);
		const mine = list.body.data.filter((f: { slug: string }) => [slugA, slugB].includes(f.slug));
		expect(mine.map((f: { slug: string }) => f.slug)).toEqual([slugA, slugB]); // sortOrder 10 before 20

		const detail = await premium.get(`/api/v1/upcoming-features/${slugA}`);
		expect(detail.status).toBe(200);
		expect(detail.body.data.slug).toBe(slugA);
		expect(detail.body.data.description).toBe("the long description");
	});

	it("denies a non-premium user (403) — gate reads the DB flag, not a client value", async () => {
		const user = await createVerifiedUser(freshEmail("free"));
		const res = await user.get("/api/v1/upcoming-features");
		expect(res.status).toBe(403);

		// even claiming premium in the body/headers changes nothing
		const spoof = await user
			.get("/api/v1/upcoming-features")
			.set("x-is-premium", "true")
			.send({ isPremium: true });
		expect(spoof.status).toBe(403);
	});
});
