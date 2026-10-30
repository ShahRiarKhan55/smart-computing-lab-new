import { z } from "zod";
import { ID_PATTERN, optionalHttpUrl, requiredText, teamMemberIdListSchema } from "./common.js";
import { visibilitySchema } from "./enums.js";
import type { LabEvent } from "./event.js";
import type { NewsItem } from "./news.js";
import type { AreaRef, GroupRef, ProjectRef } from "./project.js";
import { parseSearchText, SEARCH_MAX_TERMS, SEARCH_QUERY_MAX_LENGTH } from "./search.js";
import { translationsField } from "./translations.js";
import { confirmDuplicateField, hasUpdateField } from "../duplicates.js";
import { MAX_PUBLICATION_PAGE, PUBLICATION_METADATA_TEXT_MAX, PUBLICATION_STATUSES, isIsoDate, isPublicationStatus, pageRangeProblem } from "./publicationMetadata.js";

export * from "./publicationMetadata.js";

export const MIN_PUBLICATION_YEAR = 1900;
export const MAX_PUBLICATION_YEAR = 2100;

/** Mirrors the English field lengths below — see i18n/translatableFields.ts (PUBLICATION). */
export const PUBLICATION_TRANSLATION_MAX = { title: 500, venue: 500 };

export const publicationSchema = z.object({
  id: z.string(),
  year: z.number(),
  title: z.string(),
  authors: z.string(),
  venue: z.string(),
  pdfUrl: z.string(),
  doiUrl: z.string(),
  extraUrl: z.string(),
  extraLabel: z.string(),
  /** Optional metadata from the publication-list workbook. "" / 0 mean "not stated". */
  status: z.string(),
  listNumber: z.string(),
  category: z.string(),
  volume: z.string(),
  startPage: z.number(),
  endPage: z.number(),
  /** 1-12 (the year is `year`). */
  month: z.number(),
  /** YYYY-MM-DD. */
  acceptedDate: z.string(),
  /** Only sent to accounts that may change visibility (lab managers, admins). */
  visibility: visibilitySchema.optional(),
});
export type Publication = z.infer<typeof publicationSchema>;

// The form sends the year as text; accept a numeric string but nothing else
// (so null, booleans and arrays do not silently coerce into a year; "" counts as missing).
const yearField = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v)) : v),
  z
    .number({ required_error: "Year is required.", invalid_type_error: "Year must be a number." })
    .int("Year must be a whole number.")
    .min(MIN_PUBLICATION_YEAR, `Year must be between ${MIN_PUBLICATION_YEAR} and ${MAX_PUBLICATION_YEAR}.`)
    .max(MAX_PUBLICATION_YEAR, `Year must be between ${MIN_PUBLICATION_YEAR} and ${MAX_PUBLICATION_YEAR}.`),
);

/**
 * An optional whole number. A blank box, null or 0 mean "not stated" and are stored as 0; anything else must be a whole number in range.
 * `undefined` is left alone (create: `.default(0)`, update: `.optional()` keeps the stored value).
 */
function optionalWhole(label: string, min: number, max: number) {
  return z.preprocess(
    (v) => (v === null || (typeof v === "string" && v.trim() === "") ? 0 : typeof v === "string" ? Number(v) : v),
    z
      .number({ invalid_type_error: `${label} must be a number.` })
      .int(`${label} must be a whole number.`)
      .refine((n) => n === 0 || (n >= min && n <= max), `${label} must be between ${min} and ${max}.`),
  );
}

const publicationMetadataFields = {
  status: z.string().trim().refine((v) => v === "" || isPublicationStatus(v), `Status must be one of: ${PUBLICATION_STATUSES.join(", ")}, or blank.`),
  listNumber: z.string().trim().max(PUBLICATION_METADATA_TEXT_MAX.listNumber, `Journal list number must be at most ${PUBLICATION_METADATA_TEXT_MAX.listNumber} characters.`),
  category: z.string().trim().max(PUBLICATION_METADATA_TEXT_MAX.category, `Paper category must be at most ${PUBLICATION_METADATA_TEXT_MAX.category} characters.`),
  volume: z.string().trim().max(PUBLICATION_METADATA_TEXT_MAX.volume, `Volume must be at most ${PUBLICATION_METADATA_TEXT_MAX.volume} characters.`),
  startPage: optionalWhole("Starting page", 1, MAX_PUBLICATION_PAGE),
  endPage: optionalWhole("Ending page", 1, MAX_PUBLICATION_PAGE),
  month: optionalWhole("Month", 1, 12),
  acceptedDate: z.string().trim().refine((v) => v === "" || isIsoDate(v), "Date of acceptance must be a real date written YYYY-MM-DD."),
};

const publicationFields = {
  year: yearField,
  title: requiredText("Title", 500),
  authors: requiredText("Authors", 1000),
  venue: requiredText("Venue", 500),
  pdfUrl: optionalHttpUrl("PDF URL"),
  doiUrl: optionalHttpUrl("DOI URL"),
  extraUrl: optionalHttpUrl("Extra link URL"),
  extraLabel: z.string().trim().max(60, "Extra link label must be at most 60 characters."),
  ...publicationMetadataFields,
};

export const createPublicationSchema = z.object({
  year: publicationFields.year,
  title: publicationFields.title,
  authors: publicationFields.authors,
  venue: publicationFields.venue,
  pdfUrl: publicationFields.pdfUrl.optional().default(""),
  doiUrl: publicationFields.doiUrl.optional().default(""),
  extraUrl: publicationFields.extraUrl.optional().default(""),
  extraLabel: publicationFields.extraLabel.optional().default(""),
  // Optional metadata: a request that omits all of it (an older client) is still valid and stores "not stated".
  status: publicationFields.status.optional().default(""),
  listNumber: publicationFields.listNumber.optional().default(""),
  category: publicationFields.category.optional().default(""),
  volume: publicationFields.volume.optional().default(""),
  startPage: publicationFields.startPage.optional().default(0),
  endPage: publicationFields.endPage.optional().default(0),
  month: publicationFields.month.optional().default(0),
  acceptedDate: publicationFields.acceptedDate.optional().default(""),
  /** Lab managers and admins only (403 for anyone else); omitted = PUBLIC. */
  visibility: visibilitySchema.optional(),
  /** Optional team members to link as authors, applied in the same transaction as the create. */
  teamMemberIds: teamMemberIdListSchema.optional(),
  /** Japanese title/venue override (Phase 19); see translations.ts. */
  translations: translationsField(PUBLICATION_TRANSLATION_MAX),
  /** Explicit confirmation that a flagged near-duplicate is a different record (lab manager or admin only; see duplicates.ts). */
  confirmDuplicate: confirmDuplicateField,
}).superRefine((v, ctx) => {
  const problem = pageRangeProblem(v.startPage, v.endPage);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ["endPage"] });
});
export type CreatePublicationInput = z.infer<typeof createPublicationSchema>;

export const updatePublicationSchema = z
  .object({
    year: publicationFields.year.optional(),
    title: publicationFields.title.optional(),
    authors: publicationFields.authors.optional(),
    venue: publicationFields.venue.optional(),
    pdfUrl: publicationFields.pdfUrl.optional(),
    doiUrl: publicationFields.doiUrl.optional(),
    extraUrl: publicationFields.extraUrl.optional(),
    extraLabel: publicationFields.extraLabel.optional(),
    // Optional metadata: omitted = the stored value is kept; "" / 0 / null clears it.
    status: publicationFields.status.optional(),
    listNumber: publicationFields.listNumber.optional(),
    category: publicationFields.category.optional(),
    volume: publicationFields.volume.optional(),
    startPage: publicationFields.startPage.optional(),
    endPage: publicationFields.endPage.optional(),
    month: publicationFields.month.optional(),
    acceptedDate: publicationFields.acceptedDate.optional(),
    /** Lab managers and admins only (403 for anyone else). */
    visibility: visibilitySchema.optional(),
    /** When present, replaces the full set of linked team members (same transaction as the field update). */
    teamMemberIds: teamMemberIdListSchema.optional(),
    /** Japanese title/venue override (Phase 19). */
    translations: translationsField(PUBLICATION_TRANSLATION_MAX),
    confirmDuplicate: confirmDuplicateField,
  })
  .refine(hasUpdateField, "Nothing to update.")
  // Only checked here when BOTH pages are in the request; the route checks the other cases against the stored values.
  .refine((v) => !pageRangeProblem(v.startPage ?? 0, v.endPage ?? 0), { message: "Ending page must not be before the starting page.", path: ["endPage"] });
export type UpdatePublicationInput = z.infer<typeof updatePublicationSchema>;

export const setPublicationAuthorsSchema = z.object({ teamMemberIds: teamMemberIdListSchema });
export type SetPublicationAuthorsInput = z.infer<typeof setPublicationAuthorsSchema>;

export const publicationAuthorsResponseSchema = z.object({ teamMemberIds: z.array(z.string()) });
export type PublicationAuthorsResponse = z.infer<typeof publicationAuthorsResponseSchema>;

// ---- Phase 19: the knowledge hub ----------------------------------------------------
export const PUBLICATION_SORTS = ["newest", "oldest", "title"] as const;
export type PublicationSort = (typeof PUBLICATION_SORTS)[number];
export const PUBLICATION_DEFAULT_LIMIT = 20;
export const PUBLICATION_MAX_LIMIT = 50;
export const PUBLICATION_MAX_PAGE = 10000;
/** How many related news items / events a publication page lists (they come through its projects). */
export const PUBLICATION_RELATED_LIMIT = 6;

const one = (v: unknown) => (Array.isArray(v) ? v[v.length - 1] : v); // ?a=1&a=2 -> the last value, never an array

function queryInt(label: string, min: number, max: number) {
  const message = `${label} must be a whole number between ${min} and ${max}.`;
  return z.preprocess(one, z.string({ invalid_type_error: message }).optional()).transform((value, ctx) => {
    if (value === undefined || value === "") return undefined;
    if (!/^\d{1,7}$/.test(value) || Number(value) < min || Number(value) > max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return Number(value);
  });
}

function idParam(label: string) {
  const message = `${label} must be an id.`;
  return z.preprocess(one, z.string({ invalid_type_error: message }).optional()).transform((value, ctx) => {
    if (value === undefined || value === "") return undefined;
    if (!ID_PATTERN.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return value;
  });
}

function enumParam<T extends readonly [string, ...string[]]>(values: T, label: string) {
  const message = `${label} must be one of: ${values.join(", ")}.`;
  return z.preprocess(one, z.string({ invalid_type_error: message }).optional()).transform((value, ctx) => {
    if (value === undefined || value === "") return undefined;
    if (!(values as readonly string[]).includes(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return value as T[number];
  });
}

const textParam = z.preprocess(one, z.string({ invalid_type_error: "Search text must be text." }).max(SEARCH_QUERY_MAX_LENGTH, `Search text must be at most ${SEARCH_QUERY_MAX_LENGTH} characters.`).optional()).transform((v, ctx) => {
  const parsed = parseSearchText((v ?? "").trim());
  if (parsed.terms.length > SEARCH_MAX_TERMS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Search text can have at most ${SEARCH_MAX_TERMS} words.` });
    return z.NEVER;
  }
  return parsed;
});

/** GET /api/publications/browse. Every value is optional; a malformed one is a 400, never silently ignored. */
export const publicationListQuerySchema = z.object({
  q: textParam,
  year: queryInt("Year", MIN_PUBLICATION_YEAR, MAX_PUBLICATION_YEAR),
  researcher: idParam("Researcher"),
  project: idParam("Project"),
  area: idParam("Research area"),
  group: idParam("Group"),
  /** Managers only (a member sending it gets 403: the filter would reveal which rows are LAB_ONLY). */
  visibility: enumParam(["PUBLIC", "LAB_ONLY"] as const, "Visibility"),
  sort: enumParam(PUBLICATION_SORTS, "Sort"),
  page: queryInt("Page", 1, PUBLICATION_MAX_PAGE),
  limit: queryInt("Limit", 1, PUBLICATION_MAX_LIMIT),
});
export type PublicationListQuery = z.infer<typeof publicationListQuerySchema>;

export interface PublicationListResponse {
  items: Publication[];
  /** Rows matching the filters, after visibility. */
  total: number;
  page: number;
  limit: number;
  pageCount: number;
  /** Every year that has a publication THIS viewer may see (unfiltered), newest first, for the year filter. */
  years: number[];
}

/** A linked researcher's public card fields (never an account id or email). */
export interface PublicationResearcher {
  id: string;
  name: string;
  initials: string;
  role: string;
}

/**
 * One publication with what it is really linked to. `researchers` and `projects` are direct links
 * (PublicationAuthor, ProjectPublication); `areas`, `groups`, `news` and `events` are DERIVED through
 * the publication's VISIBLE projects, because the schema links those to Project only.
 */
export interface PublicationDetail extends Publication {
  researchers: PublicationResearcher[];
  projects: ProjectRef[];
  areas: AreaRef[];
  groups: GroupRef[];
  news: NewsItem[];
  events: LabEvent[];
  /** Server-computed from the central policy, so the page never re-derives who may edit. */
  canEdit: boolean;
  canDelete: boolean;
}
