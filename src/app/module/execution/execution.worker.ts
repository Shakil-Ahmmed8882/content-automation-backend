import { Worker } from "bullmq";
import type IORedis from "ioredis";
import { AttemptStatus, ExecutionStatus, PublicationStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { PUBLISH_QUEUE, type PublishJobData, bullConnection } from "../../lib/queue";
import { getPublisher } from "./publishers";

type Outcome = "SUCCESS" | "FAILED";

/** Publish one publication as attempt #N: mark it RUNNING, call the platform's
 * publisher, then write the terminal attempt + publication status. Never throws
 * — a provider failure is captured as a FAILED attempt so one platform can't
 * sink the others (per-platform isolation, design D4). Only clean, secret-free
 * reasons are stored — never a token or stack trace (spec §22). */
const runPublication = async (publicationId: string): Promise<Outcome> => {
	const publication = await prisma.publication.findUniqueOrThrow({
		where: { id: publicationId },
		include: {
			platform: true,
			connection: true,
			execution: { include: { post: true } },
		},
	});

	// attemptNumber is derived from the ledger, so retry (#6) just appends #2+.
	const attemptNumber = (await prisma.publicationAttempt.count({ where: { publicationId } })) + 1;
	const attempt = await prisma.publicationAttempt.create({
		data: {
			publicationId,
			attemptNumber,
			status: AttemptStatus.RUNNING,
			startedAt: new Date(),
		},
	});
	await prisma.publication.update({
		where: { id: publicationId },
		data: { status: PublicationStatus.RUNNING },
	});

	try {
		const publisher = getPublisher(publication.platform.key);
		if (!publisher) {
			throw new Error(`No publisher is configured for ${publication.platform.name}`);
		}
		if (!publication.connection) {
			throw new Error(`Reconnect ${publication.platform.name} before publishing`);
		}

		const result = await publisher.publish(
			publication.execution.post.content,
			publication.execution.post.imageUrl,
			{
				accessToken: publication.connection.accessToken,
				platformAccountId: publication.connection.platformAccountId,
				platformAccountName: publication.connection.platformAccountName,
			},
		);

		const now = new Date();
		await prisma.publicationAttempt.update({
			where: { id: attempt.id },
			data: {
				status: AttemptStatus.SUCCESS,
				externalPostId: result.externalPostId,
				externalPostUrl: result.externalPostUrl ?? null,
				finishedAt: now,
			},
		});
		await prisma.publication.update({
			where: { id: publicationId },
			data: {
				status: PublicationStatus.SUCCESS,
				externalPostId: result.externalPostId,
				externalPostUrl: result.externalPostUrl ?? null,
				publishedAt: now,
			},
		});
		return "SUCCESS";
	} catch (error) {
		// Store the message only — never error.stack or any token (spec §22).
		const reason = error instanceof Error && error.message ? error.message : "Publish failed";
		await prisma.publicationAttempt.update({
			where: { id: attempt.id },
			data: { status: AttemptStatus.FAILED, errorMessage: reason, finishedAt: new Date() },
		});
		await prisma.publication.update({
			where: { id: publicationId },
			data: { status: PublicationStatus.FAILED },
		});
		return "FAILED";
	}
};

/** Derive the overall execution status from the CURRENT state of ALL its
 * publications (data-model §4.6): any still pending/running → RUNNING; all
 * succeeded → COMPLETED; mixed → PARTIALLY_COMPLETED; all failed → FAILED.
 * Reading the full set (not just the ones processed this run) is what lets a
 * retry of one failed platform flip PARTIALLY_COMPLETED → COMPLETED (#6). */
const deriveExecutionStatus = (statuses: PublicationStatus[]): ExecutionStatus => {
	if (statuses.some((s) => s === PublicationStatus.PENDING || s === PublicationStatus.RUNNING)) {
		return ExecutionStatus.RUNNING;
	}
	const anySuccess = statuses.includes(PublicationStatus.SUCCESS);
	const anyFailure = statuses.includes(PublicationStatus.FAILED);
	if (anySuccess && anyFailure) {
		return ExecutionStatus.PARTIALLY_COMPLETED;
	}
	if (anySuccess) {
		return ExecutionStatus.COMPLETED;
	}
	return ExecutionStatus.FAILED;
};

/** Process an execution: mark RUNNING, (re)publish the target publications
 * (attempt #N each), then recompute + persist the overall status from ALL
 * publications. `publicationIds` scopes a retry to specific failed publications
 * (#6); omitted on the initial publish, where every publication runs. Exported
 * so both the BullMQ worker and tests drive it. */
export const runExecution = async (
	executionId: string,
	publicationIds?: string[],
): Promise<void> => {
	const execution = await prisma.execution.findUnique({
		where: { id: executionId },
		include: { publications: { orderBy: { createdAt: "asc" } } },
	});
	if (!execution) {
		return; // execution (or its owning user) was removed before the job ran
	}

	const targets =
		publicationIds && publicationIds.length
			? execution.publications.filter((publication) => publicationIds.includes(publication.id))
			: execution.publications;

	await prisma.execution.update({
		where: { id: executionId },
		// Preserve the original startedAt across retries; only set it the first time.
		data: { status: ExecutionStatus.RUNNING, startedAt: execution.startedAt ?? new Date() },
	});

	// Sequential per platform: isolation matters, throughput does not (MVP).
	for (const publication of targets) {
		await runPublication(publication.id);
	}

	// Recompute from the full current set so a partial retry can complete it.
	const all = await prisma.publication.findMany({
		where: { executionId },
		select: { status: true },
	});
	await prisma.execution.update({
		where: { id: executionId },
		data: {
			status: deriveExecutionStatus(all.map((publication) => publication.status)),
			completedAt: new Date(),
		},
	});
};

let worker: Worker<PublishJobData> | null = null;
let workerConnection: IORedis | null = null;

/** Start the BullMQ worker that drains the publish queue (called from server.ts,
 * and by the E2E suite in-process). Idempotent — repeated calls return the same
 * worker. Uses its own Redis connection (BullMQ blocks on the worker link). */
export const startPublishWorker = (): Worker<PublishJobData> => {
	if (worker) {
		return worker;
	}
	workerConnection = bullConnection.duplicate();
	worker = new Worker<PublishJobData>(
		PUBLISH_QUEUE,
		async (job) => {
			await runExecution(job.data.executionId, job.data.publicationIds);
		},
		{ connection: workerConnection },
	);
	worker.on("failed", (job, error) => {
		console.log(`Publish job ${job?.id ?? "?"} failed:`, error?.message);
	});
	return worker;
};

/** Stop the worker and release its Redis connection (used by the E2E suite so
 * the test process exits with no open handles). */
export const stopPublishWorker = async (): Promise<void> => {
	if (worker) {
		await worker.close();
		worker = null;
	}
	if (workerConnection) {
		await workerConnection.quit();
		workerConnection = null;
	}
};
