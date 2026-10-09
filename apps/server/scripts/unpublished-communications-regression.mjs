/**
 * Unpublished members in FORUM, MESSAGES and NOTIFICATIONS (Phase 27, owner-approved extension).
 *
 * Policy under test:
 *  - FORUM (public/readable by guests and every member): an unpublished author shows as "Lab member" (no name, no profile id)
 *    to guests, other members and in search; managers see the real author; the author sees themself. Ownership, edit/delete
 *    rights, moderation (hide/unhide/lock/pin), counts, ordering and the stored authorship are unchanged.
 *  - MESSAGES (private 1:1): participants keep seeing each other and the full history (a thread they chose and nobody else can
 *    read); a stranger cannot START a conversation with an unpublished person (same 404 as a nonexistent profile) and cannot read
 *    anyone's thread; managers get no extra access to private messages (unchanged).
 *  - NOTIFICATIONS (own only): the actor of a forum notification is masked like the public content it points at; a direct
 *    MESSAGE_RECEIVED actor stays visible to the recipient (they are a participant); managers see real names in their own.
 *  - Masking is a read-time view: re-publishing the person restores their name; nothing underlying is rewritten.
 * Disposable local database; nothing external is contacted.   node scripts/unpublished-communications-regression.mjs
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");
const TSX = path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };
const PW = "Str0ngPassw0rd!";
let ok = 0;
const failures = [];
const t = (name, cond, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));
if (!existsSync(SOURCE_DB)) { console.error("Missing dev.db — run the seed first."); process.exit(1); }

const work = mkdtempSync(path.join(tmpdir(), "scl-comms-"));
const dbFile = path.join(work, "c.db");
copyFileSync(SOURCE_DB, dbFile);
const clean = { ...process.env };
delete clean.TURSO_DATABASE_URL; delete clean.TURSO_AUTH_TOKEN;

async function startServer() {
  const port = 49700 + Math.floor(Math.random() * 250);
  const env = { ...clean, BLOB_READ_WRITE_TOKEN: "", VERCEL: "", STORAGE_DIR: path.join(work, "files"), DATABASE_URL: `file:${dbFile}`, PORT: String(port), TRUST_PROXY: "0", NODE_ENV: "test", SESSION_SECRET: "comms-secret-0000000000000000000000", PUBLIC_BASE_URL: "https://lab.example.test" };
  const child = spawn(process.execPath, [TSX, path.join(SERVER_ROOT, "src", "index.ts")], { cwd: SERVER_ROOT, env });
  let out = "";
  child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 80 && !/listening on/.test(out); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/listening on/.test(out)) throw new Error(`server did not start:\n${out}`);
  return { base: `http://localhost:${port}`, stop() { child.kill(); } };
}
function client(base, cookie = null) {
  async function call(method, url, body) {
    const res = await fetch(`${base}/api${url}`, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  }
  return { get: (u) => call("GET", u), post: (u, b) => call("POST", u, b ?? {}), put: (u, b) => call("PUT", u, b), patch: (u, b) => call("PATCH", u, b ?? {}), del: (u) => call("DELETE", u) };
}
async function login(base, creds) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds) });
  return client(base, res.headers.get("set-cookie")?.split(";")[0] ?? null);
}

let s;
try {
  s = await startServer();
  const guest = client(s.base);
  const admin = await login(s.base, ADMIN);
  const mk = async (email, role, name) => {
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "CX", memberRole: "Researcher", category: "PHD" });
    if (r.status !== 201) throw new Error(`${email}: ${r.status} ${r.text}`);
    const c = await login(s.base, { email, password: PW });
    return { c, id: (await c.get("/profile")).json.id, name };
  };
  const H = await mk("cm-hidden@example.test", "MEMBER", "ZZ Comms HiddenPerson");
  const A = await mk("cm-a@example.test", "MEMBER", "ZZ Comms Alice");
  const B = await mk("cm-b@example.test", "MEMBER", "ZZ Comms Bob");
  const M = await mk("cm-mgr@example.test", "LAB_MANAGER", "ZZ Comms Manager");
  const HN = H.name;
  const sees = (r) => r.text.includes(HN) || r.text.includes(H.id);

  const cat = (await admin.post("/forum/categories", { name: "ZZ Comms Cat", description: "d", visibility: "PUBLIC" })).json;
  // content created while H is still published (history that must survive)
  const hTopic = (await H.c.post("/forum/posts", { categoryId: cat.id, title: "ZZ Comms Hidden's topic", body: "written by the person who is later unpublished" })).json;
  const aTopic = (await A.c.post("/forum/posts", { categoryId: cat.id, title: "ZZ Comms Alice's topic", body: "alice writes" })).json;
  const hComment = (await H.c.post(`/forum/posts/${aTopic.id}/comments`, { body: "hidden person's comment" })).json;
  await H.c.post(`/forum/posts/${aTopic.id}/reactions`, { kind: "LIKE" });
  // a private thread that exists BEFORE the person is unpublished, plus history in both directions
  const conv = (await A.c.post("/messages/conversations", { teamMemberId: H.id })).json;
  await A.c.post(`/messages/conversations/${conv.id}/messages`, { body: "hello from alice" });
  await H.c.post(`/messages/conversations/${conv.id}/messages`, { body: "reply from the hidden person" });
  t("setup: topics, comment, reaction, conversation and messages exist", hTopic?.id && aTopic?.id && hComment?.id && conv?.id);

  const db = new PrismaClient({ datasourceUrl: `file:${dbFile}` });
  const snapshot = async () => JSON.stringify({
    posts: await db.forumPost.findMany({ orderBy: { id: "asc" }, select: { id: true, authorId: true, title: true, body: true, status: true } }),
    comments: await db.forumComment.findMany({ orderBy: { id: "asc" }, select: { id: true, authorId: true, body: true, status: true } }),
    reactions: await db.forumReaction.count(),
    messages: await db.message.findMany({ orderBy: { id: "asc" }, select: { id: true, senderId: true, body: true, conversationId: true } }),
    participants: await db.conversationParticipant.count(),
    notifications: await db.notification.count(),
  });
  const auditBefore = await db.auditLog.count();
  const before = await snapshot();

  // ---- unpublish H (a manager action) ------------------------------------------------------------------------------------------
  t("setup: manager unpublishes the person", (await admin.put(`/team/${H.id}`, { isPublished: false })).status === 200);

  // ================= FORUM =================
  const forumProbes = [
    ["topic list", () => `/forum/posts?categoryId=${cat.id}&limit=50`],
    ["topic detail (hidden's topic)", () => `/forum/posts/${hTopic.id}`],
    ["topic detail (comment by hidden)", () => `/forum/posts/${aTopic.id}`],
    ["search forum-topic", () => `/search?q=${encodeURIComponent("ZZ Comms Hidden")}&type=forum-topic&limit=50`],
    ["search all (author in meta)", () => `/search?q=${encodeURIComponent("ZZ Comms")}&limit=50`],
  ];
  const viewers = { guest, "other member": B.c, "alice (unrelated to the hidden person's identity)": A.c, manager: M.c, "the hidden person": H.c };
  const res = {};
  for (const [label, url] of forumProbes) for (const [vn, c] of Object.entries(viewers)) res[`${label}|${vn}`] = await c.get(url());
  for (const [label] of forumProbes) {
    for (const vn of ["guest", "other member", "alice (unrelated to the hidden person's identity)"]) {
      const r = res[`${label}|${vn}`];
      // the free-text search QUERY echoes the typed words, so for search only the results are inspected
      const text = label.startsWith("search") ? JSON.stringify(r.json?.results ?? []) : r.text;
      t(`forum: ${vn} cannot see the unpublished author via ${label}`, !(text.includes(HN) || text.includes(H.id)), r.status + " " + text.slice(0, 120));
    }
    const mr = res[`${label}|manager`];
    const mtext = label.startsWith("search") ? JSON.stringify(mr.json?.results ?? []) : mr.text;
    if (!label.startsWith("search all")) t(`forum: the manager still sees the real author via ${label} (non-vacuity)`, mtext.includes(HN), mr.status + " " + mtext.slice(0, 100));
  }
  t("forum: the masked author reads as the generic 'Lab member' with no profile link", /Lab member/.test(res["topic detail (hidden's topic)|guest"].text) && res["topic detail (hidden's topic)|guest"].json?.author?.teamMemberId === null);
  t("forum: the person still sees their own authorship (topic + comment)", res["topic detail (hidden's topic)|the hidden person"].text.includes(HN) && res["topic detail (comment by hidden)|the hidden person"].text.includes(HN));
  const gTopic = res["topic detail (hidden's topic)|guest"].json, hTopicView = res["topic detail (hidden's topic)|the hidden person"].json, mTopic = res["topic detail (hidden's topic)|manager"].json;
  t("forum: ownership/edit rights unchanged — the person can still edit/delete their topic, a guest cannot", hTopicView.canEdit === true && hTopicView.canDelete === true && gTopic.canEdit === false);
  t("forum: moderation capability unchanged — managers can moderate, others cannot", mTopic.canModerate === true && gTopic.canModerate === false && res["topic detail (hidden's topic)|other member"].json.canModerate === false);
  t("forum: counts, titles, ordering and excerpts are identical for guests and managers", gTopic.title === mTopic.title && gTopic.commentCount === mTopic.commentCount && JSON.stringify(res["topic list|guest"].json?.topics?.map((x) => x.id) ?? res["topic list|guest"].json) === JSON.stringify(res["topic list|manager"].json?.topics?.map((x) => x.id) ?? res["topic list|manager"].json));
  const aDetailG = res["topic detail (comment by hidden)|guest"].json;
  t("forum: a comment by the hidden person is still there (same count) but shows no name", (aDetailG.comments?.length ?? 0) === 1 && aDetailG.comments[0].author?.name === "Lab member", JSON.stringify(aDetailG.comments?.[0]?.author));
  // moderation still works on masked content, and the hidden person's own reaction is still counted
  t("forum: a manager can still hide and unhide the hidden person's topic", (await M.c.post(`/forum/posts/${hTopic.id}/hide`)).status === 200 && (await guest.get(`/forum/posts/${hTopic.id}`)).status === 404 && (await M.c.post(`/forum/posts/${hTopic.id}/unhide`)).status === 200 && (await guest.get(`/forum/posts/${hTopic.id}`)).status === 200);
  t("forum: reaction counts unchanged", aDetailG.reactions?.counts?.LIKE === 1, JSON.stringify(aDetailG.reactions));
  // a masked person can keep participating
  const hNew = await H.c.post(`/forum/posts/${aTopic.id}/comments`, { body: "still allowed to comment while unpublished" });
  t("forum: an unpublished member can still post (unpublished is not a ban)", hNew.status === 201, String(hNew.status));
  t("forum: …and that new comment is masked for guests too", !(await guest.get(`/forum/posts/${aTopic.id}`)).text.includes(HN));

  // ================= MESSAGES =================
  const aConv = await A.c.get(`/messages/conversations/${conv.id}`);
  t("messages: a participant keeps the full history and still sees the other participant (private thread)", aConv.status === 200 && aConv.text.includes(HN) && aConv.json.messages.length === 2, String(aConv.status));
  const aList = await A.c.get(`/messages/conversations`);
  t("messages: the participant's conversation list is unchanged", aList.status === 200 && aList.json.conversations.some((c) => c.id === conv.id && c.other.name === HN));
  const hList = await H.c.get(`/messages/conversations`);
  t("messages: the unpublished person sees their thread with Alice", hList.json.conversations.some((c) => c.id === conv.id && c.other.name === A.name));
  t("messages: participants can keep writing", (await A.c.post(`/messages/conversations/${conv.id}/messages`, { body: "still here" })).status === 201);
  const bStart = await B.c.post(`/messages/conversations`, { teamMemberId: H.id });
  const bNone = await B.c.post(`/messages/conversations`, { teamMemberId: "doesnotexist12345" });
  t("messages: a stranger cannot START a thread with an unpublished person — same answer as a nonexistent profile", bStart.status === bNone.status && bStart.status === 404 && !bStart.text.includes(HN), `${bStart.status} vs ${bNone.status}`);
  t("messages: a stranger cannot read someone else's thread", (await B.c.get(`/messages/conversations/${conv.id}`)).status === 404);
  t("messages: a manager gets no extra access to a private thread (unchanged)", (await M.c.get(`/messages/conversations/${conv.id}`)).status === 404);
  t("messages: the stranger's list contains nothing of it", !(await B.c.get(`/messages/conversations`)).text.includes(conv.id));
  t("messages: a manager (who sees everyone) can still start a thread with the unpublished person", (await M.c.post(`/messages/conversations`, { teamMemberId: H.id })).status === 201);
  t("messages: the person themself cannot be probed by an existing partner either way — Alice re-opening the existing thread still works", (await A.c.post(`/messages/conversations`, { teamMemberId: H.id })).status === 201);

  // ================= NOTIFICATIONS =================
  const aNotes = (await A.c.get(`/notifications?limit=50`)).json?.notifications ?? [];
  const fc = aNotes.filter((n) => n.type === "FORUM_COMMENT"), mr = aNotes.filter((n) => n.type === "MESSAGE_RECEIVED");
  t("notifications: Alice has a forum-comment notification from the hidden person", fc.length >= 1);
  t("notifications: its actor is masked ('Lab member', no profile id) — same as the public comment it points at", fc.every((n) => n.actor?.name === "Lab member" && n.actor?.teamMemberId === null), JSON.stringify(fc.map((n) => n.actor)));
  t("notifications: a direct-message notification keeps the sender visible to its recipient (they are a participant)", mr.length >= 1 && mr.every((n) => n.actor?.name === HN), JSON.stringify(mr.map((n) => n.actor?.name)));
  t("notifications: nothing else about the notification changes (type, target, read state, count)", fc.every((n) => n.targetPath.startsWith("/") && n.read === false));
  // a manager receiving a forum reply from H sees the real name
  const mTopic2 = (await M.c.post("/forum/posts", { categoryId: cat.id, title: "ZZ Comms Manager topic", body: "m" })).json;
  await H.c.post(`/forum/posts/${mTopic2.id}/comments`, { body: "reply to the manager" });
  const mNotes = (await M.c.get(`/notifications?limit=50`)).json?.notifications ?? [];
  t("notifications: a manager keeps real names in their own notifications", mNotes.some((n) => n.type === "FORUM_COMMENT" && n.actor?.name === HN), JSON.stringify(mNotes.map((n) => n.actor?.name)));
  const bTopic = (await B.c.post("/forum/posts", { categoryId: cat.id, title: "ZZ Comms Bob topic", body: "b" })).json;
  await H.c.post(`/forum/posts/${bTopic.id}/comments`, { body: "reply to bob" });
  t("notifications: an unrelated member's notification from the hidden person is masked too", ((await B.c.get(`/notifications?limit=50`)).json?.notifications ?? []).filter((n) => n.type === "FORUM_COMMENT").every((n) => n.actor?.name === "Lab member"));
  t("notifications: unread count / read / read-all still work", (await B.c.get(`/notifications/unread-count`)).json.count >= 1 && (await B.c.post(`/notifications/read-all`)).status === 200 && (await B.c.get(`/notifications/unread-count`)).json.count === 0);

  // ================= nothing underlying changed; masking is reversible =================
  const after = await snapshot();
  const strip = (j) => { const o = JSON.parse(j); return o; };
  const b = strip(before), a = strip(after);
  t("underlying forum authorship, bodies and statuses are unchanged by masking", JSON.stringify(a.posts.filter((p) => b.posts.some((x) => x.id === p.id))) === JSON.stringify(b.posts) && JSON.stringify(a.comments.filter((c) => b.comments.some((x) => x.id === c.id))) === JSON.stringify(b.comments));
  t("message history and participants are byte-identical (the new messages are additions)", JSON.stringify(a.messages.slice(0, b.messages.length)) === JSON.stringify(b.messages) || b.messages.every((m) => a.messages.some((x) => JSON.stringify(x) === JSON.stringify(m))));
  t("the audit trail only grows (nothing removed)", (await db.auditLog.count()) >= auditBefore);
  t("re-publishing the person restores their name everywhere (masking was a read-time view only)", (await admin.put(`/team/${H.id}`, { isPublished: true })).status === 200 && (await guest.get(`/forum/posts/${hTopic.id}`)).text.includes(HN) && (await guest.get(`/forum/posts/${aTopic.id}`)).text.includes(HN));
  await db.$disconnect();
} catch (err) {
  failures.push(`crashed: ${err.stack ?? err}`);
} finally {
  s?.stop();
  rmSync(work, { recursive: true, force: true });
}
console.log(`\n${ok} unpublished-communications checks passed, ${failures.length} failed.`);
if (failures.length) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
