import { Router } from "express";
import { canUploadFile, createGalleryItemFieldsSchema, isManager } from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/validate.js";
import { optionalAuth, requireAuth, requireCan } from "../middleware/auth.js";
import { assertValidId } from "../lib/authorLinks.js";
import { assertMayChangeVisibility } from "../lib/visibility.js";
import { canAccessFile, toStoredFileRef } from "../lib/fileSerializers.js";
import { uploadSingleFile, validateUpload } from "../lib/fileService.js";
import { openReadStream, removeFile, saveFile } from "../lib/storage.js";
import { recordAudit } from "../lib/audit.js";

const router = Router();

/**
 * Generic, reusable file upload building block (Phase 13 §"storage architecture"). Every future
 * feature that needs a file (profile photos, project documents, forum/message attachments) can
 * reuse this route and `lib/storage.ts`/`lib/fileService.ts` rather than inventing its own
 * upload path. The GALLERY route (routes/gallery.routes.ts) is the one Phase 13 consumer beyond
 * this generic surface, and calls the same library functions directly rather than looping back
 * through HTTP.
 *
 * A file created here is always STANDALONE (`entityType`/`entityId` null) — attaching a file to
 * another entity is a later phase's job (see @scl/shared schemas/files.ts `FILE_ENTITY_TYPES`);
 * this route never accepts an `entityType`/`entityId` from the client.
 */

// POST /api/files -> upload a standalone file (any signed-in member). multipart field "file";
// optional body field "visibility" (manager-only, like every other visibility field — a member
// who sends it gets 403; omitted = LAB_ONLY, fail closed like every other Phase 8+ table).
router.post(
  "/",
  requireCan(canUploadFile),
  uploadSingleFile,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file was uploaded (expected multipart field \"file\").");
    const upload = validateUpload(req.file);
    const { visibility } = createGalleryItemFieldsSchema.pick({ visibility: true }).parse({ visibility: req.body?.visibility ?? "" });
    assertMayChangeVisibility(req.user!, visibility);

    // Blob is written FIRST, outside the DB transaction (see docs/architecture/phase13
    // "Storage cleanup"): if the DB write below fails for any reason, the blob is removed
    // immediately rather than leaving an orphaned file with no database record.
    const storageKey = await saveFile(upload.buffer);
    try {
      const file = await prisma.$transaction(async (tx) => {
        const row = await tx.storedFile.create({
          data: {
            storageKey,
            originalName: upload.originalName,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
            visibility: visibility ?? "LAB_ONLY",
            ownerId: req.user!.id,
          },
        });
        await recordAudit(tx, {
          actor: req.user!,
          action: "FILE_UPLOADED",
          entityType: "STORED_FILE",
          entityId: row.id,
          details: { mimeType: row.mimeType, sizeBytes: row.sizeBytes, visibility: row.visibility },
        });
        return row;
      });
      res.status(201).json(toStoredFileRef(file));
    } catch (err) {
      await removeFile(storageKey).catch((cleanupErr) => console.error(`[files] cleanup failed for orphaned blob ${storageKey}:`, cleanupErr));
      throw err;
    }
  }),
);

// GET /api/files/:id -> stream the bytes. Authorization happens BEFORE anything is sent (Phase
// 13 §"file access API"): a hidden/inaccessible file answers 404, identical to a missing one —
// the response never reveals whether the id exists at all to someone who may not see it.
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    res.vary("Cookie"); // the response depends on who is asking, like every other visibility-gated route
    const viewer = req.user ?? null;
    const file = await prisma.storedFile.findUnique({ where: { id: req.params.id } });
    if (!file || file.deletedAt) throw new HttpError(404, "Not found");
    if (!(await canAccessFile(prisma, viewer, file))) throw new HttpError(404, "Not found");

    // Documents are safe formats only (Phase 13 §6); inline rendering is fine for images, and
    // PDFs are downloaded rather than framed inline — a deliberate, simple, safe default (no
    // uploaded content is ever served in a way that could execute as HTML/script).
    const isImage = file.mimeType.startsWith("image/");
    // eslint-disable-next-line no-control-regex -- ASCII-only fallback for older clients; the UTF-8 filename* form below is authoritative.
    const asciiName = file.originalName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'") || "download";
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", String(file.sizeBytes));
    res.setHeader("Content-Disposition", `${isImage ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    res.setHeader("Cache-Control", file.visibility === "PUBLIC" ? "public, max-age=3600" : "private, no-store");

    const stream = openReadStream(file.storageKey);
    stream.on("error", () => {
      if (!res.headersSent) res.status(404).json({ error: "Not found" });
    });
    stream.pipe(res);
  }),
);

// DELETE /api/files/:id -> owner or manager. A file backing a gallery item is deleted THROUGH
// the gallery item (DELETE /api/gallery/:id), which removes both together — this keeps exactly
// one deletion path per attachment instead of two that could disagree.
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const file = await prisma.storedFile.findUnique({ where: { id: req.params.id }, include: { galleryItem: { select: { id: true } } } });
    if (!file || file.deletedAt) throw new HttpError(404, "Not found");
    if (!(isManager(req.user!) || file.ownerId === req.user!.id)) throw new HttpError(403, "Forbidden");
    if (file.galleryItem) throw new HttpError(409, "This file is part of a gallery item; delete the gallery item instead.");

    await prisma.$transaction(async (tx) => {
      await tx.storedFile.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "FILE_DELETED",
        entityType: "STORED_FILE",
        entityId: file.id,
        details: { mimeType: file.mimeType, sizeBytes: file.sizeBytes },
      });
    });
    await removeFile(file.storageKey).catch((err) => console.error(`[files] failed to remove blob for deleted file ${file.id}:`, err));
    res.json({ success: true });
  }),
);

export default router;
