import { z } from "zod";
import { PlatformStatus } from "../../../generated/prisma/enums";

// Lowercase slug — this is the stable identifier the backend switches on
// (design D1), so it's constrained tighter than a free-text name.
const KEY_PATTERN = /^[a-z0-9-]+$/;

const createPlatform = z.object({
	key: z
		.string()
		.trim()
		.min(1, "Key is required")
		.regex(KEY_PATTERN, "Key must be a lowercase slug (letters, numbers, hyphens)"),
	name: z.string().trim().min(1, "Name is required"),
	status: z.enum(PlatformStatus).optional(),
	sortOrder: z.number().int().optional(),
	isActive: z.boolean().optional(),
});

// `key` is deliberately absent — immutable once set (design D1).
const updatePlatform = z.object({
	name: z.string().trim().min(1, "Name is required").optional(),
	status: z.enum(PlatformStatus).optional(),
	sortOrder: z.number().int().optional(),
	isActive: z.boolean().optional(),
});

export const PlatformValidation = {
	createPlatform,
	updatePlatform,
};
