import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ID_PATTERN, PROJECT_STATUSES, type GroupSummary, type ProjectDetail, type ProjectStatus, type ProjectSummary } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { ProjectCard } from "../components/ProjectCard";
import { ProjectFormModal } from "../components/ProjectFormModal";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { useT } from "../i18n/LocaleContext";
import { PROJECT_STATUS_LABEL_KEY } from "../i18n/labels";

type StatusFilter = "all" | ProjectStatus;

export function ProjectsPage() {
  const t = useT();
  const policy = usePolicy();
  const navigate = useNavigate();
  const { data: projects, loading, error, reload } = useApiResource<ProjectSummary[]>("/projects");
  const { data: groups } = useApiResource<GroupSummary[]>("/groups");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);

  // Phase 20: ?area= / ?group= / ?researcher= narrow the list to a real relationship. They are applied to
  // the list the API already filtered for this viewer, so an id the viewer cannot see (or that does not
  // exist) simply matches nothing, and its name is never looked up anywhere else.
  const [params] = useSearchParams();
  const relation = useMemo(() => {
    const read = (key: string) => {
      const v = params.get(key)?.trim() ?? "";
      return ID_PATTERN.test(v) ? v : "";
    };
    return { area: read("area"), group: read("group"), researcher: read("researcher") };
  }, [params]);
  const scoped = useMemo(
    () =>
      (projects ?? []).filter(
        (p) =>
          (!relation.area || p.areas.some((a) => a.id === relation.area)) &&
          (!relation.group || p.group?.id === relation.group) &&
          (!relation.researcher || p.members.some((m) => m.teamMemberId === relation.researcher)),
      ),
    [projects, relation],
  );
  const relationNote = useMemo(() => {
    const all = projects ?? [];
    const notes: string[] = [];
    if (params.has("area") || params.has("group") || params.has("researcher")) {
      if (relation.area) {
        const a = all.flatMap((p) => p.areas).find((x) => x.id === relation.area);
        notes.push(a ? t("projects.filter.area", { name: a.title }) : t("projects.filter.unavailable"));
      }
      if (relation.group) {
        const g = all.find((p) => p.group?.id === relation.group)?.group;
        notes.push(g ? t("projects.filter.group", { name: g.name }) : t("projects.filter.unavailable"));
      }
      if (relation.researcher) {
        const m = all.flatMap((p) => p.members).find((x) => x.teamMemberId === relation.researcher);
        notes.push(m ? t("projects.filter.researcher", { name: m.name }) : t("projects.filter.unavailable"));
      }
      if (notes.length === 0) notes.push(t("projects.filter.unavailable")); // a malformed value: dropped, not echoed
    }
    return notes;
  }, [projects, params, relation, t]);

  const present = useMemo(() => new Set(scoped.map((p) => p.status)), [scoped]);
  // If the chosen status has no projects any more, show everything instead of an empty page.
  const active: StatusFilter = filter !== "all" && !present.has(filter) ? "all" : filter;
  const shown = useMemo(() => scoped.filter((p) => active === "all" || p.status === active), [scoped, active]);

  return (
    <>
      <PageHeader eyebrow={t("nav.research")} title={t("projects.pageTitle")} description={t("projects.pageDescription")} />

      <div className="container">
        {policy.canCreateProject && (
          <AdminBar
            text={t("projects.manageCreateSuffix", { role: policy.roleLabel })}
            actionLabel={`+ ${t("projects.newProject")}`}
            onAction={() => setCreateOpen(true)}
          />
        )}

        {loading && !projects && <LoadingState label={t("projects.loading")} />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {projects && (
          <>
            {relationNote.length > 0 && (
              <div className="filter-note" role="group" aria-label={t("projects.filter.aria")}>
                {relationNote.map((n) => (
                  <span key={n} className="tag">
                    {n}
                  </span>
                ))}
                <Link to="/projects" className="btn btn--secondary btn--sm">
                  {t("projects.filter.clear")}
                </Link>
              </div>
            )}

            {scoped.length > 0 && (
              <div className="filters">
                <div className="chips" role="group" aria-label={t("projects.filterByStatusAria")}>
                  <button className={`chip${active === "all" ? " active" : ""}`} aria-pressed={active === "all"} onClick={() => setFilter("all")} type="button">
                    {t("projects.all")}
                  </button>
                  {PROJECT_STATUSES.filter((s) => present.has(s)).map((s) => (
                    <button key={s} className={`chip${active === s ? " active" : ""}`} aria-pressed={active === s} onClick={() => setFilter(s)} type="button">
                      {t(PROJECT_STATUS_LABEL_KEY[s])}
                    </button>
                  ))}
                </div>
                <p className="filters__count" role="status">
                  {t(shown.length === 1 ? "projects.showingCountOne" : "projects.showingCountOther", { shown: shown.length, total: scoped.length })}
                </p>
              </div>
            )}

            {scoped.length > 0 && <h2 className="sr-only">{t("projects.headingSr")}</h2>}
            {projects.length > 0 && scoped.length === 0 && <EmptyState title={t("projects.filter.noMatch")} compact />}
            {projects.length === 0 ? (
              <EmptyState title={policy.user ? t("projects.empty") : t("projects.emptyGuest")}>
                {policy.user ? t("projects.emptyHintUser") : t("projects.emptyHintGuest")}
              </EmptyState>
            ) : (
              scoped.length > 0 && (
              <div className="grid">
                {shown.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
              )
            )}
          </>
        )}
      </div>

      <ProjectFormModal
        open={createOpen}
        title={t("projects.newTitle")}
        initial={null}
        canManageSettings={policy.isManager}
        groups={(groups ?? []).map((g) => ({ id: g.id, name: g.name }))}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (payload) => {
          const created = await apiFetch<ProjectDetail>("/projects", { method: "POST", body: JSON.stringify(payload) });
          // Straight to the new project so its members, areas, publications and news can be added.
          navigate(`/projects/${created.id}`);
        }}
      />
    </>
  );
}
