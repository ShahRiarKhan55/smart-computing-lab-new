import { Link } from "react-router-dom";
import type { ResearchArea } from "@scl/shared";
import { CardEditControls } from "./CardEditControls";
import { VisibilityBadge } from "./VisibilityField";
import { useT } from "../i18n/LocaleContext";

interface ResearchCardProps {
  area: ResearchArea;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  /** Projects the API already links to this area (visibility-filtered server-side); shown only when there are some. */
  projects?: { id: string; title: string }[];
}

const SHOWN_PROJECTS = 3;

export function ResearchCard({ area, canEdit, canDelete, onEdit, onDelete, projects = [] }: ResearchCardProps) {
  const t = useT();
  const more = projects.length - SHOWN_PROJECTS;
  return (
    <article className={`card research-card${canEdit ? " card--editable" : ""}`}>
      {canEdit && <CardEditControls onEdit={onEdit} onDelete={canDelete ? onDelete : undefined} subject={area.title} />}
      <div className="card__top">
        <span className="icon-tile" aria-hidden="true">
          {area.icon}
        </span>
      </div>
      <h3 className="card__title">
        <Link to={`/research/${area.id}`}>{area.title}</Link>
      </h3>
      <p className="card__text">{area.description}</p>
      <div className="cluster">
        <span className="tag">{area.tag}</span>
        <VisibilityBadge visibility={area.visibility} />
      </div>
      {projects.length > 0 && (
        <div className="card__foot">
          <p className="card-note">{t(projects.length === 1 ? "research.relatedProjectOne" : "research.relatedProjectOther", { count: projects.length })}</p>
          <ul className="mini-list">
            {projects.slice(0, SHOWN_PROJECTS).map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`}>{p.title}</Link>
              </li>
            ))}
            {more > 0 && (
              <li>
                <Link to="/projects">{t("research.andMore", { count: more })}</Link>
              </li>
            )}
          </ul>
        </div>
      )}
    </article>
  );
}
