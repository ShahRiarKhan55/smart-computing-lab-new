/**
 * End-to-end API regression for Phase 14 domain-content localization: the `Translation` table,
 * locale resolution (`X-Locale` header), and `GET /api/translations/:entityType/:entityId`.
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:/abs/path/to/copy.db PORT=4011 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:/abs/path/to/copy.db API=http://localhost:4011 node scripts/i18n-regression.mjs
 *
 * Fixtures are prefixed "ZZ I18N" / p14test-*@example.test and are removed again (also at the
 * start, in case an earlier run was interrupted). It never touches rows it did not create.
 *
 * Scope: proves the fallback policy (ja override -> English column, never blank), that English
 * output is completely unaffected whether or not any override exists, that locale is transport
 * only (never a visibility bypass), that clearing an override actually clears it, that a hostile
 * override round-trips as inert text, and that the reusable /api/translations read endpoint is
 * gated the same way its entity's own edit already is (any logged-in account may read; write only
 * through the entity's own PUT).
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
  async req(method, path, body, extraHeaders = {}) {
    const res = await fetch(`${API}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      if (/^scl\.sid=;?$/.test(pair) || /Expires=Thu, 01 Jan 1970/i.test(c)) this.cookie = "";
      else if (pair.startsWith("scl.sid=")) this.cookie = pair;
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  }
  get = (p, h) => this.req("GET", p, undefined, h);
  post = (p, b, h) => this.req("POST", p, b ?? {}, h);
  put = (p, b, h) => this.req("PUT", p, b ?? {}, h);
  del = (p, h) => this.req("DELETE", p, undefined, h);
  login = (email, password) => this.post("/auth/login", { email, password });
}
const ja = { "X-Locale": "ja" };
const en = { "X-Locale": "en" };

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: "p14test-" } } }).catch(() => {});
  await prisma.researchArea.deleteMany({ where: { title: { startsWith: "ZZ I18N" } } });
  await prisma.newsItem.deleteMany({ where: { title: { startsWith: "ZZ I18N" } } });
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: "ZZ I18N" } } });
}

async function main() {
  await cleanup();
  const guest = new Client();
  const admin = new Client();
  check("admin login", (await admin.login(ADMIN.email, ADMIN.password)).status === 200);

  const mkUser = async (key, role, name) => {
    const r = await admin.post("/users", { email: `p14test-${key}@example.test`, password: PW, role, name, initials: "ZI", memberRole: "Researcher", category: "MSC" });
    const client = new Client();
    await client.login(`p14test-${key}@example.test`, PW);
    return { id: r.json?.id, client };
  };
  const member = await mkUser("member", "MEMBER", "ZZ I18N Member");

  // ------------------------------------------------------------------ research area: full round trip
  section("RESEARCH_AREA: fallback, override, clear, English never touched");
  const area = (await admin.post("/research", { title: "ZZ I18N Area", description: "English description.", tag: "ZI", visibility: "PUBLIC" })).json;
  check("fixture created", !!area?.id);

  const noHeader = await guest.get(`/research/${area.id}`);
  check("no X-Locale header -> English (default locale), unchanged", noHeader.json.title === "ZZ I18N Area" && noHeader.json.description === "English description.");

  const jaNoOverride = await guest.get(`/research/${area.id}`, ja);
  check("X-Locale: ja with no override yet -> falls back to English (never blank/undefined)", jaNoOverride.json.title === "ZZ I18N Area" && jaNoOverride.json.description === "English description.");

  const listJa = await guest.get("/research", ja);
  check("list endpoint also honours X-Locale before any override exists", listJa.json.find((r) => r.id === area.id)?.title === "ZZ I18N Area");

  const setOverride = await admin.put(`/research/${area.id}`, { translations: { ja: { title: "ゾンビ研究エリア", description: "日本語の説明。" } } });
  check("PUT translations.ja -> 200", setOverride.status === 200);

  const afterJa = await guest.get(`/research/${area.id}`, ja);
  check("X-Locale: ja now returns the Japanese override", afterJa.json.title === "ゾンビ研究エリア" && afterJa.json.description === "日本語の説明。");

  const afterEn = await guest.get(`/research/${area.id}`, en);
  const afterDefault = await guest.get(`/research/${area.id}`);
  check("X-Locale: en (and no header) still returns the ORIGINAL English text, byte-identical", afterEn.json.title === "ZZ I18N Area" && afterDefault.json.title === "ZZ I18N Area" && afterEn.json.description === "English description.");

  const listJa2 = await guest.get("/research", ja);
  check("list endpoint reflects the override too (batched, not per-row)", listJa2.json.find((r) => r.id === area.id)?.title === "ゾンビ研究エリア");

  const clear = await admin.put(`/research/${area.id}`, { translations: { ja: { title: "", description: null } } });
  check("clearing an override (empty string / null) -> 200", clear.status === 200);
  const afterClear = await guest.get(`/research/${area.id}`, ja);
  check("cleared override falls back to English again (not blank)", afterClear.json.title === "ZZ I18N Area" && afterClear.json.description === "English description.");

  // ------------------------------------------------------------------ /api/translations (reusable read endpoint)
  section("GET /api/translations/:entityType/:entityId");
  await admin.put(`/research/${area.id}`, { translations: { ja: { title: "ゾンビ研究エリア" } } });
  const readAsAdmin = await admin.get(`/translations/RESEARCH_AREA/${area.id}`);
  check("editor can read the current ja values", readAsAdmin.status === 200 && readAsAdmin.json.ja.title === "ゾンビ研究エリア" && readAsAdmin.json.ja.description === null, JSON.stringify(readAsAdmin.json));

  const readAsGuest = await guest.get(`/translations/RESEARCH_AREA/${area.id}`);
  check("a guest is refused (401) -- writing/reading drafts requires an account, same as editing the entity", readAsGuest.status === 401);

  const readAsMember = await member.client.get(`/translations/RESEARCH_AREA/${area.id}`);
  check("any other logged-in member may still read it (it is public content once published, not a privileged draft)", readAsMember.status === 200 && readAsMember.json.ja.title === "ゾンビ研究エリア");

  const badType = await admin.get("/translations/USER/whatever");
  check("a non-translatable entityType (e.g. USER, an allow-list miss) -> 404, never a raw DB lookup", badType.status === 404);
  const badType2 = await admin.get("/translations/FORUM_CATEGORY/whatever");
  check("FORUM_CATEGORY (a real AuditEntityType, but not in the Phase 14 translation allow-list) -> 404", badType2.status === 404);

  const missingEntity = await admin.get("/translations/RESEARCH_AREA/does-not-exist-id");
  check("an entity id that does not exist -> 200 with every field null (no crash, no leak)", missingEntity.status === 200 && missingEntity.json.ja.title === null);

  const badId = await admin.get("/translations/RESEARCH_AREA/bad%20id%3B%20drop");
  check("a malformed id (spaces/punctuation, fails ID_PATTERN) is rejected with 400, never reaches the query", badId.status === 400, JSON.stringify(badId));

  // ------------------------------------------------------------------ permissions unchanged
  section("permissions are exactly what they were before Phase 14 (translations ride the same PUT)");
  const guestWrite = await guest.put(`/research/${area.id}`, { translations: { ja: { title: "should not apply" } } });
  check("an unauthenticated PUT (even translations-only) is refused (401)", guestWrite.status === 401);
  const afterGuestAttempt = await admin.get(`/translations/RESEARCH_AREA/${area.id}`);
  check("...and nothing changed", afterGuestAttempt.json.ja.title === "ゾンビ研究エリア");

  // A plain member must OMIT visibility entirely (setting it, even to PUBLIC, is manager-only) --
  // omitted defaults to PUBLIC anyway, per createResearchAreaSchema's own documented default.
  const memberCreate = await member.client.post("/research", { title: "ZZ I18N Member Area", description: "d", tag: "ZI" });
  const memberOwnArea = memberCreate.json;
  check("member can create a research area (unchanged pre-Phase-14 permission)", memberCreate.status === 201, JSON.stringify(memberCreate));
  const memberSetsOwn = await member.client.put(`/research/${memberOwnArea?.id}`, { translations: { ja: { title: "メンバーのエリア" } } });
  check(
    "a plain MEMBER may set a translation exactly where they may already edit the base fields (research areas: any logged-in user, unchanged from before Phase 14)",
    memberSetsOwn.status === 200,
    JSON.stringify(memberSetsOwn),
  );

  // ------------------------------------------------------------------ hidden content stays hidden, in every locale
  section("visibility is untouched by locale: a hidden area is hidden with or without X-Locale: ja");
  const hidden = (await admin.post("/research", { title: "ZZ I18N Hidden Area", description: "secret", tag: "ZI", visibility: "LAB_ONLY" })).json;
  await admin.put(`/research/${hidden.id}`, { translations: { ja: { title: "秘密のエリア" } } });
  const guestPlain = await guest.get(`/research/${hidden.id}`);
  const guestJaAttempt = await guest.get(`/research/${hidden.id}`, ja);
  check("guest, no locale header -> 404 (as before Phase 14)", guestPlain.status === 404);
  check("guest, X-Locale: ja -> STILL 404 -- the locale header cannot be used to bypass visibility", guestJaAttempt.status === 404);
  const guestList = await guest.get("/research", ja);
  check("the hidden area's Japanese title never appears in the guest's list either", !guestList.json.some((r) => r.title === "秘密のエリア" || r.title === "ZZ I18N Hidden Area"));
  const memberJa = await member.client.get(`/research/${hidden.id}`, ja);
  check("a logged-in member CAN see it (LAB_ONLY = any account), with the Japanese override applied", memberJa.status === 200 && memberJa.json.title === "秘密のエリア");

  // ------------------------------------------------------------------ XSS: a hostile override is inert data
  section("XSS: a hostile translation value round-trips as literal text, never executable markup");
  const hostile1 = "<script>alert(1)</script>";
  const hostile2 = "<img src=x onerror=alert(1)>";
  await admin.put(`/research/${area.id}`, { translations: { ja: { title: hostile1, description: hostile2 } } });
  const hostileRead = await guest.get(`/research/${area.id}`, ja);
  check("the raw JSON carries the hostile string byte-for-byte, as DATA (React only ever renders text nodes for it, never dangerouslySetInnerHTML)", hostileRead.json.title === hostile1 && hostileRead.json.description === hostile2);
  const hostileViaTranslationsEndpoint = await admin.get(`/translations/RESEARCH_AREA/${area.id}`);
  check("...and the same is true reading it back through /api/translations", hostileViaTranslationsEndpoint.json.ja.title === hostile1);

  // ------------------------------------------------------------------ a second entity type, end to end: NEWS_ITEM
  section("NEWS_ITEM: the same fallback/override/clear pattern, proving it isn't research-area-specific");
  const news = (await admin.post("/news", { title: "ZZ I18N News", description: "English body.", type: "Event", date: "Jan 2031", sortDate: "2031-01-01", visibility: "PUBLIC" })).json;
  check("news fixture created", !!news?.id);
  check("English default is exactly the entered text", (await guest.get(`/news/${news.id}`)).json.title === "ZZ I18N News");
  await admin.put(`/news/${news.id}`, { translations: { ja: { title: "ニュース見出し", description: "日本語本文。" } } });
  const newsJa = await guest.get(`/news/${news.id}`, ja);
  check("ja override applies to a NEWS_ITEM the same way", newsJa.json.title === "ニュース見出し" && newsJa.json.description === "日本語本文。");
  check("English is still untouched", (await guest.get(`/news/${news.id}`)).json.title === "ZZ I18N News");

  // ------------------------------------------------------------------ a third entity type: TEAM_MEMBER (bio only)
  section("TEAM_MEMBER: only `bio` is translatable -- name/role/category etc. are never overridden");
  const tm = (await admin.post("/team", { name: "ZZ I18N Person", initials: "ZP", role: "Researcher", category: "MSC", bio: "English bio." })).json;
  await admin.put(`/team/${tm.id}`, { translations: { ja: { bio: "日本語の自己紹介。" } } });
  const tmJa = await guest.get(`/team/${tm.id}`, ja);
  check("bio is localized...", tmJa.json.bio === "日本語の自己紹介。");
  check("...but the person's name is never translated (not in the allow-list)", tmJa.json.name === "ZZ I18N Person");

  // ------------------------------------------------------------------ deletion cleans up Translation rows (pre-existing guarantee, still true)
  section("deleting an entity deletes its Translation rows (pre-existing Phase 8 guarantee)");
  const beforeDelete = await prisma.translation.count({ where: { entityType: "RESEARCH_AREA", entityId: area.id } });
  check("a Translation row exists for the area before delete", beforeDelete > 0);
  await admin.del(`/research/${area.id}`);
  const afterDelete = await prisma.translation.count({ where: { entityType: "RESEARCH_AREA", entityId: area.id } });
  check("...and none remain after it (schema.prisma's documented invariant)", afterDelete === 0);

  await cleanup();
  console.log(`\n${passed} i18n checks passed, ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
