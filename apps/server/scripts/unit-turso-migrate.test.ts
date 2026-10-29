/**
 * Tests of the gallery migration executor (src/lib/tursoMigrate.ts, scripts/turso-migrate.ts) using ONLY
 * disposable LOCAL SQLite files in a temp directory. It never connects to Turso or any network service and never
 * reads TURSO_* / DATABASE_URL.   npm run test:unit -w apps/server
 *
 * What this proves: the executor's own logic (target gate, pinned hashes, additive-only check, state
 * classification, fail-closed behaviour, in-transaction verification, rollback, ambiguous-COMMIT handling) on
 * SQLite. What it cannot prove: how a REMOTE Turso database behaves (transactional DDL, a lost COMMIT reply,
 * which database a credential points at). See docs/architecture/turso-migration-executor.md.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient, type Client, type Transaction } from "@libsql/client";
import {
  COUNTED_TABLES,
  MigrationRefusal,
  REVIEWED_MIGRATIONS,
  assertRecoveryPoint,
  classify,
  countTables,
  execute,
  expectedSchema,
  loadReviewedMigrations,
  parseAdditive,
  parseTarget,
  redact,
  sha256,
  splitStatements,
} from "../src/lib/tursoMigrate.ts";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));
const rejects = async (fn: () => unknown | Promise<unknown>, code?: string) => {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof MigrationRefusal && (code === undefined || e.code === code);
  }
};

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SERVER_ROOT = path.resolve(HERE, "..");
const MIGRATIONS_DIR = path.join(SERVER_ROOT, "prisma", "migrations");
const TSX_CLI = path.join(path.resolve(SERVER_ROOT, "..", ".."), "node_modules", "tsx", "dist", "cli.mjs");
const TMP = mkdtempSync(path.join(tmpdir(), "turso-migrate-test-"));
let n = 0;

/** A database as production is believed to be before this release: every EARLIER migration applied, plus a few rows. */
async function preReleaseDb(): Promise<{ file: string; url: string; client: Client }> {
  const file = path.join(TMP, `db-${++n}.db`);
  const client = createClient({ url: `file:${file}` });
  const reviewed = new Set(REVIEWED_MIGRATIONS.map((m) => m.name));
  for (const dir of readdirSync(MIGRATIONS_DIR).filter((d) => /^\d{14}_/.test(d) && !reviewed.has(d)).sort()) {
    await client.executeMultiple(readFileSync(path.join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"));
  }
  await client.execute({ sql: `INSERT INTO "User" ("id","email","passwordHash","role","createdAt","updatedAt") VALUES ('u1','a@example.test','x','MEMBER',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, args: [] }).catch(async () => {
    // column sets differ between schema versions; fall back to discovering the NOT NULL columns
    const cols = (await client.execute(`PRAGMA table_info("User")`)).rows;
    const names = cols.filter((c) => Number(c.notnull) === 1 && c.dflt_value === null).map((c) => String(c.name));
    await client.execute({ sql: `INSERT INTO "User" (${names.map((x) => `"${x}"`).join(",")}) VALUES (${names.map(() => "'x'").join(",")})`, args: [] });
  });
  return { file, url: `file:${file}`, client };
}
async function addRows(client: Client) {
  const cols = async (table: string) => (await client.execute(`PRAGMA table_info("${table}")`)).rows.filter((c) => Number(c.notnull) === 1 && c.dflt_value === null).map((c) => String(c.name));
  const sf = await cols("StoredFile");
  await client.execute(`INSERT INTO "StoredFile" (${sf.map((x) => `"${x}"`).join(",")}) VALUES (${sf.map((c) => (c === "sizeBytes" ? "1" : "'x'")).join(",")})`);
  const sfId = String((await client.execute(`SELECT id FROM "StoredFile" LIMIT 1`)).rows[0].id);
  const gi = await cols("GalleryItem");
  await client.execute(`INSERT INTO "GalleryItem" (${gi.map((x) => `"${x}"`).join(",")}) VALUES (${gi.map((c) => (c === "fileId" ? `'${sfId}'` : "'x'")).join(",")})`);
}
const reviewed = () => loadReviewedMigrations(MIGRATIONS_DIR);
const GALLERY_1 = { name: "20261011130000_gallery_item_images", sha256: "aee1e5aa992ef1c0db9c66133326a6b9503f27d3a52edf4e7d6968bf6ecc6728" };
const GALLERY_2 = { name: "20261011140000_gallery_upload_attempts", sha256: "20d099cc1dd7f7c30deaabf92a10ed12355b982e627435142efb17c585228e81" };
const OAUTH = { name: "20261012100000_oauth_identity", sha256: "7803d5ae2f5a02efc308928e56305763344250015721b8253bfa505959822a2e" };
const TEAM = { name: "20261020120000_team_member_is_published", sha256: "502f8fc34ad05d596084f980c12908c3b01b09eea5e80bb6fd8841b1bf18ce4b" };
const RESEARCH = { name: "20261027120000_team_member_research_links", sha256: "61e1bfbe7b159897cdb08c024b515fc8e74e94e978948dc2a4aae92e0cb69a44" };
const PUBLICATION = { name: "20261029120000_publication_bibliographic_fields", sha256: "b6cdc2ce390cbdcfc2f82bd2d3aec6c7874cab9cd61fe7c171f442b50454212e" };
const copyMigrations = (dest: string, names: string[]) => {
  for (const n of names) {
    mkdirSync(path.join(dest, n), { recursive: true });
    copyFileSync(path.join(MIGRATIONS_DIR, n, "migration.sql"), path.join(dest, n, "migration.sql"));
  }
};
const schemaDump = async (c: Client) => JSON.stringify((await c.execute(`SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name`)).rows.map((r) => [r.type, r.name, r.tbl_name, r.sql]));

// =========================================================================================================
// 1. Migration files: pinned, additive, parsed
{
  const m = reviewed();
  t("the reviewed set is exactly the two gallery migrations, the OAuth identity migration, the Phase 3B isPublished column, the Phase 3C research links and the publication bibliographic columns, in that order, with these exact pins", JSON.stringify(REVIEWED_MIGRATIONS) === JSON.stringify([GALLERY_1, GALLERY_2, OAUTH, TEAM, RESEARCH, PUBLICATION]));
  t("the six reviewed migrations load (hashes match the files on disk)", m.length === 6 && m[0].name === GALLERY_1.name && m[1].name === GALLERY_2.name && m[2].name === OAUTH.name && m[3].name === TEAM.name && m[4].name === RESEARCH.name && m[5].name === PUBLICATION.name);
  t("the OAuth migration file on disk hashes to its pin", sha256(readFileSync(path.join(MIGRATIONS_DIR, OAUTH.name, "migration.sql"), "utf8").replace(/\r\n/g, "\n")) === OAUTH.sha256);
  t("the first three contain 3 statements each (1 table + 2 indexes)", m.slice(0, 3).every((x) => x.statements.length === 3 && x.statements.filter((s) => s.kind === "table").length === 1));
  t("the Phase 3B migration is exactly one column statement: TeamMember.isPublished BOOLEAN NOT NULL DEFAULT true", m[3].statements.length === 1 && m[3].statements[0].kind === "column" && m[3].statements[0].name === "TeamMember.isPublished" && m[3].statements[0].column?.type === "BOOLEAN" && m[3].statements[0].column?.defaultValue === "true");
  t("the first migration references GalleryItem and StoredFile; the second and the OAuth one reference User", m[0].statements[0].references.sort().join() === "GalleryItem,StoredFile" && m[1].statements[0].references.join() === "User" && m[2].statements[0].references.join() === "User");
  t("the OAuth migration creates exactly OAuthIdentity and its two unique indexes", m[2].statements.map((x) => `${x.kind}:${x.name}`).join() === "table:OAuthIdentity,index:OAuthIdentity_provider_subject_key,index:OAuthIdentity_userId_provider_key");
  const tamper = path.join(TMP, "tampered");
  for (const r of REVIEWED_MIGRATIONS) {
    mkdirSync(path.join(tamper, r.name), { recursive: true });
    copyFileSync(path.join(MIGRATIONS_DIR, r.name, "migration.sql"), path.join(tamper, r.name, "migration.sql"));
  }
  t("an untouched copy still loads", loadReviewedMigrations(tamper).length === 6);
  const f = path.join(tamper, REVIEWED_MIGRATIONS[1].name, "migration.sql");
  writeFileSync(f, readFileSync(f, "utf8") + "\nCREATE INDEX \"Extra_idx\" ON \"User\"(\"id\");\n");
  t("a modified migration file is refused (hash mismatch)", await rejects(() => loadReviewedMigrations(tamper), "MIGRATION_FILE"));
  t("a missing migration file is refused", await rejects(() => loadReviewedMigrations(path.join(TMP, "nowhere")), "MIGRATION_FILE"));
  // The OAuth migration: approved only with its exact reviewed bytes.
  const oauthPath = (dir: string) => path.join(dir, OAUTH.name, "migration.sql");
  const fresh = (label: string) => {
    const d = path.join(TMP, label);
    copyMigrations(d, REVIEWED_MIGRATIONS.map((r) => r.name));
    return d;
  };
  const exact = fresh("oauth-exact");
  t("OAuth: the exact reviewed file is approved", loadReviewedMigrations(exact).length === 6);
  const oauthRaw = readFileSync(oauthPath(exact), "utf8");
  const variants: [string, string][] = [
    ["an appended statement", oauthRaw + '\nCREATE INDEX "Extra_idx" ON "User"("id");\n'],
    ["a trailing space", oauthRaw.replace(/\n$/, " \n")],
    ["a changed column type", oauthRaw.replace('"subject" TEXT NOT NULL', '"subject" TEXT')],
    ["a dropped uniqueness index", oauthRaw.replace(/-- CreateIndex\nCREATE UNIQUE INDEX "OAuthIdentity_userId_provider_key"[^\n]*\n/, "")],
    ["a weakened cascade", oauthRaw.replace("ON DELETE CASCADE", "ON DELETE SET NULL")],
    ["an emptied file", ""],
  ];
  for (const [label, content] of variants) {
    const d = fresh(`oauth-${label.replace(/\W+/g, "-")}`);
    writeFileSync(oauthPath(d), content);
    t(`OAuth: ${label} is refused (hash mismatch)`, await rejects(() => loadReviewedMigrations(d), "MIGRATION_FILE"));
  }
  t("OAuth: a CRLF checkout of the exact file still matches", (() => {
    const d = fresh("oauth-crlf");
    writeFileSync(oauthPath(d), oauthRaw.replace(/\n/g, "\r\n"));
    return loadReviewedMigrations(d).length === 6;
  })());
  // Unknown migrations stay rejected: an unpinned directory is never loaded, and a pin that does not match is refused.
  const withUnknown = fresh("oauth-unknown");
  mkdirSync(path.join(withUnknown, "20261099000000_unreviewed"), { recursive: true });
  writeFileSync(path.join(withUnknown, "20261099000000_unreviewed", "migration.sql"), 'CREATE TABLE "Unreviewed" ("id" TEXT NOT NULL PRIMARY KEY);\n');
  t("an unreviewed migration directory is never loaded (only the pinned names)", loadReviewedMigrations(withUnknown).map((x) => x.name).join() === [GALLERY_1.name, GALLERY_2.name, OAUTH.name, TEAM.name, RESEARCH.name, PUBLICATION.name].join());
  t("a pin for an unknown migration with a wrong hash is refused", await rejects(() => loadReviewedMigrations(withUnknown, [...REVIEWED_MIGRATIONS, { name: "20261099000000_unreviewed", sha256: "0".repeat(64) }]), "MIGRATION_FILE"));
  t("a pin for a migration that does not exist is refused", await rejects(() => loadReviewedMigrations(withUnknown, [...REVIEWED_MIGRATIONS, { name: "20261098000000_nonexistent", sha256: "0".repeat(64) }]), "MIGRATION_FILE"));
  // Even a hash-matching file must still pass the SQL-pattern safeguards (the hash is not the only gate).
  const evilSql = oauthRaw + '\nDROP TABLE "User";\n';
  const withEvil = fresh("oauth-evil-pinned");
  writeFileSync(oauthPath(withEvil), evilSql);
  t("a file whose hash IS pinned but which contains non-additive SQL is still refused (NOT_ADDITIVE)", await rejects(() => loadReviewedMigrations(withEvil, [GALLERY_1, GALLERY_2, { name: OAUTH.name, sha256: sha256(evilSql) }]), "NOT_ADDITIVE"));
  const withQuote = fresh("oauth-quote-pinned");
  const quoted = oauthRaw.replace('"subject" TEXT NOT NULL', '"subject" TEXT NOT NULL DEFAULT \'x\'');
  writeFileSync(oauthPath(withQuote), quoted);
  t("... and so is a pinned file containing a quote", await rejects(() => loadReviewedMigrations(withQuote, [GALLERY_1, GALLERY_2, { name: OAUTH.name, sha256: sha256(quoted) }]), "NOT_ADDITIVE"));
  t("a CRLF checkout of the same file still matches the pinned hash", (() => {
    const raw = readFileSync(path.join(MIGRATIONS_DIR, REVIEWED_MIGRATIONS[0].name, "migration.sql"), "utf8");
    return sha256(raw.replace(/\n/g, "\r\n").replace(/\r\n/g, "\n")) === REVIEWED_MIGRATIONS[0].sha256;
  })());
}
{
  const bad = [
    'DROP TABLE "User"',
    'ALTER TABLE "User" ADD COLUMN "x" TEXT',
    'INSERT INTO "User" ("id") VALUES (\'x\')',
    'UPDATE "User" SET "id" = "id"',
    'DELETE FROM "User"',
    'PRAGMA foreign_keys=OFF',
    'CREATE TRIGGER "t" AFTER INSERT ON "User" BEGIN SELECT 1; END',
    'CREATE VIEW "v" AS SELECT 1',
    'CREATE TABLE "A" ("id" TEXT); DROP TABLE "User"',
    'CREATE TABLE "A" ("id" TEXT DEFAULT \'x\')',
    'CREATE TABLE IF NOT EXISTS "A" ("id" TEXT)',
    '',
  ];
  for (const sql of bad) t(`refused as not additive: ${sql.slice(0, 40) || "(empty)"}`, await rejects(() => parseAdditive(sql), "NOT_ADDITIVE"));
  t("comment lines are ignored", splitStatements('-- hi\nCREATE TABLE "A" ("id" TEXT);\n-- bye\n').length === 1);
}

// =========================================================================================================
// 2. Target selection
{
  const fileTarget = `file:${path.join(TMP, "x.db")}`;
  t("no URL -> refused", await rejects(() => parseTarget({}, "x"), "TARGET"));
  t("no confirmed identity -> refused", await rejects(() => parseTarget({ url: fileTarget }, undefined), "TARGET"));
  t("a relative file path -> refused", await rejects(() => parseTarget({ url: "file:./dev.db" }, "file:./dev.db"), "TARGET"));
  t("a file target with a token (ambiguous) -> refused", await rejects(() => parseTarget({ url: fileTarget, authToken: "tok-1234" }, fileTarget), "TARGET"));
  t("a file target with the matching identity is accepted", parseTarget({ url: fileTarget }, fileTarget).kind === "file");
  t("a file target with a different identity -> refused", await rejects(() => parseTarget({ url: fileTarget }, "file:/somewhere/else.db"), "TARGET"));
  const host = "lab-prod-example.turso.io";
  t("a remote target without a token -> refused", await rejects(() => parseTarget({ url: `libsql://${host}` }, host), "TARGET"));
  t("a remote target with token and matching host is accepted (parsing only: no connection is made)", parseTarget({ url: `libsql://${host}`, authToken: "tok-1234" }, host).identity === host);
  t("the host comparison is case-insensitive", parseTarget({ url: `libsql://${host.toUpperCase()}`, authToken: "tok-1234" }, host).identity === host);
  t("a different expected host -> refused (cannot confuse Production with Preview)", await rejects(() => parseTarget({ url: `libsql://${host}`, authToken: "tok-1234" }, "lab-preview-example.turso.io"), "TARGET"));
  t("a prefix of the real host is not a match", await rejects(() => parseTarget({ url: `libsql://${host}`, authToken: "tok-1234" }, "lab-prod-example"), "TARGET"));
  t("http:// is refused", await rejects(() => parseTarget({ url: `http://${host}`, authToken: "tok-1234" }, host), "TARGET"));
  t("a non-turso host is refused", await rejects(() => parseTarget({ url: "libsql://evil.example.com", authToken: "tok-1234" }, "evil.example.com"), "TARGET"));
  t("credentials / a path / a query inside the URL are refused", (await Promise.all([`libsql://user:pw@${host}`, `libsql://${host}/db`, `libsql://${host}?authToken=zzzz`].map((u) => rejects(() => parseTarget({ url: u, authToken: "tok-1234" }, host), "TARGET")))).every(Boolean));
  t("the token and URL are redacted from messages", redact("failed for libsql://h.turso.io with tok-SECRET-9999", ["tok-SECRET-9999", "libsql://h.turso.io"]) === "failed for *** with ***");
  let leak = "";
  try {
    parseTarget({ url: `libsql://user:supersecretpw@${host}`, authToken: "tok-SECRET-9999" }, host);
  } catch (e) {
    leak = (e as Error).message;
  }
  t("a refusal message never contains the URL credentials or the token", leak.length > 0 && !leak.includes("supersecretpw") && !leak.includes("tok-SECRET-9999"));
  const now = new Date("2026-10-12T02:00:00Z");
  t("a recovery point is required, an ISO time with a zone, not future, not stale", assertRecoveryPoint("2026-10-12T01:30:00Z", now).toISOString() === "2026-10-12T01:30:00.000Z" &&
    (await rejects(() => assertRecoveryPoint(undefined, now), "TARGET")) && (await rejects(() => assertRecoveryPoint("yesterday", now), "TARGET")) &&
    (await rejects(() => assertRecoveryPoint("2026-10-12T03:00:00Z", now), "TARGET")) && (await rejects(() => assertRecoveryPoint("2026-10-10T01:00:00Z", now), "TARGET")) &&
    (await rejects(() => assertRecoveryPoint("2026-10-12T01:30:00", now), "TARGET")));
}

// =========================================================================================================
// 3. Inspect-only and apply on a realistic pre-release database
{
  const db = await preReleaseDb();
  await addRows(db.client);
  const before = await schemaDump(db.client);
  const countsBefore = await countTables(db.client);
  const check = await execute(db.client, reviewed(), { apply: false });
  t("inspect-only: reports all six migrations absent and a plan", check.outcome === "planned" && check.before.length === 6 && check.before.every((s) => s.status === "absent"));
  t("inspect-only: the database is byte-for-byte unchanged (schema dump identical)", (await schemaDump(db.client)) === before);
  t("the seeded rows are counted (so the later 'unchanged' check is meaningful)", countsBefore.GalleryItem === 1 && countsBefore.StoredFile === 1 && countsBefore.User >= 1);

  const applied = await execute(db.client, reviewed(), { apply: true });
  t("apply: outcome applied, all six migrations applied in order", applied.outcome === "applied" && applied.appliedMigrations.join() === [GALLERY_1.name, GALLERY_2.name, OAUTH.name, TEAM.name, RESEARCH.name, PUBLICATION.name].join() && applied.after.every((s) => s.status === "applied"));
  t("apply: existing GalleryItem / StoredFile / User row counts unchanged", JSON.stringify(applied.countsBefore) === JSON.stringify(applied.countsAfter));
  const names = (await db.client.execute(`SELECT name FROM sqlite_master WHERE name IN ('GalleryImage','GalleryUploadAttempt','GalleryImage_fileId_key','GalleryImage_itemId_sortOrder_idx','GalleryUploadAttempt_createdAt_idx','GalleryUploadAttempt_userId_key_key')`)).rows;
  t("apply: both tables and all four indexes exist", names.length === 6);
  const oauthObjs = (await db.client.execute(`SELECT name FROM sqlite_master WHERE name IN ('OAuthIdentity','OAuthIdentity_provider_subject_key','OAuthIdentity_userId_provider_key')`)).rows;
  t("apply: the OAuthIdentity table and its two unique indexes exist", oauthObjs.length === 3);
  const fkOauth = (await db.client.execute(`PRAGMA foreign_key_list("OAuthIdentity")`)).rows.map((r) => `${r.from}->${r.table}.${r.to}:${r.on_delete}`).join();
  t("apply: OAuthIdentity.userId references User.id ON DELETE CASCADE", fkOauth === "userId->User.id:CASCADE");
  const uniques = (await db.client.execute(`PRAGMA index_list("OAuthIdentity")`)).rows.filter((r) => Number(r.unique) === 1 && r.origin === "c").length;
  t("apply: both OAuthIdentity uniqueness rules are enforced by unique indexes", uniques === 2);
  const fkImg = (await db.client.execute(`PRAGMA foreign_key_list("GalleryImage")`)).rows.map((r) => `${r.from}->${r.table}.${r.to}:${r.on_delete}`).sort().join();
  const fkAtt = (await db.client.execute(`PRAGMA foreign_key_list("GalleryUploadAttempt")`)).rows.map((r) => `${r.from}->${r.table}.${r.to}:${r.on_delete}`).join();
  t("apply: the expected foreign keys exist with ON DELETE CASCADE", fkImg === "fileId->StoredFile.id:CASCADE,itemId->GalleryItem.id:CASCADE" && fkAtt === "userId->User.id:CASCADE");
  t("apply: the existing data rows are still readable", Number((await db.client.execute(`SELECT COUNT(*) AS n FROM "GalleryItem"`)).rows[0].n) === 1);
  const again = await execute(db.client, reviewed(), { apply: true });
  t("re-running apply is a no-op ('nothing to do'), idempotent", again.outcome === "nothing-to-do" && again.appliedMigrations.length === 0);
  const checkAfter = await execute(db.client, reviewed(), { apply: false });
  t("inspect-only after apply: nothing to do", checkAfter.outcome === "nothing-to-do");
  // Equivalence with what Prisma's own migration produces: same schema as applying the two files directly.
  const direct = await preReleaseDb();
  for (const m of reviewed()) await direct.client.executeMultiple(m.sql);
  const pick = async (c: Client) => JSON.stringify((await c.execute(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name LIKE 'Gallery%' OR name LIKE 'OAuthIdentity%' ORDER BY name`)).rows.map((r) => [r.type, r.name, r.tbl_name, String(r.sql).replace(/\s+/g, " ")]));
  t("the executor's resulting schema (gallery and OAuth) is identical to applying the migration files directly", (await pick(db.client)) === (await pick(direct.client)));
  db.client.close();
  direct.client.close();
}
{
  // The release-time shape (before Phase 3B was applied): the gallery migrations already applied, OAuth, the Phase 3B column and the Phase 3C columns absent -> exactly those three are applied.
  const db = await preReleaseDb();
  await addRows(db.client);
  await db.client.executeMultiple(reviewed()[0].sql);
  await db.client.executeMultiple(reviewed()[1].sql);
  const countsBefore = await countTables(db.client);
  const plan = await execute(db.client, reviewed(), { apply: false });
  t("production shape: inspect-only plans exactly the OAuth, Phase 3B, Phase 3C and publication migrations", plan.outcome === "planned" && plan.before.map((s) => s.status).join() === "applied,applied,absent,absent,absent,absent");
  const r = await execute(db.client, reviewed(), { apply: true });
  t("production shape: apply runs ONLY the OAuth, Phase 3B, Phase 3C and publication migrations and leaves existing rows alone", r.outcome === "applied" && r.appliedMigrations.join() === [OAUTH.name, TEAM.name, RESEARCH.name, PUBLICATION.name].join() && JSON.stringify(await countTables(db.client)) === JSON.stringify(countsBefore));
  t("production shape: a second apply is a no-op", (await execute(db.client, reviewed(), { apply: true })).outcome === "nothing-to-do");
  db.client.close();
}

// =========================================================================================================
// 4. Fail closed on partial / divergent / unexpected state; nothing is written
async function failsClosedOn(setup: (c: Client) => Promise<void>, label: string, expectStatus: "partial" | "divergent", subject: { name: string } = FIRST_ANCHOR) {
  const db = await preReleaseDb();
  await setup(db.client);
  const dump = await schemaDump(db.client);
  let refusal: MigrationRefusal | undefined;
  try {
    await execute(db.client, reviewed(), { apply: true });
  } catch (e) {
    if (e instanceof MigrationRefusal) refusal = e;
  }
  t(`${label}: refused with STATE and classified exactly as ${expectStatus}`, refusal?.code === "STATE" && refusal.message.includes(`${subject.name}: ${expectStatus}`) && refusal.message.includes("nothing was written"));
  t(`${label}: the database was not modified`, (await schemaDump(db.client)) === dump);
  let planRefused = false;
  try {
    await execute(db.client, reviewed(), { apply: false });
  } catch (e) {
    planRefused = e instanceof MigrationRefusal && e.code === "STATE";
  }
  t(`${label}: inspect-only also refuses`, planRefused);
  db.client.close();
}
const FIRST = reviewed()[0];
const FIRST_ANCHOR = { name: FIRST.name };
const OAUTH_SPEC = reviewed()[2];
await failsClosedOn(async (c) => void (await c.execute(FIRST.statements[0].sql)), "table created but its indexes missing", "partial");
await failsClosedOn(async (c) => {
  await c.execute(`CREATE TABLE "GalleryImage" ("id" TEXT NOT NULL PRIMARY KEY, "itemId" TEXT)`);
}, "a same-named table with a different definition", "divergent");
await failsClosedOn(async (c) => {
  await c.executeMultiple(FIRST.statements.map((s) => s.sql).join(";\n") + ";");
  await c.execute(`CREATE INDEX "GalleryImage_stray_idx" ON "GalleryImage"("sortOrder")`);
}, "a fully applied migration plus an unexpected extra index", "divergent");
await failsClosedOn(async (c) => void (await c.execute(`CREATE TABLE "GalleryImage_old" ("id" TEXT)`)), "an unexpected leftover table named like the new one", "divergent");
await failsClosedOn(async (c) => {
  await c.executeMultiple(FIRST.statements.map((s) => s.sql.replace('"sortOrder" INTEGER NOT NULL DEFAULT 0', '"sortOrder" INTEGER NOT NULL DEFAULT 1')).join(";\n") + ";");
}, "a table that differs only in a column default", "divergent");
await failsClosedOn(async (c) => void (await c.execute(OAUTH_SPEC.statements[0].sql)), "OAuth: table created but its unique indexes missing", "partial", OAUTH_SPEC);
await failsClosedOn(async (c) => {
  await c.execute(`CREATE TABLE "OAuthIdentity" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT)`);
}, "OAuth: a same-named table with a different definition", "divergent", OAUTH_SPEC);
await failsClosedOn(async (c) => {
  await c.executeMultiple(OAUTH_SPEC.statements.map((s) => s.sql).join(";\n") + ";");
  await c.execute(`CREATE INDEX "OAuthIdentity_stray_idx" ON "OAuthIdentity"("subject")`);
}, "OAuth: a fully applied migration plus an unexpected extra index", "divergent", OAUTH_SPEC);
await failsClosedOn(async (c) => {
  await c.executeMultiple(OAUTH_SPEC.statements.map((s) => s.sql.replace("ON DELETE CASCADE", "ON DELETE SET NULL")).join(";\n") + ";");
}, "OAuth: a table whose foreign key action was weakened", "divergent", OAUTH_SPEC);
{
  // one applied, the others absent: apply only the missing ones
  const db = await preReleaseDb();
  await db.client.executeMultiple(reviewed()[0].sql);
  const r = await execute(db.client, reviewed(), { apply: true });
  t("with the first migration already applied, the other five are applied", r.outcome === "applied" && r.appliedMigrations.join() === [reviewed()[1].name, reviewed()[2].name, reviewed()[3].name, reviewed()[4].name, reviewed()[5].name].join());
  db.client.close();
}
{
  // the database changes between the read-only inspection and the write transaction
  const db = await preReleaseDb();
  let err: unknown;
  try {
    await execute(db.client, reviewed(), { apply: true, afterInspect: async () => void (await db.client.executeMultiple(reviewed()[0].sql)) });
  } catch (e) {
    err = e;
  }
  t("a change between inspection and the write transaction is detected inside the transaction (STATE) and nothing more is written", err instanceof MigrationRefusal && err.code === "STATE" && /changed between inspection/.test(err.message) &&
    Number((await db.client.execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'GalleryUploadAttempt'`)).rows[0].n) === 0);
  db.client.close();
}
{
  // not this application's database
  const file = path.join(TMP, "alien.db");
  const c = createClient({ url: `file:${file}` });
  await c.execute(`CREATE TABLE "Other" ("id" TEXT)`);
  t("a database without the application's tables is refused (PREREQUISITE) and untouched", (await rejects(() => execute(c, reviewed(), { apply: true }), "PREREQUISITE")) && (await c.execute(`SELECT name FROM sqlite_master`)).rows.length === 1);
  c.close();
}

// =========================================================================================================
// 5. Transactions: rollback, interruption, verification failure, ambiguous COMMIT
{
  // an object squatting on one of the new index names (on another table) is caught before any write
  const db = await preReleaseDb();
  await db.client.execute(`CREATE TABLE "Blocker" ("id" TEXT)`);
  await db.client.execute(`CREATE INDEX "GalleryImage_fileId_key" ON "Blocker"("id")`);
  const dump = await schemaDump(db.client);
  let err: unknown;
  try {
    await execute(db.client, [reviewed()[0]], { apply: true });
  } catch (e) {
    err = e;
  }
  t("a conflicting pre-existing object is caught as divergent before any write", err instanceof MigrationRefusal && err.code === "STATE");
  t("... and nothing was written", (await schemaDump(db.client)) === dump);
  db.client.close();
}
{
  // statement N fails inside the transaction -> everything rolls back (atomicity of the DDL batch on SQLite)
  const db = await preReleaseDb();
  const dump = await schemaDump(db.client);
  const wrap = (tx: Transaction): Transaction => {
    let count = 0;
    const exec = tx.execute.bind(tx);
    return new Proxy(tx, {
      get(target, prop) {
        if (prop === "execute") {
          return async (stmt: unknown) => {
            const text = typeof stmt === "string" ? stmt : (stmt as { sql: string }).sql;
            if (/^CREATE/i.test(text) && ++count === 4) throw new Error("injected failure on the 4th CREATE");
            return exec(stmt as never);
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Transaction;
  };
  let err: unknown;
  try {
    await execute(db.client, reviewed(), { apply: true, wrapTransaction: wrap });
  } catch (e) {
    err = e;
  }
  t("a failure half-way through the statements is reported as an error", err instanceof Error && /injected failure/.test(err.message));
  t("... and the first migration's table and indexes did NOT survive (rolled back, schema identical)", (await schemaDump(db.client)) === dump);
  const retry = await execute(db.client, reviewed(), { apply: true });
  t("... and a clean re-run then succeeds", retry.outcome === "applied");
  db.client.close();
}
{
  // an interrupted run: the connection dies mid-transaction without commit or rollback
  const db = await preReleaseDb();
  const dump = await schemaDump(db.client);
  const wrap = (tx: Transaction): Transaction => {
    let count = 0;
    const exec = tx.execute.bind(tx);
    return new Proxy(tx, {
      get(target, prop) {
        if (prop === "execute") {
          return async (stmt: unknown) => {
            const text = typeof stmt === "string" ? stmt : (stmt as { sql: string }).sql;
            if (/^CREATE/i.test(text) && ++count === 3) {
              db.client.close(); // simulates the process / connection dying
              throw new Error("connection lost");
            }
            return exec(stmt as never);
          };
        }
        if (prop === "rollback") return async () => { throw new Error("rollback impossible: connection gone"); };
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Transaction;
  };
  let err: unknown;
  try {
    await execute(db.client, reviewed(), { apply: true, wrapTransaction: wrap });
  } catch (e) {
    err = e;
  }
  const reopened = createClient({ url: db.url });
  t("an interrupted run reports an error", err instanceof Error);
  t("... and after reconnecting the database is exactly as it was (no partial schema)", (await schemaDump(reopened)) === dump);
  const states = await Promise.all(reviewed().map(async (m) => (await classify(reopened, m, await expectedSchema(m))).status));
  t("... all migrations classify as absent, so a re-run is safe", states.length === 6 && states.every((s) => s === "absent"));
  reopened.close();
}
{
  // verification inside the transaction fails -> rollback, nothing committed
  const db = await preReleaseDb();
  const dump = await schemaDump(db.client);
  const wrap = (tx: Transaction): Transaction =>
    new Proxy(tx, {
      get(target, prop) {
        if (prop === "execute") {
          return async (stmt: unknown) => {
            const text = typeof stmt === "string" ? stmt : (stmt as { sql: string }).sql;
            const res = await target.execute(stmt as never);
            if (/^CREATE UNIQUE INDEX "GalleryImage_fileId_key"/.test(text)) await target.execute(`DROP INDEX "GalleryImage_fileId_key"`); // something diverges from the reference
            return res;
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Transaction;
  let err: unknown;
  try {
    await execute(db.client, reviewed(), { apply: true, wrapTransaction: wrap });
  } catch (e) {
    err = e;
  }
  t("an in-transaction verification failure is refused with VERIFY", err instanceof MigrationRefusal && err.code === "VERIFY");
  t("... and rolled back (schema identical)", (await schemaDump(db.client)) === dump);
  db.client.close();
}
{
  // row counts change inside the transaction -> rollback
  const db = await preReleaseDb();
  await addRows(db.client);
  const dump = await schemaDump(db.client);
  const wrap = (tx: Transaction): Transaction =>
    new Proxy(tx, {
      get(target, prop) {
        if (prop === "execute") {
          return async (stmt: unknown) => {
            const text = typeof stmt === "string" ? stmt : (stmt as { sql: string }).sql;
            const res = await target.execute(stmt as never);
            if (/^CREATE TABLE "GalleryUploadAttempt"/.test(text)) await target.execute(`DELETE FROM "GalleryItem"`);
            return res;
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Transaction;
  let err: unknown;
  try {
    await execute(db.client, reviewed(), { apply: true, wrapTransaction: wrap });
  } catch (e) {
    err = e;
  }
  t("a change to existing row counts inside the transaction is refused and rolled back", err instanceof MigrationRefusal && err.code === "VERIFY" && (await schemaDump(db.client)) === dump && Number((await db.client.execute(`SELECT COUNT(*) AS n FROM "GalleryItem"`)).rows[0].n) === 1);
  db.client.close();
}
{
  // COMMIT commits but reports an error (a lost reply): the executor re-reads and says what happened
  const db = await preReleaseDb();
  const wrap = (tx: Transaction): Transaction =>
    new Proxy(tx, {
      get(target, prop) {
        if (prop === "commit") {
          return async () => {
            await target.commit();
            throw new Error("reply lost");
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Transaction;
  const r = await execute(db.client, reviewed(), { apply: true, wrapTransaction: wrap });
  t("a COMMIT that reports an error but did commit is detected by re-reading: applied-after-commit-error", r.outcome === "applied-after-commit-error" && r.after.every((s) => s.status === "applied"));
  db.client.close();
}
{
  // COMMIT fails and nothing was committed
  const db = await preReleaseDb();
  const dump = await schemaDump(db.client);
  const wrap = (tx: Transaction): Transaction =>
    new Proxy(tx, {
      get(target, prop) {
        if (prop === "commit") return async () => { throw new Error("commit refused"); };
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Transaction;
  let err: unknown;
  try {
    await execute(db.client, reviewed(), { apply: true, wrapTransaction: wrap });
  } catch (e) {
    err = e;
  }
  t("a COMMIT that fails without committing is reported as 'NOT applied, safe to re-run'", err instanceof MigrationRefusal && err.code === "COMMIT" && /NOT applied/.test(err.message) && (await schemaDump(db.client)) === dump);
  db.client.close();
}
t("COUNTED_TABLES covers the data tables named in the task", ["User", "StoredFile", "GalleryItem"].every((x) => (COUNTED_TABLES as readonly string[]).includes(x)));

// =========================================================================================================
// 6. The command-line wrapper (against local files only; remote targets are refused before any connection)
{
  const db = await preReleaseDb();
  db.client.close();
  const run = (env: Record<string, string>, args: string[]) => {
    const clean: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, ...env };
    return spawnSync(process.execPath, [TSX_CLI, path.join(HERE, "turso-migrate.ts"), ...args], { cwd: SERVER_ROOT, env: clean, encoding: "utf8", timeout: 60_000 });
  };
  const all = (r: ReturnType<typeof run>) => `${r.stdout}\n${r.stderr}`;
  let r = run({}, []);
  t("CLI: no target selected -> exit 2", r.status === 2 && /No target selected/.test(all(r)));
  r = run({ TURSO_DATABASE_URL: "libsql://ambient.turso.io", TURSO_AUTH_TOKEN: "AMBIENT-TOKEN-xyz", DATABASE_URL: db.url }, ["--expect-target", "ambient.turso.io"]);
  t("CLI: ambient TURSO_* / DATABASE_URL can never select the target (still 'No target selected', exit 2)", r.status === 2 && /No target selected/.test(all(r)) && !all(r).includes("AMBIENT-TOKEN-xyz"));
  r = run({ MIGRATE_TARGET_URL: db.url }, []);
  t("CLI: a target without --expect-target -> exit 2", r.status === 2 && /identity must be confirmed/.test(all(r)));
  r = run({ MIGRATE_TARGET_URL: db.url }, ["--expect-target", "file:/wrong.db"]);
  t("CLI: a wrong --expect-target -> exit 2, nothing touched", r.status === 2 && /mismatch/.test(all(r)));
  r = run({ MIGRATE_TARGET_URL: "libsql://lab-prod-example.turso.io", MIGRATE_TARGET_TOKEN: "FAKE-TOKEN-0123456789" }, ["--expect-target", "lab-preview-example.turso.io", "--apply"]);
  t("CLI: a remote target with the wrong host is refused before any connection (exit 2)", r.status === 2 && /mismatch/.test(all(r)));
  r = run({ MIGRATE_TARGET_URL: "libsql://lab-prod-example.turso.io", MIGRATE_TARGET_TOKEN: "FAKE-TOKEN-0123456789" }, ["--expect-target", "lab-prod-example.turso.io", "--apply"]);
  t("CLI: a remote apply without --recovery-point is refused before any connection (exit 2)", r.status === 2 && /recovery-point/.test(all(r)));
  t("CLI: the token never appears in any output", !all(r).includes("FAKE-TOKEN-0123456789"));
  r = run({ MIGRATE_TARGET_URL: db.url, TURSO_DATABASE_URL: "libsql://ambient.turso.io", TURSO_AUTH_TOKEN: "AMBIENT-TOKEN-xyz" }, ["--expect-target", db.url]);
  t("CLI: inspect-only on a local copy -> exit 0 with a plan; ambient TURSO_* is ignored (and mentioned without values)", r.status === 0 && /PLAN:/.test(all(r)) && /IGNORED/.test(all(r)) && !all(r).includes("AMBIENT-TOKEN-xyz") && !all(r).includes("ambient.turso.io"));
  const c1 = createClient({ url: db.url });
  t("CLI: inspect-only wrote nothing", Number((await c1.execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('GalleryImage','GalleryUploadAttempt','OAuthIdentity')`)).rows[0].n) === 0);
  c1.close();
  r = run({ MIGRATE_TARGET_URL: db.url }, ["--expect-target", db.url, "--apply"]);
  t("CLI: --apply on a local copy -> exit 0 and APPLIED for all three reviewed migrations", r.status === 0 && /APPLIED: 20261011130000_gallery_item_images, 20261011140000_gallery_upload_attempts, 20261012100000_oauth_identity/.test(all(r)));
  r = run({ MIGRATE_TARGET_URL: db.url }, ["--expect-target", db.url, "--apply"]);
  t("CLI: a second --apply -> exit 0 'Nothing to do'", r.status === 0 && /Nothing to do/.test(all(r)));
  r = run({ MIGRATE_TARGET_URL: db.url }, ["--expect-target", db.url, "--bogus"]);
  t("CLI: an unknown argument -> exit 2", r.status === 2);
  const c2 = createClient({ url: db.url });
  await c2.execute(`DROP INDEX "GalleryImage_itemId_sortOrder_idx"`);
  c2.close();
  r = run({ MIGRATE_TARGET_URL: db.url }, ["--expect-target", db.url, "--apply"]);
  t("CLI: a partially applied database -> exit 2, REFUSED [STATE], and it did not 'repair' it", r.status === 2 && /REFUSED \[STATE\]/.test(all(r)));
  const c3 = createClient({ url: db.url });
  t("CLI: the partial database is untouched by the refused run", Number((await c3.execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'GalleryImage_itemId_sortOrder_idx'`)).rows[0].n) === 0);
  c3.close();
}

// =========================================================================================================
// 9. Phase 3B: the ONE accepted ALTER TABLE ... ADD COLUMN form (and nothing broader)
{
  const accepted = [
    'ALTER TABLE "TeamMember" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true',
    'ALTER TABLE "TeamMember" ADD COLUMN "flag" BOOLEAN NOT NULL DEFAULT false',
    'ALTER TABLE "TeamMember" ADD COLUMN "rank" INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE "TeamMember" ADD COLUMN "rank" INTEGER NOT NULL DEFAULT -1',
  ];
  for (const a of accepted) t(`ALTER accepted: ${a.slice(-48)}`, parseAdditive(a + ";").length === 1 && parseAdditive(a + ";")[0].kind === "column");
  const refused: [string, string][] = [
    ["nullable column (no NOT NULL)", 'ALTER TABLE "TeamMember" ADD COLUMN "x" BOOLEAN DEFAULT true'],
    ["NOT NULL without a default", 'ALTER TABLE "TeamMember" ADD COLUMN "x" BOOLEAN NOT NULL'],
    ["quoted default", "ALTER TABLE \"TeamMember\" ADD COLUMN \"x\" TEXT NOT NULL DEFAULT 'a'"],
    ["TEXT type", 'ALTER TABLE "TeamMember" ADD COLUMN "x" TEXT NOT NULL DEFAULT 1'],
    ["expression default", 'ALTER TABLE "TeamMember" ADD COLUMN "x" INTEGER NOT NULL DEFAULT (1+1)'],
    ["non-constant default", 'ALTER TABLE "TeamMember" ADD COLUMN "x" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
    ["upper-case TRUE literal", 'ALTER TABLE "TeamMember" ADD COLUMN "x" BOOLEAN NOT NULL DEFAULT TRUE'],
    ["REFERENCES", 'ALTER TABLE "TeamMember" ADD COLUMN "x" INTEGER NOT NULL DEFAULT 0 REFERENCES "User" ("id")'],
    ["UNIQUE", 'ALTER TABLE "TeamMember" ADD COLUMN "x" INTEGER NOT NULL DEFAULT 0 UNIQUE'],
    ["PRIMARY KEY", 'ALTER TABLE "TeamMember" ADD COLUMN "x" INTEGER NOT NULL DEFAULT 0 PRIMARY KEY'],
    ["CHECK", 'ALTER TABLE "TeamMember" ADD COLUMN "x" INTEGER NOT NULL DEFAULT 0 CHECK ("x" > 0)'],
    ["RENAME TO", 'ALTER TABLE "TeamMember" RENAME TO "Other"'],
    ["RENAME COLUMN", 'ALTER TABLE "TeamMember" RENAME COLUMN "name" TO "n"'],
    ["DROP COLUMN", 'ALTER TABLE "TeamMember" DROP COLUMN "bio"'],
    ["ADD without COLUMN keyword", 'ALTER TABLE "TeamMember" ADD "x" BOOLEAN NOT NULL DEFAULT true'],
    ["unquoted identifiers", "ALTER TABLE TeamMember ADD COLUMN x BOOLEAN NOT NULL DEFAULT true"],
    ["two clauses in one statement", 'ALTER TABLE "TeamMember" ADD COLUMN "x" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "y" BOOLEAN NOT NULL DEFAULT true'],
    ["a hostile identifier", 'ALTER TABLE "TeamMember; DROP TABLE User" ADD COLUMN "x" BOOLEAN NOT NULL DEFAULT true'],
    ["a smuggled second statement", 'ALTER TABLE "TeamMember" ADD COLUMN "x" BOOLEAN NOT NULL DEFAULT true;\nDROP TABLE "User"'],
    ["an UPDATE after the ALTER", 'ALTER TABLE "TeamMember" ADD COLUMN "x" BOOLEAN NOT NULL DEFAULT true;\nUPDATE "TeamMember" SET "x" = false'],
    ["ALTER mixed with CREATE TABLE", 'ALTER TABLE "TeamMember" ADD COLUMN "x" BOOLEAN NOT NULL DEFAULT true;\nCREATE TABLE "Extra" ("id" TEXT NOT NULL PRIMARY KEY)'],
    ["the same column twice", 'ALTER TABLE "TeamMember" ADD COLUMN "x" BOOLEAN NOT NULL DEFAULT true;\nALTER TABLE "TeamMember" ADD COLUMN "x" BOOLEAN NOT NULL DEFAULT true'],
  ];
  for (const [label, sql] of refused) t(`ALTER refused: ${label}`, await rejects(() => parseAdditive(sql + ";"), "NOT_ADDITIVE"));
  t("every pre-existing refusal still holds (DROP / UPDATE / INSERT / PRAGMA)", (await Promise.all(['DROP TABLE "User"', 'UPDATE "User" SET "role" = 1', 'INSERT INTO "User" ("id") VALUES (1)', "PRAGMA foreign_keys=OFF"].map((x) => rejects(() => parseAdditive(x + ";"), "NOT_ADDITIVE")))).every(Boolean));

  // The reviewed file itself: pinned, and any edit to it is refused.
  const dir = path.join(TMP, "team-pin");
  copyMigrations(dir, [TEAM.name]);
  const only = [TEAM];
  t("the Phase 3B file loads under its pin", loadReviewedMigrations(dir, only).length === 1);
  const f = path.join(dir, TEAM.name, "migration.sql");
  const raw = readFileSync(f, "utf8");
  for (const [label, edited] of [["a changed default", raw.replace("DEFAULT true", "DEFAULT false")], ["a trailing space", raw.replace(/\n$/, " \n")], ["an extra statement", raw + '\nALTER TABLE "TeamMember" ADD COLUMN "z" BOOLEAN NOT NULL DEFAULT true;\n']] as const) {
    writeFileSync(f, edited);
    t(`the Phase 3B file with ${label} is refused (hash mismatch)`, await rejects(() => loadReviewedMigrations(dir, only), "MIGRATION_FILE"));
  }
  writeFileSync(f, raw);

  // Behaviour on disposable databases: only the Phase 3B migration is pending.
  const teamOnly = () => loadReviewedMigrations(MIGRATIONS_DIR, only);
  const insertMember = (c: Client, id: string, cat = "FACULTY") =>
    c.execute({ sql: `INSERT INTO "TeamMember" ("id","name","initials","role","category","updatedAt") VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`, args: [id, `Name ${id}`, "NN", "r", cat] });
  {
    const db = await preReleaseDb();
    for (const r of REVIEWED_MIGRATIONS.slice(0, 3)) await db.client.executeMultiple(readFileSync(path.join(MIGRATIONS_DIR, r.name, "migration.sql"), "utf8"));
    await insertMember(db.client, "m1");
    await insertMember(db.client, "m2", "PHD");
    await db.client.execute({ sql: `INSERT INTO "HistoryEntry" ("id","teamMemberId","year","title","updatedAt") VALUES ('h1','m1','2020','t',CURRENT_TIMESTAMP)`, args: [] });
    const plan = await execute(db.client, teamOnly(), { apply: false });
    t("Phase 3B: inspect-only plans the column and writes nothing", plan.outcome === "planned" && plan.before[0].status === "absent" && plan.before[0].missing.join() === "TeamMember.isPublished" && !(await db.client.execute(`PRAGMA table_info("TeamMember")`)).rows.some((r) => r.name === "isPublished"));
    const done = await execute(db.client, teamOnly(), { apply: true });
    t("Phase 3B: apply succeeds", done.outcome === "applied" && done.appliedMigrations.join() === TEAM.name && done.after[0].status === "applied");
    const members = (await db.client.execute(`SELECT "id","isPublished" FROM "TeamMember" ORDER BY "id"`)).rows;
    t("Phase 3B: every pre-existing row reads back as published (1) and none was lost", members.length === 2 && members.every((r) => Number(r.isPublished) === 1));
    t("Phase 3B: dependent rows survived and there are no foreign-key violations", Number((await db.client.execute(`SELECT COUNT(*) AS n FROM "HistoryEntry"`)).rows[0].n) === 1 && (await db.client.execute("PRAGMA foreign_key_check")).rows.length === 0);
    const col = (await db.client.execute(`PRAGMA table_info("TeamMember")`)).rows.find((r) => r.name === "isPublished");
    t("Phase 3B: the column is BOOLEAN NOT NULL DEFAULT true", String(col?.type) === "BOOLEAN" && Number(col?.notnull) === 1 && String(col?.dflt_value) === "true");
    t("Phase 3B: a second apply is a no-op (idempotent)", (await execute(db.client, teamOnly(), { apply: true })).outcome === "nothing-to-do");
    const prismaDirect = await preReleaseDb();
    for (const r of REVIEWED_MIGRATIONS.slice(0, 3)) await prismaDirect.client.executeMultiple(readFileSync(path.join(MIGRATIONS_DIR, r.name, "migration.sql"), "utf8"));
    await prismaDirect.client.executeMultiple(readFileSync(path.join(MIGRATIONS_DIR, TEAM.name, "migration.sql"), "utf8"));
    const cols = async (c: Client) => JSON.stringify((await c.execute(`PRAGMA table_info("TeamMember")`)).rows.map((r) => [r.name, r.type, r.notnull, r.dflt_value]));
    t("Phase 3B: the executor's result equals applying the migration file directly", (await cols(db.client)) === (await cols(prismaDirect.client)));
    db.client.close();
    prismaDirect.client.close();
  }
  {
    // Divergent: the column already exists but with a different default -> refuse, write nothing.
    const db = await preReleaseDb();
    for (const r of REVIEWED_MIGRATIONS.slice(0, 3)) await db.client.executeMultiple(readFileSync(path.join(MIGRATIONS_DIR, r.name, "migration.sql"), "utf8"));
    await insertMember(db.client, "m1");
    await db.client.execute(`ALTER TABLE "TeamMember" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT false`);
    const dump = await schemaDump(db.client);
    t("Phase 3B: a column that exists with a different default is DIVERGENT and the run is refused", await rejects(() => execute(db.client, teamOnly(), { apply: true }), "STATE"));
    t("... and nothing was written", (await schemaDump(db.client)) === dump && Number((await db.client.execute(`SELECT "isPublished" AS p FROM "TeamMember"`)).rows[0].p) === 0);
    db.client.close();
  }
  {
    // A target that is not this application's database (no TeamMember table) is refused before anything is written.
    const db = await preReleaseDb();
    await db.client.execute("PRAGMA foreign_keys = OFF");
    await db.client.execute(`DROP TABLE "TeamMember"`);
    t("Phase 3B: a database without the TeamMember table is refused as not this application's (PREREQUISITE)", await rejects(() => execute(db.client, teamOnly(), { apply: true }), "PREREQUISITE"));
    db.client.close();
  }
  {
    // A failure inside the write transaction rolls the ALTER back.
    const db = await preReleaseDb();
    for (const r of REVIEWED_MIGRATIONS.slice(0, 3)) await db.client.executeMultiple(readFileSync(path.join(MIGRATIONS_DIR, r.name, "migration.sql"), "utf8"));
    await insertMember(db.client, "m1");
    const dump = await schemaDump(db.client);
    const wrap = (tx: Transaction): Transaction =>
      new Proxy(tx, {
        get(target, prop) {
          if (prop === "commit") return async () => { throw new Error("injected commit failure"); };
          const v = Reflect.get(target, prop);
          return typeof v === "function" ? v.bind(target) : v;
        },
      }) as Transaction;
    let err: unknown;
    try {
      await execute(db.client, teamOnly(), { apply: true, wrapTransaction: wrap });
    } catch (e) {
      err = e;
    }
    t("Phase 3B: a failed COMMIT is reported, not guessed", err instanceof MigrationRefusal && err.code === "COMMIT");
    t("... and the column is NOT there (rolled back, schema identical)", (await schemaDump(db.client)) === dump);
    t("... a retry then succeeds", (await execute(db.client, teamOnly(), { apply: true })).outcome === "applied");
    db.client.close();
  }

  // ---- Phase 3C: three optional research-link columns (TEXT NOT NULL DEFAULT '') -------------------------------------------------
  const rdir = path.join(TMP, "research-pin");
  copyMigrations(rdir, [RESEARCH.name]);
  const researchOnly = [RESEARCH];
  const rspec = loadReviewedMigrations(rdir, researchOnly);
  t("Phase 3C: the file loads under its pin", rspec.length === 1);
  t("Phase 3C: exactly three column statements: TeamMember.googleScholarUrl / researchGateUrl / orcidUrl, each TEXT with default ''", rspec[0].statements.length === 3 && rspec[0].statements.every((s) => s.kind === "column" && s.table === "TeamMember" && s.column?.type === "TEXT" && s.column?.defaultValue === "''") && rspec[0].statements.map((s) => s.name).join() === "TeamMember.googleScholarUrl,TeamMember.researchGateUrl,TeamMember.orcidUrl");
  const rf = path.join(rdir, RESEARCH.name, "migration.sql");
  const rraw = readFileSync(rf, "utf8");
  for (const [label, edited] of [["a changed default", rraw.replace("\"orcidUrl\" TEXT NOT NULL DEFAULT ''", "\"orcidUrl\" TEXT NOT NULL DEFAULT 'x'")], ["a trailing space", rraw.replace(/\n$/, " \n")], ["a fourth column", rraw + 'ALTER TABLE "TeamMember" ADD COLUMN "extraUrl" TEXT NOT NULL DEFAULT \'\';\n'], ["a removed column", rraw.replace(/ALTER TABLE "TeamMember" ADD COLUMN "orcidUrl"[^\n]*\n/, "")]] as [string, string][]) {
    writeFileSync(rf, edited);
    t(`the Phase 3C file with ${label} is refused (hash mismatch)`, await rejects(() => loadReviewedMigrations(rdir, researchOnly), "MIGRATION_FILE"));
  }
  writeFileSync(rf, rraw);
  // The narrow quote allowance: only the empty default of an added text column, as a whole statement. Everything else stays refused.
  const OK3C = 'ALTER TABLE "TeamMember" ADD COLUMN "x" TEXT NOT NULL DEFAULT \'\'';
  t("Phase 3C parser: the exact text-column form is accepted", parseAdditive(OK3C + ";").length === 1 && parseAdditive(OK3C + ";")[0].column?.type === "TEXT");
  const refused3c: [string, string][] = [
    ["a non-empty default", 'ALTER TABLE "TeamMember" ADD COLUMN "x" TEXT NOT NULL DEFAULT \'a\''],
    ["a nullable text column", 'ALTER TABLE "TeamMember" ADD COLUMN "x" TEXT DEFAULT \'\''],
    ["a text column with no default", 'ALTER TABLE "TeamMember" ADD COLUMN "x" TEXT NOT NULL'],
    ["another type with an empty-string default", 'ALTER TABLE "TeamMember" ADD COLUMN "x" VARCHAR NOT NULL DEFAULT \'\''],
    ["a semicolon hidden in a literal", 'ALTER TABLE "TeamMember" ADD COLUMN "x" TEXT NOT NULL DEFAULT \';\''],
    ["an empty literal followed by more text", 'ALTER TABLE "TeamMember" ADD COLUMN "x" TEXT NOT NULL DEFAULT \'\' CHECK (1)'],
    ["an empty default inside CREATE TABLE", 'CREATE TABLE "Extra" ("id" TEXT NOT NULL PRIMARY KEY, "n" TEXT NOT NULL DEFAULT \'\')'],
    ["a backtick", 'ALTER TABLE "TeamMember" ADD COLUMN "x" TEXT NOT NULL DEFAULT `x`'],
    ["a block comment", 'ALTER TABLE "TeamMember" ADD COLUMN "x" TEXT NOT NULL DEFAULT \'\' /* x */'],
    ["an empty default mixed with CREATE TABLE", OK3C + ';\nCREATE TABLE "Extra" ("id" TEXT NOT NULL PRIMARY KEY)'],
    ["a smuggled DROP after the column", OK3C + ';\nDROP TABLE "User"'],
    ["an UPDATE after the column", OK3C + ';\nUPDATE "TeamMember" SET "x" = \'\''],
  ];
  for (const [label, sql] of refused3c) t(`Phase 3C refused: ${label}`, await rejects(() => parseAdditive(sql + ";"), "NOT_ADDITIVE"));
  {
    const db = await preReleaseDb();
    for (const r of REVIEWED_MIGRATIONS.slice(0, 4)) await db.client.executeMultiple(readFileSync(path.join(MIGRATIONS_DIR, r.name, "migration.sql"), "utf8"));
    await insertMember(db.client, "m1");
    await insertMember(db.client, "m2", "ALUMNI");
    await db.client.execute(`UPDATE "TeamMember" SET "isPublished" = 0 WHERE "id" = 'm2'`);
    await db.client.execute({ sql: `INSERT INTO "HistoryEntry" ("id","teamMemberId","year","title","updatedAt") VALUES ('h1','m1','2020','t',CURRENT_TIMESTAMP)`, args: [] });
    const researchSpec = () => loadReviewedMigrations(MIGRATIONS_DIR, researchOnly);
    const plan = await execute(db.client, researchSpec(), { apply: false });
    t("Phase 3C: inspect-only plans the three columns and writes nothing", plan.outcome === "planned" && plan.before[0].status === "absent" && plan.before[0].missing.length === 3 && !(await db.client.execute(`PRAGMA table_info("TeamMember")`)).rows.some((r) => String(r.name) === "orcidUrl"));
    const done = await execute(db.client, researchSpec(), { apply: true });
    t("Phase 3C: apply succeeds", done.outcome === "applied" && done.appliedMigrations.join() === RESEARCH.name && done.after[0].status === "applied");
    const rows = (await db.client.execute(`SELECT "id","isPublished","googleScholarUrl" AS g,"researchGateUrl" AS r,"orcidUrl" AS o FROM "TeamMember" ORDER BY "id"`)).rows;
    t("Phase 3C: every pre-existing row reads back '' for the three columns and none was lost", rows.length === 2 && rows.every((x) => x.g === "" && x.r === "" && x.o === ""));
    t("Phase 3C: the unpublished alumnus is still unpublished (the consent flag is untouched)", Number(rows.find((x) => x.id === "m2")?.isPublished) === 0 && Number(rows.find((x) => x.id === "m1")?.isPublished) === 1);
    t("Phase 3C: dependent rows survived and there are no foreign-key violations", Number((await db.client.execute(`SELECT COUNT(*) AS n FROM "HistoryEntry"`)).rows[0].n) === 1 && (await db.client.execute("PRAGMA foreign_key_check")).rows.length === 0);
    const cols = (await db.client.execute(`PRAGMA table_info("TeamMember")`)).rows;
    t("Phase 3C: each column is TEXT NOT NULL DEFAULT ''", ["googleScholarUrl", "researchGateUrl", "orcidUrl"].every((n) => { const c = cols.find((r) => r.name === n); return String(c?.type) === "TEXT" && Number(c?.notnull) === 1 && String(c?.dflt_value) === "''"; }));
    t("Phase 3C: a row inserted by older code (naming none of the columns) gets ''", (await insertMember(db.client, "old1"), String((await db.client.execute(`SELECT "googleScholarUrl" AS g FROM "TeamMember" WHERE "id" = 'old1'`)).rows[0].g) === ""));
    t("Phase 3C: a second apply is a no-op (idempotent)", (await execute(db.client, researchSpec(), { apply: true })).outcome === "nothing-to-do");
    const direct = await preReleaseDb();
    for (const r of REVIEWED_MIGRATIONS.slice(0, 5)) await direct.client.executeMultiple(readFileSync(path.join(MIGRATIONS_DIR, r.name, "migration.sql"), "utf8"));
    const dump = async (c: Client) => JSON.stringify((await c.execute(`PRAGMA table_info("TeamMember")`)).rows.map((r) => [r.name, r.type, r.notnull, r.dflt_value]));
    t("Phase 3C: the executor's result equals applying the migration file directly", (await dump(db.client)) === (await dump(direct.client)));
    db.client.close();
    direct.client.close();
  }
  {
    // Partial: one of the three columns already exists exactly -> refused (STATE), the other two are not added.
    const db = await preReleaseDb();
    for (const r of REVIEWED_MIGRATIONS.slice(0, 4)) await db.client.executeMultiple(readFileSync(path.join(MIGRATIONS_DIR, r.name, "migration.sql"), "utf8"));
    await db.client.execute(`ALTER TABLE "TeamMember" ADD COLUMN "googleScholarUrl" TEXT NOT NULL DEFAULT ''`);
    const dump = await schemaDump(db.client);
    t("Phase 3C: a PARTIAL state (1 of 3 columns) is refused, never completed blindly", await rejects(() => execute(db.client, loadReviewedMigrations(MIGRATIONS_DIR, researchOnly), { apply: true }), "STATE"));
    t("... and nothing was written", (await schemaDump(db.client)) === dump);
    db.client.close();
  }
  {
    // Divergent: a column exists with a different shape.
    const db = await preReleaseDb();
    for (const r of REVIEWED_MIGRATIONS.slice(0, 4)) await db.client.executeMultiple(readFileSync(path.join(MIGRATIONS_DIR, r.name, "migration.sql"), "utf8"));
    await insertMember(db.client, "m1");
    await db.client.execute(`ALTER TABLE "TeamMember" ADD COLUMN "orcidUrl" TEXT`);
    const dump = await schemaDump(db.client);
    t("Phase 3C: a column that exists with a different shape is DIVERGENT and the run is refused", await rejects(() => execute(db.client, loadReviewedMigrations(MIGRATIONS_DIR, researchOnly), { apply: true }), "STATE"));
    t("... and nothing was written", (await schemaDump(db.client)) === dump);
    db.client.close();
  }
  {
    // A failure inside the write transaction rolls all three ALTERs back (atomic).
    const db = await preReleaseDb();
    for (const r of REVIEWED_MIGRATIONS.slice(0, 4)) await db.client.executeMultiple(readFileSync(path.join(MIGRATIONS_DIR, r.name, "migration.sql"), "utf8"));
    await insertMember(db.client, "m1");
    const dump = await schemaDump(db.client);
    const wrap = (tx: Transaction): Transaction =>
      new Proxy(tx, { get(target, prop) { if (prop === "commit") return async () => { throw new Error("injected commit failure"); }; const v = Reflect.get(target, prop); return typeof v === "function" ? v.bind(target) : v; } }) as Transaction;
    let err: unknown;
    try { await execute(db.client, loadReviewedMigrations(MIGRATIONS_DIR, researchOnly), { apply: true, wrapTransaction: wrap }); } catch (e) { err = e; }
    t("Phase 3C: a failed COMMIT is reported, not guessed", err instanceof MigrationRefusal && err.code === "COMMIT");
    t("... and none of the three columns is there (rolled back, schema identical)", (await schemaDump(db.client)) === dump);
    t("... a retry then succeeds", (await execute(db.client, loadReviewedMigrations(MIGRATIONS_DIR, researchOnly), { apply: true })).outcome === "applied");
    db.client.close();
  }
}

rmSync(TMP, { recursive: true, force: true });
console.log(`${ok} turso-migrate unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
