# CI quality gate (Stage 4, workstream 1)

`.github/workflows/ci.yml` runs on every pull request and on pushes to `master`. It exists so that the checks a release depends on no longer rely
on someone remembering to run them. It does **not** deploy, does not use any secret, and cannot reach Production.

## What it runs (one job, about two minutes)
| Step | Command | Why it is safe in CI |
|---|---|---|
| Install | `npm ci` | committed lockfile |
| Build | `npm run build` (shared, server, web) | no environment needed |
| Lint | `npm run lint -w apps/web` | fails on errors only; baseline when added: **15 warnings, 0 errors** |
| Test database | `migrate:deploy` and `seed` on `file:./dev.db` | a throwaway SQLite file inside the runner workspace (gitignored) |
| Unit tests | `npm run test:unit -w apps/server` | 31 files; one of them copies the seeded `dev.db`, which is why the step above exists |
| Fast database suites | `test:alumni`, `test:publication-race`, `test:transaction-client`, `test:turso-shape`, `test:integration-photos-alumni`, `test:profile-photo` | each uses a disposable local copy or an in-memory libSQL client, and each either refuses to run with `TURSO_*` set or clears it for its own server; 12 of 12 runs passed in 1-3 s |

Node 22 is used. The repository pins no Node version; Vite 8 and oxlint require `^20.19.0 || >=22.12.0` and the server types target 22.

## Deliberately excluded
* **Browser sweep** (`browser-regression.cjs`, 23,275 checks): needs a browser and runs for a long time. It also has a known stale expectation (`/news` is under Community in `navConfig.ts`; the sweep expects Research).
* **`test:gallery`**: documented intermittent failure (commit-time timeout, 2 of 22 default-config runs).
* **The other HTTP regression suites** (`test:api`, `test:forum`, ...): not yet timed or checked for reliability in CI. Add them in a follow-up once measured.
* **Anything remote**: Turso, Vercel, Blob. Remote verification stays a manual, authorized step (`phase3-release-runbook.md`).

## Rules for changing this workflow
* Keep `permissions: contents: read`. Never use `pull_request_target`. Never reference `secrets.*`; no job here may receive a database or deployment credential.
* Pin every third-party action to a full commit SHA and name the version in a comment.
* Add a check only after it has been run repeatedly in a clean environment and its runtime is known.

## Rollback
Delete `.github/workflows/ci.yml` (or revert the commit). It has no runtime effect on the application, the database or Production. Making the check *required*
is a separate repository-protection decision.
