import { prisma } from "../../src/app/lib/prisma";

/** Deletes exactly the given users (by email) — never a wildcard/pattern
 * delete, so a test run can never touch rows it didn't create. `accounts`
 * cascades via the FK (see prisma/schema/account.prisma). */
export const deleteUsersByEmail = async (emails: string[]) => {
	if (!emails.length) {
		return;
	}
	await prisma.user.deleteMany({ where: { email: { in: emails } } });
};
