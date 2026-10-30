# Build and deployment

## Architecture

| Piece | Where |
|---|---|
| Source | GitHub: `ShahRiarKhan55/smart-computing-lab-new`, production branch `master` |
| Hosting | Vercel project `smart-computing-lab` (Git integration). Production site: https://smartcomputinglab.vercel.app |
| Database | Turso (hosted libSQL), reached from the Vercel function |
| Files | a private Vercel Blob store |
| CI | GitHub Actions workflow "CI" (job "Build, lint and test"), independent of Vercel |

`vercel.json` (summary):

- `buildCommand`: `npm run build -w packages/shared && npm run build -w apps/web`; output directory `apps/web/dist`.
- `functions["api/index.ts"].includeFiles` ships the Prisma native query engine for Amazon Linux (`libquery_engine-rhel-openssl-3.0.x.so.node`); `prisma/schema.prisma` lists the matching `binaryTargets`.
- Rewrites send `/api/*`, `/robots.txt` and `/sitemap.xml` to `api/index.ts`, and everything else to the single-page app.

The Vercel build does **not** run database migrations and does not run the test suites.

## What happens on each Git event

| Event | Result |
|---|---|
| Push to a branch, or a pull request | GitHub Actions CI runs. Vercel creates a **Preview** deployment for the branch. |
| Merge into `master` | CI runs on `master`. Vercel deploys to **Production** automatically from `master`. |

Which database a Preview deployment uses depends on how the Vercel environment variables are scoped in the dashboard. That configuration is outside the repository: **needs verification** in the Vercel dashboard before relying on Preview behavior. If Preview shares the production Turso variables, a Preview of an unmerged branch runs that branch's code against the production database.

## Environment variables (names only)

Set in the Vercel dashboard (Settings → Environment Variables), never in a committed file. The annotated list is `apps/server/.env.example`.

| Variable | Needed in production | Purpose |
|---|---|---|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | yes, both | production database connection; the app refuses to start with only one |
| `SESSION_SECRET` | yes | signs session cookies; the app refuses to start in production without a real value |
| `TRUST_PROXY` | yes (`1` on Vercel) | trust exactly one proxy hop for client IPs |
| `LAB_BLOB_READ_WRITE_TOKEN` or `BLOB_READ_WRITE_TOKEN` | yes, for uploads | private Blob store token; without it uploads answer 503 |
| `PUBLIC_BASE_URL` | recommended | enables `/sitemap.xml` and absolute invitation links; the real public origin, no trailing slash |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | optional (all three) | Google sign-in for already-linked accounts |
| `MAX_IMAGE_BYTES`, `MAX_DOCUMENT_BYTES` | optional | override the 5 MB and 15 MB upload limits |
| `NODE_ENV` | set by Vercel | `production` |
| `PRISMA_QUERY_ENGINE_LIBRARY` | set in `api/index.ts` | location of the query engine; do not set manually |
| `PORT`, `STORAGE_DIR`, `DATABASE_URL` | local only | local server port, local file storage, local SQLite file |

Variables used only by the migration command (`MIGRATE_TARGET_URL`, `MIGRATE_TARGET_TOKEN`) belong in a single shell session, not in Vercel.

## Releasing a change

1. Open a pull request into `master`; wait for CI ("Build, lint and test") to pass.
2. If the change adds a database migration: follow [publication-metadata-release.md](../architecture/publication-metadata-release.md) as the model. In short: back up (note a Turso recovery point), run the executor in inspect-only mode, apply the pinned migration **after explicit authorization and before the code is deployed**, verify, then merge. Merging deploys.
3. Merge. Watch the Production deployment finish in Vercel (the GitHub commit status "Vercel" turns green).
4. Smoke test: `GET /api/health`, the page you changed, and a real sign-in.

## Rollback

Redeploy the previous deployment from the Vercel dashboard. Application rollback is safe across additive migrations: older code ignores columns it does not know. Removing columns is not a routine rollback (the executor refuses `DROP`); use point-in-time recovery only for a real data incident, and remember it discards every write after the recovery point.

## Known limitations

- Login and invitation rate limits are per function instance, not global.
- No external log aggregation: errors go to Vercel's function logs.
- No automated backups beyond what Turso provides.

Related: [database.md](database.md), [file-storage.md](file-storage.md), [`docs/architecture/phase26-deployment-readiness-infrastructure-hardening.md`](../architecture/phase26-deployment-readiness-infrastructure-hardening.md).
