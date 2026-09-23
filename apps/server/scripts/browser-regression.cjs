// Headless-Edge (CDP) browser regression for Phases 9, 9.1, 10 (global search), 10.1 (navigation & header), 10.5 (UI/UX modernization), 11 (forum/community) and 14 (localization).
//   Usage: node scripts/browser-regression.cjs <webBase> <apiBase> <shotDir>
//   ONLY_NAV=1 runs just the Phase 10.1 header/navigation section (steps named "nav ..."), about a minute.
//   ONLY_UI=1 runs just the Phase 10.5 UI/UX section (steps named "ui ...").
//   ONLY_FORUM=1 runs just the Phase 11 forum section (steps named "forum ...").
//   ONLY_I18N=1 runs just the Phase 14 localization section (steps named "i18n ...").
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
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
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
  return { userIds, unlinkedSeed, mgr, mem, lead, plain, areaPub, areaHid, pubPub, pubHid, newsPub, newsHid, gPub, gHid, p1, p2, p3, p4, jpArea, jpHid, markup, fCatPub, fCatHid, fTopic, fXss };
}

// ---------------------------------------------------------------- CDP plumbing
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-p91-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });

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
        if (/\/api\/(auth|users)/.test(url)) return; // own session info / admin-only account list are allowed to carry ids
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
  const logout = async () => { await ev(`(() => { const b = [...document.querySelectorAll('.nav__panel button')].find((x) => /log out/i.test(x.textContent)); if (!b) return false; b.click(); return true; })()`); await waitFor(`!!document.querySelector('.nav__account > a[href="/login"]')`); };

  const step = async (name, fn) => {
    if ((ONLY_NAV && !name.startsWith("nav")) || (ONLY_UI && !name.startsWith("ui")) || (ONLY_FORUM && !name.startsWith("forum")) || (ONLY_I18N && !name.startsWith("i18n"))) return;
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
    await go("/admin"); await sleep(600);
    check("manager is bounced from /admin and has no Admin link", (await pathNow()) === "/" && !(await text()).includes("Admin") && !(await exists('.nav a[href="/admin"]')));
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
    await go("/admin");
    check("admin dashboard renders with the account list", await waitText("b9-manager@example.test"));
    check("role select offers Member / Lab manager / Admin", await ev(`[...document.querySelectorAll('select[aria-label^="Role for"]')].every(s => [...s.options].map(o => o.text).join() === 'Admin,Lab manager,Member')`));
    check("dashboard links to project + group management", (await text()).includes("Edit Projects") && (await text()).includes("Edit Groups"));
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
    await go("/admin");
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
    for (let i = 0; i < 8; i++) await key("Tab", "Tab", 9);
    check("keyboard: ...then the first result's link, with a visible focus ring on its card", await ev(`(() => { const a = document.activeElement; return a.classList.contains('search-result__link') && getComputedStyle(a.closest('.search-result')).outlineStyle === 'solid'; })()`));
    check("labels: the /search box has a real <label>, the chips are a labelled group", await ev(`!!document.querySelector('label[for="search-page-input"]') && document.querySelector('.search-filters').getAttribute('aria-label') === 'Filter results by type' && document.querySelector('.search-filters').getAttribute('role') === 'group'`));
    check("semantic headings + list: h1, each result is an <article> with an h3 inside an ordered list", await ev(`document.querySelectorAll('h1').length === 1 && document.querySelectorAll('ol.search-results > li > article.search-result h3 a[href]').length > 0`));

    // filters
    await go("/search?q=FPGA");
    await statusIs("FPGA");
    const chips = await ev(`[...document.querySelectorAll('.search-filters a')].map(a => a.innerText.replace(/\\s+/g, ' ').trim())`);
    check("chips: All + the seven types, each with a count", chips.length === 8 && chips[0].startsWith("All") && ["Research Areas", "Projects", "Groups", "Researchers", "Publications", "News", "Forum Topics"].every((l) => chips.some((c) => c.startsWith(l) && /\d+$/.test(c))), chips.join(" | "));
    const apiCounts = (await searchJson("q=FPGA")).counts;
    check("chip counts equal the API counts (nothing is invented client-side)", chips.every((c) => { const m = c.match(/^(.*?)\s+(\d+)$/); const map = { All: "all", "Research Areas": "research-area", Projects: "project", Groups: "group", Researchers: "researcher", Publications: "publication", News: "news", "Forum Topics": "forum-topic" }; return m && apiCounts[map[m[1]]] === Number(m[2]); }));
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
    check("cards: the link is the only interactive element (whole card is the target via ::after)", await ev(`(() => { const c = document.querySelector('.search-result--project'); return c.querySelectorAll('a,button').length === 1 && getComputedStyle(c.querySelector('a'), '::after').position === 'absolute'; })()`));
    await clickText("ZZ B9 Project Public", ".search-result__link");
    check("clicking a project result opens the project page", (await waitFor(`location.pathname === '/projects/${D.p1.id}'`)) && (await waitText("Long description of the public project.")));
    await go("/search?q=ZZ+B9");
    await statusIs("ZZ B9");
    const hrefs = await ev(`[...document.querySelectorAll('.search-result')].map(c => [c.className.match(/search-result--([a-z-]+)/)[1], c.querySelector('a').getAttribute('href')])`);
    const hrefOk = { project: /^\/projects\/[A-Za-z0-9_-]+$/, group: /^\/groups\/[A-Za-z0-9_-]+$/, researcher: /^\/team\/[A-Za-z0-9_-]+$/, publication: /^\/publications$/, news: /^\/news$/, "research-area": /^\/research$/ };
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
  const KEYS = { down: ["ArrowDown", "ArrowDown", 40], up: ["ArrowUp", "ArrowUp", 38], home: ["Home", "Home", 36], end: ["End", "End", 35], esc: ["Escape", "Escape", 27], enter: ["Enter", "Enter", 13, "\r"], space: [" ", "Space", 32, " "] };
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
  const MANAGER = { email: D.mgr.email, password: PW_NAV };
  const RESEARCH_HREFS = ["/research", "/projects", "/publications", "/news"];
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

    check("N5. clicking Research opens it: expanded, visible, four links in the documented order", (await clickEl(trig("research"))) && (await expanded("research")) === "true" && (await panelHidden("research")) === false && eqJson(await panelHrefs("research"), RESEARCH_HREFS));
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
    check("K9. End goes to the last link", (await focusDesc()) === "news");
    await press("down");
    check("K9b. ArrowDown on the last link stays there (no wrap trap)", (await focusDesc()) === "news");
    await press("home");
    check("K10. Home goes to the first link", (await focusDesc()) === "research areas");
    await press("up");
    check("K11. ArrowUp on the first link goes back to the trigger", (await focusDesc()) === "research");
    await press("esc");

    // Tab through the whole panel and off the end: the dropdown closes itself.
    await press("down");
    for (let i = 0; i < 4; i++) await tab(); // 3 more links to News, then off the group
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
  for (const [label, creds, isAdminRole] of [["MEMBER", MEMBER, false], ["LAB_MANAGER", MANAGER, false], ["ADMIN", ADMIN, true]]) {
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
      check(`${label}: the Account menu holds ${isAdminRole ? "My Profile, Messages, Notifications, Admin Dashboard, Log out" : "My Profile, Messages, Notifications, Log out (no Admin Dashboard)"}`, eqJson(acct, isAdminRole ? ["my profile", "messages", "notifications", "admin dashboard", "log out"] : ["my profile", "messages", "notifications", "log out"]), JSON.stringify(acct));
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
        check("ADMIN: Account > Admin Dashboard opens /admin and marks Account active", (await clickEl('#nav-panel-account a[href="/admin"]')) && (await waitFor(`location.pathname === '/admin'`)) && (await waitText("Admin Dashboard")) && (await ev(`document.querySelector('${trig("account")}').classList.contains('active')`)));
        check("ADMIN: /admin still loads after a refresh", (await (async () => { await send("Page.reload"); await sleep(700); return waitText("Admin Dashboard"); })()));
        check("ADMIN: the admin API is reachable (server-side allow), unlike for the lesser roles", (await apiCall("GET", "/users")) === 200);
      } else {
        await go("/admin");
        check(`${label}: typing /admin directly is bounced home (client gate) and the API refuses the call (server gate)`, (await waitFor(`location.pathname === '/'`)) && (await apiCall("GET", "/users")) === 403);
        check(`${label}: a lab manager/member still cannot reach account APIs by URL: PUT /users/x is 403`, [403, 404].includes(await apiCall("PUT", "/users/doesnotexist", { role: "ADMIN" })) && (await apiCall("PUT", "/users/doesnotexist", { role: "ADMIN" })) === 403);
        if (label === "LAB_MANAGER") {
          await go("/projects");
          check("LAB_MANAGER: keeps their content-management controls on the pages (they never lived in the header)", await waitText("+ New project"));
        }
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
  for (const [label, creds, isAdminRole] of [["MEMBER", MEMBER, false], ["ADMIN", ADMIN, true]]) {
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
      check(`M390 ${label}: Account holds ${isAdminRole ? "My Profile, Messages, Notifications, Admin Dashboard, Log out" : "My Profile, Messages, Notifications, Log out"}`, eqJson(acct, isAdminRole ? ["my profile", "messages", "notifications", "admin dashboard", "log out"] : ["my profile", "messages", "notifications", "log out"]), JSON.stringify(acct));
      check(`M390 ${label}: menu fits the screen (scrolls inside itself if it must), page has no horizontal overflow`, (await inViewport(".nav__links")) && (await overflowPx()) <= 1 && (await ev(`(() => { const b = document.querySelector('.nav__links').getBoundingClientRect(); return b.bottom <= innerHeight + 1; })()`)));
      await shot(`nav-mobile-390-${label.toLowerCase()}`);
      check(`M390 ${label}: Schedule from the phone menu opens the calendar page`, (await clickEl('.nav__links > li > a[href="/schedule"]')) && (await waitFor(`location.pathname === '/schedule'`)) && (await waitText("Lab Schedule")));
      await openPhoneMenu();
      await openMenu("account");
      if (isAdminRole) check("M390 ADMIN: Admin Dashboard from the phone menu opens /admin", (await clickEl('#nav-panel-account a[href="/admin"]')) && (await waitFor(`location.pathname === '/admin'`)) && (await waitText("Admin Dashboard")) && (await overflowPx()) <= 1);
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
    await fake("*/api/publications*", 200, "[]");
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
    check("P. a project page answers 'who works on it': the team panel lists the lead and members with their roles", pd.team.some((t) => t.includes("ZZ B9 Lead") && t.includes("Lead")) && pd.team.some((t) => t.includes("ZZ B9 Member")), JSON.stringify(pd.team));
    check("P. ...'which area': only the PUBLIC area is listed; the hidden one is not", pd.areas.some((a) => a.includes("ZZ B9 Area Public")) && !pd.areas.some((a) => a.includes("Hidden")), JSON.stringify(pd.areas));
    check("P. ...'what is it': status badge (a word, not just a colour), dates and group are shown", /active/i.test(pd.status) && pd.group === "ZZ B9 Group Public", JSON.stringify(pd));
    check("P. ...'what came out of it': publications and news follow the team and areas, each with a count", eqJson(pd.order.filter((h) => /Publications|News/.test(h)), ["Publications", "News"]));
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
    const apiYears = await ev(`fetch('/api/publications').then((r) => r.json()).then((a) => [...new Set(a.map((p) => p.year))])`);
    check("L. publications are grouped under year headings, newest year first, one heading per year that has papers", eqJson(pubs.years, apiYears.slice().sort((a, b) => b - a)) && pubs.years.length > 0, JSON.stringify({ pubs, apiYears }));
    check("L. every external link opens in a new tab, has rel=noopener, and says so to screen readers", pubs.ext);
    check("L. each entry shows title, authors and venue with year (dense academic list, not marketing cards)", await ev(`[...document.querySelectorAll('.pub-item')].every((i) => i.querySelector('.pub-item__title') && i.querySelector('.pub-item__authors') && /\\d{4}$/.test(i.querySelector('.pub-item__venue').textContent.trim()))`));
    await clickText("2031", ".chips .chip");
    check("L. a year chip filters the list and reports pressed state + the count", await waitFor(`document.querySelectorAll('h2.year-heading').length === 1 && document.querySelector('.chips .chip.active').getAttribute('aria-pressed') === 'true' && /Showing \\d+ of \\d+/.test(document.querySelector('.filters__count').innerText)`));

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
    check("F. contact: nothing invented — the same details as before the redesign (email, hours, location placeholders unchanged)", await ev(`(() => { const t = document.querySelector('dl.info-list').innerText; return t.includes('lab@university.edu') && t.includes('Monday – Friday, 09:00 – 17:00') && t.includes('[University Name]') && t.includes('www.university.edu'); })()`));
    check("F. contact: the form still says it is not connected (no fake success)", await (async () => { await ev(`document.getElementById('name').value=''`); await setVal("name", "T"); await setVal("email", "t@example.test"); await setVal("message", "hello"); await ev(`document.getElementById('name').form.requestSubmit()`); return waitText("isn't connected to an email service yet"); })());
    await readyPage("/", "Smart Computing Lab");
    check("B. one button system: every .btn on the home page is a primary / secondary / danger variant with the same radius", await ev(`(() => { const bs = [...document.querySelectorAll('#main .btn')]; const rs = new Set(bs.map((b) => getComputedStyle(b).borderRadius)); return bs.length > 3 && bs.every((b) => /btn--(primary|secondary|outline|ghost|danger|link)/.test(b.className)) && rs.size === 1; })()`));
  });

  // ---------------------------------------------------------------- admin, profile, schedule
  section("phase 10.5: admin dashboard, profile, schedule");
  await step("ui admin", async () => {
    await desktop();
    check("Ad. admin login", await login(ADMIN.email, ADMIN.password));
    await readyPage("/admin", "Admin Dashboard");
    await waitFor(`![...document.querySelectorAll('.stat-card__value')].some(e => e.textContent === '–') && document.querySelectorAll('.stat-card__value').length === 5`, 6000);
    const users = await ev(`fetch('/api/users').then((r) => r.json())`);
    const team = await ev(`fetch('/api/team').then((r) => r.json())`);
    const linked = new Set(users.map((u) => u.teamMemberId));
    const cards = await ev(`[...document.querySelectorAll('.stat-card')].map((c) => [c.querySelector('.stat-card__label').textContent.trim().toLowerCase(), c.querySelector('.stat-card__value').textContent.trim()])`);
    const expect = [["accounts", users.length], ["admins", users.filter((u) => u.role === "ADMIN").length], ["lab managers", users.filter((u) => u.role === "LAB_MANAGER").length], ["members", users.filter((u) => u.role === "MEMBER").length], ["profiles without login", team.filter((m) => !linked.has(m.id)).length]].map(([a, b]) => [a, String(b)]);
    check("Ad. the dashboard's summary cards are the real numbers (accounts, per-role counts, profiles without a login)", eqJson(cards, expect), JSON.stringify({ cards, expect }));
    check("Ad. quick links to the six content pages are still there, and the account list keeps its controls (role select per account, Delete)", await ev(`document.querySelectorAll('.tile-link').length === 6 && document.querySelectorAll('.account-row select[aria-label^="Role for"]').length > 3 && [...document.querySelectorAll('.account-row .btn--danger')].length > 3`));
    check("Ad. the dashboard adds NO new features: no audit viewer, no CMS, no file uploads", await ev(`!/audit log|upload|gallery|translation|CMS/i.test(document.querySelector('#main').innerText)`));
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
      check(`Sec. ${who}: /admin is ${who === "admin" ? "open" : "bounced home"}, and the API agrees (users list ${who === "admin" ? "200" : "403"})`, (who === "admin" ? (await pathNow()) === "/admin" : (await pathNow()) === "/") && (await apiCall("GET", "/users")) === (who === "admin" ? 200 : 403));
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

  // ---------------------------------------------------------------- source hygiene (static)
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
  ];
  const unexpected = badResponses.filter((r) => !expected.some((re) => re.test(r)));
  check("no unexpected failed API requests", unexpected.length === 0, unexpected.slice(0, 5).join(" | "));

  await Promise.all(pendingBodies);
  check("9.1 no real browser API response (team, member, projects, groups, publications, ...) carried an account id or credential key", bodyLeaks.length === 0 && (ONLY_NAV || ONLY_UI || ONLY_I18N || bodiesScanned > 60), `${bodiesScanned} bodies scanned; ${bodyLeaks.slice(0, 3).join(" | ")}`);
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
