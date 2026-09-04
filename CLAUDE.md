# CLAUDE.md — Content Automation Platform (Backend)

Backend for "write once → publish to many platforms" (LinkedIn + Facebook Page for MVP).
Node.js (ESM) · TypeScript · Express 5 · Prisma 7 (PostgreSQL) · Redis/BullMQ · Biome.

**Read these before non-trivial work (pointers, not inlined — open them):**
- `docs/PRD.md` — product scope, features, acceptance criteria (source of truth for *what*).
- `docs/data-model.md` — the agreed data model + Prisma schema appendix (source of truth for *schema*).
- Patterns/architecture were adapted from a separate PH-Healthcare backend (kept **local only**,
  not part of this repo). Those patterns are fully captured in this file.

## Architecture — request flow (never skip a layer)

```
route → middleware (auth, validateRequest) → controller → service → lib/prisma
```

- **route** — declares the path, attaches guards/validation, delegates to the controller. No logic.
- **controller** — reads `req`, calls one service function, shapes the HTTP reply via `sendResponse`. No business logic, no DB.
- **service** — all business logic + DB access (`prisma`). Assumes input is **already authorized and validated**. Returns plain data; never touches `req`/`res`.
- **lib/** — external integrations, one file per concern (prisma, redis, queue, cloudinary, multer, nodemailer, googleAuth, bkash, emailTemplate). Encapsulate SDKs here; the rest of the app imports from `lib/`.

## Module pattern — every feature module mirrors this

`src/app/module/<name>/` contains:
- `<name>.route.ts` → `export const <Name>Routes` (a `Router`)
- `<name>.controller.ts` → `export const <Name>Controller = { ... }`
- `<name>.service.ts` → `export const <Name>Service = { ... }`
- `<name>.validation.ts` → `export const <Name>Validation = { ... }` (Zod schemas)
- `<name>.interface.ts` → `IXxx` types/interfaces (prefix `I`)

Mount modules in `src/app.ts` under `/api/v1/<resource>`.

## Hard rules (MUST)

1. **Guard at the ROUTE, not the service.** Authn/authz (`auth(...roles)`) and body validation
   (`validateRequest(schema)`) are route middleware. A service must never re-check auth or parse raw bodies.
2. **Read env only through `src/app/config`.** Never use `process.env` elsewhere. (Sole exceptions:
   `lib/prisma.ts` + `prisma.config.ts` needing `DATABASE_URL` for the driver adapter.)
3. **One response shape.** Always reply via `sendResponse(res, { statusCode, success, message, data, meta? })`.
4. **Throw, don't handle inline.** Services/controllers `throw` (use `AppError(status, msg)` for known cases);
   `catchAsync` wraps every controller/middleware; `globalErrorHandler` formats the response. No try/catch just to send an error.
5. **Prisma only via `lib/prisma`.** Never `new PrismaClient()` elsewhere.
6. **Backend is authoritative** (PRD §32 R5): premium status, payment verification, OAuth state, execution
   status live server-side. Never trust the client for premium or payment success.
7. **Secrets never leave the server.** Never return tokens/passwordHash/stack traces to clients (PRD §22).
   OAuth tokens are encrypted at rest. Secrets come from env; never commit them.
8. **No fake functionality** (PRD §32 R4). If a feature isn't built, return `501` (`utils/notImplemented`) —
   don't fake success.
9. **Follow `docs/data-model.md`.** Don't invent schema. UUID PKs; soft-delete only `users`+`posts`;
   images stored as `…Url` + `…PublicId` pairs; parent caches child status (execution←publications←attempts).
10. **No AI attribution in git, ever.** Before every push, organize the diff into logical commits per
    `.claude/skills/cmd-git-organize` (Conventional Commits, one responsibility per commit). Commit
    messages and PR bodies must NEVER contain `Co-Authored-By`, "Generated with/by Claude/Copilot", or
    any AI/assistant reference — this repo is public; commits must read as authored by a human.

## Auth & authorization

- JWT access + refresh tokens in **httpOnly cookies** (Bearer header is a fallback). Set via the controller.
- `auth(...roles)` (`middleware/checkAuth`) verifies the token and attaches `req.user` `{ userId, email, name, role }`.
  `auth()` = any logged-in user; `auth("ADMIN","SUPER_ADMIN")` = role-gated.
- Roles: `USER` (default), `ADMIN`, `SUPER_ADMIN`. Premium is a **flag, not a role**.
- Ownership: always scope queries by `req.user.userId`. One user must never read another's rows (PRD §23).

## Integrations & jobs

- **Publishing runs in the background** via BullMQ (`lib/queue`) so the HTTP request returns "started"
  immediately and the browser can close (PRD §12/§24). Publishers implement a common `SocialPublisher`
  interface, dispatched by `platform.key` (`linkedin`/`facebook`). Use native `fetch` for provider APIs (like `lib/bkash`).
- **Payments = bKash tokenized SANDBOX** (`lib/bkash`, ported from reference) — test money, not real.
  Verify success server-side, then set `user.isPremium`.
- **Email** — build HTML with `renderEmailTemplate(name, data)` (`lib/emailTemplate`), send via `nodemailer`.
  Templates are EJS in `src/app/templates/emails/` (+ `partials/`): `verify-email`, `forgot-password`,
  `password-changed`, `publish-result`. Email failures must never break the triggering request (log, don't throw).
- **OTP flows** (register verify, forgot-password) stash a short-lived key in Redis; the DB row is created
  only after OTP verification.

## Commands

- `npm run dev` — tsx watch (needs Postgres + Redis reachable)
- `npm run prisma:generate` — after any schema change (client → `src/generated/prisma`, gitignored)
- `npm run prisma:migrate` — create/apply migrations
- `npm run check:fix` — Biome lint + format (run before finishing a change)
- `npm run build` / `npm start` — tsc → `node dist/src/server.js`

## Conventions & gotchas

- **ESM** — use `import`/`export`; import Node builtins as `node:path` etc.
- Status codes via `http-status` (`httpStatus.OK`, …). Prisma error mapping lives in `globalErrorHandler`.
- Generated Prisma client is **gitignored** — run `prisma generate` after cloning or schema edits, or imports from
  `src/generated/prisma` fail to compile.
- List endpoints support pagination/filter/sort/search and return `meta` on `sendResponse`.
- Every new table follows the conventions in `docs/data-model.md` §6 (timestamps, soft-delete scope, indexes).
- Keep this file lean; put deep rationale in `docs/`, not here.
