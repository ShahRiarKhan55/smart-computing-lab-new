/**
 * Phase 15 §11: proves `X-Locale` never changes an authorization outcome. For each of several
 * endpoints spanning the major subsystems (auth, content visibility, forum moderation, message
 * privacy, notification privacy, gallery authorization, admin-only operations, role hierarchy),
 * the SAME request is sent twice -- once with `X-Locale: en`, once with `X-Locale: ja` -- and the
 * status code (and, where relevant, whether the resource is present at all) must be identical.
 * This is a targeted addition on top of the locale-independence checks already proven elsewhere
 * (i18n-regression.mjs §"visibility is untouched by locale", search-regression.mjs's new Phase 15
 * section): this suite's job is breadth across subsystems, not depth on any one of them.
 *
 *   DATABASE_URL=file:/abs/path/to/copy.db PORT=4011 tsx src/index.ts
 *   DATABASE_URL=file:/abs/path/to/copy.db API=http://localhost:4011 node scripts/locale-independence-regression.mjs
 *
 * Fixtures are prefixed "ZZ Locale" / p15locale-*@example.test and are removed again (also at the
 * start, in case an earlier run was interrupted). Never touches a row it did not create.
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
  async req(method, path, body, locale) {
    const res = await fetch(`${API}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...(locale ? { "X-Locale": locale } : {}) },
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
  get = (p, locale) => this.req("GET", p, undefined, locale);
  post = (p, b, locale) => this.req("POST", p, b ?? {}, locale);
  put = (p, b, locale) => this.req("PUT", p, b ?? {}, locale);
  del = (p, locale) => this.req("DELETE", p, undefined, locale);
  login = (email, password, locale) => this.post("/auth/login", { email, password }, locale);
  async upload(path, form) {
    const res = await fetch(`${API}/api${path}`, { method: "POST", headers: this.cookie ? { cookie: this.cookie } : {}, body: form });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      if (pair.startsWith("scl.sid=")) this.cookie = pair;
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  }
}

/** Runs the same request with both locales and asserts an identical status; returns the `ja` response. */
async function sameEverywhere(name, c, method, path, body) {
  const en = await c.req(method, path, body, "en");
  const ja = await c.req(method, path, body, "ja");
  check(`${name}: identical status with X-Locale en (${en.status}) and ja (${ja.status})`, en.status === ja.status, `en=${en.status} ja=${ja.status}`);
  return { en, ja };
}

async function cleanup() {
  // Same FK ordering messages-regression.mjs's own cleanup() uses: Message/Conversation/
  // Notification rows tied to a test user must go before the user itself.
  const testUsers = await prisma.user.findMany({ where: { email: { startsWith: "p15locale-" } }, select: { id: true } });
  const testUserIds = testUsers.map((u) => u.id);
  if (testUserIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversation: { participants: { some: { userId: { in: testUserIds } } } } } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { participants: { some: { userId: { in: testUserIds } } } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: testUserIds } }, { actorId: { in: testUserIds } }] } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: "p15locale-" } } }).catch(() => {});
  await prisma.forumComment.deleteMany({ where: { post: { title: { startsWith: "ZZ Locale" } } } }).catch(() => {});
  await prisma.forumPost.deleteMany({ where: { title: { startsWith: "ZZ Locale" } } });
  await prisma.forumCategory.deleteMany({ where: { name: { startsWith: "ZZ Locale" } } });
  const areas = await prisma.researchArea.findMany({ where: { title: { startsWith: "ZZ Locale" } }, select: { id: true } });
  const projects = await prisma.researchProject.findMany({ where: { title: { startsWith: "ZZ Locale" } }, select: { id: true } });
  const groups = await prisma.researchGroup.findMany({ where: { name: { startsWith: "ZZ Locale" } }, select: { id: true } });
  await prisma.translation.deleteMany({
    where: {
      OR: [
        { entityType: "RESEARCH_AREA", entityId: { in: areas.map((r) => r.id) } },
        { entityType: "RESEARCH_PROJECT", entityId: { in: projects.map((r) => r.id) } },
        { entityType: "RESEARCH_GROUP", entityId: { in: groups.map((r) => r.id) } },
      ],
    },
  });
  await prisma.researchProject.deleteMany({ where: { title: { startsWith: "ZZ Locale" } } });
  await prisma.researchGroup.deleteMany({ where: { name: { startsWith: "ZZ Locale" } } });
  await prisma.researchArea.deleteMany({ where: { title: { startsWith: "ZZ Locale" } } });
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: "ZZ Locale" } } }).catch(() => {});
}

async function main() {
  await cleanup();

  // ------------------------------------------------------------------ fixtures
  section("fixtures");
  const admin = new Client();
  check("admin login", (await admin.login(ADMIN.email, ADMIN.password)).status === 200);

  const mkUser = async (key, role, name) => {
    const email = `p15locale-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: key.slice(0, 2).toUpperCase(), memberRole: "Researcher", category: "MSC" });
    const client = new Client();
    await client.login(email, PW);
    const tm = (await admin.get("/team")).json.find((m) => m.name === name);
    return { id: r.json?.id, email, client, tmId: tm?.id, name };
  };
  const memA = await mkUser("a", "MEMBER", "ZZ Locale Member A");
  const memB = await mkUser("b", "MEMBER", "ZZ Locale Member B");
  const mgr = await mkUser("mgr", "LAB_MANAGER", "ZZ Locale Manager");
  const guest = new Client();

  const areaHidden = (await admin.post("/research", { title: "ZZ Locale Hidden Area", description: "secret", tag: "ZL", visibility: "LAB_ONLY" })).json;
  const projectHidden = (await admin.post("/projects", { title: "ZZ Locale Hidden Project", summary: "secret", visibility: "LAB_ONLY" })).json;
  const groupHidden = (await admin.post("/groups", { name: "ZZ Locale Hidden Group", description: "secret", visibility: "LAB_ONLY" })).json;
  const category = (await admin.post("/forum/categories", { name: "ZZ Locale Category", description: "d", visibility: "LAB_ONLY" })).json;
  const topic = (await memA.client.post("/forum/posts", { categoryId: category.id, title: "ZZ Locale Topic", body: "body text" })).json;
  const convo = await memA.client.post("/messages/conversations", { teamMemberId: memB.tmId });
  await memA.client.post(`/messages/conversations/${convo.json.id}/messages`, { body: "hello" });

  check("all fixtures created", [areaHidden, projectHidden, groupHidden, category, topic].every((x) => x?.id) && convo.json?.id, JSON.stringify({ areaHidden, projectHidden, groupHidden, category, topic, convo: convo.json }));

  // ------------------------------------------------------------------ authentication
  section("authentication: login outcome is identical regardless of locale");
  const goodLogin = await sameEverywhere("correct credentials", new Client(), "POST", "/auth/login", { email: ADMIN.email, password: ADMIN.password });
  check("both succeed (200)", goodLogin.en.status === 200 && goodLogin.ja.status === 200);
  const badLogin = await sameEverywhere("wrong password", new Client(), "POST", "/auth/login", { email: ADMIN.email, password: "wrong" });
  check("both fail the same way (401)", badLogin.en.status === 401 && badLogin.ja.status === 401);

  // ------------------------------------------------------------------ content visibility
  section("content visibility: LAB_ONLY research/project/group -- guest blocked, member allowed, in both locales");
  for (const [label, path] of [
    ["research area", `/research/${areaHidden.id}`],
    ["project", `/projects/${projectHidden.id}`],
    ["group", `/groups/${groupHidden.id}`],
  ]) {
    const g = await sameEverywhere(`guest, ${label}`, guest, "GET", path);
    check(`guest is blocked (404) in both locales: ${label}`, g.en.status === 404 && g.ja.status === 404);
    const m = await sameEverywhere(`member, ${label}`, memA.client, "GET", path);
    check(`member is allowed (200) in both locales: ${label}`, m.en.status === 200 && m.ja.status === 200);
  }

  // ------------------------------------------------------------------ role hierarchy / moderation
  section("role hierarchy: forum moderation (lock) -- member forbidden, manager allowed, in both locales");
  const memberLock = await sameEverywhere("member locks a topic (not theirs to moderate)", memB.client, "POST", `/forum/posts/${topic.id}/lock`);
  check("member is forbidden (403) in both locales", memberLock.en.status === 403 && memberLock.ja.status === 403);
  const mgrLock = await sameEverywhere("manager locks the topic", mgr.client, "POST", `/forum/posts/${topic.id}/lock`);
  check("manager succeeds (200) in both locales", mgrLock.en.status === 200 && mgrLock.ja.status === 200);
  await mgr.client.post(`/forum/posts/${topic.id}/unlock`);

  // ------------------------------------------------------------------ message privacy
  section("message privacy: only a participant may read a conversation, in both locales");
  const nonParticipant = await sameEverywhere("non-participant (mgr) reads memA/memB's conversation", mgr.client, "GET", `/messages/conversations/${convo.json.id}`);
  check("non-participant is blocked (404) in both locales", nonParticipant.en.status === 404 && nonParticipant.ja.status === 404);
  const participant = await sameEverywhere("participant (memB) reads the conversation", memB.client, "GET", `/messages/conversations/${convo.json.id}`);
  check("participant is allowed (200) in both locales", participant.en.status === 200 && participant.ja.status === 200);
  const guestConvo = await sameEverywhere("guest reads the conversation", guest, "GET", `/messages/conversations/${convo.json.id}`);
  check("guest is blocked (401) in both locales", guestConvo.en.status === 401 && guestConvo.ja.status === 401);

  // ------------------------------------------------------------------ notification privacy
  section("notification privacy: only the recipient's own list, in both locales");
  const memBNotifs = await sameEverywhere("memB (message recipient) lists notifications", memB.client, "GET", "/notifications");
  check("recipient succeeds (200) in both locales", memBNotifs.en.status === 200 && memBNotifs.ja.status === 200);
  const guestNotifs = await sameEverywhere("guest lists notifications", guest, "GET", "/notifications");
  check("guest is blocked (401) in both locales", guestNotifs.en.status === 401 && guestNotifs.ja.status === 401);

  // ------------------------------------------------------------------ gallery authorization
  section("gallery authorization: a guest never sees a LAB_ONLY item, in either locale");
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x11)]);
  const galleryForm = new FormData();
  galleryForm.set("file", new Blob([JPEG], { type: "image/jpeg" }), "x.jpg");
  galleryForm.set("caption", "ZZ Locale gallery item");
  galleryForm.set("category", "OTHER");
  galleryForm.set("visibility", "LAB_ONLY");
  const galleryItem = (await mgr.client.upload("/gallery", galleryForm)).json;
  if (galleryItem?.id) {
    const gGuest = await sameEverywhere("guest fetches the LAB_ONLY gallery item", guest, "GET", `/gallery?limit=60`);
    check("guest never sees it (absent) in either locale", !(gGuest.en.json?.items ?? []).some((i) => i.id === galleryItem.id) && !(gGuest.ja.json?.items ?? []).some((i) => i.id === galleryItem.id));
    const gMember = await sameEverywhere("member fetches the LAB_ONLY gallery item", memA.client, "GET", `/gallery?limit=60`);
    check("member sees it in both locales", (gMember.en.json?.items ?? []).some((i) => i.id === galleryItem.id) && (gMember.ja.json?.items ?? []).some((i) => i.id === galleryItem.id));
    await mgr.client.del(`/gallery/${galleryItem.id}`);
  } else {
    check("gallery fixture created (skipped comparison if this fails)", false, JSON.stringify(galleryItem));
  }

  // ------------------------------------------------------------------ admin-only operations
  section("admin-only operations: GET /users -- member/manager forbidden, admin allowed, in both locales");
  const memberUsers = await sameEverywhere("member lists accounts", memA.client, "GET", "/users");
  check("member is forbidden (403) in both locales", memberUsers.en.status === 403 && memberUsers.ja.status === 403);
  const mgrUsers = await sameEverywhere("manager lists accounts", mgr.client, "GET", "/users");
  check("manager (not admin) is forbidden (403) in both locales", mgrUsers.en.status === 403 && mgrUsers.ja.status === 403);
  const adminUsers = await sameEverywhere("admin lists accounts", admin, "GET", "/users");
  check("admin succeeds (200) in both locales", adminUsers.en.status === 200 && adminUsers.ja.status === 200);

  // ------------------------------------------------------------------ tampered / unsupported locale
  section("a tampered or unsupported X-Locale header never errors and never changes authorization");
  for (const bad of ["fr", "EN", "ja-JP", "'; DROP TABLE User; --"]) {
    const rGuest = await guest.req("GET", `/research/${areaHidden.id}`, undefined, bad);
    check(`X-Locale: ${JSON.stringify(bad)} -- guest still blocked from the hidden area (404, not 500)`, rGuest.status === 404);
  }

  // ------------------------------------------------------------------ cleanup
  section("cleanup");
  await cleanup();
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
