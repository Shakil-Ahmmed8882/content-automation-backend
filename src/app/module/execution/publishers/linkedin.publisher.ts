import httpStatus from "http-status";
import { decrypt } from "../../../lib/crypto";
import { AppError } from "../../../utils/appError";
import type { IPublishResult, IPublisherConnection, SocialPublisher } from "./publisher.interface";

// Publishes as the connected LinkedIn member via the UGC Posts API. The stored
// connection carries the member `sub` (platformAccountId) → author URN, and an
// access token with `w_member_social`. Text posts go straight to /ugcPosts; an
// image is registered + uploaded first (assets API), then attached (design D5).
const UGC_POSTS_URL = "https://api.linkedin.com/v2/ugcPosts";
const REGISTER_UPLOAD_URL = "https://api.linkedin.com/v2/assets?action=registerUpload";
const RESTLI_HEADER = { "X-Restli-Protocol-Version": "2.0.0" } as const;

/** Registers a feedshare image upload, streams the bytes from the stored image
 * URL, and returns the asset URN to attach to the post. */
const uploadImageAsset = async (
	accessToken: string,
	authorUrn: string,
	imageUrl: string,
): Promise<string> => {
	const imageRes = await fetch(imageUrl);
	if (!imageRes.ok) {
		throw new AppError(
			httpStatus.BAD_GATEWAY,
			"Could not fetch the post image to publish to LinkedIn",
		);
	}
	const bytes = Buffer.from(await imageRes.arrayBuffer());

	const registerRes = await fetch(REGISTER_UPLOAD_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
			...RESTLI_HEADER,
		},
		body: JSON.stringify({
			registerUploadRequest: {
				recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
				owner: authorUrn,
				serviceRelationships: [
					{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" },
				],
			},
		}),
	});
	if (!registerRes.ok) {
		throw new AppError(httpStatus.BAD_GATEWAY, "LinkedIn image upload could not be registered");
	}
	const register = (await registerRes.json()) as {
		value?: {
			asset?: string;
			uploadMechanism?: {
				"com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"?: { uploadUrl?: string };
			};
		};
	};
	const asset = register.value?.asset;
	const uploadUrl =
		register.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]
			?.uploadUrl;
	if (!asset || !uploadUrl) {
		throw new AppError(
			httpStatus.BAD_GATEWAY,
			"LinkedIn did not return an upload target for the image",
		);
	}

	const uploadRes = await fetch(uploadUrl, {
		method: "POST",
		headers: { Authorization: `Bearer ${accessToken}` },
		body: bytes,
	});
	if (!uploadRes.ok) {
		throw new AppError(httpStatus.BAD_GATEWAY, "LinkedIn rejected the image upload");
	}
	return asset;
};

const publish = async (
	content: string,
	imageUrl: string | null,
	connection: IPublisherConnection,
): Promise<IPublishResult> => {
	if (!connection.platformAccountId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"This LinkedIn connection is missing its member id — reconnect LinkedIn and retry",
		);
	}
	const accessToken = decrypt(connection.accessToken);
	const authorUrn = `urn:li:person:${connection.platformAccountId}`;

	const shareContent: Record<string, unknown> = {
		shareCommentary: { text: content },
		shareMediaCategory: imageUrl ? "IMAGE" : "NONE",
	};
	if (imageUrl) {
		const asset = await uploadImageAsset(accessToken, authorUrn, imageUrl);
		shareContent.media = [{ status: "READY", media: asset }];
	}

	const res = await fetch(UGC_POSTS_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
			...RESTLI_HEADER,
		},
		body: JSON.stringify({
			author: authorUrn,
			lifecycleState: "PUBLISHED",
			specificContent: { "com.linkedin.ugc.ShareContent": shareContent },
			visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
		}),
	});
	if (!res.ok) {
		throw new AppError(
			httpStatus.BAD_GATEWAY,
			res.status === 401
				? "LinkedIn rejected the access token — reconnect LinkedIn and retry"
				: "LinkedIn rejected the post",
		);
	}

	const created = (await res.json().catch(() => ({}))) as { id?: string };
	const externalPostId = created.id ?? res.headers.get("x-restli-id") ?? "";
	return {
		externalPostId,
		externalPostUrl: externalPostId
			? `https://www.linkedin.com/feed/update/${externalPostId}`
			: undefined,
	};
};

export const linkedinPublisher: SocialPublisher = { key: "linkedin", publish };
