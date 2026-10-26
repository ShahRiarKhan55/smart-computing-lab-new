import { Router } from "express";
import { ALUMNI_CATEGORY } from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { optionalAuth } from "../middleware/auth.js";
import { toTeamMember } from "../lib/serializers.js";
import { publishedMemberWhere } from "../lib/memberVisibility.js";
import { loadTranslations, localize, resolveLocale } from "../lib/translations.js";

const router = Router();

// GET /api/alumni -> the alumni directory (public). Visitors, members and lab managers get the PUBLISHED alumni only; an administrator
// also gets the unpublished ones, each carrying `isPublished` (lib/memberVisibility.ts). `userId` is never part of the response, and an
// alumni profile never has an account anyway.
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const locale = resolveLocale(req);
    const rows = await prisma.teamMember.findMany({
      where: { category: ALUMNI_CATEGORY, ...publishedMemberWhere(viewer) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    });
    const translations = await loadTranslations(prisma, "TEAM_MEMBER", rows.map((r) => r.id), locale);
    res.json(rows.map((r) => toTeamMember(localize(r, "TEAM_MEMBER", translations), viewer)));
  }),
);

export default router;
