import crypto from "node:crypto";
import { redisClient } from "../../lib/redis";
import { OAUTH_STATE_TTL_SECONDS, oauthStateKey } from "./connection.constant";
import type { IOAuthStatePayload } from "./connection.interface";

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
