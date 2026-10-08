import express from "express";
import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { createSessionMiddleware } from "./lib/session.js";
import { ValidationError, HttpError } from "./lib/validate.js";
import { multerErrorMessage } from "./lib/fileService.js";
import { StorageUnavailableError } from "./lib/storage.js";
import { resolveTrustProxy } from "./lib/trustProxy.js";
import { securityHeaders } from "./lib/security.js";
import { requireCurrentSchema } from "./lib/schemaGuard.js";
import { prisma } from "./lib/prisma.js";
import apiRoutes from "./routes/index.js";
import sitemapRoutes from "./routes/sitemap.routes.js";

// Explicit, documented JSON body cap (Phase 26). This is Express's own long-standing default —
// unchanged in behavior — made explicit rather than an implicit library default, and named so a
// future change is a deliberate one-line edit instead of a rediscovery of what "the default" is.
const JSON_BODY_LIMIT = "100kb";

export function createApp() {
  const app = express();
  const isProduction = process.env.NODE_ENV === "production";

  // Explicit, environment-driven client-IP trust policy (Phase 26 — see lib/trustProxy.ts for the
  // full rationale). Replaces a previously hard-coded `trust proxy: 1`, which was safe only for
  // one specific, undocumented deployment topology and silently wrong for any other.
  app.set("trust proxy", resolveTrustProxy());
  app.use(securityHeaders(isProduction));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(createSessionMiddleware());

  app.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ status: "ok" });
  });

  // robots.txt / sitemap.xml (Phase 26 §14): served at the root, not under /api, because search
  // engines fetch them from the document root by convention. See routes/sitemap.routes.ts and the
  // deployment topology note there for what a reverse proxy needs to route here.
  // Phase 27 deploy-order guard: a clear 503 (never a write) while the database lacks the Phase 27 migration.
  const schemaGuard = requireCurrentSchema(prisma);
  app.use(["/api", "/sitemap.xml"], schemaGuard);
  app.use(sitemapRoutes);

  app.use("/api", (_req, res, next) => {
    // Default for every API response: never cache a JSON API response by default. Any route that
    // legitimately wants caching (e.g. GET /api/files/:id for a PUBLIC file) sets its own
    // Cache-Control later in its handler, which overrides this.
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", apiRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ValidationError || err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // Body-parser failures (malformed JSON, oversized body) are client errors, not server errors.
    const bodyErr = err as { type?: string; status?: number } | null;
    if (bodyErr?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body is not valid JSON." });
      return;
    }
    if (bodyErr?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large." });
      return;
    }
    // A malformed/oversized multipart upload (Phase 13): never expose multer's internal message.
    const multerMessage = multerErrorMessage(err);
    if (multerMessage) {
      res.status(multerMessage === "File is too large." ? 413 : 400).json({ error: multerMessage });
      return;
    }
    // Upload storage not configured / refusing writes: a classified 503 with a safe, actionable
    // message (never the provider's own text), logged with only the sanitized detail.
    if (err instanceof StorageUnavailableError) {
      console.error(`[storage] ${err.code}: ${err.detail}`);
      res.status(503).json({ error: err.message, code: err.code });
      return;
    }
    // Rows removed/created concurrently between our check and the write.
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (err.code === "P2003") {
        res.status(400).json({ error: "A referenced record does not exist." });
        return;
      }
      if (err.code === "P2002") {
        res.status(409).json({ error: "That record already exists." });
        return;
      }
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(errorHandler);

  return app;
}
