import { Router } from "express";
import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getSessionUser, requireAuth } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { clearLoginAttempts, isLoginRateLimited, recordFailedLogin } from "../lib/loginRateLimit.js";
import { HttpError, parseOrThrow } from "../lib/validate.js";
import { requireSameOriginJson } from "../lib/sameOrigin.js";
import { createStartLimiter, type StartLimiter } from "../lib/oauthStartRateLimit.js";
import { constraintKind } from "../lib/dbErrors.js";
import { GoogleIdentityError, verifyGoogleIdToken, type IdTokenVerifierClient } from "../lib/googleIdentity.js";
import {
  GOOGLE_PROVIDER,
  MAX_PENDING_SESSIONS,
  PENDING_SESSION_TTL_MS,
  TRANSACTION_TTL_MS,
  consumeTransaction,
  defaultGoogleOAuthProvider,
  loadGoogleOAuthConfig,
  randomToken,
  safeEqual,
  saveSession,
  type FlowPurpose,
  type GoogleOAuthConfig,
  type GoogleOAuthProvider,
} from "../lib/googleOAuth.js";

/**
 * Google sign-in and account linking (Phase 2.2). Policy, in one place:
 *
 *  - Google is only a way to sign in to an EXISTING lab account that has been linked to it. There is no sign-up here: this
 *    router never creates a `User`, never changes a role and never links on an email match.
 *  - A link is made only from an already-authenticated session, only to that session's own account, and only from a
 *    verified ID token (signature, issuer, audience, expiry, `sub`, verified email, and the transaction's nonce).
 *  - Sign-in looks the account up by `(provider, sub)` alone. An unknown identity is refused with a stable error code and
 *    nothing is written to users, identities or the audit log.
 *  - Every redirect target is a fixed path below; no request value ever chooses where the browser is sent.
 *  - The transaction (state, nonce, PKCE verifier) lives in the initiating browser's own server-side session, expires after
 *    ten minutes and is consumed on first use, whether or not the callback then succeeds.
 *  - Nothing sensitive is logged: no codes, tokens, verifier, nonce or claims.
 *
 * Without valid `GOOGLE_OAUTH_*` configuration every endpoint here fails closed and password login is untouched.
 */

export interface GoogleAuthDeps {
  getConfig: () => GoogleOAuthConfig | null;
  provider: GoogleOAuthProvider;
  /** Test seam for ID-token signature verification (production uses the real google-auth-library client). */
  verifierClient?: IdTokenVerifierClient;
  nowMs?: () => number;
  /** Limits ANONYMOUS sign-in starts per client (each persists a short-lived session row). */
  startLimiter: StartLimiter;
  /** Cap on live pending-flow sessions across all instances (the shared database is the counter). */
  maxPendingSessions: number;
}

const passwordBodySchema = z.object({
  currentPassword: z.string({ required_error: "Current password is required." }).min(1, "Current password is required.").max(1024, "Current password is too long."),
});

// Fixed destinations (never taken from the request).
const LOGIN_PATH = "/login";
const SIGNED_IN_PATH = "/profile";
const PROFILE_PATH = "/profile";

type LoginErrorCode = "unavailable" | "failed" | "not_linked" | "rate_limited";
type LinkResultCode = "linked" | "already_linked" | "in_use" | "has_other" | "session" | "failed" | "unavailable";

function toLogin(res: Response, code: LoginErrorCode): void {
  res.redirect(302, `${LOGIN_PATH}?google_error=${code}`);
}
function toProfile(res: Response, code: LinkResultCode): void {
  res.redirect(302, `${PROFILE_PATH}?google=${code}`);
}

/**
 * Fixed diagnostic labels for the callback: one per place a callback can stop short of success (the `google_error` /
 * `google` code shown to the user is intentionally generic, so these are the only way to tell the causes apart). The log
 * line is built from these constants and the closed `GoogleIdentityFailureReason` union only: never from a request value,
 * a token, a subject, an e-mail address, an error message or anything else a caller could influence.
 */
type CallbackStage =
  | "config-unavailable"
  | "session-store-error"
  | "provider-error-or-missing-parameters"
  | "no-transaction"
  | "transaction-expired"
  | "state-mismatch"
  | "token-exchange-failed"
  | `token-rejected-${string}`
  | "database-error"
  | "identity-not-linked"
  | "session-regenerate-failed"
  | "link-session-mismatch"
  | "link-identity-in-use"
  | "link-account-has-other"
  | "link-already-linked"
  | "link-write-failed";

function logRefusal(purpose: FlowPurpose | "unknown", stage: CallbackStage): void {
  console.error(`[google-auth] callback refused ${purpose} ${stage}`);
}

/** The link outcomes that are refusals (a successful `linked` is not logged). */
function logLinkOutcome(code: LinkResultCode): void {
  if (code === "in_use") logRefusal("link", "link-identity-in-use");
  else if (code === "has_other") logRefusal("link", "link-account-has-other");
  else if (code === "already_linked") logRefusal("link", "link-already-linked");
  else if (code === "failed") logRefusal("link", "link-write-failed");
}

function queryString(req: Request, name: string, max: number): string | null {
  const v = req.query[name];
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

export function createGoogleAuthRouter(overrides: Partial<GoogleAuthDeps> = {}): Router {
  const deps: GoogleAuthDeps = {
    getConfig: () => loadGoogleOAuthConfig(),
    provider: defaultGoogleOAuthProvider,
    startLimiter: createStartLimiter(),
    maxPendingSessions: MAX_PENDING_SESSIONS,
    ...overrides,
  };
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  async function beginFlow(req: Request, config: GoogleOAuthConfig, purpose: FlowPurpose, userId?: string): Promise<string> {
    const { codeVerifier, codeChallenge } = await deps.provider.newPkce();
    const state = randomToken();
    const nonce = randomToken();
    const now = (deps.nowMs ?? Date.now)();
    // Replaces any earlier unfinished transaction of this browser: only the newest one can complete.
    req.session.googleFlow = { purpose, state, nonce, codeVerifier, expiresAt: now + TRANSACTION_TTL_MS, ...(userId ? { userId } : {}) };
    if (!req.session.userId) {
      // A session that exists only to carry an anonymous sign-in transaction is short-lived (the persisted expiry and the
      // cookie). express-session's `expires` setter also resets `originalMaxAge`, which rolling sessions revert to, so the
      // short lifetime survives later touches (asserted in the regression). Signed-in sessions keep the normal policy, and
      // a successful sign-in regenerates into a normal session.
      req.session.cookie.maxAge = PENDING_SESSION_TTL_MS;
    }
    await saveSession(req);
    return deps.provider.buildAuthUrl(config, { state, nonce, codeChallenge });
  }

  /** Verifies the signed-in user's current password (same conventions and limiter as POST /auth/password); fail closed. */
  async function requireCurrentPassword(req: Request): Promise<void> {
    const { currentPassword } = parseOrThrow(passwordBodySchema, req.body);
    const ip = req.ip ?? "unknown";
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { email: true, passwordHash: true } });
    if (!user) throw new HttpError(401, "Unauthorized");
    if (isLoginRateLimited(ip, user.email)) throw new HttpError(429, "Too many attempts. Please wait a few minutes and try again.");
    let ok = false;
    try {
      ok = typeof user.passwordHash === "string" && user.passwordHash.length > 0 && (await bcrypt.compare(currentPassword, user.passwordHash));
    } catch {
      ok = false; // an unusable hash never verifies
    }
    if (!ok) {
      recordFailedLogin(ip, user.email);
      throw new HttpError(401, "Current password is incorrect.");
    }
    clearLoginAttempts(ip, user.email);
  }

  const sameOrigin = requireSameOriginJson(() => {
    const cfg = deps.getConfig();
    return cfg ? [new URL(cfg.redirectUri).origin] : [];
  });

  // GET /api/auth/google/status -> whether Google sign-in is offered (drives the login page button)
  router.get("/status", (_req, res) => {
    res.json({ enabled: deps.getConfig() !== null });
  });

  // GET /api/auth/google/link -> for the signed-in account: is Google offered, and is an identity linked
  router.get(
    "/link",
    requireAuth,
    asyncHandler(async (req, res) => {
      const linked = await prisma.oAuthIdentity.findUnique({
        where: { userId_provider: { userId: req.user!.id, provider: GOOGLE_PROVIDER } },
        select: { id: true },
      });
      res.json({ enabled: deps.getConfig() !== null, linked: linked !== null });
    }),
  );

  // GET /api/auth/google/start -> 302 to Google (sign-in). A plain navigation. It persists one short-lived session row, so
  // it is rate limited per client and capped globally.
  router.get(
    "/start",
    asyncHandler(async (req, res) => {
      const config = deps.getConfig();
      if (!config) return toLogin(res, "unavailable");
      if (!deps.startLimiter.take(req.ip ?? "unknown")) return toLogin(res, "rate_limited");
      let url: string;
      try {
        const nowMs = (deps.nowMs ?? Date.now)();
        const pending = await prisma.session.count({ where: { expiresAt: { gt: new Date(nowMs), lt: new Date(nowMs + PENDING_SESSION_TTL_MS + 60_000) } } });
        if (pending >= deps.maxPendingSessions) return toLogin(res, "rate_limited");
        url = await beginFlow(req, config, "signin");
      } catch {
        console.error("[google-auth] could not start sign-in");
        return toLogin(res, "failed");
      }
      res.redirect(302, url);
    }),
  );

  // POST /api/auth/google/link/start { currentPassword } -> { url }: begins linking for the CURRENT session's account only.
  // Same-origin JSON only (CSRF), then the account password must be re-verified before anything is started.
  router.post(
    "/link/start",
    sameOrigin,
    requireAuth,
    asyncHandler(async (req, res) => {
      const config = deps.getConfig();
      if (!config) {
        res.status(404).json({ error: "Google sign-in is not available." });
        return;
      }
      await requireCurrentPassword(req);
      const existing = await prisma.oAuthIdentity.findUnique({
        where: { userId_provider: { userId: req.user!.id, provider: GOOGLE_PROVIDER } },
        select: { id: true },
      });
      if (existing) throw new HttpError(409, "A Google account is already connected.");
      res.json({ url: await beginFlow(req, config, "link", req.user!.id) });
    }),
  );

  // POST /api/auth/google/unlink { currentPassword } -> removes ONLY the signed-in user's own Google link.
  router.post(
    "/unlink",
    sameOrigin,
    requireAuth,
    asyncHandler(async (req, res) => {
      await requireCurrentPassword(req);
      const user = req.user!;
      const removed = await prisma.$transaction(async (db) => {
        const result = await db.oAuthIdentity.deleteMany({ where: { userId: user.id, provider: GOOGLE_PROVIDER } });
        if (result.count > 0) {
          await recordAudit(db, { actor: { id: user.id, email: user.email }, action: "OAUTH_IDENTITY_UNLINKED", entityType: "USER", entityId: user.id, details: { provider: GOOGLE_PROVIDER } });
        }
        return result.count;
      });
      if (removed === 0) throw new HttpError(404, "No Google account is connected.");
      res.json({ unlinked: true });
    }),
  );

  // GET /api/auth/google/callback -> consumes the transaction, verifies the ID token, then links or signs in.
  router.get(
    "/callback",
    asyncHandler(async (req, res) => {
      // Consume first (atomically): from here on this transaction can never be used again, whatever happens next.
      let tx = null;
      try {
        tx = await consumeTransaction(req);
      } catch {
        logRefusal("unknown", "session-store-error");
        return toLogin(res, "failed");
      }
      const linking = tx?.purpose === "link";
      const fail = (loginCode: LoginErrorCode, linkCode: LinkResultCode) => (linking ? toProfile(res, linkCode) : toLogin(res, loginCode));
      const purposeLabel: FlowPurpose | "unknown" = tx?.purpose ?? "unknown";
      const refuse = (stage: CallbackStage) => {
        logRefusal(purposeLabel, stage);
        return fail("failed", "failed");
      };

      const config = deps.getConfig();
      if (!config) {
        logRefusal(purposeLabel, "config-unavailable");
        return fail("unavailable", "unavailable");
      }

      // No per-IP failure counter here by design: a callback without a valid browser-bound transaction does no work and
      // writes nothing, and every callback WITH one needed a rate-limited start (or a verified password), so one client
      // cannot lock other users out of completing their own flow.
      const state = queryString(req, "state", 512);
      const code = queryString(req, "code", 2048);
      if (req.query.error !== undefined || !state || !code) return refuse("provider-error-or-missing-parameters");
      if (!tx) return refuse("no-transaction");
      if ((deps.nowMs ?? Date.now)() > tx.expiresAt) return refuse("transaction-expired");
      if (!safeEqual(tx.state, state)) return refuse("state-mismatch");

      let subject: string;
      try {
        const idToken = await deps.provider.exchangeCode(config, { code, codeVerifier: tx.codeVerifier });
        const identity = await verifyGoogleIdToken(idToken, {
          config: { clientId: config.clientId },
          expectedNonce: tx.nonce,
          ...(deps.verifierClient ? { client: deps.verifierClient } : {}),
          ...(deps.nowMs ? { nowMs: deps.nowMs } : {}),
        });
        subject = identity.subject;
      } catch (err) {
        // GoogleIdentityError carries only a reason code from a closed set; anything else (network, token endpoint) is equally
        // opaque to the user and is labelled generically. The error object itself is never logged.
        return refuse(err instanceof GoogleIdentityError ? `token-rejected-${err.reason.replace(/_/g, "-")}` : "token-exchange-failed");
      }

      if (tx.purpose === "signin") {
        let found: { userId: string } | null;
        try {
          found = await prisma.oAuthIdentity.findUnique({
            where: { provider_subject: { provider: GOOGLE_PROVIDER, subject } },
            select: { userId: true },
          });
        } catch {
          logRefusal("signin", "database-error");
          return toLogin(res, "failed");
        }
        if (!found) {
          logRefusal("signin", "identity-not-linked");
          return toLogin(res, "not_linked"); // no user is created, nothing is written
        }
        try {
          // Fresh session id on sign-in (session fixation), exactly like password login, and persisted BEFORE the redirect.
          await new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
          req.session.userId = found.userId;
          await saveSession(req);
        } catch {
          logRefusal("signin", "session-regenerate-failed");
          delete req.session.userId; // never let the end-of-request save turn a failed sign-in into a session
          return toLogin(res, "failed");
        }
        return res.redirect(302, SIGNED_IN_PATH);
      }

      // Linking: the browser must STILL be signed in as the account that started the flow.
      let user;
      try {
        user = await getSessionUser(req);
      } catch {
        logRefusal("link", "database-error");
        return fail("failed", "failed");
      }
      if (!user || !tx.userId || user.id !== tx.userId) {
        logRefusal("link", "link-session-mismatch");
        return fail("failed", "session");
      }

      let outcome: LinkResultCode;
      try {
        outcome = await prisma.$transaction(async (db) => {
          const mine = await db.oAuthIdentity.findUnique({
            where: { userId_provider: { userId: user.id, provider: GOOGLE_PROVIDER } },
            select: { subject: true },
          });
          if (mine) return mine.subject === subject ? "already_linked" : "has_other"; // never silently replaced
          const owner = await db.oAuthIdentity.findUnique({
            where: { provider_subject: { provider: GOOGLE_PROVIDER, subject } },
            select: { id: true },
          });
          if (owner) return "in_use";
          await db.oAuthIdentity.create({ data: { userId: user.id, provider: GOOGLE_PROVIDER, subject } });
          await recordAudit(db, { actor: { id: user.id, email: user.email }, action: "OAUTH_IDENTITY_LINKED", entityType: "USER", entityId: user.id, details: { provider: GOOGLE_PROVIDER } });
          return "linked";
        });
      } catch (err) {
        // A concurrent link of the same subject/account loses to the database uniqueness constraints. On local SQLite that
        // is a typed P2002; on Turso/libSQL it can be an untyped `SQLITE_CONSTRAINT` (see lib/dbErrors.ts). Whatever the
        // error says, the outcome is decided by RE-READING the committed rows, never by guessing from the error, so a
        // foreign-key or other constraint failure can never be reported as a conflict.
        const kind = constraintKind(err);
        if (kind === null) {
          logRefusal("link", "link-write-failed");
          return toProfile(res, "failed"); // never reports success for a write that did not happen
        }
        let resolved: LinkResultCode | null = null;
        try {
          const mine = await prisma.oAuthIdentity.findUnique({ where: { userId_provider: { userId: user.id, provider: GOOGLE_PROVIDER } }, select: { subject: true } });
          if (mine) resolved = mine.subject === subject ? "already_linked" : "has_other";
          else if (await prisma.oAuthIdentity.findUnique({ where: { provider_subject: { provider: GOOGLE_PROVIDER, subject } }, select: { id: true } })) resolved = "in_use";
        } catch {
          logRefusal("link", "database-error");
          return toProfile(res, "failed");
        }
        // Re-read found nothing: trust only an explicit unique-violation classification (the row may have been removed since).
        const final = resolved ?? (kind === "unique" ? "in_use" : "failed");
        logLinkOutcome(final);
        return toProfile(res, final);
      }
      logLinkOutcome(outcome);
      return toProfile(res, outcome);
    }),
  );

  return router;
}

export default createGoogleAuthRouter();
