## Why

Payment is the MVP requirement that turns a user Premium and unlocks Upcoming Features (PRD §15,
§16). This flow owns the `payments` table and the bKash **sandbox** tokenized-checkout flow, and it
activates premium **only after server-side verification** — never trusting a client signal (§23,
§32 R5). Reuses the `lib/bkash` token machinery ported from the reference.

## What Changes

- **Create payment:** `POST /api/v1/payments/create` — starts a bKash tokenized payment for the
  premium upgrade (amount/currency from config), creates a `payments` row (PENDING) with a unique
  `merchantInvoiceNumber`, and returns the bKash payment URL.
- **Callback (server-verified):** `GET /api/v1/payments/callback` — bKash returns here; the backend
  **executes/verifies** the payment against bKash, and on confirmed success sets the payment to
  SUCCESS and activates premium (`user.isPremium = true`, `premiumSince = now`) in one transaction,
  then redirects to the frontend success/failure page.
- **Verify (idempotent safety net):** `POST /api/v1/payments/verify` — re-verify a payment by id if
  the callback was missed; safe to call repeatedly.
- **Payment status:** `GET /api/v1/payments/:id` — status of a specific payment (for polling).

Materializes `payments` + the `PaymentProvider`, `PaymentPurpose`, `PaymentStatus` enums +
`User.payments[]`. Premium is a **cache** written here; listing history is #9.

## Capabilities

### New Capabilities
- `premium-payment`: create and server-verify a bKash payment for the premium upgrade, and activate
  the user's premium status on confirmed success.

### Modified Capabilities
<!-- None. Writes the existing `users.isPremium`/`premiumSince` cache; reads by profile/upcoming flows. -->

## Impact

- **Data model:** adds `payments` (data-model §4.9) + 3 enums + `User.payments[]` (migration). Sets
  the existing `users.isPremium`/`premiumSince`.
- **Module:** `src/app/module/payment/`; mount at `/api/v1/payments`.
- **Libs:** `lib/bkash` (token grant/refresh — already implemented), native `fetch` (bKash
  create/execute), `lib/prisma` (`$transaction` for verify+activate), `middleware/checkAuth`.
- **Config/env:** `BKASH_*`, `PREMIUM_PRICE`, `PREMIUM_CURRENCY`, `FRONTEND_BASE_URL`
  (already present). **Sandbox — test money, not real** (data-model §4.9).
- **Security (§15/§23):** verification is server-side; unique gateway refs give idempotency (no
  double-grant on replayed callbacks); premium never trusted from the client.
- **Downstream (synced):** #9 lists these `payments`; #10 upcoming-features reads `isPremium`.
