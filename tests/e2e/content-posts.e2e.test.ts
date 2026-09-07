import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/app";
import config from "../../src/app/config";
import { prisma } from "../../src/app/lib/prisma";
import { createVerifiedUser } from "../helpers/authUser";
import { deleteUsersByEmail } from "../helpers/db";
import { resetAuthRateLimit } from "../helpers/rateLimiter";

beforeEach(resetAuthRateLimit);

const runId = Date.now();
const createdEmails: string[] = [];

const freshEmail = (label: string) => {
	const email = `e2e-post-${runId}-${label}-${createdEmails.length}@example.com`;
	createdEmails.push(email);
	return email;
};

// Post image upload genuinely calls Cloudinary — this repo's .env has empty
// CLOUDINARY_* values, so the with-image scenario is auto-skipped until real
// credentials exist (same posture as user-profile avatars). The "reject a
// non-image file" case always runs since multer rejects it before any
// Cloudinary call.
const hasCloudinaryCreds = Boolean(
	config.cloudinary_cloud_name && config.cloudinary_api_key && config.cloudinary_api_secret,
);

const ONE_PX_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

afterAll(async () => {
	// Posts cascade-delete with their owning user (FK onDelete: Cascade).
	await deleteUsersByEmail(createdEmails);
});

describe("content-posts: create", () => {
	it("rejects an unauthenticated request", async () => {
		const res = await request(app).post("/api/v1/posts").send({ content: "hello" });
		expect(res.status).toBe(401);
	});

	it("creates a post with content and no image", async () => {
		const agent = await createVerifiedUser(freshEmail("create-no-image"));

		const res = await agent
			.post("/api/v1/posts")
			.send({ title: "My Title", content: "Hello world content" });

		expect(res.status).toBe(201);
		expect(res.body.data.content).toBe("Hello world content");
		expect(res.body.data.title).toBe("My Title");
		expect(res.body.data.imageUrl).toBeNull();
		expect(res.body.data.isDeleted).toBe(false);
	});

	it("creates a post without a title", async () => {
		const agent = await createVerifiedUser(freshEmail("create-no-title"));

		const res = await agent.post("/api/v1/posts").send({ content: "Just content" });

		expect(res.status).toBe(201);
		expect(res.body.data.title).toBeNull();
	});

	it("rejects empty content", async () => {
		const agent = await createVerifiedUser(freshEmail("create-empty"));
		const res = await agent.post("/api/v1/posts").send({ content: "" });
		expect(res.status).toBe(400);
	});

	it("rejects whitespace-only content", async () => {
		const agent = await createVerifiedUser(freshEmail("create-whitespace"));
		const res = await agent.post("/api/v1/posts").send({ content: "   " });
		expect(res.status).toBe(400);
	});

	it("rejects a non-image file and creates no post", async () => {
		const email = freshEmail("create-bad-image");
		const agent = await createVerifiedUser(email);

		const res = await agent
			.post("/api/v1/posts")
			.field("content", "Post with a bad file")
			.attach("image", Buffer.from("not an image"), {
				filename: "not-an-image.txt",
				contentType: "text/plain",
			});

		expect(res.status).toBe(400);

		const user = await prisma.user.findUniqueOrThrow({ where: { email } });
		const count = await prisma.post.count({ where: { userId: user.id } });
		expect(count).toBe(0);
	});
});

describe.skipIf(!hasCloudinaryCreds)("content-posts: create with image (live Cloudinary)", () => {
	it("creates a post and stores the image URL + storage id", async () => {
		const agent = await createVerifiedUser(freshEmail("create-image"));

		const res = await agent
			.post("/api/v1/posts")
			.field("content", "Post with image")
			.attach("image", ONE_PX_PNG, { filename: "post.png", contentType: "image/png" });

		expect(res.status).toBe(201);
		expect(res.body.data.imageUrl).toEqual(expect.any(String));
		expect(res.body.data.imagePublicId).toEqual(expect.any(String));
	});
});

describe("content-posts: list", () => {
	it("returns only the caller's non-deleted posts with pagination meta", async () => {
		const agent = await createVerifiedUser(freshEmail("list-basic"));
		await agent.post("/api/v1/posts").send({ content: "post one" });
		await agent.post("/api/v1/posts").send({ content: "post two" });
		await agent.post("/api/v1/posts").send({ content: "post three" });

		const res = await agent.get("/api/v1/posts?page=1&limit=2");

		expect(res.status).toBe(200);
		expect(res.body.data).toHaveLength(2);
		expect(res.body.meta.total).toBe(3);
		expect(res.body.meta.page).toBe(1);
		expect(res.body.meta.limit).toBe(2);
		expect(res.body.meta.totalPages).toBe(2);
	});

	it("searches over content and title", async () => {
		const agent = await createVerifiedUser(freshEmail("list-search"));
		await agent.post("/api/v1/posts").send({ content: "unicorns are magical" });
		await agent.post("/api/v1/posts").send({ content: "dragons breathe fire" });

		const res = await agent.get("/api/v1/posts?search=unicorn");

		expect(res.status).toBe(200);
		expect(res.body.data).toHaveLength(1);
		expect(res.body.data[0].content).toBe("unicorns are magical");
	});

	it("excludes soft-deleted posts from the list", async () => {
		const agent = await createVerifiedUser(freshEmail("list-deleted"));
		const created = await agent.post("/api/v1/posts").send({ content: "to be deleted" });
		await agent.post("/api/v1/posts").send({ content: "to keep" });

		await agent.delete(`/api/v1/posts/${created.body.data.id}`);

		const res = await agent.get("/api/v1/posts");
		expect(res.body.meta.total).toBe(1);
		expect(res.body.data[0].content).toBe("to keep");
	});

	it("never returns another user's posts", async () => {
		const owner = await createVerifiedUser(freshEmail("list-owner"));
		const other = await createVerifiedUser(freshEmail("list-other"));
		await owner.post("/api/v1/posts").send({ content: "owner's secret post" });

		const res = await other.get("/api/v1/posts");
		expect(res.status).toBe(200);
		expect(res.body.data).toHaveLength(0);
		expect(res.body.meta.total).toBe(0);
	});
});

describe("content-posts: get one", () => {
	it("returns a post the caller owns", async () => {
		const agent = await createVerifiedUser(freshEmail("get-owned"));
		const created = await agent.post("/api/v1/posts").send({ content: "my post" });

		const res = await agent.get(`/api/v1/posts/${created.body.data.id}`);
		expect(res.status).toBe(200);
		expect(res.body.data.id).toBe(created.body.data.id);
	});

	it("reveals nothing for a post the caller does not own (404)", async () => {
		const owner = await createVerifiedUser(freshEmail("get-owner"));
		const other = await createVerifiedUser(freshEmail("get-other"));
		const created = await owner.post("/api/v1/posts").send({ content: "not yours" });

		const res = await other.get(`/api/v1/posts/${created.body.data.id}`);
		expect(res.status).toBe(404);
	});

	it("returns 404 for a soft-deleted post", async () => {
		const agent = await createVerifiedUser(freshEmail("get-deleted"));
		const created = await agent.post("/api/v1/posts").send({ content: "gone soon" });
		await agent.delete(`/api/v1/posts/${created.body.data.id}`);

		const res = await agent.get(`/api/v1/posts/${created.body.data.id}`);
		expect(res.status).toBe(404);
	});
});

describe("content-posts: delete (soft)", () => {
	it("soft-deletes the post but retains the record", async () => {
		const email = freshEmail("delete");
		const agent = await createVerifiedUser(email);
		const created = await agent.post("/api/v1/posts").send({ content: "delete me" });

		const res = await agent.delete(`/api/v1/posts/${created.body.data.id}`);
		expect(res.status).toBe(200);

		const row = await prisma.post.findUnique({ where: { id: created.body.data.id } });
		expect(row).not.toBeNull();
		expect(row?.isDeleted).toBe(true);
		expect(row?.deletedAt).not.toBeNull();
	});

	it("never lets one user delete another user's post", async () => {
		const owner = await createVerifiedUser(freshEmail("del-owner"));
		const other = await createVerifiedUser(freshEmail("del-other"));
		const created = await owner.post("/api/v1/posts").send({ content: "owner's post" });

		const res = await other.delete(`/api/v1/posts/${created.body.data.id}`);
		expect(res.status).toBe(404);

		const row = await prisma.post.findUnique({ where: { id: created.body.data.id } });
		expect(row?.isDeleted).toBe(false);
	});
});

describe("content-posts: immutability", () => {
	it("exposes no edit endpoint for a post", async () => {
		const agent = await createVerifiedUser(freshEmail("immutable"));
		const created = await agent.post("/api/v1/posts").send({ content: "original" });

		const patch = await agent
			.patch(`/api/v1/posts/${created.body.data.id}`)
			.send({ content: "changed" });
		const put = await agent
			.put(`/api/v1/posts/${created.body.data.id}`)
			.send({ content: "changed" });

		expect(patch.status).toBe(404);
		expect(put.status).toBe(404);
	});
});
