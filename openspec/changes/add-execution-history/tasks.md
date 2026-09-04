## 1. Execution list (vertical slice)

- [ ] 1.1 `ExecutionService.list` (owner-scoped) with pagination/sort and filtering by status/date, returning content reference/title, platforms, overall status, and started/completed times; verify `GET /api/v1/executions` returns only the caller's executions with `meta` and that status filtering works.

## 2. Execution detail (vertical slice)

- [ ] 2.1 `ExecutionService.getDetail` (owner-scoped): content (from post, incl. soft-deleted) + per-platform publication status, external url, failure reason (latest attempt), published time, and a failed/retryable flag; verify `GET /api/v1/executions/:id` shows per-platform detail and identifies failed platforms.
- [ ] 2.2 Verify content still displays for an execution whose post was later soft-deleted.

## 3. Integration & security

- [ ] 3.1 Confirm owner-scoping (cross-user execution access refused) and that reasons/responses contain no tokens or stack traces.
- [ ] 3.2 Run `npm run check:fix` + `npx tsc --noEmit`; verify both pass; manual end-to-end (publish via #5 → list → open detail → see per-platform results).
