import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { GROUP_MEMBER_ROLES, PROJECT_MEMBER_ROLES, type GroupDetail, type ProjectDetail, type TeamMember, type TranslationKey } from "@scl/shared";
import { Modal } from "./Modal";
import { ErrorState } from "./ErrorState";
import { Avatar } from "./Avatar";
import { apiFetch } from "../lib/api";
import { apiErrorMessage } from "../i18n/errorMessages";
import { useT } from "../i18n/LocaleContext";

export type MembershipKind = "project" | "group";

interface Row {
  teamMemberId: string;
  name: string;
  initials: string;
  role: string;
}

interface ManageMembersModalProps {
  open: boolean;
  kind: MembershipKind;
  id: string;
  /** The project's title / the group's name, for the dialog title and the confirmation sentence. */
  name: string;
  onClose: () => void;
  /** Called once when the dialog closes after at least one successful change, so the page can reload. */
  onChanged: () => void;
}

const ROLES: Record<MembershipKind, readonly string[]> = { project: PROJECT_MEMBER_ROLES, group: GROUP_MEMBER_ROLES };
const ROLE_KEY: Record<MembershipKind, (r: string) => TranslationKey> = {
  project: (r) => `projects.role.${r}` as TranslationKey,
  group: (r) => `groups.role.${r}` as TranslationKey,
};

/**
 * Phase 21: add / change the role of / remove ONE researcher at a time, for a project or a group. Every
 * action is its own request to the single-relationship endpoints (`/{projects,groups}/:id/members[/:tm]`),
 * saved immediately, so a stale copy of the list on this page can never overwrite someone else's change.
 * The server is the only authority (manager, or LEAD of this project/group); this dialog is only opened
 * from a card whose `canManageMembers` the server set, and a 403 is shown like any other error.
 */
export function ManageMembersModal({ open, kind, id, name, onClose, onChanged }: ManageMembersModalProps) {
  const t = useT();
  const base = kind === "project" ? `/projects/${id}` : `/groups/${id}`;
  const roles = ROLES[kind];
  const roleLabel = (r: string) => t(ROLE_KEY[kind](r));

  const [members, setMembers] = useState<Row[] | null>(null);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** After cancelling a removal the confirm buttons unmount: put focus back on that row's Remove button. */
  const [refocus, setRefocus] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [pickRole, setPickRole] = useState("MEMBER");
  const changed = useRef(false);
  const pickRef = useRef<HTMLSelectElement>(null);
  /** The picker is disabled while a request runs, so focus can only return to it once `busy` has cleared. */
  const [wantPickFocus, setWantPickFocus] = useState(false);

  const loadMembers = useCallback(async () => {
    const detail = await apiFetch<ProjectDetail | GroupDetail>(base);
    setMembers([...detail.members].map((m) => ({ teamMemberId: m.teamMemberId, name: m.name, initials: m.initials, role: m.role })));
  }, [base]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    changed.current = false;
    setMembers(null);
    setLoadError(null);
    setError(null);
    setStatus("");
    setConfirmId(null);
    setPick("");
    setPickRole("MEMBER");
    Promise.all([loadMembers(), apiFetch<TeamMember[]>("/team").then((list) => !cancelled && setTeam(list))]).catch((err) => {
      if (!cancelled) setLoadError(apiErrorMessage(err, t));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, base]);

  function close() {
    if (changed.current) onChanged();
    onClose();
  }

  /** One request, then a fresh list; the message is announced in a polite live region. */
  async function act(request: () => Promise<unknown>, done: string, focusPick = false) {
    setError(null);
    setBusy(true);
    try {
      await request();
      changed.current = true;
      await loadMembers();
      setStatus(done);
      setConfirmId(null);
      if (focusPick) setWantPickFocus(true);
    } catch (err) {
      setError(apiErrorMessage(err, t));
      try {
        await loadMembers(); // the error may mean our copy was stale (409 / 404): show the truth
      } catch {
        /* keep the earlier error */
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (wantPickFocus && !busy) {
      pickRef.current?.focus();
      setWantPickFocus(false);
    }
  }, [wantPickFocus, busy]);

  const memberIds = new Set((members ?? []).map((m) => m.teamMemberId));
  const candidates = (team ?? []).filter((p) => !memberIds.has(p.id));

  function add(e: FormEvent) {
    e.preventDefault();
    const person = candidates.find((p) => p.id === pick);
    if (!person) return;
    void act(
      async () => {
        await apiFetch(`${base}/members`, { method: "POST", body: JSON.stringify({ teamMemberId: person.id, role: pickRole }) });
        setPick("");
      },
      t("workspace.manage.added", { name: person.name }),
      true,
    );
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : close} title={t("workspace.manage.title", { name })}>
      <p className="modal__lead">{t("workspace.manage.lead")}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {loadError && <ErrorState message={loadError} />}
      {!loadError && members === null && <p className="text-sm text-muted">{t("workspace.manage.loading")}</p>}
      {error && <div className="form-error" role="alert">{error}</div>}

      {members && (
        <>
          <h3 className="manage__heading">{t("workspace.manage.current", { count: members.length })}</h3>
          {members.length === 0 ? (
            <p className="text-sm text-muted">{t("workspace.manage.none")}</p>
          ) : (
            <ul className="manage__list">
              {members.map((m) => (
                <li key={m.teamMemberId} className="manage__row">
                  <span className="manage__who">
                    <Avatar size="sm" initials={m.initials} />
                    <span className="manage__name">{m.name}</span>
                  </span>
                  {confirmId === m.teamMemberId ? (
                    <span key="confirm" className="manage__confirm" role="group" aria-label={t("workspace.manage.removeFor", { name: m.name })}>
                      <span className="manage__confirm-text">{t("workspace.manage.confirmRemove", { name: m.name, target: name })}</span>
                      <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => act(() => apiFetch(`${base}/members/${m.teamMemberId}`, { method: "DELETE" }), t("workspace.manage.removed", { name: m.name }), true)} ref={(el) => el?.focus()}>
                        {t("workspace.manage.confirmRemoveButton")}
                      </button>
                      <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => {
                        setConfirmId(null);
                        setRefocus(m.teamMemberId);
                      }}>
                        {t("common.cancel")}
                      </button>
                    </span>
                  ) : (
                    <span key="actions" className="manage__actions">
                      <select
                        aria-label={t("common.roleForAria", { name: m.name })}
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => {
                          const role = e.target.value;
                          void act(() => apiFetch(`${base}/members/${m.teamMemberId}`, { method: "PUT", body: JSON.stringify({ role }) }), t("workspace.manage.roleChanged", { name: m.name, role: roleLabel(role) }));
                        }}
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="btn btn--secondary btn--sm" disabled={busy} aria-label={t("workspace.manage.removeFor", { name: m.name })} onClick={() => setConfirmId(m.teamMemberId)} ref={(el) => {
                        if (el && refocus === m.teamMemberId) {
                          el.focus();
                          setRefocus(null);
                        }
                      }}>
                        {t("workspace.manage.remove")}
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h3 className="manage__heading">{t("workspace.manage.add")}</h3>
          {team && candidates.length === 0 ? (
            <p className="text-sm text-muted">{t("workspace.manage.everyoneIn")}</p>
          ) : (
            <form className="manage__add" onSubmit={add}>
              <div className="form-group">
                <label htmlFor="manage-pick">{t("workspace.manage.pick")}</label>
                <select id="manage-pick" ref={pickRef} value={pick} disabled={busy || !team} onChange={(e) => setPick(e.target.value)}>
                  <option value="">{t("workspace.manage.pickPlaceholder")}</option>
                  {candidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.role}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="manage-role">{t("workspace.manage.role")}</label>
                <select id="manage-role" value={pickRole} disabled={busy} onChange={(e) => setPickRole(e.target.value)}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn--primary" type="submit" disabled={busy || !pick}>
                {busy ? t("workspace.manage.adding") : t("workspace.manage.addButton")}
              </button>
            </form>
          )}
        </>
      )}

      <div className="modal__actions">
        <button className="btn btn--secondary" type="button" onClick={close} disabled={busy}>
          {t("workspace.manage.done")}
        </button>
      </div>
    </Modal>
  );
}
