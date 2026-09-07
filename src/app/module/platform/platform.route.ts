import httpStatus from "http-status";
import { Router, type NextFunction, type Request, type Response } from "express";
import upload from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AppError } from "../../utils/appError";
import { PlatformController } from "./platform.controller";
import { PlatformValidation } from "./platform.validation";

// Same pattern as user.route.ts's uploadAvatarFile — convert multer's own
// errors (bad mimetype, oversized file) into a standard AppError/400 instead
// of falling through to the generic 500 branch.
const uploadLogoFile = (req: Request, res: Response, next: NextFunction) => {
	upload.single("logo")(req, res, (error: unknown) => {
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

const adminRouter = Router();

adminRouter.post(
	"/",
	auth("ADMIN", "SUPER_ADMIN"),
	validateRequest(PlatformValidation.createPlatform),
	PlatformController.create,
);
adminRouter.get("/", auth("ADMIN", "SUPER_ADMIN"), PlatformController.listAll);
adminRouter.get("/:id", auth("ADMIN", "SUPER_ADMIN"), PlatformController.getById);
adminRouter.patch(
	"/:id",
	auth("ADMIN", "SUPER_ADMIN"),
	validateRequest(PlatformValidation.updatePlatform),
	PlatformController.update,
);
adminRouter.patch(
	"/:id/logo",
	auth("ADMIN", "SUPER_ADMIN"),
	uploadLogoFile,
	PlatformController.setLogo,
);

const publicRouter = Router();

publicRouter.get("/", auth(), PlatformController.listActive);

export const PlatformAdminRoutes = adminRouter;
export const PlatformRoutes = publicRouter;
