## Why

Once a user can authenticate (`add-credentials-auth`), they need to see and manage their own
account: view their profile, update their name, set a profile picture, change their password while
logged in, and close their account. This is PRD Step 3 (§7), depends only on auth, and it
establishes the Cloudinary image-upload pattern that content posts reuse later. Premium status is
surfaced here (the crown badge, §7) but is only *written* by the payment flow.

## What Changes

Complete self-service profile / account-management surface (nothing partial — every logical
endpoint for "manage my own account" is included):

- **Get my profile:** `GET /api/v1/users/me` — returns id, name, email, avatar, role, premium
  state (`isPremium` + `premiumSince`), the linked auth providers (from `accounts`, e.g.
  `["CREDENTIALS","GOOGLE"]`), and timestamps. Never returns password hashes or tokens (§22).
- **Update my profile:** `PATCH /api/v1/users/me` — update editable fields (`name`). Email is the
  account identity and is **not** editable here (changing it would require re-verification —
  out of scope, noted for a future flow).
- **Upload / replace avatar:** `PATCH /api/v1/users/me/avatar` — multipart image → Cloudinary;
  stores `avatarUrl` + `avatarPublicId`; deletes the previously stored asset so it isn't orphaned.
- **Remove avatar:** `DELETE /api/v1/users/me/avatar` — deletes the Cloudinary asset and clears
  `avatarUrl`/`avatarPublicId`.
- **Change password (authenticated):** `PATCH /api/v1/users/me/password` — verify current password,
  set a new hash, send the `password-changed` email. Only for accounts that have a `CREDENTIALS`
  login; OAuth-only accounts are told to set a password via reset instead.
- **Delete my account (soft):** `DELETE /api/v1/users/me` — sets `isDeleted`/`deletedAt`, reserves
  the email (data-model decision #6), and clears the session. Reversible-by-support; not a hard delete.

All endpoints are authenticated (`auth()`), operate strictly on the caller's own row (§23 — never
another user's), validated with Zod at the route, and return the standard `sendResponse` envelope.

Out of scope (noted, not cut arbitrarily): admin user management (list/block others) is a separate
admin flow; email change + premium *writes* belong to other flows (auth re-verify / payment).

## Capabilities

### New Capabilities
- `user-profile`: self-service profile and account management for the authenticated user — view
  profile (with premium state + linked providers), update profile, manage avatar, change password,
  and soft-delete own account.

### Modified Capabilities
<!-- None. Reads premium fields written by the future payment flow; does not change auth behavior. -->

## Impact

- **Data model:** uses the existing `users` table (`name`, `avatarUrl`, `avatarPublicId`,
  `isPremium`, `premiumSince`, `isDeleted`, `deletedAt`) and reads `accounts` (linked providers).
  No new tables or migration.
- **Module:** fills `src/app/module/user/` (route, controller, service, validation, interface).
- **Libs used (already scaffolded):** `lib/cloudinary` + `lib/multer` (avatar), `lib/prisma`,
  `lib/nodemailer` + `lib/emailTemplate` (`password-changed`), `middleware/checkAuth`,
  `middleware/validateRequest`, `utils/sendResponse`.
- **App wiring:** mount `UserRoutes` at `/api/v1/users` in `src/app.ts`.
- **Config/env:** `CLOUDINARY_*`, `BCRYPT_SALT_ROUNDS` (already present). No new dependencies.
- **Security (§22/§23):** owner-scoped access, no secret leakage, image type/size validation,
  current-password check before change, soft-delete clears the session.
