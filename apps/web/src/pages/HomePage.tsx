import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { NewsItem, ProjectSummary, Publication, ResearchArea, TeamMember } from "@scl/shared";
import { useApiResource } from "../hooks/useApiResource";
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
import { useT } from "../i18n/LocaleContext";

const FEATURED_PROJECTS = 3;
const RECENT_PUBLICATIONS = 4;
const LATEST_NEWS = 3;

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
      <section className="band band--flush" aria-label="The lab in numbers">
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
                  <Link to="/research">{area.title}</Link>
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
                  <Link to="/research">{area.title}</Link>
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
    </>
  );
}
