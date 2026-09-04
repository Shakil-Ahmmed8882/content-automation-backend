import config from "../config";
import { redisClient } from "./redis";

// Readable time units in seconds, so every TTL/expiry value below reads
// like "10 minutes" instead of a bare "600".
const SECONDS = 1;
const MINUTES = 60 * SECONDS;
const HOURS = 60 * MINUTES;
const DAYS = 24 * HOURS;

export const getBkashGrantIdToken = async () => {
	try {
		// Redis keys where we cache the id token (short-lived) and the
		// refresh token (long-lived), so we don't hit bKash's auth API
		// on every single request.
		const idTokenRedisKey = "bkash:id_token";
		const refreshTokenRedisKey = "bkash:refresh_token";

		// bKash allows at most 2 refresh-token calls per hour and blocks
		// you for an hour if you go over. These two keys make sure that
		// limit can never be exceeded even if many requests hit this
		// function at the same time:
		//  - refreshLockKey: only ONE concurrent caller is allowed to
		//    actually perform a refresh; everyone else waits for it.
		//  - refreshCountKey: a rolling 1-hour counter of how many
		//    refresh calls we've made; once it hits 2 we stop refreshing
		//    and fall back to a full grant call instead.
		const refreshLockKey = "bkash:refresh_lock";
		const refreshCountKey = "bkash:refresh_count";
		const MAX_REFRESHES_PER_HOUR = 2;

		let bkashIdToken = await redisClient.get(idTokenRedisKey);
		const bkashRefreshToken = await redisClient.get(refreshTokenRedisKey);

		// Don't wait until the id token is fully expired to refresh it.
		// bKash id tokens live for 1 hour (see the "EX" below), so if
		// there's less than this many seconds left, treat it the same as
		// "missing" and refresh now — otherwise a payment request could
		// start with a token that dies mid-call.
		const REFRESH_BEFORE_EXPIRY_SECONDS = 5 * MINUTES;

		// ttl() returns seconds remaining, or -2 if the key doesn't exist,
		// or -1 if the key exists with no expiry set.
		const idTokenTtlSeconds = await redisClient.ttl(idTokenRedisKey);
		const idTokenIsCloseToExpiry =
			idTokenTtlSeconds >= 0 && idTokenTtlSeconds < REFRESH_BEFORE_EXPIRY_SECONDS;

		// Case 1: we already have an id token cached AND it still has
		// plenty of time left on it. Nothing to call, just return it.
		if (bkashIdToken && !idTokenIsCloseToExpiry) {
			return bkashIdToken;
		}

		// Case 2: id token is missing, or close enough to expiry that we
		// want a fresh one, but we still have a refresh token. Use it to
		// get a new id token instead of doing a full grant (this is the
		// fix: it used to check "!bkashIdToken && !bkashRefreshToken",
		// which never runs the refresh call because bkashRefreshToken is
		// null in that case).
		if (bkashRefreshToken) {
			// Only let ONE caller through to actually refresh. SET ... NX
			// only succeeds if the key doesn't already exist, so if two
			// requests race here, only one gets "acquired". The lock
			// expires on its own after 10s in case the process dies
			// mid-refresh, so we never get stuck locked forever.
			const acquiredLock = await redisClient.set(refreshLockKey, "1", {
				NX: true,
				expiration: {
					type: "EX",
					value: 10 * SECONDS,
				},
			});

			if (!acquiredLock) {
				// Someone else is already refreshing right now. Just
				// return whatever id token is currently cached — it's
				// either still valid, or about to be replaced by the
				// caller holding the lock.
				const currentIdToken = await redisClient.get(idTokenRedisKey);
				if (currentIdToken) {
					return currentIdToken;
				}
			}

			// Rolling 1-hour counter of refresh calls made. First call in
			// a fresh window sets the 1-hour expiry; bKash blocks us for
			// an hour if we call refresh more than twice in that window,
			// so we hard-stop ourselves at MAX_REFRESHES_PER_HOUR and fall
			// through to a full grant call instead.
			const refreshCallsThisHour = await redisClient.incr(refreshCountKey);
			if (refreshCallsThisHour === 1) {
				await redisClient.expire(refreshCountKey, 1 * HOURS);
			}

			if (refreshCallsThisHour <= MAX_REFRESHES_PER_HOUR) {
				const refreshTokenResponse = await fetch(
					`${config.bkash_base_url}/tokenized/checkout/token/refresh`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Accept: "application/json",
							username: config.bkash_username,
							password: config.bkash_password,
						},
						body: JSON.stringify({
							app_key: config.bkash_app_key,
							app_secret: config.bkash_app_secret,
							refresh_token: bkashRefreshToken,
						}),
					},
				);

				// bug fix: the old code never checked response.ok here, so a
				// failed refresh call silently returned undefined as the token.
				if (!refreshTokenResponse.ok) {
					throw new Error(
						`Failed to refresh Bkash id token: ${refreshTokenResponse.status} ${refreshTokenResponse.statusText}`,
					);
				}

				const refreshTokenResult = await refreshTokenResponse.json();
				const newIdToken = refreshTokenResult.id_token;
				const newRefreshToken = refreshTokenResult.refresh_token;
				bkashIdToken = newIdToken;

				// bug fix: the old code returned here WITHOUT saving the new
				// tokens back to Redis, so every following call would miss
				// the cache and refresh again on every request.
				await redisClient.set(idTokenRedisKey, newIdToken, {
					expiration: {
						type: "EX",
						value: 1 * HOURS,
					},
				});

				await redisClient.set(refreshTokenRedisKey, newRefreshToken, {
					expiration: {
						type: "EX",
						value: 28 * DAYS,
					},
				});

				return bkashIdToken;
			}

			// We already used up our 2 refreshes for this hour. Don't
			// touch the refresh endpoint again — fall through to Case 3
			// below and do a full grant call instead.
		}

		// Case 3: no usable refresh token either (first run, or both
		// expired out of Redis). Do a full grant call.
		const result = await fetch(`${config.bkash_base_url}/tokenized/checkout/token/grant`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				username: config.bkash_username,
				password: config.bkash_password,
			},
			body: JSON.stringify({
				app_key: config.bkash_app_key,
				app_secret: config.bkash_app_secret,
			}),
		});

		if (!result.ok) {
			throw new Error(`Failed to get Bkash grant ID token: ${result.status} ${result.statusText}`);
		}

		const idTokenResult = await result.json();
		const grantedIdToken = idTokenResult.id_token;
		const grantedRefreshToken = idTokenResult.refresh_token;

		// keep id token and refresh token in redis for next time
		await redisClient.set(idTokenRedisKey, grantedIdToken, {
			expiration: {
				type: "EX",
				value: 1 * HOURS,
			},
		});

		await redisClient.set(refreshTokenRedisKey, grantedRefreshToken, {
			expiration: {
				type: "EX",
				value: 28 * DAYS,
			},
		});

		bkashIdToken = grantedIdToken;

		// bug fix: the old code returned "idTokenResult" (the whole
		// response object) here instead of just the token string like
		// the other branches do — inconsistent return type for callers.
		return bkashIdToken;
	} catch (error) {
		throw new Error("Failed to get Bkash grant ID token: " + (error as Error).message);
	}
};
