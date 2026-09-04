# Content Automation Platform — Backend

> **Write once → publish to multiple platforms.** (LinkedIn + Facebook Page for MVP.)

Backend for the Content Automation Platform described in `../docs/PRD.md`. Structure,
conventions, and reusable infrastructure are ported from the `L2B7-Project-PH-Healthcare-Backend`
reference project.

## Stack

- **Runtime:** Node.js (ESM) + TypeScript, Express 5, `tsx` for dev
- **DB:** PostgreSQL via Prisma 7 (`prisma-client` generator, `@prisma/adapter-pg` driver adapter), multi-file schema in `prisma/schema/`
- **Auth:** JWT access/refresh in httpOnly cookies, bcryptjs, Google OAuth (`google-auth-library`)
- **Cache / OTP / queue backing:** Redis (`redis` for OTP + bKash token cache, `ioredis` for BullMQ)
- **Background jobs:** BullMQ (publishing runs off the request thread)
- **Media:** Multer (memory) + Cloudinary
- **Email:** Nodemailer
- **Payments:** bKash (ported from the reference; token grant/refresh already implemented)
- **Security:** Helmet, express-rate-limit, Zod validation
- **Tooling:** Biome (lint + format)

## Dependency status vs. the reference project

**Reused from L2B7 (proven):** express, cors, cookie-parser, @prisma/client, prisma,
@prisma/adapter-pg, pg, zod, bcryptjs, jsonwebtoken, google-auth-library, redis, multer,
cloudinary, nodemailer, ejs, http-status, node-cron + the dev/typing toolchain.

**Added for this PRD (not in L2B7):**

| Package | Why |
|---|---|
| `bullmq` + `ioredis` | Background publishing worker (PRD §12/§24) |
| `helmet` | Security headers (PRD §23) |
| `express-rate-limit` | Rate limiting (PRD §23) |

LinkedIn/Facebook publishing needs **no new SDK** — Graph/REST calls use native `fetch`,
like `src/app/lib/bkash.ts`. The **React Flow** workflow view (PRD §26) belongs to a separate
frontend app; this backend is backend-only, matching the reference.

## Getting started

```bash
cp .env.example .env      # then fill in secrets
npm install
npm run dev               # tsx watch src/server.ts (needs Postgres + Redis reachable)
```

Once the data model exists (see below):

```bash
npm run prisma:generate   # generates the client into src/generated/prisma
npm run prisma:migrate    # creates tables
```

> The Prisma client is generated even with a models-free schema, so the skeleton compiles
> and boots today. `src/generated` is gitignored — run `prisma generate` after cloning.

## Scope of this repo: base skeleton only

This is the **base skeleton**. The **data model is intentionally NOT written here** — it will
be designed in a dedicated interactive modeling session against the PRD. `prisma/schema/` holds
only `schema.prisma` (generator + datasource), no models yet.

### What's in the skeleton

- ✅ **Config + env wiring** (`src/app/config`, `.env.example`) — DB, JWT, Google, Redis, SMTP,
  Cloudinary, LinkedIn, Facebook, bKash, premium pricing.
- ✅ **Integration libs** (`src/app/lib`) — prisma, redis, cloudinary, multer, nodemailer,
  googleAuth, **bkash** (ported from the reference), **queue** (BullMQ), cron, emailTemplate.
- ✅ **Generic middleware** — `auth` (JWT verify, model-agnostic), `validateRequest`,
  `globalErrorHandler`, `notFound`.
- ✅ **Utils** — `sendResponse`, `catchAsync`, `appError`, `jwt`.
- ✅ **App/server bootstrap** — helmet + rate-limit + cors + cookies, health routes, error handling.
- ✅ **Empty module folders** under `src/app/module/` (auth, user, connection, post, execution,
  payment, upcomingFeature) ready to fill in.

### What comes NEXT (separate sessions, not done here)

1. **Data modeling session** — design the Prisma schema (User, connections, posts, executions,
   publications, payments, upcoming features, …) against the PRD.
2. **Build modules** on top, following PRD §31 order: auth → user/profile → connections
   (LinkedIn + Facebook OAuth) → posts → publishing/executions (BullMQ worker + `SocialPublisher`
   abstraction) → payments (bKash → premium) → upcoming features.
