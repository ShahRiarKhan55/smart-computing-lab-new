import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { GROUP_MEMBER_ROLES, type GroupDetail, type TeamMember, type TranslationKey } from "@scl/shared";
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
import { RelatedOutputs } from "../components/RelatedOutputs";
import { RelatedResearch } from "../components/RelatedResearch";
import { GroupFormModal } from "../components/GroupFormModal";
import { MembersModal } from "../components/MembersModal";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { VisibilityBadge } from "../components/VisibilityField";
import { useT } from "../i18n/LocaleContext";

const ROLE_LABEL_KEY: Record<string, TranslationKey> = { LEAD: "groups.role.LEAD", MEMBER: "groups.role.MEMBER" };

type Panel = "edit" | "members" | "delete" | null;

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const policy = usePolicy();
  const t = useT();
  const ROLE_LABELS: Record<string, string> = { LEAD: t("groups.role.LEAD"), MEMBER: t("groups.role.MEMBER") };
  const { data: group, loading, error, status, reload } = useApiResource<GroupDetail>(`/groups/${id}`);
  const [panel, setPanel] = useState<Panel>(null);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Full-page loader only while we have nothing for THIS id. A reload after a save keeps the page
  // (and its open modal) mounted, and navigating between ids never flashes the previous one.
  if (loading && (!group || group.id !== id)) {
    return (
      <>
        <PageHeader crumbs={[{ label: t("nav.groups"), to: "/groups" }, { label: t("common.loading") }]} title={t("common.loading")} />
        <div className="container">
          <LoadingState label={t("groups.loadingGroup")} variant="text" />
        </div>
      </>
    );
  }

  if (status === 404 || (!group && error)) {
    return (
      <>
        <PageHeader crumbs={[{ label: t("nav.groups"), to: "/groups" }, { label: t("common.notFoundCrumb") }]} title={t("groups.notFoundTitle")} />
        <div className="container">
          <ErrorState message={status === 404 ? t("groups.notFoundMsg") : (error ?? t("groups.couldNotLoadThis"))} onRetry={status === 404 ? undefined : reload} />
          <Link to="/groups" className="btn btn--secondary btn--sm">
            <Icon name="arrow-left" size={14} /> {t("groups.allGroups")}
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
      setActionError(err instanceof ApiError ? err.message : t("groups.couldNotLoadTeam"));
    }
  }
  const close = () => setPanel(null);

  return (
    <>
      <PageHeader crumbs={[{ label: t("nav.groups"), to: "/groups" }, { label: group.name }]} title={group.name} description={group.description} />

      <div className="container">
        {group.canEdit && (
          <AdminBar
            text={policy.isManager ? t("groups.manageThisSuffix", { role: policy.roleLabel }) : t("groups.leadThis")}
            actions={
              <>
                <button className="btn btn--secondary btn--sm" type="button" onClick={() => setPanel("edit")}>
                  {t("groups.editGroup")}
                </button>
                <button className="btn btn--secondary btn--sm" type="button" onClick={openMembers}>
                  {t("projects.membersLabel")}
                </button>
                {policy.canDeleteContent && (
                  <button className="btn btn--danger btn--sm" type="button" onClick={() => setPanel("delete")}>
                    {t("common.delete")}
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

        <div className="detail-section">
          <RelatedResearch
            idPrefix="group"
            links={[
              ...(group.projects.length > 0 ? [{ to: `/projects?group=${group.id}`, label: t("explore.groupProjects") }] : []),
              ...(group.publications.length > 0 ? [{ to: `/publications?group=${group.id}`, label: t("explore.groupPubs") }] : []),
            ]}
          />
        </div>

        <section className="detail-section" aria-labelledby="group-members">
          <SectionHeader compact id="group-members" title={t("groups.membersHeading", { count: group.members.length })} />
          {group.members.length === 0 ? (
            <EmptyState title={t("groups.noMembersYet")} compact />
          ) : (
            <div className="person-list">
              {group.members.map((m) => (
                <PersonLink key={m.teamMemberId} id={m.teamMemberId} name={m.name} initials={m.initials} detail={t(ROLE_LABEL_KEY[m.role] ?? "groups.role.MEMBER")} />
              ))}
            </div>
          )}
        </section>

        <section className="detail-section" aria-labelledby="group-projects">
          <SectionHeader compact id="group-projects" title={t("groups.projectsHeading", { count: group.projects.length })} />
          {group.projects.length === 0 ? (
            <EmptyState title={t("groups.noProjectsYet")} compact />
          ) : (
            <div className="grid">
              {group.projects.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </section>

        <section className="detail-section" aria-labelledby="group-areas">
          <SectionHeader compact id="group-areas" title={t("rs.group.areasHeading", { count: group.areas.length })} />
          {group.areas.length === 0 ? (
            <EmptyState title={t("rs.group.noAreas")} compact />
          ) : (
            <div className="chips">
              {group.areas.map((a) => (
                <Link key={a.id} to={`/research/${a.id}`} className="tag">
                  <span aria-hidden="true">{a.icon}</span> {a.title}
                </Link>
              ))}
            </div>
          )}
        </section>

        <RelatedOutputs idPrefix="group" publications={group.publications} news={group.news} events={group.events} note={t("rs.group.outputsNote")} />
      </div>

      <GroupFormModal
        open={panel === "edit"}
        title={t("groups.editTitle")}
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
        title={t("groups.membersModalTitle")}
        description={t("groups.membersModalDesc")}
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
        title={t("groups.deleteTitle")}
        message={t("groups.deleteMessageFull", { name: group.name })}
        onClose={close}
        onConfirm={async () => {
          await apiFetch(`/groups/${group.id}`, { method: "DELETE" });
          navigate("/groups");
        }}
      />
    </>
  );
}
