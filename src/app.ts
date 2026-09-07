import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Application, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import httpStatus from "http-status";
import config from "./app/config";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler";
import { notFound } from "./app/middleware/notFound";
import { AdminAuditLogRoutes, AdminUserRoutes } from "./app/module/admin/admin.route";
import { AuthRoutes } from "./app/module/auth/auth.route";
import { ConnectionRoutes } from "./app/module/connection/connection.route";
import {
	ExecutionRetryRoutes,
	ExecutionRoutes,
	PublicationRoutes,
} from "./app/module/execution/execution.route";
import { PaymentRoutes } from "./app/module/payment/payment.route";
import { PlatformAdminRoutes, PlatformRoutes } from "./app/module/platform/platform.route";
import { PostRoutes } from "./app/module/post/post.route";
import {
	UpcomingFeatureAdminRoutes,
	UpcomingFeatureRoutes,
} from "./app/module/upcomingFeature/upcomingFeature.route";
import { UserRoutes } from "./app/module/user/user.route";

const app: Application = express();

// Security headers (PRD §23).
app.use(helmet());

app.use(
	cors({
		origin: config.frontend_url,
		credentials: true,
	}),
);

// Basic rate limiting (PRD §23). 300 requests / 15 min / IP.
app.use(
	rateLimit({
		windowMs: 15 * 60 * 1000,
		limit: 300,
		standardHeaders: true,
		legacyHeaders: false,
	}),
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// ── Feature routes (mounted as modules are built).
//    (auth, users, platforms, connections, posts, executions, payments, upcoming-features)
app.use("/api/v1/auth", AuthRoutes);
app.use("/api/v1/users", UserRoutes);
app.use("/api/v1/admin/platforms", PlatformAdminRoutes);
app.use("/api/v1/platforms", PlatformRoutes);
app.use("/api/v1/connections", ConnectionRoutes);
app.use("/api/v1/posts", PostRoutes);
// Mounted at the same base so POST /api/v1/posts/:id/publish reaches the
// execution module (publish trigger); PostRoutes has no such route, so there's
// no overlap.
app.use("/api/v1/posts", ExecutionRoutes);
app.use("/api/v1/publications", PublicationRoutes);
app.use("/api/v1/executions", ExecutionRetryRoutes);
app.use("/api/v1/payments", PaymentRoutes);
app.use("/api/v1/admin/upcoming-features", UpcomingFeatureAdminRoutes);
app.use("/api/v1/upcoming-features", UpcomingFeatureRoutes);
app.use("/api/v1/admin/users", AdminUserRoutes);
app.use("/api/v1/admin/audit-logs", AdminAuditLogRoutes);

app.get("/", async (_req: Request, res: Response) => {
	res.status(httpStatus.OK).json({
		success: true,
		message: "Welcome to the Content Automation Platform API",
	});
});

app.get("/health", async (_req: Request, res: Response) => {
	res.status(httpStatus.OK).json({ success: true, status: "ok" });
});

app.use(globalErrorHandler);
app.use(notFound);

export default app;
