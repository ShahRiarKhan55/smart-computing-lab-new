import { Link } from "react-router-dom";
import type { ProjectSummary } from "@scl/shared";
import { Avatar } from "./Avatar";
import { StatusBadge } from "./Badge";
import { VisibilityBadge } from "./VisibilityField";
import { formatProjectDates } from "../lib/format";

/** What a card needs; a group page only knows the first four, the full list knows the rest. */
export type ProjectCardData = Pick<ProjectSummary, "id" | "title" | "summary" | "status"> &
  Partial<Pick<ProjectSummary, "visibility" | "startDate" | "endDate" | "group" | "areas" | "members">>;

const SHOWN_MEMBERS = 6;

export function ProjectCard({ project }: { project: ProjectCardData }) {
  const dates = formatProjectDates(project.startDate ?? null, project.endDate ?? null);
  const members = project.members ?? [];
  const areas = project.areas ?? [];
  return (
    <article className="card card--interactive project-card">
      <div className="card__top">
        <StatusBadge status={project.status} />
        <VisibilityBadge visibility={project.visibility} />
      </div>
      <h3 className="card__title">
        <Link to={`/projects/${project.id}`}>{project.title}</Link>
      </h3>
      {project.summary && <p className="card__text">{project.summary}</p>}
      {(dates || project.group) && (
        <p className="card__meta">
          {dates}
          {dates && project.group && " · "}
          {project.group && <Link to={`/groups/${project.group.id}`}>{project.group.name}</Link>}
        </p>
      )}
      {areas.length > 0 && (
        <div className="chips">
          {areas.map((a) => (
            <span key={a.id} className="tag">
              <span aria-hidden="true">{a.icon}</span> {a.title}
            </span>
          ))}
        </div>
      )}
      {members.length > 0 && (
        <div className="avatar-row card__foot" role="group" aria-label="Project members">
          {members.slice(0, SHOWN_MEMBERS).map((m) => (
            <Avatar key={m.teamMemberId} size="sm" initials={m.initials} to={`/team/${m.teamMemberId}`} name={`${m.name} (${m.role.toLowerCase()})`} />
          ))}
          {members.length > SHOWN_MEMBERS && (
            <span className="avatar avatar--sm avatar--more" title={`${members.length - SHOWN_MEMBERS} more members`}>
              +{members.length - SHOWN_MEMBERS}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
