## Why

Publishing can partially fail (e.g., an expired Facebook token). Users need to fix the cause and
retry just the failed platform without re-publishing the successful ones (PRD §13; data-model
§4.8 attempts ledger). This flow adds manual retry on top of the publishing engine (#5), reusing
its tables and worker — **no new tables**.

## What Changes

- **Retry a failed publication:** `POST /api/v1/publications/:id/retry` — the "[Retry Facebook]"
  action; retries one failed publication.
- **Retry an execution's failures:** `POST /api/v1/executions/:id/retry` — retries all FAILED
  publications in that execution.
- **Re-bind to the current connection:** retry looks up the user's *current* connection for the
  platform (the original may have been disconnected) and rebinds the publication to it; if none
  exists, retry is refused with "reconnect first" (PRD §22).
- **New attempt appended:** each retry adds the next `publication_attempt` (attempt #N), re-runs the
  publisher in the background, updates the publication status, and recomputes the overall
  `execution.status` (PARTIALLY_COMPLETED → COMPLETED on success). No auto-retry (manual only, §13).

## Capabilities

### New Capabilities
- `publication-retry`: manual, per-platform retry of failed publications — reconnect-aware, appended
  to the attempts ledger, with recomputed execution status.

### Modified Capabilities
<!-- None. Uses the publishing tables/worker from add-publish-execution; adds behavior, not schema. -->

## Impact

- **Data model:** none — reuses `publications` / `publication_attempts` from #5.
- **Module:** extends `src/app/module/execution/` (retry routes/service); reuses the #5 worker +
  `SocialPublisher`.
- **Libs:** `lib/queue` (retry jobs), `lib/crypto` (decrypt current connection token), `lib/prisma`.
- **Security:** owner-scoped; only FAILED publications retryable; no token/stack-trace leakage.
- **Depends on (synced):** #5 (tables, worker, publishers) and #3 (current connection lookup).
