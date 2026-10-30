# Releasing the Publication Metadata fields (operator notes)

Applies to migration `20261030120000_publication_metadata_fields` (eight additive columns on `Publication`; SHA-256
`df2db5062779488ec735b43de48c8710861eedb1ee6f36cf3f29969af0413a18`, pinned in `REVIEWED_MIGRATIONS`). This page is the
short operator sequence; the full Turso gates (target identity, preview isolation, recovery point, rehearsal) are in
[turso-migration-executor.md](turso-migration-executor.md), "Production procedure (gates)". Nothing here has been done yet:
the migration is applied to no hosted database and the code is not deployed.

## Order of events

Each step needs its own explicit authorization from the site owner. Authorization for one step is not authorization for the next.

1. **Review and approve the PR.** Approving it does not authorize anything below. Do not merge yet: merging to `master`
   deploys Production.
2. **Back up first.** Confirm the Turso point-in-time-recovery window for the Production database and note the current UTC
   time as the recovery point. If point-in-time recovery is not available, take and verify a copy of the database first, or stop.
3. **Apply the migration only after explicit authorization.** Run `npm run migrate:turso -w apps/server` inspect-only first
   (expect exactly this migration `absent`, every other reviewed migration `applied`), then apply with the recovery point, then
   re-run inspect-only (expect "Nothing to do"). Pinning the hash in the code does not apply it anywhere.
4. **Migration before code.** The migration must be applied **before** the code that reads the new columns is deployed. The
   generated Prisma client names every `Publication` column in its queries; the new code against a database without the
   columns fails with "no such column" on the publication pages and on every page that embeds publications (projects,
   members, workspace, home). The reverse is safe: old code against a migrated database ignores the columns.
5. **Deploy to Production only after separate explicit authorization**, after step 3 is verified. Merging deploys.
   Smoke test: `/api/health`, the publications list, one publication detail page, and Add/Edit Publication with the
   "Publication Metadata" section.
6. **Enter the publications only after the feature is released and verified** (steps 3 to 5 done and checked). Entry is by hand through
   the Lab Admin Add Publication form, following `docs/manual-publication-entry-checklist.md`. There is no importer.
7. **Check for existing records before creating any publication.** Search the site (title words and the DOI) first. The form
   refuses an identical DOI, and refuses the same title and year unless a manager or admin confirms; an existing record is edited, not re-added.
   Records 15 and 21 in the checklist are known to need this check.

## Rollback

- **Safe:** redeploy the previous application code at any time. Old code never overwrites the new columns on update and its
  inserts take the defaults.
- **Not routine:** removing the columns. The executor refuses `DROP`, and dropping them would lose any metadata already
  entered. Treat the columns as permanent. Use point-in-time recovery only for a real data incident, and remember it also
  discards every other change made after the recovery point.
