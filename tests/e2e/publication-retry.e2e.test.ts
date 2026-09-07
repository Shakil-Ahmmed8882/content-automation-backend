import type request from "supertest";
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

const OK_KEY = `e2e-retry-ok-${runId}`;
const FAIL_KEY = `e2e-retry-fail-${runId}`;
const FLAKY_KEY = `e2e-retry-flaky-${runId}`;
const SECRET_TOKEN = "SUPER-SECRET-RETRY-TOKEN-do-not-leak";

// The flaky platform's outcome is switched by the test to simulate "fix the
// cause, then retry" — same in-process registry the real publishers use.
let flakyMode: "fail" | "success" = "fail";

registerPublisher({
	key: OK_KEY,
	publish: async () => ({ externalPostId: `ext-ok-${runId}` }),
});
registerPublisher({
	key: FAIL_KEY,
	publish: async () => {
		throw new Error("always fails (test)");
	},
});
registerPublisher({
	key: FLAKY_KEY,
	publish: async () => {
		if (flakyMode === "fail") {
			throw new Error("flaky failed (test)");
		}
		return { externalPostId: `ext-flaky-${runId}` };
	},
});

const freshEmail = (label: string) => {
	const email = `e2e-retry-${runId}-${label}-${createdEmails.length}@example.com`;
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

const createPost = async (agent: ReturnType<typeof request.agent>, content: string) => {
	const res = await agent.post("/api/v1/posts").send({ content });
	return res.body.data.id as string;
};

/** Poll until the predicate holds (the worker runs async), else throw. */
const pollUntil = async (predicate: () => Promise<boolean>, timeoutMs = 10_000) => {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await predicate()) {
			return;
		}
		if (Date.now() > deadline) {
			throw new Error(`Condition not met within ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

const executionStatus = async (id: string) =>
	(await prisma.execution.findUniqueOrThrow({ where: { id } })).status;

let okPlatformId = "";
let failPlatformId = "";
let flakyPlatformId = "";

beforeAll(async () => {
	const [ok, fail, flaky] = await Promise.all([
		createLivePlatform(OK_KEY, "Retry OK Platform"),
		createLivePlatform(FAIL_KEY, "Retry Fail Platform"),
		createLivePlatform(FLAKY_KEY, "Retry Flaky Platform"),
	]);
	createdKeys.push(OK_KEY, FAIL_KEY, FLAKY_KEY);
	okPlatformId = ok.id;
	failPlatformId = fail.id;
	flakyPlatformId = flaky.id;
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

/** Publish to the given platform keys and wait for the initial run to settle. */
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

describe("publication-retry: guards", () => {
	it("refuses to retry a publication that already succeeded (400)", async () => {
		const { agent, userId } = await makeUser("guard-success");
		await seedConnection(userId, okPlatformId, "OK");
		const postId = await createPost(agent, "already ok");
		const executionId = await publishAndSettle(agent, postId, [OK_KEY], ExecutionStatus.COMPLETED);

		const publication = await prisma.publication.findFirstOrThrow({ where: { executionId } });
		const res = await agent.post(`/api/v1/publications/${publication.id}/retry`).send();
		expect(res.status).toBe(400);
	});

	it("refuses to retry another user's publication (404)", async () => {
		const owner = await makeUser("guard-owner");
		const other = await makeUser("guard-intruder");
		await seedConnection(owner.userId, failPlatformId, "Owner Fail");
		const postId = await createPost(owner.agent, "owner failing post");
		const executionId = await publishAndSettle(
			owner.agent,
			postId,
			[FAIL_KEY],
			ExecutionStatus.FAILED,
		);
		const publication = await prisma.publication.findFirstOrThrow({ where: { executionId } });

		const res = await other.agent.post(`/api/v1/publications/${publication.id}/retry`).send();
		expect(res.status).toBe(404);
	});

	it("refuses retry when the platform is no longer connected, naming it", async () => {
		const { agent, userId } = await makeUser("guard-reconnect");
		await seedConnection(userId, failPlatformId, "Will Disconnect");
		const postId = await createPost(agent, "needs reconnect");
		const executionId = await publishAndSettle(agent, postId, [FAIL_KEY], ExecutionStatus.FAILED);
		const publication = await prisma.publication.findFirstOrThrow({ where: { executionId } });

		// disconnect (hard-delete the connection) → retry must refuse with guidance
		await prisma.socialConnection.deleteMany({ where: { userId, platformId: failPlatformId } });
		const res = await agent.post(`/api/v1/publications/${publication.id}/retry`).send();
		expect(res.status).toBe(400);
		expect(res.body.message).toContain("Retry Fail Platform");
	});
});

describe("publication-retry: retry a failed publication", () => {
	it("appends attempt #2 and flips the publication to SUCCESS and the execution to COMPLETED", async () => {
		flakyMode = "fail";
		const { agent, userId } = await makeUser("retry-success");
		await seedConnection(userId, okPlatformId, "OK");
		await seedConnection(userId, flakyPlatformId, "Flaky");
		const postId = await createPost(agent, "one platform will need a retry");
		const executionId = await publishAndSettle(
			agent,
			postId,
			[OK_KEY, FLAKY_KEY],
			ExecutionStatus.PARTIALLY_COMPLETED,
		);

		const flakyPub = await prisma.publication.findFirstOrThrow({
			where: { executionId, platformId: flakyPlatformId },
		});
		expect(flakyPub.status).toBe("FAILED");

		// resolve the cause, then retry just that publication
		flakyMode = "success";
		const res = await agent.post(`/api/v1/publications/${flakyPub.id}/retry`).send();
		expect(res.status).toBe(202);

		await pollUntil(async () => (await executionStatus(executionId)) === ExecutionStatus.COMPLETED);

		const after = await prisma.publication.findUniqueOrThrow({
			where: { id: flakyPub.id },
			include: { attempts: { orderBy: { attemptNumber: "asc" } } },
		});
		expect(after.status).toBe("SUCCESS");
		expect(after.externalPostId).toBe(`ext-flaky-${runId}`);
		expect(after.attempts).toHaveLength(2);
		expect(after.attempts[1]?.attemptNumber).toBe(2);
		expect(after.attempts[1]?.status).toBe("SUCCESS");
	});

	it("records a new failed attempt (with the new reason) when the retry still fails", async () => {
		const { agent, userId } = await makeUser("retry-refail");
		await seedConnection(userId, failPlatformId, "Fail");
		const postId = await createPost(agent, "will fail twice");
		const executionId = await publishAndSettle(agent, postId, [FAIL_KEY], ExecutionStatus.FAILED);
		const publication = await prisma.publication.findFirstOrThrow({ where: { executionId } });

		const res = await agent.post(`/api/v1/publications/${publication.id}/retry`).send();
		expect(res.status).toBe(202);

		await pollUntil(async () => {
			const count = await prisma.publicationAttempt.count({
				where: { publicationId: publication.id },
			});
			return count === 2;
		});
		const attempts = await prisma.publicationAttempt.findMany({
			where: { publicationId: publication.id },
			orderBy: { attemptNumber: "asc" },
		});
		expect(attempts[1]?.status).toBe("FAILED");
		expect(attempts[1]?.errorMessage).toBe("always fails (test)");
	});

	it("rebinds to the user's current connection after reconnecting", async () => {
		flakyMode = "fail";
		const { agent, userId } = await makeUser("retry-rebind");
		const original = await seedConnection(userId, flakyPlatformId, "Original");
		const postId = await createPost(agent, "rebind me");
		const executionId = await publishAndSettle(agent, postId, [FLAKY_KEY], ExecutionStatus.FAILED);
		const pub = await prisma.publication.findFirstOrThrow({ where: { executionId } });
		expect(pub.connectionId).toBe(original.id);

		// disconnect → reconnect a fresh connection (new row id), then retry
		await prisma.socialConnection.deleteMany({ where: { userId, platformId: flakyPlatformId } });
		const reconnected = await seedConnection(userId, flakyPlatformId, "Reconnected");
		expect(reconnected.id).not.toBe(original.id);

		flakyMode = "success";
		const res = await agent.post(`/api/v1/publications/${pub.id}/retry`).send();
		expect(res.status).toBe(202);
		await pollUntil(async () => (await executionStatus(executionId)) === ExecutionStatus.COMPLETED);

		const after = await prisma.publication.findUniqueOrThrow({ where: { id: pub.id } });
		expect(after.connectionId).toBe(reconnected.id);
		expect(after.platformAccountName).toBe("Reconnected");
	});
});

describe("publication-retry: retry an execution", () => {
	it("retries only the failed platforms and leaves successes untouched", async () => {
		flakyMode = "fail";
		const { agent, userId } = await makeUser("retry-exec");
		await seedConnection(userId, okPlatformId, "OK");
		await seedConnection(userId, flakyPlatformId, "Flaky");
		const postId = await createPost(agent, "execution retry");
		const executionId = await publishAndSettle(
			agent,
			postId,
			[OK_KEY, FLAKY_KEY],
			ExecutionStatus.PARTIALLY_COMPLETED,
		);

		const okPubBefore = await prisma.publication.findFirstOrThrow({
			where: { executionId, platformId: okPlatformId },
			include: { attempts: true },
		});
		expect(okPubBefore.attempts).toHaveLength(1);

		flakyMode = "success";
		const res = await agent.post(`/api/v1/executions/${executionId}/retry`).send();
		expect(res.status).toBe(202);
		expect(res.body.data.retried).toBe(1);

		await pollUntil(async () => (await executionStatus(executionId)) === ExecutionStatus.COMPLETED);

		// the already-successful OK publication was NOT re-run (still 1 attempt)
		const okPubAfter = await prisma.publication.findUniqueOrThrow({
			where: { id: okPubBefore.id },
			include: { attempts: true },
		});
		expect(okPubAfter.attempts).toHaveLength(1);

		const flakyPub = await prisma.publication.findFirstOrThrow({
			where: { executionId, platformId: flakyPlatformId },
			include: { attempts: true },
		});
		expect(flakyPub.status).toBe("SUCCESS");
		expect(flakyPub.attempts).toHaveLength(2);
	});

	it("refuses an execution retry when nothing failed (400)", async () => {
		const { agent, userId } = await makeUser("retry-exec-none");
		await seedConnection(userId, okPlatformId, "OK");
		const postId = await createPost(agent, "all good, nothing to retry");
		const executionId = await publishAndSettle(agent, postId, [OK_KEY], ExecutionStatus.COMPLETED);

		const res = await agent.post(`/api/v1/executions/${executionId}/retry`).send();
		expect(res.status).toBe(400);
	});

	it("refuses to retry another user's execution (404)", async () => {
		const owner = await makeUser("exec-owner");
		const other = await makeUser("exec-intruder");
		await seedConnection(owner.userId, failPlatformId, "Owner Fail");
		const postId = await createPost(owner.agent, "owner exec");
		const executionId = await publishAndSettle(
			owner.agent,
			postId,
			[FAIL_KEY],
			ExecutionStatus.FAILED,
		);

		const res = await other.agent.post(`/api/v1/executions/${executionId}/retry`).send();
		expect(res.status).toBe(404);
	});
});

describe("publication-retry: security", () => {
	it("never stores the token in a retried failure reason or any row", async () => {
		const { agent, userId } = await makeUser("retry-noleak");
		await seedConnection(userId, failPlatformId, "Fail");
		const postId = await createPost(agent, "leak check on retry");
		const executionId = await publishAndSettle(agent, postId, [FAIL_KEY], ExecutionStatus.FAILED);
		const publication = await prisma.publication.findFirstOrThrow({ where: { executionId } });

		const res = await agent.post(`/api/v1/publications/${publication.id}/retry`).send();
		await pollUntil(async () => {
			const count = await prisma.publicationAttempt.count({
				where: { publicationId: publication.id },
			});
			return count === 2;
		});

		const rows = await prisma.publication.findMany({
			where: { executionId },
			include: { attempts: true },
		});
		expect(JSON.stringify(rows)).not.toContain(SECRET_TOKEN);
		expect(JSON.stringify(res.body)).not.toContain(SECRET_TOKEN);
	});
});
