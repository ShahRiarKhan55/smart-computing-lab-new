import { FORUM_REACTION_KINDS, FORUM_REACTION_LABELS, type ForumReactionKind, type ForumReactions } from "@scl/shared";

interface ForumReactionBarProps {
  reactions: ForumReactions;
  /** Whether the viewer may react at all (a logged-in member); guests see counts but cannot click. */
  canReact: boolean;
  onToggle: (kind: ForumReactionKind, active: boolean) => void;
  busy?: boolean;
}

/** LIKE / LOVE / INSIGHTFUL / THANKS pills. Word labels, never emoji-only (WCAG 1.4.1). */
export function ForumReactionBar({ reactions, canReact, onToggle, busy }: ForumReactionBarProps) {
  return (
    <div className="reaction-bar" role="group" aria-label="Reactions">
      {FORUM_REACTION_KINDS.map((kind: ForumReactionKind) => {
        const active = reactions.mine.includes(kind);
        const count = reactions.counts[kind];
        return (
          <button
            key={kind}
            type="button"
            className={`reaction-btn${active ? " is-active" : ""}`}
            aria-pressed={active}
            disabled={!canReact || busy}
            title={canReact ? undefined : "Log in to react"}
            onClick={() => onToggle(kind, active)}
          >
            {FORUM_REACTION_LABELS[kind]}
            {count > 0 ? ` (${count})` : ""}
          </button>
        );
      })}
    </div>
  );
}
