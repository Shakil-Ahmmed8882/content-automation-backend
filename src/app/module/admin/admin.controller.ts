import type { Request, Response } from "express";
import httpStatus from "http-status";
import { auditContext, writeAuditLog } from "../../utils/audit";
import { AppError } from "../../utils/appError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AdminService } from "./admin.service";

const requireUser = (req: Request) => {
	if (!req.user) {
		throw new AppError(httpStatus.UNAUTHORIZED, "You are not logged in");
	}
	return req.user;
};

const asString = (value: unknown) => (typeof value === "string" ? value : undefined);

// GET /admin/users — paginated, searchable user list. Safe projection only.
const listUsers = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await AdminService.listUsers({
		page: asString(req.query.page),
		limit: asString(req.query.limit),
		search: asString(req.query.search),
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Users fetched successfully",
		data,
		meta,
	});
});

// GET /admin/users/:id — safe projection; 404 if missing.
const getUser = catchAsync(async (req: Request, res: Response) => {
	const result = await AdminService.getUser(req.params.id as string);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User fetched successfully",
		data: result,
	});
});

// PATCH /admin/users/:id/status — block/unblock; audits the transition.
const setStatus = catchAsync(async (req: Request, res: Response) => {
	const actor = requireUser(req);
	const targetId = req.params.id as string;
	const result = await AdminService.setStatus(actor.userId, targetId, req.body.status);

	await writeAuditLog({
		...auditContext(req),
		action: req.body.status === "BLOCKED" ? "USER_BLOCKED" : "USER_UNBLOCKED",
		entityType: "User",
		entityId: targetId,
		metadata: { status: result.status },
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User status updated successfully",
		data: result,
	});
});

// PATCH /admin/users/:id/role — SUPER_ADMIN only (enforced at the route);
// audits the transition.
const setRole = catchAsync(async (req: Request, res: Response) => {
	const actor = requireUser(req);
	const targetId = req.params.id as string;
	const result = await AdminService.setRole(actor.userId, targetId, req.body.role);

	await writeAuditLog({
		...auditContext(req),
		action: "USER_ROLE_CHANGED",
		entityType: "User",
		entityId: targetId,
		metadata: { role: result.role },
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User role updated successfully",
		data: result,
	});
});

// PATCH /admin/users/:id/premium — grant/revoke premium directly (no
// payment); audits the transition.
const setPremium = catchAsync(async (req: Request, res: Response) => {
	const targetId = req.params.id as string;
	const result = await AdminService.setPremium(targetId, req.body.isPremium);

	await writeAuditLog({
		...auditContext(req),
		action: req.body.isPremium ? "USER_PREMIUM_GRANTED" : "USER_PREMIUM_REVOKED",
		entityType: "User",
		entityId: targetId,
		metadata: { isPremium: result.isPremium, premiumSince: result.premiumSince },
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User premium status updated successfully",
		data: result,
	});
});

// GET /admin/audit-logs — paginated, newest first, optionally filtered by
// exact actorId/action/entityType.
const listAuditLogs = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await AdminService.listAuditLogs({
		page: asString(req.query.page),
		limit: asString(req.query.limit),
		actorId: asString(req.query.actorId),
		action: asString(req.query.action),
		entityType: asString(req.query.entityType),
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Audit logs fetched successfully",
		data,
		meta,
	});
});

export const AdminController = {
	listUsers,
	getUser,
	setStatus,
	setRole,
	setPremium,
	listAuditLogs,
};
