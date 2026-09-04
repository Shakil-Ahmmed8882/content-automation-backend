import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import type z from "zod";
import { AppError } from "../utils/appError";
import { catchAsync } from "../utils/catchAsync";

export const validateRequest = (zodSchema: z.ZodTypeAny) => {
	return catchAsync((req: Request, _res: Response, next: NextFunction) => {
		const payload = req.body ?? {};
		const result = zodSchema.safeParse(payload);

		if (!result.success) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				result.error.issues.map((issue) => issue.message).join(", "),
			);
		}

		req.body = result.data;
		next();
	});
};
