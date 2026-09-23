import type { Visibility } from "@scl/shared";
import { Icon } from "./Icon";

interface VisibilityFieldProps {
  id: string;
  value: Visibility;
  onChange: (value: Visibility) => void;
  disabled?: boolean;
}

/** Public / Lab-only selector. Rendered only for lab managers and admins; the API enforces the same rule. */
export function VisibilityField({ id, value, onChange, disabled }: VisibilityFieldProps) {
  return (
    <div className="form-group">
      <label htmlFor={id}>Visibility</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Visibility)}>
        <option value="PUBLIC">Public — anyone can see this</option>
        <option value="LAB_ONLY">Lab only — logged-in lab members only</option>
      </select>
    </div>
  );
}

/** "Lab only" pill (icon + words, never colour alone). Only ever shown to managers, the only people the API sends `visibility` to. */
export function VisibilityBadge({ visibility }: { visibility?: Visibility }) {
  if (visibility !== "LAB_ONLY") return null;
  return (
    <span className="badge badge--warn vis-badge" title="Only logged-in lab members can see this">
      <Icon name="lock" size={11} /> Lab only
    </span>
  );
}
