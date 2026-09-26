import { Link } from "react-router-dom";
import { KNOWLEDGE_SECTION_LIMIT, type KnowledgeListResponse } from "@scl/shared";
import { useApiResource } from "../hooks/useApiResource";
import { useLocale } from "../i18n/LocaleContext";
import { formatNumber } from "../lib/format";
import { Icon } from "./Icon";
import { KnowledgeCard } from "./KnowledgeCard";
import { SectionHeader } from "./SectionHeader";

/** Which relationship of the current page the documents hang off. The API applies visibility to both sides. */
export type KnowledgeRelation = "project" | "area" | "group" | "researcher";

interface RelatedKnowledgeProps {
  relation: KnowledgeRelation;
  id: string;
  /** Prefix for the heading id, so each page keeps unique ids. */
  idPrefix: string;
}

/**
 * A small, bounded "Knowledge & documentation" section for a project / research area / group /
 * researcher page: the newest KNOWLEDGE_SECTION_LIMIT documents that are really linked to this record
 * (`GET /api/knowledge?<relation>=<id>&limit=`), and a "View all" link to the full filtered list. The
 * whole section is omitted while loading, on error and when the viewer may see none, so a page with
 * no documentation shows nothing new (never an empty box). The knowledge list itself is not repeated here.
 */
export function RelatedKnowledge({ relation, id, idPrefix }: RelatedKnowledgeProps) {
  const { locale, t } = useLocale();
  const { data } = useApiResource<KnowledgeListResponse>(`/knowledge?${relation}=${encodeURIComponent(id)}&limit=${KNOWLEDGE_SECTION_LIMIT}`);
  if (!data || data.items.length === 0) return null;
  const total = data.pagination.total;
  return (
    <section className="detail-section" aria-labelledby={`${idPrefix}-knowledge`}>
      <SectionHeader
        compact
        id={`${idPrefix}-knowledge`}
        title={t("knowledge.related.heading")}
        action={
          <Link className="link section-header__link" to={`/knowledge?${relation}=${encodeURIComponent(id)}`}>
            {t("knowledge.related.viewAll", { count: formatNumber(total, locale) })} <Icon name="arrow-right" size={14} />
          </Link>
        }
      />
      <div className="grid" role="list" aria-label={t("knowledge.related.aria")}>
        {data.items.map((doc) => (
          <div role="listitem" key={doc.id} className="knowledge-related__item">
            <KnowledgeCard doc={doc} />
          </div>
        ))}
      </div>
    </section>
  );
}
