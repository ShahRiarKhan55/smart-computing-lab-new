import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { GROUP_MEMBER_ROLES, type GroupDetail, type TeamMember } from "@scl/shared";
import { usePolicy } from "../auth/usePolicy";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { AdminBar } from "../components/AdminBar";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { PersonLink } from "../components/PersonLink";
import { ProjectCard } from "../components/ProjectCard";
import { SectionHeader } from "../components/SectionHeader";
import { GroupFormModal } from "../components/GroupFormModal";
import { MembersModal } from "../components/MembersModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { VisibilityBadge } from "../components/VisibilityField";

const ROLE_LABELS: Record<string, string> = { LEAD: "Lead", MEMBER: "Member" };

type Panel = "edit" | "members" | "delete" | null;

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const policy = usePolicy();
  const { data: group, loading, error, status, reload } = useApiResource<GroupDetail>(`/groups/${id}`);
  const [panel, setPanel] = useState<Panel>(null);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Full-page loader only while we have nothing for THIS id. A reload after a save keeps the page
  // (and its open modal) mounted, and navigating between ids never flashes the previous one.
  if (loading && (!group || group.id !== id)) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Groups", to: "/groups" }, { label: "Loading…" }]} title="Loading…" />
        <div className="container">
          <LoadingState label="Loading group…" variant="text" />
        </div>
      </>
    );
  }

  if (status === 404 || (!group && error)) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Groups", to: "/groups" }, { label: "Not found" }]} title="Group not found" />
        <div className="container">
          <ErrorState message={status === 404 ? "This group could not be found." : (error ?? "Could not load this group.")} onRetry={status === 404 ? undefined : reload} />
          <Link to="/groups" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> All groups
          </Link>
        </div>
      </>
    );
  }
  if (!group) return null;

  async function openMembers() {
    setActionError(null);
    try {
      if (!team) setTeam(await apiFetch<TeamMember[]>("/team"));
      setPanel("members");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not load the team.");
    }
  }
  const close = () => setPanel(null);

  return (
    <>
      <PageHeader crumbs={[{ label: "Groups", to: "/groups" }, { label: group.name }]} title={group.name} description={group.description} />

      <div className="container">
        {group.canEdit && (
          <AdminBar
            text={policy.isManager ? `${policy.isAdmin ? "Admin" : "Lab manager"}: manage this group.` : "You lead this group: edit its details and members."}
            actions={
              <>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => setPanel("edit")}>
                  Edit group
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={openMembers}>
                  Members
                </button>
                {policy.canDeleteContent && (
                  <button className="btn btn--danger btn--sm" type="button" onClick={() => setPanel("delete")}>
                    Delete
                  </button>
                )}
              </>
            }
          />
        )}
        {actionError && <ErrorState message={actionError} />}

        {group.visibility && (
          <div className="detail-meta">
            <VisibilityBadge visibility={group.visibility} />
          </div>
        )}

        <section className="detail-section" aria-labelledby="group-members">
          <SectionHeader compact id="group-members" title={`Members (${group.members.length})`} />
          {group.members.length === 0 ? (
            <EmptyState title="No members added yet." compact />
          ) : (
            <div className="person-list">
              {group.members.map((m) => (
                <PersonLink key={m.teamMemberId} id={m.teamMemberId} name={m.name} initials={m.initials} detail={ROLE_LABELS[m.role] ?? m.role} />
              ))}
            </div>
          )}
        </section>

        <section className="detail-section" aria-labelledby="group-projects">
          <SectionHeader compact id="group-projects" title={`Projects (${group.projects.length})`} />
          {group.projects.length === 0 ? (
            <EmptyState title="No projects in this group yet." compact />
          ) : (
            <div className="grid">
              {group.projects.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </section>
      </div>

      <GroupFormModal
        open={panel === "edit"}
        title="Edit group"
        initial={group}
        canManageSettings={policy.isManager}
        onClose={close}
        onSubmit={async (payload) => {
          await apiFetch(`/groups/${group.id}`, { method: "PUT", body: JSON.stringify(payload) });
          reload();
        }}
      />

      <MembersModal
        open={panel === "members"}
        title="Group members"
        description="Choose who belongs to this group. Group leads can edit the group."
        people={(team ?? []).map((m) => ({ id: m.id, label: `${m.name} — ${m.role}` }))}
        roles={GROUP_MEMBER_ROLES}
        roleLabels={ROLE_LABELS}
        selected={group.members.map((m) => ({ teamMemberId: m.teamMemberId, role: m.role }))}
        onClose={close}
        onSubmit={async (members) => {
          await apiFetch(`/groups/${group.id}/members`, { method: "PUT", body: JSON.stringify({ members }) });
          reload();
        }}
      />

      <ConfirmDeleteModal
        open={panel === "delete"}
        title="Delete group"
        message={`Delete "${group.name}"? Memberships are removed; its projects are kept and become ungrouped. This cannot be undone.`}
        onClose={close}
        onConfirm={async () => {
          await apiFetch(`/groups/${group.id}`, { method: "DELETE" });
          navigate("/groups");
        }}
      />
    </>
  );
}
