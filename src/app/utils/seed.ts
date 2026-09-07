import { PlatformStatus, UpcomingFeatureStatus } from "../../generated/prisma/enums";
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
