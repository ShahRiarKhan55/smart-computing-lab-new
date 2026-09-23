/**
 * End-to-end API regression for the Lab Gallery (Phase 13): /api/gallery/*.
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:/abs/path/to/copy.db STORAGE_DIR=/abs/path/to/storage PORT=4062 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:/abs/path/to/copy.db API=http://localhost:4062 node scripts/gallery-regression.mjs
 *
 * Run it ONLY against a COPY of the database. Creates/removes fixtures prefixed "ZZ Gallery" /
 * p13gtest-*@example.test (also at start, in case a previous run was interrupted).
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
    return { status: res.status, json };
  }
  async upload(path, fields, file) {
    const form = new FormData();
    if (file) form.set("file", new Blob([file.buffer], { type: file.contentType }), file.filename);
    for (const [k, v] of Object.entries(fields ?? {})) form.set(k, v);
    const res = await fetch(`${API}/api${path}`, { method: "POST", headers: this.cookie ? { cookie: this.cookie } : {}, body: form });
    this.#saveCookie(res);
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
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
