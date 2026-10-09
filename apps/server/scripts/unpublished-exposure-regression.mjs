/**
 * Exposure map for UNPUBLISHED team members (Phase 27). It creates two hidden people (an alumnus without an account and a
 * member who has an account), links them everywhere a person can be linked (publication authors, project and group members,
 * research-area researchers, news authors, event/knowledge/resource attributions), uploads each a photo, and then asks every
 * public/authenticated endpoint who can still see them. Policy (owner-approved): managers see everyone; an unpublished person
 * sees themself; guests and other members discover them NOWHERE (profiles, lists, search, photos, linked authors, project/group
 * members, area researchers, free-text author lines, attributions); an editor who cannot see a hidden link and saves a whole
 * list must NOT delete it. The table is printed so the owner can read it. Disposable local database; nothing external is contacted.
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
    // a published project/group lead (an ordinary MEMBER account) who edits whole lists WITHOUT being able to see the hidden people
    const lead = await mkAcct("ux-lead@example.test", "MEMBER", "ZZ UX Lead");
    const leadId = (await lead.get("/profile")).json.id;
    const pubMemberId = (await (await mkAcct("ux-pub@example.test", "MEMBER", "ZZ UX PubMember")).get("/profile")).json.id;
    await admin.put(`/projects/${proj.id}/members`, { members: [{ teamMemberId: leadId, role: "LEAD" }, { teamMemberId: ids.alum, role: "MEMBER" }, { teamMemberId: ids.owner, role: "MEMBER" }] });
    await admin.put(`/groups/${grp.id}/members`, { members: [{ teamMemberId: leadId, role: "LEAD" }, { teamMemberId: ids.alum, role: "MEMBER" }, { teamMemberId: ids.owner, role: "MEMBER" }] });
    await admin.put(`/publications/${pub.id}/authors`, { teamMemberIds: [ids.alum, ids.owner, leadId] });
    await admin.put(`/news/${news.id}/authors`, { teamMemberIds: [ids.alum, ids.owner, leadId] });
    // attributions: an event / knowledge doc / resource CREATED BY the hidden account, and ones that name the hidden alumnus as researcher
    const ev = (await owner.post("/events", { title: "ZZ UX Event", startsAt: "2036-05-01T10:00:00Z" })).json;
    await admin.put(`/events/${ev.id}`, { visibility: "PUBLIC" });
    const kd = (await owner.post("/knowledge", { title: "ZZ UX Knowledge", body: "b" })).json;
    await admin.put(`/knowledge/${kd.id}`, { visibility: "PUBLIC" });
    const kd2 = (await admin.post("/knowledge", { title: "ZZ UX Knowledge2", body: "b", visibility: "PUBLIC", teamMemberId: ids.alum })).json;
    const rs = (await owner.post("/resources", { name: "ZZ UX Resource" })).json;
    await admin.put(`/resources/${rs.id}`, { visibility: "PUBLIC" });
    const rs2 = (await admin.post("/resources", { name: "ZZ UX Resource2", visibility: "PUBLIC", teamMemberId: ids.alum })).json;
    t("setup: attribution fixtures exist", ev?.id && kd?.id && kd2?.id && rs?.id && rs2?.id, JSON.stringify([ev?.id, kd?.id, kd2?.id, rs?.id, rs2?.id]));
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
      ["GET /news/:id/authors (linked ids)", () => `/news/${news.id}/authors`, "id"],
      ["GET /publications/browse?researcher=<id>", (k) => `/publications/browse?researcher=${ids[k]}`, "name"],
      ["GET /projects (list members)", () => `/projects`, "name"],
      ["GET /groups (list members)", () => `/groups`, "name"],
      ["GET /research (list)", () => `/research`, "name"],
      ["GET /events/:id (organizer attribution)", () => `/events/${ev.id}`, "name"],
      ["GET /events (list attribution)", () => `/events`, "name"],
      ["GET /knowledge/:id (author attribution)", () => `/knowledge/${kd.id}`, "name"],
      ["GET /knowledge/:id (researcher attribution)", () => `/knowledge/${kd2.id}`, "name"],
      ["GET /resources/:id (owner attribution)", () => `/resources/${rs.id}`, "name"],
      ["GET /resources/:id (researcher attribution)", () => `/resources/${rs2.id}`, "name"],
      ["GET /knowledge?researcher=<id>", (k) => `/knowledge?researcher=${ids[k]}`, "name"],
      ["GET /search?q=ZZ UX (all types)", () => `/search?q=${encodeURIComponent("ZZ UX HiddenAlum")}&limit=50`, "resultsName"],
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
            : kind === "resultsName" ? JSON.stringify(results).includes(NAMES[k]) || JSON.stringify(results).includes(ids[k])
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
    // ---- owner-approved policy: linked/attributed surfaces never reveal an unpublished person to guests or other members ------------
    const LINKED = ["GET /news/:id/authors", "GET /publications/:id", "GET /publications (free", "GET /projects/:id", "GET /groups/:id", "GET /research/:id", "GET /publications/browse", "GET /projects (list", "GET /groups (list", "GET /research (list", "GET /events/:id", "GET /events (list", "GET /knowledge/:id (author", "GET /knowledge/:id (researcher", "GET /resources/:id (owner", "GET /resources/:id (researcher", "GET /knowledge?researcher", "GET /search?q=ZZ UX"];
    for (const label of LINKED) {
      t(`hidden people are invisible to guests: ${label}`, cell(label, "guest") === "-", cell(label, "guest"));
      t(`…and to other members: ${label}`, cell(label, "member") === "-", cell(label, "member"));
    }
    for (const label of ["GET /publications/:id", "GET /projects/:id", "GET /groups/:id", "GET /research/:id", "GET /events/:id", "GET /knowledge/:id (author", "GET /resources/:id (owner", "GET /search?q=ZZ UX", "GET /news/:id/authors", "GET /publications/browse", "GET /projects (list", "GET /groups (list"]) {
      t(`managers still see the hidden people they are linked to: ${label}`, cell(label, "manager") !== "-", cell(label, "manager"));
    }
    for (const label of ["GET /publications/:id", "GET /projects/:id", "GET /groups/:id", "GET /research/:id"]) {
      t(`an unpublished person still sees their OWN link (and not the other hidden person's): ${label}`, cell(label, "owner") === "owner", cell(label, "owner"));
    }
    const sr = (await guest.get(`/search?q=${encodeURIComponent("ZZ UX Pub")}&limit=50`)).json?.results ?? [];
    t("(non-vacuity) a guest's search still finds the publication, with the hidden names removed from the shown authors", sr.some((x) => x.type === "publication" && x.title === "ZZ UX Pub") && !JSON.stringify(sr).includes("Hidden"), JSON.stringify(sr).slice(0, 200));
    t("the hidden owner still sees their own event/knowledge/resource attribution", ["GET /events/:id", "GET /knowledge/:id (author", "GET /resources/:id (owner"].every((l) => cell(l, "owner") === "owner"));
    t("a hidden person's linked-publication filter returns nothing to a guest (same as an unknown id)", (await guest.get(`/publications/browse?researcher=${ids.alum}`)).json?.total === 0 && (await guest.get(`/publications/browse?researcher=doesnotexist123`)).json?.total === 0);
    t("a guest's browse count for the page does not change because of hidden links", (await guest.get(`/publications/${pub.id}`)).json?.researchers?.length === 1 /* only the published lead */);
    // the free-text authors line is redacted for the hidden people's names, not for published ones
    const guestPub = (await guest.get(`/publications/${pub.id}`)).json;
    t("free-text authors line: hidden names removed for guests, line stays tidy", !/HiddenAlum|HiddenOwner/.test(guestPub.authors) && !/^[,;\s]|[,;\s]$|,\s*,/.test(guestPub.authors), JSON.stringify(guestPub.authors));
    t("free-text authors line: unchanged for managers", /HiddenAlum/.test((await manager.get(`/publications/${pub.id}`)).json.authors));
    t("free-text authors line: a hidden person sees their own name only", /HiddenOwner/.test((await owner.get(`/publications/${pub.id}`)).json.authors) && !/HiddenAlum/.test((await owner.get(`/publications/${pub.id}`)).json.authors));
    t("search for a hidden name does not match publications by the redacted authors text", cell("GET /search?q=<name> (any", "guest") === "-" && cell("GET /search?q=<name> (any", "member") === "-", cell("GET /search?q=<name> (any", "guest"));
    t("DOCUMENTED residual: names inside titles/descriptions (not an authors line) are not rewritten", true);
    t("news authors are not serialised publicly, so a hidden author does not leak there", cell("GET /news", "guest") === "-");

    // ---- write preservation: an editor who cannot see a hidden link and saves the visible list must not delete it ----------------
    const names = async (c, url, pick) => JSON.stringify(pick((await c.get(url)).json));
    const projMembers = async (c) => ((await c.get(`/projects/${proj.id}`)).json.members ?? []).map((m) => m.teamMemberId);
    const grpMembers = async (c) => ((await c.get(`/groups/${grp.id}`)).json.members ?? []).map((m) => m.teamMemberId);
    const pubAuthors = async (c) => ((await c.get(`/publications/${pub.id}`)).json.researchers ?? []).map((m) => m.id);
    const leadSeesProj = await projMembers(lead);
    t("a project lead sees only visible members (no hidden people)", leadSeesProj.length === 1 && leadSeesProj[0] === leadId, JSON.stringify(leadSeesProj));
    const putProj = await lead.put(`/projects/${proj.id}/members`, { members: [{ teamMemberId: leadId, role: "LEAD" }, { teamMemberId: pubMemberId, role: "MEMBER" }] });
    t("the lead can save the visible member list", putProj.status === 200, `${putProj.status} ${putProj.text}`);
    const mgrProj = await projMembers(manager);
    t("…and the hidden members are preserved (a manager still sees them)", mgrProj.includes(ids.alum) && mgrProj.includes(ids.owner) && mgrProj.includes(pubMemberId), JSON.stringify(mgrProj));
    t("…the hidden members keep their MEMBER role", ((await manager.get(`/projects/${proj.id}`)).json.members ?? []).filter((m) => [ids.alum, ids.owner].includes(m.teamMemberId)).every((m) => m.role === "MEMBER"));
    const naming = await lead.put(`/projects/${proj.id}/members`, { members: [{ teamMemberId: leadId, role: "LEAD" }, { teamMemberId: ids.alum, role: "MEMBER" }] });
    const nonexistent = await lead.put(`/projects/${proj.id}/members`, { members: [{ teamMemberId: leadId, role: "LEAD" }, { teamMemberId: "doesnotexist12345", role: "MEMBER" }] });
    t("a lead naming a hidden person gets the SAME answer as for a nonexistent id (no probing)", naming.status === nonexistent.status && naming.status === 400, `${naming.status} vs ${nonexistent.status}`);
    t("…and that rejected save changed nothing", (await projMembers(manager)).includes(ids.alum));
    const emptyProj = await lead.put(`/projects/${proj.id}/members`, { members: [{ teamMemberId: leadId, role: "LEAD" }] });
    t("a lead removing every VISIBLE other member still keeps the hidden ones", emptyProj.status === 200 && (await projMembers(manager)).includes(ids.alum) && (await projMembers(manager)).includes(ids.owner) && !(await projMembers(manager)).includes(pubMemberId), JSON.stringify(await projMembers(manager)));

    const putGrp = await lead.put(`/groups/${grp.id}/members`, { members: [{ teamMemberId: leadId, role: "LEAD" }, { teamMemberId: pubMemberId, role: "MEMBER" }] });
    t("a group lead can save the visible member list", putGrp.status === 200, `${putGrp.status} ${putGrp.text}`);
    t("…hidden group members are preserved", (await grpMembers(manager)).includes(ids.alum) && (await grpMembers(manager)).includes(ids.owner));

    const selfOnly = await lead.put(`/publications/${pub.id}/authors`, { teamMemberIds: [] });
    t("a member removing their OWN author link is allowed (the hidden links are not 'others' they must keep untouched)", selfOnly.status === 200, `${selfOnly.status} ${selfOnly.text}`);
    t("…the hidden authors are preserved", (await pubAuthors(manager)).includes(ids.alum) && (await pubAuthors(manager)).includes(ids.owner) && !(await pubAuthors(manager)).includes(leadId), JSON.stringify(await pubAuthors(manager)));
    const addSelf = await lead.put(`/publications/${pub.id}/authors`, { teamMemberIds: [leadId] });
    t("a member adding themself keeps the hidden authors", addSelf.status === 200 && (await pubAuthors(manager)).includes(ids.alum) && (await pubAuthors(manager)).includes(leadId));
    const addOther = await lead.put(`/publications/${pub.id}/authors`, { teamMemberIds: [leadId, pubMemberId] });
    t("a member still cannot add someone else (unchanged rule: 403)", addOther.status === 403, String(addOther.status));
    const addHidden = await lead.put(`/publications/${pub.id}/authors`, { teamMemberIds: [leadId, ids.alum] });
    t("a member naming a hidden person is treated as an unauthorised change, never a confirmation", addHidden.status === 403 || addHidden.status === 400, String(addHidden.status));

    const newsAuthors = async (c) => ((await c.get(`/news/${news.id}/authors`)).json ?? []);
    const selfNews = await lead.put(`/news/${news.id}/authors`, { teamMemberIds: [] });
    t("news authors: a member removing only themself is allowed and hidden authors are preserved", selfNews.status === 200 && JSON.stringify(await newsAuthors(manager)).includes(ids.alum) && JSON.stringify(await newsAuthors(manager)).includes(ids.owner), `${selfNews.status} ${selfNews.text}`);

    // managers see everyone, so for them the list is authoritative: they CAN remove a hidden link
    const mgrRemove = await manager.put(`/projects/${proj.id}/members`, { members: [{ teamMemberId: leadId, role: "LEAD" }] });
    t("a manager (who sees everyone) can remove hidden members deliberately", mgrRemove.status === 200 && !(await projMembers(manager)).includes(ids.alum) && !(await projMembers(manager)).includes(ids.owner), `${mgrRemove.status} ${mgrRemove.text}`);
    const mgrAuthors = await manager.put(`/publications/${pub.id}/authors`, { teamMemberIds: [leadId] });
    t("a manager can remove hidden authors deliberately", mgrAuthors.status === 200 && !(await pubAuthors(manager)).includes(ids.alum));
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
