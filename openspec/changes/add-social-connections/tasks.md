## 1. Schema, crypto & OAuth infrastructure

- [ ] 1.1 Add the `social_connections` model + `User.socialConnections[]` / `Platform.connections[]` relations (data-model §4.4); `prisma migrate dev --name social-connections` + generate; verify the table + `@@unique([userId, platformId])` exist and tsc passes.
- [ ] 1.2 Add `lib/crypto` (AES-256-GCM encrypt/decrypt) + `TOKEN_ENCRYPTION_KEY` in config + `.env.example`; verify round-trip encrypt→decrypt returns the original and ciphertext differs.
- [ ] 1.3 Add OAuth `state` issue/validate helpers backed by Redis (short TTL, single-use); verify a valid state passes once and a reused/invalid state fails.
- [ ] 1.4 Define the `SocialConnector` interface + a registry keyed on `platform.key`; verify unknown keys are rejected.

## 2. Connect + callback (LinkedIn slice, end-to-end)

- [ ] 2.1 LinkedIn connector: build the OAuth URL, exchange the code, fetch the member identity; verify against LinkedIn's test app.
- [ ] 2.2 `GET /connections/:platform/connect` (LIVE-only) and `GET /connections/:platform/callback` (validate state → exchange → store encrypted connection); verify connecting LinkedIn stores an encrypted connection with the account name and that a non-LIVE platform is refused.

## 3. Facebook Page slice (end-to-end)

- [ ] 3.1 Facebook connector: exchange for a long-lived user token, list the user's Pages; verify Pages are returned for the test user.
- [ ] 3.2 `GET /connections/facebook/pages` + `POST /connections/facebook/select-page`: hold the transient user token, then store the selected Page's token as the connection; verify selecting a Page stores a Page-token connection (auto-select when only one).

## 4. List & disconnect (vertical slice)

- [ ] 4.1 `GET /connections` returns the caller's connections (platform, account name, status, expiry) with **no tokens**; verify tokens are absent from the response.
- [ ] 4.2 `DELETE /connections/:platform` hard-deletes the connection; verify the row and its tokens are gone and reconnect yields exactly one connection.

## 5. Integration & security

- [ ] 5.1 Verify owner-scoping (no cross-user connection access), encrypted-at-rest storage (inspect the DB row is ciphertext), and OAuth `state` CSRF validation on the callback.
- [ ] 5.2 Run `npm run check:fix` + `npx tsc --noEmit`; verify both pass; manual end-to-end connect→list→disconnect for both platforms.
