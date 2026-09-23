import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, type GroupSummary, type ProjectDetail, type ProjectStatus, type ProjectSummary } from "@scl/shared";
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

type StatusFilter = "all" | ProjectStatus;

export function ProjectsPage() {
  const t = useT();
  const policy = usePolicy();
  const navigate = useNavigate();
  const { data: projects, loading, error, reload } = useApiResource<ProjectSummary[]>("/projects");
  const { data: groups } = useApiResource<GroupSummary[]>("/groups");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const present = useMemo(() => new Set((projects ?? []).map((p) => p.status)), [projects]);
  // If the chosen status has no projects any more, show everything instead of an empty page.
  const active: StatusFilter = filter !== "all" && !present.has(filter) ? "all" : filter;
  const shown = useMemo(() => (projects ?? []).filter((p) => active === "all" || p.status === active), [projects, active]);

  return (
    <>
      <PageHeader eyebrow={t("nav.research")} title={t("projects.pageTitle")} description={t("projects.pageDescription")} />

      <div className="container">
        {policy.canCreateProject && (
          <AdminBar
            text={`${policy.isAdmin ? "Admin" : "Lab manager"}: create projects and choose who can see them. New projects start as lab-only.`}
            actionLabel="+ New project"
            onAction={() => setCreateOpen(true)}
          />
        )}

        {loading && !projects && <LoadingState label={t("projects.loading")} />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {projects && (
          <>
            {projects.length > 0 && (
              <div className="filters">
                <div className="chips" role="group" aria-label="Filter projects by status">
                  <button className={`chip${active === "all" ? " active" : ""}`} aria-pressed={active === "all"} onClick={() => setFilter("all")} type="button">
                    All
                  </button>
                  {PROJECT_STATUSES.filter((s) => present.has(s)).map((s) => (
                    <button key={s} className={`chip${active === s ? " active" : ""}`} aria-pressed={active === s} onClick={() => setFilter(s)} type="button">
                      {PROJECT_STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
                <p className="filters__count" role="status">
                  Showing {shown.length} of {projects.length} {projects.length === 1 ? "project" : "projects"}
                </p>
              </div>
            )}

            {projects.length > 0 && <h2 className="sr-only">Projects</h2>}
            {projects.length === 0 ? (
              <EmptyState title={policy.user ? "No projects yet." : "No public projects yet."}>
                {policy.user ? "Projects will appear here once a lab manager creates them." : "Lab members can log in to see internal ones."}
              </EmptyState>
            ) : (
              <div className="grid">
                {shown.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
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
