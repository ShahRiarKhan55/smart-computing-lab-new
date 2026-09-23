import { Router } from "express";
import type { Prisma } from "@prisma/client";
import {
  GALLERY_MANAGER_ONLY_KEYS,
  canCreateGalleryItem,
  canDeleteGalleryItem,
  canEditGalleryItem,
  createGalleryItemFieldsSchema,
  galleryQuerySchema,
  isManager,
  updateGalleryItemSchema,
  type GalleryItem,
  type GalleryListResponse,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireAuth, requireCan } from "../middleware/auth.js";
import { assertValidId } from "../lib/authorLinks.js";
import { assertMayChangeVisibility, canView, visibleTo, type Viewer } from "../lib/visibility.js";
import { fromIsoDate } from "../lib/serializers.js";
import { toGalleryItem } from "../lib/fileSerializers.js";
import { paginate } from "../lib/forumSerializers.js";
import { assertIsImage, uploadSingleFile, validateUpload } from "../lib/fileService.js";
import { removeFile, saveFile } from "../lib/storage.js";
import { changedFields, recordAudit, recordVisibilityChange } from "../lib/audit.js";

const router = Router();

/**
 * The Lab Gallery (Phase 13). A gallery item wraps a `StoredFile` and has NO visibility of its
 * own — the file's visibility is the single source of truth (schema.prisma), so the two can
 * never disagree. Ownership is the acting account that uploaded the file (`StoredFile.ownerId`,
 * never a client-supplied value): any member may create an item, but editing/deleting is the
 * owner or a manager, the same "owned content" shape as a forum post — see
 * @scl/shared/permissions.ts `canEditGalleryItem`.
 */

function galleryInclude() {
  return {
    file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, visibility: true, ownerId: true, deletedAt: true } },
    project: { select: { id: true, slug: true, title: true, status: true, visibility: true } },
  } satisfies Prisma.GalleryItemInclude;
}

async function assertProjectSelectable(tx: Prisma.TransactionClient, actor: Viewer, projectId: string | null) {
  if (!projectId) return;
  const project = await tx.researchProject.findUnique({ where: { id: projectId }, select: { visibility: true } });
  if (!project || !canView(actor, project.visibility)) throw new HttpError(400, "Selected project does not exist.");
}

// GET /api/gallery?category=&project=&page=&limit= -> public; a guest sees only items whose
// underlying file is PUBLIC (a LAB_ONLY item is simply absent from the list, not an error).
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const query = parseOrThrow(galleryQuerySchema, req.query);
    const where: Prisma.GalleryItemWhereInput = { file: { ...visibleTo(viewer), deletedAt: null } };
    if (query.category) where.category = query.category;
    if (query.project) where.projectId = query.project;

    const total = await prisma.galleryItem.count({ where });
    const rows = await prisma.galleryItem.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: galleryInclude(),
    });

    const response: GalleryListResponse = { items: rows.map((r) => toGalleryItem(r, viewer)), pagination: paginate(query.page, query.limit, total) };
    res.json(response);
  }),
);

// GET /api/gallery/:id -> single item (a hidden/deleted one is a 404, never distinguished from missing).
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const viewer = req.user ?? null;
    const row = await prisma.galleryItem.findFirst({ where: { id: req.params.id, file: { ...visibleTo(viewer), deletedAt: null } }, include: galleryInclude() });
    if (!row) throw new HttpError(404, "Not found");
    res.json(toGalleryItem(row, viewer));
  }),
);

async function loadDetail(id: string, viewer: Viewer): Promise<GalleryItem | null> {
  const row = await prisma.galleryItem.findFirst({ where: { id, file: { deletedAt: null } }, include: galleryInclude() });
  return row ? toGalleryItem(row, viewer) : null;
}

// POST /api/gallery -> upload an image and create its gallery item together (any signed-in
// member). multipart: field "file" (image only — see `assertIsImage`) plus the metadata fields
// in `createGalleryItemFieldsSchema` (caption, category, projectId, visibility, takenAt).
router.post(
  "/",
  requireCan(canCreateGalleryItem),
  uploadSingleFile,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No image was uploaded (expected multipart field "file").');
    const upload = validateUpload(req.file);
    assertIsImage(upload);
    const fields = parseOrThrow(createGalleryItemFieldsSchema, req.body ?? {});
    assertMayChangeVisibility(req.user!, fields.visibility);

    // Blob written FIRST, outside the transaction; any failure below removes it immediately
    // rather than leaving an orphaned file with no database record (Phase 13 "Storage cleanup").
    const storageKey = await saveFile(upload.buffer);
    try {
      const id = await prisma.$transaction(async (tx) => {
        await assertProjectSelectable(tx, req.user!, fields.projectId);
        const file = await tx.storedFile.create({
          data: {
            storageKey,
            originalName: upload.originalName,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
            visibility: fields.visibility ?? "LAB_ONLY",
            ownerId: req.user!.id,
          },
        });
        const item = await tx.galleryItem.create({
          data: {
            fileId: file.id,
            caption: fields.caption,
            category: fields.category,
            projectId: fields.projectId,
            takenAt: fromIsoDate(fields.takenAt ?? null),
          },
        });
        await recordAudit(tx, {
          actor: req.user!,
          action: "GALLERY_ITEM_CREATED",
          entityType: "GALLERY_ITEM",
          entityId: item.id,
          details: { caption: item.caption, category: item.category, visibility: file.visibility, projectId: item.projectId },
        });
        return item.id;
      });
      res.status(201).json(await loadDetail(id, req.user!));
    } catch (err) {
      await removeFile(storageKey).catch((cleanupErr) => console.error(`[gallery] cleanup failed for orphaned blob ${storageKey}:`, cleanupErr));
      throw err;
    }
  }),
);

/**
 * Existence-then-ownership for a write, exactly like `loadOwnMessage` in messages.routes.ts:
 * checked here rather than via the generic `requireEditor` middleware because `GalleryItem` is
 * HARD-deleted (no soft-delete column — see schema.prisma) — once gone, a lookup keyed only on
 * "is this account the owner" can no longer even find the row, which would otherwise turn a
 * second DELETE of an already-deleted item into a misleading 403 instead of 404 for a
 * non-manager. Checking existence FIRST (404) and ownership SECOND (403) keeps that answer
 * correct and consistent for every role, and matches the 404-before-403 order used everywhere
 * else in this codebase.
 */
async function loadEditableGalleryItem(id: string, actorId: string) {
  const item = await prisma.galleryItem.findUnique({ where: { id }, include: { file: { select: { ownerId: true, deletedAt: true } } } });
  if (!item || item.file.deletedAt) throw new HttpError(404, "Not found");
  return { item, isOwner: item.file.ownerId === actorId };
}

// PUT /api/gallery/:id -> the owner may edit caption/category/project/date/order; only a
// manager may change visibility (GALLERY_MANAGER_ONLY_KEYS), exactly like every other
// manager-only field in this codebase (e.g. PROJECT_MANAGER_ONLY_KEYS).
router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { isOwner } = await loadEditableGalleryItem(req.params.id, req.user!.id);
    if (!canEditGalleryItem(req.user!, isOwner)) throw new HttpError(403, "Forbidden");

    const body = parseOrThrow(updateGalleryItemSchema, req.body);
    if (!isManager(req.user!)) {
      const denied = GALLERY_MANAGER_ONLY_KEYS.find((k) => body[k] !== undefined);
      if (denied) throw new HttpError(403, `Only lab managers and admins can change ${denied}.`);
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.galleryItem.findUnique({ where: { id: req.params.id }, include: { file: { select: { visibility: true } } } });
      if (!existing || (await tx.storedFile.findUnique({ where: { id: existing.fileId }, select: { deletedAt: true } }))?.deletedAt) {
        throw new HttpError(404, "Not found");
      }
      if (body.projectId !== undefined) await assertProjectSelectable(tx, req.user!, body.projectId);

      const { visibility, takenAt, ...itemFields } = body;
      await tx.galleryItem.update({
        where: { id: existing.id },
        data: { ...itemFields, ...(takenAt !== undefined && { takenAt: fromIsoDate(takenAt) }) },
      });
      if (visibility !== undefined) await tx.storedFile.update({ where: { id: existing.fileId }, data: { visibility } });

      const before = { ...existing, takenAt: existing.takenAt ? existing.takenAt.toISOString().slice(0, 10) : null };
      const changed = changedFields(before, body, ["caption", "category", "projectId", "sortOrder", "takenAt"]);
      if (changed) {
        await recordAudit(tx, { actor: req.user!, action: "GALLERY_ITEM_UPDATED", entityType: "GALLERY_ITEM", entityId: existing.id, details: { changed } });
      }
      await recordVisibilityChange(tx, req.user!, "GALLERY_ITEM", existing.id, existing.file.visibility, visibility);
    });

    res.json(await loadDetail(req.params.id, req.user!));
  }),
);

// DELETE /api/gallery/:id -> owner or manager. Removes the gallery item AND its backing file
// (soft delete + physical blob) together, so a deleted item can never still be fetched by id
// through GET /api/files/:id.
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { isOwner } = await loadEditableGalleryItem(req.params.id, req.user!.id);
    if (!canDeleteGalleryItem(req.user!, isOwner)) throw new HttpError(403, "Forbidden");

    const removed = await prisma.$transaction(async (tx) => {
      const existing = await tx.galleryItem.findUnique({ where: { id: req.params.id }, include: { file: { select: { id: true, storageKey: true, deletedAt: true } } } });
      if (!existing || existing.file.deletedAt) throw new HttpError(404, "Not found");
      await tx.galleryItem.delete({ where: { id: existing.id } });
      await tx.storedFile.update({ where: { id: existing.fileId }, data: { deletedAt: new Date() } });
      await recordAudit(tx, { actor: req.user!, action: "GALLERY_ITEM_DELETED", entityType: "GALLERY_ITEM", entityId: existing.id, details: { fileId: existing.fileId, caption: existing.caption } });
      return existing.file;
    });
    await removeFile(removed.storageKey).catch((err) => console.error(`[gallery] failed to remove blob for deleted item ${req.params.id}:`, err));
    res.json({ success: true });
  }),
);

export default router;
