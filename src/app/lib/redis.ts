import { createClient } from "redis";
import config from "../config";

// node-redis client: OTP flows (registration / forgot-password) and the bKash
// token cache. BullMQ uses its own ioredis connection (see lib/queue.ts).
// RESP2 (not the client default RESP3): this app only ever does plain
// GET/SET/DEL with a TTL — no RESP3-only feature (client-side caching, richer
// reply types) is used — so pinning RESP2 buys broad compatibility with any
// Redis-protocol server (older Redis, Memurai, KeyDB, managed Redis-compatible
// services) instead of requiring RESP3/HELLO support specifically.
export const redisClient = createClient({
	username: config.redis_user,
	password: config.redis_password,
	socket: {
		host: config.redis_host,
		port: Number(config.redis_port),
	},
	RESP: 2,
});
