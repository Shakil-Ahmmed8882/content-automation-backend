import app from "./app";
import config from "./app/config";
import { transporter } from "./app/lib/nodemailer";
import { prisma } from "./app/lib/prisma";
import { redisClient } from "./app/lib/redis";

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

		// NEXT STEP (after the data-modeling session): seed privileged users here.

		await redisClient.connect();
		console.log("Connected to redis successfully.");

		await transporter.verify();
		console.log("Nodemailer connected successfully.");

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
