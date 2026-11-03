# 05. Backend and API deep dive

The complete endpoint table (141 routes, with method, path and access rule for each) is generated from the code and lives in [../technical/api-reference.md](../technical/api-reference.md). This document explains how the backend behaves and what protects each area.

## Organisation
One Express app (`apps/server/src/app.ts`), routes in `apps/server/src/routes/<resource>.routes.ts`, mounted in `routes/index.ts`. Shared validation in `packages/shared/src/schemas/*.ts`. Business helpers in `apps/server/src/lib/`. Authorization guards in `middleware/auth.ts`. Errors are thrown as `HttpError`/`ValidationError` and rendered once (`app.ts:52-82`).

## Cross-cutting controls (VERIFIED)
| Control | Evidence |
|---|---|
| JSON body limit 100 kb | `app.ts:15, 26` |
| Upload size caps and single file per request | `lib/fileService.ts:19-32` |
| Zod validation of bodies and query strings | `parseOrThrow` in every route; pagination caps in `packages/shared/src/schemas/*.ts` (search 50, resources 50, forum topics 50, comments 100, gallery 60, admin 100) |
| `Cache-Control: no-store` for API responses; `Vary: Cookie` on visibility-dependent GETs | `app.ts:42-47`, `middleware/auth.ts:38` |
| Audit log on administrative and content actions | `lib/audit.ts` (field names, not long text) |
| Duplicate protection with a write lock | `lib/duplicates.ts:36` |
| Conflict mapping (constraint races to 409, lock contention to 503) | `lib/dbErrors.ts:113-130` |
| Generic 500 for unexpected errors (no stack in the response) | `app.ts:81-82` |

## Endpoint groups: what they do and how they are protected
| Group | Notable rules (VERIFIED) | Sensitive-data or abuse notes |
|---|---|---|
| **Auth** `/api/auth/*` | login (uniform error, timing equalised, rate limited), logout, password change (current password required, session regenerated) | login limiter is in memory per instance (F-03) |
| **Users and invitations** `/api/users`, `/api/invitations` | `router.use(requireCan(canManageUsers))` (`users.routes.ts:19`); invitations admin-only except token lookup/accept | `POST /api/users` can create an account with a chosen password (API only; the dashboard uses invitations); responses omit password hashes |
| **Team, member, alumni** | owner or manager may edit; category and sort order manager-only; alumni admin-only; unpublished profiles answer 404 | write lock before reads in edits (`team.routes.ts:122-135`) |
| **Publications, news, research areas** | any member creates and edits; manager deletes and sets visibility; duplicate guard | public by default |
| **Projects, groups** | create/delete manager; edit manager or lead (`requireEditor`) | |
| **Events, knowledge, resources, gallery** | owner or manager edits; visibility manager-only; default lab-only | gallery appends are authorised before the body is buffered (`gallery.routes.ts:211-225`) |
| **Files** | upload any member; read via `GET /api/files/:id` with a visibility check; delete owner or manager | see doc 09 |
| **Forum** | public categories readable; writing requires sign-in; edit text author-only; moderation manager | plain text only |
| **Messages, notifications** | only conversation participants (404 for others, `messages.routes.ts:28-37`) | no administrator can read messages |
| **Search** | visibility-filtered; limit 50; SQL `LIKE` | |
| **Workspace** | signed-in, own data | |
| **Admin** `/api/admin/*` | `router.use(requireCan(canAccessAdmin))` (`admin.routes.ts:66`); audit rows hide account and alumni events from managers | |
| **Translations** | read requires sign-in; edit manager | |
| **Sitemap/robots/health** | public; sitemap needs `PUBLIC_BASE_URL`; health is shallow (does not touch the database) | |
| **Google OAuth** | see doc 06 | |

## Endpoints that could expose data or permit unauthorized actions (reviewed)
- `GET /api/files/:id`: uses `canAccessFile`; unauthorised answers 404 (not 403). VERIFIED (`files.routes.ts:82-110`).
- `GET /api/team/:id`, `/api/member/:id`, `/api/alumni`: filtered by `publishedMemberWhere` (`lib/memberVisibility.ts:23`). VERIFIED.
- `GET /api/translations/:entityType/:entityId` is `requireAuth` only; handler-level visibility not re-read in this audit. **PARTIALLY VERIFIED**.
- `PUT /api/publications/:id` and similar "any member edits any record": by design, not an IDOR (documented policy `canEditContent = isMember`), but it means any member can alter any publication. A governance risk, not a code bug.
- `POST /api/users`: powerful and password-bearing, admin only. VERIFIED.
- No endpoint was found that returns `passwordHash`, invitation raw tokens (only at creation, once), or session data. Serializers (`lib/serializers.ts`) select fields explicitly (**PARTIALLY VERIFIED**, spot-checked, not every serializer).

## Frontend hiding versus backend enforcement
Every sensitive route uses `requireCan`, `requireAuth` plus an owner check, or a router-level guard. The UI guards are cosmetic. Verified by reading the guards for admin, users, invitations, team, files, gallery, messages and the alumni routes, and by the existing HTTP regression suites (doc 11).
