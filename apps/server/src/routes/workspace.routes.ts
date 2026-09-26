import { Router } from "express";
import { canViewWorkspace } from "@scl/shared";
import { asyncHandler } from "../lib/asyncHandler.js";
import { requireCan } from "../middleware/auth.js";
import { resolveLocale } from "../lib/translations.js";
import { loadWorkspace } from "../lib/workspace.js";

const router = Router();

// GET /api/workspace -> the signed-in researcher's OWN collaboration workspace (Phase 21).
// Nothing in the request selects whose workspace it is: the researcher is the team profile linked to the
// session's account. Read-only, so it writes no audit row; private (per-account) and never cacheable.
router.get(
  "/",
  requireCan(canViewWorkspace),
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await loadWorkspace(req.user!, resolveLocale(req)));
  }),
);

export default router;
