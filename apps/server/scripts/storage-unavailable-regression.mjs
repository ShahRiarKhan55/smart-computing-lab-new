/**
 * Regression check for uploads when no persistent storage backend is available (Gallery upload 500
 * on Vercel without BLOB_READ_WRITE_TOKEN). Runs three scenarios, each spawning the real server
 * against its own disposable copy of dev.db:
 *   1. production + VERCEL=1 + no BLOB_READ_WRITE_TOKEN  -> POST /api/gallery and /api/files answer
 *      503 with a safe message (no paths/stack/secrets), create no rows and write nothing;
 *      validation errors are still 400s; reads still work.
 *   2. development with a scratch STORAGE_DIR              -> uploads still succeed (201) and the
 *      file reads back (local-development behaviour is unchanged).
 *   3. development with STORAGE_DIR beneath a regular file -> a real ENOTDIR (NOT a "storage
 *      unavailable" code) stays the generic 500, with no path or stack in the response and no rows.
 *
 * Self-contained: requires apps/server/prisma/dev.db to exist and be seeded. STORAGE_DIR is always a
 * temp directory, never the repository. TURSO_* are cleared for the spawned server.
 *
 * NETWORK NOTE: this script starts the real server (src/index.ts), whose `app.listen(port)` currently
 * binds ALL network interfaces, not just loopback. The script itself does NOT enforce loopback-only
 * binding (it only connects to 127.0.0.1). Run it only in an isolated environment: use a loopback-only
 * preload (e.g. a `--require` module, via NODE_OPTIONS, that makes `listen(port)` default to
 * 127.0.0.1) or equivalent network isolation such as a container or firewall.
 *
 *   node scripts/storage-unavailable-regression.mjs
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const SOURCE_DB = path.join(SERVER_ROOT, "prisma", "dev.db");
const ADMIN = { email: "admin@smartcomputinglab.org", password: "ChangeMe123!" };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

let ok = 0;
const failures = [];
const t = (name, cond, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

if (!existsSync(SOURCE_DB)) {
  console.error(`Missing ${SOURCE_DB} — run \`npm run seed -w apps/server\` first (see script header).`);
  process.exit(1);
}

const workDir = mkdtempSync(path.join(tmpdir(), "scl-storage-unavailable-regression-"));
const children = new Set(); // every spawned server; all are killed in the final cleanup, even if startup/assertions fail

function startServer(env) {
  const child = spawn(process.execPath, [path.join(SERVER_ROOT, "..", "..", "node_modules", "tsx", "dist", "cli.mjs"), path.join(SERVER_ROOT, "src", "index.ts")], {
    cwd: SERVER_ROOT,
    // Test-environment safety: never let an ambient Turso/Blob credential redirect this server.
    env: { ...env, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", BLOB_READ_WRITE_TOKEN: "" },
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Server did not start in time. Output so far:\n${out}`));
    }, 20000);
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

async function login(base, extraHeaders) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify(ADMIN) });
  const cookie = (res.headers.getSetCookie?.()[0] ?? "").split(";")[0];
  return { status: res.status, cookie };
}

function upload(base, route, cookie, headers, { file = PNG, type = "image/png", name = "t.png" } = {}) {
  const form = new FormData();
  if (file) form.append("file", new Blob([file], { type }), name);
  form.append("caption", "storage test");
  return fetch(`${base}${route}`, { method: "POST", headers: { Cookie: cookie, ...headers }, body: form });
}

async function scenario(label, { env, headers, storageDir }) {
  const dbCopy = path.join(workDir, `${label}.db`);
  copyFileSync(SOURCE_DB, dbCopy);
  const port = 46500 + Math.floor(Math.random() * 400);
  const server = await startServer({ ...process.env, ...env, PORT: String(port), DATABASE_URL: `file:${dbCopy}`, STORAGE_DIR: storageDir });
  const base = `http://127.0.0.1:${port}`;
  try {
    const { status, cookie } = await login(base, headers);
    t(`${label}: admin login succeeds and a session cookie is set`, status === 200 && cookie.startsWith("scl.sid="), `status ${status}`);
    return { base, cookie, headers, server };
  } catch (err) {
    server.kill();
    throw err;
  }
}

try {
  // ---- 1. production on Vercel, no Blob token -------------------------------------------
  {
    const storageDir = path.join(workDir, "prod-storage");
    const { base, cookie, headers, server } = await scenario("prod-no-blob", {
      env: { NODE_ENV: "production", VERCEL: "1", TRUST_PROXY: "1", SESSION_SECRET: "a-sufficiently-long-test-only-session-secret-333333" },
      headers: { "X-Forwarded-Proto": "https" },
      storageDir,
    });
    try {
      for (const route of ["/api/gallery", "/api/files"]) {
        const res = await upload(base, route, cookie, headers);
        const text = await res.text();
        let body = {};
        try { body = JSON.parse(text); } catch { /* checked below */ }
        t(`prod-no-blob ${route}: a valid upload answers 503`, res.status === 503, `got ${res.status}`);
        t(`prod-no-blob ${route}: JSON body with a single safe error message`, typeof body.error === "string" && Object.keys(body).length === 1);
        t(`prod-no-blob ${route}: message leaks no path, errno, stack, credential or infrastructure name`, !/[\\/]|EROFS|EACCES|ENOENT|errno|at \s*\w+|stack|token|secret|blob|vercel|turso|tmp|node_modules/i.test(text), text.slice(0, 120));
        t(`prod-no-blob ${route}: it is NOT the generic 500 message`, body.error !== "Internal server error");

        const notImage = await upload(base, route, cookie, headers, { file: Buffer.from("MZ\x90\x00not an allowed type"), type: "application/x-msdownload", name: "bad.exe" });
        t(`prod-no-blob ${route}: a disallowed file type is still a 400 validation error, not 503`, notImage.status === 400 || notImage.status === 415, `got ${notImage.status}`);
        const noFile = await upload(base, route, cookie, headers, { file: null });
        t(`prod-no-blob ${route}: a request with no file is still a 400`, noFile.status === 400, `got ${noFile.status}`);
      }
      const list = await (await fetch(`${base}/api/gallery`, { headers: { Cookie: cookie, ...headers } })).json();
      t("prod-no-blob: the failed uploads created no gallery items", Array.isArray(list.items) && list.items.length === 0);
      t("prod-no-blob: nothing was written to the storage directory", !existsSync(storageDir) || readdirSync(storageDir).length === 0);
      const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie, ...headers } });
      t("prod-no-blob: the rest of the app still works (no startup failure)", me.status === 200);
    } finally {
      server.kill();
    }
  }

  // ---- 2. development: local storage still works -----------------------------------------
  {
    const storageDir = path.join(workDir, "dev-storage");
    mkdirSync(storageDir, { recursive: true });
    const { base, cookie, headers, server } = await scenario("dev-local", {
      env: { NODE_ENV: "development", TRUST_PROXY: "1" },
      headers: {},
      storageDir,
    });
    try {
      const res = await upload(base, "/api/gallery", cookie, headers);
      const body = await res.json().catch(() => ({}));
      t("dev-local /api/gallery: upload still succeeds (201)", res.status === 201, `got ${res.status}`);
      t("dev-local: the blob landed in the scratch STORAGE_DIR", readdirSync(storageDir).length === 1);
      const fileId = body?.file?.id ?? body?.fileId ?? body?.image?.id;
      if (fileId) {
        const read = await fetch(`${base}/api/files/${fileId}`, { headers: { Cookie: cookie } });
        t("dev-local: the uploaded file reads back (200)", read.status === 200);
      }
      const res2 = await upload(base, "/api/files", cookie, headers);
      t("dev-local /api/files: upload still succeeds (201)", res2.status === 201, `got ${res2.status}`);
    } finally {
      server.kill();
    }
  }

  // ---- 3. development, STORAGE_DIR beneath a regular file: a real ENOTDIR must stay a 500 ----
  {
    const blocker = path.join(workDir, "not-a-directory");
    writeFileSync(blocker, "I am a regular file");
    const storageDir = path.join(blocker, "files"); // mkdir here fails with ENOTDIR (not a storage-unavailable code)
    const { base, cookie, headers, server } = await scenario("dev-enotdir", {
      env: { NODE_ENV: "development", TRUST_PROXY: "1" },
      headers: {},
      storageDir,
    });
    try {
      for (const route of ["/api/gallery", "/api/files"]) {
        const res = await upload(base, route, cookie, headers);
        const text = await res.text();
        let body = {};
        try { body = JSON.parse(text); } catch { /* checked below */ }
        t(`dev-enotdir ${route}: an unrelated filesystem error is still the generic 500, not 503`, res.status === 500, `got ${res.status}`);
        t(`dev-enotdir ${route}: body is exactly the existing generic message`, body.error === "Internal server error" && Object.keys(body).length === 1, text.slice(0, 120));
        t(`dev-enotdir ${route}: no path, errno or stack trace in the response`, !/[\\/]|ENOTDIR|errno|\bat\s+\S+\s*\(|node:|tmp|scl-/i.test(text), text.slice(0, 120));
      }
      const list = await (await fetch(`${base}/api/gallery`, { headers: { Cookie: cookie } })).json();
      t("dev-enotdir: no gallery item was created", Array.isArray(list.items) && list.items.length === 0);
      // Count rows straight from this scenario's disposable DB copy (never a shared database).
      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient({ datasources: { db: { url: `file:${path.join(workDir, "dev-enotdir.db")}` } } });
      try {
        t("dev-enotdir: no StoredFile record was created", (await prisma.storedFile.count()) === 0);
        t("dev-enotdir: no GalleryItem record was created", (await prisma.galleryItem.count()) === 0);
      } finally {
        await prisma.$disconnect();
      }
      t("dev-enotdir: the blocking file is untouched and nothing was created beneath it", readFileSync(blocker, "utf8") === "I am a regular file" && !existsSync(storageDir));
    } finally {
      server.kill();
    }
  }
} finally {
  console.log(`\n${ok} storage-unavailable checks passed, ${failures.length} failed.`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));
  for (const child of children) child.kill();
  rmSync(workDir, { recursive: true, force: true });
}
if (failures.length) process.exit(1);
