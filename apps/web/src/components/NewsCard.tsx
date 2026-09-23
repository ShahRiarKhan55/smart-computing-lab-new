import type { NewsItem } from "@scl/shared";
import { Badge } from "./Badge";
import { CardEditControls } from "./CardEditControls";
import { VisibilityBadge } from "./VisibilityField";

interface NewsCardProps {
  item: NewsItem;
  canEdit?: boolean;
  canDelete?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onManageAuthors?: () => void;
}

export function NewsCard({ item: n, canEdit = false, canDelete = false, onEdit, onDelete, onManageAuthors }: NewsCardProps) {
  const editable = canEdit && !!onEdit;
  return (
    <article className={`card news-card${editable ? " card--editable" : ""}`}>
      {editable && <CardEditControls onEdit={onEdit} onDelete={canDelete ? onDelete : undefined} onManageAuthors={onManageAuthors} subject={n.title} />}
      <div className="card__top news-card__head">
        <span className="icon-tile icon-tile--sm" aria-hidden="true">
          {n.emoji}
        </span>
        <div className="news-card__meta">
          <time className="news-card__date">{n.date}</time>
          <Badge variant="brand">{n.type}</Badge>
          <VisibilityBadge visibility={n.visibility} />
        </div>
      </div>
      <h3 className="card__title">{n.title}</h3>
      <p className="card__text">{n.description}</p>
    </article>
  );
}
