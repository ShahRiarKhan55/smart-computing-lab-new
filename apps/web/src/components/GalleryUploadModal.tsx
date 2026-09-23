import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CAPTION_MAX, DEFAULT_IMAGE_MAX_BYTES, GALLERY_CATEGORIES, GALLERY_CATEGORY_LABELS, IMAGE_MIME_TYPES, type GalleryCategory, type GalleryItem, type Visibility } from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { apiUpload, ApiError } from "../lib/api";
import { formatBytes } from "../lib/format";

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
      setError("That file type isn't supported. Choose a JPEG, PNG, WEBP or GIF image.");
      return;
    }
    if (f && f.size > DEFAULT_IMAGE_MAX_BYTES) {
      setFile(null);
      setError(`That image is too large (max ${formatBytes(DEFAULT_IMAGE_MAX_BYTES)}).`);
      return;
    }
    setFile(f);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Choose an image to upload.");
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
      setError(err instanceof ApiError ? err.message : "Upload failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title="Add a photo">
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="gallery_file">Image file</label>
          <input
            id="gallery_file"
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            data-autofocus
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
          <p className="form-hint">JPEG, PNG, WEBP or GIF, up to {formatBytes(DEFAULT_IMAGE_MAX_BYTES)}.</p>
          {file && (
            <p className="form-hint" aria-live="polite">
              Selected: {file.name} ({formatBytes(file.size)})
            </p>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="gallery_caption">Caption</label>
          <input id="gallery_caption" value={caption} maxLength={CAPTION_MAX} onChange={(e) => setCaption(e.target.value)} placeholder="Optional" />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="gallery_category">Category</label>
            <select id="gallery_category" value={category} onChange={(e) => setCategory(e.target.value as GalleryCategory)}>
              {GALLERY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {GALLERY_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="gallery_project">Project</label>
            <select id="gallery_project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— None —</option>
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
            {submitting ? "Uploading…" : "Upload"}
          </button>
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
