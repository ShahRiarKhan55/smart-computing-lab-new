import { useRef, useState, type FormEvent } from "react";
import { SEARCH_QUERY_MAX_LENGTH } from "@scl/shared";
import { useT } from "../i18n/LocaleContext";

interface SearchFormProps {
  /** "nav" = compact, in the header; "page" = the large box on /search. */
  variant: "nav" | "page";
  /** Unique per page: the label points at it. */
  inputId: string;
  label: string;
  placeholder: string;
  /** The active query (the URL is the source of truth); the field follows it. */
  value?: string;
  /** Empty the field after searching (the header box; the results page shows the query). */
  clearOnSubmit?: boolean;
  onSearch: (query: string) => void;
}

/** An explicit type-and-submit search box. No request is made while typing. */
export function SearchForm({ variant, inputId, label, placeholder, value = "", clearOnSubmit, onSearch }: SearchFormProps) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // Back/forward or a new URL changes the active query: the field follows it (adjusted while
  // rendering, the pattern React recommends over an effect for "state that mirrors a prop").
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    onSearch(draft.trim());
    if (clearOnSubmit) {
      setDraft("");
      inputRef.current?.blur(); // drops the phone keyboard so the results are not covered
    }
  }

  return (
    <form className={`search-form search-form--${variant}`} role="search" onSubmit={submit}>
      <label className={variant === "nav" ? "sr-only" : "search-form__label"} htmlFor={inputId}>
        {label}
      </label>
      <div className="search-form__row">
        <input
          ref={inputRef}
          id={inputId}
          className="search-form__input"
          type="search"
          name="q"
          value={draft}
          maxLength={SEARCH_QUERY_MAX_LENGTH}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className={`search-form__button${variant === "page" ? " btn btn--primary" : ""}`} type="submit" aria-label={variant === "nav" ? t("common.searchAria") : undefined}>
          {variant === "nav" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.6-3.6" />
            </svg>
          ) : (
            t("common.searchAria")
          )}
        </button>
      </div>
    </form>
  );
}
