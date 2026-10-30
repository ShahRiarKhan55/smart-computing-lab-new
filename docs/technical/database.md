# Database

## Engine and configuration

- **ORM:** Prisma 5.22 with `provider = "sqlite"` in `apps/server/prisma/schema.prisma` (preview feature `driverAdapters`; binary targets `native` and `rhel-openssl-3.0.x` for Vercel).
- **Local development and tests:** a SQLite file. `DATABASE_URL="file:./dev.db"` gives `apps/server/prisma/dev.db` (git-ignored). Test suites copy or build their own disposable SQLite files.
- **Production:** Turso (hosted libSQL), reached through `@prisma/adapter-libsql` and `@libsql/client` when `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set. `apps/server/src/lib/prisma.ts` is the only place a `PrismaClient` is created and the only place that chooses between the two.

## Tables (38 models)

| Area | Models |
|---|---|
| Accounts and sessions | `User`, `Session`, `AccountInvitation`, `OAuthIdentity` |
| People | `TeamMember`, `HistoryEntry` |
| Research structure | `ResearchArea`, `ResearchGroup`, `ResearchProject`, `GroupMember`, `ProjectMember`, `ProjectArea`, `ProjectPublication`, `ResearcherArea` |
| Publications and news | `Publication`, `PublicationAuthor`, `NewsItem`, `NewsAuthor` |
| Knowledge and resources | `KnowledgeDoc`, `LabResource`, `ResourceProject`, `Event` |
| Files and gallery | `StoredFile`, `GalleryItem`, `GalleryImage`, `GalleryUploadAttempt` |
| Community | `ForumCategory`, `ForumPost`, `ForumPostRevision`, `ForumComment`, `ForumReaction`, `ForumMention` |
| Messaging | `Conversation`, `ConversationParticipant`, `Message`, `Notification` |
| Platform | `AuditLog`, `Translation` |

## Key relationships

- `User` 1—0..1 `TeamMember` (`TeamMember.userId` is unique and nullable; deleting a user sets it to null, the profile stays). A team profile in the `ALUMNI` category never has a user.
- `TeamMember` many—many `Publication` (through `PublicationAuthor`) and `NewsItem` (through `NewsAuthor`), `ResearchProject` (through `ProjectMember`, role `LEAD` or `MEMBER`), `ResearchGroup` (through `GroupMember`) and `ResearchArea` (through `ResearcherArea`).
- `ResearchProject` belongs to an optional `ResearchGroup`; projects link to areas (`ProjectArea`) and publications (`ProjectPublication`).
- `Event`, `KnowledgeDoc` and `LabResource` have an owner (`User`) and optional links to projects, areas, groups, publications or each other.
- `GalleryItem` wraps `StoredFile` records through `GalleryImage`; a gallery item has no visibility of its own, the file's visibility is the single source of truth.
- `ForumCategory` 1—many `ForumPost` 1—many `ForumComment`; reactions and mentions attach to a post or a comment.
- `Translation` stores Japanese overrides for translatable records; `AuditLog` records administrative actions.

## Important columns

| Table | Column | Meaning |
|---|---|---|
| `User` | `role` | `MEMBER`, `LAB_MANAGER` or `ADMIN` |
| `TeamMember` | `category` | `FACULTY`, `PHD`, `MSC`, `BSC`, `RESEARCH`, `ALUMNI` |
| `TeamMember` | `isPublished` | default `true`; alumni are created `false` |
| Most content tables | `visibility` | `PUBLIC` or `LAB_ONLY`. Defaults: `PUBLIC` for `Publication`, `NewsItem`, `ResearchArea`; `LAB_ONLY` for projects, groups, events, knowledge documents, resources, files and forum categories |
| `Publication` | `status`, `listNumber`, `category`, `volume`, `startPage`, `endPage`, `month`, `acceptedDate` | the eight optional metadata fields; `''` or `0` mean "not stated". See [content-management/publications.md](../content-management/publications.md) |

## Migrations

Migrations are SQL files in `apps/server/prisma/migrations/` (11 so far; the latest is `20261030120000_publication_metadata_fields`). They are **additive by convention**: nothing in this project has dropped a column or table.

| Where | Command | Notes |
|---|---|---|
| Local development | `npm run migrate -w apps/server` (`prisma migrate dev`) or `npm run migrate:deploy -w apps/server` | creates or updates `dev.db`. CI uses `migrate:deploy` on a fresh file. |
| **Turso (production)** | `npm run migrate:turso -w apps/server` | `prisma migrate deploy` cannot talk to Turso. Use the reviewed executor. |

### The Turso migration executor

`apps/server/scripts/turso-migrate.ts` (core: `src/lib/tursoMigrate.ts`) applies only migrations that are **pinned by SHA-256** in `REVIEWED_MIGRATIONS` (six at present: gallery images, gallery upload attempts, OAuth identity, `TeamMember.isPublished`, research links, publication metadata), and only these statement forms: `CREATE TABLE`, `CREATE [UNIQUE] INDEX`, and `ALTER TABLE … ADD COLUMN` with a constant default. It classifies each migration as applied, absent, partial or divergent before writing and refuses partial or divergent states. Without `--apply` it only inspects.

```powershell
# inspect only (never writes) -- run this first, always
$env:MIGRATE_TARGET_URL = "libsql://<db>.turso.io"; $env:MIGRATE_TARGET_TOKEN = "<token>"
npm run migrate:turso -w apps/server -- --expect-target <db>.turso.io

# apply (writes), only after explicit authorization and a recovery point
npm run migrate:turso -w apps/server -- --expect-target <db>.turso.io --recovery-point 2026-10-30T05:42:00Z --apply
```

Variables (names only): `MIGRATE_TARGET_URL`, `MIGRATE_TARGET_TOKEN`. The executor deliberately ignores `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and `DATABASE_URL`. Never paste a token into a document, ticket or commit. A local file can be used for a rehearsal: `MIGRATE_TARGET_URL=file:/abs/path/copy.db`.

Full procedure, gates, recovery table and limits: [`docs/architecture/turso-migration-executor.md`](../architecture/turso-migration-executor.md). Publication metadata release order: [`docs/architecture/publication-metadata-release.md`](../architecture/publication-metadata-release.md).

**Order matters:** apply the migration *before* deploying code that reads the new columns. The generated Prisma client names every column of a table in its queries, so code deployed against an unmigrated database fails with "no such column" on every page that loads that table. Old code on a migrated database keeps working.

### Backup and recovery

The repository implements no backup of its own. Production recovery relies on Turso's point-in-time recovery (check the retention window of your plan in the Turso dashboard) or a verified copy taken before a change. Dropping columns is refused by the executor and is not a routine rollback; roll back application code instead.

### Seed data

`npm run seed -w apps/server` (idempotent) creates a default administrator account and sample content in the database it points at. The administrator's email and initial password are fixed in `apps/server/prisma/seed.ts`. **Use it for local development only, and never run it against a production database;** if it has ever run against a real database, change that account's password immediately.
