import { useEffect, useState, type FormEvent } from "react";
import { createForumTopicSchema, mentionToken, type ForumCategory, type ForumTopicDetail } from "@scl/shared";
import { Modal } from "./Modal";
import { ForumMentionPicker, type MentionCandidate } from "./ForumMentionPicker";
import { ApiError } from "../lib/api";

export interface ForumComposerFields {
  categoryId: string;
  title: string;
  body: string;
  projectId: string | null;
}

interface ForumComposerProps {
  open: boolean;
  mode: "create" | "edit";
  categories: ForumCategory[];
  projects: { id: string; title: string }[];
  people: MentionCandidate[];
  initial?: ForumTopicDetail | null;
  defaultCategoryId?: string;
  onClose: () => void;
  /** In "edit" mode `categoryId` is not sent (moving categories is a separate moderation action). */
  onSubmit: (fields: ForumComposerFields) => Promise<void>;
}

function toFormState(initial: ForumTopicDetail | null | undefined, defaultCategoryId?: string): ForumComposerFields {
  return {
    categoryId: initial?.category.id ?? defaultCategoryId ?? "",
    title: initial?.title ?? "",
    body: initial?.body ?? "",
    projectId: initial?.project?.id ?? null,
  };
}

/** Create/edit a topic. Category is choosable only on create; the author's title/body/project are
 * always editable, mentions insert via the picker, and the body stays plain text (see ForumBody). */
export function ForumComposer({ open, mode, categories, projects, people, initial, defaultCategoryId, onClose, onSubmit }: ForumComposerProps) {
  const [values, setValues] = useState<ForumComposerFields>(() => toFormState(initial, defaultCategoryId));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(toFormState(initial, defaultCategoryId));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  function set<K extends keyof ForumComposerFields>(key: K, value: ForumComposerFields[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function insertMention(p: MentionCandidate) {
    set("body", `${values.body}${values.body && !values.body.endsWith(" ") && !values.body.endsWith("\n") ? " " : ""}${mentionToken(p.id, p.name)} `);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "create") {
      const validation = createForumTopicSchema.safeParse(values);
      if (!validation.success) {
        setError(validation.error.issues[0]?.message ?? "Please check the form.");
        return;
      }
    } else if (values.title.trim() === "" || values.body.trim() === "") {
      setError("Title and body are required.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={mode === "create" ? "New topic" : "Edit topic"}>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        {mode === "create" && (
          <div className="form-group">
            <label htmlFor="forum_category">Category</label>
            <select id="forum_category" value={values.categoryId} onChange={(e) => set("categoryId", e.target.value)} required data-autofocus>
              <option value="" disabled>
                Choose a category…
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id} disabled={c.isLocked}>
                  {c.name}
                  {c.isLocked ? " (locked)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="forum_title">Title</label>
          <input id="forum_title" value={values.title} onChange={(e) => set("title", e.target.value)} maxLength={200} required />
        </div>

        <div className="form-group">
          <label htmlFor="forum_body">Body</label>
          <textarea id="forum_body" value={values.body} onChange={(e) => set("body", e.target.value)} rows={8} maxLength={20000} required />
        </div>

        {projects.length > 0 && (
          <div className="form-group">
            <label htmlFor="forum_project">Related project (optional)</label>
            <select id="forum_project" value={values.projectId ?? ""} onChange={(e) => set("projectId", e.target.value || null)}>
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="modal__actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </button>
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <ForumMentionPicker people={people} onPick={insertMention} />
        </div>
      </form>
    </Modal>
  );
}
