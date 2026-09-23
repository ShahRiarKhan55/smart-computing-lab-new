import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useT } from "../i18n/LocaleContext";

export interface MentionCandidate {
  id: string;
  name: string;
}

interface ForumMentionPickerProps {
  people: MentionCandidate[];
  onPick: (person: MentionCandidate) => void;
}

/**
 * A simple selectable-list mention UI (Phase 11 deliberately skips live @-triggered autocomplete —
 * see docs/architecture/phase11-forum-community.md): a button opens a list of team members;
 * picking one inserts `@[Name](member:id)` into the composer via `onPick`. Mentioning a member with
 * no linked account still links to their profile; it just creates no notification (the server drops
 * it — see lib/forumMentions.ts).
 */
export function ForumMentionPicker({ people, onPick }: ForumMentionPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="mention-picker" ref={ref}>
      <button type="button" className="btn btn--secondary btn--sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="listbox">
        <Icon name="user" size={14} /> {t("forum.mentionSomeone")}
      </button>
      {open && (
        <div className="mention-picker__list" role="listbox" aria-label={t("forum.mentionATeamMember")}>
          {people.length === 0 ? (
            <p className="mention-picker__item">{t("forum.noTeamMembersToMention")}</p>
          ) : (
            people.map((p) => (
              <button
                key={p.id}
                type="button"
                className="mention-picker__item"
                role="option"
                aria-selected="false"
                onClick={() => {
                  onPick(p);
                  setOpen(false);
                }}
              >
                {p.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
