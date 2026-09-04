import rateLimit from "express-rate-limit";
import httpStatus from "http-status";

/**
 * Tighter, auth-scoped rate limiter for endpoints that send one-time codes or
 * check credentials (register, verify, login, forgot/reset password). This sits
 * on top of the global limiter in `app.ts` to blunt brute-force and OTP-spam.
 * Keyed by client IP; requests beyond the limit get HTTP 429.
 */
export const authLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 20,
	standardHeaders: true,
	legacyHeaders: false,
	handler: (_req, res) => {
		res.status(httpStatus.TOO_MANY_REQUESTS).json({
			success: false,
			statusCode: httpStatus.TOO_MANY_REQUESTS,
			message: "Too many attempts. Please try again later.",
		});
	},
});
