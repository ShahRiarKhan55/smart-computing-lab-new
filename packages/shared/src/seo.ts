/**
 * Pure, DOM-free helpers for the web app's public-page SEO metadata (Phase 24). Kept here (not in
 * apps/web) so the truncation logic can be unit-tested the same way every other pure shared
 * function is (apps/server/scripts/unit-*.test.ts via tsx) — the DOM writes themselves live in
 * apps/web/src/hooks/useSeo.ts, the only place that touches `document`.
 */

/**
 * Collapses whitespace and truncates `text` to at most `max` characters for a
 * `<meta name="description">` value, cutting on a word boundary (never mid-word) and appending an
 * ellipsis only when truncated. Never throws on empty/short input.
 */
export function truncateForMeta(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // Only break on the last space if it doesn't throw away most of the excerpt.
  const base = lastSpace > max * 0.4 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}
