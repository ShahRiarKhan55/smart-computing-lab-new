import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";

/**
 * The single place `PrismaClient` is constructed (Vercel deployment adapter).
 *
 * Two topologies, selected by whether `TURSO_DATABASE_URL` is set:
 *
 * - **Unset (local development, tests, every existing regression script)**: constructs
 *   `PrismaClient` exactly as before this change — no adapter, reads the plain local SQLite file
 *   at `DATABASE_URL` (e.g. `file:./dev.db`, or a disposable test copy's `file:/tmp/....db`).
 *   Nothing about this path changed; the entire existing local/test workflow, and the ~100
 *   existing regression scripts that spin up their own disposable local SQLite copies, are
 *   unaffected.
 * - **Set (production on Vercel)**: constructs `PrismaClient` with a libSQL driver adapter
 *   (`@prisma/adapter-libsql` + `@libsql/client`) pointed at a hosted Turso database instead of a
 *   local file — the smallest available swap for "SQLite has no writable persistent disk on
 *   Vercel Functions" (see docs/architecture/…-vercel-deployment-adapter.md), since Turso/libSQL
 *   is wire-compatible with SQLite: the datasource `provider` in schema.prisma stays `"sqlite"`,
 *   and all four existing migrations apply unchanged.
 *
 * `TURSO_AUTH_TOKEN` is required alongside `TURSO_DATABASE_URL` — Turso's remote (`libsql://…`)
 * connections are authenticated; there is no local-file case that also needs a token, so this
 * module doesn't special-case "URL set but token missing" beyond letting `createClient` itself
 * fail loudly (a Turso connection attempt with no token fails on the first query, which surfaces
 * immediately in this app's own startup health check and every route's first request — a
 * misconfiguration is never silent).
 */
function createPrismaClient(): PrismaClient {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  if (!tursoUrl) {
    return new PrismaClient();
  }

  const libsql = createClient({
    url: tursoUrl,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const adapter = new PrismaLibSQL(libsql);
  return new PrismaClient({ adapter });
}

export const prisma = createPrismaClient();
