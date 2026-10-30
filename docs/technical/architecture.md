# Architecture overview

Smart Computing Lab is a single-page web application with a JSON API, deployed to Vercel with a Turso database. This page describes what exists today. For the design history of each development phase, see [`docs/architecture/`](../architecture/).

## Components

| Component | Technology | Location |
|---|---|---|
| Web app (browser) | React, TypeScript, Vite, `react-router-dom`; client-side rendered only | `apps/web` |
| API | Express 4, TypeScript (ESM), mounted under `/api` | `apps/server` |
| Shared code | Zod schemas, the permission functions, the English and Japanese UI dictionary | `packages/shared` (built to `dist/`) |
| Database access | Prisma 5.22 (`provider = "sqlite"`) | `apps/server/prisma`, `apps/server/src/lib/prisma.ts` |
| Production database | Turso (hosted libSQL) via `@prisma/adapter-libsql` | selected when `TURSO_DATABASE_URL` is set |
| Local database | a SQLite file, `apps/server/prisma/dev.db` (git-ignored) | `DATABASE_URL="file:./dev.db"` |
| File storage | local disk in development, a **private** Vercel Blob store in production | see [file-storage.md](file-storage.md) |
| Serverless entry point | `api/index.ts` wraps the Express app for Vercel | `api/` |
| Hosting | Vercel (static SPA plus one serverless function) | `vercel.json` |

## Request flow

```
Browser ──► Vercel edge
              ├─ /api/*, /robots.txt, /sitemap.xml ──► api/index.ts (Express app)
              │                                         ├─ security headers, JSON body, session cookie
              │                                         ├─ route guard (optionalAuth / requireAuth / requireCan)
              │                                         └─ Prisma ──► Turso (production) or dev.db (local)
              └─ everything else ──────────────────► built SPA (index.html)
```

`vercel.json` defines the rewrites. In local development, Vite serves the SPA on port 5173 and proxies `/api` to the API on port 4001.

## Design rules that shape the code

- **The API is the security boundary.** The web app uses the same pure permission functions (`packages/shared/src/permissions.ts`) only to show or hide controls. See [authentication-and-authorization.md](authentication-and-authorization.md).
- **Visibility is filtered on the server.** Every read goes through a visibility filter; unpublished team profiles and lab-only records are never returned to viewers who may not see them.
- **Migrations are additive.** Production schema changes are applied deliberately with a reviewed executor, never automatically on deploy. See [database.md](database.md).
- **Two languages.** The UI dictionary has the same keys in English and Japanese (`packages/shared/src/i18n`); user content can carry Japanese overrides (the `Translation` table).
- **Audit log.** Administrative and content actions write to `AuditLog`, recording field names rather than long text values.

## Related

- [project-structure.md](project-structure.md), [database.md](database.md), [api-reference.md](api-reference.md), [deployment.md](deployment.md)
- Older design records: [`docs/architecture/phase8-platform-architecture.md`](../architecture/phase8-platform-architecture.md)
