## Context

See `proposal.md` — Why. Final, cross-cutting flow. Materializes `audit_logs` (data-model §4.11) and
adds a reusable audit writer used by sensitive actions across the app. Assumes all prior flows exist.

## Goals / Non-Goals

**Goals:** admin user management + moderation; a generic, append-only audit trail with an admin viewer.
**Non-Goals:** platform admin (owned by #2); a full RBAC/permissions system (roles stay fixed);
real-time audit streaming.

## Decisions

### D1: Generic append-only `audit_logs` + a `writeAuditLog` helper
One table keyed by `actorId`, `action`, `entityType`, `entityId`, `metadata` (JSON), plus ip/userAgent.
A shared helper writes entries; sensitive actions call it. No update/delete path exists.
- **Why:** data-model §4.11 — log anything without new tables; immutability = trustworthy trail.

### D2: Audit is wired centrally here, additively
This flow adds `writeAuditLog` calls into existing sensitive actions (block/unblock, role change,
premium grant/revoke, disconnect, verified payment, catalogue changes). These are additive and do
not change those flows' externally observable behavior, so their specs are untouched.
- **Alternative:** each flow logs its own audit from the start. Rejected per the user's ordering
  (Admin & Audit is the last flow); centralizing avoids scattering half-built audit code earlier.

### D3: Two-tier admin gate
Admin endpoints require `ADMIN`/`SUPER_ADMIN`; **role changes require `SUPER_ADMIN`** (an admin
cannot escalate roles). Enforced via `auth(...)` at the route.

### D4: Admin comp premium writes the flag directly
Grant/revoke sets `isPremium`/`premiumSince` without a payment (data-model #5 comp path), and writes
an audit entry. Reuses the same flag #8 sets.

### D5: Admin views omit secrets
User lists/detail and audit metadata never include password hashes, tokens, or gateway payloads.

## Risks / Trade-offs

- **Audit writes add latency/failure surface to sensitive actions.** → Write audit in the same
  transaction where correctness matters (e.g., block), else best-effort; never let an audit failure
  silently drop a security-relevant record — log loudly.
- **Admin acting on themselves (e.g., self-block).** → Guard obvious self-harm (a super-admin can't
  demote/last-block themselves into lockout); documented and enforced.

## Migration Plan

1. Add `audit_logs` model + `User.auditLogs[]` (data-model §4.11); `prisma migrate dev --name audit-logs` + generate.
2. Add the `writeAuditLog` helper; implement admin user management (list/detail/block/role/premium)
   + audit viewer; wire audit calls into the sensitive actions across flows.
3. Manual verify: block prevents login; role change is super-admin-only; comp premium works; each
   sensitive action appends an immutable audit entry; audit list filters; non-admin denied.
