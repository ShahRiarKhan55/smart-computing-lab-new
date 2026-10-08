import { Link } from "react-router-dom";
import type { TeamMember } from "@scl/shared";
import { Avatar } from "./Avatar";
import { CardEditControls } from "./CardEditControls";
import { ProfileLinks } from "./ProfileLinks";
import { Badge } from "./Badge";
import { useT } from "../i18n/LocaleContext";

interface TeamCardProps {
  member: TeamMember;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function TeamCard({ member, canEdit, canDelete, onEdit, onDelete }: TeamCardProps) {
  const t = useT();
  return (
    <article className="card card--interactive team-card">
      {canEdit && <CardEditControls onEdit={onEdit} onDelete={canDelete ? onDelete : undefined} subject={member.name} />}
      <Avatar size="lg" initials={member.initials} photoUrl={member.photoUrl} />
      <h3 className="card__title team-card__name">
        <Link to={`/team/${member.id}`}>{member.name}</Link>
      </h3>
      <ProfileLinks member={member} />
      {member.isPublished === false && <Badge variant="warn">{t("alumni.hiddenBadge")}</Badge>}
      <div className="team-card__role">{member.role}</div>
      {member.department && <div className="team-card__dept">{member.department}</div>}
    </article>
  );
}
