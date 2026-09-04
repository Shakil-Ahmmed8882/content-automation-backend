## 1. Schema & migration

- [ ] 1.1 Add `ExecutionStatus`, `PublicationStatus`, `AttemptStatus` enums + `executions`, `publications`, `publication_attempts` models + relations (data-model §4.6–§4.8); `prisma migrate dev --name publishing` + generate; verify the three tables + `@@unique([executionId, platformId])` and `@@unique([publicationId, attemptNumber])` exist and tsc passes.

## 2. Publisher abstraction

- [ ] 2.1 Define the `SocialPublisher` interface `publish(content, imageUrl, connection)` + a registry keyed on `platform.key`; verify unknown keys are rejected.
- [ ] 2.2 `LinkedInPublisher` (native fetch, decrypt token via `lib/crypto`, attach image); verify a post publishes to a LinkedIn test account and returns an external id.
- [ ] 2.3 `FacebookPublisher` (Page feed publish with image); verify a post publishes to a test Page and returns an external id.

## 3. Publish trigger (vertical slice)

- [ ] 3.1 `execution.validation.ts`: selected platforms non-empty; `ExecutionService.startPublish` validates post ownership + content + that each selected platform is connected; verify an unconnected platform is refused by name and an empty selection is rejected.
- [ ] 3.2 `ExecutionService.startPublish` creates the `execution` (PENDING) + one `publication` per platform (snapshot account name) and enqueues a BullMQ job; verify the rows are created and a job is queued.
- [ ] 3.3 `POST /api/v1/posts/:id/publish` returns 202 + execution id (auth + validation); verify it returns promptly with the id.

## 4. Background worker (vertical slice)

- [ ] 4.1 BullMQ worker: set execution RUNNING; per publication create attempt #1 (RUNNING), call the publisher, write the terminal attempt + publication status (success: external id/url/publishedAt; failure: reason); verify a queued job publishes each platform and records attempts.
- [ ] 4.2 Compute + persist `execution.status` from publications (COMPLETED/PARTIALLY_COMPLETED/FAILED); verify a forced single-platform failure yields PARTIALLY_COMPLETED.
- [ ] 4.3 Start the worker in `server.ts`; verify it processes jobs and that the publish continues after the client disconnects.

## 5. Integration & security

- [ ] 5.1 Confirm owner-scoping (own posts + own connections only) and that stored failure reasons/responses never contain tokens or stack traces; verify by inspecting a failed publication.
- [ ] 5.2 Run `npm run check:fix` + `npx tsc --noEmit`; verify both pass; full manual publish (2 platforms, one forced failure, browser closed mid-run).
