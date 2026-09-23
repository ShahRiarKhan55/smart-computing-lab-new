import { z } from "zod";
import { requiredText, sortOrderField } from "./common.js";
import { visibilitySchema } from "./enums.js";
import { translationsField } from "./translations.js";

/** Mirrors the English field lengths above — see i18n/translatableFields.ts (RESEARCH_AREA). */
export const RESEARCH_AREA_TRANSLATION_MAX = { title: 200, description: 2000 };

export const researchAreaSchema = z.object({
  id: z.string(),
  icon: z.string(),
  title: z.string(),
  description: z.string(),
  tag: z.string(),
  sortOrder: z.number(),
  /** Only sent to accounts that may change visibility (lab managers, admins). */
  visibility: visibilitySchema.optional(),
});
export type ResearchArea = z.infer<typeof researchAreaSchema>;

const DEFAULT_ICON = "🔬";

/** A blank icon falls back to the default, like the reference (`icon ?? '🔬'`) and the news emoji. */
const iconField = z
  .string({ invalid_type_error: "Icon must be text." })
  .trim()
  .max(16, "Icon must be at most 16 characters.")
  .transform((v) => v || DEFAULT_ICON);

const researchFields = {
  icon: iconField,
  title: requiredText("Title", 200),
  description: requiredText("Description", 2000),
  tag: requiredText("Tag", 60),
  sortOrder: sortOrderField,
};

export const createResearchAreaSchema = z.object({
  icon: researchFields.icon.optional().default(DEFAULT_ICON),
  title: researchFields.title,
  description: researchFields.description,
  tag: researchFields.tag,
  sortOrder: researchFields.sortOrder.optional().default(0),
  /** Lab managers and admins only (403 for anyone else); omitted = PUBLIC. */
  visibility: visibilitySchema.optional(),
  /** Japanese title/description override (Phase 14); see translations.ts. */
  translations: translationsField(RESEARCH_AREA_TRANSLATION_MAX),
});
export type CreateResearchAreaInput = z.infer<typeof createResearchAreaSchema>;

export const updateResearchAreaSchema = z
  .object({
    icon: researchFields.icon.optional(),
    title: researchFields.title.optional(),
    description: researchFields.description.optional(),
    tag: researchFields.tag.optional(),
    sortOrder: researchFields.sortOrder.optional(),
    /** Lab managers and admins only (403 for anyone else). */
    visibility: visibilitySchema.optional(),
    translations: translationsField(RESEARCH_AREA_TRANSLATION_MAX),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");
export type UpdateResearchAreaInput = z.infer<typeof updateResearchAreaSchema>;
