import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AdminController } from "./admin.controller";
import { AdminValidation } from "./admin.validation";

// Mounted at /api/v1/admin/users. Every route is ADMIN/SUPER_ADMIN, except
// role change which is SUPER_ADMIN only (design D3 — an admin cannot
// escalate roles).
const userRouter = Router();

userRouter.get("/", auth("ADMIN", "SUPER_ADMIN"), AdminController.listUsers);
userRouter.get("/:id", auth("ADMIN", "SUPER_ADMIN"), AdminController.getUser);
userRouter.patch(
	"/:id/status",
	auth("ADMIN", "SUPER_ADMIN"),
	validateRequest(AdminValidation.setUserStatus),
	AdminController.setStatus,
);
userRouter.patch(
	"/:id/role",
	auth("SUPER_ADMIN"),
	validateRequest(AdminValidation.setUserRole),
	AdminController.setRole,
);
userRouter.patch(
	"/:id/premium",
	auth("ADMIN", "SUPER_ADMIN"),
	validateRequest(AdminValidation.setUserPremium),
	AdminController.setPremium,
);

// Mounted at /api/v1/admin/audit-logs.
const auditLogRouter = Router();

auditLogRouter.get("/", auth("ADMIN", "SUPER_ADMIN"), AdminController.listAuditLogs);

export const AdminUserRoutes = userRouter;
export const AdminAuditLogRoutes = auditLogRouter;
