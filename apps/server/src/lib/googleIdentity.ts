import { timingSafeEqual } from "node:crypto";
import { OAuth2Client, type TokenPayload } from "google-auth-library";

/**
 * Google identity VERIFICATION core (Phase 2.1).
 *
 * This module answers exactly one question: "is this string a genuine Google-issued ID token for OUR
 * client, and which Google account does it identify?" It does nothing else.
 *
 * What it deliberately is NOT:
 *  - It is not authorization. A verified Google identity is only a claim about WHO someone is on Google; it does
 *    not make them a lab member, and it never confers a role, administrator privileges or private access. The
 *    sign-in policy (only identities explicitly linked to an existing lab account may sign in; unknown
 *    identities are rejected without creating anything) belongs to routes/googleAuth.routes.ts.
 *  - It does not touch users, roles, sessions or the database, creates no accounts and links nothing.
 *  - It is not a route and starts no login flow. There is no state/PKCE lifecycle here (lib/googleOAuth.ts and the
 *    Google auth router own it); it only checks the OIDC nonce it is told to expect. The caller of that
 *    flow passes the resulting ID token to `verifyGoogleIdToken`.
 *  - It implements no JWT cryptography. Signature, issuer, audience, issue/expiry times and the maximum token
 *    lifetime are verified by `google-auth-library` (`OAuth2Client.verifyIdToken`); the checks below are
 *    defence in depth on the already-verified payload, plus the claims the library does not require
 *    (`sub`, `email`, `email_verified`).
 *
 * Token hygiene: `google-auth-library` error messages can embed the whole token. Those messages are therefore
 * NEVER copied into the errors thrown here, logged, or attached as a `cause`; callers only ever see a stable
 * `reason` code.
 */

/** The two spellings of Google's issuer that appear in ID tokens. */
export const GOOGLE_ID_TOKEN_ISSUERS: readonly string[] = ["https://accounts.google.com", "accounts.google.com"];

/** ID tokens are signed RS256; any other algorithm in the (signature-verified) header is refused. */
const REQUIRED_ALGORITHM = "RS256";
const MAX_TOKEN_LENGTH = 8192;
/** Same tolerance as the library's own clock-skew allowance. */
const CLOCK_SKEW_SECONDS = 300;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
/** Google OAuth client IDs look like `1234567890-abcdefghijkl.apps.googleusercontent.com`. */
const CLIENT_ID_SHAPE = /^[0-9]{1,30}-[a-z0-9_]{1,64}\.apps\.googleusercontent\.com$/;
const SUBJECT_SHAPE = /^[^\s\u0000-\u001f]{1,255}$/;
const MAX_EMAIL_LENGTH = 254;

export interface GoogleVerifierConfig {
  /** The exact OAuth client ID that ID tokens must be issued for (`aud`). */
  clientId: string;
}

/**
 * The verifier configuration, or `null` when Google verification is not (validly) configured. `null` disables
 * ONLY Google verification. Reads nothing from the process environment by itself: the caller passes the value
 * (a later portion decides which variable that is).
 */
export function loadGoogleVerifierConfig(rawClientId: string | undefined | null): GoogleVerifierConfig | null {
  if (typeof rawClientId !== "string") return null;
  const clientId = rawClientId.trim();
  if (!CLIENT_ID_SHAPE.test(clientId)) return null;
  return { clientId };
}

/** The identity a verified Google ID token vouches for. Nothing here is authorization. */
export interface VerifiedGoogleIdentity {
  readonly provider: "google";
  /** Google's stable, unique account identifier (`sub`). Never reused; the only safe key to link an account on. */
  readonly subject: string;
  /** Verified (`email_verified === true`), trimmed and lower-cased. Informational: never a stable identifier. */
  readonly email: string;
  readonly emailVerified: true;
}

export type GoogleIdentityFailureReason =
  | "not_configured"
  | "malformed_token"
  | "invalid_signature"
  | "invalid_algorithm"
  | "invalid_issuer"
  | "invalid_audience"
  | "invalid_nonce"
  | "expired"
  | "not_yet_valid"
  | "invalid_time_claims"
  | "missing_subject"
  | "missing_email"
  | "email_not_verified"
  | "verification_failed";

/** A rejection with a stable machine-readable reason. The message is the reason; it never contains token text. */
export class GoogleIdentityError extends Error {
  readonly reason: GoogleIdentityFailureReason;
  constructor(reason: GoogleIdentityFailureReason) {
    super(reason);
    this.name = "GoogleIdentityError";
    this.reason = reason;
  }
}

/** The slice of a `LoginTicket` this module uses. */
export interface VerifiedTicket {
  getPayload(): TokenPayload | undefined;
  getEnvelope(): { alg?: string } | undefined;
}

/** The slice of `OAuth2Client` this module uses (a seam for local tests; production uses the real client). */
export interface IdTokenVerifierClient {
  verifyIdToken(options: { idToken: string; audience: string }): Promise<VerifiedTicket>;
}

let defaultClient: OAuth2Client | undefined;
/** Created lazily; constructing it does no network I/O. Google's signing keys are fetched (and cached) by the library on first use. */
function getDefaultClient(): IdTokenVerifierClient {
  defaultClient ??= new OAuth2Client({ issuers: [...GOOGLE_ID_TOKEN_ISSUERS] });
  return defaultClient as unknown as IdTokenVerifierClient;
}

export interface VerifyOptions {
  /** From `loadGoogleVerifierConfig`; `null` means "not configured" and every token is refused. */
  config: GoogleVerifierConfig | null;
  /** Test seam. Defaults to a real `OAuth2Client`. */
  client?: IdTokenVerifierClient;
  /** Test seam: current time in milliseconds. */
  nowMs?: () => number;
  /**
   * The OIDC nonce this sign-in/link transaction sent to Google. When given, the token's `nonce` claim must equal it
   * exactly (constant-time comparison); a missing or different nonce is refused. Omit it only when no authorization
   * request was made (there is then nothing to bind the token to).
   */
  expectedNonce?: string;
}

function nonceMatches(expected: string, actual: unknown): boolean {
  if (typeof actual !== "string" || expected.length === 0) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Maps a `google-auth-library` failure to a stable reason from its message PREFIX only; the message is never propagated. */
function reasonFromLibraryError(err: unknown): GoogleIdentityFailureReason {
  const message = err instanceof Error ? err.message : "";
  if (/^Wrong recipient/.test(message)) return "invalid_audience";
  if (/^Invalid issuer/.test(message)) return "invalid_issuer";
  if (/^Token used too late/.test(message)) return "expired";
  if (/^Token used too early/.test(message)) return "not_yet_valid";
  if (/^(Invalid token signature|No pem found)/.test(message)) return "invalid_signature";
  if (/^(Wrong number of segments|Can't parse token)/.test(message)) return "malformed_token";
  if (/^(No issue time|No expiration time|Expiration time too far|iat field|exp field)/.test(message)) return "invalid_time_claims";
  return "verification_failed";
}

/**
 * Verifies a Google ID token and returns the identity it vouches for, or throws `GoogleIdentityError`.
 *
 * Accepts an `unknown` so a caller can pass request input straight in; anything that is not a plausible compact
 * JWS is refused before the library is involved. A client-supplied email is never an input.
 */
export async function verifyGoogleIdToken(idToken: unknown, options: VerifyOptions): Promise<VerifiedGoogleIdentity> {
  const { config } = options;
  if (!config || !CLIENT_ID_SHAPE.test(config.clientId)) throw new GoogleIdentityError("not_configured");

  if (typeof idToken !== "string" || idToken.length === 0 || idToken.length > MAX_TOKEN_LENGTH || !TOKEN_SHAPE.test(idToken)) {
    throw new GoogleIdentityError("malformed_token");
  }

  const client = options.client ?? getDefaultClient();
  let ticket: VerifiedTicket;
  try {
    // Signature (against Google's published keys), issuer, audience, issue/expiry window and maximum lifetime.
    ticket = await client.verifyIdToken({ idToken, audience: config.clientId });
  } catch (err) {
    throw new GoogleIdentityError(reasonFromLibraryError(err));
  }

  // Defence in depth on the signature-verified payload (also what a differently-behaving client must satisfy).
  const payload = ticket?.getPayload?.();
  if (!payload || typeof payload !== "object") throw new GoogleIdentityError("verification_failed");

  if (ticket.getEnvelope?.()?.alg !== REQUIRED_ALGORITHM) throw new GoogleIdentityError("invalid_algorithm");
  if (typeof payload.iss !== "string" || !GOOGLE_ID_TOKEN_ISSUERS.includes(payload.iss)) throw new GoogleIdentityError("invalid_issuer");
  // Exact match against the single configured client ID; an audience list (or any other shape) is refused.
  if (typeof payload.aud !== "string" || payload.aud !== config.clientId) throw new GoogleIdentityError("invalid_audience");

  if (options.expectedNonce !== undefined && !nonceMatches(options.expectedNonce, payload.nonce)) throw new GoogleIdentityError("invalid_nonce");

  const nowSeconds = Math.floor((options.nowMs ?? Date.now)() / 1000);
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) {
    throw new GoogleIdentityError("invalid_time_claims");
  }
  if (payload.exp + CLOCK_SKEW_SECONDS <= nowSeconds) throw new GoogleIdentityError("expired");
  if (payload.iat - CLOCK_SKEW_SECONDS > nowSeconds) throw new GoogleIdentityError("not_yet_valid");

  if (typeof payload.sub !== "string" || !SUBJECT_SHAPE.test(payload.sub)) throw new GoogleIdentityError("missing_subject");

  const rawEmail = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!rawEmail || rawEmail.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+$/.test(rawEmail)) throw new GoogleIdentityError("missing_email");
  // Strictly the boolean `true`: a missing value, `false`, or a string such as "true" is NOT verified.
  if (payload.email_verified !== true) throw new GoogleIdentityError("email_not_verified");

  return Object.freeze({ provider: "google" as const, subject: payload.sub, email: rawEmail, emailVerified: true as const });
}
