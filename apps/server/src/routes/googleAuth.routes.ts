import { Router, type Request } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getSessionUser } from "../middleware/auth.js";
import { isLoginRateLimited, recordFailedLogin } from "../lib/loginRateLimit.js";
import {
  GoogleAuthError,
  auditGoogleEvent,
  buildAuthorizationUrl,
  checkState,
  exchangeCode,
  getGoogleConfig,
  isDesignatedAdminEmail,
  makeUnusablePasswordHash,
  missingGoogleSettings,
  newPendingAuth,
  resolveGoogleSignIn,
  verifyIdToken,
} from "../lib/googleAuth.js";

const router = Router();

/**
 * Persists the session BEFORE any redirect. express-session flushes a response's headers (including a redirect's
 * Location and Set-Cookie) before the store write has finished, so a browser that follows the redirect immediately
 * could arrive before the one-time OAuth values, or the new login, were saved ("no_pending_auth" in roughly one
 * run in five on a local database). Saving explicitly makes the redirect wait for the write.
 */
const saveSession = (req: Request): Promise<void> => new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));

const RATE_KEY = "google-oauth";

// One clear, secret-free line at boot when Google sign-in is only half configured. Never throws:
// a missing Google setting disables Google sign-in alone, never the site or the other login methods.
{
  const missing = missingGoogleSettings();
  if (missing.length > 0 && missing.length < 3) {
    console.warn(`[google-auth] Google sign-in is DISABLED: missing ${missing.join(", ")}.`);
  } else if (missing.length === 0 && !getGoogleConfig()) {
    console.warn("[google-auth] Google sign-in is DISABLED: GOOGLE_OAUTH_REDIRECT_URI must be an https URL ending in /api/auth/google/callback.");
  }
}

// GET /api/auth/google/config -> whether the "Sign in with Google" button should be offered. Public, and
// deliberately says nothing about WHY it is off (no variable names, no values).
router.get("/config", (_req, res) => {
  res.json({ enabled: getGoogleConfig() !== null });
});

// GET /api/auth/google/start[?link=1] -> 302 to Google's consent screen. `link=1` is the explicit
// "connect my Google account" flow for someone who is ALREADY signed in. The one-time state, nonce and
// PKCE verifier live in the server-side session, never in a URL the page controls.
router.get(
  "/start",
  asyncHandler(async (req, res) => {
    const cfg = getGoogleConfig();
    if (!cfg) {
      res.redirect(302, "/login?error=google_unconfigured");
      return;
    }
    const link = req.query.link === "1";
    if (link && !(await getSessionUser(req))) {
      res.redirect(302, "/login?error=google_failed");
      return;
    }
    const pending = newPendingAuth(link);
    req.session.googleOAuth = pending;
    await saveSession(req);
    res.redirect(302, buildAuthorizationUrl(cfg, pending));
  }),
);

// GET /api/auth/google/callback -> the browser returns here from Google. Every failure ends in the same
// generic redirect (the real reason goes to the server log only), so the outcome never helps an attacker
// tell "not an authorised account" from "bad token" from "expired state".
router.get(
  "/callback",
  asyncHandler(async (req, res) => {
    const ip = req.ip ?? "unknown";
    const cfg = getGoogleConfig();
    if (!cfg) {
      res.redirect(302, "/login?error=google_unconfigured");
      return;
    }
    // The pending values are single-use: taken out of the session before anything else happens.
    const pending = req.session.googleOAuth;
    delete req.session.googleOAuth;

    try {
      if (isLoginRateLimited(ip, RATE_KEY)) throw new GoogleAuthError("rate_limited");
      if (typeof req.query.error === "string") throw new GoogleAuthError("provider_denied");
      const checked = checkState(pending, req.query.state);
      const code = req.query.code;
      if (typeof code !== "string" || code.length === 0 || code.length > 2048) throw new GoogleAuthError("missing_code");

      const linkUser = checked.link ? await getSessionUser(req) : null;
      if (checked.link && !linkUser) throw new GoogleAuthError("link_session_lost");

      const idToken = await exchangeCode(cfg, code, checked.verifier);
      const claims = await verifyIdToken(cfg, idToken, checked.nonce);

      // The slow bcrypt step happens BEFORE the transaction opens, so it can never be what makes one time out.
      const unusableHash = isDesignatedAdminEmail(claims.email) ? await makeUnusablePasswordHash() : undefined;
      const { decision, user } = await prisma.$transaction(async (tx) => {
        const d = await resolveGoogleSignIn(tx, claims, linkUser?.id ?? null, unusableHash);
        const u = await tx.user.findUniqueOrThrow({ where: { id: d.userId }, select: { id: true, email: true } });
        await auditGoogleEvent(tx, d, u);
        return { decision: d, user: u };
      });

      // Fresh session id on every successful authentication (session-fixation defence), exactly like password login.
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });
      req.session.userId = user.id;
      await saveSession(req);
      res.redirect(302, decision.outcome === "linked" ? "/profile?google=linked" : "/");
    } catch (err) {
      const reason = err instanceof GoogleAuthError ? err.reason : `internal_${(err as Error)?.name ?? "error"}`;
      if (reason !== "rate_limited") recordFailedLogin(ip, RATE_KEY);
      console.warn(`[google-auth] sign-in refused: ${reason}`);
      res.redirect(302, reason === "provider_denied" ? "/login?error=google_denied" : "/login?error=google_failed");
    }
  }),
);

export default router;
