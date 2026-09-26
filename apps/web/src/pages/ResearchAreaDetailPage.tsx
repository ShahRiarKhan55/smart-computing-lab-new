import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ResearchAreaDetail, TeamMember } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { PersonLink } from "../components/PersonLink";
import { ProjectCard } from "../components/ProjectCard";
import { SectionHeader } from "../components/SectionHeader";
import { RelatedOutputs } from "../components/RelatedOutputs";
import { RelatedResearch } from "../components/RelatedResearch";
import { RelatedKnowledge } from "../components/RelatedKnowledge";
import { ResearchFormModal } from "../components/ResearchFormModal";
import { LinkItemsModal } from "../components/LinkItemsModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { VisibilityBadge } from "../components/VisibilityField";
import { useT } from "../i18n/LocaleContext";

type Panel = "edit" | "researchers" | "delete" | null;

/**
 * One research area and what hangs off it: its projects, its researchers, and the publications, news
 * and events of those projects. The API filters every list by the viewer's visibility, so nothing
 * here needs to (or can) decide what is hidden.
 */
export function ResearchAreaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const policy = usePolicy();
  const t = useT();
  const { data: area, loading, error, status, reload } = useApiResource<ResearchAreaDetail>(`/research/${id}`);
  const [panel, setPanel] = useState<Panel>(null);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const crumbsBase = [{ label: t("nav.researchAreas"), to: "/research" }];

  if (loading && (!area || area.id !== id)) {
    return (
      <>
        <PageHeader crumbs={[...crumbsBase, { label: t("common.loading") }]} title={t("common.loading")} />
        <div className="container">
          <LoadingState label={t("rs.area.loading")} variant="text" />
        </div>
      </>
    );
  }

  if (status === 404 || (!area && error)) {
    return (
      <>
        <PageHeader crumbs={[...crumbsBase, { label: t("common.notFoundCrumb") }]} title={t("rs.area.notFoundTitle")} />
        <div className="container">
          <ErrorState message={status === 404 ? t("rs.area.notFoundMsg") : (error ?? t("rs.area.couldNotLoad"))} onRetry={status === 404 ? undefined : reload} />
          <Link to="/research" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> {t("rs.area.allAreas")}
          </Link>
        </div>
      </>
    );
  }
  if (!area) return null;

  async function openResearchers() {
    setActionError(null);
    try {
      if (!team) setTeam(await apiFetch<TeamMember[]>("/team"));
      setPanel("researchers");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("groups.couldNotLoadTeam"));
    }
  }
  const close = () => setPanel(null);

  return (
    <>
      <PageHeader crumbs={[...crumbsBase, { label: area.title }]} title={area.title} description={area.description} />

      <div className="container">
        {area.canEdit && (
          <AdminBar
            text={policy.isManager ? t("rs.area.manageNote", { role: policy.roleLabel }) : t("rs.area.editNote")}
            actions={
              <>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => setPanel("edit")}>
                  {t("rs.area.edit")}
                </button>
                {area.canManageResearchers && (
                  <button className="btn btn--secondary btn--sm" type="button" onClick={openResearchers}>
                    {t("rs.area.manageResearchers")}
                  </button>
                )}
                {area.canDelete && (
                  <button className="btn btn--danger btn--sm" type="button" onClick={() => setPanel("delete")}>
                    {t("common.delete")}
                  </button>
                )}
              </>
            }
          />
        )}
        {actionError && <ErrorState message={actionError} />}

        <div className="detail-meta">
          <span className="detail-meta__item">
            <span aria-hidden="true">{area.icon}</span> <span className="tag">{area.tag}</span>
          </span>
          <VisibilityBadge visibility={area.visibility} />
        </div>

        <div className="detail-layout detail-layout--aside-first">
          <div className="detail-layout__main">
            <section className="detail-section" aria-labelledby="area-projects">
              <SectionHeader compact id="area-projects" title={t("rs.area.projectsHeading", { count: area.projects.length })} />
              {area.projects.length === 0 ? (
                <EmptyState title={t("rs.area.noProjects")} compact />
              ) : (
                <div className="grid">
                  {area.projects.map((p) => (
                    <ProjectCard key={p.id} project={p} />
                  ))}
                </div>
              )}
            </section>

            <RelatedOutputs idPrefix="area" publications={area.publications} news={area.news} events={area.events} note={t("rs.area.outputsNote")} />

            <RelatedKnowledge relation="area" id={area.id} idPrefix="area" />
          </div>

          <aside className="detail-layout__aside" aria-label={t("rs.a11y.relatedNav")}>
            <section className="panel" aria-labelledby="area-researchers">
              <h2 className="panel__title" id="area-researchers">
                {t("rs.area.researchersHeading", { count: area.researchers.length })}
              </h2>
              {area.researchers.length === 0 ? (
                <p className="text-sm text-muted">{t("rs.area.noResearchers")}</p>
              ) : (
                <div className="panel__list">
                  {area.researchers.map((r) => (
                    <PersonLink key={r.id} id={r.id} name={r.name} initials={r.initials} detail={r.role} />
                  ))}
                </div>
              )}
            </section>
            <RelatedResearch
              idPrefix="area"
              links={[
                ...(area.projects.length > 0 ? [{ to: `/projects?area=${area.id}`, label: t("explore.areaProjects") }] : []),
                ...(area.publications.length > 0 ? [{ to: `/publications?area=${area.id}`, label: t("explore.areaPubs") }] : []),
              ]}
            />
          </aside>
        </div>
      </div>

      <ResearchFormModal
        open={panel === "edit"}
        title={t("research.editTitle")}
        initial={area}
        canSetVisibility={policy.canChangeVisibility}
        onClose={close}
        onSubmit={async (fields) => {
          await apiFetch(`/research/${area.id}`, { method: "PUT", body: JSON.stringify(fields) });
          reload();
        }}
      />

      <LinkItemsModal
        open={panel === "researchers"}
        title={t("rs.area.researchersModalTitle")}
        description={t("rs.area.researchersModalDesc")}
        items={(team ?? []).map((m) => ({ id: m.id, label: `${m.name} — ${m.role}` }))}
        selectedIds={area.researchers.map((r) => r.id)}
        onClose={close}
        onSubmit={async (ids) => {
          await apiFetch(`/research/${area.id}/researchers`, { method: "PUT", body: JSON.stringify({ teamMemberIds: ids }) });
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={panel === "delete"}
        title={t("research.deleteTitle")}
        message={t("research.deleteMessage", { title: area.title })}
        onClose={close}
        onConfirm={async () => {
          await apiFetch(`/research/${area.id}`, { method: "DELETE" });
          navigate("/research");
        }}
      />
    </>
  );
}
