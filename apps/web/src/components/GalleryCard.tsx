import { Link } from "react-router-dom";
import { GALLERY_CATEGORY_LABELS, type GalleryItem } from "@scl/shared";
import { CardEditControls } from "./CardEditControls";
import { VisibilityBadge } from "./VisibilityField";
import { Badge } from "./Badge";

interface GalleryCardProps {
  item: GalleryItem;
  onOpen: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

/** One tile in the gallery grid: a thumbnail that opens the lightbox, plus caption/project/category. */
export function GalleryCard({ item, onOpen, onEdit, onDelete }: GalleryCardProps) {
  const subject = item.caption || "this photo";
  return (
    <figure className={`gallery-tile${item.canEdit ? " card--editable" : ""}`}>
      {item.canEdit && onEdit && <CardEditControls onEdit={onEdit} onDelete={item.canDelete ? onDelete : undefined} subject={subject} />}
      <button type="button" className="gallery-tile__btn" onClick={onOpen}>
        <img className="gallery-tile__img" src={item.file.url} alt="" loading="lazy" decoding="async" />
        <span className="sr-only">Open photo{item.caption ? `: ${item.caption}` : ""}</span>
      </button>
      <figcaption className="gallery-tile__meta">
        <div className="gallery-tile__row">
          <Badge>{GALLERY_CATEGORY_LABELS[item.category]}</Badge>
          <VisibilityBadge visibility={item.visibility} />
        </div>
        {item.caption && <p className="gallery-tile__caption">{item.caption}</p>}
        {item.project && (
          <Link to={`/projects/${item.project.id}`} className="gallery-tile__project link-inline">
            {item.project.title}
          </Link>
        )}
      </figcaption>
    </figure>
  );
}
