import { useState, type FormEvent } from "react";
import { mentionToken } from "@scl/shared";
import { ForumMentionPicker, type MentionCandidate } from "./ForumMentionPicker";
import { ApiError } from "../lib/api";

interface ForumCommentComposerProps {
  people: MentionCandidate[];
  onSubmit: (body: string) => Promise<void>;
}

/** The reply box at the bottom of a topic thread. Plain text only — see ForumBody for rendering. */
export function ForumCommentComposer({ people, onSubmit }: ForumCommentComposerProps) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (body.trim() === "") {
      setError("Comment is required.");
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

  function insertMention(p: MentionCandidate) {
    setBody((b) => `${b}${b && !b.endsWith(" ") && !b.endsWith("\n") ? " " : ""}${mentionToken(p.id, p.name)} `);
  }

  return (
    <form className="comment-composer" onSubmit={handleSubmit} noValidate aria-label="Add a comment">
      <div className="form-group">
        <label htmlFor="comment-composer-body">Add a comment</label>
        <textarea id="comment-composer-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={5000} required disabled={submitting} />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn--primary form-submit" disabled={submitting || body.trim() === ""}>
          {submitting ? "Posting…" : "Post comment"}
        </button>
        <ForumMentionPicker people={people} onPick={insertMention} />
      </div>
    </form>
  );
}
