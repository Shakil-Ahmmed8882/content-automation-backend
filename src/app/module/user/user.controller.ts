import type { Request, Response } from "express";
import httpStatus from "http-status";
import { clearAuthCookies } from "../auth/auth.utils";
import { AppError } from "../../utils/appError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { UserService } from "./user.service";

const getProfile = catchAsync(async (req: Request, res: Response) => {
	if (!req.user) {
		throw new AppError(httpStatus.UNAUTHORIZED, "You are not logged in");
	}
	const result = await UserService.getProfile(req.user.userId);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Profile fetched successfully",
		data: result,
	});
});

const updateProfile = catchAsync(async (req: Request, res: Response) => {
	if (!req.user) {
		throw new AppError(httpStatus.UNAUTHORIZED, "You are not logged in");
	}
	const result = await UserService.updateProfile(req.user.userId, req.body);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Profile updated successfully",
		data: result,
	});
});

const uploadAvatar = catchAsync(async (req: Request, res: Response) => {
	if (!req.user) {
		throw new AppError(httpStatus.UNAUTHORIZED, "You are not logged in");
	}
	if (!req.file) {
		throw new AppError(httpStatus.BAD_REQUEST, "No image file provided");
	}
	const result = await UserService.uploadAvatar(req.user.userId, req.file);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Avatar uploaded successfully",
		data: result,
	});
});

const removeAvatar = catchAsync(async (req: Request, res: Response) => {
	if (!req.user) {
		throw new AppError(httpStatus.UNAUTHORIZED, "You are not logged in");
	}
	const result = await UserService.removeAvatar(req.user.userId);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Avatar removed successfully",
		data: result,
	});
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
	if (!req.user) {
		throw new AppError(httpStatus.UNAUTHORIZED, "You are not logged in");
	}
	await UserService.changePassword(req.user.userId, req.body);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Password changed successfully",
		data: null,
	});
});

const deleteAccount = catchAsync(async (req: Request, res: Response) => {
	if (!req.user) {
		throw new AppError(httpStatus.UNAUTHORIZED, "You are not logged in");
	}
	await UserService.deleteAccount(req.user.userId);
	clearAuthCookies(res);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Account deleted successfully",
		data: null,
	});
});

export const UserController = {
	getProfile,
	updateProfile,
	uploadAvatar,
	removeAvatar,
	changePassword,
	deleteAccount,
};
