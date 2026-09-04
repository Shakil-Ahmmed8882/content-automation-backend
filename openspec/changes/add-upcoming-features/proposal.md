## Why

Premium users get a curated, data-driven catalogue of planned capabilities (the Upcoming Features
area), and admins maintain it without code changes (PRD §16–§17; data-model §4.10). This flow owns
the `upcoming_features` table, its admin CRUD, and the premium-gated read access.

## What Changes

- **Admin — create:** `POST /api/v1/admin/upcoming-features` (slug, title, short/long description,
  status, sortOrder, isPremiumVisible).
- **Admin — list all / get / update / delete:** `GET`, `GET /:id`, `PATCH /:id`, `DELETE /:id`.
- **Admin — image:** `PATCH /api/v1/admin/upcoming-features/:id/image` (multipart → Cloudinary,
  `imageUrl` + `imagePublicId`, delete old on replace).
- **Premium — list:** `GET /api/v1/upcoming-features` — visible features ordered by sortOrder,
  **premium-only** (`auth` + `requirePremium`).
- **Premium — detail:** `GET /api/v1/upcoming-features/:slug` — one feature, premium-only.

Materializes `upcoming_features` + the `UpcomingFeatureStatus` enum. Premium gating is enforced at
the route using the existing `requirePremium` middleware and the `isPremium` flag written by #8.

## Capabilities

### New Capabilities
- `upcoming-features`: an admin-managed catalogue of planned premium features and the premium-only
  browsing of that catalogue.

### Modified Capabilities
<!-- None. Reads the `isPremium` flag (set by #8) for gating. -->

## Impact

- **Data model:** adds `upcoming_features` (data-model §4.10) + `UpcomingFeatureStatus` enum (migration).
- **Module:** `src/app/module/upcomingFeature/`; mount admin at `/api/v1/admin/upcoming-features`,
  premium at `/api/v1/upcoming-features`.
- **Libs:** `lib/cloudinary`+`lib/multer` (image), `lib/prisma`, `middleware/checkAuth`,
  `middleware/requirePremium` (already scaffolded), `middleware/validateRequest`.
- **Security (§16):** management is admin-only; browsing requires premium (backend-enforced, never
  from a client flag, §23).
- **Depends on (synced):** #8 (premium activation writes `isPremium`).
