import { ID_PATTERN } from "@scl/shared";
import { recordAudit, type AuditEntry } from "./audit.js";
import { removeFile } from "./storage.js";

/** `StoredFile.entityType` of an uploaded profile photo; `entityId` is the TeamMember id. Free-text column: no migration. */
export const PROFILE_PHOTO_ENTITY_TYPE = "TEAM_MEMBER";

/**
 * The StoredFile id when `photoUrl` is the same-origin URL this server writes for an uploaded photo (`/api/files/<id>`),
 * otherwise null. A legacy external URL, an empty value or anything else returns null, so it is never treated as ours.
 */
export function uploadedPhotoFileId(photoUrl: string): string | null {
  const m = /^\/api\/files\/([^/?#\s]+)$/.exec(photoUrl);
  return m && ID_PATTERN.test(m[1]) ? m[1] : null;
}

type AuditTx = Parameters<typeof recordAudit>[0];
/** The transaction client plus the two StoredFile calls the retirement needs (kept structural so any Prisma tx fits). */
type RetireTx = AuditTx & {
  storedFile: {
    findFirst(args: object): Promise<{ id: string; storageKey: string; mimeType: string; sizeBytes: number } | null>;
    update(args: object): Promise<unknown>;
  };
};

/**
 * Inside the SAME transaction that changes a member's `photoUrl`: soft-deletes the previous uploaded profile photo, but only
 * when (a) the URL really changed, and (b) the old URL is `/api/files/<id>` of a live StoredFile that is a TEAM_MEMBER file of
 * exactly this member and is not a gallery file. Anything else (external URL, empty, another member's or a gallery file) returns
 * null and is untouched. The caller removes the returned blob key only AFTER the commit, best effort (see `removeRetiredBlob`).
 */
export async function retireReplacedPhoto(
  tx: RetireTx,
  args: { memberId: string; previousPhotoUrl: string; nextPhotoUrl: string; actor: AuditEntry["actor"]; reason: string },
): Promise<string | null> {
  if (args.previousPhotoUrl === args.nextPhotoUrl) return null;
  const previousId = uploadedPhotoFileId(args.previousPhotoUrl);
  if (!previousId) return null;
  const previous = await tx.storedFile.findFirst({
    where: { id: previousId, entityType: PROFILE_PHOTO_ENTITY_TYPE, entityId: args.memberId, deletedAt: null, galleryItem: null, galleryImage: null },
  });
  if (!previous) return null;
  await tx.storedFile.update({ where: { id: previous.id }, data: { deletedAt: new Date() } });
  await recordAudit(tx, {
    actor: args.actor,
    action: "FILE_DELETED",
    entityType: "STORED_FILE",
    entityId: previous.id,
    details: { mimeType: previous.mimeType, sizeBytes: previous.sizeBytes, reason: args.reason },
  });
  return previous.storageKey;
}

/** Post-commit, best effort: a failure is logged without the key, path or driver message. The row is already soft-deleted. */
export async function removeRetiredBlob(storageKey: string | null): Promise<void> {
  if (!storageKey) return;
  await removeFile(storageKey).catch((err) => console.error("[profile] failed to remove a retired photo blob:", err instanceof Error ? err.name : "error"));
}
