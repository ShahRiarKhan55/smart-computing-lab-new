/**
 * Unit test of the pure parts of the research knowledge base (Phase 22): the shared request/query schemas,
 * the category allow-list, the central permission functions, the serializer's visibility behaviour (English
 * path, against plain rows), the where-builders, the admin/search/translation registrations and the i18n
 * dictionaries. No server, no database.   npm run test:unit -w apps/server
 */
import {
  ADMIN_CONTENT_TYPES,
  ADMIN_TRANSLATION_ENTITY,
  ADMIN_TRANSLATION_MAX,
  KNOWLEDGE_BODY_MAX,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_CATEGORY_LABELS,
  KNOWLEDGE_LIST_DEFAULT_LIMIT,
  KNOWLEDGE_LIST_MAX_LIMIT,
  KNOWLEDGE_SECTION_LIMIT,
  KNOWLEDGE_TITLE_MAX,
  KNOWLEDGE_TRANSLATION_MAX,
  SEARCH_TYPES,
  TRANSLATABLE_FIELDS,
  WORKSPACE_LIMITS,
  adminContentQuerySchema,
  canCreateKnowledge,
  canDeleteKnowledge,
  canEditKnowledge,
  canFilterKnowledgeByVisibility,
  createKnowledgeSchema,
  en,
  hasVisibility,
  ja,
  knowledgeExcerpt,
  knowledgeListQuerySchema,
  updateKnowledgeSchema,
} from "@scl/shared";
import { knowledgeInclude, knowledgeOrderBy, knowledgeWhere, researcherScope, serializeKnowledge, type KnowledgeRow } from "../src/lib/knowledge.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

const valid = (over: Record<string, unknown> = {}) => createKnowledgeSchema.safeParse({ title: "Setup notes", body: "How to set up the board.", ...over });
const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? "" : (r.error?.issues[0]?.message ?? ""));

// ---- category allow-list -------------------------------------------------------------------
t("ten categories, the documented ones, in order", KNOWLEDGE_CATEGORIES.join() === "PROJECT_DOCUMENTATION,RESEARCH_NOTE,METHODOLOGY,EXPERIMENT,HARDWARE,SOFTWARE,DATASET,REPRODUCIBILITY,LAB_PROCEDURE,RESOURCE");
t("every category has an English label", KNOWLEDGE_CATEGORIES.every((c) => typeof KNOWLEDGE_CATEGORY_LABELS[c] === "string" && KNOWLEDGE_CATEGORY_LABELS[c].length > 0) && Object.keys(KNOWLEDGE_CATEGORY_LABELS).length === KNOWLEDGE_CATEGORIES.length);
t("every category has an en AND a ja UI label, and the ja one is not the English one", KNOWLEDGE_CATEGORIES.every((c) => {
  const key = `knowledge.category.${c}` as keyof typeof en;
  return typeof en[key] === "string" && typeof ja[key] === "string" && ja[key].length > 0 && ja[key] !== en[key];
}));

// ---- create schema --------------------------------------------------------------------------
const base = valid();
t("create: a title and a body are enough", base.success);
t("create: defaults are category RESOURCE, no visibility, no links", base.success && base.data.category === "RESOURCE" && base.data.visibility === undefined && base.data.projectId === undefined && base.data.researchAreaId === undefined && base.data.groupId === undefined && base.data.teamMemberId === undefined);
t("create: text is trimmed", (valid({ title: "  Notes  ", body: "  text  " }) as { data: { title: string; body: string } }).data.title === "Notes" && (valid({ body: "  text  " }) as { data: { body: string } }).data.body === "text");
t("create: title is required, blank rejected, message is the allow-listed one", !createKnowledgeSchema.safeParse({ body: "b" }).success && msg(createKnowledgeSchema.safeParse({ body: "b" })) === "Title is required." && !valid({ title: "   " }).success);
t("create: body is required, empty and blank rejected, message is the allow-listed one", msg(createKnowledgeSchema.safeParse({ title: "t" })) === "Body is required." && !valid({ body: "  " }).success && !valid({ body: "" }).success && msg(valid({ body: "" })) === "Body is required.");
t("create: title 200 ok / 201 rejected", valid({ title: "x".repeat(KNOWLEDGE_TITLE_MAX) }).success && !valid({ title: "x".repeat(KNOWLEDGE_TITLE_MAX + 1) }).success);
t("create: body 20000 ok / 20001 rejected, with the allow-listed message", valid({ body: "x".repeat(KNOWLEDGE_BODY_MAX) }).success && msg(valid({ body: "x".repeat(KNOWLEDGE_BODY_MAX + 1) })) === "Body must be at most 20000 characters.");
t("create: non-string title/body rejected, not coerced", !valid({ title: 5 }).success && !valid({ body: { a: 1 } }).success && !valid({ title: ["t"] }).success);
t("create: every category accepted", KNOWLEDGE_CATEGORIES.every((c) => valid({ category: c }).success));
t("create: unknown / mis-cased / hostile / non-string category rejected", ["method", "methodology", "Methodology", "'; DROP TABLE KnowledgeDoc; --", "<script>alert(1)</script>", "", "RESOURCE ", 1, null, ["RESOURCE"], {}].every((c) => !valid({ category: c }).success));
t("create: the category error message is the allow-listed one", msg(valid({ category: "nope" })) === `Category must be one of: ${KNOWLEDGE_CATEGORIES.join(", ")}.`);
t("create: visibility must be PUBLIC or LAB_ONLY", valid({ visibility: "PUBLIC" }).success && valid({ visibility: "LAB_ONLY" }).success && !valid({ visibility: "SECRET" }).success && !valid({ visibility: "PRIVATE" }).success);
t("create: link ids must look like ids; null is allowed", ["projectId", "researchAreaId", "groupId", "teamMemberId"].every((k) => valid({ [k]: "abc_123-X" }).success && valid({ [k]: null }).success && !valid({ [k]: "a b" }).success && !valid({ [k]: "../x" }).success && !valid({ [k]: 5 }).success));
t("create: unknown keys (authorId, id, createdAt) are stripped, never accepted", (() => {
  const r = valid({ authorId: "someone", id: "x", createdAt: "2001-01-01" }) as { data: Record<string, unknown> };
  return r.data.authorId === undefined && r.data.id === undefined && r.data.createdAt === undefined;
})());
t("create: translations accept ja title/body, null/'' clear, and cap their length", valid({ translations: { ja: { title: "題", body: "本文" } } }).success && valid({ translations: { ja: { title: null, body: "" } } }).success && !valid({ translations: { ja: { title: "あ".repeat(201) } } }).success && !valid({ translations: { ja: { body: "あ".repeat(20001) } } }).success);
t("create: an unknown translation field is stripped", (() => {
  const r = valid({ translations: { ja: { title: "x", visibility: "PUBLIC", evil: "y" } } }) as { data: { translations: { ja: Record<string, unknown> } } };
  return Object.keys(r.data.translations.ja).join() === "title";
})());
t("KNOWLEDGE_TRANSLATION_MAX mirrors the English caps and the allow-list fields", KNOWLEDGE_TRANSLATION_MAX.title === 200 && KNOWLEDGE_TRANSLATION_MAX.body === 20000 && Object.keys(KNOWLEDGE_TRANSLATION_MAX).join() === TRANSLATABLE_FIELDS.KNOWLEDGE_DOC.join());

// ---- update schema --------------------------------------------------------------------------
t("update: an empty object is 'Nothing to update.'", msg(updateKnowledgeSchema.safeParse({})) === "Nothing to update.");
t("update: any single field is enough", updateKnowledgeSchema.safeParse({ title: "x" }).success && updateKnowledgeSchema.safeParse({ projectId: null }).success && updateKnowledgeSchema.safeParse({ translations: { ja: { body: "x" } } }).success);
t("update: a blank / empty title or body is rejected", !updateKnowledgeSchema.safeParse({ title: "" }).success && !updateKnowledgeSchema.safeParse({ body: "  " }).success && !updateKnowledgeSchema.safeParse({ body: "" }).success);
t("bounds: 5 documents on a research page / in the workspace, at most 50 per list page, 12 by default", KNOWLEDGE_SECTION_LIMIT === 5 && WORKSPACE_LIMITS.knowledge === 5 && KNOWLEDGE_LIST_MAX_LIMIT === 50 && KNOWLEDGE_LIST_DEFAULT_LIMIT === 12);
t("update: a bad category / visibility / link is rejected", !updateKnowledgeSchema.safeParse({ category: "x" }).success && !updateKnowledgeSchema.safeParse({ visibility: "x" }).success && !updateKnowledgeSchema.safeParse({ groupId: "a b" }).success);

// ---- list query -----------------------------------------------------------------------------
const q = (o: Record<string, unknown> = {}) => knowledgeListQuerySchema.safeParse(o);
const qd = (o: Record<string, unknown> = {}) => (q(o) as { data: ReturnType<typeof knowledgeListQuerySchema.parse> }).data;
t("list: defaults are page 1, limit 12, no filters", q().success && qd().page === 1 && qd().limit === 12 && qd().category === undefined && qd().mine === false && qd().q.terms.length === 0);
t("list: page and limit are bounded whole numbers", q({ page: "3", limit: "50" }).success && qd({ page: "3", limit: "50" }).limit === KNOWLEDGE_LIST_MAX_LIMIT && ["0", "-1", "abc", "1.5", "10001", " 1", "1e2"].every((p) => !q({ page: p }).success) && ["0", "51", "abc", "-3", "1.5"].every((l) => !q({ limit: l }).success));
t("list: empty-string filters mean 'no filter'", qd({ category: "", project: "", area: "", group: "", researcher: "", visibility: "", mine: "", q: "" }).category === undefined && qd({ project: "" }).project === undefined);
t("list: category must be a real category", qd({ category: "METHODOLOGY" }).category === "METHODOLOGY" && !q({ category: "methodology" }).success && !q({ category: "x'; --" }).success);
t("list: id filters must look like ids", qd({ project: "abc_1" }).project === "abc_1" && ["project", "area", "group", "researcher"].every((k) => !q({ [k]: "a b" }).success && !q({ [k]: "../x" }).success));
t("list: visibility must be PUBLIC or LAB_ONLY", qd({ visibility: "PUBLIC" }).visibility === "PUBLIC" && !q({ visibility: "SECRET" }).success);
t("list: mine is '1' or nothing", qd({ mine: "1" }).mine === true && !q({ mine: "2" }).success && !q({ mine: "true" }).success);
t("list: q is split by the search parser ('%' and '_' separate words), and 100 chars / 8 words are the limits", qd({ q: "fpga %board" }).q.terms.join() === "fpga,board" && qd({ q: "%_%" }).q.terms.length === 0 && q({ q: "a".repeat(100) }).success && !q({ q: "a".repeat(101) }).success && !q({ q: "a b c d e f g h i" }).success);
t("list: a non-string q / page is rejected", !q({ q: 5 }).success && !q({ page: 5 }).success);

// ---- excerpt --------------------------------------------------------------------------------
t("excerpt: short text is unchanged, whitespace collapsed", knowledgeExcerpt("a\n\n  b\tc") === "a b c");
t("excerpt: long text is cut with an ellipsis and never exceeds max+1", knowledgeExcerpt("x".repeat(500)).length === 201 && knowledgeExcerpt("x".repeat(500)).endsWith("…"));
t("excerpt: Japanese text is cut by characters", knowledgeExcerpt("あ".repeat(300)).length === 201);
t("excerpt: markup is not interpreted (returned as plain text)", knowledgeExcerpt("<script>alert(1)</script>") === "<script>alert(1)</script>");

// ---- permissions (also in unit-policy) -----------------------------------------------------------
const member = { id: "m", role: "MEMBER" as const };
const manager = { id: "g", role: "LAB_MANAGER" as const };
const admin = { id: "a", role: "ADMIN" as const };
t("permissions: guest can do nothing", !canCreateKnowledge(null) && !canEditKnowledge(null, true) && !canDeleteKnowledge(null, true) && !canFilterKnowledgeByVisibility(null));
t("permissions: a member creates and edits/deletes only their own", canCreateKnowledge(member) && canEditKnowledge(member, true) && !canEditKnowledge(member, false) && canDeleteKnowledge(member, true) && !canDeleteKnowledge(member, false) && !canFilterKnowledgeByVisibility(member));
t("permissions: managers and admins edit/delete anything and filter by visibility", [manager, admin].every((a) => canEditKnowledge(a, false) && canDeleteKnowledge(a, false) && canFilterKnowledgeByVisibility(a)));
t("permissions: an unknown role is only 'logged in' (owner edits nothing extra)", (() => {
  const rogue = { id: "r", role: "SUPERUSER" as never };
  return !canEditKnowledge(rogue, false) && !canFilterKnowledgeByVisibility(rogue);
})());

// ---- serializer (English: no translation lookups, no database) -------------------------------------
const now = new Date("2030-01-02T03:04:05.000Z");
const row = (over: Partial<KnowledgeRow> = {}): KnowledgeRow =>
  ({
    id: "d1",
    title: "Setup notes",
    body: "Line one\nLine two",
    category: "METHODOLOGY",
    visibility: "PUBLIC",
    authorId: "u-author",
    projectId: "p1",
    researchAreaId: "a1",
    groupId: "g1",
    teamMemberId: "t1",
    createdAt: now,
    updatedAt: now,
    author: { teamMember: { id: "tm-author", name: "Ada" } },
    project: { id: "p1", title: "Hidden Project", visibility: "LAB_ONLY" },
    researchArea: { id: "a1", title: "Public Area", visibility: "PUBLIC" },
    group: { id: "g1", name: "Hidden Group", visibility: "LAB_ONLY" },
    teamMember: { id: "t1", name: "Grace" },
    ...over,
  }) as KnowledgeRow;

async function main() {
  const guest = null;
  const [g] = await serializeKnowledge([row()], guest, "en");
  t("serialize: a guest is never given a LAB_ONLY project or group (nor its title)", g.project === null && g.group === null && !JSON.stringify(g).includes("Hidden"));
  t("serialize: a PUBLIC area and the researcher ARE shown to a guest", g.researchArea?.title === "Public Area" && g.researcher?.name === "Grace");
  t("serialize: a list item carries an excerpt and no body", g.excerpt === "Line one Line two" && !("body" in g));
  t("serialize: a guest gets no `visibility`", !("visibility" in g));
  t("serialize: no account id anywhere (only the public team profile)", !JSON.stringify(g).includes("u-author") && g.author?.id === "tm-author");
  const [m] = await serializeKnowledge([row()], member, "en");
  t("serialize: a signed-in member sees the LAB_ONLY project and group", m.project?.title === "Hidden Project" && m.group?.title === "Hidden Group");
  t("serialize: a member gets no `visibility`", !("visibility" in m));
  const [mgr] = await serializeKnowledge([row()], manager, "en");
  t("serialize: a manager gets `visibility`", mgr.visibility === "PUBLIC");
  const [odd] = await serializeKnowledge([row({ project: { id: "p1", title: "Weird", visibility: "PRIVATE" } as KnowledgeRow["project"] })], manager, "en");
  t("serialize: a relation whose visibility is outside the allow-list is hidden from EVERYONE (fail closed)", odd.project === null);
  const [detail] = await serializeKnowledge([row()], member, "en", true);
  t("serialize: detail carries the full body, line breaks intact", detail.body === "Line one\nLine two");
  const [bad] = await serializeKnowledge([row({ category: "hax" })], guest, "en");
  t("serialize: a stored category outside the allow-list falls back to RESOURCE", bad.category === "RESOURCE");
  const [own] = await serializeKnowledge([row()], { id: "u-author", role: "MEMBER" }, "en");
  const [other] = await serializeKnowledge([row()], member, "en");
  t("serialize: canEdit/canDelete follow ownership (author id === viewer id), never the client", own.canEdit && own.canDelete && !other.canEdit && !other.canDelete);
  const [orphan] = await serializeKnowledge([row({ authorId: null, author: null })], { id: "u-author", role: "MEMBER" }, "en");
  t("serialize: a document whose author account was deleted has no owner and no author", orphan.author === null && !orphan.canEdit);
  const [orphanMgr] = await serializeKnowledge([row({ authorId: null, author: null })], manager, "en");
  t("serialize: ...but a manager can still edit it", orphanMgr.canEdit && orphanMgr.canDelete);
  const [noProfile] = await serializeKnowledge([row({ author: { teamMember: null } } as Partial<KnowledgeRow>)], guest, "en");
  t("serialize: an author with no team profile is shown as no author", noProfile.author === null);
  const many = await serializeKnowledge([row({ id: "d1" }), row({ id: "d2" }), row({ id: "d3" })], guest, "en");
  t("serialize: output keeps the input order", many.map((x) => x.id).join() === "d1,d2,d3");
  t("serialize: an empty list is an empty list", (await serializeKnowledge([], guest, "en")).length === 0);

  // ---- where / include / order -----------------------------------------------------------------------
  const parse = (o: Record<string, unknown>) => knowledgeListQuerySchema.parse(o);
  const gw = JSON.stringify(await knowledgeWhere(parse({}), null));
  t("where: a guest is limited to PUBLIC and nothing else", gw === '{"AND":[{"visibility":{"in":["PUBLIC"]}}]}');
  const mw = JSON.stringify(await knowledgeWhere(parse({}), member));
  t("where: an account sees PUBLIC and LAB_ONLY, never anything else", mw === '{"AND":[{"visibility":{"in":["PUBLIC","LAB_ONLY"]}}]}');
  const fw = JSON.stringify(await knowledgeWhere(parse({ project: "p1", area: "a1", group: "g1", researcher: "t1", category: "DATASET" }), null));
  t("where: a relation filter also demands the linked record be visible to the viewer", fw.includes('"projectId":"p1","project":{"visibility":{"in":["PUBLIC"]}}') && fw.includes('"researchAreaId":"a1","researchArea":{"visibility":{"in":["PUBLIC"]}}') && fw.includes('"groupId":"g1","group":{"visibility":{"in":["PUBLIC"]}}'));
  t("where: category and researcher filters are exact matches", fw.includes('"category":"DATASET"') && fw.includes('"teamMemberId":"t1"'));
  t("where: the visibility clause is ALWAYS first and always present", [gw, mw, fw].every((w) => w.startsWith('{"AND":[{"visibility":{"in":[')));
  t("include: only the public team profile of the author is selected (no email, no user id)", JSON.stringify(knowledgeInclude.author) === '{"select":{"teamMember":{"select":{"id":true,"name":true}}}}');
  t("order: most recently updated first, id breaks ties", JSON.stringify(knowledgeOrderBy) === '[{"updatedAt":"desc"},{"id":"asc"}]');
  t("researcherScope: a researcher with no profile only has what they wrote", researcherScope(member, null).length === 1);
  const scope = researcherScope(member, "tm1");
  t("researcherScope: a researcher's scope is authored + related-researcher + own/group/area projects + own groups + own areas", scope.length === 5 && JSON.stringify(scope[0]) === '{"authorId":"m"}' && JSON.stringify(scope[1]) === '{"teamMemberId":"tm1"}');
  t("researcherScope: every related project/group/area must itself be visible to the viewer", JSON.stringify(scope).split('"visibility":{"in":["PUBLIC","LAB_ONLY"]}').length - 1 >= 6);

  // ---- registrations ----------------------------------------------------------------------------------
  t("search: 'knowledge' is the last search type (source order = type order)", SEARCH_TYPES[SEARCH_TYPES.length - 1] === "knowledge");
  t("translations: KNOWLEDGE_DOC translates title and body only", TRANSLATABLE_FIELDS.KNOWLEDGE_DOC.join() === "title,body");
  t("admin: knowledge is a content type with visibility and translations", (ADMIN_CONTENT_TYPES as readonly string[]).includes("knowledge") && hasVisibility("knowledge") && ADMIN_TRANSLATION_ENTITY.knowledge === "KNOWLEDGE_DOC" && ADMIN_TRANSLATION_MAX.KNOWLEDGE_DOC.body === 20000);
  const a = (o: Record<string, unknown>) => adminContentQuerySchema.safeParse({ type: "knowledge", ...o });
  t("admin query: category / project / area / group / owner apply to knowledge", a({ category: "DATASET", project: "p1", area: "a1", group: "g1", owner: "t1" }).success);
  t("admin query: a bad category or id is rejected", !a({ category: "nope" }).success && !a({ project: "a b" }).success && !a({ area: "../x" }).success && !a({ group: "a b" }).success);
  t("admin query: event-only filters do not apply to knowledge", !a({ kind: "SEMINAR" }).success && !a({ scope: "upcoming" }).success && !a({ status: "ACTIVE" }).success);
  t("admin query: the knowledge filters do not apply to other types", !adminContentQuerySchema.safeParse({ type: "news", category: "DATASET" }).success && !adminContentQuerySchema.safeParse({ type: "event", project: "p1" }).success && !adminContentQuerySchema.safeParse({ type: "project", area: "a1" }).success);
  t("admin query: owner still applies to events", adminContentQuerySchema.safeParse({ type: "event", owner: "t1" }).success && !adminContentQuerySchema.safeParse({ type: "news", owner: "t1" }).success);

  // ---- i18n -------------------------------------------------------------------------------------------
  const keys = Object.keys(en).filter((k) => k.startsWith("knowledge."));
  t("i18n: every knowledge.* key exists in ja, is non-empty, and keeps its {placeholders}", keys.length > 60 && keys.every((k) => {
    const e = (en as Record<string, string>)[k];
    const j = (ja as Record<string, string>)[k];
    const ph = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join();
    return typeof j === "string" && j.length > 0 && ph(e) === ph(j);
  }));
  t("i18n: the Japanese text is actually Japanese (no untranslated English copy) for prose keys", keys.filter((k) => !k.startsWith("knowledge.category.") && (en as Record<string, string>)[k].length > 12).every((k) => (ja as Record<string, string>)[k] !== (en as Record<string, string>)[k] && /[　-ヿ一-鿿]/.test((ja as Record<string, string>)[k])));
  t("i18n: the nav, search and admin labels exist in both languages", ["nav.knowledge", "search.type.knowledge", "search.filter.knowledge", "search.cta.knowledge", "adm.type.knowledge", "adm.ov.knowledge", "adm.tr.type.KNOWLEDGE_DOC", "adm.f.category", "adm.f.project", "adm.f.area", "adm.f.group"].every((k) => typeof (en as Record<string, string>)[k] === "string" && typeof (ja as Record<string, string>)[k] === "string"));

  console.log(`${ok} knowledge unit checks passed, ${failures.length} failed.`);
  if (failures.length) {
    for (const f of failures) console.log("  FAIL", f);
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
