# E2E Verification Progress

Resumable tracker for end-to-end verification of every API across all 12 OpenSpec changes.
Each change maps to one E2E suite (`tests/e2e/<module>.e2e.test.ts`) that drives the real
`src/app.ts` in-process against **real Postgres (remote Prisma cloud) + local Redis**.

**How to resume after a restart:**
1. `npm run devredis:start` (background) and confirm Redis on :6379 is up. Postgres is remote (`.env` `DATABASE_URL`).
2. Find the first suite below still marked ⬜ or 🔄 and run it: `npx vitest run tests/e2e/<file>`.
3. Update its checkbox + the per-API notes here.

**Status legend:** ⬜ not started · 🔄 running/partial · ✅ pass · ❌ fail

_Last updated: 2026-09-11 — **ALL 12 SUITES PASS (134 tests). Verification COMPLETE.**_

---

## Suite-level checklist

| # | Change | Suite file | APIs | Status |
|---|--------|-----------|------|--------|
| 1 | add-credentials-auth | auth.e2e.test.ts | 8 | ✅ (17 tests) |
| 2 | add-user-profile | user-profile.e2e.test.ts | 6 | ✅ |
| 3 | add-platform-catalogue | platform-catalogue.e2e.test.ts | 6 | ✅ |
| 4 | add-social-connections | social-connections.e2e.test.ts | 6 | ✅ |
| 5 | add-content-posts | content-posts.e2e.test.ts | 4 | ✅ |
| 6 | add-publish-execution | publishing.e2e.test.ts | 1 | ✅ |
| 7 | add-publication-retry | publication-retry.e2e.test.ts | 2 | ✅ |
| 8 | add-execution-history | execution-history.e2e.test.ts | 2 | ✅ |
| 9 | add-premium-payment | premium-payment.e2e.test.ts | 3 | ✅ |
| 10 | add-payment-history | payment-history.e2e.test.ts | 2 | ✅ |
| 11 | add-upcoming-features | upcoming-features.e2e.test.ts | 8 | ✅ |
| 12 | add-admin-audit | admin-audit.e2e.test.ts | 6 | ✅ |

**Batch results:** auth=17 · (user-profile+platform+connections+posts)=65 · (publishing+retry+exec-history+premium)=36 · (payment-history+upcoming+admin)=16 → **134 passing, 0 failing.**

---

## Per-API detail (all verified ✅)

### 1. add-credentials-auth — `auth.e2e.test.ts` ✅
- ✅ POST `/api/v1/auth/register`
- ✅ POST `/api/v1/auth/verify-email`
- ✅ POST `/api/v1/auth/login`
- ✅ POST `/api/v1/auth/refresh-token`
- ✅ POST `/api/v1/auth/logout`
- ✅ GET `/api/v1/auth/me`
- ✅ POST `/api/v1/auth/forgot-password`
- ✅ POST `/api/v1/auth/reset-password`

### 2. add-user-profile — `user-profile.e2e.test.ts` ✅
- ✅ GET `/api/v1/users/me`
- ✅ PATCH `/api/v1/users/me`
- ✅ PATCH `/api/v1/users/me/avatar`
- ✅ DELETE `/api/v1/users/me/avatar`
- ✅ PATCH `/api/v1/users/me/password`
- ✅ DELETE `/api/v1/users/me`

### 3. add-platform-catalogue — `platform-catalogue.e2e.test.ts` ✅
- ✅ POST `/api/v1/admin/platforms`
- ✅ GET `/api/v1/admin/platforms`
- ✅ GET `/api/v1/admin/platforms/:id`
- ✅ PATCH `/api/v1/admin/platforms/:id`
- ✅ PATCH `/api/v1/admin/platforms/:id/logo`
- ✅ GET `/api/v1/platforms` (public/active)

### 4. add-social-connections — `social-connections.e2e.test.ts` ✅
- ✅ GET `/api/v1/connections`
- ✅ GET `/api/v1/connections/:platform/connect`
- ✅ GET `/api/v1/connections/:platform/callback`
- ✅ GET `/api/v1/connections/facebook/pages`
- ✅ POST `/api/v1/connections/facebook/select-page`
- ✅ DELETE `/api/v1/connections/:platform`

### 5. add-content-posts — `content-posts.e2e.test.ts` ✅
- ✅ POST `/api/v1/posts`
- ✅ GET `/api/v1/posts`
- ✅ GET `/api/v1/posts/:id`
- ✅ DELETE `/api/v1/posts/:id`

### 6. add-publish-execution — `publishing.e2e.test.ts` ✅
- ✅ POST `/api/v1/posts/:id/publish` (BullMQ background worker path)

### 7. add-publication-retry — `publication-retry.e2e.test.ts` ✅
- ✅ POST `/api/v1/publications/:id/retry`
- ✅ POST `/api/v1/executions/:id/retry`

### 8. add-execution-history — `execution-history.e2e.test.ts` ✅
- ✅ GET `/api/v1/executions`
- ✅ GET `/api/v1/executions/:id`

### 9. add-premium-payment — `premium-payment.e2e.test.ts` ✅
- ✅ POST `/api/v1/payments/create`
- ✅ GET `/api/v1/payments/callback`
- ✅ POST `/api/v1/payments/verify`

### 10. add-payment-history — `payment-history.e2e.test.ts` ✅
- ✅ GET `/api/v1/payments`
- ✅ GET `/api/v1/payments/:id`

### 11. add-upcoming-features — `upcoming-features.e2e.test.ts` ✅
- ✅ POST `/api/v1/admin/upcoming-features`
- ✅ GET `/api/v1/admin/upcoming-features`
- ✅ GET `/api/v1/admin/upcoming-features/:id`
- ✅ PATCH `/api/v1/admin/upcoming-features/:id`
- ✅ DELETE `/api/v1/admin/upcoming-features/:id`
- ✅ PATCH `/api/v1/admin/upcoming-features/:id/image`
- ✅ GET `/api/v1/upcoming-features` (premium)
- ✅ GET `/api/v1/upcoming-features/:slug` (premium)

### 12. add-admin-audit — `admin-audit.e2e.test.ts` ✅
- ✅ GET `/api/v1/admin/users`
- ✅ GET `/api/v1/admin/users/:id`
- ✅ PATCH `/api/v1/admin/users/:id/status`
- ✅ PATCH `/api/v1/admin/users/:id/role`
- ✅ PATCH `/api/v1/admin/users/:id/premium`
- ✅ GET `/api/v1/admin/audit-logs`
