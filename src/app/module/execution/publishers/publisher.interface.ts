/** The connection a publisher needs to post on the user's behalf. `accessToken`
 * is ENCRYPTED at rest (lib/crypto) — the publisher decrypts it itself, so
 * plaintext secrets never live in the service or worker (design D3). */
export interface IPublisherConnection {
	accessToken: string; // encrypted (lib/crypto)
	platformAccountId: string | null;
	platformAccountName: string | null;
}

/** A successful publish: the provider's post id, plus a permalink when the API
 * returns one. */
export interface IPublishResult {
	externalPostId: string;
	externalPostUrl?: string;
}

/** A per-provider publish strategy keyed on `platform.key` (design D3). A new
 * platform = a new publisher registered in the registry; the worker is
 * untouched. Implementations throw an AppError with a clean, secret-free message
 * on failure (spec: reasons must never leak tokens or stack traces). */
export interface SocialPublisher {
	key: string;
	publish(
		content: string,
		imageUrl: string | null,
		connection: IPublisherConnection,
	): Promise<IPublishResult>;
}
