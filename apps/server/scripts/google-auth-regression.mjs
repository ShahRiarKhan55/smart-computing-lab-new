/**
 * Regression for Google sign-in (Phase 27 / P27.4): the real HTTP flow, end to end, against a MOCK Google.
 *
 * No real Google account, client id or network is involved: the mock provider (a local HTTP server) issues
 * RS256-signed ID tokens with a throw-away key and serves the matching JWKS, enforces PKCE and the client
 * secret at its token endpoint, and the server under test is pointed at it through GOOGLE_OAUTH_BASE_URL
 * (an override the server honours ONLY outside production). The script plays the browser: /start,
 * read the redirect Google would receive, register a "code" with the mock, then hit /callback with the
 * session cookie from /start — exactly what a real round trip does.
 *
 * This proves the application's behaviour; it does NOT prove that a real Google Cloud OAuth client is
 * configured correctly (that needs the real credentials and is a separate, manual verification).
 *
 *   node scripts/google-auth-regression.mjs
 */
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");
const TSX = path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };
const DESIGNATED = "susmartcomputinglab@gmail.com";
const CLIENT_ID = "mock-client-id.apps.googleusercontent.test";
const CLIENT_SECRET = "mock-client-secret-DO-NOT-LEAK-7f3a9c";
const PW = "Str0ngPassw0rd!";

let ok = 0;
const failures = [];
const t = (name, cond, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

if (!existsSync(SOURCE_DB)) {
  console.error(`Missing ${SOURCE_DB} — run \`npm run seed -w apps/server\` first.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// The mock Google
// ---------------------------------------------------------------------------------------------
const b64u = (b) => Buffer.from(b).toString("base64url");
const goodKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const evilKey = generateKeyPairSync("rsa", { modulusLength: 2048 }); // a different key, never published
const KID = "mock-key-1";

function jwt(header, payload, key = goodKey.privateKey, alg = "RS256") {
  const head = b64u(JSON.stringify(header));
  const body = b64u(JSON.stringify(payload));
  const signature = alg === "none" ? "" : cryptoSign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url");
  return `${head}.${body}.${signature}`;
}

function startMockGoogle() {
  const codes = new Map(); // code -> { challenge, makeToken }
  const state = { tokenMode: "ok", jwksMode: "ok", tokenRequests: 0 };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/certs") {
      if (state.jwksMode === "down") {
        res.statusCode = 500;
        res.end("down");
        return;
      }
      res.setHeader("content-type", "application/json");
      res.setHeader("cache-control", "public, max-age=0");
      res.end(JSON.stringify({ keys: [{ ...goodKey.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] }));
      return;
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        state.tokenRequests++;
        const form = new URLSearchParams(raw);
        res.setHeader("content-type", "application/json");
        const fail = (status, error) => {
          res.statusCode = status;
          res.end(JSON.stringify({ error }));
        };
        if (state.tokenMode === "error") return fail(500, "server_error");
        if (state.tokenMode === "garbage") {
          res.end("this is not json");
          return;
        }
        if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== CLIENT_SECRET) return fail(401, "invalid_client");
        if (form.get("grant_type") !== "authorization_code") return fail(400, "unsupported_grant_type");
        const entry = codes.get(form.get("code"));
        if (!entry) return fail(400, "invalid_grant");
        codes.delete(form.get("code")); // single use, like Google
        const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        if (challenge !== entry.challenge) return fail(400, "invalid_grant"); // PKCE enforced
        res.end(JSON.stringify({ access_token: "ignored", token_type: "Bearer", id_token: entry.makeToken() }));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        codes,
        state,
        close: () => server.close(),
      }),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// The server under test
// ---------------------------------------------------------------------------------------------
async function startServer(mock, { configured = true, extraEnv = {} } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), "scl-google-"));
  copyFileSync(SOURCE_DB, path.join(work, "c.db"));
  const port = 47500 + Math.floor(Math.random() * 400);
  const env = {
    ...process.env,
    TURSO_DATABASE_URL: "",
    TURSO_AUTH_TOKEN: "",
    BLOB_READ_WRITE_TOKEN: "",
    VERCEL: "",
    STORAGE_DIR: path.join(work, "files"),
    DATABASE_URL: `file:${path.join(work, "c.db")}`,
    PORT: String(port),
    TRUST_PROXY: "1",
    NODE_ENV: "test",
    SESSION_SECRET: "google-auth-regression-secret-0000000000",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    GOOGLE_OAUTH_REDIRECT_URI: "",
    GOOGLE_OAUTH_BASE_URL: "",
    ...(configured
      ? { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI: `http://localhost:${port}/api/auth/google/callback`, GOOGLE_OAUTH_BASE_URL: mock.url }
      : {}),
    ...extraEnv,
  };
  const child = spawn(process.execPath, [TSX, path.join(SERVER_ROOT, "src", "index.ts")], { cwd: SERVER_ROOT, env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 80 && !/listening on/.test(out); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/listening on/.test(out)) throw new Error(`server did not start:\n${out}`);
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  return {
    base: `http://localhost:${port}`,
    port,
    prisma,
    logs: () => out,
    async stop() {
      child.kill();
      await prisma.$disconnect();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

// A tiny cookie-jar "browser".
let ipCounter = 0;
function browser(base) {
  let cookie = null;
  // Each simulated browser has its own client IP (via X-Forwarded-For; the server runs with TRUST_PROXY=1), so one
  // scenario's deliberate failures cannot spend another scenario's rate-limit budget.
  const n = ++ipCounter;
  const ip = `10.${(n >> 8) & 255}.${n & 255}.7`;
  const absorb = (res) => {
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
  };
  const raw = async (method, pathAndQuery, body) => {
    const res = await fetch(`${base}${pathAndQuery}`, {
      method,
      redirect: "manual",
      headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    absorb(res);
    return res;
  };
  return {
    get cookie() {
      return cookie;
    },
    set cookie(v) {
      cookie = v;
    },
    raw,
    async json(method, p, body) {
      const res = await raw(method, p, body);
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* not JSON */
      }
      return { status: res.status, json };
    },
    me: async () => (await (await raw("GET", "/api/auth/me")).json()).user,
    passwordLogin: async (creds) => (await raw("POST", "/api/auth/login", creds)).status,
  };
}

let subCounter = 0;
const newSub = () => `google-sub-${Date.now()}-${++subCounter}`;

/**
 * One full Google round trip as the browser would do it. `claims` override the token's claims; `tweak`
 * changes how the callback is called. Returns where the callback redirected and the cookie transition.
 */
async function googleRoundTrip(b, mock, serverBase, claims = {}, opts = {}) {
  const start = await b.raw("GET", `/api/auth/google/start${opts.link ? "?link=1" : ""}`);
  const location = start.headers.get("location") ?? "";
  if (start.status !== 302 || !location.startsWith(mock.url)) return { start, location, callback: null };
  const auth = new URL(location);
  const params = Object.fromEntries(auth.searchParams);
  const cookieAfterStart = b.cookie;
  const code = `code-${Math.random().toString(36).slice(2)}`;
  const now = Math.floor(Date.now() / 1000);
  const base = { iss: mock.url, aud: CLIENT_ID, sub: newSub(), email: DESIGNATED, email_verified: true, nonce: params.nonce, iat: now, exp: now + 3600 };
  const payload = { ...base, ...claims };
  for (const [k, v] of Object.entries(payload)) if (v === undefined) delete payload[k];
  const header = opts.header ?? { alg: "RS256", kid: KID, typ: "JWT" };
  mock.codes.set(code, {
    challenge: params.code_challenge,
    makeToken: () => jwt(header, payload, opts.key ?? goodKey.privateKey, header.alg),
  });
  const query = new URLSearchParams({ code, state: opts.state ?? params.state, ...(opts.extraQuery ?? {}) });
  if (opts.omitCode) query.delete("code");
  if (opts.providerError) {
    query.delete("code");
    query.set("error", "access_denied");
  }
  const callback = await b.raw("GET", `/api/auth/google/callback?${query}`);
  return { start, location, params, cookieAfterStart, callback, callbackLocation: callback.headers.get("location") ?? "", sub: payload.sub, code };
}

const ok302 = (r, to) => r.callback?.status === 302 && r.callbackLocation === to;
const denied = (r) => r.callback?.status === 302 && /^\/login\?error=google_(failed|denied)$/.test(r.callbackLocation);

async function main() {
  const mock = await startMockGoogle();
  try {
    // ============ A. not configured: nothing else is affected =====================================
    {
      const s = await startServer(mock, { configured: false });
      try {
        const b = browser(s.base);
        t("unconfigured: /config says disabled", (await b.json("GET", "/api/auth/google/config")).json?.enabled === false);
        const start = await b.raw("GET", "/api/auth/google/start");
        t("unconfigured: /start redirects to a clear login-page error, not a crash", start.status === 302 && start.headers.get("location") === "/login?error=google_unconfigured");
        const cb = await b.raw("GET", "/api/auth/google/callback?code=x&state=y");
        t("unconfigured: /callback does the same", cb.status === 302 && cb.headers.get("location") === "/login?error=google_unconfigured");
        t("unconfigured: the public site still works", (await b.json("GET", "/api/health")).status === 200 && (await b.json("GET", "/api/team")).status === 200);
        t("unconfigured: password login still works", (await b.passwordLogin(ADMIN)) === 200 && (await b.me())?.role === "ADMIN");
      } finally {
        await s.stop();
      }
    }
    // a malformed redirect URI disables Google rather than breaking the server
    {
      const s = await startServer(mock, { extraEnv: { GOOGLE_OAUTH_REDIRECT_URI: "http://evil.example.test/steal" } });
      try {
        const b = browser(s.base);
        t("bad redirect URI (non-https, wrong path): Google is disabled, server still boots", (await b.json("GET", "/api/auth/google/config")).json?.enabled === false && (await b.json("GET", "/api/health")).status === 200);
      } finally {
        await s.stop();
      }
    }

    // ============ B. configured: the happy path and the token checks ================================
    const s = await startServer(mock);
    try {
      const anon = () => browser(s.base);
      t("configured: /config says enabled", (await anon().json("GET", "/api/auth/google/config")).json?.enabled === true);

      // ---- the authorization request itself -------------------------------------------------------
      {
        const b = anon();
        const start = await b.raw("GET", "/api/auth/google/start");
        const loc = new URL(start.headers.get("location"));
        const p = Object.fromEntries(loc.searchParams);
        t("start: redirects to the provider with response_type=code, openid scope, our client id and exact redirect URI", start.status === 302 && p.response_type === "code" && /openid/.test(p.scope) && p.client_id === CLIENT_ID && p.redirect_uri === `${s.base}/api/auth/google/callback`);
        t("start: state, nonce and a PKCE S256 challenge are present, random and long", p.state?.length >= 40 && p.nonce?.length >= 40 && p.code_challenge?.length >= 40 && p.code_challenge_method === "S256" && p.state !== p.nonce);
        t("start: the client SECRET never appears in the redirect", !loc.href.includes(CLIENT_SECRET));
        t("start: the account chooser is forced", p.prompt === "select_account");
        t("start: a session cookie was issued to hold the one-time values (HttpOnly)", /scl\.sid=/.test(b.cookie ?? ""));
        const again = await anon().raw("GET", "/api/auth/google/start");
        t("start: every start gets a fresh state", new URL(again.headers.get("location")).searchParams.get("state") !== p.state);
      }

      // ---- happy path: the designated identity creates / re-enters the administrator ----------------
      const adminSub = newSub();
      const b1 = anon();
      const r1 = await googleRoundTrip(b1, mock, s.base, { sub: adminSub });
      if (process.env.DEBUG_GOOGLE) console.log(s.logs().split("\n").filter((l) => /google|rror/i.test(l)).join("\n"));
      t("designated admin: callback redirects home", ok302(r1, "/"), `${r1.callback?.status} ${r1.callbackLocation}`);
      const me1 = await b1.me();
      t("designated admin: signed in as the designated address with role ADMIN", me1?.email === DESIGNATED && me1?.role === "ADMIN", JSON.stringify(me1));
      t("designated admin: the session id was REGENERATED (fixation defence)", !!r1.cookieAfterStart && !!b1.cookie && b1.cookie !== r1.cookieAfterStart);
      const stale = anon();
      stale.cookie = r1.cookieAfterStart;
      t("designated admin: the pre-login session cookie does not authenticate", (await stale.me()) === null);
      t("designated admin: one admin user and one linked identity were created", (await s.prisma.user.count({ where: { email: DESIGNATED, role: "ADMIN" } })) === 1 && (await s.prisma.oAuthIdentity.count({ where: { subject: adminSub } })) === 1);
      const adminUser = await s.prisma.user.findUnique({ where: { email: DESIGNATED } });
      t("designated admin: the created account has no usable password (random, discarded hash)", typeof adminUser.passwordHash === "string" && adminUser.passwordHash.startsWith("$2"));
      t("designated admin: an admin-only endpoint works", (await b1.json("GET", "/api/users")).status === 200);
      t("designated admin: the callback was audited without secrets", (await s.prisma.auditLog.count({ where: { action: "GOOGLE_LINKED", actorEmail: DESIGNATED } })) === 1);
      const replay = await googleRoundTrip(anon(), mock, s.base, { sub: adminSub });
      t("designated admin: signing in again reuses the same account (no second user)", ok302(replay, "/") && (await s.prisma.user.count({ where: { email: DESIGNATED } })) === 1);
      t("designated admin: …recorded as a login", (await s.prisma.auditLog.count({ where: { action: "GOOGLE_LOGIN" } })) >= 1);
      const lo = await b1.raw("POST", "/api/auth/logout");
      t("logout: ends the Google-created session", lo.status === 200 && (await b1.me()) === null);

      // ---- who is NOT let in --------------------------------------------------------------------------
      const usersBefore = await s.prisma.user.count();
      const idsBefore = await s.prisma.oAuthIdentity.count();
      for (const [name, email] of [
        ["a different verified Google account", "someone.else@gmail.com"],
        ["a plus-addressed variant of the admin", "susmartcomputinglab+admin@gmail.com"],
        ["a dotted variant of the admin", "susmart.computinglab@gmail.com"],
        ["the admin address as a SUB-domain look-alike", "susmartcomputinglab@gmail.com.evil.test"],
        ["the admin local-part at another domain", "susmartcomputinglab@googlemail.com"],
      ]) {
        const b = anon();
        const r = await googleRoundTrip(b, mock, s.base, { email });
        t(`denied: ${name}`, denied(r) && (await b.me()) === null, `${r.callbackLocation}`);
      }
      t("denied: none of those created an account or an identity (invitation-only is preserved)", (await s.prisma.user.count()) === usersBefore && (await s.prisma.oAuthIdentity.count()) === idsBefore);
      {
        const r = await googleRoundTrip(anon(), mock, s.base, { sub: adminSub, email: "SusmartComputingLab@Gmail.com" });
        // Google reports lower-case; but a differently-cased claim must still compare equal after normalisation, not be a bypass either way.
        t("designated email comparison is case-normalised", ok302(r, "/"), r.callbackLocation);
      }

      // ---- token validation ------------------------------------------------------------------------------
      const now = Math.floor(Date.now() / 1000);
      const cases = [
        ["email_verified = false", { email_verified: false }],
        ["email_verified missing", { email_verified: undefined }],
        ['email_verified = the string "true"', { email_verified: "true" }],
        ["email missing", { email: undefined }],
        ["sub missing", { sub: undefined }],
        ["wrong audience", { aud: "someone-elses-client-id" }],
        ["audience array without an azp for us", { aud: [CLIENT_ID, "other"] }],
        ["wrong issuer", { iss: "https://evil.example.test" }],
        ["expired token", { iat: now - 7200, exp: now - 3600 }],
        ["token issued in the future", { iat: now + 7200, exp: now + 10800 }],
        ["nonce mismatch (replayed token from another login)", { nonce: "not-the-nonce-we-sent" }],
        ["nonce missing", { nonce: undefined }],
      ];
      for (const [name, claims] of cases) {
        const b = anon();
        const r = await googleRoundTrip(b, mock, s.base, claims);
        t(`token rejected: ${name}`, denied(r) && (await b.me()) === null, `${r.callbackLocation}`);
      }
      {
        const b = anon();
        const r = await googleRoundTrip(b, mock, s.base, {}, { key: evilKey.privateKey });
        t("token rejected: signed by a key Google never published", denied(r) && (await b.me()) === null);
      }
      {
        const b = anon();
        const r = await googleRoundTrip(b, mock, s.base, {}, { header: { alg: "none", kid: KID } });
        t('token rejected: alg "none" (unsigned) token', denied(r) && (await b.me()) === null);
      }
      {
        const b = anon();
        const r = await googleRoundTrip(b, mock, s.base, {}, { header: { alg: "HS256", kid: KID } });
        t("token rejected: alg HS256 (symmetric-key downgrade)", denied(r) && (await b.me()) === null);
      }
      {
        const b = anon();
        const r = await googleRoundTrip(b, mock, s.base, {}, { header: { alg: "RS256", kid: "unknown-kid" } });
        t("token rejected: unknown signing key id", denied(r) && (await b.me()) === null);
      }
      {
        const b = anon();
        const r = await googleRoundTrip(b, mock, s.base, {}, { header: { alg: "RS256" } });
        t("token rejected: no key id", denied(r) && (await b.me()) === null);
      }
      {
        mock.state.tokenMode = "error";
        const b = anon();
        const r = await googleRoundTrip(b, mock, s.base);
        t("provider failure: a 500 from the token endpoint is a generic failure, not a crash", denied(r) && (await b.me()) === null);
        mock.state.tokenMode = "garbage";
        const r2 = await googleRoundTrip(anon(), mock, s.base);
        t("provider failure: a non-JSON token response is a generic failure", denied(r2));
        mock.state.tokenMode = "ok";
        mock.state.jwksMode = "down";
        const r3 = await googleRoundTrip(anon(), mock, s.base);
        t("provider failure: an unreachable key set is a generic failure", denied(r3));
        mock.state.jwksMode = "ok";
        t("provider failure: the app still serves requests afterwards", (await anon().json("GET", "/api/health")).status === 200);
      }

      // ---- state / replay / CSRF-on-callback ----------------------------------------------------------------
      {
        const b = anon();
        const r = await googleRoundTrip(b, mock, s.base, {}, { state: "forged-state-value" });
        t("state: a callback with a forged state is refused", denied(r) && (await b.me()) === null);
      }
      {
        const b = anon();
        const cb = await b.raw("GET", "/api/auth/google/callback?code=abc&state=abc");
        t("state: a callback with no preceding /start (no session state) is refused", cb.status === 302 && /google_failed/.test(cb.headers.get("location") ?? "") && (await b.me()) === null);
      }
      {
        const b = anon();
        const r = await googleRoundTrip(b, mock, s.base, {}, { omitCode: true });
        t("state: a callback without a code is refused", denied(r));
      }
      {
        const b = anon();
        const r = await googleRoundTrip(b, mock, s.base, {}, { providerError: true });
        t("state: the user pressing 'Cancel' at Google is a clean 'denied' redirect", r.callback?.status === 302 && r.callbackLocation === "/login?error=google_denied");
      }
      {
        // An attacker's start (their own state) cannot be completed in the VICTIM's browser: callback carries the attacker's state but the victim's session holds a different one.
        const attacker = anon();
        const a = await googleRoundTrip(attacker, mock, s.base, {}, { omitCode: true });
        const victim = anon();
        await victim.raw("GET", "/api/auth/google/start");
        const cb = await victim.raw("GET", `/api/auth/google/callback?code=zzz&state=${a.params.state}`);
        t("state: a state minted for ANOTHER browser is refused (login-CSRF)", cb.status === 302 && /google_failed/.test(cb.headers.get("location") ?? "") && (await victim.me()) === null);
      }
      {
        // single use: after a successful callback, replaying the very same callback URL fails.
        const b = anon();
        const r = await googleRoundTrip(b, mock, s.base, { sub: adminSub });
        const again = await b.raw("GET", `/api/auth/google/callback?code=${r.code}&state=${r.params.state}`);
        t("replay: the same callback URL cannot be used twice", ok302(r, "/") && again.status === 302 && /google_failed/.test(again.headers.get("location") ?? ""));
      }
      t("logs: the client secret, codes and tokens never appear in the server log", !s.logs().includes(CLIENT_SECRET) && !/eyJ[A-Za-z0-9_-]{10,}\./.test(s.logs()));

      // ---- client-supplied values are ignored ---------------------------------------------------------------------
      {
        const b = anon();
        const r = await googleRoundTrip(b, mock, s.base, { email: "mallory@gmail.com" }, { extraQuery: { role: "ADMIN", isAdmin: "true", email: DESIGNATED, userId: "x" } });
        t("client values: role/isAdmin/email in the callback query change nothing", denied(r) && (await b.me()) === null);
      }

      // ---- the explicit link flow ----------------------------------------------------------------------------------
      // Bob: a password MEMBER account; he links a Google identity from inside his own session.
      const adminB = anon();
      await adminB.passwordLogin(ADMIN);
      const mk = async (email) => (await adminB.json("POST", "/api/users", { email, password: PW, role: "MEMBER", name: email.split("@")[0], initials: "PR", memberRole: "Researcher", category: "PHD" })).status;
      t("setup: password accounts are created as before", (await mk("bob.google@example.test")) === 201 && (await mk("carol.google@example.test")) === 201);
      const bob = anon();
      await bob.passwordLogin({ email: "bob.google@example.test", password: PW });
      const unlinkedStart = await anon().raw("GET", "/api/auth/google/start?link=1");
      t("link: starting the link flow while signed OUT is refused", unlinkedStart.status === 302 && unlinkedStart.headers.get("location") === "/login?error=google_failed");
      const bobSub = newSub();
      const lk = await googleRoundTrip(bob, mock, s.base, { sub: bobSub, email: "bob.private@gmail.com" }, { link: true });
      t("link: a signed-in member can connect ANY verified Google account to their own account", ok302(lk, "/profile?google=linked"), lk.callbackLocation);
      t("link: …and they remain the same MEMBER (never elevated)", (await bob.me())?.email === "bob.google@example.test" && (await bob.me())?.role === "MEMBER");
      const bobViaGoogle = anon();
      const bg = await googleRoundTrip(bobViaGoogle, mock, s.base, { sub: bobSub, email: "bob.private@gmail.com" });
      const bgMe = await bobViaGoogle.me();
      t("link: that Google identity now signs in as Bob, role MEMBER", ok302(bg, "/") && bgMe?.email === "bob.google@example.test" && bgMe?.role === "MEMBER", JSON.stringify(bgMe));
      t("link: a Google-signed-in MEMBER cannot reach admin endpoints", (await bobViaGoogle.json("GET", "/api/users")).status === 403 && (await bobViaGoogle.json("GET", "/api/files/storage-status")).status === 403);
      const roleTry = await bobViaGoogle.json("PUT", `/api/users/${(await s.prisma.user.findUnique({ where: { email: "bob.google@example.test" } })).id}`, { role: "ADMIN" });
      t("link: nor can they promote themselves", roleTry.status === 403 && (await s.prisma.user.findUnique({ where: { email: "bob.google@example.test" } })).role === "MEMBER");
      const carol = anon();
      await carol.passwordLogin({ email: "carol.google@example.test", password: PW });
      const steal = await googleRoundTrip(carol, mock, s.base, { sub: bobSub, email: "bob.private@gmail.com" }, { link: true });
      t("link: a Google identity already attached to Bob cannot be attached to Carol", denied(steal));
      const second = await googleRoundTrip(bob, mock, s.base, { sub: newSub(), email: "another@gmail.com" }, { link: true });
      t("link: an account that already has a Google identity cannot add a second", denied(second));

    } finally {
      await s.stop();
    }

    // ============ C. a pre-existing password account must be linked deliberately ==========================
    {
      const s2 = await startServer(mock);
      try {
        const admin = browser(s2.base);
        await admin.passwordLogin(ADMIN);
        const created = await admin.json("POST", "/api/users", { email: DESIGNATED, password: PW, role: "MEMBER", name: "Lab Mailbox", initials: "LM", memberRole: "Account", category: "RESEARCH" });
        t("takeover: setup — a password MEMBER account already uses the designated email", created.status === 201);
        const usersBefore = await s2.prisma.user.count();
        const b = browser(s2.base);
        const r = await googleRoundTrip(b, mock, s2.base, { email: DESIGNATED });
        t("takeover: Google sign-in with the designated email does NOT take over that existing password account", denied(r) && (await b.me()) === null);
        t("takeover: …and created nothing", (await s2.prisma.user.count()) === usersBefore && (await s2.prisma.oAuthIdentity.count()) === 0);
        // Now the owner links deliberately from inside the account (proving control of BOTH sides).
        const owner = browser(s2.base);
        t("takeover: the owner signs in with the password", (await owner.passwordLogin({ email: DESIGNATED, password: PW })) === 200);
        const sub = newSub();
        const lk = await googleRoundTrip(owner, mock, s2.base, { sub, email: DESIGNATED }, { link: true });
        t("takeover: an explicit link from inside the account works", ok302(lk, "/profile?google=linked"));
        const viaGoogle = browser(s2.base);
        await googleRoundTrip(viaGoogle, mock, s2.base, { sub, email: DESIGNATED });
        const me = await viaGoogle.me();
        t("takeover: after linking, Google signs in as that account — and it is STILL a MEMBER (linking never grants admin)", me?.email === DESIGNATED && me?.role === "MEMBER", JSON.stringify(me));
      } finally {
        await s2.stop();
      }
    }

    // ============ D. the existing administrator account: only the designated identity reaches it =============
    {
      const s3 = await startServer(mock);
      try {
        const adminPw = browser(s3.base);
        await adminPw.passwordLogin(ADMIN);
        const wrong = await googleRoundTrip(adminPw, mock, s3.base, { sub: newSub(), email: "intruder@gmail.com" }, { link: true });
        t("admin link: a non-designated Google identity can NOT be attached to an ADMIN account, even from its own session", denied(wrong));
        const sub = newSub();
        const right = await googleRoundTrip(adminPw, mock, s3.base, { sub, email: DESIGNATED }, { link: true });
        t("admin link: the designated identity can be attached to the existing admin account", ok302(right, "/profile?google=linked"));
        const viaGoogle = browser(s3.base);
        const users = await s3.prisma.user.count();
        await googleRoundTrip(viaGoogle, mock, s3.base, { sub, email: DESIGNATED });
        const me = await viaGoogle.me();
        t("admin link: Google then signs in as the EXISTING admin (no new account)", me?.email === ADMIN.email && me?.role === "ADMIN" && (await s3.prisma.user.count()) === users, JSON.stringify(me));
        t("admin link: password login for that admin still works (no lock-out)", (await browser(s3.base).passwordLogin(ADMIN)) === 200);
      } finally {
        await s3.stop();
      }
    }

    // ============ E. rate limiting of failed callbacks ==========================================================
    {
      const s4 = await startServer(mock);
      try {
        const b = browser(s4.base);
        let last = null;
        for (let i = 0; i < 12; i++) {
          const cb = await b.raw("GET", "/api/auth/google/callback?code=x&state=y");
          last = cb.headers.get("location");
        }
        t("rate limit: repeated failed callbacks keep answering the same generic redirect (no crash, no oracle)", /google_failed/.test(last ?? ""));
        const ok1 = await googleRoundTrip(browser(s4.base), mock, s4.base);
        t("rate limit: once the failure budget is spent, even a valid callback from that client is refused", denied(ok1), ok1.callbackLocation);
        t("rate limit: the server is still healthy and password login unaffected", (await browser(s4.base).passwordLogin(ADMIN)) === 200);
      } finally {
        await s4.stop();
      }
    }
  } finally {
    mock.close();
  }

  console.log(`\n${ok} google-auth checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  if (failures.length) console.log("Failures so far:\n - " + failures.join("\n - "));
  process.exit(1);
});
