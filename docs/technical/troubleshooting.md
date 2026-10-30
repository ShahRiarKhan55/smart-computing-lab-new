# Troubleshooting

## Symptoms on the site

| Symptom | Likely cause | What to do |
|---|---|---|
| Publication pages, or pages that list publications (home, projects, members, workspace), show an error; the API log says `The column main.Publication.status does not exist` | The new code is deployed but the database migration `20261030120000_publication_metadata_fields` has not been applied | Apply the migration with the Turso executor, see [database.md](database.md). Do not upload or replace the database. |
| Any page fails with "no such column" after a deploy | A newer migration is pinned in the code but not applied | Inspect with `npm run migrate:turso -w apps/server -- --expect-target <host>`; apply the missing reviewed migration |
| `403 Forbidden` on an action | Signed in, but the role is not allowed | Check [role-permissions.md](role-permissions.md). Alumni management and account management are administrator-only. |
| `401` or redirect to the login page | Not signed in, or the session expired (one week without activity) | Sign in again |
| "A profile with a login account can't be moved to Alumni" (409) | The profile is linked to an account | An administrator unlinks the account first (People & Accounts), then moves the profile |
| "Alumni profiles can't have a login account" (409) | Tried to link or invite an alumni profile | Alumni never have accounts; use a non-alumni profile |
| Duplicate warning (409, `DUPLICATE_CANDIDATE`) when saving a publication, news item or research area | Same DOI, or the same title and year, already exists | Search for the existing record and edit it. A manager or administrator can confirm a title-and-year duplicate that is genuinely different; an identical DOI is always refused. |
| Uploads fail with 503 "File storage is not available right now" | No Blob token configured in this environment | Attach a private Vercel Blob store and set `LAB_BLOB_READ_WRITE_TOKEN` or `BLOB_READ_WRITE_TOKEN` |
| Upload rejected | Wrong type or too large (JPEG/PNG/WebP/GIF up to 5 MB, PDF up to 15 MB), animated image, or unreadable metadata | Use a standard still image |
| An invitation link says it is invalid or expired | Used already, revoked, or older than 7 days | An administrator revokes it and creates a new one |
| A user forgot their password | There is no self-service reset | An administrator deletes the old account and sends a new invitation (the person's team profile is kept) |
| The Alumni section is missing from the Team page | There are no published alumni (the section is hidden when empty); an administrator sees unpublished ones | Publish a profile as an administrator |
| Sitemap returns an error | `PUBLIC_BASE_URL` is not set | Set it to the public origin |

## Local development

| Symptom | Cause and fix |
|---|---|
| `Environment variable not found: DATABASE_URL` | Create `apps/server/.env` from `.env.example` |
| `no such table` | Run `npm run migrate:deploy -w apps/server` |
| Web app cannot reach the API | The API must run on port 4001 (`npm run dev` starts both); check `PORT` in `apps/server/.env` |
| Port already in use (5173 or 4001) | Stop the other process; browser test scripts refuse to start when these ports are busy |
| TypeScript cannot find `@scl/shared` exports | Rebuild it: `npm run build -w packages/shared` |
| A test seems to read production data | Turso variables are set in your shell. Remove them (see [development-setup.md](development-setup.md)) |
| Browser tests exit with "Playwright is not installed" | Install Playwright and Chromium; it is not a repository dependency |
| In-app guides do not show your Markdown edits | Run `npm run docs:render -w apps/server` and commit the regenerated files under `apps/web/src/docs/content/` |

## Where to look

- API errors: the browser's network tab shows the JSON `error` message; server errors are in Vercel's function logs (production) or the terminal (local).
- Who changed what: **Admin Dashboard → Audit log**.
- The API is healthy if `GET /api/health` returns `{"status":"ok"}`.
