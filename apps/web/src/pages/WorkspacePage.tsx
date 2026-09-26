import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type {
  TranslationKey,
  WorkspaceArea,
  WorkspaceCollaborator,
  WorkspaceGroup,
  WorkspacePerson,
  WorkspaceProject,
  WorkspaceResponse,
  WorkspaceSection,
} from "@scl/shared";
import { useApiResource } from "../hooks/useApiResource";
import { PageHeader } from "../components/PageHeader";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { SectionHeader } from "../components/SectionHeader";
import { StatusBadge } from "../components/Badge";
import { VisibilityBadge } from "../components/VisibilityField";
import { Avatar } from "../components/Avatar";
import { PublicationItem } from "../components/PublicationItem";
import { EventCard } from "../components/EventCard";
import { NewsCard } from "../components/NewsCard";
import { KnowledgeCard } from "../components/KnowledgeCard";
import { ManageMembersModal, type MembershipKind } from "../components/ManageMembersModal";
import { formatNumber } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";

const PROJECT_ROLE_KEY: Record<string, TranslationKey> = { LEAD: "projects.role.LEAD", MEMBER: "projects.role.MEMBER", COLLABORATOR: "projects.role.COLLABORATOR" };
const GROUP_ROLE_KEY: Record<string, TranslationKey> = { LEAD: "groups.role.LEAD", MEMBER: "groups.role.MEMBER" };

interface Managing {
  kind: MembershipKind;
  id: string;
  name: string;
}

/**
 * Phase 21: the researcher's own collaboration workspace. One request (`GET /api/workspace`) returns
 * every section already filtered to what this account may see; this page only lays it out. Every card
 * links to the existing detail page, and the "all ..." links go to lists that really read the filter
 * (`/projects?researcher=`, `/publications?researcher=`). Members management opens a dialog only on
 * cards whose `canManageMembers` the SERVER set; the API re-checks every write.
 */
export function WorkspacePage() {
  const { locale, t } = useLocale();
  const { data, loading, error, reload } = useApiResource<WorkspaceResponse>("/workspace");
  const [managing, setManaging] = useState<Managing | null>(null);
  const n = (v: number) => formatNumber(v, locale);
  const list = new Intl.ListFormat(locale, { style: "narrow", type: "unit" });

  const header = <PageHeader eyebrow={t("workspace.eyebrow")} title={t("workspace.pageTitle")} description={t("workspace.pageDescription")} />;

  if (loading && !data) {
    return (
      <>
        {header}
        <div className="container">
          <LoadingState label={t("workspace.loading")} variant="cards" />
        </div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        {header}
        <div className="container">
          <ErrorState message={error ?? t("workspace.couldNotLoad")} onRetry={reload} />
        </div>
      </>
    );
  }

  const { profile } = data;
  if (!profile) {
    return (
      <>
        {header}
        <div className="container">
          <EmptyState title={t("workspace.noProfileTitle")} action={<Link to="/team" className="btn btn--secondary btn--sm">{t("workspace.noProfileLink")}</Link>}>
            {t("workspace.noProfileText")}
          </EmptyState>
        </div>
      </>
    );
  }

  const more = (s: WorkspaceSection<unknown>) => (s.total > s.items.length ? <p className="text-sm text-muted ws-more">{t("workspace.showingOf", { shown: n(s.items.length), total: n(s.total) })}</p> : null);
  const link = (to: string, label: string) => (
    <Link to={to} className="btn btn--secondary btn--sm">
      {label}
    </Link>
  );

  const section = (id: string, title: string, sec: WorkspaceSection<unknown>, empty: string, body: ReactNode, action?: ReactNode) => (
    <section className="detail-section ws-section" aria-labelledby={`ws-${id}`}>
      <SectionHeader compact id={`ws-${id}`} title={title} action={sec.total > 0 ? action : undefined} />
      {sec.items.length === 0 ? <EmptyState title={empty} compact /> : body}
      {more(sec)}
    </section>
  );

  return (
    <>
      {header}
      <div className="container ws">
        {section(
          "projects",
          t("workspace.projectsHeading", { count: n(data.projects.total) }),
          data.projects,
          t("workspace.noProjects"),
          <div className="grid">
            {data.projects.items.map((p) => (
              <ProjectTile key={p.id} project={p} list={list} onManage={() => setManaging({ kind: "project", id: p.id, name: p.title })} />
            ))}
          </div>,
          link(`/projects?researcher=${profile.id}`, t("workspace.link.projects")),
        )}

        {section(
          "groups",
          t("workspace.groupsHeading", { count: n(data.groups.total) }),
          data.groups,
          t("workspace.noGroups"),
          <div className="grid">
            {data.groups.items.map((g) => (
              <GroupTile key={g.id} group={g} list={list} onManage={() => setManaging({ kind: "group", id: g.id, name: g.name })} />
            ))}
          </div>,
        )}

        {section(
          "areas",
          t("workspace.areasHeading", { count: n(data.areas.total) }),
          data.areas,
          t("workspace.noAreas"),
          <div className="grid">
            {data.areas.items.map((a) => (
              <AreaTile key={a.id} area={a} />
            ))}
          </div>,
        )}

        {section(
          "publications",
          t("workspace.publicationsHeading", { count: n(data.publications.total) }),
          data.publications,
          t("workspace.noPublications"),
          <div className="pub-list">
            {data.publications.items.map((p) => (
              <PublicationItem key={p.id} publication={p} canEdit={false} canDelete={false} />
            ))}
          </div>,
          link(`/publications?researcher=${profile.id}`, t("workspace.link.publications")),
        )}

        {section(
          "events",
          t("workspace.eventsHeading", { count: n(data.events.total) }),
          data.events,
          t("workspace.noEvents"),
          <div className="grid">
            {data.events.items.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>,
          link("/events", t("workspace.link.events")),
        )}

        {section(
          "news",
          t("workspace.newsHeading", { count: n(data.news.total) }),
          data.news,
          t("workspace.noNews"),
          <div className="grid">
            {data.news.items.map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>,
          link("/news", t("workspace.link.news")),
        )}

        {section(
          "knowledge",
          t("knowledge.workspace.heading"),
          data.knowledge,
          t("knowledge.workspace.empty"),
          <div className="grid">
            {data.knowledge.items.map((doc) => (
              <KnowledgeCard key={doc.id} doc={doc} />
            ))}
          </div>,
          link("/knowledge?mine=1", t("knowledge.workspace.viewAll", { count: n(data.knowledge.total) })),
        )}

        <section className="detail-section ws-section" aria-labelledby="ws-network">
          <SectionHeader compact id="ws-network" title={t("workspace.collaboratorsHeading", { count: n(data.collaborators.total) })} description={t("workspace.collaboratorsIntro")} action={data.collaborators.total > 0 ? link("/team", t("workspace.link.team")) : undefined} />
          {data.collaborators.items.length === 0 ? (
            <EmptyState title={t("workspace.noCollaborators")} compact />
          ) : (
            <ul className="ws-people">
              {data.collaborators.items.map((c) => (
                <li key={c.id}>
                  <CollaboratorTile person={c} />
                </li>
              ))}
            </ul>
          )}
          {more(data.collaborators)}
        </section>
      </div>

      {managing && (
        <ManageMembersModal
          open
          kind={managing.kind}
          id={managing.id}
          name={managing.name}
          onClose={() => setManaging(null)}
          onChanged={reload}
        />
      )}
    </>
  );
}

type ListFmt = Intl.ListFormat;

function names(people: WorkspacePerson[], list: ListFmt) {
  return list.format(people.map((p) => p.name));
}

function Stat({ children }: { children: ReactNode }) {
  return <li className="ws-stats__item">{children}</li>;
}

function ProjectTile({ project: p, list, onManage }: { project: WorkspaceProject; list: ListFmt; onManage: () => void }) {
  const { locale, t } = useLocale();
  const n = (v: number) => formatNumber(v, locale);
  return (
    <article className="card card--interactive ws-card">
      <div className="card__top">
        <StatusBadge status={p.status} />
        <VisibilityBadge visibility={p.visibility} />
      </div>
      <h3 className="card__title">
        <Link to={`/projects/${p.id}`}>{p.title}</Link>
      </h3>
      {p.summary && <p className="card__text">{p.summary}</p>}
      <p className="card__meta">{p.leads.length > 0 ? t("workspace.project.lead", { names: names(p.leads, list) }) : t("workspace.project.noLead")}</p>
      {(p.group || p.areas.length > 0) && (
        <div className="chips">
          {p.group && (
            <Link to={`/groups/${p.group.id}`} className="tag">
              {p.group.name}
            </Link>
          )}
          {p.areas.map((a) => (
            <Link key={a.id} to={`/research/${a.id}`} className="tag">
              <span aria-hidden="true">{a.icon}</span> {a.title}
            </Link>
          ))}
        </div>
      )}
      <ul className="ws-stats">
        <Stat>{t("workspace.project.members", { count: n(p.memberCount) })}</Stat>
        <Stat>{t("workspace.project.publications", { count: n(p.publicationCount) })}</Stat>
        <Stat>{t("workspace.project.events", { count: n(p.upcomingEventCount) })}</Stat>
      </ul>
      <div className="card__foot ws-foot">
        <span className="text-sm text-muted">{t("workspace.yourRole", { role: t(PROJECT_ROLE_KEY[p.myRole]) })}</span>
        {p.canManageMembers && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={onManage} aria-label={t("workspace.manage.buttonFor", { name: p.title })}>
            {t("workspace.manage.button")}
          </button>
        )}
      </div>
    </article>
  );
}

function GroupTile({ group: g, list, onManage }: { group: WorkspaceGroup; list: ListFmt; onManage: () => void }) {
  const { locale, t } = useLocale();
  const n = (v: number) => formatNumber(v, locale);
  return (
    <article className="card card--interactive ws-card">
      <div className="card__top">
        <VisibilityBadge visibility={g.visibility} />
      </div>
      <h3 className="card__title">
        <Link to={`/groups/${g.id}`}>{g.name}</Link>
      </h3>
      <p className="card__meta">{g.leads.length > 0 ? t("workspace.project.lead", { names: names(g.leads, list) }) : t("workspace.project.noLead")}</p>
      <ul className="ws-stats">
        <Stat>{t("workspace.group.members", { count: n(g.memberCount) })}</Stat>
        <Stat>{t("workspace.group.projects", { count: n(g.projectCount) })}</Stat>
        <Stat>{t("workspace.group.areas", { count: n(g.areaCount) })}</Stat>
      </ul>
      <div className="card__foot ws-foot">
        <span className="text-sm text-muted">{t("workspace.yourRole", { role: t(GROUP_ROLE_KEY[g.myRole]) })}</span>
        {g.canManageMembers && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={onManage} aria-label={t("workspace.manage.buttonFor", { name: g.name })}>
            {t("workspace.manage.button")}
          </button>
        )}
      </div>
    </article>
  );
}

function AreaTile({ area: a }: { area: WorkspaceArea }) {
  const { locale, t } = useLocale();
  const n = (v: number) => formatNumber(v, locale);
  return (
    <article className="card card--interactive ws-card">
      <div className="card__top">
        <span className="badge">{a.linked ? t("workspace.area.onProfile") : t("workspace.area.viaProjects")}</span>
        <VisibilityBadge visibility={a.visibility} />
      </div>
      <h3 className="card__title">
        <Link to={`/research/${a.id}`}>
          <span aria-hidden="true">{a.icon}</span> {a.title}
        </Link>
      </h3>
      <ul className="ws-stats">
        <Stat>{t("workspace.area.projects", { count: n(a.projectCount) })}</Stat>
        <Stat>{t("workspace.area.researchers", { count: n(a.researcherCount) })}</Stat>
      </ul>
    </article>
  );
}

function CollaboratorTile({ person: c }: { person: WorkspaceCollaborator }) {
  const { locale, t } = useLocale();
  const n = (v: number) => formatNumber(v, locale);
  return (
    <div className="card ws-person">
      <Avatar size="sm" initials={c.initials} />
      <div className="ws-person__body">
        <Link to={`/team/${c.id}`} className="ws-person__name">
          {c.name}
        </Link>
        <span className="ws-person__role">{c.role}</span>
        <ul className="ws-stats ws-stats--inline">
          {c.sharedProjects > 0 && <Stat>{t("workspace.collab.projects", { count: n(c.sharedProjects) })}</Stat>}
          {c.sharedGroups > 0 && <Stat>{t("workspace.collab.groups", { count: n(c.sharedGroups) })}</Stat>}
          {c.sharedAreas > 0 && <Stat>{t("workspace.collab.areas", { count: n(c.sharedAreas) })}</Stat>}
        </ul>
      </div>
    </div>
  );
}
