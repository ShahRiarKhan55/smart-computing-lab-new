import helmet from "helmet";
import type { RequestHandler } from "express";

/**
 * Production HTTP security headers (Phase 26 hardening). This app is a JSON-only API — it never
 * serves HTML, so the header choices below are deliberately scoped to what actually protects a
 * JSON API rather than a page:
 *
 * - `contentSecurityPolicy: false` — CSP is a document-level protection (script/style/frame
 *   sources for an HTML page); this server never renders one. The SPA that consumes this API is
 *   built and deployed separately (see docs/architecture/phase26-…) and carries its OWN CSP via a
 *   `<meta http-equiv="Content-Security-Policy">` tag in `apps/web/index.html` — that is the
 *   policy that actually governs the Google Calendar iframe on `/schedule` and the Google Fonts
 *   stylesheet, neither of which this server has any part in serving.
 * - `crossOriginResourcePolicy: "same-origin"` — matches this app's one documented, supported
 *   deployment topology (a single reverse proxy in front of both the static SPA build and this
 *   API, so both are same-origin from the browser's point of view; see the trust-proxy topology
 *   note in lib/trustProxy.ts). `GET /api/files/:id` is fetched by the SPA's own `<img>`/download
 *   links under that assumption. A future cross-origin deployment would need this relaxed
 *   deliberately, not by accident — documented as a limitation, not silently widened here.
 * - `crossOriginEmbedderPolicy: false` — COEP's `require-corp` would need every cross-origin
 *   resource this API's *own* responses might reference to opt in; nothing here needs the
 *   isolation guarantees COEP exists for, and enabling it is a common source of hard-to-diagnose
 *   breakage for embeds/downloads. Left off as the least-restrictive-but-still-meaningful choice.
 * - `hsts` is only ever sent in production: HSTS is cached by the browser for `maxAge` seconds and
 *   is very disruptive to unset once sent, so it must never be sent to a plain-HTTP local dev
 *   server. In production this app is assumed to sit behind a TLS-terminating reverse proxy (the
 *   same one `TRUST_PROXY` documents) — HSTS tells the browser to always use HTTPS for future
 *   requests to this origin.
 * - Everything else (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
 *   `Referrer-Policy: no-referrer`, removing `X-Powered-By`) applies in every environment: cheap,
 *   meaningful for a JSON API, and never breaks a legitimate client.
 */
export function securityHeaders(isProduction: boolean): RequestHandler {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "no-referrer" },
    hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
  });
}
