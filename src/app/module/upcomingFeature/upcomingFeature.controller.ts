import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/appError";
import { auditContext, writeAuditLog } from "../../utils/audit";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { UpcomingFeatureService } from "./upcomingFeature.service";

const create = catchAsync(async (req: Request, res: Response) => {
	const result = await UpcomingFeatureService.create(req.body);

	// Best-effort, additive audit entry — never breaks the response below.
	await writeAuditLog({
		...auditContext(req),
		action: "FEATURE_CREATED",
		entityType: "UpcomingFeature",
		entityId: result.id,
		metadata: { slug: result.slug, title: result.title },
	});

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Upcoming feature created successfully",
		data: result,
	});
});

const listAll = catchAsync(async (_req: Request, res: Response) => {
	const result = await UpcomingFeatureService.listAll();

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Upcoming features fetched successfully",
		data: result,
	});
});

const getById = catchAsync(async (req: Request, res: Response) => {
	const result = await UpcomingFeatureService.getById(req.params.id as string);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Upcoming feature fetched successfully",
		data: result,
	});
});

const update = catchAsync(async (req: Request, res: Response) => {
	const result = await UpcomingFeatureService.update(req.params.id as string, req.body);

	// Best-effort, additive audit entry — never breaks the response below.
	await writeAuditLog({
		...auditContext(req),
		action: "FEATURE_UPDATED",
		entityType: "UpcomingFeature",
		entityId: result.id,
		metadata: { slug: result.slug, title: result.title, status: result.status },
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Upcoming feature updated successfully",
		data: result,
	});
});

const remove = catchAsync(async (req: Request, res: Response) => {
	const id = req.params.id as string;
	await UpcomingFeatureService.remove(id);

	// Best-effort, additive audit entry — never breaks the response below.
	await writeAuditLog({
		...auditContext(req),
		action: "FEATURE_DELETED",
		entityType: "UpcomingFeature",
		entityId: id,
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Upcoming feature deleted successfully",
		data: null,
	});
});

const setImage = catchAsync(async (req: Request, res: Response) => {
	if (!req.file) {
		throw new AppError(httpStatus.BAD_REQUEST, "No image file provided");
	}
	const result = await UpcomingFeatureService.setImage(req.params.id as string, req.file);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Upcoming feature image updated successfully",
		data: result,
	});
});

const listVisible = catchAsync(async (_req: Request, res: Response) => {
	const result = await UpcomingFeatureService.listVisible();

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Upcoming features fetched successfully",
		data: result,
	});
});

const getBySlug = catchAsync(async (req: Request, res: Response) => {
	const result = await UpcomingFeatureService.getBySlug(req.params.slug as string);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Upcoming feature fetched successfully",
		data: result,
	});
});

export const UpcomingFeatureController = {
	create,
	listAll,
	getById,
	update,
	remove,
	setImage,
	listVisible,
	getBySlug,
};
