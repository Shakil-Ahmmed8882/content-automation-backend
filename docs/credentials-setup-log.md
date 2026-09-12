# Credentials & Integration Setup Log

A running journal of how each third-party credential in `.env` got configured: what it's for,
the exact steps taken, any issue hit and how it was diagnosed/fixed, and (for OAuth ones) a plain-
language explanation of what's actually happening under the hood. This is a *learning/analysis*
record for whoever is wiring up the environment — not a technical decision log (that's
`docs/decisions.md`) and not a spec (that's `openspec/`). Written as each credential is configured.

Entries are separated by `====` rules, oldest first.

====================================================================================================

## Cloudinary (image storage — avatars, platform logos, post images)

**Why the project needs it:** Every image upload (user avatar, admin-set platform logo, post image)
is streamed server-side to Cloudinary and stored as a `…Url` + `…PublicId` pair (see
`docs/data-model.md`). No image ever touches our own disk/DB as a blob.

**Steps taken:**
1. Signed in to an existing Cloudinary account (console.cloudinary.com).
2. Copied `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` into `.env`
   from **Settings → API Keys**.

**Issue hit:** Every upload attempt failed with `403 Forbidden` even though the key/secret were
correct (confirmed via a direct `cloudinary.api.ping()` call, which succeeded). A follow-up
`cloudinary.api.usage()` call returned the real reason: `"Request forbidden due to missing
permissions (actions=["read"])"`.

**Root cause:** The API key in use (`content-automation`) was a **scoped/restricted key** that had
**no Product Environment Roles assigned at all** — confirmed on **Settings → API Keys →** clicking
the key showed *"content-automation Doesn't Have Any Product Environment Roles Yet."* This account
has multiple API keys across different projects (`health-care`, `foundX`, etc.), and this one was
generated without a role.

**Fix:** Opened **Assign Roles** on that key and selected **Master Admin** (full permissions) —
appropriate here because this key is only ever used server-side (never exposed to a browser/client),
so there's no exposure risk to weigh against giving it full access.

**Verified:** Direct `usage()`, `upload_stream()`, and `destroy()` calls all succeeded afterward.
Re-ran the three e2e suites that touch Cloudinary (`user-profile`, `platform-catalogue`,
`content-posts`) — all previously-`skipIf`-skipped live-upload tests now pass for real
(65/65 total, zero skips).

**Status:** ✅ Done, verified live.

====================================================================================================

## SMTP (Gmail — verify-email / forgot-password / password-changed emails)

**Why the project needs it:** `lib/nodemailer.ts` sends transactional emails via `nodemailer`'s
built-in `service: "gmail"` preset. Note: `SMTP_HOST` in `.env` is actually **not read by the code**
— only `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_SENDER` are consumed; the code always talks to Gmail
regardless of that value. It's documentation-only.

**Why a regular password doesn't work:** Google blocks plain-password SMTP login entirely. Gmail
requires a per-application **App Password**, which itself requires 2-Step Verification to be enabled
on the account first.

**Steps taken:**
1. Enabled 2-Step Verification on the Gmail account (myaccount.google.com → Security).
2. Generated an App Password at myaccount.google.com/apppasswords (named "Content Automation
   Backend").
3. Set `SMTP_USER` / `SMTP_PASSWORD` (the 16-character app password) / `EMAIL_SENDER` in `.env`.

**Verified:** `transporter.verify()` returned `true` — the login itself is genuinely correct. A real
test send hit `550-5.4.5 Daily user sending limit exceeded` — that's Gmail's own per-account daily
send cap (new/lightly-used accounts start with a lower quota), **not** a config problem, and it
resets on a rolling 24h window. It also doesn't block anything in this app: email failures are
caught and logged, never thrown (`nodemailerSend` is fire-and-forget by design), and
`EXPOSE_OTP_IN_RESPONSE=true` means the register/forgot-password flows don't depend on real email
delivery in dev/test anyway — the OTP comes back in the API response directly.

**Status:** ✅ Done, credentials verified working (send quota is a separate, self-resolving limit).

====================================================================================================

## Database — switched from local Postgres to Prisma Postgres (cloud)

**What changed:** `DATABASE_URL` now points at a Prisma-managed cloud Postgres instance
(`pooled.db.prisma.io`) instead of the local dev Postgres on `localhost:5433`.

**Why:** Deliberate choice so the DB can be browsed visually via `npx prisma studio` without needing
local `psql`/GUI tooling — easier manual inspection of what the API creates while testing by hand.

**How it happened / was verified:**
- `DATABASE_URL` was first found already overwritten with the cloud URL — most likely from
  something in the Prisma Console web UI (a few tabs of it were open at the time) auto-writing the
  project's `.env`, not a deliberate edit. It was reverted to local once to confirm that was the
  cause (confirmed: local baseline passed 65/65 tests clean), then switched back to the cloud URL
  intentionally per the decision above.
- The very first attempt to use the cloud URL failed with `Can't reach database server at
  pooled.db.prisma.io` — this turned out to be transient. A raw TCP check
  (`Test-NetConnection pooled.db.prisma.io -Port 5432`) and a direct Prisma query both succeeded
  moments later; there was no real network block or bad credential.
- Applied all 8 existing migrations to the empty cloud DB: `npx prisma migrate deploy`.
- Ran the app's own seed functions (`seedPlatforms`, `seedUpcomingFeatures`) once against it so the
  `linkedin`/`facebook` platform rows and the 3 upcoming-feature rows exist (tests and the connect
  flow depend on those rows existing).
- Re-ran the full 4-module e2e suite against the cloud DB: **65/65 passed** (slower than local —
  ~203s vs ~178s — due to network round-trips, but otherwise identical result).

**Note for later:** if local/offline dev is ever needed again, the local connection string is
`postgresql://postgres:postgres@localhost:5433/content_automation?schema=public` (just swap
`DATABASE_URL` back — no other change needed).

**Status:** ✅ Cloud DB fully migrated, seeded, and test-verified.

====================================================================================================

## LinkedIn OAuth (social connect + publishing)

### What is OAuth, and why does this project need it? (the actual question, answered)

**The problem OAuth solves:** our backend needs to post content "as the user" on LinkedIn. The
naive approach — asking the user for their LinkedIn username/password and logging in as them — is
exactly what OAuth exists to *prevent*. LinkedIn (like every serious platform) will never let a
third-party app collect your real password: if it did, that app could do *anything* on your
account forever, and there's no way to revoke access without changing your password everywhere.

**How OAuth differs from manual password login:**
| Manual password login | OAuth |
|---|---|
| App collects and stores your real password | App never sees your password at all |
| All-or-nothing access, forever, until you change your password | Scoped access (e.g. "post on my behalf" only) for a limited time |
| Revoking access means changing your password (breaks every app using it) | Revoking access means disconnecting *that one app* on LinkedIn's own settings — everything else keeps working |
| No record of which apps have access | LinkedIn (and our own `social_connections` table) knows exactly which app, which scopes, since when, until when |

**How it connects to this exact scenario:** instead of a password, LinkedIn hands our server a
short-lived **access token** after the user explicitly clicks "Allow" on LinkedIn's own consent
screen. Our server stores that token (encrypted, AES-256-GCM — see `lib/crypto.ts`) and uses it
later to call LinkedIn's API on the user's behalf. The user's real LinkedIn password is never part
of this flow at any point.

### Steps taken (LinkedIn Developer Portal)

1. Created a LinkedIn Company Page (`content-automation8882`) — LinkedIn requires every Developer
   App to be linked to *some* Page as an administrative/verification requirement. **This does not
   mean posts get published to that Page** — posts go to the connecting user's personal profile,
   because of the scope chosen in step 3.
2. Created the Developer App ("Content Automation") at linkedin.com/developers/apps, linked to that
   Page. This app has its own identity — a `Client ID` + `Client Secret` — completely separate from
   any personal LinkedIn login.
3. On the **Products** tab, added two self-serve products (no approval wait):
   - **Sign In with LinkedIn using OpenID Connect** → grants the `openid` + `profile` scopes
     (permission to know who the user is).
   - **Share on LinkedIn** → grants the `w_member_social` scope (permission to create/modify/delete
     posts as the member — *not* as the linked Page; posting as an Organization/Page needs a
     different, partner-gated product).
4. On the **Auth** tab: set the **Authorized redirect URL** to exactly
   `http://localhost:5000/api/v1/connections/linkedin/callback` (must match character-for-character
   with `LINKEDIN_REDIRECT_URI` in `.env`, or LinkedIn rejects the callback), and copied
   `Client ID` / `Client Secret` into `.env` as `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`.

**Issue hit:** after adding both products, the Auth tab's "OAuth 2.0 scopes" panel only ever showed
`w_member_social`, never `openid`/`profile` — even after a page refresh and re-confirming both
products were listed under "Added products."

**How it was resolved:** rather than guess, ran the actual live OAuth flow end-to-end:
- Started the local dev server, created a disposable test user via the real `/auth/register` →
  `/auth/verify-email` → `/auth/login` endpoints.
- Called our own `GET /api/v1/connections/linkedin/connect` to get a real authorization URL backed
  by a genuine single-use Redis `state` value.
- Opened that URL in a real browser, logged into LinkedIn, and clicked **Allow**.
- LinkedIn redirected back to `.../connections/linkedin/callback?code=...` and our server's
  response was `"message": "Platform connected successfully"` with a stored connection
  (`platformAccountName: "Shakil Ahmmed"`, `status: "CONNECTED"`, token expiry ~2 months out).

This proved the scopes were in fact all granted correctly — the Auth tab's scopes panel was simply
a stale/buggy display on LinkedIn's own dashboard, not a real permissions gap.

### What happens technically on each connect (mapped to the actual response)

1. Browser → LinkedIn's authorization URL (`client_id`, `redirect_uri`, `state`, requested `scope`).
2. User reviews LinkedIn's own consent screen and clicks Allow.
3. LinkedIn → redirects the browser to our `/callback` route with a one-time `code`.
4. Our server validates the `state` (CSRF protection — single-use, Redis-backed, tied to the
   initiating user), then privately exchanges `code` for a real access token directly with
   LinkedIn's servers using the `Client Secret` (this exchange never touches the browser — that's
   exactly why the secret matters: a leaked `code` alone is useless without it).
5. Server fetches the member's identity (`openid`/`profile` scope) and encrypts+stores the access
   token (`lib/crypto.ts`, AES-256-GCM) in `social_connections`, keyed to the user.
6. Server responds with a **safe summary only** — platform, display name, status, expiry — never
   the token itself. That's the same "tokens never reach a client" rule this project applies
   everywhere (see `docs/decisions.md` "Auth & auth model" section and the `add-social-connections`
   spec).

**Status:** ✅ Done — real, live, end-to-end verified (not just config-checked).

====================================================================================================

## Facebook OAuth (social connect + publishing)

**Why the project needs it:** same purpose as LinkedIn, but for a Facebook **Page** (not a personal
profile) — matches this project's MVP scope (LinkedIn + Facebook Page, PRD-level decision). Posts
are published to a Page the connecting user administers, via the Page's own access token (not the
user's personal token) — this is Facebook's model: a personal profile can never be posted to via
the API, only Pages can.

### Steps taken (Meta for Developers)

1. Created the app at developers.facebook.com/apps using Meta's newer "use case"-based flow (this
   has replaced the old "Products" picker LinkedIn still uses): picked **"Manage everything on your
   Page"** as the use case, which bundles the Page-permission set this project needs.
2. Under that use case, on the **Customize** screen, individually **Added** each required
   permission — selecting the use case alone does *not* grant its permissions automatically:
   - `pages_show_list` — list the Pages the user administers
   - `pages_read_engagement` — read basic Page info
   - `pages_manage_posts` — create/edit/delete posts on the Page
3. On the **Auth** tab (use case settings): set the **Valid OAuth Redirect URI** to exactly
   `http://localhost:5000/api/v1/connections/facebook/callback` (must match
   `FACEBOOK_REDIRECT_URI` in `.env` character-for-character), copied `App ID` / `App Secret` into
   `.env` as `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`.
4. Created a Facebook **Page** (facebook.com/pages/create, name "Content Automation Test") — like
   LinkedIn's Company Page requirement, a Facebook app can only manage Pages, and the account had
   none yet. Without a Page, the connect flow completes successfully but has nothing to show
   (`GET /me/accounts` legitimately returns an empty list — not a bug, see "issue hit" below).

**Issue hit #1 — `Invalid Scopes: pages_manage_posts, pages_read_engagement`** on the very first
consent-screen attempt. Root cause: adding a *use case* at app-creation time does not automatically
grant its individual permissions — each one has to be explicitly clicked **Add** under "Customize
the Manage everything on your Page use case" in the dashboard. Fixed by adding each missing
permission there, then re-generating the authorization URL (old ones carry the stale scope list).

**Issue hit #2 — "App not active" error on the consent screen.** Root cause: the browser tab was
logged into a different Facebook account than the one used to create the app/Page — Meta requires
the tester to be an admin/developer on the app while it's in Development mode. Fixed by switching
Facebook accounts in that browser tab.

**Issue hit #3 — callback returned `"pages": []`** (empty) even though the OAuth exchange itself
succeeded with no error. Root cause: this was *not* a bug — the account genuinely administered zero
Facebook Pages at that point (`GET /me/accounts`, which our connector calls, only returns Pages the
authenticated user administers). Fixed by creating a Page (step 4 above) and re-running the connect
flow from scratch with a fresh `state` token.

### What happens technically on each connect (mapped to the actual response)

1. Browser → Facebook's authorization URL (`client_id`, `redirect_uri`, `state`, requested scopes).
2. User reviews Facebook's own consent screen (lists the 3 permissions) and clicks Allow.
3. Facebook → redirects the browser to our `/callback` route with a one-time `code`.
4. Server validates `state` (CSRF, same Redis-backed single-use mechanism as LinkedIn), exchanges
   `code` for a short-lived user access token, then upgrades it to a **long-lived** token, then
   calls `GET /me/accounts` to list Pages the user administers.
5. **Design D4 (two-step connect):** if the user has exactly **one** Page, the server auto-selects
   it and stores that Page's own access token as the connection immediately (`kind: "connected"`).
   If the user has **multiple** Pages, the server instead stashes the transient user token + Page
   list in Redis for 10 minutes (`kind: "select-page"`) and the caller must follow up with
   `GET /connections/facebook/pages` (see the list) then `POST /connections/facebook/select-page
   { pageId }` to finish. This project's test account had exactly one Page, so auto-select applied
   and the picker step was never needed here — but the code path exists and is covered.
6. Server stores the connection (`social_connections`, encrypted per `lib/crypto.ts`) and responds
   with the same safe summary shape as LinkedIn — platform, display name, status, expiry, never the
   token itself.

**Verified:** live end-to-end — `GET /connections` shows both platforms:
```json
{ "platform": "linkedin", "platformAccountName": "Shakil Ahmmed", "status": "CONNECTED" }
{ "platform": "facebook", "platformAccountName": "Content Automation Test", "status": "CONNECTED" }
```
Confirmed the Facebook row directly in Prisma Studio too (`SocialConnection` table): encrypted
`accessToken`, real `platformAccountId`/`platformAccountName`, correct `userId`, no plaintext
secrets stored.

**Note on the frontend integration (not yet built, flagged for later):** `/callback` currently
returns raw JSON straight to whatever hits it. Since Facebook (and LinkedIn) redirect the **browser
itself** to that URL — not a frontend API call — a real SPA frontend would want the backend to
instead redirect the browser to a frontend route (e.g. `FRONTEND_URL/connect/facebook?...`) so
React/Vue can render a proper "select your Page" UI instead of raw JSON. That redirect isn't
implemented yet; it's a frontend-integration detail, not a backend bug — Postman testing doesn't
need it since we read the raw JSON directly.

**Status:** ✅ Done — real, live, end-to-end verified (not just config-checked).

====================================================================================================

## bKash sandbox (premium upgrade payments)

**Why the project needs it:** `lib/bkash.ts` implements bKash's Tokenized Checkout flow — used to
verify a real (sandbox) payment server-side before flipping `user.isPremium` (see hard rule #6:
the backend is authoritative for payment success, never the client).

**Why bKash needs 4 credentials instead of one key pair:** bKash layers two identities together —
`BKASH_USERNAME`/`BKASH_PASSWORD` (a merchant account login, sent as request headers) and
`BKASH_APP_KEY`/`BKASH_APP_SECRET` (an API app registered under that merchant, sent in the request
body) — both are required together on every grant/refresh call to prove "this app, acting for this
merchant."

**Steps taken:**
1. Went to developer.bka.sh — unlike every other integration in this project, bKash's **sandbox
   credentials are fixed and publicly published** on the developer portal (no signup, no real
   business, no real money) specifically so anyone can test Tokenized Checkout without an
   onboarding process.
2. Copied the published `BKASH_USERNAME` / `BKASH_PASSWORD` / `BKASH_APP_KEY` / `BKASH_APP_SECRET`
   values into `.env`. `BKASH_BASE_URL` was already pre-set to the sandbox host
   (`tokenized.sandbox.bka.sh`).

**Issue hit:** same leading-space typo pattern as earlier credentials (`BKASH_USERNAME=
sandboxTokenizedUser02` instead of `BKASH_USERNAME=sandboxTokenizedUser02`). Confirmed via
`src/app/config/index.ts` that these are read as raw `process.env.BKASH_*!` with no `.trim()`
anywhere — so a leading space would have been sent to bKash literally as part of the
username/password headers and app_key/app_secret body fields, causing an auth failure that would
look unrelated to whitespace. Fixed by removing the stray leading spaces.

**Verified:** wrote a one-off script that imports `getBkashGrantIdToken` directly (bypassing the
whole payment HTTP flow) and called it against the real sandbox API. It returned a genuine signed
JWT id token from bKash's servers — confirming the 4 credentials are valid and the grant call
succeeds end-to-end. Script was deleted immediately after (not part of the codebase).

**Status:** ✅ Done, verified live against bKash's real sandbox API.

====================================================================================================
