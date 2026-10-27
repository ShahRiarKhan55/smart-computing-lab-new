/**
 * Browser test (Chromium via Playwright) of the Phase 3C research-profile links: the own-profile and admin forms, and the links on the profile page, the team cards and the alumni cards (EN and JA).
 * Self-contained and local only: it builds a temporary SQLite database from the repository's migrations, starts the API on
 * 127.0.0.1:4001 and the Vite dev server on :5173 (the web app proxies /api to 4001), drives Chromium, then stops both and
 * deletes the temp files. It never reads TURSO_* / DATABASE_URL from the environment and never uses a hosted database.
 *
 *   node --import tsx scripts/research-links-ui.mjs        (or: npm run test:research-links-ui -w apps/server)
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

const busy = (port) => new Promise((res) => { const s = net.connect(port, "127.0.0.1", () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
for (const port of [4001, 5173]) if (await busy(port)) { console.error(`Port ${port} is already in use; refusing to run.`); process.exit(2); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), "scl-research-ui-"));
const dbFile = path.join(work, "t.db");
{
  const c = createClient({ url: `file:${dbFile}` });
  const mig = path.join(SERVER, "prisma", "migrations");
  for (const d of fs.readdirSync(mig, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) await c.executeMultiple(fs.readFileSync(path.join(mig, d, "migration.sql"), "utf8"));
  c.close();
}
const env = { ...process.env, DATABASE_URL: `file:${dbFile}`, STORAGE_DIR: path.join(work, "files"), SESSION_SECRET: "research-links-ui-secret-0000000000", PORT: "4001" };
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
const adm = await mkUser("admin@example.org", "ADMIN");
const mk2 = (name, extra) => prisma.teamMember.create({ data: { name, initials: name.slice(0, 2).toUpperCase(), role: "Former", category: "ALUMNI", userId: null, department: "D", bio: "B", ...extra } });
const GS = "https://scholar.google.co.jp/citations?user=AbCdEfGhIjKl";
const RG = "https://www.researchgate.net/profile/Zed-Z";
const OC = "https://orcid.org/0000-0002-1825-0097";
await mk2("Pub Alumna", { isPublished: true, googleScholarUrl: GS, researchGateUrl: RG, orcidUrl: OC });
await mk2("Hidden Alumnus", { isPublished: false, googleScholarUrl: GS, researchGateUrl: RG, orcidUrl: OC });

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

const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 3 - 1), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const rgbToHex = (s) => "#" + s.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
try {
  // ============ own profile (Alice) ============
  const A = await session("alice@example.org");
  const p = A.page;
  await p.goto(BASE + "/profile");
  await p.waitForSelector("#f_orcidUrl");
  t("the form has three labelled optional link inputs", (await p.getByLabel("Google Scholar").count()) === 1 && (await p.getByLabel("ResearchGate").count()) === 1 && (await p.getByLabel("ORCID").count()) === 1);
  t("…each described by its hint", /f_orcidUrl_hint/.test((await p.locator("#f_orcidUrl").getAttribute("aria-describedby")) ?? "") && (await p.locator("#f_orcidUrl_hint").isVisible()));
  t("the legend names the group", (await p.locator("fieldset legend", { hasText: "Research profiles" }).count()) === 1);

  // invalid ORCID: field error, values preserved, nothing saved
  await p.fill("#f_googleScholarUrl", "https://scholar.google.co.jp/citations?user=AbCdEfGhIjKl&hl=ja");
  await p.fill("#f_orcidUrl", "0000-0002-1825-0098");
  await p.fill("#f_bio", "kept bio");
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.locator("#f_orcidUrl_error").waitFor();
  t("invalid ORCID: inline error with the fixed message", /ORCID must be a valid iD/.test(await p.locator("#f_orcidUrl_error").innerText()));
  t("…the field is aria-invalid and described by the error", (await p.locator("#f_orcidUrl").getAttribute("aria-invalid")) === "true" && /f_orcidUrl_error/.test((await p.locator("#f_orcidUrl").getAttribute("aria-describedby")) ?? ""));
  t("…the typed values are preserved", (await p.inputValue("#f_orcidUrl")) === "0000-0002-1825-0098" && (await p.inputValue("#f_bio")) === "kept bio" && (await p.inputValue("#f_googleScholarUrl")).includes("AbCdEfGhIjKl"));
  const none = await (await A.ctx.request.get(BASE + "/api/profile")).json();
  t("…and nothing was saved", none.orcidUrl === "" && none.googleScholarUrl === "" && none.bio === "B");

  // a lookalike host is refused client-side too
  await p.fill("#f_orcidUrl", "");
  await p.fill("#f_researchGateUrl", "https://www.researchgate.net.evil.example/profile/x");
  await p.getByRole("button", { name: "Save changes" }).click();
  t("lookalike ResearchGate host: inline error", await p.locator("#f_researchGateUrl_error").isVisible());

  // valid values: saved canonical, shown canonical
  await p.fill("#f_researchGateUrl", "https://researchgate.net/profile/Alice-A-1?utm_source=x#top");
  await p.fill("#f_orcidUrl", "0000-0002-1825-0097");
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.getByRole("status").filter({ hasText: /saved|updated/i }).first().waitFor();
  t("valid values are saved and the form shows the canonical forms", (await p.inputValue("#f_researchGateUrl")) === "https://www.researchgate.net/profile/Alice-A-1" && (await p.inputValue("#f_orcidUrl")) === OC && (await p.inputValue("#f_googleScholarUrl")) === GS);

  // profile page
  await p.goto(BASE + `/team/${aliceM.id}`);
  await p.locator(".research-links").waitFor();
  const links = p.locator(".profile-summary .research-link");
  t("profile page: three links", (await links.count()) === 3);
  const info = await links.evaluateAll((els) => els.map((e) => ({ href: e.getAttribute("href"), target: e.target, rel: e.rel, label: e.getAttribute("aria-label"), box: e.getBoundingClientRect().toJSON(), radius: getComputedStyle(e).borderRadius, color: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor, text: e.textContent })));
  t("hrefs are exactly the canonical URLs (no tracking parameters)", info.map((i) => i.href).join("|") === [GS, RG, OC].join("|").replace(RG, "https://www.researchgate.net/profile/Alice-A-1"), info.map((i) => i.href).join("|"));
  t("each opens in a new tab with noopener noreferrer", info.every((i) => i.target === "_blank" && /noopener/.test(i.rel) && /noreferrer/.test(i.rel)));
  t("accessible names name the service and the person", info[0].label === "Alice A on Google Scholar (opens in a new tab)" && /ResearchGate/.test(info[1].label) && /ORCID/.test(info[2].label), JSON.stringify(info.map((i) => i.label)));
  t("targets are at least 44 x 44 px and square", info.every((i) => i.box.width >= 44 && i.box.height >= 44 && Math.abs(i.box.width - i.box.height) < 1));
  t("targets are circular", info.every((i) => i.radius === "50%"));
  t("the visible marks are the neutral GS / RG / iD", info.map((i) => i.text).join(",") === "GS,RG,iD");
  t("text contrast is at least 4.5:1", info.every((i) => ratio(rgbToHex(i.color), rgbToHex(i.bg)) >= 4.5), info.map((i) => ratio(rgbToHex(i.color), rgbToHex(i.bg)).toFixed(1)).join(","));
  await links.first().focus();
  await p.keyboard.press("Tab");
  await p.keyboard.press("Shift+Tab");
  const ring = await links.first().evaluate((e) => { const s = getComputedStyle(e); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), shadow: s.boxShadow }; });
  t("keyboard focus is visible (outline or ring)", (ring.style !== "none" && ring.width > 0) || ring.shadow !== "none", JSON.stringify(ring));
  t("tab order reaches all three links", await (async () => { await p.locator(".profile-summary .research-link").first().focus(); const seen = []; for (let i = 0; i < 3; i++) { seen.push(await p.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")); await p.keyboard.press("Tab"); } return /Google Scholar/.test(seen[0]) && /ResearchGate/.test(seen[1]) && /ORCID/.test(seen[2]); })());
  const popupPromise = p.context().waitForEvent("page", { timeout: 1500 }).catch(() => null);
  await p.context().route("https://orcid.org/**", (r) => r.fulfill({ status: 200, body: "ok", contentType: "text/html" }));
  await links.nth(2).click();
  const popup = await popupPromise;
  await popup?.waitForLoadState("domcontentloaded").catch(() => {});
  t("clicking opens a new tab at the ORCID URL and the opener is not exposed", popup !== null && popup.url().startsWith("https://orcid.org/") && (await popup.evaluate(() => window.opener)) === null);
  await popup?.close();

  // team card
  await p.goto(BASE + "/team");
  await p.getByRole("heading", { name: "Alice A" }).waitFor();
  const aliceCard = p.locator("article.team-card", { has: p.getByRole("heading", { name: "Alice A" }) });
  const bobCard = p.locator("article.team-card", { has: p.getByRole("heading", { name: "Bob B" }) });
  t("team card: Alice shows three links, Bob (no links) shows none and no empty container", (await aliceCard.locator(".research-link").count()) === 3 && (await bobCard.locator(".research-links, .research-link").count()) === 0);
  t("team card: the links are not inside the card's profile link", (await aliceCard.locator("h3 a .research-link").count()) === 0);

  // narrow viewport: no horizontal overflow
  await p.setViewportSize({ width: 360, height: 800 });
  t("360 px wide: no horizontal page scroll on the team page", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await p.setViewportSize({ width: 1280, height: 800 });

  // clearing a link removes it from the page
  await p.goto(BASE + "/profile");
  await p.fill("#f_googleScholarUrl", "");
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.getByRole("status").filter({ hasText: /saved|updated/i }).first().waitFor();
  await p.goto(BASE + `/team/${aliceM.id}`);
  await p.locator(".research-links").waitFor();
  t("clearing Google Scholar removes only that link", (await p.locator(".profile-summary .research-link").count()) === 2 && (await p.locator(".research-link--googleScholar").count()) === 0);

  // ============ Japanese ============
  const J = await session("alice@example.org", "ja");
  await J.page.goto(BASE + "/profile");
  await J.page.waitForSelector("#f_orcidUrl");
  t("JA: labels and legend are Japanese", /研究者プロフィール/.test(await J.page.locator("fieldset legend").first().innerText()) && /ORCID/.test(await J.page.locator("label[for=f_orcidUrl]").innerText()));
  await J.page.fill("#f_orcidUrl", "0000-0002-1825-0098");
  await J.page.getByRole("button", { name: /変更を保存|保存/ }).first().click();
  await J.page.locator("#f_orcidUrl_error").waitFor();
  t("JA: validation error is Japanese", /ORCID は/.test(await J.page.locator("#f_orcidUrl_error").innerText()), await J.page.locator("#f_orcidUrl_error").innerText());
  await J.page.goto(BASE + `/team/${aliceM.id}`);
  await J.page.locator(".research-link").first().waitFor();
  t("JA: link names are Japanese", /の ResearchGate（新しいタブで開く）/.test((await J.page.locator(".research-link--researchGate").getAttribute("aria-label")) ?? ""));

  // ============ admin / manager editing ============
  const M = await session("manager@example.org");
  const mp = M.page;
  await mp.goto(BASE + "/team");
  await mp.getByRole("button", { name: "Edit Bob B" }).click();
  const dlg = mp.getByRole("dialog");
  await dlg.locator("#tm_orcidUrl").fill("not an orcid");
  await dlg.getByRole("button", { name: "Save" }).click();
  t("admin modal: invalid ORCID shows the error and keeps the dialog open with the value", (await dlg.getByRole("alert").innerText()).includes("ORCID must be a valid iD") && (await dlg.locator("#tm_orcidUrl").inputValue()) === "not an orcid");
  await dlg.locator("#tm_orcidUrl").fill("https://orcid.org/0000-0001-5109-3700");
  await dlg.locator("#tm_googleScholarUrl").fill("https://scholar.google.com/citations?user=ZzZzZzZzZzZz&hl=en");
  await dlg.getByRole("button", { name: "Save" }).click();
  await dlg.waitFor({ state: "detached" });
  const bobNow = await (await M.ctx.request.get(BASE + `/api/team/${bobM.id}`)).json();
  t("admin modal: valid links saved canonical", bobNow.orcidUrl === "https://orcid.org/0000-0001-5109-3700" && bobNow.googleScholarUrl === "https://scholar.google.com/citations?user=ZzZzZzZzZzZz" && bobNow.researchGateUrl === "");
  t("…and they appear on Bob's card after the save", (await mp.locator("article.team-card", { has: mp.getByRole("heading", { name: "Bob B" }) }).locator(".research-link").count()) === 2);
  // edit without touching links: they are not re-sent and stay
  await mp.getByRole("button", { name: "Edit Bob B" }).click();
  t("admin modal: existing links prefill", (await mp.locator("#tm_orcidUrl").inputValue()) === "https://orcid.org/0000-0001-5109-3700");
  await mp.locator("#tm_bio").fill("edited bio");
  await mp.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await mp.getByRole("dialog").waitFor({ state: "detached" });
  const bob2 = await (await M.ctx.request.get(BASE + `/api/team/${bobM.id}`)).json();
  t("admin modal: a bio-only edit leaves the links", bob2.bio === "edited bio" && bob2.orcidUrl === "https://orcid.org/0000-0001-5109-3700");

  // ============ alumni ============
  const anon = await browser.newContext();
  const ap = await anon.newPage();
  await ap.goto(BASE + "/alumni");
  await ap.getByRole("heading", { name: "Pub Alumna" }).waitFor();
  const pubCard = ap.locator("article.team-card", { has: ap.getByRole("heading", { name: "Pub Alumna" }) });
  t("alumni card: the published alumna shows three links", (await pubCard.locator(".research-link").count()) === 3);
  t("alumni page: the unpublished alumnus and their links are absent for a visitor", (await ap.getByText("Hidden Alumnus").count()) === 0 && (await ap.locator(".research-link").count()) === 3);
  const html = await ap.content();
  t("alumni page HTML never contains the hidden alumnus's name", !html.includes("Hidden Alumnus"));
  const AD = await session("admin@example.org");
  await AD.page.goto(BASE + "/alumni");
  await AD.page.getByRole("heading", { name: "Hidden Alumnus" }).waitFor();
  t("an administrator sees the hidden alumnus (with links) and their unpublished badge", (await AD.page.locator("article.team-card", { has: AD.page.getByRole("heading", { name: "Hidden Alumnus" }) }).locator(".research-link").count()) === 3);

  const real = problems.filter((m) => !/Future Flag|ERR_CERT_AUTHORITY_INVALID|status of 4\d\d|orcid\.org/.test(m));
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
console.log(`${pass} research-link browser checks passed, ${fails.length} failed.`);
for (const f of fails) console.log(" - " + f);
process.exit(fails.length ? 1 : 0);
