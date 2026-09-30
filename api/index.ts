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
 */
assertProductionConfig();

export default createApp();
