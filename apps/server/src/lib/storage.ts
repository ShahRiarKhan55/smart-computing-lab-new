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
 * TWO BACKENDS, selected once at module load by whether `BLOB_READ_WRITE_TOKEN` is set (the same
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

const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

let rootReady: Promise<void> | null = null;
async function ensureRoot(): Promise<void> {
  if (!rootReady) rootReady = mkdir(STORAGE_ROOT, { recursive: true }).then(() => undefined);
  await rootReady;
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
  const key = generateStorageKey();

  if (USE_BLOB) {
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
  if (USE_BLOB) {
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
  if (USE_BLOB) {
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
  if (USE_BLOB) {
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
