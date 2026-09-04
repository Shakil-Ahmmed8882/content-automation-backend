## Context

See `proposal.md` — Why. Depends only on auth + the Cloudinary image pattern from user-profile.
Materializes `posts` (data-model §4.5). No platform coupling here — platform selection lives on the
publish action (#5), per data-model decision #10.

## Goals / Non-Goals

**Goals:** a faithful, immutable content record + owner-scoped CRUD with list pagination/search.
**Non-Goals:** editing posts, platform selection, drafts/scheduling (all out of MVP or later flows).

## Decisions

### D1: Posts are immutable — create + read + soft-delete only
No update endpoint (data-model §4.5). Content shown later in history equals what was published, so
executions need no content snapshot.
- **Alternative:** editable posts + snapshot content on each execution. Rejected — adds a snapshot
  table/column for no MVP benefit.

### D2: Image at create via multipart → Cloudinary (url + publicId)
Same pattern as avatars/logos. One image per post; validated type/size; stored as `imageUrl` +
`imagePublicId`. Because posts are immutable there is no replace path.

### D3: Soft-delete, owner-scoped
`isDeleted`/`deletedAt`; lists exclude deleted; get/delete resolve ownership from the session (no
cross-user access, §23). Deleting a post does not remove its executions (history persists).

### D4: List supports pagination + sort + search, returned via `meta`
The list endpoint honors `page`/`limit`/`sort`/`search` and returns pagination `meta` through
`sendResponse` (assignment requirement; consistent across list endpoints).

## Risks / Trade-offs

- **Deleting a post mid-publish.** → Soft-delete keeps `postId` resolvable for the running/finished
  execution; the post simply leaves the user's list. Acceptable.
- **Orphaned Cloudinary image if create fails after upload.** → Upload within the create path; on
  failure, best-effort delete the just-uploaded asset. Logged.

## Migration Plan

1. Add `posts` model + `User.posts[]` (data-model §4.5); `prisma migrate dev --name posts` + generate.
2. Implement `src/app/module/post/`; mount at `/api/v1/posts`.
3. Manual end-to-end: create (with/without image) → list (paginate/search) → get → soft-delete.
