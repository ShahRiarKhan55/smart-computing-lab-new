/**
 * Regression test of the duplicate warnings (team profile names, publications / DOIs, news, research areas) through the REAL
 * application (createApp) with REAL password logins. Isolated: a brand-new SQLite file built from the repository's own migrations in a
 * temp directory. It never reads TURSO_* / DATABASE_URL (refuses to run if TURSO_* is set), never touches a hosted database and never
 * opens a non-loopback connection.
 *   npx tsx scripts/duplicate-prevention-regression.ts      (or: npm run test:duplicates -w apps/server)
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
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "scl-duplicates-"));
const dbFile = path.join(workDir, "t.db");
{
  const c = createClient({ url: `file:${dbFile}` });
  for (const d of fs.readdirSync(MIGRATIONS, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) {
    await c.executeMultiple(fs.readFileSync(path.join(MIGRATIONS, d, "migration.sql"), "utf8"));
  }
  c.close();
}
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.SESSION_SECRET = "duplicates-regression-secret-0000000";
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
const mkMember = (name: string, userId: string | null, extra: Record<string, unknown> = {}) =>
  prisma.teamMember.create({ data: { name, initials: name.slice(0, 2).toUpperCase(), role: "Researcher", category: "MSC", userId, department: "D", bio: "B", ...extra } });
const aliceM = await mkMember("Alice Anders", alice.id);
const bobM = await mkMember("Bob Brown", bob.id);

const AD = new Browser(), MG = new Browser(), AL = new Browser(), BO = new Browser(), ANON = new Browser();
t("setup: every account can sign in", [await AD.login("admin@example.org", PW), await MG.login("manager@example.org", PW), await AL.login("alice@example.org", PW), await BO.login("bob@example.org", PW)].every((r) => r.status === 200));

const auditFor = async (entityId: string, action: string) =>
  (await prisma.auditLog.findMany({ where: { entityId, action } })).map((r) => (r.details ? JSON.parse(r.details) : {}));
const isConflict = (r: { status: number; json: any }, kind: string) => r.status === 409 && r.json?.code === "DUPLICATE_CANDIDATE" && r.json?.kind === kind;
const SENSITIVE = /passwordHash|tokenHash|"subject"|sessionData|Set-Cookie/i;

// =====================================================================================================================================
// 1. TEAM PROFILE NAMES
// =====================================================================================================================================
const newProfile = (name: string, extra: Record<string, unknown> = {}) => ({ name, initials: "NP", role: "MSc Researcher", category: "MSC", ...extra });
const teamCount = (name: string) => prisma.teamMember.count({ where: { name } });
let carolId = "";
{
  const first = await MG.post("/api/team", newProfile("Chiara Conti"));
  t("team create: a new name is created (201)", first.status === 201, first.text);
  carolId = first.json?.id;

  const same = await MG.post("/api/team", newProfile("Chiara Conti"));
  t("team create: the same name is refused with a duplicate conflict (409)", isConflict(same, "team-name"), same.text);
  t("team create: the conflict says it is overridable and that this manager may override", same.json?.overridable === true && same.json?.canOverride === true);
  t("team create: the conflict names the existing profile (id, label) and nothing sensitive", same.json?.candidates?.length === 1 && same.json.candidates[0].id === carolId && same.json.candidates[0].label === "Chiara Conti" && !SENSITIVE.test(same.text));
  t("team create: the message does not repeat the name", !String(same.json?.error).includes("Chiara"));
  t("team create: no second profile was created by the refused request", (await teamCount("Chiara Conti")) === 1);

  const variants = ["chiara  conti", "CHIARA CONTI.", "Chiara-Conti", "  Conti Chiara "];
  const results = await Promise.all(variants.map((v) => MG.post("/api/team", newProfile(v))));
  t("team create: case, whitespace, punctuation and family-name-order variants are all flagged", results.every((r) => isConflict(r, "team-name")), results.map((r) => r.status).join());

  const different = await MG.post("/api/team", newProfile("Chiara Contini"));
  t("team create: a genuinely different name is not flagged", different.status === 201, different.text);

  const confirmed = await MG.post("/api/team", newProfile("Chiara Conti", { confirmDuplicate: true }));
  t("team create: a manager can confirm a legitimate same-name person (201)", confirmed.status === 201, confirmed.text);
  t("team create: the override is recorded in the audit row", (await auditFor(confirmed.json?.id, "TEAM_MEMBER_CREATED")).some((d) => d.duplicateOverride === "team-name"));
  t("team create: the original profile is untouched by the override", (await prisma.teamMember.findUnique({ where: { id: carolId } }))?.name === "Chiara Conti");
  t("team create: an admin can confirm too", (await AD.post("/api/team", newProfile("Chiara Conti", { confirmDuplicate: true }))).status === 201);
  t("team create: a non-boolean confirmDuplicate is a validation error (400), not an override", (await MG.post("/api/team", newProfile("Chiara Conti", { confirmDuplicate: "true" }))).status === 400);
  t("team create: an unknown account (anonymous) is refused as before", (await ANON.post("/api/team", newProfile("Whoever"))).status === 401);
  t("team create: a member cannot create profiles at all (403), override or not", (await AL.post("/api/team", newProfile("Chiara Conti", { confirmDuplicate: true }))).status === 403);

  // Profiles the requester cannot see are never compared (no existence probe): an unpublished ALUMNI profile.
  const hidden = await AD.post("/api/team", newProfile("Zed Hidden", { category: "ALUMNI" }));
  t("team create: admin creates an (unpublished) alumni profile", hidden.status === 201 && hidden.json?.isPublished === false, hidden.text);
  const probe = await MG.post("/api/team", newProfile("Zed Hidden"));
  t("team create: a manager is NOT told an unpublished alumni profile has that name (no probing)", probe.status === 201, probe.text);
  const adminSees = await AD.post("/api/team", newProfile("Zed Hidden"));
  t("team create: an admin, who can see it, IS warned (and the hidden profile is among the candidates)", isConflict(adminSees, "team-name") && adminSees.json?.candidates?.some((c: any) => c.id === hidden.json?.id), adminSees.text);
}

// Concurrency: two overlapping creates of one new name. The write lock serialises them, so at most one is created.
{
  const [a, b] = await Promise.all([MG.post("/api/team", newProfile("Race Runner")), AD.post("/api/team", newProfile("Race Runner"))]);
  const created = [a, b].filter((r) => r.status === 201).length;
  t("team create (concurrent): never two profiles for one name", created === 1 && (await teamCount("Race Runner")) === 1, `${a.status}/${b.status}`);
  t("team create (concurrent): the loser gets the duplicate conflict or a retryable 503, never a 500", [a, b].every((r) => r.status === 201 || r.status === 409 || r.status === 503), `${a.status}/${b.status}`);
}

// Team edit (admin/manager route and own-profile route)
{
  const target = await mkMember("Dora Dietrich", null);
  const rename = await MG.put(`/api/team/${target.id}`, { name: "Alice Anders" });
  t("team edit: renaming onto another profile's name is refused (409)", isConflict(rename, "team-name") && rename.json?.candidates?.[0]?.id === aliceM.id, rename.text);
  t("team edit: the profile keeps its name after the refusal", (await prisma.teamMember.findUnique({ where: { id: target.id } }))?.name === "Dora Dietrich");
  const caseOnly = await MG.put(`/api/team/${target.id}`, { name: "dora  DIETRICH" });
  t("team edit: the profile itself is excluded (a case/spacing change of its own name is fine)", caseOnly.status === 200, caseOnly.text);
  const unrelated = await MG.put(`/api/team/${target.id}`, { role: "Postdoc" });
  t("team edit: an edit that does not touch the name is never compared", unrelated.status === 200, unrelated.text);
  const forced = await MG.put(`/api/team/${target.id}`, { name: "Alice Anders", confirmDuplicate: true });
  t("team edit: a manager can confirm the rename (200)", forced.status === 200 && forced.json?.name === "Alice Anders", forced.text);
  t("team edit: the override is audited", (await auditFor(target.id, "TEAM_MEMBER_UPDATED")).some((d) => d.duplicateOverride === "team-name"));
  const fine = await MG.put(`/api/team/${target.id}`, { name: "Dora D. Unique" });
  t("team edit: renaming to an unused name works", fine.status === 200);
  t("team edit: confirmDuplicate alone is still 'Nothing to update.' (400)", (await MG.put(`/api/team/${target.id}`, { confirmDuplicate: true })).status === 400);

  // A duplicate that already exists never blocks an unrelated edit.
  const d1 = await mkMember("Existing Twin", null), d2 = await mkMember("Existing Twin", null);
  t("team edit: an already-duplicated profile can still be edited for other fields", (await MG.put(`/api/team/${d1.id}`, { bio: "new bio" })).status === 200 && (await MG.put(`/api/team/${d2.id}`, { role: "Lead" })).status === 200);
  t("team edit: re-saving the unchanged duplicated name is allowed", (await MG.put(`/api/team/${d1.id}`, { name: "Existing Twin" })).status === 200);
  t("team edit: but renaming a third profile onto it is flagged", isConflict(await MG.put(`/api/team/${target.id}`, { name: "Existing Twin" }), "team-name"));
}
{
  const own = await AL.put("/api/profile", { name: "Bob Brown" });
  t("own profile: renaming onto someone else's name is refused (409)", isConflict(own, "team-name"), own.text);
  t("own profile: a member is told they cannot override", own.json?.overridable === true && own.json?.canOverride === false);
  const tryForce = await AL.put("/api/profile", { name: "Bob Brown", confirmDuplicate: true });
  t("own profile: a member's confirmDuplicate is ignored (still 409)", isConflict(tryForce, "team-name") && (await prisma.teamMember.findUnique({ where: { id: aliceM.id } }))?.name === "Alice Anders");
  t("own profile: an edit that does not touch the name works", (await AL.put("/api/profile", { bio: "Hello" })).status === 200);
  t("own profile: a case-only change of the member's own name works (self excluded)", (await AL.put("/api/profile", { name: "ALICE anders" })).status === 200);
  t("own profile: a unique new name works", (await AL.put("/api/profile", { name: "Alice Anders-Wells" })).status === 200);
  const mgrOwn = await mkMember("Manny Manager", mgr.id);
  t("own profile: a lab manager can confirm a same-name rename of their own profile", (await MG.put("/api/profile", { name: "Bob Brown", confirmDuplicate: true })).status === 200 && (await prisma.teamMember.findUnique({ where: { id: mgrOwn.id } }))?.name === "Bob Brown");
}

// TeamMember.userId uniqueness and account linking are unchanged
{
  let threw = false;
  try { await prisma.teamMember.create({ data: { name: "Second Alice", initials: "SA", role: "r", category: "MSC", userId: alice.id } }); } catch { threw = true; }
  t("userId uniqueness is untouched: a second profile for one account is still refused by the database", threw);
  const solo = await mkMember("Link Target", null);
  const carol = await mkUser("carol@example.org");
  const link = await AD.put(`/api/users/${carol.id}/link`, { teamMemberId: solo.id });
  t("account linking is unchanged (admin links an unlinked profile)", link.status === 200 && (await prisma.teamMember.findUnique({ where: { id: solo.id } }))?.userId === carol.id);
  const again = await AD.put(`/api/users/${alice.id}/link`, { teamMemberId: solo.id });
  t("account linking is unchanged (a claimed profile cannot be linked twice)", again.status === 409 || again.status === 400);
}

// Admin user creation (new profile mode)
{
  const body = (email: string, name: string, extra: Record<string, unknown> = {}) => ({ email, password: "Str0ngPassw0rd!x", role: "MEMBER", name, initials: "XX", memberRole: "MSc Researcher", category: "MSC", ...extra });
  const dup = await AD.post("/api/users", body("dup1@example.org", "Alice Anders-Wells"));
  t("admin create user: a new profile whose name matches is refused (409)", isConflict(dup, "team-name"), dup.text);
  t("admin create user: nothing was created by the refused request (rolled back)", (await prisma.user.count({ where: { email: "dup1@example.org" } })) === 0);
  const ok1 = await AD.post("/api/users", body("dup1@example.org", "Alice Anders-Wells", { confirmDuplicate: true }));
  t("admin create user: the admin can confirm (201) and the account and profile are created together", ok1.status === 201 && (await prisma.teamMember.count({ where: { userId: ok1.json?.id } })) === 1, ok1.text);
  t("admin create user: the override is audited on USER_CREATED", (await auditFor(ok1.json?.id, "USER_CREATED")).some((d) => d.duplicateOverride === "team-name"));
  t("admin create user: an existing email still answers its own conflict", (await AD.post("/api/users", body("dup1@example.org", "Someone Else"))).status === 409);
  t("admin create user: linking an existing profile is not name-checked", (await AD.post("/api/users", { email: "link1@example.org", password: "Str0ngPassw0rd!x", role: "MEMBER", teamMemberId: (await mkMember("Free Profile", null)).id })).status === 201);
  t("admin create user: a login with no profile is not name-checked", (await AD.post("/api/users", { email: "noprofile@example.org", password: "Str0ngPassw0rd!x", role: "MEMBER" })).status === 201);
}

// Invitations: issue and accept
{
  const inv = (email: string, name: string, extra: Record<string, unknown> = {}) => ({ email, role: "MEMBER", name, initials: "IV", memberRole: "MSc Researcher", category: "MSC", ...extra });
  const dup = await AD.post("/api/invitations", inv("inv1@example.org", "Bob Brown"));
  t("invitation issue: a new-profile invitation whose name matches is refused (409)", isConflict(dup, "team-name"), dup.text);
  t("invitation issue: no invitation row was created by the refused request", (await prisma.accountInvitation.count({ where: { email: "inv1@example.org" } })) === 0);
  const forced = await AD.post("/api/invitations", inv("inv1@example.org", "Bob Brown", { confirmDuplicate: true }));
  t("invitation issue: the admin can confirm (201)", forced.status === 201, forced.text);
  t("invitation issue: the override is audited", (await prisma.auditLog.findMany({ where: { action: "INVITATION_CREATED", entityId: forced.json?.id } })).some((r) => (r.details ?? "").includes("duplicateOverride")));
  const token1 = String(forced.json?.url).split("/invite/")[1];
  const acc1 = await new Browser().post(`/api/invitations/token/${token1}/accept`, { password: "Str0ngPassw0rd!x" });
  const invitee1 = await prisma.user.findUnique({ where: { email: "inv1@example.org" } });
  t("invitation accept: an invitation confirmed at issue time is accepted (201) and creates the invitee's own profile", acc1.status === 201 && !!invitee1 && (await prisma.teamMember.count({ where: { userId: invitee1.id, name: "Bob Brown" } })) === 1, acc1.text);

  // A same-name profile appearing AFTER the invitation was issued stops the acceptance, and nothing is consumed.
  const fresh = await AD.post("/api/invitations", inv("inv2@example.org", "Latecomer Lane"));
  t("invitation issue: a unique name is issued (201)", fresh.status === 201, fresh.text);
  await new Promise((r) => setTimeout(r, 15));
  await mkMember("Latecomer Lane", null);
  const token2 = String(fresh.json?.url).split("/invite/")[1];
  const acc2 = await new Browser().post(`/api/invitations/token/${token2}/accept`, { password: "Str0ngPassw0rd!x" });
  t("invitation accept: a same-name profile created after issue is refused (409) with a generic message", acc2.status === 409 && acc2.json?.code === "DUPLICATE_CANDIDATE" && acc2.json?.canOverride === false && acc2.json?.candidates?.length === 0 && !String(acc2.text).includes("Latecomer"), acc2.text);
  const row2 = await prisma.accountInvitation.findFirst({ where: { email: "inv2@example.org" } });
  t("invitation accept: the invitation is still pending (not consumed) after the refusal", row2?.usedAt == null && row2?.revokedAt == null);
  t("invitation accept: no account was created by the refused acceptance", (await prisma.user.count({ where: { email: "inv2@example.org" } })) === 0);

  // An invitation whose person already existed at issue time and was confirmed is not retroactively blocked by that same profile.
  const ok3 = await AD.post("/api/invitations", inv("inv3@example.org", "Latecomer Lane", { confirmDuplicate: true }));
  t("invitation issue: the same name is confirmable (201)", ok3.status === 201, ok3.text);
  const acc3 = await new Browser().post(`/api/invitations/token/${String(ok3.json?.url).split("/invite/")[1]}/accept`, { password: "Str0ngPassw0rd!x" });
  t("invitation accept: a profile that already existed when the invitation was issued does not block it", acc3.status === 201, acc3.text);
}

// =====================================================================================================================================
// 2. PUBLICATIONS
// =====================================================================================================================================
const pubBody = (title: string, year: number, doiUrl = "", extra: Record<string, unknown> = {}) => ({ title, year, authors: "A. Author", venue: "Venue", doiUrl, ...extra });
const pubCount = (title: string) => prisma.publication.count({ where: { title } });
{
  const JOURNAL = pubBody("Optimizing FPGA and Wafer Test Coverage with Spatial Sampling and Machine Learning: Analysis of Local Spatial Consistency", 2026, "https://doi.org/10.3390/signals7030053");
  const CONF = pubBody("Optimizing FPGA and wafer test coverage with spatial sampling and machine learning", 2025, "https://doi.org/10.48550/arXiv.2506.03556");
  const j = await AL.post("/api/publications", JOURNAL);
  t("publication create: the first version (journal) is created by a member (201)", j.status === 201, j.text);
  const c = await AL.post("/api/publications", CONF);
  t("publication create: the audit's distinct conference/preprint version is NOT flagged (201)", c.status === 201, c.text);
  const cPre = await AL.post("/api/publications", pubBody(CONF.title, 2025, "https://doi.org/10.1109/icecet.2025.9999"));
  t("publication create: the same title and year with a DIFFERENT DOI (another version) is allowed", cPre.status === 201, cPre.text);

  const doiVariants = ["https://doi.org/10.3390/signals7030053", "http://dx.doi.org/10.3390/SIGNALS7030053/", "https://dl.acm.org/doi/10.3390/signals7030053", "https://www.doi.org/10.3390/signals7030053?utm_source=x"];
  const doiResults = await Promise.all(doiVariants.map((u) => AL.post("/api/publications", pubBody("A completely different title " + u.length, 2020, u))));
  t("publication create: the same canonical DOI in any URL form is refused (409, kind publication-doi)", doiResults.every((r) => isConflict(r, "publication-doi")), doiResults.map((r) => r.status).join());
  t("publication create: a DOI duplicate names the existing publication and is NOT overridable", doiResults[0].json?.overridable === false && doiResults[0].json?.canOverride === false && doiResults[0].json?.candidates?.[0]?.id === j.json?.id);
  const doiForce = await MG.post("/api/publications", pubBody("Forced DOI duplicate", 2020, "https://doi.org/10.3390/signals7030053", { confirmDuplicate: true }));
  t("publication create: even a manager's confirmDuplicate cannot create a second record for one DOI", isConflict(doiForce, "publication-doi") && (await pubCount("Forced DOI duplicate")) === 0);

  const nodoi = await AL.post("/api/publications", pubBody("Deep Study of Things", 2025));
  t("publication create: a publication without a DOI is created (201)", nodoi.status === 201, nodoi.text);
  const likely = await AL.post("/api/publications", pubBody("deep   study of THINGS!", 2025));
  t("publication create: the same normalised title + year (no DOI) is flagged as a likely duplicate", isConflict(likely, "publication-title-year") && likely.json?.overridable === true, likely.text);
  t("publication create: a member is told they cannot override", likely.json?.canOverride === false);
  t("publication create: a member's confirmDuplicate is ignored (still 409)", isConflict(await AL.post("/api/publications", pubBody("Deep Study of Things", 2025, "", { confirmDuplicate: true })), "publication-title-year"));
  t("publication create: no record was created by the refused requests", (await pubCount("deep   study of THINGS!")) === 0);
  const mgrForce = await MG.post("/api/publications", pubBody("Deep Study of Things", 2025, "", { confirmDuplicate: true }));
  t("publication create: a manager can confirm a legitimate same title/year (201)", mgrForce.status === 201, mgrForce.text);
  t("publication create: the override is audited", (await auditFor(mgrForce.json?.id, "PUBLICATION_CREATED")).some((d) => d.duplicateOverride === "publication-title-year"));
  t("publication create: the same title in another year is allowed (recurring series)", (await AL.post("/api/publications", pubBody("Deep Study of Things", 2026))).status === 201);
  t("publication create: a DOI added to a title+year match with no DOI is still flagged", isConflict(await AL.post("/api/publications", pubBody("Deep Study of Things", 2025, "https://doi.org/10.1000/xyz123")), "publication-title-year"));

  // Updates
  const base = await AL.post("/api/publications", pubBody("Update Base One", 2024, "https://doi.org/10.5555/base.1"));
  const other = await AL.post("/api/publications", pubBody("Update Base Two", 2024, "https://doi.org/10.5555/base.2"));
  const clash = await AL.put(`/api/publications/${other.json?.id}`, { doiUrl: "http://dx.doi.org/10.5555/BASE.1" });
  t("publication edit: changing the DOI onto another publication's DOI is refused (409)", isConflict(clash, "publication-doi") && clash.json?.candidates?.[0]?.id === base.json?.id, clash.text);
  t("publication edit: the DOI is unchanged after the refusal", (await prisma.publication.findUnique({ where: { id: other.json?.id } }))?.doiUrl === "https://doi.org/10.5555/base.2");
  t("publication edit: the record itself is excluded (re-saving its own DOI in another URL form works)", (await AL.put(`/api/publications/${base.json?.id}`, { doiUrl: "https://dx.doi.org/10.5555/BASE.1" })).status === 200);
  const retitle = await AL.put(`/api/publications/${other.json?.id}`, { title: "update base ONE", year: 2024, doiUrl: "" });
  t("publication edit: retitling onto another publication's title/year (and dropping the DOI) is flagged", isConflict(retitle, "publication-title-year"), retitle.text);
  t("publication edit: a manager can confirm it", (await MG.put(`/api/publications/${other.json?.id}`, { title: "update base ONE", year: 2024, doiUrl: "", confirmDuplicate: true })).status === 200);
  t("publication edit: an edit that touches no compared field is never checked (venue only)", (await AL.put(`/api/publications/${base.json?.id}`, { venue: "New venue" })).status === 200);
  const tw1 = await prisma.publication.create({ data: { title: "Pre-existing Twin", year: 2019, authors: "x", venue: "v" } });
  const tw2 = await prisma.publication.create({ data: { title: "Pre-existing Twin", year: 2019, authors: "x", venue: "v" } });
  t("publication edit: an already-duplicated publication can still be edited for other fields", (await AL.put(`/api/publications/${tw1.id}`, { venue: "Edited" })).status === 200 && (await AL.put(`/api/publications/${tw2.id}`, { authors: "y" })).status === 200);
  t("publication edit: re-saving the unchanged duplicated title/year is allowed", (await AL.put(`/api/publications/${tw1.id}`, { title: "Pre-existing Twin", year: 2019 })).status === 200);
  t("publication edit: confirmDuplicate alone is 'Nothing to update.' (400)", (await MG.put(`/api/publications/${base.json?.id}`, { confirmDuplicate: true })).status === 400);
  t("publication edit: an unknown id is still 404", (await AL.put("/api/publications/clzzzzzzzzzzzzzzzzzzzzzzz", { title: "T" })).status === 404);

  // Concurrency
  const [p1, p2] = await Promise.all([AL.post("/api/publications", pubBody("Race Paper", 2023)), BO.post("/api/publications", pubBody("race  paper", 2023))]);
  t("publication create (concurrent): never two records for one title + year", [p1, p2].filter((r) => r.status === 201).length === 1 && ((await pubCount("Race Paper")) + (await pubCount("race  paper"))) === 1, `${p1.status}/${p2.status}`);
  t("publication create (concurrent): the loser gets the conflict or a retryable 503", [p1, p2].every((r) => r.status === 201 || r.status === 409 || r.status === 503), `${p1.status}/${p2.status}`);
}

// =====================================================================================================================================
// 3. NEWS
// =====================================================================================================================================
const newsBody = (title: string, date: string, sortDate: string, extra: Record<string, unknown> = {}) => ({ title, date, sortDate, type: "Paper", description: "Details", ...extra });
{
  const n1 = await AL.post("/api/news", newsBody("PhD positions available", "February 2025", "2025-02-01"));
  t("news create: the first item is created (201)", n1.status === 201, n1.text);
  const same = await AL.post("/api/news", newsBody("phd  POSITIONS available!", "february 2025", "2025-02-20"));
  t("news create: same title + same display date is flagged (409, news-title-date)", isConflict(same, "news-title-date") && same.json?.candidates?.[0]?.id === n1.json?.id, same.text);
  t("news create: same title + same sort date (different label) is flagged", isConflict(await AL.post("/api/news", newsBody("PhD positions available", "Feb 1, 2025", "2025-02-01")), "news-title-date"));
  t("news create: a recurring announcement on a different date is allowed", (await AL.post("/api/news", newsBody("PhD positions available", "February 2026", "2026-02-01"))).status === 201);
  t("news create: a different title on the same date is allowed", (await AL.post("/api/news", newsBody("Seminar announced", "February 2025", "2025-02-01"))).status === 201);
  t("news create: a member cannot override; a manager can", (await AL.post("/api/news", newsBody("PhD positions available", "February 2025", "2025-02-01", { confirmDuplicate: true }))).status === 409);
  const forced = await MG.post("/api/news", newsBody("PhD positions available", "February 2025", "2025-02-01", { confirmDuplicate: true }));
  t("news create: a manager can confirm (201) and it is audited", forced.status === 201 && (await auditFor(forced.json?.id, "NEWS_CREATED")).some((d) => d.duplicateOverride === "news-title-date"), forced.text);
  t("news create: no record was created by the refused requests", (await prisma.newsItem.count({ where: { title: "phd  POSITIONS available!" } })) === 0);

  const e = await AL.post("/api/news", newsBody("Edit Me", "March 2025", "2025-03-01"));
  const clash = await AL.put(`/api/news/${e.json?.id}`, { title: "PhD positions available", date: "February 2025", sortDate: "2025-02-01" });
  t("news edit: moving onto another item's title and date is flagged", isConflict(clash, "news-title-date") && clash.json?.candidates?.some((c: any) => c.id === n1.json?.id), clash.text);
  t("news edit: an edit that touches no compared field is never checked", (await AL.put(`/api/news/${e.json?.id}`, { description: "Changed" })).status === 200);
  t("news edit: the item itself is excluded (re-saving its own title/date works)", (await AL.put(`/api/news/${e.json?.id}`, { title: "edit me", date: "MARCH 2025" })).status === 200);
  t("news edit: a manager can confirm (200)", (await MG.put(`/api/news/${e.json?.id}`, { title: "PhD positions available", date: "February 2025", sortDate: "2025-02-01", confirmDuplicate: true })).status === 200);
  const tw1 = await prisma.newsItem.create({ data: { title: "Twin news", dateLabel: "May 2025", sortDate: "2025-05-01", type: "Paper", description: "d" } });
  await prisma.newsItem.create({ data: { title: "Twin news", dateLabel: "May 2025", sortDate: "2025-05-01", type: "Paper", description: "d" } });
  t("news edit: an already-duplicated item can still be edited for other fields", (await AL.put(`/api/news/${tw1.id}`, { description: "edited" })).status === 200);
  t("news edit: confirmDuplicate alone is 'Nothing to update.' (400)", (await MG.put(`/api/news/${tw1.id}`, { confirmDuplicate: true })).status === 400);
  const [r1, r2] = await Promise.all([AL.post("/api/news", newsBody("Race News", "June 2025", "2025-06-01")), BO.post("/api/news", newsBody("race news", "june 2025", "2025-06-02"))]);
  t("news create (concurrent): never two items for one title + date", [r1, r2].filter((x) => x.status === 201).length === 1 && [r1, r2].every((x) => [201, 409, 503].includes(x.status)), `${r1.status}/${r2.status}`);
}

// =====================================================================================================================================
// 4. RESEARCH AREAS
// =====================================================================================================================================
const areaBody = (title: string, tag: string, extra: Record<string, unknown> = {}) => ({ title, description: "Desc", tag, ...extra });
{
  const a1 = await AL.post("/api/research", areaBody("Artificial Intelligence & Machine Learning", "AI / ML"));
  t("research create: the first area is created (201)", a1.status === 201, a1.text);
  const sameTitle = await AL.post("/api/research", areaBody("artificial  intelligence and machine LEARNING?", "Other"));
  t("research create: '&' vs 'and' (plus case and punctuation) is the same normalised title", isConflict(sameTitle, "research-title"), sameTitle.text);
  const exact = await AL.post("/api/research", areaBody("ARTIFICIAL INTELLIGENCE  &  MACHINE LEARNING!", "Another"));
  t("research create: the same normalised title is flagged (409, research-title) and overridable", isConflict(exact, "research-title") && exact.json?.overridable === true && exact.json?.candidates?.[0]?.id === a1.json?.id, exact.text);
  const reordered = await AL.post("/api/research", areaBody("Machine Learning and Artificial Intelligence", "Another"));
  t("research create: the same words in another order is flagged (research-title)", isConflict(reordered, "research-title"), reordered.text);
  t("research create: the conflict shows the existing area's tag as context", exact.json?.candidates?.[0]?.detail === "AI / ML");
  const pair1 = await AL.post("/api/research", areaBody("ZZ Area Public", "ZZ"));
  const pair2 = await AL.post("/api/research", areaBody("ZZ Area Hidden", "ZZ"));
  t("research create: two areas that only share a tag and some words are both created (the repo's own fixture pairs)", pair1.status === 201 && pair2.status === 201, `${pair1.status}/${pair2.status}`);
  const sameTag = await AL.post("/api/research", areaBody("Reinforcement learning for robotics", "AI / ML"));
  t("research create: the same tag on a different topic is allowed (tags are shared labels, never a duplicate signal)", sameTag.status === 201, sameTag.text);
  t("research create: a longer title that merely contains an existing one is allowed", (await AL.post("/api/research", areaBody("Artificial Intelligence & Machine Learning Hardware", "AI / ML"))).status === 201);
  t("research create: a member cannot override; a manager can", (await AL.post("/api/research", areaBody("ARTIFICIAL INTELLIGENCE & MACHINE LEARNING", "x", { confirmDuplicate: true }))).status === 409);
  const forced = await MG.post("/api/research", areaBody("ARTIFICIAL INTELLIGENCE & MACHINE LEARNING", "x", { confirmDuplicate: true }));
  t("research create: a manager can confirm (201) and it is audited", forced.status === 201 && (await auditFor(forced.json?.id, "RESEARCH_CREATED")).some((d) => d.duplicateOverride === "research-title"), forced.text);

  const other = await AL.post("/api/research", areaBody("Quantum Sensing", "Quantum"));
  const clash = await AL.put(`/api/research/${other.json?.id}`, { title: "Reinforcement Learning for Robotics" });
  t("research edit: retitling onto another area is flagged", isConflict(clash, "research-title") && clash.json?.candidates?.[0]?.id === sameTag.json?.id, clash.text);
  t("research edit: the area itself is excluded (re-saving its own title in another case works)", (await AL.put(`/api/research/${other.json?.id}`, { title: "quantum  SENSING" })).status === 200);
  t("research edit: an edit that does not touch the title is never checked", (await AL.put(`/api/research/${other.json?.id}`, { description: "Changed" })).status === 200);
  t("research edit: a manager can confirm (200)", (await MG.put(`/api/research/${other.json?.id}`, { title: "Reinforcement Learning for Robotics", confirmDuplicate: true })).status === 200);
  const tw = await prisma.researchArea.create({ data: { title: "Twin area", description: "d", tag: "T" } });
  await prisma.researchArea.create({ data: { title: "Twin area", description: "d", tag: "T" } });
  t("research edit: an already-duplicated area can still be edited for other fields", (await AL.put(`/api/research/${tw.id}`, { description: "edited" })).status === 200);
  t("research edit: confirmDuplicate alone is 'Nothing to update.' (400)", (await MG.put(`/api/research/${tw.id}`, { confirmDuplicate: true })).status === 400);
  const [r1, r2] = await Promise.all([AL.post("/api/research", areaBody("Race Area", "R")), BO.post("/api/research", areaBody("race area", "R2"))]);
  t("research create (concurrent): never two areas for one title", [r1, r2].filter((x) => x.status === 201).length === 1 && [r1, r2].every((x) => [201, 409, 503].includes(x.status)), `${r1.status}/${r2.status}`);
}

// =====================================================================================================================================
// 5. Hygiene
// =====================================================================================================================================
{
  const conflict = await MG.post("/api/team", newProfile("Chiara Conti"));
  const keys = Object.keys(conflict.json ?? {}).sort().join(",");
  t("conflict body has exactly the documented fields", keys === "canOverride,candidates,code,error,kind,overridable", keys);
  const everyAudit = await prisma.auditLog.findMany();
  t("no audit row carries a password, token or session value", !everyAudit.some((r) => /passwordHash|tokenHash|sessionData/i.test(r.details ?? "")));
  t("the existing 404 for an unknown route is unchanged", (await ANON.get("/api/duplicates")).status === 404);
}
t("no request left loopback", offLoopback === 0, String(offLoopback));

server.close();
await prisma.$disconnect();
console.error = realError;
fs.rmSync(workDir, { recursive: true, force: true });
console.log(`${ok} duplicate-prevention checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
process.exit(0);
