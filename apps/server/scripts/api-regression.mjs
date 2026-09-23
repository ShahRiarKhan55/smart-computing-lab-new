/**
 * End-to-end API regression check for the SCL server. Exercises the real HTTP
 * API (sessions, roles, validation, ownership rules) and, for the Phase 8
 * section, the database directly.
 *
 *   # terminal 1 (use a COPY of the database for anything write-heavy):
 *   DATABASE_URL=file:/abs/path/to/copy.db PORT=4011 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:/abs/path/to/copy.db API=http://localhost:4011 node scripts/api-regression.mjs
 *   SKIP_PHASE8=1 ...   # skip the Phase 8 + 9 + 9.1 sections (pre-Phase-8 schema)
 *   ONLY_PHASE91=1 ...  # skip the Phase 8 + 9 sections, run only 9.1 (used for mutation testing)
 *
 * Run it ONLY against a copy of the database: it removes every audit row written during the run.
 *
 * It creates temporary records prefixed "ZZ Test" / p8test-*@example.test and
 * removes them again (also at start, in case a previous run was interrupted).
 * It never touches rows it did not create.
 */
import { PrismaClient } from "@prisma/client";

const API = process.env.API || "http://localhost:4001";
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };
const PW = "Str0ngPassw0rd!";
const prisma = new PrismaClient();
/** Audit rows written from here on belong to this run (and are removed again at the end). */
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

/** Minimal fetch client with its own cookie jar (one per simulated browser). */
class Client {
  cookie = "";
  async req(method, path, body) {
    const res = await fetch(`${API}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const pair = c.split(";")[0];
      if (/^scl\.sid=;?$/.test(pair) || /Expires=Thu, 01 Jan 1970/i.test(c)) this.cookie = "";
      else if (pair.startsWith("scl.sid=")) this.cookie = pair;
    }
    const json = await res.json().catch(() => null);
    return { status: res.status, json, setCookie: set };
  }
  get = (p) => this.req("GET", p);
  post = (p, b) => this.req("POST", p, b ?? {});
  put = (p, b) => this.req("PUT", p, b ?? {});
  del = (p) => this.req("DELETE", p);
  async login(email, password) {
    return this.post("/auth/login", { email, password });
  }
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { OR: [{ email: { startsWith: "p8test-" } }, { email: { startsWith: "p9test-" } }] } }).catch(() => {});
  await prisma.researchProject.deleteMany({ where: { OR: [{ title: { contains: "ZZ Test" } }, { title: "量子計算テスト" }] } });
  await prisma.researchGroup.deleteMany({ where: { name: { contains: "ZZ Test" } } });
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: "ZZ Test" } } });
  await prisma.publication.deleteMany({ where: { title: { startsWith: "ZZ Test" } } });
  await prisma.newsItem.deleteMany({ where: { title: { startsWith: "ZZ Test" } } });
  await prisma.researchArea.deleteMany({ where: { title: { startsWith: "ZZ Test" } } });
}

async function main() {
  await cleanup();

  // ------------------------------------------------------------------
  section("health + guests");
  const guest = new Client();
  check("health 200", (await guest.get("/health")).json?.status === "ok");
  let r = await guest.get("/auth/me");
  check("guest /auth/me is 200 {user:null}", r.status === 200 && r.json?.user === null);
  check("guest GET /users 401", (await guest.get("/users")).status === 401);
  check("guest GET /profile 401", (await guest.get("/profile")).status === 401);
  check("guest POST /research 401", (await guest.post("/research", {})).status === 401);
  check("guest POST /publications 401", (await guest.post("/publications", {})).status === 401);
  check("guest POST /news 401", (await guest.post("/news", {})).status === 401);
  check("guest POST /team 401", (await guest.post("/team", {})).status === 401);
  check("unknown /api route 404", (await guest.get("/nope")).status === 404);
  const bad = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
  check("malformed JSON body 400", bad.status === 400);

  // ------------------------------------------------------------------
  section("authentication + sessions");
  check("login wrong password 401", (await guest.login(ADMIN.email, "wrong-password")).status === 401);
  check("login unknown email 401", (await guest.login("nobody@example.test", "whatever123")).status === 401);
  check("login missing fields 400", (await guest.post("/auth/login", {})).status === 400);
  const admin = new Client();
  r = await admin.login(ADMIN.email, ADMIN.password);
  check("admin login 200 role ADMIN", r.status === 200 && r.json?.user?.role === "ADMIN");
  check("session cookie is HttpOnly + SameSite=Lax", /HttpOnly/i.test(r.setCookie.join(";")) && /SameSite=Lax/i.test(r.setCookie.join(";")));
  check("login response has no passwordHash", !JSON.stringify(r.json).includes("passwordHash"));
  r = await admin.get("/auth/me");
  check("/auth/me returns admin", r.json?.user?.email === ADMIN.email);
  const staleCookie = admin.cookie;
  const adminId = r.json.user.id;
  check("logout 200", (await admin.post("/auth/logout")).json?.success === true);
  const replay = new Client();
  replay.cookie = staleCookie;
  check("logged-out session id no longer authenticates", (await replay.get("/auth/me")).json?.user === null);
  check("re-login works", (await admin.login(ADMIN.email, ADMIN.password)).status === 200);

  // ------------------------------------------------------------------
  section("users (admin)");
  r = await admin.get("/users");
  check("admin GET /users 200 array", r.status === 200 && Array.isArray(r.json));
  check("users list has no passwordHash", !JSON.stringify(r.json).includes("passwordHash"));
  const memEmail = "p8test-member@example.test";
  r = await admin.post("/users", { email: memEmail, password: PW, name: "ZZ Test Member", initials: "ZM", memberRole: "MSc Researcher", category: "MSC" });
  check("create member login + new profile 201", r.status === 201 && r.json?.role === "MEMBER", JSON.stringify(r.json));
  const memberUserId = r.json?.id;
  check("duplicate email 409", (await admin.post("/users", { email: memEmail.toUpperCase(), password: PW })).status === 409);
  check("short password 400", (await admin.post("/users", { email: "p8test-short@example.test", password: "short" })).status === 400);
  check("partial new-member fields 400", (await admin.post("/users", { email: "p8test-partial@example.test", password: PW, name: "ZZ Test X" })).status === 400);
  check("teamMemberId + new fields 400", (await admin.post("/users", { email: "p8test-both@example.test", password: PW, teamMemberId: "abc", name: "ZZ Test Y", initials: "Y", memberRole: "r", category: "MSC" })).status === 400);
  check("link nonexistent team member 400", (await admin.post("/users", { email: "p8test-nolink@example.test", password: PW, teamMemberId: "doesnotexist" })).status === 400);
  const seedMembers = (await guest.get("/team")).json;
  check("GET /team public list", Array.isArray(seedMembers) && seedMembers.length >= 7);
  // The public API no longer exposes account ids (Phase 9.1), so link state is read from the database.
  const linked = await prisma.teamMember.findFirst({ where: { userId: { not: null } } });
  const unlinkedSeed = await prisma.teamMember.findFirst({ where: { userId: null, NOT: { name: { startsWith: "ZZ Test" } } } });
  check("cannot claim an already-linked team member 409", linked ? (await admin.post("/users", { email: "p8test-dup@example.test", password: PW, teamMemberId: linked.id })).status === 409 : true);
  check("role change 200", (await admin.put(`/users/${memberUserId}`, { role: "ADMIN" })).status === 200);
  check("invalid role 400", (await admin.put(`/users/${memberUserId}`, { role: "SUPERUSER" })).status === 400);
  check("cannot change own role 400", (await admin.put(`/users/${adminId}`, { role: "MEMBER" })).status === 400);
  check("cannot delete self 400", (await admin.del(`/users/${adminId}`)).status === 400);
  check("bad id 400", (await admin.put("/users/bad!id", { role: "MEMBER" })).status === 400);
  check("unknown user PUT 404", (await admin.put("/users/nonexistentid", { role: "MEMBER" })).status === 404);
  check("unknown user DELETE 404", (await admin.del("/users/nonexistentid")).status === 404);
  check("demote back to MEMBER", (await admin.put(`/users/${memberUserId}`, { role: "MEMBER" })).status === 200);

  // Role changes take effect immediately on an existing session.
  const member = new Client();
  check("member login 200", (await member.login(memEmail, PW)).status === 200);
  check("member GET /users 403", (await member.get("/users")).status === 403);
  await admin.put(`/users/${memberUserId}`, { role: "ADMIN" });
  check("promotion applies to live session", (await member.get("/users")).status === 200);
  await admin.put(`/users/${memberUserId}`, { role: "MEMBER" });
  check("demotion applies to live session", (await member.get("/users")).status === 403);

  // ------------------------------------------------------------------
  section("profile + team");
  r = await member.get("/profile");
  check("member GET /profile 200 own", r.status === 200 && r.json?.name === "ZZ Test Member");
  const myTm = r.json?.id;
  check("member PUT /profile 200", (await member.put("/profile", { bio: "hello" })).json?.bio === "hello");
  check("member PUT /profile cannot set category", (await member.put("/profile", { category: "FACULTY", bio: "x" })).json?.category === "MSC");
  check("empty profile update 400", (await member.put("/profile", {})).status === 400);
  check("bad photo url 400", (await member.put("/profile", { photoUrl: "javascript:alert(1)" })).status === 400);
  check("member PUT own /team/:id 200", (await member.put(`/team/${myTm}`, { department: "Vision" })).status === 200);
  check("member PUT own /team/:id cannot change category", (await member.put(`/team/${myTm}`, { category: "FACULTY" })).json?.category === "MSC");
  check("member PUT other /team/:id 403", (await member.put(`/team/${unlinkedSeed.id}`, { bio: "hax" })).status === 403);
  check("member PUT nonexistent /team/:id 403 (no probing)", (await member.put("/team/nonexistentid", { bio: "x" })).status === 403);
  check("member POST /team 403", (await member.post("/team", { name: "ZZ Test N", initials: "N", role: "r", category: "MSC" })).status === 403);
  check("member DELETE /team 403", (await member.del(`/team/${myTm}`)).status === 403);
  r = await admin.post("/team", { name: "ZZ Test Person", initials: "ZP", role: "Research Student", category: "RESEARCH", sortOrder: 99 });
  check("admin POST /team 201 (new profile is nobody's own, no account id)", r.status === 201 && r.json?.isOwn === false && !("userId" in r.json));
  const tmpTm = r.json?.id;
  check("team validation: bad category 400", (await admin.post("/team", { name: "ZZ Test V", initials: "V", role: "r", category: "NOPE" })).status === 400);
  check("team validation: whitespace name 400", (await admin.post("/team", { name: "   ", initials: "V", role: "r", category: "MSC" })).status === 400);
  check("GET /team/:id public", (await guest.get(`/team/${tmpTm}`)).json?.name === "ZZ Test Person");
  check("GET /team/:id 404", (await guest.get("/team/nonexistentid")).status === 404);
  check("admin PUT /team/:id 200", (await admin.put(`/team/${tmpTm}`, { sortOrder: 98, category: "BSC" })).json?.category === "BSC");
  check("profile 404 for account without team profile", await (async () => {
    await admin.post("/users", { email: "p8test-nolinked@example.test", password: PW });
    const c = new Client();
    await c.login("p8test-nolinked@example.test", PW);
    return (await c.get("/profile")).status === 404;
  })());

  // ------------------------------------------------------------------
  section("member history + links");
  r = await member.post(`/member/${myTm}/history`, { year: "2024", title: "ZZ Test history", description: "d" });
  check("member POST own history 201", r.status === 201);
  const hid = r.json?.id;
  check("member PUT own history 200", (await member.put(`/member/${myTm}/history/${hid}`, { title: "ZZ Test history 2" })).json?.title === "ZZ Test history 2");
  check("member POST other's history 403", (await member.post(`/member/${tmpTm}/history`, { year: "2024", title: "x" })).status === 403);
  check("history missing title 400", (await member.post(`/member/${myTm}/history`, { year: "2024" })).status === 400);
  check("history entry of another member 404", (await admin.put(`/member/${tmpTm}/history/${hid}`, { title: "x" })).status === 404);
  check("GET /member/:id public with history", (await guest.get(`/member/${myTm}`)).json?.history?.length === 1);
  check("GET /member/:id 404", (await guest.get("/member/nonexistentid")).status === 404);

  // ------------------------------------------------------------------
  section("research");
  check("GET /research public", Array.isArray((await guest.get("/research")).json));
  r = await member.post("/research", { title: "ZZ Test Area", description: "d", tag: "T", icon: "  ", sortOrder: 50 });
  check("member POST /research 201 (any user, like reference)", r.status === 201 && r.json?.icon === "🔬");
  const raId = r.json?.id;
  check("research missing title 400", (await member.post("/research", { description: "d", tag: "t" })).status === 400);
  check("research whitespace-only 400", (await member.post("/research", { title: "  ", description: "d", tag: "t" })).status === 400);
  check("member PUT /research/:id 200", (await member.put(`/research/${raId}`, { title: "ZZ Test Area 2" })).json?.title === "ZZ Test Area 2");
  check("GET /research/:id public", (await guest.get(`/research/${raId}`)).status === 200);
  check("GET /research/bad!id 400", (await guest.get("/research/bad!id")).status === 400);
  check("member DELETE /research 403", (await member.del(`/research/${raId}`)).status === 403);
  check("admin DELETE /research 200", (await admin.del(`/research/${raId}`)).json?.success === true);
  check("deleted research 404", (await guest.get(`/research/${raId}`)).status === 404);

  // ------------------------------------------------------------------
  section("publications + author links");
  r = await member.post("/publications", { year: "2024", title: "ZZ Test Paper", authors: "A, B", venue: "V", teamMemberIds: [myTm] });
  check("member POST /publications with self link 201", r.status === 201 && r.json?.year === 2024);
  const pubId = r.json?.id;
  check("publication bad year 400", (await member.post("/publications", { year: "abcd", title: "ZZ Test", authors: "a", venue: "v" })).status === 400);
  check("publication bad url 400", (await member.post("/publications", { year: 2024, title: "ZZ Test", authors: "a", venue: "v", pdfUrl: "ftp://x" })).status === 400);
  check("GET /publications/:id/authors public", (await guest.get(`/publications/${pubId}/authors`)).json?.teamMemberIds?.[0] === myTm);
  check("member cannot add another author 403", (await member.put(`/publications/${pubId}/authors`, { teamMemberIds: [myTm, tmpTm] })).status === 403);
  check("admin can set authors", (await admin.put(`/publications/${pubId}/authors`, { teamMemberIds: [myTm, tmpTm] })).json?.teamMemberIds?.length === 2);
  check("member cannot remove someone else's link 403", (await member.put(`/publications/${pubId}/authors`, { teamMemberIds: [myTm] })).status === 403);
  check("member may remove only self", (await member.put(`/publications/${pubId}/authors`, { teamMemberIds: [tmpTm] })).json?.teamMemberIds?.[0] === tmpTm);
  check("duplicate author ids 400", (await admin.put(`/publications/${pubId}/authors`, { teamMemberIds: [tmpTm, tmpTm] })).status === 400);
  check("nonexistent author 400", (await admin.put(`/publications/${pubId}/authors`, { teamMemberIds: ["nonexistentid"] })).status === 400);
  check("member PUT /publications/:id 200", (await member.put(`/publications/${pubId}`, { venue: "V2" })).json?.venue === "V2");
  check("publications list ordered year desc", (await guest.get("/publications")).json?.every((p, i, a) => i === 0 || a[i - 1].year >= p.year));
  check("member DELETE /publications 403", (await member.del(`/publications/${pubId}`)).status === 403);
  const memberLinkPub = await member.put(`/member/${myTm}/publications`, { publicationIds: [pubId] });
  check("member PUT own /member/:id/publications 200", memberLinkPub.status === 200);
  check("member PUT other's /member/:id/publications 403", (await member.put(`/member/${tmpTm}/publications`, { publicationIds: [] })).status === 403);
  check("link nonexistent publication 400", (await member.put(`/member/${myTm}/publications`, { publicationIds: ["nonexistentid"] })).status === 400);
  check("member profile shows linked publication", (await guest.get(`/member/${myTm}`)).json?.publications?.some((p) => p.id === pubId));

  // ------------------------------------------------------------------
  section("news + author links");
  r = await member.post("/news", { date: "Jan 2025", sortDate: "2025-01-15", type: "Award", title: "ZZ Test News", description: "d", teamMemberIds: [myTm] });
  check("member POST /news 201, blank emoji defaults", r.status === 201 && r.json?.emoji === "📣");
  const newsId = r.json?.id;
  check("news bad sortDate 400", (await member.post("/news", { date: "x", sortDate: "2025-02-30", type: "Paper", title: "ZZ Test", description: "d" })).status === 400);
  check("news list ordered sortDate desc", (await guest.get("/news")).json?.every((n, i, a) => i === 0 || a[i - 1].sortDate >= n.sortDate));
  check("GET /news/:id/authors public", (await guest.get(`/news/${newsId}/authors`)).json?.teamMemberIds?.[0] === myTm);
  check("member cannot add another news author 403", (await member.put(`/news/${newsId}/authors`, { teamMemberIds: [myTm, tmpTm] })).status === 403);
  check("admin sets news authors", (await admin.put(`/news/${newsId}/authors`, { teamMemberIds: [tmpTm] })).json?.teamMemberIds?.[0] === tmpTm);
  check("member PUT /news/:id 200", (await member.put(`/news/${newsId}`, { title: "ZZ Test News 2" })).json?.title === "ZZ Test News 2");
  check("member DELETE /news 403", (await member.del(`/news/${newsId}`)).status === 403);
  check("member PUT own /member/:id/news 200", (await member.put(`/member/${myTm}/news`, { newsIds: [newsId] })).status === 200);
  check("member profile shows linked news", (await guest.get(`/member/${myTm}`)).json?.news?.some((n) => n.id === newsId));

  // ------------------------------------------------------------------
  section("cascade + deletion semantics");
  check("admin DELETE /publications 200", (await admin.del(`/publications/${pubId}`)).json?.success === true);
  check("publication links cascaded", (await prisma.publicationAuthor.count({ where: { publicationId: pubId } })) === 0);
  check("admin DELETE /news 200", (await admin.del(`/news/${newsId}`)).json?.success === true);
  check("news links cascaded", (await prisma.newsAuthor.count({ where: { newsItemId: newsId } })) === 0);
  check("admin DELETE /team/:id 200", (await admin.del(`/team/${tmpTm}`)).json?.success === true);
  check("deleted team member 404", (await guest.get(`/team/${tmpTm}`)).status === 404);
  const before = await prisma.teamMember.findUnique({ where: { id: myTm } });
  check("account deletion keeps + unlinks profile", (await admin.del(`/users/${memberUserId}`)).json?.success === true && (await prisma.teamMember.findUnique({ where: { id: myTm } }))?.userId === null && before?.userId === memberUserId);
  check("deleted user's live session is dead", (await member.get("/auth/me")).json?.user === null);

  if (!process.env.SKIP_PHASE8) {
    if (!process.env.ONLY_PHASE91) {
      await phase8(admin, guest);
      await phase9(admin, guest);
    }
    await phase91(admin, guest);
  }

  await cleanup();
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: RUN_STARTED } } }).catch(() => {});
  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exitCode = 1;
  }
}

/** Phase 8: visibility fail-closed behaviour + audit log. */
async function phase8(admin, guest) {
  section("phase 8: schema + defaults");
  const migs = await prisma.$queryRawUnsafe("select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null");
  check("phase 8 migration applied", migs.some((m) => /phase8/.test(m.migration_name)));
  for (const t of ["NewsItem", "Publication", "ResearchArea"]) {
    const rows = await prisma.$queryRawUnsafe(`select count(*) as n from "${t}" where visibility <> 'PUBLIC'`);
    check(`${t}: every pre-existing row is PUBLIC`, Number(rows[0].n) === 0);
  }
  for (const t of ["ResearchProject", "Event", "ForumCategory", "ForumPost", "Conversation", "Message", "Notification", "StoredFile", "Translation"]) {
    const rows = await prisma.$queryRawUnsafe(`select count(*) as n from "${t}"`);
    check(`${t} table exists and is empty`, Number(rows[0].n) === 0);
  }

  section("phase 8: LAB_ONLY never reaches guests");
  const memEmail = "p8test-viewer@example.test";
  await admin.post("/users", { email: memEmail, password: PW, name: "ZZ Test Viewer", initials: "ZV", memberRole: "MSc Researcher", category: "MSC" });
  const viewer = new Client();
  await viewer.login(memEmail, PW);
  const tm = await prisma.teamMember.findFirst({ where: { name: "ZZ Test Viewer" } });

  const pubOpen = await prisma.publication.create({ data: { year: 2030, title: "ZZ Test open pub", authors: "a", venue: "v" } });
  const pubHidden = await prisma.publication.create({ data: { year: 2030, title: "ZZ Test hidden pub", authors: "a", venue: "v", visibility: "LAB_ONLY" } });
  const newsOpen = await prisma.newsItem.create({ data: { dateLabel: "x", sortDate: "2099-01-01", type: "Paper", title: "ZZ Test open news", description: "d" } });
  const newsHidden = await prisma.newsItem.create({ data: { dateLabel: "x", sortDate: "2099-01-02", type: "Paper", title: "ZZ Test hidden news", description: "d", visibility: "LAB_ONLY" } });
  const areaOpen = await prisma.researchArea.create({ data: { title: "ZZ Test open area", description: "d", tag: "t" } });
  const areaHidden = await prisma.researchArea.create({ data: { title: "ZZ Test hidden area", description: "d", tag: "t", visibility: "LAB_ONLY" } });
  await prisma.publicationAuthor.createMany({ data: [pubOpen, pubHidden].map((p) => ({ publicationId: p.id, teamMemberId: tm.id })) });
  await prisma.newsAuthor.createMany({ data: [newsOpen, newsHidden].map((n) => ({ newsItemId: n.id, teamMemberId: tm.id })) });

  const ids = (res) => (Array.isArray(res.json) ? res.json.map((x) => x.id) : []);
  for (const who of [["guest", guest], ["stale-cookie guest", Object.assign(new Client(), { cookie: "scl.sid=s%3Astale.invalid" })]]) {
    const [label, c] = who;
    let res = await c.get("/publications");
    check(`${label}: /publications lists open, not hidden`, ids(res).includes(pubOpen.id) && !ids(res).includes(pubHidden.id));
    check(`${label}: /publications/:id hidden -> 404`, (await c.get(`/publications/${pubHidden.id}`)).status === 404);
    check(`${label}: /publications/:id open -> 200`, (await c.get(`/publications/${pubOpen.id}`)).status === 200);
    check(`${label}: /publications/:id/authors hidden -> 404`, (await c.get(`/publications/${pubHidden.id}/authors`)).status === 404);
    res = await c.get("/news");
    check(`${label}: /news lists open, not hidden`, ids(res).includes(newsOpen.id) && !ids(res).includes(newsHidden.id));
    check(`${label}: /news/:id hidden -> 404`, (await c.get(`/news/${newsHidden.id}`)).status === 404);
    check(`${label}: /news/:id/authors hidden -> 404`, (await c.get(`/news/${newsHidden.id}/authors`)).status === 404);
    res = await c.get("/research");
    check(`${label}: /research lists open, not hidden`, ids(res).includes(areaOpen.id) && !ids(res).includes(areaHidden.id));
    check(`${label}: /research/:id hidden -> 404`, (await c.get(`/research/${areaHidden.id}`)).status === 404);
    res = await c.get(`/member/${tm.id}`);
    check(`${label}: /member/:id hides linked LAB_ONLY publication+news`, res.status === 200 && res.json.publications.map((p) => p.id).join() === pubOpen.id && res.json.news.map((n) => n.id).join() === newsOpen.id);
  }
  for (const [label, c] of [["member", viewer], ["admin", admin]]) {
    check(`${label}: sees hidden publication in list`, ids(await c.get("/publications")).includes(pubHidden.id));
    check(`${label}: sees hidden publication by id`, (await c.get(`/publications/${pubHidden.id}`)).status === 200);
    check(`${label}: sees hidden news in list + by id`, ids(await c.get("/news")).includes(newsHidden.id) && (await c.get(`/news/${newsHidden.id}`)).status === 200);
    check(`${label}: sees hidden research in list + by id`, ids(await c.get("/research")).includes(areaHidden.id) && (await c.get(`/research/${areaHidden.id}`)).status === 200);
    const prof = await c.get(`/member/${tm.id}`);
    check(`${label}: /member/:id includes LAB_ONLY links`, prof.json?.publications?.length === 2 && prof.json?.news?.length === 2);
  }
  check("API never exposes a visibility field (response shape unchanged)", !JSON.stringify((await guest.get("/publications")).json).includes("visibility"));
  // Phase 9 change: visibility is now settable, but only by lab managers/admins. A plain member
  // who sends it is refused outright (403), not silently ignored, and nothing is created.
  check("a plain member cannot set visibility (403, nothing created)", await (async () => {
    const res = await viewer.post("/news", { date: "x", sortDate: "2099-01-03", type: "Paper", title: "ZZ Test sneaky", description: "d", visibility: "LAB_ONLY" });
    return res.status === 403 && (await prisma.newsItem.count({ where: { title: "ZZ Test sneaky" } })) === 0;
  })());

  section("phase 8: audit log");
  await prisma.auditLog.deleteMany({ where: { entityType: "USER", details: { contains: "p8test-audit" } } });
  const email = "p8test-audit@example.test";
  const created = await admin.post("/users", { email, password: PW });
  await admin.put(`/users/${created.json.id}`, { role: "ADMIN" });
  await admin.del(`/users/${created.json.id}`);
  const rows = await prisma.auditLog.findMany({ where: { entityType: "USER", entityId: created.json.id }, orderBy: { createdAt: "asc" } });
  check("audit: USER_CREATED, ROLE_CHANGED, USER_DELETED recorded in order", rows.map((x) => x.action).join() === "USER_CREATED,ROLE_CHANGED,USER_DELETED", rows.map((x) => x.action).join());
  const me = (await admin.get("/auth/me")).json.user;
  check("audit: actor id + email snapshot recorded", rows.length === 3 && rows.every((x) => x.actorId === me.id && x.actorEmail === me.email));
  check("audit: ROLE_CHANGED carries from/to", (() => { const d = JSON.parse(rows[1]?.details ?? "{}"); return d.from === "MEMBER" && d.to === "ADMIN"; })());
  check("audit: details never contain password material", rows.length === 3 && rows.every((x) => !/password|hash|\$2[aby]\$/i.test(x.details ?? "")));
  const failedRole = await admin.put(`/users/${me.id}`, { role: "MEMBER" });
  check("audit: rejected self-role-change writes no audit row", failedRole.status === 400 && (await prisma.auditLog.count({ where: { entityId: me.id, action: "ROLE_CHANGED" } })) === 0);

  await prisma.auditLog.deleteMany({ where: { entityType: "USER", entityId: created.json.id } });
  await prisma.auditLog.deleteMany({ where: { entityType: "USER", details: { contains: "p8test-" } } });
}

/**
 * Phase 9: LAB_MANAGER + role rules, admin-settable visibility, audit wiring,
 * research projects, research groups, profile integration, security.
 */
async function phase9(admin, guest) {
  const idsOf = (res) => (Array.isArray(res.json) ? res.json.map((x) => x.id) : []);
  const noVis = (res) => !JSON.stringify(res.json).includes('"visibility"');
  const auditFor = (entityType, entityId) => prisma.auditLog.findMany({ where: { entityType, entityId } });
  const actions = async (entityType, entityId) => (await auditFor(entityType, entityId)).map((a) => a.action);
  const detailsOf = (row) => JSON.parse(row?.details ?? "{}");
  const adminMe = (await admin.get("/auth/me")).json.user;

  // ------------------------------------------------------------------
  section("phase 9: accounts, roles, LAB_MANAGER");
  const mk = async (key, role, name) => {
    const email = `p9test-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "ZT", memberRole: "MSc Researcher", category: "MSC" });
    const client = new Client();
    await client.login(email, PW);
    const tm = await prisma.teamMember.findFirst({ where: { name } });
    return { client, id: r.json?.id, email, tm, status: r.status };
  };
  const mgr = await mk("manager", "LAB_MANAGER", "ZZ Test Manager");
  const mem = await mk("member", "MEMBER", "ZZ Test P9 Member");
  const lead = await mk("lead", "MEMBER", "ZZ Test Lead");
  const other = await mk("other", "MEMBER", "ZZ Test Other");
  check("admin can create a LAB_MANAGER account", mgr.status === 201);
  check("/auth/me reports LAB_MANAGER", (await mgr.client.get("/auth/me")).json?.user?.role === "LAB_MANAGER");
  check("unknown role rejected on account creation", (await admin.post("/users", { email: "p9test-bad@example.test", password: PW, role: "SUPERUSER" })).status === 400);
  check("LAB_MANAGER cannot list accounts", (await mgr.client.get("/users")).status === 403);
  check("LAB_MANAGER cannot create accounts", (await mgr.client.post("/users", { email: "p9test-x@example.test", password: PW })).status === 403);
  check("LAB_MANAGER cannot grant ADMIN", (await mgr.client.put(`/users/${mem.id}`, { role: "ADMIN" })).status === 403);
  check("LAB_MANAGER cannot promote themselves", (await mgr.client.put(`/users/${mgr.id}`, { role: "ADMIN" })).status === 403);
  check("LAB_MANAGER cannot delete accounts", (await mgr.client.del(`/users/${mem.id}`)).status === 403);
  check("MEMBER cannot self-promote to ADMIN", (await mem.client.put(`/users/${mem.id}`, { role: "ADMIN" })).status === 403);
  check("MEMBER cannot self-promote to LAB_MANAGER", (await mem.client.put(`/users/${mem.id}`, { role: "LAB_MANAGER" })).status === 403);
  check("MEMBER cannot change anyone's role", (await mem.client.put(`/users/${mgr.id}`, { role: "MEMBER" })).status === 403);
  check("MEMBER cannot list accounts", (await mem.client.get("/users")).status === 403);
  check("roles unchanged after every rejected attempt", (await prisma.user.findUnique({ where: { id: mem.id } })).role === "MEMBER" && (await prisma.user.findUnique({ where: { id: mgr.id } })).role === "LAB_MANAGER");
  check("guest cannot touch accounts (401)", (await guest.put(`/users/${mem.id}`, { role: "ADMIN" })).status === 401);
  check("admin cannot change own role (400)", (await admin.put(`/users/${adminMe.id}`, { role: "LAB_MANAGER" })).status === 400);
  check("admin cannot delete self (400)", (await admin.del(`/users/${adminMe.id}`)).status === 400);
  check("invalid role on change -> 400", (await admin.put(`/users/${mem.id}`, { role: "SUPERUSER" })).status === 400);
  check("admin promotes MEMBER -> LAB_MANAGER", (await admin.put(`/users/${other.id}`, { role: "LAB_MANAGER" })).status === 200);
  check("promotion takes effect on the live session", (await other.client.post("/groups", { name: "ZZ Test live role" })).status === 201);
  check("admin demotes back to MEMBER", (await admin.put(`/users/${other.id}`, { role: "MEMBER" })).status === 200);
  check("demotion takes effect on the live session", (await other.client.post("/groups", { name: "ZZ Test live role 2" })).status === 403);
  const roleRows = (await prisma.auditLog.findMany({ where: { entityType: "USER", entityId: other.id, action: "ROLE_CHANGED" } })).map(detailsOf);
  check("audit: both role changes recorded with from/to", roleRows.some((d) => d.from === "MEMBER" && d.to === "LAB_MANAGER") && roleRows.some((d) => d.from === "LAB_MANAGER" && d.to === "MEMBER"));
  await prisma.user.update({ where: { id: other.id }, data: { role: "SUPERUSER" } });
  check("unknown role in the DB is treated as plain MEMBER (session)", (await other.client.get("/auth/me")).json?.user?.role === "MEMBER");
  check("unknown role gets no manager powers", (await other.client.post("/groups", { name: "ZZ Test rogue" })).status === 403 && (await other.client.get("/users")).status === 403);
  await prisma.user.update({ where: { id: other.id }, data: { role: "MEMBER" } });

  // ------------------------------------------------------------------
  section("phase 9: visibility is settable, but only by managers");
  const mkArea = (c, title, extra = {}) => c.post("/research", { title, description: "d", tag: "t", ...extra });
  const mkPub = (c, title, extra = {}) => c.post("/publications", { year: 2031, title, authors: "a", venue: "v", ...extra });
  const mkNews = (c, title, extra = {}) => c.post("/news", { date: "x", sortDate: "2099-02-01", type: "Paper", title, description: "d", ...extra });

  const areaPub = (await mkArea(admin, "ZZ Test P9 area public")).json;
  const areaHid = (await mkArea(mgr.client, "ZZ Test P9 area hidden", { visibility: "LAB_ONLY" })).json;
  const pubOpen = (await mkPub(mem.client, "ZZ Test P9 pub open")).json;
  const pubHid = (await mkPub(mgr.client, "ZZ Test P9 pub hidden", { visibility: "LAB_ONLY" })).json;
  const newsOpen = (await mkNews(mem.client, "ZZ Test P9 news open")).json;
  const newsHid = (await mkNews(admin, "ZZ Test P9 news hidden", { visibility: "LAB_ONLY" })).json;
  check("LAB_MANAGER can create LAB_ONLY research area", areaHid?.visibility === "LAB_ONLY");
  check("LAB_MANAGER can create LAB_ONLY publication", pubHid?.visibility === "LAB_ONLY");
  check("ADMIN can create LAB_ONLY news", newsHid?.visibility === "LAB_ONLY");
  check("member-created content defaults to PUBLIC (unchanged behaviour)", (await prisma.publication.findUnique({ where: { id: pubOpen.id } })).visibility === "PUBLIC" && (await prisma.newsItem.findUnique({ where: { id: newsOpen.id } })).visibility === "PUBLIC");

  for (const [what, post, table, titleKey] of [
    ["research area", () => mkArea(mem.client, "ZZ Test P9 sneaky", { visibility: "LAB_ONLY" }), "researchArea", "title"],
    ["publication", () => mkPub(mem.client, "ZZ Test P9 sneaky", { visibility: "LAB_ONLY" }), "publication", "title"],
    ["news", () => mkNews(mem.client, "ZZ Test P9 sneaky", { visibility: "LAB_ONLY" }), "newsItem", "title"],
  ]) {
    const res = await post();
    check(`MEMBER cannot set visibility when creating a ${what} (403)`, res.status === 403, String(res.status));
    check(`...and nothing was created (${what})`, (await prisma[table].count({ where: { [titleKey]: "ZZ Test P9 sneaky" } })) === 0);
  }
  check("MEMBER cannot change publication visibility (403)", (await mem.client.put(`/publications/${pubOpen.id}`, { visibility: "LAB_ONLY" })).status === 403);
  check("MEMBER cannot change news visibility (403)", (await mem.client.put(`/news/${newsOpen.id}`, { visibility: "LAB_ONLY" })).status === 403);
  check("MEMBER cannot change research visibility (403)", (await mem.client.put(`/research/${areaPub.id}`, { visibility: "LAB_ONLY" })).status === 403);
  check("a forbidden mixed update changes nothing (venue untouched)", (await mem.client.put(`/publications/${pubOpen.id}`, { venue: "CHANGED", visibility: "PUBLIC" })).status === 403 && (await prisma.publication.findUnique({ where: { id: pubOpen.id } })).venue === "v");
  check("MEMBER may still edit ordinary fields", (await mem.client.put(`/publications/${pubOpen.id}`, { venue: "v2" })).json?.venue === "v2");
  check("guest cannot set visibility (401)", (await guest.put(`/publications/${pubOpen.id}`, { visibility: "LAB_ONLY" })).status === 401);
  check("invalid visibility value -> 400 (manager)", (await mgr.client.put(`/publications/${pubOpen.id}`, { visibility: "SECRET" })).status === 400);
  check("invalid visibility value -> 400 (member)", (await mem.client.put(`/publications/${pubOpen.id}`, { visibility: "SECRET" })).status === 400);
  check("lowercase visibility -> 400", (await mgr.client.put(`/news/${newsOpen.id}`, { visibility: "public" })).status === 400);
  check("null visibility -> 400", (await mgr.client.put(`/news/${newsOpen.id}`, { visibility: null })).status === 400);

  for (const [label, c, sees, sawField] of [["guest", guest, false, false], ["MEMBER", mem.client, true, false], ["LAB_MANAGER", mgr.client, true, true], ["ADMIN", admin, true, true]]) {
    const pubs = await c.get("/publications"), news = await c.get("/news"), areas = await c.get("/research");
    check(`${label}: hidden publication/news/area listing = ${sees}`, idsOf(pubs).includes(pubHid.id) === sees && idsOf(news).includes(newsHid.id) === sees && idsOf(areas).includes(areaHid.id) === sees);
    const statuses = [(await c.get(`/publications/${pubHid.id}`)).status, (await c.get(`/news/${newsHid.id}`)).status, (await c.get(`/research/${areaHid.id}`)).status, (await c.get(`/publications/${pubHid.id}/authors`)).status, (await c.get(`/news/${newsHid.id}/authors`)).status];
    check(`${label}: hidden items by id -> ${sees ? "200" : "404"}`, statuses.every((s) => s === (sees ? 200 : 404)), statuses.join());
    check(`${label}: ${sawField ? "receives" : "never receives"} the visibility field`, sawField ? JSON.stringify(pubs.json).includes('"visibility":"LAB_ONLY"') : noVis(pubs) && noVis(news) && noVis(areas));
  }
  check("hidden item 404 body reveals nothing", JSON.stringify((await guest.get(`/publications/${pubHid.id}`)).json) === JSON.stringify({ error: "Not found" }));
  check("hidden and missing ids are indistinguishable to a guest", JSON.stringify((await guest.get(`/news/${newsHid.id}`)).json) === JSON.stringify((await guest.get("/news/doesnotexist")).json));

  const flip = await mgr.client.put(`/publications/${pubOpen.id}`, { visibility: "LAB_ONLY" });
  check("LAB_MANAGER can hide a public publication", flip.status === 200 && flip.json?.visibility === "LAB_ONLY");
  check("...guest immediately loses it", (await guest.get(`/publications/${pubOpen.id}`)).status === 404 && !idsOf(await guest.get("/publications")).includes(pubOpen.id));
  check("ADMIN can publish it again", (await admin.put(`/publications/${pubOpen.id}`, { visibility: "PUBLIC" })).json?.visibility === "PUBLIC");
  check("...guest sees it again", (await guest.get(`/publications/${pubOpen.id}`)).status === 200);
  const vrows = (await prisma.auditLog.findMany({ where: { entityType: "PUBLICATION", entityId: pubOpen.id, action: "CONTENT_VISIBILITY_CHANGED" } })).map((r) => ({ ...detailsOf(r), actor: r.actorId }));
  check("audit: both visibility changes recorded (from/to + actor)", vrows.length === 2 && vrows.some((v) => v.from === "PUBLIC" && v.to === "LAB_ONLY" && v.actor === mgr.id) && vrows.some((v) => v.from === "LAB_ONLY" && v.to === "PUBLIC" && v.actor === adminMe.id));
  check("no-op visibility (same value) writes no visibility audit row", (await mgr.client.put(`/publications/${pubOpen.id}`, { visibility: "PUBLIC" })).status === 200 && (await prisma.auditLog.count({ where: { entityType: "PUBLICATION", entityId: pubOpen.id, action: "CONTENT_VISIBILITY_CHANGED" } })) === 2);

  // ------------------------------------------------------------------
  section("phase 9: deletion + team-management policy");
  const pubDel = (await mkPub(mem.client, "ZZ Test P9 del pub")).json, newsDel = (await mkNews(mem.client, "ZZ Test P9 del news")).json, areaDel = (await mkArea(mem.client, "ZZ Test P9 del area")).json;
  check("MEMBER cannot delete publication/news/area (403)", [(await mem.client.del(`/publications/${pubDel.id}`)).status, (await mem.client.del(`/news/${newsDel.id}`)).status, (await mem.client.del(`/research/${areaDel.id}`)).status].every((s) => s === 403));
  check("guest cannot delete (401)", (await guest.del(`/news/${newsDel.id}`)).status === 401);
  check("LAB_MANAGER can delete publication/news/area", [(await mgr.client.del(`/publications/${pubDel.id}`)).status, (await mgr.client.del(`/news/${newsDel.id}`)).status, (await mgr.client.del(`/research/${areaDel.id}`)).status].every((s) => s === 200));
  check("audit: *_DELETED recorded with the manager as actor", (await prisma.auditLog.count({ where: { action: { in: ["PUBLICATION_DELETED", "NEWS_DELETED", "RESEARCH_DELETED"] }, entityId: { in: [pubDel.id, newsDel.id, areaDel.id] }, actorId: mgr.id } })) === 3);

  const tmNew = await mgr.client.post("/team", { name: "ZZ Test P9 New Person", initials: "NP", role: "Research Student", category: "RESEARCH" });
  check("LAB_MANAGER can create a team member", tmNew.status === 201);
  check("MEMBER cannot create a team member", (await mem.client.post("/team", { name: "ZZ Test P9 X", initials: "X", role: "r", category: "MSC" })).status === 403);
  check("LAB_MANAGER can change another profile's category + sort order", (await mgr.client.put(`/team/${tmNew.json.id}`, { category: "BSC", sortOrder: 77 })).json?.category === "BSC");
  check("LAB_MANAGER can edit another member's history", (await mgr.client.post(`/member/${tmNew.json.id}/history`, { year: "2024", title: "ZZ Test P9 hist" })).status === 201);
  check("LAB_MANAGER can set another member's linked publications", (await mgr.client.put(`/member/${tmNew.json.id}/publications`, { publicationIds: [pubOpen.id] })).status === 200);
  check("MEMBER still cannot edit another profile", (await mem.client.put(`/team/${tmNew.json.id}`, { bio: "x" })).status === 403);
  check("LAB_MANAGER cannot delete a team member (admin only)", (await mgr.client.del(`/team/${tmNew.json.id}`)).status === 403);
  check("ADMIN can delete a team member", (await admin.del(`/team/${tmNew.json.id}`)).status === 200);
  check("audit: team member create/update/delete + link change recorded", (await actions("TEAM_MEMBER", tmNew.json.id)).sort().join() === "MEMBER_LINKS_CHANGED,TEAM_MEMBER_CREATED,TEAM_MEMBER_DELETED,TEAM_MEMBER_UPDATED");
  check("LAB_MANAGER can add any author to a publication", (await mgr.client.put(`/publications/${pubOpen.id}/authors`, { teamMemberIds: [mem.tm.id, lead.tm.id] })).json?.teamMemberIds?.length === 2);
  check("MEMBER still limited to linking themself", (await mem.client.put(`/publications/${pubOpen.id}/authors`, { teamMemberIds: [mem.tm.id, lead.tm.id, other.tm.id] })).status === 403);

  // ------------------------------------------------------------------
  section("phase 9: audit wiring + transactional rollback");
  const life = (await mkPub(mem.client, "ZZ Test P9 life", { teamMemberIds: [mem.tm.id] })).json;
  await mem.client.put(`/publications/${life.id}`, { venue: "v-changed" });
  const beforeNoop = await prisma.auditLog.count({ where: { entityType: "PUBLICATION", entityId: life.id } });
  await mem.client.put(`/publications/${life.id}`, { venue: "v-changed" });
  check("audit: an update that changes nothing writes no row", (await prisma.auditLog.count({ where: { entityType: "PUBLICATION", entityId: life.id } })) === beforeNoop);
  await mgr.client.put(`/publications/${life.id}/authors`, { teamMemberIds: [mem.tm.id, lead.tm.id] });
  await mgr.client.put(`/publications/${life.id}`, { visibility: "LAB_ONLY" });
  const lifeRows = await auditFor("PUBLICATION", life.id);
  check("audit: publication lifecycle (created/updated/authors/visibility)", ["PUBLICATION_CREATED", "PUBLICATION_UPDATED", "PUBLICATION_AUTHORS_CHANGED", "CONTENT_VISIBILITY_CHANGED"].every((a) => lifeRows.some((r) => r.action === a)));
  check("audit: UPDATED lists the changed field names, not their text", lifeRows.filter((r) => r.action === "PUBLICATION_UPDATED").some((r) => detailsOf(r).changed === "venue") && !lifeRows.some((r) => (r.details ?? "").includes("v-changed")));
  check("audit: CREATED actor is the member", lifeRows.find((r) => r.action === "PUBLICATION_CREATED")?.actorId === mem.id);
  const rowsBefore = await prisma.auditLog.count();
  const rb1 = await mgr.client.put(`/publications/${life.id}`, { title: "ZZ Test P9 rolled back", teamMemberIds: ["doesnotexist"] });
  check("rollback: bad author list -> 400", rb1.status === 400);
  check("rollback: publication title unchanged", (await prisma.publication.findUnique({ where: { id: life.id } })).title === "ZZ Test P9 life");
  const rb2 = await mem.client.put(`/publications/${life.id}`, { title: "ZZ Test P9 rolled back 2", teamMemberIds: [mem.tm.id, other.tm.id, lead.tm.id] });
  check("rollback: member adding others -> 403 and nothing saved", rb2.status === 403 && (await prisma.publication.findUnique({ where: { id: life.id } })).title === "ZZ Test P9 life");
  check("rollback: failed requests wrote no audit rows", (await prisma.auditLog.count()) === rowsBefore);
  const rb3 = await mgr.client.post("/projects", { title: "ZZ Test P9 rollback project", groupId: "doesnotexist" });
  check("rollback: project with a missing group -> 400, no project, no audit", rb3.status === 400 && (await prisma.researchProject.count({ where: { title: "ZZ Test P9 rollback project" } })) === 0 && (await prisma.auditLog.count()) === rowsBefore);

  // ------------------------------------------------------------------
  section("phase 9: groups");
  const gPub = (await mgr.client.post("/groups", { name: "ZZ Test P9 Group Public", description: "d", visibility: "PUBLIC" })).json;
  const gHid = (await mgr.client.post("/groups", { name: "ZZ Test P9 Group Hidden" })).json;
  check("guest cannot create a group (401)", (await guest.post("/groups", { name: "ZZ Test x" })).status === 401);
  check("MEMBER cannot create a group (403)", (await mem.client.post("/groups", { name: "ZZ Test x" })).status === 403);
  check("LAB_MANAGER creates a group; slug generated", !!gPub?.id && gPub.slug === "zz-test-p9-group-public" && gPub.visibility === "PUBLIC");
  check("a group created without visibility is LAB_ONLY (fail closed)", gHid?.visibility === "LAB_ONLY");
  check("duplicate name gets a unique slug", (await mgr.client.post("/groups", { name: "ZZ Test P9 Group Public" })).json?.slug === "zz-test-p9-group-public-2");
  check("explicit slug already taken -> 409", (await mgr.client.post("/groups", { name: "ZZ Test P9 g3", slug: gPub.slug })).status === 409);
  check("invalid slug -> 400", (await mgr.client.post("/groups", { name: "ZZ Test P9 g4", slug: "Bad Slug" })).status === 400);
  check("group without a name -> 400", (await mgr.client.post("/groups", { description: "d" })).status === 400);
  check("whitespace-only name -> 400", (await mgr.client.post("/groups", { name: "   " })).status === 400);
  check("bad visibility -> 400", (await mgr.client.post("/groups", { name: "ZZ Test P9 g5", visibility: "SECRET" })).status === 400);
  check("non-object body -> 400", (await mgr.client.post("/groups", [])).status === 400);
  check("client cannot choose the id (stripped)", (await mgr.client.post("/groups", { name: "ZZ Test P9 g6", id: "chosen-by-client" })).json?.id !== "chosen-by-client");
  check("group member set: LAB_MANAGER 200", (await mgr.client.put(`/groups/${gPub.id}/members`, { members: [{ teamMemberId: lead.tm.id, role: "LEAD" }, { teamMemberId: mem.tm.id, role: "MEMBER" }] })).status === 200);
  check("group member set for hidden group", (await mgr.client.put(`/groups/${gHid.id}/members`, { members: [{ teamMemberId: lead.tm.id, role: "MEMBER" }] })).status === 200);
  check("group members: duplicates -> 400", (await mgr.client.put(`/groups/${gPub.id}/members`, { members: [{ teamMemberId: mem.tm.id }, { teamMemberId: mem.tm.id }] })).status === 400);
  check("group members: unknown team member -> 400", (await mgr.client.put(`/groups/${gPub.id}/members`, { members: [{ teamMemberId: "doesnotexist" }] })).status === 400);
  check("group members: bad role -> 400", (await mgr.client.put(`/groups/${gPub.id}/members`, { members: [{ teamMemberId: mem.tm.id, role: "BOSS" }] })).status === 400);
  check("group members: array of strings -> 400", (await mgr.client.put(`/groups/${gPub.id}/members`, { members: "x" })).status === 400);
  const gd = (await guest.get(`/groups/${gPub.id}`)).json;
  check("guest sees the public group with its members (LEAD first)", gd?.members?.length === 2 && gd.members[0].role === "LEAD" && gd.members[0].teamMemberId === lead.tm.id);
  check("guest: hidden group is 404 by id and absent from the list", (await guest.get(`/groups/${gHid.id}`)).status === 404 && !idsOf(await guest.get("/groups")).includes(gHid.id));
  check("member sees the hidden group (no visibility field)", (await mem.client.get(`/groups/${gHid.id}`)).status === 200 && noVis(await mem.client.get("/groups")));
  check("manager receives visibility on groups", (await mgr.client.get(`/groups/${gHid.id}`)).json?.visibility === "LAB_ONLY");
  check("group detail says who can edit (UX hint)", (await guest.get(`/groups/${gPub.id}`)).json?.canEdit === false && (await mem.client.get(`/groups/${gPub.id}`)).json?.canEdit === false && (await lead.client.get(`/groups/${gPub.id}`)).json?.canEdit === true && (await mgr.client.get(`/groups/${gPub.id}`)).json?.canEdit === true);
  check("group lead may edit the description", (await lead.client.put(`/groups/${gPub.id}`, { description: "lead edit" })).json?.description === "lead edit");
  for (const key of [["visibility", "LAB_ONLY"], ["slug", "lead-slug"], ["sortOrder", 5]])
    check(`group lead cannot change ${key[0]} (403)`, (await lead.client.put(`/groups/${gPub.id}`, { [key[0]]: key[1] })).status === 403);
  check("group lead may manage members", (await lead.client.put(`/groups/${gPub.id}/members`, { members: [{ teamMemberId: lead.tm.id, role: "LEAD" }, { teamMemberId: mem.tm.id, role: "MEMBER" }, { teamMemberId: other.tm.id, role: "MEMBER" }] })).status === 200);
  check("plain member cannot edit a group (403)", (await mem.client.put(`/groups/${gPub.id}`, { description: "x" })).status === 403 && (await mem.client.put(`/groups/${gPub.id}/members`, { members: [] })).status === 403);
  check("member-role (not LEAD) of a group cannot edit it", (await lead.client.put(`/groups/${gHid.id}`, { description: "x" })).status === 403);
  check("no probing: member editing a missing group -> 403; manager -> 404", (await lead.client.put("/groups/doesnotexist", { description: "x" })).status === 403 && (await mgr.client.put("/groups/doesnotexist", { description: "x" })).status === 404);
  check("group delete: lead 403, member 403, guest 401", (await lead.client.del(`/groups/${gPub.id}`)).status === 403 && (await mem.client.del(`/groups/${gPub.id}`)).status === 403 && (await guest.del(`/groups/${gPub.id}`)).status === 401);
  check("group: nothing to update -> 400", (await mgr.client.put(`/groups/${gPub.id}`, {})).status === 400);
  const gAudit = await actions("RESEARCH_GROUP", gPub.id);
  check("audit: group created/updated/members changed", ["GROUP_CREATED", "GROUP_UPDATED", "GROUP_MEMBERS_CHANGED"].every((a) => gAudit.includes(a)));
  check("audit: lead's member change carries the lead as actor", (await prisma.auditLog.count({ where: { entityType: "RESEARCH_GROUP", entityId: gPub.id, action: "GROUP_MEMBERS_CHANGED", actorId: lead.id } })) === 1);

  // ------------------------------------------------------------------
  section("phase 9: projects (create, validate, read)");
  const create = (c, body) => c.post("/projects", body);
  const pAlpha = (await create(mgr.client, { title: "ZZ Test P9 Alpha", summary: "s", description: "d", status: "ACTIVE", startDate: "2030-01-15", endDate: "2031-06-30", visibility: "PUBLIC", groupId: gPub.id, sortOrder: 1 })).json;
  const pBeta = (await create(mgr.client, { title: "ZZ Test P9 Beta" })).json;
  const pGamma = (await create(admin, { title: "ZZ Test P9 Gamma", visibility: "PUBLIC", groupId: gHid.id })).json;
  check("guest cannot create a project (401)", (await create(guest, { title: "ZZ Test x" })).status === 401);
  check("MEMBER cannot create a project (403)", (await create(mem.client, { title: "ZZ Test x" })).status === 403);
  check("LAB_MANAGER creates a project", !!pAlpha?.id && pAlpha.slug === "zz-test-p9-alpha" && pAlpha.status === "ACTIVE" && pAlpha.startDate === "2030-01-15" && pAlpha.group?.id === gPub.id);
  check("ADMIN creates a project", !!pGamma?.id);
  check("a project created without visibility is LAB_ONLY", pBeta?.visibility === "LAB_ONLY" && pBeta?.status === "ACTIVE" && pBeta?.startDate === null);
  check("duplicate title -> unique slug", (await create(mgr.client, { title: "ZZ Test P9 Alpha" })).json?.slug === "zz-test-p9-alpha-2");
  check("Japanese-only title falls back to a valid slug", /^project(-\d+)?$/.test((await create(mgr.client, { title: "量子計算テスト" })).json?.slug ?? ""));
  check("explicit slug taken -> 409", (await create(mgr.client, { title: "ZZ Test P9 s1", slug: pAlpha.slug })).status === 409);
  const bad = async (label, body, status = 400) => check(`project validation: ${label} -> ${status}`, (await create(mgr.client, body)).status === status);
  await bad("missing title", { summary: "s" });
  await bad("whitespace title", { title: "   " });
  await bad("title too long", { title: "x".repeat(201) });
  await bad("non-string summary", { title: "ZZ Test v", summary: 5 });
  await bad("unknown status", { title: "ZZ Test v", status: "DONE" });
  await bad("lowercase status", { title: "ZZ Test v", status: "active" });
  await bad("impossible date", { title: "ZZ Test v", startDate: "2024-02-30" });
  await bad("wrong date format", { title: "ZZ Test v", startDate: "15/01/2024" });
  await bad("numeric date", { title: "ZZ Test v", startDate: 20240115 });
  await bad("end before start", { title: "ZZ Test v", startDate: "2024-05-01", endDate: "2024-04-01" });
  await bad("bad visibility", { title: "ZZ Test v", visibility: "SECRET" });
  await bad("bad slug", { title: "ZZ Test v", slug: "Not A Slug" });
  await bad("slug with double hyphen", { title: "ZZ Test v", slug: "a--b" });
  await bad("sortOrder not a number", { title: "ZZ Test v", sortOrder: "abc" });
  await bad("malformed groupId", { title: "ZZ Test v", groupId: "bad!id" });
  await bad("unknown groupId", { title: "ZZ Test v", groupId: "doesnotexist" });
  await bad("array body", []);
  await bad("null body", null);
  check("project: client cannot choose the id", (await create(mgr.client, { title: "ZZ Test P9 idtest", id: "chosen" })).json?.id !== "chosen");
  check("project: empty dates accepted (\"\" -> null)", (await create(mgr.client, { title: "ZZ Test P9 nodates", startDate: "", endDate: "" })).json?.startDate === null);

  for (const [label, c, expectBeta, sawField] of [["guest", guest, false, false], ["MEMBER", mem.client, true, false], ["LAB_MANAGER", mgr.client, true, true], ["ADMIN", admin, true, true]]) {
    const list = await c.get("/projects");
    check(`${label}: project list ${expectBeta ? "includes" : "excludes"} the LAB_ONLY project`, idsOf(list).includes(pBeta.id) === expectBeta && idsOf(list).includes(pAlpha.id));
    check(`${label}: LAB_ONLY project by id -> ${expectBeta ? 200 : 404}`, (await c.get(`/projects/${pBeta.id}`)).status === (expectBeta ? 200 : 404));
    check(`${label}: ${sawField ? "receives" : "never receives"} the project visibility field`, sawField ? (await c.get(`/projects/${pAlpha.id}`)).json?.visibility === "PUBLIC" : noVis(list) && noVis(await c.get(`/projects/${pAlpha.id}`)));
  }
  check("project 404 for unknown id, 400 for malformed id", (await guest.get("/projects/doesnotexist")).status === 404 && (await guest.get("/projects/bad!id")).status === 400 && (await mgr.client.get("/projects/bad!id")).status === 400);
  check("hidden project 404 is identical to a missing one", JSON.stringify((await guest.get(`/projects/${pBeta.id}`)).json) === JSON.stringify((await guest.get("/projects/doesnotexist")).json));

  // ------------------------------------------------------------------
  section("phase 9: project relationships + nested visibility");
  const setRel = (c, id, rel, body) => c.put(`/projects/${id}/${rel}`, body);
  check("LAB_MANAGER links areas (public + hidden)", (await setRel(mgr.client, pAlpha.id, "areas", { areaIds: [areaPub.id, areaHid.id] })).status === 200);
  check("LAB_MANAGER links publications (public + hidden)", (await setRel(mgr.client, pAlpha.id, "publications", { publicationIds: [pubOpen.id, pubHid.id] })).status === 200);
  check("LAB_MANAGER links news (public + hidden)", (await setRel(mgr.client, pAlpha.id, "news", { newsIds: [newsOpen.id, newsHid.id] })).status === 200);
  check("LAB_MANAGER sets members (lead + member)", (await setRel(mgr.client, pAlpha.id, "members", { members: [{ teamMemberId: mem.tm.id, role: "MEMBER" }, { teamMemberId: lead.tm.id, role: "LEAD" }] })).status === 200);
  const aGuest = await guest.get(`/projects/${pAlpha.id}`), aMem = await mem.client.get(`/projects/${pAlpha.id}`), aMgr = await mgr.client.get(`/projects/${pAlpha.id}`);
  const gj = JSON.stringify(aGuest.json);
  check("guest sees only the public area / publication / news", aGuest.json.areas.length === 1 && aGuest.json.publications.length === 1 && aGuest.json.news.length === 1 && aGuest.json.areas[0].id === areaPub.id);
  check("guest response contains no trace of hidden linked records", ![areaHid, pubHid, newsHid].some((x) => gj.includes(x.id) || gj.includes(x.title)));
  check("members + areas + publications + news all visible to a member/manager", [aMem, aMgr].every((r) => r.json.areas.length === 2 && r.json.publications.length === 2 && r.json.news.length === 2));
  check("members are listed LEAD first", aGuest.json.members.map((m) => m.role).join() === "LEAD,MEMBER" && aGuest.json.members[0].teamMemberId === lead.tm.id);
  check("linked publications inside a project also hide their visibility field from members", noVis(aMem) && aMgr.json.publications.some((p) => p.visibility === "LAB_ONLY"));
  check("list view: guest gets only the public area per project", (await guest.get("/projects")).json.find((p) => p.id === pAlpha.id).areas.length === 1);
  check("Gamma is public but its group is hidden: guest sees group = null", (await guest.get(`/projects/${pGamma.id}`)).json.group === null);
  const gGuest = JSON.stringify([(await guest.get(`/projects/${pGamma.id}`)).json, (await guest.get("/projects")).json]);
  check("...and the hidden group's id/name appear nowhere in guest responses", !gGuest.includes(gHid.id) && !gGuest.includes(gHid.name) && !gGuest.includes(gHid.slug));
  check("member sees Gamma's group", (await mem.client.get(`/projects/${pGamma.id}`)).json.group?.id === gHid.id);
  check("public group is shown to a guest", aGuest.json.group?.id === gPub.id);
  check("news already in another project -> 409, nothing changed", await (async () => {
    await setRel(mgr.client, pBeta.id, "news", { newsIds: [(await mkNews(admin, "ZZ Test P9 news for beta")).json.id] });
    const betaNews = (await prisma.newsItem.findFirst({ where: { title: "ZZ Test P9 news for beta" } })).id;
    const r = await setRel(mgr.client, pAlpha.id, "news", { newsIds: [newsOpen.id, newsHid.id, betaNews] });
    return r.status === 409 && (await prisma.newsItem.count({ where: { projectId: pAlpha.id } })) === 2;
  })());
  check("relations: unknown area/publication/news/member -> 400", [(await setRel(mgr.client, pAlpha.id, "areas", { areaIds: ["doesnotexist"] })).status, (await setRel(mgr.client, pAlpha.id, "publications", { publicationIds: ["doesnotexist"] })).status, (await setRel(mgr.client, pAlpha.id, "news", { newsIds: ["doesnotexist"] })).status, (await setRel(mgr.client, pAlpha.id, "members", { members: [{ teamMemberId: "doesnotexist" }] })).status].every((s) => s === 400));
  check("relations: bad shapes -> 400", [(await setRel(mgr.client, pAlpha.id, "areas", { areaIds: [1, 2] })).status, (await setRel(mgr.client, pAlpha.id, "areas", { areaIds: [areaPub.id, areaPub.id] })).status, (await setRel(mgr.client, pAlpha.id, "publications", { publicationIds: "x" })).status, (await setRel(mgr.client, pAlpha.id, "news", { newsIds: null })).status, (await setRel(mgr.client, pAlpha.id, "members", {})).status, (await setRel(mgr.client, pAlpha.id, "members", { members: [{ teamMemberId: mem.tm.id, role: "BOSS" }] })).status, (await setRel(mgr.client, pAlpha.id, "members", { members: [{ teamMemberId: mem.tm.id }, { teamMemberId: mem.tm.id }] })).status].every((s) => s === 400));
  check("relations: a failed relation call changed nothing", (await prisma.projectArea.count({ where: { projectId: pAlpha.id } })) === 2 && (await prisma.projectMember.count({ where: { projectId: pAlpha.id } })) === 2);
  check("relations: unknown project -> 404 (manager) / 403 (member)", (await setRel(mgr.client, "doesnotexist", "areas", { areaIds: [] })).status === 404 && (await setRel(mem.client, "doesnotexist", "areas", { areaIds: [] })).status === 403);
  check("relations: guest 401, plain member 403", (await setRel(guest, pAlpha.id, "areas", { areaIds: [] })).status === 401 && (await setRel(mem.client, pAlpha.id, "areas", { areaIds: [] })).status === 403);
  check("relations: replacing with [] clears the set", (await setRel(mgr.client, pAlpha.id, "areas", { areaIds: [] })).status === 200 && (await prisma.projectArea.count({ where: { projectId: pAlpha.id } })) === 0);
  await setRel(mgr.client, pAlpha.id, "areas", { areaIds: [areaPub.id, areaHid.id] });

  // ------------------------------------------------------------------
  section("phase 9: project permissions (lead vs member vs manager)");
  check("project detail says who can edit (UX hint)", aGuest.json.canEdit === false && aMem.json.canEdit === false && (await lead.client.get(`/projects/${pAlpha.id}`)).json.canEdit === true && aMgr.json.canEdit === true);
  check("project LEAD may edit content fields", (await lead.client.put(`/projects/${pAlpha.id}`, { summary: "lead edit", status: "COMPLETED" })).json?.summary === "lead edit");
  for (const [key, value] of [["visibility", "LAB_ONLY"], ["slug", "lead-slug"], ["sortOrder", 5], ["groupId", null], ["groupId", gHid.id]])
    check(`project LEAD cannot change ${key} (403)`, (await lead.client.put(`/projects/${pAlpha.id}`, { [key]: value })).status === 403);
  const alphaNow = await prisma.researchProject.findUnique({ where: { id: pAlpha.id } });
  check("...and nothing changed after those rejections", alphaNow.visibility === "PUBLIC" && alphaNow.slug === "zz-test-p9-alpha" && alphaNow.sortOrder === 1 && alphaNow.groupId === gPub.id);
  check("a rejected lead update mixing allowed + forbidden fields saves nothing", (await lead.client.put(`/projects/${pAlpha.id}`, { summary: "sneaky", visibility: "LAB_ONLY" })).status === 403 && (await prisma.researchProject.findUnique({ where: { id: pAlpha.id } })).summary === "lead edit");
  check("project LEAD may manage members, areas, publications, news", [(await setRel(lead.client, pAlpha.id, "members", { members: [{ teamMemberId: lead.tm.id, role: "LEAD" }, { teamMemberId: mem.tm.id, role: "MEMBER" }, { teamMemberId: other.tm.id, role: "COLLABORATOR" }] })).status, (await setRel(lead.client, pAlpha.id, "areas", { areaIds: [areaPub.id, areaHid.id] })).status, (await setRel(lead.client, pAlpha.id, "publications", { publicationIds: [pubOpen.id, pubHid.id] })).status, (await setRel(lead.client, pAlpha.id, "news", { newsIds: [newsOpen.id, newsHid.id] })).status].every((s) => s === 200));
  check("plain member cannot edit a project (403)", (await mem.client.put(`/projects/${pAlpha.id}`, { summary: "x" })).status === 403);
  check("a lead of Alpha cannot edit Beta (403)", (await lead.client.put(`/projects/${pBeta.id}`, { summary: "x" })).status === 403 && (await setRel(lead.client, pBeta.id, "members", { members: [] })).status === 403);
  check("no probing: member editing a missing project -> 403; manager -> 404", (await lead.client.put("/projects/doesnotexist", { summary: "x" })).status === 403 && (await mgr.client.put("/projects/doesnotexist", { summary: "x" })).status === 404);
  check("project: nothing to update -> 400", (await mgr.client.put(`/projects/${pAlpha.id}`, {})).status === 400);
  check("project: end date before the EXISTING start date -> 400", (await lead.client.put(`/projects/${pAlpha.id}`, { endDate: "2029-01-01" })).status === 400);
  check("project: start date after the existing end date -> 400", (await lead.client.put(`/projects/${pAlpha.id}`, { startDate: "2032-01-01" })).status === 400);
  check("project: both dates moved together is fine", (await lead.client.put(`/projects/${pAlpha.id}`, { startDate: "2032-01-01", endDate: "2033-01-01" })).status === 200);
  check("project: dates can be cleared with null", (await lead.client.put(`/projects/${pAlpha.id}`, { startDate: null, endDate: null })).json?.startDate === null);
  check("project: invalid status on update -> 400", (await mgr.client.put(`/projects/${pAlpha.id}`, { status: "DONE" })).status === 400);
  check("project delete: lead 403, member 403, guest 401", (await lead.client.del(`/projects/${pAlpha.id}`)).status === 403 && (await mem.client.del(`/projects/${pAlpha.id}`)).status === 403 && (await guest.del(`/projects/${pAlpha.id}`)).status === 401);
  check("manager may change slug / sortOrder / group", (await mgr.client.put(`/projects/${pAlpha.id}`, { slug: "zz-test-p9-alpha-x", sortOrder: 2, groupId: gPub.id })).json?.slug === "zz-test-p9-alpha-x");
  check("slug change to a taken slug -> 409", (await mgr.client.put(`/projects/${pAlpha.id}`, { slug: pGamma.slug })).status === 409);
  check("manager can ungroup a project (groupId: null)", (await mgr.client.put(`/projects/${pGamma.id}`, { groupId: null })).json?.group === null);
  check("manager can put it back", (await mgr.client.put(`/projects/${pGamma.id}`, { groupId: gHid.id })).json?.group?.id === gHid.id);

  // ------------------------------------------------------------------
  section("phase 9: groups <-> projects, profile integration");
  await setRel(mgr.client, pBeta.id, "members", { members: [{ teamMemberId: lead.tm.id, role: "MEMBER" }] });
  await setRel(mgr.client, pGamma.id, "members", { members: [{ teamMemberId: lead.tm.id, role: "MEMBER" }] });
  await mgr.client.put(`/projects/${pBeta.id}`, { groupId: gPub.id });
  const gGuestDetail = (await guest.get(`/groups/${gPub.id}`)).json, gMemDetail = (await mem.client.get(`/groups/${gPub.id}`)).json;
  check("group.projectCount / projects only count what the viewer may see", gGuestDetail.projectCount === 1 && gGuestDetail.projects.length === 1 && gGuestDetail.projects[0].id === pAlpha.id && gMemDetail.projectCount === 2 && gMemDetail.projects.length === 2);
  check("group list count matches the detail count (guest and member)", (await guest.get("/groups")).json.find((g) => g.id === gPub.id).projectCount === 1 && (await mem.client.get("/groups")).json.find((g) => g.id === gPub.id).projectCount === 2);
  check("guest group JSON has no trace of the hidden project", !JSON.stringify(gGuestDetail).includes(pBeta.id) && !JSON.stringify(gGuestDetail).includes("ZZ Test P9 Beta"));
  const profGuest = await guest.get(`/member/${lead.tm.id}`), profMem = await mem.client.get(`/member/${lead.tm.id}`);
  check("profile: guest sees only public projects (Alpha, Gamma)", profGuest.json.projects.map((p) => p.id).sort().join() === [pAlpha.id, pGamma.id].sort().join());
  check("profile: guest sees only the public group", profGuest.json.groups.map((g) => g.id).join() === gPub.id);
  const pj = JSON.stringify(profGuest.json);
  check("profile: guest JSON has no trace of the hidden project/group", ![pBeta.id, "ZZ Test P9 Beta", gHid.id, "ZZ Test P9 Group Hidden"].some((s) => pj.includes(s)));
  check("profile: member sees every project + group", profMem.json.projects.length === 3 && profMem.json.groups.length === 2);
  check("profile: roles are reported", profMem.json.projects.find((p) => p.id === pAlpha.id)?.role === "LEAD" && profMem.json.groups.find((g) => g.id === gPub.id)?.role === "LEAD");
  await mgr.client.put(`/member/${lead.tm.id}/publications`, { publicationIds: [pubOpen.id, pubHid.id] });
  await mgr.client.put(`/member/${lead.tm.id}/news`, { newsIds: [newsOpen.id, newsHid.id] });
  const pj2 = await guest.get(`/member/${lead.tm.id}`);
  check("profile: hidden publications/news stay hidden from guests", pj2.json.publications.length === 1 && pj2.json.news.length === 1 && !JSON.stringify(pj2.json).includes("hidden"));
  check("profile: unauthorised viewers never receive a visibility field", noVis(profGuest) && noVis(profMem));
  check("profile: manager sees visibility on linked items", (await mgr.client.get(`/member/${lead.tm.id}`)).json.publications.some((p) => p.visibility === "LAB_ONLY"));

  // ------------------------------------------------------------------
  section("phase 9: security");
  const guestWrites = [["POST", "/projects", {}], ["PUT", `/projects/${pAlpha.id}`, {}], ["DELETE", `/projects/${pAlpha.id}`], ["PUT", `/projects/${pAlpha.id}/members`, {}], ["PUT", `/projects/${pAlpha.id}/areas`, {}], ["PUT", `/projects/${pAlpha.id}/publications`, {}], ["PUT", `/projects/${pAlpha.id}/news`, {}], ["POST", "/groups", {}], ["PUT", `/groups/${gPub.id}`, {}], ["DELETE", `/groups/${gPub.id}`], ["PUT", `/groups/${gPub.id}/members`, {}]];
  for (const [m, p, b] of guestWrites) check(`guest ${m} ${p.replace(/[a-z0-9]{20,}/, ":id")} -> 401`, (await guest.req(m, p, b)).status === 401);
  const badIds = [["GET", "/projects/bad!id"], ["PUT", "/projects/bad!id", { summary: "x" }], ["DELETE", "/projects/bad!id"], ["PUT", "/projects/bad!id/members", { members: [] }], ["PUT", "/projects/bad!id/areas", { areaIds: [] }], ["GET", "/groups/bad!id"], ["PUT", "/groups/bad!id", { name: "x" }], ["DELETE", "/groups/bad!id"], ["PUT", "/groups/bad!id/members", { members: [] }]];
  for (const [m, p, b] of badIds) check(`manager ${m} ${p} -> 400 (malformed id)`, (await mgr.client.req(m, p, b)).status === 400);
  const wrongType = await fetch(`${API}/api/projects`, { method: "POST", headers: { "Content-Type": "application/json", cookie: mgr.client.cookie }, body: "{not json" });
  check("malformed JSON body -> 400", wrongType.status === 400);
  check("SQL-ish input is just data", (await mgr.client.post("/projects", { title: "ZZ Test P9 '; DROP TABLE User; --" })).status === 201 && (await prisma.user.count()) > 0);
  check("HTML in text is stored verbatim (React escapes on render)", (await mgr.client.post("/projects", { title: "ZZ Test P9 <script>alert(1)</script>" })).json?.title === "ZZ Test P9 <script>alert(1)</script>");

  // A deleted account's live session is dead: writes 401, reads fall back to guest.
  const otherCookie = other.client.cookie;
  check("deleted account: admin deletes it", (await admin.del(`/users/${other.id}`)).status === 200);
  const ghost = Object.assign(new Client(), { cookie: otherCookie });
  check("deleted account: write -> 401", (await ghost.put(`/projects/${pAlpha.id}`, { summary: "ghost" })).status === 401 && (await ghost.post("/groups", { name: "ZZ Test ghost" })).status === 401);
  check("deleted account: reads behave as a guest (LAB_ONLY hidden)", !idsOf(await ghost.get("/projects")).includes(pBeta.id) && (await ghost.get(`/groups/${gHid.id}`)).status === 404 && (await ghost.get(`/news/${newsHid.id}`)).status === 404);
  check("deleted account: their team profile is kept, unlinked, and its memberships too", (await prisma.teamMember.findUnique({ where: { id: other.tm.id } }))?.userId === null && (await prisma.projectMember.count({ where: { teamMemberId: other.tm.id } })) === 1);
  const forged = Object.assign(new Client(), { cookie: "scl.sid=s%3Aforged.signature" });
  check("forged session cookie is a guest", (await forged.post("/groups", { name: "ZZ Test forged" })).status === 401 && !idsOf(await forged.get("/projects")).includes(pBeta.id));
  check("a demoted lead loses edit rights at once", await (async () => {
    await mgr.client.put(`/projects/${pAlpha.id}/members`, { members: [{ teamMemberId: mem.tm.id, role: "MEMBER" }] });
    return (await lead.client.put(`/projects/${pAlpha.id}`, { summary: "no longer lead" })).status === 403;
  })());
  await mgr.client.put(`/projects/${pAlpha.id}/members`, { members: [{ teamMemberId: lead.tm.id, role: "LEAD" }, { teamMemberId: mem.tm.id, role: "MEMBER" }] });

  // ------------------------------------------------------------------
  section("phase 9: visibility flip + deletion semantics (projects, groups)");
  check("manager publishes the hidden project", (await mgr.client.put(`/projects/${pBeta.id}`, { visibility: "PUBLIC" })).json?.visibility === "PUBLIC");
  check("guest now sees it", (await guest.get(`/projects/${pBeta.id}`)).status === 200);
  check("manager hides it again", (await mgr.client.put(`/projects/${pBeta.id}`, { visibility: "LAB_ONLY" })).json?.visibility === "LAB_ONLY" && (await guest.get(`/projects/${pBeta.id}`)).status === 404);
  const pAudit = await actions("RESEARCH_PROJECT", pBeta.id);
  check("audit: project created/updated + two visibility changes", pAudit.includes("PROJECT_CREATED") && pAudit.includes("PROJECT_UPDATED") && pAudit.filter((a) => a === "CONTENT_VISIBILITY_CHANGED").length === 2);
  const aAudit = await actions("RESEARCH_PROJECT", pAlpha.id);
  check("audit: project members/areas/publications/news changes recorded", ["PROJECT_MEMBERS_CHANGED", "PROJECT_AREAS_CHANGED", "PROJECT_PUBLICATIONS_CHANGED", "PROJECT_NEWS_CHANGED"].every((a) => aAudit.includes(a)));
  check("audit: lead's own edits carry the lead as actor", (await prisma.auditLog.count({ where: { entityType: "RESEARCH_PROJECT", entityId: pAlpha.id, actorId: lead.id } })) >= 4);
  check("audit: PROJECT_UPDATED lists field names only", (await auditFor("RESEARCH_PROJECT", pAlpha.id)).filter((r) => r.action === "PROJECT_UPDATED").every((r) => !(r.details ?? "").includes("lead edit")));

  const betaNewsId = (await prisma.newsItem.findFirst({ where: { title: "ZZ Test P9 news for beta" } })).id;
  await prisma.translation.create({ data: { entityType: "RESEARCH_PROJECT", entityId: pBeta.id, locale: "ja", field: "title", value: "テスト" } });
  check("project delete: member 403 / lead 403 / manager 200", (await mem.client.del(`/projects/${pBeta.id}`)).status === 403 && (await mgr.client.del(`/projects/${pBeta.id}`)).status === 200);
  check("deleted project is 404 and gone", (await mgr.client.get(`/projects/${pBeta.id}`)).status === 404 && (await prisma.researchProject.count({ where: { id: pBeta.id } })) === 0);
  check("delete: memberships cascaded, linked news kept + unlinked", (await prisma.projectMember.count({ where: { projectId: pBeta.id } })) === 0 && (await prisma.newsItem.findUnique({ where: { id: betaNewsId } }))?.projectId === null);
  check("delete: its Translation rows are removed too", (await prisma.translation.count({ where: { entityType: "RESEARCH_PROJECT", entityId: pBeta.id } })) === 0);
  const del = (await prisma.auditLog.findMany({ where: { entityType: "RESEARCH_PROJECT", entityId: pBeta.id, action: "PROJECT_DELETED" } }))[0];
  check("audit: PROJECT_DELETED keeps the title + how many news were unlinked", detailsOf(del).title === "ZZ Test P9 Beta" && detailsOf(del).unlinkedNews === 1);
  check("deleting a linked research area / publication cascades the project links", (await mgr.client.del(`/research/${areaHid.id}`)).status === 200 && (await mgr.client.del(`/publications/${pubHid.id}`)).status === 200 && (await prisma.projectArea.count({ where: { researchAreaId: areaHid.id } })) === 0 && (await prisma.projectPublication.count({ where: { publicationId: pubHid.id } })) === 0);
  check("deleting a team member cascades their project/group memberships", (await admin.del(`/team/${mem.tm.id}`)).status === 200 && (await prisma.projectMember.count({ where: { teamMemberId: mem.tm.id } })) === 0 && (await prisma.groupMember.count({ where: { teamMemberId: mem.tm.id } })) === 0);
  check("group delete: manager 200; projects survive ungrouped", (await mgr.client.del(`/groups/${gPub.id}`)).status === 200 && (await prisma.researchProject.findUnique({ where: { id: pAlpha.id } }))?.groupId === null && (await prisma.groupMember.count({ where: { groupId: gPub.id } })) === 0);
  check("deleted group is 404", (await guest.get(`/groups/${gPub.id}`)).status === 404);
  const gdel = (await prisma.auditLog.findMany({ where: { entityType: "RESEARCH_GROUP", entityId: gPub.id, action: "GROUP_DELETED" } }))[0];
  check("audit: GROUP_DELETED records how many projects were ungrouped", detailsOf(gdel).ungroupedProjects === 1);

  // ------------------------------------------------------------------
  section("phase 9: audit log never holds secrets");
  const all = await prisma.auditLog.findMany({ where: { createdAt: { gte: RUN_STARTED } } });
  check("audit: the run produced a substantial log", all.length > 60, String(all.length));
  const blob = all.map((r) => r.details ?? "").join("\n");
  const secrets = [PW, ADMIN.password, "scl.sid", "passwordHash", "token"];
  check("audit: no password, hash, cookie or token material anywhere", !secrets.some((s) => blob.toLowerCase().includes(s.toLowerCase())) && !/\$2[aby]\$/.test(blob));
  check("audit: every details value parses as flat JSON with no forbidden key", all.every((r) => { if (!r.details) return true; const d = JSON.parse(r.details); return Object.entries(d).every(([k, v]) => !/pass|hash|secret|token|cookie|session|body|content|message/i.test(k) && (v === null || ["string", "number", "boolean"].includes(typeof v))); }));
  check("audit: every row has an action, entityType and a timestamp", all.every((r) => r.action && r.entityType && r.createdAt instanceof Date));
  check("audit: actor email snapshots are set", all.filter((r) => r.actorId).every((r) => r.actorEmail.includes("@")));
}

/**
 * Phase 9.1: profile privacy (no account ids, server-computed `isOwn`), project/group lead
 * limits, visibility regressions, authorization consistency and audit hygiene.
 */
async function phase91(admin, guest) {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const idsOf = (res) => (Array.isArray(res.json) ? res.json.map((x) => x.id) : []);
  const detailsOf = (row) => JSON.parse(row?.details ?? "{}");
  const keysOf = (o) => Object.keys(o ?? {}).sort().join();
  const adminMe = (await admin.get("/auth/me")).json.user;

  const mk = async (key, role, name) => {
    const email = `p9test-91-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "ZT", memberRole: "MSc Researcher", category: "MSC" });
    const client = new Client();
    await client.login(email, PW);
    return { client, id: r.json?.id, email, tm: await prisma.teamMember.findFirst({ where: { name } }), status: r.status };
  };

  // ------------------------------------------------------------------
  section("phase 9.1: fixtures");
  const mgr = await mk("manager", "LAB_MANAGER", "ZZ Test 91 Manager");
  const memA = await mk("a", "MEMBER", "ZZ Test 91 Alice");
  const memB = await mk("b", "MEMBER", "ZZ Test 91 Bob");
  const leadG = await mk("leadg", "MEMBER", "ZZ Test 91 GroupLead");
  const leadP = await mk("leadp", "MEMBER", "ZZ Test 91 ProjectLead");
  check("fixtures: five accounts created", [mgr, memA, memB, leadG, leadP].every((u) => u.status === 201 && u.tm));

  const mkArea = (title, extra = {}) => mgr.client.post("/research", { title, description: "d", tag: "t", ...extra });
  const mkPub = (title, extra = {}) => mgr.client.post("/publications", { year: 2032, title, authors: "a", venue: "v", ...extra });
  const mkNews = (title, extra = {}) => mgr.client.post("/news", { date: "x", sortDate: "2099-03-01", type: "Paper", title, description: "d", ...extra });
  const areaPub = (await mkArea("ZZ Test 91 area public")).json;
  const areaHid = (await mkArea("ZZ Test 91 area hidden", { visibility: "LAB_ONLY" })).json;
  const pubPub = (await mkPub("ZZ Test 91 pub public")).json;
  const pubHid = (await mkPub("ZZ Test 91 pub hidden", { visibility: "LAB_ONLY" })).json;
  const newsPub = (await mkNews("ZZ Test 91 news public")).json;
  const newsHid = (await mkNews("ZZ Test 91 news hidden", { visibility: "LAB_ONLY" })).json;
  const G1 = (await mgr.client.post("/groups", { name: "ZZ Test 91 Group Public", description: "d", visibility: "PUBLIC" })).json;
  const G2 = (await mgr.client.post("/groups", { name: "ZZ Test 91 Group Hidden" })).json; // LAB_ONLY by default
  const P1 = (await mgr.client.post("/projects", { title: "ZZ Test 91 Proj Public", summary: "s", description: "d", visibility: "PUBLIC", groupId: G1.id, sortOrder: 1 })).json;
  const P2 = (await mgr.client.post("/projects", { title: "ZZ Test 91 Proj Hidden", groupId: G1.id })).json; // LAB_ONLY by default
  const P3 = (await mgr.client.post("/projects", { title: "ZZ Test 91 Proj In Hidden Group", visibility: "PUBLIC", groupId: G2.id })).json;
  check("fixtures: content, groups and projects created", [areaPub, areaHid, pubPub, pubHid, newsPub, newsHid, G1, G2, P1, P2, P3].every((x) => x?.id));
  check("fixtures: hidden ones really are LAB_ONLY", [areaHid, pubHid, newsHid, G2, P2].every((x) => x.visibility === "LAB_ONLY") && [P1, P3, G1].every((x) => x.visibility === "PUBLIC"));
  const okAll = [
    await mgr.client.put(`/groups/${G1.id}/members`, { members: [{ teamMemberId: leadG.tm.id, role: "LEAD" }, { teamMemberId: memA.tm.id, role: "MEMBER" }] }),
    await mgr.client.put(`/groups/${G2.id}/members`, { members: [{ teamMemberId: memB.tm.id, role: "MEMBER" }] }),
    await mgr.client.put(`/projects/${P1.id}/members`, { members: [{ teamMemberId: leadP.tm.id, role: "LEAD" }, { teamMemberId: memA.tm.id, role: "MEMBER" }] }),
    await mgr.client.put(`/projects/${P2.id}/members`, { members: [{ teamMemberId: memB.tm.id, role: "MEMBER" }] }),
    await mgr.client.put(`/projects/${P3.id}/members`, { members: [{ teamMemberId: memB.tm.id, role: "MEMBER" }] }),
    await mgr.client.put(`/projects/${P1.id}/areas`, { areaIds: [areaPub.id, areaHid.id] }),
    await mgr.client.put(`/projects/${P1.id}/publications`, { publicationIds: [pubPub.id, pubHid.id] }),
    await mgr.client.put(`/projects/${P1.id}/news`, { newsIds: [newsPub.id, newsHid.id] }),
    await mgr.client.put(`/publications/${pubPub.id}/authors`, { teamMemberIds: [memA.tm.id, memB.tm.id] }),
    await mgr.client.put(`/news/${newsPub.id}/authors`, { teamMemberIds: [memA.tm.id, memB.tm.id] }),
  ];
  check("fixtures: memberships and links wired", okAll.every((x) => x.status === 200), okAll.map((x) => x.status).join());
  const unlinkedSeed = await prisma.teamMember.findFirst({ where: { userId: null, NOT: { name: { startsWith: "ZZ Test" } } } });
  const allUserIds = (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);
  check("fixtures: there are account ids to look for", allUserIds.length >= 6 && allUserIds.includes(memA.id) && allUserIds.includes(adminMe.id));

  // ------------------------------------------------------------------
  section("phase 9.1: profile privacy — no account ids in any response");
  const PROFILE_KEYS = "bio,category,department,id,initials,isOwn,name,photoUrl,role,sortOrder";
  // canMessage added in Phase 12 (private messaging): a UX hint the /member/:id serializer sends
  // alongside isOwn, never an account id.
  const MEMBER_KEYS = "bio,canMessage,category,department,groups,history,id,initials,isOwn,name,news,photoUrl,projects,publications,role";
  // Any key that names an account/credential, or any value equal to a real account id.
  const leakOf = (res) => {
    const txt = JSON.stringify(res.json ?? null);
    const key = txt.match(/"(userId|passwordHash|password|sessionId|sid|token|email)"\s*:/)?.[1];
    const id = allUserIds.find((u) => txt.includes(u));
    return key ? `key ${key}` : id ? "account id value" : "";
  };
  const gTeam = await guest.get("/team");
  const gMember = await guest.get(`/member/${memA.tm.id}`);
  const gTeamOne = await guest.get(`/team/${memA.tm.id}`);
  check("1. guest GET /team: no userId, account id or credential key", gTeam.status === 200 && leakOf(gTeam) === "", leakOf(gTeam));
  check("1b. GET /team items expose exactly the public profile fields (allow-list)", gTeam.json.length >= 7 && gTeam.json.every((m) => keysOf(m) === PROFILE_KEYS));
  check("2. guest GET /member/:id: no userId, account id or credential key", gMember.status === 200 && leakOf(gMember) === "", leakOf(gMember));
  check("2b. GET /member/:id exposes exactly the profile fields (allow-list)", keysOf(gMember.json) === MEMBER_KEYS);
  check("2c. GET /team/:id: no userId, exact fields", gTeamOne.status === 200 && leakOf(gTeamOne) === "" && keysOf(gTeamOne.json) === PROFILE_KEYS);
  for (const [label, who] of [["MEMBER", memA.client], ["LAB_MANAGER", mgr.client], ["ADMIN", admin]]) {
    const rs = [await who.get("/team"), await who.get(`/team/${memB.tm.id}`), await who.get(`/member/${memB.tm.id}`), await who.get(`/member/${memA.tm.id}`)];
    check(`1/2. ${label}: /team, /team/:id, /member/:id carry no account id or credential key`, rs.every((x) => x.status === 200 && leakOf(x) === ""), rs.map(leakOf).join("|"));
  }
  const ownProfile = await memA.client.get("/profile");
  check("1/2. GET /profile (own): no account id, exact fields, isOwn true", ownProfile.status === 200 && leakOf(ownProfile) === "" && keysOf(ownProfile.json) === PROFILE_KEYS && ownProfile.json.isOwn === true);

  const aTeam = await memA.client.get("/team");
  const ownRows = aTeam.json.filter((m) => m.isOwn);
  check("3. own profile => isOwn true in /team, and only that one", ownRows.length === 1 && ownRows[0].id === memA.tm.id);
  check("3b. own profile => isOwn true in /member/:id and /team/:id", (await memA.client.get(`/member/${memA.tm.id}`)).json.isOwn === true && (await memA.client.get(`/team/${memA.tm.id}`)).json.isOwn === true);
  check("4. another member's profile => isOwn false (list, /team/:id, /member/:id)", aTeam.json.find((m) => m.id === memB.tm.id).isOwn === false && (await memA.client.get(`/team/${memB.tm.id}`)).json.isOwn === false && (await memA.client.get(`/member/${memB.tm.id}`)).json.isOwn === false);
  check("4b. a profile with no account is nobody's own (member, manager, admin, guest)", (await Promise.all([memA.client, mgr.client, admin, guest].map((c) => c.get(`/member/${unlinkedSeed.id}`)))).every((x) => x.json.isOwn === false));
  check("4c. managers can edit others but are not 'own' there; they are own on their own profile", (await mgr.client.get(`/member/${memA.tm.id}`)).json.isOwn === false && (await admin.get(`/member/${memA.tm.id}`)).json.isOwn === false && (await mgr.client.get(`/member/${mgr.tm.id}`)).json.isOwn === true);
  check("5. guest => isOwn false on every profile", gTeam.json.every((m) => m.isOwn === false) && gMember.json.isOwn === false && gTeamOne.json.isOwn === false);

  const cookieBeforeLogout = memA.client.cookie;
  check("6. logout succeeds", (await memA.client.post("/auth/logout")).json?.success === true);
  check("6b. after logout: own profile => isOwn false, nothing is own in /team", (await memA.client.get(`/member/${memA.tm.id}`)).json.isOwn === false && (await memA.client.get(`/team/${memA.tm.id}`)).json.isOwn === false && (await memA.client.get("/team")).json.every((m) => m.isOwn === false));
  const replayed = Object.assign(new Client(), { cookie: cookieBeforeLogout });
  check("7. replaying the logged-out session id => isOwn false", (await replayed.get(`/member/${memA.tm.id}`)).json.isOwn === false && (await replayed.get("/team")).json.every((m) => m.isOwn === false) && (await replayed.get("/auth/me")).json.user === null);
  await memA.client.login(memA.email, PW);
  check("6c. logging back in restores isOwn", (await memA.client.get(`/member/${memA.tm.id}`)).json.isOwn === true);

  const ghost = await mk("ghost", "MEMBER", "ZZ Test 91 Ghost");
  check("7b. (setup) a live session sees its own profile as own", (await ghost.client.get(`/member/${ghost.tm.id}`)).json.isOwn === true);
  const ghostCookie = ghost.client.cookie;
  check("7c. (setup) admin deletes the account; the profile is kept", (await admin.del(`/users/${ghost.id}`)).status === 200 && (await prisma.teamMember.findUnique({ where: { id: ghost.tm.id } }))?.userId === null);
  const stale = Object.assign(new Client(), { cookie: ghostCookie });
  check("7d. a session of a DELETED account => isOwn false on its old profile and in /team", (await stale.get(`/member/${ghost.tm.id}`)).json.isOwn === false && (await stale.get("/team")).json.every((m) => m.isOwn === false) && (await stale.get("/profile")).status === 401);
  const forged = Object.assign(new Client(), { cookie: "scl.sid=s%3Aforged.signature" });
  check("7e. a forged session cookie => isOwn false", (await forged.get(`/member/${memA.tm.id}`)).json.isOwn === false && (await forged.get("/team")).json.every((m) => m.isOwn === false));
  check("7f. Vary: Cookie is set on viewer-dependent profile responses", /cookie/i.test((await fetch(`${API}/api/team`)).headers.get("vary") ?? "") && /cookie/i.test((await fetch(`${API}/api/member/${memA.tm.id}`)).headers.get("vary") ?? ""));

  const created = await mgr.client.post("/team", { name: "ZZ Test 91 Created", initials: "ZC", role: "Research Student", category: "RESEARCH", userId: memA.id });
  check("mutation responses: POST /team has isOwn false, no userId; a client-sent userId is ignored", created.status === 201 && created.json.isOwn === false && leakOf(created) === "" && (await prisma.teamMember.findUnique({ where: { id: created.json.id } })).userId === null);
  const mgrEdit = await mgr.client.put(`/team/${memA.tm.id}`, { department: "Vision", userId: adminMe.id });
  check("mutation responses: manager PUT /team/:id of someone else => isOwn false, no userId", mgrEdit.status === 200 && mgrEdit.json.isOwn === false && leakOf(mgrEdit) === "");
  check("mass assignment: a client-sent userId can never re-link a profile", (await prisma.teamMember.findUnique({ where: { id: memA.tm.id } })).userId === memA.id);
  const ownEdit = await memA.client.put("/profile", { bio: "hello 91", userId: adminMe.id, isOwn: false, role: "ADMIN" });
  check("mutation responses: PUT /profile => isOwn true, no userId", ownEdit.status === 200 && ownEdit.json.isOwn === true && leakOf(ownEdit) === "");
  check("mass assignment: PUT /profile cannot re-link the profile or change the ACCOUNT role ('role' is the job title)", (await prisma.teamMember.findUnique({ where: { id: memA.tm.id } })).userId === memA.id && (await prisma.user.findUnique({ where: { id: memA.id } })).role === "MEMBER");
  const ownViaTeam = await memA.client.put(`/team/${memA.tm.id}`, { bio: "hello again" });
  check("mutation responses: own PUT /team/:id => isOwn true", ownViaTeam.status === 200 && ownViaTeam.json.isOwn === true && leakOf(ownViaTeam) === "");

  const nested = ["/projects", `/projects/${P1.id}`, `/projects/${P3.id}`, "/groups", `/groups/${G1.id}`, "/publications", `/publications/${pubPub.id}/authors`, "/news", `/news/${newsPub.id}/authors`, "/research", `/member/${leadP.tm.id}`, `/member/${memB.tm.id}`, `/member/${leadG.tm.id}`, "/team"];
  for (const [label, who] of [["guest", guest], ["MEMBER", memA.client], ["group lead", leadG.client], ["LAB_MANAGER", mgr.client], ["ADMIN", admin]]) {
    const bad = [];
    for (const p of nested) {
      const res = await who.get(p);
      if (res.status !== 200) bad.push(`${p} -> ${res.status}`);
      else if (leakOf(res)) bad.push(`${p}: ${leakOf(res)}`);
    }
    check(`8. ${label}: nested resources (projects, groups, authors, profiles, lists) carry no account id or credential`, bad.length === 0, bad.join("; "));
  }
  check("8b. project/group member entries expose only teamMemberId, name, initials, role", keysOf((await guest.get(`/projects/${P1.id}`)).json.members[0]) === "initials,name,role,teamMemberId" && keysOf((await guest.get(`/groups/${G1.id}`)).json.members[0]) === "initials,name,role,teamMemberId");

  // ------------------------------------------------------------------
  section("phase 9.1: group lead (own group: content + membership only)");
  const gl = leadG.client;
  const groupNow = () => prisma.researchGroup.findUnique({ where: { id: G1.id } });
  const g0 = await groupNow();
  check("(setup) the group lead is a plain MEMBER account", (await prisma.user.findUnique({ where: { id: leadG.id } })).role === "MEMBER" && (await gl.get(`/groups/${G1.id}`)).json.canEdit === true);
  check("9. group lead can edit content (name, description)", (await gl.put(`/groups/${G1.id}`, { name: "ZZ Test 91 Group Public v2", description: "written by the lead" })).status === 200 && (await groupNow()).description === "written by the lead" && (await groupNow()).name === "ZZ Test 91 Group Public v2");
  const gMembersOk = await gl.put(`/groups/${G1.id}/members`, { members: [{ teamMemberId: leadG.tm.id, role: "LEAD" }, { teamMemberId: memA.tm.id, role: "MEMBER" }, { teamMemberId: memB.tm.id, role: "MEMBER" }] });
  check("10. group lead can manage members (add, keep roles)", gMembersOk.status === 200 && (await prisma.groupMember.count({ where: { groupId: G1.id } })) === 3);
  check("10b. group lead can change a member's role and remove members", (await gl.put(`/groups/${G1.id}/members`, { members: [{ teamMemberId: leadG.tm.id, role: "LEAD" }, { teamMemberId: memA.tm.id, role: "LEAD" }] })).status === 200 && (await prisma.groupMember.count({ where: { groupId: G1.id } })) === 2);
  await mgr.client.put(`/groups/${G1.id}/members`, { members: [{ teamMemberId: leadG.tm.id, role: "LEAD" }, { teamMemberId: memA.tm.id, role: "MEMBER" }] });
  const gAudit = await prisma.auditLog.findMany({ where: { entityType: "RESEARCH_GROUP", entityId: G1.id, actorId: leadG.id } });
  check("34a. audit: the lead's allowed edits are recorded with the lead as actor", gAudit.some((a) => a.action === "GROUP_UPDATED") && gAudit.filter((a) => a.action === "GROUP_MEMBERS_CHANGED").length === 2);

  const g1 = await groupNow();
  const auditBeforeG = await prisma.auditLog.count();
  for (const [key, value] of [["visibility", "LAB_ONLY"], ["visibility", "PUBLIC"], ["slug", "lead-took-the-slug"], ["sortOrder", 7], ["sortOrder", 0]]) {
    const r = await gl.put(`/groups/${G1.id}`, { [key]: value });
    check(`${key === "visibility" ? "11" : key === "slug" ? "12" : "13"}. group lead cannot change ${key} to ${JSON.stringify(value)} (403)`, r.status === 403, String(r.status));
  }
  check("11-13. a mixed body (allowed + forbidden field) is rejected whole and saves nothing", (await gl.put(`/groups/${G1.id}`, { description: "sneaky", sortOrder: 9 })).status === 403 && (await groupNow()).description === "written by the lead");
  const g2 = await groupNow();
  check("11-13. ...the group row is untouched by every rejection", ["visibility", "slug", "sortOrder", "name", "description"].every((k) => g1[k] === g2[k]));
  check("moving: a group lead cannot move a project between groups (403; groups themselves have no parent)", (await gl.put(`/projects/${P1.id}`, { groupId: G2.id })).status === 403 && (await prisma.researchProject.findUnique({ where: { id: P1.id } })).groupId === G1.id);
  check("14. group lead cannot delete the group (403); the group and its projects survive", (await gl.del(`/groups/${G1.id}`)).status === 403 && !!(await groupNow()) && (await prisma.researchProject.count({ where: { groupId: G1.id } })) === 2);
  const roleBefore = (await prisma.user.findMany({ select: { id: true, role: true }, orderBy: { id: "asc" } })).map((u) => `${u.id}:${u.role}`).join();
  const roleTries = [
    await gl.put(`/users/${leadG.id}`, { role: "ADMIN" }), await gl.put(`/users/${leadG.id}`, { role: "LAB_MANAGER" }),
    await gl.put(`/users/${memB.id}`, { role: "LAB_MANAGER" }), await gl.put(`/users/${adminMe.id}`, { role: "MEMBER" }),
    await gl.get("/users"), await gl.post("/users", { email: "p9test-91-x@example.test", password: PW, role: "ADMIN" }), await gl.del(`/users/${memB.id}`),
  ];
  check("15. group lead cannot modify roles or accounts (all 403)", roleTries.every((x) => x.status === 403), roleTries.map((x) => x.status).join());
  check("15b. ...and no account role changed", (await prisma.user.findMany({ select: { id: true, role: true }, orderBy: { id: "asc" } })).map((u) => `${u.id}:${u.role}`).join() === roleBefore);
  check("15c. a group lead cannot make themself lead of another group or create groups/projects", (await gl.put(`/groups/${G2.id}/members`, { members: [{ teamMemberId: leadG.tm.id, role: "LEAD" }] })).status === 403 && (await gl.put(`/groups/${G2.id}`, { description: "x" })).status === 403 && (await gl.post("/groups", { name: "ZZ Test 91 nope" })).status === 403 && (await gl.post("/projects", { title: "ZZ Test 91 nope" })).status === 403 && (await prisma.groupMember.count({ where: { groupId: G2.id, teamMemberId: leadG.tm.id } })) === 0);
  check("15d. leading a group grants nothing on its projects (403)", (await gl.put(`/projects/${P1.id}`, { summary: "x" })).status === 403 && (await gl.put(`/projects/${P1.id}/members`, { members: [] })).status === 403);
  check("35a. audit: every rejected group-lead request left no audit row", (await prisma.auditLog.count()) === auditBeforeG);

  // ------------------------------------------------------------------
  section("phase 9.1: project lead (own project: content + relationships only)");
  const pl = leadP.client;
  const projNow = () => prisma.researchProject.findUnique({ where: { id: P1.id } });
  check("(setup) the project lead is a plain MEMBER account", (await prisma.user.findUnique({ where: { id: leadP.id } })).role === "MEMBER" && (await pl.get(`/projects/${P1.id}`)).json.canEdit === true);
  const edit = await pl.put(`/projects/${P1.id}`, { title: "ZZ Test 91 Proj Public v2", summary: "lead summary", description: "lead description", status: "COMPLETED", startDate: "2030-02-01", endDate: "2031-02-01" });
  const p1a = await projNow();
  check("16. project lead can edit content (title, summary, description, status, dates)", edit.status === 200 && p1a.title === "ZZ Test 91 Proj Public v2" && p1a.summary === "lead summary" && p1a.description === "lead description" && p1a.status === "COMPLETED");
  const relOk = [
    await pl.put(`/projects/${P1.id}/members`, { members: [{ teamMemberId: leadP.tm.id, role: "LEAD" }, { teamMemberId: memA.tm.id, role: "MEMBER" }, { teamMemberId: memB.tm.id, role: "COLLABORATOR" }] }),
    await pl.put(`/projects/${P1.id}/areas`, { areaIds: [areaPub.id] }),
    await pl.put(`/projects/${P1.id}/publications`, { publicationIds: [pubPub.id] }),
    await pl.put(`/projects/${P1.id}/news`, { newsIds: [newsPub.id] }),
  ];
  check("17. project lead can manage members, areas, publications, news", relOk.every((x) => x.status === 200) && (await prisma.projectMember.count({ where: { projectId: P1.id } })) === 3 && (await prisma.projectArea.count({ where: { projectId: P1.id } })) === 1);
  await mgr.client.put(`/projects/${P1.id}/members`, { members: [{ teamMemberId: leadP.tm.id, role: "LEAD" }, { teamMemberId: memA.tm.id, role: "MEMBER" }] });
  await mgr.client.put(`/projects/${P1.id}/areas`, { areaIds: [areaPub.id, areaHid.id] });
  await mgr.client.put(`/projects/${P1.id}/publications`, { publicationIds: [pubPub.id, pubHid.id] });
  await mgr.client.put(`/projects/${P1.id}/news`, { newsIds: [newsPub.id, newsHid.id] });
  const pAudit = await prisma.auditLog.findMany({ where: { entityType: "RESEARCH_PROJECT", entityId: P1.id, actorId: leadP.id } });
  check("34b. audit: the lead's allowed edits are recorded with the lead as actor", ["PROJECT_UPDATED", "PROJECT_MEMBERS_CHANGED", "PROJECT_AREAS_CHANGED", "PROJECT_PUBLICATIONS_CHANGED", "PROJECT_NEWS_CHANGED"].every((a) => pAudit.some((r) => r.action === a)));

  const p1 = await projNow();
  const auditBeforeP = await prisma.auditLog.count();
  for (const [key, value] of [["visibility", "LAB_ONLY"], ["visibility", "PUBLIC"], ["slug", "lead-took-the-slug"], ["sortOrder", 7], ["sortOrder", 0], ["groupId", null], ["groupId", G2.id], ["groupId", G1.id]]) {
    const r = await pl.put(`/projects/${P1.id}`, { [key]: value });
    check(`${key === "visibility" ? "18" : key === "slug" ? "19" : key === "sortOrder" ? "20" : "20b"}. project lead cannot change ${key} to ${JSON.stringify(value)} (403)`, r.status === 403, String(r.status));
  }
  check("18-20. a mixed body (allowed + forbidden field) is rejected whole and saves nothing", (await pl.put(`/projects/${P1.id}`, { summary: "sneaky", visibility: "LAB_ONLY" })).status === 403 && (await projNow()).summary === "lead summary");
  const p2 = await projNow();
  check("18-20. ...the project row is untouched by every rejection", ["visibility", "slug", "sortOrder", "groupId", "title", "summary"].every((k) => p1[k] === p2[k]));
  check("21. project lead cannot delete the project (403); it and its links survive", (await pl.del(`/projects/${P1.id}`)).status === 403 && !!(await projNow()) && (await prisma.projectMember.count({ where: { projectId: P1.id } })) === 2);
  check("a project lead cannot edit other projects, their group, or create anything (403)", (await pl.put(`/projects/${P2.id}`, { summary: "x" })).status === 403 && (await pl.put(`/projects/${P3.id}/members`, { members: [] })).status === 403 && (await pl.put(`/groups/${G1.id}`, { description: "x" })).status === 403 && (await pl.put(`/groups/${G1.id}/members`, { members: [] })).status === 403 && (await pl.post("/projects", { title: "ZZ Test 91 nope" })).status === 403 && (await pl.post("/groups", { name: "ZZ Test 91 nope" })).status === 403);
  const projRoleTries = [await pl.put(`/users/${leadP.id}`, { role: "ADMIN" }), await pl.put(`/users/${memB.id}`, { role: "LAB_MANAGER" }), await pl.get("/users"), await pl.post("/users", { email: "p9test-91-y@example.test", password: PW }), await pl.del(`/users/${memB.id}`)];
  check("project lead cannot change roles or manage accounts (all 403), roles unchanged", projRoleTries.every((x) => x.status === 403) && (await prisma.user.findMany({ select: { id: true, role: true }, orderBy: { id: "asc" } })).map((u) => `${u.id}:${u.role}`).join() === roleBefore);
  check("35b. audit: every rejected project-lead request left no audit row", (await prisma.auditLog.count()) === auditBeforeP);

  // ------------------------------------------------------------------
  section("phase 9.1: visibility (guest vs account), nested data and counts");
  const guestSees = async (path) => (await guest.get(path)).status;
  const memSees = async (path) => (await memA.client.get(path)).status;
  check("22. guest cannot see a LAB_ONLY project (404, absent from the list); a member can", (await guestSees(`/projects/${P2.id}`)) === 404 && !idsOf(await guest.get("/projects")).includes(P2.id) && (await memSees(`/projects/${P2.id}`)) === 200 && idsOf(await memA.client.get("/projects")).includes(P2.id));
  check("23. guest cannot see a LAB_ONLY group (404, absent from the list); a member can", (await guestSees(`/groups/${G2.id}`)) === 404 && !idsOf(await guest.get("/groups")).includes(G2.id) && (await memSees(`/groups/${G2.id}`)) === 200 && idsOf(await memA.client.get("/groups")).includes(G2.id));
  check("24. guest cannot see a LAB_ONLY publication (404 + authors 404, absent from the list); a member can", (await guestSees(`/publications/${pubHid.id}`)) === 404 && (await guestSees(`/publications/${pubHid.id}/authors`)) === 404 && !idsOf(await guest.get("/publications")).includes(pubHid.id) && (await memSees(`/publications/${pubHid.id}`)) === 200);
  check("25. guest cannot see LAB_ONLY news (404 + authors 404, absent from the list); a member can", (await guestSees(`/news/${newsHid.id}`)) === 404 && (await guestSees(`/news/${newsHid.id}/authors`)) === 404 && !idsOf(await guest.get("/news")).includes(newsHid.id) && (await memSees(`/news/${newsHid.id}`)) === 200);
  check("26. guest cannot see a LAB_ONLY research area (404, absent from the list); a member can", (await guestSees(`/research/${areaHid.id}`)) === 404 && !idsOf(await guest.get("/research")).includes(areaHid.id) && (await memSees(`/research/${areaHid.id}`)) === 200);
  check("22-26. every hidden 404 is byte-identical to a missing id", (await Promise.all([`/projects/${P2.id}`, `/groups/${G2.id}`, `/publications/${pubHid.id}`, `/news/${newsHid.id}`, `/research/${areaHid.id}`].map((p, i) => guest.get(p).then(async (h) => JSON.stringify(h.json) === JSON.stringify((await guest.get(["/projects", "/groups", "/publications", "/news", "/research"][i] + "/doesnotexist")).json))))).every(Boolean));

  const projGuest = await guest.get(`/projects/${P3.id}`), projList = await guest.get("/projects"), groupList = await guest.get("/groups");
  const seenByGuest = JSON.stringify([projGuest.json, projList.json, groupList.json, (await guest.get(`/member/${memB.tm.id}`)).json, (await guest.get(`/groups/${G1.id}`)).json]);
  check("27. public project in a hidden group: guest sees group = null (detail and list)", projGuest.json.group === null && projList.json.find((p) => p.id === P3.id).group === null);
  check("27b. ...and the hidden group's id, name and slug appear nowhere in guest responses", ![G2.id, G2.name, G2.slug].some((s) => seenByGuest.includes(s)));
  check("27c. a member sees the same project's group", (await memA.client.get(`/projects/${P3.id}`)).json.group?.id === G2.id);
  check("27d. a hidden group's members' profile shows nothing of it to a guest (no group, no hidden project), a member sees both", (await guest.get(`/member/${memB.tm.id}`)).json.groups.length === 0 && !(await guest.get(`/member/${memB.tm.id}`)).json.projects.some((p) => p.id === P2.id) && (await memA.client.get(`/member/${memB.tm.id}`)).json.groups.some((g) => g.id === G2.id) && (await memA.client.get(`/member/${memB.tm.id}`)).json.projects.some((p) => p.id === P2.id));

  const cnt = async (c) => [(await c.get(`/groups/${G1.id}`)).json, (await c.get("/groups")).json.find((g) => g.id === G1.id)];
  const [gd1, gl1] = await cnt(guest), [gd2, gl2] = await cnt(memA.client);
  check("28. hidden counts are filtered: guest projectCount = 1 (detail and list), member = 2", gd1.projectCount === 1 && gl1.projectCount === 1 && gd1.projects.length === 1 && gd2.projectCount === 2 && gl2.projectCount === 2 && gd2.projects.length === 2);
  check("28b. the count follows visibility live: publishing the hidden project makes it 2 for guests, hiding it again returns 1", (await mgr.client.put(`/projects/${P2.id}`, { visibility: "PUBLIC" })).status === 200 && (await cnt(guest))[0].projectCount === 2 && (await mgr.client.put(`/projects/${P2.id}`, { visibility: "LAB_ONLY" })).status === 200 && (await cnt(guest))[0].projectCount === 1 && (await cnt(guest))[1].projectCount === 1);
  const pubParent = JSON.stringify([(await guest.get(`/projects/${P1.id}`)).json, (await guest.get(`/groups/${G1.id}`)).json, (await guest.get("/projects")).json, (await guest.get("/groups")).json, (await guest.get(`/member/${leadP.tm.id}`)).json, (await guest.get(`/member/${memA.tm.id}`)).json, (await guest.get(`/member/${memB.tm.id}`)).json]);
  const hiddenTitles = [P2.id, P2.title, areaHid.id, areaHid.title, pubHid.id, pubHid.title, newsHid.id, newsHid.title, G2.id];
  check("29. a public parent never reveals hidden children (project/group/list/profile JSON has no hidden id or title)", !hiddenTitles.some((s) => pubParent.includes(s)));
  const p1g = (await guest.get(`/projects/${P1.id}`)).json;
  check("29b. public project P1: guest gets only the public area/publication/news; a member gets both", p1g.areas.length === 1 && p1g.publications.length === 1 && p1g.news.length === 1 && (await memA.client.get(`/projects/${P1.id}`)).json.areas.length === 2 && (await memA.client.get(`/projects/${P1.id}`)).json.publications.length === 2 && (await memA.client.get(`/projects/${P1.id}`)).json.news.length === 2);
  check("29c. the hidden project is absent from its (public) group's guest view and from members' guest profiles", !(await guest.get(`/groups/${G1.id}`)).json.projects.some((p) => p.id === P2.id) && !(await guest.get(`/member/${memB.tm.id}`)).json.projects.some((p) => p.id === P2.id));
  check("29d. the `visibility` field is never sent to guests or plain members", ![await guest.get(`/projects/${P1.id}`), await guest.get(`/groups/${G1.id}`), await memA.client.get(`/projects/${P2.id}`), await memA.client.get("/groups"), await memA.client.get("/publications")].some((x) => JSON.stringify(x.json).includes('"visibility"')));

  // ------------------------------------------------------------------
  section("phase 9.1: authorization consistency (MEMBER / LAB_MANAGER / ADMIN / unknown role)");
  const memberAttempts = [
    ["POST", "/projects", { title: "ZZ Test 91 nope" }], ["POST", "/groups", { name: "ZZ Test 91 nope" }],
    ["DELETE", `/publications/${pubPub.id}`], ["DELETE", `/news/${newsPub.id}`], ["DELETE", `/research/${areaPub.id}`],
    ["PUT", `/publications/${pubPub.id}`, { visibility: "LAB_ONLY" }], ["PUT", `/news/${newsPub.id}`, { visibility: "LAB_ONLY" }], ["PUT", `/research/${areaPub.id}`, { visibility: "LAB_ONLY" }],
    ["POST", "/team", { name: "ZZ Test 91 nope", initials: "N", role: "r", category: "MSC" }], ["PUT", `/team/${memB.tm.id}`, { bio: "hax" }], ["DELETE", `/team/${memB.tm.id}`],
    ["POST", `/member/${memB.tm.id}/history`, { year: "2024", title: "hax" }], ["PUT", `/member/${memB.tm.id}/publications`, { publicationIds: [] }],
    ["PUT", `/projects/${P1.id}`, { summary: "x" }], ["PUT", `/projects/${P1.id}/members`, { members: [] }], ["DELETE", `/projects/${P1.id}`],
    ["PUT", `/groups/${G1.id}`, { description: "x" }], ["PUT", `/groups/${G1.id}/members`, { members: [] }], ["DELETE", `/groups/${G1.id}`],
  ];
  const memberRes = [];
  for (const [m, p, b] of memberAttempts) memberRes.push(`${m} ${p.replace(/[a-z0-9]{20,}/g, ":id")} -> ${(await memA.client.req(m, p, b)).status}`);
  check("30. MEMBER cannot perform any manager operation (all 403)", memberRes.every((s) => s.endsWith("403")), memberRes.filter((s) => !s.endsWith("403")).join("; "));
  check("30b. ...and none of them changed anything", !!(await prisma.publication.findUnique({ where: { id: pubPub.id } })) && !!(await prisma.teamMember.findUnique({ where: { id: memB.tm.id } })) && (await prisma.publication.findUnique({ where: { id: pubPub.id } })).visibility === "PUBLIC" && (await prisma.researchProject.count({ where: { title: "ZZ Test 91 nope" } })) === 0);

  const mgrAttempts = [["GET", "/users"], ["POST", "/users", { email: "p9test-91-z@example.test", password: PW }], ["PUT", `/users/${memB.id}`, { role: "LAB_MANAGER" }], ["PUT", `/users/${memB.id}`, { role: "ADMIN" }], ["PUT", `/users/${adminMe.id}`, { role: "MEMBER" }], ["PUT", `/users/${mgr.id}`, { role: "ADMIN" }], ["DELETE", `/users/${memB.id}`], ["DELETE", `/team/${memB.tm.id}`]];
  const mgrRes = [];
  for (const [m, p, b] of mgrAttempts) mgrRes.push(`${m} ${p.replace(/[a-z0-9]{20,}/g, ":id")} -> ${(await mgr.client.req(m, p, b)).status}`);
  check("31. LAB_MANAGER cannot perform ADMIN-only account/role/team-delete operations (all 403)", mgrRes.every((s) => s.endsWith("403")), mgrRes.join("; "));
  check("31b. ...and the accounts/profile are untouched", (await prisma.user.findMany({ select: { id: true, role: true }, orderBy: { id: "asc" } })).map((u) => `${u.id}:${u.role}`).join() === roleBefore && !!(await prisma.teamMember.findUnique({ where: { id: memB.tm.id } })));
  check("31c. LAB_MANAGER keeps the manager powers: create + delete a project, set visibility", await (async () => {
    const t = (await mgr.client.post("/projects", { title: "ZZ Test 91 mgr project" })).json;
    return !!t?.id && (await mgr.client.put(`/projects/${t.id}`, { visibility: "PUBLIC" })).status === 200 && (await mgr.client.del(`/projects/${t.id}`)).status === 200;
  })());

  const selfCases = [["MEMBER", memA], ["group lead", leadG], ["LAB_MANAGER", mgr]];
  for (const [label, u] of selfCases) {
    const tries = [];
    for (const role of ["ADMIN", "LAB_MANAGER", "MEMBER"]) tries.push((await u.client.put(`/users/${u.id}`, { role })).status);
    check(`32. ${label} cannot change their own role at all (promote, sideways or demote)`, tries.every((s) => s === 403), tries.join());
  }
  const adminTries = [];
  for (const role of ["ADMIN", "LAB_MANAGER", "MEMBER"]) adminTries.push((await admin.put(`/users/${adminMe.id}`, { role })).status);
  check("32b. ADMIN cannot change their own role either (400)", adminTries.every((s) => s === 400), adminTries.join());
  check("32c. no self-role change happened: every account still has its original role", (await prisma.user.findMany({ select: { id: true, role: true }, orderBy: { id: "asc" } })).map((u) => `${u.id}:${u.role}`).join() === roleBefore && (await prisma.user.findUnique({ where: { id: adminMe.id } })).role === "ADMIN");
  check("32d. nobody but an admin can grant ADMIN or LAB_MANAGER to anyone", (await memA.client.put(`/users/${memB.id}`, { role: "LAB_MANAGER" })).status === 403 && (await mgr.client.put(`/users/${memB.id}`, { role: "LAB_MANAGER" })).status === 403 && (await prisma.user.findUnique({ where: { id: memB.id } })).role === "MEMBER");
  const promoted = await admin.put(`/users/${memB.id}`, { role: "LAB_MANAGER" });
  check("32e. (control) an admin CAN grant a role to another account, and it takes effect on the live session at once", promoted.status === 200 && (await memB.client.post("/groups", { name: "ZZ Test 91 promoted" })).status === 201 && (await admin.put(`/users/${memB.id}`, { role: "MEMBER" })).status === 200 && (await memB.client.post("/groups", { name: "ZZ Test 91 demoted" })).status === 403);

  const odd = await mk("odd", "MEMBER", "ZZ Test 91 Odd");
  for (const weird of ["SUPERUSER", "admin", "lab_manager", "ADMIN ", ""]) {
    await prisma.user.update({ where: { id: odd.id }, data: { role: weird } });
    const me = (await odd.client.get("/auth/me")).json?.user;
    const denied = [(await odd.client.get("/users")).status, (await odd.client.post("/groups", { name: "ZZ Test 91 rogue" })).status, (await odd.client.post("/projects", { title: "ZZ Test 91 rogue" })).status, (await odd.client.del(`/publications/${pubPub.id}`)).status, (await odd.client.put(`/publications/${pubPub.id}`, { visibility: "LAB_ONLY" })).status, (await odd.client.del(`/team/${memB.tm.id}`)).status];
    check(`33. unknown role ${JSON.stringify(weird)} => treated as MEMBER: no manager/admin power (all 403)`, me?.role === "MEMBER" && denied.every((s) => s === 403), `${me?.role} ${denied.join()}`);
    check(`33b. ...but still a normal account: sees LAB_ONLY content, no visibility field`, (await odd.client.get(`/projects/${P2.id}`)).status === 200 && !JSON.stringify((await odd.client.get(`/projects/${P2.id}`)).json).includes('"visibility"'));
  }

  const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === "node_modules" || n === "dist" ? [] : walk(p)) : /\.(ts|tsx)$/.test(n) ? [p] : []; });
  const serverSrc = fileURLToPath(new URL("../src/", import.meta.url));
  const webSrc = fileURLToPath(new URL("../../web/src/", import.meta.url));
  const sharedSchemas = fileURLToPath(new URL("../../../packages/shared/src/schemas/", import.meta.url));
  const inlineRole = /(?:\.role|\brole)\s*[!=]==?\s*["'`](?:ADMIN|LAB_MANAGER|MEMBER)["'`]|["'`](?:ADMIN|LAB_MANAGER|MEMBER)["'`]\s*[!=]==?\s*\w+(?:\.\w+)*\.role\b/;
  const inlineHits = [...walk(serverSrc), ...walk(webSrc)].filter((f) => inlineRole.test(readFileSync(f, "utf8")));
  check("static: no inline role comparison (role === \"ADMIN\" ...) in server or web source; only permissions.ts decides", inlineHits.length === 0, inlineHits.join());
  const userIdInWeb = walk(webSrc).filter((f) => /\buserId\b/.test(readFileSync(f, "utf8")));
  const userIdInSchemas = walk(sharedSchemas).filter((f) => /\buserId\b/.test(readFileSync(f, "utf8")));
  check("static: no frontend code or shared response schema mentions userId (ownership uses isOwn)", userIdInWeb.length === 0 && userIdInSchemas.length === 0, [...userIdInWeb, ...userIdInSchemas].join());
  const routeFiles = readdirSync(serverSrc + "routes").filter((f) => f.endsWith(".routes.ts"));
  const unguarded = [];
  let mutating = 0;
  for (const f of routeFiles) {
    const src = readFileSync(serverSrc + "routes/" + f, "utf8");
    const routerGuard = /router\.use\(\s*require/.test(src);
    for (const m of src.matchAll(/router\.(post|put|patch|delete)\(\s*"([^"]*)"([\s\S]*?)(?:asyncHandler\(|\(req, res\) =>)/g)) {
      mutating++;
      if (!routerGuard && !/\brequire\w+/.test(m[3])) unguarded.push(`${f} ${m[1].toUpperCase()} ${m[2]}`);
    }
  }
  check("static: every mutating route has an auth/policy guard (only login/logout are open)", mutating >= 36 && unguarded.sort().join("|") === "auth.routes.ts POST /login|auth.routes.ts POST /logout", `${mutating} routes; unguarded: ${unguarded.join("; ")}`);

  // ------------------------------------------------------------------
  section("phase 9.1: audit regression");
  const cnt0 = await prisma.auditLog.count();
  const rejected = [
    () => guest.put(`/projects/${P1.id}`, { summary: "x" }), () => guest.post("/groups", { name: "ZZ Test 91 nope" }), () => guest.put(`/team/${memA.tm.id}`, { bio: "x" }),
    () => memA.client.put(`/projects/${P1.id}`, { summary: "x" }), () => memA.client.put(`/publications/${pubPub.id}`, { visibility: "LAB_ONLY" }), () => memA.client.put(`/users/${memA.id}`, { role: "ADMIN" }),
    () => leadP.client.put(`/projects/${P1.id}`, { visibility: "LAB_ONLY" }), () => leadG.client.put(`/groups/${G1.id}`, { slug: "x-y" }), () => leadG.client.del(`/groups/${G1.id}`),
    () => mgr.client.put(`/users/${memA.id}`, { role: "ADMIN" }), () => mgr.client.del(`/team/${memA.tm.id}`), () => mgr.client.post("/projects", { title: "   " }),
    () => mgr.client.put(`/projects/${P1.id}`, { status: "DONE" }), () => mgr.client.put("/projects/doesnotexist", { summary: "x" }), () => mgr.client.put(`/projects/${P1.id}/members`, { members: [{ teamMemberId: "doesnotexist" }] }),
    () => mgr.client.put("/projects/bad!id", { summary: "x" }), () => admin.put(`/users/${adminMe.id}`, { role: "MEMBER" }), () => admin.del(`/users/${adminMe.id}`), () => admin.post("/users", { email: memA.email, password: PW }),
    () => odd.client.post("/groups", { name: "ZZ Test 91 rogue" }),
  ];
  const codes = [];
  for (const fn of rejected) codes.push((await fn()).status);
  check("35. rejected mutations (401/403/400/404/409) create no audit record", codes.every((c) => c >= 400) && (await prisma.auditLog.count()) === cnt0, `codes ${codes.join()}`);

  const before34 = await prisma.auditLog.count();
  const newProj = (await mgr.client.post("/projects", { title: "ZZ Test 91 audited" })).json;
  await mgr.client.put(`/projects/${newProj.id}`, { visibility: "PUBLIC", summary: "s" });
  await admin.put(`/users/${memB.id}`, { role: "LAB_MANAGER" });
  await admin.put(`/users/${memB.id}`, { role: "MEMBER" });
  await mgr.client.put(`/team/${memA.tm.id}`, { department: "Audited" });
  await mgr.client.del(`/projects/${newProj.id}`);
  const has = async (action, entityId, actorId) => (await prisma.auditLog.count({ where: { action, entityId, actorId } })) > 0;
  const wanted = [["PROJECT_CREATED", newProj.id, mgr.id], ["PROJECT_UPDATED", newProj.id, mgr.id], ["CONTENT_VISIBILITY_CHANGED", newProj.id, mgr.id], ["ROLE_CHANGED", memB.id, adminMe.id], ["TEAM_MEMBER_UPDATED", memA.tm.id, mgr.id], ["PROJECT_DELETED", newProj.id, mgr.id]];
  const found = await Promise.all(wanted.map((w) => has(...w)));
  check("34. important mutations create audit rows with the right actor (create, update, visibility, role change, team update, delete)", found.every(Boolean) && (await prisma.auditLog.count()) - before34 >= 7, found.join());
  const roleAudit = (await prisma.auditLog.findMany({ where: { entityType: "USER", entityId: memB.id, action: "ROLE_CHANGED" } })).map(detailsOf);
  check("34c. the role-change rows record from/to, and account creation was audited too", roleAudit.some((d) => d.from === "MEMBER" && d.to === "LAB_MANAGER") && roleAudit.some((d) => d.from === "LAB_MANAGER" && d.to === "MEMBER") && (await prisma.auditLog.count({ where: { action: "USER_CREATED", entityId: leadP.id } })) === 1);

  const all = await prisma.auditLog.findMany({ where: { createdAt: { gte: RUN_STARTED } } });
  const blob = all.map((r) => `${r.details ?? ""}\n${r.actorEmail}`).join("\n");
  const secrets = [PW, ADMIN.password, "scl.sid", "passwordHash", ...[memA, memB, leadG, leadP, mgr, admin].map((u) => u.client?.cookie ?? u.cookie).filter(Boolean)];
  const hashes = (await prisma.user.findMany({ select: { passwordHash: true } })).map((u) => u.passwordHash);
  const sids = (await prisma.session.findMany({ select: { id: true } })).map((s) => s.id);
  check("36. audit rows hold no password, hash, cookie, session id or token (checked against real values from this run)", !secrets.some((s) => blob.includes(s)) && !hashes.some((h) => blob.includes(h)) && !sids.some((s) => blob.includes(s)) && !/\$2[aby]\$/.test(blob) && !/token/i.test(blob), "");
  check("36b. every audit details value is flat JSON with no forbidden key", all.every((r) => { if (!r.details) return true; const d = JSON.parse(r.details); return Object.entries(d).every(([k, v]) => !/pass|hash|secret|token|cookie|session|body|content|message/i.test(k) && (v === null || ["string", "number", "boolean"].includes(typeof v))); }));
  check("36c. audit rows never carry account ids as detail VALUES named userId", all.every((r) => !("userId" in detailsOf(r))));
}

main()
  .catch((e) => {
    console.error("Script crashed:", e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
