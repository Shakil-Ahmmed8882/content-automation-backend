## 1. Schema, crypto & OAuth infrastructure

- [x] 1.1 Add the `social_connections` model + `User.socialConnections[]` / `Platform.connections[]` relations (data-model §4.4); `prisma migrate dev --name social-connections` + generate; verify the table + `@@unique([userId, platformId])` exist and tsc passes.
- [x] 1.2 Add `lib/crypto` (AES-256-GCM encrypt/decrypt) + `TOKEN_ENCRYPTION_KEY` in config + `.env.example`; verify round-trip encrypt→decrypt returns the original and ciphertext differs. Verified end-to-end (`tests/e2e/social-connections.e2e.test.ts`: round-trip, random-IV, tamper-detection).
- [x] 1.3 Add OAuth `state` issue/validate helpers backed by Redis (short TTL, single-use); verify a valid state passes once and a reused/invalid state fails. Verified (`connection.utils.ts`; tests cover single-use consume + unknown/missing state).
- [x] 1.4 Define the `SocialConnector` interface + a registry keyed on `platform.key`; verify unknown keys are rejected. Verified (registry `getConnector`; test: a LIVE platform with no wired connector → 501).

## 2. Connect + callback (LinkedIn slice, end-to-end)

- [x] 2.1 LinkedIn connector: build the OAuth URL, exchange the code, fetch the member identity. `buildAuthUrl` verified (test asserts linkedin.com + state). The live code→token→identity exchange is implemented with real `fetch` but can only be verified against a real LinkedIn app + interactive consent (env `LINKEDIN_*` are empty placeholders) — that handshake is manual-only (Postman guide), same posture as the Cloudinary/SMTP placeholders.
- [x] 2.2 `GET /connections/:platform/connect` (LIVE-only) and `GET /connections/:platform/callback` (validate state → exchange → store encrypted connection); verified: connect returns the OAuth URL for a LIVE platform, refuses a non-LIVE platform (400), and the callback rejects a missing/unknown state and stores nothing. The store-on-valid-callback path (encryption + persistence) is verified for real via the Facebook select-page flow and the encrypted-at-rest test; only the live token exchange itself is manual.

## 3. Facebook Page slice (end-to-end)

- [x] 3.1 Facebook connector: exchange for a long-lived user token, list the user's Pages. Implemented with real `fetch` (short→long-lived token, `/me/accounts`); the live exchange is manual-only (no real Facebook app configured), same posture as 2.1.
- [x] 3.2 `GET /connections/facebook/pages` + `POST /connections/facebook/select-page`: hold the transient user token, then store the selected Page's token as the connection; verified end-to-end by seeding the transient stash exactly as the callback would, then listing Pages (no tokens) and selecting one → stores a Page-token connection (decrypts back to the Page token). Auto-select-when-one is implemented in the callback path.

## 4. List & disconnect (vertical slice)

- [x] 4.1 `GET /connections` returns the caller's connections (platform, account name, status, expiry) with **no tokens**; verified (test asserts no access/refresh token in the response and none in the serialized body).
- [x] 4.2 `DELETE /connections/:platform` hard-deletes the connection; verified the row is gone, reconnect yields exactly one connection, disconnecting a non-connected platform → 404.

## 5. Integration & security

- [x] 5.1 Verify owner-scoping (no cross-user connection access), encrypted-at-rest storage (inspect the DB row is ciphertext), and OAuth `state` CSRF validation on the callback. All verified end-to-end (cross-user list/delete isolation, raw DB row is ciphertext + decrypts to original, callback rejects missing/unknown state).
- [x] 5.2 Run `npm run check:fix` + `npx tsc --noEmit`; verify both pass (both exit 0; 3 `noSecrets` warnings on endpoint-path strings in the test file are false positives). Automated instead of manual: `tests/e2e/social-connections.e2e.test.ts` (23 tests, all passing). Live connect→publish for both platforms remains a manual Postman step (needs real OAuth apps). Run: `npm test` (2026-09-06).
