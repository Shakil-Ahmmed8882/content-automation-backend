## 1. Payment history list (vertical slice)

- [ ] 1.1 `PaymentService.listMine` (owner-scoped, newest first, pagination + status filter, projecting provider/purpose/amount/currency/status/date, excluding `gatewayResponse`); verify only display fields are returned.
- [ ] 1.2 `GET /api/v1/payments` (auth); verify it returns the caller's payments including FAILED/CANCELLED with `meta`, and status filtering works.

## 2. Integration & security

- [ ] 2.1 Confirm owner-scoping (no other users' payments) and no gateway secrets in the response.
- [ ] 2.2 Run `npm run check:fix` + `npx tsc --noEmit`; verify both pass; manual end-to-end after a sandbox payment.
