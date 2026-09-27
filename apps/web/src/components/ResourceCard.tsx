import { Link } from "react-router-dom";
import type { ResourceSummary } from "@scl/shared";
import { CardEditControls } from "./CardEditControls";
import { ResourceTypeBadge } from "./ResourceTypeBadge";
import { VisibilityBadge } from "./VisibilityField";
import { formatDate } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";

interface ResourceCardProps {
  resource: ResourceSummary;
  /** Show the edit/delete controls (only when the server said this viewer may). */
  onEdit?: () => void;
  onDelete?: () => void;
}

/** One resource in a list: type, name (the only stretched link), version and vendor, excerpt, related research and a byline. */
export function ResourceCard({ resource: r, onEdit, onDelete }: ResourceCardProps) {
  const { locale, t } = useLocale();
  const editable = r.canEdit && !!onEdit;
  const related = [
    ...r.projects.map((p) => ({ key: `project-${p.id}`, to: `/projects/${p.id}`, label: p.title })),
    ...(r.researchArea ? [{ key: "area", to: `/research/${r.researchArea.id}`, label: r.researchArea.title }] : []),
    ...(r.group ? [{ key: "group", to: `/groups/${r.group.id}`, label: r.group.title }] : []),
  ];
  const moreProjects = r.projectCount - r.projects.length;
  const versionLine = [r.version, r.vendor].filter(Boolean).join(" · ");

  return (
    <article className={`card card--interactive resource-card${editable ? " card--editable" : ""}`}>
      {editable && <CardEditControls onEdit={onEdit} onDelete={r.canDelete ? onDelete : undefined} subject={r.name} />}
      <div className="card__top">
        <ResourceTypeBadge type={r.resourceType} />
        <VisibilityBadge visibility={r.visibility} />
      </div>
      <h3 className="card__title resource-card__title">
        <Link to={`/resources/${r.id}`}>{r.name}</Link>
      </h3>
      {versionLine && <p className="card__meta resource-card__version">{versionLine}</p>}
      {r.excerpt && <p className="card__text resource-card__excerpt">{r.excerpt}</p>}
      {(related.length > 0 || moreProjects > 0) && (
        <ul className="knowledge-card__links" aria-label={t("resource.relatedAria")}>
          {related.map((x) => (
            <li key={x.key}>
              <Link to={x.to} className="tag">
                {x.label}
              </Link>
            </li>
          ))}
          {moreProjects > 0 && (
            <li>
              <span className="text-muted">{t("resource.moreProjects", { count: moreProjects })}</span>
            </li>
          )}
        </ul>
      )}
      <p className="card__meta resource-card__byline">
        {[r.owner ? t("resource.byOwner", { name: r.owner.name }) : t("resource.formerMember"), t("resource.updatedOn", { date: formatDate(r.updatedAt, locale) })].join(" · ")}
      </p>
    </article>
  );
}
