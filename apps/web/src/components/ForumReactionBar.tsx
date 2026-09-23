import { FORUM_REACTION_KINDS, type ForumReactionKind, type ForumReactions, type TranslationKey } from "@scl/shared";
import { useT } from "../i18n/LocaleContext";

interface ForumReactionBarProps {
  reactions: ForumReactions;
  /** Whether the viewer may react at all (a logged-in member); guests see counts but cannot click. */
  canReact: boolean;
  onToggle: (kind: ForumReactionKind, active: boolean) => void;
  busy?: boolean;
}

/** Localized label for each reaction kind — same `Record<kind, TranslationKey>` convention as
 * `ROLE_LABEL_KEY` in `auth/usePolicy.ts`. */
const REACTION_LABEL_KEY: Record<ForumReactionKind, TranslationKey> = {
  LIKE: "forum.reaction.LIKE",
  LOVE: "forum.reaction.LOVE",
  INSIGHTFUL: "forum.reaction.INSIGHTFUL",
  THANKS: "forum.reaction.THANKS",
};

/** LIKE / LOVE / INSIGHTFUL / THANKS pills. Word labels, never emoji-only (WCAG 1.4.1). */
export function ForumReactionBar({ reactions, canReact, onToggle, busy }: ForumReactionBarProps) {
  const t = useT();
  return (
    <div className="reaction-bar" role="group" aria-label={t("forum.reactionsAria")}>
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
            title={canReact ? undefined : t("forum.loginToReact")}
            onClick={() => onToggle(kind, active)}
          >
            {t(REACTION_LABEL_KEY[kind])}
            {count > 0 ? ` (${count})` : ""}
          </button>
        );
      })}
    </div>
  );
}
