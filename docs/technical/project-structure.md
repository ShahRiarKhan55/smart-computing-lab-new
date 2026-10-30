# Repository structure

An npm-workspaces monorepo (`workspaces`: `apps/*`, `packages/*`).

```
.
├── api/                      Vercel serverless entry point (wraps the Express app)
├── apps/
│   ├── server/               Express + Prisma API
│   │   ├── prisma/           schema.prisma, migrations/, seed.ts, dev.db (local, git-ignored)
│   │   ├── scripts/          unit tests, regression suites, browser tests, docs render, Turso migration CLI
│   │   └── src/
│   │       ├── app.ts        Express app (headers, session, /api/health, routes, error handler)
│   │       ├── index.ts      local server entry (reads PORT, loads .env)
│   │       ├── routes/       one *.routes.ts file per resource, mounted in routes/index.ts
│   │       ├── middleware/   auth.ts (optionalAuth, requireAuth, requireCan, requireOwnerOrManager)
│   │       └── lib/          prisma client, session store, storage, serializers, duplicates, Turso migrator, …
│   └── web/                  React single-page app
│       └── src/
│           ├── App.tsx       the route table
│           ├── pages/        one component per page; pages/admin/ for the dashboard
│           ├── components/   shared UI (TeamCard, forms, navigation)
│           ├── docs/content/ GENERATED guide HTML (see below), committed
│           └── styles/       CSS
├── packages/shared/          schemas, permissions, i18n dictionary (compiled to dist/)
├── docs/                     all documentation (see docs/README.md)
├── Lab-Website/reference/    the original PHP + SQLite reference site (reference only, not part of the build)
├── vercel.json               build command, function config, rewrites
└── .github/workflows/ci.yml  the CI workflow
```

## Generated files worth knowing

- `apps/web/src/docs/content/*.ts` is **generated** from `docs/user-guide/{en,ja}/*.md` by `npm run docs:render -w apps/server` and committed, because the web build imports it. Edit the Markdown, then re-run the command; never edit the `.ts` files by hand. English and Japanese must define the same set of guide files or the command fails.
- `packages/shared/dist/` is produced by `npm run build -w packages/shared` (also run by that package's `postinstall`).
- `apps/server/dist-docs/` (PDF guides) is git-ignored build output.

## Where to look for a feature

| To change… | Start here |
|---|---|
| Who may do something | `packages/shared/src/permissions.ts`, then the route's guard |
| An API endpoint | `apps/server/src/routes/<resource>.routes.ts` |
| Request validation | `packages/shared/src/schemas/<resource>.ts` |
| A table or column | `apps/server/prisma/schema.prisma` plus a new migration |
| A page | `apps/web/src/pages/<Page>.tsx` and the route in `App.tsx` |
| Header menus | `apps/web/src/components/navConfig.ts` |
| UI text (English and Japanese) | `packages/shared/src/i18n/en.ts` and `ja.ts` |
