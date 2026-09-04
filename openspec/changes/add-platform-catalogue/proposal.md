## Why

Publishing targets (LinkedIn, Facebook Page, and future Instagram/X/…) must be **admin-managed
data, not hard-coded** (data-model §4.3, PRD §11 / §16.3), so new platforms, their logos, and
ordering can change without code, and so connections (#3) and publishing (#5) can reference a
stable catalogue. This flow owns the `platforms` table and is the prerequisite for both.

## What Changes

Admin manages the catalogue; users read the active list:

- **Admin — create:** `POST /api/v1/admin/platforms` (key, name, status, sortOrder, isActive).
- **Admin — list all** (incl. inactive): `GET /api/v1/admin/platforms`.
- **Admin — get one:** `GET /api/v1/admin/platforms/:id`.
- **Admin — update:** `PATCH /api/v1/admin/platforms/:id` (name, status, sortOrder, isActive).
- **Admin — upload/replace logo:** `PATCH /api/v1/admin/platforms/:id/logo` (multipart → Cloudinary;
  stores `logoUrl` + `logoPublicId`, deletes the old asset).
- **Admin — retire:** deactivate via `isActive=false` (no hard delete — downstream FKs stay valid).
- **User — active list:** `GET /api/v1/platforms` — active platforms ordered by `sortOrder`, for
  the connect/publish picker.

`key` is the stable slug the backend switches on (`linkedin`→`LinkedInPublisher`); `status`
`{ LIVE, COMING_SOON }` — LIVE = a real integration exists (connectable), COMING_SOON = visible
teaser only. Materializes the `platforms` table + `PlatformStatus` enum.

## Capabilities

### New Capabilities
- `platform-catalogue`: admin-managed catalogue of publishing platforms and the user-facing list of
  active platforms.

### Modified Capabilities
<!-- None. -->

## Impact

- **Data model:** adds the `platforms` table + `PlatformStatus` enum (migration). No changes to
  existing tables.
- **Module:** `src/app/module/platform/` (admin + public routes); mount at `/api/v1/admin/platforms`
  and `/api/v1/platforms`.
- **Libs:** `lib/cloudinary`+`lib/multer` (logo), `lib/prisma`, `middleware/checkAuth` (admin roles),
  `middleware/validateRequest`.
- **Security:** mutations restricted to `ADMIN`/`SUPER_ADMIN`; `key` unique; retire-not-delete keeps
  connection/publication FKs valid.
- **Downstream (synced):** #3 social-connections reads `platforms` (connect gated to `LIVE`); #5
  publishing references `platformId`.
