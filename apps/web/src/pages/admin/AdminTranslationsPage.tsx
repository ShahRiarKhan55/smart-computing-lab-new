import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TRANSLATION_STATES, type AdminTranslationEntry, type AdminTranslationsResponse, type TranslatableEntityType } from "@scl/shared";
import { apiFetch } from "../../lib/api";
import { useApiResource } from "../../hooks/useApiResource";
import { useLocale, useT } from "../../i18n/LocaleContext";
import { apiErrorMessage } from "../../i18n/errorMessages";
import { dictLabel } from "../../i18n/labels";
import { formatNumber } from "../../lib/format";
import { AdminPager } from "../../components/admin/AdminPager";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { LoadingState } from "../../components/LoadingState";

const ENTITY_TYPES: TranslatableEntityType[] = ["RESEARCH_AREA", "RESEARCH_PROJECT", "RESEARCH_GROUP", "NEWS_ITEM", "EVENT", "KNOWLEDGE_DOC", "PUBLICATION", "TEAM_MEMBER"];
const STATE_KEY = { all: "adm.tr.stateAll", overridden: "adm.tr.stateOverridden", missing: "adm.tr.stateMissing" } as const;

/**
 * Japanese overrides for every translatable record, in one place. It writes the same `Translation`
 * rows the records' own edit forms write (never the English column), for managers only, and the server
 * re-checks that on every save. Authorization never depends on the language the page is shown in.
 */
export function AdminTranslationsPage() {
  const t = useT();
  const { locale } = useLocale();
  const [sp, setSp] = useSearchParams();
  const requested = sp.get("type") as TranslatableEntityType | null;
  const type: TranslatableEntityType = requested && ENTITY_TYPES.includes(requested) ? requested : "NEWS_ITEM";
  const state = TRANSLATION_STATES.find((s) => s === sp.get("state")) ?? "all";
  const page = Math.max(1, Number(sp.get("page")) || 1);

  const apiQuery = useMemo(() => {
    const p = new URLSearchParams({ type });
    if (sp.get("q")) p.set("q", sp.get("q") as string);
    if (state !== "all") p.set("state", state);
    if (page > 1) p.set("page", String(page));
    return p.toString();
  }, [sp, type, state, page]);
  const { data, loading, error, reload } = useApiResource<AdminTranslationsResponse>(`/admin/translations?${apiQuery}`);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = new URLSearchParams({ type });
    const q = form.get("q");
    const s = form.get("state");
    if (typeof q === "string" && q.trim()) next.set("q", q.trim());
    if (typeof s === "string" && s !== "all") next.set("state", s);
    setSp(next);
  }

  return (
    <>
      <p className="text-muted admin-note">{t("adm.tr.intro")}</p>

      <div className="chips admin-types" role="group" aria-label={t("adm.tr.type")}>
        {ENTITY_TYPES.map((x) => (
          <button key={x} type="button" className={`chip${x === type ? " active" : ""}`} aria-pressed={x === type} onClick={() => setSp(new URLSearchParams({ type: x }))}>
            {dictLabel(t, "adm.tr.type.", x)}
          </button>
        ))}
      </div>

      <form key={sp.toString()} className="admin-filters" onSubmit={onSubmit} role="search" aria-label={t("adm.f.filters")}>
        <div className="form-group admin-filters__wide">
          <label htmlFor="at-q">{t("adm.tr.search")}</label>
          <input id="at-q" name="q" type="search" defaultValue={sp.get("q") ?? ""} maxLength={100} placeholder={t("adm.f.searchPlaceholder")} />
        </div>
        <div className="form-group">
          <label htmlFor="at-state">{t("adm.tr.state")}</label>
          <select id="at-state" name="state" defaultValue={state}>
            {TRANSLATION_STATES.map((s) => (
              <option key={s} value={s}>
                {t(STATE_KEY[s])}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-filters__actions">
          <button className="btn btn--primary btn--sm" type="submit">
            {t("adm.f.apply")}
          </button>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setSp(new URLSearchParams({ type }))}>
            {t("adm.f.reset")}
          </button>
        </div>
      </form>

      <div role="status" aria-live="polite" className="admin-status">
        {data && !loading && <span className="text-muted">{t("adm.list.total", { n: formatNumber(data.pagination.total, locale) })}</span>}
      </div>
      {error && <ErrorState message={t("adm.list.loadError")} onRetry={reload} />}
      {loading && !data && <LoadingState label={t("adm.loading")} variant="list" />}
      {data && data.entries.length === 0 && <EmptyState title={t("adm.tr.empty")} compact />}

      {data && data.entries.length > 0 && (
        <ul className="admin-list admin-tr-list" aria-label={t("adm.list.aria")} aria-busy={loading}>
          {data.entries.map((entry) => (
            <TranslationEntry key={entry.id} entry={entry} />
          ))}
        </ul>
      )}

      {data && <AdminPager pagination={data.pagination} onPage={(p) => { const next = new URLSearchParams(sp); if (p > 1) next.set("page", String(p)); else next.delete("page"); setSp(next); }} />}
    </>
  );
}

/** After a save the entry stays where it is (updated in place): the list is only re-queried when the filters change, so a confirmation is never lost to a row that no longer matches the filter. */
function TranslationEntry({ entry: initial }: { entry: AdminTranslationEntry }) {
  const t = useT();
  const [entry, setEntry] = useState(initial);
  return (
    <li className="admin-row admin-tr">
      <div className="admin-tr__head">
        <span className="admin-row__title">{entry.label}</span>
        <Link className="btn btn--ghost btn--sm" to={entry.href}>
          {t("adm.tr.openPage")} <Icon name="arrow-right" size={14} />
        </Link>
      </div>
      {entry.fields.map((f) => (
        <FieldEditor key={f.field} entry={entry} field={f} onChanged={setEntry} />
      ))}
    </li>
  );
}

function FieldEditor({ entry, field, onChanged }: { entry: AdminTranslationEntry; field: AdminTranslationEntry["fields"][number]; onChanged: (e: AdminTranslationEntry) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const [value, setValue] = useState(field.ja ?? "");
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const id = `tr-${entry.id}-${field.field}`;
  const fieldLabel = dictLabel(t, "adm.field.", field.field);
  const dirty = value.trim() !== (field.ja ?? "");

  async function send(next: string | null, mode: "save" | "clear") {
    setBusy(mode);
    setMessage(null);
    try {
      const updated = await apiFetch<AdminTranslationEntry>(`/admin/translations/${entry.entityType}/${entry.id}`, {
        method: "PUT",
        body: JSON.stringify({ field: field.field, value: next }),
      });
      onChanged(updated);
      if (mode === "clear") setValue("");
      setMessage({ kind: "ok", text: mode === "clear" ? t("adm.tr.cleared") : t("adm.tr.saved") });
    } catch (err) {
      setMessage({ kind: "error", text: apiErrorMessage(err, t) || t("adm.tr.saveFailed") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-tr__field">
      <div className="admin-tr__col">
        <p className="admin-tr__label">
          {fieldLabel} · {t("adm.tr.english")}
        </p>
        <p className="admin-tr__base" lang="en">
          {field.base || t("adm.tr.emptyBase")}
        </p>
      </div>
      <div className="admin-tr__col">
        <div className="form-group">
          <label htmlFor={id}>
            {t("adm.tr.editLabel", { field: fieldLabel, label: entry.label })}{" "}
            <span className={`badge${field.ja ? " badge--brand" : ""}`}>{field.ja ? t("adm.tr.hasOverride") : t("adm.tr.none")}</span>
          </label>
          <textarea id={id} lang="ja" rows={3} value={value} maxLength={field.max} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="admin-tr__actions">
          <span className="text-muted admin-tr__count">{t("adm.tr.chars", { n: formatNumber(value.length, locale), max: formatNumber(field.max, locale) })}</span>
          <button className="btn btn--primary btn--sm" type="button" disabled={busy !== null || !dirty} onClick={() => void send(value.trim() === "" ? null : value, "save")}>
            {busy === "save" ? t("adm.tr.saving") : t("adm.tr.save")}
          </button>
          <button className="btn btn--secondary btn--sm" type="button" disabled={busy !== null || !field.ja} onClick={() => void send(null, "clear")}>
            {t("adm.tr.clear")}
          </button>
        </div>
        <div role="status" aria-live="polite">
          {message && <p className={message.kind === "ok" ? "form-success" : "form-error"}>{message.text}</p>}
        </div>
      </div>
    </div>
  );
}
