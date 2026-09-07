import type { ISocialConnector } from "../connection.interface";
import { facebookConnector } from "./facebook.connector";
import { linkedinConnector } from "./linkedin.connector";

// Registry keyed on platform.key (design D1). Adding a provider = register its
// connector here; the connection service/routes are untouched.
const registry: Record<string, ISocialConnector> = {
	[linkedinConnector.key]: linkedinConnector,
	[facebookConnector.key]: facebookConnector,
};

/** Returns the connector for a platform key, or null if none is registered
 * (e.g. a LIVE platform whose integration isn't wired yet). */
export const getConnector = (platformKey: string): ISocialConnector | null =>
	registry[platformKey] ?? null;
