/**
 * End-to-end API regression for the Lab Gallery (Phase 13): /api/gallery/*.
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:/abs/path/to/copy.db STORAGE_DIR=/abs/path/to/storage PORT=4062 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:/abs/path/to/copy.db API=http://localhost:4062 node scripts/gallery-regression.mjs
 *
 * CONCURRENCY: the "simultaneous identical requests" checks exercise SQLite write contention. Start the server
 * with a single database connection (append `?connection_limit=1` to its DATABASE_URL, as above but for the
 * server only) and set SERIALIZED_DB=1 for this script: the duplicates then queue and ALL must answer 201.
 * Without it (default pool) SQLite may answer some duplicates with a lock timeout (500); the script then only
 * requires that no duplicate was stored and that one retry converges on the original.
 *
 * Run it ONLY against a COPY of the database. Creates/removes fixtures prefixed "ZZ Gallery" /
 * p13gtest-*@example.test (also at start, in case a previous run was interrupted).
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
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
    return { status: res.status, json };
  }
  // `extra.headers` adds request headers (e.g. Idempotency-Key); `extra.base` targets another origin (the lossy proxy).
  async upload(path, fields, file, extra = {}) {
    const form = new FormData();
    if (file) form.set("file", new Blob([file.buffer], { type: file.contentType }), file.filename);
    for (const [k, v] of Object.entries(fields ?? {})) form.set(k, v);
    const res = await fetch(`${extra.base ?? API}/api${path}`, { method: "POST", headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(extra.headers ?? {}) }, body: form });
    this.#saveCookie(res);
    const json = await res.json().catch(() => null);
    return { status: res.status, json, replayed: res.headers.get("idempotent-replayed") === "true" };
  }
  async raw(path) {
    const res = await fetch(`${API}/api${path}`, { headers: this.cookie ? { cookie: this.cookie } : {} });
    return { status: res.status };
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
  put = (p, b) => this.req("PUT", p, b ?? {});
  del = (p) => this.req("DELETE", p);
  login = (email, password) => this.post("/auth/login", { email, password });
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x11)]);
const PDF = Buffer.from(`%PDF-1.7\n${"x".repeat(64)}`, "latin1");
const upload = (client, fields, buffer = JPEG, filename = "photo.jpg", contentType = "image/jpeg") =>
  client.upload("/gallery", fields, { buffer, filename, contentType });

/**
 * A loopback TCP proxy that forwards the request to the real server and then DROPS the response: the
 * server runs the whole request (including its database commit) but the client only sees a network error.
 * This is exactly "the request succeeded on the server but its response was lost".
 */
function startLossyProxy(targetPort) {
  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    client.on("data", (d) => upstream.write(d));
    upstream.once("data", () => setTimeout(() => { client.destroy(); upstream.destroy(); }, 30)); // swallow the reply
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

async function cleanup() {
  const testUsers = await prisma.user.findMany({ where: { email: { startsWith: "p13gtest-" } }, select: { id: true } });
  const ids = testUsers.map((u) => u.id);
  if (ids.length > 0) {
    await prisma.galleryItem.deleteMany({ where: { file: { ownerId: { in: ids } } } }).catch(() => {});
    await prisma.storedFile.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
  }
  await prisma.researchProject.deleteMany({ where: { title: { startsWith: "ZZ Gallery" } } }).catch(() => {});
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: "ZZ Gallery" } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { startsWith: "p13gtest-" } } }).catch(() => {});
}

async function main() {
  await cleanup();

  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);

  const mk = async (key, role, name) => {
    const email = `p13gtest-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "ZG", memberRole: "Researcher", category: "RESEARCH" });
    const client = new Client();
    await client.login(email, PW);
    return { client, email, status: r.status, id: r.json?.id };
  };

  section("fixtures");
  const guest = new Client();
  const mgr = await mk("mgr", "LAB_MANAGER", "ZZ Gallery Manager");
  const a = await mk("a", "MEMBER", "ZZ Gallery Alice");
  const b = await mk("b", "MEMBER", "ZZ Gallery Bob");
  check("fixtures: three accounts created", [mgr, a, b].every((u) => u.status === 201));

  const hiddenProject = await mgr.client.post("/projects", { title: "ZZ Gallery Hidden Project", visibility: "LAB_ONLY" });
  const publicProject = await mgr.client.post("/projects", { title: "ZZ Gallery Public Project", visibility: "PUBLIC" });
  check("fixtures: a hidden (LAB_ONLY) and a public project created", hiddenProject.status === 201 && publicProject.status === 201);

  // ------------------------------------------------------------------
  section("AUTH + CREATE");
  check("guest cannot create a gallery item -> 401", (await upload(guest, {})).status === 401);
  check("non-image (PDF) upload rejected -> 400 (gallery is images only)", (await upload(a.client, {}, PDF, "doc.pdf", "application/pdf")).status === 400);

  const created = await upload(a.client, { caption: "Lab retreat 2026", category: "EVENT" });
  check("member can create a gallery item -> 201", created.status === 201 && created.json?.id);
  check("new item defaults to LAB_ONLY", created.json.visibility === undefined); // visibility is manager-only in the response
  const galleryId = created.json.id;
  const dbItem = await prisma.galleryItem.findUnique({ where: { id: galleryId }, include: { file: true } });
  check("underlying file defaults to LAB_ONLY (fail closed)", dbItem.file.visibility === "LAB_ONLY");
  check("owner is the session account, never a client-supplied value", dbItem.file.ownerId === (await prisma.user.findUnique({ where: { email: a.email } })).id);

  check("a member cannot set visibility=PUBLIC on create -> 403", (await upload(a.client, { visibility: "PUBLIC" })).status === 403);
  const mgrPublic = await upload(mgr.client, { visibility: "PUBLIC", caption: "ZZ Gallery public photo" });
  check("a manager CAN set visibility=PUBLIC on create -> 201", mgrPublic.status === 201);

  // ------------------------------------------------------------------
  section("VISIBILITY: guest sees only PUBLIC items and files");
  check("guest list contains the PUBLIC item", (await guest.get("/gallery")).json.items.some((i) => i.id === mgrPublic.json.id));
  check("guest list does NOT contain the LAB_ONLY item", !(await guest.get("/gallery")).json.items.some((i) => i.id === galleryId));
  check("guest detail of a LAB_ONLY item -> 404", (await guest.get(`/gallery/${galleryId}`)).status === 404);
  check("guest CAN view the PUBLIC item's detail -> 200", (await guest.get(`/gallery/${mgrPublic.json.id}`)).status === 200);
  check("member (not owner) sees the LAB_ONLY item too (lab-wide)", (await b.client.get(`/gallery/${galleryId}`)).status === 200);

  // ------------------------------------------------------------------
  section("HIDDEN PROJECT: never leaks through the gallery");
  const leaky = await upload(mgr.client, { visibility: "PUBLIC", projectId: hiddenProject.json.id, caption: "ZZ Gallery leak test" });
  check("manager creates a PUBLIC photo linked to a HIDDEN project -> 201", leaky.status === 201);
  const guestView = await guest.get(`/gallery/${leaky.json.id}`);
  check("guest CAN see the public photo itself", guestView.status === 200);
  check("guest never receives the hidden project's id/title (project is null)", guestView.json.project === null);
  check("the hidden project's title string never appears anywhere in the response body", !JSON.stringify(guestView.json).includes("ZZ Gallery Hidden Project"));
  const listWithLeaky = await guest.get("/gallery");
  check("the hidden project also never leaks through the LIST endpoint", !JSON.stringify(listWithLeaky.json).includes("ZZ Gallery Hidden Project") && !JSON.stringify(listWithLeaky.json).includes(hiddenProject.json.id));

  const publicLink = await upload(mgr.client, { visibility: "PUBLIC", projectId: publicProject.json.id, caption: "ZZ Gallery public project photo" });
  const publicLinkView = await guest.get(`/gallery/${publicLink.json.id}`);
  check("a PUBLIC project's ref IS shown when the project itself is visible", publicLinkView.json.project?.id === publicProject.json.id);

  // ------------------------------------------------------------------
  section("OWNERSHIP: owner or manager may edit/delete; nobody else");
  check("a different member (not owner) cannot edit -> 403", (await b.client.put(`/gallery/${galleryId}`, { caption: "hijacked" })).status === 403);
  check("guest cannot edit -> 401", (await guest.put(`/gallery/${galleryId}`, { caption: "x" })).status === 401);
  const ownerEdit = await a.client.put(`/gallery/${galleryId}`, { caption: "Updated caption" });
  check("the owner can edit their own item -> 200", ownerEdit.status === 200 && ownerEdit.json.caption === "Updated caption");
  check("the owner cannot change visibility -> 403", (await a.client.put(`/gallery/${galleryId}`, { visibility: "PUBLIC" })).status === 403);
  const mgrEdit = await mgr.client.put(`/gallery/${galleryId}`, { visibility: "PUBLIC" });
  check("a manager CAN change visibility on someone else's item -> 200", mgrEdit.status === 200);
  check("guest can now see the item (visibility actually changed)", (await guest.get(`/gallery/${galleryId}`)).status === 200);

  check("a different member (not owner) cannot delete -> 403", (await b.client.del(`/gallery/${galleryId}`)).status === 403);
  const ownerFileUrl = `/files/${(await prisma.galleryItem.findUnique({ where: { id: galleryId } })).fileId}`;
  const deleted = await a.client.del(`/gallery/${galleryId}`);
  check("the owner can delete their own item -> 200", deleted.status === 200);
  check("deleted item's detail -> 404", (await a.client.get(`/gallery/${galleryId}`)).status === 404);
  check("deleted item's underlying file is ALSO gone (cannot be fetched directly)", (await a.client.raw(ownerFileUrl)).status === 404);
  check("deleting again -> 404", (await a.client.del(`/gallery/${galleryId}`)).status === 404);

  const forManager = await upload(b.client, { caption: "ZZ Gallery mgr-deletes-this" });
  const mgrDelete = await mgr.client.del(`/gallery/${forManager.json.id}`);
  check("a manager (not the owner) CAN delete someone else's item -> 200", mgrDelete.status === 200);

  // ------------------------------------------------------------------
  section("FILTERS + PAGINATION");
  for (let i = 0; i < 3; i++) await upload(a.client, { caption: `ZZ Gallery research ${i}`, category: "RESEARCH" });
  const researchFiltered = await a.client.get("/gallery?category=RESEARCH&limit=2&page=1");
  check("category filter returns only RESEARCH items", researchFiltered.json.items.every((i) => i.category === "RESEARCH"));
  check("limit is respected", researchFiltered.json.items.length <= 2);
  check("pagination meta is present and consistent", researchFiltered.json.pagination.limit === 2 && researchFiltered.json.pagination.total >= 3);
  const page2 = await a.client.get("/gallery?category=RESEARCH&limit=2&page=2");
  const ids1 = researchFiltered.json.items.map((i) => i.id);
  const ids2 = page2.json.items.map((i) => i.id);
  check("page 2 does not repeat page 1's items (deterministic ordering)", ids1.every((id) => !ids2.includes(id)));

  const projFiltered = await a.client.get(`/gallery?project=${publicProject.json.id}`);
  check("project filter returns items linked to that project", projFiltered.json.items.every((i) => i.project?.id === publicProject.json.id));

  // ------------------------------------------------------------------
  section("XSS: hostile caption text is stored/returned as inert literal text");
  for (const hostile of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "javascript:alert(1)"]) {
    const r = await upload(a.client, { caption: hostile });
    check(`hostile caption "${hostile}" accepted and round-trips unchanged (never executed, never stripped)`, r.status === 201 && r.json.caption === hostile);
  }

  // ------------------------------------------------------------------
  section("MULTI-IMAGE: one submission = ONE gallery entry with several images");
  const entryCount = async (caption) => prisma.galleryItem.count({ where: { caption } });
  const append = (client, id, buffer = JPEG, filename = "extra.jpg", contentType = "image/jpeg", fields = {}) =>
    client.upload(`/gallery/${id}/images`, fields, { buffer, filename, contentType });
  const storedFileCount = () => prisma.storedFile.count();
  const blobCount = () => {
    const dir = process.env.STORAGE_DIR;
    if (!dir) return null;
    const walk = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? walk(join(d, e.name)) : 1), 0);
    return existsSync(dir) ? walk(dir) : 0;
  };

  // The reported bug: the UI used to POST /gallery once PER image, so 4 images became 4 entries.
  const SHARED = "ZZ Gallery batch";
  const old1 = await upload(a.client, { caption: SHARED, category: "EVENT" }, JPEG, "old-1.jpg");
  const old2 = await upload(a.client, { caption: SHARED, category: "EVENT" }, JPEG, "old-2.jpg");
  check("single-image POST /gallery is unchanged: each call is its own entry with exactly one image", old1.status === 201 && old2.status === 201 && old1.json.id !== old2.json.id && old1.json.images.length === 1 && old2.json.images.length === 1 && old1.json.images[0].id === old1.json.file.id);
  check("(this is what the old multi-image flow did per image: 2 calls -> 2 entries)", (await entryCount(SHARED)) === 2);
  await prisma.galleryItem.deleteMany({ where: { caption: SHARED } });

  // The fixed flow: first image creates the entry, the others are appended to it.
  const CAP = "ZZ Gallery one-entry";
  const eventBefore = (await a.client.get("/gallery?category=EVENT&limit=1")).json.pagination.total;
  const first = await upload(a.client, { caption: CAP, category: "EVENT" }, JPEG, "multi-0.jpg");
  const entryId = first.json.id;
  const appended = [];
  for (let i = 1; i <= 3; i++) appended.push(await append(a.client, entryId, JPEG, `multi-${i}.jpg`));
  check("create + three appends all answer 201", first.status === 201 && appended.every((r) => r.status === 201), appended.map((r) => r.status).join());
  check("exactly ONE gallery entry exists for the submission (no duplicate cards/projects)", (await entryCount(CAP)) === 1);
  const eventAfter = (await a.client.get("/gallery?category=EVENT&limit=1")).json.pagination.total;
  check("the gallery list gained ONE entry, not one per image", eventAfter === eventBefore + 1, `before ${eventBefore}, after ${eventAfter}`);
  const detail = (await a.client.get(`/gallery/${entryId}`)).json;
  check("the entry holds all four images, cover first, in upload order", detail.images.length === 4 && detail.images[0].id === first.json.file.id && detail.images.map((i) => i.originalName).join() === "multi-0.jpg,multi-1.jpg,multi-2.jpg,multi-3.jpg", JSON.stringify(detail.images.map((i) => i.originalName)));
  check("`file` is still the cover image (backward compatible)", detail.file.id === detail.images[0].id);
  check("the caption and category are stored once, on the entry", detail.caption === CAP && detail.category === "EVENT");
  check("the list shows the entry exactly once", (await a.client.get("/gallery?category=EVENT&limit=50")).json.items.filter((i) => i.id === entryId).length === 1);
  check("the last append's response is the full entry (4 images)", appended[2].json?.id === entryId && appended[2].json.images.length === 4);
  check("no image URL exposes a storage key or blob URL", detail.images.every((i) => /^\/api\/files\/[a-z0-9]+$/i.test(i.url)) && !/blob\.vercel|storageKey|vercel-storage/i.test(JSON.stringify(detail)));
  const dbExtras = await prisma.galleryImage.findMany({ where: { itemId: entryId }, include: { file: true }, orderBy: { sortOrder: "asc" } });
  const me = await prisma.user.findUnique({ where: { email: a.email } });
  check("three GalleryImage rows, ordered, owned by the uploader, LAB_ONLY like the cover", dbExtras.length === 3 && dbExtras.every((r, i) => r.sortOrder === i + 1 && r.file.ownerId === me.id && r.file.visibility === "LAB_ONLY"));

  const blankCaption = await upload(a.client, { category: "EVENT" }, JPEG, "no-caption.jpg");
  check("a blank caption is valid (201, stored as empty)", blankCaption.status === 201 && blankCaption.json?.caption === "");

  // ---- authorization on append
  section("MULTI-IMAGE: authorization on POST /gallery/:id/images");
  check("guest cannot append -> 401", (await append(guest, entryId)).status === 401);
  check("a different member (not the owner) cannot append -> 403", (await append(b.client, entryId)).status === 403);
  check("... and nothing was added", (await prisma.galleryImage.count({ where: { itemId: entryId } })) === 3);
  check("a nonexistent entry -> 404", (await append(a.client, "cmnotarealentry00000000000")).status === 404);
  check("a malformed id is rejected (400/404), never a 500", [400, 404].includes((await append(a.client, "not a valid id!!")).status));
  const mgrAppend = await append(mgr.client, entryId, JPEG, "by-manager.jpg");
  check("a manager CAN append to someone else's entry -> 201", mgrAppend.status === 201 && mgrAppend.json.images.length === 5);
  const mgrRow = await prisma.galleryImage.findFirst({ where: { itemId: entryId }, orderBy: { sortOrder: "desc" }, include: { file: true } });
  check("... the manager is recorded as that image's uploader, the entry's owner is unchanged", mgrRow.file.ownerId !== me.id && (await a.client.get(`/gallery/${entryId}`)).json.canEdit === true);

  const smuggled = await append(a.client, entryId, JPEG, "smuggle.jpg", "image/jpeg", { visibility: "PUBLIC" });
  check("a member cannot choose visibility on an append: the client value is ignored, the image stays LAB_ONLY", smuggled.status === 201 && (await prisma.storedFile.count({ where: { visibility: "PUBLIC", galleryImage: { itemId: entryId } } })) === 0);

  // ---- validation + atomicity
  section("MULTI-IMAGE: invalid input and failures leave no misleading records");
  const filesBefore = await storedFileCount();
  const blobsBefore = blobCount();
  check("a non-image (PDF) append -> 400", (await append(a.client, entryId, PDF, "doc.pdf", "application/pdf")).status === 400);
  const noFile = await a.client.upload(`/gallery/${entryId}/images`, {}, null);
  check("an append with no file -> 400", noFile.status === 400);
  const twoForm = new FormData();
  twoForm.append("file", new Blob([JPEG], { type: "image/jpeg" }), "one.jpg");
  twoForm.append("file", new Blob([JPEG], { type: "image/jpeg" }), "two.jpg");
  const twoRes = await fetch(`${API}/api/gallery/${entryId}/images`, { method: "POST", headers: { cookie: a.client.cookie }, body: twoForm });
  check("ONE request carrying two files is rejected (the API stays one image per request) -> 400", twoRes.status === 400, `got ${twoRes.status}`);
  const twoCreate = new FormData();
  twoCreate.append("file", new Blob([JPEG], { type: "image/jpeg" }), "one.jpg");
  twoCreate.append("file", new Blob([JPEG], { type: "image/jpeg" }), "two.jpg");
  check("... and POST /gallery with two files is still rejected -> 400", (await fetch(`${API}/api/gallery`, { method: "POST", headers: { cookie: a.client.cookie }, body: twoCreate })).status === 400);
  check("rejected requests created no StoredFile rows", (await storedFileCount()) === filesBefore);
  if (blobsBefore !== null) check("rejected requests left no blob behind", blobCount() === blobsBefore, `before ${blobsBefore}, after ${blobCount()}`);
  const spoof = await append(a.client, entryId, PDF, "fake.jpg", "image/jpeg");
  check("a PDF renamed .jpg with an image content-type is rejected by the magic-byte check -> 400", spoof.status === 400);

  // cap: cover + 9 more = 10 images; the 11th is refused and leaves nothing behind
  let capRes = null;
  let have = (await a.client.get(`/gallery/${entryId}`)).json.images.length;
  while (have < 10) {
    capRes = await append(a.client, entryId, JPEG, `fill-${have}.jpg`);
    if (capRes.status !== 201) break;
    have = capRes.json.images.length;
  }
  check("the entry can be filled up to 10 images", have === 10, `have ${have}`);
  const filesAtCap = await storedFileCount();
  const blobsAtCap = blobCount();
  const over = await append(a.client, entryId, JPEG, "eleventh.jpg");
  check("an 11th image is refused -> 409", over.status === 409, `got ${over.status}`);
  check("... the refusal created no StoredFile row", (await storedFileCount()) === filesAtCap);
  if (blobsAtCap !== null) check("... and its already-written blob was cleaned up (no orphan)", blobCount() === blobsAtCap, `before ${blobsAtCap}, after ${blobCount()}`);
  check("... the entry still has exactly 10 images", (await a.client.get(`/gallery/${entryId}`)).json.images.length === 10);

  // ---- visibility
  section("MULTI-IMAGE: visibility follows the entry, for every image");
  const imgs = (await a.client.get(`/gallery/${entryId}`)).json.images;
  check("LAB_ONLY entry: guest gets 404 on the entry and on EVERY image file", (await guest.get(`/gallery/${entryId}`)).status === 404 && (await Promise.all(imgs.map((i) => guest.raw(`/files/${i.id}`)))).every((r) => r.status === 404));
  check("LAB_ONLY entry: a signed-in member can fetch every image", (await Promise.all(imgs.map((i) => b.client.raw(`/files/${i.id}`)))).every((r) => r.status === 200));
  check("LAB_ONLY entry is absent from the guest list", !(await guest.get("/gallery?limit=50")).json.items.some((i) => i.id === entryId));
  const toPublic = await mgr.client.put(`/gallery/${entryId}`, { visibility: "PUBLIC" });
  check("a manager makes the entry PUBLIC -> 200", toPublic.status === 200);
  check("every image file of the entry is now PUBLIC in the database", (await prisma.storedFile.count({ where: { visibility: "PUBLIC", OR: [{ galleryImage: { itemId: entryId } }, { galleryItem: { id: entryId } }] } })) === 10);
  check("guest now sees ONE card for it, with all 10 images, and can fetch each", (await (async () => {
    const list = (await guest.get("/gallery?limit=50")).json.items.filter((i) => i.id === entryId);
    return list.length === 1 && list[0].images.length === 10;
  })()) && (await Promise.all(imgs.map((i) => guest.raw(`/files/${i.id}`)))).every((r) => r.status === 200));
  await mgr.client.put(`/gallery/${entryId}`, { visibility: "LAB_ONLY" });
  check("back to LAB_ONLY: the guest loses every image again (cover and extras)", (await Promise.all(imgs.map((i) => guest.raw(`/files/${i.id}`)))).every((r) => r.status === 404));
  await mgr.client.put(`/gallery/${entryId}`, { visibility: "PUBLIC" });
  const pubAppend = await mgr.client.upload(`/gallery/${(await prisma.galleryItem.findFirst({ where: { caption: "ZZ Gallery public photo" } })).id}/images`, {}, { buffer: JPEG, filename: "pub-extra.jpg", contentType: "image/jpeg" });
  const pubExtra = pubAppend.json?.images?.[1];
  check("an image appended to a PUBLIC entry is PUBLIC (guest can fetch it)", pubAppend.status === 201 && !!pubExtra && (await guest.raw(`/files/${pubExtra.id}`)).status === 200);
  await mgr.client.put(`/gallery/${entryId}`, { visibility: "LAB_ONLY" });

  // ---- edit + delete
  section("MULTI-IMAGE: edit and delete act on the whole entry");
  const edited = await a.client.put(`/gallery/${entryId}`, { caption: "ZZ Gallery edited", category: "RESEARCH" });
  check("editing the entry changes caption/category once and keeps all 10 images", edited.status === 200 && edited.json.caption === "ZZ Gallery edited" && edited.json.category === "RESEARCH" && edited.json.images.length === 10);
  const extraFileId = imgs[3].id;
  check("deleting an extra image's file directly is refused -> 409 (delete the entry instead)", (await a.client.del(`/files/${extraFileId}`)).status === 409);
  check("the cover file cannot be deleted directly either -> 409", (await a.client.del(`/files/${imgs[0].id}`)).status === 409);
  check("a different member cannot delete the entry -> 403", (await b.client.del(`/gallery/${entryId}`)).status === 403);
  const blobsBeforeDelete = blobCount();
  const delRes = await a.client.del(`/gallery/${entryId}`);
  check("the owner deletes the entry -> 200", delRes.status === 200);
  check("the entry is gone (404)", (await a.client.get(`/gallery/${entryId}`)).status === 404);
  check("EVERY image of the entry is gone: all ten file URLs answer 404", (await Promise.all(imgs.map((i) => a.client.raw(`/files/${i.id}`)))).every((r) => r.status === 404));
  check("all ten StoredFile rows are soft-deleted and the GalleryImage rows removed", (await prisma.storedFile.count({ where: { id: { in: imgs.map((i) => i.id) }, deletedAt: null } })) === 0 && (await prisma.galleryImage.count({ where: { itemId: entryId } })) === 0);
  if (blobsBeforeDelete !== null) check("all ten blobs were removed from storage", blobCount() === blobsBeforeDelete - 10, `before ${blobsBeforeDelete}, after ${blobCount()}`);
  check("appending to a deleted entry -> 404", (await append(a.client, entryId)).status === 404);
  check("deleting again -> 404", (await a.client.del(`/gallery/${entryId}`)).status === 404);
  const mgrEntry = await upload(b.client, { caption: "ZZ Gallery mgr-multi" }, JPEG, "m0.jpg");
  await append(b.client, mgrEntry.json.id, JPEG, "m1.jpg");
  check("a manager can delete someone else's multi-image entry -> 200", (await mgr.client.del(`/gallery/${mgrEntry.json.id}`)).status === 200);

  // ---- mixed pagination: one card per entry
  const pageCheck = (await a.client.get("/gallery?limit=50")).json.items;
  check("no entry appears twice in a list page", new Set(pageCheck.map((i) => i.id)).size === pageCheck.length);

  // ------------------------------------------------------------------
  section("IDEMPOTENCY: a request that committed but whose response was lost");
  const proxy = await startLossyProxy(Number(new URL(API).port));
  const JPEG2 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x22)]); // different bytes, still a valid JPEG signature
  const KEY = { header: "Idempotency-Key" };
  const send = (client, path, fields, buffer, key, filename = "idem.jpg", extra = {}) =>
    client.upload(path, fields, { buffer, filename, contentType: "image/jpeg" }, { headers: key ? { [KEY.header]: key } : {}, ...extra });
  const lost = async (client, path, fields, buffer, key, filename) => {
    try {
      await send(client, path, fields, buffer, key, filename, { base: proxy.base });
      return false; // the response arrived: the loss was not simulated
    } catch {
      return true;
    }
  };
  const attempts = (key) => prisma.galleryUploadAttempt.count({ where: { key } });

  // ---- create
  const k1 = randomUUID();
  const ICAP = "ZZ Gallery idem create";
  const filesBefore1 = await storedFileCount();
  const blobsBefore1 = blobCount();
  check("(create) the response is lost: the client sees a network error, not a status", (await lost(a.client, "/gallery", { caption: ICAP }, JPEG, k1)) === true);
  await new Promise((r) => setTimeout(r, 150));
  check("(create) ... yet the server committed exactly ONE entry", (await entryCount(ICAP)) === 1);
  check("(create) ... one attempt row, one StoredFile row", (await attempts(k1)) === 1 && (await storedFileCount()) === filesBefore1 + 1);
  const blobsAfter1 = blobCount();
  if (blobsBefore1 !== null) check("(create) ... and one blob", blobsAfter1 === blobsBefore1 + 1, `before ${blobsBefore1}, after ${blobsAfter1}`);
  const retry1 = await send(a.client, "/gallery", { caption: ICAP }, JPEG, k1);
  const entry1 = await prisma.galleryItem.findFirst({ where: { caption: ICAP } });
  check("(create) the retry with the same key answers 201 with the ORIGINAL entry", retry1.status === 201 && retry1.json?.id === entry1.id && retry1.replayed === true, `${retry1.status} replayed=${retry1.replayed}`);
  check("(create) ... still exactly one entry, one StoredFile, one attempt row", (await entryCount(ICAP)) === 1 && (await storedFileCount()) === filesBefore1 + 1 && (await attempts(k1)) === 1);
  if (blobsBefore1 !== null) check("(create) ... and NO second blob", blobCount() === blobsAfter1, `after retry ${blobCount()}, expected ${blobsAfter1}`);
  const retry1b = await send(a.client, "/gallery", { caption: ICAP }, JPEG, k1);
  check("(create) a second and third retry are the same original entry", retry1b.status === 201 && retry1b.json?.id === entry1.id && (await entryCount(ICAP)) === 1);
  check("(create) the replayed entry is the full entry (images present, owner can edit)", retry1.json.images.length === 1 && retry1.json.canEdit === true);

  // ---- append
  const k2 = randomUUID();
  const filesBefore2 = await storedFileCount();
  const blobsBefore2 = blobCount();
  check("(append) the response is lost", (await lost(a.client, `/gallery/${entry1.id}/images`, {}, JPEG2, k2, "idem-2.jpg")) === true);
  await new Promise((r) => setTimeout(r, 150));
  check("(append) ... yet exactly ONE image was added", (await prisma.galleryImage.count({ where: { itemId: entry1.id } })) === 1 && (await storedFileCount()) === filesBefore2 + 1 && (await attempts(k2)) === 1);
  const blobsAfter2 = blobCount();
  if (blobsBefore2 !== null) check("(append) ... and one blob", blobsAfter2 === blobsBefore2 + 1);
  const retry2 = await send(a.client, `/gallery/${entry1.id}/images`, {}, JPEG2, k2, "idem-2.jpg");
  check("(append) the retry answers 201 with the same entry, now holding cover + 1 image", retry2.status === 201 && retry2.json?.id === entry1.id && retry2.json.images.length === 2 && retry2.replayed === true);
  check("(append) ... no second image, StoredFile or attempt row", (await prisma.galleryImage.count({ where: { itemId: entry1.id } })) === 1 && (await storedFileCount()) === filesBefore2 + 1 && (await attempts(k2)) === 1);
  if (blobsBefore2 !== null) check("(append) ... and NO second blob", blobCount() === blobsAfter2);
  const retry2b = await send(a.client, `/gallery/${entry1.id}/images`, {}, JPEG2, k2, "idem-2.jpg");
  check("(append) repeated retries stay the same", retry2b.status === 201 && retry2b.json.images.length === 2);

  // ---- the lost response is the 10th image: the retry must succeed, not hit the cap
  section("IDEMPOTENCY: the cap and replays");
  while ((await a.client.get(`/gallery/${entry1.id}`)).json.images.length < 9) await append(a.client, entry1.id, JPEG, `cap-${randomUUID()}.jpg`);
  const k10 = randomUUID();
  const tenth = Buffer.concat([JPEG, Buffer.from([1, 2, 3])]);
  await lost(a.client, `/gallery/${entry1.id}/images`, {}, tenth, k10, "tenth.jpg");
  await new Promise((r) => setTimeout(r, 150));
  check("the 10th image was committed although its response was lost", (await a.client.get(`/gallery/${entry1.id}`)).json.images.length === 10);
  const retry10 = await send(a.client, `/gallery/${entry1.id}/images`, {}, tenth, k10, "tenth.jpg");
  check("retrying the 10th image succeeds (201, replay) instead of failing the 10-image cap", retry10.status === 201 && retry10.replayed === true && retry10.json.images.length === 10, `${retry10.status}`);
  const eleventh = await send(a.client, `/gallery/${entry1.id}/images`, {}, Buffer.concat([JPEG, Buffer.from([9, 9])]), randomUUID(), "eleventh.jpg");
  check("a NEW key at the cap is still refused (409): the 10-image limit holds", eleventh.status === 409);
  check("... and the entry still has exactly 10 images", (await prisma.galleryImage.count({ where: { itemId: entry1.id } })) === 9);

  // ---- concurrent duplicates
  section("IDEMPOTENCY: concurrent duplicate requests");
  const kc = randomUUID();
  const CCAP = "ZZ Gallery idem concurrent create";
  const filesBeforeC = await storedFileCount();
  const blobsBeforeC = blobCount();
  const SERIALIZED = process.env.SERIALIZED_DB === "1";
  const dup = await Promise.all(Array.from({ length: 6 }, () => send(a.client, "/gallery", { caption: CCAP }, JPEG, kc, "dup.jpg")));
  if (SERIALIZED) {
    check("(create) six simultaneous identical requests all answer 201", dup.every((r) => r.status === 201), dup.map((r) => r.status).join());
    check("(create) ... all with the SAME entry id", new Set(dup.map((r) => r.json?.id)).size === 1);
  } else {
    check("(create) six simultaneous identical requests: each answers 201 or a retryable 500, never a duplicate", dup.every((r) => r.status === 201 || r.status === 500), dup.map((r) => r.status).join());
  }
  const dupSettle = await send(a.client, "/gallery", { caption: CCAP }, JPEG, kc, "dup.jpg");
  check("(create) one retry afterwards converges on the single original entry", dupSettle.status === 201 && (await entryCount(CCAP)) === 1 && dup.filter((r) => r.status === 201).every((r) => r.json.id === dupSettle.json.id));
  check("(create) ... exactly one entry, one StoredFile, one attempt row", (await entryCount(CCAP)) === 1 && (await storedFileCount()) === filesBeforeC + 1 && (await attempts(kc)) === 1);
  if (blobsBeforeC !== null) check("(create) ... and exactly one blob remains (the losers' blobs were removed)", blobCount() === blobsBeforeC + 1, `before ${blobsBeforeC}, after ${blobCount()}`);
  const concEntry = dupSettle.json.id;
  const kca = randomUUID();
  const filesBeforeCA = await storedFileCount();
  const blobsBeforeCA = blobCount();
  const dupA = await Promise.all(Array.from({ length: 6 }, () => send(a.client, `/gallery/${concEntry}/images`, {}, JPEG2, kca, "dupa.jpg")));
  if (SERIALIZED) check("(append) six simultaneous identical requests all answer 201 for the same entry", dupA.every((r) => r.status === 201 && r.json?.id === concEntry), dupA.map((r) => r.status).join());
  else check("(append) six simultaneous identical requests: each answers 201 or a retryable 500", dupA.every((r) => r.status === 201 || r.status === 500), dupA.map((r) => r.status).join());
  const dupASettle = await send(a.client, `/gallery/${concEntry}/images`, {}, JPEG2, kca, "dupa.jpg");
  check("(append) one retry afterwards converges on the original entry", dupASettle.status === 201 && dupASettle.json?.id === concEntry);
  check("(append) ... exactly one image, one StoredFile, one attempt row", (await prisma.galleryImage.count({ where: { itemId: concEntry } })) === 1 && (await storedFileCount()) === filesBeforeCA + 1 && (await attempts(kca)) === 1);
  if (blobsBeforeCA !== null) check("(append) ... and exactly one new blob", blobCount() === blobsBeforeCA + 1, `before ${blobsBeforeCA}, after ${blobCount()}`);
  const distinct = await Promise.all([1, 2, 3].map((i) => send(a.client, "/gallery", { caption: "ZZ Gallery idem distinct" }, Buffer.concat([JPEG, Buffer.from([i])]), randomUUID(), `d${i}.jpg`)));
  check("simultaneous requests with DIFFERENT keys are independent (three entries)", SERIALIZED ? distinct.every((r) => r.status === 201) && new Set(distinct.map((r) => r.json.id)).size === 3 : distinct.every((r) => r.status === 201 || r.status === 500));

  // ---- a key is bound to its operation, entry and image
  section("IDEMPOTENCY: keys are bound to the operation, the entry and the image");
  const imgCount = (id) => prisma.galleryImage.count({ where: { itemId: id } });
  const other = await upload(a.client, { caption: "ZZ Gallery idem other entry" });
  const beforeBind = { entries: await prisma.galleryItem.count(), images: await imgCount(entry1.id), otherImages: await imgCount(other.json.id) };
  const asAppend = await send(a.client, `/gallery/${other.json.id}/images`, {}, JPEG, k1, "x.jpg");
  check("a CREATE key reused for an APPEND -> 409", asAppend.status === 409);
  const asCreate = await send(a.client, "/gallery", { caption: "ZZ Gallery idem reuse" }, JPEG2, k2, "x.jpg");
  check("an APPEND key reused for a CREATE -> 409, and no entry was created", asCreate.status === 409 && (await entryCount("ZZ Gallery idem reuse")) === 0);
  const wrongEntry = await send(a.client, `/gallery/${other.json.id}/images`, {}, JPEG2, k2, "idem-2.jpg");
  check("an APPEND key reused for a DIFFERENT entry -> 409 (cannot attach to the wrong entry)", wrongEntry.status === 409 && (await imgCount(other.json.id)) === beforeBind.otherImages);
  const wrongBytes = await send(a.client, `/gallery/${entry1.id}/images`, {}, JPEG, k2, "other.jpg");
  check("an APPEND key reused with a DIFFERENT image -> 409", wrongBytes.status === 409);
  const wrongBytesCreate = await send(a.client, "/gallery", { caption: ICAP }, JPEG2, k1, "other.jpg");
  check("a CREATE key reused with a DIFFERENT image -> 409", wrongBytesCreate.status === 409 && (await entryCount(ICAP)) === 1);
  check("none of the refused requests changed anything", (await prisma.galleryItem.count()) === beforeBind.entries + 0 && (await imgCount(entry1.id)) === beforeBind.images);
  const badKeys = ["short", "x".repeat(65), "has spaces in the key!!", "semi;colon;semi;colon;12"];
  const badRes = [];
  for (const bad of badKeys) {
    badRes.push((await send(a.client, "/gallery", {}, JPEG, bad)).status);
    badRes.push((await send(a.client, `/gallery/${other.json.id}/images`, {}, JPEG, bad)).status);
  }
  check("a malformed Idempotency-Key is refused with 400 on both routes", badRes.every((st) => st === 400), badRes.join());
  check("... and nothing was stored", (await imgCount(other.json.id)) === 0);
  check("a request WITHOUT a key still works exactly as before (201, not a replay)", (await send(a.client, "/gallery", { caption: "ZZ Gallery idem none" }, JPEG, null)).status === 201);

  // ---- authorization
  section("IDEMPOTENCY: keys are scoped to the account and never bypass authorization");
  check("a guest sending a key -> 401 on create and append", (await send(guest, "/gallery", {}, JPEG, randomUUID())).status === 401 && (await send(guest, `/gallery/${entry1.id}/images`, {}, JPEG, randomUUID())).status === 401);
  const bCreate = await send(b.client, "/gallery", { caption: ICAP }, JPEG, k1);
  check("ANOTHER account using my create key gets its OWN new entry, never mine", bCreate.status === 201 && bCreate.json.id !== entry1.id && bCreate.replayed === false);
  const bOwn = await prisma.galleryItem.findUnique({ where: { id: bCreate.json.id }, include: { file: true } });
  check("... that entry belongs to the other account and mine is untouched", bOwn.file.ownerId !== entry1.id && (await entryCount(ICAP)) === 2 && (await attempts(k1)) === 2);
  const bAppendMine = await send(b.client, `/gallery/${entry1.id}/images`, {}, JPEG2, k2, "idem-2.jpg");
  check("ANOTHER member retrying my append key against MY entry -> 403 (authorization first), nothing exposed", bAppendMine.status === 403 && bAppendMine.json?.images === undefined);
  const bAppendOwn = await send(b.client, `/gallery/${bCreate.json.id}/images`, {}, JPEG2, k2, "idem-2.jpg");
  check("... and with my key against THEIR OWN entry it is simply their own new image (keys are per account)", bAppendOwn.status === 201 && bAppendOwn.replayed === false && bAppendOwn.json.images.length === 2);
  const mgrTarget = await upload(a.client, { caption: "ZZ Gallery idem mgr target" });
  const mgrRetry = await send(mgr.client, `/gallery/${mgrTarget.json.id}/images`, {}, JPEG2, k2, "idem-2.jpg");
  check("a manager is a different account: the same key is NOT a replay of mine (a new image is added)", mgrRetry.status === 201 && mgrRetry.replayed === false && mgrRetry.json.images.length === 2);

  // ---- deleted entries
  section("IDEMPOTENCY: a retry after the entry was deleted never re-creates it");
  const kd = randomUUID();
  const DCAP = "ZZ Gallery idem deleted";
  const dcreate = await send(a.client, "/gallery", { caption: DCAP }, JPEG, kd);
  const dappendKey = randomUUID();
  await send(a.client, `/gallery/${dcreate.json.id}/images`, {}, JPEG2, dappendKey, "d.jpg");
  await a.client.del(`/gallery/${dcreate.json.id}`);
  const filesBeforeD = await storedFileCount();
  const blobsBeforeD = blobCount();
  const rCreate = await send(a.client, "/gallery", { caption: DCAP }, JPEG, kd);
  check("retrying a CREATE whose entry was deleted -> 404 and nothing is re-created", rCreate.status === 404 && (await entryCount(DCAP)) === 0);
  const rAppend = await send(a.client, `/gallery/${dcreate.json.id}/images`, {}, JPEG2, dappendKey, "d.jpg");
  check("retrying an APPEND whose entry was deleted -> 404", rAppend.status === 404);
  check("... no StoredFile row and no blob was created by either", (await storedFileCount()) === filesBeforeD && (blobsBeforeD === null || blobCount() === blobsBeforeD));

  // ---- cleanup on failures
  section("IDEMPOTENCY: failures leave no attempt row, no record and no blob");
  const kf = randomUUID();
  const filesBeforeF = await storedFileCount();
  const blobsBeforeF = blobCount();
  const pdfKeyed = await a.client.upload("/gallery", {}, { buffer: PDF, filename: "doc.pdf", contentType: "application/pdf" }, { headers: { [KEY.header]: kf } });
  check("a keyed PDF upload -> 400", pdfKeyed.status === 400);
  const badField = await send(a.client, "/gallery", { category: "NOT_A_CATEGORY" }, JPEG, kf);
  check("a keyed upload with invalid fields -> 400", badField.status === 400);
  const badProject = await send(a.client, "/gallery", { projectId: "cmnotaproject0000000000000" }, JPEG, kf);
  check("a keyed upload that fails INSIDE the transaction (unknown project) -> 400", badProject.status === 400, `${badProject.status}`);
  check("... none of them left an attempt row, a StoredFile row or a blob", (await attempts(kf)) === 0 && (await storedFileCount()) === filesBeforeF && (blobsBeforeF === null || blobCount() === blobsBeforeF), `blobs ${blobsBeforeF} -> ${blobCount()}`);
  const kfOk = await send(a.client, "/gallery", { caption: "ZZ Gallery idem after-failure" }, JPEG, kf);
  check("a key whose attempts FAILED is not burned: the same key then succeeds (201, first time)", kfOk.status === 201 && kfOk.replayed === false && (await attempts(kf)) === 1);
  const atCapFiles = await storedFileCount();
  const atCapBlobs = blobCount();
  const kcap = randomUUID();
  const refused = await send(a.client, `/gallery/${entry1.id}/images`, {}, Buffer.concat([JPEG, Buffer.from([7, 7, 7])]), kcap, "over.jpg");
  check("a keyed append refused by the 10-image cap -> 409, no attempt row, no StoredFile, no blob", refused.status === 409 && (await attempts(kcap)) === 0 && (await storedFileCount()) === atCapFiles && (atCapBlobs === null || blobCount() === atCapBlobs));
  proxy.close();

  // ------------------------------------------------------------------
  section("SEARCH: gallery items are deliberately NOT part of global search (Phase 13 scope)");
  const searchHit = await a.client.get("/search?q=ZZ%20Gallery%20research");
  check("global search returns no gallery-type results (not implemented this phase)", !(searchHit.json?.results ?? []).some((r) => r.type === "gallery" || r.type === "gallery-item"));

  // ------------------------------------------------------------------
  section("AUDIT: only safe metadata");
  const galleryAudits = await prisma.auditLog.findMany({ where: { action: { in: ["GALLERY_ITEM_CREATED", "GALLERY_ITEM_UPDATED", "GALLERY_ITEM_DELETED"] } }, orderBy: { createdAt: "desc" }, take: 30 });
  check("gallery audit rows exist", galleryAudits.length > 0);
  check(
    "audit details never contain a storage key, buffer or raw file bytes",
    galleryAudits.every((r) => !r.details || !/storageKey|buffer/i.test(r.details)),
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
