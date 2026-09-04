## Why

The Content Automation Platform needs accounts before anything else can exist — a user must
sign up, verify their email, log in, and recover a lost password before they can connect
socials, create content, or pay. This is the first vertical slice and the dependency root for
every other module (PRD §2 goals 1–3, §6, §30). We build the **credentials** flow now on an
auth model that is deliberately provider-agnostic, so Google/GitHub/Facebook/Clerk can be added
later as thin additive slices without redesign (PRD §6.2).

## What Changes

- **Registration with email verification (OTP):** `POST /register` stashes a *pending*
  registration (name, email, hashed password) + a 6-digit OTP in Redis and emails the OTP.
  No `users` row is created until the OTP is verified — abandoned signups never touch Postgres.
- **Verify email:** `POST /verify-email` validates the OTP, then creates the `users` row + a
  `CREDENTIALS` row in `accounts`, and issues tokens.
- **Login:** `POST /login` with email/password → access + refresh tokens (httpOnly cookies).
- **Logout:** `POST /logout` clears the auth cookies.
- **Current user:** `GET /me` returns the authenticated user's profile (never secrets).
- **Refresh token:** `POST /refresh-token` rotates a valid refresh token into a new token pair.
- **Forgot password (OTP):** `POST /forgot-password` emails a reset OTP (only for credentials
  accounts; no user enumeration in the response).
- **Reset password:** `POST /reset-password` validates the OTP and sets a new password, then
  emails a "password changed" confirmation.
- **Provider abstraction seam:** all identity persistence goes through the `accounts` table and
  an internal auth-provider boundary, and account-linking is keyed on **verified email**, so
  future OAuth providers attach as new `accounts` rows with zero schema/reshape.
- **Route-level guards:** `auth()` + `validateRequest(zod)` protect/validate at the route;
  services assume authorized, validated input (per `CLAUDE.md`).

Out of scope (explicitly deferred to follow-up slices, but enabled by this design):
Google OAuth (`add-google-auth`, immediate next slice), then GitHub/Facebook/Clerk. Profile
editing and avatar upload live in the separate `user` module slice.

## Capabilities

### New Capabilities
- `user-auth`: credential-based authentication and session lifecycle — registration with email
  OTP verification, login, logout, current-user, refresh-token rotation, and password
  recovery/reset — built on a provider-extensible `accounts` identity model.

### Modified Capabilities
<!-- None. This is the first auth slice; future provider slices will modify `user-auth`. -->

## Impact

- **Data model:** requires the `users` and `accounts` tables + `Role`, `UserStatus`,
  `AuthProvider` enums from `docs/data-model.md` §4.1–4.2 to be materialized into
  `prisma/schema/` (this slice includes creating those model files + first migration).
- **Modules:** fills `src/app/module/auth/` (route, controller, service, validation, interface).
- **Libs used (already scaffolded):** `lib/prisma`, `lib/redis` (OTP store), `lib/nodemailer` +
  `lib/emailTemplate` (verify-email, forgot-password, password-changed EJS), `utils/jwt`,
  `middleware/checkAuth`, `middleware/validateRequest`.
- **App wiring:** mount `AuthRoutes` at `/api/v1/auth` in `src/app.ts`; add an auth-scoped rate
  limiter on OTP/login endpoints.
- **Config/env:** `JWT_*`, `BCRYPT_SALT_ROUNDS`, `REDIS_*`, `SMTP_*`/`EMAIL_SENDER` (all already
  in `.env.example`). No new dependencies.
- **Security (PRD §22/§23):** bcrypt hashing, httpOnly cookies, no token/hash/stack-trace leakage,
  OTP TTLs, no user-enumeration on forgot-password, backend-authoritative session state.
