# API reference

All endpoints are served under `/api` by the Express app in `apps/server/src/app.ts`, plus `GET /api/health`, `GET /robots.txt` and `GET /sitemap.xml` (the last two at the site root; the sitemap works only when `PUBLIC_BASE_URL` is set). Requests and responses are JSON. Request bodies are validated with the Zod schemas in `packages/shared/src/schemas/`.

This table was generated from the route declarations in `apps/server/src/routes/*.routes.ts` and the guards in `apps/server/src/middleware/auth.ts`. When you change a route, update this page. The permission rules behind each "Access" entry are in [role-permissions.md](role-permissions.md).

## Conventions

- **Authentication:** a session cookie named `scl.sid` (HttpOnly, SameSite=Lax, Secure in production). There are no API tokens.
- **Access column:** *Public (filtered by the viewer's visibility)* means the endpoint answers guests, but returns only what that viewer may see (`PUBLIC` records for guests, `LAB_ONLY` too for signed-in accounts, unpublished alumni only for administrators). *Signed in* means any account. "owner or manager" means the handler additionally checks that the caller owns the record or is a `LAB_MANAGER`/`ADMIN`.
- **Errors:** `400` validation, `401` not signed in, `403` signed in but not permitted, `404` not found or hidden from this viewer, `409` conflict. A `409` with code `DUPLICATE_CANDIDATE` is a duplicate warning (see [content-management/publications.md](../content-management/publications.md)); a manager or administrator may resend with `confirmDuplicate: true` where the warning is overridable. `503` is returned for transient database contention and when file storage is unavailable.
- **Caching:** every API response is `Cache-Control: no-store` unless a route sets its own (public files).
- **Rate limits:** login, password change and invitation endpoints are rate limited in memory per process.

## Endpoints

### Admin dashboard

| Method | Path | Access |
|---|---|---|
| GET | `/api/admin/overview` | LAB_MANAGER or ADMIN |
| GET | `/api/admin/content` | LAB_MANAGER or ADMIN |
| POST | `/api/admin/content/visibility` | LAB_MANAGER or ADMIN |
| GET | `/api/admin/content/:type/:id` | LAB_MANAGER or ADMIN |
| GET | `/api/admin/translations` | LAB_MANAGER or ADMIN |
| PUT | `/api/admin/translations/:entityType/:entityId` | LAB_MANAGER or ADMIN |
| GET | `/api/admin/audit` | LAB_MANAGER or ADMIN |
| GET | `/api/admin/community` | LAB_MANAGER or ADMIN |
| GET | `/api/admin/files` | LAB_MANAGER or ADMIN |

### Alumni

| Method | Path | Access |
|---|---|---|
| GET | `/api/alumni` | Public (filtered by the viewer's visibility) |

### Authentication

| Method | Path | Access |
|---|---|---|
| GET | `/api/auth/me` | Public (returns the session user, or none) |
| POST | `/api/auth/login` | Public (rate limited) |
| POST | `/api/auth/password` | Signed in |

### Events

| Method | Path | Access |
|---|---|---|
| GET | `/api/events` | Public (filtered by the viewer's visibility) |
| GET | `/api/events/:id` | Public (filtered by the viewer's visibility) |
| POST | `/api/events` | Signed in |
| PUT | `/api/events/:id` | Signed in; owner or manager |
| DELETE | `/api/events/:id` | Signed in; owner or manager |

### Files

| Method | Path | Access |
|---|---|---|
| POST | `/api/files` | Signed in |
| GET | `/api/files/:id` | Public (filtered by the viewer's visibility) |
| DELETE | `/api/files/:id` | Signed in; owner or manager |

### Forum

| Method | Path | Access |
|---|---|---|
| GET | `/api/forum/categories` | Public (filtered by the viewer's visibility) |
| GET | `/api/forum/categories/:slug` | Public (filtered by the viewer's visibility) |
| POST | `/api/forum/categories` | LAB_MANAGER or ADMIN |
| PUT | `/api/forum/categories/:id` | LAB_MANAGER or ADMIN |
| DELETE | `/api/forum/categories/:id` | LAB_MANAGER or ADMIN |
| GET | `/api/forum/posts` | Public (filtered by the viewer's visibility) |
| GET | `/api/forum/posts/:id` | Public (filtered by the viewer's visibility) |
| POST | `/api/forum/posts` | Signed in |
| PUT | `/api/forum/posts/:id` | Signed in; the topic's author |
| DELETE | `/api/forum/posts/:id` | Signed in; the topic's author, or LAB_MANAGER/ADMIN |
| POST | `/api/forum/posts/:id/pin` | LAB_MANAGER or ADMIN |
| POST | `/api/forum/posts/:id/unpin` | LAB_MANAGER or ADMIN |
| POST | `/api/forum/posts/:id/lock` | LAB_MANAGER or ADMIN |
| POST | `/api/forum/posts/:id/unlock` | LAB_MANAGER or ADMIN |
| POST | `/api/forum/posts/:id/hide` | LAB_MANAGER or ADMIN |
| POST | `/api/forum/posts/:id/unhide` | LAB_MANAGER or ADMIN |
| POST | `/api/forum/posts/:id/comments` | Signed in |
| PUT | `/api/forum/comments/:id` | Signed in; the comment's author |
| DELETE | `/api/forum/comments/:id` | Signed in; the comment's author, or LAB_MANAGER/ADMIN |
| POST | `/api/forum/posts/:id/reactions` | Signed in |
| DELETE | `/api/forum/posts/:id/reactions/:kind` | Signed in |
| POST | `/api/forum/comments/:id/reactions` | Signed in |
| DELETE | `/api/forum/comments/:id/reactions/:kind` | Signed in |

### Gallery

| Method | Path | Access |
|---|---|---|
| GET | `/api/gallery` | Public (filtered by the viewer's visibility) |
| GET | `/api/gallery/:id` | Public (filtered by the viewer's visibility) |
| POST | `/api/gallery` | Signed in |
| POST | `/api/gallery/:id/images` | Signed in |
| PUT | `/api/gallery/:id` | Signed in; owner or manager |
| DELETE | `/api/gallery/:id` | Signed in; owner or manager |

### Google sign-in (optional)

| Method | Path | Access |
|---|---|---|
| GET | `/api/auth/google/status` | Public (OAuth redirect flow) |
| GET | `/api/auth/google/start` | Public (OAuth redirect flow) |
| POST | `/api/auth/google/link/start` | Signed in |
| POST | `/api/auth/google/unlink` | Signed in |
| GET | `/api/auth/google/callback` | Public (OAuth redirect flow) |

### Research groups

| Method | Path | Access |
|---|---|---|
| GET | `/api/groups` | Public (filtered by the viewer's visibility) |
| GET | `/api/groups/:id` | Public (filtered by the viewer's visibility) |
| POST | `/api/groups` | LAB_MANAGER or ADMIN |
| PUT | `/api/groups/:id` | Signed in; group LEAD, or LAB_MANAGER/ADMIN |
| DELETE | `/api/groups/:id` | LAB_MANAGER or ADMIN |
| PUT | `/api/groups/:id/members` | Signed in; group LEAD, or LAB_MANAGER/ADMIN |

### Researcher invitations

| Method | Path | Access |
|---|---|---|
| GET | `/api/invitations` | ADMIN |
| POST | `/api/invitations` | ADMIN |
| DELETE | `/api/invitations/:id` | ADMIN |
| GET | `/api/invitations/token/:token` | Public (holder of the single-use token; rate limited) |
| POST | `/api/invitations/token/:token/accept` | Public (holder of the single-use token; rate limited) |

### Knowledge base

| Method | Path | Access |
|---|---|---|
| GET | `/api/knowledge` | Public (filtered by the viewer's visibility) |
| GET | `/api/knowledge/:id` | Public (filtered by the viewer's visibility) |
| POST | `/api/knowledge` | Signed in |
| PUT | `/api/knowledge/:id` | Signed in; owner or manager |
| DELETE | `/api/knowledge/:id` | Signed in; owner or manager |

### Member profile pages and history

| Method | Path | Access |
|---|---|---|
| GET | `/api/member/:id` | Public (filtered by the viewer's visibility) |
| POST | `/api/member/:id/history` | Signed in; the profile's own account, or LAB_MANAGER/ADMIN |
| PUT | `/api/member/:id/history/:entryId` | Signed in; the profile's own account, or LAB_MANAGER/ADMIN |
| DELETE | `/api/member/:id/history/:entryId` | Signed in; the profile's own account, or LAB_MANAGER/ADMIN |
| PUT | `/api/member/:id/publications` | Signed in; the profile's own account, or LAB_MANAGER/ADMIN |
| PUT | `/api/member/:id/news` | Signed in; the profile's own account, or LAB_MANAGER/ADMIN |
| PUT | `/api/member/:id/areas` | Signed in; the profile's own account, or LAB_MANAGER/ADMIN |

### Private messages

| Method | Path | Access |
|---|---|---|
| GET | `/api/messages/conversations` | Signed in |
| POST | `/api/messages/conversations` | Signed in |
| GET | `/api/messages/conversations/:id` | Signed in |
| PATCH | `/api/messages/conversations/:id/read` | Signed in |
| POST | `/api/messages/conversations/:id/messages` | Signed in |
| PUT | `/api/messages/messages/:id` | Signed in |
| DELETE | `/api/messages/messages/:id` | Signed in |

### News

| Method | Path | Access |
|---|---|---|
| GET | `/api/news` | Public (filtered by the viewer's visibility) |
| GET | `/api/news/:id` | Public (filtered by the viewer's visibility) |
| GET | `/api/news/:id/authors` | Public (filtered by the viewer's visibility) |
| PUT | `/api/news/:id/authors` | Signed in |
| POST | `/api/news` | Signed in |
| PUT | `/api/news/:id` | Signed in |
| DELETE | `/api/news/:id` | LAB_MANAGER or ADMIN |

### Notifications

| Method | Path | Access |
|---|---|---|
| GET | `/api/notifications` | Signed in |
| GET | `/api/notifications/unread-count` | Signed in |
| PATCH | `/api/notifications/:id/read` | Signed in |
| POST | `/api/notifications/read-all` | Signed in |

### Own profile

| Method | Path | Access |
|---|---|---|
| GET | `/api/profile` | Signed in (own profile) |
| PUT | `/api/profile` | Signed in (own profile) |
| POST | `/api/profile/photo` | Signed in (own profile) |

### Research projects

| Method | Path | Access |
|---|---|---|
| GET | `/api/projects` | Public (filtered by the viewer's visibility) |
| GET | `/api/projects/:id` | Public (filtered by the viewer's visibility) |
| POST | `/api/projects` | LAB_MANAGER or ADMIN |
| PUT | `/api/projects/:id` | Signed in; project LEAD, or LAB_MANAGER/ADMIN |
| DELETE | `/api/projects/:id` | LAB_MANAGER or ADMIN |
| PUT | `/api/projects/:id/members` | Signed in; project LEAD, or LAB_MANAGER/ADMIN |
| PUT | `/api/projects/:id/areas` | Signed in; project LEAD, or LAB_MANAGER/ADMIN |
| PUT | `/api/projects/:id/publications` | Signed in; project LEAD, or LAB_MANAGER/ADMIN |
| PUT | `/api/projects/:id/news` | Signed in; project LEAD, or LAB_MANAGER/ADMIN |

### Publications

| Method | Path | Access |
|---|---|---|
| GET | `/api/publications` | Public (filtered by the viewer's visibility) |
| GET | `/api/publications/browse` | Public (filtered by the viewer's visibility) |
| GET | `/api/publications/:id` | Public (filtered by the viewer's visibility) |
| GET | `/api/publications/:id/authors` | Public (filtered by the viewer's visibility) |
| PUT | `/api/publications/:id/authors` | Signed in |
| POST | `/api/publications` | Signed in |
| PUT | `/api/publications/:id` | Signed in |
| DELETE | `/api/publications/:id` | LAB_MANAGER or ADMIN |

### Research areas

| Method | Path | Access |
|---|---|---|
| GET | `/api/research` | Public (filtered by the viewer's visibility) |
| GET | `/api/research/:id` | Public (filtered by the viewer's visibility) |
| PUT | `/api/research/:id/researchers` | LAB_MANAGER or ADMIN |
| POST | `/api/research` | Signed in |
| PUT | `/api/research/:id` | Signed in |
| DELETE | `/api/research/:id` | LAB_MANAGER or ADMIN |

### Lab resources

| Method | Path | Access |
|---|---|---|
| GET | `/api/resources` | Public (filtered by the viewer's visibility) |
| GET | `/api/resources/:id` | Public (filtered by the viewer's visibility) |
| POST | `/api/resources` | Signed in |
| PUT | `/api/resources/:id` | Signed in; owner or manager |
| DELETE | `/api/resources/:id` | Signed in; owner or manager |

### Search

| Method | Path | Access |
|---|---|---|
| GET | `/api/search` | Public (filtered by the viewer's visibility) |

### Team

| Method | Path | Access |
|---|---|---|
| GET | `/api/team` | Public (filtered by the viewer's visibility) |
| GET | `/api/team/:id` | Public (filtered by the viewer's visibility) |
| POST | `/api/team` | LAB_MANAGER or ADMIN |
| PUT | `/api/team/:id` | Signed in; the profile's own account, or LAB_MANAGER/ADMIN |
| PUT | `/api/team/:id/publication` | ADMIN |
| DELETE | `/api/team/:id` | ADMIN |

### Translations

| Method | Path | Access |
|---|---|---|
| GET | `/api/translations/:entityType/:entityId` | Signed in |

### Accounts

| Method | Path | Access |
|---|---|---|
| GET | `/api/users` | ADMIN |
| POST | `/api/users` | ADMIN |
| PUT | `/api/users/:id` | ADMIN |
| PUT | `/api/users/:id/link` | ADMIN |
| DELETE | `/api/users/:id` | ADMIN |

### Workspace

| Method | Path | Access |
|---|---|---|
| GET | `/api/workspace` | Signed in |

### Other

| Method | Path | Access |
|---|---|---|
| GET | `/api/health` | Public (returns `{"status":"ok"}`) |
| GET | `/robots.txt`, `/sitemap.xml` | Public (sitemap requires `PUBLIC_BASE_URL`) |

## Notes on specific endpoints

- **`GET /api/alumni`** returns the alumni the caller may see: published alumni for everyone; an administrator also receives unpublished ones, each with `isPublished`. The web Team page loads this endpoint for its Alumni section. Alumni are not part of `GET /api/team`.
- **`PUT /api/team/:id/publication`** is the only way to publish or unpublish an alumni profile. Sending `isPublished` in a create or update body is rejected with `400`.
- **`POST /api/users`** can create an account with an administrator-chosen password. The admin dashboard does not use it; it offers invitations instead (`POST /api/invitations`), where the researcher chooses their own password.
- **`GET /api/auth/google/*`** routes exist only to link and sign in with an already-linked Google account. They are inactive unless the three `GOOGLE_OAUTH_*` variables are set.
- Route tables above list each route once; helper endpoints that are not registered with `asyncHandler` would not appear. If you find an undocumented route, add it.
