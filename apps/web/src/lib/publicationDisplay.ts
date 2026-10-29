import { formatPageRange, type Locale, type Publication, type PublicationStatusOrNone, type TranslationKey } from "@scl/shared";

type Translator = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/** `Intl`'s BCP-47 tag for each app `Locale`. */
const INTL: Record<Locale, string> = { en: "en-US", ja: "ja-JP" };

export const STATUS_ORDER: PublicationStatusOrNone[] = ["ACCEPTED", "SUBMITTED", "PUBLISHED", ""];

export const STATUS_LABEL_KEY: Record<PublicationStatusOrNone, TranslationKey> = {
  PUBLISHED: "publications.status.published",
  ACCEPTED: "publications.status.accepted",
  SUBMITTED: "publications.status.submitted",
  "": "publications.status.unspecified",
};

export const STATUS_SECTION_KEY: Record<PublicationStatusOrNone, TranslationKey> = {
  PUBLISHED: "publications.section.published",
  ACCEPTED: "publications.section.accepted",
  SUBMITTED: "publications.section.submitted",
  "": "publications.section.unspecified",
};

/** An ISO date (YYYY-MM-DD) as a calendar date in the locale's long-ish form, never shifted by the viewer's time zone. */
export function formatIsoDate(iso: string, locale: Locale): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(INTL[locale], { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Nov 2023" when a month is stated, otherwise just the year. */
export function formatYearMonth(year: number, month: number, locale: Locale): string {
  if (month >= 1 && month <= 12) return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(INTL[locale], { year: "numeric", month: "short", timeZone: "UTC" });
  return String(year);
}

/**
 * True when the stored `year` may merely be the year of the acceptance date. The importer uses that year, and only when the source states no
 * publication year, to keep the record sortable; such a record has no month and a status other than PUBLISHED. It must NEVER be presented as
 * the year the paper was published, so the UI then shows the acceptance date instead of the year.
 */
export function yearMayBeAcceptanceYear(p: Pick<Publication, "status" | "pubMonth" | "year" | "acceptedDate">): boolean {
  return p.status !== "PUBLISHED" && p.pubMonth === 0 && p.acceptedDate !== "" && p.acceptedDate.startsWith(String(p.year));
}

/** The date text of a card or detail line: the issue date, or (when the year could be derived) the acceptance date. */
export function publicationDateLabel(p: Publication, locale: Locale, t: Translator): string {
  if (yearMayBeAcceptanceYear(p)) return t("publications.acceptanceDate", { date: formatIsoDate(p.acceptedDate, locale) });
  return formatYearMonth(p.year, p.pubMonth, locale);
}

/** Whether the structured data may claim a publication date. Never for an accepted / submitted paper, never for a possibly derived year. */
export function mayClaimDatePublished(p: Pick<Publication, "status" | "pubMonth" | "year" | "acceptedDate">): boolean {
  return (p.status === "PUBLISHED" || p.status === "") && !yearMayBeAcceptanceYear(p);
}

/** ISO "YYYY" or "YYYY-MM" for structured data. */
export function isoYearMonth(p: Pick<Publication, "pubMonth" | "year">): string {
  return p.pubMonth >= 1 ? `${p.year}-${String(p.pubMonth).padStart(2, "0")}` : String(p.year);
}

/** The short bibliographic fragments of a card ("Volume 7(3), 53", "pp. 1–27", "ISSN ..."), only those the source supplied. */
export function publicationMetaParts(p: Publication, t: Translator): string[] {
  const parts: string[] = [];
  if (p.volume) parts.push(t("publications.meta.volume", { value: p.volume }));
  const pages = formatPageRange(p.pageStart, p.pageEnd);
  if (pages) parts.push(t(p.pageStart && p.pageEnd && p.pageStart !== p.pageEnd ? "publications.meta.pages" : "publications.meta.pagesOne", { value: pages }));
  if (p.issn) parts.push(t("publications.meta.issn", { value: p.issn }));
  if (p.isbn) parts.push(t("publications.meta.isbn", { value: p.isbn }));
  return parts;
}
