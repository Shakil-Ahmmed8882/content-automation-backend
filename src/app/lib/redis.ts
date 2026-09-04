import { createClient } from "redis";
import config from "../config";

// node-redis client: OTP flows (registration / forgot-password) and the bKash
// token cache. BullMQ uses its own ioredis connection (see lib/queue.ts).
export const redisClient = createClient({
	username: config.redis_user,
	password: config.redis_password,
	socket: {
		host: config.redis_host,
		port: Number(config.redis_port),
	},
});
