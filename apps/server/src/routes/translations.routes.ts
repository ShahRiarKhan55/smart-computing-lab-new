import { Router } from "express";
import { ID_PATTERN, isTranslatableEntityType } from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../lib/validate.js";
import { getEntityBase, getEntityTranslations } from "../lib/translations.js";

const router = Router();

/**
 * GET /api/translations/:entityType/:entityId -> the current Japanese override for each
 * allow-listed field of this entity (`null` where none exists), for prefilling an edit form's
 * "Japanese translation" section.
 *
 * Any logged-in account may read this: it is exactly the text a Japanese-locale visitor already
 * sees via the entity's own GET once published, never a privileged value, and every translatable
 * entity type here is either PUBLIC or LAB_ONLY — `requireAuth` already grants LAB_ONLY-level
 * access, so this adds no visibility beyond what the entity's own endpoint already allows. Writing
 * happens only through that entity's own PUT alongside its other fields, so it is authorised
 * exactly like every other field on that entity — this route never accepts a write.
 */
router.get(
  "/:entityType/:entityId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { entityType, entityId } = req.params;
    if (!isTranslatableEntityType(entityType)) throw new HttpError(404, "Not found");
    if (!ID_PATTERN.test(entityId)) throw new HttpError(400, "Invalid id.");
    res.json({ ja: await getEntityTranslations(prisma, entityType, entityId), base: await getEntityBase(prisma, entityType, entityId) });
  }),
);

export default router;
