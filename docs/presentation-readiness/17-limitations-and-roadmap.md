# 17. Limitations and roadmap

| # | Limitation | Practical consequence | Realistic improvement | Priority |
|---|---|---|---|---|
| 1 | No MFA (F-06) | one phished admin is a full compromise | TOTP or passkeys for managers and administrators | High |
| 2 | No password reset or email | locked-out users need an admin and a new invitation | email service plus reset flow | Medium |
| 3 | Sessions cannot be revoked per user (F-02) | stolen session survives password change | `userId` on `Session`; revoke on password, role, delete | High |
| 4 | Login limits per instance, in memory (F-03) | weak against distributed guessing | shared store; per-account counters | Medium |
| 5 | SPA lacks frame and header protections (F-04) | clickjacking possible | `headers` in `vercel.json` | Medium |
| 6 | Gallery images keep EXIF (F-05) | location leaks | sanitise on every image upload | Medium |
| 7 | No malware scan (F-11) | risky PDFs | scan or restrict PDF uploads | Low |
| 8 | No automated backups or restore drill (F-17) | recovery time and success unknown | scheduled exports, tested restore, runbook | **High** |
| 9 | No monitoring, alerts, structured logs (F-16) | outages noticed by users | uptime check with DB probe, error tracker, log retention | High |
| 10 | `master` unprotected, CI not required (F-07) | unreviewed or red code can ship | branch protection, required checks, reviews | High |
| 11 | Dependency advisories (F-08) | potential DoS and dev-tool issues | scheduled updates, Dependabot, `npm audit` in CI | Medium |
| 12 | Default admin credential in the seed (F-01) | known-credential admin if seed ran on production | check production now; harden seed | **Check now** |
| 13 | Preview/production data isolation unknown (F-22) | previews may touch production data | separate Turso database for Preview | Medium |
| 14 | No optimistic concurrency (F-15) | silent overwrites | `updatedAt` precondition | Low |
| 15 | Unpaginated lists, LIKE search (F-13) | growth limits | pagination, FTS | Low now |
| 16 | No privacy notice, retention, export, consent record (doc 14) | institutional questions unanswered | privacy page, retention rules, consent log | High for a university |
| 17 | Platform body cap vs configured upload limits (F-12) | large uploads fail | direct-to-storage uploads or lower limits | Low |
| 18 | English-only fragments; Help pages overflow on phones | uneven bilingual/mobile experience | translate skip link, fix docs tables | Low |
| 19 | No dark theme, no automated accessibility tests | limited accessibility assurance | axe in CI, contrast audit | Medium |
| 20 | Custom test scripts, no coverage measurement | confidence is bounded | adopt a runner, coverage reports, more browser tests in CI | Medium |
| 21 | Browser tests need Playwright installed separately; excluded from CI | regressions in UI can slip | add a CI job with a browser | Medium |
| 22 | In-app Help is generated and must be re-rendered | stale guides if forgotten | CI check that generated files match sources | Low |
| 23 | Single hosting vendor and region; Blob vendor lock-in | outage or exit is hard | exit runbook; portable storage layer | Low |
| 24 | Any member can edit any publication/news/area (F-18) | accidental or malicious edits | restrict edit to owner or manager, or add review states | Decide |
| 25 | Contact form is a placeholder | visitors may think messages are sent | connect an email service or remove the form (the page already warns) | Medium |

## Partly implemented or inconsistent features
Publication status is stored and shown but not filterable; month is not used for ordering; Google sign-in works only for linked accounts and needs three variables (optional); documentation previously overstated header and metadata protections (doc 22); the Alumni design record describes a page that no longer exists (annotated).

## Suggested roadmap
1. **This week:** check the seed account (F-01); protect `master`; confirm Turso backup retention and do one restore rehearsal; confirm Preview database isolation.
2. **This month:** security headers in `vercel.json`; sanitise gallery uploads; session revocation and absolute session lifetime; dependency updates; uptime monitor with a database probe.
3. **This quarter:** MFA for admins; email service and password reset; privacy notice and retention rules; shared rate limiting; accessibility automation; load test on a copy.
4. **Later:** pagination and search improvements, optimistic concurrency, storage exit plan, SSR or static generation for public pages.
