import { Badge } from "./Badge";
import { Icon } from "./Icon";

interface ForumContextBadgeProps {
  pinned: boolean;
  locked: boolean;
  /** "HIDDEN" only ever reaches this component for a manager viewer (see toTopicSummary). */
  status: "ACTIVE" | "HIDDEN";
}

/** Pinned / locked / hidden state as word-labelled badges — never colour or icon alone. */
export function ForumContextBadge({ pinned, locked, status }: ForumContextBadgeProps) {
  if (!pinned && !locked && status !== "HIDDEN") return null;
  return (
    <div className="topic-row__flags">
      {pinned && (
        <Badge variant="brand" upper>
          <Icon name="layers" size={11} /> Pinned
        </Badge>
      )}
      {locked && (
        <Badge variant="warn" upper>
          <Icon name="lock" size={11} /> Locked
        </Badge>
      )}
      {status === "HIDDEN" && (
        <Badge variant="warn" upper>
          <Icon name="alert" size={11} /> Hidden
        </Badge>
      )}
    </div>
  );
}
