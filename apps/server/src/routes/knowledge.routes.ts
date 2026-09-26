import { Router } from "express";
import {
  canCreateKnowledge,
  canDeleteKnowledge,
  canEditKnowledge,
  canFilterKnowledgeByVisibility,
  createKnowledgeSchema,
  knowledgeListQuerySchema,
  updateKnowledgeSchema,
  type KnowledgeListResponse,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireAuth, requireCan } from "../middleware/auth.js";
import { assertValidId } from "../lib/authorLinks.js";
import { assertMayChangeVisibility, canView, visibleTo, type Viewer } from "../lib/visibility.js";
import { changedFields, recordAudit, recordVisibilityChange } from "../lib/audit.js";
import { applyTranslationOverrides, getEntityTranslations, resolveLocale } from "../lib/translations.js";
import { knowledgeInclude, knowledgeOrderBy, knowledgeWhere, serializeKnowledge } from "../lib/knowledge.js";

const router = Router();

const AUDITED_FIELDS = ["title", "body", "category", "projectId", "researchAreaId", "groupId", "teamMemberId", "visibility"] as const;

interface Links {
  projectId?: string | null;
  researchAreaId?: string | null;
  groupId?: string | null;
  teamMemberId?: string | null;
}
type Current = { projectId: string | null; researchAreaId: string | null; groupId: string | null; teamMemberId: string | null };

/**
 * A link may only point at a record that exists AND that the author may see (a project, area or group
 * that is not visible to them is reported exactly like a missing one). A link that is not being changed
 * is not re-checked, so an editor can still save a document whose linked project was later hidden.
 */
async function assertLinks(actor: Viewer, links: Links, current: Current | null) {
  const changed = <K extends keyof Current>(key: K) => links[key] !== undefined && links[key] !== (current?.[key] ?? null) && links[key] !== null;
  if (changed("projectId")) {
    const p = await prisma.researchProject.findUnique({ where: { id: links.projectId! }, select: { visibility: true } });
    if (!p || !canView(actor, p.visibility)) throw new HttpError(400, "Project not found.");
  }
  if (changed("researchAreaId")) {
    const a = await prisma.researchArea.findUnique({ where: { id: links.researchAreaId! }, select: { visibility: true } });
    if (!a || !canView(actor, a.visibility)) throw new HttpError(400, "Research area not found.");
  }
  if (changed("groupId")) {
    const g = await prisma.researchGroup.findUnique({ where: { id: links.groupId! }, select: { visibility: true } });
    if (!g || !canView(actor, g.visibility)) throw new HttpError(400, "Group not found.");
  }
  if (changed("teamMemberId")) {
    const t = await prisma.teamMember.findUnique({ where: { id: links.teamMemberId! }, select: { id: true } });
    if (!t) throw new HttpError(400, "Researcher not found.");
  }
}

// GET /api/knowledge?q=&category=&project=&area=&group=&researcher=&visibility=&mine=&page=&limit= -> one page
// (guests see PUBLIC documents only; `visibility` is a manager filter; `mine` needs a signed-in account)
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const query = parseOrThrow(knowledgeListQuerySchema, req.query);
    if (query.visibility !== undefined && !canFilterKnowledgeByVisibility(viewer)) {
      throw new HttpError(403, "Only lab managers and admins can filter by visibility.");
    }
    if (query.mine && !viewer) throw new HttpError(401, "Not authenticated");
    const where = await knowledgeWhere(query, viewer);
    const [rows, total] = await Promise.all([
      prisma.knowledgeDoc.findMany({ where, include: knowledgeInclude, orderBy: knowledgeOrderBy, skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.knowledgeDoc.count({ where }),
    ]);
    const body: KnowledgeListResponse = {
      items: await serializeKnowledge(rows, viewer, resolveLocale(req)),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
    res.json(body);
  }),
);

// GET /api/knowledge/:id -> one document (a hidden one is a 404, exactly like a missing one)
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const viewer = req.user ?? null;
    const row = await prisma.knowledgeDoc.findFirst({ where: { id: req.params.id, ...visibleTo(viewer) }, include: knowledgeInclude });
    if (!row) throw new HttpError(404, "Not found");
    const [doc] = await serializeKnowledge([row], viewer, resolveLocale(req), true);
    res.json(doc);
  }),
);

// POST /api/knowledge -> create (any logged-in account; visibility is managers-only).
// Without `visibility` the document is LAB_ONLY (the table's default) until a manager publishes it.
router.post(
  "/",
  requireCan(canCreateKnowledge),
  asyncHandler(async (req, res) => {
    const { translations, visibility, category, ...rest } = parseOrThrow(createKnowledgeSchema, req.body);
    const { title, body, ...links } = rest;
    assertMayChangeVisibility(req.user!, visibility);
    await assertLinks(req.user!, links, null);

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.knowledgeDoc.create({
        data: {
          title,
          body,
          category,
          visibility: visibility ?? "LAB_ONLY",
          authorId: req.user!.id,
          projectId: links.projectId ?? null,
          researchAreaId: links.researchAreaId ?? null,
          groupId: links.groupId ?? null,
          teamMemberId: links.teamMemberId ?? null,
        },
      });
      await applyTranslationOverrides(tx, "KNOWLEDGE_DOC", row.id, translations?.ja);
      await recordAudit(tx, {
        actor: req.user!,
        action: "KNOWLEDGE_CREATED",
        entityType: "KNOWLEDGE_DOC",
        entityId: row.id,
        details: { title: row.title, category: row.category, visibility: row.visibility },
      });
      const ja = Object.entries(translations?.ja ?? {}).filter(([, v]) => typeof v === "string" && v.trim() !== "").map(([k]) => k);
      if (ja.length > 0) {
        await recordAudit(tx, { actor: req.user!, action: "TRANSLATIONS_CHANGED", entityType: "KNOWLEDGE_DOC", entityId: row.id, details: { locale: "ja", fields: ja.join(",") } });
      }
      return tx.knowledgeDoc.findUniqueOrThrow({ where: { id: row.id }, include: knowledgeInclude });
    });

    const [doc] = await serializeKnowledge([created], req.user!, resolveLocale(req), true);
    res.status(201).json(doc);
  }),
);

// PUT /api/knowledge/:id -> update (its author, or a manager/admin). The Japanese translation is part of
// this body, so it is authorised exactly like every other field.
router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { translations, visibility, ...rest } = parseOrThrow(updateKnowledgeSchema, req.body);
    const { projectId, researchAreaId, groupId, teamMemberId, ...fields } = rest;
    const links: Links = { projectId, researchAreaId, groupId, teamMemberId };

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.knowledgeDoc.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");
      if (!canEditKnowledge(req.user!, existing.authorId !== null && existing.authorId === req.user!.id)) {
        throw new HttpError(403, "Forbidden");
      }
      assertMayChangeVisibility(req.user!, visibility);
      await assertLinks(req.user!, links, existing);

      const data = {
        ...fields,
        ...(visibility !== undefined ? { visibility } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
        ...(researchAreaId !== undefined ? { researchAreaId } : {}),
        ...(groupId !== undefined ? { groupId } : {}),
        ...(teamMemberId !== undefined ? { teamMemberId } : {}),
      };
      const before = translations?.ja ? await getEntityTranslations(tx, "KNOWLEDGE_DOC", existing.id) : null;
      const row = await tx.knowledgeDoc.update({ where: { id: existing.id }, data });
      await applyTranslationOverrides(tx, "KNOWLEDGE_DOC", row.id, translations?.ja);

      const changed = changedFields(existing as Record<string, unknown>, data as Record<string, unknown>, [...AUDITED_FIELDS]);
      if (changed) {
        await recordAudit(tx, { actor: req.user!, action: "KNOWLEDGE_UPDATED", entityType: "KNOWLEDGE_DOC", entityId: row.id, details: { title: row.title, changed } });
      }
      await recordVisibilityChange(tx, req.user!, "KNOWLEDGE_DOC", row.id, existing.visibility, visibility);
      if (before) {
        const after = await getEntityTranslations(tx, "KNOWLEDGE_DOC", row.id);
        const fieldsChanged = Object.keys(after).filter((f) => after[f] !== before[f]);
        if (fieldsChanged.length > 0) {
          await recordAudit(tx, { actor: req.user!, action: "TRANSLATIONS_CHANGED", entityType: "KNOWLEDGE_DOC", entityId: row.id, details: { locale: "ja", fields: fieldsChanged.join(",") } });
        }
      }
      return tx.knowledgeDoc.findUniqueOrThrow({ where: { id: row.id }, include: knowledgeInclude });
    });

    const [doc] = await serializeKnowledge([updated], req.user!, resolveLocale(req), true);
    res.json(doc);
  }),
);

// DELETE /api/knowledge/:id -> delete (its author, or a manager/admin). Translations are removed here;
// nothing else points at a document.
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.knowledgeDoc.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");
      if (!canDeleteKnowledge(req.user!, existing.authorId !== null && existing.authorId === req.user!.id)) {
        throw new HttpError(403, "Forbidden");
      }
      await tx.translation.deleteMany({ where: { entityType: "KNOWLEDGE_DOC", entityId: existing.id } });
      await tx.knowledgeDoc.delete({ where: { id: existing.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "KNOWLEDGE_DELETED",
        entityType: "KNOWLEDGE_DOC",
        entityId: existing.id,
        details: { title: existing.title, category: existing.category, visibility: existing.visibility },
      });
    });
    res.json({ success: true });
  }),
);

export default router;
