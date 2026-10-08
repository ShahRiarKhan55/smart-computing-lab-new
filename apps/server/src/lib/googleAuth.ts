import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { isAdmin, type Role } from "@scl/shared";
import { recordAudit } from "./audit.js";

/**
 * Google sign-in (OpenID Connect authorization-code flow with PKCE), Phase 27 / P27.4.
 *
 * Everything security-relevant happens on the SERVER: the browser only ever carries Google's one-time
 * `code` + our `state`; the ID token is obtained by this server directly from Google's token endpoint
 * (client secret + PKCE verifier) and then verified here — signature (RS256 against Google's published
 * JWKS), issuer, audience, expiry, nonce, and `email_verified === true`. No identity, email, role or
 * "isAdmin" value is ever accepted from the client.
 *
 * ## Who may sign in (the policy, in `resolveGoogleSignIn`)
 * The app is invitation-only; Google never creates arbitrary accounts. A verified Google identity can:
 *  1. sign in if it is ALREADY linked to an account (matched on Google's stable `sub`, never on email);
 *  2. be linked to the account of the person currently signed in (explicit "Connect Google" flow) —
 *     but an ADMIN account can only ever be linked to the designated admin Google identity;
 *  3. if (and only if) its verified email is exactly `DESIGNATED_ADMIN_GOOGLE_EMAIL`, create the
 *     administrator account on first sign-in when no account with that email exists yet.
 * Administrator is granted ONLY in case 3 (at account creation). Nothing else — no request field, no
 * email typed anywhere, no pre-existing password account — can turn a Google identity into an admin.
 * An existing password account with the same email is never silently taken over: it has to be linked
 * deliberately from inside that signed-in account (case 2).
 */

export const GOOGLE_PROVIDER = "google";
/** The one Google identity that may be granted administrator privileges through Google sign-in. */
export const DESIGNATED_ADMIN_GOOGLE_EMAIL = "susmartcomputinglab@gmail.com";

export const CALLBACK_PATH = "/api/auth/google/callback";
const STATE_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;
const HTTP_TIMEOUT_MS = 8000;

/** A failure with a stable machine reason (logged); the browser only ever sees a generic redirect. */
export class GoogleAuthError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "GoogleAuthError";
    this.reason = reason;
  }
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
export const isDesignatedAdminEmail = (email: string): boolean => normalizeEmail(email) === DESIGNATED_ADMIN_GOOGLE_EMAIL;

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  /** Accepted `iss` values (Google documents both spellings). */
  issuers: string[];
}

const GOOGLE_DEFAULTS = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"],
};

/** Names (never values) of the required variables that are missing — for a startup warning. */
export function missingGoogleSettings(env: NodeJS.ProcessEnv = process.env): string[] {
  return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI"].filter((k) => !env[k]?.trim());
}

/**
 * The Google configuration, or `null` when sign-in is not (fully/validly) configured. A null result
 * disables ONLY Google sign-in — password and invitation login and every public page are unaffected.
 *
 * `GOOGLE_OAUTH_BASE_URL` redirects all three Google endpoints to a mock for automated tests. It is
 * honoured ONLY outside production, so a production deployment can never be pointed at a look-alike provider.
 */
export function getGoogleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  if (missingGoogleSettings(env).length > 0) return null;
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI!.trim();
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return null;
  }
  const isProd = env.NODE_ENV === "production";
  const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !(localHttp && !isProd)) return null;
  if (url.pathname !== CALLBACK_PATH || url.search || url.hash) return null;

  const base = !isProd && env.GOOGLE_OAUTH_BASE_URL?.trim() ? env.GOOGLE_OAUTH_BASE_URL.trim().replace(/\/+$/, "") : null;
  return {
    clientId: env.GOOGLE_CLIENT_ID!.trim(),
    clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(),
    redirectUri,
    authorizationEndpoint: base ? `${base}/authorize` : GOOGLE_DEFAULTS.authorizationEndpoint,
    tokenEndpoint: base ? `${base}/token` : GOOGLE_DEFAULTS.tokenEndpoint,
    jwksUri: base ? `${base}/certs` : GOOGLE_DEFAULTS.jwksUri,
    issuers: base ? [`${base}`] : GOOGLE_DEFAULTS.issuers,
  };
}

// ---------------------------------------------------------------------------------------------
// Authorization request
// ---------------------------------------------------------------------------------------------
const b64url = (buf: Buffer): string => buf.toString("base64url");

export interface PendingGoogleAuth {
  state: string;
  nonce: string;
  verifier: string;
  link: boolean;
  createdAt: number;
}

export function newPendingAuth(link: boolean, now = Date.now()): PendingGoogleAuth {
  return { state: b64url(randomBytes(32)), nonce: b64url(randomBytes(32)), verifier: b64url(randomBytes(48)), link, createdAt: now };
}

export function buildAuthorizationUrl(cfg: GoogleConfig, pending: PendingGoogleAuth): string {
  const url = new URL(cfg.authorizationEndpoint);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", pending.state);
  url.searchParams.set("nonce", pending.nonce);
  url.searchParams.set("code_challenge", b64url(createHash("sha256").update(pending.verifier).digest()));
  url.searchParams.set("code_challenge_method", "S256");
  // Always show the account chooser: a shared computer must not silently reuse whichever Google account is signed in.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/** Constant-time-ish equality for short opaque values. */
function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Validates the callback's `state` against what this browser's session stored. Throws on any mismatch/expiry. */
export function checkState(pending: PendingGoogleAuth | undefined, state: unknown, now = Date.now()): PendingGoogleAuth {
  if (!pending) throw new GoogleAuthError("no_pending_auth");
  if (now - pending.createdAt > STATE_TTL_MS || now < pending.createdAt) throw new GoogleAuthError("state_expired");
  if (!safeEqual(pending.state, state)) throw new GoogleAuthError("state_mismatch");
  return pending;
}

// ---------------------------------------------------------------------------------------------
// Token exchange and ID-token verification
// ---------------------------------------------------------------------------------------------
type Fetch = typeof fetch;

export async function exchangeCode(cfg: GoogleConfig, code: string, verifier: string, doFetch: Fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await doFetch(cfg.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch {
    throw new GoogleAuthError("token_endpoint_unreachable");
  }
  if (!res.ok) throw new GoogleAuthError(`token_exchange_http_${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new GoogleAuthError("token_response_not_json");
  }
  const idToken = (body as { id_token?: unknown } | null)?.id_token;
  if (typeof idToken !== "string" || idToken.length === 0 || idToken.length > 8192) throw new GoogleAuthError("token_response_missing_id_token");
  return idToken;
}

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

const jwksCache = new Map<string, { keys: Jwk[]; expiresAt: number; fetchedAt: number }>();
const JWKS_MIN_REFETCH_MS = 10_000;
const JWKS_DEFAULT_TTL_MS = 60 * 60 * 1000;

async function loadJwks(cfg: GoogleConfig, force: boolean, doFetch: Fetch, now: number): Promise<Jwk[]> {
  const cached = jwksCache.get(cfg.jwksUri);
  if (cached && !force && now < cached.expiresAt) return cached.keys;
  if (cached && force && now - cached.fetchedAt < JWKS_MIN_REFETCH_MS) return cached.keys; // don't let unknown kids hammer Google
  let res: Response;
  try {
    res = await doFetch(cfg.jwksUri, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  } catch {
    throw new GoogleAuthError("jwks_unreachable");
  }
  if (!res.ok) throw new GoogleAuthError(`jwks_http_${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new GoogleAuthError("jwks_not_json");
  }
  const keys = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) throw new GoogleAuthError("jwks_malformed");
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1];
  const ttl = maxAge ? Math.min(Number(maxAge) * 1000, 24 * 60 * 60 * 1000) : JWKS_DEFAULT_TTL_MS;
  jwksCache.set(cfg.jwksUri, { keys: keys as Jwk[], expiresAt: now + ttl, fetchedAt: now });
  return keys as Jwk[];
}

export function clearJwksCache(): void {
  jwksCache.clear();
}

export interface GoogleClaims {
  sub: string;
  email: string;
}

/**
 * Verifies a Google ID token and returns the claims the policy needs. Throws `GoogleAuthError` (with a
 * stable reason) for any failure: malformed, wrong algorithm, unknown key, bad signature, wrong issuer,
 * wrong audience, expired, not-yet-valid, nonce mismatch, missing subject/email, or an unverified email.
 */
export async function verifyIdToken(cfg: GoogleConfig, idToken: string, expectedNonce: string, doFetch: Fetch = fetch, now = Date.now()): Promise<GoogleClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0 || !/^[A-Za-z0-9_-]+$/.test(p))) throw new GoogleAuthError("malformed_token");

  let header: { alg?: unknown; kid?: unknown };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new GoogleAuthError("malformed_token");
  }
  if (!header || typeof header !== "object" || !payload || typeof payload !== "object" || Array.isArray(payload)) throw new GoogleAuthError("malformed_token");
  // Only RS256 (what Google signs with). "none" and symmetric algorithms are refused outright — the classic JWT downgrade attacks.
  if (header.alg !== "RS256") throw new GoogleAuthError("unsupported_alg");
  if (typeof header.kid !== "string" || header.kid.length === 0) throw new GoogleAuthError("missing_kid");

  let keys = await loadJwks(cfg, false, doFetch, now);
  let jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) {
    keys = await loadJwks(cfg, true, doFetch, now); // Google rotates keys: one bounded refetch for an unknown kid
    jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  }
  if (!jwk) throw new GoogleAuthError("unknown_signing_key");

  let valid = false;
  try {
    const publicKey = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
    valid = cryptoVerify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], "base64url"));
  } catch {
    valid = false;
  }
  if (!valid) throw new GoogleAuthError("bad_signature");

  const nowSec = Math.floor(now / 1000);
  if (typeof payload.iss !== "string" || !cfg.issuers.includes(payload.iss)) throw new GoogleAuthError("wrong_issuer");
  const aud = payload.aud;
  const audOk = aud === cfg.clientId || (Array.isArray(aud) && aud.includes(cfg.clientId) && payload.azp === cfg.clientId);
  if (!audOk) throw new GoogleAuthError("wrong_audience");
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < nowSec) throw new GoogleAuthError("expired");
  if (typeof payload.iat === "number" && payload.iat - CLOCK_SKEW_SECONDS > nowSec) throw new GoogleAuthError("issued_in_future");
  if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_SECONDS > nowSec) throw new GoogleAuthError("not_yet_valid");
  if (!safeEqual(payload.nonce, expectedNonce)) throw new GoogleAuthError("nonce_mismatch");
  if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 255) throw new GoogleAuthError("missing_subject");
  if (typeof payload.email !== "string" || payload.email.length === 0 || payload.email.length > 320) throw new GoogleAuthError("missing_email");
  if (payload.email_verified !== true) throw new GoogleAuthError("email_not_verified");

  return { sub: payload.sub, email: normalizeEmail(payload.email) };
}

// ---------------------------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------------------------
/** A bcrypt hash of 256 random bits that nobody ever sees: an account that can only sign in with Google. */
export const makeUnusablePasswordHash = (): Promise<string> => bcrypt.hash(randomBytes(32).toString("hex"), 10);

export interface SignInDecision {
  userId: string;
  /** What happened, for the audit trail. */
  outcome: "signed_in" | "linked" | "admin_created";
}

/**
 * Applies the sign-in policy (see the file header). `linkUserId` is set only when the person was
 * ALREADY signed in at the start of the flow and still is at the callback (the explicit link flow).
 * Throws `GoogleAuthError("not_authorized")` for every denial so callers cannot tell the cases apart.
 */
export async function resolveGoogleSignIn(
  db: Prisma.TransactionClient,
  claims: GoogleClaims,
  linkUserId: string | null,
  /** Pre-computed by the caller (bcrypt is slow; never hold a database transaction open for it). Only used when the administrator account is created. */
  unusablePasswordHash?: string,
): Promise<SignInDecision> {
  const existing = await db.oAuthIdentity.findUnique({ where: { provider_subject: { provider: GOOGLE_PROVIDER, subject: claims.sub } } });

  if (existing) {
    if (linkUserId && existing.userId !== linkUserId) throw new GoogleAuthError("not_authorized"); // already attached to someone else
    await db.oAuthIdentity.update({ where: { id: existing.id }, data: { lastLoginAt: new Date(), email: claims.email } });
    return { userId: existing.userId, outcome: "signed_in" };
  }

  if (linkUserId) {
    const user = await db.user.findUnique({ where: { id: linkUserId }, select: { id: true, role: true, oauthIdentities: { select: { id: true }, where: { provider: GOOGLE_PROVIDER } } } });
    if (!user || user.oauthIdentities.length > 0) throw new GoogleAuthError("not_authorized");
    // An administrator account is reachable through Google ONLY by the designated identity.
    if (isAdmin({ id: user.id, role: user.role as Role }) && !isDesignatedAdminEmail(claims.email)) throw new GoogleAuthError("not_authorized");
    await db.oAuthIdentity.create({ data: { provider: GOOGLE_PROVIDER, subject: claims.sub, userId: user.id, email: claims.email } });
    return { userId: user.id, outcome: "linked" };
  }

  // Not linked and not linking: the only identity that may do anything is the designated admin.
  if (!isDesignatedAdminEmail(claims.email)) throw new GoogleAuthError("not_authorized");
  const sameEmail = await db.user.findUnique({ where: { email: claims.email }, select: { id: true } });
  if (sameEmail) throw new GoogleAuthError("not_authorized"); // never take over an existing password account: link from inside it instead
  // The password is random and discarded: this account signs in with Google only (an admin can still reset it by deleting + re-creating).
  const passwordHash = unusablePasswordHash ?? (await makeUnusablePasswordHash());
  const user = await db.user.create({ data: { email: claims.email, passwordHash, role: "ADMIN" } });
  await db.oAuthIdentity.create({ data: { provider: GOOGLE_PROVIDER, subject: claims.sub, userId: user.id, email: claims.email } });
  return { userId: user.id, outcome: "admin_created" };
}

export async function auditGoogleEvent(
  db: Prisma.TransactionClient,
  decision: SignInDecision,
  user: { id: string; email: string },
): Promise<void> {
  await recordAudit(db, {
    actor: user,
    action: decision.outcome === "signed_in" ? "GOOGLE_LOGIN" : "GOOGLE_LINKED",
    entityType: "USER",
    entityId: user.id,
    details: { outcome: decision.outcome },
  });
}
