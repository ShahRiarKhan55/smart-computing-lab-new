import type { ForumTopicSummary } from "@scl/shared";
import { useT } from "../i18n/LocaleContext";

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
  const t = useT();
  if (!topic.canModerate) return null;
  return (
    <>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onTogglePin}>
        {topic.pinned ? t("forum.unpin") : t("forum.pin")}
      </button>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onToggleLock}>
        {topic.locked ? t("forum.unlock") : t("forum.lock")}
      </button>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onToggleHide}>
        {topic.status === "HIDDEN" ? t("forum.unhide") : t("forum.hide")}
      </button>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onMove}>
        {t("forum.move")}
      </button>
      <button type="button" className="btn btn--danger btn--sm" onClick={onDelete}>
        {t("common.delete")}
      </button>
    </>
  );
}
