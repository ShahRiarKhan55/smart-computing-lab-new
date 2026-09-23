import { z } from "zod";

/**
 * Builds the optional `translations: { ja: { field?: string | null } }` fragment merged into a
 * translatable entity's create/update schema (see research.ts/project.ts/group.ts/news.ts/team.ts).
 * Per field: a non-empty string sets the Japanese override; "" or null clears it (falls back to the
 * English column); omitted leaves the current override untouched. `fieldMax` mirrors the English
 * field's own max length so a Japanese override can't be used to store an unbounded blob.
 */
export function translationsField(fieldMax: Record<string, number>) {
  const jaShape: Record<string, z.ZodTypeAny> = {};
  for (const [field, max] of Object.entries(fieldMax)) {
    jaShape[field] = z
      .string({ invalid_type_error: `Japanese ${field} must be text.` })
      .max(max, `Japanese ${field} must be at most ${max} characters.`)
      .nullable()
      .optional();
  }
  return z.object({ ja: z.object(jaShape).optional() }).optional();
}

/** Response shape of `GET /api/translations/:entityType/:entityId`: the current Japanese value
 * for each allow-listed field, `null` where no override exists. */
export const translationsResponseSchema = z.object({ ja: z.record(z.string(), z.string().nullable()) });
export type TranslationsResponse = z.infer<typeof translationsResponseSchema>;
