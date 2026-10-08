import type { Prisma } from "@prisma/client";

/**
 * A profile photo uploaded from a computer is a normal `StoredFile` row tagged
 * `entityType = "TEAM_MEMBER_PHOTO"`, `entityId = <team member id>` (public: a profile photo is shown
 * on public pages). That tag is what makes replace/remove SAFE: only files carrying it are ever
 * retired, so pointing `photoUrl` at some other file's URL (a gallery picture, a document) can never
 * cause that other file to be deleted.
 */
export const PHOTO_ENTITY_TYPE = "TEAM_MEMBER_PHOTO";

/** `/api/files/<id>` for the stored photo; this is what `TeamMember.photoUrl` holds for an uploaded photo. */
export const photoPathFor = (fileId: string): string => `/api/files/${fileId}`;

/**
 * Soft-deletes the member's managed photo file(s) (optionally keeping the one `keepFileId` names) and
 * returns their storage keys so the caller can remove the blobs AFTER the transaction commits —
 * never before, so a failed write cannot lose the photo that is still in use.
 */
export async function retireProfilePhotos(tx: Prisma.TransactionClient, teamMemberId: string, keepFileId?: string): Promise<string[]> {
  const olds = await tx.storedFile.findMany({
    where: { entityType: PHOTO_ENTITY_TYPE, entityId: teamMemberId, deletedAt: null, ...(keepFileId ? { id: { not: keepFileId } } : {}) },
    select: { id: true, storageKey: true },
  });
  if (olds.length > 0) {
    await tx.storedFile.updateMany({ where: { id: { in: olds.map((o) => o.id) } }, data: { deletedAt: new Date() } });
  }
  return olds.map((o) => o.storageKey);
}
