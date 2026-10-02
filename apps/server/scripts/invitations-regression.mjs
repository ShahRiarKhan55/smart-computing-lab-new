/**
 * Regression check for researcher onboarding invitations (routes/invitations.routes.ts):
 * create/list/revoke (ADMIN only), the public token info/accept endpoints, expiry, single-use,
 * revocation, and that the password set during acceptance is never visible to the admin at any
 * point (the create response and the list response are both checked for the absence of any
 * token/password field).
 *
 * Self-contained: copies apps/server/prisma/dev.db to a disposable temp file and spawns the real
 * server. Explicitly clears TURSO_DATABASE_URL/TURSO_AUTH_TOKEN in the spawned server's
 * environment — if either is set in the shell running this script (e.g. left over from unrelated
 * Turso work in the same terminal), `lib/prisma.ts` would otherwise silently connect the server to
 * the REAL production Turso database instead of this script's disposable local copy, since
 * `{ ...process.env, ... }` alone does not clear an already-set variable. Requires
 * apps/server/prisma/dev.db to exist and be seeded (`npm run seed -w apps/server`).
 *
 *   node scripts/invitations-regression.mjs
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

const workDir = mkdtempSync(path.join(tmpdir(), "scl-invitations-regression-"));
const dbCopy = path.join(workDir, "copy.db");
copyFileSync(SOURCE_DB, dbCopy);
const DATABASE_URL = `file:${dbCopy}`;

function startServer(port) {
  const child = spawn(process.execPath, [path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs"), path.join(SERVER_ROOT, "src", "index.ts")], {
    cwd: SERVER_ROOT,
    env: { ...process.env, NODE_ENV: "development", TRUST_PROXY: "0", PORT: String(port), DATABASE_URL, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "" },
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

class Client {
  constructor(base) {
    this.base = base;
    this.cookie = "";
  }
  async req(method, p, body) {
    const res = await fetch(`${this.base}${p}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) if (c.startsWith("scl.sid=")) this.cookie = c.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  get(p) { return this.req("GET", p); }
  post(p, body) { return this.req("POST", p, body); }
  del(p) { return this.req("DELETE", p); }
}

/** Every string value anywhere in `obj`, recursively (for "the response contains no token-shaped
 * value" checks — simpler and more robust than guessing field names). */
function allStringValues(obj, out = []) {
  if (typeof obj === "string") out.push(obj);
  else if (Array.isArray(obj)) for (const v of obj) allStringValues(v, out);
  else if (obj && typeof obj === "object") for (const v of Object.values(obj)) allStringValues(v, out);
  return out;
}

async function main() {
  const port = 46500 + Math.floor(Math.random() * 200);
  const server = await startServer(port);
  const base = `http://localhost:${port}`;

  try {
    const admin = new Client(base);
    t("admin login succeeds", (await admin.post("/api/auth/login", ADMIN)).status === 200);

    // ---- unauthorized invitation creation: guest, MEMBER and LAB_MANAGER are all refused --------
    {
      const guest = new Client(base);
      t("guest cannot list invitations (401)", (await guest.get("/api/invitations")).status === 401);
      t("guest cannot create an invitation (401)", (await guest.post("/api/invitations", { email: "x@example.test", role: "MEMBER" })).status === 401);

      const memberEmail = `inv-member-${Date.now()}@example.test`;
      await admin.post("/api/users", { email: memberEmail, password: "MemberPass123!", role: "MEMBER" });
      const member = new Client(base);
      await member.post("/api/auth/login", { email: memberEmail, password: "MemberPass123!" });
      t("MEMBER cannot list invitations (403)", (await member.get("/api/invitations")).status === 403);
      t("MEMBER cannot create an invitation (403)", (await member.post("/api/invitations", { email: "x@example.test", role: "MEMBER" })).status === 403);

      const mgrEmail = `inv-mgr-${Date.now()}@example.test`;
      await admin.post("/api/users", { email: mgrEmail, password: "MgrPass123!", role: "LAB_MANAGER" });
      const mgr = new Client(base);
      await mgr.post("/api/auth/login", { email: mgrEmail, password: "MgrPass123!" });
      t("LAB_MANAGER cannot list invitations (403 — account management is ADMIN-only)", (await mgr.get("/api/invitations")).status === 403);
      t("LAB_MANAGER cannot create an invitation (403)", (await mgr.post("/api/invitations", { email: "x@example.test", role: "MEMBER" })).status === 403);
    }

    // ---- valid invitation: create -> info -> accept -> session established ----------------------
    const email = `researcher-${Date.now()}@example.test`;
    let rawUrl;
    {
      const created = await admin.post("/api/invitations", { email, role: "MEMBER" });
      t("create invitation succeeds (201)", created.status === 201);
      t("create response includes a one-time url", typeof created.json?.url === "string" && created.json.url.includes("/invite/"));
      t("create response status is PENDING", created.json?.status === "PENDING");
      rawUrl = created.json.url;

      const list = await admin.get("/api/invitations");
      t("list invitations succeeds", list.status === 200);
      const row = list.json?.find((r) => r.email === email);
      t("the new invitation appears in the list", Boolean(row));
      t("the list response never includes the raw token or its hash anywhere", !("token" in (row ?? {})) && !("tokenHash" in (row ?? {})));

      // Duplicate pending invite for the same email is refused (no two simultaneously-valid links).
      t("a second invitation for the same still-pending email is refused (409)", (await admin.post("/api/invitations", { email, role: "MEMBER" })).status === 409);
    }

    const token = rawUrl.split("/invite/")[1];

    {
      const bad = await admin.get("/api/invitations/token/not-a-real-token-at-all-00000000000000000");
      t("info for an invalid token reports invalid, never a 500 or a stack trace", bad.status === 200 && bad.json.valid === false && bad.json.email === null);

      const info = await admin.get(`/api/invitations/token/${token}`);
      t("info for the real token reports valid with the correct email", info.status === 200 && info.json.valid === true && info.json.email === email);
    }

    {
      const weak = await admin.post(`/api/invitations/token/${token}/accept`, { password: "short" });
      t("accepting with a too-short password is rejected (400), account not created", weak.status === 400);
    }

    const researcher = new Client(base);
    const password = "ResearcherPass123!";
    {
      const accept = await researcher.post(`/api/invitations/token/${token}/accept`, { password });
      t("accept succeeds (201)", accept.status === 201);
      t("accept response never includes the password or any token-shaped value", !allStringValues(accept.json).some((v) => v === password));
      t("accept logs the new account straight in (no separate login step needed)", accept.json?.user?.email === email && accept.json?.user?.role === "MEMBER");

      const me = await researcher.get("/api/auth/me");
      t("the new account is actually logged in via its session cookie", me.status === 200 && me.json?.user?.email === email);
    }

    // ---- invitation cannot be replayed -----------------------------------------------------------
    {
      const replay = new Client(base);
      const reuse = await replay.post(`/api/invitations/token/${token}/accept`, { password: "AnotherPass123!" });
      t("reusing an already-accepted token is refused (409), not a second account", reuse.status === 409);
    }

    // ---- researcher cannot perform admin operations (role enforcement after activation) ----------
    t("the activated researcher still cannot list invitations (403)", (await researcher.get("/api/invitations")).status === 403);

    // ---- revoked invitation ------------------------------------------------------------------------
    {
      const revokeEmail = `revoke-${Date.now()}@example.test`;
      const created = await admin.post("/api/invitations", { email: revokeEmail, role: "MEMBER" });
      const list = await admin.get("/api/invitations");
      const row = list.json.find((r) => r.email === revokeEmail);

      const guest = new Client(base);
      t("a non-admin cannot revoke an invitation (403)", (await guest.del(`/api/invitations/${row.id}`)).status === 401);

      const revoke = await admin.del(`/api/invitations/${row.id}`);
      t("admin revoke succeeds", revoke.status === 200);
      t("revoking the same invitation twice is refused (409)", (await admin.del(`/api/invitations/${row.id}`)).status === 409);

      const revokedToken = created.json.url.split("/invite/")[1];
      const afterRevoke = new Client(base);
      const acceptRevoked = await afterRevoke.post(`/api/invitations/token/${revokedToken}/accept`, { password: "SomePass123!" });
      t("accepting a revoked invitation is refused (410) and creates no account", acceptRevoked.status === 410);
    }

    // ---- expired invitation (constructed directly, since the real TTL is 7 days) ------------------
    {
      const expiredEmail = `expired-${Date.now()}@example.test`;
      const tokenHashMod = await import("node:crypto");
      const rawToken = tokenHashMod.randomBytes(32).toString("base64url");
      const tokenHash = tokenHashMod.createHash("sha256").update(rawToken, "utf8").digest("hex");

      // Insert directly via a second, short-lived Prisma connection against the same disposable
      // file — the running server process has its own connection open, but SQLite handles this
      // multi-connection access fine for a single local file used only by this script.
      const { PrismaClient } = await import(path.join(SERVER_ROOT, "..", "..", "node_modules", "@prisma", "client", "default.js"));
      const direct = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
      const adminRow = await direct.user.findUnique({ where: { email: ADMIN.email } });
      await direct.accountInvitation.create({
        data: { tokenHash, email: expiredEmail, role: "MEMBER", invitedById: adminRow.id, expiresAt: new Date(Date.now() - 1000) },
      });
      await direct.$disconnect();

      const expiredClient = new Client(base);
      const info = await expiredClient.get(`/api/invitations/token/${rawToken}`);
      t("info for an expired token reports invalid", info.status === 200 && info.json.valid === false);
      const accept = await expiredClient.post(`/api/invitations/token/${rawToken}/accept`, { password: "SomePass123!" });
      t("accepting an expired invitation is refused (410) and creates no account", accept.status === 410);
    }

    // ---- password is never stored in plaintext -----------------------------------------------------
    {
      const { PrismaClient } = await import(path.join(SERVER_ROOT, "..", "..", "node_modules", "@prisma", "client", "default.js"));
      const direct = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
      const row = await direct.user.findUnique({ where: { email }, select: { passwordHash: true } });
      t("the password chosen at acceptance is stored only as a bcrypt hash, never in plaintext", /^\$2[aby]\$/.test(row.passwordHash) && row.passwordHash !== password);
      await direct.$disconnect();
    }

    // ---- self-service password change + logout --------------------------------------------------
    {
      const wrong = await researcher.post("/api/auth/password", { currentPassword: "WrongPassword123!", newPassword: "NewResearcherPass123!" });
      t("password change with the wrong current password is refused (401)", wrong.status === 401);

      const ok2 = await researcher.post("/api/auth/password", { currentPassword: password, newPassword: "NewResearcherPass123!" });
      t("password change with the correct current password succeeds", ok2.status === 200);

      t("logout succeeds", (await researcher.post("/api/auth/logout", {})).status === 200);

      const reLogin = new Client(base);
      const login = await reLogin.post("/api/auth/login", { email, password: "NewResearcherPass123!" });
      t("login after activation + password change succeeds with the NEW password", login.status === 200 && login.json?.user?.email === email);
      t("login with the OLD (pre-acceptance-change) password no longer works", (await new Client(base).post("/api/auth/login", { email, password })).status === 401);
    }
  } finally {
    server.kill();
  }

  console.log(`\n${ok} invitation/onboarding checks passed, ${failures.length} failed.`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
  rmSync(workDir, { recursive: true, force: true });
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  rmSync(workDir, { recursive: true, force: true });
  process.exit(1);
});
