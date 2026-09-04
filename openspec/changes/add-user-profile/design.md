## Context

See `proposal.md` — Why. This flow depends only on `add-credentials-auth` and the existing
`users`/`accounts` tables (no schema change). It reuses already-scaffolded libs (`cloudinary`,
`multer`, `nodemailer`+`emailTemplate`, `prisma`) and the conventions in `CLAUDE.md`
(route→controller→service, guard/validate at the route, owner-scoping, standard envelope).

## Goals / Non-Goals

**Goals:**
- The complete self-service account surface in one cohesive module, every endpoint owner-scoped.
- Reuse the Cloudinary streaming-upload pattern here so `add-content-posts` inherits it.

**Non-Goals (design-level):**
- Admin user management (list/block others) — separate admin flow.
- Email change (needs re-verification) and premium *writes* (payment flow) — out of scope.
- Hard delete / data export — not MVP.

## Decisions

### D1: Avatar via in-memory multer → Cloudinary stream, url + publicId, delete-old-on-change
Upload uses `multer.memoryStorage()`; the buffer is streamed to Cloudinary; we persist
`avatarUrl` + `avatarPublicId`. On replace or remove, the previous asset is deleted
(best-effort). File type/size validated before upload.
- **Why:** matches the reference project and `docs/data-model.md`'s url+publicId image convention;
  keeps assets from orphaning. Establishes the exact pattern posts will reuse.
- **Alternative:** signed direct-to-Cloudinary uploads from the browser. Deferred — more moving
  parts; backend-mediated upload keeps validation and ownership server-side (§23).

### D2: Change-password lives in the profile module, not auth
`PATCH /users/me/password` is an authenticated account-security action: verify the current
password against the user's `CREDENTIALS` account, set a new hash, email `password-changed`.
OAuth-only accounts (no credentials login) are rejected with guidance to use reset.
- **Why:** it requires an active session and the current password — conceptually "manage my
  account," distinct from auth's unauthenticated OTP reset. Keeps the auth module focused on
  authentication, this module on account management.
- **Alternative:** put it in auth. Rejected — it isn't part of the login/recovery surface.

### D3: Self-delete is a soft delete that reserves the email and ends the session
`DELETE /users/me` sets `isDeleted`/`deletedAt`, keeps the row (email stays reserved per
data-model decision #6), and clears the auth cookies. `checkAuth` already refuses
`isDeleted`/`DELETED` users, so the account cannot authenticate afterward. Related posts/
connections are not touched by this flow (no cascade on a soft delete).
- **Why:** consistent with the agreed soft-delete + reserved-email model; reversible by support.
- **Alternative:** hard delete + cascade. Rejected for MVP (loses history/audit; not required).

### D4: Owner-scoping from the session only
Every read/write resolves the target user from `req.user.userId`, never from a client-supplied id.
There are no `/users/:id` endpoints in this flow.
- **Why:** structurally prevents cross-user access (§23) — a user simply cannot address another row.

### D5: Profile response includes linked providers, derived from `accounts`
`GET /users/me` returns the set of linked providers (e.g. `["CREDENTIALS","GOOGLE"]`) by reading
the user's `accounts`, so the client can show "connected via Google" without exposing any tokens.

## Risks / Trade-offs

- **Cloudinary delete of the old asset fails → orphaned image.** → Best-effort delete wrapped in
  try/catch and logged; the user-facing update still succeeds. Acceptable; a cleanup job can sweep later.
- **Reserved email blocks re-registration after self-delete.** → Intended (decision #6); support
  can restore. Documented so it isn't a surprise.
- **Change-password overlaps auth's reset conceptually.** → Kept clearly separate: authenticated +
  current-password here vs unauthenticated OTP there; no shared endpoint.

## Migration Plan

1. No schema/migration (uses existing `users`/`accounts`).
2. Implement `src/app/module/user/` (route/controller/service/validation/interface); mount
   `UserRoutes` at `/api/v1/users` in `src/app.ts`.
3. Manually test each endpoint end-to-end (get → update name → avatar upload/replace/remove →
   change password → soft-delete → confirm login refused).
