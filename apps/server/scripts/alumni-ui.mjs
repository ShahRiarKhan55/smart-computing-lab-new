/**
 * Browser test (Chromium via Playwright) of the Phase 3B alumni UI: the public directory, the administrator's publish /
 * unpublish controls, the category choices in the team form, the empty state, and English / Japanese. Local only: it builds a
 * temporary SQLite database from the repository's migrations, starts the API on :4001 and Vite on :5173, drives Chromium, then
 * stops both and deletes the temp files. It never reads TURSO_* / DATABASE_URL and never uses a hosted database.
 *
 *   node --import tsx scripts/alumni-ui.mjs        (or: npm run test:alumni-ui -w apps/server)
 *
 * Needs Playwright (not a repository dependency); if missing it says so and exits 2 — it does not install anything.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) { console.error("Refusing to run: Turso variables are set."); process.exit(2); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, "..");
const WEB = path.resolve(SERVER, "..", "web");
const require = createRequire(import.meta.url);
let playwright;
for (const id of ["playwright", path.join(process.env.NODE_PATH || "/opt/node22/lib/node_modules", "playwright")]) { try { playwright = require(id); break; } catch { /* next */ } }
if (!playwright) { console.error("Playwright is not installed; this browser test cannot run."); process.exit(2); }

const busy = (port) => new Promise((res) => { const s = net.connect(port, "127.0.0.1", () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
for (const port of [4001, 5173]) if (await busy(port)) { console.error(`Port ${port} is already in use; refusing to run.`); process.exit(2); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), "scl-alumni-ui-"));
const dbFile = path.join(work, "t.db");
{
  const c = createClient({ url: `file:${dbFile}` });
  const mig = path.join(SERVER, "prisma", "migrations");
  for (const d of fs.readdirSync(mig, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) await c.executeMultiple(fs.readFileSync(path.join(mig, d, "migration.sql"), "utf8"));
  c.close();
}
const env = { ...process.env, DATABASE_URL: `file:${dbFile}`, STORAGE_DIR: path.join(work, "files"), SESSION_SECRET: "alumni-ui-secret-0000000000000000", PORT: "4001" };
delete env.BLOB_READ_WRITE_TOKEN; delete env.LAB_BLOB_READ_WRITE_TOKEN;
process.env.DATABASE_URL = env.DATABASE_URL;
const bcrypt = (await import("bcryptjs")).default;
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const PW = "Passw0rd!-test";
const hash = await bcrypt.hash(PW, 4);
const mkUser = (email, role = "MEMBER") => prisma.user.create({ data: { email, passwordHash: hash, role } });
const admin = await mkUser("admin@example.org", "ADMIN");
const mgr = await mkUser("manager@example.org", "LAB_MANAGER");
const mk = (name, category, extra = {}) => prisma.teamMember.create({ data: { name, initials: name.slice(0, 2).toUpperCase(), role: "Researcher", category, department: "", bio: "", photoUrl: "", ...extra } });
await mk("Admin A", "FACULTY", { userId: admin.id });
await mk("Manager M", "FACULTY", { userId: mgr.id });
const pubAl = await mk("Published Alumna", "ALUMNI", { isPublished: true });
const hidAl = await mk("Hidden Alumnus", "ALUMNI", { isPublished: false });

const children = [];
const start = (cmd, args, cwd, e) => { const p = spawn(cmd, args, { cwd, env: e, stdio: "ignore" }); children.push(p); return p; };
const stopAll = () => { for (const p of children) { try { p.kill("SIGTERM"); } catch { /* gone */ } } };
process.on("exit", stopAll);
start(process.execPath, ["--import", "tsx", "src/index.ts"], SERVER, env);
start(process.execPath, [path.resolve(SERVER, "..", "..", "node_modules", "vite", "bin", "vite.js"), "--port", "5173", "--strictPort"], WEB, { ...process.env });
const BASE = "http://localhost:5173";
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/api/health")).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 500)); }

let pass = 0;
const fails = [];
const t = (n, c, d = "") => (c ? pass++ : fails.push(n + (d ? " :: " + d : "")));
const browser = await playwright.chromium.launch();
const problems = [];
async function session(email, locale = "en") {
  const ctx = await browser.newContext();
  await ctx.addInitScript((l) => { try { window.localStorage.setItem("scl.locale", l); } catch { /* ignore */ } }, locale);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push("pageerror " + e.message));
  if (email) { const r = await ctx.request.post(BASE + "/api/auth/login", { data: { email, password: PW } }); if (r.status() !== 200) throw new Error("login failed " + r.status()); }
  return { ctx, page };
}
const body = (p) => p.locator("body").innerText();
try {
  // ---- visitor, English ----
  const G = await session(null, "en");
  await G.page.goto(BASE + "/alumni");
  await G.page.getByRole("heading", { name: "Alumni", level: 1 }).waitFor();
  await G.page.getByText("Published Alumna").waitFor();
  let text = await body(G.page);
  t("visitor sees the published alumna", text.includes("Published Alumna"));
  t("visitor does NOT see the unpublished alumnus", !text.includes("Hidden Alumnus"));
  t("visitor sees no publish/unpublish or add controls", (await G.page.getByRole("button", { name: /Publish|Unpublish|Add alumni profile/ }).count()) === 0 && !text.includes("Not published"));
  await G.page.goto(BASE + "/team/" + hidAl.id);
  await G.page.waitForLoadState("networkidle");
  t("visitor opening the unpublished profile's URL gets the not-found state, with no name", !(await body(G.page)).includes("Hidden Alumnus"));
  await G.page.goto(BASE + "/team");
  await G.page.getByRole("link", { name: /Alumni/ }).first().waitFor();
  t("the team page links to the alumni directory", (await G.page.getByRole("link", { name: /Alumni/ }).count()) > 0);
  t("the team roster itself does not list alumni under a group", !(await body(G.page)).includes("Published Alumna"));

  // ---- visitor, Japanese ----
  const J = await session(null, "ja");
  await J.page.goto(BASE + "/alumni");
  await J.page.getByRole("heading", { name: "卒業生", level: 1 }).waitFor();
  await J.page.getByText("Published Alumna").waitFor();
  text = await body(J.page);
  t("Japanese: localized title and description", text.includes("卒業生") && text.includes("掲載に同意"));
  t("Japanese: published alumna shown, unpublished not", text.includes("Published Alumna") && !text.includes("Hidden Alumnus"));
  t("Japanese: no English UI strings leak onto the page", !/No alumni|Loading alumni|Not published/.test(text));

  // ---- lab manager: sees what the public sees, cannot create alumni ----
  const M = await session("manager@example.org");
  await M.page.goto(BASE + "/alumni");
  await M.page.getByText("Published Alumna").waitFor();
  text = await body(M.page);
  t("manager sees only published alumni, no admin controls", !text.includes("Hidden Alumnus") && (await M.page.getByRole("button", { name: /Publish|Unpublish|Add alumni profile/ }).count()) === 0);
  await M.page.goto(BASE + "/team");
  await M.page.getByRole("button", { name: "+ Add team member" }).click();
  const mgrOptions = await M.page.locator("#tm_category option").allInnerTexts();
  t("manager's team form offers no Alumni category", mgrOptions.length > 0 && !mgrOptions.some((o) => /Alumni/.test(o)), mgrOptions.join(","));

  // ---- administrator ----
  const A = await session("admin@example.org");
  const p = A.page;
  await p.goto(BASE + "/alumni");
  await p.getByText("Hidden Alumnus").waitFor();
  text = await body(p);
  t("admin sees both alumni and the consent explanation", text.includes("Published Alumna") && text.includes("Hidden Alumnus") && text.includes("Only publish a profile when the person has agreed to be listed"));
  t("admin sees Published / Not published badges", text.includes("Published") && text.includes("Not published"));
  const hiddenCard = p.locator("article", { hasText: "Hidden Alumnus" });
  t("the unpublished card says only administrators can see it", (await hiddenCard.innerText()).includes("Only administrators can see this profile."));
  // Publish: declining the confirmation changes nothing.
  p.once("dialog", (d) => d.dismiss());
  await hiddenCard.getByRole("button", { name: /^Publish: Hidden Alumnus/ }).click();
  t("declining the confirmation leaves it unpublished", (await prisma.teamMember.findUnique({ where: { id: hidAl.id } })).isPublished === false);
  // Accepting publishes.
  let dialogText = "";
  p.once("dialog", (d) => { dialogText = d.message(); d.accept(); });
  await hiddenCard.getByRole("button", { name: /^Publish: Hidden Alumnus/ }).click();
  await p.waitForFunction(() => document.body.innerText.includes("Unpublish"), null, { timeout: 8000 });
  t("the confirmation names the person and the consent condition", dialogText.includes("Hidden Alumnus") && /agreed to be listed/.test(dialogText));
  t("publishing sets the flag in the database", (await prisma.teamMember.findUnique({ where: { id: hidAl.id } })).isPublished === true);
  await G.page.goto(BASE + "/alumni");
  await G.page.getByText("Hidden Alumnus").waitFor();
  t("the visitor now sees the newly published alumnus", true);
  // Unpublish again.
  p.once("dialog", (d) => d.accept());
  await p.locator("article", { hasText: "Hidden Alumnus" }).getByRole("button", { name: /^Unpublish: Hidden Alumnus/ }).click();
  await p.waitForFunction(() => document.body.innerText.includes("Not published"), null, { timeout: 8000 });
  t("unpublishing sets the flag back", (await prisma.teamMember.findUnique({ where: { id: hidAl.id } })).isPublished === false);
  // Add an alumni profile: the form is preset to Alumni and creates it UNPUBLISHED.
  await p.getByRole("button", { name: "+ Add alumni profile" }).click();
  t("add-alumni form is preset to the Alumni category", (await p.locator("#tm_category").inputValue()) === "ALUMNI");
  t("the form explains that alumni are created unpublished", (await body(p)).includes("created unpublished"));
  const adminOptions = await p.locator("#tm_category option").allInnerTexts();
  t("the admin's category list includes Alumni", adminOptions.some((o) => /Alumni/.test(o)));
  await p.fill("#tm_name", "Brand New Alumnus");
  await p.fill("#tm_initials", "BN");
  await p.fill("#tm_role", "Former MSc student");
  await p.getByRole("button", { name: /^(Save|Create|Add)/ }).last().click();
  await p.getByText("Brand New Alumnus").waitFor({ timeout: 8000 });
  const created = await prisma.teamMember.findFirst({ where: { name: "Brand New Alumnus" } });
  t("the new alumnus exists, is an alumnus and is unpublished", created?.category === "ALUMNI" && created.isPublished === false);
  await G.page.goto(BASE + "/alumni");
  await G.page.getByText("Published Alumna").waitFor();
  t("...and the visitor does not see it", !(await body(G.page)).includes("Brand New Alumnus"));
  // Japanese admin controls
  const AJ = await session("admin@example.org", "ja");
  await AJ.page.goto(BASE + "/alumni");
  await AJ.page.getByRole("button", { name: /公開する|非公開にする/ }).first().waitFor();
  const jaText = await body(AJ.page);
  t("Japanese admin view: badges and note localized", jaText.includes("未公開") && jaText.includes("公開中") && jaText.includes("管理者のみ"));

  // ---- empty state ----
  await prisma.teamMember.deleteMany({ where: { category: "ALUMNI" } });
  await G.page.goto(BASE + "/alumni");
  await G.page.getByText("No alumni are listed yet.").waitFor();
  t("no published alumni: friendly empty state", true);
  await J.page.goto(BASE + "/alumni");
  await J.page.getByText("掲載中の卒業生はまだいません。").waitFor();
  t("no published alumni (Japanese): friendly empty state", true);
} catch (e) {
  fails.push("test crashed: " + (e?.stack ?? e));
} finally {
  await browser.close().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  stopAll();
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(work, { recursive: true, force: true });
}
const realProblems = problems.filter((m) => !/Failed to load resource: (the server responded with a status of (401|403|404)|net::ERR_CERT_AUTHORITY_INVALID)/.test(m) /* the latter: external web fonts blocked by the sandbox proxy */);
t("no unexpected console errors", realProblems.length === 0, realProblems.slice(0, 3).join(" | "));
console.log(`${pass} alumni browser checks passed, ${fails.length} failed.`);
if (fails.length) { console.log("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
