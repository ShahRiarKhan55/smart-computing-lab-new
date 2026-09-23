import { Router } from "express";
import {
  CATEGORY_ORDER,
  canCreateTeamMember,
  canDeleteTeamMember,
  canManageTeamPlacement,
  createTeamMemberSchema,
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

const router = Router();

const AUDITED_FIELDS = ["name", "initials", "role", "category", "department", "bio", "photoUrl", "sortOrder"] as const;

// GET /api/team -> list all team members, grouped by category order (public).
// `isOwn` is computed per viewer; the account id is never returned.
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const locale = resolveLocale(req);
    const rows = await prisma.teamMember.findMany({
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

// GET /api/team/:id -> single member (public)
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const row = await prisma.teamMember.findUnique({ where: { id: req.params.id } });
    if (!row) throw new HttpError(404, "Not found");
    const translations = await loadTranslations(prisma, "TEAM_MEMBER", [row.id], resolveLocale(req));
    res.json(toTeamMember(localize(row, "TEAM_MEMBER", translations), req.user ?? null));
  }),
);

// POST /api/team -> create (lab manager or admin)
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

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.teamMember.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");

      // Only managers change category or sort order; for anyone else those two
      // fields are ignored, so editing your own profile can never move you.
      const data = {
        name: body.name ?? existing.name,
        initials: body.initials ?? existing.initials,
        role: body.role ?? existing.role,
        department: body.department ?? existing.department,
        bio: body.bio ?? existing.bio,
        photoUrl: body.photoUrl ?? existing.photoUrl,
        category: mayPlace ? body.category ?? existing.category : existing.category,
        sortOrder: mayPlace ? body.sortOrder ?? existing.sortOrder : existing.sortOrder,
      };
      const row = await tx.teamMember.update({ where: { id: req.params.id }, data });
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

    res.json(toTeamMember(updated, req.user!));
  }),
);

// DELETE /api/team/:id -> delete (admin only: it removes a person's profile and history)
router.delete(
  "/:id",
  requireCan(canDeleteTeamMember),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.teamMember.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");

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
    res.json({ success: true });
  }),
);

export default router;
