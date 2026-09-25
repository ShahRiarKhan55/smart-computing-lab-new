import { z } from "zod";
import { visibilitySchema } from "./enums.js";
import { idSchema, optionalText, requiredText, sortOrderField } from "./common.js";
import { publicationSchema } from "./publication.js";
import { newsItemSchema } from "./news.js";
import { translationsField } from "./translations.js";
import { labEventListSchema } from "./event.js";

/** Mirrors the English field lengths below — see i18n/translatableFields.ts (RESEARCH_PROJECT). */
export const PROJECT_TRANSLATION_MAX = { title: 200, summary: 500, description: 10000 };

export const PROJECT_STATUSES = ["PLANNED", "ACTIVE", "COMPLETED", "ARCHIVED"] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES, {
  errorMap: () => ({ message: "Status must be PLANNED, ACTIVE, COMPLETED or ARCHIVED." }),
});
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export const PROJECT_MEMBER_ROLES = ["LEAD", "MEMBER", "COLLABORATOR"] as const;
export const projectMemberRoleSchema = z.enum(PROJECT_MEMBER_ROLES, {
  errorMap: () => ({ message: "Project role must be LEAD, MEMBER or COLLABORATOR." }),
});
export type ProjectMemberRole = z.infer<typeof projectMemberRoleSchema>;

export const GROUP_MEMBER_ROLES = ["LEAD", "MEMBER"] as const;
export const groupMemberRoleSchema = z.enum(GROUP_MEMBER_ROLES, {
  errorMap: () => ({ message: "Group role must be LEAD or MEMBER." }),
});
export type GroupMemberRole = z.infer<typeof groupMemberRoleSchema>;

/** URL-safe identifier: lowercase letters/digits separated by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugSchema = z
  .string({ invalid_type_error: "Slug must be text." })
  .trim()
  .min(1, "Slug is required.")
  .max(64, "Slug must be at most 64 characters.")
  .regex(SLUG_PATTERN, "Slug may only contain lowercase letters, digits and single hyphens.");

/** "YYYY-MM-DD" (a real calendar date) or "" / null for "not set". Normalised to string | null. */
export const optionalDateSchema = z
  .union([z.string(), z.null()], { invalid_type_error: "Date must be text (YYYY-MM-DD)." })
  .transform((v) => (v === null ? "" : v.trim()))
  .refine((v) => {
    if (v === "") return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const [y, m, d] = v.split("-").map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
  }, "Date must be a real calendar date in YYYY-MM-DD format.")
  .transform((v) => (v === "" ? null : v));

export const END_BEFORE_START = "End date can't be before the start date.";
export function endsBeforeStart(start: string | null | undefined, end: string | null | undefined): boolean {
  return Boolean(start && end && end < start); // ISO dates compare correctly as strings
}

// ---- response shapes ----------------------------------------------------------
export const groupRefSchema = z.object({ id: z.string(), slug: z.string(), name: z.string() });
export type GroupRef = z.infer<typeof groupRefSchema>;

export const projectRefSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  status: projectStatusSchema,
});
export type ProjectRef = z.infer<typeof projectRefSchema>;

export const areaRefSchema = z.object({ id: z.string(), icon: z.string(), title: z.string(), tag: z.string() });
export type AreaRef = z.infer<typeof areaRefSchema>;

export const projectMemberSchema = z.object({
  teamMemberId: z.string(),
  name: z.string(),
  initials: z.string(),
  role: projectMemberRoleSchema,
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;

export const projectSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  status: projectStatusSchema,
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  sortOrder: z.number(),
  /** Only sent to accounts that may change visibility (lab managers, admins). */
  visibility: visibilitySchema.optional(),
  /** null when the project has no group OR the group is not visible to the viewer. */
  group: groupRefSchema.nullable(),
  areas: z.array(areaRefSchema),
  members: z.array(projectMemberSchema),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectDetailSchema = projectSummarySchema.extend({
  description: z.string(),
  publications: z.array(publicationSchema),
  news: z.array(newsItemSchema),
  /** Events linked to this project (Event.projectId) that the viewer may see. */
  events: labEventListSchema,
  /** UX hint only (whether to show edit controls); the API re-checks on every write. */
  canEdit: z.boolean(),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

// ---- write shapes -----------------------------------------------------------------
export const projectFields = {
  title: requiredText("Title", 200),
  summary: optionalText("Summary", 500),
  description: optionalText("Description", 10000),
  status: projectStatusSchema,
  startDate: optionalDateSchema,
  endDate: optionalDateSchema,
};
/** Fields only a lab manager/admin may set; a project lead who sends any of them gets 403. */
export const projectManagerFields = {
  visibility: visibilitySchema,
  slug: slugSchema,
  sortOrder: sortOrderField,
  groupId: idSchema.nullable(),
};
export const PROJECT_MANAGER_ONLY_KEYS = Object.keys(projectManagerFields) as (keyof typeof projectManagerFields)[];

export const createProjectSchema = z
  .object({
    title: projectFields.title,
    summary: projectFields.summary.optional().default(""),
    description: projectFields.description.optional().default(""),
    status: projectFields.status.optional().default("ACTIVE"),
    startDate: projectFields.startDate.optional().default(null),
    endDate: projectFields.endDate.optional().default(null),
    /** Omitted = LAB_ONLY: a new project is internal until someone publishes it. */
    visibility: projectManagerFields.visibility.optional(),
    slug: projectManagerFields.slug.optional(),
    sortOrder: projectManagerFields.sortOrder.optional().default(0),
    groupId: projectManagerFields.groupId.optional().default(null),
    /** Japanese title/summary/description override (Phase 14); see translations.ts. */
    translations: translationsField(PROJECT_TRANSLATION_MAX),
  })
  .refine((v) => !endsBeforeStart(v.startDate, v.endDate), { message: END_BEFORE_START, path: ["endDate"] });
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    title: projectFields.title.optional(),
    summary: projectFields.summary.optional(),
    description: projectFields.description.optional(),
    status: projectFields.status.optional(),
    startDate: projectFields.startDate.optional(),
    endDate: projectFields.endDate.optional(),
    visibility: projectManagerFields.visibility.optional(),
    slug: projectManagerFields.slug.optional(),
    sortOrder: projectManagerFields.sortOrder.optional(),
    groupId: projectManagerFields.groupId.optional(),
    translations: translationsField(PROJECT_TRANSLATION_MAX),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.")
  .refine((v) => !endsBeforeStart(v.startDate, v.endDate), { message: END_BEFORE_START, path: ["endDate"] });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const setProjectMembersSchema = z.object({
  members: z
    .array(z.object({ teamMemberId: idSchema, role: projectMemberRoleSchema.default("MEMBER") }), {
      required_error: "members is required.",
      invalid_type_error: "members must be an array.",
    })
    .max(200, "Too many members.")
    .refine((m) => new Set(m.map((x) => x.teamMemberId)).size === m.length, "Duplicate team members in the list."),
});
export type SetProjectMembersInput = z.infer<typeof setProjectMembersSchema>;

const idList = (field: string, max: number) =>
  z
    .array(idSchema, { required_error: `${field} is required.`, invalid_type_error: `${field} must be an array of ids.` })
    .max(max, `Too many items in ${field}.`)
    .refine((ids) => new Set(ids).size === ids.length, `Duplicate ids in ${field}.`);

export const setProjectAreasSchema = z.object({ areaIds: idList("areaIds", 200) });
export const setProjectPublicationsSchema = z.object({ publicationIds: idList("publicationIds", 1000) });
export const setProjectNewsSchema = z.object({ newsIds: idList("newsIds", 1000) });
