/**
 * End-to-end check that imported LAB_ONLY publications are enforced SERVER-SIDE on every alternate read path.
 * It builds a disposable database, runs the real importer on a SYNTHETIC manifest (出版 / 投稿中 / 受理 / blank), links the
 * LAB_ONLY records to a researcher, project, group, research area and a resource, starts the real server on it and asks
 * every endpoint that can return a publication — as a guest, an ordinary member and a manager — whether the LAB_ONLY
 * records leak (title, id, DOI, or by being counted). The manager must still see them (non-vacuity).
 *
 *   node scripts/publication-visibility-regression.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");
const TSX = path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };
const PW = "Str0ngPassw0rd!";
let ok = 0;
const failures = [];
const t = (name, cond, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));
if (!existsSync(SOURCE_DB)) { console.error("Missing dev.db — run the seed first."); process.exit(1); }

const work = mkdtempSync(path.join(tmpdir(), "scl-pubvis-"));
const dbFile = path.join(work, "c.db");
copyFileSync(SOURCE_DB, dbFile);
const clean = { ...process.env, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "" };
delete clean.TURSO_DATABASE_URL; delete clean.TURSO_AUTH_TOKEN;

const SHA = "c".repeat(64);
const mk = (seq, status, title, doi) => ({ sheet: "Sheet1", rowStart: 7 + (seq - 1) * 10, rowEnd: 16 + (seq - 1) * 10, seq, fields: [{ column: `C${7 + (seq - 1) * 10}`, label: "t", value: title }], publication: { year: 2031, title, authors: "ZZ Vis Author", venue: "ZZ Vis Venue", doi, status }, warnings: [] });
const T = { pub: "ZZ VISIBILITY published paper", sub: "ZZ VISIBILITY submitted paper", acc: "ZZ VISIBILITY accepted paper", blank: "ZZ VISIBILITY blank status paper" };
const DOI = { pub: "10.9999/zzvis.pub", sub: "10.9999/zzvis.sub", acc: "10.9999/zzvis.acc", blank: "10.9999/zzvis.blank" };
const manifest = { format: "publication-import-manifest/1", batchId: "vis-test", sourceFile: "synthetic.xlsx", sourceSha256: SHA, records: [mk(1, "出版", T.pub, DOI.pub), mk(2, "投稿中", T.sub, DOI.sub), mk(3, "受理", T.acc, DOI.acc), { ...mk(4, null, T.blank, DOI.blank), publication: { ...mk(4, null, T.blank, DOI.blank).publication, year: 2032 } }] };
const manifestFile = path.join(work, "manifest.json");
writeFileSync(manifestFile, JSON.stringify(manifest));

async function startServer() {
  const port = 49300 + Math.floor(Math.random() * 400);
  const env = { ...clean, BLOB_READ_WRITE_TOKEN: "", VERCEL: "", STORAGE_DIR: path.join(work, "files"), DATABASE_URL: `file:${dbFile}`, PORT: String(port), TRUST_PROXY: "0", NODE_ENV: "test", SESSION_SECRET: "pubvis-secret-000000000000000000000", PUBLIC_BASE_URL: "https://lab.example.test" };
  const child = spawn(process.execPath, [TSX, path.join(SERVER_ROOT, "src", "index.ts")], { cwd: SERVER_ROOT, env });
  let out = "";
  child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 80 && !/listening on/.test(out); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/listening on/.test(out)) throw new Error(`server did not start:\n${out}`);
  return { base: `http://localhost:${port}`, stop() { child.kill(); } };
}
function client(base, cookie = null) {
  async function call(method, url, body) {
    const res = await fetch(`${base}${url.startsWith("/sitemap") ? "" : "/api"}${url}`, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  }
  return { get: (u) => call("GET", u), post: (u, b) => call("POST", u, b ?? {}), put: (u, b) => call("PUT", u, b) };
}
async function login(base, creds) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds) });
  return client(base, res.headers.get("set-cookie")?.split(";")[0] ?? null);
}

let s;
try {
  // 1. real importer, synthetic manifest, disposable DB (marker table = declared disposable)
  const prisma = new PrismaClient({ datasourceUrl: `file:${dbFile}` });
  const orderBefore = (await prisma.publication.findMany({ where: { visibility: "PUBLIC" }, orderBy: [{ year: "desc" }, { createdAt: "desc" }, { id: "asc" }], select: { id: true } })).map((r) => r.id);
  await prisma.$executeRawUnsafe("CREATE TABLE IF NOT EXISTS _disposable_import_target (note TEXT)");
  await prisma.$disconnect();
  const imp = spawnSync(process.execPath, [TSX, path.join(SERVER_ROOT, "scripts", "publication-source-import.ts"), "--manifest", manifestFile, "--db", dbFile, "--i-confirm-disposable-local-database", "--apply"], { cwd: SERVER_ROOT, env: clean, encoding: "utf8" });
  t("importer ran against the disposable copy", imp.status === 0 && /Applied in one transaction/.test(imp.stdout), (imp.stdout + imp.stderr).slice(-300));

  const db = new PrismaClient({ datasourceUrl: `file:${dbFile}` });
  const rows = await db.publication.findMany({ where: { title: { startsWith: "ZZ VISIBILITY" } }, select: { id: true, title: true, visibility: true, sourceOrder: true } });
  const byTitle = Object.fromEntries(rows.map((r) => [r.title, r]));
  t("status 出版 -> PUBLIC; 投稿中, 受理 and BLANK -> LAB_ONLY", byTitle[T.pub].visibility === "PUBLIC" && byTitle[T.sub].visibility === "LAB_ONLY" && byTitle[T.acc].visibility === "LAB_ONLY" && byTitle[T.blank].visibility === "LAB_ONLY", JSON.stringify(rows));
  await db.$disconnect();
  const hidden = [T.sub, T.acc, T.blank].map((x) => byTitle[x]);
  const hiddenIds = hidden.map((h) => h.id);
  const leaks = (text) => [...hidden.map((h) => h.title), ...hiddenIds, ...[DOI.sub, DOI.acc, DOI.blank]].filter((needle) => text.includes(needle));

  s = await startServer();
  const guest = client(s.base);
  const admin = await login(s.base, ADMIN);
  const mkAcct = async (email, role, name) => { const r = await admin.post("/users", { email, password: PW, role, name, initials: "VX", memberRole: "Researcher", category: "PHD" }); if (r.status !== 201) throw new Error(`${email}: ${r.status} ${r.text}`); return login(s.base, { email, password: PW }); };
  const member = await mkAcct("vis-member@example.test", "MEMBER", "ZZ Vis Member");
  const manager = await mkAcct("vis-mgr@example.test", "LAB_MANAGER", "ZZ Vis Manager");
  const memberId = (await member.get("/profile")).json.id;

  // 2. link the LAB_ONLY records to everything a publication can hang off (all PUBLIC containers)
  const proj = (await admin.post("/projects", { title: "ZZ Vis Project", summary: "s", visibility: "PUBLIC" })).json;
  const grp = (await admin.post("/groups", { name: "ZZ Vis Group", description: "d", visibility: "PUBLIC" })).json;
  const area = (await admin.post("/research", { title: "ZZ Vis Area", description: "d", tag: "T", visibility: "PUBLIC" })).json;
  await admin.put(`/projects/${proj.id}`, { groupId: grp.id });
  await admin.put(`/projects/${proj.id}/areas`, { areaIds: [area.id] });
  const all = [byTitle[T.pub].id, ...hiddenIds];
  t("setup: project linked to all 4 publications", (await admin.put(`/projects/${proj.id}/publications`, { publicationIds: all })).status === 200);
  for (const id of all) await admin.put(`/publications/${id}/authors`, { teamMemberIds: [memberId] });
  const res = (await admin.post("/resources", { name: "ZZ Vis Resource", visibility: "PUBLIC", publicationId: hiddenIds[0] })).json;
  t("setup: a PUBLIC resource points at a LAB_ONLY publication", !!res?.id);

  // 3. probes
  const q = encodeURIComponent("ZZ VISIBILITY");
  const probes = [
    ["GET /publications", () => "/publications"],
    ["GET /publications/browse (q)", () => `/publications/browse?q=${q}&limit=50`],
    ["GET /publications/browse (all)", () => `/publications/browse?limit=50`],
    ["GET /publications/browse?year=2031", () => `/publications/browse?year=2031&limit=50`],
    ["GET /publications/browse?researcher=", () => `/publications/browse?researcher=${memberId}&limit=50`],
    ["GET /publications/browse?project=", () => `/publications/browse?project=${proj.id}&limit=50`],
    ["GET /publications/browse?area=", () => `/publications/browse?area=${area.id}&limit=50`],
    ["GET /publications/browse?group=", () => `/publications/browse?group=${grp.id}&limit=50`],
    ["GET /publications/browse sort=oldest", () => `/publications/browse?sort=oldest&limit=50`],
    ["GET /publications/browse sort=title", () => `/publications/browse?sort=title&limit=50`],
    ["GET /publications/:id (each hidden)", () => hiddenIds.map((i) => `/publications/${i}`)],
    ["GET /publications/:id/authors (each hidden)", () => hiddenIds.map((i) => `/publications/${i}/authors`)],
    ["GET /search?q=", () => `/search?q=${q}&limit=50`],
    ["GET /search?type=publication", () => `/search?q=${q}&type=publication&limit=50`],
    ["GET /search by DOI", () => `/search?q=${encodeURIComponent("zzvis")}&limit=50`],
    ["GET /search by venue", () => `/search?q=${encodeURIComponent("ZZ Vis Venue")}&limit=50`],
    ["GET /member/:id (profile page)", () => `/member/${memberId}`],
    ["GET /projects/:id", () => `/projects/${proj.id}`],
    ["GET /groups/:id", () => `/groups/${grp.id}`],
    ["GET /research/:id", () => `/research/${area.id}`],
    ["GET /resources/:id (linked publication)", () => `/resources/${res.id}`],
    ["GET /resources (list)", () => `/resources`],
    ["GET /workspace", () => `/workspace`],
    ["GET /sitemap.xml", () => `/sitemap.xml`],
  ];
  const seen = {};
  for (const [label, urls] of probes) {
    const list = [].concat(urls());
    for (const [vname, c] of Object.entries({ guest, member, manager })) {
      let text = "";
      let statuses = [];
      for (const u of list) { const r = await c.get(u); text += r.text; statuses.push(r.status); }
      seen[`${label}|${vname}`] = { leaks: leaks(text), statuses, visible: text.includes(T.pub) || text.includes(byTitle[T.pub].id) };
    }
  }
  for (const [label] of probes) {
    t(`guest: no LAB_ONLY record via ${label}`, seen[`${label}|guest`].leaks.length === 0, JSON.stringify(seen[`${label}|guest`].leaks));
  }
  // LAB_ONLY is visible to any signed-in member by the existing rule (visibility is LAB-wide) — pinned so a change is deliberate
  for (const label of ["GET /publications", "GET /publications/browse (all)", "GET /search?type=publication"]) {
    t(`member (signed in): sees LAB_ONLY records via ${label} (documented LAB_ONLY rule)`, seen[`${label}|member`].leaks.length > 0, label);
    t(`manager: sees LAB_ONLY records via ${label} (non-vacuity)`, seen[`${label}|manager`].leaks.length > 0, label);
  }
  t("guest: direct GET of each LAB_ONLY publication is 404 (same as a missing id)", seen["GET /publications/:id (each hidden)|guest"].statuses.every((x) => x === 404) && (await guest.get("/publications/doesnotexist1234")).status === 404);
  t("guest: authors endpoint of a LAB_ONLY publication is 404", seen["GET /publications/:id/authors (each hidden)|guest"].statuses.every((x) => x === 404));
  t("guest: the PUBLIC (出版) record IS listed, searchable and in the sitemap-free listing (non-vacuity)", seen["GET /publications|guest"].visible && seen["GET /publications/browse (q)|guest"].visible && seen["GET /search?type=publication|guest"].visible);
  const gb0 = (await guest.get(`/publications/browse?limit=50`)).json;
  const gb = (await guest.get(`/publications/browse?q=${q}&limit=50`)).json;
  t("guest: the browse total counts only the PUBLIC record (no count leak)", gb.total === 1 && gb.items.length === 1, String(gb.total));
  t("guest: the year filter never offers a year that exists only through a LAB_ONLY record (2032), but does offer 2031", !gb0.years.includes(2032) && gb0.years.includes(2031), JSON.stringify(gb0.years));
  t("manager: the year filter offers 2032 (non-vacuity)", (await manager.get(`/publications/browse?limit=50`)).json.years.includes(2032));
  const gProj = (await guest.get(`/projects/${proj.id}`)).json, gArea = (await guest.get(`/research/${area.id}`)).json, gGrp = (await guest.get(`/groups/${grp.id}`)).json, gMem = (await guest.get(`/member/${memberId}`)).json;
  t("guest: project, area, group and profile show exactly the 1 PUBLIC publication", [gProj.publications, gArea.publications, gGrp.publications, gMem.publications].every((l) => Array.isArray(l) && l.filter((p) => p.title.startsWith("ZZ VISIBILITY")).length === 1), JSON.stringify([gProj.publications?.length, gArea.publications?.length, gGrp.publications?.length, gMem.publications?.length]));
  t("guest: a resource's linked LAB_ONLY publication is not named", !JSON.stringify((await guest.get(`/resources/${res.id}`)).json).includes(T.sub));
  t("manager: project page lists all 4 (non-vacuity)", (await manager.get(`/projects/${proj.id}`)).json.publications.filter((p) => p.title.startsWith("ZZ VISIBILITY")).length === 4);
  // writes remain gated
  t("guest cannot change visibility or create", (await guest.put(`/publications/${hiddenIds[0]}`, { visibility: "PUBLIC" })).status === 401);
  t("an ordinary member cannot publish a LAB_ONLY record", (await member.put(`/publications/${hiddenIds[0]}`, { visibility: "PUBLIC" })).status === 403);
  t("(after the attempts) the record is still hidden from guests", (await guest.get(`/publications/${hiddenIds[0]}`)).status === 404);
  // sourceOrder never reorders existing publications
  const baseline = (await guest.get("/publications")).json.filter((p) => !p.title.startsWith("ZZ VISIBILITY")).map((p) => p.id);
  t("existing publications keep exactly their relative public order after the import", baseline.join() === orderBefore.join() && baseline.length >= 4, `${baseline.length} vs ${orderBefore.length}`);
} catch (err) {
  failures.push(`crashed: ${err.stack ?? err}`);
} finally {
  s?.stop();
  rmSync(work, { recursive: true, force: true });
}
console.log(`\n${ok} publication-visibility checks passed, ${failures.length} failed.`);
if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
