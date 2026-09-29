import session from "express-session";
import { prisma } from "./prisma.js";
import { PrismaSessionStore } from "./prismaSessionStore.js";

const ONE_WEEK_MS = 1000 * 60 * 60 * 24 * 7;

/**
 * Refuses to start in production without a real `SESSION_SECRET` (Phase 25 hardening): the
 * fallback below is a fixed, publicly-known string, so shipping without setting the env var
 * would let anyone forge a signed session cookie. Development/test keep the convenient
 * fallback (a warning, not a hard failure) so the existing local/CI workflow is unaffected.
 */
function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production — refusing to start with a guessable session-signing secret (see .env.example).");
  }
  console.warn("[session] SESSION_SECRET is not set; using an insecure development-only default. Set it before deploying.");
  return "dev-secret-change-me";
}

/**
 * PRODUCTION DEPLOYMENT TRAP (Phase 26, found while adding scripts/session-cookie-regression.mjs):
 * `cookie.secure: true` makes express-session refuse to send `Set-Cookie` AT ALL — not "without
 * Secure", none — unless it can positively confirm the request is secure. That confirmation comes
 * from Express's own `req.secure`, which (once `TRUST_PROXY` — see lib/trustProxy.ts — trusts the
 * hop) reads the `X-Forwarded-Proto` header. A reverse proxy that terminates TLS but forgets to set
 * `X-Forwarded-Proto: https` will make login look like it succeeds (200 + the user's own JSON body)
 * while NO session is ever established — every following request is silently treated as a guest.
 * `TRUST_PROXY=1` alone does not prevent this; the proxy must also send that header. Documented in
 * the deployment checklist (docs/architecture/phase26-…) and exercised directly by
 * scripts/session-cookie-regression.mjs.
 */
export function createSessionMiddleware() {
  return session({
    store: new PrismaSessionStore(prisma),
    name: "scl.sid",
    secret: sessionSecret(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ONE_WEEK_MS,
    },
  });
}
