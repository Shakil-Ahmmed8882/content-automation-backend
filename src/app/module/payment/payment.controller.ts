import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import config from "../../config";
import { AppError } from "../../utils/appError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { PaymentService } from "./payment.service";

const requireUser = (req: Request) => {
	if (!req.user) {
		throw new AppError(httpStatus.UNAUTHORIZED, "You are not logged in");
	}
	return req.user;
};

// POST /payments/create — start a premium payment; returns the gateway URL.
const create = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const result = await PaymentService.create(user.userId);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Payment initiated",
		data: result,
	});
});

const asString = (value: unknown) => (typeof value === "string" ? value : undefined);

// GET /payments/callback — bKash redirects the browser here. Unauthenticated
// (the gateway calls it). We confirm server-side, then redirect the user to the
// frontend success/failure page. Any error redirects to failure — never a JSON
// error to a browser mid-redirect.
const callback = async (req: Request, res: Response, _next: NextFunction) => {
	const successUrl = `${config.frontend_base_url}/payment/success`;
	const failureUrl = `${config.frontend_base_url}/payment/failure`;
	try {
		const paymentID = asString(req.query.paymentID) ?? asString(req.query.paymentId);
		const status = asString(req.query.status);
		const result = await PaymentService.handleCallback(paymentID, status);
		res.redirect(result.success ? successUrl : failureUrl);
	} catch {
		res.redirect(failureUrl);
	}
};

// POST /payments/verify — owner-scoped, idempotent re-verify safety net.
const verify = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const result = await PaymentService.verify(user.userId, req.body.paymentId);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payment verified",
		data: result,
	});
});

// GET /payments/:id — owner-scoped payment status.
const getStatus = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const result = await PaymentService.getStatus(user.userId, req.params.id as string);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payment fetched successfully",
		data: result,
	});
});

// GET /payments — owner-scoped payment history, paginated + optionally
// filtered by status.
const list = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const { data, meta } = await PaymentService.listMine(user.userId, {
		page: asString(req.query.page),
		limit: asString(req.query.limit),
		status: asString(req.query.status),
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payments fetched successfully",
		data,
		meta,
	});
});

export const PaymentController = {
	create,
	callback,
	verify,
	getStatus,
	list,
};
