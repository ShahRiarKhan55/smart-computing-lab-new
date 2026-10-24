# Applying the reviewed migrations to Turso (`migrate:turso`)

`prisma migrate deploy` cannot talk to Turso (see the site maintainer guide, "Deployment"). The additive migrations
that are applied to Turso are therefore run with a small, reviewed executor. The reviewed set is exactly these three,
in this order (`REVIEWED_MIGRATIONS` in `src/lib/tursoMigrate.ts`):

| Migration | Creates | Reviewed SHA-256 (CRLF normalised to LF) |
|---|---|---|
| `20261011130000_gallery_item_images` | `GalleryImage` | `aee1e5aa992ef1c0db9c66133326a6b9503f27d3a52edf4e7d6968bf6ecc6728` |
| `20261011140000_gallery_upload_attempts` | `GalleryUploadAttempt` | `20d099cc1dd7f7c30deaabf92a10ed12355b982e627435142efb17c585228e81` |
| `20261012100000_oauth_identity` (Phase 2.2) | `OAuthIdentity` (FK to `User` ON DELETE CASCADE; unique `(provider, subject)` and `(userId, provider)`) | `7803d5ae2f5a02efc308928e56305763344250015721b8253bfa505959822a2e` |

A migration directory that is not in this table is never read or run, a pinned file whose bytes differ (even by a
trailing space) is refused, and even a file whose hash matches must still consist only of plain additive
`CREATE TABLE` / `CREATE [UNIQUE] INDEX` statements. Adding a migration to this release path means a reviewed code
change to `REVIEWED_MIGRATIONS` (and its tests); there is no configuration switch. Listing a migration here does NOT apply
it anywhere: applying is a separate, explicitly approved, operator-run step against a confirmed target.

Code: `apps/server/src/lib/tursoMigrate.ts` (core) and `apps/server/scripts/turso-migrate.ts` (command line).
Tests: `apps/server/scripts/unit-turso-migrate.test.ts` (part of `npm run test:unit -w apps/server`).

## What it guarantees (and where that is tested)

| Property | How |
|---|---|
| Only reviewed SQL runs | Each migration file's SHA-256 (CRLF-normalised) is pinned in `REVIEWED_MIGRATIONS` (table above). A changed file is refused; an unpinned directory is ignored. |
| Only additive SQL runs | Only `CREATE TABLE` / `CREATE [UNIQUE] INDEX` statements are accepted; `DROP`, `ALTER`, `INSERT`, `UPDATE`, `DELETE`, `PRAGMA`, triggers, views, quotes and block comments are refused. |
| Explicit target | The target comes ONLY from `MIGRATE_TARGET_URL` / `MIGRATE_TARGET_TOKEN`. `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and `DATABASE_URL` are never read. No target = refused. |
| Identity confirmed before any SQL | `--expect-target` is mandatory (even to inspect) and must equal the target's host (remote) or absolute path (file) exactly. A remote URL must be `libsql://` or `https://`, a `*.turso.io` host, with no credentials, path or query in the URL. |
| No credentials printed | The token is read from the environment only (never a flag), URL/token are redacted from error text, and refusal messages never include them. |
| Looks like this app's database | `User`, `StoredFile`, `GalleryItem` (and any table the new SQL references) must exist, otherwise the run is refused. |
| Detects applied / partial / divergent | Each migration is classified `absent`, `applied`, `partial` or `divergent` by comparing the target with a reference schema built by running the migration's own SQL in an empty in-memory database (SQL text, columns, foreign keys, indexes). Extra objects named like the new tables are `divergent`. |
| Fails closed | `partial` or `divergent` (or an unexpected object) stops the run with exit 2 before anything is written, in both inspect and apply mode. |
| One transaction | All pending SQL runs in ONE write transaction. Inside it the executor re-checks the state, applies the SQL, verifies the exact schema against the reference and that `User` / `StoredFile` / `StoredFile(live)` / `GalleryItem` row counts are unchanged, and only then commits. Any problem rolls back. |
| Ambiguous COMMIT | If COMMIT reports an error the executor re-reads the database and reports one of: applied (verified), NOT applied (safe to re-run), or partial/divergent (stop). |
| Idempotent | Running it again on a fully migrated database does nothing. |
| Remote apply needs a stated recovery point | `--recovery-point <UTC ISO time>` is required to apply to a remote database; it must be parseable, not in the future and not older than 24 h. It is printed in the log. The tool cannot verify a backup. |

## Usage

Inspect only (the default; never writes). Run this first, always:

```
MIGRATE_TARGET_URL=libsql://<db>.turso.io MIGRATE_TARGET_TOKEN=<token> \
  npm run migrate:turso -w apps/server -- --expect-target <db>.turso.io
```

Apply (writes), only after every gate in "Production procedure" below has passed:

```
MIGRATE_TARGET_URL=libsql://<db>.turso.io MIGRATE_TARGET_TOKEN=<token> \
  npm run migrate:turso -w apps/server -- --expect-target <db>.turso.io --recovery-point 2026-10-12T01:30:00Z --apply
```

Rehearsal on a local copy (no token, absolute path):

```
MIGRATE_TARGET_URL=file:/abs/path/copy.db npm run migrate:turso -w apps/server -- --expect-target file:/abs/path/copy.db --apply
```

Exit codes: `0` ok / nothing to do / planned; `2` refused before touching the database (bad target, hash mismatch,
unsafe state); `3` verification or COMMIT problem; `4` unexpected error.

## The Phase 2.2 OAuth identity migration

`20261012100000_oauth_identity` is additive (one table, two unique indexes, no change to existing tables or rows). On a
database where the gallery migrations are already applied (the expected Production shape), inspect-only reports
`applied, applied, absent` and `--apply` runs ONLY the OAuth migration. On a database that has none of the three (for
example a fresh Preview database that predates the gallery release), all three are applied in order. The code that uses
`OAuthIdentity` must not be deployed to an environment before its table exists. The same gates below apply (explicit
target, recovery point, rehearsal on a local copy, inspect before apply, independent re-inspection); the "Production"
gate text was written for the gallery release; read "both migrations" there as "the migrations the inspect-only run reports as `absent`".
Preview must use its own database: confirm the Preview-scoped `TURSO_DATABASE_URL` host differs from Production's before
selecting a target, because the executor identifies a target only by the host the operator confirms.

## Production procedure (gates)

1. **Repository.** The PR is approved and checks are green; the release commit contains the reviewed migrations with the
   hashes pinned in `REVIEWED_MIGRATIONS` (the executor refuses otherwise). Do NOT merge yet: merging deploys Production.
2. **Target identity.** In the Turso dashboard, open the database that the Production Vercel project uses
   (compare the `TURSO_DATABASE_URL` host shown in Vercel's Production environment variables with the database's
   hostname in Turso; do not paste the token anywhere). Write down the host. That host is `--expect-target`.
3. **Preview isolation.** In Vercel, check the environment scope of `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`. If Preview
   uses the same database, a Preview deployment of this branch runs the new code against the production database; do not
   use uploads on such a Preview and do not rely on it. Preferably give Preview its own database.
4. **Recovery point.** In the Turso dashboard confirm the point-in-time-recovery window for this database and that you
   know how to restore to a timestamp (Turso's documentation describes the procedure). Note the current UTC time as the
   recovery point. If PITR is not available on the plan, take and verify another copy of the database first, or stop.
5. **Rehearse.** Run the apply command against a local copy of a production-shaped database (see "Rehearsal"), then
   run it again (it must say "Nothing to do").
6. **Inspect production** with the inspect-only command. Expect exactly the migrations you intend to apply to be `absent` (already-released ones `applied`). Anything else: stop.
7. **Apply** with `--apply` and the recovery point. Expect `APPLIED:` followed by exactly the migrations that were `absent`, state after `applied`, and equal
   row counts.
8. **Independent check.** Re-run the inspect-only command: expect "Nothing to do". Optionally confirm in the Turso shell
   that `GalleryImage` and `GalleryUploadAttempt` exist.
9. **Only now merge** the PR and watch the Production deployment. Smoke test: `/api/health`, a real login, the gallery
   page, then a controlled multi-image upload and delete of that test entry.

## Recovery from a failed or interrupted run

Start every recovery with the inspect-only command; it never writes.

| What happened | State to expect | What to do |
|---|---|---|
| Refused before applying (exit 2, `TARGET` / `MIGRATION_FILE` / `PREREQUISITE`) | Nothing was written | Fix the input and re-run. |
| `REFUSED [STATE]` (partial / divergent / unexpected object) | Nothing was written by this run; the database was already in that state | Do NOT re-run blindly. Find out how it got there. Either restore to the recovery point (PITR) or write and review a manual repair. |
| Process killed or connection lost before COMMIT | The write transaction was not committed, so the schema should be unchanged | Inspect. `absent` -> re-run. `applied` -> done. `partial` -> treat as the STATE row. |
| `REFUSED [VERIFY]` (exit 3) before COMMIT | Rolled back | Inspect to confirm `absent`; investigate the cause before any re-run. |
| `REFUSED [COMMIT]` "NOT applied" | Not applied | Check connectivity and re-run. |
| `REFUSED [COMMIT]` "partial or divergent" | Unknown | Stop. Restore to the recovery point or repair manually. |
| `applied-after-commit-error` | Applied and verified | Nothing to do; continue with the procedure. |

## Limits of the evidence

The tests use disposable local SQLite files only (the checks in `unit-turso-migrate.test.ts` include the OAuth
migration's pin, its tamper variants, its partial/divergent states and the gallery-already-applied shape). They prove the executor's logic, its refusals and its rollback
behaviour on SQLite. They do NOT prove that a remote Turso database honours transactional DDL, how it reports a lost
COMMIT reply, how it handles an interrupted stream, or that a given credential really belongs to Production. For those
reasons the executor never trusts a single signal: it classifies before, verifies inside the transaction, and
re-inspects afterwards, and it needs the operator's independent confirmation of the target and the recovery point.
It does not create a backup and cannot verify one. It does not record the migrations anywhere (Prisma's migration
table is not maintained on Turso); the schema itself is the record, and the inspect-only command is how to read it.

Also NOT proven by local SQLite, and relevant to the Phase 2.2 code that this migration supports: that
`@prisma/adapter-libsql` runs the application's raw `json_remove` / `json_extract` session statement
(`$executeRaw`) and reports affected rows exactly as local SQLite does, and that a remote Turso database enforces the
`ON DELETE CASCADE` foreign key. These need a rehearsal against a throwaway (non-Production) Turso database before
relying on them.
