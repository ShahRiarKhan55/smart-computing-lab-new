# 18. Presentation question bank (110 questions)

Each answer has a short version (15 to 30 seconds), a technical detail, evidence, and a likely follow-up with a recommended reply. Use the short version for non-technical audiences. Evidence paths are relative to the repository root. Status labels are explained in the [README](README.md). Where the honest answer is "not implemented" or "unknown", say so: it is stronger than bluffing.

## 1. General introduction

**Q1. What is this website?**
- **Short:** It is the Smart Computing Lab's public website and members' platform: research, people, publications and news for visitors, plus accounts, messaging and content management for the lab.
- **Detail:** A React single-page app talking to an Express API with a relational database. Visitors read; members sign in and contribute; managers and administrators curate and administer.
- **Evidence:** `README.md`, `apps/web/src/App.tsx`, `docs/presentation-readiness/01-project-overview.md`.
- **Follow-up:** *Who uses it?* Visitors, lab members, lab managers, administrators; accounts are created by invitation only.

**Q2. What problem does it solve for the lab?**
- **Short:** One place for the lab's public presence and its internal coordination, run by lab members themselves.
- **Detail:** Publications and people stay current without a developer (forms, visibility control, audit log); alumni and members get profiles; the lab can discuss and share resources privately.
- **Evidence:** feature inventory in doc 01.
- **Follow-up:** *Could a CMS do this?* Possibly part of it; here permissions, alumni consent, publication metadata and bilingual content are tailored, and it is code the lab controls.

**Q3. Why is it not just a static website?**
- **Short:** Because it has logins, private content, uploads and a database; a static site cannot hide records from the public or accept edits.
- **Detail:** Per-record visibility is enforced in the API; there are 38 tables, sessions, an audit log, and 141 routes.
- **Evidence:** `docs/technical/api-reference.md`, `schema.prisma`.
- **Follow-up:** *Is the public part static?* The pages are a prebuilt single-page app, but their data comes live from the API.

**Q4. Who built it and how long did it take?**
- **Short:** Answer from your own knowledge; the repository shows it was built in phases.
- **Detail:** The design history is in 30 phase documents under `docs/architecture/`. The repository does not record effort or timelines; do not invent numbers. Recent pull requests in the repository state they were generated with an AI coding assistant (Claude Code); be transparent if asked, and point to the tests, reviews and documentation that let you own and verify the result.
- **Evidence:** `docs/architecture/`, git history.
- **Follow-up:** *Do you understand all of it?* Say yes only after studying this audit; point to the tests and documentation as safety nets.

**Q5. Is it in production now?**
- **Short:** Yes, at smartcomputinglab.vercel.app, deployed automatically from the master branch.
- **Detail:** Vercel hosts the app; Turso hosts the database; Blob hosts uploaded files.
- **Evidence:** `vercel.json`, GitHub "Production" deployment on merge, live `GET /api/health` returned ok.
- **Follow-up:** *Is it on a university domain?* The repository does not show a custom domain; **Unknown**.

**Q6. What is the single biggest risk today?**
- **Short:** Operational: no tested backup and restore and no monitoring.
- **Detail:** Security-wise, no MFA and session revocation gaps. These are fixable and listed with priorities.
- **Evidence:** docs 07, 17.
- **Follow-up:** *Why not fixed?* It is a small-team project; the audit turns them into a prioritised plan.

## 2. Technology stack

**Q7. What technologies did you use?**
- **Short:** React and TypeScript on the front, Express and Prisma on the back, SQLite locally and Turso in production, hosted on Vercel.
- **Detail:** Plus bcrypt, Zod validation, Helmet headers, Vercel Blob for files, Google OAuth, GitHub Actions for tests.
- **Evidence:** doc 02, `package.json` files.
- **Follow-up:** *Any UI framework?* No; hand-written CSS with design tokens.

**Q8. Why TypeScript?**
- **Short:** The same rules and types are used in the browser and the server, which prevents mismatches.
- **Detail:** The permission functions and Zod schemas live in one shared package imported by both sides.
- **Evidence:** `packages/shared/src/permissions.ts`, `packages/shared/src/schemas/`.
- **Follow-up:** *Is it strict?* The server is; the web tsconfig is non-strict (noted in `ProtectedRoute.tsx`).

**Q9. Why Prisma?**
- **Short:** Safe, typed database access with migrations.
- **Detail:** Queries are parameterised by default, which removes most SQL injection risk; schema is a single file; migrations are files.
- **Evidence:** `apps/server/prisma/schema.prisma`, `lib/prisma.ts`.
- **Follow-up:** *Downsides?* Native engine adds size; Turso requires a preview driver-adapter feature.

**Q10. Which libraries handle security?**
- **Short:** bcryptjs for passwords, express-session for sessions, Helmet for headers, Zod for validation, google-auth-library for Google tokens.
- **Detail:** plus custom code for rate limiting, file signature checks and image sanitising.
- **Evidence:** doc 02; `lib/fileSignature.ts`, `lib/imageSanitize.ts`.
- **Follow-up:** *Is any of it outdated?* `npm audit` reports 14 advisories; see F-08.

**Q11. What testing tools do you use?**
- **Short:** Custom TypeScript test scripts, Playwright for browsers, GitHub Actions for automation.
- **Detail:** No Jest or Vitest and no coverage tool; 43 `test:*` scripts.
- **Evidence:** `apps/server/package.json`, doc 11.
- **Follow-up:** *What is the coverage?* Not measured; do not give a number.

**Q12. Which external services does it depend on?**
- **Short:** Vercel, Turso, Vercel Blob, GitHub, and optionally Google for sign-in, fonts and the calendar.
- **Detail:** Each is a single point of dependency; an exit plan is a roadmap item.
- **Evidence:** doc 02, `index.html` CSP.
- **Follow-up:** *What if one disappears?* doc 12 scenario 22.

## 3. Architecture

**Q13. How does the frontend talk to the backend?**
- **Short:** The browser calls the JSON API under `/api` on the same site, with a session cookie.
- **Detail:** `apiFetch` sends same-origin `fetch` requests; Vercel routes `/api/*` to one serverless function that runs the Express app.
- **Evidence:** `apps/web/src/lib/api.ts:27`, `vercel.json`, `api/index.ts`.
- **Follow-up:** *Why no CORS?* Same origin, so none is needed or enabled.

**Q14. Walk me through one request.**
- **Short:** Browser, Vercel, Express, login check, permission check, database, JSON back, React renders.
- **Detail:** See the sequence diagram: headers, JSON parse, session lookup, user lookup, Zod validation, transaction, audit row.
- **Evidence:** doc 03 diagram 2; `app.ts:24-47`.
- **Follow-up:** *Where is validation?* Both client (courtesy) and server (authoritative, shared Zod schemas).

**Q15. Where is the data stored?**
- **Short:** In a Turso database; uploaded files are in Vercel Blob.
- **Detail:** Locally a SQLite file and local disk. The database holds metadata for files; the bytes are in Blob.
- **Evidence:** `lib/prisma.ts`, `lib/storage.ts`.
- **Follow-up:** *Is it encrypted?* Provider-level encryption is Turso/Vercel's matter; **Unknown** from the repository.

**Q16. Is it a monolith or microservices?**
- **Short:** A small monolith: one API, one database, one front end.
- **Detail:** Deployed as a static app plus one serverless function; simple to reason about for a small team.
- **Evidence:** `api/index.ts`, `routes/index.ts`.
- **Follow-up:** *Would you split it?* Not until a measured need exists.

**Q17. What does serverless change?**
- **Short:** No always-on server: each request may run on a new instance, so memory-based features are per instance.
- **Detail:** That is why rate limiting is weaker (F-03) and why files go to Blob rather than disk.
- **Evidence:** `lib/loginRateLimit.ts` header, `lib/storage.ts:149`.
- **Follow-up:** *Cold starts?* Possible latency on first request; not measured.

**Q18. How is configuration handled per environment?**
- **Short:** Environment variables; production refuses to start if the important ones are missing.
- **Detail:** `assertProductionConfig` checks Turso pair, session secret, trust-proxy setting.
- **Evidence:** `lib/config.ts:43`, `lib/session.ts:13-21`.
- **Follow-up:** *Where are secrets kept?* In the Vercel dashboard; never in the repository.

## 4. Frontend

**Q19. How is the frontend organised?**
- **Short:** Pages and reusable components, with route-level code splitting.
- **Detail:** About 44 page components, 85 component files, hooks for data and auth.
- **Evidence:** `apps/web/src/pages`, `components`, `App.tsx`.
- **Follow-up:** *State management?* React state and contexts for auth and language; no external store.

**Q20. How does it fetch data?**
- **Short:** A small hook loads data when a page opens and shows loading and error states.
- **Detail:** No cache, no retry, no timeout today.
- **Evidence:** `hooks/useApiResource.ts`, `lib/api.ts`.
- **Follow-up:** *Why not React Query?* Simplicity and zero dependencies; a caching library is a reasonable upgrade.

**Q21. How do you stop users seeing admin buttons?**
- **Short:** The UI hides them, but the real protection is that the server refuses the actions.
- **Detail:** The same policy functions drive UI and API; the UI copy is cosmetic.
- **Evidence:** `auth/usePolicy.ts`, `middleware/auth.ts`.
- **Follow-up:** *Prove it.* Call an admin route as a member: 403. The regression suites test this.

**Q22. Does it work on phones?**
- **Short:** Yes, it is responsive and was checked at phone widths.
- **Detail:** Hamburger menu, single-column cards; one known issue: two long Help pages scroll sideways on phones.
- **Evidence:** `styles/*.css`, browser scripts at 320 and 375 px.
- **Follow-up:** *Tablets?* Not separately tested.

**Q23. How is the English and Japanese support built?**
- **Short:** Every interface string exists in both languages, and the compiler enforces it.
- **Detail:** Typed dictionaries; per-record Japanese overrides for user content; language remembered in the browser.
- **Evidence:** `packages/shared/src/i18n`, `unit-i18n`.
- **Follow-up:** *Is all content translated?* No: user content falls back to its original language.

**Q24. How accessible is it?**
- **Short:** Good basics (keyboard focus, labels, skip link) but not formally audited.
- **Detail:** No automated WCAG scan, no screen-reader test; a few English-only strings.
- **Evidence:** doc 15.
- **Follow-up:** *Will you fix it?* Add axe to CI and test with a screen reader.

## 5. Backend and APIs

**Q25. How many endpoints are there and how are they secured?**
- **Short:** 141, each guarded for the right level of access.
- **Detail:** Public read routes filter by visibility; writes require sign-in plus a role or ownership check; admin routers are guarded as a whole.
- **Evidence:** `docs/technical/api-reference.md`, `routes/admin.routes.ts:66`, `routes/users.routes.ts:19`.
- **Follow-up:** *Which are riskiest?* Account creation and role changes: admin only.

**Q26. How is input validated?**
- **Short:** With schemas that reject anything unexpected, on the server.
- **Detail:** Zod schemas for bodies and query parameters, size limits, enum checks, URL scheme checks.
- **Evidence:** `packages/shared/src/schemas/*.ts`, `schemas/common.ts:15`.
- **Follow-up:** *Mass assignment?* Handlers pick fields explicitly; for example team updates ignore category for non-managers.

**Q27. How are errors handled?**
- **Short:** Clear 4xx messages for client mistakes; a generic 500 that never leaks internals.
- **Detail:** One central error handler; known database races become 409 or 503.
- **Evidence:** `app.ts:52-82`, `lib/dbErrors.ts`.
- **Follow-up:** *Are errors logged?* To the platform log; no alerting.

**Q28. What stops someone reading someone else's messages?**
- **Short:** The server only returns conversations the caller participates in.
- **Detail:** Non-participants get 404; no admin screen reads messages.
- **Evidence:** `routes/messages.routes.ts:28-37`.
- **Follow-up:** *Are messages encrypted?* Not end-to-end; stored in the database.

**Q29. What happens when two requests create the same publication?**
- **Short:** A database write lock serialises the duplicate check, so only one wins.
- **Detail:** Identical DOI is always refused; same title and year needs a manager's confirmation.
- **Evidence:** `lib/duplicates.ts:36`, `test:publication-race` (22 checks).
- **Follow-up:** *And two edits?* Last write wins on the same field (F-15).

**Q30. Can the API be called from another website?**
- **Short:** Not by browsers: there is no CORS configuration.
- **Detail:** Cookies are SameSite=Lax; cross-site pages cannot read responses.
- **Evidence:** search found no CORS middleware; live API headers.
- **Follow-up:** *Is there an API key option?* No.

## 6. Authentication

**Q31. How does authentication work?**
- **Short:** Email and password, checked on the server; a secure session cookie keeps you signed in.
- **Detail:** bcrypt hashes, session stored in the database, regenerated at login, seven-day sliding lifetime.
- **Evidence:** `routes/auth.routes.ts:27-60`, `lib/session.ts:36-50`.
- **Follow-up:** *Why not JWT?* Sessions can be invalidated server-side.

**Q32. How are passwords stored?**
- **Short:** Never stored; only a bcrypt hash.
- **Detail:** Cost 10, salted by bcrypt; minimum length 8.
- **Evidence:** `auth.routes.ts:16,90`, `schemas/user.ts:17`.
- **Follow-up:** *Is cost 10 enough?* It is modest; raising it is a quick improvement.

**Q33. Can anyone register?**
- **Short:** No. Only administrators create accounts, normally with one-time invitation links.
- **Detail:** The token is random, stored only as a hash, expires in 7 days; the invitee sets their own password.
- **Evidence:** `lib/invitationToken.ts:25-30`, `invitations.routes.ts:27`.
- **Follow-up:** *Can the admin see the password?* No.

**Q34. What if someone guesses passwords?**
- **Short:** After 10 failures from one address for one account, login is blocked for 15 minutes.
- **Detail:** But the counter is in memory per instance, so it is weak against distributed attacks (F-03).
- **Evidence:** `lib/loginRateLimit.ts:20-21`.
- **Follow-up:** *Plan?* Shared counters and admin MFA.

**Q35. Is there multi-factor authentication or password reset?**
- **Short:** No to both (not implemented).
- **Detail:** A forgotten password means an administrator deletes and re-invites the account.
- **Evidence:** docs/technical/authentication; search.
- **Follow-up:** *Is that acceptable?* For a small invite-only lab, but MFA for admins is the top improvement.

**Q36. How does Google sign-in work, and is it safe?**
- **Short:** It only signs in people who already have an account and linked Google; it never creates accounts.
- **Detail:** Uses state, nonce, PKCE and ID-token verification; matches by Google's stable subject id, not email.
- **Evidence:** `routes/googleAuth.routes.ts:261-330`, `lib/googleOAuth.ts`.
- **Follow-up:** *Could someone take over with a matching email?* No, email is not used to match.

**Q37. What happens when I log out or change my password?**
- **Short:** Logout ends that session; a password change ends the current session id and issues a new one.
- **Detail:** **Other sessions of the same user remain valid** (F-02).
- **Evidence:** `auth.routes.ts:98-114`.
- **Follow-up:** *Fix?* Store user id on sessions and revoke.

## 7. User roles and permissions

**Q38. What roles exist?**
- **Short:** Guest, member, lab manager and administrator.
- **Detail:** Stored as `User.role`; guests have no account.
- **Evidence:** `packages/shared/src/schemas/enums.ts`, `permissions.ts`.
- **Follow-up:** *Any hidden role?* No other role was found.

**Q39. What can a lab manager not do?**
- **Short:** Manage accounts and roles, or manage alumni.
- **Detail:** Managers curate content, set visibility, create projects and groups, edit other people's non-alumni profiles, moderate; they see exactly what the public sees on alumni.
- **Evidence:** `permissions.ts:95-100`, `memberVisibility.ts:20-24`.
- **Follow-up:** *Why?* Alumni appear publicly and may not have consented; accounts are the most sensitive power.

**Q40. Can a member edit someone else's publication?**
- **Short:** Yes, by policy any member can edit any publication, news item or research area.
- **Detail:** Deleting and visibility are manager-only. It is a governance choice, not a bug (F-18).
- **Evidence:** `permissions.ts` (`canEditContent`).
- **Follow-up:** *Would you change it?* Possibly restrict to owners or add review.

**Q41. What if an admin changes my role while I am logged in?**
- **Short:** It takes effect on your next request.
- **Detail:** The role is re-read from the database on every request.
- **Evidence:** `middleware/auth.ts:11-24`.
- **Follow-up:** *And if my account is deleted?* You instantly act as a guest.

**Q42. Can someone make themselves admin?**
- **Short:** No; only an admin changes roles and nobody can change their own.
- **Detail:** Role endpoints are behind `canManageUsers`.
- **Evidence:** `permissions.ts` `roleChangeError`, `users.routes.ts:19`.
- **Follow-up:** *Is the first admin created by seed?* Yes, the seed creates a default admin: check production (F-01).

**Q43. Who can see unpublished alumni?**
- **Short:** Only administrators.
- **Detail:** Everyone else gets "not found", even via direct URL.
- **Evidence:** `lib/memberVisibility.ts:23-35`, `test:alumni`.
- **Follow-up:** *Search and sitemap?* Also excluded (tested).

**Q44. What does a guest see versus a member?**
- **Short:** Guests see public content; members also see lab-only content and private tools.
- **Detail:** Visibility values `PUBLIC` and `LAB_ONLY` per record.
- **Evidence:** `docs/technical/role-permissions.md`.
- **Follow-up:** *Default visibility?* Public for publications, news, research areas; lab-only for most other content.

## 8. Database

**Q45. What database do you use and why?**
- **Short:** SQLite locally and Turso (hosted SQLite) in production, because the data is relational.
- **Detail:** Foreign keys, unique constraints, transactions; simple to run in tests.
- **Evidence:** `schema.prisma`, `lib/prisma.ts`.
- **Follow-up:** *Why not Postgres?* Simplicity and cost; migration is possible later.

**Q46. How many tables and how are they related?**
- **Short:** 38 models, linked mostly through people, projects and publications.
- **Detail:** See the ERD in doc 08; 36 cascading, 27 set-null and 1 restricting delete rules.
- **Evidence:** doc 08.
- **Follow-up:** *What happens when a user is deleted?* Their profile and content stay, owner set to null.

**Q47. How do migrations work in production?**
- **Short:** A reviewed command applies only approved additive changes, after a backup point.
- **Detail:** SHA-256-pinned migrations, inspect-only first, refuses partial states.
- **Evidence:** `scripts/turso-migrate.ts`, `lib/tursoMigrate.ts`.
- **Follow-up:** *Rollback?* Redeploy older code; columns are kept; restore only for incidents.

**Q48. What if a migration is not applied before a deploy?**
- **Short:** Pages that read the changed table fail with "no such column".
- **Detail:** It happened with publication metadata; fixed by applying the migration. Hence "migrate first".
- **Evidence:** `docs/architecture/publication-metadata-release.md`.
- **Follow-up:** *Can CI catch it?* Not today.

**Q49. How is data protected from SQL injection?**
- **Short:** Prisma parameterises queries; there is one raw statement and it is parameterised.
- **Detail:** No string concatenation of user input into SQL was found.
- **Evidence:** `lib/googleOAuth.ts:105`.
- **Follow-up:** *Search with `%`?* LIKE wildcards are not escaped: only affects result matching, not safety (**Unknown** performance effect).

**Q50. Are there indexes?**
- **Short:** Yes, 68 declared, plus unique constraints.
- **Detail:** Query plans were not analysed; search uses LIKE and cannot use indexes.
- **Evidence:** `schema.prisma`.
- **Follow-up:** *Slow queries?* Not measured.

**Q51. What is the database access model?**
- **Short:** One application credential; permissions are enforced by the application.
- **Detail:** No per-role database users.
- **Evidence:** `lib/prisma.ts`.
- **Follow-up:** *Risk?* If the token leaks, the database is open; rotate and keep it in Vercel only.

## 9. Security

**Q52. What are the main security controls?**
- **Short:** Server-side authorization, hashed passwords, secure cookies, validation, private file serving and an audit log.
- **Detail:** plus HSTS, security headers on the API, invitation tokens hashed, Google OAuth with PKCE.
- **Evidence:** doc 07 table of sound controls.
- **Follow-up:** *Weaknesses?* Session revocation, throttling, SPA headers, MFA, EXIF.

**Q53. Can someone steal sessions with JavaScript?**
- **Short:** The cookie is HttpOnly, so scripts cannot read it, and the site allows only its own scripts.
- **Detail:** CSP `script-src 'self'`; React escapes content; the only injected HTML is build-time Help content.
- **Evidence:** `session.ts:43-48`, `index.html:30`, `DocPage.tsx:34`.
- **Follow-up:** *Stored XSS?* Inputs are rendered as text; no HTML editor exists.

**Q54. What about CSRF?**
- **Short:** Cookies are SameSite=Lax and there is no CORS, which blocks cross-site requests.
- **Detail:** No CSRF token (F-09); defence in depth would add an Origin check.
- **Evidence:** `session.ts:45`, `lib/sameOrigin.ts:28`.
- **Follow-up:** *Logout CSRF?* Possible but harmless.

**Q55. Can the site be framed (clickjacking)?**
- **Short:** The API responses cannot; the page itself currently can (F-04).
- **Detail:** The CSP is a meta tag, which cannot set frame-ancestors; add headers in `vercel.json`.
- **Evidence:** live `HEAD /` headers; `vercel.json`.
- **Follow-up:** *Severity?* Low to medium.

**Q56. How do you stop malicious uploads?**
- **Short:** Only five file types by content, size limits and random names; PDFs download, not run.
- **Detail:** No virus scan (F-11); profile photos are sanitised, gallery images are not (F-05).
- **Evidence:** `fileSignature.ts`, `files.routes.ts:100-104`.
- **Follow-up:** *SVG?* Not allowed.

**Q57. What if someone tries thousands of requests?**
- **Short:** Login is throttled per instance; Vercel provides platform-level protection (not verified); most other endpoints are not throttled.
- **Detail:** F-03, F-14; recommend a shared limiter or WAF.
- **Evidence:** `loginRateLimit.ts`.
- **Follow-up:** *DoS?* Body limits and pagination help; lists are unpaginated.

**Q58. Are dependencies vulnerable?**
- **Short:** `npm audit` reports 14 advisories; exploitability is not confirmed.
- **Detail:** The critical ones are in a dev tool; runtime ones are DoS-type in multer, body-parser, zod; update and retest.
- **Evidence:** doc 07 F-08.
- **Follow-up:** *Automated updates?* None configured.

**Q59. Have you had a penetration test?**
- **Short:** No; this was a code review with tests, not a pen test.
- **Detail:** Do not imply otherwise. A professional review is advisable before sensitive data is added.
- **Evidence:** doc 22.
- **Follow-up:** *Bug bounty?* No.

**Q60. What would happen if an admin account is hacked?**
- **Short:** The attacker could change content, accounts and roles; there is no MFA, and recovery depends on backups.
- **Detail:** Audit log records actions (not old values).
- **Evidence:** F-02, F-06, doc 12 scenario 10.
- **Follow-up:** *Mitigation?* Strong unique passwords now; MFA and session revocation next.

**Q61. Are security headers set?**
- **Short:** Yes on API responses; the page itself only has HSTS from the platform.
- **Detail:** API: HSTS, nosniff, SAMEORIGIN, no-referrer, CORP same-origin; SPA: add headers (F-04).
- **Evidence:** live headers; `lib/security.ts`.
- **Follow-up:** *Why no CSP header on the API?* It is JSON; the page's policy is in HTML.

## 10. Privacy

**Q62. What personal data do you store?**
- **Short:** Emails, password hashes, names and profile text, photos, messages, forum posts and an audit log.
- **Detail:** Table in doc 14.
- **Evidence:** `schema.prisma`.
- **Follow-up:** *Who can see emails?* Administrators; emails are not shown publicly.

**Q63. How does a user delete their data?**
- **Short:** They ask an administrator; there is no self-service deletion or export.
- **Detail:** Deleting an account keeps the profile and content; audit rows keep an email snapshot.
- **Evidence:** `users.routes.ts:183-214`, doc 14.
- **Follow-up:** *Is that compliant?* No claim; needs legal review.

**Q64. Do alumni consent to being listed?**
- **Short:** They are hidden until an administrator publishes them, who is told to publish only with consent.
- **Detail:** No consent record is kept.
- **Evidence:** `alumni.confirm` strings, `memberVisibility.ts`.
- **Follow-up:** *Improve?* Record date and evidence.

**Q65. Do you use tracking or analytics?**
- **Short:** No analytics or advertising scripts exist in the code.
- **Detail:** Google Fonts and an embedded Google Calendar do contact Google.
- **Evidence:** `index.html:30`, doc 14.
- **Follow-up:** *Cookie banner?* Only a first-party session cookie exists; no notice page exists.

**Q66. Where is the data physically stored?**
- **Short:** With Turso and Vercel; regions are not recorded in the repository.
- **Detail:** **Unknown** from the code; check the dashboards.
- **Evidence:** none.
- **Follow-up:** *Japan?* Unknown.

**Q67. Do you have a privacy policy?**
- **Short:** Not yet.
- **Detail:** Recommended: notice, retention, consent log, export and erasure procedures.
- **Evidence:** doc 14.
- **Follow-up:** *Timeline?* Part of the roadmap.

## 11. File storage

**Q68. Where are uploaded files stored?**
- **Short:** In a private Vercel Blob store in production, on disk locally.
- **Detail:** The database keeps metadata only.
- **Evidence:** `lib/storage.ts`.
- **Follow-up:** *Are the links public?* No, files are served through the API after permission checks.

**Q69. How do you validate file types?**
- **Short:** By reading the file's first bytes, not trusting the name or declared type.
- **Detail:** JPEG, PNG, WebP, GIF, PDF only.
- **Evidence:** `fileSignature.ts:11`, `fileService.ts:75`.
- **Follow-up:** *Polyglot files?* Served with nosniff; PDFs as attachments.

**Q70. How big can uploads be?**
- **Short:** Configured at 5 MB for images and 15 MB for PDFs, but the hosting platform cap is about 4.5 MB per request.
- **Detail:** So larger uploads fail (F-12).
- **Evidence:** `fileService.ts:19`, `gallery.routes.ts:207`.
- **Follow-up:** *Fix?* Direct-to-storage uploads.

**Q71. What if storage is down?**
- **Short:** Uploads return a clear 503 and existing images show as broken; the rest works.
- **Detail:** See doc 09.
- **Evidence:** `storage.ts:149,165`.
- **Follow-up:** *Backups of files?* Not automated.

**Q72. Is location data removed from photos?**
- **Short:** For profile photos yes; for gallery photos not yet.
- **Detail:** F-05.
- **Evidence:** `profile.routes.ts:128`.
- **Follow-up:** *Planned?* Easy fix.

**Q73. What happens when a file is deleted?**
- **Short:** The record is marked deleted and the stored object removed.
- **Detail:** Failures leave orphans; a reconcile script reports them.
- **Evidence:** `files.routes.ts:117-163`.
- **Follow-up:** *Undo?* No.

## 12. Deployment

**Q74. How is it deployed?**
- **Short:** Merging to master deploys to Vercel automatically.
- **Detail:** Pull requests get preview deployments and run CI.
- **Evidence:** doc 10.
- **Follow-up:** *Approvals?* Not enforced by branch protection (F-07).

**Q75. What happens if a deployment is broken?**
- **Short:** Roll back to the previous deployment in Vercel.
- **Detail:** Additive migrations keep older code working.
- **Evidence:** doc 10.
- **Follow-up:** *Tested?* Not exercised in the repository.

**Q76. How do you apply database changes?**
- **Short:** Manually, with a reviewed command, before releasing code.
- **Detail:** See Q47.
- **Evidence:** `docs/architecture/turso-migration-executor.md`.
- **Follow-up:** *Why manual?* Safety on production data.

**Q77. How do you monitor the site?**
- **Short:** Not much: a health endpoint and the platform logs.
- **Detail:** The health check does not test the database.
- **Evidence:** `app.ts:29`.
- **Follow-up:** *Improve?* Uptime monitor and error tracking.

**Q78. Are staging and production separate?**
- **Short:** Previews exist; whether they use a separate database is unknown.
- **Detail:** Check Vercel variable scoping (F-22).
- **Evidence:** none in the repository.
- **Follow-up:** *Risk?* Previews could touch production data.

**Q79. Could you move to another host?**
- **Short:** Yes, with effort: Express and Prisma run on any Node host.
- **Detail:** Replace the serverless wrapper, supply a database, storage and env vars.
- **Evidence:** `apps/server/src/index.ts`, doc 12 scenario 21.
- **Follow-up:** *Runbook?* Not written.

## 13. Testing

**Q80. How do you test it?**
- **Short:** Unit tests, database/HTTP tests, and browser tests.
- **Detail:** About 38 unit files and many suites; CI runs the fast ones.
- **Evidence:** doc 11.
- **Follow-up:** *Coverage?* Not measured.

**Q81. Do tests cover security?**
- **Short:** Authorization and visibility yes; penetration or fuzzing no.
- **Detail:** Role-based HTTP tests, alumni consent tests, upload tests.
- **Evidence:** `test:alumni` (194), `unit-policy` (385).
- **Follow-up:** *Does a pass prove safety?* No.

**Q82. What fails sometimes?**
- **Short:** The gallery suite is documented as occasionally timing out and one startup test failed once.
- **Detail:** Both are timing issues.
- **Evidence:** `ci.yml:8`, doc 11.
- **Follow-up:** *Impact?* None on production.

**Q83. Does CI run on every change?**
- **Short:** Yes for pull requests and master.
- **Detail:** It builds, lints and runs the unit and fast database tests; it is not required to merge.
- **Evidence:** `.github/workflows/ci.yml`.
- **Follow-up:** *Browser tests in CI?* No.

**Q84. How do you test accessibility?**
- **Short:** Custom browser checks for keyboard focus and layout; no automated WCAG scanner.
- **Detail:** doc 15.
- **Evidence:** `scripts/ui-a11y-regression.mjs`.
- **Follow-up:** *Next step?* Add axe.

**Q85. How do you know the Alumni rules work?**
- **Short:** Dedicated suites check visibility for every role and the publish workflow.
- **Detail:** 194 database checks and 29 browser checks passed in this engagement.
- **Evidence:** `alumni-regression.mjs`, `alumni-ui.mjs`.
- **Follow-up:** *Production check?* On 2026-10-30 production returned no published alumni.

## 14. Performance

**Q86. How fast is the site?**
- **Short:** The page shell is a small prebuilt app; data loads on demand. I have not benchmarked it.
- **Detail:** Main script about 113 KB gzipped; most pages load lazily.
- **Evidence:** measured `apps/web/dist/assets`.
- **Follow-up:** *Lighthouse score?* Not measured; run one before presenting.

**Q87. Is there caching?**
- **Short:** Static files are cached by fingerprint; API data is not cached, except public files for an hour.
- **Detail:** API is `no-store` by default for privacy.
- **Evidence:** `app.ts:42-47`, `files.routes.ts:105`.
- **Follow-up:** *Why no API cache?* Visibility depends on the viewer.

**Q88. Are images optimised?**
- **Short:** Not automatically: they are served as uploaded.
- **Detail:** No resizing or WebP conversion.
- **Evidence:** `lib/storage.ts`, `files.routes.ts`.
- **Follow-up:** *Impact?* Heavy photos slow the gallery.

**Q89. Which queries could be slow?**
- **Short:** Unpaginated lists and substring search.
- **Detail:** `LIKE '%term%'` cannot use an index; results are capped at 50.
- **Evidence:** `lib/search.ts`, F-13.
- **Follow-up:** *Measured?* No.

**Q90. Does every request hit the database twice?**
- **Short:** Yes, the session and the user are read before the real query.
- **Detail:** A reasonable cost today; could be reduced by caching.
- **Evidence:** `middleware/auth.ts:11-24`, `prismaSessionStore.ts`.
- **Follow-up:** *Why re-read the user?* So role changes and deletions apply immediately.

## 15. Scalability

**Q91. Can it handle 1,000 users?**
- **Short:** Probably for reading; it needs a load test and a check of plan limits.
- **Detail:** Static hosting scales well; the database and unpaginated lists are the first limits.
- **Evidence:** doc 13.
- **Follow-up:** *10,000?* Not without changes (shared limiter, pagination, caching, monitoring).

**Q92. What is the first bottleneck?**
- **Short:** The database round trips and the in-memory limiter.
- **Detail:** See doc 13 list.
- **Evidence:** doc 13.
- **Follow-up:** *Evidence?* Architecture analysis, not measurements.

**Q93. Could you add more servers?**
- **Short:** Serverless already runs many instances; state must move to shared stores.
- **Detail:** Sessions are already in the database; rate limits are not.
- **Evidence:** `loginRateLimit.ts` header.
- **Follow-up:** *Where would you put shared state?* A database table or a managed key-value store.

**Q94. Would you change the database at scale?**
- **Short:** Possibly Postgres with connection pooling.
- **Detail:** Prisma keeps most code; migrations and the Turso executor would change.
- **Evidence:** `schema.prisma` provider.
- **Follow-up:** *When?* After measuring write contention.

**Q95. How would you load test safely?**
- **Short:** On a copy of the app and database, never production.
- **Detail:** Scenarios: browsing, search, logins, uploads.
- **Evidence:** doc 13 roadmap.
- **Follow-up:** *Tool?* k6 or Artillery (not currently in the repository).

## 16. Reliability and disaster recovery

**Q96. What if the database goes down?**
- **Short:** API calls fail with errors; static pages still load; nothing is lost.
- **Detail:** No failover; recovery depends on Turso.
- **Evidence:** doc 12 scenario 2.
- **Follow-up:** *Status page?* No.

**Q97. How do you back up and restore the database?**
- **Short:** Honestly: backups rely on Turso's point-in-time recovery; there is no automated backup or tested restore in the repository.
- **Detail:** Before migrations a recovery point is recorded; a downloaded copy was taken and used for rehearsal, but that is manual.
- **Evidence:** `turso-migration-executor.md`, F-17.
- **Follow-up:** *Next step?* Scheduled export, encrypted storage, a restore drill.

**Q98. What if the server crashes?**
- **Short:** Serverless: the next request starts a fresh instance; sessions are in the database so users stay signed in.
- **Detail:** No long-running process to crash; in-memory limiters reset.
- **Evidence:** `api/index.ts`, `prismaSessionStore.ts`.
- **Follow-up:** *Data loss?* In-flight writes may fail; committed data is safe.

**Q99. What if two people edit the same thing?**
- **Short:** Edits only change the fields sent; if both change the same field, the last save wins.
- **Detail:** Duplicate creation is serialised; no version check yet.
- **Evidence:** F-15.
- **Follow-up:** *How to recover an overwritten value?* Backups; the audit log shows who and when, not old text.

**Q100. What if a bad deployment ships?**
- **Short:** Roll back in Vercel; additive migrations keep old code working.
- **Detail:** Smoke test after each release.
- **Evidence:** doc 10.
- **Follow-up:** *Automation?* No automatic rollback.

**Q101. What if an upload is corrupted or deleted?**
- **Short:** The image appears broken; re-upload; a script reports mismatches.
- **Detail:** No automated blob backup.
- **Evidence:** `storage:reconcile`, doc 09.
- **Follow-up:** *Prevention?* Backups and checksums.

## 17. Limitations

**Q102. What are the biggest limitations?**
- **Short:** No MFA or password reset, per-instance throttling, no monitoring or tested backups, and unresolved privacy policy questions.
- **Detail:** Table in doc 17 with consequences.
- **Evidence:** doc 17.
- **Follow-up:** *Which first?* Backups and branch protection, then session revocation and headers.

**Q103. Are there features that are only partly done?**
- **Short:** The contact form is a placeholder, publication status is not filterable, and Google sign-in is optional.
- **Detail:** All are documented in the guides.
- **Evidence:** `ContactPage.tsx`, doc 17.
- **Follow-up:** *Does the site say so?* The contact page tells visitors that nothing was sent.

**Q104. What does the audit say you got wrong?**
- **Short:** Two things were overstated in documentation: security headers and image metadata stripping.
- **Detail:** Code is the truth; the corrections are in doc 22.
- **Evidence:** doc 22.
- **Follow-up:** *Trust?* The audit labels each claim as verified or not.

**Q105. Is the AI-assisted code trustworthy?**
- **Short:** Treat it like any code: reviewed, tested, audited, and documented.
- **Detail:** Strengths: tests per feature, explicit threat notes in code. Risks: confident but wrong comments (found two).
- **Evidence:** doc 22 discrepancies.
- **Follow-up:** *Independent review?* Recommend one.

**Q106. Is it accessible to everyone?**
- **Short:** It has good basics but has not been formally audited.
- **Detail:** See Q24.
- **Evidence:** doc 15.
- **Follow-up:** *Compliance?* No claim.

## 18. Future development

**Q107. What would you build next?**
- **Short:** Admin MFA, session revocation, backups with a restore drill, monitoring, and a privacy notice.
- **Detail:** Then pagination, shared rate limits, accessibility automation.
- **Evidence:** doc 17 roadmap.
- **Follow-up:** *Timeline?* Weeks for the first group.

**Q108. How would you add email notifications or password reset?**
- **Short:** Add an email provider and a token table similar to invitations.
- **Detail:** The invitation token code (`invitationToken.ts`) is reusable.
- **Evidence:** `lib/invitationToken.ts`.
- **Follow-up:** *Privacy impact?* Another third party.

**Q109. Could other labs use this?**
- **Short:** With work: branding, content and the lab-specific parts are in code and strings.
- **Detail:** No multi-tenant support.
- **Evidence:** architecture.
- **Follow-up:** *Open source?* Licence not found in the repository (**Unknown**).

**Q110. What would you rebuild differently?**
- **Short:** MFA, email, session revocation and server-side rendering for public pages from the start.
- **Detail:** See doc 16.
- **Evidence:** doc 16.
- **Follow-up:** *What would you keep?* Shared policy and schema package, additive migrations, regression tests.
