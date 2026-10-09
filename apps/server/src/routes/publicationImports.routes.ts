import { P27_MESSAGES } from "@scl/shared";
import { Router } from "express";
import {
  approveCandidateSchema,
  canReviewPublicationImports,
  doiKey,
  doiLookupQuerySchema,
  doiToUrl,
  publicationImportQuerySchema,
  publicationSyncBodySchema,
  type DoiLookupResult,
  type PublicationCandidate,
  type PublicationImportList,
  type PublicationSyncResult,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { HttpError, parseOrThrow } from "../lib/validate.js";
import { requireAuth, requireCan } from "../middleware/auth.js";
import { assertValidId } from "../lib/authorLinks.js";
import { recordAudit } from "../lib/audit.js";
import { getPublicationSyncConfig } from "../lib/publications/config.js";
import { lookupDoi } from "../lib/publications/crossref.js";
import { ProviderError } from "../lib/publications/http.js";
import { SYNC_NAME, existingDoiIndex, runPublicationSync } from "../lib/publications/sync.js";
import { allowDoiLookup, getCachedLookup, setCachedLookup } from "../lib/publications/lookupGuard.js";

const router = Router();

const normTitle = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// GET /api/publication-imports/lookup?doi= -> suggested fields from Crossref. Any logged-in user (it only
// helps fill their own form); nothing is saved. Rate-limited per user and cached briefly. Registered before /:id.
router.get(
  "/lookup",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { doi } = parseOrThrow(doiLookupQuerySchema, req.query);
    const key = doiKey(doi)!;
    const cached = getCachedLookup<DoiLookupResult>(key);
    if (cached) return void res.json(cached);
    if (!allowDoiLookup(req.user!.id)) throw new HttpError(429, P27_MESSAGES.doiLookupLimit);
    try {
      const meta = await lookupDoi(getPublicationSyncConfig(), doi);
      const body: DoiLookupResult = { doi: meta.doi, title: meta.title, authors: meta.authors, year: meta.year, venue: meta.venue, doiUrl: doiToUrl(meta.doi) };
      setCachedLookup(key, body);
      res.json(body);
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      if (e.code === "not_found") throw new HttpError(404, P27_MESSAGES.doiLookupNotFound);
      throw new HttpError(502, P27_MESSAGES.doiLookupUnavailable);
    }
  }),
);

function toCandidate(
  row: {
    id: string; provider: string; doi: string; title: string; authors: string; year: number; venue: string; url: string; workType: string;
    status: string; publicationId: string | null; firstSeenAt: Date; lastSeenAt: Date; researchers: { teamMemberId: string }[];
  },
  titleIndex: Map<string, string>,
): PublicationCandidate {
  return {
    id: row.id,
    provider: row.provider,
    doi: row.doi,
    title: row.title,
    authors: row.authors,
    year: row.year,
    venue: row.venue,
    url: row.url,
    workType: row.workType,
    status: row.status as PublicationCandidate["status"],
    publicationId: row.publicationId,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    researcherIds: row.researchers.map((r) => r.teamMemberId).sort(),
    possibleDuplicateId: row.status === "PENDING" ? (titleIndex.get(`${row.year}|${normTitle(row.title)}`) ?? null) : null,
  };
}

// GET /api/publication-imports?status=PENDING -> the review queue (managers/admins)
router.get(
  "/",
  requireCan(canReviewPublicationImports),
  asyncHandler(async (req, res) => {
    const { status } = parseOrThrow(publicationImportQuerySchema, req.query);
    const [rows, pubs, state, orcidResearchers] = await Promise.all([
      prisma.publicationCandidate.findMany({
        where: { status },
        include: { researchers: { select: { teamMemberId: true } } },
        orderBy: [{ year: "desc" }, { title: "asc" }, { id: "asc" }],
        take: 500,
      }),
      prisma.publication.findMany({ select: { id: true, title: true, year: true } }),
      prisma.syncState.findUnique({ where: { name: SYNC_NAME } }),
      prisma.teamMember.count({ where: { orcid: { not: "" }, NOT: { category: "ALUMNI" } } }),
    ]);
    const titleIndex = new Map(pubs.map((p) => [`${p.year}|${normTitle(p.title)}`, p.id]));
    let lastSummary: unknown = null;
    try {
      lastSummary = state?.lastSummary ? JSON.parse(state.lastSummary) : null;
    } catch {
      lastSummary = null;
    }
    const body: PublicationImportList = {
      items: rows.map((r) => toCandidate(r, titleIndex)),
      sync: { lastRunAt: state?.lastRunAt?.toISOString() ?? null, lastStatus: state?.lastStatus ?? "", lastSummary, orcidResearchers },
    };
    res.json(body);
  }),
);

// POST /api/publication-imports/sync { teamMemberId? } -> fetch public ORCID works into the queue (nothing becomes public)
router.post(
  "/sync",
  requireCan(canReviewPublicationImports),
  asyncHandler(async (req, res) => {
    const { teamMemberId } = parseOrThrow(publicationSyncBodySchema, req.body ?? {});
    if (teamMemberId) assertValidId(teamMemberId);
    const cfg = getPublicationSyncConfig();
    const outcome = await runPublicationSync(prisma, cfg, { teamMemberId, budgetMs: Number(process.env.PUBLICATION_SYNC_BUDGET_MS) > 0 ? Number(process.env.PUBLICATION_SYNC_BUDGET_MS) : 20_000 });
    if (!outcome.started) throw new HttpError(409, P27_MESSAGES.importSyncRunning);
    await recordAudit(prisma, {
      actor: req.user!,
      action: "PUBLICATION_SYNC_RUN",
      entityType: "PUBLICATION_SYNC",
      details: {
        status: outcome.status,
        researchers: outcome.summary.researchers,
        failed: outcome.summary.failed.length,
        created: outcome.summary.created,
        duplicates: outcome.summary.duplicates,
      },
    });
    const body: PublicationSyncResult = { started: true, status: outcome.status, summary: outcome.summary };
    res.json(body);
  }),
);

// POST /api/publication-imports/:id/approve -> create the real (public by default) publication from a PENDING candidate
router.post(
  "/:id/approve",
  requireCan(canReviewPublicationImports),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const input = parseOrThrow(approveCandidateSchema, req.body ?? {});
    const created = await prisma.$transaction(async (tx) => {
      const candidate = await tx.publicationCandidate.findUnique({ where: { id: req.params.id }, include: { researchers: { select: { teamMemberId: true } } } });
      if (!candidate) throw new HttpError(404, "Not found");
      if (candidate.status !== "PENDING") throw new HttpError(409, P27_MESSAGES.importAlreadyReviewed);

      if (candidate.doi) {
        const dupe = (await existingDoiIndex(tx)).get(candidate.doi);
        if (dupe) {
          // Committed (not thrown inside the transaction, which would roll the marking back); the 409 is raised below.
          await tx.publicationCandidate.update({ where: { id: candidate.id }, data: { status: "DUPLICATE", publicationId: dupe } });
          return null;
        }
      }
      const authors = input.authors ?? candidate.authors;
      const venue = input.venue ?? candidate.venue;
      if (!authors.trim()) throw new HttpError(400, P27_MESSAGES.importAuthorsRequired);
      if (!venue.trim()) throw new HttpError(400, P27_MESSAGES.importVenueRequired);

      // Claim first (conditional on still being PENDING) so two editors approving at once cannot both create a record.
      const claim = await tx.publicationCandidate.updateMany({
        where: { id: candidate.id, status: "PENDING" },
        data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: req.user!.id },
      });
      if (claim.count !== 1) throw new HttpError(409, P27_MESSAGES.importAlreadyReviewed);

      const pub = await tx.publication.create({
        data: {
          year: input.year ?? candidate.year,
          title: input.title ?? candidate.title,
          authors,
          venue,
          doiUrl: candidate.doi ? doiToUrl(candidate.doi) : "",
          extraUrl: candidate.doi ? "" : candidate.url,
          extraLabel: candidate.doi || !candidate.url ? "" : "Source",
          visibility: input.visibility ?? "PUBLIC",
        },
      });
      const wanted = input.teamMemberIds ?? candidate.researchers.map((r) => r.teamMemberId);
      const members = wanted.length ? await tx.teamMember.findMany({ where: { id: { in: wanted } }, select: { id: true } }) : [];
      if (input.teamMemberIds && members.length !== new Set(wanted).size) throw new HttpError(400, P27_MESSAGES.importAuthorMissing);
      if (members.length) await tx.publicationAuthor.createMany({ data: members.map((m) => ({ publicationId: pub.id, teamMemberId: m.id })) });
      await tx.publicationCandidate.update({ where: { id: candidate.id }, data: { publicationId: pub.id } });
      await recordAudit(tx, {
        actor: req.user!,
        action: "PUBLICATION_IMPORT_APPROVED",
        entityType: "PUBLICATION_CANDIDATE",
        entityId: candidate.id,
        details: { publicationId: pub.id, provider: candidate.provider, linkedAuthors: members.length },
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "PUBLICATION_CREATED",
        entityType: "PUBLICATION",
        entityId: pub.id,
        details: { title: pub.title, year: pub.year, visibility: pub.visibility, linkedAuthors: members.length, source: "import" },
      });
      return pub;
    });
    if (!created) throw new HttpError(409, P27_MESSAGES.importDuplicateDoi);
    res.status(201).json({ publicationId: created.id });
  }),
);

// POST /api/publication-imports/:id/reject -> keep the candidate (so a re-sync never re-proposes it) but never publish it
router.post(
  "/:id/reject",
  requireCan(canReviewPublicationImports),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const claim = await tx.publicationCandidate.updateMany({
        where: { id: req.params.id, status: "PENDING" },
        data: { status: "REJECTED", reviewedAt: new Date(), reviewedById: req.user!.id },
      });
      if (claim.count !== 1) {
        const exists = await tx.publicationCandidate.findUnique({ where: { id: req.params.id }, select: { id: true } });
        throw new HttpError(exists ? 409 : 404, exists ? P27_MESSAGES.importAlreadyReviewed : "Not found");
      }
      await recordAudit(tx, { actor: req.user!, action: "PUBLICATION_IMPORT_REJECTED", entityType: "PUBLICATION_CANDIDATE", entityId: req.params.id });
    });
    res.json({ success: true });
  }),
);

export default router;
