import { z } from "zod";
import { categorySchema } from "./enums.js";
import { isHttpUrl, optionalText, requiredText, sortOrderField } from "./common.js";
import { orcidField, researchGateUrlField, scholarUrlField } from "../profileLinks.js";
import { translationsField } from "./translations.js";

/** Mirrors the English field length below — see i18n/translatableFields.ts (TEAM_MEMBER). */
export const TEAM_MEMBER_TRANSLATION_MAX = { bio: 2000 };

export const teamMemberSchema = z.object({
  id: z.string(),
  /**
   * Computed by the server for the current viewer: true only when this profile is linked to
   * the logged-in account. It replaces the internal account id, which is never sent to clients.
   * UX only; every write is re-authorised on the server.
   */
  isOwn: z.boolean(),
  name: z.string(),
  initials: z.string(),
  role: z.string(),
  category: categorySchema,
  department: z.string(),
  bio: z.string(),
  photoUrl: z.string(),
  /** Optional profile links (Phase 27). "" = not set; the UI hides an absent link rather than showing a dead icon. */
  scholarUrl: z.string(),
  researchGateUrl: z.string(),
  /** Bare ORCID iD (0000-0002-1825-0097) or "". */
  orcid: z.string(),
  /** Sent only to lab managers/admins (who can change it); `false` hides the profile from everyone else. */
  isPublished: z.boolean().optional(),
  sortOrder: z.number(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

/** The managed path of an uploaded profile photo (see routes/team.routes.ts `POST /:id/photo`). */
const PROFILE_PHOTO_PATH = /^\/api\/files\/[A-Za-z0-9_-]{1,64}$/;
const PHOTO_URL_MESSAGE = "Photo URL must be a valid URL starting with http:// or https://.";
/** "" = none; an external http(s) image URL; or the server-managed path of a photo uploaded from a computer. */
export const photoUrlField = z
  .string({ invalid_type_error: "Photo URL must be a string." })
  .trim()
  .max(2048, "Photo URL is too long.")
  .refine((v) => v === "" || isHttpUrl(v) || PROFILE_PHOTO_PATH.test(v), PHOTO_URL_MESSAGE);

/** Profile fields shared by admin team editing, the own-profile form and new-member creation. */
export const teamMemberFields = {
  name: requiredText("Name", 120),
  initials: requiredText("Initials", 10),
  role: requiredText("Role", 120),
  department: optionalText("Department", 200),
  bio: optionalText("Bio", 2000),
  photoUrl: photoUrlField,
  scholarUrl: scholarUrlField,
  researchGateUrl: researchGateUrlField,
  orcid: orcidField,
};

export const createTeamMemberSchema = z.object({
  name: teamMemberFields.name,
  initials: teamMemberFields.initials,
  role: teamMemberFields.role,
  category: categorySchema,
  department: teamMemberFields.department.optional().default(""),
  bio: teamMemberFields.bio.optional().default(""),
  photoUrl: teamMemberFields.photoUrl.optional().default(""),
  scholarUrl: teamMemberFields.scholarUrl.optional().default(""),
  researchGateUrl: teamMemberFields.researchGateUrl.optional().default(""),
  orcid: teamMemberFields.orcid.optional().default(""),
  /** Managers only. Omitted = published. */
  isPublished: z.boolean().optional(),
  sortOrder: sortOrderField.optional().default(0),
  /** Japanese bio override (Phase 14); see translations.ts. */
  translations: translationsField(TEAM_MEMBER_TRANSLATION_MAX),
});
export type CreateTeamMemberInput = z.infer<typeof createTeamMemberSchema>;

export const updateTeamMemberSchema = z
  .object({
    name: teamMemberFields.name.optional(),
    initials: teamMemberFields.initials.optional(),
    role: teamMemberFields.role.optional(),
    category: categorySchema.optional(),
    department: teamMemberFields.department.optional(),
    bio: teamMemberFields.bio.optional(),
    photoUrl: teamMemberFields.photoUrl.optional(),
    scholarUrl: teamMemberFields.scholarUrl.optional(),
    researchGateUrl: teamMemberFields.researchGateUrl.optional(),
    orcid: teamMemberFields.orcid.optional(),
    /** Managers only (ignored for anyone editing their own profile). */
    isPublished: z.boolean().optional(),
    sortOrder: sortOrderField.optional(),
    translations: translationsField(TEAM_MEMBER_TRANSLATION_MAX),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");
export type UpdateTeamMemberInput = z.infer<typeof updateTeamMemberSchema>;

export const historyEntrySchema = z.object({
  id: z.string(),
  year: z.string(),
  title: z.string(),
  description: z.string(),
  sortOrder: z.number(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

const historyFields = {
  year: requiredText("Year", 20),
  title: requiredText("Title", 200),
  description: optionalText("Description", 2000),
  sortOrder: sortOrderField,
};

export const createHistoryEntrySchema = z.object({
  year: historyFields.year,
  title: historyFields.title,
  description: historyFields.description.optional().default(""),
  sortOrder: historyFields.sortOrder.optional().default(0),
});
export type CreateHistoryEntryInput = z.infer<typeof createHistoryEntrySchema>;

export const updateHistoryEntrySchema = z
  .object({
    year: historyFields.year.optional(),
    title: historyFields.title.optional(),
    description: historyFields.description.optional(),
    sortOrder: historyFields.sortOrder.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");
export type UpdateHistoryEntryInput = z.infer<typeof updateHistoryEntrySchema>;
