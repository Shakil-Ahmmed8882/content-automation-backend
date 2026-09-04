## Context

See `proposal.md` — Why. Materializes `payments` (data-model §4.9). Reuses `lib/bkash` (tokenized
grant/refresh with Redis caching, already ported). bKash **sandbox** — dummy money (data-model
§4.9). Backend-authoritative premium (PRD §32 R5).

## Goals / Non-Goals

**Goals:** a provider-agnostic payment ledger + a correct, idempotent, server-verified bKash flow
that activates premium exactly once.
**Non-Goals:** subscriptions/plans, refunds, a real merchant account (all deferred, data-model §7);
listing history (#9).

## Decisions

### D1: Provider-agnostic ledger; bKash specifics in typed columns + `gatewayResponse` JSON
`payments` stores generic `provider`/`purpose`/`amount`/`currency`/`status` + `merchantInvoiceNumber`
(unique), `providerPaymentId`/`providerTransactionId` (unique), and the raw `gatewayResponse`.
- **Why:** data-model §4.9; adding Stripe later is a new enum value, not a reshape.

### D2: Server-side verify on the bKash callback (execute), then activate in a transaction
Create → bKash `create` → user pays → bKash calls our callback → we call bKash `execute` to confirm
(statusCode `0000`) → in a single `$transaction` set the payment SUCCESS + `user.isPremium=true` +
`premiumSince`. Then redirect to the frontend success/failure page.
- **Why:** never trust the callback's status alone (§23); the transaction keeps payment+premium consistent.

### D3: Idempotency via unique gateway references
`merchantInvoiceNumber` (our order ref) + `providerTransactionId` (bKash trx) are unique, so a
replayed callback/verify finds the already-SUCCESS payment and no-ops — premium is never granted twice.

### D4: Amount/currency from config, recorded on the row
`PREMIUM_PRICE`/`PREMIUM_CURRENCY` are read at create and stored on the payment, so the row records
what was actually charged (data-model §4.9).

### D5: `verify` endpoint as a safety net
If the callback is lost, `POST /payments/verify` re-runs execute/verify idempotently for a payment id.

## Risks / Trade-offs

- **Lost callback leaves a PENDING payment.** → `verify` reconciles; a future sweep can auto-reconcile
  stale PENDINGs against bKash. Acceptable for MVP.
- **bKash token/rate limits.** → `lib/bkash` already caches the id token and rate-limits refresh.
- **Double-click creates two payments.** → Each is its own PENDING row; only a gateway-confirmed one
  grants premium, and premium activation is idempotent, so no double-grant.

## Migration Plan

1. Add `PaymentProvider`/`PaymentPurpose`/`PaymentStatus` enums + `payments` model + `User.payments[]`
   (data-model §4.9); `prisma migrate dev --name payments` + generate.
2. Implement create/callback(execute+verify)/verify/status using `lib/bkash`.
3. Manual sandbox test: create → pay → callback verifies → premium activated; replay callback → no
   double-grant; cancelled payment → no premium.
