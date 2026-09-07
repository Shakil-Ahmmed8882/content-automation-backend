import { prisma } from "../src/app/lib/prisma";
import { Role } from "../src/generated/prisma/enums";

/**
 * Dev-only CLI: promotes an existing user to ADMIN directly in Postgres.
 * There's no admin-signup HTTP endpoint yet (`add-admin-audit`, not applied),
 * so this is how a manually-registered test user gets admin rights for
 * exercising the platform-catalogue admin routes (Postman/manual testing —
 * mirrors `tests/helpers/authUser.ts`'s `createAdminUser`).
 *
 * Usage: npm run admin:promote -- <email>
 */
const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
	console.error("Usage: npm run admin:promote -- <email>");
	process.exit(1);
}

(async () => {
	try {
		const user = await prisma.user.update({
			where: { email },
			data: { role: Role.ADMIN },
		});
		console.log(`Promoted ${user.email} to ADMIN.`);
	} catch (_error) {
		console.error(`Could not find a user with email "${email}". Register + verify it first.`);
		process.exitCode = 1;
	} finally {
		await prisma.$disconnect();
	}
})();
