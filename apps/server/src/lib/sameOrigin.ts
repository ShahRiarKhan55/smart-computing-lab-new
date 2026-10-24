import type { Request, RequestHandler } from "express";

/**
 * CSRF guard for state-changing Google endpoints (this app had none; session cookies are SameSite=Lax, which this adds
 * to rather than replaces). A request is accepted only when it is a JSON request AND it provably comes from our own
 * origin: an `Origin` header equal to the request's own origin (or to `extraOrigins`, e.g. the configured redirect
 * URI's origin), or - when the browser sent no Origin - `Sec-Fetch-Site: same-origin`. Anything else, including a
 * missing Origin with no fetch metadata, is refused (fail closed). Outside production, any localhost/127.0.0.1 port is
 * also accepted so the Vite dev server (a different port, proxied to the API) keeps working.
 */
export function isSameOriginRequest(req: Request, extraOrigins: string[] = [], production = process.env.NODE_ENV === "production"): boolean {
  const origin = req.get("origin");
  if (origin) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return false;
    }
    if (parsed.origin === "null") return false;
    const own = `${req.protocol}://${req.get("host")}`;
    if (parsed.origin === own || extraOrigins.includes(parsed.origin)) return true;
    return !production && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  }
  return req.get("sec-fetch-site") === "same-origin";
}

export function requireSameOriginJson(getExtraOrigins: () => string[] = () => []): RequestHandler {
  return (req, res, next) => {
    if (!isSameOriginRequest(req, getExtraOrigins())) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // A cross-site HTML form cannot send application/json without a CORS preflight, so this also closes simple-form CSRF.
    if (!req.is("application/json")) {
      res.status(415).json({ error: "Request must be JSON." });
      return;
    }
    next();
  };
}
