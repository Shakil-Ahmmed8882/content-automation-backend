import { Router, type NextFunction, type Request, type Response } from "express";
import httpStatus from "http-status";
import upload from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AppError } from "../../utils/appError";
import { PostController } from "./post.controller";
import { PostValidation } from "./post.validation";

// Same pattern as user/platform image routes — convert multer's own errors
// (bad mimetype, oversized file) into a standard AppError/400. Runs BEFORE
// validateRequest so the multipart text fields (title/content) are parsed onto
// req.body first.
const uploadPostImage = (req: Request, res: Response, next: NextFunction) => {
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

const router = Router();

router.post(
	"/",
	auth(),
	uploadPostImage,
	validateRequest(PostValidation.createPost),
	PostController.create,
);
router.get("/", auth(), PostController.list);
router.get("/:id", auth(), PostController.getById);
router.delete("/:id", auth(), PostController.remove);

export const PostRoutes = router;
