import { z } from "zod";
import { visibilitySchema } from "./enums.js";
import { idSchema, optionalText, requiredText, sortOrderField } from "./common.js";
import { projectRefSchema, slugSchema } from "./project.js";

/**
 * Lab forum / research community (Phase 11), built on the tables Phase 8 already created
 * (ForumCategory/ForumPost/ForumComment/ForumReaction/ForumMention — see
 * docs/architecture/phase8-platform-architecture.md §9 and phase11-forum-community.md).
 *
 * Visibility lives on the CATEGORY only; posts and comments inherit it (never their own
 * `visibility` field — moving a post to another category is the only way its audience
 * changes, a moderation action). Ownership follows the same shape as projects/groups:
 * an author (or a manager) may edit/delete; only a manager may pin/lock/hide/move
 * (see `canEditForumPost` / `canModerate` in ../permissions.js).
 */

// ---- enums / constants -----------------------------------------------------------
/** `DELETED` is a server-internal tombstone state: no read endpoint ever returns it. */
export const FORUM_POST_STATUSES = ["ACTIVE", "HIDDEN", "DELETED"] as const;
/** The statuses a client can ever see (a HIDDEN row is only sent to managers). */
export const forumPostStatusSchema = z.enum(["ACTIVE", "HIDDEN"], {
  errorMap: () => ({ message: "Status must be ACTIVE or HIDDEN." }),
});
export type ForumPostStatus = z.infer<typeof forumPostStatusSchema>;

/** Matches the value set already documented on `ForumReaction.kind` in schema.prisma. */
export const FORUM_REACTION_KINDS = ["LIKE", "LOVE", "INSIGHTFUL", "THANKS"] as const;
export const forumReactionKindSchema = z.enum(FORUM_REACTION_KINDS, {
  errorMap: () => ({ message: `Reaction must be one of: ${FORUM_REACTION_KINDS.join(", ")}.` }),
});
export type ForumReactionKind = z.infer<typeof forumReactionKindSchema>;
export const FORUM_REACTION_LABELS: Record<ForumReactionKind, string> = {
  LIKE: "Like",
  LOVE: "Love",
  INSIGHTFUL: "Insightful",
  THANKS: "Thanks",
};

export const FORUM_TOPICS_DEFAULT_LIMIT = 20;
export const FORUM_TOPICS_MAX_LIMIT = 50;
export const FORUM_COMMENTS_DEFAULT_LIMIT = 30;
export const FORUM_COMMENTS_MAX_LIMIT = 100;
export const FORUM_MAX_PAGE = 10000;

/** A query-string page/limit param: digits only, clamped to [min, max]; absent means `fallback`. */
export function intQueryParam(label: string, min: number, max: number, fallback: number) {
  const message = `${label} must be a whole number between ${min} and ${max}.`;
  return z
    .string({ invalid_type_error: message })
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return fallback;
      if (!/^\d{1,7}$/.test(value) || Number(value) < min || Number(value) > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return Number(value);
    });
}

export const forumTopicsQuerySchema = z.object({
  category: slugSchema.optional(),
  project: idSchema.optional(),
  page: intQueryParam("Page", 1, FORUM_MAX_PAGE, 1),
  limit: intQueryParam("Limit", 1, FORUM_TOPICS_MAX_LIMIT, FORUM_TOPICS_DEFAULT_LIMIT),
});
export type ForumTopicsQuery = z.infer<typeof forumTopicsQuerySchema>;

export const forumCommentsQuerySchema = z.object({
  page: intQueryParam("Page", 1, FORUM_MAX_PAGE, 1),
  limit: intQueryParam("Limit", 1, FORUM_COMMENTS_MAX_LIMIT, FORUM_COMMENTS_DEFAULT_LIMIT),
});
export type ForumCommentsQuery = z.infer<typeof forumCommentsQuerySchema>;

// ---- mentions ---------------------------------------------------------------------
/**
 * Canonical mention token stored inside a post/comment body: `@[Display Name](member:<id>)`,
 * where `<id>` is a TeamMember id (already public — the same id `/team/:id` and every
 * PersonLink use), never a User/account id. This is a deliberate change from the Phase 8
 * design sketch (which anchored on `user:<id>`): the account id must never appear in text
 * that is served back to clients verbatim, so the anchor has to be something already public.
 */
export const FORUM_MENTION_TOKEN = /@\[([^[\]\n]{1,120})\]\(member:([A-Za-z0-9_-]{1,64})\)/g;
export const FORUM_MENTION_MAX_PER_BODY = 20;

export interface ForumBodySegment {
  text?: string;
  mention?: { teamMemberId: string; name: string };
}

/** Splits a stored body into plain text and mention segments. Pure and safe: never HTML. */
export function splitForumBody(body: string): ForumBodySegment[] {
  const segments: ForumBodySegment[] = [];
  let last = 0;
  FORUM_MENTION_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FORUM_MENTION_TOKEN.exec(body))) {
    if (m.index > last) segments.push({ text: body.slice(last, m.index) });
    segments.push({ mention: { name: m[1], teamMemberId: m[2] } });
    last = m.index + m[0].length;
  }
  if (last < body.length) segments.push({ text: body.slice(last) });
  return segments;
}

/** Body with mention markup collapsed to "@Name", for excerpts and search text. */
export function plainTextForumBody(body: string): string {
  return splitForumBody(body)
    .map((s) => (s.mention ? `@${s.mention.name}` : (s.text ?? "")))
    .join("");
}

/** The distinct TeamMember ids mentioned in a body, in first-appearance order, capped. */
export function mentionedTeamMemberIds(body: string): string[] {
  const seen = new Set<string>();
  for (const seg of splitForumBody(body)) {
    if (seg.mention && !seen.has(seg.mention.teamMemberId)) seen.add(seg.mention.teamMemberId);
    if (seen.size >= FORUM_MENTION_MAX_PER_BODY) break;
  }
  return [...seen];
}

/** `@[Name](member:id)` for inserting a mention into a composer textarea. */
export const mentionToken = (id: string, name: string) => `@[${name}](member:${id})`;

// ---- response shapes ----------------------------------------------------------------
export const forumAuthorRefSchema = z.object({
  /** null when there is nothing safe to link to: a former member (deleted account) or an
   *  account with no team profile. `name` still reads sensibly in either case. */
  teamMemberId: z.string().nullable(),
  name: z.string(),
  initials: z.string(),
});
export type ForumAuthorRef = z.infer<typeof forumAuthorRefSchema>;

export const forumCategoryRefSchema = z.object({ id: z.string(), slug: z.string(), name: z.string() });
export type ForumCategoryRef = z.infer<typeof forumCategoryRefSchema>;

export const forumReactionCountsSchema = z.object({
  LIKE: z.number(),
  LOVE: z.number(),
  INSIGHTFUL: z.number(),
  THANKS: z.number(),
});
export type ForumReactionCounts = z.infer<typeof forumReactionCountsSchema>;

export const forumReactionsSchema = z.object({
  counts: forumReactionCountsSchema,
  /** The KINDS the current viewer has reacted with (never another viewer's reactions). */
  mine: z.array(forumReactionKindSchema),
});
export type ForumReactions = z.infer<typeof forumReactionsSchema>;

export const paginationMetaSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const forumCategorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  /** Only sent to accounts that may change visibility (lab managers, admins), as everywhere else. */
  visibility: visibilitySchema.optional(),
  isLocked: z.boolean(),
  sortOrder: z.number(),
  /** Topics the CURRENT viewer may see; never a hidden count. */
  topicCount: z.number(),
  lastActivityAt: z.string().nullable(),
  canManage: z.boolean(),
});
export type ForumCategory = z.infer<typeof forumCategorySchema>;

export const forumTopicSummarySchema = z.object({
  id: z.string(),
  category: forumCategoryRefSchema,
  author: forumAuthorRefSchema,
  title: z.string(),
  /** Short plain-text preview (mention markup already collapsed to "@Name"). */
  excerpt: z.string(),
  /** Only ever HIDDEN for a manager viewer; everyone else only ever sees ACTIVE rows. */
  status: forumPostStatusSchema,
  pinned: z.boolean(),
  locked: z.boolean(),
  /** null when there is no linked project, or it is not visible to this viewer. */
  project: projectRefSchema.nullable(),
  commentCount: z.number(),
  reactions: forumReactionsSchema,
  createdAt: z.string(),
  lastActivityAt: z.string(),
  editedAt: z.string().nullable(),
  /** UX hints only; the API re-checks on every write. `canEdit` = the author (text edits are
   *  never done by a manager); `canDelete` = the author or a manager; `canModerate` = pin/lock/
   *  hide/move (a manager only). */
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  canModerate: z.boolean(),
});
export type ForumTopicSummary = z.infer<typeof forumTopicSummarySchema>;

export const forumTopicListResponseSchema = z.object({
  topics: z.array(forumTopicSummarySchema),
  pagination: paginationMetaSchema,
});
export type ForumTopicListResponse = z.infer<typeof forumTopicListResponseSchema>;

export const forumCommentSchema = z.object({
  id: z.string(),
  author: forumAuthorRefSchema,
  body: z.string(),
  status: forumPostStatusSchema,
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  reactions: forumReactionsSchema,
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  canModerate: z.boolean(),
});
export type ForumComment = z.infer<typeof forumCommentSchema>;

export const forumCommentListResponseSchema = z.object({
  comments: z.array(forumCommentSchema),
  pagination: paginationMetaSchema,
});
export type ForumCommentListResponse = z.infer<typeof forumCommentListResponseSchema>;

export const forumTopicDetailSchema = forumTopicSummarySchema.extend({
  body: z.string(),
  comments: z.array(forumCommentSchema),
  commentsPagination: paginationMetaSchema,
});
export type ForumTopicDetail = z.infer<typeof forumTopicDetailSchema>;

// ---- write shapes -------------------------------------------------------------------
export const forumCategoryFields = {
  name: requiredText("Name", 120),
  description: optionalText("Description", 2000),
};
/** Fields only a lab manager/admin may set — mirrors PROJECT_MANAGER_ONLY_KEYS. */
export const forumCategoryManagerFields = {
  visibility: visibilitySchema,
  slug: slugSchema,
  sortOrder: sortOrderField,
  isLocked: z.boolean({ invalid_type_error: "isLocked must be true or false." }),
};

export const createForumCategorySchema = z.object({
  name: forumCategoryFields.name,
  description: forumCategoryFields.description.optional().default(""),
  /** Omitted = LAB_ONLY: a new category is internal until someone publishes it. */
  visibility: forumCategoryManagerFields.visibility.optional(),
  slug: forumCategoryManagerFields.slug.optional(),
  sortOrder: forumCategoryManagerFields.sortOrder.optional().default(0),
  isLocked: forumCategoryManagerFields.isLocked.optional().default(false),
});
export type CreateForumCategoryInput = z.infer<typeof createForumCategorySchema>;

export const updateForumCategorySchema = z
  .object({
    name: forumCategoryFields.name.optional(),
    description: forumCategoryFields.description.optional(),
    visibility: forumCategoryManagerFields.visibility.optional(),
    slug: forumCategoryManagerFields.slug.optional(),
    sortOrder: forumCategoryManagerFields.sortOrder.optional(),
    isLocked: forumCategoryManagerFields.isLocked.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");
export type UpdateForumCategoryInput = z.infer<typeof updateForumCategorySchema>;

export const forumTopicFields = {
  title: requiredText("Title", 200),
  body: requiredText("Body", 20000),
};

export const createForumTopicSchema = z.object({
  categoryId: idSchema,
  title: forumTopicFields.title,
  body: forumTopicFields.body,
  projectId: idSchema.nullable().optional().default(null),
});
export type CreateForumTopicInput = z.infer<typeof createForumTopicSchema>;

/** `categoryId` (moving a topic) is manager-only, like `visibility`/`slug` elsewhere — an
 *  author who sends it gets 403. Title/body are the ordinary author-editable fields. */
export const forumTopicManagerFields = { categoryId: idSchema };
export const FORUM_TOPIC_MANAGER_ONLY_KEYS = Object.keys(forumTopicManagerFields) as (keyof typeof forumTopicManagerFields)[];

export const updateForumTopicSchema = z
  .object({
    title: forumTopicFields.title.optional(),
    body: forumTopicFields.body.optional(),
    projectId: idSchema.nullable().optional(),
    categoryId: forumTopicManagerFields.categoryId.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");
export type UpdateForumTopicInput = z.infer<typeof updateForumTopicSchema>;

const forumCommentBody = requiredText("Comment", 5000);
export const createForumCommentSchema = z.object({ body: forumCommentBody });
export type CreateForumCommentInput = z.infer<typeof createForumCommentSchema>;
export const updateForumCommentSchema = z.object({ body: forumCommentBody });
export type UpdateForumCommentInput = z.infer<typeof updateForumCommentSchema>;

export const forumReactionInputSchema = z.object({ kind: forumReactionKindSchema.optional().default("LIKE") });
export type ForumReactionInput = z.infer<typeof forumReactionInputSchema>;
