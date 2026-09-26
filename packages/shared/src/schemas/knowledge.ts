import { z } from "zod";
import { idSchema, requiredText } from "./common.js";
import { visibilitySchema, type Visibility } from "./enums.js";
import { parseSearchText, SEARCH_MAX_TERMS, SEARCH_QUERY_MAX_LENGTH } from "./search.js";
import { translationsField } from "./translations.js";

/**
 * Phase 22 research knowledge base, built on the Phase 22 `KnowledgeDoc` table (the one additive
 * migration of this phase). A document is lab documentation, not a post: it has no comments, no
 * revisions and no attachments. Its links to the research graph are single nullable foreign keys
 * (project / research area / group / researcher), exactly like News, Events and Gallery.
 */

/** The `KnowledgeDoc.category` values. The column is a plain string, so this list is the allow-list. */
export const KNOWLEDGE_CATEGORIES = [
  "PROJECT_DOCUMENTATION",
  "RESEARCH_NOTE",
  "METHODOLOGY",
  "EXPERIMENT",
  "HARDWARE",
  "SOFTWARE",
  "DATASET",
  "REPRODUCIBILITY",
  "LAB_PROCEDURE",
  "RESOURCE",
] as const;
export const knowledgeCategorySchema = z.enum(KNOWLEDGE_CATEGORIES, {
  errorMap: () => ({ message: `Category must be one of: ${KNOWLEDGE_CATEGORIES.join(", ")}.` }),
});
export type KnowledgeCategory = z.infer<typeof knowledgeCategorySchema>;

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  PROJECT_DOCUMENTATION: "Project documentation",
  RESEARCH_NOTE: "Research note",
  METHODOLOGY: "Methodology",
  EXPERIMENT: "Experiment",
  HARDWARE: "Hardware",
  SOFTWARE: "Software",
  DATASET: "Dataset",
  REPRODUCIBILITY: "Reproducibility",
  LAB_PROCEDURE: "Lab procedure",
  RESOURCE: "Resource",
};

export const KNOWLEDGE_TITLE_MAX = 200;
export const KNOWLEDGE_BODY_MAX = 20000;
/** Mirrors the English field lengths — see i18n/translatableFields.ts (KNOWLEDGE_DOC). */
export const KNOWLEDGE_TRANSLATION_MAX = { title: KNOWLEDGE_TITLE_MAX, body: KNOWLEDGE_BODY_MAX };

export const KNOWLEDGE_LIST_DEFAULT_LIMIT = 12;
export const KNOWLEDGE_LIST_MAX_LIMIT = 50;
/** How many documents a research page / the workspace shows before it links to the full list. */
export const KNOWLEDGE_SECTION_LIMIT = 5;
export const KNOWLEDGE_EXCERPT_LENGTH = 200;

/** A short plain-text excerpt of a document body (used by list cards; never HTML). */
export function knowledgeExcerpt(body: string, max: number = KNOWLEDGE_EXCERPT_LENGTH): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max).trimEnd()}…`;
}

// ---- response shapes (interfaces: the web tsconfig is not strict) -----------------------------
/** A related project / area / group, present ONLY when the viewer may see it (never a hidden record's title). */
export interface KnowledgeRef {
  id: string;
  title: string;
}
/** A public team profile reference. Never an account id or e-mail. */
export interface KnowledgePerson {
  id: string;
  name: string;
}
export interface KnowledgeDocSummary {
  id: string;
  title: string;
  excerpt: string;
  category: KnowledgeCategory;
  /** The author's public team profile, or null (no profile / account deleted). */
  author: KnowledgePerson | null;
  project: KnowledgeRef | null;
  researchArea: KnowledgeRef | null;
  group: KnowledgeRef | null;
  researcher: KnowledgePerson | null;
  createdAt: string;
  updatedAt: string;
  /** Server-computed with the central policy (owner or manager); cosmetic for the UI, re-checked on every write. */
  canEdit: boolean;
  canDelete: boolean;
  /** Only sent to accounts that may change visibility (lab managers, admins). */
  visibility?: Visibility;
}
export interface KnowledgeDocDetail extends KnowledgeDocSummary {
  /** Plain text. The UI renders it as text (line breaks kept), never as HTML. */
  body: string;
}
export interface KnowledgeListResponse {
  items: KnowledgeDocSummary[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
/** A capped list on a research page / the workspace: `total` is everything the viewer may see. */
export interface KnowledgeSection {
  items: KnowledgeDocSummary[];
  total: number;
}

// ---- requests -------------------------------------------------------------------------------
const nullableId = idSchema.nullable();

const knowledgeFields = {
  title: requiredText("Title", KNOWLEDGE_TITLE_MAX),
  body: requiredText("Body", KNOWLEDGE_BODY_MAX),
  category: knowledgeCategorySchema,
  visibility: visibilitySchema,
  translations: translationsField(KNOWLEDGE_TRANSLATION_MAX),
};

export const createKnowledgeSchema = z.object({
  title: knowledgeFields.title,
  body: knowledgeFields.body,
  category: knowledgeFields.category.optional().default("RESOURCE"),
  /** Lab managers and admins only (403 for anyone else); omitted = LAB_ONLY, the table's default. */
  visibility: knowledgeFields.visibility.optional(),
  projectId: nullableId.optional(),
  researchAreaId: nullableId.optional(),
  groupId: nullableId.optional(),
  teamMemberId: nullableId.optional(),
  /** Japanese title/body override (Phase 14); see translations.ts. */
  translations: knowledgeFields.translations,
});
export type CreateKnowledgeInput = z.infer<typeof createKnowledgeSchema>;

export const updateKnowledgeSchema = z
  .object({
    title: knowledgeFields.title.optional(),
    body: knowledgeFields.body.optional(),
    category: knowledgeFields.category.optional(),
    visibility: knowledgeFields.visibility.optional(),
    projectId: nullableId.optional(),
    researchAreaId: nullableId.optional(),
    groupId: nullableId.optional(),
    teamMemberId: nullableId.optional(),
    translations: knowledgeFields.translations,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");
export type UpdateKnowledgeInput = z.infer<typeof updateKnowledgeSchema>;

/** A query-string whole number within [min, max]; absent means `fallback`. */
function intParam(label: string, min: number, max: number, fallback: number) {
  const message = `${label} must be a whole number between ${min} and ${max}.`;
  return z
    .string({ invalid_type_error: message })
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return fallback;
      if (!/^\d{1,7}$/.test(v) || Number(v) < min || Number(v) > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return Number(v);
    });
}

/** An optional id filter: absent or "" means "no filter"; anything that is not an id is a 400. */
const idParam = (label: string) =>
  z
    .string({ invalid_type_error: `${label} must be an id.` })
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return undefined;
      if (!idSchema.safeParse(v).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid id." });
        return z.NEVER;
      }
      return v;
    });

/** GET /api/knowledge query string. */
export const knowledgeListQuerySchema = z.object({
  q: z
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
    }),
  category: z
    .string({ invalid_type_error: "Category must be text." })
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return undefined;
      const r = knowledgeCategorySchema.safeParse(v);
      if (!r.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error.issues[0].message });
        return z.NEVER;
      }
      return r.data;
    }),
  project: idParam("Project"),
  area: idParam("Research area"),
  group: idParam("Group"),
  researcher: idParam("Researcher"),
  /** Lab managers and admins only (403 for anyone else). */
  visibility: z
    .string({ invalid_type_error: "Visibility must be PUBLIC or LAB_ONLY." })
    .optional()
    .transform((v, ctx): Visibility | undefined => {
      if (v === undefined || v === "") return undefined;
      const r = visibilitySchema.safeParse(v);
      if (!r.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error.issues[0].message });
        return z.NEVER;
      }
      return r.data;
    }),
  /** "1": only documents related to the signed-in researcher (the workspace's own definition). Signed-in only. */
  mine: z
    .string({ invalid_type_error: "Mine must be 1." })
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return false;
      if (v !== "1") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Mine must be 1." });
        return z.NEVER;
      }
      return true;
    }),
  page: intParam("Page", 1, 10000, 1),
  limit: intParam("Limit", 1, KNOWLEDGE_LIST_MAX_LIMIT, KNOWLEDGE_LIST_DEFAULT_LIMIT),
});
export type KnowledgeListQuery = z.infer<typeof knowledgeListQuerySchema>;
