import { Router, type NextFunction, type Request, type Response } from "express";
import httpStatus from "http-status";
import upload from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { requirePremium } from "../../middleware/requirePremium";
import { validateRequest } from "../../middleware/validateRequest";
import { AppError } from "../../utils/appError";
import { UpcomingFeatureController } from "./upcomingFeature.controller";
import { UpcomingFeatureValidation } from "./upcomingFeature.validation";

// Same pattern as post's uploadPostImage / platform's uploadLogoFile — convert
// multer's own errors (bad mimetype, oversized file) into a standard
// AppError/400 instead of falling through to the generic 500 branch.
const uploadFeatureImage = (req: Request, res: Response, next: NextFunction) => {
	upload.single("image")(req, res, (error: unknown) => {
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
	validateRequest(UpcomingFeatureValidation.createUpcomingFeature),
	UpcomingFeatureController.create,
);
adminRouter.get("/", auth("ADMIN", "SUPER_ADMIN"), UpcomingFeatureController.listAll);
adminRouter.get("/:id", auth("ADMIN", "SUPER_ADMIN"), UpcomingFeatureController.getById);
adminRouter.patch(
	"/:id",
	auth("ADMIN", "SUPER_ADMIN"),
	validateRequest(UpcomingFeatureValidation.updateUpcomingFeature),
	UpcomingFeatureController.update,
);
adminRouter.delete("/:id", auth("ADMIN", "SUPER_ADMIN"), UpcomingFeatureController.remove);
adminRouter.patch(
	"/:id/image",
	auth("ADMIN", "SUPER_ADMIN"),
	uploadFeatureImage,
	UpcomingFeatureController.setImage,
);

const premiumRouter = Router();

// GET / before GET /:slug so "list" never gets swallowed by the detail route.
premiumRouter.get("/", auth(), requirePremium, UpcomingFeatureController.listVisible);
premiumRouter.get("/:slug", auth(), requirePremium, UpcomingFeatureController.getBySlug);

export const UpcomingFeatureAdminRoutes = adminRouter;
export const UpcomingFeatureRoutes = premiumRouter;
