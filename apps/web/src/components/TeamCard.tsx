import { Link } from "react-router-dom";
import type { TeamMember } from "@scl/shared";
import { Avatar } from "./Avatar";
import { CardEditControls } from "./CardEditControls";

interface TeamCardProps {
  member: TeamMember;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function TeamCard({ member, canEdit, canDelete, onEdit, onDelete }: TeamCardProps) {
  return (
    <article className="card card--interactive team-card">
      {canEdit && <CardEditControls onEdit={onEdit} onDelete={canDelete ? onDelete : undefined} subject={member.name} />}
      <Avatar size="lg" initials={member.initials} photoUrl={member.photoUrl} />
      <h3 className="card__title team-card__name">
        <Link to={`/team/${member.id}`}>{member.name}</Link>
      </h3>
      <div className="team-card__role">{member.role}</div>
      {member.department && <div className="team-card__dept">{member.department}</div>}
    </article>
  );
}
