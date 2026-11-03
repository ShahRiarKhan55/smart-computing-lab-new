# 21. One-page quick reference

| Topic | Fact (evidence in the numbered docs) |
|---|---|
| **What** | Public site plus members' platform for the Smart Computing Lab, English and Japanese |
| **Front end** | React 19, TypeScript, Vite, react-router 6, plain CSS; 52 chunks; main script about 113 KB gzipped |
| **Back end** | Express 4 (TypeScript) as one Vercel serverless function; 141 routes under `/api` |
| **Database** | Prisma 5.22; SQLite locally; **Turso (libSQL)** in production; 38 models; 68 indexes; 36 cascade, 27 set-null, 1 restrict |
| **Files** | private Vercel Blob in production, disk locally; served only via `GET /api/files/:id` after a permission check |
| **Hosting** | Vercel (Git integration); `master` deploys to Production; PRs get Previews; GitHub Actions CI (build, lint, unit, 9 DB suites) |
| **Auth** | email and password (bcrypt cost 10), DB-backed session cookie `scl.sid` (HttpOnly, SameSite=Lax, Secure in production, 7 days sliding); invitation-only accounts; optional Google sign-in for linked accounts |
| **Roles** | Guest, `MEMBER`, `LAB_MANAGER`, `ADMIN`; role re-read per request |
| **Visibility** | `PUBLIC` or `LAB_ONLY` per record; alumni additionally need an admin to publish |
| **Main features** | research areas, projects, groups, team and alumni, publications (with metadata), news, events, gallery, knowledge, resources, forum, private messages, workspace, search, admin dashboard, audit log, invitations, Help guides |
| **Security controls** | Prisma parameterisation, React escaping, Zod validation, shared policy functions, magic-byte file checks, UUID storage keys, nosniff, HSTS, no CORS, rate-limited login, invitation tokens hashed, session regeneration, audit log |
| **Known weaknesses** | no MFA or password reset; sessions not revocable per user; per-instance rate limits; SPA lacks frame/CSP headers; gallery EXIF kept; no malware scan; no monitoring; no automated backup; `master` unprotected; 14 npm advisories; default admin in seed (check!) |
| **Tests** | custom scripts (unit chain about 38 files, 43 `test:*`), Playwright browser scripts; no coverage tool; CI runs fast subset, not required |
| **Scale** | fine for lab-sized use; not load-tested; unpaginated lists and in-memory limiter first to hurt |
| **Backups** | Turso point-in-time recovery (plan unknown); no automated or tested restore in the repository |
| **Privacy** | emails, hashes, names, bios, photos, messages, audit emails; no notice, retention, export, or consent records |
| **Next** | seed check, branch protection, restore drill, headers, session revocation, admin MFA, monitoring, privacy notice |

Memory aid for the three-sentence answer to "how is it built?": *React front end, Express API, relational database; same rules shared by both; hosted serverless with Turso and Blob.*
