import { randomBytes, createHash } from "node:crypto";

/**
 * Researcher onboarding invitation tokens (see routes/invitations.routes.ts).
 *
 * The raw token is 256 bits of CSPRNG output (`crypto.randomBytes`, Node's wrapper around the
 * OS's cryptographically secure generator — the same class of primitive `bcrypt` itself relies
 * on), base64url-encoded so it is URL-safe with no manual escaping. It is returned to the admin
 * exactly once, in the `POST /api/invitations` response body, and NEVER persisted: only
 * `hashToken()`'s SHA-256 digest is written to `AccountInvitation.tokenHash`. This mirrors
 * `User.passwordHash` exactly — a stolen database export can verify a presented token but can
 * never produce one, same as it can never produce a password.
 *
 * SHA-256 (not bcrypt) for the token hash is deliberate and correct here, not a shortcut: bcrypt
 * is for low-entropy, human-chosen secrets (passwords) where a slow, salted hash defeats
 * brute-forcing the small input space. This token has 256 bits of its own entropy — brute-forcing
 * the hash is already infeasible — so a fast cryptographic hash is the right tool, and a slow one
 * would only add needless latency to every invitation lookup.
 */
const TOKEN_BYTES = 32;

/** A fresh, unguessable invitation token. Never logged — callers must only ever put the return
 * value into the one-time HTTP response to the admin who created the invitation. */
export function generateInvitationToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Deterministic, one-way. Used both to store a new token and to look up a presented one. */
export function hashInvitationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
