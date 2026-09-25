/**
 * End-to-end API regression for RESEARCH & PROJECT MANAGEMENT (Phase 18): the research graph
 * (Area -> Project -> Group -> Researcher) read models, the two new relationship writes, visibility
 * propagation, search, audit, locale independence and hostile input.
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:C:/abs/path/to/copy.db PORT=4058 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:C:/abs/path/to/copy.db API=http://localhost:4058 node scripts/research-regression.mjs
 *
 * Run it ONLY against a COPY of the database: it removes every audit row written during the run.
 * Fixtures are prefixed "ZZ P18" / p18test-*@example.test and are removed again (also at the start, in
 * case a previous run was interrupted). It never touches a row it did not create.
 */
import { PrismaClient } from "@prisma/client";

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
  async req(method, path, body, locale) {
    const res = await fetch(`${API}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...(locale ? { "X-Locale": locale } : {}) },
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
    return { status: res.status, json, text, type: res.headers.get("content-type") ?? "" };
  }
  get = (p, l) => this.req("GET", p, undefined, l);
  post = (p, b, l) => this.req("POST", p, b ?? {}, l);
  put = (p, b, l) => this.req("PUT", p, b ?? {}, l);
  del = (p, l) => this.req("DELETE", p, undefined, l);
  login = (email, password) => this.post("/auth/login", { email, password });
}

const idsOf = (list) => (Array.isArray(list) ? list.map((x) => x.id) : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortedIds = (list) => idsOf(list).sort();

async function cleanup() {
  const areas = await prisma.researchArea.findMany({ where: { title: { startsWith: "ZZ P18" } }, select: { id: true } });
  const projects = await prisma.researchProject.findMany({ where: { title: { startsWith: "ZZ P18" } }, select: { id: true } });
  const groups = await prisma.researchGroup.findMany({ where: { name: { startsWith: "ZZ P18" } }, select: { id: true } });
  const news = await prisma.newsItem.findMany({ where: { title: { startsWith: "ZZ P18" } }, select: { id: true } });
  const events = await prisma.event.findMany({ where: { title: { startsWith: "ZZ P18" } }, select: { id: true } });
  const members = await prisma.teamMember.findMany({ where: { name: { startsWith: "ZZ P18" } }, select: { id: true } });
  const tr = [
    ["RESEARCH_AREA", areas],
    ["RESEARCH_PROJECT", projects],
    ["RESEARCH_GROUP", groups],
    ["NEWS_ITEM", news],
    ["EVENT", events],
    ["TEAM_MEMBER", members],
  ];
  for (const [entityType, rows] of tr) await prisma.translation.deleteMany({ where: { entityType, entityId: { in: rows.map((r) => r.id) } } });
  await prisma.event.deleteMany({ where: { title: { startsWith: "ZZ P18" } } });
  await prisma.newsItem.deleteMany({ where: { title: { startsWith: "ZZ P18" } } });
  await prisma.publication.deleteMany({ where: { title: { startsWith: "ZZ P18" } } });
  await prisma.researchProject.deleteMany({ where: { title: { startsWith: "ZZ P18" } } });
  await prisma.researchGroup.deleteMany({ where: { name: { startsWith: "ZZ P18" } } });
  await prisma.researchArea.deleteMany({ where: { title: { startsWith: "ZZ P18" } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "p18test-" } } }).catch(() => {});
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: "ZZ P18" } } });
}

async function main() {
  await cleanup();
  const base = {
    areas: await prisma.researchArea.count(),
    projects: await prisma.researchProject.count(),
    groups: await prisma.researchGroup.count(),
    translations: await prisma.translation.count(),
    researcherAreas: await prisma.researcherArea.count(),
    members: await prisma.teamMember.count(),
  };

  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);

  const mk = async (key, role, name) => {
    const email = `p18test-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "ZP", memberRole: "Researcher", category: "RESEARCH" });
    const client = new Client();
    await client.login(email, PW);
    const tm = await prisma.teamMember.findFirst({ where: { name } });
    return { client, id: r.json?.id, email, tm, status: r.status };
  };

  // ------------------------------------------------------------------
  section("fixtures");
  const guest = new Client();
  const mgr = await mk("mgr", "LAB_MANAGER", "ZZ P18 Manager");
  const lead = await mk("lead", "MEMBER", "ZZ P18 Lead");
  const memB = await mk("b", "MEMBER", "ZZ P18 Bob");
  const memC = await mk("c", "MEMBER", "ZZ P18 Carol");
  check("fixtures: four accounts created with profiles", [mgr, lead, memB, memC].every((u) => u.status === 201 && u.tm));
  const accountIds = [mgr, lead, memB, memC].map((u) => u.id);
  const adminMe = (await admin.get("/auth/me")).json.user;
  accountIds.push(adminMe.id);

  const aPub = (await mgr.client.post("/research", { title: "ZZ P18 Area Public", description: "Public area ZZAPUB", tag: "ZZ", visibility: "PUBLIC" })).json;
  const aHid = (await mgr.client.post("/research", { title: "ZZ P18 Area Hidden", description: "Hidden area ZZAHID", tag: "ZZ", visibility: "LAB_ONLY" })).json;
  check("fixtures: areas created", aPub?.id && aHid?.id);

  const mkProject = (slug, title, visibility, extra = {}) => prisma.researchProject.create({ data: { slug, title, visibility, summary: `${title} summary`, ...extra } });
  const gPub = await prisma.researchGroup.create({ data: { slug: "zz-p18-group-public", name: "ZZ P18 Group Public", visibility: "PUBLIC", description: "public group" } });
  const gHid = await prisma.researchGroup.create({ data: { slug: "zz-p18-group-hidden", name: "ZZ P18 Group Hidden", visibility: "LAB_ONLY" } });
  const P1 = await mkProject("zz-p18-p1", "ZZ P18 Project One", "PUBLIC", { groupId: gPub.id, status: "ACTIVE" });
  const P2 = await mkProject("zz-p18-p2", "ZZ P18 Project Hidden", "LAB_ONLY", { groupId: gPub.id });
  const P3 = await mkProject("zz-p18-p3", "ZZ P18 Project In Hidden Group", "PUBLIC", { groupId: gHid.id, status: "COMPLETED" });
  const P4 = await mkProject("zz-p18-p4", "ZZ P18 Project Standalone", "PUBLIC", { status: "PLANNED" });

  await prisma.projectArea.createMany({
    data: [
      { projectId: P1.id, researchAreaId: aPub.id },
      { projectId: P1.id, researchAreaId: aHid.id },
      { projectId: P2.id, researchAreaId: aPub.id },
      { projectId: P3.id, researchAreaId: aHid.id },
      { projectId: P4.id, researchAreaId: aPub.id },
    ],
  });
  await prisma.projectMember.createMany({
    data: [
      { projectId: P1.id, teamMemberId: lead.tm.id, role: "LEAD" },
      { projectId: P1.id, teamMemberId: memB.tm.id, role: "MEMBER" },
      { projectId: P2.id, teamMemberId: memB.tm.id, role: "LEAD" },
    ],
  });
  await prisma.groupMember.createMany({
    data: [
      { groupId: gPub.id, teamMemberId: lead.tm.id, role: "LEAD" },
      { groupId: gPub.id, teamMemberId: memC.tm.id, role: "MEMBER" },
      { groupId: gHid.id, teamMemberId: memB.tm.id, role: "LEAD" },
    ],
  });
  await prisma.researcherArea.createMany({
    data: [
      { teamMemberId: lead.tm.id, researchAreaId: aPub.id },
      { teamMemberId: lead.tm.id, researchAreaId: aHid.id },
      { teamMemberId: memB.tm.id, researchAreaId: aHid.id },
    ],
  });
  const mkPub = (title, visibility) => prisma.publication.create({ data: { title, year: 2031, authors: "ZZ", venue: "ZZ Venue", visibility } });
  const pubPub = await mkPub("ZZ P18 Pub Public", "PUBLIC");
  const pubHid = await mkPub("ZZ P18 Pub Hidden", "LAB_ONLY");
  const pubOnlyP2 = await mkPub("ZZ P18 Pub Only On Hidden Project", "PUBLIC");
  await prisma.projectPublication.createMany({
    data: [
      { projectId: P1.id, publicationId: pubPub.id },
      { projectId: P1.id, publicationId: pubHid.id },
      { projectId: P2.id, publicationId: pubPub.id },
      { projectId: P2.id, publicationId: pubOnlyP2.id },
      { projectId: P3.id, publicationId: pubPub.id },
    ],
  });
  const mkNews = (title, visibility, projectId) => prisma.newsItem.create({ data: { title, description: `${title} text`, dateLabel: "Jan 2031", sortDate: "2031-01-01", type: "Update", visibility, projectId } });
  const nPub = await mkNews("ZZ P18 News Public", "PUBLIC", P1.id);
  const nHid = await mkNews("ZZ P18 News Hidden", "LAB_ONLY", P1.id);
  const nP2 = await mkNews("ZZ P18 News On Hidden Project", "PUBLIC", P2.id);
  const startsAt = new Date(Date.now() + 48 * 3600_000);
  const mkEvent = (title, visibility, projectId, createdById) => prisma.event.create({ data: { title, visibility, projectId, createdById: createdById ?? null, startsAt, kind: "SEMINAR" } });
  const ePub = await mkEvent("ZZ P18 Event Public", "PUBLIC", P1.id, lead.id);
  const eHid = await mkEvent("ZZ P18 Event Hidden", "LAB_ONLY", P1.id);
  const eP2 = await mkEvent("ZZ P18 Event On Hidden Project", "PUBLIC", P2.id);
  const eOrg = await mkEvent("ZZ P18 Event Organised No Project", "PUBLIC", null, lead.id);
  const eOrgHidProj = await mkEvent("ZZ P18 Event Organised On Hidden Project", "PUBLIC", P2.id, lead.id);

  const HIDDEN_WORDS = ["ZZ P18 Area Hidden", "ZZ P18 Project Hidden", "ZZ P18 Group Hidden", "ZZ P18 Pub Hidden", "ZZ P18 News Hidden", "ZZ P18 Event Hidden", "ZZ P18 Pub Only On Hidden Project", "ZZ P18 News On Hidden Project", "ZZ P18 Event On Hidden Project"];
  // Search matches an entity by its OWN columns only (Phase 10), so a PUBLIC publication/news/event is findable even if its project is hidden; only rows hidden by their OWN visibility must never appear.
  const HIDDEN_OWN = ["ZZ P18 Area Hidden", "ZZ P18 Project Hidden", "ZZ P18 Group Hidden", "ZZ P18 Pub Hidden", "ZZ P18 News Hidden", "ZZ P18 Event Hidden"];
  const searchLeaks = (r) => HIDDEN_OWN.filter((w) => r.text.includes(w));
  const leaks = (r) => HIDDEN_WORDS.filter((w) => r.text.includes(w));
  const noAccountIds = (r) => !accountIds.some((id) => id && r.text.includes(id)) && !/passwordHash|@example\.test|"userId"/.test(r.text);

  // ------------------------------------------------------------------
  section("research area detail: guest sees only public structure");
  const gA = await guest.get(`/research/${aPub.id}`);
  check("guest: area detail 200 with the documented shape", gA.status === 200 && gA.json.id === aPub.id && Array.isArray(gA.json.projects) && Array.isArray(gA.json.researchers) && Array.isArray(gA.json.publications) && Array.isArray(gA.json.news) && Array.isArray(gA.json.events));
  check("guest: projects = only the PUBLIC ones (P1, P4), not the hidden P2", same(sortedIds(gA.json.projects), [P1.id, P4.id].sort()));
  check("guest: publications = only public ones of visible projects (hidden pub + pub only on hidden project absent)", same(idsOf(gA.json.publications), [pubPub.id]));
  check("guest: news = only public news of visible projects", same(idsOf(gA.json.news), [nPub.id]));
  check("guest: events = only public events of visible projects", same(idsOf(gA.json.events), [ePub.id]));
  check("guest: researchers = the visible-area researchers (lead only; hidden-area links are not mine)", same(idsOf(gA.json.researchers), [lead.tm.id]));
  check("guest: NO hidden title anywhere in the area response", leaks(gA).length === 0, leaks(gA).join("|"));
  check("guest: no account id / email / userId in the area response", noAccountIds(gA));
  check("guest: visibility field absent for a guest", gA.json.visibility === undefined);
  check("guest: canEdit false, canDelete false, canManageResearchers false", gA.json.canEdit === false && gA.json.canDelete === false && gA.json.canManageResearchers === false);
  check("guest: project entries carry status + summary and no visibility", gA.json.projects.every((p) => p.status && typeof p.summary === "string" && p.visibility === undefined));

  section("research area detail: hidden area is a 404 identical to a missing one");
  const gHidA = await guest.get(`/research/${aHid.id}`);
  const gMissA = await guest.get("/research/doesnotexist");
  check("guest: hidden area 404, body identical to a missing id", gHidA.status === 404 && gMissA.status === 404 && gHidA.text === gMissA.text);
  check("guest: hidden area title not in the 404", !gHidA.text.includes("ZZ P18"));
  check("guest: malformed id 400", (await guest.get("/research/bad%20id!")).status === 400 && (await guest.get(`/research/${"a".repeat(100)}`)).status === 400);
  check("guest: hidden area absent from the list", !idsOf((await guest.get("/research")).json).includes(aHid.id));

  section("research area detail: members and managers");
  const mA = await memB.client.get(`/research/${aPub.id}`);
  check("member: sees the LAB_ONLY project, its publication, news and event", sortedIds(mA.json.projects).includes(P2.id) && idsOf(mA.json.publications).includes(pubOnlyP2.id) && idsOf(mA.json.publications).includes(pubHid.id) && idsOf(mA.json.news).includes(nHid.id) && idsOf(mA.json.events).includes(eHid.id));
  check("member: no visibility field, canEdit true, canDelete false, canManageResearchers false", mA.json.visibility === undefined && mA.json.canEdit === true && mA.json.canDelete === false && mA.json.canManageResearchers === false);
  check("member: no account ids in the response", noAccountIds(mA));
  const mgA = await mgr.client.get(`/research/${aHid.id}`);
  check("manager: hidden area 200, visibility present, all three flags true", mgA.status === 200 && mgA.json.visibility === "LAB_ONLY" && mgA.json.canEdit && mgA.json.canDelete && mgA.json.canManageResearchers);
  check("member: hidden area 200 (LAB_ONLY is for signed-in users)", (await memB.client.get(`/research/${aHid.id}`)).status === 200);

  // ------------------------------------------------------------------
  section("project detail: events + visibility propagation");
  const gP1 = await guest.get(`/projects/${P1.id}`);
  check("guest: project detail has events = only the public one", gP1.status === 200 && same(idsOf(gP1.json.events), [ePub.id]));
  check("guest: hidden area title absent from a PUBLIC project's areas", same(idsOf(gP1.json.areas), [aPub.id]) && !gP1.text.includes("ZZ P18 Area Hidden"));
  check("guest: publications/news of the public project exclude the hidden ones", same(idsOf(gP1.json.publications), [pubPub.id]) && same(idsOf(gP1.json.news), [nPub.id]));
  check("guest: project with a HIDDEN group reports group null and never names it", (await guest.get(`/projects/${P3.id}`)).json.group === null && !(await guest.get(`/projects/${P3.id}`)).text.includes("ZZ P18 Group Hidden"));
  check("guest: event carries its own project ref (visible one) only", gP1.json.events.every((e) => e.project?.id === P1.id));
  check("guest: hidden project 404 identical to missing", (await guest.get(`/projects/${P2.id}`)).status === 404 && (await guest.get(`/projects/${P2.id}`)).text === (await guest.get("/projects/doesnotexist")).text);
  check("guest: no account ids in project detail", noAccountIds(gP1));
  check("guest: project detail leaks no hidden word", leaks(gP1).length === 0, leaks(gP1).join("|"));
  const mP1 = await memB.client.get(`/projects/${P1.id}`);
  check("member: project events include the LAB_ONLY one; areas include the hidden area", idsOf(mP1.json.events).includes(eHid.id) && idsOf(mP1.json.areas).includes(aHid.id));
  const listG = await guest.get("/projects");
  check("guest: /projects list exposes no hidden project, area or group", !idsOf(listG.json).includes(P2.id) && leaks(listG).length === 0, leaks(listG).join("|"));
  check("project list still carries status for every card", listG.json.every((p) => ["PLANNED", "ACTIVE", "COMPLETED", "ARCHIVED"].includes(p.status)));
  check("the lead is the first member and is marked LEAD", mP1.json.members[0].role === "LEAD" && mP1.json.members[0].teamMemberId === lead.tm.id);
  check("project detail canEdit: lead true, plain member false, guest false", mP1.json.canEdit === false && (await lead.client.get(`/projects/${P1.id}`)).json.canEdit === true && gP1.json.canEdit === false);

  // ------------------------------------------------------------------
  section("group detail: derived structure, hidden entities never leak");
  const gG = await guest.get(`/groups/${gPub.id}`);
  check("guest: group projects = only public ones (P1, not P2)", gG.status === 200 && same(idsOf(gG.json.projects), [P1.id]) && gG.json.projectCount === 1);
  check("guest: group areas = visible areas of visible projects (aPub only)", same(idsOf(gG.json.areas), [aPub.id]));
  check("guest: group publications/news/events are those of visible projects only", same(idsOf(gG.json.publications), [pubPub.id]) && same(idsOf(gG.json.news), [nPub.id]) && same(idsOf(gG.json.events), [ePub.id]));
  check("guest: group response leaks no hidden word and no account id", leaks(gG).length === 0 && noAccountIds(gG), leaks(gG).join("|"));
  check("guest: lead listed first with role LEAD", gG.json.members[0].role === "LEAD" && gG.json.members[0].teamMemberId === lead.tm.id);
  check("guest: hidden group 404 identical to missing", (await guest.get(`/groups/${gHid.id}`)).status === 404 && (await guest.get(`/groups/${gHid.id}`)).text === (await guest.get("/groups/doesnotexist")).text);
  const mG = await memB.client.get(`/groups/${gPub.id}`);
  check("member: group sees the hidden project and its outputs", idsOf(mG.json.projects).includes(P2.id) && mG.json.projectCount === 2 && idsOf(mG.json.publications).includes(pubOnlyP2.id) && idsOf(mG.json.events).includes(eP2.id));
  check("member: group areas do not include a hidden area unless a visible project uses it (member sees all)", idsOf(mG.json.areas).includes(aHid.id));
  const gGl = await guest.get("/groups");
  check("guest: group list count excludes hidden projects", gGl.json.find((g) => g.id === gPub.id).projectCount === 1);

  // ------------------------------------------------------------------
  section("researcher profile: areas + events");
  const gM = await guest.get(`/member/${lead.tm.id}`);
  check("guest: profile areas = visible ones only", gM.status === 200 && same(idsOf(gM.json.areas), [aPub.id]) && !gM.text.includes("ZZ P18 Area Hidden"));
  check("guest: profile events = PUBLIC events they organised + PUBLIC events of visible projects; the LAB_ONLY one and the hidden project's own event are absent", same(sortedIds(gM.json.events), [ePub.id, eOrg.id, eOrgHidProj.id].sort()));
  check("guest: a public event organised by this person whose project is hidden shows project=null (never the hidden title)", gM.json.events.find((e) => e.id === eOrgHidProj.id)?.project === null && !gM.text.includes("ZZ P18 Project Hidden"));
  check("guest: profile projects/groups exclude hidden ones", same(idsOf(gM.json.projects), [P1.id]) && same(idsOf(gM.json.groups), [gPub.id]));
  const gB = await guest.get(`/member/${memB.tm.id}`);
  check("guest: the profile of someone who belongs to a HIDDEN project neither lists that project nor its (public) event", gB.status === 200 && !idsOf(gB.json.projects).includes(P2.id) && !idsOf(gB.json.events).includes(eP2.id) && !gB.text.includes("ZZ P18 Project Hidden"));
  check("guest: profile leaks no hidden word / account id", noAccountIds(gM) && !["ZZ P18 Area Hidden", "ZZ P18 Project Hidden", "ZZ P18 Event Hidden"].some((w) => gM.text.includes(w)));
  const mM = await memB.client.get(`/member/${lead.tm.id}`);
  check("member: profile areas include the LAB_ONLY area", idsOf(mM.json.areas).includes(aHid.id) && idsOf(mM.json.events).includes(eHid.id));
  check("profile canMessage/isOwn unchanged in shape", typeof mM.json.canMessage === "boolean" && typeof mM.json.isOwn === "boolean");
  check("profile of a missing id is still 404", (await guest.get("/member/doesnotexist")).status === 404);

  // ------------------------------------------------------------------
  section("area <-> researcher writes");
  const audit = (action, entityId) => prisma.auditLog.findMany({ where: { action, entityId, createdAt: { gte: RUN_STARTED } }, orderBy: { createdAt: "asc" } });
  check("guest cannot set an area's researchers (401)", (await guest.put(`/research/${aPub.id}/researchers`, { teamMemberIds: [] })).status === 401);
  check("member cannot set an area's researchers (403)", (await memB.client.put(`/research/${aPub.id}/researchers`, { teamMemberIds: [memB.tm.id] })).status === 403);
  check("lead of a project cannot either (403)", (await lead.client.put(`/research/${aPub.id}/researchers`, { teamMemberIds: [lead.tm.id] })).status === 403);
  check("manager: malformed id 400", (await mgr.client.put("/research/bad%20id!/researchers", { teamMemberIds: [] })).status === 400);
  check("manager: unknown area 404", (await mgr.client.put("/research/doesnotexist/researchers", { teamMemberIds: [] })).status === 404);
  for (const [label, body] of [["missing", {}], ["non-array", { teamMemberIds: "x" }], ["duplicate", { teamMemberIds: [memB.tm.id, memB.tm.id] }], ["malformed member id", { teamMemberIds: ["bad id!"] }], ["number id", { teamMemberIds: [123] }], ["nonexistent member", { teamMemberIds: ["doesnotexist"] }]]) {
    const r = await mgr.client.put(`/research/${aPub.id}/researchers`, body);
    check(`manager: ${label} -> 400 and nothing changes`, r.status === 400);
  }
  const unknownMember = await mgr.client.put(`/research/${aPub.id}/researchers`, { teamMemberIds: ["doesnotexist"] });
  check("manager: the unknown-member rejection is OUR check's message, not the generic foreign-key fallback", unknownMember.json?.error === "One or more team members do not exist.", JSON.stringify(unknownMember.json));
  check("… and the set is unchanged after the rejected writes", (await prisma.researcherArea.count({ where: { researchAreaId: aPub.id } })) === 1);
  const putOk = await mgr.client.put(`/research/${aPub.id}/researchers`, { teamMemberIds: [lead.tm.id, memB.tm.id] });
  check("manager: replace set -> 200", putOk.status === 200 && putOk.json.success === true);
  check("… the join rows are exactly the requested set", same((await prisma.researcherArea.findMany({ where: { researchAreaId: aPub.id } })).map((r) => r.teamMemberId).sort(), [lead.tm.id, memB.tm.id].sort()));
  check("… guest now sees Bob on the public area", sortedIds((await guest.get(`/research/${aPub.id}`)).json.researchers).includes(memB.tm.id));
  const au = await audit("MEMBER_LINKS_CHANGED", aPub.id);
  check("audit: one MEMBER_LINKS_CHANGED row on the area with kind=researchers and ids only", au.length === 1 && au[0].entityType === "RESEARCH_AREA" && JSON.parse(au[0].details).kind === "researchers" && JSON.parse(au[0].details).added === memB.tm.id);
  check("audit details hold no text of the area beyond its title and no forbidden key", !/pass|hash|token|body|content|message/i.test(Object.keys(JSON.parse(au[0].details)).join(",")));
  await mgr.client.put(`/research/${aPub.id}/researchers`, { teamMemberIds: [lead.tm.id, memB.tm.id] });
  check("audit: an unchanged replace writes NO new row", (await audit("MEMBER_LINKS_CHANGED", aPub.id)).length === 1);
  check("admin may too", (await admin.put(`/research/${aPub.id}/researchers`, { teamMemberIds: [lead.tm.id] })).status === 200);
  check("… and Bob is off the area again", !idsOf((await guest.get(`/research/${aPub.id}`)).json.researchers).includes(memB.tm.id));

  section("researcher <-> area writes (from the profile)");
  check("guest cannot set a profile's areas (401)", (await guest.put(`/member/${memB.tm.id}/areas`, { areaIds: [] })).status === 401);
  check("another member cannot set MY areas (403)", (await memC.client.put(`/member/${memB.tm.id}/areas`, { areaIds: [aPub.id] })).status === 403);
  check("own profile: malformed area id 400, unknown area 400, duplicate 400, non-array 400", (await memB.client.put(`/member/${memB.tm.id}/areas`, { areaIds: ["bad id!"] })).status === 400 && (await memB.client.put(`/member/${memB.tm.id}/areas`, { areaIds: ["doesnotexist"] })).status === 400 && (await memB.client.put(`/member/${memB.tm.id}/areas`, { areaIds: [aPub.id, aPub.id] })).status === 400 && (await memB.client.put(`/member/${memB.tm.id}/areas`, { areaIds: "x" })).status === 400);
  check("malformed profile id 400", (await memB.client.put("/member/bad%20id!/areas", { areaIds: [] })).status === 400);
  const unknownArea = await memB.client.put(`/member/${memB.tm.id}/areas`, { areaIds: ["doesnotexist"] });
  check("own profile: the unknown-area rejection is OUR check's message, not the generic foreign-key fallback", unknownArea.json?.error === "One or more research areas do not exist.", JSON.stringify(unknownArea.json));
  const own = await memB.client.put(`/member/${memB.tm.id}/areas`, { areaIds: [aPub.id, aHid.id] });
  check("own profile: replace -> 200", own.status === 200);
  check("… rows are exactly the requested set", same((await prisma.researcherArea.findMany({ where: { teamMemberId: memB.tm.id } })).map((r) => r.researchAreaId).sort(), [aPub.id, aHid.id].sort()));
  const ownAudit = await audit("MEMBER_LINKS_CHANGED", memB.tm.id);
  check("audit: kind=area on the TEAM_MEMBER entity, ids only", ownAudit.some((a) => a.entityType === "TEAM_MEMBER" && JSON.parse(a.details).kind === "area"));
  check("manager may set another profile's areas", (await mgr.client.put(`/member/${memC.tm.id}/areas`, { areaIds: [aPub.id] })).status === 200);
  check("missing profile: manager 404", (await mgr.client.put("/member/doesnotexist/areas", { areaIds: [] })).status === 404);
  check("clearing is allowed (empty set)", (await memB.client.put(`/member/${memB.tm.id}/areas`, { areaIds: [] })).status === 200 && (await prisma.researcherArea.count({ where: { teamMemberId: memB.tm.id } })) === 0);
  check("guest sees Carol under the public area after the manager's write", idsOf((await guest.get(`/research/${aPub.id}`)).json.researchers).includes(memC.tm.id));

  // ------------------------------------------------------------------
  section("project / group membership + lead changes");
  check("plain member cannot change project members (403)", (await memC.client.put(`/projects/${P1.id}/members`, { members: [{ teamMemberId: memC.tm.id, role: "LEAD" }] })).status === 403);
  check("guest cannot (401)", (await guest.put(`/projects/${P1.id}/members`, { members: [] })).status === 401);
  const leadPut = await lead.client.put(`/projects/${P1.id}/members`, { members: [{ teamMemberId: lead.tm.id, role: "LEAD" }, { teamMemberId: memB.tm.id, role: "MEMBER" }, { teamMemberId: memC.tm.id, role: "COLLABORATOR" }] });
  check("the project's lead may add a collaborator (200)", leadPut.status === 200);
  const pm = await audit("PROJECT_MEMBERS_CHANGED", P1.id);
  check("audit: membership change has leadChanged=false and lists the leads", pm.length === 1 && JSON.parse(pm[0].details).leadChanged === false && JSON.parse(pm[0].details).leads === lead.tm.id);
  const promote = await lead.client.put(`/projects/${P1.id}/members`, { members: [{ teamMemberId: lead.tm.id, role: "LEAD" }, { teamMemberId: memB.tm.id, role: "LEAD" }, { teamMemberId: memC.tm.id, role: "COLLABORATOR" }] });
  check("a lead promoting another lead -> 200 and audited as a LEAD change", promote.status === 200 && JSON.parse((await audit("PROJECT_MEMBERS_CHANGED", P1.id)).at(-1).details).leadChanged === true);
  check("… promoted Bob can now edit the project", (await memB.client.get(`/projects/${P1.id}`)).json.canEdit === true);
  check("member-controlled settings stay manager-only: a lead sending groupId/visibility/slug/sortOrder gets 403", (await lead.client.put(`/projects/${P1.id}`, { groupId: null })).status === 403 && (await lead.client.put(`/projects/${P1.id}`, { visibility: "PUBLIC" })).status === 403 && (await lead.client.put(`/projects/${P1.id}`, { slug: "zz-p18-hijack" })).status === 403);
  check("a lead may edit content fields (200)", (await lead.client.put(`/projects/${P1.id}`, { summary: "ZZ P18 edited by lead" })).status === 200);
  check("invalid relationship ids: unknown member 400, bad role 400, duplicate 400", (await mgr.client.put(`/projects/${P1.id}/members`, { members: [{ teamMemberId: "doesnotexist", role: "MEMBER" }] })).status === 400 && (await mgr.client.put(`/projects/${P1.id}/members`, { members: [{ teamMemberId: lead.tm.id, role: "BOSS" }] })).status === 400 && (await mgr.client.put(`/projects/${P1.id}/members`, { members: [{ teamMemberId: lead.tm.id }, { teamMemberId: lead.tm.id }] })).status === 400);
  check("restore Bob to MEMBER (manager)", (await mgr.client.put(`/projects/${P1.id}/members`, { members: [{ teamMemberId: lead.tm.id, role: "LEAD" }, { teamMemberId: memB.tm.id, role: "MEMBER" }, { teamMemberId: memC.tm.id, role: "COLLABORATOR" }] })).status === 200);
  const gl = await memC.client.put(`/groups/${gPub.id}/members`, { members: [{ teamMemberId: memC.tm.id, role: "LEAD" }] });
  check("plain group member cannot change group members (403)", gl.status === 403);
  check("group lead may change members; audit records leadChanged", (await lead.client.put(`/groups/${gPub.id}/members`, { members: [{ teamMemberId: lead.tm.id, role: "LEAD" }, { teamMemberId: memC.tm.id, role: "LEAD" }] })).status === 200 && JSON.parse((await audit("GROUP_MEMBERS_CHANGED", gPub.id)).at(-1).details).leadChanged === true);
  await mgr.client.put(`/groups/${gPub.id}/members`, { members: [{ teamMemberId: lead.tm.id, role: "LEAD" }, { teamMemberId: memC.tm.id, role: "MEMBER" }] });

  // ------------------------------------------------------------------
  section("privilege escalation / role safety");
  check("a manager cannot change their own role (403)", (await mgr.client.put(`/users/${mgr.id}`, { role: "ADMIN" })).status === 403);
  check("a lead cannot change anybody's role (403)", (await lead.client.put(`/users/${memB.id}`, { role: "LAB_MANAGER" })).status === 403);
  check("a lead cannot list accounts (403)", (await lead.client.get("/users")).status === 403);
  check("a lead cannot use the admin content API (403)", (await lead.client.get("/admin/content/project")).status === 403);
  check("a lead cannot delete the project (403); a member cannot delete an area (403)", (await lead.client.del(`/projects/${P1.id}`)).status === 403 && (await memB.client.del(`/research/${aPub.id}`)).status === 403);

  // ------------------------------------------------------------------
  section("translations + locale independence");
  const ja = await mgr.client.put(`/research/${aPub.id}`, { translations: { ja: { title: "ZZ P18 公開研究分野", description: "日本語の説明 ZZJA" } } });
  check("manager sets a Japanese override on an area", ja.status === 200);
  await mgr.client.put(`/research/${aHid.id}`, { translations: { ja: { title: "ZZ P18 非公開分野", description: "hidden ja" } } });
  await mgr.client.put(`/projects/${P1.id}`, { translations: { ja: { title: "ZZ P18 プロジェクト一", summary: "日本語の要約" } } });
  await mgr.client.put(`/groups/${gPub.id}`, { translations: { ja: { name: "ZZ P18 公開グループ" } } });
  await prisma.translation.create({ data: { entityType: "NEWS_ITEM", entityId: nPub.id, locale: "ja", field: "title", value: "ZZ P18 公開ニュース" } });
  const jaA = await guest.get(`/research/${aPub.id}`, "ja");
  check("ja: area title/description localized", jaA.json.title === "ZZ P18 公開研究分野" && jaA.json.description.includes("ZZJA"));
  check("ja: the area's project list carries the project's Japanese title + summary", jaA.json.projects.find((p) => p.id === P1.id)?.title === "ZZ P18 プロジェクト一" && jaA.json.projects.find((p) => p.id === P1.id)?.summary === "日本語の要約");
  check("ja: the area's news is localized too", jaA.json.news[0]?.title === "ZZ P18 公開ニュース");
  const jaP = await guest.get(`/projects/${P1.id}`, "ja");
  check("ja: project detail localizes its area chips, group name and news", jaP.json.areas[0].title === "ZZ P18 公開研究分野" && jaP.json.group.name === "ZZ P18 公開グループ" && jaP.json.news[0].title === "ZZ P18 公開ニュース");
  check("ja: group detail localizes the project titles it lists and its areas", (await guest.get(`/groups/${gPub.id}`, "ja")).json.projects[0].title === "ZZ P18 プロジェクト一" && (await guest.get(`/groups/${gPub.id}`, "ja")).json.areas[0].title === "ZZ P18 公開研究分野");
  const jaM = await guest.get(`/member/${lead.tm.id}`, "ja");
  check("ja: profile localizes project/group/area labels", jaM.json.projects[0].title === "ZZ P18 プロジェクト一" && jaM.json.groups[0].name === "ZZ P18 公開グループ" && jaM.json.areas[0].title === "ZZ P18 公開研究分野");
  check("ja: the hidden area's Japanese title still never reaches a guest", !(await guest.get(`/projects/${P1.id}`, "ja")).text.includes("非公開分野") && (await guest.get(`/research/${aHid.id}`, "ja")).status === 404);
  const strip = (r) => JSON.stringify(r.json, (k, v) => (["title", "name", "description", "summary"].includes(k) ? undefined : v));
  for (const path of [`/research/${aPub.id}`, `/projects/${P1.id}`, `/groups/${gPub.id}`, `/member/${lead.tm.id}`]) {
    const variants = [undefined, "en", "ja", "xx", "JA", "ja-JP", "'; DROP TABLE Translation;--"];
    const rs = await Promise.all(variants.map((l) => guest.get(path, l)));
    check(`locale independence: ${path.split("/")[1]} status + relationship ids identical for missing/en/ja/invalid X-Locale`, rs.every((r) => r.status === 200 && strip(r) === strip(rs[0])));
  }
  for (const [label, client] of [["guest", guest], ["member", memB.client], ["manager", mgr.client]]) {
    const rs = await Promise.all([undefined, "en", "ja", "zz"].map((l) => client.get(`/research/${aHid.id}`, l)));
    check(`locale independence (${label}): hidden area status never depends on X-Locale`, rs.every((r) => r.status === rs[0].status));
  }
  check("an invalid X-Locale falls back to English text", (await guest.get(`/research/${aPub.id}`, "xx")).json.title === "ZZ P18 Area Public");
  check("ja Japanese input cannot change a permission outcome (member PUT visibility still 403)", (await memB.client.put(`/research/${aPub.id}`, { visibility: "LAB_ONLY", translations: { ja: { title: "ZZ P18 権限" } } }, "ja")).status === 403);
  check("… nor a member's write of researchers under ja (403)", (await memB.client.put(`/research/${aPub.id}/researchers`, { teamMemberIds: [] }, "ja")).status === 403);
  await mgr.client.put(`/research/${aPub.id}`, { translations: { ja: { title: "ZZ P18 公開研究分野", description: "日本語の説明 ZZJA" } } });

  // ------------------------------------------------------------------
  section("search: research areas link to their detail page; hidden stays hidden");
  const sg = await guest.get("/search?q=ZZ+P18+Area&type=research-area");
  check("guest search finds only the public area", sg.status === 200 && same(idsOf(sg.json.results), [aPub.id]));
  check("research-area result href is the new detail page", sg.json.results[0]?.href === `/research/${aPub.id}`);
  const sm = await memB.client.get("/search?q=ZZ+P18+Area&type=research-area");
  check("member search finds both areas, deterministic order", same(sortedIds(sm.json.results), [aPub.id, aHid.id].sort()) && same(idsOf(sm.json.results), idsOf((await memB.client.get("/search?q=ZZ+P18+Area&type=research-area")).json.results)));
  const sj = await guest.get("/search?q=" + encodeURIComponent("公開研究分野") + "&type=research-area", "ja");
  check("ja search matches the Japanese override", same(idsOf(sj.json.results), [aPub.id]));
  check("ja search does NOT reveal the hidden area's Japanese title to a guest", (await guest.get("/search?q=" + encodeURIComponent("非公開分野"), "ja")).json.results.length === 0);
  const sEn = await guest.get("/search?q=" + encodeURIComponent("公開研究分野"), "en");
  check("… and an English-locale request does not match it (override is per-locale, as before)", sEn.json.results.filter((r) => r.type === "research-area").length === 0);
  for (const type of ["project", "group", "researcher", "publication", "news", "event"]) {
    const r = await guest.get(`/search?q=ZZ+P18&type=${type}`);
    check(`guest search (${type}): status 200, no hidden-by-own-visibility row in any result, no account id`, r.status === 200 && searchLeaks(r).length === 0 && noAccountIds(r), searchLeaks(r).join("|"));
  }
  const allG = await guest.get("/search?q=ZZ+P18&limit=50");
  const visibleTotal = allG.json.results.length;
  const c = allG.json.counts;
  const perType = Object.entries(c).filter(([k]) => k !== "all").reduce((a, [, v]) => a + v, 0);
  check("guest search: results, pagination.total, counts.all and the per-type counts all agree; no hidden-by-own-visibility row is counted", searchLeaks(allG).length === 0 && allG.json.pagination.total === visibleTotal && c.all === visibleTotal && perType === visibleTotal, JSON.stringify(c));
  const rs = await Promise.all([undefined, "en", "ja", "xx"].map((l) => guest.get("/search?q=ZZ+P18+Area", l)));
  check("search: same result ids for missing/en/ja/invalid X-Locale (authorization identical)", rs.every((r) => same(idsOf(r.json.results), idsOf(rs[0].json.results))));

  // ------------------------------------------------------------------
  section("translation editing: the form always gets the ENGLISH base (a ja page's title is the override)");
  const trJa = await memB.client.get(`/translations/RESEARCH_AREA/${aPub.id}`, "ja");
  check("translations endpoint: ja override + English base, whatever the request locale", trJa.status === 200 && trJa.json.ja.title === "ZZ P18 公開研究分野" && trJa.json.base.title === "ZZ P18 Area Public" && trJa.json.base.description === "Public area ZZAPUB");
  check("… the base is identical for X-Locale en / ja / invalid", same((await memB.client.get(`/translations/RESEARCH_AREA/${aPub.id}`, "en")).json.base, trJa.json.base) && same((await memB.client.get(`/translations/RESEARCH_AREA/${aPub.id}`, "xx")).json.base, trJa.json.base));
  check("… and only allow-listed fields come back (no visibility/tag/sortOrder/anything else)", same(Object.keys(trJa.json.base).sort(), ["description", "title"]));
  const trP = await memB.client.get(`/translations/RESEARCH_PROJECT/${P1.id}`, "ja");
  check("project: base carries the English title/summary/description; group likewise", trP.json.base.title === "ZZ P18 Project One" && Object.keys(trP.json.base).sort().join() === "description,summary,title" && (await memB.client.get(`/translations/RESEARCH_GROUP/${gPub.id}`, "ja")).json.base.name === "ZZ P18 Group Public");
  check("a missing entity yields null fields, not an error; guest 401; unknown type 404; bad id 400", (await memB.client.get("/translations/RESEARCH_AREA/doesnotexist")).json.base.title === null && (await guest.get(`/translations/RESEARCH_AREA/${aPub.id}`)).status === 401 && (await memB.client.get(`/translations/USER/${memB.id}`)).status === 404 && (await memB.client.get("/translations/RESEARCH_AREA/bad%20id!")).status === 400);
  check("saving a form with the English base leaves the English column English (the round trip that used to corrupt it)", (await mgr.client.put(`/research/${aPub.id}`, { title: trJa.json.base.title, description: trJa.json.base.description, translations: { ja: trJa.json.ja } }, "ja")).status === 200 && (await prisma.researchArea.findUnique({ where: { id: aPub.id } })).title === "ZZ P18 Area Public");

  // News / event / team-member forms (Phase 18 follow-up): same English-base contract as area/project/group.
  const nF = (await mgr.client.post("/news", { date: "Jan 2037", sortDate: "2037-01-01", type: "Paper", title: "ZZ P18 News Form", description: "News form EN description", visibility: "PUBLIC", translations: { ja: { title: "ZZ P18 ニュースフォーム", description: "ニュースの日本語説明" } } })).json;
  const nBare = (await mgr.client.post("/news", { date: "Jan 2037", sortDate: "2037-01-02", type: "Paper", title: "ZZ P18 News Bare", description: "Bare EN", visibility: "PUBLIC" })).json;
  const evAt = new Date(Date.now() + 9 * 864e5).toISOString();
  const eF = (await mgr.client.post("/events", { title: "ZZ P18 Event Form", description: "Event form EN description", kind: "SEMINAR", startsAt: evAt, visibility: "PUBLIC", translations: { ja: { title: "ZZ P18 イベントフォーム", description: "イベントの日本語説明" } } })).json;
  const eBare = (await mgr.client.post("/events", { title: "ZZ P18 Event Bare", kind: "MEETING", startsAt: evAt, visibility: "PUBLIC" })).json;
  check("form fixtures: news and events created", [nF, nBare, eF, eBare].every((x) => x?.id));
  check("member fixture: a bio with a Japanese override", (await mgr.client.put(`/team/${lead.tm.id}`, { bio: "Lead EN bio", translations: { ja: { bio: "リードの日本語プロフィール" } } })).status === 200);
  const formCases = [
    ["NEWS_ITEM", nF.id, { title: "ZZ P18 News Form", description: "News form EN description" }, { title: "ZZ P18 ニュースフォーム", description: "ニュースの日本語説明" }, `/news/${nF.id}`, { date: "Jan 2037", sortDate: "2037-01-01", type: "Paper" }],
    ["EVENT", eF.id, { title: "ZZ P18 Event Form", description: "Event form EN description" }, { title: "ZZ P18 イベントフォーム", description: "イベントの日本語説明" }, `/events/${eF.id}`, {}],
    ["TEAM_MEMBER", lead.tm.id, { bio: "Lead EN bio" }, { bio: "リードの日本語プロフィール" }, `/team/${lead.tm.id}`, {}],
  ];
  for (const [type, id, en, ja, putPath, extra] of formCases) {
    const tr = await memB.client.get(`/translations/${type}/${id}`, "ja");
    check(`${type}: a ja request returns the English base and the Japanese override side by side`, tr.status === 200 && same(tr.json.base, en) && same(tr.json.ja, ja), JSON.stringify(tr.json));
    check(`${type}: the base is identical for X-Locale en / ja / invalid`, same((await memB.client.get(`/translations/${type}/${id}`, "en")).json.base, en) && same((await memB.client.get(`/translations/${type}/${id}`, "xx")).json.base, en));
    check(`${type}: a form saved with the English base + the untouched override changes nothing (byte-for-byte)`, (await mgr.client.put(putPath, { ...en, ...extra, translations: { ja } }, "ja")).status === 200 && same((await mgr.client.get(`/translations/${type}/${id}`)).json, { ja, base: en }));
    const editedJa = Object.fromEntries(Object.entries(ja).map(([k, v]) => [k, v + " 改"]));
    check(`${type}: editing only the Japanese leaves the English source unchanged`, (await mgr.client.put(putPath, { ...en, ...extra, translations: { ja: editedJa } }, "ja")).status === 200 && same((await mgr.client.get(`/translations/${type}/${id}`)).json, { ja: editedJa, base: en }));
    const editedEn = Object.fromEntries(Object.entries(en).map(([k, v]) => [k, v + " edited"]));
    check(`${type}: editing only the English (Japanese sent back as loaded) leaves the Japanese override unchanged`, (await mgr.client.put(putPath, { ...editedEn, ...extra, translations: { ja: editedJa } }, "ja")).status === 200 && same((await mgr.client.get(`/translations/${type}/${id}`)).json, { ja: editedJa, base: editedEn }));
  }
  for (const [type, id, field, en] of [["NEWS_ITEM", nBare.id, "title", "ZZ P18 News Bare"], ["EVENT", eBare.id, "title", "ZZ P18 Event Bare"]]) {
    const tr = await memB.client.get(`/translations/${type}/${id}`, "ja");
    check(`${type}: with no Japanese override the base is English and the override is empty (the page falls back to English)`, tr.json.base[field] === en && !tr.json.ja[field]);
  }

  // ------------------------------------------------------------------
  section("hostile input");
  const xss = `<img src=x onerror=alert(1)>ZZ P18 <script>alert(1)</script>`;
  const xa = await mgr.client.post("/research", { title: xss, description: "d", tag: "t", visibility: "PUBLIC" });
  check("XSS payload in a title is stored verbatim as text", xa.status === 201 && xa.json.title === xss);
  const xd = await guest.get(`/research/${xa.json.id}`);
  check("… and comes back JSON-encoded as text (content-type json, no HTML)", /application\/json/.test(xd.type) && xd.json.title === xss);
  await prisma.researchArea.delete({ where: { id: xa.json.id } });
  const long = "ZZ P18 " + "x".repeat(300);
  check("over-long title rejected (400)", (await mgr.client.post("/research", { title: long, description: "d", tag: "t" })).status === 400);
  const unbroken = "ZZ P18 " + "W".repeat(190);
  const ub = await mgr.client.post("/research", { title: unbroken, description: "Ｗ".repeat(1900), tag: "t", visibility: "PUBLIC" });
  check("a 190-char unbroken title + 1900-char description is accepted and returned intact", ub.status === 201 && (await guest.get(`/research/${ub.json.id}`)).json.title === unbroken);
  await prisma.researchArea.delete({ where: { id: ub.json.id } });
  const jp = await mgr.client.post("/research", { title: "ZZ P18 超長い日本語のタイトルがここに入りますが折り返される必要があります", description: "説明", tag: "タグ", visibility: "PUBLIC" });
  check("Japanese content round-trips", jp.status === 201 && (await guest.get(`/research/${jp.json.id}`)).json.tag === "タグ");
  await prisma.researchArea.delete({ where: { id: jp.json.id } });
  check("SQL-ish / traversal ids are 400, never 500", (await Promise.all(["'%20OR%201=1", "..%2F..%2Fetc", "%00", "a;b", "null", "undefined"].map((x) => guest.get(`/research/${x}`)))).every((r) => r.status === 400 || r.status === 404));
  check("ID enumeration: a real hidden id and a random id are indistinguishable to a guest", (await guest.get(`/research/${aHid.id}`)).text === (await guest.get(`/research/${"c" + aHid.id.slice(1)}`)).text);
  check("invalid JSON bodies on the new writes are 400", (await mgr.client.put(`/research/${aPub.id}/researchers`, "{not json")).status === 400 && (await memB.client.put(`/member/${memB.tm.id}/areas`, "[[")).status === 400);

  // ------------------------------------------------------------------
  section("deleted relationships");
  const pBefore = (await guest.get(`/research/${aPub.id}`)).json.projects.length;
  const tmpProject = await mkProject("zz-p18-tmp", "ZZ P18 Temp Project", "PUBLIC");
  await prisma.projectArea.create({ data: { projectId: tmpProject.id, researchAreaId: aPub.id } });
  check("a new visible project appears on the area", (await guest.get(`/research/${aPub.id}`)).json.projects.length === pBefore + 1);
  check("manager deletes the project", (await mgr.client.del(`/projects/${tmpProject.id}`)).status === 200);
  check("… it disappears from the area and its detail is a 404", (await guest.get(`/research/${aPub.id}`)).json.projects.length === pBefore && (await guest.get(`/projects/${tmpProject.id}`)).status === 404);
  const tmpGroup = await prisma.researchGroup.create({ data: { slug: "zz-p18-tmpg", name: "ZZ P18 Temp Group", visibility: "PUBLIC" } });
  await prisma.researchProject.update({ where: { id: P4.id }, data: { groupId: tmpGroup.id } });
  check("manager deletes the group", (await mgr.client.del(`/groups/${tmpGroup.id}`)).status === 200);
  check("… the project survives, ungrouped (group null)", (await guest.get(`/projects/${P4.id}`)).json.group === null);
  const tmpArea = (await mgr.client.post("/research", { title: "ZZ P18 Temp Area", description: "d", tag: "t", visibility: "PUBLIC" })).json;
  await prisma.projectArea.create({ data: { projectId: P4.id, researchAreaId: tmpArea.id } });
  await prisma.researcherArea.create({ data: { teamMemberId: lead.tm.id, researchAreaId: tmpArea.id } });
  check("manager deletes the area", (await mgr.client.del(`/research/${tmpArea.id}`)).status === 200);
  check("… project and profile no longer list it; detail 404", !idsOf((await guest.get(`/projects/${P4.id}`)).json.areas).includes(tmpArea.id) && !idsOf((await guest.get(`/member/${lead.tm.id}`)).json.areas).includes(tmpArea.id) && (await guest.get(`/research/${tmpArea.id}`)).status === 404);
  check("… and its Japanese overrides are gone with it", (await prisma.translation.count({ where: { entityType: "RESEARCH_AREA", entityId: tmpArea.id } })) === 0);
  const delUser = await admin.del(`/users/${lead.id}`);
  check("admin deletes the lead's ACCOUNT", delUser.status === 200);
  const afterDel = await guest.get(`/projects/${P1.id}`);
  check("… the project, its members list and the lead's profile all still load (relations are to the PROFILE)", afterDel.status === 200 && afterDel.json.members.some((m) => m.teamMemberId === lead.tm.id && m.role === "LEAD") && (await guest.get(`/member/${lead.tm.id}`)).status === 200);
  check("… the profile is now unowned: nobody can edit it as an owner, the ex-account cannot log in", (await guest.get(`/member/${lead.tm.id}`)).json.isOwn === false && (await new Client().login(lead.email, PW)).status === 401);
  check("… the events the deleted account created are kept, organiser link gone", (await guest.get(`/projects/${P1.id}`)).json.events.every((e) => e.organizer === null) && (await guest.get(`/projects/${P1.id}`)).json.events.length === 1);

  // ------------------------------------------------------------------
  section("audit hygiene");
  const rows = await prisma.auditLog.findMany({ where: { createdAt: { gte: RUN_STARTED } } });
  check("audit rows exist for this run", rows.length > 10);
  check("no audit row holds a password, hash, token, message body or translation VALUE", rows.every((r) => !/passwordHash|ChangeMe|Str0ngPassw0rd|公開研究分野|日本語の説明|プロジェクト一/.test((r.details ?? "") + r.actorEmail.replace(/@.*/, ""))));
  check("translation changes are audited by field name only", rows.filter((r) => /TRANSLATIONS_CHANGED|RESEARCH_UPDATED|PROJECT_UPDATED|GROUP_UPDATED/.test(r.action)).every((r) => !r.details || !/公開|プロジェクト/.test(r.details)));

  // ------------------------------------------------------------------
  section("cleanup");
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: RUN_STARTED } } });
  await cleanup();
  const after = {
    areas: await prisma.researchArea.count(),
    projects: await prisma.researchProject.count(),
    groups: await prisma.researchGroup.count(),
    translations: await prisma.translation.count(),
    researcherAreas: await prisma.researcherArea.count(),
    members: await prisma.teamMember.count(),
  };
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
