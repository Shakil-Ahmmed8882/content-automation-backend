import type { AuthProvider, Role } from "../../../generated/prisma/enums";

export interface IRegisterPayload {
	name: string;
	email: string;
	password: string;
}

export interface IVerifyEmailPayload {
	email: string;
	otp: string;
}

export interface ILoginPayload {
	email: string;
	password: string;
}

export interface IForgotPasswordPayload {
	email: string;
}

export interface IResetPasswordPayload {
	email: string;
	otp: string;
	newPassword: string;
}

/** Shape attached to `req.user` by the `auth()` middleware (from the JWT). */
export interface IRequestUser {
	userId: string;
	email: string;
	name: string;
	role: Role;
}

export interface IAuthTokens {
	accessToken: string;
	refreshToken: string;
}

/** Minimal identity needed to mint a session. */
export interface ITokenUser {
	id: string;
	name: string;
	email: string;
	role: Role;
}

/**
 * Stashed in Redis while a registration awaits OTP verification. The password
 * is already hashed, so plaintext is never persisted anywhere — including Redis.
 */
export interface IPendingRegistration {
	name: string;
	email: string;
	passwordHash: string;
}

/**
 * Verified-identity profile handed to the provider seam
 * (`findOrLinkUserByVerifiedEmail`). `passwordHash` is set only for CREDENTIALS;
 * OAuth providers omit it. The caller guarantees the email is already verified.
 */
export interface IProviderProfile {
	provider: AuthProvider;
	providerAccountId: string;
	name: string;
	email: string;
	passwordHash?: string;
}
