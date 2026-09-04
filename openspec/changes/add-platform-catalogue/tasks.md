## 1. Schema & migration

- [ ] 1.1 Add `PlatformStatus` enum + `platforms` model (data-model §4.3) to `prisma/schema/`; run `prisma migrate dev --name platforms` + `prisma generate`; verify the table exists and `tsc --noEmit` passes.
- [ ] 1.2 Seed initial LIVE platforms (`linkedin`, `facebook`) via a seed script; verify both rows exist.

## 2. Admin catalogue CRUD (vertical slice)

- [ ] 2.1 `platform.validation.ts` + `platform.interface.ts` (create/update payloads, unique key, status enum); verify tsc passes.
- [ ] 2.2 `PlatformService` create/list-all/get/update; verify create rejects a duplicate key, list returns inactive rows too, and update persists name/status/sortOrder/isActive.
- [ ] 2.3 Admin routes `POST/GET/GET :id/PATCH :id` under `/api/v1/admin/platforms` guarded by `auth("ADMIN","SUPER_ADMIN")`; verify a non-admin gets 403.

## 3. Logo management (vertical slice)

- [ ] 3.1 `PlatformService.setLogo`: validate image, stream to Cloudinary, store `logoUrl`/`logoPublicId`, delete the old asset on replace; verify `PATCH /admin/platforms/:id/logo` stores the logo and removes a prior one.

## 4. Retire + public list (vertical slice)

- [ ] 4.1 Retire via `PATCH isActive=false` (no hard delete); verify a retired platform disappears from the active list but the record remains.
- [ ] 4.2 `GET /api/v1/platforms` returns active platforms ordered by `sortOrder` for any authenticated user; verify ordering and that inactive rows are excluded.

## 5. Integration & security

- [ ] 5.1 Confirm all mutations require admin and the public list requires auth; verify role gating on each route.
- [ ] 5.2 Run `npm run check:fix` + `npx tsc --noEmit`; verify both pass; manual end-to-end (create → logo → update → retire → public list).
