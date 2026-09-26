/**
 * End-to-end API regression for the RESEARCH COLLABORATION WORKSPACE (Phase 21): GET /api/workspace,
 * the single-researcher membership writes (POST/PUT/DELETE /api/{projects,groups}/:id/members[/:tm]),
 * visibility propagation (through counts, collaborators, areas, events, news), privacy (no account ids,
 * e-mails, credentials, messages, notifications), locale independence, hostile input, audit and cleanup.
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:C:/abs/path/to/copy.db PORT=4021 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:C:/abs/path/to/copy.db API=http://localhost:4021 node scripts/workspace-regression.mjs
 *
 * Run it ONLY against a COPY of the database: it removes every audit row written during the run.
 * Fixtures are prefixed "ZZ P21" / p21test-*@example.test and are removed again (also at the start).
 *
 * Note on "hidden": a signed-in account sees LAB_ONLY rows, and a guest never reaches the workspace, so a
 * row that must vanish from a signed-in workspace is one whose `visibility` is not in the allow-list
 * (`visibleTo` is an allow-list on purpose). The suite flips fixtures to such a value to prove that lists,
 * counts, collaborators, areas, events and news all drop it together.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const API = process.env.API || "http://localhost:4001";
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };
const PW = "Str0ngPassw0rd!";
const prisma = new PrismaClient();
const RUN_STARTED = new Date(Date.now() - 2000);

let passed = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) passed++;
  else {
    failures.push(`${name}${detail ? ` -- ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}
const section = (t) => console.log(`\n# ${t}`);

class Client {
  cookie = "";
  async req(method, path, body, locale, extraHeaders = {}) {
    const res = await fetch(`${API}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...(locale !== undefined ? { "X-Locale": locale } : {}), ...extraHeaders },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      if (/^scl\.sid=;?$/.test(pair) || /Expires=Thu, 01 Jan 1970/i.test(c)) this.cookie = "";
      else if (pair.startsWith("scl.sid=")) this.cookie = pair;
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, type: res.headers.get("content-type") ?? "", cache: res.headers.get("cache-control") ?? "" };
  }
  get = (p, l) => this.req("GET", p, undefined, l);
  post = (p, b, l) => this.req("POST", p, b ?? {}, l);
  put = (p, b, l) => this.req("PUT", p, b ?? {}, l);
  del = (p, l) => this.req("DELETE", p, undefined, l);
  login = (email, password) => this.post("/auth/login", { email, password });
}

const idsOf = (list) => (Array.isArray(list) ? list.map((x) => x.id) : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function cleanup() {
  const like = { startsWith: "ZZ P21" };
  const areas = await prisma.researchArea.findMany({ where: { title: like }, select: { id: true } });
  const projects = await prisma.researchProject.findMany({ where: { title: like }, select: { id: true } });
  const groups = await prisma.researchGroup.findMany({ where: { name: like }, select: { id: true } });
  const news = await prisma.newsItem.findMany({ where: { title: like }, select: { id: true } });
  const members = await prisma.teamMember.findMany({ where: { name: like }, select: { id: true, userId: true } });
  const userIds = (await prisma.user.findMany({ where: { email: { startsWith: "p21test-" } }, select: { id: true } })).map((u) => u.id);
  for (const [entityType, rows] of [["RESEARCH_AREA", areas], ["RESEARCH_PROJECT", projects], ["RESEARCH_GROUP", groups], ["NEWS_ITEM", news], ["TEAM_MEMBER", members]]) {
    await prisma.translation.deleteMany({ where: { entityType, entityId: { in: rows.map((r) => r.id) } } });
  }
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.conversation.deleteMany({ where: { participants: { some: { userId: { in: userIds } } } } });
  await prisma.event.deleteMany({ where: { title: like } });
  await prisma.newsItem.deleteMany({ where: { title: like } });
  await prisma.publication.deleteMany({ where: { title: like } });
  await prisma.researchProject.deleteMany({ where: { title: like } });
  await prisma.researchGroup.deleteMany({ where: { name: like } });
  await prisma.researchArea.deleteMany({ where: { title: like } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "p21test-" } } }).catch(() => {});
  await prisma.teamMember.deleteMany({ where: { name: like } });
}

const counts = async () => ({
  areas: await prisma.researchArea.count(),
  projects: await prisma.researchProject.count(),
  groups: await prisma.researchGroup.count(),
  translations: await prisma.translation.count(),
  projectMembers: await prisma.projectMember.count(),
  groupMembers: await prisma.groupMember.count(),
  researcherAreas: await prisma.researcherArea.count(),
  members: await prisma.teamMember.count(),
  users: await prisma.user.count(),
  pubs: await prisma.publication.count(),
  news: await prisma.newsItem.count(),
  events: await prisma.event.count(),
  conversations: await prisma.conversation.count(),
  notifications: await prisma.notification.count(),
});

async function main() {
  await cleanup();
  const base = await counts();
  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);

  const mk = async (key, role, name) => {
    const email = `p21test-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "ZP", memberRole: "Researcher", category: "RESEARCH" });
    const client = new Client();
    await client.login(email, PW);
    const tm = await prisma.teamMember.findFirst({ where: { name } });
    return { client, id: r.json?.id, email, tm, status: r.status, role };
  };

  // ------------------------------------------------------------------
  section("fixtures");
  const guest = new Client();
  const mgr = await mk("mgr", "LAB_MANAGER", "ZZ P21 Manager");
  const lead = await mk("lead", "MEMBER", "ZZ P21 Lead");
  const memB = await mk("b", "MEMBER", "ZZ P21 Bob");
  const memC = await mk("c", "MEMBER", "ZZ P21 Carol");
  const lone = await mk("lone", "MEMBER", "ZZ P21 Lonely");
  const grp = await mk("grp", "MEMBER", "ZZ P21 GroupOnly"); // related to the lab ONLY through a group
  const ara = await mk("ara", "MEMBER", "ZZ P21 AreaOnly"); // related ONLY through a research area on their profile
  check("fixtures: seven accounts with profiles", [mgr, lead, memB, memC, lone, grp, ara].every((u) => u.status === 201 && u.tm));
  // An account with NO team profile (created directly; the API always creates both).
  const noProfEmail = "p21test-noprof@example.test";
  const noProfUser = await prisma.user.create({ data: { email: noProfEmail, passwordHash: await bcrypt.hash(PW, 4), role: "MEMBER" } });
  const noProf = { client: new Client(), id: noProfUser.id, email: noProfEmail };
  await noProf.client.login(noProfEmail, PW);
  const adminMe = (await admin.get("/auth/me")).json.user;
  const accountIds = [mgr.id, lead.id, memB.id, memC.id, lone.id, grp.id, ara.id, noProf.id, adminMe.id];
  const HOSTILE = `ZZ P21 <script>alert(1)</script><img src=x onerror=alert(2)> ${"W".repeat(90)}`;

  const aPub = (await mgr.client.post("/research", { title: "ZZ P21 Area Public", description: "Public area", tag: "ZZ", visibility: "PUBLIC" })).json;
  const aHid = (await mgr.client.post("/research", { title: "ZZ P21 Area Hidden", description: "Hidden area", tag: "ZZ", visibility: "LAB_ONLY" })).json;
  check("fixtures: areas", aPub?.id && aHid?.id);

  const mkProject = (slug, title, visibility, extra = {}) => prisma.researchProject.create({ data: { slug, title, visibility, summary: `${title} summary`, ...extra } });
  const gPub = await prisma.researchGroup.create({ data: { slug: "zz-p21-group-public", name: "ZZ P21 Group Public", visibility: "PUBLIC" } });
  const gLab = await prisma.researchGroup.create({ data: { slug: "zz-p21-group-lab", name: "ZZ P21 Group Lab", visibility: "LAB_ONLY" } });
  const P1 = await mkProject("zz-p21-p1", "ZZ P21 Project One", "PUBLIC", { groupId: gPub.id, status: "ACTIVE" });
  const P2 = await mkProject("zz-p21-p2", "ZZ P21 Project Lab", "LAB_ONLY", { groupId: gLab.id, status: "PLANNED" });
  const P3 = await mkProject("zz-p21-p3", HOSTILE, "PUBLIC", { status: "COMPLETED" });
  const P4 = await mkProject("zz-p21-p4", "ZZ P21 Project Standalone", "PUBLIC");
  const P5 = await mkProject("zz-p21-p5", "ZZ P21 Project Unrelated", "PUBLIC"); // no area, group or member: unrelated to everybody
  await prisma.projectArea.createMany({ data: [{ projectId: P1.id, researchAreaId: aPub.id }, { projectId: P1.id, researchAreaId: aHid.id }, { projectId: P2.id, researchAreaId: aHid.id }, { projectId: P2.id, researchAreaId: aPub.id }, { projectId: P4.id, researchAreaId: aPub.id }] });
  await prisma.projectMember.createMany({
    data: [
      { projectId: P1.id, teamMemberId: lead.tm.id, role: "LEAD" },
      { projectId: P1.id, teamMemberId: memB.tm.id, role: "MEMBER" },
      { projectId: P2.id, teamMemberId: lead.tm.id, role: "MEMBER" },
      { projectId: P2.id, teamMemberId: memB.tm.id, role: "LEAD" },
      { projectId: P3.id, teamMemberId: lead.tm.id, role: "MEMBER" },
    ],
  });
  await prisma.groupMember.createMany({
    data: [
      { groupId: gPub.id, teamMemberId: lead.tm.id, role: "LEAD" },
      { groupId: gPub.id, teamMemberId: memC.tm.id, role: "MEMBER" },
      { groupId: gLab.id, teamMemberId: memB.tm.id, role: "LEAD" },
      { groupId: gLab.id, teamMemberId: grp.tm.id, role: "MEMBER" },
    ],
  });
  await prisma.researcherArea.createMany({ data: [{ teamMemberId: lead.tm.id, researchAreaId: aPub.id }, { teamMemberId: memC.tm.id, researchAreaId: aPub.id }, { teamMemberId: memB.tm.id, researchAreaId: aHid.id }, { teamMemberId: ara.tm.id, researchAreaId: aHid.id }] });
  const mkPub = (title, visibility) => prisma.publication.create({ data: { title, year: 2031, authors: "ZZ", venue: "ZZ Venue", visibility } });
  const pubPub = await mkPub("ZZ P21 Pub Public", "PUBLIC");
  const pubLab = await mkPub("ZZ P21 Pub Lab", "LAB_ONLY");
  const pubMine = await mkPub("ZZ P21 Pub Authored", "PUBLIC");
  await prisma.projectPublication.createMany({ data: [{ projectId: P1.id, publicationId: pubPub.id }, { projectId: P1.id, publicationId: pubLab.id }] });
  await prisma.publicationAuthor.createMany({ data: [{ publicationId: pubMine.id, teamMemberId: lead.tm.id }, { publicationId: pubLab.id, teamMemberId: lead.tm.id }] });
  const mkNews = (title, visibility, projectId) => prisma.newsItem.create({ data: { title, description: `${title} text`, dateLabel: "Jan 2031", sortDate: "2031-01-01", type: "Update", visibility, projectId } });
  const nP1 = await mkNews("ZZ P21 News Project One", "PUBLIC", P1.id);
  const nLab = await mkNews("ZZ P21 News Lab", "LAB_ONLY", P1.id);
  const nUnrelated = await mkNews("ZZ P21 News Unrelated", "PUBLIC", P5.id);
  const startsAt = new Date(Date.now() + 48 * 3600_000);
  const mkEvent = (title, visibility, projectId) => prisma.event.create({ data: { title, visibility, projectId, startsAt, kind: "SEMINAR" } });
  const eP1 = await mkEvent("ZZ P21 Event P1", "PUBLIC", P1.id);
  const eLab = await mkEvent("ZZ P21 Event Lab", "LAB_ONLY", P1.id);
  const eP4 = await mkEvent("ZZ P21 Event Unrelated", "PUBLIC", P5.id);
  const ePast = await prisma.event.create({ data: { title: "ZZ P21 Event Past", visibility: "PUBLIC", projectId: P1.id, startsAt: new Date(Date.now() - 96 * 3600_000), endsAt: new Date(Date.now() - 95 * 3600_000), kind: "SEMINAR" } });
  const eNoProject = await mkEvent("ZZ P21 Event No Project", "PUBLIC", null);
  const eP2 = await mkEvent("ZZ P21 Event P2", "PUBLIC", P2.id); // P2: LAB_ONLY project in group gLab, area aHid
  const eP3 = await mkEvent("ZZ P21 Event P3", "PUBLIC", P3.id); // P3: no group, no area — only its members are related
  const nP2 = await mkNews("ZZ P21 News P2", "PUBLIC", P2.id);
  check("fixtures built", [P1, P2, P3, P4, P5, pubPub, nP1, eP1, ePast].every((x) => x?.id));

  const auditBefore = await prisma.auditLog.count();

  // ------------------------------------------------------------------
  section("access");
  const g0 = await guest.get("/workspace");
  check("guest -> 401, and the body names nothing", g0.status === 401 && !/ZZ P21/.test(g0.text));
  check("guest with hostile query/headers -> still 401", (await guest.get("/workspace?userId=" + lead.id + "&researcher=" + lead.tm.id, "ja")).status === 401);
  for (const [name, u] of [["member", lead], ["manager", mgr], ["admin-role"], ["no-profile member", noProf]]) {
    const c = u ? u.client : admin;
    const r = await c.get("/workspace");
    check(`${name} -> 200 JSON`, r.status === 200 && /json/.test(r.type) && r.json && typeof r.json === "object", String(r.status));
    check(`${name}: private, no-store`, /no-store/.test(r.cache) && /private/.test(r.cache));
  }
  check("only GET exists: POST/PUT/DELETE /workspace are not routes", (await lead.client.post("/workspace", {})).status === 404 && (await lead.client.put("/workspace", {})).status === 404 && (await lead.client.del("/workspace")).status === 404);

  // ------------------------------------------------------------------
  section("no linked profile / empty workspace");
  const np = (await noProf.client.get("/workspace")).json;
  check("no team profile -> profile null and every section empty (nothing invented)", np.profile === null && ["areas", "projects", "groups", "publications", "events", "news", "collaborators"].every((k) => np[k].items.length === 0 && np[k].total === 0));
  const before = await prisma.teamMember.count();
  await noProf.client.get("/workspace");
  check("… reading it never creates a TeamMember", (await prisma.teamMember.count()) === before);
  const emptyWs = (await lone.client.get("/workspace")).json;
  check("a researcher with no relationships -> profile present, sections empty", emptyWs.profile?.id === lone.tm.id && emptyWs.projects.total === 0 && emptyWs.collaborators.total === 0 && emptyWs.publications.items.length === 0);

  // ------------------------------------------------------------------
  section("populated workspace (member / project lead)");
  const L = await lead.client.get("/workspace");
  const w = L.json;
  check("profile is the caller's own public profile (id, name, initials, role only)", w.profile.id === lead.tm.id && w.profile.name === "ZZ P21 Lead" && Object.keys(w.profile).sort().join() === "id,initials,name,role");
  check("projects: exactly the ones the researcher belongs to (P1, P2, P3) — not P4", same(idsOf(w.projects.items).sort(), [P1.id, P2.id, P3.id].sort()) && w.projects.total === 3);
  const wp1 = w.projects.items.find((p) => p.id === P1.id);
  check("project card: status, group, areas, lead, counts, my role", wp1.status === "ACTIVE" && wp1.group?.id === gPub.id && idsOf(wp1.areas).length === 2 && wp1.leads[0]?.id === lead.tm.id && wp1.memberCount === 2 && wp1.myRole === "LEAD");
  check("project counts: 2 visible publications, 2 upcoming visible events (past + none excluded)", wp1.publicationCount === 2 && wp1.upcomingEventCount === 2, JSON.stringify(wp1));
  check("project ordering is (sortOrder, title, id): 'ZZ P21 <script' sorts by code unit", same(idsOf(w.projects.items), (await lead.client.get("/workspace")).json.projects.items.map((p) => p.id)));
  check("lead of P1 may manage its members; a plain member of P2 may not", wp1.canManageMembers === true && w.projects.items.find((p) => p.id === P2.id).canManageMembers === false);
  check("a LAB_ONLY group is shown to a signed-in member (group card)", w.groups.items.length === 1 && w.groups.items[0].id === gPub.id);
  const gp = w.groups.items[0];
  check("group card: leads, member/project/area counts, my role, manage flag", gp.leads[0]?.id === lead.tm.id && gp.memberCount === 2 && gp.projectCount === 1 && gp.areaCount === 2 && gp.myRole === "LEAD" && gp.canManageMembers === true, JSON.stringify(gp));
  check("areas: profile-linked and project-derived, with counts and the `linked` flag", same(idsOf(w.areas.items).sort(), [aPub.id, aHid.id].sort()) && w.areas.items.find((a) => a.id === aPub.id).linked === true && w.areas.items.find((a) => a.id === aHid.id).linked === false && w.areas.items.find((a) => a.id === aPub.id).researcherCount === 2 && w.areas.items.find((a) => a.id === aPub.id).projectCount === 3, JSON.stringify(w.areas.items));
  check("publications: only the researcher's authored ones (public + lab-only, both visible to a member)", same(idsOf(w.publications.items).sort(), [pubMine.id, pubLab.id].sort()) && w.publications.total === 2);
  check("events: upcoming, visible, of the researcher's related projects (P1, P2, P3) — not past, not unrelated, not project-less", same(idsOf(w.events.items).sort(), [eP1.id, eLab.id, eP2.id, eP3.id].sort()) && w.events.total === 4, JSON.stringify(idsOf(w.events.items)));
  check("news: of related projects (incl. LAB_ONLY for a member) — not unrelated projects", same(idsOf(w.news.items).sort(), [nP1.id, nLab.id, nP2.id].sort()) && !idsOf(w.news.items).includes(nUnrelated.id));
  check("collaborators: Bob (P1 + P2 + area none) and Carol (group + area) — never the caller", same(idsOf(w.collaborators.items).sort(), [memB.tm.id, memC.tm.id].sort()));
  const cb = w.collaborators.items.find((c) => c.id === memB.tm.id);
  const cc = w.collaborators.items.find((c) => c.id === memC.tm.id);
  check("collaborator shared counts are of DISTINCT projects/groups/areas", cb.sharedProjects === 2 && cb.sharedGroups === 0 && cb.sharedAreas === 0 && cc.sharedProjects === 0 && cc.sharedGroups === 1 && cc.sharedAreas === 1, JSON.stringify([cb, cc]));
  check("collaborator ordering: most shared first, then name (Bob 2 before Carol 2 by name)", idsOf(w.collaborators.items)[0] === memB.tm.id);
  check("collaborator fields are public profile fields only", w.collaborators.items.every((c) => Object.keys(c).sort().join() === "id,initials,name,role,sharedAreas,sharedGroups,sharedProjects"));
  check("a member gets NO `visibility` keys anywhere (only managers can act on it)", !/"visibility"/.test(L.text));

  // Each relationship path on its own, so dropping one branch of the "related projects" rule is visible.
  const GW = (await grp.client.get("/workspace")).json;
  check("group-only researcher: projects/areas/events/news come ONLY through the group (P2 via gLab)", GW.projects.total === 0 && same(idsOf(GW.events.items), [eP2.id]) && same(idsOf(GW.news.items), [nP2.id]) && GW.groups.total === 1 && GW.areas.total === 0, JSON.stringify([idsOf(GW.events.items), idsOf(GW.news.items)]));
  const AWs = (await ara.client.get("/workspace")).json;
  check("area-only researcher: events/news come ONLY through the area (aHid -> P1, P2)", AWs.projects.total === 0 && same(idsOf(AWs.events.items).sort(), [eP1.id, eLab.id, eP2.id].sort()) && same(idsOf(AWs.news.items).sort(), [nP1.id, nLab.id, nP2.id].sort()) && same(idsOf(AWs.areas.items), [aHid.id]) && AWs.areas.items[0].linked === true, JSON.stringify([idsOf(AWs.events.items)]));
  check("member-only path: lead sees P3's event (P3 has no group and no area)", idsOf(w.events.items).includes(eP3.id));
  check("collaborators come from the group / area too: Grp shares group gLab with Bob, and the area with Bob", (await grp.client.get("/workspace")).json.collaborators.items.map((c) => c.id).join() === memB.tm.id && same(idsOf((await ara.client.get("/workspace")).json.collaborators.items), [memB.tm.id]));

  // ------------------------------------------------------------------
  section("manager / admin: own workspace, extra visibility field only");
  const M = (await mgr.client.get("/workspace")).json;
  check("manager with no relationships -> an empty workspace of their OWN (no bypass, no other people's data)", M.profile.id === mgr.tm.id && M.projects.total === 0 && M.groups.total === 0 && M.collaborators.total === 0 && M.publications.total === 0);
  await prisma.projectMember.create({ data: { projectId: P1.id, teamMemberId: mgr.tm.id, role: "MEMBER" } });
  const M2 = await mgr.client.get("/workspace");
  check("… once they belong to a project it appears, with `visibility` (managers may act on it) and manage=true even as a plain member", M2.json.projects.items[0].id === P1.id && M2.json.projects.items[0].visibility === "PUBLIC" && M2.json.projects.items[0].canManageMembers === true);
  check("… and they see their project's collaborators, not everyone", idsOf(M2.json.collaborators.items).sort().join() === [lead.tm.id, memB.tm.id].sort().join());
  await prisma.projectMember.delete({ where: { projectId_teamMemberId: { projectId: P1.id, teamMemberId: mgr.tm.id } } });
  const AW = await admin.get("/workspace");
  check("admin (no linked profile in this DB) -> a valid empty workspace, not an error", AW.status === 200 && AW.json.profile === null);
  // The workspace cannot be pointed at anybody else.
  const spoof = await mgr.client.get(`/workspace?userId=${lead.id}&researcher=${lead.tm.id}&teamMemberId=${lead.tm.id}&limit=9999&page=-3`, "ja");
  check("query parameters (userId/researcher/limit/page) are ignored: still the manager's OWN workspace, never a 400/500", spoof.status === 200 && spoof.json.profile.id === mgr.tm.id && spoof.json.projects.total === 0);
  const spoofHdr = await mgr.client.req("GET", "/workspace", undefined, undefined, { "X-User-Id": lead.id, "X-Forwarded-User": lead.id });
  check("identity headers are ignored", spoofHdr.status === 200 && spoofHdr.json.profile.id === mgr.tm.id);

  // ------------------------------------------------------------------
  section("visibility propagation (counts, lists, collaborators, areas, events, news)");
  // A hidden PROJECT inside a still-visible group / on a still-visible area: the visible cards must not count it.
  await prisma.researchProject.update({ where: { id: P1.id }, data: { visibility: "PRIVATE" } });
  const HP = (await lead.client.get("/workspace")).json;
  check("hidden project inside a VISIBLE group: the group card's project count drops (1 -> 0) and so does its area count (2 -> 0)", HP.groups.items[0]?.id === gPub.id && HP.groups.items[0].projectCount === 0 && HP.groups.items[0].areaCount === 0 && !idsOf(HP.projects.items).includes(P1.id), JSON.stringify(HP.groups.items[0]));
  check("hidden project on a VISIBLE area: the area's project count drops (3 -> 2: P1 and P2 hidden? no, only P1 -> P2 + P4)", HP.areas.items.find((a) => a.id === aPub.id).projectCount === 2, JSON.stringify(HP.areas.items.find((a) => a.id === aPub.id)));
  await prisma.researchProject.update({ where: { id: P1.id }, data: { visibility: "PUBLIC" } });
  await prisma.researchArea.update({ where: { id: aHid.id }, data: { visibility: "PRIVATE" } });
  const HA = (await lead.client.get("/workspace")).json;
  check("hidden AREA inside a visible group: the group card's area count drops (2 -> 1)", HA.groups.items[0].areaCount === 1, JSON.stringify(HA.groups.items[0]));
  const BA = (await memB.client.get("/workspace")).json;
  check("a researcher who shares ONLY a now-hidden area is no longer a collaborator (Bob no longer sees Area-only via aHid)", !idsOf(BA.collaborators.items).includes(ara.tm.id));
  await prisma.researchArea.update({ where: { id: aHid.id }, data: { visibility: "LAB_ONLY" } });
  check("(control) …and is a collaborator again once the area is visible", idsOf((await memB.client.get("/workspace")).json.collaborators.items).includes(ara.tm.id) && idsOf((await memB.client.get("/workspace")).json.collaborators.items).includes(grp.tm.id));
  await prisma.researchGroup.update({ where: { id: gLab.id }, data: { visibility: "PRIVATE" } });
  const BG = (await memB.client.get("/workspace")).json;
  check("hidden GROUP: Bob's group list and collaborators-through-that-group (Group-only) both drop it", !idsOf(BG.groups.items).includes(gLab.id) && !idsOf(BG.collaborators.items).includes(grp.tm.id));
  await prisma.researchGroup.update({ where: { id: gLab.id }, data: { visibility: "LAB_ONLY" } });
  await prisma.researchProject.update({ where: { id: P2.id }, data: { visibility: "PRIVATE" } }); // not in the allow-list
  await prisma.publication.update({ where: { id: pubLab.id }, data: { visibility: "PRIVATE" } });
  await prisma.event.update({ where: { id: eLab.id }, data: { visibility: "PRIVATE" } });
  await prisma.newsItem.update({ where: { id: nLab.id }, data: { visibility: "PRIVATE" } });
  await prisma.researchArea.update({ where: { id: aHid.id }, data: { visibility: "PRIVATE" } });
  await prisma.researchGroup.update({ where: { id: gPub.id }, data: { visibility: "PRIVATE" } });
  const H = await lead.client.get("/workspace");
  const HW = H.json;
  check("hidden PROJECT is gone from the list and from the total", !idsOf(HW.projects.items).includes(P2.id) && HW.projects.total === 2);
  check("hidden PUBLICATION is gone from the list, the total and the project's publication count", !idsOf(HW.publications.items).includes(pubLab.id) && HW.publications.total === 1 && HW.projects.items.find((p) => p.id === P1.id).publicationCount === 1);
  check("hidden EVENT is gone from the list, the total and the project's event count; an event of a hidden PROJECT goes with it (eP2)", !idsOf(HW.events.items).includes(eLab.id) && !idsOf(HW.events.items).includes(eP2.id) && HW.events.total === 2 && HW.projects.items.find((p) => p.id === P1.id).upcomingEventCount === 1);
  check("hidden NEWS is gone", !idsOf(HW.news.items).includes(nLab.id) && !idsOf(HW.news.items).includes(nP2.id) && HW.news.total === 1);
  check("hidden AREA is gone from areas and from every project's area chips", !idsOf(HW.areas.items).includes(aHid.id) && HW.projects.items.every((p) => !idsOf(p.areas).includes(aHid.id)) && HW.areas.total === 1);
  check("hidden GROUP: no group card, and the project card carries group:null (its name/id is not sent)", HW.groups.total === 0 && HW.groups.items.length === 0 && HW.projects.items.find((p) => p.id === P1.id).group === null);
  check("hidden group / project / area no longer create collaborators: Carol (via group+area gPub/aPub) keeps only the visible area; Bob keeps P1", (() => {
    const c1 = HW.collaborators.items.find((c) => c.id === memB.tm.id);
    const c2 = HW.collaborators.items.find((c) => c.id === memC.tm.id);
    return c1 && c1.sharedProjects === 1 && c2 && c2.sharedGroups === 0 && c2.sharedAreas === 1;
  })());
  check("none of the hidden fixtures' text or ids appears anywhere in the response", ["ZZ P21 Project Lab", "ZZ P21 Pub Lab", "ZZ P21 Event Lab", "ZZ P21 News Lab", "ZZ P21 Area Hidden", "ZZ P21 Group Public", P2.id, pubLab.id, eLab.id, nLab.id, aHid.id, gPub.id].every((s) => !H.text.includes(s)));
  const HM = await mgr.client.get("/workspace");
  check("a manager's workspace applies the same allow-list", !/ZZ P21 (Project Lab|Pub Lab|Event Lab|News Lab|Area Hidden)/.test(HM.text));
  await prisma.researchProject.update({ where: { id: P2.id }, data: { visibility: "LAB_ONLY" } });
  await prisma.publication.update({ where: { id: pubLab.id }, data: { visibility: "LAB_ONLY" } });
  await prisma.event.update({ where: { id: eLab.id }, data: { visibility: "LAB_ONLY" } });
  await prisma.newsItem.update({ where: { id: nLab.id }, data: { visibility: "LAB_ONLY" } });
  await prisma.researchArea.update({ where: { id: aHid.id }, data: { visibility: "LAB_ONLY" } });
  await prisma.researchGroup.update({ where: { id: gPub.id }, data: { visibility: "PUBLIC" } });
  const back = (await lead.client.get("/workspace")).json;
  check("restoring visibility restores everything immediately (no cache)", back.projects.total === 3 && back.publications.total === 2 && back.events.total === 4 && back.groups.total === 1 && back.areas.total === 2);
  // hidden entities referenced through visible ones, via the public read endpoints
  const pubView = await guest.get(`/projects/${P2.id}`);
  check("(control) a LAB_ONLY project is still a 404 for a guest", pubView.status === 404 && !pubView.text.includes("Project Lab"));

  // ------------------------------------------------------------------
  section("bounded results, deterministic order");
  const many = [];
  for (let i = 0; i < 15; i++) many.push(await mkProject(`zz-p21-many-${String(i).padStart(2, "0")}`, `ZZ P21 Many ${String(i).padStart(2, "0")}`, "PUBLIC", { sortOrder: 100 + i }));
  await prisma.projectMember.createMany({ data: many.map((p) => ({ projectId: p.id, teamMemberId: lead.tm.id, role: "MEMBER" })) });
  const manyPubs = [];
  for (let i = 0; i < 8; i++) manyPubs.push(await mkPub(`ZZ P21 Pub Many ${i}`, "PUBLIC"));
  await prisma.publicationAuthor.createMany({ data: manyPubs.map((p) => ({ publicationId: p.id, teamMemberId: lead.tm.id })) });
  const crowd = [];
  crowd.push(await prisma.teamMember.create({ data: { name: "ZZ P21 AAA First Alphabetically", initials: "ZA", role: "Researcher", category: "RESEARCH" } }));
  for (let i = 0; i < 29; i++) crowd.push(await prisma.teamMember.create({ data: { name: `ZZ P21 Crowd ${String(i).padStart(2, "0")}`, initials: "ZC", role: "Researcher", category: "RESEARCH" } }));
  await prisma.projectMember.createMany({ data: crowd.map((c) => ({ projectId: many[0].id, teamMemberId: c.id, role: "MEMBER" })) });
  const B1 = (await lead.client.get("/workspace")).json;
  const B2 = (await lead.client.get("/workspace")).json;
  check("projects capped at 12 with the true total", B1.projects.items.length === 12 && B1.projects.total === 18, `${B1.projects.items.length}/${B1.projects.total}`);
  check("collaborators capped at 24 with the true total (30 crowd + Bob + Carol)", B1.collaborators.items.length === 24 && B1.collaborators.total === 32, `${B1.collaborators.items.length}/${B1.collaborators.total}`);
  check("publications capped at 6 with the true total (2 + 8)", B1.publications.items.length === 6 && B1.publications.total === 10, `${B1.publications.items.length}/${B1.publications.total}`);
  check("collaborators: most SHARED first even though a crowd member sorts alphabetically earlier (AAA has 1, Bob and Carol 2)", B1.collaborators.items[0].id === memB.tm.id && B1.collaborators.items[1].id === memC.tm.id && B1.collaborators.items.findIndex((c) => c.name.startsWith("ZZ P21 AAA")) > 1, JSON.stringify(B1.collaborators.items.slice(0, 3).map((c) => c.name)));
  check("two reads are byte-identical (deterministic order)", JSON.stringify(B1) === JSON.stringify(B2));
  check("the cap keeps the FIRST 12 by (sortOrder, title): the earliest 'many' projects come after sortOrder 0 ones", B1.projects.items.slice(0, 3).every((p) => [P1.id, P2.id, P3.id].includes(p.id)) && idsOf(B1.projects.items).slice(3, 12).join() === many.slice(0, 9).map((p) => p.id).join());
  check("crowd collaborators are ordered by name, ties broken deterministically", (() => {
    const crowdOnly = B1.collaborators.items.filter((c) => c.name.startsWith("ZZ P21 Crowd")).map((c) => c.name);
    return same(crowdOnly, [...crowdOnly].sort());
  })());
  await prisma.publicationAuthor.deleteMany({ where: { publicationId: { in: manyPubs.map((p) => p.id) } } });
  await prisma.publication.deleteMany({ where: { id: { in: manyPubs.map((p) => p.id) } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: many.map((p) => p.id) } } });
  await prisma.researchProject.deleteMany({ where: { id: { in: many.map((p) => p.id) } } });
  await prisma.teamMember.deleteMany({ where: { id: { in: crowd.map((c) => c.id) } } });

  // ------------------------------------------------------------------
  section("privacy: accounts, credentials, messages, notifications");
  const conv = await prisma.conversation.create({ data: { kind: "DIRECT", directKey: `p21-${memB.id}-${lead.id}`, lastMessageAt: new Date() } });
  await prisma.conversationParticipant.createMany({ data: [{ conversationId: conv.id, userId: memB.id }, { conversationId: conv.id, userId: lead.id }] });
  await prisma.message.create({ data: { conversationId: conv.id, senderId: memB.id, body: "ZZ P21 SECRET MESSAGE BODY" } });
  await prisma.notification.create({ data: { userId: memB.id, type: "MESSAGE", targetPath: "/messages", payload: JSON.stringify({ note: "ZZ P21 SECRET NOTIFICATION" }) } });
  const bodies = [];
  for (const [name, c] of [["lead", lead.client], ["member B", memB.client], ["manager", mgr.client], ["admin", admin], ["no profile", noProf.client]]) {
    const r = await c.get("/workspace");
    bodies.push(r.text);
    check(`${name}: no account id, e-mail, hash, session or storage path in the workspace`, !accountIds.some((id) => id && r.text.includes(id)) && !/passwordHash|@example\.test|admin@smartcomputinglab|"userId"|"email"|scl\.sid|storageKey|"password/i.test(r.text));
    check(`${name}: no message body and no notification payload`, !/SECRET (MESSAGE|NOTIFICATION)/.test(r.text) && !/conversation|"payload"|"targetPath"|"body"/.test(r.text));
  }
  check("(control) the manager and admin can NOT read that private conversation elsewhere either", (await mgr.client.get(`/messages/conversations/${conv.id}`)).status >= 400 && !(await admin.get("/messages/conversations")).text.includes("SECRET MESSAGE"));

  // ------------------------------------------------------------------
  section("locale independence");
  await prisma.translation.create({ data: { entityType: "RESEARCH_PROJECT", entityId: P1.id, locale: "ja", field: "title", value: "ZZ P21 日本語のプロジェクト名 " + "長".repeat(60) } });
  await prisma.translation.create({ data: { entityType: "RESEARCH_AREA", entityId: aPub.id, locale: "ja", field: "title", value: "ZZ P21 日本語の研究分野" } });
  await prisma.translation.create({ data: { entityType: "RESEARCH_GROUP", entityId: gPub.id, locale: "ja", field: "name", value: "ZZ P21 日本語のグループ" } });
  const localeReads = {};
  for (const [k, loc] of [["en", "en"], ["ja", "ja"], ["bad", "xx-<script>"], ["empty", ""], ["missing", undefined], ["upper", "JA"], ["tampered", "ja,en;q=0.1"]]) {
    localeReads[k] = await lead.client.get("/workspace", loc);
  }
  const shape = (r) => JSON.stringify({ p: idsOf(r.json.projects.items), g: idsOf(r.json.groups.items), a: idsOf(r.json.areas.items), pub: idsOf(r.json.publications.items), e: idsOf(r.json.events.items), n: idsOf(r.json.news.items), c: idsOf(r.json.collaborators.items), tot: [r.json.projects.total, r.json.groups.total, r.json.areas.total] });
  check("all locale variants -> 200 with IDENTICAL ids/totals (locale never changes what is shown)", Object.values(localeReads).every((r) => r.status === 200 && shape(r) === shape(localeReads.en)));
  check("ja: project title, area title and group name come back in Japanese", localeReads.ja.json.projects.items.find((p) => p.id === P1.id).title.includes("日本語のプロジェクト名") && localeReads.ja.json.areas.items.find((a) => a.id === aPub.id).title.includes("日本語の研究分野") && localeReads.ja.json.groups.items[0].name.includes("日本語のグループ") && localeReads.ja.json.projects.items.find((p) => p.id === P1.id).group.name.includes("日本語のグループ"));
  check("en / invalid / empty / missing / tampered locale -> the English base text", ["en", "bad", "empty", "missing", "tampered"].every((k) => localeReads[k].json.projects.items.find((p) => p.id === P1.id).title === "ZZ P21 Project One") && localeReads.upper.json.projects.items.find((p) => p.id === P1.id).title === "ZZ P21 Project One");
  check("authorization is locale-independent: guest 401 and no-profile empty, in every locale", (await Promise.all(["en", "ja", "zz", "", undefined].map((l) => guest.get("/workspace", l)))).every((r) => r.status === 401) && (await noProf.client.get("/workspace", "ja")).json.profile === null);
  check("membership writes are locale-independent (unauthorised stays 403 in ja)", (await memB.client.post(`/projects/${P4.id}/members`, { teamMemberId: memC.tm.id }, "ja")).status === 403);
  await prisma.translation.deleteMany({ where: { entityType: { in: ["RESEARCH_PROJECT", "RESEARCH_AREA", "RESEARCH_GROUP"] }, entityId: { in: [P1.id, aPub.id, gPub.id] } } });

  // ------------------------------------------------------------------
  section("hostile text is data");
  const HX = await lead.client.get("/workspace");
  check("the hostile project title is returned as plain JSON text (never markup)", /json/.test(HX.type) && HX.json.projects.items.some((p) => p.title === HOSTILE));
  check("… and never breaks the JSON or leaks into another field", HX.json.projects.items.filter((p) => p.title.includes("<script>")).length === 1);

  // ------------------------------------------------------------------
  section("membership writes: authorization matrix");
  const P = (id) => `/projects/${id}/members`;
  const G = (id) => `/groups/${id}/members`;
  const auditN = () => prisma.auditLog.count({ where: { action: { in: ["PROJECT_MEMBERS_CHANGED", "GROUP_MEMBERS_CHANGED"] }, createdAt: { gte: RUN_STARTED } } });
  let a0 = await auditN();
  const denied = [
    ["guest add", guest.post(P(P1.id), { teamMemberId: memC.tm.id }), 401],
    ["guest role", guest.put(`${P(P1.id)}/${memB.tm.id}`, { role: "LEAD" }), 401],
    ["guest remove", guest.del(`${P(P1.id)}/${memB.tm.id}`), 401],
    ["plain member (not a lead) add", memB.client.post(P(P1.id), { teamMemberId: memC.tm.id }), 403],
    ["plain member role change", memB.client.put(`${P(P1.id)}/${memB.tm.id}`, { role: "LEAD" }), 403],
    ["plain member removes ANOTHER member", memB.client.del(`${P(P1.id)}/${lead.tm.id}`), 403],
    ["plain member adds THEMSELVES as LEAD (self-escalation)", memC.client.post(P(P1.id), { teamMemberId: memC.tm.id, role: "LEAD" }), 403],
    ["project lead acting on a project they do NOT lead", lead.client.post(P(P4.id), { teamMemberId: memC.tm.id }), 403],
    ["project lead of P1 on group members (project lead != group lead there)", memB.client.post(G(gPub.id), { teamMemberId: memC.tm.id }), 403],
    ["member on an unknown project (no id probing: 403, same as a known one)", memB.client.post(P("nope-not-a-real-id"), { teamMemberId: memC.tm.id }), 403],
    ["lone member add to group", lone.client.post(G(gPub.id), { teamMemberId: lone.tm.id }), 403],
    ["no-profile account", noProf.client.post(P(P1.id), { teamMemberId: memC.tm.id }), 403],
  ];
  for (const [name, p, want] of denied) {
    const r = await p;
    check(`denied: ${name} -> ${want}`, r.status === want, String(r.status));
  }
  check("… nothing was written or audited by any denied request", (await auditN()) === a0 && (await prisma.projectMember.count({ where: { projectId: P1.id } })) === 2);
  check("no bulk form exists: DELETE / PUT-less collection routes are not routes", [(await lead.client.del(P(P1.id))).status, (await lead.client.del(`${P(P1.id)}/`)).status].every((s) => s === 404 || s === 405));

  const lastAudit = async (action, entityId) => {
    const rows = await prisma.auditLog.findMany({ where: { action, entityId, createdAt: { gte: RUN_STARTED } }, orderBy: { createdAt: "desc" }, take: 1 });
    return rows[0] ? { ...rows[0], d: JSON.parse(rows[0].details ?? "{}") } : null;
  };
  section("membership writes: project (lead, manager)");
  const bad = await lead.client.post(P(P1.id), { teamMemberId: "../../etc/passwd" });
  check("malformed team member id -> 400", bad.status === 400);
  check("missing / non-string / array body -> 400", (await lead.client.post(P(P1.id), {})).status === 400 && (await lead.client.post(P(P1.id), { teamMemberId: 5 })).status === 400 && (await lead.client.req("POST", P(P1.id), "[1]")).status === 400 && (await lead.client.req("POST", P(P1.id), "{nope")).status === 400);
  check("role outside the enum -> 400", (await lead.client.post(P(P1.id), { teamMemberId: memC.tm.id, role: "ADMIN" })).status === 400 && (await lead.client.post(P(P1.id), { teamMemberId: memC.tm.id, role: "lead" })).status === 400);
  check("unknown (well-formed) team member -> 400, exact message", (await lead.client.post(P(P1.id), { teamMemberId: "cmzzzzzzzzzzzzzzzzzzzzzzz" })).json?.error === "One or more team members do not exist.");
  check("malformed :teamMemberId in the path -> 400 (role + remove)", (await lead.client.put(`${P(P1.id)}/bad%20id`, { role: "LEAD" })).status === 400 && (await lead.client.del(`${P(P1.id)}/bad%20id`)).status === 400);
  const add = await lead.client.post(P(P1.id), { teamMemberId: memC.tm.id });
  check("lead adds Carol (default role MEMBER) -> 201", add.status === 201 && add.json.success === true);
  const prow = await prisma.projectMember.findUnique({ where: { projectId_teamMemberId: { projectId: P1.id, teamMemberId: memC.tm.id } } });
  check("… the join row exists with role MEMBER", prow?.role === "MEMBER");
  const addAudit = await lastAudit("PROJECT_MEMBERS_CHANGED", P1.id);
  check("adding a plain MEMBER is audited as added=<id>, leadChanged=false and the leads unchanged (only the LEAD rows count)", addAudit?.d.added === memC.tm.id && addAudit.d.leadChanged === false && addAudit.d.leads === lead.tm.id, JSON.stringify(addAudit?.d));
  check("… the project detail shows Carol; her workspace shows the project; collaborators update both ways", (await guest.get(`/projects/${P1.id}`)).json.members.some((m) => m.teamMemberId === memC.tm.id) && idsOf((await memC.client.get("/workspace")).json.projects.items).includes(P1.id) && (await lead.client.get("/workspace")).json.collaborators.items.find((c) => c.id === memC.tm.id).sharedProjects === 1);
  const dup = await lead.client.post(P(P1.id), { teamMemberId: memC.tm.id });
  check("duplicate add -> 409 with the exact message, exactly one row", dup.status === 409 && dup.json?.error === "That researcher is already a member." && (await prisma.projectMember.count({ where: { projectId: P1.id, teamMemberId: memC.tm.id } })) === 1);
  const roleUp = await lead.client.put(`${P(P1.id)}/${memC.tm.id}`, { role: "COLLABORATOR" });
  check("role change to COLLABORATOR -> 200, persisted", roleUp.status === 200 && (await prisma.projectMember.findUnique({ where: { projectId_teamMemberId: { projectId: P1.id, teamMemberId: memC.tm.id } } })).role === "COLLABORATOR");
  check("same role again -> 409 with the exact message (no silent no-op)", await (async () => { const r = await lead.client.put(`${P(P1.id)}/${memC.tm.id}`, { role: "COLLABORATOR" }); return r.status === 409 && r.json?.error === "That researcher already has this role."; })());
  check("role change for someone who is not a member -> 404, exact message", (await (async () => { const r = await lead.client.put(`${P(P1.id)}/${lone.tm.id}`, { role: "MEMBER" }); return r.status === 404 && r.json?.error === "That researcher is not a member."; })()));
  check("role change body must be valid -> 400", (await lead.client.put(`${P(P1.id)}/${memC.tm.id}`, { role: "OWNER" })).status === 400 && (await lead.client.put(`${P(P1.id)}/${memC.tm.id}`, {})).status === 400);
  // lead change: promote Carol to LEAD (by the lead), then the lead demotes themselves is allowed by Phase 9 too — we only assert the audit.
  const promote = await lead.client.put(`${P(P1.id)}/${memC.tm.id}`, { role: "LEAD" });
  const au = await lastAudit("PROJECT_MEMBERS_CHANGED", P1.id);
  check("promote to LEAD -> 200 and the audit row records leadChanged=true and the leads as ids", promote.status === 200 && au?.d.leadChanged === true && au.d.leads.split(",").includes(memC.tm.id) && au.actorEmail === lead.email);
  const rem = await lead.client.del(`${P(P1.id)}/${memC.tm.id}`);
  check("remove Carol -> 200, row gone, her workspace no longer lists the project", rem.status === 200 && !(await prisma.projectMember.findUnique({ where: { projectId_teamMemberId: { projectId: P1.id, teamMemberId: memC.tm.id } } })) && !idsOf((await memC.client.get("/workspace")).json.projects.items).includes(P1.id));
  const au2 = await lastAudit("PROJECT_MEMBERS_CHANGED", P1.id);
  check("remove is audited with the removed id (and no names of people, no text values)", au2?.d.removed === memC.tm.id && au2.d.added === "" && !/Carol/.test(au2.details));
  check("removing a non-member -> 404 with the exact message (missing relationship handled), nothing audited", await (async () => { const n = await auditN(); const r = await lead.client.del(`${P(P1.id)}/${memC.tm.id}`); return r.status === 404 && r.json?.error === "That researcher is not a member." && (await auditN()) === n; })());
  check("removing a member of another project with this project's URL -> 404", (await lead.client.del(`${P(P1.id)}/${lone.tm.id}`)).status === 404);
  const mAdd = await mgr.client.post(P(P4.id), { teamMemberId: lone.tm.id, role: "LEAD" });
  check("manager adds a LEAD to a project they are not in -> 201; that person may now manage it", mAdd.status === 201 && (await lone.client.post(P(P4.id), { teamMemberId: memC.tm.id })).status === 201);
  check("… and lost it again when removed by the manager", (await mgr.client.del(`${P(P4.id)}/${lone.tm.id}`)).status === 200 && (await lone.client.del(`${P(P4.id)}/${memC.tm.id}`)).status === 403);
  check("manager on an unknown project -> 404 (not 500); admin too", (await mgr.client.post(P("cmzzzzzzzzzzzzzzzzzzzzzzz"), { teamMemberId: memC.tm.id })).status === 404 && (await admin.post(P("cmzzzzzzzzzzzzzzzzzzzzzzz"), { teamMemberId: memC.tm.id })).status === 404);
  await mgr.client.del(`${P(P4.id)}/${memC.tm.id}`);

  section("membership writes: group");
  const gAdd = await lead.client.post(G(gPub.id), { teamMemberId: memB.tm.id });
  const gAddAudit = await lastAudit("GROUP_MEMBERS_CHANGED", gPub.id);
  check("group lead adds Bob -> 201; the audit says added=<id>, leadChanged=false, leads unchanged", gAdd.status === 201 && gAddAudit?.d.added === memB.tm.id && gAddAudit.d.leadChanged === false && gAddAudit.d.leads === lead.tm.id, JSON.stringify(gAddAudit?.d));
  check("group: duplicate -> 409, role -> 200, remove -> 200, again -> 404", (await lead.client.post(G(gPub.id), { teamMemberId: memB.tm.id })).status === 409 && (await lead.client.put(`${G(gPub.id)}/${memB.tm.id}`, { role: "LEAD" })).status === 200 && (await lead.client.del(`${G(gPub.id)}/${memB.tm.id}`)).status === 200 && (await lead.client.del(`${G(gPub.id)}/${memB.tm.id}`)).status === 404);
  const ga = await lastAudit("GROUP_MEMBERS_CHANGED", gPub.id);
  check("group audit row: GROUP_MEMBERS_CHANGED with `name`, ids only; removing a LEAD is leadChanged=true", ga && ga.entityType === "RESEARCH_GROUP" && ga.d.removed === memB.tm.id && "name" in ga.d && ga.d.leadChanged === true && ga.d.leads === lead.tm.id, JSON.stringify(ga?.d));
  check("group: promoting Carol to LEAD is audited with leadChanged=true and both leads listed", (await lead.client.put(`${G(gPub.id)}/${memC.tm.id}`, { role: "LEAD" })).status === 200 && await (async () => { const r = await lastAudit("GROUP_MEMBERS_CHANGED", gPub.id); return r.d.leadChanged === true && r.d.leads.split(",").sort().join() === [lead.tm.id, memC.tm.id].sort().join() && r.d.roleChanged === 1; })());
  await lead.client.put(`${G(gPub.id)}/${memC.tm.id}`, { role: "MEMBER" });
  check("group role enum excludes COLLABORATOR -> 400", (await lead.client.post(G(gPub.id), { teamMemberId: memB.tm.id, role: "COLLABORATOR" })).status === 400);
  check("a plain group member cannot manage; unknown group 403 for members, 404 for managers", (await memC.client.post(G(gPub.id), { teamMemberId: lone.tm.id })).status === 403 && (await memC.client.del(`${G(gPub.id)}/${memC.tm.id}`)).status === 403 && (await mgr.client.post(G("cmzzzzzzzzzzzzzzzzzzzzzzz"), { teamMemberId: lone.tm.id })).status === 404);
  check("group manager path: manager adds/removes without being a member", (await mgr.client.post(G(gLab.id), { teamMemberId: lone.tm.id })).status === 201 && (await mgr.client.del(`${G(gLab.id)}/${lone.tm.id}`)).status === 200);

  section("relationship consistency with the existing whole-set endpoint");
  const setAfter = await lead.client.put(`/projects/${P1.id}/members`, { members: [{ teamMemberId: lead.tm.id, role: "LEAD" }, { teamMemberId: memB.tm.id, role: "MEMBER" }, { teamMemberId: lone.tm.id, role: "MEMBER" }] });
  check("the Phase 9 PUT still works and sees rows the new endpoints wrote", setAfter.status === 200 && (await prisma.projectMember.count({ where: { projectId: P1.id } })) === 3);
  await prisma.projectMember.delete({ where: { projectId_teamMemberId: { projectId: P1.id, teamMemberId: lone.tm.id } } });

  // ------------------------------------------------------------------
  section("no role escalation through the workspace");
  const selfRole = await memB.client.put(`/users/${memB.id}`, { role: "ADMIN" });
  check("a member cannot change their own role (403)", selfRole.status === 403 && (await prisma.user.findUnique({ where: { id: memB.id } })).role === "MEMBER");
  const mgrSelf = await mgr.client.put(`/users/${mgr.id}`, { role: "ADMIN" });
  check("a lab manager cannot promote themselves (403)", mgrSelf.status === 403 && (await prisma.user.findUnique({ where: { id: mgr.id } })).role === "LAB_MANAGER");
  check("becoming a project LEAD grants no role: lead is still a MEMBER account", (await prisma.user.findUnique({ where: { id: lead.id } })).role === "MEMBER" && (await lead.client.get("/admin/overview")).status === 403);
  check("the workspace response carries no role field for anyone else", !/"role":"(ADMIN|LAB_MANAGER)"/.test((await lead.client.get("/workspace")).text));

  // ------------------------------------------------------------------
  section("deleted accounts / researchers");
  const ghost = await mk("ghost", "MEMBER", "ZZ P21 Ghost");
  await prisma.projectMember.create({ data: { projectId: P1.id, teamMemberId: ghost.tm.id, role: "MEMBER" } });
  check("(setup) Ghost appears among the lead's collaborators", idsOf((await lead.client.get("/workspace")).json.collaborators.items).includes(ghost.tm.id));
  const delUser = await admin.del(`/users/${ghost.id}`);
  const afterDelUser = await lead.client.get("/workspace");
  check("deleting Ghost's ACCOUNT keeps the public profile as a collaborator (relations are to the profile), and the old session is dead", delUser.status === 200 && idsOf(afterDelUser.json.collaborators.items).includes(ghost.tm.id) && (await ghost.client.get("/workspace")).status === 401 && !afterDelUser.text.includes(ghost.id));
  const delTm = await admin.del(`/team/${ghost.tm.id}`);
  check("deleting the PROFILE removes them from collaborators and counts", delTm.status === 200 && !idsOf((await lead.client.get("/workspace")).json.collaborators.items).includes(ghost.tm.id));
  const orphan = await mk("orphan", "MEMBER", "ZZ P21 Orphan");
  const delOwn = await admin.del(`/team/${orphan.tm.id}`);
  const ow = await orphan.client.get("/workspace");
  check("an account whose profile was deleted gets the no-profile empty workspace, not an error", delOwn.status === 200 && ow.status === 200 && ow.json.profile === null);

  // ------------------------------------------------------------------
  section("audit hygiene");
  const rows = await prisma.auditLog.findMany({ where: { createdAt: { gte: RUN_STARTED } } });
  check("membership writes were audited", rows.filter((r) => /_MEMBERS_CHANGED$/.test(r.action)).length >= 8);
  check("reads are not audited: 60+ workspace GETs added no workspace/read audit rows", !rows.some((r) => /WORKSPACE/i.test(r.action)));
  check("no audit row holds a password, hash, token, message body or translated text", rows.every((r) => !/passwordHash|ChangeMe|Str0ngPassw0rd|SECRET|日本語/.test(r.details ?? "")));
  check("membership audit details are flat ids/counts/booleans", rows.filter((r) => /_MEMBERS_CHANGED$/.test(r.action) && r.actorEmail.startsWith("p21test-")).every((r) => { const d = JSON.parse(r.details ?? "{}"); return Object.values(d).every((v) => ["string", "number", "boolean"].includes(typeof v)); }));
  void auditBefore;

  // ------------------------------------------------------------------
  section("cleanup");
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: RUN_STARTED } } });
  await cleanup();
  const after = await counts();
  check("database is back to its starting row counts", same(base, after), JSON.stringify({ base, after }));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:\n - " + failures.join("\n - "));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("Script crashed:", e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
