import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import type { Role, UserStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";
import type { IListAuditLogsQuery, IListUsersQuery } from "./admin.interface";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/** The only fields an admin view may ever return — never password hashes or
 * tokens (those live on `accounts`/JWTs and are never selected here). */
const SAFE_USER_SELECT = {
	id: true,
	name: true,
	email: true,
	role: true,
	isPremium: true,
	premiumSince: true,
	status: true,
	emailVerified: true,
	isDeleted: true,
	createdAt: true,
} satisfies Prisma.UserSelect;

const findByIdOrThrow = async (id: string) => {
	const user = await prisma.user.findUnique({ where: { id } });
	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}
	return user;
};

/** GET /admin/users — paginated, optionally searched (case-insensitive
 * contains over email/name), newest first. Safe projection only. */
const listUsers = async (query: IListUsersQuery) => {
	const page = Math.max(1, Number.parseInt(query.page ?? "", 10) || 1);
	const requestedLimit = Number.parseInt(query.limit ?? "", 10) || DEFAULT_LIMIT;
	const limit = Math.min(Math.max(1, requestedLimit), MAX_LIMIT);
	const skip = (page - 1) * limit;

	const where: Prisma.UserWhereInput = query.search
		? {
				OR: [
					{ email: { contains: query.search, mode: "insensitive" } },
					{ name: { contains: query.search, mode: "insensitive" } },
				],
			}
		: {};

	const [data, total] = await Promise.all([
		prisma.user.findMany({
			where,
			select: SAFE_USER_SELECT,
			skip,
			take: limit,
			orderBy: { createdAt: "desc" },
		}),
		prisma.user.count({ where }),
	]);

	return {
		data,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

/** GET /admin/users/:id — safe projection; 404 if missing. */
const getUser = async (id: string) => {
	const user = await prisma.user.findUnique({ where: { id }, select: SAFE_USER_SELECT });
	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}
	return user;
};

/** PATCH /admin/users/:id/status — block/unblock. Refuses acting on yourself
 * (self-lockout guard); 404 if the target is missing. */
const setStatus = async (actorId: string, targetId: string, status: UserStatus) => {
	if (actorId === targetId) {
		throw new AppError(httpStatus.BAD_REQUEST, "You cannot change your own status");
	}
	await findByIdOrThrow(targetId);

	return prisma.user.update({
		where: { id: targetId },
		data: { status },
		select: SAFE_USER_SELECT,
	});
};

/** PATCH /admin/users/:id/role — SUPER_ADMIN only (enforced at the route).
 * Refuses acting on yourself (self-lockout guard); 404 if the target is missing. */
const setRole = async (actorId: string, targetId: string, role: Role) => {
	if (actorId === targetId) {
		throw new AppError(httpStatus.BAD_REQUEST, "You cannot change your own role");
	}
	await findByIdOrThrow(targetId);

	return prisma.user.update({ where: { id: targetId }, data: { role }, select: SAFE_USER_SELECT });
};

/** PATCH /admin/users/:id/premium — comp/revoke premium directly, independent
 * of any payment (design D4). Grant stamps `premiumSince`; revoke only flips
 * the flag and leaves `premiumSince` as history of when they first got it. */
const setPremium = async (targetId: string, isPremium: boolean) => {
	const target = await findByIdOrThrow(targetId);

	return prisma.user.update({
		where: { id: targetId },
		data: {
			isPremium,
			...(isPremium ? { premiumSince: target.premiumSince ?? new Date() } : {}),
		},
		select: SAFE_USER_SELECT,
	});
};

/** GET /admin/audit-logs — paginated, newest first, optionally filtered by
 * exact actorId/action/entityType. Entries are append-only (no edit/delete
 * path exists anywhere in the app). */
const listAuditLogs = async (query: IListAuditLogsQuery) => {
	const page = Math.max(1, Number.parseInt(query.page ?? "", 10) || 1);
	const requestedLimit = Number.parseInt(query.limit ?? "", 10) || DEFAULT_LIMIT;
	const limit = Math.min(Math.max(1, requestedLimit), MAX_LIMIT);
	const skip = (page - 1) * limit;

	const where: Prisma.AuditLogWhereInput = {
		...(query.actorId ? { actorId: query.actorId } : {}),
		...(query.action ? { action: query.action } : {}),
		...(query.entityType ? { entityType: query.entityType } : {}),
	};

	const [data, total] = await Promise.all([
		prisma.auditLog.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
		prisma.auditLog.count({ where }),
	]);

	return {
		data,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

export const AdminService = {
	listUsers,
	getUser,
	setStatus,
	setRole,
	setPremium,
	listAuditLogs,
};
