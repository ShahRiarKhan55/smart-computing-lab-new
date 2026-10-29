import type { DuplicateConflictBody } from "@scl/shared";
import { useT } from "../i18n/LocaleContext";

interface Props {
  conflict: Omit<DuplicateConflictBody, "error"> | null;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
}

/**
 * Shown under the form's error when a save was refused as a possible duplicate. Lists the similar existing records and, for a requester
 * who may override (lab manager / admin) and a warning that can be overridden, the "this is a different record" checkbox. A requester who
 * may not is told who can; an identical DOI offers no override at all (the error message already explains it).
 */
export function DuplicateConfirm({ conflict, confirmed, onConfirmedChange }: Props) {
  const t = useT();
  if (!conflict) return null;
  return (
    <div className="form-group" data-testid="duplicate-confirm">
      {conflict.candidates.length > 0 && (
        <>
          <p className="form-hint">{t("duplicate.similarHeading")}</p>
          <ul className="form-hint">
            {conflict.candidates.map((c) => (
              <li key={c.id}>
                {c.label}
                {c.detail ? ` (${c.detail})` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {conflict.overridable && conflict.canOverride && (
        <label className="check-row">
          <input type="checkbox" checked={confirmed} onChange={(e) => onConfirmedChange(e.target.checked)} />
          <span>{t("duplicate.confirm")}</span>
        </label>
      )}
      {conflict.overridable && !conflict.canOverride && <p className="form-hint">{t("duplicate.askManager")}</p>}
    </div>
  );
}
