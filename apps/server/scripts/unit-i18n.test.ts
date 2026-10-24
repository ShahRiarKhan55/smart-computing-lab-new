/**
 * Unit test of the pure parts of Phase 14 localization: the UI dictionary (packages/shared/src/i18n),
 * the `translate()` lookup/fallback/interpolation, the TRANSLATABLE_FIELDS allow-list, and the
 * `translationsField()` schema builder used by research/project/group/news/team's create/update
 * schemas. No server, no database.
 *   npm run test:unit -w apps/server
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DICTIONARIES,
  DEFAULT_LOCALE,
  LOCALES,
  TRANSLATABLE_FIELDS,
  isTranslatableEntityType,
  translate,
  translationsField,
  type TranslationKey,
} from "@scl/shared";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

// ---- dictionary shape ---------------------------------------------------------------
const enKeys = Object.keys(DICTIONARIES.en) as TranslationKey[];
const jaKeys = Object.keys(DICTIONARIES.ja);
t("en and ja define exactly the same set of keys (TypeScript enforces this too; this is the runtime proof)", enKeys.length === jaKeys.length && enKeys.every((k) => jaKeys.includes(k)));
t("every English value is non-empty", enKeys.every((k) => DICTIONARIES.en[k].length > 0));
t("every Japanese value is non-empty", enKeys.every((k) => DICTIONARIES.ja[k].length > 0));
t(
  "no Japanese value is left as a literal placeholder (equal to its own key, or the words 'TODO'/'undefined'/'null')",
  enKeys.every((k) => {
    const v = DICTIONARIES.ja[k];
    return v !== k && !/^(TODO|undefined|null)$/i.test(v.trim());
  }),
);
t("LOCALES is exactly ['en','ja'] (Phase 14 non-goal: no third language)", LOCALES.length === 2 && LOCALES.includes("en") && LOCALES.includes("ja"));
t("DEFAULT_LOCALE is English", DEFAULT_LOCALE === "en");

// ---- translate(): lookup, fallback, interpolation -----------------------------------
t("translate() returns the English string for the base locale", translate("en", "common.save") === "Save");
t("translate() returns the Japanese string for ja", translate("ja", "common.save") === "保存");
t("translate() substitutes a single {var}", translate("en", "footer.copyright", { year: 2030 }) === "© 2030 Smart Computing Lab. All rights reserved.");
t("translate() substitutes multiple distinct {vars}", translate("en", "admin.roleChanged", { email: "a@b.test", role: "admin" }) === "a@b.test is now admin.");
t(
  "translate() never returns undefined/null/empty for a real key, in either locale",
  enKeys.every((k) => !!translate("en", k) && !!translate("ja", k)),
);
t(
  "translate() falls back to English for an unsupported locale value (defensive; the type system should prevent this at every real call site, this is belt-and-suspenders)",
  translate("fr" as unknown as "en", "common.save") === "Save",
);

// ---- TRANSLATABLE_FIELDS allow-list ---------------------------------------------------
const KNOWN_TYPES = ["RESEARCH_AREA", "RESEARCH_PROJECT", "RESEARCH_GROUP", "NEWS_ITEM", "TEAM_MEMBER", "EVENT", "PUBLICATION", "KNOWLEDGE_DOC", "LAB_RESOURCE"];
t("TRANSLATABLE_FIELDS covers exactly the nine documented entity types (Phase 16 added EVENT, Phase 19 PUBLICATION, Phase 22 KNOWLEDGE_DOC, Phase 23 LAB_RESOURCE), no more, no less", Object.keys(TRANSLATABLE_FIELDS).sort().join() === [...KNOWN_TYPES].sort().join());
for (const type of KNOWN_TYPES) {
  t(`isTranslatableEntityType("${type}") is true`, isTranslatableEntityType(type));
  t(`${type} lists at least one field, and every field is a non-empty string`, TRANSLATABLE_FIELDS[type as keyof typeof TRANSLATABLE_FIELDS].length > 0 && TRANSLATABLE_FIELDS[type as keyof typeof TRANSLATABLE_FIELDS].every((f) => typeof f === "string" && f.length > 0));
}
t("isTranslatableEntityType rejects a real AuditEntityType that is NOT in the allow-list (e.g. FORUM_CATEGORY, USER)", !isTranslatableEntityType("FORUM_CATEGORY") && !isTranslatableEntityType("USER"));
t("structural fields never appear in the allow-list (id/slug/sortOrder/visibility/groupId)", Object.values(TRANSLATABLE_FIELDS).every((fields) => !fields.some((f) => ["id", "slug", "sortOrder", "visibility", "groupId"].includes(f))));

// ---- translationsField() schema builder ----------------------------------------------
const schema = translationsField({ title: 10, description: 20 });
t("accepts a well-formed ja override within the length limits", schema.safeParse({ ja: { title: "短い", description: "d" } }).success);
t("accepts an omitted translations block entirely (nothing to touch)", schema.safeParse(undefined).success);
t("accepts clearing a field with an empty string", schema.safeParse({ ja: { title: "" } }).success);
t("accepts clearing a field with null", schema.safeParse({ ja: { title: null } }).success);
t("rejects a field over its declared max length", !schema.safeParse({ ja: { title: "01234567890" /* 11 chars, max is 10 */ } }).success);
t(
  "an unknown field name (not in the allow-list passed to translationsField) is silently stripped, like every other zod object schema in this codebase — never a validation error",
  (() => {
    const parsed = schema.safeParse({ ja: { title: "ok", notAField: "x" } });
    return parsed.success && !("notAField" in (parsed.data.ja ?? {}));
  })(),
);
t("rejects a non-string, non-null value", !schema.safeParse({ ja: { title: 12345 } }).success);
// A generous-limit schema, so the length check above and the hostile-content check below don't
// interfere with each other.
const wideSchema = translationsField({ title: 2000, description: 2000 });
for (const hostile of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>"]) {
  const parsed = wideSchema.safeParse({ ja: { title: hostile } });
  t(`accepts hostile text unchanged as ORDINARY DATA (rendering safety is React's text nodes, never dangerouslySetInnerHTML): ${hostile}`, parsed.success && parsed.data.ja?.title === hostile);
}

// ---- Phase 2.2.1: the Google linking API messages are in the known-error table, in both locales -----------------------
{
  const serverSrc = (p: string) => readFileSync(path.resolve(import.meta.dirname, "..", "src", p), "utf8");
  const errorsTable = readFileSync(path.resolve(import.meta.dirname, "..", "..", "web", "src", "i18n", "errorMessages.ts"), "utf8");
  const sent = serverSrc("routes/googleAuth.routes.ts") + serverSrc("lib/sameOrigin.ts");
  const mapped: [string, string][] = [
    ["A Google account is already connected.", "error.googleAlreadyConnected"],
    ["No Google account is connected.", "error.googleNotConnected"],
    ["Request must be JSON.", "error.requestMustBeJson"],
    ["Google sign-in is not available.", "error.googleUnavailable"],
  ];
  for (const [message, key] of mapped) {
    t(`"${message}" is sent by the API`, sent.includes(`"${message}"`));
    t(`"${message}" maps to ${key} in the known-error table`, errorsTable.includes(`"${message}": "${key}"`));
    t(`${key} exists in both locales; English is the exact server message`, DICTIONARIES.en[key as TranslationKey] === message && typeof DICTIONARIES.ja[key as TranslationKey] === "string");
    t(`${key} has a Japanese (kana/kanji) translation, not the English text`, /[぀-ヿ一-鿿]/.test(DICTIONARIES.ja[key as TranslationKey]) && DICTIONARIES.ja[key as TranslationKey] !== message);
  }
  t("the pre-existing mappings are untouched", errorsTable.includes('"Request body must be a JSON object.": "error.requestBodyInvalid"') && errorsTable.includes('"Current password is incorrect.": "profile.password.err.incorrect"'));
}

console.log(`${ok} i18n unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exitCode = 1;
}
