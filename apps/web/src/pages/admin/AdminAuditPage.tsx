import { useMemo, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { AdminAuditResponse } from "@scl/shared";
import { usePolicy } from "../../auth/usePolicy";
import { useApiResource } from "../../hooks/useApiResource";
import { useLocale, useT } from "../../i18n/LocaleContext";
import { dictLabel } from "../../i18n/labels";
import { formatDateTime, formatNumber } from "../../lib/format";
import { AdminPager } from "../../components/admin/AdminPager";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";

const PARAMS = ["action", "entityType", "actor", "from", "to"] as const;

/** The facet list plus the value already in the URL, so the select can show it before (or without) the facets arriving. */
const withCurrent = (facets: string[] | undefined, current: string) => Array.from(new Set([...(facets ?? []), ...(current ? [current] : [])]));

/**
 * The read-only audit history. The server decides what each role may see (managers never get account
 * events or actor emails) and what may be stored (field NAMES, never passwords, message text or
 * translated text), so this page only presents rows it was given.
 */
export function AdminAuditPage() {
  const t = useT();
  const { locale } = useLocale();
  const policy = usePolicy();
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const apiQuery = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of PARAMS) {
      const v = sp.get(k);
      if (!v) continue;
      if (k === "actor" && !policy.canViewAccountAudit) continue; // a manager filtering by actor is a 403; never offered
      p.set(k, v);
    }
    if (page > 1) p.set("page", String(page));
    return p.toString();
  }, [sp, page, policy.canViewAccountAudit]);
  const { data, loading, error, reload } = useApiResource<AdminAuditResponse>(`/admin/audit?${apiQuery}`);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const k of PARAMS) {
      const v = form.get(k);
      if (typeof v === "string" && v.trim()) next.set(k, v.trim());
    }
    setSp(next);
  }

  const val = (k: (typeof PARAMS)[number]) => sp.get(k) ?? "";
  return (
    <>
      <p className="text-muted admin-note">
        {t("adm.audit.intro")} {!policy.canViewAccountAudit && t("adm.audit.managerNote")}
      </p>

      <form key={sp.toString()} className="admin-filters" onSubmit={onSubmit} role="search" aria-label={t("adm.f.filters")}>
        <div className="form-group">
          <label htmlFor="au-action">{t("adm.audit.action")}</label>
          <select id="au-action" name="action" defaultValue={val("action")}>
            <option value="">{t("adm.audit.allActions")}</option>
            {withCurrent(data?.facets.actions, val("action")).map((a) => (
              <option key={a} value={a}>
                {dictLabel(t, "adm.audit.action.", a)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="au-entity">{t("adm.audit.entity")}</label>
          <select id="au-entity" name="entityType" defaultValue={val("entityType")}>
            <option value="">{t("adm.audit.allTypes")}</option>
            {withCurrent(data?.facets.entityTypes, val("entityType")).map((e) => (
              <option key={e} value={e}>
                {dictLabel(t, "adm.audit.entityType.", e)}
              </option>
            ))}
          </select>
        </div>
        {policy.canViewAccountAudit && (
          <div className="form-group">
            <label htmlFor="au-actor">{t("adm.audit.actor")}</label>
            <input id="au-actor" name="actor" type="search" defaultValue={val("actor")} maxLength={100} />
          </div>
        )}
        <div className="form-group">
          <label htmlFor="au-from">{t("adm.audit.from")}</label>
          <input id="au-from" name="from" type="date" defaultValue={val("from")} />
        </div>
        <div className="form-group">
          <label htmlFor="au-to">{t("adm.audit.to")}</label>
          <input id="au-to" name="to" type="date" defaultValue={val("to")} />
        </div>
        <div className="admin-filters__actions">
          <button className="btn btn--primary btn--sm" type="submit">
            {t("adm.f.apply")}
          </button>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setSp(new URLSearchParams())}>
            {t("adm.f.reset")}
          </button>
        </div>
      </form>

      <div role="status" aria-live="polite" className="admin-status">
        {data && !loading && <span className="text-muted">{t("adm.list.total", { n: formatNumber(data.pagination.total, locale) })}</span>}
      </div>
      {error && <ErrorState message={t("adm.list.loadError")} onRetry={reload} />}
      {loading && !data && <LoadingState label={t("adm.loading")} variant="list" />}
      {data && data.entries.length === 0 && <EmptyState title={t("adm.audit.empty")} compact />}

      {data && data.entries.length > 0 && (
        <ul className="admin-list" aria-label={t("adm.list.aria")} aria-busy={loading}>
          {data.entries.map((e) => (
            <li key={e.id} className="admin-row admin-audit">
              <div className="admin-row__main">
                <div className="admin-row__title">{dictLabel(t, "adm.audit.action.", e.action)}</div>
                <div className="admin-row__meta">
                  <time dateTime={e.createdAt}>{formatDateTime(e.createdAt, locale)}</time>
                  <span>{e.actor ?? t("adm.audit.unknownActor")}</span>
                  <span>{dictLabel(t, "adm.audit.entityType.", e.entityType)}</span>
                </div>
                {Object.keys(e.details).length > 0 && (
                  <dl className="admin-audit__details" aria-label={t("adm.audit.details")}>
                    {Object.entries(e.details).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && <AdminPager pagination={data.pagination} onPage={(p) => { const next = new URLSearchParams(sp); if (p > 1) next.set("page", String(p)); else next.delete("page"); setSp(next); }} />}
    </>
  );
}
