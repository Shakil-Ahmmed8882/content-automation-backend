import type { PlatformStatus } from "../../../generated/prisma/enums";

export interface ICreatePlatformPayload {
	key: string;
	name: string;
	status?: PlatformStatus;
	sortOrder?: number;
	isActive?: boolean;
}

export interface IUpdatePlatformPayload {
	name?: string;
	status?: PlatformStatus;
	sortOrder?: number;
	isActive?: boolean;
}
