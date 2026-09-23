import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CAPTION_MAX, GALLERY_CATEGORIES, type GalleryCategory, type GalleryItem, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { ApiError } from "../lib/api";
import { useT } from "../i18n/LocaleContext";
import { GALLERY_CATEGORY_LABEL_KEY } from "../i18n/labels";

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
  const t = useT();
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
      setError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!item) return null;

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={t("gallery.editTitle")}>
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
          <label htmlFor="gallery_edit_caption">{t("gallery.caption")}</label>
          <input id="gallery_edit_caption" value={caption} maxLength={CAPTION_MAX} onChange={(e) => setCaption(e.target.value)} data-autofocus />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="gallery_edit_category">{t("gallery.category")}</label>
            <select id="gallery_edit_category" value={category} onChange={(e) => setCategory(e.target.value as GalleryCategory)}>
              {GALLERY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(GALLERY_CATEGORY_LABEL_KEY[c])}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="gallery_edit_project">{t("gallery.project")}</label>
            <select id="gallery_edit_project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t("gallery.noneOption")}</option>
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
            {submitting ? t("common.saving") : t("common.save")}
          </button>
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
