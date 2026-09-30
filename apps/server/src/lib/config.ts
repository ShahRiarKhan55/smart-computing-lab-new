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
 * Required — the database connection, in ONE of two shapes (validated here; see lib/prisma.ts,
 * which picks the same way, for the actual client construction):
 * - `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` — the Vercel/Turso production topology (Vercel
 *   deployment adapter). Both must be present together; one without the other is a
 *   misconfiguration, not a fallback.
 * - `DATABASE_URL` alone — a plain SQLite file connection string, for a production deployment
 *   that is not on Vercel (e.g. the earlier VPS topology) and still opens a local file directly.
 *
 * Also required:
 * - `SESSION_SECRET` — session-signing secret (validated in lib/session.ts).
 * - `TRUST_PROXY` — reverse-proxy trust policy: `0` (no proxy) or `1` (exactly one trusted hop —
 *   this is Vercel's own edge network, so `TRUST_PROXY=1` is the value for the Vercel topology)
 *   are the two topologies this app's tests certify (validated in lib/trustProxy.ts).
 *
 * Optional (safe defaults documented in .env.example):
 * - `PORT` (default 4000; unused on Vercel, which does not let the app choose its own port),
 *   `STORAGE_DIR` (local-filesystem storage; unused when `BLOB_READ_WRITE_TOKEN` is set — see
 *   lib/storage.ts), `MAX_IMAGE_BYTES`, `MAX_DOCUMENT_BYTES`, `PUBLIC_BASE_URL` (enables
 *   `/sitemap.xml`; `/robots.txt` works without it).
 */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;

  const tursoUrl = env.TURSO_DATABASE_URL?.trim();
  const tursoToken = env.TURSO_AUTH_TOKEN?.trim();
  if (tursoUrl || tursoToken) {
    if (!tursoUrl || !tursoToken) {
      throw new Error(
        "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must both be set together in production — " +
          "refusing to start with only one of the two Turso connection values present (see " +
          ".env.example).",
      );
    }
    return;
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "A database connection is required in production — set either TURSO_DATABASE_URL + " +
        "TURSO_AUTH_TOKEN (Vercel/Turso) or DATABASE_URL (a plain SQLite file) — refusing to " +
        "start without one (see .env.example).",
    );
  }
}
