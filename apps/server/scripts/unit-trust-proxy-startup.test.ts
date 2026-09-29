/**
 * Regression test for the Phase 26 TRUST_PROXY/DATABASE_URL production fail-fast checks (see
 * lib/trustProxy.ts and lib/config.ts). Same real-process-spawn approach as
 * unit-session-startup.test.ts (see that file's header for why a direct function call would not
 * actually prove the app refuses to boot): this spawns the real `src/index.ts` entry point.
 *
 *   npm run test:unit -w apps/server
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..", "..");
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const INDEX_TS = path.join(SERVER_ROOT, "src", "index.ts");

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

const randomPort = () => 45000 + Math.floor(Math.random() * 4000);

interface StartupResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError: boolean;
}

function runStartup(env: NodeJS.ProcessEnv, timeoutMs: number): Promise<StartupResult> {
  return new Promise((resolve) => {
    const cwd = mkdtempSync(path.join(tmpdir(), "scl-trust-proxy-startup-"));
    const child = spawn(process.execPath, [TSX_CLI, INDEX_TS], { cwd, env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const cleanup = () => {
      try { rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
    };
    const finish = (code: number | null, spawnError = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already dead */ }
      cleanup();
      resolve({ code, stdout, stderr, spawnError });
    };
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      if (/listening on/.test(stdout)) finish(null); // still running by design — that IS the pass signal
    });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", () => finish(null, true));
    child.on("exit", (code) => finish(code));
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

const baseEnv: NodeJS.ProcessEnv = { ...process.env };
const DB = "file:./unused-trust-proxy-startup-test.db";
const REAL_SECRET = "a-sufficiently-long-test-only-session-secret-111111";

const main = async () => {
  // ---- TRUST_PROXY unset in production: must refuse to start -------------------------------------
  // TRUST_PROXY: "" (present, empty) — not omitted — for the same reason SESSION_SECRET: "" is used
  // in unit-session-startup.test.ts: tsx's own .env auto-load only fills in KEYS THAT ARE ABSENT, so
  // an explicit empty string here can't be silently refilled from apps/server/.env.
  const unset = await runStartup({ ...baseEnv, NODE_ENV: "production", SESSION_SECRET: REAL_SECRET, TRUST_PROXY: "", PORT: String(randomPort()), DATABASE_URL: DB }, 15000);
  t("production startup with no TRUST_PROXY did not hang/spawn-fail", !unset.spawnError);
  t("production startup with no TRUST_PROXY exits (non-zero, not still running)", unset.code !== null && unset.code !== 0);
  t("production startup with no TRUST_PROXY never logs 'listening'", !/listening on/.test(unset.stdout));
  t("production startup with no TRUST_PROXY reports the expected error", /TRUST_PROXY must be set in production/.test(unset.stderr));

  // ---- TRUST_PROXY=true in production: must refuse to start (blind trust is never accepted) ------
  const blind = await runStartup({ ...baseEnv, NODE_ENV: "production", SESSION_SECRET: REAL_SECRET, TRUST_PROXY: "true", PORT: String(randomPort()), DATABASE_URL: DB }, 15000);
  t("production startup with TRUST_PROXY=true did not hang/spawn-fail", !blind.spawnError);
  t("production startup with TRUST_PROXY=true exits (non-zero, not still running)", blind.code !== null && blind.code !== 0);
  t("production startup with TRUST_PROXY=true reports the expected error", /TRUST_PROXY=true is not supported/.test(blind.stderr));

  // ---- TRUST_PROXY=0 (no reverse proxy) starts normally in production ----------------------------
  const noProxy = await runStartup({ ...baseEnv, NODE_ENV: "production", SESSION_SECRET: REAL_SECRET, TRUST_PROXY: "0", PORT: String(randomPort()), DATABASE_URL: DB }, 15000);
  t("production startup with TRUST_PROXY=0 actually starts listening", /listening on/.test(noProxy.stdout));
  t("production startup with TRUST_PROXY=0 is still running (not exited on its own)", noProxy.code === null);

  // ---- TRUST_PROXY=1 (one trusted hop) starts normally in production -----------------------------
  const oneHop = await runStartup({ ...baseEnv, NODE_ENV: "production", SESSION_SECRET: REAL_SECRET, TRUST_PROXY: "1", PORT: String(randomPort()), DATABASE_URL: DB }, 15000);
  t("production startup with TRUST_PROXY=1 actually starts listening", /listening on/.test(oneHop.stdout));
  t("production startup with TRUST_PROXY=1 is still running (not exited on its own)", oneHop.code === null);

  // ---- DATABASE_URL unset in production: must refuse to start (lib/config.ts) --------------------
  const noDb = await runStartup({ ...baseEnv, NODE_ENV: "production", SESSION_SECRET: REAL_SECRET, TRUST_PROXY: "0", PORT: String(randomPort()), DATABASE_URL: "" }, 15000);
  t("production startup with no DATABASE_URL did not hang/spawn-fail", !noDb.spawnError);
  t("production startup with no DATABASE_URL exits (non-zero, not still running)", noDb.code !== null && noDb.code !== 0);
  t("production startup with no DATABASE_URL never logs 'listening'", !/listening on/.test(noDb.stdout));
  t("production startup with no DATABASE_URL reports the expected error", /DATABASE_URL must be set in production/.test(noDb.stderr));

  console.log(`\n${ok} trust-proxy/config startup checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
};

main();
