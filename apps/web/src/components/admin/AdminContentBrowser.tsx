import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ADMIN_BULK_MAX,
  EVENT_KINDS,
  KNOWLEDGE_CATEGORIES,
  NEWS_TYPES,
  PROJECT_STATUSES,
  RESOURCE_TYPES,
  hasVisibility,
  type AdminContentResponse,
  type AdminContentRow,
  type AdminContentType,
  type BulkVisibilityResult,
  type EventKind,
  type KnowledgeCategory,
  type ProjectStatus,
  type ResourceType,
  type TeamMember,
  type Visibility,
} from "@scl/shared";
import { usePolicy } from "../../auth/usePolicy";
import { apiFetch } from "../../lib/api";
import { useApiResource } from "../../hooks/useApiResource";
import { useKnowledgeOptions } from "../../hooks/useKnowledgeOptions";
import { useLocale, useT } from "../../i18n/LocaleContext";
import { CATEGORY_LABEL_KEY, EVENT_KIND_LABEL_KEY, KNOWLEDGE_CATEGORY_LABEL_KEY, PROJECT_STATUS_LABEL_KEY, RESOURCE_TYPE_LABEL_KEY, dictLabel } from "../../i18n/labels";
import { formatDate, formatDateTime, formatNumber } from "../../lib/format";
import { Badge } from "../Badge";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { Icon } from "../Icon";
import { LoadingState } from "../LoadingState";
import { ConfirmActionModal } from "../ConfirmActionModal";
import { AdminPager } from "./AdminPager";
import { AdminContentDetailModal } from "./AdminContentDetailModal";

/** The URL is the single source of truth for filters, so a filtered view can be linked, reloaded and stepped back through. */
const PARAMS = ["q", "visibility", "status", "newsType", "translation", "from", "to", "sort", "scope", "kind", "owner", "category", "resourceType", "project", "area", "group"] as const;
const CATEGORY_KEYS = Object.keys(CATEGORY_LABEL_KEY);

/** Which filters exist for which type (the API rejects the rest with a 400, so the UI never sends them). */
const applies = {
  visibility: (type: AdminContentType) => hasVisibility(type),
  status: (type: AdminContentType) => type === "project",
  newsType: (type: AdminContentType) => type === "news",
  translation: (type: AdminContentType) => type !== "publication",
  event: (type: AdminContentType) => type === "event",
  /** Owner (the creator / author) exists for events, knowledge documents and lab resources. */
  owner: (type: AdminContentType) => type === "event" || type === "knowledge" || type === "resource",
  knowledge: (type: AdminContentType) => type === "knowledge",
  /** Knowledge documents and lab resources are both linked to a project / research area / group. */
  linked: (type: AdminContentType) => type === "knowledge" || type === "resource",
};

/** The event creator filter: the public team list (names only), fetched only when the events view is showing. */
function OwnerFilter({ value }: { value: string }) {
  const t = useT();
  const { data } = useApiResource<TeamMember[]>("/team");
  return (
    <div className="form-group">
      <label htmlFor="af-owner">{t("adm.f.owner")}</label>
      {/* key: the select is uncontrolled, so remount it once the options exist or the URL's owner would not be shown */}
      <select key={data ? "ready" : "loading"} id="af-owner" name="owner" defaultValue={value}>
        <option value="">{t("adm.f.any")}</option>
        {(data ?? []).map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Knowledge and resource filters: the category (documents) or type (resources), and the project / research area / group it is linked to (picklists from the ordinary list endpoints). */
function LinkedFilters({ kind, values }: { kind: "knowledge" | "resource"; values: Record<"category" | "resourceType" | "project" | "area" | "group", string> }) {
  const t = useT();
  const options = useKnowledgeOptions(true);
  const picker = (name: "project" | "area" | "group", label: string, list: { id: string; label: string }[] | undefined) => (
    <div className="form-group">
      <label htmlFor={`af-${name}`}>{label}</label>
      {/* key: the select is uncontrolled, so remount it once the options exist or the URL's value would not be shown */}
      <select key={options ? "ready" : "loading"} id={`af-${name}`} name={name} defaultValue={values[name]}>
        <option value="">{t("adm.f.any")}</option>
        {(list ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <>
      {kind === "knowledge" ? (
        <div className="form-group">
          <label htmlFor="af-category">{t("adm.f.category")}</label>
          <select id="af-category" name="category" defaultValue={values.category}>
            <option value="">{t("adm.f.any")}</option>
            {KNOWLEDGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(KNOWLEDGE_CATEGORY_LABEL_KEY[c])}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="form-group">
          <label htmlFor="af-resourceType">{t("adm.f.resourceType")}</label>
          <select id="af-resourceType" name="resourceType" defaultValue={values.resourceType}>
            <option value="">{t("adm.f.any")}</option>
            {RESOURCE_TYPES.map((r) => (
              <option key={r} value={r}>
                {t(RESOURCE_TYPE_LABEL_KEY[r])}
              </option>
            ))}
          </select>
        </div>
      )}
      {picker("project", t("adm.f.project"), options?.projects)}
      {picker("area", t("adm.f.area"), options?.areas)}
      {picker("group", t("adm.f.group"), options?.groups)}
    </>
  );
}

export function AdminContentBrowser({ types }: { types: AdminContentType[] }) {
  const t = useT();
  const { locale } = useLocale();
  const policy = usePolicy();
  const [sp, setSp] = useSearchParams();

  const requested = sp.get("type") as AdminContentType | null;
  const type: AdminContentType = requested && types.includes(requested) ? requested : types[0];
  const page = Math.max(1, Number(sp.get("page")) || 1);

  const apiQuery = useMemo(() => {
    const p = new URLSearchParams({ type });
    for (const key of PARAMS) {
      const v = sp.get(key);
      if (!v) continue;
      if (key === "visibility" && !applies.visibility(type)) continue;
      if (key === "status" && !applies.status(type)) continue;
      if (key === "newsType" && !applies.newsType(type)) continue;
      if (key === "translation" && !applies.translation(type)) continue;
      if ((key === "scope" || key === "kind") && !applies.event(type)) continue;
      if (key === "owner" && !applies.owner(type)) continue;
      if (key === "category" && !applies.knowledge(type)) continue;
      if (key === "resourceType" && type !== "resource") continue;
      if ((key === "project" || key === "area" || key === "group") && !applies.linked(type)) continue;
      p.set(key, v);
    }
    if (page > 1) p.set("page", String(page));
    return p.toString();
  }, [sp, type, page]);

  const { data, loading, error, reload } = useApiResource<AdminContentResponse>(`/admin/content?${apiQuery}`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inspect, setInspect] = useState<AdminContentRow | null>(null);
  const [bulkTarget, setBulkTarget] = useState<Visibility>("LAB_ONLY");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // A new query is a new list: whatever was ticked no longer refers to what is on screen.
  // (Adjusted while rendering, the pattern React recommends over an effect for state that follows a value.)
  const [selectionFor, setSelectionFor] = useState(apiQuery);
  if (selectionFor !== apiQuery) {
    setSelectionFor(apiQuery);
    setSelected(new Set());
  }

  const canBulk = policy.canBulkChangeVisibility && hasVisibility(type);
  const rows = data?.rows ?? [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function update(patch: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete("page");
    setSp(next);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const patch: Record<string, string | null> = {};
    for (const key of PARAMS) {
      const raw = form.get(key);
      patch[key] = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
    }
    update(patch);
  }

  function chooseType(next: AdminContentType) {
    const params = new URLSearchParams();
    if (next !== types[0]) params.set("type", next);
    setSp(params);
  }

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function applyBulk() {
    setNotice(null);
    // A failure propagates to the confirm dialog, which shows it in place (localized) and stays open.
    const result = await apiFetch<BulkVisibilityResult>("/admin/content/visibility", {
      method: "POST",
      body: JSON.stringify({ type, ids: Array.from(selected), visibility: bulkTarget }),
    });
    setNotice(t("adm.bulk.done", { updated: formatNumber(result.updated, locale), unchanged: formatNumber(result.unchanged, locale) }));
    setSelected(new Set());
    reload();
  }

  const statusLabel = (row: AdminContentRow): string | null => {
    if (!row.status) return null;
    if (row.type === "project") return PROJECT_STATUSES.includes(row.status as ProjectStatus) ? t(PROJECT_STATUS_LABEL_KEY[row.status as ProjectStatus]) : row.status;
    if (row.type === "event") return (EVENT_KINDS as readonly string[]).includes(row.status) ? t(EVENT_KIND_LABEL_KEY[row.status as EventKind]) : row.status;
    if (row.type === "knowledge") return (KNOWLEDGE_CATEGORIES as readonly string[]).includes(row.status) ? t(KNOWLEDGE_CATEGORY_LABEL_KEY[row.status as KnowledgeCategory]) : row.status;
    if (row.type === "resource") return (RESOURCE_TYPES as readonly string[]).includes(row.status) ? t(RESOURCE_TYPE_LABEL_KEY[row.status as ResourceType]) : row.status;
    if (row.type === "team-member") return CATEGORY_KEYS.includes(row.status) ? t(CATEGORY_LABEL_KEY[row.status as keyof typeof CATEGORY_LABEL_KEY]) : row.status;
    return row.status; // news type: the stored word (Paper, Award, ...)
  };

  const val = (key: (typeof PARAMS)[number]) => sp.get(key) ?? "";
  const filterKey = sp.toString();

  return (
    <section aria-labelledby="admin-content-heading">
      <h2 className="sr-only" id="admin-content-heading">
        {dictLabel(t, "adm.type.", type)}
      </h2>

      {types.length > 1 && (
        <div className="chips admin-types" role="group" aria-label={t("adm.f.type")}>
          {types.map((x) => (
            <button key={x} type="button" className={`chip${x === type ? " active" : ""}`} aria-pressed={x === type} onClick={() => chooseType(x)}>
              {dictLabel(t, "adm.type.", x)}
            </button>
          ))}
        </div>
      )}

      {/* key: remounts with the URL's values after Reset / Back, so the (uncontrolled) inputs never go stale */}
      <form key={filterKey} className="admin-filters" onSubmit={onSubmit} role="search" aria-label={t("adm.f.filters")}>
        <div className="form-group admin-filters__wide">
          <label htmlFor="af-q">{t("adm.f.search")}</label>
          <input id="af-q" name="q" type="search" defaultValue={val("q")} maxLength={100} placeholder={t("adm.f.searchPlaceholder")} />
        </div>
        {applies.visibility(type) && (
          <div className="form-group">
            <label htmlFor="af-visibility">{t("adm.f.visibility")}</label>
            <select id="af-visibility" name="visibility" defaultValue={val("visibility")}>
              <option value="">{t("adm.f.any")}</option>
              <option value="PUBLIC">{t("adm.vis.PUBLIC")}</option>
              <option value="LAB_ONLY">{t("adm.vis.LAB_ONLY")}</option>
            </select>
          </div>
        )}
        {applies.status(type) && (
          <div className="form-group">
            <label htmlFor="af-status">{t("adm.f.status")}</label>
            <select id="af-status" name="status" defaultValue={val("status")}>
              <option value="">{t("adm.f.any")}</option>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(PROJECT_STATUS_LABEL_KEY[s])}
                </option>
              ))}
            </select>
          </div>
        )}
        {applies.newsType(type) && (
          <div className="form-group">
            <label htmlFor="af-newsType">{t("adm.f.newsType")}</label>
            <select id="af-newsType" name="newsType" defaultValue={val("newsType")}>
              <option value="">{t("adm.f.any")}</option>
              {NEWS_TYPES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}
        {applies.event(type) && (
          <>
            <div className="form-group">
              <label htmlFor="af-scope">{t("adm.f.scope")}</label>
              <select id="af-scope" name="scope" defaultValue={val("scope")}>
                <option value="">{t("adm.f.scopeAll")}</option>
                <option value="upcoming">{t("adm.f.scopeUpcoming")}</option>
                <option value="past">{t("adm.f.scopePast")}</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="af-kind">{t("adm.f.kind")}</label>
              <select id="af-kind" name="kind" defaultValue={val("kind")}>
                <option value="">{t("adm.f.any")}</option>
                {EVENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(EVENT_KIND_LABEL_KEY[k])}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {applies.linked(type) && <LinkedFilters kind={type === "resource" ? "resource" : "knowledge"} values={{ category: val("category"), resourceType: val("resourceType"), project: val("project"), area: val("area"), group: val("group") }} />}
        {applies.owner(type) && <OwnerFilter value={val("owner")} />}
        {applies.translation(type) && (
          <div className="form-group">
            <label htmlFor="af-translation">{t("adm.f.translation")}</label>
            <select id="af-translation" name="translation" defaultValue={val("translation")}>
              <option value="">{t("adm.f.any")}</option>
              <option value="translated">{t("adm.f.translated")}</option>
              <option value="untranslated">{t("adm.f.untranslated")}</option>
            </select>
          </div>
        )}
        <div className="form-group">
          <label htmlFor="af-from">{t("adm.f.from")}</label>
          <input id="af-from" name="from" type="date" defaultValue={val("from")} />
        </div>
        <div className="form-group">
          <label htmlFor="af-to">{t("adm.f.to")}</label>
          <input id="af-to" name="to" type="date" defaultValue={val("to")} />
        </div>
        <div className="form-group">
          <label htmlFor="af-sort">{t("adm.f.sort")}</label>
          <select id="af-sort" name="sort" defaultValue={val("sort")}>
            <option value="">{t("adm.f.sortDefault")}</option>
            <option value="updated">{t("adm.f.sortUpdated")}</option>
            <option value="created">{t("adm.f.sortCreated")}</option>
            <option value="title">{t("adm.f.sortTitle")}</option>
          </select>
        </div>
        <div className="admin-filters__actions">
          <button className="btn btn--primary btn--sm" type="submit">
            {t("adm.f.apply")}
          </button>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => chooseType(type)}>
            {t("adm.f.reset")}
          </button>
        </div>
      </form>

      <div role="status" aria-live="polite" className="admin-status">
        {notice && (
          <span className="form-success">
            <Icon name="check" size={16} /> {notice}
          </span>
        )}
        {!notice && data && !loading && <span className="text-muted">{t("adm.list.total", { n: formatNumber(data.pagination.total, locale) })}</span>}
      </div>

      {canBulk && rows.length > 0 && (
        <div className="admin-bulk" role="group" aria-label={t("adm.bulk.setVisibility")}>
          <label className="admin-bulk__all">
            <input
              type="checkbox"
              checked={allOnPage}
              onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.slice(0, ADMIN_BULK_MAX).map((r) => r.id)))}
            />
            {t("adm.bulk.selectAll")}
          </label>
          <span className="admin-bulk__count" aria-live="polite">
            {t("adm.bulk.selected", { n: formatNumber(selected.size, locale) })}
          </span>
          <div className="form-group admin-bulk__field">
            <label htmlFor="bulk-visibility">{t("adm.bulk.setVisibility")}</label>
            <select id="bulk-visibility" value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value as Visibility)}>
              <option value="PUBLIC">{t("adm.vis.PUBLIC")}</option>
              <option value="LAB_ONLY">{t("adm.vis.LAB_ONLY")}</option>
            </select>
          </div>
          <button className="btn btn--primary btn--sm" type="button" disabled={selected.size === 0} onClick={() => setConfirmOpen(true)}>
            {t("adm.bulk.apply")}
          </button>
          <button className="btn btn--ghost btn--sm" type="button" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>
            {t("adm.bulk.clear")}
          </button>
        </div>
      )}

      {loading && !data && <LoadingState label={t("adm.loading")} variant="list" />}
      {error && <ErrorState message={t("adm.list.loadError")} onRetry={reload} />}
      {data && rows.length === 0 && (
        <EmptyState title={t("adm.list.empty")} compact>
          {t("adm.list.emptyHint")}
        </EmptyState>
      )}

      {rows.length > 0 && (
        <ul className="admin-list" aria-label={t("adm.list.aria")} aria-busy={loading}>
          {rows.map((row) => (
            <li key={row.id} className={`admin-row${canBulk ? " admin-row--select" : ""}`}>
              {canBulk && (
                <input className="admin-row__check" type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={t("adm.row.select", { title: row.title })} />
              )}
              <div className="admin-row__main">
                <div className="admin-row__title">{row.title}</div>
                {row.subtitle && <div className="admin-row__sub">{row.subtitle}</div>}
                <div className="admin-row__meta">
                  {row.visibility && <Badge variant={row.visibility === "PUBLIC" ? "brand" : "warn"}>{dictLabel(t, "adm.vis.", row.visibility)}</Badge>}
                  {statusLabel(row) && <Badge>{statusLabel(row)}</Badge>}
                  {row.translation && (
                    <span className="badge" title={t("adm.row.jaProgressTitle", { done: row.translation.done, total: row.translation.total })}>
                      {t("adm.row.jaProgress", { done: row.translation.done, total: row.translation.total })}
                    </span>
                  )}
                  {row.hasAccount !== null && <Badge variant={row.hasAccount ? "info" : "neutral"}>{row.hasAccount ? t("adm.row.hasLogin") : t("adm.row.noLogin")}</Badge>}
                  {row.date && <span>{formatDateTime(row.date, locale)}</span>}
                  {(row.type === "event" || row.type === "knowledge" || row.type === "resource") && <span>{row.owner ? t("adm.row.owner", { name: row.owner.name }) : t("adm.row.noOwner")}</span>}
                  <span>{t("adm.row.updated", { date: formatDate(row.updatedAt, locale) })}</span>
                </div>
              </div>
              <div className="admin-row__actions">
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => setInspect(row)} aria-label={t("adm.row.inspectAria", { title: row.title })}>
                  {t("adm.row.inspect")}
                </button>
                <Link className="btn btn--ghost btn--sm" to={row.href}>
                  {t("adm.row.open")} <Icon name="arrow-right" size={14} />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && <AdminPager pagination={data.pagination} onPage={(p) => update({ page: p > 1 ? String(p) : null }, false)} />}

      <AdminContentDetailModal row={inspect} onClose={() => setInspect(null)} />

      <ConfirmActionModal
        open={confirmOpen}
        title={t("adm.bulk.confirmTitle")}
        message={t(bulkTarget === "PUBLIC" ? "adm.bulk.confirmPublic" : "adm.bulk.confirmLabOnly", { n: formatNumber(selected.size, locale) })}
        confirmLabel={t("adm.bulk.confirm")}
        busyLabel={t("adm.bulk.changing")}
        onClose={() => setConfirmOpen(false)}
        onConfirm={applyBulk}
      />
    </section>
  );
}
