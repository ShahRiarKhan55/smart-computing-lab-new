import { useState } from "react";
import { Link } from "react-router-dom";
import type { TeamMember } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { Avatar } from "../components/Avatar";
import { ResearchLinks } from "../components/ResearchLinks";
import { CardEditControls } from "../components/CardEditControls";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { TeamMemberFormModal } from "../components/TeamMemberFormModal";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";

/**
 * Public alumni directory (Phase 3B). `/api/alumni` already returns only profiles the viewer may see: a visitor (or a lab manager) gets
 * the PUBLISHED alumni, an administrator also gets the unpublished ones, which are marked here and carry the publish control.
 * Nothing here decides who may see a profile; hiding a button is courtesy, the server re-checks every action.
 */
export function AlumniPage() {
  const t = useT();
  const policy = usePolicy();
  const { data: members, loading, error, reload } = useApiResource<TeamMember[]>("/alumni");
  const [editing, setEditing] = useState<{ open: boolean; member: TeamMember | null }>({ open: false, member: null });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const alumni = members ?? [];

  async function setPublished(member: TeamMember, isPublished: boolean) {
    const message = isPublished ? t("alumni.publishConfirm", { name: member.name }) : t("alumni.unpublishConfirm", { name: member.name });
    if (!window.confirm(message)) return;
    setActionError(null);
    setBusyId(member.id);
    try {
      await apiFetch(`/team/${member.id}/publication`, { method: "PUT", body: JSON.stringify({ isPublished }) });
      reload();
    } catch (err) {
      setActionError(apiErrorMessage(err, t));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(member: TeamMember) {
    if (!window.confirm(t("team.removeConfirm", { name: member.name }))) return;
    setActionError(null);
    try {
      await apiFetch(`/team/${member.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setActionError(apiErrorMessage(err, t));
    }
  }

  return (
    <>
      <PageHeader eyebrow={t("nav.people")} title={t("alumni.pageTitle")} description={t("alumni.pageDescription")} />

      <div className="container">
        <p className="team-alumni-link">
          <Link to="/team">← {t("alumni.viewTeam")}</Link>
        </p>

        {policy.canManageAlumni && (
          <AdminBar
            text={t("alumni.adminNote")}
            actionLabel={`+ ${t("alumni.addNew")}`}
            onAction={() => setEditing({ open: true, member: { category: "ALUMNI" } as TeamMember })}
          />
        )}

        {actionError && <ErrorState message={actionError} />}
        {loading && !members && <LoadingState label={t("alumni.loading")} />}
        {error && <ErrorState message={t("alumni.error")} onRetry={reload} />}
        {members && alumni.length === 0 && <EmptyState title={t("alumni.empty")} />}

        {alumni.length > 0 && (
          <div className="grid grid--tight">
            {alumni.map((member) => (
              <article key={member.id} className="card card--interactive team-card">
                {policy.canManageAlumni && (
                  <CardEditControls
                    onEdit={() => setEditing({ open: true, member })}
                    onDelete={policy.canDeleteTeamMember ? () => handleDelete(member) : undefined}
                    subject={member.name}
                  />
                )}
                <Avatar size="lg" initials={member.initials} photoUrl={member.photoUrl} />
                <h3 className="card__title team-card__name">
                  <Link to={`/team/${member.id}`}>{member.name}</Link>
                </h3>
                <div className="team-card__role">{member.role}</div>
                {member.department && <div className="team-card__dept">{member.department}</div>}
                <ResearchLinks member={member} />
                {policy.canPublishMember && (
                  <div className="alumni-publication">
                    <span className={member.isPublished ? "badge badge--info" : "badge badge--warn"}>
                      {member.isPublished ? t("alumni.publishedBadge") : t("alumni.unpublishedBadge")}
                    </span>
                    {!member.isPublished && <p className="form-hint">{t("alumni.hiddenNote")}</p>}
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={busyId === member.id}
                      onClick={() => setPublished(member, !member.isPublished)}
                      aria-label={`${member.isPublished ? t("alumni.unpublish") : t("alumni.publish")}: ${member.name}`}
                    >
                      {member.isPublished ? t("alumni.unpublish") : t("alumni.publish")}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      <TeamMemberFormModal
        open={editing.open}
        title={editing.member?.id ? t("team.editTitleFor", { name: editing.member.name }) : t("alumni.addNew")}
        initial={editing.member}
        showAdminFields={policy.canManageTeamPlacement}
        allowAlumni={policy.canManageAlumni}
        onClose={() => setEditing({ open: false, member: null })}
        onSubmit={async (values) => {
          if (editing.member?.id) {
            await apiFetch(`/team/${editing.member.id}`, { method: "PUT", body: JSON.stringify(values) });
          } else {
            await apiFetch("/team", { method: "POST", body: JSON.stringify(values) });
          }
          reload();
        }}
      />
    </>
  );
}
