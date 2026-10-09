# Publication source provenance and spreadsheet import

Status: **groundwork only.** Nothing in this document has been applied to Production, any shared database or a Preview, and no live import has been performed.
This branch (`feat/publication-source-provenance`, PR #9) is **stacked on Phase 27** (`feat/phase-27-lab-website-integrations`, PR #8); see
`phase27-lab-website-integrations.md` for the schema guard, the Phase 27 migration, the Preview/Turso runbooks and the privacy policy this builds on.

## 1. Dependency on Phase 27 (read before merging)
- This branch **needs** Phase 27's schema guard (`lib/schemaGuard.ts`, absent from `master`), its migration `20261008090552_phase27_integrations` and its design doc.
  Its pull request therefore targets the Phase 27 branch, **not `master`** (against `master` it would also contain all of Phase 27 and look mergeable on its own).
- **Textual conflicts are possible and must be resolved before integration.** The two branches are based on the same commit (`fde25fc`) and both edit shared files.
  An earlier version of this document said they touch disjoint files and cannot conflict; that was wrong. A read-only merge simulation found conflicts in
  `apps/server/package.json` (both branches edit the `scripts` block) and in the end of the Phase 27 design doc.
- To keep the stack mergeable this branch (a) puts its npm scripts where Phase 27 does not touch, and does **not** append to the `test:unit` chain — its unit test
  runs as `npm run test:unit-provenance -w apps/server` (add it to the chain when the two PRs are integrated); (b) keeps all publication documentation in **this** file
  rather than appending to the Phase 27 doc; (c) corrects stale privacy wording: the Phase 27 doc §14 (its first half is byte-identical to the Phase 27 head, so those hunks merge cleanly, and the superseded
  "recommended default" subsection is replaced) and the `team.publishedHint` UI string (EN/JA), which Phase 27 did not touch. The new wording describes the behaviour of the Phase 27 head; on this branch alone the privacy implementation is absent. Re-run a merge simulation (`git merge-tree`) after either branch moves.
- Release order, once both PRs are approved by the owner: **Phase 27 migration → provenance migration → code**, each only after the checklist in §6. The guard probes both
  migrations, so code deployed against a database that lacks either answers a clean `503 DB_SCHEMA_BEHIND` instead of failing with 500s (the guard's real-Turso wording is still unverified).

## 2. Schema (migration `20261009100000_publication_source_provenance`, strictly additive)
`Publication.sourceOrder INTEGER NULL` (position in the source list; NULL for every other publication) and table `PublicationSourceRecord` (verbatim source cells with original
labels in `rawFields`, derived values in `normalized`, unique `sourceKey = <file hash>:<sheet>:<first row>`, a `disposition`, and an optional link to a publication), plus three indexes.
No DROP, RENAME, UPDATE or table rebuild (asserted in `schema-compat-regression`). `Publication.year` is **not** changed.

## 3. Visibility rule (owner-approved) and where it is enforced
Only a status cell that is exactly `出版` (published) may make an imported record `PUBLIC`. `投稿中` (submitted), `受理` (accepted), blank and anything unrecognised are `LAB_ONLY`;
blank/unrecognised are also flagged *ambiguous* in the provenance `note`. A manifest can only make a record more private. Nothing is inferred from a DOI, year, title or venue.
The verbatim status is kept in `rawFields` and in `normalized.statusVerbatim`. `LAB_ONLY` is enforced server-side by `visibleTo()` on every read path;
`publication-visibility-regression.mjs` imports a synthetic manifest through the real importer and asks the list, browse (query/year/researcher/project/area/group/sort), detail, authors,
search, profile, project, group, research-area, resource, workspace and sitemap endpoints as guest, member and manager. Signed-in lab members see `LAB_ONLY` records by the existing rule.

## 4. Importer (`apps/server/scripts/publication-source-import.ts`)
Generic; the real data lives in a manifest **outside** the repository. Dry run by default. It refuses: a URL or `file:` target, a path inside the repository (checked on the
**canonical** path, so a symlink cannot smuggle an in-repo database past the check), a nonexistent file (it never creates a database), a file without the
`_disposable_import_target` marker table, and any run where `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` is set. It never migrates, never loads credentials or Turso code, never updates
or deletes an existing publication (a possible duplicate is only recorded next to the existing row, with the field-level differences), runs in one transaction and is idempotent by `sourceKey`.
Records without a year are staged in the provenance table, never skipped and never given an invented year.

## 5. The workbook-to-manifest builder is EXTERNAL (not in this repository)
- **What is external:** the transformation from the lab's `.xlsx` to the manifest JSON. It exists only as a set of ad-hoc Python (standard library, no dependencies) scripts
  from the working session that parse the workbook XML, read fixed 10-row blocks and write the manifest. They are hard-coded to one form layout and to a local seed database
  (used only for warnings), so they were deliberately **not** committed: recreating them as a general tool would risk changing which source cell means what, and a replacement
  has not been verified against the original. In this session the scripts did regenerate a byte-identical manifest from the same workbook, which supports determinism but is not a repository guarantee.
- **Input it expects:** one visible sheet, publication blocks of 10 rows starting at row 7 (label column B; values in C–H; year and month in row 8 of each block; status in row 9),
  plus a header area (rows 1–6) that is preserved as sheet-level fields.
- **Output it produces:** `{ format: "publication-import-manifest/1", batchId, sourceFile, sourceSha256, records: [{ sheet, rowStart, rowEnd, seq, fields: [{ column, label, value }],
  publication: { year|null, title, authors, venue, doi|null, status }, warnings }] }`. `fields` must contain every populated cell of the block (and hyperlink/formula targets).
- **What the importer checks after the manifest exists:** format and 64-hex file hash; unique sequence numbers and source keys; per-record validation with the normal publication schema;
  duplicates by DOI or normalised title; one provenance row per manifest record.
- **What it does NOT check:** that the manifest contains **every** block of the workbook or every populated cell. **Manifest completeness is not guaranteed by the importer.**
- **Required before any future live import:** keep the builder source and the manifest under the owner's control; record the workbook SHA-256 and the manifest SHA-256; have a second person (or a
  separately written script) independently re-read the original workbook and confirm that the block count, row ranges and every populated cell appear in the manifest; confirm the
  result of a dry run and a disposable-database import against that manifest; and obtain explicit owner approval naming the exact target database (see §6).

## 6. Before ANY future shared or Production migration or import (checklist; nothing here has been done)
1. **Name the exact target.** Identify the database (provider, project, database name, host) and confirm in writing that it is the intended environment. A Vercel Preview is not assumed isolated: treat
   it as Production until its database host and variable scopes have been compared (see the Phase 27 doc §12/§16).
2. **Take a verified backup first.** A restorable snapshot, branch or export appropriate to the provider (for Turso: a database branch/point-in-time restore or a full dump), taken immediately before the change.
3. **Prove it can be restored.** Restore the backup into a *separate, disposable* database and check row counts and integrity. An unrestored backup is not evidence.
4. **Write the plan.** List the exact migration names and their order (`20261008090552_phase27_integrations`, then `20261009100000_publication_source_provenance`), who runs them, and how.
5. **Owner approval before each step**, separately for each shared/Production migration and for any import.
6. **After migrating, before deploying code:** run read-only checks that the expected tables/columns exist and that `PRAGMA integrity_check` / foreign-key checks are clean, and that existing row counts are unchanged. Deploy code only when the required schema is present and verified.
7. **Recovery procedure and its limits.** The migrations are additive, so *application code* can be rolled back without touching the schema (older code ignores the new nullable column and tables; this was measured for the Phase 27 migration on
   unmodified `master`, and is **not yet measured** for the provenance migration). They have no down-migration: removing the new tables/columns, or recovering data, means restoring the pre-migration backup, which also discards any writes made after it. Decide in advance what to do
   about writes made between the migration and a restore.
8. A **live import** is a separate decision: it needs its own target verification, a fresh backup, the independent manifest verification in §5, and approval.

## 7. Making `Publication.year` nullable: scope and risk (NOT done; deferred by decision)
*Why it is not additive:* SQLite cannot drop `NOT NULL`, so Prisma emits `RedefineTables` (create `new_Publication`, copy, `DROP TABLE "Publication"`, rename, recreate indexes) with `PRAGMA foreign_keys=OFF`. Several tables reference
`Publication` (`PublicationAuthor`, `ProjectPublication`, `LabResource`, `PublicationCandidate`, and the provenance table), and an HTTP migration to Turso cannot rely on that `PRAGMA` inside a transaction; a mistake could orphan or cascade-delete link rows.
It needs a rehearsed rollback and a verified disposable remote database first.
*Code that assumes a year:* server — `routes/publicationImports.routes.ts` (9 uses), `lib/publicationHub.ts` (7: sorting, year filter, years facet), `routes/member.routes.ts` (5), `lib/search.ts` (5), `routes/publications.routes.ts` (3), `lib/serializers.ts` (2),
`lib/publications/{crossref,orcid,sync,types}.ts` (5), and one each in `routes/projects.routes.ts`, `lib/workspace.ts`, `lib/researchGraph.ts`, `lib/adminContent.ts`; web — `PublicationsPage` (5), `PublicationDetailPage` (3), `PublicationFormModal` (3), `MemberPage` (2) and one each in `PublicationItem`,
`ProjectDetailPage`, `PublicationImportsPage`, `useResourceOptions`; shared — `schemas/publication.ts` (required year 1900–2100, query filters), `publicationImport.ts`, `admin.ts`.
*Behaviour it would force:* where undated items sort, how the year facet and `?year=` treat them, what list/detail/search show instead of a year, whether an editor may save an undated record, and the candidate queue (`PublicationCandidate.year` is also required).

## 8. What has and has not been verified
Verified only against disposable local databases (synthetic fixtures and the seeded local data): importer behaviour, idempotency, duplicate recording, visibility enforcement, additive-migration checks.
**Not verified:** anything against a live database or Production data; the remote Turso guard (no disposable Turso database exists yet); Preview isolation; the provenance migration's effect on `master`.
Open data questions (existing-record year differences, a possible related arXiv record, minor metadata differences, seven records without a year, ambiguous statuses) are recorded in the provenance notes and need the owner's decision.
