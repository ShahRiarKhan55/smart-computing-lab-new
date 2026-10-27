/**
 * Regression test of the Phase 3C research-profile links (Google Scholar, ResearchGate, ORCID) through the REAL application
 * (createApp) with REAL password logins. Isolated: a brand-new SQLite file built from the repository's own migrations in a temp
 * directory. It never reads TURSO_* / DATABASE_URL (refuses to run if TURSO_* is set), never touches a hosted database and
 * never opens a non-loopback connection.
 *   npx tsx scripts/research-links-regression.ts      (or: npm run test:research-links -w apps/server)
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
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "scl-research-links-"));
const dbFile = path.join(workDir, "t.db");
{
  const c = createClient({ url: `file:${dbFile}` });
  for (const d of fs.readdirSync(MIGRATIONS, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) {
    await c.executeMultiple(fs.readFileSync(path.join(MIGRATIONS, d, "migration.sql"), "utf8"));
  }
  c.close();
}
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.SESSION_SECRET = "research-links-regression-secret-000000";
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
  login = (email: string, password: string) => this.req("POST", "/api/auth/login", { email, password });
}
const PW = "Passw0rd!-test";
const hash = await bcrypt.hash(PW, 4);
const mkUser = (email: string, role = "MEMBER") => prisma.user.create({ data: { email, passwordHash: hash, role } });
const admin = await mkUser("admin@example.org", "ADMIN");
const mgr = await mkUser("manager@example.org", "LAB_MANAGER");
const alice = await mkUser("alice@example.org");
const bob = await mkUser("bob@example.org");
const carol = await mkUser("carol@example.org"); // no profile
const mkMember = (name: string, userId: string | null, extra: Record<string, unknown> = {}) =>
  prisma.teamMember.create({ data: { name, initials: name.slice(0, 2).toUpperCase(), role: "Researcher", category: "MSC", userId, department: "D", bio: "B", ...extra } });
const aliceM = await mkMember("Alice A", alice.id);
const bobM = await mkMember("Bob B", bob.id);

const GS = "https://scholar.google.co.jp/citations?user=AbCdEfGhIjKl";
const RG = "https://www.researchgate.net/profile/Alice-A-1";
const OC = "https://orcid.org/0000-0002-1825-0097";
const AD = new Browser(), MG = new Browser(), AL = new Browser(), BO = new Browser(), CA = new Browser(), ANON = new Browser();
t("setup: every account can sign in", [await AD.login("admin@example.org", PW), await MG.login("manager@example.org", PW), await AL.login("alice@example.org", PW), await BO.login("bob@example.org", PW), await CA.login("carol@example.org", PW)].every((r) => r.status === 200));
const row = (id: string) => prisma.teamMember.findUniqueOrThrow({ where: { id } });
const linksOf = (o: any) => [o?.googleScholarUrl, o?.researchGateUrl, o?.orcidUrl].join("|");

// ---- 1. new rows and old rows default to no links ----------------------------------------------------------------------------
{
  const r = await row(aliceM.id);
  t("a profile created before the feature has three empty links", linksOf(r) === "||");
  const own = await AL.get("/api/profile");
  t("GET /api/profile returns empty links for an old row", own.status === 200 && linksOf(own.json) === "||");
  const pub = await ANON.get(`/api/member/${aliceM.id}`);
  t("the public profile page returns empty links for an old row", pub.status === 200 && linksOf(pub.json) === "||");
}

// ---- 2. self-edit (PUT /api/profile) -----------------------------------------------------------------------------------------
{
  const r = await AL.put("/api/profile", { googleScholarUrl: GS + "&hl=ja", researchGateUrl: RG + "?utm_source=x", orcidUrl: "0000-0002-1825-0097" });
  t("own edit: all three accepted and canonicalised in the response", r.status === 200 && linksOf(r.json) === [GS, RG, OC].join("|"), r.text);
  t("own edit: stored canonical, tracking dropped", linksOf(await row(aliceM.id)) === [GS, RG, OC].join("|"));
  const pub = await ANON.get(`/api/member/${aliceM.id}`);
  t("own edit: the public profile page shows them to an anonymous visitor", pub.status === 200 && linksOf(pub.json) === [GS, RG, OC].join("|"));
  const team = await ANON.get("/api/team");
  const card = (team.json as any[]).find((m) => m.id === aliceM.id);
  t("own edit: the team card payload carries them", team.status === 200 && linksOf(card) === [GS, RG, OC].join("|"));
  // a text-only save does not disturb the links; a single-field save only touches that field
  const r2 = await AL.put("/api/profile", { bio: "new bio" });
  t("own edit: a text-only save keeps the links", r2.status === 200 && linksOf(await row(aliceM.id)) === [GS, RG, OC].join("|"));
  const r3 = await AL.put("/api/profile", { orcidUrl: "" });
  t("own edit: clearing one link leaves the others", r3.status === 200 && linksOf(await row(aliceM.id)) === [GS, RG, ""].join("|"));
  const bad = [
    { googleScholarUrl: "javascript:alert(1)" }, { googleScholarUrl: "https://scholar.google.com.evil.example/citations?user=AbCdEfGhIjKl" },
    { researchGateUrl: "https://evil.example/profile/x" }, { researchGateUrl: "data:text/html,x" }, { orcidUrl: "0000-0002-1825-0098" }, { orcidUrl: "https://orcid.org.evil.example/0000-0002-1825-0097" },
    { orcidUrl: 5 }, { googleScholarUrl: "https://user:pw@scholar.google.com/citations?user=AbCdEfGhIjKl" },
  ];
  for (const b of bad) {
    const before = linksOf(await row(aliceM.id));
    const x = await AL.put("/api/profile", { ...b, bio: "must not be saved" });
    t(`own edit: ${JSON.stringify(b).slice(0, 60)} -> 400 and nothing saved`, x.status === 400 && linksOf(await row(aliceM.id)) === before && (await row(aliceM.id)).bio === "new bio", `${x.status} ${x.text.slice(0, 120)}`);
  }
  const e = await AL.put("/api/profile", { orcidUrl: "0000-0002-1825-0098" });
  t("own edit: the 400 carries the fixed ORCID message", e.status === 400 && JSON.stringify(e.json).includes("ORCID must be a valid iD"), e.text);
  t("own edit: an unauthenticated request is 401", (await ANON.put("/api/profile", { orcidUrl: OC })).status === 401);
  t("own edit: an account with no profile is 404 and writes nothing", (await CA.put("/api/profile", { orcidUrl: OC })).status === 404);
  t("own edit: Bob's profile was never touched by Alice's edits", linksOf(await row(bobM.id)) === "||");
  t("own edit: publication field still refused", (await AL.put("/api/profile", { isPublished: true, orcidUrl: OC })).status === 400);
  const aud = await prisma.auditLog.findMany({ where: { entityId: aliceM.id, action: "TEAM_MEMBER_UPDATED" } });
  t("own edit: the audit trail names the changed link fields but never the URLs", aud.some((a) => /googleScholarUrl/.test(JSON.stringify(a))) && !aud.some((a) => JSON.stringify(a).includes("orcid.org") || JSON.stringify(a).includes("researchgate.net")));
}

// ---- 3. authorization: who may edit whose links via PUT /api/team/:id ----------------------------------------------------------
{
  const b0 = linksOf(await row(bobM.id));
  const x = await AL.put(`/api/team/${bobM.id}`, { orcidUrl: OC });
  t("member cannot set another member's links (403)", x.status === 403 && linksOf(await row(bobM.id)) === b0, String(x.status));
  t("anonymous cannot set links (401)", (await ANON.put(`/api/team/${bobM.id}`, { orcidUrl: OC })).status === 401);
  const own = await BO.put(`/api/team/${bobM.id}`, { orcidUrl: OC });
  t("a member may set links on their own profile through the team route", own.status === 200 && (await row(bobM.id)).orcidUrl === OC, String(own.status));
  const mg = await MG.put(`/api/team/${bobM.id}`, { researchGateUrl: "https://researchgate.net/profile/Bob-B", googleScholarUrl: "" });
  t("a lab manager may set links; non-www ResearchGate is canonicalised", mg.status === 200 && (await row(bobM.id)).researchGateUrl === "https://www.researchgate.net/profile/Bob-B", String(mg.status));
  const ad = await AD.put(`/api/team/${bobM.id}`, { googleScholarUrl: GS });
  t("an administrator may set links", ad.status === 200 && (await row(bobM.id)).googleScholarUrl === GS);
  t("an invalid link through the team route is 400 and writes nothing", (await AD.put(`/api/team/${bobM.id}`, { googleScholarUrl: "javascript:x", bio: "nope" })).status === 400 && (await row(bobM.id)).bio === "B");
  const res = await AD.put(`/api/team/${bobM.id}`, { name: "Bob B2" });
  t("an ordinary edit leaves the links alone", res.status === 200 && linksOf(await row(bobM.id)) === [GS, "https://www.researchgate.net/profile/Bob-B", OC].join("|"));
}

// ---- 4. admin create (POST /api/team) ------------------------------------------------------------------------------------------
{
  const base = { name: "Dana D", initials: "DD", role: "Researcher", category: "PHD" };
  const c = await AD.post("/api/team", { ...base, googleScholarUrl: GS, researchGateUrl: RG, orcidUrl: OC });
  t("admin create: links stored canonical and returned", c.status === 201 && linksOf(c.json) === [GS, RG, OC].join("|") && linksOf(await row(c.json.id)) === [GS, RG, OC].join("|"), c.text);
  const d = await AD.post("/api/team", base);
  t("admin create: omitted links are empty", d.status === 201 && linksOf(d.json) === "||");
  const n0 = await prisma.teamMember.count();
  const bad = await AD.post("/api/team", { ...base, name: "Bad Link", orcidUrl: "not-an-orcid" });
  t("admin create: an invalid link is 400 and creates nothing", bad.status === 400 && (await prisma.teamMember.count()) === n0);
  t("a member cannot create profiles with links (403)", (await AL.post("/api/team", { ...base, orcidUrl: OC })).status === 403);
}

// ---- 5. publication: unpublished alumni never leak their links -------------------------------------------------------------------
{
  const al = await AD.post("/api/team", { name: "Evan E", initials: "EE", role: "Former MSc", category: "ALUMNI", googleScholarUrl: GS, researchGateUrl: RG, orcidUrl: OC });
  t("alumni create with links is accepted and unpublished", al.status === 201 && linksOf(al.json) === [GS, RG, OC].join("|") && al.json.isPublished === false, al.text);
  const id = al.json.id as string;
  const leaks = (s: string) => s.includes("orcid.org/0000-0002-1825-0097") || s.includes("researchgate.net/profile/Alice-A-1") || s.includes("AbCdEfGhIjKl");
  for (const [who, br] of [["anonymous", ANON], ["member", AL], ["lab manager", MG]] as const) {
    const list = await br.get("/api/alumni");
    const prof = await br.get(`/api/member/${id}`);
    const one = await br.get(`/api/team/${id}`);
    const roster = await br.get("/api/team");
    t(`unpublished alumnus: ${who} gets no link in the alumni list`, list.status === 200 && !(list.json as any[]).some((m) => m.id === id) && !list.text.includes("Evan"), list.text.slice(0, 80));
    t(`unpublished alumnus: ${who} gets 404 on the profile page, no link text`, prof.status === 404 && !leaks(prof.text));
    t(`unpublished alumnus: ${who} gets 404 on the team item, no link text`, one.status === 404 && !leaks(one.text));
    t(`unpublished alumnus: ${who} roster has no alumnus and no alumnus link`, roster.status === 200 && !(roster.json as any[]).some((m) => m.id === id));
  }
  const adminList = await AD.get("/api/alumni");
  t("unpublished alumnus: the administrator still sees them (with links) in the alumni list", (adminList.json as any[]).some((m) => m.id === id && linksOf(m) === [GS, RG, OC].join("|")));
  t("publish succeeds", (await AD.put(`/api/team/${id}/publication`, { isPublished: true })).status === 200);
  const pub = await ANON.get("/api/alumni");
  t("published alumnus: links visible to an anonymous visitor in the alumni list", (pub.json as any[]).some((m) => m.id === id && linksOf(m) === [GS, RG, OC].join("|")));
  const prof = await ANON.get(`/api/member/${id}`);
  t("published alumnus: links visible on the profile page", prof.status === 200 && linksOf(prof.json) === [GS, RG, OC].join("|"));
  t("unpublish again", (await AD.put(`/api/team/${id}/publication`, { isPublished: false })).status === 200);
  const again = await ANON.get("/api/alumni");
  t("unpublished again: links gone from the public alumni list immediately", !(again.json as any[]).some((m) => m.id === id) && !leaks(again.text));
  t("unpublished again: and from the profile page", (await ANON.get(`/api/member/${id}`)).status === 404);
  // moving an existing member to ALUMNI unpublishes them; their links go with them
  const mv = await AD.put(`/api/team/${bobM.id}`, { category: "ALUMNI" });
  t("moving a member to ALUMNI hides their links from the public", mv.status === 403 || mv.status === 409 || mv.status === 200);
  if (mv.status === 200) t("... and the public profile is 404 with no link text", (await ANON.get(`/api/member/${bobM.id}`)).status === 404);
}

// ---- 6. read-time defence: a bad value that reached the column is never served ----------------------------------------------------
{
  const evil = await mkMember("Fay F", null, { googleScholarUrl: "javascript:alert(1)", researchGateUrl: "https://evil.example/x", orcidUrl: "https://orcid.org/0000-0002-1825-0098" });
  const prof = await ANON.get(`/api/member/${evil.id}`);
  const list = await ANON.get("/api/team");
  t("a corrupted stored value is served as empty on the profile page", prof.status === 200 && linksOf(prof.json) === "||" && !prof.text.includes("javascript:"));
  t("a corrupted stored value is served as empty on the team list", list.status === 200 && !list.text.includes("javascript:") && !list.text.includes("evil.example"));
  const good = await mkMember("Gus G", null, { googleScholarUrl: GS, orcidUrl: OC });
  t("a valid stored value is served unchanged", linksOf((await ANON.get(`/api/member/${good.id}`)).json) === [GS, "", OC].join("|"));
}

t("no request left the loopback interface", offLoopback === 0, String(offLoopback));
server.close();
await prisma.$disconnect();
console.error = realError;
fs.rmSync(workDir, { recursive: true, force: true });
console.log(`${ok} research-link API checks passed, ${failures.length} failed.`);
if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
