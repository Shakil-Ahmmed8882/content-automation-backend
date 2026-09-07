import app from "./app";
import config from "./app/config";
import { transporter } from "./app/lib/nodemailer";
import { prisma } from "./app/lib/prisma";
import { redisClient } from "./app/lib/redis";
import { startPublishWorker } from "./app/module/execution/execution.worker";
import { seedPlatforms, seedUpcomingFeatures } from "./app/utils/seed";

const PORT = config.port;

// A rejected promise or thrown error nobody awaited (e.g. a background email
// failing after the response was sent) would otherwise crash the process.
process.on("unhandledRejection", (reason) => {
	console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
	console.error("Uncaught exception:", error);
});

const main = async () => {
	try {
		await prisma.$connect();
		console.log("Connected to the database successfully.");

		await seedPlatforms();
		await seedUpcomingFeatures();

		await redisClient.connect();
		console.log("Connected to redis successfully.");

		// Background publish worker (BullMQ) — drains the publish queue so a
		// "Publish Now" runs independently of the HTTP request (PRD §12/§24).
		startPublishWorker();
		console.log("Publish worker started.");

		// Best-effort, never boot-blocking: this repo's .env SMTP creds are a
		// placeholder (no real account configured yet), so verify() always fails
		// here. Same principle as runtime sends (lib/nodemailer.ts) — an email
		// problem must never stop the app from serving requests.
		try {
			await transporter.verify();
			console.log("Nodemailer connected successfully.");
		} catch (error) {
			console.warn("Nodemailer verification failed (emails will silently no-op):", error);
		}

		app.listen(PORT, () => {
			console.log(`Server is running on port ${PORT}`);
		});
	} catch (error) {
		console.error("Error starting the server:", error);
		await prisma.$disconnect();
		process.exit(1);
	}
};

main();
