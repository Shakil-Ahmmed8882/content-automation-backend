## Why

This is the heart of the product: turning one post into a background-executed publish across the
selected platforms (PRD §10–§12, §24, §27; data-model §4.6–§4.8). It owns the `executions`,
`publications`, and `publication_attempts` tables and the background worker, so a user clicks
Publish, gets "started" immediately, and the backend finishes independently even if the browser
closes. Depends on posts (#4) and connections (#3).

## What Changes

- **Publish now:** `POST /api/v1/posts/:id/publish` with the selected platforms → validates
  (post owned + not deleted, content present, at least one platform, each selected platform is
  **connected**), creates an `execution` + one `publication` per platform (snapshotting the
  connection's account name), enqueues a background job, and returns **202 "started"** with the
  execution id. The browser may close (§12).
- **Background worker:** consumes the job, runs the sequence per PRD §25 (prepare → publish each
  platform → complete), recording **attempt #1** in the ledger per platform: success stores the
  external post id/url; failure stores the reason (e.g., "reconnect Facebook").
- **Status computation:** the worker sets each `publication.status` and computes the overall
  `execution.status` (COMPLETED / PARTIALLY_COMPLETED / FAILED), per data-model §4.6.
- **Publisher abstraction:** `SocialPublisher` with `LinkedInPublisher` / `FacebookPublisher`
  dispatched on `platform.key`, using the decrypted connection token (via `lib/crypto`).

Materializes `executions`, `publications`, `publication_attempts` + the `ExecutionStatus`,
`PublicationStatus`, `AttemptStatus` enums and their relations. **Reads** (status/list/detail) are
owned by #7; **retry** by #6.

## Capabilities

### New Capabilities
- `publishing`: start a background publish of a post to selected connected platforms, fan out to
  per-platform publications with an attempts ledger, and compute per-platform + overall status.

### Modified Capabilities
<!-- None. -->

## Impact

- **Data model:** adds `executions`, `publications`, `publication_attempts` + 3 enums + relations
  on `users`/`posts`/`platforms`/`social_connections` (migration).
- **Module:** `src/app/module/execution/`; publish route mounted at `/api/v1/posts/:id/publish`.
- **Libs:** `lib/queue` (BullMQ worker — start it in `server.ts`), `lib/crypto` (decrypt tokens),
  native `fetch` (provider publish APIs), `lib/cloudinary`/image URL for media, `lib/prisma`.
- **Security (§22/§23):** owner-scoped; failure reasons stored but never leak tokens/stack traces;
  publishing only to connected, LIVE platforms.
- **Downstream (synced):** #6 adds retry (new attempts on existing `publications`); #7 adds the
  list/detail reads; #11 audit-logs publish actions once it lands.
