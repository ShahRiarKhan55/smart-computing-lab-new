import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, isSupportedLocale, translate, type Locale, type TranslationKey } from "@scl/shared";

const STORAGE_KEY = "scl.locale";

/** The stored locale if it is one of `LOCALES`, else English — never trusts raw localStorage
 * content (a stale value from an older build, a value edited by hand, `localStorage` poisoning). */
function readStoredLocale(): Locale {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isSupportedLocale(raw) ? raw : DEFAULT_LOCALE;
  } catch {
    // Private browsing / blocked storage: fall back to English rather than throw.
    return DEFAULT_LOCALE;
  }
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Translates a UI dictionary key for the current locale; see `packages/shared/src/i18n`. */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Phase 14 UI localization. Persists the chosen locale in `localStorage` (survives refresh,
 * navigation and login/logout — it is not tied to the session) and keeps `<html lang>` in sync for
 * assistive technology. This never gates or filters content: it only selects which language's
 * static UI strings and, via the `X-Locale` request header (see lib/api.ts), which language's
 * domain-content overrides are shown. Visibility/permission checks are untouched by locale.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => (typeof window === "undefined" ? DEFAULT_LOCALE : readStoredLocale()));

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(isSupportedLocale(next) ? next : DEFAULT_LOCALE);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice still applies for this page load, just doesn't persist.
    }
  }, []);

  const t = useCallback((key: TranslationKey, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within a LocaleProvider");
  return ctx;
}

/** Convenience for components that only need the translator. */
export function useT() {
  return useLocale().t;
}

/** The locale the app is currently rendering in, read synchronously (outside React) so the fetch
 * wrapper (lib/api.ts) can attach it to every request without needing a hook. */
export function currentStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  return readStoredLocale();
}
