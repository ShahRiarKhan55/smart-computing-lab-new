/**
 * Pure helpers for routes/sitemap.routes.ts (Phase 26 §14), split out so they can be unit tested
 * without a running server/database — see scripts/unit-sitemap.test.ts.
 */

/** Static, always-public pages — see routes/sitemap.routes.ts for why each dynamic detail type is
 * (or is not) included alongside these. */
export const STATIC_PUBLIC_PATHS = [
  "/",
  "/research",
  "/projects",
  "/groups",
  "/team",
  "/alumni",
  "/publications",
  "/news",
  "/events",
  "/knowledge",
  "/resources",
  "/gallery",
  "/contact",
];

/**
 * Validates and normalizes `PUBLIC_BASE_URL` (a raw string, typically `process.env.PUBLIC_BASE_URL`).
 * Returns `null` for anything unset, empty, not a syntactically valid absolute URL, or not
 * http(s) — the caller (routes/sitemap.routes.ts) treats `null` as "sitemap not configured" rather
 * than guessing/fabricating a domain (Phase 24 deliberately deferred picking one; Phase 26 does not
 * invent one either). A trailing slash is stripped so `${base}${path}` never doubles one up.
 */
export function normalizeBaseUrl(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return trimmed.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Escapes the five XML-significant characters for use inside a `<loc>` text node. Hostile input
 * here would have to come from `PUBLIC_BASE_URL` (operator-controlled, not user input) or a
 * server-generated cuid id, but every `<loc>` is still escaped on principle — never trust-by-origin. */
export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
