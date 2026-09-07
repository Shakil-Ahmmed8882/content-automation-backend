# Manual Testing Guide (Postman)

A click-by-click walkthrough for manually testing every module implemented so far, using the
companion Postman collection at `docs/postman/content-automation.postman_collection.json`. Every
value one request needs from a previous one (OTP, user id, platform id, session cookies) is
captured **automatically** by that request's *Tests* script into a collection variable — you never
copy/paste anything by hand. Follow the numbered requests in order, in the numbered folders in
order, and you'll never hit a step that needs something you haven't got yet.

## Modules done so far (implemented + automated-tested from my end)

Of the 12 planned OpenSpec changes (`openspec/changes/`), these 5 are fully implemented with a
passing Vitest+Supertest E2E suite (`npm test` → 78 passed, 4 skipped pending real Cloudinary
credentials, 0 failed):

| # | Module (OpenSpec change) | Covers |
|---|---|---|
| 1 | `add-credentials-auth` | register → verify email (OTP) → login → session (`/me`, refresh) → logout → forgot/reset password |
| 2 | `add-user-profile` | get/update profile, avatar upload/replace/remove, change password, soft-delete account |
| 3 | `add-platform-catalogue` | admin CRUD + logo for the platform catalogue, public active-platforms list |
| 4 | `add-social-connections` | connect/callback (LinkedIn + Facebook OAuth), encrypted token storage, Facebook Page selection, list/disconnect connections |
| 5 | `add-content-posts` | create post (text + optional image), owner-scoped list (pagination/sort/search), get-by-id, soft-delete, immutability (no edit endpoint) |

The remaining 7 (`add-publish-execution`, `add-publication-retry`, `add-execution-history`,
`add-premium-payment`, `add-payment-history`, `add-upcoming-features`, `add-admin-audit`) aren't
built yet — this collection covers exactly the 5 above, nothing more.

> **Note on `add-social-connections` and manual testing:** the connection *storage/encryption/
> Page-selection* logic is fully covered by the automated suite, but a real end-to-end OAuth
> *connect* needs interactive browser consent against a real LinkedIn/Facebook app (this repo's
> `.env` has empty credentials). So the Postman folder for it (`05 - Social Connections`) verifies
> only the manually-checkable surface — endpoints exist, are session-guarded, gate on LIVE
> platforms, issue a state, reject a forged callback, enforce ownership — not a live connection.

## 0. Before you start

1. **Start Postgres + Redis** (not Windows services — start each session):
   ```
   npm run devdb:start
   npm run devredis:start
   ```
2. **Start the server:** `npm run dev` — leave it running. It seeds the `linkedin`/`facebook`
   platform rows on boot (`seedPlatforms()`), which you'll see in `04 - Platform Catalogue
   (Public)` below.
3. **Confirm `.env` has `EXPOSE_OTP_IN_RESPONSE=true`** (it already does in this repo). This is
   what lets the Register/Forgot-Password responses hand back the OTP directly instead of you
   having to read a real inbox — SMTP in `.env` is a placeholder (`your-email@gmail.com`), so no
   real email is actually sent; the app logs the send failure and moves on (by design).
4. **Import the collection:** Postman → **Import** → select
   `docs/postman/content-automation.postman_collection.json`.
5. **Check the variables:** open the collection → **Variables** tab. Defaults are already filled
   in (`base_url = http://localhost:5000/api/v1`, `test_email = postman.tester@example.com`,
   `test_password = TestPassword123!`, etc.) — you don't need to change anything for a first run.
   Leave the rest (`otp`, `user_id`, `platform_id`, …) blank; requests fill them in as you go.
6. **Cookies just work.** This API uses httpOnly session cookies (not bearer tokens in the body).
   Postman's built-in cookie jar stores whatever the server sets and resends it automatically on
   every later request to `localhost` — that's why you never see an `Authorization` header in this
   collection. If something 401s unexpectedly, check **Cookies** at the bottom of the response
   panel to see what's actually stored.

Run the folders in this exact order: **01 → 02 → 03 → 04 → 05 → 06 → (07 only when fully done)**.

---

## 01 - Auth

**Goal:** create a session. Everything after this folder depends on it.

### 1. Register
`POST /auth/register` with your `test_email`/`test_password`.
- **Expected:** `200`. No user is created in the database yet — just an OTP stashed in Redis.
- The Tests script reads `data.otp` from the response and saves it into the `otp` variable.
- **Fork — if you get `409` instead:** `test_email` already has a *verified* account (e.g. you ran
  this collection before). Open the **Postman Console** (`View → Show Postman Console`) — the
  Tests script prints what to do: **skip step 2** and run **step 4 (Login)** instead, then
  continue from step 3 (Get Me).

### 2. Verify Email
`POST /auth/verify-email` with `test_email` + the `otp` variable (already filled in for you).
- **Expected:** `201`. This is the request that actually creates the `users` row, logs you in, and
  sets the `accessToken`/`refreshToken` cookies — check the response's **Cookies** tab if you want
  to see them; you never need to touch them again.
- The Tests script saves `data.id` into `user_id`.
- **Fork — `400 "expired"`:** the OTP is more than 5 minutes old. Go back and re-run step 1 to get
  a fresh one, then retry this step immediately.

### 3. Get Me
`GET /auth/me` — no body needed.
- **Expected:** `200` with your profile. This just proves the session from step 2 works before you
  move on to other modules.
- **Fork — `401`:** the cookies weren't sent. Check Postman's cookie jar (Cookies icon near the
  request URL bar, or the response panel's Cookies tab) has entries under `localhost`. If it's
  empty, re-run step 2.

### 4. (Optional) Login
Only needed if step 1 gave you a `409` and you skipped step 2. Otherwise skip this — you're
already logged in from step 2. Safe to run any time regardless; it just re-issues the same cookies.

### 5. (Optional) Refresh Token
Demonstrates session rotation using the refresh cookie. Safe to run any time — doesn't affect
anything else in this walkthrough.

### 6. (Optional) Forgot Password
`POST /auth/forgot-password` with `test_email`.
- **Expected:** `200` with the same generic message every time (by design — the API never reveals
  whether an email exists). The Tests script captures `data.otp` into `reset_otp`.
- Doesn't touch your session. Only run this if you want to also exercise step 7.

### 7. (Optional) Reset Password
`POST /auth/reset-password` with `test_email` + `reset_otp` (from step 6) + `new_password`.
- **Must run step 6 immediately before this** — the code expires in 5 minutes.
- **Expected:** `200`. Your session stays logged in (this doesn't clear cookies). The Tests script
  updates the `test_password` variable to match, so anything later that logs in again (or Change
  Password in the next folder) keeps working without you touching a variable by hand.

**✅ Checkpoint:** you have an active session and `user_id` is filled in. Move to `02`.

---

## 02 - User Profile

**Requires:** an active session (folder `01`, steps 1–3 done).

### 1. Get My Profile
`GET /users/me`. **Expected:** `200` — includes `isPremium: false`, `providers: ["CREDENTIALS"]`,
never a password or token field.

### 2. Update My Profile
`PATCH /users/me` with a new `name`. **Expected:** `200`, `data.name` reflects the change. If you
add an `email` field to the body, it's silently ignored (by design — email isn't editable here).

### 3. (Optional, needs Cloudinary) Upload Avatar
`PATCH /users/me/avatar`, multipart body.
- **You must manually attach a file:** open the request's **Body** tab, click the `avatar` row's
  **Select Files**, and pick any small PNG/JPG from your computer. Postman can't ship a file
  inside an importable collection (security), so this one manual click is unavoidable.
- **This repo's `.env` has empty `CLOUDINARY_*` values** — no real account configured yet. Without
  real credentials, **this request will fail** (Cloudinary itself rejects the fake key, surfacing
  as a `500`). That's expected, documented behavior (`docs/decisions.md`), not a bug. **Skip this
  request** unless you've put real Cloudinary credentials in `.env` and restarted `npm run dev`.

### 4. Remove Avatar
`DELETE /users/me/avatar`. **Expected:** `200`, `avatarUrl`/`avatarPublicId` are `null`. Safe to
run even if you skipped step 3 — there's simply nothing to delete, and the assertion still holds.

### 5. Change Password
`PATCH /users/me/password` with `currentPassword: test_password`, `newPassword: new_password`.
- **Expected:** `200`. The Tests script updates `test_password` to match afterward, so this stays
  correct whether or not you ran the optional Reset Password in folder `01`.

**✅ Checkpoint:** move to `03`. **Do not** run folder `07` (Cleanup) yet.

---

## 03 - Platform Catalogue (Admin)

**⚠️ Setup required first — read this before running anything in this folder.**

There's no admin-signup API yet (that's a later module, `add-admin-audit`). To test admin routes,
promote your *already-logged-in* test user to `ADMIN` directly in the database:

1. Keep `npm run dev` running (a separate terminal is fine).
2. In a terminal, from the `content-automation-backend` folder, run:
   ```
   npm run admin:promote -- postman.tester@example.com
   ```
   (replace the email with whatever your `test_email` variable currently holds, if you changed it)
3. You should see: `Promoted postman.tester@example.com to ADMIN.`
4. **You do not need to log in again.** `checkAuth` re-reads the role from Postgres on *every*
   request, not from a cached token — so your existing session cookies from folder `01` are
   immediately treated as admin.

If you skip this and run step 1 below anyway, you'll get a `403` — the Tests script will remind
you in the Postman Console.

### 1. Create Platform
`POST /admin/platforms`.
- The `key` field uses Postman's built-in `{{$timestamp}}` variable, so it's unique every single
  time you run this request — **you can re-run this one as many times as you like** without ever
  hitting a duplicate-key `409`, unlike Register.
- **Expected:** `201`. The Tests script captures `data.id` into `platform_id` — every request below
  in this folder targets that same platform.
- **Fork — `403`:** you haven't run the `npm run admin:promote` command above (or ran it for a
  different email than your actual `test_email`). Do that, then retry — no need to re-login.

### 2. List All Platforms
`GET /admin/platforms`. **Expected:** `200`, an array that includes the platform you just created
*and* the two seeded rows (`linkedin`, `facebook`) — this admin endpoint returns inactive rows too
(unlike the public list in folder `04`).

### 3. Get Platform By Id
`GET /admin/platforms/{{platform_id}}`. **Expected:** `200`, matching what you created in step 1.

### 4. Update Platform
`PATCH /admin/platforms/{{platform_id}}` with a new `name` and `sortOrder`. **Expected:** `200`,
both fields reflect the change. `key` is deliberately not editable (immutable by design — it's
what the backend code switches on).

### 5. (Optional, needs Cloudinary) Set Platform Logo
Same deal as the avatar upload in folder `02`: manually attach a file in the `logo` row's **Select
Files**, and expect a `500` unless you've configured real `CLOUDINARY_*` values in `.env`. Skip
unless you've set those up.

### 6. Retire Platform
`PATCH /admin/platforms/{{platform_id}}` with `isActive: false`. **Expected:** `200`,
`data.isActive` is now `false`. The row is **not deleted** — re-run step 2 to confirm it's still in
the full list — it just becomes invisible to the public list, which is exactly what folder `04`
below proves.

**✅ Checkpoint:** move to `04`. Still don't run folder `07` (Cleanup) yet.

---

## 04 - Platform Catalogue (Public)

**Requires:** only a logged-in session (any role) — folder `01` is enough, admin isn't needed here.

### 1. List Active Platforms
`GET /platforms`. **Expected:** `200`, an array of only *active* platforms ordered by
`sortOrder` — you should see the seeded `linkedin`/`facebook`, but **not** the platform you retired
in the previous folder's step 6. This is the scenario that proves retiring actually hides a
platform while keeping its row.

**✅ Checkpoint:** move to `05`.

---

## 05 - Social Connections

**Requires:** an active session (folder `01`). **Read the limitation first:** a real connection
needs interactive OAuth consent in a browser against a real LinkedIn/Facebook app, and this repo's
`.env` has empty provider credentials — so you **cannot** complete a live connection here. This
folder verifies the module's manually-checkable surface; the encryption/storage/Page-selection
behavior is proven by the automated suite (`tests/e2e/social-connections.e2e.test.ts`, 23 tests).

### 1. List My Connections
`GET /connections`. **Expected:** `200` with an empty array on a fresh account. Tokens are never
included in this response by design.

### 2. Start LinkedIn Connect (LIVE platform)
`GET /connections/linkedin/connect`. **Expected:** `200` with `data.authUrl` — the LinkedIn OAuth
URL, carrying a `state=` token this server just issued into Redis. `linkedin` is a LIVE seeded
platform, so connect is allowed. Opening that URL to actually connect needs real `LINKEDIN_*`
credentials in `.env`; this step only proves the endpoint issues a valid URL + state.

### 3. Start Connect on a non-LIVE / unknown platform (refused)
`GET /connections/some-unknown-platform/connect`. **Expected:** `404` (no such platform). To see
the "not LIVE" `400` path: create a `COMING_SOON` platform in folder `03` (Create Platform with
`"status": "COMING_SOON"`), then hit `/connections/<that key>/connect` — `400`, because only LIVE
platforms are connectable.

### 4. Forged Callback is rejected (CSRF)
`GET /connections/linkedin/callback?code=fake-code&state=bogus-state`. **Expected:** `400` — the
callback validates the single-use `state` against Redis and refuses one it never issued, storing
nothing. A real provider redirect carries the state minted in step 2.

### 5. Disconnect (not connected → 404)
`DELETE /connections/linkedin`. **Expected:** `404` — you have no LinkedIn connection to remove.
Once a real connection exists, this hard-deletes it (physically removing the encrypted tokens) and
returns `200`.

**✅ Checkpoint:** move to `06`.

---

## 06 - Content Posts

**Requires:** an active session (folder `01`). This is the content CRUD from the `add-content-posts`
change — the flow you asked to verify. Run steps **1 → 10 in order**; the post you create in step 1
is captured into `post_id` and reused by every step after it.

**What's checkable by hand here:** create (text-only), list + pagination meta, search, get-by-id,
empty-content rejection, the no-edit-endpoint immutability rule, soft-delete, and gone-after-delete.
The live **image upload** (step 3) needs real `CLOUDINARY_*` creds (empty in this repo) and will
`500` without them — optional, same caveat as avatars/logos. **Cross-user isolation** (one user can't
read or delete another's posts) needs two accounts, so it isn't in this single-session folder — it's
proven by the automated suite (`tests/e2e/content-posts.e2e.test.ts`).

### 1. Create Post (text only)
`POST /posts` with a JSON body (`title` optional, `content` required). The endpoint accepts JSON or
multipart — you only need multipart when attaching an image.
- **Expected:** `201`. `data.imageUrl`/`data.imagePublicId` are `null`, `data.isDeleted` is `false`.
- The Tests script saves `data.id` into `post_id` for every step below.

### 2. Create Another Post (feeds list + search)
`POST /posts` with content containing "unicorns". **Expected:** `201`. Gives steps 4–5 something to
find — a second post, plus a deterministic search hit.

### 3. (Optional, needs Cloudinary) Create Post With Image
`POST /posts`, multipart. **Manually attach** a small PNG/JPG via the `image` row's **Select Files**.
- **Expected without creds:** `500` — this repo's `.env` has empty `CLOUDINARY_*`, so the upload fails
  at Cloudinary (exactly like the avatar/logo uploads). Expected, not a bug — **skip unless** you've
  put real credentials in `.env` and restarted `npm run dev`. Steps 1–2 already prove creation works.

### 4. List My Posts (pagination + meta)
`GET /posts?page=1&limit=10`. **Expected:** `200` with `data` (an array) and `meta` =
`{ page, limit, total, totalPages }`; `total` is at least 2 after steps 1–2. Only **your** posts
appear. Add `&sort=title` or `&sort=-createdAt` to exercise sorting (`-` prefix = descending).

### 5. Search My Posts
`GET /posts?search=unicorn`. **Expected:** `200`, returning at least the "unicorns are magical…" post
from step 2. Search is case-insensitive over content + title and shares the same pagination `meta`.

### 6. Get Post By Id
`GET /posts/{{post_id}}`. **Expected:** `200`, `data.id` equals `post_id`. A post id you don't own
returns `404` and reveals nothing — that owner-scoping is asserted by the automated suite.

### 7. Validation — Empty / Whitespace Content Rejected
`POST /posts` with `content: "   "`. **Expected:** `400`, and no post is created. Whitespace-only
content trims to empty and is rejected before anything is stored.

### 8. Immutability — No Edit Endpoint
`PATCH /posts/{{post_id}}`. **Expected:** `404` — posts are immutable by design (there is no PATCH or
PUT route), so publishing history stays faithful to exactly what was posted. `PUT` gives the same
`404`.

### 9. Delete Post (soft delete)
`DELETE /posts/{{post_id}}`. **Expected:** `200`. The post is marked deleted and leaves your list, but
the row is **retained** so publishing history referencing it stays readable. You can only delete your
own post (deleting another user's → `404`).

### 10. Confirm Soft-Delete — Now 404 & Gone From List
`GET /posts/{{post_id}}`. **Expected:** `404`. Re-run step 4 and you'll see the total dropped by one
and this post gone from the array — while the underlying row still exists in Postgres (soft delete),
a fact the automated suite asserts directly.

**✅ Checkpoint:** the whole content-posts flow is verified. Move to `07` only when you're completely done.

---

## 07 - Cleanup (optional — run at most ONE, LAST, if at all)

**⚠️ These are two ALTERNATIVE endings, not a sequence — run at most one.** Most of the time you'll
run neither and just leave your test data in place for next time.

### 1. Delete My Account
Soft-deletes your test user and clears the session cookies as a side effect (no separate Logout
needed after this). `test_email` can never `Register` fresh again after this (the row still
exists, just soft-deleted). If you want to run this whole walkthrough again from scratch, pick a
new `test_email` first (collection **Variables** tab).

### 2. Logout
Only run this if you did **not** run step 1 — ends the session but keeps the user/account intact
for a future run. If you run this instead of Delete, re-run `01` step 4 (Login) to keep testing
afterward.

**Order matters here on purpose:** Delete My Account is listed first because it still needs an
active session to authenticate the delete; Logout would clear that session first and make Delete
fail with `401` if run beforehand. Pick one, don't run both.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401` on almost everything | No session cookie sent | Re-run `01` steps 1–2 (or step 4 if already verified). Check the response's Cookies tab. |
| `403` on `03 - Platform Catalogue (Admin)` requests | Test user isn't `ADMIN` yet | Run `npm run admin:promote -- <test_email>` (no re-login needed). |
| `409` on Register | `test_email` already has a verified account | Either run Login instead (see folder `01` step 1's note), or pick a new `test_email` in Variables. |
| `400 "expired"` on Verify Email / Reset Password | OTP is >5 minutes old | Re-run the request that generates it (Register / Forgot Password), then retry immediately. |
| `500` on avatar / logo / post-image upload | `CLOUDINARY_*` in `.env` is empty (placeholder) | Expected without real credentials — skip that request, or configure a real Cloudinary account and restart `npm run dev`. |
| Want to run the whole collection again from scratch | Users/platforms from the last run still exist | Change `test_email` (and re-run `admin:promote` with the new value) — `Create Platform`'s `{{$timestamp}}` key never needs changing. |

## Reference — every endpoint in this collection

| Method | Path | Auth | Module |
|---|---|---|---|
| POST | `/api/v1/auth/register` | none | Auth |
| POST | `/api/v1/auth/verify-email` | none | Auth |
| POST | `/api/v1/auth/login` | none | Auth |
| POST | `/api/v1/auth/refresh-token` | refresh cookie | Auth |
| POST | `/api/v1/auth/logout` | none | Auth |
| GET | `/api/v1/auth/me` | session | Auth |
| POST | `/api/v1/auth/forgot-password` | none | Auth |
| POST | `/api/v1/auth/reset-password` | none | Auth |
| GET | `/api/v1/users/me` | session | User Profile |
| PATCH | `/api/v1/users/me` | session | User Profile |
| PATCH | `/api/v1/users/me/avatar` | session | User Profile |
| DELETE | `/api/v1/users/me/avatar` | session | User Profile |
| PATCH | `/api/v1/users/me/password` | session | User Profile |
| DELETE | `/api/v1/users/me` | session | User Profile |
| POST | `/api/v1/admin/platforms` | ADMIN/SUPER_ADMIN | Platform Catalogue |
| GET | `/api/v1/admin/platforms` | ADMIN/SUPER_ADMIN | Platform Catalogue |
| GET | `/api/v1/admin/platforms/:id` | ADMIN/SUPER_ADMIN | Platform Catalogue |
| PATCH | `/api/v1/admin/platforms/:id` | ADMIN/SUPER_ADMIN | Platform Catalogue |
| PATCH | `/api/v1/admin/platforms/:id/logo` | ADMIN/SUPER_ADMIN | Platform Catalogue |
| GET | `/api/v1/platforms` | session | Platform Catalogue |
| GET | `/api/v1/connections` | session | Social Connections |
| GET | `/api/v1/connections/:platform/connect` | session | Social Connections |
| GET | `/api/v1/connections/:platform/callback` | state (OAuth) | Social Connections |
| GET | `/api/v1/connections/facebook/pages` | session | Social Connections |
| POST | `/api/v1/connections/facebook/select-page` | session | Social Connections |
| DELETE | `/api/v1/connections/:platform` | session | Social Connections |
| POST | `/api/v1/posts` | session | Content Posts |
| GET | `/api/v1/posts` | session | Content Posts |
| GET | `/api/v1/posts/:id` | session | Content Posts |
| DELETE | `/api/v1/posts/:id` | session | Content Posts |
