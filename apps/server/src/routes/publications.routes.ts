import { Router } from "express";
import type { Prisma } from "@prisma/client";
import {
  canDeleteContent,
  createPublicationSchema,
  updatePublicationSchema,
  setPublicationAuthorsSchema,
  type PublicationAuthorsResponse,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireAuth, requireCan } from "../middleware/auth.js";
import {
  assertMayChangeLinks,
  assertTeamMembersExist,
  assertValidId,
  diffLinks,
  type LinkActor,
} from "../lib/authorLinks.js";
import { assertMayChangeVisibility, visibleTo } from "../lib/visibility.js";
import { toPublication } from "../lib/serializers.js";
import { changedFields, idList, recordAudit, recordVisibilityChange } from "../lib/audit.js";

const router = Router();

const AUDITED_FIELDS = ["year", "title", "authors", "venue", "pdfUrl", "doiUrl", "extraUrl", "extraLabel", "visibility"] as const;

// GET /api/publications -> list (public; LAB_ONLY items are hidden from guests)
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const rows = await prisma.publication.findMany({
      where: visibleTo(req.user ?? null),
      orderBy: [{ year: "desc" }, { createdAt: "desc" }],
    });
    res.json(rows.map((r) => toPublication(r, req.user ?? null)));
  }),
);

// GET /api/publications/:id -> single (public; a LAB_ONLY item is a 404 for guests)
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const row = await prisma.publication.findFirst({ where: { id: req.params.id, ...visibleTo(req.user ?? null) } });
    if (!row) throw new HttpError(404, "Not found");
    res.json(toPublication(row, req.user ?? null));
  }),
);

// -----------------------------------------------------------------
// Author links (PublicationAuthor join table). Replaces the full set of
// linked team members; only the join rows change, never the Publication.
// -----------------------------------------------------------------
async function listAuthorIds(tx: Prisma.TransactionClient, publicationId: string) {
  const links = await tx.publicationAuthor.findMany({
    where: { publicationId },
    select: { teamMemberId: true },
  });
  return links.map((l) => l.teamMemberId).sort();
}

/** Applies the new author set and returns what changed (for the audit row). */
async function replaceAuthors(
  tx: Prisma.TransactionClient,
  actor: LinkActor,
  publicationId: string,
  requestedIds: string[],
) {
  const current = await listAuthorIds(tx, publicationId);
  await assertMayChangeLinks(tx, actor, current, requestedIds);
  await assertTeamMembersExist(tx, requestedIds);

  const { toAdd, toRemove } = diffLinks(current, requestedIds);
  if (toRemove.length > 0) {
    await tx.publicationAuthor.deleteMany({ where: { publicationId, teamMemberId: { in: toRemove } } });
  }
  if (toAdd.length > 0) {
    await tx.publicationAuthor.createMany({
      data: toAdd.map((teamMemberId) => ({ publicationId, teamMemberId })),
    });
  }
  return { toAdd, toRemove };
}

async function auditAuthorChange(
  tx: Prisma.TransactionClient,
  actor: { id: string; email: string },
  publicationId: string,
  diff: { toAdd: string[]; toRemove: string[] },
) {
  if (diff.toAdd.length === 0 && diff.toRemove.length === 0) return;
  await recordAudit(tx, {
    actor,
    action: "PUBLICATION_AUTHORS_CHANGED",
    entityType: "PUBLICATION",
    entityId: publicationId,
    details: { added: idList(diff.toAdd), removed: idList(diff.toRemove) },
  });
}

// GET /api/publications/:id/authors -> linked team member ids (public for public
// publications; a hidden publication is a 404)
router.get(
  "/:id/authors",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const row = await prisma.publication.findFirst({
      where: { id: req.params.id, ...visibleTo(req.user ?? null) },
      select: { id: true },
    });
    if (!row) throw new HttpError(404, "Not found");
    const body: PublicationAuthorsResponse = { teamMemberIds: await listAuthorIds(prisma, row.id) };
    res.json(body);
  }),
);

// PUT /api/publications/:id/authors -> replace linked team members
// (manager/admin: any; member: only their own link — see assertMayChangeLinks)
router.put(
  "/:id/authors",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { teamMemberIds } = parseOrThrow(setPublicationAuthorsSchema, req.body);

    const linked = await prisma.$transaction(async (tx) => {
      const existing = await tx.publication.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!existing) throw new HttpError(404, "Not found");
      const diff = await replaceAuthors(tx, req.user!, existing.id, teamMemberIds);
      await auditAuthorChange(tx, req.user!, existing.id, diff);
      return listAuthorIds(tx, existing.id);
    });

    const body: PublicationAuthorsResponse = { teamMemberIds: linked };
    res.json(body);
  }),
);

// POST /api/publications -> create (any logged-in user, like the reference; `visibility` is managers-only)
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { teamMemberIds, ...fields } = parseOrThrow(createPublicationSchema, req.body);
    assertMayChangeVisibility(req.user!, fields.visibility);

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.publication.create({ data: fields });
      let linkedAuthors = 0;
      if (teamMemberIds !== undefined) {
        const diff = await replaceAuthors(tx, req.user!, row.id, teamMemberIds);
        linkedAuthors = diff.toAdd.length;
      }
      await recordAudit(tx, {
        actor: req.user!,
        action: "PUBLICATION_CREATED",
        entityType: "PUBLICATION",
        entityId: row.id,
        details: { title: row.title, year: row.year, visibility: row.visibility, linkedAuthors },
      });
      return row;
    });

    res.status(201).json(toPublication(created, req.user!));
  }),
);

// PUT /api/publications/:id -> update (any logged-in user, like the reference;
// `visibility` is managers-only). Optional teamMemberIds updates the author links
// in the same transaction, so a rejected link change rolls the whole update back.
router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { teamMemberIds, ...fields } = parseOrThrow(updatePublicationSchema, req.body);
    assertMayChangeVisibility(req.user!, fields.visibility);

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.publication.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");

      const row = await tx.publication.update({ where: { id: existing.id }, data: fields });
      if (teamMemberIds !== undefined) {
        const diff = await replaceAuthors(tx, req.user!, existing.id, teamMemberIds);
        await auditAuthorChange(tx, req.user!, existing.id, diff);
      }
      const changed = changedFields(existing, fields, [...AUDITED_FIELDS]);
      if (changed) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "PUBLICATION_UPDATED",
          entityType: "PUBLICATION",
          entityId: row.id,
          details: { title: row.title, changed },
        });
      }
      await recordVisibilityChange(tx, req.user!, "PUBLICATION", row.id, existing.visibility, fields.visibility);
      return row;
    });

    res.json(toPublication(updated, req.user!));
  }),
);

// DELETE /api/publications/:id -> delete (lab manager or admin).
// Author and project links are removed by ON DELETE CASCADE.
router.delete(
  "/:id",
  requireCan(canDeleteContent),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.publication.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");

      await tx.publication.delete({ where: { id: existing.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "PUBLICATION_DELETED",
        entityType: "PUBLICATION",
        entityId: existing.id,
        details: { title: existing.title, year: existing.year, visibility: existing.visibility },
      });
    });
    res.json({ success: true });
  }),
);

export default router;
