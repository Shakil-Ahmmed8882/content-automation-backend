import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/appError";
import { auditContext, writeAuditLog } from "../../utils/audit";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ConnectionService } from "./connection.service";

const requireUser = (req: Request) => {
	if (!req.user) {
		throw new AppError(httpStatus.UNAUTHORIZED, "You are not logged in");
	}
	return req.user;
};

const listConnections = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const result = await ConnectionService.listConnections(user.userId);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Connections fetched successfully",
		data: result,
	});
});

const startConnect = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const result = await ConnectionService.startConnect(user.userId, req.params.platform as string);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Authorization URL generated",
		data: result,
	});
});

const callback = catchAsync(async (req: Request, res: Response) => {
	const result = await ConnectionService.handleCallback(
		req.params.platform as string,
		req.query.code as string | undefined,
		req.query.state as string | undefined,
	);

	const message =
		result.kind === "connected"
			? "Platform connected successfully"
			: "Select a Page to finish connecting";

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message,
		data: result,
	});
});

const listFacebookPages = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const result = await ConnectionService.listFacebookPages(user.userId);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Facebook Pages fetched successfully",
		data: result,
	});
});

const selectFacebookPage = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const result = await ConnectionService.selectFacebookPage(user.userId, req.body.pageId);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Facebook Page connected successfully",
		data: result,
	});
});

const disconnect = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const platformKey = req.params.platform as string;
	await ConnectionService.disconnect(user.userId, platformKey);

	// Best-effort, additive audit entry — never breaks the response above/below.
	await writeAuditLog({
		...auditContext(req),
		action: "CONNECTION_DISCONNECTED",
		entityType: "SocialConnection",
		entityId: platformKey,
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Platform disconnected successfully",
		data: null,
	});
});

export const ConnectionController = {
	listConnections,
	startConnect,
	callback,
	listFacebookPages,
	selectFacebookPage,
	disconnect,
};
