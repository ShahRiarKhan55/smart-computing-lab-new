import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { LOCALES, type Locale } from "@scl/shared";
import { useLocale } from "../i18n/LocaleContext";

const SHORT_KEY = { en: "lang.en.short", ja: "lang.ja.short" } as const;
const NAME_KEY = { en: "lang.en.name", ja: "lang.ja.name" } as const;

/**
 * The Phase 14 language switcher: one more nav__group-style disclosure button, styled and behaving
 * exactly like Nav's own dropdowns (Phase 10.1's WAI-ARIA disclosure pattern) so it costs no new
 * interaction pattern and stays visually subordinate to the real navigation. Its two items are
 * actions, not routes, so it is a bespoke small component rather than reusing NavGroup (which
 * renders `<NavLink>`s). Persists the choice via `useLocale()` (localStorage; see LocaleContext.tsx).
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLLIElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLLIElement>) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  function choose(next: Locale) {
    setLocale(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const triggerLabel = t(SHORT_KEY[locale]);

  return (
    <li className="nav__group lang-switch" ref={rootRef} onKeyDown={onKeyDown}>
      {/* Same "<trigger text> menu" panel-labelling convention every other nav__trigger uses
          (Nav.tsx/NavGroup.tsx), so this is not a special case for assistive tech or for the
          header's own accessibility invariants. */}
      <button
        ref={triggerRef}
        type="button"
        className={`nav__trigger${open ? " open" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {triggerLabel}
        <svg className="nav__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <ul id={panelId} className="nav__panel lang-switch__panel" aria-label={t("nav.groupMenu", { group: triggerLabel })} hidden={!open}>
        {LOCALES.map((code) => (
          <li key={code}>
            <button
              type="button"
              className={locale === code ? "active" : undefined}
              aria-current={locale === code ? "true" : undefined}
              onClick={() => choose(code)}
            >
              {t(NAME_KEY[code])}
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}
