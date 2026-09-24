/**
 * Unit test of the pure parts of the events feature (Phase 16): the shared request schemas, the
 * date/time rules, the central permission functions, the scope query builder, the serializer's
 * visibility + locale behaviour (against a fake db), and the translation fallback. No server, no
 * database.   npm run test:unit -w apps/server
 */
import {
  canCreateEvent,
  canDeleteEvent,
  canEditEvent,
  canLinkEventToProject,
  createEventSchema,
  eventEndInstant,
  eventListQuerySchema,
  eventRangeInvalid,
  isEventPast,
  parseEventInstant,
  toUtcMidnight,
  updateEventSchema,
  TRANSLATABLE_FIELDS,
  translatableFieldsOf,
  EVENT_KINDS,
} from "@scl/shared";
import { eventScopeWhere, eventOrderBy, normalizeEventTimes, serializeEvents, type EventRow } from "../src/lib/eventSerializers.js";
import { localize } from "../src/lib/translations.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

const START = "2030-06-01T10:00:00.000Z";
const valid = (over: Record<string, unknown> = {}) => createEventSchema.safeParse({ title: "Seminar", startsAt: START, ...over });
const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? "" : (r.error?.issues[0]?.message ?? ""));

// ---- create schema: defaults ---------------------------------------------------------
const base = valid();
t("create: a title and a start are enough", base.success);
t("create: defaults are kind OTHER, not all-day, empty text, no end", base.success && base.data.kind === "OTHER" && base.data.allDay === false && base.data.description === "" && base.data.location === "" && base.data.url === "" && base.data.endsAt === undefined);
t("create: visibility and projectId are left undefined (the route decides: LAB_ONLY / none)", base.success && base.data.visibility === undefined && base.data.projectId === undefined);
t("create: text is trimmed", valid({ title: "  Seminar  ", location: " Lab " }).success && (valid({ title: "  Seminar  " }) as { data: { title: string } }).data.title === "Seminar");
t("create: an empty-string end becomes null", (valid({ endsAt: "" }) as { data: { endsAt: unknown } }).data.endsAt === null);
t("create: a null end is accepted", valid({ endsAt: null }).success);

// ---- create schema: required + limits --------------------------------------------------
t("create: title is required", !createEventSchema.safeParse({ startsAt: START }).success && msg(createEventSchema.safeParse({ startsAt: START })) === "Title is required.");
t("create: blank title rejected", !valid({ title: "   " }).success);
t("create: title 200 ok / 201 rejected", valid({ title: "x".repeat(200) }).success && !valid({ title: "x".repeat(201) }).success);
t("create: title max message is the allow-listed one", msg(valid({ title: "x".repeat(201) })) === "Title must be at most 200 characters.");
t("create: description 5000 ok / 5001 rejected", valid({ description: "x".repeat(5000) }).success && !valid({ description: "x".repeat(5001) }).success);
t("create: location 200 ok / 201 rejected", valid({ location: "x".repeat(200) }).success && !valid({ location: "x".repeat(201) }).success);
t("create: start is required", !createEventSchema.safeParse({ title: "x" }).success && msg(createEventSchema.safeParse({ title: "x" })) === "Start is required.");
t("create: a non-string title is rejected, not coerced", !valid({ title: 5 }).success);
t("create: allDay must be boolean", !valid({ allDay: "true" }).success && valid({ allDay: true }).success);
t("create: every documented kind is accepted", EVENT_KINDS.every((k) => valid({ kind: k }).success));
t("create: an unknown / wrongly-cased kind is rejected", !valid({ kind: "PARTY" }).success && !valid({ kind: "seminar" }).success);
t("create: visibility must be PUBLIC or LAB_ONLY", valid({ visibility: "PUBLIC" }).success && valid({ visibility: "LAB_ONLY" }).success && !valid({ visibility: "SECRET" }).success);
t("create: projectId must look like an id; null is allowed", valid({ projectId: "abc_123-X" }).success && valid({ projectId: null }).success && !valid({ projectId: "a b" }).success && !valid({ projectId: "../x" }).success);
t("create: unknown keys (createdById, id) are stripped, never accepted", (valid({ createdById: "someone", id: "x" }) as { data: Record<string, unknown> }).data.createdById === undefined && (valid({ id: "x" }) as { data: Record<string, unknown> }).data.id === undefined);

// ---- URL safety ----------------------------------------------------------------------
for (const good of ["https://example.org", "http://example.org/a?b=c", "HTTPS://EXAMPLE.ORG/x", ""]) t(`url: accepts ${JSON.stringify(good)}`, valid({ url: good }).success);
for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "ftp://example.org", "//example.org", "example.org", "https://", "https://exa mple.org", "file:///etc/passwd"]) {
  t(`url: rejects ${JSON.stringify(bad)}`, !valid({ url: bad }).success);
}
t("url: max length is enforced", !valid({ url: "https://example.org/" + "a".repeat(2100) }).success);

// ---- date/time ------------------------------------------------------------------------
t("parse: a UTC instant", parseEventInstant("2030-06-01T10:00:00Z")?.toISOString() === "2030-06-01T10:00:00.000Z");
t("parse: seconds and fractions optional", parseEventInstant("2030-06-01T10:00Z") !== null && parseEventInstant("2030-06-01T10:00:00.123456Z") !== null);
t("parse: an offset is converted", parseEventInstant("2030-06-01T19:00:00+09:00")?.toISOString() === "2030-06-01T10:00:00.000Z");
t("parse: Feb 30 is rejected (no roll-over)", parseEventInstant("2030-02-30T10:00:00Z") === null);
t("parse: Apr 31, month 13, day 0 rejected", parseEventInstant("2030-04-31T10:00:00Z") === null && parseEventInstant("2030-13-01T10:00:00Z") === null && parseEventInstant("2030-01-00T10:00:00Z") === null);
t("parse: leap day accepted only in a leap year", parseEventInstant("2032-02-29T10:00:00Z") !== null && parseEventInstant("2031-02-29T10:00:00Z") === null && parseEventInstant("2100-02-29T10:00:00Z") === null);
t("parse: hour 24 / minute 60 / second 60 rejected", parseEventInstant("2030-01-01T24:00:00Z") === null && parseEventInstant("2030-01-01T10:60:00Z") === null && parseEventInstant("2030-01-01T10:00:60Z") === null);
t("parse: a silly offset is rejected", parseEventInstant("2030-01-01T10:00:00+25:00") === null && parseEventInstant("2030-01-01T10:00:00+09:60") === null);
t("parse: a date without a time / without a zone is rejected", parseEventInstant("2030-06-01") === null && parseEventInstant("2030-06-01T10:00:00") === null);
t("parse: range 1970..2099", parseEventInstant("1969-12-31T23:59:59Z") === null && parseEventInstant("1970-01-01T00:00:00Z") !== null && parseEventInstant("2099-12-31T23:59:59Z") !== null && parseEventInstant("2100-01-01T00:00:00Z") === null);
t("parse: garbage / whitespace / injection", ["", " ", "now", "2030-06-01T10:00:00Z; DROP TABLE", "<script>", "٢٠٣٠-٠٦-٠١T١٠:٠٠:٠٠Z"].every((s) => parseEventInstant(s) === null));
t("range: end before start is invalid; equal and after are fine", eventRangeInvalid("2030-06-01T10:00:00Z", "2030-06-01T09:59:59Z") && !eventRangeInvalid("2030-06-01T10:00:00Z", "2030-06-01T10:00:00Z") && !eventRangeInvalid("2030-06-01T10:00:00Z", "2030-06-01T11:00:00Z"));
t("range: a missing end (or start) is never invalid", !eventRangeInvalid(START, null) && !eventRangeInvalid(START, undefined) && !eventRangeInvalid(null, START));
t("create: end before start is rejected with the allow-listed message", msg(valid({ endsAt: "2030-06-01T09:00:00.000Z" })) === "End can't be before the start.");
t("create: end equal to start is allowed", valid({ endsAt: START }).success);
t("create: a garbage end is rejected", msg(valid({ endsAt: "soon" })) === "End must be a valid date and time.");
t("create: an impossible start date is rejected", msg(valid({ startsAt: "2030-02-30T10:00:00.000Z" })) === "Start must be a valid date and time.");

// ---- all-day ---------------------------------------------------------------------------
t("toUtcMidnight floors to the UTC day", toUtcMidnight(new Date("2030-06-01T23:59:59Z")).toISOString() === "2030-06-01T00:00:00.000Z");
const nt = normalizeEventTimes({ startsAt: new Date("2030-06-01T15:30:00Z"), endsAt: new Date("2030-06-03T22:00:00Z"), allDay: true });
t("normalizeEventTimes: all-day start and end become UTC midnight", nt.startsAt.toISOString() === "2030-06-01T00:00:00.000Z" && nt.endsAt?.toISOString() === "2030-06-03T00:00:00.000Z");
t("normalizeEventTimes: all-day with no end keeps null", normalizeEventTimes({ startsAt: new Date("2030-06-01T15:30:00Z"), endsAt: null, allDay: true }).endsAt === null);
t("normalizeEventTimes: a timed event is untouched", normalizeEventTimes({ startsAt: new Date("2030-06-01T15:30:00Z"), endsAt: null, allDay: false }).startsAt.toISOString() === "2030-06-01T15:30:00.000Z");

// ---- upcoming / past -------------------------------------------------------------------
const NOW = Date.parse("2030-06-10T12:00:00Z");
const ev = (startsAt: string, endsAt: string | null = null, allDay = false) => ({ startsAt, endsAt, allDay });
t("past: a timed event with no end, started before now, is past", isEventPast(ev("2030-06-10T11:59:59Z"), NOW));
t("past: a timed event starting exactly now is not past", !isEventPast(ev("2030-06-10T12:00:00Z"), NOW));
t("past: a timed event in progress (end in future) is not past", !isEventPast(ev("2030-06-10T10:00:00Z", "2030-06-10T13:00:00Z"), NOW));
t("past: a timed event that ended is past", isEventPast(ev("2030-06-10T09:00:00Z", "2030-06-10T11:00:00Z"), NOW));
t("past: an all-day event today is NOT past all day long", !isEventPast(ev("2030-06-10T00:00:00Z", null, true), NOW) && !isEventPast(ev("2030-06-10T00:00:00Z", null, true), Date.parse("2030-06-10T23:59:59Z")));
t("past: an all-day event yesterday is past", isEventPast(ev("2030-06-09T00:00:00Z", null, true), NOW));
t("past: a multi-day all-day range counts through its last day", !isEventPast(ev("2030-06-08T00:00:00Z", "2030-06-10T00:00:00Z", true), NOW) && isEventPast(ev("2030-06-07T00:00:00Z", "2030-06-09T00:00:00Z", true), NOW));
t("eventEndInstant adds a day only for all-day", eventEndInstant(ev("2030-06-10T00:00:00Z", null, true)) - eventEndInstant(ev("2030-06-10T00:00:00Z", null, false)) === 86_400_000);
const up = eventScopeWhere("upcoming", new Date(NOW)) as { OR: unknown[] };
const pa = eventScopeWhere("past", new Date(NOW)) as { OR: unknown[] };
t("scope: `all` adds no restriction", Object.keys(eventScopeWhere("all", new Date(NOW))).length === 0);
t("scope: upcoming and past are each four explicit alternatives (no NOT(...): SQL NOT(NULL) would drop rows)", up.OR.length === 4 && pa.OR.length === 4 && !JSON.stringify(up).includes("NOT") && !JSON.stringify(pa).includes("NOT"));
t("scope: upcoming uses gte and past uses lt on the same instants (exact complements)", JSON.stringify(up).includes('"gte"') && !JSON.stringify(up).includes('"lt"') && JSON.stringify(pa).includes('"lt"') && !JSON.stringify(pa).includes('"gte"'));
t("order: upcoming ascending, past/all descending, id as the tiebreaker", JSON.stringify(eventOrderBy("upcoming")) === '[{"startsAt":"asc"},{"id":"asc"}]' && JSON.stringify(eventOrderBy("past")) === '[{"startsAt":"desc"},{"id":"asc"}]' && JSON.stringify(eventOrderBy("all")) === '[{"startsAt":"desc"},{"id":"asc"}]');

// ---- list query ------------------------------------------------------------------------
const q = (o: Record<string, unknown>) => eventListQuerySchema.safeParse(o);
t("list query: defaults are upcoming, limit 100, page 1", q({}).success && (q({}) as { data: { scope: string; limit: number; page: number } }).data.scope === "upcoming" && (q({}) as { data: { limit: number } }).data.limit === 100 && (q({}) as { data: { page: number } }).data.page === 1);
t("list query: scope allow-list", q({ scope: "past" }).success && q({ scope: "all" }).success && !q({ scope: "everything" }).success);
t("list query: limit 1..200 only", q({ limit: "1" }).success && q({ limit: "200" }).success && !q({ limit: "0" }).success && !q({ limit: "201" }).success && !q({ limit: "-1" }).success && !q({ limit: "1.5" }).success && !q({ limit: "abc" }).success && !q({ limit: "1e2" }).success);
t("list query: page >= 1 whole numbers only", q({ page: "3" }).success && !q({ page: "0" }).success && !q({ page: "x" }).success && !q({ page: "999999" }).success);
t("list query: an array-valued param (?limit=1&limit=2) is rejected", !q({ limit: ["1", "2"] }).success);

// ---- update schema ----------------------------------------------------------------------
t("update: nothing to update is rejected", !updateEventSchema.safeParse({}).success && msg(updateEventSchema.safeParse({})) === "Nothing to update.");
t("update: any single field is enough", updateEventSchema.safeParse({ title: "x" }).success && updateEventSchema.safeParse({ endsAt: null }).success && updateEventSchema.safeParse({ projectId: null }).success);
t("update: a partial body does not reset the other fields to defaults", (() => { const r = updateEventSchema.safeParse({ title: "x" }); return r.success && r.data.kind === undefined && r.data.allDay === undefined && r.data.description === undefined; })());
t("update: end before start (both given) rejected; one alone passes the schema (the route checks against the stored value)", !updateEventSchema.safeParse({ startsAt: START, endsAt: "2030-06-01T09:00:00Z" }).success && updateEventSchema.safeParse({ endsAt: "2030-06-01T09:00:00Z" }).success);
t("update: blank title rejected, hostile url rejected", !updateEventSchema.safeParse({ title: " " }).success && !updateEventSchema.safeParse({ url: "javascript:alert(1)" }).success);
t("update: translations may clear a field (null / empty string)", updateEventSchema.safeParse({ translations: { ja: { title: null, description: "" } } }).success);
t("update: Japanese title/description limits mirror the English ones", updateEventSchema.safeParse({ translations: { ja: { title: "あ".repeat(200) } } }).success && !updateEventSchema.safeParse({ translations: { ja: { title: "あ".repeat(201) } } }).success && !updateEventSchema.safeParse({ translations: { ja: { description: "あ".repeat(5001) } } }).success);

// ---- permissions (the central policy) ---------------------------------------------------
const A = (role: "ADMIN" | "LAB_MANAGER" | "MEMBER", id = "u1") => ({ id, role });
t("policy: a guest can create/edit/delete nothing", !canCreateEvent(null) && !canEditEvent(null, true) && !canDeleteEvent(null, true) && !canLinkEventToProject(null));
t("policy: any signed-in account may create", canCreateEvent(A("MEMBER")) && canCreateEvent(A("LAB_MANAGER")) && canCreateEvent(A("ADMIN")));
t("policy: a member edits/deletes only their own", canEditEvent(A("MEMBER"), true) && !canEditEvent(A("MEMBER"), false) && canDeleteEvent(A("MEMBER"), true) && !canDeleteEvent(A("MEMBER"), false));
t("policy: managers and admins edit/delete any", canEditEvent(A("LAB_MANAGER"), false) && canEditEvent(A("ADMIN"), false) && canDeleteEvent(A("LAB_MANAGER"), false) && canDeleteEvent(A("ADMIN"), false));
t("policy: only managers/admins link a project", !canLinkEventToProject(A("MEMBER")) && canLinkEventToProject(A("LAB_MANAGER")) && canLinkEventToProject(A("ADMIN")));
t("policy: an unknown role gets no more than a member", !canEditEvent({ id: "u", role: "WIZARD" as never }, false) && !canLinkEventToProject({ id: "u", role: "WIZARD" as never }));

// ---- translations allow-list --------------------------------------------------------------
t("translations: EVENT is translatable with exactly title + description", translatableFieldsOf("EVENT").join() === "title,description");
t("translations: no structural event field is translatable", !(TRANSLATABLE_FIELDS.EVENT as readonly string[]).some((f) => ["id", "location", "url", "kind", "startsAt", "endsAt", "allDay", "visibility", "projectId", "createdById"].includes(f)));
const row = { id: "e1", title: "Seminar", description: "About X", location: "Room 1" };
t("localize: an override replaces the field", localize(row, "EVENT", new Map([["e1", { title: "セミナー" }]])).title === "セミナー");
t("localize: a field without an override falls back to English", localize(row, "EVENT", new Map([["e1", { title: "セミナー" }]])).description === "About X");
t("localize: an empty override falls back to English", localize(row, "EVENT", new Map([["e1", { title: "" }]])).title === "Seminar");
t("localize: no translations for the row leaves it untouched", localize(row, "EVENT", new Map()).title === "Seminar");
t("localize: a non-translatable field can never be overridden", localize(row, "EVENT", new Map([["e1", { location: "どこか", id: "hacked" }]])).location === "Room 1" && localize(row, "EVENT", new Map([["e1", { id: "hacked" }]])).id === "e1");

// ---- serializer: visibility, ownership, locale (fake db) -----------------------------------
const mkRow = (over: Partial<EventRow> = {}): EventRow =>
  ({
    id: "e1",
    title: "Seminar",
    description: "About X",
    location: "Room 1",
    url: "",
    kind: "SEMINAR",
    startsAt: new Date("2030-06-01T10:00:00Z"),
    endsAt: null,
    allDay: false,
    visibility: "PUBLIC",
    projectId: "p1",
    createdById: "owner",
    createdAt: new Date(),
    updatedAt: new Date(),
    project: { id: "p1", title: "Project P", visibility: "PUBLIC" },
    createdBy: { teamMember: { id: "tm1", name: "Alice" } },
    ...over,
  }) as EventRow;

// serializeEvents uses the real prisma client only for translations, and only when locale != en.
const owner = { id: "owner", role: "MEMBER" as const };
const other = { id: "other", role: "MEMBER" as const };
const mgr = { id: "mgr", role: "LAB_MANAGER" as const };
const [sOwner] = await serializeEvents([mkRow()], owner, "en");
const [sOther] = await serializeEvents([mkRow()], other, "en");
const [sMgr] = await serializeEvents([mkRow()], mgr, "en");
const [sGuest] = await serializeEvents([mkRow()], null, "en");
t("serializer: the owner can edit/delete; another member and a guest cannot; a manager can", sOwner.canEdit && sOwner.canDelete && !sOther.canEdit && !sOther.canDelete && !sGuest.canEdit && !sGuest.canDelete && sMgr.canEdit && sMgr.canDelete);
t("serializer: visibility only for managers", sMgr.visibility === "PUBLIC" && !("visibility" in sOwner) && !("visibility" in sOther) && !("visibility" in sGuest));
t("serializer: no account id anywhere in the output", !JSON.stringify(sOwner).includes('"owner"') && !("createdById" in sOwner) && !("createdBy" in sOwner));
t("serializer: the organizer is the public team profile (id + name only)", JSON.stringify(sOwner.organizer) === '{"id":"tm1","name":"Alice"}');
t("serializer: a hidden project is null for a guest, shown to a member, shown to a manager", (await serializeEvents([mkRow({ project: { id: "p1", title: "Secret", visibility: "LAB_ONLY" } })], null, "en"))[0].project === null && (await serializeEvents([mkRow({ project: { id: "p1", title: "Secret", visibility: "LAB_ONLY" } })], other, "en"))[0].project?.title === "Secret" && (await serializeEvents([mkRow({ project: { id: "p1", title: "Secret", visibility: "LAB_ONLY" } })], mgr, "en"))[0].project?.title === "Secret");
t("serializer: an unexpected project visibility value fails closed (hidden from everyone)", (await serializeEvents([mkRow({ project: { id: "p1", title: "X", visibility: "WEIRD" } })], other, "en"))[0].project === null);
t("serializer: a hidden project's title never appears in a guest's JSON", !JSON.stringify(await serializeEvents([mkRow({ project: { id: "p1", title: "SecretTitle", visibility: "LAB_ONLY" } })], null, "en")).includes("SecretTitle"));
t("serializer: no project -> null; no team profile -> null organizer", (await serializeEvents([mkRow({ project: null, projectId: null, createdBy: null, createdById: null })], mgr, "en"))[0].project === null && (await serializeEvents([mkRow({ createdBy: { teamMember: null } })], mgr, "en"))[0].organizer === null);
t("serializer: an ownerless event (createdById null) is editable only by managers", !(await serializeEvents([mkRow({ createdById: null })], owner, "en"))[0].canEdit && (await serializeEvents([mkRow({ createdById: null })], mgr, "en"))[0].canEdit);
t("serializer: dates are ISO UTC strings, end null stays null", sOwner.startsAt === "2030-06-01T10:00:00.000Z" && sOwner.endsAt === null);
t("serializer: an unknown stored kind is shown as OTHER", (await serializeEvents([mkRow({ kind: "PARTY" })], null, "en"))[0].kind === "OTHER");
t("serializer: an empty list needs no database access in English", (await serializeEvents([], null, "en")).length === 0);

console.log(`${ok} event unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
