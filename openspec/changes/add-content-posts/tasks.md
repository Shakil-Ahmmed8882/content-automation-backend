## 1. Schema & migration

- [x] 1.1 Add the `posts` model + `User.posts[]` (data-model §4.5); `prisma migrate dev --name posts` + generate; verify the table exists and tsc passes.

## 2. Create post + image (vertical slice)

- [x] 2.1 `post.validation.ts` + `post.interface.ts` (create payload: `title?`, non-empty `content`; image validated by multer filter); verify empty content is rejected.
- [x] 2.2 `PostService.create`: upload the optional image to Cloudinary (`imageUrl`/`imagePublicId`), create the owner-scoped post; verify a post is created with and without an image, and an invalid image is rejected (with best-effort cleanup on failure).
- [x] 2.3 `POST /api/v1/posts` (auth + multipart + validation); verify end-to-end creation returns the post.

## 3. Read & list (vertical slice)

- [x] 3.1 `PostService.list` with pagination/sort/search, excluding soft-deleted, owner-scoped; verify `GET /api/v1/posts` returns only the caller's non-deleted posts with `meta`.
- [x] 3.2 `PostService.getById` owner-scoped; verify `GET /api/v1/posts/:id` returns an owned post and reveals nothing for a non-owned id.

## 4. Delete (vertical slice)

- [x] 4.1 `PostService.softDelete`; verify `DELETE /api/v1/posts/:id` marks the post deleted, removes it from listings, and retains the record.

## 5. Integration & security

- [x] 5.1 Confirm owner-scoping on list/get/delete and that no edit endpoint exists; verify cross-user access is impossible.
- [x] 5.2 Run `npm run check:fix` + `npx tsc --noEmit`; verify both pass. Automated instead of manual: `tests/e2e/content-posts.e2e.test.ts` (17 tests: 16 passed, 1 skipped pending real Cloudinary credentials, same posture as user-profile/platform-catalogue). Run: `npm test` (2026-09-09, re-verified via `/opsx:verify`).
