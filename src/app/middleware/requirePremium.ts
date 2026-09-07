import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/appError";
import { catchAsync } from "../utils/catchAsync";

/**
 * Premium gate — runs AFTER `auth()`, so `req.user` is already set. Re-reads
 * `isPremium` fresh from the DB by `req.user.userId` on every request (never
 * trusts a client-supplied value or a stale JWT claim, per CLAUDE.md rule 6 —
 * backend is authoritative for premium status).
 */
export const requirePremium = catchAsync(
	async (req: Request, _res: Response, next: NextFunction) => {
		if (!req.user) {
			throw new AppError(
				httpStatus.UNAUTHORIZED,
				"You are not logged in. Please log in to access this resource.",
			);
		}

		const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
		if (!user?.isPremium) {
			throw new AppError(httpStatus.FORBIDDEN, "This area is for premium members");
		}

		next();
	},
);
