import { z } from "zod";
import { requiredText, teamMemberIdListSchema } from "./common.js";
import { visibilitySchema } from "./enums.js";
import { translationsField } from "./translations.js";

/** Mirrors the English field lengths below — see i18n/translatableFields.ts (NEWS_ITEM). */
export const NEWS_TRANSLATION_MAX = { title: 300, description: 5000 };

export const newsItemSchema = z.object({
  id: z.string(),
  date: z.string(),
  sortDate: z.string(),
  type: z.string(),
  emoji: z.string(),
  title: z.string(),
  description: z.string(),
  /** Only sent to accounts that may change visibility (lab managers, admins). */
  visibility: visibilitySchema.optional(),
});
export type NewsItem = z.infer<typeof newsItemSchema>;

/** The type options offered by the reference news form. The API accepts any non-empty type so older data keeps validating. */
export const NEWS_TYPES = ["Paper", "Award", "Position", "Grant", "Event", "Partnership"] as const;

const DEFAULT_EMOJI = "📣";

/** sortDate is an ISO calendar date (YYYY-MM-DD) — it is what news is sorted by. */
const sortDateField = z
  .string({ required_error: "Sort date is required.", invalid_type_error: "Sort date must be text." })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Sort date must be a date in YYYY-MM-DD format.")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
  }, "Sort date is not a real calendar date.");

const emojiField = z
  .string({ invalid_type_error: "Emoji must be text." })
  .trim()
  .max(16, "Emoji must be at most 16 characters.")
  .transform((v) => v || DEFAULT_EMOJI);

const newsFields = {
  date: requiredText("Display date", 40),
  sortDate: sortDateField,
  type: requiredText("Type", 40),
  emoji: emojiField,
  title: requiredText("Title", 300),
  description: requiredText("Description", 5000),
};

export const createNewsItemSchema = z.object({
  date: newsFields.date,
  sortDate: newsFields.sortDate,
  type: newsFields.type,
  emoji: newsFields.emoji.optional().default(DEFAULT_EMOJI),
  title: newsFields.title,
  description: newsFields.description,
  /** Lab managers and admins only (403 for anyone else); omitted = PUBLIC. */
  visibility: visibilitySchema.optional(),
  /** Optional team members to link, applied in the same transaction as the create. */
  teamMemberIds: teamMemberIdListSchema.optional(),
  /** Japanese title/description override (Phase 14); see translations.ts. */
  translations: translationsField(NEWS_TRANSLATION_MAX),
});
export type CreateNewsItemInput = z.infer<typeof createNewsItemSchema>;

export const updateNewsItemSchema = z
  .object({
    date: newsFields.date.optional(),
    sortDate: newsFields.sortDate.optional(),
    type: newsFields.type.optional(),
    emoji: newsFields.emoji.optional(),
    title: newsFields.title.optional(),
    description: newsFields.description.optional(),
    /** Lab managers and admins only (403 for anyone else). */
    visibility: visibilitySchema.optional(),
    /** When present, replaces the full set of linked team members (same transaction as the field update). */
    teamMemberIds: teamMemberIdListSchema.optional(),
    translations: translationsField(NEWS_TRANSLATION_MAX),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");
export type UpdateNewsItemInput = z.infer<typeof updateNewsItemSchema>;

export const setNewsAuthorsSchema = z.object({ teamMemberIds: teamMemberIdListSchema });
export type SetNewsAuthorsInput = z.infer<typeof setNewsAuthorsSchema>;

export const newsAuthorsResponseSchema = z.object({ teamMemberIds: z.array(z.string()) });
export type NewsAuthorsResponse = z.infer<typeof newsAuthorsResponseSchema>;
