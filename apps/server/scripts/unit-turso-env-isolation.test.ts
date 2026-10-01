/**
 * Regression test for a test-INFRASTRUCTURE safety property, not application behavior: every
 * regression script that spawns its own disposable local server (session-cookie-regression.mjs,
 * trust-proxy-regression.mjs, phase26-hostile-input-regression.mjs, sitemap-regression.mjs,
 * unit-session-startup.test.ts, unit-trust-proxy-startup.test.ts, invitations-regression.mjs)
 * must clear TURSO_DATABASE_URL/TURSO_AUTH_TOKEN before spawning, so an operator's shell having
 * real (or, as here, fake) Turso credentials ambiently set can never cause a "local" test run to
 * silently connect somewhere else instead of the disposable local DATABASE_URL copy it made.
 *
 * This does NOT touch real Turso, production or otherwise: the simulated "parent environment" set
 * up below uses an obviously fake, non-resolving host (`invalid` is a reserved TLD per RFC 2606 —
 * guaranteed never to resolve) and a fake token value, never read from this process's own real
 * environment. The property under test is end-to-end and behavioral, not a log/string inspection:
 * trust-proxy-regression.mjs's own checks make real `POST /api/auth/login` calls, which run a real
 * `prisma.user.findUnique` query — if the fix under test did NOT clear the simulated ambient Turso
 * vars, that query would try to actually resolve/connect to the fake `*.invalid` host and the
 * child script would fail or hang instead of completing with its checks passing. Reaching
 * "completes, exit 0, checks pass" is only possible if the local SQLite path was actually used.
 *
 *   npm run test:unit -w apps/server
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
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

if (!existsSync(SOURCE_DB)) {
  console.error(`Missing ${SOURCE_DB} — run \`npm run seed -w apps/server\` first.`);
  process.exit(1);
}

// A fake, non-resolving token — `.invalid` is a reserved TLD (RFC 2606) guaranteed never to
// resolve on a real network, so this can never reach any real service, Turso or otherwise.
const FAKE_TURSO_URL = "libsql://turso-env-isolation-test.invalid";
const FAKE_TURSO_TOKEN = "fake-token-turso-env-isolation-test-only";

function runChild(scriptPath: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], { cwd: SERVER_ROOT, env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already dead */ }
      resolve({ code, stdout, stderr });
    };
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("exit", (code) => finish(code));
    child.on("error", () => finish(null));
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

async function main() {
  const workDir = mkdtempSync(path.join(tmpdir(), "scl-turso-env-isolation-"));
  const dbCopy = path.join(workDir, "copy.db");
  copyFileSync(SOURCE_DB, dbCopy);

  try {
    // Simulates the exact scenario this fix defends against: an operator's shell (this test
    // process, standing in for "Windows/Claude Code's own parent process") ambiently has
    // TURSO_DATABASE_URL/TURSO_AUTH_TOKEN set when a regression script is invoked. The script
    // itself (trust-proxy-regression.mjs) does not take DATABASE_URL from us — it builds its own
    // disposable copy internally — so this only proves the TURSO_* clearing, not DATABASE_URL
    // plumbing (already covered by that script's own suite).
    const simulatedParentEnv: NodeJS.ProcessEnv = {
      ...process.env,
      TURSO_DATABASE_URL: FAKE_TURSO_URL,
      TURSO_AUTH_TOKEN: FAKE_TURSO_TOKEN,
    };

    const result = await runChild(path.join(SERVER_ROOT, "scripts", "trust-proxy-regression.mjs"), simulatedParentEnv, 30000);

    t("the child regression script actually completed (did not hang trying to reach the fake Turso host)", result.code !== null, `exit code: ${result.code}`);
    t("the child regression script exited 0 (all its own checks passed)", result.code === 0, result.stdout.slice(-500));
    t(
      "the child's own output reports its real-login-dependent checks passing, not erroring out",
      /5 trust-proxy \(TRUST_PROXY=0\) checks passed, 0 failed\./.test(result.stdout),
      result.stdout.slice(-500),
    );
    t(
      "neither the fake Turso URL nor the fake token ever appears in the child's stdout/stderr (nothing about the ambient env is echoed, logged or leaked)",
      !result.stdout.includes(FAKE_TURSO_URL) && !result.stderr.includes(FAKE_TURSO_URL) && !result.stdout.includes(FAKE_TURSO_TOKEN) && !result.stderr.includes(FAKE_TURSO_TOKEN),
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  console.log(`\n${ok} Turso test-environment isolation checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
