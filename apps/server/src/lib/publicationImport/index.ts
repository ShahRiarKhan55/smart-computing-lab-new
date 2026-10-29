import type { PrismaClient } from "@prisma/client";
import { crossRecordWarnings, mapRecord, type Candidate, type Overrides } from "./map.js";
import { planImport, type ExistingPublication, type Plan } from "./plan.js";
import { parseFormSheets, type ParsedSheets } from "./sheet.js";
import { readWorkbook } from "./xlsx.js";

export * from "./apply.js";
export * from "./map.js";
export * from "./plan.js";
export * from "./report.js";
export * from "./sheet.js";
export * from "./xlsx.js";

/** The columns the migration 20261029120000_publication_bibliographic_fields adds. */
export const NEW_COLUMNS = ["status", "pubMonth", "volume", "pageStart", "pageEnd", "issn", "isbn", "category", "acceptedDate"] as const;
const LEGACY_COLUMNS = ["id", "title", "authors", "venue", "year", "doiUrl"] as const;

export interface BuiltPlan {
  parsed: ParsedSheets;
  candidates: Candidate[];
  plan: Plan;
}

/** Parse the workbook, map every record and classify it against `existing`. Pure: no database access, no writes. */
export function buildPlan(workbook: Buffer, existing: readonly ExistingPublication[], overrides?: Overrides): BuiltPlan {
  const parsed = parseFormSheets(readWorkbook(workbook).sheets);
  const records = parsed.records.filter((r) => !r.empty);
  const candidates = records.map((r) => mapRecord(r, overrides));
  crossRecordWarnings(candidates);
  return { parsed, candidates, plan: planImport(candidates, existing) };
}

/**
 * The publications already stored, read with a plain SELECT of named columns (so a database that has not had the migration yet can still be
 * planned against: its missing columns read as "not stated"). Nothing is written.
 */
export async function loadExistingPublications(db: PrismaClient): Promise<{ rows: ExistingPublication[]; hasNewColumns: boolean }> {
  const info = (await db.$queryRawUnsafe(`PRAGMA table_info("Publication")`)) as Array<{ name: string }>;
  const present = new Set(info.map((c) => c.name));
  if (!LEGACY_COLUMNS.every((c) => present.has(c))) throw new Error("The target does not look like this application's database: the Publication table is missing or has unexpected columns.");
  const hasNewColumns = NEW_COLUMNS.every((c) => present.has(c));
  const cols = [...LEGACY_COLUMNS, ...NEW_COLUMNS.filter((c) => present.has(c))].map((c) => `"${c}"`).join(", ");
  const raw = (await db.$queryRawUnsafe(`SELECT ${cols} FROM "Publication"`)) as Array<Record<string, unknown>>;
  const rows = raw.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    authors: String(r.authors),
    venue: String(r.venue),
    year: Number(r.year),
    doiUrl: String(r.doiUrl ?? ""),
    status: String(r.status ?? ""),
    pubMonth: Number(r.pubMonth ?? 0),
    volume: String(r.volume ?? ""),
    pageStart: String(r.pageStart ?? ""),
    pageEnd: String(r.pageEnd ?? ""),
    issn: String(r.issn ?? ""),
    isbn: String(r.isbn ?? ""),
    category: String(r.category ?? ""),
    acceptedDate: String(r.acceptedDate ?? ""),
  }));
  return { rows, hasNewColumns };
}
