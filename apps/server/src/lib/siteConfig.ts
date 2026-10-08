/**
 * Public, non-secret deployment settings (Phase 27 / P27.1).
 *
 * `PORTAL_URL` — the lab's public Google Sites portal. Optional: with it unset the site simply shows no portal link
 * (the URL is never guessed or invented). Must be an https URL without embedded credentials; anything else is ignored
 * (and logged once at startup by the caller) rather than rendered as a link.
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
