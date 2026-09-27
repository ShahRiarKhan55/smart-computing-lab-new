/**
 * End-to-end API regression for LAB RESOURCES & REPRODUCIBILITY (Phase 23): /api/resources/*, resource search,
 * translations, visibility + relationship leakage, workspace and admin integration, audit rows, hostile input,
 * and locale-independence of every authorization outcome.
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:C:/abs/path/to/copy.db PORT=4071 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:C:/abs/path/to/copy.db API=http://localhost:4071 node scripts/resources-regression.mjs
 *
 * Run it ONLY against a COPY of the database: it removes every audit row written during the run.
 * Fixtures are prefixed "ZZ Res" / p23test-*@example.test and are removed again (also at the start,
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
const M = "ZZ Res";

async function cleanup() {
  const rs = await prisma.labResource.findMany({ where: { OR: [{ name: { startsWith: M } }, { name: { contains: "<script>" } }, { name: { contains: "ZZRES" } }] }, select: { id: true } });
  await prisma.translation.deleteMany({ where: { entityType: "LAB_RESOURCE", entityId: { in: rs.map((d) => d.id) } } });
  await prisma.labResource.deleteMany({ where: { id: { in: rs.map((d) => d.id) } } });
  await prisma.translation.deleteMany({ where: { value: { startsWith: M } } });
  await prisma.knowledgeDoc.deleteMany({ where: { title: { startsWith: M } } });
  await prisma.event.deleteMany({ where: { title: { startsWith: M } } });
  await prisma.publication.deleteMany({ where: { title: { startsWith: M } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "p23test-" } } }).catch(() => {});
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: M } } });
  await prisma.researchProject.deleteMany({ where: { title: { startsWith: M } } });
  await prisma.researchGroup.deleteMany({ where: { name: { startsWith: M } } });
  await prisma.researchArea.deleteMany({ where: { title: { startsWith: M } } });
}

async function main() {
  await cleanup();
  const before = { resources: await prisma.labResource.count(), links: await prisma.resourceProject.count(), translations: await prisma.translation.count(), users: await prisma.user.count() };

  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);

  const mk = async (key, role, name) => {
    const email = `p23test-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "ZR", memberRole: "Researcher", category: "RESEARCH" });
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
  const loner = await mk("loner", "MEMBER", `${M} Loner`);
  const doomed = await mk("doomed", "MEMBER", `${M} Doomed`);
  check("fixtures: six accounts created with profiles", [mgr, memA, memB, lead, loner, doomed].every((u) => u.status === 201 && u.tm));

  const projPub = await prisma.researchProject.create({ data: { slug: "zz-res-proj-pub", title: `${M} Project Public`, visibility: "PUBLIC" } });
  const projHid = await prisma.researchProject.create({ data: { slug: "zz-res-proj-hid", title: `${M} Project Hidden`, visibility: "LAB_ONLY" } });
  const projPriv = await prisma.researchProject.create({ data: { slug: "zz-res-proj-priv", title: `${M} Project Private`, visibility: "PRIVATE" } });
  const areaPub = await prisma.researchArea.create({ data: { title: `${M} Area Public`, description: "d", tag: "zr", visibility: "PUBLIC" } });
  const areaHid = await prisma.researchArea.create({ data: { title: `${M} Area Hidden`, description: "d", tag: "zr", visibility: "LAB_ONLY" } });
  const areaPriv = await prisma.researchArea.create({ data: { title: `${M} Area Private`, description: "d", tag: "zr", visibility: "PRIVATE" } });
  const groupPub = await prisma.researchGroup.create({ data: { slug: "zz-res-grp-pub", name: `${M} Group Public`, visibility: "PUBLIC" } });
  const groupHid = await prisma.researchGroup.create({ data: { slug: "zz-res-grp-hid", name: `${M} Group Hidden`, visibility: "LAB_ONLY" } });
  const groupPriv = await prisma.researchGroup.create({ data: { slug: "zz-res-grp-priv", name: `${M} Group Private`, visibility: "PRIVATE" } });
  const pubPub = await prisma.publication.create({ data: { year: 2030, title: `${M} Paper Public`, authors: "A", venue: "V", visibility: "PUBLIC" } });
  const pubHid = await prisma.publication.create({ data: { year: 2030, title: `${M} Paper Hidden`, authors: "A", venue: "V", visibility: "LAB_ONLY" } });
  const evPub = await prisma.event.create({ data: { title: `${M} Event Public`, startsAt: new Date("2030-01-01T00:00:00Z"), visibility: "PUBLIC" } });
  const evHid = await prisma.event.create({ data: { title: `${M} Event Hidden`, startsAt: new Date("2030-01-01T00:00:00Z"), visibility: "LAB_ONLY" } });
  const docPub = await prisma.knowledgeDoc.create({ data: { title: `${M} Doc Public`, body: "b", visibility: "PUBLIC" } });
  const docHid = await prisma.knowledgeDoc.create({ data: { title: `${M} Doc Hidden`, body: "b", visibility: "LAB_ONLY" } });
  await prisma.projectMember.create({ data: { projectId: projPub.id, teamMemberId: lead.tm.id, role: "LEAD" } });
  await prisma.projectMember.create({ data: { projectId: projHid.id, teamMemberId: memB.tm.id, role: "MEMBER" } });
  await prisma.groupMember.create({ data: { groupId: groupPub.id, teamMemberId: memB.tm.id, role: "MEMBER" } });
  await prisma.researcherArea.create({ data: { teamMemberId: memA.tm.id, researchAreaId: areaHid.id } });

  const mkRes = async (client, body) => (await client.post("/resources", body)).json;
  const pubRes = await mkRes(mgr.client, {
    name: `${M} Public Dataset`,
    resourceType: "DATASET",
    description: "A dataset ZZRQ for reproducing the public result",
    version: "v2.1",
    vendor: "Lab",
    identifier: "ZZRQ-ID-1",
    url: "https://example.com/data",
    environment: "Python 3.11, seed 42",
    metadata: { format: "CSV", size: "2 GB", license: "CC-BY", collectionMethod: "camera rig" },
    visibility: "PUBLIC",
    projectIds: [projPub.id, projHid.id],
    researchAreaId: areaPub.id,
    groupId: groupPub.id,
    knowledgeDocId: docPub.id,
    publicationId: pubPub.id,
    eventId: evPub.id,
    teamMemberId: lead.tm.id,
  });
  const labRes = await mkRes(mgr.client, { name: `${M} LabOnly Scope`, resourceType: "HARDWARE", description: "Internal ZZH oscilloscope", visibility: "LAB_ONLY" });
  const leakRes = await mkRes(mgr.client, {
    name: `${M} Leak Board`,
    resourceType: "BOARD",
    description: "Public resource that points at hidden things ZZL",
    visibility: "PUBLIC",
    projectIds: [projHid.id],
    researchAreaId: areaHid.id,
    groupId: groupHid.id,
    knowledgeDocId: docHid.id,
    publicationId: pubHid.id,
    eventId: evHid.id,
  });
  const privRes = await mkRes(mgr.client, { name: `${M} PrivateProj Tool`, resourceType: "TOOL", description: "On a PRIVATE project ZZP", visibility: "LAB_ONLY" });
  await prisma.resourceProject.create({ data: { resourceId: privRes.id, projectId: projPriv.id } });
  const aliceRes = await mkRes(memA.client, { name: `${M} Alice Own`, resourceType: "SOFTWARE", description: "by alice" });
  const jaRes = await mkRes(mgr.client, {
    name: `${M} Bilingual`,
    resourceType: "FRAMEWORK",
    description: "English description ZZB",
    environment: "English environment",
    visibility: "PUBLIC",
    translations: { ja: { name: "ZZ Res 二言語リソース", description: "日本語の説明 ZZJ", environment: "日本語の環境" } },
  });
  const doomedRes = await mkRes(doomed.client, { name: `${M} Doomed Owner`, resourceType: "OTHER", description: "written by an account that will be deleted" });
  check("fixtures: all resources created", [pubRes, labRes, leakRes, privRes, aliceRes, jaRes, doomedRes].every((d) => d?.id));

  // ------------------------------------------------------------------
  section("shape, content type, wire hygiene");
  const detailFields = ["id", "name", "resourceType", "description", "version", "vendor", "identifier", "url", "environment", "metadata", "excerpt", "owner", "researcher", "projects", "projectCount", "researchArea", "group", "knowledgeDoc", "publication", "event", "createdAt", "updatedAt", "canEdit", "canDelete"];
  const gPub = await guest.get(`/resources/${pubRes.id}`);
  check("detail JSON has the documented fields", detailFields.every((k) => k in gPub.json), detailFields.filter((k) => !(k in gPub.json)).join());
  check("list items carry an excerpt and NO description / environment / metadata", (await guest.get("/resources")).json.items.every((i) => "excerpt" in i && !("description" in i) && !("environment" in i) && !("metadata" in i)));
  check("responses are application/json", gPub.type.startsWith("application/json"));
  check("type, version, vendor, identifier, url round-trip", pubRes.resourceType === "DATASET" && pubRes.version === "v2.1" && pubRes.vendor === "Lab" && pubRes.identifier === "ZZRQ-ID-1" && pubRes.url === "https://example.com/data");
  check("metadata round-trips", JSON.stringify(gPub.json.metadata) === JSON.stringify({ format: "CSV", size: "2 GB", license: "CC-BY", collectionMethod: "camera rig" }));
  check("default type is OTHER and default visibility LAB_ONLY for a member", (await memA.client.post("/resources", { name: `${M} Default` })).json.resourceType === "OTHER" && (await mgr.client.get(`/resources/${aliceRes.id}`)).json.visibility === "LAB_ONLY");
  check("member does not receive `visibility`", !("visibility" in aliceRes));
  check("manager receives `visibility`", (await mgr.client.get(`/resources/${pubRes.id}`)).json.visibility === "PUBLIC");
  check("guest never receives `visibility`", !("visibility" in gPub.json));
  check("owner is the creator's public team profile", aliceRes.owner?.name === `${M} Alice` && aliceRes.owner?.id === memA.tm.id);
  check("dates are ISO UTC", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(pubRes.createdAt) && /Z$/.test(pubRes.updatedAt));
  check("canEdit/canDelete: owner yes, other member no, manager yes, guest no", aliceRes.canEdit && aliceRes.canDelete && !(await memB.client.get(`/resources/${aliceRes.id}`)).json.canEdit && (await mgr.client.get(`/resources/${aliceRes.id}`)).json.canDelete && !gPub.json.canEdit);
  check("project lead has no special edit power over someone else's resource", (await lead.client.get(`/resources/${pubRes.id}`)).json.canEdit === false);
  const wire = JSON.stringify([
    (await memB.client.get(`/resources/${aliceRes.id}`)).json,
    (await guest.get("/resources")).json,
    (await mgr.client.get("/resources?limit=50")).json,
    (await memA.client.get("/workspace")).json,
    (await guest.get("/search?q=ZZ")).json,
  ]);
  check("no account id or email on the wire", ![memA, memB, mgr, lead, doomed].some((u) => wire.includes(u.id) || wire.includes(u.email)) && !wire.includes("@example.test"));
  check("no credential material on the wire", !/passwordHash|\$2[aby]\$|scl\.sid|storageKey|"userId"|"ownerId"/.test(wire));

  // ------------------------------------------------------------------
  section("visibility (guest / member / manager)");
  const gList = await guest.get("/resources?limit=50");
  check("guest list holds only PUBLIC resources", ids(gList).includes(pubRes.id) && ids(gList).includes(leakRes.id) && ids(gList).includes(jaRes.id) && ![labRes.id, privRes.id, aliceRes.id, doomedRes.id].some((i) => ids(gList).includes(i)));
  check("guest total counts only visible resources", gList.json.pagination.total === ids(gList).length);
  const mList = await memB.client.get("/resources?limit=50");
  check("member list holds PUBLIC + LAB_ONLY, but not a stored value outside the allow-list", [pubRes, labRes, aliceRes, doomedRes].every((r) => ids(mList).includes(r.id)) && mList.status === 200);
  await prisma.labResource.update({ where: { id: privRes.id }, data: { visibility: "PRIVATE" } });
  check("a stored visibility outside the allow-list is hidden from EVERYONE incl. managers and admins", await (async () => {
    const all = [guest, memB.client, mgr.client, admin];
    for (const c of all) {
      if (ids(await c.get("/resources?limit=50")).includes(privRes.id)) return false;
      if ((await c.get(`/resources/${privRes.id}`)).status !== 404) return false;
    }
    return true;
  })());
  await prisma.labResource.update({ where: { id: privRes.id }, data: { visibility: "LAB_ONLY" } });
  check("hidden resource detail is a 404 byte-identical to a missing one", await (async () => {
    const hidden = await guest.get(`/resources/${labRes.id}`);
    const missing = await guest.get("/resources/nonexistentid12345");
    return hidden.status === 404 && missing.status === 404 && hidden.text === missing.text;
  })());
  check("malformed ids are 400 (detail, update, delete)", (await guest.get("/resources/a%20b")).status === 400 && (await guest.get(`/resources/${"x".repeat(80)}`)).status === 400 && (await mgr.client.put("/resources/a%20b", { name: "x" })).status === 400 && (await mgr.client.del("/resources/a%20b")).status === 400);
  check("a PUBLIC resource that points at hidden records names none of them to a guest", await (async () => {
    const d = (await guest.get(`/resources/${leakRes.id}`)).json;
    const s = JSON.stringify(d);
    return d.projects.length === 0 && d.projectCount === 0 && d.researchArea === null && d.group === null && d.knowledgeDoc === null && d.publication === null && d.event === null && !/Hidden|Project Hidden/.test(s) && ![projHid.id, areaHid.id, groupHid.id, docHid.id, pubHid.id, evHid.id].some((i) => s.includes(i));
  })());
  check("... and the list card of it shows no project either", await (async () => {
    const it = (await guest.get("/resources?limit=50")).json.items.find((r) => r.id === leakRes.id);
    return it.projects.length === 0 && it.projectCount === 0 && it.researchArea === null && it.group === null;
  })());
  check("a signed-in member sees the same records (LAB_ONLY is visible to any account)", await (async () => {
    const d = (await memB.client.get(`/resources/${leakRes.id}`)).json;
    return d.projects.length === 1 && d.projects[0].id === projHid.id && d.researchArea?.id === areaHid.id && d.group?.id === groupHid.id && d.knowledgeDoc?.id === docHid.id && d.publication?.id === pubHid.id && d.event?.id === evHid.id;
  })());
  check("a PRIVATE (outside the allow-list) project is never named, counted or returned", await (async () => {
    await prisma.labResource.update({ where: { id: privRes.id }, data: { visibility: "PUBLIC" } });
    const g = (await guest.get(`/resources/${privRes.id}`)).json;
    const m = (await mgr.client.get(`/resources/${privRes.id}`)).json;
    await prisma.labResource.update({ where: { id: privRes.id }, data: { visibility: "LAB_ONLY" } });
    return g.projects.length === 0 && g.projectCount === 0 && m.projects.length === 0 && m.projectCount === 0 && !JSON.stringify([g, m]).includes(projPriv.id);
  })());
  check("guest: the same project appears for a PUBLIC project only", await (async () => {
    const d = (await guest.get(`/resources/${pubRes.id}`)).json;
    return d.projects.length === 1 && d.projects[0].id === projPub.id && d.projectCount === 1 && d.researchArea?.id === areaPub.id && d.group?.id === groupPub.id && d.knowledgeDoc?.id === docPub.id && d.publication?.id === pubPub.id && d.event?.id === evPub.id;
  })());

  // ------------------------------------------------------------------
  section("filters, search text, pagination");
  const q = (c, s) => c.get(`/resources${s}`);
  check("type filter", (await q(mgr.client, "?type=DATASET&limit=50")).json.items.every((r) => r.resourceType === "DATASET") && ids(await q(mgr.client, "?type=DATASET&limit=50")).includes(pubRes.id));
  check("type filter: unknown / mis-cased / hostile values are 400", (await q(guest, "?type=dataset")).status === 400 && (await q(guest, "?type=NOPE")).status === 400 && (await q(guest, `?type=${encodeURIComponent("'; DROP TABLE LabResource; --")}`)).status === 400 && (await q(guest, "?type=%3Cscript%3E")).status === 400);
  check("empty type filter means no filter", (await q(guest, "?type=")).status === 200);
  check("project filter (visible project) lists its resources", ids(await q(guest, `?project=${projPub.id}`)).join() === pubRes.id);
  check("project filter: a hidden project answers exactly like an unknown id (empty)", await (async () => {
    const hid = await q(guest, `?project=${projHid.id}`);
    const unk = await q(guest, "?project=nonexistentid12345");
    return hid.status === 200 && JSON.stringify(hid.json) === JSON.stringify(unk.json) && hid.json.items.length === 0;
  })());
  check("project filter: a PRIVATE project is empty for everyone", ids(await q(mgr.client, `?project=${projPriv.id}`)).length === 0);
  check("project filter: a member sees the LAB_ONLY project's resources", ids(await q(memB.client, `?project=${projHid.id}`)).includes(pubRes.id) && ids(await q(memB.client, `?project=${projHid.id}`)).includes(leakRes.id));
  check("area / group / researcher / knowledge / publication filters", ids(await q(guest, `?area=${areaPub.id}`)).join() === pubRes.id && ids(await q(guest, `?group=${groupPub.id}`)).join() === pubRes.id && ids(await q(guest, `?researcher=${lead.tm.id}`)).join() === pubRes.id && ids(await q(guest, `?knowledge=${docPub.id}`)).join() === pubRes.id && ids(await q(guest, `?publication=${pubPub.id}`)).join() === pubRes.id);
  check("area / group / knowledge / publication filters on a hidden record are empty for a guest, like an unknown id", ["area", "group", "knowledge", "publication"].every(() => true) && (await Promise.all([`area=${areaHid.id}`, `group=${groupHid.id}`, `knowledge=${docHid.id}`, `publication=${pubHid.id}`].map((s) => q(guest, `?${s}`)))).every((r) => r.status === 200 && r.json.items.length === 0 && r.json.pagination.total === 0));
  check("id filters reject garbage with 400", (await Promise.all(["project=a%20b", "area=<x>", "group=a/b", "researcher=%27", "knowledge=x y", "publication=;"].map((s) => q(guest, `?${s}`)))).every((r) => r.status === 400));
  check("text search: name, description, vendor, identifier, version, environment, type", await (async () => {
    const hit = async (s) => ids(await q(guest, `?q=${encodeURIComponent(s)}`)).includes(pubRes.id);
    return (await hit("Public Dataset")) && (await hit("ZZRQ")) && (await hit("ZZRQ-ID-1")) && (await hit("v2.1")) && (await hit("seed")) && (await hit("dataset")) && !(await hit("nonexistentword"));
  })());
  check("text search is AND across words and case-insensitive", ids(await q(guest, "?q=public%20DATASET")).includes(pubRes.id) && !ids(await q(guest, "?q=public%20oscilloscope")).includes(pubRes.id));
  check("text search cannot be turned into a wildcard, and never widens visibility", (await q(guest, "?q=%25")).status === 200 && ids(await q(guest, "?q=ZZH")).length === 0 && ids(await q(memB.client, "?q=ZZH")).includes(labRes.id));
  check("text search: too many words / too long is 400", (await q(guest, "?q=a+b+c+d+e+f+g+h+i")).status === 400 && (await q(guest, `?q=${"a".repeat(101)}`)).status === 400);
  check("Japanese override is searched (any locale)", ids(await q(guest, `?q=${encodeURIComponent("二言語")}`)).includes(jaRes.id) && ids(await q(guest, `?q=${encodeURIComponent("日本語の環境")}`, "en")).includes(jaRes.id));
  check("pagination: disjoint pages, totals and totalPages match", await (async () => {
    for (let i = 0; i < 7; i++) await mkRes(mgr.client, { name: `${M} Page ${i}`, resourceType: "SENSOR", description: "ZZPG", visibility: "PUBLIC" });
    const a = (await q(guest, "?q=ZZPG&limit=3&page=1")).json, b = (await q(guest, "?q=ZZPG&limit=3&page=2")).json, c = (await q(guest, "?q=ZZPG&limit=3&page=3")).json, d = (await q(guest, "?q=ZZPG&limit=3&page=4")).json;
    const all = [...a.items, ...b.items, ...c.items].map((r) => r.id);
    return a.pagination.total === 7 && a.pagination.totalPages === 3 && all.length === 7 && new Set(all).size === 7 && d.items.length === 0;
  })());
  check("order is newest-edited first and deterministic", await (async () => {
    const a = (await q(guest, "?limit=50")).json.items, b = (await q(guest, "?limit=50")).json.items;
    return JSON.stringify(a.map((r) => r.id)) === JSON.stringify(b.map((r) => r.id)) && a.every((r, i) => i === 0 || a[i - 1].updatedAt >= r.updatedAt);
  })());
  check("page / limit bounds are validated", (await q(guest, "?page=0")).status === 400 && (await q(guest, "?limit=51")).status === 400 && (await q(guest, "?limit=0")).status === 400 && (await q(guest, "?limit=abc")).status === 400 && (await q(guest, "?page=1.5")).status === 400 && (await q(guest, "?limit=50")).status === 200);
  check("visibility filter: 403 for guest/member, works for manager/admin, 400 for garbage", (await q(guest, "?visibility=PUBLIC")).status === 403 && (await q(memA.client, "?visibility=PUBLIC")).status === 403 && (await q(mgr.client, "?visibility=LAB_ONLY&limit=50")).json.items.every((r) => r.visibility === "LAB_ONLY") && (await q(admin, "?visibility=PUBLIC&limit=50")).json.items.every((r) => r.visibility === "PUBLIC") && (await q(mgr.client, "?visibility=SECRET")).status === 400);
  check("mine=1: 401 for a guest, 400 for garbage", (await q(guest, "?mine=1")).status === 401 && (await q(memA.client, "?mine=2")).status === 400);

  // ------------------------------------------------------------------
  section("create / validate");
  const bad = async (body, label, status = 400) => check(`create rejects ${label}`, (await memA.client.post("/resources", body)).status === status);
  await bad({}, "an empty body");
  await bad({ name: "" }, "a blank name");
  await bad({ name: "   " }, "a whitespace name");
  await bad({ name: 5 }, "a numeric name");
  await bad({ name: "x".repeat(201) }, "a 201-char name");
  await bad({ name: "x", description: "y".repeat(5001) }, "an oversized description");
  await bad({ name: "x", environment: "y".repeat(5001) }, "oversized environment notes");
  await bad({ name: "x", version: "y".repeat(201) }, "an oversized version");
  await bad({ name: "x", resourceType: "dataset" }, "a mis-cased type");
  await bad({ name: "x", resourceType: "ROCKET" }, "an unknown type");
  await bad({ name: "x", resourceType: ["DATASET"] }, "an array type");
  await bad({ name: "x", url: "javascript:alert(1)" }, "a javascript: URL");
  await bad({ name: "x", url: "data:text/html,<script>alert(1)</script>" }, "a data: URL");
  await bad({ name: "x", url: "ftp://example.com/x" }, "an ftp URL");
  await bad({ name: "x", url: "not a url" }, "a malformed URL");
  await bad({ name: "x", url: "//evil.example" }, "a protocol-relative URL");
  await bad({ name: "x", url: `https://example.com/${"a".repeat(2050)}` }, "an oversized URL");
  await bad({ name: "x", metadata: "format=CSV" }, "string metadata");
  await bad({ name: "x", metadata: ["a"] }, "array metadata");
  await bad({ name: "x", resourceType: "DATASET", metadata: { firmwareVersion: "1" } }, "a metadata key that does not apply to the type");
  await bad({ name: "x", resourceType: "OTHER", metadata: { format: "x" } }, "any metadata on OTHER");
  await bad({ name: "x", resourceType: "DATASET", metadata: { format: "y".repeat(501) } }, "an oversized metadata value");
  await bad({ name: "x", resourceType: "DATASET", metadata: { format: 5 } }, "a numeric metadata value");
  await bad({ name: "x", resourceType: "DATASET", metadata: { __proto__: "x", constructor: "y" } }, "prototype-ish metadata keys");
  await bad({ name: "x", projectIds: ["a b"] }, "a malformed project id");
  await bad({ name: "x", projectIds: "abc" }, "a non-array projectIds");
  await bad({ name: "x", projectIds: Array.from({ length: 51 }, (_, i) => `id${i}`) }, "more than 50 projects");
  await bad({ name: "x", projectIds: [projPub.id, projPub.id] }, "duplicate projects");
  await bad({ name: "x", projectIds: ["nonexistentid12345"] }, "an unknown project");
  await bad({ name: "x", researchAreaId: "nonexistentid12345" }, "an unknown area");
  await bad({ name: "x", groupId: "nonexistentid12345" }, "an unknown group");
  await bad({ name: "x", knowledgeDocId: "nonexistentid12345" }, "an unknown document");
  await bad({ name: "x", publicationId: "nonexistentid12345" }, "an unknown publication");
  await bad({ name: "x", eventId: "nonexistentid12345" }, "an unknown event");
  await bad({ name: "x", teamMemberId: "nonexistentid12345" }, "an unknown researcher");
  await bad({ name: "x", researchAreaId: "a b" }, "a malformed area id");
  await bad("{not json", "malformed JSON");
  await bad({ name: "x", visibility: "PUBLIC" }, "a member setting visibility (403)", 403);
  await bad({ name: "x", visibility: "PRIVATE" }, "a member sending an invalid visibility (400 before 403)");
  await bad({ name: "x", translations: { ja: { name: 5 } } }, "a numeric Japanese name");
  await bad({ name: "x", translations: { ja: { name: "y".repeat(201) } } }, "an oversized Japanese name");
  await bad({ name: "x", translations: { ja: { environment: "y".repeat(5001) } } }, "oversized Japanese environment notes");
  check("create is 401 for a guest", (await guest.post("/resources", { name: "x" })).status === 401);
  check("a rejected create writes no row", (await prisma.labResource.count({ where: { name: "x" } })) === 0);
  check("hostile ownership fields are ignored (ownerId / owner / id / createdAt)", await (async () => {
    const r = await memA.client.post("/resources", { name: `${M} Owner Spoof`, ownerId: memB.id, owner: { id: memB.tm.id }, id: "customid", createdAt: "2000-01-01T00:00:00Z" });
    const row = await prisma.labResource.findUnique({ where: { id: r.json.id } });
    return r.status === 201 && row.ownerId === memA.id && r.json.id !== "customid" && !r.json.createdAt.startsWith("2000");
  })());
  check("a manager can publish on create, and metadata/URL are normalised", await (async () => {
    const r = await mgr.client.post("/resources", { name: `  ${M} Trim  `, resourceType: "FPGA", url: "  https://example.com/a  ", visibility: "PUBLIC", metadata: { hardwareRevision: "  rev B ", firmwareVersion: "", toolchain: "Vivado 2024.1" } });
    return r.status === 201 && r.json.name === `${M} Trim` && r.json.url === "https://example.com/a" && r.json.visibility === "PUBLIC" && JSON.stringify(r.json.metadata) === JSON.stringify({ hardwareRevision: "rev B", toolchain: "Vivado 2024.1" });
  })());
  check("metadata is stored as allow-listed JSON only", await (async () => {
    const row = await prisma.labResource.findUnique({ where: { id: pubRes.id } });
    return JSON.stringify(Object.keys(JSON.parse(row.metadata))) === JSON.stringify(["format", "size", "license", "collectionMethod"]);
  })());
  check("a stored value outside the metadata / type / URL allow-lists is rendered safely", await (async () => {
    const row = await prisma.labResource.create({ data: { name: `${M} Tampered`, resourceType: "WEIRD", visibility: "PUBLIC", url: "javascript:alert(1)", metadata: JSON.stringify({ format: "x", evil: "y", configuration: "z" }) } });
    const d = (await guest.get(`/resources/${row.id}`)).json;
    const bad2 = await prisma.labResource.create({ data: { name: `${M} Tampered2`, resourceType: "DATASET", visibility: "PUBLIC", metadata: "{not json" } });
    const d2 = (await guest.get(`/resources/${bad2.id}`)).json;
    return d.resourceType === "OTHER" && d.url === "" && Object.keys(d.metadata).length === 0 && d2.resourceType === "DATASET" && Object.keys(d2.metadata).length === 0;
  })());
  check("a project set and every link is stored on create", await (async () => {
    const rows = await prisma.resourceProject.findMany({ where: { resourceId: pubRes.id } });
    return rows.map((r) => r.projectId).sort().join() === [projPub.id, projHid.id].sort().join();
  })());
  check("the caller cannot link a record they cannot see (a PRIVATE project reads as missing)", (await mgr.client.post("/resources", { name: `${M} X`, projectIds: [projPriv.id] })).status === 400 && (await mgr.client.post("/resources", { name: `${M} X`, researchAreaId: areaPriv.id })).status === 400 && (await mgr.client.post("/resources", { name: `${M} X`, groupId: groupPriv.id })).status === 400);
  check("the link error is the same for an invisible and a missing project", await (async () => {
    const a = await mgr.client.post("/resources", { name: `${M} X`, projectIds: [projPriv.id] });
    const b = await mgr.client.post("/resources", { name: `${M} X`, projectIds: ["nonexistentid12345"] });
    return a.text === b.text;
  })());

  // ------------------------------------------------------------------
  section("exact link messages, hidden documents / publications / events, paging default, excerpt, related titles");
  const docPriv = await prisma.knowledgeDoc.create({ data: { title: `${M} Doc Private`, body: "b", visibility: "PRIVATE" } });
  const pubPriv = await prisma.publication.create({ data: { year: 2030, title: `${M} Paper Private`, authors: "A", venue: "V", visibility: "PRIVATE" } });
  const evPriv = await prisma.event.create({ data: { title: `${M} Event Private`, startsAt: new Date("2030-01-01T00:00:00Z"), visibility: "PRIVATE" } });
  const msgOf = async (body, c = memA.client) => (await c.post("/resources", { name: `${M} Msg`, ...body })).json?.error;
  check("a nonexistent link is 400 with the exact message (never the generic foreign-key fallback)", (await msgOf({ researchAreaId: "nonexistentid12345" })) === "Research area not found." && (await msgOf({ groupId: "nonexistentid12345" })) === "Group not found." && (await msgOf({ knowledgeDocId: "nonexistentid12345" })) === "Document not found." && (await msgOf({ publicationId: "nonexistentid12345" })) === "Publication not found." && (await msgOf({ eventId: "nonexistentid12345" })) === "Event not found." && (await msgOf({ teamMemberId: "nonexistentid12345" })) === "Researcher not found." && (await msgOf({ projectIds: ["nonexistentid12345"] })) === "Project not found.");
  check("a project / area / group / document / publication / event outside the allow-list reads as missing, for members AND managers", (await msgOf({ projectIds: [projPriv.id] })) === "Project not found." && (await msgOf({ researchAreaId: areaPriv.id })) === "Research area not found." && (await msgOf({ groupId: groupPriv.id })) === "Group not found." && (await msgOf({ knowledgeDocId: docPriv.id })) === "Document not found." && (await msgOf({ publicationId: pubPriv.id })) === "Publication not found." && (await msgOf({ eventId: evPriv.id })) === "Event not found." && (await msgOf({ knowledgeDocId: docPriv.id }, mgr.client)) === "Document not found." && (await msgOf({ publicationId: pubPriv.id }, mgr.client)) === "Publication not found." && (await msgOf({ eventId: evPriv.id }, mgr.client)) === "Event not found.");
  check("the same holds on update (a hidden link is refused and nothing is written)", (await mgr.client.put(`/resources/${aliceRes.id}`, { knowledgeDocId: docPriv.id })).json?.error === "Document not found." && (await mgr.client.put(`/resources/${aliceRes.id}`, { publicationId: pubPriv.id })).json?.error === "Publication not found." && (await mgr.client.put(`/resources/${aliceRes.id}`, { eventId: evPriv.id })).json?.error === "Event not found." && (await mgr.client.put(`/resources/${aliceRes.id}`, { teamMemberId: "nonexistentid12345" })).json?.error === "Researcher not found." && (await prisma.labResource.findUnique({ where: { id: aliceRes.id } })).knowledgeDocId === null);
  check("the default page size is 12 and is reported", (await guest.get("/resources")).json.pagination.limit === 12 && (await guest.get("/resources")).json.items.length <= 12);
  check("a list card's excerpt is cut at 200 characters with an ellipsis; the detail keeps the whole description", await (async () => {
    const long = "x".repeat(300);
    const r = (await mgr.client.post("/resources", { name: `${M} Long Description`, description: long, visibility: "PUBLIC" })).json;
    const card = (await guest.get(`/resources?q=Long%20Description`)).json.items.find((x) => x.id === r.id);
    return card.excerpt.length === 201 && card.excerpt.endsWith("…") && !("description" in card) && (await guest.get(`/resources/${r.id}`)).json.description === long;
  })());
  check("related document / publication / event titles are localized on the detail page", await (async () => {
    await prisma.translation.createMany({ data: [{ entityType: "KNOWLEDGE_DOC", entityId: docPub.id, locale: "ja", field: "title", value: `${M} 文書` }, { entityType: "PUBLICATION", entityId: pubPub.id, locale: "ja", field: "title", value: `${M} 論文` }, { entityType: "EVENT", entityId: evPub.id, locale: "ja", field: "title", value: `${M} 催し` }] });
    const ja = (await guest.get(`/resources/${pubRes.id}`, "ja")).json;
    const en = (await guest.get(`/resources/${pubRes.id}`, "en")).json;
    return ja.knowledgeDoc.title === `${M} 文書` && ja.publication.title === `${M} 論文` && ja.event.title === `${M} 催し` && en.knowledgeDoc.title === `${M} Doc Public` && en.publication.title === `${M} Paper Public` && en.event.title === `${M} Event Public`;
  })());

  // ------------------------------------------------------------------
  section("update / delete / permissions");
  check("owner may edit their own resource", (await memA.client.put(`/resources/${aliceRes.id}`, { description: "edited by alice" })).json?.description === "edited by alice");
  check("another member gets 403", (await memB.client.put(`/resources/${aliceRes.id}`, { description: "hijack" })).status === 403 && (await memB.client.del(`/resources/${aliceRes.id}`)).status === 403);
  check("a project lead gets no extra power over a resource of their project", (await lead.client.put(`/resources/${pubRes.id}`, { description: "hijack" })).status === 403 && (await lead.client.del(`/resources/${pubRes.id}`)).status === 403);
  check("a guest gets 401", (await guest.put(`/resources/${aliceRes.id}`, { description: "x" })).status === 401 && (await guest.del(`/resources/${aliceRes.id}`)).status === 401);
  check("a manager may edit and admin may edit anyone's", (await mgr.client.put(`/resources/${aliceRes.id}`, { version: "9" })).json?.version === "9" && (await admin.put(`/resources/${aliceRes.id}`, { version: "10" })).json?.version === "10");
  check("a 403 or 404 writes nothing", (await prisma.labResource.findUnique({ where: { id: aliceRes.id } })).description === "edited by alice" && (await memA.client.put("/resources/nonexistentid12345", { name: "x" })).status === 404 && (await memA.client.del("/resources/nonexistentid12345")).status === 404);
  check("PUT requires something to update", (await memA.client.put(`/resources/${aliceRes.id}`, {})).status === 400 && (await memA.client.put(`/resources/${aliceRes.id}`, { bogus: 1 })).status === 400);
  check("a member cannot change visibility (403, nothing written); a manager can", await (async () => {
    const r = await memA.client.put(`/resources/${aliceRes.id}`, { visibility: "PUBLIC" });
    const still = (await prisma.labResource.findUnique({ where: { id: aliceRes.id } })).visibility;
    const m = await mgr.client.put(`/resources/${aliceRes.id}`, { visibility: "PUBLIC" });
    const back = await mgr.client.put(`/resources/${aliceRes.id}`, { visibility: "LAB_ONLY" });
    return r.status === 403 && still === "LAB_ONLY" && m.status === 200 && m.json.visibility === "PUBLIC" && back.json.visibility === "LAB_ONLY";
  })());
  check("an owner cannot transfer ownership or fake it in a PUT", await (async () => {
    await memA.client.put(`/resources/${aliceRes.id}`, { ownerId: memB.id, owner: { id: memB.tm.id }, description: "still alice" });
    return (await prisma.labResource.findUnique({ where: { id: aliceRes.id } })).ownerId === memA.id;
  })());
  check("edit validates like create", (await memA.client.put(`/resources/${aliceRes.id}`, { name: "" })).status === 400 && (await memA.client.put(`/resources/${aliceRes.id}`, { url: "javascript:alert(1)" })).status === 400 && (await memA.client.put(`/resources/${aliceRes.id}`, { resourceType: "nope" })).status === 400);
  check("metadata must fit the type on update", await (async () => {
    const r = await mgr.client.post("/resources", { name: `${M} Meta`, resourceType: "DATASET", metadata: { format: "CSV" } });
    const wrong = await mgr.client.put(`/resources/${r.json.id}`, { metadata: { firmwareVersion: "1" } });
    const retype = await mgr.client.put(`/resources/${r.json.id}`, { resourceType: "HARDWARE" });
    const both = await mgr.client.put(`/resources/${r.json.id}`, { resourceType: "HARDWARE", metadata: { firmwareVersion: "1" } });
    const bothBad = await mgr.client.put(`/resources/${r.json.id}`, { resourceType: "SOFTWARE", metadata: { firmwareVersion: "1" } });
    const cleared = await mgr.client.put(`/resources/${r.json.id}`, { metadata: {} });
    return wrong.status === 400 && retype.status === 400 && both.status === 200 && both.json.metadata.firmwareVersion === "1" && bothBad.status === 400 && cleared.status === 200 && Object.keys(cleared.json.metadata).length === 0;
  })());
  check("retyping without metadata is fine when nothing stored conflicts", await (async () => {
    const r = await mgr.client.post("/resources", { name: `${M} Retype`, resourceType: "SOFTWARE" });
    const t = await mgr.client.put(`/resources/${r.json.id}`, { resourceType: "TOOL" });
    return t.status === 200 && t.json.resourceType === "TOOL";
  })());
  check("projectIds is the COMPLETE set: add, remove, replace and clear", await (async () => {
    const r = (await mgr.client.post("/resources", { name: `${M} Links`, projectIds: [projPub.id] })).json;
    const add = await mgr.client.put(`/resources/${r.id}`, { projectIds: [projPub.id, projHid.id] });
    const rem = await mgr.client.put(`/resources/${r.id}`, { projectIds: [projHid.id] });
    const keep = await mgr.client.put(`/resources/${r.id}`, { name: `${M} Links Renamed` });
    const clr = await mgr.client.put(`/resources/${r.id}`, { projectIds: [] });
    return add.json.projectCount === 2 && rem.json.projects.map((p) => p.id).join() === projHid.id && keep.json.projectCount === 1 && clr.json.projectCount === 0 && (await prisma.resourceProject.count({ where: { resourceId: r.id } })) === 0;
  })());
  check("a link that is not being changed is not re-checked (a later-hidden project stays editable)", await (async () => {
    const r = (await mgr.client.post("/resources", { name: `${M} KeepHidden`, projectIds: [projPub.id], researchAreaId: areaPub.id })).json;
    await prisma.researchProject.update({ where: { id: projPub.id }, data: { visibility: "PRIVATE" } });
    await prisma.researchArea.update({ where: { id: areaPub.id }, data: { visibility: "PRIVATE" } });
    const edit = await mgr.client.put(`/resources/${r.id}`, { description: "still editable", researchAreaId: areaPub.id, projectIds: [] });
    const links = await prisma.resourceProject.count({ where: { resourceId: r.id } });
    await prisma.researchProject.update({ where: { id: projPub.id }, data: { visibility: "PUBLIC" } });
    await prisma.researchArea.update({ where: { id: areaPub.id }, data: { visibility: "PUBLIC" } });
    // an editor who cannot see a linked project cannot have removed it by omitting it: it is preserved
    return edit.status === 200 && links === 1;
  })());
  check("more than 50 visible project links: an edit that sends projectIds is refused (400) and NO link is deleted; other edits and <=50 still work", await (async () => {
    const bulk = [];
    for (let i = 0; i < 52; i++) bulk.push(await prisma.researchProject.create({ data: { slug: `zz-res-bulk-${i}`, title: `${M} Bulk ${String(i).padStart(2, "0")}`, visibility: "PUBLIC" } }));
    const r = (await mgr.client.post("/resources", { name: `${M} Bulk Links`, projectIds: bulk.slice(0, 50).map((p) => p.id) })).json;
    // beyond the API cap: attach 2 more visible + 1 hidden(PRIVATE) link directly (as concurrent edits / old data could)
    await prisma.resourceProject.createMany({ data: [bulk[50].id, bulk[51].id, projPriv.id].map((projectId) => ({ resourceId: r.id, projectId })) });
    const count = () => prisma.resourceProject.count({ where: { resourceId: r.id } });
    const detail = (await mgr.client.get(`/resources/${r.id}`)).json;
    const shown = detail.projects.map((p) => p.id);
    const edit = await mgr.client.put(`/resources/${r.id}`, { description: "edited", projectIds: shown });
    const clear = await mgr.client.put(`/resources/${r.id}`, { projectIds: [] });
    const dupe = await mgr.client.put(`/resources/${r.id}`, { projectIds: [shown[0], shown[0]] });
    const nameOnly = await mgr.client.put(`/resources/${r.id}`, { description: "edited without links" });
    const still = await count();
    // bring it back to 50 visible (+1 hidden): the normal complete-set edit works again and still keeps the hidden link
    await prisma.resourceProject.deleteMany({ where: { resourceId: r.id, projectId: { in: [bulk[50].id, bulk[51].id] } } });
    const ok = await mgr.client.put(`/resources/${r.id}`, { projectIds: bulk.slice(0, 49).map((p) => p.id) });
    const after = await prisma.resourceProject.findMany({ where: { resourceId: r.id }, select: { projectId: true } });
    return shown.length === 50 && detail.projectCount === 52 && edit.status === 400 && /more than 50/.test(edit.json.error ?? "") && clear.status === 400 && dupe.status === 400 && nameOnly.status === 200 && still === 53 && ok.status === 200 && after.length === 50 && after.some((l) => l.projectId === projPriv.id) && !after.some((l) => l.projectId === bulk[49].id);
  })());
  check("single links can be set, changed and cleared to null", await (async () => {
    const r = (await mgr.client.post("/resources", { name: `${M} Singles` })).json;
    const set = await mgr.client.put(`/resources/${r.id}`, { researchAreaId: areaPub.id, groupId: groupPub.id, knowledgeDocId: docPub.id, publicationId: pubPub.id, eventId: evPub.id, teamMemberId: lead.tm.id });
    const clr = await mgr.client.put(`/resources/${r.id}`, { researchAreaId: null, groupId: null, knowledgeDocId: null, publicationId: null, eventId: null, teamMemberId: null });
    return set.json.researchArea?.id === areaPub.id && set.json.event?.id === evPub.id && set.json.researcher?.id === lead.tm.id && clr.status === 200 && !clr.json.researchArea && !clr.json.group && !clr.json.knowledgeDoc && !clr.json.publication && !clr.json.event && !clr.json.researcher;
  })());
  check("delete removes the resource, its project links and its translations", await (async () => {
    const r = (await memA.client.post("/resources", { name: `${M} Deletable`, projectIds: [projPub.id], translations: { ja: { name: "ZZ Res 消す" } } })).json;
    const d = await memA.client.del(`/resources/${r.id}`);
    return d.status === 200 && (await guest.get(`/resources/${r.id}`)).status === 404 && (await prisma.resourceProject.count({ where: { resourceId: r.id } })) === 0 && (await prisma.translation.count({ where: { entityType: "LAB_RESOURCE", entityId: r.id } })) === 0 && (await memA.client.del(`/resources/${r.id}`)).status === 404;
  })());

  // ------------------------------------------------------------------
  section("deleted relationships");
  check("deleting a project / area / group / document / publication / event / researcher KEEPS the resource and clears the link", await (async () => {
    const p = await prisma.researchProject.create({ data: { slug: "zz-res-del-p", title: `${M} Del P`, visibility: "PUBLIC" } });
    const a = await prisma.researchArea.create({ data: { title: `${M} Del A`, description: "d", tag: "t", visibility: "PUBLIC" } });
    const g = await prisma.researchGroup.create({ data: { slug: "zz-res-del-g", name: `${M} Del G`, visibility: "PUBLIC" } });
    const d = await prisma.knowledgeDoc.create({ data: { title: `${M} Del D`, body: "b", visibility: "PUBLIC" } });
    const pu = await prisma.publication.create({ data: { year: 2031, title: `${M} Del Pub`, authors: "a", venue: "v", visibility: "PUBLIC" } });
    const e = await prisma.event.create({ data: { title: `${M} Del E`, startsAt: new Date("2031-01-01T00:00:00Z"), visibility: "PUBLIC" } });
    const t = await prisma.teamMember.create({ data: { name: `${M} Del T`, initials: "DT", role: "r", category: "RESEARCH" } });
    const r = (await mgr.client.post("/resources", { name: `${M} Survivor`, visibility: "PUBLIC", projectIds: [p.id], researchAreaId: a.id, groupId: g.id, knowledgeDocId: d.id, publicationId: pu.id, eventId: e.id, teamMemberId: t.id })).json;
    await prisma.researchProject.delete({ where: { id: p.id } });
    await prisma.researchArea.delete({ where: { id: a.id } });
    await prisma.researchGroup.delete({ where: { id: g.id } });
    await prisma.knowledgeDoc.delete({ where: { id: d.id } });
    await prisma.publication.delete({ where: { id: pu.id } });
    await prisma.event.delete({ where: { id: e.id } });
    await prisma.teamMember.delete({ where: { id: t.id } });
    const after = (await guest.get(`/resources/${r.id}`)).json;
    return after.name === `${M} Survivor` && after.projects.length === 0 && after.projectCount === 0 && !after.researchArea && !after.group && !after.knowledgeDoc && !after.publication && !after.event && !after.researcher && (await prisma.resourceProject.count({ where: { resourceId: r.id } })) === 0;
  })());
  check("a deleted owner's resource stays, has no owner, and only managers can change it", await (async () => {
    await admin.del(`/users/${doomed.id}`);
    const d = (await mgr.client.get(`/resources/${doomedRes.id}`)).json;
    const edit = await memB.client.put(`/resources/${doomedRes.id}`, { description: "x" });
    const mEdit = await mgr.client.put(`/resources/${doomedRes.id}`, { description: "manager edit" });
    return d.owner === null && d.canEdit === true && edit.status === 403 && mEdit.status === 200 && (await memB.client.get(`/resources/${doomedRes.id}`)).json.canEdit === false;
  })());

  // ------------------------------------------------------------------
  section("translations (English base, Japanese override)");
  const jaGet = await guest.get(`/resources/${jaRes.id}`, "ja");
  check("ja shows the override for every translated field", jaGet.json.name === "ZZ Res 二言語リソース" && jaGet.json.description === "日本語の説明 ZZJ" && jaGet.json.environment === "日本語の環境");
  check("en / garbage / missing locale show English", await (async () => {
    for (const l of ["en", "xx", "", undefined, "JA", "ja-JP"]) if ((await guest.get(`/resources/${jaRes.id}`, l)).json.name !== `${M} Bilingual`) return false;
    return true;
  })());
  check("the list is localized too, and the excerpt follows the override", (await guest.get("/resources?q=ZZJ&limit=50", "ja")).json.items.find((r) => r.id === jaRes.id)?.excerpt === "日本語の説明 ZZJ");
  check("a missing / blank override falls back to English PER field", await (async () => {
    await mgr.client.put(`/resources/${jaRes.id}`, { translations: { ja: { description: "" } } });
    const d = (await guest.get(`/resources/${jaRes.id}`, "ja")).json;
    return d.name === "ZZ Res 二言語リソース" && d.description === "English description ZZB" && d.environment === "日本語の環境";
  })());
  check("a Japanese edit never overwrites English", await (async () => {
    await mgr.client.put(`/resources/${jaRes.id}`, { translations: { ja: { name: "ZZ Res 新しい名前" } } }, "ja");
    const row = await prisma.labResource.findUnique({ where: { id: jaRes.id } });
    return row.name === `${M} Bilingual` && (await guest.get(`/resources/${jaRes.id}`, "ja")).json.name === "ZZ Res 新しい名前";
  })());
  check("PUT with an X-Locale: ja header and a base field writes that base field (English column), not a translation", await (async () => {
    await mgr.client.put(`/resources/${jaRes.id}`, { vendor: "Vendor X" }, "ja");
    return (await prisma.labResource.findUnique({ where: { id: jaRes.id } })).vendor === "Vendor X";
  })());
  check("GET /api/translations returns the English base and the Japanese override (signed-in only)", await (async () => {
    const r = await mgr.client.get(`/translations/LAB_RESOURCE/${jaRes.id}`);
    return r.status === 200 && r.json.base.name === `${M} Bilingual` && r.json.ja.name === "ZZ Res 新しい名前" && r.json.ja.description === null && Object.keys(r.json.ja).join() === "name,description,environment" && (await guest.get(`/translations/LAB_RESOURCE/${jaRes.id}`)).status === 401;
  })());
  check("translations: unknown fields are stripped, long values rejected, clear works", await (async () => {
    const ok = await mgr.client.put(`/resources/${jaRes.id}`, { translations: { ja: { bogus: "x", environment: null } } });
    const gone = (await prisma.translation.findFirst({ where: { entityType: "LAB_RESOURCE", entityId: jaRes.id, field: "bogus" } })) === null;
    const cleared = (await prisma.translation.findFirst({ where: { entityType: "LAB_RESOURCE", entityId: jaRes.id, field: "environment" } })) === null;
    const tooLong = await mgr.client.put(`/resources/${jaRes.id}`, { translations: { ja: { description: "あ".repeat(5001) } } });
    return ok.status === 200 && gone && cleared && tooLong.status === 400;
  })());
  check("a member cannot write a translation on someone else's resource", (await memB.client.put(`/resources/${aliceRes.id}`, { translations: { ja: { name: "ZZ Res 乗っ取り" } } })).status === 403 && (await prisma.translation.count({ where: { entityType: "LAB_RESOURCE", entityId: aliceRes.id } })) === 0);
  check("locale never changes an authorization outcome (nine probes x five locales)", await (async () => {
    const probes = [
      (c, l) => c.get(`/resources/${labRes.id}`, l),
      (c, l) => c.get(`/resources/${pubRes.id}`, l),
      (c, l) => c.get("/resources?visibility=PUBLIC", l),
      (c, l) => c.get("/resources?mine=1", l),
      (c, l) => c.put(`/resources/${pubRes.id}`, { description: "x" }, l),
      (c, l) => c.del(`/resources/${labRes.id}`, l),
      (c, l) => c.post("/resources", { name: "x", visibility: "PUBLIC" }, l),
      (c, l) => c.get(`/resources?project=${projHid.id}`, l),
      (c, l) => c.get(`/resources/${privRes.id}`, l),
    ];
    for (const c of [guest, memB.client]) {
      for (const p of probes) {
        const seen = new Set();
        for (const l of ["en", "ja", "zz", "", undefined]) seen.add((await p(c, l)).status);
        if (seen.size !== 1) return false;
      }
    }
    return true;
  })());

  // ------------------------------------------------------------------
  section("hostile text");
  const XSS = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', "javascript:alert(1)", "<iframe src=javascript:alert(1)>", "' OR 1=1 --"];
  check("hostile text in every text field is stored verbatim, returned as JSON, never executed server-side", await (async () => {
    for (const x of XSS) {
      const r = await mgr.client.post("/resources", {
        name: `${M} ${x}`,
        resourceType: "DATASET",
        description: x,
        version: x,
        vendor: x,
        identifier: x,
        environment: x,
        metadata: { format: x, size: x, license: x, collectionMethod: x },
        visibility: "PUBLIC",
        translations: { ja: { name: `ZZ Res ${x}`, description: x, environment: x } },
      });
      if (r.status !== 201 || r.json.description !== x || r.json.metadata.format !== x || !r.type.startsWith("application/json")) return false;
      const g = await guest.get(`/resources/${r.json.id}`, "ja");
      if (g.status !== 200 || g.json.environment !== x || !g.type.startsWith("application/json")) return false;
      if (g.text.includes("<script>") && !g.text.includes("\\u003c") && !g.text.includes('"<script>')) return false;
    }
    return true;
  })());
  check("hostile text is searchable as data and does not break the search", (await guest.get(`/search?q=${encodeURIComponent("<script>")}&type=resource`)).status === 200 && (await guest.get("/search?q=OR%201%3D1&type=resource")).status === 200);
  check("hostile names in the list and in admin come back as data", (await guest.get("/resources?limit=50")).status === 200 && (await mgr.client.get("/admin/content?type=resource&limit=100")).status === 200);
  check("a hostile URL never comes back as a link (javascript:, mixed-case, whitespace, entity)", await (async () => {
    for (const u of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "&#106;avascript:alert(1)", "vbscript:x", "file:///etc/passwd"]) {
      if ((await mgr.client.post("/resources", { name: `${M} URL`, url: u })).status !== 400) return false;
    }
    return true;
  })());

  // ------------------------------------------------------------------
  section("search integration");
  const sType = (c, s, t = "resource", extra = "", l) => c.get(`/search?q=${encodeURIComponent(s)}&type=${t}${extra}`, l);
  check("resource is a search type with a count chip; `all` is still the sum", await (async () => {
    const r = (await guest.get("/search?q=ZZ")).json;
    return typeof r.counts.resource === "number" && r.counts.all === Object.entries(r.counts).filter(([k]) => k !== "all").reduce((a, [, v]) => a + v, 0);
  })());
  check("a resource result has type, title, description, href and no relationship columns", await (async () => {
    const r = (await sType(guest, "ZZRQ")).json.results.find((x) => x.id === pubRes.id);
    return r && r.type === "resource" && r.title === `${M} Public Dataset` && r.href === `/resources/${pubRes.id}` && r.description.includes("ZZRQ") && !("projects" in r) && !("group" in r);
  })());
  check("search: name, description, identifier, version, type and environment are searched", await (async () => {
    for (const s of ["Public Dataset", "ZZRQ", "ZZRQ-ID-1", "v2.1", "Python 3.11"]) if (!(await sType(guest, s)).json.results.some((x) => x.id === pubRes.id)) return false;
    return true;
  })());
  check("search: a guest never finds a LAB_ONLY resource nor its count; a member does", await (async () => {
    const g = (await guest.get("/search?q=ZZH")).json;
    const m = (await sType(memB.client, "ZZH")).json;
    return g.results.every((x) => x.id !== labRes.id) && g.counts.resource === 0 && m.results.some((x) => x.id === labRes.id) && m.counts.resource === 1;
  })());
  check("search: an outside-the-allow-list resource is invisible to everyone", await (async () => {
    await prisma.labResource.update({ where: { id: privRes.id }, data: { visibility: "PRIVATE" } });
    const r = await Promise.all([guest, memB.client, mgr.client, admin].map((c) => sType(c, "PrivateProj")));
    await prisma.labResource.update({ where: { id: privRes.id }, data: { visibility: "LAB_ONLY" } });
    return r.every((x) => x.json.results.length === 0 && x.json.counts.resource === 0);
  })());
  check("search: Japanese override is matched and shown; English is not touched", await (async () => {
    const ja = (await sType(guest, "新しい名前", "resource", "", "ja")).json.results.find((x) => x.id === jaRes.id);
    const en = (await sType(guest, "新しい名前", "resource", "", "en")).json;
    return ja?.title === "ZZ Res 新しい名前" && en.results.every((x) => x.id !== jaRes.id); // global search matches Japanese overrides only for a Japanese request (Phase 14 convention)
  })());
  check("search: a Japanese search result carries no English label in `meta`", await (async () => {
    const ja = (await sType(guest, "新しい名前", "resource", "", "ja")).json.results.find((x) => x.id === jaRes.id);
    return ja && ja.meta === "Vendor X" && !/dataset|framework|resource/i.test(ja.meta);
  })());
  check("search: type filter narrows to resources; other types unaffected", await (async () => {
    const all = (await guest.get("/search?q=Public")).json;
    const only = (await sType(guest, "Public")).json;
    return only.results.every((r) => r.type === "resource") && all.counts.resource === only.counts.resource && all.results.some((r) => r.type !== "resource");
  })());
  check("search pagination over resources is disjoint and totals match", await (async () => {
    const a = (await sType(guest, "ZZPG", "resource", "&limit=3&page=1")).json, b = (await sType(guest, "ZZPG", "resource", "&limit=3&page=2")).json, c = (await sType(guest, "ZZPG", "resource", "&limit=3&page=3")).json;
    const all = [...a.results, ...b.results, ...c.results].map((r) => r.id);
    return a.pagination.total === 7 && all.length === 7 && new Set(all).size === 7;
  })());
  check("search order is deterministic (title A-Z within a tier)", await (async () => {
    const a = (await sType(guest, "ZZPG", "resource", "&limit=50")).json.results.map((r) => r.title);
    return JSON.stringify(a) === JSON.stringify([...a].sort());
  })());
  check("search `related` links only visible records", await (async () => {
    const g = (await sType(guest, "ZZL")).json.results.find((r) => r.id === leakRes.id);
    const m = (await sType(memB.client, "ZZL")).json.results.find((r) => r.id === leakRes.id);
    const p = (await sType(guest, "ZZRQ")).json.results.find((r) => r.id === pubRes.id);
    return !g.related && m.related.length === 3 && p.related.map((r) => r.id).sort().join() === [projPub.id, areaPub.id, groupPub.id].sort().join();
  })());
  check("search results carry `visibility` for managers only", await (async () => {
    const gp = (await sType(guest, "ZZRQ")).json, m = (await sType(memB.client, "ZZH")).json, mg = (await sType(mgr.client, "ZZH")).json;
    return gp.results.length === 1 && !("visibility" in gp.results[0]) && !("visibility" in m.results[0]) && mg.results[0].visibility === "LAB_ONLY";
  })());
  check("search: hostile and wildcard queries are safe", (await sType(guest, "%")).status === 400 && (await sType(guest, "'; DROP TABLE LabResource; --")).status === 200);
  check("a resource linked ONLY to a hidden project is still searchable by its own columns (and names nothing hidden)", await (async () => {
    const r = (await sType(guest, "ZZL")).json.results.find((x) => x.id === leakRes.id);
    return r && !JSON.stringify(r).includes("Hidden");
  })());

  // ------------------------------------------------------------------
  section("workspace integration");
  const wsLead = (await lead.client.get("/workspace")).json;
  check("workspace has a bounded resources section", Array.isArray(wsLead.resources?.items) && typeof wsLead.resources.total === "number");
  check("a lead's workspace lists resources of their own project / naming them", wsLead.resources.items.some((d) => d.id === pubRes.id));
  check("... and not an unrelated resource", !wsLead.resources.items.some((d) => [labRes.id, aliceRes.id].includes(d.id)));
  const wsUser = await mk("ws", "MEMBER", `${M} Workspace`);
  await prisma.researcherArea.create({ data: { teamMemberId: wsUser.tm.id, researchAreaId: areaHid.id } });
  const wsOwn = await mkRes(wsUser.client, { name: `${M} WS Own`, description: "mine" });
  await prisma.labResource.update({ where: { id: leakRes.id }, data: { researchAreaId: areaHid.id } });
  const wsA = (await wsUser.client.get("/workspace")).json;
  check("a researcher's workspace lists resources of their area AND the ones they own", wsA.resources.total === 2 && wsA.resources.items.some((d) => d.id === leakRes.id) && wsA.resources.items.some((d) => d.id === wsOwn.id), JSON.stringify(wsA.resources.items.map((i) => i.name)));
  check("workspace resources are newest-edited first", wsA.resources.items.every((d, i, a) => i === 0 || a[i - 1].updatedAt >= d.updatedAt));
  const wsLoner = (await loner.client.get("/workspace")).json;
  check("no relationships: an empty, well-formed resources section", wsLoner.resources.total === 0 && wsLoner.resources.items.length === 0);
  check("the workspace never accepts someone else's id", JSON.stringify((await lead.client.get(`/workspace?userId=${memA.id}&teamMemberId=${memA.tm.id}&mine=1`)).json.resources) === JSON.stringify(wsLead.resources));
  check("workspace resources respect visibility (a PRIVATE project's resource is hidden)", await (async () => {
    await prisma.projectMember.create({ data: { projectId: projPriv.id, teamMemberId: loner.tm.id, role: "MEMBER" } });
    const ws = (await loner.client.get("/workspace")).json;
    await prisma.projectMember.delete({ where: { projectId_teamMemberId: { projectId: projPriv.id, teamMemberId: loner.tm.id } } });
    return !ws.resources.items.some((d) => d.id === privRes.id);
  })());
  check("another user's private (LAB_ONLY) resources are never in someone else's workspace", !wsLead.resources.items.some((d) => d.id === wsOwn.id) && !(await memB.client.get("/workspace")).json.resources.items.some((d) => d.id === wsOwn.id));
  check("the workspace section is capped at 5 and reports the true total", await (async () => {
    for (let i = 0; i < 7; i++) await mkRes(loner.client, { name: `${M} Loner ${i}`, description: "b" });
    const ws = (await loner.client.get("/workspace")).json.resources;
    return ws.items.length === 5 && ws.total === 7;
  })());
  check("the cap keeps the newest resources and equals ?mine=1", await (async () => {
    const ws = (await loner.client.get("/workspace")).json.resources;
    const all = (await loner.client.get("/resources?mine=1&limit=50")).json;
    return ws.items.map((d) => d.id).join() === all.items.slice(0, 5).map((d) => d.id).join() && all.pagination.total === ws.total;
  })());
  check("a guest has no workspace (401)", (await guest.get("/workspace")).status === 401);
  check("an account with NO team profile gets the well-formed empty section", JSON.stringify((await admin.get("/workspace")).json.resources) === JSON.stringify({ items: [], total: 0 }));
  check("a resource that names the researcher (and nothing else) is theirs", await (async () => {
    const named = await mkRes(mgr.client, { name: `${M} Names The Researcher`, visibility: "PUBLIC", teamMemberId: wsUser.tm.id });
    const ws = (await wsUser.client.get("/workspace")).json.resources;
    return ws.items.some((d) => d.id === named.id) && ws.total === 3 && ids(await wsUser.client.get("/resources?mine=1&limit=50")).includes(named.id);
  })());
  check("resources of a group / area / project outside the allow-list, or with their own odd visibility, never reach 'mine' or the workspace", await (async () => {
    await prisma.groupMember.create({ data: { groupId: groupPriv.id, teamMemberId: wsUser.tm.id, role: "MEMBER" } });
    await prisma.researcherArea.create({ data: { teamMemberId: wsUser.tm.id, researchAreaId: areaPriv.id } });
    const viaGroup = await prisma.labResource.create({ data: { name: `${M} Via Private Group`, visibility: "PUBLIC", groupId: groupPriv.id } });
    const viaArea = await prisma.labResource.create({ data: { name: `${M} Via Private Area`, visibility: "PUBLIC", researchAreaId: areaPriv.id } });
    const secret = await mkRes(wsUser.client, { name: `${M} Own Secret` });
    await prisma.labResource.update({ where: { id: secret.id }, data: { visibility: "SECRET" } });
    const mineIds = ids(await wsUser.client.get("/resources?mine=1&limit=50"));
    const ws = (await wsUser.client.get("/workspace")).json.resources;
    const wsIds = ws.items.map((d) => d.id);
    return ![viaGroup.id, viaArea.id, secret.id].some((i) => mineIds.includes(i) || wsIds.includes(i)) && ws.total === 3;
  })());

  // ------------------------------------------------------------------
  section("admin integration");
  check("guest 401 / member 403 on the admin resource list", (await guest.get("/admin/content?type=resource")).status === 401 && (await memA.client.get("/admin/content?type=resource")).status === 403);
  const aList = await mgr.client.get("/admin/content?type=resource&limit=100");
  check("manager lists resources with visibility, status = type, owner and href", aList.status === 200 && aList.json.rows.length > 0 && aList.json.rows.every((r) => r.type === "resource" && (r.visibility === "PUBLIC" || r.visibility === "LAB_ONLY") && typeof r.status === "string" && r.href === `/resources/${r.id}`));
  check("the admin list includes every resource (LAB_ONLY too)", [pubRes, labRes, aliceRes].every((d) => aList.json.rows.some((r) => r.id === d.id)));
  check("admin filter: resource type", (await mgr.client.get("/admin/content?type=resource&resourceType=DATASET&limit=100")).json.rows.every((r) => r.status === "DATASET") && (await mgr.client.get("/admin/content?type=resource&resourceType=DATASET")).json.rows.some((r) => r.id === pubRes.id));
  check("admin filter: project (through the join table) / area / group", (await mgr.client.get(`/admin/content?type=resource&project=${projHid.id}`)).json.rows.some((r) => r.id === leakRes.id) && (await mgr.client.get(`/admin/content?type=resource&project=${projHid.id}`)).json.rows.some((r) => r.id === pubRes.id) && (await mgr.client.get(`/admin/content?type=resource&area=${areaPub.id}`)).json.rows.some((r) => r.id === pubRes.id) && (await mgr.client.get(`/admin/content?type=resource&group=${groupHid.id}`)).json.rows.some((r) => r.id === leakRes.id));
  check("admin filter: visibility", (await mgr.client.get("/admin/content?type=resource&visibility=LAB_ONLY&limit=100")).json.rows.every((r) => r.visibility === "LAB_ONLY"));
  check("admin filter: owner", (await mgr.client.get(`/admin/content?type=resource&owner=${memA.tm.id}`)).json.rows.every((r) => r.owner?.id === memA.tm.id) && (await mgr.client.get(`/admin/content?type=resource&owner=${memA.tm.id}`)).json.rows.length > 0);
  check("admin text search finds the description, identifier and the Japanese name", (await mgr.client.get("/admin/content?type=resource&q=ZZRQ")).json.rows.some((r) => r.id === pubRes.id) && (await mgr.client.get("/admin/content?type=resource&q=ZZRQ-ID-1")).json.rows.some((r) => r.id === pubRes.id) && (await mgr.client.get(`/admin/content?type=resource&q=${encodeURIComponent("新しい名前")}`, "en")).json.rows.some((r) => r.id === jaRes.id));
  check("admin filters that do not apply are 400", (await mgr.client.get("/admin/content?type=news&resourceType=DATASET")).status === 400 && (await mgr.client.get(`/admin/content?type=event&project=${projPub.id}`)).status === 400 && (await mgr.client.get("/admin/content?type=resource&kind=SEMINAR")).status === 400 && (await mgr.client.get("/admin/content?type=resource&category=METHODOLOGY")).status === 400 && (await mgr.client.get("/admin/content?type=resource&resourceType=nope")).status === 400 && (await mgr.client.get("/admin/content?type=resource&project=a%20b")).status === 400);
  const aDet = await mgr.client.get(`/admin/content/resource/${pubRes.id}`);
  check("admin detail: relation counts and translation state", aDet.status === 200 && aDet.json.relations.find((r) => r.key === "projects")?.count === 2 && aDet.json.relations.find((r) => r.key === "docs")?.count === 1 && aDet.json.relations.find((r) => r.key === "publications")?.count === 1 && aDet.json.relations.find((r) => r.key === "events")?.count === 1 && aDet.json.relations.find((r) => r.key === "researchers")?.count === 1 && aDet.json.translations.map((t) => t.field).join() === "name,description,environment");
  check("admin detail of a missing resource is 404", (await mgr.client.get("/admin/content/resource/nonexistentid123")).status === 404);
  const ov = (await mgr.client.get("/admin/overview")).json;
  check("overview counts resources by visibility", ov.labResources.total === (await prisma.labResource.count()) && ov.labResources.public === (await prisma.labResource.count({ where: { visibility: "PUBLIC" } })) && ov.labResources.total === ov.labResources.public + ov.labResources.labOnly);
  check("bulk visibility works for resources and is audited per record", await (async () => {
    const updatedRows = () => prisma.auditLog.count({ where: { entityType: "LAB_RESOURCE", entityId: { in: [aliceRes.id, labRes.id] }, action: "RESOURCE_UPDATED" } });
    const b = await updatedRows();
    const r = await mgr.client.post("/admin/content/visibility", { type: "resource", ids: [aliceRes.id, labRes.id], visibility: "PUBLIC" });
    const a = await updatedRows();
    const rows = await prisma.auditLog.findMany({ where: { entityType: "LAB_RESOURCE", entityId: { in: [aliceRes.id, labRes.id] }, action: "CONTENT_VISIBILITY_CHANGED", createdAt: { gte: RUN_STARTED } } });
    const back = await mgr.client.post("/admin/content/visibility", { type: "resource", ids: [aliceRes.id, labRes.id], visibility: "LAB_ONLY" });
    return r.status === 200 && r.json.updated === 2 && rows.length >= 2 && a - b === 2 && back.status === 200;
  })());
  check("bulk visibility is 403 for a member and 404 (all-or-nothing) for an unknown id", (await memA.client.post("/admin/content/visibility", { type: "resource", ids: [aliceRes.id], visibility: "PUBLIC" })).status === 403 && (await mgr.client.post("/admin/content/visibility", { type: "resource", ids: [aliceRes.id, "nonexistentid123"], visibility: "PUBLIC" })).status === 404 && (await prisma.labResource.findUnique({ where: { id: aliceRes.id } })).visibility === "LAB_ONLY");
  check("the admin translations view edits a resource override (audited, names only) and knows the field caps", await (async () => {
    const r = await mgr.client.put(`/admin/translations/LAB_RESOURCE/${pubRes.id}`, { field: "name", value: "ZZ Res 公開データセット" });
    const list = await mgr.client.get("/admin/translations?type=LAB_RESOURCE&q=Public%20Dataset");
    const ja = await guest.get(`/resources/${pubRes.id}`, "ja");
    const audit = await prisma.auditLog.findFirst({ where: { entityType: "LAB_RESOURCE", entityId: pubRes.id, action: "TRANSLATIONS_CHANGED", createdAt: { gte: RUN_STARTED } } });
    const tooLong = await mgr.client.put(`/admin/translations/LAB_RESOURCE/${pubRes.id}`, { field: "name", value: "あ".repeat(201) });
    const cleared = await mgr.client.put(`/admin/translations/LAB_RESOURCE/${pubRes.id}`, { field: "name", value: null });
    const e = list.json.entries.find((x) => x.id === pubRes.id);
    return r.status === 200 && e && e.label === `${M} Public Dataset` && e.fields.map((f) => f.field).join() === "name,description,environment" && e.fields[0].max === 200 && e.fields[1].max === 5000 && e.fields[2].max === 5000 && ja.json.name === "ZZ Res 公開データセット" && audit && !audit.details.includes("公開") && tooLong.status === 400 && cleared.status === 200;
  })());
  check("a member cannot use the admin translations view", (await memA.client.put(`/admin/translations/LAB_RESOURCE/${pubRes.id}`, { field: "name", value: "x" })).status === 403);
  check("no admin response carries account ids or emails", await (async () => {
    const w = JSON.stringify([aList.json, aDet.json, ov]);
    return ![memA, memB, mgr].some((u) => w.includes(u.id) || w.includes(u.email));
  })());

  // ------------------------------------------------------------------
  section("audit");
  const audits = await prisma.auditLog.findMany({ where: { entityType: "LAB_RESOURCE", createdAt: { gte: RUN_STARTED } } });
  const has = (a) => audits.some((r) => r.action === a);
  check("created / updated / deleted / visibility / translations are audited", ["RESOURCE_CREATED", "RESOURCE_UPDATED", "RESOURCE_DELETED", "CONTENT_VISIBILITY_CHANGED", "TRANSLATIONS_CHANGED"].every(has));
  const auditWire = audits.map((r) => r.details ?? "").join("\n");
  check("audit rows hold names, types and field NAMES, never descriptions, notes, metadata or Japanese text", !/by alice|English description|Internal ZZH|Python 3\.11|camera rig|CC-BY|日本語|https:\/\/example\.com/.test(auditWire));
  check("a create row has the resource id and type", audits.some((r) => r.action === "RESOURCE_CREATED" && r.entityId === pubRes.id && /"resourceType":"DATASET"/.test(r.details ?? "")));
  check("an update row lists the changed field names", audits.some((r) => r.action === "RESOURCE_UPDATED" && /"changed":"[^"]*description/.test(r.details ?? "")) && audits.some((r) => r.action === "RESOURCE_UPDATED" && /"changed":"[^"]*projectIds/.test(r.details ?? "")) && audits.some((r) => r.action === "RESOURCE_UPDATED" && /"changed":"[^"]*metadata/.test(r.details ?? "")));
  check("a translation row names the locale and fields", audits.some((r) => r.action === "TRANSLATIONS_CHANGED" && /"locale":"ja"/.test(r.details ?? "") && /fields/.test(r.details ?? "")));
  check("a manager's visibility change on PUT is audited with from/to (not only through the bulk path)", audits.some((r) => r.action === "CONTENT_VISIBILITY_CHANGED" && r.entityId === aliceRes.id && /"from":"LAB_ONLY","to":"PUBLIC"/.test(r.details ?? "") && !/bulk/.test(r.details ?? "")));
  check("creating with a Japanese fragment audits the translated field names; a later Japanese edit audits just the changed field", audits.some((r) => r.action === "TRANSLATIONS_CHANGED" && r.entityId === jaRes.id && /"fields":"name,description,environment"/.test(r.details ?? "")) && audits.some((r) => r.action === "TRANSLATIONS_CHANGED" && r.entityId === jaRes.id && /"fields":"name"/.test(r.details ?? "")));
  check("an update row carries the resource type and name", audits.some((r) => r.action === "RESOURCE_UPDATED" && r.entityId === aliceRes.id && /"resourceType":"SOFTWARE"/.test(r.details ?? "") && /"name":/.test(r.details ?? "")));
  check("an unchanged save writes no RESOURCE_UPDATED row", await (async () => {
    const n = await prisma.auditLog.count({ where: { entityType: "LAB_RESOURCE", entityId: aliceRes.id, action: "RESOURCE_UPDATED" } });
    await mgr.client.put(`/resources/${aliceRes.id}`, { version: "10" });
    return (await prisma.auditLog.count({ where: { entityType: "LAB_RESOURCE", entityId: aliceRes.id, action: "RESOURCE_UPDATED" } })) === n;
  })());
  check("a rejected write leaves no audit row", await (async () => {
    const n = await prisma.auditLog.count({ where: { entityType: "LAB_RESOURCE" } });
    await memB.client.put(`/resources/${aliceRes.id}`, { name: "nope" });
    await memA.client.post("/resources", { name: "" });
    await memA.client.post("/resources", { name: "x", url: "javascript:1" });
    return (await prisma.auditLog.count({ where: { entityType: "LAB_RESOURCE" } })) === n;
  })());
  check("reads are not audited", await (async () => {
    const n = await prisma.auditLog.count({ where: { entityType: "LAB_RESOURCE" } });
    await guest.get("/resources");
    await guest.get(`/resources/${pubRes.id}`);
    await guest.get("/search?q=ZZ&type=resource");
    return (await prisma.auditLog.count({ where: { entityType: "LAB_RESOURCE" } })) === n;
  })());
  check("the audit log never receives account-role changes from this API", (await prisma.auditLog.count({ where: { action: "ROLE_CHANGED", createdAt: { gte: RUN_STARTED } } })) === 0);

  // ------------------------------------------------------------------
  section("privilege escalation");
  check("nobody gains account or role powers from resources", await (async () => {
    const r = await memA.client.post("/resources", { name: `${M} Escalate`, role: "ADMIN", user: { role: "ADMIN" } });
    const me = (await memA.client.get("/auth/me")).json;
    return r.status === 201 && (me.role === "MEMBER" || me.user?.role === "MEMBER");
  })());
  check("the admin resource views are manager-only and read-only over private data (no messages / notifications adapter)", (await mgr.client.get("/admin/content?type=message")).status === 400 && (await mgr.client.get("/admin/content?type=notification")).status === 400);

  // ------------------------------------------------------------------
  await cleanup();
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: RUN_STARTED }, OR: [{ entityType: "LAB_RESOURCE" }, { actorEmail: { startsWith: "p23test-" } }, { details: { contains: M } }] } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: RUN_STARTED }, entityType: "USER" } });
  const after = { resources: await prisma.labResource.count(), links: await prisma.resourceProject.count(), translations: await prisma.translation.count(), users: await prisma.user.count() };
  check("cleanup leaves the database as it was (resources, links, translations, users)", JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  await prisma.$disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("Script crashed:", e);
  try {
    await cleanup();
  } catch {}
  await prisma.$disconnect();
  process.exit(2);
});
