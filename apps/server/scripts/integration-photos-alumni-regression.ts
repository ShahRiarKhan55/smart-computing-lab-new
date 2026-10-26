/**
 * Integration regression of Phase 3A (profile photos) with Phase 3B (alumni publication consent), through the REAL application
 * (createApp), real logins and multipart uploads, on a brand-new SQLite file built from the repository's migrations in a temp
 * directory. It never reads TURSO_* / DATABASE_URL (it refuses to run if TURSO_* is set), uses no hosted database and opens no
 * non-loopback connection.
 *
 * Deterministic "this UPDATE does not name the column" proof: SQLite fires `AFTER UPDATE OF col` only when the statement's SET list
 * names `col` (even if the value is unchanged), so triggers installed in the disposable database record any write of `photoUrl`
 * or `isPublished`. That is stronger than comparing values, and it does not depend on a race. It does NOT interleave two requests
 * (one process, serialised transactions); see docs/architecture/phase3b-alumni-directory.md.
 *   npx tsx scripts/integration-photos-alumni-regression.ts   (or: npm run test:integration-photos-alumni -w apps/server)
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
const admin = await mkUser("admin@example.org", "ADMIN");
const mgr = await mkUser("manager@example.org", "LAB_MANAGER");
const alice = await mkUser("alice@example.org");
const bob = await mkUser("bob@example.org");
const eve = await mkUser("eve@example.org");
const mkMember = (name: string, userId: string | null, category = "MSC") => prisma.teamMember.create({ data: { name, initials: name.slice(0, 2).toUpperCase(), role: "Researcher", category, userId, photoUrl: "", department: "D", bio: "B" } });
const adminM = await mkMember("Admin A", admin.id, "FACULTY");
const mgrM = await mkMember("Manager M", mgr.id, "FACULTY");
const aliceM = await mkMember("Alice A", alice.id);
const bobM = await mkMember("Bob B", bob.id);
const eveM = await mkMember("Eve E", eve.id);
void adminM; void mgrM; void eveM;

// Triggers record every UPDATE whose SET list NAMES photoUrl / isPublished / updatedAt (see the header).
await prisma.$executeRawUnsafe(`CREATE TABLE "ProbeLog" ("n" INTEGER PRIMARY KEY AUTOINCREMENT, "col" TEXT NOT NULL, "memberId" TEXT NOT NULL)`);
for (const col of ["photoUrl", "isPublished", "updatedAt"]) {
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "probe_${col}" AFTER UPDATE OF "${col}" ON "TeamMember" BEGIN INSERT INTO "ProbeLog" ("col","memberId") VALUES ('${col}', NEW."id"); END`);
}
const probe = async (memberId: string) => (await prisma.$queryRawUnsafe<{ col: string }[]>(`SELECT "col" FROM "ProbeLog" WHERE "memberId" = '${memberId}' ORDER BY "n"`)).map((r) => r.col);
const probeClear = () => prisma.$executeRawUnsafe(`DELETE FROM "ProbeLog"`);

const blobs = () => fs.readdirSync(storageDir).sort();
const memberRow = (id: string) => prisma.teamMember.findUniqueOrThrow({ where: { id } });
const fileIdOf = (url: string) => url.split("/").pop()!;
const G = new Browser();
const [AD, MG, AL, BO, EV] = [new Browser(), new Browser(), new Browser(), new Browser(), new Browser()];
t("setup: every account can sign in", (await AD.login("admin@example.org", PW)).status === 200 && (await MG.login("manager@example.org", PW)).status === 200 && (await AL.login("alice@example.org", PW)).status === 200 && (await BO.login("bob@example.org", PW)).status === 200 && (await EV.login("eve@example.org", PW)).status === 200);
const json = { "Content-Type": "application/json" };
const put = (b: Browser, p: string, body: unknown) => b.req("PUT", p, JSON.stringify(body), json);
const del = (b: Browser, p: string) => b.req("DELETE", p);
const cc = (r: { headers: Headers }) => r.headers.get("cache-control") ?? "";

// =================================================================================================================================
// 1. A member uploads a photo; while the profile is published it is served, but never from a cache
const up1 = await AL.upload(png(64, 64, 0x20), { name: "a.png", type: "image/png" });
t("alice uploads a profile photo (201)", up1.status === 201 && String(up1.json?.photoUrl).startsWith("/api/files/"));
const urlA = (await memberRow(aliceM.id)).photoUrl;
const idA = fileIdOf(urlA);
const keyA = (await prisma.storedFile.findUniqueOrThrow({ where: { id: idA } })).storageKey;
for (const [label, b] of [["guest", G], ["member", EV], ["manager", MG], ["admin", AD], ["the owner", AL]] as const) {
  const r = await b.get(urlA);
  t(`published profile: ${label} gets the photo (200)`, r.status === 200);
  t(`published profile: ${label} response is Cache-Control: private, no-store`, /private/.test(cc(r)) && /no-store/.test(cc(r)) && !/public/.test(cc(r)), cc(r));
  t(`published profile: ${label} response varies on Cookie`, /cookie/i.test(r.headers.get("vary") ?? ""));
}
// an ordinary PUBLIC library/gallery file keeps its existing cache policy (nothing else changed)
const libBytes = png(20, 20, 0x10);
const libKey = await saveFile(libBytes);
const libFile = await prisma.storedFile.create({ data: { storageKey: libKey, originalName: "g.png", mimeType: "image/png", sizeBytes: libBytes.length, visibility: "PUBLIC", ownerId: alice.id } });
t("a PUBLIC non-photo file keeps Cache-Control: public, max-age=3600 (unchanged behaviour)", /public/.test(cc(await G.get(`/api/files/${libFile.id}`))) && /max-age=3600/.test(cc(await G.get(`/api/files/${libFile.id}`))));

// =================================================================================================================================
// 2. The profile becomes an unpublished alumni entry: its photo is no longer retrievable
t("admin unlinks alice's account from her profile", (await put(AD, `/api/users/${alice.id}/link`, { teamMemberId: null })).status === 200);
await probeClear();
const toAlumni = await put(AD, `/api/team/${aliceM.id}`, { category: "ALUMNI" });
t("admin moves the (now unlinked) profile to ALUMNI: unpublished", toAlumni.status === 200 && toAlumni.json?.isPublished === false);
t("the move wrote isPublished once, never photoUrl", JSON.stringify((await probe(aliceM.id)).filter((c) => c !== "updatedAt")) === JSON.stringify(["isPublished"]), JSON.stringify(await probe(aliceM.id)));
t("the photo URL on the profile is untouched by the category change", (await memberRow(aliceM.id)).photoUrl === urlA);
for (const [label, b] of [["guest", G], ["ordinary member", EV], ["lab manager", MG], ["the former owner (still signed in)", AL]] as const) {
  const r = await b.get(urlA);
  t(`unpublished: ${label} cannot retrieve the photo (404, same as a missing file)`, r.status === 404);
  t(`unpublished: ${label} 404 is not cacheable`, /no-store/.test(cc(r)), cc(r));
}
t("unpublished: the 404 body equals the body for a file that does not exist", (await G.get(urlA)).text === (await G.get("/api/files/cjld2cjxh0000qzrmn831i7rn")).text);
// generic file deletion while the profile is hidden
{
  const own = await del(AL, urlA);
  t("unpublished: the former owner deleting their own photo file gets 404 (the profile is hidden from them)", own.status === 404);
  const anon = await del(G, urlA);
  t("an unauthenticated generic file delete gets 401", anon.status === 401);
  t("...neither attempt changed anything: file still live, profile still points at it, blob present", (await prisma.storedFile.findUniqueOrThrow({ where: { id: idA } })).deletedAt === null && (await memberRow(aliceM.id)).photoUrl === urlA && blobs().includes(keyA));
}
// cache headers on a missing id and on a hidden photo: same policy, the response may vary by who asks
{
  const missing = await G.get("/api/files/cjld2cjxh0000qzrmn831i7rn");
  t("a nonexistent file id answers 404 with Cache-Control: no-store", missing.status === 404 && /no-store/.test(cc(missing)), cc(missing));
  t("...and with Vary: Cookie (the file route's answer depends on the viewer)", /cookie/i.test(missing.headers.get("vary") ?? ""));
  const hidden = await G.get(urlA);
  t("a hidden photo's 404 has the same headers as a missing id (no-store, Vary: Cookie)", hidden.status === 404 && /no-store/.test(cc(hidden)) && /cookie/i.test(hidden.headers.get("vary") ?? "") && cc(hidden) === cc(missing) && hidden.headers.get("vary") === missing.headers.get("vary"));
  t("a signed-in viewer's nonexistent-id 404 is also no-store with Vary: Cookie", await (async () => { const r = await EV.get("/api/files/cjld2cjxh0000qzrmn831i7rn"); return r.status === 404 && /no-store/.test(cc(r)) && /cookie/i.test(r.headers.get("vary") ?? ""); })());
}
const adm = await AD.get(urlA);
t("unpublished: an administrator can still retrieve it, with no-store", adm.status === 200 && /no-store/.test(cc(adm)));
t("unpublished: the profile itself is also hidden from a visitor (404)", (await G.get(`/api/member/${aliceM.id}`)).status === 404);

// hidden-profile writes: refused without touching updatedAt
{
  const before = (await memberRow(aliceM.id)).updatedAt.getTime();
  await probeClear();
  await new Promise((r) => setTimeout(r, 25));
  const m1 = await put(MG, `/api/team/${aliceM.id}`, { bio: "x" });
  t("a lab manager editing a HIDDEN alumni profile gets 404", m1.status === 404);
  t("...and the hidden profile's updatedAt was neither written nor changed", (await probe(aliceM.id)).length === 0 && (await memberRow(aliceM.id)).updatedAt.getTime() === before);
}

// Lock scoping, observed WITHOUT relying on rollback. A refused request rolls its transaction back, so probe rows written inside it vanish
// and prove nothing. Instead a BEFORE UPDATE trigger makes any statement that sets `updatedAt` on one specific profile ABORT. If the
// first (lock) statement of PUT /api/team/:id matched that profile, the request would fail with a database error (a database error rather than 404/403); with the
// lock scoped to profiles the requester may see and manage, the statement never touches the row and the normal 404 / 403 comes back.
const lockGuard = async (memberId: string, run: () => Promise<void>) => {
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "lockscope_guard" BEFORE UPDATE OF "updatedAt" ON "TeamMember" WHEN NEW."id" = '${memberId}' BEGIN SELECT RAISE(ABORT, 'lock statement touched a profile the requester may not manage'); END`);
  try {
    await run();
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "lockscope_guard"`);
  }
};
await lockGuard(aliceM.id, async () => {
  const control = await put(AD, `/api/team/${aliceM.id}`, { bio: "control" });
  // The aborting trigger surfaces as a database error (the app maps it to 400 or 500 depending on the driver's error code); anything other
  // than a success, 403 or 404 means the statement reached the row, which is all this control needs to show.
  t("lock-scope control: with the guard trigger in place an ADMIN edit of that profile fails with a database error (the lock does touch a manageable profile), so the guard is live", ![200, 403, 404].includes(control.status), `status ${control.status} ${JSON.stringify(control.json)}`);
  const hiddenEdit = await put(MG, `/api/team/${aliceM.id}`, { bio: "x" });
  t("lock scope: a manager's edit of a HIDDEN profile is a clean 404, so the lock statement never touched the row", hiddenEdit.status === 404, String(hiddenEdit.status));
});

// The visibility part of the lock `WHERE` is separate from the alumni part: every unpublished profile is an alumnus (the API never
// unpublishes anyone else), so the alumni exclusion alone would mask a missing visibility filter. A non-alumni row unpublished
// out-of-band (repair or import) isolates it.
{
  const odd = await mkMember("Odd Unpublished", null, "MSC");
  await prisma.teamMember.update({ where: { id: odd.id }, data: { isPublished: false } });
  await lockGuard(odd.id, async () => {
    const r = await put(MG, `/api/team/${odd.id}`, { bio: "x" });
    t("lock scope: a manager's edit of an out-of-band UNPUBLISHED non-alumni profile is a clean 404 (visibility part of the lock WHERE)", r.status === 404, String(r.status));
  });
  t("...that profile's guest-facing read is 404 too", (await G.get(`/api/team/${odd.id}`)).status === 404);
  await prisma.teamMember.delete({ where: { id: odd.id } });
}

// =================================================================================================================================
// 3. Publishing and unpublishing: visible only while published, on the very next request
t("admin publishes the alumna", (await put(AD, `/api/team/${aliceM.id}/publication`, { isPublished: true })).status === 200);
for (const [label, b] of [["guest", G], ["ordinary member", EV], ["lab manager", MG], ["the owner who uploaded it (profile since unlinked and converted to Alumni)", AL]] as const) {
  const r = await b.get(urlA);
  t(`published alumna: ${label} gets the photo, no-store`, r.status === 200 && /no-store/.test(cc(r)) && !/public/.test(cc(r)));
}
{
  const before = (await memberRow(aliceM.id)).updatedAt.getTime();
  await probeClear();
  const m2 = await put(MG, `/api/team/${aliceM.id}`, { bio: "x" });
  t("a lab manager editing a PUBLISHED alumni profile gets 403 (admin only)", m2.status === 403);
  await lockGuard(aliceM.id, async () => {
  const published = await put(MG, `/api/team/${aliceM.id}`, { bio: "x" });
  t("lock scope: a manager's edit of a PUBLISHED alumni profile is a clean 403, so the lock statement never touched the row", published.status === 403, String(published.status));
});
t("...and nothing was written for them (no probe rows, updatedAt unchanged)", (await probe(aliceM.id)).length === 0 && (await memberRow(aliceM.id)).updatedAt.getTime() === before);
}
t("admin unpublishes the alumna", (await put(AD, `/api/team/${aliceM.id}/publication`, { isPublished: false })).status === 200);
t("unpublished again: the very next guest request for the photo is 404", (await G.get(urlA)).status === 404);
t("alumni cannot upload photos (no account): the former owner's upload is refused (404, no profile linked)", (await AL.upload(png(64, 64), { name: "x.png", type: "image/png" })).status === 404);

// =================================================================================================================================
// 4. Ordinary edits do not write publication state or photo; transitions still behave
await probeClear();
t("admin edits the unpublished alumna's text", (await put(AD, `/api/team/${aliceM.id}`, { role: "Alumna", bio: "new bio" })).status === 200);
t("an ordinary edit (same category) names neither isPublished nor photoUrl in its UPDATE (D1 + stale photo)", (await probe(aliceM.id)).every((c) => c === "updatedAt"), JSON.stringify(await probe(aliceM.id)));
await probeClear();
t("saving ALUMNI -> ALUMNI is not a transition: still no isPublished write", (await put(AD, `/api/team/${aliceM.id}`, { category: "ALUMNI", role: "Alumna 2" })).status === 200 && (await probe(aliceM.id)).every((c) => c === "updatedAt"));
await probeClear();
const back = await put(AD, `/api/team/${aliceM.id}`, { category: "PHD" });
t("leaving ALUMNI publishes (a current member again)", back.status === 200 && back.json?.isPublished === true && (await probe(aliceM.id)).includes("isPublished") && !(await probe(aliceM.id)).includes("photoUrl"));
t("...and the photo is retrievable again (published profile)", (await G.get(urlA)).status === 200);
await probeClear();
t("a text-only edit of a published member writes no photoUrl and no isPublished", (await put(AD, `/api/team/${aliceM.id}`, { role: "Researcher" })).status === 200 && (await probe(aliceM.id)).every((c) => c === "updatedAt"));
// the photo is cleared ONLY when the request names photoUrl
await probeClear();
t("a request that names photoUrl is the only one that writes it", (await put(AD, `/api/team/${aliceM.id}`, { photoUrl: "" })).status === 200 && (await probe(aliceM.id)).includes("photoUrl"));
t("...clearing it retired the uploaded file in the same request (404) and removed its blob after commit", (await G.get(urlA)).status === 404 && !blobs().includes(keyA) && (await prisma.storedFile.findUniqueOrThrow({ where: { id: idA } })).deletedAt !== null);

// =================================================================================================================================
// 5. A category change cannot resurrect a retired photo, and a refused change leaves photo and blob alone (rollback consistency)
const u1 = await BO.upload(png(64, 64, 0x30), { name: "b1.png", type: "image/png" });
const urlB1 = (await memberRow(bobM.id)).photoUrl;
const keyB1 = (await prisma.storedFile.findUniqueOrThrow({ where: { id: fileIdOf(urlB1) } })).storageKey;
const u2 = await BO.upload(png(64, 64, 0x40), { name: "b2.png", type: "image/png" });
const urlB2 = (await memberRow(bobM.id)).photoUrl;
const keyB2 = (await prisma.storedFile.findUniqueOrThrow({ where: { id: fileIdOf(urlB2) } })).storageKey;
t("bob replaces his photo: the first file is retired (404) and its blob removed, the second is live", u1.status === 201 && u2.status === 201 && urlB1 !== urlB2 && (await G.get(urlB1)).status === 404 && (await G.get(urlB2)).status === 200 && !blobs().includes(keyB1) && blobs().includes(keyB2));
const refused = await put(AD, `/api/team/${bobM.id}`, { category: "ALUMNI", bio: "should not persist" });
t("moving a profile WITH an account to ALUMNI is refused (409)", refused.status === 409);
t("...the refused request rolled back everything: category, bio, photo URL, live file and blob", (await memberRow(bobM.id)).category === "MSC" && (await memberRow(bobM.id)).bio === "B" && (await memberRow(bobM.id)).photoUrl === urlB2 && (await G.get(urlB2)).status === 200 && blobs().includes(keyB2));
t("bob unlinked (admin)", (await put(AD, `/api/users/${bob.id}/link`, { teamMemberId: null })).status === 200);
await probeClear();
const viaUpdateMany = await put(AD, `/api/team/${bobM.id}`, { category: "ALUMNI" });
t("entering ALUMNI (the conditional updateMany branch) succeeds", viaUpdateMany.status === 200 && viaUpdateMany.json?.isPublished === false);
t("...it did NOT name photoUrl (so a stale photo cannot be written back), only isPublished", (await probe(bobM.id)).includes("isPublished") && !(await probe(bobM.id)).includes("photoUrl"), JSON.stringify(await probe(bobM.id)));
t("...the retired first photo is still retired and the current one untouched", (await memberRow(bobM.id)).photoUrl === urlB2 && (await G.get(urlB1)).status === 404 && (await AD.get(urlB2)).status === 200 && (await G.get(urlB2)).status === 404);

// =================================================================================================================================
// 6. Generic file deletion cannot bypass the alumni rules
t("admin publishes bob (alumnus)", (await put(AD, `/api/team/${bobM.id}/publication`, { isPublished: true })).status === 200);
{
  const r = await del(MG, urlB2);
  t("a lab manager cannot delete a PUBLISHED alumnus's photo file through the generic route (403)", r.status === 403);
  t("...the file is still live, the profile still points at it, the blob is still there", (await memberRow(bobM.id)).photoUrl === urlB2 && (await prisma.storedFile.findUniqueOrThrow({ where: { id: fileIdOf(urlB2) } })).deletedAt === null && blobs().includes(keyB2));
}
t("admin unpublishes bob", (await put(AD, `/api/team/${bobM.id}/publication`, { isPublished: false })).status === 200);
t("a lab manager gets 404 for the photo file of an UNPUBLISHED profile (looks missing)", (await del(MG, urlB2)).status === 404 && (await memberRow(bobM.id)).photoUrl === urlB2);
{
  const r = await del(AD, urlB2);
  t("an administrator can delete it (200)", r.status === 200);
  t("...the profile's photoUrl was cleared and the blob removed after commit", (await memberRow(bobM.id)).photoUrl === "" && !blobs().includes(keyB2));
}
// regression: the manager keeps the existing ability for an ordinary (non-alumni) member's photo
const e1 = await EV.upload(png(64, 64, 0x50), { name: "e.png", type: "image/png" });
const urlE = (await memberRow(eveM.id)).photoUrl;
t("a lab manager can still delete an ordinary member's photo file (200), clearing the profile's photoUrl", e1.status === 201 && (await del(MG, urlE)).status === 200 && (await memberRow(eveM.id)).photoUrl === "");

// =================================================================================================================================
// 7. Deleting a profile retires its photo; the account/privacy invariants of Phase 3B still hold next to the photo code
const e2 = await EV.upload(png(64, 64, 0x60), { name: "e2.png", type: "image/png" });
const urlE2 = (await memberRow(eveM.id)).photoUrl;
const keyE2 = (await prisma.storedFile.findUniqueOrThrow({ where: { id: fileIdOf(urlE2) } })).storageKey;
t("admin deletes eve's profile: photo retired (404) and blob removed", e2.status === 201 && (await del(AD, `/api/team/${eveM.id}`)).status === 200 && (await G.get(urlE2)).status === 404 && !blobs().includes(keyE2));
t("the public roster never lists alumni and never exposes the publication flag to non-admins", !(await G.get("/api/team")).text.includes("isPublished") && !(await G.get("/api/team")).text.includes("Bob B"));
t("sending isPublished on a team update is still refused (400)", (await put(AD, `/api/team/${bobM.id}`, { isPublished: true })).status === 400);
t("sending isPublished on the own-profile update is still refused (400)", (await put(EV, "/api/profile", { bio: "x", isPublished: true })).status === 400 || (await put(EV, "/api/profile", { bio: "x", isPublished: true })).status === 404);

t("no request left the loopback interface", offLoopback === 0);
t("the run logged no storage keys or file bytes", !logged.some((l) => l.includes(keyA) || l.includes(keyB1) || l.includes(keyB2)));
server.close();
fs.rmSync(workDir, { recursive: true, force: true });
console.log(`${ok} integration (photos + alumni) checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
process.exit(0);
