# 22. Audit evidence and methodology

## Audited state
| Item | Value |
|---|---|
| Repository | `ShahRiarKhan55/smart-computing-lab-new` |
| Commit audited | `855272c12d92fd5661f8799738b26955856f5146` (HEAD) |
| Branch at audit time | `feat/research-link-brand-icons` (PR #27 head, already merged) |
| `origin/master` | `2123ea3f57995d2a4627a9335c33328e397219d6`, a merge commit whose content equals the audited commit (`git merge-base --is-ancestor` confirmed the audited commit is in master) |
| Working tree before the audit | clean (0 changed files) |
| Date | 2026-11-03 |
| Changes made by the audit | only new, **untracked** Markdown files in `docs/presentation-readiness/` (23 files including this one). Nothing was staged or committed |

## Files and directories inspected
`apps/server/src/` (app, middleware, lib, all route modules by guard and selected handlers), `apps/server/prisma/` (schema, migration list, seed), `apps/server/scripts/` (test script list, CI-related), `apps/web/src/` (App, auth, hooks, lib, i18n, components, pages, styles, docs rendering), `apps/web/index.html`, `packages/shared/src/` (permissions, schemas, redirect, i18n), `api/index.ts`, `vercel.json`, `.github/workflows/ci.yml`, `package.json` files, `.env.example` (names only), `docs/` (guides, technical, architecture records sampled). Route table: `docs/technical/api-reference.md` (141 routes).

## Commands executed (all read-only or non-production)
- `git` status, rev-parse, fetch, log, ls-tree, diff on the local clone.
- `grep`, `sed`, `cat`, `wc`, `ls`, small Python scripts to count and extract (routes, relations for the ERD, bundle sizes); output kept outside the repository.
- **Live, read-only:** `curl -I` of `https://smartcomputinglab.vercel.app/` and `/api/health` to read response headers; one GET of `/api/health` and `/api/alumni` earlier in the engagement. No logins, no mutations, no probing of other paths.
- `npm audit --json` (reads the lockfile and queries the advisory service; changes no files).
- `npm run test:unit -w apps/server` with `DATABASE_URL` pointing to a temporary file in the scratchpad, no `TURSO_*` or `MIGRATE_TARGET_*` variables set (checked by name). Result: exit 0; 37 suite summaries printed, all with 0 failures. The temporary database was deleted.
- GitHub API reads (branch list, workflow runs, deployments, commit statuses) earlier in the engagement; the branch list reported `master` as not protected.

## Tests executed in this audit
Only the unit chain (above). The following were executed **earlier in this engagement on the same source tree** and are cited as evidence but were not re-run here: `test:alumni` 194, `test:duplicates` 123, `test:publication-metadata` 54, `test:research-links` 60, `test:research-links-ui` 39, `test:alumni-ui` 29, `build` and `lint`.

## Areas that could not be inspected
Vercel project settings and environment variable scoping; Turso configuration, backup retention, region and access tokens; Vercel Blob settings; GitHub repository settings beyond the branch list; production data; actual runtime behavior under load; real Google OAuth; real browser enforcement of the page CSP; behavior of the production Vercel platform limits; screen-reader behavior. These are marked **Unknown** where relevant.

## Assumptions and uncertainties
- Route guards were classified from `router.use(...)` and per-route middleware, not by executing every route.
- "Verified" for headers means observed on 2026-11-03 and may change with platform updates.
- Severity ratings are judgments for a small university lab, not CVSS scores.
- Capacity statements are architectural reasoning, not measurements.
- The original design rationale is documented only in phase records; "why" answers are labelled Recorded or Assessment (doc 16).
- The npm advisory list may change daily.

## Documentation versus implementation discrepancies
Where documentation disagrees with the code, the code was trusted.

| # | Documentation says | Code and live behavior | Action |
|---|---|---|---|
| 1 | `docs/technical/authentication-and-authorization.md` ("Security headers") and the maintainer guide say the API sets a Content-Security-Policy for the single-origin app | The API explicitly disables CSP (`apps/server/src/lib/security.ts`); the only CSP is a `<meta>` tag in `apps/web/index.html:29-30`; the live site sends no CSP header | correct those documents |
| 2 | `docs/technical/file-storage.md` states uploaded images have metadata stripped | Only profile photos are sanitised (`profile.routes.ts:128`); gallery and generic uploads are stored as received | correct the document or sanitise all images (F-05) |
| 3 | `lib/security.ts` comment lists `X-Frame-Options: DENY` | live API header is `SAMEORIGIN` (Helmet's default) | fix the comment |
| 4 | `apps/web/src/lib/api.ts` comment says the backend serves the built frontend | Vercel serves the static SPA; the API is a separate function | fix the comment |
| 5 | Guides tell members they may paste an external photo URL | the page CSP allows images only from the site itself and `data:`; external photos likely will not render (not browser-tested) | verify and adjust the guide or the CSP |
| 6 | `docs/architecture/phase3b-alumni-directory.md` describes a separate Alumni page | now a section of the Team page | annotated earlier; no further action |
| 7 | CI documentation lists a unit file count (32) | the unit chain now has about 38 files | refresh the number |

No other contradictions were found in the sections read. The two substantive overstatements (items 1 and 2) were written earlier in this same engagement; they are reported here rather than silently edited because this audit is read-only.

## Safety confirmation
1. **No application source code was changed.** Verified by `git status`: only untracked files under `docs/presentation-readiness/` exist.
2. **No database or migration was changed or executed.** No migration, seed or database command was run; the unit chain used a disposable file that was deleted.
3. **No environment variables, credentials or deployment settings were changed** or printed; only variable names were inspected.
4. **No commits, pushes, pull requests, merges or deployments** were made during the audit.
5. **No secrets or personal data** are in the reports (the seed credential, session secrets, tokens, database URLs and user emails are not reproduced; a final pattern scan was run).
6. Claims are labelled Verified, Partially verified, Documented only, Not implemented or Unknown; uncertainties are stated.

## Files created
`docs/presentation-readiness/`: `README.md`, `01-project-overview.md`, `02-technology-stack.md`, `03-system-architecture.md`, `04-frontend.md`, `05-backend-and-api.md`, `06-authentication-and-authorization.md`, `07-security-audit.md`, `08-database-architecture.md`, `09-file-storage.md`, `10-deployment-and-devops.md`, `11-testing-and-quality.md`, `12-failure-scenarios.md`, `13-performance-and-scalability.md`, `14-privacy-and-compliance.md`, `15-accessibility-and-i18n.md`, `16-technical-decisions.md`, `17-limitations-and-roadmap.md`, `18-presentation-qa.md`, `19-live-demo-guide.md`, `20-executive-summary.md`, `21-quick-reference.md`, `22-audit-evidence-and-methodology.md`.
