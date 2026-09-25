import type { Prisma, PrismaClient } from "@prisma/client";
import type { Request } from "express";
import { DEFAULT_LOCALE, isSupportedLocale, TRANSLATABLE_FIELDS, type Locale, type TranslatableEntityType } from "@scl/shared";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Phase 14 domain-content localization. English (the base locale) lives in each entity's own
 * columns and is never stored in `Translation` (schema.prisma convention); everything here treats
 * "en" as "no override, nothing to look up" so an English visitor's request path is unchanged from
 * before this phase — same query count, same response shape, same content.
 */

/** The visitor's requested locale, from the `X-Locale` header the web app sends on every request
 * (see apps/web/src/lib/api.ts). Never trusts the raw value: anything outside `LOCALES` — a typo, a
 * tampered header, `?lang=`-style injection attempts — silently becomes English. This never affects
 * visibility: it only selects which language's text a query result is shown in. */
export function resolveLocale(req: Request): Locale {
  const raw = req.get("X-Locale");
  return isSupportedLocale(raw) ? raw : DEFAULT_LOCALE;
}

/**
 * Batch-loads every override this locale has for the given ids in ONE query, never one query per
 * row (Phase 14 §38 performance rule). Returns `entityId -> { field -> value }`.
 */
export async function loadTranslations(
  db: Db,
  entityType: TranslatableEntityType,
  ids: string[],
  locale: Locale,
): Promise<Map<string, Record<string, string>>> {
  const map = new Map<string, Record<string, string>>();
  if (locale === DEFAULT_LOCALE || ids.length === 0) return map;
  const fields = TRANSLATABLE_FIELDS[entityType] as readonly string[];
  const rows = await db.translation.findMany({
    where: { entityType, entityId: { in: ids }, locale },
    select: { entityId: true, field: true, value: true },
  });
  for (const row of rows) {
    if (!fields.includes(row.field)) continue; // defence in depth against a stale/foreign row
    const entry = map.get(row.entityId) ?? {};
    entry[row.field] = row.value;
    map.set(row.entityId, entry);
  }
  return map;
}

/**
 * Overlays this locale's override onto a row's allow-listed fields, falling back to the row's own
 * (English) value whenever there is no override — a translated field is never blank, `null` or
 * `undefined` just because a Japanese override hasn't been written yet. Fields not in the allow-list
 * (id, slug, sortOrder, visibility, relationships, …) are always returned unchanged.
 */
export function localize<T extends { id: string }>(
  row: T,
  entityType: TranslatableEntityType,
  translations: Map<string, Record<string, string>>,
): T {
  const overrides = translations.get(row.id);
  if (!overrides) return row;
  const fields = TRANSLATABLE_FIELDS[entityType] as readonly string[];
  const out = { ...row };
  for (const field of fields) {
    const value = overrides[field];
    if (value) (out as Record<string, unknown>)[field] = value;
  }
  return out;
}

/**
 * Applies the `translations.ja` fragment of a validated create/update body inside the caller's own
 * transaction, so a rejected write never leaves a half-applied override. Per field: a non-empty
 * string upserts the override; "" or null clears it (falls back to English); a field simply absent
 * from `ja` is left untouched. XSS note: the value is stored and later rendered as plain text by
 * React (never `dangerouslySetInnerHTML`), exactly like every other user-authored field.
 */
export async function applyTranslationOverrides(
  tx: Prisma.TransactionClient,
  entityType: TranslatableEntityType,
  entityId: string,
  ja: Record<string, string | null | undefined> | undefined,
): Promise<void> {
  if (!ja) return;
  const fields = TRANSLATABLE_FIELDS[entityType] as readonly string[];
  for (const field of fields) {
    if (!(field in ja)) continue;
    const value = ja[field];
    if (value === null || value === undefined || value.trim() === "") {
      await tx.translation.deleteMany({ where: { entityType, entityId, locale: "ja", field } });
    } else {
      await tx.translation.upsert({
        where: { entityType_entityId_locale_field: { entityType, entityId, locale: "ja", field } },
        create: { entityType, entityId, locale: "ja", field, value: value.trim() },
        update: { value: value.trim() },
      });
    }
  }
}

/** The current Japanese override for each of this entity's allow-listed fields (`null` where none
 * exists), for prefilling the "Japanese translation" section of its edit form. */
export async function getEntityTranslations(
  db: Db,
  entityType: TranslatableEntityType,
  entityId: string,
): Promise<Record<string, string | null>> {
  const fields = TRANSLATABLE_FIELDS[entityType] as readonly string[];
  const rows = await db.translation.findMany({
    where: { entityType, entityId, locale: "ja" },
    select: { field: true, value: true },
  });
  const byField = new Map(rows.map((r) => [r.field, r.value]));
  return Object.fromEntries(fields.map((f) => [f, byField.get(f) ?? null]));
}

/** Prisma delegate name per translatable entity (the tables `TRANSLATABLE_FIELDS` describes). */
const BASE_DELEGATE = {
  RESEARCH_AREA: "researchArea",
  RESEARCH_PROJECT: "researchProject",
  RESEARCH_GROUP: "researchGroup",
  NEWS_ITEM: "newsItem",
  EVENT: "event",
  TEAM_MEMBER: "teamMember",
} as const satisfies Record<TranslatableEntityType, string>;

/**
 * The entity's own ENGLISH (base-language) text for each allow-listed field, `null` for a missing
 * entity. Edit forms need it: a page fetched in Japanese already carries the Japanese override in
 * `title`/`description`, so prefilling the English inputs from that response and saving would overwrite
 * the English column with Japanese. Same visibility as `getEntityTranslations` (signed-in only, and
 * these are the very columns every English visitor already reads from the entity's own GET).
 */
export async function getEntityBase(db: Db, entityType: TranslatableEntityType, entityId: string): Promise<Record<string, string | null>> {
  const fields = TRANSLATABLE_FIELDS[entityType] as readonly string[];
  const delegate = (db as unknown as Record<string, { findUnique: (a: unknown) => Promise<Record<string, unknown> | null> }>)[BASE_DELEGATE[entityType]];
  const row = await delegate.findUnique({ where: { id: entityId }, select: Object.fromEntries(fields.map((f) => [f, true])) });
  return Object.fromEntries(fields.map((f) => [f, typeof row?.[f] === "string" ? (row[f] as string) : null]));
}
