import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Modal } from "./Modal";
import { ApiError } from "../lib/api";
import { useT } from "../i18n/LocaleContext";

export interface PersonOption {
  id: string;
  label: string;
}
export interface MemberSelection {
  teamMemberId: string;
  role: string;
}

interface MembersModalProps {
  open: boolean;
  title: string;
  description: string;
  people: PersonOption[];
  roles: readonly string[];
  roleLabels: Record<string, string>;
  selected: MemberSelection[];
  onClose: () => void;
  onSubmit: (members: MemberSelection[]) => Promise<void>;
}

/** Checkbox list of team members, each with a role. Used for both project and group membership. */
export function MembersModal({ open, title, description, people, roles, roleLabels, selected, onClose, onSubmit }: MembersModalProps) {
  const t = useT();
  const defaultRole = roles[roles.length > 1 ? 1 : 0];
  const [chosen, setChosen] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setChosen(new Map(selected.map((s) => [s.teamMemberId, s.role])));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, defaultRole);
      return next;
    });
  }

  function setRole(id: string, role: string) {
    setChosen((prev) => new Map(prev).set(id, role));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit([...chosen].map(([teamMemberId, role]) => ({ teamMemberId, role })));
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={title}>
      <p className="modal__lead">{description}</p>
      {error && <div className="form-error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit}>
        {people.length === 0 ? (
          <p className="modal__lead">{t("common.noTeamMembersAvailable")}</p>
        ) : (
        <div className="pick-list">
          {people.map((p) => {
            const role = chosen.get(p.id);
            return (
              <div key={p.id} className="pick-item">
                <label className="pick-item__label">
                  <input type="checkbox" checked={role !== undefined} onChange={() => toggle(p.id)} />
                  <span>{p.label}</span>
                </label>
                <select
                  aria-label={t("common.roleForAria", { name: p.label })}
                  value={role ?? defaultRole}
                  disabled={role === undefined}
                  onChange={(e) => setRole(p.id, e.target.value)}
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {roleLabels[r] ?? r}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
        )}
        <div className="modal__actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={submitting}>
            {submitting ? t("common.saving") : t("common.save")}
          </button>
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
