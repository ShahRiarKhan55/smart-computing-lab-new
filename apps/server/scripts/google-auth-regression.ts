/**
 * Phase 2.2 regression: Google account linking and sign-in, end to end against the real Express routers, the real session
 * middleware/store and a DISPOSABLE copy of the local SQLite database. Google itself is simulated in-process: ID tokens are
 * signed with a throwaway RSA key and verified by the real google-auth-library path; the authorization-code exchange is a
 * fake that enforces PKCE. No request leaves the loopback interface (a guard fails the run otherwise).
 *
 * Requires apps/server/prisma/dev.db to exist, be seeded, and contain the OAuthIdentity table (a LOCAL dev database;
 * `npx prisma db push && npm run seed` on a scratch DATABASE_URL, then copy it to prisma/dev.db). Refuses to run when
 * Turso variables are set or the database URL is not a plain local file.
 *
 *   npx tsx scripts/google-auth-regression.ts
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(here, "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => {
  if (cond) ok++;
  else failures.push(detail ? `${name} -- ${detail}` : name);
};

if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) {
  console.error("Refusing to run: Turso variables are set. Unset TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.");
  process.exit(2);
}
if (!fs.existsSync(SOURCE_DB)) {
  console.error("apps/server/prisma/dev.db is missing (see the header of this script).");
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "scl-google-"));
const dbFile = path.join(workDir, "t.db");
fs.copyFileSync(SOURCE_DB, dbFile);

// ---- environment (set BEFORE the app modules load) ----------------------------------------------------------------
const CLIENT_ID = "123456789012-abcdefghijklmnop.apps.googleusercontent.com";
const OTHER_CLIENT_ID = "999999999999-zzzzzzzzzzzzzzzz.apps.googleusercontent.com";
const REDIRECT = "http://localhost:4001/api/auth/google/callback";
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.SESSION_SECRET = "google-regression-secret-0000000000";
process.env.NODE_ENV = "test";
process.env.STORAGE_DIR = path.join(workDir, "files");
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
delete process.env.GOOGLE_OAUTH_REDIRECT_URI;

// ---- network guard: only loopback is allowed ----------------------------------------------------------------------
let offLoopback = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
  const u = new URL(typeof input === "string" ? input : input.url ?? String(input));
  if (u.hostname !== "127.0.0.1") {
    offLoopback++;
    return Promise.reject(new Error("network blocked"));
  }
  return realFetch(input, init);
}) as typeof fetch;
(https as { request: unknown }).request = () => {
  offLoopback++;
  throw new Error("network blocked");
};
(https as { get: unknown }).get = (https as { request: unknown }).request;

// Everything the app logs is captured: only fixed messages may appear (no codes, tokens, subjects, SQL, Prisma errors).
const logged: string[] = [];
const realConsoleError = console.error;
console.error = (...args: unknown[]) => {
  logged.push(args.map((a) => (typeof a === "string" ? a : `<<${typeof a}>>`)).join(" "));
};

const express = (await import("express")).default;
const bcrypt = (await import("bcryptjs")).default;
const { OAuth2Client } = await import("google-auth-library");
const { prisma } = await import("../src/lib/prisma.js");
const { createApp } = await import("../src/app.js");
const { createSessionMiddleware } = await import("../src/lib/session.js");
const { default: apiRoutes } = await import("../src/routes/index.js");
const { createGoogleAuthRouter } = await import("../src/routes/googleAuth.routes.js");
const { loadGoogleOAuthConfig, defaultGoogleOAuthProvider, TRANSACTION_TTL_MS, PENDING_SESSION_TTL_MS } = await import("../src/lib/googleOAuth.js");
const { PrismaSessionStore, SESSION_CLEANUP_BATCH, SESSION_CLEANUP_INTERVAL_MS } = await import("../src/lib/prismaSessionStore.js");
const { createStartLimiter, bucketKeyForIp } = await import("../src/lib/oauthStartRateLimit.js");
const { GOOGLE_ID_TOKEN_ISSUERS } = await import("../src/lib/googleIdentity.js");

// ---- fake Google ---------------------------------------------------------------------------------------------------
const KID = "k1";
const good = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const evil = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
class LocalCertClient extends OAuth2Client {
  async getFederatedSignonCertsAsync(): Promise<any> {
    return { certs: { [KID]: good.publicKey.export({ type: "spki", format: "pem" }).toString() }, format: "PEM" };
  }
}
const verifierClient = new LocalCertClient({ issuers: [...GOOGLE_ID_TOKEN_ISSUERS] }) as any;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const nowS = () => Math.floor(Date.now() / 1000);
function signJwt(claims: Record<string, unknown>, key: crypto.KeyObject): string {
  const input = `${b64({ alg: "RS256", typ: "JWT", kid: KID })}.${b64(claims)}`;
  return `${input}.${crypto.sign("RSA-SHA256", Buffer.from(input), key).toString("base64url")}`;
}

interface Grant {
  nonce: string;
  challenge: string;
  sub: string;
  email: string;
  over: Record<string, unknown>;
  key: crypto.KeyObject;
  nonceOverride?: string;
}
const grants = new Map<string, Grant>();
let tokenExchanges = 0;
let failNextExchange = false;
const fakeProvider = {
  newPkce: defaultGoogleOAuthProvider.newPkce,
  buildAuthUrl: defaultGoogleOAuthProvider.buildAuthUrl,
  async exchangeCode(_config: unknown, { code, codeVerifier }: { code: string; codeVerifier: string }) {
    tokenExchanges++;
    if (failNextExchange) {
      failNextExchange = false;
      throw new Error("token endpoint down");
    }
    const g = grants.get(code);
    grants.delete(code); // an authorization code works once
    if (!g) throw new Error("invalid_grant");
    const challenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    if (challenge !== g.challenge) throw new Error("invalid_grant (PKCE)");
    return signJwt(
      {
        iss: "https://accounts.google.com",
        aud: CLIENT_ID,
        sub: g.sub,
        email: g.email,
        email_verified: true,
        nonce: g.nonceOverride ?? g.nonce,
        iat: nowS() - 5,
        exp: nowS() + 3000,
        ...g.over,
      },
      g.key,
    );
  },
};

/** What Google would do after the user approves: returns the callback query for this authorization URL. */
function approve(authUrl: string, who: { sub: string; email: string }, opts: { over?: Record<string, unknown>; key?: crypto.KeyObject; nonceOverride?: string; stateOverride?: string } = {}) {
  const u = new URL(authUrl);
  const code = `code-${crypto.randomBytes(8).toString("hex")}`;
  grants.set(code, { nonce: u.searchParams.get("nonce")!, challenge: u.searchParams.get("code_challenge")!, sub: who.sub, email: who.email, over: opts.over ?? {}, key: opts.key ?? good.privateKey, nonceOverride: opts.nonceOverride });
  return `code=${encodeURIComponent(code)}&state=${encodeURIComponent(opts.stateOverride ?? u.searchParams.get("state")!)}`;
}

// ---- test servers --------------------------------------------------------------------------------------------------
let clockOffsetMs = 0;
const nowMs = () => Date.now() + clockOffsetMs;
const configured = () => loadGoogleOAuthConfig({ GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: "test-secret-value", GOOGLE_OAUTH_REDIRECT_URI: REDIRECT, NODE_ENV: "test" } as NodeJS.ProcessEnv);

const flowApp = express();
flowApp.set("trust proxy", false);
flowApp.use(express.json());
flowApp.use(createSessionMiddleware());
flowApp.use("/api/auth/google", createGoogleAuthRouter({ getConfig: configured, provider: fakeProvider as any, verifierClient, nowMs, startLimiter: createStartLimiter({ max: 1_000_000 }) }));
flowApp.use("/api", apiRoutes); // the real routers (password login, logout, users, ...) behind the Google router
function listen(app: http.RequestListener): Promise<{ base: string; close: () => void }> {
  return new Promise((resolve) => {
    const s = http.createServer(app).listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${(s.address() as any).port}`, close: () => s.close() }));
  });
}
const flow = await listen(flowApp);
const plain = await listen(createApp()); // the real app, Google NOT configured
const plainOrigin = plain.base;

// ---- tiny browser with a cookie jar --------------------------------------------------------------------------------
class Browser {
  jar = new Map<string, string>();
  constructor(public base: string) {}
  get sid(): string | undefined {
    return this.jar.get("scl.sid");
  }
  async req(method: string, p: string, body?: unknown, extra: Record<string, string | null> = {}) {
    const res = await fetch(this.base + p, {
      method,
      redirect: "manual",
      headers: Object.fromEntries(
        Object.entries({ "Content-Type": "application/json", Origin: this.base, Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "), ...extra }).filter(([, v]) => v !== null),
      ) as Record<string, string>,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const val = pair.slice(i + 1);
      if (/;\s*Expires=Thu, 01 Jan 1970/i.test(c) || val === "") this.jar.delete(name);
      else this.jar.set(name, val);
    }
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, location: res.headers.get("location"), json, text };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown, extra?: Record<string, string | null>) => this.req("POST", p, b ?? {}, extra);
  login = (email: string, password: string) => this.post("/api/auth/login", { email, password });
}

// ---- fixtures ------------------------------------------------------------------------------------------------------
const PW = "Passw0rd!-test";
const LS = { currentPassword: PW };
const hash = await bcrypt.hash(PW, 4);
const mk = (email: string, role: string) => prisma.user.create({ data: { email, passwordHash: hash, role } });
const member = await mk("g-member@example.org", "MEMBER");
const member2 = await mk("g-member2@example.org", "MEMBER");
const member3 = await mk("g-member3@example.org", "MEMBER");
const manager = await mk("g-manager@example.org", "LAB_MANAGER");
const admin = await mk("g-admin@example.org", "ADMIN");
const SUB_A = "100000000000000000001";
const SUB_B = "100000000000000000002";
const SUB_C = "100000000000000000003";
const SUB_UNKNOWN = "100000000000000000099";

const counts = async () => ({
  users: await prisma.user.count(),
  identities: await prisma.oAuthIdentity.count(),
  audits: await prisma.auditLog.count(),
});
const usersSnapshot = async () => JSON.stringify(await prisma.user.findMany({ orderBy: { id: "asc" }, select: { id: true, email: true, role: true, passwordHash: true } }));

/** Runs a link flow for `b` (already signed in) and returns the callback response. */
async function link(b: Browser, who: { sub: string; email: string }, opts: Parameters<typeof approve>[2] = {}, callbackQuery?: (q: string) => string) {
  const start = await b.post("/api/auth/google/link/start", LS);
  if (start.status !== 200) return { start, cb: start };
  const q = approve(start.json.url, who, opts);
  const cb = await b.get(`/api/auth/google/callback?${callbackQuery ? callbackQuery(q) : q}`);
  return { start, cb };
}
async function signInStart(b: Browser) {
  const start = await b.get("/api/auth/google/start");
  return { start, url: start.location! };
}

// ======================================================================================================================
// 1. Configuration fails closed
// ======================================================================================================================
const baseEnv = { GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: "test-secret-value", GOOGLE_OAUTH_REDIRECT_URI: "https://labs.example.edu/api/auth/google/callback" } as Record<string, string>;
const cfg = (over: Record<string, string | undefined>) => loadGoogleOAuthConfig({ ...baseEnv, ...over } as NodeJS.ProcessEnv);
t("config: valid https accepted", cfg({})?.clientId === CLIENT_ID);
t("config: valid localhost http accepted outside production", cfg({ GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:4001/api/auth/google/callback" }) !== null);
t("config: http refused in production", cfg({ GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:4001/api/auth/google/callback", NODE_ENV: "production" }) === null);
t("config: http for a non-loopback host refused", cfg({ GOOGLE_OAUTH_REDIRECT_URI: "http://labs.example.edu/api/auth/google/callback" }) === null);
t("config: wrong path refused", cfg({ GOOGLE_OAUTH_REDIRECT_URI: "https://labs.example.edu/other" }) === null);
t("config: query string refused", cfg({ GOOGLE_OAUTH_REDIRECT_URI: "https://labs.example.edu/api/auth/google/callback?x=1" }) === null);
t("config: credentials in URL refused", cfg({ GOOGLE_OAUTH_REDIRECT_URI: "https://u:p@labs.example.edu/api/auth/google/callback" }) === null);
t("config: missing client id", cfg({ GOOGLE_OAUTH_CLIENT_ID: undefined }) === null);
t("config: malformed client id", cfg({ GOOGLE_OAUTH_CLIENT_ID: "nope" }) === null);
t("config: missing secret", cfg({ GOOGLE_OAUTH_CLIENT_SECRET: undefined }) === null);
t("config: blank secret", cfg({ GOOGLE_OAUTH_CLIENT_SECRET: "   " }) === null);
t("config: secret with whitespace", cfg({ GOOGLE_OAUTH_CLIENT_SECRET: "has space inside" }) === null);
t("config: missing redirect", cfg({ GOOGLE_OAUTH_REDIRECT_URI: undefined }) === null);
t("config: nothing set -> null", loadGoogleOAuthConfig({} as NodeJS.ProcessEnv) === null);

{
  const b = new Browser(plainOrigin);
  const s = await b.get("/api/auth/google/status");
  t("unconfigured: status reports disabled", s.status === 200 && s.json?.enabled === false);
  const st = await b.get("/api/auth/google/start");
  t("unconfigured: start redirects to login with a stable code", st.status === 302 && st.location === "/login?google_error=unavailable");
  const cb = await b.get("/api/auth/google/callback?code=x&state=y");
  t("unconfigured: callback refuses", cb.status === 302 && cb.location === "/login?google_error=unavailable");
  await b.login("g-member@example.org", PW);
  const ls = await b.post("/api/auth/google/link/start", LS);
  t("unconfigured: link/start is 404 even when signed in", ls.status === 404);
  const lk = await b.get("/api/auth/google/link");
  t("unconfigured: link status says disabled", lk.status === 200 && lk.json?.enabled === false && lk.json?.linked === false);
  t("unconfigured: password login still works", (await b.get("/api/auth/me")).json?.user?.email === "g-member@example.org");
}

// ======================================================================================================================
// 2. Linking
// ======================================================================================================================
{
  const anon = new Browser(flow.base);
  t("link: status public + enabled", (await anon.get("/api/auth/google/status")).json?.enabled === true);
  const ls = await anon.post("/api/auth/google/link/start", LS);
  t("link: link/start without a session is 401", ls.status === 401);
  t("link: link status without a session is 401", (await anon.get("/api/auth/google/link")).status === 401);
  const before = await counts();
  const cb = await anon.get(`/api/auth/google/callback?code=a&state=b`);
  t("link: callback without a transaction fails", cb.status === 302 && cb.location === "/login?google_error=failed");
  t("link: nothing written by an unauthenticated attempt", JSON.stringify(await counts()) === JSON.stringify(before));
}

const mB = new Browser(flow.base);
t("member password login works alongside Google routes", (await mB.login("g-member@example.org", PW)).status === 200);
const memberRoleBefore = (await prisma.user.findUnique({ where: { id: member.id } }))!.role;
{
  const start = await mB.post("/api/auth/google/link/start", LS);
  t("link: start returns an authorization URL", start.status === 200 && typeof start.json?.url === "string");
  const u = new URL(start.json.url);
  t("link: URL points at Google's authorization endpoint", u.origin === "https://accounts.google.com");
  t("link: response_type=code", u.searchParams.get("response_type") === "code");
  t("link: client_id and fixed redirect_uri", u.searchParams.get("client_id") === CLIENT_ID && u.searchParams.get("redirect_uri") === REDIRECT);
  t("link: scope is openid email only", u.searchParams.get("scope") === "openid email");
  t("link: PKCE S256 challenge present", u.searchParams.get("code_challenge_method") === "S256" && (u.searchParams.get("code_challenge") ?? "").length >= 43);
  t("link: state and nonce are unguessable", (u.searchParams.get("state") ?? "").length >= 40 && (u.searchParams.get("nonce") ?? "").length >= 40 && u.searchParams.get("state") !== u.searchParams.get("nonce"));
  t("link: the authorization URL never carries the PKCE verifier or a secret", !/verifier|secret/i.test(start.json.url));
  const q = approve(start.json.url, { sub: SUB_A, email: "member.google@gmail.com" });
  const before = await counts();
  const cb = await mB.get(`/api/auth/google/callback?${q}`);
  t("link: success redirects to the fixed profile destination", cb.status === 302 && cb.location === "/profile?google=linked");
  const row = await prisma.oAuthIdentity.findMany({ where: { userId: member.id } });
  t("link: exactly one identity row for this account", row.length === 1 && row[0].provider === "google" && row[0].subject === SUB_A);
  t("link: stored by sub, no email column", !("email" in (row[0] as object)));
  const after = await counts();
  t("link: counts: +1 identity, +1 audit, users unchanged", after.identities === before.identities + 1 && after.audits === before.audits + 1 && after.users === before.users);
  t("link: role unchanged", (await prisma.user.findUnique({ where: { id: member.id } }))!.role === memberRoleBefore);
  const audit = await prisma.auditLog.findFirst({ where: { action: "OAUTH_IDENTITY_LINKED" }, orderBy: { createdAt: "desc" } });
  t("link: audit row names the actor and holds no token/sub", !!audit && audit.entityId === member.id && !JSON.stringify(audit).includes(SUB_A));
  t("link: GET /link reports linked", (await mB.get("/api/auth/google/link")).json?.linked === true);
  t("link: still signed in as the same user", (await mB.get("/api/auth/me")).json?.user?.id === member.id);

  // replay of the very same callback
  const replay = await mB.get(`/api/auth/google/callback?${q}`);
  t("replay: same callback URL is refused", replay.status === 302 && replay.location === "/profile?google=failed" || replay.location === "/login?google_error=failed");
  t("replay: no second row", (await prisma.oAuthIdentity.count({ where: { userId: member.id } })) === 1);

  // an account that is already linked cannot even start another link
  const again = await mB.post("/api/auth/google/link/start", LS);
  t("link: starting again while linked is refused up front (409)", again.status === 409);

  // callback-level guards: a link made elsewhere between start and callback must neither duplicate nor be replaced
  const m3 = new Browser(flow.base);
  await m3.login("g-member3@example.org", PW);
  const SUB_X = "100000000000000000401";
  const SUB_Y = "100000000000000000402";
  let st3 = await m3.post("/api/auth/google/link/start", LS);
  await prisma.oAuthIdentity.create({ data: { userId: member3.id, provider: "google", subject: SUB_X } });
  const same = await m3.get(`/api/auth/google/callback?${approve(st3.json.url, { sub: SUB_X, email: "x@gmail.com" })}`);
  t("link: same Google account again is reported, not duplicated", same.location === "/profile?google=already_linked" && (await prisma.oAuthIdentity.count({ where: { userId: member3.id } })) === 1);
  await prisma.oAuthIdentity.deleteMany({ where: { userId: member3.id } });
  st3 = await m3.post("/api/auth/google/link/start", LS);
  await prisma.oAuthIdentity.create({ data: { userId: member3.id, provider: "google", subject: SUB_X } });
  const other = await m3.get(`/api/auth/google/callback?${approve(st3.json.url, { sub: SUB_Y, email: "y@gmail.com" })}`);
  t("link: a different Google account does not replace the existing link", other.location === "/profile?google=has_other");
  const kept = await prisma.oAuthIdentity.findMany({ where: { userId: member3.id } });
  t("link: original link intact after has_other", kept.length === 1 && kept[0].subject === SUB_X);
  await prisma.oAuthIdentity.deleteMany({ where: { userId: member3.id } });
}

// a different account cannot take a Google identity that is already linked
{
  const b2 = new Browser(flow.base);
  await b2.login("g-member2@example.org", PW);
  const before = await counts();
  const r = await link(b2, { sub: SUB_A, email: "member.google@gmail.com" });
  t("duplicate sub: refused for a different account", r.cb.location === "/profile?google=in_use");
  t("duplicate sub: no new row", (await counts()).identities === before.identities);
  t("duplicate sub: still not linked", (await b2.get("/api/auth/google/link")).json?.linked === false);
}

// ---- token / transaction rejection on the link flow ---------------------------------------------------------------
{
  const b = new Browser(flow.base);
  await b.login("g-member2@example.org", PW);
  const before = await counts();
  const rejected: [string, Parameters<typeof approve>[2]][] = [
    ["signature from another key", { key: evil.privateKey }],
    ["wrong audience", { over: { aud: OTHER_CLIENT_ID } }],
    ["wrong issuer", { over: { iss: "https://evil.example.com" } }],
    ["expired token", { over: { iat: nowS() - 7200, exp: nowS() - 3600 } }],
    ["unverified email", { over: { email_verified: false } }],
    ["missing email", { over: { email: undefined } }],
    ["missing sub", { over: { sub: undefined } }],
    ["nonce mismatch", { nonceOverride: "not-the-nonce-we-sent" }],
    ["missing nonce", { over: { nonce: undefined }, nonceOverride: undefined }],
    ["state mismatch", { stateOverride: "forged-state-value" }],
  ];
  for (const [name, opts] of rejected) {
    const o = { ...opts };
    // "missing nonce": remove the claim entirely
    const r = await link(b, { sub: SUB_C, email: "c@gmail.com" }, name === "missing nonce" ? { over: { nonce: undefined }, nonceOverride: "" } : o);
    t(`link rejects: ${name}`, r.cb.location === "/profile?google=failed", String(r.cb.location));
  }
  t("link rejections wrote nothing", JSON.stringify(await counts()) === JSON.stringify(before));

  // missing code / error param / token endpoint failure
  const s1 = await b.post("/api/auth/google/link/start", LS);
  const noCode = await b.get(`/api/auth/google/callback?state=${new URL(s1.json.url).searchParams.get("state")}`);
  t("link rejects: missing code", noCode.location === "/profile?google=failed");
  const s2 = await b.post("/api/auth/google/link/start", LS);
  const denied = await b.get(`/api/auth/google/callback?error=access_denied&state=${new URL(s2.json.url).searchParams.get("state")}`);
  t("link rejects: provider error=access_denied", denied.location === "/profile?google=failed");

  // transaction consumed even when callback processing fails
  const s3 = await b.post("/api/auth/google/link/start", LS);
  const q3 = approve(s3.json.url, { sub: SUB_C, email: "c@gmail.com" });
  failNextExchange = true;
  const failed = await b.get(`/api/auth/google/callback?${q3}`);
  t("consume-once: a failed exchange fails the callback", failed.location === "/profile?google=failed");
  const retried = await b.get(`/api/auth/google/callback?${q3}`);
  t("consume-once: retrying the same state after a failure is refused", retried.location === "/profile?google=failed" || retried.location === "/login?google_error=failed");
  t("consume-once: nothing linked", (await prisma.oAuthIdentity.count({ where: { subject: SUB_C } })) === 0);

  // PKCE: a code that was bound to a different challenge cannot be exchanged
  const s4 = await b.post("/api/auth/google/link/start", LS);
  const s5 = await b.post("/api/auth/google/link/start", LS); // newer transaction replaces s4
  const q4 = approve(s4.json.url, { sub: SUB_C, email: "c@gmail.com" });
  const stale = await b.get(`/api/auth/google/callback?${q4}`);
  t("only the newest transaction can complete (older state refused)", stale.location === "/profile?google=failed");
  void s5;

  // expiry
  const s6 = await b.post("/api/auth/google/link/start", LS);
  const q6 = approve(s6.json.url, { sub: SUB_C, email: "c@gmail.com" });
  clockOffsetMs = TRANSACTION_TTL_MS + 60_000;
  const late = await b.get(`/api/auth/google/callback?${q6}`);
  clockOffsetMs = 0;
  t("expiry: a transaction older than ten minutes is refused", late.location === "/profile?google=failed");
  t("expiry: nothing linked", (await prisma.oAuthIdentity.count({ where: { subject: SUB_C } })) === 0);

  // session changed between start and callback
  const s7 = await b.post("/api/auth/google/link/start", LS);
  const q7 = approve(s7.json.url, { sub: SUB_C, email: "c@gmail.com" });
  await b.login("g-manager@example.org", PW); // regenerates the session: the pending transaction is gone
  const swapped = await b.get(`/api/auth/google/callback?${q7}`);
  t("session switch: callback after logging in as someone else is refused", swapped.location === "/login?google_error=failed" || swapped.location === "/profile?google=failed");
  t("session switch: nothing linked to either account", (await prisma.oAuthIdentity.count({ where: { subject: SUB_C } })) === 0);

  // defence in depth: even if the session's user changed WITHOUT a regeneration, the link must not attach to the new user
  await b.login("g-member2@example.org", PW);
  const s8 = await b.post("/api/auth/google/link/start", LS);
  const q8 = approve(s8.json.url, { sub: SUB_C, email: "c@gmail.com" });
  const sid = decodeURIComponent(b.sid!).slice(2, decodeURIComponent(b.sid!).lastIndexOf("."));
  const row = await prisma.session.findUnique({ where: { id: sid } });
  const data = JSON.parse(row!.data);
  data.userId = manager.id;
  await prisma.session.update({ where: { id: sid }, data: { data: JSON.stringify(data) } });
  const mismatch = await b.get(`/api/auth/google/callback?${q8}`);
  t("owner binding: callback refused when the signed-in user is not the one who started linking", mismatch.location === "/profile?google=session", String(mismatch.location));
  t("owner binding: nothing linked to either account", (await prisma.oAuthIdentity.count({ where: { subject: SUB_C } })) === 0);

  // another browser cannot complete a transaction started elsewhere
  const victim = new Browser(flow.base);
  await victim.login("g-member2@example.org", PW);
  const sv = await victim.post("/api/auth/google/link/start", LS);
  const qv = approve(sv.json.url, { sub: SUB_C, email: "c@gmail.com" });
  const attacker = new Browser(flow.base);
  await attacker.login("g-manager@example.org", PW);
  const stolen = await attacker.get(`/api/auth/google/callback?${qv}`);
  t("cross-browser: the callback only works in the browser that started it", stolen.location === "/login?google_error=failed");
  t("cross-browser: nothing linked", (await prisma.oAuthIdentity.count({ where: { subject: SUB_C } })) === 0);
}

// ======================================================================================================================
// 3. Sign-in
// ======================================================================================================================
{
  // give the manager and admin a link through the real flow so their sign-in is exercised too
  const mg = new Browser(flow.base);
  await mg.login("g-manager@example.org", PW);
  t("setup: manager links", (await link(mg, { sub: SUB_B, email: "mgr@gmail.com" })).cb.location === "/profile?google=linked");

  const b = new Browser(flow.base);
  const { start, url } = await signInStart(b);
  t("signin: start redirects to Google", start.status === 302 && new URL(url).origin === "https://accounts.google.com");
  const preSid = b.sid;
  t("signin: a browser-bound transaction session was issued", !!preSid);
  const q = approve(url, { sub: SUB_A, email: "member.google@gmail.com" });
  const cb = await b.get(`/api/auth/google/callback?${q}`);
  t("signin: success goes to the fixed destination", cb.status === 302 && cb.location === "/profile");
  t("signin: session id regenerated", !!b.sid && b.sid !== preSid);
  const me = await b.get("/api/auth/me");
  t("signin: signed in as the linked account with its existing role", me.json?.user?.id === member.id && me.json?.user?.role === "MEMBER");
  const old = new Browser(flow.base);
  old.jar.set("scl.sid", preSid!);
  t("signin: the pre-login session id is not authenticated (fixation)", (await old.get("/api/auth/me")).json?.user === null);
  const replay = await b.get(`/api/auth/google/callback?${q}`);
  t("signin: replay of the callback is refused", replay.location === "/login?google_error=failed");
  t("signin: replay does not end the valid session", (await b.get("/api/auth/me")).json?.user?.id === member.id);
  const lo = await b.post("/api/auth/logout");
  t("signin: logout works for a Google-created session", lo.status === 200 && (await b.get("/api/auth/me")).json?.user === null);

  // role is whatever the account has: LAB_MANAGER via Google is still LAB_MANAGER, never elevated
  const m2 = new Browser(flow.base);
  const s2 = await signInStart(m2);
  await m2.get(`/api/auth/google/callback?${approve(s2.url, { sub: SUB_B, email: "mgr@gmail.com" })}`);
  const me2 = await m2.get("/api/auth/me");
  t("signin: manager keeps LAB_MANAGER (no elevation)", me2.json?.user?.role === "LAB_MANAGER");
  t("signin: manager Google session is still refused by ADMIN-only routes", (await m2.get("/api/users")).status === 403);
}

// ---- unknown Google identity: rejected, nothing created or modified ----------------------------------------------
{
  const snapshot = await usersSnapshot();
  const before = await counts();
  for (const who of [
    { sub: SUB_UNKNOWN, email: "stranger@gmail.com" },
    { sub: SUB_UNKNOWN, email: "g-admin@example.org" }, // email equals a real lab account: still not linked
    { sub: "100000000000000000555", email: "admin@smartcomputinglab.org" },
  ]) {
    const b = new Browser(flow.base);
    const { url } = await signInStart(b);
    const cb = await b.get(`/api/auth/google/callback?${approve(url, who)}`);
    t(`unknown identity (${who.email}) -> not_linked`, cb.status === 302 && cb.location === "/login?google_error=not_linked");
    t(`unknown identity (${who.email}) -> not signed in`, (await b.get("/api/auth/me")).json?.user === null);
  }
  t("unknown identities: no users/identities/audit rows created", JSON.stringify(await counts()) === JSON.stringify(before));
  t("unknown identities: users (ids, emails, roles, password hashes) untouched", (await usersSnapshot()) === snapshot);
}

// ---- failures on sign-in --------------------------------------------------------------------------------------------
{
  const cases: [string, Parameters<typeof approve>[2]][] = [
    ["bad signature", { key: evil.privateKey }],
    ["wrong audience", { over: { aud: OTHER_CLIENT_ID } }],
    ["expired", { over: { iat: nowS() - 7200, exp: nowS() - 3600 } }],
    ["unverified email", { over: { email_verified: false } }],
    ["nonce mismatch", { nonceOverride: "other" }],
    ["state mismatch", { stateOverride: "forged" }],
  ];
  for (const [name, opts] of cases) {
    const b = new Browser(flow.base);
    const { url } = await signInStart(b);
    // the identity IS linked: a bad token must still not sign anyone in
    const cb = await b.get(`/api/auth/google/callback?${approve(url, { sub: SUB_A, email: "member.google@gmail.com" }, opts)}`);
    t(`signin rejects: ${name}`, cb.location === "/login?google_error=failed" && (await b.get("/api/auth/me")).json?.user === null, String(cb.location));
  }
  const b = new Browser(flow.base);
  const cb = await b.get("/api/auth/google/callback?code=x&state=y");
  t("signin rejects: callback with no start", cb.location === "/login?google_error=failed");
  const { url } = await signInStart(b);
  clockOffsetMs = TRANSACTION_TTL_MS + 60_000;
  const late = await b.get(`/api/auth/google/callback?${approve(url, { sub: SUB_A, email: "member.google@gmail.com" })}`);
  clockOffsetMs = 0;
  t("signin rejects: expired transaction", late.location === "/login?google_error=failed");
}

// ---- privacy-safe callback diagnostics: every refusal logs ONE fixed label, nothing else -------------------------------
{
  const PREFIX = "[google-auth] callback refused ";
  const LABEL = /^\[google-auth\] callback refused (signin|link|unknown) [a-z-]+$/;
  const FORBIDDEN = [SUB_A, SUB_B, SUB_C, SUB_UNKNOWN, "member.google@gmail.com", "stranger@gmail.com", "x@gmail.com", "y@gmail.com", "c@gmail.com", "code-", "eyJ", "scl.sid", "secret", PW, "state=", "nonce="];
  const seen: string[] = [];
  /** Runs `run`, returns what the app logged meanwhile. */
  async function logs(run: () => Promise<unknown>): Promise<string[]> {
    const from = logged.length;
    await run();
    const lines = logged.slice(from);
    seen.push(...lines);
    return lines;
  }
  const exactly = (lines: string[], label: string) => lines.length === 1 && lines[0] === PREFIX + label;
  const GOOD = { sub: SUB_A, email: "member.google@gmail.com" };
  const cbq = (url: string, who: { sub: string; email: string }, opts: Parameters<typeof approve>[2] = {}) => `/api/auth/google/callback?${approve(url, who, opts)}`;

  // sign-in refusals, one label each; the user-facing redirect stays the generic one
  let b = new Browser(flow.base);
  let { url } = await signInStart(b);
  let res: Awaited<ReturnType<typeof b.get>> | undefined;
  let l = await logs(async () => { res = await b.get("/api/auth/google/callback?error=access_denied&state=x"); });
  t("label: provider error parameter", exactly(l, "signin provider-error-or-missing-parameters") && res?.location === "/login?google_error=failed", JSON.stringify(l));

  b = new Browser(flow.base);
  ({ url } = await signInStart(b));
  l = await logs(async () => { res = await b.get(`/api/auth/google/callback?state=${new URL(url).searchParams.get("state")}`); });
  t("label: missing code", exactly(l, "signin provider-error-or-missing-parameters") && res?.location === "/login?google_error=failed", JSON.stringify(l));

  l = await logs(async () => { res = await new Browser(flow.base).get("/api/auth/google/callback?code=x&state=y"); });
  t("label: no transaction (purpose unknown)", exactly(l, "unknown no-transaction") && res?.location === "/login?google_error=failed", JSON.stringify(l));

  b = new Browser(flow.base);
  ({ url } = await signInStart(b));
  l = await logs(async () => { res = await b.get(cbq(url, GOOD, { stateOverride: "forged" })); });
  t("label: state mismatch", exactly(l, "signin state-mismatch") && res?.location === "/login?google_error=failed", JSON.stringify(l));

  b = new Browser(flow.base);
  ({ url } = await signInStart(b));
  clockOffsetMs = TRANSACTION_TTL_MS + 60_000;
  l = await logs(async () => { res = await b.get(cbq(url, GOOD)); });
  clockOffsetMs = 0;
  t("label: transaction expired", exactly(l, "signin transaction-expired") && res?.location === "/login?google_error=failed", JSON.stringify(l));

  b = new Browser(flow.base);
  ({ url } = await signInStart(b));
  failNextExchange = true;
  l = await logs(async () => { res = await b.get(cbq(url, GOOD)); });
  t("label: token exchange failed (the error text is never logged)", exactly(l, "signin token-exchange-failed") && res?.location === "/login?google_error=failed", JSON.stringify(l));

  const verifyCases: [string, Parameters<typeof approve>[2], string][] = [
    ["wrong audience", { over: { aud: OTHER_CLIENT_ID } }, "invalid-audience"],
    ["nonce mismatch", { nonceOverride: "other" }, "invalid-nonce"],
    ["unverified email", { over: { email_verified: false } }, "email-not-verified"],
    ["expired token", { over: { iat: nowS() - 7200, exp: nowS() - 3600 } }, "expired"],
    ["wrong issuer", { over: { iss: "https://evil.example.com" } }, "invalid-issuer"],
  ];
  for (const [name, opts, reason] of verifyCases) {
    b = new Browser(flow.base);
    ({ url } = await signInStart(b));
    l = await logs(async () => { res = await b.get(cbq(url, GOOD, opts)); });
    t(`label: token rejected (${name})`, exactly(l, `signin token-rejected-${reason}`) && res?.location === "/login?google_error=failed", JSON.stringify(l));
  }
  b = new Browser(flow.base);
  ({ url } = await signInStart(b));
  l = await logs(async () => { res = await b.get(cbq(url, GOOD, { key: evil.privateKey })); });
  t("label: token rejected (signature from another key) is a token-rejected label", l.length === 1 && /^\[google-auth\] callback refused signin token-rejected-[a-z-]+$/.test(l[0]) && res?.location === "/login?google_error=failed", JSON.stringify(l));

  // an unlinked identity is a labelled refusal that writes nothing (no automatic linking, even for a matching e-mail)
  const before = await counts();
  b = new Browser(flow.base);
  ({ url } = await signInStart(b));
  l = await logs(async () => { res = await b.get(cbq(url, { sub: SUB_UNKNOWN, email: "g-admin@example.org" })); });
  t("label: identity not linked (matching e-mail is still not linked)", exactly(l, "signin identity-not-linked") && res?.location === "/login?google_error=not_linked", JSON.stringify(l));
  t("label: the not-linked refusal wrote nothing", JSON.stringify(await counts()) === JSON.stringify(before));

  // success logs nothing
  b = new Browser(flow.base);
  ({ url } = await signInStart(b));
  l = await logs(async () => { res = await b.get(cbq(url, GOOD)); });
  t("label: a successful sign-in logs no refusal", l.length === 0 && res?.location === "/profile", JSON.stringify(l));

  // link refusals
  const lb = new Browser(flow.base);
  await lb.login("g-member2@example.org", PW);
  l = await logs(async () => { res = (await link(lb, GOOD)).cb; });
  t("label: link, identity already used by another account", exactly(l, "link link-identity-in-use") && res?.location === "/profile?google=in_use", JSON.stringify(l));
  l = await logs(async () => { res = (await link(lb, { sub: SUB_C, email: "c@gmail.com" }, { over: { aud: OTHER_CLIENT_ID } })).cb; });
  t("label: link, token rejected", exactly(l, "link token-rejected-invalid-audience") && res?.location === "/profile?google=failed", JSON.stringify(l));
  l = await logs(async () => { res = (await link(lb, { sub: SUB_C, email: "c@gmail.com" }, { stateOverride: "forged" })).cb; });
  t("label: link, state mismatch", exactly(l, "link state-mismatch") && res?.location === "/profile?google=failed", JSON.stringify(l));

  const m3b = new Browser(flow.base);
  await m3b.login("g-member3@example.org", PW);
  const SUB_X2 = "100000000000000000501";
  const SUB_Y2 = "100000000000000000502";
  let st = await m3b.post("/api/auth/google/link/start", LS);
  await prisma.oAuthIdentity.create({ data: { userId: member3.id, provider: "google", subject: SUB_X2 } });
  l = await logs(async () => { res = await m3b.get(cbq(st.json.url, { sub: SUB_X2, email: "x@gmail.com" })); });
  t("label: link, same account already linked", exactly(l, "link link-already-linked") && res?.location === "/profile?google=already_linked", JSON.stringify(l));
  await prisma.oAuthIdentity.deleteMany({ where: { userId: member3.id } });
  st = await m3b.post("/api/auth/google/link/start", LS);
  await prisma.oAuthIdentity.create({ data: { userId: member3.id, provider: "google", subject: SUB_X2 } });
  l = await logs(async () => { res = await m3b.get(cbq(st.json.url, { sub: SUB_Y2, email: "y@gmail.com" })); });
  t("label: link, account already linked to a different identity", exactly(l, "link link-account-has-other") && res?.location === "/profile?google=has_other", JSON.stringify(l));
  await prisma.oAuthIdentity.deleteMany({ where: { userId: member3.id } });

  // hygiene: every line has the fixed shape and carries no request value, subject, e-mail, token, cookie or password
  t("labels: every diagnostic line has the fixed shape", seen.length > 0 && seen.every((m) => LABEL.test(m)), JSON.stringify(seen.filter((m) => !LABEL.test(m))));
  t("labels: no line contains a subject, e-mail, code, token, cookie, state, nonce or password", !seen.some((m) => FORBIDDEN.some((x) => m.includes(x))));
}

// ---- redirects are fixed, never request-controlled ---------------------------------------------------------------
{
  const b = new Browser(flow.base);
  const evilParams = "next=https://evil.example.com&redirect=//evil.example.com&returnTo=https://evil.example.com&redirect_uri=https://evil.example.com&return_url=//evil.example.com";
  const st = await b.get(`/api/auth/google/start?${evilParams}`);
  t("redirect: start ignores request-supplied destinations", new URL(st.location!).origin === "https://accounts.google.com" && new URL(st.location!).searchParams.get("redirect_uri") === REDIRECT);
  const q = approve(st.location!, { sub: SUB_A, email: "member.google@gmail.com" });
  const cb = await b.get(`/api/auth/google/callback?${q}&${evilParams}`);
  t("redirect: callback ignores request-supplied destinations", cb.location === "/profile");
  const failCb = await new Browser(flow.base).get(`/api/auth/google/callback?code=x&state=y&${evilParams}`);
  t("redirect: failure destination is a fixed relative path", failCb.location === "/login?google_error=failed");
  const all = [cb.location, failCb.location];
  t("redirect: every app redirect is a same-origin relative path", all.every((l) => !!l && l.startsWith("/") && !l.startsWith("//")));
}

// ---- database constraints --------------------------------------------------------------------------------------------
{
  const dupSub = await prisma.oAuthIdentity.create({ data: { userId: admin.id, provider: "google", subject: "100000000000000000777" } });
  let e1 = false;
  try { await prisma.oAuthIdentity.create({ data: { userId: member2.id, provider: "google", subject: "100000000000000000777" } }); } catch (e: any) { e1 = e.code === "P2002"; }
  t("db: (provider, subject) is unique", e1);
  let e2 = false;
  try { await prisma.oAuthIdentity.create({ data: { userId: admin.id, provider: "google", subject: "100000000000000000778" } }); } catch (e: any) { e2 = e.code === "P2002"; }
  t("db: one Google identity per account", e2);
  let e3 = false;
  try { await prisma.oAuthIdentity.create({ data: { userId: "no-such-user", provider: "google", subject: "100000000000000000779" } }); } catch { e3 = true; }
  t("db: foreign key to an existing user is enforced", e3);
  await prisma.user.delete({ where: { id: admin.id } });
  t("db: deleting a user cascades to its identity", (await prisma.oAuthIdentity.findUnique({ where: { id: dupSub.id } })) === null);
}

// ======================================================================================================================
// 4. Existing behaviour unchanged
// ======================================================================================================================
{
  const g = new Browser(flow.base);
  t("existing: guest is 401 on /api/users", (await g.get("/api/users")).status === 401);
  t("existing: wrong password is 401", (await g.login("g-member@example.org", "wrong-password")).status === 401);
  t("existing: unknown email is 401", (await g.login("nobody@example.org", PW)).status === 401);
  const m = new Browser(flow.base);
  const lg = await m.login("g-member@example.org", PW);
  t("existing: password login returns the same shape", lg.status === 200 && lg.json?.user?.role === "MEMBER" && Object.keys(lg.json.user).sort().join() === "email,id,role");
  t("existing: a linked member is still refused by ADMIN routes", (await m.get("/api/users")).status === 403);
  const seedAdmin = new Browser(flow.base);
  t("existing: seeded ADMIN can still log in with a password", (await seedAdmin.login("admin@smartcomputinglab.org", "ChangeMe123!")).status === 200);
  t("existing: ADMIN reaches /api/users", (await seedAdmin.get("/api/users")).status === 200);
  t("existing: logout clears the session", ((await m.post("/api/auth/logout")).status === 200) && (await m.get("/api/auth/me")).json?.user === null);
  const roles = await prisma.user.findMany({ where: { id: { in: [member.id, member2.id, manager.id] } }, select: { id: true, role: true } });
  t("existing: roles unchanged after all Google activity", roles.every((r) => r.role === (r.id === manager.id ? "LAB_MANAGER" : "MEMBER")));
}

// ======================================================================================================================
// 5. Re-authentication, CSRF/Origin and unlink (Task B)
// ======================================================================================================================
const ORIGIN_EVIL = "https://evil.example.com";
{
  const u1 = new Browser(flow.base);
  const u2 = new Browser(flow.base);
  await u1.login("g-member2@example.org", PW);
  await u2.login("g-member@example.org", PW); // already linked to SUB_A in section 2
  const flowBefore = async (b: Browser) => (await b.get("/api/auth/google/link")).json;

  // -- link start
  const guest = new Browser(flow.base);
  t("link/start: no session -> 401", (await guest.post("/api/auth/google/link/start", LS)).status === 401);
  t("link/start: missing password -> 400", (await u1.post("/api/auth/google/link/start", {})).status === 400);
  t("link/start: empty password -> 400", (await u1.post("/api/auth/google/link/start", { currentPassword: "" })).status === 400);
  t("link/start: non-string password -> 400", (await u1.post("/api/auth/google/link/start", { currentPassword: 12345 })).status === 400);
  const wrong = await u1.post("/api/auth/google/link/start", { currentPassword: "not-the-password" });
  t("link/start: wrong password -> 401 and no URL", wrong.status === 401 && wrong.json?.url === undefined);
  const sRow = await prisma.session.findUnique({ where: { id: decodeURIComponent(u1.sid!).slice(2, decodeURIComponent(u1.sid!).lastIndexOf(".")) } });
  t("link/start: a failed password check starts no transaction", !!sRow && !JSON.parse(sRow.data).googleFlow);
  const evilO = await u1.post("/api/auth/google/link/start", LS, { Origin: ORIGIN_EVIL });
  t("CSRF: cross-site Origin -> 403 (even with the right password and a session)", evilO.status === 403 && evilO.json?.url === undefined);
  t("CSRF: Origin 'null' -> 403", (await u1.post("/api/auth/google/link/start", LS, { Origin: "null" })).status === 403);
  t("CSRF: no Origin and no fetch metadata -> 403", (await u1.post("/api/auth/google/link/start", LS, { Origin: null })).status === 403);
  t("CSRF: Sec-Fetch-Site cross-site without Origin -> 403", (await u1.post("/api/auth/google/link/start", LS, { Origin: null, "Sec-Fetch-Site": "cross-site" })).status === 403);
  t("CSRF: non-JSON content type -> 415", (await u1.post("/api/auth/google/link/start", LS, { "Content-Type": "text/plain" })).status === 415);
  t("CSRF: form-encoded content type -> 415", (await u1.post("/api/auth/google/link/start", LS, { "Content-Type": "application/x-www-form-urlencoded" })).status === 415);
  const okFetchMeta = await u1.post("/api/auth/google/link/start", LS, { Origin: null, "Sec-Fetch-Site": "same-origin" });
  t("CSRF: same-origin fetch metadata without Origin is accepted", okFetchMeta.status === 200 && typeof okFetchMeta.json?.url === "string");
  t("CSRF: GET is never a way to start linking", (await u1.get("/api/auth/google/link/start")).status === 404);

  // -- already linked
  const dup = await u2.post("/api/auth/google/link/start", LS);
  t("link/start: an account that is already linked gets 409 and no transaction", dup.status === 409 && dup.json?.url === undefined);

  // -- unlink guards (u2 is linked to SUB_A)
  const sub = (await prisma.oAuthIdentity.findMany({ where: { userId: member.id } }))[0];
  t("unlink setup: member has a link", !!sub && sub.subject === SUB_A);
  t("unlink: no session -> 401, link intact", (await guest.post("/api/auth/google/unlink", LS)).status === 401 && (await prisma.oAuthIdentity.count({ where: { userId: member.id } })) === 1);
  t("unlink: missing password -> 400, link intact", (await u2.post("/api/auth/google/unlink", {})).status === 400 && (await prisma.oAuthIdentity.count({ where: { userId: member.id } })) === 1);
  t("unlink: wrong password -> 401, link intact", (await u2.post("/api/auth/google/unlink", { currentPassword: "nope" })).status === 401 && (await prisma.oAuthIdentity.count({ where: { userId: member.id } })) === 1);
  t("unlink: cross-site Origin -> 403, link intact", (await u2.post("/api/auth/google/unlink", LS, { Origin: ORIGIN_EVIL })).status === 403 && (await prisma.oAuthIdentity.count({ where: { userId: member.id } })) === 1);
  t("unlink: non-JSON -> 415, link intact", (await u2.post("/api/auth/google/unlink", LS, { "Content-Type": "text/plain" })).status === 415 && (await prisma.oAuthIdentity.count({ where: { userId: member.id } })) === 1);
  t("unlink: GET is not a route", (await u2.get("/api/auth/google/unlink")).status === 404);

  // another user's identity can never be removed by someone else (u1 has no link; the body cannot name a target)
  const identitiesBefore = await prisma.oAuthIdentity.count();
  const none = await u1.post("/api/auth/google/unlink", { currentPassword: PW, userId: member.id, id: sub.id, subject: SUB_A });
  t("unlink: an account with no link gets 404", none.status === 404);
  t("unlink: body fields naming another user/identity are ignored", (await prisma.oAuthIdentity.count()) === identitiesBefore && (await prisma.oAuthIdentity.count({ where: { userId: member.id } })) === 1);

  // unusable password hash fails closed for linking and unlinking (no administrator or other bypass)
  const hashBackup = (await prisma.user.findUnique({ where: { id: member.id } }))!.passwordHash;
  for (const unusable of ["", "not-a-bcrypt-hash"]) {
    await prisma.user.update({ where: { id: member.id }, data: { passwordHash: unusable } });
    t(`unusable hash (${JSON.stringify(unusable)}): unlink fails closed`, (await u2.post("/api/auth/google/unlink", LS)).status === 401);
    t(`unusable hash (${JSON.stringify(unusable)}): link fails closed`, (await u2.post("/api/auth/google/link/start", LS)).status === 401);
  }
  await prisma.user.update({ where: { id: member.id }, data: { passwordHash: hashBackup } });
  t("unusable hash: link intact", (await prisma.oAuthIdentity.count({ where: { userId: member.id } })) === 1);

  // -- successful unlink then re-link, with everything else preserved
  const auditsBefore = await prisma.auditLog.count({ where: { action: "OAUTH_IDENTITY_UNLINKED" } });
  const others = await prisma.oAuthIdentity.count({ where: { userId: { not: member.id } } });
  const rolesBefore = await usersSnapshot();
  const un = await u2.post("/api/auth/google/unlink", LS);
  t("unlink: success", un.status === 200 && un.json?.unlinked === true);
  t("unlink: removed only the caller's identity", (await prisma.oAuthIdentity.count({ where: { userId: member.id } })) === 0 && (await prisma.oAuthIdentity.count({ where: { userId: { not: member.id } } })) === others);
  t("unlink: user, role and password hash untouched", (await usersSnapshot()) === rolesBefore);
  t("unlink: audit row written", (await prisma.auditLog.count({ where: { action: "OAUTH_IDENTITY_UNLINKED" } })) === auditsBefore + 1);
  t("unlink: session still valid; password login still works", (await u2.get("/api/auth/me")).json?.user?.id === member.id && (await new Browser(flow.base).login("g-member@example.org", PW)).status === 200);
  t("unlink: status reports not linked", (await flowBefore(u2)).linked === false);
  const gone = new Browser(flow.base);
  const gs = await signInStart(gone);
  const gcb = await gone.get(`/api/auth/google/callback?${approve(gs.url, { sub: SUB_A, email: "member.google@gmail.com" })}`);
  t("unlink: the old Google identity can no longer sign in", gcb.location === "/login?google_error=not_linked");
  const relink = await link(u2, { sub: SUB_A, email: "member.google@gmail.com" });
  t("unlink: the account can be linked again afterwards (password re-verified)", relink.cb.location === "/profile?google=linked");
}

// ======================================================================================================================
// 6. Anonymous initiation: rate limit, short-lived pending sessions, cleanup, normal sessions preserved (Task A)
// ======================================================================================================================
const rowFor = async (b: Browser) => prisma.session.findUnique({ where: { id: decodeURIComponent(b.sid!).slice(2, decodeURIComponent(b.sid!).lastIndexOf(".")) } });
{
  // pure limiter
  let clock = 1_000_000;
  const lim = createStartLimiter({ max: 3, windowMs: 1000, maxKeys: 4, now: () => clock });
  t("limiter: first N allowed", lim.take("1.1.1.1") && lim.take("1.1.1.1") && lim.take("1.1.1.1"));
  t("limiter: N+1 refused", lim.take("1.1.1.1") === false);
  t("limiter: one client's budget never affects another", lim.take("2.2.2.2") === true && lim.take("2.2.2.2") === true);
  clock += 1001;
  t("limiter: window expires deterministically", lim.take("1.1.1.1") === true);
  t("limiter: IPv6 addresses in one /64 share a bucket", bucketKeyForIp("2001:db8:1:2:aaaa::1") === bucketKeyForIp("2001:db8:1:2:bbbb::9") && bucketKeyForIp("2001:db8:1:2::1") !== bucketKeyForIp("2001:db8:1:3::1"));
  t("limiter: IPv4-mapped IPv6 maps to the IPv4 bucket", bucketKeyForIp("::ffff:10.0.0.1") === "10.0.0.1");
  for (const ip of ["3.3.3.3", "4.4.4.4", "5.5.5.5", "6.6.6.6", "7.7.7.7"]) lim.take(ip);
  t("limiter: memory stays bounded (oldest bucket evicted at maxKeys)", lim.take("1.1.1.1") === true); // evicted -> fresh budget, no unbounded growth

  // HTTP: per-client limit on the real route; spoofed XFF cannot choose another bucket when proxies are not trusted
  let limClock = Date.now();
  const limApp = express();
  limApp.set("trust proxy", false);
  limApp.use(express.json());
  limApp.use(createSessionMiddleware());
  limApp.use("/api/auth/google", createGoogleAuthRouter({ getConfig: configured, provider: fakeProvider as any, verifierClient, nowMs: () => limClock, startLimiter: createStartLimiter({ max: 3, windowMs: 60_000, now: () => limClock }) }));
  const L = await listen(limApp);
  const rowsBefore = await prisma.session.count();
  const codes: (string | null)[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await new Browser(L.base).req("GET", "/api/auth/google/start", undefined, { "X-Forwarded-For": `9.9.9.${i}` });
    codes.push(r.location);
  }
  t("start: first three accepted, then refused with a stable code", codes.slice(0, 3).every((c) => c?.startsWith("https://accounts.google.com")) && codes[3] === "/login?google_error=rate_limited" && codes[4] === "/login?google_error=rate_limited", JSON.stringify(codes));
  t("start: spoofed X-Forwarded-For does not buy a fresh bucket (proxy not trusted)", codes[3] === "/login?google_error=rate_limited");
  t("start: refused starts persisted no session rows (only the 3 accepted did)", (await prisma.session.count()) === rowsBefore + 3);
  limClock += 61_000;
  t("start: allowed again after the window", (await new Browser(L.base).get("/api/auth/google/start")).location?.startsWith("https://accounts.google.com") === true);
  L.close();

  // trusted single proxy hop: only the hop the proxy appended chooses the bucket
  const prox = express();
  prox.set("trust proxy", 1);
  prox.use(express.json());
  prox.use(createSessionMiddleware());
  prox.use("/api/auth/google", createGoogleAuthRouter({ getConfig: configured, provider: fakeProvider as any, verifierClient, startLimiter: createStartLimiter({ max: 2, windowMs: 60_000 }) }));
  const P = await listen(prox);
  const pc: (string | null)[] = [];
  for (const xff of ["evil1, 5.5.5.5", "evil2, 5.5.5.5", "evil3, 5.5.5.5"]) pc.push((await new Browser(P.base).req("GET", "/api/auth/google/start", undefined, { "X-Forwarded-For": xff })).location);
  t("start: behind TRUST_PROXY=1 client-supplied leading XFF entries cannot evade the limit", pc[2] === "/login?google_error=rate_limited");
  t("start: a different real client address is unaffected (no cross-user lockout)", (await new Browser(P.base).req("GET", "/api/auth/google/start", undefined, { "X-Forwarded-For": "evil1, 6.6.6.6" })).location?.startsWith("https://accounts.google.com") === true);
  P.close();

  // global backstop on live pending sessions
  const nowT = Date.now();
  const livePending = await prisma.session.count({ where: { expiresAt: { gt: new Date(nowT), lt: new Date(nowT + PENDING_SESSION_TTL_MS + 60_000) } } });
  const capApp = express();
  capApp.use(express.json());
  capApp.use(createSessionMiddleware());
  capApp.use("/api/auth/google", createGoogleAuthRouter({ getConfig: configured, provider: fakeProvider as any, verifierClient, startLimiter: createStartLimiter({ max: 1_000_000 }), maxPendingSessions: livePending + 1 }));
  const C = await listen(capApp);
  t("backstop: under the cap a start is accepted", (await new Browser(C.base).get("/api/auth/google/start")).location?.startsWith("https://accounts.google.com") === true);
  const capped = await new Browser(C.base).get("/api/auth/google/start");
  t("backstop: at the cap further starts are refused and write nothing", capped.location === "/login?google_error=rate_limited");
  C.close();
}

{
  // pending-flow sessions are short-lived; ordinary sessions keep the normal policy
  const week = 7 * 24 * 3600 * 1000;
  const anon = new Browser(flow.base);
  const { url } = await signInStart(anon);
  const r1 = await rowFor(anon);
  const left1 = r1!.expiresAt.getTime() - Date.now();
  t("pending session: persisted expiry is at most the pending lifetime", left1 > 0 && left1 <= PENDING_SESSION_TTL_MS + 5000, String(left1));
  const failedCb = await anon.get("/api/auth/google/callback?code=x&state=y");
  const left2 = (await rowFor(anon))!.expiresAt.getTime() - Date.now();
  t("pending session: a failed callback (rolling touch) does not extend it to the normal policy", failedCb.location === "/login?google_error=failed" && left2 <= PENDING_SESSION_TTL_MS + 5000, String(left2));
  const again = new Browser(flow.base);
  const s2 = await signInStart(again);
  await again.get(`/api/auth/google/callback?${approve(s2.url, { sub: SUB_A, email: "member.google@gmail.com" })}`);
  const authed = (await rowFor(again))!.expiresAt.getTime() - Date.now();
  t("signed-in session after Google sign-in has the normal 7-day policy", authed > week - 60_000 && authed <= week + 5000, String(authed));
  const pw = new Browser(flow.base);
  await pw.login("g-member2@example.org", PW);
  const pwLeft = (await rowFor(pw))!.expiresAt.getTime() - Date.now();
  t("password-login session policy unchanged (7 days)", pwLeft > week - 60_000);
  await pw.post("/api/auth/google/link/start", LS);
  const pwLeft2 = (await rowFor(pw))!.expiresAt.getTime() - Date.now();
  t("link/start in a signed-in session does NOT shorten that session", pwLeft2 > week - 60_000, String(pwLeft2));
  void url;
}

{
  // cleanup: bounded, never deletes active sessions
  let clk = Date.now();
  const store = new PrismaSessionStore(prisma, () => clk);
  const mkRow = (id: string, msFromNow: number) => prisma.session.create({ data: { id, data: "{}", expiresAt: new Date(Date.now() + msFromNow) } });
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  for (let i = 0; i < 7; i++) await mkRow(`expired-${i}`, -60_000 - i);
  await mkRow("active-pending", 5 * 60_000);
  await mkRow("active-normal", 6 * 24 * 3600 * 1000);
  const keeper = new Browser(flow.base);
  await keeper.login("g-manager@example.org", PW);
  const deleted1 = await store.cleanupExpired(3, clk);
  t("cleanup: removes at most the batch size", deleted1 === 3);
  t("cleanup: remaining expired rows are left for the next sweep", (await prisma.session.count({ where: { id: { startsWith: "expired-" } } })) === 4);
  t("cleanup: active rows are untouched", (await prisma.session.count({ where: { id: { in: ["active-pending", "active-normal"] } } })) === 2);
  const deleted2 = await store.cleanupExpired(SESSION_CLEANUP_BATCH, clk);
  t("cleanup: drains the rest", deleted2 === 4 && (await prisma.session.count({ where: { id: { startsWith: "expired-" } } })) === 0);
  t("cleanup: a second sweep with nothing expired deletes nothing", (await store.cleanupExpired(SESSION_CLEANUP_BATCH, clk)) === 0);
  t("cleanup: an ordinary authenticated session survives and still works", (await keeper.get("/api/auth/me")).json?.user?.id === manager.id);
  // a row refreshed between read and delete is kept: emulate by a row that is already live
  await mkRow("expired-late", -1000);
  const orig = prisma.session.deleteMany.bind(prisma.session);
  (prisma.session as any).deleteMany = async (args: any) => {
    await prisma.session.update({ where: { id: "expired-late" }, data: { expiresAt: new Date(Date.now() + 3_600_000) } });
    return orig(args);
  };
  const racedDeleted = await store.cleanupExpired(SESSION_CLEANUP_BATCH, clk);
  (prisma.session as any).deleteMany = orig;
  t("cleanup: a session refreshed mid-sweep is not deleted", racedDeleted === 0 && (await prisma.session.count({ where: { id: "expired-late" } })) === 1);
  await prisma.session.deleteMany({ where: { id: { in: ["expired-late", "active-pending", "active-normal"] } } });

  // throttle: sweeps piggy-back on writes, at most one per interval
  await mkRow("expired-t1", -5000);
  await new Promise<void>((resolve) => store.set("throttle-a", { cookie: { originalMaxAge: 1000, expires: new Date(Date.now() + 60_000) } } as any, () => resolve()));
  t("throttle: the first write triggers a sweep", (await prisma.session.count({ where: { id: "expired-t1" } })) === 0);
  await mkRow("expired-t2", -5000);
  await new Promise<void>((resolve) => store.set("throttle-b", { cookie: { originalMaxAge: 1000, expires: new Date(Date.now() + 60_000) } } as any, () => resolve()));
  t("throttle: a write inside the interval does not sweep again", (await prisma.session.count({ where: { id: "expired-t2" } })) === 1);
  clk += SESSION_CLEANUP_INTERVAL_MS + 1;
  await new Promise<void>((resolve) => store.set("throttle-c", { cookie: { originalMaxAge: 1000, expires: new Date(Date.now() + 60_000) } } as any, () => resolve()));
  t("throttle: the next interval sweeps again", (await prisma.session.count({ where: { id: "expired-t2" } })) === 0);
  await prisma.session.deleteMany({ where: { id: { in: ["throttle-a", "throttle-b", "throttle-c"] } } });
  // a failing sweep must not fail the session write
  const failing = new PrismaSessionStore(prisma, () => clk + 10 * SESSION_CLEANUP_INTERVAL_MS);
  const origFind = prisma.session.findMany.bind(prisma.session);
  (prisma.session as any).findMany = async () => { throw new Error("boom"); };
  const setErr = await new Promise<unknown>((resolve) => failing.set("throttle-d", { cookie: { originalMaxAge: 1000, expires: new Date(Date.now() + 60_000) } } as any, (e) => resolve(e)));
  (prisma.session as any).findMany = origFind;
  t("throttle: a failing sweep does not fail the session write", setErr === undefined && (await prisma.session.count({ where: { id: "throttle-d" } })) === 1);
  await prisma.session.deleteMany({ where: { id: "throttle-d" } });
}

// ======================================================================================================================
// 7. Callback database / session-store failures (Tasks C, D: L2, L4)
// ======================================================================================================================
const protoSet = PrismaSessionStore.prototype.set;
const protoGet = PrismaSessionStore.prototype.get;
let failSetCalls = 0; // fail the Nth upcoming session write (1 = the very next)
PrismaSessionStore.prototype.set = function (sid: string, sess: any, cb?: (e?: unknown) => void) {
  if (failSetCalls > 0 && --failSetCalls === 0) return cb?.(new Error("session store down"));
  return protoSet.call(this, sid, sess, cb);
} as typeof protoSet;
let barrier: { need: number; waiting: (() => void)[] } | null = null;
PrismaSessionStore.prototype.get = function (sid: string, cb: (e: unknown, s?: any) => void) {
  return protoGet.call(this, sid, (err: unknown, sess: any) => {
    if (!barrier) return cb(err, sess);
    barrier.waiting.push(() => cb(err, sess));
    if (barrier.waiting.length >= barrier.need) {
      const w = barrier.waiting;
      barrier = null;
      w.forEach((f) => f());
    }
  });
} as typeof protoGet;
{
  logged.length = 0;
  // DB failure during identity lookup
  const b = new Browser(flow.base);
  const { url } = await signInStart(b);
  const q = approve(url, { sub: SUB_A, email: "member.google@gmail.com" });
  const realFind = prisma.oAuthIdentity.findUnique.bind(prisma.oAuthIdentity);
  (prisma.oAuthIdentity as any).findUnique = async () => { throw new Error(`SELECT ... ${SUB_A} ... code-secret`); };
  const cb = await b.get(`/api/auth/google/callback?${q}`);
  (prisma.oAuthIdentity as any).findUnique = realFind;
  t("db failure on lookup: redirects to the fixed failure path", cb.status === 302 && cb.location === "/login?google_error=failed");
  t("db failure on lookup: nobody is signed in", (await b.get("/api/auth/me")).json?.user === null);
  const retry = await b.get(`/api/auth/google/callback?${q}`);
  t("db failure on lookup: the transaction was still consumed", retry.location === "/login?google_error=failed");

  // DB failure during the link write
  const u = new Browser(flow.base);
  await u.login("g-member2@example.org", PW);
  const idsBefore = await prisma.oAuthIdentity.count();
  const realTx = prisma.$transaction.bind(prisma);
  (prisma as any).$transaction = async () => { throw new Error(`INSERT INTO OAuthIdentity ... ${SUB_C}`); };
  const lr = await link(u, { sub: SUB_C, email: "c@gmail.com" });
  (prisma as any).$transaction = realTx;
  t("db failure on link write: fixed failure redirect, never 'linked'", lr.cb.location === "/profile?google=failed");
  t("db failure on link write: nothing written", (await prisma.oAuthIdentity.count()) === idsBefore);

  // session store failure consuming/saving
  const s1 = new Browser(flow.base);
  failSetCalls = 1;
  const failedStart = await s1.get("/api/auth/google/start");
  failSetCalls = 0;
  t("session store failure at start: no redirect to Google", failedStart.location === "/login?google_error=failed");

  const realExec = prisma.$executeRaw.bind(prisma);
  const s2 = new Browser(flow.base);
  const st2 = await signInStart(s2);
  (prisma as any).$executeRaw = async () => { throw new Error("db down"); };
  const consumeFail = await s2.get(`/api/auth/google/callback?${approve(st2.url, { sub: SUB_A, email: "member.google@gmail.com" })}`);
  (prisma as any).$executeRaw = realExec;
  t("store failure while consuming: failed redirect, no exchange, not signed in", consumeFail.location === "/login?google_error=failed" && (await s2.get("/api/auth/me")).json?.user === null);

  // L4: the post-regeneration save fails -> not authenticated, not redirected to the signed-in destination
  const s3 = new Browser(flow.base);
  const st3 = await signInStart(s3);
  const q3 = approve(st3.url, { sub: SUB_A, email: "member.google@gmail.com" });
  failSetCalls = 1;
  const saveFail = await s3.get(`/api/auth/google/callback?${q3}`);
  failSetCalls = 0;
  t("sign-in session save failure: redirected to the failure path, never to /profile", saveFail.location === "/login?google_error=failed");
  t("sign-in session save failure: the browser is NOT authenticated", (await s3.get("/api/auth/me")).json?.user === null);
  // L4 positive: when the redirect is issued the session is already persisted (the very next request is authenticated)
  const s4 = new Browser(flow.base);
  const st4 = await signInStart(s4);
  const ok4 = await s4.get(`/api/auth/google/callback?${approve(st4.url, { sub: SUB_A, email: "member.google@gmail.com" })}`);
  const persisted = await rowFor(s4);
  t("sign-in: the authenticated session row exists before the redirect is used", ok4.location === "/profile" && !!persisted && JSON.parse(persisted.data).userId === member.id);

  // concurrency (L1): two simultaneous callbacks for ONE transaction -> exactly one wins, one exchange
  const cc = new Browser(flow.base);
  const stc = await signInStart(cc);
  const qc = approve(stc.url, { sub: SUB_A, email: "member.google@gmail.com" });
  const ex0 = tokenExchanges;
  barrier = { need: 2, waiting: [] };
  const [r1, r2] = await Promise.all([cc.get(`/api/auth/google/callback?${qc}`), new Browser(flow.base).req("GET", `/api/auth/google/callback?${qc}`, undefined, { Cookie: `scl.sid=${cc.sid}` })]);
  barrier = null;
  const results = [r1.location, r2.location].sort();
  t("concurrent callbacks: exactly one succeeds", results.join() === ["/login?google_error=failed", "/profile"].join(), results.join());
  t("concurrent callbacks: the authorization code was exchanged exactly once", tokenExchanges - ex0 === 1, String(tokenExchanges - ex0));

  // nothing sensitive reached the logs, and only fixed messages did
  const sensitive = [SUB_A, SUB_B, SUB_C, "code-", "eyJ", "secret", "SELECT", "INSERT", "Prisma"];
  t("logs: only fixed messages (no Prisma errors, SQL, subjects, codes or tokens)", logged.length > 0 && logged.every((m) => /^\[(google-auth|session)\] [a-z -]+$/.test(m)) && !logged.some((m) => sensitive.some((x) => m.includes(x))), JSON.stringify(logged.slice(0, 5)));
}
PrismaSessionStore.prototype.set = protoSet;
PrismaSessionStore.prototype.get = protoGet;

// ======================================================================================================================
// 7b. Link race: typed (SQLite) and untyped (Turso/libSQL) constraint errors (Phase 2.2.4)
// ======================================================================================================================
{
  const { Prisma: PrismaNS } = await import("@prisma/client");
  const driverFrame = (text: string) => `\nInvalid \`prisma.oAuthIdentity.create()\` invocation in /x.ts:1:1\n\n→ 1 await prisma.oAuthIdentity.create(\n${text}`;
  const known = (code: string, text: string) => new PrismaNS.PrismaClientKnownRequestError(driverFrame(text), { code, clientVersion: "5.22.0", meta: { modelName: "OAuthIdentity" } });
  const SUB_R1 = "100000000000000000601", SUB_R2 = "100000000000000000602", SUB_R3 = "100000000000000000603";
  const realTx = prisma.$transaction.bind(prisma);
  const raceUser = await mk("g-race@example.org", "MEMBER");
  const otherUser = await mk("g-race-other@example.org", "MEMBER");
  const b = new Browser(flow.base);
  await b.login("g-race@example.org", PW);
  const attempt = async (sub: string, thrown: unknown) => {
    const st = await b.post("/api/auth/google/link/start", LS);
    const q = approve(st.json.url, { sub, email: "race@gmail.com" });
    (prisma as any).$transaction = async () => { throw thrown; };
    try { return (await b.get(`/api/auth/google/callback?${q}`)).location; } finally { (prisma as any).$transaction = realTx; }
  };
  const before = await counts();
  // 1. typed P2002 with the winner's row committed by someone else -> in_use (existing behaviour, now decided by re-reading)
  await prisma.oAuthIdentity.create({ data: { userId: otherUser.id, provider: "google", subject: SUB_R1 } });
  t("race: typed P2002 + conflicting committed row -> in_use", (await attempt(SUB_R1, known("P2002", "Unique constraint failed on the fields: (`provider`,`subject`)"))) === "/profile?google=in_use");
  // 2. the observed Turso shape (untyped SQLITE_CONSTRAINT, UNIQUE driver text) -> the same intended conflict
  t("race: untyped SQLITE_CONSTRAINT (UNIQUE text) + conflicting row -> in_use", (await attempt(SUB_R1, known("SQLITE_CONSTRAINT", "UNIQUE constraint failed: OAuthIdentity.provider, OAuthIdentity.subject"))) === "/profile?google=in_use");
  // 3. unclassifiable constraint text but the re-read proves the conflict -> still in_use (no reliance on message text)
  t("race: untyped SQLITE_CONSTRAINT with unusable text + conflicting row -> in_use (decided by re-reading)", (await attempt(SUB_R1, known("SQLITE_CONSTRAINT", "something unexpected"))) === "/profile?google=in_use");
  t("race: a generic Error stays generic (failed) even when a conflicting row exists", (await attempt(SUB_R1, new Error("db down"))) === "/profile?google=failed");
  t("race: a connection-style Prisma error stays generic even when a conflicting row exists", (await attempt(SUB_R1, known("P1001", "cannot reach"))) === "/profile?google=failed");
  // 4. a foreign-key failure with NO conflicting row is never reported as a conflict
  t("race: untyped SQLITE_CONSTRAINT (FOREIGN KEY text), nothing conflicting -> failed, not in_use", (await attempt(SUB_R2, known("SQLITE_CONSTRAINT", "FOREIGN KEY constraint failed"))) === "/profile?google=failed");
  t("race: typed P2003, nothing conflicting -> failed", (await attempt(SUB_R2, known("P2003", "Foreign key constraint failed"))) === "/profile?google=failed");
  t("race: NOT NULL / unknown constraint, nothing conflicting -> failed", (await attempt(SUB_R2, known("SQLITE_CONSTRAINT", "NOT NULL constraint failed: OAuthIdentity.userId"))) === "/profile?google=failed");
  // 5. an explicit unique violation whose winner has since vanished still fails closed as the intended conflict
  t("race: explicit unique violation, winner no longer visible -> in_use (documented fallback)", (await attempt(SUB_R3, known("SQLITE_CONSTRAINT", "UNIQUE constraint failed: OAuthIdentity.provider, OAuthIdentity.subject"))) === "/profile?google=in_use");
  // 6. generic and non-constraint errors stay generic
  t("race: a generic Error -> failed", (await attempt(SUB_R2, new Error("db down"))) === "/profile?google=failed");
  t("race: a connection-style Prisma error (P1001) -> failed", (await attempt(SUB_R2, known("P1001", "cannot reach"))) === "/profile?google=failed");
  // 7. this account already linked to a DIFFERENT identity by the winner -> has_other
  await prisma.oAuthIdentity.create({ data: { userId: raceUser.id, provider: "google", subject: "100000000000000000609" } });
  // (link/start refuses an already-linked account up front, so begin the flow first, then link elsewhere)
  await prisma.oAuthIdentity.deleteMany({ where: { userId: raceUser.id } });
  const st2 = await b.post("/api/auth/google/link/start", LS);
  const q2 = approve(st2.json.url, { sub: SUB_R2, email: "race@gmail.com" });
  await prisma.oAuthIdentity.create({ data: { userId: raceUser.id, provider: "google", subject: "100000000000000000609" } });
  (prisma as any).$transaction = async () => { throw known("SQLITE_CONSTRAINT", "UNIQUE constraint failed: OAuthIdentity.userId, OAuthIdentity.provider"); };
  const hasOther = (await b.get(`/api/auth/google/callback?${q2}`)).location;
  (prisma as any).$transaction = realTx;
  t("race: untyped unique failure where the account was linked elsewhere meanwhile -> has_other", hasOther === "/profile?google=has_other");
  t("race: none of these failures wrote or changed anything beyond the setup rows", (await prisma.oAuthIdentity.count({ where: { subject: { in: [SUB_R2, SUB_R3] } } })) === 0 && (await prisma.oAuthIdentity.count({ where: { userId: raceUser.id } })) === 1 && (await counts()).users === before.users);
  await prisma.oAuthIdentity.deleteMany({ where: { userId: { in: [raceUser.id, otherUser.id] } } });
}

// ======================================================================================================================
// 8. Static scope / hygiene checks
// ======================================================================================================================
{
  const read = (p: string) => fs.readFileSync(path.join(SERVER_ROOT, p), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const routes = strip(read("src/routes/googleAuth.routes.ts"));
  const oauth = strip(read("src/lib/googleOAuth.ts"));
  const identity = strip(read("src/lib/googleIdentity.ts"));
  t("static: never creates or edits users", !/prisma\.user\.(create|update|upsert|delete)|db\.user\./.test(routes + oauth + identity));
  t("static: no email-based lookup of accounts", !/user\.(findUnique|findFirst|findMany)\(\{\s*where:\s*\{\s*email/.test(routes));
  t("static: never writes roles or password hashes", !/data:\s*\{[^}]*(role|passwordHash)/.test(routes + oauth));
  // The ONLY non-literal console call is the single label logger below. Its two interpolated values are `FlowPurpose | "unknown"` and
  // `CallbackStage`, closed unions of constants (plus the closed GoogleIdentityFailureReason), never request or token data.
  const LABEL_LOGGER = "console.error(`[google-auth] callback refused ${purpose} ${stage}`)";
  const consoleCalls = [...(routes + oauth + identity).matchAll(/console\.\w+\(([^)]*)\)/g)];
  t("static: no console logging of flow values", !/console\.(log|info|debug)/.test(routes + oauth + identity) && consoleCalls.every((m) => /^"[^"$]*"$/.test(m[1].trim()) || m[0] === LABEL_LOGGER));
  t("static: the label logger is the single exception and exists exactly once", consoleCalls.filter((m) => m[0] === LABEL_LOGGER).length === 1 && consoleCalls.filter((m) => !/^"[^"$]*"$/.test(m[1].trim())).length === 1);
  t("static: label logger arguments are typed closed unions", /function logRefusal\(purpose: FlowPurpose \| "unknown", stage: CallbackStage\)/.test(routes));
  t("static: redirects use only fixed destinations", [...routes.matchAll(/res\.redirect\(([^)]*)\)/g)].every((m) => /SIGNED_IN_PATH|\burl\b|\$\{(LOGIN_PATH|PROFILE_PATH)\}/.test(m[1])));
  t("static: no request value feeds a redirect", !/req\.(query|body|params)\.(next|redirect|returnTo|return_url|redirect_uri)/.test(routes));
  t("static: identity module still reads no environment", !/process\.env/.test(identity));
  const idx = read("src/routes/index.ts");
  t("static: google router mounted under /auth/google only", /router\.use\("\/auth\/google", googleAuthRoutes\)/.test(idx));
}

t("no network attempt left the loopback interface", offLoopback === 0);

flow.close();
plain.close();
await prisma.$disconnect();
fs.rmSync(workDir, { recursive: true, force: true });

console.log(`\n${ok} google-auth checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
process.exit(0);
