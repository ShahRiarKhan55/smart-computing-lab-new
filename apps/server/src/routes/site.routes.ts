import { Router } from "express";
import type { SiteConfig } from "@scl/shared";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow } from "../lib/validate.js";
import { optionalAuth } from "../middleware/auth.js";
import { getFacebookPageUrl, getPortalUrl, warnIfFacebookPageUrlInvalid } from "../lib/siteConfig.js";
import { listUpdates } from "../lib/updates/index.js";
import { resolveLocale } from "../lib/translations.js";

const router = Router();

// Once per process start (module load), like the Google sign-in notice: an invalid optional setting is reported, never fatal.
warnIfFacebookPageUrlInvalid();

const updatesQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).optional().default(6) });

// GET /api/site-config -> public, non-secret settings (the Google Sites portal link and the official Facebook Page link, when configured)
router.get("/site-config", (_req, res) => {
  const body: SiteConfig = { portalUrl: getPortalUrl(), facebookPageUrl: getFacebookPageUrl() };
  res.set("Cache-Control", "public, max-age=300");
  res.json(body);
});

// GET /api/updates?limit= -> homepage updates from every configured source, newest first, visibility-filtered
router.get(
  "/updates",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { limit } = parseOrThrow(updatesQuery, req.query);
    res.json(await listUpdates(req.user ?? null, resolveLocale(req), limit));
  }),
);

export default router;
