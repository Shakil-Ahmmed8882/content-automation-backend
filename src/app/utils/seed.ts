import bcrypt from "bcryptjs";
import {
	AuthProvider,
	PlatformStatus,
	Role,
	UpcomingFeatureStatus,
} from "../../generated/prisma/enums";
import config from "../config";
import { prisma } from "../lib/prisma";

/**
 * Seeds the initial LIVE platforms (add-platform-catalogue task 1.2) so
 * downstream slices (social-connections, publishing) have real targets to
 * connect/publish to. Idempotent — upserts by the unique `key`, so it's safe
 * to run on every boot (mirrors the reference project's seed-at-boot pattern).
 */
const INITIAL_PLATFORMS = [
	{ key: "linkedin", name: "LinkedIn", status: PlatformStatus.LIVE, sortOrder: 1 },
	{ key: "facebook", name: "Facebook Page", status: PlatformStatus.LIVE, sortOrder: 2 },
];

export const seedPlatforms = async () => {
	for (const platform of INITIAL_PLATFORMS) {
		await prisma.platform.upsert({
			where: { key: platform.key },
			update: {},
			create: platform,
		});
	}
	console.log("Platforms seeded successfully.");
};

/**
 * Seeds the initial upcoming-feature catalogue (add-upcoming-features task
 * 1.2) so premium users have real rows to browse from day one. Idempotent —
 * upserts by the unique `slug`, so it's safe to run on every boot.
 */
const INITIAL_UPCOMING_FEATURES = [
	{
		slug: "ai-content-enhancement",
		title: "AI Content Enhancement",
		shortDescription: "Let AI polish your post before it goes out.",
		description:
			"Automatically improve grammar, tone, and clarity of your post content using AI, with a one-click preview before you publish.",
		status: UpcomingFeatureStatus.IN_DEVELOPMENT,
		sortOrder: 1,
	},
	{
		slug: "scheduled-publishing",
		title: "Scheduled Publishing",
		shortDescription: "Queue posts to go out at a future date and time.",
		description:
			"Pick a date and time for a post to publish automatically instead of sending it immediately, across all connected platforms.",
		status: UpcomingFeatureStatus.PLANNED,
		sortOrder: 2,
	},
	{
		slug: "analytics-dashboard",
		title: "Analytics Dashboard",
		shortDescription: "See how your published posts are performing.",
		description:
			"A dashboard summarizing reach, engagement, and publish success rate across every connected platform in one place.",
		status: UpcomingFeatureStatus.COMING_SOON,
		sortOrder: 3,
	},
];

export const seedUpcomingFeatures = async () => {
	for (const feature of INITIAL_UPCOMING_FEATURES) {
		await prisma.upcomingFeature.upsert({
			where: { slug: feature.slug },
			update: {},
			create: feature,
		});
	}
	console.log("Upcoming features seeded successfully.");
};

/**
 * Seeds the SUPER_ADMIN + ADMIN accounts from env (SUPER_ADMIN_* / ADMIN_*).
 * There is no admin-signup endpoint by design, so without this the configured
 * credentials were dead config — read in `config/index.ts` but never used, and
 * no admin could exist except via the dev-only `npm run admin:promote` CLI.
 *
 * Idempotent: upserts by email, always re-asserting the role (so a demoted or
 * manually-edited seed account heals on the next boot) but only writing the
 * password hash when creating the identity — a rotated password is never
 * silently reverted to the env value. Skips silently if the env vars are unset,
 * so a deployment that doesn't want seeded admins simply omits them.
 */
const seedAdminUser = async (
	name: string | undefined,
	email: string | undefined,
	password: string | undefined,
	role: Role,
) => {
	if (!name || !email || !password) {
		return false;
	}
	const normalizedEmail = email.trim().toLowerCase();
	const passwordHash = await bcrypt.hash(password, Number(config.bcrypt_salt_rounds) || 10);

	await prisma.$transaction(async (tx) => {
		const user = await tx.user.upsert({
			where: { email: normalizedEmail },
			update: { role, emailVerified: true },
			create: { name, email: normalizedEmail, emailVerified: true, role },
		});

		// The CREDENTIALS identity carries the password hash (users table has none).
		await tx.account.upsert({
			where: {
				provider_providerAccountId: {
					provider: AuthProvider.CREDENTIALS,
					providerAccountId: normalizedEmail,
				},
			},
			update: {}, // never clobber a rotated password
			create: {
				userId: user.id,
				provider: AuthProvider.CREDENTIALS,
				providerAccountId: normalizedEmail,
				passwordHash,
			},
		});
	});
	return true;
};

export const seedAdminUsers = async () => {
	const seeded = [
		await seedAdminUser(
			config.super_admin_name,
			config.super_admin_email,
			config.super_admin_password,
			Role.SUPER_ADMIN,
		),
		await seedAdminUser(config.admin_name, config.admin_email, config.admin_password, Role.ADMIN),
	].filter(Boolean).length;

	console.log(
		seeded > 0
			? `Admin users seeded successfully (${seeded}).`
			: "Admin users not seeded (SUPER_ADMIN_*/ADMIN_* env vars unset).",
	);
};
