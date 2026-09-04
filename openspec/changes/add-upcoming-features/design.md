## Context

See `proposal.md` — Why. Materializes `upcoming_features` (data-model §4.10). Mirrors the
platform-catalogue admin pattern (#2). Premium gating uses the scaffolded `requirePremium` +
`isPremium` (written by #8).

## Goals / Non-Goals

**Goals:** a data-driven catalogue admins edit, browsable only by premium users.
**Non-Goals:** per-user personalization; delivering the features themselves (they're "coming soon").

## Decisions

### D1: Admin CRUD + premium read, split by route prefix
Management under `/admin/upcoming-features` (`ADMIN`/`SUPER_ADMIN`); browsing under
`/upcoming-features` (`auth` + `requirePremium`). Slug is unique and drives the detail route.

### D2: Hard delete is allowed (no downstream FKs)
Unlike platforms, features have no referencing tables, so `DELETE` removes the row. `status` and
`isPremiumVisible` still let admins stage/hide without deleting.

### D3: Image via Cloudinary url+publicId, delete-old-on-replace
Same pattern as avatars/logos/posts.

### D4: Backend-enforced premium gate
`requirePremium` reads the DB `isPremium` (never a client flag, §23/§32 R5). `isPremiumVisible` is
an admin lever to optionally expose a feature to non-premium users later; MVP gates the whole area.

## Risks / Trade-offs

- **Orphaned image on replace failure.** → Best-effort delete, logged.

## Migration Plan

1. Add `UpcomingFeatureStatus` enum + `upcoming_features` model (data-model §4.10); `prisma migrate
   dev --name upcoming-features` + generate.
2. Implement admin CRUD + image + premium read; mount both route groups.
3. Seed a few features (e.g., AI Content Enhancement) so the premium area is populated.
4. Manual verify: admin CRUD + image; premium user browses ordered list + detail; non-premium 403.
