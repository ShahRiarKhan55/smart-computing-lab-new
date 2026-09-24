import { Link } from "react-router-dom";
import type { GroupSummary } from "@scl/shared";
import { Avatar } from "./Avatar";
import { Badge } from "./Badge";
import { VisibilityBadge } from "./VisibilityField";
import { useT } from "../i18n/LocaleContext";

const SHOWN_MEMBERS = 8;

export function GroupCard({ group }: { group: GroupSummary }) {
  const t = useT();
  return (
    <article className="card card--interactive project-card">
      <div className="card__top">
        <Badge variant="brand">{t(group.projectCount === 1 ? "groups.projectCountOne" : "groups.projectCountOther", { count: group.projectCount })}</Badge>
        <VisibilityBadge visibility={group.visibility} />
      </div>
      <h3 className="card__title">
        <Link to={`/groups/${group.id}`}>{group.name}</Link>
      </h3>
      {group.description && <p className="card__text">{group.description}</p>}
      {group.members.length > 0 && (
        <div className="avatar-row card__foot" role="group" aria-label={t("groups.membersAria")}>
          {group.members.slice(0, SHOWN_MEMBERS).map((m) => (
            <Avatar key={m.teamMemberId} size="sm" initials={m.initials} to={`/team/${m.teamMemberId}`} name={`${m.name}${m.role === "LEAD" ? t("groups.leadSuffix") : ""}`} />
          ))}
          {group.members.length > SHOWN_MEMBERS && (
            <span className="avatar avatar--sm avatar--more" title={t("groups.moreMembers", { count: group.members.length - SHOWN_MEMBERS })}>
              +{group.members.length - SHOWN_MEMBERS}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
