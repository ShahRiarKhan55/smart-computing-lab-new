/**
 * Regression check for the Phase 3B alumni directory and team-profile publication consent.
 *
 *  - ALUMNI is admin-only to create, edit, move into/out of, and see while unpublished; it is created UNPUBLISHED.
 *  - Publishing is an explicit admin action (PUT /api/team/:id/publication); no payload field can change it.
 *  - An unpublished profile is invisible to everyone but an administrator on EVERY public surface (team list/detail,
 *    member page, search, sitemap, publication authors, project/group/area members, translations, admin content browser)
 *    and a lab manager's replace-the-set writes never drop the links they cannot see.
 *  - An alumni profile can never get a login (POST /api/users, PUT /api/users/:id/link, invitations create + accept),
 *    and a profile that has one cannot become an alumnus.
 *
 * Self-contained: copies apps/server/prisma/dev.db to a disposable temp file and spawns the real server with
 * TURSO_DATABASE_URL/TURSO_AUTH_TOKEN cleared (so it can never reach a remote database). Requires a migrated, seeded
 * apps/server/prisma/dev.db.   node scripts/alumni-regression.mjs
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };

if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) {
  console.error("Refusing to run: TURSO_* is set in this shell (the script clears it for its own server, but do not run with it set).");
  process.exit(2);
}
let ok = 0;
const failures = [];
const t = (name, cond, detail = "") => { if (cond) ok++; else failures.push(`${name}${detail ? ` -- ${detail}` : ""}`); };

if (!existsSync(SOURCE_DB)) { console.error(`Missing ${SOURCE_DB} — migrate and seed first.`); process.exit(1); }
const workDir = mkdtempSync(path.join(tmpdir(), "scl-alumni-regression-"));
const dbCopy = path.join(workDir, "copy.db");
copyFileSync(SOURCE_DB, dbCopy);

function startServer(port) {
  const child = spawn(process.execPath, [path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs"), path.join(SERVER_ROOT, "src", "index.ts")], {
    cwd: SERVER_ROOT,
    env: { ...process.env, NODE_ENV: "development", TRUST_PROXY: "0", PORT: String(port), DATABASE_URL: `file:${dbCopy}`, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", PUBLIC_BASE_URL: `http://localhost:${port}` },
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`Server did not start in time. Output so far:\n${out}`)), 20000);
    child.stdout.on("data", (d) => { out += d.toString(); if (/listening on/.test(out)) { clearTimeout(timer); resolve(child); } });
    child.stderr.on("data", (d) => { out += d.toString(); });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited early (code ${code}). Output:\n${out}`)); });
  });
}

class Client {
  constructor(base) { this.base = base; this.cookie = ""; }
  async req(method, p, body, raw = false) {
    const res = await fetch(`${this.base}${p}`, { method, headers: { "Content-Type": "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() ?? []) if (c.startsWith("scl.sid=")) this.cookie = c.split(";")[0];
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, json: raw ? null : (() => { try { return JSON.parse(text); } catch { return null; } })() };
  }
  get(p) { return this.req("GET", p); }
  post(p, b) { return this.req("POST", p, b); }
  put(p, b) { return this.req("PUT", p, b); }
  del(p) { return this.req("DELETE", p); }
}
const has = (list, id) => Array.isArray(list) && list.some((x) => x?.id === id);
const mentions = (r, s) => r.text.includes(s);

async function main() {
  const port = 46700 + Math.floor(Math.random() * 200);
  const server = await startServer(port);
  const base = `http://localhost:${port}`;
  const stamp = Date.now().toString(36);
  const N = (s) => `Zq${stamp}${s}`; // unique, searchable names
  try {
    const admin = new Client(base), mgr = new Client(base), member = new Client(base), guest = new Client(base);
    t("admin login", (await admin.post("/api/auth/login", ADMIN)).status === 200);

    // ---- accounts: manager, ordinary member with a (PhD) profile -------------------------------------------------------------
    const mgrEmail = `mgr-${stamp}@example.test`, memEmail = `mem-${stamp}@example.test`;
    t("create manager account", (await admin.post("/api/users", { email: mgrEmail, password: "MgrPass123!", role: "LAB_MANAGER" })).status === 201);
    t("create member account with a PhD profile", (await admin.post("/api/users", { email: memEmail, password: "MemberPass123!", role: "MEMBER", name: N("Member"), initials: "ZM", memberRole: "PhD", category: "PHD" })).status === 201);
    t("manager login", (await mgr.post("/api/auth/login", { email: mgrEmail, password: "MgrPass123!" })).status === 200);
    t("member login", (await member.post("/api/auth/login", { email: memEmail, password: "MemberPass123!" })).status === 200);
    const ownProfile = (await member.get("/api/profile")).json;
    t("member has a linked profile, and the response does not disclose the publication flag", ownProfile?.category === "PHD" && !("isPublished" in ownProfile));

    // ---- creating alumni: admin only, always unpublished ------------------------------------------------------------------------
    const alumniBody = (s, extra = {}) => ({ name: N(s), initials: "ZA", role: "Former PhD student", category: "ALUMNI", department: "Smart", bio: `bio-${N(s)}`, ...extra });
    t("guest cannot create alumni (401)", (await guest.post("/api/team", alumniBody("g"))).status === 401);
    t("member cannot create alumni (403)", (await member.post("/api/team", alumniBody("m"))).status === 403);
    const mgrAlumni = await mgr.post("/api/team", alumniBody("mgr"));
    t("lab manager cannot create alumni (403, admin only)", mgrAlumni.status === 403 && /administrator/i.test(mgrAlumni.json?.error ?? ""));
    t("sending isPublished on create is refused (400)", (await admin.post("/api/team", alumniBody("pub", { isPublished: true }))).status === 400);
    const aRes = await admin.post("/api/team", alumniBody("AlumA"));
    t("admin creates alumni (201)", aRes.status === 201);
    t("a new alumni profile is UNPUBLISHED", aRes.json?.isPublished === false && aRes.json?.category === "ALUMNI");
    const A = aRes.json?.id;
    const bRes = await admin.post("/api/team", alumniBody("AlumB"));
    const B = bRes.json?.id;
    t("second alumni created unpublished", bRes.status === 201 && bRes.json?.isPublished === false);
    const mgrBsc = await mgr.post("/api/team", { name: N("Bsc"), initials: "ZB", role: "BSc student", category: "BSC" });
    t("lab manager still creates ordinary members (201), published, flag not disclosed to them", mgrBsc.status === 201 && !("isPublished" in mgrBsc.json) && (await guest.get("/api/team")).text.includes(mgrBsc.json.id));
    const adminBsc = await admin.post("/api/team", { name: N("AdminBsc"), initials: "ZC", role: "BSc student", category: "BSC" });
    t("admin creates a non-alumni member: published", adminBsc.status === 201 && adminBsc.json?.isPublished === true);
    const X = adminBsc.json?.id; // an unlinked ordinary profile, used below

    // ---- the publish endpoint -----------------------------------------------------------------------------------------------
    t("guest cannot publish (401)", (await guest.put(`/api/team/${A}/publication`, { isPublished: true })).status === 401);
    t("member cannot publish (403)", (await member.put(`/api/team/${A}/publication`, { isPublished: true })).status === 403);
    t("lab manager cannot publish (403)", (await mgr.put(`/api/team/${A}/publication`, { isPublished: true })).status === 403);
    t("publish rejects a non-boolean (400)", (await admin.put(`/api/team/${A}/publication`, { isPublished: "yes" })).status === 400);
    t("publish rejects extra keys (400)", (await admin.put(`/api/team/${A}/publication`, { isPublished: true, category: "FACULTY" })).status === 400);
    t("publish needs the flag (400)", (await admin.put(`/api/team/${A}/publication`, {})).status === 400);
    t("publishing a non-alumni profile is refused (409)", (await admin.put(`/api/team/${X}/publication`, { isPublished: false })).status === 409);
    t("publish of an unknown id is 404", (await admin.put(`/api/team/cjld2cjxh0000qzrmn831i7rn/publication`, { isPublished: true })).status === 404);
    t("none of the failed attempts changed A", (await admin.get(`/api/team/${A}`)).json?.isPublished === false);

    // ---- creating / editing never publishes ----------------------------------------------------------------------------------
    const editA = await admin.put(`/api/team/${A}`, { bio: `edited-${N("AlumA")}`, role: "Alumnus" });
    t("admin edits an unpublished alumni profile (200) and it stays unpublished", editA.status === 200 && editA.json?.isPublished === false);
    t("sending isPublished on update is refused (400)", (await admin.put(`/api/team/${A}`, { isPublished: true })).status === 400);
    t("sending isPublished on own-profile update is refused (400)", (await member.put("/api/profile", { bio: "x", isPublished: false })).status === 400);
    t("still unpublished after the refused writes", (await admin.get(`/api/team/${A}`)).json?.isPublished === false);

    // ---- unpublished: invisible everywhere except to an administrator ---------------------------------------------------------
    for (const [label, c] of [["guest", guest], ["member", member], ["lab manager", mgr]]) {
      const list = await c.get("/api/team");
      t(`${label}: /api/team omits unpublished alumni`, list.status === 200 && !has(list.json, A) && !has(list.json, B) && !mentions(list, N("AlumA")));
      t(`${label}: /api/team still lists ordinary members`, has(list.json, X));
      const inc = await c.get("/api/team?includeAlumni=1");
      t(`${label}: /api/team?includeAlumni=1 (picker) omits unpublished alumni`, inc.status === 200 && !has(inc.json, A) && !has(inc.json, B) && !mentions(inc, N("AlumA")) && has(inc.json, X));
      const al = await c.get("/api/alumni");
      t(`${label}: /api/alumni omits unpublished alumni`, al.status === 200 && Array.isArray(al.json) && !has(al.json, A) && !has(al.json, B) && !mentions(al, N("AlumA")));
      t(`${label}: GET /api/team/:id of unpublished alumni is 404`, (await c.get(`/api/team/${A}`)).status === 404);
      t(`${label}: GET /api/member/:id of unpublished alumni is 404`, (await c.get(`/api/member/${A}`)).status === 404);
      const search = await c.get(`/api/search?q=${encodeURIComponent(N("AlumA"))}`);
      const resultText = JSON.stringify(search.json?.results ?? []);
      t(`${label}: search does not find unpublished alumni (name)`, search.status === 200 && search.json?.pagination?.total === 0 && !resultText.includes(A) && !resultText.includes(N("AlumA")));
      const searchBio = await c.get(`/api/search?q=${encodeURIComponent("edited-" + N("AlumA"))}`);
      t(`${label}: search does not find unpublished alumni (bio)`, searchBio.status === 200 && !mentions(searchBio, A));
      const searchRes = await c.get(`/api/search?q=${encodeURIComponent(N("AlumA"))}&type=researcher`);
      t(`${label}: researcher-filtered search has zero hits`, searchRes.status === 200 && (searchRes.json?.total ?? searchRes.json?.results?.length ?? 0) === 0 && !mentions(searchRes, A));
    }
    t("non-admin responses never carry the publication flag", ![await guest.get("/api/team"), await mgr.get("/api/team"), await member.get("/api/team"), await guest.get("/api/alumni"), await mgr.get("/api/alumni")].some((r) => r.text.includes("isPublished")));
    const adminList = await admin.get("/api/alumni");
    t("admin sees unpublished alumni in /api/alumni with the flag", has(adminList.json, A) && adminList.json.find((m) => m.id === A).isPublished === false);
    t("admin can open the unpublished profile", (await admin.get(`/api/team/${A}`)).status === 200 && (await admin.get(`/api/member/${A}`)).status === 200);
    t("admin search finds the unpublished alumnus (management view)", mentions(await admin.get(`/api/search?q=${encodeURIComponent(N("AlumA"))}`), A));

    // ---- sitemap, translations, admin browser ----------------------------------------------------------------------------------
    const sm = await guest.req("GET", "/sitemap.xml", undefined, true);
    t("sitemap lists published members, not unpublished alumni, and no separate /alumni page", sm.status === 200 && sm.text.includes(`/team/${X}`) && !sm.text.includes(A) && !sm.text.includes(B) && !sm.text.includes("/alumni"));
    t("translations endpoint: member gets 404 for an unpublished profile", (await member.get(`/api/translations/TEAM_MEMBER/${A}`)).status === 404);
    t("translations endpoint: manager gets 404 for an unpublished profile", (await mgr.get(`/api/translations/TEAM_MEMBER/${A}`)).status === 404);
    t("translations endpoint: admin can read it", (await admin.get(`/api/translations/TEAM_MEMBER/${A}`)).status === 200);
    t("translations endpoint: member still reads a published profile", (await member.get(`/api/translations/TEAM_MEMBER/${X}`)).status === 200);
    const browseMgr = await mgr.get(`/api/admin/content?type=team-member&q=${encodeURIComponent(N(""))}`);
    t("admin content browser: manager does not see unpublished alumni", browseMgr.status === 200 && !mentions(browseMgr, A) && mentions(browseMgr, X));
    const browseAdmin = await admin.get(`/api/admin/content?type=team-member&q=${encodeURIComponent(N(""))}`);
    t("admin content browser: admin sees them", mentions(browseAdmin, A) && mentions(browseAdmin, B));
    t("admin content detail: manager gets 404 for an unpublished profile", (await mgr.get(`/api/admin/content/team-member/${A}`)).status === 404);
    const trMgr = await mgr.get(`/api/admin/translations?type=TEAM_MEMBER&q=${encodeURIComponent(N(""))}`);
    t("admin translations list: manager does not see unpublished alumni", trMgr.status === 200 && !mentions(trMgr, A));
    t("admin translations write: manager gets 404 for an unpublished profile", (await mgr.put(`/api/admin/translations/TEAM_MEMBER/${A}`, { field: "bio", value: "x" })).status === 404);
    const ovMgr = await mgr.get("/api/admin/overview");
    const ovAdmin = await admin.get("/api/admin/overview");
    const countOf = (r) => JSON.stringify(r.json).match(/"teamMembers?":\s*(\d+)/)?.[1];
    t("overview: a manager's team count excludes unpublished alumni, an admin's includes them", ovMgr.status === 200 && ovAdmin.status === 200 && (countOf(ovAdmin) === undefined || Number(countOf(ovAdmin)) > Number(countOf(ovMgr))), `${countOf(ovMgr)} vs ${countOf(ovAdmin)}`);

    // ---- related content: publications, projects, groups, research areas -----------------------------------------------
    const pub = await admin.post("/api/publications", { year: 2024, title: `Pub ${N("")}`, authors: "Someone", venue: "V", teamMemberIds: [A, X] });
    t("admin creates a publication linking the unpublished alumnus and a member", pub.status === 201, JSON.stringify(pub.json)?.slice(0, 120));
    const P = pub.json?.id;
    const pubGuest = await guest.get(`/api/publications/${P}`);
    t("publication detail (guest) shows the member but not the unpublished alumnus", pubGuest.status === 200 && JSON.stringify(pubGuest.json.researchers).includes(X) && !pubGuest.text.includes(A) && !pubGuest.text.includes(N("AlumA")));
    t("publication detail (admin) shows both", JSON.stringify((await admin.get(`/api/publications/${P}`)).json.researchers).includes(A));
    const authorsGuest = await guest.get(`/api/publications/${P}/authors`);
    t("GET /publications/:id/authors (guest) lists only published authors", authorsGuest.status === 200 && authorsGuest.json.teamMemberIds.includes(X) && !authorsGuest.json.teamMemberIds.includes(A));
    const pubSearch = await guest.get(`/api/search?q=${encodeURIComponent(N("AlumA"))}&type=publication`);
    t("searching an unpublished author's name does not find the publication", pubSearch.status === 200 && !mentions(pubSearch, P));
    const pubBrowse = await guest.get(`/api/publications/browse?q=${encodeURIComponent(N("AlumA"))}`);
    t("publication browse by an unpublished author's name finds nothing", pubBrowse.status === 200 && !(pubBrowse.json?.items ?? pubBrowse.json?.publications ?? []).some((x) => x.id === P) && !mentions(pubBrowse, `"${P}"`), pubBrowse.text.slice(0, 200));
    const pubBrowseR = await guest.get(`/api/publications/browse?researcher=${A}`);
    t("publication browse filtered by an unpublished researcher id matches nothing", pubBrowseR.status === 200 && !mentions(pubBrowseR, `"${P}"`));
    t("admin browse by that researcher id finds the publication", mentions(await admin.get(`/api/publications/browse?researcher=${A}`), `"${P}"`));
    const pubBrowseOk = await guest.get(`/api/publications/browse?q=${encodeURIComponent(N("AdminBsc"))}`);
    t("publication browse by a PUBLISHED author's name still finds the publication", pubBrowseOk.status === 200 && mentions(pubBrowseOk, `"${P}"`));
    t("manager cannot add an unpublished alumnus as an author (400, looks missing)", (await mgr.put(`/api/publications/${P}/authors`, { teamMemberIds: [A, X] })).status !== 200);
    const mgrSet = await mgr.put(`/api/publications/${P}/authors`, { teamMemberIds: [] });
    t("manager replacing the author set succeeds", mgrSet.status === 200 && !mgrSet.json.teamMemberIds.includes(X) && !mgrSet.json.teamMemberIds.includes(A));
    t("...and did NOT drop the link to the author they cannot see", (await admin.get(`/api/publications/${P}/authors`)).json.teamMemberIds.includes(A));

    const proj = await admin.post("/api/projects", { title: `Proj ${N("")}`, visibility: "PUBLIC" });
    const PR = proj.json?.id;
    t("admin creates a public project", proj.status === 201);
    t("admin sets project members incl. the unpublished alumnus", (await admin.put(`/api/projects/${PR}/members`, { members: [{ teamMemberId: A, role: "MEMBER" }, { teamMemberId: X, role: "MEMBER" }] })).status === 200);
    const projGuest = await guest.get(`/api/projects/${PR}`);
    t("project detail (guest) lists the member but not the alumnus", projGuest.status === 200 && projGuest.text.includes(X) && !projGuest.text.includes(A) && !projGuest.text.includes(N("AlumA")));
    const projList = await guest.get("/api/projects");
    t("project list (guest) does not reveal the alumnus", projList.status === 200 && !mentions(projList, A));
    t("manager cannot add an unpublished alumnus to a project (400)", (await mgr.put(`/api/projects/${PR}/members`, { members: [{ teamMemberId: A, role: "MEMBER" }] })).status === 400);
    t("manager replaces the project's members", (await mgr.put(`/api/projects/${PR}/members`, { members: [] })).status === 200);
    t("...the hidden alumnus link survives", (await admin.get(`/api/projects/${PR}`)).text.includes(A));
    t("single-add of an unpublished alumnus by a manager is refused", (await mgr.post(`/api/projects/${PR}/members`, { teamMemberId: B, role: "MEMBER" })).status === 400);
    t("single-remove of a hidden member by a manager is 404, link untouched", (await mgr.del(`/api/projects/${PR}/members/${A}`)).status === 404 && (await admin.get(`/api/projects/${PR}`)).text.includes(A));

    const grp = await admin.post("/api/groups", { name: `Grp ${N("")}`, visibility: "PUBLIC" });
    const G = grp.json?.id;
    t("admin creates a public group", grp.status === 201);
    t("admin sets group members incl. the alumnus", (await admin.put(`/api/groups/${G}/members`, { members: [{ teamMemberId: A, role: "MEMBER" }, { teamMemberId: X, role: "MEMBER" }] })).status === 200);
    const grpGuest = await guest.get(`/api/groups/${G}`);
    t("group detail (guest) hides the alumnus", grpGuest.status === 200 && grpGuest.text.includes(X) && !grpGuest.text.includes(A));
    t("manager replacing group members keeps the hidden link", (await mgr.put(`/api/groups/${G}/members`, { members: [] })).status === 200 && (await admin.get(`/api/groups/${G}`)).text.includes(A));

    const area = await admin.post("/api/research", { title: `Area ${N("")}`, description: "d", tag: "t" });
    const AR = area.json?.id;
    t("admin creates a research area", area.status === 201);
    t("admin links researchers incl. the alumnus", (await admin.put(`/api/research/${AR}/researchers`, { teamMemberIds: [A, X] })).status === 200);
    const areaGuest = await guest.get(`/api/research/${AR}`);
    t("research area (guest) hides the alumnus", areaGuest.status === 200 && areaGuest.text.includes(X) && !areaGuest.text.includes(A));
    t("manager replacing the researchers keeps the hidden link", (await mgr.put(`/api/research/${AR}/researchers`, { teamMemberIds: [] })).status === 200 && (await admin.get(`/api/research/${AR}`)).text.includes(A));

    // ---- manager/owner write paths on alumni --------------------------------------------------------------------------------------
    t("manager cannot edit an unpublished alumnus (404, looks missing)", (await mgr.put(`/api/team/${A}`, { bio: "x" })).status === 404);
    t("manager cannot add history to an unpublished alumnus (404)", (await mgr.post(`/api/member/${A}/history`, { year: "2020", title: "t" })).status === 404);
    t("member cannot edit someone else's profile (403)", (await member.put(`/api/team/${A}`, { bio: "x" })).status === 403);
    t("manager cannot move an ordinary member into ALUMNI (403)", (await mgr.put(`/api/team/${X}`, { category: "ALUMNI" })).status === 403);

    // ---- enumeration: a hidden profile is indistinguishable from a missing one ---------------------------------------------------------
    {
      const GONE = "cjld2cjxh0000qzrmn831i7rn";
      const same = async (label, c, build) => { const h = await build(A), m = await build(GONE); t(`enumeration: ${label} answers a hidden id exactly like a missing one`, h.status === m.status && h.text === m.text, `${h.status} ${h.text.slice(0, 60)} vs ${m.status} ${m.text.slice(0, 60)}`); };
      await same("GET /api/team/:id (guest)", guest, (id) => guest.get(`/api/team/${id}`));
      await same("GET /api/member/:id (member)", member, (id) => member.get(`/api/member/${id}`));
      await same("PUT /api/team/:id (manager)", mgr, (id) => mgr.put(`/api/team/${id}`, { bio: "x" }));
      await same("POST /api/member/:id/history (manager)", mgr, (id) => mgr.post(`/api/member/${id}/history`, { year: "2020", title: "t" }));
      await same("GET /api/translations/TEAM_MEMBER/:id (member)", member, (id) => member.get(`/api/translations/TEAM_MEMBER/${id}`));
      await same("POST /api/messages/conversations (member)", member, (id) => member.post("/api/messages/conversations", { teamMemberId: id }));
      t("enumeration: a manager cannot use the publish endpoint to probe ids (403 for a hidden id and a missing id alike)", (await mgr.put(`/api/team/${A}/publication`, { isPublished: true })).status === 403 && (await mgr.put(`/api/team/${GONE}/publication`, { isPublished: true })).status === 403);
    }

    // ---- publish A: now it is public everywhere ------------------------------------------------------------------------------------
    const pubA = await admin.put(`/api/team/${A}/publication`, { isPublished: true });
    t("admin publishes the alumnus", pubA.status === 200 && pubA.json.isPublished === true);
    t("publishing again is idempotent", (await admin.put(`/api/team/${A}/publication`, { isPublished: true })).status === 200);
    t("published: guest sees it in /api/alumni, and it is NOT in the current-team roster /api/team", has((await guest.get("/api/alumni")).json, A) && !has((await guest.get("/api/team")).json, A));
    t("published: guest can open /api/team/:id and /api/member/:id", (await guest.get(`/api/team/${A}`)).status === 200 && (await guest.get(`/api/member/${A}`)).status === 200);
    t("published: search finds it", mentions(await guest.get(`/api/search?q=${encodeURIComponent(N("AlumA"))}&type=researcher`), A));
    t("published: in the sitemap", (await guest.req("GET", "/sitemap.xml", undefined, true)).text.includes(A));
    t("published: publication detail shows it", (await guest.get(`/api/publications/${P}`)).text.includes(A));
    t("published: project detail shows it", (await guest.get(`/api/projects/${PR}`)).text.includes(A));
    {
      const def = await guest.get("/api/team"), inc = await guest.get("/api/team?includeAlumni=1"), incMgr = await mgr.get("/api/team?includeAlumni=1"), incAdmin = await admin.get("/api/team?includeAlumni=1");
      t("picker: the default /api/team is unchanged (no alumni); includeAlumni=1 adds the PUBLISHED one", !has(def.json, A) && has(inc.json, A) && has(incMgr.json, A));
      t("picker: an unpublished alumnus is still absent for guest and manager, present for admin", !has(inc.json, B) && !has(incMgr.json, B) && has(incAdmin.json, B));
      t("picker: alumni sort after every roster group", inc.json.findIndex((m) => m.id === A) > inc.json.findIndex((m) => m.id === X));
      t("picker: only the exact value 1 opts in", !has((await guest.get("/api/team?includeAlumni=true")).json, A) && !has((await guest.get("/api/team?includeAlumni=0")).json, A));
    }
    t("published: the other alumnus B stays hidden", !(await guest.get("/api/alumni")).text.includes(B));
    t("published alumnus: manager still cannot edit it (403, admin only)", (await mgr.put(`/api/team/${A}`, { bio: "x" })).status === 403);
    t("published alumnus: manager cannot add history (403)", (await mgr.post(`/api/member/${A}/history`, { year: "2020", title: "t" })).status === 403);
    t("editing a published alumnus keeps it published", (await admin.put(`/api/team/${A}`, { role: "Alumnus 2" })).json?.isPublished === true);
    // ---- D1: an ordinary edit never writes the publication flag ------------------------------------------------------------------------
    // The flag is changed out-of-band (directly in the disposable database, as a concurrent publish/unpublish would) and an ordinary edit
    // must leave it exactly as it is. With the previous logic the edit wrote back a value computed from its earlier read (or forced `true`).
    // NOTE: this proves "the UPDATE does not name the column". It does not interleave two requests: the harness runs one server process
    // whose database transactions are serialised, so the stale-read window cannot be hit over HTTP here.
    {
      const raw = createClient({ url: `file:${dbCopy}` });
      const flag = async (id) => Number((await raw.execute({ sql: `SELECT "isPublished" AS p FROM "TeamMember" WHERE "id" = ?`, args: [id] })).rows[0].p);
      const setFlag = (id, v) => raw.execute({ sql: `UPDATE "TeamMember" SET "isPublished" = ? WHERE "id" = ?`, args: [v, id] });
      try {
        // an alumnus whose flag is changed behind the edit's back
        await setFlag(A, 0);
        t("D1: ordinary edit of an alumnus whose flag was unpublished out-of-band keeps it unpublished", (await admin.put(`/api/team/${A}`, { role: "Alumnus 3" })).status === 200 && (await flag(A)) === 0);
        await setFlag(A, 1);
        t("D1: ordinary edit does not reset a flag that was published out-of-band", (await admin.put(`/api/team/${A}`, { bio: "bio again" })).status === 200 && (await flag(A)) === 1);
        t("D1: saving an alumnus with the SAME category (ALUMNI -> ALUMNI) is not a transition and leaves the flag alone", (await admin.put(`/api/team/${A}`, { category: "ALUMNI", role: "Alumnus 4" })).status === 200 && (await flag(A)) === 1);
        await setFlag(A, 0);
        t("D1: ... also when the flag is 0", (await admin.put(`/api/team/${A}`, { category: "ALUMNI", role: "Alumnus 5" })).status === 200 && (await flag(A)) === 0);
        await setFlag(A, 1);
        // a non-alumni: an ordinary edit must not force the flag to true
        const y = await admin.post("/api/team", { name: N("D1Ordinary"), initials: "DO", role: "r", category: "MSC" });
        const Y = y.json.id;
        await setFlag(Y, 0);
        t("D1: ordinary edit of a non-alumni by an admin does not write the flag (stays as found)", (await admin.put(`/api/team/${Y}`, { role: "edited" })).status === 200 && (await flag(Y)) === 0);
        await setFlag(Y, 1);
        t("D1: ordinary edit of a non-alumni by a manager leaves a published flag published", (await mgr.put(`/api/team/${Y}`, { role: "edited by manager" })).status === 200 && (await flag(Y)) === 1);
        // transitions still behave as designed, whatever the stored flag was
        t("D1: entering ALUMNI unpublishes", (await admin.put(`/api/team/${Y}`, { category: "ALUMNI" })).status === 200 && (await flag(Y)) === 0);
        await setFlag(Y, 1);
        t("D1: entering ALUMNI unpublishes even if the stored flag was 1", (await admin.put(`/api/team/${Y}`, { category: "MSC" })).status === 200 && (await admin.put(`/api/team/${Y}`, { category: "ALUMNI" })).status === 200 && (await flag(Y)) === 0);
        t("D1: leaving ALUMNI publishes (flag was 0)", (await admin.put(`/api/team/${Y}`, { category: "PHD" })).status === 200 && (await flag(Y)) === 1);
        await admin.del(`/api/team/${Y}`);
      } finally {
        await setFlag(A, 1);
        raw.close();
      }
    }

    const unpub = await admin.put(`/api/team/${A}/publication`, { isPublished: false });
    t("admin unpublishes it again", unpub.status === 200 && unpub.json.isPublished === false && !(await guest.get("/api/alumni")).text.includes(A) && (await guest.get(`/api/team/${A}`)).status === 404);
    t("unpublished again: gone from the sitemap and publication detail", !(await guest.req("GET", "/sitemap.xml", undefined, true)).text.includes(A) && !(await guest.get(`/api/publications/${P}`)).text.includes(A));

    // ---- caching: no response that depends on publication may be reused ----------------------------------------------------------------
    {
      const probes = [["/api/team", guest], ["/api/alumni", guest], ["/api/alumni", admin], [`/api/team/${X}`, guest], [`/api/team/${A}`, guest], [`/api/member/${X}`, guest], [`/api/member/${A}`, guest], [`/api/search?q=${encodeURIComponent(N("AlumA"))}`, guest], [`/api/publications/${P}`, guest], [`/api/publications/${P}/authors`, guest], [`/api/projects/${PR}`, guest], [`/api/groups/${G}`, guest], [`/api/research/${AR}`, guest], [`/api/translations/TEAM_MEMBER/${A}`, member], ["/api/admin/content?type=team-member", admin]];
      for (const [p, c] of probes) {
        const r = await c.get(p);
        t(`cache: ${p.split("?")[0].replace(/[A-Za-z0-9]{20,}/g, ":id")} (${c === admin ? "admin" : c === member ? "member" : "guest"}) is Cache-Control: no-store`, /no-store/.test(r.headers.get("cache-control") ?? ""), r.headers.get("cache-control") ?? "none");
      }
      for (const p of ["/api/team", "/api/alumni", `/api/member/${X}`, `/api/search?q=${encodeURIComponent(N("AlumA"))}`, `/api/publications/${P}`]) {
        t(`cache: ${p.split("?")[0].replace(/[A-Za-z0-9]{20,}/g, ":id")} varies on Cookie, so an admin's copy is never served to a guest`, /cookie/i.test((await guest.get(p)).headers.get("vary") ?? ""));
      }
      const smHeaders = (await guest.req("GET", "/sitemap.xml", undefined, true)).headers.get("cache-control") ?? "";
      t("cache: the sitemap must be revalidated every time (it lists consent-dependent URLs)", /must-revalidate/.test(smHeaders) && /max-age=0/.test(smHeaders), smHeaders);
      // publish -> a visitor sees it at once; unpublish -> the very next visitor request no longer does (nothing server-side is cached).
      t("publish is visible to the next guest request", (await admin.put(`/api/team/${A}/publication`, { isPublished: true })).status === 200 && has((await guest.get("/api/alumni")).json, A) && (await guest.get(`/api/member/${A}`)).status === 200);
      t("unpublish is effective on the very next guest request (list, detail, member page, search, sitemap)", (await admin.put(`/api/team/${A}/publication`, { isPublished: false })).status === 200 && !has((await guest.get("/api/alumni")).json, A) && (await guest.get(`/api/team/${A}`)).status === 404 && (await guest.get(`/api/member/${A}`)).status === 404 && !mentions(await guest.get(`/api/search?q=${encodeURIComponent(N("AlumA"))}&type=researcher`), `"${A}"`) && !(await guest.req("GET", "/sitemap.xml", undefined, true)).text.includes(A));
      t("a hidden-profile 404 is itself not cacheable", /no-store/.test((await guest.get(`/api/member/${A}`)).headers.get("cache-control") ?? ""));
    }

    // ---- category conversion ------------------------------------------------------------------------------------------------------
    const toAlumni = await admin.put(`/api/team/${X}`, { category: "ALUMNI" });
    t("admin moves an unlinked member to ALUMNI: becomes unpublished", toAlumni.status === 200 && toAlumni.json.isPublished === false && !(await guest.get("/api/team")).text.includes(X));
    const back = await admin.put(`/api/team/${X}`, { category: "BSC" });
    t("admin moves the alumnus back to a normal category: published again", back.status === 200 && back.json.category === "BSC" && back.json.isPublished === true && (await guest.get("/api/team")).text.includes(X));
    const linkedMove = await admin.put(`/api/team/${ownProfile.id}`, { category: "ALUMNI" });
    t("a profile with a login account cannot be moved to ALUMNI (409)", linkedMove.status === 409 && /unlink/i.test(linkedMove.json?.error ?? ""));
    t("...and it stayed published and unchanged", (await member.get("/api/profile")).json?.category === "PHD" && (await admin.get("/api/team")).json.find((m) => m.id === ownProfile.id)?.isPublished === true);
    t("a member cannot change their own category (ignored)", (await member.put("/api/profile", { bio: "hello" })).json?.category === "PHD");

    // ---- accounts can never attach to an alumni profile -----------------------------------------------------------------------------
    const acc = (s) => ({ email: `${s}-${stamp}@example.test`, password: "Another123!pass", role: "MEMBER" });
    const c1 = await admin.post("/api/users", { ...acc("al1"), teamMemberId: B });
    t("POST /api/users linking an alumni profile is refused (409)", c1.status === 409 && /alumni/i.test(c1.json?.error ?? ""));
    t("...and no account was created", (await admin.get("/api/users")).json.every((u) => u.email !== `al1-${stamp}@example.test`));
    t("POST /api/users creating a NEW alumni profile with a login is refused (400)", (await admin.post("/api/users", { ...acc("al2"), name: N("New"), initials: "ZN", memberRole: "x", category: "ALUMNI" })).status === 400);
    const loose = await admin.post("/api/users", acc("loose"));
    t("a login without a profile can be created", loose.status === 201);
    const lk = await admin.put(`/api/users/${loose.json.id}/link`, { teamMemberId: B });
    t("PUT /api/users/:id/link to an alumni profile is refused (409)", lk.status === 409 && /alumni/i.test(lk.json?.error ?? ""));
    t("the alumni profile still has no account", (await admin.get("/api/admin/content?type=team-member&q=" + encodeURIComponent(N("AlumB")))).json.rows.find((r) => r.id === B)?.hasAccount === false);
    const lkOk = await admin.put(`/api/users/${loose.json.id}/link`, { teamMemberId: X });
    t("linking an ORDINARY unlinked profile still works (regression)", lkOk.status === 200);
    t("admin cannot convert that now-linked profile to ALUMNI (409)", (await admin.put(`/api/team/${X}`, { category: "ALUMNI" })).status === 409);
    t("POST /api/users linking an ordinary unlinked profile still works (regression)", (await admin.post("/api/users", { ...acc("okl"), teamMemberId: (await admin.post("/api/team", { name: N("Free"), initials: "ZF", role: "r", category: "MSC" })).json.id })).status === 201);

    const inv1 = await admin.post("/api/invitations", { email: `inv-al-${stamp}@example.test`, role: "MEMBER", teamMemberId: B });
    t("invitation for an alumni profile is refused (409)", inv1.status === 409 && /alumni/i.test(inv1.json?.error ?? ""));
    t("invitation that creates a NEW alumni profile is refused (400)", (await admin.post("/api/invitations", { email: `inv-al2-${stamp}@example.test`, role: "MEMBER", name: N("I"), initials: "ZI", memberRole: "r", category: "ALUMNI" })).status === 400);
    const freeId = (await admin.post("/api/team", { name: N("InvFree"), initials: "ZV", role: "r", category: "MSC" })).json.id;
    const invOk = await admin.post("/api/invitations", { email: `inv-ok-${stamp}@example.test`, role: "MEMBER", teamMemberId: freeId });
    t("invitation for an ordinary unlinked profile still works (regression)", invOk.status === 201);
    // The profile becomes an alumnus AFTER the invitation was sent: accepting must not link a login to it.
    const tok = (invOk.json?.inviteUrl ?? invOk.json?.url ?? JSON.stringify(invOk.json)).match(/\/invite\/([A-Za-z0-9_-]{20,})/)?.[1];
    t("invitation token obtained", Boolean(tok));
    t("admin moves that (still unlinked) profile to ALUMNI", (await admin.put(`/api/team/${freeId}`, { category: "ALUMNI" })).status === 200);
    const acceptNew = new Client(base);
    const acc1 = await acceptNew.post(`/api/invitations/token/${tok}/accept`, { password: "Accepted123!pass" });
    t("accepting an invitation whose profile became an alumnus is refused (409)", acc1.status === 409, JSON.stringify(acc1.json));
    t("...no account was created and the profile has none", (await admin.get("/api/users")).json.every((u) => u.email !== `inv-ok-${stamp}@example.test`));

    // ---- audit log: a manager's view leaves out events about alumni / unpublished profiles ---------------------------------------------
    {
      const mAudit = await mgr.get("/api/admin/audit?limit=100");
      const aAudit = await admin.get("/api/admin/audit?limit=100");
      t("audit (manager): no event names an alumnus or an unpublished profile", mAudit.status === 200 && !mAudit.text.includes(N("AlumA")) && !mAudit.text.includes(N("AlumB")) && !mAudit.text.includes("TEAM_MEMBER_PUBLISHED") && !mAudit.text.includes("TEAM_MEMBER_UNPUBLISHED"));
      t("audit (manager): events about ordinary members are still listed (unchanged)", mAudit.text.includes("TEAM_MEMBER_CREATED") && mAudit.text.includes(N("Bsc")));
      t("audit (manager): the filter facets do not offer the publish actions", !JSON.stringify(mAudit.json.facets).includes("PUBLISHED"));
      t("audit (admin): sees the alumni events in full", aAudit.text.includes(N("AlumA")) && aAudit.text.includes("TEAM_MEMBER_PUBLISHED"));
      const mAuditOnlyMembers = await mgr.get("/api/admin/audit?entityType=TEAM_MEMBER&limit=100");
      t("audit (manager) filtered to team profiles still works and omits alumni", mAuditOnlyMembers.status === 200 && mAuditOnlyMembers.json.entries.length > 0 && !mAuditOnlyMembers.text.includes(N("AlumA")));
    }

    // ---- delete + audit -----------------------------------------------------------------------------------------------------------
    t("manager cannot delete (403)", (await mgr.del(`/api/team/${B}`)).status === 403);
    t("admin can delete an unpublished alumnus", (await admin.del(`/api/team/${B}`)).status === 200 && (await admin.get(`/api/team/${B}`)).status === 404);
    // The residual closed in the final review: an alumnus who is DELETED keeps no earlier "updated" row visible to a manager.
    {
      const del = await admin.post("/api/team", alumniBody("AlumGone"));
      const gid = del.json?.id;
      t("final review: an alumnus is created, edited and published, then deleted", del.status === 201 && (await admin.put(`/api/team/${gid}`, { bio: "edited before deletion" })).status === 200 && (await admin.put(`/api/team/${gid}/publication`, { isPublished: true })).status === 200 && (await admin.del(`/api/team/${gid}`)).status === 200);
      const before = await admin.get("/api/admin/audit?limit=100");
      t("final review: the administrator still sees all of that alumnus's events (history is not rewritten)", before.text.includes(N("AlumGone")) && before.json.entries.filter((e) => e.entityId === gid).length >= 3);
      const mAfter = await mgr.get("/api/admin/audit?limit=100");
      t("final review: a manager sees NONE of the deleted alumnus's events, including the earlier 'updated' row", mAfter.status === 200 && !mAfter.text.includes(N("AlumGone")) && !mAfter.json.entries.some((e) => e.entityId === gid));
      t("final review: events about an ordinary deleted member are still visible to a manager (unchanged)", (await (async () => { const o = await admin.post("/api/team", { name: N("OrdinaryGone"), initials: "OG", role: "r", category: "MSC" }); await admin.put(`/api/team/${o.json.id}`, { bio: "x" }); await admin.del(`/api/team/${o.json.id}`); return (await mgr.get("/api/admin/audit?limit=100")).text.includes(N("OrdinaryGone")); })()));
    }
    const audit = await admin.get("/api/admin/audit?limit=100");
    t("publish / unpublish are audited", audit.status === 200 && audit.text.includes("TEAM_MEMBER_PUBLISHED") && audit.text.includes("TEAM_MEMBER_UNPUBLISHED"));
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(workDir, { recursive: true, force: true });
  }
  console.log(`${ok} alumni checks passed, ${failures.length} failed.`);
  if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error("alumni regression crashed:", e); process.exit(1); });
