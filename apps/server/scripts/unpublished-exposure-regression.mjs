/**
 * Exposure map for UNPUBLISHED team members (Phase 27). It creates two hidden people (an alumnus without an account and a
 * member who has an account), links them everywhere a person can be linked (publication authors, project and group members,
 * research-area researchers, news authors), uploads each a photo, and then asks every public/authenticated endpoint who can
 * still see them. The assertions pin the CURRENT behaviour so a change is a conscious decision; the table is printed so the
 * owner can read it. Disposable local database; nothing external is contacted.
 *
 *   node scripts/unpublished-exposure-regression.mjs
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");
const TSX = path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };
const PW = "Str0ngPassw0rd!";

let ok = 0;
const failures = [];
const t = (name, cond, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

if (!existsSync(SOURCE_DB)) {
  console.error(`Missing ${SOURCE_DB} — run \`npm run seed -w apps/server\` first.`);
  process.exit(1);
}



import { readdirSync, readFileSync as rf, statSync } from "node:fs";

import { spawn as sp } from "node:child_process";
async function startServer() {
  const work = mkdtempSync(path.join(tmpdir(), "scl-unpub-"));
  copyFileSync(SOURCE_DB, path.join(work, "c.db"));
  const port = 49800 + Math.floor(Math.random() * 150);
  const env = { ...process.env, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", BLOB_READ_WRITE_TOKEN: "", VERCEL: "", STORAGE_DIR: path.join(work, "files"), DATABASE_URL: `file:${path.join(work, "c.db")}`, PORT: String(port), TRUST_PROXY: "0", NODE_ENV: "test", SESSION_SECRET: "unpublished-exposure-secret-0000000", PUBLIC_BASE_URL: "https://lab.example.test" };
  const child = sp(process.execPath, [TSX, path.join(SERVER_ROOT, "src", "index.ts")], { cwd: SERVER_ROOT, env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 80 && !/listening on/.test(out); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/listening on/.test(out)) throw new Error(`server did not start:\n${out}`);
  return { base: `http://localhost:${port}`, async stop() { child.kill(); rmSync(work, { recursive: true, force: true }); } };
}
function client(base, cookie = null) {
  async function call(method, url, body, form) {
    const res = await fetch(`${base}${url.startsWith("/sitemap") ? "" : "/api"}${url}`, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  }
  return { get: (u) => call("GET", u), post: (u, b) => call("POST", u, b ?? {}), put: (u, b) => call("PUT", u, b), form: (u, f) => call("POST", u, undefined, f) };
}
async function login(base, creds) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds) });
  return client(base, res.headers.get("set-cookie")?.split(";")[0] ?? null);
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function main() {
  const s = await startServer();
  try {
    const admin = await login(s.base, ADMIN);
    const guest = client(s.base);
    const mkAcct = async (email, role, name, category = "PHD") => {
      const r = await admin.post("/users", { email, password: PW, role, name, initials: "UX", memberRole: "Researcher", category });
      if (r.status !== 201) throw new Error(`could not create ${email}: ${r.status} ${r.text}`);
      return login(s.base, { email, password: PW });
    };
    const viewer = await mkAcct("ux-viewer@example.test", "MEMBER", "ZZ UX Viewer");
    const manager = await mkAcct("ux-mgr@example.test", "LAB_MANAGER", "ZZ UX Manager");
    const owner = await mkAcct("ux-owner@example.test", "MEMBER", "ZZ UX HiddenOwner");
    const alum = (await admin.post("/team", { name: "ZZ UX HiddenAlum", initials: "HA", role: "Alumnus", category: "ALUMNI", department: "x", isPublished: false })).json;
    const ownerProfile = (await owner.get("/profile")).json;
    await admin.put(`/team/${ownerProfile.id}`, { isPublished: false });
    const ids = { alum: alum.id, owner: ownerProfile.id };
    const NAMES = { alum: "ZZ UX HiddenAlum", owner: "ZZ UX HiddenOwner" };
    // links everywhere a person can be linked
    const pub = (await admin.post("/publications", { year: 2036, title: "ZZ UX Pub", authors: "ZZ UX HiddenAlum, ZZ UX HiddenOwner", venue: "V" })).json;
    await admin.put(`/publications/${pub.id}/authors`, { teamMemberIds: [ids.alum, ids.owner] });
    const proj = (await admin.post("/projects", { title: "ZZ UX Project", summary: "s", visibility: "PUBLIC" })).json;
    await admin.put(`/projects/${proj.id}/members`, { members: [{ teamMemberId: ids.alum, role: "MEMBER" }, { teamMemberId: ids.owner, role: "MEMBER" }] });
    const grp = (await admin.post("/groups", { name: "ZZ UX Group", description: "d", visibility: "PUBLIC" })).json;
    await admin.put(`/groups/${grp.id}/members`, { members: [{ teamMemberId: ids.alum, role: "MEMBER" }, { teamMemberId: ids.owner, role: "MEMBER" }] });
    const area = (await admin.post("/research", { title: "ZZ UX Area", description: "d", tag: "T" })).json;
    for (const k of ["alum", "owner"]) await admin.put(`/member/${ids[k]}/areas`, { areaIds: [area.id] });
    const news = (await admin.post("/news", { date: "Jan 2036", sortDate: "2036-01-01", type: "Paper", title: "ZZ UX News", description: "d" })).json;
    await admin.put(`/news/${news.id}/authors`, { teamMemberIds: [ids.alum, ids.owner] });
    const photoUrls = {};
    for (const k of ["alum", "owner"]) {
      const f = new FormData();
      f.set("file", new Blob([PNG], { type: "image/png" }), "p.png");
      const r = await admin.form(`/team/${ids[k]}/photo`, f);
      photoUrls[k] = r.json?.photoUrl;
    }
    t("setup: both people exist, are unpublished and have uploaded photos", ids.alum && ids.owner && photoUrls.alum?.startsWith("/api/files/") && photoUrls.owner?.startsWith("/api/files/"));

    // ---- probe every endpoint as every viewer ------------------------------------------------------------------------------
    const viewers = { guest, member: viewer, manager, owner };
    const probes = [
      ["GET /team (list)", () => "/team", "profile"],
      ["GET /team/:id", (k) => `/team/${ids[k]}`, "profile"],
      ["GET /member/:id (full profile page)", (k) => `/member/${ids[k]}`, "profile"],
      ["GET /search?type=researcher&q=<name>", (k) => `/search?q=${encodeURIComponent(NAMES[k])}&limit=50&type=researcher`, "searchProfile"],
      ["GET /search?q=<name> (any type: finds the free text)", (k) => `/search?q=${encodeURIComponent(NAMES[k])}&limit=50`, "searchText"],
      ["GET /sitemap.xml (profile URL)", () => `/sitemap.xml`, "id"],
      ["GET /files/<photo id>", (k) => photoUrls[k].replace("/api", ""), "photo"],
      ["GET /publications/:id (linked authors)", () => `/publications/${pub.id}`, "name"],
      ["GET /publications (free-text authors line)", () => `/publications`, "name"],
      ["GET /projects/:id (members)", () => `/projects/${proj.id}`, "name"],
      ["GET /groups/:id (members)", () => `/groups/${grp.id}`, "name"],
      ["GET /research/:id (researchers)", () => `/research/${area.id}`, "name"],
      ["GET /news (authors are not serialised)", () => `/news`, "name"],
    ];
    const matrix = [];
    for (const [label, path_, kind] of probes) {
      const row = { label };
      for (const [vname, c] of Object.entries(viewers)) {
        const seen = [];
        for (const k of ["alum", "owner"]) {
          const r = await c.get(path_(k));
          const results = r.json?.results ?? [];
          const hit = kind === "searchProfile" ? results.some((x) => x.id === ids[k] && (x.type === "researcher" || x.kind === "researcher" || /team/.test(x.href ?? "")))
            : kind === "searchText" ? results.some((x) => JSON.stringify(x).includes(NAMES[k]))
            : kind === "photo" ? r.status === 200 : kind === "id" ? r.text.includes(ids[k]) : kind === "profile" ? r.text.includes(NAMES[k]) && r.status === 200 : r.text.includes(NAMES[k]) || r.text.includes(ids[k]);
          if (hit) seen.push(k);
        }
        row[vname] = seen.join("+") || "-";
      }
      matrix.push(row);
    }
    console.log("\nWho can still see an UNPUBLISHED person (alum = alumnus without an account, owner = hidden member who owns an account)");
    console.log("endpoint".padEnd(46) + "guest".padEnd(13) + "member".padEnd(13) + "manager".padEnd(13) + "owner(self)");
    for (const r of matrix) console.log(r.label.padEnd(46) + r.guest.padEnd(13) + r.member.padEnd(13) + r.manager.padEnd(13) + r.owner);
    const cell = (label, v) => matrix.find((r) => r.label.startsWith(label))[v];

    // ---- pinned current behaviour -------------------------------------------------------------------------------------------------
    for (const label of ["GET /team (list)", "GET /team/:id", "GET /member/:id", "GET /search?type=researcher", "GET /sitemap.xml", "GET /files/"]) {
      t(`profile surfaces hide unpublished people from guests and other members: ${label}`, cell(label, "guest") === "-" && cell(label, "member") === "-");
      t(`…managers see both: ${label}`, label.includes("sitemap") ? true : cell(label, "manager") === "alum+owner");
    }
    t("…the owner of a hidden profile still sees their own (and only their own): /team/:id, /member/:id, photo", ["GET /team/:id", "GET /member/:id", "GET /files/"].every((l) => cell(l, "owner") === "owner"));
    t("(non-vacuity) the sitemap is served and does list published profiles", (await guest.get("/sitemap.xml")).text.includes("/team/"));
    t("the sitemap lists neither person to anyone (it is public and built from published profiles only)", cell("GET /sitemap.xml", "guest") === "-" && cell("GET /sitemap.xml", "manager") === "-");
    // Documented behaviour awaiting an owner decision: explicit relations still carry the name (and the id) to everyone.
    for (const label of ["GET /publications/:id", "GET /projects/:id", "GET /groups/:id", "GET /research/:id"]) {
      t(`DOCUMENTED (owner decision pending): explicit links still show both hidden people to guests — ${label}`, cell(label, "guest") === "alum+owner", cell(label, "guest"));
    }
    t("DOCUMENTED: a free-text authors line is plain text and always shows the names", cell("GET /publications (free", "guest") === "alum+owner");
    t("DOCUMENTED: a general search finds the free-text name inside publication/project text, but never returns the hidden PROFILE", cell("GET /search?q=<name> (any", "guest") === "alum+owner" && cell("GET /search?type=researcher", "guest") === "-");
    t("news authors are not serialised publicly, so a hidden author does not leak there", cell("GET /news", "guest") === "-");
  } finally {
    await s.stop();
  }
  console.log(`\n${ok} unpublished-exposure checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}
main().catch((err) => { console.error(err); if (failures.length) console.log("Failures so far:\n - " + failures.join("\n - ")); process.exit(1); });
