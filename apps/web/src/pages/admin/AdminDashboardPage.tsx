import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ROLES, type CreateUserInput, type Role, type TeamMember, type TranslationKey, type UserSummary } from "@scl/shared";
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

const CONTENT_LINKS: { to: string; labelKey: TranslationKey; icon: IconName }[] = [
  { to: "/research", labelKey: "admin.editResearch", icon: "flask" },
  { to: "/projects", labelKey: "admin.editProjects", icon: "folder" },
  { to: "/groups", labelKey: "admin.editGroups", icon: "users" },
  { to: "/team", labelKey: "admin.editTeam", icon: "user" },
  { to: "/publications", labelKey: "admin.editPublications", icon: "file" },
  { to: "/news", labelKey: "admin.editNews", icon: "newspaper" },
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
      setLoadError(errorMessage(err, t("admin.couldNotLoadAccounts")));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setActionError(errorMessage(err, t("admin.couldNotChangeRole")));
    } finally {
      setPendingRole(null);
    }
  }

  async function handleCreate(payload: CreateUserInput) {
    setNotice(null);
    setActionError(null);
    await apiFetch("/users", { method: "POST", body: JSON.stringify(payload) });
    setNotice(t("admin.loginCreatedFor", { email: payload.email }));
    await loadData();
  }

  async function handleDelete(target: UserSummary) {
    setNotice(null);
    setActionError(null);
    await apiFetch(`/users/${target.id}`, { method: "DELETE" });
    setNotice(t("admin.deletedAccountFor", { email: target.email }));
    await loadData();
  }

  return (
    <>
      <PageHeader eyebrow={t("admin.eyebrow")} title={t("admin.pageTitle")} description={t("admin.pageDescription")} />

      <div className="container">
        <section className="detail-section" aria-labelledby="admin-summary">
          <SectionHeader compact id="admin-summary" title={t("admin.accountsAtAGlance")} />
          <div className="stat-grid">
            <StatCard value={users ? users.length : null} label={t("admin.accountsLabel")} />
            <StatCard value={countRole("ADMIN")} label={t("admin.statAdmins")} />
            <StatCard value={countRole("LAB_MANAGER")} label={t("admin.labManagersLabel")} />
            <StatCard value={countRole("MEMBER")} label={t("admin.membersLabel")} />
            <StatCard value={users ? unlinkedMembers.length : null} label={t("admin.profilesWithoutLogin")} />
          </div>
        </section>

        <section className="detail-section" aria-labelledby="admin-content">
          <SectionHeader compact id="admin-content" title={t("admin.editLabContent")} description={t("admin.editLabContentDesc")} />
          <div className="tile-grid">
            {CONTENT_LINKS.map((link) => (
              <Link key={link.to} to={link.to} className="tile-link">
                <Icon name={link.icon} size={18} /> {t(link.labelKey)}
              </Link>
            ))}
          </div>
        </section>

        <section className="detail-section" aria-labelledby="admin-accounts">
          <SectionHeader compact id="admin-accounts" title={t("admin.accountsHeading")} />
          <AdminBar
            text={t("admin.labMemberAccounts")}
            actionLabel={`+ ${t("admin.createLoginAction")}`}
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
          {!users && !loadError && <LoadingState label={t("admin.loadingAccounts")} variant="list" />}

          {users && (
            <div className="account-list">
              {users.length === 0 && <EmptyState title={t("admin.noAccountsYet")} compact />}
              {users.map((u) => {
                const isSelf = u.id === me?.id;
                const role = pendingRole?.id === u.id ? pendingRole.role : u.role;
                return (
                  <div key={u.id} className="account-row">
                    <div>
                      <div className="account-row__email">
                        {u.email}
                        {isSelf && <span className="text-muted">{t("admin.youSuffix")}</span>}
                      </div>
                      <div className="account-row__meta">
                        {u.teamMemberId ? (
                          <>
                            {t("admin.linkedTo")}{" "}
                            <Link to={`/team/${u.teamMemberId}`} className="link">
                              {u.teamMemberName}
                            </Link>
                          </>
                        ) : (
                          t("admin.noTeamProfileLinked")
                        )}
                      </div>
                    </div>
                    <div className="account-row__actions">
                      <div className="form-group">
                        <select
                          aria-label={t("admin.roleForAria", { email: u.email })}
                          title={isSelf ? t("admin.cantChangeOwnRole") : undefined}
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
                        title={isSelf ? t("admin.cantDeleteOwnAccount") : undefined}
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
        title={t("admin.deleteAccountTitle")}
        message={
          deleteTarget
            ? t("admin.deleteAccountMessage", { email: deleteTarget.email }) +
              (deleteTarget.teamMemberName ? t("admin.deleteAccountKeepsProfile", { name: deleteTarget.teamMemberName }) : "")
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
