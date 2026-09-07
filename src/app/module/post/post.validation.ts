import { z } from "zod";

// Fields arrive as multipart form-data (alongside the optional image), so they
// reach validateRequest as strings. `content` must be non-empty after trim;
// `title` is optional and an empty/whitespace title normalizes to undefined.
const createPost = z.object({
	title: z
		.string()
		.trim()
		.optional()
		.transform((value) => (value && value.length > 0 ? value : undefined)),
	content: z.string().trim().min(1, "Content is required"),
});

export const PostValidation = {
	createPost,
};
