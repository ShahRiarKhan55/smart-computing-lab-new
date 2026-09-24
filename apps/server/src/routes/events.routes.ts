import { Router } from "express";
import {
  canCreateEvent,
  canDeleteEvent,
  canEditEvent,
  canLinkEventToProject,
  createEventSchema,
  eventListQuerySchema,
  eventRangeInvalid,
  updateEventSchema,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireAuth, requireCan } from "../middleware/auth.js";
import { assertValidId } from "../lib/authorLinks.js";
import { assertMayChangeVisibility, visibleTo } from "../lib/visibility.js";
import { changedFields, recordAudit, recordVisibilityChange } from "../lib/audit.js";
import { applyTranslationOverrides, getEntityTranslations, resolveLocale } from "../lib/translations.js";
import { eventInclude, eventOrderBy, eventScopeWhere, normalizeEventTimes, serializeEvents } from "../lib/eventSerializers.js";

const router = Router();

const AUDITED_FIELDS = ["title", "description", "location", "url", "kind", "startsAt", "endsAt", "allDay", "projectId", "visibility"] as const;

/** Only managers link an event to a project, and the project must exist (400 otherwise). */
async function assertMayLinkProject(actor: Express.Request["user"], projectId: string | null | undefined, current: string | null) {
  if (projectId === undefined || projectId === current) return;
  if (!canLinkEventToProject(actor!)) throw new HttpError(403, "Only lab managers and admins can link an event to a project.");
  if (projectId === null) return;
  const project = await prisma.researchProject.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new HttpError(400, "Project not found.");
}

// GET /api/events?scope=upcoming|past|all&limit=&page= -> list (public events for guests; LAB_ONLY hidden from them)
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { scope, limit, page } = parseOrThrow(eventListQuerySchema, req.query);
    const rows = await prisma.event.findMany({
      where: { ...visibleTo(req.user ?? null), ...eventScopeWhere(scope, new Date()) },
      include: eventInclude,
      orderBy: eventOrderBy(scope),
      skip: (page - 1) * limit,
      take: limit,
    });
    res.json(await serializeEvents(rows, req.user ?? null, resolveLocale(req)));
  }),
);

// GET /api/events/:id -> one event (a hidden one is a 404, exactly like a missing one)
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const row = await prisma.event.findFirst({ where: { id: req.params.id, ...visibleTo(req.user ?? null) }, include: eventInclude });
    if (!row) throw new HttpError(404, "Not found");
    const [event] = await serializeEvents([row], req.user ?? null, resolveLocale(req));
    res.json(event);
  }),
);

// POST /api/events -> create (any logged-in account; visibility and project link are managers-only).
// Without `visibility` the event is LAB_ONLY (the table's default) until a manager publishes it.
router.post(
  "/",
  requireCan(canCreateEvent),
  asyncHandler(async (req, res) => {
    const { translations, visibility, projectId, ...rest } = parseOrThrow(createEventSchema, req.body);
    assertMayChangeVisibility(req.user!, visibility);
    await assertMayLinkProject(req.user!, projectId, null);
    const times = normalizeEventTimes({ startsAt: new Date(rest.startsAt), endsAt: rest.endsAt ? new Date(rest.endsAt) : null, allDay: rest.allDay });

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.event.create({
        data: { ...rest, ...times, visibility: visibility ?? "LAB_ONLY", projectId: projectId ?? null, createdById: req.user!.id },
      });
      await applyTranslationOverrides(tx, "EVENT", row.id, translations?.ja);
      await recordAudit(tx, {
        actor: req.user!,
        action: "EVENT_CREATED",
        entityType: "EVENT",
        entityId: row.id,
        details: { title: row.title, kind: row.kind, visibility: row.visibility },
      });
      const ja = Object.entries(translations?.ja ?? {}).filter(([, v]) => typeof v === "string" && v.trim() !== "").map(([k]) => k);
      if (ja.length > 0) {
        await recordAudit(tx, { actor: req.user!, action: "EVENT_TRANSLATIONS_CHANGED", entityType: "EVENT", entityId: row.id, details: { locale: "ja", fields: ja.join(",") } });
      }
      return tx.event.findUniqueOrThrow({ where: { id: row.id }, include: eventInclude });
    });

    const [event] = await serializeEvents([created], req.user!, resolveLocale(req));
    res.status(201).json(event);
  }),
);

// PUT /api/events/:id -> update (its creator, or a manager/admin). The Japanese translation is part of
// this body, so it is authorised exactly like every other field.
router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { translations, visibility, projectId, ...rest } = parseOrThrow(updateEventSchema, req.body);

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.event.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");
      if (!canEditEvent(req.user!, existing.createdById !== null && existing.createdById === req.user!.id)) {
        throw new HttpError(403, "Forbidden");
      }
      assertMayChangeVisibility(req.user!, visibility);
      await assertMayLinkProject(req.user!, projectId, existing.projectId);

      // The stored range after this update must still be valid (start and end may arrive separately).
      const merged = {
        startsAt: rest.startsAt ? new Date(rest.startsAt) : existing.startsAt,
        endsAt: rest.endsAt === undefined ? existing.endsAt : rest.endsAt ? new Date(rest.endsAt) : null,
        allDay: rest.allDay ?? existing.allDay,
      };
      const times = normalizeEventTimes(merged);
      if (eventRangeInvalid(times.startsAt, times.endsAt)) throw new HttpError(400, "End can't be before the start.");

      const { startsAt: _s, endsAt: _e, allDay: _a, ...fields } = rest;
      const data = { ...fields, ...times, ...(visibility !== undefined ? { visibility } : {}), ...(projectId !== undefined ? { projectId } : {}) };
      const before = translations?.ja ? await getEntityTranslations(tx, "EVENT", existing.id) : null;
      const row = await tx.event.update({ where: { id: existing.id }, data });
      await applyTranslationOverrides(tx, "EVENT", row.id, translations?.ja);

      const changed = changedFields(
        { ...existing, startsAt: existing.startsAt.getTime(), endsAt: existing.endsAt?.getTime() ?? null } as Record<string, unknown>,
        { ...data, startsAt: data.startsAt.getTime(), endsAt: data.endsAt?.getTime() ?? null } as Record<string, unknown>,
        [...AUDITED_FIELDS],
      );
      if (changed) {
        await recordAudit(tx, { actor: req.user!, action: "EVENT_UPDATED", entityType: "EVENT", entityId: row.id, details: { title: row.title, changed } });
      }
      await recordVisibilityChange(tx, req.user!, "EVENT", row.id, existing.visibility, visibility);
      if (before) {
        const after = await getEntityTranslations(tx, "EVENT", row.id);
        const fieldsChanged = Object.keys(after).filter((f) => after[f] !== before[f]);
        if (fieldsChanged.length > 0) {
          await recordAudit(tx, { actor: req.user!, action: "EVENT_TRANSLATIONS_CHANGED", entityType: "EVENT", entityId: row.id, details: { locale: "ja", fields: fieldsChanged.join(",") } });
        }
      }
      return tx.event.findUniqueOrThrow({ where: { id: row.id }, include: eventInclude });
    });

    const [event] = await serializeEvents([updated], req.user!, resolveLocale(req));
    res.json(event);
  }),
);

// DELETE /api/events/:id -> delete (its creator, or a manager/admin).
// Gallery links and the project link are cleared by ON DELETE SET NULL; translations are removed here.
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.event.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");
      if (!canDeleteEvent(req.user!, existing.createdById !== null && existing.createdById === req.user!.id)) {
        throw new HttpError(403, "Forbidden");
      }
      await tx.translation.deleteMany({ where: { entityType: "EVENT", entityId: existing.id } });
      await tx.event.delete({ where: { id: existing.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "EVENT_DELETED",
        entityType: "EVENT",
        entityId: existing.id,
        details: { title: existing.title, visibility: existing.visibility },
      });
    });
    res.json({ success: true });
  }),
);

export default router;
