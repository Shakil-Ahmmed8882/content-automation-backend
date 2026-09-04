import cron from "node-cron";

// Placeholder for scheduled housekeeping (e.g. pruning stale executions or
// expired connection tokens). Registered from server.ts when needed.
export const registerCronJobs = () => {
	// Example (disabled): run every day at 03:00.
	// cron.schedule("0 3 * * *", async () => {
	// 	console.log("Running daily housekeeping...");
	// });
	void cron;
};
