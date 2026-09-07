import httpStatus from "http-status";
import config from "../../../config";
import { decrypt } from "../../../lib/crypto";
import { AppError } from "../../../utils/appError";
import type { IPublishResult, IPublisherConnection, SocialPublisher } from "./publisher.interface";

// Publishes to the connected Facebook Page. The stored connection carries the
// Page id (platformAccountId) and the Page access token. A text post goes to
// /{pageId}/feed; an image posts to /{pageId}/photos by URL with the content as
// the caption (design D5 — media is fetched from the stored image URL).
const apiBase = () => `https://graph.facebook.com/${config.facebook_api_version}`;

const publish = async (
	content: string,
	imageUrl: string | null,
	connection: IPublisherConnection,
): Promise<IPublishResult> => {
	if (!connection.platformAccountId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"This Facebook connection is missing its Page id — reconnect Facebook and retry",
		);
	}
	const pageToken = decrypt(connection.accessToken);
	const pageId = connection.platformAccountId;

	if (imageUrl) {
		const res = await fetch(`${apiBase()}/${pageId}/photos`, {
			method: "POST",
			body: new URLSearchParams({ url: imageUrl, caption: content, access_token: pageToken }),
		});
		if (!res.ok) {
			throw new AppError(
				httpStatus.BAD_GATEWAY,
				"Facebook rejected the photo post — the Page token may be expired; reconnect Facebook and retry",
			);
		}
		const created = (await res.json().catch(() => ({}))) as { id?: string; post_id?: string };
		const externalPostId = created.post_id ?? created.id ?? "";
		return {
			externalPostId,
			externalPostUrl: externalPostId ? `https://www.facebook.com/${externalPostId}` : undefined,
		};
	}

	const res = await fetch(`${apiBase()}/${pageId}/feed`, {
		method: "POST",
		body: new URLSearchParams({ message: content, access_token: pageToken }),
	});
	if (!res.ok) {
		throw new AppError(
			httpStatus.BAD_GATEWAY,
			"Facebook rejected the post — the Page token may be expired; reconnect Facebook and retry",
		);
	}
	const created = (await res.json().catch(() => ({}))) as { id?: string };
	const externalPostId = created.id ?? "";
	return {
		externalPostId,
		externalPostUrl: externalPostId ? `https://www.facebook.com/${externalPostId}` : undefined,
	};
};

export const facebookPublisher: SocialPublisher = { key: "facebook", publish };
