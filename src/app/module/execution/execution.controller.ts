import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/appError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ExecutionService } from "./execution.service";

const requireUser = (req: Request) => {
	if (!req.user) {
		throw new AppError(httpStatus.UNAUTHORIZED, "You are not logged in");
	}
	return req.user;
};

// POST /posts/:id/publish — validates + creates rows + enqueues, then returns
// 202 "started" with the execution id. The actual publishing runs in the
// background worker, so this returns promptly and the browser can close.
const publish = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const execution = await ExecutionService.startPublish(
		user.userId,
		req.params.id as string,
		req.body.platforms,
	);

	sendResponse(res, {
		statusCode: httpStatus.ACCEPTED,
		success: true,
		message: "Publishing started",
		data: { executionId: execution.id, status: execution.status },
	});
});

// POST /publications/:id/retry — retry one failed publication. Returns 202; the
// worker re-runs it in the background (#6).
const retryPublication = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const result = await ExecutionService.retryPublication(user.userId, req.params.id as string);

	sendResponse(res, {
		statusCode: httpStatus.ACCEPTED,
		success: true,
		message: "Retry started",
		data: result,
	});
});

// POST /executions/:id/retry — retry every failed publication in the execution.
const retryExecution = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const result = await ExecutionService.retryExecution(user.userId, req.params.id as string);

	sendResponse(res, {
		statusCode: httpStatus.ACCEPTED,
		success: true,
		message: "Retry started",
		data: result,
	});
});

const asString = (value: unknown) => (typeof value === "string" ? value : undefined);

// GET /executions — owner-scoped history list (#7) with pagination meta.
const list = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const { data, meta } = await ExecutionService.list(user.userId, {
		page: asString(req.query.page),
		limit: asString(req.query.limit),
		sort: asString(req.query.sort),
		status: asString(req.query.status),
		dateFrom: asString(req.query.dateFrom),
		dateTo: asString(req.query.dateTo),
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Executions fetched successfully",
		data,
		meta,
	});
});

// GET /executions/:id — owner-scoped per-platform detail (#7).
const getDetail = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const result = await ExecutionService.getDetail(user.userId, req.params.id as string);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Execution fetched successfully",
		data: result,
	});
});

export const ExecutionController = {
	publish,
	retryPublication,
	retryExecution,
	list,
	getDetail,
};
