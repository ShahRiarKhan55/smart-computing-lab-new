import type { Prisma, PrismaClient } from "@prisma/client";
import { doiFromUrl, doiKey } from "@scl/shared";
import { fetchOrcidWorks } from "./orcid.js";
import { lookupDoi } from "./crossref.js";
import { ProviderError } from "./http.js";
import type { PublicationSyncConfig } from "./config.js";
import type { DiscoveredWork } from "./types.js";

type Db = PrismaClient | Prisma.TransactionClient;

export const SYNC_NAME = "publication-sync";
const LOCK_TTL_MS = 10 * 60 * 1000;
/** Crossref lookups per run: enrichment is a convenience, never a reason to hammer the API. */
const MAX_ENRICHMENTS_PER_RUN = 60;

export interface SyncSummary {
  researchers: number;
  skipped: number;
  failed: { teamMemberId: string; code: string }[];
  discovered: number;
  created: number;
  duplicates: number;
  alreadyKnown: number;
  enriched: number;
}

export type SyncOutcome = { started: false; reason: "locked" } | { started: true; status: "OK" | "PARTIAL" | "FAILED"; summary: SyncSummary };

/** Takes the named lock with one conditional UPDATE (atomic in SQLite/libSQL). Returns false if another run holds it. */
export async function acquireSyncLock(db: Db, name: string, now = new Date(), ttlMs = LOCK_TTL_MS): Promise<boolean> {
  await db.syncState.upsert({ where: { name }, create: { name }, update: {} });
  const res = await db.syncState.updateMany({
    where: { name, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + ttlMs) },
  });
  return res.count === 1;
}

export async function releaseSyncLock(db: Db, name: string, status: string, summary: unknown): Promise<void> {
  await db.syncState.update({
    where: { name },
    data: { lockedUntil: null, lastRunAt: new Date(), lastStatus: status, lastSummary: JSON.stringify(summary).slice(0, 4000) },
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** doiKey -> publication id, for every stored publication that carries a DOI link. */
export async function existingDoiIndex(db: Db): Promise<Map<string, string>> {
  const rows = await db.publication.findMany({ where: { doiUrl: { not: "" } }, select: { id: true, doiUrl: true } });
  const index = new Map<string, string>();
  for (const r of rows) {
    const doi = doiFromUrl(r.doiUrl);
    if (doi) index.set(doiKey(doi)!, r.id);
  }
  return index;
}

export interface SyncOptions {
  /** Sync only this researcher (they must have an ORCID iD). */
  teamMemberId?: string;
  /** Stop starting new researchers after this long; the rest are reported as skipped (a later run picks them up). */
  budgetMs?: number;
  doFetch?: typeof fetch;
  includeAlumni?: boolean;
}

/**
 * Pulls each researcher's public ORCID works into the review queue.
 *
 * Guarantees (tested): idempotent (`(provider, externalId)` is unique and re-runs only touch `lastSeenAt`);
 * never publishes anything and never edits a Publication; never reopens a candidate an editor already
 * approved/rejected; a failing researcher is reported and the rest still run; one run at a time.
 */
export async function runPublicationSync(db: PrismaClient, cfg: PublicationSyncConfig, opts: SyncOptions = {}): Promise<SyncOutcome> {
  const doFetch = opts.doFetch ?? fetch;
  if (!(await acquireSyncLock(db, SYNC_NAME))) return { started: false, reason: "locked" };

  const summary: SyncSummary = { researchers: 0, skipped: 0, failed: [], discovered: 0, created: 0, duplicates: 0, alreadyKnown: 0, enriched: 0 };
  let status: "OK" | "PARTIAL" | "FAILED" = "OK";
  try {
    const researchers = await db.teamMember.findMany({
      where: {
        orcid: { not: "" },
        ...(opts.teamMemberId ? { id: opts.teamMemberId } : {}),
        ...(opts.includeAlumni || opts.teamMemberId ? {} : { NOT: { category: "ALUMNI" } }),
      },
      select: { id: true, orcid: true },
      orderBy: { id: "asc" },
    });

    const doiIndex = await existingDoiIndex(db);
    const started = Date.now();
    let enrichmentsLeft = MAX_ENRICHMENTS_PER_RUN;

    for (let i = 0; i < researchers.length; i++) {
      const r = researchers[i];
      if (opts.budgetMs !== undefined && Date.now() - started > opts.budgetMs) {
        summary.skipped = researchers.length - i;
        break;
      }
      if (i > 0 && cfg.delayBetweenResearchersMs > 0) await sleep(cfg.delayBetweenResearchersMs);
      summary.researchers += 1;
      let works: DiscoveredWork[];
      try {
        works = await fetchOrcidWorks(cfg, r.orcid, doFetch);
      } catch (e) {
        summary.failed.push({ teamMemberId: r.id, code: e instanceof ProviderError ? e.code : "unexpected" });
        continue;
      }
      summary.discovered += works.length;
      for (const w of works) {
        const out = await recordCandidate(db, cfg, doFetch, doiIndex, r.id, w, enrichmentsLeft > 0);
        if (out.enriched) {
          enrichmentsLeft -= 1;
          summary.enriched += 1;
        }
        if (out.kind === "created") summary.created += 1;
        else if (out.kind === "duplicate") summary.duplicates += 1;
        else summary.alreadyKnown += 1;
      }
    }
    if (summary.failed.length > 0 || summary.skipped > 0) status = summary.failed.length >= summary.researchers && summary.researchers > 0 ? "FAILED" : "PARTIAL";
    return { started: true, status, summary };
  } catch (e) {
    status = "FAILED";
    throw e;
  } finally {
    await releaseSyncLock(db, SYNC_NAME, status, summary).catch(() => undefined);
  }
}

async function recordCandidate(
  db: PrismaClient,
  cfg: PublicationSyncConfig,
  doFetch: typeof fetch,
  doiIndex: Map<string, string>,
  teamMemberId: string,
  w: DiscoveredWork,
  mayEnrich: boolean,
): Promise<{ kind: "created" | "duplicate" | "known"; enriched: boolean }> {
  const key = { provider_externalId: { provider: w.provider, externalId: w.externalId } };
  const existing = await db.publicationCandidate.findUnique({ where: key, select: { id: true, status: true, doi: true } });
  const link = (candidateId: string) =>
    db.publicationCandidateResearcher.upsert({
      where: { candidateId_teamMemberId: { candidateId, teamMemberId } },
      create: { candidateId, teamMemberId },
      update: {},
    });

  if (existing) {
    // Only the "last seen" stamp moves. Title/authors/status an editor may have touched are never rewritten.
    const matched = existing.status === "PENDING" && existing.doi ? doiIndex.get(existing.doi) : undefined;
    await db.publicationCandidate.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date(), ...(matched ? { status: "DUPLICATE", publicationId: matched } : {}) },
    });
    await link(existing.id);
    return { kind: matched ? "duplicate" : "known", enriched: false };
  }

  const matchedPublication = w.doi ? doiIndex.get(w.doi) : undefined;
  let authors = w.authors;
  let enriched = false;
  if (!matchedPublication && w.doi && mayEnrich) {
    try {
      const meta = await lookupDoi(cfg, w.doi, doFetch);
      authors = meta.authors || authors;
      enriched = true;
    } catch {
      /* enrichment is best-effort; the editor can type the authors at approval */
    }
  }
  try {
    const created = await db.publicationCandidate.create({
      data: {
        provider: w.provider,
        externalId: w.externalId,
        doi: w.doi,
        title: w.title,
        authors,
        year: w.year,
        venue: w.venue,
        url: w.url,
        workType: w.workType,
        status: matchedPublication ? "DUPLICATE" : "PENDING",
        publicationId: matchedPublication ?? null,
      },
    });
    await link(created.id);
    return { kind: matchedPublication ? "duplicate" : "created", enriched };
  } catch (e) {
    // A concurrent run created the same candidate between our read and write: treat as already known.
    if ((e as { code?: string }).code === "P2002") {
      const again = await db.publicationCandidate.findUnique({ where: key, select: { id: true } });
      if (again) await link(again.id);
      return { kind: "known", enriched };
    }
    throw e;
  }
}
