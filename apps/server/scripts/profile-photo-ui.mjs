/**
 * Browser test (Chromium via Playwright) of the profile-photo UI: the own-profile uploader and the manager/owner edit modal.
 * Self-contained and local only: it builds a temporary SQLite database from the repository's migrations, starts the API on
 * 127.0.0.1:4001 and the Vite dev server on :5173 (the web app proxies /api to 4001), drives Chromium, then stops both and
 * deletes the temp files. It never reads TURSO_* / DATABASE_URL from the environment and never uses a hosted database.
 *
 *   node --import tsx scripts/profile-photo-ui.mjs        (or: npm run test:profile-photo-ui -w apps/server)
 *
 * Needs Playwright (not a repository dependency): `require("playwright")`, or the globally installed copy. If it is missing the
 * script says so and exits 2 — it does not install anything.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) {
  console.error("Refusing to run: Turso variables are set.");
  process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, "..");
const WEB = path.resolve(SERVER, "..", "web");
const require = createRequire(import.meta.url);
let playwright;
for (const id of ["playwright", path.join(process.env.NODE_PATH || "/opt/node22/lib/node_modules", "playwright")]) {
  try { playwright = require(id); break; } catch { /* try the next */ }
}
if (!playwright) { console.error("Playwright is not installed; this browser test cannot run."); process.exit(2); }
const F = await import("./imageFixtures.ts");

const busy = (port) => new Promise((res) => { const s = net.connect(port, "127.0.0.1", () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
for (const port of [4001, 5173]) if (await busy(port)) { console.error(`Port ${port} is already in use; refusing to run.`); process.exit(2); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), "scl-photo-ui-"));
const dbFile = path.join(work, "t.db");
{
  const c = createClient({ url: `file:${dbFile}` });
  const mig = path.join(SERVER, "prisma", "migrations");
  for (const d of fs.readdirSync(mig, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) await c.executeMultiple(fs.readFileSync(path.join(mig, d, "migration.sql"), "utf8"));
  c.close();
}
const env = { ...process.env, DATABASE_URL: `file:${dbFile}`, STORAGE_DIR: path.join(work, "files"), SESSION_SECRET: "profile-photo-ui-secret-000000000000", PORT: "4001" };
delete env.BLOB_READ_WRITE_TOKEN; delete env.LAB_BLOB_READ_WRITE_TOKEN;

// Seed through the application's own client against the temp database.
process.env.DATABASE_URL = env.DATABASE_URL;
const bcrypt = (await import("bcryptjs")).default;
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const PW = "Passw0rd!-test";
const hash = await bcrypt.hash(PW, 4);
const mkUser = (email, role = "MEMBER") => prisma.user.create({ data: { email, passwordHash: hash, role } });
const alice = await mkUser("alice@example.org");
const bob = await mkUser("bob@example.org");
const mgr = await mkUser("manager@example.org", "LAB_MANAGER");
const mk = (name, userId) => prisma.teamMember.create({ data: { name, initials: name.slice(0, 2).toUpperCase(), role: "Researcher", category: "MSC", userId, photoUrl: "", department: "D", bio: "B" } });
const aliceM = await mk("Alice A", alice.id);
const bobM = await mk("Bob B", bob.id);
await mk("Manager M", mgr.id);

const children = [];
const start = (cmd, args, cwd, e) => { const p = spawn(cmd, args, { cwd, env: e, stdio: "ignore" }); children.push(p); return p; };
const stopAll = () => { for (const p of children) { try { p.kill("SIGTERM"); } catch { /* already gone */ } } };
process.on("exit", stopAll);
start(process.execPath, ["--import", "tsx", "src/index.ts"], SERVER, env);
start(process.execPath, [path.resolve(SERVER, "..", "..", "node_modules", "vite", "bin", "vite.js"), "--port", "5173", "--strictPort"], WEB, { ...process.env });
const BASE = "http://localhost:5173";
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/api/health")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)); }

let pass = 0;
const fails = [];
const t = (n, c, d = "") => (c ? pass++ : fails.push(n + (d ? " :: " + d : "")));
const browser = await playwright.chromium.launch();
const problems = [];
async function session(email, locale = "en") {
  const ctx = await browser.newContext();
  await ctx.addInitScript((l) => { try { window.localStorage.setItem("scl.locale", l); } catch { /* ignore */ } }, locale);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push("pageerror " + e.message));
  const r = await ctx.request.post(BASE + "/api/auth/login", { data: { email, password: PW } });
  if (r.status() !== 200) throw new Error("login failed " + r.status());
  return { ctx, page };
}
const jpeg = F.jpegWithEverything(6);
const rowOf = (url) => prisma.storedFile.findUnique({ where: { id: url.split("/").pop() } });
try {
  // ============ own profile (Alice) ============
  const A = await session("alice@example.org");
  const p = A.page;
  await p.goto(BASE + "/profile");
  await p.waitForSelector("#f_photoFile", { state: "attached" });
  const choose = (name, type, buffer) => p.setInputFiles("#f_photoFile", { name, mimeType: type, buffer });
  const uploadBtn = p.getByRole("button", { name: "Upload photo" });

  await choose("x.txt", "text/plain", Buffer.from("hello"));
  t("wrong type: localized alert, no upload button", /JPEG, PNG, WebP or GIF/.test(await p.getByRole("alert").first().innerText()) && (await uploadBtn.count()) === 0);
  await choose("big.png", "image/png", Buffer.alloc(5 * 1024 * 1024 + 1));
  t("oversize: alert mentions 5 MB", /5 MB/.test(await p.getByRole("alert").first().innerText()));

  await choose("me.jpg", "image/jpeg", jpeg);
  await uploadBtn.waitFor();
  await p.route("**/api/profile/photo", async (route) => { await new Promise((r) => setTimeout(r, 600)); await route.continue(); });
  let posts = 0;
  p.on("request", (rq) => { if (rq.url().endsWith("/api/profile/photo") && rq.method() === "POST") posts++; });
  await uploadBtn.click();
  const busyBtn = p.getByRole("button", { name: "Uploading…" });
  t("while an upload is in flight the external-URL field is disabled (a typed URL can neither be lost nor race the upload)", await p.locator("#f_photoUrl").isDisabled());
  t("busy state: aria-busy and disabled", (await busyBtn.getAttribute("aria-busy")) === "true" && (await busyBtn.isDisabled()));
  await busyBtn.click({ force: true, timeout: 400 }).catch(() => {});
  await p.getByRole("status").filter({ hasText: "Profile photo updated." }).waitFor();
  await p.unroute("**/api/profile/photo");
  t("one POST despite a second click", posts === 1, String(posts));
  t("…and the URL field is editable again afterwards", !(await p.locator("#f_photoUrl").isDisabled()));
  const mine = await (await A.ctx.request.get(BASE + "/api/profile")).json();
  t("the displayed photo is the stored file", (await p.locator(".photo-upload img").first().getAttribute("src")) === mine.photoUrl && /^\/api\/files\//.test(mine.photoUrl));
  const served = Buffer.from(await (await A.ctx.request.get(BASE + mine.photoUrl)).body());
  t("the served bytes carry no sentinel from a known metadata container (EXIF/XMP/IPTC/comment/trailer)", !F.ALL_SENTINEL_STRINGS.some((s) => served.includes(Buffer.from(s, "latin1"))));

  // the raw storage path is never presented as a photo URL
  t("the URL field is empty while an uploaded photo is in use", (await p.inputValue("#f_photoUrl")) === "");
  t("…and explains why", await p.getByText("Your uploaded photo is in use.").isVisible());
  t("…no input on the page shows /api/files/", !(await p.$$eval("input, textarea", (els) => els.some((e) => String(e.value).includes("/api/files/")))));

  // upload vs unsaved URL: disabled with an accessible explanation; nothing is overwritten
  await p.fill("#f_photoUrl", "https://photos.example.org/draft.png");
  t("pending URL edit: the file input is disabled", await p.locator("#f_photoFile").isDisabled());
  t("…the visible control is a focusable button that is aria-disabled and described by the explanation (not an aria-disabled label)", (await p.locator("#photo_choose").getAttribute("aria-disabled")) === "true" && /photo_blocked/.test((await p.locator("#photo_choose").getAttribute("aria-describedby")) ?? "") && (await p.locator("label[for=f_photoFile]").count()) === 0);
  t("…the previous success notice is hidden as soon as the conflicting edit starts", (await p.getByRole("status").filter({ hasText: "Profile photo updated." }).count()) === 0);
  let chooserOpened = false;
  p.once("filechooser", () => { chooserOpened = true; });
  await p.click("#photo_choose", { force: true }); // Playwright treats aria-disabled as not actionable; force the click a user could make
  await p.waitForTimeout(300);
  t("…activating the blocked button does not open a file chooser", !chooserOpened);
  t("…the explanation is visible and referenced by the Choose and Remove controls", (await p.locator("#photo_blocked").isVisible()) && /photo_blocked/.test((await p.locator("#photo_choose").getAttribute("aria-describedby")) ?? "") && /photo_blocked/.test((await p.getByRole("button", { name: "Remove photo" }).getAttribute("aria-describedby")) ?? ""));
  t("…the Remove button is disabled too", await p.getByRole("button", { name: "Remove photo" }).isDisabled());
  t("…the draft URL is untouched", (await p.inputValue("#f_photoUrl")) === "https://photos.example.org/draft.png");
  await p.fill("#f_photoUrl", "");
  t("clearing the draft re-enables uploading (the field is back to its saved state)", !(await p.locator("#f_photoFile").isDisabled()) && (await p.locator("#photo_blocked").count()) === 0 && (await p.locator("#photo_choose").getAttribute("aria-disabled")) === "false");
  const [chooser] = await Promise.all([p.waitForEvent("filechooser", { timeout: 3000 }).catch(() => null), p.click("#photo_choose")]);
  t("…and the button opens the file chooser again", chooser !== null);

  // failed upload keeps the photo, the unsaved text and the selected file
  await p.fill("#f_bio", "Unsaved bio text");
  await choose("a.gif", "image/gif", F.gifFile({ frames: 2 }));
  await uploadBtn.click();
  await p.getByRole("alert").filter({ hasText: "still image" }).waitFor();
  t("failed upload: photo unchanged", (await (await A.ctx.request.get(BASE + "/api/profile")).json()).photoUrl === mine.photoUrl);
  t("failed upload: unsaved form text preserved", (await p.inputValue("#f_bio")) === "Unsaved bio text");
  t("failed upload: the chosen file stays selected so the user can cancel or retry", await p.getByText("Selected: a.gif").isVisible());
  await choose("bad.png", "image/png", Buffer.concat([F.pngFile(), Buffer.from("trailing")]));
  await uploadBtn.click();
  t("an unlisted structural rejection shows ONE localized actionable message (not raw server text)", /could not be used/.test(await p.getByRole("alert").first().innerText()));

  // text save keeps the photo and sends no photoUrl
  const bodies = [];
  p.on("request", (rq) => { if (rq.method() === "PUT" && rq.url().endsWith("/api/profile")) bodies.push(rq.postData() ?? ""); });
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.getByText("Profile updated.").waitFor();
  t("a text save succeeds, keeps the photo and does not send photoUrl", (await (await A.ctx.request.get(BASE + "/api/profile")).json()).photoUrl === mine.photoUrl && bodies.length === 1 && !/photoUrl/.test(bodies[0]), bodies.join("|"));

  // remove photo (the pending selection is cancelled first; the Remove button is only offered when no file is selected)
  await p.getByRole("button", { name: "Cancel" }).click();
  await p.getByRole("button", { name: "Remove photo" }).click();
  await p.getByRole("status").filter({ hasText: "Profile photo removed." }).waitFor();
  const old = await rowOf(mine.photoUrl);
  t("remove: the member has no photo and the old file is retired and unreachable", (await (await A.ctx.request.get(BASE + "/api/profile")).json()).photoUrl === "" && old.deletedAt !== null && (await A.ctx.request.get(BASE + mine.photoUrl)).status() === 404);
  t("remove: the Remove button is gone", (await p.getByRole("button", { name: "Remove photo" }).count()) === 0);

  // upload again, then replace by external URL via the form
  await choose("me2.jpg", "image/jpeg", jpeg);
  await uploadBtn.click();
  await p.getByRole("status").filter({ hasText: "Profile photo updated." }).waitFor();
  const second = (await (await A.ctx.request.get(BASE + "/api/profile")).json()).photoUrl;
  await p.fill("#f_photoUrl", "https://photos.example.org/ext.png");
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.getByText("Profile updated.").waitFor();
  t("replacing an uploaded photo with an external URL retires the uploaded file", (await rowOf(second)).deletedAt !== null && (await p.inputValue("#f_photoUrl")) === "https://photos.example.org/ext.png");

  // a text-save response that arrives AFTER a photo upload must not put the older photo back (deterministic interleaving)
  {
    await p.goto(BASE + "/profile");
    await p.waitForSelector("#f_photoFile", { state: "attached" });
    await p.fill("#f_bio", "Race bio " + Date.now());
    let release;
    const gate = new Promise((r) => { release = r; });
    let reachedServer;
    const reached = new Promise((r) => { reachedServer = r; });
    await p.route("**/api/profile", async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      const resp = await route.fetch(); // the server applies the text save now, with the OLD photo
      reachedServer();
      await gate; // ...but the browser only receives the response after the upload has finished
      await route.fulfill({ response: resp });
    });
    await p.getByRole("button", { name: "Save changes" }).click();
    await reached;
    await choose("race.jpg", "image/jpeg", jpeg);
    await uploadBtn.click();
    await p.getByRole("status").filter({ hasText: "Profile photo updated." }).waitFor();
    const uploaded = (await (await A.ctx.request.get(BASE + "/api/profile")).json()).photoUrl;
    release();
    await p.getByText("Profile updated.").waitFor();
    await p.unroute("**/api/profile");
    t("race: the server holds the uploaded photo and the saved text", /^\/api\/files\//.test(uploaded));
    t("race: the older save response did not replace the newer photo in the UI", (await p.locator(".photo-upload img").first().getAttribute("src")) === uploaded);
    t("race: the Remove button still targets the uploaded photo and the URL field stays empty", (await p.getByRole("button", { name: "Remove photo" }).count()) === 1 && (await p.inputValue("#f_photoUrl")) === "");
    t("race: the upload's success notice survives the late save response", await p.getByRole("status").filter({ hasText: "Profile photo updated." }).isVisible());
    // ...and a save notice clears photo notices only when a NEW save starts
    await p.fill("#f_bio", "Race bio 2 " + Date.now());
    await p.getByRole("button", { name: "Save changes" }).click();
    await p.getByText("Profile updated.").waitFor();
    t("a new save clears the old photo success notice", (await p.getByRole("status").filter({ hasText: "Profile photo updated." }).count()) === 0);
    // leave Alice with an external URL as the later steps expect
    await p.fill("#f_photoUrl", "https://photos.example.org/ext.png");
    await p.getByRole("button", { name: "Save changes" }).click();
    await p.getByText("Profile updated.").waitFor();
  }

  // reload persists; public page
  await p.goto(BASE + "/team/" + aliceM.id);
  await p.waitForSelector('img[src="https://photos.example.org/ext.png"]', { state: "attached" });
  t("the public member page renders the current photo URL (the app's CSP, img-src 'self' data:, blocks the external host itself — pre-existing)", true);

  // ============ Japanese ============
  const J = await session("alice@example.org", "ja");
  await J.page.goto(BASE + "/profile");
  await J.page.waitForSelector("#f_photoFile", { state: "attached" });
  await J.page.setInputFiles("#f_photoFile", { name: "a.gif", mimeType: "image/gif", buffer: F.gifFile({ frames: 2 }) });
  await J.page.getByRole("button", { name: "写真をアップロード" }).click();
  t("Japanese: animated GIF rejection is localized", /アニメーション画像/.test(await J.page.getByRole("alert").first().innerText()));
  await J.page.setInputFiles("#f_photoFile", { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
  t("Japanese: wrong-type message is localized", /JPEG、PNG、WebP、GIF/.test(await J.page.getByRole("alert").first().innerText()));
  await J.page.setInputFiles("#f_photoFile", { name: "tiny.png", mimeType: "image/png", buffer: F.pngFile({ w: 8, h: 8 }) });
  await J.page.getByRole("button", { name: "写真をアップロード" }).click();
  t("Japanese: the too-small message is localized", /小さすぎます/.test(await J.page.getByRole("alert").first().innerText()));

  // ============ manager / owner edit modal (Bob's photo) ============
  const B = await session("bob@example.org");
  const up = await B.ctx.request.post(BASE + "/api/profile/photo", { multipart: { file: { name: "b.jpg", mimeType: "image/jpeg", buffer: jpeg } } });
  const bobPhoto = (await up.json()).photoUrl;
  t("setup: bob has an uploaded photo", up.status() === 201 && /^\/api\/files\//.test(bobPhoto));
  const M = await session("manager@example.org");
  const mp = M.page;
  const putBodies = [];
  mp.on("request", (rq) => { if (rq.method() === "PUT" && rq.url().includes("/api/team/")) putBodies.push(rq.postData() ?? ""); });
  await mp.goto(BASE + "/team");
  await mp.getByRole("button", { name: "Edit Bob B" }).click();
  const modal = mp.getByRole("dialog");
  await modal.waitFor();
  t("modal: the URL field is empty for an uploaded photo and the hint is shown", (await mp.inputValue("#tm_photoUrl")) === "" && (await mp.getByText("An uploaded photo is in use for this profile.").isVisible()));
  t("modal: the hint does not claim the photo is the viewer's own (a manager may be editing someone else's profile)", (await mp.getByText("Your uploaded photo is in use.").count()) === 0);
  await mp.fill("#tm_role", "Senior Researcher");
  await mp.getByRole("button", { name: "Save", exact: true }).click();
  await mp.getByRole("dialog").waitFor({ state: "detached" });
  const afterRole = await prisma.teamMember.findUnique({ where: { id: bobM.id } });
  t("modal: editing only the role succeeds (no photo-URL error) and keeps the uploaded photo live", afterRole.role === "Senior Researcher" && afterRole.photoUrl === bobPhoto && (await rowOf(bobPhoto)).deletedAt === null && !/photoUrl/.test(putBodies[0] ?? ""), putBodies.join("|"));
  await mp.getByRole("button", { name: "Edit Bob B" }).click();
  await mp.getByRole("dialog").waitFor();
  await mp.getByRole("button", { name: "Remove photo" }).click();
  t("modal: removal is announced", await mp.getByText("The photo will be removed when you save.").isVisible());
  await mp.getByRole("button", { name: "Save", exact: true }).click();
  await mp.getByRole("dialog").waitFor({ state: "detached" });
  const cleared = await prisma.teamMember.findUnique({ where: { id: bobM.id } });
  t("modal: Remove photo + Save clears the photo and retires exactly that file", cleared.photoUrl === "" && (await rowOf(bobPhoto)).deletedAt !== null && (await mp.context().request.get(BASE + bobPhoto)).status() === 404);
  t("modal: the manager's PUT sent photoUrl only for the removal", putBodies.length === 2 && /"photoUrl":""/.test(putBodies[1]));

  // a pending removal never carries over: cancel, reopen, edit only the role -> the photo must survive
  const up2 = await B.ctx.request.post(BASE + "/api/profile/photo", { multipart: { file: { name: "b2.jpg", mimeType: "image/jpeg", buffer: jpeg } } });
  const bobPhoto2 = (await up2.json()).photoUrl;
  await mp.reload();
  await mp.getByRole("button", { name: "Edit Bob B" }).click();
  await mp.getByRole("dialog").waitFor();
  await mp.getByRole("button", { name: "Remove photo" }).click();
  await mp.getByRole("button", { name: "Cancel" }).click();
  await mp.getByRole("dialog").waitFor({ state: "detached" });
  await mp.getByRole("button", { name: "Edit Bob B" }).click();
  await mp.getByRole("dialog").waitFor();
  t("modal: after cancelling a removal, reopening shows no pending removal", (await mp.getByText("The photo will be removed when you save.").count()) === 0);
  await mp.fill("#tm_role", "Principal Researcher");
  await mp.getByRole("button", { name: "Save", exact: true }).click();
  await mp.getByRole("dialog").waitFor({ state: "detached" });
  const survived = await prisma.teamMember.findUnique({ where: { id: bobM.id } });
  t("modal: the photo survives a role-only edit after a cancelled removal", up2.status() === 201 && survived.photoUrl === bobPhoto2 && (await rowOf(bobPhoto2)).deletedAt === null);

  // a different member never sees controls for someone else's profile
  const A2 = await session("alice@example.org");
  await A2.page.goto(BASE + "/team");
  await A2.page.getByRole("heading", { name: "Alice A" }).waitFor();
  t("a member sees an edit control for their own card only", (await A2.page.getByRole("button", { name: "Edit Alice A" }).count()) === 1 && (await A2.page.getByRole("button", { name: "Edit Bob B" }).count()) === 0);
  const anon = await browser.newContext();
  const ap = await anon.newPage();
  await ap.goto(BASE + "/profile");
  await ap.waitForTimeout(1200);
  t("a signed-out visitor sees no photo control and the endpoint answers 401", (await ap.locator("#f_photoFile").count()) === 0 && (await anon.request.post(BASE + "/api/profile/photo", { multipart: { file: { name: "a.png", mimeType: "image/png", buffer: F.pngFile() } } })).status() === 401);

  const real = problems.filter((m) => !/Future Flag|ERR_CERT_AUTHORITY_INVALID|status of 4\d\d|photos\.example\.org/.test(m));
  t("no unexpected console errors or CSP violations (router future-flag warnings, sandbox cert errors and the expected 4xx rejections excluded)", real.length === 0, real.slice(0, 3).join(" | "));
} catch (e) {
  fails.push("script error: " + (e && e.message ? e.message : String(e)));
} finally {
  await browser.close().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  stopAll();
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(`${pass} profile-photo browser checks passed, ${fails.length} failed.`);
for (const f of fails) console.log(" - " + f);
process.exit(fails.length ? 1 : 0);
