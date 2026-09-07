import { z } from "zod";

const selectPage = z.object({
	pageId: z.string().trim().min(1, "pageId is required"),
});

export const ConnectionValidation = {
	selectPage,
};
