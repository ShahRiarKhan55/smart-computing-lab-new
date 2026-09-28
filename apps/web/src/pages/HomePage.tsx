import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { LabEvent, NewsItem, ProjectSummary, Publication, ResearchArea, ResourceListResponse, TeamMember } from "@scl/shared";
import { useApiResource } from "../hooks/useApiResource";
import { useSeo } from "../hooks/useSeo";
import { HeroCircuit } from "../components/HeroCircuit";
import { Icon } from "../components/Icon";
import { SectionHeader } from "../components/SectionHeader";
import { StatCard } from "../components/StatCard";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { ProjectCard } from "../components/ProjectCard";
import { PublicationItem } from "../components/PublicationItem";
import { NewsCard } from "../components/NewsCard";
import { EventCard } from "../components/EventCard";
import { TeamCard } from "../components/TeamCard";
import { ResourceCard } from "../components/ResourceCard";
import { useT } from "../i18n/LocaleContext";

const FEATURED_PROJECTS = 3;
const RECENT_PUBLICATIONS = 4;
const LATEST_NEWS = 3;
const NEXT_EVENTS = 3;
const FEATURED_RESEARCHERS = 4;
const FEATURED_RESOURCES = 4;

function ViewAll({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="btn btn--secondary btn--sm">
      {children} <Icon name="arrow-right" size={14} />
    </Link>
  );
}

/** Everything on this page comes from the public API for the current visitor; no number or list is hard-coded. */
export function HomePage() {
  const t = useT();
  const areas = useApiResource<ResearchArea[]>("/research");
  const projects = useApiResource<ProjectSummary[]>("/projects");
  const publications = useApiResource<Publication[]>("/publications");
  const team = useApiResource<TeamMember[]>("/team");
  const news = useApiResource<NewsItem[]>("/news");
  const events = useApiResource<LabEvent[]>(`/events?scope=upcoming&limit=${NEXT_EVENTS}`);
  const resources = useApiResource<ResourceListResponse>(`/resources?limit=${FEATURED_RESOURCES}`);

  // Home has no <title>; index.html's static title is already correct, so leave document.title
  // alone here and only add the meta description / Open Graph / Organization structured data.
  useSeo({
    title: null,
    description: t("home.heroSubtitle"),
    jsonLd: { "@context": "https://schema.org", "@type": "Organization", name: "Smart Computing Lab", url: window.location.origin },
  });

  // Selected projects: the ones under way first, then the rest, in the API's own order.
  const featured = useMemo(() => {
    const list = projects.data ?? [];
    return [...list.filter((p) => p.status === "ACTIVE"), ...list.filter((p) => p.status !== "ACTIVE")].slice(0, FEATURED_PROJECTS);
  }, [projects.data]);

  // "Research at a glance": for each area, the projects linked to it and the researchers on those projects.
  const network = useMemo(() => {
    const projectList = projects.data;
    if (!areas.data || !projectList) return [];
    return areas.data
      .map((area) => {
        const linked = projectList.filter((p) => p.areas.some((a) => a.id === area.id));
        const researchers = new Set(linked.flatMap((p) => p.members.map((m) => m.teamMemberId)));
        return { area, projects: linked.length, researchers: researchers.size };
      })
      .filter((row) => row.projects > 0);
  }, [areas.data, projects.data]);
  const maxProjects = Math.max(1, ...network.map((row) => row.projects));

  return (
    <>
      {/* ===================== HERO ===================== */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__inner">
          <div>
            <span className="badge badge--brand hero__badge">{t("home.badge")}</span>
            <h1 className="hero__title" id="hero-title">
              Smart <em>Computing</em> Lab
            </h1>
            <p className="hero__subtitle">{t("home.heroSubtitle")}</p>
            <div className="hero__actions">
              <Link to="/research" className="btn btn--primary btn--lg">
                {t("home.exploreResearch")} <Icon name="arrow-right" size={16} />
              </Link>
              <Link to="/team" className="btn btn--secondary btn--lg">
                {t("home.meetResearchers")}
              </Link>
            </div>
          </div>
          <div className="hero__visual" aria-hidden="true">
            <HeroCircuit />
          </div>
        </div>
      </section>

      {/* ===================== LAB STATISTICS (live counts) ===================== */}
      <section className="band band--flush" aria-label={t("home.labInNumbersAria")}>
        <div className="band__inner section--tight">
          <div className="stat-grid">
            <StatCard value={team.data ? team.data.length : null} label={t("home.statResearchers")} />
            <StatCard value={projects.data ? projects.data.length : null} label={t("home.statProjects")} />
            <StatCard value={publications.data ? publications.data.length : null} label={t("home.statPublications")} />
            <StatCard value={areas.data ? areas.data.length : null} label={t("home.statResearchAreas")} />
          </div>
        </div>
      </section>

      {/* ===================== RESEARCH AREAS ===================== */}
      <section className="section" aria-labelledby="home-areas">
        <SectionHeader
          id="home-areas"
          eyebrow={t("home.areasEyebrow")}
          title={t("home.areasTitle")}
          action={<ViewAll to="/research">{t("home.allResearchAreas")}</ViewAll>}
        />
        {areas.loading && !areas.data && <LoadingState label={t("home.loadingAreas")} />}
        {areas.error && <ErrorState message={t("home.errorAreas")} onRetry={areas.reload} />}
        {areas.data && areas.data.length === 0 && <EmptyState title={t("home.emptyAreas")} compact />}
        {areas.data && areas.data.length > 0 && (
          <div className="grid grid--tight">
            {areas.data.slice(0, 6).map((area) => (
              <article className="card card--interactive area-tile" key={area.id}>
                <span className="icon-tile" aria-hidden="true">
                  {area.icon}
                </span>
                <h3 className="card__title">
                  <Link to={`/research/${area.id}`}>{area.title}</Link>
                </h3>
                <p className="card__text">{area.description}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ===================== PROJECTS ===================== */}
      <section className="band" aria-labelledby="home-projects">
        <div className="band__inner">
          <SectionHeader
            id="home-projects"
            eyebrow={t("home.projectsEyebrow")}
            title={t("home.projectsTitle")}
            action={<ViewAll to="/projects">{t("home.allProjects")}</ViewAll>}
          />
          {projects.loading && !projects.data && <LoadingState label={t("home.loadingProjects")} />}
          {projects.error && <ErrorState message={t("home.errorProjects")} onRetry={projects.reload} />}
          {projects.data && projects.data.length === 0 && <EmptyState title={t("home.emptyProjects")} compact />}
          {featured.length > 0 && (
            <div className="grid">
              {featured.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ===================== RESEARCH AT A GLANCE (only real links between projects and areas) ===================== */}
      {network.length > 0 && (
        <section className="section" aria-labelledby="home-network">
          <SectionHeader
            id="home-network"
            eyebrow={t("home.networkEyebrow")}
            title={t("home.networkTitle")}
            description={t("home.networkDescription")}
          />
          <div className="network">
            {network.map(({ area, projects: count, researchers }) => (
              <div className="network__row" key={area.id}>
                <div className="network__name">
                  <span className="icon-tile icon-tile--sm" aria-hidden="true">
                    {area.icon}
                  </span>
                  <Link to={`/research/${area.id}`}>{area.title}</Link>
                </div>
                <div className="network__bar" aria-hidden="true">
                  <span style={{ width: `${(count / maxProjects) * 100}%` }} />
                </div>
                <div className="network__figures">
                  <span>
                    <strong>{count}</strong> {t(count === 1 ? "home.networkProject" : "home.networkProjects")}
                  </span>
                  <span>
                    <strong>{researchers}</strong> {t(researchers === 1 ? "home.networkResearcher" : "home.networkResearchers")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ===================== RECENT PUBLICATIONS ===================== */}
      <section className={network.length > 0 ? "band" : "section"} aria-labelledby="home-pubs">
        <div className={network.length > 0 ? "band__inner" : undefined}>
          <SectionHeader
            id="home-pubs"
            eyebrow={t("home.pubsEyebrow")}
            title={t("home.pubsTitle")}
            action={<ViewAll to="/publications">{t("home.allPublications")}</ViewAll>}
          />
          {publications.loading && !publications.data && <LoadingState label={t("home.loadingPublications")} variant="list" />}
          {publications.error && <ErrorState message={t("home.errorPublications")} onRetry={publications.reload} />}
          {publications.data && publications.data.length === 0 && <EmptyState title={t("home.emptyPublications")} compact />}
          {publications.data && publications.data.length > 0 && (
            <div className="pub-list">
              {publications.data.slice(0, RECENT_PUBLICATIONS).map((p) => (
                <PublicationItem key={p.id} publication={p} canEdit={false} canDelete={false} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ===================== LATEST NEWS ===================== */}
      <section className={network.length > 0 ? "section" : "band"} aria-labelledby="home-news">
        <div className={network.length > 0 ? undefined : "band__inner"}>
          <SectionHeader id="home-news" eyebrow={t("home.newsEyebrow")} title={t("home.newsTitle")} action={<ViewAll to="/news">{t("home.allNews")}</ViewAll>} />
          {news.loading && !news.data && <LoadingState label={t("home.loadingNews")} />}
          {news.error && <ErrorState message={t("home.errorNews")} onRetry={news.reload} />}
          {news.data && news.data.length === 0 && <EmptyState title={t("home.emptyNews")} compact />}
          {news.data && news.data.length > 0 && (
            <div className="grid">
              {news.data.slice(0, LATEST_NEWS).map((item) => (
                <NewsCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ===================== UPCOMING EVENTS (Phase 16; the page never depends on there being any) ===================== */}
      <section className={network.length > 0 ? "band" : "section"} aria-labelledby="home-events">
        <div className={network.length > 0 ? "band__inner" : undefined}>
          <SectionHeader id="home-events" eyebrow={t("home.eventsEyebrow")} title={t("home.eventsTitle")} action={<ViewAll to="/events">{t("home.allEvents")}</ViewAll>} />
          {events.loading && !events.data && <LoadingState label={t("home.loadingEvents")} />}
          {events.error && <ErrorState message={t("home.errorEvents")} onRetry={events.reload} />}
          {events.data && events.data.length === 0 && <EmptyState title={t("home.emptyEvents")} compact />}
          {events.data && events.data.length > 0 && (
            <div className="grid">
              {events.data.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ===================== RESEARCHERS (who does the work) ===================== */}
      <section className={network.length > 0 ? "section" : "band"} aria-labelledby="home-researchers">
        <div className={network.length > 0 ? undefined : "band__inner"}>
          <SectionHeader
            id="home-researchers"
            eyebrow={t("home.researchersEyebrow")}
            title={t("home.researchersTitle")}
            action={<ViewAll to="/team">{t("home.allResearchers")}</ViewAll>}
          />
          {team.loading && !team.data && <LoadingState label={t("home.loadingResearchers")} />}
          {team.error && <ErrorState message={t("home.errorResearchers")} onRetry={team.reload} />}
          {team.data && team.data.length === 0 && <EmptyState title={t("home.emptyResearchers")} compact />}
          {team.data && team.data.length > 0 && (
            <div className="grid grid--tight">
              {team.data.slice(0, FEATURED_RESEARCHERS).map((member) => (
                <TeamCard key={member.id} member={member} canEdit={false} canDelete={false} onEdit={() => {}} onDelete={() => {}} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ===================== RESOURCES & TECHNOLOGIES (what the work runs on; omitted entirely once loaded-but-empty) ===================== */}
      {(resources.loading || (resources.data && resources.data.items.length > 0)) && (
        <section className={network.length > 0 ? "band" : "section"} aria-labelledby="home-resources">
          <div className={network.length > 0 ? "band__inner" : undefined}>
            <SectionHeader
              id="home-resources"
              eyebrow={t("home.resourcesEyebrow")}
              title={t("home.resourcesTitle")}
              action={<ViewAll to="/resources">{t("home.allResources")}</ViewAll>}
            />
            {resources.loading && !resources.data && <LoadingState label={t("home.loadingResources")} />}
            {resources.error && <ErrorState message={t("home.errorResources")} onRetry={resources.reload} />}
            {resources.data && resources.data.items.length > 0 && (
              <div className="grid">
                {resources.data.items.map((r) => (
                  <ResourceCard key={r.id} resource={r} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ===================== CONTACT CTA ===================== */}
      <section className="band band--flush" aria-labelledby="home-cta">
        <div className="band__inner section--tight">
          <div className="cta-band">
            <div>
              {/* `.eyebrow` (not `.page-header__eyebrow`): that class's light-green text is styled for
                  the dark `.page-header` banner. This band sits on the light `--surface-alt` background
                  like every other in-page section, so it uses the same eyebrow style `SectionHeader`/
                  `NotFoundPage` already use there (Phase 25: fixes a 1.83:1 WCAG AA contrast failure). */}
              <p className="eyebrow">{t("home.ctaEyebrow")}</p>
              <h2 id="home-cta">{t("home.ctaTitle")}</h2>
              <p className="text-muted">{t("home.ctaDescription")}</p>
            </div>
            <Link to="/contact" className="btn btn--primary btn--lg">
              {t("home.ctaAction")} <Icon name="arrow-right" size={16} />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
