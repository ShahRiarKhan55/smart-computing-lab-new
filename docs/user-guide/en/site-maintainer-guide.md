# Site Owner / Maintainer Guide

**Audience:** the technical maintainer of the Smart Computing Lab website.
**Purpose:** the operational knowledge needed to run, change and deploy this codebase safely.
**Prerequisites:** Node.js, npm, git; familiarity with Prisma, Express and React is assumed.

This guide documents the repository as it actually exists. For deep implementation history and rationale, see `docs/architecture/*.md` — this guide is the practical operating reference; those are the design record.

## Repository structure

An npm-workspaces monorepo:

```
apps/server/    Express + Prisma API (TypeScript, ESM)
apps/web/       React + TypeScript + Vite frontend (SPA, client-rendered)
packages/shared/  Zod schemas, permissions, i18n dictionary — imported by both apps
api/            Vercel serverless function entry point (wraps apps/server's Express app)
docs/           This guide, the other user guides, and docs/architecture/ (implementation history)
```

`apps/server` has no `node_modules` of its own — npm workspaces hoist every dependency to the repo root.

## Frontend

Vite + React + TypeScript, client-side rendered only (no SSR). Routing is `react-router-dom`'s `BrowserRouter` (`apps/web/src/App.tsx` for the route table, `components/navConfig.ts` for the header's information architecture, data-driven). Large/rarely-needed routes are `React.lazy`-split; a handful of pages are deliberately kept eager (see the comment block at the top of `App.tsx`) because splitting them broke specific, reproduced browser-test timing assertions.

## Backend

Express 4, mounted under `/api` (`apps/server/src/app.ts`), plus `/robots.txt` and `/sitemap.xml` at the document root. Routes live in `apps/server/src/routes/*.routes.ts`, one file per resource, mounted in `routes/index.ts`. Authorization is enforced **server-side only** (`middleware/auth.ts`'s `requireAuth`/`requireCan`/`requireOwnerOrManager`, backed by the pure policy functions in `packages/shared/src/permissions.ts`) — the frontend's own use of those same functions is cosmetic (hides buttons), never a security boundary.

## Shared package

`packages/shared` — Zod validation schemas, the permission-policy functions, and the English/Japanese UI dictionary (`i18n/en.ts` / `i18n/ja.ts`, flat key→string maps; `TranslationKey` is derived from English's keys, so TypeScript itself enforces that Japanese defines exactly the same set). It is a **built, not source-resolved** package: `main`/`exports` point at `dist/`, produced by its own `build` script (`tsc`), which also runs automatically via its `postinstall` so a fresh `npm install` always has a fresh `dist/` without an extra manual step.

## Database

**Prisma 5.22.0**, SQLite-family datasource (`provider = "sqlite"`) in both environments:

- **Local development**: a plain local SQLite file, `apps/server/prisma/dev.db`, via `DATABASE_URL="file:./dev.db"`.
- **Production (Vercel)**: Turso (hosted libSQL), via `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`, through `@prisma/adapter-libsql` + `@libsql/client` (Prisma's `driverAdapters` preview feature). `apps/server/src/lib/prisma.ts` is the single place `PrismaClient` is constructed, and picks the topology automatically based on whether `TURSO_DATABASE_URL` is set — no other file branches on this.

Even with the libSQL adapter, Prisma 5.x's native "library" query engine still runs in-process to compile every query (the adapter only swaps the low-level DB I/O) — see `api/index.ts`'s extensive comments and the `binaryTargets` note below.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | local/test | `file:./dev.db` or a disposable copy |
| `TURSO_DATABASE_URL` | production | `<production value>` |
| `TURSO_AUTH_TOKEN` | production | `<secret>` |
| `SESSION_SECRET` | all | `<secret>` — the app refuses to start in production without a real value |
| `TRUST_PROXY` | all | `0` (no reverse proxy) / `1` (exactly one trusted hop) — see Trust Proxy below |
| `NODE_ENV` | all | `development` / `production` |
| `PUBLIC_BASE_URL` | optional | enables `/sitemap.xml` and gives invitation links an absolute URL; omitted in local dev |
| `BLOB_READ_WRITE_TOKEN` | production | `<provisioned automatically when Vercel Blob storage is attached>` |

Never commit real values for any secret-marked variable — see `apps/server/.env.example` for the full annotated list.

## Session system

`express-session` with a custom Prisma-backed store (`lib/prismaSessionStore.ts`, table `Session`) — chosen specifically to avoid a second native driver. Cookie name `scl.sid`; `HttpOnly`; `SameSite=Lax`; `Secure` in production (requires `TRUST_PROXY` **and** the reverse proxy actually sending `X-Forwarded-Proto: https` — see Trust Proxy). Session id is regenerated on login (fixation resistance) and on password change.

## Authentication & authorization

bcrypt password hashing (cost 10); a fixed dummy hash is compared against for an unknown email so timing can't distinguish "no such account" from "wrong password"; an in-memory, per-process login rate limiter (`lib/loginRateLimit.ts`) guards `/api/auth/login` and `/api/auth/password`. Researcher onboarding (`routes/invitations.routes.ts`) issues single-use, 7-day, SHA-256-hashed invitation tokens — the admin never sees or sets the researcher's password; see the Administrator Guide.

**Known limitation**: the login/invitation rate limiter is in-memory per process. On Vercel, each function instance has its own, so the guard's effectiveness degrades across cold starts/multiple instances — a real request still requires the correct password/token regardless.

## Storage

Dual backend (`lib/storage.ts`): local filesystem in development, Vercel Blob (private access) in production, selected automatically by whether `BLOB_READ_WRITE_TOKEN` is set. Files are addressed by an opaque, server-generated `storageKey` — never a user-supplied name or path. `npm run storage:reconcile -w apps/server` finds and reports orphaned blobs/rows.

**Vercel uploads need Blob.** A Vercel function's filesystem is read-only (and `/tmp` is ephemeral), so it is never persistent storage. Production (and Preview) uploads therefore require the Vercel Blob backend: attach a Blob store to the project so `BLOB_READ_WRITE_TOKEN` is set. Without the token, `POST /api/gallery` and `POST /api/files` return a controlled `503` ("File storage is not available right now…") instead of trying to write to the local disk; the rest of the site keeps working. Setting `STORAGE_DIR` on Vercel does not make that filesystem persistent and does not bypass this guard. Outside Vercel (local development, self-hosted servers) the local-disk backend is unchanged.

## Build, test, seed, migrate

```
npm run build                        # shared -> server -> web, in that order
npm run dev                          # concurrent server (tsx watch) + web (vite)
npm run migrate -w apps/server       # prisma migrate dev (local)
npm run seed -w apps/server          # idempotent: creates the admin account + sample content if absent
npm run test:unit -w apps/server     # pure unit tests, no server/DB
npm run test:invitations -w apps/server   # spawns a real server against a disposable DB copy
```

Most `test:*` scripts in `apps/server/package.json` follow the same pattern: copy `dev.db` to a disposable temp file, spawn the real server against the copy, drive it over real HTTP, discard the copy. **Explicitly clear `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` in your own shell** before running any of these locally if you've also been working against production Turso in the same terminal — several of these scripts spread `...process.env` into the spawned server's environment without clearing those two first, so an ambient Turso credential silently redirects the "local" test server to the real production database for reads (writes inside a failing transaction roll back, but it's still not what the script intends, and it's worth being deliberate about).

## Deployment (Vercel + Turso)

`vercel.json`: `buildCommand` builds `packages/shared` then `apps/web`; a `functions["api/index.ts"]` block ships the Prisma native query engine binary alongside the function (`includeFiles`); rewrites send `/api/*` to the function and everything else to the built SPA. `api/index.ts` sets `PRISMA_QUERY_ENGINE_LIBRARY` explicitly (Vercel's Function runtime is Amazon Linux, not the Debian-based build container, so `prisma/schema.prisma`'s `generator client` block lists `binaryTargets = ["native", "rhel-openssl-3.0.x"]` — `native` for local/CI, `rhel-openssl-3.0.x` for the deployed function; see the extensive comments in both files for the full root-cause history).

**Migrations are never auto-applied to production.** Prisma's own `migrate deploy` does not support Turso's HTTP-based connection; production migrations are applied via an audited one-off script against the real database, run manually and deliberately — never as part of a routine deploy.

## Rollback considerations

Vercel keeps previous deployments; redeploying an older one is the fastest rollback for application code. **Database migrations are additive-only by convention in this project** — nothing here has ever dropped a column or table — so rolling back application code while a newer, additive migration remains applied is safe (older code simply doesn't use the new table/columns). Rolling back a migration itself has no automated tooling here; it would be a manually-written, reviewed reverse migration, applied with the same deliberate, audited process as a forward one.

## Logging

Server errors are logged via `console.error` in the central error handler (`app.ts`); nothing beyond that is currently wired to an external log aggregator — stdout/stderr on whatever host runs the process (Vercel's own function logs in production).

## Security configuration

Helmet-based security headers (`lib/security.ts`), a CSP appropriate to this single-origin app, `TRUST_PROXY`-driven client-IP trust (`lib/trustProxy.ts` — explicit, environment-driven, documented rather than a blind `trust proxy: 1`), and the documented one supported topology: a single reverse proxy in front of both the static SPA build and the API, routing `/robots.txt`, `/sitemap.xml` and `/api/*` to the server and everything else to the SPA build.

## Rate limiting

In-memory, per-process, per-(IP, email) for login and password-change, per-IP for invitation info/accept — see Authentication above for the known multi-instance caveat.

## Backups / recovery

Turso provides point-in-time recovery on its own hosted platform (consult Turso's own dashboard/docs for your plan's retention window) — this repository does not implement its own backup mechanism. Local development's `dev.db` is a disposable, gitignored file with no backup expectation; the seed script (`npm run seed`) can always regenerate baseline content.

## Dependency updates

Standard `npm outdated` / `npm update` workflow; `apps/server`'s `allowScripts` entries in the root `package.json` are an explicit allow-list for packages with install scripts (`@prisma/client`, `@prisma/engines`, `esbuild`, `prisma`) — review before adding to it.

## Browser testing

`apps/server/scripts/browser-regression.cjs` drives a real headless browser over raw CDP (Chrome DevTools Protocol) — no Playwright/Puppeteer dependency; it spawns the browser binary directly. `BROWSER_PATH` selects the executable (defaults to a Windows Edge path; this container/most Linux CI sets it to a pre-installed Chromium). Supports `ONLY_*` env flags to run just one phase's section.

## Known limitations

- No self-service "forgot password" flow for a logged-out user (would require email delivery, deliberately not introduced — see the Administrator Guide's workaround: a fresh invitation).
- Login/invitation rate limiting is per-process, not shared across Vercel function instances.
- No automated backup mechanism beyond what Turso itself provides.
- No external log aggregation wired up by default.

## Operational checklist (before a production change)

1. Run `npm run build`, `npm run test:unit -w apps/server`, and the relevant `test:*` regression scripts.
2. If a migration is involved: confirm it's additive, apply and verify it locally first, and apply it to production only via the documented manual process — never automatically.
3. Review the diff for anything that could expose a secret, token or credential.
4. Deploy a Preview first; smoke-test `/api/health` and a real login before promoting to Production.

**Related documentation:** Administrator Guide · `docs/architecture/*.md` for implementation history
