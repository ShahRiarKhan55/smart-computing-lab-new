/**
 * Browser test (Chromium via Playwright) of the public publication list after the complete-list import: sections by status, status / year /
 * search filters (mouse and keyboard), every supported field on the cards and on the publication page, "Not provided" for missing values, the
 * rule that a possibly-derived year is never shown as a publication year, structured data, the Japanese UI, the admin edit form, and a 375 px
 * phone layout (no horizontal scroll). Self-contained and local only: it builds a temporary SQLite database from the repository's migrations,
 * imports the lab's list (scripts/fixtures) with the real import code, starts the API on 127.0.0.1:4001 and the Vite dev server on :5173,
 * drives Chromium, then stops both and deletes the temp files. It never reads TURSO_* / DATABASE_URL and never uses a hosted database.
 *
 *   node --import tsx scripts/publication-list-ui.mjs        (or: npm run test:publication-list-ui -w apps/server)
 *
 * Needs Playwright (not a repository dependency): `require("playwright")`, or the globally installed copy. If it is missing the script says
 * so and exits 2; it does not install anything.
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

const busy = (port) => new Promise((res) => { const s = net.connect(port, "127.0.0.1", () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
for (const port of [4001, 5173]) if (await busy(port)) { console.error(`Port ${port} is already in use; refusing to run.`); process.exit(2); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), "scl-publist-ui-"));
const dbFile = path.join(work, "t.db");
{
  const c = createClient({ url: `file:${dbFile}` });
  const mig = path.join(SERVER, "prisma", "migrations");
  for (const d of fs.readdirSync(mig, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) await c.executeMultiple(fs.readFileSync(path.join(mig, d, "migration.sql"), "utf8"));
  c.close();
}
const env = { ...process.env, DATABASE_URL: `file:${dbFile}`, STORAGE_DIR: path.join(work, "files"), SESSION_SECRET: "publication-list-ui-secret-000000", PORT: "4001" };
delete env.BLOB_READ_WRITE_TOKEN; delete env.LAB_BLOB_READ_WRITE_TOKEN;

process.env.DATABASE_URL = env.DATABASE_URL;
const bcrypt = (await import("bcryptjs")).default;
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const lib = await import("../src/lib/publicationImport/index.ts");
const { formWorkbook, loadFixtureRecords } = await import("./lib/xlsxFixture.ts");
const PW = "Passw0rd!-test";
const hash = await bcrypt.hash(PW, 4);
await prisma.user.create({ data: { email: "manager@example.org", passwordHash: hash, role: "LAB_MANAGER" } });
// One record the site already had (no status, no month): it must keep reading as "status not stated".
await prisma.publication.create({ data: { year: 2025, title: "A legacy publication", authors: "L. Gacy", venue: "Legacy Journal", doiUrl: "https://doi.org/10.9999/legacy.1" } });
const xlsx = formWorkbook(loadFixtureRecords());
const built = lib.buildPlan(xlsx, (await lib.loadExistingPublications(prisma)).rows, { records: { "8": { expectTitle: "Design of low power", year: 2017 } } });
await lib.applyPlan(prisma, built.plan, { visibility: "PUBLIC", fillEmpty: false, confirmDistinct: new Set() });
const total = await prisma.publication.count();

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
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 900 } });
  await ctx.addInitScript((l) => { try { window.localStorage.setItem("scl.locale", l); } catch { /* ignore */ } }, opts.locale ?? "en");
  const page = await ctx.newPage();
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push("pageerror " + e.message));
  if (opts.login) {
    const r = await ctx.request.post(BASE + "/api/auth/login", { data: { email: opts.login, password: PW } });
    if (r.status() !== 200) throw new Error("login failed " + r.status());
  }
  return { ctx, page };
}
const card = (page, title) => page.locator("article.pub-item", { has: page.getByRole("link", { name: title, exact: false }) }).first();
try {
  // ============ desktop, visitor ============
  const V = await open();
  const p = V.page;
  await p.goto(BASE + "/publications");
  await p.locator("article.pub-item").first().waitFor();
  t("the list shows every publication on one page", (await p.locator("article.pub-item").count()) === total, `${await p.locator("article.pub-item").count()} of ${total}`);
  const headings = await p.locator("h2.section-title").allInnerTexts();
  t("sections are headed Accepted, Under submission, Published, Status not stated, in that order", headings.length === 4 && /^Accepted, forthcoming/.test(headings[0]) && /^Under submission/.test(headings[1]) && /^Published/.test(headings[2]) && /^Status not stated/.test(headings[3]), headings.join(" | "));
  const sectionOf = async (title) => p.locator("section", { has: p.getByRole("link", { name: title, exact: false }) }).first().locator("h2.section-title").innerText();
  t("an accepted paper sits in the Accepted section, never in Published", /^Accepted/.test(await sectionOf("Explainable AI Driven")));
  t("a paper stated as under submission sits in Under submission", /^Under submission/.test(await sectionOf("Custom Adaptive Kernel")));
  t("a paper stated as published sits in Published", /^Published/.test(await sectionOf("Efficient Wafer-level Spatial Variation")));
  t("a paper with no stated status sits in 'Status not stated' (never assumed published)", /^Status not stated/.test(await sectionOf("Hierarchical Active Learning")) && /^Status not stated/.test(await sectionOf("A legacy publication")));
  const yearHeads = await p.locator("section", { has: p.locator("h2.section-title", { hasText: "Published" }) }).first().locator("h3.year-heading").allInnerTexts();
  const years = yearHeads.map((h) => Number(h.match(/\d{4}/)[0]));
  t("inside a section, years run newest first", years.length > 2 && years.every((y, i) => i === 0 || years[i - 1] > y), years.join());

  // structure and keyboard access of the list page
  t("no element id appears twice on the list page", (await p.evaluate(() => { const ids = [...document.querySelectorAll("[id]")].map((e) => e.id); return ids.length - new Set(ids).size; })) === 0);
  const levels = await p.evaluate(() => [...document.querySelectorAll("h1, h2, h3, h4")].map((h) => Number(h.tagName[1])));
  t("heading levels never skip a level on the way down (section h2 -> year h3)", levels.length > 5 && levels.every((l, i) => i === 0 || l - levels[i - 1] <= 1), levels.join(""));
  t("every year group is a labelled group", (await p.locator('[role="group"]:not([aria-labelledby])').count()) === 0);
  await p.locator("#pub_f_q").focus();
  let reached = false;
  for (let i = 0; i < 4 && !reached; i++) { await p.keyboard.press("Tab"); reached = (await p.evaluate(() => document.activeElement?.id)) === "pub_f_status"; }
  t("keyboard: the status filter is reachable by Tab from the search box", reached);
  await p.keyboard.press("ArrowDown");
  t("keyboard: the status filter changes with the arrow keys", (await p.inputValue("#pub_f_status")) !== "");
  await p.goto(BASE + "/publications");
  await p.locator("article.pub-item").first().waitFor();

  // every supported field on a card
  const c1 = card(p, "An Open-Source Evaluation Framework for RISC-V");
  const txt1 = await c1.innerText();
  t("card: title, the complete author list in the original order", /Nguyen Trung Luong, Riaz-ul-Haque Mian, Nguyen-Tran Yen-Khang/.test(txt1));
  t("card: venue and month-year date", /Signals, Aug 2026/.test(txt1), txt1);
  t("card: status badge, category", /Published/.test(txt1) && /REGULAR PAPER/.test(txt1));
  t("card: volume (with issue / article number), page range and ISSN", /Volume 7\(4\), 75/.test(txt1) && /pp\. 1–17/.test(txt1) && /ISSN 2624-6120/.test(txt1), txt1);
  const doi = c1.getByRole("link", { name: /DOI/ });
  t("card: the DOI link is a real, new-tab link", (await doi.getAttribute("href")) === "https://doi.org/10.3390/signals7040075" && (await doi.getAttribute("target")) === "_blank" && /noopener/.test((await doi.getAttribute("rel")) ?? ""));
  const c2 = card(p, "Decimal Multiplication Using Combination of Software and Hardware");
  t("card: an ISBN is shown for a conference paper", /ISBN 978-1-5386-8241-8/.test(await c2.innerText()));
  const cAcc = card(p, "Explainable AI Driven");
  const accTxt = await cAcc.innerText();
  t("an accepted paper shows its ACCEPTANCE date, not a publication year", /\(SPICSCON\), Acceptance date: Jul 29, 2026/.test(accTxt) && /Accepted/.test(accTxt) && !/\(SPICSCON\), 2026/.test(accTxt), accTxt);
  t("a paper without a DOI shows no DOI link (nothing fabricated)", (await cAcc.getByRole("link", { name: /DOI/ }).count()) === 0);
  t("no internal identifier or private note is on the page", !/cl[a-z0-9]{20,}/.test(txt1) && !/xlsx-import|duplicateOverride/.test(await p.content()));

  // filters
  const countCards = () => p.locator("article.pub-item").count();
  await p.locator("#pub_f_status").selectOption("ACCEPTED");
  await p.getByRole("button", { name: "Apply" }).click();
  await p.waitForFunction(() => new URL(location.href).searchParams.get("status") === "ACCEPTED");
  await p.locator("article.pub-item").first().waitFor();
  t("status filter: Accepted shows exactly the accepted papers (the four)", (await countCards()) === 4 && (await p.locator("h2.section-title").count()) === 0, String(await countCards()));
  t("status filter: the choice is in the URL (shareable)", new URL(p.url()).searchParams.get("status") === "ACCEPTED");
  await p.goto(BASE + "/publications?status=UNSPECIFIED");
  await p.locator("article.pub-item").first().waitFor();
  t("status filter: 'Status not stated' lists the records that state none", (await countCards()) === (await prisma.publication.count({ where: { status: "" } })));
  await p.goto(BASE + "/publications?year=2021");
  await p.locator("article.pub-item").first().waitFor();
  t("year filter", (await countCards()) === 3);
  await p.goto(BASE + "/publications?status=BOGUS");
  await p.locator("article.pub-item").first().waitFor();
  t("an invalid status in the URL is dropped with a notice, never sent to the API", (await p.getByRole("status").filter({ hasText: /ignored|filter/i }).count()) >= 1 && (await countCards()) === total);

  // search by keyboard
  await p.goto(BASE + "/publications");
  await p.locator("article.pub-item").first().waitFor();
  await p.locator("#pub_f_q").focus();
  await p.keyboard.type("nakamura");
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => new URL(location.href).searchParams.get("q") === "nakamura");
  await p.locator("article.pub-item").first().waitFor();
  t("search by author, by keyboard only: finds that author's papers", (await countCards()) === 2);
  await p.goto(BASE + "/publications?q=2624-6120");
  await p.locator("article.pub-item").first().waitFor();
  t("search by ISSN", (await countCards()) === 2);
  await p.goto(BASE + "/publications?q=qqqqzzzz");
  await p.getByText(/No publications match/i).waitFor();
  t("an empty result has a clear empty state", await p.getByText(/No publications match/i).isVisible());
  t("all filter controls have visible labels", (await p.getByLabel("Status", { exact: true }).count()) === 1 && (await p.getByLabel("Year", { exact: true }).count()) === 1);

  // publication page
  await p.goto(BASE + "/publications?q=Hierarchical+Active");
  await p.locator("article.pub-item").first().waitFor();
  await p.getByRole("link", { name: /Hierarchical Active Learning/ }).first().click();
  await p.getByRole("heading", { name: "Bibliographic details" }).waitFor();
  const dl = await p.locator("dl.pub-biblio").innerText();
  t("publication page: Bibliographic details lists every field", ["Journal / conference", "Status", "Date", "Acceptance date", "Volume / issue", "Pages", "ISSN", "ISBN", "Category", "DOI"].every((l) => dl.includes(l)));
  t("publication page: a missing value reads 'Not provided' (nothing invented)", /Status\s+Not provided/.test(dl) && /ISSN\s+Not provided/.test(dl) && /Acceptance date\s+Not provided/.test(dl) && /Volume \/ issue\s+Not provided/.test(dl), dl);
  t("publication page: supplied values are shown", /ISBN\s+979-8-3503-7903-7/.test(dl) && /Pages\s+553–567/.test(dl) && /Date\s+Oct 2024/.test(dl));
  const ld = JSON.parse(await p.locator('script[type="application/ld+json"]').first().innerText());
  t("structured data: a record with a stated date carries datePublished as YYYY-MM", ld.datePublished === "2024-10");
  await p.goto(BASE + "/publications?q=Explainable");
  await p.getByRole("link", { name: /Explainable AI Driven/ }).first().click();
  await p.getByRole("heading", { name: "Bibliographic details" }).waitFor();
  const ld2 = JSON.parse(await p.locator('script[type="application/ld+json"]').first().innerText());
  t("structured data: an ACCEPTED paper carries NO datePublished (it is not published)", !("datePublished" in ld2));
  const dl2 = await p.locator("dl.pub-biblio").innerText();
  t("publication page: for that paper the date row is not a publication date, the acceptance date is", /Date\s+Not provided/.test(dl2) && /Acceptance date\s+Jul 29, 2026/.test(dl2) && /Status\s+Accepted/.test(dl2), dl2);

  // ============ Japanese UI ============
  const J = await open({ locale: "ja" });
  await J.page.goto(BASE + "/publications");
  await J.page.locator("article.pub-item").first().waitFor();
  const jh = await J.page.locator("h2.section-title").allInnerTexts();
  t("Japanese UI: section headings and status badges are translated", jh.length === 4 && /受理済み/.test(jh[0]) && /投稿中/.test(jh[1]) && /出版済み/.test(jh[2]) && /状況の記載なし/.test(jh[3]), jh.join(" | "));
  t("Japanese UI: the status filter is labelled", (await J.page.getByLabel("状況", { exact: true }).count()) === 1);
  await J.ctx.close();

  // ============ phone layout ============
  const M = await open({ viewport: { width: 375, height: 800 } });
  const mp = M.page;
  await mp.goto(BASE + "/publications");
  await mp.locator("article.pub-item").first().waitFor();
  const overflow = await mp.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  t("phone (375 px): the list does not scroll sideways", overflow <= 1, String(overflow));
  const tooWide = await mp.evaluate(() => [...document.querySelectorAll("article.pub-item *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length);
  t("phone: no card content extends past the screen", tooWide === 0, String(tooWide));
  const filterBox = await mp.locator("#pub_f_status").boundingBox();
  t("phone: the status filter is fully on screen and tall enough to tap", !!filterBox && filterBox.x >= 0 && filterBox.x + filterBox.width <= 376 && filterBox.height >= 28, JSON.stringify(filterBox));
  await mp.getByRole("link", { name: /An Open-Source Evaluation Framework/ }).first().click();
  await mp.getByRole("heading", { name: "Bibliographic details" }).waitFor();
  t("phone: the details list is a single column and does not scroll sideways", (await mp.evaluate(() => getComputedStyle(document.querySelector("dl.pub-biblio")).gridTemplateColumns.split(" ").length)) === 1 && (await mp.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth)) <= 1);
  await M.ctx.close();

  // ============ the admin edit form ============
  const A = await open({ login: "manager@example.org" });
  const ap = A.page;
  await ap.goto(BASE + "/publications?q=Hierarchical+Active");
  await ap.locator("article.pub-item").first().waitFor();
  await ap.getByRole("button", { name: /^Edit/ }).first().click();
  await ap.locator("#pub_status").waitFor();
  const dlg = ap.getByRole("dialog");
  t("admin form: every new field is present and labelled", (await dlg.getByLabel("Status", { exact: true }).count()) === 1 && (await dlg.getByLabel(/Month/).count()) === 1 && (await dlg.getByLabel("Volume / issue").count()) === 1 && (await dlg.getByLabel("Start page").count()) === 1 && (await dlg.getByLabel("End page").count()) === 1 && (await dlg.getByLabel("ISSN").count()) === 1 && (await dlg.getByLabel("ISBN").count()) === 1 && (await dlg.getByLabel("Category").count()) === 1 && (await dlg.getByLabel("Acceptance date").count()) === 1);
  t("admin form: the stored values are prefilled", (await ap.inputValue("#pub_isbn")) === "979-8-3503-7903-7" && (await ap.inputValue("#pub_pageStart")) === "553" && (await ap.inputValue("#pub_month")) === "10" && (await ap.inputValue("#pub_status")) === "");
  await ap.fill("#pub_issn", "not-an-issn");
  await ap.getByRole("button", { name: "Save" }).click();
  await ap.getByText(/ISSN must look like/).first().waitFor();
  t("admin form: an invalid ISSN is refused with a clear message and nothing is saved", (await prisma.publication.findFirst({ where: { title: { startsWith: "Hierarchical Active" } } })).issn === "");
  await ap.fill("#pub_issn", "");
  await ap.selectOption("#pub_status", "PUBLISHED");
  await ap.getByRole("button", { name: "Save" }).click();
  await ap.waitForFunction(() => !document.querySelector("#pub_status"));
  t("admin form: a status chosen by a person is saved", (await prisma.publication.findFirst({ where: { title: { startsWith: "Hierarchical Active" } } })).status === "PUBLISHED");
  await A.ctx.close();

  const real = problems.filter((m) => !/Future Flag|ERR_CERT_AUTHORITY_INVALID|status of 4\d\d/.test(m));
  t("no unexpected console errors", real.length === 0, real.slice(0, 3).join(" | "));
} catch (e) {
  fails.push("script error: " + (e && e.message ? e.message : String(e)));
} finally {
  await browser.close().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  stopAll();
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(`${pass} publication-list browser checks passed, ${fails.length} failed.`);
for (const f of fails) console.log(" - " + f);
process.exit(fails.length ? 1 : 0);
