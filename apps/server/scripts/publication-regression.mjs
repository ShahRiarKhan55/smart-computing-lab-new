/**
 * End-to-end API regression for the PUBLICATION KNOWLEDGE HUB (Phase 19): the browse endpoint
 * (filters, sort, pagination), the detail endpoint and the relationships it exposes, visibility
 * propagation through every related page, Japanese title/venue overrides (and the English-base guard),
 * search, the admin CMS, audit hygiene, locale independence and hostile input.
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:C:/abs/path/to/copy.db PORT=4059 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:C:/abs/path/to/copy.db API=http://localhost:4059 node scripts/publication-regression.mjs
 *
 * Run it ONLY against a COPY of the database: it removes every audit row written during the run.
 * Fixtures are prefixed "ZZ P19" / p19test-*@example.test and are removed again (also at the start, in
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

const idsOf = (list) => (Array.isArray(list) ? list.map((x) => x.id) : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortedIds = (list) => idsOf(list).sort();
const has = (list, id) => idsOf(list).includes(id);

async function cleanup() {
  const pubs = await prisma.publication.findMany({ where: { title: { startsWith: "ZZ P19" } }, select: { id: true } });
  const projects = await prisma.researchProject.findMany({ where: { title: { startsWith: "ZZ P19" } }, select: { id: true } });
  const groups = await prisma.researchGroup.findMany({ where: { name: { startsWith: "ZZ P19" } }, select: { id: true } });
  const areas = await prisma.researchArea.findMany({ where: { title: { startsWith: "ZZ P19" } }, select: { id: true } });
  const news = await prisma.newsItem.findMany({ where: { title: { startsWith: "ZZ P19" } }, select: { id: true } });
  const events = await prisma.event.findMany({ where: { title: { startsWith: "ZZ P19" } }, select: { id: true } });
  for (const [entityType, rows] of [["PUBLICATION", pubs], ["RESEARCH_PROJECT", projects], ["RESEARCH_GROUP", groups], ["RESEARCH_AREA", areas], ["NEWS_ITEM", news], ["EVENT", events]]) {
    await prisma.translation.deleteMany({ where: { entityType, entityId: { in: rows.map((r) => r.id) } } });
  }
  await prisma.event.deleteMany({ where: { title: { startsWith: "ZZ P19" } } });
  await prisma.newsItem.deleteMany({ where: { title: { startsWith: "ZZ P19" } } });
  await prisma.publication.deleteMany({ where: { title: { startsWith: "ZZ P19" } } });
  await prisma.researchProject.deleteMany({ where: { title: { startsWith: "ZZ P19" } } });
  await prisma.researchGroup.deleteMany({ where: { name: { startsWith: "ZZ P19" } } });
  await prisma.researchArea.deleteMany({ where: { title: { startsWith: "ZZ P19" } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "p19test-" } } }).catch(() => {});
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: "ZZ P19" } } });
}

async function main() {
  await cleanup();
  const base = {
    pubs: await prisma.publication.count(),
    pubAuthors: await prisma.publicationAuthor.count(),
    projectPubs: await prisma.projectPublication.count(),
    translations: await prisma.translation.count(),
    projects: await prisma.researchProject.count(),
    members: await prisma.teamMember.count(),
    news: await prisma.newsItem.count(),
    events: await prisma.event.count(),
  };

  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);
  const mk = async (key, role, name) => {
    const email = `p19test-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "ZP", memberRole: "Researcher", category: "RESEARCH" });
    const client = new Client();
    await client.login(email, PW);
    const tm = await prisma.teamMember.findFirst({ where: { name } });
    return { client, id: r.json?.id, email, tm, status: r.status };
  };

  // ------------------------------------------------------------------
  section("fixtures");
  const guest = new Client();
  const mgr = await mk("mgr", "LAB_MANAGER", "ZZ P19 Manager");
  const memA = await mk("a", "MEMBER", "ZZ P19 Alice");
  const memB = await mk("b", "MEMBER", "ZZ P19 Bob");
  check("fixtures: three accounts created with profiles", [mgr, memA, memB].every((u) => u.status === 201 && u.tm));
  const accountIds = [mgr, memA, memB].map((u) => u.id);
  accountIds.push((await admin.get("/auth/me")).json.user.id);

  const aPub = await prisma.researchArea.create({ data: { title: "ZZ P19 Area Public", description: "d", tag: "ZZ", visibility: "PUBLIC" } });
  const aHid = await prisma.researchArea.create({ data: { title: "ZZ P19 Area Hidden", description: "d", tag: "ZZ", visibility: "LAB_ONLY" } });
  const gPub = await prisma.researchGroup.create({ data: { slug: "zz-p19-group-public", name: "ZZ P19 Group Public", visibility: "PUBLIC" } });
  const gHid = await prisma.researchGroup.create({ data: { slug: "zz-p19-group-hidden", name: "ZZ P19 Group Hidden", visibility: "LAB_ONLY" } });
  const mkProject = (slug, title, visibility, extra = {}) => prisma.researchProject.create({ data: { slug, title, visibility, summary: `${title} summary`, ...extra } });
  const P1 = await mkProject("zz-p19-p1", "ZZ P19 Project One", "PUBLIC", { groupId: gPub.id });
  const P2 = await mkProject("zz-p19-p2", "ZZ P19 Project Hidden", "LAB_ONLY", { groupId: gPub.id });
  const P3 = await mkProject("zz-p19-p3", "ZZ P19 Project In Hidden Group", "PUBLIC", { groupId: gHid.id });
  const P4 = await mkProject("zz-p19-p4", "ZZ P19 Project Standalone", "PUBLIC");
  await prisma.projectArea.createMany({
    data: [
      { projectId: P1.id, researchAreaId: aPub.id },
      { projectId: P1.id, researchAreaId: aHid.id },
      { projectId: P2.id, researchAreaId: aPub.id },
      { projectId: P3.id, researchAreaId: aHid.id },
      { projectId: P4.id, researchAreaId: aPub.id },
    ],
  });

  const mkPub = (title, year, visibility, extra = {}) => prisma.publication.create({ data: { title, year, authors: "ZZ Author One, ZZ Author Two", venue: "ZZ P19 Venue", visibility, ...extra } });
  const pubA = await mkPub("ZZ P19 Alpha", 2031, "PUBLIC", { pdfUrl: "https://example.test/a.pdf", doiUrl: "https://doi.org/10.0/zz" });
  const pubB = await mkPub("ZZ P19 Hidden Bravo", 2031, "LAB_ONLY");
  const pubC = await mkPub("ZZ P19 Charlie Only Hidden Project", 2030, "PUBLIC");
  const pubD = await mkPub("ZZ P19 Delta Unlinked", 2029, "PUBLIC");
  const pubE = await mkPub("ZZ P19 Beta", 2031, "PUBLIC", { venue: "ZZ P19 Other Venue" });
  const pubF = await mkPub("ZZ P19 Secret Year", 2027, "LAB_ONLY"); // the only publication of its year, and hidden
  await prisma.projectPublication.createMany({
    data: [
      { projectId: P1.id, publicationId: pubA.id },
      { projectId: P1.id, publicationId: pubB.id },
      { projectId: P2.id, publicationId: pubC.id },
      { projectId: P3.id, publicationId: pubC.id },
      { projectId: P1.id, publicationId: pubE.id },
      { projectId: P4.id, publicationId: pubE.id },
    ],
  });
  await prisma.publicationAuthor.createMany({
    data: [
      { publicationId: pubA.id, teamMemberId: memA.tm.id },
      { publicationId: pubB.id, teamMemberId: memA.tm.id },
      { publicationId: pubD.id, teamMemberId: memB.tm.id },
    ],
  });
  const tomorrow = new Date(Date.now() + 86400000);
  const mkNews = (title, visibility, projectId) => prisma.newsItem.create({ data: { title, description: "d", type: "Update", dateLabel: "Jan 1, 2031", sortDate: "2031-01-01", visibility, projectId } });
  const newsP1 = await mkNews("ZZ P19 News Public P1", "PUBLIC", P1.id);
  const newsP1Hid = await mkNews("ZZ P19 News Hidden P1", "LAB_ONLY", P1.id);
  const newsP2 = await mkNews("ZZ P19 News Public On Hidden Project", "PUBLIC", P2.id);
  const mkEvent = (title, visibility, projectId) => prisma.event.create({ data: { title, kind: "SEMINAR", startsAt: tomorrow, visibility, projectId } });
  const evP1 = await mkEvent("ZZ P19 Event Public P1", "PUBLIC", P1.id);
  const evP1Hid = await mkEvent("ZZ P19 Event Hidden P1", "LAB_ONLY", P1.id);
  const evP2 = await mkEvent("ZZ P19 Event Public On Hidden Project", "PUBLIC", P2.id);
  const tr = (entityType, entityId, field, value) => prisma.translation.create({ data: { entityType, entityId, locale: "ja", field, value } });
  await tr("PUBLICATION", pubA.id, "title", "ZZ P19 アルファ論文");
  await tr("PUBLICATION", pubA.id, "venue", "ZZ P19 日本会場");
  await tr("PUBLICATION", pubB.id, "title", "ZZ P19 秘密ブラボー");
  await tr("RESEARCH_PROJECT", P1.id, "title", "ZZ P19 プロジェクト一");
  await tr("RESEARCH_AREA", aPub.id, "title", "ZZ P19 公開分野");
  await tr("RESEARCH_GROUP", gPub.id, "name", "ZZ P19 公開グループ");
  const OURS = [pubA.id, pubB.id, pubC.id, pubD.id, pubE.id, pubF.id];
  const HIDDEN_PUBS = [pubB.id, pubF.id];

  // ------------------------------------------------------------------
  section("list and browse: who sees what");
  const browse = (c, qs = "", l) => c.get(`/publications/browse${qs ? `?${qs}` : ""}`, l);
  const ours = (r) => (r.json?.items ?? []).filter((p) => OURS.includes(p.id));
  const gAll = await browse(guest, "q=ZZ+P19");
  check("guest: browse answers 200 with the envelope", gAll.status === 200 && Array.isArray(gAll.json.items) && typeof gAll.json.total === "number" && gAll.json.page === 1 && gAll.json.limit === 20 && Array.isArray(gAll.json.years));
  check("guest: sees the public fixtures only", same(sortedIds(ours(gAll)), [pubA.id, pubC.id, pubD.id, pubE.id].sort()), sortedIds(ours(gAll)).join());
  check("guest: the hidden publications are not counted (total = visible rows)", gAll.json.total === 4);
  const mAll = await browse(memA.client, "q=ZZ+P19");
  check("member: also sees the LAB_ONLY ones", has(mAll.json.items, pubB.id) && has(mAll.json.items, pubF.id) && mAll.json.total === 6);
  check("`visibility` is sent only to managers", guest && gAll.json.items.every((p) => p.visibility === undefined) && mAll.json.items.every((p) => p.visibility === undefined) && (await browse(mgr.client, "q=ZZ+P19")).json.items.every((p) => p.visibility !== undefined));
  const plainList = await guest.get("/publications");
  check("GET /publications is still the plain array, newest first, without the hidden one", plainList.status === 200 && Array.isArray(plainList.json) && !HIDDEN_PUBS.some((id) => has(plainList.json, id)) && plainList.json.every((p, i, a) => i === 0 || a[i - 1].year >= p.year));
  check("years facet: descending, lists a visible year, and does NOT list a year that only a hidden publication has", gAll.json.years.every((y, i, a) => i === 0 || a[i - 1] > y) && gAll.json.years.includes(2031) && !gAll.json.years.includes(2027));
  check("years facet: a member's list does include that year", mAll.json.years.includes(2027));

  section("browse: filters");
  const gYear = await browse(guest, "q=ZZ+P19&year=2031");
  check("year filter", same(sortedIds(ours(gYear)), [pubA.id, pubE.id].sort()));
  const gRes = await browse(guest, `researcher=${memA.tm.id}`);
  check("researcher filter: only visible linked publications (the hidden one is not returned)", same(sortedIds(ours(gRes)), [pubA.id]));
  check("researcher filter as a member includes the hidden one", same(sortedIds(ours(await browse(memA.client, `researcher=${memA.tm.id}`))), [pubA.id, pubB.id].sort()));
  check("project filter (public project)", same(sortedIds(ours(await browse(guest, `project=${P1.id}`))), [pubA.id, pubE.id].sort()));
  const gHiddenProject = await browse(guest, `project=${P2.id}`);
  const gUnknownProject = await browse(guest, "project=zzzunknownid");
  check("project filter: a hidden project matches nothing for a guest — the same answer as an unknown id", gHiddenProject.status === 200 && gHiddenProject.json.total === 0 && same(gHiddenProject.json, gUnknownProject.json));
  check("project filter: the member who may see that project gets its publication", same(sortedIds(ours(await browse(memA.client, `project=${P2.id}`))), [pubC.id]));
  check("area filter (public area): publications of its VISIBLE projects only (P2 is hidden, so pubC is not reached through it)", same(sortedIds(ours(await browse(guest, `area=${aPub.id}`))), [pubA.id, pubE.id].sort()));
  check("area filter (hidden area) is empty for a guest, and identical to an unknown id", (await browse(guest, `area=${aHid.id}`)).json.total === 0 && same((await browse(guest, `area=${aHid.id}`)).json, (await browse(guest, "area=zzzunknownid")).json));
  check("area filter (hidden area) as a member reaches its publications through visible projects", same(sortedIds(ours(await browse(memA.client, `area=${aHid.id}`))), [pubA.id, pubB.id, pubC.id, pubE.id].sort()));
  check("group filter (public group): only through its VISIBLE project P1", same(sortedIds(ours(await browse(guest, `group=${gPub.id}`))), [pubA.id, pubE.id].sort()));
  const gHidGroup = await browse(guest, `group=${gHid.id}`);
  check("group filter (hidden group) is empty for a guest even though its project P3 is public — same as an unknown id", gHidGroup.json.total === 0 && same(gHidGroup.json, (await browse(guest, "group=zzzunknownid")).json));
  check("project + area + group must hold for ONE linked project", same(sortedIds(ours(await browse(guest, `project=${P1.id}&area=${aPub.id}&group=${gPub.id}`))), [pubA.id, pubE.id].sort()) && (await browse(guest, `project=${P4.id}&group=${gPub.id}`)).json.total === 0);
  check("filters combine (year + researcher + project)", same(sortedIds(ours(await browse(guest, `year=2031&researcher=${memA.tm.id}&project=${P1.id}`))), [pubA.id]));
  const mgrVis = await browse(mgr.client, "q=ZZ+P19&visibility=LAB_ONLY");
  check("manager: visibility filter works", same(sortedIds(ours(mgrVis)), [pubB.id, pubF.id].sort()) && mgrVis.json.total === 2);
  check("visibility filter: a guest and a member are refused (403), so it can't be used to learn which rows are LAB_ONLY", (await browse(guest, "visibility=LAB_ONLY")).status === 403 && (await browse(memA.client, "visibility=LAB_ONLY")).status === 403 && (await browse(memA.client, "visibility=PUBLIC")).status === 403);
  check("visibility filter: an admin may use it", (await browse(admin, "visibility=LAB_ONLY")).status === 200);

  section("browse: search text");
  check("text: a title word", same(sortedIds(ours(await browse(guest, "q=ZZ+P19+Alpha"))), [pubA.id]));
  check("text: a venue word", same(sortedIds(ours(await browse(guest, "q=ZZ+P19+Other"))), [pubE.id]));
  check("text: the authors column", ours(await browse(guest, "q=ZZ+P19+Author+Two")).length === 4);
  check("text: a linked researcher's NAME finds their publications", same(sortedIds(ours(await browse(guest, `q=${encodeURIComponent("ZZ P19 Alice")}`))), [pubA.id]));
  check("text: a 4-digit word matches the year", same(sortedIds(ours(await browse(guest, "q=ZZ+P19+2030"))), [pubC.id]));
  check("text: words are AND-ed (a word that is nowhere matches nothing)", (await browse(guest, "q=ZZ+P19+nonexistentwordzz")).json.total === 0);
  check("text: a guest cannot find the hidden publication by its title", (await browse(guest, "q=Hidden+Bravo")).json.total === 0 && (await browse(memA.client, "q=Hidden+Bravo")).json.total === 1);
  check("text: `%` and `_` are separators, never wildcards", (await browse(guest, "q=%25")).status === 200 && (await browse(guest, "q=ZZ_P19_Alpha")).json.total === (await browse(guest, "q=ZZ+P19+Alpha")).json.total && (await browse(guest, "q=ZZ+P19+zzznomatch%25")).json.total === 0);
  check("text: a Japanese override is found only when the request locale is ja", (await browse(guest, `q=${encodeURIComponent("アルファ論文")}`, "ja")).json.items.some((p) => p.id === pubA.id) && (await browse(guest, `q=${encodeURIComponent("アルファ論文")}`, "en")).json.total === 0);
  check("text: a hidden publication's Japanese override never leaks to a guest (any locale)", (await browse(guest, `q=${encodeURIComponent("秘密ブラボー")}`, "ja")).json.total === 0 && (await browse(memA.client, `q=${encodeURIComponent("秘密ブラボー")}`, "ja")).json.total === 1);

  section("browse: sort and pagination");
  const newest = ours(await browse(mgr.client, "q=ZZ+P19&sort=newest")).map((p) => p.id);
  const oldest = ours(await browse(mgr.client, "q=ZZ+P19&sort=oldest")).map((p) => p.id);
  check("sort newest: year descending", (await browse(mgr.client, "q=ZZ+P19&sort=newest")).json.items.every((p, i, a) => i === 0 || a[i - 1].year >= p.year) && newest[newest.length - 1] === pubF.id);
  check("sort oldest: year ascending", (await browse(mgr.client, "q=ZZ+P19&sort=oldest")).json.items.every((p, i, a) => i === 0 || a[i - 1].year <= p.year) && oldest[0] === pubF.id);
  const byTitle = (await browse(mgr.client, "q=ZZ+P19&sort=title")).json.items.map((p) => p.title);
  check("sort title: A to Z", same(byTitle, [...byTitle].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))));
  check("the default order equals sort=newest", same(idsOf((await browse(guest, "q=ZZ+P19")).json.items), idsOf((await browse(guest, "q=ZZ+P19&sort=newest")).json.items)));
  check("ordering is deterministic (three identical requests, same ids)", same(idsOf((await browse(guest, "q=ZZ+P19")).json.items), idsOf((await browse(guest, "q=ZZ+P19")).json.items)) && same(idsOf((await browse(guest, "q=ZZ+P19")).json.items), idsOf((await browse(guest, "q=ZZ+P19")).json.items)));
  const p1 = await browse(mgr.client, "q=ZZ+P19&limit=2&page=1");
  const p2 = await browse(mgr.client, "q=ZZ+P19&limit=2&page=2");
  const p3 = await browse(mgr.client, "q=ZZ+P19&limit=2&page=3");
  const p4 = await browse(mgr.client, "q=ZZ+P19&limit=2&page=4");
  check("paging: 6 rows at 2 per page = 3 pages, total 6", p1.json.total === 6 && p1.json.pageCount === 3 && p1.json.items.length === 2 && p2.json.items.length === 2 && p3.json.items.length === 2);
  check("paging: pages are disjoint and together equal the unpaged order", same([...idsOf(p1.json.items), ...idsOf(p2.json.items), ...idsOf(p3.json.items)], idsOf((await browse(mgr.client, "q=ZZ+P19&limit=50")).json.items)));
  check("paging: a page past the end is an empty list with the true total (no error)", p4.status === 200 && p4.json.items.length === 0 && p4.json.total === 6 && p4.json.pageCount === 3 && p4.json.page === 4);
  check("paging: an empty result still reports one page", (await browse(guest, "q=zzznomatchzzz")).json.pageCount === 1);
  const perPage = await browse(guest, "limit=50");
  check("paging: limit 50 is accepted", perPage.status === 200 && perPage.json.limit === 50);

  section("browse: invalid parameters are rejected safely");
  for (const [name, qs] of [
    ["year=abc", "year=abc"], ["year=1899", "year=1899"], ["year=2101", "year=2101"], ["year=2026.5", "year=2026.5"], ["year=-1", "year=-1"], ["year=2e3", "year=2e3"],
    ["page=0", "page=0"], ["page=-1", "page=-1"], ["page=abc", "page=abc"], ["page=1.5", "page=1.5"], ["page=99999999", "page=99999999"],
    ["limit=0", "limit=0"], ["limit=51", "limit=51"], ["limit=abc", "limit=abc"], ["limit=1e2", "limit=1e2"],
    ["sort=random", "sort=random"], ["sort=NEWEST", "sort=NEWEST"],
    ["project path traversal", "project=..%2Fetc%2Fpasswd"], ["group with spaces", "group=a%20b"], ["area with a quote", "area=a%27b"], ["researcher with sql", "researcher=a%3Bdrop%20table"], ["too-long id", `researcher=${"a".repeat(65)}`],
    ["q 101 chars", `q=${"x".repeat(101)}`], ["q with 9 words", "q=a+b+c+d+e+f+g+h+i"],
    ["visibility=BAD (manager)", "visibility=BAD"],
  ]) {
    const r = await browse(mgr.client, qs);
    check(`rejected with 400: ${name}`, r.status === 400 && typeof r.json?.error === "string", `${r.status}`);
  }
  const arr = await browse(guest, "q=ZZ+P19&year=2020&year=2031");
  check("a repeated parameter is read once (last wins) — never as a list", arr.status === 200 && same(sortedIds(ours(arr)), [pubA.id, pubE.id].sort()));
  check("object-style parameters (`year[a]=1`) are rejected, not coerced", (await browse(guest, "year[a]=1")).status === 400);
  check("an error body never echoes a server path or stack", !/\.ts|node_modules|at \w+ \(/.test((await browse(guest, "year=abc")).text));

  // ------------------------------------------------------------------
  section("detail: relationships and visibility");
  const dGuest = (await guest.get(`/publications/${pubA.id}`)).json;
  check("guest: detail of a public publication", dGuest?.id === pubA.id && dGuest.title === "ZZ P19 Alpha" && dGuest.year === 2031 && dGuest.pdfUrl === "https://example.test/a.pdf");
  check("detail: linked researcher is a public profile card (id, name, initials, role)", same(dGuest.researchers.map((r) => r.id), [memA.tm.id]) && Object.keys(dGuest.researchers[0]).sort().join() === "id,initials,name,role");
  check("detail: projects = the VISIBLE linked projects only", same(dGuest.projects.map((p) => p.id), [P1.id]));
  check("detail: areas come through visible projects and the area itself must be visible (hidden area absent)", same(dGuest.areas.map((a) => a.id), [aPub.id]));
  check("detail: groups come through visible projects, hidden group absent", same(dGuest.groups.map((g) => g.id), [gPub.id]));
  check("detail: related news / events are the PUBLIC ones of the visible projects (hidden ones absent)", same(dGuest.news.map((n) => n.id), [newsP1.id]) && same(dGuest.events.map((e) => e.id), [evP1.id]));
  check("detail: a guest gets no visibility flag and no edit rights", dGuest.visibility === undefined && dGuest.canEdit === false && dGuest.canDelete === false);
  const dMember = (await memA.client.get(`/publications/${pubA.id}`)).json;
  check("detail: a member sees the lab-only related records and may edit but not delete", same(dMember.areas.map((a) => a.id).sort(), [aHid.id, aPub.id].sort()) && same(dMember.news.map((n) => n.id).sort(), [newsP1.id, newsP1Hid.id].sort()) && same(dMember.events.map((e) => e.id).sort(), [evP1.id, evP1Hid.id].sort()) && dMember.canEdit === true && dMember.canDelete === false);
  const dMgr = (await mgr.client.get(`/publications/${pubA.id}`)).json;
  check("detail: a manager may edit and delete and receives the visibility field", dMgr.canEdit === true && dMgr.canDelete === true && dMgr.visibility === "PUBLIC");
  const dC = (await guest.get(`/publications/${pubC.id}`)).json;
  check("detail: a publication linked to a hidden and a public project shows only the public one, with no area/group of the hidden ones", same(dC.projects.map((p) => p.id), [P3.id]) && dC.areas.length === 0 && dC.groups.length === 0);
  check("detail: a publication with no links has empty relation lists (no invented relationships)", (await (async () => { const d = (await guest.get(`/publications/${pubD.id}`)).json; return d.projects.length === 0 && d.areas.length === 0 && d.groups.length === 0 && d.news.length === 0 && d.events.length === 0 && d.researchers.length === 1; })()));
  const hidden = await guest.get(`/publications/${pubB.id}`);
  const missing = await guest.get("/publications/zzzunknownid1234");
  check("hidden publication is a 404 identical to a missing one (status, body)", hidden.status === 404 && missing.status === 404 && hidden.text === missing.text);
  check("hidden publication: a member gets it, and its title never appears in the guest's 404", (await memA.client.get(`/publications/${pubB.id}`)).status === 200 && !hidden.text.includes("Bravo"));
  check("malformed ids are a 400 (not a database error)", (await guest.get("/publications/a%20b")).status === 400 && (await guest.get(`/publications/${"a".repeat(65)}`)).status === 400 && (await guest.get("/publications/..%2Fx")).status !== 200);
  for (const r of [dGuest, dMember, dMgr, dC]) {
    check("detail body carries no account id or email", !accountIds.some((id) => JSON.stringify(r).includes(id)) && !/@example\.test|userId/.test(JSON.stringify(r)));
  }
  check("authors endpoint: hidden is a 404 for a guest", (await guest.get(`/publications/${pubB.id}/authors`)).status === 404 && (await guest.get(`/publications/${pubA.id}/authors`)).status === 200);

  section("detail: localization (text only, never authorization)");
  const dJa = (await guest.get(`/publications/${pubA.id}`, "ja")).json;
  check("ja: title, venue and the related project/area/group titles are localized", dJa.title === "ZZ P19 アルファ論文" && dJa.venue === "ZZ P19 日本会場" && dJa.projects[0].title === "ZZ P19 プロジェクト一" && dJa.areas[0].title === "ZZ P19 公開分野" && dJa.groups[0].name === "ZZ P19 公開グループ");
  check("ja: authors, links and year are never translated", dJa.authors === dGuest.authors && dJa.pdfUrl === dGuest.pdfUrl && dJa.year === dGuest.year);
  check("ja: the SAME records are visible (locale never changes authorization)", same(dJa.projects.map((p) => p.id), dGuest.projects.map((p) => p.id)) && same(dJa.areas.map((a) => a.id), dGuest.areas.map((a) => a.id)) && (await guest.get(`/publications/${pubB.id}`, "ja")).status === 404);
  for (const [name, loc] of [["invalid", "xx"], ["empty", ""], ["upper-case", "JA"], ["injection", "ja;drop"], ["long", "j".repeat(500)]]) {
    const r = await guest.get(`/publications/${pubA.id}`, loc);
    check(`locale header ${name}: falls back to English, same record set, hidden stays hidden`, r.status === 200 && r.json.title === "ZZ P19 Alpha" && (await guest.get(`/publications/${pubB.id}`, loc)).status === 404 && same(idsOf((await browse(guest, "q=ZZ+P19", loc)).json.items), idsOf(gAll.json.items)));
  }
  check("no X-Locale header: English", (await guest.get(`/publications/${pubA.id}`)).json.title === "ZZ P19 Alpha");
  const jaList = await browse(guest, "q=ZZ+P19", "ja");
  check("ja: the browse list is localized and has the same ids and total as English", jaList.json.items.find((p) => p.id === pubA.id)?.title === "ZZ P19 アルファ論文" && same(idsOf(jaList.json.items), idsOf(gAll.json.items)) && jaList.json.total === gAll.json.total);
  check("ja: the plain list is localized too", (await guest.get("/publications", "ja")).json.find((p) => p.id === pubA.id)?.title === "ZZ P19 アルファ論文");

  // ------------------------------------------------------------------
  section("visibility propagation through every related page");
  const proj = (await guest.get(`/projects/${P1.id}`)).json;
  check("project page: hidden publication absent, public ones present, ja localized", same(sortedIds(proj.publications), [pubA.id, pubE.id].sort()) && (await guest.get(`/projects/${P1.id}`, "ja")).json.publications.find((p) => p.id === pubA.id)?.title === "ZZ P19 アルファ論文");
  check("project page: a member sees the lab-only publication", has((await memA.client.get(`/projects/${P1.id}`)).json.publications, pubB.id));
  check("project page: the publication order is newest first then id (deterministic)", proj.publications.every((p, i, a) => i === 0 || a[i - 1].year >= p.year));
  check("project page: no publication appears twice", new Set(idsOf(proj.publications)).size === proj.publications.length);
  const area = (await guest.get(`/research/${aPub.id}`)).json;
  check("area page: publications are those of its VISIBLE projects; a hidden project's publication (pubC via P2) does not roll up", same(sortedIds(area.publications), [pubA.id, pubE.id].sort()) && !has(area.publications, pubC.id) && !has(area.publications, pubB.id));
  check("area page: a member sees the lab-only one, and pubC still only through a visible project", has((await memA.client.get(`/research/${aPub.id}`)).json.publications, pubB.id) && has((await memA.client.get(`/research/${aPub.id}`)).json.publications, pubC.id));
  check("hidden area: 404 for a guest (its publications cannot be reached through it)", (await guest.get(`/research/${aHid.id}`)).status === 404);
  const group = (await guest.get(`/groups/${gPub.id}`)).json;
  check("group page: publications of visible projects only; pubC (hidden P2) absent", same(sortedIds(group.publications), [pubA.id, pubE.id].sort()));
  check("hidden group: 404 for a guest, so pubC (via P3) is not reachable through it", (await guest.get(`/groups/${gHid.id}`)).status === 404);
  const member = (await guest.get(`/member/${memA.tm.id}`)).json;
  check("researcher page: publications visible to the viewer only", same(sortedIds(member.publications), [pubA.id]) && has((await memA.client.get(`/member/${memA.tm.id}`)).json.publications, pubB.id));
  check("researcher page: ja localized", (await guest.get(`/member/${memA.tm.id}`, "ja")).json.publications[0].title === "ZZ P19 アルファ論文");
  for (const [name, body] of [["project", proj], ["area", area], ["group", group], ["researcher", member]]) {
    check(`${name} page: no hidden publication id or title anywhere in the body`, !JSON.stringify(body).includes(pubB.id) && !JSON.stringify(body).includes("Bravo") && !accountIds.some((id) => JSON.stringify(body).includes(id)));
  }
  const home = (await guest.get("/publications")).json;
  check("home/list source: hidden publication absent", !has(home, pubB.id));

  section("search");
  const s = await guest.get(`/search?q=${encodeURIComponent("ZZ P19")}&type=publication&limit=50`);
  check("search: publication results link to /publications/:id", s.status === 200 && s.json.results.length > 0 && s.json.results.every((r) => r.href === `/publications/${r.id}`));
  check("search: hidden publication is absent from results and from the count", !has(s.json.results, pubB.id) && s.json.results.filter((r) => OURS.includes(r.id)).length === 4);
  const sm = await memA.client.get(`/search?q=${encodeURIComponent("ZZ P19")}&type=publication&limit=50`);
  check("search: a member finds the lab-only one (same rule as the list)", has(sm.json.results, pubB.id));
  const sja = await guest.get(`/search?q=${encodeURIComponent("アルファ論文")}&type=publication`, "ja");
  check("search: a Japanese override is matched and shown for ja", sja.json.results.some((r) => r.id === pubA.id && r.title === "ZZ P19 アルファ論文"));
  check("search: a hidden publication's Japanese title is not searchable by a guest", (await guest.get(`/search?q=${encodeURIComponent("秘密ブラボー")}&type=publication`, "ja")).json.results.length === 0);
  check("search: every returned id opens through the detail endpoint", (await Promise.all(s.json.results.filter((r) => OURS.includes(r.id)).map(async (r) => (await guest.get(`/publications/${r.id}`)).status))).every((c) => c === 200));

  // ------------------------------------------------------------------
  section("writes: create / update / delete, permissions, translations");
  const body = { year: 2032, title: "ZZ P19 Created", authors: "ZZ A", venue: "ZZ P19 V", translations: { ja: { title: "ZZ P19 作成", venue: "ZZ P19 場" } } };
  check("guest cannot create / update / delete / link authors (401)", (await guest.post("/publications", body)).status === 401 && (await guest.put(`/publications/${pubA.id}`, { year: 2000 })).status === 401 && (await guest.del(`/publications/${pubA.id}`)).status === 401 && (await guest.put(`/publications/${pubA.id}/authors`, { teamMemberIds: [] })).status === 401);
  const created = await memA.client.post("/publications", body);
  check("member creates a publication with Japanese overrides", created.status === 201 && created.json.title === "ZZ P19 Created" && created.json.visibility === undefined);
  const cid = created.json?.id;
  check("… the response is the English text (locale header absent)", created.json?.venue === "ZZ P19 V");
  check("… the overrides are stored as ja rows for title and venue only", same((await prisma.translation.findMany({ where: { entityType: "PUBLICATION", entityId: cid }, orderBy: { field: "asc" } })).map((r) => [r.field, r.locale]), [["title", "ja"], ["venue", "ja"]]));
  check("… and served in Japanese", (await guest.get(`/publications/${cid}`, "ja")).json.title === "ZZ P19 作成");
  check("member cannot set visibility on create (403) and nothing is created", (await memA.client.post("/publications", { ...body, title: "ZZ P19 Sneaky", visibility: "PUBLIC" })).status === 403 && (await prisma.publication.count({ where: { title: "ZZ P19 Sneaky" } })) === 0);
  check("member cannot change visibility on update (403) and the row is unchanged", (await memA.client.put(`/publications/${cid}`, { visibility: "LAB_ONLY" })).status === 403 && (await prisma.publication.findUnique({ where: { id: cid } })).visibility === "PUBLIC");
  check("a member cannot delete (403); a manager can", (await memA.client.del(`/publications/${cid}`)).status === 403 && (await memB.client.del(`/publications/${cid}`)).status === 403);
  check("malformed ids: PUT / DELETE / authors → 400", (await mgr.client.put("/publications/a%20b", { year: 2000 })).status === 400 && (await mgr.client.del("/publications/a%20b")).status === 400 && (await mgr.client.put("/publications/a%20b/authors", { teamMemberIds: [] })).status === 400);
  check("unknown ids: PUT / DELETE / authors → 404", (await mgr.client.put("/publications/zzzunknownid1234", { year: 2000 })).status === 404 && (await mgr.client.del("/publications/zzzunknownid1234")).status === 404 && (await mgr.client.put("/publications/zzzunknownid1234/authors", { teamMemberIds: [] })).status === 404);
  check("over-length Japanese title (501) / venue (501) → 400, nothing written", (await mgr.client.put(`/publications/${cid}`, { translations: { ja: { title: "あ".repeat(501) } } })).status === 400 && (await mgr.client.put(`/publications/${cid}`, { translations: { ja: { venue: "あ".repeat(501) } } })).status === 400);
  check("a translation of a non-translatable field (authors) is ignored, never stored", (await mgr.client.put(`/publications/${cid}`, { translations: { ja: { authors: "偽" } } })).status === 200 && (await prisma.translation.count({ where: { entityType: "PUBLICATION", entityId: cid, field: "authors" } })) === 0);
  check("bad body shapes are 400 (translations not an object / ja not an object)", (await mgr.client.put(`/publications/${cid}`, { translations: "x" })).status === 400 && (await mgr.client.put(`/publications/${cid}`, { translations: { ja: "x" } })).status === 400);

  section("the English-base guard (a Japanese edit never overwrites English)");
  const tget = await memA.client.get(`/translations/PUBLICATION/${cid}`, "ja");
  check("GET /translations/PUBLICATION/:id in a ja session: `base` is the ENGLISH text, `ja` is the override", tget.status === 200 && tget.json.base.title === "ZZ P19 Created" && tget.json.base.venue === "ZZ P19 V" && tget.json.ja.title === "ZZ P19 作成");
  check("… while the entity's own GET in ja shows the override in `title` (which is exactly why the form needs `base`)", (await memA.client.get(`/publications/${cid}`, "ja")).json.title === "ZZ P19 作成");
  check("… guests cannot read it (401) and an unknown type is a 404", (await guest.get(`/translations/PUBLICATION/${cid}`)).status === 401 && (await memA.client.get("/translations/PUBLICATIONS/x")).status === 404);
  // What the form does in JA mode: English inputs hold `base`, Japanese inputs hold the overrides, both are sent.
  const edit = await memA.client.put(`/publications/${cid}`, { year: 2032, title: tget.json.base.title, authors: "ZZ A", venue: tget.json.base.venue, translations: { ja: { title: "ZZ P19 作成 改", venue: "ZZ P19 場" } } }, "ja");
  const afterEdit = await prisma.publication.findUnique({ where: { id: cid } });
  check("saving that payload from a ja session leaves the English columns intact and updates only the override", edit.status === 200 && afterEdit.title === "ZZ P19 Created" && afterEdit.venue === "ZZ P19 V" && (await guest.get(`/publications/${cid}`, "ja")).json.title === "ZZ P19 作成 改");
  check("a translations-only update never touches the English text either", (await memA.client.put(`/publications/${cid}`, { translations: { ja: { title: "ZZ P19 作成 再" } } }, "ja")).status === 200 && (await prisma.publication.findUnique({ where: { id: cid } })).title === "ZZ P19 Created");
  check("clearing a Japanese box removes only that override (falls back to English)", (await memA.client.put(`/publications/${cid}`, { translations: { ja: { title: "" } } })).status === 200 && (await guest.get(`/publications/${cid}`, "ja")).json.title === "ZZ P19 Created" && (await guest.get(`/publications/${cid}`, "ja")).json.venue === "ZZ P19 場");

  const cidAudit = await prisma.auditLog.findMany({ where: { entityId: cid, action: "TRANSLATIONS_CHANGED" } });
  check("the publication's OWN create/update routes audit each Japanese change by field names (create: title,venue; later edits: title), and nothing else", cidAudit.some((r) => JSON.parse(r.details).fields === "title,venue") && cidAudit.filter((r) => JSON.parse(r.details).fields === "title").length >= 3 && cidAudit.every((r) => /^(title|venue|title,venue)$/.test(JSON.parse(r.details).fields) && JSON.parse(r.details).locale === "ja"), JSON.stringify(cidAudit.map((r) => r.details)));
  check("every one of the four override changes was audited (create, edit, translations-only edit, clear)", cidAudit.length >= 4);

  section("author links (unauthorized relationship edits)");
  check("member may add THEMSELVES as an author", (await memA.client.put(`/publications/${cid}/authors`, { teamMemberIds: [memA.tm.id] })).status === 200 && same((await guest.get(`/publications/${cid}`)).json.researchers.map((r) => r.id), [memA.tm.id]));
  check("member may NOT add someone else (403) — nothing changes", (await memA.client.put(`/publications/${cid}/authors`, { teamMemberIds: [memA.tm.id, memB.tm.id] })).status === 403 && same((await guest.get(`/publications/${cid}`)).json.researchers.map((r) => r.id), [memA.tm.id]));
  check("member may NOT remove someone else (403)", (await mgr.client.put(`/publications/${cid}/authors`, { teamMemberIds: [memA.tm.id, memB.tm.id] })).status === 200 && (await memA.client.put(`/publications/${cid}/authors`, { teamMemberIds: [memA.tm.id] })).status === 403);
  check("a manager sets any set; an unknown profile is a 400; a duplicate is a 400", (await mgr.client.put(`/publications/${cid}/authors`, { teamMemberIds: [memB.tm.id] })).status === 200 && (await mgr.client.put(`/publications/${cid}/authors`, { teamMemberIds: ["zzzunknownid1234"] })).status === 400 && (await mgr.client.put(`/publications/${cid}/authors`, { teamMemberIds: [memA.tm.id, memA.tm.id] })).status === 400);
  check("a member cannot link a publication to a PROJECT from the publication side (no such endpoint) and cannot edit a project's set (403/404)", (await memB.client.put(`/projects/${P1.id}/publications`, { publicationIds: [cid] })).status >= 403);
  check("a manager links it to a project through the existing endpoint; it then shows on the detail page", (await mgr.client.put(`/projects/${P4.id}/publications`, { publicationIds: [pubE.id, cid] })).status === 200 && same((await guest.get(`/publications/${cid}`)).json.projects.map((p) => p.id), [P4.id]));

  section("delete and cascade");
  const del = await mgr.client.del(`/publications/${cid}`);
  check("manager deletes it", del.status === 200 && (await guest.get(`/publications/${cid}`)).status === 404);
  check("… its Translation rows, author links and project links are gone", (await prisma.translation.count({ where: { entityType: "PUBLICATION", entityId: cid } })) === 0 && (await prisma.publicationAuthor.count({ where: { publicationId: cid } })) === 0 && (await prisma.projectPublication.count({ where: { publicationId: cid } })) === 0);
  check("… a second delete is a clean 404", (await mgr.client.del(`/publications/${cid}`)).status === 404);
  await mgr.client.put(`/projects/${P4.id}/publications`, { publicationIds: [pubE.id] });

  section("visibility change hides the record everywhere at once");
  check("manager makes a public publication LAB_ONLY", (await mgr.client.put(`/publications/${pubE.id}`, { visibility: "LAB_ONLY" })).status === 200);
  check("… it is gone from the guest's detail, browse, project, area, group and search", (await guest.get(`/publications/${pubE.id}`)).status === 404 && !has((await browse(guest, "q=ZZ+P19")).json.items, pubE.id) && !has((await guest.get(`/projects/${P1.id}`)).json.publications, pubE.id) && !has((await guest.get(`/research/${aPub.id}`)).json.publications, pubE.id) && !has((await guest.get(`/groups/${gPub.id}`)).json.publications, pubE.id) && !(await guest.get(`/search?q=${encodeURIComponent("ZZ P19 Beta")}&type=publication`)).json.results.some((r) => r.id === pubE.id));
  check("… and from the guest's totals", (await browse(guest, "q=ZZ+P19")).json.total === 3);
  await mgr.client.put(`/publications/${pubE.id}`, { visibility: "PUBLIC" });
  check("… restoring it brings it back", has((await browse(guest, "q=ZZ+P19")).json.items, pubE.id));
  await mgr.client.put(`/projects/${P1.id}`, { visibility: "LAB_ONLY" });
  check("hiding a PROJECT removes its publications from the guest's project-derived filters and pages (pubA no longer reached via P1)", (await browse(guest, `project=${P1.id}`)).json.total === 0 && !has((await guest.get(`/research/${aPub.id}`)).json.publications, pubA.id) && (await guest.get(`/publications/${pubA.id}`)).json.projects.length === 0 && (await guest.get(`/publications/${pubA.id}`)).json.groups.length === 0);
  check("… but the publication itself stays visible by its OWN visibility", (await guest.get(`/publications/${pubA.id}`)).status === 200);
  await mgr.client.put(`/projects/${P1.id}`, { visibility: "PUBLIC" });

  // ------------------------------------------------------------------
  section("hostile input stays inert");
  const HOSTILE = { year: 2033, title: "ZZ P19 <script>alert(1)</script><img src=x onerror=alert(2)>", authors: "ZZ <b>bold</b> \"><svg onload=alert(3)>", venue: "ZZ P19 ${7*7} {{7*7}} '; DROP TABLE Publication; --", translations: { ja: { title: "ZZ P19 <script>alert(9)</script>日本語", venue: "ZZ P19 \"><img src=x>" } } };
  const hp = await memA.client.post("/publications", HOSTILE);
  check("hostile text is stored verbatim (React escapes it on render)", hp.status === 201 && hp.json.title === HOSTILE.title && hp.json.authors === HOSTILE.authors && hp.json.venue === HOSTILE.venue);
  const hd = await guest.get(`/publications/${hp.json.id}`);
  check("… served as JSON (never HTML), with nosniff", /application\/json/.test(hd.type) && hd.json.title === HOSTILE.title);
  check("… the table still exists (no injection)", (await prisma.publication.count()) > 0);
  check("… searchable as plain text; no wildcard behaviour", (await browse(guest, `q=${encodeURIComponent("<script>alert(1)</script>")}`)).json.items.some((p) => p.id === hp.json.id) || (await browse(guest, "q=alert")).json.items.some((p) => p.id === hp.json.id));
  const long = "ẞ".repeat(400) + "https://example.test/" + "a".repeat(80);
  check("a long unbroken title (500 max) is accepted and returned intact; 501 is rejected", (await memA.client.post("/publications", { year: 2033, title: `ZZ P19 ${"W".repeat(480)}`, authors: "ZZ", venue: "ZZ" })).status === 201 && (await memA.client.post("/publications", { year: 2033, title: `ZZ P19 ${"W".repeat(500)}`, authors: "ZZ", venue: "ZZ" })).status === 400 && long.length > 0);
  check("hostile Japanese text is stored and returned as plain text", (await guest.get(`/publications/${hp.json.id}`, "ja")).json.title === HOSTILE.translations.ja.title);
  check("javascript: URLs are refused in link fields", (await memA.client.post("/publications", { year: 2033, title: "ZZ P19 badurl", authors: "ZZ", venue: "ZZ", pdfUrl: "javascript:alert(1)" })).status === 400 && (await memA.client.post("/publications", { year: 2033, title: "ZZ P19 badurl", authors: "ZZ", venue: "ZZ", doiUrl: "data:text/html,<script>alert(1)</script>" })).status === 400);
  check("non-JSON / non-object bodies are 400", (await memA.client.post("/publications", "not json")).status === 400 && (await memA.client.post("/publications", [])).status === 400);
  await mgr.client.del(`/publications/${hp.json.id}`);

  section("deleted accounts and missing relationships");
  const delUser = await admin.del(`/users/${memA.id}`);
  check("admin deletes a researcher's ACCOUNT", delUser.status === 200);
  const afterDel = (await guest.get(`/publications/${pubA.id}`)).json;
  check("… the publication still lists the researcher's PROFILE (relations are to the profile, not the account)", afterDel.researchers.some((r) => r.id === memA.tm.id) && (await guest.get(`/member/${memA.tm.id}`)).status === 200);
  check("… and the deleted account cannot log in", (await new Client().login(memA.email, PW)).status === 401);
  await prisma.teamMember.delete({ where: { id: memB.tm.id } });
  check("a deleted PROFILE simply drops out of the author links (cascade); the publication loads", (await guest.get(`/publications/${pubD.id}`)).status === 200 && (await guest.get(`/publications/${pubD.id}`)).json.researchers.length === 0);
  check("a filter on a deleted researcher matches nothing (no error)", (await browse(guest, `researcher=${memB.tm.id}`)).json.total === 0);

  // ------------------------------------------------------------------
  section("admin CMS integration");
  const ac = await mgr.client.get("/admin/content?type=publication&q=ZZ+P19&limit=100");
  check("manager: publication rows link to the detail page", ac.status === 200 && ac.json.rows.length >= 4 && ac.json.rows.every((r) => r.href === `/publications/${r.id}`));
  check("manager: rows carry visibility, and the hidden publication is included", ac.json.rows.some((r) => r.id === pubB.id && r.visibility === "LAB_ONLY"));
  const detailRow = await mgr.client.get(`/admin/content/publication/${pubA.id}`);
  check("manager: detail shows relationship counts and translation state", detailRow.status === 200 && detailRow.json.relations.find((x) => x.key === "projects")?.count === 1 && detailRow.json.relations.find((x) => x.key === "authors")?.count === 1 && JSON.stringify(detailRow.json).includes("translat"));
  const translated = await mgr.client.get("/admin/content?type=publication&q=ZZ+P19&translation=translated&limit=100");
  const untranslated = await mgr.client.get("/admin/content?type=publication&q=ZZ+P19&translation=untranslated&limit=100");
  check("manager: the translation filter now applies to publications", translated.status === 200 && has(translated.json.rows, pubA.id) && !has(translated.json.rows, pubD.id) && has(untranslated.json.rows, pubD.id));
  const trList = await mgr.client.get("/admin/translations?type=PUBLICATION&q=ZZ+P19");
  const entry = trList.json?.entries?.find((e) => e.id === pubA.id);
  check("manager: the translations view lists title and venue with base text, override and cap", trList.status === 200 && entry && entry.fields.map((f) => f.field).join() === "title,venue" && entry.fields.every((f) => f.max === 500) && entry.fields[0].ja === "ZZ P19 アルファ論文" && entry.href === `/publications/${pubA.id}`);
  const setTr = await mgr.client.put(`/admin/translations/PUBLICATION/${pubD.id}`, { field: "title", value: "ZZ P19 デルタ" });
  check("manager: sets an override from the admin view, and it is served in ja", setTr.status === 200 && (await guest.get(`/publications/${pubD.id}`, "ja")).json.title === "ZZ P19 デルタ");
  check("admin view: a field that is not translatable is a 400; over the cap is a 400", (await mgr.client.put(`/admin/translations/PUBLICATION/${pubD.id}`, { field: "authors", value: "x" })).status === 400 && (await mgr.client.put(`/admin/translations/PUBLICATION/${pubD.id}`, { field: "title", value: "あ".repeat(501) })).status === 400);
  check("admin view is closed to members and guests (403 / 401)", (await memB.client.get("/admin/translations?type=PUBLICATION")).status === 403 && (await guest.get("/admin/translations?type=PUBLICATION")).status === 401 && (await memB.client.get("/admin/content?type=publication")).status === 403);
  check("bulk visibility on publications still works and is all-or-nothing", (await mgr.client.post("/admin/content/visibility", { type: "publication", ids: [pubD.id], visibility: "LAB_ONLY" })).status === 200 && (await guest.get(`/publications/${pubD.id}`)).status === 404 && (await mgr.client.post("/admin/content/visibility", { type: "publication", ids: [pubD.id, "zzzunknownid1234"], visibility: "PUBLIC" })).status >= 400 && (await guest.get(`/publications/${pubD.id}`)).status === 404);
  await mgr.client.post("/admin/content/visibility", { type: "publication", ids: [pubD.id], visibility: "PUBLIC" });
  check("no admin surface exposes private messages or notifications (404)", (await mgr.client.get("/admin/messages")).status === 404 && (await mgr.client.get("/admin/notifications")).status === 404);
  check("a manager cannot change roles or accounts (admin only)", (await mgr.client.put(`/users/${memB.id}`, { role: "ADMIN" })).status === 403 && (await mgr.client.get("/users")).status === 403);
  check("nobody can change their own role", (await admin.put(`/users/${(await admin.get("/auth/me")).json.user.id}`, { role: "MEMBER" })).status >= 400);

  // ------------------------------------------------------------------
  section("locale independence of every list");
  const variants = [undefined, "en", "ja", "xx", "", "JA"];
  const idsFor = async (c, qs) => (await Promise.all(variants.map(async (l) => JSON.stringify(idsOf((await browse(c, qs, l)).json.items))))).every((x, _, a) => x === a[0]);
  check("guest: every locale yields the same ids and order for the same query", (await idsFor(guest, "q=ZZ+P19")) && (await idsFor(guest, `area=${aPub.id}`)) && (await idsFor(guest, "year=2031&sort=title")));
  check("member: same", (await idsFor(mgr.client, "q=ZZ+P19")));

  // ------------------------------------------------------------------
  section("audit hygiene");
  const rows = await prisma.auditLog.findMany({ where: { createdAt: { gte: RUN_STARTED } } });
  const pubRows = rows.filter((r) => r.entityType === "PUBLICATION");
  check("publication operations are audited: created, updated, deleted, authors changed, translations changed, visibility changed", ["PUBLICATION_CREATED", "PUBLICATION_UPDATED", "PUBLICATION_DELETED", "PUBLICATION_AUTHORS_CHANGED", "TRANSLATIONS_CHANGED", "CONTENT_VISIBILITY_CHANGED"].every((a) => pubRows.some((r) => r.action === a)), [...new Set(pubRows.map((r) => r.action))].join());
  check("translation changes are audited by field NAMES and locale only — never the text", pubRows.filter((r) => r.action === "TRANSLATIONS_CHANGED").every((r) => /"locale":"ja"/.test(r.details ?? "") && /"fields":"(title|venue|title,venue|venue,title)"/.test(r.details ?? "") && !/[぀-ヿ一-鿿]/.test(r.details ?? "")));
  check("no audit row holds a password, hash, token or any Japanese text (translated titles, hostile ja strings)", rows.every((r) => !/passwordHash|ChangeMe|Str0ngPassw0rd|作成|アルファ|秘密|日本語|デルタ/.test(r.details ?? "")));
  check("hostile markup can only appear in the short English `title` detail (which the log viewer renders as text), never in another key", rows.filter((r) => /<script|onerror/.test(r.details ?? "")).every((r) => Object.entries(JSON.parse(r.details)).filter(([, v]) => /<script|onerror/.test(String(v))).every(([k]) => k === "title")));
  check("a rejected write (403) leaves no audit row", !pubRows.some((r) => /Sneaky/.test(r.details ?? "")));

  // ------------------------------------------------------------------
  section("cleanup");
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: RUN_STARTED } } });
  await cleanup();
  const after = {
    pubs: await prisma.publication.count(),
    pubAuthors: await prisma.publicationAuthor.count(),
    projectPubs: await prisma.projectPublication.count(),
    translations: await prisma.translation.count(),
    projects: await prisma.researchProject.count(),
    members: await prisma.teamMember.count(),
    news: await prisma.newsItem.count(),
    events: await prisma.event.count(),
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
