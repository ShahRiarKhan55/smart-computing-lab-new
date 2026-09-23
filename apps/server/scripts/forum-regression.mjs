/**
 * End-to-end API regression for the FORUM / RESEARCH COMMUNITY (Phase 11): /api/forum/*.
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:/abs/path/to/copy.db PORT=4041 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:/abs/path/to/copy.db API=http://localhost:4041 node scripts/forum-regression.mjs
 *
 * Run it ONLY against a COPY of the database: it removes every audit/notification row written
 * during the run. It creates temporary records prefixed "ZZ Forum" / p11test-*@example.test and
 * removes them again (also at start, in case a previous run was interrupted). It never touches a
 * row it did not create.
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
  async req(method, path, body) {
    const res = await fetch(`${API}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      if (/^scl\.sid=;?$/.test(pair) || /Expires=Thu, 01 Jan 1970/i.test(c)) this.cookie = "";
      else if (pair.startsWith("scl.sid=")) this.cookie = pair;
    }
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }
  get = (p) => this.req("GET", p);
  post = (p, b) => this.req("POST", p, b ?? {});
  put = (p, b) => this.req("PUT", p, b ?? {});
  del = (p) => this.req("DELETE", p);
  login = (email, password) => this.post("/auth/login", { email, password });
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: "p11test-" } } }).catch(() => {});
  await prisma.forumComment.deleteMany({ where: { post: { title: { startsWith: "ZZ Forum" } } } }).catch(() => {});
  await prisma.forumPost.deleteMany({ where: { title: { startsWith: "ZZ Forum" } } });
  await prisma.forumCategory.deleteMany({ where: { name: { startsWith: "ZZ Forum" } } });
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: "ZZ Forum" } } });
  await prisma.researchProject.deleteMany({ where: { title: { startsWith: "ZZ Forum" } } });
}

async function main() {
  await cleanup();

  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);
  const adminMe = (await admin.get("/auth/me")).json.user;

  const mk = async (key, role, name) => {
    const email = `p11test-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "ZF", memberRole: "Researcher", category: "RESEARCH" });
    const client = new Client();
    await client.login(email, PW);
    const tm = await prisma.teamMember.findFirst({ where: { name } });
    return { client, id: r.json?.id, email, tm, status: r.status };
  };

  // ------------------------------------------------------------------
  section("fixtures");
  const guest = new Client();
  const mgr = await mk("mgr", "LAB_MANAGER", "ZZ Forum Manager");
  const memA = await mk("a", "MEMBER", "ZZ Forum Alice");
  const memB = await mk("b", "MEMBER", "ZZ Forum Bob");
  check("fixtures: three accounts created with profiles", [mgr, memA, memB].every((u) => u.status === 201 && u.tm));

  const mkCat = (name, extra = {}) => admin.post("/forum/categories", { name, description: "d", ...extra });
  const catPub = (await mkCat("ZZ Forum Public Cat", { visibility: "PUBLIC" })).json;
  const catHid = (await mkCat("ZZ Forum Hidden Cat", { visibility: "LAB_ONLY" })).json;
  const catLocked = (await mkCat("ZZ Forum Locked Cat", { visibility: "PUBLIC", isLocked: true })).json;
  check("fixtures: three categories created", [catPub, catHid, catLocked].every((c) => c?.id));

  const projPub = await prisma.researchProject.create({ data: { slug: "zz-forum-proj-pub", title: "ZZ Forum Project Public", visibility: "PUBLIC" } });
  const projHid = await prisma.researchProject.create({ data: { slug: "zz-forum-proj-hid", title: "ZZ Forum Project Hidden", visibility: "LAB_ONLY" } });

  // ------------------------------------------------------------------
  section("PUBLIC: categories and topics");
  check("guest sees the public category", (await guest.get(`/forum/categories/${catPub.slug}`)).status === 200);
  check("guest gets 404 for the hidden category", (await guest.get(`/forum/categories/${catHid.slug}`)).status === 404);
  const guestCats = (await guest.get("/forum/categories")).json;
  check("guest category list excludes the hidden one", guestCats.some((c) => c.id === catPub.id) && !guestCats.some((c) => c.id === catHid.id));
  check("guest never receives `visibility` on a category", !("visibility" in guestCats.find((c) => c.id === catPub.id)));
  check("manager receives `visibility` on categories", (await mgr.client.get(`/forum/categories/${catPub.slug}`)).json.visibility === "PUBLIC");

  const topicPub = (await memA.client.post("/forum/posts", { categoryId: catPub.id, title: "ZZ Forum Public Topic", body: "hello everyone" })).json;
  const topicHid = (await memA.client.post("/forum/posts", { categoryId: catHid.id, title: "ZZ Forum Hidden Topic", body: "internal only" })).json;
  check("member creates a topic in a public category", topicPub?.id && topicPub.title === "ZZ Forum Public Topic");
  check("member creates a topic in a hidden category", topicHid?.id);
  check("author on the new topic is the session user (never the client)", topicPub.author.teamMemberId === memA.tm.id);

  check("guest reads the public topic", (await guest.get(`/forum/posts/${topicPub.id}`)).status === 200);
  check("guest gets 404 for the topic in the hidden category", (await guest.get(`/forum/posts/${topicHid.id}`)).status === 404);
  const guestList = (await guest.get(`/forum/posts?category=${catPub.slug}`)).json;
  check("guest topic list for the public category has it", guestList.topics.some((t) => t.id === topicPub.id));
  const guestHidList = (await guest.get(`/forum/posts?category=${catHid.slug}`)).json;
  check("guest topic list for the hidden category is empty (category itself hides)", guestHidList.topics.length === 0);
  check("member sees the hidden-category topic", (await memA.client.get(`/forum/posts/${topicHid.id}`)).status === 200);

  // ------------------------------------------------------------------
  section("AUTH: guests cannot write, members can where permitted");
  check("guest cannot create a category (401)", (await guest.post("/forum/categories", { name: "x" })).status === 401);
  check("member cannot create a category (403)", (await memA.client.post("/forum/categories", { name: "x" })).status === 403);
  check("manager can create a category (201)", (await mgr.client.post("/forum/categories", { name: "ZZ Forum Throwaway" })).status === 201);
  check("guest cannot create a topic (401)", (await guest.post("/forum/posts", { categoryId: catPub.id, title: "x", body: "y" })).status === 401);
  check("guest cannot comment (401)", (await guest.post(`/forum/posts/${topicPub.id}/comments`, { body: "x" })).status === 401);
  check("guest cannot react (401)", (await guest.post(`/forum/posts/${topicPub.id}/reactions`, { kind: "LIKE" })).status === 401);
  check("member can comment", (await memB.client.post(`/forum/posts/${topicPub.id}/comments`, { body: "ZZ Forum first comment" })).status === 201);
  check("invalid category on create -> 400", (await memA.client.post("/forum/posts", { categoryId: "doesnotexist", title: "x", body: "y" })).status === 400);
  check("missing title -> 400", (await memA.client.post("/forum/posts", { categoryId: catPub.id, body: "y" })).status === 400);
  check("category locked for new topics -> 403", (await memA.client.post("/forum/posts", { categoryId: catLocked.id, title: "x", body: "y" })).status === 403);
  check("forged author id in the body is ignored (author is always the session)", (await memB.client.post("/forum/posts", { categoryId: catPub.id, title: "ZZ Forum forged author attempt", body: "y", authorId: mgr.id })).json.author.teamMemberId === memB.tm.id);

  // ------------------------------------------------------------------
  section("OWNERSHIP: edit/delete own vs another's");
  check("author can edit their own topic", (await memA.client.put(`/forum/posts/${topicPub.id}`, { title: "ZZ Forum Public Topic (edited)" })).status === 200);
  check("another member cannot edit that topic (403)", (await memB.client.put(`/forum/posts/${topicPub.id}`, { title: "hijack" })).status === 403);
  check("even a manager cannot silently rewrite someone else's topic text (403)", (await mgr.client.put(`/forum/posts/${topicPub.id}`, { title: "hijack" })).status === 403);
  const commentB = (await memB.client.post(`/forum/posts/${topicPub.id}/comments`, { body: "ZZ Forum Bob's comment" })).json;
  check("author can edit their own comment", (await memB.client.put(`/forum/comments/${commentB.id}`, { body: "edited by Bob" })).status === 200);
  check("another member cannot edit that comment (403)", (await memA.client.put(`/forum/comments/${commentB.id}`, { body: "hijack" })).status === 403);
  check("another member cannot delete that comment (403)", (await memA.client.del(`/forum/comments/${commentB.id}`)).status === 403);
  check("the author can delete their own comment", (await memB.client.del(`/forum/comments/${commentB.id}`)).status === 200);
  check("a deleted comment is gone from the thread", !((await memA.client.get(`/forum/posts/${topicPub.id}`)).json.comments.some((c) => c.id === commentB.id)));

  // ------------------------------------------------------------------
  section("MODERATION: pin / lock / hide / move / delete");
  check("member cannot pin (403)", (await memA.client.post(`/forum/posts/${topicPub.id}/pin`)).status === 403);
  check("member cannot lock (403)", (await memA.client.post(`/forum/posts/${topicPub.id}/lock`)).status === 403);
  check("manager can pin", (await mgr.client.post(`/forum/posts/${topicPub.id}/pin`)).json?.pinned === true);
  const pinnedList = (await guest.get(`/forum/posts?category=${catPub.slug}`)).json.topics;
  check("a pinned topic sorts first", pinnedList[0]?.id === topicPub.id);
  check("manager can unpin", (await mgr.client.post(`/forum/posts/${topicPub.id}/unpin`)).json?.pinned === false);
  check("manager can lock", (await mgr.client.post(`/forum/posts/${topicPub.id}/lock`)).json?.locked === true);
  check("manager can unlock", (await mgr.client.post(`/forum/posts/${topicPub.id}/unlock`)).json?.locked === false);
  check("manager can hide", (await mgr.client.post(`/forum/posts/${topicPub.id}/hide`)).json?.status === "HIDDEN");
  check("a hidden topic is invisible to a guest (404)", (await guest.get(`/forum/posts/${topicPub.id}`)).status === 404);
  check("a hidden topic is invisible to its own author (not a manager, 404)", (await memA.client.get(`/forum/posts/${topicPub.id}`)).status === 404);
  check("a hidden topic is still visible to a manager", (await mgr.client.get(`/forum/posts/${topicPub.id}`)).status === 200);
  check("manager can unhide", (await mgr.client.post(`/forum/posts/${topicPub.id}/unhide`)).json?.status === "ACTIVE");

  check("member cannot move a topic (categoryId is manager-only, 403)", (await memA.client.put(`/forum/posts/${topicPub.id}`, { categoryId: catHid.id })).status === 403);
  check("manager can move a topic between categories", (await mgr.client.put(`/forum/posts/${topicPub.id}`, { categoryId: catHid.id })).json?.category.id === catHid.id);
  await mgr.client.put(`/forum/posts/${topicPub.id}`, { categoryId: catPub.id }); // move it back

  check("member cannot delete arbitrary content (403)", (await memB.client.del(`/forum/posts/${topicHid.id}`)).status === 403);
  check("admin can delete arbitrary content", (await admin.del(`/forum/posts/${topicHid.id}`)).status === 200);
  check("a deleted topic 404s for everyone, including its author", (await memA.client.get(`/forum/posts/${topicHid.id}`)).status === 404);
  check("a deleted topic 404s for a manager too (it is gone, not merely hidden)", (await mgr.client.get(`/forum/posts/${topicHid.id}`)).status === 404);

  const catForDelete = (await mkCat("ZZ Forum Delete Me")).json;
  check("an empty category can be deleted", (await admin.del(`/forum/categories/${catForDelete.id}`)).status === 200);
  const topicForBlock = (await memA.client.post("/forum/posts", { categoryId: catLocked.id === catPub.id ? catPub.id : catPub.id, title: "ZZ Forum Block Delete", body: "x" })).json;
  check("a category holding a topic cannot be deleted (409)", (await admin.del(`/forum/categories/${catPub.id}`)).status === 409);
  await admin.del(`/forum/posts/${topicForBlock.id}`);

  // ------------------------------------------------------------------
  section("LOCK: comments");
  const lockTopic = (await memA.client.post("/forum/posts", { categoryId: catPub.id, title: "ZZ Forum Lock Test", body: "x" })).json;
  check("unlocked topic accepts a comment", (await memB.client.post(`/forum/posts/${lockTopic.id}/comments`, { body: "before lock" })).status === 201);
  await mgr.client.post(`/forum/posts/${lockTopic.id}/lock`);
  check("locked topic rejects a new comment (403)", (await memB.client.post(`/forum/posts/${lockTopic.id}/comments`, { body: "after lock" })).status === 403);
  check("a locked topic is still readable", (await guest.get(`/forum/posts/${lockTopic.id}`)).status === 200);
  await mgr.client.post(`/forum/posts/${lockTopic.id}/unlock`);
  check("unlocking allows comments again", (await memB.client.post(`/forum/posts/${lockTopic.id}/comments`, { body: "after unlock" })).status === 201);

  // ------------------------------------------------------------------
  section("REACTIONS");
  const reactTopic = (await memA.client.post("/forum/posts", { categoryId: catPub.id, title: "ZZ Forum Reactions", body: "x" })).json;
  const r1 = await memB.client.post(`/forum/posts/${reactTopic.id}/reactions`, { kind: "LIKE" });
  check("add a reaction", r1.status === 200 && r1.json.counts.LIKE === 1 && r1.json.mine.includes("LIKE"));
  const r2 = await memB.client.post(`/forum/posts/${reactTopic.id}/reactions`, { kind: "LIKE" });
  check("duplicate reaction is prevented (idempotent, no second row)", r2.status === 200 && r2.json.counts.LIKE === 1);
  const dbReactionCount = await prisma.forumReaction.count({ where: { postId: reactTopic.id, kind: "LIKE" } });
  check("exactly one reaction row exists in the database", dbReactionCount === 1);
  const r3 = await memA.client.post(`/forum/posts/${reactTopic.id}/reactions`, { kind: "LIKE" });
  check("a different user's LIKE adds to the count", r3.json.counts.LIKE === 2);
  const r4 = await memB.client.del(`/forum/posts/${reactTopic.id}/reactions/LIKE`);
  check("remove own reaction", r4.status === 200 && r4.json.counts.LIKE === 1 && !r4.json.mine.includes("LIKE"));
  const afterOtherDelete = (await memA.client.get(`/forum/posts/${reactTopic.id}`)).json;
  check("removing your own reaction never removes another user's (Alice's LIKE survives Bob's delete)", afterOtherDelete.reactions.mine.includes("LIKE") && afterOtherDelete.reactions.counts.LIKE === 1);
  check("invalid reaction kind -> 400", (await memA.client.post(`/forum/posts/${reactTopic.id}/reactions`, { kind: "SUPERLIKE" })).status === 400);

  const reactComment = (await memA.client.post(`/forum/posts/${reactTopic.id}/comments`, { body: "react to me" })).json;
  const cr1 = await memB.client.post(`/forum/comments/${reactComment.id}/reactions`, { kind: "THANKS" });
  check("add a comment reaction", cr1.status === 200 && cr1.json.counts.THANKS === 1);
  const cr2 = await memB.client.del(`/forum/comments/${reactComment.id}/reactions/THANKS`);
  check("remove a comment reaction", cr2.status === 200 && cr2.json.counts.THANKS === 0);

  // ------------------------------------------------------------------
  section("MENTIONS");
  const mentionTopic = (
    await memA.client.post("/forum/posts", {
      categoryId: catPub.id,
      title: "ZZ Forum Mentions",
      body: `hi @[${memB.tm.name}](member:${memB.tm.id}) and @[Nobody](member:doesnotexist12345)!`,
    })
  ).json;
  check("valid + invalid mention tokens are both kept verbatim in the body (never HTML)", mentionTopic.body.includes(`member:${memB.tm.id}`) && mentionTopic.body.includes("member:doesnotexist12345"));
  const mentionRows = await prisma.forumMention.findMany({ where: { postId: mentionTopic.id } });
  check("exactly one ForumMention row: only the valid, account-holding member resolved", mentionRows.length === 1 && mentionRows[0].mentionedUserId === memB.id);
  const mentionNotif = await prisma.notification.findFirst({ where: { entityId: mentionTopic.id, type: "FORUM_MENTION", userId: memB.id } });
  check("a Notification row was created for the mentioned user (the future notification integration point)", !!mentionNotif && mentionNotif.actorId === memA.id);
  check("no notification for the self-mention-adjacent author", !(await prisma.notification.findFirst({ where: { entityId: mentionTopic.id, userId: memA.id } })));
  const rawTopicJson = JSON.stringify(mentionTopic);
  check("no account id ever appears in the topic JSON (mentioned or author)", !rawTopicJson.includes(memB.id) && !rawTopicJson.includes(memA.id) && !rawTopicJson.includes(adminMe.id));

  // edit the topic to DROP the mention; re-adding the SAME mention on a later edit must not re-notify.
  await prisma.notification.deleteMany({ where: { entityId: mentionTopic.id } });
  await memA.client.put(`/forum/posts/${mentionTopic.id}`, { body: `hi @[${memB.tm.name}](member:${memB.tm.id}) again` });
  const renotified = await prisma.notification.findFirst({ where: { entityId: mentionTopic.id, userId: memB.id, type: "FORUM_MENTION" } });
  check("keeping the same mention across an edit does not re-notify", !renotified);

  // ------------------------------------------------------------------
  section("PROJECT CONTEXT");
  const projTopic = (await memA.client.post("/forum/posts", { categoryId: catPub.id, title: "ZZ Forum With Project", body: "x", projectId: projPub.id })).json;
  check("valid project is linked and returned", projTopic.project?.id === projPub.id);
  check("invalid project id -> 400", (await memA.client.post("/forum/posts", { categoryId: catPub.id, title: "x", body: "y", projectId: "doesnotexist" })).status === 400);
  const hiddenProjTopic = (await mgr.client.post("/forum/posts", { categoryId: catPub.id, title: "ZZ Forum With Hidden Project", body: "x", projectId: projHid.id })).json;
  check("manager sees the hidden project on their own topic", hiddenProjTopic.project?.id === projHid.id);
  const guestSeesHiddenProjTopic = (await guest.get(`/forum/posts/${hiddenProjTopic.id}`)).json;
  check("guest sees the topic (public category) but the hidden project is nulled out", guestSeesHiddenProjTopic.project === null);
  const projList = (await guest.get(`/forum/posts?project=${projPub.id}`)).json;
  check("topics can be listed by project", projList.topics.some((t) => t.id === projTopic.id));

  // ------------------------------------------------------------------
  section("PAGINATION + ordering");
  const pageCatRaw = await mkCat("ZZ Forum Page Cat", { visibility: "PUBLIC" });
  const pageCat = pageCatRaw.json;
  for (let i = 0; i < 5; i++) await memA.client.post("/forum/posts", { categoryId: pageCat.id, title: `ZZ Forum Page Topic ${i}`, body: "x" });
  const page1 = (await guest.get(`/forum/posts?category=${pageCat.slug}&page=1&limit=2`)).json;
  const page2 = (await guest.get(`/forum/posts?category=${pageCat.slug}&page=2&limit=2`)).json;
  const page3 = (await guest.get(`/forum/posts?category=${pageCat.slug}&page=3&limit=2`)).json;
  check("pagination: page 1 has 2, total is 5, totalPages 3", page1.topics.length === 2 && page1.pagination.total === 5 && page1.pagination.totalPages === 3);
  const allIds = [...page1.topics, ...page2.topics, ...page3.topics].map((t) => t.id);
  check("pagination: no duplicate across pages, all 5 covered", new Set(allIds).size === 5 && allIds.length === 5);
  check("limit is clamped (rejecting an out-of-range value)", (await guest.get(`/forum/posts?category=${pageCat.slug}&limit=99999`)).status === 400);
  check("page must be a positive integer", (await guest.get(`/forum/posts?category=${pageCat.slug}&page=0`)).status === 400);

  // ------------------------------------------------------------------
  section("SECURITY: malformed ids, hostile strings");
  check("malformed topic id -> 400", (await guest.get("/forum/posts/bad!id")).status === 400);
  check("malformed comment id on edit -> 400", (await memA.client.put("/forum/comments/bad!id", { body: "x" })).status === 400);
  check("unknown topic id -> 404 (not 500)", (await guest.get("/forum/posts/doesnotexist12345")).status === 404);
  const hostile = "<script>alert(1)</script><img src=x onerror=alert(1)> javascript:alert(1)";
  const hostileTopic = (await memA.client.post("/forum/posts", { categoryId: catPub.id, title: "ZZ Forum Hostile", body: hostile })).json;
  check("hostile HTML/JS strings are stored and returned verbatim as TEXT (never transformed) — the client must never dangerouslySetInnerHTML this", hostileTopic.body === hostile);
  check("no server response includes `userId` as a JSON key anywhere for these endpoints", !JSON.stringify(await guest.get(`/forum/posts/${hostileTopic.id}`)).includes('"userId"'));

  // ------------------------------------------------------------------
  section("AUDIT");
  const auditTopic = (await memA.client.post("/forum/posts", { categoryId: catPub.id, title: "ZZ Forum Audit Topic", body: "x" })).json;
  await mgr.client.post(`/forum/posts/${auditTopic.id}/pin`);
  await mgr.client.post(`/forum/posts/${auditTopic.id}/lock`);
  await mgr.client.post(`/forum/posts/${auditTopic.id}/unlock`);
  await mgr.client.put(`/forum/posts/${auditTopic.id}`, { categoryId: catHid.id });
  await admin.del(`/forum/posts/${auditTopic.id}`);
  const has = async (action, entityId, actorId) => (await prisma.auditLog.count({ where: { action, entityId, actorId } })) > 0;
  const auditWanted = [
    ["FORUM_POST_CREATED", auditTopic.id, memA.id],
    ["FORUM_POST_PINNED", auditTopic.id, mgr.id],
    ["FORUM_POST_LOCKED", auditTopic.id, mgr.id],
    ["FORUM_POST_UNLOCKED", auditTopic.id, mgr.id],
    ["FORUM_POST_MOVED", auditTopic.id, mgr.id],
    ["FORUM_POST_DELETED", auditTopic.id, adminMe.id],
    ["FORUM_CATEGORY_CREATED", catPub.id, adminMe.id],
  ];
  const auditFound = await Promise.all(auditWanted.map((w) => has(...w)));
  check("moderation actions are audited with the correct actor", auditFound.every(Boolean), auditFound.join());
  const auditRows = await prisma.auditLog.findMany({ where: { entityType: { in: ["FORUM_POST", "FORUM_CATEGORY", "FORUM_COMMENT"] }, createdAt: { gte: RUN_STARTED } } });
  const auditBlob = auditRows.map((r) => r.details ?? "").join("\n");
  check("forum audit rows never carry the post/comment body", !auditBlob.includes("hello everyone") && !auditBlob.includes(hostile));
  check("forum audit rows never carry a forbidden key (password/hash/token/...)", auditRows.every((r) => { const d = JSON.parse(r.details ?? "{}"); return Object.keys(d).every((k) => !/pass|hash|secret|token|cookie|session|body|content|message/i.test(k)); }));

  // ------------------------------------------------------------------
  section("cleanup");
  await cleanup();
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: RUN_STARTED } } });
  await prisma.notification.deleteMany({ where: { createdAt: { gte: RUN_STARTED } } });

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
