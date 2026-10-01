import path from "node:path";
import { assertProductionConfig } from "../apps/server/src/lib/config.js";
import { createApp } from "../apps/server/src/app.js";

/**
 * Vercel serverless function entry point (Vercel deployment adapter).
 *
 * This file exists ONLY to expose the existing Express app to Vercel's Node.js function runtime —
 * it contains no application logic of its own. `createApp()` (apps/server/src/app.ts) is the same
 * function `apps/server/src/index.ts` already calls for local development; every middleware and
 * all 22 route modules are wired up exactly once, here as everywhere else.
 *
 * Deliberately NOT here: `app.listen(...)` and the SIGTERM/SIGINT graceful-shutdown logic in
 * `apps/server/src/index.ts` — Vercel never calls `.listen()`; it imports this module's default
 * export and invokes it directly per-request, and there is no long-lived process for a shutdown
 * handler to run in. `apps/server/src/index.ts` is untouched and keeps working exactly as before
 * for local development (`npm run dev`) and any non-Vercel deployment.
 *
 * `assertProductionConfig()` runs here for the same reason it runs first in `index.ts`: a
 * misconfigured production deployment (missing TURSO_DATABASE_URL/TURSO_AUTH_TOKEN or
 * SESSION_SECRET or TRUST_PROXY) should fail loudly and immediately, not silently degrade into
 * guest-only sessions or a request-by-request database error. It runs once, at module load
 * (Vercel's "cold start"), not per-request.
 *
 * An Express app is itself a valid `(req, res) => void` request handler — Vercel's Node.js
 * runtime accepts a default-exported Express app directly, without any adapter/wrapper package
 * (confirmed against Vercel's own current official Express example, which uses this exact
 * pattern: a TypeScript file default-exporting the app instance, no `vercel.json`, no `api/`
 * wrapper of its own — this project adds an explicit `api/` location and an explicit
 * `vercel.json`, per docs/architecture/…-vercel-deployment-adapter.md, because it also needs
 * `/robots.txt`, `/sitemap.xml`, and the separately-built static SPA to coexist in one project,
 * which the zero-config single-purpose example does not need to handle).
 *
 * PRISMA NATIVE ENGINE PATH (found by reproducing the actual production crash locally — see
 * docs/architecture/…-vercel-deployment-adapter.md): Vercel bundles this whole file, including
 * `@prisma/client`, into one flat function artifact. `@prisma/client`'s own engine-locator code
 * finds its native query-engine binary (`libquery_engine-<target>.so.node`) by walking a
 * hardcoded number of directories up from its OWN source file's location — a path that only
 * makes sense in the normal, un-bundled `node_modules/@prisma/client/...` layout. Once bundled
 * into a single file living somewhere else entirely, that computed path no longer points at the
 * real file, and the very first Prisma query (the session middleware's own lookup, on every
 * request including `/api/health`) throws `PrismaClientInitializationError`. `vercel.json`'s
 * `functions["api/index.ts"].includeFiles` ships the binary alongside this function (preserving
 * its normal `node_modules/.prisma/client/...` path within the deployment), but that alone does
 * NOT fix the lookup — reproduced directly: even with the file physically present at that exact
 * path, none of the locations `@prisma/client`'s own broken relative search actually checks match
 * it. `PRISMA_QUERY_ENGINE_LIBRARY` is Prisma's own documented escape hatch for exactly this case
 * — an explicit absolute path that bypasses its own (broken-by-bundling) auto-detection entirely.
 * Computed from `process.cwd()` (Vercel always invokes a function with its working directory set
 * to the function's own root) rather than hardcoded, so this works regardless of the exact
 * absolute path Vercel happens to deploy to. Only ever runs here, in the Vercel-only entry point
 * — never during `npm install`/`prisma generate` (a separate, earlier build step that never
 * imports this file), so it cannot interfere with the client actually being generated. A
 * pre-existing value (e.g. set explicitly in the Vercel dashboard) is respected, not overridden.
 *
 * ENGINE TARGET — `rhel-openssl-3.0.x`, not `debian-openssl-3.0.x`: the path above being
 * physically present was *not* sufficient on its own (confirmed against a real Preview
 * deployment) — `debian-openssl-3.0.x` is only what `prisma generate` emits by default, because
 * Vercel's *build* container happens to be Debian-based; the deployed *Function* itself runs on
 * Amazon Linux, which Prisma's own documented AWS Lambda deployment target maps to
 * `rhel-openssl-3.0.x` (Node >18) — a different binary that is never generated at all unless
 * requested. `prisma/schema.prisma`'s `generator client` block now lists
 * `binaryTargets = ["native", "rhel-openssl-3.0.x"]` so `prisma generate` (via the existing
 * `postinstall`) emits both: `native` keeps matching whatever OS runs locally/in CI (unaffected,
 * since this block never runs outside Vercel), and `rhel-openssl-3.0.x` is the one this function
 * actually loads in production.
 */
if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(
    process.cwd(),
    "node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node",
  );
}

assertProductionConfig();

export default createApp();
