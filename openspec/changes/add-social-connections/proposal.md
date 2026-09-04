## Why

Before a user can publish, they must connect their social accounts. This flow owns the entire
connection lifecycle for LinkedIn and Facebook Pages — OAuth connect, callback, (Facebook) Page
selection, listing, and disconnect — storing only the encrypted tokens needed to publish
(data-model §4.4, PRD §8). It depends on the platform catalogue (#2) and unblocks publishing (#5).

## What Changes

All connection logic, as one flow (platform-generic, with per-provider handlers keyed on
`platform.key`):

- **List my connections:** `GET /api/v1/connections` — connected platforms with account name,
  status, and expiry. **Never** returns tokens.
- **Start connect:** `GET /api/v1/connections/:platform/connect` — returns/redirects to the
  provider's OAuth URL; only **LIVE** platforms are connectable; a signed `state` is issued.
- **Callback:** `GET /api/v1/connections/:platform/callback` — validates `state`, exchanges the
  code for tokens, and stores an encrypted connection (LinkedIn member / Facebook Page).
- **Facebook Page selection:** `GET /api/v1/connections/facebook/pages` (list the user's Pages) +
  `POST /api/v1/connections/facebook/select-page` (choose the Page whose token we store).
- **Disconnect:** `DELETE /api/v1/connections/:platform` — **hard-delete** the connection (removes
  the live secret); one connection per platform.

Materializes the `social_connections` table and adds the `User.socialConnections[]` /
`Platform.connections[]` relations. Tokens are **encrypted at rest** and only decrypted when
publishing (#5).

## Capabilities

### New Capabilities
- `social-connections`: connect, manage, and disconnect a user's LinkedIn and Facebook Page
  publishing accounts via OAuth, storing encrypted credentials.

### Modified Capabilities
<!-- None. -->

## Impact

- **Data model:** adds `social_connections` (data-model §4.4) + relations on `users`/`platforms`
  (migration). `@@unique([userId, platformId])`.
- **Module:** `src/app/module/connection/`; mount at `/api/v1/connections`.
- **New lib:** `lib/crypto` (AES-256-GCM encrypt/decrypt for tokens). **New env:**
  `TOKEN_ENCRYPTION_KEY` (add to config + `.env.example`). Reuses existing `LINKEDIN_*` / `FACEBOOK_*`.
- **Libs:** `lib/redis` (OAuth `state` + transient Facebook user-token during Page selection),
  native `fetch` for provider APIs (like `lib/bkash`), `lib/prisma`, `middleware/checkAuth`.
- **Security (§8/§23):** encrypted tokens never leave the server, OAuth `state` validated
  (CSRF), connect gated to LIVE platforms, owner-scoped, disconnect physically removes secrets.
- **Downstream (synced):** #5 publishing reads the decrypted connection to publish; publications
  snapshot the account name so history survives a later disconnect.
