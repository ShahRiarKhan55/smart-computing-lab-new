import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ConversationDetail, HistoryEntry, MemberProfile, NewsItem, Publication, ResearchArea, TeamMember } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { Avatar } from "../components/Avatar";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { SectionHeader } from "../components/SectionHeader";
import { RelatedResearch } from "../components/RelatedResearch";
import { PublicationItem } from "../components/PublicationItem";
import { NewsCard } from "../components/NewsCard";
import { EventCard } from "../components/EventCard";
import { TeamMemberFormModal } from "../components/TeamMemberFormModal";
import { HistoryFormModal } from "../components/HistoryFormModal";
import { LinkItemsModal } from "../components/LinkItemsModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import type { LinkableItem } from "../components/LinkItemsModal";
import { useT } from "../i18n/LocaleContext";

export function MemberPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const policy = usePolicy();
  const t = useT();
  const { data: profile, loading, error, status, reload } = useApiResource<MemberProfile>(`/member/${id}`);

  const [messaging, setMessaging] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [historyModal, setHistoryModal] = useState<{ open: boolean; entry: HistoryEntry | null }>({
    open: false,
    entry: null,
  });
  const [historyDelete, setHistoryDelete] = useState<HistoryEntry | null>(null);
  const [linkPubsOpen, setLinkPubsOpen] = useState(false);
  const [linkNewsOpen, setLinkNewsOpen] = useState(false);
  const [linkAreasOpen, setLinkAreasOpen] = useState(false);
  const [allAreas, setAllAreas] = useState<ResearchArea[] | null>(null);
  const [allPubs, setAllPubs] = useState<Publication[] | null>(null);
  const [allNews, setAllNews] = useState<NewsItem[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) {
    return (
      <>
        <PageHeader crumbs={[{ label: t("nav.team"), to: "/team" }, { label: t("common.loading") }]} title={t("common.loading")} />
        <div className="container">
          <LoadingState label={t("member.loadingProfile")} variant="text" />
        </div>
      </>
    );
  }

  if (status === 404 || (!profile && error)) {
    return (
      <>
        <PageHeader crumbs={[{ label: t("nav.team"), to: "/team" }, { label: t("common.notFoundCrumb") }]} title={t("member.notFoundTitle")} />
        <div className="container">
          <ErrorState message={error ?? t("member.notFoundMsg")} onRetry={status === 404 ? undefined : reload} />
          <Link to="/team" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> {t("member.allResearchers")}
          </Link>
        </div>
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <PageHeader crumbs={[{ label: t("nav.team"), to: "/team" }, { label: t("member.noProfileTitle") }]} title={t("member.noProfileTitle")} />
        <div className="container">
          <EmptyState title={t("member.noProfileMsg")} />
        </div>
      </>
    );
  }

  // `isOwn` is decided by the server; a logged-out visitor never counts as the owner, even if a
  // profile loaded while they were still signed in.
  const isOwner = Boolean(policy.user && profile.isOwn);
  const canEdit = policy.canEditProfile(profile.isOwn);

  // Starts (or reuses — Phase 12 §10) a direct conversation and opens it. `profile.canMessage` is
  // a server-decided UX hint (signed in, this profile has an account, not the viewer's own); the
  // API re-checks all of it, so a stale/forged click still can't message the wrong person.
  async function startConversation() {
    setActionError(null);
    setMessaging(true);
    try {
      const conversation = await apiFetch<ConversationDetail>("/messages/conversations", {
        method: "POST",
        body: JSON.stringify({ teamMemberId: profile!.id }),
      });
      navigate(`/messages/${conversation.id}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("member.couldNotStartConversation"));
      setMessaging(false);
    }
  }

  async function openLinkPubs() {
    setActionError(null);
    if (!allPubs) {
      try {
        setAllPubs(await apiFetch<Publication[]>("/publications"));
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : t("member.couldNotLoadPublications"));
        return;
      }
    }
    setLinkPubsOpen(true);
  }

  async function openLinkNews() {
    setActionError(null);
    if (!allNews) {
      try {
        setAllNews(await apiFetch<NewsItem[]>("/news"));
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : t("member.couldNotLoadNews"));
        return;
      }
    }
    setLinkNewsOpen(true);
  }

  async function openLinkAreas() {
    setActionError(null);
    if (!allAreas) {
      try {
        setAllAreas(await apiFetch<ResearchArea[]>("/research"));
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : t("common.couldNotLoadList"));
        return;
      }
    }
    setLinkAreasOpen(true);
  }

  const areaItems: LinkableItem[] = (allAreas ?? []).map((a) => ({ id: a.id, label: `${a.icon} ${a.title}` }));
  const pubItems: LinkableItem[] = (allPubs ?? []).map((p) => ({ id: p.id, label: `${p.title} (${p.year})` }));
  const newsItems: LinkableItem[] = (allNews ?? []).map((n) => ({ id: n.id, label: `${n.title} (${n.date})` }));

  return (
    <>
      <PageHeader
        crumbs={[{ label: t("nav.team"), to: "/team" }, { label: profile.name }]}
        title={profile.name}
        description={[profile.role, profile.department].filter(Boolean).join(" · ")}
      />

      <div className="container">
        {actionError && <ErrorState message={actionError} />}

        {canEdit && (
          <AdminBar
            text={isOwner ? t("member.ownProfileNote") : t("member.manageThisSuffix", { role: policy.roleLabel })}
            actions={
              <>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => setEditOpen(true)}>
                  {t("member.editProfile")}
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={openLinkPubs}>
                  {t("member.linkPublications")}
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={openLinkNews}>
                  {t("member.linkNews")}
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={openLinkAreas}>
                  {t("rs.member.linkAreas")}
                </button>
                <button className="btn btn--primary btn--sm" type="button" onClick={() => setHistoryModal({ open: true, entry: null })}>
                  + {t("member.addHistoryEntry")}
                </button>
              </>
            }
          />
        )}

        <div className="detail-layout detail-layout--aside-first">
          <div className="detail-layout__main">
            <section className="detail-section" aria-labelledby="member-bio">
              <SectionHeader compact id="member-bio" title={t("member.biography")} />
              {profile.bio ? <p className="prose">{profile.bio}</p> : <EmptyState title={t("member.noBioYet")} compact />}
            </section>

            <section className="detail-section" aria-labelledby="member-history">
              <SectionHeader compact id="member-history" title={t("member.history")} />
              {profile.history.length === 0 ? (
                <EmptyState title={t("member.noHistoryYet")} compact />
              ) : (
                <div>
                  {profile.history.map((h) => (
                    <div key={h.id} className="timeline-item">
                      <div className="timeline-item__year">{h.year}</div>
                      <div>
                        <div className="timeline-item__title">{h.title}</div>
                        {h.description && <div className="timeline-item__desc">{h.description}</div>}
                      </div>
                      {canEdit && (
                        <div className="pub-item__actions">
                          <button
                            className="icon-btn"
                            title={t("common.edit")}
                            aria-label={t("member.editEntry", { title: h.title })}
                            type="button"
                            onClick={() => setHistoryModal({ open: true, entry: h })}
                          >
                            <Icon name="edit" />
                          </button>
                          <button
                            className="icon-btn icon-btn--danger"
                            title={t("common.delete")}
                            aria-label={t("member.deleteEntry", { title: h.title })}
                            type="button"
                            onClick={() => setHistoryDelete(h)}
                          >
                            <Icon name="trash" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="detail-section" aria-labelledby="member-pubs">
              <SectionHeader compact id="member-pubs" title={t("member.publicationsHeading", { count: profile.publications.length })} />
              {profile.publications.length === 0 ? (
                <EmptyState title={t("member.noPubsLinked")} compact />
              ) : (
                <div className="pub-list">
                  {profile.publications.map((p) => (
                    <PublicationItem key={p.id} publication={p} canEdit={false} canDelete={false} />
                  ))}
                </div>
              )}
            </section>

            <section className="detail-section" aria-labelledby="member-news">
              <SectionHeader compact id="member-news" title={t("member.newsHeading", { count: profile.news.length })} />
              {profile.news.length === 0 ? (
                <EmptyState title={t("member.noNewsLinked")} compact />
              ) : (
                <div className="grid">
                  {profile.news.map((n) => (
                    <NewsCard key={n.id} item={n} />
                  ))}
                </div>
              )}
            </section>

            <section className="detail-section" aria-labelledby="member-events">
              <SectionHeader compact id="member-events" title={t("rs.member.eventsHeading", { count: profile.events.length })} />
              {profile.events.length === 0 ? (
                <EmptyState title={t("rs.member.noEvents")} compact />
              ) : (
                <div className="grid">
                  {profile.events.map((e) => (
                    <EventCard key={e.id} event={e} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="detail-layout__aside" aria-label={t("member.researcherSummaryAria")}>
            <section className="panel profile-summary" aria-label={t("profile.pageTitle")}>
              <Avatar size="xl" initials={profile.initials} photoUrl={profile.photoUrl} />
              <div>
                <p className="profile-summary__role">{profile.role}</p>
                {profile.department && <p className="profile-summary__dept">{profile.department}</p>}
              </div>
              {profile.canMessage && (
                <button type="button" className="btn btn--secondary btn--sm profile-summary__message" onClick={startConversation} disabled={messaging}>
                  <Icon name="message" size={14} /> {messaging ? t("member.opening") : t("member.message")}
                </button>
              )}
            </section>

            <section className="panel" aria-labelledby="member-areas">
              <h2 className="panel__title" id="member-areas">
                {t("rs.member.areasHeading")}
              </h2>
              {profile.areas.length === 0 ? (
                <p className="text-sm text-muted">{t("rs.member.noAreas")}</p>
              ) : (
                <div className="chips">
                  {profile.areas.map((a) => (
                    <Link key={a.id} to={`/research/${a.id}`} className="tag">
                      <span aria-hidden="true">{a.icon}</span> {a.title}
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {(profile.projects.length > 0 || profile.groups.length > 0) && (
              <section className="panel" aria-labelledby="member-affiliations">
                <h2 className="panel__title" id="member-affiliations">
                  {t("member.projectsAndGroups")}
                </h2>
                <div className="panel__list">
                  {profile.projects.map((p) => (
                    <Link key={p.id} to={`/projects/${p.id}`} className="person person--plain">
                      <span>
                        {p.title}
                        <small>
                          {t("member.projectLabel")} · {p.role === "LEAD" ? t("member.lead") : p.role.toLowerCase()}
                        </small>
                      </span>
                    </Link>
                  ))}
                  {profile.groups.map((g) => (
                    <Link key={g.id} to={`/groups/${g.id}`} className="person person--plain">
                      <span>
                        {g.name}
                        <small>
                          {t("member.groupLabel")} · {g.role === "LEAD" ? t("member.lead") : t("member.member")}
                        </small>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
            <RelatedResearch
              idPrefix="member"
              links={[
                ...(profile.publications.length > 0 ? [{ to: `/publications?researcher=${profile.id}`, label: t("explore.researcherPubs") }] : []),
                ...(profile.projects.length > 0 ? [{ to: `/projects?researcher=${profile.id}`, label: t("explore.researcherProjects") }] : []),
              ]}
            />
          </aside>
        </div>
      </div>

      <TeamMemberFormModal
        open={editOpen}
        title={t("member.editProfile")}
        initial={profile as Partial<TeamMember>}
        showAdminFields={policy.canManageTeamPlacement}
        onClose={() => setEditOpen(false)}
        onSubmit={async (values) => {
          await apiFetch(`/team/${profile.id}`, { method: "PUT", body: JSON.stringify(values) });
          reload();
        }}
      />

      <HistoryFormModal
        open={historyModal.open}
        initial={historyModal.entry}
        onClose={() => setHistoryModal({ open: false, entry: null })}
        onSubmit={async (values) => {
          if (historyModal.entry) {
            await apiFetch(`/member/${profile.id}/history/${historyModal.entry.id}`, {
              method: "PUT",
              body: JSON.stringify(values),
            });
          } else {
            await apiFetch(`/member/${profile.id}/history`, { method: "POST", body: JSON.stringify(values) });
          }
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={historyDelete !== null}
        title={t("member.deleteHistoryTitle")}
        message={historyDelete ? t("member.deleteHistoryMessage", { title: historyDelete.title }) : ""}
        onClose={() => setHistoryDelete(null)}
        onConfirm={async () => {
          if (!historyDelete) return;
          await apiFetch(`/member/${profile.id}/history/${historyDelete.id}`, { method: "DELETE" });
          reload();
        }}
      />

      <LinkItemsModal
        open={linkPubsOpen}
        title={t("member.selectYourPubsTitle")}
        description={t("member.selectYourPubsDesc")}
        items={pubItems}
        selectedIds={profile.publications.map((p) => p.id)}
        onClose={() => setLinkPubsOpen(false)}
        onSubmit={async (ids) => {
          await apiFetch(`/member/${profile.id}/publications`, {
            method: "PUT",
            body: JSON.stringify({ publicationIds: ids }),
          });
          reload();
        }}
      />

      <LinkItemsModal
        open={linkAreasOpen}
        title={t("rs.member.selectAreasTitle")}
        description={t("rs.member.selectAreasDesc")}
        items={areaItems}
        selectedIds={profile.areas.map((a) => a.id)}
        onClose={() => setLinkAreasOpen(false)}
        onSubmit={async (ids) => {
          await apiFetch(`/member/${profile.id}/areas`, { method: "PUT", body: JSON.stringify({ areaIds: ids }) });
          reload();
        }}
      />

      <LinkItemsModal
        open={linkNewsOpen}
        title={t("member.selectYourNewsTitle")}
        description={t("member.selectYourNewsDesc")}
        items={newsItems}
        selectedIds={profile.news.map((n) => n.id)}
        onClose={() => setLinkNewsOpen(false)}
        onSubmit={async (ids) => {
          await apiFetch(`/member/${profile.id}/news`, { method: "PUT", body: JSON.stringify({ newsIds: ids }) });
          reload();
        }}
      />
    </>
  );
}
