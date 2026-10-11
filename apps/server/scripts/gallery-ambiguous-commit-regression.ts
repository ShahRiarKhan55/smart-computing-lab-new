/**
 * Regression for an AMBIGUOUS transaction failure on the gallery upload routes: the database transaction
 * COMMITS, but the caller is told it failed (what a remote database does when the reply to COMMIT is lost).
 * The uploaded blob must survive, the committed rows must stay consistent with it, and an idempotent retry
 * must return the existing result without creating anything or deleting the image.
 *
 * The failure is simulated IN-PROCESS: the real Express app is started on a loopback port and
 * `prisma.$transaction` is wrapped so that, when armed, it runs the real transaction to completion and then
 * throws. It runs against a LOCAL SQLite file and the LOCAL storage backend only. It does NOT exercise Turso
 * or Vercel Blob, and is not evidence of how a remote database behaves.
 *
 *   DATABASE_URL=file:/abs/path/to/COPY.db STORAGE_DIR=/abs/scratch/storage npx tsx scripts/gallery-ambiguous-commit-regression.ts
 *
 * Refuses to run against anything but a local `file:` database, with TURSO_* set, or with a STORAGE_DIR
 * inside the repository. Run it ONLY against a COPY of the database (it writes fixtures and removes them).
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const REPO = resolve(import.meta.dirname, "..", "..", "..");
const dbUrl = process.env.DATABASE_URL ?? "";
const storageDir = process.env.STORAGE_DIR ?? "";
if (!dbUrl.startsWith("file:")) throw new Error("Refusing to run: DATABASE_URL must be a local file: database copy.");
if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) throw new Error("Refusing to run: TURSO_* is set.");
if (process.env.BLOB_READ_WRITE_TOKEN || process.env.LAB_BLOB_READ_WRITE_TOKEN) throw new Error("Refusing to run: a Blob token is set.");
if (!storageDir || resolve(storageDir).startsWith(REPO)) throw new Error("Refusing to run: STORAGE_DIR must be set to a scratch directory outside the repository.");

const { prisma } = await import("../src/lib/prisma.ts");
const { createApp } = await import("../src/app.ts");

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) passed++;
  else {
    failures.push(`${name}${detail ? ` -- ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
};
const section = (t: string) => console.log(`\n# ${t}`);

// ---- fault injection: the transaction commits, then the caller is told it failed ------------------------
let armed = false;
const realTransaction = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
(prisma as unknown as { $transaction: unknown }).$transaction = async (...args: unknown[]) => {
  const result = await realTransaction(...args);
  if (armed) {
    armed = false;
    throw new Error("simulated: the commit was applied but its reply was lost");
  }
  return result;
};

const server = createApp().listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", () => r()));
const BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

let cookie = "";
async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@smartcomputinglab.org", password: "ChangeMe123!" }) });
  for (const c of res.headers.getSetCookie?.() ?? []) if (c.startsWith("scl.sid=")) cookie = c.split(";")[0];
  if (res.status !== 200 || !cookie) throw new Error(`login failed (${res.status}); is the database a seeded copy?`);
}
const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, n)]);
async function post(path: string, buffer: Buffer, fields: Record<string, string>, key?: string) {
  const form = new FormData();
  form.set("file", new Blob([buffer], { type: "image/jpeg" }), "ambig.jpg");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await fetch(`${BASE}/api${path}`, { method: "POST", headers: { cookie, ...(key ? { "Idempotency-Key": key } : {}) }, body: form });
  return { status: res.status, json: (await res.json().catch(() => null)) as any, replayed: res.headers.get("idempotent-replayed") === "true" };
}
const blobCount = () => {
  const walk = (d: string): number => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? walk(join(d, e.name)) : 1), 0);
  return existsSync(storageDir) ? walk(storageDir) : 0;
};
async function served(fileId: string) {
  const res = await fetch(`${BASE}/api/files/${fileId}`, { headers: { cookie } });
  return { status: res.status, length: res.status === 200 ? (await res.arrayBuffer()).byteLength : 0 };
}
const TAG = "ZZ Ambiguous";
async function cleanup() {
  const items = await prisma.galleryItem.findMany({ where: { caption: { startsWith: TAG } }, include: { images: true } });
  const fileIds = items.flatMap((i) => [i.fileId, ...i.images.map((im) => im.fileId)]);
  await prisma.galleryUploadAttempt.deleteMany({ where: { itemId: { in: items.map((i) => i.id) } } });
  await prisma.galleryItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
  await prisma.storedFile.deleteMany({ where: { id: { in: fileIds } } });
}

try {
  await cleanup();
  await login();

  // ------------------------------------------------------------------------------------------------
  section("CREATE: the transaction commits, then reports an error");
  const k1 = randomUUID();
  const CAP1 = `${TAG} create`;
  const bytes1 = jpeg(0x31);
  const blobs0 = blobCount();
  armed = true;
  const r1 = await post("/gallery", bytes1, { caption: CAP1 }, k1);
  check("(setup) the caller is told the request failed (500), as a lost COMMIT reply would", r1.status === 500, `got ${r1.status}`);
  const item1 = await prisma.galleryItem.findFirst({ where: { caption: CAP1 }, include: { file: true } });
  check("the entry WAS committed: one entry, one StoredFile, one attempt row", !!item1 && (await prisma.galleryItem.count({ where: { caption: CAP1 } })) === 1 && (await prisma.galleryUploadAttempt.count({ where: { key: k1 } })) === 1);
  check("the blob was KEPT (one new blob in storage)", blobCount() === blobs0 + 1, `before ${blobs0}, after ${blobCount()}`);
  const s1 = item1 ? await served(item1.fileId) : { status: 0, length: 0 };
  check("the committed image is served intact (200, original bytes) - no broken image", s1.status === 200 && s1.length === bytes1.length, `${s1.status}/${s1.length}`);
  const retry1 = await post("/gallery", bytes1, { caption: CAP1 }, k1);
  check("retrying with the same key returns the EXISTING entry (201, replay)", retry1.status === 201 && retry1.replayed === true && retry1.json?.id === item1?.id, `${retry1.status} ${retry1.replayed}`);
  check("... no second entry, StoredFile, attempt row or blob", (await prisma.galleryItem.count({ where: { caption: CAP1 } })) === 1 && (await prisma.galleryUploadAttempt.count({ where: { key: k1 } })) === 1 && blobCount() === blobs0 + 1);
  const s1b = item1 ? await served(item1.fileId) : { status: 0, length: 0 };
  check("... and the image is still served after the retry", s1b.status === 200 && s1b.length === bytes1.length);

  // ------------------------------------------------------------------------------------------------
  section("APPEND: the transaction commits, then reports an error");
  const k2 = randomUUID();
  const bytes2 = jpeg(0x32);
  const blobs1 = blobCount();
  armed = true;
  const r2 = await post(`/gallery/${item1!.id}/images`, bytes2, {}, k2);
  check("(setup) the caller is told the request failed (500)", r2.status === 500, `got ${r2.status}`);
  const extra = await prisma.galleryImage.findMany({ where: { itemId: item1!.id }, include: { file: true } });
  check("the image WAS committed: one GalleryImage, one attempt row", extra.length === 1 && (await prisma.galleryUploadAttempt.count({ where: { key: k2 } })) === 1);
  check("the blob was KEPT (one new blob in storage)", blobCount() === blobs1 + 1, `before ${blobs1}, after ${blobCount()}`);
  const s2 = extra[0] ? await served(extra[0].fileId) : { status: 0, length: 0 };
  check("the committed image is served intact (200, original bytes)", s2.status === 200 && s2.length === bytes2.length, `${s2.status}/${s2.length}`);
  const retry2 = await post(`/gallery/${item1!.id}/images`, bytes2, {}, k2);
  check("retrying with the same key returns the existing entry (201, replay) holding cover + 1 image", retry2.status === 201 && retry2.replayed === true && retry2.json?.id === item1!.id && retry2.json.images.length === 2);
  check("... no second GalleryImage, StoredFile, attempt row or blob", (await prisma.galleryImage.count({ where: { itemId: item1!.id } })) === 1 && (await prisma.galleryUploadAttempt.count({ where: { key: k2 } })) === 1 && blobCount() === blobs1 + 1);
  const s2b = extra[0] ? await served(extra[0].fileId) : { status: 0, length: 0 };
  check("... and the image is still served after the retry", s2b.status === 200 && s2b.length === bytes2.length);

  // ------------------------------------------------------------------------------------------------
  section("WITHOUT a key: still never deletes a committed image");
  const CAP3 = `${TAG} unkeyed`;
  const blobs2 = blobCount();
  armed = true;
  const r3 = await post("/gallery", jpeg(0x33), { caption: CAP3 });
  const item3 = await prisma.galleryItem.findFirst({ where: { caption: CAP3 } });
  check("an unkeyed request whose commit reply is lost: entry committed, blob kept, image served", r3.status === 500 && !!item3 && blobCount() === blobs2 + 1 && (await served(item3.fileId)).status === 200);

  // ------------------------------------------------------------------------------------------------
  section("KNOWN rollbacks still remove the blob (no commit was ever sent)");
  const blobs3 = blobCount();
  const files3 = await prisma.storedFile.count();
  const bad = await post("/gallery", jpeg(0x34), { caption: `${TAG} badproject`, projectId: "cmnotaproject0000000000000" }, randomUUID());
  check("create refused INSIDE the transaction (unknown project) -> 400", bad.status === 400, `got ${bad.status}`);
  check("... its blob was removed and nothing was stored", blobCount() === blobs3 && (await prisma.storedFile.count()) === files3);
  for (let i = 0; i < 8; i++) await post(`/gallery/${item1!.id}/images`, jpeg(0x40 + i), {}, randomUUID()); // cover + 9 = 10
  check("(setup) the entry is full (10 images)", (await prisma.galleryImage.count({ where: { itemId: item1!.id } })) === 9);
  const blobs4 = blobCount();
  const files4 = await prisma.storedFile.count();
  const over = await post(`/gallery/${item1!.id}/images`, jpeg(0x60), {}, randomUUID());
  check("append refused by the cap INSIDE the transaction -> 409", over.status === 409);
  check("... its blob was removed and nothing was stored", blobCount() === blobs4 && (await prisma.storedFile.count()) === files4);
  const dupKey = randomUUID();
  const winner = await post("/gallery", jpeg(0x70), { caption: `${TAG} dup` }, dupKey);
  const blobs5 = blobCount();
  const replayOther = await Promise.all([1, 2, 3].map(() => post("/gallery", jpeg(0x70), { caption: `${TAG} dup` }, dupKey)));
  check("duplicates of a completed attempt are answered from the original and leave no extra blob", winner.status === 201 && replayOther.every((r) => r.status === 201 && r.json?.id === winner.json.id) && blobCount() === blobs5);
} finally {
  await cleanup().catch((e) => console.log("cleanup failed:", e instanceof Error ? e.message : e));
  server.close();
  await prisma.$disconnect();
}

console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exitCode = 1;
}
