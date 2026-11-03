# 07. Security audit

Method: source review of authentication, authorization, upload, storage, headers and data access; one read-only `npm audit`; read-only `GET`/`HEAD` requests to the public production site to read response headers; existing test suites run locally against disposable databases. **No attack, exploit or access to real accounts was attempted.** "VERIFIED" means confirmed in code or a live header; it does not mean "proven secure". Severity reflects likelihood and impact for a university lab site, not a formal CVSS score.

## Summary table

| ID | Finding | Severity | Status | Immediate? |
|---|---|---|---|---|
| F-01 | Default administrator credential is fixed in `seed.ts` | High if the seed ever ran on production, otherwise Low | Verified in code; production state **Unknown** | **Yes: check** |
| F-02 | Other sessions survive a password change; no way to revoke a user's sessions | Medium | Verified | Soon |
| F-03 | Login throttling is in memory, per instance, per (IP, email) | Medium | Verified | Soon |
| F-04 | SPA pages carry no `X-Frame-Options` or CSP response header (clickjacking) | Low to Medium | Verified (live headers) | Soon |
| F-05 | Gallery and generic uploads keep image metadata (EXIF, GPS) | Medium (privacy) | Verified | Soon |
| F-06 | No MFA and no password reset; one compromised admin controls everything | Medium | Verified (not implemented) | Plan |
| F-07 | `master` is not branch-protected and CI is not a required check | Medium (process) | Verified (GitHub branch list) | Soon |
| F-08 | `npm audit`: 14 advisories (2 critical dev-only, 9 high, 3 moderate) | Medium to High (potential) | Verified report; exploitability **Unknown** | Soon |
| F-09 | No CSRF token (relies on SameSite=Lax, JSON bodies, no CORS) | Low | Verified design | Plan |
| F-10 | Public files cached for 1 hour after being made lab-only | Low | Verified | Plan |
| F-11 | No upload malware scanning; any member can upload PDFs | Low to Medium | Verified (not implemented) | Plan |
| F-12 | Upload limits (5 MB image, 15 MB PDF) exceed the platform request cap (4.5 MB) | Low (availability) | Partially verified | Plan |
| F-13 | Several list endpoints are not paginated | Low | Verified | Plan |
| F-14 | No per-user rate limits on content creation or uploads | Low | Verified | Plan |
| F-15 | Last write wins: no optimistic concurrency control | Low to Medium | Verified | Plan |
| F-16 | No monitoring, alerting or structured logs; health check is shallow | Medium (operational) | Verified | Plan |
| F-17 | No automated backups or tested restore in the repository | Medium (operational) | Verified (not implemented); Turso PITR **Unknown** | Plan |
| F-18 | Any member may edit any publication, news item or research area | Low (governance) | Verified, by design | Decide |
| F-19 | Stale `Session` rows and audit-log email snapshots remain after deletion | Low (privacy) | Verified | Plan |
| F-20 | Weak password policy (8 characters, no breach check) | Low | Verified | Plan |
| F-21 | CSP uses `style-src 'unsafe-inline'`; CSP is a `<meta>` tag only | Informational | Verified | Plan |
| F-22 | Production versus preview data isolation cannot be seen from the repository | Unknown | Unknown | **Check in Vercel** |
| F-23 | Request and database timeouts are not configured; the browser has no fetch timeout | Low | Verified | Plan |
| F-24 | A Content-Security-Policy `img-src 'self' data:` would block external profile photo URLs | Low (functional) | Partially verified | Plan |

## Findings in detail

### F-01. Fixed default administrator credential in the seed script
- **Where:** `apps/server/prisma/seed.ts:17-26` (an email and a password are literals; the value is not reproduced here).
- **Explanation:** the idempotent seed creates an `ADMIN` account with that fixed credential if it does not exist. The README, the maintainer guide and the technical docs warn to run it only locally, but nothing in code stops it running against a production database (it uses the application's own Prisma client, so with `TURSO_*` set it would target Turso).
- **Attack scenario:** if the seed was ever run against production, anyone who has read the repository can sign in as administrator.
- **Impact:** full takeover (accounts, roles, content, alumni).
- **Existing protection:** documentation warnings; CI runs it only on a throwaway file.
- **Mitigation:** (1) **now:** in the Admin Dashboard, People & Accounts, check whether an account with the seed's email exists; if it does, change the password or delete it and re-invite. (2) code: make the seed refuse when `NODE_ENV=production` or `TURSO_DATABASE_URL` is set, and take the password from an environment variable or generate one.
- **Immediate attention:** yes (a two-minute check).

### F-02. Other sessions are not revoked on password change
- **Where:** `routes/auth.routes.ts:98-103` regenerates only the current session; `schema.prisma:45-51` has no `userId` on `Session`; no code deletes sessions by user.
- **Scenario:** an attacker holds a stolen session cookie. The victim changes their password. The stolen session keeps working, and because sessions are rolling (`session.ts:41`), it can stay alive as long as it is used at least once a week.
- **Impact:** persistence after credential rotation. Deleted users and role changes are safe (re-read per request).
- **Mitigation:** add `userId` to the `Session` table, delete the user's other sessions on password change, role change and account deletion; add an absolute session lifetime.

### F-03. Login throttling is weak in a serverless deployment
- **Where:** `lib/loginRateLimit.ts:20-21` (10 failures, 15 minutes, per `ip|email`, an in-memory `Map`).
- **Scenario:** an attacker spreads guesses over many IPs or hits different function instances; each gets a fresh counter. Credential stuffing against many emails is not limited globally.
- **Existing protection:** bcrypt cost 10, uniform error, timing equalisation, invite-only accounts (small attack surface), password minimum.
- **Mitigation:** shared store (database table) with per-account and per-IP counters, progressive delays, and alerting; consider MFA for administrators.

### F-04. Clickjacking protection missing on the single-page app
- **Where:** live `HEAD /` returns only `cache-control`, `server`, `strict-transport-security` (no `x-frame-options`, no `content-security-policy`, no `x-content-type-options`); `vercel.json` defines no `headers`. `apps/web/index.html:29-30` has a CSP `<meta>` tag, which cannot set `frame-ancestors`. API responses do have `x-frame-options: SAMEORIGIN` (live check of `/api/health`).
- **Scenario:** a hostile page frames the site and tricks a signed-in administrator into clicking (for example Publish or Delete).
- **Impact:** UI-redress actions that require a click; state changes still need the user's session.
- **Mitigation:** add `headers` for `/(.*)` in `vercel.json`: `X-Frame-Options: DENY`, a CSP header with `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a minimal `Permissions-Policy`.

### F-05. Image metadata is not stripped from gallery and generic uploads
- **Where:** `sanitizeImage` is called only in `routes/profile.routes.ts:128`; `routes/gallery.routes.ts` and `routes/files.routes.ts` store the validated bytes as is (`validateUpload`, `fileService.ts:75-85`).
- **Scenario:** a member uploads a phone photo with GPS coordinates to a public gallery item; the file is served unchanged, so visitors can read the location.
- **Impact:** privacy leak (the sanitizer exists and is well tested: 294 checks).
- **Note:** `docs/technical/file-storage.md` (written earlier in this engagement) states metadata is stripped in general; that is true for profile photos only. See doc 22.
- **Mitigation:** call `sanitizeImage` in the gallery and file routes.

### F-06. No MFA, no password recovery
Not implemented (verified by search). An administrator compromise (phishing, reuse) gives full control, and a forgotten password needs a human administrator to delete and re-invite the account. Mitigation: MFA (TOTP or passkeys) for managers and administrators; email-based reset requires adding an email service.

### F-07. Release process is not enforced by the repository host
GitHub's branch list reported `master` as `"protected": false` (read during this engagement). Anyone with write access can push to `master` and bypass CI, and Vercel deploys `master` automatically. `docs/architecture/ci-quality-gate.md` states that making CI required is a separate decision not yet made. Mitigation: protect `master`, require the "Build, lint and test" check and pull requests, restrict force pushes.

### F-08. Dependency advisories (`npm audit`, 2026-11-03)
Reported: 14 vulnerabilities (2 critical, 9 high, 3 moderate). Runtime-relevant (direct or via Express): `multer` (denial of service), `zod` (memory use with oversized constrained collections), `body-parser` and `qs` (denial of service), the `@vercel/blob` dependency chain, `undici`; client: `react-router` (moderate; includes an open-redirect-via-backslash advisory); development only: `shell-quote` via `concurrently` (critical), `vite` and `source-map-js` (high). **Exploitability in this application was not verified**; several require specific usage. Mitigation: update after testing, starting with `multer`, `express`, `zod`, `react-router-dom`; add automated dependency alerts.

### F-09. No CSRF token
State-changing endpoints rely on `SameSite=Lax` cookies (cross-site `POST`, `PUT` and `DELETE` do not carry the cookie), JSON bodies (`Content-Type` triggers a preflight) and the absence of CORS (no `Access-Control-*` headers). Only the Google linking routes use an explicit same-origin check (`lib/sameOrigin.ts:28`). Logout is also unprotected (logout CSRF is a nuisance only). Risk is low on current browsers; defence in depth would be an `Origin` check on all unsafe methods.

### F-10. Cached public files outlive an unpublish
`routes/files.routes.ts:105` sets `Cache-Control: public, max-age=3600` for `PUBLIC` files (private and no-store otherwise). A file switched to lab-only can remain downloadable from browser or CDN caches for up to an hour. Low impact; mitigation: shorter cache or `private` for sensitive items.

### F-11. No malware scanning
Uploads are limited to JPEG, PNG, WebP, GIF and PDF by **magic-byte sniffing** (`lib/fileSignature.ts`), never by the client's declared type; SVG and HTML are not allowed; PDFs are served as downloads with `nosniff`. There is no antivirus scan, and PDFs can carry malicious content for the person who opens them. Any signed-in member may upload. Mitigation: scan on upload (external service), or restrict PDF upload to managers.

### F-12. Documented limits exceed the platform body cap
Code states Vercel rejects request bodies over 4.5 MB (`gallery.routes.ts:207`, `packages/shared/src/galleryBatch.ts:6`). Configured limits are 5 MB images and 15 MB documents, so large files fail at the platform before reaching the app. I could not test this on production. Mitigation: direct-to-storage uploads (signed upload URLs) or lower the published limits.

### F-13. Unbounded list endpoints
`GET` list routes for team, publications, news, research areas, projects and groups have no `take`/pagination (verified by search for `take:` per route file). Fine at 20 publications; a limit for growth. Mitigation: paginate and cap.

### F-14. No per-user write throttling
Only login, Google start and invitation endpoints are rate limited. An invited-but-malicious or compromised member could create large numbers of records or upload files repeatedly (bounded by body limits). Mitigation: per-user quotas and rate limits.

### F-15. No optimistic concurrency
Edits are partial (only sent fields change) and creation uses a write lock for duplicates, but updates do not compare a version or `updatedAt`, so with two editors on the same field the last save wins silently. (Some flows do compare-and-set, for example alumni publication, which has a conflict message.) Mitigation: send and check `updatedAt` on updates.

### F-16. Observability
Logging is `console.error`/`console.warn` lines (no request log, no structured logging, no alerting); `GET /api/health` returns a constant and does not test the database (`app.ts:29`). The generic error handler logs the full error object (`app.ts:81`). No uptime monitor or error tracker is configured in the repository (the Vercel dashboard may offer some; **Unknown**).

### F-17. Backups and restore
No backup or restore tooling is in the repository (only a documentation note that Turso offers point-in-time recovery). The migration executor requires a stated recovery point before applying. Backup frequency, retention, encryption and a **tested restore** are **Unknown**. A downloaded database file was handled during this engagement; such files contain real account and message data and must be stored securely.

### F-18. Broad edit rights for members
`canEditContent = isMember` lets any member edit any publication, news item or research area. This is by design, but combined with F-15 and public-by-default visibility it means a single careless or malicious member can alter public records (the audit log records field names, not previous values, so recovering the old text needs a backup).

### F-19. Residual data after deletion
Deleting a user leaves orphan `Session` rows until they expire and keeps `AuditLog.actorEmail` snapshots; messages from a deleted user stay with the sender set to null (`schema.prisma` relations). There is no data-erasure procedure beyond account deletion (doc 14).

### F-20. Password policy
Minimum 8 characters (`schemas/user.ts:17`); no complexity, breach-list or maximum-failure lockout beyond F-03.

### F-21. Content-Security-Policy quality
`index.html:30`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src https://calendar.google.com; object-src 'none'; base-uri 'self'; form-action 'self'`. Scripts are strictly same-origin (good). `'unsafe-inline'` for styles is a minor weakness. The API deliberately sends no CSP (`lib/security.ts`).

### F-22. Preview isolation unknown
Whether Vercel Preview deployments use the production Turso database depends on environment variable scoping in the Vercel dashboard. If shared, a Preview of an unmerged branch runs unreviewed code against production data. **Check in Vercel: Settings, Environment Variables.**

### F-23. Timeouts
No server request timeout, database timeout or `fetch` abort is configured in the code (platform defaults apply). `apiFetch` has no timeout (`lib/api.ts:27-39`).

### F-24. External photo URLs vs CSP
The profile form accepts an external photo URL; the page's CSP allows images only from the site itself and `data:`. A cross-origin photo URL would likely not display. Not tested in a browser here.

## Controls that were checked and found sound (VERIFIED)

| Area | Result | Evidence |
|---|---|---|
| SQL injection | All queries go through Prisma (parameterised). The single raw statement is a tagged template with a bound parameter | `lib/googleOAuth.ts:105` |
| XSS | React escapes output; the only `dangerouslySetInnerHTML` renders build-time Help content generated from repository Markdown; forum, messages and knowledge render as text; JSON-LD uses `script.text` | `pages/docs/DocPage.tsx:34`, `components/ForumBody.tsx`, `hooks/useSeo.ts:90` |
| Stored links | link fields must be `http(s)` URLs (blocks `javascript:`) | `schemas/common.ts:9,15-20` |
| Path traversal | storage keys are random UUIDs checked by a pattern before use; file names are never used as paths | `lib/storage.ts:111-127` |
| SSRF | the server makes no outbound request to user-supplied URLs (no `fetch`/HTTP client in `apps/server/src`; Google endpoints are fixed inside `google-auth-library`) | search of `apps/server/src` |
| File type spoofing | magic-byte sniffing, SVG/HTML not allowed, `nosniff`, PDFs as attachment | `lib/fileSignature.ts`, `files.routes.ts:100-104` |
| Unauthorized file access | `canAccessFile` plus 404; private or no-store cache for lab-only | `files.routes.ts:82-110` |
| IDOR | owner/manager guard answers 403 for unknown ids; conversations 404; unpublished profiles 404 | `auth.ts:73-79`, `messages.routes.ts:28-37`, `memberVisibility.ts` |
| Open redirect | login redirect target must be a single leading `/`; Google flow redirects to fixed paths | `shared/src/redirect.ts:10` |
| Session fixation | session regenerated on login, password change, Google sign-in | `auth.routes.ts:54,100` |
| Account enumeration | login message uniform; timing equalised | `auth.routes.ts:16,46-60` |
| Cookies and transport | `HttpOnly`, `SameSite=Lax`, `Secure` in production; HSTS on the site and API (live) | `session.ts:43-48`; live headers |
| Cache leakage | API `no-store` by default; `Vary: Cookie` on viewer-dependent reads | `app.ts:42-47`, `auth.ts:38` |
| CORS | no CORS middleware, so cross-origin browser reads are blocked | search of server source |
| Secrets | startup fails in production without `SESSION_SECRET`, Turso pair and `TRUST_PROXY`; no secrets found in source or documentation | `lib/config.ts:43`, `lib/session.ts:13-21` |
| Invitation tokens | 256-bit random, hash-only storage, single use, expiry | `lib/invitationToken.ts` |
| Body limits | JSON 100 kb; multer caps | `app.ts:15`, `fileService.ts:30-32` |
| Concurrency on duplicates | write lock before duplicate checks and conflict mapping | `lib/duplicates.ts:36`, `lib/dbErrors.ts` |

## Not tested (and why)
No penetration test, fuzzing, load test or dynamic scan was run, and nothing was attempted against production accounts. Behaviors that depend on Vercel, Turso or Google infrastructure are marked Unknown. A professional external review would be appropriate before storing sensitive data.
