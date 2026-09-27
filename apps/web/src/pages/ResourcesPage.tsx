import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { RESOURCE_TYPES, type ResourceListResponse, type ResourceSummary } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { useResourceOptions } from "../hooks/useResourceOptions";
import { apiFetch } from "../lib/api";
import { formatNumber } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { SectionHeader } from "../components/SectionHeader";
import { ResourceCard } from "../components/ResourceCard";
import { ResourceFormModal, type ResourceFormPayload } from "../components/ResourceFormModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { useLocale } from "../i18n/LocaleContext";
import { RESOURCE_TYPE_LABEL_KEY } from "../i18n/labels";

/** The URL is the single source of truth for filters and paging, so a filtered list can be linked, reloaded and stepped back through. */
const FILTERS = ["q", "type", "project", "area", "group", "researcher", "knowledge", "publication", "visibility"] as const;

export function ResourcesPage() {
  const { locale, t } = useLocale();
  const policy = usePolicy();
  const [sp, setSp] = useSearchParams();
  const signedIn = Boolean(policy.user);
  const canFilterVisibility = policy.canChangeVisibility;
  const options = useResourceOptions(true);

  const rawPage = sp.get("page") ?? "";
  const page = /^\d{1,5}$/.test(rawPage) && Number(rawPage) >= 1 ? Number(rawPage) : 1;
  const mine = signedIn && sp.get("mine") === "1";

  // Only what the API accepts for THIS viewer is sent: `mine` needs an account, `visibility` is a manager filter.
  const apiQuery = useMemo(() => {
    const p = new URLSearchParams();
    for (const key of FILTERS) {
      const v = sp.get(key);
      if (!v) continue;
      if (key === "visibility" && !canFilterVisibility) continue;
      p.set(key, v);
    }
    if (mine) p.set("mine", "1");
    if (page > 1) p.set("page", String(page));
    return p.toString();
  }, [sp, canFilterVisibility, mine, page]);
  const activeFilters = FILTERS.filter((k) => sp.get(k) && (k !== "visibility" || canFilterVisibility)).length + (mine ? 1 : 0);
  const filtered = activeFilters > 0;
  // On a phone the controls would push the results off the screen, so the form folds behind a "Filters" summary
  // (open on wider screens, and whenever a filter is active so the person can see and change it).
  const [filtersOpen, setFiltersOpen] = useState(() => filtered || (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches));

  const { data, loading, error, reload } = useApiResource<ResourceListResponse>(`/resources${apiQuery ? `?${apiQuery}` : ""}`);
  const [formModal, setFormModal] = useState<{ open: boolean; item: ResourceSummary | null }>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = useState<ResourceSummary | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const key of FILTERS) {
      const raw = form.get(key);
      if (typeof raw === "string" && raw.trim() !== "") next.set(key, raw.trim());
    }
    if (form.get("mine") === "1") next.set("mine", "1");
    setSp(next);
  }

  const pageUrl = (p: number) => {
    const next = new URLSearchParams(sp);
    if (p > 1) next.set("page", String(p));
    else next.delete("page");
    const qs = next.toString();
    return qs ? `/resources?${qs}` : "/resources";
  };

  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 0;
  const presetLinks = {
    ...(sp.get("project") ? { projectId: sp.get("project") as string } : {}),
    ...(sp.get("area") ? { researchAreaId: sp.get("area") as string } : {}),
    ...(sp.get("group") ? { groupId: sp.get("group") as string } : {}),
    ...(sp.get("researcher") ? { teamMemberId: sp.get("researcher") as string } : {}),
    ...(sp.get("knowledge") ? { knowledgeDocId: sp.get("knowledge") as string } : {}),
    ...(sp.get("publication") ? { publicationId: sp.get("publication") as string } : {}),
  };
  const val = (key: (typeof FILTERS)[number]) => sp.get(key) ?? "";
  const picker = (id: string, name: (typeof FILTERS)[number], label: string, list: { id: string; label: string }[] | undefined) => (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} defaultValue={val(name)}>
        <option value="">{t("resource.anyOption")}</option>
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
      <PageHeader eyebrow={t("nav.resources")} title={t("resource.pageTitle")} description={t("resource.pageDescription")} />

      <div className="container">
        {signedIn && (
          <AdminBar
            text={`${policy.isManager ? policy.roleLabel : t("common.loggedIn")}: ${t(policy.isManager ? "resource.barManager" : "resource.barMember")}`}
            actionLabel={`+ ${t("resource.addNew")}`}
            onAction={() => setFormModal({ open: true, item: null })}
          />
        )}

        <details className="knowledge-filters-wrap" open={filtersOpen} onToggle={(e) => setFiltersOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className="knowledge-filters-wrap__summary">
            <Icon name="search" size={14} /> {t(filtered ? "resource.filtersSummaryActive" : "resource.filtersSummary", { count: activeFilters })}
          </summary>
          {/* key: remounts with the URL's values after Reset / Back / once the picklists exist, so the (uncontrolled) inputs never go stale */}
          <form key={`${sp.toString()}|${options ? "ready" : "loading"}`} className="admin-filters knowledge-filters" onSubmit={onSubmit} role="search" aria-label={t("resource.filtersLabel")}>
            <div className="form-group admin-filters__wide">
              <label htmlFor="rf-q">{t("resource.searchLabel")}</label>
              <input id="rf-q" name="q" type="search" defaultValue={val("q")} maxLength={100} placeholder={t("resource.searchPlaceholder")} />
            </div>
            <div className="form-group">
              <label htmlFor="rf-type">{t("resource.typeLabel")}</label>
              <select id="rf-type" name="type" defaultValue={val("type")}>
                <option value="">{t("resource.anyOption")}</option>
                {RESOURCE_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {t(RESOURCE_TYPE_LABEL_KEY[r])}
                  </option>
                ))}
              </select>
            </div>
            {picker("rf-project", "project", t("resource.projectLabel"), options?.projects)}
            {picker("rf-area", "area", t("resource.areaLabel"), options?.areas)}
            {picker("rf-group", "group", t("resource.groupLabel"), options?.groups)}
            {picker("rf-researcher", "researcher", t("resource.researcherLabel"), options?.researchers)}
            {picker("rf-knowledge", "knowledge", t("resource.docLabel"), options?.docs)}
            {picker("rf-publication", "publication", t("resource.publicationLabel"), options?.publications)}
            {canFilterVisibility && (
              <div className="form-group">
                <label htmlFor="rf-visibility">{t("resource.visibilityLabel")}</label>
                <select id="rf-visibility" name="visibility" defaultValue={val("visibility")}>
                  <option value="">{t("resource.anyOption")}</option>
                  <option value="PUBLIC">{t("adm.vis.PUBLIC")}</option>
                  <option value="LAB_ONLY">{t("adm.vis.LAB_ONLY")}</option>
                </select>
              </div>
            )}
            {signedIn && (
              <div className="form-group knowledge-filters__mine">
                <label className="check-row" htmlFor="rf-mine">
                  <input id="rf-mine" name="mine" type="checkbox" value="1" defaultChecked={mine} />
                  <span>{t("resource.mineLabel")}</span>
                </label>
              </div>
            )}
            <div className="admin-filters__actions">
              <button className="btn btn--primary btn--sm" type="submit">
                {t("resource.applyFilters")}
              </button>
              <Link className="btn btn--ghost btn--sm" to="/resources">
                {t("resource.clearFilters")}
              </Link>
            </div>
          </form>
        </details>

        <SectionHeader compact id="resource-list" title={t("resource.resultsHeading")} />
        <div role="status" aria-live="polite" className="knowledge-status">
          {data && !error && <span className="text-muted">{t(total === 1 ? "resource.countOne" : "resource.countOther", { count: formatNumber(total, locale) })}</span>}
        </div>

        {loading && !data && <LoadingState label={t("resource.loading")} variant="cards" />}
        {error && <ErrorState message={t("resource.errorLoad")} onRetry={reload} />}
        {data && data.items.length === 0 && (
          <EmptyState title={t(filtered ? "resource.emptyFilteredTitle" : "resource.emptyTitle")}>{t(filtered ? "resource.emptyFilteredHint" : "resource.emptyHint")}</EmptyState>
        )}
        {data && data.items.length > 0 && (
          <div className="grid grid--wide" aria-busy={loading} aria-labelledby="resource-list">
            {data.items.map((r) => (
              <ResourceCard key={r.id} resource={r} onEdit={() => setFormModal({ open: true, item: r })} onDelete={() => setDeleteTarget(r)} />
            ))}
          </div>
        )}

        {totalPages > 1 && data && data.items.length > 0 && (
          <nav className="search-pager" aria-label={t("resource.pagerAria")}>
            {page > 1 ? (
              <Link className="btn btn--secondary btn--sm" to={pageUrl(page - 1)} rel="prev">
                <Icon name="arrow-left" size={14} /> {t("common.previous")}
              </Link>
            ) : (
              <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
                <Icon name="arrow-left" size={14} /> {t("common.previous")}
              </span>
            )}
            <span className="search-pager__pos">{t("common.pageOf", { page, total: totalPages })}</span>
            {page < totalPages ? (
              <Link className="btn btn--secondary btn--sm" to={pageUrl(page + 1)} rel="next">
                {t("common.next")} <Icon name="arrow-right" size={14} />
              </Link>
            ) : (
              <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
                {t("common.next")} <Icon name="arrow-right" size={14} />
              </span>
            )}
          </nav>
        )}
      </div>

      <ResourceFormModal
        open={formModal.open}
        title={formModal.item ? t("resource.editTitle") : t("resource.newTitle")}
        initial={formModal.item}
        canSetVisibility={policy.canChangeVisibility}
        presetLinks={formModal.item ? undefined : presetLinks}
        options={options}
        onClose={() => setFormModal({ open: false, item: null })}
        onSubmit={async (payload: ResourceFormPayload) => {
          await apiFetch(formModal.item ? `/resources/${formModal.item.id}` : "/resources", {
            method: formModal.item ? "PUT" : "POST",
            body: JSON.stringify(payload),
          });
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title={t("resource.deleteTitle")}
        message={deleteTarget ? t("resource.deleteConfirm", { name: deleteTarget.name }) : ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await apiFetch(`/resources/${deleteTarget.id}`, { method: "DELETE" });
          reload();
        }}
      />
    </>
  );
}
