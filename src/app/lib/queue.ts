import { Queue } from "bullmq";
import IORedis from "ioredis";
import config from "../config";

// BullMQ requires an ioredis connection with maxRetriesPerRequest = null.
// This is separate from the node-redis client in lib/redis.ts.
export const bullConnection = new IORedis({
	host: config.redis_host,
	port: Number(config.redis_port),
	password: config.redis_password || undefined,
	maxRetriesPerRequest: null,
});

export const PUBLISH_QUEUE = "publish";

export type PublishJobData = {
	executionId: string;
};

// Producer side: POST /posts/:id/publish enqueues a job here, returns "started",
// and a Worker (to be added in the execution module) runs the publish pipeline
// in the background so the browser can close mid-execution (PRD §12/§24).
export const publishQueue = new Queue<PublishJobData>(PUBLISH_QUEUE, {
	connection: bullConnection,
	defaultJobOptions: {
		attempts: 1, // MVP: manual retry only, no auto-retry (PRD §13)
		removeOnComplete: 100,
		removeOnFail: 500,
	},
});
