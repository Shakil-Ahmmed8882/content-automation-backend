## 1. Schema & migration

- [ ] 1.1 Add `UpcomingFeatureStatus` enum + `upcoming_features` model (data-model §4.10); `prisma migrate dev --name upcoming-features` + generate; verify the table + unique `slug` exist and tsc passes.
- [ ] 1.2 Seed a few initial features (e.g., AI Content Enhancement, Scheduled Publishing); verify rows exist.

## 2. Admin CRUD (vertical slice)

- [ ] 2.1 `upcomingFeature.validation.ts` + interface (create/update, unique slug, status enum); verify a duplicate slug is rejected.
- [ ] 2.2 `UpcomingFeatureService` create/list-all/get/update/delete; verify each operation and that list returns all (incl. hidden).
- [ ] 2.3 Admin routes under `/api/v1/admin/upcoming-features` guarded by `auth("ADMIN","SUPER_ADMIN")`; verify a non-admin gets 403.

## 3. Image (vertical slice)

- [ ] 3.1 `UpcomingFeatureService.setImage`: validate + Cloudinary upload (`imageUrl`/`imagePublicId`), delete old on replace; verify `PATCH /admin/upcoming-features/:id/image` stores and replaces.

## 4. Premium browsing (vertical slice)

- [ ] 4.1 `GET /api/v1/upcoming-features` (list, ordered by sortOrder) and `GET /api/v1/upcoming-features/:slug` (detail), guarded by `auth` + `requirePremium`; verify a premium user gets ordered list + detail and a non-premium user gets 403.

## 5. Integration & security

- [ ] 5.1 Confirm premium gate reads the DB flag (not a client value) and management is admin-only; verify both gates.
- [ ] 5.2 Run `npm run check:fix` + `npx tsc --noEmit`; verify both pass; manual end-to-end (admin create → premium browse → non-premium denied).
