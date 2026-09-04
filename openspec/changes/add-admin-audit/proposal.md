## Why

The platform needs administration and accountability: admins must manage and moderate users, and
sensitive actions must be recorded in an audit trail (assignment requirement; PRD §23; data-model
§4.11). This is the final, cross-cutting flow — it owns the `audit_logs` table and a reusable audit
mechanism that other flows' sensitive actions call into.

## What Changes

- **Admin — users:** `GET /api/v1/admin/users` (list, paginated/searchable), `GET /:id` (detail).
- **Admin — moderation:** `PATCH /api/v1/admin/users/:id/status` (block / unblock).
- **Super-admin — role:** `PATCH /api/v1/admin/users/:id/role` (change role; SUPER_ADMIN only).
- **Admin — comp premium:** `PATCH /api/v1/admin/users/:id/premium` (grant/revoke premium without a
  payment — the data-model #5 comp path).
- **Audit log:** an append-only `audit_logs` table + a reusable `writeAuditLog(actor, action,
  entity, metadata)` utility, **wired into sensitive actions across the app** (user block/unblock,
  role change, premium grant/revoke, connection disconnect, verified payment, platform/feature
  changes). `GET /api/v1/admin/audit-logs` lists/filters the trail.

Materializes `audit_logs` + `User.auditLogs[]`. Adding audit calls to existing flows is additive
(non-behavioral) — those flows' specs are unchanged; audit centralizes here.

## Capabilities

### New Capabilities
- `admin-audit`: administrative user management and moderation, plus an append-only audit log of
  sensitive actions and its admin viewer.

### Modified Capabilities
<!-- None (behaviorally). Adds audit-logging calls into existing flows without changing their behavior. -->

## Impact

- **Data model:** adds `audit_logs` (data-model §4.11) + `User.auditLogs[]` (migration). Reads/writes
  existing `users.status`/`role`/`isPremium`.
- **Module:** `src/app/module/admin/` (users + audit); a shared `utils/audit` (or `lib/audit`)
  writer; mount under `/api/v1/admin`.
- **Libs:** `lib/prisma`, `middleware/checkAuth` (admin / super-admin gates).
- **Cross-cutting:** audit calls added to #1/#2/#3/#8/#10 sensitive actions + the admin actions here.
- **Security (§23):** admin-only (role changes super-admin-only); audit is append-only (never edited
  or deleted); no secrets in audit metadata.
- **Depends on (synced):** all prior flows exist (their sensitive actions become audited); platform
  admin CRUD stays in #2 (not duplicated here).
