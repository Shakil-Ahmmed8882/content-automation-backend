## Why

The core user action is creating a piece of content — text plus one optional image — that will
later be published to multiple platforms (PRD §9, data-model §4.5). This flow owns the `posts`
table and the content CRUD surface, and it reuses the Cloudinary image pattern established in
user-profile. Platform selection is deliberately **not** here — it happens at publish time (#5).

## What Changes

- **Create a post:** `POST /api/v1/posts` — multipart: `title?`, `content` (required, non-empty),
  optional `image` → validated + uploaded to Cloudinary (`imageUrl` + `imagePublicId`).
- **List my posts:** `GET /api/v1/posts` — owner-scoped, with pagination, sort, and search.
- **Get one post:** `GET /api/v1/posts/:id` — owner-scoped.
- **Delete a post:** `DELETE /api/v1/posts/:id` — **soft delete** (keeps execution history readable).

Posts are **immutable** (no edit endpoint, per data-model §4.5) so the content shown in publishing
history is exactly what was published. Materializes the `posts` table + `User.posts[]` relation.

## Capabilities

### New Capabilities
- `content-posts`: create, list, retrieve, and delete a user's content posts (text + one optional
  image), scoped to the owner.

### Modified Capabilities
<!-- None. -->

## Impact

- **Data model:** adds `posts` (data-model §4.5) + `User.posts[]` (migration).
- **Module:** `src/app/module/post/`; mount at `/api/v1/posts`.
- **Libs:** `lib/multer` + `lib/cloudinary` (image), `lib/prisma`, `middleware/checkAuth`,
  `middleware/validateRequest`, `utils/sendResponse` (with `meta` for pagination).
- **Security (§9/§23):** owner-scoped everywhere; content non-empty; image type/size validated;
  soft-delete preserves history.
- **Downstream (synced):** #5 publishing reads a post by id (owner-scoped) and fans out to the
  platforms selected at publish time; #7 history reads posts (incl. soft-deleted) for display.
