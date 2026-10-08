import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CAPTION_MAX, DEFAULT_IMAGE_MAX_BYTES, GALLERY_CATEGORIES, IMAGE_MIME_TYPES, type GalleryCategory, type GalleryItem, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { apiUpload } from "../lib/api";
import { uploadErrorMessage } from "../lib/uploadErrors";
import { formatBytes } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";
import { GALLERY_CATEGORY_LABEL_KEY } from "../i18n/labels";

interface GalleryUploadModalProps {
  open: boolean;
  projects: { id: string; title: string }[];
  canSetVisibility: boolean;
  onClose: () => void;
  onUploaded: (item: GalleryItem) => void;
}

const ACCEPT = IMAGE_MIME_TYPES.join(",");

/** Add-a-photo form: file picker (required), caption, category, optional project, visibility
 *  (managers only). Client-side checks are a courtesy for fast feedback only — the server is the
 *  authority (magic-byte signature check, size limit, allow-list), so a rejected upload always
 *  shows the SERVER's error, never a fabricated success. */
export function GalleryUploadModal({ open, projects, canSetVisibility, onClose, onUploaded }: GalleryUploadModalProps) {
  const { locale, t } = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState<GalleryCategory>("LAB_LIFE");
  const [projectId, setProjectId] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("LAB_ONLY");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setCaption("");
      setCategory("LAB_LIFE");
      setProjectId("");
      setVisibility("LAB_ONLY");
      setError(null);
    }
  }, [open]);

  function onPickFile(f: File | null) {
    setError(null);
    if (f && !(IMAGE_MIME_TYPES as readonly string[]).includes(f.type)) {
      setFile(null);
      setError(t("gallery.unsupportedFileType"));
      return;
    }
    if (f && f.size > DEFAULT_IMAGE_MAX_BYTES) {
      setFile(null);
      setError(t("gallery.fileTooLargeMax", { max: formatBytes(DEFAULT_IMAGE_MAX_BYTES, locale) }));
      return;
    }
    setFile(f);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError(t("gallery.chooseImageToUpload"));
      return;
    }

    const form = new FormData();
    form.set("file", file);
    form.set("caption", caption);
    form.set("category", category);
    if (projectId) form.set("projectId", projectId);
    if (canSetVisibility) form.set("visibility", visibility);

    setSubmitting(true);
    try {
      const item = await apiUpload<GalleryItem>("/gallery", form);
      onUploaded(item);
      onClose();
    } catch (err) {
      setError(uploadErrorMessage(err, t, formatBytes(DEFAULT_IMAGE_MAX_BYTES, locale)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={t("gallery.addAPhotoTitle")}>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="gallery_file">{t("gallery.imageFile")}</label>
          <input
            id="gallery_file"
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            data-autofocus
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
          <p className="form-hint">{t("gallery.fileTypesHint", { max: formatBytes(DEFAULT_IMAGE_MAX_BYTES, locale) })}</p>
          {file && (
            <p className="form-hint" aria-live="polite">
              {t("gallery.selected", { name: file.name, size: formatBytes(file.size, locale) })}
            </p>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="gallery_caption">{t("gallery.caption")}</label>
          <input id="gallery_caption" value={caption} maxLength={CAPTION_MAX} onChange={(e) => setCaption(e.target.value)} placeholder={t("gallery.optionalPlaceholder")} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="gallery_category">{t("gallery.category")}</label>
            <select id="gallery_category" value={category} onChange={(e) => setCategory(e.target.value as GalleryCategory)}>
              {GALLERY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(GALLERY_CATEGORY_LABEL_KEY[c])}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="gallery_project">{t("gallery.project")}</label>
            <select id="gallery_project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t("gallery.noneOption")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {canSetVisibility && <VisibilityField id="gallery_visibility" value={visibility} onChange={setVisibility} disabled={submitting} />}

        <div className="modal__actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={submitting || !file}>
            {submitting ? t("gallery.uploading") : t("gallery.upload")}
          </button>
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
