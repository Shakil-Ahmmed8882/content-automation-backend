import httpStatus from "http-status";
import config from "../../../config";
import { AppError } from "../../../utils/appError";
import type { ICallbackResult, IFacebookPage, ISocialConnector } from "../connection.interface";

// Facebook is a two-step connect (design D4): exchange the code for a
// short-lived USER token, upgrade it to a long-lived user token, then list the
// user's Pages. The user picks a Page (connection.service), and we store that
// PAGE's token — publishing posts as the Page. Scopes cover Page listing +
// posting.
const apiBase = () => `https://graph.facebook.com/${config.facebook_api_version}`;
const DIALOG_URL = () => `https://www.facebook.com/${config.facebook_api_version}/dialog/oauth`;
const SCOPE = "pages_show_list,pages_manage_posts,pages_read_engagement";

const buildAuthUrl = (state: string): string => {
	const params = new URLSearchParams({
		client_id: config.facebook_app_id ?? "",
		redirect_uri: config.facebook_redirect_uri ?? "",
		state,
		scope: SCOPE,
		response_type: "code",
	});
	return `${DIALOG_URL()}?${params.toString()}`;
};

const handleCallback = async (code: string): Promise<ICallbackResult> => {
	// 1. code → short-lived user token
	const shortParams = new URLSearchParams({
		client_id: config.facebook_app_id ?? "",
		redirect_uri: config.facebook_redirect_uri ?? "",
		client_secret: config.facebook_app_secret ?? "",
		code,
	});
	const shortRes = await fetch(`${apiBase()}/oauth/access_token?${shortParams.toString()}`);
	if (!shortRes.ok) {
		throw new AppError(httpStatus.BAD_GATEWAY, "Failed to exchange Facebook authorization code");
	}
	const shortToken = (await shortRes.json()) as { access_token: string };

	// 2. short-lived → long-lived user token
	const longParams = new URLSearchParams({
		grant_type: "fb_exchange_token",
		client_id: config.facebook_app_id ?? "",
		client_secret: config.facebook_app_secret ?? "",
		fb_exchange_token: shortToken.access_token,
	});
	const longRes = await fetch(`${apiBase()}/oauth/access_token?${longParams.toString()}`);
	if (!longRes.ok) {
		throw new AppError(httpStatus.BAD_GATEWAY, "Failed to obtain a long-lived Facebook token");
	}
	const longToken = (await longRes.json()) as { access_token: string; expires_in?: number };

	// 3. list the user's Pages (each carries its own Page access token)
	const pagesRes = await fetch(
		`${apiBase()}/me/accounts?fields=id,name,access_token&access_token=${longToken.access_token}`,
	);
	if (!pagesRes.ok) {
		throw new AppError(httpStatus.BAD_GATEWAY, "Failed to list Facebook Pages");
	}
	const pagesBody = (await pagesRes.json()) as {
		data: Array<{ id: string; name: string; access_token: string }>;
	};
	const pages: IFacebookPage[] = pagesBody.data.map((page) => ({
		id: page.id,
		name: page.name,
		accessToken: page.access_token,
	}));

	return {
		kind: "select-page",
		userToken: longToken.access_token,
		userTokenExpiresAt: longToken.expires_in
			? new Date(Date.now() + longToken.expires_in * 1000)
			: undefined,
		pages,
	};
};

export const facebookConnector: ISocialConnector = {
	key: "facebook",
	buildAuthUrl,
	handleCallback,
};
