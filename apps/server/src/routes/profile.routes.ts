import { rejectPublicationField } from "../lib/memberVisibility.js";
import { asLockWait, transientContentionAs503 } from "../lib/dbErrors.js";
import { Router } from "express";
import { updateOwnProfileSchema } from "@scl/shared";
import { interactiveTransactionOptions, prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { changedFields, recordAudit } from "../lib/audit.js";
import { toTeamMember } from "../lib/serializers.js";
import { assertIsImage, uploadSingleFile, validateUpload } from "../lib/fileService.js";
import { saveFile } from "../lib/storage.js";
import { releaseUploadedBlob } from "../lib/galleryBlobCleanup.js";
import { sha256Hex } from "../lib/galleryIdempotency.js";
import { ImageHeaderError } from "../lib/imageHeader.js";
import { sanitizeImage, type SanitizedImage } from "../lib/imageSanitize.js";
import { PROFILE_PHOTO_ENTITY_TYPE, removeRetiredBlob, retireReplacedPhoto } from "../lib/profilePhoto.js";

const router = Router();

router.use(requireAuth);

const AUDITED_FIELDS = ["name", "initials", "role", "department", "bio", "photoUrl", "googleScholarUrl", "researchGateUrl", "orcidUrl"] as const;

// GET /api/profile -> the logged-in user's own team profile
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const member = await prisma.teamMember.findUnique({ where: { userId: req.user!.id } });
    if (!member) {
      throw new HttpError(404, "No team profile is linked to your account yet. Ask the admin to link one.");
    }
    res.json(toTeamMember(member, req.user!));
  }),
);

// PUT /api/profile -> update own profile (name/role/dept/bio/photo only;
// category & sortOrder stay under manager control, same as PUT /api/team/:id)
router.put(
  "/",
  asyncHandler(async (req, res) => {
    rejectPublicationField(req.body);
    const body = parseOrThrow(updateOwnProfileSchema, req.body);

    const { updated, retiredKey } = await prisma.$transaction(async (tx) => {
      // The FIRST statement is a write (as in POST /photo and the gallery routes): the transaction takes the write lock before it
      // reads, instead of reading first and then trying to upgrade. Two overlapping read-then-write transactions can each hold a
      // read lock and block the other's commit; see docs/architecture/phase13-files-and-gallery.md ("Profile photos").
      const locked = await asLockWait(tx.teamMember.updateMany({ where: { userId: req.user!.id }, data: { updatedAt: new Date() } }));
      const member = locked.count === 0 ? null : await tx.teamMember.findUnique({ where: { userId: req.user!.id } });
      if (!member) {
        throw new HttpError(404, "No team profile is linked to your account yet. Ask the admin to link one.");
      }
      const data = {
        name: body.name ?? member.name,
        initials: body.initials ?? member.initials,
        role: body.role ?? member.role,
        department: body.department ?? member.department,
        bio: body.bio ?? member.bio,
        photoUrl: body.photoUrl ?? member.photoUrl,
        googleScholarUrl: body.googleScholarUrl ?? member.googleScholarUrl,
        researchGateUrl: body.researchGateUrl ?? member.researchGateUrl,
        orcidUrl: body.orcidUrl ?? member.orcidUrl,
      };
      // photoUrl is written only when the request names it, so a text-only save can never put back a stale photo that a
      // concurrent upload has just replaced.
      const { photoUrl: _unchanged, googleScholarUrl: _gs, researchGateUrl: _rg, orcidUrl: _oc, ...textData } = data;
      // The research links follow the same rule: each is written only when the request names it.
      const writeData = {
        ...textData,
        ...(body.photoUrl === undefined ? {} : { photoUrl: data.photoUrl }),
        ...(body.googleScholarUrl === undefined ? {} : { googleScholarUrl: data.googleScholarUrl }),
        ...(body.researchGateUrl === undefined ? {} : { researchGateUrl: data.researchGateUrl }),
        ...(body.orcidUrl === undefined ? {} : { orcidUrl: data.orcidUrl }),
      };
      const row = await tx.teamMember.update({ where: { id: member.id }, data: writeData });
      // Replacing or clearing an uploaded photo retires the old file in this same transaction (no-op if the URL is unchanged).
      const retiredKey = await retireReplacedPhoto(tx, { memberId: member.id, previousPhotoUrl: member.photoUrl, nextPhotoUrl: row.photoUrl, actor: req.user!, reason: "replaced-profile-photo" });
      const changed = changedFields(member, data, [...AUDITED_FIELDS]);
      if (changed) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "TEAM_MEMBER_UPDATED",
          entityType: "TEAM_MEMBER",
          entityId: row.id,
          details: { name: row.name, changed, own: true },
        });
      }
      return { updated: row, retiredKey };
    }, interactiveTransactionOptions);

    await removeRetiredBlob(retiredKey);
    res.json(toTeamMember(updated, req.user!));
  }),
);

// POST /api/profile/photo -> upload or replace the signed-in member's OWN profile photo.
// multipart: ONE field "file" and nothing else. The member is resolved only from the session's account (TeamMember.userId); the
// request carries no member id, and visibility is never taken from it: an uploaded profile photo is always PUBLIC, set here.
//
// Order of operations (same discipline as POST /api/gallery): validate everything first; write the blob; then ONE transaction
// that creates the StoredFile, repoints photoUrl and (only for a confirmed old uploaded photo of this very member) retires the
// previous file; a failure removes the new blob and leaves the previous photo untouched. The previous blob is removed only after
// the commit, best effort.
router.post(
  "/photo",
  uploadSingleFile,
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!req.file) throw new HttpError(400, 'No image was uploaded (expected multipart field "file").');
    if (Object.keys(req.body ?? {}).length > 0) {
      throw new HttpError(400, 'Send only the image file in the "file" field; no other fields are accepted.');
    }
    const owner = await prisma.teamMember.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
    if (!owner) {
      throw new HttpError(404, "No team profile is linked to your account yet. Ask the admin to link one.");
    }

    const upload = validateUpload(req.file);
    assertIsImage(upload);
    // Public photo: only the sanitized bytes are ever stored, hashed, sized or served. Nothing is written before this succeeds.
    let clean: SanitizedImage;
    try {
      clean = sanitizeImage(upload.buffer, upload.mimeType);
    } catch (err) {
      if (err instanceof ImageHeaderError) throw new HttpError(400, err.message);
      throw err;
    }
    const sha256 = sha256Hex(clean.bytes);

    const storageKey = await saveFile(clean.bytes);
    // Set as the callback's LAST step. If the transaction then reports an error the commit outcome is uncertain, so the blob
    // is kept (see releaseUploadedBlob); if the callback threw earlier, no commit can have been issued and the blob is removed.
    let commitAttempted = false;
    let result: { row: Awaited<ReturnType<typeof prisma.teamMember.update>>; retiredKey: string | null };
    try {
      result = await prisma.$transaction(async (tx) => {
        // The FIRST statement is a write (as in the gallery routes): concurrent uploads queue instead of deadlocking on a lock upgrade.
        const file = await tx.storedFile.create({
          data: {
            storageKey,
            // A fixed name: the original filename is personal data and is sent in Content-Disposition on this public file.
            originalName: `profile-photo.${clean.mimeType.split("/")[1]}`,
            mimeType: clean.mimeType,
            sizeBytes: clean.bytes.length,
            sha256,
            visibility: "PUBLIC",
            ownerId: req.user!.id,
            entityType: PROFILE_PHOTO_ENTITY_TYPE,
            entityId: owner.id,
          },
        });
        // Re-read inside the transaction: the account's profile must still be the one resolved above.
        const current = await tx.teamMember.findUnique({ where: { userId: req.user!.id } });
        if (!current || current.id !== owner.id) throw new HttpError(409, "Your profile changed while the photo was uploading. Please try again.");

        const photoUrl = `/api/files/${file.id}`;
        const row = await tx.teamMember.update({ where: { id: current.id }, data: { photoUrl } });
        // Retire the previous file ONLY if it is confirmed to be an uploaded profile photo of this very member.
        const retiredKey = await retireReplacedPhoto(tx, { memberId: current.id, previousPhotoUrl: current.photoUrl, nextPhotoUrl: photoUrl, actor: req.user!, reason: "replaced-profile-photo" });

        await recordAudit(tx, {
          actor: req.user!,
          action: "FILE_UPLOADED",
          entityType: "STORED_FILE",
          entityId: file.id,
          details: { mimeType: file.mimeType, sizeBytes: file.sizeBytes, visibility: file.visibility, purpose: "profile-photo" },
        });
        await recordAudit(tx, {
          actor: req.user!,
          action: "TEAM_MEMBER_UPDATED",
          entityType: "TEAM_MEMBER",
          entityId: row.id,
          details: { name: row.name, changed: "photoUrl", own: true },
        });
        commitAttempted = true;
        return { row, retiredKey };
      }, interactiveTransactionOptions);
    } catch (err) {
      await releaseUploadedBlob(storageKey, commitAttempted);
      throw err;
    }

    // Committed: only now may the replaced photo's blob go. Never fatal, and never touches the new blob.
    await removeRetiredBlob(result.retiredKey);
    res.status(201).json(toTeamMember(result.row, req.user!));
  }),
);

// Lock contention answers 503 + Retry-After (lib/dbErrors.ts); other errors fall through to the application error handler.
router.use(transientContentionAs503);

export default router;
