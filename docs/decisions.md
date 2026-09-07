# Decision Log

A running case-study log: every dependency added and every non-trivial technical decision,
with the problem it solved and why this option was picked over the alternatives. Written as
each decision is made (see `CLAUDE.md` rule) — this is the file to read later to relearn *why*
the codebase looks the way it does, not just what it does.

Format per entry: **Problem → Decision → Why** (+ alternatives considered, when there were real ones).

---

## Stack & scaffold

**Problem:** Needed a production-shaped backend fast, without re-deriving architecture from
scratch, for an assignment with a hard deadline.
**Decision:** Express 5 + TypeScript (ESM) + Prisma 7 (`prisma-client` generator, `@prisma/adapter-pg`),
mirroring the structure of a separate reference project (L2B7 healthcare backend, kept local-only,
not part of this repo): layered `route → middleware → controller → service → lib/prisma`, one
module folder per feature (`<name>.route/controller/service/validation/interface.ts`).
**Why:** That structure was already proven end-to-end (auth, RBAC, payments, soft deletes). Copying
the skeleton meant time went into this project's actual features, not re-solving solved problems.

**Problem:** Needed lint + format tooling.
**Decision:** Biome (not ESLint + Prettier).
**Why:** Single fast tool, one config, matches the reference project so patterns transfer directly.

**Problem:** Needed a planning process that keeps every vertical slice fully designed (requirements,
schema, API contract) before code is written, for a project meant to grow for years.
**Decision:** OpenSpec (spec-driven): every feature is a "change" with `proposal.md` → `specs/**/spec.md`
→ `design.md` → `tasks.md`, validated before `/opsx:apply` implements it.
**Why:** Prevents scope drift slice-to-slice and gives a durable record of *what* each module is
supposed to do, independent of the code. See "Testing strategy" below for how this now extends
to verification.

## Data & auth model

**Problem:** The reference project's auth was a flat `password`/`googleId` pair of columns on
`User` — adding each new login provider means widening that row forever.
**Decision:** Normalized, Auth.js-style identity model: `users` (the person) + `accounts` (one row
per login method, keyed by `[provider, providerAccountId]`), with a single seam function
`findOrLinkUserByVerifiedEmail` that finds-or-creates-or-links by verified email.
**Why:** Google/GitHub/Facebook/Clerk become additive `accounts` rows later — zero reshape of
existing data, zero changes to existing login code. Governing principle from the data-modeling
session: normalize for extensibility over compaction (see `docs/data-model.md`).

**Problem:** Registration needs email verification, but creating a `User` row before the email is
confirmed leaves orphaned/unverified accounts if the user never finishes.
**Decision:** Stash the pending registration (hashed password + a single-use OTP) under short-TTL
Redis keys; only write the `users`/`accounts` rows once the OTP is verified.
**Why:** An abandoned signup just expires out of Redis and leaves nothing in Postgres — no cleanup
job needed, no half-created accounts.

**Problem:** Where do JWTs live once issued?
**Decision:** httpOnly cookies only, environment-aware `secure`/`sameSite` flags (`lax` in dev,
`none`+`secure` in production); tokens are never present in a JSON response body.
**Why:** Assignment/security rule: secrets never leave the server in a readable-by-JS form (XSS
can't steal a cookie script can't read). Cross-site cookies require the stricter flags only in
production, where the frontend is actually on a different origin.

## Background work & integrations

**Problem:** Publishing a post to LinkedIn/Facebook is a slow, failure-prone external API call —
doing it inline would block the HTTP response and couple the request's success to a third party's
uptime.
**Decision:** `bullmq` + `ioredis` — a background queue. The HTTP request returns "publish started"
immediately; a worker processes the job and updates status asynchronously.
**Why:** PRD requirement — the browser tab can close before publishing finishes. Also isolates a
flaky provider API from the request/response cycle.

**Problem:** OTP flows and the bKash token cache need a simple key/TTL store; BullMQ needs its own
Redis connection with different semantics (blocking, persistent).
**Decision:** Two separate Redis clients: `redis` (node-redis) for OTP/cache (`lib/redis.ts`),
`ioredis` for BullMQ (`lib/queue.ts`) — not one shared client.
**Why:** BullMQ specifically requires an `ioredis`-compatible connection; forcing OTP/cache logic
through the same client would couple unrelated concerns to BullMQ's connection lifecycle.

**Problem:** Assignment requires a real payment gateway, not a fake "success" status.
**Decision:** Reused `lib/bkash.ts` verbatim from the reference project (bKash tokenized SANDBOX).
**Why:** Already a working, tested integration — sandbox money, but a real provider flow (auth token,
create/execute payment, verify server-side before flipping `user.isPremium`). No reason to rebuild.

**Problem:** Needed security headers + abuse throttling.
**Decision:** `helmet` (headers) + `express-rate-limit` (a global 300/15min limiter, plus a tighter
20/15min `authLimiter` shared across register/verify/login/forgot/reset).
**Why:** Direct assignment requirement (PRD §23); auth endpoints get the tighter limit because
they're the highest-value brute-force/OTP-spam targets.

**Problem:** Needed transactional emails (verify-email, forgot-password, password-changed,
publish-result) without hand-building HTML per email.
**Decision:** Ported EJS templates + `renderEmailTemplate` helper from the reference project;
send via `nodemailer`. Email failures are logged, never thrown (a failed send must not fail the
request that triggered it).
**Why:** Reuse of already-designed templates; fire-and-forget send matches "backend is
authoritative, email is a side effect, not a dependency" (registration/reset must succeed even if
SMTP is down).

## Local dev environment (2026-09-05)

**Problem:** `npm run dev` and the OTP flows require Redis reachable, but this machine has no
Docker and no WSL installed, and Redis has no native Windows build.
**Decision:** Memurai Developer Edition — a Redis-protocol-compatible Windows service (installs
like any other Windows service, listens on 6379, autostarts).
**Why:** Solves both local dev (`npm run dev` needs Redis) and testing (below) with one persistent
install, without pulling in Docker Desktop or WSL2 just to host one dependency.
**Alternatives considered:** Docker Desktop + docker-compose (heavier setup, more portable — worth
revisiting if this project ever needs multi-service local orchestration); a cloud-hosted free Redis
(adds an internet dependency for purely-local dev).

**Problem:** Memurai (chosen above) requires running its installer — not something to do without
the machine owner's hand on it, and it stalled mid-session while the rest of the work needed
Redis reachable *now*.
**Decision:** As an interim, session-independent substitute: a portable Windows Redis build
(`tporadowski/redis` v5.0.14.1, a `.zip`, no install/service/admin rights needed), extracted to
`.devdb/redis-portable/` and started as a plain background process (`npm run devredis:start`).
**Why:** Unblocks local dev and testing immediately without touching the system or waiting on a
GUI installer. Explicitly a fallback, not a replacement recommendation — it's an old, unmaintained
Redis version; Memurai (or Docker/WSL, if ever set up) is still the better long-term choice for
persistent, auto-starting local Redis. Logged here so future-me knows why two Redis paths exist.

**Problem:** The portable Redis above is v5.0.14.1 (2022, pre-RESP3), but `redis` (node-redis) v6
defaults to RESP3 and opens every connection with `HELLO 3` — which Redis 5 doesn't understand
(`ERR unknown command 'HELLO'`), and the ACL-style `AUTH <user> <pass>` node-redis also sends by
default isn't valid pre-Redis-6 either (`ERR wrong number of arguments for 'auth'`).
**Decision:** Pin `RESP: 2` explicitly in `lib/redis.ts`'s `createClient(...)` config.
**Why:** This app only ever does plain `GET`/`SET`/`DEL` with a TTL — no RESP3-only feature
(client-side caching, richer reply types) is used — so RESP2 loses nothing and gains
compatibility with any Redis-protocol server (old Redis, Memurai, KeyDB, most managed
Redis-compatible services), not just ones that speak RESP3/`HELLO`. A real, permanent fix, not a
workaround scoped to the portable substitute above.

**Problem:** The machine's system-wide Postgres 18 (a Windows service on port 5432) rejects the
`postgres`/`postgres` credentials in `.env`, the real password is unknown, and fixing it the
"proper" way (edit `pg_hba.conf` to `trust`, restart the service, `ALTER USER`, revert) needs
Administrator rights this session doesn't have.
**Decision:** Initialize a second, entirely separate Postgres cluster this session fully owns —
`initdb` a fresh data directory at `.devdb/data`, listening on port 5433 (not 5432, so the
system-wide install is never touched), superuser `postgres` with **trust** auth (no password
needed, since only this machine's own user can reach a local-only port). `npm run devdb:start`/
`devdb:stop` manage it; `DATABASE_URL` in `.env` points at `5433`.
**Why:** `initdb`/`pg_ctl` on a directory the current user owns needs no elevation — completely
sidesteps both the unknown password and the missing admin rights, without ever touching the
existing service. Trust auth is fine here specifically because the port is bound to localhost only
and nothing sensitive lives in it (throwaway dev/test data, freely recreatable).
**Alternatives considered:** Wait for the real password (blocks all DB-dependent work indefinitely);
ask for elevation to reset the existing service (works, but riskier — touches a service the user
depends on, for a problem a side-by-side instance solves just as well with zero shared blast radius).

## Auth hardening (2026-09-05, discovered while applying `add-user-profile`)

**Problem:** `add-user-profile`'s spec requires a soft-deleted user's *existing, still-valid* access
token to stop working immediately ("checkAuth rejects it"), but `checkAuth.ts` was deliberately
model-agnostic when `add-credentials-auth` was built (its own comment said so) — it only verified
the JWT signature/expiry, never re-checked the DB. A blocked/deleted user's token would keep
working for up to a day (its expiry), not immediately.
**Decision:** Extend `checkAuth`'s `auth()` middleware to fetch the user from Postgres on every
authenticated request and refuse `isDeleted`/non-`ACTIVE` users there, attaching `req.user` from
that fresh row instead of the stale JWT claims.
**Why:** This was the deferred half of a TODO already written into `checkAuth.ts` ("once the data
model exists, extend it") — the data model now exists, and the task explicitly named `checkAuth`
as the mechanism. One extra DB read per request is an acceptable cost at this scale for closing a
real gap (a blocked/deleted user keeping access for up to a day otherwise), and it matches
`AuthService.login`/`refreshToken`'s existing identical check — same rule, now enforced everywhere,
not just at login/refresh.

**Problem:** Avatar upload/replace (`add-user-profile`) needs a real Cloudinary account; this
repo's `.env` only has placeholder `CLOUDINARY_*` values.
**Decision:** Implement the feature fully per spec, write its E2E tests fully, but gate the two
tests that need a live upload behind `describe.skipIf(!hasCloudinaryCreds)` — they run for real the
moment real credentials are added, no test rewrite needed. The always-safe scenario ("rejects a
non-image file") runs unconditionally since multer's `fileFilter` rejects it before any Cloudinary
call.
**Why:** Same principle as the SMTP placeholder in auth: don't block an otherwise-complete module
on a third-party account only the project owner can create, and don't silently mark an unverified
path "done" either — the skip is visible in every test run's summary line, not swept under a mock.

## Testing strategy (2026-09-05)

**Problem:** Needed a way to prove each module actually works end-to-end after implementation,
without bloating the OpenSpec planning schema (all 12 modules were already planned before this was
decided) and without re-inventing a new schema/artifact mid-project.
**Decision:** Testing is a post-`apply` step, not a planning artifact: after a module is applied,
write a Vitest + Supertest E2E suite (`tests/e2e/<module>.e2e.test.ts`) covering every scenario in
that module's `specs/**/spec.md`, run it against real Postgres + Redis (no mocks), fix any bugs it
surfaces, then move to the next module.
**Why:** Keeps "what should this module do" (OpenSpec specs, written before code) separate from
"does it actually do that" (tests, written after code) — each stays focused, and the existing
12-change plan didn't need to be redone.

**Problem:** Needed a test framework for a native-ESM, TypeScript, no-bundler project.
**Decision:** Vitest + Supertest (not Jest).
**Why:** Vitest runs ESM + TS out of the box; Jest needs extra `ts-jest`/Babel wiring for the same
setup. Supertest drives the real `src/app.ts` in-process (no `app.listen()` needed).

**Problem:** SMTP credentials in `.env` are placeholders (no real inbox to check yet), but OTP
verification is core to the auth flow and needs to be tested for real.
**Decision:** `EXPOSE_OTP_IN_RESPONSE` env flag (`src/app/config`) — when `true` **and**
`node_env !== "production"`, `register`/`forgot-password` responses include the raw `otp`.
**Why:** Lets E2E tests read the OTP directly instead of polling an inbox, while a double gate
(explicit flag + non-production check) means it can never leak in a real deployment even if the
flag were left on by accident.

## `add-platform-catalogue` (2026-09-06)

**Problem:** The catalogue needs seed data (`linkedin`/`facebook`) so downstream slices
(social-connections, publishing) have real platforms to reference, but nothing in this repo seeds
data yet.
**Decision:** `seedPlatforms()` (`src/app/utils/seed.ts`) upserts the initial LIVE platforms by
their unique `key`, called once at boot in `server.ts` (mirrors the reference project's
seed-at-boot pattern, deferred there until a privileged-user seed is needed).
**Why:** Idempotent upsert means it's safe to run on every boot — no separate one-off migration
script or manual step, and it never duplicates rows on restart.

**Problem:** Admin routes (create/update/logo/retire) needed E2E coverage, but there's no
admin-signup endpoint yet (`add-admin-audit`, not yet applied) — register always creates a `USER`.
**Decision:** Test helper `createAdminUser` (`tests/helpers/authUser.ts`) registers a normal user
through the real HTTP flow, then promotes it to `ADMIN` directly via Prisma.
**Why:** `checkAuth` already re-reads the user's role from Postgres on every request (auth
hardening decision above), so the already-issued cookies pick up the promoted role with no
re-login step — no need to wait for the admin-management module to test admin-gated routes.

**Problem:** The catalogue has two distinct audiences on one resource — admin CRUD/retire vs. the
public active-list read — with different route prefixes (`/admin/platforms` vs `/platforms`) and
guards (`auth("ADMIN","SUPER_ADMIN")` vs `auth()`).
**Decision:** One module folder (`src/app/module/platform/`), one `platform.route.ts` exporting
two routers (`PlatformAdminRoutes`, `PlatformRoutes`), mounted separately in `app.ts`.
**Why:** The service/controller/validation logic is shared and belongs to one capability
(`platform-catalogue`); splitting into two module folders would duplicate that plumbing for no
benefit, while two routers keep the admin/public route trees (and their guards) clearly separate.

## Manual testing tooling (2026-09-06)

**Problem:** `npm run dev` couldn't boot at all — `server.ts` awaited `transporter.verify()` before
`app.listen()`, and this repo's `.env` SMTP credentials are a placeholder (`your-email@gmail.com`),
so verify() always throws and the `catch` block called `process.exit(1)` before the server ever
started listening. Discovered while building a Postman-based manual test walkthrough, whose very
first step ("start the server") failed immediately.
**Decision:** Wrap `transporter.verify()` in its own try/catch that logs a warning and lets boot
continue to `app.listen()` regardless of the outcome.
**Why:** Matches the principle already established for runtime email sends (`lib/nodemailer.ts`,
"Email failures must never break the triggering request") — a boot-time verification probe is the
same category of non-critical dependency and shouldn't be a harder gate than the sends themselves.
Postgres/Redis stay hard requirements (`prisma.$connect`/`redisClient.connect` still unguarded) —
those are load-bearing for nearly every request, SMTP isn't.

**Problem:** Manually exercising the API (Postman) needs (a) a way to promote a test user to
`ADMIN` for `add-platform-catalogue`'s admin routes, since no admin-signup endpoint exists yet, and
(b) a request collection that chains without the tester copy-pasting OTPs/ids/cookies by hand.
**Decision:** `scripts/promoteAdmin.ts` (`npm run admin:promote -- <email>`) for the DB-side
promotion (same technique as `tests/helpers/authUser.ts`'s `createAdminUser`, exposed as a CLI);
`docs/postman/content-automation.postman_collection.json` + `docs/manual-testing-guide.md` for the
collection itself — every request's Tests script captures what the next request needs into
collection variables (OTP, user id, platform id), verified end-to-end with `newman` before
handing off (caught and fixed two real bugs this way: a shared-sandbox variable collision between
Tests scripts, and a Cleanup-folder ordering bug where Logout-before-Delete-Account 401'd).
**Why:** A hand-authored collection that hasn't actually been run end-to-end is exactly how a
"go here, click this" guide breaks on someone's first real attempt — running it through `newman`
first (same as writing an E2E test before trusting the code) caught both bugs before a human would.

## `add-social-connections` (2026-09-06)

**Problem:** OAuth tokens must be encrypted at rest (PRD §8/§23), needing a symmetric key of a
fixed length (AES-256 → 32 bytes), but forcing the operator to supply an exactly-32-byte key is a
fragile boot dependency (wrong length → crash).
**Decision:** `lib/crypto` SHA-256-derives the 32-byte key from whatever `TOKEN_ENCRYPTION_KEY`
holds, so any non-empty secret (hex, passphrase, base64) works; format is `iv:authTag:ciphertext`
(each base64), AES-256-GCM so tampering is detected on decrypt.
**Why:** Removes a length/encoding footgun without weakening the cipher (the derived key is still
32 uniformly-distributed bytes), and keeps encryption behind a single module boundary so swapping
to a KMS later (design D3's deferred alternative) is a one-file change.

**Problem:** The connect/callback flow is generic, but LinkedIn (single-step: member token) and
Facebook (two-step: user token → pick a Page → Page token) diverge sharply, and more providers
will come.
**Decision:** A `SocialConnector` strategy interface (`buildAuthUrl` + `handleCallback`) with a
registry keyed on `platform.key` (design D1); `handleCallback` returns a discriminated union
(`{kind:"connection"}` for LinkedIn, `{kind:"select-page"}` for Facebook) so the generic service
shell orchestrates storage/Page-selection without knowing provider specifics.
**Why:** Adding a provider becomes "write a connector + register it" with zero route/service
changes, and the union keeps the two-step Facebook path type-safe instead of smuggling it through
optional fields.

**Problem:** The OAuth `callback` is a browser redirect from the provider; the session cookie may
not ride along (cross-site), so it can't rely on `auth()` to know who's connecting — yet it must
be CSRF-safe and owner-scoped.
**Decision:** `connect` issues a random single-use `state` stored in Redis bound to
`{userId, platformKey}` (short TTL); the callback (deliberately NOT `auth()`-guarded) resolves and
consumes that state to identify the user, rejecting any missing/unknown/replayed state.
**Why:** State is both the CSRF defense and the identity carrier — one mechanism covers both, and
single-use (delete-on-read) defeats replay. Guarding the callback with `auth()` instead would
break real cross-site OAuth redirects that drop the cookie.

**Problem:** The live OAuth handshake (code → provider tokens) can't be automated headlessly even
with real credentials — it needs interactive user consent to mint a `code` — so an E2E test can't
cover the connect→callback happy path the way the Cloudinary skip-tests can.
**Decision:** Test everything that doesn't need the live handshake for real against Postgres+Redis
(crypto, state single-use, registry, connect URL + LIVE gate, invalid-state rejection, list/
disconnect, owner-scoping, encrypted-at-rest, and the Facebook Page-selection storage by seeding
the transient stash exactly as the callback would); leave only the provider token exchange itself
as a manual Postman step, documented as such in the tasks.
**Why:** The storage/encryption behavior the "valid callback" scenario asserts is fully exercised
via the select-page path and the ciphertext assertion — only the un-automatable network handshake
is deferred to manual, so "done" still means "verified", not "assumed".

## `add-publish-execution` (2026-09-07)

**Problem:** A "Publish Now" must survive the browser closing and fan out to several platforms
where any one can fail independently (PRD §12/§24), while status stays queryable the instant the
request returns.
**Decision:** The HTTP request validates, then synchronously creates the `execution` (PENDING) +
one `publication` per platform (snapshotting `platformAccountName`), enqueues a single BullMQ job
carrying only the `executionId`, and returns `202`. A BullMQ `Worker` (started in `server.ts`,
its own duplicated Redis connection) drives the publish: per publication it appends attempt #1,
calls the platform's publisher, writes the terminal attempt + publication status, then derives and
persists the overall `execution.status` (all SUCCESS → COMPLETED, mixed → PARTIALLY_COMPLETED, all
FAILED → FAILED). Publishing is sequential per platform and each failure is caught locally so one
platform can't sink the others.
**Why:** Rows-first-then-enqueue means #7's reads work immediately and the work is durable across a
disconnect; the attempts ledger from attempt #1 means retry (#6) just appends #2+ with no reshape.

**Problem:** Provider integration code (LinkedIn UGC + Facebook Page publish) shouldn't leak into
the service, and a bad/expired token must produce a clear, secret-free failure reason.
**Decision:** A `SocialPublisher` (`publish(content, imageUrl, connection)`) with a registry keyed
on `platform.key` (mirrors the connectors' registry, design D3); `LinkedInPublisher` /
`FacebookPublisher` use native `fetch`, decrypt the token via `lib/crypto` only inside the
publisher, and throw an `AppError` with a fixed, token-free message on failure. The worker stores
`error.message` only — never `error.stack` or any token.
**Why:** New platform = new publisher + one registration; keeping decryption inside the publisher
and storing only curated messages satisfies the "never leak tokens/stack traces" requirement
(spec §22) by construction.

**Problem:** Real LinkedIn/Facebook can't be hit in an automated run (no live app creds; same
constraint as `add-social-connections`), yet the worker/attempt-ledger/status-computation logic
needs genuine end-to-end coverage — including the mixed-result PARTIALLY_COMPLETED path.
**Decision:** `registerPublisher` doubles as a test seam: the E2E suite registers two deterministic
publishers (one succeeds, one throws) onto throwaway LIVE platforms and seeds connections via
`ConnectionService.storeConnection`, then drives the real HTTP endpoint + real in-process BullMQ
worker against Postgres+Redis. Only the two provider `fetch` bodies (`LinkedInPublisher` /
`FacebookPublisher`) are left to a live/manual check, documented as such.
**Why:** The whole pipeline (validation, ownership, fan-out, attempts, per-platform isolation,
status derivation, no-secret-leak) is verified for real; only the un-mockable provider network
call is deferred — so "done" stays "verified", not "assumed", consistent with the connections slice.

## `add-publication-retry` (2026-09-07)

**Problem:** A partial publish (e.g., an expired Facebook token) must be retryable per-platform
without re-running the platforms that already succeeded, and without any new tables or a second
execution engine (PRD §13, data-model §4.8).
**Decision:** Retry reuses the #5 worker unchanged in spirit: the publish job data gained an
optional `publicationIds`, so `runExecution(executionId, publicationIds?)` runs just those
publications when present (a retry) or all of them when absent (the initial publish). After running
its targets it recomputes `execution.status` from the CURRENT status of ALL publications (not only
the ones it touched), which is what lets a one-platform retry flip PARTIALLY_COMPLETED → COMPLETED.
Attempt numbering stays in the worker (`count(attempts)+1`), so a retry naturally appends #2+.
**Why:** One execution engine, one status-derivation path; retry is literally "publish these
publications again," and reading the full set on recompute keeps the parent cache correct.

**Problem:** The connection a failed publication first used may have been hard-deleted on
disconnect, so a retry must not reuse a stale/removed token (data-model §4.8 rebind example).
**Decision:** `ExecutionService.retryPublication` / `retryExecution` are owner-scoped, guard that
the publication is FAILED, resolve the user's CURRENT connection for the platform, refuse with
"Connect <platform> before retrying" if there is none, and otherwise rebind the publication's
`connectionId` + `platformAccountName` to that current connection before enqueuing. Execution-level
retry validates + rebinds every FAILED publication first, then enqueues each, so one missing
connection refuses the whole request instead of half-enqueuing. Endpoints:
`POST /publications/:id/retry` and `POST /executions/:id/retry`, both `202`.
**Why:** Rebind-at-retry-time matches the data-model's retry example and avoids a removed-token
failure loop; validate-all-first keeps execution retry atomic from the user's point of view.

## `add-execution-history` (2026-09-07)

**Problem:** The Executions page (PRD §14) needs an owner-scoped list + per-platform detail of past
publishes, including the content even when its post was later soft-deleted — all without new tables.
**Decision:** Two read-only endpoints on the executions router: `GET /executions` (paginated/
sortable, filter by status + createdAt date range, each row = content preview/title + platform
statuses + overall status + timings) and `GET /executions/:id` (the post content read straight from
`execution.postId` so a soft-deleted post still displays, plus each publication's status, external
url/id, the latest attempt's sanitized `errorMessage` as the failure reason, published time, a
derived `retryCount`, and a `retryable` = status===FAILED flag for the Retry action). Every query is
filtered by the session `userId`; a non-owned id returns 404.
**Why:** Pure projection over #5/#6's tables keeps status/reason as the single source of truth (the
worker computes them); reading content from the post — not a snapshot — is exactly why posts
soft-delete instead of hard-delete.

## `add-premium-payment` (2026-09-07)

**Problem:** Turning a user Premium must be authoritative on the server — never granted from a client
signal — via bKash tokenized sandbox, and must be idempotent so a replayed callback can't double-grant
(PRD §15/§23/§32 R5, data-model §4.9).
**Decision:** A provider-agnostic `payments` ledger + a gateway seam (`payment.gateway.ts`, real bKash
`create`/`execute` behind `IPaymentGateway`, swappable via `setPaymentGateway`). Flow: `create` records
a PENDING payment (amount/currency from config, unique `merchantInvoiceNumber`) and returns the bKash
URL; the unauthenticated `GET /payments/callback` (bKash calls it) and the owner-scoped
`POST /payments/verify` both run `executeAndVerify`, which calls bKash `execute`, and only on
statusCode `0000` flips the payment PENDING→SUCCESS **and** sets `isPremium`/`premiumSince` inside one
`$transaction`. Idempotency = the `updateMany where status=PENDING` flip is the single atomic gate
(count===1 grants premium exactly once); an already-SUCCESS payment early-returns; a non-success only
downgrades a still-PENDING row so it never overwrites a SUCCESS. `GET /payments/:id` is owner-scoped
and the public view omits `gatewayResponse`/session ids.
**Why:** Server-verify-on-execute is the only trust boundary; the PENDING-gated flip makes
double-grant structurally impossible; the gateway seam keeps bKash swappable and lets the whole
flow be verified deterministically in tests (real sandbox needs live creds + a human paying — the
only env-gated part, consistent with the other integrations).

## `add-payment-history` (2026-09-07)

**Problem:** A user needs to review their own payments — successes, failures, and cancellations —
without exposing raw gateway payloads (data-model §4.9, #8's ledger).
**Decision:** One owner-scoped read, `GET /api/v1/payments` → `PaymentService.listMine`: `where
{ userId }`, newest-first, `page`/`limit` + optional validated `status` filter, projecting only the
existing `toPublicPayment` display fields (never `gatewayResponse`). Kept separate from #8's
`GET /payments/:id` (single status) — list here, detail there, no overlap.
**Why:** A thin projection over the existing `(userId, createdAt)` index; reusing `toPublicPayment`
guarantees the secret-omitting contract is identical to the single-status endpoint.

## `add-upcoming-features` (2026-09-07)

**Problem:** A data-driven premium roadmap the admin curates and only premium users can browse
(PRD §16/§17, data-model §4.10) — with the premium gate enforced server-side, never from a client flag.
**Decision:** `upcoming_features` table (unique `slug`, status enum, sortOrder, isPremiumVisible,
Cloudinary image) with admin CRUD + image under `/api/v1/admin/upcoming-features`
(`auth("ADMIN","SUPER_ADMIN")`, mirrors the platform-catalogue module) and premium browse under
`/api/v1/upcoming-features` (`auth()` + a NEW `requirePremium` middleware). `requirePremium` re-reads
`isPremium` from the DB by `req.user.userId` on every request — the design claimed it was scaffolded
but it wasn't, so it was created here. Hard delete (no downstream FKs); `seedUpcomingFeatures()` upserts
3 features on boot (idempotent, mirrors `seedPlatforms`).
**Why:** Reading the DB flag (not a client value) is the §23/§32-R5 trust boundary; mirroring the
platform module kept the admin surface consistent; the live Cloudinary image upload is the only
env-gated part (empty CLOUDINARY_* creds), same posture as avatars/logos/posts.

## `add-admin-audit` (2026-09-07)

**Problem:** The platform needs admin user management/moderation plus an accountable, tamper-evident
record of sensitive actions (PRD §23, data-model §4.11) — the final cross-cutting flow.
**Decision:** A generic append-only `audit_logs` table (actor/action/entityType/entityId/metadata/ip/
userAgent, no update/delete path) + a best-effort `writeAuditLog` helper (try/catch → console.error,
never throws, so an audit failure can't break the triggering action) with an `auditContext(req)` for
actor/ip/userAgent. Admin user management under `/api/v1/admin/users` (`auth("ADMIN","SUPER_ADMIN")`;
role change is `SUPER_ADMIN`-only) — list/detail with a SAFE_USER_SELECT projection (no hashes/tokens),
block/unblock, role change, comp premium grant/revoke — each writing an audit entry, with self-lockout
guards. `GET /admin/audit-logs` viewer (filter by actor/action/entity, paginated). Audit calls wired
additively into the existing sensitive actions (connection disconnect, verified payment, platform +
feature catalogue changes) without changing their responses. Login/refresh already refused BLOCKED
users, so no auth change was needed.
**Why:** One generic table logs anything without new tables; append-only + best-effort keeps the trail
trustworthy without adding a failure surface to security-relevant actions; centralizing the wiring in
the last flow (per the build order) avoided scattering half-built audit code through earlier slices.
