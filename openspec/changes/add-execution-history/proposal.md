## Why

Users need to see what they published, whether each platform succeeded, and why anything failed —
the Executions page (PRD §14). This flow is the **read** side of publishing: it lists a user's
executions and shows per-platform detail. It reads the tables owned by #5 — **no new tables**.

## What Changes

- **List my executions:** `GET /api/v1/executions` — owner-scoped, paginated/sortable/filterable
  (by status, date), each row showing the content reference/title, the platforms, overall status,
  and started/completed times (§14 table).
- **Execution detail:** `GET /api/v1/executions/:id` — the content, and per-platform results
  (publication status, external post url on success, failure reason on failure, published time),
  plus which platforms are retryable (failed) so the UI can offer Retry (#6).

Read-only; surfaces the status the #5 worker computes and the reasons the attempts ledger records.

## Capabilities

### New Capabilities
- `execution-history`: list a user's publishing executions and view per-execution, per-platform
  results and failure reasons.

### Modified Capabilities
<!-- None. Reads publishing tables from add-publish-execution. -->

## Impact

- **Data model:** none — reads `executions` / `publications` / `publication_attempts` (#5) and
  `posts` (#4, incl. soft-deleted, for the content reference).
- **Module:** read endpoints in `src/app/module/execution/`; mounted at `/api/v1/executions`.
- **Libs:** `lib/prisma`, `middleware/checkAuth`, `utils/sendResponse` (with `meta`).
- **Security (§14/§23):** owner-scoped; failure reasons shown are the stored, sanitized messages
  (never tokens/stack traces).
- **Depends on (synced):** #5 (tables + computed status), #6 (retryable = failed publications).
