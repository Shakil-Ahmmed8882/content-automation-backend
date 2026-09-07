import { z } from "zod";
import { Role, UserStatus } from "../../../generated/prisma/enums";

const setUserStatus = z.object({
	status: z.enum(UserStatus),
});

const setUserRole = z.object({
	role: z.enum(Role),
});

const setUserPremium = z.object({
	isPremium: z.boolean(),
});

export const AdminValidation = {
	setUserStatus,
	setUserRole,
	setUserPremium,
};
