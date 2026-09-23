import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  PROJECT_MEMBER_ROLES,
  type ForumTopicListResponse,
  type GalleryListResponse,
  type GroupSummary,
  type NewsItem,
  type ProjectDetail,
  type Publication,
  type ResearchArea,
  type TeamMember,
  type TranslationKey,
} from "@scl/shared";
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
import { StatusBadge } from "../components/Badge";
import { SectionHeader } from "../components/SectionHeader";
import { PublicationItem } from "../components/PublicationItem";
import { NewsCard } from "../components/NewsCard";
import { ProjectFormModal } from "../components/ProjectFormModal";
import { MembersModal } from "../components/MembersModal";
import { LinkItemsModal, type LinkableItem } from "../components/LinkItemsModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { VisibilityBadge } from "../components/VisibilityField";
import { ForumTopicList } from "../components/ForumTopicList";
import { formatMonthYear, formatProjectDateRange } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";

const ROLE_LABEL_KEY: Record<string, TranslationKey> = {
  LEAD: "projects.role.LEAD",
  MEMBER: "projects.role.MEMBER",
  COLLABORATOR: "projects.role.COLLABORATOR",
};

type Panel = "edit" | "members" | "areas" | "publications" | "news" | "delete" | null;

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const policy = usePolicy();
  const { locale, t } = useLocale();
  const ROLE_LABELS: Record<string, string> = { LEAD: t("projects.role.LEAD"), MEMBER: t("projects.role.MEMBER"), COLLABORATOR: t("projects.role.COLLABORATOR") };
  const { data: project, loading, error, status, reload } = useApiResource<ProjectDetail>(`/projects/${id}`);
  const { data: groups } = useApiResource<GroupSummary[]>("/groups");
  // Independent of the project fetch above (same pattern as the forum category page): the forum
  // endpoint resolves its own visibility, so a hidden linked topic never appears here either.
  const { data: discussions } = useApiResource<ForumTopicListResponse>(`/forum/posts?project=${id}&limit=5`);
  // Same independence for the gallery (Phase 13): it resolves its own file visibility, so a
  // LAB_ONLY photo never appears here for a guest even though the project itself is public.
  const { data: gallery } = useApiResource<GalleryListResponse>(`/gallery?project=${id}&limit=6`);

  const [panel, setPanel] = useState<Panel>(null);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [areas, setAreas] = useState<ResearchArea[] | null>(null);
  const [pubs, setPubs] = useState<Publication[] | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Full-page loader only while we have nothing for THIS id. A reload after a save keeps the page
  // (and its open modal) mounted, and navigating between ids never flashes the previous one.
  if (loading && (!project || project.id !== id)) {
    return (
      <>
        <PageHeader crumbs={[{ label: t("projects.pageTitle"), to: "/projects" }, { label: t("common.loading") }]} title={t("common.loading")} />
        <div className="container">
          <LoadingState label={t("projects.loadingProject")} variant="text" />
        </div>
      </>
    );
  }

  if (status === 404 || (!project && error)) {
    return (
      <>
        <PageHeader crumbs={[{ label: t("projects.pageTitle"), to: "/projects" }, { label: t("common.notFoundCrumb") }]} title={t("projects.notFoundTitle")} />
        <div className="container">
          <ErrorState message={status === 404 ? t("projects.notFoundMsg") : (error ?? t("projects.couldNotLoadThis"))} onRetry={status === 404 ? undefined : reload} />
          <Link to="/projects" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> {t("projects.allProjects")}
          </Link>
        </div>
      </>
    );
  }
  if (!project) return null;

  /** Opens a panel after loading the list it needs (once); a failed load shows an error instead. */
  async function open(next: Exclude<Panel, null>) {
    setActionError(null);
    try {
      if (next === "members" && !team) setTeam(await apiFetch<TeamMember[]>("/team"));
      if (next === "areas" && !areas) setAreas(await apiFetch<ResearchArea[]>("/research"));
      if (next === "publications" && !pubs) setPubs(await apiFetch<Publication[]>("/publications"));
      if (next === "news" && !news) setNews(await apiFetch<NewsItem[]>("/news"));
      setPanel(next);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.couldNotLoadList"));
    }
  }

  const put = async (relation: string, body: unknown) => {
    await apiFetch(`/projects/${project.id}/${relation}`, { method: "PUT", body: JSON.stringify(body) });
    reload();
  };
  const close = () => setPanel(null);
  const start = project.startDate;
  const end = project.endDate;
  const dates = start && end ? formatProjectDateRange(start, end, locale) : start ? t("dates.since", { date: formatMonthYear(start, locale) }) : end ? t("dates.until", { date: formatMonthYear(end, locale) }) : "";
  const asItems = <T,>(list: T[] | null, label: (x: T) => string, key: (x: T) => string): LinkableItem[] => (list ?? []).map((x) => ({ id: key(x), label: label(x) }));

  return (
    <>
      <PageHeader crumbs={[{ label: t("projects.pageTitle"), to: "/projects" }, { label: project.title }]} title={project.title} description={project.summary} />

      <div className="container">
        {project.canEdit && (
          <AdminBar
            text={policy.isManager ? t("projects.manageThisSuffix", { role: policy.roleLabel }) : t("projects.leadThis")}
            actions={
              <>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => open("edit")}>
                  {t("projects.editProject")}
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => open("members")}>
                  {t("projects.membersLabel")}
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => open("areas")}>
                  {t("projects.researchAreasLabel")}
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => open("publications")}>
                  {t("projects.publicationsLabel")}
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => open("news")}>
                  {t("projects.newsLabel")}
                </button>
                {policy.canDeleteContent && (
                  <button className="btn btn--danger btn--sm" type="button" onClick={() => setPanel("delete")}>
                    {t("common.delete")}
                  </button>
                )}
              </>
            }
          />
        )}
        {actionError && <ErrorState message={actionError} />}

        {/* What is it, who works on it, which areas, which output — answered in that order, at a glance. */}
        <div className="detail-layout detail-layout--project">
          <div className="detail-layout__a">
            <div className="detail-meta">
              <StatusBadge status={project.status} />
              <VisibilityBadge visibility={project.visibility} />
              {dates && (
                <span className="detail-meta__item">
                  <Icon name="calendar" size={14} /> {dates}
                </span>
              )}
              {project.group && (
                <span className="detail-meta__item">
                  <Icon name="users" size={14} /> {t("common.group")}{" "}
                  <Link to={`/groups/${project.group.id}`} className="link">
                    {project.group.name}
                  </Link>
                </span>
              )}
            </div>
            {project.description && (
              <section aria-labelledby="project-about">
                <h2 className="sr-only" id="project-about">
                  {t("projects.pageTitle")}
                </h2>
                <p className="prose">{project.description}</p>
              </section>
            )}
          </div>

          <aside className="detail-layout__aside" aria-label={t("projects.teamHeading")}>
            <section className="panel" aria-labelledby="project-team">
              <h2 className="panel__title" id="project-team">
                {t("projects.teamHeading")}
              </h2>
              {project.members.length === 0 ? (
                <p className="text-sm text-muted">{t("projects.noMembersYet")}</p>
              ) : (
                <div className="panel__list">
                  {project.members.map((m) => (
                    <PersonLink key={m.teamMemberId} id={m.teamMemberId} name={m.name} initials={m.initials} detail={t(ROLE_LABEL_KEY[m.role] ?? "projects.role.MEMBER")} />
                  ))}
                </div>
              )}
            </section>
            <section className="panel" aria-labelledby="project-areas">
              <h2 className="panel__title" id="project-areas">
                {t("projects.researchAreasLabel")}
              </h2>
              {project.areas.length === 0 ? (
                <p className="text-sm text-muted">{t("projects.noAreasYet")}</p>
              ) : (
                <div className="chips">
                  {project.areas.map((a) => (
                    <span key={a.id} className="tag">
                      <span aria-hidden="true">{a.icon}</span> {a.title}
                    </span>
                  ))}
                </div>
              )}
            </section>
          </aside>

          <div className="detail-layout__b">
            <section className="detail-section" aria-labelledby="project-pubs">
              <SectionHeader compact id="project-pubs" title={t("projects.publicationsHeading", { count: project.publications.length })} />
              {project.publications.length === 0 ? (
                <EmptyState title={t("projects.noPubsLinked")} compact />
              ) : (
                <div className="pub-list">
                  {project.publications.map((p) => (
                    <PublicationItem key={p.id} publication={p} canEdit={false} canDelete={false} />
                  ))}
                </div>
              )}
            </section>

            <section className="detail-section" aria-labelledby="project-news">
              <SectionHeader compact id="project-news" title={t("projects.newsHeading", { count: project.news.length })} />
              {project.news.length === 0 ? (
                <EmptyState title={t("projects.noNewsLinked")} compact />
              ) : (
                <div className="grid">
                  {project.news.map((n) => (
                    <NewsCard key={n.id} item={n} />
                  ))}
                </div>
              )}
            </section>

            {gallery && gallery.items.length > 0 && (
              <section className="detail-section" aria-labelledby="project-gallery">
                <SectionHeader
                  compact
                  id="project-gallery"
                  title={t("projects.galleryHeading")}
                  action={
                    <Link to={`/gallery?project=${project.id}`} className="btn btn--secondary btn--sm">
                      {t("common.viewAll")}
                    </Link>
                  }
                />
                <div className="gallery-grid gallery-grid--compact">
                  {gallery.items.map((item) => (
                    <Link key={item.id} to={`/gallery?project=${project.id}`} className="gallery-tile gallery-tile--plain">
                      <img className="gallery-tile__img" src={item.file.url} alt={item.caption || ""} loading="lazy" decoding="async" />
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {discussions && discussions.topics.length > 0 && (
              <section className="detail-section" aria-labelledby="project-forum">
                <SectionHeader compact id="project-forum" title={t("projects.communityDiscussions")} />
                <ForumTopicList topics={discussions.topics} />
              </section>
            )}
          </div>
        </div>
      </div>

      <ProjectFormModal
        open={panel === "edit"}
        title={t("projects.editTitle")}
        initial={project}
        canManageSettings={policy.isManager}
        groups={(groups ?? []).map((g) => ({ id: g.id, name: g.name }))}
        onClose={close}
        onSubmit={async (payload) => {
          await apiFetch(`/projects/${project.id}`, { method: "PUT", body: JSON.stringify(payload) });
          reload();
        }}
      />

      <MembersModal
        open={panel === "members"}
        title={t("projects.membersModalTitle")}
        description={t("projects.membersModalDesc")}
        people={asItems(team, (m) => `${m.name} — ${m.role}`, (m) => m.id)}
        roles={PROJECT_MEMBER_ROLES}
        roleLabels={ROLE_LABELS}
        selected={project.members.map((m) => ({ teamMemberId: m.teamMemberId, role: m.role }))}
        onClose={close}
        onSubmit={(members) => put("members", { members })}
      />

      <LinkItemsModal
        open={panel === "areas"}
        title={t("projects.areasModalTitle")}
        description={t("projects.areasModalDesc")}
        items={asItems(areas, (a) => `${a.icon} ${a.title}`, (a) => a.id)}
        selectedIds={project.areas.map((a) => a.id)}
        onClose={close}
        onSubmit={(ids) => put("areas", { areaIds: ids })}
      />

      <LinkItemsModal
        open={panel === "publications"}
        title={t("projects.pubsModalTitle")}
        description={t("projects.pubsModalDesc")}
        items={asItems(pubs, (p) => `${p.title} (${p.year})`, (p) => p.id)}
        selectedIds={project.publications.map((p) => p.id)}
        onClose={close}
        onSubmit={(ids) => put("publications", { publicationIds: ids })}
      />

      <LinkItemsModal
        open={panel === "news"}
        title={t("projects.newsModalTitle")}
        description={t("projects.newsModalDesc")}
        items={asItems(news, (n) => `${n.title} (${n.date})`, (n) => n.id)}
        selectedIds={project.news.map((n) => n.id)}
        onClose={close}
        onSubmit={(ids) => put("news", { newsIds: ids })}
      />

      <ConfirmDeleteModal
        open={panel === "delete"}
        title={t("projects.deleteTitle")}
        message={t("projects.deleteMessageFull", { title: project.title })}
        onClose={close}
        onConfirm={async () => {
          await apiFetch(`/projects/${project.id}`, { method: "DELETE" });
          navigate("/projects");
        }}
      />
    </>
  );
}
