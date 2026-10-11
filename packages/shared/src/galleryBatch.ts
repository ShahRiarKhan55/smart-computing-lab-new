import { IMAGE_MIME_TYPES } from "./schemas/files.js";

/**
 * Gallery multi-image upload: the pure, framework-free logic behind the upload modal. One submission
 * is ONE gallery entry with several images. Each image is still sent as its own single-file request
 * (Vercel rejects bodies over 4.5 MB, so images cannot share a request): the first successful image
 * creates the entry (`POST /api/gallery`), every later one is appended to it
 * (`POST /api/gallery/:id/images`) — see `createEntryUploader`. Kept here (not in the React
 * component) so it can be unit-tested without a browser (apps/server/scripts/unit-gallery-batch.test.ts).
 */

/** Maximum number of images in one batch. */
export const GALLERY_BATCH_MAX_FILES = 10;

/**
 * Client-side per-image limit for the Gallery upload dialog: 4 MB. Vercel Functions reject request
 * bodies over 4.5 MB (413 FUNCTION_PAYLOAD_TOO_LARGE) and the multipart envelope counts toward that,
 * so the server's own 5 MB image limit (DEFAULT_IMAGE_MAX_BYTES, unchanged) cannot be reached through
 * this endpoint on Vercel. 4 MB is a conservative margin, NOT a guarantee that every 4 MB upload
 * succeeds. The server still validates independently.
 */
export const GALLERY_BATCH_MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** HTTP statuses that mean every further request would fail the same way, so the rest of the batch
 *  is not sent: 401 (signed out) and 503 (file storage unavailable). Any other failure (400, 413,
 *  500, network error...) is specific to one file and the batch continues. */
export const GALLERY_BATCH_STOP_STATUSES: readonly number[] = [401, 503];

export type BatchStatus = "waiting" | "uploading" | "succeeded" | "failed" | "cancelled";

/** The few `File` properties the selection check needs (a real `File` satisfies it). */
export interface FileLike {
  name: string;
  size: number;
  type: string;
}

export type SelectionRejectReason = "unsupportedType" | "tooLarge" | "batchFull";

export interface PlannedSelection<T extends FileLike> {
  accepted: T[];
  rejected: { file: T; reason: SelectionRejectReason }[];
}

/**
 * Splits newly chosen files into those that may join the batch and those that may not, with a reason
 * per rejected file. `currentCount` is how many files are already in the batch. Type and size are
 * checked first, so an invalid file never uses up a slot; only otherwise-valid files can be rejected
 * as `batchFull`. The default size limit is GALLERY_BATCH_MAX_IMAGE_BYTES (4 MB). This is a courtesy check for fast feedback — the server re-validates every file
 * (magic bytes, size, allow-list).
 */
export function planGallerySelection<T extends FileLike>(
  currentCount: number,
  incoming: readonly T[],
  options: { maxFiles?: number; maxBytes?: number } = {},
): PlannedSelection<T> {
  const maxFiles = options.maxFiles ?? GALLERY_BATCH_MAX_FILES;
  const maxBytes = options.maxBytes ?? GALLERY_BATCH_MAX_IMAGE_BYTES;
  const accepted: T[] = [];
  const rejected: PlannedSelection<T>["rejected"] = [];
  for (const file of incoming) {
    if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
      rejected.push({ file, reason: "unsupportedType" });
    } else if (file.size > maxBytes) {
      rejected.push({ file, reason: "tooLarge" });
    } else if (currentCount + accepted.length >= maxFiles) {
      rejected.push({ file, reason: "batchFull" });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

export interface BatchOutcome {
  succeeded: number;
  failed: number;
  cancelled: number;
  /** The status (401 or 503) that stopped the batch early, or null. */
  stoppedBy: number | null;
}

export interface BatchStatusDetail {
  httpStatus?: number;
  message?: string;
}

/**
 * Uploads `ids` strictly one after another with `upload(id)`, reporting each transition through
 * `onStatus`. A failure with a stop status (401/503) marks that file failed and every remaining file
 * cancelled WITHOUT sending it; any other failure marks only that file failed and continues.
 * `shouldCancel` is checked before each file (the in-flight one always completes); remaining files
 * are then cancelled. `upload` signals failure by throwing; an `HttpError`-like `status` property is
 * used for the stop decision.
 */
export async function runGalleryBatch(
  ids: readonly string[],
  upload: (id: string) => Promise<void>,
  onStatus: (id: string, status: BatchStatus, detail?: BatchStatusDetail) => void,
  shouldCancel: () => boolean = () => false,
): Promise<BatchOutcome> {
  const outcome: BatchOutcome = { succeeded: 0, failed: 0, cancelled: 0, stoppedBy: null };
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (outcome.stoppedBy !== null || shouldCancel()) {
      onStatus(id, "cancelled");
      outcome.cancelled++;
      continue;
    }
    onStatus(id, "uploading");
    try {
      await upload(id);
      onStatus(id, "succeeded");
      outcome.succeeded++;
    } catch (err) {
      const httpStatus = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : undefined;
      onStatus(id, "failed", { httpStatus, message: err instanceof Error ? err.message : undefined });
      outcome.failed++;
      if (httpStatus !== undefined && GALLERY_BATCH_STOP_STATUSES.includes(httpStatus)) outcome.stoppedBy = httpStatus;
    }
  }
  return outcome;
}

/** The ids a "retry" should upload: files that failed or were cancelled — never a succeeded file
 *  (which would create a duplicate), and never one that is waiting or mid-upload. */
export function retryableBatchIds(entries: readonly { id: string; status: BatchStatus }[]): string[] {
  return entries.filter((e) => e.status === "failed" || e.status === "cancelled").map((e) => e.id);
}

/** The ids an "Upload"/"Retry remaining" click sends: files that are waiting, failed or cancelled,
 *  in list order. A succeeded file is never included (it would create a duplicate Gallery item) and
 *  a file that is mid-upload is never sent twice. */
export function pendingBatchIds(entries: readonly { id: string; status: BatchStatus }[]): string[] {
  return entries.filter((e) => e.status === "waiting" || e.status === "failed" || e.status === "cancelled").map((e) => e.id);
}

export interface BatchProgress {
  /** Files in this run that have finished (succeeded, failed or cancelled). */
  done: number;
  /** Files in this run. */
  total: number;
  /** 1-based number of the file being uploaded now (never above `total`; 0 for an empty run). */
  current: number;
}

/** Progress of one run (the ids passed to `runGalleryBatch`): counts only those ids, so a retry of 2
 *  files reads "1 of 2", not "3 of 4". The value changes once per finished file, which keeps a
 *  screen-reader announcement to one per file rather than one per internal state update. */
export function batchProgress(entries: readonly { id: string; status: BatchStatus }[], runIds: readonly string[]): BatchProgress {
  const inRun = new Set(runIds);
  const done = entries.filter((e) => inRun.has(e.id) && (e.status === "succeeded" || e.status === "failed" || e.status === "cancelled")).length;
  const total = runIds.length;
  return { done, total, current: total === 0 ? 0 : Math.min(done + 1, total) };
}

export type BatchSubmitAction = "none" | "upload" | "retry" | "uploadRemaining";

/** What the dialog's main button does, so its label always matches what a click sends (the same set
 *  as `pendingBatchIds`): "upload" for a fresh selection; "retry" when only failed/cancelled files
 *  remain; "uploadRemaining" when newly added waiting files would be sent along with them. */
export function batchSubmitAction(entries: readonly { id: string; status: BatchStatus }[]): BatchSubmitAction {
  if (pendingBatchIds(entries).length === 0) return "none";
  if (!entries.some((e) => e.status !== "waiting")) return "upload";
  return entries.some((e) => e.status === "waiting") ? "uploadRemaining" : "retry";
}

/**
 * Turns "upload these N images" into ONE gallery entry. The first image to succeed creates the entry
 * (`create` returns its id); every later image — including a retry after a failure — is appended to
 * that same entry (`append`). Because the entry id is remembered here, retrying a failed image can
 * never create a second entry. If the very first image fails nothing exists yet, so the next image
 * simply becomes the one that creates it. Hold one uploader per submission (reset when the dialog
 * reopens); `upload` is shaped for `runGalleryBatch`.
 */
export function createEntryUploader(
  create: (id: string) => Promise<string>,
  append: (entryId: string, id: string) => Promise<void>,
): { upload: (id: string) => Promise<void>; entryId: () => string | null } {
  let entryId: string | null = null;
  return {
    entryId: () => entryId,
    upload: async (id) => {
      if (entryId === null) entryId = await create(id);
      else await append(entryId, id);
    },
  };
}
