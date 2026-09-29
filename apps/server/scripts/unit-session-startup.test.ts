/**
 * Regression test for the Phase 25 SESSION_SECRET production fail-fast (mutation M8 — see
 * docs/architecture/phase25-final-quality-security-accessibility-performance.md §18D). This
 * mutant survived every other suite because nothing actually booted the real server with
 * NODE_ENV=production: everything else runs in development, where the mutant and the real code
 * behave identically (warn and continue).
 *
 * This test exercises the REAL startup path — it spawns the actual `src/index.ts` entry point
 * as a child process (the same way `node scripts/browser-regression.cjs`'s launcher does), not
 * a direct call to `sessionSecret()`/`createSessionMiddleware()`. Calling those directly would
 * just re-assert the implementation against itself; spawning the process is what actually tells
 * us the app refuses to come up in production without a real secret.
 *
 * Runs from a fresh, empty temp directory (no `.env` file there), but note that's not sufficient
 * on its own: tsx auto-loads `apps/server/.env` (which sets a real `SESSION_SECRET`) by walking
 * up from the entry *file*, independent of the child's cwd. So the "missing secret" case passes
 * `SESSION_SECRET: ""` explicitly rather than omitting the key — present-but-falsy, so no loader
 * treats it as unset and fills it back in from disk; `sessionSecret()`'s own `if (secret) return
 * secret` check then correctly falls through. DATABASE_URL points at a disposable, never-created
 * sqlite path: PrismaClient's constructor only needs a syntactically valid URL, it never connects
 * eagerly, and the session-secret throw happens before any query would.
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

const randomPort = () => 41000 + Math.floor(Math.random() * 4000);

interface StartupResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError: boolean;
}

/** Spawns the real server entry point with the given env and waits for it to either exit or start listening. */
function runStartup(env: NodeJS.ProcessEnv, timeoutMs: number): Promise<StartupResult> {
  return new Promise((resolve) => {
    const cwd = mkdtempSync(path.join(tmpdir(), "scl-session-startup-"));
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
const DB = "file:./unused-session-startup-test.db";

const main = async () => {
  // ---- the defect this phase's hardening actually fixes: must refuse to start ---------------------
  // SESSION_SECRET: "" (present, empty) — not omitted — so tsx's own .env auto-load can't refill it.
  // TRUST_PROXY=0 is set explicitly so this case isolates SESSION_SECRET specifically (Phase 26
  // made TRUST_PROXY itself a separate required-in-production value — see
  // unit-trust-proxy-startup.test.ts — and an unset TRUST_PROXY would otherwise be the FIRST thing
  // to fail here, never reaching the SESSION_SECRET check this test is actually about).
  const failCase = await runStartup({ ...baseEnv, NODE_ENV: "production", SESSION_SECRET: "", TRUST_PROXY: "0", PORT: String(randomPort()), DATABASE_URL: DB }, 15000);
  t("production startup with no SESSION_SECRET did not hang/spawn-fail", !failCase.spawnError);
  t("production startup with no SESSION_SECRET exits (non-zero, not still running)", failCase.code !== null && failCase.code !== 0);
  t("production startup with no SESSION_SECRET never logs 'listening'", !/listening on/.test(failCase.stdout));
  t("production startup with no SESSION_SECRET reports the expected error", /SESSION_SECRET must be set in production/.test(failCase.stderr));

  // ---- complementary path: a real secret must still let production start normally -----------------
  const passCase = await runStartup({ ...baseEnv, NODE_ENV: "production", SESSION_SECRET: "a-sufficiently-long-test-only-session-secret-000000", TRUST_PROXY: "0", PORT: String(randomPort()), DATABASE_URL: DB }, 15000);
  t("production startup with a real SESSION_SECRET did not hang/spawn-fail", !passCase.spawnError);
  t("production startup with a real SESSION_SECRET actually starts listening", /listening on/.test(passCase.stdout));
  t("production startup with a real SESSION_SECRET is still running (not exited on its own)", passCase.code === null);

  console.log(`\n${ok} session-secret startup checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
};

main();
