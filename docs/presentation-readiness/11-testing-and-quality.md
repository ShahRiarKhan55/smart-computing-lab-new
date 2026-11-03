# 11. Testing and quality

## What exists
There is **no test framework** (no Jest, Vitest or Mocha) and **no coverage tool**. Tests are custom `tsx` and Node scripts in `apps/server/scripts/` (56 npm scripts in `apps/server/package.json`, 43 of them `test:*`). Coverage percentage is **not measured**; do not claim any.

| Layer | Commands | What it proves | What it does not prove |
|---|---|---|---|
| **Unit chain** | `npm run test:unit -w apps/server` (~38 files) | pure logic: policy matrix (385 checks), Zod schemas, image sanitiser (294), executor (222), research links (351), i18n parity (59), sitemap, session secret, trust-proxy, search, SEO | not behavior of the running server or database |
| **Database/HTTP regression** (disposable SQLite, real Express app) | `test:alumni` (194), `test:duplicates` (123), `test:publication-metadata` (54), `test:research-links` (60), `test:profile-photo` (221), `test:turso-shape` (32), `test:publication-race` (22), `test:integration-photos-alumni` (86), plus `test:api`, `test:admin`, `test:forum`, `test:files`, `test:gallery`, … | authorization and visibility rules over real HTTP (guests, members, managers, admins), duplicate and race handling, alumni consent rules | production database behavior, Turso latency, platform limits, malicious-input fuzzing |
| **Browser** (Playwright, not a repo dependency) | `test:alumni-ui` (29), `test:research-links-ui` (39), `test:profile-photo-ui`, `test:ui-a11y`, `browser-regression.cjs` (about 23,000 checks, long) | rendering, keyboard focus, layouts at 320/375/1280 px, English and Japanese | cross-browser (Chromium only), screen readers, real devices |
| **Static** | `npm run build` (TypeScript incl. web `tsc -b`), `npm run lint -w apps/web` (oxlint) | type correctness; 0 lint errors, 15 warnings baseline | logic correctness |

Results from this audit (2026-11-03, disposable databases, no Turso variables): `npm run test:unit -w apps/server` exited 0 with all 37 reported suites passing (list in the run log summarised in doc 22). Build, lint and the database/browser suites were run earlier in this engagement against the same source tree (`research-links-ui` 39/39, `alumni-ui` 29/29, `test:alumni` 194, `test:duplicates` 123, `test:publication-metadata` 54); they were **not re-run** in this read-only audit.

## CI
Runs: build, lint, unit chain and nine database suites (`test:alumni`, `test:publication-race`, `test:transaction-client`, `test:turso-shape`, `test:integration-photos-alumni`, `test:profile-photo`, `test:research-links`, `test:duplicates`, `test:publication-metadata`). Excluded on purpose (`docs/architecture/ci-quality-gate.md`): browser sweep, `test:gallery`, the other HTTP suites. Not a required check (F-07).

## Known flakiness and warnings
- `test:gallery`: documented intermittent commit-time timeout (2 of 22 runs); excluded from CI.
- "production startup with both Turso variables actually starts listening" in `unit-trust-proxy-startup` failed once on a CI run during this engagement and passed on rerun (timing).
- `research-links-ui` popup check has a 1.5 s wait and failed once, passing on rerun.
- Lint: 15 `set-state-in-effect`/ref warnings (React Compiler hints), unchanged baseline.
- `npm audit`: 14 advisories (F-08).

## Important untested areas
Real Turso behavior under load; Vercel limits; Blob; Google OAuth against real Google (injected provider in tests); email-based flows (none exist); disaster recovery and restore drills; automated accessibility scanning (no axe); cross-browser; penetration and dependency-exploit testing; load testing; mobile devices.

## Security testing gaps
No SAST, DAST, secret scanning, dependency scanning in CI (Dependabot or similar not found in the repository), no fuzzing, no authenticated scan. Authorization is tested by role-based HTTP regressions, which is useful but not exhaustive: passing tests show tested paths behave; they do not prove absence of vulnerabilities.
