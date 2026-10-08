/**
 * Unit checks for the upload-storage classification added for the gallery-upload incident
 * (Phase 27 / P27.10): `getStorageStatus`, the `StorageUnavailableError` mapping in `saveFile`,
 * and the "a failed root is retried, not cached" fix in `ensureRoot`. Runs against a throwaway
 * directory only — no network, no Blob, no database.
 *
 *   npm run test:unit -w apps/server
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));

const work = mkdtempSync(path.join(tmpdir(), "scl-storage-unit-"));
const blocker = path.join(work, "blocker"); // a regular FILE standing where a directory must be created
writeFileSync(blocker, "x");
process.env.STORAGE_DIR = path.join(blocker, "files"); // mkdir under a file -> ENOTDIR (EROFS-class failure)
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.VERCEL;

const storage = await import("../src/lib/storage.js");

try {
  // ---- status ---------------------------------------------------------------------------------
  t("local dev (no token, not Vercel): configured local backend", JSON.stringify(storage.getStorageStatus()) === JSON.stringify({ backend: "local", configured: true, issue: null }));
  process.env.VERCEL = "1";
  const vercelNoToken = storage.getStorageStatus();
  t("Vercel without a token: NOT configured, and the issue names the missing variable", vercelNoToken.configured === false && /BLOB_READ_WRITE_TOKEN/.test(vercelNoToken.issue ?? ""));
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_UNIT_secretsecret";
  const blob = storage.getStorageStatus();
  t("Vercel with a token: configured blob backend", blob.backend === "blob" && blob.configured === true && blob.issue === null);
  t("the status object never contains the token", !JSON.stringify(blob).includes("secretsecret"));
  delete process.env.BLOB_READ_WRITE_TOKEN;

  // ---- classification --------------------------------------------------------------------------
  let err: unknown;
  try {
    await storage.saveFile(Buffer.from([1]));
  } catch (e) {
    err = e;
  }
  t("not configured: saveFile throws StorageUnavailableError(STORAGE_NOT_CONFIGURED) before touching the disk", err instanceof storage.StorageUnavailableError && (err as { code: string }).code === "STORAGE_NOT_CONFIGURED");
  t("not configured: nothing was created on disk", !existsSync(process.env.STORAGE_DIR!));

  delete process.env.VERCEL;
  err = undefined;
  try {
    await storage.saveFile(Buffer.from([1]));
  } catch (e) {
    err = e;
  }
  const detail = (err as { detail?: string }).detail ?? "";
  t("unwritable root: saveFile throws StorageUnavailableError(STORAGE_UNAVAILABLE)", err instanceof storage.StorageUnavailableError && (err as { code: string }).code === "STORAGE_UNAVAILABLE", String(err));
  t("unwritable root: the detail carries the errno code but not the path", /code=ENOTDIR/.test(detail) && !detail.includes(work), detail);
  t("unwritable root: the public message is generic", !/ENOTDIR|blocker/.test((err as Error).message));

  // ---- retry: the failure must not be cached forever --------------------------------------------
  rmSync(blocker);
  let key: string | null = null;
  try {
    key = await storage.saveFile(Buffer.from([1, 2, 3]));
  } catch (e) {
    failures.push(`retry after the root became creatable still failed: ${String(e)}`);
  }
  t("after the root becomes creatable, the very next write succeeds (a rejected mkdir is not cached)", key !== null && (await storage.fileExists(key)));
  if (key) await storage.removeFile(key);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${ok} storage unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
