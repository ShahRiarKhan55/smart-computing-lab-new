import { useState } from "react";
import type { Message } from "@scl/shared";
import { ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";

interface MessageBubbleProps {
  message: Message;
  onEdit: (body: string) => Promise<void>;
  onRequestDelete: () => void;
}

/**
 * One message. Rendered as PLAIN TEXT ONLY: the body is a React text child (never
 * `dangerouslySetInnerHTML`), so hostile input like `<script>`/`<img onerror>` is inert — see
 * Phase 12 §15/§44. `white-space: pre-wrap` (see .message-bubble__text in components.css)
 * preserves the line breaks already in the string.
 */
export function MessageBubble({ message, onEdit, onRequestDelete }: MessageBubbleProps) {
  const { locale, t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
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

  return (
    <li className={`message-row${message.mine ? " message-row--mine" : ""}`}>
      <div className={`message-bubble${message.mine ? " message-bubble--mine" : ""}${message.deleted ? " message-bubble--deleted" : ""}`}>
        {editing ? (
          <div className="form-group">
            <label htmlFor={`message-edit-${message.id}`} className="sr-only">
              {t("messages.editMessageSr")}
            </label>
            <textarea id={`message-edit-${message.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={4000} disabled={busy} />
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
                  setDraft(message.body);
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
          <p className="message-bubble__text">{message.deleted ? t("messages.messageDeleted") : message.body}</p>
        )}

        <div className="message-bubble__meta">
          <span>{formatDateTime(message.createdAt, locale)}</span>
          {message.editedAt && !message.deleted && <span> · {t("messages.edited")}</span>}
        </div>

        {!editing && message.mine && !message.deleted && (
          <div className="comment__actions">
            <button type="button" className="btn btn--link btn--sm" onClick={() => setEditing(true)}>
              {t("common.edit")}
            </button>
            <button type="button" className="btn btn--link btn--sm" onClick={onRequestDelete}>
              {t("common.delete")}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
