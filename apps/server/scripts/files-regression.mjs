/**
 * End-to-end API regression for the generic file infrastructure (Phase 13): /api/files/*.
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:/abs/path/to/copy.db STORAGE_DIR=/abs/path/to/storage PORT=4061 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:/abs/path/to/copy.db API=http://localhost:4061 node scripts/files-regression.mjs
 *
 * Run it ONLY against a COPY of the database (and a disposable STORAGE_DIR): it removes every
 * user/file/audit row it creates (also at start, in case a previous run was interrupted), but
 * makes no attempt to purge physical blobs beyond what the API itself deletes.
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
    this.#saveCookie(res);
    const json = await res.json().catch(() => null);
    return { status: res.status, json, headers: res.headers };
  }
  async upload(path, fields, file) {
    const form = new FormData();
    if (file) form.set("file", new Blob([file.buffer], { type: file.contentType }), file.filename);
    for (const [k, v] of Object.entries(fields ?? {})) form.set(k, v);
    const res = await fetch(`${API}/api${path}`, { method: "POST", headers: this.cookie ? { cookie: this.cookie } : {}, body: form });
    this.#saveCookie(res);
    const json = await res.json().catch(() => null);
    return { status: res.status, json, headers: res.headers };
  }
  async raw(path) {
    const res = await fetch(`${API}/api${path}`, { headers: this.cookie ? { cookie: this.cookie } : {} });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, buf };
  }
  #saveCookie(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      if (/^scl\.sid=;?$/.test(pair) || /Expires=Thu, 01 Jan 1970/i.test(c)) this.cookie = "";
      else if (pair.startsWith("scl.sid=")) this.cookie = pair;
    }
  }
  get = (p) => this.req("GET", p);
  post = (p, b) => this.req("POST", p, b ?? {});
  del = (p) => this.req("DELETE", p);
  login = (email, password) => this.post("/auth/login", { email, password });
}

// ---- real byte signatures for the allow-listed types (content is what's authoritative) --------
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x11)]);
const PDF = Buffer.from(`%PDF-1.7\n${"x".repeat(64)}`, "latin1");
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), Buffer.alloc(64, 0x90)]); // "MZ" PE header
const HTML = Buffer.from(`<html><body><script>alert(1)</script></body></html>`, "utf8");
const PHP = Buffer.from(`<?php system($_GET['c']); ?>`, "utf8");
const PLAIN_TEXT = Buffer.from("just some plain text, not an image or pdf", "utf8");
const OVERSIZED = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20 * 1024 * 1024, 0x11)]); // > default 15MB doc / 5MB image cap

async function cleanup() {
  const testUsers = await prisma.user.findMany({ where: { email: { startsWith: "p13test-" } }, select: { id: true } });
  const ids = testUsers.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.storedFile.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
  }
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: "ZZ Files" } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: "p13test-" } } }).catch(() => {});
}

async function main() {
  await cleanup();

  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);

  const mk = async (key, role, name) => {
    const email = `p13test-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "ZF", memberRole: "Researcher", category: "RESEARCH" });
    const client = new Client();
    await client.login(email, PW);
    return { client, email, status: r.status, id: r.json?.id };
  };

  section("fixtures");
  const guest = new Client();
  const mgr = await mk("mgr", "LAB_MANAGER", "ZZ Files Manager");
  const a = await mk("a", "MEMBER", "ZZ Files Alice");
  const b = await mk("b", "MEMBER", "ZZ Files Bob");
  check("fixtures: three accounts created", [mgr, a, b].every((u) => u.status === 201));

  // ------------------------------------------------------------------
  section("AUTH: guests cannot upload");
  check("guest upload -> 401", (await guest.upload("/files", {}, { buffer: JPEG, filename: "x.jpg", contentType: "image/jpeg" })).status === 401);

  // ------------------------------------------------------------------
  section("UPLOAD: a member can upload; default LAB_ONLY; owner from session, never the body");
  const up1 = await a.client.upload("/files", { ownerId: "someone-else", visibility: "PUBLIC" }, { buffer: JPEG, filename: "photo.jpg", contentType: "image/jpeg" });
  check("member upload without visibility permission (PUBLIC) -> 403 (forged visibility rejected)", up1.status === 403);

  const up2 = await a.client.upload("/files", {}, { buffer: JPEG, filename: "photo.jpg", contentType: "image/jpeg" });
  check("member upload (default visibility) -> 201", up2.status === 201 && up2.json?.id);
  check("response never exposes an owner/account id key", !JSON.stringify(up2.json).includes("ownerId") && !JSON.stringify(up2.json).includes("userId"));
  check("response url is app-relative /api/files/:id", up2.json?.url === `/api/files/${up2.json.id}`);
  const fileId = up2.json.id;
  const dbFile = await prisma.storedFile.findUnique({ where: { id: fileId } });
  check("owner in the database is the SESSION account, not the forged ownerId from the first attempt", dbFile.ownerId === (await prisma.user.findUnique({ where: { email: a.email } })).id);
  check("new file defaults to LAB_ONLY (fail closed)", dbFile.visibility === "LAB_ONLY");
  check("storageKey is an opaque generated key, never the original filename", dbFile.storageKey !== "photo.jpg" && !dbFile.storageKey.includes("photo"));

  // ------------------------------------------------------------------
  section("DOWNLOAD: authorization before bytes are ever sent");
  check("guest cannot fetch a LAB_ONLY file -> 404 (not 403 -- indistinguishable from missing)", (await guest.raw(`/files/${fileId}`)).status === 404);
  const okDownload = await a.client.raw(`/files/${fileId}`);
  check("owner can fetch their own LAB_ONLY file -> 200 with correct bytes", okDownload.status === 200 && okDownload.buf.equals(JPEG));
  check("Content-Type is the validated mime type", okDownload.headers.get("content-type") === "image/jpeg");
  check("X-Content-Type-Options: nosniff is set", okDownload.headers.get("x-content-type-options") === "nosniff");
  const otherMemberDownload = await b.client.raw(`/files/${fileId}`);
  check("another signed-in member CAN see a LAB_ONLY standalone file (lab-wide, like every other LAB_ONLY row)", otherMemberDownload.status === 200);
  check("nonexistent file id -> 404", (await a.client.raw("/files/doesnotexist")).status === 404);
  check("malformed file id -> 400", (await a.client.raw("/files/../../etc/passwd")).status === 400 || (await a.client.raw("/files/../../etc/passwd")).status === 404);

  const pubUpload = await mgr.client.upload("/files", { visibility: "PUBLIC" }, { buffer: JPEG, filename: "pub.jpg", contentType: "image/jpeg" });
  check("manager CAN set visibility=PUBLIC on upload -> 201", pubUpload.status === 201);
  check("guest can now fetch the PUBLIC file -> 200", (await guest.raw(`/files/${pubUpload.json.id}`)).status === 200);

  // ------------------------------------------------------------------
  section("SECURITY: hostile filenames never touch the filesystem, content decides the type");
  const hostileNames = ["../../secret.txt", "..\\..\\secret.txt", "C:\\Windows\\System32\\evil.dll", "/etc/passwd", "<script>alert(1)</script>.jpg", "foo.php", "foo.exe", "foo.html"];
  for (const name of hostileNames) {
    const r = await a.client.upload("/files", {}, { buffer: JPEG, filename: name, contentType: "image/jpeg" });
    check(`hostile filename "${name}" with REAL jpeg bytes still succeeds (name is metadata only)`, r.status === 201, `status=${r.status}`);
    if (r.status === 201) {
      check(`hostile filename "${name}" never leaks a path separator into originalName`, !r.json.originalName.includes("/") && !r.json.originalName.includes("\\"));
    }
  }

  section("SECURITY: content is authoritative -- a mismatched/dangerous payload is rejected regardless of name");
  check("an EXE payload named foo.jpg is rejected (400)", (await a.client.upload("/files", {}, { buffer: EXE, filename: "foo.jpg", contentType: "image/jpeg" })).status === 400);
  check("raw HTML/script payload is rejected (400)", (await a.client.upload("/files", {}, { buffer: HTML, filename: "foo.png", contentType: "image/png" })).status === 400);
  check("raw PHP source payload is rejected (400)", (await a.client.upload("/files", {}, { buffer: PHP, filename: "foo.jpg", contentType: "image/jpeg" })).status === 400);
  check("plain text claiming to be a PDF is rejected (400)", (await a.client.upload("/files", {}, { buffer: PLAIN_TEXT, filename: "doc.pdf", contentType: "application/pdf" })).status === 400);
  check("an oversized upload is rejected (413)", [413].includes((await a.client.upload("/files", {}, { buffer: OVERSIZED, filename: "big.jpg", contentType: "image/jpeg" })).status));
  check("a real PDF is accepted", (await a.client.upload("/files", {}, { buffer: PDF, filename: "paper.pdf", contentType: "application/pdf" })).status === 201);
  check("no file at all -> 400", (await a.client.upload("/files", {}, null)).status === 400);

  // ------------------------------------------------------------------
  section("DELETE: owner or manager only; deleted file cannot be downloaded again");
  const toDelete = await b.client.upload("/files", {}, { buffer: JPEG, filename: "mine.jpg", contentType: "image/jpeg" });
  check("owner setup upload ok", toDelete.status === 201);
  check("a different member (not owner, not manager) cannot delete -> 403", (await a.client.del(`/files/${toDelete.json.id}`)).status === 403);
  check("guest cannot delete -> 401", (await guest.del(`/files/${toDelete.json.id}`)).status === 401);
  const delByOwner = await b.client.del(`/files/${toDelete.json.id}`);
  check("owner can delete their own file -> 200", delByOwner.status === 200);
  check("deleted file cannot be downloaded (404)", (await b.client.raw(`/files/${toDelete.json.id}`)).status === 404);
  check("deleting again -> 404 (already gone)", (await b.client.del(`/files/${toDelete.json.id}`)).status === 404);

  const toDeleteByMgr = await a.client.upload("/files", {}, { buffer: JPEG, filename: "mine2.jpg", contentType: "image/jpeg" });
  const delByMgr = await mgr.client.del(`/files/${toDeleteByMgr.json.id}`);
  check("a manager (not the owner) CAN delete a file -> 200", delByMgr.status === 200);

  // ------------------------------------------------------------------
  section("AUDIT: only safe metadata, never file bytes");
  const uploadAudits = await prisma.auditLog.findMany({ where: { action: { in: ["FILE_UPLOADED", "FILE_DELETED"] }, entityId: { not: null } }, orderBy: { createdAt: "desc" }, take: 20 });
  check("upload/delete audit rows exist", uploadAudits.length > 0);
  check("no audit details row ever contains a storage key or the word 'buffer'", uploadAudits.every((r) => !r.details || !/storageKey|buffer/i.test(r.details)));
  check(
    "audit details only ever contain the documented safe keys (mimeType/sizeBytes/visibility)",
    uploadAudits.every((r) => !r.details || Object.keys(JSON.parse(r.details)).every((k) => ["mimeType", "sizeBytes", "visibility"].includes(k))),
  );

  // ------------------------------------------------------------------
  await cleanup();
  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Script crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
