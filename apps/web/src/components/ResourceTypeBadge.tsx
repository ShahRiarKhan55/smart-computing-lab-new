import type { ResourceType } from "@scl/shared";
import { Badge } from "./Badge";
import { useT } from "../i18n/LocaleContext";
import { RESOURCE_TYPE_LABEL_KEY } from "../i18n/labels";

/** A resource's type as a word (never colour alone); the stored value is the same in every locale. */
export function ResourceTypeBadge({ type }: { type: ResourceType }) {
  const t = useT();
  return (
    <Badge variant="brand" upper>
      {t(RESOURCE_TYPE_LABEL_KEY[type])}
    </Badge>
  );
}
