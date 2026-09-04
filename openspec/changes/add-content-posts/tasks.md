## 1. Schema & migration

- [ ] 1.1 Add the `posts` model + `User.posts[]` (data-model §4.5); `prisma migrate dev --name posts` + generate; verify the table exists and tsc passes.

## 2. Create post + image (vertical slice)

- [ ] 2.1 `post.validation.ts` + `post.interface.ts` (create payload: `title?`, non-empty `content`; image validated by multer filter); verify empty content is rejected.
- [ ] 2.2 `PostService.create`: upload the optional image to Cloudinary (`imageUrl`/`imagePublicId`), create the owner-scoped post; verify a post is created with and without an image, and an invalid image is rejected (with best-effort cleanup on failure).
- [ ] 2.3 `POST /api/v1/posts` (auth + multipart + validation); verify end-to-end creation returns the post.

## 3. Read & list (vertical slice)

- [ ] 3.1 `PostService.list` with pagination/sort/search, excluding soft-deleted, owner-scoped; verify `GET /api/v1/posts` returns only the caller's non-deleted posts with `meta`.
- [ ] 3.2 `PostService.getById` owner-scoped; verify `GET /api/v1/posts/:id` returns an owned post and reveals nothing for a non-owned id.

## 4. Delete (vertical slice)

- [ ] 4.1 `PostService.softDelete`; verify `DELETE /api/v1/posts/:id` marks the post deleted, removes it from listings, and retains the record.

## 5. Integration & security

- [ ] 5.1 Confirm owner-scoping on list/get/delete and that no edit endpoint exists; verify cross-user access is impossible.
- [ ] 5.2 Run `npm run check:fix` + `npx tsc --noEmit`; verify both pass; manual end-to-end (create → list → get → delete).
