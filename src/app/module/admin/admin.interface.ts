import type { Role, UserStatus } from "../../../generated/prisma/enums";

/** Parsed, normalized query for GET /admin/users (paginated, searchable user
 * list). All optional; the service applies sensible defaults. */
export interface IListUsersQuery {
	page?: string;
	limit?: string;
	search?: string;
}

/** Safe projection of a `users` row for admin views — never password hashes
 * or tokens (those live on `accounts`/JWTs and are never selected here). */
export interface ISafeUser {
	id: string;
	name: string;
	email: string;
	role: Role;
	isPremium: boolean;
	premiumSince: Date | null;
	status: UserStatus;
	emailVerified: boolean;
	isDeleted: boolean;
	createdAt: Date;
}

export interface ISetUserStatusPayload {
	status: UserStatus;
}

export interface ISetUserRolePayload {
	role: Role;
}

export interface ISetUserPremiumPayload {
	isPremium: boolean;
}

/** Parsed, normalized query for GET /admin/audit-logs (paginated, filterable
 * audit trail). All optional; filters are exact-match. */
export interface IListAuditLogsQuery {
	page?: string;
	limit?: string;
	actorId?: string;
	action?: string;
	entityType?: string;
}
