import type { UpcomingFeatureStatus } from "../../../generated/prisma/enums";

export interface ICreateUpcomingFeaturePayload {
	slug: string;
	title: string;
	shortDescription: string;
	description: string;
	status?: UpcomingFeatureStatus;
	sortOrder?: number;
	isPremiumVisible?: boolean;
}

export interface IUpdateUpcomingFeaturePayload {
	slug?: string;
	title?: string;
	shortDescription?: string;
	description?: string;
	status?: UpcomingFeatureStatus;
	sortOrder?: number;
	isPremiumVisible?: boolean;
}
