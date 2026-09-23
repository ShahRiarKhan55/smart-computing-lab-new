import { useState } from "react";
import { CATEGORY_ORDER, type TeamMember } from "@scl/shared";
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
  const { data: members, loading, error, reload } = useApiResource<TeamMember[]>("/team");
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
      </div>

      <TeamMemberFormModal
        open={editing.open}
        title={editing.member ? t("team.editTitleFor", { name: editing.member.name }) : t("team.newTitle")}
        initial={editing.member}
        showAdminFields={policy.canManageTeamPlacement}
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
