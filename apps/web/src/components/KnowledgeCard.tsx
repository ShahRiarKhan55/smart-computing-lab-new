import { Link } from "react-router-dom";
import type { KnowledgeDocSummary } from "@scl/shared";
import { Badge } from "./Badge";
import { CardEditControls } from "./CardEditControls";
import { VisibilityBadge } from "./VisibilityField";
import { formatDate } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";
import { KNOWLEDGE_CATEGORY_LABEL_KEY } from "../i18n/labels";

interface KnowledgeCardProps {
  doc: KnowledgeDocSummary;
  /** Show the edit/delete controls (only when the server said this viewer may). */
  onEdit?: () => void;
  onDelete?: () => void;
}

/** One document in a list: category, title (the only stretched link), excerpt, related research and a byline. */
export function KnowledgeCard({ doc, onEdit, onDelete }: KnowledgeCardProps) {
  const { locale, t } = useLocale();
  const editable = doc.canEdit && !!onEdit;
  const related = [
    doc.project && { key: "project", to: `/projects/${doc.project.id}`, label: doc.project.title },
    doc.researchArea && { key: "area", to: `/research/${doc.researchArea.id}`, label: doc.researchArea.title },
    doc.group && { key: "group", to: `/groups/${doc.group.id}`, label: doc.group.title },
    doc.researcher && { key: "researcher", to: `/team/${doc.researcher.id}`, label: doc.researcher.name },
  ].filter(Boolean) as { key: string; to: string; label: string }[];

  return (
    <article className={`card card--interactive knowledge-card${editable ? " card--editable" : ""}`}>
      {editable && <CardEditControls onEdit={onEdit} onDelete={doc.canDelete ? onDelete : undefined} subject={doc.title} />}
      <div className="card__top">
        <Badge variant="brand" upper>
          {t(KNOWLEDGE_CATEGORY_LABEL_KEY[doc.category])}
        </Badge>
        <VisibilityBadge visibility={doc.visibility} />
      </div>
      <h3 className="card__title knowledge-card__title">
        <Link to={`/knowledge/${doc.id}`}>{doc.title}</Link>
      </h3>
      {doc.excerpt && <p className="card__text knowledge-card__excerpt">{doc.excerpt}</p>}
      {related.length > 0 && (
        <ul className="knowledge-card__links" aria-label={t("knowledge.relatedAria")}>
          {related.map((r) => (
            <li key={r.key}>
              <Link to={r.to} className="tag">
                {r.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="card__meta knowledge-card__byline">
        {[doc.author ? t("knowledge.byAuthor", { name: doc.author.name }) : t("knowledge.formerMember"), t("knowledge.updatedOn", { date: formatDate(doc.updatedAt, locale) })].join(" · ")}
      </p>
    </article>
  );
}
