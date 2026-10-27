/**
 * Regression test of POST /api/profile/photo (Phase 3A) through the REAL application (createApp), a REAL password login and
 * multipart uploads. Everything is isolated: a brand-new SQLite file built from the repository's own migrations in a temp
 * directory, and a temp STORAGE_DIR. It never reads TURSO_* / DATABASE_URL (it refuses to run if TURSO_* is set), never touches a
 * hosted database and never opens a non-loopback connection.
 *   npx tsx scripts/profile-photo-regression.ts      (or: npm run test:profile-photo -w apps/server)
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import * as FX from "./imageFixtures.ts";

if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) {
  console.error("Refusing to run: Turso variables are set. Unset TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.");
  process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, "..", "prisma", "migrations");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "scl-profile-photo-"));
const dbFile = path.join(workDir, "t.db");
const storageDir = path.join(workDir, "files");

// A database with exactly the application's schema: every migration directory, in order.
{
  const c = createClient({ url: `file:${dbFile}` });
  for (const d of fs.readdirSync(MIGRATIONS, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) {
    await c.executeMultiple(fs.readFileSync(path.join(MIGRATIONS, d, "migration.sql"), "utf8"));
  }
  c.close();
}
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.SESSION_SECRET = "profile-photo-regression-secret-0000000";
process.env.NODE_ENV = "test";
process.env.STORAGE_DIR = storageDir;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.LAB_BLOB_READ_WRITE_TOKEN;

// ---- network guard: only loopback ------------------------------------------------------------------------------------------
let offLoopback = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const u = new URL(typeof input === "string" ? input : input.url ?? String(input));
  if (u.hostname !== "127.0.0.1") {
    offLoopback++;
    return Promise.reject(new Error("network blocked"));
  }
  return realFetch(input, init);
}) as typeof fetch;

// Everything the app logs is captured (the run must not leak file bytes, hashes or storage keys into logs).
const logged: string[] = [];
const realError = console.error;
console.error = (...a: unknown[]) => void logged.push(a.map((x) => (typeof x === "string" ? x : `<<${typeof x}>>`)).join(" "));

const bcrypt = (await import("bcryptjs")).default;
const { prisma } = await import("../src/lib/prisma.js");
const { createApp } = await import("../src/app.js");
const { saveFile } = await import("../src/lib/storage.js");
const { PROFILE_PHOTO_ENTITY_TYPE } = await import("../src/lib/profilePhoto.js");

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(detail ? `${name} :: ${detail}` : name));

// ---- fixtures: files -------------------------------------------------------------------------------------------------------
const CRC = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tbl[n] = c >>> 0;
  }
  return (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = tbl[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
};
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = (w: number, h: number) => {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(w, 0);
  d.writeUInt32BE(h, 4);
  d[8] = 8;
  d[9] = 2;
  return chunk("IHDR", d);
};
const png = (w: number, h: number, shade = 0x7f): Buffer => {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, shade)]);
  return Buffer.concat([PNG_SIG, ihdr(w, h), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
};
const claimedPng = (w: number, h: number) => Buffer.concat([PNG_SIG, ihdr(w, h), chunk("IDAT", Buffer.from([0x78, 0x9c, 3, 0, 0, 0, 0, 1])), chunk("IEND", Buffer.alloc(0))]);
const seg = (m: number, body: Buffer) => {
  const l = Buffer.alloc(2);
  l.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, m]), l, body]);
};
const jpeg = (w: number, h: number) => FX.jpegFile({ w, h, comps: 1 });

// ---- fixtures: server, browser ---------------------------------------------------------------------------------------------
const server = await new Promise<{ base: string; close: () => void }>((resolve) => {
  const s = http.createServer(createApp()).listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${(s.address() as any).port}`, close: () => s.close() }));
});
class Browser {
  jar = new Map<string, string>();
  async req(method: string, p: string, body?: BodyInit, headers: Record<string, string> = {}) {
    let res: Response;
    let buf: Buffer;
    try {
      res = await fetch(server.base + p, { method, redirect: "manual", headers: { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "), ...headers }, body });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i);
        const val = pair.slice(i + 1);
        if (/;\s*Expires=Thu, 01 Jan 1970/i.test(c) || val === "") this.jar.delete(name);
        else this.jar.set(name, val);
      }
      buf = Buffer.from(await res.arrayBuffer());
    } catch {
      // The server may refuse an over-cap body by closing the connection while it is still being sent. That is a refusal, not a crash.
      return { status: 0, headers: new Headers(), buf: Buffer.alloc(0), json: null as any, text: "connection closed by the server" };
    }
    let json: any = null;
    try { json = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, buf, json, text: buf.toString("latin1") };
  }
  get = (p: string) => this.req("GET", p);
  login = (email: string, password: string) => this.req("POST", "/api/auth/login", JSON.stringify({ email, password }), { "Content-Type": "application/json" });
  logout = () => this.req("POST", "/api/auth/logout", "{}", { "Content-Type": "application/json" });
  /** multipart upload to the endpoint. */
  upload(bytes: Buffer | null, opts: { name?: string; type?: string; field?: string; extra?: Record<string, string>; query?: string; second?: Buffer } = {}) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(opts.extra ?? {})) fd.append(k, v);
    if (bytes) fd.append(opts.field ?? "file", new Blob([bytes], { type: opts.type ?? "application/octet-stream" }), opts.name ?? "photo.bin");
    if (opts.second) fd.append("file", new Blob([opts.second], { type: "image/png" }), "second.png");
    return this.req("POST", `/api/profile/photo${opts.query ?? ""}`, fd);
  }
}
const PW = "Passw0rd!-test";
const hash = await bcrypt.hash(PW, 4);
const mkUser = (email: string, role = "MEMBER") => prisma.user.create({ data: { email, passwordHash: hash, role } });
const alice = await mkUser("alice@example.org");
const bob = await mkUser("bob@example.org");
const carol = await mkUser("carol@example.org"); // an account with NO team profile
const mgr = await mkUser("manager@example.org", "LAB_MANAGER");
const mkMember = (name: string, userId: string | null, photoUrl = "") => prisma.teamMember.create({ data: { name, initials: name.slice(0, 2).toUpperCase(), role: "Researcher", category: "MSC", userId, photoUrl, department: "D", bio: "B" } });
const aliceM = await mkMember("Alice A", alice.id);
const LEGACY_URL = "https://photos.example.org/bob.png";
const bobM = await mkMember("Bob B", bob.id, LEGACY_URL);
const noAccountM = await mkMember("Dana D", null, "https://photos.example.org/dana.png");
const mgrM = await mkMember("Manager M", mgr.id);

// Unrelated stored data that must survive everything below: a gallery entry with a real blob, plus a library file with a blob.
const galleryBytes = png(20, 20, 0x10);
const galleryKey = await saveFile(galleryBytes);
const galleryFile = await prisma.storedFile.create({ data: { storageKey: galleryKey, originalName: "g.png", mimeType: "image/png", sizeBytes: galleryBytes.length, visibility: "PUBLIC", ownerId: alice.id } });
const galleryItem = await prisma.galleryItem.create({ data: { fileId: galleryFile.id, caption: "kept", category: "LAB_LIFE" } });
const libKey = await saveFile(Buffer.from("%PDF-1.4\n%lib\n"));
const libFile = await prisma.storedFile.create({ data: { storageKey: libKey, originalName: "lib.pdf", mimeType: "application/pdf", sizeBytes: 14, visibility: "LAB_ONLY", ownerId: alice.id } });

const blobs = () => fs.readdirSync(storageDir).sort();
const counts = async () => ({ files: await prisma.storedFile.count(), live: await prisma.storedFile.count({ where: { deletedAt: null } }), members: await prisma.teamMember.count(), users: await prisma.user.count(), gallery: await prisma.galleryItem.count(), audits: await prisma.auditLog.count() });
const photoOf = async (id: string) => (await prisma.teamMember.findUnique({ where: { id } }))!.photoUrl;
const A = new Browser();
const B = new Browser();
const C = new Browser();
const M = new Browser();
t("login: alice, bob, carol and the manager can sign in with their passwords", (await A.login("alice@example.org", PW)).status === 200 && (await B.login("bob@example.org", PW)).status === 200 && (await C.login("carol@example.org", PW)).status === 200 && (await M.login("manager@example.org", PW)).status === 200);

// Snapshot of everything that must NOT change, taken before the first upload.
const snapshot = async () =>
  JSON.stringify({
    users: await prisma.user.findMany({ orderBy: { id: "asc" } }),
    members: (await prisma.teamMember.findMany({ orderBy: { id: "asc" } })).map((m) => ({ ...m, photoUrl: m.id === aliceM.id || m.id === bobM.id ? "-" : m.photoUrl, updatedAt: m.id === aliceM.id || m.id === bobM.id ? "-" : m.updatedAt })),
    gallery: await prisma.galleryItem.findMany(),
    unrelatedFiles: await prisma.storedFile.findMany({ where: { id: { in: [galleryFile.id, libFile.id] } } }),
  });
const before = await snapshot();
const blobsBefore = blobs();
t("setup: the gallery blob and the library blob exist", blobsBefore.includes(galleryKey) && blobsBefore.includes(libKey));

// ==================================================================================================================================
// 1. Authentication and linkage
const g0 = await counts();
{
  const anon = new Browser();
  const r = await anon.upload(png(64, 64), { name: "p.png", type: "image/png" });
  t("unauthenticated upload -> 401", r.status === 401);
  t("unauthenticated upload wrote nothing (no blob, no row)", JSON.stringify(blobs()) === JSON.stringify(blobsBefore) && JSON.stringify(await counts()) === JSON.stringify(g0));
  const lo = new Browser();
  await lo.login("alice@example.org", PW);
  await lo.logout();
  t("after logout the old session cannot upload (401)", (await lo.upload(png(64, 64), { name: "p.png", type: "image/png" })).status === 401);

  const nm = await C.upload(png(64, 64), { name: "p.png", type: "image/png" });
  t("an account with no linked team profile -> 404", nm.status === 404 && /No team profile/.test(String(nm.json?.error)));
  t("…and no blob or row was created for it", JSON.stringify(blobs()) === JSON.stringify(blobsBefore) && JSON.stringify(await counts()) === JSON.stringify(g0));
  t("a LAB manager without a profile of their own is not special-cased (own profile only)", (await M.upload(png(64, 64), { name: "p.png", type: "image/png" })).status === 201 && (await photoOf(mgrM.id)).startsWith("/api/files/"));
}

// ==================================================================================================================================
// 2. Invalid input: nothing may change (photoUrl, rows, blobs)
const rejectCases: [string, Buffer | null, Parameters<Browser["upload"]>[1]][] = [
  ["a text file named .png", Buffer.from("just text, not an image"), { name: "x.png", type: "image/png" }],
  ["a PDF", Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"), { name: "x.pdf", type: "application/pdf" }],
  ["an SVG containing a script", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { name: "x.svg", type: "image/svg+xml" }],
  ["HTML declared as image/png", Buffer.from("<html><script>alert(1)</script></html>"), { name: "x.png", type: "image/png" }],
  ["a PHP script named .jpg", Buffer.from("<?php system($_GET['c']); ?>"), { name: "shell.jpg", type: "image/jpeg" }],
  ["an ELF executable named .png", Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(200, 1)]), { name: "a.png", type: "image/png" }],
  ["a Windows executable named .jpg", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 1)]), { name: "a.jpg", type: "image/jpeg" }],
  ["an empty file", Buffer.alloc(0), { name: "e.png", type: "image/png" }],
  ["a PNG truncated mid-file", png(64, 64).subarray(0, 80), { name: "t.png", type: "image/png" }],
  ["a PNG with a corrupt checksum", (() => { const b = Buffer.from(png(64, 64)); b[20] ^= 0xff; return b; })(), { name: "c.png", type: "image/png" }],
  ["a JPEG signature followed by garbage", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("not really a jpeg")]), { name: "j.jpg", type: "image/jpeg" }],
  ["a GIF header followed by a script", Buffer.from("GIF89a<script>alert(1)</script>"), { name: "g.gif", type: "image/gif" }],
  ["a PNG claiming 60000 x 60000 pixels in a tiny file", claimedPng(60000, 60000), { name: "bomb.png", type: "image/png" }],
  ["a PNG claiming 6001 pixels wide", claimedPng(6001, 100), { name: "wide.png", type: "image/png" }],
  ["a PNG of 5000 x 5000 (25 megapixels)", claimedPng(5000, 5000), { name: "mp.png", type: "image/png" }],
  ["a PNG of 8 x 8 (too small)", png(8, 8), { name: "tiny.png", type: "image/png" }],
  ["a valid PNG larger than the 5 MB image limit", Buffer.concat([png(64, 64), Buffer.alloc(6 * 1024 * 1024)]), { name: "big.png", type: "image/png" }],
  ["a file over the transport cap (16 MB)", Buffer.concat([png(64, 64), Buffer.alloc(16 * 1024 * 1024)]), { name: "huge.png", type: "image/png" }],
  ["no file at all", null, {}],
  ["the wrong field name", png(64, 64), { name: "p.png", type: "image/png", field: "image" }],
  ["two files", png(64, 64), { name: "p.png", type: "image/png", second: png(64, 64) }],
];
await A.upload(png(80, 80, 0x20), { name: "first.png", type: "image/png" }); // alice's first photo
const aliceFirstUrl = await photoOf(aliceM.id);
const aliceFirstId = aliceFirstUrl.split("/").pop()!;
{
  const base = await counts();
  const baseBlobs = blobs();
  for (const [name, bytes, opts] of rejectCases) {
    const r = await A.upload(bytes, opts);
    const unchanged = (await photoOf(aliceM.id)) === aliceFirstUrl && JSON.stringify(await counts()) === JSON.stringify(base) && JSON.stringify(blobs()) === JSON.stringify(baseBlobs);
    const transportCap = name.includes("transport cap");
    t(`rejected (4xx, clear error): ${name}`, transportCap ? r.status === 413 || r.status === 0 : r.status >= 400 && r.status < 500 && typeof r.json?.error === "string" && r.json.error.length > 0, `status ${r.status} ${r.text.slice(0, 80)}`);
    t(`…and nothing changed (photoUrl, rows, blobs): ${name}`, unchanged);
  }
  t("the previous photo is still retrievable after all the rejected uploads", (await new Browser().get(aliceFirstUrl)).status === 200);
}

// ==================================================================================================================================
// 3. Successful upload, retrieval, headers and stored metadata
let aliceUrl = "";
{
  const bytes = png(64, 48, 0x55);
  const r = await A.upload(bytes, { name: "../../etc/passwd.png", type: "text/plain" }); // hostile name and a wrong declared type
  t("valid PNG upload -> 201", r.status === 201, `${r.status} ${r.text.slice(0, 100)}`);
  aliceUrl = r.json?.photoUrl ?? "";
  t("the response is the member's profile with a same-origin photo URL", /^\/api\/files\/[A-Za-z0-9_-]+$/.test(aliceUrl) && r.json?.id === aliceM.id && r.json?.isOwn === true);
  t("the response exposes no storage key, owner id or filesystem path", !/storageKey|ownerId|userId|\/tmp|\/files\/[0-9a-f]{8}-/.test(r.text));
  const row = await prisma.storedFile.findUnique({ where: { id: aliceUrl.split("/").pop()! } });
  t("StoredFile: public, owned by alice, attached to her TeamMember", !!row && row.visibility === "PUBLIC" && row.ownerId === alice.id && row.entityType === "TEAM_MEMBER" && row.entityId === aliceM.id);
  t("StoredFile: real type from the bytes (not the declared text/plain), size and SHA-256", !!row && row.mimeType === "image/png" && row.sizeBytes === bytes.length && row.sha256 === (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"));
  t("StoredFile: the client file name is never stored (fixed name; it is sent in Content-Disposition on a public file)", !!row && row.originalName === "profile-photo.png");
  t("StoredFile: an opaque UUID storage key, and exactly that blob exists on disk", !!row && /^[0-9a-f-]{36}$/.test(row.storageKey) && blobs().includes(row.storageKey) && fs.readFileSync(path.join(storageDir, row.storageKey)).equals(bytes));
  t("no file was written outside the storage directory (traversal name)", !fs.existsSync(path.join(workDir, "passwd.png")) && !fs.existsSync("/etc/passwd.png"));

  const guest = new Browser();
  const got = await guest.get(aliceUrl);
  t("a GUEST can retrieve the photo (public) with the right bytes and type", got.status === 200 && got.headers.get("content-type") === "image/png" && got.buf.equals(bytes));
  t("served inline, nosniff, and NOT cacheable (private, no-store: the integrated policy; access follows the profile's visibility on every request)", /^inline/.test(got.headers.get("content-disposition") ?? "") && got.headers.get("x-content-type-options") === "nosniff" && /private/.test(got.headers.get("cache-control") ?? "") && /no-store/.test(got.headers.get("cache-control") ?? "") && !/public/.test(got.headers.get("cache-control") ?? ""));
  const team = await guest.get("/api/team");
  t("the public team list shows the new photo URL", team.status === 200 && (team.json as any[]).find((m) => m.id === aliceM.id)?.photoUrl === aliceUrl);
  t("the public team list leaks no storage key or account id", !/storageKey|"userId"/.test(team.text));
  t("the audit log recorded the upload and the profile change", (await prisma.auditLog.count({ where: { action: "FILE_UPLOADED", entityId: row!.id } })) === 1 && (await prisma.auditLog.count({ where: { action: "TEAM_MEMBER_UPDATED", entityId: aliceM.id } })) >= 1);
  t("the audit rows for these entities hold no storage key or file hash", !(await prisma.auditLog.findMany({ where: { entityId: { in: [row!.id, aliceM.id] } } })).some((a) => JSON.stringify(a).includes(row!.storageKey) || JSON.stringify(a).includes(String(row!.sha256))));
}

// ==================================================================================================================================
// 4. Replacement: the old photo is retired only once the new one is committed
{
  const oldId = aliceUrl.split("/").pop()!;
  const oldRow = (await prisma.storedFile.findUnique({ where: { id: oldId } }))!;
  const bytes = jpeg(120, 90);
  const r = await A.upload(bytes, { name: "second.jpg", type: "image/jpeg" });
  t("replacing with a JPEG -> 201", r.status === 201, `${r.status} ${r.text.slice(0, 100)}`);
  const newUrl = r.json?.photoUrl ?? "";
  t("a new photo URL is returned and stored", newUrl !== aliceUrl && (await photoOf(aliceM.id)) === newUrl);
  t("the new photo is retrievable by a guest with the right bytes", (await new Browser().get(newUrl)).buf.equals(bytes));
  const retired = await prisma.storedFile.findUnique({ where: { id: oldId } });
  t("the old uploaded photo was retired (soft-deleted) and its blob removed", !!retired?.deletedAt && !blobs().includes(oldRow.storageKey));
  t("the retired photo is no longer retrievable (404)", (await new Browser().get(aliceUrl)).status === 404);
  t("exactly one live profile photo remains for alice", (await prisma.storedFile.count({ where: { entityType: "TEAM_MEMBER", entityId: aliceM.id, deletedAt: null } })) === 1);
  t("the replacement is audited (FILE_DELETED for the retired photo)", (await prisma.auditLog.count({ where: { action: "FILE_DELETED", entityId: oldId } })) === 1);
  aliceUrl = newUrl;
}
t("alice's first photo (before the rejected cases) was retired by the replacement too", !!(await prisma.storedFile.findUnique({ where: { id: aliceFirstId } }))?.deletedAt || (await photoOf(aliceM.id)) !== aliceFirstUrl);

// ==================================================================================================================================
// 5. Cross-member isolation: no client-supplied member or visibility
{
  const bobBefore = await photoOf(bobM.id);
  const g = await counts();
  const bl = blobs();
  for (const [field, value] of [["memberId", bobM.id], ["teamMemberId", bobM.id], ["userId", bob.id], ["id", bobM.id], ["visibility", "LAB_ONLY"], ["entityType", "GALLERY"], ["entityId", bobM.id], ["ownerId", bob.id]] as const) {
    const r = await A.upload(png(64, 64), { name: "p.png", type: "image/png", extra: { [field]: value } });
    t(`a client-supplied "${field}" field is refused (400)`, r.status === 400, `${r.status}`);
  }
  t("those refusals changed nothing", JSON.stringify(await counts()) === JSON.stringify(g) && JSON.stringify(blobs()) === JSON.stringify(bl) && (await photoOf(bobM.id)) === bobBefore && (await photoOf(aliceM.id)) === aliceUrl);
  const q = await A.upload(png(70, 70, 0x33), { name: "q.png", type: "image/png", query: `?teamMemberId=${bobM.id}&memberId=${bobM.id}&visibility=LAB_ONLY` });
  t("ids in the query string are ignored: alice's own profile is the only one changed", q.status === 201 && q.json?.id === aliceM.id && (await photoOf(bobM.id)) === bobBefore);
  const newest = (await prisma.storedFile.findUnique({ where: { id: (await photoOf(aliceM.id)).split("/").pop()! } }))!;
  t("the stored visibility is PUBLIC whatever the client sent (server-assigned)", newest.visibility === "PUBLIC" && newest.entityId === aliceM.id);
  aliceUrl = await photoOf(aliceM.id);

  // Bob uploads: only bob changes; his legacy external URL is replaced but nothing was retired for it.
  const retiredBefore = await prisma.storedFile.count({ where: { deletedAt: { not: null } } });
  const r = await B.upload(png(90, 60, 0x66), { name: "bob.png", type: "image/png" });
  t("bob's upload succeeds and only changes bob (alice's photo is untouched)", r.status === 201 && r.json?.id === bobM.id && (await photoOf(aliceM.id)) === aliceUrl);
  t("bob had a legacy EXTERNAL url: no stored file was retired because of it", (await prisma.storedFile.count({ where: { deletedAt: { not: null } } })) === retiredBefore);
  t("bob's new photo is attached to bob's profile", (await prisma.storedFile.count({ where: { entityType: "TEAM_MEMBER", entityId: bobM.id, deletedAt: null } })) === 1);
  t("a member with no account (Dana) is untouched", (await photoOf(noAccountM.id)) === "https://photos.example.org/dana.png");
}

// ==================================================================================================================================
// 6. Only a CONFIRMED old uploaded profile photo of this very member is ever retired
{
  const retireCheck = async (label: string, urlToPlant: string, victimId: string) => {
    await prisma.teamMember.update({ where: { id: bobM.id }, data: { photoUrl: urlToPlant } });
    const victimBefore = await prisma.storedFile.findUnique({ where: { id: victimId } });
    const r = await B.upload(png(70, 70, 0x44), { name: "x.png", type: "image/png" });
    const victimAfter = await prisma.storedFile.findUnique({ where: { id: victimId } });
    t(`${label}: upload succeeds`, r.status === 201);
    t(`${label}: that file was NOT retired and its row is unchanged`, !!victimAfter && victimAfter.deletedAt === null && JSON.stringify(victimAfter) === JSON.stringify(victimBefore));
  };
  await retireCheck("photoUrl pointing at a GALLERY file", `/api/files/${galleryFile.id}`, galleryFile.id);
  t("…the gallery blob and entry survive", blobs().includes(galleryKey) && !!(await prisma.galleryItem.findUnique({ where: { id: galleryItem.id } })));
  await retireCheck("photoUrl pointing at a LIBRARY file", `/api/files/${libFile.id}`, libFile.id);
  const alicePhotoId = aliceUrl.split("/").pop()!;
  await retireCheck("photoUrl pointing at ANOTHER member's profile photo", aliceUrl, alicePhotoId);
  t("…alice's photo is still served", (await new Browser().get(aliceUrl)).status === 200);
  for (const planted of ["/api/files/../../etc/passwd", "/api/files/" + "a".repeat(200), "https://evil.example.org/x.png", "/api/files/abc?x=1", ""]) {
    await prisma.teamMember.update({ where: { id: bobM.id }, data: { photoUrl: planted } });
    const g = await counts();
    const deletedBefore = JSON.stringify((await prisma.storedFile.findMany({ where: { deletedAt: { not: null } }, select: { id: true }, orderBy: { id: "asc" } })));
    const r = await B.upload(png(70, 70), { name: "x.png", type: "image/png" });
    const deletedAfter = JSON.stringify((await prisma.storedFile.findMany({ where: { deletedAt: { not: null } }, select: { id: true }, orderBy: { id: "asc" } })));
    t(`a stored photoUrl of "${planted.slice(0, 30)}" is never treated as one of ours (upload fine, exactly one file added, none retired)`, r.status === 201 && (await counts()).files === g.files + 1 && deletedAfter === deletedBefore);
  }
}

// ==================================================================================================================================
// 7. Failure injection: a database failure after the blob is written must clean up the NEW blob and keep the OLD photo
{
  let failOn: { model: string; action: string } | null = null;
  (prisma as any).$use(async (params: any, next: any) => {
    if (failOn && params.model === failOn.model && params.action === failOn.action) {
      failOn = null;
      throw new Error("injected failure");
    }
    return next(params);
  });
  const targets: [string, { model: string; action: string }][] = [
    ["creating the StoredFile row (the first statement)", { model: "StoredFile", action: "create" }],
    ["updating the TeamMember's photoUrl", { model: "TeamMember", action: "update" }],
    ["retiring the previous file", { model: "StoredFile", action: "update" }],
    ["writing an audit row", { model: "AuditLog", action: "create" }],
  ];
  for (const [label, spec] of targets) {
    const urlBefore = await photoOf(aliceM.id);
    const prevRow = (await prisma.storedFile.findUnique({ where: { id: urlBefore.split("/").pop()! } }))!;
    const g = await counts();
    const bl = blobs();
    const snap = await snapshot();
    failOn = spec;
    const r = await A.upload(png(66, 66, 0x77), { name: "f.png", type: "image/png" });
    failOn = null;
    t(`failure while ${label}: the request fails (5xx)`, r.status >= 500, `${r.status}`);
    t(`failure while ${label}: no new blob remains (cleaned up)`, JSON.stringify(blobs()) === JSON.stringify(bl));
    t(`failure while ${label}: all rows rolled back (counts identical)`, JSON.stringify(await counts()) === JSON.stringify(g));
    t(`failure while ${label}: the previous photo is intact, live and served`, (await photoOf(aliceM.id)) === urlBefore && (await prisma.storedFile.findUnique({ where: { id: prevRow.id } }))?.deletedAt === null && (await new Browser().get(urlBefore)).status === 200);
    t(`failure while ${label}: unrelated data is intact`, (await snapshot()) === snap);
    t(`failure while ${label}: the error body leaks no internals`, !/injected|Prisma|SQL|storageKey/i.test(r.text));
  }
  const ok1 = await A.upload(png(66, 66, 0x78), { name: "after.png", type: "image/png" });
  t("after the injected failures a normal upload still works", ok1.status === 201);
  aliceUrl = await photoOf(aliceM.id);
}

// ==================================================================================================================================
// 8. Resilience: a missing old blob does not fail the upload; two simultaneous uploads leave one live photo; no external calls
{
  const cur = await photoOf(aliceM.id);
  const curRow = (await prisma.storedFile.findUnique({ where: { id: cur.split("/").pop()! } }))!;
  fs.unlinkSync(path.join(storageDir, curRow.storageKey)); // the previous blob is already gone
  const r = await A.upload(png(72, 72, 0x21), { name: "n.png", type: "image/png" });
  t("replacing a photo whose old blob is already missing still succeeds", r.status === 201 && (await prisma.storedFile.findUnique({ where: { id: curRow.id } }))?.deletedAt !== null);

  const [r1, r2] = await Promise.all([A.upload(png(73, 73, 0x31), { name: "p1.png", type: "image/png" }), A.upload(png(74, 74, 0x32), { name: "p2.png", type: "image/png" })]);
  t("two simultaneous uploads both finish without a server error", r1.status < 500 && r2.status < 500, `${r1.status}/${r2.status}`);
  const live = await prisma.storedFile.findMany({ where: { entityType: "TEAM_MEMBER", entityId: aliceM.id, deletedAt: null } });
  t("…and exactly one live photo remains, the one alice's profile points at", live.length === 1 && (await photoOf(aliceM.id)) === `/api/files/${live[0].id}`);
  t("…and its blob exists", blobs().includes(live[0].storageKey));
  aliceUrl = await photoOf(aliceM.id);
}

// ==================================================================================================================================
// 9. The visibility-parent rule for TEAM_MEMBER files, and the fail-closed default
{
  const guest = new Browser();
  const key = await saveFile(png(30, 30));
  const mk = (over: object) => prisma.storedFile.create({ data: { storageKey: key, originalName: "x.png", mimeType: "image/png", sizeBytes: 5, ownerId: alice.id, ...over } as any });
  const orphan = await mk({ visibility: "PUBLIC", entityType: "TEAM_MEMBER", entityId: "does-not-exist-000000000" });
  t("a TEAM_MEMBER file whose profile no longer exists is not served (404)", (await guest.get(`/api/files/${orphan.id}`)).status === 404);
  await prisma.storedFile.delete({ where: { id: orphan.id } });
  const key2 = await saveFile(png(30, 30));
  const labOnly = await prisma.storedFile.create({ data: { storageKey: key2, originalName: "x.png", mimeType: "image/png", sizeBytes: 5, ownerId: alice.id, visibility: "LAB_ONLY", entityType: "TEAM_MEMBER", entityId: aliceM.id } });
  t("a LAB_ONLY TEAM_MEMBER file is hidden from guests", (await guest.get(`/api/files/${labOnly.id}`)).status === 404);
  t("…and visible to a signed-in member", (await B.get(`/api/files/${labOnly.id}`)).status === 200);
  const key3 = await saveFile(png(30, 30));
  const unknown = await prisma.storedFile.create({ data: { storageKey: key3, originalName: "x.png", mimeType: "image/png", sizeBytes: 5, ownerId: alice.id, visibility: "PUBLIC", entityType: "SOMETHING_ELSE", entityId: aliceM.id } });
  t("an unrecognised entityType still fails closed for guests", (await guest.get(`/api/files/${unknown.id}`)).status === 404);
  await prisma.storedFile.deleteMany({ where: { id: { in: [labOnly.id, unknown.id] } } });
  for (const k of [key, key2, key3]) fs.rmSync(path.join(storageDir, k), { force: true });
}

// ==================================================================================================================================
// 9b. Sanitization is wired in: only the sanitized bytes (known metadata containers removed) are stored, hashed, sized and served
{
  const F = await import("./imageFixtures.ts");
  const { sanitizeImage } = await import("../src/lib/imageSanitize.js");
  const nodeCrypto = await import("node:crypto");
  const hasSentinel = (b: Buffer) => F.ALL_SENTINEL_STRINGS.some((s) => b.includes(Buffer.from(s, "latin1")));
  const cases: [string, Buffer, string, string][] = [
    ["JPEG with EXIF/GPS/XMP/IPTC/comment/trailer", F.jpegWithEverything(6), "image/jpeg", "photo.jpg"],
    ["PNG with text/exif/time/private chunks", F.pngWithEverything(6), "image/png", "photo.png"],
    ["WebP with EXIF/XMP", F.webpWithEverything(6), "image/webp", "photo.webp"],
    ["GIF with comment/application extensions", F.gifFile({ extras: [F.gifComment(), F.gifXmp(), F.gifPlainText()] }), "image/gif", "photo.gif"],
  ];
  for (const [label, input, mime, name] of cases) {
    t(`fixture sanity (${label}): the upload really carries sentinel metadata`, hasSentinel(input));
    const expected = sanitizeImage(input, mime as any).bytes;
    const r = await M.upload(input, { name, type: mime });
    t(`sanitized upload accepted (${label})`, r.status === 201, `status ${r.status} ${r.text.slice(0, 120)}`);
    const url = await photoOf(mgrM.id);
    const id = url.split("/").pop()!;
    const row = await prisma.storedFile.findUnique({ where: { id } });
    const blob = row ? fs.readFileSync(path.join(storageDir, row.storageKey)) : Buffer.alloc(0);
    t(`stored blob equals the sanitized bytes and carries no sentinel (${label})`, blob.equals(expected) && !hasSentinel(blob) && blob.length < input.length);
    t(`StoredFile size/mime/sha256 describe the sanitized bytes, not the original (${label})`, !!row && row.sizeBytes === blob.length && row.mimeType === mime && row.sha256 === nodeCrypto.createHash("sha256").update(blob).digest("hex") && row.sha256 !== nodeCrypto.createHash("sha256").update(input).digest("hex"));
    t(`visibility/owner/entity are server-assigned (${label})`, !!row && row.visibility === "PUBLIC" && row.ownerId === mgr.id && row.entityType === "TEAM_MEMBER" && row.entityId === mgrM.id);
    const g = await new Browser().get(url);
    t(`a guest GET serves exactly the sanitized bytes, with no sentinel from a known metadata container (${label})`, g.status === 200 && g.buf.equals(expected) && !hasSentinel(g.buf) && g.headers.get("content-type")?.startsWith(mime) === true);
    const auditDump = JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: { in: [id, mgrM.id] } } }));
    t(`no sentinel reached the audit log (${label})`, !F.ALL_SENTINEL_STRINGS.some((s) => auditDump.includes(s)));
  }
  // orientation preserved through the real route
  {
    const r = await M.upload(F.jpegWithEverything(6), { name: "o.jpg", type: "image/jpeg" });
    const id = (await photoOf(mgrM.id)).split("/").pop()!;
    const served = (await new Browser().get(`/api/files/${id}`)).buf;
    t("JPEG orientation 6 survives as the only EXIF content (minimal block)", r.status === 201 && served.includes(Buffer.from("Exif\0\0", "latin1")) && served.indexOf(Buffer.from([0x01, 0x12])) > 0 && !hasSentinel(served));
  }
  // rejections: no change at all
  const rej: [string, Buffer, string, RegExp][] = [
    ["animated GIF", F.gifFile({ frames: 2 }), "image/gif", /still image/i],
    ["APNG", F.apngFile(), "image/png", /still image/i],
    ["JPEG with a duplicated orientation tag", F.jpegFile({ before: [F.jpegApp1Exif(F.exifTiff({ orientation: 6, duplicateOrientation: true }))] }), "image/jpeg", /rotation|orientation/i],
  ];
  const base = await counts();
  const baseBlobs = blobs();
  const basePhoto = await photoOf(mgrM.id);
  for (const [label, bytes, mime, re] of rej) {
    const r = await M.upload(bytes, { name: "x", type: mime });
    t(`rejected with a clear client-safe message: ${label}`, r.status === 400 && re.test(String(r.json?.error)), `status ${r.status} ${r.text.slice(0, 100)}`);
    t(`…no blob, row or photo change: ${label}`, JSON.stringify(await counts()) === JSON.stringify(base) && JSON.stringify(blobs()) === JSON.stringify(baseBlobs) && (await photoOf(mgrM.id)) === basePhoto);
  }
}

// ==================================================================================================================================
// 9c. Lifecycle through the EXISTING edit routes: replacing or clearing an uploaded photo retires exactly that member's file
{
  const J = { "Content-Type": "application/json" };
  const putProfile = (b: Browser, body: object) => b.req("PUT", "/api/profile", JSON.stringify(body), J);
  const putTeam = (b: Browser, id: string, body: object) => b.req("PUT", `/api/team/${id}`, JSON.stringify(body), J);
  const guest = () => new Browser();
  const idOf = (url: string) => url.split("/").pop()!;
  const rowOf = (id: string) => prisma.storedFile.findUnique({ where: { id } });
  const upload = async (b: Browser, shade: number) => {
    const r = await b.upload(png(60 + (shade % 9), 60, shade), { name: "x.png", type: "image/png" });
    if (r.status !== 201) throw new Error(`setup upload failed (${r.status})`);
    return r.json.photoUrl as string;
  };
  const retired = async (url: string) => {
    const row = await rowOf(idOf(url));
    return !!row && row.deletedAt !== null && !blobs().includes(row.storageKey) && (await guest().get(url)).status === 404;
  };
  const live = async (url: string) => {
    const row = await rowOf(idOf(url));
    return !!row && row.deletedAt === null && blobs().includes(row.storageKey) && (await guest().get(url)).status === 200;
  };
  const deletedAudits = () => prisma.auditLog.count({ where: { action: "FILE_DELETED" } });
  const EXT = "https://photos.example.org/bob-new.png";
  const bobTextBefore = await prisma.teamMember.findUnique({ where: { id: bobM.id }, select: { bio: true, role: true } });

  // text-only edits and rejected URL values never retire the photo
  let p = await upload(B, 0x51);
  t("a text-only PUT /api/profile keeps the uploaded photo live", (await putProfile(B, { bio: "text only" })).status === 200 && (await photoOf(bobM.id)) === p && (await live(p)));
  const rejectedSame = await putProfile(B, { photoUrl: p });
  t("sending the internal /api/files/ path back as photoUrl is refused (400) and changes nothing", rejectedSame.status === 400 && (await photoOf(bobM.id)) === p && (await live(p)));
  const mgrText = await putTeam(M, bobM.id, { role: "Senior Researcher" });
  t("a manager's text-only PUT /api/team/:id keeps the photo live", mgrText.status === 200 && (await photoOf(bobM.id)) === p && (await live(p)));

  // replacement by an external URL (owner)
  let d0 = await deletedAudits();
  const rep = await putProfile(B, { photoUrl: EXT });
  t("replacing the uploaded photo with an external URL succeeds", rep.status === 200 && (await photoOf(bobM.id)) === EXT);
  t("…the old uploaded file is retired (row soft-deleted, blob removed, normal endpoint answers 404)", await retired(p));
  t("…one FILE_DELETED audit row was written", (await deletedAudits()) === d0 + 1);

  // unchanged external URL: nothing is retired or audited
  const keepOther = await upload(A, 0x52); // alice's live photo must not be touched by bob's edits below
  aliceUrl = keepOther;
  d0 = await deletedAudits();
  const sameExt = await putProfile(B, { photoUrl: EXT, bio: "same url again" });
  t("re-submitting an unchanged external URL changes no file", sameExt.status === 200 && (await deletedAudits()) === d0 && (await live(keepOther)));

  // clearing (owner)
  p = await upload(B, 0x53);
  const clr = await putProfile(B, { photoUrl: "" });
  t("clearing the photo leaves the member with no photo", clr.status === 200 && (await photoOf(bobM.id)) === "" && clr.json?.photoUrl === "");
  t("…and the cleared file is no longer reachable through the file endpoint, even by its owner", (await retired(p)) && (await B.get(p)).status === 404);

  // manager replaces / clears
  p = await upload(B, 0x54);
  t("a manager clearing a member's photo retires that member's file", (await putTeam(M, bobM.id, { photoUrl: "" })).status === 200 && (await photoOf(bobM.id)) === "" && (await retired(p)));
  p = await upload(B, 0x55);
  t("a manager replacing it with an external URL retires that member's file", (await putTeam(M, bobM.id, { photoUrl: EXT })).status === 200 && (await retired(p)));
  t("…and alice's photo is untouched by all of bob's edits", await live(keepOther));

  // another member cannot edit bob's profile photo
  p = await upload(B, 0x56);
  const foreign = await putTeam(A, bobM.id, { photoUrl: "" });
  t("a different member cannot clear bob's photo (403) and nothing changes", foreign.status === 403 && (await photoOf(bobM.id)) === p && (await live(p)));

  // targeting someone else's file or a gallery file through a (planted) stale photoUrl: never retired
  for (const [label, victim] of [["another member's photo", aliceUrl] as const, ["a gallery file", `/api/files/${galleryFile.id}`] as const, ["a library file", `/api/files/${libFile.id}`] as const]) {
    await prisma.teamMember.update({ where: { id: bobM.id }, data: { photoUrl: victim } });
    const before = JSON.stringify(await rowOf(idOf(victim)));
    const viaOwner = await putProfile(B, { photoUrl: "" });
    await prisma.teamMember.update({ where: { id: bobM.id }, data: { photoUrl: victim } });
    const viaManager = await putTeam(M, bobM.id, { photoUrl: EXT });
    t(`a stale photoUrl pointing at ${label}: owner and manager edits succeed but that file is NOT retired`, viaOwner.status === 200 && viaManager.status === 200 && JSON.stringify(await rowOf(idOf(victim))) === before && (victim === aliceUrl ? (await live(victim)) : true));
  }
  t("…the gallery entry and blobs survive", !!(await prisma.galleryItem.findUnique({ where: { id: galleryItem.id } })) && blobs().includes(galleryKey) && blobs().includes(libKey));

  // database failure: nothing changes, the photo stays live
  let failOn2: { model: string; action: string } | null = null;
  (prisma as any).$use(async (params: any, next: any) => {
    if (failOn2 && params.model === failOn2.model && params.action === failOn2.action) {
      failOn2 = null;
      throw new Error("injected failure");
    }
    return next(params);
  });
  for (const [route, call] of [
    ["PUT /api/profile", (body: object) => putProfile(B, body)],
    ["PUT /api/team/:id (manager)", (body: object) => putTeam(M, bobM.id, body)],
  ] as const) {
    for (const spec of [{ model: "TeamMember", action: "update" }, { model: "StoredFile", action: "update" }, { model: "AuditLog", action: "create" }]) {
      p = await upload(B, 0x60 + (spec.action.length));
      const g = await counts();
      const bl = blobs();
      failOn2 = spec;
      const r = await call({ photoUrl: "" });
      failOn2 = null;
      t(`${route}: a failure in ${spec.model}.${spec.action} -> 5xx, nothing changes, the photo stays live and served`, r.status >= 500 && (await photoOf(bobM.id)) === p && (await live(p)) && JSON.stringify(await counts()) === JSON.stringify(g) && JSON.stringify(blobs()) === JSON.stringify(bl) && !/injected|Prisma|SQL|storageKey/i.test(r.text), `${r.status}`);
    }
  }

  // transient lock contention: 503 + Retry-After, nothing applied, nothing retried by the server, the photo stays live
  {
    const { Prisma } = await import("@prisma/client");
    let busyOn: string | null = null;
    let busyHits = 0;
    (prisma as any).$use(async (params: any, next: any) => {
      if (busyOn && params.model === busyOn && params.action === "updateMany") {
        busyOn = null;
        busyHits++;
        throw new Prisma.PrismaClientKnownRequestError("\nInvalid `prisma.teamMember.updateMany()` invocation:\n\nSQLITE_BUSY: database is locked", { code: "SQLITE_BUSY", clientVersion: "5.22.0" });
      }
      return next(params);
    });
    p = await upload(B, 0x66);
    const g = await counts();
    const audits = await prisma.auditLog.count();
    busyOn = "TeamMember";
    const r = await putProfile(B, { photoUrl: "" });
    t("lock contention on a profile save answers 503 with Retry-After and a client-safe message", r.status === 503 && r.headers.get("retry-after") === "1" && r.json?.error === "The service is busy. Please try again in a moment." && !/SQLITE|Prisma|locked/i.test(r.text), `${r.status} ${r.text.slice(0, 80)}`);
    t("…the contention was injected exactly once and the server did not retry the save", busyHits === 1);
    t("…nothing was applied: photo still live and served, rows and audit log unchanged", (await photoOf(bobM.id)) === p && (await live(p)) && JSON.stringify(await counts()) === JSON.stringify(g) && (await prisma.auditLog.count()) === audits);
    busyOn = "TeamMember";
    const rm = await putTeam(M, bobM.id, { photoUrl: "" });
    t("…and the same for a manager's team edit", rm.status === 503 && rm.headers.get("retry-after") === "1" && (await photoOf(bobM.id)) === p && (await live(p)));
    t("…a following ordinary request still succeeds (no residue)", (await putProfile(B, { photoUrl: "" })).status === 200 && (await photoOf(bobM.id)) === "");
  }

  // blob cleanup failure after a committed change: the request still succeeds, the row is retired, nothing sensitive is logged
  p = await upload(B, 0x70);
  const prow = (await rowOf(idOf(p)))!;
  const blobPath = path.join(storageDir, prow.storageKey);
  fs.unlinkSync(blobPath);
  fs.mkdirSync(blobPath); // unlink on a directory fails: the best-effort removal cannot succeed
  const logsBefore = logged.length;
  const cf = await putProfile(B, { photoUrl: "" });
  const after = await rowOf(prow.id);
  t("a blob that cannot be removed does not fail the request: the database state is consistent", cf.status === 200 && (await photoOf(bobM.id)) === "" && after?.deletedAt !== null);
  t("…the file endpoint already answers 404 although the blob is still on disk", (await guest().get(p)).status === 404 && fs.existsSync(blobPath));
  t("…the failure is logged without the storage key, a path or a driver message", logged.slice(logsBefore).every((l) => !l.includes(prow.storageKey) && !l.includes(storageDir)));
  fs.rmdirSync(blobPath);

  // generic deletion keeps photoUrl consistent and obeys ownership
  p = await upload(B, 0x71);
  t("another member cannot delete bob's photo through /api/files/:id (403)", (await A.req("DELETE", `/api/files/${idOf(p)}`)).status === 403 && (await live(p)));
  const del = await B.req("DELETE", `/api/files/${idOf(p)}`);
  t("the owner deleting the photo file clears the member's photoUrl in the same step (no dangling link)", del.status === 200 && (await photoOf(bobM.id)) === "" && (await retired(p)));
  p = await upload(B, 0x72);
  const mdel = await M.req("DELETE", `/api/files/${idOf(p)}`);
  t("a manager deleting it does the same", mdel.status === 200 && (await photoOf(bobM.id)) === "" && (await retired(p)));
  await prisma.teamMember.update({ where: { id: aliceM.id }, data: { photoUrl: aliceUrl } });
  const galDel = await A.req("DELETE", `/api/files/${galleryFile.id}`);
  t("a gallery file still cannot be deleted through the generic route (409) and nobody's photoUrl changes", galDel.status === 409 && (await photoOf(aliceM.id)) === aliceUrl && (await live(aliceUrl)));
  await prisma.teamMember.update({ where: { id: bobM.id }, data: bobTextBefore! }); // this section edited bob's text on purpose
  {
    // deleting a team member (admin) retires that member's uploaded photo; other members' and gallery files are untouched
    const tmp = await mkMember("Temp T", null);
    const tmpPhotoKey = await saveFile(png(61, 61, 0x33));
    const tmpFile = await prisma.storedFile.create({ data: { storageKey: tmpPhotoKey, originalName: "profile-photo.png", mimeType: "image/png", sizeBytes: 10, visibility: "PUBLIC", ownerId: mgr.id, entityType: "TEAM_MEMBER", entityId: tmp.id } });
    await prisma.teamMember.update({ where: { id: tmp.id }, data: { photoUrl: `/api/files/${tmpFile.id}` } });
    const adminU = await mkUser("admin-del@example.org", "ADMIN");
    const AD = new Browser();
    await AD.login("admin-del@example.org", PW);
    const keep = await live(aliceUrl);
    const del = await AD.req("DELETE", `/api/team/${tmp.id}`);
    const after = await rowOf(tmpFile.id);
    t("deleting a member retires that member's uploaded photo (row soft-deleted, blob removed, endpoint 404)", del.status === 200 && after?.deletedAt !== null && !blobs().includes(tmpPhotoKey) && (await guest().get(`/api/files/${tmpFile.id}`)).status === 404);
    t("…and another member's photo and the gallery file are untouched", keep && (await live(aliceUrl)) && blobs().includes(galleryKey));
    await prisma.user.delete({ where: { id: adminU.id } }).catch(() => {});
  }
  t("TEAM_MEMBER is in the shared FILE_ENTITY_TYPES allow-list, and the server's profile-photo type is a member of it", (await import("@scl/shared")).FILE_ENTITY_TYPES.includes(PROFILE_PHOTO_ENTITY_TYPE as any));
  {
    const fd = new FormData();
    fd.append("entityType", "TEAM_MEMBER");
    fd.append("entityId", bobM.id);
    fd.append("file", new Blob([png(64, 64)], { type: "image/png" }), "x.png");
    const gen = await A.req("POST", "/api/files", fd);
    const row = gen.json?.id ? await rowOf(gen.json.id) : null;
    t("the generic upload route still ignores a client-supplied entityType/entityId (file is standalone)", gen.status === 201 && !!row && row.entityType === null && row.entityId === null);
  }
  t("the cache header on a profile photo is private, no-store, so no cache is asked to keep it (copies already fetched are still outside the server's control)", /no-store/.test((await guest().get(aliceUrl)).headers.get("cache-control") ?? "") && !/max-age=3600/.test((await guest().get(aliceUrl)).headers.get("cache-control") ?? ""));
}

// ==================================================================================================================================
// 10. Existing data and the rest of the application are intact
{
  const after = JSON.parse(await snapshot());
  const was = JSON.parse(before);
  t("users (ids, emails, password hashes, roles) are exactly as before", JSON.stringify(after.users) === JSON.stringify(was.users));
  const untouched = (m: any) => ![aliceM.id, bobM.id, mgrM.id].includes(m.id);
  t("every team member other than alice, bob and the manager (the three who uploaded) is exactly as before, including Dana's external URL", after.members.filter(untouched).length === 1 && JSON.stringify(after.members.filter(untouched)) === JSON.stringify(was.members.filter(untouched)));
  t("alice's and bob's name, bio, role, department and links to accounts are unchanged", ["name", "bio", "role", "department", "userId", "category"].every((k) => after.members.filter((m: any) => [aliceM.id, bobM.id].includes(m.id)).every((m: any) => was.members.find((x: any) => x.id === m.id)[k] === m[k])));
  t("the gallery entry and its file row are untouched", JSON.stringify(after.gallery) === JSON.stringify(was.gallery) && JSON.stringify(after.unrelatedFiles) === JSON.stringify(was.unrelatedFiles));
  t("the gallery blob and the library blob are still on disk", blobs().includes(galleryKey) && blobs().includes(libKey));
  t("the gallery file is still served to a guest", (await new Browser().get(`/api/files/${galleryFile.id}`)).status === 200);
  t("password login still works after all of this (alice)", (await new Browser().login("alice@example.org", PW)).status === 200);
  t("a wrong password is still refused", (await new Browser().login("alice@example.org", "wrong-password-1")).status === 401);
  t("PUT /api/profile (own profile text edit) still works and keeps the uploaded photo", await (async () => {
    const r = await A.req("PUT", "/api/profile", JSON.stringify({ bio: "updated bio" }), { "Content-Type": "application/json" });
    return r.status === 200 && r.json?.bio === "updated bio" && r.json?.photoUrl === aliceUrl;
  })());
  t("GET /api/team still lists every member", ((await new Browser().get("/api/team")).json as any[]).length === 4);
  t("no request left the machine", offLoopback === 0);
  t("logs: no log line contains file bytes, a SHA-256, a storage key or a password", !logged.some((l) => /[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|Passw0rd/.test(l)), JSON.stringify(logged.filter((l) => /[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}|Passw0rd/.test(l)).slice(0, 3)));
}

server.close();
await prisma.$disconnect();
console.error = realError;
fs.rmSync(workDir, { recursive: true, force: true });
console.log(`${ok} profile-photo checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log(`Failures:\n${failures.map((f) => ` - ${f}`).join("\n")}`);
  process.exitCode = 1;
}
