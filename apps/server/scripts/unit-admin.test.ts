/**
 * Unit test of the pure parts of the admin / CMS layer (Phase 17): the shared query/body schemas,
 * the drift guards between the admin maps and the translation allow-list, the visibility-bulk target
 * table, the text-search WHERE builder, and the audit convention for the new actions. No server, no
 * database.   npm run test:unit -w apps/server
 */
process.env.DATABASE_URL ??= "file:./unused.db";
import {
  ADMIN_BULK_MAX,
  ADMIN_CONTENT_TYPES,
  ADMIN_TRANSLATION_ENTITY,
  ADMIN_TRANSLATION_MAX,
  ADMIN_VISIBILITY_TYPES,
  TRANSLATABLE_FIELDS,
  adminAuditQuerySchema,
  adminContentQuerySchema,
  adminFilesQuerySchema,
  adminTranslationsQuerySchema,
  bulkVisibilitySchema,
  hasVisibility,
  linkAccountSchema,
  parseIsoDay,
  queryInt,
  updateTranslationSchema,
  type Actor,
} from "@scl/shared";
import { ENTITY_TO_CONTENT_TYPE, VISIBILITY_TARGETS, contentDef, paginate, textWhere } from "../src/lib/adminContent.js";
import { recordAudit } from "../src/lib/audit.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));
const parses = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;
const A = (role: Actor["role"]): Actor => ({ id: "u1", role });

// ---- helpers -------------------------------------------------------------------------------------
t("parseIsoDay: a real day", parseIsoDay("2030-02-28")?.toISOString() === "2030-02-28T00:00:00.000Z");
t("parseIsoDay: Feb 30 does not roll over", parseIsoDay("2030-02-30") === null);
t("parseIsoDay: leap day only in a leap year", parseIsoDay("2028-02-29") !== null && parseIsoDay("2029-02-29") === null);
t("parseIsoDay: rejects formats, month 13, out-of-range years", ["2030-1-1", "20300101", "2030-13-01", "2030-00-10", "1969-12-31", "2100-01-01", "", " 2030-01-01", "2030-01-01T00:00:00Z"].every((v) => parseIsoDay(v) === null));
const qi = queryInt("Page", 1, 10, 1);
t("queryInt: absent -> fallback; digits in range accepted", qi.parse(undefined) === 1 && qi.parse("7") === 7 && qi.parse("10") === 10);
t("queryInt: rejects 0, 11, -1, 1.5, 1e1, ' 5', 0x5, arrays and objects", ["0", "11", "-1", "1.5", "1e1", " 5", "0x5", "", ["1"], { a: 1 }, 5].every((v) => !parses(qi, v)));
t("paginate: totalPages is at least 1 and rounds up", paginate(1, 25, 0).totalPages === 1 && paginate(1, 25, 26).totalPages === 2 && paginate(3, 10, 30).totalPages === 3);

// ---- content query ---------------------------------------------------------------------------------
const cq = (o: Record<string, unknown>) => adminContentQuerySchema.safeParse(o);
t("content: minimal query gets defaults (page 1, limit 25, no terms)", (() => { const r = cq({ type: "news" }); return r.success && r.data.page === 1 && r.data.limit === 25 && r.data.q.terms.length === 0; })());
t("content: every type is accepted; anything else is not", ADMIN_CONTENT_TYPES.every((x) => cq({ type: x }).success) && !cq({ type: "message" }).success && !cq({ type: "NEWS" }).success && !cq({}).success);
t("content: q is parsed with the search parser ('%' and '_' separate words, NFKC)", (() => { const r = cq({ type: "news", q: "ＦＰＧＡ%design_x" }); return r.success && r.data.q.terms.join("|") === "FPGA|design|x"; })());
t("content: q of only wildcards is 'no filter', not an error", (() => { const r = cq({ type: "news", q: "%_%" }); return r.success && r.data.q.terms.length === 0; })());
t("content: q over 100 chars or over 8 words is rejected", !cq({ type: "news", q: "a".repeat(101) }).success && !cq({ type: "news", q: "a b c d e f g h i" }).success && cq({ type: "news", q: "a b c d e f g h" }).success);
t("content: Japanese q is one word", (() => { const r = cq({ type: "news", q: "日本語の研究" }); return r.success && r.data.q.terms.length === 1; })());
t("content: filters that don't apply to the type are rejected", !cq({ type: "news", kind: "SEMINAR" }).success && !cq({ type: "team-member", visibility: "PUBLIC" }).success && !cq({ type: "project", scope: "past" }).success && !cq({ type: "event", status: "ACTIVE" }).success && !cq({ type: "news", owner: "abc" }).success);
t("content: ...and accepted where they do", cq({ type: "event", kind: "SEMINAR", scope: "past", visibility: "LAB_ONLY", owner: "abc123" }).success && cq({ type: "project", status: "ARCHIVED" }).success && cq({ type: "news", newsType: "Grant", translation: "translated" }).success && cq({ type: "team-member", translation: "untranslated" }).success && cq({ type: "publication", translation: "translated" }).success /* Phase 19: publications became translatable (title, venue) */);
t("content: an empty-string filter means 'not set'", (() => { const r = cq({ type: "team-member", visibility: "" }); return r.success && r.data.visibility === undefined; })());
t("content: bad enum values are rejected", !cq({ type: "news", visibility: "PRIVATE" }).success && !cq({ type: "event", kind: "PARTY" }).success && !cq({ type: "news", sort: "password" }).success && !cq({ type: "news", visibility: "public" }).success);
t("content: owner must look like an id", !cq({ type: "event", owner: "../x" }).success && !cq({ type: "event", owner: "a b" }).success && cq({ type: "event", owner: "cmu6xrfoh0001di7rqo1e7sll" }).success);
t("content: from/to must be real days, in order", !cq({ type: "news", from: "2030-02-30" }).success && !cq({ type: "news", from: "2030-03-02", to: "2030-03-01" }).success && cq({ type: "news", from: "2030-03-01", to: "2030-03-01" }).success);
t("content: page/limit bounds", !cq({ type: "news", page: "0" }).success && !cq({ type: "news", limit: "101" }).success && cq({ type: "news", limit: "100", page: "10000" }).success && !cq({ type: "news", page: "10001" }).success);
t("content: non-string values (arrays, objects, numbers) are rejected", !cq({ type: ["news", "project"] }).success && !cq({ type: "news", q: ["a"] }).success && !cq({ type: "news", page: 1 }).success && !cq({ type: "news", visibility: { a: 1 } }).success);
t("content: hasVisibility is true for eight types (Phase 22 added knowledge, Phase 23 resource), false for team-member", ADMIN_CONTENT_TYPES.filter(hasVisibility).length === 8 && !hasVisibility("team-member"));

// ---- bulk visibility ----------------------------------------------------------------------------------
const bv = (o: unknown) => bulkVisibilitySchema.safeParse(o);
t("bulk: a valid body", bv({ type: "news", ids: ["a1", "b2"], visibility: "PUBLIC" }).success);
t("bulk: only types with a visibility column", ADMIN_VISIBILITY_TYPES.every((x) => bv({ type: x, ids: ["a"], visibility: "LAB_ONLY" }).success) && !bv({ type: "team-member", ids: ["a"], visibility: "PUBLIC" }).success);
t("bulk: only PUBLIC / LAB_ONLY, exactly", !bv({ type: "news", ids: ["a"], visibility: "PRIVATE" }).success && !bv({ type: "news", ids: ["a"], visibility: "public" }).success && !bv({ type: "news", ids: ["a"] }).success);
t("bulk: ids must be 1..100 unique well-formed ids", !bv({ type: "news", ids: [], visibility: "PUBLIC" }).success && bv({ type: "news", ids: Array.from({ length: ADMIN_BULK_MAX }, (_, i) => `i${i}`), visibility: "PUBLIC" }).success && !bv({ type: "news", ids: Array.from({ length: ADMIN_BULK_MAX + 1 }, (_, i) => `i${i}`), visibility: "PUBLIC" }).success && !bv({ type: "news", ids: ["a", "a"], visibility: "PUBLIC" }).success && !bv({ type: "news", ids: ["../x"], visibility: "PUBLIC" }).success && !bv({ type: "news", ids: "a", visibility: "PUBLIC" }).success);
t("bulk: extra keys (role, userId) are stripped, never passed on", (() => { const r = bv({ type: "news", ids: ["a"], visibility: "PUBLIC", role: "ADMIN", userId: "x" }); return r.success && !("role" in r.data) && !("userId" in r.data); })());
t("bulk: null / array / string bodies rejected", !bv(null).success && !bv([]).success && !bv("x").success);

// ---- translations ------------------------------------------------------------------------------------------
t("translations: every entity type maps back to exactly one content type", Object.keys(TRANSLATABLE_FIELDS).every((e) => ENTITY_TO_CONTENT_TYPE[e as keyof typeof ENTITY_TO_CONTENT_TYPE] !== undefined) && Object.keys(ENTITY_TO_CONTENT_TYPE).length === Object.keys(TRANSLATABLE_FIELDS).length);
t("translations: ADMIN_TRANSLATION_ENTITY and its inverse agree", Object.entries(ADMIN_TRANSLATION_ENTITY).every(([type, entity]) => ENTITY_TO_CONTENT_TYPE[entity!] === type));
t("translations: DRIFT GUARD — a length cap exists for EXACTLY the allow-listed fields of every entity", Object.entries(TRANSLATABLE_FIELDS).every(([e, fields]) => { const caps = ADMIN_TRANSLATION_MAX[e as keyof typeof ADMIN_TRANSLATION_MAX]; return Object.keys(caps).sort().join() === [...fields].sort().join() && Object.values(caps).every((n) => n > 0); }));
t("translations: DRIFT GUARD — every translatable field is a searchable column of its content adapter", Object.entries(TRANSLATABLE_FIELDS).every(([e, fields]) => { const def = contentDef(ENTITY_TO_CONTENT_TYPE[e as keyof typeof ENTITY_TO_CONTENT_TYPE]); return fields.every((f) => def.textFields.includes(f)) && def.entity === e; }));
const tq = (o: Record<string, unknown>) => adminTranslationsQuerySchema.safeParse(o);
t("translations query: type must be a translatable entity (exact case, own properties only)", tq({ type: "NEWS_ITEM" }).success && !tq({ type: "FORUM_CATEGORY" }).success && !tq({ type: "news_item" }).success && !tq({ type: "constructor" }).success && !tq({ type: "__proto__" }).success && !tq({}).success);
t("translations query: state / paging validated", tq({ type: "EVENT", state: "missing" }).success && !tq({ type: "EVENT", state: "x" }).success && !tq({ type: "EVENT", page: "0" }).success && !tq({ type: "EVENT", limit: "101" }).success);
const ut = (o: unknown) => updateTranslationSchema.safeParse(o);
t("translation body: text, '' or null value; field required", ut({ field: "title", value: "x" }).success && ut({ field: "title", value: "" }).success && ut({ field: "title", value: null }).success && !ut({ field: "title" }).success && !ut({ value: "x" }).success && !ut({ field: "title", value: 5 }).success && !ut({ field: "", value: "x" }).success);

// ---- audit / files / link ---------------------------------------------------------------------------------------------
const aq = (o: Record<string, unknown>) => adminAuditQuerySchema.safeParse(o);
t("audit query: defaults; action/entityType are UPPER_SNAKE only", aq({}).success && aq({ action: "ROLE_CHANGED", entityType: "USER" }).success && !aq({ action: "role_changed" }).success && !aq({ action: "A;B" }).success && !aq({ entityType: "<x>" }).success && !aq({ action: "A".repeat(61) }).success);
t("audit query: dates, range, paging, actor length", aq({ from: "2030-01-01", to: "2030-01-31" }).success && !aq({ from: "2030-02-30" }).success && !aq({ from: "2030-02-01", to: "2030-01-01" }).success && !aq({ page: "0" }).success && !aq({ limit: "101" }).success && !aq({ actor: "a".repeat(101) }).success && !aq({ action: ["A", "B"] }).success);
t("files query: visibility/category enums and paging", adminFilesQuerySchema.safeParse({ visibility: "PUBLIC", category: "EVENT" }).success && !adminFilesQuerySchema.safeParse({ visibility: "PRIVATE" }).success && !adminFilesQuerySchema.safeParse({ category: "X" }).success && !adminFilesQuerySchema.safeParse({ limit: "0" }).success);
t("link body: id or null only", linkAccountSchema.safeParse({ teamMemberId: "abc" }).success && linkAccountSchema.safeParse({ teamMemberId: null }).success && !linkAccountSchema.safeParse({}).success && !linkAccountSchema.safeParse({ teamMemberId: "" }).success && !linkAccountSchema.safeParse({ teamMemberId: 5 }).success && !linkAccountSchema.safeParse({ teamMemberId: "../x" }).success);

// ---- bulk target table -----------------------------------------------------------------------------------------------------
t("bulk targets: exactly one target per visibility-bearing type", Object.keys(VISIBILITY_TARGETS).sort().join() === [...ADMIN_VISIBILITY_TYPES].sort().join());
t("bulk targets: each writes the entity's own UPDATED audit action and entity type", Object.values(VISIBILITY_TARGETS).every((x) => /_UPDATED$/.test(x.action) && /^[A-Z_]+$/.test(x.entityType)));

// ---- text-search WHERE builder (no database for a type without translations) ----------------------------------------------------
{
  // Publications have Japanese overrides since Phase 19, so this exercises the builder with the override lookup switched off.
  const pub = { ...contentDef("publication"), entity: undefined };
  t("textWhere: no words -> no clause", (await textWhere(pub, [])) === null);
  const w = (await textWhere(pub, ["deep", "learning"])) as { AND: { OR: Record<string, { contains: string }>[] }[] };
  t("textWhere: one OR-group per word, AND-ed, plain `contains` on every text column", w.AND.length === 2 && w.AND.every((g, i) => g.OR.length === pub.textFields.length && g.OR.every((c) => Object.values(c)[0].contains === ["deep", "learning"][i])));
  t("textWhere: no raw SQL fragment, no `mode`, no wildcard characters are ever added", !JSON.stringify(w).match(/raw|mode|%|_/));
}

// ---- audit convention for the new actions -----------------------------------------------------------------------------------------------
{
  const rows: { action: string; details: string | null }[] = [];
  const db = { auditLog: { create: async ({ data }: { data: { action: string; details: string | null } }) => void rows.push(data) } } as never;
  const actor = { id: "u", email: "a@b.c" };
  await recordAudit(db, { actor, action: "USER_LINKED", entityType: "USER", entityId: "x", details: { email: "a@b.c", teamMemberId: "t" } });
  await recordAudit(db, { actor, action: "TRANSLATIONS_CHANGED", entityType: "NEWS_ITEM", entityId: "x", details: { locale: "ja", fields: "title", cleared: false } });
  await recordAudit(db, { actor, action: "NEWS_UPDATED", entityType: "NEWS_ITEM", entityId: "x", details: { title: "T", changed: "visibility", bulk: true } });
  t("audit: the new details keys are accepted and stored flat", rows.length === 3 && rows.every((r) => r.details && typeof JSON.parse(r.details) === "object"));
  let refused = 0;
  for (const key of ["translationValue_body", "message", "password", "token", "content"]) {
    try {
      await recordAudit(db, { actor, action: "TRANSLATIONS_CHANGED", entityType: "NEWS_ITEM", details: { [key]: "x" } });
    } catch {
      refused++;
    }
  }
  t("audit: secret-looking keys are still refused (tripwire intact)", refused === 5);
}

// ---- policy spot-checks (the full matrix lives in unit-policy.test.ts) ----------------------------------------------------------------
{
  const P = await import("@scl/shared");
  t("policy: a manager reaches the admin area but not accounts or account audit", P.canAccessAdmin(A("LAB_MANAGER")) && !P.canManageUsers(A("LAB_MANAGER")) && !P.canViewAccountAudit(A("LAB_MANAGER")) && !P.canLinkAccounts(A("LAB_MANAGER")));
  t("policy: nobody can change their own role, admin included", P.roleChangeError(A("ADMIN"), "u1") !== null && P.roleChangeError(A("LAB_MANAGER"), "u2") !== null && P.roleChangeError(A("ADMIN"), "u2") === null);
  t("policy: a guest gets nothing", [P.canAccessAdmin, P.canViewAuditLog, P.canManageTranslations, P.canBulkChangeVisibility, P.canLinkAccounts].every((f) => !f(null)));
}

console.log(`${ok} admin unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
process.exit(0);
