import { z } from "zod";
import { visibilitySchema } from "./enums.js";

// ---- what can be searched -----------------------------------------------------
export const SEARCH_TYPES = ["research-area", "project", "group", "researcher", "publication", "news", "forum-topic", "event"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** The `type` query parameter: one entity type, or "all" (also the default). */
export const SEARCH_FILTERS = ["all", ...SEARCH_TYPES] as const;
export type SearchFilter = (typeof SEARCH_FILTERS)[number];

export const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  "research-area": "Research Area",
  project: "Project",
  group: "Research Group",
  researcher: "Researcher",
  publication: "Publication",
  news: "News",
  "forum-topic": "Forum Topic",
  event: "Event",
};
export const SEARCH_FILTER_LABELS: Record<SearchFilter, string> = {
  all: "All",
  "research-area": "Research Areas",
  project: "Projects",
  group: "Groups",
  researcher: "Researchers",
  publication: "Publications",
  news: "News",
  "forum-topic": "Forum Topics",
  event: "Events",
};

// ---- limits -------------------------------------------------------------------
export const SEARCH_QUERY_MAX_LENGTH = 100;
export const SEARCH_MAX_TERMS = 8;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;
export const SEARCH_MAX_PAGE = 10000;

// ---- query text -----------------------------------------------------------------
export interface ParsedSearchText {
  /** The words joined by single spaces, in the order typed (used for "starts with"). */
  phrase: string;
  /** Distinct words (case-insensitive); a result must match EVERY one of them. */
  terms: string[];
}

/**
 * Splits what the visitor typed into search words.
 *
 *  - NFKC first, so full-width "ＦＰＧＡ" and the ideographic space U+3000 behave like ASCII.
 *  - Whitespace separates words. Japanese has no spaces, so an unspaced run is ONE word and is
 *    matched as a substring: that is why plain substring matching works for it.
 *  - "%" and "_" also separate words, and so do control characters. SQLite's LIKE gives
 *    "%" and "_" a wildcard meaning that Prisma cannot escape, so treating them as literal
 *    text is not possible; treating them as separators keeps "%" from matching every row.
 */
export function parseSearchText(raw: string): ParsedSearchText {
  const words = raw
    .normalize("NFKC")
    .split(/[\s%_\p{Cc}]+/u)
    .filter(Boolean);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of words) {
    const key = word.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      terms.push(word);
    }
  }
  return { phrase: words.join(" "), terms };
}

/** A query-string number: digits only, within [min, max]; absent means `fallback`. */
function intParam(label: string, min: number, max: number, fallback: number) {
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

/** GET /api/search?q=&type=&page=&limit=  (parsed from the raw query string). */
export const searchQuerySchema = z
  .object({
    q: z
      .string({ required_error: "Search text is required.", invalid_type_error: "Search text must be text." })
      .trim()
      .min(1, "Search text is required.")
      .max(SEARCH_QUERY_MAX_LENGTH, `Search text must be at most ${SEARCH_QUERY_MAX_LENGTH} characters.`),
    type: z
      .enum(SEARCH_FILTERS, { errorMap: () => ({ message: `Type must be one of: ${SEARCH_FILTERS.join(", ")}.` }) })
      .default("all"),
    page: intParam("Page", 1, SEARCH_MAX_PAGE, 1),
    limit: intParam("Limit", 1, SEARCH_MAX_LIMIT, SEARCH_DEFAULT_LIMIT),
  })
  .transform((value, ctx) => {
    const parsed = parseSearchText(value.q);
    if (parsed.terms.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Search text must contain letters or numbers." });
      return z.NEVER;
    }
    if (parsed.terms.length > SEARCH_MAX_TERMS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Search text can have at most ${SEARCH_MAX_TERMS} words.` });
      return z.NEVER;
    }
    return { ...value, ...parsed };
  });
export type SearchQuery = z.infer<typeof searchQuerySchema>;

// ---- response shapes --------------------------------------------------------------
export const searchResultSchema = z.object({
  type: z.enum(SEARCH_TYPES),
  id: z.string(),
  title: z.string(),
  /** A short excerpt (already cut around the first match); plain text, never HTML. */
  description: z.string(),
  /** One-line context such as "2026 · IEEE Access" or "Faculty · Computer Science". */
  meta: z.string(),
  /** App-relative link to the existing page for this result. */
  href: z.string(),
  /** Only present for lab managers and admins, exactly like the normal endpoints. */
  visibility: visibilitySchema.optional(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  query: z.string(),
  type: z.enum(SEARCH_FILTERS),
  results: z.array(searchResultSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    /** Matches in the selected type(s) that THIS viewer may see. */
    total: z.number(),
    totalPages: z.number(),
  }),
  /** Matches per type for this viewer (`all` is their sum): the numbers on the filter chips. */
  counts: z.object({
    all: z.number(),
    "research-area": z.number(),
    project: z.number(),
    group: z.number(),
    researcher: z.number(),
    publication: z.number(),
    news: z.number(),
    "forum-topic": z.number(),
    event: z.number(),
  }),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
