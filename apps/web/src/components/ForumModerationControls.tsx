import type { ForumTopicSummary } from "@scl/shared";

interface ForumModerationControlsProps {
  topic: ForumTopicSummary;
  onTogglePin: () => void;
  onToggleLock: () => void;
  onToggleHide: () => void;
  onMove: () => void;
  onDelete: () => void;
}

/** Pin/lock/hide/move/delete — lab manager or admin only (`topic.canModerate`). Every action still
 *  re-checks server-side; this only decides which buttons to show. */
export function ForumModerationControls({ topic, onTogglePin, onToggleLock, onToggleHide, onMove, onDelete }: ForumModerationControlsProps) {
  if (!topic.canModerate) return null;
  return (
    <>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onTogglePin}>
        {topic.pinned ? "Unpin" : "Pin"}
      </button>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onToggleLock}>
        {topic.locked ? "Unlock" : "Lock"}
      </button>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onToggleHide}>
        {topic.status === "HIDDEN" ? "Unhide" : "Hide"}
      </button>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onMove}>
        Move
      </button>
      <button type="button" className="btn btn--danger btn--sm" onClick={onDelete}>
        Delete
      </button>
    </>
  );
}
