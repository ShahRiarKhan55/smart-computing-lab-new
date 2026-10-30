# Smart Computing Lab website

The website of the Smart Computing Lab (Interdisciplinary Faculty of Science and Engineering, Shimane University): a public site for research, people and publications, plus a members' area for the lab's own collaboration and content management. Production: https://smartcomputinglab.vercel.app

## Main features

**Public (no login):** research areas, projects and groups; the team page (Faculty, PhD, MSc, BSc and Research Students, then **Alumni** as the last section); publications with optional bibliographic metadata; news; events; gallery; knowledge documents; lab resources; public forum categories; site search; English and Japanese.

**Lab members (login):** own profile (photo, research links), lab-only content, workspace, schedule, private messages and notifications, forum posting, and creating publications, news, research areas, events, knowledge documents, resources and gallery items.

**Lab managers:** content management, visibility control, moderation and the admin dashboard.

**Administrators:** everything above plus accounts, roles, researcher invitations, and alumni management (add, publish, unpublish).

There is no public self-registration: accounts are created by an administrator, normally through a one-time invitation link. Who may do what: [role-permission matrix](docs/technical/role-permissions.md).

## Technology stack

| Layer | Technology |
|---|---|
| Web app | React, TypeScript, Vite (client-side rendered) |
| API | Express 4, TypeScript |
| Shared code | Zod schemas, permission functions, English/Japanese dictionary (`packages/shared`) |
| Database | Prisma 5 with SQLite locally; Turso (libSQL) in production |
| Files | local disk in development; private Vercel Blob in production |
| Hosting and CI | Vercel (Git integration); GitHub Actions |

## Documentation

Start at [docs/README.md](docs/README.md). Highlights:

| You are… | Read |
|---|---|
| A visitor | [Public Visitor Guide](docs/user-guide/en/public-visitor-guide.md), [Quick Start](docs/user-guide/en/quick-start.md) |
| A lab member | [Researcher / Lab Member Guide](docs/user-guide/en/researcher-guide.md), [Onboarding](docs/user-guide/en/researcher-onboarding.md) |
| A lab manager or administrator | [Administrator Guide](docs/user-guide/en/admin-guide.md) (includes what managers can and cannot do) |
| The site maintainer | [Site Maintainer Guide](docs/user-guide/en/site-maintainer-guide.md) and [docs/technical](docs/technical/) |
| A developer | [Development setup](docs/technical/development-setup.md), [Architecture](docs/technical/architecture.md), [API reference](docs/technical/api-reference.md), [Database](docs/technical/database.md) |

Japanese versions of the user guides are in `docs/user-guide/ja/`.

## Local setup

Quick version (Windows PowerShell, Node.js 22):

```powershell
npm install
Copy-Item apps\server\.env.example apps\server\.env
npm run migrate:deploy -w apps/server
npm run seed -w apps/server
npm run dev
```

The web app runs at http://localhost:5173 and the API at http://localhost:4001. Full instructions, including how to keep production credentials out of a test shell: [docs/technical/development-setup.md](docs/technical/development-setup.md).

## Testing

```powershell
npm run build
npm run lint -w apps/web
npm run test:unit -w apps/server
npm run test:publication-metadata -w apps/server
```

CI (GitHub Actions) runs the build, lint, the unit chain and nine fast database suites on every pull request and push to `master`. More suites (HTTP regression, browser tests) are listed in [docs/technical/testing.md](docs/technical/testing.md). Test suites use disposable local databases; never run them with production credentials set.

## Deployment overview

Merging to `master` deploys to Vercel Production automatically; pull requests get Preview deployments. The Vercel build does **not** run database migrations. Production schema changes use a reviewed executor (`npm run migrate:turso -w apps/server`) and must be applied **before** the code that needs them is deployed. See [docs/technical/deployment.md](docs/technical/deployment.md) and [docs/technical/database.md](docs/technical/database.md).

## Security notes

- Never commit `.env` files, tokens or database files. Environment variable *names* and purposes are documented; values live in the Vercel dashboard.
- The API is the security boundary; the web app only hides controls. Hidden or unpublished records answer 404.
- `npm run seed` creates a default administrator with a fixed development credential. Use it only on a local database, never on production.
- Production database changes (migrations, restores, replacements) require an explicit decision and a recovery point. Do not upload or replace the Turso database from a local file.
