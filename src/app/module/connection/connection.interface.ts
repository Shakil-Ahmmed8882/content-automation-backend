/** The resolved credential + identity a connector produces from an OAuth code,
 * ready to be encrypted and stored as a SocialConnection. */
export interface IConnectorConnection {
	platformAccountId?: string;
	platformAccountName?: string;
	accessToken: string;
	refreshToken?: string;
	expiresAt?: Date;
	metadata?: Record<string, unknown>;
}

/** A Facebook Page the user administers (from /me/accounts). `accessToken` is
 * the Page token we store if this Page is selected — never returned to a client. */
export interface IFacebookPage {
	id: string;
	name: string;
	accessToken: string;
}

/**
 * A connector's callback outcome. Single-step providers (LinkedIn) resolve
 * straight to a `connection`; two-step providers (Facebook) return the Pages to
 * choose from plus the transient user token held while the user selects
 * (design D4).
 */
export type ICallbackResult =
	| { kind: "connection"; connection: IConnectorConnection }
	| { kind: "select-page"; userToken: string; userTokenExpiresAt?: Date; pages: IFacebookPage[] };

/**
 * A per-provider OAuth strategy keyed on `platform.key` (design D1). The
 * connect/callback service shell is generic and dispatches to one of these; a
 * new provider is a new connector registered in the registry, no shell change.
 */
export interface ISocialConnector {
	key: string;
	/** Build the provider's OAuth authorization URL for this anti-forgery state. */
	buildAuthUrl(state: string): string;
	/** Exchange the authorization code for a connection (or Pages to choose from). */
	handleCallback(code: string): Promise<ICallbackResult>;
}

/** What we stash in Redis (JSON) tying an OAuth `state` to the initiating user. */
export interface IOAuthStatePayload {
	userId: string;
	platformKey: string;
}

/** The transient Facebook Page-selection stash (Redis), keyed by userId. The
 * user token and Page tokens are encrypted even here — they're real secrets. */
export interface IFacebookPageSelection {
	userTokenEncrypted: string;
	userTokenExpiresAt?: string;
	pages: Array<{ id: string; name: string; accessTokenEncrypted: string }>;
}
