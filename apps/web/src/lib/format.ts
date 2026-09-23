/** "Jan 2030 – Jun 2031", "Since Jan 2030", "Until Jun 2031" or "". Input dates are "YYYY-MM-DD". */
export function formatProjectDates(start: string | null, end: string | null): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `Since ${fmt(start)}`;
  if (end) return `Until ${fmt(end)}`;
  return "";
}

/** "Sep 22, 2026, 3:45 PM" from an ISO datetime string (forum topics/comments). */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "48 KB" / "3.2 MB" — a file size for the upload form and gallery captions (Phase 13). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
