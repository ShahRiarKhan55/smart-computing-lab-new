import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ROLES, type CreateUserInput, type Role, type TeamMember, type UserSummary } from "@scl/shared";
import { useAuth } from "../../auth/AuthContext";
import { apiFetch } from "../../lib/api";
import { useT } from "../../i18n/LocaleContext";
import { apiErrorMessage } from "../../i18n/errorMessages";
import { ROLE_LABEL_KEY } from "../../auth/usePolicy";
import { AdminBar } from "../../components/AdminBar";
import { ConfirmActionModal } from "../../components/ConfirmActionModal";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal";
import { CreateLoginModal } from "../../components/CreateLoginModal";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { LoadingState } from "../../components/LoadingState";
import { Modal } from "../../components/Modal";
import { SectionHeader } from "../../components/SectionHeader";
import { StatCard } from "../../components/StatCard";

/**
 * People & Accounts (admin only; the route is guarded and every /api/users call is ADMIN-only on the
 * server). The account list, role changes, deletion and login creation are the pre-Phase-17 dashboard,
 * unchanged; Phase 17 adds filters and linking/unlinking an account to a team profile.
 */
export function AdminPeoplePage() {
  const t = useT();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserSummary | null>(null);
  const [linkTarget, setLinkTarget] = useState<UserSummary | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<UserSummary | null>(null);
  const [pendingRole, setPendingRole] = useState<{ id: string; role: Role } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | Role>("");
  const [linkFilter, setLinkFilter] = useState<"" | "linked" | "unlinked">("");

  const loadData = useCallback(async () => {
    try {
      const [userList, teamList] = await Promise.all([apiFetch<UserSummary[]>("/users"), apiFetch<TeamMember[]>("/team")]);
      setUsers(userList);
      setMembers(teamList);
      setLoadError(null);
    } catch (err) {
      setLoadError(apiErrorMessage(err, t));
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

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (users ?? []).filter(
      (u) =>
        (!roleFilter || u.role === roleFilter) &&
        (!linkFilter || (linkFilter === "linked") === (u.teamMemberId !== null)) &&
        (!needle || u.email.toLowerCase().includes(needle) || (u.teamMemberName ?? "").toLowerCase().includes(needle)),
    );
  }, [users, query, roleFilter, linkFilter]);

  const reset = () => {
    setNotice(null);
    setActionError(null);
  };

  async function handleRoleChange(target: UserSummary, role: Role) {
    if (role === target.role) return;
    reset();
    setPendingRole({ id: target.id, role });
    try {
      await apiFetch(`/users/${target.id}`, { method: "PUT", body: JSON.stringify({ role }) });
      setUsers((list) => list?.map((u) => (u.id === target.id ? { ...u, role } : u)) ?? list);
      setNotice(t("admin.roleChanged", { email: target.email, role: roleLabel(role).toLowerCase() }));
    } catch (err) {
      setActionError(apiErrorMessage(err, t) || t("admin.couldNotChangeRole"));
    } finally {
      setPendingRole(null);
    }
  }

  async function handleCreate(payload: CreateUserInput) {
    reset();
    await apiFetch("/users", { method: "POST", body: JSON.stringify(payload) });
    setNotice(t("admin.loginCreatedFor", { email: payload.email }));
    await loadData();
  }

  async function handleDelete(target: UserSummary) {
    reset();
    await apiFetch(`/users/${target.id}`, { method: "DELETE" });
    setNotice(t("admin.deletedAccountFor", { email: target.email }));
    await loadData();
  }

  async function handleLink(target: UserSummary, teamMemberId: string) {
    reset();
    await apiFetch(`/users/${target.id}/link`, { method: "PUT", body: JSON.stringify({ teamMemberId }) });
    const name = members.find((m) => m.id === teamMemberId)?.name ?? "";
    setNotice(t("adm.people.linkedOk", { email: target.email, name }));
    await loadData();
  }

  async function handleUnlink(target: UserSummary) {
    reset();
    await apiFetch(`/users/${target.id}/link`, { method: "PUT", body: JSON.stringify({ teamMemberId: null }) });
    setNotice(t("adm.people.unlinkedOk", { email: target.email }));
    await loadData();
  }

  return (
    <>
      <section className="detail-section" aria-labelledby="admin-summary">
        <SectionHeader compact id="admin-summary" title={t("admin.accountsAtAGlance")} description={t("adm.people.intro")} />
        <div className="stat-grid">
          <StatCard value={users ? users.length : null} label={t("admin.accountsLabel")} />
          <StatCard value={countRole("ADMIN")} label={t("admin.statAdmins")} />
          <StatCard value={countRole("LAB_MANAGER")} label={t("admin.labManagersLabel")} />
          <StatCard value={countRole("MEMBER")} label={t("admin.membersLabel")} />
          <StatCard value={users ? unlinkedMembers.length : null} label={t("admin.profilesWithoutLogin")} />
        </div>
      </section>

      <section className="detail-section" aria-labelledby="admin-accounts">
        <SectionHeader compact id="admin-accounts" title={t("admin.accountsHeading")} />
        <AdminBar
          text={t("admin.labMemberAccounts")}
          actionLabel={`+ ${t("admin.createLoginAction")}`}
          onAction={() => {
            reset();
            setCreateOpen(true);
          }}
        />

        <form className="admin-filters" role="search" aria-label={t("adm.people.search")} onSubmit={(e: FormEvent) => e.preventDefault()}>
          <div className="form-group admin-filters__wide">
            <label htmlFor="ap-q">{t("adm.people.search")}</label>
            <input id="ap-q" type="search" value={query} maxLength={100} placeholder={t("adm.people.searchPlaceholder")} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="ap-role">{t("adm.people.role")}</label>
            <select id="ap-role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as "" | Role)}>
              <option value="">{t("adm.people.all")}</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="ap-link">{t("adm.people.linkState")}</label>
            <select id="ap-link" value={linkFilter} onChange={(e) => setLinkFilter(e.target.value as "" | "linked" | "unlinked")}>
              <option value="">{t("adm.people.all")}</option>
              <option value="linked">{t("adm.people.linked")}</option>
              <option value="unlinked">{t("adm.people.unlinked")}</option>
            </select>
          </div>
        </form>

        <div role="status" aria-live="polite">
          {notice && (
            <div className="form-success">
              <Icon name="check" size={16} /> {notice}
            </div>
          )}
        </div>
        {actionError && <ErrorState message={actionError} />}
        {loadError && <ErrorState message={loadError} onRetry={() => void loadData()} />}
        {!users && !loadError && <LoadingState label={t("admin.loadingAccounts")} variant="list" />}

        {users && (
          <div className="account-list">
            {users.length === 0 && <EmptyState title={t("admin.noAccountsYet")} compact />}
            {users.length > 0 && shown.length === 0 && <EmptyState title={t("adm.people.noMatches")} compact />}
            {shown.map((u) => {
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
                    {u.teamMemberId ? (
                      <button className="btn btn--secondary btn--sm" type="button" aria-label={t("adm.people.unlinkActionAria", { email: u.email })} onClick={() => { reset(); setUnlinkTarget(u); }}>
                        {t("adm.people.unlinkAction")}
                      </button>
                    ) : (
                      <button className="btn btn--secondary btn--sm" type="button" aria-label={t("adm.people.linkActionAria", { email: u.email })} onClick={() => { reset(); setLinkTarget(u); }}>
                        {t("adm.people.linkAction")}
                      </button>
                    )}
                    <button
                      className="btn btn--danger btn--sm"
                      type="button"
                      disabled={isSelf}
                      title={isSelf ? t("admin.cantDeleteOwnAccount") : undefined}
                      onClick={() => {
                        reset();
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

      <CreateLoginModal open={createOpen} unlinkedMembers={unlinkedMembers} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />

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

      <LinkProfileModal key={linkTarget?.id ?? "none"} target={linkTarget} candidates={unlinkedMembers} onClose={() => setLinkTarget(null)} onLink={handleLink} />

      <ConfirmActionModal
        open={unlinkTarget !== null}
        title={t("adm.people.unlinkTitle")}
        message={unlinkTarget ? t("adm.people.unlinkMessage", { email: unlinkTarget.email, name: unlinkTarget.teamMemberName ?? "" }) : ""}
        confirmLabel={t("adm.people.unlinkConfirm")}
        busyLabel={t("adm.people.unlinking")}
        danger
        onClose={() => setUnlinkTarget(null)}
        onConfirm={async () => {
          if (unlinkTarget) await handleUnlink(unlinkTarget);
        }}
      />
    </>
  );
}

function LinkProfileModal({
  target,
  candidates,
  onClose,
  onLink,
}: {
  target: UserSummary | null;
  candidates: TeamMember[];
  onClose: () => void;
  onLink: (target: UserSummary, teamMemberId: string) => Promise<void>;
}) {
  const t = useT();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target || !choice) return;
    setBusy(true);
    setError(null);
    try {
      await onLink(target, choice);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={target !== null} onClose={busy ? () => {} : onClose} title={t("adm.people.linkTitle")}>
      {target && (
        <form onSubmit={submit}>
          <p className="modal__body">{t("adm.people.linkIntro", { email: target.email })}</p>
          {candidates.length === 0 ? (
            <p className="text-muted">{t("adm.people.linkNone")}</p>
          ) : (
            <div className="form-group">
              <label htmlFor="link-profile">{t("adm.people.linkChoose")}</label>
              <select id="link-profile" value={choice} onChange={(e) => setChoice(e.target.value)} data-autofocus>
                <option value="" disabled>
                  {t("adm.people.linkChoose")}
                </option>
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && <ErrorState message={error} />}
          <div className="modal__actions">
            <button className="btn btn--secondary" type="button" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button className="btn btn--primary" type="submit" disabled={busy || !choice}>
              {busy ? t("adm.people.linking") : t("adm.people.linkSubmit")}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
