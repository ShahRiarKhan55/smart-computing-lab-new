import { prisma } from "./prisma.js";
import { removeFile } from "./storage.js";

/**
 * What to do with an uploaded blob after the database transaction that was meant to reference it FAILED.
 *
 * The blob is written before the transaction (a transaction cannot contain a Blob upload), so a failed
 * transaction must not leave it behind. But a failure is not always a rollback: a remote database can
 * report an error for a COMMIT that was in fact applied (a lost reply, a timeout after the server accepted
 * it). Deleting the blob then leaves a committed `StoredFile` row pointing at nothing — a broken image that
 * even an idempotent retry cannot repair. So the blob is deleted ONLY with positive evidence that no commit
 * can have been issued:
 *
 *   - `commitAttempted === false`: the transaction callback itself threw (our own 4xx/409, a failed
 *     statement, a unique violation, a rollback signal) or the transaction never started. Prisma rolls back
 *     when the callback throws and never commits, so nothing can have been committed → delete.
 *   - `commitAttempted === true`: the callback COMPLETED, so Prisma goes on to commit. If the transaction
 *     then reports an error, whether that commit was sent or applied is UNCERTAIN (it may have been applied,
 *     or never sent, e.g. the transaction expired first). NEVER delete. The database is consulted only to say what happened in the log (row present =
 *     committed; absent or unreadable = unknown); the blob is kept in every case. The price is an orphan
 *     blob in the rare case the commit really failed — a leak (recoverable by a future cleanup job), not
 *     corruption.
 *
 * Best-effort and never throws: it must not mask the request's original error.
 */
export type BlobDisposition = "removed" | "remove-failed" | "kept-committed" | "kept-unknown" | "kept-check-failed";

export interface BlobCleanupDeps {
  /** Does a StoredFile row reference this storage key? (may throw: the database may be unreachable) */
  isReferenced: (storageKey: string) => Promise<boolean>;
  remove: (storageKey: string) => Promise<void>;
  log: (message: string) => void;
}

const defaultDeps: BlobCleanupDeps = {
  isReferenced: async (storageKey) => (await prisma.storedFile.findUnique({ where: { storageKey }, select: { id: true } })) !== null,
  remove: removeFile,
  log: (message) => console.error(message),
};

export async function releaseUploadedBlob(storageKey: string, commitAttempted: boolean, deps: BlobCleanupDeps = defaultDeps): Promise<BlobDisposition> {
  if (!commitAttempted) {
    try {
      await deps.remove(storageKey);
      return "removed";
    } catch (err) {
      deps.log(`[gallery] cleanup failed for orphaned blob ${storageKey}: ${err instanceof Error ? err.message : String(err)}`);
      return "remove-failed";
    }
  }
  try {
    if (await deps.isReferenced(storageKey)) {
      deps.log(`[gallery] the database reported an error but the upload was committed; keeping blob ${storageKey}`);
      return "kept-committed";
    }
    deps.log(`[gallery] the commit outcome is unknown and no row references blob ${storageKey}; keeping it (a possible orphan)`);
    return "kept-unknown";
  } catch {
    deps.log(`[gallery] the commit outcome is unknown and could not be checked; keeping blob ${storageKey} (a possible orphan)`);
    return "kept-check-failed";
  }
}
