import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Application, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import httpStatus from "http-status";
import config from "./app/config";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler";
import { notFound } from "./app/middleware/notFound";

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

// ── Feature routes are mounted here as modules are built, e.g.
//    app.use("/api/v1/auth", AuthRoutes);
//    app.use("/api/v1/users", UserRoutes);
//    (auth, users, connections, posts, executions, payments, upcoming-features)

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
