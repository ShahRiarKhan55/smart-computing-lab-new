import { Router } from "express";
import { searchQuerySchema } from "@scl/shared";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow } from "../lib/validate.js";
import { optionalAuth } from "../middleware/auth.js";
import { runSearch } from "../lib/search.js";
import { resolveLocale } from "../lib/translations.js";

const router = Router();

// GET /api/search?q=&type=&page=&limit= -> public. The viewer comes ONLY from the session:
// no role, visibility or user id is ever read from the request, and unknown parameters are ignored.
// Validation failures are 400s through the shared error handler; a database error is a generic 500.
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const query = parseOrThrow(searchQuerySchema, req.query);
    res.json(await runSearch(req.user ?? null, query, resolveLocale(req)));
  }),
);

export default router;
