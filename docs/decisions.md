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
