import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../../src/app";
import { prisma } from "../../src/app/lib/prisma";
import { bullConnection, publishQueue } from "../../src/app/lib/queue";
import { ConnectionService } from "../../src/app/module/connection/connection.service";
import {
	runExecution,
	startPublishWorker,
	stopPublishWorker,
} from "../../src/app/module/execution/execution.worker";
import { getPublisher, registerPublisher } from "../../src/app/module/execution/publishers";
import { ExecutionStatus, PlatformStatus } from "../../src/generated/prisma/enums";
import { createVerifiedUser } from "../helpers/authUser";
import { deletePlatformsByKey, deleteUsersByEmail } from "../helpers/db";
import { resetAuthRateLimit } from "../helpers/rateLimiter";

beforeEach(resetAuthRateLimit);

const runId = Date.now();
const createdEmails: string[] = [];
const createdUserIds: string[] = [];
const createdKeys: string[] = [];

// A real provider (LinkedIn/Facebook) can't be hit in an automated run, so we
// register deterministic publishers onto throwaway LIVE platforms via the same
// registry the real ones use — that's the seam registerPublisher exists for. The
// worker dispatches on platform.key and finds these exactly like the real pair.
const OK_KEY = `e2e-pub-ok-${runId}`;
const FAIL_KEY = `e2e-pub-fail-${runId}`;
const SECRET_TOKEN = "SUPER-SECRET-TOKEN-do-not-leak-xyz";
const FAIL_REASON = "forced platform failure (test)";

registerPublisher({
	key: OK_KEY,
	publish: async () => ({
		externalPostId: `ext-ok-${runId}`,
		externalPostUrl: "https://example.test/posts/ok",
	}),
});
registerPublisher({
	key: FAIL_KEY,
	publish: async () => {
		throw new Error(FAIL_REASON);
	},
});

const freshEmail = (label: string) => {
	const email = `e2e-pub-${runId}-${label}-${createdEmails.length}@example.com`;
	createdEmails.push(email);
	return email;
};

/** A logged-in agent plus that user's id (needed to seed connections directly). */
const makeUser = async (label: string) => {
	const email = freshEmail(label);
	const agent = await createVerifiedUser(email);
	const user = await prisma.user.findUniqueOrThrow({ where: { email } });
	createdUserIds.push(user.id);
	return { agent, userId: user.id };
};

const createLivePlatform = (key: string, name: string) =>
	prisma.platform.create({
		data: { key, name, status: PlatformStatus.LIVE, isActive: true },
	});

/** Seed a connection for a user on a platform (no live OAuth) with a known token
 * so we can prove the token never surfaces in a stored failure reason. */
const seedConnection = (userId: string, platformId: string, accountName: string) =>
	ConnectionService.storeConnection(userId, platformId, {
		platformAccountId: `acct-${accountName}`,
		platformAccountName: accountName,
		accessToken: SECRET_TOKEN,
	});

const createPost = async (agent: ReturnType<typeof request.agent>, content: string) => {
	const res = await agent.post("/api/v1/posts").send({ content });
	return res.body.data.id as string;
};

const TERMINAL = new Set<ExecutionStatus>([
	ExecutionStatus.COMPLETED,
	ExecutionStatus.PARTIALLY_COMPLETED,
	ExecutionStatus.FAILED,
]);

/** Poll until the execution reaches a terminal status (the worker runs async). */
const waitForExecution = async (executionId: string, timeoutMs = 10_000) => {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const execution = await prisma.execution.findUniqueOrThrow({ where: { id: executionId } });
		if (TERMINAL.has(execution.status)) {
			return execution;
		}
		if (Date.now() > deadline) {
			throw new Error(
				`Execution ${executionId} did not finish in ${timeoutMs}ms (status ${execution.status})`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

let okPlatformId = "";
let failPlatformId = "";

beforeAll(async () => {
	const [ok, fail] = await Promise.all([
		createLivePlatform(OK_KEY, "E2E OK Platform"),
		createLivePlatform(FAIL_KEY, "E2E Fail Platform"),
	]);
	createdKeys.push(OK_KEY, FAIL_KEY);
	okPlatformId = ok.id;
	failPlatformId = fail.id;
	startPublishWorker();
});

afterAll(async () => {
	await stopPublishWorker();
	// executions must go before users (execution.postId FK is RESTRICT); this
	// cascades publications + attempts. Then users cascade posts + connections.
	await prisma.execution.deleteMany({ where: { userId: { in: createdUserIds } } });
	await deleteUsersByEmail(createdEmails);
	await deletePlatformsByKey(createdKeys);
	await publishQueue.close();
	await bullConnection.quit();
});

describe("publishing: validation & authorization", () => {
	it("rejects an unauthenticated request", async () => {
		const res = await request(app)
			.post("/api/v1/posts/some-id/publish")
			.send({ platforms: [OK_KEY] });
		expect(res.status).toBe(401);
	});

	it("rejects an empty platform selection (400)", async () => {
		const { agent } = await makeUser("empty-sel");
		const postId = await createPost(agent, "content to publish");
		const res = await agent.post(`/api/v1/posts/${postId}/publish`).send({ platforms: [] });
		expect(res.status).toBe(400);
	});

	it("refuses to publish a post the caller does not own (404)", async () => {
		const owner = await makeUser("owner");
		const other = await makeUser("intruder");
		const postId = await createPost(owner.agent, "owner's post");
		await seedConnection(other.userId, okPlatformId, "Intruder OK");

		const res = await other.agent
			.post(`/api/v1/posts/${postId}/publish`)
			.send({ platforms: [OK_KEY] });
		expect(res.status).toBe(404);
	});

	it("refuses an unconnected platform and names it", async () => {
		const { agent, userId } = await makeUser("unconnected");
		await seedConnection(userId, okPlatformId, "Connected OK");
		const postId = await createPost(agent, "publish me");

		// OK is connected, Fail is not → refuse, naming the Fail platform.
		const res = await agent
			.post(`/api/v1/posts/${postId}/publish`)
			.send({ platforms: [OK_KEY, FAIL_KEY] });
		expect(res.status).toBe(400);
		expect(res.body.message).toContain("E2E Fail Platform");
		// nothing was created
		const count = await prisma.execution.count({ where: { userId } });
		expect(count).toBe(0);
	});
});

describe("publishing: start returns immediately with rows created", () => {
	it("returns 202 + execution id BEFORE publishing completes, and fans out one publication per platform", async () => {
		const { agent, userId } = await makeUser("start");
		await seedConnection(userId, okPlatformId, "Start OK");
		await seedConnection(userId, failPlatformId, "Start Fail");
		const postId = await createPost(agent, "fan out to two platforms");

		const res = await agent
			.post(`/api/v1/posts/${postId}/publish`)
			.send({ platforms: [OK_KEY, FAIL_KEY] });

		expect(res.status).toBe(202);
		expect(res.body.data.executionId).toEqual(expect.any(String));
		// returned before the worker touched it — proof it's async (spec §12/§24)
		expect(res.body.data.status).toBe(ExecutionStatus.PENDING);

		const publications = await prisma.publication.findMany({
			where: { executionId: res.body.data.executionId },
			include: { platform: true },
		});
		expect(publications).toHaveLength(2);
		const byKey = Object.fromEntries(publications.map((p) => [p.platform.key, p]));
		expect(byKey[OK_KEY]?.platformAccountName).toBe("Start OK");
		expect(byKey[FAIL_KEY]?.platformAccountName).toBe("Start Fail");

		await waitForExecution(res.body.data.executionId);
	});
});

describe("publishing: background worker records attempts & computes status", () => {
	it("all platforms succeed → COMPLETED, each publication SUCCESS with an external id + attempt #1", async () => {
		const { agent, userId } = await makeUser("all-ok");
		await seedConnection(userId, okPlatformId, "AllOk");
		const postId = await createPost(agent, "all good");

		const res = await agent.post(`/api/v1/posts/${postId}/publish`).send({ platforms: [OK_KEY] });
		const execution = await waitForExecution(res.body.data.executionId);
		expect(execution.status).toBe(ExecutionStatus.COMPLETED);
		expect(execution.completedAt).not.toBeNull();

		const publication = await prisma.publication.findFirstOrThrow({
			where: { executionId: execution.id },
			include: { attempts: true },
		});
		expect(publication.status).toBe("SUCCESS");
		expect(publication.externalPostId).toBe(`ext-ok-${runId}`);
		expect(publication.publishedAt).not.toBeNull();
		expect(publication.attempts).toHaveLength(1);
		expect(publication.attempts[0]?.attemptNumber).toBe(1);
		expect(publication.attempts[0]?.status).toBe("SUCCESS");
	});

	it("one platform fails → PARTIALLY_COMPLETED, failed attempt carries the reason", async () => {
		const { agent, userId } = await makeUser("partial");
		await seedConnection(userId, okPlatformId, "PartialOk");
		await seedConnection(userId, failPlatformId, "PartialFail");
		const postId = await createPost(agent, "mixed outcome");

		const res = await agent
			.post(`/api/v1/posts/${postId}/publish`)
			.send({ platforms: [OK_KEY, FAIL_KEY] });
		const execution = await waitForExecution(res.body.data.executionId);
		expect(execution.status).toBe(ExecutionStatus.PARTIALLY_COMPLETED);

		const failed = await prisma.publication.findFirstOrThrow({
			where: { executionId: execution.id, platformId: failPlatformId },
			include: { attempts: true },
		});
		expect(failed.status).toBe("FAILED");
		expect(failed.attempts[0]?.status).toBe("FAILED");
		expect(failed.attempts[0]?.errorMessage).toBe(FAIL_REASON);
	});

	it("all platforms fail → FAILED", async () => {
		const { agent, userId } = await makeUser("all-fail");
		await seedConnection(userId, failPlatformId, "AllFail");
		const postId = await createPost(agent, "doomed");

		const res = await agent.post(`/api/v1/posts/${postId}/publish`).send({ platforms: [FAIL_KEY] });
		const execution = await waitForExecution(res.body.data.executionId);
		expect(execution.status).toBe(ExecutionStatus.FAILED);
	});
});

describe("publishing: security & registry", () => {
	it("never stores the token in a failure reason or any publication/attempt row", async () => {
		const { agent, userId } = await makeUser("no-leak");
		await seedConnection(userId, failPlatformId, "NoLeak");
		const postId = await createPost(agent, "check for leaks");

		const res = await agent.post(`/api/v1/posts/${postId}/publish`).send({ platforms: [FAIL_KEY] });
		const execution = await waitForExecution(res.body.data.executionId);

		const rows = await prisma.publication.findMany({
			where: { executionId: execution.id },
			include: { attempts: true },
		});
		expect(JSON.stringify(rows)).not.toContain(SECRET_TOKEN);
		// and the HTTP response never carried a token either
		expect(JSON.stringify(res.body)).not.toContain(SECRET_TOKEN);
	});

	it("getPublisher returns null for an unknown platform key", () => {
		expect(getPublisher(`no-such-platform-${runId}`)).toBeNull();
	});

	it("runExecution is a no-op for a missing execution (deleted before the job ran)", async () => {
		await expect(runExecution(`00000000-0000-0000-0000-000000000000`)).resolves.toBeUndefined();
	});
});
