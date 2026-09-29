/**
 * Resolves Express's `app.set("trust proxy", …)` value from `TRUST_PROXY` (Phase 26 hardening).
 *
 * Phase 25 flagged a real problem: `app.ts` hard-coded `trust proxy: 1`, which tells Express to
 * take the right-most `X-Forwarded-For` entry as the client's IP unconditionally, in every
 * environment. That is exactly correct if — and only if — this app sits behind exactly one
 * reverse proxy that itself strips any client-supplied `X-Forwarded-For` before setting its own.
 * It is actively unsafe if deployed with no reverse proxy at all (a direct client can forge
 * `X-Forwarded-For` and get a fresh login-rate-limit bucket on every request, defeating the brute
 * -force guard — see lib/loginRateLimit.ts) or behind a different number of hops (the wrong hop's
 * address gets trusted, either leaking a shared bucket across unrelated clients or trusting an
 * address an intermediate hop didn't actually vouch for).
 *
 * This module makes that choice explicit and environment-driven instead of a silent constant:
 *
 *   TRUST_PROXY=0   -> no reverse proxy; X-Forwarded-For is never trusted, req.ip is always the
 *                       raw socket address. The only topology `req.ip` can be trusted for is
 *                       "clients connect directly to this process."
 *   TRUST_PROXY=1   -> exactly one trusted reverse-proxy hop in front of this process, which
 *                       itself strips any client-supplied X-Forwarded-For before appending its
 *                       own. This is the one production topology this app's tests and docs
 *                       actually certify (see docs/architecture/phase26-…).
 *   TRUST_PROXY=<n> -> (n > 1) trusts the right-most n hops, per Express's own numeric `trust
 *                       proxy` semantics. Accepted and passed straight through to Express, but
 *                       NOT independently verified by this app's test suite — the operator is
 *                       responsible for confirming the real hop count matches.
 *   TRUST_PROXY=<comma-separated IPs/CIDRs/Express presets>
 *                     -> passed straight through to Express (e.g. "loopback", "10.0.0.0/8"). Same
 *                        caveat as above: not independently verified by this app's own tests.
 *
 * `TRUST_PROXY=true` (trust every hop unconditionally) is never accepted: it reintroduces exactly
 * the "blindly trust arbitrary client-supplied X-Forwarded-For" problem this module exists to
 * close, so it is rejected in every environment rather than silently honoured.
 *
 * Fails fast in production if `TRUST_PROXY` is unset, exactly like `SESSION_SECRET`
 * (lib/session.ts) — an unset value here would otherwise have to silently default to *something*,
 * and any default is wrong for some real topology. Development and test keep a convenient,
 * explicit default (`false` — no reverse proxy sits in front of a local dev server or a
 * disposable test instance), so the existing local workflow and every regression script that does
 * not itself set `TRUST_PROXY` is unaffected.
 */
export type TrustProxySetting = boolean | number | string | string[];

export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): TrustProxySetting {
  const raw = env.TRUST_PROXY;
  const isProduction = env.NODE_ENV === "production";

  if (raw === undefined || raw.trim() === "") {
    if (isProduction) {
      throw new Error(
        "TRUST_PROXY must be set in production — refusing to start with an implicit client-IP trust " +
          'policy. Set TRUST_PROXY=0 if this server has no reverse proxy in front of it, or TRUST_PROXY=1 ' +
          "if there is exactly one reverse-proxy hop that strips any client-supplied X-Forwarded-For " +
          "before setting its own (see .env.example / docs/architecture/phase26-deployment-readiness-infrastructure-hardening.md).",
      );
    }
    return false;
  }

  const trimmed = raw.trim();

  if (trimmed.toLowerCase() === "true") {
    throw new Error(
      'TRUST_PROXY=true is not supported — it would trust an arbitrary client-supplied X-Forwarded-For ' +
        "unconditionally, the exact problem this setting exists to prevent. Use TRUST_PROXY=0 (no proxy) " +
        "or TRUST_PROXY=1 (exactly one trusted reverse-proxy hop) instead.",
    );
  }
  if (trimmed === "0" || trimmed.toLowerCase() === "false") return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
