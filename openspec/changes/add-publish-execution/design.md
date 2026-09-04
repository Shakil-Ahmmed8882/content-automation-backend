## Context

See `proposal.md` — Why. The critical background-execution requirement (PRD §12/§24). Depends on
#3 (connections + `lib/crypto`), #4 (posts), #2 (platforms). Materializes `executions`,
`publications`, `publication_attempts` (data-model §4.6–§4.8). `lib/queue` (BullMQ) is scaffolded.

## Goals / Non-Goals

**Goals:** durable background publishing that survives a closed browser; a per-platform attempts
ledger from the first publish; a publisher abstraction so new platforms plug in.
**Non-Goals:** retry (#6), read/history endpoints (#7), scheduling/auto-retry (future).

## Decisions

### D1: API creates the execution + publications synchronously, then enqueues; the worker publishes
`POST /posts/:id/publish` validates, creates the `execution` (PENDING) + one `publication` per
platform (PENDING, with `platformAccountName` snapshot), enqueues a BullMQ job with the execution
id, and returns 202. A BullMQ **Worker** (started in `server.ts`) runs the publish.
- **Why:** the request stays fast and the work survives client disconnect (PRD §24); the DB rows
  exist immediately so status is queryable (by #7).

### D2: First publish is attempt #1 in the ledger (not a special case)
The worker creates a `publication_attempt` (RUNNING) per platform, calls the publisher, then writes
the terminal attempt state and promotes success fields onto the publication. Retry (#6) simply adds
attempt #2+.
- **Why:** data-model §4.8 — one ledger, no reshape when retry lands.

### D3: `SocialPublisher` abstraction dispatched on `platform.key`
`publish(content, imageUrl, connection)` implemented by `LinkedInPublisher` / `FacebookPublisher`
(native `fetch` to each provider), selected by the platform's `key` (PRD §27). Tokens are decrypted
via `lib/crypto` only inside the publisher.
- **Alternative:** provider logic inline in the service. Rejected — scatters integration code (§27).

### D4: Parent caches child status; worker computes and persists
The worker sets each `publication.status` from its latest attempt and recomputes `execution.status`
(COMPLETED / PARTIALLY_COMPLETED / FAILED / RUNNING) as publications finish (data-model §4.6).

### D5: Media is fetched from the stored image URL and handed to the provider
Publishers read `post.imageUrl` (Cloudinary) and upload/attach per each provider's API. No new storage.

### D6: Reads live in #7; writes/worker live here
This flow exposes only the publish trigger over HTTP. Listing/detail/status reads are #7 (they read
these same tables). Kept separate to honor the flow split without duplicating endpoints.

## Risks / Trade-offs

- **Worker crash mid-execution leaves RUNNING rows.** → BullMQ ret/visibility + on-boot
  reconciliation can re-drive or mark stalled; MVP: single attempt, statuses are re-derivable from
  publications. Note for a future recovery pass.
- **Provider rate limits / partial failures.** → Per-platform isolation: one platform failing does
  not fail the others; overall becomes PARTIALLY_COMPLETED.
- **Expired token at publish.** → Publisher returns a clear "reconnect" failure stored on the attempt;
  the user retries after reconnecting (#6).
- **In-memory-only execution (anti-pattern PRD §24).** → We use BullMQ + Redis, not a bare timer.

## Migration Plan

1. Add the 3 models + 3 enums + relations (data-model §4.6–§4.8); `prisma migrate dev --name publishing` + generate.
2. Implement publishers + the execution service + the BullMQ worker; start the worker in `server.ts`.
3. Manual end-to-end against sandbox apps: publish to LinkedIn+Facebook, force one failure, confirm
   PARTIALLY_COMPLETED and that the browser can close mid-run.
