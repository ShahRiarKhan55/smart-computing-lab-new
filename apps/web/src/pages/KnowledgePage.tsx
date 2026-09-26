import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { KNOWLEDGE_CATEGORIES, type KnowledgeDocSummary, type KnowledgeListResponse } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { useKnowledgeOptions } from "../hooks/useKnowledgeOptions";
import { apiFetch } from "../lib/api";
import { formatNumber } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { SectionHeader } from "../components/SectionHeader";
import { KnowledgeCard } from "../components/KnowledgeCard";
import { KnowledgeFormModal, type KnowledgeFormPayload } from "../components/KnowledgeFormModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { useLocale } from "../i18n/LocaleContext";
import { KNOWLEDGE_CATEGORY_LABEL_KEY } from "../i18n/labels";

/** The URL is the single source of truth for filters and paging, so a filtered list can be linked, reloaded and stepped back through. */
const FILTERS = ["q", "category", "project", "area", "group", "researcher", "visibility"] as const;

export function KnowledgePage() {
  const { locale, t } = useLocale();
  const policy = usePolicy();
  const [sp, setSp] = useSearchParams();
  const signedIn = Boolean(policy.user);
  const canFilterVisibility = policy.canChangeVisibility;
  const options = useKnowledgeOptions(true);

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
  // On a phone the eight controls would push the results off the screen, so the form folds behind a "Filters" summary
  // (open on wider screens, and whenever a filter is active so the person can see and change it).
  const [filtersOpen, setFiltersOpen] = useState(() => filtered || (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches));

  const { data, loading, error, reload } = useApiResource<KnowledgeListResponse>(`/knowledge${apiQuery ? `?${apiQuery}` : ""}`);
  const [formModal, setFormModal] = useState<{ open: boolean; item: KnowledgeDocSummary | null }>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeDocSummary | null>(null);

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
    return qs ? `/knowledge?${qs}` : "/knowledge";
  };

  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 0;
  const presetLinks = {
    ...(sp.get("project") ? { projectId: sp.get("project") as string } : {}),
    ...(sp.get("area") ? { researchAreaId: sp.get("area") as string } : {}),
    ...(sp.get("group") ? { groupId: sp.get("group") as string } : {}),
    ...(sp.get("researcher") ? { teamMemberId: sp.get("researcher") as string } : {}),
  };
  const val = (key: (typeof FILTERS)[number]) => sp.get(key) ?? "";
  const picker = (id: string, name: (typeof FILTERS)[number], label: string, list: { id: string; label: string }[] | undefined) => (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} defaultValue={val(name)}>
        <option value="">{t("knowledge.anyOption")}</option>
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
      <PageHeader eyebrow={t("nav.knowledge")} title={t("knowledge.pageTitle")} description={t("knowledge.pageDescription")} />

      <div className="container">
        {signedIn && (
          <AdminBar
            text={`${policy.isManager ? policy.roleLabel : t("common.loggedIn")}: ${t(policy.isManager ? "knowledge.barManager" : "knowledge.barMember")}`}
            actionLabel={`+ ${t("knowledge.addNew")}`}
            onAction={() => setFormModal({ open: true, item: null })}
          />
        )}

        <details className="knowledge-filters-wrap" open={filtersOpen} onToggle={(e) => setFiltersOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="knowledge-filters-wrap__summary">
          <Icon name="search" size={14} /> {t(filtered ? "knowledge.filtersSummaryActive" : "knowledge.filtersSummary", { count: activeFilters })}
        </summary>
        {/* key: remounts with the URL's values after Reset / Back / once the picklists exist, so the (uncontrolled) inputs never go stale */}
        <form key={`${sp.toString()}|${options ? "ready" : "loading"}`} className="admin-filters knowledge-filters" onSubmit={onSubmit} role="search" aria-label={t("knowledge.filtersLabel")}>
          <div className="form-group admin-filters__wide">
            <label htmlFor="kf-q">{t("knowledge.searchLabel")}</label>
            <input id="kf-q" name="q" type="search" defaultValue={val("q")} maxLength={100} placeholder={t("knowledge.searchPlaceholder")} />
          </div>
          <div className="form-group">
            <label htmlFor="kf-category">{t("knowledge.categoryLabel")}</label>
            <select id="kf-category" name="category" defaultValue={val("category")}>
              <option value="">{t("knowledge.anyOption")}</option>
              {KNOWLEDGE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(KNOWLEDGE_CATEGORY_LABEL_KEY[c])}
                </option>
              ))}
            </select>
          </div>
          {picker("kf-project", "project", t("knowledge.projectLabel"), options?.projects)}
          {picker("kf-area", "area", t("knowledge.areaLabel"), options?.areas)}
          {picker("kf-group", "group", t("knowledge.groupLabel"), options?.groups)}
          {picker("kf-researcher", "researcher", t("knowledge.researcherLabel"), options?.researchers)}
          {canFilterVisibility && (
            <div className="form-group">
              <label htmlFor="kf-visibility">{t("knowledge.visibilityLabel")}</label>
              <select id="kf-visibility" name="visibility" defaultValue={val("visibility")}>
                <option value="">{t("knowledge.anyOption")}</option>
                <option value="PUBLIC">{t("adm.vis.PUBLIC")}</option>
                <option value="LAB_ONLY">{t("adm.vis.LAB_ONLY")}</option>
              </select>
            </div>
          )}
          {signedIn && (
            <div className="form-group knowledge-filters__mine">
              <label className="check-row" htmlFor="kf-mine">
                <input id="kf-mine" name="mine" type="checkbox" value="1" defaultChecked={mine} />
                <span>{t("knowledge.mineLabel")}</span>
              </label>
            </div>
          )}
          <div className="admin-filters__actions">
            <button className="btn btn--primary btn--sm" type="submit">
              {t("knowledge.applyFilters")}
            </button>
            <Link className="btn btn--ghost btn--sm" to="/knowledge">
              {t("knowledge.clearFilters")}
            </Link>
          </div>
        </form>
        </details>

        <SectionHeader compact id="knowledge-list" title={t("knowledge.resultsHeading")} />
        <div role="status" aria-live="polite" className="knowledge-status">
          {data && !error && <span className="text-muted">{t(total === 1 ? "knowledge.countOne" : "knowledge.countOther", { count: formatNumber(total, locale) })}</span>}
        </div>

        {loading && !data && <LoadingState label={t("knowledge.loading")} variant="cards" />}
        {error && <ErrorState message={t("knowledge.errorLoad")} onRetry={reload} />}
        {data && data.items.length === 0 && (
          <EmptyState title={t(filtered ? "knowledge.emptyFilteredTitle" : "knowledge.emptyTitle")}>{t(filtered ? "knowledge.emptyFilteredHint" : "knowledge.emptyHint")}</EmptyState>
        )}
        {data && data.items.length > 0 && (
          <div className="grid grid--wide" aria-busy={loading} aria-labelledby="knowledge-list">
            {data.items.map((d) => (
              <KnowledgeCard key={d.id} doc={d} onEdit={() => setFormModal({ open: true, item: d })} onDelete={() => setDeleteTarget(d)} />
            ))}
          </div>
        )}

        {totalPages > 1 && data && data.items.length > 0 && (
          <nav className="search-pager" aria-label={t("knowledge.pagerAria")}>
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

      <KnowledgeFormModal
        open={formModal.open}
        title={formModal.item ? t("knowledge.editTitle") : t("knowledge.newTitle")}
        initial={formModal.item}
        canSetVisibility={policy.canChangeVisibility}
        presetLinks={formModal.item ? undefined : presetLinks}
        onClose={() => setFormModal({ open: false, item: null })}
        onSubmit={async (payload: KnowledgeFormPayload) => {
          await apiFetch(formModal.item ? `/knowledge/${formModal.item.id}` : "/knowledge", {
            method: formModal.item ? "PUT" : "POST",
            body: JSON.stringify(payload),
          });
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title={t("knowledge.deleteTitle")}
        message={deleteTarget ? t("knowledge.deleteConfirm", { title: deleteTarget.title }) : ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await apiFetch(`/knowledge/${deleteTarget.id}`, { method: "DELETE" });
          reload();
        }}
      />
    </>
  );
}
