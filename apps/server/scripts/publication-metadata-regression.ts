/**
 * Regression test of the optional publication metadata (status, list number, category, volume, start/end page, month, date of acceptance)
 * through the REAL application (createApp) with REAL password logins: create with and without the metadata, validation, update without
 * losing what was not changed, clearing, the form's "send everything back" edit, read endpoints, the existing duplicate protection and the
 * existing authorization/visibility rules. Isolated: a brand-new SQLite file built from the repository's own migrations in a temp directory;
 * it refuses to run if TURSO_* is set, never touches a hosted database and never opens a non-loopback connection.
 *   npx tsx scripts/publication-metadata-regression.ts      (or: npm run test:publication-metadata -w apps/server)
 *
 * STATUS WHEN WRITTEN: written in a session with no installed dependencies, so it has NOT been executed there. Run it before relying on it.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) {
  console.error("Refusing to run: Turso variables are set. Unset TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.");
  process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, "..", "prisma", "migrations");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "scl-pubmeta-"));
const dbFile = path.join(workDir, "t.db");
{
  const c = createClient({ url: `file:${dbFile}` });
  for (const d of fs.readdirSync(MIGRATIONS, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) {
    await c.executeMultiple(fs.readFileSync(path.join(MIGRATIONS, d, "migration.sql"), "utf8"));
  }
  c.close();
}
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.SESSION_SECRET = "publication-metadata-regression-secret-0";
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
console.error = (...a: unknown[]) => void a;

const bcrypt = (await import("bcryptjs")).default;
const { prisma } = await import("../src/lib/prisma.js");
const { createApp } = await import("../src/app.js");

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
const AD = new Browser(), MG = new Browser(), AL = new Browser(), ANON = new Browser();
t("setup: every account can sign in", [await AD.login("admin@example.org", PW), await MG.login("manager@example.org", PW), await AL.login("alice@example.org", PW)].every((r) => r.status === 200));

const META = { status: "PUBLISHED", listNumber: "1745-1337", category: "REGULAR PAPER", volume: "E-107 A", startPage: 1139, endPage: 1150, month: 11, acceptedDate: "2026-07-15" };
const BASE = { year: 2023, title: "Metadata paper one", authors: "A. One, B. Two", venue: "Journal of Tests", doiUrl: "https://doi.org/10.1234/meta.one" };
const rowOf = (id: string) => prisma.publication.findUnique({ where: { id } });
const metaOf = (o: any) => ({ status: o.status, listNumber: o.listNumber, category: o.category, volume: o.volume, startPage: o.startPage, endPage: o.endPage, month: o.month, acceptedDate: o.acceptedDate });

// ---- create ---------------------------------------------------------------------------------------------------------------------------
const created = await AL.post("/api/publications", { ...BASE, ...META });
t("create: any signed-in member can create a publication with the metadata (201)", created.status === 201, created.text);
t("create: the response returns every metadata field", JSON.stringify(metaOf(created.json)) === JSON.stringify(META), JSON.stringify(created.json));
t("create: the database holds the same values", JSON.stringify(metaOf(await rowOf(created.json.id))) === JSON.stringify(META));
const id1: string = created.json.id;

const legacy = await AL.post("/api/publications", { year: 2022, title: "Metadata paper two", authors: "C. Three", venue: "Older client" });
t("create: an older request with none of the new fields still works (201)", legacy.status === 201, legacy.text);
t("create: ... and stores 'not stated' ('' and 0)", JSON.stringify(metaOf(legacy.json)) === JSON.stringify({ status: "", listNumber: "", category: "", volume: "", startPage: 0, endPage: 0, month: 0, acceptedDate: "" }));
const id2: string = legacy.json.id;

const blanks = await AL.post("/api/publications", { year: 2021, title: "Metadata paper three", authors: "D. Four", venue: "Form client", status: "", listNumber: "", category: "", volume: "", startPage: "", endPage: "", month: "", acceptedDate: "" });
t("create: blank boxes (as the form sends them) are 'not stated'", blanks.status === 201 && blanks.json.startPage === 0 && blanks.json.month === 0 && blanks.json.status === "", blanks.text);
const numeric = await AL.post("/api/publications", { year: 2020, title: "Metadata paper four", authors: "E. Five", venue: "Form client", startPage: "12", endPage: "20", month: "3" });
t("create: numbers typed as text are accepted and stored as numbers", numeric.status === 201 && numeric.json.startPage === 12 && numeric.json.endPage === 20 && numeric.json.month === 3, numeric.text);

// ---- validation: nothing is stored for a refused request ----------------------------------------------------------------------------------
const before = await prisma.publication.count();
const bad: [string, Record<string, unknown>][] = [
  ["month 13", { month: 13 }], ["month -1", { month: -1 }], ["month 2.5", { month: 2.5 }], ["month 'abc'", { month: "abc" }],
  ["start page -3", { startPage: -3 }], ["start page 1.5", { startPage: 1.5 }], ["end page 100000", { endPage: 100000 }],
  ["end before start", { startPage: 50, endPage: 10 }],
  ["real-looking but impossible date", { acceptedDate: "2026-02-30" }], ["wrong date format", { acceptedDate: "15/07/2026" }], ["date out of range", { acceptedDate: "1850-01-01" }],
  ["unknown status", { status: "DONE" }], ["lower-case status", { status: "published" }],
  ["volume over 100 characters", { volume: "x".repeat(101) }], ["category over 100 characters", { category: "x".repeat(101) }], ["list number over 100 characters", { listNumber: "x".repeat(101) }],
];
for (const [label, extra] of bad) {
  const r = await AL.post("/api/publications", { year: 2019, title: `Invalid ${label}`, authors: "F. Six", venue: "V", ...extra });
  t(`validation: ${label} is refused (400) with a message`, r.status === 400 && typeof r.json?.error === "string", `${r.status} ${r.text}`);
}
t("validation: no refused request stored anything", (await prisma.publication.count()) === before);

// ---- update: nothing that is not sent changes -----------------------------------------------------------------------------------------
const titleOnly = await AL.put(`/api/publications/${id1}`, { title: "Metadata paper one (retitled)" });
t("update: changing only the title keeps every metadata field (200)", titleOnly.status === 200 && JSON.stringify(metaOf(titleOnly.json)) === JSON.stringify(META), titleOnly.text);
t("update: ... and the other existing fields", titleOnly.json.venue === BASE.venue && titleOnly.json.authors === BASE.authors && titleOnly.json.doiUrl === BASE.doiUrl && titleOnly.json.year === BASE.year);

const oneField = await AL.put(`/api/publications/${id1}`, { volume: "E-108 B" });
t("update: changing one metadata field changes only that field", oneField.status === 200 && oneField.json.volume === "E-108 B" && JSON.stringify({ ...metaOf(oneField.json), volume: META.volume }) === JSON.stringify(META), oneField.text);

const onlyMeta = await AL.put(`/api/publications/${id1}`, { month: 12 });
t("update: a request that carries only metadata is a real update (not 'Nothing to update.')", onlyMeta.status === 200 && onlyMeta.json.month === 12, onlyMeta.text);
t("update: an empty request is still 'Nothing to update.' (400)", (await AL.put(`/api/publications/${id1}`, {})).status === 400);

const rangeAgainstStored = await AL.put(`/api/publications/${id1}`, { endPage: 5 });
t("update: an end page before the STORED start page is refused (400)", rangeAgainstStored.status === 400, rangeAgainstStored.text);
const rangeOtherEnd = await AL.put(`/api/publications/${id1}`, { startPage: 2000 });
t("update: a start page after the STORED end page is refused (400)", rangeOtherEnd.status === 400, rangeOtherEnd.text);
t("update: the two refused updates changed nothing", (await rowOf(id1))!.startPage === 1139 && (await rowOf(id1))!.endPage === 1150);
const both = await AL.put(`/api/publications/${id1}`, { startPage: 2000, endPage: 2100 });
t("update: moving the whole range at once is fine", both.status === 200 && both.json.startPage === 2000 && both.json.endPage === 2100, both.text);

const cleared = await AL.put(`/api/publications/${id1}`, { month: "", acceptedDate: "", status: "", startPage: 0, endPage: null });
t("update: '', 0 and null clear the matching fields", cleared.status === 200 && cleared.json.month === 0 && cleared.json.acceptedDate === "" && cleared.json.status === "" && cleared.json.startPage === 0 && cleared.json.endPage === 0, cleared.text);
t("update: ... and leave the ones not sent", cleared.json.volume === "E-108 B" && cleared.json.category === META.category && cleared.json.listNumber === META.listNumber);

// the edit form loads the record and sends EVERY box back
const loaded = (await AL.get(`/api/publications/${id1}`)).json;
const formBody = { year: loaded.year, title: loaded.title, authors: loaded.authors, venue: loaded.venue, pdfUrl: loaded.pdfUrl, doiUrl: loaded.doiUrl, extraUrl: loaded.extraUrl, extraLabel: loaded.extraLabel, ...metaOf(loaded) };
const roundTrip = await AL.put(`/api/publications/${id1}`, formBody);
t("edit form: loading a record and saving it unchanged loses nothing", roundTrip.status === 200 && JSON.stringify(metaOf(roundTrip.json)) === JSON.stringify(metaOf(loaded)) && roundTrip.json.title === loaded.title, roundTrip.text);

// ---- read -------------------------------------------------------------------------------------------------------------------------------
const detail = await ANON.get(`/api/publications/${id2}`);
t("read: the detail endpoint returns the metadata fields (publicly, for a public record)", detail.status === 200 && ["status", "listNumber", "category", "volume", "startPage", "endPage", "month", "acceptedDate"].every((k) => k in detail.json), detail.text);
const browse = await ANON.get("/api/publications/browse?limit=50");
t("read: the browse list returns them too", browse.status === 200 && browse.json.items.every((i: any) => "volume" in i && "acceptedDate" in i), browse.text.slice(0, 200));
const all = await ANON.get("/api/publications");
t("read: the plain list returns them too", all.status === 200 && all.json.every((i: any) => "startPage" in i));

// ---- existing duplicate protection is unchanged ------------------------------------------------------------------------------------------
const sameDoi = await AL.post("/api/publications", { ...BASE, title: "A different title", year: 2024, ...META, volume: "other" });
t("duplicates: the same DOI is still refused (409) whatever the metadata", sameDoi.status === 409 && sameDoi.json?.code === "DUPLICATE_CANDIDATE" && sameDoi.json?.kind === "publication-doi", sameDoi.text);
const sameTitleYear = await AL.post("/api/publications", { year: 2022, title: "Metadata paper two", authors: "Z", venue: "Z", ...META });
t("duplicates: the same title and year is still refused (409)", sameTitleYear.status === 409 && sameTitleYear.json?.kind === "publication-title-year", sameTitleYear.text);
t("duplicates: a member cannot override it", (await AL.post("/api/publications", { year: 2022, title: "Metadata paper two", authors: "Z", venue: "Z", confirmDuplicate: true })).status === 409);
const confirmed = await MG.post("/api/publications", { year: 2022, title: "Metadata paper two", authors: "Z", venue: "Z", ...META, confirmDuplicate: true });
t("duplicates: a manager can still confirm it (201), and the metadata is stored", confirmed.status === 201 && confirmed.json.volume === META.volume, confirmed.text);

// ---- authorization and visibility are unchanged ---------------------------------------------------------------------------------------------
t("auth: an anonymous create is refused (401)", (await ANON.post("/api/publications", { ...BASE, title: "Anon", doiUrl: "", ...META })).status === 401);
t("auth: an anonymous update is refused (401)", (await ANON.put(`/api/publications/${id1}`, { volume: "hacked" })).status === 401);
t("auth: a member cannot delete (403)", (await AL.del(`/api/publications/${id1}`)).status === 403);
t("auth: a member cannot set visibility on create (403)", (await AL.post("/api/publications", { year: 2018, title: "Member lab only", authors: "G", venue: "V", visibility: "LAB_ONLY" })).status === 403);
const labOnly = await MG.post("/api/publications", { year: 2018, title: "Lab only with metadata", authors: "H", venue: "V", visibility: "LAB_ONLY", ...META });
t("visibility: a manager can create a LAB_ONLY publication with metadata (201)", labOnly.status === 201, labOnly.text);
t("visibility: a guest gets 404 for it (metadata does not change that)", (await ANON.get(`/api/publications/${labOnly.json.id}`)).status === 404);
t("visibility: a guest's list does not contain it", !(await ANON.get("/api/publications/browse?limit=50")).json.items.some((i: any) => i.id === labOnly.json.id));
t("visibility: a signed-in member can read it, with the metadata", (await AL.get(`/api/publications/${labOnly.json.id}`)).json?.volume === META.volume);

// ---- audit: field NAMES only ---------------------------------------------------------------------------------------------------------------
const audits = (await prisma.auditLog.findMany({ where: { entityId: id1, action: "PUBLICATION_UPDATED" } })).map((r) => JSON.parse(r.details ?? "{}"));
t("audit: an update records which metadata fields changed (names only)", audits.some((d) => String(d.changed).includes("volume")) && audits.every((d) => !JSON.stringify(d).includes("E-108")));

t("isolation: no request left the loopback interface", offLoopback === 0);
server.close();
await prisma.$disconnect();
fs.rmSync(workDir, { recursive: true, force: true });
if (failures.length > 0) {
  process.stdout.write(`FAILED ${failures.length} of ${ok + failures.length}:\n- ${failures.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`publication metadata regression: ${ok} checks passed\n`);
process.exit(0);
