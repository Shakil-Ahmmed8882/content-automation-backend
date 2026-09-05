import { authLimiter } from "../../src/app/middleware/rateLimiter";

// express-rate-limit keys by req.ip; a loopback supertest request can surface
// as any of these depending on the Node/OS IPv4-vs-IPv6 stack.
const RATE_LIMIT_KEY_CANDIDATES = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

/** Resets the shared 20-req/15min authLimiter bucket (see
 * middleware/rateLimiter.ts) for every loopback key variant. Call in a
 * `beforeEach` so unrelated tests never see 429s leak in from earlier ones —
 * only a test specifically about rate limiting should ever see one. */
export const resetAuthRateLimit = () =>
	Promise.all(RATE_LIMIT_KEY_CANDIDATES.map((ip) => authLimiter.resetKey(ip)));
