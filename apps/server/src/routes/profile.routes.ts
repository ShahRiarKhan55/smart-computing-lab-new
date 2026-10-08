import { Router } from "express";
import { updateOwnProfileSchema } from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { changedFields, recordAudit } from "../lib/audit.js";
import { toTeamMember } from "../lib/serializers.js";
import { retireProfilePhotos } from "../lib/profilePhoto.js";
import { removeFile } from "../lib/storage.js";

const router = Router();

router.use(requireAuth);

const AUDITED_FIELDS = ["name", "initials", "role", "department", "bio", "photoUrl", "scholarUrl", "researchGateUrl", "orcid"] as const;

// GET /api/profile -> the logged-in user's own team profile
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const member = await prisma.teamMember.findUnique({ where: { userId: req.user!.id } });
    if (!member) {
      throw new HttpError(404, "No team profile is linked to your account yet. Ask the admin to link one.");
    }
    res.json(toTeamMember(member, req.user!));
  }),
);

// PUT /api/profile -> update own profile (name/role/dept/bio/photo only;
// category & sortOrder stay under manager control, same as PUT /api/team/:id)
router.put(
  "/",
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(updateOwnProfileSchema, req.body);

    let retiredKeys: string[] = [];
    const updated = await prisma.$transaction(async (tx) => {
      const member = await tx.teamMember.findUnique({ where: { userId: req.user!.id } });
      if (!member) {
        throw new HttpError(404, "No team profile is linked to your account yet. Ask the admin to link one.");
      }
      const data = {
        name: body.name ?? member.name,
        initials: body.initials ?? member.initials,
        role: body.role ?? member.role,
        department: body.department ?? member.department,
        bio: body.bio ?? member.bio,
        photoUrl: body.photoUrl ?? member.photoUrl,
        scholarUrl: body.scholarUrl ?? member.scholarUrl,
        researchGateUrl: body.researchGateUrl ?? member.researchGateUrl,
        orcid: body.orcid ?? member.orcid,
      };
      const row = await tx.teamMember.update({ where: { id: member.id }, data });
      if (body.photoUrl !== undefined && body.photoUrl !== member.photoUrl) {
        retiredKeys = await retireProfilePhotos(tx, member.id, /^\/api\/files\/([A-Za-z0-9_-]{1,64})$/.exec(body.photoUrl)?.[1]);
      }
      const changed = changedFields(member, data, [...AUDITED_FIELDS]);
      if (changed) {
        await recordAudit(tx, {
          actor: req.user!,
          action: "TEAM_MEMBER_UPDATED",
          entityType: "TEAM_MEMBER",
          entityId: row.id,
          details: { name: row.name, changed, own: true },
        });
      }
      return row;
    });

    await Promise.all(retiredKeys.map((k) => removeFile(k).catch((err) => console.error(`[profile] failed to remove replaced photo blob ${k}:`, err))));
    res.json(toTeamMember(updated, req.user!));
  }),
);

export default router;
