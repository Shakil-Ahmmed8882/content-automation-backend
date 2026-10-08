import crypto from "node:crypto";
import config from "../../config";
import { redisClient } from "../../lib/redis";
import { AppError } from "../../utils/appError";
import { OAUTH_STATE_TTL_SECONDS, oauthStateKey } from "./connection.constant";
import type {
	IOAuthStatePayload,
	OAuthCallbackFailureReason,
	OAuthRedirectErrorCode,
	OAuthRedirectOutcome,
} from "./connection.interface";

/**
 * Issues a single-use anti-forgery `state` (design D2): a random token stored
 * in Redis, bound to the initiating user + platform, with a short TTL. Returned
 * to the caller to embed in the provider's OAuth URL.
 */
export const issueOAuthState = async (payload: IOAuthStatePayload): Promise<string> => {
	const state = crypto.randomBytes(32).toString("hex");
	await redisClient.set(oauthStateKey(state), JSON.stringify(payload), {
		expiration: { type: "EX", value: OAUTH_STATE_TTL_SECONDS },
	});
	return state;
};

/**
 * Validates and CONSUMES a `state` on the OAuth callback. Returns the bound
 * payload on success, or null if the state is unknown/expired/already used —
 * the delete makes it strictly single-use, defeating replay.
 */
export const consumeOAuthState = async (
	state: string | undefined,
): Promise<IOAuthStatePayload | null> => {
	if (!state) {
		return null;
	}
	const key = oauthStateKey(state);
	const raw = await redisClient.get(key);
	if (!raw) {
		return null;
	}
	await redisClient.del(key);
	return JSON.parse(raw) as IOAuthStatePayload;
};

/**
 * A callback rejection the redirect branch needs to classify (invalid/expired
 * state vs. a missing code). Still an `AppError` with the same status and
 * message as before, so the JSON branch and `globalErrorHandler` are unchanged.
 */
export class OAuthCallbackError extends AppError {
	// Private field + getter (not an own enumerable property) so it never shows up
	// when `globalErrorHandler` serializes the error in development: the JSON body
	// stays byte-identical to the plain `AppError` it replaced.
	readonly #reason: OAuthCallbackFailureReason;

	constructor(statusCode: number, message: string, reason: OAuthCallbackFailureReason) {
		super(statusCode, message);
		this.#reason = reason;
	}

	get reason(): OAuthCallbackFailureReason {
		return this.#reason;
	}
}

/**
 * Decides whether the OAuth callback request is a browser NAVIGATION (the
 * provider redirected the user's browser here) or a programmatic call (fetch/XHR
 * from the frontend `/connections/callback/[platform]` page, Postman, tests).
 *
 * Rule: `Sec-Fetch-Mode` decides when the browser sends it (`navigate` = a
 * navigation; `cors`/`same-origin`/`no-cors` = a script request). Browsers that
 * predate Fetch Metadata (Safari < 16.4) don't send it, so only then fall back
 * to `Accept`: a navigation asks for `text/html`, a programmatic caller asks
 * for `application/json` or a wildcard. Anything else is programmatic, so callers
 * that never opted in keep getting the JSON response.
 */
export const isBrowserNavigation = (req: { get(name: string): string | undefined }): boolean => {
	const fetchMode = req.get("sec-fetch-mode");
	if (fetchMode) {
		return fetchMode.trim().toLowerCase() === "navigate";
	}

	const accept = (req.get("accept") ?? "").toLowerCase();
	return accept.includes("text/html") && !accept.includes("application/json");
};

// `error` values providers send when the user declines consent (LinkedIn:
// access_denied / user_cancelled_login / user_cancelled_authorize; Facebook:
// access_denied). Compared against this fixed list only — never echoed.
const PROVIDER_CANCEL_ERRORS = new Set([
	"access_denied",
	"user_cancelled_login",
	"user_cancelled_authorize",
]);

/** True when the provider's `?error=` says the user cancelled/denied consent. */
export const isProviderCancellation = (providerError: unknown): boolean =>
	typeof providerError === "string" && PROVIDER_CANCEL_ERRORS.has(providerError);

/**
 * Maps a thrown callback error to the fixed `?error=` code. An invalid/expired
 * state is `invalid-state`; a missing code is `cancelled` when the provider said
 * the user declined (otherwise `failed`); everything else is `failed`.
 */
export const classifyCallbackFailure = (
	error: unknown,
	providerError: unknown,
): OAuthRedirectErrorCode => {
	if (error instanceof OAuthCallbackError) {
		if (error.reason === "invalid-state") {
			return "invalid-state";
		}
		if (error.reason === "missing-code" && isProviderCancellation(providerError)) {
			return "cancelled";
		}
	}
	return "failed";
};

// The one frontend page a callback navigation lands on. Fixed — never derived
// from the request.
const FRONTEND_CONNECTIONS_PATH = "/connections";
const HTTP_ORIGIN = /^https?:\/\//i;
const TRAILING_SLASHES = /\/+$/;

/**
 * Builds the redirect target for a callback that arrived as a navigation:
 * `${FRONTEND_URL}/connections` plus ONE fixed query param. Built only from
 * config plus fixed codes (plus the platform key of the row we just stored) —
 * no request input is reflected, so there is no open redirect, and no code,
 * token, provider message or id is ever put in the URL. A trailing slash on
 * FRONTEND_URL is tolerated. Returns null when FRONTEND_URL is missing or not
 * an http(s) origin, so the caller falls back to the JSON response.
 */
export const buildConnectionsRedirectUrl = (outcome: OAuthRedirectOutcome): string | null => {
	const base = config.frontend_url?.trim().replace(TRAILING_SLASHES, "");
	if (!base || !HTTP_ORIGIN.test(base)) {
		return null;
	}

	const params = new URLSearchParams();
	if (outcome.kind === "connected") {
		params.set("connected", outcome.platformKey);
	} else if (outcome.kind === "select-page") {
		// Only Facebook has a two-step connect, and the frontend picker is keyed on it.
		params.set("select", "facebook");
	} else {
		params.set("error", outcome.code);
	}

	return `${base}${FRONTEND_CONNECTIONS_PATH}?${params.toString()}`;
};

/** True when a frontend URL is configured, i.e. a redirect target can be built. */
export const canRedirectToFrontend = (): boolean =>
	buildConnectionsRedirectUrl({ kind: "error", code: "failed" }) !== null;
