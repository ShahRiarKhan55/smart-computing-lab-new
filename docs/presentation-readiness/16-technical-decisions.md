# 16. Technical decisions: how to explain them honestly

The repository records implementation history in `docs/architecture/phase*.md`, but not a decision log of the original choices. Statements below are marked **Recorded** (a phase document or code comment states the reason) or **Assessment** (my engineering reasoning, offered as a defensible answer, not a confirmed historical decision).

| Question | Answer you can give | Basis |
|---|---|---|
| Why React? | Component model fits many repeated card, form and list views; huge ecosystem; the team could share TypeScript types with the API. | Assessment |
| Why TypeScript? | One language and one set of types and validation rules across browser and server; the permission functions are literally the same file in both places. | Recorded (shared package design) and assessment |
| Why Express? | Simple, mature, easy to wrap for serverless; the API is a thin layer over validation and database access, so a heavy framework was unnecessary. | Assessment; wrapper approach Recorded in `api/index.ts` comments |
| Why Prisma? | Typed queries, parameterised SQL by default, migrations as files, one schema as the source of truth. Downside: native engine size and Turso needs an adapter. | Assessment; adapter rationale Recorded in `lib/prisma.ts` |
| Why this database (SQLite locally, Turso in production)? | A relational model suits people, publications, projects and permissions with many joins and constraints; SQLite is zero-setup for development and tests; Turso gives hosted SQLite-compatible storage that works from serverless functions. | Assessment; topology Recorded in `lib/prisma.ts` |
| Why a relational database rather than documents? | The data is highly relational (authors to publications, members to projects, ownership), needs unique constraints, transactions and cascades. | Assessment |
| Why Vercel? | Serverless hosting with Git integration, previews and no server to run for a small lab; the repository was adapted to it (Blob, Turso, `api/index.ts`). | Recorded (adapter phase) and assessment |
| Why an API-based architecture, not server-rendered pages? | A separate JSON API lets one backend serve the UI, tests and any future client, and keeps the authorization boundary in one place. Cost: no server-side rendering, so SEO relies on client-side meta tags and a sitemap. | Assessment |
| Why role-based access control? | Few clearly different duties (read, contribute, curate, administer) map cleanly to four roles; policies are pure functions that are easy to test. | Recorded (`permissions.ts` header) |
| Why separate member, lab manager, administrator? | Least privilege: curation and visibility do not need account or alumni powers; the alumni rule exists because alumni appear publicly and may not have consented. | Recorded (`permissions.ts`, alumni phase) |
| Why Google OAuth? | Convenience for members who already use Google, **without creating accounts or trusting email**: it only signs in to accounts an administrator already created and the user linked. | Recorded (`.env.example`, phase 2.2) |
| Why not simply a static site? | Because of authentication, per-record visibility, uploads, a database and an audit log (doc 01). | Verified |
| Why sessions, not JWTs? | Server-side sessions can be invalidated and hold no data in the browser; the cost is a database read per request and no per-user revoke yet (F-02). | Assessment |
| Why bcryptjs? | Pure JavaScript, works on serverless without native builds; cost 10 is modest and could be raised. | Assessment |
| Why a custom i18n instead of a library? | Two languages only; typed keys give compile-time parity; no dependency. | Assessment |

## What would change at 10,000 users
Move rate limiting, caching and session revocation to shared infrastructure; paginate every list; add search infrastructure; evaluate Postgres with pooling; add monitoring and alerting; CDN image variants; formal load tests and capacity plan (doc 13).

## What I would change if rebuilding today (assessment)
Add MFA and an email service from the start (password reset, notifications); store `userId` on sessions; version fields for optimistic concurrency; direct-to-storage uploads; a structured logging and error-tracking setup; automated backups and restore drills; protect `master` with required checks; server-side rendering or static generation for the public pages (better SEO and first paint); component accessibility testing with axe in CI; keep the shared-types and shared-policy idea, which worked well.
