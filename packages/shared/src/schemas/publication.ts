import { z } from "zod";
import { ID_PATTERN, optionalHttpUrl, requiredText, teamMemberIdListSchema } from "./common.js";
import { visibilitySchema } from "./enums.js";
import type { LabEvent } from "./event.js";
import type { NewsItem } from "./news.js";
import type { AreaRef, GroupRef, ProjectRef } from "./project.js";
import { parseSearchText, SEARCH_MAX_TERMS, SEARCH_QUERY_MAX_LENGTH } from "./search.js";
import { translationsField } from "./translations.js";
import { confirmDuplicateField, hasUpdateField } from "../duplicates.js";
import { PUBLICATION_STATUSES, isIsbn, isIsoDate, isIssn, type PublicationStatusOrNone } from "../publicationMeta.js";

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
  /** Optional bibliographic metadata. "" / 0 mean "not stated" (never a guess); see publicationMeta.ts. */
  status: z.union([z.enum(PUBLICATION_STATUSES), z.literal("")]),
  /** 1-12, or 0 when the source states no month. */
  pubMonth: z.number(),
  volume: z.string(),
  pageStart: z.string(),
  pageEnd: z.string(),
  issn: z.string(),
  isbn: z.string(),
  category: z.string(),
  /** ISO date YYYY-MM-DD, or "". */
  acceptedDate: z.string(),
  /** Only sent to accounts that may change visibility (lab managers, admins). */
  visibility: visibilitySchema.optional(),
});
export type Publication = z.infer<typeof publicationSchema> & { status: PublicationStatusOrNone };

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

const publicationFields = {
  year: yearField,
  title: requiredText("Title", 500),
  authors: requiredText("Authors", 1000),
  venue: requiredText("Venue", 500),
  pdfUrl: optionalHttpUrl("PDF URL"),
  doiUrl: optionalHttpUrl("DOI URL"),
  extraUrl: optionalHttpUrl("Extra link URL"),
  extraLabel: z.string().trim().max(60, "Extra link label must be at most 60 characters."),
  status: z.union([z.enum(PUBLICATION_STATUSES), z.literal("")], { errorMap: () => ({ message: `Status must be one of: ${PUBLICATION_STATUSES.join(", ")}, or empty.` }) }),
  // The form sends the month as text; "" means "not stated" (0).
  pubMonth: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? 0 : Number(v)) : v),
    z.number({ invalid_type_error: "Month must be a number." }).int("Month must be a whole number.").min(0, "Month must be between 1 and 12.").max(12, "Month must be between 1 and 12."),
  ),
  volume: z.string().trim().max(100, "Volume must be at most 100 characters."),
  pageStart: z.string().trim().max(30, "Start page must be at most 30 characters."),
  pageEnd: z.string().trim().max(30, "End page must be at most 30 characters."),
  issn: z.string().trim().max(9, "ISSN must look like 1234-5678.").refine((v) => v === "" || isIssn(v), "ISSN must look like 1234-5678."),
  isbn: z.string().trim().max(20, "ISBN must be a valid ISBN-10 or ISBN-13.").refine((v) => v === "" || isIsbn(v), "ISBN must be a valid ISBN-10 or ISBN-13."),
  category: z.string().trim().max(200, "Category must be at most 200 characters."),
  acceptedDate: z.string().trim().refine((v) => v === "" || isIsoDate(v), "Acceptance date must be a real date written YYYY-MM-DD."),
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
  status: publicationFields.status.optional().default(""),
  pubMonth: publicationFields.pubMonth.optional().default(0),
  volume: publicationFields.volume.optional().default(""),
  pageStart: publicationFields.pageStart.optional().default(""),
  pageEnd: publicationFields.pageEnd.optional().default(""),
  issn: publicationFields.issn.optional().default(""),
  isbn: publicationFields.isbn.optional().default(""),
  category: publicationFields.category.optional().default(""),
  acceptedDate: publicationFields.acceptedDate.optional().default(""),
  /** Lab managers and admins only (403 for anyone else); omitted = PUBLIC. */
  visibility: visibilitySchema.optional(),
  /** Optional team members to link as authors, applied in the same transaction as the create. */
  teamMemberIds: teamMemberIdListSchema.optional(),
  /** Japanese title/venue override (Phase 19); see translations.ts. */
  translations: translationsField(PUBLICATION_TRANSLATION_MAX),
  /** Explicit confirmation that a flagged near-duplicate is a different record (lab manager or admin only; see duplicates.ts). */
  confirmDuplicate: confirmDuplicateField,
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
    status: publicationFields.status.optional(),
    pubMonth: publicationFields.pubMonth.optional(),
    volume: publicationFields.volume.optional(),
    pageStart: publicationFields.pageStart.optional(),
    pageEnd: publicationFields.pageEnd.optional(),
    issn: publicationFields.issn.optional(),
    isbn: publicationFields.isbn.optional(),
    category: publicationFields.category.optional(),
    acceptedDate: publicationFields.acceptedDate.optional(),
    /** Lab managers and admins only (403 for anyone else). */
    visibility: visibilitySchema.optional(),
    /** When present, replaces the full set of linked team members (same transaction as the field update). */
    teamMemberIds: teamMemberIdListSchema.optional(),
    /** Japanese title/venue override (Phase 19). */
    translations: translationsField(PUBLICATION_TRANSLATION_MAX),
    confirmDuplicate: confirmDuplicateField,
  })
  .refine(hasUpdateField, "Nothing to update.");
export type UpdatePublicationInput = z.infer<typeof updatePublicationSchema>;

export const setPublicationAuthorsSchema = z.object({ teamMemberIds: teamMemberIdListSchema });
export type SetPublicationAuthorsInput = z.infer<typeof setPublicationAuthorsSchema>;

export const publicationAuthorsResponseSchema = z.object({ teamMemberIds: z.array(z.string()) });
export type PublicationAuthorsResponse = z.infer<typeof publicationAuthorsResponseSchema>;

// ---- Phase 19: the knowledge hub ----------------------------------------------------
export const PUBLICATION_SORTS = ["newest", "oldest", "title"] as const;
/** The status filter of the browse endpoint: one of the three statuses, or UNSPECIFIED for records that state none. */
export const PUBLICATION_STATUS_FILTERS = [...PUBLICATION_STATUSES, "UNSPECIFIED"] as const;
export type PublicationStatusFilter = (typeof PUBLICATION_STATUS_FILTERS)[number];
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
  status: enumParam(PUBLICATION_STATUS_FILTERS, "Status"),
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
