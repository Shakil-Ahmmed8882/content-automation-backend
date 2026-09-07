import config from "../../../config";
import { AppError } from "../../../utils/appError";
import httpStatus from "http-status";
import type { ICallbackResult, ISocialConnector } from "../connection.interface";

// LinkedIn is a single-step connect (design D4): exchange the code for a member
// access token, fetch the member identity via OpenID userinfo, store directly.
// Scopes: openid+profile for identity, w_member_social to post on their behalf.
const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const SCOPE = "openid profile w_member_social";

const buildAuthUrl = (state: string): string => {
	const params = new URLSearchParams({
		response_type: "code",
		client_id: config.linkedin_client_id ?? "",
		redirect_uri: config.linkedin_redirect_uri ?? "",
		state,
		scope: SCOPE,
	});
	return `${AUTH_URL}?${params.toString()}`;
};

const handleCallback = async (code: string): Promise<ICallbackResult> => {
	const tokenRes = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: config.linkedin_redirect_uri ?? "",
			client_id: config.linkedin_client_id ?? "",
			client_secret: config.linkedin_client_secret ?? "",
		}),
	});
	if (!tokenRes.ok) {
		throw new AppError(httpStatus.BAD_GATEWAY, "Failed to exchange LinkedIn authorization code");
	}
	const token = (await tokenRes.json()) as { access_token: string; expires_in?: number };

	const meRes = await fetch(USERINFO_URL, {
		headers: { Authorization: `Bearer ${token.access_token}` },
	});
	if (!meRes.ok) {
		throw new AppError(httpStatus.BAD_GATEWAY, "Failed to fetch LinkedIn member identity");
	}
	const me = (await meRes.json()) as { sub: string; name?: string };

	return {
		kind: "connection",
		connection: {
			platformAccountId: me.sub,
			platformAccountName: me.name,
			accessToken: token.access_token,
			expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
		},
	};
};

export const linkedinConnector: ISocialConnector = {
	key: "linkedin",
	buildAuthUrl,
	handleCallback,
};
