import { Link } from "react-router-dom";
import type { ProjectSummary, TranslationKey } from "@scl/shared";
import { Avatar } from "./Avatar";
import { StatusBadge } from "./Badge";
import { VisibilityBadge } from "./VisibilityField";
import { formatMonthYear } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";

const ROLE_LABEL_KEY: Record<string, TranslationKey> = {
  LEAD: "projects.role.LEAD",
  MEMBER: "projects.role.MEMBER",
  COLLABORATOR: "projects.role.COLLABORATOR",
};

/** What a card needs; a group page only knows the first four, the full list knows the rest. */
export type ProjectCardData = Pick<ProjectSummary, "id" | "title" | "summary" | "status"> &
  Partial<Pick<ProjectSummary, "visibility" | "startDate" | "endDate" | "group" | "areas" | "members">>;

const SHOWN_MEMBERS = 6;

export function ProjectCard({ project }: { project: ProjectCardData }) {
  const { locale, t } = useLocale();
  const start = project.startDate ?? null;
  const end = project.endDate ?? null;
  const dates = start && end ? `${formatMonthYear(start, locale)} – ${formatMonthYear(end, locale)}` : start ? t("dates.since", { date: formatMonthYear(start, locale) }) : end ? t("dates.until", { date: formatMonthYear(end, locale) }) : "";
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
        <div className="avatar-row card__foot" role="group" aria-label={t("projects.membersAria")}>
          {members.slice(0, SHOWN_MEMBERS).map((m) => (
            <Avatar key={m.teamMemberId} size="sm" initials={m.initials} to={`/team/${m.teamMemberId}`} name={`${m.name} (${t(ROLE_LABEL_KEY[m.role] ?? "projects.role.MEMBER").toLowerCase()})`} />
          ))}
          {members.length > SHOWN_MEMBERS && (
            <span className="avatar avatar--sm avatar--more" title={t("projects.moreMembers", { count: members.length - SHOWN_MEMBERS })}>
              +{members.length - SHOWN_MEMBERS}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
