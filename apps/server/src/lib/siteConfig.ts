import { parseFacebookPageUrl } from "@scl/shared";

/**
 * Public, non-secret deployment settings (Phase 27 / P27.1).
 *
 * `PORTAL_URL` — the lab's public Google Sites portal. Optional: with it unset the site simply shows no portal link
 * (the URL is never guessed or invented). Must be an https URL without embedded credentials; anything else is ignored
 * (and logged once at startup by the caller) rather than rendered as a link.
 *
 * `FACEBOOK_PAGE_URL` — the lab's official Facebook Page (item A). Optional and a LINK only: no token, Meta app or Graph API is
 * involved. Must be an https URL on facebook.com / www.facebook.com / m.facebook.com pointing at a Page (see
 * `parseFacebookPageUrl`); anything else is ignored and the homepage shows its "not connected" state. Recent posts are NOT
 * retrieved (that needs an official Page plus an authorized Meta integration — see the Phase 27 doc).
 *
 * The Google Site is a separate, public-facing front door that LINKS to this application; this application is not
 * embedded in it. See docs/architecture/phase27-lab-website-integrations.md for why (session cookies, framing).
 */
export function getPortalUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.PORTAL_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** The validated official Facebook Page URL, or null (unset, malformed, non-https, or not a facebook.com Page). */
export function getFacebookPageUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return parseFacebookPageUrl(env.FACEBOOK_PAGE_URL);
}

/**
 * One concise startup notice when `FACEBOOK_PAGE_URL` is set but not acceptable, so a typo or a copied-link form that is not
 * accepted does not silently turn into the homepage's "not connected" state. Never repeats the value (it is operator input),
 * never throws, and is called once per process start (see site.routes.ts) — not per request. Returns whether it warned.
 */
export function warnIfFacebookPageUrlInvalid(env: NodeJS.ProcessEnv = process.env, warn: (message: string) => void = console.warn): boolean {
  const raw = env.FACEBOOK_PAGE_URL;
  if (raw === undefined || raw.trim() === "") return false; // unset is the normal "not connected yet" case
  if (getFacebookPageUrl(env) !== null) return false;
  warn(
    "[site-config] FACEBOOK_PAGE_URL is set but is not an acceptable official Facebook Page URL " +
      "(https on facebook.com, www.facebook.com or m.facebook.com; see docs/architecture/phase27-lab-website-integrations.md). " +
      "The homepage will show the \"not connected\" state.",
  );
  return true;
}
