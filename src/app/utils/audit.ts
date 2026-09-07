import type { Request } from "express";
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../lib/prisma";

export interface IWriteAuditLogInput {
	actorId?: string | null;
	action: string;
	entityType: string;
	entityId?: string | null;
	metadata?: unknown;
	ipAddress?: string;
	userAgent?: string;
}

/**
 * Appends one row to `audit_logs` (design D1 — a single, generic, append-only
 * table + a shared writer used by sensitive actions across the app). There is
 * no update/delete path anywhere in the app — this is the only writer.
 *
 * Best-effort by design: a failure here must never break the action that
 * triggered it, so errors are caught and logged, never thrown.
 *
 * Never pass secrets (password hashes, tokens, gateway payloads) in `metadata`.
 */
export const writeAuditLog = async (input: IWriteAuditLogInput): Promise<void> => {
	try {
		await prisma.auditLog.create({
			data: {
				actorId: input.actorId ?? null,
				action: input.action,
				entityType: input.entityType,
				entityId: input.entityId ?? null,
				metadata:
					input.metadata === undefined ? undefined : (input.metadata as Prisma.InputJsonValue),
				ipAddress: input.ipAddress ?? null,
				userAgent: input.userAgent ?? null,
			},
		});
	} catch (error) {
		console.error("[audit] failed to write:", error);
	}
};

/** The common audit fields read off `req` — actor, ip, user agent — for a
 * controller to spread into a `writeAuditLog` call, e.g.
 * `writeAuditLog({ ...auditContext(req), action: "...", entityType: "...", entityId })`. */
export const auditContext = (req: Request) => ({
	actorId: req.user?.userId ?? null,
	ipAddress: req.ip,
	userAgent: req.get("user-agent"),
});
