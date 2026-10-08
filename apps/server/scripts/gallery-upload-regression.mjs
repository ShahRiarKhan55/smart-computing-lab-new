/**
 * Regression for the gallery-upload "Internal Server Error" incident (Phase 27 / P27.10).
 *
 * Root cause class being guarded: on Vercel the function filesystem is read-only and per-instance,
 * so when `BLOB_READ_WRITE_TOKEN` is missing (or Blob refuses the write) the upload used to die deep
 * inside `mkdir`/`put` and surface as an opaque `500 Internal server error`, leaving the operator
 * nothing to act on. These checks assert the classified behaviour instead: a structured 503 with a
 * stable `code`, NO database rows or blobs left behind, no secret in the response body, a clean JSON
 * 413 below Vercel's 4.5 MB body limit, and an admin diagnostic that names the problem.
 *
 * Fully self-contained and offline: every case spawns its own server on a disposable copy of
 * prisma/dev.db with TURSO_* cleared, and "Vercel Blob" is a local mock reached through the SDK's own
 * `VERCEL_BLOB_API_URL` override. Nothing here can touch Turso or a real Blob store.
 *
 *   node scripts/gallery-upload-regression.mjs
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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
const FAKE_TOKEN = "vercel_blob_rw_TESTSTORE_FAKEFAKEFAKEFAKE";

let ok = 0;
const failures = [];
const t = (name, cond, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

if (!existsSync(SOURCE_DB)) {
  console.error(`Missing ${SOURCE_DB} — run \`npm run seed -w apps/server\` first.`);
  process.exit(1);
}

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const pngOfSize = (bytes) => Buffer.concat([PNG_1x1, Buffer.alloc(Math.max(0, bytes - PNG_1x1.length), 0)]);

/** A tiny stand-in for the Vercel Blob API: records requests; behaviour chosen per test. */
function startBlobMock(mode) {
  const seen = [];
  const server = createServer((req, res) => {
    let size = 0;
    req.on("data", (c) => (size += c.length));
    req.on("end", () => {
      seen.push(`${req.method} ${req.url.split("?")[0]}`);
      res.setHeader("content-type", "application/json");
      if (mode === "forbidden") {
        // Non-retryable 4xx, like "private access is not allowed on a public store".
        res.statusCode = 403;
        res.end(JSON.stringify({ error: { code: "forbidden", message: `private access not allowed (token ${FAKE_TOKEN})` } }));
        return;
      }
      if (req.method === "PUT") {
        const pathname = new URL(req.url, "http://x").searchParams.get("pathname");
        res.end(JSON.stringify({ url: `https://mock.public.blob.vercel-storage.com/${pathname}`, downloadUrl: `https://mock/${pathname}?download=1`, pathname, contentType: "image/png", contentDisposition: "inline", etag: '"e"' }));
        return;
      }
      res.end(JSON.stringify({})); // POST /delete etc.
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ seen, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

async function startServer(extraEnv = {}) {
  const work = mkdtempSync(path.join(tmpdir(), "scl-gallery-upload-"));
  copyFileSync(SOURCE_DB, path.join(work, "c.db"));
  const port = 46500 + Math.floor(Math.random() * 400);
  const env = {
    ...process.env,
    TURSO_DATABASE_URL: "",
    TURSO_AUTH_TOKEN: "",
    BLOB_READ_WRITE_TOKEN: "",
    VERCEL: "",
    STORAGE_DIR: path.join(work, "files"),
    DATABASE_URL: `file:${path.join(work, "c.db")}`,
    PORT: String(port),
    TRUST_PROXY: "0",
    NODE_ENV: "test",
    SESSION_SECRET: "gallery-upload-regression-secret-0000000000",
    ...extraEnv,
  };
  const child = spawn(process.execPath, [TSX, path.join(SERVER_ROOT, "src", "index.ts")], { cwd: SERVER_ROOT, env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 80 && !/listening on/.test(out); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/listening on/.test(out)) throw new Error(`server did not start:\n${out}`);
  const base = `http://localhost:${port}`;
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  return {
    base,
    work,
    prisma,
    logs: () => out,
    storageFiles: () => (existsSync(env.STORAGE_DIR) ? readdirSync(env.STORAGE_DIR) : []),
    async stop() {
      child.kill();
      await prisma.$disconnect();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

async function login(base, creds) {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds) });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  return { status: res.status, cookie };
}

async function upload(base, cookie, bytes, { name = "t.png", type = "image/png", extra = {} } = {}) {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type }), name);
  form.set("caption", "regression");
  form.set("category", "LAB_LIFE");
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  const res = await fetch(`${base}/api/gallery`, { method: "POST", headers: cookie ? { cookie } : {}, body: form });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, text, json };
}

const counts = async (s) => ({ files: await s.prisma.storedFile.count(), items: await s.prisma.galleryItem.count() });

async function main() {
  // ---- 1. healthy local storage: the happy path still works --------------------------------------
  {
    const s = await startServer();
    try {
      const { cookie } = await login(s.base, ADMIN);
      const before = await counts(s);
      const r = await upload(s.base, cookie, PNG_1x1);
      t("healthy: a valid PNG upload is 201", r.status === 201, `${r.status} ${r.text.slice(0, 120)}`);
      const after = await counts(s);
      t("healthy: exactly one StoredFile and one GalleryItem were created", after.files === before.files + 1 && after.items === before.items + 1);
      t("healthy: exactly one blob exists on disk", s.storageFiles().length === 1);

      const guest = await upload(s.base, null, PNG_1x1);
      t("healthy: a guest upload is 401", guest.status === 401);

      const spoof = await upload(s.base, cookie, Buffer.from("<html><script>alert(1)</script></html>"), { name: "evil.png", type: "image/png" });
      t("healthy: HTML claiming to be image/png is rejected 400 (magic bytes decide, not the header)", spoof.status === 400, `${spoof.status}`);
      const svg = await upload(s.base, cookie, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), { name: "a.svg", type: "image/svg+xml" });
      t("healthy: an SVG is rejected 400", svg.status === 400, `${svg.status}`);
      const pdf = await upload(s.base, cookie, Buffer.from("%PDF-1.4\n%fake"), { name: "a.pdf", type: "application/pdf" });
      t("healthy: a PDF is rejected from the (image-only) gallery with 400", pdf.status === 400, `${pdf.status}`);
      const stillOne = await counts(s);
      t("healthy: rejected uploads left no database rows and no blobs", stillOne.files === after.files && stillOne.items === after.items && s.storageFiles().length === 1);

      const badProject = await upload(s.base, cookie, PNG_1x1, { extra: { projectId: "no-such-project" } });
      t("healthy: a DB-side rejection (unknown project) is a 4xx, not a 500", badProject.status >= 400 && badProject.status < 500, `${badProject.status}`);
      const afterBad = await counts(s);
      t("healthy: …and it left no row and removed its blob (no orphan)", afterBad.files === after.files && s.storageFiles().length === 1, JSON.stringify(afterBad));

      const diag = await fetch(`${s.base}/api/files/storage-status?probe=1`, { headers: { cookie } });
      const diagJson = await diag.json();
      t("healthy: admin storage-status probe reports a writable local backend", diag.status === 200 && diagJson.backend === "local" && diagJson.configured === true && diagJson.writable === true, JSON.stringify(diagJson));
      t("healthy: the probe cleaned up after itself", s.storageFiles().length === 1);
      const guestDiag = await fetch(`${s.base}/api/files/storage-status`);
      t("healthy: storage-status is 401 for guests", guestDiag.status === 401);
    } finally {
      await s.stop();
    }
  }

  // ---- 2. oversize: a clean JSON 413, never a 500 -------------------------------------------------
  {
    const s = await startServer({ MAX_IMAGE_BYTES: "2048" });
    try {
      const { cookie } = await login(s.base, ADMIN);
      const before = await counts(s);
      const r = await upload(s.base, cookie, pngOfSize(4096));
      t("oversize: an image over the limit is a JSON 413 with a readable message", r.status === 413 && typeof r.json?.error === "string" && /too large/i.test(r.json.error), `${r.status} ${r.text.slice(0, 100)}`);
      t("oversize: nothing was stored", JSON.stringify(await counts(s)) === JSON.stringify(before) && s.storageFiles().length === 0);
    } finally {
      await s.stop();
    }
  }

  // ---- 3. the incident: Vercel (read-only FS) with no BLOB_READ_WRITE_TOKEN ------------------------
  {
    const s = await startServer({ VERCEL: "1" });
    try {
      const { cookie } = await login(s.base, ADMIN);
      const before = await counts(s);
      const r = await upload(s.base, cookie, PNG_1x1);
      t("vercel-no-token: upload is a structured 503 STORAGE_NOT_CONFIGURED (was an opaque 500)", r.status === 503 && r.json?.code === "STORAGE_NOT_CONFIGURED", `${r.status} ${r.text.slice(0, 160)}`);
      t("vercel-no-token: the message is safe and actionable, with no stack trace or path", typeof r.json?.error === "string" && !/at |\/home\/|node_modules|ENOENT|EROFS/.test(r.json.error));
      t("vercel-no-token: no database rows were created", JSON.stringify(await counts(s)) === JSON.stringify(before));
      t("vercel-no-token: the disk was never touched", s.storageFiles().length === 0);
      const diag = await (await fetch(`${s.base}/api/files/storage-status`, { headers: { cookie } })).json();
      t("vercel-no-token: admin diagnostic names the missing variable and says not configured", diag.configured === false && /BLOB_READ_WRITE_TOKEN/.test(diag.issue ?? ""), JSON.stringify(diag));
      t("vercel-no-token: server log carries only the sanitized code", /\[storage\] STORAGE_NOT_CONFIGURED/.test(s.logs()));
    } finally {
      await s.stop();
    }
  }

  // ---- 4. unwritable local storage root (read-only filesystem) ------------------------------------
  {
    const s = await startServer({ STORAGE_DIR: "/dev/null/not-a-directory" });
    try {
      const { cookie } = await login(s.base, ADMIN);
      const before = await counts(s);
      const r = await upload(s.base, cookie, PNG_1x1);
      t("unwritable-fs: upload is a structured 503 STORAGE_UNAVAILABLE", r.status === 503 && r.json?.code === "STORAGE_UNAVAILABLE", `${r.status} ${r.text.slice(0, 160)}`);
      t("unwritable-fs: response does not leak the filesystem path or errno text", !/\/dev\/null|ENOTDIR|mkdir/.test(r.text));
      t("unwritable-fs: no rows were created", JSON.stringify(await counts(s)) === JSON.stringify(before));
      t("unwritable-fs: the server log has the errno code for the operator", /STORAGE_UNAVAILABLE: local write failed: Error code=ENOTDIR/.test(s.logs()), s.logs().split("\n").filter((l) => l.includes("[storage]")).join("|"));
    } finally {
      await s.stop();
    }
  }

  // ---- 5. Blob configured but refusing writes (e.g. private access on a public store) ----------------
  {
    const mock = await startBlobMock("forbidden");
    const s = await startServer({ BLOB_READ_WRITE_TOKEN: FAKE_TOKEN, VERCEL_BLOB_API_URL: mock.url, VERCEL: "1" });
    try {
      const { cookie } = await login(s.base, ADMIN);
      const before = await counts(s);
      const r = await upload(s.base, cookie, PNG_1x1);
      t("blob-refuses: upload is a structured 503 STORAGE_UNAVAILABLE", r.status === 503 && r.json?.code === "STORAGE_UNAVAILABLE", `${r.status} ${r.text.slice(0, 160)}`);
      t("blob-refuses: the provider's message (which echoed the token) is NOT in the response", !r.text.includes("FAKEFAKE") && !r.text.includes("private access"));
      t("blob-refuses: nor in the server log", !s.logs().includes("FAKEFAKE"));
      t("blob-refuses: no rows were created", JSON.stringify(await counts(s)) === JSON.stringify(before));
      const diag = await (await fetch(`${s.base}/api/files/storage-status?probe=1`, { headers: { cookie } })).json();
      t("blob-refuses: admin probe reports backend=blob, writable=false, and never the token", diag.backend === "blob" && diag.writable === false && !JSON.stringify(diag).includes("FAKEFAKE"), JSON.stringify(diag));
    } finally {
      await s.stop();
      mock.close();
    }
  }

  // ---- 6. Blob healthy: success, orphan cleanup on DB failure, platform size cap ---------------------
  {
    const mock = await startBlobMock("ok");
    const s = await startServer({ BLOB_READ_WRITE_TOKEN: FAKE_TOKEN, VERCEL_BLOB_API_URL: mock.url, VERCEL: "1" });
    try {
      const { cookie } = await login(s.base, ADMIN);
      const before = await counts(s);
      const good = await upload(s.base, cookie, PNG_1x1);
      t("blob-ok: a valid upload is 201", good.status === 201, `${good.status} ${good.text.slice(0, 140)}`);
      t("blob-ok: exactly one blob PUT reached storage", mock.seen.filter((l) => l.startsWith("PUT")).length === 1, mock.seen.join(","));
      const afterGood = await counts(s);
      t("blob-ok: one StoredFile + one GalleryItem", afterGood.files === before.files + 1 && afterGood.items === before.items + 1);

      mock.seen.length = 0;
      const bad = await upload(s.base, cookie, PNG_1x1, { extra: { projectId: "no-such-project" } });
      t("blob-ok: a DB rejection after the blob write is a 4xx", bad.status >= 400 && bad.status < 500, `${bad.status}`);
      t("blob-ok: the already-written blob was deleted again (no orphan)", mock.seen.some((l) => l.startsWith("POST") && l.includes("/delete")), mock.seen.join(","));
      t("blob-ok: and no row was left behind", JSON.stringify(await counts(s)) === JSON.stringify(afterGood));

      const big = await upload(s.base, cookie, pngOfSize(4 * 1024 * 1024 + 4096));
      t("blob-ok: on Vercel an image just over 4 MB is our JSON 413 (below the platform's 4.5 MB wall)", big.status === 413 && /too large/i.test(big.json?.error ?? ""), `${big.status} ${big.text.slice(0, 100)}`);
      const fits = await upload(s.base, cookie, pngOfSize(4 * 1024 * 1024 - 8192));
      t("blob-ok: an image just under 4 MB is accepted", fits.status === 201, `${fits.status} ${fits.text.slice(0, 100)}`);
    } finally {
      await s.stop();
      mock.close();
    }
  }

  console.log(`\n${ok} gallery-upload checks passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
