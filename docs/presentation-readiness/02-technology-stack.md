# 02. Technology stack

Only technologies actually present are listed. Versions are the declared ranges in `package.json` files (`apps/server`, `apps/web`, `packages/shared`, root); exact installed versions are in `package-lock.json`.

| Technology | Kind | What it does here | Why (assessment) | Advantages | Limitations |
|---|---|---|---|---|---|
| **TypeScript** 5.6 (server, shared), 6.0 (web) | dev dependency (compiler) | one language across web, API, shared rules | shared types and policy code between UI and API | catches errors at build time; one language | compile step; strictness varies (web tsconfig is non-strict, noted in `ProtectedRoute.tsx`) |
| **React** 19 + **react-dom** | direct (web) | component UI | standard, large ecosystem | composable UI, accessibility tooling | client-rendered only (no SSR): first paint after JS loads |
| **react-router-dom** 6.30 | direct (web) | client-side routing, route guards | de facto router | simple | `npm audit` reports a moderate advisory (see F-12) |
| **Vite** 8 + `@vitejs/plugin-react` | dev dependency | dev server and production build, code splitting | fast builds | lazy chunks, dev proxy to the API | `npm audit` reports high advisories for the dev server only |
| **oxlint** | dev dependency | linter (`npm run lint -w apps/web`) | fast | 0 errors; 15 warnings baseline | fewer rules than ESLint |
| **Plain CSS** (`apps/web/src/styles/*.css`, tokens) | project code | all styling | no UI library | small, no dependency | no component library: accessibility and consistency are hand-maintained |
| **Express** 4.21 | direct (server) | HTTP API under `/api` | mature, simple | easy middleware model | Express 4 (not 5); transitive `body-parser`/`qs` advisories reported |
| **Helmet** 8 | direct | security headers on API responses | standard | cheap hardening | CSP deliberately disabled on the API (`lib/security.ts`) |
| **express-session** + custom `PrismaSessionStore` | direct + project code | server-side sessions, cookie `scl.sid` | avoids a second native database driver | revocable server state | no per-user index (cannot list or revoke a user's sessions) |
| **bcryptjs** 2.4 | direct | password hashing (cost 10) | pure JS, works on serverless | no native build | slower than native bcrypt; cost 10 is modest |
| **zod** 3.23 | direct (server, shared) | request validation, shared schemas | one schema for UI and API | typed validation | `npm audit` reports a high advisory (large constrained collections) |
| **multer** 2.4 | direct | multipart upload parsing (memory storage) | standard | simple | in memory (bounded by size caps); `npm audit` high advisory (DoS) |
| **Prisma** 5.22 (`@prisma/client`, `prisma`) | direct + dev | ORM, migrations, types | typed queries, parameterised SQL | prevents most injection; migration files | native query engine adds size; Turso needs the driver adapter |
| **SQLite** (local) / **Turso (libSQL)** (production) | database / external service | relational storage | SQL with joins and constraints; cheap hosted libSQL | transactions, constraints, simple local dev | single-writer semantics; remote HTTP latency; PITR depends on Turso plan |
| **@libsql/client**, **@prisma/adapter-libsql** | direct | connect Prisma to Turso | required for Turso | | adapter is a preview Prisma feature (`driverAdapters`) |
| **@vercel/blob** 2.8 | direct + external service | private object storage for uploads in production | serverless has no persistent disk | no storage server to run | vendor lock-in; `npm audit` high advisory via OIDC chain |
| **google-auth-library** 10.9.1 | direct | Google OAuth code exchange and ID-token verification | maintained Google library | correct token validation | optional feature |
| **dotenv** | direct | loads `apps/server/.env` locally | | | |
| **marked** | dev dependency | renders `docs/user-guide` Markdown to HTML at build time | no Markdown parser shipped to browsers | | generated files must be committed |
| **tsx** | dev dependency | runs TypeScript scripts and tests | | | |
| **concurrently** | dev dependency | runs API and web together locally | | | `npm audit` critical advisory in a transitive dev dependency (`shell-quote`), dev only |
| **Vercel** | external service | hosts the SPA and one serverless function; Git integration | zero-ops hosting | previews per branch, instant rollback (platform feature) | cold starts, request body cap 4.5 MB, per-instance memory for rate limits |
| **GitHub + GitHub Actions** | external service | source, one CI workflow | | least-privilege workflow | workflow is not marked as required (branch protection absent) |
| **Google Calendar embed** | external service | `/schedule` iframe | | | allowed by CSP `frame-src https://calendar.google.com` |
| **Google Fonts** | external service | web fonts | | | third-party request from every visitor (privacy note, doc 14) |
| **Playwright** (not a repository dependency) | optional dev tool | browser tests when installed | | | tests exit if missing; not run in CI |

## Not present (so do not claim them)
No GraphQL, no WebSockets, no Redis or other cache, no job queue, no email service (so no password reset or notifications by email), no payment provider, no analytics or ads, no CDN configuration of its own beyond Vercel's, no Docker, no Sentry or other error monitoring, no test framework such as Jest or Vitest (tests are custom `tsx` scripts), no coverage tool, no UI component library, no state-management library, no form library.

## Language and tooling summary
TypeScript everywhere. npm workspaces monorepo. Node 22 in CI (`.github/workflows/ci.yml:33`). Package manager npm with a committed lockfile. Internationalisation: a home-grown typed dictionary (`packages/shared/src/i18n/en.ts`, `ja.ts`).

## Dependency versus service
Direct runtime dependencies are listed above (server: express, express-session, bcryptjs, zod, multer, helmet, prisma client, libsql, vercel blob, google-auth-library, dotenv; web: react, react-dom, react-router-dom). External services: Vercel, Turso, Vercel Blob, GitHub, Google (OAuth, Calendar, Fonts).
