// Real-browser check of the homepage "Follow us on Facebook" section and of the REAL `useSiteConfigState` hook
// (apps/web/src/lib/siteConfig.ts) that feeds it (Phase 27 completion, item A).
//
//   node scripts/facebook-section-browser.cjs [shotDir]        (from apps/server; needs a Chromium/Edge: BROWSER_PATH)
//
// It starts its OWN disposable stack (nothing shared, nothing remote):
//   - the API on a free port against a COPY of prisma/dev.db (TURSO_*/BLOB_* cleared, FACEBOOK_PAGE_URL unset),
//   - the Vite dev server on a free port, proxying /api to that API (throw-away config in a temp dir),
//   - a headless browser driven over the DevTools protocol (Node's global WebSocket; no extra dependency).
// The browser intercepts ONLY `/api/site-config`, so each scenario controls exactly what that request does:
// held open, answered with a valid / null / invalid link, an HTTP 500, malformed JSON, or a network failure. Everything else is
// the real app. Checks are on what a visitor sees (headings, link name/target/rel, absence of links), including that the
// "not connected" notice never flashes while the configuration is still loading, and that a failed request does not break the page.
//
// Like scripts/browser-regression.cjs this is run by hand (it needs a browser); it is NOT part of `npm run test:unit`.
// BROWSER_PATH: the browser executable (default: the Windows Edge path used by browser-regression.cjs; e.g. the container's
// /opt/pw-browsers/chromium-1194/chrome-linux/chrome elsewhere).
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const SERVER_ROOT = path.resolve(__dirname, "..");
const WEB_ROOT = path.resolve(SERVER_ROOT, "..", "web");
const MODULES = path.resolve(SERVER_ROOT, "..", "..", "node_modules"); // npm workspaces hoist the tooling here (package "exports" hide these files from require.resolve)
const BROWSER = process.env.BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SHOTS = process.argv[2] || "";
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "scl-fb-browser-"));
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0;
const fails = [];
const check = (name, cond, detail = "") => {
  if (cond) pass++;
  else {
    fails.push(name + (detail ? " -- " + detail : ""));
    console.log("  FAIL", name, detail);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log("\n# " + t);

const procs = [];
function start(cmd, args, opts, logName) {
  const log = fs.openSync(path.join(OUT, logName), "a");
  const child = spawn(cmd, args, { ...opts, detached: true, stdio: ["ignore", log, log] });
  procs.push(child);
  return child;
}
function stopAll() {
  for (const p of procs) {
    try {
      process.kill(-p.pid, "SIGKILL"); // the whole group: tsx and vite start children of their own
    } catch {
      /* already gone */
    }
  }
}
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
async function waitHttp(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).status < 500) return true;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  return false;
}

async function main() {
  const dbSource = process.env.SOURCE_DB || path.join(SERVER_ROOT, "prisma", "dev.db");
  if (!fs.existsSync(dbSource)) throw new Error("no database to copy (set SOURCE_DB to a disposable SQLite file)");
  fs.copyFileSync(dbSource, path.join(OUT, "c.db"));
  const apiPort = await freePort();
  const webPort = await freePort();
  const cdpPort = await freePort();
  const WEB = `http://127.0.0.1:${webPort}`;

  const tsxCli = path.join(MODULES, "tsx", "dist", "cli.mjs");
  start(
    process.execPath,
    [tsxCli, "src/index.ts"],
    {
      cwd: SERVER_ROOT,
      env: {
        ...process.env,
        TURSO_DATABASE_URL: "",
        TURSO_AUTH_TOKEN: "",
        BLOB_READ_WRITE_TOKEN: "",
        VERCEL: "",
        FACEBOOK_PAGE_URL: "",
        PORT: String(apiPort),
        NODE_ENV: "test",
        TRUST_PROXY: "0",
        SESSION_SECRET: "fb-browser-check-secret-0000000000000000",
        DATABASE_URL: `file:${path.join(OUT, "c.db")}`,
        STORAGE_DIR: path.join(OUT, "files"),
      },
    },
    "api.log",
  );
  const viteCfg = path.join(OUT, "vite.config.mjs");
  const pluginReact = path.join(MODULES, "@vitejs", "plugin-react", "dist", "index.js");
  fs.writeFileSync(
    viteCfg,
    `import react from ${JSON.stringify(require("node:url").pathToFileURL(pluginReact).href)};
export default { root: ${JSON.stringify(WEB_ROOT)}, plugins: [react()], server: { host: "127.0.0.1", port: ${webPort}, strictPort: true, proxy: { "/api": { target: "http://127.0.0.1:${apiPort}", changeOrigin: true } } } };
`,
  );
  start(process.execPath, [path.join(MODULES, "vite", "bin", "vite.js"), "--config", viteCfg], { cwd: WEB_ROOT, env: process.env }, "web.log");
  if (!(await waitHttp(`http://127.0.0.1:${apiPort}/api/health`, 60000))) throw new Error("API did not start (see " + path.join(OUT, "api.log") + ")");
  if (!(await waitHttp(`${WEB}/`, 60000))) throw new Error("Vite did not start (see " + path.join(OUT, "web.log") + ")");

  start(
    BROWSER,
    ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${path.join(OUT, "profile")}`, "about:blank"],
    { env: process.env },
    "browser.log",
  );
  if (!(await waitHttp(`http://127.0.0.1:${cdpPort}/json/version`, 30000))) throw new Error("browser did not start (BROWSER_PATH?)");
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("page script failed: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expression, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await evalJs(expression)) return true;
      await sleep(100);
    }
    return false;
  };

  // ---- what the intercepted /api/site-config request does, per scenario ----
  let mode = { kind: "ok", body: { portalUrl: null, facebookPageUrl: null } };
  let held = null;
  const requestsSeen = [];
  const pageErrors = [];
  const fulfill = (requestId, status, body, raw) =>
    send("Fetch.fulfillRequest", {
      requestId,
      responseCode: status,
      responseHeaders: [{ name: "content-type", value: "application/json" }],
      body: Buffer.from(raw !== undefined ? raw : JSON.stringify(body)).toString("base64"),
    });
  listeners.push((msg) => {
    if (msg.method === "Runtime.exceptionThrown") pageErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method !== "Fetch.requestPaused") return;
    const { requestId } = msg.params;
    requestsSeen.push(mode.kind);
    if (mode.kind === "hold") held = requestId;
    else if (mode.kind === "ok") fulfill(requestId, 200, mode.body).catch(() => {});
    else if (mode.kind === "http500") fulfill(requestId, 500, { error: "boom" }).catch(() => {});
    else if (mode.kind === "badjson") fulfill(requestId, 200, null, "<html>not json").catch(() => {});
    else if (mode.kind === "fail") send("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => {});
    else send("Fetch.continueRequest", { requestId }).catch(() => {});
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/site-config*" }] });
  // Record every distinct state the Facebook section is ever seen in (so a brief flash cannot go unnoticed).
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__fbSeen = [];
new MutationObserver(() => {
  const s = document.querySelector('section[aria-labelledby="home-facebook"]');
  const h = s && s.querySelector('h2') ? s.querySelector('h2').textContent : null;
  if (h !== null && window.__fbSeen[window.__fbSeen.length - 1] !== h) window.__fbSeen.push(h);
}).observe(document, { childList: true, subtree: true, characterData: true });`,
  });

  const SECTION_JS = `(() => {
    const s = document.querySelector('section[aria-labelledby="home-facebook"]');
    if (!s) return null;
    const a = s.querySelector('a');
    return { heading: s.querySelector('h2') ? s.querySelector('h2').textContent : null, links: s.querySelectorAll('a').length,
      link: a ? { href: a.getAttribute('href'), target: a.target, rel: a.rel, text: a.textContent.trim(), srText: (a.querySelector('.sr-only') || {}).textContent || '', iconHidden: !!a.querySelector('svg[aria-hidden="true"]') } : null };
  })()`;
  const PAGE_FB_LINKS = `document.querySelectorAll('a[href*="facebook"]').length`;
  const homeRendered = `!!document.getElementById('home-cta') && !!document.querySelector('h1')`;

  async function load({ locale = "en", width = 1280 } = {}) {
    held = null;
    pageErrors.length = 0;
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    // The locale is a stored preference (scl.locale): set it on the app's origin, then load the page fresh.
    const prev = mode;
    mode = { kind: "continue" };
    await send("Page.navigate", { url: `${WEB}/robots-placeholder-for-origin` });
    await sleep(500);
    await evalJs(`localStorage.setItem('scl.locale', ${JSON.stringify(locale)})`);
    mode = prev;
    await send("Page.navigate", { url: `${WEB}/` });
    return waitFor(homeRendered, 30000);
  }
  async function shot(name) {
    if (!SHOTS) return;
    const rect = await evalJs(`(() => { const s = document.querySelector('section[aria-labelledby="home-facebook"]'); if (!s) return null; const r = s.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 24, w: innerWidth, h: r.height + 48 }; })()`);
    if (!rect) return;
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: rect.x, y: Math.max(0, rect.y), width: rect.w, height: rect.h, scale: 1 } });
    fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.data, "base64"));
  }

  const PAGE_URL = "https://www.facebook.com/SmartComputingLab";
  const EN = { title: "Follow us on Facebook", action: "Open our Facebook Page", off: "Facebook updates are not connected yet", sr: "(opens in a new tab)" };
  const JA = { title: "Facebook で最新情報をチェック", action: "Facebook ページを開く", off: "Facebook の更新はまだ連携されていません", sr: "（新しいタブで開きます）" };

  // 1. loading: the request is held open -> nothing about Facebook may be shown, then the real answer arrives
  section("loading, then a valid link");
  mode = { kind: "hold" };
  check("homepage renders while the configuration is still pending", await load());
  await sleep(1200);
  check("the request is being held", held !== null);
  check("while loading: no Facebook section at all (no flash of 'not connected')", (await evalJs(SECTION_JS)) === null);
  check("while loading: no Facebook link anywhere", (await evalJs(PAGE_FB_LINKS)) === 0);
  await fulfill(held, 200, { portalUrl: null, facebookPageUrl: PAGE_URL });
  check("after the answer: the section appears", await waitFor(`!!document.querySelector('section[aria-labelledby="home-facebook"]')`, 10000));
  let s = await evalJs(SECTION_JS);
  check("configured: heading", s && s.heading === EN.title, JSON.stringify(s));
  check("configured: link to exactly the Page", s && s.link && s.link.href === PAGE_URL, JSON.stringify(s));
  check("configured: opens in a new tab, safely", s && s.link && s.link.target === "_blank" && /\bnoopener\b/.test(s.link.rel) && /\bnoreferrer\b/.test(s.link.rel), JSON.stringify(s));
  check("configured: accessible name says it opens a new tab", s && s.link && s.link.text.includes(EN.action) && s.link.srText.includes(EN.sr), JSON.stringify(s));
  check("configured: decorative icon is hidden from assistive technology", s && s.link && s.link.iconHidden);
  check("never showed the 'not connected' notice at any point", JSON.stringify(await evalJs("window.__fbSeen")) === JSON.stringify([EN.title]), JSON.stringify(await evalJs("window.__fbSeen")));
  await shot("configured-desktop-en");

  // 2. a valid answer straight away
  section("configured (immediate answer)");
  mode = { kind: "ok", body: { portalUrl: null, facebookPageUrl: PAGE_URL } };
  await load();
  await waitFor(`!!document.querySelector('section[aria-labelledby="home-facebook"]')`);
  s = await evalJs(SECTION_JS);
  check("configured: link rendered", s && s.link && s.link.href === PAGE_URL && s.heading === EN.title, JSON.stringify(s));
  check("configured: first thing ever shown is the configured state", JSON.stringify(await evalJs("window.__fbSeen")) === JSON.stringify([EN.title]));

  // 3. not configured / invalid / unsafe values -> the honest notice and no link
  section("not configured, invalid or unsafe values");
  for (const [label, value] of [
    ["null", null],
    ["missing field", undefined],
    ["http", "http://www.facebook.com/SmartComputingLab"],
    ["look-alike host", "https://facebook.com.evil.test/SmartComputingLab"],
    ["javascript:", "javascript:alert(1)"],
    ["login endpoint", "https://www.facebook.com/login.php"],
    ["encoded login endpoint", "https://www.facebook.com/%6Cogin.php"],
    ["a number", 42],
  ]) {
    mode = { kind: "ok", body: value === undefined ? { portalUrl: null } : { portalUrl: null, facebookPageUrl: value } };
    await load();
    await waitFor(`!!document.querySelector('section[aria-labelledby="home-facebook"]')`);
    s = await evalJs(SECTION_JS);
    check(`${label}: honest notice`, s && s.heading === EN.off && s.links === 0, JSON.stringify(s));
    check(`${label}: no Facebook link anywhere on the page`, (await evalJs(PAGE_FB_LINKS)) === 0);
  }
  await shot("unavailable-desktop-en");

  // 4. failures of the configuration request itself: the homepage must survive and show the documented fallback
  section("failed configuration requests");
  for (const kind of ["fail", "http500", "badjson"]) {
    mode = { kind };
    check(`${kind}: homepage still renders`, await load());
    await waitFor(`!!document.querySelector('section[aria-labelledby="home-facebook"]')`, 10000);
    s = await evalJs(SECTION_JS);
    check(`${kind}: falls back to the notice, with no link`, s && s.heading === EN.off && s.links === 0, JSON.stringify(s));
    check(`${kind}: no Facebook link anywhere on the page`, (await evalJs(PAGE_FB_LINKS)) === 0);
    check(`${kind}: the contact section below it still renders`, await evalJs(`!!document.getElementById('home-cta')`));
    check(`${kind}: no uncaught page error`, pageErrors.length === 0, pageErrors.join(" | "));
  }

  // 5. Japanese
  section("Japanese locale");
  mode = { kind: "ok", body: { portalUrl: null, facebookPageUrl: PAGE_URL } };
  await load({ locale: "ja" });
  await waitFor(`!!document.querySelector('section[aria-labelledby="home-facebook"]')`);
  s = await evalJs(SECTION_JS);
  check("ja configured: heading and link text are Japanese", s && s.heading === JA.title && s.link && s.link.text.includes(JA.action) && s.link.srText.includes(JA.sr), JSON.stringify(s));
  check("ja configured: link target unchanged", s && s.link && s.link.href === PAGE_URL && s.link.target === "_blank");
  await shot("configured-desktop-ja");
  mode = { kind: "ok", body: { portalUrl: null, facebookPageUrl: null } };
  await load({ locale: "ja" });
  await waitFor(`!!document.querySelector('section[aria-labelledby="home-facebook"]')`);
  s = await evalJs(SECTION_JS);
  check("ja unavailable: notice is Japanese, no link", s && s.heading === JA.off && s.links === 0, JSON.stringify(s));

  // 6. mobile layout
  section("mobile (390px)");
  for (const [label, body, want] of [
    ["configured", { portalUrl: null, facebookPageUrl: PAGE_URL }, EN.title],
    ["unavailable", { portalUrl: null, facebookPageUrl: null }, EN.off],
  ]) {
    mode = { kind: "ok", body };
    await load({ width: 390 });
    await waitFor(`!!document.querySelector('section[aria-labelledby="home-facebook"]')`);
    s = await evalJs(SECTION_JS);
    check(`mobile ${label}: section shown`, s && s.heading === want, JSON.stringify(s));
    check(`mobile ${label}: no horizontal overflow`, await evalJs(`document.documentElement.scrollWidth <= innerWidth + 1`), String(await evalJs(`document.documentElement.scrollWidth + ' > ' + innerWidth`)));
    if (label === "configured") {
      const r = await evalJs(`(() => { const a = document.querySelector('section[aria-labelledby="home-facebook"] a'); const b = a.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width, height: b.height, inner: innerWidth }; })()`);
      check("mobile configured: the link is fully inside the viewport and large enough to tap", r.left >= 0 && r.right <= r.inner && r.height >= 36, JSON.stringify(r));
    }
    await shot(`${label}-mobile-en`);
  }
  check("the site-config request was observed in every scenario", requestsSeen.length >= 20, String(requestsSeen.length));
  ws.close();
}

main()
  .catch((e) => {
    console.error("Script crashed:", e && e.stack ? e.stack : e);
    fails.push("script crashed: " + (e && e.message));
  })
  .finally(() => {
    stopAll();
    console.log(`\n${pass} facebook-section browser checks passed, ${fails.length} failed.`);
    if (fails.length) for (const f of fails) console.log("FAIL:", f);
    console.log("(scratch dir with server/browser logs: " + OUT + ")");
    process.exit(fails.length ? 1 : 0);
  });
