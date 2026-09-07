// Short-lived Redis windows for the OAuth handshake.
export const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 minutes to finish the redirect
export const FB_PAGE_SELECTION_TTL_SECONDS = 10 * 60; // 10 minutes to pick a Page

// Redis key builders — one namespace per concern so keys never collide.
// State is keyed by the random state value (single-use CSRF token, design D2);
// the transient Facebook Page selection is keyed by userId (one in-flight
// connect per user at a time).
export const oauthStateKey = (state: string) => `oauth-state:${state}`;
export const facebookPageSelectionKey = (userId: string) => `fb-page-selection:${userId}`;
