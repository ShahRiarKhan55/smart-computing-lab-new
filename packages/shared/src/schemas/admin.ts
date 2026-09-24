import { z } from "zod";
import { idSchema } from "./common.js";
import { visibilitySchema, type Visibility } from "./enums.js";
import { EVENT_KINDS, EVENT_SCOPES, EVENT_TRANSLATION_MAX } from "./event.js";
import { GROUP_TRANSLATION_MAX } from "./group.js";
import { NEWS_TRANSLATION_MAX, NEWS_TYPES } from "./news.js";
import { PROJECT_STATUSES, PROJECT_TRANSLATION_MAX } from "./project.js";
import { RESEARCH_AREA_TRANSLATION_MAX } from "./research.js";
import { parseSearchText, SEARCH_MAX_TERMS, SEARCH_QUERY_MAX_LENGTH } from "./search.js";
import { TEAM_MEMBER_TRANSLATION_MAX } from "./team.js";
import { isTranslatableEntityType, TRANSLATABLE_FIELDS, type TranslatableEntityType } from "../i18n/translatableFields.js";

/**
 * Phase 17 admin/CMS contracts. Nothing here is a new data model: every shape is a read-only view
 * over an existing table, and every write goes through an existing table too.
 */

// ---- content types ------------------------------------------------------------
export const ADMIN_CONTENT_TYPES = ["research-area", "project", "group", "publication", "news", "event", "team-member"] as const;
export type AdminContentType = (typeof ADMIN_CONTENT_TYPES)[number];
/** The types whose table has a `visibility` column (a team profile has none: it is always public). */
export const ADMIN_VISIBILITY_TYPES = ["research-area", "project", "group", "publication", "news", "event"] as const;
export type AdminVisibilityType = (typeof ADMIN_VISIBILITY_TYPES)[number];
export const hasVisibility = (t: AdminContentType): t is AdminVisibilityType => (ADMIN_VISIBILITY_TYPES as readonly string[]).includes(t);

/** Content type -> the Translation table's entityType (only for those with an allow-list). */
export const ADMIN_TRANSLATION_ENTITY: Partial<Record<AdminContentType, TranslatableEntityType>> = {
  "research-area": "RESEARCH_AREA",
  project: "RESEARCH_PROJECT",
  group: "RESEARCH_GROUP",
  news: "NEWS_ITEM",
  event: "EVENT",
  "team-member": "TEAM_MEMBER",
};

export const ADMIN_DEFAULT_LIMIT = 25;
export const ADMIN_MAX_LIMIT = 100;
export const ADMIN_MAX_PAGE = 10000;
export const ADMIN_BULK_MAX = 100;

// ---- query-string helpers -------------------------------------------------------
/** A query-string whole number within [min, max]; absent means `fallback`. Anything else is a 400. */
export function queryInt(label: string, min: number, max: number, fallback: number) {
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

/** `YYYY-MM-DD` that is a REAL calendar day (Date would roll 2030-02-30 over to March 2). */
export function parseIsoDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1970 || y > 2099) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

const dayParam = (label: string) =>
  z
    .string({ invalid_type_error: `${label} must be a date (YYYY-MM-DD).` })
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return undefined;
      const date = parseIsoDay(v);
      if (!date) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a date (YYYY-MM-DD).` });
        return z.NEVER;
      }
      return date;
    });

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T, label: string) =>
  z
    .string({ invalid_type_error: `${label} must be one of: ${values.join(", ")}.` })
    .optional()
    .transform((v, ctx): T[number] | undefined => {
      if (v === undefined || v === "") return undefined;
      if (!(values as readonly string[]).includes(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be one of: ${values.join(", ")}.` });
        return z.NEVER;
      }
      return v as T[number];
    });

/** Free text -> search words with the SAME parser the global search uses ("%"/"_" separate words, NFKC, ...). */
const textParam = z
  .string({ invalid_type_error: "Search text must be text." })
  .max(SEARCH_QUERY_MAX_LENGTH, `Search text must be at most ${SEARCH_QUERY_MAX_LENGTH} characters.`)
  .optional()
  .transform((v, ctx) => {
    const parsed = parseSearchText((v ?? "").trim());
    if (parsed.terms.length > SEARCH_MAX_TERMS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Search text can have at most ${SEARCH_MAX_TERMS} words.` });
      return z.NEVER;
    }
    return parsed;
  });

// ---- GET /api/admin/content ------------------------------------------------------
export const CONTENT_TRANSLATION_STATES = ["translated", "untranslated"] as const;
export const CONTENT_SORTS = ["updated", "created", "title"] as const;
const VISIBILITY_VALUES = ["PUBLIC", "LAB_ONLY"] as const;

const rawContentQuery = z.object({
  type: z.enum(ADMIN_CONTENT_TYPES, { errorMap: () => ({ message: `Type must be one of: ${ADMIN_CONTENT_TYPES.join(", ")}.` }) }),
  q: textParam,
  visibility: optionalEnum(VISIBILITY_VALUES, "Visibility"),
  owner: z.string({ invalid_type_error: "Owner must be an id." }).optional(),
  scope: optionalEnum(EVENT_SCOPES, "Scope"),
  kind: optionalEnum(EVENT_KINDS, "Event type"),
  status: optionalEnum(PROJECT_STATUSES, "Status"),
  newsType: optionalEnum(NEWS_TYPES, "News type"),
  translation: optionalEnum(CONTENT_TRANSLATION_STATES, "Translation"),
  from: dayParam("From"),
  to: dayParam("To"),
  sort: optionalEnum(CONTENT_SORTS, "Sort"),
  page: queryInt("Page", 1, ADMIN_MAX_PAGE, 1),
  limit: queryInt("Limit", 1, ADMIN_MAX_LIMIT, ADMIN_DEFAULT_LIMIT),
});

/** Which optional filters mean something for which content type; sending one that does not apply is a 400 (never silently ignored). */
const FILTER_APPLIES: Record<string, (t: AdminContentType) => boolean> = {
  visibility: hasVisibility,
  owner: (t) => t === "event",
  scope: (t) => t === "event",
  kind: (t) => t === "event",
  status: (t) => t === "project",
  newsType: (t) => t === "news",
  translation: (t) => ADMIN_TRANSLATION_ENTITY[t] !== undefined,
};

export const adminContentQuerySchema = rawContentQuery.superRefine((v, ctx) => {
  for (const [key, applies] of Object.entries(FILTER_APPLIES)) {
    if ((v as Record<string, unknown>)[key] !== undefined && !applies(v.type)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `The "${key}" filter does not apply to ${v.type}.` });
    }
  }
  if (v.owner !== undefined && !idSchema.safeParse(v.owner).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid id." });
  }
  if (v.from && v.to && v.from.getTime() > v.to.getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "From can't be after To." });
  }
});
export type AdminContentQuery = z.infer<typeof adminContentQuerySchema>;

// ---- response shapes (interfaces: the web tsconfig is not strict) -------------------
export interface AdminContentRow {
  type: AdminContentType;
  id: string;
  title: string;
  /** One line of context (year and venue, tag, slug, a category ...), plain text. */
  subtitle: string;
  visibility: Visibility | null;
  /** Project status, event type, news type or team category: a raw enum value the UI labels. */
  status: string | null;
  /** The record's own date where it has one (event start, news date), ISO. */
  date: string | null;
  /** Public team profile of the creator (events only). Never an account id or email. */
  owner: { id: string; name: string } | null;
  /** Japanese overrides present / translatable fields; null when the type has none. */
  translation: { done: number; total: number } | null;
  /** Team profiles: whether an account is linked. ADMIN only, null for everyone else. */
  hasAccount: boolean | null;
  createdAt: string;
  updatedAt: string;
  /** App-relative link to the public page. */
  href: string;
}
export interface AdminPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
export interface AdminContentResponse {
  type: AdminContentType;
  rows: AdminContentRow[];
  pagination: AdminPagination;
}

export interface AdminContentDetail {
  row: AdminContentRow;
  /** Counts of what this record is connected to (`key` is an i18n suffix, e.g. "members"). */
  relations: { key: string; count: number }[];
  /** Per translatable field: does a Japanese override exist. */
  translations: { field: string; hasOverride: boolean }[];
}

// ---- POST /api/admin/content/visibility --------------------------------------------
export const bulkVisibilitySchema = z.object({
  type: z.enum(ADMIN_VISIBILITY_TYPES, { errorMap: () => ({ message: `Type must be one of: ${ADMIN_VISIBILITY_TYPES.join(", ")}.` }) }),
  ids: z
    .array(idSchema, { required_error: "ids is required.", invalid_type_error: "ids must be an array of ids." })
    .min(1, "Select at least one record.")
    .max(ADMIN_BULK_MAX, `You can change at most ${ADMIN_BULK_MAX} records at once.`)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate ids."),
  visibility: visibilitySchema,
});
export type BulkVisibilityInput = z.infer<typeof bulkVisibilitySchema>;
export interface BulkVisibilityResult {
  updated: number;
  unchanged: number;
}

// ---- translations ---------------------------------------------------------------------
export const TRANSLATION_STATES = ["all", "overridden", "missing"] as const;
export const adminTranslationsQuerySchema = z.object({
  type: z
    .string({ required_error: "Type is required.", invalid_type_error: "Type is required." })
    .refine((v) => isTranslatableEntityType(v), `Type must be one of: ${Object.keys(TRANSLATABLE_FIELDS).join(", ")}.`)
    .transform((v) => v as TranslatableEntityType),
  q: textParam,
  state: optionalEnum(TRANSLATION_STATES, "State"),
  page: queryInt("Page", 1, ADMIN_MAX_PAGE, 1),
  limit: queryInt("Limit", 1, ADMIN_MAX_LIMIT, ADMIN_DEFAULT_LIMIT),
});
export type AdminTranslationsQuery = z.infer<typeof adminTranslationsQuerySchema>;

/** Field length caps: the very constants each entity's own form/API enforces, so this view can't store more than they can. */
export const ADMIN_TRANSLATION_MAX: Record<TranslatableEntityType, Record<string, number>> = {
  RESEARCH_AREA: RESEARCH_AREA_TRANSLATION_MAX,
  RESEARCH_PROJECT: PROJECT_TRANSLATION_MAX,
  RESEARCH_GROUP: GROUP_TRANSLATION_MAX,
  NEWS_ITEM: NEWS_TRANSLATION_MAX,
  EVENT: EVENT_TRANSLATION_MAX,
  TEAM_MEMBER: TEAM_MEMBER_TRANSLATION_MAX,
};

export const updateTranslationSchema = z.object({
  field: z.string({ required_error: "Field is required.", invalid_type_error: "Field must be text." }).min(1, "Field is required.").max(40),
  /** A non-empty string sets the Japanese override; "" or null clears it. */
  value: z.string({ invalid_type_error: "Value must be text." }).max(10000, "Value is too long.").nullable(),
});
export type UpdateTranslationInput = z.infer<typeof updateTranslationSchema>;

export interface AdminTranslationEntry {
  entityType: TranslatableEntityType;
  id: string;
  /** The base (English) label of the record. */
  label: string;
  href: string;
  fields: { field: string; base: string; ja: string | null; max: number }[];
}
export interface AdminTranslationsResponse {
  type: TranslatableEntityType;
  entries: AdminTranslationEntry[];
  pagination: AdminPagination;
}

// ---- audit log -------------------------------------------------------------------------
export const adminAuditQuerySchema = z
  .object({
    action: z.string({ invalid_type_error: "Action must be text." }).max(60).regex(/^[A-Z_]*$/, "Invalid action.").optional(),
    entityType: z.string({ invalid_type_error: "Entity type must be text." }).max(40).regex(/^[A-Z_]*$/, "Invalid entity type.").optional(),
    actor: z.string({ invalid_type_error: "Actor must be text." }).max(100).optional(),
    from: dayParam("From"),
    to: dayParam("To"),
    page: queryInt("Page", 1, ADMIN_MAX_PAGE, 1),
    limit: queryInt("Limit", 1, ADMIN_MAX_LIMIT, ADMIN_DEFAULT_LIMIT),
  })
  .superRefine((v, ctx) => {
    if (v.from && v.to && v.from.getTime() > v.to.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "From can't be after To." });
    }
  });
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

export interface AdminAuditEntry {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  /** ADMIN: the acting account's email snapshot. LAB_MANAGER: the acting person's public profile name, or null. */
  actor: string | null;
  /** Flat, non-sensitive details exactly as recorded (ids, roles, field NAMES). */
  details: Record<string, string | number | boolean | null>;
}
export interface AdminAuditResponse {
  entries: AdminAuditEntry[];
  pagination: AdminPagination;
  facets: { actions: string[]; entityTypes: string[] };
}

// ---- accounts --------------------------------------------------------------------------------
export const linkAccountSchema = z.object({
  /** The team profile to link, or null to unlink the account's current profile. */
  teamMemberId: idSchema.nullable(),
});
export type LinkAccountInput = z.infer<typeof linkAccountSchema>;

// ---- overview / community / files -----------------------------------------------------------
export interface AdminCount {
  total: number;
  public: number;
  labOnly: number;
}
export interface AdminOverview {
  /** ADMIN only: null for a lab manager. */
  accounts: { total: number; admins: number; managers: number; members: number; profilesWithoutLogin: number } | null;
  teamMembers: number;
  researchAreas: AdminCount;
  projects: AdminCount;
  groups: AdminCount;
  publications: AdminCount;
  news: AdminCount;
  events: AdminCount & { upcoming: number };
  forumCategories: AdminCount;
  forumTopics: number;
  galleryItems: AdminCount;
  translations: { overrides: number };
}

export interface AdminCommunityCategory {
  id: string;
  slug: string;
  name: string;
  visibility: Visibility;
  locked: boolean;
  topics: number;
  hiddenTopics: number;
  comments: number;
  hiddenComments: number;
}
export interface AdminCommunityResponse {
  categories: AdminCommunityCategory[];
  /** Hidden topics awaiting review: a title and where to find it, never a body. */
  hiddenTopics: { id: string; title: string; categoryName: string; author: string | null; createdAt: string; href: string }[];
  events: number;
  galleryItems: number;
}

export const adminFilesQuerySchema = z.object({
  q: textParam,
  visibility: optionalEnum(VISIBILITY_VALUES, "Visibility"),
  category: optionalEnum(["LAB_LIFE", "EVENT", "RESEARCH", "OTHER"] as const, "Category"),
  page: queryInt("Page", 1, ADMIN_MAX_PAGE, 1),
  limit: queryInt("Limit", 1, ADMIN_MAX_LIMIT, ADMIN_DEFAULT_LIMIT),
});
export type AdminFilesQuery = z.infer<typeof adminFilesQuerySchema>;

export interface AdminFileRow {
  id: string;
  /** Display name only (never a path or storage key). */
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  caption: string;
  category: string;
  visibility: Visibility;
  uploadedBy: { id: string; name: string } | null;
  project: { id: string; title: string } | null;
  createdAt: string;
}
export interface AdminFilesResponse {
  rows: AdminFileRow[];
  pagination: AdminPagination;
}
