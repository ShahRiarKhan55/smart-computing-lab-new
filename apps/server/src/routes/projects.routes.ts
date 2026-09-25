import { Router } from "express";
import type { Prisma } from "@prisma/client";
import {
  PROJECT_MANAGER_ONLY_KEYS,
  canCreateProject,
  canDeleteProject,
  canEditProject,
  canManageProjectSettings,
  createProjectSchema,
  endsBeforeStart,
  setProjectAreasSchema,
  setProjectMembersSchema,
  setProjectNewsSchema,
  setProjectPublicationsSchema,
  updateProjectSchema,
  type ProjectDetail,
  type ProjectSummary,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireCan, requireEditor } from "../middleware/auth.js";
import { assertValidId, diffLinks } from "../lib/authorLinks.js";
import { canView, visibilityField, visibleTo, type Viewer } from "../lib/visibility.js";
import {
  asProjectRole,
  asProjectStatus,
  fromIsoDate,
  sortMembersLeadFirst,
  toAreaRef,
  toIsoDate,
} from "../lib/serializers.js";
import { slugify, uniqueSlug } from "../lib/slug.js";
import { changedFields, idList, recordAudit, recordVisibilityChange } from "../lib/audit.js";
import { applyTranslationOverrides, loadTranslations, localize, resolveLocale } from "../lib/translations.js";
import { localizedNews, localizedPublications, loadRefTranslations, pick, type RefTranslations } from "../lib/researchGraph.js";
import { eventInclude, eventOrderBy, serializeEvents } from "../lib/eventSerializers.js";
import type { Locale } from "@scl/shared";

const router = Router();

const AUDITED_FIELDS = ["title", "summary", "description", "status", "startDate", "endDate", "visibility", "slug", "sortOrder", "groupId"] as const;

// ---------------------------------------------------------------------------
// Reading. Everything nested is filtered by the viewer's visibility in the query
// itself, and a group the viewer cannot see is reported as `group: null` (its id is
// never sent), so a public project cannot be used to discover a LAB_ONLY group,
// publication, news item or research area.
// ---------------------------------------------------------------------------
function summaryInclude(viewer: Viewer) {
  return {
    group: { select: { id: true, slug: true, name: true, visibility: true } },
    areaLinks: {
      where: { researchArea: visibleTo(viewer) },
      include: { researchArea: { select: { id: true, icon: true, title: true, tag: true, sortOrder: true } } },
    },
    members: { include: { teamMember: { select: { id: true, name: true, initials: true, userId: true } } } },
  } satisfies Prisma.ResearchProjectInclude;
}

interface SummaryRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  sortOrder: number;
  visibility: string;
  group: { id: string; slug: string; name: string; visibility: string } | null;
  areaLinks: { researchArea: { id: string; icon: string; title: string; tag: string; sortOrder: number } }[];
  members: { role: string; teamMember: { id: string; name: string; initials: string; userId: string | null } }[];
}

function toSummary(row: SummaryRow, viewer: Viewer, refs?: RefTranslations): ProjectSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    status: asProjectStatus(row.status),
    startDate: toIsoDate(row.startDate),
    endDate: toIsoDate(row.endDate),
    sortOrder: row.sortOrder,
    ...visibilityField(viewer, row.visibility),
    group:
      row.group && canView(viewer, row.group.visibility)
        ? { id: row.group.id, slug: row.group.slug, name: refs ? pick(refs.group, row.group.id, "name", row.group.name) : row.group.name }
        : null,
    areas: row.areaLinks
      .map((l) => l.researchArea)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
      .map((a) => toAreaRef(refs ? { ...a, title: pick(refs.area, a.id, "title", a.title) } : a)),
    members: sortMembersLeadFirst(
      row.members.map((m) => ({ teamMemberId: m.teamMember.id, name: m.teamMember.name, initials: m.teamMember.initials, role: asProjectRole(m.role) })),
    ),
  };
}

async function loadDetail(id: string, viewer: Viewer, locale: Locale = "en"): Promise<ProjectDetail | null> {
  const visible = visibleTo(viewer);
  const row = await prisma.researchProject.findFirst({
    where: { id, ...visible },
    include: {
      ...summaryInclude(viewer),
      publications: { where: { publication: visible }, include: { publication: true } },
      news: { where: visible, orderBy: [{ sortDate: "desc" }, { id: "asc" }] },
    },
  });
  if (!row) return null;

  const [translations, refs, events, news] = await Promise.all([
    loadTranslations(prisma, "RESEARCH_PROJECT", [row.id], locale),
    loadRefTranslations(locale, { areas: row.areaLinks.map((l) => l.researchArea.id), groups: row.group ? [row.group.id] : [] }),
    // Linked events are read here, in the same visibility fragment as everything else on this page.
    prisma.event.findMany({ where: { projectId: row.id, ...visible }, include: eventInclude, orderBy: eventOrderBy("all") }),
    localizedNews(row.news, viewer, locale),
  ]);
  const localized = localize(row, "RESEARCH_PROJECT", translations);

  const isLead = viewer !== null && row.members.some((m) => m.role === "LEAD" && m.teamMember.userId === viewer.id);
  return {
    ...toSummary(localized, viewer, refs),
    description: localized.description,
    publications: await localizedPublications(
      row.publications.map((l) => l.publication).sort((a, b) => b.year - a.year || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id)),
      viewer,
      locale,
    ),
    news,
    events: await serializeEvents(events, viewer, locale),
    canEdit: canEditProject(viewer, isLead),
  };
}

// GET /api/projects -> list (public; LAB_ONLY projects are hidden from guests)
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const locale = resolveLocale(req);
    const rows = await prisma.researchProject.findMany({
      where: visibleTo(viewer),
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      include: summaryInclude(viewer),
    });
    const [translations, refs] = await Promise.all([
      loadTranslations(prisma, "RESEARCH_PROJECT", rows.map((r) => r.id), locale),
      loadRefTranslations(locale, { areas: rows.flatMap((r) => r.areaLinks.map((l) => l.researchArea.id)), groups: rows.flatMap((r) => (r.group ? [r.group.id] : [])) }),
    ]);
    res.json(rows.map((r) => toSummary(localize(r, "RESEARCH_PROJECT", translations), viewer, refs)));
  }),
);

// GET /api/projects/:id -> single (public; a LAB_ONLY project is a 404 for guests)
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const detail = await loadDetail(req.params.id, req.user ?? null, resolveLocale(req));
    if (!detail) throw new HttpError(404, "Not found");
    res.json(detail);
  }),
);

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
const isProjectLead = async (projectId: string, userId: string) =>
  (await prisma.projectMember.count({ where: { projectId, role: "LEAD", teamMember: { userId } } })) > 0;

/** Lab manager/admin, or a LEAD of this project. */
const requireProjectEditor = requireEditor(canEditProject, isProjectLead);

async function assertGroupExists(tx: Prisma.TransactionClient, groupId: string | null | undefined) {
  if (!groupId) return;
  const group = await tx.researchGroup.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) throw new HttpError(400, "Selected group does not exist.");
}

async function assertSlugFree(tx: Prisma.TransactionClient, slug: string, exceptId?: string) {
  const taken = await tx.researchProject.findUnique({ where: { slug }, select: { id: true } });
  if (taken && taken.id !== exceptId) throw new HttpError(409, "That slug is already in use.");
}

// POST /api/projects -> create (lab manager or admin). New projects are LAB_ONLY unless a visibility is given.
router.post(
  "/",
  requireCan(canCreateProject),
  asyncHandler(async (req, res) => {
    const { translations, ...body } = parseOrThrow(createProjectSchema, req.body);

    const id = await prisma.$transaction(async (tx) => {
      await assertGroupExists(tx, body.groupId);
      let slug: string;
      if (body.slug) {
        await assertSlugFree(tx, body.slug);
        slug = body.slug;
      } else {
        slug = await uniqueSlug(tx, "researchProject", slugify(body.title, "project"));
      }

      const row = await tx.researchProject.create({
        data: {
          slug,
          title: body.title,
          summary: body.summary,
          description: body.description,
          status: body.status,
          startDate: fromIsoDate(body.startDate),
          endDate: fromIsoDate(body.endDate),
          visibility: body.visibility ?? "LAB_ONLY",
          sortOrder: body.sortOrder,
          groupId: body.groupId,
        },
      });
      await applyTranslationOverrides(tx, "RESEARCH_PROJECT", row.id, translations?.ja);
      await recordAudit(tx, {
        actor: req.user!,
        action: "PROJECT_CREATED",
        entityType: "RESEARCH_PROJECT",
        entityId: row.id,
        details: { title: row.title, slug: row.slug, status: row.status, visibility: row.visibility, groupId: row.groupId },
      });
      return row.id;
    });

    res.status(201).json(await loadDetail(id, req.user!, resolveLocale(req)));
  }),
);

// PUT /api/projects/:id -> update (lab manager/admin, or a project LEAD for the content fields).
// visibility / slug / sortOrder / groupId are manager-only: a lead who sends one gets 403.
router.put(
  "/:id",
  requireProjectEditor,
  asyncHandler(async (req, res) => {
    const { translations, ...body } = parseOrThrow(updateProjectSchema, req.body);
    if (!canManageProjectSettings(req.user!)) {
      const denied = PROJECT_MANAGER_ONLY_KEYS.find((k) => body[k] !== undefined);
      if (denied) throw new HttpError(403, `Only lab managers and admins can change ${denied}.`);
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.researchProject.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");

      const start = body.startDate !== undefined ? body.startDate : toIsoDate(existing.startDate);
      const end = body.endDate !== undefined ? body.endDate : toIsoDate(existing.endDate);
      if (endsBeforeStart(start, end)) throw new HttpError(400, "End date can't be before the start date.");
      if (body.groupId !== undefined) await assertGroupExists(tx, body.groupId);
      if (body.slug !== undefined) await assertSlugFree(tx, body.slug, existing.id);

      const { startDate, endDate, ...rest } = body;
      await tx.researchProject.update({
        where: { id: existing.id },
        data: {
          ...rest,
          ...(startDate !== undefined && { startDate: fromIsoDate(startDate) }),
          ...(endDate !== undefined && { endDate: fromIsoDate(endDate) }),
        },
      });
      await applyTranslationOverrides(tx, "RESEARCH_PROJECT", existing.id, translations?.ja);

      const before = { ...existing, startDate: toIsoDate(existing.startDate), endDate: toIsoDate(existing.endDate) };
      const changed = changedFields(before, body, [...AUDITED_FIELDS]);
      if (changed) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "PROJECT_UPDATED",
          entityType: "RESEARCH_PROJECT",
          entityId: existing.id,
          details: { title: body.title ?? existing.title, changed },
        });
      }
      await recordVisibilityChange(tx, req.user!, "RESEARCH_PROJECT", existing.id, existing.visibility, body.visibility);
    });

    res.json(await loadDetail(req.params.id, req.user!, resolveLocale(req)));
  }),
);

// DELETE /api/projects/:id -> delete (lab manager or admin). Members, area and publication
// links cascade; linked news is kept and simply unlinked (SET NULL).
router.delete(
  "/:id",
  requireCan(canDeleteProject),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.researchProject.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");

      const unlinkedNews = await tx.newsItem.count({ where: { projectId: existing.id } });
      await tx.translation.deleteMany({ where: { entityType: "RESEARCH_PROJECT", entityId: existing.id } });
      await tx.researchProject.delete({ where: { id: existing.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "PROJECT_DELETED",
        entityType: "RESEARCH_PROJECT",
        entityId: existing.id,
        details: { title: existing.title, slug: existing.slug, visibility: existing.visibility, unlinkedNews },
      });
    });
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Relationships. Each PUT replaces the whole set (checkbox-list UI), touches only
// the join rows, and is audited in the same transaction.
// ---------------------------------------------------------------------------
async function loadProjectOr404(tx: Prisma.TransactionClient, id: string) {
  const project = await tx.researchProject.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!project) throw new HttpError(404, "Not found");
  return project;
}

// PUT /api/projects/:id/members { members: [{ teamMemberId, role }] }
router.put(
  "/:id/members",
  requireProjectEditor,
  asyncHandler(async (req, res) => {
    const { members } = parseOrThrow(setProjectMembersSchema, req.body);

    await prisma.$transaction(async (tx) => {
      const project = await loadProjectOr404(tx, req.params.id);
      const ids = members.map((m) => m.teamMemberId);
      if (ids.length > 0 && (await tx.teamMember.count({ where: { id: { in: ids } } })) !== ids.length) {
        throw new HttpError(400, "One or more team members do not exist.");
      }

      const current = await tx.projectMember.findMany({ where: { projectId: project.id }, select: { teamMemberId: true, role: true } });
      const currentRole = new Map(current.map((c) => [c.teamMemberId, c.role]));
      const { toAdd, toRemove } = diffLinks([...currentRole.keys()], ids);
      const roleChanged = members.filter((m) => currentRole.has(m.teamMemberId) && currentRole.get(m.teamMemberId) !== m.role);
      // Who holds / held the LEAD role before and after: recorded as ids only, so a lead change is one query away.
      const leadsBefore = current.filter((c) => c.role === "LEAD").map((c) => c.teamMemberId).sort();
      const leadsAfter = members.filter((m) => m.role === "LEAD").map((m) => m.teamMemberId).sort();

      if (toRemove.length > 0) await tx.projectMember.deleteMany({ where: { projectId: project.id, teamMemberId: { in: toRemove } } });
      for (const m of members.filter((x) => toAdd.includes(x.teamMemberId))) {
        await tx.projectMember.create({ data: { projectId: project.id, teamMemberId: m.teamMemberId, role: m.role } });
      }
      for (const m of roleChanged) {
        await tx.projectMember.update({
          where: { projectId_teamMemberId: { projectId: project.id, teamMemberId: m.teamMemberId } },
          data: { role: m.role },
        });
      }

      if (toAdd.length > 0 || toRemove.length > 0 || roleChanged.length > 0) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "PROJECT_MEMBERS_CHANGED",
          entityType: "RESEARCH_PROJECT",
          entityId: project.id,
          details: {
            title: project.title,
            added: idList(toAdd),
            removed: idList(toRemove),
            roleChanged: roleChanged.length,
            leadChanged: leadsBefore.join(",") !== leadsAfter.join(","),
            leads: idList(leadsAfter),
          },
        });
      }
    });

    res.json({ success: true });
  }),
);

// PUT /api/projects/:id/areas { areaIds }
router.put(
  "/:id/areas",
  requireProjectEditor,
  asyncHandler(async (req, res) => {
    const { areaIds } = parseOrThrow(setProjectAreasSchema, req.body);

    await prisma.$transaction(async (tx) => {
      const project = await loadProjectOr404(tx, req.params.id);
      if (areaIds.length > 0 && (await tx.researchArea.count({ where: { id: { in: areaIds } } })) !== areaIds.length) {
        throw new HttpError(400, "One or more research areas do not exist.");
      }
      const current = (await tx.projectArea.findMany({ where: { projectId: project.id }, select: { researchAreaId: true } })).map((c) => c.researchAreaId);
      const { toAdd, toRemove } = diffLinks(current, areaIds);

      if (toRemove.length > 0) await tx.projectArea.deleteMany({ where: { projectId: project.id, researchAreaId: { in: toRemove } } });
      if (toAdd.length > 0) await tx.projectArea.createMany({ data: toAdd.map((researchAreaId) => ({ projectId: project.id, researchAreaId })) });

      if (toAdd.length > 0 || toRemove.length > 0) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "PROJECT_AREAS_CHANGED",
          entityType: "RESEARCH_PROJECT",
          entityId: project.id,
          details: { title: project.title, added: idList(toAdd), removed: idList(toRemove) },
        });
      }
    });

    res.json({ success: true });
  }),
);

// PUT /api/projects/:id/publications { publicationIds }
router.put(
  "/:id/publications",
  requireProjectEditor,
  asyncHandler(async (req, res) => {
    const { publicationIds } = parseOrThrow(setProjectPublicationsSchema, req.body);

    await prisma.$transaction(async (tx) => {
      const project = await loadProjectOr404(tx, req.params.id);
      if (publicationIds.length > 0 && (await tx.publication.count({ where: { id: { in: publicationIds } } })) !== publicationIds.length) {
        throw new HttpError(400, "One or more publications do not exist.");
      }
      const current = (await tx.projectPublication.findMany({ where: { projectId: project.id }, select: { publicationId: true } })).map((c) => c.publicationId);
      const { toAdd, toRemove } = diffLinks(current, publicationIds);

      if (toRemove.length > 0) await tx.projectPublication.deleteMany({ where: { projectId: project.id, publicationId: { in: toRemove } } });
      if (toAdd.length > 0) await tx.projectPublication.createMany({ data: toAdd.map((publicationId) => ({ projectId: project.id, publicationId })) });

      if (toAdd.length > 0 || toRemove.length > 0) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "PROJECT_PUBLICATIONS_CHANGED",
          entityType: "RESEARCH_PROJECT",
          entityId: project.id,
          details: { title: project.title, added: idList(toAdd), removed: idList(toRemove) },
        });
      }
    });

    res.json({ success: true });
  }),
);

// PUT /api/projects/:id/news { newsIds }. A news item belongs to at most one project
// (NewsItem.projectId), so an item already linked to a DIFFERENT project is a 409:
// this endpoint never moves news between projects behind that project's back.
router.put(
  "/:id/news",
  requireProjectEditor,
  asyncHandler(async (req, res) => {
    const { newsIds } = parseOrThrow(setProjectNewsSchema, req.body);

    await prisma.$transaction(async (tx) => {
      const project = await loadProjectOr404(tx, req.params.id);
      const requested = newsIds.length > 0 ? await tx.newsItem.findMany({ where: { id: { in: newsIds } }, select: { id: true, projectId: true } }) : [];
      if (requested.length !== newsIds.length) throw new HttpError(400, "One or more news items do not exist.");
      if (requested.some((n) => n.projectId !== null && n.projectId !== project.id)) {
        throw new HttpError(409, "One or more news items already belong to another project.");
      }

      const current = (await tx.newsItem.findMany({ where: { projectId: project.id }, select: { id: true } })).map((n) => n.id);
      const { toAdd, toRemove } = diffLinks(current, newsIds);

      if (toRemove.length > 0) await tx.newsItem.updateMany({ where: { id: { in: toRemove }, projectId: project.id }, data: { projectId: null } });
      if (toAdd.length > 0) await tx.newsItem.updateMany({ where: { id: { in: toAdd } }, data: { projectId: project.id } });

      if (toAdd.length > 0 || toRemove.length > 0) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "PROJECT_NEWS_CHANGED",
          entityType: "RESEARCH_PROJECT",
          entityId: project.id,
          details: { title: project.title, added: idList(toAdd), removed: idList(toRemove) },
        });
      }
    });

    res.json({ success: true });
  }),
);

export default router;
