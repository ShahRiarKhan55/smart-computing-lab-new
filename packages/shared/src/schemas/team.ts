import { z } from "zod";
import { categorySchema } from "./enums.js";
import { optionalHttpUrl, optionalText, requiredText, sortOrderField } from "./common.js";
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
  sortOrder: z.number(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

/** Profile fields shared by admin team editing, the own-profile form and new-member creation. */
export const teamMemberFields = {
  name: requiredText("Name", 120),
  initials: requiredText("Initials", 10),
  role: requiredText("Role", 120),
  department: optionalText("Department", 200),
  bio: optionalText("Bio", 2000),
  photoUrl: optionalHttpUrl("Photo URL"),
};

export const createTeamMemberSchema = z.object({
  name: teamMemberFields.name,
  initials: teamMemberFields.initials,
  role: teamMemberFields.role,
  category: categorySchema,
  department: teamMemberFields.department.optional().default(""),
  bio: teamMemberFields.bio.optional().default(""),
  photoUrl: teamMemberFields.photoUrl.optional().default(""),
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
