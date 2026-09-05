import httpStatus from "http-status";
import { Router, type NextFunction, type Request, type Response } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import upload from "../../lib/multer";
import { AppError } from "../../utils/appError";
import { UserController } from "./user.controller";
import { UserValidation } from "./user.validation";

const router = Router();

// multer's own errors (bad mimetype, oversized file) reach us via its
// callback, not a thrown exception — convert to the standard AppError/400 so
// they flow through globalErrorHandler like every other validation failure,
// instead of falling through to the generic 500 branch.
const uploadAvatarFile = (req: Request, res: Response, next: NextFunction) => {
	upload.single("avatar")(req, res, (error: unknown) => {
		if (error) {
			next(
				new AppError(
					httpStatus.BAD_REQUEST,
					error instanceof Error ? error.message : "Invalid file",
				),
			);
			return;
		}
		next();
	});
};

router.get("/me", auth(), UserController.getProfile);
router.patch(
	"/me",
	auth(),
	validateRequest(UserValidation.updateProfile),
	UserController.updateProfile,
);
router.patch("/me/avatar", auth(), uploadAvatarFile, UserController.uploadAvatar);
router.delete("/me/avatar", auth(), UserController.removeAvatar);
router.patch(
	"/me/password",
	auth(),
	validateRequest(UserValidation.changePassword),
	UserController.changePassword,
);
router.delete("/me", auth(), UserController.deleteAccount);

export const UserRoutes = router;
