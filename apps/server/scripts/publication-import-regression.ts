/**
 * Regression test of the publication-list import and of the public/API behaviour it relies on, through the REAL application (createApp) and
 * the REAL command (scripts/import-publications.ts), with REAL password logins. Isolated: brand-new SQLite files built from the repository's own
 * migrations in a temp directory. It never reads TURSO_* / DATABASE_URL for its own data (refuses to run if TURSO_* is set), never touches a hosted
 * database and never opens a non-loopback connection.
 *   npx tsx scripts/publication-import-regression.ts      (or: npm run test:publication-import -w apps/server)
 *
 * The 23 source records are the lab's real list (scripts/fixtures/publication-list-records.json) written out as a genuine .xlsx.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { formWorkbook, loadFixtureRecords } from "./lib/xlsxFixture.ts";

if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) {
  console.error("Refusing to run: Turso variables are set. Unset TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.");
  process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, "..");
const MIGRATIONS = path.join(SERVER, "prisma", "migrations");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "scl-pubimport-"));

async function makeDb(name: string, upTo?: string): Promise<string> {
  const file = path.join(workDir, name);
  const c = createClient({ url: `file:${file}` });
  for (const d of fs.readdirSync(MIGRATIONS, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) {
    if (upTo && d > upTo) break;
    await c.executeMultiple(fs.readFileSync(path.join(MIGRATIONS, d, "migration.sql"), "utf8"));
  }
  c.close();
  return file;
}
const mainDb = await makeDb("main.db");
process.env.DATABASE_URL = `file:${mainDb}`;
process.env.SESSION_SECRET = "publication-import-regression-secret-00";
process.env.NODE_ENV = "test";
process.env.STORAGE_DIR = path.join(workDir, "files");
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.LAB_BLOB_READ_WRITE_TOKEN;

let offLoopback = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const u = new URL(typeof input === "string" ? input : input.url ?? String(input));
  if (u.hostname !== "127.0.0.1") { offLoopback++; return Promise.reject(new Error("network blocked")); }
  return realFetch(input, init);
}) as typeof fetch;
const realError = console.error;
console.error = (...a: unknown[]) => void a;

const bcrypt = (await import("bcryptjs")).default;
const { PrismaClient } = await import("@prisma/client");
const { prisma } = await import("../src/lib/prisma.js");
const { createApp } = await import("../src/app.js");
const lib = await import("../src/lib/publicationImport/index.ts");

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(detail ? `${name} :: ${detail}` : name));

const server = await new Promise<{ base: string; close: () => void }>((resolve) => {
  const s = http.createServer(createApp()).listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${(s.address() as any).port}`, close: () => s.close() }));
});
class Browser {
  jar = new Map<string, string>();
  async req(method: string, p: string, body?: unknown) {
    const res = await fetch(server.base + p, {
      method, redirect: "manual",
      headers: { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const val = pair.slice(i + 1);
      if (/;\s*Expires=Thu, 01 Jan 1970/i.test(c) || val === "") this.jar.delete(pair.slice(0, i));
      else this.jar.set(pair.slice(0, i), val);
    }
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b: unknown) => this.req("POST", p, b);
  put = (p: string, b: unknown) => this.req("PUT", p, b);
  del = (p: string) => this.req("DELETE", p);
  login = (email: string, password: string) => this.req("POST", "/api/auth/login", { email, password });
}
const PW = "Passw0rd!-test";
const hash = await bcrypt.hash(PW, 4);
const mkUser = (email: string, role = "MEMBER") => prisma.user.create({ data: { email, passwordHash: hash, role } });
await mkUser("admin@example.org", "ADMIN");
await mkUser("manager@example.org", "LAB_MANAGER");
await mkUser("alice@example.org");
const AD = new Browser(), MG = new Browser(), AL = new Browser(), GUEST = new Browser();
t("setup: accounts can sign in", [await AD.login("admin@example.org", PW), await MG.login("manager@example.org", PW), await AL.login("alice@example.org", PW)].every((r) => r.status === 200));

const file = loadFixtureRecords();
const xlsx = formWorkbook(file);
const xlsxPath = path.join(workDir, "publicationslist.xlsx");
fs.writeFileSync(xlsxPath, xlsx);
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const snapshot = async (db: any) => JSON.stringify(await db.publication.findMany({ orderBy: { id: "asc" } }));

// ---- what the website already holds (the shapes of the lab's live records) --------------------------------------------------------------------------
const ex = {
  signals: await prisma.publication.create({ data: { year: 2026, title: "Optimizing FPGA and Wafer Test Coverage with Spatial Sampling and Machine Learning: Analysis of Local Spatial Consistency", authors: "Weiquan Wang, K.M Shahriar Alam Adib, Foisal Ahmed, Riaz-ul-haque Mian", venue: "MDPI Signals", doiUrl: "https://doi.org/10.3390/signals7030053", pdfUrl: "https://example.org/signals.pdf" } }),
  todaes: await prisma.publication.create({ data: { year: 2026, title: "Enhanced detection of recycled FPGAs using Gaussian process regression with LHS and active sampling", authors: "Yoshito Hagihara, Foisal Ahmed, Yamane Shoma, Riaz-Ul-Haque Mian", venue: "ACM Transactions on Design Automation of Electronic Systems", doiUrl: "https://doi.org/10.1145/3765907" } }),
  integration: await prisma.publication.create({ data: { year: 2025, title: "A progressive self-training semi-supervised model to enhance discontinuous change detection", authors: "Yamane Soma, Sakai Yuwa, Riaz-ul-haque Mian", venue: "Elsevier Integration", doiUrl: "https://doi.org/10.1016/j.vlsi.2025.102609" } }),
  preprint: await prisma.publication.create({ data: { year: 2025, title: "Optimizing FPGA and wafer test coverage with spatial sampling and machine learning", authors: "Wang WeiQuan", venue: "IEEE 2025 5th International Conference on Electrical, Computer and Energy Technologies (ICECET)", doiUrl: "https://doi.org/10.48550/arXiv.2506.03556" } }),
};
const member = await prisma.teamMember.create({ data: { name: "Existing Researcher", initials: "ER", role: "r", category: "MSC" } });
await prisma.publicationAuthor.create({ data: { publicationId: ex.signals.id, teamMemberId: member.id } });
await prisma.translation.create({ data: { entityType: "PUBLICATION", entityId: ex.todaes.id, locale: "ja", field: "title", value: "既存の日本語題目" } });
const existingSnapshot = JSON.stringify(await prisma.publication.findMany({ orderBy: { id: "asc" } }));
const linkCount = () => prisma.publicationAuthor.count();
const trCount = () => prisma.translation.count();

// =====================================================================================================================================
// 1. Plan and dry run
// =====================================================================================================================================
const loaded = await lib.loadExistingPublications(prisma as any);
t("existing: the four stored publications are read, and the migration's columns are present", loaded.rows.length === 4 && loaded.hasNewColumns);
t("existing: rows written before the migration's columns read back as 'not stated'", loaded.rows.every((r) => r.status === "" && r.pubMonth === 0 && r.volume === "" && r.acceptedDate === ""));
const built = lib.buildPlan(xlsx, loaded.rows);
const counts = built.plan.counts;
t("plan: 23 source records", built.parsed.records.length === 23 && counts.total === 23);
t("plan: 16 new, 1 already stored, 2 conflicts, 1 possible match, 3 invalid, 0 duplicates", counts.new === 16 && counts["existing-match"] === 1 && counts.conflict === 2 && counts["possible-match"] === 1 && counts.invalid === 3 && counts["duplicate-in-source"] === 0, JSON.stringify(counts));
const byOrdinal = (n: number) => built.plan.entries[n - 1];
t("plan: record 15 is the identical stored TODAES paper", byOrdinal(15).disposition === "existing-match" && byOrdinal(15).matches[0].id === ex.todaes.id);
t("plan: record 7 conflicts by DOI (year), record 21 by DOI (venue), record 13 is a possible match", byOrdinal(7).disposition === "conflict" && byOrdinal(21).disposition === "conflict" && byOrdinal(13).disposition === "possible-match" && byOrdinal(13).matches[0].id === ex.preprint.id);
t("plan: the planning step itself wrote nothing", (await snapshot(prisma)) === existingSnapshot && (await prisma.auditLog.count()) === 0);

// =====================================================================================================================================
// 2. Apply
// =====================================================================================================================================
const options = { visibility: "PUBLIC" as const, fillEmpty: false, confirmDistinct: new Set<string>() };
const first = await lib.applyPlan(prisma as any, built.plan, options);
const outcomes = (rs: Array<{ outcome: string }>) => rs.reduce<Record<string, number>>((a, r) => ({ ...a, [r.outcome]: (a[r.outcome] ?? 0) + 1 }), {});
t("apply: 16 created, 6 skipped (3 conflicts/possible need a human, 3 invalid), 1 untouched", JSON.stringify(outcomes(first)) === JSON.stringify({ created: 16, skipped: 6, unchanged: 1 }), JSON.stringify(outcomes(first)));
t("apply: 20 publications now (4 + 16)", (await prisma.publication.count()) === 20);
t("apply: every pre-existing record is exactly as it was (no field of any of them changed)", JSON.stringify(await prisma.publication.findMany({ where: { id: { in: Object.values(ex).map((x) => x.id) } }, orderBy: { id: "asc" } })) === existingSnapshot);
t("apply: the relationships of the existing records are preserved", (await linkCount()) === 1 && (await trCount()) === 1 && (await prisma.publicationAuthor.count({ where: { publicationId: ex.signals.id, teamMemberId: member.id } })) === 1);
t("apply: conflicts were NOT resolved by overwriting (venue and year as stored)", (await prisma.publication.findUnique({ where: { id: ex.signals.id } }))?.venue === "MDPI Signals" && (await prisma.publication.findUnique({ where: { id: ex.integration.id } }))?.year === 2025);
t("apply: the possible match was not created, the blocked records were not created", (await prisma.publication.count({ where: { title: { contains: "Design of low power" } } })) === 0 && (await prisma.publication.count({ where: { title: { contains: "HALT-ViT" } } })) === 0 && (await prisma.publication.count({ where: { title: { contains: "Classification (Accepted for Presentatin)" } } })) === 0);
const audits = await prisma.auditLog.findMany({ where: { action: "PUBLICATION_CREATED" } });
t("apply: one audit row per created record, marked as an import, with no actor and no secret", audits.length === 16 && audits.every((a) => a.actorId === null && /"source":"xlsx-import"/.test(a.details ?? "") && !/token|password|hash/i.test(a.details ?? "")));

// spot-check stored values against what the sheet states (written from the sheet, not from the importer)
const row = (doi: string) => prisma.publication.findFirst({ where: { doiUrl: doi } });
const r1 = await row("https://doi.org/10.1587/transfun.2023EAP1115");
t("stored #1: every supplied bibliographic detail", !!r1 && r1.title === "Efficient Wafer-level Spatial Variation Modeling for Multi-site RF IC Testing" && r1.authors === "Riaza-ul-haque MIAN, Tomoki NAKAMURA, Masuo KAJIYAMA, Makoto EIKI, and Michihiro SHINTANI" && r1.venue.startsWith("IEICE Transactions on Fundamentals") && r1.year === 2023 && r1.pubMonth === 11 && r1.volume === "E-107 A" && r1.pageStart === "1139" && r1.pageEnd === "1150" && r1.issn === "1745-1337" && r1.status === "PUBLISHED" && r1.category === "REGULAR PAPER 2023EAP1115");
const r23 = await prisma.publication.findFirst({ where: { title: { startsWith: "A Hybrid Design-to-Computation Pipeline" } } });
t("stored #23: accepted (not published), acceptance date, year and month as stated", !!r23 && r23.status === "ACCEPTED" && r23.acceptedDate === "2026-07-15" && r23.year === 2026 && r23.pubMonth === 8 && r23.doiUrl === "");
const accepted = await prisma.publication.findMany({ where: { status: "ACCEPTED" } });
t("stored: the four accepted papers are ACCEPTED and none is PUBLISHED", accepted.length === 4 && (await prisma.publication.count({ where: { status: "PUBLISHED" } })) === 9);
t("stored: papers whose status is not stated stay 'not stated' (not assumed published)", (await prisma.publication.count({ where: { status: "", doiUrl: "https://doi.org/10.1109/DICTA63115.2024.00086" } })) === 1);
const order = await prisma.publication.findMany({ where: { title: { in: ["Hierarchical Active Learning for Efficient Semi-Supervised Seagrass Image"] } } });
t("stored: author lists keep the original order of a long list", (await prisma.publication.findFirst({ where: { title: { startsWith: "Explainable AI Driven" } } }))?.authors === "Arpa Kar Puza, Abu Mohammad Noor, Toufique Al Imran, Nitun Kumar Podder, Riaz-ul-haque Mian, Md Abdur Rahim" && order.length === 1);

// =====================================================================================================================================
// 3. Idempotency
// =====================================================================================================================================
const afterFirst = await snapshot(prisma);
const auditsAfterFirst = await prisma.auditLog.count();
const second = lib.buildPlan(xlsx, (await lib.loadExistingPublications(prisma as any)).rows);
t("second run plans nothing new: 17 already stored, same conflicts, same blocked", second.plan.counts.new === 0 && second.plan.counts["existing-match"] === 17 && second.plan.counts.conflict === 2 && second.plan.counts["possible-match"] === 1 && second.plan.counts.invalid === 3, JSON.stringify(second.plan.counts));
const secondResults = await lib.applyPlan(prisma as any, second.plan, options);
t("second run creates nothing", !secondResults.some((r) => r.outcome.startsWith("created")) && (await prisma.publication.count()) === 20);
t("second run leaves the table byte-for-byte the same and writes no audit row", (await snapshot(prisma)) === afterFirst && (await prisma.auditLog.count()) === auditsAfterFirst);
const third = await lib.applyPlan(prisma as any, lib.buildPlan(xlsx, (await lib.loadExistingPublications(prisma as any)).rows).plan, options);
t("a third run is the same", (await prisma.publication.count()) === 20 && !third.some((r) => r.outcome.startsWith("created")));

// =====================================================================================================================================
// 4. Human decisions: confirmDistinct and overrides
// =====================================================================================================================================
{
  const decided = lib.buildPlan(xlsx, (await lib.loadExistingPublications(prisma as any)).rows, { records: { "8": { expectTitle: "Design of low power", year: 2017 } }, confirmDistinct: ["13", "7"] });
  t("override: the blocked record 8 becomes importable once a person supplies its year", decided.plan.entries[7].disposition === "new" && decided.candidates[7].overridden.includes("year"));
  const res = await lib.applyPlan(prisma as any, decided.plan, { ...options, confirmDistinct: new Set(["13", "7"]) });
  const by = (n: number) => res.find((r) => r.ordinal === n)!;
  t("confirmDistinct: a possible match a person confirms as distinct is created, and the audit row says so", by(13).outcome === "created-confirmed" && (await prisma.auditLog.count({ where: { action: "PUBLICATION_CREATED", entityId: by(13).id, details: { contains: "confirmedDistinct" } } })) === 1);
  t("confirmDistinct: an identical DOI can never be confirmed as distinct (record 7 stays skipped, nothing duplicated)", by(7).outcome === "skipped" && (await prisma.publication.count({ where: { doiUrl: "https://doi.org/10.1016/j.vlsi.2025.102609" } })) === 1);
  t("override: record 8 was created with the supplied year and everything else as in the sheet", by(8).outcome === "created" && (await prisma.publication.findFirst({ where: { title: { startsWith: "Design of low power" } } }))?.year === 2017);
  t("override + confirm added exactly two records", (await prisma.publication.count()) === 22);
  const again = await lib.applyPlan(prisma as any, lib.buildPlan(xlsx, (await lib.loadExistingPublications(prisma as any)).rows, { records: { "8": { expectTitle: "Design of low power", year: 2017 } }, confirmDistinct: ["13"] }).plan, { ...options, confirmDistinct: new Set(["13"]) });
  t("…and re-running with the same decisions creates nothing", !again.some((r) => r.outcome.startsWith("created")) && (await prisma.publication.count()) === 22);
}

// =====================================================================================================================================
// 5. --fill-empty: only empty fields of an identical record
// =====================================================================================================================================
{
  await prisma.publication.update({ where: { id: ex.todaes.id }, data: { volume: "KEEP-ME" } });
  const before = await prisma.publication.findUnique({ where: { id: ex.todaes.id } });
  const plan = lib.buildPlan(xlsx, (await lib.loadExistingPublications(prisma as any)).rows).plan;
  const without = await lib.applyPlan(prisma as any, plan, options);
  t("fill-empty off: the identical stored record is left untouched", without.find((r) => r.ordinal === 15)?.outcome === "unchanged" && JSON.stringify(await prisma.publication.findUnique({ where: { id: ex.todaes.id } })) === JSON.stringify(before));
  const filled = await lib.applyPlan(prisma as any, plan, { ...options, fillEmpty: true });
  const after = await prisma.publication.findUnique({ where: { id: ex.todaes.id } });
  t("fill-empty on: empty fields are filled from the sheet", filled.find((r) => r.ordinal === 15)?.outcome === "filled" && after?.pageStart === "1" && after?.pageEnd === "21" && after?.pubMonth === 3 && after?.issn === "1084-4309");
  t("fill-empty on: a field that already had a value is never overwritten", after?.volume === "KEEP-ME");
  t("fill-empty on: the identifying fields are untouched", after?.title === before?.title && after?.authors === before?.authors && after?.venue === before?.venue && after?.year === before?.year && after?.doiUrl === before?.doiUrl);
  t("fill-empty on: conflicting records are never filled", (await prisma.publication.findUnique({ where: { id: ex.signals.id } }))?.volume === "" && (await prisma.publication.findUnique({ where: { id: ex.signals.id } }))?.pageStart === "");
  t("fill-empty on: the translation of the filled record is intact", (await trCount()) === 1);
  const refill = await lib.applyPlan(prisma as any, plan, { ...options, fillEmpty: true });
  t("fill-empty: running it again changes nothing", refill.find((r) => r.ordinal === 15)?.outcome === "unchanged");
}

// =====================================================================================================================================
// 6. Resumable, failure-tolerant, write-time guard, visibility (separate databases)
// =====================================================================================================================================
{
  const dbFile = await makeDb("resume.db");
  const db = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
  const plan = lib.buildPlan(xlsx, []).plan;
  const head = { ...plan, entries: plan.entries.slice(0, 5) };
  await lib.applyPlan(db, head, options);
  t("resumable: an interrupted run (first 5 records) leaves those 5 complete", (await db.publication.count()) === 5);
  const resumed = await lib.applyPlan(db, lib.buildPlan(xlsx, (await lib.loadExistingPublications(db)).rows).plan, options);
  t("resumable: the next run skips what exists and creates the rest (20 in total, no duplicates)", (await db.publication.count()) === 20 && resumed.filter((r) => r.outcome.startsWith("created")).length === 15);
  t("resumable: no DOI occurs twice", Number(((await db.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM (SELECT lower(doiUrl) AS d FROM "Publication" WHERE doiUrl <> '' GROUP BY d HAVING COUNT(*) > 1)`)) as any[])[0].n) === 0);

  const db2File = await makeDb("guard.db");
  const db2 = new PrismaClient({ datasources: { db: { url: `file:${db2File}` } } });
  const stale = lib.buildPlan(xlsx, []).plan;
  await db2.publication.create({ data: { year: 2023, title: "Someone else added this meanwhile", authors: "x", venue: "y", doiUrl: "https://doi.org/10.1587/transfun.2023EAP1115" } });
  const guarded = await lib.applyPlan(db2, stale, options);
  t("write-time guard: a record added by someone else after the plan was made is caught (skipped, never duplicated)", guarded.find((r) => r.ordinal === 1)?.outcome === "skipped" && (await db2.publication.count({ where: { doiUrl: "https://doi.org/10.1587/transfun.2023EAP1115" } })) === 1);

  const db3File = await makeDb("fail.db");
  const db3 = new PrismaClient({ datasources: { db: { url: `file:${db3File}` } } });
  const failing = lib.buildPlan(xlsx, []).plan;
  (failing.entries[1].candidate.fields as any).authors = null; // a value the database refuses
  const mixed = await lib.applyPlan(db3, failing, options);
  t("failure tolerance: one record that cannot be written is reported as failed and does not stop the others", mixed[1].outcome === "failed" && (await db3.publication.count()) === 19, JSON.stringify(outcomes(mixed)));
  t("failure tolerance: the failure message carries no connection detail", !/file:|libsql|token/i.test(mixed[1].detail));

  const db4File = await makeDb("lab.db");
  const db4 = new PrismaClient({ datasources: { db: { url: `file:${db4File}` } } });
  await lib.applyPlan(db4, lib.buildPlan(xlsx, []).plan, { ...options, visibility: "LAB_ONLY" });
  t("visibility: --visibility LAB_ONLY stages every created record as LAB_ONLY", (await db4.publication.count({ where: { visibility: "LAB_ONLY" } })) === 20 && (await db4.publication.count({ where: { visibility: "PUBLIC" } })) === 0);
  await db.$disconnect(); await db2.$disconnect(); await db3.$disconnect(); await db4.$disconnect();
}

// =====================================================================================================================================
// 7. The public API over the imported data
// =====================================================================================================================================
const list = async (query = "", who = GUEST) => (await who.get(`/api/publications/browse?limit=50${query}`)).json;
const all = await list();
t("API: a visitor sees every imported and existing publication (22) in one page", all.total === 22 && all.items.length === 22 && all.pageCount === 1);
t("API: the public JSON carries every supported field and no visibility flag", all.items.every((p: any) => ["id", "year", "title", "authors", "venue", "pdfUrl", "doiUrl", "extraUrl", "extraLabel", "status", "pubMonth", "volume", "pageStart", "pageEnd", "issn", "isbn", "category", "acceptedDate"].every((k) => k in p)) && all.items.every((p: any) => !("visibility" in p)));
const key = (p: any) => p.year * 100 + p.pubMonth;
t("API: chronological, newest first (year, then month)", all.items.every((p: any, i: number) => i === 0 || key(all.items[i - 1]) >= key(p)));
const one = all.items.find((p: any) => p.doiUrl === "https://doi.org/10.3390/signals7040075");
t("API: a record's every field round-trips", !!one && one.volume === "7(4), 75" && one.pageStart === "1" && one.pageEnd === "17" && one.issn === "2624-6120" && one.status === "PUBLISHED" && one.pubMonth === 8 && one.year === 2026 && one.category === "REGULAR PAPER" && one.isbn === "" && one.acceptedDate === "");
const countWhere = (where: any) => prisma.publication.count({ where });
for (const status of ["PUBLISHED", "ACCEPTED", "SUBMITTED"]) {
  const r = await list(`&status=${status}`);
  t(`API filter status=${status}`, r.total === (await countWhere({ status })) && r.items.every((p: any) => p.status === status), `${r.total}`);
}
const unspec = await list("&status=UNSPECIFIED");
t("API filter status=UNSPECIFIED returns exactly the records that state none", unspec.total === (await countWhere({ status: "" })) && unspec.total >= 5 && unspec.items.every((p: any) => p.status === ""));
t("API filter: an unknown status is a 400, not silently ignored", (await GUEST.get("/api/publications/browse?status=DONE")).status === 400);
t("API filter: year", (await list("&year=2021")).total === (await countWhere({ year: 2021 })) && (await list("&year=2021")).total === 3);
t("API filter: status and year combine", (await list("&year=2026&status=ACCEPTED")).total === (await countWhere({ year: 2026, status: "ACCEPTED" })));
t("API search: by title", (await list("&q=Hierarchical+Active")).total === 1 && (await list("&q=Hierarchical")).total === 2);
t("API search: by an author's name (case-insensitive)", (await list("&q=nakamura")).total === 2);
t("API search: by journal / conference", (await list("&q=Signals")).total === 2 && (await list("&q=ITC")).items.some((p: any) => p.venue === "2021 IEEE International Test Conference (ITC)"));
t("API search: by DOI", (await list(`&q=${encodeURIComponent("10.3390/world7020021")}`)).total === 1);
t("API search: by ISSN", (await list("&q=2624-6120")).total === 1);
t("API search: by year", (await list("&q=2018")).total === 1);
t("API search: several words are AND-ed", (await list("&q=wafer+nakamura")).total >= 1 && (await list("&q=wafer+zzzzzz")).total === 0);
t("API search: no match is an empty list, not an error", (await GUEST.get("/api/publications/browse?q=qqqqqqqqq")).status === 200 && (await list("&q=qqqqqqqqq")).total === 0);
const sorted = await list("&sort=oldest");
t("API sort: oldest first", sorted.items[0].year === 2017 && sorted.items.every((p: any, i: number) => i === 0 || key(sorted.items[i - 1]) <= key(p)));
const detail = await GUEST.get(`/api/publications/${one.id}`);
t("API detail: the publication page data has every field", detail.status === 200 && detail.json.volume === "7(4), 75" && detail.json.issn === "2624-6120" && detail.json.pageEnd === "17" && detail.json.status === "PUBLISHED");
t("API detail: an unknown id is a 404", (await GUEST.get("/api/publications/clzzzzzzzzzzzzzzzzzzzzzzz")).status === 404);
t("API list: GET /api/publications (used by pickers) also carries the new fields", ((await GUEST.get("/api/publications")).json as any[]).every((p) => "status" in p && "pubMonth" in p));

// staged (LAB_ONLY) records are not public
await prisma.publication.update({ where: { id: one.id }, data: { visibility: "LAB_ONLY" } });
t("visibility: a LAB_ONLY imported record is hidden from visitors and visible to signed-in members", (await list()).total === 21 && (await list("", AL)).total === 22 && (await GUEST.get(`/api/publications/${one.id}`)).status === 404);
await prisma.publication.update({ where: { id: one.id }, data: { visibility: "PUBLIC" } });

// =====================================================================================================================================
// 8. Authorization and the API's validation of the new fields
// =====================================================================================================================================
{
  const body = { year: 2026, title: "Auth probe", authors: "A", venue: "V" };
  t("auth: an anonymous visitor cannot create, edit or delete a publication", (await GUEST.post("/api/publications", body)).status === 401 && (await GUEST.put(`/api/publications/${one.id}`, { title: "x" })).status === 401 && (await GUEST.del(`/api/publications/${one.id}`)).status === 401);
  t("auth: there is no import endpoint to call (404), anonymous or signed in", (await GUEST.post("/api/publications/import", {})).status === 404 && (await AD.post("/api/publications/import", {})).status === 404 && (await AD.post("/api/admin/import", {})).status === 404);
  t("auth: nothing changed", (await prisma.publication.count()) === 22);
  const created = await AL.post("/api/publications", { ...body, status: "ACCEPTED", pubMonth: 5, volume: "12(3)", pageStart: "10", pageEnd: "20", issn: "1234-5678", isbn: "978-3-16-148410-0", category: "REGULAR PAPER", acceptedDate: "2026-05-01" });
  t("API create: a member can create a publication with every new field, echoed back", created.status === 201 && created.json.status === "ACCEPTED" && created.json.pubMonth === 5 && created.json.volume === "12(3)" && created.json.pageStart === "10" && created.json.pageEnd === "20" && created.json.issn === "1234-5678" && created.json.isbn === "978-3-16-148410-0" && created.json.category === "REGULAR PAPER" && created.json.acceptedDate === "2026-05-01", created.text);
  const plain = await AL.post("/api/publications", { ...body, title: "Auth probe without new fields" });
  t("API create: the new fields are optional and default to 'not stated'", plain.status === 201 && plain.json.status === "" && plain.json.pubMonth === 0 && plain.json.volume === "" && plain.json.acceptedDate === "");
  const bad = async (patch: Record<string, unknown>) => (await AL.post("/api/publications", { ...body, title: `Bad ${JSON.stringify(patch)}`, ...patch })).status;
  t("API validation: bad status, month, ISSN, ISBN and acceptance date are 400s", (await bad({ status: "DONE" })) === 400 && (await bad({ pubMonth: 13 })) === 400 && (await bad({ pubMonth: -1 })) === 400 && (await bad({ issn: "12345678" })) === 400 && (await bad({ isbn: "12" })) === 400 && (await bad({ acceptedDate: "2026-02-31" })) === 400 && (await bad({ acceptedDate: "15 July" })) === 400);
  const upd = await AL.put(`/api/publications/${created.json.id}`, { status: "PUBLISHED", pubMonth: 6 });
  t("API update: new fields can be corrected without touching the rest", upd.status === 200 && upd.json.status === "PUBLISHED" && upd.json.pubMonth === 6 && upd.json.volume === "12(3)" && upd.json.title === "Auth probe");
  const audit = await prisma.auditLog.findFirst({ where: { action: "PUBLICATION_UPDATED", entityId: created.json.id } });
  t("API update: the audit row names the changed fields (not their text)", /status,pubMonth|pubMonth,status/.test(audit?.details ?? ""));
  const dup = await AL.post("/api/publications", { ...body, title: "Another paper", doiUrl: "https://doi.org/10.3390/signals7040075" });
  t("existing duplicate prevention still applies to imported data: the same DOI is refused (409, publication-doi)", dup.status === 409 && dup.json?.kind === "publication-doi" && dup.json?.overridable === false);
  const mgrDup = await MG.post("/api/publications", { ...body, title: "Another paper", doiUrl: "http://dx.doi.org/10.3390/SIGNALS7040075", confirmDuplicate: true });
  t("…even for a manager who confirms (an identical DOI is never overridable)", mgrDup.status === 409);
}

// =====================================================================================================================================
// 9. The command line
// =====================================================================================================================================
function runCli(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, ["--import", "tsx", path.join(SERVER, "scripts", "import-publications.ts"), ...args], {
    cwd: SERVER,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    encoding: "utf8",
    timeout: 90000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
{
  const cliDb = await makeDb("cli.db");
  const cliUrl = `file:${cliDb}`;
  const base = ["--file", xlsxPath, "--expect-target", cliUrl];
  const env = { IMPORT_TARGET_URL: cliUrl };
  const before = sha(cliDb);
  const dry = runCli([...base, "--report-dir", path.join(workDir, "report")], env);
  t("CLI dry run: exits 0, reports the counts, writes the report files", dry.code === 0 && /Publication records found in the source \| 23/.test(dry.out) && fs.existsSync(path.join(workDir, "report", "report.md")) && fs.existsSync(path.join(workDir, "report", "report.json")), dry.out.slice(-300));
  t("CLI dry run: the database file is byte-identical afterwards", sha(cliDb) === before);
  const rep = JSON.parse(fs.readFileSync(path.join(workDir, "report", "report.json"), "utf8"));
  t("CLI report: the JSON report lists the source -> destination mapping and 23 records", rep.fieldMap.length >= 14 && rep.records.length === 23 && rep.summary.counts.new === 20 && rep.summary.counts.invalid === 3);
  const applied = runCli([...base, "--apply"], env);
  const db = new PrismaClient({ datasources: { db: { url: cliUrl } } });
  t("CLI apply: creates the 20 importable records", applied.code === 0 && (await db.publication.count()) === 20);
  const h1 = sha(cliDb);
  const again = runCli([...base, "--apply"], env);
  t("CLI apply twice: the second run creates nothing and the database file is byte-identical", again.code === 0 && sha(cliDb) === h1 && (await db.publication.count()) === 20);
  t("CLI: the report of the second run says 20 already stored", /Already stored, identical \(existing match\) \| 20/.test(again.out));

  const refusals: Array<[string, string[], Record<string, string>]> = [
    ["no --file", ["--expect-target", cliUrl], env],
    ["no --expect-target", ["--file", xlsxPath], env],
    ["a wrong --expect-target", ["--file", xlsxPath, "--expect-target", "file:/somewhere/else.db"], env],
    ["no IMPORT_TARGET_URL", base, {}],
    ["an unknown argument", [...base, "--frobnicate"], env],
    ["a bad --visibility", [...base, "--visibility", "SECRET"], env],
    ["a missing file", ["--file", path.join(workDir, "nope.xlsx"), "--expect-target", cliUrl], env],
    ["a file that is not an .xlsx", ["--file", path.join(SERVER, "package.json"), "--expect-target", cliUrl], env],
    ["a relative file target", ["--file", xlsxPath, "--expect-target", "file:rel.db"], { IMPORT_TARGET_URL: "file:rel.db" }],
    ["an http target", ["--file", xlsxPath, "--expect-target", "example.org"], { IMPORT_TARGET_URL: "https://example.org" }],
    ["a remote target with no token", ["--file", xlsxPath, "--expect-target", "x-y.turso.io"], { IMPORT_TARGET_URL: "libsql://x-y.turso.io" }],
    ["--apply to a remote target without --allow-remote", ["--file", xlsxPath, "--expect-target", "x-y.turso.io", "--apply"], { IMPORT_TARGET_URL: "libsql://x-y.turso.io", IMPORT_TARGET_TOKEN: "SECRET-TOKEN-VALUE-12345" }],
    ["a non-JSON overrides file", [...base, "--overrides", xlsxPath], env],
  ];
  for (const [name, args, e] of refusals) {
    const r = runCli(args, e);
    t(`CLI refuses ${name} (exit 2)`, r.code === 2, `${r.code}: ${r.out.slice(-160).replace(/\n/g, " ")}`);
  }
  const leak = runCli(["--file", xlsxPath, "--expect-target", "x-y.turso.io", "--apply"], { IMPORT_TARGET_URL: "libsql://x-y.turso.io", IMPORT_TARGET_TOKEN: "SECRET-TOKEN-VALUE-12345" });
  t("CLI never prints the token or the connection URL", !leak.out.includes("SECRET-TOKEN-VALUE-12345") && !leak.out.includes("libsql://"));

  const old = await makeDb("old.db", "20261027120000");
  const oldBefore = sha(old);
  const noMig = runCli(["--file", xlsxPath, "--expect-target", `file:${old}`, "--apply"], { IMPORT_TARGET_URL: `file:${old}` });
  t("CLI refuses --apply on a database that has not had the migration (exit 2), and changes nothing", noMig.code === 2 && /migration/.test(noMig.out) && sha(old) === oldBefore);
  const noMigDry = runCli(["--file", xlsxPath, "--expect-target", `file:${old}`], { IMPORT_TARGET_URL: `file:${old}` });
  t("CLI dry run still works on a database without the migration (it can only plan) and changes nothing", noMigDry.code === 0 && sha(old) === oldBefore);

  const other = await makeDb("other.db");
  const otherBefore = sha(other);
  const ambientDb = await makeDb("ambient-target.db");
  const ambient = runCli(["--file", xlsxPath, "--expect-target", `file:${ambientDb}`, "--apply"], { IMPORT_TARGET_URL: `file:${ambientDb}`, DATABASE_URL: `file:${other}`, TURSO_DATABASE_URL: "libsql://prod-example.turso.io", TURSO_AUTH_TOKEN: "AMBIENT-TOKEN" });
  const ambientCount = new PrismaClient({ datasources: { db: { url: `file:${ambientDb}` } } });
  t("CLI ignores ambient DATABASE_URL / TURSO_* variables: only IMPORT_TARGET_URL selects the database", ambient.code === 0 && (await ambientCount.publication.count()) === 20 && sha(other) === otherBefore && !ambient.out.includes("AMBIENT-TOKEN"), ambient.out.slice(-200));
  await ambientCount.$disconnect();
  await db.$disconnect();
}

t("no request left loopback", offLoopback === 0, String(offLoopback));
server.close();
await prisma.$disconnect();
console.error = realError;
fs.rmSync(workDir, { recursive: true, force: true });
console.log(`${ok} publication-import checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
process.exit(0);
