import { Router } from "express";
import type { Prisma } from "@prisma/client";
import {
  canDeleteContent,
  createNewsItemSchema,
  updateNewsItemSchema,
  setNewsAuthorsSchema,
  type NewsAuthorsResponse,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireAuth, requireCan } from "../middleware/auth.js";
import {
  assertMayChangeLinks,
  assertValidId,
  diffLinks,
  type LinkActor,
} from "../lib/authorLinks.js";
import { assertPeopleVisibleAndExist, splitVisible } from "../lib/hiddenPeople.js";
import { assertMayChangeVisibility, visibleTo, type Viewer } from "../lib/visibility.js";
import { toNewsItem } from "../lib/serializers.js";
import { changedFields, idList, recordAudit, recordVisibilityChange } from "../lib/audit.js";
import { applyTranslationOverrides, loadTranslations, localize, resolveLocale } from "../lib/translations.js";

const router = Router();

const AUDITED_FIELDS = ["dateLabel", "sortDate", "type", "emoji", "title", "description", "visibility"] as const;

// GET /api/news -> list (public; LAB_ONLY items are hidden from guests)
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const locale = resolveLocale(req);
    const rows = await prisma.newsItem.findMany({
      where: visibleTo(req.user ?? null),
      orderBy: { sortDate: "desc" },
    });
    const translations = await loadTranslations(prisma, "NEWS_ITEM", rows.map((r) => r.id), locale);
    res.json(rows.map((r) => toNewsItem(localize(r, "NEWS_ITEM", translations), req.user ?? null)));
  }),
);

// GET /api/news/:id -> single (public; a LAB_ONLY item is a 404 for guests)
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const row = await prisma.newsItem.findFirst({ where: { id: req.params.id, ...visibleTo(req.user ?? null) } });
    if (!row) throw new HttpError(404, "Not found");
    const translations = await loadTranslations(prisma, "NEWS_ITEM", [row.id], resolveLocale(req));
    res.json(toNewsItem(localize(row, "NEWS_ITEM", translations), req.user ?? null));
  }),
);

// -----------------------------------------------------------------
// Author links (NewsAuthor join table). Replaces the full set of linked
// team members; only the join rows change, never the NewsItem.
// -----------------------------------------------------------------
async function listAuthorIds(tx: Prisma.TransactionClient, newsItemId: string) {
  const links = await tx.newsAuthor.findMany({ where: { newsItemId }, select: { teamMemberId: true } });
  return links.map((l) => l.teamMemberId).sort();
}

/** Linked ids the viewer may see (an unpublished person is not listed to anyone but managers and themself). */
async function listVisibleAuthorIds(tx: Prisma.TransactionClient, id: string, viewer: Viewer): Promise<string[]> {
  return (await splitVisible(tx, viewer, await listAuthorIds(tx, id))).visible;
}

/** Applies the new author set and returns what changed (for the audit row). */
async function replaceAuthors(
  tx: Prisma.TransactionClient,
  actor: LinkActor,
  newsItemId: string,
  requestedIds: string[],
) {
  const current = await listAuthorIds(tx, newsItemId);
  // Only links the editor may see take part: hidden (unpublished) people are never revealed, probed or removed by this save.
  const { visible } = await splitVisible(tx, actor, current);
  await assertMayChangeLinks(tx, actor, visible, requestedIds);
  await assertPeopleVisibleAndExist(tx, actor, requestedIds);

  const { toAdd, toRemove } = diffLinks(visible, requestedIds);
  if (toRemove.length > 0) {
    await tx.newsAuthor.deleteMany({ where: { newsItemId, teamMemberId: { in: toRemove } } });
  }
  if (toAdd.length > 0) {
    await tx.newsAuthor.createMany({ data: toAdd.map((teamMemberId) => ({ newsItemId, teamMemberId })) });
  }
  return { toAdd, toRemove };
}

async function auditAuthorChange(
  tx: Prisma.TransactionClient,
  actor: { id: string; email: string },
  newsItemId: string,
  diff: { toAdd: string[]; toRemove: string[] },
) {
  if (diff.toAdd.length === 0 && diff.toRemove.length === 0) return;
  await recordAudit(tx, {
    actor,
    action: "NEWS_AUTHORS_CHANGED",
    entityType: "NEWS_ITEM",
    entityId: newsItemId,
    details: { added: idList(diff.toAdd), removed: idList(diff.toRemove) },
  });
}

// GET /api/news/:id/authors -> linked team member ids (public for public news; a
// hidden news item is a 404)
router.get(
  "/:id/authors",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const row = await prisma.newsItem.findFirst({
      where: { id: req.params.id, ...visibleTo(req.user ?? null) },
      select: { id: true },
    });
    if (!row) throw new HttpError(404, "Not found");
    const body: NewsAuthorsResponse = { teamMemberIds: await listVisibleAuthorIds(prisma, row.id, req.user ?? null) };
    res.json(body);
  }),
);

// PUT /api/news/:id/authors -> replace linked team members
// (manager/admin: any; member: only their own link — see assertMayChangeLinks)
router.put(
  "/:id/authors",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { teamMemberIds } = parseOrThrow(setNewsAuthorsSchema, req.body);

    const linked = await prisma.$transaction(async (tx) => {
      const existing = await tx.newsItem.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!existing) throw new HttpError(404, "Not found");
      const diff = await replaceAuthors(tx, req.user!, existing.id, teamMemberIds);
      await auditAuthorChange(tx, req.user!, existing.id, diff);
      return listVisibleAuthorIds(tx, existing.id, req.user!);
    });

    const body: NewsAuthorsResponse = { teamMemberIds: linked };
    res.json(body);
  }),
);

// POST /api/news -> create (any logged-in user, like the reference; `visibility` is managers-only)
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { teamMemberIds, date, translations, ...rest } = parseOrThrow(createNewsItemSchema, req.body);
    assertMayChangeVisibility(req.user!, rest.visibility);

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.newsItem.create({ data: { ...rest, dateLabel: date } });
      await applyTranslationOverrides(tx, "NEWS_ITEM", row.id, translations?.ja);
      let linkedAuthors = 0;
      if (teamMemberIds !== undefined) {
        const diff = await replaceAuthors(tx, req.user!, row.id, teamMemberIds);
        linkedAuthors = diff.toAdd.length;
      }
      await recordAudit(tx, {
        actor: req.user!,
        action: "NEWS_CREATED",
        entityType: "NEWS_ITEM",
        entityId: row.id,
        details: { title: row.title, visibility: row.visibility, linkedAuthors },
      });
      return row;
    });

    res.status(201).json(toNewsItem(created, req.user!));
  }),
);

// PUT /api/news/:id -> update (any logged-in user, like the reference; `visibility`
// is managers-only). Optional teamMemberIds updates the author links in the same
// transaction, so a rejected link change rolls the whole update back.
router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { teamMemberIds, date, translations, ...rest } = parseOrThrow(updateNewsItemSchema, req.body);
    assertMayChangeVisibility(req.user!, rest.visibility);

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.newsItem.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");

      const data = { ...rest, dateLabel: date };
      const row = await tx.newsItem.update({ where: { id: existing.id }, data });
      await applyTranslationOverrides(tx, "NEWS_ITEM", row.id, translations?.ja);
      if (teamMemberIds !== undefined) {
        const diff = await replaceAuthors(tx, req.user!, existing.id, teamMemberIds);
        await auditAuthorChange(tx, req.user!, existing.id, diff);
      }
      const changed = changedFields(existing, data, [...AUDITED_FIELDS]);
      if (changed) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "NEWS_UPDATED",
          entityType: "NEWS_ITEM",
          entityId: row.id,
          details: { title: row.title, changed },
        });
      }
      await recordVisibilityChange(tx, req.user!, "NEWS_ITEM", row.id, existing.visibility, rest.visibility);
      return row;
    });

    res.json(toNewsItem(updated, req.user!));
  }),
);

// DELETE /api/news/:id -> delete (lab manager or admin).
// Author links are removed by ON DELETE CASCADE; a project link is cleared by SET NULL.
router.delete(
  "/:id",
  requireCan(canDeleteContent),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.newsItem.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");

      await tx.translation.deleteMany({ where: { entityType: "NEWS_ITEM", entityId: existing.id } });
      await tx.newsItem.delete({ where: { id: existing.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "NEWS_DELETED",
        entityType: "NEWS_ITEM",
        entityId: existing.id,
        details: { title: existing.title, visibility: existing.visibility },
      });
    });
    res.json({ success: true });
  }),
);

export default router;
