// Temporary local-only fixture: gives the demo user one CONNECTED and one
// EXPIRED social connection so the connections / composer / executions UI can be
// exercised without a real OAuth consent round trip. The tokens are dummies, so
// an actual publish attempt will fail at the provider (which is itself useful
// for verifying the failure and retry states). Delete when real connections exist.
import { prisma } from "../src/app/lib/prisma";
import { encrypt } from "../src/app/lib/crypto";

const DEMO_EMAIL = "demo@content-automation.test";

async function main() {
	const user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
	if (!user) throw new Error(`Demo user ${DEMO_EMAIL} not found`);

	const platforms = await prisma.platform.findMany();
	const linkedin = platforms.find((p) => p.key === "linkedin");
	const facebook = platforms.find((p) => p.key === "facebook");

	const hour = 60 * 60 * 1000;

	if (linkedin) {
		await prisma.socialConnection.upsert({
			where: { userId_platformId: { userId: user.id, platformId: linkedin.id } },
			create: {
				userId: user.id,
				platformId: linkedin.id,
				platformAccountId: "urn:li:person:demo",
				platformAccountName: "Demo Creator",
				accessToken: encrypt("dummy-linkedin-token"),
				expiresAt: new Date(Date.now() + 48 * hour),
			},
			update: { expiresAt: new Date(Date.now() + 48 * hour) },
		});
	}

	if (facebook) {
		await prisma.socialConnection.upsert({
			where: { userId_platformId: { userId: user.id, platformId: facebook.id } },
			create: {
				userId: user.id,
				platformId: facebook.id,
				platformAccountId: "1234567890",
				platformAccountName: "Demo Creator Page",
				accessToken: encrypt("dummy-facebook-page-token"),
				expiresAt: new Date(Date.now() - 2 * hour),
			},
			update: { expiresAt: new Date(Date.now() - 2 * hour) },
		});
	}

	const rows = await prisma.socialConnection.findMany({
		where: { userId: user.id },
		include: { platform: true },
	});
	console.log(
		"connections:",
		rows.map((r) => ({
			platform: r.platform.key,
			account: r.platformAccountName,
			expiresAt: r.expiresAt,
		})),
	);
	console.log("platforms:", platforms.map((p) => `${p.key}:${p.status}:${p.isActive}`));
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
