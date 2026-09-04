import type { CookieOptions, Response } from "express";
import type { SignOptions } from "jsonwebtoken";
import config from "../../config";
import { jwtUtils } from "../../utils/jwt";
import {
	ACCESS_COOKIE_MAX_AGE,
	ACCESS_TOKEN_COOKIE,
	REFRESH_COOKIE_MAX_AGE,
	REFRESH_TOKEN_COOKIE,
} from "./auth.constant";
import type { IAuthTokens, ITokenUser } from "./auth.interface";

/**
 * Mints a fresh access + refresh token pair for a user. Pure (no `res`) so the
 * service can call it; the controller is responsible for delivering the tokens
 * as cookies via `setAuthCookies`.
 */
export const issueTokens = (user: ITokenUser): IAuthTokens => {
	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return { accessToken, refreshToken };
};

// Environment-aware cookie flags (design D2): cross-site cookies require
// `secure=true` + `sameSite=none` in production; in dev over http we use `lax`
// so the cookie is still sent on same-site localhost requests.
const isProduction = config.node_env === "production";

const baseCookieOptions: CookieOptions = {
	httpOnly: true,
	secure: isProduction,
	sameSite: isProduction ? "none" : "lax",
};

export const setAuthCookies = (res: Response, tokens: IAuthTokens): void => {
	res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
		...baseCookieOptions,
		maxAge: ACCESS_COOKIE_MAX_AGE,
	});
	res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
		...baseCookieOptions,
		maxAge: REFRESH_COOKIE_MAX_AGE,
	});
};

export const clearAuthCookies = (res: Response): void => {
	res.clearCookie(ACCESS_TOKEN_COOKIE, baseCookieOptions);
	res.clearCookie(REFRESH_TOKEN_COOKIE, baseCookieOptions);
};
