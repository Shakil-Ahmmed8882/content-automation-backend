import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import {
	ExecutionStatus,
	PlatformStatus,
	PublicationStatus,
} from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { PUBLISH_QUEUE, publishQueue } from "../../lib/queue";
import { AppError } from "../../utils/appError";
import type { IListExecutionsQuery } from "./execution.interface";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const CONTENT_PREVIEW_LENGTH = 140;

/** Start a background publish of one owned post to the selected connected
 * platforms. Validates (post owned + not deleted + has content, each platform
 * exists + is LIVE + is connected), then creates the execution (PENDING) + one
 * publication per platform (snapshotting the account name) and enqueues the job.
 * Returns immediately with the execution — the worker does the actual publishing
 * (design D1). */
const startPublish = async (userId: string, postId: string, platformKeys: string[]) => {
	// 1. own, non-deleted post with content (owner-scoping — spec §22/§23).
	const post = await prisma.post.findFirst({ where: { id: postId, userId, isDeleted: false } });
	if (!post) {
		throw new AppError(httpStatus.NOT_FOUND, "Post not found");
	}
	if (!post.content.trim()) {
		throw new AppError(httpStatus.BAD_REQUEST, "This post has no content to publish");
	}

	// 2. dedupe the selected keys (a platform appears once per run — §4.7 unique).
	const keys = [...new Set(platformKeys)];

	// 3. each platform must exist, be LIVE, and be connected by THIS user; a
	//    missing connection is refused by name so the client knows what to fix.
	const targets: Array<{
		platformId: string;
		connectionId: string;
		platformAccountName: string | null;
	}> = [];
	for (const key of keys) {
		const platform = await prisma.platform.findUnique({ where: { key } });
		if (!platform) {
			throw new AppError(httpStatus.NOT_FOUND, `Unknown platform: ${key}`);
		}
		if (platform.status !== PlatformStatus.LIVE) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				`${platform.name} is not available to publish to yet`,
			);
		}
		const connection = await prisma.socialConnection.findUnique({
			where: { userId_platformId: { userId, platformId: platform.id } },
		});
		if (!connection) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				`Connect ${platform.name} before publishing to it`,
			);
		}
		targets.push({
			platformId: platform.id,
			connectionId: connection.id,
			platformAccountName: connection.platformAccountName,
		});
	}

	// 4. create the execution + publications synchronously (so status is
	//    queryable immediately), then enqueue the background job (design D1).
	const execution = await prisma.execution.create({
		data: {
			postId: post.id,
			userId,
			status: ExecutionStatus.PENDING,
			publications: {
				create: targets.map((target) => ({
					platformId: target.platformId,
					connectionId: target.connectionId,
					platformAccountName: target.platformAccountName,
					status: PublicationStatus.PENDING,
				})),
			},
		},
	});

	await publishQueue.add(PUBLISH_QUEUE, { executionId: execution.id });

	return execution;
};

/** Validate a publication is retryable and rebind it to the user's CURRENT
 * connection for its platform — the original may have been hard-deleted on
 * disconnect (design D2). Throws with reconnect guidance if there is no current
 * connection; only a FAILED publication is retryable (design D3). */
const prepareRetry = async (
	userId: string,
	publication: { id: string; status: string; platformId: string; platform: { name: string } },
) => {
	if (publication.status !== PublicationStatus.FAILED) {
		throw new AppError(httpStatus.BAD_REQUEST, "Only a failed publication can be retried");
	}
	const connection = await prisma.socialConnection.findUnique({
		where: { userId_platformId: { userId, platformId: publication.platformId } },
	});
	if (!connection) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`Connect ${publication.platform.name} before retrying`,
		);
	}
	await prisma.publication.update({
		where: { id: publication.id },
		data: { connectionId: connection.id, platformAccountName: connection.platformAccountName },
	});
};

/** POST /publications/:id/retry — retry one failed publication (the
 * "[Retry Facebook]" action). Owner-scoped; rebinds to the current connection
 * and enqueues a retry job scoped to just this publication (design D1). The
 * worker appends attempt #N and recomputes the execution status. */
const retryPublication = async (userId: string, publicationId: string) => {
	const publication = await prisma.publication.findUnique({
		where: { id: publicationId },
		include: {
			platform: { select: { name: true } },
			execution: { select: { userId: true } },
		},
	});
	// A non-owned id resolves to the same 404 — reveal nothing (spec, owner-scoped).
	if (!publication || publication.execution.userId !== userId) {
		throw new AppError(httpStatus.NOT_FOUND, "Publication not found");
	}

	await prepareRetry(userId, publication);
	await publishQueue.add(PUBLISH_QUEUE, {
		executionId: publication.executionId,
		publicationIds: [publication.id],
	});

	return { executionId: publication.executionId, publicationId: publication.id };
};

/** POST /executions/:id/retry — retry every FAILED publication in the execution,
 * leaving the successful ones untouched (spec). Owner-scoped. Validates + rebinds
 * all failed publications first, so one missing connection refuses the whole
 * request instead of half-enqueuing. */
const retryExecution = async (userId: string, executionId: string) => {
	const execution = await prisma.execution.findFirst({ where: { id: executionId, userId } });
	if (!execution) {
		throw new AppError(httpStatus.NOT_FOUND, "Execution not found");
	}

	const failed = await prisma.publication.findMany({
		where: { executionId, status: PublicationStatus.FAILED },
		include: { platform: { select: { name: true } } },
	});
	if (failed.length === 0) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"This execution has no failed publications to retry",
		);
	}

	for (const publication of failed) {
		await prepareRetry(userId, publication);
	}
	for (const publication of failed) {
		await publishQueue.add(PUBLISH_QUEUE, { executionId, publicationIds: [publication.id] });
	}

	return { executionId, retried: failed.length };
};

const isExecutionStatus = (value: string): value is ExecutionStatus =>
	Object.values(ExecutionStatus).includes(value as ExecutionStatus);

/** GET /executions — owner-scoped, paginated/sortable/filterable list (#7).
 * Each row carries the content reference (title + preview), the targeted
 * platforms with their per-platform status, the overall status, and timings. */
const list = async (userId: string, query: IListExecutionsQuery) => {
	const page = Math.max(1, Number.parseInt(query.page ?? "", 10) || 1);
	const requestedLimit = Number.parseInt(query.limit ?? "", 10) || DEFAULT_LIMIT;
	const limit = Math.min(Math.max(1, requestedLimit), MAX_LIMIT);
	const skip = (page - 1) * limit;

	const sortableFields = new Set(["createdAt", "startedAt", "completedAt"]);
	const rawSort = query.sort ?? "-createdAt";
	const descending = rawSort.startsWith("-");
	const sortField = descending ? rawSort.slice(1) : rawSort;
	const orderBy: Prisma.ExecutionOrderByWithRelationInput = sortableFields.has(sortField)
		? { [sortField]: descending ? "desc" : "asc" }
		: { createdAt: "desc" };

	// Date range filters on createdAt (when the publish was started).
	const createdAt: Prisma.DateTimeFilter = {};
	if (query.dateFrom) {
		const from = new Date(query.dateFrom);
		if (!Number.isNaN(from.getTime())) {
			createdAt.gte = from;
		}
	}
	if (query.dateTo) {
		const to = new Date(query.dateTo);
		if (!Number.isNaN(to.getTime())) {
			createdAt.lte = to;
		}
	}

	const where: Prisma.ExecutionWhereInput = {
		userId,
		...(query.status && isExecutionStatus(query.status) ? { status: query.status } : {}),
		...(createdAt.gte || createdAt.lte ? { createdAt } : {}),
	};

	const [rows, total] = await Promise.all([
		prisma.execution.findMany({
			where,
			skip,
			take: limit,
			orderBy,
			include: {
				post: { select: { id: true, title: true, content: true } },
				publications: {
					orderBy: { createdAt: "asc" },
					select: { status: true, platform: { select: { key: true, name: true } } },
				},
			},
		}),
		prisma.execution.count({ where }),
	]);

	const data = rows.map((execution) => ({
		id: execution.id,
		status: execution.status,
		startedAt: execution.startedAt,
		completedAt: execution.completedAt,
		createdAt: execution.createdAt,
		post: {
			id: execution.post.id,
			title: execution.post.title,
			contentPreview: execution.post.content.slice(0, CONTENT_PREVIEW_LENGTH),
		},
		platforms: execution.publications.map((publication) => ({
			key: publication.platform.key,
			name: publication.platform.name,
			status: publication.status,
		})),
	}));

	return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

/** GET /executions/:id — owner-scoped detail (#7): the published content (from
 * the post, even if later soft-deleted) plus each platform's result — status,
 * external url/id on success, the latest attempt's sanitized failure reason,
 * published time, and a `retryable` flag (failed → offer Retry, #6). */
const getDetail = async (userId: string, executionId: string) => {
	const execution = await prisma.execution.findFirst({
		where: { id: executionId, userId },
		include: {
			post: {
				select: { id: true, title: true, content: true, imageUrl: true, isDeleted: true },
			},
			publications: {
				orderBy: { createdAt: "asc" },
				include: {
					platform: { select: { key: true, name: true } },
					// latest attempt only — its errorMessage is the reason to surface
					attempts: { orderBy: { attemptNumber: "desc" }, take: 1 },
				},
			},
		},
	});
	if (!execution) {
		throw new AppError(httpStatus.NOT_FOUND, "Execution not found");
	}

	return {
		id: execution.id,
		status: execution.status,
		startedAt: execution.startedAt,
		completedAt: execution.completedAt,
		createdAt: execution.createdAt,
		post: {
			id: execution.post.id,
			title: execution.post.title,
			content: execution.post.content,
			imageUrl: execution.post.imageUrl,
			isDeleted: execution.post.isDeleted,
		},
		publications: execution.publications.map((publication) => {
			const latestAttempt = publication.attempts[0] ?? null;
			return {
				id: publication.id,
				platform: publication.platform,
				platformAccountName: publication.platformAccountName,
				status: publication.status,
				externalPostId: publication.externalPostId,
				externalPostUrl: publication.externalPostUrl,
				publishedAt: publication.publishedAt,
				failureReason:
					publication.status === PublicationStatus.FAILED
						? (latestAttempt?.errorMessage ?? null)
						: null,
				retryable: publication.status === PublicationStatus.FAILED,
				retryCount: latestAttempt ? latestAttempt.attemptNumber - 1 : 0,
			};
		}),
	};
};

export const ExecutionService = {
	startPublish,
	retryPublication,
	retryExecution,
	list,
	getDetail,
};
