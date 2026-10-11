import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  CAPTION_MAX,
  GALLERY_BATCH_MAX_FILES,
  GALLERY_BATCH_MAX_IMAGE_BYTES,
  GALLERY_CATEGORIES,
  IMAGE_MIME_TYPES,
  batchProgress,
  batchSubmitAction,
  createEntryUploader,
  pendingBatchIds,
  planGallerySelection,
  runGalleryBatch,
  type BatchStatus,
  type GalleryCategory,
  type GalleryItem,
  type SelectionRejectReason,
  type Visibility,
} from "@scl/shared";
import { Modal } from "./Modal";
import { VisibilityField } from "./VisibilityField";
import { apiUpload } from "../lib/api";
import { apiErrorMessage } from "../i18n/errorMessages";
import { formatBytes } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";
import { GALLERY_CATEGORY_LABEL_KEY } from "../i18n/labels";

interface GalleryUploadModalProps {
  open: boolean;
  projects: { id: string; title: string }[];
  canSetVisibility: boolean;
  onClose: () => void;
  /** Called once per submission with the ONE gallery entry it created (not once per file). */
  onUploaded: (items: GalleryItem[]) => void;
}

interface BatchEntry {
  id: string;
  file: File;
  status: BatchStatus;
  error?: string;
}

const ACCEPT = IMAGE_MIME_TYPES.join(",");
const REJECT_KEY: Record<SelectionRejectReason, "gallery.rejectedType" | "gallery.rejectedTooLarge" | "gallery.rejectedBatchFull"> = {
  unsupportedType: "gallery.rejectedType",
  tooLarge: "gallery.rejectedTooLarge",
  batchFull: "gallery.rejectedBatchFull",
};

/** Add-photos form: choose up to GALLERY_BATCH_MAX_FILES images that become ONE gallery entry with one
 *  caption/category/project/visibility. The images are sent one request at a time (Vercel's 4.5 MB body
 *  limit): the first successful one creates the entry via `POST /api/gallery`, the rest are appended with
 *  `POST /api/gallery/:id/images` (see `createEntryUploader`), so a retry never creates a second entry. Client-side
 *  checks are a courtesy for fast feedback only — the server is the authority (magic-byte signature
 *  check, size limit, allow-list), so a rejected upload always shows the SERVER's error, never a
 *  fabricated success. Batch logic (selection rules, sequencing, stop-on-401/503, retry) lives in
 *  `@scl/shared` (galleryBatch.ts) where it is unit-tested. */
export function GalleryUploadModal({ open, projects, canSetVisibility, onClose, onUploaded }: GalleryUploadModalProps) {
  const { locale, t } = useLocale();
  const [entries, setEntries] = useState<BatchEntry[]>([]);
  const [rejections, setRejections] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState<GalleryCategory>("LAB_LIFE");
  const [projectId, setProjectId] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("LAB_ONLY");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [runIds, setRunIds] = useState<string[]>([]); // the files in the batch currently/last running (for "Uploading n of m")
  const [finished, setFinished] = useState<{ succeeded: number; failed: number; cancelled: number } | null>(null);
  const [entryCreated, setEntryCreated] = useState(false); // once true the shared details belong to the existing entry
  const fileInputRef = useRef<HTMLInputElement>(null);
  const entriesRef = useRef<BatchEntry[]>([]);
  const runningRef = useRef(false); // synchronous guard against a double-click starting two batches
  const cancelRef = useRef(false);
  const nextId = useRef(0);
  const uploaderRef = useRef<ReturnType<typeof createEntryUploader> | null>(null); // one per submission session; remembers the entry id for retries
  const createdItemRef = useRef<GalleryItem | null>(null);
  const formRef = useRef({ caption, category, projectId, visibility, canSetVisibility });
  formRef.current = { caption, category, projectId, visibility, canSetVisibility }; // read at send time, so a retry before the entry exists uses the current values

  function updateEntries(next: BatchEntry[]) {
    entriesRef.current = next;
    setEntries(next);
  }

  useEffect(() => {
    if (open) {
      updateEntries([]);
      setRejections([]);
      setCaption("");
      setCategory("LAB_LIFE");
      setProjectId("");
      setVisibility("LAB_ONLY");
      setError(null);
      setRunning(false);
      setCancelRequested(false);
      setRunIds([]);
      setFinished(null);
      setEntryCreated(false);
      uploaderRef.current = null;
      createdItemRef.current = null;
      runningRef.current = false;
      cancelRef.current = false;
    }
  }, [open]);

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    // Clear the input so choosing the same file again (after removing it, or after a batch) fires onChange.
    e.target.value = "";
    if (runningRef.current || picked.length === 0) return;
    setError(null);
    setFinished(null);
    const plan = planGallerySelection(entriesRef.current.length, picked);
    setRejections(
      plan.rejected.map(({ file, reason }) =>
        t(REJECT_KEY[reason], { name: file.name, max: formatBytes(GALLERY_BATCH_MAX_IMAGE_BYTES, locale), maxFiles: GALLERY_BATCH_MAX_FILES }),
      ),
    );
    if (plan.accepted.length > 0) {
      updateEntries([
        ...entriesRef.current,
        ...plan.accepted.map((file): BatchEntry => ({ id: `f${nextId.current++}`, file, status: "waiting" })),
      ]);
    }
  }

  function removeEntry(id: string) {
    if (runningRef.current) return;
    updateEntries(entriesRef.current.filter((x) => x.id !== id));
    setRejections([]);
    setFinished(null);
    setError(null);
  }

  function setStatus(id: string, status: BatchStatus, message?: string) {
    updateEntries(entriesRef.current.map((x) => (x.id === id ? { ...x, status, error: status === "failed" ? message : undefined } : x)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (runningRef.current) return; // prevent duplicate submissions while a batch is running
    setError(null);
    setRejections([]);
    setFinished(null);
    const ids = pendingBatchIds(entriesRef.current);
    if (ids.length === 0) {
      if (entriesRef.current.length === 0) setError(t("gallery.chooseImageToUpload"));
      return;
    }

    runningRef.current = true;
    cancelRef.current = false;
    setRunIds(ids);
    setRunning(true);
    setCancelRequested(false);

    const messages = new Map<string, string>();
    const fileFor = (id: string) => entriesRef.current.find((x) => x.id === id)?.file;
    if (!uploaderRef.current) {
      uploaderRef.current = createEntryUploader(
        async (id) => {
          const file = fileFor(id);
          if (!file) throw new Error("missing file");
          const f = formRef.current;
          const form = new FormData();
          form.set("file", file);
          form.set("caption", f.caption);
          form.set("category", f.category);
          if (f.projectId) form.set("projectId", f.projectId);
          if (f.canSetVisibility) form.set("visibility", f.visibility);
          const item = await apiUpload<GalleryItem>("/gallery", form);
          createdItemRef.current = item;
          setEntryCreated(true);
          return item.id;
        },
        async (entryId, id) => {
          const file = fileFor(id);
          if (!file) throw new Error("missing file");
          const form = new FormData();
          form.set("file", file);
          await apiUpload<GalleryItem>(`/gallery/${entryId}/images`, form);
        },
      );
    }
    const uploader = uploaderRef.current;
    const outcome = await runGalleryBatch(
      ids,
      async (id) => {
        try {
          await uploader.upload(id);
        } catch (err) {
          messages.set(id, apiErrorMessage(err, t));
          throw err;
        }
      },
      (id, status) => setStatus(id, status, messages.get(id)),
      () => cancelRef.current,
    );

    runningRef.current = false;
    setRunning(false);
    setCancelRequested(false);
    if (createdItemRef.current) onUploaded([createdItemRef.current]); // refresh the Gallery once, even after a partial failure

    if (outcome.failed === 0 && outcome.cancelled === 0) {
      onClose();
      return;
    }
    setFinished({ succeeded: outcome.succeeded, failed: outcome.failed, cancelled: outcome.cancelled });
    if (outcome.stoppedBy === 401) setError(t("gallery.batchStoppedAuth"));
    else if (outcome.stoppedBy === 503) setError(t("gallery.batchStoppedUnavailable"));
  }

  function cancelRemaining() {
    cancelRef.current = true;
    setCancelRequested(true);
  }

  const pending = pendingBatchIds(entries).length;
  const action = batchSubmitAction(entries);
  const progress = batchProgress(entries, runIds);
  const submitLabel = running
    ? t("gallery.uploading")
    : action === "retry"
      ? t("gallery.retryRemaining", { count: pending })
      : action === "uploadRemaining"
        ? t("gallery.uploadRemaining", { count: pending })
        : entries.length > 1
          ? t("gallery.uploadCount", { count: entries.length })
          : t("gallery.upload");
  // One status line, announced politely: "Uploading image 3 of 8" while running (it changes once per
  // finished file, not on every internal state update), then the final summary.
  const liveStatus = running ? t("gallery.progress", { current: progress.current, total: progress.total }) : finished ? t("gallery.batchSummary", finished) : "";
  const attempted = entries.some((x) => x.status !== "waiting");

  return (
    <Modal open={open} onClose={running ? () => {} : onClose} title={t("gallery.addPhotosTitle")}>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="gallery_file">{t("gallery.imageFiles")}</label>
          <input
            id="gallery_file"
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            disabled={running || entries.length >= GALLERY_BATCH_MAX_FILES}
            data-autofocus
            onChange={onPickFiles}
          />
          <p className="form-hint">{t("gallery.batchHint", { maxFiles: GALLERY_BATCH_MAX_FILES, max: formatBytes(GALLERY_BATCH_MAX_IMAGE_BYTES, locale) })}</p>
          <p className="form-hint">{entryCreated ? t("gallery.entryCreatedLocked") : t("gallery.oneEntryHint")}</p>
          {rejections.length > 0 && (
            <ul className="form-hint gallery-batch__rejections" role="alert">
              {rejections.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
          {entries.length > 0 && (
            <ul className="gallery-batch" aria-label={t("gallery.fileListLabel")}>
              {entries.map((x) => (
                <li key={x.id} className={`gallery-batch__item gallery-batch__item--${x.status}`}>
                  <span className="gallery-batch__name">
                    {x.file.name} <span className="gallery-batch__size">({formatBytes(x.file.size, locale)})</span>
                  </span>
                  <span className="gallery-batch__status">{t(`gallery.status.${x.status}`)}</span>
                  {x.status !== "succeeded" && !running && (
                    <button type="button" className="btn btn--secondary" onClick={() => removeEntry(x.id)} aria-label={t("gallery.removeFileAria", { name: x.file.name })}>
                      ×
                    </button>
                  )}
                  {x.status === "failed" && x.error && <span className="gallery-batch__error">{x.error}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="form-hint" role="status" aria-live="polite">
            {liveStatus}
          </p>
        </div>

        <div className="form-group">
          <label htmlFor="gallery_caption">{t("gallery.caption")}</label>
          <input id="gallery_caption" value={caption} maxLength={CAPTION_MAX} onChange={(e) => setCaption(e.target.value)} placeholder={t("gallery.optionalPlaceholder")} disabled={running || entryCreated} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="gallery_category">{t("gallery.category")}</label>
            <select id="gallery_category" value={category} onChange={(e) => setCategory(e.target.value as GalleryCategory)} disabled={running || entryCreated}>
              {GALLERY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(GALLERY_CATEGORY_LABEL_KEY[c])}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="gallery_project">{t("gallery.project")}</label>
            <select id="gallery_project" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={running || entryCreated}>
              <option value="">{t("gallery.noneOption")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {canSetVisibility && <VisibilityField id="gallery_visibility" value={visibility} onChange={setVisibility} disabled={running || entryCreated} />}

        <div className="modal__actions">
          <button className="btn btn--primary form-submit" type="submit" disabled={running || pending === 0}>
            {submitLabel}
          </button>
          {running ? (
            <button className="btn btn--secondary" type="button" onClick={cancelRemaining} disabled={cancelRequested}>
              {t("gallery.cancelRemaining")}
            </button>
          ) : (
            <button className="btn btn--secondary" type="button" onClick={onClose}>
              {attempted ? t("common.close") : t("common.cancel")}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
