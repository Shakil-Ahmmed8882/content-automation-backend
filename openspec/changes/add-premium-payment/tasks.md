## 1. Schema & migration

- [ ] 1.1 Add `PaymentProvider`/`PaymentPurpose`/`PaymentStatus` enums + `payments` model + `User.payments[]` (data-model §4.9); `prisma migrate dev --name payments` + generate; verify the table + unique refs (`merchantInvoiceNumber`, `providerPaymentId`, `providerTransactionId`) exist and tsc passes.

## 2. Create payment (vertical slice)

- [ ] 2.1 `PaymentService.create`: read amount/currency from config, create a PENDING payment with a unique `merchantInvoiceNumber`, call bKash `create` (via `lib/bkash` id token), store `providerPaymentId`, and return the bKash URL; verify a pending payment is created and a URL returned.
- [ ] 2.2 `POST /api/v1/payments/create` (auth); verify end-to-end initiation against the sandbox.

## 3. Verify + activate premium (vertical slice)

- [ ] 3.1 `PaymentService.executeAndVerify`: call bKash `execute`, confirm success (`statusCode 0000`), and in a `$transaction` set the payment SUCCESS (+ trx refs, `gatewayResponse`, `paidAt`) and `user.isPremium=true`/`premiumSince=now`; verify confirmed success activates premium and a failed/cancelled one does not.
- [ ] 3.2 Idempotency: a replayed callback/verify for an already-SUCCESS payment changes nothing; verify no second grant and no duplicate row.
- [ ] 3.3 `GET /api/v1/payments/callback` (execute+verify → redirect to frontend success/failure) and `POST /api/v1/payments/verify` (idempotent safety net); verify both paths.

## 4. Status + integration & security

- [ ] 4.1 `GET /api/v1/payments/:id` owner-scoped status; verify only the owner can read it.
- [ ] 4.2 Confirm premium is never granted from a client signal (server-verify only) and no gateway secrets/errors leak to clients; verify with a spoofed "success" call.
- [ ] 4.3 Run `npm run check:fix` + `npx tsc --noEmit`; verify both pass; full sandbox end-to-end (create → pay → verify → premium; replay → no double-grant).
