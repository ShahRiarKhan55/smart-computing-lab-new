/**
 * Regression check for Phase 26 §5 (session/cookie hardening review): the actual `Set-Cookie`
 * header the server sends on login, in both development and production configuration, plus
 * session-fixation resistance (a fresh session id is issued on every login, never reused from
 * before authentication). None of this was previously covered by an automated check — the
 * properties themselves (httpOnly, sameSite, a custom cookie name, production-only Secure,
 * `session.regenerate()` on login) already existed before this phase (see lib/session.ts,
 * routes/auth.routes.ts); this script is what proves them, not what changes them.
 *
 * Self-contained: copies apps/server/prisma/dev.db to a disposable temp file, spawns the real
 * server twice (development-equivalent, then production), inspects raw `Set-Cookie` header text.
 * Requires apps/server/prisma/dev.db to exist and be seeded (`npm run seed -w apps/server`).
 *
 *   node scripts/session-cookie-regression.mjs
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };

let ok = 0;
const failures = [];
const t = (name, cond, detail = "") => {
  if (cond) ok++;
  else failures.push(`${name}${detail ? ` -- ${detail}` : ""}`);
};

if (!existsSync(SOURCE_DB)) {
  console.error(`Missing ${SOURCE_DB} — run \`npm run seed -w apps/server\` first (see script header).`);
  process.exit(1);
}

const workDir = mkdtempSync(path.join(tmpdir(), "scl-session-cookie-regression-"));
const dbCopy = path.join(workDir, "copy.db");
copyFileSync(SOURCE_DB, dbCopy);
const DATABASE_URL = `file:${dbCopy}`;

function startServer(env) {
  const child = spawn(process.execPath, [path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs"), path.join(SERVER_ROOT, "src", "index.ts")], {
    cwd: SERVER_ROOT,
    // Test-environment safety: every call site below spreads `...process.env` for convenience,
    // which (if the invoking shell has TURSO_DATABASE_URL/TURSO_AUTH_TOKEN set — e.g. left over
    // from unrelated Turso work in the same terminal) would otherwise silently reconnect this
    // "local" test server to the REAL production Turso database instead of the disposable
    // DATABASE_URL copy this script just made. Cleared here, once, so no call site needs to
    // remember to do it.
    env: { ...env, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "" },
  });
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`Server did not start in time. Output so far:\n${out}`)), 15000);
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (/listening on/.test(out)) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on("data", (d) => { out += d.toString(); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early (code ${code}). Output:\n${out}`));
    });
  });
}

/** Minimal cookie-jar-of-one client, mirroring api-regression.mjs's Client but exposing the raw
 * Set-Cookie header text (fetch's Headers API only ever exposes a folded/joined value here, which
 * is fine — we only ever expect exactly one Set-Cookie per response in this script). */
class Client {
  constructor(base, extraHeaders = {}) {
    this.base = base;
    this.cookie = "";
    this.extraHeaders = extraHeaders;
  }
  async post(path, body) {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.extraHeaders, ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie") || "";
    const match = /scl\.sid=[^;]+/.exec(setCookie);
    if (match) this.cookie = match[0];
    return { status: res.status, setCookie };
  }
}

async function main() {
  // ---- development-equivalent configuration: HttpOnly + SameSite=Lax + custom name, NOT Secure --
  {
    const port = 46100 + Math.floor(Math.random() * 200);
    const server = await startServer({ ...process.env, NODE_ENV: "development", TRUST_PROXY: "0", PORT: String(port), DATABASE_URL, SESSION_SECRET: "dev-cookie-regression-secret" });
    try {
      const client = new Client(`http://localhost:${port}`);
      const { status, setCookie } = await client.post("/api/auth/login", ADMIN);
      t("login succeeds (200) against the disposable dev DB copy", status === 200, setCookie);
      t("Set-Cookie uses the app's own cookie name, not the express-session default", setCookie.includes("scl.sid="));
      t("Set-Cookie sets HttpOnly", /HttpOnly/i.test(setCookie));
      t("Set-Cookie sets SameSite=Lax", /SameSite=Lax/i.test(setCookie));
      t("Set-Cookie sets Path=/", /Path=\//i.test(setCookie));
      t("Set-Cookie does NOT set Secure in development (would break local plain-HTTP dev)", !/;\s*Secure/i.test(setCookie));
      const expiresMatch = /Expires=([^;]+)/i.exec(setCookie);
      const expiresMs = expiresMatch ? new Date(expiresMatch[1]).getTime() - Date.now() : NaN;
      t("Set-Cookie sets a ~1-week expiry (604800s, allowing for test run time)", Math.abs(expiresMs - 604800_000) < 60_000, expiresMatch?.[1]);

      // ---- session fixation resistance: a fresh sid is issued on every login ----------------------
      const firstSid = /scl\.sid=([^;]+)/.exec(setCookie)?.[1];
      await client.post("/api/auth/logout", {});
      const second = await client.post("/api/auth/login", ADMIN);
      const secondSid = /scl\.sid=([^;]+)/.exec(second.setCookie)?.[1];
      t("a second login issues a DIFFERENT session id than the first (fixation resistance)", Boolean(firstSid) && Boolean(secondSid) && firstSid !== secondSid, `${firstSid} vs ${secondSid}`);
    } finally {
      server.kill();
    }
  }

  // ---- production configuration, behind the one documented trusted-proxy topology ----------------
  // A real reverse proxy that terminates TLS both (a) counts as the one trusted hop (TRUST_PROXY=1)
  // AND (b) sets X-Forwarded-Proto: https on every request it forwards. Both are required: express-
  // session's `cookie.secure: true` refuses to ever send Set-Cookie at all — not "sends it without
  // Secure", NO cookie, silently — unless it can positively confirm the request is secure (see
  // node_modules/express-session's `issecure()`, which in turn depends on Express's own `req.secure`,
  // which in turn depends on `trust proxy` believing X-Forwarded-Proto). A misconfigured proxy that
  // forgets X-Forwarded-Proto is a genuine, previously-undocumented deployment trap this check exists
  // to catch: login would appear to succeed (200 + user JSON) while authentication silently never
  // actually persists (documented in docs/architecture/phase26-…).
  {
    const port = 46300 + Math.floor(Math.random() * 200);
    const server = await startServer({
      ...process.env,
      NODE_ENV: "production",
      TRUST_PROXY: "1",
      PORT: String(port),
      DATABASE_URL,
      SESSION_SECRET: "a-sufficiently-long-test-only-session-secret-222222",
    });
    try {
      const behindProxy = new Client(`http://localhost:${port}`, { "X-Forwarded-Proto": "https" });
      const { status, setCookie } = await behindProxy.post("/api/auth/login", ADMIN);
      t("login succeeds (200) in production configuration too", status === 200, setCookie);
      t("Set-Cookie is actually sent when the trusted proxy claims HTTPS", setCookie.length > 0);
      t("Set-Cookie sets Secure in production behind the trusted proxy", /;\s*Secure/i.test(setCookie));
      t("Set-Cookie still sets HttpOnly in production", /HttpOnly/i.test(setCookie));
      t("Set-Cookie still sets SameSite=Lax in production", /SameSite=Lax/i.test(setCookie));

      // The deployment trap itself: the SAME production server, without the proxy's
      // X-Forwarded-Proto claim (e.g. a misconfigured proxy, or a direct request bypassing it
      // entirely), never sets a session cookie at all — login looks successful but no session
      // is ever established. This is express-session's own safe-by-default behavior, not a bug
      // introduced here; asserting it is what makes the deployment checklist's warning provable.
      const direct = new Client(`http://localhost:${port}`);
      const directResult = await direct.post("/api/auth/login", ADMIN);
      t(
        "without X-Forwarded-Proto, the same production server sends NO session cookie at all (the documented deployment trap)",
        directResult.setCookie === "",
        directResult.setCookie,
      );
    } finally {
      server.kill();
    }
  }

  console.log(`\n${ok} session-cookie checks passed, ${failures.length} failed.`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
  rmSync(workDir, { recursive: true, force: true });
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  rmSync(workDir, { recursive: true, force: true });
  process.exit(1);
});
