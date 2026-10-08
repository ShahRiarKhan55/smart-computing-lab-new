import type { Prisma, PrismaClient } from "@prisma/client";
import { canDeleteGalleryItem, canEditGalleryItem, isAdmin, isImageMime, isManager, type GalleryItem, type StoredFileRef } from "@scl/shared";
import { asProjectStatus } from "./serializers.js";
import { canView, visibilityField, type Viewer } from "./visibility.js";

type FileDb = Prisma.TransactionClient | PrismaClient;

/** A file exactly as the public API shows it. `url` is the ONLY way a client ever reaches the
 *  bytes (never a filesystem path or the opaque storage key). */
export function toStoredFileRef(file: { id: string; originalName: string; mimeType: string; sizeBytes: number }): StoredFileRef {
  return {
    id: file.id,
    url: `/api/files/${file.id}`,
    originalName: file.originalName,
    mimeType: file.mimeType as StoredFileRef["mimeType"],
    sizeBytes: file.sizeBytes,
    kind: isImageMime(file.mimeType) ? "image" : "document",
  };
}

interface GalleryRow {
  id: string;
  caption: string;
  category: string;
  takenAt: Date | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  file: { id: string; originalName: string; mimeType: string; sizeBytes: number; visibility: string; ownerId: string | null };
  project: { id: string; slug: string; title: string; status: string; visibility: string } | null;
}

/** A gallery item as the public API shows it. The nested project ref is null'd out unless the
 *  viewer can see that project — a public gallery item linked to a hidden project must never
 *  expose the project's name or id (same rule already used for a forum topic's/news item's
 *  project link; see routes/forum.routes.ts `toTopicSummary`). */
export function toGalleryItem(row: GalleryRow, viewer: Viewer): GalleryItem {
  const isOwner = viewer !== null && row.file.ownerId === viewer.id;
  return {
    id: row.id,
    file: toStoredFileRef(row.file),
    caption: row.caption,
    category: row.category as GalleryItem["category"],
    takenAt: row.takenAt ? row.takenAt.toISOString().slice(0, 10) : null,
    project:
      row.project && canView(viewer, row.project.visibility)
        ? { id: row.project.id, slug: row.project.slug, title: row.project.title, status: asProjectStatus(row.project.status) }
        : null,
    sortOrder: row.sortOrder,
    ...visibilityField(viewer, row.file.visibility),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    canEdit: canEditGalleryItem(viewer, isOwner),
    canDelete: canDeleteGalleryItem(viewer, isOwner),
  };
}

/**
 * Whether `viewer` may resolve a StoredFile's PARENT (only relevant for a file attached to
 * another entity via `entityType`/`entityId` — never for a standalone gallery/library file,
 * which has no parent to check). Documents the future integration point for forum/message
 * attachments (Phase 13 §21/§22): `MESSAGE` is deliberately never resolved here (see
 * @scl/shared schemas/files.ts `FILE_ENTITY_TYPES`) — a generic visibility lookup cannot express
 * "only the conversation's two participants", so message attachments must fail closed until a
 * future phase implements that check properly, not silently "work" through this path.
 */
async function canViewParent(db: FileDb, viewer: Viewer, entityType: string, entityId: string): Promise<boolean> {
  switch (entityType) {
    case "PUBLICATION": {
      const row = await db.publication.findUnique({ where: { id: entityId }, select: { visibility: true } });
      return Boolean(row && canView(viewer, row.visibility));
    }
    case "RESEARCH_PROJECT": {
      const row = await db.researchProject.findUnique({ where: { id: entityId }, select: { visibility: true } });
      return Boolean(row && canView(viewer, row.visibility));
    }
    case "EVENT": {
      const row = await db.event.findUnique({ where: { id: entityId }, select: { visibility: true } });
      return Boolean(row && canView(viewer, row.visibility));
    }
    case "FORUM_POST": {
      const row = await db.forumPost.findUnique({ where: { id: entityId }, select: { status: true, category: { select: { visibility: true } } } });
      return Boolean(row && row.status !== "DELETED" && canView(viewer, row.category.visibility));
    }
    case "FORUM_COMMENT": {
      const row = await db.forumComment.findUnique({
        where: { id: entityId },
        select: { status: true, post: { select: { status: true, category: { select: { visibility: true } } } } },
      });
      return Boolean(row && row.status !== "DELETED" && row.post.status !== "DELETED" && canView(viewer, row.post.category.visibility));
    }
    case "TEAM_MEMBER_PHOTO": {
      // A profile photo is as public as the profile it belongs to: visible unless the profile is unpublished (then only managers/the owner).
      const row = await db.teamMember.findUnique({ where: { id: entityId }, select: { isPublished: true, userId: true } });
      return Boolean(row && (row.isPublished || (viewer && (isManager(viewer) || viewer.id === row.userId))));
    }
    default:
      // MESSAGE and any unrecognised value: no generic rule can safely resolve this — fail closed.
      return false;
  }
}

/**
 * Access to a file = its own visibility AND (if it is attached to something) access to that
 * parent (schema.prisma "Files + gallery"). A standalone file (gallery/library, `entityType`
 * null) has no parent to check. A file whose parent cannot be resolved this way (deleted,
 * unrecognised type, or a `MESSAGE`) is denied to everyone except its owner and admins — fail
 * closed, never fail open.
 */
export async function canAccessFile(
  db: FileDb,
  viewer: Viewer,
  file: { visibility: string; ownerId: string | null; entityType: string | null; entityId: string | null },
): Promise<boolean> {
  if (!canView(viewer, file.visibility)) return false;
  if (!file.entityType || !file.entityId) return true;
  if (await canViewParent(db, viewer, file.entityType, file.entityId)) return true;
  return Boolean(viewer && (viewer.id === file.ownerId || isAdmin(viewer)));
}
