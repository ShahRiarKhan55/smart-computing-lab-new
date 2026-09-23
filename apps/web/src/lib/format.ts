import type { Locale } from "@scl/shared";

/** `Intl`'s BCP-47 tag for each app `Locale` — the only place this mapping lives. */
const INTL_LOCALE: Record<Locale, string> = { en: "en-US", ja: "ja-JP" };

/** "Jan 2030 – Jun 2031" from two "YYYY-MM-DD" dates, locale-aware via `Intl.DateTimeFormat`. */
export function formatProjectDateRange(start: string, end: string, locale: Locale): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(INTL_LOCALE[locale], { month: "short", year: "numeric", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}`;
}

/** A single "YYYY-MM-DD" date as "Jan 2030", locale-aware. */
export function formatMonthYear(iso: string, locale: Locale): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(INTL_LOCALE[locale], { month: "short", year: "numeric", timeZone: "UTC" });
}

/** "Sep 22, 2026, 3:45 PM" from an ISO datetime string (forum topics/comments, messages,
 * notifications), locale-aware via `Intl.DateTimeFormat`. */
export function formatDateTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(INTL_LOCALE[locale], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** A plain integer/decimal with the locale's digit grouping, via `Intl.NumberFormat`. */
export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale]).format(n);
}

/** "48 KB" / "3.2 MB" — a file size for the upload form and gallery captions (Phase 13), with
 * locale-aware digit grouping for the numeric part. */
export function formatBytes(bytes: number, locale: Locale): string {
  if (bytes < 1024) return `${formatNumber(bytes, locale)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(Math.round(bytes / 1024), locale)} KB`;
  return `${formatNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10, locale)} MB`;
}
