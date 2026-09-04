## Context

See `proposal.md` — Why. Pure read layer over #5's tables (data-model §4.6–§4.8) + #4 posts. No
schema change. Depends on #5 (data + computed status) and, for the retryable flag, #6.

## Goals / Non-Goals

**Goals:** an efficient, owner-scoped list + detail that faithfully surfaces stored status/reasons.
**Non-Goals:** computing status (that's the #5 worker); mutating anything; the workflow visualization
(a frontend concern, PRD §26 — this API just feeds it).

## Decisions

### D1: List reads executions with a per-platform summary; detail joins publications (+ latest attempt)
List: executions + a compact publications summary (platform + status). Detail: publications with
their promoted success fields and the latest attempt's `errorMessage` for the reason. `retryCount`
is derived from attempts.
- **Why:** matches §14's table + detail view without storing anything new.

### D2: Content comes from the post, including soft-deleted
`execution.postId` resolves even when the post is soft-deleted (data-model §4.5), so history stays
faithful. Only the content needed for display is returned.

### D3: Pagination/filter/sort with `meta`
`page`/`limit`/`sort`/`status`/date filters; pagination `meta` via `sendResponse`, consistent with
other list endpoints.

### D4: Owner-scoping and sanitized reasons
Every query is filtered by `userId` from the session; reasons are the stored sanitized messages
(the #5 worker never stored tokens/stack traces).

## Risks / Trade-offs

- **N+1 across executions→publications.** → Use Prisma `include`/batched queries; index `executionId`
  (already in the model). Acceptable at MVP scale.

## Migration Plan

1. No schema change.
2. Implement list + detail read services + routes under `/api/v1/executions`.
3. Manual verify: list paginates/filters; detail shows per-platform status + reasons + external urls;
   history for a deleted post still shows content; cross-user access refused.
