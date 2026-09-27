import { useState } from "react";
import { Link } from "react-router-dom";
import type { ProjectSummary, Publication, ResearchArea, TeamMember } from "@scl/shared";
import { useAuth } from "../auth/AuthContext";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { AdminBar } from "../components/AdminBar";
import { ResearchCard } from "../components/ResearchCard";
import { StatCard } from "../components/StatCard";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { ResearchFormModal } from "../components/ResearchFormModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { useT } from "../i18n/LocaleContext";

export function ResearchPage() {
  const t = useT();
  const { user } = useAuth();
  const { data: areas, loading, error, reload } = useApiResource<ResearchArea[]>("/research");
  // Projects already say which areas they belong to; that is the relationship shown on each card.
  const { data: projects } = useApiResource<ProjectSummary[]>("/projects");
  // Bounded, already-existing list endpoints, reused just for their counts (no new relationship).
  const { data: researchers } = useApiResource<TeamMember[]>("/team");
  const { data: publications } = useApiResource<Publication[]>("/publications");

  const [formModal, setFormModal] = useState<{ open: boolean; area: ResearchArea | null }>({ open: false, area: null });
  const [deleteTarget, setDeleteTarget] = useState<ResearchArea | null>(null);

  const policy = usePolicy();
  const canEdit = Boolean(user); // any logged-in lab member can add/edit research areas

  return (
    <>
      <PageHeader eyebrow={t("nav.research")} title={t("research.pageTitle")} description={t("research.pageDescription")} />

      <div className="container">
        {canEdit && (
          <AdminBar
            text={
              <>
                {policy.isManager ? policy.roleLabel : t("common.loggedIn")}: {t("research.addOrEditSuffix")} {policy.canDeleteContent ? "" : t("research.onlyManagersDelete")}
              </>
            }
            actionLabel={`+ ${t("research.addNew")}`}
            onAction={() => setFormModal({ open: true, area: null })}
          />
        )}

        <div className="stat-grid" aria-label={t("research.glanceAria")}>
          <StatCard value={areas ? areas.length : null} label={t("home.statResearchAreas")} />
          <StatCard value={projects ? projects.length : null} label={t("home.statProjects")} />
          <StatCard value={researchers ? researchers.length : null} label={t("home.statResearchers")} />
          <StatCard value={publications ? publications.length : null} label={t("home.statPublications")} />
        </div>

        <nav aria-label={t("research.explore.aria")}>
          <ul className="research-explore">
            {(
              [
                ["/projects", "research.explore.projectsTitle", "research.explore.projectsDesc"],
                ["/publications", "research.explore.pubsTitle", "research.explore.pubsDesc"],
                ["/team", "research.explore.peopleTitle", "research.explore.peopleDesc"],
              ] as const
            ).map(([to, title, desc]) => (
              <li key={to}>
                <article className="card card--interactive">
                  <h2 className="card__title">
                    <Link to={to} className="research-explore__link">
                      {t(title)} <Icon name="arrow-right" size={14} />
                    </Link>
                  </h2>
                  <p className="research-explore__desc">{t(desc)}</p>
                </article>
              </li>
            ))}
          </ul>
        </nav>

        {loading && !areas && <LoadingState label={t("research.loading")} />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {areas && areas.length === 0 && <EmptyState title={t("research.empty")}>{t("research.emptyHint")}</EmptyState>}

        {areas && areas.length > 0 && <h2 className="sr-only">{t("research.headingSr")}</h2>}
        {areas && areas.length > 0 && (
          <div className="grid">
            {areas.map((area) => (
              <ResearchCard
                key={area.id}
                area={area}
                canEdit={canEdit}
                canDelete={policy.canDeleteContent}
                onEdit={() => setFormModal({ open: true, area })}
                onDelete={() => setDeleteTarget(area)}
                projects={(projects ?? []).filter((p) => p.areas.some((a) => a.id === area.id)).map((p) => ({ id: p.id, title: p.title }))}
              />
            ))}
          </div>
        )}
      </div>

      <ResearchFormModal
        open={formModal.open}
        title={formModal.area ? t("research.editTitle") : t("research.newTitle")}
        initial={formModal.area}
        canSetVisibility={policy.canChangeVisibility}
        onClose={() => setFormModal({ open: false, area: null })}
        onSubmit={async (fields) => {
          if (formModal.area) {
            await apiFetch(`/research/${formModal.area.id}`, { method: "PUT", body: JSON.stringify(fields) });
          } else {
            await apiFetch("/research", { method: "POST", body: JSON.stringify(fields) });
          }
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title={t("research.deleteTitle")}
        message={deleteTarget ? t("research.deleteMessage", { title: deleteTarget.title }) : ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await apiFetch(`/research/${deleteTarget.id}`, { method: "DELETE" });
          reload();
        }}
      />
    </>
  );
}
