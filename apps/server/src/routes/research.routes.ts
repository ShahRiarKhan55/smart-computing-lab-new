import { Router } from "express";
import { canDeleteContent, createResearchAreaSchema, updateResearchAreaSchema } from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireAuth, requireCan } from "../middleware/auth.js";
import { assertValidId } from "../lib/authorLinks.js";
import { assertMayChangeVisibility, visibleTo } from "../lib/visibility.js";
import { toResearchArea } from "../lib/serializers.js";
import { changedFields, recordAudit, recordVisibilityChange } from "../lib/audit.js";
import { applyTranslationOverrides, loadTranslations, localize, resolveLocale } from "../lib/translations.js";

const router = Router();

const AUDITED_FIELDS = ["icon", "title", "description", "tag", "sortOrder", "visibility"] as const;

// GET /api/research -> list (public; LAB_ONLY areas are hidden from guests)
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const locale = resolveLocale(req);
    const rows = await prisma.researchArea.findMany({
      where: visibleTo(req.user ?? null),
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const translations = await loadTranslations(prisma, "RESEARCH_AREA", rows.map((r) => r.id), locale);
    res.json(rows.map((r) => toResearchArea(localize(r, "RESEARCH_AREA", translations), req.user ?? null)));
  }),
);

// GET /api/research/:id -> single (public; a LAB_ONLY area is a 404 for guests)
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const row = await prisma.researchArea.findFirst({ where: { id: req.params.id, ...visibleTo(req.user ?? null) } });
    if (!row) throw new HttpError(404, "Not found");
    const translations = await loadTranslations(prisma, "RESEARCH_AREA", [row.id], resolveLocale(req));
    res.json(toResearchArea(localize(row, "RESEARCH_AREA", translations), req.user ?? null));
  }),
);

// POST /api/research -> create (any logged-in user, like the reference; `visibility` is managers-only)
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { translations, ...data } = parseOrThrow(createResearchAreaSchema, req.body);
    assertMayChangeVisibility(req.user!, data.visibility);

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.researchArea.create({ data });
      await applyTranslationOverrides(tx, "RESEARCH_AREA", row.id, translations?.ja);
      await recordAudit(tx, {
        actor: req.user!,
        action: "RESEARCH_CREATED",
        entityType: "RESEARCH_AREA",
        entityId: row.id,
        details: { title: row.title, visibility: row.visibility },
      });
      return row;
    });
    res.status(201).json(toResearchArea(created, req.user!));
  }),
);

// PUT /api/research/:id -> update (any logged-in user, like the reference; `visibility` is managers-only)
router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { translations, ...data } = parseOrThrow(updateResearchAreaSchema, req.body);
    assertMayChangeVisibility(req.user!, data.visibility);

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.researchArea.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");

      const row = await tx.researchArea.update({ where: { id: existing.id }, data });
      await applyTranslationOverrides(tx, "RESEARCH_AREA", row.id, translations?.ja);
      const changed = changedFields(existing, data, [...AUDITED_FIELDS]);
      if (changed) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "RESEARCH_UPDATED",
          entityType: "RESEARCH_AREA",
          entityId: row.id,
          details: { title: row.title, changed },
        });
      }
      await recordVisibilityChange(tx, req.user!, "RESEARCH_AREA", row.id, existing.visibility, data.visibility);
      return row;
    });
    res.json(toResearchArea(updated, req.user!));
  }),
);

// DELETE /api/research/:id -> delete (lab manager or admin)
router.delete(
  "/:id",
  requireCan(canDeleteContent),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.researchArea.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");

      await tx.translation.deleteMany({ where: { entityType: "RESEARCH_AREA", entityId: existing.id } });
      await tx.researchArea.delete({ where: { id: existing.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "RESEARCH_DELETED",
        entityType: "RESEARCH_AREA",
        entityId: existing.id,
        details: { title: existing.title, visibility: existing.visibility },
      });
    });
    res.json({ success: true });
  }),
);

export default router;
