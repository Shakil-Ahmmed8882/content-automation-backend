import { z } from "zod";

const MIN_PASSWORD_LENGTH = 8;

// Deliberately just `name` — Zod strips unrecognized keys by default, so a
// client-supplied `email` is silently dropped, not rejected (spec: "ignore/
// reject the email change and leave email unchanged").
const updateProfile = z.object({
	name: z.string().trim().min(1, "Name is required"),
});

const changePassword = z.object({
	currentPassword: z.string().min(1, "Current password is required"),
	newPassword: z
		.string()
		.min(
			MIN_PASSWORD_LENGTH,
			`New password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
		),
});

export const UserValidation = {
	updateProfile,
	changePassword,
};
