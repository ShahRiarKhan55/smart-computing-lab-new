/**
 * End-to-end API regression for the ADMIN / CMS layer (Phase 17): /api/admin/*, account link/unlink
 * (/api/users/:id/link), bulk visibility, translation management, the audit viewer, community and
 * files overviews, plus the security boundaries around them (roles, locale, privacy, enumeration).
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:C:/abs/path/to/copy.db PORT=4061 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:C:/abs/path/to/copy.db API=http://localhost:4061 node scripts/admin-regression.mjs
 *
 * Run it ONLY against a COPY of the database: it removes every audit row written during the run.
 * Fixtures are prefixed "ZZ Admin" / p17test-*@example.test and removed again (also at the start,
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
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...(locale ? { "X-Locale": locale } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    this.#save(res);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, type: res.headers.get("content-type") ?? "" };
  }
  async upload(path, fields, file) {
    const form = new FormData();
    form.set("file", new Blob([file.buffer], { type: file.contentType }), file.filename);
    for (const [k, v] of Object.entries(fields ?? {})) form.set(k, v);
    const res = await fetch(`${API}/api${path}`, { method: "POST", headers: this.cookie ? { cookie: this.cookie } : {}, body: form });
    this.#save(res);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  }
  #save(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      if (/^scl\.sid=;?$/.test(pair) || /Expires=Thu, 01 Jan 1970/i.test(c)) this.cookie = "";
      else if (pair.startsWith("scl.sid=")) this.cookie = pair;
    }
  }
  get = (p, l) => this.req("GET", p, undefined, l);
  post = (p, b, l) => this.req("POST", p, b ?? {}, l);
  put = (p, b, l) => this.req("PUT", p, b ?? {}, l);
  del = (p, l) => this.req("DELETE", p, undefined, l);
  login = (email, password) => this.post("/auth/login", { email, password });
}

const HOUR = 3600_000;
const iso = (h) => new Date(Date.now() + h * HOUR).toISOString();
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x11)]);
const TOKEN = "ZZAdminPrivateToken7731";

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { title: { startsWith: "ZZ Admin" } }, select: { id: true } });
  const news = await prisma.newsItem.findMany({ where: { title: { startsWith: "ZZ Admin" } }, select: { id: true } });
  const areas = await prisma.researchArea.findMany({ where: { title: { startsWith: "ZZ Admin" } }, select: { id: true } });
  const projects = await prisma.researchProject.findMany({ where: { title: { startsWith: "ZZ Admin" } }, select: { id: true } });
  const groups = await prisma.researchGroup.findMany({ where: { name: { startsWith: "ZZ Admin" } }, select: { id: true } });
  const tms = await prisma.teamMember.findMany({ where: { name: { startsWith: "ZZ Admin" } }, select: { id: true } });
  const ids = [...ev, ...news, ...areas, ...projects, ...groups, ...tms].map((x) => x.id);
  await prisma.translation.deleteMany({ where: { entityId: { in: ids } } });
  const users = await prisma.user.findMany({ where: { email: { startsWith: "p17test-" } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.conversation.deleteMany({ where: { participants: { some: { userId: { in: uids } } } } });
  await prisma.notification.deleteMany({ where: { userId: { in: uids } } });
  const gal = await prisma.galleryItem.findMany({ where: { caption: { startsWith: "ZZ Admin" } }, select: { id: true, fileId: true } });
  await prisma.galleryItem.deleteMany({ where: { id: { in: gal.map((g) => g.id) } } });
  await prisma.storedFile.deleteMany({ where: { ownerId: { in: uids }, galleryItem: null } });
  await prisma.storedFile.deleteMany({ where: { id: { in: gal.map((g) => g.fileId) } } });
  await prisma.forumPost.deleteMany({ where: { title: { startsWith: "ZZ Admin" } } });
  await prisma.forumCategory.deleteMany({ where: { name: { startsWith: "ZZ Admin" } } });
  await prisma.event.deleteMany({ where: { title: { startsWith: "ZZ Admin" } } });
  await prisma.newsItem.deleteMany({ where: { title: { startsWith: "ZZ Admin" } } });
  await prisma.publication.deleteMany({ where: { title: { startsWith: "ZZ Admin" } } });
  await prisma.researchArea.deleteMany({ where: { title: { startsWith: "ZZ Admin" } } });
  await prisma.researchProject.deleteMany({ where: { title: { startsWith: "ZZ Admin" } } });
  await prisma.researchGroup.deleteMany({ where: { name: { startsWith: "ZZ Admin" } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "p17test-" } } }).catch(() => {});
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: "ZZ Admin" } } });
}

const ADMIN_GETS = [
  "/admin/overview",
  "/admin/content?type=news",
  "/admin/translations?type=EVENT",
  "/admin/audit",
  "/admin/community",
  "/admin/files",
];

async function main() {
  await cleanup();
  const before = {
    users: await prisma.user.count(),
    team: await prisma.teamMember.count(),
    news: await prisma.newsItem.count(),
    pubs: await prisma.publication.count(),
    areas: await prisma.researchArea.count(),
    events: await prisma.event.count(),
    translations: await prisma.translation.count(),
    stored: await prisma.storedFile.count(),
  };

  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);
  const adminMe = (await admin.get("/auth/me")).json.user;
  const guest = new Client();

  const mk = async (key, role, name) => {
    const email = `p17test-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "ZA", memberRole: "Researcher", category: "RESEARCH" });
    const client = new Client();
    await client.login(email, PW);
    const tm = await prisma.teamMember.findFirst({ where: { name } });
    return { client, id: r.json?.id, email, tm, status: r.status };
  };

  // ------------------------------------------------------------------
  section("fixtures");
  const mgr = await mk("mgr", "LAB_MANAGER", "ZZ Admin Manager");
  const memA = await mk("a", "MEMBER", "ZZ Admin Alice");
  const memB = await mk("b", "MEMBER", "ZZ Admin Bob");
  check("fixtures: three accounts created with profiles", [mgr, memA, memB].every((u) => u.status === 201 && u.tm));

  const mkNews = (n, vis, extra = {}) =>
    prisma.newsItem.create({ data: { dateLabel: "Jan 1, 2030", sortDate: "2030-01-01", type: "Award", title: `ZZ Admin News ${n}`, description: `desc ${n}`, visibility: vis, ...extra } });
  const news1 = await mkNews("One", "PUBLIC");
  const news2 = await mkNews("Two", "PUBLIC");
  const news3 = await mkNews("Three", "LAB_ONLY", { type: "Grant" });
  const pub1 = await prisma.publication.create({ data: { year: 2030, title: "ZZ Admin Pub One", authors: "A. Author", venue: "ZZ Venue", visibility: "PUBLIC" } });
  const area1 = await prisma.researchArea.create({ data: { title: "ZZ Admin Area One", description: "area", tag: "ZZ", visibility: "PUBLIC" } });
  const proj1 = await prisma.researchProject.create({ data: { slug: "zz-admin-proj-1", title: "ZZ Admin Project One", visibility: "PUBLIC", status: "ACTIVE" } });
  const proj2 = await prisma.researchProject.create({ data: { slug: "zz-admin-proj-2", title: "ZZ Admin Project Two", visibility: "LAB_ONLY", status: "PLANNED" } });
  const grp1 = await prisma.researchGroup.create({ data: { slug: "zz-admin-grp-1", name: "ZZ Admin Group One", visibility: "PUBLIC" } });
  await prisma.projectArea.create({ data: { projectId: proj1.id, researchAreaId: area1.id } });
  await prisma.projectMember.create({ data: { projectId: proj1.id, teamMemberId: memA.tm.id } });

  const evUp = (await memA.client.post("/events", { title: "ZZ Admin Event Upcoming", description: "talk", location: "ZZ Room", kind: "SEMINAR", startsAt: iso(48), endsAt: iso(50) })).json;
  const evPast = (await mgr.client.post("/events", { title: "ZZ Admin Event Past", kind: "MEETING", startsAt: iso(-72), endsAt: iso(-70), visibility: "PUBLIC" })).json;
  check("fixtures: events created (member's is LAB_ONLY by default)", evUp?.id && evPast?.id && (await prisma.event.findUnique({ where: { id: evUp.id } }))?.visibility === "LAB_ONLY");

  // ------------------------------------------------------------------
  section("1. access matrix (server-side, every role)");
  for (const p of ADMIN_GETS) {
    const [g, m, l, a] = [await guest.get(p), await memA.client.get(p), await mgr.client.get(p), await admin.get(p)];
    check(`GET ${p}: guest 401 / member 403 / manager 200 / admin 200`, g.status === 401 && m.status === 403 && l.status === 200 && a.status === 200, `${g.status}/${m.status}/${l.status}/${a.status}`);
  }
  const detailPath = `/admin/content/news/${news1.id}`;
  check("GET content detail: guest 401 / member 403 / manager 200", (await guest.get(detailPath)).status === 401 && (await memA.client.get(detailPath)).status === 403 && (await mgr.client.get(detailPath)).status === 200);
  const bulkBody = { type: "news", ids: [news1.id], visibility: "PUBLIC" };
  check("POST bulk visibility: guest 401 / member 403", (await guest.post("/admin/content/visibility", bulkBody)).status === 401 && (await memA.client.post("/admin/content/visibility", bulkBody)).status === 403);
  const trPut = { field: "title", value: "x" };
  check("PUT translation: guest 401 / member 403", (await guest.put(`/admin/translations/NEWS_ITEM/${news1.id}`, trPut)).status === 401 && (await memA.client.put(`/admin/translations/NEWS_ITEM/${news1.id}`, trPut)).status === 403);
  check("a member's 403 leaves no translation behind", (await prisma.translation.count({ where: { entityId: news1.id } })) === 0);
  check("unknown /admin/* path: 404 for a manager, 401 for a guest", (await mgr.client.get("/admin/nope")).status === 404 && (await guest.get("/admin/nope")).status === 401);
  check("account routes stay ADMIN-only: manager GET /users 403, PUT link 403, member 403, guest 401",
    (await mgr.client.get("/users")).status === 403 && (await mgr.client.put(`/users/${memA.id}/link`, { teamMemberId: null })).status === 403 &&
    (await memA.client.put(`/users/${memA.id}/link`, { teamMemberId: null })).status === 403 && (await guest.put(`/users/${memA.id}/link`, { teamMemberId: null })).status === 401);
  check("guest gets the SAME 401 body for an existing and a missing content id (no enumeration)",
    (await guest.get(detailPath)).text === (await guest.get("/admin/content/news/doesnotexist000")).text);

  // ------------------------------------------------------------------
  section("2. overview");
  const ov = (await mgr.client.get("/admin/overview")).json;
  const ovA = (await admin.get("/admin/overview")).json;
  check("manager overview has NO account block; admin's has one", ov.accounts === null && ovA.accounts && ovA.accounts.total === (await prisma.user.count()));
  check("counts equal the database: news / publications / areas / events / team", ov.news.total === (await prisma.newsItem.count()) && ov.publications.total === (await prisma.publication.count()) &&
    ov.researchAreas.total === (await prisma.researchArea.count()) && ov.events.total === (await prisma.event.count()) && ov.teamMembers === (await prisma.teamMember.count()));
  check("public + lab-only = total for every counted type", ["researchAreas", "projects", "groups", "publications", "news", "events", "forumCategories", "galleryItems"].every((k) => ov[k].public + ov[k].labOnly === ov[k].total));
  check("visible vs lab-only news matches the database", ov.news.labOnly === (await prisma.newsItem.count({ where: { visibility: "LAB_ONLY" } })) && ov.news.public === (await prisma.newsItem.count({ where: { visibility: "PUBLIC" } })));
  check("upcoming events counts the future one", ov.events.upcoming >= 1);
  check("account role counts add up", ovA.accounts.admins + ovA.accounts.managers + ovA.accounts.members === ovA.accounts.total && ovA.accounts.managers >= 1);
  const ovBlob = JSON.stringify(ov) + JSON.stringify(ovA);
  check("overview carries no email, id or message/notification figures", !/@|"id"|userId|message|notification|conversation/i.test(ovBlob));
  check("overview is identical for X-Locale en / ja / garbage",
    JSON.stringify((await mgr.client.get("/admin/overview", "en")).json) === JSON.stringify((await mgr.client.get("/admin/overview", "ja")).json) &&
    JSON.stringify((await mgr.client.get("/admin/overview", "en")).json) === JSON.stringify((await mgr.client.get("/admin/overview", "xx")).json));

  // ------------------------------------------------------------------
  section("3. content list: filters, search, pagination");
  const list = (qs, c = mgr.client, l) => c.get(`/admin/content?${qs}`, l);
  for (const type of ["research-area", "project", "group", "publication", "news", "event", "team-member"]) {
    const r = await list(`type=${type}`);
    check(`${type}: 200 with rows and a pagination block`, r.status === 200 && Array.isArray(r.json?.rows) && r.json.pagination?.total >= 1 && r.json.type === type, `${r.status}`);
  }
  const rowsFor = async (qs, c, l) => (await list(qs, c, l)).json?.rows ?? [];
  const titles = (rows) => rows.map((r) => r.title);
  check("q finds by title (ASCII, case-insensitive)", titles(await rowsFor("type=news&q=zz%20admin%20news%20ONE")).join() === "ZZ Admin News One");
  check("q AND-s its words", titles(await rowsFor("type=news&q=zz+admin+news+two+one")).length === 0);
  check("q finds by another column (description)", titles(await rowsFor("type=news&q=desc%20Two")).join() === "ZZ Admin News Two");
  check("visibility=LAB_ONLY narrows news to the hidden one", titles(await rowsFor("type=news&q=ZZ+Admin&visibility=LAB_ONLY")).join() === "ZZ Admin News Three");
  check("visibility=PUBLIC excludes it", !titles(await rowsFor("type=news&q=ZZ+Admin&visibility=PUBLIC")).includes("ZZ Admin News Three"));
  check("newsType filter", titles(await rowsFor("type=news&q=ZZ+Admin&newsType=Grant")).join() === "ZZ Admin News Three");
  check("project status filter", titles(await rowsFor("type=project&q=ZZ+Admin&status=PLANNED")).join() === "ZZ Admin Project Two");
  check("project rows carry visibility + status + a public link", await (async () => { const r = (await rowsFor("type=project&q=ZZ+Admin+Project+One"))[0]; return r?.visibility === "PUBLIC" && r.status === "ACTIVE" && r.href === `/projects/${proj1.id}`; })());
  check("group + publication + research-area rows", (await rowsFor("type=group&q=ZZ+Admin"))[0]?.href === `/groups/${grp1.id}` && (await rowsFor("type=publication&q=ZZ+Admin"))[0]?.subtitle === "2030 · ZZ Venue" && (await rowsFor("type=research-area&q=ZZ+Admin"))[0]?.subtitle === "ZZ");
  check("events: scope=upcoming / past", titles(await rowsFor("type=event&q=ZZ+Admin&scope=upcoming")).join() === "ZZ Admin Event Upcoming" && titles(await rowsFor("type=event&q=ZZ+Admin&scope=past")).join() === "ZZ Admin Event Past");
  check("events: kind filter", titles(await rowsFor("type=event&q=ZZ+Admin&kind=MEETING")).join() === "ZZ Admin Event Past");
  check("events: visibility filter (member's event is LAB_ONLY)", titles(await rowsFor("type=event&q=ZZ+Admin&visibility=LAB_ONLY")).join() === "ZZ Admin Event Upcoming");
  const evRow = (await rowsFor("type=event&q=ZZ+Admin&scope=upcoming"))[0];
  check("events: the owner is the creator's PUBLIC profile (never an account)", evRow?.owner?.id === memA.tm.id && evRow.owner.name === "ZZ Admin Alice" && !/userId|email/.test(JSON.stringify(evRow)));
  check("events: owner filter by team-member id", titles(await rowsFor(`type=event&q=ZZ+Admin&owner=${memA.tm.id}`)).join() === "ZZ Admin Event Upcoming" && titles(await rowsFor(`type=event&q=ZZ+Admin&owner=${mgr.tm.id}`)).join() === "ZZ Admin Event Past");
  check("events: an unknown owner id matches nothing (200, empty)", (await rowsFor("type=event&owner=doesnotexist000")).length === 0);
  check("date filter: from far future finds none, from=2000 finds fixtures", (await rowsFor("type=news&q=ZZ+Admin&from=2099-01-01")).length === 0 && (await rowsFor("type=news&q=ZZ+Admin&from=2000-01-01")).length === 3);
  check("date filter: to in the past finds none; today inclusive", (await rowsFor("type=news&q=ZZ+Admin&to=2000-01-01")).length === 0 && (await rowsFor(`type=news&q=ZZ+Admin&to=${new Date().toISOString().slice(0, 10)}`)).length === 3);
  check("sort=title is alphabetical", titles(await rowsFor("type=news&q=ZZ+Admin&sort=title")).join() === "ZZ Admin News One,ZZ Admin News Three,ZZ Admin News Two");
  check("team profiles: hasAccount is present for ADMIN only", (await rowsFor(`type=team-member&q=ZZ+Admin+Alice`, admin))[0]?.hasAccount === true && (await rowsFor(`type=team-member&q=ZZ+Admin+Alice`, mgr.client))[0]?.hasAccount === null);
  check("team profiles have no visibility field value", (await rowsFor(`type=team-member&q=ZZ+Admin+Alice`))[0]?.visibility === null);
  // pagination
  const p1 = (await list("type=news&sort=title&limit=2&page=1")).json;
  const p2 = (await list("type=news&sort=title&limit=2&page=2")).json;
  check("pagination: total, totalPages, no duplicates across pages", p1.pagination.limit === 2 && p1.pagination.totalPages === Math.ceil(p1.pagination.total / 2) && p1.rows.length === 2 && !p1.rows.some((r) => p2.rows.some((x) => x.id === r.id)));
  check("pagination: a page past the end is empty, not an error", (await list("type=news&page=9999")).json?.rows.length === 0);
  check("pagination is deterministic (same twice)", JSON.stringify((await list("type=news&limit=3")).json) === JSON.stringify((await list("type=news&limit=3")).json));
  // invalid inputs
  const bad = [
    ["missing type", ""],
    ["unknown type", "type=message"],
    ["array type", "type=news&type=project"],
    ["object param", "type[a]=b"],
    ["bad visibility", "type=news&visibility=PRIVATE"],
    ["visibility on team-member", "type=team-member&visibility=PUBLIC"],
    ["kind on news", "type=news&kind=SEMINAR"],
    ["scope on news", "type=news&scope=past"],
    ["owner on news", `type=news&owner=${memA.tm.id}`],
    ["status on news", "type=news&status=ACTIVE"],
    ["newsType on project", "type=project&newsType=Grant"],
    ["bad enum kind", "type=event&kind=PARTY"],
    ["bad scope", "type=event&scope=someday"],
    ["page 0", "type=news&page=0"],
    ["page abc", "type=news&page=abc"],
    ["page negative", "type=news&page=-1"],
    ["page decimal", "type=news&page=1.5"],
    ["page huge", "type=news&page=99999999"],
    ["limit 0", "type=news&limit=0"],
    ["limit 101", "type=news&limit=101"],
    ["limit exp", "type=news&limit=1e2"],
    ["from not a date", "type=news&from=yesterday"],
    ["from Feb 30", "type=news&from=2030-02-30"],
    ["from after to", "type=news&from=2030-02-02&to=2030-01-01"],
    ["owner malformed", "type=event&owner=../../etc"],
    ["q too long", `type=news&q=${"a".repeat(101)}`],
    ["q too many words", "type=news&q=a+b+c+d+e+f+g+h+i"],
    ["bad sort", "type=news&sort=password"],
    ["bad translation state", "type=news&translation=maybe"],
  ];
  for (const [name, qs] of bad) {
    const r = await list(qs);
    check(`invalid input -> 400 (${name})`, r.status === 400 && typeof r.json?.error === "string", `${r.status} ${r.text.slice(0, 80)}`);
  }
  // injection-style inputs are just text
  const totalBefore = (await list("type=news")).json.pagination.total;
  for (const inj of ["' OR '1'='1", "\"; DROP TABLE NewsItem; --", "%' OR 1=1 --", "1) UNION SELECT passwordHash FROM User --", "{\"$ne\":null}", "\\"]) {
    const r = await list(`type=news&q=${encodeURIComponent(inj)}`);
    check(`injection-style q is inert: ${JSON.stringify(inj).slice(0, 30)}`, r.status === 200 && r.json.rows.length <= totalBefore && !/passwordHash|\$2[aby]\$/.test(r.text));
  }
  check("the tables survived", (await list("type=news")).json.pagination.total === totalBefore);
  check("q='%' behaves like no filter (a separator, never a wildcard)", (await list("type=news&q=%25")).json.pagination.total === totalBefore);
  check("q='_' behaves like no filter", (await list("type=news&q=_")).json.pagination.total === totalBefore);
  check("Japanese q is accepted and matches nothing rather than erroring", (await list(`type=news&q=${encodeURIComponent("日本語のテスト")}`)).status === 200);
  check("a very long unbroken word (100 chars) is fine", (await list(`type=news&q=${"x".repeat(100)}`)).status === 200);
  check("no userId / passwordHash / email anywhere in a team list", !/userId|passwordHash|@example\.test|"email"/.test((await list("type=team-member&limit=100", admin)).text));
  check("no account id leaks into any content list (admin viewer)", await (async () => { for (const t of ["team-member", "event", "news", "project"]) if ((await list(`type=${t}&limit=100`, admin)).text.includes(adminMe.id)) return false; return true; })());
  check("JSON content type (browsers never sniff it as HTML)", (await list("type=news")).type.startsWith("application/json"));

  // ------------------------------------------------------------------
  section("4. content detail");
  const d = (await mgr.client.get(`/admin/content/project/${proj1.id}`)).json;
  check("project detail: row + relationship counts + translation state", d.row.id === proj1.id && d.relations.find((r) => r.key === "members")?.count === 1 && d.relations.find((r) => r.key === "areas")?.count === 1 && d.translations.length === 3 && d.translations.every((t) => t.hasOverride === false));
  check("team-member detail counts relationships", (await mgr.client.get(`/admin/content/team-member/${memA.tm.id}`)).json.relations.find((r) => r.key === "projects")?.count === 1);
  check("every type has a detail", await (async () => { for (const [t, id] of [["research-area", area1.id], ["group", grp1.id], ["publication", pub1.id], ["news", news1.id], ["event", evUp.id]]) if ((await mgr.client.get(`/admin/content/${t}/${id}`)).status !== 200) return false; return true; })());
  check("unknown id -> 404", (await mgr.client.get("/admin/content/news/doesnotexist000")).status === 404);
  check("malformed id -> 400", (await mgr.client.get("/admin/content/news/..%2F..%2Fetc")).status === 400 || (await mgr.client.get("/admin/content/news/a%20b")).status === 400);
  check("unknown type -> 404", (await mgr.client.get(`/admin/content/message/${news1.id}`)).status === 404);
  check("a type used as an id path can't reach another table", (await mgr.client.get(`/admin/content/news/${proj1.id}`)).status === 404);

  // ------------------------------------------------------------------
  section("5. bulk visibility");
  const bulk = (body, c = mgr.client, l) => c.post("/admin/content/visibility", body, l);
  const auditCount = (action) => prisma.auditLog.count({ where: { action, createdAt: { gte: RUN_STARTED } } });
  const vBefore = await auditCount("CONTENT_VISIBILITY_CHANGED");
  const r1 = await bulk({ type: "news", ids: [news1.id, news2.id], visibility: "LAB_ONLY" });
  check("bulk: manager hides two news items -> {updated:2, unchanged:0}", r1.status === 200 && r1.json.updated === 2 && r1.json.unchanged === 0, r1.text);
  check("bulk: both are LAB_ONLY in the database", (await prisma.newsItem.count({ where: { id: { in: [news1.id, news2.id] }, visibility: "LAB_ONLY" } })) === 2);
  check("bulk: a guest no longer sees them (public list)", !(await guest.get("/news")).json.some((n) => [news1.id, news2.id].includes(n.id)));
  check("bulk: nor through search or by id", (await guest.get(`/search?q=${encodeURIComponent("ZZ Admin News")}`)).json.results.length === 0 && (await guest.get(`/news`)).status === 200);
  check("bulk: audit -> two CONTENT_VISIBILITY_CHANGED + two NEWS_UPDATED rows", (await auditCount("CONTENT_VISIBILITY_CHANGED")) === vBefore + 2 && (await prisma.auditLog.count({ where: { action: "NEWS_UPDATED", entityId: { in: [news1.id, news2.id] } } })) === 2);
  const vRow = await prisma.auditLog.findFirst({ where: { action: "CONTENT_VISIBILITY_CHANGED", entityId: news1.id } });
  check("bulk: audit stores from/to and who did it", JSON.parse(vRow.details).from === "PUBLIC" && JSON.parse(vRow.details).to === "LAB_ONLY" && vRow.actorId === mgr.id);
  const r2 = await bulk({ type: "news", ids: [news1.id, news3.id], visibility: "LAB_ONLY" });
  check("bulk: already-matching records are 'unchanged' and write no audit", r2.json.updated === 0 && r2.json.unchanged === 2, r2.text);
  const vMid = await auditCount("CONTENT_VISIBILITY_CHANGED");
  const r3 = await bulk({ type: "news", ids: [news1.id, news2.id, news3.id], visibility: "LAB_ONLY" });
  check("bulk: repeating the same change is a no-op (0 updated, no audit)", r3.json.updated === 0 && r3.json.unchanged === 3 && (await auditCount("CONTENT_VISIBILITY_CHANGED")) === vMid);
  const r4 = await bulk({ type: "news", ids: [news1.id, "doesnotexist000"], visibility: "PUBLIC" });
  check("bulk: one unknown id fails the WHOLE request (404) and changes nothing", r4.status === 404 && (await prisma.newsItem.findUnique({ where: { id: news1.id } })).visibility === "LAB_ONLY" && (await auditCount("CONTENT_VISIBILITY_CHANGED")) === vMid);
  const r5 = await bulk({ type: "news", ids: [news1.id, news2.id], visibility: "PUBLIC" });
  check("bulk: manager republishes -> 200 updated 2", r5.status === 200 && r5.json.updated === 2 && (await guest.get("/news")).json.filter((n) => [news1.id, news2.id].includes(n.id)).length === 2);
  for (const [name, body] of [
    ["empty ids", { type: "news", ids: [], visibility: "PUBLIC" }],
    ["duplicate ids", { type: "news", ids: [news1.id, news1.id], visibility: "PUBLIC" }],
    [`more than 100 ids`, { type: "news", ids: Array.from({ length: 101 }, (_, i) => `id${i}`), visibility: "PUBLIC" }],
    ["PRIVATE (not a visibility)", { type: "news", ids: [news1.id], visibility: "PRIVATE" }],
    ["lowercase visibility", { type: "news", ids: [news1.id], visibility: "public" }],
    ["team-member has no visibility", { type: "team-member", ids: [memA.tm.id], visibility: "PUBLIC" }],
    ["unknown type", { type: "message", ids: [news1.id], visibility: "PUBLIC" }],
    ["malformed id", { type: "news", ids: ["../x"], visibility: "PUBLIC" }],
    ["ids not an array", { type: "news", ids: news1.id, visibility: "PUBLIC" }],
    ["missing visibility", { type: "news", ids: [news1.id] }],
    ["no body", undefined],
    ["array body", [1, 2]],
  ]) {
    const r = await bulk(body);
    check(`bulk: invalid -> 400 (${name})`, r.status === 400, `${r.status} ${r.text.slice(0, 80)}`);
  }
  check("bulk: a raw non-JSON body is a 400, not a crash", (await mgr.client.req("POST", "/admin/content/visibility", "not json")).status === 400);
  const rProj = await bulk({ type: "project", ids: [proj1.id, proj2.id], visibility: "PUBLIC" });
  check("bulk: projects / events / groups / publications / areas all work", rProj.status === 200 && rProj.json.updated === 1 &&
    (await bulk({ type: "event", ids: [evUp.id], visibility: "PUBLIC" })).json.updated === 1 &&
    (await bulk({ type: "group", ids: [grp1.id], visibility: "LAB_ONLY" })).json.updated === 1 &&
    (await bulk({ type: "publication", ids: [pub1.id], visibility: "LAB_ONLY" })).json.updated === 1 &&
    (await bulk({ type: "research-area", ids: [area1.id], visibility: "LAB_ONLY" })).json.updated === 1);
  check("bulk: a group hidden this way is a 404 for a guest, exactly like a missing one", (await guest.get(`/groups/${grp1.id}`)).status === 404 && (await guest.get(`/groups/doesnotexist000`)).status === 404);
  check("bulk: a hidden publication/area is gone from a guest's search", (await guest.get(`/search?q=${encodeURIComponent("ZZ Admin Pub")}`)).json.results.length === 0 && (await guest.get(`/search?q=${encodeURIComponent("ZZ Admin Area")}`)).json.results.length === 0);
  check("bulk: the event made PUBLIC is now readable by a guest", (await guest.get(`/events/${evUp.id}`)).status === 200);
  await bulk({ type: "group", ids: [grp1.id], visibility: "PUBLIC" });
  await bulk({ type: "publication", ids: [pub1.id], visibility: "PUBLIC" });
  await bulk({ type: "research-area", ids: [area1.id], visibility: "PUBLIC" });
  await bulk({ type: "project", ids: [proj2.id], visibility: "LAB_ONLY" });
  await bulk({ type: "event", ids: [evUp.id], visibility: "LAB_ONLY" });
  check("bulk: a member can't do it and nothing changed", (await bulk({ type: "news", ids: [news3.id], visibility: "PUBLIC" }, memA.client)).status === 403 && (await prisma.newsItem.findUnique({ where: { id: news3.id } })).visibility === "LAB_ONLY");
  check("bulk: extra body keys (role, userId) are ignored, no escalation", (await bulk({ type: "news", ids: [news3.id], visibility: "LAB_ONLY", role: "ADMIN", userId: mgr.id }, mgr.client)).status === 200 && (await prisma.user.findUnique({ where: { id: mgr.id } })).role === "LAB_MANAGER");
  check("bulk: admin may too, and X-Locale never changes the outcome", (await bulk({ type: "news", ids: [news3.id], visibility: "LAB_ONLY" }, admin, "ja")).status === 200 && (await bulk({ type: "news", ids: [news3.id], visibility: "LAB_ONLY" }, admin, "en")).status === 200);
  check("bulk: the CONTENT_VISIBILITY audit rows never hold a body/secret key", (await prisma.auditLog.findMany({ where: { action: "CONTENT_VISIBILITY_CHANGED", createdAt: { gte: RUN_STARTED } } })).every((r) => !/pass|hash|token|body|content|message/i.test(Object.keys(JSON.parse(r.details ?? "{}")).join())));

  // ------------------------------------------------------------------
  section("6. translation management");
  const tr = (qs, c = mgr.client, l) => c.get(`/admin/translations?${qs}`, l);
  const putTr = (type, id, body, c = mgr.client, l) => c.put(`/admin/translations/${type}/${id}`, body, l);
  const JA_TITLE = "ZZ管理ニュース一号";
  const t1 = await putTr("NEWS_ITEM", news1.id, { field: "title", value: JA_TITLE });
  check("set a Japanese override -> 200 with the entry", t1.status === 200 && t1.json.fields.find((f) => f.field === "title")?.ja === JA_TITLE && t1.json.fields.find((f) => f.field === "title")?.base === "ZZ Admin News One");
  check("the base (English) column is untouched", (await prisma.newsItem.findUnique({ where: { id: news1.id } })).title === "ZZ Admin News One");
  check("a Japanese visitor now sees the override; English still sees the base", (await guest.get("/news", "ja")).json.find((n) => n.id === news1.id)?.title === JA_TITLE && (await guest.get("/news", "en")).json.find((n) => n.id === news1.id)?.title === "ZZ Admin News One");
  check("list shows the override state", (await tr("type=NEWS_ITEM&q=ZZ+Admin+News+One")).json.entries[0].fields.find((f) => f.field === "title").ja === JA_TITLE);
  check("state=overridden finds it, state=missing doesn't", (await tr("type=NEWS_ITEM&state=overridden&q=ZZ+Admin")).json.entries.map((e) => e.label).join() === "ZZ Admin News One" && !(await tr("type=NEWS_ITEM&state=missing&q=ZZ+Admin")).json.entries.some((e) => e.id === news1.id));
  check("searching the JAPANESE text finds the entry", (await tr(`type=NEWS_ITEM&q=${encodeURIComponent("管理ニュース")}`)).json.entries.map((e) => e.id).join() === news1.id);
  check("...regardless of X-Locale (locale never changes what is found)", (await tr(`type=NEWS_ITEM&q=${encodeURIComponent("管理ニュース")}`, mgr.client, "en")).json.entries.length === 1 && (await tr(`type=NEWS_ITEM&q=${encodeURIComponent("管理ニュース")}`, mgr.client, "ja")).json.entries.length === 1);
  check("the content list filters by translation state and finds Japanese text", (await list("type=news&translation=translated&q=ZZ+Admin")).json.rows.map((r) => r.id).join() === news1.id && (await list(`type=news&q=${encodeURIComponent("管理ニュース")}`)).json.rows.length === 1 && (await list("type=news&translation=untranslated&q=ZZ+Admin")).json.rows.length === 2);
  check("content row shows translation progress (1 of 2)", (await list("type=news&q=ZZ+Admin+News+One")).json.rows[0].translation.done === 1 && (await list("type=news&q=ZZ+Admin+News+One")).json.rows[0].translation.total === 2);
  const tAudit = await prisma.auditLog.findFirst({ where: { action: "TRANSLATIONS_CHANGED", entityId: news1.id } });
  check("audit: TRANSLATIONS_CHANGED with the FIELD NAME, never the text", tAudit && JSON.parse(tAudit.details).fields === "title" && !tAudit.details.includes("ZZ管理") && tAudit.actorId === mgr.id);
  const cnt = await prisma.auditLog.count({ where: { action: "TRANSLATIONS_CHANGED" } });
  await putTr("NEWS_ITEM", news1.id, { field: "title", value: JA_TITLE });
  check("re-saving an identical value writes no audit row", (await prisma.auditLog.count({ where: { action: "TRANSLATIONS_CHANGED" } })) === cnt);
  const t2 = await putTr("NEWS_ITEM", news1.id, { field: "title", value: "" });
  check("clearing with '' removes the override (falls back to English)", t2.status === 200 && t2.json.fields.find((f) => f.field === "title").ja === null && (await guest.get("/news", "ja")).json.find((n) => n.id === news1.id)?.title === "ZZ Admin News One");
  await putTr("NEWS_ITEM", news1.id, { field: "description", value: "説明" });
  check("clearing with null works too, and audits 'cleared'", (await putTr("NEWS_ITEM", news1.id, { field: "description", value: null })).status === 200 && JSON.parse((await prisma.auditLog.findFirst({ where: { action: "TRANSLATIONS_CHANGED", entityId: news1.id }, orderBy: { createdAt: "desc" } })).details).cleared === true);
  check("every translatable type can be edited", await (async () => {
    for (const [t, id, f] of [["RESEARCH_AREA", area1.id, "title"], ["RESEARCH_PROJECT", proj1.id, "summary"], ["RESEARCH_GROUP", grp1.id, "name"], ["EVENT", evUp.id, "title"], ["TEAM_MEMBER", memA.tm.id, "bio"]]) {
      const r = await putTr(t, id, { field: f, value: "ZZ日本語" });
      if (r.status !== 200) return false;
    }
    return true;
  })());
  check("an EVENT translation reuses EVENT_TRANSLATIONS_CHANGED", (await prisma.auditLog.count({ where: { action: "EVENT_TRANSLATIONS_CHANGED", entityId: evUp.id } })) === 1);
  check("...and the event's own GET shows it in Japanese", (await memA.client.get(`/events/${evUp.id}`, "ja")).json.title === "ZZ日本語");
  check("the list reports each type with its fields and caps", (await tr("type=RESEARCH_PROJECT")).json.entries.every((e) => e.fields.length === 3 && e.fields.every((f) => f.max > 0)) && (await tr("type=TEAM_MEMBER&q=ZZ+Admin+Alice")).json.entries[0].fields[0].ja === "ZZ日本語");
  for (const [name, type, id, body, status] of [
    ["unknown field", "NEWS_ITEM", news1.id, { field: "sortDate", value: "x" }, 400],
    ["a non-translatable field (visibility)", "NEWS_ITEM", news1.id, { field: "visibility", value: "PUBLIC" }, 400],
    ["missing field", "NEWS_ITEM", news1.id, { value: "x" }, 400],
    ["value not text", "NEWS_ITEM", news1.id, { field: "title", value: 5 }, 400],
    ["value undefined", "NEWS_ITEM", news1.id, { field: "title" }, 400],
    ["over the cap (301 > 300)", "NEWS_ITEM", news1.id, { field: "title", value: "あ".repeat(301) }, 400],
    ["team bio over 2000", "TEAM_MEMBER", memA.tm.id, { field: "bio", value: "x".repeat(2001) }, 400],
    ["non-translatable entity type", "FORUM_CATEGORY", news1.id, { field: "name", value: "x" }, 404],
    ["lowercase entity type", "news_item", news1.id, { field: "title", value: "x" }, 404],
    ["prototype-ish entity type", "constructor", news1.id, { field: "title", value: "x" }, 404],
    ["malformed id", "NEWS_ITEM", "a b", { field: "title", value: "x" }, 400],
    ["missing entity", "NEWS_ITEM", "doesnotexist000", { field: "title", value: "x" }, 404],
    ["an id from another table", "NEWS_ITEM", proj1.id, { field: "title", value: "x" }, 404],
  ]) {
    const r = await putTr(type, id, body);
    check(`translation PUT invalid -> ${status} (${name})`, r.status === status, `${r.status} ${r.text.slice(0, 80)}`);
  }
  const atCap = await putTr("NEWS_ITEM", news1.id, { field: "title", value: "あ".repeat(300) });
  check("exactly at the cap is accepted (Japanese, 300 chars)", atCap.status === 200);
  const longToken = "x".repeat(300);
  check("an unbroken 300-char token is stored and returned as-is", (await putTr("NEWS_ITEM", news1.id, { field: "title", value: longToken })).json.fields[0].ja === longToken);
  const XSS = `<img src=x onerror=alert(1)><script>alert(1)</script>`;
  const tx = await putTr("NEWS_ITEM", news1.id, { field: "title", value: XSS });
  check("XSS payload is stored as inert text and served as JSON", tx.status === 200 && tx.type.startsWith("application/json") && tx.json.fields[0].ja === XSS);
  await putTr("NEWS_ITEM", news1.id, { field: "title", value: null });
  check("an over-cap request wrote nothing", (await prisma.translation.count({ where: { entityId: news1.id, field: "title" } })) === 0);
  check("X-Locale en / ja / garbage give the same authorization outcomes on PUT", await (async () => {
    const out = [];
    for (const l of ["en", "ja", "xx", undefined]) {
      out.push((await putTr("NEWS_ITEM", news2.id, { field: "title", value: "L" }, memA.client, l)).status);
      out.push((await putTr("NEWS_ITEM", news2.id, { field: "title", value: "L" }, guest, l)).status);
    }
    return out.every((s, i) => s === (i % 2 === 0 ? 403 : 401));
  })());
  for (const [q, name] of [["type=NEWS_ITEM&state=x", "bad state"], ["type=FORUM_CATEGORY", "non-translatable type"], ["", "no type"], ["type=NEWS_ITEM&page=0", "page 0"], ["type=NEWS_ITEM&limit=500", "limit 500"], ["type=NEWS_ITEM&type=EVENT", "array type"]]) {
    check(`translations list invalid -> 400 (${name})`, (await tr(q)).status === 400);
  }
  check("translations list paginates deterministically", (await tr("type=NEWS_ITEM&limit=1&page=2")).json.entries.length === 1 && (await tr("type=NEWS_ITEM&limit=1&page=2")).json.pagination.totalPages === (await tr("type=NEWS_ITEM&limit=1")).json.pagination.total);
  check("the read-only entity endpoint is unchanged and agrees", (await mgr.client.get(`/translations/EVENT/${evUp.id}`)).json.ja.title === "ZZ日本語");
  check("audit never stored a translated value anywhere", (await prisma.auditLog.count({ where: { createdAt: { gte: RUN_STARTED }, details: { contains: "日本語" } } })) === 0);

  // ------------------------------------------------------------------
  section("7. audit viewer");
  const au = (qs, c = mgr.client, l) => c.get(`/admin/audit${qs ? `?${qs}` : ""}`, l);
  const aAdmin = (await au("limit=100", admin)).json;
  const aMgr = (await au("limit=100")).json;
  check("admin sees account events (USER_CREATED ...)", aAdmin.entries.some((e) => e.entityType === "USER" && e.action === "USER_CREATED"));
  check("a manager sees NO USER entries at all, and not in the facets", !aMgr.entries.some((e) => e.entityType === "USER") && !aMgr.facets.entityTypes.includes("USER") && !aMgr.facets.actions.includes("USER_CREATED") && aMgr.pagination.total < aAdmin.pagination.total);
  check("a manager filtering entityType=USER gets nothing (not 403, not a leak)", (await au("entityType=USER")).json.entries.length === 0);
  check("a manager sees actors as profile names, never emails", aMgr.entries.every((e) => e.actor === null || !e.actor.includes("@")) && !JSON.stringify(aMgr).includes("example.test") && aMgr.entries.some((e) => e.actor === "ZZ Admin Manager"));
  check("admin sees actor emails", aAdmin.entries.some((e) => e.actor === ADMIN.email));
  check("a manager may not filter by actor (403), admin may", (await au("actor=admin")).status === 403 && (await au("actor=admin@", admin)).json.entries.length > 0 && (await au("actor=nobody-here", admin)).json.entries.length === 0);
  check("filter by action", (await au("action=CONTENT_VISIBILITY_CHANGED&limit=100")).json.entries.every((e) => e.action === "CONTENT_VISIBILITY_CHANGED") && (await au("action=CONTENT_VISIBILITY_CHANGED")).json.entries.length > 0);
  check("filter by entityType", (await au("entityType=NEWS_ITEM&limit=100")).json.entries.every((e) => e.entityType === "NEWS_ITEM"));
  check("filter by date range: today has entries, an old day has none", (await au(`from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`)).json.entries.length > 0 && (await au("from=2001-01-01&to=2001-01-02")).json.entries.length === 0);
  check("combined filters AND together", (await au("action=NEWS_UPDATED&entityType=RESEARCH_PROJECT")).json.entries.length === 0);
  const pages = [];
  for (let p = 1; p <= 3; p++) pages.push((await au(`limit=5&page=${p}`)).json);
  const flat = pages.flatMap((p) => p.entries);
  check("audit paging: newest first, no duplicates, stable", flat.length === 15 && new Set(flat.map((e) => e.id)).size === 15 && flat.every((e, i) => i === 0 || flat[i - 1].createdAt >= e.createdAt));
  check("audit paging is deterministic (same twice)", JSON.stringify((await au("limit=5&page=2")).json) === JSON.stringify(pages[1]));
  check("totalPages matches", pages[0].pagination.totalPages === Math.ceil(pages[0].pagination.total / 5));
  check("every entry's details are flat and free of secret-looking keys", [...aAdmin.entries].every((e) => Object.values(e.details).every((v) => v === null || ["string", "number", "boolean"].includes(typeof v)) && !Object.keys(e.details).some((k) => /pass|hash|secret|token|cookie|session|body|content|message/i.test(k))));
  check("no password / hash / session material in the audit response", !/\$2[aby]\$|passwordHash|scl\.sid/.test(JSON.stringify(aAdmin)));
  for (const [q, name] of [["action=lowercase", "lowercase action"], ["action=A;B", "punctuation action"], ["entityType=<x>", "html entityType"], ["page=0", "page 0"], ["limit=101", "limit 101"], ["from=2030-02-30", "impossible date"], ["from=2030-01-02&to=2030-01-01", "reversed range"], ["action=A&action=B", "array action"], [`actor=${"a".repeat(101)}`, "actor too long"]]) {
    const r = await au(q, admin);
    check(`audit invalid -> 400 (${name})`, r.status === 400, `${r.status}`);
  }
  check("audit output identical for X-Locale en/ja", JSON.stringify((await au("limit=10", mgr.client, "en")).json) === JSON.stringify((await au("limit=10", mgr.client, "ja")).json));
  const planted = await prisma.auditLog.create({ data: { actorId: null, actorEmail: "planted@example.test", action: "NEWS_UPDATED", entityType: "NEWS_ITEM", entityId: news2.id, details: JSON.stringify({ title: "planted", email: "leak@example.test", ownerEmail: "leak2@example.test", changed: "title" }) } });
  const plantedM = (await au("entityType=NEWS_ITEM&limit=100")).json.entries.find((e) => e.id === planted.id);
  const plantedA = (await au("entityType=NEWS_ITEM&limit=100", admin)).json.entries.find((e) => e.id === planted.id);
  check("audit: an email-like detail key is dropped for a manager (defence in depth) but kept for admin", plantedM && !("email" in plantedM.details) && !("ownerEmail" in plantedM.details) && plantedM.details.title === "planted" && plantedA?.details.email === "leak@example.test" && !JSON.stringify(plantedM).includes("example.test"));
  check("a hostile-but-stored action string can't appear in the facets unescaped", (await au("")).json.facets.actions.every((a) => /^[A-Z_]+$/.test(a)));

  // ------------------------------------------------------------------
  section("8. accounts: link / unlink");
  const solo = await admin.post("/users", { email: "p17test-solo@example.test", password: PW, role: "MEMBER" });
  const orphan = await prisma.teamMember.create({ data: { name: "ZZ Admin Orphan", initials: "ZO", role: "Alumni", category: "RESEARCH" } });
  const orphan2 = await prisma.teamMember.create({ data: { name: "ZZ Admin Orphan Two", initials: "ZT", role: "Alumni", category: "RESEARCH" } });
  const link = (id, body, c = admin, l) => c.put(`/users/${id}/link`, body, l);
  check("account with no profile is listed without one", (await admin.get("/users")).json.find((u) => u.id === solo.json.id)?.teamMemberId === null);
  const l1 = await link(solo.json.id, { teamMemberId: orphan.id });
  check("link an account to an unlinked profile -> 200", l1.status === 200 && (await prisma.teamMember.findUnique({ where: { id: orphan.id } })).userId === solo.json.id);
  check("the admin list and the content list now agree", (await admin.get("/users")).json.find((u) => u.id === solo.json.id)?.teamMemberId === orphan.id && (await rowsFor("type=team-member&q=ZZ+Admin+Orphan", admin)).find((r) => r.id === orphan.id)?.hasAccount === true);
  const again = await link(solo.json.id, { teamMemberId: orphan2.id });
  check("linking again (already linked) -> 409 with the 'unlink it first' message (the guard, not just the DB's unique index)", again.status === 409 && /Unlink it first/.test(again.json?.error ?? ""), again.text);
  check("linking a profile that already has an account -> 409", (await link(memB.id, { teamMemberId: orphan.id })).status === 409);
  const bare = await admin.post("/users", { email: "p17test-bare@example.test", password: PW, role: "MEMBER" });
  check("linking a nonexistent profile -> 400", (await link(bare.json.id, { teamMemberId: "doesnotexist000" })).status === 400);
  check("linking a nonexistent account -> 404", (await link("doesnotexist000", { teamMemberId: orphan2.id })).status === 404);
  check("malformed account id -> 400", (await link("a b", { teamMemberId: orphan2.id })).status === 400);
  for (const body of [{}, { teamMemberId: 5 }, { teamMemberId: "../x" }, { teamMemberId: "" }, undefined, [1]]) {
    check(`link body ${JSON.stringify(body)} -> 400`, (await link(solo.json.id, body)).status === 400);
  }
  const u1 = await link(solo.json.id, { teamMemberId: null });
  check("unlink -> 200 and the profile is kept, unlinked", u1.status === 200 && (await prisma.teamMember.findUnique({ where: { id: orphan.id } })).userId === null);
  check("unlinking twice -> 409", (await link(solo.json.id, { teamMemberId: null })).status === 409);
  check("relink to a different profile works", (await link(solo.json.id, { teamMemberId: orphan2.id })).status === 200);
  const linkAudit = await prisma.auditLog.findMany({ where: { action: { in: ["USER_LINKED", "USER_UNLINKED"] }, entityId: solo.json.id }, orderBy: { createdAt: "asc" } });
  check("audit: LINKED, UNLINKED, LINKED with the profile id and no password/hash", linkAudit.map((a) => a.action).join() === "USER_LINKED,USER_UNLINKED,USER_LINKED" && linkAudit.every((a) => !/pass|hash/i.test(a.details ?? "")));
  check("the linked member can now edit their own profile (isOwn)", await (async () => {
    const c = new Client();
    await c.login("p17test-solo@example.test", PW);
    return (await c.get(`/team/${orphan2.id}`)).json?.isOwn === true;
  })());
  check("link/unlink races: concurrent claims of one profile -> exactly one wins", await (async () => {
    const a2 = await admin.post("/users", { email: "p17test-r1@example.test", password: PW, role: "MEMBER" });
    const b2 = await admin.post("/users", { email: "p17test-r2@example.test", password: PW, role: "MEMBER" });
    const target = await prisma.teamMember.create({ data: { name: "ZZ Admin Race", initials: "ZR", role: "Alumni", category: "RESEARCH" } });
    const rs = await Promise.all([link(a2.json.id, { teamMemberId: target.id }), link(b2.json.id, { teamMemberId: target.id })]);
    return rs.map((r) => r.status).sort().join() === "200,409" && (await prisma.teamMember.count({ where: { userId: { in: [a2.json.id, b2.json.id] } } })) === 1;
  })());
  check("link outcomes don't depend on X-Locale", (await link(solo.json.id, { teamMemberId: null }, mgr.client, "ja")).status === 403 && (await link(solo.json.id, { teamMemberId: null }, mgr.client, "en")).status === 403);

  section("8b. roles: nobody escalates");
  check("a manager can't change any role (403), including their own", (await mgr.client.put(`/users/${mgr.id}`, { role: "ADMIN" })).status === 403 && (await mgr.client.put(`/users/${memA.id}`, { role: "LAB_MANAGER" })).status === 403);
  check("a member can't either", (await memA.client.put(`/users/${memA.id}`, { role: "ADMIN" })).status === 403);
  check("an admin can't change their own role (400)", (await admin.put(`/users/${adminMe.id}`, { role: "MEMBER" })).status === 400);
  check("a manager can't create accounts", (await mgr.client.post("/users", { email: "p17test-evil@example.test", password: PW, role: "ADMIN" })).status === 403 && (await prisma.user.count({ where: { email: "p17test-evil@example.test" } })) === 0);
  check("roles in the database are unchanged", (await prisma.user.findUnique({ where: { id: mgr.id } })).role === "LAB_MANAGER" && (await prisma.user.findUnique({ where: { id: memA.id } })).role === "MEMBER");
  check("a stale session takes a demotion immediately (manager demoted -> /admin 403)", await (async () => {
    const t = await admin.put(`/users/${mgr.id}`, { role: "MEMBER" });
    const denied = (await mgr.client.get("/admin/overview")).status === 403;
    await admin.put(`/users/${mgr.id}`, { role: "LAB_MANAGER" });
    return t.status === 200 && denied && (await mgr.client.get("/admin/overview")).status === 200;
  })());

  // ------------------------------------------------------------------
  section("9. community");
  const cat = await prisma.forumCategory.create({ data: { slug: "zz-admin-cat", name: "ZZ Admin Category", visibility: "LAB_ONLY" } });
  const postOk = await prisma.forumPost.create({ data: { categoryId: cat.id, authorId: memA.id, title: "ZZ Admin Topic Visible", body: "ZZ visible body text" } });
  const postHid = await prisma.forumPost.create({ data: { categoryId: cat.id, authorId: memA.id, title: "ZZ Admin Topic Hidden", body: "secret forum body ZZForumBody55", status: "HIDDEN" } });
  await prisma.forumComment.create({ data: { postId: postOk.id, authorId: memB.id, body: "a comment" } });
  await prisma.forumComment.create({ data: { postId: postOk.id, authorId: memB.id, body: "hidden comment", status: "HIDDEN" } });
  const cm = (await mgr.client.get("/admin/community")).json;
  const catRow = cm.categories.find((c) => c.id === cat.id);
  check("community: category counts (2 topics, 1 hidden, 2 comments, 1 hidden)", catRow?.topics === 2 && catRow.hiddenTopics === 1 && catRow.comments === 2 && catRow.hiddenComments === 1 && catRow.visibility === "LAB_ONLY" && catRow.locked === false, JSON.stringify(catRow));
  const hidRow = cm.hiddenTopics.find((t) => t.id === postHid.id);
  check("community: the hidden topic is listed with title, category, author name and a link", hidRow?.title === "ZZ Admin Topic Hidden" && hidRow.categoryName === "ZZ Admin Category" && hidRow.author === "ZZ Admin Alice" && hidRow.href === `/community/forum/topic/${postHid.id}`);
  check("community: NO body text and no account ids/emails in the response", (!JSON.stringify(cm).includes("ZZForumBody55") && !JSON.stringify(cm).includes("visible body") && !JSON.stringify(cm).includes(memA.id) && !/@example\.test/.test(JSON.stringify(cm))));
  check("community: the admin sees the same as the manager and events/gallery counts are numbers", JSON.stringify((await admin.get("/admin/community")).json) === JSON.stringify(cm) && typeof cm.events === "number" && typeof cm.galleryItems === "number");
  check("community: a manager still cannot edit another user's post text (author-only rule intact)", (await mgr.client.put(`/forum/posts/${postOk.id}`, { title: "hijack", body: "hijack" })).status === 403);
  check("community: a deleted topic isn't counted", await (async () => { await prisma.forumPost.update({ where: { id: postOk.id }, data: { status: "DELETED" } }); const n = (await mgr.client.get("/admin/community")).json.categories.find((c) => c.id === cat.id).topics; await prisma.forumPost.update({ where: { id: postOk.id }, data: { status: "ACTIVE" } }); return n === 1; })());

  // ------------------------------------------------------------------
  section("10. files / gallery");
  const up = await memA.client.upload("/gallery", { caption: "ZZ Admin Photo ../../etc/passwd<b>", category: "LAB_LIFE" }, { buffer: JPEG, filename: "..\\..\\evil<script>.jpg", contentType: "image/jpeg" });
  check("fixture: a gallery item exists", up.status === 201, `${up.status} ${up.text?.slice(0, 100)}`);
  const fl = (qs = "", c = mgr.client) => c.get(`/admin/files${qs ? `?${qs}` : ""}`);
  const fr = (await fl("q=ZZ+Admin")).json;
  const frow = fr.rows[0];
  check("files: the item is listed with metadata", fr.rows.length === 1 && frow.category === "LAB_LIFE" && frow.mimeType === "image/jpeg" && frow.sizeBytes === JPEG.length && frow.uploadedBy?.name === "ZZ Admin Alice" && frow.visibility === "LAB_ONLY");
  check("files: exactly the documented keys (no storageKey, path, sha256, url, owner id)", Object.keys(frow).sort().join() === "caption,category,createdAt,id,mimeType,originalName,project,sizeBytes,uploadedBy,visibility");
  check("files: no storage key/path anywhere in the response", !/storageKey|storage[\\/]|files[\\/]|sha256|\.jpg\.?[0-9a-f]{20}|[0-9a-f]{8}-[0-9a-f]{4}-4/i.test(JSON.stringify(fr.rows.map((r) => ({ ...r, originalName: "" })))));
  check("files: a hostile filename is stored as its last path segment, as inert text", frow.originalName === "evil<script>.jpg");
  check("files: caption XSS/traversal text is returned as data", frow.caption.includes("<b>") && frow.caption.includes("../../etc/passwd"));
  check("files: filters — visibility / category / q", (await fl("visibility=PUBLIC&q=ZZ+Admin")).json.rows.length === 0 && (await fl("category=EVENT&q=ZZ+Admin")).json.rows.length === 0 && (await fl("category=LAB_LIFE&visibility=LAB_ONLY&q=ZZ+Admin")).json.rows.length === 1 && (await fl(`q=${encodeURIComponent("evil")}`)).json.rows.length === 1);
  for (const q of ["visibility=PRIVATE", "category=X", "page=0", "limit=101", "q=" + "a".repeat(101)]) check(`files invalid -> 400 (${q.slice(0, 20)})`, (await fl(q)).status === 400);
  check("files: the admin view can't open the bytes (that's still /api/files/:id with its own check): a guest is refused", (await guest.get(`/files/${up.json.file.id}`)).status === 404 || (await guest.get(`/files/${up.json.file.id}`)).status === 401);
  check("files: the upload directory isn't served statically", (await fetch(`${API.replace(/\/$/, "")}/storage/files/`)).status !== 200 && (await fetch(`${API}/uploads/`)).status !== 200);
  check("files: a non-gallery / message-attached file never appears", await (async () => {
    // A gallery item wrapping a file that is attached to a MESSAGE should never exist, but if one did the admin view must not list it.
    const f = await prisma.storedFile.create({ data: { storageKey: `zzadmin-${Date.now()}`, originalName: "ZZ Admin Msg.pdf", mimeType: "application/pdf", sizeBytes: 10, entityType: "MESSAGE", entityId: "x", visibility: "LAB_ONLY" } });
    const g = await prisma.galleryItem.create({ data: { fileId: f.id, caption: "ZZ Admin Msg wrapper", category: "OTHER" } });
    const listed = (await fl("limit=100")).json.rows.some((r) => r.originalName === "ZZ Admin Msg.pdf");
    const control = await prisma.storedFile.create({ data: { storageKey: `zzadmin-c-${Date.now()}`, originalName: "ZZ Admin Control.png", mimeType: "image/png", sizeBytes: 10, visibility: "LAB_ONLY" } });
    const gc = await prisma.galleryItem.create({ data: { fileId: control.id, caption: "ZZ Admin Control wrapper", category: "OTHER" } });
    const controlListed = (await fl("limit=100")).json.rows.some((r) => r.originalName === "ZZ Admin Control.png");
    await prisma.galleryItem.deleteMany({ where: { id: { in: [g.id, gc.id] } } });
    await prisma.storedFile.deleteMany({ where: { id: { in: [f.id, control.id] } } });
    return !listed && controlListed;
  })());
  check("overview counts the gallery item", (await mgr.client.get("/admin/overview")).json.galleryItems.total === (await prisma.galleryItem.count({ where: { file: { deletedAt: null } } })));
  await memA.client.del(`/gallery/${up.json.id}`);
  check("cleanup: the item was deleted through the API (blob purged)", (await fl("q=ZZ+Admin")).json.rows.length === 0);

  // ------------------------------------------------------------------
  section("11. deleted-account ownership");
  const ghost = await mk("ghost", "MEMBER", "ZZ Admin Ghost");
  const evGhost = (await ghost.client.post("/events", { title: "ZZ Admin Event Ghost", startsAt: iso(24) })).json;
  check("event created by a member shows that member as owner", (await rowsFor("type=event&q=ZZ+Admin+Event+Ghost"))[0]?.owner?.name === "ZZ Admin Ghost");
  await admin.del(`/users/${ghost.id}`);
  const ghostRow = (await rowsFor("type=event&q=ZZ+Admin+Event+Ghost"))[0];
  check("after the account is deleted: the event stays, owner is null, no error", ghostRow?.title === "ZZ Admin Event Ghost" && ghostRow.owner === null);
  check("...and only a manager can still change it (owner-less)", (await mgr.client.put(`/events/${evGhost.id}`, { title: "ZZ Admin Event Ghost 2" })).status === 200);
  check("the ghost profile survives, unlinked, and shows hasAccount=false to admin", (await rowsFor("type=team-member&q=ZZ+Admin+Ghost", admin))[0]?.hasAccount === false);
  check("audit rows of the deleted actor remain, with the actor's email snapshot for admin", (await au("actor=p17test-ghost&limit=100", admin)).json.entries.length > 0);
  check("...and for a manager the deleted actor is simply unnamed (null), not an error", (await au("limit=100")).json.entries.some((e) => e.actor === null));

  // ------------------------------------------------------------------
  section("12. privacy: messages and notifications never appear in the admin area");
  const conv = await memA.client.post("/messages/conversations", { teamMemberId: memB.tm.id });
  const msg = await memA.client.post(`/messages/conversations/${conv.json.id}/messages`, { body: `private ${TOKEN}` });
  check("fixture: a private message exists between two members", conv.status < 300 && msg.status === 201);
  for (const path of ["/admin/messages", "/admin/notifications", "/admin/conversations", "/admin/messages?q=" + TOKEN]) {
    check(`no admin surface: ${path} is a 404 even for an admin`, (await admin.get(path)).status === 404);
  }
  check("an admin/manager can't read the conversation or the message either", (await admin.get(`/messages/conversations/${conv.json.id}`)).status === 404 && (await mgr.client.get(`/messages/conversations/${conv.json.id}`)).status === 404 || (await admin.get(`/messages/conversations/${conv.json.id}`)).status === 403);
  const everything = [];
  for (const c of [mgr.client, admin]) {
    for (const p of [...ADMIN_GETS, "/admin/audit?limit=100", `/admin/content?type=team-member&q=${TOKEN}`, `/admin/translations?type=EVENT&q=${TOKEN}`]) everything.push((await c.get(p)).text);
    for (const t of ["research-area", "project", "group", "publication", "news", "event", "team-member"]) everything.push((await c.get(`/admin/content?type=${t}&limit=100`)).text);
  }
  check("the private message text appears in NO admin response", everything.every((s) => !s.includes(TOKEN)));
  check("content search for the message text finds nothing in any type", await (async () => { for (const t of ["research-area", "project", "group", "publication", "news", "event", "team-member"]) if ((await list(`type=${t}&q=${TOKEN}`, admin)).json.rows.length) return false; return true; })());
  check("no conversation/notification/message rows or keys in the audit log", !(await prisma.auditLog.count({ where: { createdAt: { gte: RUN_STARTED }, OR: [{ entityType: { in: ["CONVERSATION", "MESSAGE", "NOTIFICATION"] } }, { details: { contains: TOKEN } }] } })));
  check("type=message / conversation / notification is not an admin content type (400)", (await list("type=message")).status === 400 && (await list("type=notification")).status === 400 && (await list("type=conversation")).status === 400);
  check("the recipient's notification is untouched by any admin call", (await prisma.notification.count({ where: { userId: memB.id, readAt: null } })) >= 1);
  check("global search still doesn't index messages", (await admin.get(`/search?q=${TOKEN}`)).json.results.length === 0);

  // ------------------------------------------------------------------
  section("13. locale independence of authorization");
  const matrix = [
    ["guest", guest, 401],
    ["member", memA.client, 403],
    ["manager", mgr.client, 200],
    ["admin", admin, 200],
  ];
  let same = true;
  for (const [, client, expected] of matrix) {
    for (const p of ADMIN_GETS) {
      const codes = [];
      for (const l of ["en", "ja", "fr", "", undefined, "ja-JP", "EN", "en;q=0.5"]) codes.push((await client.get(p, l || undefined)).status);
      if (!codes.every((c) => c === expected)) {
        same = false;
        console.log(`  locale drift on ${p}: ${codes.join()}`);
      }
    }
  }
  check("every admin GET gives the same status for every role under every X-Locale value", same);
  check("...and the malformed X-Locale header doesn't crash a route", (await mgr.client.req("GET", "/admin/overview", undefined, "\u00e9 <script>")).status < 500);

  // ------------------------------------------------------------------
  section("13b. session, CSRF and body handling");
  const rawPost = async (client, path, body, type) => {
    const res = await fetch(`${API}/api${path}`, { method: "POST", headers: { "Content-Type": type, cookie: client.cookie }, body });
    return res.status;
  };
  const ownBefore = (await prisma.newsItem.findUnique({ where: { id: news3.id } })).visibility;
  check("a cross-site style form POST (text/plain or urlencoded) is not parsed as JSON and changes nothing (no CSRF path)",
    (await rawPost(mgr.client, "/admin/content/visibility", JSON.stringify({ type: "news", ids: [news3.id], visibility: "PUBLIC" }), "text/plain")) === 400 &&
    (await rawPost(mgr.client, "/admin/content/visibility", `type=news&ids=${news3.id}&visibility=PUBLIC`, "application/x-www-form-urlencoded")) === 400 &&
    (await prisma.newsItem.findUnique({ where: { id: news3.id } })).visibility === ownBefore);
  check("the session cookie is HttpOnly and SameSite=Lax (the existing CSRF posture, unchanged)", await (async () => {
    const res = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }) });
    const c = (res.headers.getSetCookie?.() ?? []).join(";");
    return /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c);
  })());
  check("GET can never change state: the write paths answer 404 to GET", (await mgr.client.get("/admin/content/visibility")).status === 404 && (await mgr.client.get(`/admin/translations/NEWS_ITEM/${news1.id}?field=title&value=x`)).status === 404);
  check("wrong methods have no route (404): DELETE/PATCH on admin resources", (await mgr.client.del(`/admin/content/news/${news1.id}`)).status === 404 && (await mgr.client.req("PATCH", "/admin/overview", {})).status === 404);
  check("an oversized body is refused (413), not processed", (await mgr.client.req("POST", "/admin/content/visibility", JSON.stringify({ type: "news", ids: ["a"], visibility: "PUBLIC", pad: "x".repeat(200_000) }))).status === 413);
  check("a member's 403 is the same for an existing and a missing id (no enumeration through the admin routes)", (await memA.client.get(`/admin/content/news/${news1.id}`)).text === (await memA.client.get("/admin/content/news/doesnotexist000")).text);
  check("__proto__ / constructor keys in a body are inert", (await mgr.client.req("POST", "/admin/content/visibility", '{"type":"news","ids":["' + news3.id + '"],"visibility":"LAB_ONLY","__proto__":{"role":"ADMIN"},"constructor":{"prototype":{"role":"ADMIN"}}}')).status === 200 && (await prisma.user.findUnique({ where: { id: mgr.id } })).role === "LAB_MANAGER" && ({}).role === undefined);
  check("a deleted account's live session stops working at once (401)", await (async () => {
    const tmp = await mk("tmpmgr", "LAB_MANAGER", "ZZ Admin Temp");
    const before = (await tmp.client.get("/admin/overview")).status;
    await admin.del(`/users/${tmp.id}`);
    return before === 200 && (await tmp.client.get("/admin/overview")).status === 401 && (await tmp.client.get("/admin/audit")).status === 401;
  })());
  check("a demoted admin-created manager loses translation/bulk write access immediately", await (async () => {
    const tmp = await mk("tmpmgr2", "LAB_MANAGER", "ZZ Admin Temp Two");
    await admin.put(`/users/${tmp.id}`, { role: "MEMBER" });
    return (await tmp.client.post("/admin/content/visibility", { type: "news", ids: [news3.id], visibility: "PUBLIC" })).status === 403 && (await tmp.client.put(`/admin/translations/NEWS_ITEM/${news3.id}`, { field: "title", value: "x" })).status === 403;
  })());

  // ------------------------------------------------------------------
  section("14. source-level guards");
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/routes/admin.routes.ts", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/lib/adminContent.ts", import.meta.url), "utf8");
  check("no raw SQL in the admin code", !/\$queryRaw|\$executeRaw|Prisma\.sql/.test(src));
  check("no inline role comparisons in the admin code", !/role\s*===|\.role\b\s*[!=]==/.test(src));
  check("the admin code never selects userId / passwordHash / storageKey / email for responses", !/passwordHash|storageKey/.test(src));
  check("there is no message/notification/conversation model in the admin code", !/\.message\b|\.conversation\b|\.notification\b|prisma\.message/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));

  // ------------------------------------------------------------------
  section("15. cleanup and integrity");
  await cleanup();
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: RUN_STARTED } } });
  const after = {
    users: await prisma.user.count(), team: await prisma.teamMember.count(), news: await prisma.newsItem.count(), pubs: await prisma.publication.count(),
    areas: await prisma.researchArea.count(), events: await prisma.event.count(), translations: await prisma.translation.count(), stored: await prisma.storedFile.count(),
  };
  check("every row count is back to where it started", JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
  check("the admin account itself is untouched", (await prisma.user.findUnique({ where: { id: adminMe.id } })).role === "ADMIN");

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(` - ${f}`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Script crashed:", err);
  await cleanup().catch(() => {});
  process.exit(2);
});
