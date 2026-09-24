/**
 * End-to-end API regression for EVENTS (Phase 16): /api/events/*, event search, event translations,
 * event audit rows, and locale-independence of every event authorization outcome.
 *
 *   # terminal 1 (a COPY of the database; the suite writes fixtures):
 *   DATABASE_URL=file:C:/abs/path/to/copy.db PORT=4051 tsx src/index.ts
 *   # terminal 2:
 *   DATABASE_URL=file:C:/abs/path/to/copy.db API=http://localhost:4051 node scripts/events-regression.mjs
 *
 * Run it ONLY against a COPY of the database: it removes every audit row written during the run.
 * Fixtures are prefixed "ZZ Event" / p16test-*@example.test and are removed again (also at the
 * start, in case a previous run was interrupted). It never touches a row it did not create.
 */
import { PrismaClient } from "@prisma/client";

const API = process.env.API || "http://localhost:4001";
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };
const PW = "Str0ngPassw0rd!";
const prisma = new PrismaClient();
const RUN_STARTED = new Date(Date.now() - 2000);

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
  async req(method, path, body, locale) {
    const res = await fetch(`${API}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}), ...(locale ? { "X-Locale": locale } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
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
    return { status: res.status, json, text, type: res.headers.get("content-type") ?? "" };
  }
  get = (p, l) => this.req("GET", p, undefined, l);
  post = (p, b, l) => this.req("POST", p, b ?? {}, l);
  put = (p, b, l) => this.req("PUT", p, b ?? {}, l);
  del = (p, l) => this.req("DELETE", p, undefined, l);
  login = (email, password) => this.post("/auth/login", { email, password });
}

const HOUR = 3600_000;
const iso = (hoursFromNow) => new Date(Date.now() + hoursFromNow * HOUR).toISOString();
const ids = (r) => (Array.isArray(r.json) ? r.json.map((e) => e.id) : []);
const enja = async (fn) => [await fn("en"), await fn("ja")];

async function cleanup() {
  const events = await prisma.event.findMany({ where: { title: { startsWith: "ZZ Event" } }, select: { id: true } });
  await prisma.translation.deleteMany({ where: { entityType: "EVENT", entityId: { in: events.map((e) => e.id) } } });
  await prisma.event.deleteMany({ where: { title: { startsWith: "ZZ Event" } } });
  await prisma.event.deleteMany({ where: { title: { contains: "<script>" } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "p16test-" } } }).catch(() => {});
  await prisma.teamMember.deleteMany({ where: { name: { startsWith: "ZZ Event" } } });
  await prisma.researchProject.deleteMany({ where: { title: { startsWith: "ZZ Event" } } });
}

async function main() {
  await cleanup();
  const before = { events: await prisma.event.count(), translations: await prisma.translation.count() };

  const admin = new Client();
  await admin.login(ADMIN.email, ADMIN.password);
  const adminMe = (await admin.get("/auth/me")).json.user;

  const mk = async (key, role, name) => {
    const email = `p16test-${key}@example.test`;
    const r = await admin.post("/users", { email, password: PW, role, name, initials: "ZE", memberRole: "Researcher", category: "RESEARCH" });
    const client = new Client();
    await client.login(email, PW);
    const tm = await prisma.teamMember.findFirst({ where: { name } });
    return { client, id: r.json?.id, email, tm, status: r.status };
  };

  // ------------------------------------------------------------------
  section("fixtures");
  const guest = new Client();
  const mgr = await mk("mgr", "LAB_MANAGER", "ZZ Event Manager");
  const memA = await mk("a", "MEMBER", "ZZ Event Alice");
  const memB = await mk("b", "MEMBER", "ZZ Event Bob");
  check("fixtures: three accounts created with profiles", [mgr, memA, memB].every((u) => u.status === 201 && u.tm));

  const projPub = await prisma.researchProject.create({ data: { slug: "zz-event-proj-pub", title: "ZZ Event Project Public", visibility: "PUBLIC" } });
  const projHid = await prisma.researchProject.create({ data: { slug: "zz-event-proj-hid", title: "ZZ Event Project Hidden", visibility: "LAB_ONLY" } });

  const mkEvent = (client, body) => client.post("/events", body);
  const pubUp = (await mkEvent(mgr.client, { title: "ZZ Event Public Upcoming", description: "Quantum ZZQ talk", location: "ZZ Room 101", kind: "SEMINAR", startsAt: iso(48), endsAt: iso(50), visibility: "PUBLIC" })).json;
  const hidUp = (await mkEvent(mgr.client, { title: "ZZ Event Hidden Upcoming", description: "Internal ZZH budget meeting", location: "ZZ Room 202", kind: "MEETING", startsAt: iso(72), visibility: "LAB_ONLY" })).json;
  const pubPast = (await mkEvent(mgr.client, { title: "ZZ Event Public Past", description: "Old ZZP workshop", kind: "OTHER", startsAt: iso(-48), endsAt: iso(-47), visibility: "PUBLIC" })).json;
  const hidPast = (await mkEvent(mgr.client, { title: "ZZ Event Hidden Past", kind: "SOCIAL", startsAt: iso(-100), visibility: "LAB_ONLY" })).json;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * HOUR).toISOString().slice(0, 10);
  const allToday = (await mkEvent(mgr.client, { title: "ZZ Event All Day Today", allDay: true, startsAt: `${today}T00:00:00.000Z`, visibility: "PUBLIC" })).json;
  const allYest = (await mkEvent(mgr.client, { title: "ZZ Event All Day Yesterday", allDay: true, startsAt: `${yesterday}T00:00:00.000Z`, visibility: "PUBLIC" })).json;
  const daysAgo = (n) => new Date(Date.now() - n * 24 * HOUR).toISOString().slice(0, 10);
  const allRangeOn = (await mkEvent(mgr.client, { title: "ZZ Event All Day Range Ending Today", allDay: true, startsAt: `${yesterday}T00:00:00.000Z`, endsAt: `${today}T00:00:00.000Z`, visibility: "PUBLIC" })).json;
  const allRangeOver = (await mkEvent(mgr.client, { title: "ZZ Event All Day Range Over", allDay: true, startsAt: `${daysAgo(3)}T00:00:00.000Z`, endsAt: `${yesterday}T00:00:00.000Z`, visibility: "PUBLIC" })).json;
  const aliceEv = (await mkEvent(memA.client, { title: "ZZ Event Alice Own", description: "by alice", startsAt: iso(24) })).json;
  check("fixtures: all events created", [pubUp, hidUp, pubPast, hidPast, allToday, allYest, allRangeOn, allRangeOver, aliceEv].every((e) => e?.id));

  // ------------------------------------------------------------------
  section("shape and content type");
  check("event JSON has the documented fields", ["id", "title", "description", "location", "url", "kind", "startsAt", "endsAt", "allDay", "project", "organizer", "canEdit", "canDelete"].every((k) => k in pubUp));
  check("responses are application/json", (await guest.get(`/events/${pubUp.id}`)).type.startsWith("application/json"));
  check("startsAt is an ISO UTC instant", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(pubUp.startsAt));
  check("endsAt is null when none was given", hidUp.endsAt === null);
  check("kind round-trips", pubUp.kind === "SEMINAR" && hidUp.kind === "MEETING");
  check("member-created event defaults to LAB_ONLY", (await mgr.client.get(`/events/${aliceEv.id}`)).json.visibility === "LAB_ONLY");
  check("member does not receive `visibility` on the event they created", !("visibility" in aliceEv));
  check("manager receives `visibility`", (await mgr.client.get(`/events/${pubUp.id}`)).json.visibility === "PUBLIC");
  check("guest never receives `visibility`", !("visibility" in (await guest.get(`/events/${pubUp.id}`)).json));
  check("organizer is the creator's public team profile", aliceEv.organizer?.name === "ZZ Event Alice" && aliceEv.organizer?.id === memA.tm.id);
  const wire = JSON.stringify([(await memB.client.get(`/events/${aliceEv.id}`)).json, (await guest.get("/events?scope=all")).json]);
  check("no account id or email on the wire", !wire.includes(memA.id) && !wire.includes(mgr.id) && !wire.includes(memA.email) && !wire.includes("@example.test"));

  // ------------------------------------------------------------------
  section("visibility (guest / member / manager)");
  const gUp = await guest.get("/events?scope=upcoming");
  const gPast = await guest.get("/events?scope=past");
  const gAll = await guest.get("/events?scope=all");
  check("guest upcoming list has the public events only", ids(gUp).includes(pubUp.id) && ids(gUp).includes(allToday.id) && !ids(gUp).includes(hidUp.id) && !ids(gUp).includes(aliceEv.id));
  check("guest past list has the public past events only", ids(gPast).includes(pubPast.id) && !ids(gPast).includes(hidPast.id));
  check("guest `all` never contains a LAB_ONLY event", ![hidUp, hidPast, aliceEv].some((e) => ids(gAll).includes(e.id)));
  check("guest detail of a hidden event is 404", (await guest.get(`/events/${hidUp.id}`)).status === 404);
  const missing = await guest.get("/events/nonexistentid123");
  const hidden = await guest.get(`/events/${hidUp.id}`);
  check("a hidden event is indistinguishable from a missing one", missing.status === hidden.status && missing.text === hidden.text);
  check("malformed id is 400", (await guest.get("/events/bad%20id")).status === 400);
  const mAll = await memB.client.get("/events?scope=all");
  check("member sees LAB_ONLY events too", [hidUp, hidPast, aliceEv, pubUp].every((e) => ids(mAll).includes(e.id)));
  check("member list carries no `visibility`", mAll.json.every((e) => !("visibility" in e)));
  const mgrAll = await mgr.client.get("/events?scope=all");
  check("manager list carries `visibility`", mgrAll.json.every((e) => e.visibility === "PUBLIC" || e.visibility === "LAB_ONLY"));

  // ------------------------------------------------------------------
  section("scope, ordering, pagination");
  const up = (await mgr.client.get("/events?scope=upcoming&limit=200")).json;
  const upMine = up.filter((e) => e.title.startsWith("ZZ Event"));
  check("upcoming is soonest-first", upMine.every((e, i) => i === 0 || upMine[i - 1].startsAt <= e.startsAt));
  check("upcoming contains an in-progress all-day event and excludes yesterday's", upMine.some((e) => e.id === allToday.id) && !upMine.some((e) => e.id === allYest.id));
  check("upcoming contains an all-day RANGE whose last day is today, and excludes one that ended yesterday", upMine.some((e) => e.id === allRangeOn.id) && !upMine.some((e) => e.id === allRangeOver.id));
  const pastMine = (await mgr.client.get("/events?scope=past&limit=200")).json.filter((e) => e.title.startsWith("ZZ Event"));
  check("past is newest-first", pastMine.every((e, i) => i === 0 || pastMine[i - 1].startsAt >= e.startsAt));
  check("past contains yesterday's all-day event", pastMine.some((e) => e.id === allYest.id));
  check("past contains an all-day range that ended yesterday, and not one ending today", pastMine.some((e) => e.id === allRangeOver.id) && !pastMine.some((e) => e.id === allRangeOn.id));
  check("upcoming and past are disjoint", (() => {
    const p = new Set(pastMine.map((e) => e.id));
    return upMine.every((e) => !p.has(e.id));
  })());
  const allMine = (await mgr.client.get("/events?scope=all&limit=200")).json.filter((e) => e.title.startsWith("ZZ Event"));
  check("upcoming + past == all for the fixtures", allMine.length === upMine.length + pastMine.length, `${allMine.length} vs ${upMine.length}+${pastMine.length}`);
  check("default scope is upcoming", JSON.stringify(ids(await mgr.client.get("/events"))) === JSON.stringify(ids(await mgr.client.get("/events?scope=upcoming"))));
  check("the order is repeatable", JSON.stringify(ids(await guest.get("/events?scope=all"))) === JSON.stringify(ids(await guest.get("/events?scope=all"))));
  const p1 = await mgr.client.get("/events?scope=all&limit=2&page=1");
  const p2 = await mgr.client.get("/events?scope=all&limit=2&page=2");
  check("pagination: page size respected and pages differ", p1.json.length === 2 && p2.json.length >= 1 && !ids(p2).some((i) => ids(p1).includes(i)));
  check("pagination: pages concatenate to the full ordered list", JSON.stringify([...ids(p1), ...ids(p2)]) === JSON.stringify(ids(mgrAll).slice(0, ids(p1).length + ids(p2).length)));
  check("limit=0 is 400", (await guest.get("/events?limit=0")).status === 400);
  check("limit=201 is 400", (await guest.get("/events?limit=201")).status === 400);
  check("limit=abc is 400", (await guest.get("/events?limit=abc")).status === 400);
  check("page=0 is 400", (await guest.get("/events?page=0")).status === 400);
  check("scope=bogus is 400", (await guest.get("/events?scope=bogus")).status === 400);
  check("a page past the end is an empty list", (await guest.get("/events?scope=all&page=9999")).json.length === 0);
  check("guest `limit` also applies after visibility filtering", (await guest.get("/events?scope=all&limit=1")).json.length === 1);

  // ------------------------------------------------------------------
  section("create: authentication, authorization, validation");
  check("guest cannot create (401)", (await guest.post("/events", { title: "ZZ Event nope", startsAt: iso(1) })).status === 401);
  check("member cannot set visibility on create (403)", (await memA.client.post("/events", { title: "ZZ Event nope", startsAt: iso(1), visibility: "PUBLIC" })).status === 403);
  check("member cannot link a project on create (403)", (await memA.client.post("/events", { title: "ZZ Event nope", startsAt: iso(1), projectId: projPub.id })).status === 403);
  const bad = async (body, name) => {
    const r = await memA.client.post("/events", body);
    check(`validation: ${name} -> 400 with a message`, r.status === 400 && typeof r.json?.error === "string" && r.json.error.length > 0, `${r.status} ${r.text}`);
    return r;
  };
  const okBody = { title: "ZZ Event valid", startsAt: iso(5) };
  await bad({ startsAt: iso(5) }, "missing title");
  await bad({ ...okBody, title: "   " }, "blank title");
  await bad({ ...okBody, title: "x".repeat(201) }, "title too long");
  await bad({ title: "ZZ Event no start" }, "missing start");
  await bad({ ...okBody, startsAt: "not a date" }, "garbage start");
  await bad({ ...okBody, startsAt: "2030-02-30T10:00:00Z" }, "impossible date");
  await bad({ ...okBody, startsAt: "2030-01-01" }, "date without time");
  await bad({ ...okBody, startsAt: "2030-13-01T10:00:00Z" }, "month 13");
  await bad({ ...okBody, startsAt: "2030-04-31T10:00:00Z" }, "April 31");
  await bad({ ...okBody, startsAt: "2030-01-01T24:00:00Z" }, "hour 24");
  await bad({ ...okBody, startsAt: "2030-01-01T10:60:00Z" }, "minute 60");
  await bad({ ...okBody, startsAt: "2030-01-01T10:00:00+25:00" }, "offset +25:00");
  check("a real leap day is accepted", (await memA.client.post("/events", { title: "ZZ Event Leap", startsAt: "2032-02-29T10:00:00Z" })).status === 201);
  check("Feb 29 in a non-leap year is rejected", (await memA.client.post("/events", { title: "ZZ Event NotLeap", startsAt: "2031-02-29T10:00:00Z" })).status === 400);
  await bad({ ...okBody, startsAt: "1900-01-01T00:00:00Z" }, "start before 1970");
  await bad({ ...okBody, startsAt: "2200-01-01T00:00:00Z" }, "start after 2099");
  await bad({ ...okBody, endsAt: "nope" }, "garbage end");
  await bad({ title: "ZZ Event backwards", startsAt: iso(10), endsAt: iso(9) }, "end before start");
  await bad({ ...okBody, kind: "PARTY" }, "unknown kind");
  await bad({ ...okBody, kind: "seminar" }, "lower-case kind");
  await bad({ ...okBody, url: "javascript:alert(1)" }, "javascript: url");
  await bad({ ...okBody, url: "data:text/html,<script>alert(1)</script>" }, "data: url");
  await bad({ ...okBody, url: "ftp://example.org/x" }, "ftp url");
  await bad({ ...okBody, url: "//example.org" }, "scheme-less url");
  await bad({ ...okBody, url: "https://exa mple.org" }, "url with a space");
  await bad({ ...okBody, location: "x".repeat(201) }, "location too long");
  await bad({ ...okBody, description: "x".repeat(5001) }, "description too long");
  await bad({ ...okBody, allDay: "yes" }, "non-boolean allDay");
  await bad({ ...okBody, title: 42 }, "non-string title");
  await bad({ ...okBody, translations: { ja: { title: "あ".repeat(201) } } }, "Japanese title too long");
  await bad({ ...okBody, translations: { ja: { description: "あ".repeat(5001) } } }, "Japanese description too long");
  check("validation: a body that is not an object is 400", (await memA.client.post("/events", "[1,2]")).status === 400);
  check("validation: no body is 400", (await memA.client.post("/events", undefined)).status === 400);
  const admin400 = await admin.post("/events", { ...okBody, visibility: "SECRET" });
  check("validation: unknown visibility is 400", admin400.status === 400);
  const proj404 = await admin.post("/events", { ...okBody, projectId: "doesnotexist1" });
  check("validation: an unknown project id is 400", proj404.status === 400);
  const boundary = await admin.post("/events", { title: "ZZ Event " + "x".repeat(191), location: "l".repeat(200), description: "d".repeat(5000), url: "https://example.org/" + "a".repeat(100), startsAt: iso(300), endsAt: iso(300) });
  check("validation: the length limits are inclusive, and end == start is allowed", boundary.status === 201, boundary.text);
  const defaults = (await memA.client.post("/events", { title: "ZZ Event Defaults", startsAt: iso(30) })).json;
  check("defaults: kind OTHER, no end, not all-day, empty strings", defaults.kind === "OTHER" && defaults.endsAt === null && defaults.allDay === false && defaults.description === "" && defaults.location === "" && defaults.url === "");
  const trimmed = (await memA.client.post("/events", { title: "  ZZ Event Trim  ", location: "  Lab  ", startsAt: iso(31) })).json;
  check("text is trimmed", trimmed.title === "ZZ Event Trim" && trimmed.location === "Lab");
  const withEnd = (await memA.client.post("/events", { title: "ZZ Event EmptyEnd", startsAt: iso(31), endsAt: "" })).json;
  check("an empty-string end means no end", withEnd.endsAt === null);
  const allDayNorm = (await admin.post("/events", { title: "ZZ Event AllDayNorm", allDay: true, startsAt: "2031-05-05T15:30:00.000Z", endsAt: "2031-05-07T22:00:00.000Z", visibility: "PUBLIC" })).json;
  check("all-day times are normalised to UTC midnight", allDayNorm.startsAt === "2031-05-05T00:00:00.000Z" && allDayNorm.endsAt === "2031-05-07T00:00:00.000Z");
  const offset = (await admin.post("/events", { title: "ZZ Event Offset", startsAt: "2031-05-05T09:00:00+09:00" })).json;
  check("an offset instant is stored as the same instant in UTC", offset.startsAt === "2031-05-05T00:00:00.000Z");

  // ------------------------------------------------------------------
  section("update: ownership and roles");
  check("guest cannot update (401)", (await guest.put(`/events/${pubUp.id}`, { title: "ZZ Event x" })).status === 401);
  check("member cannot update someone else's event (403)", (await memB.client.put(`/events/${aliceEv.id}`, { title: "ZZ Event hijack" })).status === 403);
  check("…and the event is unchanged", (await mgr.client.get(`/events/${aliceEv.id}`)).json.title === "ZZ Event Alice Own");
  check("member cannot update a manager's event (403)", (await memA.client.put(`/events/${pubUp.id}`, { title: "ZZ Event x" })).status === 403);
  const own = await memA.client.put(`/events/${aliceEv.id}`, { title: "ZZ Event Alice Edited", location: "Lab B" });
  check("member updates their own event", own.status === 200 && own.json.title === "ZZ Event Alice Edited" && own.json.location === "Lab B" && own.json.canEdit === true);
  check("member cannot change visibility of their own event (403)", (await memA.client.put(`/events/${aliceEv.id}`, { visibility: "PUBLIC" })).status === 403);
  check("member cannot link a project to their own event (403)", (await memA.client.put(`/events/${aliceEv.id}`, { projectId: projPub.id })).status === 403);
  check("member may send an unchanged (null) project link", (await memA.client.put(`/events/${aliceEv.id}`, { projectId: null, title: "ZZ Event Alice Edited" })).status === 200);
  check("nothing to update is 400", (await memA.client.put(`/events/${aliceEv.id}`, {})).status === 400);
  check("update of a missing event is 404", (await mgr.client.put("/events/doesnotexist1", { title: "ZZ Event x" })).status === 404);
  check("update with a malformed id is 400", (await mgr.client.put("/events/bad%20id", { title: "ZZ Event x" })).status === 400);
  check("manager updates any event", (await mgr.client.put(`/events/${aliceEv.id}`, { description: "manager edit" })).json?.description === "manager edit");
  const pub = await mgr.client.put(`/events/${aliceEv.id}`, { visibility: "PUBLIC" });
  check("manager publishes a member's event", pub.status === 200 && pub.json.visibility === "PUBLIC");
  check("…and a guest now sees it", (await guest.get(`/events/${aliceEv.id}`)).status === 200);
  check("…and the owner may still edit it", (await memA.client.put(`/events/${aliceEv.id}`, { location: "Lab C" })).status === 200);
  check("…while another member may not", (await memB.client.put(`/events/${aliceEv.id}`, { location: "Lab D" })).status === 403);
  check("admin updates any event", (await admin.put(`/events/${aliceEv.id}`, { visibility: "LAB_ONLY" })).json?.visibility === "LAB_ONLY");
  check("…and a guest no longer sees it", (await guest.get(`/events/${aliceEv.id}`)).status === 404);
  check("canEdit is false for a non-owner member", (await memB.client.get(`/events/${aliceEv.id}`)).json.canEdit === false);
  check("canEdit is false for a guest", (await guest.get(`/events/${pubUp.id}`)).json.canEdit === false);
  check("canEdit/canDelete are true for a manager", (await mgr.client.get(`/events/${aliceEv.id}`)).json.canEdit === true && (await mgr.client.get(`/events/${aliceEv.id}`)).json.canDelete === true);

  // time-range rules across partial updates
  const rng = (await admin.post("/events", { title: "ZZ Event Range", startsAt: "2032-01-10T10:00:00Z", endsAt: "2032-01-10T12:00:00Z", visibility: "PUBLIC" })).json;
  check("update: an end before the stored start is 400", (await admin.put(`/events/${rng.id}`, { endsAt: "2032-01-10T09:00:00Z" })).status === 400);
  check("update: a start after the stored end is 400", (await admin.put(`/events/${rng.id}`, { startsAt: "2032-01-10T13:00:00Z" })).status === 400);
  check("update: moving both together is fine", (await admin.put(`/events/${rng.id}`, { startsAt: "2032-01-11T10:00:00Z", endsAt: "2032-01-11T11:00:00Z" })).status === 200);
  check("update: endsAt null clears the end", (await admin.put(`/events/${rng.id}`, { endsAt: null })).json.endsAt === null);
  check("update: turning on all-day normalises the stored times", (await admin.put(`/events/${rng.id}`, { allDay: true })).json.startsAt === "2032-01-11T00:00:00.000Z");
  check("a failed range update leaves the row unchanged", (await admin.get(`/events/${rng.id}`)).json.startsAt === "2032-01-11T00:00:00.000Z");
  check("update: unknown kind is 400", (await admin.put(`/events/${rng.id}`, { kind: "PARTY" })).status === 400);

  // an event whose creator account is gone has no owner
  const orphan = (await memA.client.post("/events", { title: "ZZ Event Orphan", startsAt: iso(60) })).json;
  await prisma.event.update({ where: { id: orphan.id }, data: { createdById: null } });
  check("an ownerless event: member update is 403", (await memA.client.put(`/events/${orphan.id}`, { title: "ZZ Event Orphan 2" })).status === 403);
  check("an ownerless event: no organizer, canEdit false for a member", (await memA.client.get(`/events/${orphan.id}`)).json.organizer === null && (await memA.client.get(`/events/${orphan.id}`)).json.canEdit === false);
  check("an ownerless event: manager may update it", (await mgr.client.put(`/events/${orphan.id}`, { title: "ZZ Event Orphan 3" })).status === 200);
  check("an ownerless event: member delete is 403", (await memA.client.del(`/events/${orphan.id}`)).status === 403);

  // ------------------------------------------------------------------
  section("project relationship");
  const linked = await mgr.client.put(`/events/${pubUp.id}`, { projectId: projHid.id });
  check("manager links an event to a project", linked.status === 200 && linked.json.project?.id === projHid.id);
  check("a guest never sees a hidden project's title on a public event", (await guest.get(`/events/${pubUp.id}`)).json.project === null && !(await guest.get("/events?scope=all")).text.includes("ZZ Event Project Hidden"));
  check("a member sees the hidden project (LAB_ONLY is visible to members)", (await memB.client.get(`/events/${pubUp.id}`)).json.project?.title === "ZZ Event Project Hidden");
  check("a guest sees a public project link", (await mgr.client.put(`/events/${pubUp.id}`, { projectId: projPub.id })).json.project?.id === projPub.id && (await guest.get(`/events/${pubUp.id}`)).json.project?.id === projPub.id);
  check("unlinking (projectId null) works", (await mgr.client.put(`/events/${pubUp.id}`, { projectId: null })).json.project === null);
  await mgr.client.put(`/events/${pubUp.id}`, { projectId: projPub.id });
  await prisma.researchProject.update({ where: { id: projPub.id }, data: { visibility: "LAB_ONLY" } });
  check("hiding the project later hides it from guests on the event", (await guest.get(`/events/${pubUp.id}`)).json.project === null);
  check("the hidden project is not searchable through the event", (await guest.get("/search?q=" + encodeURIComponent("ZZ Event Project") + "&type=event")).json.results.length === 0);
  await prisma.researchProject.delete({ where: { id: projPub.id } });
  check("deleting the project clears the link (SET NULL) and keeps the event", (await mgr.client.get(`/events/${pubUp.id}`)).json.project === null);

  // ------------------------------------------------------------------
  section("delete");
  check("guest cannot delete (401)", (await guest.del(`/events/${pubUp.id}`)).status === 401);
  check("member cannot delete someone else's event (403)", (await memB.client.del(`/events/${pubUp.id}`)).status === 403);
  check("member cannot delete a manager's event (403)", (await memA.client.del(`/events/${hidUp.id}`)).status === 403);
  check("delete of a missing event is 404", (await mgr.client.del("/events/doesnotexist1")).status === 404);
  check("delete with a malformed id is 400", (await mgr.client.del("/events/bad%20id")).status === 400);
  const mine = (await memA.client.post("/events", { title: "ZZ Event To Delete", startsAt: iso(40) })).json;
  await memA.client.put(`/events/${mine.id}`, { translations: { ja: { title: "ZZイベント削除予定" } } });
  check("translation row exists before delete", (await prisma.translation.count({ where: { entityType: "EVENT", entityId: mine.id } })) === 1);
  check("owner deletes their own event", (await memA.client.del(`/events/${mine.id}`)).status === 200);
  check("…it is gone", (await mgr.client.get(`/events/${mine.id}`)).status === 404);
  check("…and its translations are removed", (await prisma.translation.count({ where: { entityType: "EVENT", entityId: mine.id } })) === 0);
  const mgrDel = (await admin.post("/events", { title: "ZZ Event Mgr Delete", startsAt: iso(41) })).json;
  check("manager deletes any event", (await mgr.client.del(`/events/${mgrDel.id}`)).status === 200);
  const adminDel = (await memB.client.post("/events", { title: "ZZ Event Admin Delete", startsAt: iso(41) })).json;
  check("admin deletes any event", (await admin.del(`/events/${adminDel.id}`)).status === 200);
  check("deleting twice is 404", (await admin.del(`/events/${adminDel.id}`)).status === 404);

  // ------------------------------------------------------------------
  section("translations (Japanese override + English fallback)");
  const tr = (await admin.post("/events", { title: "ZZ Event Translated", description: "English body ZZTR", startsAt: iso(80), visibility: "PUBLIC", translations: { ja: { title: "ZZ翻訳イベント", description: "日本語の説明ZZ" } } })).json;
  check("create with a Japanese override", (await guest.get(`/events/${tr.id}`, "ja")).json.title === "ZZ翻訳イベント");
  check("English locale shows the base text", (await guest.get(`/events/${tr.id}`, "en")).json.title === "ZZ Event Translated");
  check("no locale header shows the base text", (await guest.get(`/events/${tr.id}`)).json.title === "ZZ Event Translated");
  check("an unsupported locale falls back to English", (await guest.get(`/events/${tr.id}`, "fr")).json.title === "ZZ Event Translated");
  const jaList = (await guest.get("/events?scope=upcoming&limit=200", "ja")).json.find((e) => e.id === tr.id);
  check("the list is localized too", jaList?.title === "ZZ翻訳イベント" && jaList?.description === "日本語の説明ZZ");
  check("only translatable fields change: location/kind/dates are identical across locales", (() => { const a = jaList; return a.kind === tr.kind && a.startsAt === tr.startsAt && a.location === tr.location; })());
  const onlyTitle = (await admin.post("/events", { title: "ZZ Event Half", description: "English half", startsAt: iso(81), visibility: "PUBLIC", translations: { ja: { title: "ZZ半分イベント" } } })).json;
  const half = (await guest.get(`/events/${onlyTitle.id}`, "ja")).json;
  check("a field without an override falls back to English", half.title === "ZZ半分イベント" && half.description === "English half");
  check("GET /translations/EVENT/:id requires a login", (await guest.get(`/translations/EVENT/${tr.id}`)).status === 401);
  const trGet = await memB.client.get(`/translations/EVENT/${tr.id}`);
  check("GET /translations/EVENT/:id returns the Japanese values", trGet.status === 200 && trGet.json.ja.title === "ZZ翻訳イベント" && trGet.json.ja.description === "日本語の説明ZZ");
  check("a non-owner member cannot write a translation (403) and nothing changes", (await memB.client.put(`/events/${tr.id}`, { translations: { ja: { title: "乗っ取り" } } })).status === 403 && (await prisma.translation.findFirst({ where: { entityType: "EVENT", entityId: tr.id, field: "title" } })).value === "ZZ翻訳イベント");
  check("a guest cannot write a translation (401)", (await guest.put(`/events/${tr.id}`, { translations: { ja: { title: "x" } } })).status === 401);
  check("updating one translated field leaves the other untouched", (await admin.put(`/events/${tr.id}`, { translations: { ja: { title: "ZZ更新イベント" } } })).status === 200 && (await guest.get(`/events/${tr.id}`, "ja")).json.description === "日本語の説明ZZ");
  check("clearing a Japanese title with \"\" restores English", (await admin.put(`/events/${tr.id}`, { translations: { ja: { title: "" } } })).status === 200 && (await guest.get(`/events/${tr.id}`, "ja")).json.title === "ZZ Event Translated");
  check("clearing with null restores English", (await admin.put(`/events/${tr.id}`, { translations: { ja: { description: null } } })).status === 200 && (await guest.get(`/events/${tr.id}`, "ja")).json.description === "English body ZZTR");
  check("clearing removes the row (no blank override stored)", (await prisma.translation.count({ where: { entityType: "EVENT", entityId: tr.id } })) === 0);
  check("a whitespace-only Japanese value clears too", (await admin.put(`/events/${onlyTitle.id}`, { translations: { ja: { title: "   " } } })).status === 200 && (await guest.get(`/events/${onlyTitle.id}`, "ja")).json.title === "ZZ Event Half");
  check("owner (member) may write the translation of their own event", (await memA.client.put(`/events/${aliceEv.id}`, { translations: { ja: { title: "ZZアリスのイベント" } } })).status === 200);
  check("an unknown translatable field in `ja` is ignored, not stored", (await admin.put(`/events/${tr.id}`, { translations: { ja: { location: "x" } } })).status === 200 && (await prisma.translation.count({ where: { entityType: "EVENT", entityId: tr.id } })) === 0);
  check("a hidden event's translation is not visible to a guest via the event API", (await guest.get(`/events/${aliceEv.id}`, "ja")).status === 404);
  await admin.put(`/events/${tr.id}`, { translations: { ja: { title: "ZZ翻訳イベント", description: "日本語の説明ZZ" } } });

  // ------------------------------------------------------------------
  section("search");
  const s = (client, q, type = "event", locale) => client.get(`/search?q=${encodeURIComponent(q)}&type=${type}`, locale);
  const gs = await s(guest, "ZZ Event Public");
  check("search finds a public event by title", gs.json.results.some((r) => r.id === pubUp.id && r.type === "event" && r.href === `/events/${pubUp.id}`));
  check("search finds by description", (await s(guest, "Quantum ZZQ")).json.results.some((r) => r.id === pubUp.id));
  check("search finds by location", (await s(guest, "ZZ Room 101")).json.results.some((r) => r.id === pubUp.id));
  check("guest search never finds a LAB_ONLY event by title", (await s(guest, "ZZ Event Hidden Upcoming")).json.results.length === 0);
  check("guest search never finds a LAB_ONLY event by description or location", (await s(guest, "ZZH budget")).json.results.length === 0 && (await s(guest, "ZZ Room 202")).json.results.length === 0);
  check("guest total and count for a hidden-only query are 0", (await s(guest, "ZZ Event Hidden")).json.pagination.total === 0 && (await s(guest, "ZZ Event Hidden")).json.counts.event === 0);
  check("member search finds the LAB_ONLY event", (await s(memB.client, "ZZ Event Hidden Upcoming")).json.results.some((r) => r.id === hidUp.id));
  const mgrHit = (await s(mgr.client, "ZZ Event Hidden Upcoming")).json.results.find((r) => r.id === hidUp.id);
  check("manager search carries `visibility`; member's does not", mgrHit?.visibility === "LAB_ONLY" && !("visibility" in (await s(memB.client, "ZZ Event Hidden Upcoming")).json.results.find((r) => r.id === hidUp.id)));
  const allTypes = await guest.get(`/search?q=${encodeURIComponent("ZZ Event Public")}`);
  check("`all` search includes events and the chip counts add up", allTypes.json.results.some((r) => r.type === "event") && allTypes.json.counts.all === Object.entries(allTypes.json.counts).filter(([k]) => k !== "all").reduce((a, [, v]) => a + v, 0));
  check("past events remain searchable", (await s(guest, "ZZ Event Public Past")).json.results.some((r) => r.id === pubPast.id));
  check("search results are in a repeatable order", JSON.stringify((await s(mgr.client, "ZZ Event")).json.results.map((r) => r.id)) === JSON.stringify((await s(mgr.client, "ZZ Event")).json.results.map((r) => r.id)));
  const pg = await mgr.client.get(`/search?q=${encodeURIComponent("ZZ Event")}&type=event&limit=2&page=2`);
  check("event search paginates", pg.json.results.length === 2 && pg.json.pagination.page === 2 && pg.json.pagination.total > 2);
  check("event meta is language-neutral (ISO date + location)", /^\d{4}-\d{2}-\d{2}/.test(gs.json.results.find((r) => r.id === pubUp.id)?.meta ?? ""));
  check("Japanese: a Japanese override is found with X-Locale ja", (await s(guest, "ZZ翻訳", "event", "ja")).json.results.some((r) => r.id === tr.id));
  check("Japanese: the hit shows the Japanese title", (await s(guest, "ZZ翻訳", "event", "ja")).json.results.find((r) => r.id === tr.id)?.title === "ZZ翻訳イベント");
  check("English locale does not search Japanese overrides", (await s(guest, "ZZ翻訳", "event", "en")).json.results.length === 0);
  check("Japanese: description overrides are searchable", (await s(guest, "日本語の説明ZZ", "event", "ja")).json.results.some((r) => r.id === tr.id));
  check("Japanese: English base text is still searchable in ja", (await s(guest, "English body ZZTR", "event", "ja")).json.results.some((r) => r.id === tr.id));
  check("Japanese: a guest cannot find a hidden event's Japanese override", (await s(guest, "ZZアリス", "event", "ja")).json.results.length === 0 && (await s(guest, "ZZアリス", "event", "ja")).json.counts.event === 0);
  check("Japanese: a member can find the hidden event's override", (await s(memB.client, "ZZアリス", "event", "ja")).json.results.some((r) => r.id === aliceEv.id));
  check("full-width query text is normalised (ＺＺ翻訳)", (await s(guest, "ＺＺ翻訳", "event", "ja")).json.results.some((r) => r.id === tr.id));
  check("search type=event is accepted and an unknown type is 400", (await guest.get("/search?q=zz&type=events")).status === 400);
  const xssEv = (await admin.post("/events", { title: "ZZ Event <script>alert(1)</script>", startsAt: iso(90), visibility: "PUBLIC", location: "<img src=x onerror=alert(1)>", description: "<svg onload=alert(1)>" })).json;
  const xssHit = (await s(guest, "ZZ Event <script>alert(1)</script>")).json;
  check("hostile text is stored and returned verbatim as JSON data (escaping happens at render)", xssEv.title.includes("<script>") && xssHit.results.some((r) => r.id === xssEv.id));

  // ------------------------------------------------------------------
  section("hostile input");
  const hostile = (await memA.client.post("/events", { title: "ZZ Event <b>bold</b>", description: "<script>document.cookie</script>", location: "\"><img src=x onerror=alert(1)>", url: "https://example.org/?q=<script>", startsAt: iso(100), translations: { ja: { title: "<script>alert('ja')</script>", description: "<img src=x onerror=alert(2)>" } } })).json;
  check("hostile fields are accepted as plain text", hostile?.id && hostile.title === "ZZ Event <b>bold</b>");
  check("hostile Japanese override is returned verbatim as data", (await memA.client.get(`/events/${hostile.id}`, "ja")).json.title === "<script>alert('ja')</script>");
  check("a hostile URL scheme is rejected on update too", (await memA.client.put(`/events/${hostile.id}`, { url: "javascript:alert(1)" })).status === 400 && (await memA.client.put(`/events/${hostile.id}`, { url: "vbscript:msgbox(1)" })).status === 400);
  check("a valid https URL is accepted, mixed-case scheme too", (await memA.client.put(`/events/${hostile.id}`, { url: "HTTPS://Example.org/path" })).status === 200);
  check("a URL can be cleared with an empty string", (await memA.client.put(`/events/${hostile.id}`, { url: "" })).json.url === "");
  check("an oversized JSON body is rejected", (await memA.client.post("/events", { title: "ZZ Event big", startsAt: iso(1), description: "x".repeat(2_000_000) })).status >= 400);

  // ------------------------------------------------------------------
  section("locale never changes an authorization outcome");
  const matrix = [
    ["guest GET hidden event", (l) => guest.get(`/events/${hidUp.id}`, l)],
    ["guest GET public event", (l) => guest.get(`/events/${pubPast.id}`, l)],
    ["guest POST", (l) => guest.post("/events", { title: "ZZ Event loc", startsAt: iso(1) }, l)],
    ["guest PUT", (l) => guest.put(`/events/${pubPast.id}`, { title: "ZZ Event loc" }, l)],
    ["guest DELETE", (l) => guest.del(`/events/${pubPast.id}`, l)],
    ["member PUT others' event", (l) => memB.client.put(`/events/${pubPast.id}`, { title: "ZZ Event loc" }, l)],
    ["member PUT others' event (translation only)", (l) => memB.client.put(`/events/${pubPast.id}`, { translations: { ja: { title: "x" } } }, l)],
    ["member DELETE others' event", (l) => memB.client.del(`/events/${pubPast.id}`, l)],
    ["member set visibility", (l) => memA.client.post("/events", { title: "ZZ Event loc", startsAt: iso(1), visibility: "PUBLIC" }, l)],
    ["member link project", (l) => memA.client.post("/events", { title: "ZZ Event loc", startsAt: iso(1), projectId: projHid.id }, l)],
    ["member GET hidden event", (l) => memB.client.get(`/events/${hidUp.id}`, l)],
    ["manager PUT missing event", (l) => mgr.client.put("/events/doesnotexist1", { title: "ZZ Event loc" }, l)],
    ["GET /translations as guest", (l) => guest.get(`/translations/EVENT/${tr.id}`, l)],
    ["GET /translations as member", (l) => memB.client.get(`/translations/EVENT/${tr.id}`, l)],
  ];
  for (const [name, fn] of matrix) {
    const [en, ja] = await enja(fn);
    check(`locale-independent: ${name}`, en.status === ja.status, `${en.status} vs ${ja.status}`);
  }
  for (const [role, client] of [["guest", guest], ["member", memB.client], ["manager", mgr.client]]) {
    const [en, ja] = await enja((l) => client.get("/events?scope=all&limit=200", l));
    check(`locale-independent: the set of visible events for a ${role}`, JSON.stringify(ids(en).sort()) === JSON.stringify(ids(ja).sort()));
    const [se, sj] = await enja((l) => client.get(`/search?q=ZZ&type=event`, l));
    check(`locale-independent: search counts/total for a ${role} (English-only fixtures)`, se.json.counts.event === sj.json.counts.event && se.json.pagination.total === sj.json.pagination.total);
  }
  // successful writes succeed under both locales (each on its own event)
  for (const l of ["en", "ja"]) {
    const c = await memA.client.post("/events", { title: `ZZ Event Loc ${l}`, startsAt: iso(3) }, l);
    const u = await memA.client.put(`/events/${c.json.id}`, { location: "x" }, l);
    const d = await memA.client.del(`/events/${c.json.id}`, l);
    check(`owner create/update/delete all succeed under X-Locale: ${l}`, c.status === 201 && u.status === 200 && d.status === 200);
  }
  const jaWriteAsB = await memB.client.put(`/events/${aliceEv.id}`, { title: "ZZ Event x" }, "ja");
  check("a Japanese-locale write by a non-owner is still 403", jaWriteAsB.status === 403);

  // ------------------------------------------------------------------
  section("audit log");
  const auditEv = (await memA.client.post("/events", { title: "ZZ Event Audited", description: "SECRET-BODY-TEXT-ZZ", startsAt: iso(20), translations: { ja: { title: "ZZ監査イベント" } } })).json;
  await memA.client.put(`/events/${auditEv.id}`, { location: "Somewhere", translations: { ja: { title: "ZZ監査イベント2", description: "説明" } } });
  await mgr.client.put(`/events/${auditEv.id}`, { visibility: "PUBLIC" });
  await mgr.client.put(`/events/${auditEv.id}`, { visibility: "PUBLIC" });
  await memA.client.del(`/events/${auditEv.id}`);
  const rows = await prisma.auditLog.findMany({ where: { entityType: "EVENT", entityId: auditEv.id }, orderBy: { createdAt: "asc" } });
  const acts = rows.map((r) => r.action);
  check("create is audited with the actor", rows.some((r) => r.action === "EVENT_CREATED" && r.actorId === memA.id));
  check("update is audited with the changed field names", rows.some((r) => r.action === "EVENT_UPDATED" && JSON.parse(r.details).changed.includes("location")));
  check("a visibility change is audited once per real change", acts.filter((a) => a === "CONTENT_VISIBILITY_CHANGED").length === 1 && rows.some((r) => r.action === "CONTENT_VISIBILITY_CHANGED" && r.actorId === mgr.id && JSON.parse(r.details).from === "LAB_ONLY" && JSON.parse(r.details).to === "PUBLIC"));
  check("translation changes are audited (create and update), by field name", acts.filter((a) => a === "EVENT_TRANSLATIONS_CHANGED").length === 2 && rows.filter((r) => r.action === "EVENT_TRANSLATIONS_CHANGED").every((r) => JSON.parse(r.details).locale === "ja"));
  check("delete is audited", rows.some((r) => r.action === "EVENT_DELETED" && r.actorId === memA.id));
  check("a no-op PUT writes no EVENT_UPDATED row (one for the location edit, one for the real visibility change)", acts.filter((a) => a === "EVENT_UPDATED").length === 2);
  const blob = rows.map((r) => r.details ?? "").join("\n");
  check("audit rows never carry description text or Japanese translation values", !blob.includes("SECRET-BODY-TEXT-ZZ") && !blob.includes("ZZ監査イベント") && !blob.includes("説明"));
  const failedWrite = await prisma.auditLog.count({ where: { entityType: "EVENT", entityId: aliceEv.id, actorId: memB.id } });
  check("a rejected write leaves no audit row", failedWrite === 0);
  check("audit details never use a forbidden key", rows.every((r) => Object.keys(JSON.parse(r.details ?? "{}")).every((k) => !/pass|hash|secret|token|cookie|session|body|content|message/i.test(k))));

  // ------------------------------------------------------------------
  section("cleanup");
  await cleanup();
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: RUN_STARTED } } });
  const after = { events: await prisma.event.count(), translations: await prisma.translation.count() };
  check("cleanup restored the event and translation row counts", before.events === after.events && before.translations === after.translations, JSON.stringify({ before, after }));

  console.log(`\n${passed} passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("Script crashed:", e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
