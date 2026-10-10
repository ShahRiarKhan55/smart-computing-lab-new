/**
 * Unit test of the "storage unavailable" handling in lib/storage.ts: a production Vercel runtime
 * without BLOB_READ_WRITE_TOKEN, and the filesystem errors that mean "storage unavailable". No
 * server, no database; a disposable temp directory stands in for STORAGE_DIR.
 *   npm run test:unit -w apps/server
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

// storage.ts reads STORAGE_DIR / BLOB_READ_WRITE_TOKEN once, at import: set them first.
const dir = mkdtempSync(path.join(tmpdir(), "scl-storage-unavailable-test-"));
process.env.STORAGE_DIR = dir;
delete process.env.BLOB_READ_WRITE_TOKEN;
const { StorageUnavailableError, asStorageUnavailable, isPersistentStorageUnavailable, saveFile, removeFile } = await import("../src/lib/storage.js");
const { HttpError } = await import("../src/lib/validate.js");

// ---- isPersistentStorageUnavailable ------------------------------------------------
t("prod + Vercel + no token -> unavailable", isPersistentStorageUnavailable({ NODE_ENV: "production", VERCEL: "1" }) === true);
t("prod + Vercel + empty token -> unavailable", isPersistentStorageUnavailable({ NODE_ENV: "production", VERCEL: "1", BLOB_READ_WRITE_TOKEN: "" }) === true);
t("prod + Vercel + token -> available (Blob path)", isPersistentStorageUnavailable({ NODE_ENV: "production", VERCEL: "1", BLOB_READ_WRITE_TOKEN: "x" }) === false);
t("prod without Vercel (self-hosted) -> available", isPersistentStorageUnavailable({ NODE_ENV: "production" }) === false);
t("development on Vercel (vercel dev) -> available", isPersistentStorageUnavailable({ NODE_ENV: "development", VERCEL: "1" }) === false);
t("empty environment -> available", isPersistentStorageUnavailable({}) === false);

// ---- the typed error -----------------------------------------------------------------
const e = new StorageUnavailableError("EROFS");
t("StorageUnavailableError is an HttpError", e instanceof HttpError && e instanceof Error);
t("StorageUnavailableError carries status 503", e.status === 503);
t("StorageUnavailableError keeps an internal reason", e.reason === "EROFS");
t("StorageUnavailableError message is safe (no path, code, stack or secret-like text)", !/[\\/]|EROFS|ENOENT|storage\/|stack|token|BLOB|TURSO/i.test(e.message) && e.message.length > 10);

// ---- which filesystem errors are mapped ----------------------------------------------
const withCode = (code?: string) => Object.assign(new Error("boom"), code ? { code } : {});
for (const code of ["EROFS", "EACCES", "EPERM", "ENOSPC"]) {
  const m = asStorageUnavailable(withCode(code));
  t(`${code} -> StorageUnavailableError(${code})`, m instanceof StorageUnavailableError && m.reason === code && m.status === 503);
}
for (const code of ["ENOENT", "EEXIST", "ENOTDIR", "EINVAL", "EISDIR", "EMFILE", "ECONNRESET"]) {
  t(`${code} is NOT mapped (stays an unexpected error)`, asStorageUnavailable(withCode(code)) === null);
}
t("an error with no code is not mapped", asStorageUnavailable(new Error("x")) === null);
t("null / undefined / strings are not mapped", asStorageUnavailable(null) === null && asStorageUnavailable(undefined) === null && asStorageUnavailable("EROFS") === null);

// ---- saveFile: local development behaviour is unchanged -------------------------------
delete process.env.VERCEL;
process.env.NODE_ENV = "development";
const bytes = Buffer.from("hello storage");
const key = await saveFile(bytes);
t("saveFile (development) returns a v4-UUID key", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key));
t("saveFile (development) writes the bytes under STORAGE_DIR", existsSync(path.join(dir, key)) && readFileSync(path.join(dir, key)).equals(bytes));
await removeFile(key);
t("removeFile deletes it", !existsSync(path.join(dir, key)));

// ---- saveFile: production on Vercel without a token refuses cleanly, touching nothing --
const before = readdirSync(dir).length;
process.env.NODE_ENV = "production";
process.env.VERCEL = "1";
const origError = console.error;
const logged: string[] = [];
console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
let thrown: unknown;
try {
  await saveFile(bytes);
} catch (err) {
  thrown = err;
} finally {
  console.error = origError;
  process.env.NODE_ENV = "development";
  delete process.env.VERCEL;
}
t("saveFile (prod, Vercel, no token) rejects with StorageUnavailableError", thrown instanceof StorageUnavailableError);
t("... status 503, reason no-persistent-backend", (thrown as InstanceType<typeof StorageUnavailableError>)?.status === 503 && (thrown as InstanceType<typeof StorageUnavailableError>)?.reason === "no-persistent-backend");
t("... writes nothing to the storage directory", readdirSync(dir).length === before);
t("... logs a server-side reason without any path or secret", logged.length === 1 && !logged[0].includes(dir) && !/TURSO|SECRET|password/i.test(logged[0]));

rmSync(dir, { recursive: true, force: true });
console.log(`${ok} storage-unavailable unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
