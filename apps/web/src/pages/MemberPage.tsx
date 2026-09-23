import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ConversationDetail, HistoryEntry, MemberProfile, NewsItem, Publication, TeamMember } from "@scl/shared";
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
import { PublicationItem } from "../components/PublicationItem";
import { NewsCard } from "../components/NewsCard";
import { TeamMemberFormModal } from "../components/TeamMemberFormModal";
import { HistoryFormModal } from "../components/HistoryFormModal";
import { LinkItemsModal } from "../components/LinkItemsModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import type { LinkableItem } from "../components/LinkItemsModal";

export function MemberPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const policy = usePolicy();
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
  const [allPubs, setAllPubs] = useState<Publication[] | null>(null);
  const [allNews, setAllNews] = useState<NewsItem[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Team", to: "/team" }, { label: "Loading…" }]} title="Loading…" />
        <div className="container">
          <LoadingState label="Loading profile…" variant="text" />
        </div>
      </>
    );
  }

  if (status === 404 || (!profile && error)) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Team", to: "/team" }, { label: "Not found" }]} title="Profile not found" />
        <div className="container">
          <ErrorState message={error ?? "This team member could not be found."} onRetry={status === 404 ? undefined : reload} />
          <Link to="/team" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> All researchers
          </Link>
        </div>
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Team", to: "/team" }, { label: "No profile" }]} title="No profile specified" />
        <div className="container">
          <EmptyState title="No member id was given." />
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
      setActionError(err instanceof ApiError ? err.message : "Could not start a conversation.");
      setMessaging(false);
    }
  }

  async function openLinkPubs() {
    setActionError(null);
    if (!allPubs) {
      try {
        setAllPubs(await apiFetch<Publication[]>("/publications"));
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : "Could not load publications.");
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
        setActionError(err instanceof ApiError ? err.message : "Could not load news.");
        return;
      }
    }
    setLinkNewsOpen(true);
  }

  const pubItems: LinkableItem[] = (allPubs ?? []).map((p) => ({ id: p.id, label: `${p.title} (${p.year})` }));
  const newsItems: LinkableItem[] = (allNews ?? []).map((n) => ({ id: n.id, label: `${n.title} (${n.date})` }));

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Team", to: "/team" }, { label: profile.name }]}
        title={profile.name}
        description={[profile.role, profile.department].filter(Boolean).join(" · ")}
      />

      <div className="container">
        {actionError && <ErrorState message={actionError} />}

        {canEdit && (
          <AdminBar
            text={
              isOwner
                ? "This is your profile — add history, or link your publications and news."
                : `${policy.roleLabel}: manage this member's profile, history, and linked publications/news.`
            }
            actions={
              <>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => setEditOpen(true)}>
                  Edit profile
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={openLinkPubs}>
                  Link publications
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={openLinkNews}>
                  Link news
                </button>
                <button className="btn btn--primary btn--sm" type="button" onClick={() => setHistoryModal({ open: true, entry: null })}>
                  + Add history entry
                </button>
              </>
            }
          />
        )}

        <div className="detail-layout detail-layout--aside-first">
          <div className="detail-layout__main">
            <section className="detail-section" aria-labelledby="member-bio">
              <SectionHeader compact id="member-bio" title="Biography" />
              {profile.bio ? <p className="prose">{profile.bio}</p> : <EmptyState title="No bio added yet." compact />}
            </section>

            <section className="detail-section" aria-labelledby="member-history">
              <SectionHeader compact id="member-history" title="History" />
              {profile.history.length === 0 ? (
                <EmptyState title="No history added yet." compact />
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
                          <button className="icon-btn" title="Edit" aria-label={`Edit ${h.title}`} type="button" onClick={() => setHistoryModal({ open: true, entry: h })}>
                            <Icon name="edit" />
                          </button>
                          <button className="icon-btn icon-btn--danger" title="Delete" aria-label={`Delete ${h.title}`} type="button" onClick={() => setHistoryDelete(h)}>
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
              <SectionHeader compact id="member-pubs" title={`Publications (${profile.publications.length})`} />
              {profile.publications.length === 0 ? (
                <EmptyState title="No publications linked yet." compact />
              ) : (
                <div className="pub-list">
                  {profile.publications.map((p) => (
                    <PublicationItem key={p.id} publication={p} canEdit={false} canDelete={false} />
                  ))}
                </div>
              )}
            </section>

            <section className="detail-section" aria-labelledby="member-news">
              <SectionHeader compact id="member-news" title={`News (${profile.news.length})`} />
              {profile.news.length === 0 ? (
                <EmptyState title="No news linked yet." compact />
              ) : (
                <div className="grid">
                  {profile.news.map((n) => (
                    <NewsCard key={n.id} item={n} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="detail-layout__aside" aria-label="Researcher summary">
            <section className="panel profile-summary" aria-label="Profile">
              <Avatar size="xl" initials={profile.initials} photoUrl={profile.photoUrl} />
              <div>
                <p className="profile-summary__role">{profile.role}</p>
                {profile.department && <p className="profile-summary__dept">{profile.department}</p>}
              </div>
              {profile.canMessage && (
                <button type="button" className="btn btn--secondary btn--sm profile-summary__message" onClick={startConversation} disabled={messaging}>
                  <Icon name="message" size={14} /> {messaging ? "Opening…" : "Message"}
                </button>
              )}
            </section>

            {(profile.projects.length > 0 || profile.groups.length > 0) && (
              <section className="panel" aria-labelledby="member-affiliations">
                <h2 className="panel__title" id="member-affiliations">
                  Projects &amp; groups
                </h2>
                <div className="panel__list">
                  {profile.projects.map((p) => (
                    <Link key={p.id} to={`/projects/${p.id}`} className="person person--plain">
                      <span>
                        {p.title}
                        <small>Project · {p.role === "LEAD" ? "lead" : p.role.toLowerCase()}</small>
                      </span>
                    </Link>
                  ))}
                  {profile.groups.map((g) => (
                    <Link key={g.id} to={`/groups/${g.id}`} className="person person--plain">
                      <span>
                        {g.name}
                        <small>Group · {g.role === "LEAD" ? "lead" : "member"}</small>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>

      <TeamMemberFormModal
        open={editOpen}
        title="Edit profile"
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
        title="Delete history entry"
        message={historyDelete ? `Delete "${historyDelete.title}" from this profile's history? This cannot be undone.` : ""}
        onClose={() => setHistoryDelete(null)}
        onConfirm={async () => {
          if (!historyDelete) return;
          await apiFetch(`/member/${profile.id}/history/${historyDelete.id}`, { method: "DELETE" });
          reload();
        }}
      />

      <LinkItemsModal
        open={linkPubsOpen}
        title="Select your publications"
        description="Check every publication that belongs to you. This only changes what shows on your profile."
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
        open={linkNewsOpen}
        title="Select your news items"
        description="Check every news item that's about you or something you did."
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
