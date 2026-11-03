# 20. Executive summary and cheat sheet

## A. The 60-second introduction
The Smart Computing Lab website is both our public face and our internal platform. Visitors can read about our research, people, publications and news in English or Japanese. Lab members sign in to manage their profiles, add publications and events, share resources and talk to each other. Managers curate what is public, and administrators manage accounts and the alumni list. It is a real web application, with accounts, permissions, a database and an audit trail, and every important rule is enforced on the server rather than just hidden in the page.

## B. The 2-minute technical introduction
The front end is a React and TypeScript single-page app; the back end is an Express API in TypeScript, using Prisma to talk to a relational database: SQLite on a laptop, Turso (a hosted SQLite-compatible database) in production. Uploaded files go to a private Vercel Blob store. Everything is hosted on Vercel: the app is static, and the API runs as a serverless function. A shared package holds the validation schemas and the permission functions, so the browser and the server apply the same rules. Passwords are stored as bcrypt hashes; sessions are cookies backed by a database table; Google sign-in is optional and only for existing accounts. There are 38 tables and 141 API routes. Tests are custom scripts: unit tests, database and HTTP tests against disposable databases, and browser tests; a CI workflow runs the fast ones on every pull request.

## C. The 5-minute technical explanation
**Architecture.** A request goes browser, Vercel, one serverless function that wraps Express, then Prisma to Turso. Middleware sets security headers, parses JSON (capped at 100 kb), loads the session, re-reads the user from the database on every request, checks the route's permission, validates input with Zod, runs a transaction, writes an audit row, and returns JSON that is never cached by default.
**Authentication.** Login uses bcrypt with equalised timing and a uniform error; the session id is regenerated at login and password change; the cookie is HttpOnly, SameSite=Lax and Secure in production. Accounts are created by administrators through single-use invitation links (256-bit tokens, only hashes stored). Google sign-in uses PKCE, state, nonce and ID-token verification and matches Google's subject id, never email.
**Authorization.** Four levels: guest, member, lab manager, administrator. Visibility per record is public or lab-only. Unpublished alumni are visible only to administrators. Unknown or hidden records answer "not found" so existence does not leak.
**Database.** Relational schema with unique constraints, indexes and cascading or null-setting deletes. Production changes use a reviewed migration executor that applies only pinned, additive statements after a recovery point.
**Security posture.** Parameterised queries, escaped output, content-based file validation, private file serving, no CORS, HSTS. Weak spots: other sessions survive a password change; login throttling is per instance; page-level frame and CSP headers are missing; gallery photos keep metadata; no MFA, no password reset, no monitoring; master is unprotected.
**Deployment.** Merging to master deploys to production through Vercel; pull requests get previews and CI. Rollback is promoting an earlier deployment; migrations are additive.

## D. One-page quick reference
See [21-quick-reference.md](21-quick-reference.md).

## E. Twenty difficult questions with honest answers

1. **"Is this secure?"** It follows sound practices for its size (server-side authorization, hashed passwords, safe cookies, validated input, private files), but it has known gaps (doc 07) and has not had an independent penetration test. I would not claim "secure", only "reasonably hardened with a documented risk list".
2. **"Why should we trust AI-assisted code?"** Not on faith: it has tests per feature, a reviewed history, and this audit; it also contained two overstated claims, which we found and recorded. Treat it as code that needs review, as with any contributor.
3. **"What happens if your admin password leaks?"** Full control for the attacker. No MFA yet. Mitigation today: strong unique passwords and checking the audit log; next: MFA and session revocation.
4. **"Where is the backup?"** The repository has no automated backup; we rely on Turso's point-in-time recovery and recorded recovery points before migrations. A restore drill has not been done. That is the first operational task.
5. **"Can students' data be exposed?"** Profiles are public by default for non-alumni members; messages are visible to participants only; emails are not public. There is no privacy notice, retention policy or export yet.
6. **"Is it GDPR or APPI compliant?"** I cannot claim that; it needs a legal assessment. Gaps: privacy notice, retention, consent records, export and erasure procedures.
7. **"What if Vercel or Turso fails?"** The site is down or degraded until they recover; there is no failover. Moving is possible but not rehearsed.
8. **"Can a member change another member's profile?"** No (403); managers can edit non-alumni profiles; only admins manage alumni.
9. **"Can one person overwrite another's edits?"** Yes on the same field; no version check yet.
10. **"How do you prevent SQL injection?"** Prisma parameterises everything; the single raw statement is parameterised.
11. **"How do you prevent XSS?"** React escapes output, user content is plain text, links must be http(s), scripts must be same-origin; only build-time Help HTML is injected.
12. **"Can I upload a virus?"** Only five file types by content; PDFs download rather than open inline; no antivirus scanning yet.
13. **"What stops brute-force login?"** A per-instance counter (10 failures in 15 minutes per address and email) plus slow hashing; it is weak against distributed attacks.
14. **"Why not use WordPress?"** Custom permissions, alumni consent, publication metadata, and bilingual content were requirements, and the lab wanted code it controls; the trade-off is that we maintain it.
15. **"Does it scale to 10,000 users?"** Not as it is; hundreds to low thousands of mostly-read traffic is plausible but unproven; load testing is needed.
16. **"What is untested?"** Real Turso under load, platform limits, restore, Google against the real service, accessibility with assistive technology, cross-browser, penetration testing.
17. **"Why is the contact form not working?"** It is a placeholder and says so; messages are not sent.
18. **"Who can see the audit log?"** Managers and admins; account events and emails are admin-only.
19. **"What if the lab loses the person who built it?"** Documentation, tests and this audit exist; there is no operator runbook beyond the docs, and a single-maintainer risk remains.
20. **"What would you fix first?"** Check the seed's default admin on production, protect master, test a restore, add headers, session revocation, MFA for admins.
