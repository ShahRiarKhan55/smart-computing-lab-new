import { Router } from "express";
import {
  asResourceType,
  canCreateResource,
  canDeleteResource,
  canEditResource,
  canFilterResourcesByVisibility,
  createResourceSchema,
  parseResourceMetadata,
  RESOURCE_PROJECTS_MAX,
  resourceListQuerySchema,
  resourceMetadataError,
  updateResourceSchema,
  type ResourceListResponse,
  type ResourceType,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireAuth, requireCan } from "../middleware/auth.js";
import { assertValidId } from "../lib/authorLinks.js";
import { assertMayChangeVisibility, canView, visibleTo, type Viewer } from "../lib/visibility.js";
import { changedFields, recordAudit, recordVisibilityChange } from "../lib/audit.js";
import { applyTranslationOverrides, getEntityTranslations, resolveLocale } from "../lib/translations.js";
import { detailInclude, listInclude, metadataToStored, resourceOrderBy, resourceWhere, serializeResources } from "../lib/resources.js";

const router = Router();

const AUDITED_FIELDS = [
  "name",
  "resourceType",
  "description",
  "version",
  "vendor",
  "identifier",
  "url",
  "environment",
  "metadata",
  "researchAreaId",
  "groupId",
  "knowledgeDocId",
  "publicationId",
  "eventId",
  "teamMemberId",
  "visibility",
] as const;

type SingleLinks = {
  researchAreaId?: string | null;
  groupId?: string | null;
  knowledgeDocId?: string | null;
  publicationId?: string | null;
  eventId?: string | null;
  teamMemberId?: string | null;
};
type CurrentLinks = { [K in keyof SingleLinks]-?: string | null };

/**
 * A link may only point at a record that exists AND that the editor may see (one they cannot see is reported
 * exactly like a missing one). A link that is not being changed is not re-checked, so an editor can still save
 * a resource whose linked record was later hidden. `projectIds` is checked only for projects NEWLY added.
 */
async function assertLinks(actor: Viewer, links: SingleLinks, current: CurrentLinks | null, addedProjectIds: string[]) {
  const changed = (key: keyof SingleLinks) => links[key] !== undefined && links[key] !== null && links[key] !== (current?.[key] ?? null);
  if (changed("researchAreaId")) {
    const a = await prisma.researchArea.findUnique({ where: { id: links.researchAreaId! }, select: { visibility: true } });
    if (!a || !canView(actor, a.visibility)) throw new HttpError(400, "Research area not found.");
  }
  if (changed("groupId")) {
    const g = await prisma.researchGroup.findUnique({ where: { id: links.groupId! }, select: { visibility: true } });
    if (!g || !canView(actor, g.visibility)) throw new HttpError(400, "Group not found.");
  }
  if (changed("knowledgeDocId")) {
    const d = await prisma.knowledgeDoc.findUnique({ where: { id: links.knowledgeDocId! }, select: { visibility: true } });
    if (!d || !canView(actor, d.visibility)) throw new HttpError(400, "Document not found.");
  }
  if (changed("publicationId")) {
    const p = await prisma.publication.findUnique({ where: { id: links.publicationId! }, select: { visibility: true } });
    if (!p || !canView(actor, p.visibility)) throw new HttpError(400, "Publication not found.");
  }
  if (changed("eventId")) {
    const e = await prisma.event.findUnique({ where: { id: links.eventId! }, select: { visibility: true } });
    if (!e || !canView(actor, e.visibility)) throw new HttpError(400, "Event not found.");
  }
  if (changed("teamMemberId")) {
    const t = await prisma.teamMember.findUnique({ where: { id: links.teamMemberId! }, select: { id: true } });
    if (!t) throw new HttpError(400, "Researcher not found.");
  }
  if (addedProjectIds.length > 0) {
    const found = await prisma.researchProject.findMany({ where: { id: { in: addedProjectIds } }, select: { visibility: true } });
    if (found.length !== addedProjectIds.length || found.some((p) => !canView(actor, p.visibility))) throw new HttpError(400, "Project not found.");
  }
}

// GET /api/resources?q=&type=&project=&area=&group=&researcher=&knowledge=&publication=&visibility=&mine=&page=&limit= -> one page
// (guests see PUBLIC resources only; `visibility` is a manager filter; `mine` needs a signed-in account)
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const query = parseOrThrow(resourceListQuerySchema, req.query);
    if (query.visibility !== undefined && !canFilterResourcesByVisibility(viewer)) {
      throw new HttpError(403, "Only lab managers and admins can filter by visibility.");
    }
    if (query.mine && !viewer) throw new HttpError(401, "Not authenticated");
    const where = await resourceWhere(query, viewer);
    const [rows, total] = await Promise.all([
      prisma.labResource.findMany({ where, include: listInclude(viewer), orderBy: resourceOrderBy, skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.labResource.count({ where }),
    ]);
    const body: ResourceListResponse = {
      items: await serializeResources(rows, viewer, resolveLocale(req)),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
    res.json(body);
  }),
);

// GET /api/resources/:id -> one resource (a hidden one is a 404, exactly like a missing one)
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const viewer = req.user ?? null;
    const row = await prisma.labResource.findFirst({ where: { id: req.params.id, ...visibleTo(viewer) }, include: detailInclude(viewer) });
    if (!row) throw new HttpError(404, "Not found");
    const [resource] = await serializeResources([row], viewer, resolveLocale(req), true);
    res.json(resource);
  }),
);

// POST /api/resources -> create (any logged-in account; visibility is managers-only).
// Without `visibility` the resource is LAB_ONLY (the table's default) until a manager publishes it.
router.post(
  "/",
  requireCan(canCreateResource),
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(createResourceSchema, req.body);
    const { translations, visibility, metadata, projectIds, ...rest } = input;
    const { name, resourceType, description, version, vendor, identifier, url, environment, ...links } = rest;
    assertMayChangeVisibility(req.user!, visibility);
    await assertLinks(req.user!, links, null, projectIds ?? []);

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.labResource.create({
        data: {
          name,
          resourceType,
          description,
          version,
          vendor,
          identifier,
          url,
          environment,
          metadata: metadataToStored(resourceType, metadata ?? {}),
          visibility: visibility ?? "LAB_ONLY",
          ownerId: req.user!.id,
          researchAreaId: links.researchAreaId ?? null,
          groupId: links.groupId ?? null,
          knowledgeDocId: links.knowledgeDocId ?? null,
          publicationId: links.publicationId ?? null,
          eventId: links.eventId ?? null,
          teamMemberId: links.teamMemberId ?? null,
          projectLinks: { create: (projectIds ?? []).map((projectId) => ({ projectId })) },
        },
      });
      await applyTranslationOverrides(tx, "LAB_RESOURCE", row.id, translations?.ja);
      await recordAudit(tx, {
        actor: req.user!,
        action: "RESOURCE_CREATED",
        entityType: "LAB_RESOURCE",
        entityId: row.id,
        details: { name: row.name, resourceType: row.resourceType, visibility: row.visibility, projects: (projectIds ?? []).length },
      });
      const ja = Object.entries(translations?.ja ?? {}).filter(([, v]) => typeof v === "string" && v.trim() !== "").map(([k]) => k);
      if (ja.length > 0) {
        await recordAudit(tx, { actor: req.user!, action: "TRANSLATIONS_CHANGED", entityType: "LAB_RESOURCE", entityId: row.id, details: { locale: "ja", fields: ja.join(",") } });
      }
      return tx.labResource.findUniqueOrThrow({ where: { id: row.id }, include: detailInclude(req.user!) });
    });

    const [resource] = await serializeResources([created], req.user!, resolveLocale(req), true);
    res.status(201).json(resource);
  }),
);

// PUT /api/resources/:id -> update (its owner, or a manager/admin). The Japanese translation is part of this
// body, so it is authorised exactly like every other field. `projectIds`, when sent, is the COMPLETE project set.
router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { translations, visibility, metadata, projectIds, ...rest } = parseOrThrow(updateResourceSchema, req.body);
    const { researchAreaId, groupId, knowledgeDocId, publicationId, eventId, teamMemberId, ...fields } = rest;
    const links: SingleLinks = { researchAreaId, groupId, knowledgeDocId, publicationId, eventId, teamMemberId };

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.labResource.findUnique({
        where: { id: req.params.id },
        include: { projectLinks: { select: { projectId: true, project: { select: { visibility: true } } } } },
      });
      if (!existing) throw new HttpError(404, "Not found");
      if (!canEditResource(req.user!, existing.ownerId !== null && existing.ownerId === req.user!.id)) {
        throw new HttpError(403, "Forbidden");
      }
      assertMayChangeVisibility(req.user!, visibility);

      // Metadata must fit the (possibly new) type. Changing the type without restating metadata is only allowed when the
      // stored metadata still fits, so a type change can never silently drop or mislabel what was recorded.
      const oldType = asResourceType(existing.resourceType);
      const type: ResourceType = fields.resourceType ?? oldType;
      if (metadata !== undefined) {
        const err = resourceMetadataError(type, metadata);
        if (err) throw new HttpError(400, err);
      } else if (type !== oldType) {
        const err = resourceMetadataError(type, parseResourceMetadata(existing.metadata, oldType) as Record<string, string>);
        if (err) throw new HttpError(400, `${err} Send metadata together with the new type.`);
      }

      const currentIds = existing.projectLinks.map((l) => l.projectId);
      // Projects this editor cannot see stay linked (they could not have listed them, so they cannot have removed them).
      const hiddenKept = existing.projectLinks.filter((l) => !canView(req.user!, l.project.visibility)).map((l) => l.projectId);
      // The detail response lists at most RESOURCE_PROJECTS_MAX visible projects (and a submitted set is capped at the same
      // number), so with more visible links than that the client cannot have seen, nor can it resend, the whole set:
      // omitted links would read as removals. Refuse rather than delete relationships the editor never saw.
      if (projectIds !== undefined && existing.projectLinks.length - hiddenKept.length > RESOURCE_PROJECTS_MAX) {
        throw new HttpError(400, `This resource has more than ${RESOURCE_PROJECTS_MAX} linked projects, so its project links cannot be edited here; they were left unchanged.`);
      }
      const nextIds = projectIds === undefined ? currentIds : [...projectIds, ...hiddenKept.filter((id) => !projectIds.includes(id))];
      const addedIds = nextIds.filter((id) => !currentIds.includes(id));
      const removedIds = currentIds.filter((id) => !nextIds.includes(id));
      await assertLinks(req.user!, links, existing, addedIds);

      const data = {
        ...fields,
        ...(metadata !== undefined ? { metadata: metadataToStored(type, metadata) } : {}),
        ...(visibility !== undefined ? { visibility } : {}),
        ...(researchAreaId !== undefined ? { researchAreaId } : {}),
        ...(groupId !== undefined ? { groupId } : {}),
        ...(knowledgeDocId !== undefined ? { knowledgeDocId } : {}),
        ...(publicationId !== undefined ? { publicationId } : {}),
        ...(eventId !== undefined ? { eventId } : {}),
        ...(teamMemberId !== undefined ? { teamMemberId } : {}),
      };
      const before = translations?.ja ? await getEntityTranslations(tx, "LAB_RESOURCE", existing.id) : null;
      const row = await tx.labResource.update({ where: { id: existing.id }, data });
      if (removedIds.length > 0) await tx.resourceProject.deleteMany({ where: { resourceId: row.id, projectId: { in: removedIds } } });
      if (addedIds.length > 0) await tx.resourceProject.createMany({ data: addedIds.map((projectId) => ({ resourceId: row.id, projectId })) });
      await applyTranslationOverrides(tx, "LAB_RESOURCE", row.id, translations?.ja);

      const changedList = changedFields(existing as unknown as Record<string, unknown>, data as Record<string, unknown>, [...AUDITED_FIELDS]);
      const changed = [...(changedList ? changedList.split(",") : []), ...(addedIds.length + removedIds.length > 0 ? ["projectIds"] : [])].join(",");
      if (changed) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "RESOURCE_UPDATED",
          entityType: "LAB_RESOURCE",
          entityId: row.id,
          details: { name: row.name, resourceType: row.resourceType, changed },
        });
      }
      await recordVisibilityChange(tx, req.user!, "LAB_RESOURCE", row.id, existing.visibility, visibility);
      if (before) {
        const after = await getEntityTranslations(tx, "LAB_RESOURCE", row.id);
        const fieldsChanged = Object.keys(after).filter((f) => after[f] !== before[f]);
        if (fieldsChanged.length > 0) {
          await recordAudit(tx, { actor: req.user!, action: "TRANSLATIONS_CHANGED", entityType: "LAB_RESOURCE", entityId: row.id, details: { locale: "ja", fields: fieldsChanged.join(",") } });
        }
      }
      return tx.labResource.findUniqueOrThrow({ where: { id: row.id }, include: detailInclude(req.user!) });
    });

    const [resource] = await serializeResources([updated], req.user!, resolveLocale(req), true);
    res.json(resource);
  }),
);

// DELETE /api/resources/:id -> delete (its owner, or a manager/admin). Project links cascade; translations are removed here.
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.labResource.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");
      if (!canDeleteResource(req.user!, existing.ownerId !== null && existing.ownerId === req.user!.id)) {
        throw new HttpError(403, "Forbidden");
      }
      await tx.translation.deleteMany({ where: { entityType: "LAB_RESOURCE", entityId: existing.id } });
      await tx.labResource.delete({ where: { id: existing.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "RESOURCE_DELETED",
        entityType: "LAB_RESOURCE",
        entityId: existing.id,
        details: { name: existing.name, resourceType: existing.resourceType, visibility: existing.visibility },
      });
    });
    res.json({ success: true });
  }),
);

export default router;
