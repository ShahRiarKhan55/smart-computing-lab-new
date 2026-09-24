import type { Visibility } from "@scl/shared";
import { Icon } from "./Icon";
import { useT } from "../i18n/LocaleContext";

interface VisibilityFieldProps {
  id: string;
  value: Visibility;
  onChange: (value: Visibility) => void;
  disabled?: boolean;
}

/** Public / Lab-only selector. Rendered only for lab managers and admins; the API enforces the same rule. */
export function VisibilityField({ id, value, onChange, disabled }: VisibilityFieldProps) {
  const t = useT();
  return (
    <div className="form-group">
      <label htmlFor={id}>{t("common.visibility")}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Visibility)}>
        <option value="PUBLIC">{t("common.visibilityPublicOption")}</option>
        <option value="LAB_ONLY">{t("common.visibilityLabOnlyOption")}</option>
      </select>
    </div>
  );
}

/** "Lab only" pill (icon + words, never colour alone). Only ever shown to managers, the only people the API sends `visibility` to. */
export function VisibilityBadge({ visibility }: { visibility?: Visibility }) {
  const t = useT();
  if (visibility !== "LAB_ONLY") return null;
  return (
    <span className="badge badge--warn vis-badge" title={t("common.labOnlyTitle")}>
      <Icon name="lock" size={11} /> {t("common.labOnlyBadge")}
    </span>
  );
}
