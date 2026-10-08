import type { RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";

/**
 * Deploy-order safety net for the Phase 27 migration.
 *
 * The Phase 27 code reads columns/tables that exist only after migration `20261008090552_phase27_integrations`.
 * Running it against a database that has not had that migration (for example a Vercel Preview that shares the
 * production database before the migration was approved and applied) would fail on many routes with opaque
 * "no such column" 500s. Making every query tolerate the old schema is not practical (Prisma selects all columns of
 * a model, and TeamMember is read in dozens of places), so instead this guard detects the situation and answers a
 * clear, secret-free 503 `DB_SCHEMA_BEHIND` for API routes, which is also easy to alert on. It NEVER changes the
 * database; applying the migration is a separate, explicitly approved step.
 *
 * Only a "no such column/table" error marks the schema as behind; any other probe failure (database unreachable,
 * timeout…) is "unknown" and requests proceed exactly as they did before this guard existed.
 */
export type SchemaStatus = "ok" | "behind" | "unknown";

/** Static probes (no user input). Each selects only what the Phase 27 code needs, so it fails iff that is missing. */
export const PHASE27_PROBES = [
  'SELECT "scholarUrl", "researchGateUrl", "orcid", "isPublished" FROM "TeamMember" LIMIT 1',
  'SELECT "id", "userId" FROM "OAuthIdentity" LIMIT 1',
  'SELECT "id", "status" FROM "PublicationCandidate" LIMIT 1',
  'SELECT "candidateId", "teamMemberId" FROM "PublicationCandidateResearcher" LIMIT 1',
  'SELECT "name" FROM "SyncState" LIMIT 1',
] as const;

const MISSING = /no such (column|table)/i;

export async function checkSchema(db: Pick<PrismaClient, "$queryRawUnsafe">): Promise<SchemaStatus> {
  for (const sql of PHASE27_PROBES) {
    try {
      await db.$queryRawUnsafe(sql);
    } catch (err) {
      return MISSING.test(String((err as Error)?.message ?? err)) ? "behind" : "unknown";
    }
  }
  return "ok";
}

export const BEHIND_RECHECK_MS = 30_000;
const BEHIND_BODY = {
  error: "The database has not been updated for this version of the site yet. Please try again later.",
  code: "DB_SCHEMA_BEHIND",
};

/** Express middleware; `check` is injectable for tests. A positive result is cached for the life of the instance. */
export function requireCurrentSchema(db: Pick<PrismaClient, "$queryRawUnsafe">, check: typeof checkSchema = checkSchema): RequestHandler {
  let okForever = false;
  let behindUntil = 0;
  let inflight: Promise<SchemaStatus> | null = null;

  return async (req, res, next) => {
    if (okForever || req.path === "/health" || req.path === "/api/health") return next();
    const now = Date.now();
    if (now < behindUntil) {
      res.status(503).json(BEHIND_BODY);
      return;
    }
    inflight ??= check(db).finally(() => {
      inflight = null;
    });
    const status = await inflight;
    if (status === "ok") okForever = true;
    if (status === "behind") {
      behindUntil = Date.now() + BEHIND_RECHECK_MS;
      console.error("[schema] DB_SCHEMA_BEHIND: the database lacks the Phase 27 migration (20261008090552_phase27_integrations); it must be applied by an authorized operator.");
      res.status(503).json(BEHIND_BODY);
      return;
    }
    next();
  };
}
