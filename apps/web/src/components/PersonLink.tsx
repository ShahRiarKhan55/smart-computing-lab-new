import { Link } from "react-router-dom";
import { Avatar } from "./Avatar";

interface PersonLinkProps {
  /** Team-member id (a public profile id, never an account id). */
  id: string;
  name: string;
  initials: string;
  /** Second line: a role, or "Project · lead". */
  detail?: string;
}

/** A person as a pill: avatar, name, and what they do here. Links to their profile. */
export function PersonLink({ id, name, initials, detail }: PersonLinkProps) {
  return (
    <Link to={`/team/${id}`} className="person">
      <Avatar size="sm" initials={initials} />
      <span>
        {name}
        {detail && <small>{detail}</small>}
      </span>
    </Link>
  );
}
