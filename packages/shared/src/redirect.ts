/**
 * Open-redirect guard (Phase 25 hardening) for any "where to go after this" value the app reads
 * back from somewhere an attacker can influence — currently `LoginPage`'s post-login redirect,
 * which traces back to `ProtectedRoute`'s `location.pathname` (itself reachable via a crafted
 * link). A same-app redirect target is always exactly one leading "/" followed by neither another
 * "/" nor a "\": both are treated as protocol-relative by some browsers/parsers (the shape behind
 * react-router's own open-redirect advisories in `<Link>`/`useNavigate`), which would otherwise let
 * a crafted path send a user who just typed their password to a different origin entirely.
 */
export function isSafeRedirectPath(path: unknown): path is string {
  return typeof path === "string" && /^\/(?!\/|\\)/.test(path);
}
