/**
 * Unit test of the pure parts of the publication knowledge hub (Phase 19): the browse query schema
 * (every malformed value is rejected, none silently ignored), the create/update schemas with the
 * Japanese title/venue override, the translatable-field allow-list entry, dictionary parity for the new
 * keys, the audit convention, and static guards that keep the hub read code on the ONE visibility
 * fragment (`visibleTo`), free of raw SQL, free of account ids, and free of inline role checks.
 * No server, no database.
 *   npm run test:unit -w apps/server
 */
process.env.DATABASE_URL ??= "file:./unused.db";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ADMIN_TRANSLATION_ENTITY,
  ADMIN_TRANSLATION_MAX,
  PUBLICATION_DEFAULT_LIMIT,
  PUBLICATION_MAX_LIMIT,
  PUBLICATION_SORTS,
  PUBLICATION_TRANSLATION_MAX,
  TRANSLATABLE_FIELDS,
  canDeleteContent,
  canEditContent,
  createPublicationSchema,
  en,
  isTranslatableEntityType,
  ja,
  publicationListQuerySchema,
  updatePublicationSchema,
  type Actor,
} from "@scl/shared";
import { recordAudit } from "../src/lib/audit.js";
import { visibleTo } from "../src/lib/visibility.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));
const A = (role: Actor["role"], id = "u1"): Actor => ({ id, role });
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, "..", "src", p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const q = (o: Record<string, unknown>) => publicationListQuerySchema.safeParse(o);
const ID = "cmu6xrfol0008di7rm14ikwui";

// ---- browse query: defaults and accepted values ------------------------------------------------------------
{
  const r = q({});
  t("browse query: everything is optional (an empty query is valid)", r.success);
  t("browse query: no filter is invented for an empty query", r.success && r.data.year === undefined && r.data.researcher === undefined && r.data.project === undefined && r.data.area === undefined && r.data.group === undefined && r.data.visibility === undefined && r.data.sort === undefined && r.data.page === undefined);
  t("browse query: every filter is accepted when well formed", q({ year: "2026", researcher: ID, project: ID, area: ID, group: ID, visibility: "LAB_ONLY", sort: "title", page: "2", limit: "10", q: "deep learning" }).success);
  t("browse query: blank values mean 'not set' (a form submits empty selects)", q({ year: "", researcher: "", project: "", area: "", group: "", visibility: "", sort: "", page: "" }).success);
  const w = q({ q: "  Deep   learning " });
  t("browse query: text is parsed with the global search's own word rules", w.success && w.data.q.terms.join(" ").toLowerCase() === "deep learning");
  t("browse query: % and _ are word separators, never wildcards (Prisma cannot escape them)", (() => { const p = q({ q: "100%_sure" }); return p.success && p.data.q.terms.every((x) => !/[%_]/.test(x)); })());
}

// ---- browse query: everything malformed is a rejection -----------------------------------------------------
for (const [name, bad] of [
  ["a non-numeric year", { year: "abc" }],
  ["a year with junk", { year: "2026abc" }],
  ["a year below the minimum", { year: "1899" }],
  ["a year above the maximum", { year: "2101" }],
  ["a negative year", { year: "-2026" }],
  ["an exponent year", { year: "2e3" }],
  ["a decimal year", { year: "2026.5" }],
  ["page 0", { page: "0" }],
  ["a negative page", { page: "-1" }],
  ["a decimal page", { page: "1.5" }],
  ["a huge page", { page: "99999999" }],
  ["limit 0", { limit: "0" }],
  ["limit above the maximum", { limit: String(PUBLICATION_MAX_LIMIT + 1) }],
  ["an exponent limit", { limit: "1e2" }],
  ["an unknown sort", { sort: "random" }],
  ["a sort with different case", { sort: "NEWEST" }],
  ["an unknown visibility", { visibility: "PRIVATE" }],
  ["a lower-case visibility", { visibility: "public" }],
  ["a project id with a slash", { project: "../etc/passwd" }],
  ["a group id with spaces", { group: "a b" }],
  ["an area id with a quote", { area: "a'b" }],
  ["a researcher id with a semicolon", { researcher: "a;drop table" }],
  ["an id longer than 64 characters", { researcher: "a".repeat(65) }],
  ["search text longer than 100 characters", { q: "x".repeat(101) }],
  ["search text with more than 8 words", { q: "a b c d e f g h i" }],
  ["a non-text search value", { q: { $ne: "" } }],
  ["an object where a year is expected", { year: { a: 1 } }],
] as const) {
  t(`browse query rejects ${name}`, !q(bad as Record<string, unknown>).success);
}
t("browse query: a repeated parameter (an array) uses the last value, never a coerced list", (() => { const p = q({ year: ["2020", "2026"] }); return p.success && p.data.year === 2026; })());
t("browse query: prototype-pollution keys are ignored, not applied", (() => { const p = q(JSON.parse('{"__proto__":{"year":"2026"},"constructor":"x"}')); return p.success && p.data.year === undefined; })());
t("sorts are exactly newest / oldest / title, and paging limits are the documented ones", PUBLICATION_SORTS.join() === "newest,oldest,title" && PUBLICATION_DEFAULT_LIMIT === 20 && PUBLICATION_MAX_LIMIT === 50);

// ---- create / update schemas -------------------------------------------------------------------------------
const base = { year: 2026, title: "T", authors: "A", venue: "V" };
t("create: the existing fields still validate", createPublicationSchema.safeParse(base).success);
t("create: a Japanese title/venue override is accepted", createPublicationSchema.safeParse({ ...base, translations: { ja: { title: "題", venue: "会場" } } }).success);
t("create: an override over the field cap is rejected (title and venue)", !createPublicationSchema.safeParse({ ...base, translations: { ja: { title: "あ".repeat(PUBLICATION_TRANSLATION_MAX.title + 1) } } }).success && !createPublicationSchema.safeParse({ ...base, translations: { ja: { venue: "あ".repeat(PUBLICATION_TRANSLATION_MAX.venue + 1) } } }).success);
t("create: an override of a field that is not translatable (authors, year, visibility) is dropped, never stored", (() => { const p = createPublicationSchema.safeParse({ ...base, translations: { ja: { title: "題", authors: "偽", visibility: "PUBLIC", year: "1" } } }); return p.success && JSON.stringify(p.data.translations) === JSON.stringify({ ja: { title: "題" } }); })());
t("update: only translations is a valid non-empty update", updatePublicationSchema.safeParse({ translations: { ja: { title: "題" } } }).success && !updatePublicationSchema.safeParse({}).success);
t("update: null or empty clears an override (allowed shapes)", updatePublicationSchema.safeParse({ translations: { ja: { title: null, venue: "" } } }).success);

// ---- the allow-list, admin maps, dictionaries -----------------------------------------------------------------
t("PUBLICATION is translatable with exactly title and venue (authors, links, year, visibility are never translated)", isTranslatableEntityType("PUBLICATION") && [...TRANSLATABLE_FIELDS.PUBLICATION].join() === "title,venue");
t("admin maps: the content type maps to PUBLICATION and a cap exists for exactly its fields", ADMIN_TRANSLATION_ENTITY.publication === "PUBLICATION" && Object.keys(ADMIN_TRANSLATION_MAX.PUBLICATION).sort().join() === "title,venue" && ADMIN_TRANSLATION_MAX.PUBLICATION.title === 500);
{
  const keys = Object.keys(en) as (keyof typeof en)[];
  const newKeys = keys.filter((k) => /^publications\.(hub|detail|form)\./.test(k) || k === "adm.field.venue" || k === "adm.tr.type.PUBLICATION");
  t("dictionaries: the new publication keys exist in both languages", newKeys.length >= 50 && newKeys.every((k) => typeof (ja as Record<string, string>)[k] === "string" && (ja as Record<string, string>)[k].length > 0));
  t("dictionaries: no new Japanese value is an untranslated copy of the English one", newKeys.filter((k) => !/^adm\.tr\.type|^publications\.hub\.(resultsOne|resultsOther)$/.test(k)).every((k) => (ja as Record<string, string>)[k] !== en[k]));
  t("dictionaries: placeholders match between languages for every new key", newKeys.every((k) => (en[k].match(/\{\w+\}/g) ?? []).sort().join() === (((ja as Record<string, string>)[k]).match(/\{\w+\}/g) ?? []).sort().join()));
}

// ---- permissions the detail flags come from ------------------------------------------------------------------
t("detail flags: any signed-in account may edit, only a manager or admin may delete, a guest neither", canEditContent(A("MEMBER")) && !canEditContent(null) && !canDeleteContent(A("MEMBER")) && canDeleteContent(A("LAB_MANAGER")) && canDeleteContent(A("ADMIN")) && !canDeleteContent(null));
t("visibleTo: a guest sees PUBLIC only; a signed-in viewer both known values", JSON.stringify(visibleTo(null)) === JSON.stringify({ visibility: { in: ["PUBLIC"] } }) && JSON.stringify(visibleTo(A("MEMBER"))) === JSON.stringify({ visibility: { in: ["PUBLIC", "LAB_ONLY"] } }));

// ---- audit convention: field names, never content -------------------------------------------------------------
{
  const rows: { action: string; details: string | null }[] = [];
  const db = { auditLog: { create: async ({ data }: { data: { action: string; details: string | null } }) => void rows.push(data) } } as never;
  await recordAudit(db, { actor: { id: "u", email: "a@b.c" }, action: "TRANSLATIONS_CHANGED", entityType: "PUBLICATION", entityId: "x", details: { locale: "ja", fields: "title,venue" } });
  t("audit: a publication translation change is recorded with field names and the locale only", rows.length === 1 && rows[0].action === "TRANSLATIONS_CHANGED" && /"fields":"title,venue"/.test(rows[0].details ?? "") && !/[぀-ヿ一-鿿]/.test(rows[0].details ?? ""));
  let refused = false;
  try {
    await recordAudit(db, { actor: { id: "u", email: "a@b.c" }, action: "PUBLICATION_UPDATED", entityType: "PUBLICATION", entityId: "x", details: { content: "secret text" } as never });
  } catch {
    refused = true;
  }
  t("audit: the forbidden-key tripwire still refuses a content-style detail on a publication row", refused && rows.length === 1);
}

// ---- static guards over the hub read code ---------------------------------------------------------------------
{
  const hub = strip(src("lib/publicationHub.ts"));
  t("static: the hub reads through visibleTo(viewer) and never spells a visibility literal", hub.includes("visibleTo(viewer)") && !/["'`](PUBLIC|LAB_ONLY)["'`]/.test(hub));
  t("static: the hub has no raw SQL", !/\$queryRaw|\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe/.test(hub));
  t("static: the hub never selects or serialises an account id (userId) or an email", !/userId|email/i.test(hub));
  t("static: the browse WHERE starts from the fragment, the year facet and the detail read apply it too", /const and: Prisma\.PublicationWhereInput\[\] = \[visible\]/.test(hub) && /findMany\(\{ where: visible, select: \{ year: true \}/.test(hub) && /findFirst\(\{\s*where: \{ id, \.\.\.visible \}/.test(hub));
  t("static: a linked project / area / group is filtered IN the query (where: { project: visible } and researchArea: visible)", /where: \{ project: visible \}/.test(hub) && /where: \{ researchArea: visible \}/.test(hub) && /group: visible/.test(hub) && /researchArea: visible/.test(hub));
  t("static: a linked group is only returned when canView passes (its visibility is not selected into the response)", /canView\(viewer, p\.group\.visibility\)/.test(hub));
  t("static: ordering always ends in id (deterministic pages)", (hub.match(/\{ id: "asc" \}/g) ?? []).length >= 3);
  t("static: no inline role comparison in the hub or the publication routes (policy stays central)", !/role\s*===?\s*["'](ADMIN|LAB_MANAGER|MEMBER)["']/.test(hub + strip(src("routes/publications.routes.ts"))));
  const routes = strip(src("routes/publications.routes.ts"));
  t("static: /browse is registered before /:id (otherwise 'browse' would be read as an id)", routes.indexOf('"/browse"') > -1 && routes.indexOf('"/browse"') < routes.indexOf('"/:id"'));
  t("static: the visibility filter of /browse is gated by the central policy, not a role string", /canChangeVisibility\(viewer\)/.test(routes));
  t("static: deleting a publication also deletes its Translation rows", /translation\.deleteMany\(\{ where: \{ entityType: "PUBLICATION"/.test(routes));
  const search = strip(src("lib/search.ts"));
  t("static: the search result for a publication links to its detail page and is translatable", /href: `\/publications\/\$\{r\.id\}`/.test(search) && /translatable: "PUBLICATION"/.test(search));
}

console.log(`${ok} publication unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
process.exit(0);
