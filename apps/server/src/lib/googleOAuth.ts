import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { prisma } from "./prisma.js";
import { loadGoogleVerifierConfig } from "./googleIdentity.js";

/**
 * Google OpenID Connect authorization-code flow plumbing (Phase 2.2): configuration, the one-time browser-bound
 * transaction (state + nonce + PKCE verifier), and the thin, injectable client for Google's authorization and token
 * endpoints. Identity VERIFICATION stays in `googleIdentity.ts`; the decision of what a verified identity may do (link to
 * the signed-in account, or sign in an already-linked one) lives in `routes/googleAuth.routes.ts`.
 *
 * Nothing here reads a request body for a destination: every redirect target is a fixed path chosen by the server.
 */

export const GOOGLE_PROVIDER = "google";
export const CALLBACK_PATH = "/api/auth/google/callback";
export const TRANSACTION_TTL_MS = 10 * 60 * 1000;
/**
 * Lifetime of a session created ONLY to carry an anonymous sign-in transaction (a little longer than the transaction).
 * Authenticated sessions keep the normal policy; a successful sign-in regenerates into a normal-lifetime session.
 */
export const PENDING_SESSION_TTL_MS = TRANSACTION_TTL_MS + 2 * 60 * 1000;
/** Global backstop on live short-lived pending sessions (a cross-instance bound the per-IP limiter cannot give). */
export const MAX_PENDING_SESSIONS = 2000;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** The exact redirect URI registered in the Google Cloud console; never derived from request headers. */
  redirectUri: string;
}

function validRedirectUri(raw: string, production: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== CALLBACK_PATH) return null;
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "https:") return url.toString();
  // Plain http is accepted only for a loopback host and never in production.
  if (url.protocol === "http:" && loopback && !production) return url.toString();
  return null;
}

/**
 * The Google OAuth configuration, or `null` when any part is absent or invalid. `null` disables ONLY Google
 * sign-in/linking (fail closed); password login is unaffected. Takes the environment as a parameter.
 */
export function loadGoogleOAuthConfig(env: NodeJS.ProcessEnv = process.env): GoogleOAuthConfig | null {
  const verifier = loadGoogleVerifierConfig(env.GOOGLE_OAUTH_CLIENT_ID);
  if (!verifier) return null;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientSecret || clientSecret.length < 8 || clientSecret.length > 256 || /\s/.test(clientSecret)) return null;
  const redirectUri = validRedirectUri(env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ?? "", env.NODE_ENV === "production");
  if (!redirectUri) return null;
  return { clientId: verifier.clientId, clientSecret, redirectUri };
}

// ---- the one-time transaction, stored server-side in the initiating browser's own session ------------------------

export type FlowPurpose = "signin" | "link";

export interface FlowTransaction {
  purpose: FlowPurpose;
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
  /** For `link` only: the account that started it. The callback must still be signed in as this exact user. */
  userId?: string;
}

declare module "express-session" {
  interface SessionData {
    googleFlow?: FlowTransaction;
  }
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
}

/**
 * Takes the pending transaction, exactly once. The removal is a single atomic statement on the session row
 * (`json_remove ... WHERE the same state is still present`), so two concurrent callbacks for one browser cannot both
 * win: the loser sees zero affected rows and gets `null`. The in-memory copy is cleared too, so the end-of-request
 * session save cannot write the transaction back. Throws when the store is unavailable (the caller fails closed).
 *
 * Residual (documented, not solvable with express-session's whole-document saves): a request that loaded the session
 * BEFORE this removal and saves it AFTER could write the old document back. That needs a concurrent request from the
 * same browser and still cannot complete a flow without a fresh single-use Google code bound to this PKCE challenge.
 */
export async function consumeTransaction(req: Request): Promise<FlowTransaction | null> {
  const tx = req.session.googleFlow ?? null;
  if (!tx) return null;
  const affected = await prisma.$executeRaw`UPDATE "Session" SET "data" = json_remove("data", '$.googleFlow') WHERE "id" = ${req.sessionID} AND json_extract("data", '$.googleFlow.state') = ${tx.state}`;
  if (affected !== 1) return null;
  delete req.session.googleFlow;
  return tx;
}

export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---- Google's authorization and token endpoints (injectable for tests) ------------------------------------------

export interface AuthorizationRequest {
  state: string;
  nonce: string;
  codeChallenge: string;
}

export interface GoogleOAuthProvider {
  newPkce(): Promise<{ codeVerifier: string; codeChallenge: string }>;
  buildAuthUrl(config: GoogleOAuthConfig, req: AuthorizationRequest): string;
  /** Exchanges the authorization code (with the PKCE verifier) and returns ONLY the ID token. */
  exchangeCode(config: GoogleOAuthConfig, input: { code: string; codeVerifier: string }): Promise<string>;
}

export const defaultGoogleOAuthProvider: GoogleOAuthProvider = {
  async newPkce() {
    const { codeVerifier, codeChallenge } = await new OAuth2Client().generateCodeVerifierAsync();
    if (!codeChallenge) throw new Error("PKCE challenge unavailable");
    return { codeVerifier, codeChallenge };
  },
  buildAuthUrl(config, req) {
    return new OAuth2Client({ clientId: config.clientId, redirectUri: config.redirectUri }).generateAuthUrl({
      scope: ["openid", "email"],
      state: req.state,
      nonce: req.nonce,
      code_challenge: req.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      prompt: "select_account",
    });
  },
  async exchangeCode(config, { code, codeVerifier }) {
    const client = new OAuth2Client({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri });
    const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: config.redirectUri });
    if (typeof tokens.id_token !== "string" || !tokens.id_token) throw new Error("no id_token");
    return tokens.id_token;
  },
};
