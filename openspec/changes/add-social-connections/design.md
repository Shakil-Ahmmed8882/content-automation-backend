## Context

See `proposal.md` — Why. Depends on #2 (`platforms`). Materializes `social_connections`
(data-model §4.4). Introduces token encryption (a security requirement from PRD §8/§23) and the
first real third-party OAuth integration. Uses native `fetch` for provider APIs, matching `lib/bkash`.

## Goals / Non-Goals

**Goals:**
- One platform-generic connection flow with thin per-provider handlers (LinkedIn, Facebook),
  so adding a provider later is a new handler keyed on `platform.key`.
- Encrypted-at-rest credentials that #5 can decrypt to publish.

**Non-Goals:** the publishing itself (#5); multiple connections per platform (data-model §4.9,
deferred); provider APIs beyond publishing scope.

## Decisions

### D1: A `SocialConnector` strategy keyed on `platform.key`
`connect`/`callback` are generic; they dispatch to a per-provider connector (`linkedin`,
`facebook`) that knows that provider's OAuth URLs, token exchange, and identity fetch. New
providers register a connector — no change to the routes/service shell.
- **Why:** mirrors the `SocialPublisher` abstraction (#5, PRD §27); keeps provider specifics isolated.

### D2: OAuth `state` in Redis for CSRF; short-lived
`connect` generates a random `state` bound to the user and stored in Redis with a short TTL; the
callback validates and consumes it. Prevents cross-site request forgery on the callback (§23).

### D3: Tokens encrypted with AES-256-GCM via `lib/crypto`; key from env
A new `lib/crypto` encrypts tokens before persist and decrypts on demand (only when publishing).
Key from `TOKEN_ENCRYPTION_KEY` (new env). The DB stores ciphertext; tokens never serialize to clients.
- **Alternative:** a KMS/secrets manager. Deferred — env key is adequate for MVP; the boundary
  (`lib/crypto`) makes swapping to KMS a one-file change.

### D4: Facebook is a two-step connect (user token → Page token)
Facebook callback exchanges the code for a long-lived **user** token, then lists the user's Pages.
The Pages (and the transient user token) are held briefly (Redis) while the user picks a Page; on
selection we store the **Page** access token as the connection (publishing posts as the Page).
LinkedIn is single-step (store the member connection directly).
- **Why:** Page publishing requires a Page token, and users may admin several Pages (data-model §4.4).

### D5: One connection per platform; disconnect hard-deletes
`@@unique([userId, platformId])`; reconnect replaces (delete-then-create or upsert). Disconnect
hard-deletes to physically remove the secret (data-model #9). History is preserved because #5's
`publications` snapshot `platformAccountName` and null the FK on delete.

## Risks / Trade-offs

- **Provider token/refresh semantics differ (LinkedIn vs Facebook).** → Isolated in each connector;
  `metadata` JSON absorbs provider-variant fields (data-model §4.4).
- **Lost `TOKEN_ENCRYPTION_KEY` makes stored tokens unrecoverable.** → Documented as a managed
  secret; rotating requires re-connect. Acceptable — tokens are re-obtainable via OAuth.
- **Expired tokens at publish time.** → #5 surfaces a clear "reconnect" error; refresh (where the
  provider supports it) handled in the connector.

## Migration Plan

1. Add `social_connections` model + `users`/`platforms` relations; `prisma migrate dev` + generate.
2. Add `lib/crypto` + `TOKEN_ENCRYPTION_KEY` to config/`.env.example`.
3. Implement connectors (LinkedIn, Facebook) + the connection module; mount routes.
4. Manually connect each platform against sandbox/test apps; verify tokens are encrypted and never
   returned; verify disconnect removes the row.
