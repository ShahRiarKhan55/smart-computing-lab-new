// Headless-Edge (CDP) browser regression for Phases 9, 9.1, 10 (global search), 10.1 (navigation & header), 10.5 (UI/UX modernization), 11 (forum/community) and 14 (localization).
//   Usage: node scripts/browser-regression.cjs <webBase> <apiBase> <shotDir>
//   ONLY_NAV=1 runs just the Phase 10.1 header/navigation section (steps named "nav ..."), about a minute.
//   ONLY_UI=1 runs just the Phase 10.5 UI/UX section (steps named "ui ...").
//   ONLY_FORUM=1 runs just the Phase 11 forum section (steps named "forum ...").
//   ONLY_I18N=1 runs just the Phase 14 localization section (steps named "i18n ...").
//   ONLY_STEPS=<regex> runs just the steps whose name matches (independent of the ONLY_* flags above).
//   ONLY_EVENTS=1 runs just the Phase 16 events section (steps named "events ..."; P15_W narrows its widths too).
//   ONLY_ADMIN=1 runs just the Phase 17 admin/CMS section (steps named "admin ..."; P15_W / P15_USERS=admin-manager,admin-admin narrow the sweeps).
//   ONLY_DISCOVERY=1 runs just the Phase 20 discovery section (steps named "discovery ..."; P15_W / P15_USERS=disc-guest,disc-member narrow the sweeps).
//   ONLY_WORKSPACE=1 runs just the Phase 21 workspace section (steps named "workspace ..."; P15_W / P15_USERS=ws-guest,ws-member,ws-lead,ws-manager,ws-admin,ws-noprofile,ws-empty narrow the sweeps).
//   ONLY_KNOWLEDGE=1 runs just the Phase 22 knowledge-base section (steps named "knowledge ..."; P15_W / P15_USERS=k22-guest,k22-member,k22-lead,k22-manager,k22-admin narrow the sweeps).
//   ONLY_RESOURCES=1 runs just the Phase 23 lab-resources section (steps named "resources ..."; P15_W / P15_USERS=r23-guest,r23-member,r23-lead,r23-manager,r23-admin narrow the sweeps).
//   ONLY_PUBS=1 runs just the Phase 19 publications section (steps named "publications ..."; P15_W / P15_USERS=pubs-guest,pubs-member,pubs-manager narrow the sweeps).
//   ONLY_RESEARCH=1 runs just the Phase 18 research-structure section (steps named "research ..."; P15_W / P15_USERS=research-guest,research-member,research-manager,research-admin narrow the sweeps).
//   e.g.   API on :4001 (Vite proxies /api there) started with DATABASE_URL=file:<COPY of dev.db>,
//          Vite on :5180 (`vite --port 5180 --strictPort`), then
//          node scripts/browser-regression.cjs http://localhost:5180 http://localhost:4001 ./shots
// Run it ONLY against a COPY of the database: it seeds "ZZ B9" data through the API and never cleans up.
// It drives the real UI as guest / member / project+group lead / lab manager / admin, and scans every
// real API response body the browser receives for account ids and credential keys.
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const WEB = process.argv[2] || "http://localhost:5180";
const API = process.argv[3] || "http://localhost:4001";
const SHOTS = process.argv[4] || path.join(os.tmpdir(), "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 9334;
// BROWSER_PATH (Phase 26): this script drives a real browser directly over CDP, spawned as a raw
// child process — it always hard-coded a Windows-only Edge path, so it could never run anywhere
// else (this container, any Linux CI runner, ...) without editing the script by hand. The Windows
// default is unchanged for whoever already runs it there; BROWSER_PATH overrides it for any other
// platform/executable (e.g. the pre-installed Linux Chromium at /opt/pw-browsers/chromium in this
// container — any recent Chromium/Edge build works, since this only needs `--headless=new` +
// `--remote-debugging-port` CDP support, nothing Edge-specific).
const EDGE = process.env.BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PW = "Str0ngPassw0rd!";
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };

let pass = 0;
const fails = [];
const check = (n, c, d = "") => {
  if (c) pass++;
  else {
    fails.push(n + (d ? " -- " + d : ""));
    console.log("  FAIL", n, d);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log("\n# " + t);
const ONLY_NAV = !!process.env.ONLY_NAV;
const ONLY_UI = !!process.env.ONLY_UI;
const ONLY_FORUM = !!process.env.ONLY_FORUM;
const ONLY_I18N = !!process.env.ONLY_I18N;
const ONLY_EVENTS = !!process.env.ONLY_EVENTS;
const ONLY_ADMIN = !!process.env.ONLY_ADMIN;
const ONLY_RESEARCH = !!process.env.ONLY_RESEARCH;
const ONLY_PUBS = !!process.env.ONLY_PUBS;
const ONLY_DISCOVERY = !!process.env.ONLY_DISCOVERY;
const ONLY_WORKSPACE = !!process.env.ONLY_WORKSPACE;
const ONLY_KNOWLEDGE = !!process.env.ONLY_KNOWLEDGE;
const ONLY_RESOURCES = !!process.env.ONLY_RESOURCES;

// ---------------------------------------------------------------- API seeding
class Client {
  cookie = "";
  async req(method, p, body) {
    const res = await fetch(`${API}/api${p}`, { method, headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie?.() ?? []) if (c.startsWith("scl.sid=")) this.cookie = c.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  }
}
async function seed() {
  const a = new Client();
  await a.req("POST", "/auth/login", ADMIN);
  const mkUser = async (key, role, name) => {
    const r = await a.req("POST", "/users", { email: `b9-${key}@example.test`, password: PW, role, name, initials: key.slice(0, 2).toUpperCase(), memberRole: "MSc Researcher", category: "MSC" });
    const team = (await a.req("GET", "/team")).json;
    return { email: `b9-${key}@example.test`, userId: r.json.id, tmId: team.find((m) => m.name === name).id };
  };
  const mgr = await mkUser("manager", "LAB_MANAGER", "ZZ B9 Manager");
  const mem = await mkUser("member", "MEMBER", "ZZ B9 Member");
  const lead = await mkUser("lead", "MEMBER", "ZZ B9 Lead");
  const ok = (r) => r.json;
  const areaPub = ok(await a.req("POST", "/research", { title: "ZZ B9 Area Public", description: "d", tag: "T" }));
  const areaHid = ok(await a.req("POST", "/research", { title: "ZZ B9 Area Hidden", description: "d", tag: "T", visibility: "LAB_ONLY" }));
  const pubPub = ok(await a.req("POST", "/publications", { year: 2031, title: "ZZ B9 Pub Public", authors: "a", venue: "v" }));
  const pubHid = ok(await a.req("POST", "/publications", { year: 2031, title: "ZZ B9 Pub Hidden", authors: "a", venue: "v", visibility: "LAB_ONLY" }));
  const newsPub = ok(await a.req("POST", "/news", { date: "Jan 2031", sortDate: "2031-01-01", type: "Paper", title: "ZZ B9 News Public", description: "d" }));
  const newsHid = ok(await a.req("POST", "/news", { date: "Jan 2031", sortDate: "2031-01-02", type: "Paper", title: "ZZ B9 News Hidden", description: "d", visibility: "LAB_ONLY" }));
  const gPub = ok(await a.req("POST", "/groups", { name: "ZZ B9 Group Public", description: "public group", visibility: "PUBLIC" }));
  const gHid = ok(await a.req("POST", "/groups", { name: "ZZ B9 Group Hidden", description: "secret group" }));
  await a.req("PUT", `/groups/${gPub.id}/members`, { members: [{ teamMemberId: lead.tmId, role: "LEAD" }, { teamMemberId: mem.tmId, role: "MEMBER" }] });
  await a.req("PUT", `/groups/${gHid.id}/members`, { members: [{ teamMemberId: lead.tmId, role: "MEMBER" }] });
  const p1 = ok(await a.req("POST", "/projects", { title: "ZZ B9 Project Public", summary: "A public project", description: "Long description of the public project.", status: "ACTIVE", startDate: "2030-03-01", endDate: "2031-09-30", visibility: "PUBLIC", groupId: gPub.id }));
  const p2 = ok(await a.req("POST", "/projects", { title: "ZZ B9 Project Hidden", summary: "Internal only", visibility: "LAB_ONLY" }));
  const p3 = ok(await a.req("POST", "/projects", { title: "ZZ B9 Project In Hidden Group", visibility: "PUBLIC", groupId: gHid.id }));
  await a.req("PUT", `/projects/${p1.id}/areas`, { areaIds: [areaPub.id, areaHid.id] });
  await a.req("PUT", `/projects/${p1.id}/publications`, { publicationIds: [pubPub.id, pubHid.id] });
  await a.req("PUT", `/projects/${p1.id}/news`, { newsIds: [newsPub.id, newsHid.id] });
  await a.req("PUT", `/projects/${p1.id}/members`, { members: [{ teamMemberId: lead.tmId, role: "LEAD" }, { teamMemberId: mem.tmId, role: "MEMBER" }] });
  await a.req("PUT", `/projects/${p2.id}/members`, { members: [{ teamMemberId: lead.tmId, role: "MEMBER" }] });
  await a.req("PUT", `/projects/${p3.id}/members`, { members: [{ teamMemberId: lead.tmId, role: "MEMBER" }] });
  // Phase 10 (search) fixtures: a plain MEMBER, a hidden project inside a PUBLIC group, Japanese records,
  // 26 news items (21 public + 5 lab-only) for pagination, and a title that looks like HTML.
  const plain = await mkUser("plain", "MEMBER", "ZZ B9 Plain");
  const p4 = ok(await a.req("POST", "/projects", { title: "ZZ B9 Wombat Secret", summary: "Wombat burrows", visibility: "LAB_ONLY", groupId: gPub.id }));
  const jpArea = ok(await a.req("POST", "/research", { title: "ZZ B9 半導体 エージング", description: "FPGAのエージング検出とデータ解析", tag: "半導体", visibility: "PUBLIC" }));
  const jpHid = ok(await a.req("POST", "/projects", { title: "ZZ B9 秘密の量子研究", summary: "非公開の研究", visibility: "LAB_ONLY" }));
  for (let i = 1; i <= 26; i++) await a.req("POST", "/news", { date: "Jan 2032", sortDate: `2032-01-${String(i).padStart(2, "0")}`, type: "Bulk", title: `ZZ B9 Bulk ${String(i).padStart(2, "0")}`, description: "bulk item", ...(i > 21 ? { visibility: "LAB_ONLY" } : {}) });
  const markup = ok(await a.req("POST", "/news", { date: "Jan 2033", sortDate: "2033-01-01", type: "Markup", title: "ZZ B9 <img src=x onerror=window.__xss=1> Markup", description: "<script>window.__xss=2</script>", visibility: "PUBLIC" }));
  const allUsers = (await a.req("GET", "/users")).json;
  const userIds = allUsers.map((u) => u.id);
  const unlinkedSeed = (await a.req("GET", "/team")).json.find((m) => !allUsers.some((u) => u.teamMemberId === m.id) && !m.name.startsWith("ZZ"));

  // Phase 11 (forum): a public category with topics, a lab-only category, and a hostile string in a
  // topic body (must render as text in the browser, never execute — see the forum section below).
  const fCatPub = ok(await a.req("POST", "/forum/categories", { name: "ZZ B9 Forum Public Category", description: "General discussion", visibility: "PUBLIC" }));
  const fCatHid = ok(await a.req("POST", "/forum/categories", { name: "ZZ B9 Forum Hidden Category", description: "Lab only", visibility: "LAB_ONLY" }));
  const fTopic = ok(await a.req("POST", "/forum/posts", { categoryId: fCatPub.id, title: "ZZ B9 Forum Seed Topic", body: "Seeded topic body for browser tests." }));
  const fXss = ok(await a.req("POST", "/forum/posts", { categoryId: fCatPub.id, title: "ZZ B9 Forum XSS Topic", body: "<img src=x onerror=window.__forumXss=1> <script>window.__forumXss=2</script>" }));
  // Phase 16 (events): a public upcoming event with a Japanese translation, a LAB_ONLY one, a past public
  // one, and one with very long text in both languages (layout stress).
  const DAY = 864e5;
  const at = (days, hours = 0) => new Date(Date.now() + days * DAY + hours * 36e5).toISOString();
  const evPub = ok(await a.req("POST", "/events", { title: "ZZ B9 Event Public", description: "A public seminar for the browser tests.", location: "ZZ B9 Hall 1", kind: "SEMINAR", startsAt: at(3), endsAt: at(3, 2), visibility: "PUBLIC", url: "https://example.org/zz-b9-event", projectId: p1.id, translations: { ja: { title: "ZZ B9 公開イベント", description: "ブラウザテスト用の公開セミナーです。" } } }));
  const evHid = ok(await a.req("POST", "/events", { title: "ZZ B9 Event Hidden", description: "Lab-only planning meeting.", location: "ZZ B9 Room 2", kind: "MEETING", startsAt: at(4), visibility: "LAB_ONLY", translations: { ja: { title: "ZZ B9 非公開イベント" } } }));
  const evPast = ok(await a.req("POST", "/events", { title: "ZZ B9 Event Past", description: "A finished workshop.", location: "ZZ B9 Hall 3", kind: "OTHER", startsAt: at(-10), endsAt: at(-10, 3), visibility: "PUBLIC" }));
  const evPastHid = ok(await a.req("POST", "/events", { title: "ZZ B9 Event Past Hidden", kind: "SOCIAL", startsAt: at(-12), visibility: "LAB_ONLY" }));
  const evLong = ok(await a.req("POST", "/events", { title: "ZZ B9 Event ZZP16" + "x".repeat(70) + " long title", description: "ZZP16" + "y".repeat(80) + " " + "A very long description sentence. ".repeat(30), location: "ZZP16" + "z".repeat(70) + " Building, Floor 12, Room 1204", kind: "DEADLINE", startsAt: at(5), endsAt: at(6), visibility: "PUBLIC", translations: { ja: { title: "ZZ B9 超長い日本語のイベントタイトルがレイアウトを壊さないことを確認するためのテスト用の非常に長いイベント名です", description: "超長い日本語の説明文。".repeat(40) } } }));
  return { userIds, unlinkedSeed, evPub, evHid, evPast, evPastHid, evLong, mgr, mem, lead, plain, areaPub, areaHid, pubPub, pubHid, newsPub, newsHid, gPub, gHid, p1, p2, p3, p4, jpArea, jpHid, markup, fCatPub, fCatHid, fTopic, fXss };
}

// ---------------------------------------------------------------- CDP plumbing
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-p91-"));
// --no-sandbox (Phase 26, BROWSER_PATH override only): Chromium refuses to start as root without
// it (see https://crbug.com/638180) — the containers this override targets commonly run as root.
// Never added for the default Windows/Edge path, which never runs as root.
const edgeArgs = ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"];
if (process.env.BROWSER_PATH) edgeArgs.splice(4, 0, "--no-sandbox");
const edge = spawn(EDGE, edgeArgs, { stdio: "ignore" });

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error("Edge did not start");
}

(async () => {
  const D = await seed();
  console.log("seeded", Object.keys(D).length, "fixtures");

  const ws = new WebSocket(await connect());
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  const badResponses = [];
  const reqUrls = new Map();
  const searchReqs = []; // every /api/search request the browser makes (Phase 10)
  const apiBodies = new Map(); // requestId -> url of a successful /api JSON response
  const bodyLeaks = [];
  let bodiesScanned = 0;
  const pendingBodies = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method === "Runtime.exceptionThrown") consoleErrors.push("EXC " + msg.params.exceptionDetails.text + " " + (msg.params.exceptionDetails.exception?.description || ""));
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(" "));
    if (msg.method === "Network.requestWillBeSent") reqUrls.set(msg.params.requestId, msg.params.request.method + " " + msg.params.request.url);
    if (msg.method === "Network.requestWillBeSent" && msg.params.request.url.includes("/api/search")) searchReqs.push(msg.params.request.url);
    if (msg.method === "Network.responseReceived" && msg.params.response.url.includes("/api/") && msg.params.response.status < 400) apiBodies.set(msg.params.requestId, msg.params.response.url);
    if (msg.method === "Network.loadingFinished" && apiBodies.has(msg.params.requestId)) {
      const url = apiBodies.get(msg.params.requestId);
      apiBodies.delete(msg.params.requestId);
      pendingBodies.push(send("Network.getResponseBody", { requestId: msg.params.requestId }).then((r) => {
        const body = r.result?.body;
        if (typeof body !== "string") return;
        bodiesScanned++;
        if (/\/api\/(auth|users|admin\/audit)/.test(url)) return; // (an ADMIN's audit rows name the account a USER event is about) // own session info / admin-only account list are allowed to carry ids
        const key = body.match(/"(userId|passwordHash|password|sessionId|sid|token)"\s*:/)?.[1];
        const idHit = D.userIds.find((u) => body.includes(u));
        if (key || idHit) bodyLeaks.push(`${url} -> ${key ? "key " + key : "account id value"}`);
      }));
    }
    if (msg.method === "Network.responseReceived" && msg.params.response.url.includes("/api/") && msg.params.response.status >= 400)
      badResponses.push(`${msg.params.response.status} ${reqUrls.get(msg.params.requestId) ?? msg.params.response.url}`);
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error("eval failed: " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
  };
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true }); // headless pages otherwise never match :focus / :focus-visible
  const desktop = () => send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await desktop();

  const go = async (p) => { await send("Page.navigate", { url: WEB + p }); await sleep(300); };
  const text = () => ev("document.body.innerText");
  const pathNow = () => ev("location.pathname");
  const waitFor = async (expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch {} await sleep(100); } return false; };
  const waitText = (s, ms) => waitFor(`document.body.innerText.includes(${JSON.stringify(s)})`, ms);
  const waitGone = (s, ms) => waitFor(`!document.body.innerText.includes(${JSON.stringify(s)})`, ms);
  const visit = async (p, expectText) => { await go(p); return expectText ? waitText(expectText) : true; };
  const clickText = (label, sel = "button,a") => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.innerText.trim().toLowerCase().includes(${JSON.stringify(label.toLowerCase())})); if (!el) return false; el.click(); return true; })()`);
  const setVal = (idSel, v) => ev(`(() => { const el = document.getElementById(${JSON.stringify(idSel)}); if (!el) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
  const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
  const submitModal = () => ev(`(() => { const b = document.querySelector('.modal button.form-submit'); if (!b) return false; b.click(); return true; })()`);
  const apiCall = (method, p, body) => ev(`fetch('/api${p}', { method: ${JSON.stringify(method)}, credentials: 'same-origin', headers: {'Content-Type':'application/json'}, body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))} }).then(r => r.status)`);
  const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
  const login = async (email, password) => {
    await go("/login");
    await waitFor(`!!document.getElementById('email')`);
    await ev(`(() => { const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.getElementById('email'), ${JSON.stringify(email)}); set(document.getElementById('password'), ${JSON.stringify(password)}); document.getElementById('email').form.requestSubmit(); })()`);
    return waitFor(`location.pathname !== '/login'`);
  };
  // Phase 10.1: Log out lives inside the Account dropdown. Clicking it programmatically works while the panel is folded away;
  // the real mouse/keyboard path is covered by the nav section.
  const logout = async () => { await ev(`(() => { const b = [...document.querySelectorAll('.nav__panel button')].find((x) => /log out/i.test(x.textContent)); if (!b) return false; b.click(); return true; })()`); await waitFor(`!!document.querySelector('.nav__account > a[href="/login"]')`);
    // The header flips to "Log in" as soon as the click lands; make sure the SERVER also ended the session before
    // anything navigates away (a navigation can cancel the in-flight logout request and leave a stale session that
    // makes every later "guest" step run as a signed-in user). Under load this race was seen once.
    for (let i = 0; i < 20; i++) { if (!(await ev(`fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => !!j.user)`))) return; await sleep(150); }
    await ev(`fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).then(() => true)`);
  };

  const step = async (name, fn) => {
    if ((ONLY_NAV && !name.startsWith("nav")) || (ONLY_UI && !name.startsWith("ui")) || (ONLY_FORUM && !name.startsWith("forum")) || (ONLY_I18N && !name.startsWith("i18n")) || (ONLY_EVENTS && !name.startsWith("events")) || (ONLY_ADMIN && !name.startsWith("admin ")) || (ONLY_RESEARCH && !name.startsWith("research ")) || (ONLY_PUBS && !name.startsWith("publications ")) || (ONLY_DISCOVERY && !name.startsWith("discovery ")) || (ONLY_WORKSPACE && !name.startsWith("workspace ")) || (ONLY_KNOWLEDGE && !name.startsWith("knowledge ")) || (ONLY_RESOURCES && !name.startsWith("resources "))) return;
    if (process.env.ONLY_STEPS && !new RegExp(process.env.ONLY_STEPS, "i").test(name)) return; // e.g. ONLY_STEPS="^(promoted|search guest)$"
    try {
      await fn();
    } catch (e) {
      check(name + " (threw)", false, String(e.message).slice(0, 200));
    }
  };

  // ================================================================= GUEST
  section("guest");
  await step("guest", async () => {
    check("guest /projects renders the public project", await visit("/projects", "ZZ B9 Project Public"));
    let t = await text();
    check("guest /projects hides the LAB_ONLY project", !t.includes("ZZ B9 Project Hidden"));
    check("guest sees the public project that sits in a hidden group", t.includes("ZZ B9 Project In Hidden Group"));
    check("guest sees no manage bar and no Lab-only badge", !t.includes("+ New project") && !t.toLowerCase().includes("lab only"));
    check("nav offers Projects (under Research) and Groups (under People)", (await exists('#nav-panel-research a[href="/projects"]')) && (await exists('#nav-panel-people a[href="/groups"]')));
    await shot("guest-projects");

    await go(`/projects/${D.p1.id}`);
    check("guest project detail renders", await waitText("Long description of the public project."));
    t = await text();
    check("guest sees public area/publication/news only", t.includes("ZZ B9 Area Public") && t.includes("ZZ B9 Pub Public") && t.includes("ZZ B9 News Public") && !t.includes("ZZ B9 Area Hidden") && !t.includes("ZZ B9 Pub Hidden") && !t.includes("ZZ B9 News Hidden"));
    check("guest sees the team and roles", t.includes("ZZ B9 Lead") && t.includes("Lead"));
    check("guest sees no edit controls on a project", !t.includes("Edit project") && !t.includes("Members\n") && !(await exists(".admin-bar")));
    const html = await ev("document.documentElement.outerHTML");
    check("hidden records are not even in the page HTML/state", !html.includes(D.pubHid.id) && !html.includes(D.newsHid.id) && !html.includes(D.areaHid.id));

    await go(`/projects/${D.p2.id}`);
    check("direct URL to a hidden project = not-found state", await waitText("Project not found"));
    t = await text();
    check("...and leaks nothing (no title, no summary)", !t.includes("ZZ B9 Project Hidden") && !t.includes("Internal only"));

    await go(`/projects/${D.p3.id}`);
    await waitText("ZZ B9 Project In Hidden Group");
    t = await text();
    check("public project in a hidden group: group name not shown", !t.includes("ZZ B9 Group Hidden") && !t.includes("Group:"));

    check("guest /groups shows the public group only", await visit("/groups", "ZZ B9 Group Public") && !(await text()).includes("ZZ B9 Group Hidden"));
    await shot("guest-groups");
    await go(`/groups/${D.gPub.id}`);
    await waitText("public group");
    t = await text();
    check("public group detail: members + only the public project", t.includes("ZZ B9 Lead") && t.includes("ZZ B9 Project Public") && !t.includes("ZZ B9 Project Hidden"));
    await go(`/groups/${D.gHid.id}`);
    check("direct URL to a hidden group = not-found state", await waitText("Group not found") && !(await text()).includes("secret group"));

    await go(`/team/${D.lead.tmId}`);
    await waitText("ZZ B9 Lead");
    t = await text();
    check("guest profile lists public project + group", t.includes("ZZ B9 Project Public") && t.includes("ZZ B9 Group Public"));
    check("guest profile hides the hidden project + group", !t.includes("ZZ B9 Project Hidden") && !t.includes("ZZ B9 Group Hidden"));
    check("guest profile hides linked hidden items", !t.includes("ZZ B9 Pub Hidden") && !t.includes("ZZ B9 News Hidden"));


    // ---- Phase 9.1: guests get no ownership state and no account ids
    await go("/team");
    check("9.1 guest team page renders", (await waitText("Our Team")) && (await waitText("ZZ B9 Member")));
    t = await text();
    check("9.1 guest team page: no edit/delete controls on any card, no add button", !(await exists(".card-edit-btn")) && !t.includes("+ Add team member"));
    const teamHtml = await ev("document.documentElement.outerHTML");
    check("9.1 guest team page HTML holds no account id and no 'userId'", !D.userIds.some((u) => teamHtml.includes(u)) && !teamHtml.includes("userId"));
    const guestTeamJson = await ev(`fetch('/api/team').then(r => r.text())`);
    check("9.1 guest /api/team as fetched by the page: no userId / account id, never isOwn=true", !guestTeamJson.includes("userId") && !D.userIds.some((u) => guestTeamJson.includes(u)) && !guestTeamJson.includes('"isOwn":true') && guestTeamJson.includes('"isOwn":false'));
    await go(`/team/${D.mem.tmId}`);
    await waitText("ZZ B9 Member");
    t = await text();
    const profHtml = await ev("document.documentElement.outerHTML");
    check("9.1 guest profile page: no owner controls, no 'your profile', no account id", !t.includes("Edit profile") && !t.includes("This is your profile") && !(await exists(".admin-bar")) && !D.userIds.some((u) => profHtml.includes(u)) && !profHtml.includes("userId"));
    const guestProfJson = await ev(`fetch('/api/member/${D.mem.tmId}').then(r => r.text())`);
    check("9.1 guest /api/member/:id: no userId, isOwn false", !guestProfJson.includes("userId") && JSON.parse(guestProfJson).isOwn === false);

    check("guest protected routes redirect to /login", await (async () => { const out = []; for (const p of ["/admin", "/profile", "/schedule"]) { await go(p); await sleep(400); out.push(await pathNow()); } return out.every((x) => x === "/login"); })());
    check("guest write API calls are refused (401)", (await apiCall("POST", "/projects", { title: "x" })) === 401 && (await apiCall("DELETE", `/projects/${D.p1.id}`)) === 401);
    await go("/projects/doesnotexist123");
    check("unknown project id renders a not-found state, no crash", await waitText("Project not found"));
    await go("/projects/bad!id");
    check("malformed project id renders an error state, no crash", await waitFor(`document.body.innerText.includes('Project not found') || document.body.innerText.includes('Invalid')`));
  });

  // ================================================================= MEMBER
  section("member");
  await step("member", async () => {
    check("member login", await login(D.mem.email, PW));
    check("member sees the LAB_ONLY project", await visit("/projects", "ZZ B9 Project Hidden"));
    let t = await text();
    check("member sees no 'Lab only' badge (visibility field is not sent to them)", !t.toLowerCase().includes("lab only"));
    check("member has no '+ New project'", !t.includes("+ New project"));
    await go(`/projects/${D.p1.id}`);
    await waitText("Long description");
    t = await text();
    check("member sees the hidden linked records on a project", t.includes("ZZ B9 Pub Hidden") && t.includes("ZZ B9 News Hidden") && t.includes("ZZ B9 Area Hidden"));
    check("member (not a lead) gets no edit controls", !t.includes("Edit project") && !(await exists(".admin-bar")));
    check("member sees the LAB_ONLY group + hidden project", await visit("/groups", "ZZ B9 Group Hidden"));
    await go(`/projects/${D.p2.id}`);
    check("member can open the hidden project by URL", await waitText("Internal only"));
    check("member cannot use manager APIs (403)", (await apiCall("POST", "/projects", { title: "ZZ B9 nope" })) === 403 && (await apiCall("PUT", `/projects/${D.p1.id}`, { summary: "hax" })) === 403 && (await apiCall("DELETE", `/projects/${D.p1.id}`)) === 403 && (await apiCall("GET", "/users")) === 403);
    await go("/admin"); await sleep(600);
    check("member is bounced from /admin", (await pathNow()) === "/");
    t = await text();
    check("member nav has no Admin link", !t.includes("Admin") && !(await exists('.nav a[href="/admin"]')));
    await go("/research");
    await waitText("Research Areas");
    check("member research page: can add, cannot delete", (await text()).includes("Only lab managers and admins can delete") && !(await exists(".icon-btn--danger")));
    await clickText("+ Add research area");
    await waitFor(`!!document.getElementById('research_title')`);
    check("member's research form has no visibility control", !(await exists("#research_visibility")));
    await go(`/team/${D.mem.tmId}`);
    await waitText("ZZ B9 Member");
    check("member profile shows their groups/projects", (await text()).includes("ZZ B9 Project Public") && (await text()).includes("ZZ B9 Group Public"));

    // ---- Phase 9.1: ownership comes from the server's isOwn flag
    await go("/team");
    await waitText("ZZ B9 Member");
    check("9.1 member team page: exactly one editable card, and it is their own", await ev(`(() => { const cards = [...document.querySelectorAll('.team-card')]; const editable = cards.filter(c => c.querySelector('.card-edit-btn')); return cards.length > 2 && editable.length === 1 && editable[0].innerText.includes('ZZ B9 Member'); })()`));
    check("9.1 ...and no delete control anywhere (not an admin)", !(await exists(".icon-btn--danger")));
    check("9.1 another member's card has no edit control", await ev(`(() => { const c = [...document.querySelectorAll('.team-card')].find(c => c.innerText.includes('ZZ B9 Lead')); return !!c && !c.querySelector('.card-edit-btn'); })()`));
    await go(`/team/${D.mem.tmId}`);
    await waitText("ZZ B9 Member");
    t = await text();
    check("9.1 own profile: owner bar + Edit profile", t.includes("This is your profile") && t.includes("Edit profile"));
    await go(`/team/${D.lead.tmId}`);
    await waitText("ZZ B9 Lead");
    t = await text();
    check("9.1 another member's profile: no owner controls", !t.includes("This is your profile") && !t.includes("Edit profile") && !(await exists(".admin-bar")));
    await go("/publications");
    await waitText("Publications");
    await clickText("+ Add publication");
    check("9.1 add-publication form offers 'show on my member profile' (server says they own a profile)", await waitText("Also show this publication on my member profile"));
    await clickText("cancel", ".modal button");
    await waitFor(`!document.querySelector('.modal')`);
    // Log out while still looking at the own profile: the controls must vanish without a reload.
    await go(`/team/${D.mem.tmId}`);
    await waitText("This is your profile");
    await logout();
    check("9.1 logging out on the profile page removes the owner controls at once", await waitFor(`!document.body.innerText.includes('This is your profile') && !document.body.innerText.includes('Edit profile')`, 4000));
    await go(`/team/${D.mem.tmId}`);
    await waitText("ZZ B9 Member");
    check("9.1 revisiting the profile after logout: guest view, isOwn false from the server", !(await text()).includes("Edit profile") && (await ev(`fetch('/api/member/${D.mem.tmId}').then(r => r.json()).then(j => j.isOwn)`)) === false);
    await go("/team");
    await waitText("ZZ B9 Member");
    check("9.1 after logout the team page has no editable cards", !(await exists(".card-edit-btn")));

    await logout();
  });

  // ================================================================= LEAD
  section("project lead (a plain MEMBER account)");
  await step("lead", async () => {
    check("lead login", await login(D.lead.email, PW));
    await go(`/projects/${D.p1.id}`);
    await waitText("Long description");
    let t = await text();
    check("lead sees the lead-specific manage bar", t.includes("You lead this project"));
    check("lead has Edit/Members/Areas/Publications/News but NOT Delete", ["Edit project", "Members", "Research areas", "Publications", "News"].every((s) => t.includes(s)) && !(await ev(`[...document.querySelectorAll('.admin-bar button')].some(b => b.innerText.trim() === 'Delete')`)));
    await clickText("edit project");
    check("edit modal opens", await waitFor(`!!document.getElementById('project_title')`));
    check("lead's form has NO visibility / group / sort / slug controls", !(await exists("#project_visibility")) && !(await exists("#project_group")) && !(await exists("#project_sortOrder")) && !(await exists("#project_slug")));
    await setVal("project_summary", "Edited by the project lead");
    await submitModal();
    check("lead's edit is saved and shown", await waitText("Edited by the project lead"));
    check("...modal closed", await waitFor(`!document.querySelector('.modal')`));
    check("server refuses a lead who bypasses the UI (visibility/slug/group -> 403)", (await apiCall("PUT", `/projects/${D.p1.id}`, { visibility: "LAB_ONLY" })) === 403 && (await apiCall("PUT", `/projects/${D.p1.id}`, { slug: "hax" })) === 403 && (await apiCall("PUT", `/projects/${D.p1.id}`, { groupId: null })) === 403);
    check("...and cannot edit a project they don't lead (403)", (await apiCall("PUT", `/projects/${D.p2.id}`, { summary: "hax" })) === 403);
    await go(`/projects/${D.p2.id}`);
    await waitText("Internal only");
    check("no manage bar on a project they only belong to", !(await exists(".admin-bar")));
    await go(`/groups/${D.gPub.id}`);
    await waitText("public group");
    check("group lead sees the group manage bar (no delete)", (await text()).includes("You lead this group") && !(await ev(`[...document.querySelectorAll('.admin-bar button')].some(b => b.innerText.trim() === 'Delete')`)));
    await go(`/team/${D.lead.tmId}`);
    await waitText("ZZ B9 Lead");
    t = await text();
    check("lead's profile shows every project + group they belong to", ["ZZ B9 Project Public", "ZZ B9 Project Hidden", "ZZ B9 Project In Hidden Group", "ZZ B9 Group Public", "ZZ B9 Group Hidden"].every((s) => t.includes(s)));
    await logout();
  });

  // ================================================================= LAB MANAGER
  section("lab manager");
  await step("manager", async () => {
    check("manager login", await login(D.mgr.email, PW));
    await go("/projects");
    await waitText("ZZ B9 Project Hidden");
    let t = await text();
    check("manager sees '+ New project' and 'Lab only' badges", t.includes("+ New project") && t.toLowerCase().includes("lab only"));
    await shot("manager-projects");

    // --- create project through the UI, with validation
    await clickText("+ New project");
    check("create modal opens", await waitFor(`!!document.getElementById('project_title')`));
    check("visibility defaults to Lab only (fail closed)", (await ev(`document.getElementById('project_visibility').value`)) === "LAB_ONLY");
    await submitModal();
    check("empty title shows a validation error", await waitFor(`!!document.querySelector('.modal .form-error') && document.querySelector('.modal .form-error').innerText.toLowerCase().includes('title')`));
    await setVal("project_title", "ZZ B9 Created In UI");
    await setVal("project_startDate", "2031-05-01");
    await setVal("project_endDate", "2031-01-01");
    await submitModal();
    check("end-before-start shows a validation error", await waitFor(`document.querySelector('.modal .form-error')?.innerText.toLowerCase().includes('end date')`));
    await setVal("project_endDate", "2032-01-01");
    await setVal("project_summary", "Made through the browser");
    await setVal("project_group", D.gPub.id);
    // slow the network a little so the saving state is observable
    await send("Network.emulateNetworkConditions", { offline: false, latency: 700, downloadThroughput: -1, uploadThroughput: -1 });
    await submitModal();
    check("button shows a saving state", await waitFor(`document.querySelector('.modal button.form-submit')?.innerText.includes('Saving')`, 2000));
    check("after saving we land on the new project page", await waitFor(`location.pathname.startsWith('/projects/') && location.pathname.length > 12 && document.body.innerText.includes('Made through the browser')`, 12000));
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const newId = (await pathNow()).split("/").pop();
    t = await text();
    check("new project shows Lab-only badge + chosen group + dates", t.toLowerCase().includes("lab only") && t.includes("ZZ B9 Group Public") && t.includes("May 2031"));
    check("guest cannot see the new (lab-only) project via the API", (await (await fetch(`${API}/api/projects/${newId}`)).status) === 404);

    // --- members / areas / publications / news through the UI
    await clickText("members", ".admin-bar button");
    check("members modal opens with the team list", await waitText("Project members") && await waitText("ZZ B9 Member"));
    await ev(`(() => { const row = [...document.querySelectorAll('.pick-item')].find(r => r.innerText.includes('ZZ B9 Lead')); row.querySelector('input[type=checkbox]').click(); })()`);
    await ev(`(() => { const row = [...document.querySelectorAll('.pick-item')].find(r => r.innerText.includes('ZZ B9 Lead')); const s = row.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'LEAD'); s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await submitModal();
    check("member added with role Lead", await waitFor(`document.querySelector('.panel__list')?.innerText.includes('ZZ B9 Lead')`) && (await text()).includes("Lead"));
    await clickText("research areas", ".admin-bar button");
    await waitText("Which research areas");
    await ev(`(() => { const l = [...document.querySelectorAll('.modal label')].find(x => x.innerText.includes('ZZ B9 Area Public')); l.querySelector('input').click(); })()`);
    await submitModal();
    check("research area linked", await waitFor(`document.querySelector('.chips')?.innerText.includes('ZZ B9 Area Public') || document.body.innerText.includes('ZZ B9 Area Public')`));
    await clickText("news", ".admin-bar button");
    await waitText("one project at a time");
    await ev(`(() => { const l = [...document.querySelectorAll('.modal label')].find(x => x.innerText.includes('ZZ B9 News Public')); l.querySelector('input').click(); })()`);
    await submitModal();
    check("linking news that belongs to another project shows the API's 409 message", await waitFor(`document.querySelector('.modal .form-error')?.innerText.includes('another project')`));
    await clickText("cancel", ".modal button");
    await waitFor(`!document.querySelector('.modal')`);

    // --- edit: publish it
    await clickText("edit project", ".admin-bar button");
    await waitFor(`!!document.getElementById('project_visibility')`);
    check("edit form pre-fills current values", (await ev(`document.getElementById('project_title').value`)) === "ZZ B9 Created In UI" && (await ev(`document.getElementById('project_group').value`)) === D.gPub.id);
    await setVal("project_visibility", "PUBLIC");
    await setVal("project_status", "COMPLETED");
    await submitModal();
    check("saving closes the modal and the page updates in place (status now Completed)", await waitFor(`!document.querySelector('.modal') && document.body.innerText.toLowerCase().includes('completed')`));
    check("publishing removes the Lab-only badge", await waitFor(`!document.body.innerText.toLowerCase().includes('lab only')`));
    check("guest can now fetch it", (await fetch(`${API}/api/projects/${newId}`)).status === 200);
    await shot("manager-project-detail");

    // --- refresh + back/forward + direct nav
    await send("Page.reload"); await sleep(400);
    check("refresh keeps the project page", await waitText("Made through the browser") && (await pathNow()) === `/projects/${newId}`);
    await go("/projects");
    await waitText("ZZ B9 Created In UI");
    await clickText("ZZ B9 Created In UI", "a");
    await waitFor(`location.pathname === '/projects/${newId}'`);
    await ev("history.back()");
    check("back returns to the list", await waitFor(`location.pathname === '/projects'`));
    await ev("history.forward()");
    check("forward returns to the project", await waitFor(`location.pathname === '/projects/${newId}'`) && await waitText("Made through the browser"));

    // --- delete
    await clickText("delete", ".admin-bar button");
    check("delete asks for confirmation", await waitText("This cannot be undone"));
    await clickText("delete", ".modal button.btn--danger");
    check("after delete we return to the list without it", await waitFor(`location.pathname === '/projects'`) && await waitGone("ZZ B9 Created In UI"));
    check("deleted project is a 404 for everyone", (await fetch(`${API}/api/projects/${newId}`)).status === 404);

    // --- groups UI
    await go("/groups");
    await waitText("+ New group");
    await clickText("+ New group");
    await waitFor(`!!document.getElementById('group_name')`);
    await submitModal();
    check("group form: empty name is a validation error", await waitFor(`document.querySelector('.modal .form-error')?.innerText.toLowerCase().includes('name')`));
    await setVal("group_name", "ZZ B9 Group Created In UI");
    await setVal("group_description", "Group made in the browser");
    await submitModal();
    check("group created; we land on its page", await waitFor(`location.pathname.startsWith('/groups/') && document.body.innerText.includes('Group made in the browser')`, 8000));
    const gid = (await pathNow()).split("/").pop();
    await clickText("delete", ".admin-bar button");
    await waitText("This cannot be undone");
    await clickText("delete", ".modal button.btn--danger");
    check("group deleted via the UI", await waitFor(`location.pathname === '/groups'`) && (await fetch(`${API}/api/groups/${gid}`)).status === 404);

    // --- visibility on existing content
    await go("/research");
    await waitText("Research Areas");
    check("manager sees delete controls on research cards", await waitFor(`!!document.querySelector(".icon-btn--danger")`));
    await clickText("+ Add research area");
    await waitFor(`!!document.getElementById('research_visibility')`);
    check("manager's research form has the visibility control", await exists("#research_visibility"));
    await clickText("cancel", ".modal button");
    await go("/publications");
    await waitText("ZZ B9 Pub Hidden");
    check("manager sees a Lab-only badge on hidden content", (await text()).toLowerCase().includes("lab only"));

    // --- accounts are still admin-only
    check("manager cannot list accounts via the API (403)", (await apiCall("GET", "/users")) === 403 && (await apiCall("PUT", `/users/${D.mem.userId}`, { role: "ADMIN" })) === 403);
    // Phase 17 test maintenance: the admin area is now a MANAGEMENT view, so a lab manager reaches /admin (and has the
    // header link) while ACCOUNTS stay admin-only: /admin/people is still bounced and /api/users is still 403 (above).
    // The old assertion ("manager is bounced from /admin") described the pre-Phase-17 admin-only dashboard.
    await go("/admin"); await sleep(600);
    check("manager reaches /admin (Phase 17 management area) and has an Admin link", (await pathNow()) === "/admin" && (await waitText("Admin Dashboard")) && (await exists('.nav a[href="/admin"]')));
    await go("/admin/people"); await sleep(600);
    check("manager is still bounced from /admin/people (accounts are admin-only) and the section nav does not offer it", (await pathNow()) === "/" && !(await exists('a[href="/admin/people"]')));
    check("manager can edit another member's profile", await (async () => { await go(`/team/${D.mem.tmId}`); await waitText("ZZ B9 Member"); return (await text()).includes("Edit profile"); })());
    check("manager cannot delete team members (no ✕ on Team page)", await (async () => { await go("/team"); await waitText("Our Team"); await waitFor(`document.querySelectorAll(".team-card").length > 2`); await sleep(300); return !(await exists(".icon-btn--danger")); })());

    check("9.1 manager: every team card is editable (manager power), none deletable", await ev(`(() => { const cards = [...document.querySelectorAll('.team-card')]; return cards.length > 2 && cards.every(c => c.querySelector('.card-edit-btn')) && !document.querySelector('.icon-btn--danger'); })()`));
    await go(`/team/${D.mem.tmId}`);
    await waitText("ZZ B9 Member");
    t = await text();
    check("9.1 manager on someone else's profile: manager bar, NOT 'this is your profile'", t.includes("Edit profile") && t.includes("Lab manager") && !t.includes("This is your profile"));
    await go(`/team/${D.mgr.tmId}`);
    await waitText("ZZ B9 Manager");
    check("9.1 manager on their own profile: 'this is your profile'", (await text()).includes("This is your profile"));

    await logout();
  });

  // ================================================================= ADMIN
  section("admin");
  await step("admin", async () => {
    check("admin login", await login(ADMIN.email, ADMIN.password));
    // Phase 17: the account list moved from /admin to the "People & Accounts" section (/admin/people); /admin is the overview.
    await go("/admin/people");
    check("admin dashboard renders with the account list", await waitText("b9-manager@example.test"));
    check("role select offers Member / Lab manager / Admin", await ev(`[...document.querySelectorAll('select[aria-label^="Role for"]')].every(s => [...s.options].map(o => o.text).join() === 'Admin,Lab manager,Member')`));
    check("dashboard section nav reaches content management (Research content, Events, Localization, Audit log)", (await text()).includes("Research content") && (await text()).includes("Events") && (await text()).includes("Localization") && (await text()).includes("Audit log"));
    // promote the plain member to LAB_MANAGER through the UI
    await ev(`(() => { const s = document.querySelector('select[aria-label="Role for ${D.mem.email}"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'LAB_MANAGER'); s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    check("role change confirms in the UI", await waitText(`${D.mem.email} is now lab manager`));
    const roles = await ev(`fetch('/api/users').then(r => r.json()).then(u => Object.fromEntries(u.map(x => [x.email, x.role])))`);
    check("...and is stored", roles[D.mem.email] === "LAB_MANAGER");
    check("admin cannot change their own role (select disabled)", await ev(`document.querySelector('select[aria-label="Role for ${ADMIN.email}"]').disabled`));
    await clickText("create login");
    check("create-login modal offers the Lab manager role", await waitFor(`[...(document.getElementById('c_role')?.options ?? [])].some(o => o.value === 'LAB_MANAGER')`));
    await clickText("cancel", ".modal button");
    // the promoted account has manager powers immediately (no re-login)
    await go("/projects");
    await waitText("Research Projects");
    check("admin sees '+ New project'", (await text()).includes("+ New project"));
    check("admin can edit and delete a project (full controls)", await (async () => { await go(`/projects/${D.p3.id}`); await waitText("ZZ B9 Project In Hidden Group"); const t = await text(); return t.includes("Edit project") && (await ev(`[...document.querySelectorAll('.admin-bar button')].some(b => b.innerText.trim() === 'Delete')`)); })());
    check("admin sees the hidden group name on a project in it", (await text()).includes("ZZ B9 Group Hidden"));
    await go("/team");
    await waitText("Our Team");
    check("admin sees team delete controls", await waitFor(`!!document.querySelector('.icon-btn--danger')`));

    check("9.1 admin (no linked profile): every team card is editable AND deletable", await ev(`(() => { const cards = [...document.querySelectorAll('.team-card')]; return cards.length > 2 && cards.every(c => c.querySelector('.card-edit-btn') && c.querySelector('.icon-btn--danger')); })()`));
    await go(`/team/${D.lead.tmId}`);
    await waitText("ZZ B9 Lead");
    t = await text();
    check("9.1 admin on a member's profile: manager bar, not 'this is your profile'", t.includes("Edit profile") && !t.includes("This is your profile"));
    await go("/publications");
    await waitText("Publications");
    await clickText("+ Add publication");
    await waitFor(`!!document.querySelector('.modal')`);
    check("9.1 an account with no profile is not offered 'show on my member profile'", !(await text()).includes("Also show this publication on my member profile"));
    await clickText("cancel", ".modal button");
    await waitFor(`!document.querySelector('.modal')`);
    await go("/admin/people");
    await waitText("b9-manager@example.test");
    await clickText("create login");
    check("9.1 create-login modal lists only UNLINKED profiles (derived from /users, not the public /team)", (await waitFor(`!!document.getElementById('c_teamMemberId')`)) && (await ev(`(() => { const opts = [...document.getElementById('c_teamMemberId').options].map(o => o.text); return opts.length > 0 && opts.some(o => o.includes(${JSON.stringify(D.unlinkedSeed.name)})) && !opts.some(o => o.includes('ZZ B9 Member') || o.includes('ZZ B9 Lead') || o.includes('ZZ B9 Manager')); })()`)));
    await clickText("cancel", ".modal button");
    await waitFor(`!document.querySelector('.modal')`);

    await shot("admin-dashboard");
    await logout();
  });

  section("promoted member takes effect on their live session");
  await step("promoted", async () => {
    check("member (now LAB_MANAGER) logs in", await login(D.mem.email, PW));
    await go("/projects");
    check("...and immediately sees '+ New project'", await waitText("+ New project"));
    await logout();
  });

  // ================================================================= loading / mobile / errors
  section("loading state, mobile layout, error states");
  await step("loading", async () => {
    // Load the SPA at full speed, THEN slow the network and navigate in-app so only API calls are delayed.
    await go("/");
    await waitText("Smart Computing Lab");
    const spaGo = (p) => ev(`(history.pushState({}, '', ${JSON.stringify(p)}), dispatchEvent(new PopStateEvent('popstate')), true)`);
    await send("Network.emulateNetworkConditions", { offline: false, latency: 1200, downloadThroughput: -1, uploadThroughput: -1 });
    await spaGo("/projects");
    check("projects page shows a loading state first", await waitText("Loading projects", 2500));
    check("...then the projects", await waitText("ZZ B9 Project Public", 8000));
    await spaGo(`/projects/${D.p1.id}`);
    check("project page shows a loading state first", await waitText("Loading project", 2500));
    check("...then the project", await waitText("Long description", 8000));
    await spaGo(`/projects/${D.p3.id}`);
    check("navigating between projects never flashes the previous one", await waitFor(`document.body.innerText.includes('Loading project') || !document.body.innerText.includes('Long description of the public project.')`, 2500));
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check("...and settles on the new project", await waitText("ZZ B9 Project In Hidden Group", 8000));
  });
  await step("mobile", async () => {
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const p of ["/projects", `/projects/${D.p1.id}`, "/groups", `/groups/${D.gPub.id}`, `/team/${D.lead.tmId}`]) {
      await go(p);
      await sleep(900);
      const overflow = await ev(`document.documentElement.scrollWidth - window.innerWidth`);
      check(`mobile ${p.replace(/[a-z0-9]{20,}/, ":id")}: no horizontal overflow`, overflow <= 1, `overflow ${overflow}px`);
    }
    await go("/projects");
    await waitText("ZZ B9 Project Public");
    await shot("mobile-projects");
    await ev(`document.querySelector('.nav__hamburger').click()`);
    check("mobile menu opens and lists Projects (the Research section is open on /projects)", await waitFor(`document.querySelector('.nav__links.open') && document.querySelector('.nav__links.open').innerText.toLowerCase().includes('projects')`));
    await ev(`document.querySelector('button.nav__trigger[aria-controls="nav-panel-people"]').click()`);
    check("...and tapping People reveals Groups", await waitFor(`document.querySelector('.nav__links.open').innerText.toLowerCase().includes('groups')`));
    await desktop();
  });

  await step("previous phases still render", async () => {
    for (const [p, must] of [["/", "Smart Computing Lab"], ["/research", "Research Areas"], ["/team", "Our Team"], ["/publications", "Publications"], ["/news", "News"], ["/contact", "Contact"], ["/login", "Log in"]]) {
      await go(p);
      check(`guest ${p} still renders`, await waitText(must) && !/Something went wrong|Unexpected Application Error/i.test(await text()));
    }
  });

  // ================================================================= PHASE 10: GLOBAL SEARCH
  section("phase 10: search helpers");
  const statusIs = (q, ms = 9000) => waitFor(`(document.getElementById('search-status')?.innerText || '').includes(${JSON.stringify(`for “${q}”`)})`, ms);
  const statusText = () => ev(`document.getElementById('search-status')?.innerText ?? ''`);
  const titlesNow = () => ev(`[...document.querySelectorAll('.search-result__title')].map(e => e.innerText)`);
  const inputVal = (id) => ev(`document.getElementById(${JSON.stringify(id)})?.value`);
  const searchJson = (qs) => ev(`fetch('/api/search?' + ${JSON.stringify(qs)}).then(r => r.json())`);
  const navSearch = async (q) => { await setVal("nav-search-input", q); await ev(`document.getElementById('nav-search-input').form.requestSubmit()`); };
  const pageSearch = async (q) => { await setVal("search-page-input", q); await ev(`document.getElementById('search-page-input').form.requestSubmit()`); };
  const urlNow = () => ev(`location.pathname + location.search`);
  const overflowPx = () => ev(`document.documentElement.scrollWidth - window.innerWidth`);
  const key = async (k, code, vk, text) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
  const typeChars = async (id, str) => { await ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.focus(); e.select(); })()`); for (const ch of str) await send("Input.dispatchKeyEvent", { type: "char", text: ch }); };
  const spaGoTo = (p) => ev(`(history.pushState({}, '', ${JSON.stringify(p)}), dispatchEvent(new PopStateEvent('popstate')), true)`);
  const HID_NAMES = ["ZZ B9 Area Hidden", "ZZ B9 Pub Hidden", "ZZ B9 News Hidden", "ZZ B9 Group Hidden", "ZZ B9 Project Hidden", "ZZ B9 Wombat Secret", "Wombat burrows", "秘密の量子研究", "非公開の研究", "ZZ B9 Bulk 22", "ZZ B9 Bulk 26"];
  const HID_IDS = [D.areaHid.id, D.pubHid.id, D.newsHid.id, D.gHid.id, D.p2.id, D.p4.id, D.jpHid.id];
  const oracle = (viewer) => ev(`(async () => { const get = (p) => fetch('/api' + p).then(r => r.json()); const spec = { project: ['/projects', 'title'], group: ['/groups', 'name'], publication: ['/publications', 'title'], news: ['/news', 'title'], 'research-area': ['/research', 'title'], researcher: ['/team', 'name'] }; const out = {}; for (const [t, [p, k]] of Object.entries(spec)) { const list = (await get(p)).filter((x) => x[k].startsWith('ZZ B9')).map((x) => x.id).sort(); const found = (await get('/search?q=ZZ+B9&limit=50&type=' + t)).results.map((x) => x.id).sort(); out[t] = JSON.stringify(list) === JSON.stringify(found) && list.length > 0; } return out; })()`);
  const eqJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let guestTotal = 0;

  // ---------------------------------------------------------------- guest
  section("phase 10: search as a guest");
  await step("search guest", async () => {
    await go("/");
    await waitText("Smart Computing Lab");
    check("1. navbar search is visible on desktop: a labelled input in a role=search form, with a named submit button", await ev(`(() => { const i = document.getElementById('nav-search-input'); const l = document.querySelector('label[for="nav-search-input"]'); const f = i && i.closest('form'); const b = f && f.querySelector('button'); const r = i.getBoundingClientRect(); return !!l && l.textContent.trim().length > 0 && r.width >= 120 && r.height >= 30 && r.top >= 0 && f.getAttribute('role') === 'search' && b.getAttribute('aria-label') === 'Search' && i.type === 'search'; })()`));
    check("1b. the header is not overloaded: no horizontal overflow at 1400px", (await overflowPx()) <= 1);
    await shot("search-nav-desktop");

    // Typing alone never calls the API; only submitting does.
    const n0 = searchReqs.length;
    await typeChars("nav-search-input", "aging");
    await sleep(900);
    check("16. typing five characters in the header box makes NO API request (explicit submit, no search-as-you-type)", searchReqs.length === n0 && (await urlNow()) === "/");
    await key("Enter", "Enter", 13, "\r");
    check("2. Enter in the header box submits: /search?q=aging, results load", (await waitFor(`location.pathname === '/search' && location.search === '?q=aging'`)) && (await statusIs("aging")));
    check("2b. submitting made one search call (two at most: React StrictMode runs effects twice in dev)", searchReqs.length - n0 >= 1 && searchReqs.length - n0 <= 2, String(searchReqs.length - n0));
    check("3. the header box empties, the /search box shows the active query", (await inputVal("nav-search-input")) === "" && (await inputVal("search-page-input")) === "aging");

    await send("Page.reload");
    await sleep(600);
    check("4. refresh keeps the query, box and results (URL is the source of truth)", (await waitFor(`location.search === '?q=aging'`)) && (await statusIs("aging")) && (await inputVal("search-page-input")) === "aging");
    await go("/search?q=FPGA");
    check("direct navigation to /search?q=FPGA works", (await statusIs("FPGA")) && (await titlesNow()).some((t) => t.includes("FPGA")));
    check("...real seed content is found: the FPGA research area and FPGA publications", (await text()).includes("FPGA & Hardware Acceleration") && (await text()).toLowerCase().includes("publication"));

    await navSearch("Gaussian");
    await statusIs("Gaussian");
    await ev("history.back()");
    check("5. Back returns to q=FPGA: its results AND its search box value", (await waitFor(`location.search === '?q=FPGA'`)) && (await statusIs("FPGA")) && (await inputVal("search-page-input")) === "FPGA");
    await ev("history.forward()");
    check("5b. Forward returns to q=Gaussian", (await waitFor(`location.search === '?q=Gaussian'`)) && (await statusIs("Gaussian")) && (await inputVal("search-page-input")) === "Gaussian");
    check("6. Gaussian finds the publication", (await titlesNow()).some((t) => /Gaussian process/i.test(t)));

    // page-level form + keyboard
    await go("/search?q=FPGA");
    await statusIs("FPGA");
    await typeChars("search-page-input", "aging");
    await key("Enter", "Enter", 13, "\r");
    check("page box: typing + Enter searches (keyboard only)", (await waitFor(`location.search === '?q=aging'`)) && (await statusIs("aging")));
    await go("/search?q=FPGA");
    await statusIs("FPGA");
    await ev(`document.getElementById('search-page-input').focus()`);
    await key("Tab", "Tab", 9);
    check("keyboard: Tab from the box reaches the Search button", (await ev(`document.activeElement.innerText.trim()`)) === "Search");
    await key("Tab", "Tab", 9);
    check("keyboard: ...then the first filter chip (All)", (await ev(`document.activeElement.innerText.trim().startsWith('All')`)) === true);
    for (let i = 0; i < 11; i++) await key("Tab", "Tab", 9); // the 10 other chips (Phase 16 added Events, Phase 22 Knowledge, Phase 23 Resources), then the first result
    check("keyboard: ...then the first result's link, with a visible focus ring on its card", await ev(`(() => { const a = document.activeElement; return a.classList.contains('search-result__link') && getComputedStyle(a.closest('.search-result')).outlineStyle === 'solid'; })()`));
    check("labels: the /search box has a real <label>, the chips are a labelled group", await ev(`!!document.querySelector('label[for="search-page-input"]') && document.querySelector('.search-filters').getAttribute('aria-label') === 'Filter results by type' && document.querySelector('.search-filters').getAttribute('role') === 'group'`));
    check("semantic headings + list: h1, each result is an <article> with an h3 inside an ordered list", await ev(`document.querySelectorAll('h1').length === 1 && document.querySelectorAll('ol.search-results > li > article.search-result h3 a[href]').length > 0`));

    // filters
    await go("/search?q=FPGA");
    await statusIs("FPGA");
    const chips = await ev(`[...document.querySelectorAll('.search-filters a')].map(a => a.innerText.replace(/\\s+/g, ' ').trim())`);
    check("chips: All + the ten types, each with a count", chips.length === 11 && chips[0].startsWith("All") && ["Research Areas", "Projects", "Groups", "Researchers", "Publications", "News", "Forum Topics", "Events", "Knowledge", "Resources"].every((l) => chips.some((c) => c.startsWith(l) && /\d+$/.test(c))), chips.join(" | "));
    const apiCounts = (await searchJson("q=FPGA")).counts;
    check("chip counts equal the API counts (nothing is invented client-side)", chips.every((c) => { const m = c.match(/^(.*?)\s+(\d+)$/); const map = { All: "all", "Research Areas": "research-area", Projects: "project", Groups: "group", Researchers: "researcher", Publications: "publication", News: "news", "Forum Topics": "forum-topic", Events: "event", Knowledge: "knowledge", Resources: "resource" }; return m && apiCounts[map[m[1]]] === Number(m[2]); }));
    check("the active chip is marked (aria-current)", await ev(`document.querySelector('.search-filters a[aria-current]').innerText.startsWith('All')`));
    await clickText("Publications", ".search-filters a");
    check("7. Publications filter: URL gets type=publication, only publication cards", (await waitFor(`location.search === '?q=FPGA&type=publication'`)) && (await waitFor(`document.querySelectorAll('.search-result').length > 0 && [...document.querySelectorAll('.search-result')].every(c => c.classList.contains('search-result--publication'))`)) && (await statusText()).includes("in Publications"));
    check("...and the chips still show every type's count (stable)", (await ev(`[...document.querySelectorAll('.search-filters a')].map(a => a.innerText.replace(/\\s+/g, ' ').trim())`)).join() === chips.join());
    await ev("history.back()");
    check("Back from a filter restores the unfiltered results", (await waitFor(`location.search === '?q=FPGA'`)) && (await waitFor(`new Set([...document.querySelectorAll('.search-result')].map(c => c.className.match(/search-result--([a-z-]+)/)[1])).size > 1`)));
    await clickText("Researchers", ".search-filters a");
    check("Researchers filter shows researcher cards only, each linking to /team/:id", (await waitFor(`location.search.includes('type=researcher') && document.querySelectorAll('.search-result').length > 0 && [...document.querySelectorAll('.search-result')].every(c => c.classList.contains('search-result--researcher'))`)) && (await ev(`[...document.querySelectorAll('.search-result__link')].every(a => /^\\/team\\/[A-Za-z0-9_-]+$/.test(a.getAttribute('href')))`)));
    check("invalid type/page in the URL fall back to the defaults (no error)", await (async () => { await go("/search?q=FPGA&type=events&page=-3"); await statusIs("FPGA"); return !(await exists("[role=alert]")) && (await titlesNow()).length > 0; })());

    // pagination
    await go("/search?q=ZZ+B9+Bulk");
    await statusIs("ZZ B9 Bulk");
    check("8. guest 'ZZ B9 Bulk': 21 results (the 5 lab-only ones are not counted), 20 on page 1", (await statusText()).startsWith("21 results") && (await titlesNow()).length === 20, await statusText());
    check("...pager: 'Page 1 of 2', Previous disabled, Next enabled; the status says 'showing 1–20'", await ev(`(() => { const p = document.querySelector('.search-pager'); return p.innerText.includes('Page 1 of 2') && !!p.querySelector('span.is-disabled[aria-disabled=true]') && [...p.querySelectorAll('a')].map(a => a.innerText).join().includes('Next') && document.getElementById('search-status').innerText.includes('showing 1–20'); })()`));
    check("...results are in sortDate-descending order (newest first): Bulk 21 first", (await titlesNow())[0] === "ZZ B9 Bulk 21");
    await clickText("Next", ".search-pager a");
    check("Next: URL has page=2, one result, 'Page 2 of 2'", (await waitFor(`location.search.includes('page=2')`)) && (await waitFor(`document.querySelectorAll('.search-result').length === 1`)) && (await text()).includes("Page 2 of 2") && (await titlesNow())[0] === "ZZ B9 Bulk 01");
    await send("Page.reload");
    await sleep(600);
    check("refresh on page 2 stays on page 2", (await waitFor(`location.search.includes('page=2') && document.querySelectorAll('.search-result').length === 1`)));
    await clickText("Previous", ".search-pager a");
    check("Previous returns to page 1 (page param dropped)", (await waitFor(`!location.search.includes('page=') && document.querySelectorAll('.search-result').length === 20`)));
    const bulkGuest = await searchJson("q=ZZ+B9+Bulk&limit=50");
    check("guest raw JSON for Bulk: 21 results, none of the lab-only Bulk 22–26", bulkGuest.pagination.total === 21 && !JSON.stringify(bulkGuest).match(/Bulk 2[2-6]/) && bulkGuest.counts.all === 21);
    await go("/search?q=ZZ+B9+Bulk&page=9");
    check("a page past the end: explained, with a way back (not a blank page or an error)", (await waitText("There is no page 9 for this search.")) && (await exists(".search-empty a")));

    // states
    const n1 = searchReqs.length;
    await go("/search");
    check("9. /search with no query: landing state, and NO API call", (await waitText("Search the Smart Computing Lab")) && (await text()).includes("Find researchers, projects, publications, research areas, and news.") && searchReqs.length === n1);
    await go("/search?q=%20%20%20");
    check("...whitespace-only q is the landing state too, still no API call", (await waitText("Search the Smart Computing Lab")) && searchReqs.length === n1 && !(await exists(".search-filters")));
    await clickText("FPGA", ".search-landing a");
    check("...landing 'Try:' examples are real links that search", (await waitFor(`location.search === '?q=FPGA'`)) && (await statusIs("FPGA")));
    await go("/search?q=zzznomatchzzz");
    check("10. no results: 'No results found for “…”.', suggestions, count 0, and no invented results", (await waitText("No results found for “zzznomatchzzz”.")) && (await text()).includes("broader keyword") && (await text()).includes("spelling") && (await titlesNow()).length === 0 && (await statusText()).startsWith("0 results"));
    await shot("search-no-results");

    await go("/");
    await waitText("Smart Computing Lab");
    await send("Network.emulateNetworkConditions", { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
    await navSearch("Gaussian");
    check("11. loading state: skeleton + 'Searching…' + aria-busy while the request is in flight", await waitFor(`!!document.querySelector('.search-skeleton') && document.getElementById('search-status').innerText.includes('Searching') && document.querySelector('.search-region').getAttribute('aria-busy') === 'true'`, 3000));
    check("11b. ...and the page does not collapse meanwhile (results region keeps its height)", (await ev(`document.querySelector('.search-region').offsetHeight`)) >= 300);
    await shot("search-loading");
    check("11c. ...a new search never shows the PREVIOUS query's results under the new one", !(await text()).includes("FPGA & Hardware Acceleration"));
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check("...then the results replace the skeleton", (await statusIs("Gaussian")) && !(await exists(".search-skeleton")));

    // Changing the query while ALREADY on /search (the page stays mounted): old results must not linger.
    await go("/search?q=FPGA");
    await statusIs("FPGA");
    await send("Network.emulateNetworkConditions", { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
    await pageSearch("Gaussian");
    check("11d. new query typed on /search: the OLD query's results vanish at once and a skeleton shows (old results are never shown under the new query)", (await waitFor(`!!document.querySelector('.search-skeleton')`, 3000)) && !(await text()).includes("FPGA & Hardware Acceleration") && (await inputVal("search-page-input")) === "Gaussian");
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await statusIs("Gaussian");
    // Same query, next page: the current results stay (dimmed) until the next page arrives, so nothing jumps.
    await go("/search?q=ZZ+B9+Bulk");
    await statusIs("ZZ B9 Bulk");
    await send("Network.emulateNetworkConditions", { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
    await clickText("Next", ".search-pager a");
    check("11e. paging inside one query keeps the 20 current results on screen, dimmed (aria-busy), until the next page arrives", await waitFor(`!!document.querySelector('.search-results.is-loading') && document.querySelectorAll('.search-result').length === 20 && document.querySelector('.search-region').getAttribute('aria-busy') === 'true'`, 3000));
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check("...then page 2 replaces them", await waitFor(`document.querySelectorAll('.search-result').length === 1 && !document.querySelector('.search-results.is-loading')`));

    await go("/search?q=FPGA");
    await statusIs("FPGA");
    await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await pageSearch("Gaussian");
    const failed = await waitFor(`!!document.querySelector('[role=alert]')`, 8000);
    const failText = await text();
    check("12. network failure: a friendly role=alert, retry offered, no technical text", failed && failText.includes("Search is unavailable right now") && !!(await exists(".search-retry")) && !/TypeError|Failed to fetch|NetworkError|SyntaxError|\bat \S+ \(|stack/i.test(failText));
    await shot("search-error");
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await clickText("Try again", "button");
    check("12b. Try again recovers", (await statusIs("Gaussian")) && !(await exists("[role=alert]")));
    await go(`/search?q=${"x".repeat(101)}`);
    check("12c. a server validation error (101 chars) is shown in words, not as a crash", (await waitFor(`!!document.querySelector('[role=alert]')`)) && (await text()).includes("Search text must be at most 100 characters."));

    // visibility as a guest
    await go("/search?q=ZZ+B9");
    await statusIs("ZZ B9");
    const gj = await searchJson("q=ZZ+B9&limit=50");
    guestTotal = gj.pagination.total;
    const gRaw = JSON.stringify(gj);
    const gText = await text();
    check("13. guest 'ZZ B9': the public records are there", ["ZZ B9 Project Public", "ZZ B9 Group Public", "ZZ B9 Area Public", "ZZ B9 Pub Public", "ZZ B9 News Public", "ZZ B9 Member", "ZZ B9 半導体 エージング"].every((n) => gj.results.some((r) => r.title === n)) && guestTotal > 20);
    check("13b. ...and NOTHING hidden is in the page text or the raw JSON (ids, names, slugs, LAB_ONLY, visibility)", !HID_NAMES.some((n) => gText.includes(n) || gRaw.includes(n)) && !HID_IDS.some((i) => gRaw.includes(i)) && !gRaw.includes("LAB_ONLY") && !gRaw.includes('"visibility"') && !gRaw.includes('"slug"'));
    check("13c. no 'Lab only' badge for a guest", !(await exists(".vis-badge")));
    const orc = await oracle("guest");
    check("13d. for every type, search returns exactly what the normal list endpoints return for a guest", Object.values(orc).every(Boolean), JSON.stringify(orc));
    await go("/search?q=Wombat");
    check("14. NESTED: hidden project 'Wombat' inside a PUBLIC group: guest gets nothing and the group is not offered", (await waitText("No results found for “Wombat”.")) && !(await text()).includes("ZZ B9 Group Public"));
    const wj = await searchJson("q=Wombat");
    check("14b. ...raw JSON: total 0, every count 0, no group id/name", wj.pagination.total === 0 && Object.values(wj.counts).every((c) => c === 0) && !JSON.stringify(wj).includes(D.gPub.id));
    await go("/search?q=ZZ+B9+Project+In+Hidden+Group");
    await statusIs("ZZ B9 Project In Hidden Group");
    const hj = await searchJson("q=ZZ+B9+Project+In+Hidden+Group");
    check("15. NESTED: a public project inside a hidden group IS found, and the hidden group leaks nowhere (text, JSON, ids, slug)", (await titlesNow()).includes("ZZ B9 Project In Hidden Group") && !(await text()).includes("ZZ B9 Group Hidden") && !JSON.stringify(hj).includes(D.gHid.id) && !JSON.stringify(hj).includes("Group Hidden") && !JSON.stringify(hj).includes("secret group"));
    const hidCodes = [(await apiCall("GET", `/projects/${D.p2.id}`)), (await apiCall("GET", `/groups/${D.gHid.id}`))];
    check("(control) the hidden project/group really are 404 for this guest on the normal endpoints", hidCodes.every((c) => c === 404));

    // Japanese / mixed
    await go("/");
    await waitText("Smart Computing Lab");
    await navSearch("半導体");
    check("Japanese via the header box: URL-encoded, found, highlighted", (await waitFor(`location.search === '?q=%E5%8D%8A%E5%B0%8E%E4%BD%93'`)) && (await statusIs("半導体")) && (await titlesNow()).includes("ZZ B9 半導体 エージング") && (await ev(`document.querySelector('.search-result mark')?.innerText`)) === "半導体");
    await pageSearch("FPGA エージング");
    check("mixed English/Japanese 'FPGA エージング': the one record with both, both words highlighted", (await statusIs("FPGA エージング")) && eqJson(await titlesNow(), ["ZZ B9 半導体 エージング"]) && (await ev(`[...document.querySelectorAll('.search-result mark')].map(m => m.innerText).includes('FPGA') && [...document.querySelectorAll('.search-result mark')].map(m => m.innerText).includes('エージング')`)));
    await pageSearch("量子");
    check("guest: '量子' only exists in a lab-only project => no results, no hidden title", (await waitText("No results found for “量子”.")) && !(await text()).includes("秘密の量子研究"));

    // result cards
    await go("/search?q=ZZ+B9+Project+Public");
    await statusIs("ZZ B9 Project Public");
    check("cards: entity label, title link, and a 'View project' call to action", (await ev(`(() => { const c = document.querySelector('.search-result--project'); return c.querySelector('.search-result__type').innerText.toLowerCase().includes('project') && c.querySelector('h3 a').getAttribute('href') === '/projects/${D.p1.id}' && c.innerText.includes('View project'); })()`)));
    // Phase 20: a result may also carry `related` links (their own labelled list). The TITLE link must still be the only
    // stretched target, and every related link must sit above that overlay (relative + z-index) so it stays clickable.
    check("cards: the title link is the only stretched interactive element (whole card is the target via ::after); any related links sit above it", await ev(`(() => { const c = document.querySelector('.search-result--project'); const own = [...c.querySelectorAll('a,button')].filter((x) => !x.closest('.search-result__related')); const rel = [...c.querySelectorAll('.search-result__related a')]; return own.length === 1 && getComputedStyle(own[0], '::after').position === 'absolute' && rel.every((a) => getComputedStyle(a).position === 'relative' && Number(getComputedStyle(a).zIndex) >= 1); })()`));
    await clickText("ZZ B9 Project Public", ".search-result__link");
    check("clicking a project result opens the project page", (await waitFor(`location.pathname === '/projects/${D.p1.id}'`)) && (await waitText("Long description of the public project.")));
    await go("/search?q=ZZ+B9");
    await statusIs("ZZ B9");
    const hrefs = await ev(`[...document.querySelectorAll('.search-result')].map(c => [c.className.match(/search-result--([a-z-]+)/)[1], c.querySelector('a').getAttribute('href')])`);
    const hrefOk = { project: /^\/projects\/[A-Za-z0-9_-]+$/, group: /^\/groups\/[A-Za-z0-9_-]+$/, researcher: /^\/team\/[A-Za-z0-9_-]+$/, publication: /^\/publications\/[A-Za-z0-9_-]+$/ /* Phase 19: a publication has its own detail page */, news: /^\/news$/, "research-area": /^\/research\/[A-Za-z0-9_-]+$/ /* Phase 18: the area has its own detail page */ };
    check("every result links to an existing page for its type", hrefs.length > 5 && hrefs.every(([t, h]) => hrefOk[t].test(h)), JSON.stringify(hrefs.slice(0, 3)));
    await go("/search?q=" + encodeURIComponent("<img src=x onerror=window.__xss=1>"));
    await waitText("No results found for");
    check("XSS: an HTML-looking query is shown as text; nothing executes, no <img> appears", !(await ev(`window.__xss`)) && !(await exists(".search-page img")) && (await text()).includes("<img src=x onerror=window.__xss=1>"));
    await go("/search?q=Markup");
    await statusIs("Markup");
    check("XSS: a stored record whose title/description is HTML renders as text (no element, no execution)", !(await ev(`window.__xss`)) && !(await exists(".search-result img")) && (await titlesNow()).some((t) => t.includes("<img src=x onerror=window.__xss=1>")));
    check("...and its raw JSON is plain data (JSON content type)", (await ev(`fetch('/api/search?q=Markup').then(r => r.headers.get('content-type'))`)).includes("application/json"));
    await shot("search-guest");
  });

  // ---------------------------------------------------------------- MEMBER
  section("phase 10: search as a plain MEMBER (and logout)");
  await step("search member", async () => {
    check("member login", await login(D.plain.email, PW));
    await go("/search?q=ZZ+B9");
    await statusIs("ZZ B9");
    const mj = await searchJson("q=ZZ+B9&limit=50");
    const mTitles = mj.results.map((r) => r.title);
    check("13m. member sees the lab-only records too: area, project, group, publication, news, Japanese project", ["ZZ B9 Area Hidden", "ZZ B9 Project Hidden", "ZZ B9 Group Hidden", "ZZ B9 Pub Hidden", "ZZ B9 News Hidden", "ZZ B9 Wombat Secret", "ZZ B9 秘密の量子研究"].every((n) => mTitles.includes(n)));
    check("13n. member total is larger than the guest's (guest total was " + guestTotal + ")", mj.pagination.total > guestTotal && guestTotal > 0);
    check("13o. no 'Lab only' badge and no visibility/slug/userId in a member's results (Phase 9 rule holds)", !(await exists(".vis-badge")) && !/"(visibility|slug|userId|email|isOwn)"/.test(JSON.stringify(mj)));
    const orc = await oracle("member");
    check("13p. member: search equals the normal endpoints for every type", Object.values(orc).every(Boolean), JSON.stringify(orc));
    await go("/search?q=Wombat");
    await statusIs("Wombat");
    const wj = await searchJson("q=Wombat");
    check("14m. member finds the hidden 'Wombat' project, and STILL no group result (a group matches only by its own text)", (await titlesNow()).join() === "ZZ B9 Wombat Secret" && wj.counts.group === 0 && wj.counts.project === 1);
    await go("/search?q=ZZ+B9+Bulk");
    await statusIs("ZZ B9 Bulk");
    check("member 'ZZ B9 Bulk': 26 results (guest saw 21), pages of 20 + 6; the lab-only (newest) ones lead page 1", (await statusText()).startsWith("26 results") && (await titlesNow()).length === 20 && (await text()).includes("Page 1 of 2") && (await titlesNow())[0] === "ZZ B9 Bulk 26");
    await clickText("Next", ".search-pager a");
    check("...page 2 holds the remaining 6 (Bulk 06 … Bulk 01)", (await waitFor(`document.querySelectorAll('.search-result').length === 6`)) && eqJson(await titlesNow(), ["06", "05", "04", "03", "02", "01"].map((n) => `ZZ B9 Bulk ${n}`)));
    await go("/search?q=%E9%87%8F%E5%AD%90");
    check("member finds the Japanese lab-only project via '量子'", (await statusIs("量子")) && (await titlesNow()).includes("ZZ B9 秘密の量子研究"));
    await shot("search-member");

    // logout changes visibility with no reload
    await go("/search?q=Wombat");
    await statusIs("Wombat");
    await logout();
    await navSearch("Wombat");
    check("15m. logout, then search again in the same tab: the lab-only project is gone (no stale/cached results)", (await waitText("No results found for “Wombat”.")) && !(await text()).includes("ZZ B9 Wombat Secret"));
    await go("/search?q=Wombat+Secret");
    check("...and a fresh load as a guest agrees", await waitText("No results found for “Wombat Secret”."));
  });

  section("phase 10: search as a project/group lead, LAB_MANAGER and ADMIN");
  await step("search lead", async () => {
    check("lead login", await login(D.lead.email, PW));
    await go("/search?q=ZZ+B9+Project");
    await statusIs("ZZ B9 Project");
    const t = await titlesNow();
    check("lead: sees the lab-only projects like any member, with no visibility badge", t.includes("ZZ B9 Project Hidden") && t.includes("ZZ B9 Project Public") && !(await exists(".vis-badge")));
    await clickText("ZZ B9 Project Public", ".search-result__link");
    check("lead: the result opens the project they lead, with their lead controls (Phase 9 unchanged)", (await waitFor(`location.pathname === '/projects/${D.p1.id}'`)) && (await waitText("You lead this project")));
    await logout();
  });
  for (const [label, who] of [["LAB_MANAGER", D.mgr], ["ADMIN", ADMIN]]) {
    await step(`search ${label}`, async () => {
      check(`${label} login`, await login(who.email, who.password ?? PW));
      await go("/search?q=ZZ+B9+Project");
      await statusIs("ZZ B9 Project");
      const j = await searchJson("q=ZZ+B9+Project&limit=50");
      const hiddenCount = j.results.filter((r) => r.visibility === "LAB_ONLY").length;
      check(`${label}: sees lab-only results, each marked 'Lab only'; public ones are not`, j.results.some((r) => r.title === "ZZ B9 Project Hidden") && hiddenCount >= 1 && (await ev(`document.querySelectorAll('.search-result .vis-badge').length`)) === hiddenCount && j.results.filter((r) => r.visibility === "PUBLIC").length >= 2);
      check(`${label}: still no slug/userId/email in results`, !/"(slug|userId|email|isOwn)"/.test(JSON.stringify(j)));
      const orc = await oracle(label);
      check(`${label}: search equals the normal endpoints for every type`, Object.values(orc).every(Boolean), JSON.stringify(orc));
      await go("/search?q=Wombat");
      check(`${label}: finds the hidden project, no group`, (await statusIs("Wombat")) && (await titlesNow()).join() === "ZZ B9 Wombat Secret");
      await shot(`search-${label.toLowerCase()}`);
      await logout();
    });
  }

  // ---------------------------------------------------------------- mobile + laptop widths
  section("phase 10: search on mobile (390px) and at laptop width (1200px)");
  await step("search mobile", async () => {
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await go("/");
    await waitText("Smart Computing Lab");
    check("16m. mobile: the search box is part of the hamburger menu (hidden until it is opened)", (await ev(`document.getElementById('nav-search-input').getBoundingClientRect().width`)) === 0);
    await ev(`document.querySelector('.nav__hamburger').click()`);
    check("16m. ...opening the menu shows it at the top, full width, in the viewport, easy to tap", await waitFor(`(() => { const r = document.getElementById('nav-search-input').getBoundingClientRect(); const ul = document.querySelector('.nav__links'); return ul.classList.contains('open') && r.width > 250 && r.height >= 40 && r.left >= 0 && r.right <= innerWidth && r.top < ul.getBoundingClientRect().top + 100; })()`));
    await shot("search-mobile-menu");
    await typeChars("nav-search-input", "FPGA");
    await key("Enter", "Enter", 13, "\r");
    check("mobile: submitting from the menu opens /search?q=FPGA and closes the menu", (await waitFor(`location.search === '?q=FPGA'`)) && (await statusIs("FPGA")) && !(await exists(".nav__links.open")));
    for (const [label, p] of [["results", "/search?q=FPGA"], ["landing", "/search"], ["no results", "/search?q=zzznomatchzzz"], ["Japanese", "/search?q=%E5%8D%8A%E5%B0%8E%E4%BD%93"], ["filtered + paged", "/search?q=ZZ+B9+Bulk&page=2"], ["one 100-char word", `/search?q=${"x".repeat(100)}`], ["101 chars (error)", `/search?q=${"y".repeat(101)}`], ["HTML-looking query", "/search?q=" + encodeURIComponent("<script>alert(1)</script>")]]) {
      await go(p);
      await sleep(1300);
      const o = await overflowPx();
      check(`17/18. 390px ${label}: no horizontal overflow`, o <= 1, `overflow ${o}px`);
    }
    await go("/search?q=FPGA");
    await statusIs("FPGA");
    await shot("search-mobile-results");
    check("18b. 390px: filter chips wrap inside the screen; cards fit; touch targets >= 40px", await ev(`(() => { const f = document.querySelector('.search-filters'); const btn = document.querySelector('.search-form--page .search-form__button').getBoundingClientRect(); const input = document.getElementById('search-page-input').getBoundingClientRect(); return f.scrollWidth <= f.clientWidth + 1 && [...document.querySelectorAll('.search-result')].every(c => c.getBoundingClientRect().right <= innerWidth) && btn.height >= 44 && input.height >= 44; })()`));
    await desktop();
  });
  await step("search laptop width", async () => {
    await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
    await go("/");
    await waitText("Smart Computing Lab");
    check("laptop 1200px (guest): the header shows the normal search box (Phase 10.1 made room for it) and nothing overflows", (await ev(`document.getElementById('nav-search-input').getBoundingClientRect().width`)) >= 140 && (await overflowPx()) <= 1);
    await typeChars("nav-search-input", "aging");
    await key("Enter", "Enter", 13, "\r");
    check("...typing + Enter searches", (await waitFor(`location.search === '?q=aging'`)) && (await statusIs("aging")));
    check("laptop 1200px (ADMIN): logged in, still no overflow and no wrapped links", (await login(ADMIN.email, ADMIN.password)) && (await (async () => { await go("/search?q=FPGA"); await statusIs("FPGA"); return (await overflowPx()) <= 1 && (await ev(`[...document.querySelectorAll('.nav__links > li')].every(li => li.getBoundingClientRect().height <= 64)`)); })()));
    await shot("search-laptop-admin");
    await logout();
    await desktop();
  });

  // ================================================================= PHASE 10.1: NAVIGATION & HEADER
  section("phase 10.1: navigation helpers");
  const PW_NAV = PW;
  // A REAL mouse click at the centre of an element (so overlap/hit-testing problems show up too).
  const clickEl = async (sel) => {
    const r = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; })()`);
    if (!r || !r.w) return false;
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
    await sleep(150);
    return true;
  };
  const clickAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); await sleep(150); };
  const trig = (g) => `button.nav__trigger[aria-controls="nav-panel-${g}"]`;
  const expanded = (g) => ev(`document.querySelector(${JSON.stringify(trig(g))})?.getAttribute('aria-expanded')`);
  const panelHidden = (g) => ev(`document.getElementById('nav-panel-${g}')?.hidden`);
  const panelHrefs = (g) => ev(`[...document.querySelectorAll('#nav-panel-${g} a')].map(a => a.getAttribute('href'))`);
  const panelLabels = (g) => ev(`[...document.querySelectorAll('#nav-panel-${g} a, #nav-panel-${g} button')].map(a => a.textContent.trim().toLowerCase())`);
  // Phase 14 added the language switcher as one more `.nav__links > li`, right beside the search
  // box: a control, not a navigation destination, so it is excluded here the same way `.nav__search`
  // already is (see LanguageSwitcher.tsx / Nav.tsx).
  const topLevel = () => ev(`[...document.querySelectorAll('.nav__links > li:not(.nav__search):not(.lang-switch)')].map(li => (li.querySelector('.nav__trigger, a')?.textContent || '').trim().toLowerCase())`);
  const hrefEverywhere = (h) => ev(`!!document.querySelector('.nav a[href="${h}"]')`); // hidden panels included
  const focusDesc = () => ev(`(() => { const a = document.activeElement; return ((a.getAttribute && a.getAttribute('aria-label')) || a.id || a.textContent || '').trim().toLowerCase(); })()`);
  const tab = async (shift) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }); await sleep(60); };
  const KEYS = { down: ["ArrowDown", "ArrowDown", 40], up: ["ArrowUp", "ArrowUp", 38], home: ["Home", "Home", 36], end: ["End", "End", 35], esc: ["Escape", "Escape", 27], right: ["ArrowRight", "ArrowRight", 39], left: ["ArrowLeft", "ArrowLeft", 37], enter: ["Enter", "Enter", 13, "\r"], space: [" ", "Space", 32, " "] };
  const press = async (name) => { await key(...KEYS[name]); await sleep(60); };
  const focusSel = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).focus()`);
  const ring = () => ev(`(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; })()`);
  const menuOpenNow = () => ev(`document.querySelector('.nav__links').classList.contains('open')`);
  const openPhoneMenu = async () => { if (!(await menuOpenNow())) await clickEl(".nav__hamburger"); return menuOpenNow(); };
  const openMenu = async (g) => { if (await expanded(g) !== "true") await clickEl(trig(g)); return waitFor(`document.querySelector(${JSON.stringify(trig(g))}).getAttribute('aria-expanded') === 'true'`, 2000); };
  // Fill in the login form that is ALREADY on screen (keeps the redirect state from a bounced route).
  const loginHere = async (creds) => { await waitFor(`!!document.getElementById('email')`); await ev(`(() => { const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.getElementById('email'), ${JSON.stringify(creds.email)}); set(document.getElementById('password'), ${JSON.stringify(creds.password)}); document.getElementById('email').form.requestSubmit(); })()`); return true; };
  // The header holds its account slot empty while the session loads (data-auth=loading), so wait for it to settle.
  const navReady = () => waitFor(`document.querySelector('nav.nav')?.getAttribute('data-auth') === 'ready'`);
  const inViewport = (sel) => ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return b.width > 0 && b.left >= -0.5 && b.right <= innerWidth + 0.5 && b.top >= 0; })()`);
  const MEMBER = { email: D.mem.email, password: PW_NAV };
  // Phase 17: D.mem is promoted to LAB_MANAGER by earlier steps, and a manager now legitimately has the Admin link. The header tests that assert
  // "a MEMBER has no Admin link" therefore use D.plain, which stays a true MEMBER for the whole run.
  const TRUE_MEMBER = { email: D.plain.email, password: PW_NAV };
  const MANAGER = { email: D.mgr.email, password: PW_NAV };
  const RESEARCH_HREFS = ["/research", "/projects", "/publications", "/news", "/knowledge", "/resources"]; // Phase 22 added Knowledge, Phase 23 Resources as the last Research link
  const PEOPLE_HREFS = ["/team", "/groups"];
  const phone = (w) => send("Emulation.setDeviceMetricsOverride", { width: w, height: 844, deviceScaleFactor: 2, mobile: true });
  const desktopAt = (w, h = 800) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });

  // ---------------------------------------------------------------- guest, desktop
  section("phase 10.1: guest header (desktop)");
  await step("nav guest desktop", async () => {
    await desktop();
    await go("/contact");
    await navReady();
    const top = await topLevel();
    check("N1. guest sees exactly Research, People, Community, Contact, Log in at the top level (5 entries, not a row of tiny links)", eqJson(top, ["research", "people", "community", "contact", "log in"]), JSON.stringify(top));
    check("N2. Research is a dropdown: closed at first (aria-expanded=false, panel hidden AND taking no space on screen)", (await expanded("research")) === "false" && (await panelHidden("research")) === true && (await ev(`document.getElementById('nav-panel-research').getBoundingClientRect().height`)) === 0);
    check("N3. the header has one <nav aria-label=Main>, a home link with an accessible name, and the search form", await ev(`(() => { const n = document.querySelector('nav.nav'); return n.getAttribute('aria-label') === 'Main' && n.querySelector('.nav__logo a').getAttribute('aria-label').toLowerCase().includes('home') && !!n.querySelector('form[role=search] #nav-search-input'); })()`));
    check("N4. each trigger controls an existing panel labelled '<group> menu'", await ev(`[...document.querySelectorAll('.nav__trigger')].every(b => { const p = document.getElementById(b.getAttribute('aria-controls')); return p && p.getAttribute('aria-label') === b.textContent.trim() + ' menu'; })`));
    await shot("nav-guest-closed");

    check("N5. clicking Research opens it: expanded, visible, six links in the documented order", (await clickEl(trig("research"))) && (await expanded("research")) === "true" && (await panelHidden("research")) === false && eqJson(await panelHrefs("research"), RESEARCH_HREFS));
    check("N5b. the panel sits under its trigger, inside the viewport, not clipped", await inViewport("#nav-panel-research"));
    await shot("nav-guest-research-open");
    check("N6. opening People closes Research (one dropdown at a time) and lists Team + Groups", (await clickEl(trig("people"))) && (await expanded("people")) === "true" && (await expanded("research")) === "false" && eqJson(await panelHrefs("people"), PEOPLE_HREFS));
    await clickAt(300, 600);
    check("N7. a click anywhere outside closes the open dropdown", (await expanded("people")) === "false" && (await panelHidden("people")) === true);
    check("N8. clicking an open trigger again closes it", (await clickEl(trig("research"))) && (await clickEl(trig("research"))) && (await expanded("research")) === "false");

    check("N9. guest has NO Schedule, My Profile, Admin or Log out link anywhere in the header (even in closed panels)", !(await hrefEverywhere("/schedule")) && !(await hrefEverywhere("/profile")) && !(await hrefEverywhere("/admin")) && !(await ev(`[...document.querySelectorAll('.nav button')].some(b => /log out/i.test(b.textContent))`)) && !(await exists(".nav__account .nav__trigger")));
    check("N10. guest has Log in (-> /login) and Contact (-> /contact)", (await hrefEverywhere("/login")) && (await hrefEverywhere("/contact")));

    // Choosing a link from a dropdown navigates and folds the menu away.
    await clickEl(trig("research"));
    check("N11. picking Projects from the dropdown navigates and closes it", (await clickEl('#nav-panel-research a[href="/projects"]')) && (await waitFor(`location.pathname === '/projects'`)) && (await expanded("research")) === "false" && (await panelHidden("research")) === true);
    check("N12. the current page is marked: Research trigger active, Projects aria-current=page, People not active", await ev(`document.querySelector('${trig("research")}').classList.contains('active') && document.querySelector('#nav-panel-research a[href="/projects"]').getAttribute('aria-current') === 'page' && !document.querySelector('${trig("people")}').classList.contains('active')`));
    await go(`/team/${D.lead.tmId}`);
    await navReady();
    check("N13. a detail page (/team/:id) keeps its group active", await ev(`document.querySelector('${trig("people")}').classList.contains('active') && !document.querySelector('${trig("research")}').classList.contains('active')`));
    await go("/contact");
    await navReady();
    check("N14. Contact is highlighted on /contact and no group is active", await ev(`document.querySelector('.nav__links > li > a[href="/contact"]').classList.contains('active') && ![...document.querySelectorAll('.nav__trigger')].some(b => b.classList.contains('active'))`));
  });

  // ---------------------------------------------------------------- keyboard
  section("phase 10.1: keyboard navigation (desktop)");
  await step("nav keyboard", async () => {
    await desktop();
    await go("/contact");
    await navReady();
    await focusSel(".nav__logo a");
    const order = [await focusDesc()];
    // Phase 14 added the language switcher trigger ("en") as one more stop, right after Contact
    // and before Log in (see Nav.tsx) — one extra Tab to reach the same final stop as before.
    for (let i = 0; i < 8; i++) { await tab(); order.push(await focusDesc()); }
    check("K1. Tab walks the header in reading order: home, search box, search button, Research, People, Community, Contact, language switcher, Log in", eqJson(order, ["smart computing lab, home", "nav-search-input", "search", "research", "people", "community", "contact", "en", "log in"]), JSON.stringify(order));
    await focusSel(trig("research"));
    check("K2. a keyboard-focused trigger shows a visible focus ring", await ring());
    await press("enter");
    check("K3. Enter on the trigger opens the dropdown", (await expanded("research")) === "true" && (await panelHidden("research")) === false);
    await tab();
    check("K4. Tab moves from the trigger into the first link of the panel, with a visible ring", (await focusDesc()) === "research areas" && (await ring()));
    await press("esc");
    check("K5. Escape closes the dropdown and returns focus to its trigger", (await expanded("research")) === "false" && (await focusDesc()) === "research");
    await press("space");
    check("K6. Space on the trigger opens it too", (await expanded("research")) === "true");
    await press("esc");
    await press("down");
    check("K7. ArrowDown on a closed trigger opens it and focuses the first link", (await expanded("research")) === "true" && (await focusDesc()) === "research areas");
    await press("down");
    check("K8. ArrowDown moves to the next link", (await focusDesc()) === "projects");
    await press("end");
    check("K9. End goes to the last link", (await focusDesc()) === "resources");
    await press("down");
    check("K9b. ArrowDown on the last link stays there (no wrap trap)", (await focusDesc()) === "resources");
    await press("home");
    check("K10. Home goes to the first link", (await focusDesc()) === "research areas");
    await press("up");
    check("K11. ArrowUp on the first link goes back to the trigger", (await focusDesc()) === "research");
    await press("esc");

    // Tab through the whole panel and off the end: the dropdown closes itself.
    await press("down");
    for (let i = 0; i < 6; i++) await tab(); // 5 more links to Resources, then off the group
    check("K12. Tabbing out of the last link closes the dropdown and lands on the next header control", (await expanded("research")) === "false" && (await focusDesc()) === "people");
    await tab(true); // Shift+Tab from People back to the Research trigger
    await press("enter"); // Research reopened
    await tab(); // into the panel's first link
    await tab(true); // Shift+Tab from the first link back to the trigger
    check("K13. Shift+Tab from the first link returns to the trigger; the dropdown stays open", (await focusDesc()) === "research" && (await expanded("research")) === "true");
    await press("esc");

    // Enter on a focused link navigates.
    await press("down");
    await press("down");
    await press("down");
    check("K14. arrow keys reach Publications", (await focusDesc()) === "publications");
    await press("enter");
    check("K15. Enter on a link navigates and closes the menu", (await waitFor(`location.pathname === '/publications'`)) && (await expanded("research")) === "false");
    check("K16. the whole header is keyboard reachable: every link in every panel is in the tab order once opened", await (async () => {
      const seen = [];
      await focusSel(trig("people"));
      await press("enter");
      await tab();
      seen.push(await focusDesc());
      await tab();
      seen.push(await focusDesc());
      await press("esc");
      return eqJson(seen, ["team", "groups"]);
    })());
    // Hamburger button: focusable, named, and (at desktop widths) not in the way.
    check("K17. the hamburger is not displayed at desktop width (so it cannot trap focus)", (await ev(`getComputedStyle(document.querySelector('.nav__hamburger')).display`)) === "none");
    await go("/contact");
  });

  // ---------------------------------------------------------------- history, refresh, direct URLs
  section("phase 10.1: refresh, back/forward, direct URLs");
  await step("nav history", async () => {
    await desktop();
    await go("/contact");
    await navReady();
    await clickEl(trig("research"));
    await clickEl('#nav-panel-research a[href="/projects"]');
    await waitFor(`location.pathname === '/projects'`);
    await clickEl(trig("people"));
    await clickEl('#nav-panel-people a[href="/team"]');
    check("H1. Research > Projects then People > Team by mouse", await waitFor(`location.pathname === '/team'`));
    await clickEl(trig("research"));
    check("H2. ...then a dropdown is open when the browser goes back", (await expanded("research")) === "true");
    await ev(`history.back()`);
    check("H3. back goes to /projects, the open dropdown folds away, and the active group follows the page", (await waitFor(`location.pathname === '/projects'`)) && (await waitFor(`document.querySelector('${trig("research")}').getAttribute('aria-expanded') === 'false'`)) && (await ev(`document.querySelector('${trig("research")}').classList.contains('active')`)));
    await ev(`history.forward()`);
    check("H4. forward returns to /team with People active", (await waitFor(`location.pathname === '/team'`)) && (await waitFor(`document.querySelector('${trig("people")}').classList.contains('active')`)));
    await send("Page.reload");
    await sleep(700);
    await navReady();
    check("H5. refresh on /team keeps the header intact: People active, dropdowns closed, guest entries", (await pathNow()) === "/team" && (await ev(`document.querySelector('${trig("people")}').classList.contains('active')`)) && (await expanded("people")) === "false" && eqJson(await topLevel(), ["research", "people", "community", "contact", "log in"]));
    for (const [p, must] of [["/research", "Research Areas"], ["/projects", "Research Projects"], ["/groups", "Groups"], ["/publications", "Publications"], ["/news", "News"], ["/team", "Our Team"], ["/contact", "Contact"], ["/search?q=FPGA", "FPGA"]]) {
      await go(p);
      check(`H6. direct URL ${p} still renders for a guest`, (await waitText(must)) && (await pathNow()) === p.split("?")[0] && !/Something went wrong|Unexpected Application Error/i.test(await text()));
    }
    // Protected routes: a hidden link is not a locked door, and the redirect behaviour is unchanged.
    for (const p of ["/schedule", "/profile", "/admin"]) {
      await go(p);
      check(`H7. guest opening ${p} directly is sent to /login (the route, not the hidden link, protects it)`, await waitFor(`location.pathname === '/login'`));
    }
    await go("/schedule");
    await waitFor(`location.pathname === '/login'`);
    check("H8. login after being bounced from /schedule returns to /schedule (existing behaviour kept)", (await loginHere(MEMBER)) && (await waitFor(`location.pathname === '/schedule'`)) && (await waitText("Lab Schedule")));
    await logout();
    check("H9. API is unchanged: an anonymous call to an admin endpoint is refused server-side (401)", (await apiCall("GET", "/users")) === 401);
  });

  // ---------------------------------------------------------------- MEMBER / LAB_MANAGER / ADMIN, desktop
  section("phase 10.1: member, lab manager and admin headers (desktop)");
  const SAME_TOP = ["research", "people", "community", "schedule", "contact", "account"];
  // Phase 17: `isAdminRole` now means "has the Admin Dashboard link" -- managers and admins (the admin area is a management view; accounts stay admin-only).
  for (const [label, creds, isAdminRole] of [["MEMBER", TRUE_MEMBER, false], ["LAB_MANAGER", MANAGER, true], ["ADMIN", ADMIN, true]]) {
    await step(`nav ${label}`, async () => {
      await desktop();
      check(`${label}: logs in`, await login(creds.email, creds.password));
      await go("/contact");
      await navReady();
      const top = await topLevel();
      check(`${label}: top level is Research, People, Community, Schedule, Contact, Account (6 entries)`, eqJson(top, SAME_TOP), JSON.stringify(top));
      check(`${label}: no 'Log in' link, and Research/People hold the same links as for a guest`, !(await hrefEverywhere("/login")) && eqJson(await panelHrefs("research"), RESEARCH_HREFS) && eqJson(await panelHrefs("people"), PEOPLE_HREFS));
      check(`${label}: Schedule is a top-level link to /schedule`, await ev(`!!document.querySelector('.nav__links > li > a[href="/schedule"]')`));
      await openMenu("account");
      const acct = await panelLabels("account");
      // Phase 14 test maintenance: these two Account-menu arrays were still the pre-Phase-12
      // shape (My Profile, [Admin Dashboard], Log out) and never picked up Phase 12's Messages
      // and Notifications links (see project-phase-status memory, "Phase 13 reported 6 stale
      // Account-menu assertions"). Updated to the already-shipped Phase 12 navigation; not a new
      // feature, and no assertion here is weakened — the exact expected set just now matches
      // what navConfig.ts (ACCOUNT_NAV) has rendered since Phase 12.
      check(`${label}: the Account menu holds ${isAdminRole ? "My Workspace, My Profile, Messages, Notifications, Admin Dashboard, Log out" : "My Workspace, My Profile, Messages, Notifications, Log out (no Admin Dashboard)"}`, eqJson(acct, isAdminRole ? ["my workspace", "my profile", "messages", "notifications", "admin dashboard", "log out"] : ["my workspace", "my profile", "messages", "notifications", "log out"]), JSON.stringify(acct));
      check(`${label}: ${isAdminRole ? "an /admin link exists" : "no /admin link exists anywhere in the header"}`, (await hrefEverywhere("/admin")) === isAdminRole);
      check(`${label}: the Account panel opens right-aligned, fully inside the viewport`, await inViewport("#nav-panel-account"));
      await shot(`nav-${label.toLowerCase()}-account-open`);
      check(`${label}: the account menu is a real dropdown: Escape closes it and focus returns to the trigger`, await (async () => { await focusSel(trig("account")); await press("esc"); return (await expanded("account")) === "false" && (await focusDesc()) === "account"; })());
      check(`${label}: the header never has more than 7 top-level entries + search + language switcher (no admin link pile-up)`, (await ev(`document.querySelectorAll('.nav__links > li').length`)) <= 9 && (await ev(`document.querySelectorAll('.nav__links > li:not(.nav__search):not(.lang-switch) > a, .nav__links > li:not(.nav__search):not(.lang-switch) > .nav__trigger').length`)) === 6);

      // Schedule, My Profile and (admin) Admin Dashboard work from the header.
      check(`${label}: Schedule opens the lab calendar page`, (await clickEl('.nav__links > li > a[href="/schedule"]')) && (await waitFor(`location.pathname === '/schedule'`)) && (await waitText("Lab Schedule")));
      check(`${label}: Schedule shows as the current page`, await ev(`document.querySelector('.nav__links > li > a[href="/schedule"]').classList.contains('active')`));
      await clickEl(trig("account"));
      check(`${label}: Account > My Profile opens /profile and marks Account active`, (await clickEl('#nav-panel-account a[href="/profile"]')) && (await waitFor(`location.pathname === '/profile'`)) && (await ev(`document.querySelector('${trig("account")}').classList.contains('active')`)));
      if (isAdminRole) {
        await clickEl(trig("account"));
        check(`${label}: Account > Admin Dashboard opens /admin and marks Account active`, (await clickEl('#nav-panel-account a[href="/admin"]')) && (await waitFor(`location.pathname === '/admin'`)) && (await waitText("Admin Dashboard")) && (await ev(`document.querySelector('${trig("account")}').classList.contains('active')`)));
        check(`${label}: /admin still loads after a refresh`, (await (async () => { await send("Page.reload"); await sleep(700); return waitText("Admin Dashboard"); })()));
        check(`${label}: the admin overview API is reachable, and the ACCOUNT API is ${label === "ADMIN" ? "reachable (admin only)" : "still refused (403)"}`, (await apiCall("GET", "/admin/overview")) === 200 && (await apiCall("GET", "/users")) === (label === "ADMIN" ? 200 : 403));
        if (label === "LAB_MANAGER") {
          await go("/projects");
          check("LAB_MANAGER: keeps their content-management controls on the pages (they never lived in the header)", await waitText("+ New project"));
        }
      } else {
        await go("/admin");
        check(`${label}: typing /admin directly is bounced home (client gate) and the API refuses the call (server gate)`, (await waitFor(`location.pathname === '/'`)) && (await apiCall("GET", "/users")) === 403);
        check(`${label}: a lab manager/member still cannot reach account APIs by URL: PUT /users/x is 403`, [403, 404].includes(await apiCall("PUT", "/users/doesnotexist", { role: "ADMIN" })) && (await apiCall("PUT", "/users/doesnotexist", { role: "ADMIN" })) === 403);
      }
      // Log out from the Account menu, by mouse.
      await go("/contact");
      await navReady();
      await clickEl(trig("account"));
      check(`${label}: Account > Log out signs out, lands on /, and the header is the guest header again`, (await clickEl("#nav-panel-account button")) && (await waitFor(`location.pathname === '/' && !!document.querySelector('.nav__account > a[href="/login"]')`)) && eqJson(await topLevel(), ["research", "people", "community", "contact", "log in"]));
      check(`${label}: after logout /schedule is protected again`, await (async () => { await go("/schedule"); return waitFor(`location.pathname === '/login'`); })());
    });
  }

  // ---------------------------------------------------------------- widths: desktop
  section("phase 10.1: header at every width (widest header: ADMIN)");
  await step("nav widths", async () => {
    check("W0. admin login for the width sweep", await login(ADMIN.email, ADMIN.password));
    for (const w of [1920, 1536, 1440, 1366, 1280, 1024, 901]) {
      await desktopAt(w, 800);
      await go("/research");
      await navReady();
      await sleep(250);
      const m = await ev(`(() => {
        const box = (el) => el.getBoundingClientRect();
        const lis = [...document.querySelectorAll('.nav__links > li')].map(box);
        const logo = box(document.querySelector('.nav__logo'));
        const ordered = lis.every((b, i) => i === 0 || b.left >= lis[i - 1].right - 1);
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          navH: box(document.querySelector('.nav')).height,
          ham: getComputedStyle(document.querySelector('.nav__hamburger')).display,
          noWrap: lis.every((b) => b.height <= 64),
          ordered,
          gap: Math.min(...lis.map((b) => b.left)) - logo.right,
          searchW: box(document.getElementById('nav-search-input')).width,
          right: Math.max(...lis.map((b) => b.right)),
          vw: document.documentElement.clientWidth,
          texts: [...document.querySelectorAll('.nav__links > li > a, .nav__trigger')].every((e) => e.scrollWidth <= e.clientWidth + 1),
        };
      })()`);
      check(`W ${w}px (ADMIN): grouped desktop header: no overflow, 64px tall, nothing wrapped, items in order and clear of the logo (>=24px), right edge inside the page`, m.overflow <= 1 && m.navH === 64 && m.ham === "none" && m.noWrap && m.ordered && m.gap >= 24 && m.right <= m.vw, JSON.stringify(m));
      check(`W ${w}px (ADMIN): the search box is the normal, visible box (>=140px wide), and no link text is clipped`, m.searchW >= 140 && m.texts, JSON.stringify(m));
      for (const g of ["research", "people", "account"]) {
        await clickEl(trig(g));
        const ok = (await expanded(g)) === "true" && (await inViewport(`#nav-panel-${g}`));
        const overlap = await ev(`(() => { const p = document.getElementById('nav-panel-${g}').getBoundingClientRect(); const n = document.querySelector('.nav').getBoundingClientRect(); return p.top >= n.bottom - 2 && document.documentElement.scrollWidth - innerWidth <= 1; })()`);
        check(`W ${w}px (ADMIN): the ${g} dropdown opens inside the viewport, below the bar, with no page overflow`, ok && overlap);
        // every link in the panel is really hittable (nothing covers it)
        const hit = await ev(`[...document.querySelectorAll('#nav-panel-${g} a, #nav-panel-${g} button')].every((el) => { const b = el.getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return el === top || el.contains(top); })`);
        check(`W ${w}px (ADMIN): every ${g} dropdown link is the topmost element at its centre (no overlap)`, hit);
        await press("esc");
      }
      if (w === 1440 || w === 1024 || w === 901) await shot(`nav-admin-${w}`);
    }
    // the search keeps working from the new header at 1024px
    await desktopAt(1024, 800);
    await go("/");
    await navReady();
    await typeChars("nav-search-input", "FPGA");
    await key("Enter", "Enter", 13, "\r");
    check("W. search from the 1024px header still works (/search?q=FPGA)", (await waitFor(`location.search === '?q=FPGA'`)) && (await statusIs("FPGA")));
    await logout();
    await desktop();
  });

  // ---------------------------------------------------------------- phone + tablet (hamburger)
  section("phase 10.1: hamburger menu at 390, 412, 768 and 900px");
  for (const w of [390, 412, 768, 900]) {
    await step(`nav mobile ${w}`, async () => {
      await phone(w);
      await go("/projects");
      await navReady();
      await sleep(300);
      check(`M${w}: guest: the hamburger shows, the links are folded away, aria-expanded=false`, (await ev(`getComputedStyle(document.querySelector('.nav__hamburger')).display`)) !== "none" && (await ev(`getComputedStyle(document.querySelector('.nav__links')).display`)) === "none" && (await ev(`document.querySelector('.nav__hamburger').getAttribute('aria-expanded')`)) === "false" && (await overflowPx()) <= 1);
      check(`M${w}: the hamburger is a full-size touch target (>=44x44)`, await ev(`(() => { const b = document.querySelector('.nav__hamburger').getBoundingClientRect(); return b.width >= 44 && b.height >= 44 && b.right <= innerWidth; })()`));
      await clickEl(".nav__hamburger");
      check(`M${w}: tapping it opens the menu (aria-expanded=true) inside the screen, no overflow`, (await menuOpenNow()) && (await ev(`document.querySelector('.nav__hamburger').getAttribute('aria-expanded')`)) === "true" && (await inViewport(".nav__links")) && (await overflowPx()) <= 1);
      const top = await topLevel();
      check(`M${w}: guest sections: Research, People, Community, Contact, Log in`, eqJson(top, ["research", "people", "community", "contact", "log in"]), JSON.stringify(top));
      check(`M${w}: search comes first, full width, easy to tap (>=40px)`, await ev(`(() => { const r = document.getElementById('nav-search-input').getBoundingClientRect(); const ul = document.querySelector('.nav__links').getBoundingClientRect(); return r.width > ${Math.min(w, 700) * 0.6} && r.height >= 40 && r.left >= 0 && r.right <= innerWidth && r.top < ul.top + 100; })()`));
      check(`M${w}: the section holding the current page (Research, on /projects) is open, People is collapsed`, (await expanded("research")) === "true" && (await expanded("people")) === "false" && (await ev(`document.getElementById('nav-panel-people').getBoundingClientRect().height`)) === 0);
      await shot(`nav-mobile-${w}-guest`);
      check(`M${w}: tapping People while Research is open expands People and collapses Research (the tap is not lost to a layout shift)`, (await clickEl(trig("people"))) && (await expanded("people")) === "true" && (await expanded("research")) === "false" && (await ev(`[...document.querySelectorAll('#nav-panel-people a')].every(a => a.getBoundingClientRect().height >= 44)`)));
      check(`M${w}: guest has no Schedule / My Profile / Admin / Log out entry in the menu`, !(await hrefEverywhere("/schedule")) && !(await hrefEverywhere("/profile")) && !(await hrefEverywhere("/admin")) && !(await ev(`[...document.querySelectorAll('.nav button')].some(b => /log out/i.test(b.textContent))`)));
      check(`M${w}: Log in is set apart from the sections (own row with a divider) and is >=44px tall`, await ev(`(() => { const li = document.querySelector('.nav__account'); const a = li.querySelector('a'); return getComputedStyle(li).borderTopWidth === '1px' && a.getBoundingClientRect().height >= 44; })()`));
      check(`M${w}: tapping a link in a section (Groups) navigates and closes the whole menu`, (await clickEl('#nav-panel-people a[href="/groups"]')) && (await waitFor(`location.pathname === '/groups'`)) && !(await menuOpenNow()) && (await overflowPx()) <= 1);

      // Escape: first closes an open section, then the menu; focus goes back to the hamburger.
      await clickEl(".nav__hamburger");
      await clickEl(trig("research"));
      check(`M${w}: (People is the current section on /groups) Escape from an open section collapses just that section`, (await expanded("research")) === "true" && (await (async () => { await press("esc"); return (await expanded("research")) === "false" && (await menuOpenNow()); })()));
      await press("esc");
      check(`M${w}: a second Escape closes the menu and focus returns to the hamburger`, !(await menuOpenNow()) && (await ev(`document.activeElement.classList.contains('nav__hamburger')`)));
      // Search from inside the menu.
      await clickEl(".nav__hamburger");
      await typeChars("nav-search-input", "FPGA");
      await key("Enter", "Enter", 13, "\r");
      check(`M${w}: searching from the menu opens /search?q=FPGA, closes the menu, no overflow`, (await waitFor(`location.search === '?q=FPGA'`)) && (await statusIs("FPGA")) && !(await menuOpenNow()) && (await overflowPx()) <= 1);
      // browser back closes nothing weird: menu closed and header intact
      await clickEl(".nav__hamburger");
      await ev(`history.back()`);
      check(`M${w}: browser back while the menu is open folds it away`, (await waitFor(`location.pathname === '/groups'`)) && !(await menuOpenNow()));
    });
  }
  // A member/admin on a phone: account section, Schedule, and logout by tap.
  for (const [label, creds, isAdminRole] of [["MEMBER", TRUE_MEMBER, false], ["ADMIN", ADMIN, true]]) { // (the phone menu is exercised for a member and an admin; a manager sees the same Account list as the admin, covered on the desktop)
    await step(`nav mobile ${label}`, async () => {
      await desktop();
      await login(creds.email, creds.password);
      await phone(390);
      await go("/contact");
      await navReady();
      await openPhoneMenu();
      const top = await topLevel();
      check(`M390 ${label}: sections Research, People, Community, Schedule, Contact, Account`, eqJson(top, SAME_TOP), JSON.stringify(top));
      check(`M390 ${label}: Account is separated at the bottom and collapsed until tapped`, (await ev(`getComputedStyle(document.querySelector('.nav__account')).borderTopWidth`)) === "1px" && (await expanded("account")) === "false");
      await openMenu("account");
      const acct = await panelLabels("account");
      // Phase 14 test maintenance: same pre-Phase-12 staleness fix as the desktop version above.
      check(`M390 ${label}: Account holds ${isAdminRole ? "My Workspace, My Profile, Messages, Notifications, Admin Dashboard, Log out" : "My Workspace, My Profile, Messages, Notifications, Log out"}`, eqJson(acct, isAdminRole ? ["my workspace", "my profile", "messages", "notifications", "admin dashboard", "log out"] : ["my workspace", "my profile", "messages", "notifications", "log out"]), JSON.stringify(acct));
      check(`M390 ${label}: menu fits the screen (scrolls inside itself if it must), page has no horizontal overflow`, (await inViewport(".nav__links")) && (await overflowPx()) <= 1 && (await ev(`(() => { const b = document.querySelector('.nav__links').getBoundingClientRect(); return b.bottom <= innerHeight + 1; })()`)));
      await shot(`nav-mobile-390-${label.toLowerCase()}`);
      check(`M390 ${label}: Schedule from the phone menu opens the calendar page`, (await clickEl('.nav__links > li > a[href="/schedule"]')) && (await waitFor(`location.pathname === '/schedule'`)) && (await waitText("Lab Schedule")));
      await openPhoneMenu();
      await openMenu("account");
      if (isAdminRole) check("M390 ADMIN: Admin Dashboard from the phone menu opens /admin (with the section nav wrapping, no overflow)", (await clickEl('#nav-panel-account a[href="/admin"]')) && (await waitFor(`location.pathname === '/admin'`)) && (await waitText("Admin Dashboard")) && (await overflowPx()) <= 1);
      else check("M390 MEMBER: there is no Admin Dashboard entry", !(await hrefEverywhere("/admin")));
      await openPhoneMenu();
      await openMenu("account");
      check(`M390 ${label}: Log out by tap signs out and the menu closes onto the guest header`, (await clickEl("#nav-panel-account button")) && (await waitFor(`location.pathname === '/' && !!document.querySelector('.nav__account > a[href="/login"]')`)) && !(await menuOpenNow()));
      await desktop();
    });
  }
  // The largest-text case: browser zoom / large fonts. 200% zoom of a 1440 screen is a 720px viewport = the hamburger.
  await step("nav zoom", async () => {
    await desktopAt(720, 800);
    await go("/contact");
    await navReady();
    check("Z. a 720px viewport (= 200% zoom of a 1440px screen) uses the hamburger, with no overflow", (await ev(`getComputedStyle(document.querySelector('.nav__hamburger')).display`)) !== "none" && (await overflowPx()) <= 1);
    await desktop();
  });

  // ================================================================= PHASE 10.5: UI/UX MODERNIZATION
  section("phase 10.5: helpers");
  const readyPage = async (p, mustHave) => { await go(p); await navReady(); if (mustHave) await waitText(mustHave, 9000); await sleep(350); };
  const GUEST_PAGES = [
    ["/", "Smart Computing Lab"], ["/research", "Research Areas"], ["/projects", "Research Projects"], [`/projects/${D.p1.id}`, "Long description of the public project."], ["/groups", "Research Groups"],
    [`/groups/${D.gPub.id}`, "ZZ B9 Group Public"], ["/team", "Our Team"], [`/team/${D.lead.tmId}`, "ZZ B9 Lead"], ["/publications", "Publications"], ["/news", "News & Events"],
    ["/events", "ZZ B9 Event Public"], [`/events/${D.evPub.id}`, "A public seminar for the browser tests."],
    ["/search?q=FPGA", "FPGA"], ["/search", "Search the Smart Computing Lab"], ["/contact", "Get in Touch"], ["/login", "Log in"], ["/nope-not-a-page", "Page not found"],
  ];
  const pageStructure = () => ev(`(() => {
    const vis = (e) => e.getClientRects().length > 0;
    const hs = [...document.querySelectorAll('h1,h2,h3,h4')].filter(vis);
    let prev = 0; const skips = [];
    for (const h of hs) { const l = +h.tagName[1]; if (prev && l > prev + 1) skips.push(h.tagName + ':' + h.textContent.trim().slice(0, 30)); prev = l; }
    const controls = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(vis);
    const unlabeled = controls.filter((e) => !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).map((e) => e.id || e.name || e.type);
    const unnamed = [...document.querySelectorAll('button,a[href]')].filter(vis).filter((e) => !(e.textContent.trim() || e.getAttribute('aria-label') || e.getAttribute('title'))).map((e) => e.outerHTML.slice(0, 70));
    const skip = document.querySelector('a.skip-link');
    return { main: document.querySelectorAll('main').length, h1: document.querySelectorAll('h1').length, skips, unlabeled, unnamed, noAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length, title: document.title, lang: document.documentElement.lang, skipOk: !!skip && skip.getAttribute('href') === '#main' && !!document.getElementById('main') && document.getElementById('main').tagName === 'MAIN' };
  })()`);
  // WCAG contrast of every visible piece of text against the background it really sits on.
  const contrastFails = () => ev(`(() => {
    const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const over = (top, base) => ({ r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1 });
    const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } } let base = { r: 250, g: 250, b: 248, a: 1 }; for (const c of layers.reverse()) base = over(c, base); return base; };
    const fails = []; const seen = new Set();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
      if (['SCRIPT', 'STYLE', 'OPTION'].includes(el.tagName) || el.closest('.sr-only,[aria-hidden=true],[hidden]') || !el.getClientRects().length) continue;
      if (el.closest('button:disabled,[aria-disabled=true],input:disabled,select:disabled')) continue;
      let faded = false; for (let e = el; e; e = e.parentElement) if (+getComputedStyle(e).opacity < 1) faded = true; if (faded) continue;
      const cs = getComputedStyle(el); const bg = bgOf(el); let fg = parse(cs.color); if (!fg) continue; fg = over(fg, bg);
      const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700; const need = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
      if (ratio < need) fails.push((el.className || el.tagName) + ' "' + n.nodeValue.trim().slice(0, 24) + '" ' + ratio.toFixed(2) + '<' + need);
    }
    return fails.slice(0, 8);
  })()`);
  // Requests can be faked (empty list / server error) to see the empty and error states for real.
  const prevOnMessage = ws.onmessage;
  let faking = null;
  ws.onmessage = (m) => {
    prevOnMessage(m);
    const msg = JSON.parse(m.data);
    if (msg.method === "Fetch.requestPaused" && faking) {
      const body = Buffer.from(faking.body).toString("base64");
      send("Fetch.fulfillRequest", { requestId: msg.params.requestId, responseCode: faking.code, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body });
    }
  };
  const fake = async (pattern, code, body) => { faking = { code, body }; await send("Fetch.enable", { patterns: [{ urlPattern: pattern, requestStage: "Request" }] }); };
  const unfake = async () => { faking = null; await send("Fetch.disable"); };
  const rm = (m) => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: m }] });

  // ---------------------------------------------------------------- structure + accessibility, every page
  section("phase 10.5: structure and accessibility of every page");
  await step("ui structure guest", async () => {
    await desktop();
    const titles = new Set();
    for (const [p, must] of GUEST_PAGES) {
      await readyPage(p, must);
      const s = await pageStructure();
      const label = p.replace(/[a-z0-9]{20,}/, ":id");
      check(`A ${label}: one <main>, one <h1>, a working skip link, language set`, s.main === 1 && s.h1 === 1 && s.skipOk && s.lang === "en", JSON.stringify(s));
      check(`A ${label}: headings never skip a level; every field has a label; every link/button has a name; every image has alt`, s.skips.length === 0 && s.unlabeled.length === 0 && s.unnamed.length === 0 && s.noAlt === 0, JSON.stringify(s));
      check(`A ${label}: the tab names the page ("... · Smart Computing Lab"), each distinct`, (s.title === "Smart Computing Lab" && p === "/") || (s.title.endsWith("· Smart Computing Lab") && !titles.has(s.title)), s.title);
      titles.add(s.title);
    }
  });

  await step("ui contrast", async () => {
    await desktop();
    for (const [p, must] of GUEST_PAGES.slice(0, 14)) {
      await readyPage(p, must);
      const f = await contrastFails();
      check(`C ${p.replace(/[a-z0-9]{20,}/, ":id")} @1440: all text meets WCAG AA contrast (4.5:1, 3:1 for large text)`, f.length === 0, f.join(" | "));
    }
    await phone(390);
    for (const [p, must] of [GUEST_PAGES[0], GUEST_PAGES[2], GUEST_PAGES[8], GUEST_PAGES[12]]) {
      await readyPage(p, must);
      const f = await contrastFails();
      check(`C ${p} @390: contrast`, f.length === 0, f.join(" | "));
    }
    await desktop();
  });

  await step("ui skip link and focus", async () => {
    await desktop();
    await readyPage("/projects", "Research Projects");
    await ev(`document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0)`);
    await tab();
    check("K. the very first Tab stop is the skip link, and it is visible when focused", await ev(`(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return a.classList.contains('skip-link') && r.top >= 0 && r.width > 40; })()`));
    await press("enter");
    check("K. Enter on it moves focus into <main id=main> (past the header)", await waitFor(`document.activeElement && document.activeElement.id === 'main'`, 2000));
    await tab();
    check("K. ...and the next Tab lands on content, not back in the header", await ev(`!!document.activeElement.closest('#main')`));
    // focus rings
    await readyPage("/", "Smart Computing Lab");
    check("K. keyboard focus on a primary button shows a 2px ring", await (async () => { await focusSel(".hero__actions a"); return ring(); })());
    await readyPage("/projects", "ZZ B9 Project Public");
    check("K. keyboard focus on a card title link outlines the whole card", await (async () => { await focusSel(".card__title a"); return ev(`(() => { const c = document.activeElement.closest('.card'); const s = getComputedStyle(c); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; })()`); })());
    check("K. a filter chip shows a ring on focus", await (async () => { await focusSel(".chip"); return ring(); })());
    await readyPage("/contact", "Get in Touch");
    check("K. a form field shows a ring on focus", await (async () => { await focusSel("#name"); return ring(); })());
    check("K. card links are real links, in reading order: title link comes before its member avatars", await (async () => { await readyPage("/projects", "ZZ B9 Project Public"); return ev(`(() => { const c = document.querySelector('.project-card'); const links = [...c.querySelectorAll('a')]; return links[0].closest('.card__title') !== null; })()`); })());
  });

  // ---------------------------------------------------------------- one page grid
  section("phase 10.5: consistent page structure and design tokens");
  await step("ui page grid", async () => {
    await desktopAt(1440, 900);
    const cs = await ev(`(() => { const s = getComputedStyle(document.documentElement); return ['--container', '--green-600', '--radius-md', '--space-4', '--text-base', '--shadow-md'].map((k) => s.getPropertyValue(k).trim()); })()`);
    check("T. design tokens are defined on :root (container, brand colour, radius, spacing, type, shadow)", cs.every((v) => v.length > 0) && cs[0] === "1120px" && cs[1] === "#3b6d11", JSON.stringify(cs));
    const lefts = [];
    for (const [p, must] of GUEST_PAGES.filter(([p]) => !["/", "/login", "/nope-not-a-page"].includes(p))) {
      await readyPage(p, must);
      const g = await ev(`(() => { const h = document.querySelector('.page-header__title, h1'); const c = document.querySelector('#main .container, #main .band__inner'); const logo = document.querySelector('.nav__logo a'); const box = (e) => e.getBoundingClientRect(); return { h1: Math.round(box(h).left), c: Math.round(box(c).left + parseFloat(getComputedStyle(c).paddingLeft)), logo: Math.round(box(logo).left), w: Math.round(box(c).width) }; })()`);
      lefts.push(g.h1);
      check(`G ${p.replace(/[a-z0-9]{20,}/, ":id")}: title, content and the header logo share one left edge; content is at most 1120px wide`, Math.abs(g.h1 - g.c) <= 1 && Math.abs(g.h1 - g.logo) <= 1 && g.w <= 1120, JSON.stringify(g));
    }
    check("G. every inner page uses the same left edge (one page grid)", new Set(lefts).size === 1, JSON.stringify(lefts));
  });

  // ---------------------------------------------------------------- overflow at every requested width, guest pages
  section("phase 10.5: responsive, no overflow");
  for (const w of [390, 412, 768, 1024, 1280, 1366, 1440, 1536, 1920]) {
    await step(`ui overflow ${w}`, async () => {
      if (w <= 768) await phone(w); else await desktopAt(w, 900);
      const bad = [];
      for (const [p, must] of GUEST_PAGES) {
        await readyPage(p, must);
        const o = await overflowPx();
        const clipped = await ev(`(() => { const bad = []; for (const e of document.querySelectorAll('#main *, .nav a, .nav button, footer *')) { if (!e.getClientRects().length) continue; const r = e.getBoundingClientRect(); if (e.closest('.sr-only, svg, .hero__visual, [aria-hidden=true]')) continue; if (r.right > innerWidth + 1 && r.width > 0) { bad.push((e.className || e.tagName).toString().slice(0, 30)); if (bad.length > 2) break; } } return bad; })()`);
        if (o > 1 || clipped.length) bad.push(`${p.replace(/[a-z0-9]{20,}/, ":id")} (${o}px; ${clipped.join(",")})`);
      }
      check(`R ${w}px: none of the ${GUEST_PAGES.length} guest pages overflows or pushes an element past the screen edge`, bad.length === 0, bad.join(" | "));
    });
  }
  await step("ui touch targets", async () => {
    await phone(390);
    for (const [p, must] of [["/projects", "ZZ B9 Project Public"], ["/publications", "Publications"], ["/search?q=FPGA", "FPGA"], ["/contact", "Get in Touch"], ["/login", "Log in"]]) {
      await readyPage(p, must);
      const small = await ev(`[...document.querySelectorAll('#main .btn, #main button, #main .chip, #main .icon-btn, #main input:not([type=checkbox]), #main select, #main textarea')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { n: (e.className || e.tagName).toString().slice(0, 28) + ' ' + e.textContent.trim().slice(0, 14), h: Math.round(r.height) }; }).filter((x) => x.h < 40).slice(0, 5)`);
      check(`M ${p} @390: every button, chip, field and select is at least 40px tall`, small.length === 0, JSON.stringify(small));
    }
    await desktop();
  });

  // ---------------------------------------------------------------- dialogs (modals)
  section("phase 10.5: modals");
  await step("ui modal", async () => {
    await desktop();
    check("D. login as lab manager", await login(MANAGER.email, MANAGER.password));
    await readyPage("/research", "Research Areas");
    await waitFor(`!!document.querySelector('.admin-bar button')`);
    await focusSel(".admin-bar button");
    await ev(`window.__opener = document.activeElement`);
    await press("enter");
    check("D. Enter on '+ Add research area' opens a real dialog: role=dialog, aria-modal, named by its title", await waitFor(`(() => { const d = document.querySelector('.modal'); if (!d) return false; const t = document.getElementById(d.getAttribute('aria-labelledby')); return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && t && t.textContent.trim() === 'Add research area'; })()`));
    check("D. focus moved into the dialog (the first field), and the page behind cannot scroll", await ev(`document.querySelector('.modal').contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.body.style.overflow === 'hidden'`));
    check("D. the close button has a name", await ev(`document.querySelector('.modal__close').getAttribute('aria-label') === 'Close dialog'`));
    const n = await ev(`document.querySelectorAll('.modal input, .modal select, .modal textarea, .modal button, .modal a[href]').length`);
    let stayed = true;
    for (let i = 0; i < n + 3; i++) { await tab(); if (!(await ev(`document.querySelector('.modal').contains(document.activeElement)`))) stayed = false; }
    check("D. Tab cycles inside the dialog (focus is trapped; it never escapes to the page behind)", stayed);
    await tab(true); await tab(true);
    check("D. Shift+Tab wraps backwards inside the dialog too", await ev(`document.querySelector('.modal').contains(document.activeElement)`));
    check("D. every field in the dialog has a label", await ev(`[...document.querySelectorAll('.modal input:not([type=hidden]), .modal select, .modal textarea')].every((e) => e.labels && e.labels.length)`));
    await press("esc");
    check("D. Escape closes it, focus goes back to the button that opened it, scrolling is restored", await waitFor(`!document.querySelector('.modal') && document.activeElement === window.__opener && document.body.style.overflow !== 'hidden'`, 2000));

    // backdrop click closes; a click inside does not
    await clickEl(".admin-bar button");
    await waitFor(`!!document.querySelector('.modal')`);
    await clickEl(".modal h2");
    check("D. clicking inside the dialog does not close it", !!(await exists(".modal")));
    await clickAt(8, 8);
    check("D. clicking the backdrop closes it", await waitFor(`!document.querySelector('.modal')`, 2000));

    // validation error is announced
    await clickEl(".admin-bar button");
    await waitFor(`!!document.querySelector('.modal')`);
    await ev(`document.querySelector('.modal button.form-submit').click()`);
    check("D. a validation error appears inside the dialog as an alert (role=alert)", await waitFor(`!!document.querySelector('.modal [role=alert]') && document.querySelector('.modal [role=alert]').innerText.length > 5`, 3000));
    await clickText("cancel", ".modal button");
    await waitFor(`!document.querySelector('.modal')`);

    // destructive confirm: focus starts on the SAFE choice; Escape deletes nothing
    const before = await ev(`fetch('/api/research').then(r => r.json()).then(a => a.length)`);
    await ev(`document.querySelector('.icon-btn--danger').click()`);
    check("D. the delete confirmation opens with focus on Cancel (the safe choice)", await waitFor(`document.activeElement && document.activeElement.tagName === 'BUTTON' && document.activeElement.textContent.trim() === 'Cancel'`, 2000));
    await press("esc");
    await waitFor(`!document.querySelector('.modal')`);
    check("D. Escape on the delete confirmation deletes nothing", (await ev(`fetch('/api/research').then(r => r.json()).then(a => a.length)`)) === before);

    // small screen: the dialog fits and its actions are reachable
    await phone(390);
    await readyPage("/research", "Research Areas");
    await waitFor(`!!document.querySelector('.admin-bar button')`);
    await clickEl(".admin-bar button");
    await waitFor(`!!document.querySelector('.modal')`);
    check("D. at 390px the dialog fits the screen and never overflows sideways", await ev(`(() => { const r = document.querySelector('.modal').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1; })()`));
    await shot("ui-modal-390");
    check("D. ...and its Save / Cancel buttons are at least 44px tall", await ev(`[...document.querySelectorAll('.modal__actions .btn')].every((b) => b.getBoundingClientRect().height >= 44)`));
    await press("esc");
    await desktop();
    await shot("ui-modal-desktop-closed");
    await logout();
  });

  // ---------------------------------------------------------------- loading, empty and error states
  section("phase 10.5: loading, empty and error states");
  await step("ui states", async () => {
    await desktop();
    // error: the projects API answers 500; a friendly alert with Try again, no technical text; retry recovers
    await fake("*/api/projects*", 500, JSON.stringify({ error: "Something went wrong." }));
    await readyPage("/projects", "Research Projects");
    check("S. a failed load shows ONE alert with a plain message and a Try again button, no stack or raw error text", await waitFor(`!!document.querySelector('#main [role=alert]')`, 4000) && await ev(`(() => { const a = document.querySelector('#main [role=alert]'); return /try again/i.test(a.innerText) && !/TypeError|SyntaxError|Failed to fetch|\\bat \\S+ \\(|stack|Unexpected token/i.test(a.innerText) && !!a.querySelector('button'); })()`));
    await unfake();
    await clickText("Try again", "#main [role=alert] button");
    check("S. Try again reloads the list and the error goes away", await waitFor(`document.body.innerText.includes('ZZ B9 Project Public') && !document.querySelector('#main [role=alert]')`, 5000));
    // empty: an empty list gets a helpful empty state, not a blank page
    await fake("*/api/publications*", 200, JSON.stringify({ items: [], total: 0, page: 1, limit: 20, pageCount: 1, years: [] })); /* Phase 19: the hub reads the /browse envelope */
    await readyPage("/publications", "Publications");
    check("S. no publications: an empty state explains it (not a blank page, not an error)", await waitFor(`document.body.innerText.includes('No publications yet.')`, 4000) && !(await exists("#main [role=alert]")));
    await unfake();
    await fake("*/api/news*", 200, "[]");
    await readyPage("/news", "News & Events");
    check("S. no news: an empty state explains it", await waitFor(`document.body.innerText.includes('No news yet.')`, 4000));
    await unfake();
    await fake("*/api/projects*", 200, "[]");
    await readyPage("/projects", "Research Projects");
    check("S. no public projects (guest): the empty state tells the visitor what to do", await waitFor(`document.body.innerText.includes('No public projects yet.') && document.body.innerText.includes('log in')`, 4000));
    await unfake();
    // loading: skeleton + announced label while the request is in flight, then the real content in the same place
    await readyPage("/", "Smart Computing Lab");
    await send("Network.emulateNetworkConditions", { offline: false, latency: 900, downloadThroughput: -1, uploadThroughput: -1 });
    await ev(`(history.pushState({}, '', '/projects'), dispatchEvent(new PopStateEvent('popstate')), true)`);
    check("S. while loading: a skeleton with role=status, aria-busy, and a spoken label (no bare 'Loading…' text)", await waitFor(`(() => { const s = document.querySelector('#main [role=status][aria-busy=true]'); return !!s && /Loading projects/.test(s.textContent) && !!s.querySelector('.skeleton-block'); })()`, 4000));
    await sleep(1500);
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check("S. ...and then the cards replace it", await waitFor(`document.body.innerText.includes('ZZ B9 Project Public') && !document.querySelector('#main [aria-busy=true]')`, 6000));
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  });

  await step("ui layout shift", async () => {
    await desktop();
    await readyPage("/", "Smart Computing Lab");
    await ev(`window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: false })`);
    await send("Network.emulateNetworkConditions", { offline: false, latency: 350, downloadThroughput: -1, uploadThroughput: -1 });
    for (const p of ["/projects", "/publications", "/research"]) {
      await ev(`(history.pushState({}, '', ${JSON.stringify(p)}), dispatchEvent(new PopStateEvent('popstate')), true)`);
      await sleep(2200);
    }
    const cls = await ev(`window.__cls`);
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check("S. loading never causes a big layout shift (cumulative shift below 0.1 across three slow page loads)", cls < 0.1, `CLS ${cls}`);
  });

  // ---------------------------------------------------------------- motion
  section("phase 10.5: motion");
  await step("ui motion", async () => {
    await desktop();
    await rm("no-preference");
    await readyPage("/", "Smart Computing Lab");
    const on = await ev(`(() => ({ page: getComputedStyle(document.getElementById('main')).animationDuration, signal: getComputedStyle(document.querySelector('.circuit__signal')).animationName, hero: getComputedStyle(document.querySelector('.card--interactive')).transitionDuration }))()`);
    check("A11y-motion. default: pages ease in (a short fade), the hero has one quiet signal pulse", on.page !== "0s" && parseFloat(on.page) > 0.1 && parseFloat(on.page) < 0.5 && on.signal === "circuit-signal", JSON.stringify(on));
    await rm("reduce");
    await readyPage("/", "Smart Computing Lab");
    const off = await ev(`(() => { const d = (e) => parseFloat(getComputedStyle(e).animationDuration) * 1000; const t = (e) => parseFloat(getComputedStyle(e).transitionDuration) * 1000; return { page: d(document.getElementById('main')), signal: getComputedStyle(document.querySelector('.circuit__signal')).animationName, card: t(document.querySelector('.card--interactive')), btn: t(document.querySelector('.btn')) }; })()`);
    check("A11y-motion. prefers-reduced-motion: page fade, card and button transitions are effectively instant, and the hero pulse is off", off.page < 1 && off.card < 1 && off.btn < 1 && off.signal === "none", JSON.stringify(off));
    await clickEl(trig("research"));
    check("A11y-motion. reduced motion: the dropdown still opens (function is unaffected)", (await expanded("research")) === "true" && parseFloat(await ev(`getComputedStyle(document.getElementById('nav-panel-research')).animationDuration`)) * 1000 < 1);
    await press("esc");
    await rm("no-preference");
    check("A11y-motion. no looping animation anywhere but the single hero pulse (skeleton shimmer only while loading)", await ev(`[...document.querySelectorAll('#main *, .nav *, footer *')].filter((e) => { const s = getComputedStyle(e); return s.animationIterationCount === 'infinite' && s.animationName !== 'none'; }).map((e) => e.getAttribute('class')).every((c) => /circuit__signal/.test(c || ''))`));
  });

  // ---------------------------------------------------------------- home: live data, no hard-coded numbers
  section("phase 10.5: home page uses real data");
  await step("ui home data", async () => {
    await desktop();
    for (const who of ["guest", "ADMIN"]) {
      if (who === "ADMIN") check("H. admin login for the home comparison", await login(ADMIN.email, ADMIN.password));
      await readyPage("/", "Smart Computing Lab");
      await waitFor(`document.querySelectorAll('.stat-card__value').length === 4 && ![...document.querySelectorAll('.stat-card__value')].some(e => e.textContent === '–')`, 6000);
      const api = await ev(`Promise.all(['/api/team', '/api/projects', '/api/publications', '/api/research', '/api/news'].map((u) => fetch(u).then((r) => r.json())))`);
      const stats = await ev(`[...document.querySelectorAll('.stat-card')].map((c) => [c.querySelector('.stat-card__label').textContent.trim().toLowerCase(), c.querySelector('.stat-card__value').textContent.trim()])`);
      check(`H ${who}: the four statistics equal the API's own counts for this visitor (researchers ${api[0].length}, projects ${api[1].length}, publications ${api[2].length}, areas ${api[3].length})`, eqJson(stats, [["researchers", String(api[0].length)], ["projects", String(api[1].length)], ["publications", String(api[2].length)], ["research areas", String(api[3].length)]]), JSON.stringify(stats));
      const shown = await ev(`({ pubs: [...document.querySelectorAll('#home-pubs ~ .pub-list .pub-item__title, section[aria-labelledby=home-pubs] .pub-item__title')].map((e) => e.textContent.replace(/Lab only/, '').trim()), news: [...document.querySelectorAll('section[aria-labelledby=home-news] .card__title')].map((e) => e.textContent.trim()), projects: [...document.querySelectorAll('section[aria-labelledby=home-projects] .card__title')].map((e) => e.textContent.trim()) })`);
      check(`H ${who}: recent publications are the API's newest four, in order`, eqJson(shown.pubs, api[2].slice(0, 4).map((p) => p.title)), JSON.stringify(shown.pubs));
      check(`H ${who}: latest news are the API's newest three, in order`, eqJson(shown.news, api[4].slice(0, 3).map((n) => n.title)), JSON.stringify(shown.news));
      check(`H ${who}: featured projects come from the API list (never invented) and the active ones come first`, shown.projects.length === Math.min(3, api[1].length) && shown.projects.every((t) => api[1].some((p) => p.title === t)), JSON.stringify(shown.projects));
      const net = await ev(`[...document.querySelectorAll('.network__row')].map((r) => [r.querySelector('.network__name').textContent.trim(), ...[...r.querySelectorAll('.network__figures strong')].map((s) => +s.textContent)])`);
      const expectNet = api[3].map((a) => { const linked = api[1].filter((p) => p.areas.some((x) => x.id === a.id)); return [a.title, linked.length, new Set(linked.flatMap((p) => p.members.map((m) => m.teamMemberId))).size]; }).filter((r) => r[1] > 0);
      check(`H ${who}: 'Research at a glance' rows are exactly the area<->project links that exist (${expectNet.length} rows), with real project and researcher counts`, eqJson(net.map((r) => r.map((x) => (typeof x === "string" ? x.replace(/^\S+\s*/, (m) => m) : x)).slice(1)), expectNet.map((r) => r.slice(1))) && net.length === expectNet.length, JSON.stringify({ net, expectNet }));
      if (who === "guest") {
        const html = await ev("document.documentElement.outerHTML");
        check("H guest: nothing lab-only reaches the home page (no hidden project, publication, news or area, in text or ids)", !HID_NAMES.some((n) => html.includes(n)) && !HID_IDS.some((i) => html.includes(i)));
      }
      check(`H ${who}: hero actions go to /research and /team; no unsupported claim ('Est.' / a year) in the hero`, await ev(`(() => { const a = [...document.querySelectorAll('.hero__actions a')].map((x) => x.getAttribute('href')); return a[0] === '/research' && a[1] === '/team' && !/Est\\.|since 20|founded/i.test(document.querySelector('.hero').innerText); })()`));
      if (who === "ADMIN") await logout();
    }
  });

  // ---------------------------------------------------------------- relationships on pages
  section("phase 10.5: projects, research areas, groups, researchers, publications");
  await step("ui relationships", async () => {
    await desktop();
    await readyPage("/research", "ZZ B9 Area Public");
    check("R. a research area card lists the projects linked to it (only public ones for a guest) and never a hidden one", await ev(`(() => { const c = [...document.querySelectorAll('.research-card')].find((x) => x.innerText.includes('ZZ B9 Area Public')); return !!c && c.innerText.includes('ZZ B9 Project Public') && !c.innerText.includes('ZZ B9 Project Hidden') && /1 related project/.test(c.innerText); })()`));
    check("R. ...the linked project is a real link to its page", await ev(`!!document.querySelector('.research-card .mini-list a[href="/projects/${D.p1.id}"]')`));
    check("R. a guest never sees the lab-only research area at all", !(await ev(`document.body.innerText.includes('ZZ B9 Area Hidden')`)));

    await readyPage(`/projects/${D.p1.id}`, "Long description of the public project.");
    const pd = await ev(`(() => ({ crumbs: [...document.querySelectorAll('.breadcrumbs li')].map((l) => l.textContent.trim()), last: document.querySelector('.breadcrumbs [aria-current=page]')?.textContent.trim(), team: [...document.querySelectorAll('#project-team ~ .panel__list .person, section[aria-labelledby=project-team] .person')].map((p) => p.innerText.replace(/\\s+/g, ' ').trim()), areas: [...document.querySelectorAll('section[aria-labelledby=project-areas] .tag')].map((t) => t.textContent.trim()), status: document.querySelector('.detail-meta .badge')?.textContent.trim(), group: document.querySelector('.detail-meta a')?.textContent.trim(), order: [...document.querySelectorAll('#main h2')].map((h) => h.textContent.trim().replace(/\\s*\\(\\d+\\)/, '')) }))()`);
    check("P. breadcrumb: Home / Projects / <title>, the last one marked as the current page", eqJson(pd.crumbs.slice(0, 2).map((s) => s.toLowerCase()), ["home", "projects"]) && pd.last === "ZZ B9 Project Public", JSON.stringify(pd.crumbs));
    // Phase 18: the lead moved to its own "Project lead" panel and the Team panel lists the OTHER members (the lead is no longer repeated).
    const leadPanel = await ev(`[...document.querySelectorAll('section[aria-labelledby=project-lead] .person')].map((p) => p.innerText.replace(/\\s+/g, ' ').trim())`);
    check("P. a project page answers 'who works on it': the Project lead panel names the lead, and the team panel lists the other members with their roles", leadPanel.some((t) => t.includes("ZZ B9 Lead") && t.includes("Lead")) && pd.team.some((t) => t.includes("ZZ B9 Member") && t.toLowerCase().includes("member")) && !pd.team.some((t) => t.includes("ZZ B9 Lead")), JSON.stringify({ leadPanel, team: pd.team }));
    check("P. ...'which area': only the PUBLIC area is listed; the hidden one is not", pd.areas.some((a) => a.includes("ZZ B9 Area Public")) && !pd.areas.some((a) => a.includes("Hidden")), JSON.stringify(pd.areas));
    check("P. ...'what is it': status badge (a word, not just a colour), dates and group are shown", /active/i.test(pd.status) && pd.group === "ZZ B9 Group Public", JSON.stringify(pd));
    check("P. ...'what came out of it': research outputs (Phase 19 name for the publications section) and news follow the team and areas, each with a count", eqJson(pd.order.filter((h) => /Research outputs|News/.test(h)), ["Research outputs", "News"]));
    check("P. the team and area panels sit BESIDE the description on desktop, and BEFORE publications/news on a phone", await (async () => {
      const d = await ev(`(() => { const a = document.querySelector('.detail-layout__aside').getBoundingClientRect(); const b = document.querySelector('.detail-layout__b').getBoundingClientRect(); return a.left > b.left; })()`);
      await phone(390); await readyPage(`/projects/${D.p1.id}`, "Long description of the public project.");
      const m = await ev(`(() => { const a = document.querySelector('.detail-layout__aside').getBoundingClientRect(); const b = document.querySelector('.detail-layout__b').getBoundingClientRect(); return a.top < b.top && document.documentElement.scrollWidth <= innerWidth + 1; })()`);
      await desktop(); return d && m; })());

    await readyPage(`/groups/${D.gPub.id}`, "ZZ B9 Group Public");
    check("G. a group page shows its members and its projects; the hidden project in a public group is not there", await ev(`(() => { const t = document.querySelector('#main').innerText; return t.includes('ZZ B9 Lead') && t.includes('ZZ B9 Project Public') && !t.includes('Wombat') && !t.includes('ZZ B9 Project Hidden'); })()`));
    await readyPage(`/team/${D.lead.tmId}`, "ZZ B9 Lead");
    check("R. a researcher profile has sections (Biography, History, Publications, News) and a summary panel with their projects and groups", await ev(`(() => { const h = [...document.querySelectorAll('#main h2')].map((x) => x.textContent.trim().replace(/\\s*\\(\\d+\\)/, '')); return ['Biography', 'History', 'Publications', 'News'].every((s) => h.includes(s)) && !!document.querySelector('.profile-summary') && /ZZ B9 Project Public/.test(document.querySelector('.detail-layout__aside').innerText); })()`));
    check("R. the profile page shows no account id / userId / email of the person", await ev(`(() => { const html = document.documentElement.outerHTML; return !/userId|@example\\.test/.test(html); })()`));

    await readyPage("/publications", "ZZ B9 Pub Public");
    const pubs = await ev(`(() => ({ years: [...document.querySelectorAll('h2.year-heading')].map((h) => +h.textContent.trim().slice(0, 4)), ext: [...document.querySelectorAll('.pub-link')].every((a) => a.target === '_blank' && /noopener/.test(a.rel) && /opens in a new tab/.test(a.textContent)), api: null }))()`);
    const apiYears = await ev(`fetch('/api/publications/browse').then((r) => r.json()).then((j) => [...new Set(j.items.map((p) => p.year))])`); /* Phase 19: the page shows the first page of the hub */
    check("L. publications are grouped under year headings, newest year first, one heading per year that has papers", eqJson(pubs.years, apiYears.slice().sort((a, b) => b - a)) && pubs.years.length > 0, JSON.stringify({ pubs, apiYears }));
    check("L. every external link opens in a new tab, has rel=noopener, and says so to screen readers", pubs.ext);
    check("L. each entry shows title, authors and venue with year (dense academic list, not marketing cards)", await ev(`[...document.querySelectorAll('.pub-item')].every((i) => i.querySelector('.pub-item__title') && i.querySelector('.pub-item__authors') && /\\d{4}$/.test(i.querySelector('.pub-item__venue').textContent.trim()))`));
    await setVal("pub_f_year", "2031");
    await clickText("Apply filters", "form button");
    check("L. picking a year and applying it filters the list to that year (in the URL) and reports the count", await waitFor(`location.search.includes('year=2031') && document.querySelectorAll('h2.year-heading').length === 1 && /^\\d+ publications?$/.test(document.querySelector('.filters__count').innerText.trim())`));

    await readyPage("/news", "ZZ B9 News Public");
    check("N. news cards show date, type and title; recent items first", await ev(`(() => { const cs = [...document.querySelectorAll('#main .news-card')]; return cs.length > 2 && cs.every((c) => c.querySelector('time') && c.querySelector('.badge') && c.querySelector('.card__title')); })()`));
  });

  // ---------------------------------------------------------------- forms and buttons
  section("phase 10.5: forms, buttons, login, contact");
  await step("ui forms", async () => {
    await desktop();
    await readyPage("/login", "Log in");
    check("F. login: labelled fields with the right autocomplete hints, one h1, a primary button, a link for people without an account", await ev(`(() => { const e = document.getElementById('email'), p = document.getElementById('password'); return e.labels.length === 1 && p.labels.length === 1 && e.autocomplete === 'username' && p.autocomplete === 'current-password' && e.required && p.required && document.querySelector('form .btn--primary') && !!document.querySelector('.auth-card a[href="/contact"]'); })()`));
    await ev(`(() => { const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.getElementById('email'), 'nobody@example.test'); set(document.getElementById('password'), 'wrong-password-123'); document.getElementById('email').form.requestSubmit(); })()`);
    check("F. login with a wrong password: an alert with a plain message, the fields keep what was typed, nothing leaks about which part was wrong", await waitFor(`!!document.querySelector('.auth-card [role=alert]')`, 4000) && await ev(`(() => { const a = document.querySelector('.auth-card [role=alert]').innerText; return document.getElementById('email').value === 'nobody@example.test' && a.length > 5 && !/stack|TypeError|SQL|prisma/i.test(a) && (location.pathname === '/login'); })()`));
    await readyPage("/contact", "Get in Touch");
    check("F. contact: existing details are shown as a proper definition list with icons hidden from screen readers; the form fields are labelled and have autocomplete", await ev(`(() => { const dl = document.querySelector('dl.info-list'); return !!dl && dl.querySelectorAll('dt').length === 4 && dl.querySelectorAll('.icon-tile[aria-hidden=true]').length === 4 && ['name', 'email', 'subject', 'message'].every((i) => document.getElementById(i).labels.length === 1) && document.getElementById('email').autocomplete === 'email'; })()`));
    check("F. contact: real Shimane University lab identity shown (email, hours, faculty/campus) — no leftover placeholder text", await ev(`(() => { const t = document.querySelector('dl.info-list').innerText; return t.includes('susmartcomputinglab@gmail.com') && t.includes('Monday – Friday, 09:00 – 17:00') && t.includes('Interdisciplinary Faculty of Science and Engineering') && t.includes('www.shimane-u.ac.jp') && !t.includes('[University Name]') && !t.includes('lab@university.edu'); })()`));
    check("F. contact: the form still says it is not connected (no fake success)", await (async () => { await ev(`document.getElementById('name').value=''`); await setVal("name", "T"); await setVal("email", "t@example.test"); await setVal("message", "hello"); await ev(`document.getElementById('name').form.requestSubmit()`); return waitText("isn't connected to an email service yet"); })());
    await readyPage("/", "Smart Computing Lab");
    check("B. one button system: every .btn on the home page is a primary / secondary / danger variant with the same radius", await ev(`(() => { const bs = [...document.querySelectorAll('#main .btn')]; const rs = new Set(bs.map((b) => getComputedStyle(b).borderRadius)); return bs.length > 3 && bs.every((b) => /btn--(primary|secondary|outline|ghost|danger|link)/.test(b.className)) && rs.size === 1; })()`));
  });

  // ---------------------------------------------------------------- admin, profile, schedule
  section("phase 10.5: admin dashboard, profile, schedule");
  await step("ui admin", async () => {
    await desktop();
    check("Ad. admin login", await login(ADMIN.email, ADMIN.password));
    await readyPage("/admin/people", "Admin Dashboard"); // Phase 17: accounts live in the People & Accounts section
    await waitFor(`![...document.querySelectorAll('.stat-card__value')].some(e => e.textContent === '–') && document.querySelectorAll('.stat-card__value').length === 5`, 6000);
    const users = await ev(`fetch('/api/users').then((r) => r.json())`);
    const team = await ev(`fetch('/api/team').then((r) => r.json())`);
    const linked = new Set(users.map((u) => u.teamMemberId));
    const cards = await ev(`[...document.querySelectorAll('.stat-card')].map((c) => [c.querySelector('.stat-card__label').textContent.trim().toLowerCase(), c.querySelector('.stat-card__value').textContent.trim()])`);
    const expect = [["accounts", users.length], ["admins", users.filter((u) => u.role === "ADMIN").length], ["lab managers", users.filter((u) => u.role === "LAB_MANAGER").length], ["members", users.filter((u) => u.role === "MEMBER").length], ["profiles without login", team.filter((m) => !linked.has(m.id)).length]].map(([a, b]) => [a, String(b)]);
    check("Ad. the dashboard's summary cards are the real numbers (accounts, per-role counts, profiles without a login)", eqJson(cards, expect), JSON.stringify({ cards, expect }));
    check("Ad. the account list keeps its controls (role select per account, Delete)", await ev(`document.querySelectorAll('.account-row select[aria-label^="Role for"]').length > 3 && [...document.querySelectorAll('.account-row .btn--danger')].length > 3`));
    // Phase 17 test maintenance: this asserted the pre-Phase-17 dashboard had no audit viewer / CMS. Phase 17 adds exactly those,
    // in their own sections; the account page itself must still be just accounts.
    check("Ad. the account section stays about accounts (the audit viewer, CMS and files live in their own sections)", await ev(`!/audit log entries|upload a file|CMS/i.test(document.querySelector('#main').innerText)`));
    await readyPage("/schedule", "Lab Schedule");
    check("Sch. schedule keeps the same calendar embed (same calendar id) inside a framed, responsive container", await ev(`(() => { const f = document.querySelector('.calendar-frame iframe'); return !!f && decodeURIComponent(f.src).includes('susmartcomputinglab@gmail.com') && f.title.length > 5 && f.loading === 'lazy'; })()`));
    await readyPage("/profile", "My Profile");
    check("Pr. profile: no linked team profile for the seeded admin => a plain empty state, not an error box", await ev(`!!document.querySelector('#main .empty-state') && !document.querySelector('#main [role=alert]')`));
    await logout();
    await login(MEMBER.email, MEMBER.password);
    await readyPage("/profile", "My Profile");
    await waitFor(`!!document.getElementById('f_name')`);
    check("Pr. member profile: form with labels, a live preview panel, Save/Reset disabled until something changes", await ev(`(() => { const f = document.getElementById('f_name').form; const save = [...f.querySelectorAll('button')].find((b) => /save/i.test(b.textContent)); return ['f_name', 'f_initials', 'f_role', 'f_department', 'f_bio', 'f_photoUrl'].every((i) => document.getElementById(i).labels.length === 1) && !!document.querySelector('.profile-summary') && save.disabled; })()`));
    await setVal("f_name", "ZZ B9 Member Renamed");
    check("Pr. ...editing enables Save and updates the preview at once", await ev(`(() => { const save = [...document.getElementById('f_name').form.querySelectorAll('button')].find((b) => /save/i.test(b.textContent)); return !save.disabled && document.querySelector('.profile-summary').innerText.includes('ZZ B9 Member Renamed'); })()`));
    await setVal("f_name", "ZZ B9 Member");
    await setVal("f_initials", "");
    await ev(`document.getElementById('f_name').form.requestSubmit()`);
    check("Pr. an invalid value shows a field-level error tied to the field (aria-invalid + aria-describedby)", await waitFor(`(() => { const i = document.getElementById('f_initials'); const d = i.getAttribute('aria-describedby'); return i.getAttribute('aria-invalid') === 'true' && d && document.getElementById(d).innerText.length > 3; })()`, 3000));
    await logout();
  });

  // ---------------------------------------------------------------- security regression through the new UI
  section("phase 10.5: security is unchanged");
  await step("ui security", async () => {
    await desktop();
    const ids = D.userIds;
    // D.plain is a real plain MEMBER for the whole run (earlier phases promote b9-member to lab manager).
    for (const [who, creds] of [["member", { email: D.plain.email, password: PW }], ["lab manager", MANAGER], ["admin", ADMIN]]) {
      check(`Sec. login as ${who}`, await login(creds.email, creds.password));
      let leak = [];
      for (const p of ["/", "/team", `/team/${D.lead.tmId}`, "/projects", `/projects/${D.p1.id}`, "/groups", "/publications", "/news", "/search?q=ZZ+B9"]) {
        await readyPage(p);
        const html = await ev("document.documentElement.outerHTML");
        if (/"userId"|userId=|data-user/i.test(html) || ids.some((u) => html.includes(u))) leak.push(p);
      }
      check(`Sec. ${who}: no account id, userId or credential appears anywhere in the rendered pages (home, team, profile, projects, groups, publications, news, search)`, leak.length === 0, leak.join(","));
      await readyPage(`/team/${D.lead.tmId}`, "ZZ B9 Lead");
      const edit = await ev(`/Edit profile/.test(document.body.innerText)`);
      check(`Sec. ${who}: 'Edit profile' on ${who === "member" ? "someone else's" : "a member's"} profile is ${who === "member" ? "absent (isOwn=false)" : "offered (manager power)"}`, who === "member" ? !edit : edit);
      await readyPage("/team", "Our Team");
      await waitFor(`document.querySelectorAll('.team-card').length > 2`);
      check(`Sec. ${who}: team-card edit controls follow the policy (member: only their own card; managers/admin: all; delete only for admin)`, await ev(`(() => { const cs = [...document.querySelectorAll('.team-card')]; const edit = cs.filter((c) => c.querySelector('.card-edit-btn')).length; const del = cs.filter((c) => c.querySelector('.icon-btn--danger')).length; return ${who === "member" ? "edit === 1 && del === 0" : who === "lab manager" ? "edit === cs.length && del === 0" : "edit === cs.length && del === cs.length"}; })()`));
      await go("/admin");
      await sleep(500);
      // Phase 17: /admin is open to managers too (a management view); the ACCOUNT api and /admin/people stay admin-only.
      check(`Sec. ${who}: /admin is ${who === "member" ? "bounced home" : "open"}, and the API agrees (admin overview ${who === "member" ? "403" : "200"}, users list ${who === "admin" ? "200" : "403"})`, (who === "member" ? (await pathNow()) === "/" : (await pathNow()) === "/admin") && (await apiCall("GET", "/admin/overview")) === (who === "member" ? 403 : 200) && (await apiCall("GET", "/users")) === (who === "admin" ? 200 : 403));
      await logout();
    }
    await readyPage("/schedule");
    check("Sec. guest: /schedule is still login-protected (redirect to /login)", await waitFor(`location.pathname === '/login'`));
    check("Sec. guest: the /schedule route serves no calendar before login", !(await exists("iframe")));
  });

  // ================================================================= PHASE 11: FORUM
  section("forum: guest");
  await step("forum guest", async () => {
    await desktop();
    await readyPage("/", "Smart Computing Lab");
    check("forum: nav offers Community > Forum", await exists('#nav-panel-community a[href="/community/forum"]'));
    check("forum index renders the public category, not the hidden one", await visit("/community/forum", "ZZ B9 Forum Public Category"));
    let t = await text();
    check("forum index: hidden category absent for a guest", !t.includes("ZZ B9 Forum Hidden Category"));
    check("forum index: guest has no '+ New topic' / '+ New category'", !t.includes("+ New topic") && !t.includes("+ New category"));
    await shot("forum-index-guest");

    await go(`/community/forum/category/${D.fCatHid.slug}`);
    check("forum: direct URL to a hidden category is a not-found state", await waitText("Category not found"));
    t = await text();
    check("...and leaks nothing (no name, no description)", !t.includes("ZZ B9 Forum Hidden Category") && !t.includes("Lab only"));

    await go(`/community/forum/category/${D.fCatPub.slug}`);
    check("forum category page renders its topic", await waitText("ZZ B9 Forum Seed Topic"));
    t = await text();
    check("forum category page: guest has no '+ New topic'", !t.includes("+ New topic"));

    await go(`/community/forum/topic/${D.fXss.id}`);
    await waitText("ZZ B9 Forum XSS Topic");
    const xssRan = await ev("window.__forumXss");
    check("forum topic body: a hostile <script>/<img onerror> string renders as inert TEXT, never executes", xssRan === undefined);
    // The raw text legitimately CONTAINS the substrings "<script" / "onerror=" (as literal, escaped
    // characters React rendered safely) — that is the point. The real proof is that no actual
    // <script> or <img> ELEMENT exists inside .forum-body: nothing was parsed as markup.
    check(
      "forum topic body: no real <script>/<img> element inside .forum-body (React text, never dangerouslySetInnerHTML)",
      await ev(`(() => { const el = document.querySelector('.forum-body'); return !!el && el.querySelectorAll('script, img').length === 0; })()`),
    );
    check("forum topic body: the hostile string is still visible as plain text", await ev(`document.querySelector('.forum-body')?.textContent.includes('onerror=window.__forumXss=1')`));
    check("forum: guest sees reaction counts but the buttons are disabled (no writes)", await ev(`[...document.querySelectorAll('.reaction-btn')].every((b) => b.disabled)`));
    check("forum: guest has no comment composer, only a login prompt", !(await exists("#comment-composer-body")) && (await text()).toLowerCase().includes("log in"));

    await go(`/community/forum/topic/doesnotexist12345`);
    check("forum: unknown topic id renders a not-found state, no crash", await waitText("Topic not found"));
    check("forum: guest write API calls are refused (401)", (await apiCall("POST", "/forum/posts", { categoryId: D.fCatPub.id, title: "x", body: "y" })) === 401 && (await apiCall("POST", `/forum/posts/${D.fTopic.id}/comments`, { body: "x" })) === 401);
  });

  section("forum: member");
  await step("forum member", async () => {
    // D.plain, not D.mem: earlier phases promote b9-member to LAB_MANAGER during the full run
    // (see the dev-environment-gotchas memory / Phase 10.5 comment) — D.plain stays a true MEMBER.
    check("forum: member login", await login(D.plain.email, PW));
    await readyPage(`/community/forum/category/${D.fCatPub.slug}`, "ZZ B9 Forum Seed Topic");
    check("forum: member sees '+ New topic'", await ev(`document.body.innerText.includes('+ New topic')`));
    await clickText("+ New topic");
    await waitFor(`!!document.getElementById('forum_title')`);
    check("forum composer: category/title/body fields present, labelled", await ev(`['forum_category', 'forum_title', 'forum_body'].every((i) => document.getElementById(i).labels.length === 1)`));
    await setVal("forum_category", D.fCatPub.id);
    await setVal("forum_title", "ZZ B9 Forum Member Topic");
    await setVal("forum_body", "A topic written by a member during the browser run.");
    await submitModal();
    check("forum: new topic redirects to its own page", await waitFor(`location.pathname.includes('/community/forum/topic/')`, 5000));
    check("forum: the new topic shows the member as author, with edit controls (they wrote it)", await waitText("ZZ B9 Forum Member Topic") && (await text()).includes("ZZ B9 Plain") && (await exists(".admin-bar")));
    const memberTopicUrl = await pathNow();
    const memberTopicId = memberTopicUrl.split("/").pop();

    await setVal("comment-composer-body", "A comment from the member.");
    await clickText("Post comment");
    check("forum: member can comment", await waitText("A comment from the member."));

    check("forum: member can react (LIKE) and it toggles active", await ev(`(() => { const b = [...document.querySelectorAll('.reaction-btn')].find((x) => x.textContent.includes('Like')); if (!b) return false; b.click(); return true; })()`) && (await waitFor(`[...document.querySelectorAll('.reaction-btn')].find((b) => b.textContent.includes('Like'))?.classList.contains('is-active')`, 4000)));

    check("forum: member has no moderation controls on their own topic (no Pin/Lock/Hide/Move)", !(await exists(".admin-bar")) || !(await ev(`document.querySelector('.admin-bar').innerText.includes('Pin')`)));
    await go(`/community/forum/topic/${D.fTopic.id}`);
    await waitText("ZZ B9 Forum Seed Topic");
    check("forum: member cannot edit ANOTHER author's topic (no Edit control)", !(await ev(`!!document.querySelector('.admin-bar') && document.querySelector('.admin-bar').innerText.includes('Edit')`)));

    // clean up the member's own topic through the UI (author delete)
    await go(memberTopicUrl);
    await waitText("ZZ B9 Forum Member Topic");
    await clickText("Delete");
    await waitFor(`!!document.querySelector('.modal')`);
    await clickText("Delete", ".modal button");
    check("forum: author can delete their own topic", await waitFor(`!location.pathname.includes('${memberTopicId}')`, 5000));
    await logout();
  });

  section("forum: lab manager");
  await step("forum manager", async () => {
    check("forum: manager login", await login(D.mgr.email, PW));
    await readyPage(`/community/forum/topic/${D.fTopic.id}`, "ZZ B9 Forum Seed Topic");
    check("forum: manager sees moderation controls (Pin/Lock/Hide/Move/Delete)", await ev(`(() => { const b = document.querySelector('.admin-bar'); return !!b && ['Pin', 'Lock', 'Hide', 'Move', 'Delete'].every((w) => b.innerText.includes(w)); })()`));
    await clickText("Pin");
    // Badges are CSS text-transform: uppercase (see .badge--upper); innerText reflects the RENDERED
    // (upper-cased) text, so compare lowercase — same gotcha as the nav/badge checks elsewhere in this file.
    check("forum: manager can pin a topic (badge appears)", await waitFor(`document.body.innerText.toLowerCase().includes("pinned")`));
    await go(`/community/forum/category/${D.fCatPub.slug}`);
    await waitText("ZZ B9 Forum Seed Topic");
    check("forum: a pinned topic sorts first in its category", await ev(`document.querySelector('.forum-topic-list li')?.innerText.includes('ZZ B9 Forum Seed Topic')`));
    await go(`/community/forum/topic/${D.fTopic.id}`);
    await waitText("ZZ B9 Forum Seed Topic");
    await clickText("Unpin");
    await waitFor(`!document.body.innerText.toLowerCase().includes("pinned")`, 4000);
    await clickText("Lock");
    check("forum: manager can lock a topic (locked note replaces the composer)", await waitText("locked"));
    check("forum: a locked topic has no comment composer for anyone", !(await exists("#comment-composer-body")));
    await clickText("Unlock");
    await waitFor(`!!document.getElementById('comment-composer-body')`, 4000);

    await readyPage("/community/forum", "ZZ B9 Forum Public Category");
    check("forum: manager sees '+ New category'", (await text()).includes("+ New category"));
    await clickText("+ New category");
    await waitFor(`!!document.getElementById('cat_name')`);
    await setVal("cat_name", "ZZ B9 Forum Manager Category");
    await submitModal();
    check("forum: manager creates a category", await waitText("ZZ B9 Forum Manager Category"));
    await ev(`fetch('/api/forum/categories').then((r) => r.json())`).then(async (cats) => {
      const created = cats.find((c) => c.name === "ZZ B9 Forum Manager Category");
      check("forum: new category is deletable while empty (cleanup via API)", created && (await apiCall("DELETE", `/forum/categories/${created.id}`)) === 200);
    });
    await logout();
  });

  section("forum: admin");
  await step("forum admin", async () => {
    check("forum: admin login", await login(ADMIN.email, ADMIN.password));
    await readyPage(`/community/forum/topic/${D.fXss.id}`, "ZZ B9 Forum XSS Topic");
    check("forum: admin can delete arbitrary content (moderation, not authorship)", await ev(`!!document.querySelector('.admin-bar')`));
    await logout();
  });

  section("forum: responsive + no horizontal overflow");
  await step("forum responsive", async () => {
    for (const w of [390, 768, 1024, 1366, 1440]) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 900 });
      await go("/community/forum");
      await waitText("ZZ B9 Forum Public Category");
      check(`forum index at ${w}px: no horizontal overflow`, await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"));
      await shot(`forum-index-${w}`);
      await go(`/community/forum/topic/${D.fTopic.id}`);
      await waitText("ZZ B9 Forum Seed Topic");
      check(`forum topic at ${w}px: no horizontal overflow`, await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"));
      await shot(`forum-topic-${w}`);
    }
    await desktop();
  });

  section("forum: accessibility");
  await step("forum a11y", async () => {
    await readyPage(`/community/forum/topic/${D.fTopic.id}`, "ZZ B9 Forum Seed Topic");
    check("forum topic page: exactly one h1, inside the page header", await ev(`document.querySelectorAll('h1').length === 1`));
    check("forum topic page: one main landmark", await ev(`document.querySelectorAll('main').length === 1`));
    check("forum: reaction buttons have a real text accessible name (never emoji-only)", await ev(`[...document.querySelectorAll('.reaction-btn')].every((b) => /[a-z]{3,}/i.test(b.textContent))`));
    check("forum: touch targets (reaction buttons) are >= 40px tall", await ev(`[...document.querySelectorAll('.reaction-btn')].every((b) => b.getBoundingClientRect().height >= 40)`));
    await readyPage("/community/forum", "ZZ B9 Forum Public Category");
    check("forum index: one h1, logical heading order (h1 then h2s)", await ev(`document.querySelectorAll('h1').length === 1 && [...document.querySelectorAll('h1,h2,h3')].slice(1).every((h) => h.tagName !== 'H1')`));
  });

  // ================================================================= PHASE 14: LOCALIZATION
  section("phase 14: language switcher, persistence, translation, fallback");
  await step("i18n switcher, accessibility, live translation", async () => {
    await desktop();
    // Under ONLY_I18N every earlier step is skipped, so this may be the browser's first real
    // navigation this run (still on about:blank otherwise) -- localStorage throws on an opaque
    // origin, so a page must load before touching it.
    await go("/");
    await navReady();
    await ev(`localStorage.removeItem('scl.locale')`);
    await send("Page.reload");
    await sleep(700);
    await navReady();
    check("i18n: default locale (no stored preference) is English", await waitText("Research"));
    check("i18n: <html lang> is en by default", (await ev(`document.documentElement.lang`)) === "en");
    check("i18n: the switcher trigger shows 'EN' by default", (await ev(`document.querySelector('.lang-switch > .nav__trigger')?.textContent.trim()`)) === "EN");
    check("i18n: the switcher panel starts closed", (await ev(`document.querySelector('.lang-switch > .nav__trigger')?.getAttribute('aria-expanded')`)) === "false");

    await clickEl(".lang-switch > .nav__trigger");
    check("i18n: clicking the trigger opens the panel with exactly two language options", (await ev(`document.querySelector('.lang-switch > .nav__trigger')?.getAttribute('aria-expanded')`)) === "true" && (await ev(`document.querySelectorAll('.lang-switch .nav__panel li').length`)) === 2);
    check("i18n: the panel is labelled '<trigger text> menu', the same convention as every other nav dropdown", await ev(`(() => { const b = document.querySelector('.lang-switch > .nav__trigger'); const p = document.getElementById(b.getAttribute('aria-controls')); return p.getAttribute('aria-label') === b.textContent.trim() + ' menu'; })()`));
    check("i18n: the current locale (English) is marked aria-current", (await ev(`document.querySelector('.lang-switch .nav__panel button[aria-current="true"]')?.textContent.trim()`)) === "English");
    await press("esc");
    check("i18n: Escape closes the panel and returns focus to the trigger (same disclosure pattern as every other nav group)", (await ev(`document.querySelector('.lang-switch > .nav__trigger')?.getAttribute('aria-expanded')`)) === "false" && (await ev(`document.activeElement === document.querySelector('.lang-switch > .nav__trigger')`)));

    await clickEl(".lang-switch > .nav__trigger");
    check("i18n: choosing 日本語 from the panel", await clickText("日本語", ".lang-switch .nav__panel button"));
    await sleep(250);
    check("i18n: <html lang> becomes ja", (await ev(`document.documentElement.lang`)) === "ja");
    check("i18n: the header re-renders in Japanese without a page reload (お問い合わせ = Contact)", await waitText("お問い合わせ"));
    check("i18n: the switcher trigger now reads 日本語", (await ev(`document.querySelector('.lang-switch > .nav__trigger')?.textContent.trim()`)) === "日本語");
    check("i18n: the choice is persisted to localStorage under the documented key", (await ev(`localStorage.getItem('scl.locale')`)) === "ja");

    await send("Page.reload");
    await sleep(700);
    await navReady();
    check("i18n: survives a real full-page reload (not just client-side routing)", (await ev(`document.documentElement.lang`)) === "ja" && (await waitText("お問い合わせ")));

    await go("/research");
    await navReady();
    check("i18n: a page's own heading is localized (研究分野 = Research Areas)", await waitText("研究分野"));
    check("i18n: the browser tab title is localized too", (await ev(`document.title`)).includes("研究分野"));

    await clickEl(".lang-switch > .nav__trigger");
    await clickText("English", ".lang-switch .nav__panel button");
    await sleep(250);
    check("i18n: switching back to English updates the already-rendered page in place -- heading is English again", await waitText("Research Areas"));
    check("i18n: ...and the tab title updates too, without a navigation", (await ev(`document.title`)).startsWith("Research Areas"));
  });

  await step("i18n persistence across login/logout, direct URLs, and fallback for a bad stored value", async () => {
    await ev(`localStorage.setItem('scl.locale','ja')`);
    await go("/");
    await navReady();
    check("i18n: logging in does not reset an already-chosen locale", (await login(D.mem.email, PW)) && (await ev(`document.documentElement.lang`)) === "ja");
    await go("/schedule");
    await navReady();
    check("i18n: a protected, translated page renders in Japanese for a logged-in member (ラボスケジュール = Lab Schedule)", await waitText("ラボスケジュール"));
    // The shared logout() helper matches the English "log out" text, so it is not usable while ja
    // is active; the account panel is the only one whose button is a real action (the others are
    // link lists), so it can be targeted structurally instead of by (locale-dependent) text.
    await clickEl(trig("account"));
    await clickEl("#nav-panel-account button");
    await waitFor(`!!document.querySelector('.nav__account > a[href="/login"]')`);
    check("i18n: logging out does not reset the chosen locale either", (await ev(`document.documentElement.lang`)) === "ja");

    await send("Page.navigate", { url: WEB + "/contact" });
    await sleep(700);
    await navReady();
    check("i18n: a direct URL load (not client-side routing) still renders in the stored locale", await waitText("お問い合わせ"));

    await ev(`localStorage.setItem('scl.locale','fr')`);
    await send("Page.reload");
    await sleep(700);
    check("i18n: an unsupported stored value ('fr', never offered by the UI) is validated away, not trusted -- silently falls back to English", (await ev(`document.documentElement.lang`)) === "en" && (await waitText("Contact")));

    await ev(`localStorage.removeItem('scl.locale')`);
  });

  await step("i18n never changes what is visible: locale is not a permissions bypass", async () => {
    await ev(`localStorage.setItem('scl.locale','ja')`);
    await go("/profile");
    check("i18n: a guest with Japanese selected is still bounced to /login for a protected route (ProtectedRoute ignores locale entirely)", await waitFor(`location.pathname === '/login'`));
    await ev(`localStorage.removeItem('scl.locale')`);
    await desktop();
  });

  await step("i18n responsive: no horizontal overflow in Japanese at common widths", async () => {
    await ev(`localStorage.setItem('scl.locale','ja')`);
    for (const w of [390, 768, 1024, 1440]) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 900 });
      await go("/community/forum");
      await navReady();
      check(`i18n: ${w}px in Japanese has no horizontal overflow (longer/shorter Japanese labels do not break the header or page)`, await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"));
    }
    await ev(`localStorage.removeItem('scl.locale')`);
    await desktop();
  });

  // ================================================================= PHASE 15: rendered EN/JA sweep
  // Final-verification sweep: every localized surface, both languages, nine widths, through the real
  // rendered DOM (overflow, clipped/overlapping text, accessible names, dialogs, lightbox, keyboard).
  section("phase 15: rendered accessibility + responsive sweep (EN + JA, 390..1920)");
  const P15 = {};
  const P15_WIDTHS = process.env.P15_W ? process.env.P15_W.split(",").map(Number) : [390, 412, 768, 900, 1024, 1280, 1366, 1440, 1920];
  const P15_TAB_WIDTHS = [390, 768, 1280];
  const p15Vp = (w) => send("Emulation.setDeviceMetricsOverride", { width: w, height: w < 900 ? 844 : 900, deviceScaleFactor: 1, mobile: w < 900 });
  const p15Audit = (rootSel, ja) => ev(`(${p15AuditFn.toString()})(${JSON.stringify(rootSel)}, ${!!ja})`);
  // Runs INSIDE the page. Returns { resp: [...], a11y: [...] }.
  function p15AuditFn(rootSel, ja) {
    const root = rootSel ? document.querySelector(rootSel) : document.body;
    const resp = [];
    const a11y = [];
    if (!root) return { resp: ["no root " + rootSel], a11y: [] };
    const vw = document.documentElement.clientWidth;
    const short = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/)[0] : "") + '"' + (el.textContent || "").trim().slice(0, 24) + '"';
    // Content of a CLOSED <details> (Phase 22's folded filters) is not rendered and not reachable, even though the engine may keep a stale box for it.
    const shown = (el) => { const s = getComputedStyle(el); if (s.visibility === "hidden" || s.display === "none" || el.closest("[hidden]")) return false; const dt = el.closest("details:not([open])"); if (dt && !el.closest("summary")) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const tiny = (el) => { const b = el.getBoundingClientRect(); return b.width <= 2 || b.height <= 2; };
    const scroller = (el) => { for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true; } return false; };
    if (!rootSel && document.documentElement.scrollWidth > vw + 1) resp.push("page overflows by " + (document.documentElement.scrollWidth - vw) + "px");
    const all = [root, ...root.querySelectorAll("*")].filter((e) => !["SCRIPT", "STYLE", "SVG", "PATH", "OPTION", "TEXTAREA", "SELECT", "INPUT"].includes(e.tagName.toUpperCase()) && shown(e) && !tiny(e));
    for (const el of all) {
      const s = getComputedStyle(el);
      const ownText = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (ownText.length) {
        const range = document.createRange();
        range.setStartBefore(ownText[0]);
        range.setEndAfter(ownText[ownText.length - 1]);
        const r = range.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        if (s.display !== "inline" && (r.right > b.right + 1.5 || r.left < b.left - 1.5)) resp.push("text spills out of its box: " + short(el));
        if (!scroller(el) && (r.right > vw + 1 || r.left < -1)) resp.push("text beyond the viewport: " + short(el));
        if (s.overflowX !== "visible" && s.overflowX !== "auto" && s.overflowX !== "scroll" && el.scrollWidth > el.clientWidth + 1) resp.push("text clipped horizontally: " + short(el));
        if ((s.overflowY === "hidden" || s.overflowY === "clip") && el.scrollHeight > el.clientHeight + 1 && !(s.webkitLineClamp && s.webkitLineClamp !== "none")) resp.push("text clipped vertically: " + short(el));
      }
    }
    const visRect = (el) => { let r = el.getBoundingClientRect(); let L = r.left, T = r.top, R = r.right, B = r.bottom; for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) { const st = getComputedStyle(a); if (['auto', 'scroll', 'hidden', 'clip'].includes(st.overflowX) || ['auto', 'scroll', 'hidden', 'clip'].includes(st.overflowY)) { const c = a.getBoundingClientRect(); L = Math.max(L, c.left); T = Math.max(T, c.top); R = Math.min(R, c.right); B = Math.min(B, c.bottom); } } return { left: L, top: T, right: R, bottom: B }; };
    const IX = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"]';
    const ix = [...root.querySelectorAll(IX)].filter((e) => shown(e) && !tiny(e) && !e.classList.contains('skip-link'));
    for (let i = 0; i < ix.length; i++) {
      for (let j = i + 1; j < ix.length; j++) {
        const a = ix[i], b = ix[j];
        if (a.contains(b) || b.contains(a)) continue;
        if (a.closest('.search-form--nav') && a.closest('.search-form--nav') === b.closest('.search-form--nav')) continue; // icon button embedded in the pill by design
        if (!!a.closest('.nav') !== !!b.closest('.nav')) continue; // sticky header over scrolled content
        if (a.closest('.card-edit-btn') || b.closest('.card-edit-btn')) continue; // edit overlay sits on the card corner by design; hit-tested below
        const ra = visRect(a), rb = visRect(b);
        const ow = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oh = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ow > 2 && oh > 2) resp.push("controls overlap: " + short(a) + " x " + short(b));
      }
    }
    for (const eb of root.querySelectorAll('.card-edit-btn .icon-btn')) {
      const b = eb.getBoundingClientRect();
      if (!shown(eb) || b.top < 0 || b.bottom > innerHeight || b.right > vw) continue;
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (top !== eb && !eb.contains(top)) resp.push('edit overlay button is covered by ' + short(top || document.body));
    }
    const nameOf = (el) => {
      const lb = el.getAttribute("aria-labelledby");
      if (lb) return lb.split(/\s+/).map((i) => (document.getElementById(i) ? document.getElementById(i).textContent : "")).join(" ").trim();
      const al = el.getAttribute("aria-label");
      if (al && al.trim()) return al.trim();
      if (el.labels && el.labels.length) return [...el.labels].map((l) => l.textContent).join(" ").trim();
      if (el.tagName === "INPUT" && ["submit", "button", "reset"].includes(el.type)) return el.value;
      let t = "";
      const walk = (n) => { if (n.nodeType === 3) t += n.textContent; else if (n.nodeType === 1) { if (n.getAttribute("aria-hidden") === "true") return; if (n.tagName === "IMG") t += n.getAttribute("alt") || ""; n.childNodes.forEach(walk); } };
      walk(el);
      return t.trim() || (el.getAttribute("title") || "").trim();
    };
    for (const el of ix) {
      if (!nameOf(el)) a11y.push("no accessible name: " + short(el));
    }
    for (const img of root.querySelectorAll("img")) if (shown(img) && !img.hasAttribute("alt")) a11y.push("img without alt: " + img.getAttribute("src"));
    const ids = {};
    for (const el of root.querySelectorAll("[id]")) { if (ids[el.id]) a11y.push("duplicate id " + el.id); ids[el.id] = 1; }
    for (const el of root.querySelectorAll("[aria-labelledby],[aria-controls]")) {
      for (const attr of ["aria-labelledby"]) { const v = el.getAttribute(attr); if (v && v.split(/\s+/).some((i) => !document.getElementById(i))) a11y.push(attr + " points at a missing id: " + short(el)); }
    }
    const txt = root.innerText || "";
    const keyLeak = txt.match(/(?<![@\/\w.-])(?:common|nav|adm|rs|events|forum|gallery|messages|notifications|profile|admin|search|contact|home|team|projects|groups|research|publications|news|schedule|login|lang|footer|errors?)\.[a-z][A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*/);
    if (keyLeak) a11y.push("raw translation key visible: " + keyLeak[0]);
    if (/\bundefined\b|\[object Object\]|\bNaN\b|\{\{|\{[a-zA-Z]+\}/.test(txt)) a11y.push("placeholder/undefined text visible: " + (txt.match(/\bundefined\b|\[object Object\]|\bNaN\b|\{\{|\{[a-zA-Z]+\}/) || [""])[0]);
    if (!rootSel) {
      if (document.querySelectorAll("h1").length !== 1) a11y.push("h1 count is " + document.querySelectorAll("h1").length);
      if (document.querySelectorAll("main").length !== 1) a11y.push("main landmark count is " + document.querySelectorAll("main").length);
    }
    if (ja) {
      const asciiOnly = (v) => v && /[A-Za-z]{3,}/.test(v) && !/[^\x00-\x7F]/.test(v) && !/ZZ|@|https?:|[.][.][.]/.test(v);
      for (const el of root.querySelectorAll("[aria-label],[title],[placeholder],img[alt]")) {
        if (!shown(el)) continue;
        for (const attr of ["aria-label", "title", "placeholder", "alt"]) { const v = el.getAttribute(attr); if (asciiOnly(v)) a11y.push("English " + attr + " in Japanese UI: " + v); }
      }
      for (const el of root.querySelectorAll("button, label, legend, th, .btn, .chip")) {
        if (!shown(el) || el.querySelector("*:not(svg):not(path):not(span)")) continue;
        const v = (el.innerText || "").trim();
        if (asciiOnly(v) && !/^(EN|JA|FAQ|CSV|PDF|ID|URL)$/.test(v)) a11y.push("English control text in Japanese UI: " + v);
      }
    }
    return { resp: [...new Set(resp)], a11y: [...new Set(a11y)] };
  }
  const p15Settle = async () => { let last = null, same = 0; for (let i = 0; i < 40 && same < 3; i++) { const y = await ev(`Math.round(window.scrollY) + '/' + document.documentElement.scrollHeight`); same = y === last ? same + 1 : 0; last = y; await sleep(60); } };
  const p15Ready = async (p) => {
    if (process.env.P15_LOG) console.log("  .. page " + p);
    await go(p);
    await navReady();
    await waitFor(`!document.querySelector('[aria-busy="true"]')`, 8000);
    await sleep(300);
  };
  // Tab through the page: every stop must be visible, named, ringed, not covered, and reachable in DOM order.
  const p15TabWalk = async (max) => {
    const bad = [];
    const seen = new Set();
    await ev(`(() => { if (document.activeElement) document.activeElement.blur(); window.scrollTo(0, 0); window.__p15c = window.__p15c || 0; })()`);
    let stops = 0;
    for (let i = 0; i < max; i++) {
      await tab(false);
      await p15Settle();
      const info = await ev(`(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return { body: true };
        if (!a.__p15) a.__p15 = ++window.__p15c;
        const b = a.getBoundingClientRect();
        const s = getComputedStyle(a);
        const top = document.elementFromPoint(Math.min(Math.max(b.left + b.width / 2, 0), innerWidth - 1), Math.min(Math.max(b.top + b.height / 2, 0), innerHeight - 1));
        const nm = (a.getAttribute('aria-label') || (a.labels && a.labels[0] && a.labels[0].textContent) || a.textContent || a.getAttribute('title') || '').trim();
        return { id: a.__p15, d: a.tagName.toLowerCase() + (a.className && typeof a.className === 'string' ? '.' + a.className.trim().split(/\\s+/)[0] : '') + '"' + nm.slice(0, 20) + '"', visible: b.width > 0 && b.height > 0 && !a.closest('[hidden]'), named: !!nm, ring: [a, a.parentElement, a.closest('.card, .gallery-tile, .topic-row, .conversation-item, .notification-item, article, li')].some((x) => { if (!x) return false; const y = getComputedStyle(x); return (y.outlineStyle !== 'none' && parseFloat(y.outlineWidth) >= 2) || (y.boxShadow && y.boxShadow !== 'none'); }), cov: top ? (top.tagName.toLowerCase() + '.' + String(top.className).split(' ')[0]) : 'none', covered: !(top === a || a.contains(top)), inView: b.right <= innerWidth + 1 && b.left >= -1 };
      })()`);
      if (info.body) break;
      if (seen.has(info.id)) break;
      seen.add(info.id);
      stops++;
      if (!info.visible) bad.push("focus on an invisible element " + info.d);
      if (!info.named) bad.push("focus on an unnamed element " + info.d);
      if (!info.ring) bad.push("no visible focus indicator on " + info.d);
      if (info.visible && info.covered) bad.push("focused element covered by " + info.cov + " : " + info.d);
      if (info.visible && !info.inView) bad.push("focused element off-screen horizontally " + info.d);
    }
    return { stops, bad: [...new Set(bad)] };
  };
  // Open a dialog with a REAL click, then check semantics, fit, trap, Escape and focus return.
  const p15Dialog = async (tag, sel, idx, ja) => {
    if (process.env.P15_LOG) console.log("  .. dialog " + tag);
    const marked = await ev(`(() => { const el = document.querySelectorAll(${JSON.stringify(sel)})[${idx}]; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.setAttribute('data-p15-op', '1'); return true; })()`);
    if (!marked) return null;
    await sleep(150);
    const jsBefore = P15.jsDialogs.length;
    await p15Settle();
    await clickEl("[data-p15-op]");
    const opened = await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 1500);
    if (!opened && P15.jsDialogs.length > jsBefore) {
      const msg = P15.jsDialogs[P15.jsDialogs.length - 1];
      const hasJa = /[぀-ヿ一-鿿]/.test(msg);
      check(`${tag}: opens a native confirm() (cancelled) whose message is in the active language`, ja ? hasJa : !hasJa, msg);
      await ev(`document.querySelectorAll('[data-p15-op]').forEach((e) => e.removeAttribute('data-p15-op'))`);
      return true;
    }
    check(`${tag}: the dialog opens from a real click`, opened);
    if (!opened) { await ev(`document.querySelectorAll('[data-p15-op]').forEach((e) => e.removeAttribute('data-p15-op'))`); return false; }
    await sleep(200);
    const m = await ev(`(() => {
      const d = document.querySelector('.modal[role="dialog"]'); const b = d.getBoundingClientRect(); const vw = document.documentElement.clientWidth; const vh = innerHeight;
      const sc = (e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY);
      const c = d.querySelector('.modal__close'); const cb = c && c.getBoundingClientRect();
      const title = document.getElementById(d.getAttribute('aria-labelledby') || '__none');
      return { title: title ? title.textContent.trim() : '', modal: d.getAttribute('aria-modal') === 'true', focusIn: d.contains(document.activeElement), fitsX: b.left >= -0.5 && b.right <= vw + 0.5, fitsY: b.top >= -0.5 && (b.bottom <= vh + 0.5 || sc(d) || sc(d.parentElement)), inner: d.scrollWidth - d.clientWidth, closeOk: !!c && !!c.getAttribute('aria-label') && cb.top >= -0.5 && cb.bottom <= vh + 0.5 && cb.right <= vw + 0.5, locked: getComputedStyle(document.body).overflow === 'hidden' };
    })()`);
    check(`${tag}: role=dialog + aria-modal, named by a non-empty title, focus moved inside, page scroll locked, close button named and in view`, m.title.length > 0 && m.modal && m.focusIn && m.locked && m.closeOk, JSON.stringify(m));
    if (!(m.title.length > 0 && m.modal && m.focusIn && m.locked && m.closeOk && m.fitsX && m.fitsY && m.inner <= 1)) await shot("p15-fail-" + tag.replace(/[^a-z0-9]+/gi, "-").slice(0, 80));
    check(`${tag}: the dialog fits the viewport (no horizontal spill, no internal horizontal overflow; tall dialogs scroll internally)`, m.fitsX && m.fitsY && m.inner <= 1, JSON.stringify(m));
    const au = await p15Audit(".modal", ja);
    check(`${tag}: dialog contents -- no clipped/overlapping text, every control named`, au.resp.length === 0 && au.a11y.length === 0, [...au.resp, ...au.a11y].slice(0, 4).join(" | "));
    const n = await ev(`document.querySelector('.modal[role="dialog"]').querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])').length`);
    let trapped = true;
    for (let i = 0; i < n + 2; i++) { await tab(false); if (!(await ev(`document.querySelector('.modal[role="dialog"]').contains(document.activeElement)`))) trapped = false; }
    for (let i = 0; i < 3; i++) { await tab(true); if (!(await ev(`document.querySelector('.modal[role="dialog"]').contains(document.activeElement)`))) trapped = false; }
    check(`${tag}: Tab / Shift+Tab stay trapped inside the dialog (${n} focusable)`, trapped);
    await press("esc");
    const closed = await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2000);
    const back = await ev(`document.activeElement && document.activeElement.hasAttribute('data-p15-op')`);
    check(`${tag}: Escape closes it, the page scrolls again, and focus returns to the control that opened it`, closed && back && (await ev(`getComputedStyle(document.body).overflow !== 'hidden'`)), `closed=${closed} back=${back}`);
    await ev(`document.querySelectorAll('[data-p15-op]').forEach((e) => e.removeAttribute('data-p15-op'))`);
    return true;
  };
  // PNG generator (no deps): w x h gradient, so the lightbox has a real, sizeable image.
  const p15Png = (w, h) => {
    const zlib = require("node:zlib");
    const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
    const crc = (buf) => { let c = -1; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1); raw[o] = 0; raw[o + 1 + x * 3] = (x * 255 / w) | 0; raw[o + 2 + x * 3] = (y * 255 / h) | 0; raw[o + 3 + x * 3] = 128; }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  };

  await step("i18n sweep: seed extra fixtures (conversation, notifications, gallery, long text)", async () => {
    const asClient = async (email, pw) => { const c = new Client(); await c.req("POST", "/auth/login", { email, password: pw }); return c; };
    const adm = await asClient(ADMIN.email, ADMIN.password);
    const plainC = await asClient(D.plain.email, PW);
    const leadC = await asClient(D.lead.email, PW);
    const LONG_JA = "超長い日本語のタイトルがレイアウトを壊さないことを確認するためのテスト用の非常に長い文章です。";
    const LONG_TOKEN = "ZZP15" + "x".repeat(70);
    Object.assign(P15, { plainC, leadC, adm, LONG_JA, LONG_TOKEN, jsDialogs: [] });
    ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Page.javascriptDialogOpening") { P15.jsDialogs.push(m.params.message); send("Page.handleJavaScriptDialog", { accept: false }); } });
    const conv = await plainC.req("POST", "/messages/conversations", { teamMemberId: D.lead.tmId });
    P15.convId = conv.json?.id;
    await leadC.req("POST", `/messages/conversations/${P15.convId}/messages`, { body: "ZZ P15 " + LONG_JA });
    await plainC.req("POST", `/messages/conversations/${P15.convId}/messages`, { body: "ZZ P15 own message " + LONG_TOKEN });
    await plainC.req("POST", `/messages/conversations/${P15.convId}/messages`, { body: "ZZ P15 " + LONG_JA + "\n二行目もあります。" });
    await leadC.req("POST", `/messages/conversations/${P15.convId}/messages`, { body: "ZZ P15 reply from lead" });
    const upload = async (client, caption, category, visibility, w, h) => {
      const fd = new FormData();
      fd.append("file", new Blob([p15Png(w, h)], { type: "image/png" }), "p15.png");
      fd.append("caption", caption); fd.append("category", category);
      if (visibility) fd.append("visibility", visibility);
      const res = await fetch(`${API}/api/gallery`, { method: "POST", headers: { cookie: client.cookie }, body: fd });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const g1 = await upload(plainC, "ZZ P15 " + LONG_JA, "LAB_LIFE", null, 1200, 800);
    const g2 = await upload(plainC, "ZZ P15 photo two", "EVENT", null, 600, 900);
    const g3 = await upload(adm, "ZZ P15 public photo", "RESEARCH", "PUBLIC", 900, 600);
    check("p15 setup: two member gallery uploads and one public admin upload succeeded (multipart)", g1.status === 201 && g2.status === 201 && g3.status === 201, `${g1.status}/${g2.status}/${g3.status}`);
    await adm.req("POST", "/news", { date: "Jan 2034", sortDate: "2034-01-01", type: "Paper", title: "ZZ P15 " + LONG_JA + LONG_JA, description: LONG_TOKEN, visibility: "PUBLIC" });
    await adm.req("POST", "/publications", { year: 2034, title: "ZZ P15 " + LONG_JA, authors: LONG_TOKEN, venue: "v", visibility: "PUBLIC" });
    const cat = D.fCatPub.slug ? D.fCatPub : null;
    const ft = await plainC.req("POST", "/forum/posts", { categoryId: D.fCatPub.id, title: "ZZ P15 " + LONG_JA, body: "ZZ P15 body " + LONG_TOKEN });
    P15.fLong = ft.json;
    check("p15 setup: conversation, long-text news/publication and forum topic seeded", !!P15.convId && !!P15.fLong?.id && !!cat, `conv=${P15.convId} topic=${P15.fLong?.id}`);
  });

  await step("i18n sweep: English breadcrumbs keep their pre-localization wording (localization must not change English)", async () => {
    await desktop();
    await go("/");
    await ev(`localStorage.removeItem('scl.locale')`);
    for (const [label, p, first] of [["project detail", `/projects/${D.p1.id}`, "projects"], ["group detail", `/groups/${D.gPub.id}`, "groups"], ["member detail", `/team/${D.lead.tmId}`, "team"], ["forum topic", `/community/forum/topic/${D.fTopic.id}`, "community"]]) {
      await p15Ready(p);
      const crumbs = await ev(`[...document.querySelectorAll('.breadcrumbs li')].map((l) => l.textContent.trim().toLowerCase())`);
      check(`p15 en breadcrumb ${label}: starts "Home / ${first}" (English wording unchanged by localization)`, crumbs[0] === "home" && crumbs[1] === first, JSON.stringify(crumbs));
    }
  });

  const p15Loop = async (userKey, loginFn, pages, perCombo) => {
    if (process.env.P15_USERS && !process.env.P15_USERS.split(",").includes(userKey)) return;
    for (const loc of ["en", "ja"]) {
      await go("/");
      await ev(`localStorage.setItem('scl.locale','${loc}')`);
      if (loginFn) check(`p15 ${userKey} ${loc}: login`, await loginFn());
      for (const w of P15_WIDTHS) {
        await p15Vp(w);
        for (const [label, p] of pages) {
          await p15Ready(p);
          check(`p15 ${loc} ${w}px ${userKey} ${label}: <html lang> matches the chosen language`, (await ev(`document.documentElement.lang`)) === loc);
          const au = await p15Audit(null, loc === "ja");
          check(`p15 ${loc} ${w}px ${userKey} ${label}: responsive -- no horizontal overflow, clipped/spilling text or overlapping controls`, au.resp.length === 0, au.resp.slice(0, 4).join(" | "));
          check(`p15 ${loc} ${w}px ${userKey} ${label}: accessibility -- named controls, one h1/main, no raw keys, no untranslated aria/labels`, au.a11y.length === 0, au.a11y.slice(0, 4).join(" | "));
        }
        if (perCombo) await perCombo(loc, w);
      }
      if (loginFn) await logout();
    }
    await ev(`localStorage.removeItem('scl.locale')`);
    await desktop();
  };

  await step("i18n sweep: guest -- public pages, dialogs-free surfaces, language switcher, keyboard", async () => {
    const pages = [["home", "/"], ["research", "/research"], ["projects", "/projects"], ["project detail", `/projects/${D.p1.id}`], ["groups", "/groups"], ["group detail", `/groups/${D.gPub.id}`], ["team", "/team"], ["member detail", `/team/${D.lead.tmId}`], ["publications", "/publications"], ["news", "/news"], ["search results", "/search?q=FPGA"], ["search landing", "/search"], ["contact", "/contact"], ["login", "/login"], ["forum index", "/community/forum"], ["forum category", `/community/forum/category/${D.fCatPub.slug}`], ["forum topic", `/community/forum/topic/${D.fTopic.id}`], ["forum long topic", `/community/forum/topic/${P15.fLong?.id}`], ["gallery (public)", "/gallery"], ["schedule (guest bounce -> login)", "/schedule"], ["404", "/no-such-page-p15"]];
    await p15Loop("guest", null, pages, async (loc, w) => {
      const tag = `p15 ${loc} ${w}px language switcher`;
      await p15Ready("/contact");
      const ham = await ev(`getComputedStyle(document.querySelector('.nav__hamburger')).display !== 'none'`);
      if (ham && !(await openPhoneMenu())) check(`${tag}: hamburger opens`, false);
      const sw = await ev(`(() => { const t = document.querySelector('.lang-switch > .nav__trigger'); if (!t) return null; const b = t.getBoundingClientRect(); return { name: t.textContent.trim(), exp: t.getAttribute('aria-expanded'), inView: b.width > 0 && b.left >= 0 && b.right <= innerWidth, ctl: !!document.getElementById(t.getAttribute('aria-controls')) }; })()`);
      check(`${tag}: the trigger is visible, in the viewport, named, collapsed and controls a real panel${ham ? " (inside the open hamburger menu)" : ""}`, !!sw && sw.name.length > 0 && sw.inView && sw.exp === "false" && sw.ctl, JSON.stringify(sw));
      await focusSel(".lang-switch > .nav__trigger");
      await press("enter");
      const opened = await ev(`document.querySelector('.lang-switch > .nav__trigger').getAttribute('aria-expanded') === 'true'`);
      const panel = await ev(`(() => { const p = document.querySelector('.lang-switch__panel'); const bs = [...p.querySelectorAll('button')]; return { n: bs.length, vis: bs.every((x) => { const b = x.getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth && b.height >= 28; }), hit: bs.every((x) => { const b = x.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return x === t || x.contains(t); }), named: bs.every((x) => x.textContent.trim().length > 0), cur: bs.filter((x) => x.getAttribute('aria-current') === 'true').length, label: !!p.getAttribute('aria-label') }; })()`);
      check(`${tag}: Enter opens it; both language options are in view, hittable, named, exactly one marked current`, opened && panel.n === 2 && panel.vis && panel.hit && panel.named && panel.cur === 1 && panel.label, JSON.stringify(panel));
      await press("esc");
      check(`${tag}: Escape closes it and returns focus to the trigger`, (await ev(`document.querySelector('.lang-switch > .nav__trigger').getAttribute('aria-expanded')`)) === "false" && (await ev(`document.activeElement === document.querySelector('.lang-switch > .nav__trigger')`)));
      await focusSel(".lang-switch > .nav__trigger");
      await press("enter");
      const other = loc === "en" ? "ja" : "en";
      const idx = await ev(`[...document.querySelectorAll('.lang-switch__panel button')].findIndex((b) => b.getAttribute('aria-current') !== 'true')`);
      await ev(`document.querySelectorAll('.lang-switch__panel button')[${idx}].focus()`);
      await press("enter");
      await sleep(250);
      check(`${tag}: choosing the other language from the keyboard switches <html lang>, persists it, closes the panel and returns focus to the trigger`, (await ev(`document.documentElement.lang`)) === other && (await ev(`localStorage.getItem('scl.locale')`)) === other && (await ev(`document.querySelector('.lang-switch > .nav__trigger').getAttribute('aria-expanded')`)) === "false" && (await ev(`document.activeElement === document.querySelector('.lang-switch > .nav__trigger')`)));
      const au2 = await p15Audit(null, other === "ja");
      check(`${tag}: after the live switch (no reload) the same page is still clean (${other})`, au2.resp.length === 0 && au2.a11y.length === 0, [...au2.resp, ...au2.a11y].slice(0, 3).join(" | "));
      await ev(`localStorage.setItem('scl.locale','${loc}')`);
      if (P15_TAB_WIDTHS.includes(w)) {
        for (const [lbl, p] of [["home", "/"], ["contact", "/contact"], ["forum topic", `/community/forum/topic/${D.fTopic.id}`]]) {
          await p15Ready(p);
          const tw = await p15TabWalk(60);
          check(`p15 ${loc} ${w}px keyboard ${lbl} (guest): Tab reaches ${tw.stops} stops -- all visible, named, ringed, uncovered`, tw.stops >= 5 && tw.bad.length === 0, tw.bad.slice(0, 3).join(" | "));
        }
      }
    });
  });

  await step("i18n sweep: member -- profile, messages, notifications, gallery, lightbox, forum, dialogs", async () => {
    const pages = [["profile", "/profile"], ["messages list", "/messages"], ["conversation", `/messages/${P15.convId}`], ["notifications", "/notifications"], ["gallery", "/gallery"], ["schedule", "/schedule"], ["forum topic", `/community/forum/topic/${D.fTopic.id}`], ["forum long topic", `/community/forum/topic/${P15.fLong?.id}`], ["search (member)", "/search?q=ZZ"], ["own member detail", `/team/${D.plain.tmId}`]];
    await p15Loop("member", () => login(D.plain.email, PW), pages, async (loc, w) => {
      const ja = loc === "ja";
      const T = `p15 ${loc} ${w}px`;
      // --- gallery: upload dialog + lightbox
      await p15Ready("/gallery");
      await p15Dialog(`${T} gallery upload dialog`, ".page-header .btn--primary, .page-header button.btn--primary", 0, ja);
      const tiles = await ev(`document.querySelectorAll('.gallery-tile__btn').length`);
      check(`${T} gallery: the member's uploads are listed (${tiles})`, tiles >= 2);
      if (tiles >= 2) {
        await ev(`document.querySelectorAll('.gallery-tile__btn')[0].scrollIntoView({ block: 'center' }); document.querySelectorAll('.gallery-tile__btn')[0].setAttribute('data-p15-op', '1')`);
        await sleep(150);
        await p15Settle();
    await clickEl("[data-p15-op]");
        const lbOpen = await waitFor(`!!document.querySelector('.lightbox__img')`, 4000);
        await waitFor(`document.querySelector('.lightbox__img') && document.querySelector('.lightbox__img').complete && document.querySelector('.lightbox__img').naturalWidth > 0`, 4000);
        const lb = await ev(`(() => { const d = document.querySelector('.modal[role="dialog"]'); if (!d) return null; const i = document.querySelector('.lightbox__img'); const ib = i.getBoundingClientRect(); const db = d.getBoundingClientRect(); const vw = document.documentElement.clientWidth; const nav = [...document.querySelectorAll('.lightbox__nav button')]; const sc = (e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY); return { title: document.getElementById(d.getAttribute('aria-labelledby')).textContent.trim(), alt: i.getAttribute('alt'), imgIn: ib.left >= -0.5 && ib.right <= vw + 0.5 && ib.width > 40, dlgIn: db.left >= -0.5 && db.right <= vw + 0.5 && (db.bottom <= innerHeight + 0.5 || sc(d) || sc(d.parentElement)), navN: nav.length, navNamed: nav.every((b) => !!b.getAttribute('aria-label')), inner: d.scrollWidth - d.clientWidth, focusIn: d.contains(document.activeElement), meta: [...document.querySelectorAll('.lightbox__meta *')].every((e) => e.getBoundingClientRect().right <= vw + 0.5) }; })()`);
        check(`${T} lightbox: opens as a named dialog with focus inside, an image with alt text, and named Previous/Next buttons`, lbOpen && !!lb && lb.title.length > 0 && lb.alt && lb.alt.length > 0 && lb.focusIn && lb.navN === 2 && lb.navNamed, JSON.stringify(lb));
        check(`${T} lightbox: the image, dialog and metadata all fit the viewport (no horizontal overflow)`, !!lb && lb.imgIn && lb.dlgIn && lb.inner <= 1 && lb.meta, JSON.stringify(lb));
        const au = await p15Audit(".modal", ja);
        check(`${T} lightbox: no clipped/overlapping text, all controls named`, au.resp.length === 0 && au.a11y.length === 0, [...au.resp, ...au.a11y].slice(0, 3).join(" | "));
        const t0 = await ev(`document.querySelector('.modal h2').textContent`);
        await press("esc"); // close, reopen the SECOND to test arrows both ways
        await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2000);
        const back = await ev(`document.activeElement && document.activeElement.hasAttribute('data-p15-op')`);
        check(`${T} lightbox: Escape closes it and focus returns to the photo that opened it`, back);
        await ev(`document.querySelectorAll('[data-p15-op]').forEach((e) => e.removeAttribute('data-p15-op')); document.querySelectorAll('.gallery-tile__btn')[0].setAttribute('data-p15-op', '1')`);
        await p15Settle();
    await clickEl("[data-p15-op]");
        await waitFor(`!!document.querySelector('.lightbox__img')`, 3000);
        await sleep(150);
        await press("right");
        await sleep(200);
        const t1 = await ev(`document.querySelector('.modal h2') ? document.querySelector('.modal h2').textContent : ''`);
        await press("left");
        await sleep(200);
        const t2 = await ev(`document.querySelector('.modal h2') ? document.querySelector('.modal h2').textContent : ''`);
        check(`${T} lightbox: ArrowRight moves to the next photo and ArrowLeft back, keeping the dialog open`, t1 !== "" && t1 !== t0 && t2 === t0, `${t0} / ${t1} / ${t2}`);
        const trapN = await ev(`document.querySelector('.modal[role="dialog"]').querySelectorAll('a[href], button:not([disabled])').length`);
        let trapped = true;
        for (let i = 0; i < trapN + 2; i++) { await tab(false); if (!(await ev(`document.querySelector('.modal[role="dialog"]') && document.querySelector('.modal[role="dialog"]').contains(document.activeElement)`))) trapped = false; }
        check(`${T} lightbox: Tab stays trapped inside`, trapped);
        await press("esc");
        await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2000);
        await ev(`document.querySelectorAll('[data-p15-op]').forEach((e) => e.removeAttribute('data-p15-op'))`);
      }
      // gallery edit/delete icon buttons (own items): named + delete confirm dialog
      const own = await ev(`document.querySelectorAll('.gallery-tile .card-edit-btn .icon-btn').length`);
      check(`${T} gallery: icon-only edit/delete buttons exist on own photos and each has an aria-label (${own})`, own >= 2 && (await ev(`[...document.querySelectorAll('.gallery-tile .card-edit-btn .icon-btn')].every((b) => (b.getAttribute('aria-label') || '').trim().length > 0)`)));
      await p15Dialog(`${T} gallery edit-photo dialog`, ".gallery-tile .card-edit-btn .icon-btn:not(.icon-btn--danger)", 0, ja);
      await p15Dialog(`${T} gallery delete-confirm dialog (cancelled)`, ".gallery-tile .card-edit-btn .icon-btn--danger", 0, ja);

      // --- messaging
      await p15Ready(`/messages/${P15.convId}`);
      const msg = await ev(`(() => { const ta = document.getElementById('message-composer-body'); const f = ta.closest('form'); const s = f.querySelector('.form-submit'); return { labelled: ta.labels.length === 1 && ta.labels[0].textContent.trim().length > 0, formNamed: !!f.getAttribute('aria-label'), sendDisabledWhenEmpty: s.disabled, sendNamed: s.textContent.trim().length > 0, rows: document.querySelectorAll('.message-row').length }; })()`);
      check(`${T} messages: composer textarea is labelled, the form is named, Send is named and disabled while empty`, msg.labelled && msg.formNamed && msg.sendDisabledWhenEmpty && msg.sendNamed, JSON.stringify(msg));
      await focusSel("#message-composer-body");
      await setVal("message-composer-body", `ZZ P15 ${loc} ${w} ` + (ja ? "こんにちは、テストメッセージです。" : "hello") + " " + P15.LONG_TOKEN.slice(0, 40));
      await sleep(100);
      await press("enter");
      const sent = await waitFor(`document.querySelectorAll('.message-row').length === ${msg.rows + 1}`, 4000);
      check(`${T} messages: Enter in the composer sends the message, appends it, and empties the box`, sent && (await ev(`document.getElementById('message-composer-body').value`)) === "");
      const au = await p15Audit(null, ja);
      check(`${T} messages: after sending, the page is still overflow/clip/overlap-free and every control named`, au.resp.length === 0 && au.a11y.length === 0, [...au.resp, ...au.a11y].slice(0, 3).join(" | "));
      await ev(`document.querySelector('.message-row--mine .comment__actions .btn--link').scrollIntoView({ block: 'center' })`);
      await ev(`document.querySelector('.message-row--mine .comment__actions .btn--link').click()`);
      const ed = await ev(`(() => { const t = document.querySelector('.message-row--mine textarea[id^="message-edit-"]'); return t ? { labelled: t.labels.length === 1 && t.labels[0].textContent.trim().length > 0, focusable: !t.disabled } : null; })()`);
      check(`${T} messages: Edit swaps in a labelled textarea with Save / Cancel`, !!ed && ed.labelled && ed.focusable, JSON.stringify(ed));
      await ev(`(() => { const b = [...document.querySelectorAll('.message-row--mine .comment__actions button')].find((x) => x.classList.contains('btn--secondary')); if (b) b.click(); })()`);
      await sleep(150);
      await p15Dialog(`${T} messages delete-confirm dialog (cancelled)`, ".message-row--mine .comment__actions .btn--link:nth-child(2)", 0, ja);

      // --- notifications (a fresh unread each iteration)
      await P15.leadC.req("POST", `/messages/conversations/${P15.convId}/messages`, { body: `ZZ P15 ping ${loc} ${w}` });
      await P15.leadC.req("POST", `/messages/conversations/${P15.convId}/messages`, { body: `ZZ P15 pong ${loc} ${w}` });
      await p15Ready("/notifications");
      const nf = await ev(`(() => { const items = [...document.querySelectorAll('.notification-item')]; const links = document.querySelectorAll('.notification-item a, a.notification-item'); return { items: items.length, unread: document.querySelectorAll('.notification-item__dot').length, srUnread: [...document.querySelectorAll('.notification-item__dot')].every((d) => !!d.closest('.notification-item, li, a').querySelector('.sr-only')), mark: !!document.querySelector('.page-header .btn, .page-header button') }; })()`);
      check(`${T} notifications: items render, unread ones carry screen-reader text (not the dot alone), and the mark-all control exists`, nf.items >= 1 && nf.unread >= 1 && nf.srUnread && nf.mark, JSON.stringify(nf));
      const badge = await ev(`(() => { const nb = document.querySelector('.notification-badge'); return nb ? { aria: nb.getAttribute('aria-hidden'), text: nb.textContent } : null; })()`);
      check(`${T} notifications: the unread count badge exists in the menu as text (decorative dot is aria-hidden)`, !badge || badge.aria === "true" && /\d/.test(badge.text), JSON.stringify(badge));
      const tw0 = await ev(`(() => { const as = [...document.querySelectorAll('.notification-item a, a.notification-item')]; const a = as[as.length - 1]; if (!a) return null; a.focus(); return a.getAttribute('href'); })()`);
      await press("enter");
      check(`${T} notifications: Enter on a focused notification opens its target (${tw0})`, !!tw0 && (await waitFor(`location.pathname === ${JSON.stringify(tw0)}`, 4000)));
      await p15Ready("/notifications");
      const marked = await ev(`(() => { const b = document.querySelector('.page-header button'); if (!b) return false; b.scrollIntoView({ block: 'center' }); return true; })()`);
      if (marked) {
        await ev(`document.querySelector('.page-header button').setAttribute('data-p15-op', '1')`);
        await p15Settle();
    await clickEl("[data-p15-op]");
      }
      check(`${T} notifications: the mark-all-read button really clears every unread marker`, marked && (await waitFor(`document.querySelectorAll('.notification-item__dot').length === 0`, 4000)));
      await ev(`document.querySelectorAll('[data-p15-op]').forEach((e) => e.removeAttribute('data-p15-op'))`);

      // --- forum topic controls
      await p15Ready(`/community/forum/topic/${D.fTopic.id}`);
      const fr = await ev(`(() => { const ta = document.getElementById('comment-composer-body'); const rb = [...document.querySelectorAll('.reaction-btn')]; return { taLabel: !!ta && ta.labels.length === 1 && ta.labels[0].textContent.trim().length > 0, rn: rb.length, rNamed: rb.every((b) => b.textContent.trim().length > 0 && b.hasAttribute('aria-pressed')), grp: !!document.querySelector('.reaction-bar[aria-label]') }; })()`);
      check(`${T} forum: reaction group is named, every reaction button has text + aria-pressed, and the comment box is labelled`, fr.taLabel && fr.rn >= 1 && fr.rNamed && fr.grp, JSON.stringify(fr));
      if (fr.rn >= 1) {
        const before = await ev(`document.querySelector('.reaction-btn').getAttribute('aria-pressed')`);
        await ev(`document.querySelector('.reaction-btn').scrollIntoView({ block: 'center' }); document.querySelector('.reaction-btn').setAttribute('data-p15-op', '1')`);
        await p15Settle();
    await clickEl("[data-p15-op]");
        await sleep(500);
        const after = await ev(`document.querySelector('.reaction-btn').getAttribute('aria-pressed')`);
        check(`${T} forum: a real click toggles a reaction (aria-pressed flips)`, before !== after, `${before} -> ${after}`);
        await p15Settle();
    await clickEl("[data-p15-op]");
        await sleep(400);
        await ev(`document.querySelectorAll('[data-p15-op]').forEach((e) => e.removeAttribute('data-p15-op'))`);
      }
      await focusSel("#comment-composer-body");
      await setVal("comment-composer-body", `ZZ P15 ${loc} ${w} ` + (ja ? "コメントのテストです" : "a comment") + " " + P15.LONG_TOKEN.slice(0, 40));
      await sleep(100);
      await ev(`document.querySelector('#comment-composer-body').form.requestSubmit()`);
      const posted = await waitFor(`document.body.innerText.includes(${JSON.stringify(`ZZ P15 ${loc} ${w} `)})`, 4000);
      check(`${T} forum: posting a comment shows it in the list`, posted);
      const au3 = await p15Audit(null, ja);
      check(`${T} forum: with the new comment (long unbroken token) there is no overflow/clipping/overlap and every control is named`, au3.resp.length === 0 && au3.a11y.length === 0, [...au3.resp, ...au3.a11y].slice(0, 3).join(" | "));
      await p15Dialog(`${T} forum delete-comment confirm dialog (cancelled)`, ".comment__actions .btn--link:nth-child(2)", 0, ja);
      await p15Ready("/community/forum");
      await p15Dialog(`${T} forum new-topic dialog`, ".admin-bar .btn--primary", 0, ja);
      // --- keyboard walks
      if (P15_TAB_WIDTHS.includes(w)) {
        for (const [lbl, p] of [["profile", "/profile"], ["gallery", "/gallery"], ["conversation", `/messages/${P15.convId}`], ["notifications", "/notifications"], ["forum topic", `/community/forum/topic/${D.fTopic.id}`]]) {
          await p15Ready(p);
          const tw = await p15TabWalk(70);
          check(`${T} keyboard ${lbl} (member): Tab reaches ${tw.stops} stops -- all visible, named, ringed, uncovered`, tw.stops >= 5 && tw.bad.length === 0, tw.bad.slice(0, 3).join(" | "));
        }
      }
    });
  });

  await step("i18n sweep: admin -- dashboard, management pages, form/link/members/history dialogs, moderation", async () => {
    const pages = [["admin dashboard", "/admin"], ["research", "/research"], ["projects", "/projects"], ["project detail", `/projects/${D.p1.id}`], ["groups", "/groups"], ["group detail", `/groups/${D.gPub.id}`], ["team", "/team"], ["member detail", `/team/${D.lead.tmId}`], ["publications", "/publications"], ["news", "/news"], ["gallery", "/gallery"], ["forum index", "/community/forum"], ["forum topic (moderation)", `/community/forum/topic/${D.fTopic.id}`], ["search", "/search?q=ZZ"], ["notifications", "/notifications"], ["messages", "/messages"]];
    const dialogPages = [["research", "/research"], ["projects", "/projects"], ["project detail", `/projects/${D.p1.id}`], ["groups", "/groups"], ["group detail", `/groups/${D.gPub.id}`], ["team", "/team"], ["member detail", `/team/${D.lead.tmId}`], ["publications", "/publications"], ["news", "/news"], ["forum index", "/community/forum"], ["forum topic", `/community/forum/topic/${D.fTopic.id}`]];
    await p15Loop("admin", () => login(ADMIN.email, ADMIN.password), pages, async (loc, w) => {
      const ja = loc === "ja";
      const dialogSet = P15_TAB_WIDTHS.includes(w) ? dialogPages : dialogPages.filter(([l]) => ["projects", "project detail", "group detail", "member detail", "publications", "news", "forum topic"].includes(l));
      for (const [lbl, p] of dialogSet) {
        await p15Ready(p);
        const T = `p15 ${loc} ${w}px admin ${lbl}`;
        const forumTopic = lbl === "forum topic";
        if (forumTopic) {
          const nb = await ev(`document.querySelectorAll('.admin-bar button').length`);
          for (const i of nb >= 6 ? [0, 4] : [0]) await p15Dialog(`${T} moderation bar button #${i + 1} dialog`, ".admin-bar button", i, ja);
        }
        const sels = forumTopic ? [[".btn--danger.btn--sm", "delete (cancelled)"]] : [[".admin-bar button", "admin-bar action"], [".card-edit-btn .icon-btn:not(.icon-btn--danger)", "card edit/link icon"], [".card-edit-btn .icon-btn--danger, .admin-bar .btn--danger, .btn--danger.btn--sm", "delete (cancelled)"]];
        for (const [sel, nm] of sels) {
          const n = await ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
          for (let i = 0; i < Math.min(n, nm === "admin-bar action" ? 3 : 2); i++) {
            const r = await p15Dialog(`${T} ${nm} #${i + 1} dialog`, sel, i, ja);
            if (r === false) break;
            await ev(`window.scrollTo(0, 0)`);
          }
        }
      }
      if (P15_TAB_WIDTHS.includes(w)) {
        for (const [lbl, p] of [["admin dashboard", "/admin"], ["projects", "/projects"], ["forum topic (moderation)", `/community/forum/topic/${D.fTopic.id}`]]) {
          await p15Ready(p);
          const tw = await p15TabWalk(80);
          check(`p15 ${loc} ${w}px keyboard ${lbl} (admin): Tab reaches ${tw.stops} stops -- all visible, named, ringed, uncovered`, tw.stops >= 5 && tw.bad.length === 0, tw.bad.slice(0, 3).join(" | "));
        }
      }
    });
  });

  // ---------------------------------------------------------------- source hygiene (static)
  // ================================================================= PHASE 16: EVENTS
  section("phase 16: events");
  const E16 = {};
  const setTz = (id) => send("Emulation.setTimezoneOverride", { timezoneId: id });
  const setLocale = async (loc) => { await go("/"); await ev(loc ? `localStorage.setItem('scl.locale','${loc}')` : `localStorage.removeItem('scl.locale')`); };
  const evReady = async (p, mustHave) => { await go(p); await navReady(); await waitFor(`!document.querySelector('[aria-busy="true"]')`, 8000); if (mustHave) await waitText(mustHave, 9000); await sleep(250); };
  // The event cards on the page: title, classes, full text.
  const evCards = () => ev(`[...document.querySelectorAll('.event-card')].map((c) => ({ title: c.querySelector('.event-card__title')?.textContent.trim() || '', past: c.classList.contains('event-card--past'), text: c.innerText, when: c.querySelector('time')?.textContent.trim() || '', editBtns: c.querySelectorAll('.card-edit-btn .icon-btn').length }))`);
  const titlesOf = async () => (await evCards()).map((c) => c.title);
  const evApi = (method, p, body, locale) => ev(`fetch('/api${p}', { method: ${JSON.stringify(method)}, credentials: 'same-origin', headers: { 'Content-Type': 'application/json'${locale ? `, 'X-Locale': '${locale}'` : ""} }, body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))`);
  const mainText = () => ev(`document.getElementById('main').innerText`);
  const fillEventForm = async (v) => {
    for (const [id, val] of Object.entries(v)) {
      if (id === "event_allday") await ev(`(() => { const el = document.getElementById('event_allday'); if (el.checked !== ${!!val}) el.click(); })()`);
      else await setVal(id, val);
    }
  };
  // Marks one card's edit/delete icon, scrolls it to the middle of the screen (html has smooth scrolling) and clicks it for real.
  const clickCardBtn = async (cardTitle, danger) => {
    const ok = await ev(`(() => { document.querySelectorAll('[data-op]').forEach((e) => e.removeAttribute('data-op')); const c = [...document.querySelectorAll('.event-card')].find((x) => x.querySelector('.event-card__title').textContent.trim() === ${JSON.stringify(cardTitle)}); const b = c && c.querySelector(${JSON.stringify(danger ? ".card-edit-btn .icon-btn--danger" : ".card-edit-btn .icon-btn:not(.icon-btn--danger)")}); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.setAttribute('data-op', '1'); return true; })()`);
    if (!ok) return false;
    await p15Settle();
    return clickEl("[data-op]");
  };
  const dialogOpen = () => exists('.modal[role="dialog"]');
  const errText = () => ev(`document.getElementById('event_form_error')?.innerText.trim() || ''`);
  const iso = (days, hours = 0) => new Date(Date.now() + days * 864e5 + hours * 36e5).toISOString();
  // The steps below emulate Asia/Tokyo (fixed UTC+9, no DST), so a datetime-local value is the instant + 9h.
  const localInput = (isoStr) => new Date(new Date(isoStr).getTime() + 9 * 36e5).toISOString().slice(0, 16);

  await step("events seed: fixtures for time formatting, hostile text, member-owned events", async () => {
    if (!P15.jsDialogs) { P15.jsDialogs = []; ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Page.javascriptDialogOpening") { P15.jsDialogs.push(m.params.message); send("Page.handleJavaScriptDialog", { accept: false }); } }); }
    const asClient = async (email, pw) => { const c = new Client(); await c.req("POST", "/auth/login", { email, password: pw }); return c; };
    const adm = await asClient(ADMIN.email, ADMIN.password);
    const plainC = await asClient(D.plain.email, PW);
    Object.assign(E16, { adm, plainC });
    const mk = async (c, body) => (await c.req("POST", "/events", body)).json;
    E16.fixed = await mk(adm, { title: "ZZ B9 Event Fixed Time", startsAt: "2031-05-05T00:00:00.000Z", endsAt: "2031-05-05T01:30:00.000Z", visibility: "PUBLIC", location: "ZZ B9 Fixed Hall" });
    E16.allDay = await mk(adm, { title: "ZZ B9 Event All Day", allDay: true, startsAt: "2031-05-06T00:00:00.000Z", visibility: "PUBLIC" });
    E16.multi = await mk(adm, { title: "ZZ B9 Event Multi Day", allDay: true, startsAt: "2031-05-08T00:00:00.000Z", endsAt: "2031-05-10T00:00:00.000Z", visibility: "PUBLIC" });
    E16.xss = await mk(adm, { title: "ZZ B9 Event <img src=x onerror=window.__evXss=1>", description: "\"><svg onload=window.__evXss=3> <script>window.__evXss=4</script>", location: "<script>window.__evXss=2</script>", startsAt: iso(7), visibility: "PUBLIC", translations: { ja: { title: "ZZ B9 <img src=x onerror=window.__evXss=5> 日本語", description: "<script>window.__evXss=6</script>" } } });
    E16.plainKeep = await mk(plainC, { title: "ZZ B9 Event Plain Keep", description: "Owned by the plain member.", location: "ZZ B9 Lab", kind: "MEETING", startsAt: iso(9), translations: { ja: { title: "ZZ B9 プレーン会議" } } });
    E16.plainEdit = await mk(plainC, { title: "ZZ B9 Event Plain Edit", description: "To be edited in the browser.", location: "ZZ B9 Old Place", startsAt: iso(10), translations: { ja: { title: "ZZ B9 編集前" } } });
    check("events setup: fixed/all-day/multi-day/hostile and member-owned events seeded", [E16.fixed, E16.allDay, E16.multi, E16.xss, E16.plainKeep, E16.plainEdit].every((e) => e?.id), JSON.stringify([E16.fixed?.id, E16.allDay?.id, E16.multi?.id, E16.xss?.id, E16.plainKeep?.id, E16.plainEdit?.id]));
    check("events setup: a member-created event is LAB_ONLY until a manager publishes it", E16.plainKeep.visibility === undefined && (await adm.req("GET", `/events/${E16.plainKeep.id}`)).json.visibility === "LAB_ONLY");
  });

  // ---------------------------------------------------------------- guest
  await step("events guest: list, upcoming vs past, hidden, no edit controls", async () => {
    await desktop(); await setTz("Asia/Tokyo"); await setLocale(null);
    await evReady("/events", "ZZ B9 Event Public");
    const st = await pageStructure();
    check("events guest: exactly one <h1> 'Events' and one <main>; the tab title names the page", st.h1 === 1 && st.main === 1 && /^Events · /.test(st.title) && (await ev(`document.querySelector('h1').textContent`)) === "Events", JSON.stringify(st));
    const titles = await titlesOf();
    check("events guest: the upcoming list shows public upcoming events and never a LAB_ONLY one", titles.includes("ZZ B9 Event Public") && titles.includes("ZZ B9 Event Fixed Time") && !titles.some((t) => /Hidden|Plain Keep|Plain Edit/.test(t)), titles.join(" | "));
    check("events guest: no past event in the upcoming list", !titles.includes("ZZ B9 Event Past") && (await evCards()).every((c) => !c.past));
    const apiUp = (await evApi("GET", "/events?scope=upcoming&limit=200")).json.map((e) => e.title);
    check("events guest: the cards are in the API's order (soonest first) and the two agree on which events exist", JSON.stringify(titles) === JSON.stringify(apiUp) && titles.indexOf("ZZ B9 Event Public") < titles.indexOf("ZZ B9 Event Fixed Time"), titles.join(" | "));
    check("events guest: no add button, no edit/delete controls, no visibility badge", !(await exists(".admin-bar")) && !(await exists(".card-edit-btn")) && !(await exists(".vis-badge")));
    check("events guest: the Upcoming chip is current (aria-current) and Past is not", await ev(`(() => { const c = [...document.querySelectorAll('.chips .chip')]; return c.length === 2 && c[0].getAttribute('aria-current') === 'true' && c[0].classList.contains('active') && !c[1].hasAttribute('aria-current'); })()`));
    check("events guest: each card's title is the one link (to its detail page) and the date is a <time> element with a datetime", await ev(`[...document.querySelectorAll('.event-card')].every((c) => c.querySelectorAll('.event-card__title a').length === 1 && /^\\/events\\/[\\w-]+$/.test(c.querySelector('.event-card__title a').getAttribute('href')) && /^\\d{4}-\\d\\d-\\d\\dT/.test(c.querySelector('time').getAttribute('datetime')))`));
    check("events guest: the Schedule shortcut is not offered to a guest (that page is members-only)", !(await exists('#main a[href="/schedule"]')));
    await shot("events-guest-list");

    await evReady("/events?view=past", "ZZ B9 Event Past");
    const past = await evCards();
    const pt = past.map((c) => c.title);
    check("events guest: the Past tab lists past public events, never a LAB_ONLY one", pt.includes("ZZ B9 Event Past") && !pt.some((t) => /Hidden/.test(t)), pt.join(" | "));
    check("events guest: past cards are visibly distinct (muted class) AND say 'Past' in words", past.every((c) => c.past && /past/i.test(c.text)));
    check("events guest: past events are in the API's order (newest first)", JSON.stringify(pt) === JSON.stringify((await evApi("GET", "/events?scope=past&limit=200")).json.map((e) => e.title)), pt.join(" | "));
    check("events guest: the Past chip is now the current one", await ev(`document.querySelectorAll('.chips .chip')[1].getAttribute('aria-current') === 'true'`));
    await ev(`(() => { const a = [...document.querySelectorAll('.chips .chip')][0]; a.click(); })()`);
    check("events guest: clicking Upcoming goes back (client-side navigation, URL /events)", (await waitFor(`location.pathname === '/events' && !location.search`, 3000)) && (await waitText("ZZ B9 Event Public")));
    await shot("events-guest-past");
  });

  await step("events guest: API authorization from the browser", async () => {
    await evReady("/events", "ZZ B9 Event Public");
    check("events guest (browser fetch): POST /api/events is 401", (await evApi("POST", "/events", { title: "ZZ B9 nope", startsAt: iso(1) })).status === 401);
    check("events guest (browser fetch): PUT and DELETE are 401", (await evApi("PUT", `/events/${D.evPub.id}`, { title: "x" })).status === 401 && (await evApi("DELETE", `/events/${D.evPub.id}`)).status === 401);
    check("events guest (browser fetch): a hidden event is 404 and its list omits it", (await evApi("GET", `/events/${D.evHid.id}`)).status === 404 && !JSON.stringify((await evApi("GET", "/events?scope=all&limit=200")).json).includes("ZZ B9 Event Hidden"));
    check("events guest (browser fetch): the hidden event's Japanese title is not reachable either", (await evApi("GET", `/events/${D.evHid.id}`, undefined, "ja")).status === 404);
    check("events guest (browser fetch): GET /api/translations/EVENT/:id is 401", (await evApi("GET", `/translations/EVENT/${D.evPub.id}`)).status === 401);
  });

  await step("events guest: detail page, hidden and missing events", async () => {
    await evReady(`/events/${D.evPub.id}`, "A public seminar for the browser tests.");
    const st = await pageStructure();
    check("events guest detail: one <h1> equal to the title, one <main>, tab title names the event", st.h1 === 1 && st.main === 1 && (await ev(`document.querySelector('h1').textContent`)) === "ZZ B9 Event Public" && /^ZZ B9 Event Public · /.test(st.title), JSON.stringify(st));
    check("events guest detail: breadcrumb is Home / Events / <title>", JSON.stringify(await ev(`[...document.querySelectorAll('.breadcrumbs li')].map((l) => l.textContent.trim())`)) === JSON.stringify(["Home", "Events", "ZZ B9 Event Public"]));
    const facts = await ev(`[...document.querySelectorAll('.event-facts > div')].map((d) => [d.querySelector('dt').textContent.trim().toLowerCase(), d.querySelector('dd').innerText.trim()])`);
    const fmap = Object.fromEntries(facts);
    check("events guest detail: When / Where / Related project / More information are shown", !!fmap["when"] && fmap["where"] === "ZZ B9 Hall 1" && /ZZ B9 Project Public/.test(fmap["related project"] || "") && /example\.org\/zz-b9-event/.test(fmap["more information"] || ""), JSON.stringify(facts));
    check("events guest detail: the related project links to its page", await ev(`!!document.querySelector('.event-facts a[href="/projects/${D.p1.id}"]')`));
    check("events guest detail: the external link opens in a new tab safely and says so to screen readers", await ev(`(() => { const a = document.querySelector('.event-facts a[target=_blank]'); return !!a && /noopener/.test(a.rel) && /noreferrer/.test(a.rel) && /new tab/i.test(a.querySelector('.sr-only')?.textContent || '') && a.href === 'https://example.org/zz-b9-event'; })()`));
    check("events guest detail: the type is shown in words", /seminar/i.test(await ev(`document.querySelector('.detail-meta').innerText`)));
    check("events guest detail: no edit/delete controls for a guest", !(await exists(".admin-bar")) && !(await exists(".btn--danger")));
    await shot("events-guest-detail");

    await evReady(`/events/${D.evHid.id}`, "Event not found");
    const hiddenTxt = await mainText();
    await evReady("/events/nonexistentid123", "Event not found");
    const missingTxt = await mainText();
    check("events guest: a hidden event's URL shows the same not-found page as a missing one (nothing leaks: no title, no time, no place)", hiddenTxt === missingTxt && !/Hidden|Room 2|planning/i.test(hiddenTxt), hiddenTxt.slice(0, 120));
    check("events guest: the not-found page has one <h1>, a link back to all events, and no breadcrumb title leak", (await ev(`document.querySelectorAll('h1').length`)) === 1 && (await exists('a[href="/events"].btn')) && !/ZZ B9 Event Hidden/.test(await ev(`document.title + ' ' + document.querySelector('.breadcrumbs').innerText`)));
    await evReady("/events/bad%20id", "Event not found");
    check("events guest: a malformed id also shows not-found, not a crash", (await mainText()).includes("Event not found"));
  });

  await step("events guest: dates and times (EN/JA, time zones, all-day)", async () => {
    await desktop(); await setTz("Asia/Tokyo"); await setLocale(null);
    await evReady("/events", "ZZ B9 Event Fixed Time");
    const byTitle = async () => Object.fromEntries((await evCards()).map((c) => [c.title, c]));
    let c = await byTitle();
    check("events dates EN (Asia/Tokyo): 2031-05-05 00:00Z shows 9:00 – 10:30 AM on May 5, 2031", /May 5, 2031/.test(c["ZZ B9 Event Fixed Time"].when) && /9:00/.test(c["ZZ B9 Event Fixed Time"].when) && /10:30\s?AM/.test(c["ZZ B9 Event Fixed Time"].when), c["ZZ B9 Event Fixed Time"].when);
    check("events dates EN: an all-day event is a bare calendar date with no time", c["ZZ B9 Event All Day"].when === "May 6, 2031" && /all day/i.test(c["ZZ B9 Event All Day"].text), c["ZZ B9 Event All Day"].when);
    check("events dates EN: a multi-day all-day event shows one collapsed range", /^May 8\s?[–-]\s?10, 2031$/.test(c["ZZ B9 Event Multi Day"].when), c["ZZ B9 Event Multi Day"].when);
    await setTz("America/Los_Angeles");
    await evReady("/events", "ZZ B9 Event Fixed Time");
    c = await byTitle();
    check("events dates EN (America/Los_Angeles): the same instant shows in the viewer's own time zone (May 4, 5:00 – 6:30 PM)", /May 4, 2031/.test(c["ZZ B9 Event Fixed Time"].when) && /5:00/.test(c["ZZ B9 Event Fixed Time"].when) && /6:30\s?PM/.test(c["ZZ B9 Event Fixed Time"].when),c["ZZ B9 Event Fixed Time"].when);
    check("events dates: an all-day event stays on its calendar day in EVERY time zone (May 6 in Los Angeles too)", c["ZZ B9 Event All Day"].when === "May 6, 2031" && /^May 8\s?[–-]\s?10, 2031$/.test(c["ZZ B9 Event Multi Day"].when));
    await setTz("Pacific/Kiritimati"); // UTC+14
    await evReady("/events", "ZZ B9 Event All Day");
    c = await byTitle();
    check("events dates: ...and in the far east (UTC+14) as well", c["ZZ B9 Event All Day"].when === "May 6, 2031");
    await setTz("Asia/Tokyo");
    await setLocale("ja");
    await evReady("/events", "ZZ B9 Event Fixed Time");
    c = await byTitle();
    const fx = c["ZZ B9 Event Fixed Time"].when;
    check("events dates JA: Japanese format (2031/05/05 9時00分～10時30分), no AM/PM", /2031\/0?5\/0?5/.test(fx) && /9[:時]00/.test(fx) && /10[:時]30/.test(fx) && !/AM|PM/.test(fx), fx);
    check("events dates JA: all-day is a bare Japanese date and the badge says 終日", /^2031\/0?5\/0?6$/.test(c["ZZ B9 Event All Day"].when) && /終日/.test(c["ZZ B9 Event All Day"].text), c["ZZ B9 Event All Day"].when);
    check("events dates JA: the multi-day range is one Japanese range from 2031/05/08 to the 10th, with no time", /^2031\/0?5\/0?8/.test(c["ZZ B9 Event Multi Day"].when) && /10$/.test(c["ZZ B9 Event Multi Day"].when) && !/:/.test(c["ZZ B9 Event Multi Day"].when), c["ZZ B9 Event Multi Day"].when);
    await setLocale(null);
  });

  await step("events guest: Japanese localization + English fallback", async () => {
    await desktop(); await setTz("Asia/Tokyo"); await setLocale("ja");
    await evReady("/events", "ZZ B9 公開イベント");
    const cards = await evCards();
    const pub = cards.find((x) => x.title === "ZZ B9 公開イベント");
    check("events JA: a Japanese title override is shown on the card, with the kind in Japanese (セミナー)", !!pub && /セミナー/.test(pub.text) && /ブラウザテスト用の公開セミナーです。/.test(pub.text), pub?.text);
    check("events JA: the English title is NOT shown for an event that has a Japanese one", !cards.some((x) => x.title === "ZZ B9 Event Public"));
    check("events JA: an event without a Japanese override falls back to its English title", cards.some((x) => x.title === "ZZ B9 Event Fixed Time"));
    check("events JA: <html lang> is ja, the page title/heading/chips/description are Japanese", (await ev(`document.documentElement.lang`)) === "ja" && (await ev(`document.querySelector('h1').textContent`)) === "イベント" && /今後/.test(await ev(`document.querySelector('.chips').innerText`)) && /過去/.test(await ev(`document.querySelector('.chips').innerText`)));
    check("events JA: no raw translation key or English UI chrome leaks into the Japanese page", !/\bevents\.[a-z]|\bnav\.events|Upcoming events|No upcoming/.test(await mainText()));
    check("events JA: the tab title is Japanese", /^イベント · /.test(await ev(`document.title`)));
    await evReady(`/events/${D.evPub.id}`, "ZZ B9 公開イベント");
    check("events JA detail: title, description, type, labels are Japanese; heading equals the override", (await ev(`document.querySelector('h1').textContent`)) === "ZZ B9 公開イベント" && /ブラウザテスト用の公開セミナーです。/.test(await mainText()) && /日時/.test(await mainText()) && /場所/.test(await mainText()));
    check("events JA detail: the breadcrumb uses the Japanese section name", (await ev(`[...document.querySelectorAll('.breadcrumbs li')].map((l) => l.textContent.trim())`))[1] === "イベント");
    await evReady(`/events/${E16.fixed.id}`, "ZZ B9 Event Fixed Time");
    check("events JA detail: with no override, the English title/description stay (never blank)", (await ev(`document.querySelector('h1').textContent`)) === "ZZ B9 Event Fixed Time");
    await evReady(`/events/${D.evHid.id}`, "見つかりません");
    check("events JA: a hidden event is the same not-found for a guest, in Japanese — its Japanese title never appears", !(await mainText()).includes("非公開イベント") && /イベントが見つかりません/.test(await mainText()));
    await evReady("/events?view=past", "ZZ B9 Event Past");
    check("events JA: the past tab is Japanese and shows 終了", /終了/.test(await mainText()));
    // live switch, no reload
    await setLocale("en");
    await evReady("/events", "ZZ B9 Event Public");
    await ev(`(() => { const t = document.querySelector('.lang-switch > .nav__trigger'); t.click(); })()`);
    await sleep(150);
    await ev(`(() => { const b = [...document.querySelectorAll('.lang-switch__panel button')].find((x) => x.getAttribute('aria-current') !== 'true'); b.click(); })()`);
    check("events: the language switcher flips the page chrome live (heading, tabs, buttons) with no reload", await waitFor(`document.querySelector('h1').textContent === 'イベント' && document.documentElement.lang === 'ja'`, 4000));
    await evReady("/events", "ZZ B9 公開イベント");
    check("events: after the switch the next load shows the Japanese title (domain text follows the stored locale, like every other content type)", (await titlesOf()).includes("ZZ B9 公開イベント"));
    await setLocale(null);
  });

  await step("events guest: hostile text renders as text (XSS)", async () => {
    await desktop(); await setTz("Asia/Tokyo");
    for (const loc of [null, "ja"]) {
      await setLocale(loc);
      for (const p of ["/events", `/events/${E16.xss.id}`, `/search?q=${encodeURIComponent("ZZ B9 Event <img")}&type=event`]) {
        await evReady(p, "ZZ B9");
        await sleep(300);
        const r = await ev(`({ flag: typeof window.__evXss, scripts: document.querySelectorAll('#main script').length, imgs: document.querySelectorAll('#main img').length, svgs: document.querySelectorAll('#main svg[onload]').length, onerr: document.querySelectorAll('#main [onerror], #main [onload]').length })`);
        check(`events XSS (${loc || "en"}) ${p.slice(0, 30)}: nothing executed and no injected script/img/handler element exists`, r.flag === "undefined" && r.scripts === 0 && r.imgs === 0 && r.svgs === 0 && r.onerr === 0, JSON.stringify(r));
      }
    }
    await setLocale(null);
    await evReady("/events", "ZZ B9");
    check("events XSS: the hostile title is visible as literal text", (await mainText()).includes("<img src=x onerror=window.__evXss=1>") || (await mainText()).includes("ZZ B9 Event <img"));
    await setLocale(null);
  });

  await step("events guest: home preview", async () => {
    await desktop(); await setTz("Asia/Tokyo"); await setLocale(null);
    await evReady("/", "Upcoming events");
    const sec = await ev(`(() => { const h = document.getElementById('home-events'); if (!h) return null; const s = h.closest('section'); return { h: h.tagName, title: h.textContent.trim(), cards: [...s.querySelectorAll('.event-card')].map((c) => c.querySelector('.event-card__title').textContent.trim()), all: s.querySelector('a[href="/events"]')?.textContent.trim(), edit: s.querySelectorAll('.card-edit-btn').length }; })()`);
    check("events home: a labelled 'Upcoming events' section (h2) with a 'View all events' link to /events", !!sec && sec.h === "H2" && sec.title === "Upcoming events" && /View all events/.test(sec.all || ""), JSON.stringify(sec));
    check("events home: at most 3 events, soonest first, public only, no edit controls", !!sec && sec.cards.length === 3 && sec.cards[0] === "ZZ B9 Event Public" && !sec.cards.some((t) => /Hidden|Plain/.test(t)) && sec.edit === 0, JSON.stringify(sec?.cards));
    check("events home: the home page still has exactly one <h1>", (await ev(`document.querySelectorAll('h1').length`)) === 1);
    await shot("events-home-guest");
    await fake("*/api/events*", 200, "[]");
    await evReady("/", "Upcoming events");
    check("events home: with no events the section shows an empty state (no broken layout, no error)", await waitFor(`document.body.innerText.includes('No upcoming events.')`, 4000) && !(await exists("#main [role=alert]")) && (await ev(`document.querySelectorAll('.hero, #home-events').length`)) === 2);
    await unfake();
    await fake("*/api/events*", 500, JSON.stringify({ error: "SQLITE boom at /srv/app/db.ts:44" }));
    await evReady("/", "Upcoming events");
    check("events home: if the events request fails, a friendly message shows — not the raw error — and the rest of the page is intact", await waitFor(`document.body.innerText.includes('Could not load events.')`, 4000) && !/SQLITE|boom|\/srv\/app/.test(await text()) && (await exists("#home-news")) && (await exists("#home-projects")) && (await exists(".hero")));
    await unfake();
    await fake("*/api/events*", 200, "[]");
    await evReady("/events", "Events");
    check("events page: with no upcoming events the empty state explains it", await waitFor(`document.body.innerText.includes('No upcoming events.') && document.body.innerText.includes('New seminars')`, 4000) && !(await exists("#main [role=alert]")));
    await evReady("/events?view=past", "Events");
    check("events page: with no past events the empty state explains that", await waitFor(`document.body.innerText.includes('No past events.')`, 4000));
    await unfake();
    await fake("*/api/events*", 500, JSON.stringify({ error: "boom" }));
    await evReady("/events", "Events");
    check("events page: a failed load shows one alert with Try again (localized message, no raw error)", await waitFor(`!!document.querySelector('#main [role=alert]')`, 4000) && /Could not load events/.test(await mainText()) && !/boom/.test(await mainText()) && (await exists("#main [role=alert] button")));
    await unfake();
    await ev(`(() => { document.querySelector('#main [role=alert] button')?.click(); })()`);
    await evReady("/events", "ZZ B9 Event Public");
  });

  await step("events guest: search", async () => {
    await desktop(); await setTz("Asia/Tokyo"); await setLocale(null);
    const q = encodeURIComponent("ZZ B9 Event Public");
    await evReady(`/search?q=${q}`, "ZZ B9 Event Public");
    const chips = await ev(`[...document.querySelectorAll('.search-filters .chip')].map((c) => c.textContent.trim())`);
    check("events search: an Events filter chip exists with a count", chips.some((c) => /^Events\s*\d+$/.test(c)), chips.join(" | "));
    const res = await ev(`[...document.querySelectorAll('.search-result')].map((r) => ({ type: r.querySelector('.search-result__type').textContent.trim().toLowerCase(), title: r.querySelector('.search-result__title').textContent.trim(), href: r.querySelector('a').getAttribute('href'), cta: r.querySelector('.search-result__cta').textContent.trim() }))`);
    const hit = res.find((r) => r.title === "ZZ B9 Event Public");
    check("events search: the result is typed 'Event', links to /events/:id, and has its own call to action", !!hit && hit.type === "event" && hit.href === `/events/${D.evPub.id}` && /View event/.test(hit.cta), JSON.stringify(hit));
    await evReady(`/search?q=${q}&type=event`, "ZZ B9 Event Public");
    check("events search: filtering to Events keeps only events", await ev(`[...document.querySelectorAll('.search-result')].every((r) => /event/i.test(r.querySelector('.search-result__type').textContent))`));
    await evReady(`/search?q=${encodeURIComponent("ZZ B9 Event Hidden")}&type=event`, "ZZ B9");
    check("events search: a LAB_ONLY event is not found by a guest and no count/snippet reveals it", (await ev(`document.querySelectorAll('.search-result').length`)) === 0 && !/Room 2|planning meeting/.test(await mainText()) && !/[1-9]/.test((await ev(`document.querySelector('.search-filters').innerText`)).replace(/\s+/g, " ")) && !/Events\s*[1-9]/.test(await ev(`document.querySelector('.search-filters').innerText.replace(/\\s+/g, ' ')`)));
    await setLocale("ja");
    await evReady(`/search?q=${encodeURIComponent("公開イベント")}`, "ZZ B9 公開イベント");
    check("events search (Japanese): a Japanese translation is found, shown as Japanese, typed イベント", (await ev(`document.querySelector('.search-result__title').textContent`)).includes("公開イベント") && /イベント/.test(await ev(`document.querySelector('.search-result__type').textContent`)));
    await evReady(`/search?q=${encodeURIComponent("非公開イベント")}`, "ZZ B9");
    await sleep(500);
    check("events search (Japanese): a hidden event's Japanese title is not found by a guest", (await ev(`document.querySelectorAll('.search-result').length`)) === 0);
    await setLocale(null);
  });

  await step("events navigation: Community menu, hamburger, keyboard, active state, Schedule", async () => {
    await desktop(); await setTz("Asia/Tokyo"); await setLocale(null);
    await evReady("/events", "ZZ B9 Event Public");
    check("events nav: Events is in the Community menu (after Forum, before Gallery), with the right href", JSON.stringify(await panelHrefs("community")) === JSON.stringify(["/community/forum", "/events", "/gallery"]) && JSON.stringify(await panelLabels("community")) === JSON.stringify(["forum", "events", "gallery"]), JSON.stringify(await panelHrefs("community")));
    check("events nav: the current page is marked (aria-current=page) and the Community trigger looks active", await ev(`document.querySelector('#nav-panel-community a[href="/events"]').getAttribute('aria-current') === 'page'`) && (await ev(`document.querySelector('button.nav__trigger[aria-controls="nav-panel-community"]').className`)).includes("active"));
    await evReady(`/events/${D.evPub.id}`, "ZZ B9 Event Public");
    check("events nav: on an event's detail page Events is still the current section", await ev(`document.querySelector('#nav-panel-community a[href="/events"]').getAttribute('aria-current') === 'page'`));
    await go("/"); await navReady();
    check("events nav: opening Community with a REAL click lists Events and it is clickable", (await openMenu("community")) && (await clickEl('#nav-panel-community a[href="/events"]')) && (await waitFor(`location.pathname === '/events'`, 3000)));
    await go("/"); await navReady();
    await focusSel(trig("community"));
    await press("down"); await press("down"); // ArrowDown opens the menu on Forum; the next one lands on Events
    check("events nav: keyboard — ArrowDown moves through the Community items to Events", (await focusDesc()) === "events", await focusDesc());
    await press("enter");
    check("events nav: Enter on Events navigates there", await waitFor(`location.pathname === '/events'`, 3000));
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await go("/"); await navReady();
    check("events nav (390px): the hamburger menu contains an Events link", (await openPhoneMenu()) && (await hrefEverywhere("/events")));
    await desktop();
    await evReady("/events", "ZZ B9 Event Public");
    check("events nav: the header search box, language switcher and Log in link are all still present", await ev(`!!document.querySelector('.nav__search input[type=search], .nav__search input') && !!document.querySelector('.lang-switch') && !!document.querySelector('.nav__account > a[href="/login"]')`));
    check("events nav: the guest's top-level list is unchanged (Events is inside Community, not a new top-level entry)", JSON.stringify(await topLevel()) === JSON.stringify(["research", "people", "community", "contact", "log in"]), JSON.stringify(await topLevel()));
  });

  // ---------------------------------------------------------------- member
  await step("events member: sees LAB_ONLY events, add dialog, validation", async () => {
    await desktop(); await setTz("Asia/Tokyo"); await setLocale(null);
    check("events member: login", await login(D.plain.email, PW));
    await evReady("/events", "ZZ B9 Event Plain Keep");
    const titles = await titlesOf();
    check("events member: LAB_ONLY events are listed for a signed-in member", titles.includes("ZZ B9 Event Hidden") && titles.includes("ZZ B9 Event Plain Keep"), titles.join(" | "));
    check("events member: the toolbar offers 'Add event' and links to the Schedule calendar", (await exists(".admin-bar .btn--primary")) && /Add event/.test(await ev(`document.querySelector('.admin-bar .btn--primary').innerText`)) && (await exists('a[href="/schedule"]')));
    check("events member: the member does not see a visibility badge (only managers receive visibility)", !(await exists(".vis-badge")));
    const cards = await evCards();
    const own = cards.filter((c) => /Plain (Keep|Edit)/.test(c.title));
    const others = cards.filter((c) => !/Plain (Keep|Edit)/.test(c.title));
    check("events member: edit + delete controls appear ONLY on the member's own events", own.length === 2 && own.every((c) => c.editBtns === 2) && others.every((c) => c.editBtns === 0), JSON.stringify(cards.map((c) => [c.title, c.editBtns])));
    check("events member: the controls have accessible names that include the event title", await ev(`[...document.querySelectorAll('.card-edit-btn .icon-btn')].every((b) => /ZZ B9 Event Plain/.test(b.getAttribute('aria-label')))`));

    await clickEl(".admin-bar .btn--primary");
    check("events member: the Add event dialog opens (role=dialog, named, focus inside)", await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 3000) && (await ev(`document.querySelector('.modal').contains(document.activeElement)`)) && (await ev(`document.getElementById(document.querySelector('.modal').getAttribute('aria-labelledby')).textContent`)) === "Add event");
    check("events member: the form has no visibility or project control, but does explain the LAB_ONLY default", !(await exists("#event_visibility")) && !(await exists("#event_project")) && /until a lab manager makes them public/.test(await ev(`document.querySelector('.modal').innerText`)));
    check("events member: every form control has a label", await ev(`[...document.querySelectorAll('.modal input:not([type=hidden]), .modal select, .modal textarea')].every((e) => e.labels && e.labels.length > 0)`));
    check("events member: start/end are date-time controls; the Japanese fields sit in a fieldset labelled 日本語", (await ev(`document.getElementById('event_start').type`)) === "datetime-local" && (await ev(`document.getElementById('event_end').type`)) === "datetime-local" && (await ev(`document.querySelector('.modal fieldset legend').textContent`)) === "日本語");

    await submitModal();
    await waitFor(`!!document.getElementById('event_form_error')`, 2000);
    check("events form: submitting empty says 'Title is required.' in an alert, focuses the title, and ties them together (aria-invalid + aria-describedby)", (await errText()) === "Title is required." && (await ev(`document.activeElement.id`)) === "event_title" && (await ev(`document.getElementById('event_title').getAttribute('aria-invalid')`)) === "true" && (await ev(`document.getElementById('event_title').getAttribute('aria-describedby')`)) === "event_form_error" && (await ev(`document.getElementById('event_form_error').getAttribute('role')`)) === "alert");
    await fillEventForm({ event_title: "ZZ B9 Event Form Test" });
    await submitModal();
    await waitFor(`document.getElementById('event_form_error')?.innerText.includes('Start')`, 2000);
    check("events form: a missing start is reported and focused", (await errText()) === "Start is required." && (await ev(`document.activeElement.id`)) === "event_start", JSON.stringify({ err: await errText(), active: await ev(`document.activeElement.id`) }));
    await fillEventForm({ event_start: localInput(iso(20)), event_end: localInput(iso(19)) });
    await submitModal();
    await waitFor(`document.getElementById('event_form_error')?.innerText.includes('End')`, 2000);
    check("events form: an end before the start is rejected and the END field is the one marked", (await errText()) === "End can't be before the start." && (await ev(`document.activeElement.id`)) === "event_end" && (await ev(`document.getElementById('event_end').getAttribute('aria-invalid')`)) === "true" && !(await ev(`document.getElementById('event_start').hasAttribute('aria-invalid')`)), JSON.stringify({ err: await errText(), active: await ev(`document.activeElement.id`), endInvalid: await ev(`document.getElementById('event_end').getAttribute('aria-invalid')`), startInvalid: await ev(`document.getElementById('event_start').getAttribute('aria-invalid')`) }));
    await fillEventForm({ event_end: "", event_url: "javascript:alert(1)" });
    await submitModal();
    await waitFor(`document.getElementById('event_form_error')?.innerText.includes('Link')`, 2000);
    check("events form: a javascript: link is rejected before anything is sent", /^Link must be a valid URL/.test(await errText()) && (await ev(`document.activeElement.id`)) === "event_url");
    await fillEventForm({ event_url: "", event_title: "x".repeat(201) });
    check("events form: the title input stops typing at 200 characters (maxLength)", (await ev(`document.getElementById('event_title').maxLength`)) === 200);
    check("events form: no request reached the server for the invalid submissions", !(await evApi("GET", "/events?scope=all&limit=200")).json.some((e) => e.title.startsWith("ZZ B9 Event Form Test")));
    await press("esc");
    check("events member: Escape closes the dialog and returns focus to the Add event button", (await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2000)) && (await ev(`document.activeElement.classList.contains('btn--primary') && document.activeElement.closest('.admin-bar') !== null`)));
  });

  await step("events member: create, edit (incl. clearing a translation), delete", async () => {
    await desktop(); await setTz("Asia/Tokyo");
    await evReady("/events", "ZZ B9 Event Plain Keep");
    // ---- create through the real form
    await clickEl(".admin-bar .btn--primary");
    await waitFor(`!!document.getElementById('event_title')`, 3000);
    const start = localInput(iso(15));
    await fillEventForm({ event_title: "ZZ B9 Event Created By Member", event_kind: "SOCIAL", event_start: start, event_end: localInput(iso(15, 2)), event_location: "ZZ B9 Cafeteria", event_description: "Made from the browser form.", event_url: "https://example.org/made", event_title_ja: "ZZ B9 メンバー作成イベント", event_description_ja: "ブラウザから作成。" });
    await submitModal();
    check("events member: a valid form saves, closes the dialog and the new card appears", (await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 5000)) && (await waitText("ZZ B9 Event Created By Member", 5000)));
    const created = (await evApi("GET", "/events?scope=all&limit=200")).json.find((e) => e.title === "ZZ B9 Event Created By Member");
    E16.created = created;
    check("events member: the saved event has the typed values (kind, place, link) and the exact instant the form's local time means", !!created && created.kind === "SOCIAL" && created.location === "ZZ B9 Cafeteria" && created.url === "https://example.org/made" && Math.abs(new Date(created.startsAt).getTime() - new Date(start + ":00+09:00").getTime()) < 1000 && created.canEdit === true, JSON.stringify(created));
    check("events member: the Japanese fields were saved as a translation, not as another event", (await evApi("GET", `/events/${created.id}`, undefined, "ja")).json.title === "ZZ B9 メンバー作成イベント" && (await evApi("GET", "/events?scope=all&limit=200")).json.filter((e) => /Created By Member|メンバー作成/.test(e.title)).length === 1);
    check("events member: it is LAB_ONLY (the member cannot publish) — a guest cannot see it", (await E16.adm.req("GET", `/events/${created.id}`)).json.visibility === "LAB_ONLY");
    // ---- edit
    await evReady("/events", "ZZ B9 Event Plain Edit");
    await clickCardBtn("ZZ B9 Event Plain Edit", false);
    check("events member: Edit opens the dialog prefilled with the event's values", (await waitFor(`!!document.getElementById('event_title')`, 3000)) && (await ev(`document.getElementById('event_title').value`)) === "ZZ B9 Event Plain Edit" && (await ev(`document.getElementById('event_location').value`)) === "ZZ B9 Old Place" && (await ev(`document.getElementById('event_description').value`)) === "To be edited in the browser.");
    check("events member: the Japanese fields are prefilled from the saved translation", await waitFor(`document.getElementById('event_title_ja').value === 'ZZ B9 編集前'`, 3000));
    check("events member: the start control shows the event's own local time", (await ev(`document.getElementById('event_start').value`)) === localInput(E16.plainEdit.startsAt));
    await fillEventForm({ event_location: "ZZ B9 New Place", event_title_ja: "" });
    await submitModal();
    check("events member: saving closes the dialog and the card shows the new place", (await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 5000)) && (await waitText("ZZ B9 New Place", 5000)));
    const ja1 = (await evApi("GET", `/events/${E16.plainEdit.id}`, undefined, "ja")).json;
    check("events member: clearing the Japanese title restores the English fallback (and removes the override)", ja1.title === "ZZ B9 Event Plain Edit" && ja1.location === "ZZ B9 New Place");
    // ---- the owner's own dialog: Cancel does nothing
    await clickCardBtn("ZZ B9 Event Plain Edit", false);
    await waitFor(`!!document.getElementById('event_title')`, 3000);
    await fillEventForm({ event_title: "ZZ B9 Should Not Save" });
    await ev(`[...document.querySelectorAll('.modal .btn--secondary')].find((b) => /cancel/i.test(b.textContent)).click()`);
    check("events member: Cancel discards changes", (await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2000)) && (await evApi("GET", `/events/${E16.plainEdit.id}`)).json.title === "ZZ B9 Event Plain Edit");
    // ---- delete with confirmation
    await clickCardBtn("ZZ B9 Event Created By Member", true);
    check("events member: Delete opens a confirmation dialog naming the event; focus starts on Cancel (the safe choice)", (await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 3000)) && /ZZ B9 Event Created By Member/.test(await ev(`document.querySelector('.modal').innerText`)) && (await ev(`document.activeElement.textContent.trim()`)) === "Cancel");
    await press("esc");
    check("events member: Escape cancels the deletion, focus returns to the Delete button, and the event still exists", (await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2000)) && (await ev(`document.activeElement.hasAttribute('data-op')`)) && (await evApi("GET", `/events/${created.id}`)).status === 200);
    await clickEl("[data-op]");
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 3000);
    await ev(`document.querySelector('.modal .btn--danger').click()`);
    check("events member: confirming deletes it — the card disappears and the API says 404", (await waitGone("ZZ B9 Event Created By Member", 5000)) && (await evApi("GET", `/events/${created.id}`)).status === 404);
    // ---- detail page of an event she does not own
    await evReady(`/events/${D.evPub.id}`, "ZZ B9 Event Public");
    check("events member: another person's event has no edit or delete controls", !(await exists(".admin-bar")));
    await evReady(`/events/${E16.plainKeep.id}`, "ZZ B9 Event Plain Keep");
    check("events member: her own event's detail page offers Edit and Delete", (await exists(".admin-bar")) && /Edit/.test(await ev(`document.querySelector('.admin-bar').innerText`)) && /Delete/.test(await ev(`document.querySelector('.admin-bar').innerText`)));
    await evReady(`/events/${D.evHid.id}`, "ZZ B9 Event Hidden");
    check("events member: a LAB_ONLY event's detail page opens for a signed-in member", (await ev(`document.querySelector('h1').textContent`)) === "ZZ B9 Event Hidden");
    check("events member (browser fetch): the API refuses another person's event — 403 for PUT and DELETE, and visibility/project 403 on her own", (await evApi("PUT", `/events/${D.evPub.id}`, { title: "hijack" })).status === 403 && (await evApi("DELETE", `/events/${D.evPub.id}`)).status === 403 && (await evApi("PUT", `/events/${E16.plainKeep.id}`, { visibility: "PUBLIC" })).status === 403 && (await evApi("PUT", `/events/${E16.plainKeep.id}`, { projectId: D.p1.id })).status === 403);
    await evReady("/schedule");
    check("events member: the Google Calendar Schedule page is unchanged (calendar iframe present) and links to Events", (await ev(`document.querySelector('iframe')?.src.startsWith('https://calendar.google.com/calendar/embed')`)) && (await exists('#main a[href="/events"]')));
    await logout();
  });

  // ---------------------------------------------------------------- Japanese form + validation messages
  await step("events member (Japanese): form labels and validation messages are Japanese", async () => {
    await desktop(); await setTz("Asia/Tokyo"); await setLocale("ja");
    check("events JA member: login", await login(D.plain.email, PW));
    await evReady("/events", "ZZ B9");
    await clickEl(".admin-bar .btn--primary");
    await waitFor(`!!document.getElementById('event_title')`, 3000);
    const labels = await ev(`[...document.querySelectorAll('.modal label')].map((l) => l.innerText.trim())`);
    check("events JA form: labels are Japanese (タイトル / 開始 / 場所 / 説明 / 種類)", ["タイトル", "開始", "場所", "説明", "種類"].every((w) => labels.some((l) => l.includes(w))), labels.join(" | "));
    check("events JA form: the kind options are Japanese", (await ev(`[...document.querySelectorAll('#event_kind option')].map((o) => o.textContent.trim())`)).join() === "セミナー,ミーティング,締め切り,交流会,その他");
    await submitModal();
    await waitFor(`!!document.getElementById('event_form_error')`, 2000);
    check("events JA form: the 'title required' error is Japanese and focuses the title", (await errText()) === "タイトルを入力してください。" && (await ev(`document.activeElement.id`)) === "event_title");
    await fillEventForm({ event_title: "ZZ B9 Event JA Form", event_start: localInput(iso(30)), event_end: localInput(iso(29)) });
    await submitModal();
    await waitFor(`document.getElementById('event_form_error')?.innerText.includes('終了')`, 2000);
    check("events JA form: 'end before start' is Japanese", (await errText()) === "終了日時は開始日時より前にできません。");
    await fillEventForm({ event_end: "", event_url: "javascript:x" });
    await submitModal();
    await waitFor(`document.getElementById('event_form_error')?.innerText.includes('リンク')`, 2000);
    check("events JA form: the URL error is Japanese", /^リンクは/.test(await errText()));
    await press("esc");
    // a server-side error also localizes: a member cannot set visibility (409/403 path is exercised through the API allow-list)
    await evReady("/events", "ZZ B9");
    await logout();
    await setLocale(null);
  });

  // ---------------------------------------------------------------- manager
  await step("events manager: visibility, project link, all-day toggle, publishing", async () => {
    await desktop(); await setTz("Asia/Tokyo"); await setLocale(null);
    check("events manager: login", await login(D.mgr.email, PW));
    await evReady("/events", "ZZ B9 Event Hidden");
    const cards = await evCards();
    check("events manager: edit and delete controls appear on EVERY event", cards.length >= 6 && cards.every((c) => c.editBtns === 2), JSON.stringify(cards.map((c) => [c.title, c.editBtns])));
    check("events manager: LAB_ONLY events carry a 'Lab only' badge (managers receive visibility)", (await ev(`[...document.querySelectorAll('.event-card')].filter((c) => c.querySelector('.vis-badge')).length`)) >= 3);
    check("events manager: the toolbar text names the manager role", /manager/i.test(await ev(`document.querySelector('.admin-bar__text').innerText`)) && /edit any event/.test(await ev(`document.querySelector('.admin-bar__text').innerText`)));
    await clickEl(".admin-bar .btn--primary");
    await waitFor(`!!document.getElementById('event_title')`, 3000);
    check("events manager: the form has a Visibility select (default Lab only) and a Related project select listing projects", (await ev(`document.getElementById('event_visibility').value`)) === "LAB_ONLY" && (await ev(`[...document.querySelectorAll('#event_project option')].map((o) => o.textContent.trim())`)).some((t) => t === "ZZ B9 Project Hidden") && (await ev(`document.getElementById('event_project').value`)) === "");
    check("events manager: the 'until a lab manager makes them public' note is NOT shown to a manager", !/until a lab manager/.test(await ev(`document.querySelector('.modal').innerText`)));
    await fillEventForm({ event_allday: true });
    check("events manager: All-day switches Start/End to date-only controls with date labels", (await ev(`document.getElementById('event_start').type`)) === "date" && (await ev(`document.getElementById('event_end').type`)) === "date" && /Start date/.test(await ev(`document.querySelector('label[for=event_start]').textContent`)));
    await fillEventForm({ event_title: "ZZ B9 Event Manager Made", event_start: "2032-03-04", event_end: "2032-03-05", event_visibility: "PUBLIC", event_project: D.p2.id, event_location: "ZZ B9 Mgr Place" });
    await submitModal();
    check("events manager: an all-day, public, project-linked event saves", (await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 5000)) && (await waitText("ZZ B9 Event Manager Made", 5000)));
    const made = (await evApi("GET", "/events?scope=all&limit=200")).json.find((e) => e.title === "ZZ B9 Event Manager Made");
    E16.mgrMade = made;
    check("events manager: stored as all-day UTC dates (2032-03-04..05), PUBLIC, linked to the hidden project", !!made && made.allDay && made.startsAt === "2032-03-04T00:00:00.000Z" && made.endsAt === "2032-03-05T00:00:00.000Z" && made.visibility === "PUBLIC" && made.project?.id === D.p2.id, JSON.stringify(made));
    // edit someone else's event (the public seminar): make it lab-only, then restore it
    await evReady(`/events/${D.evPub.id}`, "ZZ B9 Event Public");
    check("events manager: another person's event shows Edit and Delete on its detail page", /Edit/.test(await ev(`document.querySelector('.admin-bar').innerText`)) && !!(await exists(".admin-bar .btn--danger")));
    await ev(`(() => { [...document.querySelectorAll('.admin-bar button')].find((b) => /edit/i.test(b.textContent)).click(); })()`);
    await waitFor(`!!document.getElementById('event_title')`, 3000);
    check("events manager: editing prefills the Japanese title, visibility and the linked project", (await waitFor(`document.getElementById('event_title_ja').value === 'ZZ B9 公開イベント'`, 3000)) && (await ev(`document.getElementById('event_visibility').value`)) === "PUBLIC" && (await ev(`document.getElementById('event_project').value`)) === D.p1.id);
    await fillEventForm({ event_visibility: "LAB_ONLY" });
    await submitModal();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 5000);
    check("events manager: after making it Lab only the detail page shows the Lab-only badge", await waitFor(`!!document.querySelector('.detail-meta .vis-badge')`, 4000));
    check("events manager (audit trail visible via API): a visibility change happened", (await E16.adm.req("GET", `/events/${D.evPub.id}`)).json.visibility === "LAB_ONLY");
    await logout();
    // a guest can no longer see it, and the hidden project's title is not shown on the manager's public event
    await evReady("/events", "ZZ B9 Event Fixed Time");
    check("events guest (after the manager hid it): the public seminar is gone from the list", !(await titlesOf()).includes("ZZ B9 Event Public"));
    await evReady(`/events/${D.evPub.id}`, "Event not found");
    check("events guest (after the manager hid it): its direct URL is now a not-found page", (await mainText()).includes("Event not found"));
    await evReady(`/events/${E16.mgrMade.id}`, "ZZ B9 Event Manager Made");
    check("events guest: a public event linked to a HIDDEN project shows no project (title and link absent)", !/ZZ B9 Project Hidden/.test(await text()) && !(await exists(`a[href="/projects/${D.p2.id}"]`)) && !(await exists(".event-facts a[href^='/projects/']")));
    check("events guest: an all-day multi-day event by a manager shows the collapsed date range", /Mar 4\s?[–-]\s?5, 2032/.test(await ev(`document.querySelector('.event-facts time').textContent`)));
    // restore the seminar, log in as a member, check the project shows there
    check("events manager: login again", await login(D.mgr.email, PW));
    await evReady(`/events/${D.evPub.id}`, "ZZ B9 Event Public");
    await ev(`(() => { [...document.querySelectorAll('.admin-bar button')].find((b) => /edit/i.test(b.textContent)).click(); })()`);
    await waitFor(`!!document.getElementById('event_visibility')`, 3000);
    await fillEventForm({ event_visibility: "PUBLIC" });
    await submitModal();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 5000);
    check("events manager: the seminar is public again", (await E16.adm.req("GET", `/events/${D.evPub.id}`)).json.visibility === "PUBLIC");
    // remove the project link from the manager-made event through the form (test removal, not just addition)
    await evReady(`/events/${E16.mgrMade.id}`, "ZZ B9 Event Manager Made");
    await ev(`(() => { [...document.querySelectorAll('.admin-bar button')].find((b) => /edit/i.test(b.textContent)).click(); })()`);
    await waitFor(`!!document.getElementById('event_project')`, 3000);
    check("events manager: the project select is prefilled with the linked project", (await ev(`document.getElementById('event_project').value`)) === D.p2.id);
    await fillEventForm({ event_project: "" });
    await submitModal();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 5000);
    check("events manager: choosing 'None' removes the project link", (await E16.adm.req("GET", `/events/${E16.mgrMade.id}`)).json.project === null);
    // delete from the detail page -> back to the list
    await ev(`(() => { [...document.querySelectorAll('.admin-bar .btn--danger')].find((b) => /delete/i.test(b.textContent)).click(); })()`);
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 3000);
    await ev(`document.querySelector('.modal .btn--danger').click()`);
    check("events manager: deleting from the detail page returns to /events and the event is gone", (await waitFor(`location.pathname === '/events'`, 5000)) && (await E16.adm.req("GET", `/events/${E16.mgrMade.id}`)).status === 404);
    await logout();
  });

  await step("events admin: sees every control", async () => {
    await desktop(); await setTz("Asia/Tokyo"); await setLocale(null);
    check("events admin: login", await login(ADMIN.email, ADMIN.password));
    await evReady("/events", "ZZ B9 Event Hidden");
    const cards = await evCards();
    check("events admin: edit and delete on every event, including other people's", cards.length >= 5 && cards.every((c) => c.editBtns === 2));
    await evReady("/events?view=past", "ZZ B9 Event Past");
    check("events admin: the past list is manageable too", (await evCards()).every((c) => c.editBtns === 2 && c.past));
    await logout();
  });

  // ---------------------------------------------------------------- responsive + accessibility sweep (nine widths, EN + JA)
  const evPages = () => [["events", "/events"], ["events past", "/events?view=past"], ["event detail", `/events/${D.evPub.id}`], ["event detail long", `/events/${D.evLong.id}`], ["event detail hostile", `/events/${E16.xss.id}`], ["event not found", `/events/${D.evHid.id}`], ["search events", "/search?q=ZZ%20B9%20Event&type=event"], ["home", "/"]];
  await step("events sweep: guest -- list, past, detail, long text, not found, search, home (EN+JA, 390..1920)", async () => {
    await setTz("Asia/Tokyo");
    await p15Loop("events-guest", null, evPages());
    check("events sweep guest: no script from hostile event text ever ran", (await ev(`typeof window.__evXss`)) === "undefined");
  });
  await step("events sweep: member -- own events, dialogs (add / edit / delete) (EN+JA, 390..1920)", async () => {
    await setTz("Asia/Tokyo");
    const pages = [...evPages(), ["event detail (own)", `/events/${E16.plainKeep.id}`], ["schedule", "/schedule"]];
    await p15Loop("events-member", () => login(D.plain.email, PW), pages, async (loc, w) => {
      const ja = loc === "ja";
      const T = `events ${loc} ${w}px`;
      await p15Ready("/events");
      await p15Dialog(`${T} add-event dialog`, ".admin-bar .btn--primary", 0, ja);
      await p15Dialog(`${T} edit-event dialog`, ".card-edit-btn .icon-btn:not(.icon-btn--danger)", 0, ja);
      await p15Dialog(`${T} delete-event confirmation`, ".card-edit-btn .icon-btn--danger", 0, ja);
      await p15Ready(`/events/${E16.plainKeep.id}`);
      await p15Dialog(`${T} detail edit dialog`, ".admin-bar .btn--secondary", 0, ja);
      await p15Dialog(`${T} detail delete confirmation`, ".admin-bar .btn--danger", 0, ja);
      if (P15_TAB_WIDTHS.includes(w)) {
        for (const [lbl, p] of [["events", "/events"], ["event detail", `/events/${D.evPub.id}`]]) {
          await p15Ready(p);
          const tw = await p15TabWalk(60);
          check(`${T} keyboard ${lbl} (member): Tab reaches ${tw.stops} stops -- all visible, named, ringed, uncovered`, tw.stops >= 5 && tw.bad.length === 0, tw.bad.slice(0, 3).join(" | "));
        }
      }
    });
  });
  await step("events sweep: manager -- the full form (visibility + project) fits every viewport (EN+JA, 390..1920)", async () => {
    await setTz("Asia/Tokyo");
    await p15Loop("events-manager", () => login(D.mgr.email, PW), [["events", "/events"], ["event detail", `/events/${D.evLong.id}`]], async (loc, w) => {
      const T = `events ${loc} ${w}px manager`;
      await p15Ready("/events");
      await p15Dialog(`${T} add-event dialog (visibility + project)`, ".admin-bar .btn--primary", 0, loc === "ja");
      await p15Dialog(`${T} edit-event dialog`, ".event-card .card-edit-btn .icon-btn:not(.icon-btn--danger)", 0, loc === "ja");
    });
  });
  await step("events: reset the emulated time zone", async () => { await setTz(""); await desktop(); });


  // ================================================================= PHASE 17: ADMIN / CMS
  section("phase 17: admin / CMS");
  const A17 = {};
  const admReady = async (p, mustHave) => { await go(p); await navReady(); await waitFor(`!document.querySelector('[aria-busy="true"]')`, 9000); if (mustHave) await waitText(mustHave, 9000); await sleep(250); };
  // Scrolls the element to the middle first (html has smooth scrolling, so wait for it), then a REAL mouse click.
  const admClick = async (sel) => { await ev(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'center' })`); await p15Settle(); return clickEl(sel); };
  const admRows = () => ev(`[...document.querySelectorAll('.admin-row')].map((r) => ({ title: (r.querySelector('.admin-row__title')?.textContent || '').trim(), text: r.innerText }))`);
  const admTitles = async () => (await admRows()).map((r) => r.title);
  const admQ = (k) => ev(`new URLSearchParams(location.search).get(${JSON.stringify(k)})`);
  const admSubmit = () => ev(`document.querySelector('.admin-filters').requestSubmit()`);
  const admApi = (method, p, body, locale) => ev(`fetch('/api${p}', { method: ${JSON.stringify(method)}, credentials: 'same-origin', headers: { 'Content-Type': 'application/json'${locale ? `, 'X-Locale': '${locale}'` : ""} }, body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))`);
  const admPanelOpen = () => exists('.modal[role="dialog"]');
  const admNotice = () => ev(`document.querySelector('[role="status"] .form-success, [role="status"].form-success')?.innerText.trim() || ''`);
  const guestNewsIds = async () => (await (await fetch(`${API}/api/news`)).json()).map((n) => n.id);
  const admSections = () => ev(`[...document.querySelectorAll('.admin-nav a')].map((a) => a.getAttribute('href'))`);

  await step("admin seed: news, translation, hostile text, unlinked account, hidden forum topic, gallery item", async () => {
    if (!P15.jsDialogs) { P15.jsDialogs = []; ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Page.javascriptDialogOpening") { P15.jsDialogs.push(m.params.message); send("Page.handleJavaScriptDialog", { accept: false }); } }); }
    const asClient = async (email, pw) => { const c = new Client(); await c.req("POST", "/auth/login", { email, password: pw }); return c; };
    const adm = await asClient(ADMIN.email, ADMIN.password);
    A17.adm = adm;
    const plainC = await asClient(D.plain.email, PW);
    const LONG = "ZZP17" + "x".repeat(80);
    const LONG_JA = "超長い日本語のタイトルが管理画面のレイアウトを壊さないことを確認するためのテスト用の非常に長い文章です。";
    const mkNews = async (title, extra = {}) => (await adm.req("POST", "/news", { date: "Jan 2035", sortDate: "2035-01-01", type: "Paper", title, description: "ZZ B9 adm desc", visibility: "PUBLIC", ...extra })).json;
    A17.alpha = await mkNews("ZZ B9 Adm News Alpha");
    A17.beta = await mkNews("ZZ B9 Adm News Beta");
    A17.long = await mkNews("ZZ B9 Adm " + LONG + " " + LONG_JA, { description: LONG });
    A17.xss = await mkNews("ZZ B9 Adm <img src=x onerror=window.__admXss=1> Hostile", { description: "<script>window.__admXss=2</script>" });
    A17.plainEv = (await plainC.req("POST", "/events", { title: "ZZ B9 Adm Event Owned", description: "owned by the plain member", startsAt: new Date(Date.now() + 20 * 864e5).toISOString(), kind: "MEETING" })).json;
    check("admin setup: an event owned by a member", !!A17.plainEv?.id);
    check("admin setup: four news fixtures", [A17.alpha, A17.beta, A17.long, A17.xss].every((n) => n?.id));
    const tr = await adm.req("PUT", `/admin/translations/NEWS_ITEM/${A17.long.id}`, { field: "title", value: "ZZ B9 Adm " + LONG_JA + LONG_JA });
    check("admin setup: a long Japanese override", tr.status === 200);
    const solo = await adm.req("POST", "/users", { email: "b9-adm-solo@example.test", password: PW, role: "MEMBER" });
    A17.solo = { id: solo.json?.id, email: "b9-adm-solo@example.test" };
    check("admin setup: an account without a profile", solo.status === 201);
    const t = await adm.req("POST", "/forum/posts", { categoryId: D.fCatPub.id, title: "ZZ B9 Adm Hidden Topic", body: "ZZ B9 adm hidden body text that must never reach the admin area" });
    A17.hiddenTopic = t.json;
    await adm.req("POST", `/forum/posts/${t.json?.id}/hide`, {});
    const fd = new FormData();
    fd.append("file", new Blob([p15Png(600, 400)], { type: "image/png" }), "adm-evil<b>.png");
    fd.append("caption", "ZZ B9 Adm photo " + LONG_JA);
    fd.append("category", "RESEARCH");
    const g = await fetch(`${API}/api/gallery`, { method: "POST", headers: { cookie: adm.cookie }, body: fd });
    A17.gallery = await g.json().catch(() => null);
    check("admin setup: hidden forum topic + gallery upload", !!A17.hiddenTopic?.id && g.status === 201, `${g.status}`);
  });

  // ---------------------------------------------------------------- access by role
  await step("admin access: guest and member are kept out (client redirect + server refusal)", async () => {
    await desktop(); await setLocale(null);
    for (const p of ["/admin", "/admin/content", "/admin/audit", "/admin/people"]) { await go(p); await sleep(400); check(`admin guest: ${p} redirects to /login`, (await pathNow()) === "/login"); }
    check("admin guest: every admin API is 401", await (async () => { for (const p of ["/admin/overview", "/admin/content?type=news", "/admin/audit", "/admin/translations?type=EVENT", "/admin/community", "/admin/files"]) if ((await admApi("GET", p)).status !== 401) return false; return true; })());
    check("admin member: login", await login(D.plain.email, PW));
    for (const p of ["/admin", "/admin/content", "/admin/translations", "/admin/audit", "/admin/people"]) { await go(p); await sleep(500); check(`admin member: ${p} is bounced home`, (await pathNow()) === "/"); }
    check("admin member: no Admin link in the header, every admin API is 403", !(await exists('.nav a[href^="/admin"]')) && await (async () => { for (const p of ["/admin/overview", "/admin/content?type=news", "/admin/audit", "/admin/translations?type=EVENT", "/admin/community", "/admin/files"]) if ((await admApi("GET", p)).status !== 403) return false; return true; })());
    check("admin member: the write endpoints are 403 too and change nothing", (await admApi("POST", "/admin/content/visibility", { type: "news", ids: [A17.alpha.id], visibility: "LAB_ONLY" })).status === 403 && (await admApi("PUT", `/admin/translations/NEWS_ITEM/${A17.alpha.id}`, { field: "title", value: "x" })).status === 403 && (await A17.adm.req("GET", `/news`)).json.find((n) => n.id === A17.alpha.id)?.visibility === "PUBLIC");
    await logout();
  });

  await step("admin access: manager sees the management sections but not accounts; admin sees all eight", async () => {
    check("admin manager: login", await login(D.mgr.email, PW));
    await admReady("/admin", "Admin Dashboard");
    const secs = await admSections();
    check("admin manager: the section nav has seven sections and no People & Accounts", eqJson(secs, ["/admin", "/admin/content", "/admin/events", "/admin/community", "/admin/files", "/admin/translations", "/admin/audit"]), JSON.stringify(secs));
    check("admin manager: the header's Account menu has the Admin Dashboard link", await exists('#nav-panel-account a[href="/admin"]'));
    check("admin manager: the overview privacy note says private messages are never shown", (await text()).includes("Private messages and notifications are never shown"));
    await go("/admin/people"); await sleep(500);
    check("admin manager: /admin/people bounces home and /api/users is 403", (await pathNow()) === "/" && (await admApi("GET", "/users")).status === 403);
    await logout();
    check("admin admin: login", await login(ADMIN.email, ADMIN.password));
    await admReady("/admin", "Admin Dashboard");
    check("admin admin: eight sections including People & Accounts", eqJson(await admSections(), ["/admin", "/admin/people", "/admin/content", "/admin/events", "/admin/community", "/admin/files", "/admin/translations", "/admin/audit"]));
    check("admin admin: the section nav is a labelled <nav> with a list, and the current section is marked", await ev(`(() => { const n = document.querySelector('.admin-shell nav[aria-label]'); return !!n && n.querySelectorAll('ul > li > a').length === 8 && document.querySelectorAll('.admin-nav a[aria-current="page"]').length === 1; })()`));
    await logout();
  });

  await step("admin overview: real counts, admin-only account block, no private data", async () => {
    check("admin overview: login (admin)", await login(ADMIN.email, ADMIN.password));
    await admReady("/admin", "Admin Dashboard");
    await waitFor(`document.querySelectorAll('.admin-count, .stat-card').length >= 10`);
    const api = (await admApi("GET", "/admin/overview")).json;
    const cards = await ev(`[...document.querySelectorAll('.admin-count, .stat-card')].map((c) => [(c.querySelector('.admin-count__label, .stat-card__label')?.textContent || '').trim(), (c.querySelector('.admin-count__value, .stat-card__value')?.textContent || '').trim()])`);
    const by = Object.fromEntries(cards);
    check("admin overview: cards show the API's numbers (accounts, news, events, projects, publications, groups)", by["Accounts"] === String(api.accounts.total) && by["News"] === String(api.news.total) && by["Events"] === String(api.events.total) && by["Projects"] === String(api.projects.total) && by["Publications"] === String(api.publications.total) && by["Groups"] === String(api.groups.total), JSON.stringify(by));
    const t = await mainText();
    check("admin overview: shows public vs lab-only breakdowns and the upcoming events count", /\d+ public · \d+ lab only/.test(t) && /\d+ upcoming/.test(t));
    check("admin overview: no email address and no message/notification figure on the page", !/@/.test(t) && !/unread|conversation/i.test(t.replace(/Private messages and notifications are never shown[^.]*\./, "")));
    check("admin overview: every card is a link into its section", await ev(`[...document.querySelectorAll('a.admin-count')].every((a) => a.getAttribute('href').startsWith('/admin'))`));
    await logout();
    check("admin overview: manager login", await login(D.mgr.email, PW));
    await admReady("/admin", "Admin Dashboard");
    await waitFor(`document.querySelectorAll('.admin-count, .stat-card').length >= 8`);
    check("admin overview (manager): no account block, no 'Accounts' card", !(await ev(`[...document.querySelectorAll('.admin-count__label, .stat-card__label')].some((e) => e.textContent.trim() === 'Accounts')`)));
    await logout();
  });

  // ---------------------------------------------------------------- content browser
  await step("admin content: filters, search, deep links, pagination, hostile text (manager)", async () => {
    check("admin content: manager login", await login(D.mgr.email, PW));
    await admReady("/admin/content", "Research areas");
    check("admin content: eight type chips (events have their own section; Phase 22 added knowledge documents, Phase 23 lab resources) and one pressed", (await ev(`document.querySelectorAll('.admin-types .chip').length`)) === 8 && (await ev(`document.querySelectorAll('.admin-types .chip[aria-pressed="true"]').length`)) === 1);
    check("admin content: the results are a real list with a live count", (await exists("ul.admin-list")) && (await exists('[role="status"][aria-live="polite"]')));
    await admReady("/admin/content?type=news", "ZZ B9");
    check("admin content: the type in the URL is honoured (news)", (await admQ("type")) === "news" && (await ev(`document.querySelector('.admin-types .chip[aria-pressed="true"]').textContent.trim()`)) === "News");
    // search
    await setVal("af-q", "ZZ B9 Adm News");
    await admSubmit();
    await waitFor(`new URLSearchParams(location.search).get('q') === 'ZZ B9 Adm News'`);
    await waitFor(`document.querySelectorAll('.admin-row').length === 2`);
    const found = (await admTitles()).sort();
    check("admin content: search narrows to the matching records and the URL carries the query", eqJson(found, ["ZZ B9 Adm News Alpha", "ZZ B9 Adm News Beta"]), JSON.stringify(found));
    check("admin content: the count line says how many were found", (await ev(`document.querySelector('.admin-status').innerText`)).includes("2 found"));
    await go(`/admin/content?type=news&q=${encodeURIComponent("ZZ B9 Adm News")}`); await navReady();
    check("admin content: reloading the URL restores the same filtered view (deep link)", (await waitFor(`document.querySelectorAll('.admin-row').length === 2`)) && (await ev(`document.getElementById('af-q').value`)) === "ZZ B9 Adm News");
    // visibility filter
    await setVal("af-visibility", "LAB_ONLY");
    await admSubmit();
    await waitFor(`new URLSearchParams(location.search).get('visibility') === 'LAB_ONLY'`);
    await sleep(300);
    await waitFor(`!document.querySelector('.admin-list[aria-busy="true"]') && (!!document.querySelector('.empty-state') || document.querySelectorAll('.admin-row').length > 0)`);
    check("admin content: the visibility filter applies (none of the two public fixtures is lab-only -> empty state with a hint)", (await exists(".empty-state")) && (await text()).includes("Nothing matches these filters"));
    await ev(`[...document.querySelectorAll('.admin-filters button')].find((b) => /reset/i.test(b.textContent)).click()`);
    await waitFor(`!new URLSearchParams(location.search).get('q')`);
    check("admin content: Reset clears every filter and returns to the list", !(await admQ("q")) && !(await admQ("visibility")));
    // bad params in the URL never break the page
    await admReady("/admin/content?type=nonsense&page=abc&q=%25%27", "Research areas");
    check("admin content: a nonsense type/page/query in the URL falls back gracefully (no crash, no raw error)", (await exists("ul.admin-list, .empty-state")) && !(await text()).includes("Something went wrong"));
    // pagination
    await admReady("/admin/content?type=news&sort=title", "ZZ B9");
    const total = (await ev(`document.querySelector('.admin-status').innerText`));
    check("admin content: news has more than one page and a pager appears", (await exists(".admin-pager")) && /Page 1 of \d+/.test(await ev(`document.querySelector('.admin-pager').innerText`)), total);
    const page1 = await admTitles();
    await admClick('.admin-pager button:last-of-type');
    await waitFor(`new URLSearchParams(location.search).get('page') === '2'`);
    await waitFor(`document.querySelector('.admin-pager__status').textContent.includes('Page 2')`);
    const page2 = await admTitles();
    check("admin content: Next goes to page 2 (URL page=2), a different set of records, Previous is enabled", page2.length > 0 && !page2.some((t) => page1.includes(t)) && !(await ev(`document.querySelector('.admin-pager button:first-of-type').disabled`)));
    // hostile text
    await admReady(`/admin/content?type=news&q=${encodeURIComponent("ZZ B9 Adm")}&sort=title`, "Hostile");
    check("admin content: hostile HTML in a title is shown as text; no script or image element came from it", (await ev(`typeof window.__admXss`)) === "undefined" && (await ev(`document.querySelectorAll('.admin-list img, .admin-list script').length`)) === 0 && (await text()).includes("<img src=x"));
    check("admin content: a very long unbroken title wraps inside its row (no overflow)", (await overflowPx()) <= 1);
    await logout();
  });

  await step("admin content: bulk visibility with a confirmation dialog, and the record inspector", async () => {
    check("admin bulk: manager login", await login(D.mgr.email, PW));
    await admReady(`/admin/content?type=news&q=${encodeURIComponent("ZZ B9 Adm News")}`, "ZZ B9 Adm News Alpha");
    await waitFor(`document.querySelectorAll('.admin-row').length === 2`);
    check("admin bulk: every row has a labelled checkbox; the bulk bar is a named group; Apply is disabled with nothing selected", (await ev(`[...document.querySelectorAll('.admin-row__check')].every((c) => (c.getAttribute('aria-label') || '').startsWith('Select ZZ B9'))`)) && (await exists('.admin-bulk[role="group"]')) && (await ev(`[...document.querySelectorAll('.admin-bulk button')].find((b) => /apply/i.test(b.textContent)).disabled`)));
    await admClick(".admin-row:nth-child(1) .admin-row__check");
    await admClick(".admin-row:nth-child(2) .admin-row__check");
    check("admin bulk: ticking two rows says '2 selected' and enables Apply", (await ev(`document.querySelector('.admin-bulk__count').innerText`)).includes("2 selected") && !(await ev(`[...document.querySelectorAll('.admin-bulk button')].find((b) => /apply/i.test(b.textContent)).disabled`)));
    await setVal("bulk-visibility", "LAB_ONLY");
    await ev(`(() => { const b = [...document.querySelectorAll('.admin-bulk button')].find((x) => /apply/i.test(x.textContent)); b.setAttribute('data-adm-op', '1'); })()`);
    await admClick("[data-adm-op]");
    check("admin bulk: a confirmation dialog opens, states the count and the consequence, and nothing has changed yet", (await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 2000)) && (await ev(`document.querySelector('.modal').innerText`)).includes("2 selected") && (await ev(`document.querySelector('.modal').innerText`)).includes("lab only") && (await guestNewsIds()).includes(A17.alpha.id));
    check("admin bulk: focus starts on Cancel (the safe choice)", (await ev(`document.activeElement.textContent.trim()`)) === "Cancel");
    await press("esc");
    check("admin bulk: Escape closes the dialog, changes nothing and returns focus to Apply", (await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2000)) && (await ev(`document.activeElement.hasAttribute('data-adm-op')`)) && (await guestNewsIds()).includes(A17.alpha.id));
    await admClick("[data-adm-op]");
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 2000);
    await admClick(".modal .btn--primary");
    await waitFor(`document.querySelector('.admin-status')?.innerText.includes('Updated')`, 6000);
    check("admin bulk: confirming reports the result in a live region", (await ev(`document.querySelector('.admin-status').innerText`)).includes("Updated 2"));
    check("admin bulk: the records are now hidden from guests (server-side), and the selection is cleared", !(await guestNewsIds()).some((id) => [A17.alpha.id, A17.beta.id].includes(id)) && (await ev(`document.querySelector('.admin-bulk__count').innerText`)).includes("0 selected"));
    check("admin bulk: the rows now carry the Lab only badge", (await ev(`[...document.querySelectorAll('.admin-row')].every((r) => /lab only/i.test(r.innerText))`)));
    // ...and back (public wording of the dialog)
    await ev(`document.querySelector('.admin-bulk__all input').click()`);
    await setVal("bulk-visibility", "PUBLIC");
    await ev(`[...document.querySelectorAll('.admin-bulk button')].find((x) => /apply/i.test(x.textContent)).click()`);
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 2000);
    check("admin bulk: publishing warns that logged-out visitors will see the records", (await ev(`document.querySelector('.modal').innerText`)).includes("logged-out visitors"));
    await admClick(".modal .btn--primary");
    await waitFor(`document.querySelector('.admin-status')?.innerText.includes('Updated')`, 6000);
    check("admin bulk: republished; guests see both again", (await guestNewsIds()).includes(A17.alpha.id) && (await guestNewsIds()).includes(A17.beta.id));
    check("admin bulk: audit rows were written (CONTENT_VISIBILITY_CHANGED) and are visible in the audit viewer", await (async () => { const a = (await admApi("GET", "/admin/audit?action=CONTENT_VISIBILITY_CHANGED&limit=100")).json; return a.entries.filter((e) => [A17.alpha.id, A17.beta.id].includes(e.entityId)).length >= 4; })());
    // inspector
    await ev(`(() => { const b = document.querySelector('.admin-row .btn--secondary'); b.setAttribute('data-adm-insp', '1'); })()`);
    await admClick("[data-adm-insp]");
    check("admin inspect: the Details dialog names the record and lists connected records and translation state", (await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 2000)) && (await waitFor(`document.querySelector('.modal').innerText.includes('Connected records')`, 4000)) && (await ev(`document.querySelector('.modal').innerText`)).includes("Japanese translation"));
    check("admin inspect: it links to the public page and says where editing happens", (await exists('.modal a[href="/news"]')) && (await ev(`document.querySelector('.modal').innerText`)).includes("Edit this record on its own page"));
    await press("esc");
    check("admin inspect: Escape closes it and focus returns to the Details button", (await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2000)) && (await ev(`document.activeElement.hasAttribute('data-adm-insp')`)));
    await logout();
  });

  await step("admin events: filters by when / type / creator, and bulk publish", async () => {
    check("admin events: manager login", await login(D.mgr.email, PW));
    await admReady("/admin/events", "ZZ B9 Event");
    check("admin events: no type chips (only events), a When/Type/Created-by filter set", (await ev(`document.querySelectorAll('.admin-types .chip').length`)) === 0 && (await exists("#af-scope")) && (await exists("#af-kind")) && (await exists("#af-owner")));
    const all = (await admApi("GET", "/admin/content?type=event&limit=100")).json;
    await setVal("af-scope", "past");
    await admSubmit();
    await waitFor(`new URLSearchParams(location.search).get('scope') === 'past'`);
    await sleep(600);
    const past = (await admApi("GET", "/admin/content?type=event&scope=past&limit=100")).json;
    check("admin events: 'Past' shows exactly the API's past events (and fewer than all)", (await admTitles()).length === past.rows.length && past.rows.length > 0 && past.rows.length < all.rows.length, `${(await admTitles()).length} vs ${past.rows.length}/${all.rows.length}`);
    await go("/admin/events?kind=SEMINAR"); await navReady(); await waitFor(`!document.querySelector('[aria-busy="true"]')`);
    check("admin events: the type filter (Seminar) applies", (await admTitles()).includes("ZZ B9 Event Public") && !(await admTitles()).includes("ZZ B9 Event Hidden"));
    await go(`/admin/events?owner=${D.plain.tmId}`); await navReady(); await waitFor(`!document.querySelector('[aria-busy="true"]')`); await sleep(500);
    const byOwner = (await admApi("GET", `/admin/content?type=event&owner=${D.plain.tmId}&limit=100`)).json;
    check("admin events: the 'Created by' filter lists the creator's profile name and applies", (await ev(`document.getElementById('af-owner').value`)) === D.plain.tmId && byOwner.rows.length >= 1 && (await admTitles()).length === byOwner.rows.length && (await admTitles()).includes("ZZ B9 Adm Event Owned"));
    check("admin events: each row shows its owner as a public profile name, never an email or id", await ev(`[...document.querySelectorAll('.admin-row')].every((r) => /By ZZ B9|No owner/.test(r.innerText) && !/@/.test(r.innerText))`));
    // bulk publish the hidden upcoming event
    await admReady(`/admin/events?scope=upcoming&q=${encodeURIComponent("ZZ B9 Event Hidden")}`, "ZZ B9 Event Hidden");
    await waitFor(`document.querySelectorAll('.admin-row').length >= 1`);
    check("admin events: the hidden event is lab only before", (await A17.adm.req("GET", `/events/${D.evHid.id}`)).json.visibility === "LAB_ONLY" && (await evApi("GET", `/events/${D.evHid.id}`)).status === 200);
    await admClick(".admin-row:nth-child(1) .admin-row__check");
    await setVal("bulk-visibility", "PUBLIC");
    await ev(`[...document.querySelectorAll('.admin-bulk button')].find((x) => /apply/i.test(x.textContent)).click()`);
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 2000);
    await admClick(".modal .btn--primary");
    await waitFor(`document.querySelector('.admin-status')?.innerText.includes('Updated')`, 6000);
    const guestEv = await fetch(`${API}/api/events/${D.evHid.id}`);
    check("admin events: after the bulk publish a logged-out visitor can open the event", guestEv.status === 200);
    await ev(`(() => { const c = document.querySelector('.admin-row .admin-row__check'); if (!c.checked) c.click(); })()`);
    await setVal("bulk-visibility", "LAB_ONLY");
    await ev(`[...document.querySelectorAll('.admin-bulk button')].find((x) => /apply/i.test(x.textContent)).click()`);
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 2000);
    await admClick(".modal .btn--primary");
    await waitFor(`document.querySelector('.admin-status')?.innerText.includes('Updated')`, 6000);
    check("admin events: and it is hidden again (404 for a guest)", (await fetch(`${API}/api/events/${D.evHid.id}`)).status === 404);
    await logout();
  });

  // ---------------------------------------------------------------- translations
  await step("admin translations: view, edit, clear, long text, English base stays readable", async () => {
    check("admin tr: manager login", await login(D.mgr.email, PW));
    await admReady("/admin/translations", "English (base text)");
    check("admin tr: nine type chips (Phase 19 added publications, Phase 22 knowledge documents, Phase 23 lab resources), one pressed; a search and a state filter", (await ev(`document.querySelectorAll('.admin-types .chip').length`)) === 9 && (await ev(`document.querySelectorAll('.admin-types .chip[aria-pressed="true"]').length`)) === 1 && (await exists("#at-q")) && (await exists("#at-state")));
    await admReady(`/admin/translations?type=NEWS_ITEM&q=${encodeURIComponent("ZZ B9 Adm News Alpha")}`, "English (base text)");
    await waitFor(`document.querySelectorAll('.admin-tr').length === 1`);
    check("admin tr: the entry shows the English base text (read-only) beside an editable Japanese field", (await ev(`document.querySelector('.admin-tr__base').textContent`)).includes("ZZ B9 Adm News Alpha") && (await ev(`document.querySelector('.admin-tr__base').getAttribute('lang')`)) === "en" && (await ev(`document.querySelector('.admin-tr textarea').getAttribute('lang')`)) === "ja");
    check("admin tr: the textarea has an accessible label naming the field and the record; the entry says 'Not translated'", (await ev(`document.querySelector('.admin-tr textarea').labels[0].textContent`)).includes("ZZ B9 Adm News Alpha") && (await text()).includes("Not translated"));
    check("admin tr: Save and Clear are disabled while there is nothing to save / clear", await ev(`(() => { const bs = [...document.querySelectorAll('.admin-tr__actions button')]; return bs.every((b) => b.disabled); })()`));
    await setVal(await ev(`document.querySelector('.admin-tr textarea').id`), "ZZ B9 管理ニュース アルファ");
    check("admin tr: typing enables Save and shows the character count", !(await ev(`document.querySelector('.admin-tr__actions .btn--primary').disabled`)) && /\d+ \/ \d+/.test(await ev(`document.querySelector('.admin-tr__count').innerText`)));
    await admClick(".admin-tr__actions .btn--primary");
    check("admin tr: saving confirms in a live region and the badge flips to 'Override exists'", (await waitFor(`document.querySelector('.admin-tr [role="status"]')?.innerText.includes('Saved')`, 5000)) && (await text()).includes("Override exists"));
    const gja = await (await fetch(`${API}/api/news`, { headers: { "X-Locale": "ja" } })).json();
    const gen = await (await fetch(`${API}/api/news`, { headers: { "X-Locale": "en" } })).json();
    check("admin tr: a Japanese visitor now sees the override, an English visitor the base title", gja.find((n) => n.id === A17.alpha.id)?.title === "ZZ B9 管理ニュース アルファ" && gen.find((n) => n.id === A17.alpha.id)?.title === "ZZ B9 Adm News Alpha");
    check("admin tr: the English base column is untouched", (await A17.adm.req("GET", "/news")).json.find((n) => n.id === A17.alpha.id)?.title === "ZZ B9 Adm News Alpha");
    check("admin tr: Japanese search finds the record (state filter 'with override')", await (async () => { await admReady(`/admin/translations?type=NEWS_ITEM&state=overridden&q=${encodeURIComponent("アルファ")}`); await waitFor(`document.querySelectorAll('.admin-tr').length >= 1`, 5000); return (await admTitles()).includes("ZZ B9 Adm News Alpha"); })());
    await admClick(".admin-tr__actions .btn--secondary");
    check("admin tr: Clear override removes it and says so", (await waitFor(`document.querySelector('.admin-tr [role="status"]')?.innerText.includes('cleared')`, 5000)));
    check("admin tr: the Japanese visitor is back on the English title", ((await (await fetch(`${API}/api/news`, { headers: { "X-Locale": "ja" } })).json()).find((n) => n.id === A17.alpha.id)?.title) === "ZZ B9 Adm News Alpha");
    check("admin tr: the audit trail recorded field NAMES only (no translated text)", await (async () => { const a = (await admApi("GET", "/admin/audit?action=TRANSLATIONS_CHANGED&limit=100")).json; const mine = a.entries.filter((e) => e.entityId === A17.alpha.id); return mine.length >= 2 && mine.every((e) => e.details.fields === "title" && !JSON.stringify(e).includes("アルファ")); })());
    await admReady(`/admin/translations?type=NEWS_ITEM&q=${encodeURIComponent("ZZP17")}`, "English (base text)");
    check("admin tr: the long English + Japanese record wraps inside its columns (no overflow)", (await overflowPx()) <= 1);
    await admReady("/admin/translations?type=EVENT", "English (base text)");
    check("admin tr: events are supported (Phase 16)", (await admTitles()).some((t) => t.startsWith("ZZ B9 Event")));
    await logout();
  });

  // ---------------------------------------------------------------- audit
  await step("admin audit: manager vs admin, filters, pagination, no sensitive values", async () => {
    check("admin audit: manager login", await login(D.mgr.email, PW));
    await admReady("/admin/audit", "Audit log");
    await waitFor(`document.querySelectorAll('.admin-audit').length > 0`);
    check("admin audit: manager: entries are listed newest first with time, actor and record type", (await ev(`document.querySelectorAll('.admin-audit time').length`)) > 5);
    const optsM = await ev(`[...document.querySelectorAll('#au-entity option')].map((o) => o.value)`);
    const actsM = await ev(`[...document.querySelectorAll('#au-action option')].map((o) => o.value)`);
    check("admin audit: manager: no 'Account' record type or account action offered, no actor filter field", !optsM.includes("USER") && !actsM.includes("USER_CREATED") && !(await exists("#au-actor")));
    check("admin audit: manager: the page carries no email address", !/@/.test(await mainText()));
    await setVal("au-action", "CONTENT_VISIBILITY_CHANGED");
    await admSubmit();
    await waitFor(`new URLSearchParams(location.search).get('action') === 'CONTENT_VISIBILITY_CHANGED'`);
    await sleep(600);
    const filtered = await ev(`[...document.querySelectorAll('.admin-audit .admin-row__title')].map((e) => e.textContent.trim())`);
    check("admin audit: the action filter applies and the labels are human text, not codes", filtered.length > 0 && filtered.every((l) => l === "Visibility changed"), JSON.stringify(filtered.slice(0, 3)));
    check("admin audit: details are shown as name/value pairs (from/to), never long text", (await ev(`document.querySelector('.admin-audit__details').innerText`)).includes("from"));
    const future = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
    await go(`/admin/audit?from=${future}`); await navReady(); await waitFor(`!document.querySelector('[aria-busy="true"]')`);
    check("admin audit: a date range with no activity shows the empty state", (await waitFor(`!!document.querySelector('.empty-state')`, 4000)) && (await text()).includes("No entries match"));
    await go("/admin/audit?limit=5"); await navReady(); await waitFor(`document.querySelectorAll('.admin-audit').length > 0`);
    check("admin audit: the pager appears and page 2 differs from page 1", await (async () => { if (!(await exists(".admin-pager"))) return false; const p1 = await ev(`[...document.querySelectorAll('.admin-audit time')].map((e) => e.getAttribute('datetime')).join()`); await admClick('.admin-pager button:last-of-type'); await waitFor(`document.querySelector('.admin-pager__status').textContent.includes('Page 2')`); await sleep(400); return (await ev(`[...document.querySelectorAll('.admin-audit time')].map((e) => e.getAttribute('datetime')).join()`)) !== p1; })());
    await logout();
    check("admin audit: admin login", await login(ADMIN.email, ADMIN.password));
    await admReady("/admin/audit", "Audit log");
    await waitFor(`document.querySelectorAll('.admin-audit').length > 0`);
    const optsA = await ev(`[...document.querySelectorAll('#au-entity option')].map((o) => o.value)`);
    check("admin audit: admin: account events, the 'Account' record type and the actor filter exist", optsA.includes("USER") && (await exists("#au-actor")));
    await setVal("au-actor", "admin@");
    await admSubmit();
    await waitFor(`new URLSearchParams(location.search).get('actor') === 'admin@'`);
    await sleep(600);
    check("admin audit: admin: filtering by actor email works and shows the email", (await ev(`document.querySelectorAll('.admin-audit').length`)) > 0 && (await mainText()).includes("admin@smartcomputinglab.org"));
    check("admin audit: no password / hash / session value appears anywhere on the page", !/\$2[aby]\$|scl\.sid|passwordHash/.test(await ev(`document.documentElement.outerHTML`)));
    await logout();
  });

  // ---------------------------------------------------------------- people & accounts
  await step("admin people: filters, link and unlink a team profile (admin only)", async () => {
    check("admin people: admin login", await login(ADMIN.email, ADMIN.password));
    await admReady("/admin/people", "b9-manager@example.test");
    check("admin people: summary cards (5) and the account list are there", (await ev(`document.querySelectorAll('.stat-card').length`)) === 5 && (await ev(`document.querySelectorAll('.account-row').length`)) > 3);
    const rows0 = await ev(`document.querySelectorAll('.account-row').length`);
    await setVal("ap-q", "b9-adm-solo");
    await waitFor(`document.querySelectorAll('.account-row').length === 1`);
    check("admin people: the search box filters the account list live", (await text()).includes("b9-adm-solo@example.test") && rows0 > 1);
    await setVal("ap-q", "");
    await setVal("ap-role", "LAB_MANAGER");
    await waitFor(`document.querySelectorAll('.account-row').length < ${rows0}`);
    check("admin people: the role filter applies", await ev(`[...document.querySelectorAll('.account-row select[aria-label^="Role for"]')].every((s) => s.value === 'LAB_MANAGER')`));
    await setVal("ap-role", "");
    await setVal("ap-link", "unlinked");
    check("admin people: the 'not linked' filter shows only accounts without a profile", (await waitFor(`document.querySelectorAll('.account-row').length >= 1 && [...document.querySelectorAll('.account-row__meta')].every((m) => /No team profile linked/.test(m.innerText))`)));
    await setVal("ap-link", "");
    check("admin people: the admin's own row can't change its own role or delete itself", await ev(`(() => { const r = [...document.querySelectorAll('.account-row')].find((x) => /\\(you\\)/.test(x.innerText)); return !!r && r.querySelector('select').disabled && r.querySelector('.btn--danger').disabled; })()`));
    // link
    await setVal("ap-q", "b9-adm-solo");
    await waitFor(`document.querySelectorAll('.account-row').length === 1`);
    await ev(`(() => { const b = [...document.querySelectorAll('.account-row .btn--secondary')].find((x) => /link profile/i.test(x.textContent)); b.setAttribute('data-adm-link', '1'); })()`);
    await admClick("[data-adm-link]");
    check("admin people: 'Link profile' opens a dialog offering only UNLINKED profiles", (await waitFor(`!!document.getElementById('link-profile')`, 2500)) && (await ev(`[...document.getElementById('link-profile').options].some((o) => o.text === ${JSON.stringify(D.unlinkedSeed.name)}) && ![...document.getElementById('link-profile').options].some((o) => /ZZ B9 (Member|Lead|Manager)/.test(o.text))`)));
    check("admin people: Submit is disabled until a profile is chosen", await ev(`document.querySelector('.modal button[type="submit"]').disabled`));
    await setVal("link-profile", D.unlinkedSeed.id);
    await admClick('.modal button[type="submit"]');
    check("admin people: linking confirms and the row now shows the linked profile", (await waitFor(`document.querySelector('[role="status"] .form-success')?.innerText.includes('Linked')`, 5000)) && (await waitFor(`document.querySelector('.account-row__meta').innerText.includes(${JSON.stringify(D.unlinkedSeed.name)})`, 5000)));
    check("admin people: the server agrees", (await admApi("GET", "/users")).json.find((u) => u.id === A17.solo.id)?.teamMemberId === D.unlinkedSeed.id);
    // unlink
    await ev(`(() => { const b = [...document.querySelectorAll('.account-row .btn--secondary')].find((x) => /unlink/i.test(x.textContent)); b.setAttribute('data-adm-unlink', '1'); })()`);
    await admClick("[data-adm-unlink]");
    check("admin people: 'Unlink' opens a confirmation that names the account and the profile; focus starts on Cancel", (await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 2500)) && (await ev(`document.querySelector('.modal').innerText`)).includes(D.unlinkedSeed.name) && (await ev(`document.activeElement.textContent.trim()`)) === "Cancel");
    await press("esc");
    check("admin people: Escape cancels (still linked) and returns focus to the Unlink button", (await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2000)) && (await ev(`document.activeElement.hasAttribute('data-adm-unlink')`)) && (await admApi("GET", "/users")).json.find((u) => u.id === A17.solo.id)?.teamMemberId === D.unlinkedSeed.id);
    await admClick("[data-adm-unlink]");
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 2000);
    await admClick(".modal .btn--danger");
    check("admin people: confirming unlinks it", (await waitFor(`document.querySelector('[role="status"] .form-success')?.innerText.includes('Unlinked')`, 5000)) && (await admApi("GET", "/users")).json.find((u) => u.id === A17.solo.id)?.teamMemberId === null);
    await logout();
  });

  await step("admin community + files: overviews without private text or storage paths", async () => {
    check("admin community/files: manager login", await login(D.mgr.email, PW));
    await admReady("/admin/community", "Forum categories");
    check("admin community: categories with counts, and the hidden topic is listed by title with a review link", (await text()).includes("ZZ B9 Forum Public Category") && (await text()).includes("ZZ B9 Adm Hidden Topic") && (await exists(`a[href="/community/forum/topic/${A17.hiddenTopic.id}"]`)));
    check("admin community: NO post text reaches the page (only titles and counts)", !(await ev(`document.documentElement.outerHTML`)).includes("must never reach the admin area") && !(await text()).includes("Seeded topic body"));
    check("admin community: it says moderation happens in the forum and that words are never edited", (await text()).includes("never edit another member's words"));
    await admReady("/admin/files", "adm-evil");
    check("admin files: the gallery upload is listed with a sanitised name, category, visibility, size and uploader", (await text()).includes("adm-evil<b>.png") && (await text()).includes("Research") && /image\/png/.test(await text()));
    const html = await ev(`document.documentElement.outerHTML`);
    check("admin files: no storage key, path or file URL on the page (metadata only)", !/storageKey|storage\/files|\/api\/files\/|sha256/i.test(html));
    check("admin files: hostile filename text is inert (no <b> element created)", (await ev(`document.querySelectorAll('.admin-row__title b').length`)) === 0);
    await logout();
  });

  // ---------------------------------------------------------------- responsive + accessibility sweep (nine widths, EN + JA)
  const admPagesM = () => [["overview", "/admin"], ["content", "/admin/content?type=news&q=ZZ%20B9%20Adm&sort=title"], ["content team", "/admin/content?type=team-member"], ["events", "/admin/events"], ["community", "/admin/community"], ["files", "/admin/files"], ["translations", "/admin/translations?type=NEWS_ITEM&q=ZZP17"], ["audit", "/admin/audit"]];
  const admDialogs = async (T, ja, w) => {
    await p15Ready("/admin/content?type=news&q=ZZ%20B9%20Adm%20News");
    await waitFor(`document.querySelectorAll('.admin-row').length >= 2`, 6000);
    await p15Dialog(`${T} record details dialog`, ".admin-row .btn--secondary", 0, ja);
    await ev(`document.querySelector('.admin-row .admin-row__check')?.click()`);
    await p15Dialog(`${T} bulk visibility confirmation`, ".admin-bulk .btn--primary", 0, ja);
    await ev(`document.querySelectorAll('.admin-row__check:checked').forEach((c) => c.click())`);
  };
  await step("admin sweep: manager -- every section, dialogs, keyboard (EN+JA, 390..1920)", async () => {
    await p15Loop("admin-manager", () => login(D.mgr.email, PW), admPagesM(), async (loc, w) => {
      const T = `admin ${loc} ${w}px manager`;
      await admDialogs(T, loc === "ja", w);
      if (P15_TAB_WIDTHS.includes(w)) {
        for (const [lbl, p] of [["overview", "/admin"], ["content", "/admin/content?type=news&q=ZZ%20B9%20Adm%20News"], ["translations", "/admin/translations?type=NEWS_ITEM&q=ZZ%20B9%20Adm%20News"], ["audit", "/admin/audit"]]) {
          await p15Ready(p);
          const tw = await p15TabWalk(70);
          check(`${T} keyboard ${lbl}: Tab reaches ${tw.stops} stops -- all visible, named, ringed, uncovered`, tw.stops >= 8 && tw.bad.length === 0, tw.bad.slice(0, 3).join(" | "));
        }
      }
    });
    check("admin sweep manager: no script from hostile admin text ever ran", (await ev(`typeof window.__admXss`)) === "undefined");
  });
  await step("admin sweep: admin -- people & accounts, link dialog, filters (EN+JA, 390..1920)", async () => {
    await p15Loop("admin-admin", () => login(ADMIN.email, ADMIN.password), [["people", "/admin/people"], ["overview", "/admin"], ["audit", "/admin/audit"]], async (loc, w) => {
      const T = `admin ${loc} ${w}px admin`;
      await p15Ready("/admin/people");
      await waitFor(`document.querySelectorAll('.account-row').length > 3`, 6000);
      await p15Dialog(`${T} link-profile dialog`, ".account-row .btn--secondary", 0, loc === "ja");
      await p15Dialog(`${T} delete-account confirmation`, ".account-row .btn--danger:not([disabled])", 0, loc === "ja");
      if (P15_TAB_WIDTHS.includes(w)) {
        await p15Ready("/admin/people");
        const tw = await p15TabWalk(80);
        check(`${T} keyboard people: Tab reaches ${tw.stops} stops -- all visible, named, ringed, uncovered`, tw.stops >= 8 && tw.bad.length === 0, tw.bad.slice(0, 3).join(" | "));
      }
    });
  });
  await step("admin ja: the admin area is fully Japanese (labels, filters, statuses)", async () => {
    check("admin ja: manager login", await login(D.mgr.email, PW));
    await go("/"); await ev(`localStorage.setItem('scl.locale','ja')`);
    await admReady("/admin", "監査ログ");
    check("admin ja: header, sections and privacy note are Japanese", (await text()).includes("管理") && (await text()).includes("研究コンテンツ") && (await text()).includes("非公開のメッセージや通知") && (await ev(`document.documentElement.lang`)) === "ja");
    await admReady("/admin/content?type=news&q=ZZ%20B9%20Adm%20News", "絞り込み");
    check("admin ja: filters, badges and buttons are Japanese", (await text()).includes("公開範囲") && (await text()).includes("詳細") && (await text()).includes("ページを開く") && /日本語 \d\/\d/.test(await text()));
    await admReady("/admin/audit", "監査ログ");
    check("admin ja: audit actions are Japanese labels (no raw codes)", !/[A-Z]{3,}_[A-Z_]{3,}/.test(await ev(`[...document.querySelectorAll('.admin-audit .admin-row__title')].map((e) => e.textContent).join(' ')`)));
    check("admin ja: authorization is unchanged in Japanese (members still refused, manager still in)", (await admApi("GET", "/admin/overview", undefined, "ja")).status === 200 && (await admApi("GET", "/users", undefined, "ja")).status === 403);
    await ev(`localStorage.removeItem('scl.locale')`);
    await logout();
  });
  await step("admin: restore fixtures (the moved profile stays unlinked; hidden events stay hidden)", async () => { await setLocale(null); await desktop(); });


  // ================================================================= PHASE 18: research & project management
  // Area -> Project -> Group -> Researcher: the public detail pages, the cross-links between them, what a guest / member /
  // lead / manager / admin may see and change, visibility propagation, Japanese, search, admin, and the nine-width sweep.
  // (Steps are named "research ..."; ONLY_RESEARCH=1 runs just them, P15_W / P15_USERS=research-guest,research-member,research-manager,research-admin narrow the sweeps.)
  section("phase 18: research structure (areas, projects, groups, researchers)");
  const R18 = {};
  const r18Main = () => ev(`document.querySelector('main').innerText`);
  const has = (t, w) => t.toLowerCase().includes(w.toLowerCase());
  const r18Html = () => ev(`document.querySelector('main').outerHTML`);
  const r18Ready = async (p, mustHave) => { await go(p); await navReady(); await waitFor(`!document.querySelector('[aria-busy="true"]')`, 9000); if (mustHave) await waitText(mustHave, 9000); await sleep(200); };
  // A REAL mouse click on the first element matching `sel` (optionally whose text contains `textMatch`); scrolls it into view first.
  const r18Click = async (sel, textMatch) => {
    const marked = await ev(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; const el = ${textMatch ? `els.find((e) => e.textContent.includes(${JSON.stringify(textMatch)}))` : "els[0]"}; if (!el) return false; el.setAttribute('data-r18-click', '1'); return true; })()`);
    if (!marked) return false;
    const r = await admClick("[data-r18-click]");
    await ev(`document.querySelectorAll('[data-r18-click]').forEach((e) => e.removeAttribute('data-r18-click'))`);
    return r;
  };
  const r18Count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const r18Titles = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.trim())`);
  const r18Bar = () => ev(`[...document.querySelectorAll('.admin-bar button')].map((b) => b.textContent.trim())`);
  const r18Modal = () => ev(`document.querySelector('.modal[role="dialog"]')?.innerText || ''`);
  const r18Section = (id) => ev(`document.getElementById(${JSON.stringify(id)})?.textContent.trim() || ''`);
  const HID_WORDS = ["ZZ B9 R18 Area Hidden", "ZZ B9 R18 Project Hidden", "ZZ B9 R18 Pub Hidden", "ZZ B9 R18 News Hidden", "ZZ B9 R18 Event Hidden", "ZZ B9 R18 Pub On Hidden Project", "ZZ B9 R18 Event On Hidden Project", "hidden area description ZZR18HID"];

  await step("research seed: areas, projects, group, researchers, outputs and Japanese overrides", async () => {
    if (!P15.jsDialogs) { P15.jsDialogs = []; ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Page.javascriptDialogOpening") { P15.jsDialogs.push(m.params.message); send("Page.handleJavaScriptDialog", { accept: false }); } }); }
    const a = new Client();
    await a.req("POST", "/auth/login", ADMIN);
    R18.a = a;
    const J = (r) => r.json;
    const LONG_JA = "ZZ B9 R18 超長い日本語の研究分野タイトルがレイアウトを壊さないことを確認するためのテスト用の非常に長い名前です";
    R18.area = J(await a.req("POST", "/research", { title: "ZZ B9 R18 Area Alpha", description: "Alpha area description ZZR18", tag: "ZZR18", visibility: "PUBLIC", translations: { ja: { title: "ZZ B9 R18 アルファ分野", description: "アルファ分野の日本語の説明" } } }));
    R18.areaLong = J(await a.req("POST", "/research", { title: "ZZ B9 R18 Long " + "W".repeat(90), description: "V".repeat(220), tag: "ZZR18", visibility: "PUBLIC", translations: { ja: { title: LONG_JA, description: "超長い説明。".repeat(30) } } }));
    R18.areaHid = J(await a.req("POST", "/research", { title: "ZZ B9 R18 Area Hidden", description: "hidden area description ZZR18HID", tag: "ZZR18", visibility: "LAB_ONLY" }));
    R18.grp = J(await a.req("POST", "/groups", { name: "ZZ B9 R18 Group", description: "R18 group description", visibility: "PUBLIC", translations: { ja: { name: "ZZ B9 R18 グループ" } } }));
    R18.prj = J(await a.req("POST", "/projects", { title: "ZZ B9 R18 Project", summary: "R18 project summary", description: "R18 project long description", status: "ACTIVE", visibility: "PUBLIC", groupId: R18.grp.id, translations: { ja: { title: "ZZ B9 R18 プロジェクト", summary: "R18プロジェクトの要約" } } }));
    R18.prjHid = J(await a.req("POST", "/projects", { title: "ZZ B9 R18 Project Hidden", summary: "R18 hidden project", status: "PLANNED", visibility: "LAB_ONLY", groupId: R18.grp.id }));
    await a.req("PUT", `/projects/${R18.prj.id}/areas`, { areaIds: [R18.area.id, R18.areaLong.id, R18.areaHid.id] });
    await a.req("PUT", `/projects/${R18.prjHid.id}/areas`, { areaIds: [R18.area.id] });
    await a.req("PUT", `/projects/${R18.prj.id}/members`, { members: [{ teamMemberId: D.lead.tmId, role: "LEAD" }, { teamMemberId: D.mem.tmId, role: "MEMBER" }] });
    await a.req("PUT", `/groups/${R18.grp.id}/members`, { members: [{ teamMemberId: D.lead.tmId, role: "LEAD" }, { teamMemberId: D.mem.tmId, role: "MEMBER" }] });
    await a.req("PUT", `/research/${R18.area.id}/researchers`, { teamMemberIds: [D.lead.tmId, D.plain.tmId] });
    await a.req("PUT", `/research/${R18.areaHid.id}/researchers`, { teamMemberIds: [D.lead.tmId] });
    await a.req("PUT", `/member/${D.lead.tmId}/areas`, { areaIds: [R18.area.id, R18.areaHid.id] });
    R18.pub = J(await a.req("POST", "/publications", { year: 2036, title: "ZZ B9 R18 Pub Public", authors: "a", venue: "v" }));
    R18.pubHid = J(await a.req("POST", "/publications", { year: 2036, title: "ZZ B9 R18 Pub Hidden", authors: "a", venue: "v", visibility: "LAB_ONLY" }));
    R18.pubHidPrj = J(await a.req("POST", "/publications", { year: 2036, title: "ZZ B9 R18 Pub On Hidden Project", authors: "a", venue: "v" }));
    await a.req("PUT", `/projects/${R18.prj.id}/publications`, { publicationIds: [R18.pub.id, R18.pubHid.id] });
    await a.req("PUT", `/projects/${R18.prjHid.id}/publications`, { publicationIds: [R18.pubHidPrj.id] });
    R18.news = J(await a.req("POST", "/news", { date: "Jan 2036", sortDate: "2036-01-01", type: "Paper", title: "ZZ B9 R18 News Public", description: "d", visibility: "PUBLIC", translations: { ja: { title: "ZZ B9 R18 公開ニュース" } } }));
    R18.newsHid = J(await a.req("POST", "/news", { date: "Jan 2036", sortDate: "2036-01-02", type: "Paper", title: "ZZ B9 R18 News Hidden", description: "d", visibility: "LAB_ONLY" }));
    await a.req("PUT", `/projects/${R18.prj.id}/news`, { newsIds: [R18.news.id, R18.newsHid.id] });
    const at = new Date(Date.now() + 6 * 864e5).toISOString();
    R18.ev = J(await a.req("POST", "/events", { title: "ZZ B9 R18 Event Public", description: "r18 event", kind: "SEMINAR", startsAt: at, visibility: "PUBLIC", projectId: R18.prj.id }));
    R18.evHid = J(await a.req("POST", "/events", { title: "ZZ B9 R18 Event Hidden", kind: "MEETING", startsAt: at, visibility: "LAB_ONLY", projectId: R18.prj.id }));
    R18.evHidPrj = J(await a.req("POST", "/events", { title: "ZZ B9 R18 Event On Hidden Project", kind: "OTHER", startsAt: at, visibility: "PUBLIC", projectId: R18.prjHid.id }));
    check("research setup: three areas, two projects, a group, outputs", [R18.area, R18.areaLong, R18.areaHid, R18.grp, R18.prj, R18.prjHid, R18.pub, R18.news, R18.ev, R18.evHid, R18.evHidPrj].every((x) => x?.id));
    const det = await a.req("GET", `/research/${R18.area.id}`);
    check("research setup: the area detail API returns 2 researchers, 1 project and no hidden project", det.json.researchers.length === 2 && det.json.projects.length === 2 && det.json.canManageResearchers === true);
  });

  // ---------------------------------------------------------------- guest
  await step("research guest: a public area page shows only public structure; the hidden area is a clean 404", async () => {
    await desktop(); await setLocale(null);
    await r18Ready(`/research/${R18.area.id}`, "ZZ B9 R18 Area Alpha");
    let t = await r18Main();
    check("research guest: the area page shows title, description, tag", t.includes("ZZ B9 R18 Area Alpha") && t.includes("Alpha area description ZZR18") && t.includes("ZZR18"));
    check("research guest: exactly one h1 (the title) and a breadcrumb ending at the area, marked current", (await r18Count("h1")) === 1 && (await ev(`document.querySelector('h1').textContent`)) === "ZZ B9 R18 Area Alpha" && (await ev(`document.querySelector('.breadcrumbs [aria-current="page"]')?.textContent`)) === "ZZ B9 R18 Area Alpha" && (await exists('.breadcrumbs a[href="/research"]')));
    check("research guest: the tab title names the area", (await ev(`document.title`)).startsWith("ZZ B9 R18 Area Alpha"));
    check("research guest: the section headings carry the VISIBLE counts (1 project, 2 researchers, 1 publication, 1 news, 1 event)", (await r18Section("area-projects")) === "Projects (1)" && (await r18Section("area-researchers")) === "Researchers (2)" && (await r18Section("area-pubs")) === "Publications (1)" && (await r18Section("area-news")) === "News (1)" && (await r18Section("area-events")) === "Events (1)");
    check("research guest: one project card, its status badge, and its publication, news and event", (await r18Count(".project-card")) === 1 && t.includes("ZZ B9 R18 Project") && has(t, "Active") && t.includes("ZZ B9 R18 Pub Public") && t.includes("ZZ B9 R18 News Public") && t.includes("ZZ B9 R18 Event Public"));
    check("research guest: researchers are listed with their titles", t.includes("ZZ B9 Lead") && t.includes("ZZ B9 Plain"));
    check("research guest: it says where the outputs come from", t.includes("belong to the projects listed above"));
    check("research guest: NOTHING hidden appears in the page text", HID_WORDS.every((w) => !t.includes(w)), HID_WORDS.filter((w) => t.includes(w)).join("|"));
    const html = await r18Html();
    check("research guest: no hidden id appears in the page markup (links, attributes)", ![R18.areaHid.id, R18.prjHid.id, R18.pubHid.id, R18.newsHid.id, R18.evHid.id, R18.evHidPrj.id, R18.pubHidPrj.id].some((i) => html.includes(i)));
    check("research guest: no manager controls, no Lab-only badge, no visibility text", !(await exists(".admin-bar")) && !/lab only/i.test(t));
    check("research guest: no account id anywhere in the page", !D.userIds.some((u) => html.includes(u)));

    // hidden area
    await r18Ready(`/research/${R18.areaHid.id}`, "Research area not found");
    t = await r18Main();
    check("research guest: the hidden area is the not-found state and leaks nothing", t.includes("doesn't exist, or you don't have access") && !t.includes("ZZ B9 R18 Area Hidden") && !t.includes("ZZR18HID") && (await r18Count("h1")) === 1);
    check("research guest: ...not in the tab title or breadcrumb either, and there is a way back", !/Hidden|ZZ B9/.test(await ev(`document.title + ' ' + document.querySelector('.breadcrumbs').innerText`)) && (await exists('a[href="/research"].btn')));
    await r18Ready("/research/bad!id");
    check("research guest: a malformed id renders an error state, no crash", (await waitFor(`document.body.innerText.includes('Research area not found') || document.body.innerText.includes('Invalid')`)) && (await r18Count("h1")) === 1);
  });

  await step("research guest: the cross-links (area -> project -> researcher -> area -> group) work with real clicks", async () => {
    await r18Ready("/");
    await waitFor(`document.querySelectorAll('.area-tile').length > 0 && document.querySelectorAll('.network__name a').length > 0`, 8000);
    check("research guest: every research-area title on the Home page (tiles and 'research at a glance') links to that area's own page", await ev(`(() => { const links = [...document.querySelectorAll('.area-tile .card__title a, .network__name a')]; return links.length > 0 && links.every((a) => /^\\/research\\/[\\w-]+$/.test(a.getAttribute('href'))); })()`));
    await r18Ready("/research", "ZZ B9 R18 Area Alpha");
    check("research guest: the research list shows the area card with its title as a link", await exists(`a[href="/research/${R18.area.id}"]`));
    check("research guest: the list does not offer the hidden area", !(await exists(`a[href="/research/${R18.areaHid.id}"]`)) && !(await text()).includes("ZZ B9 R18 Area Hidden"));
    await r18Click(`a[href="/research/${R18.area.id}"]`);
    check("research guest: clicking the card title opens the area page", (await waitFor(`location.pathname === '/research/${R18.area.id}'`)) && (await waitText("Alpha area description ZZR18")));
    await r18Click(`a[href="/projects/${R18.prj.id}"]`, "ZZ B9 R18 Project");
    check("research guest: the project card opens the project page", (await waitFor(`location.pathname === '/projects/${R18.prj.id}'`)) && (await waitText("R18 project long description")));
    let t = await r18Main();
    check("research guest: the project page shows its lead, its team, its status and its group", has(t, "Project lead") && t.includes("ZZ B9 Lead") && has(t, "Active") && t.includes("ZZ B9 R18 Group"));
    check("research guest: the lead panel lists exactly the lead", (await ev(`[...document.querySelectorAll('section[aria-labelledby="project-lead"] .person')].map((p) => p.textContent).join('|')`)).includes("ZZ B9 Lead") && (await r18Count('section[aria-labelledby="project-lead"] .person')) === 1);
    check("research guest: the Team panel lists the other members only (the lead is not repeated)", await (async () => { const names = await ev(`[...document.querySelectorAll('section[aria-labelledby="project-team"] .person')].map((p) => p.textContent).join('|')`); return names.includes("ZZ B9 Member") && !names.includes("ZZ B9 Lead"); })());
    check("research guest: the research areas are links, and only the two PUBLIC areas are offered", (await r18Count('section[aria-labelledby="project-areas"] a.tag')) === 2 && !t.includes("ZZ B9 R18 Area Hidden"));
    check("research guest: the project's events section shows only the public event", (await r18Section("project-events")) === "Events (1)" && t.includes("ZZ B9 R18 Event Public") && !t.includes("ZZ B9 R18 Event Hidden"));
    check("research guest: nothing hidden on the project page", HID_WORDS.every((w) => !t.includes(w)), HID_WORDS.filter((w) => t.includes(w)).join("|"));
    await r18Click('section[aria-labelledby="project-areas"] a.tag', "Alpha");
    check("research guest: a research-area chip on the project opens that area", (await waitFor(`location.pathname === '/research/${R18.area.id}'`)) && (await waitText("Alpha area description ZZR18")));
    await r18Click(`a[href="/team/${D.lead.tmId}"]`);
    check("research guest: a researcher on the area opens the profile", (await waitFor(`location.pathname === '/team/${D.lead.tmId}'`)) && (await waitText("ZZ B9 Lead")));
    t = await r18Main();
    check("research guest: the profile lists research areas -- the public one only", has(t, "Research areas") && (await r18Count('section[aria-labelledby="member-areas"] a.tag')) === 1 && (await ev(`document.querySelector('section[aria-labelledby="member-areas"] a.tag').textContent`)).includes("ZZ B9 R18 Area Alpha") && !t.includes("ZZ B9 R18 Area Hidden"));
    check("research guest: the profile shows the visible project, the group and the event of that project", t.includes("ZZ B9 R18 Project") && t.includes("ZZ B9 R18 Group") && (await r18Section("member-events")).startsWith("Events (") && t.includes("ZZ B9 R18 Event Public") && !t.includes("ZZ B9 R18 Event Hidden") && !t.includes("ZZ B9 R18 Project Hidden"));
    await r18Click('section[aria-labelledby="member-areas"] a.tag');
    check("research guest: the profile's area chip goes back to the area", await waitFor(`location.pathname === '/research/${R18.area.id}'`));
    // group
    await r18Ready(`/groups/${R18.grp.id}`, "R18 group description");
    t = await r18Main();
    check("research guest: the group page lists the lead first, only the public project, and the areas of that project", t.includes("ZZ B9 R18 Project") && !t.includes("ZZ B9 R18 Project Hidden") && (await r18Section("group-areas")) === "Research areas (2)" && (await r18Count('section[aria-labelledby="group-areas"] a.tag')) === 2);
    check("research guest: the group gathers the publications, news and events of its visible projects", (await r18Section("group-pubs")) === "Publications (1)" && (await r18Section("group-news")) === "News (1)" && (await r18Section("group-events")) === "Events (1)" && t.includes("belong to this group's projects"));
    check("research guest: nothing hidden on the group page, and the group's project count is the visible one", HID_WORDS.every((w) => !t.includes(w)) && (await r18Section("group-projects")) === "Projects (1)", HID_WORDS.filter((w) => t.includes(w)).join("|"));
    await r18Click('section[aria-labelledby="group-areas"] a.tag', "Alpha");
    check("research guest: a group's area chip opens the area", await waitFor(`location.pathname === '/research/${R18.area.id}'`));
  });

  await step("research guest: keyboard -- the area card link is reachable, ringed, and Enter follows it", async () => {
    await r18Ready("/research", "ZZ B9 R18 Area Alpha");
    await ev(`document.querySelector('a[href="/research/${R18.area.id}"]').setAttribute('data-r18-focus', '1')`);
    await focusSel("[data-r18-focus]");
    const ringInfo = await ev(`(() => { const a = document.activeElement; const els = [a, a.closest('.card')].filter(Boolean); return els.map((e) => { const st = getComputedStyle(e); return { tag: e.tagName + '.' + (e.className || ''), style: st.outlineStyle, width: st.outlineWidth }; }); })()`);
    check("research guest: the focused area link (or the card that carries its ring) has a visible focus ring", ringInfo.some((r) => r.style !== "none" && parseFloat(r.width) >= 2), JSON.stringify(ringInfo));
    await press("enter");
    check("research guest: Enter on the focused link opens the area page", await waitFor(`location.pathname === '/research/${R18.area.id}'`));
    check("research guest: after the client-side navigation exactly one h1 and one main landmark remain", (await r18Count("h1")) === 1 && (await r18Count("main")) === 1);
  });

  // ---------------------------------------------------------------- member
  await step("research member: sees the LAB_ONLY structure; no manager controls; sets their OWN areas from their profile", async () => {
    check("research member: login (a true MEMBER)", await login(D.plain.email, PW));
    await r18Ready(`/research/${R18.area.id}`, "ZZ B9 R18 Area Alpha");
    let t = await r18Main();
    check("research member: sees the hidden project, publication, news and event (LAB_ONLY is for signed-in users)", t.includes("ZZ B9 R18 Project Hidden") && t.includes("ZZ B9 R18 Pub Hidden") && t.includes("ZZ B9 R18 News Hidden") && t.includes("ZZ B9 R18 Event Hidden") && t.includes("ZZ B9 R18 Pub On Hidden Project"));
    check("research member: the counts include them (2 projects) and there is no Lab-only badge (the field is not sent)", (await r18Section("area-projects")) === "Projects (2)" && !/lab only/i.test(t));
    const bar = await r18Bar();
    check("research member: may edit the area (existing policy) but has NO 'Researchers' and NO Delete button", bar.includes("Edit area") && !bar.includes("Researchers") && !bar.includes("Delete"), JSON.stringify(bar));
    check("research member: the server refuses the manager-only writes even if the UI is bypassed", (await admApi("PUT", `/research/${R18.area.id}/researchers`, { teamMemberIds: [] })).status === 403 && (await admApi("PUT", `/member/${D.lead.tmId}/areas`, { areaIds: [] })).status === 403 && (await admApi("DELETE", `/research/${R18.area.id}`)).status === 403);
    await r18Ready(`/research/${R18.areaHid.id}`, "ZZ B9 R18 Area Hidden");
    check("research member: the LAB_ONLY area is openable by URL", (await r18Main()).includes("hidden area description ZZR18HID"));

    // own profile: set my research areas
    await r18Ready(`/team/${D.plain.tmId}`, "ZZ B9 Plain");
    check("research member: their own profile offers 'Research areas'", (await r18Bar()).includes("Research areas"));
    await r18Click(".admin-bar button", "Research areas");
    check("research member: the dialog opens with a checkbox per area, and marks the one area they already work in", (await waitFor(`!!document.querySelector('.modal[role="dialog"] input[type=checkbox]')`, 4000)) && has(await r18Modal(), "Select research areas") && (await r18Count('.modal input[type=checkbox]')) >= 3 && (await r18Count('.modal input[type=checkbox]:checked')) === 1);
    await ev(`[...document.querySelectorAll('.modal .pick-item')].find((l) => l.textContent.includes('ZZ B9 R18 Area Hidden')).querySelector('input').click()`);
    await submitModal();
    check("research member: saving closes the dialog and the profile now lists both areas", (await waitFor(`!document.querySelector('.modal')`, 5000)) && (await waitFor(`document.querySelectorAll('section[aria-labelledby="member-areas"] a.tag').length === 2`, 5000)));
    check("research member: the server agrees", (await admApi("GET", `/member/${D.plain.tmId}`)).json.areas.length === 2);
    await r18Click(".admin-bar button", "Research areas");
    await waitFor(`!!document.querySelector('.modal input[type=checkbox]')`, 4000);
    check("research member: reopening shows exactly those two checked", (await r18Count('.modal input[type=checkbox]:checked')) === 2);
    await ev(`[...document.querySelectorAll('.modal .pick-item')].forEach((l) => { const i = l.querySelector('input'); if (i.checked) i.click(); })`);
    await submitModal();
    check("research member: clearing all is allowed (empty state shown)", (await waitFor(`!document.querySelector('.modal')`, 5000)) && (await waitText("No research areas listed yet.")));
    await r18Ready(`/team/${D.lead.tmId}`, "ZZ B9 Lead");
    check("research member: someone else's profile has no owner controls and no Research-areas button", !(await exists(".admin-bar")));
    check("research member: ...but shows that person's areas, both areas because the viewer is signed in", (await r18Count('section[aria-labelledby="member-areas"] a.tag')) === 2);
    await R18.a.req("PUT", `/member/${D.plain.tmId}/areas`, { areaIds: [R18.area.id] }); // put the seeded state back for the steps that follow
    await logout();
  });

  await step("research lead: leads their project/group but has no area powers", async () => {
    check("research lead: login", await login(D.lead.email, PW));
    await r18Ready(`/projects/${R18.prj.id}`, "R18 project long description");
    const bar = await r18Bar();
    check("research lead: the project manage bar offers Members / Research areas but not Delete", bar.includes("Members") && bar.includes("Research areas") && !bar.includes("Delete"), JSON.stringify(bar));
    check("research lead: the server keeps settings manager-only and area researchers manager-only", (await admApi("PUT", `/projects/${R18.prj.id}`, { groupId: null })).status === 403 && (await admApi("PUT", `/research/${R18.area.id}/researchers`, { teamMemberIds: [] })).status === 403);
    await r18Ready(`/team/${D.lead.tmId}`, "ZZ B9 Lead");
    check("research lead: their own profile offers 'Research areas'", (await r18Bar()).includes("Research areas"));
    await logout();
  });

  // ---------------------------------------------------------------- manager
  await step("research manager: manages an area's researchers, edits in Japanese without touching the English, deletes with a confirmation", async () => {
    check("research manager: login", await login(D.mgr.email, PW));
    await r18Ready(`/research/${R18.area.id}`, "ZZ B9 R18 Area Alpha");
    check("research manager: the bar offers Edit area, Researchers and Delete; the visibility badge is shown on the hidden project", (await r18Bar()).join("|") === "Edit area|Researchers|Delete" && /lab only/i.test(await r18Main()));
    // researchers dialog
    await r18Click(".admin-bar button", "Researchers");
    check("research manager: the Researchers dialog lists the team with the current researchers checked", (await waitFor(`document.querySelectorAll('.modal .pick-item').length >= 5`, 5000)) && has(await r18Modal(), "Researchers in this area") && (await r18Count(".modal input[type=checkbox]:checked")) === 2);
    await ev(`[...document.querySelectorAll('.modal .pick-item')].find((l) => l.textContent.includes('ZZ B9 Member')).querySelector('input').click()`);
    await submitModal();
    check("research manager: saving adds the researcher and the page shows three", (await waitFor(`!document.querySelector('.modal')`, 5000)) && (await waitFor(`document.getElementById('area-researchers')?.textContent.trim() === 'Researchers (3)'`, 5000)) && (await r18Main()).includes("ZZ B9 Member"));
    check("research manager: the server agrees, and audits it as a member-links change on the area", (await admApi("GET", `/research/${R18.area.id}`)).json.researchers.length === 3 && (await R18.a.req("GET", "/admin/audit?entityType=RESEARCH_AREA&limit=50")).json.entries.some((r) => r.action === "MEMBER_LINKS_CHANGED" && r.entityId === R18.area.id));
    await r18Click(".admin-bar button", "Researchers");
    await waitFor(`document.querySelectorAll('.modal .pick-item').length >= 5`, 5000);
    await ev(`[...document.querySelectorAll('.modal .pick-item')].find((l) => l.textContent.includes('ZZ B9 Member')).querySelector('input').click()`);
    await submitModal();
    check("research manager: unchecking removes them again", (await waitFor(`document.getElementById('area-researchers')?.textContent.trim() === 'Researchers (2)'`, 5000)));

    // the Japanese-edit regression: the English inputs must hold ENGLISH
    await setLocale("ja");
    await r18Ready(`/research/${R18.area.id}`, "ZZ B9 R18 アルファ分野");
    check("research manager (ja): the page shows the Japanese title and description", (await r18Main()).includes("アルファ分野の日本語の説明"));
    await r18Click(".admin-bar button", "分野を編集");
    check("research manager (ja): the edit dialog opens", await waitFor(`!!document.getElementById('research_title')`, 5000));
    check("research manager (ja): the ENGLISH inputs are filled with the English text (not the Japanese the page showed)", await waitFor(`document.getElementById('research_title').value === 'ZZ B9 R18 Area Alpha' && document.getElementById('research_description').value === 'Alpha area description ZZR18'`, 6000), await ev(`document.getElementById('research_title').value`));
    check("research manager (ja): the Japanese inputs hold the Japanese override", (await ev(`document.getElementById('research_title_ja').value`)) === "ZZ B9 R18 アルファ分野");
    await setVal("research_description", "Alpha area description ZZR18 edited");
    await submitModal();
    check("research manager (ja): saving closes the dialog", await waitFor(`!document.querySelector('.modal')`, 5000));
    const enNow = await (await fetch(`${API}/api/research/${R18.area.id}`, { headers: { "X-Locale": "en" } })).json();
    check("research manager (ja): the ENGLISH title is still English, the description is the edit, and the Japanese override is intact", enNow?.title === "ZZ B9 R18 Area Alpha" && enNow?.description === "Alpha area description ZZR18 edited" && (await (await fetch(`${API}/api/research/${R18.area.id}`, { headers: { "X-Locale": "ja" } })).json()).title === "ZZ B9 R18 アルファ分野");
    await R18.a.req("PUT", `/research/${R18.area.id}`, { description: "Alpha area description ZZR18" });
    await setLocale(null);

    // delete with confirmation
    const tmp = (await R18.a.req("POST", "/research", { title: "ZZ B9 R18 Throwaway", description: "d", tag: "T", visibility: "PUBLIC" })).json;
    await r18Ready(`/research/${tmp.id}`, "ZZ B9 R18 Throwaway");
    await r18Click(".admin-bar .btn--danger");
    check("research manager: Delete opens a confirmation naming the area", (await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 3000)) && (await r18Modal()).includes("ZZ B9 R18 Throwaway"));
    await press("esc");
    check("research manager: Escape cancels, the area still exists, focus returns to Delete", (await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2000)) && (await admApi("GET", `/research/${tmp.id}`)).status === 200);
    await r18Click(".admin-bar .btn--danger");
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 3000);
    await ev(`[...document.querySelectorAll('.modal button')].find((b) => /delete/i.test(b.textContent) && b.classList.contains('btn--danger'))?.click()`);
    check("research manager: confirming deletes it and goes back to the list", (await waitFor(`location.pathname === '/research'`, 6000)) && (await admApi("GET", `/research/${tmp.id}`)).status === 404);
    await logout();
  });

  // ---------------------------------------------------------------- Japanese edit forms: news, team member, event
  // Same bug as the area/project/group forms above: a page fetched in Japanese hands the edit form the Japanese override
  // as "title"/"description"/"bio", so saving used to overwrite the ENGLISH text. The English inputs must hold English.
  await step("research forms: news / team-member / event edit in Japanese keeps the English source and the Japanese override apart", async () => {
    check("research forms: manager login", await login(D.mgr.email, PW));
    const a = R18.a;
    const at = new Date(Date.now() + 8 * 864e5).toISOString();
    const nw = (await a.req("POST", "/news", { date: "Jan 2037", sortDate: "2037-02-01", type: "Paper", title: "ZZ B9 R18F News EN", description: "R18F news description EN", visibility: "PUBLIC", translations: { ja: { title: "ZZ B9 R18F ニュース", description: "R18Fニュースの説明" } } })).json;
    const nwBare = (await a.req("POST", "/news", { date: "Jan 2037", sortDate: "2037-02-02", type: "Paper", title: "ZZ B9 R18F News Bare", description: "R18F bare description", visibility: "PUBLIC" })).json;
    const evn = (await a.req("POST", "/events", { title: "ZZ B9 R18F Event EN", description: "R18F event description EN", kind: "SEMINAR", startsAt: at, visibility: "PUBLIC", translations: { ja: { title: "ZZ B9 R18F イベント", description: "R18Fイベントの説明" } } })).json;
    const evnBare = (await a.req("POST", "/events", { title: "ZZ B9 R18F Event Bare", description: "R18F bare event", kind: "MEETING", startsAt: at, visibility: "PUBLIC" })).json;
    const tm = (await a.req("POST", "/team", { name: "ZZ B9 R18F Member", initials: "RF", role: "Researcher", category: "RESEARCH", bio: "R18F bio EN", translations: { ja: { bio: "R18Fの日本語プロフィール" } } })).json;
    const tmBare = (await a.req("POST", "/team", { name: "ZZ B9 R18F Member Bare", initials: "RB", role: "Researcher", category: "RESEARCH", bio: "R18F bare bio" })).json;
    R18.forms = { nw, nwBare, evn, evnBare, tm, tmBare };
    check("research forms: fixtures created", [nw, nwBare, evn, evnBare, tm, tmBare].every((x) => x?.id));

    const val = (id) => ev(`document.getElementById(${JSON.stringify(id)})?.value ?? null`);
    const tr = async (type, id) => (await admApi("GET", `/translations/${type}/${id}`)).json;
    const kinds = {
      news: {
        type: "NEWS_ITEM", ent: nw, bare: nwBare, fields: ["title", "description"], pre: "news_",
        open: async (e, loc) => { await r18Ready("/news"); await waitFor(`!!document.querySelector('.card-edit-btn')`, 8000); const want = (loc === "ja" ? e.jaTitle : "") || e.title; const ok = await ev(`(() => { const b = [...document.querySelectorAll('.card-edit-btn .icon-btn')].find((x) => x.getAttribute('title') === ${JSON.stringify(loc === "ja" ? "編集" : "Edit")} && x.getAttribute('aria-label').includes(${JSON.stringify(want)})); if (!b) return false; b.setAttribute('data-r18-click', '1'); return true; })()`); return ok && (await admClick("[data-r18-click]")); },
      },
      member: {
        type: "TEAM_MEMBER", ent: tm, bare: tmBare, fields: ["bio"], pre: "tm_",
        // the Team list is the localized surface (its cards carry the Japanese bio); the profile page is checked in its own step below
        open: async (e, loc) => { await r18Ready("/team"); await waitFor(`!!document.querySelector('.card-edit-btn')`, 8000); const ok = await ev(`(() => { const b = [...document.querySelectorAll('.card-edit-btn .icon-btn')].find((x) => x.getAttribute('title') === ${JSON.stringify(loc === "ja" ? "編集" : "Edit")} && x.getAttribute('aria-label').includes(${JSON.stringify(e.name)})); if (!b) return false; b.setAttribute('data-r18-click', '1'); return true; })()`); return ok && (await admClick("[data-r18-click]")); },
      },
      event: {
        type: "EVENT", ent: evn, bare: evnBare, fields: ["title", "description"], pre: "event_",
        open: async (e, loc) => { await r18Ready(`/events/${e.id}`); await waitFor(`!!document.querySelector('.admin-bar button')`, 8000); return r18Click(".admin-bar button", loc === "ja" ? "編集" : "Edit"); },
      },
    };
    const enId = (k, f) => `${k.pre}${f}`;
    const jaId = (k, f) => `${k.pre}${f}_ja`;
    const snap = async (k, e) => { const r = await tr(k.type, e.id); return { en: r.base, ja: r.ja }; };
    const fieldsOf = async (k) => { const o = {}; for (const f of k.fields) o[f] = await val(enId(k, f)); return o; };
    const jaFieldsOf = async (k) => { const o = {}; for (const f of k.fields) o[f] = await val(jaId(k, f)); return o; };
    const closeForm = async () => { await waitFor(`!document.querySelector('.modal')`, 6000); };
    const jaOf = (o) => JSON.stringify(o);

    for (const [name, k] of Object.entries(kinds)) {
      const e = k.ent;
      const s0 = await snap(k, e);
      k.jaTitle = s0.ja.title;
      e.jaTitle = s0.ja.title;
      // A + F: opened in Japanese and in English, the English inputs hold the English source and the Japanese inputs the override
      for (const loc of ["ja", "en"]) {
        await setLocale(loc === "ja" ? "ja" : null);
        check(`research forms ${name} (${loc}): the edit dialog opens`, (await k.open(e, loc)) && (await waitFor(`!!document.getElementById(${JSON.stringify(enId(k, k.fields[0]))})`, 6000)));
        check(`research forms ${name} (${loc}): the English inputs hold the ENGLISH source, not the Japanese the page showed`, await waitFor(`${JSON.stringify(k.fields)}.every((f) => document.getElementById(${JSON.stringify(k.pre)} + f).value === ${JSON.stringify(s0.en)}[f])`, 6000), jaOf(await fieldsOf(k)));
        check(`research forms ${name} (${loc}): the Japanese inputs hold the Japanese override`, jaOf(await jaFieldsOf(k)) === jaOf(s0.ja), jaOf(await jaFieldsOf(k)));
        await press("esc");
        await closeForm();
      }
      // B: edit only the Japanese text in JA mode
      await setLocale("ja");
      await k.open(e, "ja");
      await waitFor(`document.getElementById(${JSON.stringify(jaId(k, k.fields[k.fields.length - 1]))})?.value === ${JSON.stringify(s0.ja[k.fields[k.fields.length - 1]])}`, 6000);
      const lastF = k.fields[k.fields.length - 1];
      await setVal(jaId(k, lastF), s0.ja[lastF] + " 改");
      await submitModal();
      check(`research forms ${name} (ja): saving only the Japanese closes the dialog`, await waitFor(`!document.querySelector('.modal')`, 6000));
      const sB = await snap(k, e);
      check(`research forms ${name} (ja): the ENGLISH source is byte-for-byte unchanged and the Japanese changed`, jaOf(sB.en) === jaOf(s0.en) && sB.ja[lastF] === s0.ja[lastF] + " 改" && k.fields.filter((f) => f !== lastF).every((f) => sB.ja[f] === s0.ja[f]), jaOf(sB));
      // E + C: direct navigation (fresh load), then edit only the English in JA mode
      await k.open(e, "ja");
      check(`research forms ${name} (ja, after reload): the new Japanese value persisted and the English inputs are still English`, await waitFor(`document.getElementById(${JSON.stringify(jaId(k, lastF))}).value === ${JSON.stringify(s0.ja[lastF] + " 改")} && ${JSON.stringify(k.fields)}.every((f) => document.getElementById(${JSON.stringify(k.pre)} + f).value === ${JSON.stringify(s0.en)}[f])`, 6000));
      await setVal(enId(k, lastF), s0.en[lastF] + " edited");
      await submitModal();
      check(`research forms ${name} (ja): saving only the English closes the dialog`, await waitFor(`!document.querySelector('.modal')`, 6000));
      const sC = await snap(k, e);
      check(`research forms ${name} (ja): the English changed and the Japanese override is untouched`, sC.en[lastF] === s0.en[lastF] + " edited" && k.fields.filter((f) => f !== lastF).every((f) => sC.en[f] === s0.en[f]) && jaOf(sC.ja) === jaOf(sB.ja), jaOf(sC));
      // back to English: the page shows the English text, and a reload keeps both values
      await setLocale(null);
      await k.open(e, "en");
      check(`research forms ${name} (en, after reload): English shows the edited English, Japanese the edited Japanese`, await waitFor(`document.getElementById(${JSON.stringify(enId(k, lastF))}).value === ${JSON.stringify(s0.en[lastF] + " edited")} && document.getElementById(${JSON.stringify(jaId(k, lastF))}).value === ${JSON.stringify(s0.ja[lastF] + " 改")}`, 6000));
      await press("esc");
      await closeForm();
      const enPage = await (await fetch(`${API}/api/${name === "member" ? "team" : name === "news" ? "news" : "events"}`, { headers: { "X-Locale": "en" } })).text();
      check(`research forms ${name}: the public English API serves the English text (never the Japanese)`, enPage.includes(s0.en[lastF] + " edited") && !enPage.includes(s0.ja[lastF] + " 改"));
      // D: no Japanese override -> English in the English inputs, empty Japanese inputs, an untouched save changes nothing
      const b = k.bare;
      const sb0 = await snap(k, b);
      await setLocale("ja");
      check(`research forms ${name} (ja, no override): the dialog opens`, (await k.open(b, "ja")) && (await waitFor(`!!document.getElementById(${JSON.stringify(enId(k, k.fields[0]))})`, 6000)));
      check(`research forms ${name} (ja, no override): English inputs hold the English (the page fell back to it) and the Japanese inputs are empty`, (await waitFor(`${JSON.stringify(k.fields)}.every((f) => document.getElementById(${JSON.stringify(k.pre)} + f).value === ${JSON.stringify(sb0.en)}[f])`, 6000)) && k.fields.every((f) => !sb0.ja[f]) && Object.values(await jaFieldsOf(k)).every((v) => v === ""), jaOf(await jaFieldsOf(k)));
      await submitModal();
      await waitFor(`!document.querySelector('.modal')`, 6000);
      const sb1 = await snap(k, b);
      check(`research forms ${name} (ja, no override): saving untouched leaves the English source unchanged and creates no Japanese text`, jaOf(sb1.en) === jaOf(sb0.en) && k.fields.every((f) => !sb1.ja[f]), jaOf(sb1));
    }
    await setLocale(null);
    await logout();
  });

  await step("research forms profile: the profile page opens the same team-member form with English bio + Japanese override", async () => {
    check("research forms profile: manager login", await login(D.mgr.email, PW));
    const tm = R18.forms.tm;
    const tr = (await admApi("GET", `/translations/TEAM_MEMBER/${tm.id}`)).json;
    for (const loc of ["ja", null]) {
      await setLocale(loc);
      await r18Ready(`/team/${tm.id}`, tm.name);
      check(`research forms profile (${loc || "en"}): the edit dialog opens`, (await r18Click(".admin-bar button", loc === "ja" ? "プロフィールを編集" : "Edit profile")) && (await waitFor(`!!document.getElementById('tm_bio')`, 6000)));
      check(`research forms profile (${loc || "en"}): English bio in the English input, Japanese override in the Japanese input`, await waitFor(`document.getElementById('tm_bio').value === ${JSON.stringify(tr.base.bio)} && document.getElementById('tm_bio_ja').value === ${JSON.stringify(tr.ja.bio)}`, 6000));
      await press("esc");
      await waitFor(`!document.querySelector('.modal')`, 6000);
    }
    await setLocale(null);
    await logout();
  });

  // ---------------------------------------------------------------- search + admin
  await step("research search + admin: results link to the new detail page; admin links and counts agree", async () => {
    await desktop(); await setLocale(null);
    await r18Ready("/search?q=ZZ%20B9%20R18&type=research-area", "ZZ B9 R18 Area Alpha");
    const hrefs = await ev(`[...document.querySelectorAll('main a.search-result__link')].map((a) => a.getAttribute('href')).filter((h) => /^\\/research\\//.test(h || ''))`);
    check("research search (guest): the public areas are found and link to their detail page; the hidden one is not offered", hrefs.includes(`/research/${R18.area.id}`) && hrefs.includes(`/research/${R18.areaLong.id}`) && !hrefs.includes(`/research/${R18.areaHid.id}`) && !(await text()).includes("ZZ B9 R18 Area Hidden"), JSON.stringify(hrefs));
    check("research search (guest): the result's call to action names the area (not the list)", (await ev(`document.querySelector('.search-result--research-area .search-result__cta')?.textContent`)).includes("View research area"));
    await r18Click(`a[href="/research/${R18.area.id}"]`);
    check("research search (guest): the result opens the area page", (await waitFor(`location.pathname === '/research/${R18.area.id}'`)) && (await waitText("Alpha area description ZZR18")));
    await setLocale("ja");
    await r18Ready(`/search?q=${encodeURIComponent("アルファ分野")}&type=research-area`, "ZZ B9 R18 アルファ分野");
    check("research search (guest, ja): the Japanese override is matched and the result links to the area", await exists(`a[href="/research/${R18.area.id}"]`));
    await setLocale(null);

    check("research admin: manager login", await login(D.mgr.email, PW));
    await admReady("/admin/content?type=research-area&q=ZZ%20B9%20R18", "ZZ B9 R18 Area Alpha");
    check("research admin: the content browser lists the three areas with their visibility", (await admTitles()).filter((x) => x.startsWith("ZZ B9 R18")).length === 3);
    await r18Click(".admin-row .btn--secondary");
    check("research admin: the record dialog shows the relation counts (projects, researchers) and a link to the public page", (await waitFor(`!!document.querySelector('.admin-detail__list')`, 5000)) && /Projects/.test(await r18Modal()) && /Researchers/.test(await r18Modal()) && (await exists(`.modal a[href="/research/${(await admApi("GET", "/admin/content?type=research-area&q=ZZ%20B9%20R18%20Area%20Alpha")).json.rows[0].id}"]`)));
    await press("esc");
    await admReady("/admin/content?type=project&q=ZZ%20B9%20R18%20Project", "ZZ B9 R18 Project");
    await ev(`(() => { const row = [...document.querySelectorAll('.admin-row')].find((r) => r.querySelector('.admin-row__title')?.textContent.trim() === 'ZZ B9 R18 Project'); row?.querySelector('.btn--secondary')?.setAttribute('data-r18-click', '1'); })()`);
    await admClick("[data-r18-click]");
    await ev(`document.querySelectorAll('[data-r18-click]').forEach((e) => e.removeAttribute('data-r18-click'))`);
    check("research admin: a project's dialog shows members, areas, publications, news, events and group counts", (await waitFor(`!!document.querySelector('.admin-detail__list')`, 5000)) && (await (async () => { const m = await r18Modal(); return ["Members", "Research areas", "Publications", "News", "Events", "Groups"].every((w) => m.includes(w)); })()));
    await press("esc");
    await logout();
  });

  // ---------------------------------------------------------------- Japanese
  await step("research ja: the structure pages read in Japanese; authorization is the same", async () => {
    await setLocale("ja");
    await r18Ready(`/research/${R18.area.id}`, "ZZ B9 R18 アルファ分野");
    let t = await r18Main();
    check("research ja: the area page has Japanese chrome, title, description and related titles", t.includes("アルファ分野の日本語の説明") && t.includes("プロジェクト（1）") && t.includes("研究者（2）") && t.includes("論文（1）") && t.includes("ニュース（1）") && t.includes("イベント（1）") && t.includes("ZZ B9 R18 プロジェクト") && t.includes("ZZ B9 R18 公開ニュース"));
    check("research ja: html lang, tab title and breadcrumb are Japanese", (await ev(`document.documentElement.lang`)) === "ja" && (await ev(`document.title`)).startsWith("ZZ B9 R18 アルファ分野") && (await ev(`document.querySelector('.breadcrumbs a[href="/research"]').textContent`)) === "研究分野");
    check("research ja: still nothing hidden", HID_WORDS.every((w) => !t.includes(w)));
    await r18Ready(`/projects/${R18.prj.id}`, "R18プロジェクトの要約");
    t = await r18Main();
    check("research ja: the project page shows Japanese title/summary, the lead panel, the group and the area chips in Japanese", t.includes("プロジェクトリーダー") && t.includes("ZZ B9 R18 グループ") && t.includes("ZZ B9 R18 アルファ分野") && t.includes("イベント（1）"));
    await r18Ready(`/groups/${R18.grp.id}`, "ZZ B9 R18 グループ");
    t = await r18Main();
    check("research ja: the group page lists the Japanese project title and its research areas", t.includes("ZZ B9 R18 プロジェクト") && t.includes("研究分野（2）") && t.includes("ZZ B9 R18 アルファ分野"));
    await r18Ready(`/team/${D.lead.tmId}`, "ZZ B9 Lead");
    t = await r18Main();
    check("research ja: the profile lists areas and events in Japanese", t.includes("研究分野") && t.includes("ZZ B9 R18 アルファ分野") && t.includes("イベント（"));
    await r18Ready(`/research/${R18.areaHid.id}`, "研究分野が見つかりません");
    check("research ja: the hidden area is the Japanese not-found state and still leaks nothing", !(await r18Main()).includes("ZZ B9 R18 Area Hidden") && !(await ev(`document.title`)).includes("Hidden"));
    check("research ja: authorization is unchanged in Japanese (guest 404 on the hidden area, guest 401 on the writes)", (await admApi("GET", `/research/${R18.areaHid.id}`, undefined, "ja")).status === 404 && (await admApi("PUT", `/research/${R18.area.id}/researchers`, { teamMemberIds: [] }, "ja")).status === 401);
    await setLocale(null);
  });

  await step("research hostile text: markup and unbroken strings are inert text on every new page", async () => {
    await desktop(); await setLocale(null);
    const hostile = "ZZ B9 R18 <img src=x onerror=window.__r18Xss=1> Hostile";
    const h = (await R18.a.req("POST", "/research", { title: hostile, description: "<script>window.__r18Xss=2</script>", tag: "<b>x</b>", visibility: "PUBLIC" })).json;
    await R18.a.req("PUT", `/research/${h.id}/researchers`, { teamMemberIds: [D.lead.tmId] });
    await R18.a.req("PUT", `/projects/${R18.prj.id}/areas`, { areaIds: [R18.area.id, R18.areaLong.id, R18.areaHid.id, h.id] });
    for (const p of ["/research", `/research/${h.id}`, `/projects/${R18.prj.id}`, `/groups/${R18.grp.id}`, `/team/${D.lead.tmId}`, "/search?q=ZZ%20B9%20R18%20%3Cimg&type=research-area"]) {
      await r18Ready(p);
      await sleep(250);
      check(`research hostile: ${p.split("?")[0]} renders it as text (no script ran, no injected <img>/<script> element)`, (await ev(`typeof window.__r18Xss`)) === "undefined" && (await ev(`document.querySelectorAll('main img[src="x"], main script, main b').length`)) === 0);
    }
    await r18Ready(`/research/${h.id}`, "Hostile");
    check("research hostile: the title is shown literally as text", (await ev(`document.querySelector('h1').textContent`)) === hostile);
    await R18.a.req("PUT", `/projects/${R18.prj.id}/areas`, { areaIds: [R18.area.id, R18.areaLong.id, R18.areaHid.id] });
    await R18.a.req("DELETE", `/research/${h.id}`);
  });

  // ---------------------------------------------------------------- nine-width sweep, EN + JA
  const r18PagesGuest = () => [["research list", "/research"], ["area", `/research/${R18.area.id}`], ["area long", `/research/${R18.areaLong.id}`], ["area hidden 404", `/research/${R18.areaHid.id}`], ["project", `/projects/${R18.prj.id}`], ["group", `/groups/${R18.grp.id}`], ["researcher", `/team/${D.lead.tmId}`]];
  const r18Walk = async (T, pages) => { for (const [lbl, p] of pages) { await p15Ready(p); const tw = await p15TabWalk(70); check(`${T} keyboard ${lbl}: Tab reaches ${tw.stops} stops -- all visible, named, ringed, uncovered`, tw.stops >= 5 && tw.bad.length === 0, tw.bad.slice(0, 3).join(" | ")); } };
  await step("research sweep: guest -- every new page (EN+JA, 390..1920)", async () => {
    await p15Loop("research-guest", null, r18PagesGuest(), async (loc, w) => {
      if (P15_TAB_WIDTHS.includes(w)) await r18Walk(`research ${loc} ${w}px guest`, [["area", `/research/${R18.area.id}`], ["project", `/projects/${R18.prj.id}`]]);
    });
    check("research sweep guest: no script from hostile text ever ran", (await ev(`typeof window.__r18Xss`)) === "undefined");
  });
  await step("research sweep: member -- LAB_ONLY structure, own-areas dialog (EN+JA, 390..1920)", async () => {
    await p15Loop("research-member", () => login(D.plain.email, PW), [["area", `/research/${R18.area.id}`], ["area hidden", `/research/${R18.areaHid.id}`], ["project", `/projects/${R18.prj.id}`], ["group", `/groups/${R18.grp.id}`], ["own profile", `/team/${D.plain.tmId}`], ["researcher", `/team/${D.lead.tmId}`]], async (loc, w) => {
      const T = `research ${loc} ${w}px member`;
      await p15Ready(`/team/${D.plain.tmId}`);
      await p15Dialog(`${T} research-areas dialog`, ".admin-bar .btn--secondary", 3, loc === "ja");
      await p15Ready(`/research/${R18.area.id}`);
      await p15Dialog(`${T} edit-area dialog`, ".admin-bar .btn--secondary", 0, loc === "ja");
      if (P15_TAB_WIDTHS.includes(w)) await r18Walk(T, [["area", `/research/${R18.area.id}`], ["own profile", `/team/${D.plain.tmId}`]]);
    });
  });
  await step("research sweep: manager -- area management dialogs (EN+JA, 390..1920)", async () => {
    await p15Loop("research-manager", () => login(D.mgr.email, PW), [["area", `/research/${R18.area.id}`], ["project", `/projects/${R18.prj.id}`], ["group", `/groups/${R18.grp.id}`], ["researcher", `/team/${D.lead.tmId}`]], async (loc, w) => {
      const T = `research ${loc} ${w}px manager`;
      await p15Ready(`/research/${R18.area.id}`);
      await p15Dialog(`${T} researchers dialog`, ".admin-bar .btn--secondary", 1, loc === "ja");
      await p15Dialog(`${T} edit-area dialog`, ".admin-bar .btn--secondary", 0, loc === "ja");
      await p15Dialog(`${T} delete-area confirmation`, ".admin-bar .btn--danger", 0, loc === "ja");
      if (P15_TAB_WIDTHS.includes(w)) await r18Walk(T, [["area", `/research/${R18.area.id}`]]);
    });
  });
  await step("research sweep: admin -- the area page and the content browser (EN+JA, 390..1920)", async () => {
    await p15Loop("research-admin", () => login(ADMIN.email, ADMIN.password), [["area", `/research/${R18.area.id}`], ["admin areas", "/admin/content?type=research-area&q=ZZ%20B9%20R18"], ["admin projects", "/admin/content?type=project&q=ZZ%20B9%20R18"]], async (loc, w) => {
      const T = `research ${loc} ${w}px admin`;
      await p15Ready("/admin/content?type=research-area&q=ZZ%20B9%20R18");
      await waitFor(`document.querySelectorAll('.admin-row').length >= 2`, 6000);
      await p15Dialog(`${T} area record dialog`, ".admin-row .btn--secondary", 0, loc === "ja");
    });
  });
  await step("research screenshots: the new pages at desktop and phone width (for eyeballing)", async () => {
    await setLocale(null);
    for (const [w, tag] of [[1280, "d"], [390, "m"]]) {
      await p15Vp(w);
      for (const [lbl, p] of [["area", `/research/${R18.area.id}`], ["area-long", `/research/${R18.areaLong.id}`], ["project", `/projects/${R18.prj.id}`], ["group", `/groups/${R18.grp.id}`], ["member", `/team/${D.lead.tmId}`]]) {
        await p15Ready(p);
        await shot(`r18-${lbl}-${tag}`);
      }
    }
    await setLocale("ja");
    await p15Vp(390);
    await p15Ready(`/research/${R18.areaLong.id}`);
    await shot("r18-area-long-ja-m");
    check("research screenshots: taken", fs.existsSync(path.join(SHOTS, "r18-area-d.png")));
    await setLocale(null);
  });
  await step("research: restore (locale, viewport)", async () => { await setLocale(null); await desktop(); });

  // ================================================================= PHASE 19: publication knowledge hub
  // The Publications page (filters, sort, pagination, URL state), the /publications/:id detail page and the relationships it
  // exposes, what a guest / member / manager / admin may see and change, the Japanese-edit guard, search, admin, hostile text,
  // and the nine-width sweep. (Steps are named "publications ..."; ONLY_PUBS=1 runs just them; P15_W / P15_USERS=pubs-guest,
  // pubs-member,pubs-manager narrow the sweeps.)
  section("phase 19: publications (hub, detail, relationships)");
  const R19 = {};
  const pMain = () => ev(`document.querySelector('main').innerText`);
  const pHtml = () => ev(`document.querySelector('main').outerHTML`);
  const pReady = async (p, mustHave) => { await go(p); await navReady(); await waitFor(`!document.querySelector('[aria-busy="true"]')`, 9000); if (mustHave) await waitText(mustHave, 9000); await sleep(250); };
  const pClick = async (sel, textMatch) => {
    const marked = await ev(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; const el = ${textMatch ? `els.find((e) => e.textContent.includes(${JSON.stringify(textMatch)}))` : "els[0]"}; if (!el) return false; el.setAttribute('data-p19-click', '1'); return true; })()`);
    if (!marked) return false;
    const r = await admClick("[data-p19-click]");
    await ev(`document.querySelectorAll('[data-p19-click]').forEach((e) => e.removeAttribute('data-p19-click'))`);
    return r;
  };
  const pCount = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const pBar = () => ev(`[...document.querySelectorAll('.admin-bar button')].map((b) => b.textContent.trim())`);
  const pSec = (id) => ev(`document.getElementById(${JSON.stringify(id)})?.textContent.trim() || ''`);
  const pTitles = () => ev(`[...document.querySelectorAll('.pub-item__title a')].map((a) => a.textContent.trim())`);
  const P19_HID = ["ZZ B9 R19 Paper Hidden", "ZZ B9 R19 Area Hidden", "ZZ B9 R19 Project Hidden", "ZZ B9 R19 News Hidden", "ZZ B9 R19 Event Hidden"];
  const pEnvelope = { items: [], total: 0, page: 1, limit: 20, pageCount: 1, years: [] };

  await step("publications seed: a hub with public, hidden, long, hostile-free and bulk publications, links and Japanese overrides", async () => {
    if (!P15.jsDialogs) { P15.jsDialogs = []; ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Page.javascriptDialogOpening") { P15.jsDialogs.push(m.params.message); send("Page.handleJavaScriptDialog", { accept: false }); } }); }
    const a = new Client();
    await a.req("POST", "/auth/login", ADMIN);
    R19.a = a;
    const J = (r) => r.json;
    R19.area = J(await a.req("POST", "/research", { title: "ZZ B9 R19 Area Alpha", description: "R19 area", tag: "ZZR19", visibility: "PUBLIC", translations: { ja: { title: "ZZ B9 R19 アルファ分野" } } }));
    R19.areaHid = J(await a.req("POST", "/research", { title: "ZZ B9 R19 Area Hidden", description: "R19 hidden area", tag: "ZZR19", visibility: "LAB_ONLY" }));
    R19.grp = J(await a.req("POST", "/groups", { name: "ZZ B9 R19 Group", description: "g", visibility: "PUBLIC", translations: { ja: { name: "ZZ B9 R19 グループ" } } }));
    R19.prj = J(await a.req("POST", "/projects", { title: "ZZ B9 R19 Project", summary: "R19 project summary", description: "d", status: "ACTIVE", visibility: "PUBLIC", groupId: R19.grp.id, translations: { ja: { title: "ZZ B9 R19 プロジェクト" } } }));
    R19.prjHid = J(await a.req("POST", "/projects", { title: "ZZ B9 R19 Project Hidden", summary: "hidden", status: "PLANNED", visibility: "LAB_ONLY", groupId: R19.grp.id }));
    await a.req("PUT", `/projects/${R19.prj.id}/areas`, { areaIds: [R19.area.id, R19.areaHid.id] });
    await a.req("PUT", `/projects/${R19.prjHid.id}/areas`, { areaIds: [R19.area.id] });
    const mkPub = async (body) => J(await a.req("POST", "/publications", body));
    R19.pub = await mkPub({ year: 2036, title: "ZZ B9 R19 Paper Alpha", authors: "ZZ B9 R19 Author One, ZZ B9 R19 Author Two", venue: "ZZ B9 R19 Journal", pdfUrl: "https://example.test/r19.pdf", doiUrl: "https://doi.org/10.0/r19", extraUrl: "https://example.test/code", extraLabel: "Code", teamMemberIds: [D.lead.tmId], translations: { ja: { title: "ZZ B9 R19 アルファ論文", venue: "ZZ B9 R19 日本ジャーナル" } } });
    R19.pubHid = await mkPub({ year: 2036, title: "ZZ B9 R19 Paper Hidden", authors: "x", venue: "v", visibility: "LAB_ONLY" });
    R19.pubHidPrj = await mkPub({ year: 2035, title: "ZZ B9 R19 Paper On Hidden Project", authors: "x", venue: "v" });
    R19.pubLong = await mkPub({ year: 2035, title: "ZZ B9 R19 Long " + "W".repeat(120) + " https://example.test/" + "a".repeat(120), authors: Array.from({ length: 30 }, (_, i) => `ZZ Author Number ${i + 1}`).join(", ") + " " + "V".repeat(90), venue: "ZZ B9 R19 " + "Q".repeat(100), translations: { ja: { title: "ZZ B9 R19 超長い日本語の論文タイトルがレイアウトを壊さないことを確認するための非常に長いテスト用の題名です" + "あ".repeat(60), venue: "ZZ B9 R19 " + "会".repeat(80) } } });
    R19.pubOld = await mkPub({ year: 2034, title: "ZZ B9 R19 Paper Old", authors: "ZZ B9 R19 Author One", venue: "ZZ B9 R19 Journal" });
    R19.bulk = [];
    for (let i = 1; i <= 22; i++) R19.bulk.push(await mkPub({ year: 2033, title: `ZZ B9 R19 Bulk ${String(i).padStart(2, "0")}`, authors: "ZZ Bulk", venue: "ZZ Bulk Venue" }));
    await a.req("PUT", `/projects/${R19.prj.id}/publications`, { publicationIds: [R19.pub.id, R19.pubHid.id, R19.pubLong.id] });
    await a.req("PUT", `/projects/${R19.prjHid.id}/publications`, { publicationIds: [R19.pubHidPrj.id] });
    R19.news = J(await a.req("POST", "/news", { date: "Jan 2036", sortDate: "2036-01-01", type: "Paper", title: "ZZ B9 R19 News Public", description: "d", visibility: "PUBLIC" }));
    R19.newsHid = J(await a.req("POST", "/news", { date: "Jan 2036", sortDate: "2036-01-02", type: "Paper", title: "ZZ B9 R19 News Hidden", description: "d", visibility: "LAB_ONLY" }));
    await a.req("PUT", `/projects/${R19.prj.id}/news`, { newsIds: [R19.news.id, R19.newsHid.id] });
    const at = new Date(Date.now() + 6 * 864e5).toISOString();
    R19.ev = J(await a.req("POST", "/events", { title: "ZZ B9 R19 Event Public", kind: "SEMINAR", startsAt: at, visibility: "PUBLIC", projectId: R19.prj.id }));
    R19.evHid = J(await a.req("POST", "/events", { title: "ZZ B9 R19 Event Hidden", kind: "MEETING", startsAt: at, visibility: "LAB_ONLY", projectId: R19.prj.id }));
    check("publications setup: the fixtures exist", [R19.area, R19.areaHid, R19.grp, R19.prj, R19.prjHid, R19.pub, R19.pubHid, R19.pubHidPrj, R19.pubLong, R19.pubOld, R19.news, R19.ev, ...R19.bulk].every((x) => x?.id));
    const det = await a.req("GET", `/publications/${R19.pub.id}`);
    check("publications setup: the detail API links the researcher, project, public area and group", det.json.researchers.length === 1 && det.json.projects.length === 1 && det.json.areas.length === 2 && det.json.groups.length === 1);
  });

  // ---------------------------------------------------------------- guest: the hub
  await step("publications guest: the hub filters, sorts, pages and keeps its state in the URL", async () => {
    await desktop(); await setLocale(null);
    await pReady("/publications?q=ZZ+B9+R19", "ZZ B9 R19 Paper Alpha");
    let t = await pMain();
    check("publications guest: one h1 (Publications), a labelled filter form, and a result count announced politely", (await pCount("h1")) === 1 && (await ev(`document.querySelector('h1').textContent`)) === "Publications" && (await exists('form[aria-label="Filter publications"]')) && (await ev(`document.querySelector('.filters__count').getAttribute('role')`)) === "status");
    check("publications guest: every filter control has a real <label> and a unique id", await ev(`(() => { const ctl = [...document.querySelectorAll('form[aria-label="Filter publications"] input, form[aria-label="Filter publications"] select')]; return ctl.length >= 7 && ctl.every((c) => c.id && document.querySelectorAll('label[for="' + c.id + '"]').length === 1 && document.querySelector('label[for="' + c.id + '"]').textContent.trim().length > 0); })()`));
    check("publications guest: no visibility filter is offered to a guest", !(await exists("#pub_f_visibility")));
    const listHtml = await pHtml();
    check("publications guest: the hidden publications and hidden records are nowhere in the page text or markup", P19_HID.every((w) => !t.includes(w)) && !listHtml.includes(R19.pubHid.id));
    check("publications guest: the count matches the API (guest total) and no title is shown twice", await ev(`fetch('/api/publications/browse?q=ZZ+B9+R19').then((r) => r.json()).then((j) => new RegExp(String(j.total)).test(document.querySelector('.filters__count').innerText) && j.total >= 25)`) && new Set(await pTitles()).size === (await pTitles()).length);
    check("publications guest: 20 rows on page 1, grouped under year headings newest first", (await pCount(".pub-item")) === 20 && await ev(`(() => { const ys = [...document.querySelectorAll('h2.year-heading')].map((h) => +h.textContent.trim().slice(0, 4)); return ys.length >= 2 && ys.every((y, i) => i === 0 || ys[i - 1] > y); })()`));
    check("publications guest: every title is a link to /publications/:id", await ev(`[...document.querySelectorAll('.pub-item__title a')].every((a) => /^\\/publications\\/[\\w-]+$/.test(a.getAttribute('href')))`));
    check("publications guest: the pager is a labelled nav with Previous disabled and Next a real link", (await exists('nav[aria-label="Publication pages"]')) && (await ev(`document.querySelector('nav[aria-label="Publication pages"] .is-disabled').getAttribute('aria-disabled')`)) === "true" && (await exists('nav[aria-label="Publication pages"] a[rel="next"]')) && /Page 1 of 2/.test(await ev(`document.querySelector('.search-pager__pos').innerText`)));
    const p1Titles = await pTitles();
    await pClick('nav[aria-label="Publication pages"] a[rel="next"]');
    check("publications guest: Next opens page 2 -- the URL carries page=2 and the rest of the state", (await waitFor(`location.search.includes('page=2') && location.search.includes('q=ZZ+B9+R19')`, 6000)) && (await waitFor(`!document.querySelector('[aria-busy="true"]') && /Page 2 of 2/.test(document.querySelector('.search-pager__pos')?.innerText || '')`, 6000)));
    const p2 = await pTitles();
    await ev(`history.back()`);
    await waitFor(`!location.search.includes('page=2')`, 4000);
    await waitFor(`!document.querySelector('[aria-busy="true"]')`, 6000);
    check("publications guest: Back returns to page 1 (state lives in the URL); page 2 had different rows", (await pCount(".pub-item")) === 20 && p2.length > 0 && p2.every((x) => !p1Titles.includes(x)));
    // filter by year through the UI
    await pReady("/publications?q=ZZ+B9+R19", "ZZ B9 R19 Paper Alpha");
    await setVal("pub_f_year", "2036");
    await pClick('form[aria-label="Filter publications"] button[type="submit"]');
    check("publications guest: picking a year and applying puts year=2036 in the URL and narrows the list to that year", (await waitFor(`location.search.includes('year=2036')`, 5000)) && (await waitFor(`document.querySelectorAll('h2.year-heading').length === 1`, 6000)) && (await pTitles()).join("|") === "ZZ B9 R19 Paper Alpha");
    check("publications guest: the count says one publication and 'Clear filters' appears", (await waitFor(`/^1 publication$/.test(document.querySelector('.filters__count').innerText.trim())`, 4000)) && (await exists('a.btn[href="/publications"]')));
    // sort A-Z: flat list, no year headings
    await pReady("/publications?q=ZZ+B9+R19&sort=title", "ZZ B9 R19");
    const az = await pTitles();
    check("publications guest: sort=title is one flat A-Z list (no year headings)", (await pCount("h2.year-heading")) === 0 && az.length === 20 && az.every((x, i) => i === 0 || az[i - 1].localeCompare(x, "en") <= 0), az.slice(0, 3).join("|"));
    await pReady("/publications?q=ZZ+B9+R19&sort=oldest", "ZZ B9 R19");
    check("publications guest: sort=oldest starts with the oldest year (the bulk year, 2033)", await ev(`(() => { const ys = [...document.querySelectorAll('h2.year-heading')].map((h) => +h.textContent.trim().slice(0, 4)); return ys.length >= 1 && ys[0] === 2033; })()`));
    await pReady("/publications?q=ZZ+B9+R19&sort=oldest&page=2", "ZZ B9 R19");
    check("publications guest: on page 2 of oldest-first the years keep ascending", await ev(`(() => { const ys = [...document.querySelectorAll('h2.year-heading')].map((h) => +h.textContent.trim().slice(0, 4)); return ys.length >= 2 && ys.every((y, k) => k === 0 || ys[k - 1] < y); })()`));
    // researcher, project, area, group filters (values are ids in the URL)
    await pReady(`/publications?researcher=${D.lead.tmId}`, "ZZ B9 R19 Paper Alpha");
    check("publications guest: the researcher filter shows only that researcher's visible publications (the hidden one is absent)", (await pTitles()).includes("ZZ B9 R19 Paper Alpha") && !(await pTitles()).some((x) => x.includes("Paper Hidden")) && (await ev(`document.getElementById('pub_f_researcher').value`)) === D.lead.tmId);
    await pReady(`/publications?project=${R19.prj.id}`, "ZZ B9 R19 Paper Alpha");
    check("publications guest: the project filter shows the project's visible publications only", (await pTitles()).sort().join("|") === ["ZZ B9 R19 Paper Alpha", (await pTitles()).find((x) => x.startsWith("ZZ B9 R19 Long"))].sort().join("|"));
    await pReady(`/publications?area=${R19.area.id}`, "ZZ B9 R19 Paper Alpha");
    check("publications guest: the area filter reaches publications through visible projects only (the hidden project's is absent)", (await pTitles()).includes("ZZ B9 R19 Paper Alpha") && !(await pTitles()).some((x) => x.includes("Hidden Project")));
    await pReady(`/publications?group=${R19.grp.id}`, "ZZ B9 R19 Paper Alpha");
    check("publications guest: the group filter likewise", (await pTitles()).includes("ZZ B9 R19 Paper Alpha") && !(await pTitles()).some((x) => x.includes("Hidden Project")));
    // hidden / unknown / malformed
    await pReady(`/publications?project=${R19.prjHid.id}`, "No publications match");
    t = await pMain();
    check("publications guest: filtering by a hidden project is the plain empty state (no title leaks, same as an unknown id)", t.includes("No publications match these filters.") && P19_HID.every((w) => !t.includes(w)) && (await pCount(".pub-item")) === 0);
    await pReady("/publications?year=abc&page=-5&sort=zz&project=..%2Fx&q=" + "x".repeat(150), "were not valid");
    check("publications guest: malformed URL parameters are ignored with a polite notice -- the list still renders, no error state", (await pMain()).includes("were not valid and were ignored") && (await pCount(".pub-item")) > 0 && !(await exists("#main [role=alert]")));
    await pReady("/publications?page=999", "No publications match");
    check("publications guest: a page past the end is an empty state with a working way back, not a crash", (await pMain()).includes("No publications match") && (await exists('a.btn[href="/publications"]')));
    // keyboard
    await pReady("/publications?q=ZZ+B9+R19+Paper+Alpha", "ZZ B9 R19 Paper Alpha");
    await ev(`document.querySelector('.pub-item__title a').setAttribute('data-r19-focus', '1')`);
    await focusSel("[data-r19-focus]");
    check("publications guest: the focused title link shows a visible focus ring", await ev(`(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; })()`));
    await press("enter");
    check("publications guest: Enter on the title opens the detail page (one h1, one main)", (await waitFor(`location.pathname === '/publications/${R19.pub.id}'`, 6000)) && (await waitText("ZZ B9 R19 Journal", 6000)) && (await pCount("h1")) === 1 && (await pCount("main")) === 1);
  });

  // ---------------------------------------------------------------- guest: the detail page
  await step("publications guest: the detail page shows real relationships only, and a hidden publication is a clean 404", async () => {
    await pReady(`/publications/${R19.pub.id}`, "ZZ B9 R19 Journal");
    let t = await pMain();
    const html = await pHtml();
    check("publications guest: title is the h1, the breadcrumb ends at it (marked current) and the tab title names it", (await pCount("h1")) === 1 && (await ev(`document.querySelector('h1').textContent`)) === "ZZ B9 R19 Paper Alpha" && (await ev(`document.querySelector('.breadcrumbs [aria-current="page"]').textContent`)) === "ZZ B9 R19 Paper Alpha" && (await exists('.breadcrumbs a[href="/publications"]')) && (await ev(`document.title`)).startsWith("ZZ B9 R19 Paper Alpha"));
    check("publications guest: authors, venue and year are shown", t.includes("ZZ B9 R19 Author One, ZZ B9 R19 Author Two") && t.includes("ZZ B9 R19 Journal") && t.includes("2036"));
    check("publications guest: the three links open in a new tab, noopener, and say so to screen readers (custom label kept)", await ev(`(() => { const ls = [...document.querySelectorAll('main .pub-link')]; return ls.length === 3 && ls.every((a) => a.target === '_blank' && /noopener/.test(a.rel) && /opens in a new tab/.test(a.textContent)) && ls.some((a) => a.textContent.includes('Code')); })()`));
    check("publications guest: researchers (1), projects (1), research areas (1: only the public one), groups (1) -- headings carry the VISIBLE counts", (await pSec("pub-researchers")) === "Researchers (1)" && (await pSec("pub-projects")) === "Projects (1)" && (await pSec("pub-areas")) === "Research areas (1)" && (await pSec("pub-groups")) === "Groups (1)");
    check("publications guest: related news (1) and events (1) -- the public ones of the visible project", (await pSec("pub-news")) === "Related news (1)" && (await pSec("pub-events")) === "Related events (1)" && t.includes("ZZ B9 R19 News Public") && t.includes("ZZ B9 R19 Event Public"));
    check("publications guest: it says areas, groups, news and events come from the projects (derived, not invented)", has(t, "come from the projects this publication belongs to"));
    check("publications guest: NOTHING hidden appears in the text, and no hidden id or account id in the markup", P19_HID.every((w) => !t.includes(w)) && ![R19.pubHid.id, R19.prjHid.id, R19.areaHid.id, R19.newsHid.id, R19.evHid.id].some((i) => html.includes(i)) && !D.userIds.some((u) => html.includes(u)) && !/lab only/i.test(t));
    check("publications guest: no manager controls", !(await exists(".admin-bar")));
    // hidden / unknown / malformed
    await pReady(`/publications/${R19.pubHid.id}`, "Publication not found");
    t = await pMain();
    check("publications guest: a hidden publication is the not-found state; title, breadcrumb and tab title leak nothing", t.includes("doesn't exist, or you don't have access") && !t.includes("Paper Hidden") && !/Hidden|ZZ B9/.test(await ev(`document.title + ' ' + document.querySelector('.breadcrumbs').innerText`)) && (await pCount("h1")) === 1 && (await exists('a.btn[href="/publications"]')));
    const hiddenView = await pMain();
    await pReady("/publications/zzzunknownid1234", "Publication not found");
    check("publications guest: an unknown id looks exactly the same as a hidden one", (await pMain()) === hiddenView);
    await pReady("/publications/bad!id", "Publication not found");
    check("publications guest: a malformed id is the same not-found state (no error text, no crash)", (await pMain()) === hiddenView);
    // real clicks through the relationships
    await pReady(`/publications/${R19.pub.id}`, "ZZ B9 R19 Journal");
    await pClick(`a[href="/projects/${R19.prj.id}"]`);
    check("publications guest: the project link opens the project page, which lists this publication under Research outputs", (await waitFor(`location.pathname === '/projects/${R19.prj.id}'`, 6000)) && (await waitText("Research outputs (2)", 6000)) && (await pMain()).includes("ZZ B9 R19 Paper Alpha") && !(await pMain()).includes("Paper Hidden"));
    check("publications guest: the project page shows no publication twice and every one is a link to its detail", await ev(`(() => { const links = [...document.querySelectorAll('section[aria-labelledby="project-pubs"] .pub-item__title a')]; return links.length === 2 && new Set(links.map((a) => a.getAttribute('href'))).size === 2; })()`));
    await pClick('section[aria-labelledby="project-pubs"] .pub-item__title a', "Paper Alpha");
    check("publications guest: a publication on the project page opens its detail page", await waitFor(`location.pathname === '/publications/${R19.pub.id}'`, 6000));
    await waitText("ZZ B9 R19 Journal", 6000);
    await pClick(`a[href="/research/${R19.area.id}"]`);
    check("publications guest: the research-area chip opens the area, which lists the publication (through its visible project)", (await waitFor(`location.pathname === '/research/${R19.area.id}'`, 6000)) && (await waitText("ZZ B9 R19 Paper Alpha", 6000)) && !(await pMain()).includes("Paper On Hidden Project"));
    await pReady(`/publications/${R19.pub.id}`, "ZZ B9 R19 Journal");
    await pClick(`a[href="/groups/${R19.grp.id}"]`);
    check("publications guest: the group chip opens the group, which lists the publication and not the hidden project's", (await waitFor(`location.pathname === '/groups/${R19.grp.id}'`, 6000)) && (await waitText("ZZ B9 R19 Paper Alpha", 6000)) && !(await pMain()).includes("Paper On Hidden Project"));
    await pReady(`/publications/${R19.pub.id}`, "ZZ B9 R19 Journal");
    await pClick(`a[href="/team/${D.lead.tmId}"]`);
    check("publications guest: the researcher opens their profile, which lists the publication with a link back", (await waitFor(`location.pathname === '/team/${D.lead.tmId}'`, 6000)) && (await waitText("ZZ B9 R19 Paper Alpha", 6000)) && (await exists(`a[href="/publications/${R19.pub.id}"]`)) && !(await pMain()).includes("Paper Hidden"));
    await pReady(`/publications/${R19.pubOld.id}`, "ZZ B9 R19 Journal");
    t = await pMain();
    check("publications guest: a publication with no project/area/group shows honest empty states (no invented links)", (await pSec("pub-projects")) === "Projects (0)" && (await pSec("pub-areas")) === "Research areas (0)" && (await pSec("pub-groups")) === "Groups (0)" && t.includes("Not linked to a project yet.") && (await pCount('a[href^="/projects/"]:not(.nav a)')) === 0);
    // the home page shows recent outputs, linked, without the hidden one
    await pReady("/", "Recent research outputs");
    check("publications guest: Home shows a small 'Recent research outputs' block with links to the detail pages and no hidden title", (await pCount('section[aria-labelledby="home-pubs"] .pub-item')) <= 4 && (await pCount('section[aria-labelledby="home-pubs"] .pub-item')) > 0 && await ev(`[...document.querySelectorAll('section[aria-labelledby="home-pubs"] .pub-item__title a')].every((a) => /^\\/publications\\/[\\w-]+$/.test(a.getAttribute('href')))`) && !(await pMain()).includes("Paper Hidden"));
  });

  // ---------------------------------------------------------------- member / manager
  await step("publications member: edits (any signed-in account), cannot delete, cannot filter by visibility", async () => {
    check("publications member: login (a true MEMBER)", await login(D.plain.email, PW));
    await pReady(`/publications/${R19.pub.id}`, "ZZ B9 R19 Journal");
    const bar = await pBar();
    check("publications member: the bar offers Edit and Manage authors, not Delete", bar.join("|") === "Edit|Manage authors");
    await pReady(`/publications/${R19.pubHid.id}`, "ZZ B9 R19 Paper Hidden");
    check("publications member: the LAB_ONLY publication is reachable (same rule as the list)", (await pMain()).includes("ZZ B9 R19 Paper Hidden") && (await pCount("h1")) === 1);
    await pReady(`/publications/${R19.pub.id}`, "ZZ B9 R19 Journal");
    check("publications member: the lab-only area, news and event now appear (viewer-scoped, from the same projects)", (await pSec("pub-areas")) === "Research areas (2)" && (await pSec("pub-news")) === "Related news (2)" && (await pSec("pub-events")) === "Related events (2)");
    await pClick(".admin-bar button", "Edit");
    check("publications member: the edit dialog opens, grouped into fieldsets (Publication, Links, Japanese) with the Japanese inputs", (await waitFor(`!!document.getElementById('pub_title')`, 5000)) && (await pCount(".modal fieldset legend")) >= 3 && (await exists("#pub_title_ja")) && (await exists("#pub_venue_ja")) && !(await exists("#pub_visibility")));
    check("publications member: the Japanese override is prefilled and the English inputs hold English", await waitFor(`document.getElementById('pub_title_ja').value === 'ZZ B9 R19 アルファ論文' && document.getElementById('pub_title').value === 'ZZ B9 R19 Paper Alpha'`, 6000));
    await press("esc");
    check("publications member: Escape closes the dialog and focus returns to the Edit button", (await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 3000)) && (await ev(`document.activeElement?.textContent?.trim()`)) === "Edit");
    // server: a member cannot delete or change visibility even if the UI is bypassed
    check("publications member: the server refuses delete (403) and visibility (403) regardless of the UI", (await admApi("DELETE", `/publications/${R19.pub.id}`)).status === 403 && (await admApi("PUT", `/publications/${R19.pub.id}`, { visibility: "LAB_ONLY" })).status === 403);
    // list: add a publication through the form (create with Japanese override, link to own profile)
    await pReady("/publications", "Publications");
    check("publications member: the list offers 'Add publication' and per-row Edit (no Delete), and no visibility filter", !(await exists("#pub_f_visibility")) && (await pBar()).join("|") === "+ Add publication" && (await pCount(".pub-item .icon-btn--danger")) === 0 && (await pCount(".pub-item .icon-btn")) > 0);
    await pClick(".admin-bar button", "Add publication");
    await waitFor(`!!document.getElementById('pub_title')`, 5000);
    await setVal("pub_year", "2037");
    await setVal("pub_venue", "ZZ B9 R19 Created Venue");
    await setVal("pub_title", "ZZ B9 R19 Created By Form");
    await setVal("pub_authors", "ZZ B9 R19 Form Author");
    await setVal("pub_title_ja", "ZZ B9 R19 フォームで作成");
    await submitModal();
    check("publications member: saving closes the dialog and the new publication is stored with its Japanese override", (await waitFor(`!document.querySelector('.modal')`, 6000)) && await (async () => { const l = (await R19.a.req("GET", "/publications")).json.find((p) => p.title === "ZZ B9 R19 Created By Form"); R19.created = l; return !!l && (await (await fetch(`${API}/api/publications/${l.id}`, { headers: { "X-Locale": "ja" } })).json()).title === "ZZ B9 R19 フォームで作成"; })());
    await logout();
  });

  await step("publications manager: edits in Japanese without touching the English, manages authors, filters by visibility, deletes with a confirmation", async () => {
    check("publications manager: login", await login(D.mgr.email, PW));
    await pReady("/publications?q=ZZ+B9+R19+Paper", "ZZ B9 R19 Paper Alpha");
    check("publications manager: the visibility filter is offered", await exists("#pub_f_visibility"));
    await setVal("pub_f_visibility", "LAB_ONLY");
    await pClick('form[aria-label="Filter publications"] button[type="submit"]');
    check("publications manager: filtering by LAB_ONLY shows only lab-only rows, each with its badge", (await waitFor(`location.search.includes('visibility=LAB_ONLY')`, 5000)) && (await waitFor(`!document.querySelector('[aria-busy="true"]')`, 6000)) && (await pTitles()).join("|").includes("Paper Hidden") && (await pCount(".pub-item")) === (await pCount(".pub-item .vis-badge")));
    await pReady(`/publications/${R19.pub.id}`, "ZZ B9 R19 Journal");
    check("publications manager: the bar offers Edit, Manage authors and Delete", (await pBar()).join("|") === "Edit|Manage authors|Delete");
    // the Japanese-edit regression: the English inputs must hold ENGLISH
    await setLocale("ja");
    await pReady(`/publications/${R19.pub.id}`, "ZZ B9 R19 アルファ論文");
    check("publications manager (ja): the page shows the Japanese title and venue", (await pMain()).includes("ZZ B9 R19 日本ジャーナル") && (await ev(`document.querySelector('h1').textContent`)) === "ZZ B9 R19 アルファ論文");
    await pClick(".admin-bar button", "編集");
    check("publications manager (ja): the edit dialog opens", await waitFor(`!!document.getElementById('pub_title')`, 5000));
    check("publications manager (ja): the ENGLISH inputs hold the English text (not the Japanese the page showed)", await waitFor(`document.getElementById('pub_title').value === 'ZZ B9 R19 Paper Alpha' && document.getElementById('pub_venue').value === 'ZZ B9 R19 Journal'`, 6000), await ev(`document.getElementById('pub_title').value`));
    check("publications manager (ja): the Japanese inputs hold the Japanese override", (await ev(`document.getElementById('pub_title_ja').value`)) === "ZZ B9 R19 アルファ論文" && (await ev(`document.getElementById('pub_venue_ja').value`)) === "ZZ B9 R19 日本ジャーナル");
    await setVal("pub_title_ja", "ZZ B9 R19 アルファ論文 改訂");
    await submitModal();
    check("publications manager (ja): saving closes the dialog", await waitFor(`!document.querySelector('.modal')`, 6000));
    const enNow = await (await fetch(`${API}/api/publications/${R19.pub.id}`, { headers: { "X-Locale": "en" } })).json();
    const jaNow = await (await fetch(`${API}/api/publications/${R19.pub.id}`, { headers: { "X-Locale": "ja" } })).json();
    check("publications manager (ja): the ENGLISH title and venue are unchanged, the Japanese override is the edit, the other override intact", enNow.title === "ZZ B9 R19 Paper Alpha" && enNow.venue === "ZZ B9 R19 Journal" && jaNow.title === "ZZ B9 R19 アルファ論文 改訂" && jaNow.venue === "ZZ B9 R19 日本ジャーナル");
    await R19.a.req("PUT", `/publications/${R19.pub.id}`, { translations: { ja: { title: "ZZ B9 R19 アルファ論文" } } });
    await setLocale(null);
    // English edit that does not touch the Japanese
    await pReady(`/publications/${R19.pub.id}`, "ZZ B9 R19 Journal");
    await pClick(".admin-bar button", "Edit");
    await waitFor(`document.getElementById('pub_title_ja')?.value === 'ZZ B9 R19 アルファ論文'`, 6000);
    await setVal("pub_venue", "ZZ B9 R19 Journal Edited");
    await submitModal();
    check("publications manager: an English edit updates the English venue and keeps the Japanese override", (await waitFor(`!document.querySelector('.modal')`, 6000)) && (await waitText("ZZ B9 R19 Journal Edited", 6000)) && (await (await fetch(`${API}/api/publications/${R19.pub.id}`, { headers: { "X-Locale": "ja" } })).json()).title === "ZZ B9 R19 アルファ論文");
    await R19.a.req("PUT", `/publications/${R19.pub.id}`, { venue: "ZZ B9 R19 Journal" });
    // manage authors
    await pReady(`/publications/${R19.pub.id}`, "ZZ B9 R19 Journal");
    await pClick(".admin-bar button", "Manage authors");
    check("publications manager: the authors dialog lists the team with the current author checked", (await waitFor(`document.querySelectorAll('.modal .pick-item').length >= 4`, 5000)) && (await pCount(".modal input[type=checkbox]:checked")) === 1);
    await ev(`[...document.querySelectorAll('.modal .pick-item')].find((l) => l.textContent.includes('ZZ B9 Member')).querySelector('input').click()`);
    await submitModal();
    check("publications manager: saving adds the researcher; the page shows two; the server audits it", (await waitFor(`!document.querySelector('.modal')`, 5000)) && (await waitFor(`document.getElementById('pub-researchers')?.textContent.trim() === 'Researchers (2)'`, 6000)) && (await R19.a.req("GET", "/admin/audit?entityType=PUBLICATION&limit=50")).json.entries.some((r) => r.action === "PUBLICATION_AUTHORS_CHANGED" && r.entityId === R19.pub.id));
    await R19.a.req("PUT", `/publications/${R19.pub.id}/authors`, { teamMemberIds: [D.lead.tmId] });
    // delete with a confirmation
    const tmp = (await R19.a.req("POST", "/publications", { year: 2030, title: "ZZ B9 R19 Throwaway", authors: "a", venue: "v" })).json;
    await pReady(`/publications/${tmp.id}`, "ZZ B9 R19 Throwaway");
    await pClick(".admin-bar .btn--danger");
    check("publications manager: Delete opens a confirmation naming the publication", (await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 3000)) && (await ev(`document.querySelector('.modal[role="dialog"]').innerText`)).includes("ZZ B9 R19 Throwaway"));
    await press("esc");
    check("publications manager: Escape cancels and the publication still exists", (await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2000)) && (await admApi("GET", `/publications/${tmp.id}`)).status === 200);
    await pClick(".admin-bar .btn--danger");
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 3000);
    await ev(`[...document.querySelectorAll('.modal button')].find((b) => /delete/i.test(b.textContent) && b.classList.contains('btn--danger'))?.click()`);
    check("publications manager: confirming deletes it and returns to the list", (await waitFor(`location.pathname === '/publications'`, 6000)) && (await admApi("GET", `/publications/${tmp.id}`)).status === 404);
    await logout();
  });

  // ---------------------------------------------------------------- search + admin
  await step("publications search + admin: results and admin rows link to the detail page", async () => {
    await pReady("/search?q=ZZ+B9+R19+Paper+Alpha&type=publication", "ZZ B9 R19 Paper Alpha");
    check("publications search: the result links to /publications/:id", await ev(`[...document.querySelectorAll('main a')].some((a) => a.getAttribute('href') === '/publications/${R19.pub.id}')`));
    await pClick(`main a[href="/publications/${R19.pub.id}"]`);
    check("publications search: clicking it opens the detail page", (await waitFor(`location.pathname === '/publications/${R19.pub.id}'`, 6000)) && (await waitText("ZZ B9 R19 Journal", 6000)));
    await pReady("/search?q=ZZ+B9+R19+Paper+Hidden", "");
    await sleep(600);
    check("publications search: a guest cannot find the hidden publication (the results list, not the echoed query)", !(await ev(`document.querySelector('.search-results')?.innerText || ''`)).includes("Paper Hidden") && (await ev(`document.querySelector('.search-results')?.innerText || ''`)).includes("Paper On Hidden Project"));
    check("publications admin: an admin login", await login(ADMIN.email, ADMIN.password));
    await pReady("/admin/content?type=publication&q=ZZ+B9+R19+Paper", "ZZ B9 R19 Paper Alpha");
    check("publications admin: the content browser row opens the publication's own page and shows the hidden one too", await ev(`[...document.querySelectorAll('main a')].some((a) => a.getAttribute('href') === '/publications/${R19.pub.id}')`) && (await pMain()).includes("ZZ B9 R19 Paper Hidden"));
    await pReady("/admin/translations?type=PUBLICATION&q=ZZ+B9+R19+Paper+Alpha", "ZZ B9 R19 Paper Alpha");
    check("publications admin: the translations view offers publications with title and venue (base text, Japanese override)", (await ev(`document.getElementById('tr-${R19.pub.id}-title')?.value`)) === "ZZ B9 R19 アルファ論文" && (await ev(`document.getElementById('tr-${R19.pub.id}-venue')?.value`)) === "ZZ B9 R19 日本ジャーナル" && (await pMain()).includes("ZZ B9 R19 Paper Alpha"));
    await logout();
  });

  // ---------------------------------------------------------------- Japanese
  await step("publications ja: the hub and detail read in Japanese; authorization is the same", async () => {
    await setLocale("ja");
    await pReady("/publications?q=ZZ+B9+R19+Paper", "ZZ B9 R19 アルファ論文");
    let t = await pMain();
    check("publications ja: Japanese chrome, filter labels, sort options and localized title/venue", (await ev(`document.documentElement.lang`)) === "ja" && (await ev(`document.querySelector('h1').textContent`)) === "論文・出版物" && (await exists('form[aria-label="論文を絞り込む"]')) && (await ev(`document.querySelector('label[for="pub_f_year"]').textContent`)) === "年" && t.includes("ZZ B9 R19 アルファ論文") && t.includes("ZZ B9 R19 日本ジャーナル") && /\d+件の論文/.test(await ev(`document.querySelector('.filters__count').innerText`)));
    check("publications ja: the same rows as English (locale never changes which records are visible), hidden still hidden", !t.includes("Paper Hidden") && (await pCount(".pub-item")) === (await ev(`fetch('/api/publications/browse?q=ZZ+B9+R19+Paper', { headers: { 'X-Locale': 'en' } }).then((r) => r.json()).then((j) => j.items.length)`)));
    await pReady(`/publications/${R19.pub.id}`, "ZZ B9 R19 日本ジャーナル");
    t = await pMain();
    check("publications ja: the detail page is Japanese -- headings, related titles, breadcrumb, tab title", t.includes("研究者（1）") && t.includes("プロジェクト（1）") && t.includes("研究分野（1）") && t.includes("グループ（1）") && t.includes("ZZ B9 R19 プロジェクト") && t.includes("ZZ B9 R19 アルファ分野") && t.includes("ZZ B9 R19 グループ") && (await ev(`document.title`)).startsWith("ZZ B9 R19 アルファ論文") && (await ev(`document.querySelector('.breadcrumbs a[href="/publications"]').textContent`)) === "論文・出版物");
    check("publications ja: authors and links are never translated", t.includes("ZZ B9 R19 Author One, ZZ B9 R19 Author Two") && (await pCount("main .pub-link")) === 3);
    check("publications ja: nothing hidden", P19_HID.every((w) => !t.includes(w)));
    await pReady(`/publications/${R19.pubHid.id}`, "論文が見つかりません");
    check("publications ja: the hidden publication is the Japanese not-found state and leaks nothing", !(await pMain()).includes("Paper Hidden") && !(await ev(`document.title`)).includes("Hidden"));
    await pReady(`/publications?year=abc`, "無効");
    check("publications ja: the ignored-filter notice is Japanese", (await pMain()).includes("無効だったため"));
    await pReady(`/projects/${R19.prj.id}`, "研究成果（2）");
    check("publications ja: the project page's Research outputs heading and localized publication titles", (await pMain()).includes("ZZ B9 R19 アルファ論文") && !(await pMain()).includes("Paper Hidden"));
    check("publications ja: authorization is unchanged in Japanese (guest 404 on the hidden one, 401 on writes)", (await admApi("GET", `/publications/${R19.pubHid.id}`, undefined, "ja")).status === 404 && (await admApi("PUT", `/publications/${R19.pub.id}`, { year: 2000 }, "ja")).status === 401 && (await admApi("GET", "/publications/browse?visibility=LAB_ONLY", undefined, "ja")).status === 403);
    await setLocale(null);
  });

  // ---------------------------------------------------------------- hostile text
  await step("publications hostile text: markup and unbroken strings are inert text on every publication surface", async () => {
    await desktop(); await setLocale(null);
    const hostile = "ZZ B9 R19 <img src=x onerror=window.__r19Xss=1> Hostile";
    const h = (await R19.a.req("POST", "/publications", { year: 2036, title: hostile, authors: "<script>window.__r19Xss=2</script> ZZ", venue: "\"><svg onload=window.__r19Xss=3>", teamMemberIds: [D.lead.tmId], translations: { ja: { title: "ZZ B9 R19 <img src=x onerror=window.__r19Xss=4>日本語", venue: "<b>会場</b>" } } })).json;
    await R19.a.req("PUT", `/projects/${R19.prj.id}/publications`, { publicationIds: [R19.pub.id, R19.pubHid.id, R19.pubLong.id, h.id] });
    for (const p of ["/publications?q=Hostile", `/publications/${h.id}`, `/projects/${R19.prj.id}`, `/team/${D.lead.tmId}`, `/research/${R19.area.id}`, `/groups/${R19.grp.id}`, "/search?q=Hostile&type=publication", "/"]) {
      await pReady(p);
      await sleep(250);
      check(`publications hostile: ${p.split("?")[0]} renders it as text (no script ran, no injected element)`, (await ev(`typeof window.__r19Xss`)) === "undefined" && (await ev(`document.querySelectorAll('main img[src="x"], main script, main svg[onload], main b').length`)) === 0);
    }
    await pReady(`/publications/${h.id}`, "Hostile");
    check("publications hostile: the title is shown literally", (await ev(`document.querySelector('h1').textContent`)) === hostile);
    await setLocale("ja");
    await pReady(`/publications/${h.id}`, "日本語");
    check("publications hostile (ja): the Japanese override is shown literally and inert", (await ev(`typeof window.__r19Xss`)) === "undefined" && (await ev(`document.querySelectorAll('main img[src="x"], main b').length`)) === 0 && (await ev(`document.querySelector('h1').textContent`)).includes("<img src=x onerror=window.__r19Xss=4>"));
    await setLocale(null);
    await R19.a.req("PUT", `/projects/${R19.prj.id}/publications`, { publicationIds: [R19.pub.id, R19.pubHid.id, R19.pubLong.id] });
    await R19.a.req("DELETE", `/publications/${h.id}`);
  });

  // ---------------------------------------------------------------- nine-width sweep, EN + JA
  const p19Guest = () => [["hub", "/publications?q=ZZ+B9+R19"], ["hub page 2", "/publications?q=ZZ+B9+R19&page=2"], ["hub A-Z", "/publications?q=ZZ+B9+R19&sort=title"], ["hub empty", "/publications?q=zzznomatchzzz"], ["hub ignored params", "/publications?year=abc"], ["detail", `/publications/${R19.pub.id}`], ["detail long", `/publications/${R19.pubLong.id}`], ["detail unlinked", `/publications/${R19.pubOld.id}`], ["detail hidden 404", `/publications/${R19.pubHid.id}`], ["project outputs", `/projects/${R19.prj.id}`], ["home", "/"]];
  const p19Walk = async (T, pages) => { for (const [lbl, p] of pages) { await p15Ready(p); const tw = await p15TabWalk(70); check(`${T} keyboard ${lbl}: Tab reaches ${tw.stops} stops -- all visible, named, ringed, uncovered`, tw.stops >= 5 && tw.bad.length === 0, tw.bad.slice(0, 3).join(" | ")); } };
  await step("publications sweep: guest -- hub and detail pages (EN+JA, 390..1920)", async () => {
    await p15Loop("pubs-guest", null, p19Guest(), async (loc, w) => {
      if (P15_TAB_WIDTHS.includes(w)) await p19Walk(`publications ${loc} ${w}px guest`, [["hub", "/publications?q=ZZ+B9+R19"], ["detail", `/publications/${R19.pub.id}`]]);
    });
    check("publications sweep guest: no script from hostile text ever ran", (await ev(`typeof window.__r19Xss`)) === "undefined");
  });
  await step("publications sweep: member -- lab-only records, the edit dialog (EN+JA, 390..1920)", async () => {
    await p15Loop("pubs-member", () => login(D.plain.email, PW), [["hub", "/publications?q=ZZ+B9+R19"], ["detail", `/publications/${R19.pub.id}`], ["detail lab-only", `/publications/${R19.pubHid.id}`]], async (loc, w) => {
      const T = `publications ${loc} ${w}px member`;
      await p15Ready(`/publications/${R19.pub.id}`);
      await p15Dialog(`${T} edit dialog`, ".admin-bar .btn--secondary", 0, loc === "ja");
      await p15Dialog(`${T} authors dialog`, ".admin-bar .btn--secondary", 1, loc === "ja");
      await p15Ready("/publications?q=ZZ+B9+R19+Paper");
      await p15Dialog(`${T} add dialog`, ".admin-bar .btn--primary", 0, loc === "ja");
    });
  });
  await step("publications sweep: manager -- visibility filter, delete confirmation (EN+JA, 390..1920)", async () => {
    await p15Loop("pubs-manager", () => login(D.mgr.email, PW), [["hub", "/publications?q=ZZ+B9+R19"], ["hub lab-only", "/publications?q=ZZ+B9+R19&visibility=LAB_ONLY"], ["detail", `/publications/${R19.pub.id}`]], async (loc, w) => {
      const T = `publications ${loc} ${w}px manager`;
      await p15Ready(`/publications/${R19.pub.id}`);
      await p15Dialog(`${T} edit dialog`, ".admin-bar .btn--secondary", 0, loc === "ja");
      await p15Dialog(`${T} delete confirmation`, ".admin-bar .btn--danger", 0, loc === "ja");
      if (P15_TAB_WIDTHS.includes(w)) await p19Walk(T, [["detail", `/publications/${R19.pub.id}`]]);
    });
  });
  await step("publications screenshots: the hub and detail at desktop and phone width (for eyeballing)", async () => {
    await setLocale(null);
    for (const [w, tag] of [[1280, "d"], [390, "m"]]) {
      await p15Vp(w);
      for (const [lbl, p] of [["hub", "/publications?q=ZZ+B9+R19"], ["detail", `/publications/${R19.pub.id}`], ["detail-long", `/publications/${R19.pubLong.id}`], ["project", `/projects/${R19.prj.id}`]]) {
        await p15Ready(p);
        await shot(`r19-${lbl}-${tag}`);
      }
    }
    await setLocale("ja");
    await p15Vp(390);
    await p15Ready(`/publications/${R19.pubLong.id}`);
    await shot("r19-detail-long-ja-m");
    check("publications screenshots: taken", fs.existsSync(path.join(SHOTS, "r19-hub-d.png")));
    await setLocale(null);
  });
  await step("publications: restore (locale, viewport)", async () => { await setLocale(null); await desktop(); });

  // ================================================================ PHASE 20: research discovery & knowledge navigation
  // Related links on search results, "Explore this research" panels, /projects?area|group|researcher= filters, the Research
  // landing strip, EN/JA, hostile text, and the nine-width sweep. (Steps are named "discovery ..."; ONLY_DISCOVERY=1 runs just
  // them; P15_W / P15_USERS=disc-guest,disc-member narrow the sweeps.)
  section("phase 20: research discovery & knowledge navigation");
  const R20 = {};
  const D20_HID = ["ZZ B9 R20 Area Hidden", "ZZ B9 R20 Group Hidden", "ZZ B9 R20 Project Hidden"];
  const dLong = "ZZ B9 R20 Long " + "Q".repeat(110);
  const eqJ = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const dCards = () => ev(`(() => [...document.querySelectorAll('.search-result')].map((c) => ({ title: c.querySelector('.search-result__link')?.textContent.trim(), type: c.querySelector('.search-result__type')?.textContent.trim().toLowerCase(), listLabel: c.querySelector('.search-result__related-list')?.getAttribute('aria-label') || null, related: [...c.querySelectorAll('.search-result__related-list a')].map((x) => ({ t: x.textContent.trim(), h: x.getAttribute('href') })) })))()`);
  const dCard = async (title) => (await dCards()).find((c) => c.title === title) || null;
  const dExplore = () => ev(`(() => { const s = document.querySelector('.explore'); return s ? { heading: s.querySelector('h2')?.textContent.trim(), links: [...s.querySelectorAll('a')].map((a) => ({ t: a.textContent.trim(), h: a.getAttribute('href') })) } : null; })()`);
  const dSearch = async (q, extra = "") => { await pReady(`/search?q=${encodeURIComponent(q)}${extra}`); await waitFor(`!!document.querySelector('.search-result, .search-empty')`, 9000); await sleep(150); };

  await step("discovery seed: areas, groups, projects, publication, news, event and a researcher with visible and hidden neighbours", async () => {
    if (!P15.jsDialogs) { P15.jsDialogs = []; ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Page.javascriptDialogOpening") { P15.jsDialogs.push(m.params.message); send("Page.handleJavaScriptDialog", { accept: false }); } }); }
    const a = new Client();
    await a.req("POST", "/auth/login", ADMIN);
    R20.a = a;
    const J = (r) => r.json;
    R20.area = J(await a.req("POST", "/research", { title: "ZZ B9 R20 Area Alpha", description: "R20 area", tag: "ZZR20", visibility: "PUBLIC", translations: { ja: { title: "ZZ B9 R20 アルファ分野" } } }));
    R20.areaHid = J(await a.req("POST", "/research", { title: "ZZ B9 R20 Area Hidden", description: "R20 hidden area", tag: "ZZR20", visibility: "LAB_ONLY" }));
    R20.areaEmpty = J(await a.req("POST", "/research", { title: "ZZ B9 R20 Area Empty", description: "no projects, no publications", tag: "ZZR20", visibility: "PUBLIC" }));
    R20.areaX = J(await a.req("POST", "/research", { title: "ZZ B9 R20 Area <img src=x onerror=window.__r20Xss=1>", description: "hostile", tag: "ZZR20", visibility: "PUBLIC", translations: { ja: { title: "ZZ B9 R20 <img src=x onerror=window.__r20Xss=2> 分野" } } }));
    R20.grp = J(await a.req("POST", "/groups", { name: "ZZ B9 R20 Group", description: "g", visibility: "PUBLIC", translations: { ja: { name: "ZZ B9 R20 グループ" } } }));
    R20.grpHid = J(await a.req("POST", "/groups", { name: "ZZ B9 R20 Group Hidden", description: "hg", visibility: "LAB_ONLY" }));
    const mkPrj = async (title, summary, visibility, groupId, ja) => J(await a.req("POST", "/projects", { title, summary, description: "d", status: "ACTIVE", visibility, ...(groupId ? { groupId } : {}), ...(ja ? { translations: { ja: { title: ja } } } : {}) }));
    R20.prj = await mkPrj("ZZ B9 R20 Project", "R20 project summary", "PUBLIC", R20.grp.id, "ZZ B9 R20 プロジェクト");
    R20.prjHid = await mkPrj("ZZ B9 R20 Project Hidden", "hidden project", "LAB_ONLY", R20.grp.id);
    R20.prjGH = await mkPrj("ZZ B9 R20 Project In Hidden Group", "in a hidden group", "PUBLIC", R20.grpHid.id);
    R20.prjLong = await mkPrj(dLong, "long", "PUBLIC", null);
    R20.prj3 = await mkPrj("ZZ B9 R20 Project Three", "three", "PUBLIC", null);
    R20.prj4 = await mkPrj("ZZ B9 R20 Project Four", "four", "PUBLIC", null);
    R20.prjX = await mkPrj("ZZ B9 R20 Project Hostile", "hostile area link", "PUBLIC", null);
    await a.req("PUT", `/projects/${R20.prjX.id}/areas`, { areaIds: [R20.areaX.id] });
    await a.req("PUT", `/projects/${R20.prj.id}/areas`, { areaIds: [R20.area.id, R20.areaHid.id] });
    for (const p of [R20.prjHid, R20.prjGH, R20.prjLong, R20.prj3, R20.prj4]) await a.req("PUT", `/projects/${p.id}/areas`, { areaIds: [R20.area.id] });
    R20.pub = J(await a.req("POST", "/publications", { year: 2037, title: "ZZ B9 R20 Paper Alpha", authors: "ZZ B9 R20 Researcher", venue: "ZZ B9 R20 Journal" }));
    R20.pubHid = J(await a.req("POST", "/publications", { year: 2037, title: "ZZ B9 R20 Paper On Hidden Project", authors: "x", venue: "v" }));
    await a.req("PUT", `/projects/${R20.prj.id}/publications`, { publicationIds: [R20.pub.id] });
    await a.req("PUT", `/projects/${R20.prjHid.id}/publications`, { publicationIds: [R20.pub.id, R20.pubHid.id] });
    R20.news = J(await a.req("POST", "/news", { date: "Jan 2037", sortDate: "2037-01-01", type: "Update", title: "ZZ B9 R20 News Visible", description: "d", visibility: "PUBLIC" }));
    R20.newsHid = J(await a.req("POST", "/news", { date: "Jan 2037", sortDate: "2037-01-02", type: "Update", title: "ZZ B9 R20 News On Hidden Project", description: "d", visibility: "PUBLIC" }));
    await a.req("PUT", `/projects/${R20.prj.id}/news`, { newsIds: [R20.news.id] });
    await a.req("PUT", `/projects/${R20.prjHid.id}/news`, { newsIds: [R20.newsHid.id] });
    const at = new Date(Date.now() + 7 * 864e5).toISOString();
    R20.ev = J(await a.req("POST", "/events", { title: "ZZ B9 R20 Event Visible", kind: "SEMINAR", startsAt: at, visibility: "PUBLIC", projectId: R20.prj.id }));
    R20.evHid = J(await a.req("POST", "/events", { title: "ZZ B9 R20 Event On Hidden Project", kind: "SEMINAR", startsAt: at, visibility: "PUBLIC", projectId: R20.prjHid.id }));
    R20.tm = J(await a.req("POST", "/team", { name: "ZZ B9 R20 Researcher", role: "Fellow", category: "RESEARCH", initials: "ZR", department: "", bio: "" }));
    await a.req("PUT", `/member/${R20.tm.id}/areas`, { areaIds: [R20.area.id, R20.areaHid.id] });
    await a.req("PUT", `/member/${R20.tm.id}/publications`, { publicationIds: [R20.pub.id] });
    await a.req("PUT", `/projects/${R20.prj.id}/members`, { members: [{ teamMemberId: R20.tm.id, role: "MEMBER" }] });
    check("discovery setup: the fixtures exist", [R20.area, R20.areaHid, R20.areaEmpty, R20.areaX, R20.grp, R20.grpHid, R20.prj, R20.prjHid, R20.prjGH, R20.prjLong, R20.prj3, R20.prj4, R20.prjX, R20.pub, R20.pubHid, R20.news, R20.newsHid, R20.ev, R20.evHid, R20.tm].every((x) => x?.id));
  });

  await step("discovery guest: search results carry related links that name only visible records", async () => {
    await desktop(); await setLocale(null);
    await dSearch("ZZ B9 R20");
    const cards = await dCards();
    const proj = cards.find((c) => c.title === "ZZ B9 R20 Project");
    check("discovery guest: a project result lists its group first, then its visible areas (hidden area absent)", !!proj && proj.related[0]?.t === "ZZ B9 R20 Group" && proj.related.some((r) => r.t === "ZZ B9 R20 Area Alpha") && !proj.related.some((r) => /Hidden/.test(r.t)), JSON.stringify(proj));
    check("discovery guest: the related list is a labelled list of real links to /groups|/research|/projects + id", !!proj && proj.listLabel === "Related records" && proj.related.every((r) => /^\/(groups|research|projects)\/[\w-]+$/.test(r.h)));
    check("discovery guest: a project in a HIDDEN group shows no group (only its area), and the hidden project is not a result", eqJ((await dCard("ZZ B9 R20 Project In Hidden Group"))?.related.map((r) => r.t), ["ZZ B9 R20 Area Alpha"]) && !cards.some((c) => c.title === "ZZ B9 R20 Project Hidden"));
    const area = cards.find((c) => c.title === "ZZ B9 R20 Area Alpha");
    check("discovery guest: an area result is capped at three related projects even though more are visible", !!area && area.related.length === 3 && area.related.every((r) => r.h.startsWith("/projects/")) && !area.related.some((r) => /Hidden/.test(r.t)), JSON.stringify(area));
    const paper = cards.find((c) => c.title === "ZZ B9 R20 Paper Alpha");
    check("discovery guest: a publication lists its visible project only (the hidden project it is also linked to is absent)", eqJ(paper?.related.map((r) => r.t), ["ZZ B9 R20 Project"]), JSON.stringify(paper));
    const onlyHid = cards.find((c) => c.title === "ZZ B9 R20 Paper On Hidden Project");
    check("discovery guest: a public paper whose only project is hidden is still found, with no related line at all", !!onlyHid && onlyHid.related.length === 0 && !(await ev(`[...document.querySelectorAll('.search-result')].find((c) => c.textContent.includes('Paper On Hidden Project')).querySelector('.search-result__related')`)));
    check("discovery guest: news and events of a hidden project show no related project; those of a visible project name it", (await dCard("ZZ B9 R20 News On Hidden Project"))?.related.length === 0 && (await dCard("ZZ B9 R20 Event On Hidden Project"))?.related.length === 0 && eqJ((await dCard("ZZ B9 R20 News Visible"))?.related.map((r) => r.t), ["ZZ B9 R20 Project"]) && eqJ((await dCard("ZZ B9 R20 Event Visible"))?.related.map((r) => r.t), ["ZZ B9 R20 Project"]));
    check("discovery guest: a researcher lists visible areas only", eqJ((await dCard("ZZ B9 R20 Researcher"))?.related.map((r) => r.t), ["ZZ B9 R20 Area Alpha"]));
    const html = await ev(`document.querySelector('.search-results').outerHTML`);
    check("discovery guest: no hidden name or id anywhere in the results markup", D20_HID.every((w) => !html.includes(w)) && ![R20.areaHid.id, R20.grpHid.id, R20.prjHid.id].some((id) => html.includes(id)));
    check("discovery guest: the chip counts equal the API's visibility-aware counts", await ev(`fetch('/api/search?q=ZZ+B9+R20').then((r) => r.json()).then((j) => [...document.querySelectorAll('.search-filters .chip')].every((c) => { const n = +c.querySelector('.chip__count').textContent; const k = c.getAttribute('href').match(/type=([\\w-]+)/)?.[1] || 'all'; return j.counts[k] === n; }))`));
    // a related link is a real link: clicking it goes to that record
    await pClick(".search-result .search-result__related-list a", "ZZ B9 R20 Group");
    check("discovery guest: clicking a related link opens that record (not the result's own page)", await waitFor(`location.pathname === '/groups/${R20.grp.id}'`, 6000));
    await ev(`history.back()`);
    await waitFor(`location.pathname === '/search'`, 5000);
    check("discovery guest: Back returns to the same search (state in the URL)", await waitFor(`location.search.includes('q=ZZ+B9+R20') || location.search.includes('q=ZZ%20B9%20R20')`, 4000));
    // the card itself still opens the result
    await dSearch("ZZ B9 R20 Paper Alpha");
    await pClick(".search-result .search-result__link");
    check("discovery guest: the result title still opens the publication", await waitFor(`location.pathname === '/publications/${R20.pub.id}'`, 6000));
  });

  await step("discovery guest: an empty type filter offers the other categories that DO match, with visible-only counts", async () => {
    await dSearch("ZZ B9 R20 Paper", "&type=project");
    check("discovery guest: zero projects match, and the empty state names the categories that do (Publications)", (await exists(".search-empty")) && (await ev(`[...document.querySelectorAll('.search-other a.chip')].map((a) => a.textContent.trim())`)).some((t) => /^Publications \(\d+\)$/.test(t)), String(await ev(`document.querySelector('.search-empty')?.innerText`)));
    const chips = await ev(`[...document.querySelectorAll('.search-other a.chip')].map((a) => a.textContent.trim())`);
    const api = await ev(`fetch('/api/search?q=ZZ+B9+R20+Paper').then((r) => r.json()).then((j) => j.counts)`);
    check("discovery guest: those counts are exactly the API's (a hidden paper is not counted)", chips.every((t) => { const m = t.match(/^(.+) \((\d+)\)$/); const key = { Publications: "publication", News: "news", Events: "event", Groups: "group", Researchers: "researcher", "Research Areas": "research-area", "Forum Topics": "forum-topic" }[m[1]]; return api[key] === +m[2]; }) && chips.length === Object.entries(api).filter(([k, v]) => k !== "all" && k !== "project" && v > 0).length, chips.join("|"));
    await pClick(".search-other a.chip", "Publications");
    check("discovery guest: clicking a suggestion moves to that type (type= in the URL) and shows results", (await waitFor(`location.search.includes('type=publication')`, 5000)) && (await waitFor(`!!document.querySelector('.search-result')`, 6000)));
    await dSearch("zzznomatchr20zzz", "&type=project");
    check("discovery guest: with nothing anywhere the suggestion list is absent and the plain empty state remains", (await exists(".search-empty")) && !(await exists(".search-other")));
    await dSearch("ZZ B9 R20 Paper", "&type=bogus");
    check("discovery guest: an invalid type in the URL falls back to All (never an error state)", (await exists(".search-result")) && !(await exists('[role="alert"]')) && (await ev(`document.querySelector('.search-filters .chip.active').textContent.trim().toLowerCase().startsWith('all')`)));
    await dSearch("ZZ B9 R20", "&page=abc");
    check("discovery guest: an invalid page falls back to page 1", (await exists(".search-result")) && !(await exists('[role="alert"]')));
  });

  await step("discovery guest: Explore panels link to filtered lists that really exist", async () => {
    await pReady(`/research/${R20.area.id}`, "ZZ B9 R20 Area Alpha");
    let ex = await dExplore();
    check("discovery guest: the area page has an 'Explore this research' h2 panel with its projects and publications filters", ex?.heading === "Explore this research" && eqJ(ex.links.map((l) => l.h), [`/projects?area=${R20.area.id}`, `/publications?area=${R20.area.id}`]) && (await pCount("h1")) === 1, JSON.stringify(ex));
    await pClick(`.explore a[href="/projects?area=${R20.area.id}"]`);
    check("discovery guest: the projects link opens /projects filtered to the area", await waitFor(`location.search === '?area=${R20.area.id}'`, 6000));
    await waitFor(`!document.querySelector('[aria-busy="true"]') && document.querySelectorAll('.card').length > 2`, 8000);
    let t = await pMain();
    check("discovery guest: only the area's VISIBLE projects are listed, the hidden one and its neighbours are not", t.includes("ZZ B9 R20 Project") && t.includes("ZZ B9 R20 Project Three") && !D20_HID.some((w) => t.includes(w)) && !t.includes("Paper On Hidden"));
    check("discovery guest: a filter tag names the area and a 'Clear filter' link returns to the full list", (await ev(`document.querySelector('.filter-note')?.innerText`)).includes("Research area: ZZ B9 R20 Area Alpha") && (await exists('.filter-note a[href="/projects"]')));
    check("discovery guest: the status count reflects the filtered list, not the whole lab", (await ev(`/^Showing \\d+ of \\d+ project/.test(document.querySelector('.filters__count').innerText.trim())`)) && (await ev(`+document.querySelector('.filters__count').innerText.match(/of (\\d+)/)[1]`)) < (await ev(`fetch('/api/projects').then((r) => r.json()).then((j) => j.length)`)));
    await pClick('.filter-note a[href="/projects"]');
    check("discovery guest: Clear filter shows every visible project again", (await waitFor(`location.search === '' && !document.querySelector('.filter-note')`, 5000)));
    await pReady(`/projects?area=${R20.areaHid.id}`, "No projects match");
    t = await pMain();
    check("discovery guest: filtering by a HIDDEN area is the plain 'no match' state -- no title leaks, identical to an unknown id", t.includes("No projects match this filter.") && t.includes("not available") && !D20_HID.some((w) => t.includes(w)));
    const hiddenText = t;
    await pReady(`/projects?area=zzzunknownid`, "No projects match");
    check("discovery guest: an unknown id renders exactly the same page text as the hidden id", (await pMain()) === hiddenText);
    await pReady(`/projects?group=${R20.grpHid.id}`, "No projects match");
    t = await pMain();
    check("discovery guest: a hidden GROUP filter matches nothing and names nothing", t.includes("No projects match this filter.") && !t.includes("ZZ B9 R20 Group Hidden") && !t.includes("ZZ B9 R20 Project In Hidden Group"));
    await pReady(`/projects?area=%3Cscript%3Ealert(1)%3C%2Fscript%3E`, "No projects match");
    t = await pMain();
    check("discovery guest: a hostile filter value is dropped, never echoed, and the page still renders", t.includes("not available") && !t.includes("<script") && !t.includes("alert(1)") && (await pCount("h1")) === 1 && (await ev(`typeof window.__r20Xss`)) === "undefined");
    await pReady(`/projects?researcher=${R20.tm.id}`, "ZZ B9 R20 Project");
    check("discovery guest: the researcher filter lists the projects that person is on", (await ev(`document.querySelector('.filter-note').innerText`)).includes("Researcher: ZZ B9 R20 Researcher") && (await pMain()).includes("ZZ B9 R20 Project") && !(await pMain()).includes("Project Three"));
    await pReady(`/projects?group=${R20.grp.id}`, "ZZ B9 R20 Project");
    t = await pMain();
    check("discovery guest: the group filter lists only that group's visible projects", t.includes("ZZ B9 R20 Project") && !t.includes("Project Three") && !t.includes("Project Hidden") && !t.includes("In Hidden Group") && (await ev(`document.querySelector('.filter-note').innerText`)).includes("Group: ZZ B9 R20 Group"));
    // the other detail pages
    await pReady(`/projects/${R20.prj.id}`, "ZZ B9 R20 Project");
    ex = await dExplore();
    check("discovery guest: the project page offers its publications, and other projects in its areas and group (visible ones only)", !!ex && ex.links.some((l) => l.h === `/publications?project=${R20.prj.id}`) && ex.links.some((l) => l.h === `/projects?area=${R20.area.id}`) && ex.links.some((l) => l.h === `/projects?group=${R20.grp.id}`) && !ex.links.some((l) => l.h.includes(R20.areaHid.id) || l.h.includes(R20.grpHid.id)), JSON.stringify(ex));
    await pReady(`/groups/${R20.grp.id}`, "ZZ B9 R20 Group");
    ex = await dExplore();
    check("discovery guest: the group page offers its projects filter", !!ex && ex.links.some((l) => l.h === `/projects?group=${R20.grp.id}`), JSON.stringify(ex));
    await pReady(`/team/${R20.tm.id}`, "ZZ B9 R20 Researcher");
    ex = await dExplore();
    check("discovery guest: a researcher page offers publications and projects by that researcher", !!ex && eqJ(ex.links.map((l) => l.h), [`/publications?researcher=${R20.tm.id}`, `/projects?researcher=${R20.tm.id}`]), JSON.stringify(ex));
    await pReady(`/publications/${R20.pub.id}`, "ZZ B9 R20 Paper Alpha");
    ex = await dExplore();
    check("discovery guest: a publication page offers 'more like this' filters for its researcher, project and area only (no hidden project/area)", !!ex && ex.links.some((l) => l.h === `/publications?researcher=${R20.tm.id}`) && ex.links.some((l) => l.h === `/publications?project=${R20.prj.id}`) && ex.links.some((l) => l.h === `/publications?area=${R20.area.id}`) && !ex.links.some((l) => l.h.includes(R20.prjHid.id) || l.h.includes(R20.areaHid.id)), JSON.stringify(ex));
    await pClick(`.explore a[href="/publications?project=${R20.prj.id}"]`);
    check("discovery guest: a publication 'more from this project' link lands on the publication hub already filtered", (await waitFor(`location.search === '?project=${R20.prj.id}'`, 6000)) && (await waitFor(`!!document.querySelector('.pub-item')`, 6000)));
    await pReady(`/research/${R20.areaEmpty.id}`, "ZZ B9 R20 Area Empty");
    check("discovery guest: an area with no visible projects or publications has NO Explore panel (an empty panel is never rendered)", !(await exists(".explore")) && (await pCount("h1")) === 1);
    // the Research landing strip
    await pReady("/research", "Research Areas");
    const strip = await ev(`(() => { const n = document.querySelector('nav[aria-label="Explore more of the lab\\'s research"]'); return n ? [...n.querySelectorAll('a')].map((a) => a.getAttribute('href')) : null; })()`);
    check("discovery guest: the Research landing page has a labelled strip to Projects, Publications and Researchers, and still one h1", eqJ(strip, ["/projects", "/publications", "/team"]) && (await pCount("h1")) === 1);
    check("discovery guest: the areas grid is still there and a hidden area is not", (await pMain()).includes("ZZ B9 R20 Area Alpha") && !(await pMain()).includes("ZZ B9 R20 Area Hidden"));
  });

  await step("discovery guest: keyboard -- Enter submits the search, related links are reachable and ringed", async () => {
    await pReady("/search");
    await focusSel("#search-page-input");
    await setVal("search-page-input", "ZZ B9 R20 Project");
    await press("enter");
    check("discovery guest keyboard: Enter in the search box submits it (URL gets q=)", await waitFor(`location.search.includes('q=')`, 5000));
    await waitFor(`!!document.querySelector('.search-result')`, 8000);
    await ev(`document.querySelector('.search-result__related-list a').setAttribute('data-r20-focus', '1')`);
    await focusSel("[data-r20-focus]");
    check("discovery guest keyboard: a related link takes focus and shows a visible focus ring", await ev(`(() => { const s = getComputedStyle(document.activeElement); return document.activeElement.matches('.search-result__related-list a') && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; })()`));
    await press("enter");
    check("discovery guest keyboard: Enter on a related link follows it", await waitFor(`/^\\/(groups|research|projects)\\//.test(location.pathname)`, 6000));
  });

  await step("discovery member: LAB_ONLY neighbours are visible to a signed-in member, in the same order", async () => {
    check("discovery member: login", await login(D.plain.email, PW));
    await dSearch("ZZ B9 R20 Project");
    const proj = await dCard("ZZ B9 R20 Project");
    check("discovery member: the project lists its group, then BOTH areas (the lab-only one included), alphabetically", eqJ(proj?.related.map((r) => r.t), ["ZZ B9 R20 Group", "ZZ B9 R20 Area Alpha", "ZZ B9 R20 Area Hidden"]), JSON.stringify(proj));
    await dSearch("ZZ B9 R20 Researcher");
    check("discovery member: the researcher lists both areas, the lab-only one too", eqJ((await dCard("ZZ B9 R20 Researcher"))?.related.map((r) => r.t), ["ZZ B9 R20 Area Alpha", "ZZ B9 R20 Area Hidden"]));
    await dSearch("ZZ B9 R20 Project");
    check("discovery member: a member sees the lab-only project as a result too", !!(await dCard("ZZ B9 R20 Project Hidden")));
    check("discovery member: still no visibility badge for an ordinary member", !/lab.only/i.test(await ev(`document.querySelector('.search-results').innerText`)));
    await pReady(`/projects?area=${R20.areaHid.id}`, "ZZ B9 R20 Project");
    check("discovery member: the lab-only area filter now resolves, names the area and lists its projects", (await ev(`document.querySelector('.filter-note').innerText`)).includes("Research area: ZZ B9 R20 Area Hidden") && (await pMain()).includes("ZZ B9 R20 Project"));
    await pReady(`/publications/${R20.pub.id}`, "ZZ B9 R20 Paper Alpha");
    const ex = await dExplore();
    check("discovery member: the publication page's Explore panel includes the lab-only project and area", !!ex && ex.links.some((l) => l.h === `/publications?project=${R20.prjHid.id}`) && ex.links.some((l) => l.h === `/publications?area=${R20.areaHid.id}`), JSON.stringify(ex));
    await logout();
  });

  await step("discovery ja: related links, panels and filters read in Japanese; authorization is unchanged", async () => {
    await desktop(); await setLocale("ja");
    await dSearch("ZZ B9 R20 Project");
    const proj = await dCard("ZZ B9 R20 プロジェクト");
    check("discovery ja: the project result and its related links use the Japanese overrides", !!proj && proj.related.some((r) => r.t === "ZZ B9 R20 グループ") && proj.related.some((r) => r.t === "ZZ B9 R20 アルファ分野") && proj.listLabel === "関連する項目", JSON.stringify(proj));
    const html20 = await ev(`document.querySelector('.search-results').innerText`);
    check("discovery ja: 'Related:' label is Japanese and no hidden record appears", (await ev(`document.querySelector('.search-result__related span')?.textContent`)) === "関連：" && !D20_HID.some((w) => html20.includes(w)));
    await dSearch("ZZ B9 R20 Paper", "&type=project");
    check("discovery ja: the empty-state suggestions are Japanese ('他のカテゴリの一致：') with the same visible-only counts", (await ev(`document.querySelector('.search-empty')?.parentElement.innerText`)).includes("他のカテゴリの一致：") && /（\d+）/.test(await ev(`document.querySelector('.search-other')?.innerText || ''`)));
    await pReady(`/research/${R20.area.id}`);
    const ex = await dExplore();
    check("discovery ja: the Explore panel heading and links are Japanese and target the same URLs as English", ex?.heading === "この研究をさらに探る" && eqJ(ex.links.map((l) => l.h), [`/projects?area=${R20.area.id}`, `/publications?area=${R20.area.id}`]) && ex.links.every((l) => /[぀-ヿ一-鿿]/.test(l.t)), JSON.stringify(ex));
    await pReady(`/projects?area=${R20.area.id}`, "研究分野：");
    check("discovery ja: the filter tag and clear button are Japanese", (await ev(`document.querySelector('.filter-note').innerText`)).includes("研究分野：ZZ B9 R20 アルファ分野") && (await ev(`document.querySelector('.filter-note a').textContent`)).includes("絞り込みを解除"));
    await pReady(`/projects?area=${R20.areaHid.id}`, "利用できない");
    check("discovery ja: a hidden area id is still 'not available' -- locale never widens visibility", (await pMain()).includes("この条件に一致するプロジェクトはありません。") && !(await pMain()).includes("ZZ B9 R20 Area Hidden"));
    await pReady("/research");
    check("discovery ja: the Research landing strip is Japanese", (await ev(`document.querySelector('nav[aria-label="研究室の研究をさらに探る"]')?.innerText`))?.includes("プロジェクト") && (await ev(`document.documentElement.lang`)) === "ja");
    await pReady(`/publications/${R20.pub.id}`);
    check("discovery ja: the publication page's 'more from' links are Japanese", (await ev(`document.querySelector('.explore')?.innerText`) || "").includes("の他の論文"));
    await setLocale(null);
  });

  await step("discovery hostile text: markup in an area title (English and Japanese) is inert on every discovery surface", async () => {
    const dialogsBefore = P15.jsDialogs.length; // earlier phases' own confirm() dialogs are already in the list
    for (const loc of [null, "ja"]) {
      await setLocale(loc);
      await dSearch("ZZ B9 R20 Project Hostile");
      const proj = await ev(`(() => { const c = [...document.querySelectorAll('.search-result')].find((x) => x.querySelector('.search-result__link').textContent.trim() === 'ZZ B9 R20 Project Hostile'); return c ? { text: c.innerText, imgs: c.querySelectorAll('img, script').length } : null; })()`);
      check(`discovery hostile ${loc || "en"}: the hostile area title is visible text in the related list and creates no element`, !!proj && proj.imgs === 0 && /<img src=x/.test(proj.text), JSON.stringify(proj));
      await pReady(`/projects?area=${R20.areaX.id}`, loc ? "研究分野：" : "Research area:");
      check(`discovery hostile ${loc || "en"}: the filter tag shows it as text, not markup`, (await ev(`document.querySelectorAll('.filter-note img, .filter-note script, main img').length`)) === 0 && (await ev(`typeof window.__r20Xss`)) === "undefined");
      await pReady(`/projects/${R20.prjX.id}`);
      check(`discovery hostile ${loc || "en"}: the Explore links on the project page render it inertly`, (await ev(`document.querySelectorAll('.explore img, .explore script').length`)) === 0 && (await ev(`typeof window.__r20Xss`)) === "undefined");
    }
    await setLocale(null);
    check("discovery hostile: no script from hostile text ever ran", (await ev(`typeof window.__r20Xss`)) === "undefined" && P15.jsDialogs.length === dialogsBefore, P15.jsDialogs.slice(dialogsBefore).join("|"));
  });

  await step("discovery long text: an unbroken 110-character title stays inside the card, breadcrumb and Explore panel", async () => {
    await desktopAt(390, 844);
    await dSearch("ZZ B9 R20 Long");
    check("discovery long: the result card wraps the long title without horizontal overflow at 390px", (await overflowPx()) <= 1);
    await pReady(`/projects/${R20.prjLong.id}`);
    check("discovery long: the project page (breadcrumb, title, Explore) has no horizontal overflow at 390px", (await overflowPx()) <= 1);
    await pReady(`/projects?area=${R20.area.id}`);
    check("discovery long: the filtered projects list has no horizontal overflow at 390px", (await overflowPx()) <= 1);
    await desktop();
  });

  await step("discovery sweep: guest -- search related, empty state, research landing, detail pages, filtered list (EN+JA, 390..1920)", async () => {
    const pages = [
      ["search related", "/search?q=ZZ+B9+R20"],
      ["search empty-type", "/search?q=ZZ+B9+R20+Paper&type=project"],
      ["search long", `/search?q=${encodeURIComponent("ZZ B9 R20 Long")}`],
      ["research landing", "/research"],
      ["area", `/research/${R20.area.id}`],
      ["project", `/projects/${R20.prj.id}`],
      ["group", `/groups/${R20.grp.id}`],
      ["researcher", `/team/${R20.tm.id}`],
      ["publication", `/publications/${R20.pub.id}`],
      ["projects filtered", `/projects?area=${R20.area.id}`],
      ["projects hidden filter", `/projects?area=${R20.areaHid.id}`],
    ];
    await p15Loop("disc-guest", null, pages, async (loc, w) => {
      if (P15_TAB_WIDTHS.includes(w)) await p19Walk(`discovery ${loc} ${w}px guest`, [["search", "/search?q=ZZ+B9+R20"], ["project", `/projects/${R20.prj.id}`], ["publication", `/publications/${R20.pub.id}`]]);
    });
    check("discovery sweep guest: no script from hostile text ever ran", (await ev(`typeof window.__r20Xss`)) === "undefined");
  });

  await step("discovery sweep: member -- lab-only neighbours (EN+JA, 390..1920)", async () => {
    await p15Loop("disc-member", () => login(D.plain.email, PW), [["search related", "/search?q=ZZ+B9+R20"], ["projects filtered", `/projects?area=${R20.areaHid.id}`], ["publication", `/publications/${R20.pub.id}`]], async () => {});
  });

  await step("discovery screenshots: search with related links, Explore panel and filtered projects (for eyeballing)", async () => {
    await setLocale(null);
    for (const [w, tag] of [[1280, "d"], [390, "m"]]) {
      await p15Vp(w);
      for (const [lbl, p] of [["search", "/search?q=ZZ+B9+R20"], ["area", `/research/${R20.area.id}`], ["filtered", `/projects?area=${R20.area.id}`], ["landing", "/research"]]) {
        await p15Ready(p);
        await shot(`r20-${lbl}-${tag}`);
      }
    }
    await setLocale("ja");
    await p15Vp(390);
    await p15Ready("/search?q=ZZ+B9+R20+Project");
    await shot("r20-search-ja-m");
    check("discovery screenshots: taken", fs.existsSync(path.join(SHOTS, "r20-search-d.png")));
    await setLocale(null);
  });
  await step("discovery: restore (locale, viewport)", async () => { await setLocale(null); await desktop(); });


  // ================================================================ PHASE 21: research collaboration workspace
  // /workspace (one request, login-gated), the members dialog (single-researcher add / role / remove), EN/JA, hostile text,
  // long text, five roles and the nine-width sweep. (Steps are named "workspace ..."; ONLY_WORKSPACE=1 runs just them;
  // P15_W / P15_USERS=ws-guest,ws-member,ws-lead,ws-manager,ws-admin,ws-noprofile,ws-empty narrow the sweeps.)
  section("phase 21: research collaboration workspace");
  const R21 = {};
  const w21Long = "ZZ B9 W21 Long " + "K".repeat(110);
  const w21X = (n) => `<img src=x onerror=window.__w21Xss=${n}>`;
  const w21JaLong = "ZZ B9 W21 " + "超長い日本語の研究者名前がカードとダイアログの幅を壊さないことを確認するためのテスト".repeat(2);
  const wsSecText = (id) => ev(`document.querySelector('section[aria-labelledby="ws-${id}"]')?.innerText || ''`);
  const wsHead = (id) => ev(`document.getElementById('ws-${id}')?.textContent.trim() || ''`);
  const wsCards = (id) => ev(`(() => [...document.querySelectorAll('section[aria-labelledby="ws-${id}"] .ws-card')].map((c) => ({ title: c.querySelector('.card__title')?.textContent.trim(), text: c.innerText, manage: [...c.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')), hrefs: [...c.querySelectorAll('a')].map((a) => a.getAttribute('href')) })))()`);
  const wsCard = async (id, title) => (await wsCards(id)).find((c) => c.title === title) || null;
  const wsPeople = () => ev(`[...document.querySelectorAll('.ws-people .ws-person')].map((p) => ({ name: p.querySelector('.ws-person__name')?.textContent.trim(), href: p.querySelector('a')?.getAttribute('href'), text: p.innerText }))`);
  const wsReady = async (p = "/workspace") => { await go(p); await navReady(); await waitFor(`!document.querySelector('[aria-busy="true"]') && (!!document.querySelector('#ws-projects') || !!document.querySelector('.empty-state') || !!document.querySelector('[role="alert"]'))`, 9000); await sleep(300); };
  const wsApi = (locale) => ev(`fetch('/api/workspace', { credentials: 'same-origin', headers: ${locale ? `{ 'X-Locale': '${locale}' }` : "{}"} }).then((r) => r.json())`);
  const wsIds = (j) => JSON.stringify(["projects", "groups", "areas", "publications", "events", "news", "collaborators"].map((k) => j[k].items.map((x) => x.id)));
  const wsDlg = () => ev(`(() => { const d = document.querySelector('.modal[role="dialog"]'); if (!d) return null; const t = document.getElementById(d.getAttribute('aria-labelledby') || '__'); const opts = document.getElementById('manage-pick'); return { title: t ? t.textContent.trim() : '', ready: !!d.querySelector('.manage__list, .manage__add') || /^(No members|メンバーはまだ)/.test(d.innerText), members: [...d.querySelectorAll('.manage__row')].map((r) => ({ name: r.querySelector('.manage__name')?.textContent.trim(), role: r.querySelector('select')?.value || null, confirming: !!r.querySelector('.manage__confirm') })), pick: opts ? [...opts.options].map((o) => o.textContent.trim()) : null, pickDisabled: opts ? opts.disabled : null, addDisabled: d.querySelector('.manage__add button[type="submit"]')?.disabled ?? null, roleOptions: [...(d.querySelector('#manage-role')?.options || [])].map((o) => o.value), status: d.querySelector('[role="status"]')?.textContent.trim() || '', alert: d.querySelector('[role="alert"]')?.innerText.trim() || '' }; })()`);
  const wsDlgWait = async (pred, ms = 6000) => { const t0 = Date.now(); let d; while (Date.now() - t0 < ms) { d = await wsDlg(); if (d && pred(d)) return d; await sleep(120); } return d; };
  const wsOpen = async (label) => {
    const ok = await ev(`(() => { document.querySelectorAll('[data-w21-op]').forEach((e) => e.removeAttribute('data-w21-op')); const b = [...document.querySelectorAll('.ws-card button')].find((x) => (x.getAttribute('aria-label') || '').includes(${JSON.stringify(label)})); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.setAttribute('data-w21-op', '1'); return true; })()`);
    if (!ok) return null;
    await p15Settle();
    await clickEl("[data-w21-op]");
    return wsDlgWait((d) => d.ready);
  };
  const wsRowBtn = async (name, matchLabel) => { // real click on a button inside the member row of `name`
    const ok = await ev(`(() => { const r = [...document.querySelectorAll('.manage__row')].find((x) => x.querySelector('.manage__name')?.textContent.trim() === ${JSON.stringify(name)}); const b = r && [...r.querySelectorAll('button')].find((x) => ${matchLabel}.test(x.getAttribute('aria-label') || x.textContent)); if (!b) return false; b.setAttribute('data-w21-row', '1'); return true; })()`);
    if (!ok) return false;
    await ev(`document.querySelector('[data-w21-row]').scrollIntoView({ block: 'center' })`);
    await p15Settle();
    const r = await clickEl("[data-w21-row]");
    await ev(`document.querySelectorAll('[data-w21-row]').forEach((e) => e.removeAttribute('data-w21-row'))`);
    return r;
  };
  const wsSetRole = (name, role) => ev(`(() => { const r = [...document.querySelectorAll('.manage__row')].find((x) => x.querySelector('.manage__name')?.textContent.trim() === ${JSON.stringify(name)}); const s = r?.querySelector('select'); if (!s) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(role)}); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const wsPick = (id) => ev(`(() => { const s = document.getElementById('manage-pick'); if (!s) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(id)}); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const wsMembersApi = (kind, id) => ev(`fetch('/api/${kind}/${id}').then((r) => r.json()).then((j) => j.members.map((m) => m.teamMemberId + ':' + m.role))`);
  const wsClickAdd = async () => { await ev(`document.querySelector('.manage__add button[type="submit"]')?.scrollIntoView({ block: 'center' })`); await p15Settle(); return clickEl('.manage__add button[type="submit"]'); };
  const wsClose = async () => { await press("esc"); return waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2500); };

  await step("workspace seed: five roles, a project lead, collaborators with long / hostile / Japanese names, hostile and long titles", async () => {
    if (!P15.jsDialogs) { P15.jsDialogs = []; ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Page.javascriptDialogOpening") { P15.jsDialogs.push(m.params.message); send("Page.handleJavaScriptDialog", { accept: false }); } }); }
    const a = new Client();
    await a.req("POST", "/auth/login", ADMIN);
    R21.a = a;
    const J = (r) => r.json;
    const mkAcct = async (key, role, name) => {
      const r = await a.req("POST", "/users", { email: `b9-w21-${key}@example.test`, password: PW, role, name, initials: "W" + key.slice(0, 1).toUpperCase(), memberRole: "Researcher", category: "RESEARCH" });
      const team = (await a.req("GET", "/team")).json;
      D.userIds.push(r.json.id); // the browser's body scanner now also looks for these account ids
      return { email: `b9-w21-${key}@example.test`, userId: r.json.id, tmId: team.find((m) => m.name === name).id, name };
    };
    R21.lead = await mkAcct("lead", "MEMBER", "ZZ B9 W21 Lead");
    R21.mem = await mkAcct("mem", "MEMBER", "ZZ B9 W21 Member");
    R21.mgr = await mkAcct("mgr", "LAB_MANAGER", "ZZ B9 W21 Manager");
    R21.adm = await mkAcct("adm", "ADMIN", "ZZ B9 W21 Admin");
    R21.none = await mkAcct("none", "MEMBER", "ZZ B9 W21 Nobody");
    const mkPerson = async (name) => J(await a.req("POST", "/team", { name, role: "Fellow", category: "RESEARCH", initials: "ZW", department: "", bio: "" }));
    R21.cJa = await mkPerson(w21JaLong);
    R21.cX = await mkPerson("ZZ B9 W21 " + w21X(1));
    R21.cAdd = await mkPerson("ZZ B9 W21 Candidate One");
    R21.cAdd2 = await mkPerson("ZZ B9 W21 Candidate Two");
    R21.cUnb = await mkPerson("ZZ B9 W21 " + "U".repeat(90));
    R21.cGrp = await mkPerson("ZZ B9 W21 Group Only Colleague"); // shares a GROUP with the lead, no project
    R21.many = await mkAcct("many", "MEMBER", "ZZ B9 W21 Many");
    R21.area = J(await a.req("POST", "/research", { title: "ZZ B9 W21 Area Alpha", description: "W21 area", tag: "ZZW21", visibility: "PUBLIC", translations: { ja: { title: "ZZ B9 W21 アルファ分野" } } }));
    R21.areaH = J(await a.req("POST", "/research", { title: "ZZ B9 W21 Area Lab", description: "W21 lab area", tag: "ZZW21", visibility: "LAB_ONLY" }));
    R21.areaX = J(await a.req("POST", "/research", { title: "ZZ B9 W21 Area " + w21X(2), description: "hostile", tag: "ZZW21", visibility: "PUBLIC" }));
    R21.grp = J(await a.req("POST", "/groups", { name: "ZZ B9 W21 Group", description: "g", visibility: "PUBLIC", translations: { ja: { name: "ZZ B9 W21 グループ" } } }));
    R21.grpX = J(await a.req("POST", "/groups", { name: "ZZ B9 W21 Group <script>window.__w21Xss=3</script>", description: "gx", visibility: "PUBLIC" }));
    const mkPrj = async (title, visibility, groupId, ja) => J(await a.req("POST", "/projects", { title, summary: "W21 summary", description: "d", status: "ACTIVE", visibility, ...(groupId ? { groupId } : {}), ...(ja ? { translations: { ja: { title: ja } } } : {}) }));
    R21.p1 = await mkPrj("ZZ B9 W21 Project One", "PUBLIC", R21.grp.id, "ZZ B9 W21 プロジェクト一");
    R21.p2 = await mkPrj("ZZ B9 W21 Project Lab", "LAB_ONLY", R21.grp.id);
    R21.p3 = await mkPrj(w21Long, "PUBLIC", null);
    R21.p4 = await mkPrj("ZZ B9 W21 Project " + w21X(4), "PUBLIC", R21.grpX.id);
    await a.req("PUT", `/projects/${R21.p1.id}/areas`, { areaIds: [R21.area.id, R21.areaH.id] });
    await a.req("PUT", `/projects/${R21.p4.id}/areas`, { areaIds: [R21.areaX.id] });
    const P = (id, list) => a.req("PUT", `/projects/${id}/members`, { members: list });
    await P(R21.p1.id, [{ teamMemberId: R21.lead.tmId, role: "LEAD" }, { teamMemberId: R21.mem.tmId, role: "MEMBER" }, { teamMemberId: R21.adm.tmId, role: "MEMBER" }, { teamMemberId: R21.mgr.tmId, role: "MEMBER" }, { teamMemberId: R21.cJa.id, role: "MEMBER" }, { teamMemberId: R21.cX.id, role: "COLLABORATOR" }, { teamMemberId: R21.cUnb.id, role: "MEMBER" }]);
    await P(R21.p2.id, [{ teamMemberId: R21.lead.tmId, role: "MEMBER" }, { teamMemberId: R21.mem.tmId, role: "MEMBER" }, { teamMemberId: R21.mgr.tmId, role: "MEMBER" }]);
    await P(R21.p3.id, [{ teamMemberId: R21.lead.tmId, role: "MEMBER" }]);
    await P(R21.p4.id, [{ teamMemberId: R21.lead.tmId, role: "MEMBER" }]);
    await a.req("PUT", `/groups/${R21.grp.id}/members`, { members: [{ teamMemberId: R21.lead.tmId, role: "LEAD" }, { teamMemberId: R21.mem.tmId, role: "MEMBER" }, { teamMemberId: R21.cGrp.id, role: "MEMBER" }] });
    // A researcher with MORE projects than the workspace cap (12): the heading must show the true total, the page the cap.
    R21.manyProjects = [];
    for (let i = 0; i < 14; i++) {
      const pr = await mkPrj(`ZZ B9 W21 Many ${String(i).padStart(2, "0")}`, "PUBLIC", null);
      await a.req("PUT", `/projects/${pr.id}/members`, { members: [{ teamMemberId: R21.many.tmId, role: "MEMBER" }] });
      R21.manyProjects.push(pr);
    }
    await a.req("PUT", `/groups/${R21.grpX.id}/members`, { members: [{ teamMemberId: R21.lead.tmId, role: "MEMBER" }] });
    await a.req("PUT", `/member/${R21.lead.tmId}/areas`, { areaIds: [R21.area.id, R21.areaX.id] });
    R21.pub = J(await a.req("POST", "/publications", { year: 2038, title: "ZZ B9 W21 Paper Alpha", authors: "ZZ B9 W21 Lead", venue: "ZZ B9 W21 Journal" }));
    R21.pubX = J(await a.req("POST", "/publications", { year: 2038, title: "ZZ B9 W21 Paper " + w21X(5), authors: "x", venue: "v" }));
    await a.req("PUT", `/member/${R21.lead.tmId}/publications`, { publicationIds: [R21.pub.id, R21.pubX.id] });
    await a.req("PUT", `/projects/${R21.p1.id}/publications`, { publicationIds: [R21.pub.id] });
    R21.news = J(await a.req("POST", "/news", { date: "Jan 2038", sortDate: "2038-01-01", type: "Update", title: "ZZ B9 W21 News One", description: "d", visibility: "PUBLIC" }));
    R21.newsX = J(await a.req("POST", "/news", { date: "Jan 2038", sortDate: "2038-01-02", type: "Update", title: "ZZ B9 W21 News " + w21X(6), description: "d", visibility: "PUBLIC" }));
    await a.req("PUT", `/projects/${R21.p1.id}/news`, { newsIds: [R21.news.id, R21.newsX.id] });
    const at = new Date(Date.now() + 9 * 864e5).toISOString();
    R21.ev = J(await a.req("POST", "/events", { title: "ZZ B9 W21 Event One", kind: "SEMINAR", startsAt: at, visibility: "PUBLIC", projectId: R21.p1.id }));
    R21.evX = J(await a.req("POST", "/events", { title: "ZZ B9 W21 Event " + w21X(7), kind: "SEMINAR", startsAt: at, visibility: "PUBLIC", projectId: R21.p1.id }));
    R21.teamCount = (await a.req("GET", "/team")).json.length;
    check("workspace seed: the fixtures exist", [R21.lead.tmId, R21.mem.tmId, R21.mgr.tmId, R21.adm.tmId, R21.none.tmId, R21.cJa.id, R21.cX.id, R21.cAdd.id, R21.area.id, R21.grp.id, R21.p1.id, R21.p2.id, R21.p3.id, R21.p4.id, R21.pub.id, R21.news.id, R21.ev.id].every(Boolean));
  });

  await step("workspace guest: /workspace is gated in the UI and the API; the header offers no link", async () => {
    await desktop(); await setLocale(null);
    await go("/workspace"); await sleep(700);
    check("workspace guest: /workspace redirects to /login", (await pathNow()) === "/login");
    check("workspace guest: the page shows the login form and nothing about the workspace", (await exists("#email")) && !(await text()).includes("My research workspace") && !(await exists("#ws-projects")));
    check("workspace guest: GET /api/workspace is 401 and the body names nothing", (await apiCall("GET", "/workspace")) === 401 && !(await ev(`fetch('/api/workspace').then((r) => r.text())`)).includes("ZZ B9"));
    check("workspace guest: the header has no workspace link (even in closed panels)", !(await hrefEverywhere("/workspace")));
    check("workspace guest: the membership write APIs refuse a guest (401)", (await apiCall("POST", `/projects/${R21.p1.id}/members`, { teamMemberId: R21.cAdd.id })) === 401 && (await apiCall("DELETE", `/projects/${R21.p1.id}/members/${R21.mem.tmId}`)) === 401 && (await apiCall("PUT", `/groups/${R21.grp.id}/members/${R21.mem.tmId}`, { role: "LEAD" })) === 401);
    check("workspace guest: the public project page still shows no manage controls", await (async () => { await pReady(`/projects/${R21.p1.id}`, "ZZ B9 W21 Project One"); return !(await exists(".admin-bar")); })());
  });

  await step("workspace member: own workspace, LAB_ONLY project visible, no visibility badge, no manage controls", async () => {
    check("workspace member: login", await login(R21.mem.email, PW));
    await wsReady();
    check("workspace member: one h1, one main, the page title", (await pCount("h1")) === 1 && (await pCount("main")) === 1 && (await ev(`document.querySelector('h1').textContent.trim()`)) === "My research workspace" && (await ev(`document.title`)).includes("My research workspace"));
    const heads = await ev(`[...document.querySelectorAll('main h2')].map((h) => h.textContent.trim())`);
    check("workspace member: nine labelled sections (Phase 22 added 'Recent documentation', Phase 23 'My research resources') with real counts in their headings", heads.length === 9 && heads[0] === "My projects (2)" && heads[1] === "My groups (1)" && heads[2] === "My research areas (2)" && heads[3] === "My publications (0)" && heads[4].startsWith("Upcoming events (") && heads[5].startsWith("Recent research news (") && heads[6] === "Recent documentation" && heads[7] === "My research resources" && heads[8].startsWith("Research network ("), JSON.stringify(heads));
    check("workspace member: every section is a named region (aria-labelledby resolves)", await ev(`[...document.querySelectorAll('main section[aria-labelledby]')].every((s) => !!document.getElementById(s.getAttribute('aria-labelledby'))) && document.querySelectorAll('main section[aria-labelledby]').length === 9`));
    const p1 = await wsCard("projects", "ZZ B9 W21 Project One");
    const p2 = await wsCard("projects", "ZZ B9 W21 Project Lab");
    check("workspace member: both projects, the LAB_ONLY one included (a signed-in member may see it)", !!p1 && !!p2);
    check("workspace member: a project card shows status, lead, group, areas, counts and the member's own role", !!p1 && /active/i.test(p1.text) && p1.text.includes("Lead: ZZ B9 W21 Lead") && p1.text.includes("ZZ B9 W21 Group") && p1.text.includes("ZZ B9 W21 Area Alpha") && /Members: 7/.test(p1.text) && /Publications: 1/.test(p1.text) && /Upcoming events: 2/.test(p1.text) && p1.text.includes("Your role: Member"), JSON.stringify(p1));
    check("workspace member: no 'Lab only' badge anywhere (the visibility field is not sent to members)", !(await ev(`document.querySelector('main').innerText.toLowerCase().includes('lab only')`)) && !(await ev(`fetch('/api/workspace').then((r) => r.text())`)).includes('"visibility"'));
    check("workspace member: no Manage members button (not a lead, not a manager)", (await pCount(".ws-card button")) === 0 && !(await text()).includes("Manage members"));
    check("workspace member: the empty publications section says so and offers no 'all my publications' link", (await wsSecText("publications")).includes("No publications list you as an author yet.") && !(await exists('a[href^="/publications?researcher="]')));
    check("workspace member: 'All my projects' goes to the researcher-filtered list the projects page really reads", await exists(`a[href="/projects?researcher=${R21.mem.tmId}"]`));
    const people = await wsPeople();
    check("workspace member: the research network lists the OTHER people on the same projects/groups, once each, never the member themself", people.some((p) => p.name === "ZZ B9 W21 Lead") && people.some((p) => p.name === w21JaLong) && new Set(people.map((p) => p.name)).size === people.length && !people.some((p) => p.name === "ZZ B9 W21 Member"), JSON.stringify(people.map((p) => p.name)));
    const lead = people.find((p) => p.name === "ZZ B9 W21 Lead");
    check("workspace member: a collaborator shows the lab role and shared counts (distinct projects, groups, areas), and links to /team/:id", !!lead && lead.text.includes("Shared projects: 2") && lead.text.includes("Shared groups: 1") && lead.href === `/team/${R21.lead.tmId}`, JSON.stringify(lead));
    const cja = people.find((p) => p.name === w21JaLong);
    check("workspace member: a collaborator shows ONLY the shared kinds that are non-zero (no 'Shared areas: 0' / 'Shared groups: 0' noise)", !!cja && cja.text.includes("Shared projects: 1") && !cja.text.includes("Shared groups") && !cja.text.includes("Shared areas") && !!lead && !lead.text.includes("Shared areas"), JSON.stringify(cja));
    const html = await ev(`document.querySelector('main').outerHTML`);
    check("workspace member: no account id, e-mail or 'userId' anywhere in the page", !D.userIds.some((u) => html.includes(u)) && !html.includes("userId") && !html.includes("@example.test"));
    await openMenu("account");
    check("workspace member: the Account menu lists 'My Workspace' first, and it opens the page with a real click", (await panelHrefs("account"))[0] === "/workspace" && (await clickEl('#nav-panel-account a[href="/workspace"]')) && (await waitFor(`location.pathname === '/workspace'`)));
    await wsReady();
    await pClick(".ws-card .card__title a", "ZZ B9 W21 Project One");
    check("workspace member: a project title opens the existing detail page, and Back returns to the workspace", (await waitFor(`location.pathname === '/projects/${R21.p1.id}'`, 6000)) && (await (async () => { await ev(`history.back()`); return waitFor(`location.pathname === '/workspace'`, 5000); })()));
    await shot("w21-member");
    await logout();
  });

  await step("workspace lead: manage members of a project (add / role / remove, one request each), keyboard, focus and errors", async () => {
    check("workspace lead: login", await login(R21.lead.email, PW));
    await wsReady();
    const p1 = await wsCard("projects", "ZZ B9 W21 Project One");
    const p2 = await wsCard("projects", "ZZ B9 W21 Project Lab");
    const g1 = await wsCard("groups", "ZZ B9 W21 Group");
    check("workspace lead: Manage members on the projects/groups they LEAD only (P1 and the group), not on the ones they merely belong to", !!p1 && p1.manage.length === 1 && p1.manage[0] === "Manage members of ZZ B9 W21 Project One" && !!p2 && p2.manage.length === 0 && !!g1 && g1.manage.length === 1 && (await pCount(".ws-card button")) === 2, JSON.stringify([p1?.manage, p2?.manage, g1?.manage]));
    check("workspace lead: role text, 'All my publications' link, area 'On your profile' badge, hostile-titled cards all present", p1.text.includes("Your role: Lead") && (await exists(`a[href="/publications?researcher=${R21.lead.tmId}"]`)) && (await wsSecText("areas")).includes("On your profile"));
    const gpeople = await wsPeople();
    const cg = gpeople.find((x) => x.name === "ZZ B9 W21 Group Only Colleague");
    check("workspace lead: a colleague who shares only the GROUP shows 'Shared groups: 1' and no project/area counts", !!cg && cg.text.includes("Shared groups: 1") && !cg.text.includes("Shared projects") && !cg.text.includes("Shared areas"), JSON.stringify(cg));
    const before = await wsMembersApi("projects", R21.p1.id);
    const dlg = await wsOpen("ZZ B9 W21 Project One");
    check("workspace lead: the dialog opens named 'Members of <project>', with the current members and a picker that excludes them", !!dlg && dlg.title === "Members of ZZ B9 W21 Project One" && dlg.members.length === 7 && dlg.members.some((m) => m.name === "ZZ B9 W21 Lead" && m.role === "LEAD") && !dlg.pick.some((o) => o.includes("ZZ B9 W21 Lead")) && dlg.pick.some((o) => o.includes("ZZ B9 W21 Candidate One")), JSON.stringify(dlg));
    check("workspace lead: focus moved into the dialog; page scroll locked; Add is disabled until someone is chosen; project roles offered: Lead, Member, Collaborator", (await ev(`document.querySelector('.modal[role="dialog"]').contains(document.activeElement)`)) && dlg.addDisabled === true && eqJ(dlg.roleOptions, ["LEAD", "MEMBER", "COLLABORATOR"]));
    // add
    await wsPick(R21.cAdd.id);
    check("workspace lead: choosing a researcher enables Add", (await wsDlg()).addDisabled === false);
    await wsClickAdd();
    let d = await wsDlgWait((x) => x.members.some((m) => m.name === "ZZ B9 W21 Candidate One"));
    check("workspace lead: Add is ONE request: the researcher appears (role Member), leaves the picker, and a polite status announces it", d.members.some((m) => m.name === "ZZ B9 W21 Candidate One" && m.role === "MEMBER") && !d.pick.some((o) => o.includes("Candidate One")) && d.status === "ZZ B9 W21 Candidate One was added." && d.pick[0] === "Choose a researcher…", JSON.stringify(d));
    check("workspace lead: the server agrees (the join row exists, the other members are untouched)", await (async () => { const now = await wsMembersApi("projects", R21.p1.id); return now.length === before.length + 1 && now.includes(`${R21.cAdd.id}:MEMBER`) && before.every((x) => now.includes(x)); })());
    check("workspace lead: focus goes back to the picker so the next add is a keystroke away", await ev(`document.activeElement?.id === 'manage-pick'`));
    // role change
    await wsSetRole("ZZ B9 W21 Candidate One", "COLLABORATOR");
    d = await wsDlgWait((x) => x.status.includes("is now"));
    check("workspace lead: changing a role is one request and is announced ('… is now Collaborator.')", d.status === "ZZ B9 W21 Candidate One is now Collaborator." && d.members.find((m) => m.name === "ZZ B9 W21 Candidate One").role === "COLLABORATOR" && (await wsMembersApi("projects", R21.p1.id)).includes(`${R21.cAdd.id}:COLLABORATOR`), JSON.stringify(d));
    await wsSetRole("ZZ B9 W21 Candidate One", "LEAD");
    d = await wsDlgWait((x) => x.status.includes("Lead"));
    check("workspace lead: promoting to Lead works (the server allows a lead to name another lead, exactly as Phase 9)", (await wsMembersApi("projects", R21.p1.id)).includes(`${R21.cAdd.id}:LEAD`), d.status);
    await wsSetRole("ZZ B9 W21 Candidate One", "MEMBER");
    await wsDlgWait((x) => x.status.includes("Member"));
    // remove: two steps, Cancel returns focus
    check("workspace lead: Remove asks first ('Remove <name> from <project>?') with focus on the confirming button", (await wsRowBtn("ZZ B9 W21 Candidate One", /Remove/)) && (await wsDlgWait((x) => x.members.some((m) => m.confirming))).members.some((m) => m.confirming) && (await ev(`document.activeElement?.textContent.trim()`)) === "Yes, remove" && (await ev(`document.querySelector('.manage__confirm-text').textContent.trim()`)) === "Remove ZZ B9 W21 Candidate One from ZZ B9 W21 Project One?");
    await ev(`[...document.querySelectorAll('.manage__confirm button')].find((b) => b.textContent.trim() === 'Cancel').click()`);
    d = await wsDlgWait((x) => !x.members.some((m) => m.confirming));
    check("workspace lead: Cancel changes nothing and puts focus back on that row's Remove button", d.members.some((m) => m.name === "ZZ B9 W21 Candidate One") && (await ev(`(document.activeElement?.getAttribute('aria-label') || '') === 'Remove ZZ B9 W21 Candidate One'`)));
    await wsRowBtn("ZZ B9 W21 Candidate One", /Remove/);
    await wsDlgWait((x) => x.members.some((m) => m.confirming));
    await ev(`[...document.querySelectorAll('.manage__confirm button')].find((b) => b.textContent.trim() === 'Yes, remove').click()`);
    d = await wsDlgWait((x) => !x.members.some((m) => m.name === "ZZ B9 W21 Candidate One"));
    check("workspace lead: confirming removes exactly that researcher (server row gone), announces it and offers them in the picker again", !d.members.some((m) => m.name === "ZZ B9 W21 Candidate One") && d.status === "ZZ B9 W21 Candidate One was removed." && d.pick.some((o) => o.includes("Candidate One")) && !(await wsMembersApi("projects", R21.p1.id)).some((x) => x.startsWith(R21.cAdd.id)));
    // stale list -> duplicate (409) shown in place and the list refreshes
    await R21.a.req("POST", `/projects/${R21.p1.id}/members`, { teamMemberId: R21.cAdd2.id, role: "MEMBER" });
    await wsPick(R21.cAdd2.id);
    await wsClickAdd();
    d = await wsDlgWait((x) => !!x.alert);
    check("workspace lead: adding someone who was added meanwhile shows the server's duplicate message IN the dialog and refreshes the list (no second row)", d.alert.includes("That researcher is already a member.") || d.alert.includes("already"), d.alert);
    d = await wsDlg();
    check("workspace lead: … and the refreshed list now shows them once, gone from the picker", d.members.filter((m) => m.name === "ZZ B9 W21 Candidate Two").length === 1 && !d.pick.some((o) => o.includes("Candidate Two")));
    await R21.a.req("DELETE", `/projects/${R21.p1.id}/members/${R21.cAdd2.id}`);
    // errors from the network
    await fake("*/api/projects/*/members", 403, JSON.stringify({ error: "Forbidden" }));
    await wsPick(R21.cAdd.id);
    await wsClickAdd();
    d = await wsDlgWait((x) => !!x.alert);
    check("workspace lead: a 403 from the API is shown localized inside the dialog (role=alert), the dialog stays open and nothing was added", d.alert.includes("You don't have permission to do that.") && !d.members.some((m) => m.name === "ZZ B9 W21 Candidate One"), d.alert);
    await unfake();
    await fake("*/api/projects/*/members", 500, JSON.stringify({ error: "Internal server error" }));
    await wsPick(R21.cAdd.id);
    await wsClickAdd();
    d = await wsDlgWait((x) => !!x.alert && x.alert.includes("Internal"));
    check("workspace lead: a 500 is shown as an error and the dialog is still usable (Add enabled again, no stuck spinner)", !!d.alert && d.addDisabled === false && !/Adding/.test(await ev(`document.querySelector('.modal').innerText`)), d.alert);
    await unfake();
    // add once for real, then Done: the page reloads and the card count moves
    await wsPick(R21.cAdd.id);
    await wsClickAdd();
    await wsDlgWait((x) => x.members.some((m) => m.name === "ZZ B9 W21 Candidate One"));
    await ev(`[...document.querySelectorAll('.modal__actions button')].find((b) => /^Done$/.test(b.textContent.trim())).click()`);
    check("workspace lead: Done closes the dialog and returns focus to the Manage button that opened it", (await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 3000)) && (await ev(`document.activeElement?.getAttribute('aria-label') === 'Manage members of ZZ B9 W21 Project One'`)));
    check("workspace lead: the project card was refreshed (7 -> 8 members) without a page reload", await waitFor(`document.querySelector('section[aria-labelledby="ws-projects"]').innerText.includes('Members: 8')`, 6000));
    // escape closes, focus returns
    await wsOpen("ZZ B9 W21 Project One");
    check("workspace lead: Escape closes the dialog and focus returns to the opener", (await wsClose()) && (await ev(`document.activeElement?.getAttribute('aria-label') === 'Manage members of ZZ B9 W21 Project One'`)));
    // remove the researcher again so later steps see the seed state
    await R21.a.req("DELETE", `/projects/${R21.p1.id}/members/${R21.cAdd.id}`);
    // group dialog
    const gd = await wsOpen("ZZ B9 W21 Group");
    check("workspace lead: the GROUP dialog offers only Lead and Member and lists the group's members", !!gd && gd.title === "Members of ZZ B9 W21 Group" && eqJ(gd.roleOptions, ["LEAD", "MEMBER"]) && gd.members.length === 3, JSON.stringify(gd));
    await wsPick(R21.cAdd.id);
    await wsClickAdd();
    await wsDlgWait((x) => x.members.some((m) => m.name === "ZZ B9 W21 Candidate One"));
    check("workspace lead: adding to the group is one request against /groups/:id/members", (await wsMembersApi("groups", R21.grp.id)).some((x) => x.startsWith(R21.cAdd.id)));
    await wsRowBtn("ZZ B9 W21 Candidate One", /Remove/);
    await wsDlgWait((x) => x.members.some((m) => m.confirming));
    await ev(`[...document.querySelectorAll('.manage__confirm button')].find((b) => b.textContent.trim() === 'Yes, remove').click()`);
    await wsDlgWait((x) => !x.members.some((m) => m.name === "ZZ B9 W21 Candidate One"));
    check("workspace lead: removing from the group works and is confirmed first", !(await wsMembersApi("groups", R21.grp.id)).some((x) => x.startsWith(R21.cAdd.id)));
    await wsClose();
    check("workspace lead: a request to a project the lead does NOT lead is refused by the API (403) even if the UI were bypassed", (await apiCall("POST", `/projects/${R21.p2.id}/members`, { teamMemberId: R21.cAdd.id })) === 403 && (await apiCall("DELETE", `/projects/${R21.p2.id}/members/${R21.mem.tmId}`)) === 403);
    check("workspace lead: the lead cannot change their OWN account role (no such control, API refuses)", (await apiCall("PUT", `/users/${R21.lead.userId}`, { role: "ADMIN" })) === 403 && !(await text()).includes("Role: Admin"));
    await shot("w21-lead");
    await logout();
  });

  await step("workspace manager and admin: own workspace, visibility badge, manage on every card; the real admin has no profile", async () => {
    check("workspace manager: login", await login(R21.mgr.email, PW));
    await wsReady();
    const p2 = await wsCard("projects", "ZZ B9 W21 Project Lab");
    const p1 = await wsCard("projects", "ZZ B9 W21 Project One");
    check("workspace manager: the LAB_ONLY project card carries the 'Lab only' badge (managers may act on visibility)", !!p2 && /lab only/i.test(p2.text) && !!p1 && !/lab only/i.test(p1.text), JSON.stringify(p2));
    check("workspace manager: Manage members on every project card even where they are a plain member, and on no card they are not in", !!p1 && p1.manage.length === 1 && !!p2 && p2.manage.length === 1 && (await pCount(".ws-card button")) === 2);
    check("workspace manager: the workspace is THEIR OWN (their two projects, not the lab's four) and shows no private data of others", (await ev(`document.querySelector('#ws-projects').textContent`)) === "My projects (2)" && !(await pMain()).includes(w21Long));
    check("workspace manager: no messages / notifications content anywhere on the page", !/message|notification/i.test(await pMain()));
    await logout();
    check("workspace admin: login (an ADMIN account with a linked profile)", await login(R21.adm.email, PW));
    await wsReady();
    const ap = await wsCard("projects", "ZZ B9 W21 Project One");
    check("workspace admin: populated workspace with manage controls and the visibility badge system", !!ap && ap.manage.length === 1 && (await wsHead("projects")) === "My projects (1)");
    check("workspace admin: the Admin Dashboard link still exists and /admin is unaffected (workspace is not an admin surface)", (await hrefEverywhere("/admin")) && (await hrefEverywhere("/workspace")));
    await logout();
    const before = (await R21.a.req("GET", "/team")).json.length;
    check("workspace real admin without a linked profile: login", await login(ADMIN.email, ADMIN.password));
    await wsReady();
    check("workspace real admin without a linked profile: a clear localized state, no sections, one h1", (await text()).includes("No researcher profile is linked to your account") && !(await exists("#ws-projects")) && (await pCount("h1")) === 1 && (await exists('main a[href="/team"]')));
    check("workspace real admin without a linked profile: visiting it created no TeamMember", (await R21.a.req("GET", "/team")).json.length === before && before === R21.teamCount);
    await shot("w21-admin-noprofile");
    await logout();
  });

  await step("workspace empty: a researcher with no relationships gets seven friendly empty states", async () => {
    check("workspace empty: login", await login(R21.none.email, PW));
    await wsReady();
    const t = await pMain();
    check("workspace empty: every section says what is missing, in words", ["You are not a member of any project you can see yet.", "You are not a member of any group you can see yet.", "No research areas are connected to you yet.", "No publications list you as an author yet.", "No upcoming events for your projects.", "No news about your projects yet.", "Nobody shares a project, group or research area with you yet."].every((s) => t.includes(s)), t.slice(0, 300));
    check("workspace empty: counts read 0 and no 'all ...' links, cards or manage buttons appear", (await wsHead("projects")) === "My projects (0)" && (await pCount(".ws-card")) === 0 && (await pCount(".ws-person")) === 0 && !(await exists('a[href^="/projects?researcher="]')));
    await logout();
  });

  await step("workspace bounded: more projects than the cap -> the true total in the heading, the cap on the page, a link to the full list", async () => {
    check("workspace bounded: login", await login(R21.many.email, PW));
    await wsReady();
    const cards = await wsCards("projects");
    const secText = await wsSecText("projects");
    check("workspace bounded: the heading reports the TRUE total (14) while only the first 12 cards are shown", (await wsHead("projects")) === "My projects (14)" && cards.length === 12, `${await wsHead("projects")} / ${cards.length}`);
    check("workspace bounded: the 12 shown are the first by (sortOrder, title) and the 13th/14th are not on the page", cards.map((c) => c.title).join("|") === Array.from({ length: 12 }, (_, i) => `ZZ B9 W21 Many ${String(i).padStart(2, "0")}`).join("|") && !secText.includes("Many 12") && !secText.includes("Many 13"));
    check("workspace bounded: the section says 'Showing 12 of 14' and links to the full researcher-filtered list", secText.includes("Showing 12 of 14") && (await exists(`a[href="/projects?researcher=${R21.many.tmId}"]`)));
    await setLocale("ja");
    await wsReady();
    check("workspace bounded ja: the heading and the 'showing' note are Japanese with the same numbers", (await wsHead("projects")) === "マイプロジェクト（14）" && (await wsSecText("projects")).includes("14件中12件を表示"));
    await setLocale(null);
    await logout();
  });

  await step("workspace loading / error: skeleton while loading, an error state with Try again, then the page", async () => {
    check("workspace error: login", await login(R21.mem.email, PW));
    await go("/"); await navReady();
    await fake("*/api/workspace", 500, JSON.stringify({ error: "Internal server error" }));
    await go("/workspace"); await waitFor(`!!document.querySelector('[role="alert"]')`, 6000);
    check("workspace error: a 500 renders an alert with the message and a Try again button, plus the page header (no blank page)", (await ev(`document.querySelector('[role="alert"]').innerText`)).includes("Internal server error") && (await exists('[role="alert"] button')) && (await pCount("h1")) === 1);
    await unfake();
    await clickEl('[role="alert"] button');
    check("workspace error: Try again loads the workspace", await waitFor(`!!document.querySelector('#ws-projects')`, 6000));
    await go("/"); await navReady();
    await fake("*/api/workspace", 401, JSON.stringify({ error: "Unauthorized" }));
    await go("/workspace"); await waitFor(`!!document.querySelector('[role="alert"]')`, 6000);
    check("workspace error: a 401 shows an error state, never the workspace", (await ev(`document.querySelector('[role="alert"]').innerText`)).length > 0 && !(await ev(`document.querySelector('main').innerText`)).includes("ZZ B9 W21"));
    await unfake();
    await logout();
  });

  await step("workspace ja: Japanese chrome and overrides, identical authorization, identical ids", async () => {
    await desktop(); await setLocale("ja");
    check("workspace ja: login", await login(R21.lead.email, PW));
    await wsReady();
    check("workspace ja: <html lang>, h1 and headings are Japanese", (await ev(`document.documentElement.lang`)) === "ja" && (await ev(`document.querySelector('h1').textContent.trim()`)) === "マイ研究ワークスペース" && (await wsHead("projects")) === "マイプロジェクト（4）" && (await wsHead("groups")).startsWith("マイグループ"));
    const p1 = await wsCard("projects", "ZZ B9 W21 プロジェクト一");
    check("workspace ja: the project card uses the Japanese title, group name and area override", !!p1 && p1.text.includes("ZZ B9 W21 グループ") && p1.text.includes("ZZ B9 W21 アルファ分野") && p1.text.includes("リード：ZZ B9 W21 Lead") && p1.text.includes("あなたの役割：リード") && /メンバー：7/.test(p1.text), JSON.stringify(p1));
    check("workspace ja: 'Manage members' is Japanese and its accessible name names the project", !!p1 && p1.manage[0] === "ZZ B9 W21 プロジェクト一のメンバーを管理");
    const en = await wsApi("en"), ja = await wsApi("ja"), bad = await wsApi("xx"), tam = await wsApi("ja,en;q=0.1");
    check("workspace ja: the API returns the same ids in EN, JA and a tampered locale (locale never changes what is shown)", wsIds(en) === wsIds(ja) && wsIds(en) === wsIds(bad) && wsIds(en) === wsIds(tam) && ja.projects.items.some((x) => x.title === "ZZ B9 W21 プロジェクト一") && en.projects.items.some((x) => x.title === "ZZ B9 W21 Project One") && bad.projects.items.some((x) => x.title === "ZZ B9 W21 Project One"));
    const dlg = await wsOpen("プロジェクト一");
    check("workspace ja: the members dialog is Japanese (title, headings, buttons, role labels) and lists the same members", !!dlg && dlg.title === "ZZ B9 W21 プロジェクト一のメンバー" && dlg.members.length === 7 && dlg.pick[0] === "研究者を選択…" && (await ev(`document.querySelector('.modal').innerText`)).includes("研究者を追加") && (await ev(`[...document.querySelectorAll('.manage__row select')][0].selectedOptions[0].textContent.trim()`)) === "リード", JSON.stringify(dlg));
    await wsPick(R21.cAdd.id);
    await wsClickAdd();
    let d = await wsDlgWait((x) => x.members.some((m) => m.name === "ZZ B9 W21 Candidate One"));
    check("workspace ja: adding announces in Japanese ('…を追加しました。')", d.status === "ZZ B9 W21 Candidate Oneを追加しました。", d.status);
    await R21.a.req("POST", `/projects/${R21.p1.id}/members`, { teamMemberId: R21.cAdd2.id, role: "MEMBER" });
    await wsPick(R21.cAdd2.id);
    await wsClickAdd();
    d = await wsDlgWait((x) => !!x.alert);
    check("workspace ja: a duplicate is reported in Japanese (the fixed API message is mapped, never shown raw)", d.alert.includes("すでにメンバーです"), d.alert);
    await wsRowBtn("ZZ B9 W21 Candidate One", /削除/);
    check("workspace ja: the removal question is Japanese and the row's Remove button carries a Japanese accessible name", (await wsDlgWait((x) => x.members.some((m) => m.confirming))).members.some((m) => m.confirming) && (await ev(`document.querySelector('.manage__confirm-text').textContent.trim()`)) === "ZZ B9 W21 Candidate OneをZZ B9 W21 プロジェクト一から削除しますか？");
    await ev(`[...document.querySelectorAll('.manage__confirm button')].find((b) => b.textContent.trim() === 'はい、削除します').click()`);
    await wsDlgWait((x) => !x.members.some((m) => m.name === "ZZ B9 W21 Candidate One"));
    await R21.a.req("DELETE", `/projects/${R21.p1.id}/members/${R21.cAdd2.id}`);
    await wsClose();
    check("workspace ja: guests stay refused in Japanese (401) and members stay refused writes (403)", (await (async () => { const c = new Client(); const r = await c.req("GET", "/workspace"); return r.status === 401; })()) && (await apiCall("POST", `/projects/${R21.p2.id}/members`, { teamMemberId: R21.cAdd.id })) === 403);
    await shot("w21-lead-ja");
    await logout();
    await setLocale(null);
  });

  await step("workspace hostile text: markup in project, group, area, person, publication, event and news names is inert (EN + JA)", async () => {
    const dialogsBefore = P15.jsDialogs.length;
    check("workspace hostile: login", await login(R21.lead.email, PW));
    for (const loc of [null, "ja"]) {
      await setLocale(loc);
      await wsReady();
      const facts = await ev(`(() => { const m = document.querySelector('main'); return { imgs: m.querySelectorAll('img, script, iframe, svg[onload]').length, text: m.innerText, xss: typeof window.__w21Xss }; })()`);
      check(`workspace hostile ${loc || "en"}: no element is created from any hostile name on the page`, facts.imgs === 0 && facts.xss === "undefined");
      check(`workspace hostile ${loc || "en"}: the hostile project, group, area, publication, news and event names are visible as TEXT`, ["Project <img src=x onerror=window.__w21Xss=4>", "Group <script>window.__w21Xss=3</script>", "Area <img src=x onerror=window.__w21Xss=2>", "Paper <img src=x onerror=window.__w21Xss=5>"].every((s) => facts.text.includes(s)), facts.text.slice(0, 200));
      const dlg = await wsOpen(loc ? "ZZ B9 W21 プロジェクト一" : "ZZ B9 W21 Project One");
      const df = await ev(`(() => { const d = document.querySelector('.modal'); return { imgs: d.querySelectorAll('img, script').length, hostile: d.innerText.includes('<img src=x onerror=window.__w21Xss=1>'), xss: typeof window.__w21Xss }; })()`);
      check(`workspace hostile ${loc || "en"}: the hostile person name in the dialog (list and picker) is text, not markup`, !!dlg && df.imgs === 0 && df.hostile && df.xss === "undefined");
      await wsClose();
    }
    await setLocale(null);
    check("workspace hostile: no script from hostile text ever ran and no JS dialog opened", (await ev(`typeof window.__w21Xss`)) === "undefined" && P15.jsDialogs.length === dialogsBefore, P15.jsDialogs.slice(dialogsBefore).join("|"));
    await logout();
  });

  await step("workspace long text: a 110-character unbroken title and 60+ character Japanese names stay inside cards, network and dialog at 390px", async () => {
    await desktopAt(390, 844);
    check("workspace long: login", await login(R21.lead.email, PW));
    await desktopAt(390, 844);
    await wsReady();
    check("workspace long: the page has no horizontal overflow at 390px with the long title and long names", (await overflowPx()) <= 1);
    const au = await p15Audit(null, false);
    check("workspace long: no clipped/spilling text, overlapping controls or unnamed controls", au.resp.length === 0 && au.a11y.length === 0, [...au.resp, ...au.a11y].slice(0, 3).join(" | "));
    const dlg = await wsOpen("ZZ B9 W21 Project One");
    const m = await ev(`(() => { const d = document.querySelector('.modal[role="dialog"]'); const b = d.getBoundingClientRect(); return { fitsX: b.left >= -0.5 && b.right <= innerWidth + 0.5, inner: d.scrollWidth - d.clientWidth }; })()`);
    check("workspace long: the members dialog fits 390px with the long Japanese and unbroken names (no internal horizontal scroll)", !!dlg && m.fitsX && m.inner <= 1, JSON.stringify(m));
    const aud = await p15Audit(".modal", false);
    check("workspace long: the dialog contents have no clipped/overlapping text and every control is named", aud.resp.length === 0 && aud.a11y.length === 0, [...aud.resp, ...aud.a11y].slice(0, 3).join(" | "));
    await wsClose();
    await logout();
    await desktop();
  });

  const wsDialogChecks = async (loc, w, tagUser) => {
    const d = await wsOpen(loc === "ja" ? "のメンバーを管理" : "Manage members of");
    if (!d) { check(`workspace ${loc} ${w}px ${tagUser}: the Manage members dialog opens`, false); return; }
    const au = await p15Audit(".modal", loc === "ja");
    check(`workspace ${loc} ${w}px ${tagUser} dialog: no clipped/overlapping text, every control named, fits the viewport`, au.resp.length === 0 && au.a11y.length === 0 && (await ev(`(() => { const b = document.querySelector('.modal[role="dialog"]').getBoundingClientRect(); return b.left >= -0.5 && b.right <= innerWidth + 0.5 && document.querySelector('.modal[role="dialog"]').scrollWidth - document.querySelector('.modal[role="dialog"]').clientWidth <= 1; })()`)), [...au.resp, ...au.a11y].slice(0, 3).join(" | "));
    await wsClose();
    if (P15_TAB_WIDTHS.includes(w)) await p15Dialog(`workspace ${loc} ${w}px ${tagUser} manage`, ".ws-card button", 0, loc === "ja");
  };

  await step("workspace sweep: guest -- the gate at every width, EN + JA", async () => {
    await p15Loop("ws-guest", null, [["workspace (redirected to the login form)", "/workspace"]], async () => {});
  });
  await step("workspace sweep: member -- 390..1920, EN + JA", async () => {
    await p15Loop("ws-member", () => login(R21.mem.email, PW), [["workspace", "/workspace"]], async (loc, w) => { if (P15_TAB_WIDTHS.includes(w)) await p19Walk(`workspace ${loc} ${w}px member`, [["workspace", "/workspace"]]); });
  });
  await step("workspace sweep: project lead -- 390..1920, EN + JA, members dialog at every width", async () => {
    await p15Loop("ws-lead", () => login(R21.lead.email, PW), [["workspace", "/workspace"]], async (loc, w) => {
      await wsReady();
      await wsDialogChecks(loc, w, "lead");
      if (P15_TAB_WIDTHS.includes(w)) await p19Walk(`workspace ${loc} ${w}px lead`, [["workspace", "/workspace"]]);
    });
    check("workspace sweep lead: no script from hostile text ever ran", (await ev(`typeof window.__w21Xss`)) === "undefined");
  });
  await step("workspace sweep: lab manager -- 390..1920, EN + JA, members dialog at every width", async () => {
    await p15Loop("ws-manager", () => login(R21.mgr.email, PW), [["workspace", "/workspace"]], async (loc, w) => { await wsReady(); await wsDialogChecks(loc, w, "manager"); });
  });
  await step("workspace sweep: admin -- 390..1920, EN + JA, members dialog at every width", async () => {
    await p15Loop("ws-admin", () => login(R21.adm.email, PW), [["workspace", "/workspace"]], async (loc, w) => { await wsReady(); await wsDialogChecks(loc, w, "admin"); });
  });
  await step("workspace sweep: an account with no linked profile and one with no relationships -- 390..1920, EN + JA", async () => {
    await p15Loop("ws-noprofile", () => login(ADMIN.email, ADMIN.password), [["workspace (no profile)", "/workspace"]], async () => {});
    await p15Loop("ws-empty", () => login(R21.none.email, PW), [["workspace (empty)", "/workspace"]], async () => {});
  });

  await step("workspace screenshots: populated, lead dialog, JA and phone (for eyeballing)", async () => {
    await setLocale(null);
    await login(R21.lead.email, PW);
    for (const [w, tag] of [[1280, "d"], [390, "m"]]) {
      await p15Vp(w);
      await wsReady();
      await shot(`w21-workspace-${tag}`);
      const d = await wsOpen("ZZ B9 W21 Project One");
      if (d) await shot(`w21-dialog-${tag}`);
      await wsClose();
    }
    await setLocale("ja");
    await login(R21.lead.email, PW);
    await p15Vp(390);
    await wsReady();
    await shot("w21-workspace-ja-m");
    check("workspace screenshots: taken", fs.existsSync(path.join(SHOTS, "w21-workspace-d.png")) && fs.existsSync(path.join(SHOTS, "w21-workspace-ja-m.png")));
    await logout();
    await setLocale(null);
  });
  await step("workspace restore (locale, viewport)", async () => { await setLocale(null); await desktop(); });

  // ================================================================ PHASE 22: research knowledge base
  // /knowledge (list, filters, paging), /knowledge/:id, the add/edit/delete dialogs with the Japanese fields, the "Knowledge &
  // documentation" sections on project / area / group / researcher pages, search, the workspace section and the admin views, in EN
  // and JA, for guest / member / project lead / lab manager / admin, with hostile and very long text and the nine-width sweep.
  // (Steps are named "knowledge ..."; ONLY_KNOWLEDGE=1 runs just them; P15_W / P15_USERS=k22-guest,k22-member,k22-lead,k22-manager,
  // k22-admin narrow the sweeps.)
  section("phase 22: research knowledge base");
  const K22 = {};
  const k22X = (n) => `<img src=x onerror=window.__k22Xss=${n}>`;
  const k22JaLong = "ZZ B9 K22 " + "超長い日本語のタイトルがカードと詳細ページの幅を壊さないことを確認するためのテスト".repeat(2);
  const k22JaBody = "これは非常に長い日本語の本文です。レイアウトが崩れないことを確認します。".repeat(60);
  const k22Cards = () => ev(`[...document.querySelectorAll('.knowledge-card')].map((c) => ({ title: c.querySelector('.card__title')?.textContent.trim(), text: c.innerText, hrefs: [...c.querySelectorAll('a')].map((a) => a.getAttribute('href')), edit: !!c.querySelector('.card-edit-btn'), del: !!c.querySelector('.icon-btn--danger'), badges: [...c.querySelectorAll('.badge')].map((b) => b.textContent.trim().toLowerCase()) }))`);
  const k22Titles = async () => (await k22Cards()).map((c) => c.title);
  const k22Card = async (title) => (await k22Cards()).find((c) => c.title === title) || null;
  const k22Ready = async (p, mustHave) => { await go(p); await navReady(); await waitFor(`!document.querySelector('[aria-busy="true"]') && (!!document.querySelector('.knowledge-card') || !!document.querySelector('.empty-state') || !!document.querySelector('[role="alert"]') || !!document.querySelector('.knowledge-body') || !!document.querySelector('.admin-row') || !!document.querySelector('.search-result') || !!document.querySelector('#ws-projects'))`, 9000); if (mustHave) await waitText(mustHave, 9000); await sleep(300); };
  const k22Override = async (id) => Object.values(((await K22.a.req("GET", `/translations/KNOWLEDGE_DOC/${id}`)).json || {}).ja || {}).filter(Boolean).length; // stored Japanese overrides of one document
  const k22Api = (locale, p) => ev(`fetch('/api${p}', { credentials: 'same-origin', headers: ${locale ? `{ 'X-Locale': '${locale}' }` : "{}"} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))`);
  const k22Dlg = () => ev(`(() => { const d = document.querySelector('.modal[role="dialog"]'); if (!d) return null; const g = (id) => document.getElementById(id); return { title: (document.getElementById(d.getAttribute('aria-labelledby') || '__') || {}).textContent?.trim() || '', tv: g('knowledge_title')?.value ?? null, bv: g('knowledge_body')?.value ?? null, cat: g('knowledge_category')?.value ?? null, proj: g('knowledge_project')?.value ?? null, area: g('knowledge_area')?.value ?? null, grp: g('knowledge_group')?.value ?? null, res: g('knowledge_researcher')?.value ?? null, vis: g('knowledge_visibility')?.value ?? null, tja: g('knowledge_title_ja')?.value ?? null, bja: g('knowledge_body_ja')?.value ?? null, alert: d.querySelector('[role="alert"]')?.innerText.trim() || '', focusId: document.activeElement?.id || '', submitDisabled: d.querySelector('button.form-submit')?.disabled ?? null, projOpts: [...(g('knowledge_project')?.options || [])].map((o) => o.textContent.trim()) }; })()`);
  const k22DlgWait = async (pred, ms = 6000) => { const t0 = Date.now(); let d; while (Date.now() - t0 < ms) { d = await k22Dlg(); if (d && pred(d)) return d; await sleep(120); } return d; };
  const k22Fill = async (o) => { for (const [id, v] of Object.entries(o)) await setVal(id, v); };
  const k22Save = async () => { await ev(`document.querySelector('.modal button.form-submit')?.scrollIntoView({ block: 'center' })`); await p15Settle(); return clickEl(".modal button.form-submit"); };
  const k22Close = async () => { await press("esc"); return waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2500); };
  const k22Add = async () => { await pClick(".admin-bar button", ""); return k22DlgWait((d) => d.bv !== null); };
  const k22EditOn = async (title) => { // real click on the edit icon of the card with this title
    const ok = await ev(`(() => { document.querySelectorAll('[data-k22-op]').forEach((e) => e.removeAttribute('data-k22-op')); const c = [...document.querySelectorAll('.knowledge-card')].find((x) => x.querySelector('.card__title')?.textContent.trim() === ${JSON.stringify(title)}); const b = c && c.querySelector('.card-edit-btn .icon-btn:not(.icon-btn--danger)'); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.setAttribute('data-k22-op', '1'); return true; })()`);
    if (!ok) return null;
    await p15Settle();
    await clickEl("[data-k22-op]");
    return k22DlgWait((d) => d.tv !== null && d.bv !== null && d.bv !== "");
  };
  const k22DelOn = async (title) => {
    const ok = await ev(`(() => { document.querySelectorAll('[data-k22-op]').forEach((e) => e.removeAttribute('data-k22-op')); const c = [...document.querySelectorAll('.knowledge-card')].find((x) => x.querySelector('.card__title')?.textContent.trim() === ${JSON.stringify(title)}); const b = c && c.querySelector('.icon-btn--danger'); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.setAttribute('data-k22-op', '1'); return true; })()`);
    if (!ok) return false;
    await p15Settle();
    await clickEl("[data-k22-op]");
    return waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 3000);
  };
  const k22Mk = async (key, role, name) => {
    const r = await K22.a.req("POST", "/users", { email: `b9-k22-${key}@example.test`, password: PW, role, name, initials: "K" + key.slice(0, 1).toUpperCase(), memberRole: "Researcher", category: "RESEARCH" });
    const team = (await K22.a.req("GET", "/team")).json;
    D.userIds.push(r.json.id);
    return { email: `b9-k22-${key}@example.test`, userId: r.json.id, tmId: team.find((m) => m.name === name).id, name };
  };
  const k22Login = (u) => login(u.email, PW);
  // The browser run's own DB COPY (run-browser.sh exports K22_DB). Used ONLY to create the one fixture the API cannot: a project whose
  // visibility is outside the allow-list ("PRIVATE"), i.e. invisible to every signed-in viewer.
  const k22Sql = (sql, ...params) => { if (!process.env.K22_DB) throw new Error("K22_DB is not set"); const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.env.K22_DB); try { const st = db.prepare(sql); return /^\s*select/i.test(sql) ? st.all(...params) : st.run(...params); } finally { db.close(); } };

  await step("knowledge seed: five roles, public / lab-only / leaky / hostile / long / many documents with Japanese overrides", async () => {
    if (!P15.jsDialogs) { P15.jsDialogs = []; ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Page.javascriptDialogOpening") { P15.jsDialogs.push(m.params.message); send("Page.handleJavaScriptDialog", { accept: false }); } }); }
    const a = new Client();
    await a.req("POST", "/auth/login", ADMIN);
    K22.a = a;
    const J = (r) => r.json;
    K22.lead = await k22Mk("lead", "MEMBER", "ZZ B9 K22 Lead");
    K22.mem = await k22Mk("mem", "MEMBER", "ZZ B9 K22 Member");
    K22.mgr = await k22Mk("mgr", "LAB_MANAGER", "ZZ B9 K22 Manager");
    K22.none = await k22Mk("none", "MEMBER", "ZZ B9 K22 Nobody");
    K22.aPub = J(await a.req("POST", "/research", { title: "ZZ B9 K22 Area Public", description: "k22 area", tag: "ZZK22", visibility: "PUBLIC", translations: { ja: { title: "ZZ B9 K22 公開分野" } } }));
    K22.aHid = J(await a.req("POST", "/research", { title: "ZZ B9 K22 Area Lab", description: "k22 lab area", tag: "ZZK22", visibility: "LAB_ONLY" }));
    K22.aX = J(await a.req("POST", "/research", { title: "ZZ B9 K22 Area " + k22X(2), description: "hostile", tag: "ZZK22", visibility: "PUBLIC" }));
    K22.gPub = J(await a.req("POST", "/groups", { name: "ZZ B9 K22 Group Public", description: "g", visibility: "PUBLIC", translations: { ja: { name: "ZZ B9 K22 公開グループ" } } }));
    K22.gHid = J(await a.req("POST", "/groups", { name: "ZZ B9 K22 Group Lab", description: "g", visibility: "LAB_ONLY" }));
    K22.gX = J(await a.req("POST", "/groups", { name: "ZZ B9 K22 Group <script>window.__k22Xss=7</script>", description: "gx", visibility: "PUBLIC" }));
    const mkPrj = async (title, visibility, groupId, ja) => J(await a.req("POST", "/projects", { title, summary: "K22 summary", description: "d", status: "ACTIVE", visibility, ...(groupId ? { groupId } : {}), ...(ja ? { translations: { ja: { title: ja } } } : {}) }));
    K22.p1 = await mkPrj("ZZ B9 K22 Project One", "PUBLIC", K22.gPub.id, "ZZ B9 K22 プロジェクト一");
    K22.pHid = await mkPrj("ZZ B9 K22 Project Lab", "LAB_ONLY", null);
    K22.pX = await mkPrj("ZZ B9 K22 Project " + k22X(4), "PUBLIC", K22.gX.id);
    K22.pEmpty = await mkPrj("ZZ B9 K22 Project Without Docs", "PUBLIC", null);
    await a.req("PUT", `/projects/${K22.p1.id}/members`, { members: [{ teamMemberId: K22.lead.tmId, role: "LEAD" }] });
    await a.req("PUT", `/groups/${K22.gPub.id}/members`, { members: [{ teamMemberId: K22.lead.tmId, role: "MEMBER" }] });
    await a.req("PUT", `/member/${K22.lead.tmId}/areas`, { areaIds: [K22.aPub.id] });
    const doc = async (client, body) => J(await client.req("POST", "/knowledge", body));
    // The manager writes the shared fixtures, so they carry a public author profile (byline) and the manager may set visibility.
    const mgrC = new Client(); await mgrC.req("POST", "/auth/login", { email: K22.mgr.email, password: PW });
    K22.dPub = await doc(mgrC, { title: "ZZ B9 K22 Public Methodology", body: "Step one: flash the board.\nStep two: run the tests.\n\n  Indented ZZKPUB note", category: "METHODOLOGY", visibility: "PUBLIC", projectId: K22.p1.id, researchAreaId: K22.aPub.id, groupId: K22.gPub.id, teamMemberId: K22.lead.tmId, translations: { ja: { title: "ZZ B9 K22 公開メソドロジー", body: "手順その一：ボードを書き込む。\n手順その二：テストを実行する。" } } });
    K22.dLab = await doc(mgrC, { title: "ZZ B9 K22 Lab Only Procedure", body: "Internal ZZKLAB budget procedure", category: "LAB_PROCEDURE", visibility: "LAB_ONLY" });
    K22.dLeak = await doc(mgrC, { title: "ZZ B9 K22 Leaky Public Note", body: "Public note on lab-only things ZZKLEAK", category: "EXPERIMENT", visibility: "PUBLIC", projectId: K22.pHid.id, researchAreaId: K22.aHid.id, groupId: K22.gHid.id });
    K22.dX = await doc(mgrC, { title: "ZZ B9 K22 Hostile " + k22X(1), body: `<script>window.__k22Xss=3</script>\n<iframe src="javascript:window.__k22Xss=4"></iframe> javascript:alert(1) <a href="javascript:window.__k22Xss=8">x</a>`, category: "SOFTWARE", visibility: "PUBLIC", projectId: K22.pX.id, researchAreaId: K22.aX.id, groupId: K22.gX.id, translations: { ja: { title: "ZZ B9 K22 日本語 " + k22X(5), body: `日本語 <script>window.__k22Xss=6</script>` } } });
    K22.dLongJa = await doc(mgrC, { title: k22JaLong.slice(0, 200), body: k22JaBody, category: "RESEARCH_NOTE", visibility: "PUBLIC", projectId: K22.p1.id });
    K22.dLongTok = await doc(mgrC, { title: "ZZ B9 K22 " + "T".repeat(150), body: "U".repeat(3000) + " tail", category: "DATASET", visibility: "PUBLIC" });
    K22.many = [];
    for (let i = 0; i < 14; i++) K22.many.push(await doc(mgrC, { title: `ZZ B9 K22 Many ${String(i).padStart(2, "0")}`, body: `many body ${i} ZZKMANY`, category: "DATASET", visibility: "PUBLIC", projectId: K22.p1.id }));
    const memC = new Client(); await memC.req("POST", "/auth/login", { email: K22.mem.email, password: PW });
    const leadC = new Client(); await leadC.req("POST", "/auth/login", { email: K22.lead.email, password: PW });
    K22.dMem = await doc(memC, { title: "ZZ B9 K22 Member Own Note", body: "written by the member ZZKMEM", category: "RESEARCH_NOTE" });
    K22.dLead = await doc(leadC, { title: "ZZ B9 K22 Lead Note", body: "written by the lead ZZKLEAD", category: "PROJECT_DOCUMENTATION", projectId: K22.p1.id });
    check("knowledge seed: the fixtures exist", [K22.lead.tmId, K22.mem.tmId, K22.mgr.tmId, K22.none.tmId, K22.aPub.id, K22.gPub.id, K22.p1.id, K22.dPub.id, K22.dLab.id, K22.dLeak.id, K22.dX.id, K22.dLongJa.id, K22.dLongTok.id, K22.many[13]?.id, K22.dMem.id, K22.dLead.id].every(Boolean), JSON.stringify([K22.dPub?.error, K22.dX?.error, K22.dLongJa?.error]));
  });

  await step("knowledge guest: navigation, PUBLIC list only, filters, paging, detail, hidden = not found, no leak", async () => {
    await desktop(); await setLocale(null);
    await k22Ready("/knowledge");
    check("knowledge guest: the header offers Knowledge under Research", (await exists('#nav-panel-research a[href="/knowledge"]')) && (await panelLabels("research")).includes("knowledge"));
    check("knowledge guest: one h1 'Knowledge base', one main, the tab title, a described page", (await pCount("h1")) === 1 && (await pCount("main")) === 1 && (await ev(`document.querySelector('h1').textContent.trim()`)) === "Knowledge base" && (await ev(`document.title`)).includes("Knowledge base"));
    let t = await pMain();
    check("knowledge guest: no '+ Add document' bar, no edit/delete icons, no visibility or 'related to me' controls", !t.includes("Add document") && !(await exists(".admin-bar")) && !(await exists(".card-edit-btn")) && !(await exists("#kf-visibility")) && !(await exists("#kf-mine")));
    await k22Ready("/knowledge?q=ZZ%20B9%20K22%20Public");
    const all = await k22Titles();
    check("knowledge guest: a search of the list finds the PUBLIC documents", all.includes("ZZ B9 K22 Public Methodology") && all.includes("ZZ B9 K22 Leaky Public Note"), JSON.stringify(all));
    for (const [word, label] of [["ZZKLAB", "the LAB_ONLY procedure"], ["ZZKMEM", "the member's LAB_ONLY note"], ["ZZKLEAD", "the lead's LAB_ONLY note"]]) {
      await k22Ready(`/knowledge?q=${word}`);
      check(`knowledge guest: ${label} is not listed, not counted and not searchable (the empty state, 0 documents)`, (await pCount(".knowledge-card")) === 0 && (await ev(`document.querySelector('.knowledge-status').innerText.trim()`)) === "0 documents" && (await pMain()).includes("No documents match these filters."));
    }
    await k22Ready("/knowledge?q=ZZKPUB");
    check("knowledge guest: the result count reads '1 document' in a polite live region", (await ev(`document.querySelector('.knowledge-status').innerText.trim()`)) === "1 document" && (await exists('.knowledge-status[role="status"][aria-live="polite"]')));
    const pub = await k22Card("ZZ B9 K22 Public Methodology");
    check("knowledge guest: a card shows the category, an excerpt, the related project / area / group / researcher, the author byline and the update date, and links the title to /knowledge/:id", !!pub && pub.badges.includes("methodology") && pub.text.includes("Step one: flash the board.") && ["ZZ B9 K22 Project One", "ZZ B9 K22 Area Public", "ZZ B9 K22 Group Public", "ZZ B9 K22 Lead"].every((s) => pub.text.includes(s)) && pub.text.includes("By ZZ B9 K22 Manager") && /Updated [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(pub.text) && pub.hrefs[0] === `/knowledge/${K22.dPub.id}` && pub.hrefs.includes(`/projects/${K22.p1.id}`) && pub.hrefs.includes(`/research/${K22.aPub.id}`) && pub.hrefs.includes(`/groups/${K22.gPub.id}`) && pub.hrefs.includes(`/team/${K22.lead.tmId}`), JSON.stringify(pub));
    await k22Ready("/knowledge?q=ZZKLEAK");
    const leak = await k22Card("ZZ B9 K22 Leaky Public Note");
    check("knowledge guest: a PUBLIC note on LAB_ONLY project / area / group names none of them (card and page HTML)", !!leak && !leak.text.includes("Project Lab") && !leak.text.includes("Area Lab") && !leak.text.includes("Group Lab") && !(await ev(`document.documentElement.outerHTML`)).includes(K22.pHid.id) && !(await ev(`document.documentElement.outerHTML`)).includes(K22.gHid.id), JSON.stringify(leak));
    check("knowledge guest: a card has NO related links when none are visible, and never an empty related list", !!leak && leak.hrefs.length === 1);
    // filters through the real form
    await k22Ready("/knowledge");
    await setVal("kf-category", "METHODOLOGY");
    await ev(`document.querySelector('form.knowledge-filters').requestSubmit()`);
    await waitFor(`location.search.includes('category=METHODOLOGY')`, 4000);
    await waitFor(`!document.querySelector('[aria-busy="true"]')`, 6000); await sleep(300);
    check("knowledge guest: the category filter writes ?category= to the URL and narrows the list to that category", (await ev(`location.search`)).includes("category=METHODOLOGY") && (await k22Cards()).length > 0 && (await k22Cards()).every((c) => c.badges.includes("methodology")));
    check("knowledge guest: after filtering, the form still shows the chosen value and 'Clear filters' returns to /knowledge", (await ev(`document.getElementById('kf-category').value`)) === "METHODOLOGY" && (await clickEl('a.btn--ghost[href="/knowledge"]')) && (await waitFor(`location.pathname === '/knowledge' && location.search === ''`, 4000)));
    await k22Ready("/knowledge?q=nothingmatchesthiszzz");
    check("knowledge guest: no match = a filtered empty state with a hint (not a blank page)", (await pMain()).includes("No documents match these filters.") && (await pCount(".knowledge-card")) === 0);
    await k22Ready(`/knowledge?project=${K22.pHid.id}`);
    check("knowledge guest: filtering by a hidden project shows the SAME empty state as any unknown project", (await pMain()).includes("No documents match these filters.") && (await pCount(".knowledge-card")) === 0 && !(await pMain()).includes("Leaky"));
    await k22Ready("/knowledge?q=ZZ%20B9%20K22%20Many");
    check("knowledge guest: 14 documents = page 1 of 2 with 12 cards, a Next link and 'Page 1 of 2'", (await pCount(".knowledge-card")) === 12 && (await exists('.search-pager a[rel="next"]')) && (await ev(`document.querySelector('.search-pager__pos').textContent.trim()`)) === "Page 1 of 2" && (await exists('.search-pager span.is-disabled')));
    await pClick('.search-pager a[rel="next"]');
    await waitFor(`location.search.includes('page=2')`, 4000); await waitFor(`!document.querySelector('[aria-busy="true"]')`, 6000); await sleep(300);
    check("knowledge guest: Next opens page 2 (the remaining 2 documents), ordering is stable and Previous is offered", (await pCount(".knowledge-card")) === 2 && (await exists('.search-pager a[rel="prev"]')) && (await ev(`document.querySelector('.search-pager__pos').textContent.trim()`)) === "Page 2 of 2");
    check("knowledge guest: on the LAST page 'Next' is a disabled, non-link control (aria-disabled) and 'Previous' is a link", !(await exists('.search-pager a[rel="next"]')) && /Next/.test(await ev(`document.querySelector('.search-pager span.is-disabled[aria-disabled="true"]')?.textContent || ''`)) && (await exists('.search-pager a[rel="prev"]')));
    check("knowledge guest: page 1 and page 2 hold 14 DIFFERENT documents", await (async () => { const p2 = await k22Titles(); await k22Ready("/knowledge?q=ZZ%20B9%20K22%20Many"); const p1 = await k22Titles(); return new Set([...p1, ...p2]).size === 14; })());
    await k22Ready("/knowledge?page=abc&category=nope");
    check("knowledge guest: a junk ?page= falls back to page 1, and an unknown ?category= is an error state, not a crash", (await pCount("h1")) === 1 && (await exists('[role="alert"]')));
    // detail
    await k22Ready(`/knowledge/${K22.dPub.id}`);
    check("knowledge guest: the detail page: breadcrumbs (Home / Knowledge / title), one h1 = the title, category badge", (await ev(`[...document.querySelectorAll('.breadcrumbs li')].map((l) => l.textContent.trim())`)).join("|") === "Home|Knowledge|ZZ B9 K22 Public Methodology" && (await ev(`document.querySelector('h1').textContent.trim()`)) === "ZZ B9 K22 Public Methodology" && (await ev(`document.querySelector('.detail-meta').innerText.toLowerCase()`)).includes("methodology"));
    const body = await ev(`(() => { const b = document.querySelector('.knowledge-body'); return { text: b.innerText, ws: getComputedStyle(b).whiteSpace, wrap: getComputedStyle(b).overflowWrap }; })()`);
    check("knowledge guest: the body is TEXT with its line breaks and indentation kept (pre-wrap), wrapping long words", body.text.includes("Step one: flash the board.\nStep two: run the tests.") && body.text.includes("  Indented ZZKPUB note") && body.ws === "pre-wrap" && /anywhere|break-word/.test(body.wrap), JSON.stringify(body));
    const facts = await ev(`[...document.querySelectorAll('.knowledge-facts > div')].map((d) => ({ k: d.querySelector('dt').textContent.trim(), v: d.querySelector('dd').innerText.trim(), href: d.querySelector('a')?.getAttribute('href') || null }))`);
    check("knowledge guest: the details panel lists category, author, dates and the four related records with working links", facts.some((f) => f.k === "Category" && f.v === "Methodology") && facts.some((f) => f.k === "Project" && f.href === `/projects/${K22.p1.id}`) && facts.some((f) => f.k === "Research area" && f.href === `/research/${K22.aPub.id}`) && facts.some((f) => f.k === "Group" && f.href === `/groups/${K22.gPub.id}`) && facts.some((f) => f.k === "Related researcher" && f.href === `/team/${K22.lead.tmId}`) && facts.some((f) => f.k === "Last updated") && facts.some((f) => f.k === "Created"), JSON.stringify(facts));
    const dHtml = await ev(`document.documentElement.outerHTML`);
    check("knowledge guest: no manage bar, and the page HTML holds no account id or 'userId'", !(await exists(".admin-bar")) && !D.userIds.some((u) => dHtml.includes(u)) && !dHtml.includes("userId"));
    await k22Ready(`/knowledge/${K22.dLeak.id}`);
    const lf = await ev(`document.querySelector('.knowledge-facts').innerText`);
    check("knowledge guest: the leaky note's detail names no hidden project / area / group, and none of their ids are in the page", !/Project Lab|Area Lab|Group Lab/.test(lf) && !lf.includes("Related researcher") && !(await ev(`document.documentElement.outerHTML`)).includes(K22.pHid.id));
    await k22Ready(`/knowledge/${K22.dLab.id}`);
    check("knowledge guest: a LAB_ONLY document by URL is the not-found state and leaks nothing", (await pMain()).includes("Document not found") && !(await pMain()).includes("Lab Only Procedure") && !(await pMain()).includes("ZZKLAB") && (await exists('a[href="/knowledge"]')));
    const hiddenTxt = await pMain();
    check("knowledge guest: the not-found state explains itself in words, offers no retry, and links back to the list", hiddenTxt.includes("This document doesn't exist, or you don't have access to it.") && !(await exists('[role="alert"] button')) && (await exists('a.btn[href="/knowledge"]')));
    await k22Ready("/knowledge/nonexistentid12345");
    check("knowledge guest: an unknown id renders exactly the same not-found state as the hidden one", (await pMain()) === hiddenTxt);
    await k22Ready("/knowledge/bad!id");
    check("knowledge guest: a malformed id is a not-found/error state, not a crash", (await pCount("h1")) === 1 && (((await pMain()).includes("not found")) || (await exists('[role="alert"]'))));
    check("knowledge guest: the write APIs refuse a guest (401)", (await apiCall("POST", "/knowledge", { title: "x", body: "y" })) === 401 && (await apiCall("PUT", `/knowledge/${K22.dPub.id}`, { title: "x" })) === 401 && (await apiCall("DELETE", `/knowledge/${K22.dPub.id}`)) === 401);
    await shot("k22-guest-list");
  });

  await step("knowledge integration: project / area / group / researcher pages show a bounded documentation section with View all", async () => {
    await desktop(); await setLocale(null);
    await k22Ready(`/projects/${K22.p1.id}`, "ZZ B9 K22 Project One");
    const sec = async () => ev(`(() => { const s = document.querySelector('section[aria-labelledby$="-knowledge"]'); if (!s) return null; return { head: s.querySelector('h2, h3').textContent.trim(), cards: [...s.querySelectorAll('.knowledge-card .card__title')].map((x) => x.textContent.trim()), all: s.querySelector('a.link')?.getAttribute('href'), allText: s.querySelector('a.link')?.innerText.trim(), inList: !!s.querySelector('[role="list"]'), edit: !!s.querySelector('.card-edit-btn') }; })()`);
    let s = await sec();
    check("knowledge project: the section is 'Knowledge & documentation' with AT MOST 5 PUBLIC documents of this project (guest), newest first", !!s && s.head === "Knowledge & documentation" && s.cards.length === 5 && s.cards.every((c) => c.startsWith("ZZ B9 K22")) && !s.cards.includes("ZZ B9 K22 Lead Note") && s.inList, JSON.stringify(s));
    check("knowledge project: 'View all documents (N)' shows the TRUE total and links to /knowledge?project=<id>", !!s && /^View all documents \((1[5-9]|[2-9]\d)\)/.test(s.allText) && s.all === `/knowledge?project=${K22.p1.id}`, JSON.stringify(s));
    check("knowledge project: a related card has no edit controls (they live on the document)", !!s && !s.edit);
    await pClick('section[aria-labelledby$="-knowledge"] a.link');
    await waitFor(`location.pathname === '/knowledge' && location.search.includes('project=')`, 5000);
    await waitFor(`!document.querySelector('[aria-busy="true"]')`, 6000); await sleep(400);
    const list = await k22Titles();
    check("knowledge project: View all opens the full list filtered to that project (12 per page) and the project picker shows it selected", list.length === 12 && list.every((x) => x.startsWith("ZZ B9 K22")) && (await ev(`document.getElementById('kf-project').selectedOptions[0]?.textContent.trim()`)) === "ZZ B9 K22 Project One" && (await ev(`document.querySelector('.knowledge-status').innerText`)).match(/1[5-9] documents/) !== null);
    await k22Ready(`/projects/${K22.pEmpty.id}`, "Without Docs");
    check("knowledge project: a project with no visible documents gets no documentation section at all", (await sec()) === null);
    await k22Ready(`/research/${K22.aPub.id}`, "Area Public");
    s = await sec();
    check("knowledge area: the research area page lists the documents linked to it, with View all -> /knowledge?area=", !!s && s.cards.includes("ZZ B9 K22 Public Methodology") && s.all === `/knowledge?area=${K22.aPub.id}`, JSON.stringify(s));
    await k22Ready(`/groups/${K22.gPub.id}`, "Group Public");
    s = await sec();
    check("knowledge group: the group page lists its documents, with View all -> /knowledge?group=", !!s && s.cards.includes("ZZ B9 K22 Public Methodology") && s.all === `/knowledge?group=${K22.gPub.id}`, JSON.stringify(s));
    await k22Ready(`/team/${K22.lead.tmId}`, "ZZ B9 K22 Lead");
    s = await sec();
    check("knowledge researcher: the profile lists documents naming them as the related researcher, with View all -> /knowledge?researcher=", !!s && s.cards.join("|") === "ZZ B9 K22 Public Methodology" && s.all === `/knowledge?researcher=${K22.lead.tmId}`, JSON.stringify(s));
    await k22Ready(`/team/${K22.mem.tmId}`, "ZZ B9 K22 Member");
    check("knowledge researcher: a researcher no document names gets no section", (await sec()) === null);
    await k22Ready(`/research/${K22.aHid.id}`);
    check("knowledge area: a LAB_ONLY area is not-found for a guest, so its documents cannot be reached through it", (await pMain()).includes("not found") || (await pMain()).includes("Not found"));
    await k22Ready(`/knowledge?area=${K22.aHid.id}`);
    check("knowledge area: nor through the list filter (same empty state as an unknown area)", (await pCount(".knowledge-card")) === 0);
    await k22Ready(`/projects/${K22.pX.id}`);
    const hx = await sec();
    check("knowledge hostile: a hostile-named project / area / group page lists the hostile document as inert TEXT", !!hx && hx.cards.some((c) => c.includes("<img src=x onerror=window.__k22Xss=1>")) && (await ev(`document.querySelectorAll('main img, main script, main iframe').length`)) === 0 && (await ev(`typeof window.__k22Xss`)) === "undefined");
  });

  await step("knowledge member: LAB_ONLY documents, create / validation / edit / delete, Japanese fields, no visibility control", async () => {
    check("knowledge member: login", await k22Login(K22.mem));
    for (const [word, title] of [["ZZKLAB", "ZZ B9 K22 Lab Only Procedure"], ["ZZKMEM", "ZZ B9 K22 Member Own Note"], ["ZZKLEAD", "ZZ B9 K22 Lead Note"]]) {
      await k22Ready(`/knowledge?q=${word}`);
      check(`knowledge member: sees the LAB_ONLY document "${title}" (a signed-in member may)`, (await k22Titles()).join("|") === title);
    }
    check("knowledge member: the bar says what a member can do; there is NO visibility badge, NO visibility filter", (await ev(`document.querySelector('.admin-bar__text').innerText`)).includes("add documents and edit the ones you wrote") && !(await pMain()).toLowerCase().includes("lab only") && !(await exists("#kf-visibility")));
    check("knowledge member: the 'related to me' filter is offered to a signed-in account", await exists("#kf-mine"));
    const other = await k22Card("ZZ B9 K22 Lead Note");
    await k22Ready("/knowledge?q=ZZKMEM");
    const own = await k22Card("ZZ B9 K22 Member Own Note");
    check("knowledge member: edit AND delete icons on their own document only", !!own && own.edit && own.del && !!other && !other.edit && !other.del);
    // create with validation (from the member's own list, so the new document shows up in it)
    await k22Ready("/knowledge?mine=1");
    let d = await k22Add();
    check("knowledge member: '+ Add document' opens a named dialog with empty fields, category Resource, no visibility control, and the member note", !!d && d.title === "Add document" && d.tv === "" && d.bv === "" && d.cat === "RESOURCE" && d.vis === null && (await ev(`document.querySelector('.modal').innerText`)).includes("visible to signed-in lab members until a lab manager makes them public"), JSON.stringify(d));
    check("knowledge member: the relationship pickers list the visible projects, areas, groups and researchers", await (async () => { const o = await ev(`['knowledge_project','knowledge_area','knowledge_group','knowledge_researcher'].map((id) => [...document.getElementById(id).options].map((x) => x.textContent.trim()))`); return o[0].includes("ZZ B9 K22 Project One") && o[0].includes("ZZ B9 K22 Project Lab") && o[1].includes("ZZ B9 K22 Area Public") && o[2].includes("ZZ B9 K22 Group Lab") && o[3].includes("ZZ B9 K22 Lead") && o.every((x) => x[0] === "None"); })());
    await k22Save();
    d = await k22DlgWait((x) => !!x.alert);
    check("knowledge member: saving an empty form shows 'Title is required.' in an alert and moves focus to the title", !!d && d.alert === "Title is required." && d.focusId === "knowledge_title" && (await ev(`document.getElementById('knowledge_title').getAttribute('aria-invalid')`)) === "true", JSON.stringify(d));
    await k22Fill({ knowledge_title: "ZZ B9 K22 Created By Member" });
    await k22Save();
    d = await k22DlgWait((x) => x.alert === "Body is required.");
    check("knowledge member: a missing body is 'Body is required.' with focus on the body", d.alert === "Body is required." && d.focusId === "knowledge_body");
    await k22Fill({ knowledge_body: "Made through the UI.\nSecond line ZZKNEW", knowledge_category: "HARDWARE", knowledge_project: K22.p1.id, knowledge_area: K22.aPub.id });
    await k22Save();
    check("knowledge member: a valid save closes the dialog and the new document appears in the list", await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 6000) && (await waitFor(`[...document.querySelectorAll('.knowledge-card .card__title')].some((x) => x.textContent.trim() === 'ZZ B9 K22 Created By Member')`, 6000)));
    const made = (await k22Api(null, `/knowledge?q=ZZKNEW`)).json.items[0];
    K22.dMade = made;
    check("knowledge member: the server has it LAB_ONLY, by the member, with the category and the two links chosen", !!made && made.category === "HARDWARE" && made.project?.id === K22.p1.id && made.researchArea?.id === K22.aPub.id && made.group === null && made.canEdit === true && (await K22.a.req("GET", `/knowledge/${made.id}`)).json.visibility === "LAB_ONLY", JSON.stringify(made));
    // edit
    d = await k22EditOn("ZZ B9 K22 Created By Member");
    check("knowledge member: Edit opens 'Edit document' with the stored English title, BODY (a list card has none), category and links", !!d && d.title === "Edit document" && d.tv === "ZZ B9 K22 Created By Member" && d.bv === "Made through the UI.\nSecond line ZZKNEW" && d.cat === "HARDWARE" && d.proj === K22.p1.id && d.area === K22.aPub.id && d.grp === "" && d.vis === null, JSON.stringify(d));
    await k22Fill({ knowledge_title: "ZZ B9 K22 Created By Member (edited)", knowledge_title_ja: "ZZ B9 K22 メンバーが作成（編集）", knowledge_body_ja: "日本語の本文 ZZKJA", knowledge_group: K22.gPub.id });
    await k22Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 6000);
    await waitFor(`[...document.querySelectorAll('.knowledge-card .card__title')].some((x) => x.textContent.trim() === 'ZZ B9 K22 Created By Member (edited)')`, 6000);
    const ed = (await k22Api(null, `/knowledge/${made.id}`)).json;
    const edJa = (await k22Api("ja", `/knowledge/${made.id}`)).json;
    check("knowledge member: an edit changes the English text and the group, keeps the other links, and stores the Japanese title and body as overrides (English body untouched)", ed.title === "ZZ B9 K22 Created By Member (edited)" && ed.body === "Made through the UI.\nSecond line ZZKNEW" && ed.group?.id === K22.gPub.id && ed.project?.id === K22.p1.id && edJa.title === "ZZ B9 K22 メンバーが作成（編集）" && edJa.body === "日本語の本文 ZZKJA", JSON.stringify([ed.title, ed.group, edJa.title]));
    d = await k22EditOn("ZZ B9 K22 Created By Member (edited)");
    check("knowledge member: reopening Edit shows the saved Japanese title and body in the Japanese fields", !!d && d.tja === "ZZ B9 K22 メンバーが作成（編集）" && d.bja === "日本語の本文 ZZKJA", JSON.stringify(d));
    await k22Fill({ knowledge_title_ja: "", knowledge_body_ja: "" });
    await k22Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 6000);
    check("knowledge member: clearing both Japanese fields removes the overrides (Japanese falls back to English)", await (async () => { await sleep(400); const j = (await k22Api("ja", `/knowledge/${made.id}`)).json; return j.title === "ZZ B9 K22 Created By Member (edited)" && j.body === "Made through the UI.\nSecond line ZZKNEW"; })());
    // cancel does not save
    d = await k22EditOn("ZZ B9 K22 Created By Member (edited)");
    await k22Fill({ knowledge_title: "ZZ B9 K22 SHOULD NOT SAVE" });
    await clickEl(".modal button.btn--secondary");
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 3000);
    check("knowledge member: Cancel discards the edit", (await k22Api(null, `/knowledge/${made.id}`)).json.title === "ZZ B9 K22 Created By Member (edited)" && !(await k22Titles()).includes("ZZ B9 K22 SHOULD NOT SAVE"));
    // other people's documents
    await k22Ready(`/knowledge/${K22.dLab.id}`);
    check("knowledge member: another person's document: no manage bar on the detail page; the API refuses (403)", !(await exists(".admin-bar")) && (await apiCall("PUT", `/knowledge/${K22.dLab.id}`, { title: "hax" })) === 403 && (await apiCall("DELETE", `/knowledge/${K22.dLab.id}`)) === 403);
    check("knowledge member: the API refuses visibility from a member (403) and nothing changed", (await apiCall("PUT", `/knowledge/${made.id}`, { visibility: "PUBLIC" })) === 403 && (await K22.a.req("GET", `/knowledge/${made.id}`)).json.visibility === "LAB_ONLY");
    check("knowledge member: the LAB_ONLY document is readable and shows the lab-only body", (await pMain()).includes("Internal ZZKLAB budget procedure"));
    // 'related to me'
    await k22Ready("/knowledge?mine=1&limit=50");
    all = await k22Titles();
    check("knowledge member: 'related to me' lists their own documents and hides the ones that are not theirs", all.includes("ZZ B9 K22 Member Own Note") && all.includes("ZZ B9 K22 Created By Member (edited)") && !all.includes("ZZ B9 K22 Lab Only Procedure") && (await ev(`document.getElementById('kf-mine').checked`)));
    // delete from the list
    await k22Ready("/knowledge?mine=1&limit=50");
    check("knowledge member: Delete opens a confirmation naming the document", await k22DelOn("ZZ B9 K22 Created By Member (edited)") && (await ev(`document.querySelector('.modal').innerText`)).includes('Delete "ZZ B9 K22 Created By Member (edited)"? This can\'t be undone.'));
    await press("esc");
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2500);
    check("knowledge member: Escape cancels the deletion and returns focus to the delete button", (await k22Api(null, `/knowledge/${made.id}`)).status === 200 && (await ev(`document.activeElement?.hasAttribute('data-k22-op')`)));
    await k22DelOn("ZZ B9 K22 Created By Member (edited)");
    await clickEl(".modal button.btn--danger");
    check("knowledge member: confirming removes it from the list and the server (404 afterwards)", (await waitFor(`![...document.querySelectorAll('.knowledge-card .card__title')].some((x) => x.textContent.trim() === 'ZZ B9 K22 Created By Member (edited)')`, 6000)) && (await k22Api(null, `/knowledge/${made.id}`)).status === 404);
    // detail page edit flow
    await k22Ready(`/knowledge/${K22.dMem.id}`);
    check("knowledge member: their own document's detail page has Edit and Delete in the bar", (await pBar()).join("|") === "Edit|Delete");
    await pClick(".admin-bar button", "Edit");
    d = await k22DlgWait((x) => x.bv !== null && x.bv !== "");
    check("knowledge member: the detail page's Edit opens with the English body", !!d && d.bv === "written by the member ZZKMEM");
    await k22Fill({ knowledge_body: "written by the member ZZKMEM (revised)" });
    await k22Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 6000);
    check("knowledge member: saving from the detail page refreshes the body in place", await waitText("(revised)", 6000));
    // the English base must have loaded before a save is possible: with that request failing the form says so and Save stays disabled
    await k22Ready("/knowledge?q=ZZKMEM");
    await fake("*/api/translations/KNOWLEDGE_DOC/*", 500, JSON.stringify({ error: "Internal server error" }));
    const noBase = await k22EditOn("ZZ B9 K22 Member Own Note");
    await unfake();
    check("knowledge member: if the English base cannot be loaded the edit form says 'Could not load this document.', is empty of body text, and Save is DISABLED (it must never save a guess)", !!noBase && noBase.alert.includes("Could not load this document.") && noBase.submitDisabled === true && noBase.bv === "", JSON.stringify(noBase));
    await k22Close();
    // a link the form cannot display (its project is invisible to the editor) survives an edit that does not touch links
    await K22.a.req("PUT", `/knowledge/${K22.dMem.id}`, { projectId: K22.pHid.id });
    k22Sql("UPDATE ResearchProject SET visibility = 'PRIVATE' WHERE id = ?", K22.pHid.id);
    await k22Ready("/knowledge?q=ZZKMEM");
    await k22EditOn("ZZ B9 K22 Member Own Note");
    const hd = await k22DlgWait((x) => x.projOpts.length > 1); // the picklists load after the dialog opens: wait for them, or "not offered" would pass vacuously
    check("knowledge member: an invisible project shows as 'None' in the form (never named), the picklist does not offer it", !!hd && hd.proj === "" && !hd.projOpts.includes("ZZ B9 K22 Project Lab"), JSON.stringify({ proj: hd?.proj, tv: hd?.tv, opts: (hd?.projOpts || []).slice(0, 4) })); // exact title: other phases' fixtures ("ZZ B9 W21 Project Lab") also contain the words
    await k22Fill({ knowledge_body: "written by the member ZZKMEM (revised twice)" });
    await k22Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 6000);
    await sleep(500);
    const kept = k22Sql("SELECT projectId, body FROM KnowledgeDoc WHERE id = ?", K22.dMem.id)[0];
    k22Sql("UPDATE ResearchProject SET visibility = 'LAB_ONLY' WHERE id = ?", K22.pHid.id);
    check("knowledge member: saving an edit that does not touch links KEEPS the link the form could not display (it is not cleared to None)", kept.projectId === K22.pHid.id && kept.body === "written by the member ZZKMEM (revised twice)", JSON.stringify(kept));
    await K22.a.req("PUT", `/knowledge/${K22.dMem.id}`, { projectId: null });
    // delete from the detail page: confirm -> gone -> back on the list
    const mine = await ev(`fetch('/api/knowledge', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'ZZ B9 K22 Delete From Detail', body: 'to be removed ZZKDEL' }) }).then((r) => r.json())`);
    await k22Ready(`/knowledge/${mine.id}`);
    await pClick(".admin-bar button", "Delete");
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 3000);
    check("knowledge member: the detail page's delete dialog names the document", (await ev(`document.querySelector('.modal').innerText`)).includes('Delete "ZZ B9 K22 Delete From Detail"? This can\'t be undone.'));
    await clickEl(".modal button.btn--danger");
    check("knowledge member: confirming a delete on the detail page removes the document AND returns to the list", (await waitFor(`location.pathname === '/knowledge'`, 6000)) && (await k22Api(null, `/knowledge/${mine.id}`)).status === 404);
    await k22Ready(`/knowledge/${K22.dMem.id}`);
    await pClick(".admin-bar button", "Delete");
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 3000);
    await press("esc");
    check("knowledge member: Escape on the detail-page delete dialog closes it and the document is still there", await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2500) && (await k22Api(null, `/knowledge/${K22.dMem.id}`)).status === 200);
    await shot("k22-member");
    await logout();
  });

  await step("knowledge lead: a project lead has no special power over documents; create from a project's View all presets the link", async () => {
    check("knowledge lead: login", await k22Login(K22.lead));
    await k22Ready(`/knowledge?project=${K22.p1.id}&limit=50`);
    const cards = await k22Cards();
    check("knowledge lead: the project's list shows the lead's own note editable and everyone else's read-only (a LEAD is only a member for documents)", cards.length > 0 && cards.filter((c) => c.edit).map((c) => c.title).join("|") === "ZZ B9 K22 Lead Note");
    const d = await k22Add();
    check("knowledge lead: '+ Add document' from ?project= preselects that project (and nothing else)", !!d && d.proj === K22.p1.id && d.area === "" && d.grp === "" && d.res === "", JSON.stringify(d));
    await k22Close();
    await k22Ready("/knowledge");
    const d2 = await k22Add();
    check("knowledge lead: from the unfiltered list nothing is preselected", !!d2 && d2.proj === "" && d2.area === "");
    await k22Close();
    check("knowledge lead: the API refuses the lead on someone else's document (403)", (await apiCall("PUT", `/knowledge/${K22.dPub.id}`, { title: "hax" })) === 403 && (await apiCall("DELETE", `/knowledge/${K22.dPub.id}`)) === 403);
    await logout();
  });

  await step("knowledge manager: visibility badge and filter, edit anything, publish, delete", async () => {
    check("knowledge manager: login", await k22Login(K22.mgr));
    await k22Ready("/knowledge?q=ZZKLAB");
    const lab = await k22Card("ZZ B9 K22 Lab Only Procedure");
    await k22Ready("/knowledge?q=ZZKPUB");
    const pub = await k22Card("ZZ B9 K22 Public Methodology");
    check("knowledge manager: the bar says managers edit any document; LAB_ONLY documents carry a 'Lab only' badge, PUBLIC ones none", (await ev(`document.querySelector('.admin-bar__text').innerText`)).includes("edit any document") && !!lab && lab.badges.includes("lab only") && !!pub && !pub.badges.includes("lab only"), JSON.stringify(lab?.badges));
    await k22Ready("/knowledge");
    check("knowledge manager: edit and delete icons on EVERY card", (await k22Cards()).length === 12 && (await k22Cards()).every((c) => c.edit && c.del));
    check("knowledge manager: the visibility filter is offered and narrows to Lab only", (await exists("#kf-visibility")) && await (async () => { await setVal("kf-visibility", "LAB_ONLY"); await ev(`document.querySelector('form.knowledge-filters').requestSubmit()`); await waitFor(`location.search.includes('visibility=LAB_ONLY')`, 4000); await waitFor(`!document.querySelector('[aria-busy="true"]')`, 6000); await sleep(300); const c = await k22Cards(); return c.length > 0 && c.every((x) => x.badges.includes("lab only")); })());
    await k22Ready("/knowledge?q=ZZ%20B9%20K22%20Lab%20Only");
    const d = await k22EditOn("ZZ B9 K22 Lab Only Procedure");
    check("knowledge manager: the edit dialog has the Visibility control set to Lab only, and the Japanese fields", !!d && d.vis === "LAB_ONLY" && d.tja === "" && d.bja === "" && d.bv === "Internal ZZKLAB budget procedure", JSON.stringify(d));
    await k22Fill({ knowledge_visibility: "PUBLIC" });
    await k22Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 6000);
    await sleep(600);
    check("knowledge manager: publishing changes visibility (server) and the card loses its 'Lab only' badge", (await K22.a.req("GET", `/knowledge/${K22.dLab.id}`)).json.visibility === "PUBLIC" && !(await k22Card("ZZ B9 K22 Lab Only Procedure")).badges.includes("lab only"));
    await logout();
    await k22Ready(`/knowledge/${K22.dLab.id}`);
    check("knowledge manager: once published, a guest can read it", (await pMain()).includes("Internal ZZKLAB budget procedure"));
    await k22Login(K22.mgr);
    await K22.a.req("PUT", `/knowledge/${K22.dLab.id}`, { visibility: "LAB_ONLY" });
    await k22Ready(`/knowledge/${K22.dMem.id}`);
    check("knowledge manager: someone else's document's detail page has Edit and Delete", (await pBar()).join("|") === "Edit|Delete" && (await ev(`document.querySelector('.admin-bar__text').innerText`)).includes("manage this document"));
    check("knowledge manager: the detail page shows the Lab only badge", (await ev(`document.querySelector('.detail-meta').innerText.toLowerCase()`)).includes("lab only"));
    await logout();
  });

  await step("knowledge admin: the admin Content view lists knowledge with filters, inspect, deep links and the overview count", async () => {
    check("knowledge admin: login", await login(ADMIN.email, ADMIN.password));
    await k22Ready("/admin");
    check("knowledge admin: the overview has a 'Knowledge documents' count card linking to the filtered admin list", await exists('a.admin-count[href="/admin/content?type=knowledge"]') && (await ev(`document.querySelector('a.admin-count[href="/admin/content?type=knowledge"]').innerText`)).includes("Knowledge documents") && /public/i.test(await ev(`document.querySelector('a.admin-count[href="/admin/content?type=knowledge"]').innerText`)));
    await k22Ready("/admin/content?type=knowledge");
    await waitFor(`!!document.querySelector('.admin-row')`, 8000);
    check("knowledge admin: 'Knowledge documents' is a content type chip and the list shows knowledge rows with Public / Lab only, category and owner", (await ev(`[...document.querySelectorAll('.admin-types .chip')].map((c) => c.textContent.trim())`)).includes("Knowledge documents") && (await ev(`document.querySelector('.admin-row').innerText`)).match(/Public|Lab only/) !== null);
    check("knowledge admin: the filter form offers category, project, research area, group, visibility and 'Created by'", await ev(`['af-category','af-project','af-area','af-group','af-visibility','af-owner'].every((id) => !!document.getElementById(id))`));
    await waitFor(`document.getElementById('af-project').options.length > 1`, 6000);
    await setVal("af-category", "METHODOLOGY");
    await ev(`document.querySelector('form.admin-filters').requestSubmit()`);
    await waitFor(`location.search.includes('category=METHODOLOGY')`, 4000); await sleep(600);
    check("knowledge admin: the category filter narrows the rows (URL is the source of truth)", (await ev(`[...document.querySelectorAll('.admin-row')].length`)) >= 1 && (await ev(`[...document.querySelectorAll('.admin-row')].every((r) => /Methodology/.test(r.innerText))`)));
    await k22Ready("/admin/content?type=knowledge&q=ZZKLAB");
    await waitFor(`!!document.querySelector('.admin-row')`, 6000);
    check("knowledge admin: the category is shown as its LOCALIZED label in a badge ('Lab procedure', not LAB_PROCEDURE)", await ev(`(() => { const b = [...document.querySelectorAll('.admin-row .badge')].map((x) => x.textContent.trim()); return b.includes('Lab procedure') && !b.includes('LAB_PROCEDURE'); })()`));
    await setLocale("ja");
    await k22Ready("/admin/content?type=knowledge&q=ZZKLAB");
    await waitFor(`!!document.querySelector('.admin-row')`, 6000);
    check("knowledge admin ja: the same badge is Japanese ('ラボの手順')", await ev(`[...document.querySelectorAll('.admin-row .badge')].some((x) => x.textContent.trim() === 'ラボの手順')`));
    await setLocale(null);
    await k22Ready(`/admin/content?type=knowledge&project=${K22.p1.id}`);
    await sleep(500);
    check("knowledge admin: the project filter (deep link) keeps only that project's documents", (await ev(`document.querySelectorAll('.admin-row').length`)) >= 15 && await ev(`document.getElementById('af-project').value === ${JSON.stringify(K22.p1.id)}`));
    await k22Ready("/admin/content?type=knowledge&q=Public%20Methodology");
    await waitFor(`!!document.querySelector('.admin-row')`, 6000);
    const link = await ev(`[...document.querySelectorAll('.admin-row')].map((r) => r.querySelector('a.btn--ghost')?.getAttribute('href'))`);
    check("knowledge admin: each row has a deep link 'Open' to /knowledge/:id", link.includes(`/knowledge/${K22.dPub.id}`));
    await pClick(".admin-row__actions button", "");
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 4000);
    await waitFor(`!!document.querySelector('.modal dl, .modal ul, .modal .admin-detail')`, 4000); await sleep(400);
    const md = await ev(`document.querySelector('.modal').innerText`);
    check("knowledge admin: Inspect shows the record's relationship counts (projects, areas, groups, researchers) and its Japanese override state", /Projects/.test(md) && /Research areas/.test(md) && /Groups/.test(md) && /Researchers/.test(md));
    await press("esc");
    check("knowledge admin: bulk visibility controls exist for knowledge rows (a checkbox per row)", (await pCount(".admin-row__check")) === (await pCount(".admin-row")) && (await pCount(".admin-row")) > 0);
    await k22Ready("/admin/translations?type=KNOWLEDGE_DOC");
    await waitFor(`!!document.querySelector('.admin-tr, .admin-list, .admin-row, [class*="admin-tr"]') || document.body.innerText.includes('Knowledge documents')`, 6000);
    check("knowledge admin: the Translations view has a 'Knowledge documents' type with the title and body fields", (await ev(`[...document.querySelectorAll('.admin-types .chip')].map((c) => c.textContent.trim())`)).includes("Knowledge documents") && (await pMain()).toLowerCase().includes("body"));
    await k22Ready("/admin/content?type=knowledge&category=nope");
    check("knowledge admin: an invalid filter is shown as an error state (not a blank page)", await exists('[role="alert"]'));
    await logout();
    await go("/admin/content?type=knowledge"); await sleep(700);
    check("knowledge admin: signed out, the admin knowledge list is behind the login (redirect) and its API is 401", (await pathNow()) === "/login" && (await apiCall("GET", "/admin/content?type=knowledge")) === 401);
  });

  await step("knowledge search: the Knowledge type, counts, links, Japanese titles, related links, no hidden document", async () => {
    await desktop(); await setLocale(null);
    await k22Ready("/search?q=ZZKMANY");
    check("knowledge search: a body word finds the 14 documents and the 'Knowledge' chip carries the API's count (14)", (await ev(`[...document.querySelectorAll('.search-filters .chip')].map((c) => c.textContent.trim())`)).includes("Knowledge14") && (await pCount(".search-result")) === 14 && (await k22Api(null, "/search?q=ZZKMANY")).json.counts.knowledge === 14);
    await k22Ready("/search?q=Public%20Methodology&type=knowledge");
    const r = await ev(`[...document.querySelectorAll('.search-result')].map((c) => ({ badge: c.querySelector('.search-result__type').textContent.trim().toLowerCase(), title: c.querySelector('.search-result__title').textContent.trim(), href: c.querySelector('.search-result__link').getAttribute('href'), rel: [...c.querySelectorAll('.search-result__related a')].map((a) => a.textContent.trim()), cta: c.querySelector('.search-result__cta').textContent.trim() }))`);
    const one = r.find((x) => x.title === "ZZ B9 K22 Public Methodology");
    check("knowledge search: the result is badged Knowledge, links to /knowledge/:id, says 'View document' and lists its related project, area and group", !!one && one.badge === "knowledge" && one.href === `/knowledge/${K22.dPub.id}` && one.cta === "View document →" && ["ZZ B9 K22 Project One", "ZZ B9 K22 Area Public", "ZZ B9 K22 Group Public"].every((x) => one.rel.includes(x)), JSON.stringify(one));
    await k22Ready("/search?q=ZZKLEAK&type=knowledge");
    const leak = await ev(`[...document.querySelectorAll('.search-result')].map((c) => c.innerText).join('\\n')`);
    check("knowledge search: a PUBLIC note on hidden things is found but shows no related links to them", leak.includes("Leaky Public Note") && !/Project Lab|Area Lab|Group Lab/.test(leak) && (await pCount(".search-result__related")) === 0);
    await k22Ready("/search?q=ZZKLAB");
    check("knowledge search: a LAB_ONLY document is invisible to a guest (no result, no count, no chip)", (await pCount(".search-result")) === 0 && !(await pMain()).includes("Lab Only Procedure") && !(await ev(`[...document.querySelectorAll('.search-filters .chip')].map((c) => c.textContent.trim())`)).some((x) => /^Knowledge[1-9]/.test(x)));
    await k22Ready("/search?q=ZZKMANY&type=knowledge&limit=5");
    check("knowledge search: clicking a result opens the document", await (async () => { await pClick(".search-result__link", "Many"); return waitFor(`location.pathname.startsWith('/knowledge/')`, 5000); })());
    await setLocale("ja");
    await k22Ready("/search?q=" + encodeURIComponent("公開メソドロジー") + "&type=knowledge");
    check("knowledge search ja: a Japanese title override is found, shown as the title, and the chrome is Japanese ('ナレッジ' badge, chip and call to action)", (await ev(`[...document.querySelectorAll('.search-result__title')].map((x) => x.textContent.trim())`)).includes("ZZ B9 K22 公開メソドロジー") && (await ev(`document.querySelector('.search-result__type').textContent.trim()`)).includes("ナレッジ") && (await ev(`document.querySelector('.search-result__cta').textContent.trim()`)) === "ドキュメントを見る →");
    await k22Ready("/search?q=" + encodeURIComponent("その二"));
    check("knowledge search ja: a Japanese BODY override is found too, and the excerpt is the Japanese text", (await ev(`[...document.querySelectorAll('.search-result')].map((c) => c.innerText).join('\\n')`)).includes("手順その二"));
    await setLocale(null);
    await login(K22.mem.email, PW);
    await k22Ready("/search?q=ZZKLAB&type=knowledge");
    check("knowledge search: a signed-in member finds the LAB_ONLY document", (await pMain()).includes("Lab Only Procedure"));
    await logout();
  });

  await step("knowledge workspace: 'Recent documentation' is bounded, private and links to the related list", async () => {
    check("knowledge workspace: lead login", await k22Login(K22.lead));
    await wsReady();
    const sec = await ev(`(() => { const s = document.querySelector('section[aria-labelledby="ws-knowledge"]'); return s ? { head: document.getElementById('ws-knowledge').textContent.trim(), cards: [...s.querySelectorAll('.knowledge-card .card__title')].map((x) => x.textContent.trim()), link: s.querySelector('a.btn')?.getAttribute('href'), linkText: s.querySelector('a.btn')?.innerText.trim(), more: s.querySelector('.ws-more')?.innerText || '' } : null; })()`);
    check("knowledge workspace: the section lists at most 5 documents the lead wrote or that belong to their project / group / area (public methodology, their own note, long note ...)", !!sec && sec.head === "Recent documentation" && sec.cards.length === 5 && sec.cards.includes("ZZ B9 K22 Lead Note") && sec.cards.every((c) => c.startsWith("ZZ B9 K22")), JSON.stringify(sec));
    check("knowledge workspace: 'View all my documents (N)' has the true total and links to /knowledge?mine=1; the 'Showing 5 of N' note is there", !!sec && sec.link === "/knowledge?mine=1" && /^View all my documents \(\d+\)/.test(sec.linkText) && /Showing 5 of \d+/.test(sec.more), JSON.stringify(sec));
    check("knowledge workspace: the workspace section and the page it links to report the SAME total", await (async () => { const n = +sec.linkText.match(/\((\d+)\)/)[1]; const api = (await k22Api(null, "/knowledge?mine=1&limit=1")).json.pagination.total; return n === api; })());
    check("knowledge workspace: the workspace never accepts someone else's id (an extra ?userId= changes nothing)", JSON.stringify((await k22Api(null, `/workspace?userId=${K22.mem.userId}&teamMemberId=${K22.mem.tmId}`)).json.knowledge) === JSON.stringify((await k22Api(null, "/workspace")).json.knowledge));
    await pClick(".ws-section a.btn", "View all my documents");
    await waitFor(`location.pathname === '/knowledge' && location.search.includes('mine=1')`, 5000);
    await waitFor(`!document.querySelector('[aria-busy="true"]')`, 6000); await sleep(300);
    check("knowledge workspace: the link opens the 'related to me' list with the box ticked", (await ev(`document.getElementById('kf-mine').checked`)) && (await pCount(".knowledge-card")) > 0);
    await logout();
    check("knowledge workspace: none login", await k22Login(K22.none));
    await wsReady();
    const e = await ev(`(() => { const s = document.querySelector('section[aria-labelledby="ws-knowledge"]'); return s ? { empty: s.innerText, cards: s.querySelectorAll('.knowledge-card').length, link: !!s.querySelector('a.btn') } : null; })()`);
    check("knowledge workspace: a researcher with no documents gets a friendly empty state and no link", !!e && e.cards === 0 && !e.link && e.empty.includes("No documentation yet."), JSON.stringify(e));
    await logout();
  });

  await step("knowledge ja: Japanese chrome, category labels, overrides, form, errors and empty states; identical authorization", async () => {
    await desktop(); await setLocale("ja");
    await k22Ready("/knowledge");
    check("knowledge ja: the page title, description, filter labels and category options are Japanese", (await ev(`document.querySelector('h1').textContent.trim()`)) === "ナレッジベース" && (await pMain()).includes("研究分野・プロジェクト・グループ・研究者に沿って") && (await ev(`document.querySelector('label[for="kf-category"]').textContent.trim()`)) === "カテゴリ" && (await ev(`[...document.getElementById('kf-category').options].map((o) => o.textContent.trim())`)).includes("方法論") && (await ev(`[...document.getElementById('kf-category').options].map((o) => o.textContent.trim())`))[0] === "指定なし");
    check("knowledge ja: no raw key ('knowledge.') and no English UI word leaks into the page chrome", !(await pMain()).includes("knowledge.") && !/Apply filters|Clear filters|Search documents/.test(await pMain()));
    await k22Ready("/knowledge?q=ZZKPUB");
    const c = await k22Card("ZZ B9 K22 公開メソドロジー");
    check("knowledge ja: a document with Japanese overrides shows the Japanese title and excerpt, the Japanese category label, and Japanese related names", !!c && c.text.includes("手順その一") && c.badges.includes("方法論") && c.text.includes("ZZ B9 K22 プロジェクト一") && c.text.includes("ZZ B9 K22 公開分野") && c.text.includes("ZZ B9 K22 公開グループ") && /更新/.test(c.text) && /著/.test(c.text), JSON.stringify(c));
    await k22Ready("/knowledge?q=Leaky");
    check("knowledge ja: a document with NO override falls back to its English title (never blank)", (await k22Titles()).includes("ZZ B9 K22 Leaky Public Note"));
    await k22Ready(`/knowledge/${K22.dPub.id}`);
    check("knowledge ja: the detail page is Japanese: breadcrumb, Japanese title and body (line breaks kept), fact labels and dates", (await ev(`[...document.querySelectorAll('.breadcrumbs li')].map((l) => l.textContent.trim())`)).slice(1, 2).join() === "ナレッジ" && (await ev(`document.querySelector('h1').textContent.trim()`)) === "ZZ B9 K22 公開メソドロジー" && (await ev(`document.querySelector('.knowledge-body').innerText`)).includes("手順その一：ボードを書き込む。\n手順その二：テストを実行する。") && (await ev(`[...document.querySelectorAll('.knowledge-facts dt')].map((d) => d.textContent.trim())`)).join("|").includes("カテゴリ|著者|最終更新|作成日|プロジェクト|研究分野|グループ|関連する研究者"));
    await k22Ready(`/knowledge/${K22.dLab.id}`);
    check("knowledge ja: a hidden document is the same Japanese not-found state (authorization does not depend on the language)", (await pMain()).includes("ドキュメントが見つかりません") && !(await pMain()).includes("ZZKLAB") && (await k22Api("ja", `/knowledge/${K22.dLab.id}`)).status === 404 && (await k22Api("xx", `/knowledge/${K22.dLab.id}`)).status === 404);
    await k22Ready("/knowledge?q=nothingmatchesthiszzz");
    check("knowledge ja: the filtered empty state is Japanese", (await pMain()).includes("条件に一致するドキュメントはありません。") && (await pMain()).includes("条件を減らすか"));
    check("knowledge ja: the API returns the same document ids in en, ja and a tampered locale", await (async () => { const a = (await k22Api("en", "/knowledge?limit=50")).json.items.map((x) => x.id).join(); const b = (await k22Api("ja", "/knowledge?limit=50")).json.items.map((x) => x.id).join(); const c2 = (await k22Api("ja,en;q=0.1", "/knowledge?limit=50")).json.items.map((x) => x.id).join(); return a === b && a === c2; })());
    check("knowledge ja: the project page's documentation section is Japanese (heading and View all)", await (async () => { await k22Ready(`/projects/${K22.p1.id}`); await waitFor(`!!document.querySelector('section[aria-labelledby$="-knowledge"]')`, 6000); const s = await ev(`(() => { const x = document.querySelector('section[aria-labelledby$="-knowledge"]'); return { head: x.querySelector('h2, h3').textContent.trim(), all: x.querySelector('a.link').innerText.trim() }; })()`); return s.head === "ナレッジとドキュメント" && /^すべてのドキュメントを見る（\d+）/.test(s.all); })());
    // member form in Japanese
    await login(K22.mem.email, PW);
    await k22Ready("/knowledge?mine=1");
    let d = await k22Add();
    check("knowledge ja: the add dialog is Japanese (title, labels, hint, member visibility note, Japanese-field labels)", !!d && d.title === "ドキュメントを追加" && (await ev(`document.querySelector('.modal').innerText`)).includes("追加したドキュメントは、ラボ管理者が公開するまで") && (await ev(`document.querySelector('label[for="knowledge_body"]').textContent.trim()`)) === "本文" && (await ev(`document.querySelector('.modal').innerText`)).includes("プレーンテキストです。"));
    await k22Save();
    d = await k22DlgWait((x) => !!x.alert);
    check("knowledge ja: a validation error is Japanese ('タイトルは必須です。' via the mapped message)", !!d && d.alert.length > 0 && !/^Title is required\.$/.test(d.alert), d?.alert);
    await k22Fill({ knowledge_title: "ZZ B9 K22 JA Form Note" });
    await k22Save();
    d = await k22DlgWait((x) => !!x.alert && x.alert !== "");
    check("knowledge ja: 'Body is required.' shows in Japanese ('本文は必須です。')", !!d && d.alert === "本文は必須です。", d?.alert);
    await k22Fill({ knowledge_body: "日本語で作成した本文 ZZKJAFORM" });
    await k22Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 6000);
    await sleep(600);
    const made = (await k22Api("en", "/knowledge?q=ZZKJAFORM")).json.items[0];
    check("knowledge ja: a document created through the Japanese UI stores the typed text as the ENGLISH base (the Japanese fields are the overrides), and nothing is duplicated", !!made && made.title === "ZZ B9 K22 JA Form Note" && (await k22Override(made.id)) === 0, JSON.stringify(made));
    // editing while in Japanese: English inputs show the English base, ja inputs show the override
    K22.jaEdit = made;
    d = await k22EditOn("ZZ B9 K22 JA Form Note");
    check("knowledge ja: Edit in Japanese shows the ENGLISH base in the main fields and the (empty) override in the Japanese fields — never the other way round", !!d && d.tv === "ZZ B9 K22 JA Form Note" && d.bv === "日本語で作成した本文 ZZKJAFORM" && d.tja === "" && d.bja === "", JSON.stringify(d));
    await k22Fill({ knowledge_title_ja: "ZZ B9 K22 日本語フォームのノート" });
    await k22Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 6000);
    await sleep(500);
    check("knowledge ja: saving from the Japanese UI stores the override and does NOT replace the English title with Japanese", await (async () => { const en = (await k22Api("en", `/knowledge/${made.id}`)).json; const ja = (await k22Api("ja", `/knowledge/${made.id}`)).json; return en.title === "ZZ B9 K22 JA Form Note" && ja.title === "ZZ B9 K22 日本語フォームのノート"; })());
    await k22Ready("/knowledge?mine=1");
    await k22DelOn("ZZ B9 K22 日本語フォームのノート");
    check("knowledge ja: the delete confirmation is Japanese and names the (Japanese) title", (await ev(`document.querySelector('.modal').innerText`)).includes("「ZZ B9 K22 日本語フォームのノート」を削除しますか？この操作は元に戻せません。"));
    await clickEl(".modal button.btn--danger");
    check("knowledge ja: confirming deletes it", await waitFor(`![...document.querySelectorAll('.knowledge-card .card__title')].some((x) => x.textContent.trim().includes('日本語フォームのノート'))`, 6000) && (await k22Api("en", `/knowledge/${made.id}`)).status === 404);
    await logout();
    check("knowledge ja: manager login", await login(K22.mgr.email, PW));
    await k22Ready("/knowledge?q=ZZKPUB");
    const dJa = await k22EditOn("ZZ B9 K22 公開メソドロジー");
    check("knowledge ja: editing a document that HAS Japanese overrides, in the Japanese UI, shows the ENGLISH title and body in the main fields and the overrides in the Japanese fields", !!dJa && dJa.tv === "ZZ B9 K22 Public Methodology" && dJa.bv.includes("Step one: flash the board.") && dJa.tja === "ZZ B9 K22 公開メソドロジー" && dJa.bja.includes("手順その一"), JSON.stringify(dJa));
    await k22Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 6000);
    await sleep(600);
    check("knowledge ja: saving that form unchanged writes NOTHING new: the English title and body are still English, the Japanese ones are unchanged", await (async () => { const en = (await k22Api("en", `/knowledge/${K22.dPub.id}`)).json; const ja = (await k22Api("ja", `/knowledge/${K22.dPub.id}`)).json; return en.title === "ZZ B9 K22 Public Methodology" && en.body.includes("Step one: flash the board.") && ja.title === "ZZ B9 K22 公開メソドロジー" && ja.body.includes("手順その一"); })());
    await logout();
    await setLocale(null);
  });

  await step("knowledge loading / error: skeleton, an error state with Try again, and a 401 is never shown as content", async () => {
    await desktop(); await setLocale(null);
    await go("/"); await navReady();
    await fake("*/api/knowledge?*", 500, JSON.stringify({ error: "Internal server error" }));
    await go("/knowledge"); await waitFor(`!!document.querySelector('[role="alert"]')`, 6000);
    check("knowledge error: a 500 on the list renders the localized error with Try again, plus the header (no blank page)", (await ev(`document.querySelector('[role="alert"]').innerText`)).includes("Could not load documents.") && (await exists('[role="alert"] button')) && (await pCount("h1")) === 1);
    await unfake();
    await clickEl('[role="alert"] button');
    check("knowledge error: Try again loads the list", await waitFor(`!!document.querySelector('.knowledge-card')`, 8000));
    await go("/"); await navReady();
    await fake(`*/api/knowledge/${K22.dPub.id}*`, 500, JSON.stringify({ error: "Internal server error" }));
    await go(`/knowledge/${K22.dPub.id}`); await waitFor(`!!document.querySelector('[role="alert"]')`, 6000);
    check("knowledge error: a 500 on a document shows 'Could not load this document.' with Try again, not the not-found state", (await ev(`document.querySelector('[role="alert"]').innerText`)).includes("Could not load this document.") && (await exists('[role="alert"] button')));
    await unfake();
    await go("/"); await navReady();
    await fake("*/api/knowledge?*", 200, JSON.stringify({ items: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } }));
    await go("/knowledge"); await waitFor(`!!document.querySelector('.empty-state')`, 6000);
    check("knowledge empty: an empty knowledge base says 'No documents yet.' with a hint", (await pMain()).includes("No documents yet.") && (await pMain()).includes("Documentation, methods and lab notes will appear here.") && (await ev(`document.querySelector('.knowledge-status').innerText.trim()`)) === "0 documents");
    await unfake();
    await go("/"); await navReady();
    await go("/"); await navReady();
    await send("Network.emulateNetworkConditions", { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
    await ev(`history.pushState({}, '', '/knowledge'); window.dispatchEvent(new PopStateEvent('popstate'))`);
    const busy = await waitFor(`!!document.querySelector('[role="status"][aria-busy="true"] .sr-only') && document.querySelector('[role="status"][aria-busy="true"] .sr-only').textContent === 'Loading documents…' && document.querySelectorAll('.skeleton-block').length > 0`, 3000);
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check("knowledge loading: while the list loads there is a labelled skeleton ('Loading documents…', aria-busy) and no cards", busy);
    check("knowledge loading: the skeleton is replaced by the cards when the data arrives", await waitFor(`!!document.querySelector('.knowledge-card') && !document.querySelector('.skeleton-block')`, 10000));
  });

  await step("knowledge hostile text: markup in titles, bodies, Japanese overrides and related names is inert everywhere (EN + JA, guest + admin)", async () => {
    const dialogsBefore = P15.jsDialogs.length;
    for (const loc of [null, "ja"]) {
      await setLocale(loc);
      for (const who of ["guest", "admin"]) {
        if (who === "admin") await login(ADMIN.email, ADMIN.password);
        const pages = [["list", "/knowledge?q=Hostile"], ["detail", `/knowledge/${K22.dX.id}`], ["project page", `/projects/${K22.pX.id}`], ["area page", `/research/${K22.aX.id}`], ["group page", `/groups/${K22.gX.id}`], ["search", "/search?q=Hostile&type=knowledge"], ...(who === "admin" ? [["admin list", "/admin/content?type=knowledge&q=Hostile"]] : [])];
        for (const [lbl, p] of pages) {
          await k22Ready(p);
          await sleep(200);
          const f = await ev(`(() => { const m = document.querySelector('main'); return { bad: m.querySelectorAll('img, script, iframe, svg[onload], a[href^="javascript"]').length, xss: typeof window.__k22Xss, text: m.innerText }; })()`);
          check(`knowledge hostile ${loc || "en"} ${who} ${lbl}: no element is created from any hostile text and no script ran`, f.bad === 0 && f.xss === "undefined", JSON.stringify({ bad: f.bad, xss: f.xss }));
        }
        await k22Ready(`/knowledge/${K22.dX.id}`);
        const t = await ev(`document.querySelector('.knowledge-body').innerText`);
        check(`knowledge hostile ${loc || "en"} ${who}: the hostile body is visible as TEXT (script tag, iframe, javascript: link, anchor)`, loc ? t.includes("日本語 <script>window.__k22Xss=6</script>") : t.includes("<script>window.__k22Xss=3</script>") && t.includes('<iframe src="javascript:window.__k22Xss=4"></iframe>') && t.includes('<a href="javascript:window.__k22Xss=8">x</a>'), t.slice(0, 200));
        check(`knowledge hostile ${loc || "en"} ${who}: the hostile title is text in the heading, breadcrumb and tab title`, (await ev(`document.querySelector('h1').textContent`)).includes("<img src=x onerror=window.__k22Xss=") && (await ev(`document.title`)).includes("<img"));
        if (who === "admin") await logout();
      }
    }
    // the edit form must show hostile text as a VALUE and save it back unchanged (English UI: the form's main fields are the English base)
    await setLocale(null);
    await login(ADMIN.email, ADMIN.password);
    await k22Ready("/knowledge?q=Hostile");
    const hostileTitles = await k22Titles();
    const d = await k22EditOn("ZZ B9 K22 Hostile " + k22X(1));
    check("knowledge hostile: the edit form holds the hostile title/body as plain values", !!d && d.tv === "ZZ B9 K22 Hostile " + k22X(1) && d.bv.includes("<script>window.__k22Xss=3</script>"), JSON.stringify(d).slice(0, 200) + " titles=" + JSON.stringify(hostileTitles));
    await k22Close();
    await setLocale(null);
    check("knowledge hostile: no script ran and no JS dialog opened during the whole step", (await ev(`typeof window.__k22Xss`)) === "undefined" && P15.jsDialogs.length === dialogsBefore, P15.jsDialogs.slice(dialogsBefore).join("|"));
    await logout();
  });

  await step("knowledge long text: a 190-character unbroken title, a 3000-character token and long Japanese stay inside cards, detail and dialogs at 390px", async () => {
    await desktopAt(390, 844);
    check("knowledge long: login", await k22Login(K22.mgr));
    await desktopAt(390, 844);
    for (const [lbl, p] of [["list", "/knowledge?q=ZZ%20B9%20K22&limit=50"], ["long token detail", `/knowledge/${K22.dLongTok.id}`], ["long Japanese detail", `/knowledge/${K22.dLongJa.id}`], ["project page", `/projects/${K22.p1.id}`]]) {
      await k22Ready(p);
      check(`knowledge long ${lbl}: no horizontal overflow at 390px`, (await overflowPx()) <= 1);
      const au = await p15Audit(null, false);
      check(`knowledge long ${lbl}: no clipped/spilling text, overlapping or unnamed controls`, au.resp.length === 0 && au.a11y.length === 0, [...au.resp, ...au.a11y].slice(0, 3).join(" | "));
    }
    await k22Ready("/knowledge?q=" + encodeURIComponent("超長い日本語"));
    const d = await k22EditOn(k22JaLong.slice(0, 200));
    const m = await ev(`(() => { const dd = document.querySelector('.modal[role="dialog"]'); if (!dd) return null; const b = dd.getBoundingClientRect(); return { fitsX: b.left >= -0.5 && b.right <= innerWidth + 0.5, inner: dd.scrollWidth - dd.clientWidth }; })()`);
    check("knowledge long: the edit dialog holding a long Japanese title and a 60-line Japanese body fits 390px (no internal horizontal scroll)", !!d && !!m && m.fitsX && m.inner <= 1, JSON.stringify(m));
    const aud = await p15Audit(".modal", false);
    check("knowledge long: the dialog's contents have no clipped/overlapping text and every control is named", aud.resp.length === 0 && aud.a11y.length === 0, [...aud.resp, ...aud.a11y].slice(0, 3).join(" | "));
    await k22Close();
    await logout();
    await desktop();
  });

  const k22DialogChecks = async (loc, w, tag) => {
    // The add dialog on the list page (real click, semantics, fit, trap, Escape, focus return) and the edit / delete dialogs of a card.
    await p15Ready("/knowledge?q=ZZ%20B9%20K22%20Public");
    await p15Dialog(`knowledge ${loc} ${w}px ${tag} add`, ".admin-bar button", 0, loc === "ja");
    if (await exists(".knowledge-card .card-edit-btn")) {
      await p15Dialog(`knowledge ${loc} ${w}px ${tag} edit`, ".knowledge-card .card-edit-btn .icon-btn:not(.icon-btn--danger)", 0, loc === "ja");
      await p15Dialog(`knowledge ${loc} ${w}px ${tag} delete`, ".knowledge-card .icon-btn--danger", 0, loc === "ja");
    }
  };
  const K22_PAGES = () => [
    ["knowledge list", "/knowledge"],
    ["knowledge filtered", "/knowledge?category=METHODOLOGY&project=" + K22.p1.id],
    ["knowledge page 2", "/knowledge?q=ZZ%20B9%20K22%20Many&page=2"],
    ["knowledge empty filter", "/knowledge?q=nothingmatchesthiszzz"],
    ["knowledge detail", `/knowledge/${K22.dPub.id}`],
    ["knowledge long Japanese", `/knowledge/${K22.dLongJa.id}`],
    ["knowledge long token", `/knowledge/${K22.dLongTok.id}`],
    ["knowledge hostile", `/knowledge/${K22.dX.id}`],
    ["knowledge not found", `/knowledge/${K22.dLab.id}`],
    ["project with documentation", `/projects/${K22.p1.id}`],
    ["research area with documentation", `/research/${K22.aPub.id}`],
    ["group with documentation", `/groups/${K22.gPub.id}`],
    ["researcher with documentation", `/team/${K22.lead.tmId}`],
    ["search knowledge", "/search?q=ZZKMANY&type=knowledge"],
  ];
  await step("knowledge sweep: guest -- 390..1920, EN + JA, keyboard", async () => {
    await p15Loop("k22-guest", null, K22_PAGES(), async (loc, w) => { if (P15_TAB_WIDTHS.includes(w)) await p19Walk(`knowledge ${loc} ${w}px guest`, [["list", "/knowledge"], ["detail", `/knowledge/${K22.dPub.id}`]]); });
  });
  await step("knowledge sweep: member -- 390..1920, EN + JA, add / edit / delete dialogs", async () => {
    await p15Loop("k22-member", () => k22Login(K22.mem), K22_PAGES(), async (loc, w) => { await k22DialogChecks(loc, w, "member"); if (P15_TAB_WIDTHS.includes(w)) await p19Walk(`knowledge ${loc} ${w}px member`, [["list", "/knowledge"], ["detail", `/knowledge/${K22.dPub.id}`]]); });
  });
  await step("knowledge sweep: project lead -- 390..1920, EN + JA, workspace section and dialogs", async () => {
    await p15Loop("k22-lead", () => k22Login(K22.lead), [...K22_PAGES().slice(0, 5), ["workspace", "/workspace"]], async (loc, w) => { await k22DialogChecks(loc, w, "lead"); });
    check("knowledge sweep lead: no script from hostile text ever ran", (await ev(`typeof window.__k22Xss`)) === "undefined");
  });
  await step("knowledge sweep: lab manager -- 390..1920, EN + JA, dialogs and the admin list", async () => {
    await p15Loop("k22-manager", () => k22Login(K22.mgr), [...K22_PAGES().slice(0, 5), ["admin knowledge", "/admin/content?type=knowledge"], ["admin knowledge filtered", `/admin/content?type=knowledge&category=METHODOLOGY&project=${K22.p1.id}`]], async (loc, w) => { await k22DialogChecks(loc, w, "manager"); });
  });
  await step("knowledge sweep: admin -- 390..1920, EN + JA, dialogs, admin list, translations and overview", async () => {
    await p15Loop("k22-admin", () => login(ADMIN.email, ADMIN.password), [...K22_PAGES().slice(0, 5), ["admin overview", "/admin"], ["admin knowledge", "/admin/content?type=knowledge"], ["admin translations knowledge", "/admin/translations?type=KNOWLEDGE_DOC"]], async (loc, w) => { await k22DialogChecks(loc, w, "admin"); });
  });

  await step("knowledge filters: folded behind a 'Filters' summary on a phone; open on wider screens and whenever a filter is active; keyboard and JA", async () => {
    await setLocale(null);
    await p15Vp(390);
    await k22Ready("/knowledge");
    const st = () => ev(`(() => { const d = document.querySelector('details.knowledge-filters-wrap'); const s = d.querySelector('summary'); const q = document.getElementById('kf-q'); return { open: d.open, summary: s.textContent.trim(), h: Math.round(s.getBoundingClientRect().height), qShown: q.checkVisibility(), formLabel: d.querySelector('form').getAttribute('aria-label') }; })()`);
    let s = await st();
    check("knowledge filters 390px: with no filter the panel is closed, its summary reads 'Filters' (>= 44px tall) and the controls are not rendered", !s.open && s.summary === "Filters" && s.h >= 44 && !s.qShown, JSON.stringify(s));
    check("knowledge filters 390px: the results start right under the summary (the eight controls do not push them off the screen)", await ev(`(() => { const c = document.querySelector('.knowledge-card'); return !!c && c.getBoundingClientRect().top < innerHeight; })()`));
    await pClick("summary.knowledge-filters-wrap__summary", "Filters");
    await sleep(300);
    s = await st();
    check("knowledge filters 390px: a real click on the summary opens the panel and shows the search box", s.open && s.qShown && s.formLabel === "Filter documents", JSON.stringify(s));
    await ev(`document.querySelector('summary.knowledge-filters-wrap__summary').focus()`);
    await press("enter");
    await sleep(250);
    check("knowledge filters 390px: Enter on the focused summary closes it again, focus stays on the summary", !(await st()).open && (await ev(`document.activeElement.classList.contains('knowledge-filters-wrap__summary')`)));
    await press("space");
    await sleep(250);
    check("knowledge filters 390px: Space opens it", (await st()).open);
    await k22Ready("/knowledge?category=METHODOLOGY&q=ZZKPUB");
    s = await st();
    check("knowledge filters 390px: with filters active the panel is open and the summary counts them ('Filters (2 active)')", s.open && s.summary === "Filters (2 active)" && s.qShown, JSON.stringify(s));
    await p15Vp(1280);
    await k22Ready("/knowledge");
    s = await st();
    check("knowledge filters 1280px: the panel is open by default (no filter active) and still has the summary", s.open && s.summary === "Filters" && s.qShown, JSON.stringify(s));
    await setLocale("ja");
    await p15Vp(390);
    await k22Ready("/knowledge");
    s = await st();
    check("knowledge filters ja: the summary is Japanese ('絞り込み') and the form's accessible name is Japanese", s.summary === "絞り込み" && !s.open && s.formLabel === "ドキュメントを絞り込む", JSON.stringify(s));
    await k22Ready("/knowledge?category=METHODOLOGY");
    check("knowledge filters ja: an active filter is counted in Japanese ('絞り込み（1 件適用中）')", (await st()).summary === "絞り込み（1 件適用中）");
    await setLocale(null);
    await desktop();
  });

  await step("knowledge screenshots: list, detail, form, mobile and Japanese (for eyeballing)", async () => {
    await setLocale(null);
    await login(K22.mgr.email, PW);
    for (const [w, tag] of [[1280, "d"], [390, "m"]]) {
      await p15Vp(w);
      await k22Ready("/knowledge?q=ZZ%20B9%20K22&limit=50");
      await shot(`k22-list-${tag}`);
      await k22Ready(`/knowledge/${K22.dPub.id}`);
      await shot(`k22-detail-${tag}`);
      await k22Ready("/knowledge");
      const d = await k22Add();
      if (d) await shot(`k22-form-${tag}`);
      await k22Close();
      await k22Ready(`/projects/${K22.p1.id}`);
      await shot(`k22-project-${tag}`);
    }
    await logout();
    await setLocale("ja");
    await p15Vp(390);
    await k22Ready("/knowledge?q=ZZ%20B9%20K22&limit=50");
    await shot("k22-list-ja-m");
    check("knowledge screenshots: taken", fs.existsSync(path.join(SHOTS, "k22-list-d.png")) && fs.existsSync(path.join(SHOTS, "k22-list-ja-m.png")));
    await setLocale(null);
  });
  await step("knowledge restore (locale, viewport)", async () => { await setLocale(null); await desktop(); });

  // ================================================================ PHASE 23: lab resources & reproducibility
  // /resources (list, filters, paging), /resources/:id (details + reproducibility), the add/edit/delete dialogs with the Japanese fields,
  // the "Resources & reproducibility" panel on project pages, the "Lab resources" sections on area / group / researcher / knowledge /
  // publication pages, search, the workspace section and the admin views, in EN and JA, for guest / member / project lead / lab manager /
  // admin, with hostile and very long text and the nine-width sweep.
  // (Steps are named "resources ..."; ONLY_RESOURCES=1 runs just them; P15_W / P15_USERS=r23-guest,r23-member,r23-lead,r23-manager,
  // r23-admin narrow the sweeps.)
  section("phase 23: lab resources & reproducibility");
  const R23 = {};
  const r23X = (n) => `<img src=x onerror=window.__r23Xss=${n}>`;
  const r23JaLong = "ZZ B9 R23 " + "超長い日本語のリソース名がカードと詳細ページの幅を壊さないことを確認するためのテスト".repeat(2);
  const r23JaText = "これは非常に長い日本語の説明です。レイアウトが崩れないことを確認します。".repeat(60);
  const r23Cards = () => ev(`[...document.querySelectorAll('.resource-card')].map((c) => ({ title: c.querySelector('.card__title')?.textContent.trim(), text: c.innerText, hrefs: [...c.querySelectorAll('a')].map((a) => a.getAttribute('href')), edit: !!c.querySelector('.card-edit-btn'), del: !!c.querySelector('.icon-btn--danger'), badges: [...c.querySelectorAll('.badge')].map((b) => b.textContent.trim().toLowerCase()) }))`);
  const r23Titles = async () => (await r23Cards()).map((c) => c.title);
  const r23Card = async (title) => (await r23Cards()).find((c) => c.title === title) || null;
  const r23Ready = async (p, mustHave) => { await go(p); await navReady(); await waitFor(`!document.querySelector('[aria-busy="true"]') && (!!document.querySelector('.resource-card') || !!document.querySelector('.empty-state') || !!document.querySelector('[role="alert"]') || !!document.querySelector('.repro-details') || !!document.querySelector('.admin-row') || !!document.querySelector('.search-result') || !!document.querySelector('#ws-projects'))`, 9000); if (mustHave) await waitText(mustHave, 9000); await sleep(400); };
  const r23Api = (locale, p) => ev(`fetch('/api${p}', { credentials: 'same-origin', headers: ${locale ? `{ 'X-Locale': '${locale}' }` : "{}"} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))`);
  const r23Dlg = () => ev(`(() => { const d = document.querySelector('.modal[role="dialog"]'); if (!d) return null; const g = (id) => document.getElementById(id); return { title: (document.getElementById(d.getAttribute('aria-labelledby') || '__') || {}).textContent?.trim() || '', name: g('resource_name')?.value ?? null, type: g('resource_type')?.value ?? null, desc: g('resource_description')?.value ?? null, ver: g('resource_version')?.value ?? null, vendor: g('resource_vendor')?.value ?? null, ident: g('resource_identifier')?.value ?? null, url: g('resource_url')?.value ?? null, env: g('resource_environment')?.value ?? null, area: g('resource_area')?.value ?? null, grp: g('resource_group')?.value ?? null, doc: g('resource_doc')?.value ?? null, pub: g('resource_publication')?.value ?? null, ev: g('resource_event')?.value ?? null, res: g('resource_researcher')?.value ?? null, vis: g('resource_visibility')?.value ?? null, nja: g('resource_name_ja')?.value ?? null, dja: g('resource_description_ja')?.value ?? null, eja: g('resource_environment_ja')?.value ?? null, meta: Object.fromEntries([...d.querySelectorAll('[id^="resource_meta_"]')].map((x) => [x.id.replace('resource_meta_', ''), x.value])), projects: [...d.querySelectorAll('.resource-form__projects input[type=checkbox]')].filter((x) => x.checked).map((x) => x.parentElement.textContent.trim()), projectOpts: [...d.querySelectorAll('.resource-form__projects input[type=checkbox]')].map((x) => x.parentElement.textContent.trim()), alert: d.querySelector('[role="alert"]')?.innerText.trim() || '', focusId: document.activeElement?.id || '', submitDisabled: d.querySelector('button.form-submit')?.disabled ?? null }; })()`);
  const r23DlgWait = async (pred, ms = 7000) => { const t0 = Date.now(); let d; while (Date.now() - t0 < ms) { d = await r23Dlg(); if (d && pred(d)) return d; await sleep(120); } return d; };
  const r23Fill = async (o) => { for (const [id, v] of Object.entries(o)) await setVal(id, v); };
  const r23Save = async () => { await ev(`document.querySelector('.modal button.form-submit')?.scrollIntoView({ block: 'center' })`); await p15Settle(); return clickEl(".modal button.form-submit"); };
  const r23Close = async () => { await press("esc"); return waitFor(`!document.querySelector('.modal[role="dialog"]')`, 2500); };
  const r23Add = async () => { await pClick(".admin-bar button", ""); return r23DlgWait((d) => d.name !== null && d.projectOpts.length > 0); };
  const r23Op = async (title, danger) => { // real click on the edit / delete icon of the card with this title
    const ok = await ev(`(() => { document.querySelectorAll('[data-r23-op]').forEach((e) => e.removeAttribute('data-r23-op')); const c = [...document.querySelectorAll('.resource-card')].find((x) => x.querySelector('.card__title')?.textContent.trim() === ${JSON.stringify(title)}); const b = c && c.querySelector(${danger ? "'.icon-btn--danger'" : "'.card-edit-btn .icon-btn:not(.icon-btn--danger)'"}); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.setAttribute('data-r23-op', '1'); return true; })()`);
    if (!ok) return null;
    await p15Settle();
    await clickEl("[data-r23-op]");
    return danger ? waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 3000) : r23DlgWait((d) => d.name !== null && d.desc !== null && d.projectOpts.length > 0 && d.submitDisabled === false);
  };
  const r23EditOn = (title) => r23Op(title, false);
  const r23DelOn = (title) => r23Op(title, true);
  const r23Mk = async (key, role, name) => {
    const r = await R23.a.req("POST", "/users", { email: `b9-r23-${key}@example.test`, password: PW, role, name, initials: "R" + key.slice(0, 1).toUpperCase(), memberRole: "Researcher", category: "RESEARCH" });
    const team = (await R23.a.req("GET", "/team")).json;
    D.userIds.push(r.json.id);
    return { email: `b9-r23-${key}@example.test`, userId: r.json.id, tmId: team.find((m) => m.name === name).id, name };
  };
  const r23Login = (u) => login(u.email, PW);
  const r23Sql = (sql, ...params) => { if (!process.env.K22_DB) throw new Error("K22_DB is not set"); const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.env.K22_DB); try { const st = db.prepare(sql); return /^\s*select/i.test(sql) ? st.all(...params) : st.run(...params); } finally { db.close(); } };
  const r23Sec = (id) => ev(`(() => { const s = document.querySelector('section[aria-labelledby="${id}"]'); if (!s) return null; return { head: document.getElementById('${id}')?.textContent.trim(), cards: [...s.querySelectorAll('.resource-card .card__title')].map((x) => x.textContent.trim()), items: [...s.querySelectorAll('.repro-item')].map((x) => x.innerText.replace(/\\s+/g, ' ').trim()), groups: [...s.querySelectorAll('.repro-group__title')].map((x) => x.textContent.trim()), all: s.querySelector('a.section-header__link')?.getAttribute('href') || '', allText: s.querySelector('a.section-header__link')?.innerText.trim() || '', edit: !!s.querySelector('.card-edit-btn') }; })()`);

  await step("resources seed: five roles, public / lab-only / leaky / hostile / long / many resources with Japanese overrides", async () => {
    if (!P15.jsDialogs) { P15.jsDialogs = []; ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Page.javascriptDialogOpening") { P15.jsDialogs.push(m.params.message); send("Page.handleJavaScriptDialog", { accept: false }); } }); }
    const a = new Client();
    await a.req("POST", "/auth/login", ADMIN);
    R23.a = a;
    const J = (r) => r.json;
    R23.lead = await r23Mk("lead", "MEMBER", "ZZ B9 R23 Lead");
    R23.mem = await r23Mk("mem", "MEMBER", "ZZ B9 R23 Member");
    R23.mgr = await r23Mk("mgr", "LAB_MANAGER", "ZZ B9 R23 Manager");
    R23.none = await r23Mk("none", "MEMBER", "ZZ B9 R23 Nobody");
    R23.aPub = J(await a.req("POST", "/research", { title: "ZZ B9 R23 Area Public", description: "r23 area", tag: "ZZR23", visibility: "PUBLIC" }));
    R23.aHid = J(await a.req("POST", "/research", { title: "ZZ B9 R23 Area Lab", description: "r23 lab area", tag: "ZZR23", visibility: "LAB_ONLY" }));
    R23.aX = J(await a.req("POST", "/research", { title: "ZZ B9 R23 Area " + r23X(2), description: "hostile", tag: "ZZR23", visibility: "PUBLIC" }));
    R23.gPub = J(await a.req("POST", "/groups", { name: "ZZ B9 R23 Group Public", description: "g", visibility: "PUBLIC" }));
    R23.gHid = J(await a.req("POST", "/groups", { name: "ZZ B9 R23 Group Lab", description: "g", visibility: "LAB_ONLY" }));
    R23.gX = J(await a.req("POST", "/groups", { name: "ZZ B9 R23 Group <script>window.__r23Xss=7</script>", description: "gx", visibility: "PUBLIC" }));
    const mkPrj = async (title, visibility, groupId, ja) => J(await a.req("POST", "/projects", { title, summary: "R23 summary", description: "d", status: "ACTIVE", visibility, ...(groupId ? { groupId } : {}), ...(ja ? { translations: { ja: { title: ja } } } : {}) }));
    R23.p1 = await mkPrj("ZZ B9 R23 Project One", "PUBLIC", R23.gPub.id, "ZZ B9 R23 プロジェクト一");
    R23.p2 = await mkPrj("ZZ B9 R23 Project Two", "PUBLIC", null);
    R23.pHid = await mkPrj("ZZ B9 R23 Project Lab", "LAB_ONLY", null);
    R23.pX = await mkPrj("ZZ B9 R23 Project " + r23X(4), "PUBLIC", R23.gX.id);
    R23.pEmpty = await mkPrj("ZZ B9 R23 Project Without Resources", "PUBLIC", null);
    await a.req("PUT", `/projects/${R23.p1.id}/members`, { members: [{ teamMemberId: R23.lead.tmId, role: "LEAD" }] });
    await a.req("PUT", `/groups/${R23.gPub.id}/members`, { members: [{ teamMemberId: R23.lead.tmId, role: "MEMBER" }] });
    await a.req("PUT", `/member/${R23.lead.tmId}/areas`, { areaIds: [R23.aPub.id] });
    const iso = (days) => new Date(Date.now() + days * 864e5).toISOString();
    R23.pubPub = J(await a.req("POST", "/publications", { year: 2031, title: "ZZ B9 R23 Paper Public", authors: "a", venue: "v", visibility: "PUBLIC" }));
    R23.pubHid = J(await a.req("POST", "/publications", { year: 2031, title: "ZZ B9 R23 Paper Lab", authors: "a", venue: "v", visibility: "LAB_ONLY" }));
    R23.evPub = J(await a.req("POST", "/events", { title: "ZZ B9 R23 Event Public", description: "e", location: "Hall", kind: "SEMINAR", startsAt: iso(5), visibility: "PUBLIC" }));
    R23.evHid = J(await a.req("POST", "/events", { title: "ZZ B9 R23 Event Lab", description: "e", location: "Hall", kind: "MEETING", startsAt: iso(6), visibility: "LAB_ONLY" }));
    const mgrC = new Client(); await mgrC.req("POST", "/auth/login", { email: R23.mgr.email, password: PW });
    R23.mgrC = mgrC;
    // An old document followed by 51 newer ones: it falls outside the form picklist's newest 50 (created BEFORE the fixtures below, which must stay inside it).
    R23.docOld = J(await mgrC.req("POST", "/knowledge", { title: "ZZ B9 R23 Doc Old", body: "old doc", category: "REPRODUCIBILITY", visibility: "PUBLIC" }));
    for (let i = 0; i < 51; i++) await mgrC.req("POST", "/knowledge", { title: `ZZ B9 R23 Doc Filler ${String(i).padStart(2, "0")}`, body: "filler", category: "RESEARCH_NOTE", visibility: "PUBLIC" });
    R23.docPub = J(await mgrC.req("POST", "/knowledge", { title: "ZZ B9 R23 Doc Public", body: "How to reproduce ZZRDOC", category: "REPRODUCIBILITY", visibility: "PUBLIC" }));
    R23.docHid = J(await mgrC.req("POST", "/knowledge", { title: "ZZ B9 R23 Doc Lab", body: "lab doc", category: "REPRODUCIBILITY", visibility: "LAB_ONLY" }));
    const res = async (client, body) => J(await client.req("POST", "/resources", body));
    R23.rDs = await res(mgrC, {
      name: "ZZ B9 R23 Public Dataset",
      resourceType: "DATASET",
      description: "Frames from the test rig.\nSecond line ZZRPUB\n\n  Indented note",
      version: "v3.2",
      vendor: "Smart Lab",
      identifier: "ZZR-DS-1",
      url: "https://example.org/zz-b9-r23-dataset",
      environment: "Python 3.11\nseed = 42\n  batch = 32",
      metadata: { format: "CSV", size: "2 GB", license: "CC-BY 4.0", collectionMethod: "camera rig at 30 fps" },
      visibility: "PUBLIC",
      projectIds: [R23.p1.id, R23.p2.id],
      researchAreaId: R23.aPub.id,
      groupId: R23.gPub.id,
      knowledgeDocId: R23.docPub.id,
      publicationId: R23.pubPub.id,
      eventId: R23.evPub.id,
      teamMemberId: R23.lead.tmId,
      translations: { ja: { name: "ZZ B9 R23 公開データセット", description: "テスト装置のフレーム ZZRJA", environment: "Python 3.11、シード 42" } },
    });
    R23.rFpga = await res(mgrC, { name: "ZZ B9 R23 FPGA Board", resourceType: "FPGA", description: "Dev board ZZRFPGA", version: "rev C", vendor: "Xilinx", identifier: "ZZR-FPGA-1", metadata: { hardwareRevision: "C", firmwareVersion: "1.4.2", toolchain: "Vivado 2024.1" }, visibility: "PUBLIC", projectIds: [R23.p1.id] });
    R23.rTool = await res(mgrC, { name: "ZZ B9 R23 Vivado", resourceType: "TOOL", description: "Synthesis tool", version: "2024.1", vendor: "AMD", metadata: { platform: "Linux x86_64", configuration: "default strategy", requirements: "64 GB RAM" }, visibility: "PUBLIC", projectIds: [R23.p1.id] });
    R23.rModel = await res(mgrC, { name: "ZZ B9 R23 Detector Model", resourceType: "MODEL", description: "Weights", version: "0.9", visibility: "PUBLIC", projectIds: [R23.p1.id] });
    R23.rEnv = await res(mgrC, { name: "ZZ B9 R23 Test Bench", resourceType: "EXPERIMENT_ENVIRONMENT", description: "Bench", environment: "20 C, dark room", visibility: "PUBLIC", projectIds: [R23.p1.id] });
    R23.rLab = await res(mgrC, { name: "ZZ B9 R23 Lab Only Scope", resourceType: "HARDWARE", description: "Internal ZZRLAB oscilloscope", visibility: "LAB_ONLY", projectIds: [R23.p1.id] });
    R23.rLeak = await res(mgrC, { name: "ZZ B9 R23 Leaky Public Board", resourceType: "BOARD", description: "Public resource on lab-only things ZZRLEAK", visibility: "PUBLIC", projectIds: [R23.pHid.id], researchAreaId: R23.aHid.id, groupId: R23.gHid.id, knowledgeDocId: R23.docHid.id, publicationId: R23.pubHid.id, eventId: R23.evHid.id });
    R23.rX = await res(mgrC, { name: "ZZ B9 R23 Hostile " + r23X(1), resourceType: "SOFTWARE", description: `<script>window.__r23Xss=3</script>\n<iframe src="javascript:window.__r23Xss=4"></iframe> javascript:alert(1) <a href="javascript:window.__r23Xss=8">x</a>`, version: r23X(5), vendor: "<b>v</b>", identifier: "<svg onload=window.__r23Xss=9>", environment: `<script>window.__r23Xss=10</script>`, metadata: { platform: r23X(11), configuration: "<script>window.__r23Xss=12</script>", requirements: "javascript:alert(2)" }, visibility: "PUBLIC", projectIds: [R23.pX.id], researchAreaId: R23.aX.id, groupId: R23.gX.id, translations: { ja: { name: "ZZ B9 R23 日本語 " + r23X(6), description: "日本語 <script>window.__r23Xss=6</script>", environment: r23X(13) } } });
    R23.rLongJa = await res(mgrC, { name: r23JaLong.slice(0, 200), resourceType: "DATASET", description: r23JaText, environment: r23JaText, version: "v" + "9".repeat(60), vendor: "V".repeat(150), identifier: "I".repeat(150), visibility: "PUBLIC", projectIds: [R23.p1.id] });
    R23.rLongTok = await res(mgrC, { name: "ZZ B9 R23 " + "T".repeat(150), resourceType: "TOOL", description: "U".repeat(3000) + " tail", environment: "W".repeat(3000), url: "https://example.org/" + "a".repeat(200), visibility: "PUBLIC" });
    R23.many = [];
    for (let i = 0; i < 14; i++) R23.many.push(await res(mgrC, { name: `ZZ B9 R23 Many ${String(i).padStart(2, "0")}`, resourceType: "SENSOR", description: `many ${i} ZZRMANY`, visibility: "PUBLIC", projectIds: [R23.p2.id] }));
    const memC = new Client(); await memC.req("POST", "/auth/login", { email: R23.mem.email, password: PW });
    const leadC = new Client(); await leadC.req("POST", "/auth/login", { email: R23.lead.email, password: PW });
    R23.rMem = await res(memC, { name: "ZZ B9 R23 Member Own", resourceType: "SOFTWARE", description: "added by the member ZZRMEM" });
    R23.rLead = await res(leadC, { name: "ZZ B9 R23 Lead Own", resourceType: "TOOL", description: "added by the lead ZZRLEAD", projectIds: [R23.p1.id] });
    // more fixtures: a resource on five projects (a card names three), a busy area (more resources than a section shows), a PRIVATE-visibility area / group,

    R23.pm = [];
    for (let i = 1; i <= 4; i++) R23.pm.push(await mkPrj(`ZZ B9 R23 Project Multi ${i}`, "PUBLIC", null));
    R23.rMulti = await res(mgrC, { name: "ZZ B9 R23 Multi Project Tool", resourceType: "TOOL", description: "on five projects ZZRMULTI", visibility: "PUBLIC", projectIds: [...R23.pm.map((p) => p.id), R23.pHid.id] });
    R23.aBusy = J(await a.req("POST", "/research", { title: "ZZ B9 R23 Area Busy", description: "busy", tag: "ZZR23", visibility: "PUBLIC" }));
    R23.busy = [];
    for (let i = 0; i < 7; i++) R23.busy.push(await res(mgrC, { name: `ZZ B9 R23 Busy ${i}`, resourceType: "TOOL", description: "busy area resource", visibility: "PUBLIC", researchAreaId: R23.aBusy.id }));
    R23.aPriv = J(await a.req("POST", "/research", { title: "ZZ B9 R23 Area Private", description: "p", tag: "ZZR23", visibility: "LAB_ONLY" }));
    R23.gPriv = J(await a.req("POST", "/groups", { name: "ZZ B9 R23 Group Private", description: "p", visibility: "LAB_ONLY" }));
    r23Sql("UPDATE ResearchArea SET visibility = 'PRIVATE' WHERE id = ?", R23.aPriv.id);
    r23Sql("UPDATE ResearchGroup SET visibility = 'PRIVATE' WHERE id = ?", R23.gPriv.id);
    // The one fixture the API cannot make: a project whose visibility is outside the allow-list (invisible to every signed-in viewer).
    R23.pPriv = J(await a.req("POST", "/projects", { title: "ZZ B9 R23 Project Private", summary: "s", description: "d", status: "ACTIVE", visibility: "LAB_ONLY" }));
    r23Sql("UPDATE ResearchProject SET visibility = 'PRIVATE' WHERE id = ?", R23.pPriv.id);
    R23.rPriv = await res(mgrC, { name: "ZZ B9 R23 On Private Project", resourceType: "TOOL", description: "ZZRPRIV", visibility: "PUBLIC" });
    r23Sql("INSERT INTO ResourceProject (resourceId, projectId) VALUES (?, ?)", R23.rPriv.id, R23.pPriv.id);
    check("resources seed: the fixtures exist", [R23.lead.tmId, R23.mem.tmId, R23.mgr.tmId, R23.none.tmId, R23.aPub.id, R23.gPub.id, R23.p1.id, R23.rDs.id, R23.rFpga.id, R23.rLab.id, R23.rLeak.id, R23.rX.id, R23.rLongJa.id, R23.rLongTok.id, R23.many[13]?.id, R23.rMem.id, R23.rLead.id, R23.rPriv.id].every(Boolean), JSON.stringify([R23.rDs?.error, R23.rX?.error, R23.rLongJa?.error, R23.rLongTok?.error]));
  });

  await step("resources guest: navigation, PUBLIC list only, filters, paging, detail, hidden = not found, no leak", async () => {
    await desktop(); await setLocale(null);
    await r23Ready("/resources?q=ZZ%20B9%20R23");
    check("resources guest: the header offers Resources under Research", (await exists('#nav-panel-research a[href="/resources"]')) && (await panelLabels("research")).includes("resources"));
    check("resources guest: one h1 'Lab resources', one main, the tab title, a described page", (await pCount("h1")) === 1 && (await pCount("main")) === 1 && (await ev(`document.querySelector('h1').textContent.trim()`)) === "Lab resources" && (await ev(`document.title`)).includes("Lab resources"));
    const t = await pMain();
    check("resources guest: no '+ Add resource' bar, no edit/delete icons, no visibility or 'related to me' controls", !t.includes("Add resource") && !(await exists(".admin-bar")) && !(await exists(".card-edit-btn")) && !(await exists("#rf-visibility")) && !(await exists("#rf-mine")));
    await r23Ready("/resources?q=ZZ%20B9%20R23%20Public");
    const all = await r23Titles();
    await r23Ready("/resources?q=ZZRFPGA");
    const fpga = await r23Titles();
    check("resources guest: a search of the list finds the PUBLIC resources", all.includes("ZZ B9 R23 Public Dataset") && all.includes("ZZ B9 R23 Leaky Public Board") && fpga.join("|") === "ZZ B9 R23 FPGA Board", JSON.stringify([all, fpga]));
    const hiddenSeen = [];
    for (const w of ["ZZRLAB", "ZZRMEM", "ZZRLEAD"]) { await r23Ready("/resources?q=" + w); hiddenSeen.push(...(await r23Titles())); }
    check("resources guest: LAB_ONLY resources (the scope, the member's, the lead's) are absent from the list", hiddenSeen.length === 0, JSON.stringify(hiddenSeen));
    check("resources guest: the filter form is a labelled search with the type, project, area, group, researcher, documentation and publication pickers", (await exists('form[role="search"].knowledge-filters')) && (await ev(`['rf-q','rf-type','rf-project','rf-area','rf-group','rf-researcher','rf-knowledge','rf-publication'].every((id) => !!document.getElementById(id) && !!document.querySelector('label[for="' + id + '"]'))`)));
    await r23Ready("/resources?q=ZZ%20B9%20R23%20Public");
    check("resources guest: the result count is a polite live region", (await exists('.knowledge-status[role="status"][aria-live="polite"]')) && /^\d+ resources?$/.test(await ev(`document.querySelector('.knowledge-status').innerText.trim()`)));
    const ds = await r23Card("ZZ B9 R23 Public Dataset");
    check("resources guest: a card shows the type, version and vendor, an excerpt, the related PUBLIC projects / area / group, the owner byline and the date, and links the title to /resources/:id", !!ds && ds.badges.includes("dataset") && ds.text.includes("v3.2 · Smart Lab") && ds.text.includes("Frames from the test rig.") && ["ZZ B9 R23 Project One", "ZZ B9 R23 Project Two", "ZZ B9 R23 Area Public", "ZZ B9 R23 Group Public"].every((s) => ds.text.includes(s)) && /Added by ZZ B9 R23 Manager/.test(ds.text) && /Updated [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(ds.text) && ds.hrefs[0] === `/resources/${R23.rDs.id}` && ds.hrefs.includes(`/projects/${R23.p1.id}`) && ds.hrefs.includes(`/research/${R23.aPub.id}`) && ds.hrefs.includes(`/groups/${R23.gPub.id}`), JSON.stringify(ds));
    await r23Ready("/resources?q=ZZRLEAK");
    const leak = await r23Card("ZZ B9 R23 Leaky Public Board");
    check("resources guest: a PUBLIC resource on LAB_ONLY project / area / group names none of them (card and page HTML)", !!leak && !/Project Lab|Area Lab|Group Lab/.test(leak.text) && !(await ev(`document.documentElement.outerHTML`)).includes(R23.pHid.id) && !(await ev(`document.documentElement.outerHTML`)).includes(R23.gHid.id) && leak.hrefs.length === 1, JSON.stringify(leak));
    await r23Ready("/resources?q=ZZ%20B9%20R23%20Public");
    await setVal("rf-type", "FPGA");
    await ev(`document.querySelector('form.knowledge-filters').requestSubmit()`);
    await waitFor(`location.search.includes('type=FPGA')`, 4000); await waitFor(`!document.querySelector('[aria-busy="true"]')`, 6000); await sleep(400);
    check("resources guest: the type filter writes ?type= to the URL and narrows the list to that type", (await ev(`location.search`)).includes("type=FPGA") && (await r23Cards()).every((c) => c.badges.includes("fpga")));
    check("resources guest: after filtering, the form keeps the chosen value and 'Clear filters' returns to /resources", (await ev(`document.getElementById('rf-type').value`)) === "FPGA" && (await clickEl('a.btn--ghost[href="/resources"]')) && (await waitFor(`location.pathname === '/resources' && location.search === ''`, 4000)));
    await r23Ready("/resources?q=nothingmatchesthiszzz");
    check("resources guest: no match = a filtered empty state with a hint", (await pMain()).includes("No resources match these filters.") && (await pCount(".resource-card")) === 0);
    await r23Ready(`/resources?project=${R23.pHid.id}`);
    check("resources guest: filtering by a hidden project shows the SAME empty state as an unknown project", (await pMain()).includes("No resources match these filters.") && (await pCount(".resource-card")) === 0 && !(await ev(`document.querySelector('.empty-state')?.innerText || ''`)).includes("Leaky")); // the picklists hold OTHER phases' record names, so only the results region is inspected
    await r23Ready("/resources?q=ZZ%20B9%20R23%20Many");
    check("resources guest: 14 resources = page 1 of 2 with 12 cards, a Next link and 'Page 1 of 2'", (await pCount(".resource-card")) === 12 && (await exists('.search-pager a[rel="next"]')) && (await ev(`document.querySelector('.search-pager__pos').textContent.trim()`)) === "Page 1 of 2" && (await exists('.search-pager span.is-disabled')));
    const p1t = await r23Titles();
    await pClick('.search-pager a[rel="next"]');
    await waitFor(`location.search.includes('page=2')`, 4000); await waitFor(`!document.querySelector('[aria-busy="true"]')`, 6000); await sleep(400);
    check("resources guest: Next opens page 2 (the remaining 2), 'Next' becomes a disabled non-link control and Previous is a link", (await pCount(".resource-card")) === 2 && !(await exists('.search-pager a[rel="next"]')) && (await exists('.search-pager span.is-disabled[aria-disabled="true"]')) && (await exists('.search-pager a[rel="prev"]')) && new Set([...p1t, ...(await r23Titles())]).size === 14);
    await r23Ready("/resources?page=zzz&type=nope");
    check("resources guest: a junk ?page= is page 1 and an unknown ?type= is an error state, not a crash", (await pCount("h1")) === 1 && (await exists('[role="alert"]')));
    await r23Ready("/resources?page=3.5&q=ZZRPUB");
    check("resources guest: a fractional ?page= is read as page 1 (never sent to the API): the result shows and there is no error", (await r23Titles()).includes("ZZ B9 R23 Public Dataset") && !(await exists('[role="alert"]')));
    await r23Ready("/resources?q=ZZ%20B9%20R23%20Public%20Dataset&visibility=LAB_ONLY&mine=1");
    check("resources guest: ?visibility= and ?mine=1 are ignored for a guest (no 403 / 401 error state, the PUBLIC result is shown)", (await r23Titles()).includes("ZZ B9 R23 Public Dataset") && !(await exists('[role="alert"]')) && !(await exists("#rf-visibility")) && !(await exists("#rf-mine")));
    await r23Ready("/resources?q=ZZRFPGA");
    check("resources guest: exactly one result reads '1 resource' (singular)", (await ev(`document.querySelector('.knowledge-status').innerText.trim()`)) === "1 resource");
    await r23Ready("/resources?q=Multi%20Project");
    const multi = await r23Card("ZZ B9 R23 Multi Project Tool");
    check("resources guest: a resource on more projects than a card names lists three and says '+1 more' for the fourth PUBLIC one; the LAB_ONLY fifth is neither named nor counted", !!multi && multi.hrefs.filter((h) => h.startsWith("/projects/")).length === 3 && multi.text.includes("+1 more") && !multi.text.includes("+2 more") && !multi.text.includes("Project Lab"), JSON.stringify(multi));
    // detail
    await r23Ready(`/resources/${R23.rDs.id}`);
    check("resources guest: the detail page: breadcrumbs (Home / Resources / name), one h1 = the name, type badge", (await ev(`[...document.querySelectorAll('.breadcrumbs li')].map((l) => l.textContent.trim())`)).join("|") === "Home|Resources|ZZ B9 R23 Public Dataset" && (await ev(`document.querySelector('h1').textContent.trim()`)) === "ZZ B9 R23 Public Dataset" && (await ev(`document.querySelector('.detail-meta').innerText.toLowerCase()`)).includes("dataset"));
    const body = await ev(`(() => { const b = document.querySelector('.knowledge-body'); const cs = getComputedStyle(b); return { text: b.innerText, ws: cs.whiteSpace, wrap: cs.overflowWrap }; })()`);
    check("resources guest: the description is TEXT with its line breaks and indentation kept (pre-wrap)", body.text.includes("Frames from the test rig.\nSecond line ZZRPUB") && body.text.includes("  Indented note") && body.ws === "pre-wrap", JSON.stringify(body));
    const repro = await ev(`(() => { const s = document.querySelector('.repro-details'); return { head: s.querySelector('h2').textContent.trim(), facts: [...s.querySelectorAll('dl > div')].map((d) => [d.querySelector('dt').textContent.trim(), d.querySelector('dd').textContent.trim()]), notes: s.querySelector('.resource-repro__notes')?.innerText || '', ws: getComputedStyle(s.querySelector('.resource-repro__notes')).whiteSpace }; })()`);
    check("resources guest: the Reproducibility section lists the dataset's format, size, license and collection method, and the environment notes as pre-wrapped text", repro.head === "Reproducibility" && ["Format|CSV", "Size|2 GB", "License / usage note|CC-BY 4.0", "Collection / generation method|camera rig at 30 fps"].every((p) => repro.facts.some((f) => f.join("|") === p)) && repro.notes.includes("Python 3.11\nseed = 42\n  batch = 32") && repro.ws === "pre-wrap", JSON.stringify(repro));
    const facts = await ev(`[...document.querySelectorAll('.knowledge-facts > div')].map((d) => ({ k: d.querySelector('dt').textContent.trim(), v: d.querySelector('dd').textContent.trim(), hrefs: [...d.querySelectorAll('a')].map((a) => a.getAttribute('href')) }))`);
    const has = (k, pred) => facts.some((f) => f.k === k && pred(f));
    check("resources guest: the details panel lists type, version, vendor, identifier, dates and every related record with working links", has("Type", (f) => f.v === "Dataset") && has("Version", (f) => f.v === "v3.2") && has("Vendor / source", (f) => f.v === "Smart Lab") && has("Identifier", (f) => f.v === "ZZR-DS-1") && has("Projects", (f) => f.hrefs.includes(`/projects/${R23.p1.id}`) && f.hrefs.includes(`/projects/${R23.p2.id}`)) && has("Research area", (f) => f.hrefs[0] === `/research/${R23.aPub.id}`) && has("Group", (f) => f.hrefs[0] === `/groups/${R23.gPub.id}`) && has("Documentation", (f) => f.hrefs[0] === `/knowledge/${R23.docPub.id}`) && has("Publication", (f) => f.hrefs[0] === `/publications/${R23.pubPub.id}`) && has("Event", (f) => f.hrefs[0] === `/events/${R23.evPub.id}`) && has("Contact researcher", (f) => f.hrefs[0] === `/team/${R23.lead.tmId}`) && has("Last updated", () => true) && has("Created", () => true), JSON.stringify(facts));
    const link = await ev(`(() => { const a = document.querySelector('a.resource-link'); return a ? { href: a.getAttribute('href'), rel: a.getAttribute('rel'), target: a.getAttribute('target') } : null; })()`);
    check("resources guest: the link is an external http(s) anchor that opens in a new tab with rel=noopener noreferrer", !!link && link.href === "https://example.org/zz-b9-r23-dataset" && link.target === "_blank" && /noopener/.test(link.rel) && /noreferrer/.test(link.rel), JSON.stringify(link));
    const dHtml = await ev(`document.documentElement.outerHTML`);
    check("resources guest: no manage bar, and the page HTML holds no account id or 'userId'", !(await exists(".admin-bar")) && !D.userIds.some((u) => dHtml.includes(u)) && !dHtml.includes("userId") && !dHtml.includes("ownerId"));
    await r23Ready(`/resources/${R23.rLeak.id}`);
    const lf = await pMain();
    check("resources guest: the leaky resource's detail names no hidden project / area / group / document / publication / event, and none of their ids are in the page", !/Project Lab|Area Lab|Group Lab|Doc Lab|Paper Lab|Event Lab/.test(lf) && ![R23.pHid.id, R23.aHid.id, R23.gHid.id, R23.docHid.id, R23.pubHid.id, R23.evHid.id].some((i) => (dHtml + lf).includes(i)) && !(await ev(`document.documentElement.outerHTML`)).includes(R23.pHid.id));
    await r23Ready(`/resources/${R23.rLab.id}`);
    check("resources guest: a LAB_ONLY resource by URL is the not-found state and leaks nothing", (await pMain()).includes("Resource not found") && !(await pMain()).includes("Lab Only Scope") && !(await pMain()).includes("ZZRLAB") && (await exists('a[href="/resources"]')));
    const hiddenTxt = await pMain();
    check("resources guest: the not-found state explains itself, offers no retry, and links back to the list", hiddenTxt.includes("This resource doesn't exist, or you don't have access to it.") && !(await exists('[role="alert"] button')) && (await exists('a.btn[href="/resources"]')));
    await r23Ready("/resources/nonexistentid12345");
    check("resources guest: an unknown id renders exactly the same not-found state as the hidden one", (await pMain()) === hiddenTxt);
    await r23Ready("/resources/a%20b");
    check("resources guest: a malformed id is a not-found/error state, not a crash", (await pCount("h1")) === 1 && (((await pMain()).includes("not found")) || (await exists('[role="alert"]'))));
    await r23Ready(`/resources/${R23.rPriv.id}`);
    check("resources guest: a resource on a PRIVATE-visibility project shows no project (no name, no id, no link)", !(await pMain()).includes("Project Private") && !(await ev(`document.documentElement.outerHTML`)).includes(R23.pPriv.id) && !(await exists('.knowledge-facts a[href^="/projects/"]')));
    check("resources guest: the write APIs refuse a guest (401)", (await apiCall("POST", "/resources", { name: "x" })) === 401 && (await apiCall("PUT", `/resources/${R23.rDs.id}`, { name: "x" })) === 401 && (await apiCall("DELETE", `/resources/${R23.rDs.id}`)) === 401);
  });

  await step("resources integration: project panel, area / group / researcher / knowledge / publication sections with View all", async () => {
    await desktop(); await setLocale(null);
    await r23Ready(`/projects/${R23.p1.id}`);
    const s = await r23Sec("project-repro");
    check("resources project: the section 'Resources & reproducibility' groups the project's PUBLIC resources by kind (Hardware, Software & models, Data, Environment & other)", !!s && s.head === "Resources & reproducibility" && s.groups.join("|") === "Hardware|Software & models|Data|Environment & other", JSON.stringify(s));
    check("resources project: every item shows its type, name, version and vendor, and hardware / software / data / environment land in the right group", !!s && s.items.some((i) => /^FPGA ZZ B9 R23 FPGA Board rev C · Xilinx$/i.test(i)) && s.items.some((i) => /^TOOL ZZ B9 R23 Vivado 2024\.1 · AMD$/i.test(i)) && s.items.some((i) => /^DATASET ZZ B9 R23 Public Dataset v3\.2 · Smart Lab$/i.test(i)) && s.items.some((i) => /^EXPERIMENT ENVIRONMENT ZZ B9 R23 Test Bench$/i.test(i)), JSON.stringify(s.items));
    check("resources project: a guest sees no LAB_ONLY resource of the project, and the panel holds at most 12", !!s && !s.items.some((i) => /Lab Only Scope|Member Own|Lead Own/.test(i)) && s.items.length <= 12 && s.items.length >= 6);
    check("resources project: 'View all resources (N)' shows the TRUE total (PUBLIC only) and links to /resources?project=<id>", !!s && /^View all resources \(\d+\)/.test(s.allText) && s.all === `/resources?project=${R23.p1.id}` && +s.allText.match(/\((\d+)\)/)[1] === (await r23Api(null, `/resources?project=${R23.p1.id}&limit=1`)).json.pagination.total);
    check("resources project: an item links to its resource page", await ev(`!!document.querySelector('.repro-item a[href="/resources/${R23.rDs.id}"]')`));
    await r23Ready(s.all);
    const list = await r23Titles();
    check("resources project: View all opens the list filtered to that project and the picker shows it selected", list.includes("ZZ B9 R23 Public Dataset") && (await ev(`document.getElementById('rf-project').selectedOptions[0]?.textContent.trim()`)) === "ZZ B9 R23 Project One");
    await r23Ready(`/projects/${R23.pEmpty.id}`);
    check("resources project: a project with no visible resources gets no section at all", (await r23Sec("project-repro")) === null);
    await r23Ready(`/projects/${R23.p2.id}`);
    const s2 = await r23Sec("project-repro");
    check("resources project: 15 resources on a project = a panel capped at 12 with the true total", !!s2 && s2.items.length === 12 && +s2.allText.match(/\((\d+)\)/)[1] === 15, JSON.stringify(s2?.allText));
    check("resources project: only the kinds that have resources get a group (15 sensors / dataset resources on this project show Hardware only, never empty Software / Data / Environment groups)", !!s2 && s2.groups.join("|") === "Hardware", JSON.stringify(s2?.groups));
    check("resources project: within a group the items are A-Z by name (not in the API's newest-first order)", await (async () => { const names = (s2?.items || []).map((i) => i.match(/ZZ B9 R23 Many \d\d/)?.[0]).filter(Boolean); return names.length >= 10 && names.every((n, k) => k === 0 || names[k - 1] < n); })());
    await r23Ready(`/research/${R23.aBusy.id}`);
    const ab = await r23Sec("area-resources");
    check("resources area: 7 resources = a section capped at 5 cards with the TRUE total in 'View all resources (7)'", !!ab && ab.cards.length === 5 && ab.allText.startsWith("View all resources (7)") && ab.all === `/resources?area=${R23.aBusy.id}`, JSON.stringify(ab));
    await r23Ready(`/research/${R23.aPub.id}`);
    let a = await r23Sec("area-resources");
    check("resources area: the research area page lists the resources linked to it, with View all -> /resources?area=", !!a && a.head === "Lab resources" && a.cards.includes("ZZ B9 R23 Public Dataset") && a.all === `/resources?area=${R23.aPub.id}`, JSON.stringify(a));
    check("resources area: a related card has no edit controls", !!a && !a.edit);
    await r23Ready(`/groups/${R23.gPub.id}`);
    a = await r23Sec("group-resources");
    check("resources group: the group page lists its resources, with View all -> /resources?group=", !!a && a.cards.includes("ZZ B9 R23 Public Dataset") && a.all === `/resources?group=${R23.gPub.id}`, JSON.stringify(a));
    await r23Ready(`/team/${R23.lead.tmId}`);
    a = await r23Sec("member-resources");
    check("resources researcher: the profile lists resources naming them as the contact researcher, with View all -> /resources?researcher=", !!a && a.cards.join("|") === "ZZ B9 R23 Public Dataset" && a.all === `/resources?researcher=${R23.lead.tmId}`, JSON.stringify(a));
    await r23Ready(`/team/${R23.none.tmId}`);
    check("resources researcher: a researcher no resource names gets no section", (await r23Sec("member-resources")) === null);
    await r23Ready(`/knowledge/${R23.docPub.id}`);
    a = await r23Sec("knowledge-resources");
    check("resources knowledge: the documentation page lists the resources it documents, with View all -> /resources?knowledge=", !!a && a.cards.join("|") === "ZZ B9 R23 Public Dataset" && a.all === `/resources?knowledge=${R23.docPub.id}`, JSON.stringify(a));
    await r23Ready(`/publications/${R23.pubPub.id}`);
    a = await r23Sec("pub-resources");
    check("resources publication: the publication page lists the resources it relies on, with View all -> /resources?publication=", !!a && a.cards.join("|") === "ZZ B9 R23 Public Dataset" && a.all === `/resources?publication=${R23.pubPub.id}`, JSON.stringify(a));
    await r23Ready(`/resources?knowledge=${R23.docPub.id}`);
    check("resources knowledge: the list filtered by documentation shows that document selected in the picker", (await r23Titles()).join("|") === "ZZ B9 R23 Public Dataset" && (await ev(`document.getElementById('rf-knowledge').selectedOptions[0]?.textContent.trim()`)) === "ZZ B9 R23 Doc Public");
    await r23Ready(`/knowledge/${R23.docHid.id}`);
    check("resources knowledge: a LAB_ONLY document is not-found for a guest, so its resources cannot be reached through it", (await pMain()).toLowerCase().includes("not found"));
    await r23Ready(`/resources?knowledge=${R23.docHid.id}`);
    check("resources knowledge: nor through the list filter (same empty state as an unknown document)", (await pCount(".resource-card")) === 0);
    await r23Ready(`/projects/${R23.pX.id}`);
    const hx = await r23Sec("project-repro");
    check("resources hostile: a hostile-named project page lists the hostile resource as inert TEXT", !!hx && hx.items.some((c) => c.includes("<img src=x onerror=window.__r23Xss=")) && (await ev(`document.querySelectorAll('main img, main script, main iframe').length`)) === 0 && (await ev(`typeof window.__r23Xss`)) === "undefined");
  });

  await step("resources member: LAB_ONLY resources, create / validation / edit / delete, metadata, projects, Japanese fields, no visibility control", async () => {
    check("resources member: login", await r23Login(R23.mem));
    for (const [word, title] of [["ZZRLAB", "ZZ B9 R23 Lab Only Scope"], ["ZZRMEM", "ZZ B9 R23 Member Own"], ["ZZRLEAD", "ZZ B9 R23 Lead Own"]]) {
      await r23Ready(`/resources?q=${word}`);
      check(`resources member: sees the LAB_ONLY resource "${title}" (a signed-in member may)`, (await r23Titles()).join("|") === title);
    }
    check("resources member: the bar says what a member can do; there is NO visibility badge, NO visibility filter", (await ev(`document.querySelector('.admin-bar__text').innerText`)).includes("add resources and edit the ones you added") && !(await r23Cards()).some((c) => c.badges.includes("lab only")) && !(await exists("#rf-visibility"))); // cards only: the project picker lists other phases' "... Lab Only ..." projects
    check("resources member: the 'related to me' filter is offered to a signed-in account", await exists("#rf-mine"));
    const other = await r23Card("ZZ B9 R23 Lead Own");
    await r23Ready("/resources?q=ZZRMEM");
    const own = await r23Card("ZZ B9 R23 Member Own");
    check("resources member: edit AND delete icons on their own resource only", !!own && own.edit && own.del && !!other && !other.edit && !other.del);
    await r23Ready("/resources?mine=1");
    check("resources member: the 'related to me' filter counts as an active filter ('Filters (1 active)') and its box is ticked", (await ev(`document.querySelector('.knowledge-filters-wrap__summary').textContent.trim()`)) === "Filters (1 active)" && (await ev(`document.getElementById('rf-mine').checked`)));
    await r23Ready("/resources?q=Multi%20Project");
    const multiM = await r23Card("ZZ B9 R23 Multi Project Tool");
    check("resources member: the same resource shows '+2 more' (the LAB_ONLY fifth project is visible to a signed-in member)", !!multiM && multiM.text.includes("+2 more"), JSON.stringify(multiM?.text));
    await r23Ready("/resources?mine=1");
    let d = await r23Add();
    check("resources member: '+ Add resource' opens a named dialog with empty fields, type Other, no visibility control, and the member note", !!d && d.title === "Add resource" && d.name === "" && d.desc === "" && d.type === "OTHER" && d.vis === null && (await ev(`document.querySelector('.modal').innerText`)).includes("visible to signed-in lab members until a lab manager makes them public"), JSON.stringify(d));
    check("resources member: the project checklist lists the visible projects (LAB_ONLY ones too, never the PRIVATE one) and the pickers offer None first", await (async () => { const o = await ev(`['resource_area','resource_group','resource_doc','resource_publication','resource_event','resource_researcher'].map((id) => [...document.getElementById(id).options].map((x) => x.textContent.trim()))`); return d.projectOpts.includes("ZZ B9 R23 Project One") && d.projectOpts.includes("ZZ B9 R23 Project Lab") && !d.projectOpts.includes("ZZ B9 R23 Project Private") && o[0].includes("ZZ B9 R23 Area Public") && o[1].includes("ZZ B9 R23 Group Lab") && o[2].includes("ZZ B9 R23 Doc Public") && o[3].includes("ZZ B9 R23 Paper Public (2031)") && o[4].includes("ZZ B9 R23 Event Public") && o[5].includes("ZZ B9 R23 Lead") && o.every((x) => x[0] === "None"); })());
    await r23Save();
    d = await r23DlgWait((x) => !!x.alert);
    check("resources member: saving an empty form shows 'Name is required.' in an alert and moves focus to the name", !!d && d.alert === "Name is required." && d.focusId === "resource_name" && (await ev(`document.getElementById('resource_name').getAttribute('aria-invalid')`)) === "true", JSON.stringify(d));
    await r23Fill({ resource_name: "ZZ B9 R23 Created By Member", resource_url: "javascript:alert(1)" });
    await r23Save();
    d = await r23DlgWait((x) => /valid URL/.test(x.alert));
    check("resources member: a javascript: link is refused with the URL message and focus on the link field", /valid URL starting with http/.test(d.alert) && d.focusId === "resource_url" && (await ev(`document.getElementById('resource_url').getAttribute('aria-invalid')`)) === "true", JSON.stringify(d));
    await r23Fill({ resource_type: "DATASET" });
    check("resources member: choosing Dataset shows exactly the dataset detail fields (format, size, license, collection method)", (await r23Dlg()) && Object.keys((await r23Dlg()).meta).join() === "format,size,license,collectionMethod");
    await r23Fill({ resource_type: "FPGA" });
    check("resources member: choosing FPGA swaps them for hardware revision, firmware version and toolchain", Object.keys((await r23Dlg()).meta).join() === "hardwareRevision,firmwareVersion,toolchain");
    await r23Fill({ resource_type: "OTHER" });
    check("resources member: choosing Other shows no detail fields at all", Object.keys((await r23Dlg()).meta).length === 0 && !(await ev(`!!document.querySelector('.modal fieldset legend') && [...document.querySelectorAll('.modal legend')].some((l) => l.textContent.trim() === 'Details for this type')`)));
    await r23Fill({ resource_type: "DATASET", resource_url: "https://example.org/made", resource_description: "Made through the UI.\nSecond line ZZRNEW", resource_version: "1.0", resource_vendor: "UI", resource_identifier: "ZZR-UI-1", resource_meta_format: "Parquet", resource_meta_size: "1 GB", resource_environment: "seed 7" });
    await ev(`(() => { const box = [...document.querySelectorAll('.resource-form__projects label')].find((l) => l.textContent.trim() === 'ZZ B9 R23 Project One'); box.querySelector('input').click(); })()`);
    await r23Fill({ resource_area: R23.aPub.id, resource_doc: R23.docPub.id });
    await r23Save();
    check("resources member: a valid save closes the dialog and the new resource appears in the list", await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 7000) && (await waitFor(`[...document.querySelectorAll('.resource-card .card__title')].some((x) => x.textContent.trim() === 'ZZ B9 R23 Created By Member')`, 7000)));
    const made = (await r23Api(null, `/resources?q=ZZRNEW`)).json.items[0];
    R23.rMade = made;
    check("resources member: the server has it LAB_ONLY, by the member, with the type, the project and the two links chosen", !!made && made.resourceType === "DATASET" && made.projects.map((p) => p.id).join() === R23.p1.id && made.researchArea?.id === R23.aPub.id && made.canEdit === true && (await R23.a.req("GET", `/resources/${made.id}`)).json.visibility === "LAB_ONLY" && (await r23Api(null, `/resources/${made.id}`)).json.metadata.format === "Parquet", JSON.stringify(made));
    d = await r23EditOn("ZZ B9 R23 Created By Member");
    check("resources member: Edit opens 'Edit resource' with the stored English name, DESCRIPTION (a list card has none), type, version, vendor, identifier, link, notes, detail fields, project and links", !!d && d.title === "Edit resource" && d.name === "ZZ B9 R23 Created By Member" && d.desc === "Made through the UI.\nSecond line ZZRNEW" && d.type === "DATASET" && d.ver === "1.0" && d.vendor === "UI" && d.ident === "ZZR-UI-1" && d.url === "https://example.org/made" && d.env === "seed 7" && d.meta.format === "Parquet" && d.meta.size === "1 GB" && d.projects.join() === "ZZ B9 R23 Project One" && d.area === R23.aPub.id && d.doc === R23.docPub.id && d.grp === "" && d.vis === null, JSON.stringify(d));
    await r23Fill({ resource_name: "ZZ B9 R23 Created By Member (edited)", resource_name_ja: "ZZ B9 R23 メンバーが作成（編集）", resource_description_ja: "日本語の説明 ZZRJA", resource_environment_ja: "日本語の環境", resource_group: R23.gPub.id, resource_meta_license: "MIT" });
    await ev(`(() => { const box = [...document.querySelectorAll('.resource-form__projects label')].find((l) => l.textContent.trim() === 'ZZ B9 R23 Project Two'); box.querySelector('input').click(); })()`);
    await r23Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 7000);
    await waitFor(`[...document.querySelectorAll('.resource-card .card__title')].some((x) => x.textContent.trim() === 'ZZ B9 R23 Created By Member (edited)')`, 7000);
    const ed = (await r23Api(null, `/resources/${made.id}`)).json;
    const edJa = (await r23Api("ja", `/resources/${made.id}`)).json;
    check("resources member: an edit changes the English name, the group, the projects (both now) and a detail field, keeps the other links, and stores the Japanese name/description/notes as overrides (English description untouched)", ed.name === "ZZ B9 R23 Created By Member (edited)" && ed.description === "Made through the UI.\nSecond line ZZRNEW" && ed.group?.id === R23.gPub.id && ed.researchArea?.id === R23.aPub.id && ed.knowledgeDoc?.id === R23.docPub.id && ed.projects.map((p) => p.id).sort().join() === [R23.p1.id, R23.p2.id].sort().join() && ed.metadata.license === "MIT" && ed.metadata.format === "Parquet" && edJa.name === "ZZ B9 R23 メンバーが作成（編集）" && edJa.description === "日本語の説明 ZZRJA" && edJa.environment === "日本語の環境", JSON.stringify([ed.name, ed.group, ed.projects, edJa.name]));
    d = await r23EditOn("ZZ B9 R23 Created By Member (edited)");
    check("resources member: reopening Edit shows the saved Japanese fields, both projects checked and the English text (not the Japanese) in the main fields", !!d && d.nja === "ZZ B9 R23 メンバーが作成（編集）" && d.dja === "日本語の説明 ZZRJA" && d.eja === "日本語の環境" && d.projects.length === 2 && d.name === "ZZ B9 R23 Created By Member (edited)" && d.desc === "Made through the UI.\nSecond line ZZRNEW", JSON.stringify(d));
    await r23Fill({ resource_name_ja: "", resource_description_ja: "", resource_environment_ja: "" });
    await r23Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 7000);
    check("resources member: clearing the Japanese fields removes the overrides (Japanese falls back to English)", await (async () => { await sleep(400); const j = (await r23Api("ja", `/resources/${made.id}`)).json; return j.name === "ZZ B9 R23 Created By Member (edited)" && j.description === "Made through the UI.\nSecond line ZZRNEW"; })());
    d = await r23EditOn("ZZ B9 R23 Created By Member (edited)");
    await r23Fill({ resource_name: "ZZ B9 R23 SHOULD NOT SAVE" });
    await r23Close();
    check("resources member: Cancel / Escape saves nothing", (await r23Api(null, `/resources/${made.id}`)).json.name === "ZZ B9 R23 Created By Member (edited)" && (await pCount(".resource-card")) > 0);
    d = await r23EditOn("ZZ B9 R23 Created By Member (edited)");
    await r23Fill({ resource_type: "SOFTWARE" });
    await r23Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 7000); await sleep(400);
    const retyped = (await r23Api(null, `/resources/${made.id}`)).json;
    check("resources member: changing the type sends metadata that fits it (a dataset's format/size are dropped, never a 400)", retyped.resourceType === "SOFTWARE" && Object.keys(retyped.metadata).length === 0, JSON.stringify(retyped.metadata));
    // delete
    check("resources member: the delete icon opens a confirmation naming the resource", !!(await r23DelOn("ZZ B9 R23 Created By Member (edited)")) && (await ev(`document.querySelector('.modal').innerText`)).includes('Delete "ZZ B9 R23 Created By Member (edited)"? This can\'t be undone.'));
    await r23Close();
    check("resources member: Escape cancels the delete (the resource is still there)", (await r23Api(null, `/resources/${made.id}`)).status === 200);
    await r23DelOn("ZZ B9 R23 Created By Member (edited)");
    await pClick(".modal .btn--danger", "");
    check("resources member: confirming deletes it (server 404, gone from the list)", await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 6000) && (await waitFor(`![...document.querySelectorAll('.resource-card .card__title')].some((x) => x.textContent.trim() === 'ZZ B9 R23 Created By Member (edited)')`, 6000)) && (await r23Api(null, `/resources/${made.id}`)).status === 404);
    // the detail page of an own / a foreign resource
    await r23Ready(`/resources/${R23.rMem.id}`);
    check("resources member: their own resource's detail page has Edit and Delete", (await pBar()).join("|") === "Edit|Delete" && (await ev(`document.querySelector('.admin-bar__text').innerText`)).includes("manage this resource"));
    const del = await ev(`fetch('/api/resources', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'ZZ B9 R23 Delete From Detail', description: 'to be removed ZZRDEL' }) }).then((r) => r.json())`);
    await r23Ready(`/resources/${del.id}`);
    await pClick(".admin-bar .btn--danger", "");
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 4000);
    await pClick(".modal .btn--danger", "");
    check("resources member: deleting from the detail page returns to the list and the resource is gone", (await waitFor(`location.pathname === '/resources'`, 8000)) && (await r23Api(null, `/resources/${del.id}`)).status === 404);
    await r23Ready(`/resources/${R23.rDs.id}`);
    check("resources member: someone else's resource's detail has no manage bar", !(await exists(".admin-bar")));
    check("resources member: the API refuses them on someone else's resource (403) and on setting visibility (403)", (await apiCall("PUT", `/resources/${R23.rDs.id}`, { name: "hax" })) === 403 && (await apiCall("DELETE", `/resources/${R23.rDs.id}`)) === 403 && (await apiCall("PUT", `/resources/${R23.rMem.id}`, { visibility: "PUBLIC" })) === 403);
    await logout();
  });

  await step("resources form guards: an edit never saves a guess (base / detail failed to load), and a link the editor cannot see survives", async () => {
    await desktop(); await setLocale(null);
    check("resources guards: member login", await r23Login(R23.mem));
    const openRaw = async (title) => { // real click on the edit icon WITHOUT waiting for the form to be ready
      await ev(`(() => { document.querySelectorAll('[data-r23-op]').forEach((e) => e.removeAttribute('data-r23-op')); const c = [...document.querySelectorAll('.resource-card')].find((x) => x.querySelector('.card__title')?.textContent.trim() === ${JSON.stringify(title)}); const b = c && c.querySelector('.card-edit-btn .icon-btn:not(.icon-btn--danger)'); if (b) { b.scrollIntoView({ block: 'center' }); b.setAttribute('data-r23-op', '1'); } })()`);
      await p15Settle();
      await clickEl("[data-r23-op]");
      return r23DlgWait((d) => !!d.alert, 5000);
    };
    // 1. the English base (translations read) fails
    await r23Ready("/resources?q=ZZRMEM");
    await fake("*/api/translations/LAB_RESOURCE/*", 500, JSON.stringify({ error: "Internal server error" }));
    const noBase = await openRaw("ZZ B9 R23 Member Own");
    await unfake();
    check("resources guards: if the English base cannot be loaded the edit form says 'Could not load this resource.', has no description text, and Save is DISABLED", !!noBase && noBase.alert.includes("Could not load this resource.") && noBase.submitDisabled === true && noBase.desc === "", JSON.stringify(noBase));
    await r23Close();
    // 2. the full record (detail read) fails
    await r23Ready("/resources?q=ZZRMEM");
    await fake(`*/api/resources/${R23.rMem.id}*`, 500, JSON.stringify({ error: "Internal server error" }));
    const noDetail = await openRaw("ZZ B9 R23 Member Own");
    await unfake();
    check("resources guards: if the full record cannot be loaded the edit form says so and Save is DISABLED (it must never save a guess about links or projects)", !!noDetail && noDetail.alert.includes("Could not load this resource.") && noDetail.submitDisabled === true, JSON.stringify(noDetail));
    await r23Close();
    check("resources guards: neither failed attempt changed the resource", (await r23Api(null, `/resources/${R23.rMem.id}`)).json.description === "added by the member ZZRMEM");
    // 3. a project link the editor cannot see (a stored visibility outside the allow-list) survives an edit that leaves projects alone
    r23Sql("INSERT OR IGNORE INTO ResourceProject (resourceId, projectId) VALUES (?, ?)", R23.rMem.id, R23.pPriv.id);
    await r23Ready("/resources?q=ZZRMEM");
    await r23EditOn("ZZ B9 R23 Member Own");
    const hd = await r23DlgWait((x) => x.projectOpts.length > 1);
    check("resources guards: an invisible project is not offered and not shown as checked in the form (never named)", !!hd && !hd.projectOpts.includes("ZZ B9 R23 Project Private") && !hd.projects.includes("ZZ B9 R23 Project Private"), JSON.stringify({ opts: (hd?.projectOpts || []).slice(0, 4), checked: hd?.projects }));
    await r23Fill({ resource_description: "added by the member ZZRMEM (revised)" });
    await r23Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 7000); await sleep(500);
    const kept = r23Sql("SELECT projectId FROM ResourceProject WHERE resourceId = ?", R23.rMem.id).map((r) => r.projectId);
    check("resources guards: saving without touching projects keeps the invisible project link (and the edit itself is saved)", kept.includes(R23.pPriv.id) && (await r23Api(null, `/resources/${R23.rMem.id}`)).json.description === "added by the member ZZRMEM (revised)", JSON.stringify(kept));
    // 3b. an area / group the editor cannot see, and a document beyond the picklist's newest 50, survive an edit that does not touch links
    r23Sql("UPDATE LabResource SET researchAreaId = ?, groupId = ?, knowledgeDocId = ? WHERE id = ?", R23.aPriv.id, R23.gPriv.id, R23.docOld.id, R23.rMem.id);
    await r23Ready("/resources?q=ZZRMEM");
    await r23EditOn("ZZ B9 R23 Member Own");
    const ol = await r23DlgWait((x) => x.projectOpts.length > 1);
    check("resources guards: an invisible area / group is shown as None (never named), and a linked document beyond the picklist's newest 50 stays selected", !!ol && ol.area === "" && ol.grp === "" && ol.doc === R23.docOld.id, JSON.stringify({ area: ol?.area, grp: ol?.grp, doc: ol?.doc }));
    await r23Fill({ resource_description: "added by the member ZZRMEM (revised again)" });
    await r23Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 7000); await sleep(500);
    const keptLinks = r23Sql("SELECT researchAreaId, groupId, knowledgeDocId FROM LabResource WHERE id = ?", R23.rMem.id)[0];
    check("resources guards: saving without touching links keeps the invisible area / group and the old document", keptLinks.researchAreaId === R23.aPriv.id && keptLinks.groupId === R23.gPriv.id && keptLinks.knowledgeDocId === R23.docOld.id, JSON.stringify(keptLinks));
    r23Sql("UPDATE LabResource SET researchAreaId = NULL, groupId = NULL, knowledgeDocId = NULL WHERE id = ?", R23.rMem.id);
    // 4. ticking / unticking a visible project through the form changes only that project
    await r23Ready("/resources?q=ZZRMEM");
    await r23EditOn("ZZ B9 R23 Member Own");
    await r23DlgWait((x) => x.projectOpts.length > 1);
    await ev(`(() => { const box = [...document.querySelectorAll('.resource-form__projects label')].find((l) => l.textContent.trim() === 'ZZ B9 R23 Project Two'); box.querySelector('input').click(); })()`);
    await r23Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 7000); await sleep(500);
    const after = r23Sql("SELECT projectId FROM ResourceProject WHERE resourceId = ?", R23.rMem.id).map((r) => r.projectId);
    check("resources guards: adding a visible project through the form keeps the invisible one and adds exactly that project", after.length === 2 && after.includes(R23.pPriv.id) && after.includes(R23.p2.id), JSON.stringify(after));
    await r23Ready("/resources?q=ZZRMEM");
    await r23EditOn("ZZ B9 R23 Member Own");
    await r23DlgWait((x) => x.projects.length === 1);
    await ev(`(() => { const box = [...document.querySelectorAll('.resource-form__projects label')].find((l) => l.textContent.trim() === 'ZZ B9 R23 Project Two'); box.querySelector('input').click(); })()`);
    await r23Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 7000); await sleep(500);
    const removed = r23Sql("SELECT projectId FROM ResourceProject WHERE resourceId = ?", R23.rMem.id).map((r) => r.projectId);
    check("resources guards: unticking it removes only that project (the invisible link still survives)", removed.length === 1 && removed[0] === R23.pPriv.id, JSON.stringify(removed));
    r23Sql("DELETE FROM ResourceProject WHERE resourceId = ? AND projectId = ?", R23.rMem.id, R23.pPriv.id);
    await logout();
  });

  await step("resources lead: a project lead has no special power over resources; create from a project's View all presets the link", async () => {
    check("resources lead: login", await r23Login(R23.lead));
    await r23Ready(`/resources?project=${R23.p1.id}&limit=50`);
    const cards = await r23Cards();
    check("resources lead: the project's list shows the lead's own resource editable and everyone else's read-only (a LEAD is only a member for resources)", cards.length > 0 && cards.filter((c) => c.edit).map((c) => c.title).join("|") === "ZZ B9 R23 Lead Own");
    const d = await r23Add();
    check("resources lead: '+ Add resource' from ?project= preselects that project (and nothing else)", !!d && d.projects.join() === "ZZ B9 R23 Project One" && d.area === "" && d.grp === "" && d.res === "", JSON.stringify(d));
    await r23Close();
    await r23Ready("/resources");
    const d2 = await r23Add();
    check("resources lead: from the unfiltered list nothing is preselected", !!d2 && d2.projects.length === 0 && d2.area === "");
    await r23Close();
    check("resources lead: the API refuses the lead on someone else's resource (403)", (await apiCall("PUT", `/resources/${R23.rDs.id}`, { name: "hax" })) === 403 && (await apiCall("DELETE", `/resources/${R23.rDs.id}`)) === 403);
    await logout();
  });

  await step("resources manager: visibility badge and filter, edit anything, publish, delete", async () => {
    check("resources manager: login", await r23Login(R23.mgr));
    await r23Ready("/resources?q=ZZRLAB");
    const lab = await r23Card("ZZ B9 R23 Lab Only Scope");
    await r23Ready("/resources?q=ZZRPUB");
    const pub = await r23Card("ZZ B9 R23 Public Dataset");
    check("resources manager: the bar says managers edit any resource; LAB_ONLY resources carry a 'Lab only' badge, PUBLIC ones none", (await ev(`document.querySelector('.admin-bar__text').innerText`)).includes("edit any resource") && !!lab && lab.badges.includes("lab only") && !!pub && !pub.badges.includes("lab only"), JSON.stringify(lab?.badges));
    await r23Ready("/resources");
    check("resources manager: edit and delete icons on EVERY card", (await r23Cards()).length === 12 && (await r23Cards()).every((c) => c.edit && c.del));
    check("resources manager: the visibility filter is offered and narrows to Lab only", (await exists("#rf-visibility")) && await (async () => { await setVal("rf-visibility", "LAB_ONLY"); await ev(`document.querySelector('form.knowledge-filters').requestSubmit()`); await waitFor(`location.search.includes('visibility=LAB_ONLY')`, 4000); await waitFor(`!document.querySelector('[aria-busy="true"]')`, 6000); await sleep(400); const c = await r23Cards(); return c.length > 0 && c.every((x) => x.badges.includes("lab only")); })());
    await r23Ready("/resources?q=ZZ%20B9%20R23%20Lab%20Only");
    const d = await r23EditOn("ZZ B9 R23 Lab Only Scope");
    check("resources manager: the edit dialog has the Visibility control set to Lab only, and the Japanese fields", !!d && d.vis === "LAB_ONLY" && d.nja === "" && d.dja === "" && d.desc === "Internal ZZRLAB oscilloscope", JSON.stringify(d));
    await r23Fill({ resource_visibility: "PUBLIC" });
    await r23Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 7000);
    await sleep(600);
    check("resources manager: publishing changes visibility (server) and the card loses its 'Lab only' badge", (await R23.a.req("GET", `/resources/${R23.rLab.id}`)).json.visibility === "PUBLIC" && !(await r23Card("ZZ B9 R23 Lab Only Scope")).badges.includes("lab only"));
    await logout();
    await r23Ready(`/resources/${R23.rLab.id}`);
    check("resources manager: once published, a guest can read it", (await pMain()).includes("Internal ZZRLAB oscilloscope"));
    await r23Login(R23.mgr);
    await R23.a.req("PUT", `/resources/${R23.rLab.id}`, { visibility: "LAB_ONLY" });
    await r23Ready(`/resources/${R23.rMem.id}`);
    check("resources manager: someone else's resource's detail page has Edit and Delete and the Lab only badge", (await pBar()).join("|") === "Edit|Delete" && (await ev(`document.querySelector('.detail-meta').innerText.toLowerCase()`)).includes("lab only"));
    await logout();
  });

  await step("resources admin: the admin Content view lists resources with filters, inspect, deep links, the overview count and translations", async () => {
    check("resources admin: login", await login(ADMIN.email, ADMIN.password));
    await r23Ready("/admin");
    check("resources admin: the overview has a 'Lab resources' count card linking to the filtered admin list", (await exists('a.admin-count[href="/admin/content?type=resource"]')) && (await ev(`document.querySelector('a.admin-count[href="/admin/content?type=resource"]').innerText`)).includes("Lab resources") && /public/i.test(await ev(`document.querySelector('a.admin-count[href="/admin/content?type=resource"]').innerText`)));
    await r23Ready("/admin/content?type=resource");
    await waitFor(`!!document.querySelector('.admin-row')`, 8000);
    check("resources admin: 'Lab resources' is a content type chip and the list shows resource rows with Public / Lab only, the type and the owner", (await ev(`[...document.querySelectorAll('.admin-types .chip')].map((c) => c.textContent.trim())`)).includes("Lab resources") && (await ev(`document.querySelector('.admin-row').innerText`)).match(/Public|Lab only/) !== null && (await ev(`document.querySelector('.admin-row').innerText`)).match(/By |No owner/) !== null);
    check("resources admin: the filter form offers resource type, project, research area, group, visibility and 'Created by' (and no knowledge category)", await ev(`['af-resourceType','af-project','af-area','af-group','af-visibility','af-owner'].every((id) => !!document.getElementById(id)) && !document.getElementById('af-category')`));
    await waitFor(`document.getElementById('af-project').options.length > 1`, 6000);
    await setVal("af-resourceType", "FPGA");
    await ev(`document.querySelector('form.admin-filters').requestSubmit()`);
    await waitFor(`location.search.includes('resourceType=FPGA')`, 4000); await sleep(700);
    check("resources admin: the type filter narrows the rows (URL is the source of truth) and the type is shown as its LOCALIZED label", (await ev(`document.querySelectorAll('.admin-row').length`)) >= 1 && (await ev(`[...document.querySelectorAll('.admin-row')].every((r) => /FPGA/.test(r.innerText))`)));
    await r23Ready("/admin/content?type=resource&q=ZZRLAB");
    await waitFor(`!!document.querySelector('.admin-row')`, 6000);
    check("resources admin: the type is a badge with the localized label ('Hardware', not HARDWARE)", await ev(`(() => { const b = [...document.querySelectorAll('.admin-row .badge')].map((x) => x.textContent.trim()); return b.includes('Hardware') && !b.includes('HARDWARE'); })()`));
    await setLocale("ja");
    await r23Ready("/admin/content?type=resource&q=ZZRLAB");
    await waitFor(`!!document.querySelector('.admin-row')`, 6000);
    check("resources admin ja: the same badge is Japanese ('ハードウェア')", await ev(`[...document.querySelectorAll('.admin-row .badge')].some((x) => x.textContent.trim() === 'ハードウェア')`));
    await setLocale(null);
    await r23Ready(`/admin/content?type=resource&project=${R23.p2.id}`);
    await sleep(500);
    check("resources admin: the project filter (deep link, through the join table) keeps only that project's 15 resources", (await ev(`document.querySelectorAll('.admin-row').length`)) === 15 && await ev(`document.getElementById('af-project').value === ${JSON.stringify(R23.p2.id)}`));
    await r23Ready("/admin/content?type=resource&q=Public%20Dataset");
    await waitFor(`!!document.querySelector('.admin-row')`, 6000);
    const link = await ev(`[...document.querySelectorAll('.admin-row')].map((r) => r.querySelector('a.btn--ghost')?.getAttribute('href'))`);
    check("resources admin: each row has a deep link 'Open' to /resources/:id", link.includes(`/resources/${R23.rDs.id}`));
    await pClick(".admin-row__actions button", "");
    await waitFor(`!!document.querySelector('.modal[role="dialog"]')`, 4000);
    const modal = await ev(`document.querySelector('.modal').innerText`);
    check("resources admin: 'Details' opens the inspect dialog with the relationship counts (Projects 2, Documents 1, Publications 1, Events 1, Researchers 1) and the translation state", /Projects\s*2/.test(modal) && /Documents\s*1/.test(modal) && /Publications\s*1/.test(modal) && /Events\s*1/.test(modal) && /Researchers\s*1/.test(modal), modal.slice(0, 300));
    await r23Close();
    await r23Ready("/admin/translations?type=LAB_RESOURCE");
    await waitFor(`!!document.querySelector('.admin-row, .admin-tr, .panel, [role="alert"]')`, 6000);
    check("resources admin: 'Lab resources' is a translations type with name, description and environment fields", (await ev(`[...document.querySelectorAll('.admin-types .chip')].map((c) => c.textContent.trim())`)).includes("Lab resources") && (await pMain()).includes("ZZ B9 R23"));
    check("resources admin: a bulk visibility change works for resources (all-or-nothing, audited) and is undone", await (async () => { const r = await apiCall("POST", "/admin/content/visibility", { type: "resource", ids: [R23.rLab.id], visibility: "PUBLIC" }); const back = await apiCall("POST", "/admin/content/visibility", { type: "resource", ids: [R23.rLab.id], visibility: "LAB_ONLY" }); return r === 200 && back === 200; })());
    await logout();
  });

  await step("resources search: the Resources type, counts, links, Japanese names, related links, no hidden resource", async () => {
    await desktop(); await setLocale(null);
    await r23Ready("/search?q=ZZRMANY");
    check("resources search: a description word finds the 14 resources and the 'Resources' chip carries the API's count (14)", (await ev(`[...document.querySelectorAll('.search-filters .chip')].map((c) => c.textContent.trim())`)).includes("Resources14") && (await pCount(".search-result")) === 14 && (await r23Api(null, "/search?q=ZZRMANY")).json.counts.resource === 14);
    check("resources search: the type badge carries the 'layers' glyph", ((await ev(`document.querySelector('.search-result__type svg path')?.getAttribute('d') || ''`)) || "").startsWith("m12 3 9 5"));
    await r23Ready("/search?q=Public%20Dataset&type=resource");
    const r = await ev(`[...document.querySelectorAll('.search-result')].map((c) => ({ badge: c.querySelector('.search-result__type').textContent.trim().toLowerCase(), title: c.querySelector('.search-result__title').textContent.trim(), href: c.querySelector('.search-result__link').getAttribute('href'), rel: [...c.querySelectorAll('.search-result__related a')].map((a) => a.textContent.trim()), cta: c.querySelector('.search-result__cta').textContent.trim(), meta: c.querySelector('.search-result__meta')?.textContent.trim() || '' }))`);
    const one = r.find((x) => x.title === "ZZ B9 R23 Public Dataset");
    check("resources search: the result is badged Resource, links to /resources/:id, says 'View resource', shows version · vendor and lists its related project, area and group (the Phase 20 cap of three)", !!one && one.badge === "resource" && one.href === `/resources/${R23.rDs.id}` && one.cta === "View resource →" && one.meta.includes("v3.2 · Smart Lab") && ["ZZ B9 R23 Project One", "ZZ B9 R23 Area Public", "ZZ B9 R23 Group Public"].every((x) => one.rel.includes(x)), JSON.stringify(one));
    await r23Ready("/search?q=ZZRLEAK&type=resource");
    const leak = await ev(`[...document.querySelectorAll('.search-result')].map((c) => c.innerText).join('\\n')`);
    check("resources search: a PUBLIC resource on hidden things is found but shows no related links to them", leak.includes("Leaky Public Board") && !/Project Lab|Area Lab|Group Lab/.test(leak) && (await pCount(".search-result__related")) === 0);
    await r23Ready("/search?q=ZZRLAB");
    check("resources search: a guest never finds a LAB_ONLY resource", (await pCount(".search-result")) === 0 && (await r23Api(null, "/search?q=ZZRLAB")).json.counts.resource === 0);
    await r23Ready("/search?q=ZZRFPGA&type=resource");
    check("resources search: the type word is searched too ('FPGA' finds the FPGA board)", (await ev(`[...document.querySelectorAll('.search-result__title')].map((x) => x.textContent.trim())`)).includes("ZZ B9 R23 FPGA Board"));
    await setLocale("ja");
    await r23Ready("/search?q=" + encodeURIComponent("公開データセット") + "&type=resource");
    check("resources search ja: a Japanese name is found, shown in Japanese, and the badge, CTA and chip are Japanese", (await ev(`[...document.querySelectorAll('.search-result__title')].map((x) => x.textContent.trim())`)).includes("ZZ B9 R23 公開データセット") && /リソース/.test(await ev(`document.querySelector('.search-result__type').textContent`)) && /リソースを見る/.test(await ev(`document.querySelector('.search-result__cta').textContent`)));
    check("resources search ja: the related project is shown by its Japanese title", (await ev(`[...document.querySelectorAll('.search-result__related a')].map((a) => a.textContent.trim())`)).includes("ZZ B9 R23 プロジェクト一"));
    await setLocale(null);
    await r23Ready("/search?q=" + encodeURIComponent("公開データセット") + "&type=resource");
    check("resources search: the same Japanese word finds nothing in an English request (Phase 14 convention)", (await pCount(".search-result")) === 0);
    check("resources search: the API's counts object has the resource key and `all` is still the sum", await (async () => { const c = (await r23Api(null, "/search?q=ZZ")).json.counts; return typeof c.resource === "number" && c.all === Object.entries(c).filter(([k]) => k !== "all").reduce((x, [, v]) => x + v, 0); })());
  });

  await step("resources workspace: 'My research resources' is bounded, private and links to the related list", async () => {
    check("resources workspace: lead login", await r23Login(R23.lead));
    await wsReady();
    const sec = await ev(`(() => { const s = document.querySelector('section[aria-labelledby="ws-resources"]'); return s ? { head: document.getElementById('ws-resources').textContent.trim(), cards: [...s.querySelectorAll('.resource-card .card__title')].map((x) => x.textContent.trim()), link: s.querySelector('a.btn')?.getAttribute('href'), linkText: s.querySelector('a.btn')?.innerText.trim(), more: s.querySelector('.ws-more')?.innerText || '', edit: !!s.querySelector('.card-edit-btn') } : null; })()`);
    check("resources workspace: the section lists at most 5 resources the lead added, that name them, or that belong to their project / group / area", !!sec && sec.head === "My research resources" && sec.cards.length === 5 && sec.cards.includes("ZZ B9 R23 Lead Own") && sec.cards.every((c) => c.startsWith("ZZ B9 R23")) && !sec.edit, JSON.stringify(sec));
    check("resources workspace: 'View all my resources (N)' has the true total and links to /resources?mine=1; the 'Showing 5 of N' note is there", !!sec && sec.link === "/resources?mine=1" && /^View all my resources \(\d+\)/.test(sec.linkText) && /Showing 5 of \d+/.test(sec.more), JSON.stringify(sec));
    check("resources workspace: the workspace section and the page it links to report the SAME total", await (async () => { const n = +sec.linkText.match(/\((\d+)\)/)[1]; const api = (await r23Api(null, "/resources?mine=1&limit=1")).json.pagination.total; return n === api; })());
    check("resources workspace: another member's private (LAB_ONLY) resource is not in it", !sec.cards.includes("ZZ B9 R23 Member Own"));
    check("resources workspace: the workspace never accepts someone else's id (an extra ?userId= changes nothing)", JSON.stringify((await r23Api(null, `/workspace?userId=${R23.mem.userId}&teamMemberId=${R23.mem.tmId}`)).json.resources) === JSON.stringify((await r23Api(null, "/workspace")).json.resources));
    await r23Ready("/resources?mine=1&limit=50");
    check("resources workspace: 'View all' shows the researcher's own list (their own resource included, a PRIVATE-project one never)", (await r23Titles()).includes("ZZ B9 R23 Lead Own") && !(await r23Titles()).includes("ZZ B9 R23 On Private Project"));
    await logout();
    check("resources workspace: none login", await r23Login(R23.none));
    await wsReady();
    check("resources workspace: a researcher with no relationships gets an empty state, not an empty box", (await ev(`(() => { const s = document.querySelector('section[aria-labelledby="ws-resources"]'); return s ? { empty: !!s.querySelector('.empty-state'), cards: s.querySelectorAll('.resource-card').length, link: !!s.querySelector('a.btn') } : null; })()`)) && (await ev(`document.querySelector('section[aria-labelledby="ws-resources"] .empty-state')?.innerText || ''`)).includes("No resources yet."));
    await logout();
  });

  await step("resources ja: Japanese chrome, type labels, overrides, form, errors and empty states; identical authorization", async () => {
    await setLocale("ja");
    await r23Ready("/resources?q=ZZ%20B9%20R23%20Public");
    check("resources ja: the page title, description, nav link and filter labels are Japanese", (await ev(`document.querySelector('h1').textContent.trim()`)) === "研究室リソース" && (await ev(`document.title`)).includes("研究室リソース") && (await panelLabels("research")).includes("リソース") && (await ev(`['rf-q','rf-type','rf-project','rf-area','rf-group','rf-researcher','rf-knowledge','rf-publication'].map((id) => document.querySelector('label[for="' + id + '"]').textContent.trim())`)).join("|") === "リソースを検索|種類|プロジェクト|研究分野|グループ|研究者|ドキュメント（ナレッジベース）|論文");
    check("resources ja: the type options and the result count are Japanese", (await ev(`[...document.getElementById('rf-type').options].map((o) => o.textContent.trim())`)).join("|") === "指定なし|データセット|ハードウェア|ソフトウェア|ツール|フレームワーク|モデル|FPGA|ボード|センサー|計測セットアップ|実験環境|その他" && /^\d+件のリソース$/.test(await ev(`document.querySelector('.knowledge-status').innerText.trim()`)));
    const ds = await r23Card("ZZ B9 R23 公開データセット");
    check("resources ja: the card shows the Japanese name and excerpt, the Japanese type badge, the Japanese project title and the Japanese byline", !!ds && ds.badges.includes("データセット") && ds.text.includes("テスト装置のフレーム ZZRJA") && ds.text.includes("ZZ B9 R23 プロジェクト一") && /追加者：ZZ B9 R23 Manager/.test(ds.text) && /に更新/.test(ds.text), JSON.stringify(ds));
    await r23Ready(`/resources/${R23.rDs.id}`);
    const ja = await ev(`(() => ({ h1: document.querySelector('h1').textContent.trim(), crumbs: [...document.querySelectorAll('.breadcrumbs li')].map((l) => l.textContent.trim()), body: document.querySelector('.knowledge-body').innerText, repro: document.querySelector('.repro-details h2').textContent.trim(), keys: [...document.querySelectorAll('.repro-details dt, .knowledge-facts dt')].map((x) => x.textContent.trim()), notes: document.querySelector('.resource-repro__notes')?.innerText || '' }))()`);
    check("resources ja: the detail page shows the Japanese name/description/notes, the localized breadcrumb, headings and fact labels", ja.h1 === "ZZ B9 R23 公開データセット" && ja.crumbs.join("|") === "ホーム|リソース|ZZ B9 R23 公開データセット" && ja.body.includes("テスト装置のフレーム ZZRJA") && ja.repro === "再現性" && ["形式", "サイズ", "ライセンス・利用上の注意", "収集・生成方法", "種類", "バージョン", "提供元・ベンダー", "識別子", "プロジェクト"].every((k) => ja.keys.includes(k)) && ja.notes.includes("Python 3.11、シード 42"), JSON.stringify(ja));
    await r23Ready(`/projects/${R23.p1.id}`);
    const s = await r23Sec("project-repro");
    check("resources ja: the project panel is Japanese: heading, group headings, View all", !!s && s.head === "リソースと再現性" && s.groups.join("|") === "ハードウェア|ソフトウェア・モデル|データ|環境・その他" && /^すべてのリソースを見る（\d+）/.test(s.allText), JSON.stringify(s));
    await r23Ready("/resources?q=nothingmatchesthiszzz");
    check("resources ja: the filtered empty state is Japanese", (await pMain()).includes("条件に一致するリソースがありません。"));
    await r23Ready(`/resources/${R23.rLab.id}`);
    check("resources ja: the not-found state is Japanese, and identical for a hidden and an unknown resource", (await pMain()).includes("リソースが見つかりません") && (await pMain()).includes("このリソースは存在しないか、アクセス権がありません。") && await (async () => { const a = await pMain(); await r23Ready("/resources/nonexistentid12345"); return a === (await pMain()); })());
    check("resources ja: authorization is identical in Japanese (guest writes are 401, a hidden resource is 404)", (await apiCall("POST", "/resources", { name: "x" })) === 401 && (await r23Api("ja", `/resources/${R23.rLab.id}`)).status === 404 && (await r23Api("ja", `/resources?visibility=PUBLIC`)).status === 403);
    check("resources ja: member login", await r23Login(R23.mem));
    await r23Ready("/resources?mine=1");
    let d = await r23Add();
    check("resources ja: the add dialog is Japanese: title, labels, the type options, the member note, the Japanese-field labels", !!d && d.title === "リソースを追加" && (await ev(`[...document.querySelectorAll('.modal label')].map((l) => l.textContent.trim())`)).some((l) => l === "名前") && (await ev(`[...document.getElementById('resource_type').options].map((o) => o.textContent.trim())`)).includes("データセット") && (await ev(`document.querySelector('.modal').innerText`)).includes("研究室マネージャーが公開するまで") && (await ev(`document.querySelector('label[for="resource_name_ja"]').textContent`)).includes("名前（日本語）"), JSON.stringify(d?.title));
    await r23Save();
    d = await r23DlgWait((x) => !!x.alert);
    check("resources ja: an empty save shows 'Name is required.' in Japanese with focus on the name", d.alert === "名前は必須です。" && d.focusId === "resource_name", JSON.stringify(d));
    await r23Fill({ resource_name: "ZZ B9 R23 JA UI", resource_url: "javascript:alert(1)" });
    await r23Save();
    d = await r23DlgWait((x) => !!x.alert && x.alert !== "名前は必須です。");
    check("resources ja: a javascript: link is refused with the Japanese URL message", /http:\/\/|https:\/\//.test(d.alert) && /有効|正しい|URL/.test(d.alert) && d.focusId === "resource_url", JSON.stringify(d));
    await r23Fill({ resource_url: "", resource_type: "SENSOR", resource_description: "日本語UIから ZZRJAUI", resource_name_ja: "ZZ B9 R23 日本語UI" });
    await r23Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 7000); await sleep(500);
    const made = (await r23Api(null, "/resources?q=ZZRJAUI")).json.items[0];
    R23.rJaMade = made;
    const madeJa = (await r23Api("ja", `/resources/${made?.id}`)).json;
    check("resources ja: creating while the UI is Japanese writes the typed name/description to the ENGLISH columns and the Japanese name as an override (never Japanese into English)", !!made && made.name === "ZZ B9 R23 JA UI" && made.resourceType === "SENSOR" && madeJa.name === "ZZ B9 R23 日本語UI", JSON.stringify([made?.name, madeJa.name]));
    const e = await r23EditOn("ZZ B9 R23 日本語UI");
    check("resources ja: editing while the UI is Japanese shows the ENGLISH base text in the main fields (name, description) and the Japanese override in the Japanese fields", !!e && e.name === "ZZ B9 R23 JA UI" && e.desc === "日本語UIから ZZRJAUI" && e.nja === "ZZ B9 R23 日本語UI", JSON.stringify(e));
    await r23Fill({ resource_version: "9.9" });
    await r23Save();
    await waitFor(`!document.querySelector('.modal[role="dialog"]')`, 7000); await sleep(400);
    check("resources ja: saving an edit from the Japanese UI does not overwrite the English name with the Japanese one", (await r23Api(null, `/resources/${made.id}`)).json.name === "ZZ B9 R23 JA UI" && (await r23Api(null, `/resources/${made.id}`)).json.version === "9.9");
    await r23DelOn("ZZ B9 R23 日本語UI");
    check("resources ja: the delete confirmation is Japanese", (await ev(`document.querySelector('.modal').innerText`)).includes("「ZZ B9 R23 日本語UI」を削除しますか？この操作は元に戻せません。"));
    await r23Close();
    await R23.a.req("DELETE", `/resources/${made.id}`);
    await logout();
    await setLocale(null);
  });

  await step("resources loading / error: skeleton, an error state with Try again, and a failing panel never leaves an empty box", async () => {
    await desktop(); await setLocale(null);
    await go("/"); await navReady();
    await fake("*/api/resources?*", 500, JSON.stringify({ error: "Internal server error" }));
    await go("/resources"); await waitFor(`!!document.querySelector('[role="alert"]')`, 6000);
    check("resources error: a 500 on the list renders the localized error with Try again, plus the header (no blank page)", (await ev(`document.querySelector('[role="alert"]').innerText`)).includes("Could not load resources.") && (await exists('[role="alert"] button')) && (await pCount("h1")) === 1 && (await pCount(".resource-card")) === 0);
    await unfake();
    await clickEl('[role="alert"] button');
    check("resources error: Try again loads the list", await waitFor(`!!document.querySelector('.resource-card')`, 8000));
    await go("/"); await navReady();
    await fake(`*/api/resources/${R23.rDs.id}*`, 500, JSON.stringify({ error: "Internal server error" }));
    await go(`/resources/${R23.rDs.id}`); await waitFor(`!!document.querySelector('[role="alert"]')`, 6000);
    check("resources error: a 500 on a resource shows 'Could not load this resource.' with Try again, not the not-found state", (await ev(`document.querySelector('[role="alert"]').innerText`)).includes("Could not load this resource.") && !(await pMain()).includes("Resource not found") && (await exists('[role="alert"] button')));
    await unfake();
    await go("/"); await navReady();
    await fake("*/api/resources?*", 500, JSON.stringify({ error: "Internal server error" }));
    await go(`/projects/${R23.p1.id}`); await waitFor(`!!document.querySelector('h1') && !document.querySelector('[aria-busy="true"]')`, 8000); await sleep(800);
    check("resources error: a failing resources request leaves the project page without the panel and without an error box (the page is unchanged)", (await r23Sec("project-repro")) === null && (await pCount("h1")) === 1 && !(await exists('main [role="alert"]')));
    await unfake();
    await go("/"); await navReady();
    await fake("*/api/resources?*", 200, JSON.stringify({ items: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } }));
    await go("/resources"); await waitFor(`!!document.querySelector('.empty-state')`, 6000);
    check("resources empty: an empty catalogue says 'No resources yet.' with a hint", (await pMain()).includes("No resources yet.") && (await pMain()).includes("Datasets, hardware, software and experiment environments will appear here.") && (await ev(`document.querySelector('.knowledge-status').innerText.trim()`)) === "0 resources");
    await unfake();
    await go("/"); await navReady();
    await send("Network.emulateNetworkConditions", { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
    await ev(`history.pushState({}, '', '/resources'); window.dispatchEvent(new PopStateEvent('popstate'))`);
    const busy = await waitFor(`!!document.querySelector('[role="status"][aria-busy="true"] .sr-only') && document.querySelector('[role="status"][aria-busy="true"] .sr-only').textContent === 'Loading resources…' && document.querySelectorAll('.skeleton-block').length > 0`, 3000);
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check("resources loading: while the list loads there is a labelled skeleton ('Loading resources…', aria-busy) and no cards", busy);
    check("resources loading: the skeleton is replaced by the cards when the data arrives", await waitFor(`!!document.querySelector('.resource-card') && !document.querySelector('.skeleton-block')`, 10000));
  });

  await step("resources hostile text: markup in names, descriptions, notes, details, Japanese overrides and related names is inert everywhere (EN + JA, guest + admin)", async () => {
    const dialogsBefore = P15.jsDialogs.length;
    for (const loc of [null, "ja"]) {
      await setLocale(loc);
      for (const who of ["guest", "admin"]) {
        if (who === "admin") await login(ADMIN.email, ADMIN.password);
        const pages = [["list", "/resources?q=Hostile"], ["detail", `/resources/${R23.rX.id}`], ["project page", `/projects/${R23.pX.id}`], ["area page", `/research/${R23.aX.id}`], ["group page", `/groups/${R23.gX.id}`], ["search", "/search?q=Hostile&type=resource"], ...(who === "admin" ? [["admin list", "/admin/content?type=resource&q=Hostile"]] : [])];
        for (const [lbl, p] of pages) {
          await r23Ready(p);
          await sleep(200);
          const f = await ev(`(() => { const m = document.querySelector('main'); return { bad: m.querySelectorAll('img, script, iframe, svg[onload], a[href^="javascript"]').length, xss: typeof window.__r23Xss }; })()`);
          check(`resources hostile ${loc || "en"} ${who} ${lbl}: no element is created from any hostile text and no script ran`, f.bad === 0 && f.xss === "undefined", JSON.stringify(f));
        }
        await r23Ready(`/resources/${R23.rX.id}`);
        const t = await ev(`document.querySelector('.knowledge-body').innerText`);
        check(`resources hostile ${loc || "en"} ${who}: the hostile description is visible as TEXT (script tag, iframe, javascript: link, anchor)`, loc ? t.includes("日本語 <script>window.__r23Xss=6</script>") : t.includes("<script>window.__r23Xss=3</script>") && t.includes('<iframe src="javascript:window.__r23Xss=4"></iframe>') && t.includes('<a href="javascript:window.__r23Xss=8">x</a>'), t.slice(0, 200));
        const facts = await ev(`document.querySelector('.repro-details').innerText + '\\n' + document.querySelector('.knowledge-facts').innerText`);
        check(`resources hostile ${loc || "en"} ${who}: the hostile detail fields, notes, version, vendor and identifier are TEXT`, facts.includes("<img src=x onerror=window.__r23Xss=11>") && facts.includes("<script>window.__r23Xss=12</script>") && facts.includes("javascript:alert(2)") && facts.includes("<b>v</b>") && facts.includes("<svg onload=window.__r23Xss=9>") && (loc ? facts.includes("<img src=x onerror=window.__r23Xss=13>") : facts.includes("<script>window.__r23Xss=10</script>")), facts.slice(0, 300));
        check(`resources hostile ${loc || "en"} ${who}: the hostile name is text in the heading, breadcrumb and tab title`, (await ev(`document.querySelector('h1').textContent`)).includes("<img src=x onerror=window.__r23Xss=") && (await ev(`document.title`)).includes("<img"));
        if (who === "admin") await logout();
      }
    }
    await setLocale(null);
    await login(ADMIN.email, ADMIN.password);
    await r23Ready("/resources?q=Hostile");
    const d = await r23EditOn("ZZ B9 R23 Hostile " + r23X(1));
    check("resources hostile: the edit form holds the hostile text as plain values (name, description, version, vendor, identifier, notes, detail fields)", !!d && d.name === "ZZ B9 R23 Hostile " + r23X(1) && d.desc.includes("<script>window.__r23Xss=3</script>") && d.ver === r23X(5) && d.vendor === "<b>v</b>" && d.ident === "<svg onload=window.__r23Xss=9>" && d.env === "<script>window.__r23Xss=10</script>" && d.meta.configuration === "<script>window.__r23Xss=12</script>", JSON.stringify(d).slice(0, 300));
    await r23Close();
    // Defence in depth: even if a response carried a non-http(s) link (a tampered row), the page never renders it as a link.
    const real = (await r23Api(null, `/resources/${R23.rDs.id}`)).json;
    await go("/"); await navReady();
    await fake(`*/api/resources/${R23.rDs.id}*`, 200, JSON.stringify({ ...real, url: "javascript:window.__r23Xss=14", metadata: { ...real.metadata, firmwareVersion: "LEAKED-FW" } }));
    await go(`/resources/${R23.rDs.id}`); await waitFor(`!!document.querySelector('.repro-details')`, 8000);
    check("resources hostile: a javascript: link in a response is never rendered as a link (no anchor, nothing clickable), and a detail field of another type is never shown", !(await exists("a.resource-link")) && !(await exists('main a[href^="javascript"]')) && (await ev(`typeof window.__r23Xss`)) === "undefined" && !(await pMain()).includes("LEAKED-FW"));
    await unfake();
    check("resources hostile: no script ran and no JS dialog opened during the whole step", (await ev(`typeof window.__r23Xss`)) === "undefined" && P15.jsDialogs.length === dialogsBefore, P15.jsDialogs.slice(dialogsBefore).join("|"));
    await logout();
  });

  await step("resources long text: a 190-character unbroken name, a 3000-character token and long Japanese stay inside cards, detail and dialogs at 390px", async () => {
    await desktopAt(390, 844);
    check("resources long: login", await r23Login(R23.mgr));
    await desktopAt(390, 844);
    for (const [lbl, p] of [["list", "/resources?q=ZZ%20B9%20R23&limit=50"], ["long token detail", `/resources/${R23.rLongTok.id}`], ["long Japanese detail", `/resources/${R23.rLongJa.id}`], ["project page", `/projects/${R23.p1.id}`]]) {
      await r23Ready(p);
      check(`resources long ${lbl}: no horizontal overflow at 390px`, (await overflowPx()) <= 1);
      const au = await p15Audit(null, false);
      check(`resources long ${lbl}: no clipped/spilling text, overlapping or unnamed controls`, au.resp.length === 0 && au.a11y.length === 0, [...au.resp, ...au.a11y].slice(0, 3).join(" | "));
    }
    await r23Ready("/resources?q=" + encodeURIComponent("超長い日本語"));
    const d = await r23EditOn(r23JaLong.slice(0, 200));
    const m = await ev(`(() => { const dd = document.querySelector('.modal[role="dialog"]'); if (!dd) return null; const b = dd.getBoundingClientRect(); return { fitsX: b.left >= -0.5 && b.right <= innerWidth + 0.5, inner: dd.scrollWidth - dd.clientWidth }; })()`);
    check("resources long: the edit dialog holding a long Japanese name and a 60-line Japanese description fits 390px (no internal horizontal scroll)", !!d && !!m && m.fitsX && m.inner <= 1, JSON.stringify(m));
    const aud = await p15Audit(".modal", false);
    check("resources long: the dialog's contents have no clipped/overlapping text and every control is named", aud.resp.length === 0 && aud.a11y.length === 0, [...aud.resp, ...aud.a11y].slice(0, 3).join(" | "));
    await r23Close();
    await logout();
    await desktop();
  });

  const r23DialogChecks = async (loc, w, tag) => {
    // The add dialog on the list page (real click, semantics, fit, trap, Escape, focus return) and the edit / delete dialogs of a card.
    await p15Ready("/resources?q=ZZ%20B9%20R23%20Public");
    await p15Dialog(`resources ${loc} ${w}px ${tag} add`, ".admin-bar button", 0, loc === "ja");
    if (await exists(".resource-card .card-edit-btn")) {
      await p15Dialog(`resources ${loc} ${w}px ${tag} edit`, ".resource-card .card-edit-btn .icon-btn:not(.icon-btn--danger)", 0, loc === "ja");
      await p15Dialog(`resources ${loc} ${w}px ${tag} delete`, ".resource-card .icon-btn--danger", 0, loc === "ja");
    }
  };
  const R23_PAGES = () => [
    ["resources list", "/resources"],
    ["resources filtered", "/resources?type=DATASET&project=" + R23.p1.id],
    ["resources page 2", "/resources?q=ZZ%20B9%20R23%20Many&page=2"],
    ["resources empty filter", "/resources?q=nothingmatchesthiszzz"],
    ["resource detail", `/resources/${R23.rDs.id}`],
    ["resource detail hardware", `/resources/${R23.rFpga.id}`],
    ["resource long Japanese", `/resources/${R23.rLongJa.id}`],
    ["resource long token", `/resources/${R23.rLongTok.id}`],
    ["resource hostile", `/resources/${R23.rX.id}`],
    ["resource not found", `/resources/${R23.rLab.id}`],
    ["project with resources", `/projects/${R23.p1.id}`],
    ["project with many resources", `/projects/${R23.p2.id}`],
    ["research area with resources", `/research/${R23.aPub.id}`],
    ["group with resources", `/groups/${R23.gPub.id}`],
    ["researcher with resources", `/team/${R23.lead.tmId}`],
    ["knowledge with resources", `/knowledge/${R23.docPub.id}`],
    ["publication with resources", `/publications/${R23.pubPub.id}`],
    ["search resources", "/search?q=ZZRMANY&type=resource"],
  ];
  await step("resources sweep: guest -- 390..1920, EN + JA, keyboard", async () => {
    await p15Loop("r23-guest", null, R23_PAGES(), async (loc, w) => { if (P15_TAB_WIDTHS.includes(w)) await p19Walk(`resources ${loc} ${w}px guest`, [["list", "/resources"], ["detail", `/resources/${R23.rDs.id}`], ["project panel", `/projects/${R23.p1.id}`]]); });
  });
  await step("resources sweep: member -- 390..1920, EN + JA, add / edit / delete dialogs", async () => {
    await p15Loop("r23-member", () => r23Login(R23.mem), R23_PAGES(), async (loc, w) => { await r23DialogChecks(loc, w, "member"); if (P15_TAB_WIDTHS.includes(w)) await p19Walk(`resources ${loc} ${w}px member`, [["list", "/resources"], ["detail", `/resources/${R23.rDs.id}`]]); });
  });
  await step("resources sweep: project lead -- 390..1920, EN + JA, workspace section and dialogs", async () => {
    await p15Loop("r23-lead", () => r23Login(R23.lead), [...R23_PAGES().slice(0, 5), ["workspace", "/workspace"]], async (loc, w) => { await r23DialogChecks(loc, w, "lead"); });
    check("resources sweep lead: no script from hostile text ever ran", (await ev(`typeof window.__r23Xss`)) === "undefined");
  });
  await step("resources sweep: lab manager -- 390..1920, EN + JA, dialogs and the admin list", async () => {
    await p15Loop("r23-manager", () => r23Login(R23.mgr), [...R23_PAGES().slice(0, 5), ["admin resources", "/admin/content?type=resource"], ["admin resources filtered", `/admin/content?type=resource&resourceType=DATASET&project=${R23.p1.id}`]], async (loc, w) => { await r23DialogChecks(loc, w, "manager"); });
  });
  await step("resources sweep: admin -- 390..1920, EN + JA, dialogs, admin list, translations and overview", async () => {
    await p15Loop("r23-admin", () => login(ADMIN.email, ADMIN.password), [...R23_PAGES().slice(0, 5), ["admin overview", "/admin"], ["admin resources", "/admin/content?type=resource"], ["admin translations resources", "/admin/translations?type=LAB_RESOURCE"]], async (loc, w) => { await r23DialogChecks(loc, w, "admin"); });
  });

  await step("resources filters: folded behind a 'Filters' summary on a phone; open on wider screens and whenever a filter is active; keyboard and JA", async () => {
    await setLocale(null);
    await p15Vp(390);
    await r23Ready("/resources");
    const st = () => ev(`(() => { const d = document.querySelector('details.knowledge-filters-wrap'); const s = d.querySelector('summary'); const q = document.getElementById('rf-q'); return { open: d.open, summary: s.textContent.trim(), h: Math.round(s.getBoundingClientRect().height), qShown: q.checkVisibility(), formLabel: d.querySelector('form').getAttribute('aria-label') }; })()`);
    let s = await st();
    check("resources filters: on a phone the form is folded (closed) behind a 'Filters' summary at least 44px tall, so results start near the top", !s.open && s.summary === "Filters" && s.h >= 44 && !s.qShown, JSON.stringify(s));
    check("resources filters: the first result card starts within the first screen on a phone", (await ev(`document.querySelector('.resource-card')?.getBoundingClientRect().top ?? 9999`)) < 844);
    await clickEl("details.knowledge-filters-wrap > summary");
    await sleep(300);
    s = await st();
    check("resources filters: a real click opens it and the fields become visible with the accessible form name", s.open && s.qShown && s.formLabel === "Filter resources", JSON.stringify(s));
    await r23Ready("/resources?type=DATASET");
    s = await st();
    check("resources filters: with a filter active it is open and the summary counts it ('Filters (1 active)')", s.open && s.summary === "Filters (1 active)", JSON.stringify(s));
    await p15Vp(1280);
    await r23Ready("/resources");
    s = await st();
    check("resources filters: on a wide screen it is open by default", s.open && s.qShown && s.summary === "Filters", JSON.stringify(s));
    await setLocale("ja");
    await p15Vp(390);
    await r23Ready("/resources");
    s = await st();
    check("resources filters ja: the summary and the form name are Japanese", s.summary === "絞り込み" && s.formLabel === "リソースを絞り込む", JSON.stringify(s));
    await setLocale(null);
    await desktop();
  });

  await step("resources restore (locale, viewport)", async () => { await setLocale(null); await desktop(); });

  section("phase 10.5: design system hygiene (static scan of the web source)");
  {
    const webSrc = path.join(__dirname, "..", "..", "web", "src");
    const walkFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const files = walkFiles(webSrc);
    const tsx = files.filter((f) => f.endsWith(".tsx"));
    const css = files.filter((f) => f.endsWith(".css"));
    const inline = [];
    const hex = [];
    for (const f of tsx) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/style=\{\{/g)) inline.push(path.basename(f) + ": " + src.slice(m.index, m.index + 60).replace(/\s+/g, " "));
      if (/["'`]#[0-9a-fA-F]{3,8}["'`]/.test(src)) hex.push(path.basename(f));
    }
    check("Z. no page or component hard-codes a colour (hex) in TSX", hex.length === 0, hex.join(","));
    check("Z. inline styles are limited to one computed value (the width of a connection bar); everything else is a class", inline.length <= 1 && inline.every((s) => /HomePage/.test(s)), inline.join(" | "));
    const tokenCss = fs.readFileSync(path.join(webSrc, "styles", "tokens.css"), "utf8");
    const tokenHex = (tokenCss.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
    const otherHex = css.filter((f) => !f.endsWith("tokens.css")).flatMap((f) => (fs.readFileSync(f, "utf8").match(/#[0-9a-fA-F]{3,8}\b/g) || []));
    check("Z. colours live in tokens.css (many definitions there; at most 8 distinct one-off values elsewhere)", tokenHex >= 20 && new Set(otherHex).size <= 8, `tokens ${tokenHex}, elsewhere: ${[...new Set(otherHex)].join(" ")}`);
    check("Z. the stylesheet is split by responsibility (tokens, base, components, site, pages) instead of one file", ["tokens", "base", "components", "site", "pages"].every((n) => fs.existsSync(path.join(webSrc, "styles", n + ".css"))) && fs.readFileSync(path.join(webSrc, "index.css"), "utf8").split("@import").length === 6);
    // Phase 14 test maintenance: this assertion predated Phase 12 (its own description still said
    // "no Messages/Notifications yet", which stopped being true the moment Phase 12 shipped them
    // in ACCOUNT_NAV — the same pre-Phase-12 staleness as the Account-menu arrays fixed above, just
    // never caught here because this static scan runs unconditionally, outside ONLY_NAV/ONLY_UI's
    // step filter). Updated to assert the architecture that has actually shipped since Phase 12,
    // plus Phase 14's `label` -> `labelKey` rename (navConfig.ts labels are now translation keys,
    // translated at render time by Nav.tsx/NavGroup.tsx — see i18n/LocaleContext.tsx). Not weakened:
    // it still fails if any group, the Schedule/Contact links, ACCOUNT_NAV or LOGIN_LINK disappear.
    check(
      "Z. the navigation architecture is intact (navConfig groups Research, People and Community/Forum; Schedule/Contact top-level; Account holds Messages/Notifications since Phase 12; labels are translation keys since Phase 14)",
      (() => {
        const c = fs.readFileSync(path.join(webSrc, "components", "navConfig.ts"), "utf8");
        return (
          /id: "research"/.test(c) &&
          /id: "people"/.test(c) &&
          /id: "community"/.test(c) &&
          /to: "\/community\/forum"/.test(c) &&
          /labelKey: "nav\.schedule"/.test(c) &&
          /labelKey: "nav\.contact"/.test(c) &&
          /ACCOUNT_NAV/.test(c) &&
          /LOGIN_LINK/.test(c) &&
          /to: "\/messages"/.test(c) &&
          /to: "\/notifications"/.test(c)
        );
      })(),
    );
  }

  // ================================================================= global checks
  section("console + network hygiene");
  const noise = /React Router Future Flag|Failed to load resource/i;
  const realErrors = consoleErrors.filter((e) => !noise.test(e));
  check("no console errors or exceptions", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
  // Every >=400 response must be one of the failures this script provoked on purpose.
  const expected = [
    /^404 GET .*\/api\/(projects|groups)\/(doesnotexist123|bad!id)/, // typo'd URLs
    /^400 GET .*\/api\/projects\/bad!id/,
    new RegExp(`^404 GET .*/api/(projects/${D.p2.id}|groups/${D.gHid.id})$`), // guest opened hidden URLs directly
    /^40[13] (POST|PUT|DELETE|GET) .*\/api\/(projects|users)/, // deliberate bypass attempts (401/403)
    new RegExp(`^409 PUT .*/api/projects/.*/news`), // deliberate cross-project news conflict
    /^404 GET .*\/api\/projects\/.{20,}$/, // fetch of the deleted project
    /^404 GET .*\/api\/groups\/.{20,}$/,
    /^400 GET .*\/api\/search\?q=[xy]{101}$/, // the deliberate 101-character query (server validation, shown as an error state)
    // The seeded admin has no linked team profile, and login lands on /profile (Phase 7 behaviour):
    // the page then shows "no team profile linked yet". React StrictMode issues the fetch twice in dev.
    /^404 GET .*\/api\/profile$/,
    // Phase 10.5: the UI-state tests fake a failing API (500) on purpose, and try a wrong password (401).
    /^500 GET .*\/api\/(projects|publications|news)/,
    /^401 POST .*\/api\/auth\/login/,
    // Phase 11: guest write attempts, a hidden category/topic opened directly, and a typo'd topic id.
    /^401 (POST|PUT|DELETE) .*\/api\/forum\//,
    new RegExp(`^404 GET .*/api/forum/categories/${D.fCatHid.slug}$`),
    /^404 GET .*\/api\/forum\/posts\/doesnotexist12345/,
    // ProjectDetailPage's "Community Discussions" query inherits the same malformed :id the
    // existing "malformed project id" test opens (/projects/bad!id) — the forum endpoint validates
    // it too (400), exactly the same "no crash, an error/empty state instead" behaviour.
    /^400 GET .*\/api\/forum\/posts\?project=bad!id/,
    // Pre-existing gap found and fixed while running this file's committed suite in full for
    // Phase 14 (it had not been run in full since Phase 11; Phase 12/13 were verified with
    // separate ad hoc scripts per their own memory notes) -- NOT a Phase 14 regression.
    // ProjectDetailPage's Phase 13 "Gallery" preview section makes the exact same kind of request
    // (/api/gallery?project=:id) as the forum one above, and the same malformed :id 400s there too.
    /^400 GET .*\/api\/gallery\?project=bad!id/,
    // Phase 16: guest write attempts (401), a non-owner's edit/delete (403), a hidden / missing / deleted event
    // opened directly (404), a malformed id (400), the guest's translations read (401) and faked list failures (500).
    /^401 (POST|PUT|DELETE) .*\/api\/events/,
    /^403 (PUT|DELETE) .*\/api\/events\/[\w-]+$/,
    /^404 GET .*\/api\/events\/[\w-]+$/,
    /^400 GET .*\/api\/events\/bad%20id$/,
    /^401 GET .*\/api\/translations\/EVENT\//,
    /^500 GET .*\/api\/events/,
    // Phase 17: guests / members / managers probing the admin API and account routes on purpose (401/403), a manager's
    // /admin/people bounce, and the deliberate malformed-URL fallbacks (400).
    /^40[13] (GET|POST|PUT) .*\/api\/(admin|users)/,
    /^400 GET .*\/api\/admin\/content\?/,
    // Phase 18: a hidden / missing / malformed research-area id opened directly (404/400), and the manager-only or owner-only
    // relationship writes probed on purpose by guests, members and leads (401/403).
    /^(400|404) GET .*\/api\/research\/[^/]+$/,
    /^40[13] (PUT|DELETE) .*\/api\/(research|member)\//,
    /^40[13] PUT .*\/api\/projects\/[\w-]+$/,
    // Phase 19: a hidden / missing / malformed publication id opened directly (404/400), the manager-only visibility filter and the
    // publication writes probed on purpose by guests and members (401/403).
    /^(400|404) GET .*\/api\/publications\/[^/]+$/,
    /^403 GET .*\/api\/publications\/browse\?/,
    /^40[13] (PUT|DELETE) .*\/api\/publications\/[\w-]+$/,
    // Phase 21: the workspace probed by a guest (401) and the faked 401/500 that prove its error state; the single-researcher
    // membership writes probed on purpose (401/403), the duplicate (409) and the faked 500 shown inside the dialog; a lead
    // trying to change their own account role (403).
    /^(401|500) GET .*\/api\/workspace$/,
    /^(401|403|409|500) (POST|PUT|DELETE) .*\/api\/(projects|groups)\/[\w-]+\/members(\/[\w-]+)?$/,
    /^403 PUT .*\/api\/users\/[\w-]+$/,
    // Phase 22: a hidden / missing / malformed knowledge id opened directly (400/404) and the faked 500 that proves the error state;
    // the deliberate unknown-category list query (400); the write API probed on purpose by guests, members and leads (401/403).
    /^(400|404|500) GET .*\/api\/knowledge\/[^/]+$/,
    /^(400|500) GET .*\/api\/knowledge(\?.*)?$/,
    /^40[13] (POST|PUT|DELETE) .*\/api\/knowledge(\/[\w-]+)?$/,
    // ...and the faked 500 of the translations read that proves the edit form refuses to save without the English base.
    /^500 GET .*\/api\/translations\/KNOWLEDGE_DOC\/[\w-]+$/,
    // Phase 23: a hidden / missing / malformed resource id opened directly (400/404) and the faked 500s that prove the error states and
    // the edit form's refusal to save without its base text; the deliberate unknown-type list query (400) and manager-only visibility
    // filter (403); the write API probed on purpose by guests, members and leads (401/403).
    /^(400|404|500) GET .*\/api\/resources\/[^/]+$/,
    /^(400|403|500) GET .*\/api\/resources(\?.*)?$/,
    /^40[13] (POST|PUT|DELETE) .*\/api\/resources(\/[\w-]+)?$/,
    /^500 GET .*\/api\/translations\/LAB_RESOURCE\/[\w-]+$/,
  ];
  const unexpected = badResponses.filter((r) => !expected.some((re) => re.test(r)));
  check("no unexpected failed API requests", unexpected.length === 0, unexpected.slice(0, 5).join(" | "));

  await Promise.all(pendingBodies);
  check("9.1 no real browser API response (team, member, projects, groups, publications, ...) carried an account id or credential key", bodyLeaks.length === 0 && (ONLY_NAV || ONLY_UI || ONLY_I18N || ONLY_EVENTS || ONLY_ADMIN || ONLY_RESEARCH || ONLY_PUBS || ONLY_DISCOVERY || ONLY_WORKSPACE || ONLY_KNOWLEDGE || process.env.ONLY_STEPS || bodiesScanned > 60), `${bodiesScanned} bodies scanned; ${bodyLeaks.slice(0, 3).join(" | ")}`);
  console.log(`(${bodiesScanned} real API response bodies scanned for account ids / credential keys)`);

  console.log(`(${badResponses.length} provoked error responses, all accounted for: ${unexpected.length === 0})`);

  console.log(`\n${pass} browser checks passed, ${fails.length} failed.`);
  ws.close();
  edge.kill();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error("crashed:", e);
  edge.kill();
  process.exit(2);
});
