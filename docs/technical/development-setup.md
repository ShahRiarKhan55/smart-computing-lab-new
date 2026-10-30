# Local development setup (Windows)

These steps use **PowerShell** on native Windows (no WSL needed). The project pins no Node version; CI and all validation use **Node.js 22**.

## Prerequisites

- Node.js 22 (LTS) with npm, and Git.
- Optional, for browser tests only: [Playwright](https://playwright.dev/) with Chromium (not a repository dependency; the browser scripts exit with a clear message if it is missing).

## First-time setup

```powershell
git clone https://github.com/ShahRiarKhan55/smart-computing-lab-new.git
cd smart-computing-lab-new
npm install
```

`npm install` also builds `packages/shared` (its `postinstall`) and runs `prisma generate` for the server.

Create the server's environment file from the annotated template:

```powershell
Copy-Item apps\server\.env.example apps\server\.env
```

The template contains the local-development values (`DATABASE_URL="file:./dev.db"`, a placeholder `SESSION_SECRET`, `PORT=4001`, `NODE_ENV=development`). Replace `SESSION_SECRET` with a long random string for anything other than throwaway use. `apps/server/.env` is git-ignored; never commit it.

Create the local database and sample data:

```powershell
npm run migrate:deploy -w apps/server   # applies every migration to apps/server/prisma/dev.db
npm run seed -w apps/server             # idempotent: default admin account + sample content
```

The seed creates a default administrator whose credentials are fixed in `apps/server/prisma/seed.ts`. That is for local development only. Never run the seed against a production database.

Start both servers:

```powershell
npm run dev
```

| Service | URL |
|---|---|
| Web app (Vite) | http://localhost:5173 |
| API | http://localhost:4001 (the web app proxies `/api` to it) |
| Health check | http://localhost:4001/api/health |

## Everyday commands

| Task | Command |
|---|---|
| Build everything (shared → server → web) | `npm run build` |
| Lint the web app | `npm run lint -w apps/web` |
| New migration during development | `npm run migrate -w apps/server` |
| Browse the local database | `npm run prisma:studio` |
| Regenerate in-app guides after editing `docs/user-guide` | `npm run docs:render -w apps/server` |

## Staying off the production database

Several local test scripts start the real server against a disposable database copy and spread your shell's environment into it. If Turso variables are set in your PowerShell session, a "local" test could talk to the real database. Before running tests or the seed:

```powershell
Remove-Item Env:TURSO_DATABASE_URL, Env:TURSO_AUTH_TOKEN -ErrorAction SilentlyContinue
Get-ChildItem Env: | Where-Object Name -match 'TURSO|MIGRATE_TARGET'   # should print nothing
```

Many suites refuse to run when these are set; do not rely on that. Set Turso variables only for the single command that needs them (see [database.md](database.md)).

## Troubleshooting setup

See [troubleshooting.md](troubleshooting.md).
