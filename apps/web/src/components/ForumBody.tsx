import { Link } from "react-router-dom";
import { splitForumBody } from "@scl/shared";

/**
 * Renders a forum post/comment body as PLAIN TEXT: never `dangerouslySetInnerHTML`, never raw
 * HTML from the database. `@[Name](member:id)` tokens become a link to that member's profile;
 * everything else is plain text nodes, and `white-space: pre-wrap` (see .forum-body in
 * components.css) preserves the line breaks already in the string — no <br> injection needed.
 */
export function ForumBody({ text, className = "forum-body" }: { text: string; className?: string }) {
  const segments = splitForumBody(text);
  return (
    <p className={className}>
      {segments.map((seg, i) =>
        seg.mention ? (
          <Link key={i} to={`/team/${seg.mention.teamMemberId}`} className="mention-link">
            @{seg.mention.name}
          </Link>
        ) : (
          seg.text
        ),
      )}
    </p>
  );
}
