## Context

See `proposal.md` — Why. A behavior-only addition on top of #5 (publishing): same tables, same
worker, same `SocialPublisher`. Realizes the manual-retry half of the attempts ledger (data-model
§4.8, PRD §13). Depends on #3 for the current-connection lookup.

## Goals / Non-Goals

**Goals:** per-platform manual retry that appends to the ledger and rebinds to the live connection.
**Non-Goals:** auto-retry, backoff, dead-letter queues, retry policies (all explicitly future, §13).

## Decisions

### D1: Retry enqueues a job scoped to the failed publication(s); the #5 worker handles it
Retry adds no new pipeline — it computes the next `attemptNumber` and enqueues the same publish job
for the target publication(s). The worker appends the attempt, re-runs the publisher, and updates
status. Execution-level retry expands to its FAILED publications.
- **Why:** one execution engine; retry is just "publish this publication again."

### D2: Rebind to the current connection at retry time
The original `connectionId` may be null (connection hard-deleted on disconnect). Retry resolves the
user's current connection for the publication's `platformId` and updates the publication's
`connectionId` before attempting; absence → refuse with reconnect guidance.
- **Why:** data-model §4.8 retry example (connection re-bound); avoids using a stale/removed token.

### D3: Guard states — only FAILED is retryable; recompute after
Success/pending publications reject retry. After a retry completes, recompute `execution.status`
(parent-cache) so a partial can become complete.

### D4: `retryCount` stays derived (`max(attemptNumber) − 1`)
No stored counter — the ledger is the source of truth (data-model §4.8).

## Risks / Trade-offs

- **Concurrent double-retry of the same publication.** → Guard on current status (must be FAILED)
  and rely on the attempt uniqueness `@@unique([publicationId, attemptNumber])`; a racing second
  retry no-ops or conflicts safely.
- **Retrying floods a rate-limited provider.** → Manual-only + owner-scoped bounds it; auto-retry
  with backoff is a future concern.

## Migration Plan

1. No schema change.
2. Add retry routes + service (rebind + enqueue) reusing the #5 worker/publishers.
3. Manual test: force a Facebook failure, reconnect, retry the publication → SUCCESS + execution
   flips to COMPLETED; retry a succeeded one → refused.
