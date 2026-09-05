## 1. Data model & migration (the lower module for this slice)

- [x] 1.1 Add `Role`, `UserStatus`, `AuthProvider` enums to `prisma/schema/enums.prisma` per `docs/data-model.md`; verify `npx prisma validate` passes.
- [x] 1.2 Add the `users` model (data-model §4.1) declaring only the `accounts` relation for now (D5 incremental schema); verify `npx prisma validate` passes.
- [x] 1.3 Add the `accounts` model (data-model §4.2) with `@@unique([provider, providerAccountId])` and `@@unique([userId, provider])`; verify `npx prisma validate` passes.
- [x] 1.4 Run `prisma migrate dev --name init-auth` + `prisma generate`; verify the `users` and `accounts` tables exist and `npx tsc --noEmit` compiles against the generated client.

## 2. Shared auth building blocks

- [x] 2.1 Write Zod schemas in `auth.validation.ts` (register, verifyEmail, login, forgotPassword, resetPassword — 6-digit numeric OTP, min password length); verify each rejects malformed input.
- [x] 2.2 Define payload/interface types in `auth.interface.ts` (incl. `IRequestUser` and the pending-registration shape); verify `tsc --noEmit` passes.
- [x] 2.3 Add `issueTokens()` + `setAuthCookies()` helpers with **environment-aware** cookie flags (`secure`/`sameSite` from `config.node_env`); verify an issued access token round-trips through `jwtUtils.verifyToken`.
- [x] 2.4 Add the provider seam `findOrLinkUserByVerifiedEmail(provider, providerAccountId, profile)` that finds-or-creates the user + the account and links by verified email (D3/D4); verify the CREDENTIALS path yields exactly one `users` row + one `accounts` row, and that a second verified-email identity links to the same user.
- [x] 2.5 Add an auth-scoped rate limiter and apply it to register/verify/login/forgot/reset routes; verify calls beyond the limit return HTTP 429.

## 3. Registration + email verification (vertical slice, end-to-end)

- [x] 3.1 `AuthService.register`: reject an already-verified email, hash the password (`bcrypt`, rounds from config), store `{name,email,passwordHash}` + a single-use OTP under short-TTL Redis keys, and send the `verify-email` template; verify Redis keys are set and **no** `users` row is created.
- [x] 3.2 `AuthService.verifyEmail`: validate the OTP, create the user + CREDENTIALS account via the seam (2.4), mark `emailVerified`, issue a session, and delete the Redis keys; verify a correct/unexpired OTP creates the account and returns tokens while a wrong/expired OTP creates nothing.
- [x] 3.3 Controller + routes `POST /register` and `POST /verify-email` (validation + rate limit); verify end-to-end: register → read OTP (mail/log) → verify → receive an authenticated session.

## 4. Login & session (vertical slice, end-to-end)

- [x] 4.1 `AuthService.login`: authenticate email+password, refuse blocked/deleted accounts, return a generic error on failure, and issue a session; verify a valid login returns tokens and a wrong password returns a non-revealing error.
- [x] 4.2 `AuthService.refreshToken`: verify the refresh token, refuse inactive users, and rotate to a new pair; verify a valid refresh returns a new pair and an invalid/expired token is rejected.
- [x] 4.3 `AuthController.getMe` (auth-guarded) + `AuthController.logout`; verify `GET /me` returns the profile with **no** passwordHash/tokens and returns 401 without a valid session, and logout clears the cookies.
- [x] 4.4 Wire routes `POST /login`, `POST /refresh-token`, `POST /logout`, `GET /me` with `auth()`/`validateRequest` guards; verify all four behave per the `user-auth` spec.

## 5. Password recovery (vertical slice, end-to-end)

- [x] 5.1 `AuthService.forgotPassword`: for a credentials-account email, store a reset OTP in Redis and send the `forgot-password` template; return the **same** response for known and unknown emails, and send no code to OAuth-only accounts; verify identical responses for existing vs non-existent email (no enumeration).
- [x] 5.2 `AuthService.resetPassword`: validate the reset OTP, set the new password hash, invalidate the OTP, and send the `password-changed` email; verify a valid OTP changes the password and an invalid/expired OTP is rejected.
- [x] 5.3 Wire `POST /forgot-password` and `POST /reset-password` (validation + rate limit); verify end-to-end: forgot → read OTP → reset → log in with the new password.

## 6. Integration wiring & security verification

- [x] 6.1 Mount `AuthRoutes` at `/api/v1/auth` in `src/app.ts`; verify the routes are reachable and `npx tsc --noEmit` passes.
- [x] 6.2 Verify no secret leakage across the module: responses never contain passwordHash/tokens/stack traces and every error flows through the standard `sendResponse`/`globalErrorHandler` envelope (inspect `/me`, a failed login, and a forced error).
- [x] 6.3 Full end-to-end test of the slice (register → verify → login → `/me` → refresh → logout → forgot → reset → re-login) — automated instead of manual: `tests/e2e/auth.e2e.test.ts` (17 tests, Vitest + Supertest against real Postgres + Redis), covering every scenario in `specs/user-auth/spec.md` plus rate-limiting and the provider-seam invariant. Run: `npm test` → 17/17 passed (2026-09-05).
- [x] 6.4 Run `npm run check:fix` (Biome) and `npx tsc --noEmit`; verify both pass clean before marking the slice done.
