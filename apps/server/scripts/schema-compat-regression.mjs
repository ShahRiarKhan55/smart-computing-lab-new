/**
 * Phase 27 database-compatibility regression. Everything runs on DISPOSABLE LOCAL SQLITE FILES — it never reads
 * TURSO_* and refuses to run if a Turso URL would be used.
 *
 *  1. The migration is strictly additive: applied (with the real `prisma migrate deploy`) to a copy of the PRE-Phase-27
 *     database, every existing table keeps exactly the same rows (hash-compared), no foreign-key violation appears,
 *     new TeamMember columns take their defaults, and the new tables start empty.
 *  2. The Phase 27 code on the OLD schema fails SAFELY: clear 503 DB_SCHEMA_BEHIND for API routes, /api/health still
 *     answers, and the database is byte-for-byte unchanged afterwards (the guard never writes).
 *  3. The same code on the NEW schema serves normally.
 *
 * The pre-Phase-27 database comes from SCHEMA_COMPAT_OLD_DB (a copy is made); when unset, one is derived from
 * prisma/dev.db by reverting the migration in a temp copy.
 *
 *   SCHEMA_COMPAT_OLD_DB=/path/to/pre-phase27.db node scripts/schema-compat-regression.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const TSX = path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
const PRISMA = path.join(SERVER_ROOT, "..", "..", "node_modules", "prisma", "build", "index.js");
const OLD_DB = process.env.SCHEMA_COMPAT_OLD_DB;

let ok = 0;
const failures = [];
const t = (name, cond, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

if (!OLD_DB || !existsSync(OLD_DB)) {
  console.error("Set SCHEMA_COMPAT_OLD_DB to a copy of a pre-Phase-27 database (e.g. the backup taken before the migration was applied locally).");
  process.exit(1);
}
const cleanEnv = { ...process.env, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", BLOB_READ_WRITE_TOKEN: "", VERCEL: "" };

const client = (file) => new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
const q = (c, sql) => c.$queryRawUnsafe(sql);
const norm = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof Date ? x.toISOString() : x));

async function tables(c) {
  return (await q(c, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name")).map((r) => r.name);
}
/** table -> { count, hash } over the listed columns (default: all columns of the OLD table). */
async function fingerprint(c, names, colsOf) {
  const out = {};
  for (const n of names) {
    const cols = colsOf[n].map((x) => `"${x}"`).join(", ");
    const rows = await q(c, `SELECT ${cols} FROM "${n}" ORDER BY ${colsOf[n].map((x) => `"${x}"`).join(", ")}`);
    out[n] = { count: rows.length, hash: createHash("sha256").update(norm(rows)).digest("hex") };
  }
  return out;
}
async function columnsOf(c, names) {
  const out = {};
  for (const n of names) out[n] = (await q(c, `PRAGMA table_info("${n}")`)).map((r) => r.name);
  return out;
}

async function startServer(dbFile, engine = "plain") {
  const work = mkdtempSync(path.join(tmpdir(), "scl-compat-srv-"));
  const port = 49000 + Math.floor(Math.random() * 400);
  // engine "libsql" = the production code path (@prisma/adapter-libsql), pointed at a LOCAL file with a dummy token — never a Turso URL.
  const engineEnv = engine === "libsql" ? { TURSO_DATABASE_URL: `file:${dbFile}`, TURSO_AUTH_TOKEN: "local-test-token" } : {};
  const env = { ...cleanEnv, ...engineEnv, STORAGE_DIR: path.join(work, "files"), DATABASE_URL: `file:${dbFile}`, PORT: String(port), TRUST_PROXY: "0", NODE_ENV: "test", SESSION_SECRET: "schema-compat-secret-0000000000000000" };
  const child = spawn(process.execPath, [TSX, path.join(SERVER_ROOT, "src", "index.ts")], { cwd: SERVER_ROOT, env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 80 && !/listening on/.test(out); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/listening on/.test(out)) throw new Error(`server did not start:\n${out}`);
  return { base: `http://localhost:${port}`, logs: () => out, stop: async () => { child.kill(); rmSync(work, { recursive: true, force: true }); } };
}
const get = async (base, p, init) => {
  const r = await fetch(`${base}${p}`, init);
  let json = null;
  try { json = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, json };
};

async function main() {
  const work = mkdtempSync(path.join(tmpdir(), "scl-compat-"));
  try {
    const oldFile = path.join(work, "old.db");
    const newFile = path.join(work, "new.db");
    copyFileSync(OLD_DB, oldFile);
    copyFileSync(OLD_DB, newFile);

    // ---- 0. the "old" database really is pre-Phase-27 -------------------------------------------------------------
    const old = client(oldFile);
    // The seed has almost no child rows, which would make a destructive table rebuild invisible. Add some to the
    // DISPOSABLE copy (raw SQL: the current client expects the new columns) so any cascade/redefine would show.
    for (const sql of [
      `INSERT INTO "HistoryEntry" (id, teamMemberId, year, title, updatedAt) SELECT 'he-' || id, id, '2020', 'Compat probe', CURRENT_TIMESTAMP FROM "TeamMember"`,
      `INSERT INTO "PublicationAuthor" (publicationId, teamMemberId) SELECT p.id, t.id FROM "Publication" p, "TeamMember" t WHERE t.rowid <= 3`,
      `INSERT INTO "NewsAuthor" (newsItemId, teamMemberId) SELECT n.id, t.id FROM "NewsItem" n, "TeamMember" t WHERE t.rowid <= 2`,
      `INSERT INTO "ResearcherArea" (teamMemberId, researchAreaId) SELECT t.id, a.id FROM "TeamMember" t, "ResearchArea" a WHERE t.rowid <= 4`,
    ]) await old.$executeRawUnsafe(sql);
    copyFileSync(oldFile, newFile); // the "to be migrated" copy carries the same enriched rows
    const oldTables = await tables(old);
    const oldCols = await columnsOf(old, oldTables);
    t("setup: the old database has none of the Phase 27 tables or columns", !oldTables.includes("OAuthIdentity") && !oldTables.includes("SyncState") && !oldCols.TeamMember.includes("scholarUrl"));
    const before = await fingerprint(old, oldTables, oldCols);
    t("setup: the old database holds real rows to protect", before.TeamMember.count > 0 && Object.values(before).reduce((a, b) => a + b.count, 0) > 50 && before.HistoryEntry.count > 0 && before.PublicationAuthor.count > 0, JSON.stringify(Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.count]))));
    const oldFileHash = createHash("sha256").update(readFileSync(oldFile)).digest("hex");

    // ---- 2. Phase 27 code on the OLD schema: safe failure, no writes -----------------------------------------------------------
    const s1 = await startServer(oldFile);
    try {
      const health = await get(s1.base, "/api/health");
      t("old schema: /api/health still answers 200", health.status === 200);
      for (const p of ["/api/team", "/api/publications", "/api/news", "/api/updates", "/api/site-config", "/api/research"]) {
        const r = await get(s1.base, p);
        t(`old schema: GET ${p} is a clean 503 DB_SCHEMA_BEHIND (not a 500)`, r.status === 503 && r.json?.code === "DB_SCHEMA_BEHIND", `${r.status} ${JSON.stringify(r.json)}`);
      }
      const login = await get(s1.base, "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@smartcomputinglab.org", password: "ChangeMe123!" }) });
      t("old schema: login is refused with the same 503 (no half-working state)", login.status === 503 && login.json?.code === "DB_SCHEMA_BEHIND");
      t("old schema: the 503 body leaks no SQL, column name or path", !/scholarUrl|SELECT|\/home|\.db/i.test(JSON.stringify((await get(s1.base, "/api/team")).json)));
      t("old schema: the server logged an actionable, secret-free line", /\[schema\] DB_SCHEMA_BEHIND/.test(s1.logs()) && !/SESSION_SECRET|secret-0000/.test(s1.logs()));
    } finally {
      await s1.stop();
    }
    await old.$disconnect();
    // sessions may be created by the login attempt only if the guard failed; the file must be untouched either way.
    t("old schema: the database file is byte-for-byte unchanged after the requests (the guard never writes)", createHash("sha256").update(readFileSync(oldFile)).digest("hex") === oldFileHash);

    // ---- 1. the migration is strictly additive ------------------------------------------------------------------------------------
    const dep = spawnSync(process.execPath, [PRISMA, "migrate", "deploy", "--schema", path.join(SERVER_ROOT, "prisma", "schema.prisma")], { cwd: SERVER_ROOT, env: { ...cleanEnv, DATABASE_URL: `file:${newFile}` }, encoding: "utf8" });
    t("migration: prisma migrate deploy on the disposable copy succeeds and applies the Phase 27 migration and the later publication-provenance migration", dep.status === 0 && /20261008090552_phase27_integrations/.test(dep.stdout + dep.stderr) && /20261009100000_publication_source_provenance/.test(dep.stdout + dep.stderr), (dep.stdout + dep.stderr).slice(-400));
    const neu = client(newFile);
    const after = await fingerprint(neu, oldTables, oldCols); // the OLD columns of the OLD tables
    for (const n of oldTables) t(`migration: table ${n} — same ${before[n].count} rows, identical content (old columns)`, after[n].count === before[n].count && after[n].hash === before[n].hash, `${after[n].count} vs ${before[n].count}`);
    const newTables = await tables(neu);
    t("migration: no existing table was dropped or renamed", oldTables.every((n) => newTables.includes(n)));
    t("migration: exactly the five documented tables were added (four Phase 27 + PublicationSourceRecord)", JSON.stringify(newTables.filter((n) => !oldTables.includes(n)).sort()) === JSON.stringify(["OAuthIdentity", "PublicationCandidate", "PublicationCandidateResearcher", "PublicationSourceRecord", "SyncState"]), newTables.join());
    for (const n of ["OAuthIdentity", "PublicationCandidate", "PublicationCandidateResearcher", "PublicationSourceRecord", "SyncState"]) t(`migration: new table ${n} starts empty`, Number((await q(neu, `SELECT count(*) AS c FROM "${n}"`))[0].c) === 0);
    const tmCols = await columnsOf(neu, ["TeamMember"]);
    t("migration: TeamMember gained exactly scholarUrl, researchGateUrl, orcid, isPublished", JSON.stringify(tmCols.TeamMember.filter((c) => !oldCols.TeamMember.includes(c)).sort()) === JSON.stringify(["isPublished", "orcid", "researchGateUrl", "scholarUrl"]));
    const pubCols = await columnsOf(neu, ["Publication"]);
    t("migration: Publication gained exactly one nullable column, sourceOrder (existing rows stay NULL)", JSON.stringify(pubCols.Publication.filter((c) => !oldCols.Publication.includes(c))) === JSON.stringify(["sourceOrder"]) && Number((await q(neu, `SELECT count(*) AS c FROM "Publication" WHERE sourceOrder IS NOT NULL`))[0].c) === 0);
    const defaults = await q(neu, `SELECT count(*) AS n, sum(scholarUrl='' AND researchGateUrl='' AND orcid='' AND isPublished=1) AS d FROM "TeamMember"`);
    t("migration: every existing TeamMember got the defaults ('' and published)", Number(defaults[0].n) === Number(defaults[0].d) && Number(defaults[0].n) === before.TeamMember.count);
    t("migration: no foreign-key violation anywhere", (await q(neu, "PRAGMA foreign_key_check")).length === 0);
    t("migration: integrity check is ok", (await q(neu, "PRAGMA integrity_check"))[0].integrity_check === "ok");
    const sql = readFileSync(path.join(SERVER_ROOT, "prisma", "migrations", "20261008090552_phase27_integrations", "migration.sql"), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL)/gi, "");
    t("migration: the SQL has no DROP, RENAME, DELETE, UPDATE or table REDEFINE", !/\b(DROP|RENAME|DELETE|UPDATE|INSERT)\b/i.test(sql) && !/__new_|PRAGMA/i.test(sql));
    const sql2 = readFileSync(path.join(SERVER_ROOT, "prisma", "migrations", "20261009100000_publication_source_provenance", "migration.sql"), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL)/gi, "");
    t("migration (provenance): the SQL has no DROP, RENAME, DELETE, UPDATE, INSERT or table REDEFINE", !/\b(DROP|RENAME|DELETE|UPDATE|INSERT)\b/i.test(sql2) && !/__new_|PRAGMA/i.test(sql2));
    // Cascade check: deleting an OLD parent row only cascades into NEW tables (never into pre-existing data).
    const probeUser = (await q(neu, `SELECT id FROM "User" LIMIT 1`))[0];
    if (probeUser) {
      await q(neu, `PRAGMA foreign_keys=ON`);
      await neu.$executeRawUnsafe(`INSERT INTO "OAuthIdentity" (id, provider, subject, userId, email) VALUES ('probe1','google','probe-sub','${probeUser.id}','x@example.test')`);
      t("migration: the new OAuthIdentity FK is enforced against the existing User table", Number((await q(neu, `SELECT count(*) AS c FROM "OAuthIdentity" WHERE id='probe1'`))[0].c) === 1);
    }
    await neu.$disconnect();

    // ---- 4. the guard across both supported engines and realistic failure shapes ----------------------------------------------------
    const probe = (file, engine, timeout = 60000) => {
      const r = spawnSync(process.execPath, [TSX, path.join(SERVER_ROOT, "scripts", "schema-guard-probe.ts"), file, engine], { cwd: SERVER_ROOT, env: cleanEnv, encoding: "utf8", timeout });
      try { return JSON.parse(r.stdout.trim().split("\n").pop()); } catch { return { status: "no-output", raw: (r.stdout + r.stderr).slice(-200) }; }
    };
    const partial = path.join(work, "partial.db"); // migrated, then ONE Phase 27 column removed: tables present, column missing
    copyFileSync(newFile, partial);
    { const c = client(partial); await c.$executeRawUnsafe(`ALTER TABLE "TeamMember" DROP COLUMN "orcid"`); await c.$disconnect(); }
    const noTable = path.join(work, "notable.db"); // migrated, then a Phase 27 table removed
    copyFileSync(newFile, noTable);
    { const c = client(noTable); await c.$executeRawUnsafe(`DROP TABLE "SyncState"`); await c.$disconnect(); }
    const garbage = path.join(work, "garbage.db");
    writeFileSync(garbage, "this is not a sqlite database\n".repeat(50));
    for (const engine of ["plain", "libsql"]) {
      t(`guard [${engine}]: pre-Phase-27 database (new tables AND columns missing) -> behind`, probe(oldFile, engine).status === "behind");
      t(`guard [${engine}]: fully migrated database -> ok`, probe(newFile, engine).status === "ok");
      t(`guard [${engine}]: tables present but ONE column missing -> behind (the case an unqualified probe misses on bundled SQLite)`, probe(partial, engine).status === "behind", JSON.stringify(probe(partial, engine)));
      t(`guard [${engine}]: one Phase 27 table missing -> behind`, probe(noTable, engine).status === "behind");
      t(`guard [${engine}]: a file that is not a database is NOT reported as schema-behind`, probe(garbage, engine).status === "unknown", JSON.stringify(probe(garbage, engine)));
      { const res = probe(path.join(work, "no", "such", "dir", "x.db"), engine); t(`guard [${engine}]: an unreachable path is NOT reported as schema-behind (unknown, or the engine refuses it before the guard runs)`, ["unknown", "engine-unavailable"].includes(res.status), JSON.stringify(res)); }
    }
    // A locked database (another writer holds an exclusive lock) is an unrelated failure, not a missing schema.
    const lockFile = path.join(work, "locked.db");
    copyFileSync(newFile, lockFile);
    const holder = spawn("python3", ["-I", "-c", `import sqlite3,time,sys\nc=sqlite3.connect(sys.argv[1],isolation_level=None)\nc.execute('BEGIN EXCLUSIVE')\nprint('locked',flush=True)\ntime.sleep(40)`, lockFile]);
    await new Promise((r) => holder.stdout.once("data", r));
    for (const engine of ["plain", "libsql"]) {
      const res = probe(lockFile, engine, 45000);
      t(`guard [${engine}]: a LOCKED database is NOT reported as schema-behind`, res.status !== "behind" && res.status !== "ok", JSON.stringify(res));
    }
    holder.kill();

    // The same through the whole app on the production engine path: clean 503 on the old schema, normal service on the new one.
    {
      const s3 = await startServer(oldFile, "libsql");
      try {
        const team = await get(s3.base, "/api/team");
        t("libsql adapter, old schema: GET /api/team is a clean 503 DB_SCHEMA_BEHIND", team.status === 503 && team.json?.code === "DB_SCHEMA_BEHIND", `${team.status} ${JSON.stringify(team.json)}`);
        t("libsql adapter, old schema: the response and log expose no SQL, table, column, path or token", !/SELECT|OAuthIdentity|scholarUrl|\/tmp|local-test-token|libsql/i.test(JSON.stringify(team.json) + s3.logs().split("\n").filter((l) => /schema|DB_SCHEMA/.test(l)).join("\n")));
        t("libsql adapter, old schema: /api/health still answers", (await get(s3.base, "/api/health")).status === 200);
      } finally { await s3.stop(); }
      const s4 = await startServer(newFile, "libsql");
      try {
        t("libsql adapter, new schema: GET /api/team serves 200 and login works", (await get(s4.base, "/api/team")).status === 200 && (await get(s4.base, "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@smartcomputinglab.org", password: "ChangeMe123!" }) })).status === 200);
      } finally { await s4.stop(); }
    }

    // ---- 3. the same code on the NEW schema serves normally -------------------------------------------------------------------
    const s2 = await startServer(newFile);
    try {
      t("new schema: /api/team serves 200", (await get(s2.base, "/api/team")).status === 200);
      t("new schema: /api/updates and /api/site-config serve 200", (await get(s2.base, "/api/updates")).status === 200 && (await get(s2.base, "/api/site-config")).status === 200);
      t("new schema: password login works", (await get(s2.base, "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@smartcomputinglab.org", password: "ChangeMe123!" }) })).status === 200);
      t("new schema: no DB_SCHEMA_BEHIND was logged", !/DB_SCHEMA_BEHIND/.test(s2.logs()));
    } finally {
      await s2.stop();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${ok} schema-compat checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}
main().catch((err) => {
  console.error(err);
  if (failures.length) console.log("Failures so far:\n - " + failures.join("\n - "));
  process.exit(1);
});
