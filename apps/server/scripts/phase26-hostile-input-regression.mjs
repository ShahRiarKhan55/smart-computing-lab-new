/**
 * Focused hostile-input regression for the surfaces Phase 26 actually touched (Phase 26 §17):
 * the explicit JSON body-size cap, a malformed X-Forwarded-For value under a trusted-proxy
 * topology, a hostile PUBLIC_BASE_URL configuration value, and that security headers are present
 * even on error responses (a 404, not just the happy path). This does not repeat the extensive
 * existing hostile-input coverage in api-regression.mjs/browser-regression.cjs (path traversal,
 * XSS, auth bypass, ...) — see those for the areas this phase did not change.
 *
 * Self-contained: copies apps/server/prisma/dev.db to a disposable temp file, spawns the real
 * server, runs checks, tears down. Requires apps/server/prisma/dev.db to exist and be seeded.
 *
 *   node scripts/phase26-hostile-input-regression.mjs
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

const workDir = mkdtempSync(path.join(tmpdir(), "scl-phase26-hostile-"));
const dbCopy = path.join(workDir, "copy.db");
copyFileSync(SOURCE_DB, dbCopy);
const DATABASE_URL = `file:${dbCopy}`;

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

async function main() {
  const port = 46500 + Math.floor(Math.random() * 200);
  const base = `http://localhost:${port}`;
  const server = await startServer({
    ...process.env,
    NODE_ENV: "test",
    TRUST_PROXY: "1",
    PORT: String(port),
    DATABASE_URL,
    // Deliberately hostile: a non-http(s) scheme. lib/sitemap.ts's normalizeBaseUrl must reject it.
    PUBLIC_BASE_URL: "javascript:alert(document.cookie)",
  });

  try {
    // ---- oversized JSON body is rejected with 413, not crashed/hung ------------------------------
    const oversized = "x".repeat(200 * 1024); // 200kb, well over the explicit 100kb JSON_BODY_LIMIT
    const bigRes = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.test", password: oversized }),
    });
    t("an oversized JSON body is rejected with 413, not 500/hang", bigRes.status === 413, String(bigRes.status));
    const bigBody = await bigRes.json().catch(() => null);
    t("the 413 response is a clean, safe JSON error body (no stack trace/internals)", bigBody && typeof bigBody.error === "string" && !/at\s+\S+\s*\(/.test(bigBody.error));

    // ---- server still answers normally right after an oversized-body rejection -------------------
    const health = await fetch(`${base}/api/health`);
    t("the server is still responsive after an oversized-body rejection (no crash)", health.status === 200);

    // ---- a malformed X-Forwarded-For value under TRUST_PROXY=1 never crashes the server ----------
    for (const hostile of ["not-an-ip-at-all", "'; DROP TABLE User; --", "<script>alert(1)</script>", "", "1".repeat(5000), "::1, ::1, ::1, ::1, ::1"]) {
      const res = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": hostile },
        body: JSON.stringify({ email: "nobody@example.test", password: "wrong" }),
      });
      t(`a malformed X-Forwarded-For (${JSON.stringify(hostile.slice(0, 20))}…) never crashes the server (gets a real HTTP response, not a connection failure)`, res.status === 401 || res.status === 429, String(res.status));
    }
    const stillUp = await fetch(`${base}/api/health`);
    t("the server is still responsive after every malformed X-Forwarded-For value", stillUp.status === 200);

    // ---- a hostile PUBLIC_BASE_URL is never embedded in the sitemap; the route just says "not configured" ----
    const sitemapRes = await fetch(`${base}/sitemap.xml`);
    t("a non-http(s) PUBLIC_BASE_URL is treated as unconfigured (404), never embedded as-is", sitemapRes.status === 404);
    const sitemapBody = await sitemapRes.text();
    t("the hostile scheme string never appears anywhere in the response body", !sitemapBody.includes("javascript:"));

    const robotsRes = await fetch(`${base}/robots.txt`);
    const robotsBody = await robotsRes.text();
    t("robots.txt also never embeds the hostile PUBLIC_BASE_URL value (no Sitemap: line at all)", !robotsBody.includes("javascript:") && !robotsBody.includes("Sitemap:"));

    // ---- security headers are present on an ERROR response too, not just the happy path ----------
    const notFound = await fetch(`${base}/api/does-not-exist-at-all`);
    t("a 404 response still carries X-Content-Type-Options: nosniff", (notFound.headers.get("x-content-type-options") || "") === "nosniff");
    t("a 404 response still carries X-Frame-Options", Boolean(notFound.headers.get("x-frame-options")));
    t("a 404 response body never leaks a file path or stack frame", !/\/home\/|\/apps\/server|at \S+ \(/.test(await notFound.text()));

    // ---- baseline sanity: a normal login still works under all of the above active at once -------
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ADMIN),
    });
    t("a legitimate login still succeeds with every hostile-input guard active", loginRes.status === 200, String(loginRes.status));

    console.log(`\n${ok} Phase 26 hostile-input checks passed, ${failures.length} failed.`);
    if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
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
