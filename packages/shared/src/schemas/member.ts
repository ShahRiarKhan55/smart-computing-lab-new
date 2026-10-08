import { z } from "zod";
import { categorySchema } from "./enums.js";
import { idSchema } from "./common.js";
import { historyEntrySchema } from "./team.js";
import { publicationSchema } from "./publication.js";
import { newsItemSchema } from "./news.js";
import { areaRefSchema, groupMemberRoleSchema, groupRefSchema, projectMemberRoleSchema, projectRefSchema } from "./project.js";
import { labEventListSchema } from "./event.js";

export const memberProfileSchema = z.object({
  id: z.string(),
  /** See `teamMemberSchema.isOwn`. */
  isOwn: z.boolean(),
  /** Whether the CURRENT viewer may start a private conversation with this person: signed in,
   *  this profile has a linked account, and it is not the viewer's own. UX hint only — the
   *  messaging API re-checks all three (Phase 12 §9/§37). */
  canMessage: z.boolean(),
  name: z.string(),
  initials: z.string(),
  role: z.string(),
  category: categorySchema,
  department: z.string(),
  bio: z.string(),
  photoUrl: z.string(),
  scholarUrl: z.string(),
  researchGateUrl: z.string(),
  orcid: z.string(),
  /** Sent only to lab managers/admins. */
  isPublished: z.boolean().optional(),
  history: z.array(historyEntrySchema),
  publications: z.array(publicationSchema),
  news: z.array(newsItemSchema),
  /** Projects this researcher belongs to that the viewer may see. */
  projects: z.array(projectRefSchema.extend({ role: projectMemberRoleSchema })),
  /** Groups this researcher belongs to that the viewer may see. */
  groups: z.array(groupRefSchema.extend({ role: groupMemberRoleSchema })),
  /** Phase 18: research areas this researcher works in (ResearcherArea) that the viewer may see. */
  areas: z.array(areaRefSchema),
  /** Phase 18: events this researcher organised, plus events of their visible projects; visible ones only. */
  events: labEventListSchema,
});
export type MemberProfile = z.infer<typeof memberProfileSchema>;

export const setPublicationLinksSchema = z.object({
  publicationIds: z
    .array(idSchema, { required_error: "publicationIds is required.", invalid_type_error: "publicationIds must be an array of ids." })
    .max(1000, "Too many publications."),
});
export type SetPublicationLinksInput = z.infer<typeof setPublicationLinksSchema>;

export const setNewsLinksSchema = z.object({
  newsIds: z
    .array(idSchema, { required_error: "newsIds is required.", invalid_type_error: "newsIds must be an array of ids." })
    .max(1000, "Too many news items."),
});
export type SetNewsLinksInput = z.infer<typeof setNewsLinksSchema>;
