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
const schemaDump = async (c: Client) => JSON.stringify((await c.execute(`SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name`)).rows.map((r) => [r.type, r.name, r.tbl_name, r.sql]));

// =========================================================================================================
// 1. Migration files: pinned, additive, parsed
{
  const m = reviewed();
  t("the two reviewed migrations load (hashes match the files on disk)", m.length === 2 && m[0].name === "20261011130000_gallery_item_images" && m[1].name === "20261011140000_gallery_upload_attempts");
  t("they contain 3 statements each (1 table + 2 indexes)", m.every((x) => x.statements.length === 3 && x.statements.filter((s) => s.kind === "table").length === 1));
  t("the first migration references GalleryItem and StoredFile; the second references User", m[0].statements[0].references.sort().join() === "GalleryItem,StoredFile" && m[1].statements[0].references.join() === "User");
  const tamper = path.join(TMP, "tampered");
  for (const r of REVIEWED_MIGRATIONS) {
    mkdirSync(path.join(tamper, r.name), { recursive: true });
    copyFileSync(path.join(MIGRATIONS_DIR, r.name, "migration.sql"), path.join(tamper, r.name, "migration.sql"));
  }
  t("an untouched copy still loads", loadReviewedMigrations(tamper).length === 2);
  const f = path.join(tamper, REVIEWED_MIGRATIONS[1].name, "migration.sql");
  writeFileSync(f, readFileSync(f, "utf8") + "\nCREATE INDEX \"Extra_idx\" ON \"User\"(\"id\");\n");
  t("a modified migration file is refused (hash mismatch)", await rejects(() => loadReviewedMigrations(tamper), "MIGRATION_FILE"));
  t("a missing migration file is refused", await rejects(() => loadReviewedMigrations(path.join(TMP, "nowhere")), "MIGRATION_FILE"));
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
  t("inspect-only: reports both migrations absent and a plan", check.outcome === "planned" && check.before.every((s) => s.status === "absent"));
  t("inspect-only: the database is byte-for-byte unchanged (schema dump identical)", (await schemaDump(db.client)) === before);
  t("the seeded rows are counted (so the later 'unchanged' check is meaningful)", countsBefore.GalleryItem === 1 && countsBefore.StoredFile === 1 && countsBefore.User >= 1);

  const applied = await execute(db.client, reviewed(), { apply: true });
  t("apply: outcome applied, both migrations applied", applied.outcome === "applied" && applied.appliedMigrations.length === 2 && applied.after.every((s) => s.status === "applied"));
  t("apply: existing GalleryItem / StoredFile / User row counts unchanged", JSON.stringify(applied.countsBefore) === JSON.stringify(applied.countsAfter));
  const names = (await db.client.execute(`SELECT name FROM sqlite_master WHERE name IN ('GalleryImage','GalleryUploadAttempt','GalleryImage_fileId_key','GalleryImage_itemId_sortOrder_idx','GalleryUploadAttempt_createdAt_idx','GalleryUploadAttempt_userId_key_key')`)).rows;
  t("apply: both tables and all four indexes exist", names.length === 6);
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
  const pick = async (c: Client) => JSON.stringify((await c.execute(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name LIKE 'Gallery%' ORDER BY name`)).rows.map((r) => [r.type, r.name, r.tbl_name, String(r.sql).replace(/\s+/g, " ")]));
  t("the executor's resulting schema is identical to applying the migration files directly", (await pick(db.client)) === (await pick(direct.client)));
  db.client.close();
  direct.client.close();
}

// =========================================================================================================
// 4. Fail closed on partial / divergent / unexpected state; nothing is written
async function failsClosedOn(setup: (c: Client) => Promise<void>, label: string, expectStatus: "partial" | "divergent") {
  const db = await preReleaseDb();
  await setup(db.client);
  const dump = await schemaDump(db.client);
  let refusal: MigrationRefusal | undefined;
  try {
    await execute(db.client, reviewed(), { apply: true });
  } catch (e) {
    if (e instanceof MigrationRefusal) refusal = e;
  }
  t(`${label}: refused with STATE and classified exactly as ${expectStatus}`, refusal?.code === "STATE" && refusal.message.includes(`${FIRST.name}: ${expectStatus}`) && refusal.message.includes("nothing was written"));
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
{
  // one applied, the other absent: apply only the missing one
  const db = await preReleaseDb();
  await db.client.executeMultiple(reviewed()[0].sql);
  const r = await execute(db.client, reviewed(), { apply: true });
  t("with the first migration already applied, only the second is applied", r.outcome === "applied" && r.appliedMigrations.join() === reviewed()[1].name);
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
  t("... both migrations classify as absent, so a re-run is safe", states.every((s) => s === "absent"));
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
  t("CLI: inspect-only wrote nothing", Number((await c1.execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('GalleryImage','GalleryUploadAttempt')`)).rows[0].n) === 0);
  c1.close();
  r = run({ MIGRATE_TARGET_URL: db.url }, ["--expect-target", db.url, "--apply"]);
  t("CLI: --apply on a local copy -> exit 0 and APPLIED for both migrations", r.status === 0 && /APPLIED: 20261011130000_gallery_item_images, 20261011140000_gallery_upload_attempts/.test(all(r)));
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

rmSync(TMP, { recursive: true, force: true });
console.log(`${ok} turso-migrate unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
