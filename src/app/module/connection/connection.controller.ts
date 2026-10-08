import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/appError";
import { auditContext, writeAuditLog } from "../../utils/audit";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { OAuthRedirectOutcome } from "./connection.interface";
import { ConnectionService } from "./connection.service";
import {
	buildConnectionsRedirectUrl,
	canRedirectToFrontend,
	classifyCallbackFailure,
	isBrowserNavigation,
} from "./connection.utils";

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

const asString = (value: unknown) => (typeof value === "string" ? value : undefined);

// GET /connections/:platform/callback — one URL, two kinds of caller:
//
//  - Browser NAVIGATION (the provider redirected the user's browser here;
//    `Sec-Fetch-Mode: navigate`, or `Accept: text/html` without JSON on browsers
//    that predate Fetch Metadata — see `isBrowserNavigation`): finish the
//    handshake, then 302 to `${FRONTEND_URL}/connections?...` with a fixed outcome
//    code so the user lands back where they started instead of on raw JSON.
//  - Programmatic caller (fetch/XHR from the frontend callback page, Postman,
//    tests): the unchanged JSON response and status codes.
//
// The redirect target is built only from config + fixed codes (no request input,
// never a code/token/provider message/id), so it cannot be an open redirect.
const callback = catchAsync(async (req: Request, res: Response) => {
	// The same URL answers differently by header, so caches must key on them.
	res.vary("Sec-Fetch-Mode");
	res.vary("Accept");

	const platformKey = req.params.platform as string;
	const code = req.query.code as string | undefined;
	const state = req.query.state as string | undefined;

	// No usable FRONTEND_URL → nowhere safe to redirect, so fall through to JSON.
	if (isBrowserNavigation(req) && canRedirectToFrontend()) {
		await redirectCallbackToFrontend(req, res, platformKey, code, state);
		return;
	}

	const result = await ConnectionService.handleCallback(platformKey, code, state);

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

const describeFailure = (error: unknown) => {
	if (error instanceof AppError) {
		return error.message;
	}
	return error instanceof Error ? error.name : "unknown";
};

// Browser-navigation branch. Any failure becomes a redirect with a fixed error
// code — never a JSON error page for a user mid-redirect (same reasoning as
// `PaymentController.callback`), which is why this one catches inline.
const redirectCallbackToFrontend = async (
	req: Request,
	res: Response,
	platformKey: string,
	code: string | undefined,
	state: string | undefined,
) => {
	let outcome: OAuthRedirectOutcome;
	try {
		const result = await ConnectionService.handleCallback(platformKey, code, state);
		outcome =
			result.kind === "connected"
				? { kind: "connected", platformKey: result.connection.platform.key }
				: { kind: "select-page" };
	} catch (error) {
		const errorCode = classifyCallbackFailure(error, asString(req.query.error));
		if (errorCode === "failed") {
			// Server-side only, and never the raw error object (it may carry provider
			// payloads): AppError messages are our own static strings.
			console.error("[connections] OAuth callback failed:", describeFailure(error));
		}
		outcome = { kind: "error", code: errorCode };
	}

	const location = buildConnectionsRedirectUrl(outcome);
	if (!location) {
		// Unreachable while canRedirectToFrontend() holds; keep a safe fallback.
		throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, "Frontend URL is not configured");
	}
	res.set("Cache-Control", "no-store");
	res.redirect(httpStatus.FOUND, location);
};

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
