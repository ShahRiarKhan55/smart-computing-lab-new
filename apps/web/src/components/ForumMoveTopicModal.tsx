import { useEffect, useState, type FormEvent } from "react";
import type { ForumCategory } from "@scl/shared";
import { Modal } from "./Modal";
import { ErrorState } from "./ErrorState";
import { ApiError } from "../lib/api";

interface ForumMoveTopicModalProps {
  open: boolean;
  categories: ForumCategory[];
  currentCategoryId: string;
  onClose: () => void;
  onConfirm: (categoryId: string) => Promise<void>;
}

/** Lab manager/admin only: move a topic to a different category (its audience then changes). */
export function ForumMoveTopicModal({ open, categories, currentCategoryId, onClose, onConfirm }: ForumMoveTopicModalProps) {
  const [categoryId, setCategoryId] = useState(currentCategoryId);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setCategoryId(currentCategoryId);
      setError(null);
    }
  }, [open, currentCategoryId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(categoryId);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title="Move topic">
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="move_category">New category</label>
          <select id="move_category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} data-autofocus>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {error && <ErrorState message={error} />}
        <div className="modal__actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={submitting || categoryId === currentCategoryId}>
            {submitting ? "Moving…" : "Move"}
          </button>
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
