## 1. Retry service (vertical slice)

- [ ] 1.1 `ExecutionService.retryPublication(publicationId)`: assert owner + FAILED state, resolve the current connection for the platform (refuse with reconnect guidance if none), rebind `connectionId`, compute the next attempt number, and enqueue a retry job; verify a non-failed publication and a missing connection are both refused.
- [ ] 1.2 `ExecutionService.retryExecution(executionId)`: expand to the execution's FAILED publications and enqueue each; verify successful publications are left untouched.

## 2. Worker retry path

- [ ] 2.1 Extend the #5 worker to append attempt #N for a retried publication, re-run the publisher, write the terminal attempt + publication status, and recompute `execution.status`; verify a resolved failure flips the publication to SUCCESS and the execution from PARTIALLY_COMPLETED to COMPLETED.

## 3. Endpoints (vertical slice)

- [ ] 3.1 `POST /api/v1/publications/:id/retry` (auth, owner-scoped); verify the "[Retry Facebook]" path works end-to-end.
- [ ] 3.2 `POST /api/v1/executions/:id/retry` (auth, owner-scoped); verify only failed platforms are retried.

## 4. Integration & security

- [ ] 4.1 Confirm owner-scoping, FAILED-only guard, reconnect-required behavior, and no token/stack-trace leakage in reasons/responses.
- [ ] 4.2 Run `npm run check:fix` + `npx tsc --noEmit`; verify both pass; manual end-to-end (fail → reconnect → retry → COMPLETED).
