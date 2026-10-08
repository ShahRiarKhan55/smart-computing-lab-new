import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ID_PATTERN,
  MAX_PUBLICATION_YEAR,
  MIN_PUBLICATION_YEAR,
  PUBLICATION_MAX_PAGE,
  PUBLICATION_SORTS,
  SEARCH_QUERY_MAX_LENGTH,
  type Publication,
  type PublicationAuthorsResponse,
  type PublicationListResponse,
  type PublicationSort,
  type ProjectSummary,
  type ResearchArea,
  type GroupSummary,
  type TeamMember,
  type Visibility,
} from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch, ApiError } from "../lib/api";
import { formatNumber } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { Icon } from "../components/Icon";
import { PublicationItem } from "../components/PublicationItem";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { PublicationFormModal } from "../components/PublicationFormModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { LinkItemsModal } from "../components/LinkItemsModal";
import { useLocale } from "../i18n/LocaleContext";
import type { TranslationKey } from "@scl/shared";

/** What the URL asks for, after every value has been checked. Anything malformed is dropped, never sent to the API. */
interface Filters {
  q: string;
  year: string;
  researcher: string;
  project: string;
  area: string;
  group: string;
  visibility: string;
  sort: PublicationSort;
  page: number;
}

const FILTER_KEYS = ["q", "year", "researcher", "project", "area", "group", "visibility", "sort", "page"] as const;
const SORT_LABEL_KEY: Record<PublicationSort, TranslationKey> = {
  newest: "publications.hub.sort.newest",
  oldest: "publications.hub.sort.oldest",
  title: "publications.hub.sort.title",
};

/** Reads and validates the query string. `ignored` is true when something in it had to be discarded. */
function readFilters(sp: URLSearchParams, mayFilterVisibility: boolean): { filters: Filters; ignored: boolean } {
  let ignored = false;
  const raw = (key: string) => sp.get(key)?.trim() ?? "";
  const id = (key: string) => {
    const v = raw(key);
    if (v === "") return "";
    if (ID_PATTERN.test(v)) return v;
    ignored = true;
    return "";
  };
  const q = raw("q");
  const year = raw("year");
  const yearOk = /^\d{4}$/.test(year) && Number(year) >= MIN_PUBLICATION_YEAR && Number(year) <= MAX_PUBLICATION_YEAR;
  if (year !== "" && !yearOk) ignored = true;
  const sort = raw("sort");
  const sortOk = (PUBLICATION_SORTS as readonly string[]).includes(sort);
  if (sort !== "" && !sortOk) ignored = true;
  const visibility = raw("visibility");
  const visibilityOk = mayFilterVisibility && (visibility === "PUBLIC" || visibility === "LAB_ONLY");
  if (visibility !== "" && !visibilityOk) ignored = true;
  const page = raw("page");
  const pageOk = /^\d{1,5}$/.test(page) && Number(page) >= 1 && Number(page) <= PUBLICATION_MAX_PAGE;
  if (page !== "" && !pageOk) ignored = true;
  const qOk = q.length <= SEARCH_QUERY_MAX_LENGTH;
  if (!qOk) ignored = true;
  return {
    ignored,
    filters: {
      q: qOk ? q : "",
      year: yearOk ? year : "",
      researcher: id("researcher"),
      project: id("project"),
      area: id("area"),
      group: id("group"),
      visibility: visibilityOk ? visibility : "",
      sort: sortOk ? (sort as PublicationSort) : "newest",
      page: pageOk ? Number(page) : 1,
    },
  };
}

/** Query string for a filter set; defaults are left out so the URL stays short and stable. */
function toQuery(f: Partial<Filters>): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.year) sp.set("year", f.year);
  if (f.researcher) sp.set("researcher", f.researcher);
  if (f.project) sp.set("project", f.project);
  if (f.area) sp.set("area", f.area);
  if (f.group) sp.set("group", f.group);
  if (f.visibility) sp.set("visibility", f.visibility);
  if (f.sort && f.sort !== "newest") sp.set("sort", f.sort);
  if (f.page && f.page > 1) sp.set("page", String(f.page));
  return sp;
}

interface Option {
  value: string;
  label: string;
}

/** A labelled <select> whose current value is always one of its options (a stale id falls back to "Any"). */
function FilterSelect({ id, label, value, options, anyLabel, onChange }: { id: string; label: string; value: string; options: Option[]; anyLabel: string; onChange: (v: string) => void }) {
  const shown = options.some((o) => o.value === value) ? value : "";
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={shown} onChange={(e) => onChange(e.target.value)}>
        <option value="">{anyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PublicationsPage() {
  const { locale, t } = useLocale();
  const policy = usePolicy();
  const [sp, setSp] = useSearchParams();
  const { filters, ignored } = useMemo(() => readFilters(sp, policy.isManager), [sp, policy.isManager]);
  const queryString = toQuery(filters).toString();

  const { data, loading, error, reload } = useApiResource<PublicationListResponse>(`/publications/browse${queryString ? `?${queryString}` : ""}`);
  const { data: team } = useApiResource<TeamMember[]>("/team");
  const { data: projects } = useApiResource<ProjectSummary[]>("/projects");
  const { data: areas } = useApiResource<ResearchArea[]>("/research");
  const { data: groups } = useApiResource<GroupSummary[]>("/groups");

  // The form's own copy of the filters; "Apply" moves it into the URL (the URL is the source of truth).
  const [draft, setDraft] = useState<Filters>(filters);
  useEffect(() => setDraft(filters), [queryString]); // eslint-disable-line react-hooks/exhaustive-deps

  const [formModal, setFormModal] = useState<{ open: boolean; pub: Publication | null }>({ open: false, pub: null });
  const [deleteTarget, setDeleteTarget] = useState<Publication | null>(null);
  const [authorsTarget, setAuthorsTarget] = useState<{ pub: Publication; ids: string[] } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isManager = policy.isManager; // lab managers and admins may change any author link
  const canEdit = policy.canEditContent; // any signed-in account may add/edit (server: canEditContent)
  // The team profile linked to the signed-in account, if any. A non-manager can only add/remove
  // *this* member as an author (the server enforces the same rule).
  const ownMember = policy.user ? (team?.find((m) => m.isOwn) ?? null) : null;
  const canManageAuthors = isManager || Boolean(ownMember);

  const apply = (next: Partial<Filters>) => setSp(toQuery({ ...next, page: 1 }));
  const goToPage = (page: number) => toQuery({ ...filters, page }).toString();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    apply({ ...draft, q: draft.q.trim() });
  }

  const yearOptions: Option[] = useMemo(() => {
    const years = new Set(data?.years ?? []);
    if (filters.year) years.add(Number(filters.year));
    return [...years].sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }));
  }, [data?.years, filters.year]);

  const filtersActive = FILTER_KEYS.some((k) => k !== "page" && k !== "sort" && String(filters[k]) !== "") || filters.sort !== "newest";

  // Under a date sort the list reads as an academic record, grouped by year; under A–Z it is one flat list.
  const grouped = useMemo(() => {
    if (!data || filters.sort === "title") return null;
    const groups2 = new Map<number, Publication[]>();
    for (const p of data.items) groups2.set(p.year, [...(groups2.get(p.year) ?? []), p]);
    return [...groups2.entries()];
  }, [data, filters.sort]);

  async function openManageAuthors(pub: Publication) {
    setActionError(null);
    try {
      const { teamMemberIds } = await apiFetch<PublicationAuthorsResponse>(`/publications/${pub.id}/authors`);
      setAuthorsTarget({ pub, ids: teamMemberIds });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("publications.errorAuthors"));
    }
  }

  const memberItems = (team ?? []).map((m) => ({ id: m.id, label: `${m.name} — ${m.role}` }));
  const lockedMemberIds = isManager ? [] : (team ?? []).filter((m) => m.id !== ownMember?.id).map((m) => m.id);

  const renderItem = (p: Publication) => (
    <PublicationItem
      key={p.id}
      publication={p}
      canEdit={canEdit}
      canDelete={policy.canDeleteContent}
      onEdit={() => {
        setActionError(null);
        setFormModal({ open: true, pub: p });
      }}
      onDelete={() => {
        setActionError(null);
        setDeleteTarget(p);
      }}
      onManageAuthors={canManageAuthors ? () => openManageAuthors(p) : undefined}
    />
  );

  const pageLink = (page: number, kind: "prev" | "next") => {
    const label = kind === "prev" ? t("common.previous") : t("common.next");
    const icon = <Icon name={kind === "prev" ? "arrow-left" : "arrow-right"} size={14} />;
    return (
      <Link className="btn btn--secondary btn--sm" to={{ search: goToPage(page) }} rel={kind}>
        {kind === "prev" ? icon : null} {label} {kind === "next" ? icon : null}
      </Link>
    );
  };
  const disabled = (kind: "prev" | "next") => (
    <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
      {kind === "prev" && <Icon name="arrow-left" size={14} />} {kind === "prev" ? t("common.previous") : t("common.next")} {kind === "next" && <Icon name="arrow-right" size={14} />}
    </span>
  );

  return (
    <>
      <PageHeader eyebrow={t("nav.research")} title={t("publications.pageTitle")} description={t("publications.pageDescription")} />

      <div className="container">
        {canEdit && (
          <AdminBar
            text={
              <>
                {policy.isManager ? policy.roleLabel : t("common.loggedIn")}: {t("publications.addOrEditSuffix")}
                {canManageAuthors ? t("publications.andManageAuthors") : ""}. {policy.canDeleteContent ? "" : t("research.onlyManagersDelete")}
              </>
            }
            actionLabel={`+ ${t("publications.addNew")}`}
            onAction={() => {
              setActionError(null);
              setFormModal({ open: true, pub: null });
            }}
            actions={
              policy.isManager ? (
                <>
                  <Link className="btn btn--secondary btn--sm" to="/publications/review">
                    {t("pubimport.link")}
                  </Link>
                  <button
                    className="btn btn--primary btn--sm"
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setFormModal({ open: true, pub: null });
                    }}
                  >
                    + {t("publications.addNew")}
                  </button>
                </>
              ) : undefined
            }
          />
        )}

        {actionError && <ErrorState message={actionError} />}

        <form className="admin-filters pub-filters" aria-label={t("publications.hub.filtersLabel")} onSubmit={onSubmit}>
          <div className="form-group admin-filters__wide">
            <label htmlFor="pub_f_q">{t("publications.hub.searchLabel")}</label>
            <input
              id="pub_f_q"
              type="search"
              value={draft.q}
              maxLength={SEARCH_QUERY_MAX_LENGTH}
              placeholder={t("publications.hub.searchPlaceholder")}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            />
          </div>
          <FilterSelect id="pub_f_year" label={t("publications.hub.yearLabel")} value={draft.year} options={yearOptions} anyLabel={t("publications.hub.any")} onChange={(v) => setDraft({ ...draft, year: v })} />
          <FilterSelect
            id="pub_f_researcher"
            label={t("publications.hub.researcherLabel")}
            value={draft.researcher}
            options={(team ?? []).map((m) => ({ value: m.id, label: m.name }))}
            anyLabel={t("publications.hub.any")}
            onChange={(v) => setDraft({ ...draft, researcher: v })}
          />
          <FilterSelect
            id="pub_f_project"
            label={t("publications.hub.projectLabel")}
            value={draft.project}
            options={(projects ?? []).map((p) => ({ value: p.id, label: p.title }))}
            anyLabel={t("publications.hub.any")}
            onChange={(v) => setDraft({ ...draft, project: v })}
          />
          <FilterSelect
            id="pub_f_area"
            label={t("publications.hub.areaLabel")}
            value={draft.area}
            options={(areas ?? []).map((a) => ({ value: a.id, label: a.title }))}
            anyLabel={t("publications.hub.any")}
            onChange={(v) => setDraft({ ...draft, area: v })}
          />
          <FilterSelect
            id="pub_f_group"
            label={t("publications.hub.groupLabel")}
            value={draft.group}
            options={(groups ?? []).map((g) => ({ value: g.id, label: g.name }))}
            anyLabel={t("publications.hub.any")}
            onChange={(v) => setDraft({ ...draft, group: v })}
          />
          {isManager && (
            <FilterSelect
              id="pub_f_visibility"
              label={t("publications.hub.visibilityLabel")}
              value={draft.visibility}
              options={(["PUBLIC", "LAB_ONLY"] as Visibility[]).map((v) => ({ value: v, label: t(v === "PUBLIC" ? "common.visibilityPublicOption" : "common.visibilityLabOnlyOption") }))}
              anyLabel={t("publications.hub.any")}
              onChange={(v) => setDraft({ ...draft, visibility: v })}
            />
          )}
          <div className="form-group">
            <label htmlFor="pub_f_sort">{t("publications.hub.sortLabel")}</label>
            <select id="pub_f_sort" value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value as PublicationSort })}>
              {PUBLICATION_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(SORT_LABEL_KEY[s])}
                </option>
              ))}
            </select>
          </div>
          <div className="admin-filters__actions">
            <button className="btn btn--primary btn--sm" type="submit">
              {t("publications.hub.apply")}
            </button>
            {filtersActive && (
              <Link className="btn btn--secondary btn--sm" to={{ search: "" }}>
                {t("publications.hub.clear")}
              </Link>
            )}
          </div>
        </form>

        {ignored && (
          <p className="text-sm text-muted" role="status">
            {t("publications.hub.ignoredFilters")}
          </p>
        )}

        {loading && !data && <LoadingState label={t("publications.loading")} variant="list" />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {data && !error && (
          <div aria-busy={loading}>
            <p className="filters__count" role="status">
              {t(data.total === 1 ? "publications.hub.resultsOne" : "publications.hub.resultsOther", { total: formatNumber(data.total, locale) })}
            </p>

            {data.total === 0 && (
              <EmptyState title={filtersActive ? t("publications.hub.noResults") : t("publications.empty")}>
                {filtersActive ? t("publications.hub.noResultsHint") : t("publications.emptyHint")}
              </EmptyState>
            )}

            {data.total > 0 && data.items.length === 0 && (
              <EmptyState
                title={t("publications.hub.noResults")}
                action={
                  <Link className="btn btn--secondary btn--sm" to={{ search: goToPage(1) }}>
                    {t("publications.hub.firstPage")}
                  </Link>
                }
              >
                {t("publications.hub.noResultsHint")}
              </EmptyState>
            )}

            {grouped
              ? grouped.map(([year, items]) => (
                  <section key={year} aria-labelledby={`pubs-${year}`}>
                    <h2 className="year-heading" id={`pubs-${year}`}>
                      {year} <small>{t(items.length === 1 ? "publications.yearCountOne" : "publications.yearCountOther", { count: items.length })}</small>
                    </h2>
                    <div className="pub-list">{items.map(renderItem)}</div>
                  </section>
                ))
              : data.items.length > 0 && <div className="pub-list">{data.items.map(renderItem)}</div>}

            {data.pageCount > 1 && (
              <nav className="search-pager" aria-label={t("publications.hub.paginationAria")}>
                {data.page > 1 ? pageLink(data.page - 1, "prev") : disabled("prev")}
                <span className="search-pager__pos">{t("common.pageOf", { page: data.page, total: data.pageCount })}</span>
                {data.page < data.pageCount ? pageLink(data.page + 1, "next") : disabled("next")}
              </nav>
            )}
          </div>
        )}
      </div>

      <PublicationFormModal
        open={formModal.open}
        title={formModal.pub ? t("publications.editTitle") : t("publications.newTitle")}
        initial={formModal.pub}
        canLinkSelf={Boolean(ownMember)}
        canSetVisibility={policy.canChangeVisibility}
        onClose={() => setFormModal({ open: false, pub: null })}
        onSubmit={async (fields, linkSelf) => {
          if (formModal.pub) {
            await apiFetch(`/publications/${formModal.pub.id}`, { method: "PUT", body: JSON.stringify(fields) });
          } else {
            await apiFetch("/publications", {
              method: "POST",
              body: JSON.stringify(linkSelf && ownMember ? { ...fields, teamMemberIds: [ownMember.id] } : fields),
            });
          }
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title={t("publications.deleteTitle")}
        message={deleteTarget ? t("publications.deleteConfirm", { title: deleteTarget.title }) : ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await apiFetch(`/publications/${deleteTarget.id}`, { method: "DELETE" });
          reload();
        }}
      />

      <LinkItemsModal
        open={authorsTarget !== null}
        title={t("publications.manageAuthors")}
        description={isManager ? t("publications.manageAuthorsHelpManager") : t("publications.manageAuthorsHelpMember")}
        items={memberItems}
        selectedIds={authorsTarget?.ids ?? []}
        disabledIds={lockedMemberIds}
        onClose={() => setAuthorsTarget(null)}
        onSubmit={async (ids) => {
          if (!authorsTarget) return;
          await apiFetch(`/publications/${authorsTarget.pub.id}/authors`, {
            method: "PUT",
            body: JSON.stringify({ teamMemberIds: ids }),
          });
          reload();
        }}
      />
    </>
  );
}
