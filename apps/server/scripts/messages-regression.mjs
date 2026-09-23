/**
 * End-to-end API regression for PRIVATE MESSAGING + NOTIFICATIONS (Phase 12):
 * /api/messages/* and /api/notifications/*, plus the forum's notification integration.
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:/abs/path/to/copy.db PORT=4051 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:/abs/path/to/copy.db API=http://localhost:4051 node scripts/messages-regression.mjs
 *
 * Run it ONLY against a COPY of the database: it removes every audit/notification/message row
 * written during the run. It creates temporary records prefixed "ZZ Msg" / p12test-*@example.test
 * and removes them again (also at start, in case a previous run was interrupted).
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
  patch = (p, b) => this.req("PATCH", p, b ?? {});
  del = (p) => this.req("DELETE", p);
  login = (email, password) => this.post("/auth/login", { email, password });
}

async function cleanup() {
  // Message/Notification rows must be removed BEFORE the users: Message.senderId is SetNull on
  // delete (we would lose which messages were theirs) and ConversationParticipant.userId cascades
  // (the lookup-by-participant would already find nothing once the user is gone).
  const testUsers = await prisma.user.findMany({ where: { email: { startsWith: "p12test-" } }, select: { id: true } });
  const testUserIds = testUsers.map((u) => u.id);
  if (testUserIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversation: { participants: { some: { userId: { in: testUserIds } } } } } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { participants: { some: { userId: { in: testUserIds } } } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: testUserIds } }, { actorId: { in: testUserIds } }] } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: "p12test-" } } }).catch(() => {});
  await prisma.forumComment.deleteMany({ where: { post: { title: { startsWith: "ZZ Msg" } } } }).catch(() => {});
  await prisma.forumPost.deleteMany({ where: { title: { startsWith: "ZZ Msg" } } });
  await prisma.forumCategory.deleteMany({ where: { name: { startsWith: "ZZ Msg" } } });
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: "ZZ Msg" } } });
}

async function main() {
  await cleanup();

  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);

  const mk = async (key, role, name) => {
    const email = `p12test-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "ZM", memberRole: "Researcher", category: "RESEARCH" });
    const client = new Client();
    await client.login(email, PW);
    const tm = await prisma.teamMember.findFirst({ where: { name } });
    return { client, id: r.json?.id, email, tm, status: r.status };
  };

  // ------------------------------------------------------------------
  section("fixtures");
  const guest = new Client();
  const mgr = await mk("mgr", "LAB_MANAGER", "ZZ Msg Manager");
  const a = await mk("a", "MEMBER", "ZZ Msg Alice");
  const b = await mk("b", "MEMBER", "ZZ Msg Bob");
  const c = await mk("c", "MEMBER", "ZZ Msg Carol");
  check("fixtures: four accounts created with profiles", [mgr, a, b, c].every((u) => u.status === 201 && u.tm));

  // ------------------------------------------------------------------
  section("AUTH: guests cannot use messaging or notifications");
  check("guest conversation list -> 401", (await guest.get("/messages/conversations")).status === 401);
  check("guest create conversation -> 401", (await guest.post("/messages/conversations", { teamMemberId: a.tm.id })).status === 401);
  check("guest notifications -> 401", (await guest.get("/notifications")).status === 401);
  check("guest unread-count -> 401", (await guest.get("/notifications/unread-count")).status === 401);

  // ------------------------------------------------------------------
  section("CONVERSATION: create, dedupe, self-message rejected");
  check("cannot message yourself", (await a.client.post("/messages/conversations", { teamMemberId: a.tm.id })).status === 400);
  check("cannot message a nonexistent team member", (await a.client.post("/messages/conversations", { teamMemberId: "doesnotexist" })).status === 404);

  const created = await a.client.post("/messages/conversations", { teamMemberId: b.tm.id });
  check("member A starts a conversation with member B", created.status === 201 && created.json?.id);
  const convId = created.json.id;
  check("conversation never exposes an account id", !JSON.stringify(created.json).includes(b.tm.userId ?? "__none__"));

  const reused = await a.client.post("/messages/conversations", { teamMemberId: b.tm.id });
  check("starting the same pair again reuses the conversation (no duplicate)", reused.status === 201 && reused.json.id === convId);
  const reversed = await b.client.post("/messages/conversations", { teamMemberId: a.tm.id });
  check("the OTHER direction also reuses it (order-independent)", reversed.status === 201 && reversed.json.id === convId);

  const dbConvCount = await prisma.conversation.count({ where: { OR: [{ participants: { some: { userId: a.tm.userId } } }] } });
  check("exactly one Conversation row exists for this pair", dbConvCount === 1, `found ${dbConvCount}`);

  // Concurrency: fire several "start conversation" requests at once from both directions.
  const concurrent = await Promise.all([
    a.client.post("/messages/conversations", { teamMemberId: b.tm.id }),
    b.client.post("/messages/conversations", { teamMemberId: a.tm.id }),
    a.client.post("/messages/conversations", { teamMemberId: b.tm.id }),
  ]);
  check("concurrent conversation creation never duplicates (all resolve to the same id)", concurrent.every((r) => r.status === 201 && r.json.id === convId));
  const afterRaceCount = await prisma.conversation.count({ where: { directKey: (await prisma.conversation.findUnique({ where: { id: convId } })).directKey } });
  check("still exactly one row after the race", afterRaceCount === 1, `found ${afterRaceCount}`);

  // ------------------------------------------------------------------
  section("CONVERSATION ACCESS: only participants");
  check("participant A can read the conversation", (await a.client.get(`/messages/conversations/${convId}`)).status === 200);
  check("participant B can read the conversation", (await b.client.get(`/messages/conversations/${convId}`)).status === 200);
  check("non-participant C gets 404 (existence not revealed)", (await c.client.get(`/messages/conversations/${convId}`)).status === 404);
  check("a manager with no message-related role gets 404 too (no admin override)", (await mgr.client.get(`/messages/conversations/${convId}`)).status === 404);
  check("guest gets 401, not 404 (still an auth check first)", (await guest.get(`/messages/conversations/${convId}`)).status === 401);
  check("nonexistent conversation id -> 404", (await a.client.get("/messages/conversations/doesnotexist")).status === 404);

  // ------------------------------------------------------------------
  section("MESSAGES: send, validation, hostile content, spoofing");
  check("empty body rejected", (await a.client.post(`/messages/conversations/${convId}/messages`, { body: "" })).status === 400);
  check("whitespace-only body rejected", (await a.client.post(`/messages/conversations/${convId}/messages`, { body: "   " })).status === 400);
  check("oversized body rejected", (await a.client.post(`/messages/conversations/${convId}/messages`, { body: "x".repeat(4001) })).status === 400);
  check("non-string body rejected", (await a.client.post(`/messages/conversations/${convId}/messages`, { body: 123 })).status === 400);
  check("message to an invalid conversation id -> 400", (await a.client.post("/messages/conversations/not-real!!/messages", { body: "hi" })).status === 400);
  check("message to a nonexistent conversation -> 404", (await a.client.post("/messages/conversations/doesnotexist/messages", { body: "hi" })).status === 404);
  check("non-participant C cannot send into A/B's conversation (404)", (await c.client.post(`/messages/conversations/${convId}/messages`, { body: "hi" })).status === 404);

  const sent = await a.client.post(`/messages/conversations/${convId}/messages`, { body: "ZZ Msg hello Bob" });
  check("A sends a message", sent.status === 201 && sent.json.body === "ZZ Msg hello Bob");
  check("sender sees mine=true on their own message", sent.json.mine === true);
  check("recipient sees mine=false on the same message", (await b.client.get(`/messages/conversations/${convId}`)).json.messages.at(-1).mine === false);

  const spoofed = await a.client.post(`/messages/conversations/${convId}/messages`, { body: "ZZ Msg spoof attempt", senderId: b.tm.userId });
  const spoofedRow = await prisma.message.findUnique({ where: { id: spoofed.json.id } });
  check("a forged senderId in the body is ignored (sender is always the session)", spoofedRow.senderId === a.tm.userId);

  for (const hostile of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "<iframe>evil</iframe>", "javascript:alert(1)"]) {
    const r = await a.client.post(`/messages/conversations/${convId}/messages`, { body: hostile });
    check(`hostile content stored/returned as inert literal text: ${hostile}`, r.status === 201 && r.json.body === hostile);
  }

  // ------------------------------------------------------------------
  section("MESSAGE EDIT/DELETE: author only, ever");
  const editable = await a.client.post(`/messages/conversations/${convId}/messages`, { body: "ZZ Msg original" });
  check("non-author (recipient) cannot edit", (await b.client.put(`/messages/messages/${editable.json.id}`, { body: "hijack" })).status === 403);
  check("a manager cannot edit someone else's private message either (no role override)", (await mgr.client.put(`/messages/messages/${editable.json.id}`, { body: "hijack" })).status === 403);
  const edited = await a.client.put(`/messages/messages/${editable.json.id}`, { body: "ZZ Msg edited" });
  check("author can edit their own message", edited.status === 200 && edited.json.body === "ZZ Msg edited" && edited.json.editedAt);

  check("non-author (recipient) cannot delete", (await b.client.del(`/messages/messages/${editable.json.id}`)).status === 403);
  const deleted = await a.client.del(`/messages/messages/${editable.json.id}`);
  check("author can delete their own message", deleted.status === 200 && deleted.json.deleted === true && deleted.json.body === "");
  const deletedRow = await prisma.message.findUnique({ where: { id: editable.json.id } });
  check("deletion blanks the body in the database (nothing private lingers)", deletedRow.body === "" && deletedRow.deletedAt !== null);

  // ------------------------------------------------------------------
  section("CONVERSATION LIST + READ STATE");
  const listA = await a.client.get("/messages/conversations");
  check("A's conversation list includes the conversation with B", listA.json.conversations.some((cv) => cv.id === convId));
  check("conversation list never includes full message history (only a preview)", !("messages" in (listA.json.conversations[0] ?? {})));

  const beforeRead = (await b.client.get("/messages/conversations")).json.conversations.find((cv) => cv.id === convId);
  check("B has unread messages from A before opening the conversation", beforeRead?.unread === true && beforeRead.unreadCount > 0);

  check("opening the conversation marks it read", (await b.client.patch(`/messages/conversations/${convId}/read`)).status === 200);
  const afterRead = (await b.client.get("/messages/conversations")).json.conversations.find((cv) => cv.id === convId);
  check("unread clears after reading", afterRead?.unread === false && afterRead.unreadCount === 0);
  check("marking read again is safe (idempotent)", (await b.client.patch(`/messages/conversations/${convId}/read`)).status === 200);
  check("A is never marked unread by their OWN messages", (await a.client.get("/messages/conversations")).json.conversations.find((cv) => cv.id === convId)?.unread === false);

  check("non-participant cannot mark the conversation read", (await c.client.patch(`/messages/conversations/${convId}/read`)).status === 404);

  // ------------------------------------------------------------------
  section("NOTIFICATIONS: message-triggered, privacy, read state");
  const notifsB = await b.client.get("/notifications");
  check("B has a MESSAGE_RECEIVED notification", notifsB.json.notifications.some((n) => n.type === "MESSAGE_RECEIVED" && n.targetPath === `/messages/${convId}`));
  check("the sender A is never notified about their own message", !(await a.client.get("/notifications")).json.notifications.some((n) => n.type === "MESSAGE_RECEIVED" && n.actor?.teamMemberId === a.tm.id));
  check("a notification never carries the message body", !JSON.stringify(notifsB.json).includes("hello Bob") && !JSON.stringify(notifsB.json).includes("original"));

  check("C cannot see B's notifications", !(await c.client.get("/notifications")).json.notifications.some((n) => n.targetPath === `/messages/${convId}`));
  check("a manager cannot see another user's notifications (no admin override)", !(await mgr.client.get("/notifications")).json.notifications.some((n) => n.targetPath === `/messages/${convId}`));
  const adminTryUserId = await admin.get(`/notifications?userId=${b.tm.userId}`);
  check("an ADMIN's ?userId= query param is ignored, not honoured (recipient always comes from the session)", !adminTryUserId.json.notifications.some((n) => n.targetPath === `/messages/${convId}`));

  const unreadCountB = await b.client.get("/notifications/unread-count");
  check("unread-count is a real count, not a list", typeof unreadCountB.json.count === "number" && unreadCountB.json.count > 0);

  const oneNotif = notifsB.json.notifications.find((n) => n.type === "MESSAGE_RECEIVED");
  check("C cannot mark B's notification read (404, not leaked as 403)", (await c.client.patch(`/notifications/${oneNotif.id}/read`)).status === 404);
  check("B can mark their own notification read", (await b.client.patch(`/notifications/${oneNotif.id}/read`)).status === 200);
  check("marking an unknown notification id read -> 404", (await b.client.patch("/notifications/doesnotexist/read")).status === 404);

  // A raw fixture row for A, inserted directly (bypassing the API) so this check does not depend
  // on A having received any notification of their own yet from an earlier section.
  const aNotifRow = await prisma.notification.create({ data: { userId: a.tm.userId, type: "ANNOUNCEMENT", targetPath: "" } });
  check("B can mark all their own notifications read", (await b.client.post("/notifications/read-all")).status === 200);
  const afterMarkAll = await b.client.get("/notifications/unread-count");
  check("unread-count is 0 after mark-all", afterMarkAll.json.count === 0, `got ${afterMarkAll.json.count}`);
  const aNotifAfter = await prisma.notification.findUnique({ where: { id: aNotifRow.id } });
  check("mark-all never touches another user's notifications", aNotifAfter.readAt === null);

  // ------------------------------------------------------------------
  section("FORUM INTEGRATION: mention/reply/reaction/moderation notifications (Phase 11 + 12)");
  const cat = (await admin.post("/forum/categories", { name: "ZZ Msg Cat", visibility: "PUBLIC" })).json;
  const topic = (await a.client.post("/forum/posts", { categoryId: cat.id, title: "ZZ Msg Topic", body: `hi @[${b.tm.name}](member:${b.tm.id})` })).json;
  check("fixtures: topic with a mention created", topic?.id);

  const bNotifs1 = await b.client.get("/notifications");
  check("mention creates a FORUM_MENTION notification for B", bNotifs1.json.notifications.some((n) => n.type === "FORUM_MENTION"));

  await c.client.post(`/forum/posts/${topic.id}/comments`, { body: "ZZ Msg a reply" });
  const aNotifs1 = await a.client.get("/notifications");
  check("a reply creates a FORUM_COMMENT notification for the topic author", aNotifs1.json.notifications.some((n) => n.type === "FORUM_COMMENT"));

  await c.client.post(`/forum/posts/${topic.id}/reactions`, { kind: "LIKE" });
  const aNotifs2 = await a.client.get("/notifications");
  check("a reaction creates a FORUM_REACTION notification for the author", aNotifs2.json.notifications.some((n) => n.type === "FORUM_REACTION"));
  await a.client.post(`/forum/posts/${topic.id}/reactions`, { kind: "LOVE" });
  check("reacting to your OWN post never notifies yourself", !(await a.client.get("/notifications")).json.notifications.some((n) => n.type === "FORUM_REACTION" && n.actor?.teamMemberId === a.tm.id));

  await mgr.client.post(`/forum/posts/${topic.id}/lock`);
  const aNotifs3 = await a.client.get("/notifications");
  check("a manager locking your topic notifies you (FORUM_MODERATION)", aNotifs3.json.notifications.some((n) => n.type === "FORUM_MODERATION" && n.payload?.action === "locked"));
  await mgr.client.post(`/forum/posts/${topic.id}/pin`);
  check("pinning does NOT notify (cosmetic, not a moderation notification)", !(await a.client.get("/notifications")).json.notifications.some((n) => n.payload?.action === "pinned"));

  // ------------------------------------------------------------------
  section("SEARCH: private messages never appear");
  // The response echoes the query text back in `query` regardless of hits, so the assertion must
  // look at `results` (and the counts), never the raw response body, or it would trivially "pass"
  // by finding its own echoed search term instead of actually checking for a leak.
  const searchHit = await guest.get("/search?q=ZZ+Msg+hello+Bob");
  check("a message body never appears in global search results", searchHit.json.results.length === 0 && searchHit.json.pagination.total === 0);
  check("a message body is never counted in any search category", Object.values(searchHit.json.counts).every((n) => n === 0));

  // ------------------------------------------------------------------
  section("AUDIT: no private message content, ever");
  const msgAudit = await prisma.auditLog.findMany({ where: { entityType: { in: ["MESSAGE", "CONVERSATION"] } } });
  check("no AuditLog row is ever created for a private conversation/message", msgAudit.length === 0, `found ${msgAudit.length}`);
  const allAudit = await prisma.auditLog.findMany({ where: { createdAt: { gte: new Date(Date.now() - 5 * 60_000) } } });
  check("no recent audit row contains the message text anywhere in its details", !allAudit.some((row) => (row.details ?? "").includes("hello Bob") || (row.details ?? "").includes("ZZ Msg original")));

  // ------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
  }

  await cleanup();
  await prisma.$disconnect();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
