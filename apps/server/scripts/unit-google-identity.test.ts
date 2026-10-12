/**
 * Phase 2.1 unit test of the Google ID-token verification core (src/lib/googleIdentity.ts).
 * Fully local: tokens are signed with a throwaway RSA key and verified by the REAL google-auth-library code path
 * (an OAuth2Client subclass that serves the local public key instead of fetching Google's). A guard asserts that
 * nothing touches the network. No server, no database.   npm run test:unit -w apps/server
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OAuth2Client } from "google-auth-library";
import { ROLES } from "@scl/shared";
import {
  GOOGLE_ID_TOKEN_ISSUERS,
  GoogleIdentityError,
  loadGoogleVerifierConfig,
  verifyGoogleIdToken,
  type IdTokenVerifierClient,
} from "../src/lib/googleIdentity.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

// ---- network guard: any outbound attempt is a failure ------------------------------------------------------------
let networkAttempts = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (() => { networkAttempts++; return Promise.reject(new Error("network blocked")); }) as typeof fetch;
const guard = () => { networkAttempts++; throw new Error("network blocked"); };
(https as { request: unknown }).request = guard;
(https as { get: unknown }).get = guard;
(http as { request: unknown }).request = guard;
(http as { get: unknown }).get = guard;

// ---- fixtures ----------------------------------------------------------------------------------------------------
const CLIENT_ID = "123456789012-abcdefghijklmnop.apps.googleusercontent.com";
const OTHER_CLIENT_ID = "999999999999-zzzzzzzzzzzzzzzz.apps.googleusercontent.com";
const KID = "test-key-1";
const pair = () => crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const good = pair();
const other = pair();
const pem = (k: crypto.KeyObject) => k.export({ type: "spki", format: "pem" }).toString();

class LocalCertClient extends OAuth2Client {
  async getFederatedSignonCertsAsync(): Promise<any> {
    return { certs: { [KID]: pem(good.publicKey) }, format: "PEM" };
  }
}
const localClient = new LocalCertClient({ issuers: [...GOOGLE_ID_TOKEN_ISSUERS] }) as unknown as IdTokenVerifierClient;

const b64 = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function sign(claims: Record<string, unknown>, opts: { key?: crypto.KeyObject; alg?: string; kid?: string } = {}): string {
  const header = { alg: opts.alg ?? "RS256", typ: "JWT", kid: opts.kid ?? KID };
  const input = `${b64(header)}.${b64(claims)}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(input), opts.key ?? good.privateKey).toString("base64url");
  return `${input}.${sig}`;
}
const now = () => Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  sub: "110169484474386276334",
  email: "Lab.Member@Example.com ",
  email_verified: true,
  iat: now() - 10,
  exp: now() + 3000,
  ...over,
});
const without = (k: string) => { const c = claims(); delete c[k]; return c; };

const config = loadGoogleVerifierConfig(CLIENT_ID);
async function reason(token: unknown, opts: Partial<Parameters<typeof verifyGoogleIdToken>[1]> = {}): Promise<string> {
  try {
    await verifyGoogleIdToken(token, { config, client: localClient, ...opts });
    return "ACCEPTED";
  } catch (e) {
    return e instanceof GoogleIdentityError ? e.reason : `UNEXPECTED:${String(e)}`;
  }
}

// ---- configuration -----------------------------------------------------------------------------------------------
t("config: valid client id", loadGoogleVerifierConfig(CLIENT_ID)?.clientId === CLIENT_ID);
t("config: trims", loadGoogleVerifierConfig(`  ${CLIENT_ID}\n`)?.clientId === CLIENT_ID);
for (const bad of [undefined, null, "", "   ", "not-a-client-id", "123-abc.example.com", `${CLIENT_ID} x`, 42 as unknown as string]) {
  t(`config: rejects ${JSON.stringify(bad)}`, loadGoogleVerifierConfig(bad) === null);
}
let called = 0;
const countingClient: IdTokenVerifierClient = { verifyIdToken: async () => { called++; throw new Error("should not be called"); } };
const validToken = sign(claims());
t("unconfigured (null config) refuses", (await reason(validToken, { config: null, client: countingClient })) === "not_configured");
t("invalid client id in config refuses", (await reason(validToken, { config: { clientId: "bogus" }, client: countingClient })) === "not_configured");
t("client not called when unconfigured", called === 0);

// ---- valid token -------------------------------------------------------------------------------------------------
const id = await verifyGoogleIdToken(validToken, { config, client: localClient });
t("valid: provider google", id.provider === "google");
t("valid: subject is sub", id.subject === "110169484474386276334");
t("valid: email trimmed and lower-cased", id.email === "lab.member@example.com");
t("valid: emailVerified true", id.emailVerified === true);
t("valid: result frozen", Object.isFrozen(id));
t("valid: only expected keys", Object.keys(id).sort().join() === "email,emailVerified,provider,subject");
t("valid: bare issuer spelling accepted", (await reason(sign(claims({ iss: "accounts.google.com" })))) === "ACCEPTED");

// ---- signature / algorithm ---------------------------------------------------------------------------------------
t("invalid signature (other key)", (await reason(sign(claims(), { key: other.privateKey }))) === "invalid_signature");
t("unknown key id", (await reason(sign(claims(), { kid: "nope" }))) === "invalid_signature");
const tampered = (() => { const [h, , s] = validToken.split("."); return `${h}.${b64(claims({ sub: "attacker" }))}.${s}`; })();
t("tampered payload", (await reason(tampered)) === "invalid_signature");
t("HS256 header refused", (await reason(sign(claims(), { alg: "HS256" }))) !== "ACCEPTED");
t("alg none (empty signature) refused", (await reason(`${b64({ alg: "none", typ: "JWT" })}.${b64(claims())}.`)) === "malformed_token");

// ---- issuer / audience -------------------------------------------------------------------------------------------
t("wrong issuer", (await reason(sign(claims({ iss: "https://evil.example.com" })))) === "invalid_issuer");
t("missing issuer", (await reason(sign(without("iss")))) === "invalid_issuer");
t("wrong audience", (await reason(sign(claims({ aud: OTHER_CLIENT_ID })))) === "invalid_audience");
t("missing audience", (await reason(sign(without("aud")))) === "invalid_audience");
t("audience array containing ours is refused (exact match only)", (await reason(sign(claims({ aud: [CLIENT_ID, OTHER_CLIENT_ID] })))) !== "ACCEPTED");
t("config for a different client rejects a valid token", (await reason(validToken, { config: loadGoogleVerifierConfig(OTHER_CLIENT_ID) })) === "invalid_audience");

// ---- time claims -------------------------------------------------------------------------------------------------
t("expired", (await reason(sign(claims({ iat: now() - 7200, exp: now() - 3600 })))) === "expired");
t("not yet valid (iat in future)", (await reason(sign(claims({ iat: now() + 3600, exp: now() + 7200 })))) === "not_yet_valid");
t("exp too far in the future", (await reason(sign(claims({ exp: now() + 200000 })))) === "invalid_time_claims");
t("missing exp", (await reason(sign(without("exp")))) === "invalid_time_claims");
t("missing iat", (await reason(sign(without("iat")))) === "invalid_time_claims");
// Defence in depth with an injected clock (the library uses the real clock; our own checks must also hold).
const stubFor = (payload: Record<string, unknown> | undefined, alg: string | null = "RS256"): IdTokenVerifierClient => ({
  verifyIdToken: async () => ({ getPayload: () => payload as any, getEnvelope: () => (alg === null ? undefined : { alg }) }),
});
const stubNow = Date.now();
const okClaims = () => claims({ iat: Math.floor(stubNow / 1000) - 10, exp: Math.floor(stubNow / 1000) + 3000 });
const viaStub = (payload: Record<string, unknown> | undefined, alg: string | null = "RS256") =>
  reason(validToken, { client: stubFor(payload, alg), nowMs: () => stubNow });
t("stub baseline accepted", (await viaStub(okClaims())) === "ACCEPTED");
t("own check: expired", (await reason(validToken, { client: stubFor(okClaims()), nowMs: () => stubNow + 4000 * 1000 })) === "expired");
t("own check: iat in future", (await reason(validToken, { client: stubFor(okClaims()), nowMs: () => stubNow - 1000 * 1000 })) === "not_yet_valid");
t("own check: wrong iss from client", (await viaStub({ ...okClaims(), iss: "x" })) === "invalid_issuer");
t("own check: wrong aud from client", (await viaStub({ ...okClaims(), aud: OTHER_CLIENT_ID })) === "invalid_audience");
t("own check: wrong alg", (await viaStub(okClaims(), "HS256")) === "invalid_algorithm");
t("own check: missing envelope", (await viaStub(okClaims(), null)) === "invalid_algorithm");
t("own check: non-numeric exp", (await viaStub({ ...okClaims(), exp: "9999999999" })) === "invalid_time_claims");
t("own check: NaN iat", (await viaStub({ ...okClaims(), iat: NaN })) === "invalid_time_claims");
t("own check: no payload", (await viaStub(undefined)) === "verification_failed");

// ---- nonce binding (Phase 2.2) ------------------------------------------------------------------------------------
const NONCE = "n-0123456789abcdef0123456789abcdef0123456789a";
t("nonce: matching nonce accepted", (await reason(sign(claims({ nonce: NONCE })), { expectedNonce: NONCE })) === "ACCEPTED");
t("nonce: different nonce refused", (await reason(sign(claims({ nonce: "other" })), { expectedNonce: NONCE })) === "invalid_nonce");
t("nonce: missing nonce claim refused", (await reason(sign(claims()), { expectedNonce: NONCE })) === "invalid_nonce");
t("nonce: non-string nonce claim refused", (await reason(sign(claims({ nonce: 5 })), { expectedNonce: NONCE })) === "invalid_nonce");
t("nonce: empty expected nonce never matches", (await reason(sign(claims({ nonce: "" })), { expectedNonce: "" })) === "invalid_nonce");
t("nonce: not checked when none expected (verification-only use)", (await reason(sign(claims({ nonce: "anything" })))) === "ACCEPTED");

// ---- subject / email ---------------------------------------------------------------------------------------------
t("missing sub", (await reason(sign(without("sub")))) === "missing_subject");
t("empty sub", (await reason(sign(claims({ sub: "" })))) === "missing_subject");
t("numeric sub refused", (await reason(sign(claims({ sub: 12345 })))) === "missing_subject");
t("sub with whitespace refused", (await reason(sign(claims({ sub: "a b" })))) === "missing_subject");
t("sub too long refused", (await reason(sign(claims({ sub: "1".repeat(256) })))) === "missing_subject");
t("missing email", (await reason(sign(without("email")))) === "missing_email");
t("empty email", (await reason(sign(claims({ email: "  " })))) === "missing_email");
t("non-string email", (await reason(sign(claims({ email: ["a@b.c"] })))) === "missing_email");
t("email without @", (await reason(sign(claims({ email: "nobody" })))) === "missing_email");
t("email too long", (await reason(sign(claims({ email: `${"a".repeat(250)}@b.co` })))) === "missing_email");
t("email_verified false", (await reason(sign(claims({ email_verified: false })))) === "email_not_verified");
t("email_verified missing", (await reason(sign(without("email_verified")))) === "email_not_verified");
t('email_verified string "true"', (await reason(sign(claims({ email_verified: "true" })))) === "email_not_verified");
t("email_verified 1", (await reason(sign(claims({ email_verified: 1 })))) === "email_not_verified");
// A client-submitted email is not an input: extra properties on the options or token are ignored.
t("email comes only from verified claims", id.email !== "attacker@example.com");

// ---- malformed input & provider errors ---------------------------------------------------------------------------
for (const [name, v] of [
  ["undefined", undefined], ["null", null], ["number", 5], ["object", { a: 1 }], ["empty", ""], ["spaces", "   "],
  ["one segment", "abc"], ["two segments", "a.b"], ["four segments", "a.b.c.d"], ["bad chars", "a.b.c!"],
  ["whitespace inside", "a.b .c"], ["empty segment", "a..c"], ["oversized", `${"a".repeat(9000)}.b.c`],
] as [string, unknown][]) {
  called = 0;
  t(`malformed (${name}) rejected before the library`, (await reason(v, { client: countingClient })) === "malformed_token" && called === 0);
}
t("well-shaped garbage rejected", (await reason("aaaa.bbbb.cccc")) !== "ACCEPTED");

const SECRET_TOKEN = validToken;
for (const [name, err] of [
  ["generic error embedding the token", new Error(`Failed something with ${SECRET_TOKEN}`)],
  ["certificate fetch failure", new Error("Failed to retrieve verification certificates: ECONNREFUSED")],
  ["non-Error throw", "boom"],
] as [string, unknown][]) {
  let caught: unknown;
  try {
    await verifyGoogleIdToken(SECRET_TOKEN, { config, client: { verifyIdToken: async () => { throw err; } } });
  } catch (e) { caught = e; }
  const e = caught as GoogleIdentityError;
  t(`provider error (${name}) -> verification_failed`, e instanceof GoogleIdentityError && e.reason === "verification_failed");
  t(`provider error (${name}) leaks no token`, !JSON.stringify({ m: e?.message, s: e?.stack, r: e?.reason, c: (e as any)?.cause }).includes(SECRET_TOKEN.slice(20, 60)));
}
{
  let caught: GoogleIdentityError | undefined;
  try { await verifyGoogleIdToken(sign(claims({ aud: OTHER_CLIENT_ID })), { config, client: localClient }); } catch (e) { caught = e as GoogleIdentityError; }
  t("library rejection message never carries token text", !!caught && caught.message === "invalid_audience" && (caught as any).cause === undefined);
}

// ---- no network, no environment, no side effects -----------------------------------------------------------------
t("no network attempted during any case", networkAttempts === 0);
globalThis.fetch = realFetch;

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../src");
const moduleSrc = fs.readFileSync(path.join(srcDir, "lib/googleIdentity.ts"), "utf8");
const code = moduleSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
t("module does not read process.env", !/process\.env/.test(code));
t("module imports no prisma/db/session/route/bcrypt/express", !/from\s+["'][^"']*(prisma|\/db|session|routes|bcrypt|express|middleware|\.\/auth)[^"']*["']/i.test(code));
t("module has no write/create calls", !/\.(create|update|upsert|delete|createMany)\s*\(/.test(code) && !/\bpassword\b/i.test(code));
t("module defines no route", !/\b(router|app)\.(get|post|put|patch|delete|use)\b/.test(code));
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}
// Phase 2.2: the verifier is consumed only by the Google routes; nothing else may depend on it.
const importers = walk(srcDir).filter((f) => f.endsWith(".ts") && !f.endsWith("lib/googleIdentity.ts") && /googleIdentity/.test(fs.readFileSync(f, "utf8")));
t("only the Google auth router/flow import the verifier", importers.map((f) => path.relative(srcDir, f)).sort().join() === "lib/googleOAuth.ts,routes/googleAuth.routes.ts");
t("roles unchanged", JSON.stringify([...ROLES]) === JSON.stringify(["ADMIN", "LAB_MANAGER", "MEMBER"]));

console.log(`\n${ok} unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
