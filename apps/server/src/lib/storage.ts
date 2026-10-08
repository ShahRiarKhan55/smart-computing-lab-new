import { createReadStream } from "node:fs";
import { mkdir, open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { del, get, head, put } from "@vercel/blob";

/**
 * Low-level blob storage for uploaded files (Phase 13; Vercel deployment adapter). Bytes are
 * METADATA-FREE: SQLite only ever holds a `StoredFile` row (see schema.prisma "Files + gallery"),
 * never the bytes themselves. The only way to read a blob back is the authorization-aware
 * `GET /api/files/:id` route (routes/files.routes.ts) — this module never hands a client-facing
 * URL to a caller; every function here returns/accepts only the same opaque server-generated key
 * (`generateStorageKey`, a v4 UUID) regardless of which backend is active.
 *
 * TWO BACKENDS, selected by whether `BLOB_READ_WRITE_TOKEN` is set (read at call time via `useBlob()`) (the same
 * env var Vercel itself sets automatically when Blob storage is attached to a project, and the
 * same one `@vercel/blob`'s own functions read by default — this module doesn't invent a second
 * flag to mean the same thing):
 *
 * - **Unset (local development — the existing behavior, unchanged)**: plain files under
 *   `STORAGE_ROOT` (`STORAGE_DIR` env var; defaults to `apps/server/storage/files`), outside
 *   `apps/web/dist` and never mounted by `express.static`.
 * - **Set (Vercel production)**: Vercel Blob (`@vercel/blob`). Every blob is written with
 *   `access: "private"` (requires the read-write token to fetch back — not a guessable-URL-is-the-
 *   only-protection model) and `addRandomSuffix: false` (the pathname stays exactly the
 *   `storageKey` UUID, so no second identifier needs to be persisted anywhere — `StoredFile.
 *   storageKey` keeps meaning exactly what it always meant: "the opaque key that addresses this
 *   blob," now in whichever backend is active). The raw Blob URL is never sent to a browser; the
 *   server always fetches the bytes itself (see `openReadStream`) and streams them through the
 *   same authorization-checked route as the local-filesystem backend always has.
 *
 * A hostile `originalName` (`../../secret.txt`, `C:\Windows\System32\...`, `/etc/passwd`, a null
 * byte, `<script>...`) never reaches either backend — it is display/metadata only (see
 * fileService.ts `sanitizeOriginalName`) and is never passed to any function in this module.
 *
 * NOTE: `lib/storageReconcile.ts` (the orphan-blob diagnostic CLI) reads `STORAGE_ROOT` and walks
 * the local filesystem directly — it is a local-filesystem-only tool and does not apply when the
 * Blob backend is active. See that module's own comment.
 */

const DEFAULT_ROOT = path.join(process.cwd(), "storage", "files");
export const STORAGE_ROOT = path.resolve(process.env.STORAGE_DIR || DEFAULT_ROOT);

/** Read at call time (not module load) so the backend choice is testable; the value never changes in a real process. */
const useBlob = (): boolean => !!process.env.BLOB_READ_WRITE_TOKEN;

/**
 * Raised when the storage backend cannot accept a write: not configured for this deployment, or
 * the backend refused/failed. It carries NO provider message (those can echo request details), only
 * a stable `code` and a sanitized `detail` (error class + errno/HTTP status) that is safe to log.
 * The error handler in app.ts turns it into a structured 503 instead of an opaque 500.
 */
export class StorageUnavailableError extends Error {
  readonly code: "STORAGE_NOT_CONFIGURED" | "STORAGE_UNAVAILABLE";
  readonly detail: string;
  constructor(code: StorageUnavailableError["code"], detail: string) {
    super(code === "STORAGE_NOT_CONFIGURED" ? "Upload storage is not configured." : "Upload storage is temporarily unavailable.");
    this.name = "StorageUnavailableError";
    this.code = code;
    this.detail = detail;
  }
}

function describeStorageFailure(err: unknown): string {
  const e = err as { name?: string; code?: string; status?: number; statusCode?: number } | null;
  const parts = [e?.name ?? "Error"];
  if (e?.code) parts.push(`code=${e.code}`);
  const status = e?.status ?? e?.statusCode;
  if (status) parts.push(`status=${status}`);
  return parts.join(" ");
}

export interface StorageStatus {
  backend: "blob" | "local";
  configured: boolean;
  /** Human-readable, secret-free reason when `configured` is false. */
  issue: string | null;
}

/**
 * Whether writes can possibly succeed in this deployment. On Vercel the function filesystem is
 * read-only and per-instance, so the local-filesystem backend can never durably store a file there:
 * without `BLOB_READ_WRITE_TOKEN` every upload would fail deep inside `mkdir`/`open`. Reporting that
 * up front (and refusing before touching the disk) turns an opaque 500 into an actionable 503.
 */
export function getStorageStatus(): StorageStatus {
  if (useBlob()) return { backend: "blob", configured: true, issue: null };
  if (process.env.VERCEL) {
    return {
      backend: "local",
      configured: false,
      issue: "BLOB_READ_WRITE_TOKEN is not set. Vercel Functions have a read-only, non-persistent filesystem, so uploads need Vercel Blob storage attached to this project.",
    };
  }
  return { backend: "local", configured: true, issue: null };
}

/**
 * Admin diagnostic: writes and deletes a one-byte object to prove the active backend accepts writes.
 * Never returns provider error text — only the sanitized detail.
 */
export async function probeStorage(): Promise<StorageStatus & { writable: boolean; detail: string | null }> {
  const status = getStorageStatus();
  if (!status.configured) return { ...status, writable: false, detail: status.issue };
  try {
    const key = await saveFile(Buffer.from([0]));
    await removeFile(key);
    return { ...status, writable: true, detail: null };
  } catch (err) {
    return { ...status, writable: false, detail: err instanceof StorageUnavailableError ? `${err.code}: ${err.detail}` : describeStorageFailure(err) };
  }
}

let rootReady: Promise<void> | null = null;
async function ensureRoot(): Promise<void> {
  if (!rootReady) rootReady = mkdir(STORAGE_ROOT, { recursive: true }).then(() => undefined);
  try {
    await rootReady;
  } catch (err) {
    rootReady = null; // never cache a failure: a fixed/remounted root must be retried
    throw err;
  }
}

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Opaque, unguessable, backend-agnostic: a v4 UUID. Never contains "/", "\\", "." or "..". */
export function generateStorageKey(): string {
  return randomUUID();
}

/**
 * Resolves a storage key to its on-disk path (local-filesystem backend only). Refuses anything
 * that is not itself a bare v4 UUID and re-checks the resolved path's parent directory, so even a
 * key that somehow bypassed every upstream check (it never legitimately could — every key is
 * server-generated) cannot escape `STORAGE_ROOT` via `../`, an absolute path, a UNC path, or a
 * URL-encoded separator.
 */
function pathFor(storageKey: string): string {
  if (!KEY_PATTERN.test(storageKey)) throw new Error(`Refusing to resolve an invalid storage key: ${JSON.stringify(storageKey)}`);
  const resolved = path.join(STORAGE_ROOT, storageKey);
  if (path.dirname(resolved) !== STORAGE_ROOT) throw new Error("Storage path escaped the storage root.");
  return resolved;
}

/**
 * Writes `bytes` under a freshly generated key and returns it.
 *
 * Local backend: uses the `wx` flag (fails if the key already exists) rather than overwriting — a
 * collision should be structurally impossible with a v4 UUID, so treat one as a bug rather than
 * silently clobbering another file. Blob backend: `allowOverwrite` is left at its default `false`
 * for the identical reason — `put()` throws rather than overwrites on a collision.
 */
export async function saveFile(bytes: Buffer): Promise<string> {
  const status = getStorageStatus();
  if (!status.configured) throw new StorageUnavailableError("STORAGE_NOT_CONFIGURED", status.issue ?? "storage not configured");

  const key = generateStorageKey();
  try {
    if (status.backend === "blob") {
      await put(key, bytes, { access: "private", addRandomSuffix: false });
      return key;
    }

    await ensureRoot();
    const handle = await open(pathFor(key), "wx");
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    return key;
  } catch (err) {
    // Any backend failure (EROFS/EACCES/ENOSPC on disk; a Blob auth, access-mode or network error)
    // becomes one classified error with a sanitized detail — never the provider's own message.
    throw new StorageUnavailableError("STORAGE_UNAVAILABLE", `${status.backend} write failed: ${describeStorageFailure(err)}`);
  }
}

/**
 * A readable stream of the blob. Throws (ENOENT-coded) if the key does not exist.
 *
 * Async on both backends, even though the local-filesystem read itself is synchronous-to-start —
 * a single, consistent signature for the one call site (`routes/files.routes.ts`) rather than a
 * backend-aware branch outside this module. The Blob backend's `get()` is inherently a network
 * fetch (there is no way to synchronously open a stream to a remote resource), so a Promise-
 * returning signature is what the fetch actually needs, and reusing that same signature for the
 * local backend means one `await openReadStream(...)` at the call site works for both.
 */
export async function openReadStream(storageKey: string): Promise<Readable> {
  if (useBlob()) {
    // statusCode 200 vs 304 is a discriminated union in the SDK's types (304 -> stream: null),
    // relevant only when a caller passes `ifNoneMatch` — this call never does, so 200 is the only
    // reachable branch; the explicit check narrows the type rather than asserting past it.
    const result = await get(storageKey, { access: "private" });
    if (!result || result.statusCode !== 200) {
      const err = new Error(`Blob not found for storage key: ${storageKey}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    // `get()`'s stream is a Web ReadableStream (it's a fetch response body); the call site
    // (`files.routes.ts`) pipes into an Express `res`, which needs a Node Readable — `Readable.
    // fromWeb` is the standard, built-in conversion between the two, not a hand-rolled adapter.
    return Readable.fromWeb(result.stream);
  }
  return createReadStream(pathFor(storageKey));
}

export async function fileExists(storageKey: string): Promise<boolean> {
  if (useBlob()) {
    try {
      await head(storageKey);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await stat(pathFor(storageKey));
    return true;
  } catch {
    return false;
  }
}

/** Best-effort delete: a blob that is already gone is not an error, on either backend. */
export async function removeFile(storageKey: string): Promise<void> {
  if (useBlob()) {
    try {
      await del(storageKey);
    } catch {
      // Best-effort, matching the local-filesystem branch below: a blob that's already gone (or
      // a transient delete failure for one this app is about to lose track of anyway, since the
      // DB row that named it is already committed as deleted by the caller) is not fatal here.
    }
    return;
  }
  try {
    await unlink(pathFor(storageKey));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
