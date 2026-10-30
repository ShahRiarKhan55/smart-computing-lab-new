import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ALUMNI_CATEGORY, CATEGORY_ORDER, type TeamMember } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { TeamCard } from "../components/TeamCard";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { TeamMemberFormModal } from "../components/TeamMemberFormModal";
import { useT } from "../i18n/LocaleContext";
import { apiErrorMessage } from "../i18n/errorMessages";
import { CATEGORY_LABEL_KEY } from "../i18n/labels";

export function TeamPage() {
  const t = useT();
  const policy = usePolicy();
  const { data: members, loading, error, reload: reloadTeam } = useApiResource<TeamMember[]>("/team");
  // Alumni are not part of /api/team (the roster); /api/alumni returns the profiles this viewer may see: the PUBLISHED ones for a visitor or a
  // lab manager, every one (with the publication flag) for an administrator. The server decides; nothing here filters.
  const { data: alumniData, error: alumniError, reload: reloadAlumni } = useApiResource<TeamMember[]>("/alumni");
  const [busyId, setBusyId] = useState<string | null>(null);
  const { hash } = useLocation();
  const alumni = alumniData ?? [];

  function reload() {
    reloadTeam();
    reloadAlumni();
  }

  // The alumni section loads after the roster; a link to /team#alumni scrolls to it once it is on the page.
  useEffect(() => {
    if (hash === "#alumni" && alumni.length > 0) document.getElementById("alumni")?.scrollIntoView();
  }, [hash, alumni.length]);
  const [editing, setEditing] = useState<{ open: boolean; member: TeamMember | null }>({
    open: false,
    member: null,
  });
  const [actionError, setActionError] = useState<string | null>(null);

  const groups = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: members?.filter((m) => m.category === cat) ?? [],
  })).filter((g) => g.items.length > 0);

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

  return (
    <>
      <PageHeader eyebrow={t("nav.people")} title={t("team.pageTitle")} description={t("team.pageDescription")} />

      <div className="container">
        {policy.canCreateTeamMember && (
          <AdminBar
            text={`${t("team.addNewMembersHere", { role: policy.roleLabel })}${policy.canManageUsers ? t("team.giveLoginAccessHint") : ""}`}
            actionLabel={`+ ${t("team.addTeamMember")}`}
            onAction={() => setEditing({ open: true, member: null })}
          />
        )}

        {actionError && <ErrorState message={actionError} />}
        {loading && !members && <LoadingState label={t("team.loading")} />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {members && members.length === 0 && <EmptyState title={t("team.empty")} />}

        {groups.map((group) => (
          <section key={group.cat} aria-labelledby={`team-${group.cat}`}>
            <div className="group-heading">
              <h2 id={`team-${group.cat}`}>
                {t(CATEGORY_LABEL_KEY[group.cat])} <span className="group-heading__count">({group.items.length})</span>
              </h2>
            </div>
            <div className="grid grid--tight">
              {group.items.map((member) => (
                <TeamCard
                  key={member.id}
                  member={member}
                  canEdit={policy.canEditProfile(member.isOwn)}
                  canDelete={policy.canDeleteTeamMember}
                  onEdit={() => setEditing({ open: true, member })}
                  onDelete={() => handleDelete(member)}
                />
              ))}
            </div>
          </section>
        ))}

        {alumniError && <ErrorState message={t("alumni.error")} onRetry={reloadAlumni} />}
        {alumni.length > 0 && (
          <section id="alumni" aria-labelledby={`team-${ALUMNI_CATEGORY}`}>
            <div className="group-heading">
              <h2 id={`team-${ALUMNI_CATEGORY}`}>
                {t(CATEGORY_LABEL_KEY[ALUMNI_CATEGORY])} <span className="group-heading__count">({alumni.length})</span>
              </h2>
            </div>
            {policy.canManageAlumni && <p className="form-hint">{t("alumni.adminNote")}</p>}
            <div className="grid grid--tight">
              {alumni.map((member) => (
                <TeamCard
                  key={member.id}
                  member={member}
                  canEdit={policy.canManageAlumni}
                  canDelete={policy.canDeleteTeamMember}
                  onEdit={() => setEditing({ open: true, member })}
                  onDelete={() => handleDelete(member)}
                >
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
                </TeamCard>
              ))}
            </div>
          </section>
        )}
      </div>

      <TeamMemberFormModal
        open={editing.open}
        title={editing.member ? t("team.editTitleFor", { name: editing.member.name }) : t("team.newTitle")}
        initial={editing.member}
        showAdminFields={policy.canManageTeamPlacement}
        allowAlumni={policy.canManageAlumni}
        onClose={() => setEditing({ open: false, member: null })}
        onSubmit={async (values) => {
          if (editing.member) {
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
