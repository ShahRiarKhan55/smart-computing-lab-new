/**
 * Bibliographic metadata of a publication that the original schema had no place for (publication list import). Pure helpers shared by the
 * API validators, the import tool and the web UI so every one of them applies the SAME rules.
 *
 * Nothing here ever invents a value: every field is optional and "" / 0 mean "not stated".
 */

/** What the source says about a paper. "" (not stated) is the default for every record that carries no status. */
export const PUBLICATION_STATUSES = ["PUBLISHED", "ACCEPTED", "SUBMITTED"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];
export type PublicationStatusOrNone = PublicationStatus | "";

export const isPublicationStatus = (v: unknown): v is PublicationStatus => typeof v === "string" && (PUBLICATION_STATUSES as readonly string[]).includes(v);

/** ISSN: 4 digits, hyphen, 3 digits and a digit or X (the check digit is NOT verified: the source is trusted for what it states). */
const ISSN_PATTERN = /^\d{4}-\d{3}[\dXx]$/;
export const isIssn = (v: string): boolean => ISSN_PATTERN.test(v.trim());

/** ISBN-10 or ISBN-13 with optional hyphens/spaces (digits only counted; the check digit is NOT verified). */
export function isIsbn(v: string): boolean {
  const compact = v.trim().replace(/[-\s]/g, "");
  return /^\d{9}[\dXx]$/.test(compact) || /^97[89]\d{10}$/.test(compact);
}

/** A real calendar date written YYYY-MM-DD. */
export function isIsoDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * "1139-1150" for two pages, "1139" for a start page alone, "-1150"-style fragments are never produced: an end page without a start is
 * returned as is ("1150"). "" when neither is stated. A thin en dash is used between the numbers (typographic, display only).
 */
export function formatPageRange(start: string, end: string): string {
  const s = start.trim();
  const e = end.trim();
  if (s && e) return s === e ? s : `${s}–${e}`;
  return s || e;
}
