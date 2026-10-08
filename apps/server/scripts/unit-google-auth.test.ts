/**
 * Unit checks for the pure parts of Google sign-in (Phase 27 / P27.4): configuration validation, the
 * state/PKCE helpers and ID-token verification with an injected clock and key set. The full HTTP flow
 * (sessions, policy, linking) is covered by google-auth-regression.mjs against a mock provider.
 *
 *   npm run test:unit -w apps/server
 */
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  CALLBACK_PATH,
  DESIGNATED_ADMIN_GOOGLE_EMAIL,
  GoogleAuthError,
  buildAuthorizationUrl,
  checkState,
  clearJwksCache,
  getGoogleConfig,
  isDesignatedAdminEmail,
  missingGoogleSettings,
  newPendingAuth,
  verifyIdToken,
} from "../src/lib/googleAuth.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));
const eq = (name: string, got: unknown, want: unknown) => t(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---- the designated identity ------------------------------------------------------------------------
eq("the designated admin address is the one the user confirmed", DESIGNATED_ADMIN_GOOGLE_EMAIL, "susmartcomputinglab@gmail.com");
eq("exact match", isDesignatedAdminEmail("susmartcomputinglab@gmail.com"), true);
eq("case and surrounding whitespace are normalised", isDesignatedAdminEmail("  SusmartComputingLab@GMAIL.com "), true);
for (const bad of ["susmartcomputinglab+x@gmail.com", "susmart.computinglab@gmail.com", "susmartcomputinglab@googlemail.com", "xsusmartcomputinglab@gmail.com", "susmartcomputinglab@gmail.com.evil.test", "", "susmartcomputinglab"]) {
  eq(`not the designated admin: ${JSON.stringify(bad)}`, isDesignatedAdminEmail(bad), false);
}

// ---- configuration --------------------------------------------------------------------------------------
const base = { GOOGLE_CLIENT_ID: "id.apps.test", GOOGLE_CLIENT_SECRET: "s3cret", GOOGLE_OAUTH_REDIRECT_URI: `https://app.example.test${CALLBACK_PATH}`, NODE_ENV: "production" } as NodeJS.ProcessEnv;
t("complete https config is accepted", getGoogleConfig(base) !== null);
eq("endpoints default to Google's own", getGoogleConfig(base)?.tokenEndpoint, "https://oauth2.googleapis.com/token");
eq("…authorization", getGoogleConfig(base)?.authorizationEndpoint, "https://accounts.google.com/o/oauth2/v2/auth");
eq("…jwks", getGoogleConfig(base)?.jwksUri, "https://www.googleapis.com/oauth2/v3/certs");
t("both documented issuer spellings are accepted", !!getGoogleConfig(base)?.issuers.includes("https://accounts.google.com") && !!getGoogleConfig(base)?.issuers.includes("accounts.google.com"));
eq("missing client id -> disabled", getGoogleConfig({ ...base, GOOGLE_CLIENT_ID: "" }), null);
eq("missing secret -> disabled", getGoogleConfig({ ...base, GOOGLE_CLIENT_SECRET: undefined }), null);
eq("missing redirect uri -> disabled", getGoogleConfig({ ...base, GOOGLE_OAUTH_REDIRECT_URI: "  " }), null);
eq("http redirect URI in production -> disabled", getGoogleConfig({ ...base, GOOGLE_OAUTH_REDIRECT_URI: `http://app.example.test${CALLBACK_PATH}` }), null);
eq("wrong callback path -> disabled", getGoogleConfig({ ...base, GOOGLE_OAUTH_REDIRECT_URI: "https://app.example.test/api/auth/google/other" }), null);
eq("a query string on the redirect URI -> disabled", getGoogleConfig({ ...base, GOOGLE_OAUTH_REDIRECT_URI: `https://app.example.test${CALLBACK_PATH}?x=1` }), null);
eq("not a URL at all -> disabled", getGoogleConfig({ ...base, GOOGLE_OAUTH_REDIRECT_URI: "nonsense" }), null);
t("http://localhost redirect is allowed outside production", getGoogleConfig({ ...base, NODE_ENV: "development", GOOGLE_OAUTH_REDIRECT_URI: `http://localhost:4001${CALLBACK_PATH}` }) !== null);
eq("…but http://localhost is NOT allowed in production", getGoogleConfig({ ...base, GOOGLE_OAUTH_REDIRECT_URI: `http://localhost:4001${CALLBACK_PATH}` }), null);
eq("the test-only provider override is honoured outside production", getGoogleConfig({ ...base, NODE_ENV: "test", GOOGLE_OAUTH_BASE_URL: "http://127.0.0.1:9" })?.tokenEndpoint, "http://127.0.0.1:9/token");
eq("…and IGNORED in production (cannot be pointed at a look-alike provider)", getGoogleConfig({ ...base, GOOGLE_OAUTH_BASE_URL: "http://127.0.0.1:9" })?.tokenEndpoint, "https://oauth2.googleapis.com/token");
eq("missingGoogleSettings lists NAMES only", missingGoogleSettings({ GOOGLE_CLIENT_ID: "x" } as NodeJS.ProcessEnv).join(","), "GOOGLE_CLIENT_SECRET,GOOGLE_OAUTH_REDIRECT_URI");

// ---- authorization URL, state --------------------------------------------------------------------------------------
const cfg = getGoogleConfig(base)!;
const pending = newPendingAuth(false, 1_000_000);
const url = new URL(buildAuthorizationUrl(cfg, pending));
eq("authorization URL carries the S256 challenge of the verifier", url.searchParams.get("code_challenge"), createHash("sha256").update(pending.verifier).digest("base64url"));
t("…never the verifier or the client secret", !url.href.includes(pending.verifier) && !url.href.includes("s3cret"));
t("state, nonce and verifier are distinct high-entropy values", new Set([pending.state, pending.nonce, pending.verifier]).size === 3 && pending.state.length >= 40);
eq("checkState accepts the matching state", checkState(pending, pending.state, 1_000_000 + 5_000), pending);
const reason = (fn: () => unknown) => {
  try {
    fn();
    return "no error";
  } catch (e) {
    return e instanceof GoogleAuthError ? e.reason : `other: ${e}`;
  }
};
eq("checkState: wrong state", reason(() => checkState(pending, "wrong", 1_000_000)), "state_mismatch");
eq("checkState: missing pending", reason(() => checkState(undefined, "x")), "no_pending_auth");
eq("checkState: non-string state", reason(() => checkState(pending, ["a"] as unknown, 1_000_000)), "state_mismatch");
eq("checkState: expired after 10 minutes", reason(() => checkState(pending, pending.state, 1_000_000 + 10 * 60_000 + 1)), "state_expired");
eq("checkState: still valid just inside 10 minutes", reason(() => checkState(pending, pending.state, 1_000_000 + 10 * 60_000 - 1)), "no error");
eq("checkState: a clock that went backwards is refused", reason(() => checkState(pending, pending.state, 999_000)), "state_expired");

// ---- ID token verification with an injected clock ---------------------------------------------------------------------
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };
const fetchJwks = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=3600" } });
const NOW = 1_800_000_000_000;
const nowSec = NOW / 1000;
const mk = (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1" }, key = pair.privateKey) => {
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key).toString("base64url")}`;
};
const good = { iss: "https://accounts.google.com", aud: cfg.clientId, sub: "123", email: "A@B.test", email_verified: true, nonce: "N", iat: nowSec, exp: nowSec + 3600 };
const verify = async (claims: Record<string, unknown>, nonce = "N", header?: Record<string, unknown>, key?: typeof pair.privateKey) => {
  clearJwksCache();
  try {
    return await verifyIdToken(cfg, mk(claims, header, key), nonce, fetchJwks as typeof fetch, NOW);
  } catch (e) {
    return e instanceof GoogleAuthError ? e.reason : `other: ${e}`;
  }
};
const claimsOf = async (c: Record<string, unknown>) => {
  const r = await verify(c);
  return typeof r === "string" ? r : `${r.sub}|${r.email}`;
};
eq("valid token -> sub and lower-cased email", await claimsOf(good), "123|a@b.test");
eq("the alternative issuer spelling is accepted", await claimsOf({ ...good, iss: "accounts.google.com" }), "123|a@b.test");
eq("an audience array is accepted only with a matching azp", await claimsOf({ ...good, aud: [cfg.clientId, "x"], azp: cfg.clientId }), "123|a@b.test");
eq("…and refused without it", await claimsOf({ ...good, aud: [cfg.clientId, "x"] }), "wrong_audience");
eq("wrong audience", await claimsOf({ ...good, aud: "other" }), "wrong_audience");
eq("wrong issuer", await claimsOf({ ...good, iss: "https://evil.test" }), "wrong_issuer");
eq("expired", await claimsOf({ ...good, exp: nowSec - 3600 }), "expired");
eq("expired 30s ago is inside the 60s clock-skew allowance", await claimsOf({ ...good, exp: nowSec - 30 }), "123|a@b.test");
eq("expired 61s ago is refused", await claimsOf({ ...good, exp: nowSec - 61 }), "expired");
eq("missing exp", await claimsOf({ ...good, exp: undefined }), "expired");
eq("exp as a string is refused", await claimsOf({ ...good, exp: String(nowSec + 3600) }), "expired");
eq("issued far in the future", await claimsOf({ ...good, iat: nowSec + 600 }), "issued_in_future");
eq("not-before in the future", await claimsOf({ ...good, nbf: nowSec + 600 }), "not_yet_valid");
eq("nonce mismatch", await claimsOf({ ...good, nonce: "other" }), "nonce_mismatch");
eq("nonce missing", await claimsOf({ ...good, nonce: undefined }), "nonce_mismatch");
eq("email_verified false", await claimsOf({ ...good, email_verified: false }), "email_not_verified");
eq('email_verified "true" (string) is not true', await claimsOf({ ...good, email_verified: "true" }), "email_not_verified");
eq("email_verified missing", await claimsOf({ ...good, email_verified: undefined }), "email_not_verified");
eq("missing email", await claimsOf({ ...good, email: undefined }), "missing_email");
eq("missing sub", await claimsOf({ ...good, sub: undefined }), "missing_subject");
eq("empty sub", await claimsOf({ ...good, sub: "" }), "missing_subject");
eq("signed by a different key", await verify(good, "N", undefined, other.privateKey), "bad_signature");
eq('alg "none"', await verify(good, "N", { alg: "none", kid: "k1" }), "unsupported_alg");
eq("alg HS256", await verify(good, "N", { alg: "HS256", kid: "k1" }), "unsupported_alg");
eq("alg RS512 (we only accept what Google signs with)", await verify(good, "N", { alg: "RS512", kid: "k1" }), "unsupported_alg");
eq("unknown kid", await verify(good, "N", { alg: "RS256", kid: "nope" }), "unknown_signing_key");
eq("missing kid", await verify(good, "N", { alg: "RS256" }), "missing_kid");
clearJwksCache();
for (const [name, token] of [
  ["not three parts", "a.b"],
  ["empty segment", "a..c"],
  ["non-base64url characters", "a b.c.d"],
  ["not JSON", `${Buffer.from("{").toString("base64url")}.${Buffer.from("{").toString("base64url")}.x`],
  ["payload is an array", `${Buffer.from('{"alg":"RS256","kid":"k1"}').toString("base64url")}.${Buffer.from("[1]").toString("base64url")}.x`],
] as const) {
  eq(`malformed token: ${name}`, await verifyIdToken(cfg, token, "N", fetchJwks as typeof fetch, NOW).then(() => "accepted", (e) => (e instanceof GoogleAuthError ? e.reason : "other")), "malformed_token");
}
eq("a tampered payload fails the signature", await (async () => {
  clearJwksCache();
  const parts = mk(good).split(".");
  const evil = Buffer.from(JSON.stringify({ ...good, email: "susmartcomputinglab@gmail.com" })).toString("base64url");
  return verifyIdToken(cfg, `${parts[0]}.${evil}.${parts[2]}`, "N", fetchJwks as typeof fetch, NOW).then(() => "accepted", (e) => (e instanceof GoogleAuthError ? e.reason : "other"));
})(), "bad_signature");

console.log(`\n${ok} google-auth unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
