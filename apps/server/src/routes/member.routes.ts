import { Router } from "express";
import type { Prisma } from "@prisma/client";
import {
  createHistoryEntrySchema,
  updateHistoryEntrySchema,
  setPublicationLinksSchema,
  setNewsLinksSchema,
  type HistoryEntry,
  type MemberProfile,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireOwnerOrManager } from "../middleware/auth.js";
import { assertValidId, diffLinks } from "../lib/authorLinks.js";
import { visibleTo } from "../lib/visibility.js";
import { asGroupRole, asProjectRole, asProjectStatus, isOwnProfile, toNewsItem, toPublication } from "../lib/serializers.js";
import { idList, recordAudit } from "../lib/audit.js";

const router = Router();

async function loadMemberOr404(id: string) {
  const member = await prisma.teamMember.findUnique({ where: { id } });
  if (!member) throw new HttpError(404, "Team member not found");
  return member;
}

function toHistoryEntry(row: {
  id: string;
  year: string;
  title: string;
  description: string;
  sortOrder: number;
}): HistoryEntry {
  return {
    id: row.id,
    year: row.year,
    title: row.title,
    description: row.description,
    sortOrder: row.sortOrder,
  };
}

// -----------------------------------------------------------------
// GET /api/member/:id -> full public profile: member info + history +
// linked publications, news, projects and groups (public, no login required).
// Every linked record is filtered by the viewer's visibility, so a guest never
// receives a LAB_ONLY publication, news item, project or group through here.
// -----------------------------------------------------------------
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const visible = visibleTo(viewer);
    const member = await prisma.teamMember.findUnique({
      where: { id: req.params.id },
      include: {
        historyEntries: { orderBy: [{ sortOrder: "asc" }, { year: "desc" }] },
        publicationLinks: {
          where: { publication: visible },
          include: { publication: true },
        },
        newsLinks: {
          where: { newsItem: visible },
          include: { newsItem: true },
        },
        projectLinks: {
          where: { project: visible },
          include: { project: { select: { id: true, slug: true, title: true, status: true, sortOrder: true } } },
        },
        groupLinks: {
          where: { group: visible },
          include: { group: { select: { id: true, slug: true, name: true, sortOrder: true } } },
        },
      },
    });

    if (!member) throw new HttpError(404, "Team member not found");

    const publications = member.publicationLinks
      .map((link) => link.publication)
      .sort((a, b) => b.year - a.year || b.createdAt.getTime() - a.createdAt.getTime());

    const news = member.newsLinks
      .map((link) => link.newsItem)
      .sort((a, b) => (a.sortDate < b.sortDate ? 1 : a.sortDate > b.sortDate ? -1 : 0));

    const projects = [...member.projectLinks].sort(
      (a, b) => a.project.sortOrder - b.project.sortOrder || a.project.title.localeCompare(b.project.title),
    );
    const groups = [...member.groupLinks].sort(
      (a, b) => a.group.sortOrder - b.group.sortOrder || a.group.name.localeCompare(b.group.name),
    );

    const profile: MemberProfile = {
      id: member.id,
      isOwn: isOwnProfile(viewer, member.userId),
      canMessage: Boolean(viewer && member.userId && member.userId !== viewer.id),
      name: member.name,
      initials: member.initials,
      role: member.role,
      category: member.category as MemberProfile["category"],
      department: member.department,
      bio: member.bio,
      photoUrl: member.photoUrl,
      history: member.historyEntries.map(toHistoryEntry),
      publications: publications.map((p) => toPublication(p, viewer)),
      news: news.map((n) => toNewsItem(n, viewer)),
      projects: projects.map((l) => ({
        id: l.project.id,
        slug: l.project.slug,
        title: l.project.title,
        status: asProjectStatus(l.project.status),
        role: asProjectRole(l.role),
      })),
      groups: groups.map((l) => ({
        id: l.group.id,
        slug: l.group.slug,
        name: l.group.name,
        role: asGroupRole(l.role),
      })),
    };

    res.json(profile);
  }),
);

// -----------------------------------------------------------------
// History entries — owner of the linked account, or a lab manager/admin
// -----------------------------------------------------------------
router.post(
  "/:id/history",
  requireOwnerOrManager("id"),
  asyncHandler(async (req, res) => {
    await loadMemberOr404(req.params.id);
    const body = parseOrThrow(createHistoryEntrySchema, req.body);

    const entry = await prisma.historyEntry.create({
      data: {
        teamMemberId: req.params.id,
        year: body.year,
        title: body.title,
        description: body.description,
        sortOrder: body.sortOrder,
      },
    });

    res.status(201).json(toHistoryEntry(entry));
  }),
);

router.put(
  "/:id/history/:entryId",
  requireOwnerOrManager("id"),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.entryId);
    const existing = await prisma.historyEntry.findFirst({
      where: { id: req.params.entryId, teamMemberId: req.params.id },
    });
    if (!existing) throw new HttpError(404, "History entry not found");

    const body = parseOrThrow(updateHistoryEntrySchema, req.body);
    const updated = await prisma.historyEntry.update({
      where: { id: existing.id },
      data: {
        year: body.year ?? existing.year,
        title: body.title ?? existing.title,
        description: body.description ?? existing.description,
        sortOrder: body.sortOrder ?? existing.sortOrder,
      },
    });

    res.json(toHistoryEntry(updated));
  }),
);

router.delete(
  "/:id/history/:entryId",
  requireOwnerOrManager("id"),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.entryId);
    const existing = await prisma.historyEntry.findFirst({
      where: { id: req.params.entryId, teamMemberId: req.params.id },
    });
    if (!existing) throw new HttpError(404, "History entry not found");

    await prisma.historyEntry.delete({ where: { id: existing.id } });
    res.json({ success: true });
  }),
);

// -----------------------------------------------------------------
// Linking publications / news — replaces the full set each time, which
// keeps a checkbox-list UI simple and never touches the Publication/
// NewsItem rows themselves, only the join tables. The caller is always a
// logged-in account, so nothing hidden from guests is lost by replacing the set.
// -----------------------------------------------------------------
type LinkKind = "publication" | "news";

async function replaceMemberLinks(
  tx: Prisma.TransactionClient,
  actor: { id: string; email: string },
  memberId: string,
  kind: LinkKind,
  requestedIds: string[],
) {
  const current =
    kind === "publication"
      ? (await tx.publicationAuthor.findMany({ where: { teamMemberId: memberId }, select: { publicationId: true } })).map((l) => l.publicationId)
      : (await tx.newsAuthor.findMany({ where: { teamMemberId: memberId }, select: { newsItemId: true } })).map((l) => l.newsItemId);
  const { toAdd, toRemove } = diffLinks(current, requestedIds);

  if (kind === "publication") {
    if (toRemove.length > 0) await tx.publicationAuthor.deleteMany({ where: { teamMemberId: memberId, publicationId: { in: toRemove } } });
    if (toAdd.length > 0) await tx.publicationAuthor.createMany({ data: toAdd.map((publicationId) => ({ publicationId, teamMemberId: memberId })) });
  } else {
    if (toRemove.length > 0) await tx.newsAuthor.deleteMany({ where: { teamMemberId: memberId, newsItemId: { in: toRemove } } });
    if (toAdd.length > 0) await tx.newsAuthor.createMany({ data: toAdd.map((newsItemId) => ({ newsItemId, teamMemberId: memberId })) });
  }

  if (toAdd.length > 0 || toRemove.length > 0) {
    await recordAudit(tx, {
      actor,
      action: "MEMBER_LINKS_CHANGED",
      entityType: "TEAM_MEMBER",
      entityId: memberId,
      details: { kind, added: idList(toAdd), removed: idList(toRemove) },
    });
  }
}

router.put(
  "/:id/publications",
  requireOwnerOrManager("id"),
  asyncHandler(async (req, res) => {
    await loadMemberOr404(req.params.id);
    const { publicationIds } = parseOrThrow(setPublicationLinksSchema, req.body);
    const uniqueIds = [...new Set(publicationIds)];

    await prisma.$transaction(async (tx) => {
      if (uniqueIds.length > 0) {
        const found = await tx.publication.count({ where: { id: { in: uniqueIds } } });
        if (found !== uniqueIds.length) throw new HttpError(400, "One or more publication ids do not exist.");
      }
      await replaceMemberLinks(tx, req.user!, req.params.id, "publication", uniqueIds);
    });

    res.json({ success: true });
  }),
);

router.put(
  "/:id/news",
  requireOwnerOrManager("id"),
  asyncHandler(async (req, res) => {
    await loadMemberOr404(req.params.id);
    const { newsIds } = parseOrThrow(setNewsLinksSchema, req.body);
    const uniqueIds = [...new Set(newsIds)];

    await prisma.$transaction(async (tx) => {
      if (uniqueIds.length > 0) {
        const found = await tx.newsItem.count({ where: { id: { in: uniqueIds } } });
        if (found !== uniqueIds.length) throw new HttpError(400, "One or more news ids do not exist.");
      }
      await replaceMemberLinks(tx, req.user!, req.params.id, "news", uniqueIds);
    });

    res.json({ success: true });
  }),
);

export default router;
