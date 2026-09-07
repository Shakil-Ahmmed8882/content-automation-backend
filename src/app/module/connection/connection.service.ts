import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import { PlatformStatus } from "../../../generated/prisma/enums";
import { decrypt, encrypt } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import { AppError } from "../../utils/appError";
import { FB_PAGE_SELECTION_TTL_SECONDS, facebookPageSelectionKey } from "./connection.constant";
import type { IConnectorConnection, IFacebookPageSelection } from "./connection.interface";
import { consumeOAuthState, issueOAuthState } from "./connection.utils";
import { getConnector } from "./connectors";

const FACEBOOK_KEY = "facebook";

/** Public view of a connection — platform, account name, derived status, and
 * expiry. NEVER includes tokens (spec: tokens must never reach a client). */
const toPublicConnection = (row: {
	id: string;
	platformAccountName: string | null;
	expiresAt: Date | null;
	createdAt: Date;
	platform: { key: string; name: string };
}) => ({
	id: row.id,
	platform: { key: row.platform.key, name: row.platform.name },
	platformAccountName: row.platformAccountName,
	status: row.expiresAt && row.expiresAt.getTime() < Date.now() ? "EXPIRED" : "CONNECTED",
	expiresAt: row.expiresAt,
	createdAt: row.createdAt,
});

const getLivePlatformOrThrow = async (platformKey: string) => {
	const platform = await prisma.platform.findUnique({ where: { key: platformKey } });
	if (!platform) {
		throw new AppError(httpStatus.NOT_FOUND, "Platform not found");
	}
	if (platform.status !== PlatformStatus.LIVE) {
		throw new AppError(httpStatus.BAD_REQUEST, "This platform is not available to connect yet");
	}
	return platform;
};

/** Encrypts tokens and upserts the connection (design D5: one per
 * [userId, platformId]; reconnect replaces rather than duplicates). */
const storeConnection = async (userId: string, platformId: string, conn: IConnectorConnection) => {
	const data = {
		platformAccountId: conn.platformAccountId ?? null,
		platformAccountName: conn.platformAccountName ?? null,
		accessToken: encrypt(conn.accessToken),
		refreshToken: conn.refreshToken ? encrypt(conn.refreshToken) : null,
		expiresAt: conn.expiresAt ?? null,
		...(conn.metadata ? { metadata: conn.metadata as Prisma.InputJsonValue } : {}),
	};

	const row = await prisma.socialConnection.upsert({
		where: { userId_platformId: { userId, platformId } },
		create: { userId, platformId, ...data },
		update: data,
		include: { platform: { select: { key: true, name: true } } },
	});
	return toPublicConnection(row);
};

/** GET /connections — the caller's connections, tokens omitted. */
const listConnections = async (userId: string) => {
	const rows = await prisma.socialConnection.findMany({
		where: { userId },
		include: { platform: { select: { key: true, name: true } } },
		orderBy: { createdAt: "asc" },
	});
	return rows.map(toPublicConnection);
};

/** GET /connections/:platform/connect — LIVE-only; issues state, returns the
 * provider's OAuth URL. */
const startConnect = async (userId: string, platformKey: string) => {
	await getLivePlatformOrThrow(platformKey);

	const connector = getConnector(platformKey);
	if (!connector) {
		throw new AppError(httpStatus.NOT_IMPLEMENTED, "No integration is wired for this platform yet");
	}

	const state = await issueOAuthState({ userId, platformKey });
	return { authUrl: connector.buildAuthUrl(state) };
};

/** GET /connections/:platform/callback — validates state (CSRF), exchanges the
 * code, and stores an encrypted connection. For Facebook with multiple Pages it
 * returns the Pages to choose from instead (design D4). */
const handleCallback = async (
	platformKey: string,
	code: string | undefined,
	state: string | undefined,
) => {
	const statePayload = await consumeOAuthState(state);
	if (!statePayload || statePayload.platformKey !== platformKey) {
		throw new AppError(httpStatus.BAD_REQUEST, "Invalid or expired OAuth state");
	}
	if (!code) {
		throw new AppError(httpStatus.BAD_REQUEST, "Missing authorization code");
	}

	const { userId } = statePayload;
	const platform = await getLivePlatformOrThrow(platformKey);
	const connector = getConnector(platformKey);
	if (!connector) {
		throw new AppError(httpStatus.NOT_IMPLEMENTED, "No integration is wired for this platform yet");
	}

	const result = await connector.handleCallback(code);

	if (result.kind === "connection") {
		const connection = await storeConnection(userId, platform.id, result.connection);
		return { kind: "connected" as const, connection };
	}

	// Two-step (Facebook): hold the transient user token + Pages while the user
	// selects. Auto-select when exactly one Page (spec allows it).
	if (result.pages.length === 1) {
		const page = result.pages[0];
		if (!page) {
			throw new AppError(httpStatus.BAD_GATEWAY, "No Facebook Page returned");
		}
		const connection = await storeConnection(userId, platform.id, {
			platformAccountId: page.id,
			platformAccountName: page.name,
			accessToken: page.accessToken,
		});
		return { kind: "connected" as const, connection };
	}

	const selection: IFacebookPageSelection = {
		userTokenEncrypted: encrypt(result.userToken),
		userTokenExpiresAt: result.userTokenExpiresAt?.toISOString(),
		pages: result.pages.map((page) => ({
			id: page.id,
			name: page.name,
			accessTokenEncrypted: encrypt(page.accessToken),
		})),
	};
	await redisClient.set(facebookPageSelectionKey(userId), JSON.stringify(selection), {
		expiration: { type: "EX", value: FB_PAGE_SELECTION_TTL_SECONDS },
	});

	return {
		kind: "select-page" as const,
		pages: result.pages.map((page) => ({ id: page.id, name: page.name })),
	};
};

const readPageSelectionOrThrow = async (userId: string): Promise<IFacebookPageSelection> => {
	const raw = await redisClient.get(facebookPageSelectionKey(userId));
	if (!raw) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"No Facebook Page selection in progress. Start connecting Facebook first.",
		);
	}
	return JSON.parse(raw) as IFacebookPageSelection;
};

/** GET /connections/facebook/pages — the Pages held from the callback, no tokens. */
const listFacebookPages = async (userId: string) => {
	const selection = await readPageSelectionOrThrow(userId);
	return selection.pages.map((page) => ({ id: page.id, name: page.name }));
};

/** POST /connections/facebook/select-page — store the chosen Page's token as
 * the connection, then clear the transient stash. */
const selectFacebookPage = async (userId: string, pageId: string) => {
	const selection = await readPageSelectionOrThrow(userId);
	const page = selection.pages.find((candidate) => candidate.id === pageId);
	if (!page) {
		throw new AppError(httpStatus.BAD_REQUEST, "That Page is not among your available Pages");
	}

	const platform = await getLivePlatformOrThrow(FACEBOOK_KEY);
	// The Page token was encrypted in Redis; decrypt only to re-store it on the
	// connection (storeConnection re-encrypts) — it never leaves the server.
	const connection = await storeConnection(userId, platform.id, {
		platformAccountId: page.id,
		platformAccountName: page.name,
		accessToken: decrypt(page.accessTokenEncrypted),
	});

	await redisClient.del(facebookPageSelectionKey(userId));
	return connection;
};

/** DELETE /connections/:platform — hard-delete so the secret is physically
 * removed (design D5). */
const disconnect = async (userId: string, platformKey: string) => {
	const platform = await prisma.platform.findUnique({ where: { key: platformKey } });
	if (!platform) {
		throw new AppError(httpStatus.NOT_FOUND, "Platform not found");
	}

	const existing = await prisma.socialConnection.findUnique({
		where: { userId_platformId: { userId, platformId: platform.id } },
	});
	if (!existing) {
		throw new AppError(httpStatus.NOT_FOUND, "You are not connected to this platform");
	}

	await prisma.socialConnection.delete({ where: { id: existing.id } });
};

export const ConnectionService = {
	listConnections,
	startConnect,
	handleCallback,
	listFacebookPages,
	selectFacebookPage,
	disconnect,
	// exported for direct use in tests (seeding connections without live OAuth)
	storeConnection,
};
