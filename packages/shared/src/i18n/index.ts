import { LOCALES, DEFAULT_LOCALE, type Locale } from "../schemas/enums.js";
import { en } from "./en.js";
import { ja } from "./ja.js";

export { en } from "./en.js";
export { ja } from "./ja.js";
export * from "./translatableFields.js";

/** Every key the UI dictionary defines, derived from the English (base) file. */
export type TranslationKey = keyof typeof en;

export const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { en, ja };

/**
 * Looks up `key` in `locale`'s dictionary, falling back to English and then to the raw key
 * (never `undefined`, so a missing translation renders as visible mistake text instead of
 * disappearing). `{name}`-style placeholders in the template are replaced from `vars`.
 */
export function translate(locale: Locale, key: TranslationKey, vars?: Record<string, string | number>): string {
  const template = DICTIONARIES[locale]?.[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
  if (!vars) return template;
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), template);
}

/** `true` for any string in `LOCALES` ("en" | "ja"); used to validate a locale coming from a
 * client (a header, localStorage, a query param) before trusting it anywhere. */
export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
