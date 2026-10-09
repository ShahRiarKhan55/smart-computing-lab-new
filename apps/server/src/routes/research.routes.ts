import { Router } from "express";
import {
  canDeleteContent,
  canEditContent,
  canLinkResearchersToArea,
  createResearchAreaSchema,
  setAreaResearchersSchema,
  updateResearchAreaSchema,
  type ResearchAreaDetail,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireAuth, requireCan } from "../middleware/auth.js";
import { assertValidId, diffLinks } from "../lib/authorLinks.js";
import { assertPeopleVisibleAndExist, linkedPersonVisible, splitVisible } from "../lib/hiddenPeople.js";
import { assertMayChangeVisibility, visibleTo } from "../lib/visibility.js";
import { asProjectStatus, toResearchArea } from "../lib/serializers.js";
import { loadProjectOutputs, loadRefTranslations, pick } from "../lib/researchGraph.js";
import { changedFields, idList, recordAudit, recordVisibilityChange } from "../lib/audit.js";
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

// GET /api/research/:id -> the area plus its research structure (public; a LAB_ONLY area is a 404 for
// guests). Projects are only those the viewer may see; publications/news/events are those of THOSE
// projects; every list is filtered in its query, so a hidden record is neither shown nor counted.
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const viewer = req.user ?? null;
    const locale = resolveLocale(req);
    const visible = visibleTo(viewer);
    const row = await prisma.researchArea.findFirst({
      where: { id: req.params.id, ...visible },
      include: {
        projectLinks: {
          where: { project: visible },
          include: { project: { select: { id: true, slug: true, title: true, summary: true, status: true, sortOrder: true } } },
        },
        researcherLinks: { where: linkedPersonVisible(viewer), include: { teamMember: { select: { id: true, name: true, initials: true, role: true, sortOrder: true } } } },
      },
    });
    if (!row) throw new HttpError(404, "Not found");

    const projects = row.projectLinks
      .map((l) => l.project)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const [translations, refs, outputs] = await Promise.all([
      loadTranslations(prisma, "RESEARCH_AREA", [row.id], locale),
      loadRefTranslations(locale, { projects: projects.map((p) => p.id) }),
      loadProjectOutputs(projects.map((p) => p.id), viewer, locale),
    ]);

    const detail: ResearchAreaDetail = {
      ...toResearchArea(localize(row, "RESEARCH_AREA", translations), viewer),
      projects: projects.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: pick(refs.project, p.id, "title", p.title),
        summary: pick(refs.project, p.id, "summary", p.summary),
        status: asProjectStatus(p.status),
      })),
      researchers: row.researcherLinks
        .map((l) => l.teamMember)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map((m) => ({ id: m.id, name: m.name, initials: m.initials, role: m.role })),
      ...outputs,
      canEdit: canEditContent(viewer),
      canDelete: canDeleteContent(viewer),
      canManageResearchers: canLinkResearchersToArea(viewer),
    };
    res.json(detail);
  }),
);

// PUT /api/research/:id/researchers { teamMemberIds } -> replace the researchers on this area (managers).
// Touches only the ResearcherArea join rows. A researcher's OWN areas are set from their profile
// (PUT /api/member/:id/areas, owner or manager). Audited with the existing MEMBER_LINKS_CHANGED action.
router.put(
  "/:id/researchers",
  requireCan(canLinkResearchersToArea),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { teamMemberIds } = parseOrThrow(setAreaResearchersSchema, req.body);

    await prisma.$transaction(async (tx) => {
      const area = await tx.researchArea.findUnique({ where: { id: req.params.id }, select: { id: true, title: true } });
      if (!area) throw new HttpError(404, "Not found");
      await assertPeopleVisibleAndExist(tx, req.user!, teamMemberIds);
      const allCurrent = (await tx.researcherArea.findMany({ where: { researchAreaId: area.id }, select: { teamMemberId: true } })).map((c) => c.teamMemberId);
      const current = (await splitVisible(tx, req.user!, allCurrent)).visible;
      const { toAdd, toRemove } = diffLinks(current, teamMemberIds);

      if (toRemove.length > 0) await tx.researcherArea.deleteMany({ where: { researchAreaId: area.id, teamMemberId: { in: toRemove } } });
      if (toAdd.length > 0) await tx.researcherArea.createMany({ data: toAdd.map((teamMemberId) => ({ teamMemberId, researchAreaId: area.id })) });

      if (toAdd.length > 0 || toRemove.length > 0) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "MEMBER_LINKS_CHANGED",
          entityType: "RESEARCH_AREA",
          entityId: area.id,
          details: { kind: "researchers", title: area.title, added: idList(toAdd), removed: idList(toRemove) },
        });
      }
    });

    res.json({ success: true });
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
