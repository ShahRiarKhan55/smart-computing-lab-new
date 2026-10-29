import { Link } from "react-router-dom";
import type { Publication } from "@scl/shared";
import { Icon } from "./Icon";
import { VisibilityBadge } from "./VisibilityField";
import { useLocale } from "../i18n/LocaleContext";
import { STATUS_LABEL_KEY, publicationDateLabel, publicationMetaParts } from "../lib/publicationDisplay";

interface PublicationItemProps {
  publication: Publication;
  canEdit: boolean;
  canDelete: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onManageAuthors?: () => void;
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  const { t } = useLocale();
  return (
    <a href={href} className="pub-link" target="_blank" rel="noopener noreferrer">
      {children}
      <Icon name="external" size={11} />
      <span className="sr-only">{t("publications.opensInNewTab")}</span>
    </a>
  );
}

/** One row of an academic list: title, authors, venue and year, and links out. Dense on purpose. */
export function PublicationItem({ publication: p, canEdit, canDelete, onEdit, onDelete, onManageAuthors }: PublicationItemProps) {
  const { locale, t } = useLocale();
  const metaParts = publicationMetaParts(p, t);
  return (
    <article className="pub-item">
      <div>
        <h3 className="pub-item__title">
          <Link to={`/publications/${p.id}`} className="pub-item__link">
            {p.title}
          </Link>{" "}
          <VisibilityBadge visibility={p.visibility} />
        </h3>
        <p className="pub-item__authors">{p.authors}</p>
        <p className="pub-item__venue">
          {p.venue}, {publicationDateLabel(p, locale, t)}
        </p>
        {(p.status || p.category || metaParts.length > 0) && (
          <p className="pub-item__meta">
            {p.status && <span className={`badge ${p.status === "PUBLISHED" ? "badge--brand" : p.status === "ACCEPTED" ? "badge--info" : ""}`}>{t(STATUS_LABEL_KEY[p.status])}</span>}
            {p.category && <span className="badge">{p.category}</span>}
            {metaParts.length > 0 && <span className="pub-item__bibliographic">{metaParts.join(" · ")}</span>}
          </p>
        )}
        {(p.pdfUrl || p.doiUrl || p.extraUrl) && (
          <div className="pub-item__links">
            {p.pdfUrl && <ExternalLink href={p.pdfUrl}>{t("publications.pdf")}</ExternalLink>}
            {p.doiUrl && <ExternalLink href={p.doiUrl}>{t("publications.doi")}</ExternalLink>}
            {p.extraUrl && <ExternalLink href={p.extraUrl}>{p.extraLabel || t("common.link")}</ExternalLink>}
          </div>
        )}
      </div>
      {canEdit && (
        <div className="pub-item__actions">
          {onManageAuthors && (
            <button className="icon-btn" title={t("common.manageAuthors")} aria-label={t("common.manageAuthorsOfAria", { subject: p.title })} type="button" onClick={onManageAuthors}>
              <Icon name="users" />
            </button>
          )}
          <button className="icon-btn" title={t("common.edit")} aria-label={t("common.editAria", { subject: p.title })} type="button" onClick={onEdit}>
            <Icon name="edit" />
          </button>
          {canDelete && (
            <button className="icon-btn icon-btn--danger" title={t("common.delete")} aria-label={t("common.deleteAria", { subject: p.title })} type="button" onClick={onDelete}>
              <Icon name="trash" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}
