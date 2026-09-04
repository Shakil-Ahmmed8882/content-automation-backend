import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import httpStatus from "http-status";
import type { JwtPayload } from "jsonwebtoken";
import { AuthProvider, UserStatus } from "../../../generated/prisma/enums";
import config from "../../config";
import { renderEmailTemplate } from "../../lib/emailTemplate";
import { nodemailerSend } from "../../lib/nodemailer";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";
import { jwtUtils } from "../../utils/jwt";
import {
	OTP_TTL_MINUTES,
	OTP_TTL_SECONDS,
	passwordResetOtpKey,
	pendingRegistrationKey,
	pendingRegistrationOtpKey,
} from "./auth.constant";
import type {
	IForgotPasswordPayload,
	ILoginPayload,
	IPendingRegistration,
	IProviderProfile,
	IRegisterPayload,
	IResetPasswordPayload,
	IVerifyEmailPayload,
} from "./auth.interface";
import { issueTokens } from "./auth.utils";
import { redisClient } from "../../lib/redis";

const saltRounds = Number(config.bcrypt_salt_rounds) || 10;
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const generateOtp = () => crypto.randomInt(100000, 1000000).toString();
const INVALID_RESET_CODE = "Invalid or expired reset code";

/**
 * The provider seam (design D3/D4). Given a *verified* identity, either returns
 * the user that already owns it, links the new identity onto the user that owns
 * the verified email, or creates a brand-new user + identity. Runs in one
 * transaction so a credentials signup yields exactly one `users` + one
 * `accounts` row. Future OAuth slices call this same function with their own
 * provider/providerAccountId — no reshaping required.
 */
const findOrLinkUserByVerifiedEmail = (profile: IProviderProfile) => {
	const email = normalizeEmail(profile.email);

	return prisma.$transaction(async (tx) => {
		// 1. This exact identity already exists → return its user.
		const existingAccount = await tx.account.findUnique({
			where: {
				provider_providerAccountId: {
					provider: profile.provider,
					providerAccountId: profile.providerAccountId,
				},
			},
			include: { user: true },
		});
		if (existingAccount) {
			return existingAccount.user;
		}

		// 2. A user already owns this verified email → link the new identity.
		const existingUser = await tx.user.findUnique({ where: { email } });
		if (existingUser) {
			await tx.account.create({
				data: {
					userId: existingUser.id,
					provider: profile.provider,
					providerAccountId: profile.providerAccountId,
					passwordHash: profile.passwordHash ?? null,
				},
			});
			return existingUser;
		}

		// 3. Brand-new person → create the user and its first identity together.
		return tx.user.create({
			data: {
				name: profile.name,
				email,
				emailVerified: true,
				accounts: {
					create: {
						provider: profile.provider,
						providerAccountId: profile.providerAccountId,
						passwordHash: profile.passwordHash ?? null,
					},
				},
			},
		});
	});
};

/**
 * Starts registration without touching Postgres. Details (password already
 * hashed) + a single-use OTP are stashed under short-TTL Redis keys and the OTP
 * is emailed. No `users` row exists until `verifyEmail` confirms the code, so an
 * abandoned signup simply expires out of Redis.
 */
const register = async (payload: IRegisterPayload) => {
	const email = normalizeEmail(payload.email);

	const existingUser = await prisma.user.findUnique({ where: { email } });
	if (existingUser) {
		throw new AppError(httpStatus.CONFLICT, "An account with this email already exists");
	}

	const passwordHash = await bcrypt.hash(payload.password, saltRounds);
	const pending: IPendingRegistration = { name: payload.name, email, passwordHash };
	const otp = generateOtp();

	await redisClient.set(pendingRegistrationKey(email), JSON.stringify(pending), {
		expiration: { type: "EX", value: OTP_TTL_SECONDS },
	});
	await redisClient.set(pendingRegistrationOtpKey(email), otp, {
		expiration: { type: "EX", value: OTP_TTL_SECONDS },
	});

	const html = await renderEmailTemplate("verify-email", {
		name: payload.name,
		otp,
		expiresInMinutes: OTP_TTL_MINUTES,
	});
	await nodemailerSend({ to: email, subject: "Verify your email", html });

	return {
		email,
		message: "A verification code has been sent to your email. Enter it to finish signing up.",
	};
};

/**
 * Completes registration: validates the OTP, then creates the user + CREDENTIALS
 * identity through the seam, clears the Redis keys, and mints a session.
 */
const verifyEmail = async (payload: IVerifyEmailPayload) => {
	const email = normalizeEmail(payload.email);

	const existingUser = await prisma.user.findUnique({ where: { email } });
	if (existingUser) {
		throw new AppError(httpStatus.CONFLICT, "An account with this email already exists");
	}

	const otpKey = pendingRegistrationOtpKey(email);
	const savedOtp = await redisClient.get(otpKey);
	if (!savedOtp) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Your verification code has expired. Please register again",
		);
	}
	if (savedOtp !== payload.otp) {
		throw new AppError(httpStatus.BAD_REQUEST, "Invalid verification code");
	}

	const registrationKey = pendingRegistrationKey(email);
	const savedRegistration = await redisClient.get(registrationKey);
	if (!savedRegistration) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Your registration has expired. Please register again",
		);
	}

	const pending = JSON.parse(savedRegistration) as IPendingRegistration;

	const user = await findOrLinkUserByVerifiedEmail({
		provider: AuthProvider.CREDENTIALS,
		providerAccountId: email,
		name: pending.name,
		email,
		passwordHash: pending.passwordHash,
	});

	await redisClient.del([otpKey, registrationKey]);

	const tokens = issueTokens(user);
	return { tokens, user };
};

/**
 * Authenticates a CREDENTIALS identity. Returns a generic error for both unknown
 * email and wrong password (no enumeration); refuses blocked/deleted accounts
 * only after the password is proven, so account state never leaks to a guesser.
 */
const login = async (payload: ILoginPayload) => {
	const email = normalizeEmail(payload.email);

	const account = await prisma.account.findUnique({
		where: {
			provider_providerAccountId: {
				provider: AuthProvider.CREDENTIALS,
				providerAccountId: email,
			},
		},
		include: { user: true },
	});

	if (!account?.passwordHash) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Invalid email or password");
	}

	const isPasswordValid = await bcrypt.compare(payload.password, account.passwordHash);
	if (!isPasswordValid) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Invalid email or password");
	}

	const { user } = account;
	if (user.isDeleted) {
		throw new AppError(httpStatus.FORBIDDEN, "This account has been deleted");
	}
	if (user.status === UserStatus.BLOCKED) {
		throw new AppError(httpStatus.FORBIDDEN, "This account has been blocked");
	}

	const tokens = issueTokens(user);
	return { tokens, user };
};

/** Verifies a refresh token, refuses inactive users, and rotates to a new pair. */
const refreshToken = async (token: string) => {
	const verified = jwtUtils.verifyToken(token, config.jwt_refresh_secret);
	if (!verified.success || !verified.data) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Invalid or expired refresh token");
	}

	const { userId } = verified.data as JwtPayload;
	const user = await prisma.user.findUnique({ where: { id: userId } });
	if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"Your session is no longer valid. Please log in again",
		);
	}

	return { tokens: issueTokens(user) };
};

/** Returns the current user's profile. `users` holds no secrets (the password
 * hash lives on `accounts`), so the row is safe to return as-is. */
const getMe = async (userId: string) => {
	const user = await prisma.user.findUnique({ where: { id: userId } });
	if (!user || user.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}
	return user;
};

/**
 * Sends a reset code only to an active CREDENTIALS account, but ALWAYS returns
 * the same response (design D7) — unknown email, OAuth-only, or blocked accounts
 * get the identical reply and no code, so callers cannot enumerate accounts.
 */
const forgotPassword = async (payload: IForgotPasswordPayload) => {
	const email = normalizeEmail(payload.email);

	const account = await prisma.account.findUnique({
		where: {
			provider_providerAccountId: {
				provider: AuthProvider.CREDENTIALS,
				providerAccountId: email,
			},
		},
		include: { user: true },
	});

	const isEligible =
		Boolean(account?.passwordHash) &&
		account?.user.status === UserStatus.ACTIVE &&
		!account.user.isDeleted;

	if (isEligible && account) {
		const otp = generateOtp();
		await redisClient.set(passwordResetOtpKey(email), otp, {
			expiration: { type: "EX", value: OTP_TTL_SECONDS },
		});

		const html = await renderEmailTemplate("forgot-password", {
			name: account.user.name,
			otp,
			expiresInMinutes: OTP_TTL_MINUTES,
		});
		await nodemailerSend({ to: email, subject: "Reset your password", html });
	}

	return {
		message: "If an account exists for that email, a password reset code has been sent.",
	};
};

/**
 * Sets a new password when a valid, unexpired reset code is presented, then
 * invalidates the code and emails a confirmation. Uses a single generic error
 * for a bad code or a missing account so nothing is revealed.
 */
const resetPassword = async (payload: IResetPasswordPayload) => {
	const email = normalizeEmail(payload.email);
	const otpKey = passwordResetOtpKey(email);

	const savedOtp = await redisClient.get(otpKey);
	if (!savedOtp || savedOtp !== payload.otp) {
		throw new AppError(httpStatus.BAD_REQUEST, INVALID_RESET_CODE);
	}

	const account = await prisma.account.findUnique({
		where: {
			provider_providerAccountId: {
				provider: AuthProvider.CREDENTIALS,
				providerAccountId: email,
			},
		},
		include: { user: true },
	});
	if (!account) {
		throw new AppError(httpStatus.BAD_REQUEST, INVALID_RESET_CODE);
	}

	const passwordHash = await bcrypt.hash(payload.newPassword, saltRounds);
	await prisma.account.update({ where: { id: account.id }, data: { passwordHash } });
	await redisClient.del(otpKey);

	const html = await renderEmailTemplate("password-changed", {
		name: account.user.name,
		email,
		changedAt: new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" }),
	});
	await nodemailerSend({ to: email, subject: "Your password was changed", html });

	return {
		message: "Password reset successfully. You can now log in with your new password.",
	};
};

export const AuthService = {
	register,
	verifyEmail,
	login,
	refreshToken,
	getMe,
	forgotPassword,
	resetPassword,
	findOrLinkUserByVerifiedEmail,
};
