import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CAPTION_MAX, GALLERY_CATEGORIES, GALLERY_CATEGORY_LABELS, type GalleryCategory, type GalleryItem, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { ApiError } from "../lib/api";

export interface GalleryEditFields {
  caption: string;
  category: GalleryCategory;
  projectId: string | null;
  visibility?: Visibility;
}

interface GalleryFormModalProps {
  open: boolean;
  item: GalleryItem | null;
  projects: { id: string; title: string }[];
  canSetVisibility: boolean;
  onClose: () => void;
  onSubmit: (fields: GalleryEditFields) => Promise<void>;
}

/** Edit a gallery item's metadata (caption/category/project/visibility) — never re-uploads the
 *  image itself; delete-and-re-add covers that rare case, keeping this form simple. */
export function GalleryFormModal({ open, item, projects, canSetVisibility, onClose, onSubmit }: GalleryFormModalProps) {
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState<GalleryCategory>("LAB_LIFE");
  const [projectId, setProjectId] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("LAB_ONLY");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && item) {
      setCaption(item.caption);
      setCategory(item.category);
      setProjectId(item.project?.id ?? "");
      setVisibility(item.visibility ?? "LAB_ONLY");
      setError(null);
    }
  }, [open, item]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ caption, category, projectId: projectId || null, ...(canSetVisibility ? { visibility } : {}) });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!item) return null;

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title="Edit photo">
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="gallery-edit-preview">
          <img src={item.file.url} alt="" />
        </div>

        <div className="form-group">
          <label htmlFor="gallery_edit_caption">Caption</label>
          <input id="gallery_edit_caption" value={caption} maxLength={CAPTION_MAX} onChange={(e) => setCaption(e.target.value)} data-autofocus />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="gallery_edit_category">Category</label>
            <select id="gallery_edit_category" value={category} onChange={(e) => setCategory(e.target.value as GalleryCategory)}>
              {GALLERY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {GALLERY_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="gallery_edit_project">Project</label>
            <select id="gallery_edit_project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— None —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {canSetVisibility && <VisibilityField id="gallery_edit_visibility" value={visibility} onChange={setVisibility} disabled={submitting} />}

        <div className="modal__actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </button>
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
