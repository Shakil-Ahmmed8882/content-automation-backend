## Why

Users should be able to see their payment history — successes, failures, and cancellations — with
provider and amount details (user request; PRD §15 stores enough to show it). This is the **read**
side of payments: a list over the `payments` table owned by #8. **No new tables.**

## What Changes

- **List my payments:** `GET /api/v1/payments` — the authenticated user's payments ordered newest
  first, each showing provider, purpose, amount, currency, status (including FAILED/CANCELLED), and
  date. Supports pagination and filtering by status. (Single-payment detail/status is #8's
  `GET /payments/:id`.)

## Capabilities

### New Capabilities
- `payment-history`: list a user's own payments with provider, amount, and status — including
  failures and cancellations.

### Modified Capabilities
<!-- None. Reads the payments ledger from add-premium-payment. -->

## Impact

- **Data model:** none — reads `payments` (#8).
- **Module:** a read endpoint in `src/app/module/payment/`; mounted at `/api/v1/payments`.
- **Libs:** `lib/prisma`, `middleware/checkAuth`, `utils/sendResponse` (with `meta`); index
  `(userId, createdAt)` (already in the model) backs the listing.
- **Security (§23):** owner-scoped; no gateway secrets in the response.
- **Depends on (synced):** #8 (the payments ledger).
