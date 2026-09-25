/**
 * API regression for Phase 20 (research discovery & knowledge navigation): the `related` context on
 * GET /api/search results, and the cross-entity filters the discovery links point at.
 *
 *   DATABASE_URL=file:C:/abs/copy.db PORT=4011 tsx src/index.ts          # a COPY of the database
 *   DATABASE_URL=file:C:/abs/copy.db API=http://localhost:4011 node scripts/discovery-regression.mjs
 *
 * Fixtures are prefixed "ZZ Disc" / p20test-*@example.test and removed again (also at the start).
 * The ordinary list/detail endpoints are the oracle for visibility: a hidden area/group/project may
 * never be NAMED on a visible result, counted, or inferred from what is missing.
 */
import { PrismaClient } from "@prisma/client";

const API = process.env.API || "http://localhost:4001";
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };
const PW = "Str0ngPassw0rd!";
const prisma = new PrismaClient();

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
  async req(method, path, body, extraHeaders) {
    const res = await fetch(`${API}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...(extraHeaders ?? {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
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
    return { status: res.status, json, text };
  }
  get = (p, h) => this.req("GET", p, undefined, h);
  post = (p, b) => this.req("POST", p, b ?? {});
  put = (p, b) => this.req("PUT", p, b ?? {});
  login = (email, password) => this.post("/auth/login", { email, password });
}

const search = (c, params, locale) => c.get(`/search?${new URLSearchParams(params).toString()}`, locale ? { "X-Locale": locale } : undefined);
const byId = (r, id) => (r.json?.results ?? []).find((x) => x.id === id);
const relTitles = (res) => (res?.related ?? []).map((x) => x.title);

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: "p20test-" } } }).catch(() => {});
  const [areas, projects, groups, news, events] = await Promise.all([
    prisma.researchArea.findMany({ where: { title: { startsWith: "ZZ Disc" } }, select: { id: true } }),
    prisma.researchProject.findMany({ where: { title: { startsWith: "ZZ Disc" } }, select: { id: true } }),
    prisma.researchGroup.findMany({ where: { name: { startsWith: "ZZ Disc" } }, select: { id: true } }),
    prisma.newsItem.findMany({ where: { title: { startsWith: "ZZ Disc" } }, select: { id: true } }),
    prisma.event.findMany({ where: { title: { startsWith: "ZZ Disc" } }, select: { id: true } }),
  ]);
  await prisma.translation.deleteMany({
    where: {
      OR: [
        { entityType: "RESEARCH_AREA", entityId: { in: areas.map((r) => r.id) } },
        { entityType: "RESEARCH_PROJECT", entityId: { in: projects.map((r) => r.id) } },
        { entityType: "RESEARCH_GROUP", entityId: { in: groups.map((r) => r.id) } },
        { entityType: "NEWS_ITEM", entityId: { in: news.map((r) => r.id) } },
        { entityType: "EVENT", entityId: { in: events.map((r) => r.id) } },
      ],
    },
  });
  await prisma.event.deleteMany({ where: { title: { startsWith: "ZZ Disc" } } });
  await prisma.newsItem.deleteMany({ where: { title: { startsWith: "ZZ Disc" } } });
  await prisma.researchProject.deleteMany({ where: { title: { startsWith: "ZZ Disc" } } });
  await prisma.researchGroup.deleteMany({ where: { name: { startsWith: "ZZ Disc" } } });
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: "ZZ Disc" } } });
  await prisma.publication.deleteMany({ where: { title: { startsWith: "ZZ Disc" } } });
  await prisma.researchArea.deleteMany({ where: { title: { startsWith: "ZZ Disc" } } });
}

const WORD = "zzdiscword";

async function main() {
  await cleanup();
  const guest = new Client();
  const admin = new Client();
  check("admin login", (await admin.login(ADMIN.email, ADMIN.password)).status === 200);

  section("fixtures");
  const email = "p20test-member@example.test";
  await admin.post("/users", { email, password: PW, role: "MEMBER", name: "ZZ Disc Member", initials: "ZM", memberRole: "Analyst", category: "MSC" });
  const member = new Client();
  await member.login(email, PW);

  const mk = async (path, body) => (await admin.post(path, body)).json;
  const aPub = await mk("/research", { title: `ZZ Disc Area Public ${WORD}`, description: "d", tag: "ZD", visibility: "PUBLIC" });
  const aHid = await mk("/research", { title: `ZZ Disc Area Hidden ${WORD}`, description: "hidden-area-secret", tag: "ZD", visibility: "LAB_ONLY" });
  const gPub = await mk("/groups", { name: `ZZ Disc Group Public ${WORD}`, description: "d", visibility: "PUBLIC" });
  const gHid = await mk("/groups", { name: `ZZ Disc Group Hidden ${WORD}`, description: "hidden-group-secret", visibility: "LAB_ONLY" });
  const pjPub = await mk("/projects", { title: `ZZ Disc Project Public ${WORD}`, summary: "s", visibility: "PUBLIC", groupId: gPub.id });
  const pjHid = await mk("/projects", { title: `ZZ Disc Project Hidden ${WORD}`, summary: "hidden-project-secret", visibility: "LAB_ONLY", groupId: gPub.id });
  const pjGH = await mk("/projects", { title: `ZZ Disc Project HiddenGroup ${WORD}`, summary: "s", visibility: "PUBLIC", groupId: gHid.id });
  const pj3 = await mk("/projects", { title: `ZZ Disc Project Three ${WORD}`, summary: "s", visibility: "PUBLIC" });
  const pj4 = await mk("/projects", { title: `ZZ Disc Project Four ${WORD}`, summary: "s", visibility: "PUBLIC" });
  check("fixtures created", [aPub, aHid, gPub, gHid, pjPub, pjHid, pjGH, pj3, pj4].every((x) => x?.id), JSON.stringify([aPub, pjPub].map((x) => x?.error)));
  check("project links: areas", (await admin.put(`/projects/${pjPub.id}/areas`, { areaIds: [aPub.id, aHid.id] })).status === 200 && (await admin.put(`/projects/${pjHid.id}/areas`, { areaIds: [aPub.id] })).status === 200 && (await admin.put(`/projects/${pjGH.id}/areas`, { areaIds: [aPub.id] })).status === 200 && (await admin.put(`/projects/${pj3.id}/areas`, { areaIds: [aPub.id] })).status === 200 && (await admin.put(`/projects/${pj4.id}/areas`, { areaIds: [aPub.id] })).status === 200);
  const pubPub = await mk("/publications", { title: `ZZ Disc Paper Linked ${WORD}`, year: 2031, authors: "A", venue: "V", visibility: "PUBLIC" });
  const pubOnlyHid = await mk("/publications", { title: `ZZ Disc Paper OnlyHidden ${WORD}`, year: 2031, authors: "A", venue: "V", visibility: "PUBLIC" });
  check("project links: publications", (await admin.put(`/projects/${pjPub.id}/publications`, { publicationIds: [pubPub.id] })).status === 200 && (await admin.put(`/projects/${pjHid.id}/publications`, { publicationIds: [pubPub.id, pubOnlyHid.id] })).status === 200);
  const newsHid = await mk("/news", { title: `ZZ Disc News OfHidden ${WORD}`, description: "d", type: "Update", date: "Jan 2031", sortDate: "2031-01-01", visibility: "PUBLIC" });
  const newsVis = await mk("/news", { title: `ZZ Disc News OfVisible ${WORD}`, description: "d", type: "Update", date: "Jan 2031", sortDate: "2031-01-02", visibility: "PUBLIC" });
  check("project links: news", (await admin.put(`/projects/${pjHid.id}/news`, { newsIds: [newsHid.id] })).status === 200 && (await admin.put(`/projects/${pjPub.id}/news`, { newsIds: [newsVis.id] })).status === 200);
  const evHid = await mk("/events", { title: `ZZ Disc Event OfHidden ${WORD}`, startsAt: "2031-02-01T10:00:00.000Z", visibility: "PUBLIC", projectId: pjHid.id });
  const evVis = await mk("/events", { title: `ZZ Disc Event OfVisible ${WORD}`, startsAt: "2031-02-02T10:00:00.000Z", visibility: "PUBLIC", projectId: pjPub.id });
  check("events created", evHid?.id && evVis?.id, JSON.stringify(evHid));
  const tm = await mk("/team", { name: `ZZ Disc Researcher ${WORD}`, role: "Fellow", category: "RESEARCH", initials: "ZD", department: "", bio: "" });
  check("researcher linked to a public and a hidden area", tm?.id && (await admin.put(`/member/${tm.id}/areas`, { areaIds: [aPub.id, aHid.id] })).status === 200);

  const q = (type) => ({ q: WORD, type, limit: "50" });
  const gp = async (type, c = guest, loc) => search(c, q(type), loc);

  section("guest: related context names only visible records");
  const gProj = await gp("project");
  const proj = byId(gProj, pjPub.id);
  check("a public project lists its visible group first, then its visible area", eqArr(relTitles(proj), [`ZZ Disc Group Public ${WORD}`, `ZZ Disc Area Public ${WORD}`]), JSON.stringify(proj?.related));
  check("...and NOT the hidden area it is also linked to", !relTitles(proj).some((t) => t.includes("Hidden")));
  const projHG = byId(gProj, pjGH.id);
  check("a project in a hidden group: the group is absent, its visible area remains", eqArr(relTitles(projHG), [`ZZ Disc Area Public ${WORD}`]), JSON.stringify(projHG?.related));
  check("a hidden project is not found at all", !byId(gProj, pjHid.id));
  const gPubR = await gp("publication");
  check("a publication of a visible + hidden project lists only the visible project", eqArr(relTitles(byId(gPubR, pubPub.id)), [`ZZ Disc Project Public ${WORD}`]), JSON.stringify(byId(gPubR, pubPub.id)?.related));
  check("a public publication whose ONLY project is hidden has no `related` key", byId(gPubR, pubOnlyHid.id) && !("related" in byId(gPubR, pubOnlyHid.id)));
  const gNews = await gp("news");
  check("news of a hidden project: no `related`; news of a visible project: that project", !("related" in (byId(gNews, newsHid.id) ?? { related: 1 })) && eqArr(relTitles(byId(gNews, newsVis.id)), [`ZZ Disc Project Public ${WORD}`]));
  const gEv = await gp("event");
  check("event of a hidden project: no `related`; event of a visible project: that project", !("related" in (byId(gEv, evHid.id) ?? { related: 1 })) && eqArr(relTitles(byId(gEv, evVis.id)), [`ZZ Disc Project Public ${WORD}`]));
  const gArea = await gp("research-area");
  check("an area with four visible projects lists exactly THREE (the cap), in title order, and never the hidden project", eqArr(relTitles(byId(gArea, aPub.id)), [`ZZ Disc Project Four ${WORD}`, `ZZ Disc Project HiddenGroup ${WORD}`, `ZZ Disc Project Public ${WORD}`]), JSON.stringify(byId(gArea, aPub.id)?.related));
  const gGroup = await gp("group");
  check("a group lists only its visible projects", eqArr(relTitles(byId(gGroup, gPub.id)), [`ZZ Disc Project Public ${WORD}`]) && !byId(gGroup, gHid.id));
  const gRes = await gp("researcher");
  check("a researcher lists only visible areas", eqArr(relTitles(byId(gRes, tm.id)), [`ZZ Disc Area Public ${WORD}`]), JSON.stringify(byId(gRes, tm.id)?.related));

  section("hrefs are real, app-relative routes");
  const hrefs = [...(gProj.json.results ?? []), ...(gPubR.json.results ?? []), ...(gArea.json.results ?? [])].flatMap((r) => (r.related ?? []).map((x) => ({ x, r })));
  check("every related href is /research|/projects|/groups + the record's own id", hrefs.length > 0 && hrefs.every(({ x }) => x.href === `/${{ "research-area": "research", project: "projects", group: "groups" }[x.type]}/${x.id}`));
  const ok = await Promise.all(hrefs.slice(0, 6).map(({ x }) => guest.get(`/${{ "research-area": "research", project: "projects", group: "groups" }[x.type]}/${x.id}`)));
  check("each related link resolves (200) for the SAME viewer", ok.every((r) => r.status === 200));

  section("raw guest JSON leaks nothing hidden");
  const blob = [];
  for (const type of ["all", "project", "publication", "news", "event", "research-area", "group", "researcher"]) blob.push((await gp(type)).text, (await search(guest, { q: "hidden", type, limit: "50" })).text);
  const raw = blob.join("\n");
  const hiddenNeedles = [aHid.id, gHid.id, pjHid.id, `Area Hidden`, `Group Hidden`, `Project Hidden `, "hidden-area-secret", "hidden-group-secret", "hidden-project-secret"];
  check("no hidden id, name or text anywhere in the guest responses", hiddenNeedles.every((n) => !raw.includes(n)), hiddenNeedles.filter((n) => raw.includes(n)).join("|"));
  check("no account id / credential keys / slug / visibility in guest responses", !/"(userId|email|passwordHash|slug|visibility|isOwn)"/.test(raw));
  check("counts never include hidden records (guest project count = 4, publication = 2 incl. the only-hidden-project one)", gProj.json.counts.project === 4 && gProj.json.counts.publication === 2, JSON.stringify(gProj.json.counts));

  section("member (logged in) sees LAB_ONLY neighbours; counts and order are deterministic");
  const mProj = byId(await gp("project", member), pjPub.id);
  check("member: project lists the group first, then BOTH areas by title (the guest-hidden area is LAB_ONLY, visible to members)", eqArr(relTitles(mProj), [`ZZ Disc Group Public ${WORD}`, `ZZ Disc Area Hidden ${WORD}`, `ZZ Disc Area Public ${WORD}`]), JSON.stringify(mProj?.related));
  const mPub = byId(await gp("publication", member), pubPub.id);
  check("member: publication lists both projects, ordered by sortOrder then title (Hidden < Public)", eqArr(relTitles(mPub), [`ZZ Disc Project Hidden ${WORD}`, `ZZ Disc Project Public ${WORD}`]), JSON.stringify(mPub?.related));
  const again = byId(await gp("publication", member), pubPub.id);
  check("repeatable: identical `related` on a second call", JSON.stringify(again?.related) === JSON.stringify(mPub?.related));
  check("no result carries more than 3 related records", [...(await gp("all", member)).json.results].every((r) => (r.related ?? []).length <= 3));
  check("member still sees no `visibility` key", !/"visibility"/.test((await gp("all", member)).text));
  const adminAll = await gp("all", admin);
  check("admin sees the `visibility` key on results (existing behaviour) and related still bounded", /"visibility"/.test(adminAll.text) && adminAll.json.results.every((r) => (r.related ?? []).length <= 3));

  section("locale: text only, never which records");
  const enIds = (await gp("all")).json.results.map((r) => r.id).join();
  const jaIds = (await gp("all", guest, "ja")).json.results.map((r) => r.id).join();
  const bad = (await gp("all", guest, "xx'; DROP TABLE")).json.results.map((r) => r.id).join();
  check("guest: identical result ids in en / ja / a tampered X-Locale", enIds === jaIds && enIds === bad && enIds.length > 0);
  check("PUT project ja title", (await admin.put(`/projects/${pjPub.id}`, { translations: { ja: { title: "ZZ Disc プロジェクト<script>alert(1)</script>" } } })).status === 200);
  const jaPub = byId(await gp("publication", guest, "ja"), pubPub.id);
  check("ja: the related project title is the Japanese override, returned as inert JSON text", jaPub?.related?.[0]?.title === "ZZ Disc プロジェクト<script>alert(1)</script>", JSON.stringify(jaPub?.related));
  const enPub = byId(await gp("publication", guest, "en"), pubPub.id);
  check("en: the English title is untouched by the override", enPub?.related?.[0]?.title === `ZZ Disc Project Public ${WORD}`);
  check("ja related hrefs identical to en", JSON.stringify(jaPub.related.map((x) => x.href)) === JSON.stringify(enPub.related.map((x) => x.href)));

  section("visibility flips propagate at once");
  await admin.put(`/research/${aHid.id}`, { visibility: "PUBLIC" });
  check("making the hidden area PUBLIC makes it appear for a guest", relTitles(byId(await gp("project"), pjPub.id)).includes(`ZZ Disc Area Hidden ${WORD}`));
  await admin.put(`/research/${aHid.id}`, { visibility: "LAB_ONLY" });
  check("...and hiding it again removes it", !relTitles(byId(await gp("project"), pjPub.id)).includes(`ZZ Disc Area Hidden ${WORD}`));
  await admin.put(`/groups/${gPub.id}`, { visibility: "LAB_ONLY" });
  check("hiding the group removes it from the project's related list for guests", !relTitles(byId(await gp("project"), pjPub.id)).some((t) => t.includes("Group Public")));
  await admin.put(`/groups/${gPub.id}`, { visibility: "PUBLIC" });

  section("deleted relationships");
  check("unlinking the project from the publication drops the related entry", (await admin.put(`/projects/${pjPub.id}/publications`, { publicationIds: [] })).status === 200 && !("related" in (byId(await gp("publication"), pubPub.id) ?? { related: 1 })));

  section("filters the discovery links use (existing endpoints/pages)");
  const pubBrowse = (c, params) => c.get(`/publications/browse?${new URLSearchParams(params)}`);
  check("guest: /publications/browse?area=<hidden area> matches nothing (same as an unknown id)", (await pubBrowse(guest, { area: aHid.id })).json.total === (await pubBrowse(guest, { area: "nope-nope" })).json.total && (await pubBrowse(guest, { area: aHid.id })).json.total === 0);
  check("guest: ?project=<hidden project> matches nothing", (await pubBrowse(guest, { project: pjHid.id })).json.total === 0);
  check("guest: a hostile filter id is a clean 400, never a 500", (await pubBrowse(guest, { area: "<script>alert(1)</script>" })).status === 400);
  check("guest: an invalid sort is a 400", (await pubBrowse(guest, { sort: "bogus" })).status === 400);
  const st = await search(guest, { q: WORD, type: "bogus" });
  check("search: an invalid type filter is a 400 with a plain message", st.status === 400 && typeof st.json?.error === "string");
  check("search: invalid page / limit are 400s", (await search(guest, { q: WORD, page: "0" })).status === 400 && (await search(guest, { q: WORD, limit: "999" })).status === 400 && (await search(guest, { q: WORD, page: "abc" })).status === 400);
  check("search: XSS in the query is echoed as inert text and matches nothing", (await search(guest, { q: "<img src=x onerror=alert(1)>" })).json.pagination.total === 0);
  const projList = (await guest.get("/projects")).json;
  check("/projects (the source of the ?area= ?group= ?researcher= filters) never lists a hidden project or hidden group for a guest", !JSON.stringify(projList).includes(pjHid.id) && !JSON.stringify(projList).includes(gHid.id));

  section("private data is not in discovery");
  check("search never returns message/notification content: type filter rejects them", (await search(guest, { q: WORD, type: "message" })).status === 400 && (await search(guest, { q: WORD, type: "notification" })).status === 400);

  await cleanup();
  await prisma.$disconnect();
  console.log(`\n${passed} discovery checks passed, ${failures.length} failed.`);
  for (const f of failures) console.log("  FAIL", f);
  process.exit(failures.length ? 1 : 0);
}
const eqArr = (a, b) => JSON.stringify(a) === JSON.stringify(b);
main().catch(async (e) => {
  console.error("Script crashed:", e);
  await cleanup().catch(() => {});
  process.exit(2);
});
