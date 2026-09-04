## Context

See `proposal.md` — Why. A thin read layer over `payments` (#8, data-model §4.9). No schema change.

## Goals / Non-Goals

**Goals:** an owner-scoped, paginated, filterable payment list.
**Non-Goals:** creating/verifying payments (#8); single-payment status/detail (#8's `GET /payments/:id`);
refunds/receipts (deferred, data-model §7).

## Decisions

### D1: List reads `payments WHERE userId = session`, newest first, with `meta`
Backed by the existing `(userId, createdAt)` index. Supports `page`/`limit`/`status` filter.
Returns provider/purpose/amount/currency/status/date — not the raw `gatewayResponse`.

### D2: Endpoint separation from #8
`GET /payments` (list) lives here; `GET /payments/:id` (single status) stays in #8. No overlap.

## Risks / Trade-offs

- **Sensitive raw gateway payloads.** → The list projects only display fields; `gatewayResponse` is
  never returned.

## Migration Plan

1. No schema change.
2. Add the list read service + `GET /api/v1/payments` route.
3. Manual verify: list shows successes + failures + cancellations, paginates/filters, owner-scoped.
