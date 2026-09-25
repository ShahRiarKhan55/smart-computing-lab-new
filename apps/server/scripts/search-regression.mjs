/**
 * End-to-end API regression for GLOBAL SEARCH (Phase 10): GET /api/search.
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:/abs/path/to/copy.db PORT=4011 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:/abs/path/to/copy.db API=http://localhost:4011 node scripts/search-regression.mjs
 *
 * Fixtures are prefixed "ZZ Search" / p10test-*@example.test and are removed again (also at the
 * start, in case an earlier run was interrupted). It never touches rows it did not create.
 *
 * The suite treats the ordinary list/detail endpoints as the ORACLE for visibility: for every
 * viewer, the set of ids search returns must equal what the normal endpoints return, and every
 * hidden id/name/slug/text must be absent from the RAW JSON.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
    return { status: res.status, json, text, headers: res.headers };
  }
  get = (p, h) => this.req("GET", p, undefined, h);
  post = (p, b) => this.req("POST", p, b ?? {});
  put = (p, b) => this.req("PUT", p, b ?? {});
  del = (p) => this.req("DELETE", p);
  login = (email, password) => this.post("/auth/login", { email, password });
}

const search = (c, params, locale) => c.get(`/search?${new URLSearchParams(params).toString()}`, locale ? { "X-Locale": locale } : undefined);
const ids = (r) => (r.json?.results ?? []).map((x) => x.id);
const titles = (r) => (r.json?.results ?? []).map((x) => x.title);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && [...a].sort().join() === [...b].sort().join();
/** Every result of a query, page by page (limit 50 so it stays cheap). */
async function everything(c, params) {
  const out = [];
  for (let page = 1; page < 40; page++) {
    const r = await search(c, { ...params, page: String(page), limit: "50" });
    if (r.status !== 200) return { ...r, results: out };
    out.push(...r.json.results);
    if (page >= r.json.pagination.totalPages) return { status: 200, results: out, json: r.json };
  }
  return { status: 0, results: out };
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: "p10test-" } } }).catch(() => {});
  // Direct Prisma deletes below bypass the entity routes' own Translation cleanup (Phase 14 §12),
  // so any Japanese override this suite wrote (§10's search-matching fixtures) is removed first,
  // by entityId, the same way i18n-regression.mjs proves the routes themselves do it.
  const [zzAreas, zzProjects, zzGroups, zzNews] = await Promise.all([
    prisma.researchArea.findMany({ where: { title: { startsWith: "ZZ Search" } }, select: { id: true } }),
    prisma.researchProject.findMany({ where: { title: { contains: "ZZ Search" } }, select: { id: true } }),
    prisma.researchGroup.findMany({ where: { name: { contains: "ZZ Search" } }, select: { id: true } }),
    prisma.newsItem.findMany({ where: { title: { startsWith: "ZZ Search" } }, select: { id: true } }),
  ]);
  await prisma.translation.deleteMany({
    where: {
      OR: [
        { entityType: "RESEARCH_AREA", entityId: { in: zzAreas.map((r) => r.id) } },
        { entityType: "RESEARCH_PROJECT", entityId: { in: zzProjects.map((r) => r.id) } },
        { entityType: "RESEARCH_GROUP", entityId: { in: zzGroups.map((r) => r.id) } },
        { entityType: "NEWS_ITEM", entityId: { in: zzNews.map((r) => r.id) } },
      ],
    },
  });
  await prisma.researchProject.deleteMany({ where: { title: { contains: "ZZ Search" } } });
  await prisma.researchGroup.deleteMany({ where: { name: { contains: "ZZ Search" } } });
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: "ZZ Search" } } });
  await prisma.publication.deleteMany({ where: { title: { startsWith: "ZZ Search" } } });
  await prisma.newsItem.deleteMany({ where: { title: { startsWith: "ZZ Search" } } });
  await prisma.researchArea.deleteMany({ where: { title: { startsWith: "ZZ Search" } } });
}

async function main() {
  await cleanup();
  const guest = new Client();
  const admin = new Client();
  check("admin login", (await admin.login(ADMIN.email, ADMIN.password)).status === 200);
  const dbBefore = { users: await prisma.user.count(), team: await prisma.teamMember.count(), pubs: await prisma.publication.count(), news: await prisma.newsItem.count(), areas: await prisma.researchArea.count(), projects: await prisma.researchProject.count(), groups: await prisma.researchGroup.count() };

  // ------------------------------------------------------------------ fixtures
  section("fixtures");
  const mkUser = async (key, role, name, memberRole = "Researcher") => {
    const email = `p10test-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: key.slice(0, 2).toUpperCase(), memberRole, category: "MSC" });
    const client = new Client();
    await client.login(email, PW);
    const tm = (await admin.get("/team")).json.find((m) => m.name === name);
    return { id: r.json?.id, email, client, tmId: tm?.id, name };
  };
  const memA = await mkUser("member", "MEMBER", "ZZ Search Member Quokka", "Quokka Analyst");
  const leadU = await mkUser("lead", "MEMBER", "ZZ Search Lead");
  const mgr = await mkUser("manager", "LAB_MANAGER", "ZZ Search Manager");
  const odd = await mkUser("odd", "MEMBER", "ZZ Search Odd");
  const mkTeam = async (b) => (await mgr.client.post("/team", { category: "RESEARCH", initials: "ZS", department: "", bio: "", ...b })).json;
  const mkArea = async (title, description, tag, visibility) => (await admin.post("/research", { title, description, tag, visibility })).json;
  const mkGroup = async (name, description, visibility) => (await admin.post("/groups", { name, description, visibility })).json;
  const mkProject = async (title, summary, visibility, groupId, extra = {}) => (await admin.post("/projects", { title, summary, visibility, ...(groupId ? { groupId } : {}), ...extra })).json;
  const mkPub = async (title, year, authors, venue, visibility, extra = {}) => (await admin.post("/publications", { title, year, authors, venue, visibility, ...extra })).json;
  const mkNews = async (title, description, type, sortDate, visibility) => (await admin.post("/news", { title, description, type, date: "Jan 2031", sortDate, visibility })).json;

  const aPub = await mkArea("ZZ Search Quokka Area Public", "Marsupial habitat mapping", "ZQ", "PUBLIC");
  const aHid = await mkArea("ZZ Search Quokka Area Hidden", "hidden-area-secret", "ZQ", "LAB_ONLY");
  const gPub = await mkGroup("ZZ Search Quokka Group Public", "Open group", "PUBLIC");
  const gHid = await mkGroup("ZZ Search Quokka Group Hidden", "hidden-group-secret", "LAB_ONLY");
  const gNeutral = await mkGroup("ZZ Search Neutral Group", "A neutral public group", "PUBLIC");
  const pOpen = await mkProject("ZZ Search Quokka Project Open", "Open summary", "PUBLIC", gPub.id, { status: "ACTIVE", startDate: "2030-01-01" });
  const pSecret = await mkProject("ZZ Search Quokka Project Hidden", "hidden-project-secret", "LAB_ONLY", gPub.id);
  const pInHid = await mkProject("ZZ Search Quokka Project In Hidden Group", "Public project, hidden group", "PUBLIC", gHid.id);
  const pMarmot = await mkProject("ZZ Search Marmot Project Secret", "Marmot burrows", "LAB_ONLY", gNeutral.id);
  const pubPub = await mkPub("ZZ Search Quokka Paper Public", 2031, "A. Author", "Journal of Quokka Studies", "PUBLIC", { doiUrl: "https://doi.org/10.9999/quokkadoi" });
  const pubHid = await mkPub("ZZ Search Quokka Paper Hidden", 2031, "Hidden Authorname", "Journal of Hidden Venue", "LAB_ONLY", { doiUrl: "https://doi.org/10.9999/hiddendoi" });
  const newsPub = await mkNews("ZZ Search Quokka News Public", "Quokka news body", "Zzsearchtype", "2031-02-01", "PUBLIC");
  const newsHid = await mkNews("ZZ Search Quokka News Hidden", "hidden-news-secret", "Zzsearchtype", "2031-02-02", "LAB_ONLY");
  const rAuth = await mkTeam({ name: "ZZ Search Ricercatore Zanzibar", role: "Visiting Scholar", bio: "Studies zanzibar-lidar mapping" });
  const pubLinked = await mkPub("ZZ Search Linked Paper Public", 2032, "External Et Al", "Conf", "PUBLIC");
  const pubLinkedHid = await mkPub("ZZ Search Linked Paper Hidden", 2032, "External Et Al", "Conf", "LAB_ONLY");
  await admin.put(`/publications/${pubLinked.id}/authors`, { teamMemberIds: [rAuth.id] });
  await admin.put(`/publications/${pubLinkedHid.id}/authors`, { teamMemberIds: [rAuth.id] });
  await mgr.client.post(`/member/${rAuth.id}/history`, { year: "2020", title: "History Xylophone Award", description: "for lidar work" });
  // Japanese / mixed-language / special characters
  const aJp = await mkArea("ZZ Search 半導体 エージング", "FPGAのエージング検出とデータ解析", "半導体", "PUBLIC");
  const pJp = await mkProject("ZZ Search 量子計算プロジェクト", "量子コンピュータの研究", "PUBLIC");
  const pJpHid = await mkProject("ZZ Search 秘密の量子研究", "非公開の研究", "LAB_ONLY");
  const rJp = await mkTeam({ name: "ZZ Search 山田 太郎", role: "研究員", department: "情報学", bio: "データ駆動の半導体研究" });
  const rOB = await mkTeam({ name: "ZZ Search O'Brien", role: "Postdoc", bio: 'says "hello" \\ back' });
  // ordering fixtures (all PUBLIC, all match "ZZ Search Ordr")
  const oA = await mkArea("ZZ Search Ordr Area", "area", "OA", "PUBLIC");
  const oG = await mkGroup("ZZ Search Ordr Group", "group", "PUBLIC");
  const oP0 = await mkProject("ZZ Search Ordr Zebra", "zebra project", "PUBLIC");
  const oP0b = await mkProject("ZZ Search Ordr Ant", "ant project", "PUBLIC");
  const oP1 = await mkProject("ZZ Search Alpha Ordr", "alpha project", "PUBLIC");
  const oP2 = await mkProject("ZZ Search Bravo", "about ordr in the summary", "PUBLIC");
  const oPubOld = await mkPub("ZZ Search Ordr Alpha Paper", 2001, "x", "v", "PUBLIC");
  const oPubNew = await mkPub("ZZ Search Ordr Zulu Paper", 2040, "x", "v", "PUBLIC");
  const oNewsOld = await mkNews("ZZ Search Ordr Alpha News", "n", "T", "2001-01-01", "PUBLIC");
  const oNewsNew = await mkNews("ZZ Search Ordr Zulu News", "n", "T", "2040-01-01", "PUBLIC");
  await admin.put(`/projects/${pOpen.id}/members`, { members: [{ teamMemberId: leadU.tmId, role: "LEAD" }] });

  const made = [aPub, aHid, gPub, gHid, gNeutral, pOpen, pSecret, pInHid, pMarmot, pubPub, pubHid, newsPub, newsHid, rAuth, pubLinked, pubLinkedHid, aJp, pJp, pJpHid, rJp, rOB, oA, oG, oP0, oP0b, oP1, oP2, oPubOld, oPubNew, oNewsOld, oNewsNew];
  check("all fixtures were created", made.every((m) => m?.id) && [memA, leadU, mgr, odd].every((u) => u.id && u.tmId), `${made.findIndex((m) => !m?.id)}`);
  await prisma.user.update({ where: { id: odd.id }, data: { role: "SUPERUSER" } }); // unknown role => MEMBER

  const HIDDEN_IDS = [aHid, gHid, pSecret, pMarmot, pubHid, newsHid, pJpHid, pubLinkedHid].map((x) => x.id);
  const HIDDEN_TEXT = ["ZZ Search Quokka Area Hidden", "hidden-area-secret", "ZZ Search Quokka Group Hidden", "hidden-group-secret", gHid.slug, "ZZ Search Quokka Project Hidden", "hidden-project-secret", pSecret.slug, "ZZ Search Marmot Project Secret", "Marmot burrows", pMarmot.slug, "ZZ Search Quokka Paper Hidden", "Hidden Authorname", "Journal of Hidden Venue", "hiddendoi", "ZZ Search Quokka News Hidden", "hidden-news-secret", "ZZ Search 秘密の量子研究", "非公開の研究", "ZZ Search Linked Paper Hidden", "LAB_ONLY"];
  const accountIds = (await admin.get("/users")).json.map((u) => u.id);
  const userEmails = ["@example.test", "admin@smartcomputinglab.org"];

  // ------------------------------------------------------------------ validation
  section("validation: q, type, page, limit");
  const errShape = (r) => r.json && typeof r.json.error === "string" && Object.keys(r.json).length === 1 && !/prisma|stack|\n\s+at \S|node_modules|invocation|sqlite|SELECT /i.test(r.text);
  const bad = [
    ["missing q", {}], ["empty q", { q: "" }], ["spaces-only q", { q: "     " }], ["tabs/newlines-only q", { q: "\t\n \r" }],
    ["q 101 chars", { q: "a".repeat(101) }], ["q 300 chars", { q: "x".repeat(300) }], ["only wildcards %", { q: "%" }], ["only wildcards _%_", { q: "_%_" }],
    ["9 words", { q: "a b c d e f g h i" }], ["invalid type", { q: "a", type: "events" }], ["type uppercase", { q: "a", type: "PROJECT" }], ["type sql", { q: "a", type: "project;drop" }], ["empty type", { q: "a", type: "" }],
    ["page 0", { q: "a", page: "0" }], ["page -1", { q: "a", page: "-1" }], ["page 1.5", { q: "a", page: "1.5" }], ["page abc", { q: "a", page: "abc" }], ["page huge", { q: "a", page: "999999999999" }], ["page 10001", { q: "a", page: "10001" }], ["page empty", { q: "a", page: "" }], ["page 1e3", { q: "a", page: "1e3" }], ["page ' 1'", { q: "a", page: " 1" }], ["page 0x10", { q: "a", page: "0x10" }],
    ["limit 0", { q: "a", limit: "0" }], ["limit -5", { q: "a", limit: "-5" }], ["limit 51", { q: "a", limit: "51" }], ["limit 1000", { q: "a", limit: "1000" }], ["limit 1e9", { q: "a", limit: "1000000000" }], ["limit abc", { q: "a", limit: "abc" }], ["limit 2.5", { q: "a", limit: "2.5" }],
  ];
  for (const [label, params] of bad) {
    const r = await search(guest, params);
    check(`400 for ${label}`, r.status === 400 && errShape(r), `${r.status} ${r.text.slice(0, 120)}`);
  }
  let r = await guest.req("GET", "/search?q=a&q=b");
  check("400 for repeated q (array)", r.status === 400 && errShape(r));
  r = await guest.req("GET", "/search?q[x]=b");
  check("400 for q as object", r.status === 400 && errShape(r));
  r = await guest.req("GET", "/search?q=a&type=all&type=project");
  check("400 for repeated type", r.status === 400 && errShape(r));
  r = await guest.req("GET", "/search?q=a&limit=5&limit=6");
  check("400 for repeated limit", r.status === 400 && errShape(r));
  check("error messages are specific", (await search(guest, {})).json?.error === "Search text is required." && (await search(guest, { q: "a", limit: "51" })).json?.error === "Limit must be a whole number between 1 and 50." && (await search(guest, { q: "a", type: "x" })).json?.error?.startsWith("Type must be one of"));
  check("q of exactly 100 chars is accepted", (await search(guest, { q: "a".repeat(100) })).status === 200);
  check("100 Japanese chars is accepted, 101 is not", (await search(guest, { q: "あ".repeat(100) })).status === 200 && (await search(guest, { q: "あ".repeat(101) })).status === 400);
  check("8 words is accepted", (await search(guest, { q: "a b c d e f g h" })).status === 200);
  check("duplicate words count once (9 identical words is fine)", (await search(guest, { q: "a a a a a a a a a A" })).status === 200);
  check("limit 50 and page 10000 are accepted", (await search(guest, { q: "Quokka", limit: "50", page: "10000" })).status === 200);
  check("defaults: page 1, limit 20, type all", await (async () => { const x = (await search(guest, { q: "Quokka" })).json; return x.pagination.page === 1 && x.pagination.limit === 20 && x.type === "all"; })());
  check("unknown query parameters are ignored, not errors", (await guest.get("/search?q=Quokka&foo=bar&__proto__[x]=1&constructor=1")).status === 200);
  check("POST/PUT/DELETE /search do not exist (404)", (await guest.post("/search", { q: "a" })).status === 404 && (await guest.put("/search", {})).status === 404 && (await guest.del("/search")).status === 404);
  check("responses are JSON with Vary: Cookie", (await search(guest, { q: "Quokka" })).headers.get("content-type")?.includes("application/json") && /cookie/i.test((await search(guest, { q: "Quokka" })).headers.get("vary") ?? ""));
  check("search needs no login (guest 200, not 401)", (await search(guest, { q: "Quokka" })).status === 200);

  // ------------------------------------------------------------------ visibility per viewer
  section("visibility: guest / MEMBER / lead / LAB_MANAGER / ADMIN / unknown role");
  const guestQ = (await search(guest, { q: "Quokka" })).json;
  const memQ = (await search(memA.client, { q: "Quokka" })).json;
  const GUEST_COUNTS = { all: 7, "research-area": 1, project: 2, group: 1, researcher: 1, publication: 1, news: 1, "forum-topic": 0, event: 0 };
  const MEMBER_COUNTS = { all: 12, "research-area": 2, project: 3, group: 2, researcher: 1, publication: 2, news: 2, "forum-topic": 0, event: 0 };
  check("guest counts = PUBLIC matches only (1+2+1+1+1+1 = 7)", eq(guestQ.counts, GUEST_COUNTS) && guestQ.pagination.total === 7, JSON.stringify(guestQ.counts));
  check("member counts = PUBLIC + LAB_ONLY (12)", eq(memQ.counts, MEMBER_COUNTS) && memQ.pagination.total === 12, JSON.stringify(memQ.counts));
  const expectPublic = [aPub, gPub, pOpen, pInHid, pubPub, newsPub].map((x) => x.id).concat(memA.tmId);
  check("guest result ids are exactly the public fixtures + the researcher", sameSet(ids({ json: guestQ }), expectPublic), ids({ json: guestQ }).join());
  check("member result ids are exactly public + LAB_ONLY fixtures", sameSet(ids({ json: memQ }), [...expectPublic, aHid.id, gHid.id, pSecret.id, pubHid.id, newsHid.id]));
  const guestRaw = JSON.stringify(guestQ);
  check("guest JSON: no hidden id, name, slug, text or 'LAB_ONLY'", ![...HIDDEN_IDS, ...HIDDEN_TEXT].some((s) => guestRaw.includes(s)), [...HIDDEN_IDS, ...HIDDEN_TEXT].filter((s) => guestRaw.includes(s)).join());
  const guestResultsRaw = JSON.stringify(guestQ.results); // (`counts` legitimately has keys named after the types)
  check("guest results carry no `visibility` key, no slug, no group/project relationship keys", !guestRaw.includes('"visibility"') && !guestRaw.includes('"slug"') && !/"(group|groupId|project|projectId|members|projectCount)":/.test(guestResultsRaw));
  check("member results carry no `visibility` key either (Phase 9 rule)", !JSON.stringify(memQ).includes('"visibility"'));
  const leadQ = (await search(leadU.client, { q: "Quokka" })).json;
  check("a project LEAD (a plain MEMBER) sees what a member sees, no visibility key", eq(leadQ.counts, MEMBER_COUNTS) && !JSON.stringify(leadQ).includes('"visibility"'));
  const oddQ = (await search(odd.client, { q: "Quokka" })).json;
  check("unknown role => treated as MEMBER (sees LAB_ONLY, no visibility key)", eq(oddQ.counts, MEMBER_COUNTS) && !JSON.stringify(oddQ).includes('"visibility"'));
  for (const [label, c] of [["LAB_MANAGER", mgr.client], ["ADMIN", admin]]) {
    const x = (await search(c, { q: "Quokka" })).json;
    check(`${label} sees PUBLIC + LAB_ONLY (12)`, eq(x.counts, MEMBER_COUNTS) && sameSet(ids({ json: x }), ids({ json: memQ })));
    const vis = Object.fromEntries(x.results.filter((y) => y.visibility).map((y) => [y.id, y.visibility]));
    check(`${label} results carry the correct \`visibility\` (like the normal endpoints), researchers have none`, [aHid, gHid, pSecret, pubHid, newsHid].every((h) => vis[h.id] === "LAB_ONLY") && [aPub, gPub, pOpen, pubPub, newsPub].every((h) => vis[h.id] === "PUBLIC") && !("visibility" in x.results.find((y) => y.type === "researcher")));
  }
  check("hidden-only words: guest gets nothing, member/manager/admin find the record", await (async () => {
    const out = [];
    for (const [word, hidden] of [["hidden-area-secret", aHid], ["hidden-group-secret", gHid], ["hidden-project-secret", pSecret], ["hiddendoi", pubHid], ["hidden-news-secret", newsHid], ["Hidden Authorname", pubHid], ["Journal of Hidden Venue", pubHid]]) {
      const g = await search(guest, { q: word });
      const m = await search(memA.client, { q: word });
      out.push(g.json.pagination.total === 0 && g.json.results.length === 0 && eq(g.json.counts, { all: 0, "research-area": 0, project: 0, group: 0, researcher: 0, publication: 0, news: 0, "forum-topic": 0, event: 0 }) && ids(m).includes(hidden.id));
    }
    return out.every(Boolean);
  })());

  // ------------------------------------------------------------------ one source of truth
  section("search agrees with the normal endpoints (the oracle) for every viewer");
  const listOf = { project: ["/projects", "title"], group: ["/groups", "name"], publication: ["/publications", "title"], news: ["/news", "title"], "research-area": ["/research", "title"], researcher: ["/team", "name"] };
  const viewers = [["guest", guest], ["MEMBER", memA.client], ["lead", leadU.client], ["LAB_MANAGER", mgr.client], ["ADMIN", admin], ["unknown role", odd.client]];
  for (const [label, c] of viewers) {
    const bad = [];
    for (const [type, [path, key]] of Object.entries(listOf)) {
      const viaList = (await c.get(path)).json.filter((x) => x[key].startsWith("ZZ Search")).map((x) => x.id);
      const viaSearch = (await everything(c, { q: "ZZ Search", type })).results.map((x) => x.id);
      if (!sameSet(viaList, viaSearch)) bad.push(`${type}: list ${viaList.length} vs search ${viaSearch.length}`);
    }
    check(`${label}: search finds exactly the records the normal list endpoints show (all 6 types)`, bad.length === 0, bad.join("; "));
  }
  for (const [label, c] of viewers) {
    const all = (await everything(c, { q: "ZZ Search" })).results;
    const detail = { project: "/projects/", group: "/groups/", publication: "/publications/", news: "/news/", "research-area": "/research/", researcher: "/team/" };
    const codes = await Promise.all(all.map(async (x) => (await c.get(detail[x.type] + x.id)).status));
    check(`${label}: every returned id opens through the normal detail endpoint (200)`, all.length > 20 && codes.every((s) => s === 200), `${all.length} results; codes ${[...new Set(codes)].join()}`);
  }
  const guestAll = (await everything(guest, { q: "ZZ Search" })).results;
  const hiddenCodes = await Promise.all([["/research/", aHid], ["/groups/", gHid], ["/projects/", pSecret], ["/publications/", pubHid], ["/news/", newsHid]].map(async ([p, h]) => (await guest.get(p + h.id)).status));
  check("(control) the ids search withheld from a guest really are 404 on the normal endpoints", hiddenCodes.every((s) => s === 404) && guestAll.every((x) => !HIDDEN_IDS.includes(x.id)));
  check("result href is the existing page for each type", guestAll.every((x) => ({ project: `/projects/${x.id}`, group: `/groups/${x.id}`, researcher: `/team/${x.id}`, publication: `/publications/${x.id}`, news: "/news", "research-area": `/research/${x.id}` })[x.type] === x.href));

  // ------------------------------------------------------------------ nested visibility
  section("nested visibility (security regression)");
  let g = (await search(guest, { q: "Marmot" })).json;
  check("hidden project 'Marmot' inside a PUBLIC group: guest gets nothing (project absent, group NOT returned)", g.pagination.total === 0 && g.results.length === 0 && !JSON.stringify(g).includes(gNeutral.id) && !JSON.stringify(g).includes("Neutral Group"));
  let m = (await search(memA.client, { q: "Marmot" })).json;
  check("...a member finds the project, but the group is still not returned (matched only by its own text)", eq(ids({ json: m }), [pMarmot.id]) && m.counts.group === 0);
  g = (await search(guest, { q: "Quokka Project In Hidden Group" })).json;
  check("PUBLIC project in a LAB_ONLY group: guest finds the project", ids({ json: g }).includes(pInHid.id));
  const gRaw = JSON.stringify(g);
  check("...and its raw JSON has no hidden-group id, name, slug or description", ![gHid.id, gHid.slug, "ZZ Search Quokka Group Hidden", "hidden-group-secret"].some((s) => gRaw.includes(s)));
  g = (await search(guest, { q: "Quokka", type: "group" })).json;
  check("guest group results = the public group only (the hidden group and its project never add to it)", eq(ids({ json: g }), [gPub.id]) && g.pagination.total === 1);
  g = (await search(guest, { q: "Quokka", type: "project" })).json;
  check("guest project results exclude the LAB_ONLY project that sits in the PUBLIC group", sameSet(ids({ json: g }), [pOpen.id, pInHid.id]) && g.pagination.total === 2);
  g = (await search(guest, { q: "ZZ Search Quokka Group Public", type: "group" })).json;
  check("a public group is found by its own name only, its hidden project neither adds nor removes anything", eq(ids({ json: g }), [gPub.id]) && !JSON.stringify(g).includes(pSecret.id));
  g = (await search(guest, { q: "hidden-project-secret" })).json;
  check("a word that exists only inside a hidden project does not return the (public) group that holds it", g.pagination.total === 0 && !JSON.stringify(g).includes(gPub.id));
  g = (await search(guest, { q: "Zanzibar" })).json;
  check("researcher with a hidden linked publication: guest gets the researcher and the PUBLIC linked paper only", sameSet(ids({ json: g }), [rAuth.id, pubLinked.id]) && !JSON.stringify(g).includes(pubLinkedHid.id) && !JSON.stringify(g).includes("Linked Paper Hidden") && g.counts.publication === 1);
  m = (await search(memA.client, { q: "Zanzibar" })).json;
  check("...a member also gets the LAB_ONLY linked paper (found through its linked author)", sameSet(ids({ json: m }), [rAuth.id, pubLinked.id, pubLinkedHid.id]) && m.counts.publication === 2);
  g = (await search(guest, { q: "Xylophone" })).json;
  check("a researcher is found through their (public) history entries", eq(ids({ json: g }), [rAuth.id]));
  g = (await search(guest, { q: "Ricercatore" })).json;
  check("a researcher's name finds the publications they are linked to (guest: the public one only)", sameSet(ids({ json: g }), [rAuth.id, pubLinked.id]));
  check("researcher profiles are public in /api/team, and are found regardless of viewer", (await guest.get(`/team/${rAuth.id}`)).status === 200);
  g = (await search(guest, { q: "Quokka", type: "researcher" })).json;
  check("researcher results expose no account data (no userId/email/isOwn/account id)", !/userId|email|isOwn|password/i.test(JSON.stringify(g)) && !accountIds.some((a) => JSON.stringify(g).includes(a)) && g.results.length === 1);

  section("visibility flips, deletion and sessions take effect at once");
  check("(before) guest finds the public project", ids(await search(guest, { q: "Quokka Project Open" })).includes(pOpen.id));
  await admin.put(`/projects/${pOpen.id}`, { visibility: "LAB_ONLY" });
  let after = await search(guest, { q: "Quokka Project Open" });
  check("public -> LAB_ONLY: gone for the guest, count too", after.json.pagination.total === 0 && (await search(guest, { q: "Quokka" })).json.counts.project === 1);
  check("...still there for a member", ids(await search(memA.client, { q: "Quokka Project Open" })).includes(pOpen.id));
  await admin.put(`/projects/${pOpen.id}`, { visibility: "PUBLIC" });
  check("LAB_ONLY -> public: back for the guest", ids(await search(guest, { q: "Quokka Project Open" })).includes(pOpen.id));
  await admin.put(`/news/${newsPub.id}`, { visibility: "LAB_ONLY" });
  check("a news item made LAB_ONLY disappears for the guest", !ids(await search(guest, { q: "Quokka News Public" })).includes(newsPub.id));
  await admin.put(`/news/${newsPub.id}`, { visibility: "PUBLIC" });
  await admin.put(`/publications/${pubHid.id}`, { visibility: "PUBLIC" });
  check("a publication made PUBLIC appears for the guest", ids(await search(guest, { q: "hiddendoi" })).includes(pubHid.id));
  await admin.put(`/publications/${pubHid.id}`, { visibility: "LAB_ONLY" });
  check("...and disappears again when re-hidden", (await search(guest, { q: "hiddendoi" })).json.pagination.total === 0);

  const tmpProj = await mkProject("ZZ Search Ephemeral Project", "gone soon", "PUBLIC");
  const tmpNews = await mkNews("ZZ Search Ephemeral News", "gone soon", "T", "2031-05-05", "PUBLIC");
  const tmpMember = await mkTeam({ name: "ZZ Search Ephemeral Person", role: "Temp" });
  check("(before) the ephemeral records are found", (await search(guest, { q: "Ephemeral" })).json.pagination.total === 3);
  await mgr.client.del(`/projects/${tmpProj.id}`);
  await mgr.client.del(`/news/${tmpNews.id}`);
  await admin.del(`/team/${tmpMember.id}`);
  check("deleted project, news item and researcher no longer appear (guest and member)", (await search(guest, { q: "Ephemeral" })).json.pagination.total === 0 && (await search(memA.client, { q: "Ephemeral" })).json.pagination.total === 0);
  await admin.del(`/publications/${pubLinked.id}`);
  check("a deleted publication no longer appears via its author either", !ids(await search(guest, { q: "Zanzibar" })).includes(pubLinked.id));

  const stale = new Client();
  await stale.login(memA.email, PW);
  const staleCookie = stale.cookie;
  check("logged-in cookie sees LAB_ONLY", (await search(stale, { q: "Quokka" })).json.pagination.total === 12);
  await stale.post("/auth/logout");
  const replay = new Client();
  replay.cookie = staleCookie;
  check("after logout the old cookie is a guest again (7 results)", (await search(replay, { q: "Quokka" })).json.pagination.total === 7);
  check("a garbage session cookie is a guest, not an error", await (async () => { const c = new Client(); c.cookie = "scl.sid=s%3Anotarealsession.abc"; const x = await search(c, { q: "Quokka" }); return x.status === 200 && x.json.pagination.total === 7; })());
  const demote = await mkUser("demote", "MEMBER", "ZZ Search Demote");
  check("(before) a member sees 12", (await search(demote.client, { q: "Quokka" })).json.pagination.total === 12);
  await admin.del(`/users/${demote.id}`);
  check("a deleted account's live session is a guest again at once (7)", (await search(demote.client, { q: "Quokka" })).json.pagination.total === 7);

  section("nothing the client sends can change what it sees");
  for (const extra of [{ role: "ADMIN" }, { visibility: "LAB_ONLY" }, { visibility: "PUBLIC,LAB_ONLY" }, { userId: memA.id }, { user: memA.id }, { isAdmin: "true" }, { viewer: "ADMIN" }]) {
    const x = (await search(guest, { q: "Quokka", ...extra })).json;
    check(`guest + ${JSON.stringify(extra)} is still a guest view`, x.pagination.total === 7 && !HIDDEN_IDS.some((h) => JSON.stringify(x).includes(h)));
  }
  r = await guest.req("GET", "/search?q=Quokka");
  const forged = await fetch(`${API}/api/search?q=Quokka`, { headers: { "x-role": "ADMIN", "x-user-id": memA.id, authorization: `Bearer ${memA.id}`, cookie: "role=ADMIN; userId=" + memA.id } });
  check("forged headers/cookies (x-role, x-user-id, Authorization, role=ADMIN) do nothing", (await forged.json()).pagination.total === 7);
  check("member cookie + role=ADMIN param: still no `visibility` key", !JSON.stringify((await search(memA.client, { q: "Quokka", role: "ADMIN" })).json).includes('"visibility"'));

  // ------------------------------------------------------------------ type filter
  section("type filter");
  const perType = { "research-area": [aPub], project: [pOpen, pInHid], group: [gPub], researcher: [{ id: memA.tmId }], publication: [pubPub], news: [newsPub] };
  for (const [type, want] of Object.entries(perType)) {
    const x = await search(guest, { q: "Quokka", type });
    check(`type=${type}: only ${type} results, guest-visible ones`, x.status === 200 && x.json.type === type && x.json.results.every((y) => y.type === type) && sameSet(ids(x), want.map((w) => w.id)) && x.json.pagination.total === want.length);
    check(`type=${type}: counts still describe every type (filter chips stay stable)`, eq(x.json.counts, GUEST_COUNTS));
  }
  check("type=all and omitted type are identical", eq((await search(guest, { q: "Quokka", type: "all" })).json, (await search(guest, { q: "Quokka" })).json));
  check("type filter with zero matches: empty, total 0", await (async () => { const x = (await search(guest, { q: "Quokka", type: "publication", page: "1" })).json; const y = (await search(guest, { q: "Marmot", type: "project" })).json; return x.results.length === 1 && y.results.length === 0 && y.pagination.total === 0 && y.pagination.totalPages === 0; })());
  check("each result declares its entity type (one of the six)", [...guestQ.results, ...memQ.results].every((x) => ["research-area", "project", "group", "researcher", "publication", "news"].includes(x.type) && typeof x.id === "string" && typeof x.title === "string" && typeof x.href === "string" && typeof x.meta === "string" && typeof x.description === "string"));

  // ------------------------------------------------------------------ pagination
  section("pagination");
  const everyone = (await everything(memA.client, { q: "ZZ Search Ordr" })).results;
  const N = everyone.length;
  check("the ordering fixtures produce a result set to page through (10)", N === 10, String(N));
  for (const limit of [1, 2, 3, 5, 7, 12, 50]) {
    const seen = [];
    let meta;
    let lens = [];
    for (let page = 1; page <= Math.ceil(N / limit) + 1; page++) {
      const x = await search(memA.client, { q: "ZZ Search Ordr", limit: String(limit), page: String(page) });
      meta = x.json.pagination;
      if (page <= Math.ceil(N / limit)) lens.push(x.json.results.length);
      seen.push(...ids(x));
    }
    check(`limit=${limit}: pages concatenate to the full ordered list, no gaps, no repeats`, eq(seen, everyone.map((e) => e.id)), `${seen.length} of ${N}`);
    check(`limit=${limit}: total=${N}, totalPages=${Math.ceil(N / limit)}, every page <= limit, last page holds the rest`, meta.total === N && meta.totalPages === Math.ceil(N / limit) && lens.every((l) => l <= limit) && lens[lens.length - 1] === N - (Math.ceil(N / limit) - 1) * limit && meta.limit === limit);
  }
  const past = (await search(memA.client, { q: "ZZ Search Ordr", limit: "5", page: "9999" })).json;
  check("a page past the end: empty results, same total/totalPages (no error)", past.results.length === 0 && past.pagination.total === N && past.pagination.totalPages === 2 && past.pagination.page === 9999);
  const gp = (await search(guest, { q: "Quokka", limit: "3" })).json;
  check("guest pagination.total (7) and totalPages (3) never reflect the 12 a member sees", gp.pagination.total === 7 && gp.pagination.totalPages === 3 && gp.results.length === 3);
  const gp2 = (await search(guest, { q: "Quokka", limit: "3", page: "3" })).json;
  check("guest last page has 1 result", gp2.results.length === 1);
  check("a request never returns more than 50 results even when more match", (await search(memA.client, { q: "a", limit: "50" })).json.results.length <= 50);
  const big = (await search(guest, { q: "e", limit: "50" })).json;
  check("bounded result set: <= limit results and every one has bounded text (<= 205 chars of description)", big.results.length <= 50 && big.results.every((x) => x.description.length <= 205));

  // ------------------------------------------------------------------ ordering
  section("ordering is deterministic and documented");
  const ord = (await search(guest, { q: "ZZ Search Ordr", limit: "50" })).json.results;
  const expectOrder = [
    // tier 0 (title starts with the whole query), type order area, project, group, publication, news; each type in its own order
    oA.id, oP0b.id, oP0.id, oG.id, oPubNew.id, oPubOld.id, oNewsNew.id, oNewsOld.id,
    // tier 1 (title contains every word, not a prefix)
    oP1.id,
    // tier 2 (matched only through another field)
    oP2.id,
  ];
  check("guest: tier 0 -> tier 1 -> tier 2, types in a fixed order inside a tier", eq(ord.map((x) => x.id), expectOrder), titles({ json: { results: ord } }).join(" | "));
  check("(control) plain A-Z would have produced a different order", !eq([...ord].sort((a, b) => a.title.localeCompare(b.title)).map((x) => x.id), expectOrder));
  check("projects inside a tier are A-Z (Ant before Zebra)", ord.findIndex((x) => x.id === oP0b.id) < ord.findIndex((x) => x.id === oP0.id));
  check("publications are newest year first, news newest first (not A-Z)", ord.findIndex((x) => x.id === oPubNew.id) < ord.findIndex((x) => x.id === oPubOld.id) && ord.findIndex((x) => x.id === oNewsNew.id) < ord.findIndex((x) => x.id === oNewsOld.id));
  const runs = [];
  for (let i = 0; i < 4; i++) runs.push(JSON.stringify((await search(memA.client, { q: "Quokka", limit: "50" })).json));
  check("the same search repeated gives byte-identical JSON", runs.every((x) => x === runs[0]));
  check("the same query with a different case/spacing/word order gives the same SET", sameSet(ids(await search(guest, { q: "  ZZ   SEARCH   ORDR  " })), ids(await search(guest, { q: "ordr search zz" }))));
  check("word order changes tiers, not membership (prefix needs the phrase in order)", (await search(guest, { q: "Ordr ZZ Search" })).json.pagination.total === (await search(guest, { q: "ZZ Search Ordr" })).json.pagination.total);
  const twoPages = [...ids(await search(memA.client, { q: "Quokka", limit: "5", page: "1" })), ...ids(await search(memA.client, { q: "Quokka", limit: "5", page: "2" })), ...ids(await search(memA.client, { q: "Quokka", limit: "5", page: "3" }))];
  check("paging a different limit walks the same order as limit=50", eq(twoPages, ids(await search(memA.client, { q: "Quokka", limit: "50" }))));

  // ------------------------------------------------------------------ text matching
  section("matching: case, several words, Japanese, mixed language, special characters");
  const set = async (c, p) => new Set(ids(await search(c, p)));
  const base = await set(guest, { q: "Quokka" });
  check("case-insensitive (ASCII): quokka / QUOKKA / QuOkKa", eq([...await set(guest, { q: "quokka" })], [...base]) && eq([...await set(guest, { q: "QUOKKA" })], [...base]) && eq([...await set(guest, { q: "QuOkKa" })], [...base]) && base.size === 7);
  check("full-width Latin is normalised (ＱＵＯＫＫＡ finds the same records)", eq([...await set(guest, { q: "ＱＵＯＫＫＡ" })], [...base]));
  check("substring anywhere in a word: 'uokk'", eq([...await set(guest, { q: "uokk" })], [...base]));
  check("all words must match (AND), in any order and any field", ids(await search(guest, { q: "Journal Quokka Studies" })).join() === pubPub.id && ids(await search(guest, { q: "Studies Journal" })).includes(pubPub.id) && (await search(guest, { q: "Quokka Nonexistentword" })).json.pagination.total === 0);
  check("words may be split across fields (title word + venue word)", ids(await search(guest, { q: "Paper Studies" })).includes(pubPub.id));
  check("publication: DOI, venue and year are searchable", ids(await search(guest, { q: "quokkadoi" })).includes(pubPub.id) && ids(await search(guest, { q: "Journal of Quokka" })).includes(pubPub.id) && ids(await search(guest, { q: "2040 ZZ Search" })).includes(oPubNew.id));
  check("news type/category is searchable", ids(await search(guest, { q: "Zzsearchtype", type: "news" })).join() === newsPub.id);
  check("project slug is searchable, group slug too, area tag too", ids(await search(memA.client, { q: pOpen.slug })).includes(pOpen.id) && ids(await search(memA.client, { q: gPub.slug })).includes(gPub.id) && ids(await search(guest, { q: "ZQ", type: "research-area" })).includes(aPub.id));
  check("researcher: name, role, department and bio are searchable", ids(await search(guest, { q: "Quokka Analyst" })).includes(memA.tmId) && ids(await search(guest, { q: "Visiting Scholar" })).includes(rAuth.id) && ids(await search(guest, { q: "情報学" })).includes(rJp.id) && ids(await search(guest, { q: "zanzibar-lidar" })).includes(rAuth.id));
  check("project summary AND description are searchable", ids(await search(memA.client, { q: "Marmot burrows" })).includes(pMarmot.id));

  const jp = async (q, c = guest) => new Set(ids(await search(c, { q })));
  check("Japanese: '半導体' finds the area (title) and the researcher (bio)", eq([...await jp("半導体")].sort(), [aJp.id, rJp.id].sort()));
  check("Japanese: 'エージング' / 'データ' / '研究' substring matches", (await jp("エージング")).has(aJp.id) && (await jp("データ")).has(aJp.id) && (await jp("データ")).has(rJp.id) && (await jp("研究")).has(pJp.id) && (await jp("研究")).has(rJp.id));
  check("Japanese: role and department (研究員 / 情報学)", (await jp("研究員")).has(rJp.id) && (await jp("情報学")).has(rJp.id));
  check("Japanese: 山田 finds the researcher, 太郎 too (substring of a spaced name)", (await jp("山田")).has(rJp.id) && (await jp("太郎")).has(rJp.id) && (await jp("山田 太郎")).has(rJp.id));
  check("Japanese: guest does not get the LAB_ONLY 秘密の量子研究 project, a member does", !(await jp("量子")).has(pJpHid.id) && (await jp("量子")).has(pJp.id) && (await jp("量子", memA.client)).has(pJpHid.id) && (await search(guest, { q: "非公開" })).json.pagination.total === 0);
  check("Japanese: 量子 counts — guest 1 project, member 2 (no hidden total leak)", (await search(guest, { q: "量子" })).json.counts.project === 1 && (await search(memA.client, { q: "量子" })).json.counts.project === 2);
  check("mixed: 'FPGA エージング' (space) finds the area; word order does not matter", eq([...await jp("FPGA エージング")], [aJp.id]) && eq([...await jp("エージング FPGA")], [aJp.id]));
  check("mixed: ideographic (full-width) space U+3000 separates words too", eq([...await jp("FPGA　エージング")], [aJp.id]) && eq([...await jp("ＦＰＧＡ　エージング")], [aJp.id]));
  check("mixed: 'FPGA' alone still finds the real English FPGA content too (not only the fixture)", (await search(guest, { q: "FPGA" })).json.pagination.total >= 7);
  check("mixed: 半導体 fpga (lowercase Latin + Japanese)", eq([...await jp("半導体 fpga")], [aJp.id]));
  check("Japanese result text is intact (no mojibake)", (await search(guest, { q: "エージング", type: "research-area" })).json.results[0]?.description === "FPGAのエージング検出とデータ解析");
  check("Japanese snippet centres on the match in a long text", await (async () => {
    const long = "前置き".repeat(120) + "ターゲット語" + "後書き".repeat(120);
    const created = await mkProject("ZZ Search 長文", "", "PUBLIC", undefined, { description: long });
    const x = (await search(guest, { q: "ターゲット語", type: "project" })).json.results[0];
    return x?.id === created.id && x.description.includes("ターゲット語") && x.description.length <= 205 && x.description.startsWith("…");
  })());

  check("quote in the query finds O'Brien", eq([...await jp("O'Brien")], [rOB.id]) && (await jp("brien")).has(rOB.id));
  check('double quotes and backslash are literal text ("hello" and \\)', (await jp('"hello"')).has(rOB.id) && (await jp("\\")).has(rOB.id) && (await jp("hello \\")).has(rOB.id));
  const totalAll = (await search(guest, { q: "e" })).json.pagination.total;
  const wild = { "%": 400, "%%%": 400, "_": 400, "_%": 400 };
  for (const [q, status] of Object.entries(wild)) check(`SQL wildcard-only query ${JSON.stringify(q)} is rejected (never 'match everything')`, (await search(guest, { q })).status === status);
  check("wildcards inside a query are word separators, they never widen the match (Q%kka needs both Q and kka)", ids(await search(guest, { q: "Q%kka" })).length > 0 && (await search(guest, { q: "Quokka%zzzzz" })).json.pagination.total === 0 && (await search(guest, { q: "Quokka_zzzzz" })).json.pagination.total === 0);
  check("'%' and '_' cannot enumerate: 'Q_' / 'Q%' are just the word 'Q'", eq([...await set(guest, { q: "Q_" })], [...await set(guest, { q: "Q" })]) && eq([...await set(guest, { q: "Q%" })], [...await set(guest, { q: "Q" })]));
  check("a NUL byte in the query is a word separator (Quo%00kka finds Quokka), not a truncation", eq([...await set(guest, { q: "Quo\u0000kka" })], [...base]));
  check("query echo is the normalised phrase (trimmed, single spaces)", (await search(guest, { q: "  ＦＰＧＡ   aging " })).json.query === "FPGA aging");

  const injections = ["'; DROP TABLE \"User\"; --", "\" OR \"\"=\"", "1' UNION SELECT passwordHash FROM User --", "' OR '1'='1", "'; DELETE FROM Publication; --", "admin'--", "\\'; SELECT * FROM Session; --", "%27%20OR%201=1", "1; PRAGMA writable_schema=1", "`; SELECT 1 --", "') OR ('1'='1", "${7*7}", "{{7*7}}", "../../etc/passwd", "\u0000"];
  const injOutcomes = [];
  for (const q of injections) for (const c of [guest, memA.client, admin]) injOutcomes.push({ q, r: await search(c, { q }) });
  check("SQL-injection style input: never a 500, never 'everything', never account/credential data", injOutcomes.every(({ r }) => (r.status === 200 || r.status === 400) && (r.status === 400 || r.json.pagination.total <= 3) && !/passwordHash|\$2[aby]\$|scl\.sid/.test(JSON.stringify(r.json?.results ?? []))), injOutcomes.filter(({ r }) => r.status >= 500).map((o) => o.q).join(" | "));
  check("...and the database is untouched afterwards (row counts, admin login, tables)", (await prisma.user.count()) === dbBefore.users + 4 + 0 && (await prisma.publication.count()) > 0 && (await admin.get("/users")).status === 200 && (await prisma.session.count()) >= 1 && Number((await prisma.$queryRaw`SELECT count(*) AS n FROM sqlite_master WHERE name IN ('User','Publication','Session')`)[0].n) === 3);
  const xss = ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "\"><svg/onload=alert(1)>", "javascript:alert(1)", "&lt;b&gt;"];
  for (const q of xss) {
    const x = await search(guest, { q });
    check(`HTML/script-looking input ${JSON.stringify(q).slice(0, 30)}: 200 JSON (never HTML), no results, echoed as plain JSON text`, x.status === 200 && x.headers.get("content-type")?.includes("application/json") && x.json.pagination.total === 0 && x.json.query.length > 0 && !x.headers.get("content-type").includes("html"));
  }
  const oddChars = ["🔬", "🧪 test", "emoji 😀 x", "a+b", "C++", "a&b=c", "a?b", "a#b", "a/b", "a\\b", "*", ".*", "[a-z]", "(", ")", "^$", "|", "{}", "~", "!", "@", "​", "\ud83d", "  ", "..", "é", "Ünïcödé", "ß", "İ"];
  const oddRes = [];
  for (const q of oddChars) oddRes.push([q, await search(guest, { q })]);
  check("special characters never crash (200, or 400 when nothing searchable remains)", oddRes.every(([, x]) => x.status === 200 || x.status === 400) && oddRes.every(([, x]) => x.status !== 200 || typeof x.json.pagination.total === "number"), oddRes.filter(([, x]) => x.status >= 500).map(([q]) => q).join());
  check("regex/glob characters are literal text, not patterns (.* / [a-z] / * match nothing)", [".*", "[a-z]", "*", "^$"].every((q) => oddRes.find(([k]) => k === q)[1].json?.pagination?.total === 0));

  // ------------------------------------------------------------------ Japanese Translation matching (Phase 15 §10)
  section("Japanese Translation matching (Phase 15): a ja override is findable, English is untouched, visibility holds");
  const TERM = "トランスレート限定検索語";
  const TERM_HIDDEN = "秘密トランスレート限定語";
  const TITLE_TERM = "翻訳タイトル限定語";
  const aXlat = await mkArea("ZZ Search Xlat Area", "Nothing special in English here", "ZX", "PUBLIC");
  await admin.put(`/research/${aXlat.id}`, { translations: { ja: { description: `この分野は${TERM}に関する説明です。` } } });
  const aXlatHid = await mkArea("ZZ Search Xlat Hidden Area", "Nothing special in English, secret", "ZX", "LAB_ONLY");
  await admin.put(`/research/${aXlatHid.id}`, { translations: { ja: { description: `非公開の${TERM_HIDDEN}。` } } });
  const aXlatTitle = await mkArea("ZZ Search Xlat Title Area", "irrelevant english description", "ZX", "PUBLIC");
  await admin.put(`/research/${aXlatTitle.id}`, { translations: { ja: { title: `${TITLE_TERM}というタイトル` } } });
  const hostileTerm = "ザッ危険限定語";
  const aXlatXss = await mkArea("ZZ Search Xlat XSS Area", "irrelevant", "ZX", "PUBLIC");
  await admin.put(`/research/${aXlatXss.id}`, { translations: { ja: { description: `<script>alert(1)</script>${hostileTerm}` } } });

  check("ja override is NOT searchable at all under X-Locale: en (English never queries Translation)", (await search(guest, { q: TERM }, "en")).json.pagination.total === 0);
  check("ja override IS searchable under X-Locale: ja, ranked (tier2: never promoted by a title it doesn't have)", ids(await search(guest, { q: TERM }, "ja")).includes(aXlat.id));
  check("a translation-only match's own type count is still correct", (await search(guest, { q: TERM, type: "research-area" }, "ja")).json.counts["research-area"] === 1);
  check("visibility still holds WITH a ja override: guest+ja cannot find the LAB_ONLY area", (await search(guest, { q: TERM_HIDDEN }, "ja")).json.pagination.total === 0);
  check("...but a logged-in member+ja can (same rule as an English LAB_ONLY match)", ids(await search(memA.client, { q: TERM_HIDDEN }, "ja")).includes(aXlatHid.id));
  check("no locale ever changes what guest can find without ja: en/ja both 0 for the hidden term with no session", (await search(guest, { q: TERM_HIDDEN }, "en")).json.pagination.total === 0);

  const byTitleTerm = (await search(guest, { q: TITLE_TERM, type: "research-area" }, "ja")).json.results[0];
  check("a ja-title override is matched by its Japanese text", byTitleTerm?.id === aXlatTitle.id);
  check("...and the RESULT shows the ja title, not the English one (matches the entity's own localized GET)", byTitleTerm?.title === `${TITLE_TERM}というタイトル`);
  const byEnglishTitleJa = (await search(guest, { q: "ZZ Search Xlat Title Area" }, "ja")).json.results.find((r) => r.id === aXlatTitle.id);
  check("found via the ENGLISH title under ja locale still shows the ja override in the result (localize() applies regardless of which column matched)", byEnglishTitleJa?.title === `${TITLE_TERM}というタイトル`);
  const byEnglishTitleEn = (await search(guest, { q: "ZZ Search Xlat Title Area" }, "en")).json.results.find((r) => r.id === aXlatTitle.id);
  check("...but under X-Locale: en the same entity's result is unchanged (still the English title)", byEnglishTitleEn?.title === "ZZ Search Xlat Title Area");

  const xssHit = (await search(guest, { q: hostileTerm }, "ja")).json.results.find((r) => r.id === aXlatXss.id);
  check("a hostile ja translation value is findable and round-trips as inert JSON text (never executed, same guarantee as i18n-regression.mjs)", xssHit?.description.includes("<script>alert(1)</script>") && xssHit.description.includes(hostileTerm));

  // ------------------------------------------------------------------ raw-JSON audit
  section("raw JSON audit (not just what a UI would render)");
  const battery = ["Quokka", "Marmot", "ZZ Search", "Ordr", "Zanzibar", "量子", "研究", "hidden", "secret", "Hidden", "Paper", "Project", "Group", "News", "Area", "e", "a", "the"];
  const guestBlob = [];
  for (const q of battery) for (const type of ["all", ...Object.keys(perType)]) guestBlob.push(JSON.stringify((await search(guest, { q, type, limit: "50" })).json));
  const blob = guestBlob.join("\n");
  const leaks = [...HIDDEN_IDS, ...HIDDEN_TEXT.filter((t) => t !== "LAB_ONLY"), "LAB_ONLY", "passwordHash", '"userId"', '"email"', '"isOwn"', '"slug"', '"visibility"'].filter((s) => blob.includes(s));
  check(`guest: ${guestBlob.length} raw responses hold no hidden id/name/slug/text, no visibility/slug/userId/email keys`, leaks.length === 0, leaks.join(" | "));
  check("guest: no account id and no account email anywhere", !accountIds.some((a) => blob.includes(a)) && !userEmails.some((e) => blob.includes(e)));
  const memberBlob = [];
  for (const q of battery) memberBlob.push(JSON.stringify((await search(memA.client, { q, limit: "50" })).json));
  const mb = memberBlob.join("\n");
  check("member: no visibility/slug/userId/email keys, no account ids (ordinary members never see visibility)", !/"(visibility|slug|userId|email|isOwn|passwordHash)"/.test(mb) && !accountIds.some((a) => mb.includes(a)));
  const mgrBlob = JSON.stringify((await search(mgr.client, { q: "Quokka" })).json) + JSON.stringify((await search(admin, { q: "Quokka" })).json);
  check("manager/admin: `visibility` only, still no slug/userId/email/account id", !/"(slug|userId|email|isOwn|passwordHash)"/.test(mgrBlob) && !accountIds.some((a) => mgrBlob.includes(a)));
  // Phase 20 legitimately adds ONE relationship channel, `related` (visible area/project/group links; see discovery-regression.mjs). Everything else stays forbidden, and each related entry may carry only type/id/title/href.
  check(
    "no result exposes relationship data except `related`: no group/project/member/author fields, no per-result counts, related entries have exactly type/id/title/href",
    !/"(members|authors|group|project|projectCount|memberCount|areas|publications)":/.test([...guestBlob, ...memberBlob].map((x) => JSON.stringify(JSON.parse(x).results)).join("\n")) &&
      [...guestBlob, ...memberBlob].every((x) => JSON.parse(x).results.every((r) => (r.related ?? []).every((e) => Object.keys(e).sort().join() === "href,id,title,type"))),
  );

  // ------------------------------------------------------------------ static
  section("static: one source of truth, no raw SQL, no second visibility system");
  const src = readFileSync(fileURLToPath(new URL("../src/lib/search.ts", import.meta.url)), "utf8");
  const route = readFileSync(fileURLToPath(new URL("../src/routes/search.routes.ts", import.meta.url)), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check("search.ts uses visibleTo() and visibilityField() from lib/visibility", /import\s*\{[^}]*\bvisibleTo\b[^}]*\}\s*from "\.\/visibility\.js"/.test(src) && /\bvisibilityField\b/.test(src));
  check("search.ts has no visibility literals (\"PUBLIC\"/\"LAB_ONLY\") and no role comparisons: it cannot drift from visibleTo", !/["'`](PUBLIC|LAB_ONLY|ADMIN|LAB_MANAGER|MEMBER)["'`]/.test(code) && !/\brole\s*[!=]==?\s*["']/.test(code));
  check("search.ts and the route use no raw SQL ($queryRaw, $executeRaw, Unsafe)", !/\$queryRaw|\$executeRaw|Unsafe|\$transaction\(\s*\[\s*prisma\.\$/.test(code + route));
  check("search.ts never selects or references userId / user / email / passwordHash", !/\buserId\b|\bemail\b|passwordHash|\buser:\s*(true|\{)/.test(code));
  check("the route takes the viewer from the session (optionalAuth) and reads only req.query", /optionalAuth/.test(route) && !/req\.body|req\.headers|req\.cookies|req\.params/.test(route) && /req\.user \?\? null/.test(route));
  check("the route validates with the shared schema before touching the database", /parseOrThrow\(searchQuerySchema, req\.query\)/.test(route));

  // ------------------------------------------------------------------ database untouched
  section("cleanup");
  await cleanup();
  const dbAfter = { users: await prisma.user.count(), team: await prisma.teamMember.count(), pubs: await prisma.publication.count(), news: await prisma.newsItem.count(), areas: await prisma.researchArea.count(), projects: await prisma.researchProject.count(), groups: await prisma.researchGroup.count() };
  check("after cleanup the row counts are back to what they were (search is read-only)", eq(dbBefore, dbAfter), JSON.stringify({ dbBefore, dbAfter }));
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: new Date(Date.now() - 120000) } } }).catch(() => {});

  console.log(`\n${passed} passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("Script crashed:", e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
