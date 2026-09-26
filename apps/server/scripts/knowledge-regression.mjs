/**
 * End-to-end API regression for the RESEARCH KNOWLEDGE BASE (Phase 22): /api/knowledge/*, knowledge
 * search, translations, visibility + relationship leakage, workspace and admin integration, audit rows,
 * hostile input, and locale-independence of every authorization outcome.
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:C:/abs/path/to/copy.db PORT=4061 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:C:/abs/path/to/copy.db API=http://localhost:4061 node scripts/knowledge-regression.mjs
 *
 * Run it ONLY against a COPY of the database: it removes every audit row written during the run.
 * Fixtures are prefixed "ZZ Know" / p22test-*@example.test and are removed again (also at the start,
 * in case a previous run was interrupted). It never touches a row it did not create.
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
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...(locale !== undefined ? { "X-Locale": locale } : {}) },
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

const ids = (r) => (Array.isArray(r.json?.items) ? r.json.items.map((e) => e.id) : []);
const M = "ZZ Know";

async function cleanup() {
  const docs = await prisma.knowledgeDoc.findMany({ where: { OR: [{ title: { startsWith: M } }, { title: { contains: "<script>" } }, { title: { contains: "ZZKNOW" } }] }, select: { id: true } });
  await prisma.translation.deleteMany({ where: { entityType: "KNOWLEDGE_DOC", entityId: { in: docs.map((d) => d.id) } } });
  await prisma.knowledgeDoc.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } });
  await prisma.translation.deleteMany({ where: { value: { startsWith: M } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "p22test-" } } }).catch(() => {});
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: M } } });
  await prisma.researchProject.deleteMany({ where: { title: { startsWith: M } } });
  await prisma.researchGroup.deleteMany({ where: { name: { startsWith: M } } });
  await prisma.researchArea.deleteMany({ where: { title: { startsWith: M } } });
}

/** The 'mine' total the workspace section links to. */
const K_total = async (u) => (await u.client.get("/knowledge?mine=1&limit=1")).json.pagination.total;

async function main() {
  await cleanup();
  const before = { docs: await prisma.knowledgeDoc.count(), translations: await prisma.translation.count(), users: await prisma.user.count() };

  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);

  const mk = async (key, role, name) => {
    const email = `p22test-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "ZK", memberRole: "Researcher", category: "RESEARCH" });
    const client = new Client();
    await client.login(email, PW);
    const tm = await prisma.teamMember.findFirst({ where: { name } });
    return { client, id: r.json?.id, email, tm, status: r.status };
  };

  // ------------------------------------------------------------------
  section("fixtures");
  const guest = new Client();
  const mgr = await mk("mgr", "LAB_MANAGER", `${M} Manager`);
  const memA = await mk("a", "MEMBER", `${M} Alice`);
  const memB = await mk("b", "MEMBER", `${M} Bob`);
  const lead = await mk("lead", "MEMBER", `${M} Lead`);
  const loner = await mk("loner", "MEMBER", `${M} Loner`); // a profile with no relationships at all
  const doomed = await mk("doomed", "MEMBER", `${M} Doomed`);
  check("fixtures: six accounts created with profiles", [mgr, memA, memB, lead, loner, doomed].every((u) => u.status === 201 && u.tm));

  const projPub = await prisma.researchProject.create({ data: { slug: "zz-know-proj-pub", title: `${M} Project Public`, visibility: "PUBLIC" } });
  const projHid = await prisma.researchProject.create({ data: { slug: "zz-know-proj-hid", title: `${M} Project Hidden`, visibility: "LAB_ONLY" } });
  const projPriv = await prisma.researchProject.create({ data: { slug: "zz-know-proj-priv", title: `${M} Project Private`, visibility: "PRIVATE" } });
  const areaPub = await prisma.researchArea.create({ data: { title: `${M} Area Public`, description: "d", tag: "zk", visibility: "PUBLIC" } });
  const areaHid = await prisma.researchArea.create({ data: { title: `${M} Area Hidden`, description: "d", tag: "zk", visibility: "LAB_ONLY" } });
  const groupPub = await prisma.researchGroup.create({ data: { slug: "zz-know-grp-pub", name: `${M} Group Public`, visibility: "PUBLIC" } });
  const groupHid = await prisma.researchGroup.create({ data: { slug: "zz-know-grp-hid", name: `${M} Group Hidden`, visibility: "LAB_ONLY" } });
  const areaPriv = await prisma.researchArea.create({ data: { title: `${M} Area Private`, description: "d", tag: "zk", visibility: "PRIVATE" } });
  const groupPriv = await prisma.researchGroup.create({ data: { slug: "zz-know-grp-priv", name: `${M} Group Private`, visibility: "PRIVATE" } });
  await prisma.projectMember.create({ data: { projectId: projPub.id, teamMemberId: lead.tm.id, role: "LEAD" } });
  await prisma.projectMember.create({ data: { projectId: projHid.id, teamMemberId: memB.tm.id, role: "MEMBER" } });
  await prisma.groupMember.create({ data: { groupId: groupPub.id, teamMemberId: memB.tm.id, role: "MEMBER" } });
  await prisma.researcherArea.create({ data: { teamMemberId: memA.tm.id, researchAreaId: areaHid.id } });

  const mkDoc = async (client, body) => (await client.post("/knowledge", body)).json;
  const pubDoc = await mkDoc(mgr.client, { title: `${M} Public Doc`, body: "Quantum ZZQ methodology for the public", category: "METHODOLOGY", visibility: "PUBLIC", projectId: projPub.id, researchAreaId: areaPub.id, groupId: groupPub.id, teamMemberId: lead.tm.id });
  const labDoc = await mkDoc(mgr.client, { title: `${M} LabOnly Doc`, body: "Internal ZZH budget procedure", category: "LAB_PROCEDURE", visibility: "LAB_ONLY" });
  const leakDoc = await mkDoc(mgr.client, { title: `${M} Leak Doc`, body: "Public doc that points at hidden things ZZL", category: "EXPERIMENT", visibility: "PUBLIC", projectId: projHid.id, researchAreaId: areaHid.id, groupId: groupHid.id });
  const privDoc = await mkDoc(mgr.client, { title: `${M} PrivateProj Doc`, body: "Doc on a PRIVATE project ZZP", category: "EXPERIMENT", visibility: "LAB_ONLY" });
  await prisma.knowledgeDoc.update({ where: { id: privDoc.id }, data: { projectId: projPriv.id } });
  const aliceDoc = await mkDoc(memA.client, { title: `${M} Alice Own`, body: "by alice", category: "RESEARCH_NOTE" });
  const jaDoc = await mkDoc(mgr.client, { title: `${M} Bilingual`, body: "English body ZZB", category: "SOFTWARE", visibility: "PUBLIC", translations: { ja: { title: "ZZ Know 二言語ドキュメント", body: "日本語の本文 ZZJ" } } });
  const doomedDoc = await mkDoc(doomed.client, { title: `${M} Doomed Author Doc`, body: "written by an account that will be deleted", category: "RESOURCE" });
  check("fixtures: all documents created", [pubDoc, labDoc, leakDoc, privDoc, aliceDoc, jaDoc, doomedDoc].every((d) => d?.id));

  // ------------------------------------------------------------------
  section("shape, content type, wire hygiene");
  const detailFields = ["id", "title", "body", "excerpt", "category", "author", "project", "researchArea", "group", "researcher", "createdAt", "updatedAt", "canEdit", "canDelete"];
  const gPub = await guest.get(`/knowledge/${pubDoc.id}`);
  check("detail JSON has the documented fields", detailFields.every((k) => k in gPub.json));
  check("list items carry an excerpt and NO body", (await guest.get("/knowledge")).json.items.every((i) => "excerpt" in i && !("body" in i)));
  check("responses are application/json", gPub.type.startsWith("application/json"));
  check("category round-trips", pubDoc.category === "METHODOLOGY" && labDoc.category === "LAB_PROCEDURE");
  check("default category is RESOURCE", (await mgr.client.post("/knowledge", { title: `${M} Default Cat`, body: "x" })).json.category === "RESOURCE");
  check("member-created document defaults to LAB_ONLY", (await mgr.client.get(`/knowledge/${aliceDoc.id}`)).json.visibility === "LAB_ONLY");
  check("member does not receive `visibility`", !("visibility" in aliceDoc));
  check("manager receives `visibility`", (await mgr.client.get(`/knowledge/${pubDoc.id}`)).json.visibility === "PUBLIC");
  check("guest never receives `visibility`", !("visibility" in gPub.json));
  check("author is the creator's public team profile", aliceDoc.author?.name === `${M} Alice` && aliceDoc.author?.id === memA.tm.id);
  check("dates are ISO UTC", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(pubDoc.createdAt) && /Z$/.test(pubDoc.updatedAt));
  check("canEdit/canDelete: owner yes, other member no, manager yes, guest no",
    aliceDoc.canEdit && aliceDoc.canDelete && !(await memB.client.get(`/knowledge/${aliceDoc.id}`)).json.canEdit && (await mgr.client.get(`/knowledge/${aliceDoc.id}`)).json.canDelete && !(await guest.get(`/knowledge/${pubDoc.id}`)).json.canEdit);
  const wireSamples = [
    (await memB.client.get(`/knowledge/${aliceDoc.id}`)).json,
    (await guest.get("/knowledge")).json,
    (await mgr.client.get("/knowledge?limit=50")).json,
    (await memA.client.get("/workspace")).json,
  ];
  const wire = JSON.stringify(wireSamples);
  check("no account id or email on the wire", ![memA, memB, mgr, lead, doomed].some((u) => wire.includes(u.id) || wire.includes(u.email)) && !wire.includes("@example.test"));
  check("no credential material on the wire", !/passwordHash|\$2[aby]\$|scl\.sid|storageKey|"userId"/.test(wire));

  // ------------------------------------------------------------------
  section("visibility (guest / member / manager / admin)");
  const gList = await guest.get("/knowledge?limit=50");
  check("guest list has PUBLIC documents only", ids(gList).includes(pubDoc.id) && ids(gList).includes(leakDoc.id) && ids(gList).includes(jaDoc.id) && ![labDoc, aliceDoc, privDoc, doomedDoc].some((d) => ids(gList).includes(d.id)));
  const guestTotal = gList.json.pagination.total;
  check("guest total counts exactly the PUBLIC documents", guestTotal === (await prisma.knowledgeDoc.count({ where: { visibility: "PUBLIC" } })) && guestTotal === gList.json.items.length);
  const missing = await guest.get("/knowledge/nonexistentid123");
  const hidden = await guest.get(`/knowledge/${labDoc.id}`);
  check("a hidden document is 404 and byte-identical to a missing one", hidden.status === 404 && missing.status === 404 && missing.text === hidden.text);
  check("malformed id is 400 (GET, PUT, DELETE)", (await guest.get("/knowledge/bad%20id")).status === 400 && (await mgr.client.put("/knowledge/bad%20id", { title: "x" })).status === 400 && (await mgr.client.del("/knowledge/bad%20id")).status === 400);
  check("nonexistent id: 404 for GET / PUT / DELETE", (await mgr.client.get("/knowledge/nonexistentid123")).status === 404 && (await mgr.client.put("/knowledge/nonexistentid123", { title: "x" })).status === 404 && (await mgr.client.del("/knowledge/nonexistentid123")).status === 404);
  const mList = await memB.client.get("/knowledge?limit=50");
  check("member sees LAB_ONLY documents too", [labDoc, aliceDoc, pubDoc].every((d) => ids(mList).includes(d.id)));
  check("member list carries no `visibility`", mList.json.items.every((e) => !("visibility" in e)));
  const mgrList = await mgr.client.get("/knowledge?limit=50");
  check("manager list carries `visibility`", mgrList.json.items.every((e) => e.visibility === "PUBLIC" || e.visibility === "LAB_ONLY"));
  const adminList = await admin.get("/knowledge?limit=50");
  check("admin sees the same documents as a manager", ids(adminList).length === ids(mgrList).length && adminList.json.items.every((e) => "visibility" in e));
  check("a stored visibility outside the allow-list is hidden from EVERYONE (fail closed)", await (async () => {
    await prisma.knowledgeDoc.update({ where: { id: labDoc.id }, data: { visibility: "SECRET" } });
    const rs = await Promise.all([guest, memB.client, mgr.client, admin].map((c) => c.get(`/knowledge/${labDoc.id}`)));
    const ls = await Promise.all([memB.client, mgr.client, admin].map((c) => c.get("/knowledge?limit=50")));
    await prisma.knowledgeDoc.update({ where: { id: labDoc.id }, data: { visibility: "LAB_ONLY" } });
    return rs.every((r) => r.status === 404) && ls.every((l) => !ids(l).includes(labDoc.id));
  })());
  check("visibility filter: manager may, guest and member get 403", (await mgr.client.get("/knowledge?visibility=PUBLIC")).status === 200 && (await guest.get("/knowledge?visibility=PUBLIC")).status === 403 && (await memB.client.get("/knowledge?visibility=LAB_ONLY")).status === 403);
  const onlyLab = await mgr.client.get("/knowledge?visibility=LAB_ONLY&limit=50");
  check("visibility filter narrows for a manager", ids(onlyLab).includes(labDoc.id) && !ids(onlyLab).includes(pubDoc.id) && onlyLab.json.items.every((i) => i.visibility === "LAB_ONLY"));
  check("visibility filter with a junk value is 400", (await mgr.client.get("/knowledge?visibility=SECRET")).status === 400);

  // ------------------------------------------------------------------
  section("relationships never leak a hidden record");
  const gLeak = (await guest.get(`/knowledge/${leakDoc.id}`)).json;
  check("guest: a PUBLIC document on a LAB_ONLY project/area/group names none of them", gLeak.project === null && gLeak.researchArea === null && gLeak.group === null);
  const gLeakWire = JSON.stringify([gLeak, (await guest.get("/knowledge?limit=50")).json, (await guest.get(`/search?q=ZZL&type=knowledge`)).json]);
  check("guest wire has neither hidden titles nor hidden ids", ![projHid, areaHid, groupHid].some((x) => gLeakWire.includes(x.id)) && !/Project Hidden|Area Hidden|Group Hidden/.test(gLeakWire));
  const mLeak = (await memB.client.get(`/knowledge/${leakDoc.id}`)).json;
  check("member: the same LAB_ONLY relations ARE visible", mLeak.project?.id === projHid.id && mLeak.researchArea?.id === areaHid.id && mLeak.group?.id === groupHid.id);
  check("a PUBLIC related project/area/group is visible to a guest", gPub.json.project?.id === projPub.id && gPub.json.researchArea?.id === areaPub.id && gPub.json.group?.id === groupPub.id && gPub.json.researcher?.id === lead.tm.id);
  const mPriv = (await memB.client.get(`/knowledge/${privDoc.id}`)).json;
  check("member: a project whose visibility is outside the allow-list is not named", mPriv.project === null && !JSON.stringify(mPriv).includes(projPriv.id));
  for (const [label, param, hid, pub] of [["project", "project", projHid, projPub], ["area", "area", areaHid, areaPub], ["group", "group", groupHid, groupPub]]) {
    const viaHidden = await guest.get(`/knowledge?${param}=${hid.id}`);
    const viaMissing = await guest.get(`/knowledge?${param}=nonexistentid123`);
    check(`guest: filtering by a hidden ${label} finds nothing, exactly like a missing id`, viaHidden.status === 200 && viaHidden.json.pagination.total === 0 && viaHidden.text === viaMissing.text);
    check(`guest: filtering by a public ${label} finds its document`, ids(await guest.get(`/knowledge?${param}=${pub.id}`)).includes(pubDoc.id));
    check(`member: filtering by the LAB_ONLY ${label} finds the document`, ids(await memB.client.get(`/knowledge?${param}=${hid.id}`)).includes(leakDoc.id));
  }
  check("member: filtering by a project outside the allow-list finds nothing", (await memB.client.get(`/knowledge?project=${projPriv.id}`)).json.pagination.total === 0);
  check("researcher filter", ids(await guest.get(`/knowledge?researcher=${lead.tm.id}`)).join() === pubDoc.id);

  // ------------------------------------------------------------------
  section("create: authorization and validation");
  check("guest cannot create (401)", (await guest.post("/knowledge", { title: "x", body: "y" })).status === 401);
  const bad = async (body) => (await memA.client.post("/knowledge", body)).status;
  check("title is required", (await bad({ body: "b" })) === 400 && (await bad({ title: "   ", body: "b" })) === 400);
  check("body is required: missing, empty and blank are all refused", (await bad({ title: "t" })) === 400 && (await bad({ title: "t", body: "" })) === 400 && (await bad({ title: "t", body: "  " })) === 400 && (await memA.client.put(`/knowledge/${aliceDoc.id}`, { body: "" })).status === 400);
  check("title 200 ok / 201 rejected", (await bad({ title: `${M} ${"Z".repeat(200)}`.slice(0, 200), body: "b" })) === 201 && (await bad({ title: "Z".repeat(201), body: "b" })) === 400);
  check("body 20000 ok / 20001 rejected", (await bad({ title: `${M} big`, body: "b".repeat(20000) })) === 201 && (await bad({ title: `${M} big2`, body: "b".repeat(20001) })) === 400);
  check("non-string title/body rejected, not coerced", (await bad({ title: 5, body: "b" })) === 400 && (await bad({ title: "t", body: { a: 1 } })) === 400 && (await bad({ title: ["t"], body: "b" })) === 400);
  check("every category is accepted", (await Promise.all(["PROJECT_DOCUMENTATION", "RESEARCH_NOTE", "METHODOLOGY", "EXPERIMENT", "HARDWARE", "SOFTWARE", "DATASET", "REPRODUCIBILITY", "LAB_PROCEDURE", "RESOURCE"].map((c) => bad({ title: `${M} cat ${c}`, body: "b", category: c })))).every((s) => s === 201));
  const hostileCats = ["method", "methodology", "Methodology", "'; DROP TABLE KnowledgeDoc; --", "<script>alert(1)</script>", "", "OTHER", "__proto__", "RESOURCE ", 1, null, ["RESOURCE"]];
  check("hostile / unknown categories are 400", (await Promise.all(hostileCats.map((c) => bad({ title: "t", body: "b", category: c })))).every((s) => s === 400));
  check("table survived the injection attempt", (await prisma.knowledgeDoc.count()) > 0);
  check("unknown keys (authorId, id, createdAt) are stripped, never accepted", await (async () => {
    const r = await memA.client.post("/knowledge", { title: `${M} strip`, body: "b", authorId: memB.id, id: "hijack", createdAt: "2001-01-01T00:00:00Z" });
    const row = await prisma.knowledgeDoc.findUnique({ where: { id: r.json.id } });
    return r.status === 201 && r.json.id !== "hijack" && row.authorId === memA.id && row.createdAt.getFullYear() > 2020;
  })());
  check("a member sending `visibility` is 403 and creates nothing", await (async () => {
    const n = await prisma.knowledgeDoc.count();
    const r = await memA.client.post("/knowledge", { title: `${M} sneaky`, body: "b", visibility: "PUBLIC" });
    return r.status === 403 && (await prisma.knowledgeDoc.count()) === n;
  })());
  check("a manager may set visibility on create", (await mgr.client.post("/knowledge", { title: `${M} mgr pub`, body: "b", visibility: "PUBLIC" })).json.visibility === "PUBLIC");
  check("invalid visibility is 400", (await mgr.client.post("/knowledge", { title: "t", body: "b", visibility: "SECRET" })).status === 400);
  check("a nonexistent link is 400 with the exact message", (await memA.client.post("/knowledge", { title: "t", body: "b", projectId: "nonexistentid123" })).json?.error === "Project not found." && (await memA.client.post("/knowledge", { title: "t", body: "b", researchAreaId: "nonexistentid123" })).json?.error === "Research area not found." && (await memA.client.post("/knowledge", { title: "t", body: "b", groupId: "nonexistentid123" })).json?.error === "Group not found." && (await memA.client.post("/knowledge", { title: "t", body: "b", teamMemberId: "nonexistentid123" })).json?.error === "Researcher not found.");
  check("a link to a project the author cannot see is reported like a missing one", (await memA.client.post("/knowledge", { title: "t", body: "b", projectId: projPriv.id })).json?.error === "Project not found.");
  check("a link to a research area / group whose visibility is outside the allow-list is reported like a missing one (members AND managers)", (await memA.client.post("/knowledge", { title: "t", body: "b", researchAreaId: areaPriv.id })).json?.error === "Research area not found." && (await memA.client.post("/knowledge", { title: "t", body: "b", groupId: groupPriv.id })).json?.error === "Group not found." && (await mgr.client.post("/knowledge", { title: "t", body: "b", researchAreaId: areaPriv.id })).json?.error === "Research area not found." && (await mgr.client.post("/knowledge", { title: "t", body: "b", groupId: groupPriv.id })).json?.error === "Group not found." && (await mgr.client.put(`/knowledge/${aliceDoc.id}`, { groupId: groupPriv.id })).json?.error === "Group not found.");
  check("a malformed link id is 400", (await memA.client.post("/knowledge", { title: "t", body: "b", projectId: "a b" })).status === 400 && (await memA.client.post("/knowledge", { title: "t", body: "b", projectId: "../x" })).status === 400);
  check("a member may link a visible project / area / group / researcher", await (async () => {
    const r = await memA.client.post("/knowledge", { title: `${M} linked`, body: "b", projectId: projHid.id, researchAreaId: areaHid.id, groupId: groupHid.id, teamMemberId: memB.tm.id });
    return r.status === 201 && r.json.project?.id === projHid.id && r.json.researcher?.id === memB.tm.id;
  })());
  check("a body that is not JSON / an empty body is 400", (await memA.client.post("/knowledge", "{not json")).status === 400 && (await memA.client.post("/knowledge", {})).status === 400);

  // ------------------------------------------------------------------
  section("update / delete: authorization");
  check("guest cannot update or delete (401)", (await guest.put(`/knowledge/${aliceDoc.id}`, { title: "x" })).status === 401 && (await guest.del(`/knowledge/${aliceDoc.id}`)).status === 401);
  check("another member cannot edit or delete (403) and nothing changes", await (async () => {
    const r1 = await memB.client.put(`/knowledge/${aliceDoc.id}`, { title: `${M} HIJACK` });
    const r2 = await memB.client.del(`/knowledge/${aliceDoc.id}`);
    const row = await prisma.knowledgeDoc.findUnique({ where: { id: aliceDoc.id } });
    return r1.status === 403 && r2.status === 403 && row?.title === `${M} Alice Own`;
  })());
  check("a project lead has no special power over documents", (await lead.client.put(`/knowledge/${aliceDoc.id}`, { title: "x" })).status === 403);
  check("the owner can edit", (await memA.client.put(`/knowledge/${aliceDoc.id}`, { body: "by alice (edited)", category: "DATASET" })).json?.category === "DATASET");
  check("an update never changes the author", (await prisma.knowledgeDoc.findUnique({ where: { id: aliceDoc.id } })).authorId === memA.id);
  check("the owner cannot change visibility (403), and it is unchanged", (await memA.client.put(`/knowledge/${aliceDoc.id}`, { visibility: "PUBLIC" })).status === 403 && (await prisma.knowledgeDoc.findUnique({ where: { id: aliceDoc.id } })).visibility === "LAB_ONLY");
  check("a manager can edit someone else's document and change visibility", (await mgr.client.put(`/knowledge/${aliceDoc.id}`, { visibility: "PUBLIC", title: `${M} Alice Own` })).json?.visibility === "PUBLIC");
  check("admin can edit too", (await admin.put(`/knowledge/${aliceDoc.id}`, { visibility: "LAB_ONLY" })).json?.visibility === "LAB_ONLY");
  check("PUT: every visibility change writes its own CONTENT_VISIBILITY_CHANGED row (from/to) on top of KNOWLEDGE_UPDATED", await (async () => {
    const rows = await prisma.auditLog.findMany({ where: { entityType: "KNOWLEDGE_DOC", entityId: aliceDoc.id, action: "CONTENT_VISIBILITY_CHANGED", createdAt: { gte: RUN_STARTED } } });
    const has = (from, to) => rows.some((r) => r.details && JSON.parse(r.details).from === from && JSON.parse(r.details).to === to);
    return has("LAB_ONLY", "PUBLIC") && has("PUBLIC", "LAB_ONLY");
  })());
  check("an empty update is 400", (await memA.client.put(`/knowledge/${aliceDoc.id}`, {})).status === 400);
  check("update validation (title/body/category/link)", (await memA.client.put(`/knowledge/${aliceDoc.id}`, { title: "" })).status === 400 && (await memA.client.put(`/knowledge/${aliceDoc.id}`, { category: "nope" })).status === 400 && (await memA.client.put(`/knowledge/${aliceDoc.id}`, { projectId: "nonexistentid123" })).status === 400);
  check("a member cannot smuggle role / authorId in an update", await (async () => {
    await memA.client.put(`/knowledge/${aliceDoc.id}`, { title: `${M} Alice Own`, authorId: memB.id, role: "ADMIN" });
    return (await prisma.knowledgeDoc.findUnique({ where: { id: aliceDoc.id } })).authorId === memA.id && (await prisma.user.findUnique({ where: { id: memA.id } })).role === "MEMBER";
  })());
  check("relink and clear a link (null)", await (async () => {
    const a = await memA.client.put(`/knowledge/${aliceDoc.id}`, { projectId: projPub.id, groupId: groupPub.id });
    const b = await memA.client.put(`/knowledge/${aliceDoc.id}`, { projectId: null });
    return a.json?.project?.id === projPub.id && a.json?.group?.id === groupPub.id && b.json?.project === null && b.json?.group?.id === groupPub.id;
  })());
  check("a link that is not being changed is not re-checked (hidden project later)", await (async () => {
    await prisma.knowledgeDoc.update({ where: { id: aliceDoc.id }, data: { projectId: projPriv.id } });
    const r = await memA.client.put(`/knowledge/${aliceDoc.id}`, { body: "still saveable" });
    await prisma.knowledgeDoc.update({ where: { id: aliceDoc.id }, data: { projectId: null } });
    return r.status === 200 && r.json.project === null;
  })());

  const toDelete = await mkDoc(memA.client, { title: `${M} To Delete`, body: "bye", translations: { ja: { title: "削除予定" } } });
  const toDelete2 = await mkDoc(memA.client, { title: `${M} To Delete 2`, body: "bye" });
  check("another member cannot delete (403)", (await memB.client.del(`/knowledge/${toDelete.id}`)).status === 403);
  check("owner delete is 200 and removes the row AND its translations", await (async () => {
    const r = await memA.client.del(`/knowledge/${toDelete.id}`);
    return r.status === 200 && (await prisma.knowledgeDoc.findUnique({ where: { id: toDelete.id } })) === null && (await prisma.translation.count({ where: { entityType: "KNOWLEDGE_DOC", entityId: toDelete.id } })) === 0;
  })());
  check("a deleted document is 404 for everyone and can't be deleted twice", (await mgr.client.get(`/knowledge/${toDelete.id}`)).status === 404 && (await memA.client.del(`/knowledge/${toDelete.id}`)).status === 404);
  check("a manager can delete someone else's document", (await mgr.client.del(`/knowledge/${toDelete2.id}`)).status === 200);

  // ------------------------------------------------------------------
  section("filters, search text, ordering, pagination");
  const many = [];
  for (let i = 0; i < 7; i++) many.push((await mgr.client.post("/knowledge", { title: `${M} Page ${i}`, body: `pagebody ZZPG ${i}`, category: "HARDWARE", visibility: "PUBLIC", researchAreaId: areaPub.id })).json);
  const p1 = await guest.get(`/knowledge?area=${areaPub.id}&category=HARDWARE&limit=3&page=1`);
  const p2 = await guest.get(`/knowledge?area=${areaPub.id}&category=HARDWARE&limit=3&page=2`);
  const p3 = await guest.get(`/knowledge?area=${areaPub.id}&category=HARDWARE&limit=3&page=3`);
  const p4 = await guest.get(`/knowledge?area=${areaPub.id}&category=HARDWARE&limit=3&page=4`);
  check("pagination: totals and page count", p1.json.pagination.total === 7 && p1.json.pagination.totalPages === 3 && p1.json.items.length === 3 && p2.json.items.length === 3 && p3.json.items.length === 1);
  check("pagination: pages are disjoint and cover everything", new Set([...ids(p1), ...ids(p2), ...ids(p3)]).size === 7 && [...ids(p1), ...ids(p2), ...ids(p3)].every((i) => many.some((m) => m.id === i)));
  check("pagination: a page past the end is empty, not an error", p4.status === 200 && p4.json.items.length === 0 && p4.json.pagination.total === 7);
  check("ordering is most recently updated first, ties by id", await (async () => {
    const all = (await guest.get(`/knowledge?area=${areaPub.id}&limit=50`)).json.items;
    return all.every((x, i) => i === 0 || all[i - 1].updatedAt > x.updatedAt || (all[i - 1].updatedAt === x.updatedAt && all[i - 1].id < x.id));
  })());
  check("ordering is repeatable", ids(await guest.get("/knowledge?limit=50")).join() === ids(await guest.get("/knowledge?limit=50")).join());
  const bumped = many[6];
  await mgr.client.put(`/knowledge/${bumped.id}`, { body: "bumped ZZPG" });
  check("editing a document moves it to the top", ids(await guest.get(`/knowledge?area=${areaPub.id}&limit=50`))[0] === bumped.id);
  for (const q of ["page=0", "page=-1", "page=abc", "page=1.5", "page=10001", "limit=0", "limit=51", "limit=abc", "limit=-3", "category=nope", "project=a%20b", "area=../x", "group=%00", "researcher=a%20b", "mine=2"]) {
    check(`bad query "${q}" is 400`, (await mgr.client.get(`/knowledge?${q}`)).status === 400);
  }
  check("empty-string filters mean 'no filter'", (await guest.get("/knowledge?category=&project=&area=&group=&researcher=&q=")).status === 200);
  check("max limit 50 is accepted", (await guest.get("/knowledge?limit=50")).status === 200);
  check("category filter", ids(await guest.get("/knowledge?category=METHODOLOGY&limit=50")).includes(pubDoc.id) && (await guest.get("/knowledge?category=METHODOLOGY&limit=50")).json.items.every((i) => i.category === "METHODOLOGY"));
  check("q matches the title", ids(await guest.get("/knowledge?q=Public%20Doc")).includes(pubDoc.id));
  check("q matches the body", ids(await guest.get("/knowledge?q=ZZQ")).join() === pubDoc.id);
  check("q also matches a Japanese title override (in any locale, so the answer never depends on the language)", ids(await guest.get(`/knowledge?q=${encodeURIComponent("二言語")}`)).join() === jaDoc.id && ids(await guest.get(`/knowledge?q=${encodeURIComponent("二言語")}`, "ja")).join() === jaDoc.id && ids(await guest.get(`/knowledge?q=${encodeURIComponent("二言語")}`, "xx")).join() === jaDoc.id);
  check("q is case-insensitive for ASCII and needs EVERY word", ids(await guest.get("/knowledge?q=zzq%20QUANTUM")).join() === pubDoc.id && ids(await guest.get("/knowledge?q=zzq%20nothingelse")).length === 0);
  check("q never finds a document the viewer may not see", ids(await guest.get("/knowledge?q=ZZH")).length === 0 && ids(await memB.client.get("/knowledge?q=ZZH")).join() === labDoc.id);
  check("q made only of % and _ has no words, so it is no filter at all (never a wildcard match on a hidden row)", await (async () => {
    const all = (await guest.get("/knowledge")).json.pagination.total;
    const a = await guest.get("/knowledge?q=%25");
    const b = await guest.get("/knowledge?q=%25_%25");
    return a.status === 200 && b.status === 200 && a.json.pagination.total === all && b.json.pagination.total === all;
  })());
  check("a % inside a query is a word separator, not a wildcard", (await guest.get("/knowledge?q=Quantum%25ZZQ")).json.pagination.total === 1 && (await guest.get("/knowledge?q=Quan%25")).json.pagination.total === (await guest.get("/knowledge?q=Quan")).json.pagination.total);
  check("q longer than 100 chars / more than 8 words is 400", (await guest.get(`/knowledge?q=${"a".repeat(101)}`)).status === 400 && (await guest.get("/knowledge?q=a%20b%20c%20d%20e%20f%20g%20h%20i")).status === 400);
  check("filters combine (AND)", ids(await guest.get(`/knowledge?category=METHODOLOGY&project=${projPub.id}&group=${groupPub.id}&area=${areaPub.id}&researcher=${lead.tm.id}`)).join() === pubDoc.id && ids(await guest.get(`/knowledge?category=HARDWARE&project=${projPub.id}`)).length === 0);
  const mine = await memB.client.get("/knowledge?mine=1&limit=50");
  check("mine: signed-in only (401 for a guest)", (await guest.get("/knowledge?mine=1")).status === 401);
  check("mine: documents of the researcher's own projects/groups", ids(mine).includes(pubDoc.id) /* their group */ && ids(mine).includes(leakDoc.id) /* their (LAB_ONLY) project */ && !ids(mine).includes(labDoc.id));
  check("mine: authored documents", ids(await memA.client.get("/knowledge?mine=1&limit=50")).includes(aliceDoc.id));

  // ------------------------------------------------------------------
  section("localization");
  const [jaEn, jaJa] = [await guest.get(`/knowledge/${jaDoc.id}`, "en"), await guest.get(`/knowledge/${jaDoc.id}`, "ja")];
  check("English shows the base title and body", jaEn.json.title === `${M} Bilingual` && jaEn.json.body === "English body ZZB");
  check("Japanese shows the override title and body", jaJa.json.title === "ZZ Know 二言語ドキュメント" && jaJa.json.body === "日本語の本文 ZZJ");
  check("a Japanese list carries the localized title and excerpt", (await guest.get("/knowledge?limit=50", "ja")).json.items.find((i) => i.id === jaDoc.id)?.excerpt === "日本語の本文 ZZJ");
  check("a document with no override falls back to English in ja", (await guest.get(`/knowledge/${pubDoc.id}`, "ja")).json.title === `${M} Public Doc`);
  check("Japanese: related project / area / group titles are the Japanese overrides (English in en, and never blank)", await (async () => {
    await prisma.translation.create({ data: { entityType: "RESEARCH_PROJECT", entityId: projPub.id, locale: "ja", field: "title", value: `${M} プロジェクト公開` } });
    await prisma.translation.create({ data: { entityType: "RESEARCH_AREA", entityId: areaPub.id, locale: "ja", field: "title", value: `${M} 公開分野` } });
    await prisma.translation.create({ data: { entityType: "RESEARCH_GROUP", entityId: groupPub.id, locale: "ja", field: "name", value: `${M} 公開グループ` } });
    const ja = (await guest.get(`/knowledge/${pubDoc.id}`, "ja")).json;
    const en = (await guest.get(`/knowledge/${pubDoc.id}`, "en")).json;
    const list = (await guest.get(`/knowledge?researcher=${lead.tm.id}`, "ja")).json.items[0];
    return ja.project.title === `${M} プロジェクト公開` && ja.researchArea.title === `${M} 公開分野` && ja.group.title === `${M} 公開グループ` && en.project.title === `${M} Project Public` && en.group.title === `${M} Group Public` && list.project.title === `${M} プロジェクト公開`;
  })());
  for (const bad of ["xx", "", "JA", "ja<script>", "en-US", "ja;q=0", "../ja", "null", "undefined"]) {
    const r = await guest.get(`/knowledge/${jaDoc.id}`, bad);
    check(`malformed locale ${JSON.stringify(bad)} falls back to English`, r.status === 200 && r.json.title === `${M} Bilingual`);
  }
  check("a missing X-Locale is English", (await guest.get(`/knowledge/${jaDoc.id}`)).json.title === `${M} Bilingual`);
  check("locale never changes which documents a viewer sees", (await Promise.all(["en", "ja", "xx", undefined].map((l) => guest.get("/knowledge?limit=50", l)))).map((r) => ids(r).join()).every((v, _i, a) => v === a[0]));
  check("partial Japanese: title only leaves the body in English", await (async () => {
    const d = await mkDoc(mgr.client, { title: `${M} Partial`, body: "English only body", visibility: "PUBLIC", translations: { ja: { title: "ZZ Know 部分翻訳" } } });
    const r = (await guest.get(`/knowledge/${d.id}`, "ja")).json;
    return r.title === "ZZ Know 部分翻訳" && r.body === "English only body";
  })());
  const tr = await memA.client.get(`/translations/KNOWLEDGE_DOC/${jaDoc.id}`);
  check("GET /translations/KNOWLEDGE_DOC/:id returns the override AND the English base (incl. body)", tr.status === 200 && tr.json.ja.title === "ZZ Know 二言語ドキュメント" && tr.json.ja.body === "日本語の本文 ZZJ" && tr.json.base.title === `${M} Bilingual` && tr.json.base.body === "English body ZZB");
  check("the translations read needs a signed-in account", (await guest.get(`/translations/KNOWLEDGE_DOC/${jaDoc.id}`)).status === 401);
  check("editing Japanese: another member is 403 and nothing changes", (await memA.client.put(`/knowledge/${jaDoc.id}`, { translations: { ja: { title: "HIJACK" } } })).status === 403 && (await guest.get(`/knowledge/${jaDoc.id}`, "ja")).json.title === "ZZ Know 二言語ドキュメント");
  check("the manager edits the Japanese body without touching the title", await (async () => {
    const r = await mgr.client.put(`/knowledge/${jaDoc.id}`, { translations: { ja: { body: "日本語の本文 ZZJ 改訂" } } }, "ja");
    return r.json.body === "日本語の本文 ZZJ 改訂" && r.json.title === "ZZ Know 二言語ドキュメント" && (await prisma.knowledgeDoc.findUnique({ where: { id: jaDoc.id } })).body === "English body ZZB";
  })());
  check("no duplicate translation rows (unique per field)", (await prisma.translation.count({ where: { entityType: "KNOWLEDGE_DOC", entityId: jaDoc.id } })) === 2);
  check("clearing the Japanese title restores the English fallback", await (async () => {
    await mgr.client.put(`/knowledge/${jaDoc.id}`, { translations: { ja: { title: "" } } });
    const r = (await guest.get(`/knowledge/${jaDoc.id}`, "ja")).json;
    return r.title === `${M} Bilingual` && r.body === "日本語の本文 ZZJ 改訂" && (await prisma.translation.count({ where: { entityType: "KNOWLEDGE_DOC", entityId: jaDoc.id } })) === 1;
  })());
  check("null clears too; a field left out is untouched", await (async () => {
    await mgr.client.put(`/knowledge/${jaDoc.id}`, { translations: { ja: { body: null } } });
    const r = (await guest.get(`/knowledge/${jaDoc.id}`, "ja")).json;
    return r.body === "English body ZZB" && (await prisma.translation.count({ where: { entityType: "KNOWLEDGE_DOC", entityId: jaDoc.id } })) === 0;
  })());
  check("an over-long Japanese field is 400", (await mgr.client.put(`/knowledge/${jaDoc.id}`, { translations: { ja: { title: "あ".repeat(201) } } })).status === 400 && (await mgr.client.put(`/knowledge/${jaDoc.id}`, { translations: { ja: { body: "あ".repeat(20001) } } })).status === 400);
  check("an unknown Japanese field is ignored (nothing stored)", await (async () => {
    await mgr.client.put(`/knowledge/${jaDoc.id}`, { title: `${M} Bilingual`, translations: { ja: { visibility: "PUBLIC", evil: "x" } } });
    return (await prisma.translation.count({ where: { entityType: "KNOWLEDGE_DOC", entityId: jaDoc.id } })) === 0;
  })());
  await mgr.client.put(`/knowledge/${jaDoc.id}`, { translations: { ja: { title: "ZZ Know 二言語ドキュメント", body: "日本語の本文 ZZJ" } } });

  // ------------------------------------------------------------------
  section("locale never affects authorization");
  const probes = [
    ["guest GET hidden", (l) => guest.get(`/knowledge/${labDoc.id}`, l)],
    ["guest POST", (l) => guest.post("/knowledge", { title: "x", body: "y" }, l)],
    ["member PUT other's", (l) => memB.client.put(`/knowledge/${aliceDoc.id}`, { title: "x" }, l)],
    ["member DELETE other's", (l) => memB.client.del(`/knowledge/${aliceDoc.id}`, l)],
    ["member visibility", (l) => memA.client.put(`/knowledge/${aliceDoc.id}`, { visibility: "PUBLIC" }, l)],
    ["member visibility filter", (l) => memA.client.get("/knowledge?visibility=PUBLIC", l)],
    ["guest visibility filter", (l) => guest.get("/knowledge?visibility=PUBLIC", l)],
    ["guest admin content", (l) => guest.get("/admin/content?type=knowledge", l)],
    ["member admin content", (l) => memA.client.get("/admin/content?type=knowledge", l)],
  ];
  for (const [label, fn] of probes) {
    const statuses = await Promise.all(["en", "ja", "xx", undefined, "JA"].map(async (l) => (await fn(l)).status));
    check(`${label}: same status for every locale (${statuses[0]})`, statuses.every((s) => s === statuses[0]) && statuses[0] >= 400);
  }

  // ------------------------------------------------------------------
  section("search integration");
  const sType = (c, q, l, extra = "") => c.get(`/search?q=${encodeURIComponent(q)}&type=knowledge${extra}`, l);
  const sTitle = await sType(guest, "Public Doc");
  check("search finds a document by English title", sTitle.json.results.some((r) => r.id === pubDoc.id && r.type === "knowledge"));
  check("the result links to /knowledge/:id and has no HTML", sTitle.json.results.find((r) => r.id === pubDoc.id).href === `/knowledge/${pubDoc.id}` && !/[<>]/.test(sTitle.json.results.find((r) => r.id === pubDoc.id).description));
  check("search finds a document by BODY text", (await sType(guest, "ZZQ")).json.results.map((r) => r.id).join() === pubDoc.id);
  check("a Japanese title override is matched in ja", (await sType(guest, "二言語", "ja")).json.results.some((r) => r.id === jaDoc.id));
  check("a Japanese body override is matched in ja and shown in the excerpt", (await sType(guest, "ZZJ", "ja")).json.results.find((r) => r.id === jaDoc.id)?.description.includes("日本語"));
  check("the ja result title is the override", (await sType(guest, "二言語", "ja")).json.results.find((r) => r.id === jaDoc.id)?.title === "ZZ Know 二言語ドキュメント");
  check("English search shows the English title of a bilingual document", (await sType(guest, "Bilingual", "en")).json.results.find((r) => r.id === jaDoc.id)?.title === `${M} Bilingual`);
  check("search never returns a hidden document to a guest (results, total, counts)", await (async () => {
    const r = await guest.get(`/search?q=ZZH`);
    return r.json.results.every((x) => x.id !== labDoc.id) && r.json.counts.knowledge === 0 && r.json.counts.all === 0 && r.json.pagination.total === 0;
  })());
  check("a member finds the LAB_ONLY document and its count", await (async () => {
    const r = await memB.client.get(`/search?q=ZZH`);
    return r.json.results.some((x) => x.id === labDoc.id) && r.json.counts.knowledge === 1;
  })());
  check("search counts include the knowledge chip and `all` is the sum", await (async () => {
    const r = (await guest.get("/search?q=ZZ")).json;
    return typeof r.counts.knowledge === "number" && r.counts.all === Object.entries(r.counts).filter(([k]) => k !== "all").reduce((a, [, v]) => a + v, 0);
  })());
  check("search pagination over knowledge is disjoint and totals match", await (async () => {
    const a = (await sType(guest, "ZZPG", undefined, "&limit=3&page=1")).json;
    const b = (await sType(guest, "ZZPG", undefined, "&limit=3&page=2")).json;
    const c = (await sType(guest, "ZZPG", undefined, "&limit=3&page=3")).json;
    const all = [...a.results, ...b.results, ...c.results].map((r) => r.id);
    return a.pagination.total === 7 && all.length === 7 && new Set(all).size === 7;
  })());
  check("search `related` links only visible records", await (async () => {
    const g = (await sType(guest, "ZZL")).json.results.find((r) => r.id === leakDoc.id);
    const m = (await sType(memB.client, "ZZL")).json.results.find((r) => r.id === leakDoc.id);
    const p = (await sType(guest, "ZZQ")).json.results.find((r) => r.id === pubDoc.id);
    return !g.related && m.related.length === 3 && p.related.map((r) => r.id).sort().join() === [projPub.id, areaPub.id, groupPub.id].sort().join();
  })());
  check("search results carry `visibility` for managers only (never for a guest or a member)", await (async () => {
    const g = (await guest.get("/search?q=ZZH")).json, m = (await memB.client.get("/search?q=ZZH&type=knowledge")).json, mg = (await mgr.client.get("/search?q=ZZH&type=knowledge")).json;
    const gp = (await guest.get("/search?q=ZZQ&type=knowledge")).json;
    return gp.results.length === 1 && !("visibility" in gp.results[0]) && m.results.length === 1 && !("visibility" in m.results[0]) && mg.results.length === 1 && mg.results[0].visibility === "LAB_ONLY" && g.results.length === 0;
  })());
  check("search: hostile and wildcard queries are safe", (await guest.get("/search?q=%25&type=knowledge")).status === 400 && (await guest.get(`/search?q=${encodeURIComponent("'; DROP TABLE KnowledgeDoc; --")}&type=knowledge`)).status === 200);

  // ------------------------------------------------------------------
  section("workspace integration");
  const wsLead = (await lead.client.get("/workspace")).json;
  check("workspace has a bounded knowledge section", Array.isArray(wsLead.knowledge?.items) && typeof wsLead.knowledge.total === "number");
  check("a lead's workspace lists documents of their own project / them as researcher", wsLead.knowledge.items.some((d) => d.id === pubDoc.id));
  check("... and not an unrelated document", !wsLead.knowledge.items.some((d) => [labDoc.id, aliceDoc.id].includes(d.id)));
  const wsUser = await mk("ws", "MEMBER", `${M} Workspace`);
  await prisma.researcherArea.create({ data: { teamMemberId: wsUser.tm.id, researchAreaId: areaHid.id } });
  const wsOwn = await mkDoc(wsUser.client, { title: `${M} WS Own`, body: "mine" });
  const wsA = (await wsUser.client.get("/workspace")).json;
  check("a researcher's workspace lists the documents of their area AND the ones they wrote", wsA.knowledge.total === 3 /* leak doc + memA's linked doc (both on the area) + their own */ && wsA.knowledge.items.some((d) => d.id === leakDoc.id) && wsA.knowledge.items.some((d) => d.id === wsOwn.id));
  check("workspace knowledge is newest-edited first", wsA.knowledge.items.every((d, i, a) => i === 0 || a[i - 1].updatedAt >= d.updatedAt));
  const wsLoner = (await loner.client.get("/workspace")).json;
  check("no relationships: an empty, well-formed knowledge section", wsLoner.knowledge.total === 0 && wsLoner.knowledge.items.length === 0);
  check("the workspace never accepts someone else's id", JSON.stringify((await lead.client.get(`/workspace?userId=${memA.id}&teamMemberId=${memA.tm.id}&mine=1`)).json.knowledge) === JSON.stringify(wsLead.knowledge));
  check("workspace knowledge respects visibility (a PRIVATE project's document is hidden)", await (async () => {
    await prisma.projectMember.create({ data: { projectId: projPriv.id, teamMemberId: loner.tm.id, role: "MEMBER" } });
    const ws = (await loner.client.get("/workspace")).json;
    await prisma.projectMember.delete({ where: { projectId_teamMemberId: { projectId: projPriv.id, teamMemberId: loner.tm.id } } });
    return !ws.knowledge.items.some((d) => d.id === privDoc.id);
  })());
  check("the workspace section is capped at 5 and reports the true total", await (async () => {
    for (let i = 0; i < 7; i++) await mkDoc(loner.client, { title: `${M} Loner ${i}`, body: "b" });
    const ws = (await loner.client.get("/workspace")).json.knowledge;
    return ws.items.length === 5 && ws.total === 7;
  })());
  check("the cap keeps the newest documents", await (async () => {
    const ws = (await loner.client.get("/workspace")).json.knowledge;
    const all = (await loner.client.get("/knowledge?mine=1&limit=50")).json.items;
    return ws.items.map((d) => d.id).join() === all.slice(0, 5).map((d) => d.id).join() && all.length === 7;
  })());
  check("a guest has no workspace (401) and the section is not on the public API", (await guest.get("/workspace")).status === 401);
  check("an account with NO team profile (the seeded admin) gets the well-formed empty knowledge section", JSON.stringify((await admin.get("/workspace")).json.knowledge) === JSON.stringify({ items: [], total: 0 }));
  check("a document that names the researcher (and nothing else) is theirs: in 'mine' and in the workspace", await (async () => {
    const named = await mkDoc(mgr.client, { title: `${M} Names The Researcher`, body: "named ZZKNAMED", visibility: "PUBLIC", teamMemberId: wsUser.tm.id });
    const mineIds = ids(await wsUser.client.get("/knowledge?mine=1&limit=50"));
    const ws = (await wsUser.client.get("/workspace")).json.knowledge;
    return mineIds.includes(named.id) && ws.items.some((d) => d.id === named.id) && ws.total === 4;
  })());
  check("documents of a group / area / project whose visibility is outside the allow-list never reach 'mine' or the workspace, and neither does a document whose own visibility is", await (async () => {
    await prisma.groupMember.create({ data: { groupId: groupPriv.id, teamMemberId: wsUser.tm.id, role: "MEMBER" } });
    await prisma.researcherArea.create({ data: { teamMemberId: wsUser.tm.id, researchAreaId: areaPriv.id } });
    const viaGroup = await prisma.knowledgeDoc.create({ data: { title: `${M} Via Private Group`, body: "b", visibility: "PUBLIC", groupId: groupPriv.id } });
    const viaArea = await prisma.knowledgeDoc.create({ data: { title: `${M} Via Private Area`, body: "b", visibility: "PUBLIC", researchAreaId: areaPriv.id } });
    const secret = await mkDoc(wsUser.client, { title: `${M} Own Secret`, body: "mine but odd" });
    await prisma.knowledgeDoc.update({ where: { id: secret.id }, data: { visibility: "SECRET" } });
    const mineIds = ids(await wsUser.client.get("/knowledge?mine=1&limit=50"));
    const ws = (await wsUser.client.get("/workspace")).json.knowledge;
    const wsIds = ws.items.map((d) => d.id);
    return ![viaGroup.id, viaArea.id, secret.id].some((i) => mineIds.includes(i) || wsIds.includes(i)) && ws.total === 4 && (await K_total(wsUser)) === 4;
  })());

  // ------------------------------------------------------------------
  section("admin integration");
  check("guest 401 / member 403 on the admin knowledge list", (await guest.get("/admin/content?type=knowledge")).status === 401 && (await memA.client.get("/admin/content?type=knowledge")).status === 403);
  const aList = await mgr.client.get("/admin/content?type=knowledge&limit=100");
  check("manager lists knowledge with visibility, status = category, owner and href", aList.status === 200 && aList.json.rows.length > 0 && aList.json.rows.every((r) => r.type === "knowledge" && (r.visibility === "PUBLIC" || r.visibility === "LAB_ONLY") && typeof r.status === "string" && r.href === `/knowledge/${r.id}`));
  check("the admin list includes every document (LAB_ONLY too)", [pubDoc, labDoc, aliceDoc].every((d) => aList.json.rows.some((r) => r.id === d.id)));
  check("admin filter: category", (await mgr.client.get("/admin/content?type=knowledge&category=METHODOLOGY")).json.rows.every((r) => r.status === "METHODOLOGY") && (await mgr.client.get("/admin/content?type=knowledge&category=METHODOLOGY")).json.rows.some((r) => r.id === pubDoc.id));
  check("admin filter: project / area / group", (await mgr.client.get(`/admin/content?type=knowledge&project=${projHid.id}`)).json.rows.some((r) => r.id === leakDoc.id) && (await mgr.client.get(`/admin/content?type=knowledge&area=${areaPub.id}`)).json.pagination.total >= 8 && (await mgr.client.get(`/admin/content?type=knowledge&group=${groupHid.id}`)).json.rows.some((r) => r.id === leakDoc.id));
  check("admin filter: visibility", (await mgr.client.get("/admin/content?type=knowledge&visibility=LAB_ONLY&limit=100")).json.rows.every((r) => r.visibility === "LAB_ONLY"));
  check("admin filter: owner", (await mgr.client.get(`/admin/content?type=knowledge&owner=${memA.tm.id}`)).json.rows.every((r) => r.owner?.id === memA.tm.id) && (await mgr.client.get(`/admin/content?type=knowledge&owner=${memA.tm.id}`)).json.rows.length > 0);
  check("admin text search finds the body and the Japanese title", (await mgr.client.get("/admin/content?type=knowledge&q=ZZQ")).json.rows.some((r) => r.id === pubDoc.id) && (await mgr.client.get("/admin/content?type=knowledge&q=二言語", "en")).json.rows.some((r) => r.id === jaDoc.id));
  check("admin filters that do not apply are 400", (await mgr.client.get("/admin/content?type=news&category=METHODOLOGY")).status === 400 && (await mgr.client.get(`/admin/content?type=event&project=${projPub.id}`)).status === 400 && (await mgr.client.get("/admin/content?type=knowledge&kind=SEMINAR")).status === 400 && (await mgr.client.get("/admin/content?type=knowledge&category=nope")).status === 400 && (await mgr.client.get("/admin/content?type=knowledge&project=a%20b")).status === 400);
  const aDet = await mgr.client.get(`/admin/content/knowledge/${pubDoc.id}`);
  check("admin detail: relation counts and translation state", aDet.status === 200 && aDet.json.relations.find((r) => r.key === "projects")?.count === 1 && aDet.json.relations.find((r) => r.key === "researchers")?.count === 1 && aDet.json.translations.map((t) => t.field).join() === "title,body");
  check("admin detail of a missing document is 404", (await mgr.client.get("/admin/content/knowledge/nonexistentid123")).status === 404);
  check("admin detail: the relation counts are per relation (a document linked ONLY to a project counts 1 project and 0 of the rest)", await (async () => {
    const only = await mkDoc(mgr.client, { title: `${M} Only A Project`, body: "b", visibility: "PUBLIC", projectId: projHid.id });
    const rel = (await mgr.client.get(`/admin/content/knowledge/${only.id}`)).json.relations;
    const n = (k) => rel.find((r) => r.key === k)?.count;
    return n("projects") === 1 && n("areas") === 0 && n("groups") === 0 && n("researchers") === 0;
  })());
  const ov = (await mgr.client.get("/admin/overview")).json;
  check("overview counts knowledge documents by visibility", ov.knowledgeDocs.total === (await prisma.knowledgeDoc.count()) && ov.knowledgeDocs.public === (await prisma.knowledgeDoc.count({ where: { visibility: "PUBLIC" } })) && ov.knowledgeDocs.total === ov.knowledgeDocs.public + ov.knowledgeDocs.labOnly);
  check("bulk visibility works for knowledge and is audited per record", await (async () => {
    const updatedRows = () => prisma.auditLog.count({ where: { entityType: "KNOWLEDGE_DOC", entityId: { in: [aliceDoc.id, labDoc.id] }, action: "KNOWLEDGE_UPDATED" } });
    const updatedBefore = await updatedRows();
    const r = await mgr.client.post("/admin/content/visibility", { type: "knowledge", ids: [aliceDoc.id, labDoc.id], visibility: "PUBLIC" });
    const updatedAfter = await updatedRows();
    const rows = await prisma.auditLog.findMany({ where: { entityType: "KNOWLEDGE_DOC", entityId: { in: [aliceDoc.id, labDoc.id] }, action: "CONTENT_VISIBILITY_CHANGED", createdAt: { gte: RUN_STARTED } } });
    const back = await mgr.client.post("/admin/content/visibility", { type: "knowledge", ids: [aliceDoc.id, labDoc.id], visibility: "LAB_ONLY" });
    return r.status === 200 && r.json.updated === 2 && rows.length >= 2 && updatedAfter - updatedBefore === 2 && back.status === 200;
  })());
  check("bulk visibility is 403 for a member and 404 (all-or-nothing) for an unknown id", (await memA.client.post("/admin/content/visibility", { type: "knowledge", ids: [aliceDoc.id], visibility: "PUBLIC" })).status === 403 && (await mgr.client.post("/admin/content/visibility", { type: "knowledge", ids: [aliceDoc.id, "nonexistentid123"], visibility: "PUBLIC" })).status === 404 && (await prisma.knowledgeDoc.findUnique({ where: { id: aliceDoc.id } })).visibility === "LAB_ONLY");
  check("the admin translations view edits a knowledge override (audited, names only)", await (async () => {
    const r = await mgr.client.put(`/admin/translations/KNOWLEDGE_DOC/${pubDoc.id}`, { field: "title", value: "ZZ Know 公開ドキュメント" });
    const list = await mgr.client.get("/admin/translations?type=KNOWLEDGE_DOC&q=Public%20Doc");
    const ja = await guest.get(`/knowledge/${pubDoc.id}`, "ja");
    const audit = await prisma.auditLog.findFirst({ where: { entityType: "KNOWLEDGE_DOC", entityId: pubDoc.id, action: "TRANSLATIONS_CHANGED", createdAt: { gte: RUN_STARTED } } });
    const cleared = await mgr.client.put(`/admin/translations/KNOWLEDGE_DOC/${pubDoc.id}`, { field: "title", value: null });
    return r.status === 200 && list.json.entries.some((e) => e.id === pubDoc.id && e.fields.map((f) => f.field).join() === "title,body" && e.fields[0].max === 200 && e.fields[1].max === 20000) && ja.json.title === "ZZ Know 公開ドキュメント" && audit && !audit.details.includes("公開") && cleared.status === 200;
  })());
  check("a member cannot use the admin translations view", (await memA.client.put(`/admin/translations/KNOWLEDGE_DOC/${pubDoc.id}`, { field: "title", value: "x" })).status === 403);
  check("no admin response carries account ids or emails", await (async () => {
    const w = JSON.stringify([aList.json, aDet.json, ov]);
    return ![memA, memB, mgr].some((u) => w.includes(u.id) || w.includes(u.email));
  })());

  // ------------------------------------------------------------------
  section("audit");
  const audits = await prisma.auditLog.findMany({ where: { entityType: "KNOWLEDGE_DOC", createdAt: { gte: RUN_STARTED } } });
  const has = (a) => audits.some((r) => r.action === a);
  check("created / updated / deleted / visibility / translations are audited", ["KNOWLEDGE_CREATED", "KNOWLEDGE_UPDATED", "KNOWLEDGE_DELETED", "CONTENT_VISIBILITY_CHANGED", "TRANSLATIONS_CHANGED"].every(has));
  const auditWire = audits.map((r) => r.details ?? "").join("\n");
  check("audit rows hold field NAMES and titles, never bodies or Japanese text", !/by alice|Quantum ZZQ|English body|日本語|Internal ZZH/.test(auditWire));
  check("an update row lists the changed field names", audits.some((r) => r.action === "KNOWLEDGE_UPDATED" && /"changed":"[^"]*category/.test(r.details ?? "")));
  check("a translation row names the locale and fields", audits.some((r) => r.action === "TRANSLATIONS_CHANGED" && /"locale":"ja"/.test(r.details ?? "") && /fields/.test(r.details ?? "")));
  check("a rejected write leaves no audit row", await (async () => {
    const n = await prisma.auditLog.count({ where: { entityType: "KNOWLEDGE_DOC" } });
    await memB.client.put(`/knowledge/${aliceDoc.id}`, { title: "nope" });
    await memA.client.post("/knowledge", { title: "", body: "" });
    return (await prisma.auditLog.count({ where: { entityType: "KNOWLEDGE_DOC" } })) === n;
  })());
  check("reads are not audited", await (async () => {
    const n = await prisma.auditLog.count({ where: { entityType: "KNOWLEDGE_DOC" } });
    await guest.get("/knowledge");
    await guest.get(`/knowledge/${pubDoc.id}`);
    return (await prisma.auditLog.count({ where: { entityType: "KNOWLEDGE_DOC" } })) === n;
  })());
  check("the audit view (manager) shows knowledge rows without emails", await (async () => {
    const r = await mgr.client.get("/admin/audit?entityType=KNOWLEDGE_DOC&limit=100");
    return r.status === 200 && r.json.entries.length > 0 && !r.text.includes("@example.test");
  })());

  // ------------------------------------------------------------------
  section("hostile content is stored verbatim as text and never breaks a response");
  const xss = ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "javascript:alert(1)", "<iframe src=javascript:alert(1)></iframe>", "\"><svg onload=alert(1)>", "[click](javascript:alert(1))", "{{constructor.constructor('alert(1)')()}}"];
  for (const [i, x] of xss.entries()) {
    const r = await mgr.client.post("/knowledge", { title: `${M} XSS ${i} ${x}`.slice(0, 200), body: `body ${x}`, visibility: "PUBLIC", translations: { ja: { title: `ZZ Know 日本語 ${x}`.slice(0, 200), body: `日本語 ${x}` } } });
    const g = await guest.get(`/knowledge/${r.json.id}`);
    const gj = await guest.get(`/knowledge/${r.json.id}`, "ja");
    const l = await guest.get("/knowledge?limit=50&q=" + encodeURIComponent("日本語"), "ja");
    const s = await guest.get(`/search?q=${encodeURIComponent("XSS " + i)}&type=knowledge`);
    check(`payload ${i}: stored verbatim and served as JSON, never as HTML`, r.status === 201 && g.type.startsWith("application/json") && g.json.body === `body ${x}` && gj.json.body === `日本語 ${x}` && l.type.startsWith("application/json") && s.type.startsWith("application/json"));
  }
  check("a 200-char unbroken title and a 20,000-char unbroken body are stored intact", await (async () => {
    const t = `${M} ${"W".repeat(190)}`.slice(0, 200);
    const b = "Q".repeat(20000);
    const r = await mgr.client.post("/knowledge", { title: t, body: b, visibility: "PUBLIC" });
    const g = await guest.get(`/knowledge/${r.json.id}`);
    const l = await guest.get("/knowledge?limit=50");
    return r.status === 201 && g.json.title === t && g.json.body === b && l.json.items.find((i) => i.id === r.json.id).excerpt.length <= 201;
  })());
  check("Japanese title/body (full-width, long) round-trip", await (async () => {
    const t = `${M} ${"日本語のとても長いタイトル".repeat(12)}`.slice(0, 200);
    const b = "これは長い本文です。".repeat(1500);
    const r = await mgr.client.post("/knowledge", { title: t, body: b, visibility: "PUBLIC" });
    return r.status === 201 && (await guest.get(`/knowledge/${r.json.id}`)).json.body === b.trim();
  })());
  check("null bytes / control characters do not crash the API", [(await mgr.client.post("/knowledge", { title: `${M} nul\u0000x`, body: "b\u0000c\u0007" })).status, (await guest.get("/knowledge?q=%00")).status].every((s) => s < 500));

  // ------------------------------------------------------------------
  section("deleted author / deleted relations / privilege escalation");
  const authorBefore = (await mgr.client.get(`/knowledge/${doomedDoc.id}`)).json;
  check("before: the doomed author is shown", authorBefore.author?.name === `${M} Doomed`);
  check("admin deletes the author's account", (await admin.del(`/users/${doomed.id}`)).status === 200);
  const authorAfter = await mgr.client.get(`/knowledge/${doomedDoc.id}`);
  check("after: the document survives with no author and no owner", authorAfter.status === 200 && authorAfter.json.author === null && (await prisma.knowledgeDoc.findUnique({ where: { id: doomedDoc.id } })).authorId === null);
  check("an author-less document: a member cannot edit it, a manager can", (await memA.client.put(`/knowledge/${doomedDoc.id}`, { title: "x" })).status === 403 && (await mgr.client.put(`/knowledge/${doomedDoc.id}`, { body: "kept by a manager" })).status === 200);
  check("an author-less document: the server's canEdit/canDelete flags are false for a member and true for a manager", await (async () => {
    const m = (await memA.client.get(`/knowledge/${doomedDoc.id}`)).json, g = (await mgr.client.get(`/knowledge/${doomedDoc.id}`)).json;
    return m.canEdit === false && m.canDelete === false && g.canEdit === true && g.canDelete === true;
  })());
  check("an author-less document leaks nothing about the deleted account", !JSON.stringify(authorAfter.json).includes(doomed.id) && !authorAfter.text.includes(doomed.email));
  const rel = await mkDoc(mgr.client, { title: `${M} Relations`, body: "b", visibility: "PUBLIC", projectId: projPub.id, researchAreaId: areaPub.id, groupId: groupPub.id, teamMemberId: lead.tm.id });
  await prisma.researchProject.delete({ where: { id: projPub.id } });
  await prisma.researchArea.delete({ where: { id: areaPub.id } });
  await prisma.researchGroup.delete({ where: { id: groupPub.id } });
  const afterRel = await guest.get(`/knowledge/${rel.id}`);
  check("deleting a project / area / group keeps the document and clears the link", afterRel.status === 200 && afterRel.json.project === null && afterRel.json.researchArea === null && afterRel.json.group === null && afterRel.json.researcher?.id === lead.tm.id);
  await prisma.teamMember.update({ where: { id: lead.tm.id }, data: { userId: null } }).catch(() => {});
  await prisma.user.delete({ where: { id: lead.id } });
  await prisma.teamMember.delete({ where: { id: lead.tm.id } });
  const afterTm = await guest.get(`/knowledge/${rel.id}`);
  check("deleting the related researcher keeps the document", afterTm.status === 200 && afterTm.json.researcher === null);
  check("a member cannot become admin or manager through this API", (await prisma.user.findUnique({ where: { id: memA.id } })).role === "MEMBER" && (await memA.client.put(`/knowledge/${aliceDoc.id}`, { role: "ADMIN", visibility: "PUBLIC" })).status === 403);
  check("no 5xx from any probe above (server still healthy)", (await guest.get("/knowledge")).status === 200);

  // ------------------------------------------------------------------
  await cleanup();
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: RUN_STARTED } } });
  const after = { docs: await prisma.knowledgeDoc.count(), translations: await prisma.translation.count(), users: await prisma.user.count() };
  section("cleanup");
  check("fixtures removed: document, translation and user counts are back to where they started", after.docs === before.docs && after.translations === before.translations && after.users === before.users, JSON.stringify({ before, after }));

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFAILURES:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exitCode = 1;
  }
}

main()
  .catch(async (e) => {
    console.error("Script crashed:", e);
    await cleanup().catch(() => {});
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
