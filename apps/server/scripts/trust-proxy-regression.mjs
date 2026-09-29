/**
 * Regression check for the Phase 26 TRUST_PROXY=0 topology (see src/lib/trustProxy.ts): the
 * "no reverse proxy" default, where `X-Forwarded-For` must be completely ignored and `req.ip` is
 * always the real socket address. This is the exact scenario Phase 25's own regression comment
 * flagged as unverified ("this repo has no reverse proxy in front yet... a hostile client can send
 * any value here too") — this script closes that gap by proving a spoofed header has NO effect
 * under TRUST_PROXY=0, as a complement to api-regression.mjs's brute-force section (which now
 * requires TRUST_PROXY=1 — see that file's header — and proves the OPPOSITE: that a claimed IP DOES
 * get its own bucket once there is exactly one trusted hop).
 *
 * Self-contained: copies apps/server/prisma/dev.db to a disposable temp file, applies migrations
 * against it (a no-op if already current), spawns the real server with TRUST_PROXY=0, runs its
 * checks over plain HTTP, then tears everything down. Requires apps/server/prisma/dev.db to exist
 * and be seeded (`npm run seed -w apps/server`) — same precondition as every other *-regression.mjs.
 *
 *   node scripts/trust-proxy-regression.mjs
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");

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

const workDir = mkdtempSync(path.join(tmpdir(), "scl-trust-proxy-regression-"));
const dbCopy = path.join(workDir, "copy.db");
copyFileSync(SOURCE_DB, dbCopy);
const DATABASE_URL = `file:${dbCopy}`;
const PORT = 45600 + Math.floor(Math.random() * 400);
const API = `http://localhost:${PORT}`;

function startServer(env) {
  const child = spawn(process.execPath, [path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs"), path.join(SERVER_ROOT, "src", "index.ts")], {
    cwd: SERVER_ROOT,
    env,
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

async function loginAs(email, password, xForwardedFor) {
  const headers = { "Content-Type": "application/json" };
  if (xForwardedFor) headers["X-Forwarded-For"] = xForwardedFor;
  const res = await fetch(`${API}/api/auth/login`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
  return res.status;
}

async function main() {
  const server = await startServer({
    ...process.env,
    NODE_ENV: "test",
    TRUST_PROXY: "0",
    PORT: String(PORT),
    DATABASE_URL,
  });

  try {
    // ---- a spoofed X-Forwarded-For has NO effect under TRUST_PROXY=0 -----------------------------
    // Every request in this whole script arrives from the same real socket (127.0.0.1), so with
    // X-Forwarded-For correctly ignored, claiming two different IPs must still share ONE bucket.
    const email = "p26test-untrusted-xff@example.test";
    const statusesA = [];
    for (let i = 0; i < 5; i++) statusesA.push(await loginAs(email, "wrong-password", "203.0.113.50"));
    const statusesB = [];
    for (let i = 0; i < 5; i++) statusesB.push(await loginAs(email, "wrong-password", "203.0.113.60"));
    t(
      "5 fails claiming IP .50 + 5 fails claiming IP .60 share one bucket (10 total) -- all read 401",
      [...statusesA, ...statusesB].every((s) => s === 401),
      JSON.stringify({ statusesA, statusesB }),
    );
    t(
      "the 11th fail (a third claimed IP) is 429 -- spoofed X-Forwarded-For never created a fresh bucket",
      (await loginAs(email, "wrong-password", "203.0.113.70")) === 429,
    );

    // ---- a direct request (no X-Forwarded-For at all) behaves identically ------------------------
    const email2 = "p26test-direct-request@example.test";
    const direct = [];
    for (let i = 0; i < 10; i++) direct.push(await loginAs(email2, "wrong-password"));
    t("10 direct-request fails all read 401", direct.every((s) => s === 401), JSON.stringify(direct));
    t("the 11th direct-request fail is 429", (await loginAs(email2, "wrong-password")) === 429);
    t(
      "a claimed X-Forwarded-For for the SAME email is also 429 (same real socket, same bucket)",
      (await loginAs(email2, "wrong-password", "198.51.100.1")) === 429,
    );

    console.log(`\n${ok} trust-proxy (TRUST_PROXY=0) checks passed, ${failures.length} failed.`);
    if (failures.length) {
      console.log("Failures:\n - " + failures.join("\n - "));
    }
  } finally {
    server.kill();
    rmSync(workDir, { recursive: true, force: true });
  }

  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  rmSync(workDir, { recursive: true, force: true });
  process.exit(1);
});
