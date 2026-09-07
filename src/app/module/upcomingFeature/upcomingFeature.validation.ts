import { z } from "zod";
import { UpcomingFeatureStatus } from "../../../generated/prisma/enums";

// Lowercase slug — the stable identifier the premium detail route reads by
// (mirrors platform.validation's `key`), so it's constrained tighter than a
// free-text title.
const SLUG_PATTERN = /^[a-z0-9-]+$/;

const createUpcomingFeature = z.object({
	slug: z
		.string()
		.trim()
		.min(1, "Slug is required")
		.regex(SLUG_PATTERN, "Slug must be a lowercase slug (letters, numbers, hyphens)"),
	title: z.string().trim().min(1, "Title is required"),
	shortDescription: z.string().trim().min(1, "Short description is required"),
	description: z.string().trim().min(1, "Description is required"),
	status: z.enum(UpcomingFeatureStatus).optional(),
	sortOrder: z.number().int().optional(),
	isPremiumVisible: z.boolean().optional(),
});

const updateUpcomingFeature = z.object({
	slug: z
		.string()
		.trim()
		.min(1, "Slug is required")
		.regex(SLUG_PATTERN, "Slug must be a lowercase slug (letters, numbers, hyphens)")
		.optional(),
	title: z.string().trim().min(1, "Title is required").optional(),
	shortDescription: z.string().trim().min(1, "Short description is required").optional(),
	description: z.string().trim().min(1, "Description is required").optional(),
	status: z.enum(UpcomingFeatureStatus).optional(),
	sortOrder: z.number().int().optional(),
	isPremiumVisible: z.boolean().optional(),
});

export const UpcomingFeatureValidation = {
	createUpcomingFeature,
	updateUpcomingFeature,
};
