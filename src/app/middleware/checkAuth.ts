import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import type { JwtPayload } from "jsonwebtoken";
import config from "../config";
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
 * JWT auth plumbing — verifies the access token and attaches its payload to
 * req.user. Kept model-agnostic on purpose: it does NOT read the DB or assume
 * any role set. Once the data model exists, extend it (e.g. re-check the user's
 * status/role from the database).
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

		const { userId, email, name, role } = verifiedToken.data as JwtPayload;

		if (requiredRoles.length && !requiredRoles.includes(role)) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"Forbidden. You don't have permission to access this resource.",
			);
		}

		req.user = { userId, email, name, role };

		next();
	});
};
