import httpStatus from "http-status";
import { cloudinary } from "../../lib/cloudinary";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";
import type { ICreatePlatformPayload, IUpdatePlatformPayload } from "./platform.interface";

const LOGO_FOLDER = "content-automation/platform-logos";

const findByIdOrThrow = async (id: string) => {
	const platform = await prisma.platform.findUnique({ where: { id } });
	if (!platform) {
		throw new AppError(httpStatus.NOT_FOUND, "Platform not found");
	}
	return platform;
};

/** Admin — create; `key` is unique and immutable (design D1). */
const create = async (payload: ICreatePlatformPayload) => {
	const existing = await prisma.platform.findUnique({ where: { key: payload.key } });
	if (existing) {
		throw new AppError(httpStatus.CONFLICT, "A platform with this key already exists");
	}

	return prisma.platform.create({ data: payload });
};

/** Admin — every platform, including inactive ones. */
const listAll = () => prisma.platform.findMany({ orderBy: { sortOrder: "asc" } });

/** Admin — a single platform by id. */
const getById = (id: string) => findByIdOrThrow(id);

/** Admin — update editable fields (name/status/sortOrder/isActive); also how
 * a platform is retired (`isActive: false`, design D3 — never hard-deleted). */
const update = async (id: string, payload: IUpdatePlatformPayload) => {
	await findByIdOrThrow(id);
	return prisma.platform.update({ where: { id }, data: payload });
};

/** Streams a buffer straight to Cloudinary — same pattern as user avatars
 * (user.service.ts streamUpload). */
const streamUpload = (buffer: Buffer): Promise<{ url: string; publicId: string }> => {
	return new Promise((resolve, reject) => {
		const uploadStream = cloudinary.uploader.upload_stream(
			{ folder: LOGO_FOLDER },
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

/** Admin — upload/replace the logo; best-effort deletes the previous asset
 * (design D4, same trade-off as avatars: never fail the upload the admin is
 * waiting on over a stale asset that fails to delete). */
const setLogo = async (id: string, file: Express.Multer.File) => {
	const platform = await findByIdOrThrow(id);

	const uploaded = await streamUpload(file.buffer);

	if (platform.logoPublicId) {
		await cloudinary.uploader.destroy(platform.logoPublicId).catch((error) => {
			console.error(`Failed to delete previous platform logo ${platform.logoPublicId}:`, error);
		});
	}

	return prisma.platform.update({
		where: { id },
		data: { logoUrl: uploaded.url, logoPublicId: uploaded.publicId },
	});
};

/** Public — active platforms ordered by sortOrder, for the connect/publish
 * picker. Inactive (retired) platforms never appear here. */
const listActive = () =>
	prisma.platform.findMany({
		where: { isActive: true },
		orderBy: { sortOrder: "asc" },
	});

export const PlatformService = {
	create,
	listAll,
	getById,
	update,
	setLogo,
	listActive,
};
