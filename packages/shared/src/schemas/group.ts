import { z } from "zod";
import { visibilitySchema } from "./enums.js";
import { idSchema, optionalText, requiredText, sortOrderField } from "./common.js";
import { areaRefSchema, groupMemberRoleSchema, projectRefSchema, slugSchema } from "./project.js";
import { translationsField } from "./translations.js";
import { publicationSchema } from "./publication.js";
import { newsItemSchema } from "./news.js";
import { labEventListSchema } from "./event.js";

/** Mirrors the English field lengths below — see i18n/translatableFields.ts (RESEARCH_GROUP). */
export const GROUP_TRANSLATION_MAX = { name: 120, description: 5000 };

export const groupMemberSchema = z.object({
  teamMemberId: z.string(),
  name: z.string(),
  initials: z.string(),
  role: groupMemberRoleSchema,
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

export const groupSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  sortOrder: z.number(),
  /** Only sent to accounts that may change visibility (lab managers, admins). */
  visibility: visibilitySchema.optional(),
  members: z.array(groupMemberSchema),
  /** Counts only projects the viewer may see. */
  projectCount: z.number(),
});
export type GroupSummary = z.infer<typeof groupSummarySchema>;

export const groupDetailSchema = groupSummarySchema.extend({
  projects: z.array(projectRefSchema.extend({ summary: z.string() })),
  /** Phase 18: derived from the group's VISIBLE projects (a group has no direct link to these). */
  areas: z.array(areaRefSchema),
  publications: z.array(publicationSchema),
  news: z.array(newsItemSchema),
  events: labEventListSchema,
  /** UX hint only (whether to show edit controls); the API re-checks on every write. */
  canEdit: z.boolean(),
});
export type GroupDetail = z.infer<typeof groupDetailSchema>;

export const groupFields = {
  name: requiredText("Name", 120),
  description: optionalText("Description", 5000),
};
export const groupManagerFields = {
  visibility: visibilitySchema,
  slug: slugSchema,
  sortOrder: sortOrderField,
};
export const GROUP_MANAGER_ONLY_KEYS = Object.keys(groupManagerFields) as (keyof typeof groupManagerFields)[];

export const createGroupSchema = z.object({
  name: groupFields.name,
  description: groupFields.description.optional().default(""),
  /** Omitted = LAB_ONLY. */
  visibility: groupManagerFields.visibility.optional(),
  slug: groupManagerFields.slug.optional(),
  sortOrder: groupManagerFields.sortOrder.optional().default(0),
  /** Japanese name/description override (Phase 14); see translations.ts. */
  translations: translationsField(GROUP_TRANSLATION_MAX),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z
  .object({
    name: groupFields.name.optional(),
    description: groupFields.description.optional(),
    visibility: groupManagerFields.visibility.optional(),
    slug: groupManagerFields.slug.optional(),
    sortOrder: groupManagerFields.sortOrder.optional(),
    translations: translationsField(GROUP_TRANSLATION_MAX),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const setGroupMembersSchema = z.object({
  members: z
    .array(z.object({ teamMemberId: idSchema, role: groupMemberRoleSchema.default("MEMBER") }), {
      required_error: "members is required.",
      invalid_type_error: "members must be an array.",
    })
    .max(200, "Too many members.")
    .refine((m) => new Set(m.map((x) => x.teamMemberId)).size === m.length, "Duplicate team members in the list."),
});
export type SetGroupMembersInput = z.infer<typeof setGroupMembersSchema>;
