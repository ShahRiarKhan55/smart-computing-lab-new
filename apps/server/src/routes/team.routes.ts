import { Router } from "express";
import {
  CATEGORY_ORDER,
  canCreateTeamMember,
  canDeleteTeamMember,
  canManageTeamPlacement,
  createTeamMemberSchema,
  isManager,
  updateTeamMemberSchema,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireCan, requireOwnerOrManager } from "../middleware/auth.js";
import { toTeamMember } from "../lib/serializers.js";
import { assertValidId } from "../lib/authorLinks.js";
import { changedFields, recordAudit } from "../lib/audit.js";
import { applyTranslationOverrides, loadTranslations, localize, resolveLocale } from "../lib/translations.js";
import { uploadProfilePhotoFile, validateProfilePhoto } from "../lib/fileService.js";
import { removeFile, saveFile } from "../lib/storage.js";
import { PHOTO_ENTITY_TYPE, photoPathFor, retireProfilePhotos } from "../lib/profilePhoto.js";
import { ALUMNI_NO_ACCOUNT_MESSAGE } from "../lib/alumni.js";
import type { Viewer } from "../lib/visibility.js";

const router = Router();

const AUDITED_FIELDS = ["name", "initials", "role", "category", "department", "bio", "photoUrl", "scholarUrl", "researchGateUrl", "orcid", "isPublished", "sortOrder"] as const;

/** Unpublished profiles are visible only to lab managers/admins and to the profile's own account. */
function visibleProfiles(viewer: Viewer) {
  if (isManager(viewer)) return {};
  return { OR: [{ isPublished: true }, ...(viewer ? [{ userId: viewer.id }] : [])] };
}

/** The `/api/files/<id>` file id inside a managed photo path, or undefined for an external URL / empty. */
function managedPhotoFileId(photoUrl: string): string | undefined {
  return /^\/api\/files\/([A-Za-z0-9_-]{1,64})$/.exec(photoUrl)?.[1];
}

async function removeBlobs(keys: string[], what: string) {
  await Promise.all(keys.map((k) => removeFile(k).catch((err) => console.error(`[team] failed to remove ${what} blob ${k}:`, err))));
}

// GET /api/team -> list all team members, grouped by category order (public).
// `isOwn` is computed per viewer; the account id is never returned. Alumni are included (they carry
// category ALUMNI, sorted last) so author/member pickers keep working; the web app separates them.
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const locale = resolveLocale(req);
    const rows = await prisma.teamMember.findMany({
      where: visibleProfiles(viewer),
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const translations = await loadTranslations(prisma, "TEAM_MEMBER", rows.map((r) => r.id), locale);
    const members = rows.map((r) => toTeamMember(localize(r, "TEAM_MEMBER", translations), viewer));
    members.sort(
      (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
    );
    res.json(members);
  }),
);

// GET /api/team/:id -> single member (public; an unpublished profile is a 404 to everyone but managers and its owner)
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const row = await prisma.teamMember.findFirst({ where: { id: req.params.id, ...visibleProfiles(viewer) } });
    if (!row) throw new HttpError(404, "Not found");
    const translations = await loadTranslations(prisma, "TEAM_MEMBER", [row.id], resolveLocale(req));
    res.json(toTeamMember(localize(row, "TEAM_MEMBER", translations), viewer));
  }),
);

// POST /api/team -> create (lab manager or admin). Never creates an account: `userId` is always null,
// which is also what keeps an ALUMNI entry login-free.
router.post(
  "/",
  requireCan(canCreateTeamMember),
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(createTeamMemberSchema, req.body);
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.teamMember.create({
        data: {
          userId: null,
          name: body.name,
          initials: body.initials,
          role: body.role,
          category: body.category,
          department: body.department,
          bio: body.bio,
          photoUrl: body.photoUrl,
          scholarUrl: body.scholarUrl,
          researchGateUrl: body.researchGateUrl,
          orcid: body.orcid,
          isPublished: body.isPublished ?? true,
          sortOrder: body.sortOrder,
        },
      });
      await applyTranslationOverrides(tx, "TEAM_MEMBER", row.id, body.translations?.ja);
      await recordAudit(tx, {
        actor: req.user!,
        action: "TEAM_MEMBER_CREATED",
        entityType: "TEAM_MEMBER",
        entityId: row.id,
        details: { name: row.name, category: row.category },
      });
      return row;
    });
    res.status(201).json(toTeamMember(created, req.user!));
  }),
);

// PUT /api/team/:id -> update (the member's own linked account, or a lab manager/admin)
router.put(
  "/:id",
  requireOwnerOrManager("id"),
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(updateTeamMemberSchema, req.body);
    const mayPlace = canManageTeamPlacement(req.user!);

    let retiredKeys: string[] = [];
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.teamMember.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");

      // Only managers change category, sort order or visibility; for anyone else those fields are
      // ignored, so editing your own profile can never move you or hide/show you.
      const category = mayPlace ? body.category ?? existing.category : existing.category;
      if (category === "ALUMNI" && existing.category !== "ALUMNI" && existing.userId) {
        throw new HttpError(409, `${ALUMNI_NO_ACCOUNT_MESSAGE} Unlink the login account first.`);
      }
      const data = {
        name: body.name ?? existing.name,
        initials: body.initials ?? existing.initials,
        role: body.role ?? existing.role,
        department: body.department ?? existing.department,
        bio: body.bio ?? existing.bio,
        photoUrl: body.photoUrl ?? existing.photoUrl,
        scholarUrl: body.scholarUrl ?? existing.scholarUrl,
        researchGateUrl: body.researchGateUrl ?? existing.researchGateUrl,
        orcid: body.orcid ?? existing.orcid,
        category,
        isPublished: mayPlace ? body.isPublished ?? existing.isPublished : existing.isPublished,
        sortOrder: mayPlace ? body.sortOrder ?? existing.sortOrder : existing.sortOrder,
      };
      const row = await tx.teamMember.update({ where: { id: req.params.id }, data });
      // Pointing the photo somewhere else retires an uploaded one (never any file it merely resembles).
      if (body.photoUrl !== undefined && body.photoUrl !== existing.photoUrl) {
        retiredKeys = await retireProfilePhotos(tx, existing.id, managedPhotoFileId(body.photoUrl));
      }
      await applyTranslationOverrides(tx, "TEAM_MEMBER", row.id, body.translations?.ja);
      const changed = changedFields(existing, data, [...AUDITED_FIELDS]);
      if (changed) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "TEAM_MEMBER_UPDATED",
          entityType: "TEAM_MEMBER",
          entityId: row.id,
          details: { name: row.name, changed },
        });
      }
      return row;
    });
    await removeBlobs(retiredKeys, "replaced profile photo");

    res.json(toTeamMember(updated, req.user!));
  }),
);

// POST /api/team/:id/photo -> upload a profile photo from the person's computer (multipart field
// "file"). The profile's own account or a lab manager/admin only — authorization runs BEFORE any
// bytes are read. The new photo is stored and the profile switched to it in one transaction; the
// previous uploaded photo is retired only after that commits, so a failure never loses the photo in use.
router.post(
  "/:id/photo",
  requireOwnerOrManager("id"),
  uploadProfilePhotoFile,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No photo was uploaded (expected multipart field "file").');
    const photo = validateProfilePhoto(req.file);

    const storageKey = await saveFile(photo.buffer);
    try {
      const { member, retiredKeys } = await prisma.$transaction(async (tx) => {
        const existing = await tx.teamMember.findUnique({ where: { id: req.params.id } });
        if (!existing) throw new HttpError(404, "Not found");
        const file = await tx.storedFile.create({
          data: {
            storageKey,
            originalName: `profile-photo.${photo.mimeType === "image/jpeg" ? "jpg" : photo.mimeType === "image/png" ? "png" : "webp"}`,
            mimeType: photo.mimeType,
            sizeBytes: photo.sizeBytes,
            visibility: "PUBLIC",
            ownerId: req.user!.id,
            entityType: PHOTO_ENTITY_TYPE,
            entityId: existing.id,
          },
        });
        const row = await tx.teamMember.update({ where: { id: existing.id }, data: { photoUrl: photoPathFor(file.id) } });
        const keys = await retireProfilePhotos(tx, existing.id, file.id);
        await recordAudit(tx, {
          actor: req.user!,
          action: "TEAM_MEMBER_UPDATED",
          entityType: "TEAM_MEMBER",
          entityId: row.id,
          details: { name: row.name, changed: "photoUrl", photo: "uploaded", ...(req.user!.id === existing.userId ? { own: true } : {}) },
        });
        return { member: row, retiredKeys: keys };
      });
      await removeBlobs(retiredKeys, "replaced profile photo");
      res.status(201).json(toTeamMember(member, req.user!));
    } catch (err) {
      await removeFile(storageKey).catch((cleanupErr) => console.error(`[team] cleanup failed for orphaned photo blob ${storageKey}:`, cleanupErr));
      throw err;
    }
  }),
);

// DELETE /api/team/:id/photo -> remove the profile photo (back to the initials avatar). Same
// authorization as upload. An external photo URL is cleared too; an uploaded file is retired.
router.delete(
  "/:id/photo",
  requireOwnerOrManager("id"),
  asyncHandler(async (req, res) => {
    let retiredKeys: string[] = [];
    const member = await prisma.$transaction(async (tx) => {
      const existing = await tx.teamMember.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");
      const row = await tx.teamMember.update({ where: { id: existing.id }, data: { photoUrl: "" } });
      retiredKeys = await retireProfilePhotos(tx, existing.id);
      if (existing.photoUrl !== "") {
        await recordAudit(tx, {
          actor: req.user!,
          action: "TEAM_MEMBER_UPDATED",
          entityType: "TEAM_MEMBER",
          entityId: row.id,
          details: { name: row.name, changed: "photoUrl", photo: "removed" },
        });
      }
      return row;
    });
    await removeBlobs(retiredKeys, "removed profile photo");
    res.json(toTeamMember(member, req.user!));
  }),
);

// DELETE /api/team/:id -> delete (admin only: it removes a person's profile and history)
router.delete(
  "/:id",
  requireCan(canDeleteTeamMember),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    let retiredKeys: string[] = [];
    await prisma.$transaction(async (tx) => {
      const existing = await tx.teamMember.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");

      retiredKeys = await retireProfilePhotos(tx, existing.id);
      await tx.translation.deleteMany({ where: { entityType: "TEAM_MEMBER", entityId: existing.id } });
      await tx.teamMember.delete({ where: { id: existing.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "TEAM_MEMBER_DELETED",
        entityType: "TEAM_MEMBER",
        entityId: existing.id,
        details: { name: existing.name, category: existing.category, hadAccount: existing.userId !== null },
      });
    });
    await removeBlobs(retiredKeys, "deleted profile photo");
    res.json({ success: true });
  }),
);

export default router;
