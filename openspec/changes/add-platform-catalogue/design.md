## Context

See `proposal.md` — Why. First change to add a table beyond auth/profile. Uses the incremental
schema approach (auth D5): this change materializes only `platforms` + `PlatformStatus`. Reuses
`cloudinary`/`multer` (logo) and admin-role guards. Source of truth: data-model §4.3.

## Goals / Non-Goals

**Goals:**
- A stable, admin-managed catalogue that connections (#3) and publishing (#5) can depend on.
- `key`-based dispatch so integrations are wired in code by a stable slug.

**Non-Goals:** per-user platform visibility (deferred, data-model #15); connect/publish logic
(those are #3/#5); frontend picker UI.

## Decisions

### D1: `key` is the immutable code contract; display fields are freely editable
`key` (unique, lowercase slug) maps to the registered integration; the backend switches on it.
`name`/`logo`/`status`/`sortOrder`/`isActive` are admin-editable freely. `key` is set at creation
and treated as effectively immutable (changing it would orphan the code mapping).
- **Why:** decouples admin-editable presentation from the code binding (data-model §4.3).

### D2: `status` LIVE vs COMING_SOON is presentation + a connect gate
COMING_SOON platforms appear in listings as teasers but are **not connectable**; the connect gate
is enforced in #3 (social-connections) by checking `status = LIVE`. This flow only stores/serves
the status.
- **Alternative:** a separate `isConnectable` flag. Rejected — `status` already carries it.

### D3: Retire via `isActive=false`, never hard-delete
Platforms are referenced by `social_connections` and `publications`; deleting one would dangle
those FKs. Deactivation hides it from the active list while preserving referential integrity.
- **Why:** data-model §4.3 ("never hard-deleted").

### D4: Logo via Cloudinary url+publicId, delete-old-on-replace
Same pattern as avatars (user-profile D1); stores `logoUrl`+`logoPublicId`, best-effort deletes
the previous asset.

### D5: Admin mutations, authenticated read
Create/update/logo/retire require `ADMIN`/`SUPER_ADMIN`. The active list requires only auth (any
user needs it for the picker). Admin routes under `/admin/platforms`, public under `/platforms`.

## Risks / Trade-offs

- **Wrong/duplicate `key` breaks code dispatch.** → Unique constraint + treat `key` as immutable;
  integrations register by known keys.
- **Orphaned logo asset on replace failure.** → Best-effort delete, logged; non-fatal.

## Migration Plan

1. Add `PlatformStatus` enum + `platforms` model (data-model §4.3); `prisma migrate dev` + generate.
2. Implement `src/app/module/platform/`; mount admin + public routes.
3. Seed the initial LIVE rows (`linkedin`, `facebook`) so #3 has targets; verify the active list.
