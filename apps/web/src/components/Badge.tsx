import type { ReactNode } from "react";
import type { ProjectStatus } from "@scl/shared";
import { useT } from "../i18n/LocaleContext";
import { PROJECT_STATUS_LABEL_KEY } from "../i18n/labels";

export type BadgeVariant = "neutral" | "brand" | "info" | "warn";

export function Badge({ variant = "neutral", upper, children }: { variant?: BadgeVariant; upper?: boolean; children: ReactNode }) {
  return <span className={`badge${variant !== "neutral" ? ` badge--${variant}` : ""}${upper ? " badge--upper" : ""}`}>{children}</span>;
}

const STATUS_VARIANT: Record<ProjectStatus, BadgeVariant> = {
  PLANNED: "neutral",
  ACTIVE: "brand",
  COMPLETED: "info",
  ARCHIVED: "neutral",
};

/** A project's lifecycle state: always the word, never colour alone. */
export function StatusBadge({ status }: { status: ProjectStatus }) {
  const t = useT();
  return (
    <Badge variant={STATUS_VARIANT[status]} upper>
      {t(PROJECT_STATUS_LABEL_KEY[status])}
    </Badge>
  );
}
