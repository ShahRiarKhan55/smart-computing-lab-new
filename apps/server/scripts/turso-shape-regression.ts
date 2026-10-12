/**
 * Route-level regression for the Turso/libSQL "untyped SQLITE_CONSTRAINT" error shape (Phase 2.2.6).
 *
 * Prisma 5.22 + @prisma/adapter-libsql 5.22 type a constraint failure (P2002/P2003) only when the driver error has a numeric
 * `rawCode`; remote (Turso) driver errors do not, so the application sees `PrismaClientKnownRequestError` with code
 * `SQLITE_CONSTRAINT`. This script runs the REAL Express app and routes through the project's real `lib/prisma.ts` ADAPTER
 * path (the adapter is selected by pointing TURSO_DATABASE_URL at a LOCAL temp file, in this process only) and patches the
 * `@libsql/client` prototypes so that REAL constraint violations raised by the routes' own queries lose their `rawCode` -
 * exactly the shape the 2.2.3 rehearsal observed. Faults and "blind" reads are injected deterministically to force race paths.
 *
 * It is a SIMULATION of the error shape on a local SQLite file. It is not evidence of Turso's message text and does not touch
 * any remote database. Requires apps/server/prisma/dev.db (a seeded, fully migrated LOCAL copy); works on a temp copy of it.
 *
 *   env -u TURSO_DATABASE_URL -u TURSO_AUTH_TOKEN npx tsx scripts/turso-shape-regression.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) {
  console.error("Refusing to run: TURSO_* is set in the environment (run with `env -u TURSO_DATABASE_URL -u TURSO_AUTH_TOKEN`).");
  process.exit(2);
}
const SERVER_ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");
if (!fs.existsSync(SOURCE_DB)) {
  console.error("apps/server/prisma/dev.db is missing (a seeded, migrated LOCAL copy is required).");
  process.exit(2);
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), "scl-turso-shape-"));
fs.copyFileSync(SOURCE_DB, path.join(work, "t.db"));
// In this process only: select the adapter path against a LOCAL file. Nothing remote can be reached.
process.env.TURSO_DATABASE_URL = `file:${path.join(work, "t.db")}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.LAB_BLOB_READ_WRITE_TOKEN;
process.env.STORAGE_DIR = path.join(work, "files");
process.env.SESSION_SECRET = "turso-shape-secret-0000000000000000";
process.env.NODE_ENV = "test";

// The global error handler logs unmapped errors; keep the run output readable (the injected faults are expected).
console.error = () => undefined;

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => {
  if (cond) ok++;
  else failures.push(detail ? `${name} -- ${detail}` : name);
};

// ---- error-shape / fault hooks on the real libsql client classes the adapter uses ------------------------------------------
interface Fault { match: RegExp; scope: "any" | "tx" | "client"; make: () => Error; once: boolean; hits: number }
interface Blind { match: RegExp; scope: "tx" | "client"; once: boolean }
const hooks = { strip: true, stripped: 0, faults: [] as Fault[], blind: [] as Blind[] };
const shaped = (message: string, code = "SQLITE_CONSTRAINT") => () => Object.assign(new Error(message), { code }); // no numeric rawCode
const UNIQUE_ERR = (cols: string) => shaped(`UNIQUE constraint failed: ${cols}`);
const FK_ERR = shaped("FOREIGN KEY constraint failed");
const BUSY_ERR = shaped("database is locked", "SQLITE_BUSY");

function patch(proto: any, scope: "tx" | "client") {
  const orig = proto.execute;
  proto.execute = async function (stmt: any) {
    const sql: string = typeof stmt === "string" ? stmt : stmt.sql;
    const fi = hooks.faults.findIndex((f) => (f.scope === "any" || f.scope === scope) && f.match.test(sql));
    if (fi >= 0) {
      const f = hooks.faults[fi];
      f.hits++;
      if (f.once) hooks.faults.splice(fi, 1);
      throw f.make();
    }
    try {
      const res = await orig.call(this, stmt);
      const bi = hooks.blind.findIndex((b) => b.scope === scope && b.match.test(sql));
      if (bi >= 0) {
        if (hooks.blind[bi].once) hooks.blind.splice(bi, 1);
        return { ...res, rows: [] }; // the read "did not see" the committed row yet
      }
      return res;
    } catch (e: any) {
      if (hooks.strip && String(e?.code ?? "").startsWith("SQLITE_CONSTRAINT")) {
        hooks.stripped++;
        throw Object.assign(new Error(e.message), { code: "SQLITE_CONSTRAINT" }); // like a remote error: no rawCode
      }
      throw e;
    }
  };
}
{
  const probe = createClient({ url: ":memory:" });
  patch(Object.getPrototypeOf(probe), "client");
  const tx = await probe.transaction("write");
  patch(Object.getPrototypeOf(tx), "tx");
  await tx.rollback();
  tx.close();
  probe.close();
}

const { prisma } = await import("../src/lib/prisma.ts");
const { createApp } = await import("../src/app.ts");
const { isUniqueViolation } = await import("../src/lib/galleryIdempotency.ts");
const { constraintKind } = await import("../src/lib/dbErrors.ts");

// ---- the app + a cookie-jar client ---------------------------------------------------------------------------------------
const server = createApp().listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", () => r()));
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
let cookie = "";
async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@smartcomputinglab.org", password: "ChangeMe123!" }) });
  for (const c of res.headers.getSetCookie?.() ?? []) if (c.startsWith("scl.sid=")) cookie = c.split(";")[0];
  if (res.status !== 200 || !cookie) throw new Error(`login failed (${res.status})`);
}
async function json(method: string, p: string, body?: unknown) {
  const res = await fetch(`${BASE}/api${p}`, { method, headers: { "Content-Type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, n)]);
async function upload(p: string, n: number, fields: Record<string, string>, key: string) {
  const form = new FormData();
  form.set("file", new Blob([jpeg(n)], { type: "image/jpeg" }), "shape.jpg");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await fetch(`${BASE}/api${p}`, { method: "POST", headers: { cookie, "Idempotency-Key": key }, body: form });
  return { status: res.status, body: (await res.json().catch(() => null)) as any, replayed: res.headers.get("idempotent-replayed") === "true" };
}
const blobCount = () => {
  const walk = (d: string): number => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? walk(path.join(d, e.name)) : 1), 0);
  return fs.existsSync(process.env.STORAGE_DIR!) ? walk(process.env.STORAGE_DIR!) : 0;
};
const uuid = () => crypto.randomUUID();
const fault = (f: Omit<Fault, "hits" | "once"> & { once?: boolean }) => { hooks.faults.push({ once: true, hits: 0, ...f }); };
const clearHooks = () => { hooks.faults.length = 0; hooks.blind.length = 0; hooks.strip = true; };

try {
  await login();

  // ===== helper boundary: gallery isUniqueViolation (the function the gallery routes call) ====================================
  {
    const { Prisma } = await import("@prisma/client");
    const known = (code: string, last: string) => new Prisma.PrismaClientKnownRequestError(`\nInvalid \`prisma.x.create()\` invocation in /a.ts:1:1\n\n→ 1 await prisma.x.create(\n${last}`, { code, clientVersion: "5.22.0", meta: { modelName: "X" } });
    t("gallery isUniqueViolation: typed P2002", isUniqueViolation(known("P2002", "Unique constraint failed on the fields: (`key`)")));
    t("gallery isUniqueViolation: remote shape (SQLITE_CONSTRAINT, UNIQUE text, no meta.target)", isUniqueViolation(known("SQLITE_CONSTRAINT", "UNIQUE constraint failed: GalleryUploadAttempt.userId, GalleryUploadAttempt.key")));
    t("gallery isUniqueViolation: foreign key, NOT NULL, unknown constraint, P2003, P2025, generic, null are all false", [known("SQLITE_CONSTRAINT", "FOREIGN KEY constraint failed"), known("SQLITE_CONSTRAINT", "NOT NULL constraint failed: X.y"), known("SQLITE_CONSTRAINT", "boom"), known("P2003", "x"), known("P2025", "x"), new Error("UNIQUE constraint failed: a.b"), null, undefined, "P2002"].every((e) => !isUniqueViolation(e)));
    t("constraintKind is shared by the helpers (remote unique shape -> unique)", constraintKind(known("SQLITE_CONSTRAINT", "UNIQUE constraint failed: A.b")) === "unique");
  }

  // ===== FORUM reactions ============================================================================================================
  const cat = await prisma.forumCategory.create({ data: { slug: `shape-${uuid().slice(0, 8)}`, name: "Shape", visibility: "LAB_ONLY" } });
  const post = await prisma.forumPost.create({ data: { categoryId: cat.id, authorId: null, title: "Shape post", body: "b" } });
  const comment = await prisma.forumComment.create({ data: { postId: post.id, authorId: null, body: "c" } });
  const reactionRows = (where: object = {}) => prisma.forumReaction.count({ where: { postId: post.id, ...where } });
  const s0 = hooks.stripped;
  const first = await json("POST", `/forum/posts/${post.id}/reactions`, { kind: "LIKE" });
  t("forum: first reaction -> 200 and one row", first.status === 200 && (await reactionRows({ kind: "LIKE" })) === 1, String(first.status));
  const dup = await json("POST", `/forum/posts/${post.id}/reactions`, { kind: "LIKE" });
  t("forum: duplicate reaction (REAL unique violation, remote-shaped by the adapter) -> 200 idempotent no-op", dup.status === 200 && JSON.stringify(dup.body) === JSON.stringify(first.body), String(dup.status));
  t("forum: ... the remote-shaped error was actually produced and no second row exists", hooks.stripped > s0 && (await reactionRows({ kind: "LIKE" })) === 1, `stripped+${hooks.stripped - s0}`);
  hooks.strip = false;
  const dupTyped = await json("POST", `/forum/posts/${post.id}/reactions`, { kind: "LIKE" });
  hooks.strip = true;
  t("forum: duplicate with the typed P2002 shape -> 200 no-op (existing behaviour preserved)", dupTyped.status === 200 && (await reactionRows({ kind: "LIKE" })) === 1);
  fault({ match: /INSERT INTO [`"]main[`"]\.[`"]ForumReaction[`"]/, scope: "tx", make: FK_ERR });
  const fkDup = await json("POST", `/forum/posts/${post.id}/reactions`, { kind: "LIKE" });
  t("forum: a FOREIGN-KEY-shaped failure for an already-reacted kind is NOT swallowed as a duplicate -> 500", fkDup.status === 500 || fkDup.status === 400, String(fkDup.status));
  fault({ match: /INSERT INTO [`"]main[`"]\.[`"]ForumReaction[`"]/, scope: "tx", make: FK_ERR });
  const fkNew = await json("POST", `/forum/posts/${post.id}/reactions`, { kind: "THANKS" });
  t("forum: a foreign-key-shaped failure for a new kind -> error response and nothing persisted", fkNew.status >= 400 && (await reactionRows({ kind: "THANKS" })) === 0, String(fkNew.status));
  fault({ match: /INSERT INTO [`"]main[`"]\.[`"]ForumReaction[`"]/, scope: "tx", make: BUSY_ERR });
  const busy = await json("POST", `/forum/posts/${post.id}/reactions`, { kind: "LOVE" });
  t("forum: an unrelated database error -> 500 and nothing persisted", busy.status === 500 && (await reactionRows({ kind: "LOVE" })) === 0, String(busy.status));
  clearHooks();
  t("forum: the original reaction is untouched after all failures", (await reactionRows()) === 1);
  // comment reactions share the helper (second call site)
  const c1 = await json("POST", `/forum/comments/${comment.id}/reactions`, { kind: "LIKE" });
  const c2 = await json("POST", `/forum/comments/${comment.id}/reactions`, { kind: "LIKE" });
  t("forum comments: duplicate reaction (remote-shaped) -> 200 no-op, one row", c1.status === 200 && c2.status === 200 && (await prisma.forumReaction.count({ where: { commentId: comment.id } })) === 1, `${c1.status}/${c2.status}`);
  fault({ match: /INSERT INTO [`"]main[`"]\.[`"]ForumReaction[`"]/, scope: "tx", make: FK_ERR });
  const c3 = await json("POST", `/forum/comments/${comment.id}/reactions`, { kind: "LIKE" });
  clearHooks();
  t("forum comments: a foreign-key-shaped failure for the existing kind is not swallowed", c3.status >= 400, String(c3.status));

  // ===== MESSAGES: direct conversation race recovery =================================================================================
  const peerUser = await prisma.user.create({ data: { email: `shape-peer-${uuid().slice(0, 6)}@example.test`, passwordHash: "x", role: "MEMBER" } });
  const peerMember = await prisma.teamMember.create({ data: { userId: peerUser.id, name: "Shape Peer", initials: "SP", role: "Member", category: "STUDENT" } });
  const peer2User = await prisma.user.create({ data: { email: `shape-peer2-${uuid().slice(0, 6)}@example.test`, passwordHash: "x", role: "MEMBER" } });
  const peer2Member = await prisma.teamMember.create({ data: { userId: peer2User.id, name: "Shape Peer Two", initials: "S2", role: "Member", category: "STUDENT" } });
  const convCount = (userId: string) => prisma.conversation.count({ where: { participants: { some: { userId } } } });
  const m0 = hooks.stripped;
  const mFirst = await json("POST", "/messages/conversations", { teamMemberId: peerMember.id });
  t("messages: first start -> 201 and one conversation", mFirst.status === 201 && (await convCount(peerUser.id)) === 1, String(mFirst.status));
  const mDup = await json("POST", "/messages/conversations", { teamMemberId: peerMember.id });
  t("messages: second start (REAL unique violation on directKey, remote-shaped) recovers the EXISTING conversation (201, same id)", mDup.status === 201 && mDup.body?.id === mFirst.body?.id, `${mDup.status}`);
  t("messages: ... the remote-shaped error was actually produced and no duplicate conversation exists", hooks.stripped > m0 && (await convCount(peerUser.id)) === 1);
  hooks.strip = false;
  const mTyped = await json("POST", "/messages/conversations", { teamMemberId: peerMember.id });
  hooks.strip = true;
  t("messages: typed P2002 recovery preserved", mTyped.status === 201 && mTyped.body?.id === mFirst.body?.id);
  fault({ match: /INSERT INTO [`"]main[`"]\.[`"]Conversation[`"]/, scope: "any", make: FK_ERR });
  const mFk = await json("POST", "/messages/conversations", { teamMemberId: peerMember.id });
  t("messages: a foreign-key-shaped failure is NOT mistaken for race recovery even though a conversation exists -> error", mFk.status >= 400 && (await convCount(peerUser.id)) === 1, String(mFk.status));
  fault({ match: /INSERT INTO [`"]main[`"]\.[`"]Conversation[`"]/, scope: "any", make: BUSY_ERR });
  const mBusy = await json("POST", "/messages/conversations", { teamMemberId: peerMember.id });
  t("messages: an unrelated database error is not mistaken for race recovery -> 500", mBusy.status === 500, String(mBusy.status));
  fault({ match: /INSERT INTO [`"]main[`"]\.[`"]Conversation[`"]/, scope: "any", make: UNIQUE_ERR("Conversation.directKey") });
  const mNoWinner = await json("POST", "/messages/conversations", { teamMemberId: peer2Member.id });
  t("messages: a unique-shaped failure with NO existing conversation is not reported as success (the app answers 409 already-exists; nothing created)", mNoWinner.status === 409 && (await convCount(peer2User.id)) === 0, String(mNoWinner.status));
  clearHooks();

  // ===== GALLERY: idempotent upload race recovery ====================================================================================
  const items = (caption: string) => prisma.galleryItem.count({ where: { caption } });
  const attempts = (key: string) => prisma.galleryUploadAttempt.count({ where: { key } });
  const PRECHECK = /FROM [`"]main[`"]\.[`"]GalleryUploadAttempt[`"]/;
  const K1 = uuid(), CAP1 = "ZZ Shape create";
  const g1 = await upload("/gallery", 0x41, { caption: CAP1 }, K1);
  t("gallery create: first upload -> 201, one entry, one attempt row", g1.status === 201 && (await items(CAP1)) === 1 && (await attempts(K1)) === 1, String(g1.status));
  const blobs1 = blobCount();
  const s1 = hooks.stripped;
  hooks.blind.push({ match: PRECHECK, scope: "client", once: true });
  const g2 = await upload("/gallery", 0x41, { caption: CAP1 }, K1);
  t("gallery create: lost race (pre-check blind, REAL unique violation, remote-shaped) answers with the WINNER (201, replayed, same id)", g2.status === 201 && g2.replayed && g2.body?.id === g1.body?.id, `${g2.status} replayed=${g2.replayed}`);
  t("gallery create: ... the remote-shaped error was produced; still one entry, one attempt row, no leaked blob", hooks.stripped > s1 && (await items(CAP1)) === 1 && (await attempts(K1)) === 1 && blobCount() === blobs1, `blobs ${blobs1}->${blobCount()}`);
  hooks.strip = false;
  hooks.blind.push({ match: PRECHECK, scope: "client", once: true });
  const g3 = await upload("/gallery", 0x41, { caption: CAP1 }, K1);
  hooks.strip = true;
  t("gallery create: typed P2002 recovery preserved", g3.status === 201 && g3.replayed && g3.body?.id === g1.body?.id);
  hooks.blind.push({ match: PRECHECK, scope: "client", once: true });
  fault({ match: /INSERT INTO [`"]main[`"]\.[`"]GalleryUploadAttempt[`"]/, scope: "tx", make: FK_ERR });
  const g4 = await upload("/gallery", 0x41, { caption: CAP1 }, K1);
  t("gallery create: a foreign-key-shaped failure is NOT treated as a lost race even though a winner exists -> error, no replay", g4.status >= 400 && !g4.replayed && (await items(CAP1)) === 1 && blobCount() === blobs1, String(g4.status));
  hooks.blind.push({ match: PRECHECK, scope: "client", once: true });
  fault({ match: /INSERT INTO [`"]main[`"]\.[`"]GalleryUploadAttempt[`"]/, scope: "tx", make: BUSY_ERR });
  const g5 = await upload("/gallery", 0x41, { caption: CAP1 }, K1);
  t("gallery create: a generic database error stays an error (500), no replay", g5.status === 500 && !g5.replayed, String(g5.status));
  clearHooks();
  const K2 = uuid(), CAP2 = "ZZ Shape nowinner";
  fault({ match: /INSERT INTO [`"]main[`"]\.[`"]GalleryUploadAttempt[`"]/, scope: "tx", make: UNIQUE_ERR("GalleryUploadAttempt.userId, GalleryUploadAttempt.key") });
  const g6 = await upload("/gallery", 0x42, { caption: CAP2 }, K2);
  t("gallery create: a unique-shaped failure with NO completed attempt to re-read is NOT reported as success (409 already-exists), nothing persisted, blob released", g6.status === 409 && (await items(CAP2)) === 0 && (await attempts(K2)) === 0 && blobCount() === blobs1, `${g6.status} blobs ${blobCount()}`);
  clearHooks();

  // APPEND route (second call site)
  const K3 = uuid();
  const a1 = await upload(`/gallery/${g1.body.id}/images`, 0x43, {}, K3);
  t("gallery append: first append -> 201 and one extra image", a1.status === 201 && (await prisma.galleryImage.count({ where: { itemId: g1.body.id } })) === 1, String(a1.status));
  const blobs2 = blobCount();
  const sA = hooks.stripped;
  hooks.blind.push({ match: PRECHECK, scope: "client", once: true }, { match: PRECHECK, scope: "tx", once: true });
  const a2 = await upload(`/gallery/${g1.body.id}/images`, 0x43, {}, K3);
  t("gallery append: lost race (both reads blind, REAL unique violation, remote-shaped) answers with the winner (201, replayed)", a2.status === 201 && a2.replayed && a2.body?.id === g1.body.id, `${a2.status} replayed=${a2.replayed}`);
  t("gallery append: ... remote-shaped error produced; still exactly one appended image, one attempt row, no leaked blob", hooks.stripped > sA && (await prisma.galleryImage.count({ where: { itemId: g1.body.id } })) === 1 && (await attempts(K3)) === 1 && blobCount() === blobs2, `blobs ${blobs2}->${blobCount()}`);
  hooks.blind.push({ match: PRECHECK, scope: "client", once: true }, { match: PRECHECK, scope: "tx", once: true });
  fault({ match: /INSERT INTO [`"]main[`"]\.[`"]GalleryUploadAttempt[`"]/, scope: "tx", make: FK_ERR });
  const a3 = await upload(`/gallery/${g1.body.id}/images`, 0x43, {}, K3);
  t("gallery append: a foreign-key-shaped failure is not a lost race -> error, no replay, nothing added", a3.status >= 400 && !a3.replayed && (await prisma.galleryImage.count({ where: { itemId: g1.body.id } })) === 1, String(a3.status));
  clearHooks();
} finally {
  clearHooks();
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(`\n${ok} turso-shape route checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
process.exit(0);
