/**
 * Production startup configuration check (Phase 26 hardening).
 *
 * This app deliberately validates each environment value next to the code that actually uses it
 * (`SESSION_SECRET` in lib/session.ts, `TRUST_PROXY` in lib/trustProxy.ts, `STORAGE_DIR` in
 * lib/storage.ts) rather than a single monolithic config object every module has to import — that
 * pattern was already working before this phase and nothing here replaces it.
 *
 * What was genuinely missing: `DATABASE_URL` had NO explicit check at all. `PrismaClient`'s
 * constructor does not connect eagerly, so an unset/empty `DATABASE_URL` in production would not
 * fail until the first request that touches the database — a confusing, delayed failure instead
 * of a clear one at boot. This module exists only to close that one gap, and to be the single
 * place `index.ts` calls before anything else starts, so a production misconfiguration is
 * reported once, clearly, before the process ever binds a port — not discovered request-by-request.
 *
 * `SESSION_SECRET`/`TRUST_PROXY` are NOT re-validated here: `createSessionMiddleware()` and
 * `resolveTrustProxy()` (both called from `createApp()`, immediately after this) already fail
 * fast for those with their own specific, tested error messages — duplicating that logic here
 * would just be a second place for the two checks to disagree.
 *
 * ## Production environment variables (see .env.example for the full list with defaults)
 *
 * Required:
 * - `DATABASE_URL` — SQLite connection string (validated here).
 * - `SESSION_SECRET` — session-signing secret (validated in lib/session.ts).
 * - `TRUST_PROXY` — reverse-proxy trust policy: `0` (no proxy) or `1` (exactly one trusted hop)
 *   are the two topologies this app's tests certify (validated in lib/trustProxy.ts).
 *
 * Optional (safe defaults documented in .env.example):
 * - `PORT` (default 4000), `STORAGE_DIR`, `MAX_IMAGE_BYTES`, `MAX_DOCUMENT_BYTES`,
 *   `PUBLIC_BASE_URL` (enables `/sitemap.xml`; `/robots.txt` works without it).
 */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL must be set in production — refusing to start without a database connection " +
        "string (see .env.example).",
    );
  }
}
