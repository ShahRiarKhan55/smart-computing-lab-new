/**
 * Browser test (Chromium via Playwright) for UI / accessibility defects that the Phase 26 full sweep reported and that were never fixed:
 *
 *   1. an unbroken long string (a hash, a URL, a path) must wrap inside /knowledge/:id and /resources/:id instead of overflowing, at phone
 *      and desktop widths, in English and Japanese;
 *   2. a keyboard Tab walk over those pages must never land on an element that another element visually covers;
 *   3. the administrator's people page in Japanese on a 390px phone must not overflow, and its "link profile" and "delete account" dialogs
 *      must open from a real click, fit the screen, and close with Escape.
 *
 * Local only: it builds a temporary SQLite database from the repository's migrations, starts the API on :4001 and Vite on :5173, drives
 * Chromium, then stops both and deletes the temp files. It never reads TURSO_* / DATABASE_URL and never uses a hosted database.
 *
 *   node --import tsx scripts/ui-a11y-regression.mjs        (or: npm run test:ui-a11y -w apps/server)
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

const work = fs.mkdtempSync(path.join(os.tmpdir(), "scl-ui-a11y-"));
const dbFile = path.join(work, "t.db");
{
  const c = createClient({ url: `file:${dbFile}` });
  const mig = path.join(SERVER, "prisma", "migrations");
  for (const d of fs.readdirSync(mig, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) await c.executeMultiple(fs.readFileSync(path.join(mig, d, "migration.sql"), "utf8"));
  c.close();
}
// One connection: the embedded SQLite file otherwise deadlocks under the parallel requests of a browser page (documented in the Phase 3 runbook, section 9).
const env = { ...process.env, DATABASE_URL: `file:${dbFile}?connection_limit=1`, STORAGE_DIR: path.join(work, "files"), SESSION_SECRET: "ui-a11y-secret-000000000000000000", PORT: "4001" };
delete env.BLOB_READ_WRITE_TOKEN; delete env.LAB_BLOB_READ_WRITE_TOKEN;
process.env.DATABASE_URL = env.DATABASE_URL;
const bcrypt = (await import("bcryptjs")).default;
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const PW = "Passw0rd!-test";
const hash = await bcrypt.hash(PW, 4);
const admin = await prisma.user.create({ data: { email: "admin@example.org", passwordHash: hash, role: "ADMIN" } });
await prisma.teamMember.create({ data: { name: "Admin A", initials: "AA", role: "Lab director", category: "FACULTY", department: "", bio: "", photoUrl: "", sortOrder: 0, userId: admin.id } });

for (let i = 1; i <= 4; i++) {
  const u = await prisma.user.create({ data: { email: `member${i}@example.org`, passwordHash: hash, role: "MEMBER" } });
  await prisma.teamMember.create({ data: { name: `Member ${i}`, initials: `M${i}`, role: "Researcher", category: "MSC", department: "", bio: "", photoUrl: "", sortOrder: i, userId: i % 2 ? u.id : null } });
}
await prisma.teamMember.create({ data: { name: "Unlinked Person", initials: "UP", role: "Researcher", category: "MSC", department: "", bio: "", photoUrl: "", sortOrder: 9 } });

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
async function session(email, locale = "en", viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((l) => { try { window.localStorage.setItem("scl.locale", l); } catch { /* ignore */ } }, locale);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push("pageerror " + e.message));
  if (email) { const r = await ctx.request.post(BASE + "/api/auth/login", { data: { email, password: PW } }); if (r.status() !== 200) throw new Error("login failed " + r.status()); }
  return { ctx, page };
}

// ---- page-level probes, run inside the browser ----------------------------------------------------------------------------------
/** Text that leaves its box or the viewport, and the document's horizontal overflow. Content only: the skip link and hidden nodes are ignored. */
const overflowProbe = () => {
  const vw = document.documentElement.clientWidth;
  const short = (el) => el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/)[0] : "") + '"' + (el.textContent || "").trim().slice(0, 18) + '"';
  const out = [];
  const docOver = document.documentElement.scrollWidth - vw;
  if (docOver > 1) out.push("page overflows by " + docOver + "px");
  for (const el of document.querySelectorAll("main *")) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || el.closest("[hidden], .sr-only")) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own.length) continue;
    const range = document.createRange();
    range.setStartBefore(own[0]);
    range.setEndAfter(own[own.length - 1]);
    const r = range.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    if (r.width <= 2) continue;
    // In a pre-wrap / pre-line box a space at the end of a wrapped line HANGS past the edge by design (about one space wide, invisible), which a
    // text-range measurement counts as overflow. For those boxes ask the browser whether anything is actually scrollable instead.
    const preserved = /^(pre|break-spaces)/.test(s.whiteSpace);
    const spills = preserved ? el.scrollWidth > el.clientWidth + 1 : s.display !== "inline" && (r.right > b.right + 1.5 || r.left < b.left - 1.5);
    if (spills) out.push("text spills out of its box: " + short(el));
    if (r.right > vw + 1 || r.left < -1) out.push("text beyond the viewport: " + short(el));
  }
  return [...new Set(out)];
};
/** Tab through the page; every focus stop must be visible, in view horizontally, and not visually covered by an unrelated element. */
async function tabWalk(page, max = 120) {
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); window.scrollTo(0, 0); });
  const bad = [];
  const seen = new Set();
  let stops = 0;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    // Let focus-driven smooth scrolling and the header's dropdown transition finish before measuring (the browser sweep settles the same way).
    for (let k = 0, last = "", same = 0; k < 40 && same < 3; k++) {
      const y = await page.evaluate(() => Math.round(window.scrollY) + "/" + document.documentElement.scrollHeight);
      same = y === last ? same + 1 : 0;
      last = y;
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(200);
    const info = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return { body: true };
      if (!a.__w) a.__w = ++window.__wc || (window.__wc = 1);
      const b = a.getBoundingClientRect();
      const cx = Math.min(Math.max(b.left + b.width / 2, 0), innerWidth - 1);
      const cy = Math.min(Math.max(b.top + b.height / 2, 0), innerHeight - 1);
      const top = document.elementFromPoint(cx, cy);
      const name = (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 24);
      const d = a.tagName.toLowerCase() + (typeof a.className === "string" && a.className ? "." + a.className.trim().split(/\s+/)[0] : "") + '"' + name + '"';
      const covered = !!top && top !== a && !a.contains(top) && !top.contains(a);
      const cov = covered ? top.tagName.toLowerCase() + (typeof top.className === "string" && top.className ? "." + top.className.trim().split(/\s+/)[0] : "") : "";
      return { id: a.__w, d, visible: b.width > 0 && b.height > 0, covered: covered && !a.classList.contains("skip-link"), cov, inView: b.left >= -1 && b.right <= innerWidth + 1 };
    });
    if (info.body) break;
    if (seen.has(info.id)) break;
    seen.add(info.id);
    stops++;
    if (!info.visible) bad.push("focus on an invisible element " + info.d);
    if (info.visible && info.covered) bad.push("focused element covered by " + info.cov + " : " + info.d);
    if (info.visible && !info.inView) bad.push("focused element off-screen horizontally " + info.d);
  }
  return { stops, bad: [...new Set(bad)] };
}

const LONG = (c, n) => c.repeat(n);
const HASH = LONG("0123456789abcdef", 24); // 384 characters, no break opportunity
const PATHY = "/very/long/unbroken/" + LONG("segment_", 40) + "end"; // underscores do not break either
try {
  // ---- fixtures: one knowledge doc and one resource whose every text field carries a long unbroken token ----
  const A = await session("admin@example.org");
  const api = (m, p, data) => A.ctx.request.fetch(BASE + "/api" + p, { method: m, data });
  const kd = await (await api("POST", "/knowledge", { title: "Knowledge " + LONG("T", 90), body: "Body start " + HASH + " middle " + PATHY + " end", visibility: "PUBLIC" })).json();
  const rs = await (await api("POST", "/resources", {
    name: "Resource " + LONG("N", 100),
    resourceType: "TOOL",
    description: "Description " + HASH + " " + PATHY,
    version: LONG("v1.2.3-", 20),
    vendor: LONG("Vendor", 25),
    identifier: HASH.slice(0, 120),
    url: "https://example.test/" + LONG("a", 200),
    environment: "Environment " + HASH + " " + PATHY,
    metadata: { platform: HASH.slice(0, 200), configuration: PATHY, requirements: HASH.slice(0, 300) },
    visibility: "PUBLIC",
  })).json();
  t("fixtures were created", !!kd.id && !!rs.id, JSON.stringify({ kd: kd.id, rs: rs.id, kdErr: kd.error, rsErr: rs.error }));
  await A.ctx.close();

  for (const locale of ["en", "ja"]) {
    for (const [label, width, height] of [["390px", 390, 844], ["1280px", 1280, 900]]) {
      const S = await session(null, locale, { width, height });
      for (const [what, url, heading] of [["knowledge", `/knowledge/${kd.id}`, "main h1"], ["resource", `/resources/${rs.id}`, "main h1"]]) {
        await S.page.goto(BASE + url);
        await S.page.locator(heading).first().waitFor();
        await S.page.waitForLoadState("networkidle");
        // The page must really show the content under test (a not-found state also has an h1 and would pass the checks below vacuously).
        t(`${what} detail, ${locale}, ${label}: the long-token content is rendered`, (await S.page.locator("main .knowledge-body").count()) >= 1 && (await S.page.locator("main").innerText()).includes("0123456789abcdef"));
        // ---- 1. long-token overflow ----
        const over = await S.page.evaluate(overflowProbe);
        t(`${what} detail, ${locale}, ${label}: a long unbroken token wraps (no overflow)`, over.length === 0, over.slice(0, 4).join(" | "));
        // ---- 2. keyboard walk ----
        const walk = await tabWalk(S.page);
        t(`${what} detail, ${locale}, ${label}: Tab walk (${walk.stops} stops) finds no covered or off-screen focus`, walk.bad.length === 0, walk.bad.slice(0, 4).join(" | "));
      }
      await S.ctx.close();
    }
  }

  // ---- 3. administrator, people page, Japanese, 390px ----
  {
    const AD = await session("admin@example.org", "ja", { width: 390, height: 844 });
    const p = AD.page;
    await p.goto(BASE + "/admin/people");
    await p.locator(".account-row").first().waitFor();
    await p.waitForLoadState("networkidle");
    const over = await p.evaluate(overflowProbe);
    t("admin people, ja, 390px: no horizontal overflow", over.length === 0, over.slice(0, 4).join(" | "));
    for (const [what, sel] of [["link-profile", ".account-row .btn--secondary"], ["delete-account", ".account-row .btn--danger:not([disabled])"]]) {
      await p.locator(sel).first().click();
      const dlg = p.locator('[role="dialog"]').first();
      await dlg.waitFor({ timeout: 4000 }).catch(() => {});
      const open = await dlg.isVisible().catch(() => false);
      t(`admin people, ja, 390px: the ${what} dialog opens from a real click`, open);
      if (open) {
        const fit = await p.evaluate(() => { const r = document.querySelector('[role="dialog"]').getBoundingClientRect(); return r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5; });
        t(`admin people, ja, 390px: the ${what} dialog fits the screen`, fit);
        await p.keyboard.press("Escape");
        t(`admin people, ja, 390px: Escape closes the ${what} dialog`, await dlg.waitFor({ state: "hidden", timeout: 3000 }).then(() => true).catch(() => false));
      }
    }
    await AD.ctx.close();
  }
} catch (e) {
  fails.push("test crashed: " + (e?.stack ?? e));
} finally {
  await browser.close().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  stopAll();
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(work, { recursive: true, force: true });
}
const realProblems = problems.filter((m) => !/Failed to load resource: (the server responded with a status of (401|403|404)|net::ERR_CERT_AUTHORITY_INVALID)/.test(m) /* the latter: external web fonts blocked in a sandbox */);
t("no unexpected console errors", realProblems.length === 0, realProblems.slice(0, 3).join(" | "));
console.log(`${pass} ui/a11y browser checks passed, ${fails.length} failed.`);
if (fails.length) { console.log("Failures:\n - " + fails.join("\n - ")); process.exit(1); }
