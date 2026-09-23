import { useState } from "react";
import { Link } from "react-router-dom";
import type { ForumComment as ForumCommentType, ForumReactionKind } from "@scl/shared";
import { Avatar } from "./Avatar";
import { ForumBody } from "./ForumBody";
import { ForumReactionBar } from "./ForumReactionBar";
import { ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";

interface ForumCommentProps {
  comment: ForumCommentType;
  canReact: boolean;
  onReact: (kind: ForumReactionKind, active: boolean) => Promise<void>;
  onEdit: (body: string) => Promise<void>;
  /** Opens the (shared, parent-owned) confirmation dialog — a comment is never deleted from a raw `confirm()`. */
  onRequestDelete: () => void;
}

/** One flat comment (Phase 11 keeps comments one level deep — no reply threading). */
export function ForumComment({ comment, canReact, onReact, onEdit, onRequestDelete }: ForumCommentProps) {
  const { locale, t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await onEdit(draft);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  const isHidden = comment.status === "HIDDEN";

  return (
    <li>
      <article className={`comment${isHidden ? " comment--hidden" : ""}`}>
        <Avatar
          size="sm"
          initials={comment.author.initials}
          to={comment.author.teamMemberId ? `/team/${comment.author.teamMemberId}` : undefined}
          name={comment.author.name}
        />
        <div className="comment__body-col">
          <div className="comment__head">
            {comment.author.teamMemberId ? (
              <Link to={`/team/${comment.author.teamMemberId}`} className="comment__author">
                {comment.author.name}
              </Link>
            ) : (
              <span className="comment__author">{comment.author.name}</span>
            )}
            <span className="comment__time">
              {formatDateTime(comment.createdAt, locale)}
              {comment.editedAt && ` · ${t("forum.edited")}`}
              {isHidden && ` · ${t("forum.hiddenByModerator")}`}
            </span>
          </div>

          {editing ? (
            <div className="form-group">
              <label htmlFor={`comment-edit-${comment.id}`} className="sr-only">
                {t("forum.editCommentSr")}
              </label>
              <textarea id={`comment-edit-${comment.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={5000} disabled={busy} />
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="comment__actions">
                <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={busy || draft.trim() === ""}>
                  {busy ? t("common.saving") : t("common.save")}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    setDraft(comment.body);
                    setEditing(false);
                    setError(null);
                  }}
                  disabled={busy}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <ForumBody text={comment.body} className="comment__text" />
          )}

          {!editing && (
            <>
              <ForumReactionBar reactions={comment.reactions} canReact={canReact} onToggle={onReact} />
              {(comment.canEdit || comment.canDelete) && (
                <div className="comment__actions">
                  {comment.canEdit && (
                    <button type="button" className="btn btn--link btn--sm" onClick={() => setEditing(true)}>
                      {t("common.edit")}
                    </button>
                  )}
                  {comment.canDelete && (
                    <button type="button" className="btn btn--link btn--sm" onClick={onRequestDelete}>
                      {t("common.delete")}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </article>
    </li>
  );
}
