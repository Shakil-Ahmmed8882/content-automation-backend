## 1. Module scaffolding & wiring

- [x] 1.1 Add `user.interface.ts` types (update-profile payload, change-password payload, profile response incl. linked providers) and `user.validation.ts` Zod schemas (update name, change password); verify `npx tsc --noEmit` passes.
- [x] 1.2 Create `user.route.ts` with all routes under `auth()` (`GET /me`, `PATCH /me`, `PATCH /me/avatar`, `DELETE /me/avatar`, `PATCH /me/password`, `DELETE /me`) wired to controller stubs; mount `UserRoutes` at `/api/v1/users` in `src/app.ts`; verify the routes resolve and tsc passes.

## 2. View & update profile (vertical slice)

- [x] 2.1 `UserService.getProfile`: load the caller's user (owner-scoped by `req.user.userId`), derive linked providers from `accounts`, omit password/secrets; verify `GET /users/me` returns id/name/email/avatar/role/`isPremium`/`premiumSince`/providers/timestamps and 401 without a session.
- [x] 2.2 `UserService.updateProfile`: update `name` only, ignore/reject any email field; verify `PATCH /users/me` changes the name and leaves email unchanged.

## 3. Avatar management (vertical slice)

- [x] 3.1 `UserService.uploadAvatar`: validate image type/size (multer + filter), stream buffer to Cloudinary, set `avatarUrl`/`avatarPublicId`, and delete the previous asset when replacing; verify `PATCH /users/me/avatar` stores the image and, on replace, removes the old asset; a non-image/oversized file is rejected. Implemented + non-image rejection verified end-to-end; the successful-upload/replace path is written and covered by `tests/e2e/user-profile.e2e.test.ts` but auto-skipped (`describe.skipIf`) — this repo's `.env` has placeholder `CLOUDINARY_*` values, no real account configured yet (see `docs/decisions.md`).
- [x] 3.2 `UserService.removeAvatar`: delete the Cloudinary asset (best-effort) and clear `avatarUrl`/`avatarPublicId`; verify `DELETE /users/me/avatar` clears the avatar fields. Same Cloudinary-pending caveat as 3.1.

## 4. Change password (vertical slice)

- [x] 4.1 `UserService.changePassword`: require a `CREDENTIALS` account, verify the current password (bcrypt), set the new hash, and send the `password-changed` email; verify a correct current password changes it (and emails), a wrong one is rejected, and an OAuth-only account is refused with reset guidance.
- [x] 4.2 Wire `PATCH /users/me/password` with validation; verify the endpoint enforces the current-password check and never returns hashes.

## 5. Delete own account (vertical slice)

- [x] 5.1 `UserService.deleteAccount`: soft-delete the caller (`isDeleted`/`deletedAt`), keep the email reserved, and clear the session cookies; verify `DELETE /users/me` marks the account deleted and ends the session.
- [x] 5.2 Verify a soft-deleted user cannot authenticate afterward (login refused; existing tokens rejected by `checkAuth`). Required extending `middleware/checkAuth.ts` beyond its original model-agnostic scope to re-check `isDeleted`/`status` from the DB on every request (previously it only verified the JWT) — the change this task actually specified; logged in `docs/decisions.md`.

## 6. Integration & security verification

- [x] 6.1 Confirm owner-scoping across all endpoints: every operation resolves the target from the session, there are no `/users/:id` routes, and no cross-user access is possible; verify by attempting operations and inspecting queries. Verified by `tests/e2e/user-profile.e2e.test.ts` ("never lets one user's update affect another user's profile") + code inspection: every route resolves the target from `req.user.userId` only.
- [x] 6.2 Confirm no secret leakage: profile and error responses never contain passwordHash/tokens/stack traces and all responses use the standard `sendResponse` envelope; verify on `GET /me`, a wrong-password change, and a forced error. Verified by the same suite.
- [x] 6.3 Full end-to-end test of the flow (get → update name → upload avatar → replace avatar → remove avatar → change password → soft-delete → confirm login refused) — automated instead of manual: `tests/e2e/user-profile.e2e.test.ts` (11 tests: 9 passed, 2 skipped pending real Cloudinary credentials). Run: `npm test` (2026-09-05).
- [x] 6.4 Run `npm run check:fix` (Biome) and `npx tsc --noEmit`; verify both pass clean.
