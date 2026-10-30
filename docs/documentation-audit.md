# Documentation audit and coverage report

Scope: all documentation for the Smart Computing Lab website, checked against `master` at commit `55f7d07` (after the Alumni section moved onto the Team page). Documentation-only: no application source, schema, data, configuration or deployment was changed.

## Audit checklist

| # | Check | Result |
|---|---|---|
| 1 | Inventory existing documentation | 6 guides x 2 languages in `docs/user-guide/`, 31 design records in `docs/architecture/`, one checklist, one reference README (`Lab-Website/reference/`), `apps/web/README.md`. No root `README.md`, no technical reference, no role matrix, no API reference. |
| 2 | Identify the real roles | Guest, `MEMBER`, `LAB_MANAGER`, `ADMIN` (`packages/shared/src/schemas/enums.ts`, `permissions.ts`). No other roles. |
| 3 | Compare permissions with the code | Every row of [role-permissions.md](technical/role-permissions.md) was written from `permissions.ts` and the route guards, not from the older guides. |
| 4 | Compare routes and API paths | The API reference was generated from `apps/server/src/routes/*.routes.ts` (141 routes). Every `/api/...` path cited in other new pages was checked against it. |
| 5 | Compare UI labels | Menu, dashboard-section and button labels were taken from `packages/shared/src/i18n/en.ts` and `ja.ts`, `navConfig.ts` and the page components. |
| 6 | Compare environment variable names | Every variable named in the new docs was confirmed in `apps/server/.env.example` or the source (`apps/server/src`, `api/index.ts`, `scripts/turso-migrate.ts`). |
| 7 | Check relative Markdown links | 145 relative links in 64 Markdown files; the only failures are 4 pre-existing non-link strings in two architecture documents (`member:<id>` mention syntax). |
| 8 | Scan for secrets and personal data | No tokens, passwords, database URLs with credentials, or account emails in new or changed files. The seed's default credential is described but not reproduced. |
| 9 | Render the user guides | `docs-render.mjs` (patched to write to a scratch folder) rendered 6 guides x 2 locales without error. |
| 10 | Contradictions between documents | Searched for the superseded claims listed below; none remain in the user guides. Older design records are annotated where they are stale. |

## Errors found in existing documentation (and corrected)

| Where | Was | Reality (source) | Fix |
|---|---|---|---|
| Researcher guide, Quick Start | New content "defaults to lab-only" | Publications, news and research areas default to **PUBLIC** (`visibility @default("PUBLIC")`); events, knowledge, resources, gallery, projects, groups default `LAB_ONLY` | Rewritten with the per-type defaults and a "check visibility before you save" warning |
| Researcher guide | Any member can create projects and groups | `canCreateProject` and `canCreateGroup` are `isManager` | Corrected; leads can edit and manage members |
| Researcher guide, Onboarding, Admin guide (Japanese too) | Administrators can "deactivate" an account | No such action; only delete exists (`DELETE /api/users/:id`) | "Delete" everywhere; stated that there is no suspend action |
| Researcher guide, Quick Start, Onboarding | Profile has a photo URL | A photo upload exists (`POST /api/profile/photo`), plus Google Scholar, ResearchGate and ORCID links | Added |
| Admin guide | Section names "People", "Content", "Files", "Translations", "Audit" | Menu labels are "People & Accounts", "Research content", "Files & Gallery", "Localization", "Audit log" | Corrected (Japanese labels too) |
| Admin guide | Nothing on team members, alumni, publication metadata, or what a manager cannot do | `canManageAlumni` and `canPublishMember` are admin-only; managers see exactly what the public sees | New sections: lab-manager can/cannot, Team and Alumni, Publications and metadata, destructive actions, common problems |
| Admin guide | Audit visibility described as account events only | Alumni and unpublished-profile rows are also hidden from managers (`memberVisibility.ts`) | Added |
| Public visitor guide | Team page without Alumni; Contact "gives ways to reach the lab" | Alumni is the last section; the contact **form is not connected** (sends nothing) | Rewritten; added a can/cannot table |
| Site maintainer guide | Production migrations via "an audited one-off script"; incomplete variable table | The reviewed Turso executor (`migrate:turso`) exists and is documented; `PORT`, `STORAGE_DIR`, `MAX_*_BYTES`, `GOOGLE_OAUTH_*`, `MIGRATE_TARGET_*` were missing | Updated, with the migrate-before-deploy order and a seed warning |
| `architecture/phase3b-alumni-directory.md` | Alumni have their own `/alumni` page | `/alumni` redirects to `/team#alumni` | Added an update note; the rest of the record is unchanged |

## Gaps discovered and filled

New files: root `README.md`; `docs/README.md` (index); `docs/technical/` (architecture, project structure, authentication and authorization, role-permission matrix, database, API reference, file storage, Windows development setup, testing, deployment, troubleshooting); `docs/content-management/` (team and alumni, publications, research and projects, news/events/gallery); this report.

## Coverage against the request

| Requirement | Where |
|---|---|
| Public visitors | [Public Visitor Guide](user-guide/en/public-visitor-guide.md), [Quick Start](user-guide/en/quick-start.md) |
| Lab members | [Researcher guide](user-guide/en/researcher-guide.md), [Onboarding](user-guide/en/researcher-onboarding.md) |
| Lab managers | [Admin guide: what a manager can and cannot do](user-guide/en/admin-guide.md); matrix in [role-permissions.md](technical/role-permissions.md). Kept in the shared guide because the dashboard is shared. |
| Administrators | [Admin guide](user-guide/en/admin-guide.md) |
| Project overview, stack, structure | [README.md](../README.md), [architecture.md](technical/architecture.md), [project-structure.md](technical/project-structure.md) |
| Windows setup | [development-setup.md](technical/development-setup.md) |
| Environment variables (names only) | [deployment.md](technical/deployment.md), [site maintainer guide](user-guide/en/site-maintainer-guide.md) |
| Schema, relationships, migrations, Turso executor | [database.md](technical/database.md) |
| API endpoints and auth | [api-reference.md](technical/api-reference.md) |
| Auth architecture and permission matrix | [authentication-and-authorization.md](technical/authentication-and-authorization.md), [role-permissions.md](technical/role-permissions.md) |
| Files and media | [file-storage.md](technical/file-storage.md) |
| Testing, deployment, troubleshooting, security | [testing.md](technical/testing.md), [deployment.md](technical/deployment.md), [troubleshooting.md](technical/troubleshooting.md), security notes in the README and the authentication page |
| Team and Alumni | [team-and-alumni.md](content-management/team-and-alumni.md) |
| Other content types | [publications.md](content-management/publications.md), [research-and-projects.md](content-management/research-and-projects.md), [news-events-and-gallery.md](content-management/news-events-and-gallery.md) |

## Limits of this audit (needs verification or follow-up)

1. **The in-app `/docs` pages are stale until regenerated.** `apps/web/src/docs/content/*.ts` is generated from `docs/user-guide` and committed. Regenerating it changes application source files, which this task did not do. Run `npm run docs:render -w apps/server` and commit the result when you want the website's Help pages to match.
2. **Japanese text** was written alongside the English and uses the site's own Japanese UI labels, but has not been reviewed by a native speaker.
3. **No screenshots** were captured, to avoid showing production data or fabricating UI.
4. **Vercel Preview environment scoping** (which database a Preview uses) is dashboard configuration and could not be verified from the repository.
5. **Seed credential:** `apps/server/prisma/seed.ts` contains a fixed default administrator credential. The docs warn against running the seed on production; whether it was ever run against production is not known from the repository.
6. **Behavior that was read from source, not executed here:** per-field rules for editing another person's profile, the exact add-button labels for Projects and Groups, event kinds, and the Schedule page's calendar embed.
7. **Older phase records** in `docs/architecture/` were not reviewed line by line; only the alumni page references were checked and annotated.
8. **No Markdown linter** is configured in the repository; link checking was done with a one-off script, and rendering with the project's own `docs-render` logic.
9. The role matrix reflects the code at `55f7d07`. The matching tests (`unit-policy`, `alumni-regression`, `publication-metadata-regression`, `duplicate-prevention-regression`) were not re-run for this documentation-only change.
