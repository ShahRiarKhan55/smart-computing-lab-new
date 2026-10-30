# Testing

There are three layers. All commands run from the repository root; `-w apps/server` selects the server workspace.

| Layer | What it is | Examples |
|---|---|---|
| Unit tests | pure TypeScript, no server or database | `npm run test:unit -w apps/server` (a chain of about 38 suites: policy matrix, search, i18n, executor, publication metadata, alumni, sitemap, …) |
| Database / HTTP regression suites | build a disposable SQLite database, usually start the real API against it and call it over HTTP | `test:alumni`, `test:duplicates`, `test:publication-metadata`, `test:research-links`, `test:api`, `test:admin`, `test:forum`, `test:files`, `test:gallery`, … (43 `test:*` scripts in `apps/server/package.json`) |
| Browser tests | Chromium via Playwright (or raw CDP for `browser-regression.cjs`) against a real API and Vite server | `test:alumni-ui`, `test:research-links-ui`, `test:profile-photo-ui`, `test:ui-a11y` |

## What CI runs

`.github/workflows/ci.yml` runs on every pull request to `master` and every push to `master` (Node 22, one job "Build, lint and test"):

1. `npm ci`
2. `npm run build`
3. `npm run lint -w apps/web` (fails only on errors; the baseline has 15 warnings)
4. create an isolated test database (`migrate:deploy` and `seed`, with `DATABASE_URL="file:./dev.db"`)
5. `npm run test:unit -w apps/server`
6. "Fast database suites": `test:alumni`, `test:publication-race`, `test:transaction-client`, `test:turso-shape`, `test:integration-photos-alumni`, `test:profile-photo`, `test:research-links`, `test:duplicates`, `test:publication-metadata`

The browser sweeps and the heavier HTTP suites are **not** in CI (they need a browser or a running server); run them locally before a risky change. Rationale: [`docs/architecture/ci-quality-gate.md`](../architecture/ci-quality-gate.md).

## Running tests locally (PowerShell)

```powershell
Remove-Item Env:TURSO_DATABASE_URL, Env:TURSO_AUTH_TOKEN -ErrorAction SilentlyContinue
$env:DATABASE_URL = "file:./dev.db"
$env:SESSION_SECRET = "local-test-secret-0123456789abcdef"
npm run build
npm run test:unit -w apps/server
npm run test:alumni -w apps/server
npm run test:publication-metadata -w apps/server
```

Suites that start a server and need proxy headers (for example `test:api`) require `TRUST_PROXY=1`.

Every database suite uses a disposable SQLite file; none should touch a hosted database. Never run them with Turso credentials in your environment.

## What the authorization tests cover

- `unit-policy.test.ts`: the permission functions across roles (the matrix in [role-permissions.md](role-permissions.md)).
- `alumni-regression.mjs`, `integration-photos-alumni-regression.ts`: unpublished alumni are invisible to guests, members and managers, visible to administrators; publish and unpublish take effect on the next request; alumni cannot have accounts.
- `publication-metadata-regression.ts`: create, update (omitted fields stay unchanged), validation and read of the eight metadata fields; no change to visibility or duplicate rules.
- `duplicate-prevention-regression.ts`: duplicate DOI and title-and-year protection, including the manager override.
- `admin-regression`, `invitations`, `api-regression`: admin dashboard access, invitation lifecycle, session and rate-limit behavior.

## Documentation checks

`npm run docs:render -w apps/server` renders `docs/user-guide` to HTML and fails if English and Japanese define different sets of guides. There is no Markdown linter configured; relative links are checked by the script described in [documentation-audit.md](../documentation-audit.md).
