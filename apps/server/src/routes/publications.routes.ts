import { publishedMemberWhere } from "../lib/memberVisibility.js";
import { Router } from "express";
import type { Prisma } from "@prisma/client";
import {
  canChangeVisibility,
  canDeleteContent,
  pageRangeProblem,
  createPublicationSchema,
  publicationListQuerySchema,
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
import { assertMayChangeVisibility, visibleTo, type Viewer } from "../lib/visibility.js";
import { toPublication } from "../lib/serializers.js";
import { browsePublications, loadPublicationDetail } from "../lib/publicationHub.js";
import { localizedPublications } from "../lib/researchGraph.js";
import { applyTranslationOverrides, getEntityTranslations, resolveLocale } from "../lib/translations.js";
import { changedFields, idList, recordAudit, recordVisibilityChange } from "../lib/audit.js";
import { transientContentionAs503 } from "../lib/dbErrors.js";
import { guardPublication, lockForDuplicateCheck, overrideDetails } from "../lib/duplicates.js";

const router = Router();

const AUDITED_FIELDS = ["year", "title", "authors", "venue", "pdfUrl", "doiUrl", "extraUrl", "extraLabel", "status", "listNumber", "category", "volume", "startPage", "endPage", "month", "acceptedDate", "visibility"] as const;

/** Field NAMES whose Japanese override differs between two snapshots (never the text: audit convention). */
async function auditTranslationChange(
  tx: Prisma.TransactionClient,
  actor: { id: string; email: string },
  publicationId: string,
  before: Record<string, string | null>,
) {
  const after = await getEntityTranslations(tx, "PUBLICATION", publicationId);
  const fields = Object.keys(after).filter((f) => after[f] !== before[f]);
  if (fields.length === 0) return;
  await recordAudit(tx, {
    actor,
    action: "TRANSLATIONS_CHANGED",
    entityType: "PUBLICATION",
    entityId: publicationId,
    details: { locale: "ja", fields: fields.join(",") },
  });
}

// GET /api/publications -> the whole list, newest first (public; LAB_ONLY items are hidden from guests).
// The web's hub page uses /browse below; this stays for callers that want every row (pickers, the home page).
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const rows = await prisma.publication.findMany({
      where: visibleTo(viewer),
      orderBy: [{ year: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    });
    res.json(await localizedPublications(rows, viewer, resolveLocale(req)));
  }),
);

// GET /api/publications/browse?q&year&researcher&project&area&group&visibility&sort&page&limit
// -> one filtered, sorted, paged slice. Malformed values are a 400; a filter on a hidden or unknown id
// matches nothing (the same answer for both). `visibility` is a manager-only filter.
router.get(
  "/browse",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const query = parseOrThrow(publicationListQuerySchema, req.query);
    if (query.visibility && !canChangeVisibility(viewer)) {
      throw new HttpError(403, "Only lab managers and admins can filter by visibility.");
    }
    res.json(await browsePublications(query, viewer, resolveLocale(req)));
  }),
);

// GET /api/publications/:id -> one publication with its real links (public; a LAB_ONLY or missing item is the same 404)
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const detail = await loadPublicationDetail(req.params.id, req.user ?? null, resolveLocale(req));
    if (!detail) throw new HttpError(404, "Not found");
    res.json(detail);
  }),
);

// -----------------------------------------------------------------
// Author links (PublicationAuthor join table). Replaces the full set of
// linked team members; only the join rows change, never the Publication.
// -----------------------------------------------------------------
async function listAuthorIds(tx: Prisma.TransactionClient, publicationId: string, viewer: Viewer) {
  const links = await tx.publicationAuthor.findMany({
    where: { publicationId, teamMember: publishedMemberWhere(viewer) },
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
  const current = await listAuthorIds(tx, publicationId, actor);
  await assertMayChangeLinks(tx, actor, current, requestedIds);
  await assertTeamMembersExist(tx, requestedIds, actor);

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
    const body: PublicationAuthorsResponse = { teamMemberIds: await listAuthorIds(prisma, row.id, req.user ?? null) };
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
      return listAuthorIds(tx, existing.id, req.user!);
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
    const { teamMemberIds, translations, confirmDuplicate, ...fields } = parseOrThrow(createPublicationSchema, req.body);
    assertMayChangeVisibility(req.user!, fields.visibility);

    const created = await prisma.$transaction(async (tx) => {
      // Duplicate warning (shared/duplicates.ts): identical canonical DOI, or same title + year when a DOI is missing. Write lock first so
      // two overlapping creates serialise. Distinct DOIs (preprint / conference / journal versions) are never flagged.
      await lockForDuplicateCheck(tx, "publication");
      const overridden = await guardPublication(tx, req.user!, { next: { title: fields.title, year: fields.year, doiUrl: fields.doiUrl }, confirm: confirmDuplicate });
      const row = await tx.publication.create({ data: fields });
      await applyTranslationOverrides(tx, "PUBLICATION", row.id, translations?.ja);
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
        details: { title: row.title, year: row.year, visibility: row.visibility, linkedAuthors, ...overrideDetails(overridden) },
      });
      await auditTranslationChange(tx, req.user!, row.id, { title: null, venue: null });
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
    const { teamMemberIds, translations, confirmDuplicate, ...fields } = parseOrThrow(updatePublicationSchema, req.body);
    assertMayChangeVisibility(req.user!, fields.visibility);
    const touchesCompared = fields.title !== undefined || fields.year !== undefined || fields.doiUrl !== undefined;

    const updated = await prisma.$transaction(async (tx) => {
      if (touchesCompared) await lockForDuplicateCheck(tx, "publication");
      const existing = await tx.publication.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");
      // A page range is checked against the STORED page when the request changes only one end of it.
      const rangeProblem = pageRangeProblem(fields.startPage ?? existing.startPage, fields.endPage ?? existing.endPage);
      if (rangeProblem) throw new HttpError(400, rangeProblem);
      // Only an edit that changes the title, year or DOI is compared; the record itself is excluded, and an existing duplicate never
      // blocks an unrelated edit.
      const overridden = touchesCompared
        ? await guardPublication(tx, req.user!, {
            next: { title: fields.title ?? existing.title, year: fields.year ?? existing.year, doiUrl: fields.doiUrl ?? existing.doiUrl },
            previous: { title: existing.title, year: existing.year, doiUrl: existing.doiUrl },
            excludeId: existing.id,
            confirm: confirmDuplicate,
          })
        : null;

      const before = translations?.ja ? await getEntityTranslations(tx, "PUBLICATION", existing.id) : null;
      const row = await tx.publication.update({ where: { id: existing.id }, data: fields });
      await applyTranslationOverrides(tx, "PUBLICATION", row.id, translations?.ja);
      if (before) await auditTranslationChange(tx, req.user!, row.id, before);
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
          details: { title: row.title, changed, ...overrideDetails(overridden) },
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
      await tx.translation.deleteMany({ where: { entityType: "PUBLICATION", entityId: existing.id } });
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

// Lock contention on the duplicate-check write lock (lib/duplicates.ts) answers 503 + Retry-After instead of a generic 500.
router.use(transientContentionAs503);

export default router;
