import { Link } from "react-router-dom";
import { RESOURCE_SECTION_LIMIT, type ResourceListResponse } from "@scl/shared";
import { useApiResource } from "../hooks/useApiResource";
import { useLocale } from "../i18n/LocaleContext";
import { formatNumber } from "../lib/format";
import { Icon } from "./Icon";
import { ResourceCard } from "./ResourceCard";
import { SectionHeader } from "./SectionHeader";

/** Which relationship of the current page the resources hang off. The API applies visibility to both sides. */
export type ResourceRelation = "area" | "group" | "researcher" | "knowledge" | "publication";

interface RelatedResourcesProps {
  relation: ResourceRelation;
  id: string;
  /** Prefix for the heading id, so each page keeps unique ids. */
  idPrefix: string;
}

/**
 * A small, bounded "Lab resources" section for a research area / group / researcher / knowledge document /
 * publication page: the newest RESOURCE_SECTION_LIMIT resources that are really linked to this record
 * (`GET /api/resources?<relation>=<id>&limit=`), and a "View all" link to the full filtered list. The whole
 * section is omitted while loading, on error and when the viewer may see none, so a page without resources
 * shows nothing new (never an empty box). (A project page uses ReproducibilityPanel instead.)
 */
export function RelatedResources({ relation, id, idPrefix }: RelatedResourcesProps) {
  const { locale, t } = useLocale();
  const { data } = useApiResource<ResourceListResponse>(`/resources?${relation}=${encodeURIComponent(id)}&limit=${RESOURCE_SECTION_LIMIT}`);
  if (!data || data.items.length === 0) return null;
  const total = data.pagination.total;
  return (
    <section className="detail-section" aria-labelledby={`${idPrefix}-resources`}>
      <SectionHeader
        compact
        id={`${idPrefix}-resources`}
        title={t("resource.related.heading")}
        action={
          <Link className="link section-header__link" to={`/resources?${relation}=${encodeURIComponent(id)}`}>
            {t("resource.related.viewAll", { count: formatNumber(total, locale) })} <Icon name="arrow-right" size={14} />
          </Link>
        }
      />
      <div className="grid" role="list" aria-label={t("resource.related.aria")}>
        {data.items.map((r) => (
          <div role="listitem" key={r.id} className="knowledge-related__item">
            <ResourceCard resource={r} />
          </div>
        ))}
      </div>
    </section>
  );
}
