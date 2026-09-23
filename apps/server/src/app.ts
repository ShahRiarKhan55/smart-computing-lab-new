import express from "express";
import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { createSessionMiddleware } from "./lib/session.js";
import { ValidationError, HttpError } from "./lib/validate.js";
import { multerErrorMessage } from "./lib/fileService.js";
import apiRoutes from "./routes/index.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(createSessionMiddleware());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
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
