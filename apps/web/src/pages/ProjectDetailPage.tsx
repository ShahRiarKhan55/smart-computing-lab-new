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
import { formatProjectDates } from "../lib/format";

const ROLE_LABELS: Record<string, string> = { LEAD: "Lead", MEMBER: "Member", COLLABORATOR: "Collaborator" };

type Panel = "edit" | "members" | "areas" | "publications" | "news" | "delete" | null;

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const policy = usePolicy();
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
        <PageHeader crumbs={[{ label: "Projects", to: "/projects" }, { label: "Loading…" }]} title="Loading…" />
        <div className="container">
          <LoadingState label="Loading project…" variant="text" />
        </div>
      </>
    );
  }

  if (status === 404 || (!project && error)) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Projects", to: "/projects" }, { label: "Not found" }]} title="Project not found" />
        <div className="container">
          <ErrorState message={status === 404 ? "This project could not be found." : (error ?? "Could not load this project.")} onRetry={status === 404 ? undefined : reload} />
          <Link to="/projects" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> All projects
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
      setActionError(err instanceof ApiError ? err.message : "Could not load the list.");
    }
  }

  const put = async (relation: string, body: unknown) => {
    await apiFetch(`/projects/${project.id}/${relation}`, { method: "PUT", body: JSON.stringify(body) });
    reload();
  };
  const close = () => setPanel(null);
  const dates = formatProjectDates(project.startDate, project.endDate);
  const asItems = <T,>(list: T[] | null, label: (x: T) => string, key: (x: T) => string): LinkableItem[] => (list ?? []).map((x) => ({ id: key(x), label: label(x) }));

  return (
    <>
      <PageHeader crumbs={[{ label: "Projects", to: "/projects" }, { label: project.title }]} title={project.title} description={project.summary} />

      <div className="container">
        {project.canEdit && (
          <AdminBar
            text={policy.isManager ? `${policy.isAdmin ? "Admin" : "Lab manager"}: manage this project.` : "You lead this project: edit its details, team and links."}
            actions={
              <>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => open("edit")}>
                  Edit project
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => open("members")}>
                  Members
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => open("areas")}>
                  Research areas
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => open("publications")}>
                  Publications
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => open("news")}>
                  News
                </button>
                {policy.canDeleteContent && (
                  <button className="btn btn--danger btn--sm" type="button" onClick={() => setPanel("delete")}>
                    Delete
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
                  <Icon name="users" size={14} /> Group:{" "}
                  <Link to={`/groups/${project.group.id}`} className="link">
                    {project.group.name}
                  </Link>
                </span>
              )}
            </div>
            {project.description && (
              <section aria-labelledby="project-about">
                <h2 className="sr-only" id="project-about">
                  About this project
                </h2>
                <p className="prose">{project.description}</p>
              </section>
            )}
          </div>

          <aside className="detail-layout__aside" aria-label="Project team and research areas">
            <section className="panel" aria-labelledby="project-team">
              <h2 className="panel__title" id="project-team">
                Team
              </h2>
              {project.members.length === 0 ? (
                <p className="text-sm text-muted">No members added yet.</p>
              ) : (
                <div className="panel__list">
                  {project.members.map((m) => (
                    <PersonLink key={m.teamMemberId} id={m.teamMemberId} name={m.name} initials={m.initials} detail={ROLE_LABELS[m.role] ?? m.role} />
                  ))}
                </div>
              )}
            </section>
            <section className="panel" aria-labelledby="project-areas">
              <h2 className="panel__title" id="project-areas">
                Research areas
              </h2>
              {project.areas.length === 0 ? (
                <p className="text-sm text-muted">No research areas linked yet.</p>
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
              <SectionHeader compact id="project-pubs" title={`Publications (${project.publications.length})`} />
              {project.publications.length === 0 ? (
                <EmptyState title="No publications linked yet." compact />
              ) : (
                <div className="pub-list">
                  {project.publications.map((p) => (
                    <PublicationItem key={p.id} publication={p} canEdit={false} canDelete={false} />
                  ))}
                </div>
              )}
            </section>

            <section className="detail-section" aria-labelledby="project-news">
              <SectionHeader compact id="project-news" title={`News (${project.news.length})`} />
              {project.news.length === 0 ? (
                <EmptyState title="No news linked yet." compact />
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
                  title="Gallery"
                  action={
                    <Link to={`/gallery?project=${project.id}`} className="btn btn--secondary btn--sm">
                      View all
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
                <SectionHeader compact id="project-forum" title="Community Discussions" />
                <ForumTopicList topics={discussions.topics} />
              </section>
            )}
          </div>
        </div>
      </div>

      <ProjectFormModal
        open={panel === "edit"}
        title="Edit project"
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
        title="Project members"
        description="Choose who works on this project and their role. Project leads can edit this project."
        people={asItems(team, (m) => `${m.name} — ${m.role}`, (m) => m.id)}
        roles={PROJECT_MEMBER_ROLES}
        roleLabels={ROLE_LABELS}
        selected={project.members.map((m) => ({ teamMemberId: m.teamMemberId, role: m.role }))}
        onClose={close}
        onSubmit={(members) => put("members", { members })}
      />

      <LinkItemsModal
        open={panel === "areas"}
        title="Research areas"
        description="Which research areas does this project belong to?"
        items={asItems(areas, (a) => `${a.icon} ${a.title}`, (a) => a.id)}
        selectedIds={project.areas.map((a) => a.id)}
        onClose={close}
        onSubmit={(ids) => put("areas", { areaIds: ids })}
      />

      <LinkItemsModal
        open={panel === "publications"}
        title="Project publications"
        description="Check every publication that came out of this project."
        items={asItems(pubs, (p) => `${p.title} (${p.year})`, (p) => p.id)}
        selectedIds={project.publications.map((p) => p.id)}
        onClose={close}
        onSubmit={(ids) => put("publications", { publicationIds: ids })}
      />

      <LinkItemsModal
        open={panel === "news"}
        title="Project news"
        description="Check the news items about this project. A news item can belong to one project at a time."
        items={asItems(news, (n) => `${n.title} (${n.date})`, (n) => n.id)}
        selectedIds={project.news.map((n) => n.id)}
        onClose={close}
        onSubmit={(ids) => put("news", { newsIds: ids })}
      />

      <ConfirmDeleteModal
        open={panel === "delete"}
        title="Delete project"
        message={`Delete "${project.title}"? Its team, area and publication links are removed; linked news items are kept. This cannot be undone.`}
        onClose={close}
        onConfirm={async () => {
          await apiFetch(`/projects/${project.id}`, { method: "DELETE" });
          navigate("/projects");
        }}
      />
    </>
  );
}
