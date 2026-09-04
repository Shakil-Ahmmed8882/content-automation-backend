import { z } from "zod";

const MIN_PASSWORD_LENGTH = 8;

const otp = z
	.string()
	.length(6, "OTP must be exactly 6 digits")
	.regex(/^\d{6}$/, "OTP must contain only digits");

const register = z.object({
	name: z.string().trim().min(1, "Name is required"),
	email: z.email("Invalid email address"),
	password: z
		.string()
		.min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`),
});

const verifyEmail = z.object({
	email: z.email("Invalid email address"),
	otp,
});

const login = z.object({
	email: z.email("Invalid email address"),
	password: z.string().min(1, "Password is required"),
});

const forgotPassword = z.object({
	email: z.email("Invalid email address"),
});

const resetPassword = z.object({
	email: z.email("Invalid email address"),
	otp,
	newPassword: z
		.string()
		.min(
			MIN_PASSWORD_LENGTH,
			`New password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
		),
});

export const AuthValidation = {
	register,
	verifyEmail,
	login,
	forgotPassword,
	resetPassword,
};
