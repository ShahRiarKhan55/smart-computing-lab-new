import { useState } from "react";
import { Link } from "react-router-dom";
import type { TeamMember } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { useSeo } from "../hooks/useSeo";
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

/**
 * The alumni directory: former members, shown as a public list only. Alumni have NO accounts — no
 * login, invitation or password exists for them (enforced on the server) — and nothing on this page
 * suggests otherwise. Managers/admins can add, edit, hide (unpublish) and remove entries here.
 */
export function AlumniPage() {
  const t = useT();
  const policy = usePolicy();
  const { data: members, loading, error, reload } = useApiResource<TeamMember[]>("/team");
  const [editing, setEditing] = useState<{ open: boolean; member: TeamMember | null }>({ open: false, member: null });
  const [actionError, setActionError] = useState<string | null>(null);

  useSeo({ title: t("alumni.pageTitle"), description: t("alumni.pageDescription") });

  const alumni = members?.filter((m) => m.category === "ALUMNI");

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
      <PageHeader eyebrow={t("alumni.eyebrow")} title={t("alumni.pageTitle")} description={t("alumni.pageDescription")} />

      <div className="container">
        {policy.canCreateTeamMember && (
          <AdminBar
            text={`${t("alumni.noAccountNote")}`}
            actionLabel={`+ ${t("alumni.add")}`}
            onAction={() => setEditing({ open: true, member: null })}
          />
        )}

        {actionError && <ErrorState message={actionError} />}
        {loading && !members && <LoadingState label={t("alumni.loading")} />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {alumni && alumni.length === 0 && <EmptyState title={t("alumni.empty")} />}

        {alumni && alumni.length > 0 && (
          <div className="grid grid--tight">
            {alumni.map((member) => (
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
        )}

        <p className="team-alumni-link">
          <Link to="/team" className="btn btn--secondary btn--sm">
            {t("alumni.viewCurrent")}
          </Link>
        </p>
      </div>

      <TeamMemberFormModal
        open={editing.open}
        title={editing.member ? t("team.editTitleFor", { name: editing.member.name }) : t("alumni.add")}
        initial={editing.member}
        showAdminFields={policy.canManageTeamPlacement}
        categories={["ALUMNI"]}
        defaultCategory="ALUMNI"
        onPhotoChanged={reload}
        onClose={() => setEditing({ open: false, member: null })}
        onSubmit={async (values) => {
          if (editing.member) {
            await apiFetch(`/team/${editing.member.id}`, { method: "PUT", body: JSON.stringify(values) });
          } else {
            await apiFetch("/team", { method: "POST", body: JSON.stringify({ ...values, category: "ALUMNI" }) });
          }
          reload();
        }}
      />
    </>
  );
}
