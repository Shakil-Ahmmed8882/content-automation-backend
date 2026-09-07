import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/appError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { PostService } from "./post.service";

const requireUser = (req: Request) => {
	if (!req.user) {
		throw new AppError(httpStatus.UNAUTHORIZED, "You are not logged in");
	}
	return req.user;
};

const create = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const result = await PostService.create(user.userId, req.body, req.file);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Post created successfully",
		data: result,
	});
});

const asString = (value: unknown) => (typeof value === "string" ? value : undefined);

const list = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const { data, meta } = await PostService.list(user.userId, {
		page: asString(req.query.page),
		limit: asString(req.query.limit),
		sort: asString(req.query.sort),
		search: asString(req.query.search),
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Posts fetched successfully",
		data,
		meta,
	});
});

const getById = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	const result = await PostService.getById(user.userId, req.params.id as string);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Post fetched successfully",
		data: result,
	});
});

const remove = catchAsync(async (req: Request, res: Response) => {
	const user = requireUser(req);
	await PostService.softDelete(user.userId, req.params.id as string);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Post deleted successfully",
		data: null,
	});
});

export const PostController = {
	create,
	list,
	getById,
	remove,
};
