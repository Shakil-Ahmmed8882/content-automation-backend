import { afterAll, beforeAll } from "vitest";
import { redisClient } from "../src/app/lib/redis";

// Runs once per test file (vitest isolates a module graph per file). Mirrors
// the real boot sequence in src/server.ts, minus app.listen()/nodemailer —
// supertest drives the Express app in-process and email sending is
// fire-and-forget (see lib/nodemailer.ts), so neither is needed here.
//
// Prisma is intentionally NOT disconnected here: test files run their own
// cleanup (deleting rows they created) in an `afterAll`, and hook ordering
// between a setup file and the test file's own hooks isn't guaranteed —
// disconnecting here could race that cleanup. The process exits right after
// the run anyway, which closes the pool.
beforeAll(async () => {
	await redisClient.connect();
});

afterAll(async () => {
	await redisClient.quit();
});
