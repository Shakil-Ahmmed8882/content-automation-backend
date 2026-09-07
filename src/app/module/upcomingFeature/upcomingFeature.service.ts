import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { cloudinary } from "../../lib/cloudinary";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";
import type {
	ICreateUpcomingFeaturePayload,
	IUpdateUpcomingFeaturePayload,
} from "./upcomingFeature.interface";

const FEATURE_IMAGE_FOLDER = "content-automation/upcoming-features";

const findByIdOrThrow = async (id: string) => {
	const feature = await prisma.upcomingFeature.findUnique({ where: { id } });
	if (!feature) {
		throw new AppError(httpStatus.NOT_FOUND, "Upcoming feature not found");
	}
	return feature;
};

/** Admin — create; `slug` is unique (mirrors platform.service's `key`). */
const create = async (payload: ICreateUpcomingFeaturePayload) => {
	try {
		return await prisma.upcomingFeature.create({ data: payload });
	} catch (error) {
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
			throw new AppError(httpStatus.CONFLICT, "A feature with this slug already exists");
		}
		throw error;
	}
};

/** Admin — every feature, including hidden ones, ordered by sortOrder. */
const listAll = () => prisma.upcomingFeature.findMany({ orderBy: { sortOrder: "asc" } });

/** Admin — a single feature by id. */
const getById = (id: string) => findByIdOrThrow(id);

/** Admin — update editable fields. Same unique-slug conflict as `create`. */
const update = async (id: string, payload: IUpdateUpcomingFeaturePayload) => {
	await findByIdOrThrow(id);

	try {
		return await prisma.upcomingFeature.update({ where: { id }, data: payload });
	} catch (error) {
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
			throw new AppError(httpStatus.CONFLICT, "A feature with this slug already exists");
		}
		throw error;
	}
};

/** Admin — hard delete. No downstream FKs reference this table, unlike
 * Platform/Post/User, so there's nothing to preserve by soft-deleting. */
const remove = async (id: string) => {
	await findByIdOrThrow(id);
	await prisma.upcomingFeature.delete({ where: { id } });
};

/** Streams a buffer straight to Cloudinary — same pattern as platform logos /
 * post images. */
const streamUpload = (buffer: Buffer): Promise<{ url: string; publicId: string }> => {
	return new Promise((resolve, reject) => {
		const uploadStream = cloudinary.uploader.upload_stream(
			{ folder: FEATURE_IMAGE_FOLDER },
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

/** Admin — upload/replace the feature image; best-effort deletes the previous
 * asset (same trade-off as platform logos: never fail the upload the admin is
 * waiting on over a stale asset that fails to delete). */
const setImage = async (id: string, file: Express.Multer.File) => {
	const feature = await findByIdOrThrow(id);

	const uploaded = await streamUpload(file.buffer);

	if (feature.imagePublicId) {
		await cloudinary.uploader.destroy(feature.imagePublicId).catch((error) => {
			console.log(
				`Failed to delete previous upcoming feature image ${feature.imagePublicId}:`,
				error,
			);
		});
	}

	return prisma.upcomingFeature.update({
		where: { id },
		data: { imageUrl: uploaded.url, imagePublicId: uploaded.publicId },
	});
};

/** Premium — every premium-visible feature, ordered by sortOrder (MVP: no
 * further filtering beyond `isPremiumVisible`). */
const listVisible = () =>
	prisma.upcomingFeature.findMany({
		where: { isPremiumVisible: true },
		orderBy: { sortOrder: "asc" },
	});

/** Premium — a single feature by slug. A hidden (non-premium-visible) slug
 * resolves to the same 404 as a nonexistent one — nothing about it leaks. */
const getBySlug = async (slug: string) => {
	const feature = await prisma.upcomingFeature.findFirst({
		where: { slug, isPremiumVisible: true },
	});
	if (!feature) {
		throw new AppError(httpStatus.NOT_FOUND, "Upcoming feature not found");
	}
	return feature;
};

export const UpcomingFeatureService = {
	create,
	listAll,
	getById,
	update,
	remove,
	setImage,
	listVisible,
	getBySlug,
};
