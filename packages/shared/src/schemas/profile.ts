import { z } from "zod";
import { teamMemberFields } from "./team.js";

/**
 * The fields a member may change on their own profile. Category, sort order
 * and the account link stay admin-controlled, so they are deliberately absent
 * (unknown keys are stripped, never written).
 */
export const updateOwnProfileSchema = z
  .object({
    name: teamMemberFields.name.optional(),
    initials: teamMemberFields.initials.optional(),
    role: teamMemberFields.role.optional(),
    department: teamMemberFields.department.optional(),
    bio: teamMemberFields.bio.optional(),
    photoUrl: teamMemberFields.photoUrl.optional(),
    scholarUrl: teamMemberFields.scholarUrl.optional(),
    researchGateUrl: teamMemberFields.researchGateUrl.optional(),
    orcid: teamMemberFields.orcid.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");
export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;
