/**
 * Allow-list of entity/field pairs that may carry a non-English override in the `Translation`
 * table (see schema.prisma's `Translation` model docstring — this is that allow-list). Only
 * base-language content columns are listed here; ids, slugs, sort order, visibility, relationships
 * and every other structural field always stay on the entity itself, in every locale.
 *
 * Adding a translatable field = one entry here, one line in each route's `TRANSLATION_FIELD_MAX`,
 * and the serializer already picks it up via `localize()` (lib/translations.ts on the server).
 */
export const TRANSLATABLE_FIELDS = {
  RESEARCH_AREA: ["title", "description"],
  RESEARCH_PROJECT: ["title", "summary", "description"],
  RESEARCH_GROUP: ["name", "description"],
  NEWS_ITEM: ["title", "description"],
  EVENT: ["title", "description"],
  KNOWLEDGE_DOC: ["title", "body"],
  PUBLICATION: ["title", "venue"],
  TEAM_MEMBER: ["bio"],
} as const;

export type TranslatableEntityType = keyof typeof TRANSLATABLE_FIELDS;

export function isTranslatableEntityType(value: string): value is TranslatableEntityType {
  return Object.prototype.hasOwnProperty.call(TRANSLATABLE_FIELDS, value);
}

export function translatableFieldsOf(entityType: TranslatableEntityType): readonly string[] {
  return TRANSLATABLE_FIELDS[entityType];
}
