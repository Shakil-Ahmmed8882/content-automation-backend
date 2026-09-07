import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/app";
import { prisma } from "../../src/app/lib/prisma";
import { bullConnection, publishQueue } from "../../src/app/lib/queue";
import { ConnectionService } from "../../src/app/module/connection/connection.service";
import {
	startPublishWorker,
	stopPublishWorker,
} from "../../src/app/module/execution/execution.worker";
import { registerPublisher } from "../../src/app/module/execution/publishers";
import { ExecutionStatus, PlatformStatus } from "../../src/generated/prisma/enums";
import { createVerifiedUser } from "../helpers/authUser";
import { deletePlatformsByKey, deleteUsersByEmail } from "../helpers/db";
import { resetAuthRateLimit } from "../helpers/rateLimiter";

beforeEach(resetAuthRateLimit);

const runId = Date.now();
const createdEmails: string[] = [];
const createdUserIds: string[] = [];
const createdKeys: string[] = [];

const OK_KEY = `e2e-hist-ok-${runId}`;
const FAIL_KEY = `e2e-hist-fail-${runId}`;
const SECRET_TOKEN = "SUPER-SECRET-HIST-TOKEN-do-not-leak";
const FAIL_REASON = "history failure (test)";

registerPublisher({
	key: OK_KEY,
	publish: async () => ({
		externalPostId: `ext-ok-${runId}`,
		externalPostUrl: "https://example.test/ok",
	}),
});
registerPublisher({
	key: FAIL_KEY,
	publish: async () => {
		throw new Error(FAIL_REASON);
	},
});

const freshEmail = (label: string) => {
	const email = `e2e-hist-${runId}-${label}-${createdEmails.length}@example.com`;
	createdEmails.push(email);
	return email;
};
const makeUser = async (label: string) => {
	const email = freshEmail(label);
	const agent = await createVerifiedUser(email);
	const user = await prisma.user.findUniqueOrThrow({ where: { email } });
	createdUserIds.push(user.id);
	return { agent, userId: user.id };
};
const createLivePlatform = (key: string, name: string) =>
	prisma.platform.create({ data: { key, name, status: PlatformStatus.LIVE, isActive: true } });
const seedConnection = (userId: string, platformId: string, accountName: string) =>
	ConnectionService.storeConnection(userId, platformId, {
		platformAccountId: `acct-${accountName}`,
		platformAccountName: accountName,
		accessToken: SECRET_TOKEN,
	});
const createPost = async (
	agent: ReturnType<typeof request.agent>,
	content: string,
	title?: string,
) => {
	const res = await agent.post("/api/v1/posts").send({ content, title });
	return res.body.data.id as string;
};
const pollUntil = async (predicate: () => Promise<boolean>, timeoutMs = 10_000) => {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await predicate()) return;
		if (Date.now() > deadline) throw new Error(`Condition not met within ${timeoutMs}ms`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};
const executionStatus = async (id: string) =>
	(await prisma.execution.findUniqueOrThrow({ where: { id } })).status;

let okPlatformId = "";
let failPlatformId = "";

const publishAndSettle = async (
	agent: ReturnType<typeof request.agent>,
	postId: string,
	keys: string[],
	expected: ExecutionStatus,
) => {
	const res = await agent.post(`/api/v1/posts/${postId}/publish`).send({ platforms: keys });
	const executionId = res.body.data.executionId as string;
	await pollUntil(async () => (await executionStatus(executionId)) === expected);
	return executionId;
};

beforeAll(async () => {
	const [ok, fail] = await Promise.all([
		createLivePlatform(OK_KEY, "Hist OK Platform"),
		createLivePlatform(FAIL_KEY, "Hist Fail Platform"),
	]);
	createdKeys.push(OK_KEY, FAIL_KEY);
	okPlatformId = ok.id;
	failPlatformId = fail.id;
	startPublishWorker();
});

afterAll(async () => {
	await stopPublishWorker();
	await prisma.execution.deleteMany({ where: { userId: { in: createdUserIds } } });
	await deleteUsersByEmail(createdEmails);
	await deletePlatformsByKey(createdKeys);
	await publishQueue.close();
	await bullConnection.quit();
});

describe("execution-history: list", () => {
	it("rejects an unauthenticated request", async () => {
		const res = await request(app).get("/api/v1/executions");
		expect(res.status).toBe(401);
	});

	it("returns only the caller's executions with pagination meta and row shape", async () => {
		const { agent, userId } = await makeUser("list-mine");
		await seedConnection(userId, okPlatformId, "Mine OK");
		const postId = await createPost(agent, "history content one", "My Title");
		await publishAndSettle(agent, postId, [OK_KEY], ExecutionStatus.COMPLETED);

		// another user's execution must not appear
		const other = await makeUser("list-other");
		await seedConnection(other.userId, okPlatformId, "Other OK");
		const otherPost = await createPost(other.agent, "other user content");
		await publishAndSettle(other.agent, otherPost, [OK_KEY], ExecutionStatus.COMPLETED);

		const res = await agent.get("/api/v1/executions?page=1&limit=10");
		expect(res.status).toBe(200);
		expect(res.body.meta).toMatchObject({ page: 1, limit: 10 });
		expect(res.body.data.length).toBeGreaterThanOrEqual(1);
		for (const row of res.body.data) {
			expect(row).toHaveProperty("status");
			expect(row.post).toHaveProperty("contentPreview");
			expect(Array.isArray(row.platforms)).toBe(true);
		}
		const contents = res.body.data.map(
			(r: { post: { contentPreview: string } }) => r.post.contentPreview,
		);
		expect(contents).not.toContain("other user content");
	});

	it("filters by status", async () => {
		const { agent, userId } = await makeUser("list-filter");
		await seedConnection(userId, okPlatformId, "Filter OK");
		await seedConnection(userId, failPlatformId, "Filter Fail");
		const completedPost = await createPost(agent, "completed run");
		await publishAndSettle(agent, completedPost, [OK_KEY], ExecutionStatus.COMPLETED);
		const partialPost = await createPost(agent, "partial run");
		await publishAndSettle(
			agent,
			partialPost,
			[OK_KEY, FAIL_KEY],
			ExecutionStatus.PARTIALLY_COMPLETED,
		);

		const res = await agent.get("/api/v1/executions?status=PARTIALLY_COMPLETED");
		expect(res.status).toBe(200);
		expect(res.body.data.length).toBeGreaterThanOrEqual(1);
		for (const row of res.body.data) {
			expect(row.status).toBe("PARTIALLY_COMPLETED");
		}
	});
});

describe("execution-history: detail", () => {
	it("shows per-platform results and identifies the failed (retryable) platform", async () => {
		const { agent, userId } = await makeUser("detail");
		await seedConnection(userId, okPlatformId, "Detail OK");
		await seedConnection(userId, failPlatformId, "Detail Fail");
		const postId = await createPost(agent, "detail content", "Detail Title");
		const executionId = await publishAndSettle(
			agent,
			postId,
			[OK_KEY, FAIL_KEY],
			ExecutionStatus.PARTIALLY_COMPLETED,
		);

		const res = await agent.get(`/api/v1/executions/${executionId}`);
		expect(res.status).toBe(200);
		expect(res.body.data.post.content).toBe("detail content");
		expect(res.body.data.publications).toHaveLength(2);

		const byKey = Object.fromEntries(
			res.body.data.publications.map((p: { platform: { key: string } }) => [p.platform.key, p]),
		);
		expect(byKey[OK_KEY].status).toBe("SUCCESS");
		expect(byKey[OK_KEY].externalPostUrl).toBe("https://example.test/ok");
		expect(byKey[OK_KEY].retryable).toBe(false);
		expect(byKey[FAIL_KEY].status).toBe("FAILED");
		expect(byKey[FAIL_KEY].retryable).toBe(true);
		expect(byKey[FAIL_KEY].failureReason).toBe(FAIL_REASON);
	});

	it("still shows the content after the post was soft-deleted", async () => {
		const { agent, userId } = await makeUser("detail-deleted");
		await seedConnection(userId, okPlatformId, "Del OK");
		const postId = await createPost(agent, "content that outlives its post");
		const executionId = await publishAndSettle(agent, postId, [OK_KEY], ExecutionStatus.COMPLETED);

		await agent.delete(`/api/v1/posts/${postId}`); // soft-delete

		const res = await agent.get(`/api/v1/executions/${executionId}`);
		expect(res.status).toBe(200);
		expect(res.body.data.post.content).toBe("content that outlives its post");
		expect(res.body.data.post.isDeleted).toBe(true);
	});

	it("refuses another user's execution (404) and leaks no token", async () => {
		const owner = await makeUser("detail-owner");
		const other = await makeUser("detail-intruder");
		await seedConnection(owner.userId, failPlatformId, "Owner Fail");
		const postId = await createPost(owner.agent, "owner detail");
		const executionId = await publishAndSettle(
			owner.agent,
			postId,
			[FAIL_KEY],
			ExecutionStatus.FAILED,
		);

		const refused = await other.agent.get(`/api/v1/executions/${executionId}`);
		expect(refused.status).toBe(404);

		const owned = await owner.agent.get(`/api/v1/executions/${executionId}`);
		expect(JSON.stringify(owned.body)).not.toContain(SECRET_TOKEN);
	});
});
