# Phase 3A + 3B release runbook: remote verification, deployment, recovery and rollback

Scope: the combined member-profile-photo (3A) and Alumni-directory / publication-consent (3B) change set, whose only
schema change is the additive migration `20261020120000_team_member_is_published`. This is the single authoritative
procedure for it. Companion documents: `turso-migration-executor.md` (what the executor guarantees),
`phase3b-alumni-directory.md`, `phase13-files-and-gallery.md`, `phase26-deployment-readiness-infrastructure-hardening.md`.

**Status of this document (2026-10-27):** section 3 has been executed once against a disposable Turso database; the results,
the documented deviations and the open items are in **section 10**. Nothing in this document has been executed against the Production
database except one read-only executor inspection (section 10.5). Every step that connects to, creates, migrates or deletes a remote database
is still `REQUIRES EXPLICIT AUTHORIZATION` and must not be run on Production until the release gates in section 10.7 are recorded as passed.

### Local evidence versus unverified remote behaviour (summary)
| Question | Local evidence (disposable SQLite files, this repository) | Still unverified (needs the disposable remote target) |
|---|---|---|
| Executor applies the pinned `ALTER`, is idempotent, refuses tampering/divergence | `unit-turso-migrate.test.ts` (173 checks) and a local rehearsal from a five-migration base file (section 2) | Turso transactional DDL, `dflt_value` text, lost-COMMIT reply shape, interrupted stream |
| New code against the migrated schema | all HTTP/UI/unit suites listed in the release report | Prisma + `@prisma/adapter-libsql` behaviour on the new queries (scenario 7) |
| Publication write cannot overwrite newer state | `test:publication-race` (22 checks): deterministic model of a competing change between the endpoint's read and write | Whether a remote database can even present the stale state; real simultaneous requests (scenario 12) |
| Knowledge-route and admin-translation transactions do not wait on themselves | `test:transaction-client` (23 checks) under `connection_limit=1` | The libsql adapter's mutex on a remote connection (scenario 13) |
| Gallery never deletes a blob whose commit is uncertain | `test:gallery-ambiguous` (27 checks), `unit-gallery-blob-cleanup` | Rate of commit-time expiry on Turso |
| Parallel interactive transactions on the dev SQLite default pool | **fail** (see section 9); not a Turso behaviour | Behaviour of concurrent requests on Turso |

## 1. Facts this runbook relies on

| Item | Value / source |
|---|---|
| Migration | `apps/server/prisma/migrations/20261020120000_team_member_is_published/migration.sql` |
| Statement | one line: `ALTER TABLE "TeamMember" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true;` |
| Pinned SHA-256 (LF-normalized) | `502f8fc34ad05d596084f980c12908c3b01b09eea5e80bb6fd8841b1bf18ce4b` (in `REVIEWED_MIGRATIONS`, `apps/server/src/lib/tursoMigrate.ts`) |
| Executor | `npm run migrate:turso -w apps/server -- <options>` → `apps/server/scripts/turso-migrate.ts` |
| Executor env | `MIGRATE_TARGET_URL`, `MIGRATE_TARGET_TOKEN` (remote only). Never echo these; never put them in a log or a shell history line you keep. |
| Executor options | `--expect-target <host>` (required), `--apply` (otherwise inspect-only), `--recovery-point <UTC ISO time>` (required with `--apply` on a remote target; ≤ 24 h old, not in the future) |
| Remote host rule | `parseTarget` accepts only `*.turso.io` hosts (and `file:` for rehearsal), and the host must equal `--expect-target` |
| Exit codes | `0` ok / nothing to do / planned; `2` refused before touching the database; `3` verification or COMMIT problem; `4` unexpected error |
| Build | `vercel.json` builds only shared + web. **There is no migration step in the build or the deployment.** The migration is always a manual operator step. |

Re-verify the pinned hash before any use: `git show <release-commit>:apps/server/prisma/migrations/20261020120000_team_member_is_published/migration.sql | sha256sum`
must print the hash above (the file has a single `\n` line ending; the executor LF-normalizes before hashing).

### Idempotency: two different things
* **Executor idempotency (real, tested locally):** after the column exists with the exact type, `NOT NULL` and default,
  a second run reports `nothing-to-do` and writes nothing.
* **Raw SQL idempotency (does not exist):** SQLite has no `ADD COLUMN IF NOT EXISTS`. Running the `.sql` file by hand twice
  fails with `duplicate column name`. Never apply this migration by pasting the SQL; always use the executor, which
  classifies the state first.

## 2. Expected schema

Pre-migration `TeamMember`: all existing columns, **no** `isPublished`. Executor inspect-only reports the migration `absent`
(and the three earlier executor-managed migrations `applied` on a Production-shaped database).

Post-migration: `TeamMember.isPublished` with declared type `BOOLEAN`, `NOT NULL`, default text `true` (SQLite stores the
literal as written; read it back and compare it to what the executor reports, because how a remote Turso database prints
`dflt_value` is unverified). Row count of `TeamMember` unchanged; **every pre-existing row has `isPublished = 1`**, so every
existing profile stays published. Executor inspect-only reports `applied` and then `nothing-to-do`.

### 2.1 The base schema (provisioning is an OPEN BLOCKER)
`apps/server/prisma/migrations` holds **nine** migrations. **Five are the base schema and are not executor-managed:** `20260918122941_init`,
`20260920131500_phase8_foundation`, `20260926120000_phase22_knowledge_base`, `20260927100000_phase23_lab_resources`,
`20261001121958_add_account_invitation`. **Four are executor-managed** (pinned in `REVIEWED_MIGRATIONS`): `20261011130000_gallery_item_images`,
`20261011140000_gallery_upload_attempts`, `20261012100000_oauth_identity` and this release's `20261020120000_team_member_is_published`.
The executor refuses an empty database (`PREREQUISITE`: `User`, `StoredFile`, `GalleryItem` must exist).

What is established locally (rehearsal on a disposable `file:` database, executed in this work; logs kept outside the repository):
a SQLite file built by executing exactly the five base migration SQL files, in name order, makes the executor report the four managed migrations
`absent`; `--apply` then reports `APPLIED:` for all four with equal row counts; a second `--apply` reports `Nothing to do`; afterwards
`PRAGMA table_info("TeamMember")` shows `isPublished`, type `BOOLEAN`, `notnull 1`, `dflt_value` `true`.

What is **not** established:
* **No verified procedure exists in this repository for putting the base schema into a Turso database.** `docs/user-guide/en/site-maintainer-guide.md`
  says only that `prisma migrate deploy` cannot reach Turso and that production migrations are applied by an audited one-off script. The executor
  documentation covers only the four managed migrations.
* Commit `7f6539d` (on `feat/phase-27-lab-website-integrations` / `feat/phase-27-completion`, **not in this branch**; its own title says "not executed") proposes:
  build a local data-free file with `prisma migrate deploy` and create a Turso database from that file (`turso db create <name> --from-file <file>`), then create a token.
  That is an unexecuted proposal; the CLI syntax in it has not been verified here and is **not** repeated as a command in this runbook.
  **Caution if it is adopted:** `prisma migrate deploy` applies all nine migrations, which already includes `isPublished`. A pre-migration seed (needed to test the
  migration) must be built from the five base files only (or, if the full nine are used, only post-migration scenarios can be run).
* Whether Production's real base schema is identical to the five migration files is unverified (the executor checks only that three tables exist and the managed objects).

**Update 2026-10-27:** the operator accepted this method **for the one disposable test database only**: the five base migration SQL files, executed in name order
(SHA-256 values in section 10.1). This settles nothing for Production: the Production schema is not provisioned this way, and any separate Production provisioning
or recovery requirement stays as stated in section 4. The text below is the original blocker statement.

**Operator decision / approved artifact required before the remote seed can be created** (this is the blocker):
(1) the exact method to create the disposable database with the five-migration base schema, named in the authorization, and
(2) the SHA-256 of the base-schema artifact (for example, of the file built from the five base migrations) so that what was loaded can be checked afterwards.

## 3. Remote Turso verification procedure (disposable target only)

Purpose: verify what local SQLite cannot — that the remote database applies this `ALTER` transactionally, how it reports
`dflt_value`, what a lost COMMIT reply and a lock conflict look like, and that Prisma + `@prisma/adapter-libsql` run the
new queries (`isPublished = true` filters, the conditional `updateMany` lock statements, the `private, no-store` photo route).

### 3.1 Target isolation (all must be true; otherwise stop)
1. The target is a database created **solely** for this verification, named so (for example `scl-verify-<date>`), in a Turso
   organization/group that holds no Production data. It is not a fork or branch that shares credentials with Production.
2. The operator writes down the target host and compares it with the Production host in Vercel (Production scope) and with every
   other environment's host. They must all differ. Do not paste any token into the comparison.
3. The credential used is a token scoped to that disposable database only. No Production or Preview token is exported in the shell
   (`env | cut -d= -f1 | grep -E 'TURSO|MIGRATE'` — names only — must show only what this procedure sets).
4. Fail-closed allowlist: the operator keeps a one-line allowlist file outside the repository containing exactly the authorized
   host. Before every command the operator checks that the host in `--expect-target` equals that line. If the file is missing,
   empty or has more than one line: stop. (The executor itself only checks that `--expect-target` equals the URL host; the
   allowlist is an operator control, not a code control.)
5. Logs: run commands with output redirected to a file outside the repo; before keeping or sharing a log, search it for the token
   string and for `authToken`, `eyJ`, `Bearer`. The executor does not print the token; verify rather than assume.

### 3.2 Synthetic seed data (disposable target only)
Seed only synthetic rows, with names that start `ZZ Verify` and emails `*@example.test`:
* the pre-migration schema = the five-migration base schema of section 2.1, provisioned by the method the operator approves there (not invented here). After it exists the executor applies the four managed migrations in order (all `absent`), or only this one on a database where the other three are `applied`;
* ≥ 3 `TeamMember` rows in the pre-migration shape: two non-alumni (one linked to a synthetic `User`, one unlinked) and one
  `category = 'ALUMNI'` row with `userId` null;
* one `StoredFile` with `entityType = 'TEAM_MEMBER'` for one non-alumni member (a profile photo) if testing the photo route.
`NOT EXECUTED — REQUIRES EXPLICIT AUTHORIZATION` (creates a database and writes to it).

### 3.3 Scenarios (each: command, expected result, evidence to keep)
All commands below are `NOT EXECUTED — REQUIRES EXPLICIT AUTHORIZATION`. `H` = the authorized disposable host.

| # | Scenario | Command (illustrative; options are only those the executor documents) | Expected |
|---|---|---|---|
| 1 | Inspect pre-migration | `MIGRATE_TARGET_URL=libsql://H MIGRATE_TARGET_TOKEN=… npm run migrate:turso -w apps/server -- --expect-target H` | exit 0; the new migration `absent`; nothing written |
| 2 | Wrong `--expect-target` | same, with a different host | exit 2 `TARGET`; nothing written |
| 3 | Apply | `… -- --expect-target H --recovery-point <UTC now> --apply` | exit 0 `APPLIED:` with only this migration; row counts equal; all rows default |
| 4 | Re-run (executor idempotency) | repeat #3 | exit 0 `Nothing to do`; schema and rows unchanged |
| 5 | Schema read-back | in the Turso shell: `PRAGMA table_info("TeamMember");` | row for `isPublished`: type `BOOLEAN`, notnull 1, `dflt_value` as recorded; compare with the executor's expectation |
| 6 | Existing-row behaviour | `SELECT COUNT(*), SUM("isPublished"=1) FROM "TeamMember";` | the two numbers equal |
| 7 | Application smoke against the disposable DB | start a local server with `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` set to the disposable target (never Production's), exercise: public `/api/team` (alumni absent), `/api/alumni` (published only, empty at first), admin publish → visible → unpublish, photo `GET` (`Cache-Control: private, no-store`), non-admin PUT on an alumni row (403) | match the local suites' expectations; record every deviation verbatim |
| 8 | Hash tamper | run the executor from a checkout whose migration file has one byte changed | exit 2 `MIGRATION_FILE`; nothing written (can be run against the disposable target in inspect-only mode) |
| 9 | Divergent state | in the Turso shell create the column differently on a second disposable DB (e.g. `INTEGER` without default) and inspect | `divergent`; `--apply` refused, nothing written |
| 10 | Interrupted run / lost COMMIT reply | cannot be provoked deterministically; kill the executor during `--apply` on the disposable DB (a few attempts, then inspect) | inspect reports `absent` (re-run) or `applied` (done); never `partial`; record what was observed. If the ambiguous-COMMIT path is never reached, say so — do not claim it was verified |
| 11 | Lock contention / real error shapes | while a long write transaction is held on the disposable DB from a second connection, run an application write that uses the lock statement (`PUT /api/team/:id`) | record the actual error class/message the remote returns; compare with `dbErrors.ts` (`SQLITE_BUSY` family → 503). If it differs, that is a **finding**, not a pass |
| 12 | Concurrent publication/category change | issue `PUT /api/team/:id/publication` and `PUT /api/team/:id` (category change) simultaneously, many times | record outcomes. Expected with the current code: the publication request answers `409` (retry) or `200`, and no non-ALUMNI row ends with `isPublished = 0`. The local test models the competing change inside one transaction; it does not prove real simultaneity or that Turso can present the stale state. Only this scenario does |
| 13 | Query on the global client inside an interactive transaction (pre-existing, unrelated to this migration) | on the disposable DB: `PUT /api/knowledge/:id` with a changed `projectId`, and `PUT /api/admin/translations/KNOWLEDGE_DOC/:id` | Both handlers now use the transaction client (fixed and locally tested under `connection_limit=1`). Expected on the remote: `200` within a second or two, no `P2028`. Background: `@prisma/adapter-libsql` 5.22 serializes every query through one mutex that an interactive transaction holds, so the old code is expected to have stalled ≈5 s and answered 500 there too; that expectation is from reading the adapter source and is **unverified remotely**. Record elapsed time and status. Also scan for any other query on the global client inside a transaction (none found in the server `routes/` and `lib/` files by a syntax-tree scan, which does not see helpers that use the global client indirectly). |

### 3.4 Evidence capture
For each scenario keep: the exact command with secrets replaced by `…`, UTC timestamp, exit code, full stdout/stderr (token-scanned),
and for DB steps the query text and result. Store outside the repository. A scenario with no recorded evidence is "not verified".

### 3.5 Cleanup
`NOT EXECUTED — REQUIRES EXPLICIT AUTHORIZATION`: delete the disposable database (Turso dashboard/CLI, by the exact name that was
authorized), revoke its token, delete local copies of logs that contain anything sensitive, unset `MIGRATE_*` / `TURSO_*` in the
shell. Record the deletion. Do not delete anything whose name or host is not on the allowlist.

## 4. Deployment procedure (Production)

Do not start until section 3 has been executed and its evidence reviewed, and the release is explicitly approved.

### 4.1 Preflight
1. Release commit identified; reviewed migration hash pinned and equal to §1; `git diff --check` clean; CI/local suites green on
   that commit (list in the release report).
2. Production host written down from the Turso dashboard and Vercel Production scope; this is `--expect-target`. Preview uses a
   different database (see `turso-migration-executor.md` gate 3).
3. Recovery point: confirm point-in-time recovery exists for the Production database, note how to restore to a timestamp, record
   the current UTC time as `--recovery-point`. If PITR is unavailable, take and verify another copy first or stop.
4. Approvals recorded: release owner, and whoever owns the Production database.

### 4.2 Order: migration first, then code
The new code **requires** the column (`isPublished` is filtered on in the public team, alumni, search, sitemap, groups and workspace queries).
1. Inspect Production (inspect-only). Expect this migration `absent`, earlier ones `applied`. Anything else: stop.
2. Rehearse on a local copy of a production-shaped database (`file:` target), twice (second run: `Nothing to do`).
3. Apply with `--recovery-point` and `--apply`. Expect `APPLIED:`, equal row counts, all rows default.
4. Re-inspect: `Nothing to do`.
5. **Schema verification before deploying code:** read `PRAGMA table_info("TeamMember")` on the target (Turso shell) and confirm `isPublished BOOLEAN NOT NULL DEFAULT true`. Do not deploy code on the strength of the executor message alone.
6. Deploy the code (merge → Vercel). Watch the deployment.

Why this order is mandatory: old code ignores the extra column (safe), but new code against a database without the column fails
— verified locally: with the column absent `GET /api/team`, `/api/alumni` and `/api/search` answer a generic `500 {"error":"Internal server error"}`
(no schema detail is sent to the client; the cause appears only in server logs). It fails closed — no profile is exposed — but the public
pages are down until the migration is applied. **`/api/health` stays `200` in that state; it does not touch the database. Do not use it as the schema-readiness signal.**
No application-level schema guard was added: the existing behaviour is already fail-closed, and a startup/import-time DB check would break the
serverless cold path and the tests. The control is this runbook's step 5 plus the smoke test below.

### 4.3 Smoke tests (after the code is live) and abort conditions
* `/api/health` → 200 (liveness only).
* Public `GET /api/team` → 200 and lists the expected current members; `GET /api/alumni` → 200 (empty until alumni are published).
* A real admin login; open Team and Alumni pages; create a synthetic alumni profile (unpublished by default), confirm it is **absent** from the public list and
  the sitemap, publish it, confirm it appears, unpublish it, delete it (leave no test data).
* Upload a profile photo for a test member; confirm `Cache-Control: private, no-store` on the photo and that it is not served to an anonymous client for an unpublished profile.
* **Abort and go to §5** if: any of `/api/team`, `/api/alumni`, `/api/search` returns 5xx; an unpublished profile or its photo is visible to an anonymous client;
  existing members disappeared from the public team page; the error rate rises above its pre-deployment level.

## 5. Recovery and rollback

First, always: run the executor in inspect-only mode and read the state; it never writes.

| Situation | State | Action |
|---|---|---|
| Migration refused before apply (exit 2) | nothing written | fix the input (target, hash, state) and re-run; do not deploy code |
| Migration failed or the process died before COMMIT | transaction not committed; schema unchanged | inspect; `absent` → re-run; `applied` → continue |
| COMMIT outcome ambiguous (`REFUSED [COMMIT]`, `applied-after-commit-error`) | executor re-reads: applied / NOT applied / partial-divergent | follow the printed verdict. "NOT applied": check connectivity, re-run. "partial/divergent": stop; restore to the recovery point or write and review a manual repair. Never re-run blindly |
| Migration succeeded, **code deployment failed** | column present; old code still serving | nothing to undo: the old code ignores the column. Fix and redeploy, or leave the old code running. The migration stays applied |
| Code deployed, smoke test fails, migration was applied | column present, new code misbehaving | **application rollback**: redeploy the previous Vercel deployment (instant rollback). This is compatible with the migrated schema — previous code never references `isPublished`; it ignores the column; new rows get the default `true` |
| Code deployed but migration not applied | public team/alumni/search 5xx | apply the migration per §4.2 (preferred), or roll the application back |

Hard limits — read before relying on rollback:
* **Application rollback does not reverse the migration.** The column stays. Redeploying the old code leaves the schema in the migrated state.
* **Warning: rolling back the application also rolls back the privacy behaviour.** Old code ignores `isPublished`: alumni profiles marked unpublished
  **become public again** on the old code's public pages (team, search, sitemap, workspace, groups). If any alumni profile has been unpublished, check that
  before rolling the application back, and take the affected profiles' content down (or restore to the recovery point) first.
* **There is no automatic down-migration and none is planned.** `DROP COLUMN` is destructive, is refused by the executor, and would lose the consent state. Removing the column,
  if ever required, is a separately reviewed manual change after the application no longer references it.
* **Database restore (PITR to the recovery point)** is the only way to return the schema to the pre-migration state; it discards every write made after the recovery point
  (all users' content, not only this feature). It is a last resort, needs the database owner, and is not a routine rollback.
* Profile photos: a stored photo blob is deleted only after the database transaction commits. After a restore, a photo row may point to a deleted blob (the file route
  then returns 404 / the member shows initials) and a blob may remain without a row; the storage reconcile unit tests describe the orphan handling. Do not restore for a photo problem alone.

## 6. Cleanup authorization and evidence
See 3.4 and 3.5. Cleanup of the disposable target is itself a remote action: it needs its own explicit authorization naming the exact database, and its
evidence (deletion confirmation, token revocation) is recorded outside the repository.

## 7. Production and Preview exclusion
The disposable target must differ from the Production host and from the Preview host; Preview must not share Production's database
(`turso-migration-executor.md`, gate 3). No step of section 3 may use a Production or Preview credential, and the Production procedure (section 4) may not start
before section 3 has run with reviewed evidence. This runbook performs none of it.

## 8. Rollback limitations
See section 5: application rollback does not reverse the migration, and it re-exposes unpublished alumni because the old code ignores `isPublished`.

## 9. Open items, known failures and what changed in this closure
### Changes made in the closure work (all locally tested; none touches the migration)
* `PUT /api/knowledge/:id` (`assertLinks`) and `PUT /api/admin/translations/:entityType/:entityId` (`def.find`) now query through the transaction client (`tx`) instead of the shared client; `contentDef(...).find` takes an optional client. Regression: `npm run test:transaction-client -w apps/server` (fails 12 checks on the old code with 500 after ≈5 s, passes 23/23 with `connection_limit=1`).
* `PUT /api/team/:id/publication` writes with a compare-and-swap (`updateMany` where `id`, `category = ALUMNI` and the `isPublished` value it read); on mismatch it answers `409` (new message `publicationConflict`, English and Japanese) and writes nothing. Regression: `npm run test:publication-race -w apps/server` (fails 7 checks on the old code: a category change between read and write left the profile hidden and audited as unpublished; a reset consent state was overwritten with "published").
* `test:gallery-ambiguous` gained the second ambiguous shape (callback completes, transaction never commits, reported as an expired transaction): blob kept, nothing committed, retry creates normally. It fails (2 checks) if cleanup is changed to delete when no row references the blob. `releaseUploadedBlob` itself is unchanged.
* `PUT /api/team/:id`, `DELETE /api/team/:id` and `PUT /api/profile`: the first statement of their lock-first transaction is wrapped in `asLockWait` (`lib/dbErrors.ts`). A Prisma `P2028` raised by that statement (and only that one) becomes a `LockWaitTimeoutError`, which the existing router handler answers as `503` + `Retry-After: 1`. Reason and evidence: section 10.3 (scenario 11). Regression: `npm run test:unit -w apps/server` (`unit-db-errors.test.ts`, 77 checks; fails 4 with the wrapper made a pass-through).
* `knowledge-regression.mjs`: the "every category is accepted" check and the five-locale authorization probes now issue their requests one after another (assertions unchanged). Reason below.

### Known behaviour that is NOT fixed
* **Parallel interactive transactions overload the default-pool embedded SQLite file.** Measured with an in-process harness on a fresh database (4 CPUs, Prisma default pool of 9): five simultaneous requests of *any* transactional route — including a read-only 403 path and a plain `POST /api/knowledge` — mostly answer 500 after 5–10 s (`P1008`/`P2028`), while five simultaneous plain `GET`s are fine. With `connection_limit` 1 or 3 the same bursts all succeed in under 100 ms; with 10 or 30 they fail. This is local-development SQLite behaviour (file locks across several pooled connections), not a property of the new code (it also occurs on the clean baseline) and not evidence about Turso, where the adapter serializes queries. It explains the former `test:knowledge` default-pool failures (the test fired ten and five simultaneous requests). It is **not** hidden by the test change: the invariant those checks test (every category accepted; locale-independent authorization) does not depend on simultaneity. Production traffic through Turso is untested for this (scenario 12/13 touch it). Changing the local pool size would be blind serialization and was not done.
* **`test:gallery` intermittent failure** (2 of 22 default-config runs: one in the first sweep, one logged in full; 16 later runs passed, including this closure's 151/151 sweep run). The logged failure is explained: exactly one `[gallery] the commit outcome is unknown and no row references blob …; keeping it (a possible orphan)` line before a commit-time `P2028` ("commit cannot be executed on an expired transaction") at `gallery.routes.ts:156`, one more blob than expected, DB rows correct. Keeping the blob is the designed safety rule and is now covered deterministically. Why the commit exceeded the 5 s limit is not proven (lock waiting among six simultaneous duplicates is the working hypothesis; the Prisma timer does not pause during busy waits). A 15-round harness of six simultaneous identical creates on the default pool did not reproduce the commit-time expiry (0 of 15) but showed the same burst fragility as above (12 of 15 rounds had every request fail at transaction start, with the blob correctly removed because no commit was attempted; blob delta never exceeded 1). The strict blob-count assertion in the default-pool branch of `gallery-regression.mjs` is unchanged.
* Read-first paths remain: the publication endpoint (now compare-and-swap), user linking and invitation accept (conditional writes: `userId: null`, `NOT ALUMNI`). Their concurrent behaviour on Turso is unproven.
* The per-view cost of the `private, no-store` photo policy on Turso is unmeasured; a production-safe measurement is the Turso dashboard's rows-read counters before/after the release plus request counts for the photo route from platform logs (no per-user data).
* Remote Turso behaviour is **unverified** until section 3 is run with evidence.

## 10. Remote verification results (disposable Turso target) and release decision

Target: database `scl-disposable-3ab-20261027`, id `01a17b03-8801-75e0-aace-17688b8b3db2`, organization `smart-computing-lab`, group `default`, region `aws-ap-northeast-1`,
created 2026-10-27 for this verification only. Code under test: `ba57347198f5610d2fa22c97f73eb0237532bdc2` plus the scenario-11 change of section 10.3. Evidence (token-scanned, kept outside the repository):
one archive of the run's logs and scripts; per-scenario file names are given below.

### 10.1 Provisioning (documented deviation, accepted for the disposable target only)
The empty database was loaded by executing the five base migration files in name order. SHA-256: `init` `8bcd469d9dbe8d238968f602bb059185b8049fdea8a6c51d2bde1d0cc31a16e7`;
`phase8_foundation` `b77846acbf2b0d48e2797a07b7df8db2b47bcfceda3f9bf77445b71bceb19b8d`; `phase22_knowledge_base` `d84cb9a76405155c327ac25ab757d94e9bcff60fdd9d89e62a85ba0c862020bd`;
`phase23_lab_resources` `0ddbfa5767c0c317ab2a27fd1326266328ac6c8d6f81295afaf904cd82defb3d`; `add_account_invitation` `a3c897de94c6b8babe148ca9f43ecb842f7d599bc3ace4cf7c5b52a56687a594`.
Synthetic seed: 2 users, 3 `TeamMember` rows (all names `ZZ Verify ...`, emails `*@example.test`). The migration hash `502f8fc34ad05d596084f980c12908c3b01b09eea5e80bb6fd8841b1bf18ce4b` was re-verified from the release commit.
All commands ran with a scrubbed environment (only the disposable host and a token scoped to that database); the host differs from the Production host and every other database host.

### 10.2 Results
| # | Result | Notes |
|---|---|---|
| 1 | Pass | exit 0, new migration `absent`, nothing written (`01-inspect-pre`) |
| 2 | Pass | exit 2 `TARGET` (`02-wrong-target`) |
| 3 | Pass, **deviation** | the base-only database had all four managed migrations absent, so all four were applied in one run, not only this one; row counts equal (`03-apply`) |
| 4 | Pass | `Nothing to do` (`04-rerun`) |
| 5 | Pass | `isPublished`, type `BOOLEAN`, notnull 1, `dflt_value` `true` (a remote Turso prints the same as local SQLite) (`05-06-readback`) |
| 6 | Pass | 3 of 3 rows `isPublished = 1` |
| 7 | Pass | public team/alumni/search/sitemap, admin publish/unpublish, non-admin 403, photo `Cache-Control: private, no-store` (`07b-12b-app`). First attempt had a wrong test premise (a row seeded before the migration is published by design) and was redone with an alumni profile created through the API |
| 8 | Pass | exit 2 `MIGRATION_FILE`, nothing written (`08-tamper`) |
| 9 | Pass, **deviation** | no second database was authorized: the column was dropped and re-added as `INTEGER` on the same disposable database; `divergent`, inspect and apply both refused with nothing written; restored through the executor (`09-*`) |
| 10 | Pass for the simulated cases; real-kill timing **not** proven | see 10.4 |
| 11 | **Finding, fixed** | section 10.3 |
| 12 | Conflict protection verified; the 409 branch is **not reachable** on this remote | section 10.4 |
| 13 | Pass | `PUT /api/knowledge/:id` 200 in 1.7 s, `PUT /api/admin/translations/...` 200 in 2.6 s, no `P2028` (`07-11-12-13-app`) |

### 10.3 Scenario 11: lock contention on a remote database
Observed: while another connection holds the write lock, a remote Turso database does **not** answer `SQLITE_BUSY`. The application's first (lock) statement waits; Prisma expires the transaction at 5 s and rejects
with `P2028`, which has no lock-specific text and also describes unrelated expiries. The request answered a generic `500` after 7-10 s (before the change). Nothing was written.
Why `P2028` alone is not classified: a `P2028` from a later statement or from the COMMIT can follow an applied commit on a remote database. Why the first statement can be: the callback throws before any other statement, so no COMMIT is sent
and nothing of that request persists. Hence `asLockWait` wraps only the first statement of `PUT /api/team/:id`, `DELETE /api/team/:id` and `PUT /api/profile`.
Re-run on the remote with the change (`15-...`, `17-...`): each of those three answers `503` + `Retry-After: 1` with nothing written and succeeds on retry; the publication route (first statement is a read) stays a plain `500` under a 9 s write-lock hold, as designed.
Known limits: the `503` arrives only when the lock is released (9.3 s for an 8 s hold), because the blocked statement does not return earlier; routes whose first statement is not a plain lock write (`POST /api/profile/photo`, file delete, publication, team create) are unchanged and still answer `500` in this situation.
Several requests on one server instance queue behind the adapter's connection mutex, so they do not all meet the database lock at once (an early probe was confounded by this).
Tests: `unit-db-errors.test.ts` covers the observed remote `P2028` text, a real Prisma expiry on the first statement (converted), a later-statement expiry and a commit-time expiry (not converted), `P1008`, constraint errors and `SQLITE_BUSY` (unchanged), and the 503 handler.

### 10.4 Scenarios 10 and 12 in detail
**10.** Five real `kill -9` attempts (2-12 s into `--apply`) always left the migration `absent`, never `partial`; they were not shown to land inside the transaction. Deterministic, test-only harness (outside the repository, using the executor's existing `wrapTransaction` seam, no production hook) against the real remote:
(a) COMMIT applied but reply lost: `applied-after-commit-error`, column present, 6 of 6 rows published; (b) COMMIT never sent: `REFUSED [COMMIT]` "NOT applied", state `absent`; (c) connection abandoned mid-transaction with no rollback: same refusal, state `absent`, no lingering lock. A real network-level lost reply was not produced; (a) is a simulation.
**12.** 30 simultaneous publication/category-change rounds: no non-ALUMNI row ended unpublished, but the publication request answered 200 every time and the 409 branch was never reached. A deterministic interleaving (second connection holds the write lock, the request reads, a competing commit lands, the lock is released) returned **503**, not 409, in 4 of 4 rounds:
the remote rejects a transaction that read and then writes after a competing commit with `SQLITE_BUSY` ("database is locked"), which the existing handler maps to `503` + `Retry-After`. In every round the competing state was preserved and no audit row was written. The compare-and-swap `409 publicationConflict` therefore remains verified only by `test:publication-race` and is **not** a remote-verified response.

### 10.5 Production (read-only only)
Executor inspect-only with the read-only credential (no `--apply`, exit 0): the three earlier migrations `applied`, `20261020120000_team_member_is_published` `absent`; rows `{"User":4,"StoredFile":4,"GalleryItem":1,"StoredFile(live)":2}`. The live site is on the previous code (`/api/health` 200, `/api/team` 200, `/api/alumni` 404). The Production database, the Preview database and the five other pre-existing databases were not modified.

### 10.6 Rollback risk (unchanged, verified against the code)
Application rollback does not reverse the migration, and old code ignores `isPublished`, so unpublished alumni become public on a rolled-back application (section 5). If any alumni profile has been unpublished, take it down or restore first.
Point-in-time recovery for the Production database was **not** verified in this session (it needs the Turso dashboard for the plan); the recorded `--recovery-point` and the PITR window must be confirmed by the database owner immediately before the migration.

### 10.7 Release gates still required before any Production operation
1. Operator confirms PITR availability and records the recovery point (section 4.1.3), and the approvals of 4.1.4.
2. Explicit approval to apply the migration to Production, then to merge PR #16 (which deploys), in that order (section 4.2).
3. Re-run the executor inspection on Production immediately before applying (state must still be: this migration `absent`, earlier ones `applied`).
