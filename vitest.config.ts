import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		globals: false,
		// Real Postgres + Redis, run sequentially within a file (order matters —
		// e.g. the rate-limit scenario relies on quota consumed by earlier tests).
		fileParallelism: false,
		testTimeout: 15_000,
		hookTimeout: 15_000,
		setupFiles: ["./tests/setup.ts"],
		env: {
			// Never "production" here — unlocks EXPOSE_OTP_IN_RESPONSE and relaxes
			// cookie flags (secure/sameSite) so supertest's in-process http works.
			NODE_ENV: "test",
		},
	},
});
