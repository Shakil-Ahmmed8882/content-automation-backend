import app from "./app";
import config from "./app/config";
import { transporter } from "./app/lib/nodemailer";
import { prisma } from "./app/lib/prisma";
import { redisClient } from "./app/lib/redis";
import { startPublishWorker } from "./app/module/execution/execution.worker";
import { seedAdminUsers, seedPlatforms, seedUpcomingFeatures } from "./app/utils/seed";

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
		await seedAdminUsers();

		await redisClient.connect();
		console.log("Connected to redis successfully.");

		// Background publish worker (BullMQ) — drains the publish queue so a
		// "Publish Now" runs independently of the HTTP request (PRD §12/§24).
		startPublishWorker();
		console.log("Publish worker started.");

		app.listen(PORT, () => {
			console.log(`Server is running on port ${PORT}`);
		});

		// Best-effort and in the background, after listen(): an email problem must
		// never stop the app from serving requests (same principle as runtime sends
		// in lib/nodemailer.ts). Awaiting it before listen() delayed every cold
		// start until the SMTP connection timed out — Render's free tier blocks
		// outbound SMTP ports, so verify() can only hang there.
		transporter
			.verify()
			.then(() => console.log("Nodemailer connected successfully."))
			.catch((error) =>
				console.warn("Nodemailer verification failed (emails will silently no-op):", error),
			);
	} catch (error) {
		console.error("Error starting the server:", error);
		await prisma.$disconnect();
		process.exit(1);
	}
};

main();
