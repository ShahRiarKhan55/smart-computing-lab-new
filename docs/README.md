# Documentation index

All documentation for the Smart Computing Lab website. It describes what the application does today; where something could not be confirmed from the code it says "Needs verification".

## User guides (`docs/user-guide/`)

Each guide exists in English and Japanese, and is the single source for the in-app `/docs` pages and the PDF export (see [user-guide/README.md](user-guide/README.md)).

| User type | Guide (English) | 日本語 |
|---|---|---|
| New to the site | [Quick Start](user-guide/en/quick-start.md) | [クイックスタート](user-guide/ja/quick-start.md) |
| Public visitor (guest) | [Public Visitor Guide](user-guide/en/public-visitor-guide.md) | [一般訪問者ガイド](user-guide/ja/public-visitor-guide.md) |
| Lab member | [Researcher / Lab Member Guide](user-guide/en/researcher-guide.md) | [研究者向けガイド](user-guide/ja/researcher-guide.md) |
| Newly invited researcher | [Researcher Onboarding](user-guide/en/researcher-onboarding.md) | [オンボーディング](user-guide/ja/researcher-onboarding.md) |
| Lab manager | [Administrator Guide, "What a lab manager can and cannot do"](user-guide/en/admin-guide.md) | [管理者ガイド](user-guide/ja/admin-guide.md) |
| Administrator | [Administrator Guide](user-guide/en/admin-guide.md) | [管理者ガイド](user-guide/ja/admin-guide.md) |
| Site maintainer | [Site Maintainer Guide](user-guide/en/site-maintainer-guide.md) | [運用者向けガイド](user-guide/ja/site-maintainer-guide.md) |

Lab managers and administrators share one guide because the admin dashboard is shared; the guide marks what is administrator-only.

## Content management (`docs/content-management/`)

| Topic | Page |
|---|---|
| Team page and Alumni | [team-and-alumni.md](content-management/team-and-alumni.md) |
| Publications and metadata | [publications.md](content-management/publications.md) |
| Research areas, projects, groups | [research-and-projects.md](content-management/research-and-projects.md) |
| News, events, knowledge, resources, gallery, forum | [news-events-and-gallery.md](content-management/news-events-and-gallery.md) |

## Technical reference (`docs/technical/`)

| Topic | Page |
|---|---|
| Architecture overview | [architecture.md](technical/architecture.md) |
| Repository structure | [project-structure.md](technical/project-structure.md) |
| Authentication and authorization | [authentication-and-authorization.md](technical/authentication-and-authorization.md) |
| **Role-permission matrix** | [role-permissions.md](technical/role-permissions.md) |
| Database, migrations, Turso executor | [database.md](technical/database.md) |
| API reference (all endpoints and their access rules) | [api-reference.md](technical/api-reference.md) |
| File uploads and storage | [file-storage.md](technical/file-storage.md) |
| Local development setup (Windows) | [development-setup.md](technical/development-setup.md) |
| Testing and CI | [testing.md](technical/testing.md) |
| Build, deployment, rollback | [deployment.md](technical/deployment.md) |
| Troubleshooting | [troubleshooting.md](technical/troubleshooting.md) |

## Design history and operations records

- [`architecture/`](architecture/): one design record per development phase (not user-facing; some predate later changes, for example the Alumni design in `phase3b-alumni-directory.md` describes a separate page that no longer exists). When a phase document and the code disagree, the code and the pages above are current.
- [Turso migration executor](architecture/turso-migration-executor.md) and [publication metadata release](architecture/publication-metadata-release.md): the production migration procedure.
- [manual-publication-entry-checklist.md](manual-publication-entry-checklist.md): mapping of the lab's 23-paper workbook to the publication form.
- [documentation-audit.md](documentation-audit.md): what was checked, what was corrected, and coverage.

## Keeping documentation correct

- Permissions live in `packages/shared/src/permissions.ts`; change the matrix page in the same pull request.
- API routes: regenerate or edit [api-reference.md](technical/api-reference.md) when `apps/server/src/routes` changes.
- After editing `docs/user-guide/{en,ja}/*.md`, run `npm run docs:render -w apps/server` and commit the regenerated `apps/web/src/docs/content/*.ts`; otherwise the in-app `/docs` pages show the old text.
