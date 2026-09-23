import type { Publication } from "@scl/shared";
import { Icon } from "./Icon";
import { VisibilityBadge } from "./VisibilityField";

interface PublicationItemProps {
  publication: Publication;
  canEdit: boolean;
  canDelete: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onManageAuthors?: () => void;
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} className="pub-link" target="_blank" rel="noopener noreferrer">
      {children}
      <Icon name="external" size={11} />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** One row of an academic list: title, authors, venue and year, and links out. Dense on purpose. */
export function PublicationItem({ publication: p, canEdit, canDelete, onEdit, onDelete, onManageAuthors }: PublicationItemProps) {
  return (
    <article className="pub-item">
      <div>
        <h3 className="pub-item__title">
          {p.title} <VisibilityBadge visibility={p.visibility} />
        </h3>
        <p className="pub-item__authors">{p.authors}</p>
        <p className="pub-item__venue">
          {p.venue}, {p.year}
        </p>
        {(p.pdfUrl || p.doiUrl || p.extraUrl) && (
          <div className="pub-item__links">
            {p.pdfUrl && <ExternalLink href={p.pdfUrl}>PDF</ExternalLink>}
            {p.doiUrl && <ExternalLink href={p.doiUrl}>DOI</ExternalLink>}
            {p.extraUrl && <ExternalLink href={p.extraUrl}>{p.extraLabel || "Link"}</ExternalLink>}
          </div>
        )}
      </div>
      {canEdit && (
        <div className="pub-item__actions">
          {onManageAuthors && (
            <button className="icon-btn" title="Manage authors" aria-label={`Manage authors of ${p.title}`} type="button" onClick={onManageAuthors}>
              <Icon name="users" />
            </button>
          )}
          <button className="icon-btn" title="Edit" aria-label={`Edit ${p.title}`} type="button" onClick={onEdit}>
            <Icon name="edit" />
          </button>
          {canDelete && (
            <button className="icon-btn icon-btn--danger" title="Delete" aria-label={`Delete ${p.title}`} type="button" onClick={onDelete}>
              <Icon name="trash" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}
