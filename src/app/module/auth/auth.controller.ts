import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/appError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AuthService } from "./auth.service";
import { clearAuthCookies, setAuthCookies } from "./auth.utils";

const register = catchAsync(async (req: Request, res: Response) => {
	const result = await AuthService.register(req.body);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "A verification code has been sent to your email",
		data: result,
	});
});

const verifyEmail = catchAsync(async (req: Request, res: Response) => {
	const { tokens, user } = await AuthService.verifyEmail(req.body);
	setAuthCookies(res, tokens);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Email verified. Your account is ready",
		data: user,
	});
});

const login = catchAsync(async (req: Request, res: Response) => {
	const { tokens, user } = await AuthService.login(req.body);
	setAuthCookies(res, tokens);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Logged in successfully",
		data: user,
	});
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
	const token = req.cookies?.refreshToken ?? req.body?.refreshToken;
	if (!token) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token is missing");
	}

	const { tokens } = await AuthService.refreshToken(token);
	setAuthCookies(res, tokens);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Session refreshed successfully",
		data: null,
	});
});

const logout = catchAsync((_req: Request, res: Response) => {
	clearAuthCookies(res);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Logged out successfully",
		data: null,
	});
});

const getMe = catchAsync(async (req: Request, res: Response) => {
	if (!req.user) {
		throw new AppError(httpStatus.UNAUTHORIZED, "You are not logged in");
	}

	const result = await AuthService.getMe(req.user.userId);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Profile fetched successfully",
		data: result,
	});
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
	const result = await AuthService.forgotPassword(req.body);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: result.message,
		// Dev/test-only: forwards the `otp` field when the service included one
		// (EXPOSE_OTP_IN_RESPONSE, never in production) — see auth.service.ts.
		data: result.otp ? { otp: result.otp } : null,
	});
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
	const result = await AuthService.resetPassword(req.body);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: result.message,
		data: null,
	});
});

export const AuthController = {
	register,
	verifyEmail,
	login,
	refreshToken,
	logout,
	getMe,
	forgotPassword,
	resetPassword,
};
