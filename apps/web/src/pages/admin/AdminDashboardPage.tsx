import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ROLES, type CreateUserInput, type Role, type TeamMember, type UserSummary } from "@scl/shared";
import { useAuth } from "../../auth/AuthContext";
import { apiFetch, ApiError } from "../../lib/api";
import { useT } from "../../i18n/LocaleContext";
import { ROLE_LABEL_KEY } from "../../auth/usePolicy";
import { PageHeader } from "../../components/PageHeader";
import { AdminBar } from "../../components/AdminBar";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Icon, type IconName } from "../../components/Icon";
import { LoadingState } from "../../components/LoadingState";
import { SectionHeader } from "../../components/SectionHeader";
import { StatCard } from "../../components/StatCard";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal";
import { CreateLoginModal } from "../../components/CreateLoginModal";

const CONTENT_LINKS: { to: string; label: string; icon: IconName }[] = [
  { to: "/research", label: "Edit Research", icon: "flask" },
  { to: "/projects", label: "Edit Projects", icon: "folder" },
  { to: "/groups", label: "Edit Groups", icon: "users" },
  { to: "/team", label: "Edit Team", icon: "user" },
  { to: "/publications", label: "Edit Publications", icon: "file" },
  { to: "/news", label: "Edit News", icon: "newspaper" },
];

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Reference admin.html: list lab accounts, change roles, delete accounts and
 * create logins. Content (team, publications, news, research) is edited on
 * each page. The API enforces admin-only access; the route guard is UX only.
 */
export function AdminDashboardPage() {
  const t = useT();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserSummary | null>(null);
  const [pendingRole, setPendingRole] = useState<{ id: string; role: Role } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [userList, teamList] = await Promise.all([
        apiFetch<UserSummary[]>("/users"),
        apiFetch<TeamMember[]>("/team"),
      ]);
      setUsers(userList);
      setMembers(teamList);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Could not load accounts."));
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Which profiles already have a login comes from the admin-only /users list, not from the public /team.
  const linkedProfileIds = new Set((users ?? []).map((u) => u.teamMemberId));
  const unlinkedMembers = members.filter((m) => !linkedProfileIds.has(m.id));
  const countRole = (role: Role) => (users ? users.filter((u) => u.role === role).length : null);
  const roleLabel = (role: Role) => t(ROLE_LABEL_KEY[role] ?? "admin.role.MEMBER");

  async function handleRoleChange(target: UserSummary, role: Role) {
    if (role === target.role) return;
    setNotice(null);
    setActionError(null);
    setPendingRole({ id: target.id, role });
    try {
      await apiFetch(`/users/${target.id}`, { method: "PUT", body: JSON.stringify({ role }) });
      setUsers((list) => list?.map((u) => (u.id === target.id ? { ...u, role } : u)) ?? list);
      setNotice(t("admin.roleChanged", { email: target.email, role: roleLabel(role).toLowerCase() }));
    } catch (err) {
      setActionError(errorMessage(err, "Could not change the role."));
    } finally {
      setPendingRole(null);
    }
  }

  async function handleCreate(payload: CreateUserInput) {
    setNotice(null);
    setActionError(null);
    await apiFetch("/users", { method: "POST", body: JSON.stringify(payload) });
    setNotice(`Login created for ${payload.email}.`);
    await loadData();
  }

  async function handleDelete(target: UserSummary) {
    setNotice(null);
    setActionError(null);
    await apiFetch(`/users/${target.id}`, { method: "DELETE" });
    setNotice(`Deleted the account for ${target.email}.`);
    await loadData();
  }

  return (
    <>
      <PageHeader eyebrow={t("admin.eyebrow")} title={t("admin.pageTitle")} description={t("admin.pageDescription")} />

      <div className="container">
        <section className="detail-section" aria-labelledby="admin-summary">
          <SectionHeader compact id="admin-summary" title="Accounts at a glance" />
          <div className="stat-grid">
            <StatCard value={users ? users.length : null} label="Accounts" />
            <StatCard value={countRole("ADMIN")} label={t("admin.statAdmins")} />
            <StatCard value={countRole("LAB_MANAGER")} label="Lab managers" />
            <StatCard value={countRole("MEMBER")} label="Members" />
            <StatCard value={users ? unlinkedMembers.length : null} label="Profiles without login" />
          </div>
        </section>

        <section className="detail-section" aria-labelledby="admin-content">
          <SectionHeader compact id="admin-content" title="Edit lab content" description="Content is edited on its own page, by anyone allowed to." />
          <div className="tile-grid">
            {CONTENT_LINKS.map((link) => (
              <Link key={link.to} to={link.to} className="tile-link">
                <Icon name={link.icon} size={18} /> {link.label}
              </Link>
            ))}
          </div>
        </section>

        <section className="detail-section" aria-labelledby="admin-accounts">
          <SectionHeader compact id="admin-accounts" title="Accounts" />
          <AdminBar
            text="Lab member accounts"
            actionLabel="+ Create login for a member"
            onAction={() => {
              setNotice(null);
              setActionError(null);
              setCreateOpen(true);
            }}
          />

          {notice && (
            <div className="form-success" role="status">
              <Icon name="check" size={16} /> {notice}
            </div>
          )}
          {actionError && <ErrorState message={actionError} />}
          {loadError && <ErrorState message={loadError} onRetry={() => void loadData()} />}
          {!users && !loadError && <LoadingState label="Loading accounts…" variant="list" />}

          {users && (
            <div className="account-list">
              {users.length === 0 && <EmptyState title="No accounts yet." compact />}
              {users.map((u) => {
                const isSelf = u.id === me?.id;
                const role = pendingRole?.id === u.id ? pendingRole.role : u.role;
                return (
                  <div key={u.id} className="account-row">
                    <div>
                      <div className="account-row__email">
                        {u.email}
                        {isSelf && <span className="text-muted"> (you)</span>}
                      </div>
                      <div className="account-row__meta">
                        {u.teamMemberId ? (
                          <>
                            Linked to{" "}
                            <Link to={`/team/${u.teamMemberId}`} className="link">
                              {u.teamMemberName}
                            </Link>
                          </>
                        ) : (
                          "No team profile linked"
                        )}
                      </div>
                    </div>
                    <div className="account-row__actions">
                      <div className="form-group">
                        <select
                          aria-label={`Role for ${u.email}`}
                          title={isSelf ? "You can't change your own role" : undefined}
                          value={role}
                          disabled={isSelf || pendingRole?.id === u.id}
                          onChange={(e) => handleRoleChange(u, e.target.value as Role)}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        className="btn btn--danger btn--sm"
                        type="button"
                        disabled={isSelf}
                        title={isSelf ? "You can't delete your own account" : undefined}
                        onClick={() => {
                          setNotice(null);
                          setActionError(null);
                          setDeleteTarget(u);
                        }}
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <CreateLoginModal
        open={createOpen}
        unlinkedMembers={unlinkedMembers}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title="Delete account"
        message={
          deleteTarget
            ? `Delete ${deleteTarget.email}? They will no longer be able to log in.${
                deleteTarget.teamMemberName
                  ? ` Their team profile (${deleteTarget.teamMemberName}) is kept and becomes unlinked.`
                  : ""
              }`
            : ""
        }
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) await handleDelete(deleteTarget);
        }}
      />
    </>
  );
}
