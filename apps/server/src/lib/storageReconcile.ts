import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./prisma.js";
import { STORAGE_ROOT } from "./storage.js";

/**
 * Storage/orphan-blob reconciliation (Phase 26 §7). Phase 25 documented — but did not fix — one
 * accepted crash window: a process crash between a DB write and the matching blob write/removal
 * can leave the two sides of `saveFile`+`StoredFile` disagreeing. This module diagnoses (and,
 * opt-in, safely repairs) exactly that disagreement, without adding any new storage architecture
 * (still plain files under `STORAGE_ROOT`, still one `StoredFile` row per blob).
 *
 * Two independent failure shapes, both read directly off `routes/files.routes.ts`'s existing
 * upload/delete sequencing (see that file's comments) — this module does not change that sequencing,
 * only reconciles after the fact:
 *
 * 1. UPLOAD crash: `saveFile()` writes the blob, then the DB transaction that creates the
 *    `StoredFile` row runs. If the process dies in between, the blob exists with NO matching row
 *    at all — "orphanedNoRow" below. A grace period (`graceMs`, default 24h, keyed off the blob's
 *    own mtime) protects an upload that is merely slow/in-flight right now from being mistaken for
 *    a crash — this reconciler is safe to run at any time, including while the server is live.
 * 2. DELETE crash: `DELETE /api/files/:id` soft-deletes the row (`deletedAt` set) inside a DB
 *    transaction FIRST, then calls `removeFile()`. If the process dies in between (or `removeFile`
 *    itself fails), the blob still exists on disk but its row already says deleted —
 *    "orphanedSoftDeleted" below. This one needs no grace period: the DB transaction is already
 *    committed, so the blob is unambiguously dead weight the moment this scan sees it.
 *
 * A THIRD shape is diagnosed but never auto-repaired: a live (`deletedAt: null`) row whose blob is
 * missing from disk ("missingBlobs"). Deleting that row would destroy metadata (and any other
 * record pointing at it, e.g. a `GalleryItem`) based only on a filesystem listing — the brief's
 * explicit "must not accidentally delete legitimate files" bar applies at least as much to DB rows
 * as to blobs. This is reported for an operator to investigate, never acted on automatically.
 *
 * Deleting is opt-in (`delete: true`) and touches ONLY paths already computed on disk (filtered
 * through the same UUID key pattern `lib/storage.ts` uses), never a client- or DB-supplied path —
 * the same "never trust a path, only ever an opaque key" discipline as the rest of this module.
 */

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;

export interface StorageReconcileOptions {
  /** Defaults to the real STORAGE_ROOT; overridable for tests. */
  storageRoot?: string;
  /** How recently a blob with no DB row must have been written to be left alone (still might be
   * an in-flight upload). Default 24h. */
  graceMs?: number;
  /** When true, actually removes the two orphan categories from disk. Default false (dry run). */
  delete?: boolean;
  /** Defaults to the app's real database connection; overridable for tests (a disposable DB copy). */
  prisma?: Pick<PrismaClient, "storedFile">;
}

export interface StorageReconcileReport {
  scannedFiles: number;
  liveRows: number;
  /** Blob on disk, no DB row at all, older than the grace period — safe to delete. */
  orphanedNoRow: string[];
  /** Blob on disk, DB row exists but is soft-deleted — safe to delete (DB already committed the delete). */
  orphanedSoftDeleted: string[];
  /** Blob on disk, no DB row, but too recent to distinguish from an in-flight upload — left alone. */
  skippedRecent: string[];
  /** Live (non-deleted) DB row whose blob is missing on disk — reported only, never auto-repaired. */
  missingBlobs: { id: string; storageKey: string }[];
  /** Storage keys actually unlinked this run (empty unless `delete: true`). */
  deleted: string[];
}

export async function reconcileStorage(options: StorageReconcileOptions = {}): Promise<StorageReconcileReport> {
  const storageRoot = options.storageRoot ?? STORAGE_ROOT;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const doDelete = options.delete ?? false;
  const prisma = options.prisma ?? defaultPrisma;

  const dirents = await readdir(storageRoot).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [] as string[];
    throw err;
  });
  // Only ever consider names that are themselves valid storage keys — a stray non-UUID file (e.g.
  // an editor swap file an operator dropped in by hand) is never touched, reported, or counted.
  const onDisk = dirents.filter((name) => KEY_PATTERN.test(name));

  const rows = await prisma.storedFile.findMany({ select: { id: true, storageKey: true, deletedAt: true } });
  const rowByKey = new Map(rows.map((r) => [r.storageKey, r] as const));

  const now = Date.now();
  const orphanedNoRow: string[] = [];
  const orphanedSoftDeleted: string[] = [];
  const skippedRecent: string[] = [];

  for (const key of onDisk) {
    const row = rowByKey.get(key);
    if (!row) {
      const stats = await stat(path.join(storageRoot, key));
      if (now - stats.mtimeMs > graceMs) orphanedNoRow.push(key);
      else skippedRecent.push(key);
      continue;
    }
    if (row.deletedAt) orphanedSoftDeleted.push(key);
  }

  const onDiskSet = new Set(onDisk);
  const missingBlobs = rows.filter((r) => !r.deletedAt && !onDiskSet.has(r.storageKey)).map((r) => ({ id: r.id, storageKey: r.storageKey }));

  const deleted: string[] = [];
  if (doDelete) {
    for (const key of [...orphanedNoRow, ...orphanedSoftDeleted]) {
      if (!KEY_PATTERN.test(key)) continue; // defense in depth; onDisk is already filtered
      await unlink(path.join(storageRoot, key)).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      });
      deleted.push(key);
    }
  }

  return {
    scannedFiles: onDisk.length,
    liveRows: rows.filter((r) => !r.deletedAt).length,
    orphanedNoRow,
    orphanedSoftDeleted,
    skippedRecent,
    missingBlobs,
    deleted,
  };
}
