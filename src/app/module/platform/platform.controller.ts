import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/appError";
import { auditContext, writeAuditLog } from "../../utils/audit";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { PlatformService } from "./platform.service";

const create = catchAsync(async (req: Request, res: Response) => {
	const result = await PlatformService.create(req.body);

	// Best-effort, additive audit entry — never breaks the response below.
	await writeAuditLog({
		...auditContext(req),
		action: "PLATFORM_CREATED",
		entityType: "Platform",
		entityId: result.id,
		metadata: { key: result.key, name: result.name },
	});

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Platform created successfully",
		data: result,
	});
});

const listAll = catchAsync(async (_req: Request, res: Response) => {
	const result = await PlatformService.listAll();

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Platforms fetched successfully",
		data: result,
	});
});

const getById = catchAsync(async (req: Request, res: Response) => {
	const result = await PlatformService.getById(req.params.id as string);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Platform fetched successfully",
		data: result,
	});
});

const update = catchAsync(async (req: Request, res: Response) => {
	const result = await PlatformService.update(req.params.id as string, req.body);

	// Best-effort, additive audit entry — never breaks the response below.
	await writeAuditLog({
		...auditContext(req),
		action: "PLATFORM_UPDATED",
		entityType: "Platform",
		entityId: result.id,
		metadata: {
			key: result.key,
			name: result.name,
			status: result.status,
			isActive: result.isActive,
		},
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Platform updated successfully",
		data: result,
	});
});

const setLogo = catchAsync(async (req: Request, res: Response) => {
	if (!req.file) {
		throw new AppError(httpStatus.BAD_REQUEST, "No image file provided");
	}
	const result = await PlatformService.setLogo(req.params.id as string, req.file);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Platform logo updated successfully",
		data: result,
	});
});

const listActive = catchAsync(async (_req: Request, res: Response) => {
	const result = await PlatformService.listActive();

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Platforms fetched successfully",
		data: result,
	});
});

export const PlatformController = {
	create,
	listAll,
	getById,
	update,
	setLogo,
	listActive,
};
