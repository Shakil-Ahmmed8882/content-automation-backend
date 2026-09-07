import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ConnectionController } from "./connection.controller";
import { ConnectionValidation } from "./connection.validation";

const router = Router();

// List the caller's connections (tokens never included).
router.get("/", auth(), ConnectionController.listConnections);

// Facebook two-step Page selection (static paths registered before the generic
// `/:platform/*` routes so they can't be shadowed).
router.get("/facebook/pages", auth(), ConnectionController.listFacebookPages);
router.post(
	"/facebook/select-page",
	auth(),
	validateRequest(ConnectionValidation.selectPage),
	ConnectionController.selectFacebookPage,
);

// Start connect (LIVE-only) — issues state, returns the provider OAuth URL.
router.get("/:platform/connect", auth(), ConnectionController.startConnect);

// OAuth callback — deliberately NOT auth-guarded: the provider redirects the
// browser here and the session cookie may not ride along; the caller is
// resolved from the single-use `state` instead (design D2 / spec CSRF check).
router.get("/:platform/callback", ConnectionController.callback);

// Disconnect — hard-delete the connection.
router.delete("/:platform", auth(), ConnectionController.disconnect);

export const ConnectionRoutes = router;
