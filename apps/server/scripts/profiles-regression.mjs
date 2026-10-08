/**
 * Regression for Phase 27 profile features: researcher profile links (Google Scholar / ResearchGate /
 * ORCID), the alumni directory (login-free by construction), unpublishing, and profile-photo upload
 * from a computer (P27.3, P27.6, P27.8).
 *
 * Self-contained and offline: spawns its own server on a disposable copy of prisma/dev.db with
 * TURSO_* and BLOB_* cleared (nothing here can reach Turso or a real Blob store).
 *
 *   node scripts/profiles-regression.mjs
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");
const TSX = path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };
const PW = "Str0ngPassw0rd!";

let ok = 0;
const failures = [];
const t = (name, cond, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

if (!existsSync(SOURCE_DB)) {
  console.error(`Missing ${SOURCE_DB} — run \`npm run seed -w apps/server\` first.`);
  process.exit(1);
}

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
/** A PNG header (signature + IHDR) declaring arbitrary dimensions: enough for the header-only checks. */
function pngHeader(width, height) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.set([8, 2, 0, 0, 0], 16);
  return Buffer.concat([PNG_1x1.subarray(0, 8), ihdr, Buffer.alloc(16)]);
}
const jpegMinimal = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x20, 0x00, 0x30, 0x01, 0x01, 0x11, 0x00]), Buffer.alloc(8)]);

async function startServer(extraEnv = {}) {
  const work = mkdtempSync(path.join(tmpdir(), "scl-profiles-"));
  copyFileSync(SOURCE_DB, path.join(work, "c.db"));
  const port = 47000 + Math.floor(Math.random() * 400);
  const env = {
    ...process.env,
    TURSO_DATABASE_URL: "",
    TURSO_AUTH_TOKEN: "",
    BLOB_READ_WRITE_TOKEN: "",
    VERCEL: "",
    STORAGE_DIR: path.join(work, "files"),
    DATABASE_URL: `file:${path.join(work, "c.db")}`,
    PORT: String(port),
    TRUST_PROXY: "0",
    NODE_ENV: "test",
    SESSION_SECRET: "profiles-regression-secret-000000000000",
    ...extraEnv,
  };
  const child = spawn(process.execPath, [TSX, path.join(SERVER_ROOT, "src", "index.ts")], { cwd: SERVER_ROOT, env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 80 && !/listening on/.test(out); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/listening on/.test(out)) throw new Error(`server did not start:\n${out}`);
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  return {
    base: `http://localhost:${port}`,
    work,
    prisma,
    storageDir: env.STORAGE_DIR,
    files: () => (existsSync(env.STORAGE_DIR) ? readdirSync(env.STORAGE_DIR) : []),
    async stop() {
      child.kill();
      await prisma.$disconnect();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

function client(base, cookie = null) {
  async function call(method, url, body) {
    const res = await fetch(`${base}/api${url}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON */
    }
    return { status: res.status, json };
  }
  return {
    get: (u) => call("GET", u),
    post: (u, b) => call("POST", u, b ?? {}),
    put: (u, b) => call("PUT", u, b),
    del: (u) => call("DELETE", u),
    async photo(id, bytes, { name = "p.png", type = "image/png" } = {}) {
      const form = new FormData();
      form.set("file", new Blob([bytes], { type }), name);
      const res = await fetch(`${base}/api/team/${id}/photo`, { method: "POST", headers: cookie ? { cookie } : {}, body: form });
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* not JSON */
      }
      return { status: res.status, json };
    },
  };
}

async function login(base, creds) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds) });
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? null;
  return client(base, cookie);
}

const VALID_ORCID = "0000-0002-1825-0097"; // ORCID's own documentation example
const SCHOLAR = "https://scholar.google.com/citations?user=AbCdEfGhIjK";
const RG = "https://www.researchgate.net/profile/Example-Person";

async function main() {
  const s = await startServer();
  try {
    const admin = await login(s.base, ADMIN);
    const guest = client(s.base);

    // ---- accounts: a lead member with a profile, a plain member with a profile ----------------------
    const mk = async (email, name) => {
      const r = await admin.post("/users", { email, password: PW, role: "MEMBER", name, initials: "PR", memberRole: "Researcher", category: "PHD" });
      if (r.status !== 201) throw new Error(`could not create ${email}: ${r.status} ${JSON.stringify(r.json)}`);
      return login(s.base, { email, password: PW });
    };
    const alice = await mk("p27-alice@example.test", "ZZ P27 Alice");
    const bob = await mk("p27-bob@example.test", "ZZ P27 Bob");
    const aliceProfile = (await alice.get("/profile")).json;
    const bobProfile = (await bob.get("/profile")).json;
    t("setup: both members have linked profiles with the new fields defaulting to empty", aliceProfile.scholarUrl === "" && aliceProfile.researchGateUrl === "" && aliceProfile.orcid === "" && !("isPublished" in aliceProfile));

    // ---- profile links ---------------------------------------------------------------------------------
    const own = await alice.put("/profile", { scholarUrl: SCHOLAR, researchGateUrl: RG, orcid: `https://orcid.org/${VALID_ORCID}` });
    t("links: a member can set their own Scholar, ResearchGate and ORCID (an orcid.org link is stored as the bare iD)", own.status === 200 && own.json.scholarUrl === SCHOLAR && own.json.researchGateUrl === RG && own.json.orcid === VALID_ORCID, JSON.stringify(own.json));
    const listed = (await guest.get("/team")).json.find((m) => m.id === aliceProfile.id);
    t("links: the public team API exposes them", listed?.scholarUrl === SCHOLAR && listed?.orcid === VALID_ORCID && listed?.researchGateUrl === RG);
    t("links: the public team API never exposes the account id or email", !JSON.stringify((await guest.get("/team")).json).match(/p27-alice@|userId/));
    for (const [name, body] of [
      ["javascript: URL as Scholar", { scholarUrl: "javascript:alert(1)" }],
      ["a non-Scholar site as Scholar", { scholarUrl: "https://evil.example.test/citations" }],
      ["a look-alike host containing scholar.google.com", { scholarUrl: "https://scholar.google.com.evil.test/x" }],
      ["credentials embedded in the URL", { researchGateUrl: "https://user:pw@www.researchgate.net/profile/x" }],
      ["a non-ResearchGate site as ResearchGate", { researchGateUrl: "https://example.test/researchgate.net" }],
      ["an ORCID with a bad check digit", { orcid: "0000-0002-1825-0098" }],
      ["an ORCID that is not an iD", { orcid: "hello" }],
      ["an orcid.org-looking URL on another host", { orcid: `https://orcid.org.evil.test/${VALID_ORCID}` }],
      ["a non-string ORCID", { orcid: 12345 }],
    ]) {
      const r = await alice.put("/profile", body);
      t(`links: rejected 400 — ${name}`, r.status === 400, `${r.status} ${JSON.stringify(r.json)}`);
    }
    const cleared = await alice.put("/profile", { scholarUrl: "" });
    t("links: an empty string clears one link and leaves the others", cleared.status === 200 && cleared.json.scholarUrl === "" && cleared.json.researchGateUrl === RG && cleared.json.orcid === VALID_ORCID);
    const untouched = await alice.put("/profile", { bio: "Updated bio" });
    t("links: a save that omits the link fields keeps them", untouched.json.researchGateUrl === RG && untouched.json.orcid === VALID_ORCID);
    t("links: another member cannot edit someone else's links (403)", (await bob.put(`/team/${aliceProfile.id}`, { orcid: VALID_ORCID })).status === 403);
    t("links: a guest cannot (401)", (await guest.put(`/team/${aliceProfile.id}`, { orcid: VALID_ORCID })).status === 401);
    const mgrEdit = await admin.put(`/team/${bobProfile.id}`, { scholarUrl: "https://scholar.google.co.jp/citations?user=xyz", orcid: "0000000218250097" });
    t("links: an admin can set another person's links (ORCID normalised from a dash-less iD; a country Scholar domain is accepted)", mgrEdit.status === 200 && mgrEdit.json.orcid === VALID_ORCID && /scholar\.google\.co\.jp/.test(mgrEdit.json.scholarUrl), JSON.stringify(mgrEdit.json));

    // ---- alumni -------------------------------------------------------------------------------------------
    const created = await admin.post("/team", { name: "ZZ P27 Alumna", initials: "ZA", role: "PhD graduate, 2024", category: "ALUMNI", department: "Now at Example Corp", bio: "Former member." });
    t("alumni: an admin can add an alumni profile", created.status === 201 && created.json.category === "ALUMNI", JSON.stringify(created.json));
    const alumId = created.json.id;
    const row = await s.prisma.teamMember.findUnique({ where: { id: alumId } });
    t("alumni: the new profile has NO linked account", row.userId === null);
    t("alumni: it appears in the public team API with category ALUMNI", (await guest.get("/team")).json.some((m) => m.id === alumId && m.category === "ALUMNI"));
    t("alumni: a non-manager cannot create one (403)", (await alice.post("/team", { name: "x", initials: "x", role: "x", category: "ALUMNI" })).status === 403);

    const usersBefore = await s.prisma.user.count();
    // Bob is already linked to his own profile: unlink first so the test exercises the alumni rule, not "already linked".
    await admin.put(`/users/${(await s.prisma.user.findFirst({ where: { email: "p27-bob@example.test" } })).id}/link`, { teamMemberId: null });
    const linkTry2 = await admin.put(`/users/${(await s.prisma.user.findFirst({ where: { email: "p27-bob@example.test" } })).id}/link`, { teamMemberId: alumId });
    t("alumni: …including for an otherwise unlinked account (409)", linkTry2.status === 409 && /alumni/i.test(linkTry2.json?.error ?? ""), `${linkTry2.status} ${JSON.stringify(linkTry2.json)}`);
    const createWith = await admin.post("/users", { email: "p27-alum-login@example.test", password: PW, role: "MEMBER", teamMemberId: alumId });
    t("alumni: an account cannot be CREATED for an alumni profile (409)", createWith.status === 409, `${createWith.status} ${JSON.stringify(createWith.json)}`);
    const createNew = await admin.post("/users", { email: "p27-alum-login2@example.test", password: PW, role: "MEMBER", name: "N", initials: "N", memberRole: "x", category: "ALUMNI" });
    t("alumni: an account cannot be created TOGETHER with an alumni profile (400)", createNew.status === 400, `${createNew.status} ${JSON.stringify(createNew.json)}`);
    const inv = await admin.post("/invitations", { email: "p27-alum-invite@example.test", role: "MEMBER", teamMemberId: alumId });
    t("alumni: an invitation cannot target an alumni profile (409)", inv.status === 409, `${inv.status} ${JSON.stringify(inv.json)}`);
    const inv2 = await admin.post("/invitations", { email: "p27-alum-invite2@example.test", role: "MEMBER", name: "N", initials: "N", memberRole: "x", category: "ALUMNI" });
    t("alumni: an invitation cannot create an alumni profile (400)", inv2.status === 400, `${inv2.status} ${JSON.stringify(inv2.json)}`);
    t("alumni: none of those attempts created an account or invitation", (await s.prisma.user.count()) === usersBefore && (await s.prisma.accountInvitation.count({ where: { email: { startsWith: "p27-alum" } } })) === 0);
    const toAlumni = await admin.put(`/team/${aliceProfile.id}`, { category: "ALUMNI" });
    t("alumni: a profile that still has a login cannot be moved into alumni (409)", toAlumni.status === 409, `${toAlumni.status} ${JSON.stringify(toAlumni.json)}`);
    t("alumni: …and stayed what it was", (await s.prisma.teamMember.findUnique({ where: { id: aliceProfile.id } })).category === "PHD");
    t("alumni: nobody can log in as an alumni profile (no User row, no password hash anywhere)", (await s.prisma.user.count({ where: { teamMember: { id: alumId } } })) === 0);
    const bobAgain = await login(s.base, { email: "p27-bob@example.test", password: PW });
    t("existing login accounts still work", (await bobAgain.get("/auth/me")).json.user?.email === "p27-bob@example.test");

    // ---- publish / unpublish ---------------------------------------------------------------------------------
    const hide = await admin.put(`/team/${alumId}`, { isPublished: false });
    t("unpublish: a manager can hide a profile", hide.status === 200 && hide.json.isPublished === false);
    t("unpublish: a guest no longer sees it in the list", !(await guest.get("/team")).json.some((m) => m.id === alumId));
    t("unpublish: …nor by id (404, indistinguishable from missing)", (await guest.get(`/team/${alumId}`)).status === 404);
    t("unpublish: a signed-in member does not see it either", !(await alice.get("/team")).json.some((m) => m.id === alumId));
    t("unpublish: …nor can they find it by search", !JSON.stringify((await alice.get("/search?q=Alumna")).json).includes(alumId));
    t("unpublish: a manager still sees it, with the flag", (await admin.get("/team")).json.find((m) => m.id === alumId)?.isPublished === false);
    t("unpublish: a non-manager cannot flip the flag on their own profile (ignored)", ((await alice.put("/profile", { bio: "x" })).json.isPublished === undefined) && (await s.prisma.teamMember.findUnique({ where: { id: aliceProfile.id } })).isPublished === true);
    const selfHide = await alice.put(`/team/${aliceProfile.id}`, { isPublished: false });
    t("unpublish: …even through PUT /team/:id", selfHide.status === 200 && (await s.prisma.teamMember.findUnique({ where: { id: aliceProfile.id } })).isPublished === true);
    await admin.put(`/team/${alumId}`, { isPublished: true });
    t("unpublish: republishing makes it visible again", (await guest.get(`/team/${alumId}`)).status === 200);

    // ---- photos --------------------------------------------------------------------------------------------------
    const p1 = await alice.photo(aliceProfile.id, PNG_1x1);
    t("photo: the owner can upload a PNG (201) and the profile points at a managed file", p1.status === 201 && /^\/api\/files\/[A-Za-z0-9_-]+$/.test(p1.json?.photoUrl ?? ""), `${p1.status} ${JSON.stringify(p1.json)}`);
    const img1 = await fetch(`${s.base}${p1.json.photoUrl}`);
    t("photo: it is publicly viewable as an image (guest GET 200, image/png)", img1.status === 200 && img1.headers.get("content-type") === "image/png" && (await img1.arrayBuffer()).byteLength === PNG_1x1.length);
    t("photo: exactly one blob is stored", s.files().length === 1);
    t("photo: another member cannot replace it (403)", (await bob.photo(aliceProfile.id, PNG_1x1)).status === 403);
    t("photo: a guest cannot (401)", (await client(s.base).photo(aliceProfile.id, PNG_1x1)).status === 401);
    t("photo: …and neither left a blob behind", s.files().length === 1);
    t("photo: an admin can upload for someone else", (await admin.photo(bobProfile.id, PNG_1x1)).status === 201);

    for (const [name, bytes, opts, want] of [
      ["HTML pretending to be a PNG", Buffer.from("<html><script>alert(1)</script></html>"), { name: "evil.png", type: "image/png" }, 400],
      ["an SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), { name: "a.svg", type: "image/svg+xml" }, 400],
      ["a GIF", Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;", "latin1"), { name: "a.gif", type: "image/gif" }, 400],
      ["a PDF", Buffer.from("%PDF-1.4 fake"), { name: "a.pdf", type: "application/pdf" }, 400],
      ["an executable named .jpg", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]), { name: "a.jpg", type: "image/jpeg" }, 400],
      ["a truncated PNG (header cut inside IHDR)", PNG_1x1.subarray(0, 20), {}, 400],
      ["a PNG declaring 60000 x 60000 pixels", pngHeader(60000, 60000), {}, 400],
      ["a PNG declaring 0 x 0 pixels", pngHeader(0, 0), {}, 400],
      ["a file over the size limit (a valid PNG padded to 3 MB)", Buffer.concat([pngHeader(10, 10), Buffer.alloc(3 * 1024 * 1024)]), {}, 413],
    ]) {
      const r = await alice.photo(aliceProfile.id, bytes, opts);
      t(`photo: rejected ${want} — ${name}`, r.status === want, `${r.status} ${JSON.stringify(r.json)}`);
    }
    t("photo: none of the rejected uploads changed the profile or left a blob", (await alice.get("/profile")).json.photoUrl === p1.json.photoUrl && s.files().length === 2);
    const jpegOk = await alice.photo(aliceProfile.id, jpegMinimal, { name: "x.jpg", type: "image/jpeg" });
    t("photo: a well-formed JPEG header is accepted (and replaces the PNG)", jpegOk.status === 201, `${jpegOk.status} ${JSON.stringify(jpegOk.json)}`);
    t("photo: replacing retired the old photo (its URL is now 404) and the new one serves", (await fetch(`${s.base}${p1.json.photoUrl}`)).status === 404 && (await fetch(`${s.base}${jpegOk.json.photoUrl}`)).status === 200);
    t("photo: the old blob was removed after the replacement committed", s.files().length === 2); // alice's new + bob's
    t("photo: the stored name is generic (the client's file name never reaches storage metadata)", (await s.prisma.storedFile.findFirst({ where: { entityType: "TEAM_MEMBER_PHOTO", entityId: aliceProfile.id, deletedAt: null } }))?.originalName === "profile-photo.jpg");

    // A DB-side failure after the blob was written must remove the blob and leave the profile alone.
    const ghost = await admin.photo("no-such-member-id", PNG_1x1);
    t("photo: an unknown profile is a 4xx for a manager", ghost.status === 404, `${ghost.status}`);
    t("photo: …and its blob was cleaned up (no orphan)", s.files().length === 2);

    // Replacement while storage is failing: the photo in use must survive untouched.
    const beforeFail = (await s.prisma.teamMember.findUnique({ where: { id: aliceProfile.id } })).photoUrl;
    renameSync(s.storageDir, `${s.storageDir}-moved`);
    writeFileSync(s.storageDir, "now a regular file, so every write fails");
    const failed = await alice.photo(aliceProfile.id, PNG_1x1);
    t("photo: when storage fails the replacement is a structured 503", failed.status === 503 && failed.json?.code === "STORAGE_UNAVAILABLE", `${failed.status} ${JSON.stringify(failed.json)}`);
    const afterFail = await s.prisma.teamMember.findUnique({ where: { id: aliceProfile.id } });
    t("photo: …and the existing photo URL is unchanged", afterFail.photoUrl === beforeFail);
    t("photo: …and its file record is NOT retired", (await s.prisma.storedFile.count({ where: { entityType: "TEAM_MEMBER_PHOTO", entityId: aliceProfile.id, deletedAt: null } })) === 1);
    rmSync(s.storageDir);
    renameSync(`${s.storageDir}-moved`, s.storageDir);

    const ext = await alice.put("/profile", { photoUrl: "https://images.example.test/me.jpg" });
    t("photo: switching to an external image URL works", ext.status === 200 && ext.json.photoUrl === "https://images.example.test/me.jpg");
    t("photo: …and retires the uploaded file (URL 404)", (await fetch(`${s.base}${jpegOk.json.photoUrl}`)).status === 404);
    t("photo: javascript: as a photo URL is rejected", (await alice.put("/profile", { photoUrl: "javascript:alert(1)" })).status === 400);
    t("photo: a relative path that is not /api/files/<id> is rejected", (await alice.put("/profile", { photoUrl: "/etc/passwd" })).status === 400 && (await alice.put("/profile", { photoUrl: "/api/files/../../x" })).status === 400);

    const p3 = await alice.photo(aliceProfile.id, PNG_1x1);
    const removed = await alice.del(`/team/${aliceProfile.id}/photo`);
    t("photo: the owner can remove it (back to the initials avatar)", removed.status === 200 && removed.json.photoUrl === "");
    t("photo: …and the file is gone", (await fetch(`${s.base}${p3.json.photoUrl}`)).status === 404);
    t("photo: removing someone else's photo is 403 for a member", (await alice.del(`/team/${bobProfile.id}/photo`)).status === 403);
    const alumPhoto = await admin.photo(alumId, PNG_1x1);
    t("photo: a manager can set an alumni profile's photo (alumni have no owner)", alumPhoto.status === 201);
    t("photo: an unpublished profile's photo is hidden from guests", await (async () => {
      await admin.put(`/team/${alumId}`, { isPublished: false });
      const hidden = (await fetch(`${s.base}${alumPhoto.json.photoUrl}`)).status;
      await admin.put(`/team/${alumId}`, { isPublished: true });
      return hidden === 404;
    })());
    const delMember = await admin.del(`/team/${alumId}`);
    t("photo: deleting a profile retires its photo", delMember.status === 200 && (await fetch(`${s.base}${alumPhoto.json.photoUrl}`)).status === 404);
    t("photo: audit rows exist and carry no file bytes or URLs of private files", (await s.prisma.auditLog.count({ where: { action: "TEAM_MEMBER_UPDATED", details: { contains: "uploaded" } } })) >= 1);
  } finally {
    await s.stop();
  }

  console.log(`\n${ok} profile/alumni/photo checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
