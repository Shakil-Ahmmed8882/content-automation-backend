# Manual Testing Guide (Postman)

A click-by-click walkthrough for manually testing every module implemented so far, using the
companion Postman collection at `docs/postman/content-automation.postman_collection.json`. Every
value one request needs from a previous one (OTP, user id, platform id, session cookies) is
captured **automatically** by that request's *Tests* script into a collection variable — you never
copy/paste anything by hand. Follow the numbered requests in order, in the numbered folders in
order, and you'll never hit a step that needs something you haven't got yet.

## Modules done so far (implemented + automated-tested from my end)

**All 12 planned OpenSpec changes (`openspec/changes/`) are implemented** and each has a passing
Vitest+Supertest E2E suite (`npm test` → 134 passing across 12 suites, 0 failing — see
`docs/e2e-verification-progress.md`). This collection now covers **every one of them** (folders
01–13):

| # | Module (OpenSpec change) | Postman folder | Covers |
|---|---|---|---|
| 1 | `add-credentials-auth` | 01 | register → verify email (OTP) → login → session (`/me`, refresh) → logout → forgot/reset password |
| 2 | `add-user-profile` | 02 | get/update profile, avatar upload/replace/remove, change password, soft-delete account |
| 3 | `add-platform-catalogue` | 03, 04 | admin CRUD + logo for the platform catalogue, public active-platforms list |
| 4 | `add-social-connections` | 05 | connect/callback (LinkedIn + Facebook OAuth), encrypted token storage, Facebook Page selection, list/disconnect |
| 5 | `add-content-posts` | 06 | create post (text + optional image), owner-scoped list (pagination/sort/search), get-by-id, soft-delete |
| 6 | `add-publish-execution` | 07 | trigger a background publish, list execution history, per-platform execution detail |
| 7 | `add-publication-retry` | 08 | retry one failed publication, retry a whole failed execution |
| 8 | `add-execution-history` | 07 | owner-scoped executions list + detail (same reads as folder 07) |
| 9 | `add-premium-payment` | 09 | bKash sandbox: create payment → gateway URL → verify → premium flip |
| 10 | `add-payment-history` | 10 | owner-scoped payment history list + status by id |
| 11 | `add-upcoming-features` | 11, 12 | admin CRUD + image for the premium catalogue; premium-user list/detail |
| 12 | `add-admin-audit` | 13 | admin user list/get, block/unblock, role change, grant premium, append-only audit log |

> **What "verified" does and doesn't mean for the network-dependent bits.** The automated suite and
> the manually-checkable surface cover the whole platform, but three flows touch outside services
> that a Postman click alone can't fully drive:
> - **Real social posting (folder 07)** — publishing enqueues a background job that calls the real
>   LinkedIn/Facebook API. That only succeeds if you completed a real OAuth connect (folder 05) with
>   real app credentials. Without a live connection the publish is refused (400); with a *seeded but
>   fake* connection the execution runs and then moves to **FAILED** — which is still a valid thing
>   to observe (the execution/publication/attempt rows and statuses all update correctly).
> - **bKash payment (folder 09)** — needs real `BKASH_*` sandbox credentials in `.env` to get a
>   gateway URL. Backend is authoritative: premium only flips after the gateway confirms success.
> - **Cloudinary image uploads** (avatar, platform logo, post image, feature image) — real Cloudinary
>   credentials are configured (see `docs/credentials-setup-log.md`); these requests are marked
>   *(Optional — attach a file)* since attaching one is a manual click Postman can't script.

> **Note on `add-social-connections` and manual testing:** real LinkedIn OAuth credentials are
> configured (see `docs/credentials-setup-log.md`) and verified end-to-end — opening the authUrl
> from folder `05` request 2 in a real browser and clicking Allow genuinely connects your account.
> Facebook credentials are configured too, but the app's Page permissions (`pages_manage_posts`,
> `pages_read_engagement`) are still being finished on Facebook's side, so its consent screen
> currently errors until that's resolved. Either way, the connection *storage/encryption/
> Page-selection* logic is also fully covered by the automated suite
> (`tests/e2e/social-connections.e2e.test.ts`).

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
   having to read a real inbox. Real Gmail SMTP credentials are configured now too, so real emails
   do go out (subject to Gmail's own daily send quota) — but you never need to check an inbox to
   proceed through this guide either way, since the OTP is always in the response.
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

7. **Becoming an admin (needed for folders 03, 11, 13).** There's no admin-signup endpoint — admin
   is granted directly in the DB. Register + verify a user through folder 01, then in a terminal:
   ```
   npm run admin:promote -- postman.tester@example.com
   ```
   That makes your test user an `ADMIN`. Log in again (folder 01 req 4) so the new role is baked
   into a fresh session cookie. For the **SUPER_ADMIN-only** role-change (folder 13 req 4), promote
   the row to `SUPER_ADMIN` the same way (edit the script arg or set it in the DB).
8. **Becoming premium (needed for folder 12).** Either complete a bKash sandbox payment (folder 09)
   **or** — much simpler for testing — have an admin grant it: folder 13 req 5 with
   `{ "isPremium": true }` pointed at your own `target_user_id`.

### The flow in one picture (why order matters)

Every request either **produces** an id/cookie a later one **consumes**. You never copy anything by
hand — each request's *Tests* script stashes what it produced into a collection variable:

```
01 Register ─(otp)→ Verify Email ─(sets session cookie + user_id)→ everything below is authenticated
   └ (or) Login  ─ email+password → session cookie (httpOnly; Postman resends it automatically)
06 Create Post ─(post_id)→ 07 Publish ─(execution_id)→ 07 Get Detail ─(publication_id)→ 08 Retry
03 Create Platform ─(platform_id, platform_key)→ 05 Connect / 07 Publish target
11 Create Feature ─(feature_id, feature_slug)→ 12 Premium list/detail
13 List Users ─(target_user_id)→ block / role / premium → 13 Audit Log shows those actions
09 Create Payment ─(payment_id)→ 09 Verify → premium flips
```

**About "the access token".** Unlike a typical Bearer-token API, logging in here does **not** return
a token in the JSON body for you to paste into an `Authorization` header. Instead the server sets an
**httpOnly cookie** (`accessToken` + `refreshToken`). Postman's cookie jar keeps it and attaches it
to every following request automatically — so after Verify Email (or Login) you're simply "logged
in" for the rest of the run. That's the whole auth story; there's nothing to copy.

Run the folders roughly in order: **01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13**,
then **14 (Cleanup) only when fully done**. Folders 08/09/12 depend on state from 07/09/13
respectively (noted in each).

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

### 3. (Optional — attach a file) Upload Avatar
`PATCH /users/me/avatar`, multipart body.
- **You must manually attach a file:** open the request's **Body** tab, click the `avatar` row's
  **Select Files**, and pick any small PNG/JPG from your computer. Postman can't ship a file
  inside an importable collection (security), so this one manual click is unavoidable.
- **Real Cloudinary credentials are configured for this project** (see
  `docs/credentials-setup-log.md`) — this stores the image for real. Expected: `200`,
  `data.avatarUrl`/`data.avatarPublicId` set to a real Cloudinary URL/id.

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

### 5. (Optional — attach a file) Set Platform Logo
Same deal as the avatar upload in folder `02`: manually attach a file in the `logo` row's **Select
Files**. Real Cloudinary credentials are configured — expected: `200`, `data.logoUrl`/
`data.logoPublicId` set; replacing an existing logo deletes the previous asset (best-effort).

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

**Requires:** an active session (folder `01`). Real LinkedIn OAuth credentials are configured and
verified end-to-end (see `docs/credentials-setup-log.md`) — step 2 below produces a URL you can
actually open in a browser and connect for real. Facebook credentials are configured too, but the
app's Page permissions are still being finished on Facebook's side (step 6), so its consent screen
currently errors. The encryption/storage/Page-selection behavior is also proven by the automated
suite (`tests/e2e/social-connections.e2e.test.ts`, 23 tests) regardless.

### 1. List My Connections
`GET /connections`. **Expected:** `200` with an empty array on a fresh account. Tokens are never
included in this response by design.

### 2. Start LinkedIn Connect (LIVE platform)
`GET /connections/linkedin/connect`. **Expected:** `200` with `data.authUrl` — the LinkedIn OAuth
URL, carrying a `state=` token this server just issued into Redis. `linkedin` is a LIVE seeded
platform, so connect is allowed. Open `data.authUrl` in a real browser (logged into LinkedIn) and
click **Allow** to genuinely connect your account — real `LINKEDIN_*` credentials are configured.
After the redirect back to `localhost`, re-run step 1 and you'll see a real connection row.

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

### 6. Start Facebook Connect (LIVE platform)
`GET /connections/facebook/connect`. **Expected:** `200` with `data.authUrl` — the Facebook OAuth
dialog URL. `facebook` is a LIVE seeded platform, so connect is allowed. Real `FACEBOOK_APP_ID`/
`FACEBOOK_APP_SECRET` are configured, but the app's `pages_manage_posts`/`pages_read_engagement`
permissions are still being finished on Facebook's side — opening this URL currently shows
Facebook's "Invalid Scopes" developer-only error instead of a real consent screen. Once resolved,
opening it in a browser (logged into an account that administers a Facebook Page) shows a
Page-picker if you administer more than one Page, or auto-selects if you only have one — that
flow continues through `GET /connections/facebook/pages` and `POST /connections/facebook/select-page`
(only meaningful mid-flow after a real browser redirect, not standalone requests here).

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

### 3. (Optional — attach a file) Create Post With Image
`POST /posts`, multipart. **Manually attach** a small PNG/JPG via the `image` row's **Select Files**.
- Real Cloudinary credentials are configured — attaching a file stores it for real. Expected: `201`
  with `data.imageUrl`/`data.imagePublicId` set (or both `null` if you skip attaching a file —
  steps 1–2 already prove creation works either way).

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

## 07 - Publishing & Execution

**Goal:** turn a saved post into a real publish job and watch its result cascade.
**Needs:** a `post_id` (folder 06) and a `platform_key` (folder 03/04). For a *successful* post you
also need a live connection (folder 05); without one, publishing is refused (400).

### 1. Publish a Post
Sends `{ "platforms": ["{{platform_key}}"] }` to `/posts/{{post_id}}/publish`. This creates the
execution + publication rows synchronously, enqueues a BullMQ job, and returns **202** immediately
with `data.executionId` (saved to `execution_id`) and `data.status = PENDING` — the HTTP request
comes back before the actual social API call runs (so a browser could close). Real posting happens
in the background worker.

- **With a real connection:** the worker calls LinkedIn/Facebook; status ends SUCCESS.
- **With a seeded/fake connection or expired token:** the worker's provider call fails; status ends
  **FAILED** with a sanitized reason (the access token is never leaked into it). Both are valid to
  observe — the point is the row/status machinery works.
- **With no connection for that platform:** you get **400** here, before anything is enqueued.

### 2. List My Executions
`GET /executions?page=1&limit=10` — your publish history, newest first, with `meta` pagination. Add
`?status=PENDING|RUNNING|COMPLETED|PARTIALLY_COMPLETED|FAILED` (the overall execution status —
each platform's own result inside one execution is SUCCESS/FAILED, see the detail request below)
or `?dateFrom=&dateTo=` to filter.

### 3. Get Execution Detail
`GET /executions/{{execution_id}}` — the published content plus each platform's `status`,
`externalPostUrl` on success, latest failure reason, and a `retryable` flag. The Tests script grabs
the first FAILED (or first) publication's id into `publication_id` for folder 08.

**✅ Checkpoint:** a 202 on publish, the execution shows up in the list, and detail shows one row per
selected platform with a sensible status.

---

## 08 - Retry a Failed Publish

**Goal:** re-run failed work. **Needs:** an execution with at least one FAILED publication (from
folder 07). If everything succeeded, these correctly return 400 — nothing to retry.

### 1. Retry One Publication
`POST /publications/{{publication_id}}/retry` → **202**. The worker appends a new attempt (#N) and
recomputes the parent execution's status. Retrying a non-failed publication is rejected.

### 2. Retry Whole Execution
`POST /executions/{{execution_id}}/retry` → **202**. Retries *all* failed publications in the
execution at once; **400** if there are none.

**✅ Checkpoint:** a 202, and re-fetching the execution detail (folder 07 req 3) shows a new attempt.

---

## 09 - Premium Payment (bKash sandbox)

**Goal:** buy premium with test money. **Needs:** real `BKASH_*` **sandbox** credentials in `.env`
(without them, req 1 returns a gateway error — that's expected, and you can still test the
premium *features* by granting premium via admin, folder 13 req 5).

### 1. Create Payment
`POST /payments/create` (no body — amount/currency come from server config). Returns **201** with
`data.paymentId` (your **local** payment row id — the only id you ever need; the bKash gateway's
own session id is stored server-side and never returned to the client) and `data.redirectUrl`
(open it in a browser to complete the sandbox payment). `payment_id` is captured automatically.

### 2. Verify Payment
`POST /payments/verify` with `{ "paymentId": "{{payment_id}}" }` — nothing to paste, it reuses the
id captured in step 1. This is the authoritative, idempotent check — premium (`user.isPremium`)
only flips **after** the gateway itself confirms the payment completed. Expected **200**.

> The browser-redirect callback `GET /payments/callback` is called by **bKash**, not you — it
> redirects to the frontend success/failure page, so there's no Postman request for it.

### 3. Get One Payment Status
`GET /payments/{{payment_id}}` → **200**, `data.status` goes PENDING → SUCCESS once verified (or
FAILED / CANCELLED on a failed/cancelled sandbox payment).

**✅ Checkpoint:** with sandbox creds, you can create → open URL → pay → verify → see SUCCESS and
`isPremium` true (check `GET /users/me`).

---

## 10 - Payment History

**Goal:** read back what you paid. **Needs:** at least one payment from folder 09 (optional).

### 1. List My Payments
`GET /payments?page=1&limit=10` — owner-scoped, newest first, `meta` pagination. Filter with
`?status=PENDING|SUCCESS|FAILED|CANCELLED`. Expected **200**.

### 2. Get Payment By Id
`GET /payments/{{payment_id}}` — one payment's status; **404** if the id isn't yours (ownership is
enforced).

---

## 11 - Upcoming Features (Admin)

**Goal:** manage the premium "what's coming" catalogue. **Needs:** an **ADMIN** session (see
"Becoming an admin" in section 0). A non-admin gets **403** on every request here.

### 1. Create Upcoming Feature
`POST /admin/upcoming-features`. `slug` must be a lowercase slug (`[a-z0-9-]`); `status` is one of
the `UpcomingFeatureStatus` enum: `COMING_SOON`, `IN_DEVELOPMENT`, or `PLANNED`. Saves `feature_id` and
`feature_slug`. Expected **201**.

### 2–3. List All / Get By Id
`GET /admin/upcoming-features` (admin view — includes non-visible rows) and
`GET /admin/upcoming-features/{{feature_id}}`. Both **200**.

### 4. Update Feature
`PATCH /admin/upcoming-features/{{feature_id}}` — partial update (e.g. bump `status`). **200**.

### 5. (Optional — attach a file) Set Feature Image
`PATCH /admin/upcoming-features/{{feature_id}}/image` — multipart `image` file field. Real
Cloudinary credentials are configured — expected: `200` with `data.imageUrl`/`data.imagePublicId` set.

### 6. Delete Feature
`DELETE /admin/upcoming-features/{{feature_id}}` — hard delete (admin catalogue, not soft-deleted).
Run last. **200**.

---

## 12 - Upcoming Features (Premium user)

**Goal:** see the same catalogue as a paying user. **Needs:** `isPremium = true` on your account
(folder 09 payment, or admin grant folder 13 req 5). A non-premium session gets **403**.

### 1. List Visible Features
`GET /upcoming-features` — premium-visible rows only. **200** as premium, **403** otherwise.

### 2. Get Feature By Slug
`GET /upcoming-features/{{feature_slug}}` — **200** (premium) / **403** (non-premium) / **404**
(unknown slug).

**✅ Checkpoint:** flip premium off (folder 13 req 5, `isPremium:false`) and confirm these turn 403 —
proves the gate is real.

---

## 13 - Admin — Users & Audit Log

**Goal:** admin user management + the audit trail it writes. **Needs:** **ADMIN** (and **SUPER_ADMIN**
for the role change, req 4).

### 1. List Users
`GET /admin/users?page=1&limit=10` — safe projection (no hashes/tokens), `?search=` supported. Saves
the first user's id to `target_user_id`. **Re-point `target_user_id` at a throwaway user** (in the
Variables tab) before the mutating requests, so you don't block or demote yourself.

### 2. Get User By Id
`GET /admin/users/{{target_user_id}}` → **200** / **404**.

### 3. Block / Unblock
`PATCH /admin/users/{{target_user_id}}/status` with `{ "status": "BLOCKED" }` (or `ACTIVE`). Writes a
`USER_BLOCKED`/`USER_UNBLOCKED` audit entry. **200**.

### 4. Change Role (SUPER_ADMIN only)
`PATCH /admin/users/{{target_user_id}}/role` with `{ "role": "ADMIN" }`. **200** as SUPER_ADMIN,
**403** as a plain ADMIN (admins can't escalate roles — by design). Audited `USER_ROLE_CHANGED`.

### 5. Grant / Revoke Premium
`PATCH /admin/users/{{target_user_id}}/premium` with `{ "isPremium": true }`. The fast way to unlock
folder 12 for a test user (point `target_user_id` at yourself). Audited `USER_PREMIUM_GRANTED/REVOKED`.

### 6. List Audit Logs
`GET /admin/audit-logs?page=1&limit=20` — append-only trail (actor, action, entity, metadata, ip/ua).
You should see the entries written by requests 3–5 above.

**✅ Checkpoint:** a mutation in 3–5 shows up as a new row in req 6 — the audit log is wired end-to-end.

---

## 14 - Cleanup (optional — run at most ONE, LAST, if at all)

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
| `500` on avatar / logo / post-image upload | Real Cloudinary credentials are configured, so this shouldn't normally happen | Check the attached file is actually an image and under the size limit, and that `npm run dev` picked up `.env` (restart it if you changed `.env` recently). |
| `403` on `11`/`13` (admin) requests | Test user isn't `ADMIN` | `npm run admin:promote -- <test_email>`, then re-run Login (`01` step 4) for a fresh cookie. |
| `403` on `12` (premium) requests | Account isn't premium | Grant it: `13` req 5 with `{ "isPremium": true }` on your own `target_user_id` (or complete a `09` payment). |
| `400` on `07 - Publish` | No connection for that platform key, or platform not LIVE | Connect it first (`05`), or expect FAILED (not 400) once a connection row exists. |
| `07 - Publish` execution ends `FAILED` | Fake/expired connection token → provider call rejected | Expected without real OAuth — the row/status machinery is what you're verifying here. |
| Gateway error on `09 - Create Payment` | `BKASH_*` sandbox creds in `.env` are empty | Add real bKash sandbox creds, or skip payment and grant premium via admin (`13` req 5). |
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
| POST | `/api/v1/posts/:id/publish` | session | Publishing & Execution |
| GET | `/api/v1/executions` | session | Publishing & Execution |
| GET | `/api/v1/executions/:id` | session | Publishing & Execution |
| POST | `/api/v1/publications/:id/retry` | session | Retry |
| POST | `/api/v1/executions/:id/retry` | session | Retry |
| POST | `/api/v1/payments/create` | session | Premium Payment |
| GET | `/api/v1/payments/callback` | gateway (bKash) | Premium Payment |
| POST | `/api/v1/payments/verify` | session | Premium Payment |
| GET | `/api/v1/payments` | session | Payment History |
| GET | `/api/v1/payments/:id` | session | Payment History |
| POST | `/api/v1/admin/upcoming-features` | ADMIN/SUPER_ADMIN | Upcoming Features |
| GET | `/api/v1/admin/upcoming-features` | ADMIN/SUPER_ADMIN | Upcoming Features |
| GET | `/api/v1/admin/upcoming-features/:id` | ADMIN/SUPER_ADMIN | Upcoming Features |
| PATCH | `/api/v1/admin/upcoming-features/:id` | ADMIN/SUPER_ADMIN | Upcoming Features |
| PATCH | `/api/v1/admin/upcoming-features/:id/image` | ADMIN/SUPER_ADMIN | Upcoming Features |
| DELETE | `/api/v1/admin/upcoming-features/:id` | ADMIN/SUPER_ADMIN | Upcoming Features |
| GET | `/api/v1/upcoming-features` | session + premium | Upcoming Features |
| GET | `/api/v1/upcoming-features/:slug` | session + premium | Upcoming Features |
| GET | `/api/v1/admin/users` | ADMIN/SUPER_ADMIN | Admin — Users & Audit |
| GET | `/api/v1/admin/users/:id` | ADMIN/SUPER_ADMIN | Admin — Users & Audit |
| PATCH | `/api/v1/admin/users/:id/status` | ADMIN/SUPER_ADMIN | Admin — Users & Audit |
| PATCH | `/api/v1/admin/users/:id/role` | SUPER_ADMIN | Admin — Users & Audit |
| PATCH | `/api/v1/admin/users/:id/premium` | ADMIN/SUPER_ADMIN | Admin — Users & Audit |
| GET | `/api/v1/admin/audit-logs` | ADMIN/SUPER_ADMIN | Admin — Users & Audit |
