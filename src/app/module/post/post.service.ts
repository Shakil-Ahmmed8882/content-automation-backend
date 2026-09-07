import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import { cloudinary } from "../../lib/cloudinary";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";
import type { ICreatePostPayload, IListPostsQuery } from "./post.interface";

const POST_IMAGE_FOLDER = "content-automation/posts";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/** Streams a buffer straight to Cloudinary (same pattern as avatars/logos). */
const streamUpload = (buffer: Buffer): Promise<{ url: string; publicId: string }> => {
	return new Promise((resolve, reject) => {
		const uploadStream = cloudinary.uploader.upload_stream(
			{ folder: POST_IMAGE_FOLDER },
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

/** Create an owner-scoped post. Uploads the optional image first; if the DB
 * insert then fails, best-effort deletes the just-uploaded asset so it isn't
 * orphaned (design risk mitigation). */
const create = async (userId: string, payload: ICreatePostPayload, file?: Express.Multer.File) => {
	let image: { url: string; publicId: string } | null = null;
	if (file) {
		image = await streamUpload(file.buffer);
	}

	try {
		return await prisma.post.create({
			data: {
				userId,
				title: payload.title ?? null,
				content: payload.content,
				imageUrl: image?.url ?? null,
				imagePublicId: image?.publicId ?? null,
			},
		});
	} catch (error) {
		if (image) {
			await cloudinary.uploader.destroy(image.publicId).catch((cleanupError) => {
				console.log(`Failed to clean up orphaned post image ${image?.publicId}:`, cleanupError);
			});
		}
		throw error;
	}
};

/** Owner-scoped list with pagination, sort, and search (design D4). Excludes
 * soft-deleted posts. Returns rows + pagination meta for sendResponse. */
const list = async (userId: string, query: IListPostsQuery) => {
	const page = Math.max(1, Number.parseInt(query.page ?? "", 10) || 1);
	const requestedLimit = Number.parseInt(query.limit ?? "", 10) || DEFAULT_LIMIT;
	const limit = Math.min(Math.max(1, requestedLimit), MAX_LIMIT);
	const skip = (page - 1) * limit;

	// sort = field, optionally prefixed with `-` for descending. Only an
	// allow-listed set of fields is sortable; anything else falls back to newest.
	const sortableFields = new Set(["createdAt", "title"]);
	const rawSort = query.sort ?? "-createdAt";
	const descending = rawSort.startsWith("-");
	const sortField = descending ? rawSort.slice(1) : rawSort;
	const orderBy: Prisma.PostOrderByWithRelationInput = sortableFields.has(sortField)
		? { [sortField]: descending ? "desc" : "asc" }
		: { createdAt: "desc" };

	const where: Prisma.PostWhereInput = {
		userId,
		isDeleted: false,
		...(query.search
			? {
					OR: [
						{ content: { contains: query.search, mode: "insensitive" } },
						{ title: { contains: query.search, mode: "insensitive" } },
					],
				}
			: {}),
	};

	const [data, total] = await Promise.all([
		prisma.post.findMany({ where, skip, take: limit, orderBy }),
		prisma.post.count({ where }),
	]);

	return {
		data,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

/** Owner-scoped single-post read. A non-owned or soft-deleted id resolves to
 * the same 404 — nothing about another user's data is revealed (design D3). */
const getById = async (userId: string, id: string) => {
	const post = await prisma.post.findFirst({ where: { id, userId, isDeleted: false } });
	if (!post) {
		throw new AppError(httpStatus.NOT_FOUND, "Post not found");
	}
	return post;
};

/** Owner-scoped soft-delete: mark deleted, keep the record so publishing
 * history stays readable (design D3). */
const softDelete = async (userId: string, id: string) => {
	const post = await prisma.post.findFirst({ where: { id, userId, isDeleted: false } });
	if (!post) {
		throw new AppError(httpStatus.NOT_FOUND, "Post not found");
	}

	await prisma.post.update({
		where: { id: post.id },
		data: { isDeleted: true, deletedAt: new Date() },
	});
};

export const PostService = {
	create,
	list,
	getById,
	softDelete,
};
