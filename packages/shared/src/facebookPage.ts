/**
 * The lab's official Facebook Page URL (Phase 27 completion, item A).
 *
 * This is a LINK only: no token, no Meta app and no Graph API call is involved, and nothing here ever builds a Page URL from
 * a name or guesses one. A value is accepted only when it is an https URL on Facebook's own host, with no credentials, port,
 * whitespace or fragment, that points at a Page-looking path rather than a login / share / redirect endpoint. Anything else is
 * rejected (the site then shows its honest "not connected" state) rather than rendered as a link.
 *
 * Policy, exactly:
 *  - scheme `https` only; host exactly `facebook.com`, `www.facebook.com` or `m.facebook.com` (no sub-domain, suffix, look-alike,
 *    `web.facebook.com` or `fb.com`); no credentials; no port other than the implicit 443; length <= 2048; no whitespace, control
 *    character or backslash anywhere in the raw value; the fragment is dropped.
 *  - PATH: at least one segment. Every segment is percent-DECODED before it is judged; a segment is rejected when it has malformed
 *    percent-encoding, a decoded control character, whitespace, `/`, `\` or `%` (so encoded separators and double encoding cannot
 *    change how the path is read), or is `.` / `..`. The first decoded segment must not be a login / share / redirect endpoint
 *    (`login`, `login.php`, `dialog`, `sharer`, `share`, `l.php`, `plugins`, `tr`, ...), compared case-insensitively.
 *  - QUERY: only these may appear, and only these survive normalization:
 *      * `profile.php?id=<1-20 digits>` (the id-based Page form) — exactly one `id`;
 *      * the copied-link tracking parameters `mibextid`, `ref` and `fbclid`, which are DROPPED from the stored value
 *        (never kept, never interpreted).
 *    Any other parameter name (including a repeated or empty one) rejects the whole value, as does `id` on any path other than
 *    `profile.php`, or `profile.php` without a valid `id`.
 *
 * Shared by the server (which validates the `FACEBOOK_PAGE_URL` setting) and the web app (which re-checks what it is given,
 * so a link is never rendered from an unvalidated string).
 */
export const FACEBOOK_PAGE_URL_MAX = 2048;

const FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com"]);

/** First path segments that are actions or redirectors, not Pages. */
const NOT_A_PAGE = new Set([
  "login", "login.php", "dialog", "sharer", "sharer.php", "share", "share.php", "l.php", "plugins", "tr", "recover", "help",
  "policies", "privacy", "terms", "ads", "r.php", "checkpoint", "logout.php",
]);

/** Query parameters a copied link carries that are safe to discard. Nothing else is ever tolerated. */
const TRACKING_PARAMS = new Set(["mibextid", "ref", "fbclid"]);

/** The percent-decoded form of one raw path segment, or `null` when the segment is unacceptable. */
function decodeSegment(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null; // malformed percent-encoding
  }
  if (/[\u0000-\u001f\u007f-\u009f\s/\\%]/.test(decoded)) return null; // control chars, whitespace, separators, double encoding
  if (decoded === "." || decoded === "..") return null;
  return decoded;
}

/** The normalized Page URL (https, no fragment, no tracking parameters), or `null` when `value` is not an acceptable official-Page URL. */
export function parseFacebookPageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw === "" || raw.length > FACEBOOK_PAGE_URL_MAX) return null;
  // The URL parser silently strips tabs/newlines and treats "\" as "/", so refuse such input before parsing it.
  if (/[\s\u0000-\u001f\u007f\\]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!FACEBOOK_HOSTS.has(url.hostname)) return null; // exact match: no sub-domain, suffix or look-alike host
  if (url.pathname.includes("//")) return null;

  const rawSegments = url.pathname.split("/").filter(Boolean);
  if (rawSegments.length === 0) return null;
  const segments: string[] = [];
  for (const s of rawSegments) {
    const d = decodeSegment(s);
    if (d === null) return null;
    segments.push(d);
  }
  const first = segments[0].toLowerCase();
  if (NOT_A_PAGE.has(first)) return null;

  // Query: the id-based form is required for profile.php; tracking parameters are dropped; everything else rejects.
  let id: string | null = null;
  for (const [key, val] of new URLSearchParams(url.search)) {
    if (key === "id") {
      if (id !== null) return null; // repeated id
      id = val;
    } else if (!TRACKING_PARAMS.has(key)) {
      return null; // unknown (or empty) parameter name
    }
  }
  if (segments.length === 1 && first === "profile.php") {
    if (id === null || !/^\d{1,20}$/.test(id)) return null;
    return `https://${url.hostname}${url.pathname}?id=${id}`;
  }
  if (id !== null) return null; // `id` is only meaningful on profile.php
  return `https://${url.hostname}${url.pathname}`;
}
