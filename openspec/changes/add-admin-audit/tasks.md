## 1. Schema & audit mechanism

- [ ] 1.1 Add the `audit_logs` model + `User.auditLogs[]` (data-model §4.11); `prisma migrate dev --name audit-logs` + generate; verify the table + indexes exist and tsc passes.
- [ ] 1.2 Add a `writeAuditLog(actor, action, entityType, entityId, metadata)` helper (append-only; captures ip/userAgent; no secrets); verify it writes an entry and there is no edit/delete path.

## 2. Admin user management (vertical slice)

- [ ] 2.1 `AdminService` list/get users (paginated/searchable, secrets omitted); admin routes `GET /api/v1/admin/users`, `GET /:id` guarded by `auth("ADMIN","SUPER_ADMIN")`; verify a non-admin gets 403 and no hashes/tokens are returned.
- [ ] 2.2 Block/unblock: `PATCH /api/v1/admin/users/:id/status` sets `status`, writes an audit entry; verify a blocked user cannot log in and unblock restores access.

## 3. Role & premium administration (vertical slice)

- [ ] 3.1 `PATCH /api/v1/admin/users/:id/role` (SUPER_ADMIN only) + audit; verify an admin (non-super) gets 403 and a super-admin can change roles (with self-lockout guard).
- [ ] 3.2 `PATCH /api/v1/admin/users/:id/premium` grant/revoke (sets `isPremium`/`premiumSince` without a payment) + audit; verify premium toggles and an audit entry is written.

## 4. Audit wiring & viewer (vertical slice)

- [ ] 4.1 Wire `writeAuditLog` into sensitive actions across flows (disconnect #3, verified payment #8, catalogue changes #2/#10, plus the admin actions here); verify each action appends an entry.
- [ ] 4.2 `GET /api/v1/admin/audit-logs` list + filter (actor/action/entity) with pagination; verify filtering and that entries are immutable.

## 5. Integration & security

- [ ] 5.1 Confirm the two-tier gate (admin vs super-admin), append-only audit (no edit/delete), and no secret leakage in admin views/audit metadata.
- [ ] 5.2 Run `npm run check:fix` + `npx tsc --noEmit`; verify both pass; manual end-to-end (list → block → role change → comp premium → each writes audit → audit viewer filters).
