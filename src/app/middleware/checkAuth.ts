import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import type { JwtPayload } from "jsonwebtoken";
import { UserStatus } from "../../generated/prisma/enums";
import config from "../config";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/appError";
import { catchAsync } from "../utils/catchAsync";
import { jwtUtils } from "../utils/jwt";

declare global {
	namespace Express {
		interface Request {
			user?: {
				userId: string;
				email: string;
				name: string;
				role: string;
			};
		}
	}
}

/**
 * JWT auth plumbing — verifies the access token, then re-checks the user's
 * current DB state (not just the JWT claims) on every request: a blocked or
 * soft-deleted user's still-valid access token is refused immediately instead
 * of working until it naturally expires. Mirrors the same check
 * `AuthService.refreshToken`/`login` already do.
 *
 * Usage: auth() for any logged-in user, or auth("ADMIN", "USER") to gate roles.
 */
export const auth = (...requiredRoles: string[]) => {
	return catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
		const token = req.cookies.accessToken
			? req.cookies.accessToken
			: req.headers.authorization?.startsWith("Bearer ")
				? req.headers.authorization?.split(" ")[1]
				: req.headers.authorization;

		if (!token) {
			throw new AppError(
				httpStatus.UNAUTHORIZED,
				"You are not logged in. Please log in to access this resource.",
			);
		}

		const verifiedToken = jwtUtils.verifyToken(token, config.jwt_access_secret);

		if (!verifiedToken.success) {
			throw new AppError(
				httpStatus.UNAUTHORIZED,
				"Your session is invalid or has expired. Please log in again.",
			);
		}

		const { userId } = verifiedToken.data as JwtPayload;

		const user = await prisma.user.findUnique({ where: { id: userId } });
		if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
			throw new AppError(
				httpStatus.UNAUTHORIZED,
				"Your session is no longer valid. Please log in again.",
			);
		}

		if (requiredRoles.length && !requiredRoles.includes(user.role)) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"Forbidden. You don't have permission to access this resource.",
			);
		}

		req.user = { userId: user.id, email: user.email, name: user.name, role: user.role };

		next();
	});
};
