import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { authLimiter } from "../../middleware/rateLimiter";
import { validateRequest } from "../../middleware/validateRequest";
import { AuthController } from "./auth.controller";
import { AuthValidation } from "./auth.validation";

const router = Router();

// Registration + email verification.
router.post(
	"/register",
	authLimiter,
	validateRequest(AuthValidation.register),
	AuthController.register,
);
router.post(
	"/verify-email",
	authLimiter,
	validateRequest(AuthValidation.verifyEmail),
	AuthController.verifyEmail,
);

// Login & session.
router.post("/login", authLimiter, validateRequest(AuthValidation.login), AuthController.login);
router.post("/refresh-token", AuthController.refreshToken);
// Logout is an idempotent cookie-clear — intentionally not auth-guarded so a
// client with an expired session can still clear its stale credentials.
router.post("/logout", AuthController.logout);
router.get("/me", auth(), AuthController.getMe);

// Password recovery.
router.post(
	"/forgot-password",
	authLimiter,
	validateRequest(AuthValidation.forgotPassword),
	AuthController.forgotPassword,
);
router.post(
	"/reset-password",
	authLimiter,
	validateRequest(AuthValidation.resetPassword),
	AuthController.resetPassword,
);

export const AuthRoutes = router;
