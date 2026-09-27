import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { PublicationAuthorsResponse, PublicationDetail, TeamMember } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { EventCard } from "../components/EventCard";
import { Icon } from "../components/Icon";
import { LoadingState } from "../components/LoadingState";
import { NewsCard } from "../components/NewsCard";
import { PersonLink } from "../components/PersonLink";
import { SectionHeader } from "../components/SectionHeader";
import { RelatedResearch } from "../components/RelatedResearch";
import { RelatedResources } from "../components/RelatedResources";
import { PublicationFormModal } from "../components/PublicationFormModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { LinkItemsModal } from "../components/LinkItemsModal";
import { VisibilityBadge } from "../components/VisibilityField";
import { PROJECT_STATUS_LABEL_KEY } from "../i18n/labels";
import { useT } from "../i18n/LocaleContext";

/**
 * One publication and what it is really linked to. Researchers and projects are direct links; areas,
 * groups, news and events come THROUGH its projects (the schema links those to a project only), and
 * the page says so. A hidden publication is a 404 from the API, so "missing" and "not yours to see"
 * look the same, and no title, breadcrumb or tab title of a hidden record is ever shown.
 */
export function PublicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const t = useT();
  const policy = usePolicy();
  const { data: pub, loading, error, status, reload } = useApiResource<PublicationDetail>(`/publications/${id}`);

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [authorIds, setAuthorIds] = useState<string[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const crumbsTo = [{ label: t("nav.publications"), to: "/publications" }];

  if (loading && (!pub || pub.id !== id)) {
    return (
      <>
        <PageHeader crumbs={[...crumbsTo, { label: t("common.loading") }]} title={t("common.loading")} />
        <div className="container">
          <LoadingState label={t("publications.detail.loading")} variant="text" />
        </div>
      </>
    );
  }

  if (status === 404 || status === 400 || (!pub && error)) {
    const missing = status === 404 || status === 400;
    return (
      <>
        <PageHeader crumbs={[...crumbsTo, { label: t("common.notFoundCrumb") }]} title={t("publications.detail.notFoundTitle")} />
        <div className="container">
          <ErrorState message={missing ? t("publications.detail.notFoundMsg") : t("publications.detail.couldNotLoad")} onRetry={missing ? undefined : reload} />
          <Link to="/publications" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> {t("publications.detail.all")}
          </Link>
        </div>
      </>
    );
  }
  if (!pub) return null;

  const isManager = policy.isManager;
  const ownMember = team?.find((m) => m.isOwn) ?? null;
  const links = [
    pub.pdfUrl && { href: pub.pdfUrl, label: t("publications.pdf") },
    pub.doiUrl && { href: pub.doiUrl, label: t("publications.doi") },
    pub.extraUrl && { href: pub.extraUrl, label: pub.extraLabel || t("common.link") },
  ].filter(Boolean) as { href: string; label: string }[];

  async function openManageAuthors() {
    setActionError(null);
    try {
      const [{ teamMemberIds }, members] = await Promise.all([apiFetch<PublicationAuthorsResponse>(`/publications/${pub!.id}/authors`), apiFetch<TeamMember[]>("/team")]);
      setTeam(members);
      setAuthorIds(teamMemberIds);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("publications.errorAuthors"));
    }
  }

  const lockedIds = isManager ? [] : (team ?? []).filter((m) => m.id !== ownMember?.id).map((m) => m.id);

  return (
    <>
      <PageHeader
        crumbs={[...crumbsTo, { label: pub.title }]}
        title={pub.title}
        seoDescription={`${pub.authors} — ${pub.venue} (${pub.year})`}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "ScholarlyArticle",
          headline: pub.title,
          author: pub.authors
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean)
            .map((name) => ({ "@type": "Person", name })),
          datePublished: String(pub.year),
          ...(pub.venue ? { publisher: { "@type": "Organization", name: pub.venue } } : {}),
        }}
      />

      <div className="container">
        {pub.canEdit && (
          <AdminBar
            text={`${isManager ? policy.roleLabel : t("common.loggedIn")}: ${t("publications.detail.manageBar")}`}
            actions={
              <>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => setEditing(true)}>
                  {t("common.edit")}
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={openManageAuthors}>
                  {t("publications.manageAuthors")}
                </button>
                {pub.canDelete && (
                  <button className="btn btn--danger btn--sm" type="button" onClick={() => setDeleting(true)}>
                    {t("common.delete")}
                  </button>
                )}
              </>
            }
          />
        )}
        {actionError && <ErrorState message={actionError} />}

        <div className="detail-layout detail-layout--project">
          <div className="detail-layout__a">
            <div className="detail-meta">
              <span className="detail-meta__item">
                <Icon name="calendar" size={14} /> {pub.year}
              </span>
              <VisibilityBadge visibility={pub.visibility} />
            </div>
            <p className="pub-detail__authors">{pub.authors}</p>
            <p className="pub-detail__venue">{pub.venue}</p>
            {links.length > 0 && (
              <div className="pub-item__links">
                {links.map((l) => (
                  <a key={l.label + l.href} href={l.href} className="pub-link" target="_blank" rel="noopener noreferrer">
                    {l.label}
                    <Icon name="external" size={11} />
                    <span className="sr-only">{t("publications.opensInNewTab")}</span>
                  </a>
                ))}
              </div>
            )}
          </div>

          <aside className="detail-layout__aside" aria-label={t("publications.detail.relatedNav")}>
            <section className="panel" aria-labelledby="pub-researchers">
              <h2 className="panel__title" id="pub-researchers">
                {t("publications.detail.researchersHeading", { count: pub.researchers.length })}
              </h2>
              {pub.researchers.length === 0 ? (
                <p className="text-sm text-muted">{t("publications.detail.noResearchers")}</p>
              ) : (
                <div className="panel__list">
                  {pub.researchers.map((r) => (
                    <PersonLink key={r.id} id={r.id} name={r.name} initials={r.initials} detail={r.role} />
                  ))}
                </div>
              )}
            </section>
            <section className="panel" aria-labelledby="pub-areas">
              <h2 className="panel__title" id="pub-areas">
                {t("publications.detail.areasHeading", { count: pub.areas.length })}
              </h2>
              {pub.areas.length === 0 ? (
                <p className="text-sm text-muted">{t("publications.detail.noAreas")}</p>
              ) : (
                <div className="chips">
                  {pub.areas.map((a) => (
                    <Link key={a.id} to={`/research/${a.id}`} className="tag">
                      <span aria-hidden="true">{a.icon}</span> {a.title}
                    </Link>
                  ))}
                </div>
              )}
            </section>
            <section className="panel" aria-labelledby="pub-groups">
              <h2 className="panel__title" id="pub-groups">
                {t("publications.detail.groupsHeading", { count: pub.groups.length })}
              </h2>
              {pub.groups.length === 0 ? (
                <p className="text-sm text-muted">{t("publications.detail.noGroups")}</p>
              ) : (
                <div className="chips">
                  {pub.groups.map((g) => (
                    <Link key={g.id} to={`/groups/${g.id}`} className="tag">
                      {g.name}
                    </Link>
                  ))}
                </div>
              )}
            </section>
            <RelatedResearch
              idPrefix="pub"
              links={[
                ...pub.researchers.slice(0, 3).map((r) => ({ to: `/publications?researcher=${r.id}`, label: t("explore.moreByResearcher", { name: r.name }) })),
                ...pub.projects.slice(0, 3).map((p) => ({ to: `/publications?project=${p.id}`, label: t("explore.moreFromProject", { name: p.title }) })),
                ...pub.areas.slice(0, 3).map((a) => ({ to: `/publications?area=${a.id}`, label: t("explore.moreInArea", { name: a.title }) })),
                ...pub.groups.slice(0, 2).map((g) => ({ to: `/publications?group=${g.id}`, label: t("explore.moreFromGroup", { name: g.name }) })),
              ]}
            />
          </aside>

          <div className="detail-layout__b">
            <section className="detail-section" aria-labelledby="pub-projects">
              <SectionHeader compact id="pub-projects" title={t("publications.detail.projectsHeading", { count: pub.projects.length })} description={t("publications.detail.derivedNote")} />
              {pub.projects.length === 0 ? (
                <EmptyState title={t("publications.detail.noProjects")} compact />
              ) : (
                <ul className="pub-detail__projects">
                  {pub.projects.map((p) => (
                    <li key={p.id}>
                      <Link to={`/projects/${p.id}`} className="link">
                        {p.title}
                      </Link>{" "}
                      <span className="badge">{t(PROJECT_STATUS_LABEL_KEY[p.status])}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="detail-section" aria-labelledby="pub-news">
              <SectionHeader compact id="pub-news" title={t("publications.detail.newsHeading", { count: pub.news.length })} />
              {pub.news.length === 0 ? (
                <EmptyState title={t("publications.detail.noNews")} compact />
              ) : (
                <div className="grid">
                  {pub.news.map((n) => (
                    <NewsCard key={n.id} item={n} />
                  ))}
                </div>
              )}
            </section>

            <section className="detail-section" aria-labelledby="pub-events">
              <SectionHeader compact id="pub-events" title={t("publications.detail.eventsHeading", { count: pub.events.length })} />
              {pub.events.length === 0 ? (
                <EmptyState title={t("publications.detail.noEvents")} compact />
              ) : (
                <div className="grid">
                  {pub.events.map((e) => (
                    <EventCard key={e.id} event={e} />
                  ))}
                </div>
              )}
            </section>

            <RelatedResources relation="publication" id={pub.id} idPrefix="pub" />
          </div>
        </div>
      </div>

      <PublicationFormModal
        open={editing}
        title={t("publications.editTitle")}
        initial={pub}
        canLinkSelf={false}
        canSetVisibility={policy.canChangeVisibility}
        onClose={() => setEditing(false)}
        onSubmit={async (fields) => {
          await apiFetch(`/publications/${pub.id}`, { method: "PUT", body: JSON.stringify(fields) });
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={deleting}
        title={t("publications.deleteTitle")}
        message={t("publications.deleteConfirm", { title: pub.title })}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await apiFetch(`/publications/${pub.id}`, { method: "DELETE" });
          navigate("/publications");
        }}
      />

      <LinkItemsModal
        open={authorIds !== null}
        title={t("publications.manageAuthors")}
        description={isManager ? t("publications.manageAuthorsHelpManager") : t("publications.manageAuthorsHelpMember")}
        items={(team ?? []).map((m) => ({ id: m.id, label: `${m.name} — ${m.role}` }))}
        selectedIds={authorIds ?? []}
        disabledIds={lockedIds}
        onClose={() => setAuthorIds(null)}
        onSubmit={async (ids) => {
          await apiFetch(`/publications/${pub.id}/authors`, { method: "PUT", body: JSON.stringify({ teamMemberIds: ids }) });
          reload();
        }}
      />
    </>
  );
}
