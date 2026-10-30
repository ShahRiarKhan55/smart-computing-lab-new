/**
 * Pure rules for the optional publication metadata (status, list number, category, volume, start/end page, month, date of acceptance).
 * No I/O and no schema library, so they are shared by the API validation (schemas/publication.ts), the form and the display code.
 * "Not stated" is "" for text and 0 for numbers (the stored defaults); nothing here invents or converts a value.
 */

/** The three states the lab's workbook uses (出版 / 受理 / 投稿中). "" means the status is not stated. */
export const PUBLICATION_STATUSES = ["PUBLISHED", "ACCEPTED", "SUBMITTED"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const isPublicationStatus = (v: string): v is PublicationStatus => (PUBLICATION_STATUSES as readonly string[]).includes(v);

export const MAX_PUBLICATION_PAGE = 99999;
export const PUBLICATION_METADATA_TEXT_MAX = { listNumber: 100, category: 100, volume: 100 } as const;

/** True for a real calendar date written exactly YYYY-MM-DD with a year from 1900 to 2100 (2026-02-30 is not one). */
export function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Message when both pages are stated and the range runs backwards, else null. (0 = not stated, so a lone page is fine.) */
export function pageRangeProblem(startPage: number, endPage: number): string | null {
  return startPage > 0 && endPage > 0 && endPage < startPage ? "Ending page must not be before the starting page." : null;
}
