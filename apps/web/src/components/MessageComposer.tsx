import { useState, type FormEvent } from "react";
import { MESSAGE_BODY_MAX } from "@scl/shared";
import { ApiError } from "../lib/api";

interface MessageComposerProps {
  onSubmit: (body: string) => Promise<void>;
}

/** The message box at the bottom of a conversation. Plain text only — see MessageBubble for
 *  rendering; there is no rich text editor and no `dangerouslySetInnerHTML` anywhere in this app. */
export function MessageComposer({ onSubmit }: MessageComposerProps) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (body.trim() === "") {
      setError("Message is required.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(body);
      setBody("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // Reuses the forum reply composer's chrome (.comment-composer): same shape, no new CSS needed.
    <form className="comment-composer" onSubmit={handleSubmit} noValidate aria-label="Send a message">
      <div className="form-group">
        <label htmlFor="message-composer-body">Message</label>
        <textarea
          id="message-composer-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={MESSAGE_BODY_MAX}
          required
          disabled={submitting}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter inserts a line break — the usual chat convention.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn--primary form-submit" disabled={submitting || body.trim() === ""}>
          {submitting ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
