import bcrypt from "bcryptjs";
import httpStatus from "http-status";
import { AuthProvider } from "../../../generated/prisma/enums";
import config from "../../config";
import { cloudinary } from "../../lib/cloudinary";
import { renderEmailTemplate } from "../../lib/emailTemplate";
import { nodemailerSend } from "../../lib/nodemailer";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";
import type { IChangePasswordPayload, IUpdateProfilePayload } from "./user.interface";

const saltRounds = Number(config.bcrypt_salt_rounds) || 10;
const AVATAR_FOLDER = "content-automation/avatars";

/** The caller's profile plus their linked login providers (derived from
 * `accounts`, e.g. ["CREDENTIALS","GOOGLE"]) — never includes passwordHash. */
const toProfile = async (userId: string) => {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		include: { accounts: { select: { provider: true } } },
	});
	if (!user || user.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	const { accounts, ...profile } = user;
	return { ...profile, providers: accounts.map((account) => account.provider) };
};

const getProfile = (userId: string) => toProfile(userId);

const updateProfile = async (userId: string, payload: IUpdateProfilePayload) => {
	const user = await prisma.user.findUnique({ where: { id: userId } });
	if (!user || user.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	await prisma.user.update({ where: { id: userId }, data: { name: payload.name } });
	return toProfile(userId);
};

/** Streams a buffer straight to Cloudinary (no temp file) via its
 * upload_stream API — matches design D1; posts reuse this same pattern. */
const streamUpload = (buffer: Buffer): Promise<{ url: string; publicId: string }> => {
	return new Promise((resolve, reject) => {
		const uploadStream = cloudinary.uploader.upload_stream(
			{ folder: AVATAR_FOLDER },
			(error, result) => {
				if (error || !result) {
					reject(error ?? new Error("Cloudinary upload failed"));
					return;
				}
				resolve({ url: result.secure_url, publicId: result.public_id });
			},
		);
		uploadStream.end(buffer);
	});
};

const uploadAvatar = async (userId: string, file: Express.Multer.File) => {
	const user = await prisma.user.findUnique({ where: { id: userId } });
	if (!user || user.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	const uploaded = await streamUpload(file.buffer);

	// Best-effort delete of the previous asset (design risk: a failure here
	// orphans an image but must never fail the upload the user is waiting on).
	if (user.avatarPublicId) {
		await cloudinary.uploader.destroy(user.avatarPublicId).catch((error) => {
			console.log(`Failed to delete previous avatar ${user.avatarPublicId}:`, error);
		});
	}

	await prisma.user.update({
		where: { id: userId },
		data: { avatarUrl: uploaded.url, avatarPublicId: uploaded.publicId },
	});
	return toProfile(userId);
};

const removeAvatar = async (userId: string) => {
	const user = await prisma.user.findUnique({ where: { id: userId } });
	if (!user || user.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	if (user.avatarPublicId) {
		await cloudinary.uploader.destroy(user.avatarPublicId).catch((error) => {
			console.log(`Failed to delete avatar ${user.avatarPublicId}:`, error);
		});
	}

	await prisma.user.update({
		where: { id: userId },
		data: { avatarUrl: null, avatarPublicId: null },
	});
	return toProfile(userId);
};

/**
 * Authenticated password change (design D2) — distinct from auth's
 * unauthenticated OTP reset: requires the current password and only applies
 * to a CREDENTIALS account. OAuth-only accounts are told to use reset instead.
 */
const changePassword = async (userId: string, payload: IChangePasswordPayload) => {
	const account = await prisma.account.findUnique({
		where: { userId_provider: { userId, provider: AuthProvider.CREDENTIALS } },
	});
	if (!account?.passwordHash) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"This account has no password set. Use forgot-password to set one first.",
		);
	}

	const isCurrentValid = await bcrypt.compare(payload.currentPassword, account.passwordHash);
	if (!isCurrentValid) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Current password is incorrect");
	}

	const passwordHash = await bcrypt.hash(payload.newPassword, saltRounds);
	await prisma.account.update({ where: { id: account.id }, data: { passwordHash } });

	const user = await prisma.user.findUnique({ where: { id: userId } });
	if (user) {
		const html = await renderEmailTemplate("password-changed", {
			name: user.name,
			email: user.email,
			changedAt: new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" }),
		});
		await nodemailerSend({ to: user.email, subject: "Your password was changed", html });
	}
};

/**
 * Self-delete (design D3) — soft delete only: reserves the email, ends the
 * session (controller clears cookies), and `checkAuth` already refuses
 * `isDeleted` users so no existing token keeps working. No cascade.
 */
const deleteAccount = async (userId: string) => {
	const user = await prisma.user.findUnique({ where: { id: userId } });
	if (!user || user.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	await prisma.user.update({
		where: { id: userId },
		data: { isDeleted: true, deletedAt: new Date() },
	});
};

export const UserService = {
	getProfile,
	updateProfile,
	uploadAvatar,
	removeAvatar,
	changePassword,
	deleteAccount,
};
