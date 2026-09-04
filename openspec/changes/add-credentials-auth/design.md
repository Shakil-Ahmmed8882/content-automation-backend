## Context

See `proposal.md` — Why. This is the first module and the dependency root for every other slice.
Constraints come from `content-automation-backend/CLAUDE.md` (layered route→controller→service→
lib/prisma; guard/validate at the route; centralized config; one response envelope; backend
authoritative) and `docs/data-model.md` §4.1–4.2 (the agreed `users` + `accounts` shape,
auto-link on verified email, UUID PKs). The libs this needs (`prisma`, `redis`, `nodemailer`,
`emailTemplate`, `jwt`, `checkAuth`, `validateRequest`) are already scaffolded and the EJS email
templates already exist.

## Goals / Non-Goals

**Goals:**
- A complete, end-to-end credentials auth vertical slice that later modules can depend on.
- An identity boundary where adding an OAuth provider is a new small implementation + a new
  `accounts` row type — no reshaping of `users`/`accounts` or existing flows.
- Security posture per PRD §22/§23 baked in from the first slice.

**Non-Goals (design-level):**
- OAuth providers (Google/GitHub/Facebook/Clerk) — next slices; only the seam is built here.
- Profile editing, avatar upload, admin user management — separate `user`/admin slices.
- Server-side session store or refresh-token reuse detection — see Decisions/Open Questions.

## Decisions

### D1: Verify-before-persist using a short-lived server-side store (Redis)
Registration stashes `{name, email, passwordHash}` + a 6-digit single-use OTP under short-TTL
Redis keys and emails the code; the `users`/`accounts` rows are created only on OTP verification.
- **Why:** abandoned/unverified signups never reach Postgres (no unverified-row cleanup, no
  enumeration surface), matching `docs/data-model.md` and the reference project.
- **Alternative considered:** create an unverified `users` row with an `emailVerified=false` flag.
  Rejected — litters the table, complicates the unique-email + soft-delete interactions.

### D2: Stateless JWT sessions in httpOnly cookies, access + refresh, with rotation
Issue a short-lived access token and a longer-lived refresh token as httpOnly cookies (Bearer
header accepted as a fallback for API clients). `POST /refresh-token` verifies the refresh token
and returns a new pair. TTLs come from config (`JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN`).
- **Why:** stateless, cheap to verify, no session store; httpOnly keeps tokens out of JS (PRD §23).
- **Alternative:** server-side sessions in Redis. Rejected for MVP (adds a store dependency to
  every request); revisit if we need instant global logout (see Open Questions).
- **Cookie flags are environment-aware:** `secure=true` + appropriate `sameSite` in production.

### D3: Provider-extensible identity via the `accounts` table + a thin provider boundary
Each login method is a row in `accounts` keyed by `@@unique([provider, providerAccountId])`;
`CREDENTIALS` is the first implementation (`passwordHash` set, `providerAccountId = email`).
Session issuance and user-lookup are written against `users`+`accounts`, not against a
credentials-specific shape, so a future `add-google-auth` slice only adds: a verify step that
resolves `{email, providerAccountId}` and a call to the shared "find-or-link user by verified
email → create GOOGLE account → issue session" path.
- **Why:** satisfies PRD §6.2 (new providers without redesign) and the `user-auth` spec's
  extensibility requirement.
- **Alternative:** flat `password`/`googleId` columns on `users`. Rejected in data-model decision #2.

### D4: Auto-link identities by verified email
On verification/login through any provider, if the presented email is verified and already owns a
user, attach the new identity to that user rather than creating a duplicate.
- **Why:** one human = one data owner (critical once posts/executions/payments hang off `userId`).
- **Safety:** link only when the email is verified on both sides (credentials verified via OTP;
  OAuth providers assert verification), preventing pre-registration hijack.

### D5: Incremental schema materialization (this slice ships only its tables)
This slice adds the `Role`, `UserStatus`, `AuthProvider` enums + `users` + `accounts` models and
the first migration. `User` initially declares only the `accounts` relation; each later slice adds
its own model and extends `User`'s relations (`posts[]`, `executions[]`, …).
- **Why:** keeps the vertical slice self-contained and each migration meaningful — matches the
  "slice by slice with lower modules" intent.
- **Alternative:** materialize the entire `docs/data-model.md` schema up front in one migration.
  Simpler Prisma relations, but front-loads unused tables and dilutes the slice boundary. Chosen
  approach is a judgment call; flip to full-schema-first if preferred before apply.

### D6: Guards and validation at the route; email best-effort
`auth(...roles)` and `validateRequest(zodSchema)` are route middleware; services assume authorized,
validated input (CLAUDE.md). Auth endpoints that send codes or check credentials get a tighter,
auth-scoped rate limiter. Email sends are best-effort — a failed email is logged, never thrown, so
the triggering request still succeeds (the user can request a new code).

### D7: No user enumeration on password reset
`forgot-password` returns the same response whether or not the email exists, and OAuth-only
accounts receive no code. Login errors are generic ("invalid credentials").

## Risks / Trade-offs

- **Redis outage blocks register/reset (OTP store).** → Health-check Redis on boot (already in
  `server.ts`); OTP flows fail closed with a clear "try again" message; login/refresh are unaffected.
- **Stateless refresh token can't be revoked before expiry (stolen-token window).** → Keep refresh
  TTL modest; document reuse-detection/`tokenVersion` as a fast-follow (Open Questions). Acceptable
  for MVP.
- **`sameSite=none` without `secure` breaks/leaks cookies.** → Environment-aware cookie flags;
  `secure=true` in production, never ship the dev combination live.
- **Auto-link trusts "verified email."** → Only link on verified emails; credentials verification is
  our own OTP, OAuth verification is the provider's assertion.
- **Incremental schema means `User` is edited across slices.** → Normal Prisma workflow; each change
  is an additive relation field + migration, reviewed per slice.

## Migration Plan

1. Add `Role`, `UserStatus`, `AuthProvider` enums + `users` + `accounts` models to
   `prisma/schema/`; run `prisma migrate dev` (first migration) + `prisma generate`.
2. Implement `src/app/module/auth/` (route/controller/service/validation/interface); mount
   `AuthRoutes` at `/api/v1/auth`; add the auth-scoped rate limiter in `app.ts`.
3. Manually test the full flow end-to-end (register → OTP email → verify → login → `/me` →
   refresh → logout → forgot-password → reset → login with new password).
4. **Rollback:** the migration only adds two tables + enums; revert with a down migration / drop
   if needed. No data migration on existing rows (none exist yet).

## Open Questions

- **Force-logout / global session invalidation** — do we add a per-user `tokenVersion` (bump to
  invalidate all outstanding tokens) now or later? Deferrable: it doesn't change the specs, the
  chosen approach, or the task breakdown — it's an additive column + a check. Default: defer to a
  later security slice.
