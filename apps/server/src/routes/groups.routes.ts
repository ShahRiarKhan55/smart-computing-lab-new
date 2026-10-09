import { Router } from "express";
import type { Prisma } from "@prisma/client";
import {
  GROUP_MANAGER_ONLY_KEYS,
  canCreateGroup,
  canDeleteGroup,
  canEditGroup,
  canManageGroupSettings,
  createGroupSchema,
  addGroupMemberSchema,
  setGroupMemberRoleSchema,
  setGroupMembersSchema,
  updateGroupSchema,
  type GroupDetail,
  type GroupSummary,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireCan, requireEditor } from "../middleware/auth.js";
import { assertValidId, diffLinks } from "../lib/authorLinks.js";
import { assertPeopleVisibleAndExist, linkedPersonVisible, splitVisible } from "../lib/hiddenPeople.js";
import { visibilityField, visibleTo, type Viewer } from "../lib/visibility.js";
import { asGroupRole, asProjectStatus, sortMembersLeadFirst } from "../lib/serializers.js";
import { slugify, uniqueSlug } from "../lib/slug.js";
import { changedFields, idList, recordAudit, recordVisibilityChange } from "../lib/audit.js";
import { applyTranslationOverrides, loadTranslations, localize, resolveLocale } from "../lib/translations.js";
import { loadProjectOutputs, loadRefTranslations, pick } from "../lib/researchGraph.js";
import { mountMemberRoutes } from "../lib/membership.js";
import type { Locale } from "@scl/shared";

const router = Router();

const AUDITED_FIELDS = ["name", "description", "visibility", "slug", "sortOrder"] as const;

// ---------------------------------------------------------------------------
// Reading. A group's project list and count only ever include projects the viewer
// may see, so a public group cannot leak that a LAB_ONLY project exists.
// ---------------------------------------------------------------------------
function groupInclude(viewer: Viewer) {
  return {
    members: { where: linkedPersonVisible(viewer), include: { teamMember: { select: { id: true, name: true, initials: true, userId: true } } } },
    projects: {
      where: visibleTo(viewer),
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      select: { id: true, slug: true, title: true, summary: true, status: true },
    },
  } satisfies Prisma.ResearchGroupInclude;
}

interface GroupRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  visibility: string;
  members: { role: string; teamMember: { id: string; name: string; initials: string; userId: string | null } }[];
  projects: { id: string; slug: string; title: string; summary: string; status: string }[];
}

function toSummary(row: GroupRow, viewer: Viewer): GroupSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    ...visibilityField(viewer, row.visibility),
    members: sortMembersLeadFirst(
      row.members.map((m) => ({ teamMemberId: m.teamMember.id, name: m.teamMember.name, initials: m.teamMember.initials, role: asGroupRole(m.role) })),
    ),
    projectCount: row.projects.length,
  };
}

async function loadDetail(id: string, viewer: Viewer, locale: Locale = "en"): Promise<GroupDetail | null> {
  const row = await prisma.researchGroup.findFirst({ where: { id, ...visibleTo(viewer) }, include: groupInclude(viewer) });
  if (!row) return null;
  const projectIds = row.projects.map((p) => p.id);
  const visible = visibleTo(viewer);
  const [translations, refs, outputs, areaRows] = await Promise.all([
    loadTranslations(prisma, "RESEARCH_GROUP", [row.id], locale),
    loadRefTranslations(locale, { projects: projectIds }),
    loadProjectOutputs(projectIds, viewer, locale),
    // Areas of the group's VISIBLE projects, and only areas the viewer may see themselves.
    projectIds.length === 0
      ? Promise.resolve([])
      : prisma.researchArea.findMany({
          where: { ...visible, projectLinks: { some: { projectId: { in: projectIds } } } },
          orderBy: [{ sortOrder: "asc" }, { title: "asc" }, { id: "asc" }],
          select: { id: true, icon: true, title: true, tag: true },
        }),
  ]);
  const areaTr = await loadRefTranslations(locale, { areas: areaRows.map((a) => a.id) });
  const localized = localize(row, "RESEARCH_GROUP", translations);
  const isLead = viewer !== null && row.members.some((m) => m.role === "LEAD" && m.teamMember.userId === viewer.id);
  return {
    ...toSummary(localized, viewer),
    projects: row.projects.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: pick(refs.project, p.id, "title", p.title),
      summary: pick(refs.project, p.id, "summary", p.summary),
      status: asProjectStatus(p.status),
    })),
    areas: areaRows.map((a) => ({ id: a.id, icon: a.icon, title: pick(areaTr.area, a.id, "title", a.title), tag: a.tag })),
    ...outputs,
    canEdit: canEditGroup(viewer, isLead),
  };
}

// GET /api/groups -> list (public; LAB_ONLY groups are hidden from guests)
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const locale = resolveLocale(req);
    const rows = await prisma.researchGroup.findMany({
      where: visibleTo(viewer),
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: groupInclude(viewer),
    });
    const translations = await loadTranslations(prisma, "RESEARCH_GROUP", rows.map((r) => r.id), locale);
    res.json(rows.map((r) => toSummary(localize(r, "RESEARCH_GROUP", translations), viewer)));
  }),
);

// GET /api/groups/:id -> single (public; a LAB_ONLY group is a 404 for guests)
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
const isGroupLead = async (groupId: string, userId: string) =>
  (await prisma.groupMember.count({ where: { groupId, role: "LEAD", teamMember: { userId } } })) > 0;

/** Lab manager/admin, or a LEAD of this group. */
const requireGroupEditor = requireEditor(canEditGroup, isGroupLead);

async function assertSlugFree(tx: Prisma.TransactionClient, slug: string, exceptId?: string) {
  const taken = await tx.researchGroup.findUnique({ where: { slug }, select: { id: true } });
  if (taken && taken.id !== exceptId) throw new HttpError(409, "That slug is already in use.");
}

// POST /api/groups -> create (lab manager or admin). New groups are LAB_ONLY unless a visibility is given.
router.post(
  "/",
  requireCan(canCreateGroup),
  asyncHandler(async (req, res) => {
    const { translations, ...body } = parseOrThrow(createGroupSchema, req.body);

    const id = await prisma.$transaction(async (tx) => {
      let slug: string;
      if (body.slug) {
        await assertSlugFree(tx, body.slug);
        slug = body.slug;
      } else {
        slug = await uniqueSlug(tx, "researchGroup", slugify(body.name, "group"));
      }
      const row = await tx.researchGroup.create({
        data: {
          slug,
          name: body.name,
          description: body.description,
          visibility: body.visibility ?? "LAB_ONLY",
          sortOrder: body.sortOrder,
        },
      });
      await applyTranslationOverrides(tx, "RESEARCH_GROUP", row.id, translations?.ja);
      await recordAudit(tx, {
        actor: req.user!,
        action: "GROUP_CREATED",
        entityType: "RESEARCH_GROUP",
        entityId: row.id,
        details: { name: row.name, slug: row.slug, visibility: row.visibility },
      });
      return row.id;
    });

    res.status(201).json(await loadDetail(id, req.user!, resolveLocale(req)));
  }),
);

// PUT /api/groups/:id -> update (lab manager/admin, or a group LEAD for name/description).
// visibility / slug / sortOrder are manager-only: a lead who sends one gets 403.
router.put(
  "/:id",
  requireGroupEditor,
  asyncHandler(async (req, res) => {
    const { translations, ...body } = parseOrThrow(updateGroupSchema, req.body);
    if (!canManageGroupSettings(req.user!)) {
      const denied = GROUP_MANAGER_ONLY_KEYS.find((k) => body[k] !== undefined);
      if (denied) throw new HttpError(403, `Only lab managers and admins can change ${denied}.`);
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.researchGroup.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");
      if (body.slug !== undefined) await assertSlugFree(tx, body.slug, existing.id);

      await tx.researchGroup.update({ where: { id: existing.id }, data: body });
      await applyTranslationOverrides(tx, "RESEARCH_GROUP", existing.id, translations?.ja);

      const changed = changedFields(existing, body, [...AUDITED_FIELDS]);
      if (changed) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "GROUP_UPDATED",
          entityType: "RESEARCH_GROUP",
          entityId: existing.id,
          details: { name: body.name ?? existing.name, changed },
        });
      }
      await recordVisibilityChange(tx, req.user!, "RESEARCH_GROUP", existing.id, existing.visibility, body.visibility);
    });

    res.json(await loadDetail(req.params.id, req.user!, resolveLocale(req)));
  }),
);

// DELETE /api/groups/:id -> delete (lab manager or admin). Memberships cascade; projects
// are kept and simply become ungrouped (SET NULL).
router.delete(
  "/:id",
  requireCan(canDeleteGroup),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.researchGroup.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");

      const ungroupedProjects = await tx.researchProject.count({ where: { groupId: existing.id } });
      await tx.translation.deleteMany({ where: { entityType: "RESEARCH_GROUP", entityId: existing.id } });
      await tx.researchGroup.delete({ where: { id: existing.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "GROUP_DELETED",
        entityType: "RESEARCH_GROUP",
        entityId: existing.id,
        details: { name: existing.name, slug: existing.slug, visibility: existing.visibility, ungroupedProjects },
      });
    });
    res.json({ success: true });
  }),
);

// PUT /api/groups/:id/members { members: [{ teamMemberId, role }] } — replaces the whole set.
router.put(
  "/:id/members",
  requireGroupEditor,
  asyncHandler(async (req, res) => {
    const { members } = parseOrThrow(setGroupMembersSchema, req.body);

    await prisma.$transaction(async (tx) => {
      const group = await tx.researchGroup.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
      if (!group) throw new HttpError(404, "Not found");

      const ids = members.map((m) => m.teamMemberId);
      await assertPeopleVisibleAndExist(tx, req.user!, ids);

      const allCurrent = await tx.groupMember.findMany({ where: { groupId: group.id }, select: { teamMemberId: true, role: true } });
      const seen = new Set((await splitVisible(tx, req.user!, allCurrent.map((c) => c.teamMemberId))).visible);
      const current = allCurrent.filter((c) => seen.has(c.teamMemberId));
      const currentRole = new Map(current.map((c) => [c.teamMemberId, c.role]));
      const { toAdd, toRemove } = diffLinks([...currentRole.keys()], ids);
      const roleChanged = members.filter((m) => currentRole.has(m.teamMemberId) && currentRole.get(m.teamMemberId) !== m.role);
      // Hidden people are never edited here, so a hidden lead stays a lead before and after.
      const hiddenLeads = allCurrent.filter((c) => !seen.has(c.teamMemberId) && c.role === "LEAD").map((c) => c.teamMemberId);
      const leadsBefore = [...current.filter((c) => c.role === "LEAD").map((c) => c.teamMemberId), ...hiddenLeads].sort();
      const leadsAfter = [...members.filter((m) => m.role === "LEAD").map((m) => m.teamMemberId), ...hiddenLeads].sort();

      if (toRemove.length > 0) await tx.groupMember.deleteMany({ where: { groupId: group.id, teamMemberId: { in: toRemove } } });
      for (const m of members.filter((x) => toAdd.includes(x.teamMemberId))) {
        await tx.groupMember.create({ data: { groupId: group.id, teamMemberId: m.teamMemberId, role: m.role } });
      }
      for (const m of roleChanged) {
        await tx.groupMember.update({
          where: { groupId_teamMemberId: { groupId: group.id, teamMemberId: m.teamMemberId } },
          data: { role: m.role },
        });
      }

      if (toAdd.length > 0 || toRemove.length > 0 || roleChanged.length > 0) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "GROUP_MEMBERS_CHANGED",
          entityType: "RESEARCH_GROUP",
          entityId: group.id,
          details: {
            name: group.name,
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

// Phase 21: single-researcher add / change-role / remove (the workspace and detail-page actions).
mountMemberRoutes(router, {
  guard: requireGroupEditor,
  addSchema: addGroupMemberSchema,
  roleSchema: setGroupMemberRoleSchema,
  action: "GROUP_MEMBERS_CHANGED",
  entityType: "RESEARCH_GROUP",
  parent: {
    load: async (tx, id) => {
      const g = await tx.researchGroup.findUnique({ where: { id }, select: { id: true, name: true } });
      return g && { id: g.id, label: g.name, labelKey: "name" };
    },
    find: (tx, groupId, teamMemberId) => tx.groupMember.findUnique({ where: { groupId_teamMemberId: { groupId, teamMemberId } }, select: { role: true } }),
    leads: async (tx, groupId) => (await tx.groupMember.findMany({ where: { groupId, role: "LEAD" }, select: { teamMemberId: true } })).map((m) => m.teamMemberId).sort(),
    create: (tx, groupId, teamMemberId, role) => tx.groupMember.create({ data: { groupId, teamMemberId, role } }),
    update: (tx, groupId, teamMemberId, role) => tx.groupMember.update({ where: { groupId_teamMemberId: { groupId, teamMemberId } }, data: { role } }),
    remove: (tx, groupId, teamMemberId) => tx.groupMember.delete({ where: { groupId_teamMemberId: { groupId, teamMemberId } } }),
  },
});

export default router;
