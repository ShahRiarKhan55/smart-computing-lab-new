import { createReadStream } from "node:fs";
import type { ReadStream } from "node:fs";
import { mkdir, open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Low-level blob storage for uploaded files (Phase 13). Bytes are METADATA-FREE: SQLite only
 * ever holds a `StoredFile` row (see schema.prisma "Files + gallery"), never the bytes
 * themselves. `STORAGE_ROOT` sits outside `apps/web/dist` and is never mounted by
 * `express.static` — the only way to read a blob back is the authorization-aware
 * `GET /api/files/:id` route (routes/files.routes.ts). Configurable via `STORAGE_DIR` (see
 * .env.example); defaults to `apps/server/storage/files`.
 *
 * Every physical filename is a server-generated opaque key (`generateStorageKey`, a v4 UUID),
 * never derived from user input. A hostile `originalName` (`../../secret.txt`,
 * `C:\Windows\System32\...`, `/etc/passwd`, a null byte, `<script>...`) never reaches the
 * filesystem — it is display/metadata only (see fileService.ts `sanitizeOriginalName`) and is
 * never passed to any function in this module.
 */

const DEFAULT_ROOT = path.join(process.cwd(), "storage", "files");
export const STORAGE_ROOT = path.resolve(process.env.STORAGE_DIR || DEFAULT_ROOT);

let rootReady: Promise<void> | null = null;
async function ensureRoot(): Promise<void> {
  if (!rootReady) rootReady = mkdir(STORAGE_ROOT, { recursive: true }).then(() => undefined);
  await rootReady;
}

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Opaque, unguessable, filesystem-safe: a v4 UUID. Never contains "/", "\\", "." or "..". */
export function generateStorageKey(): string {
  return randomUUID();
}

/**
 * Resolves a storage key to its on-disk path. Refuses anything that is not itself a bare v4
 * UUID and re-checks the resolved path's parent directory, so even a key that somehow bypassed
 * every upstream check (it never legitimately could — every key is server-generated) cannot
 * escape `STORAGE_ROOT` via `../`, an absolute path, a UNC path, or a URL-encoded separator.
 */
function pathFor(storageKey: string): string {
  if (!KEY_PATTERN.test(storageKey)) throw new Error(`Refusing to resolve an invalid storage key: ${JSON.stringify(storageKey)}`);
  const resolved = path.join(STORAGE_ROOT, storageKey);
  if (path.dirname(resolved) !== STORAGE_ROOT) throw new Error("Storage path escaped the storage root.");
  return resolved;
}

/**
 * Writes `bytes` under a freshly generated key and returns it. Uses the `wx` flag (fails if the
 * key already exists) rather than overwriting — a collision should be structurally impossible
 * with a v4 UUID, so treat one as a bug rather than silently clobbering another file.
 */
export async function saveFile(bytes: Buffer): Promise<string> {
  await ensureRoot();
  const key = generateStorageKey();
  const handle = await open(pathFor(key), "wx");
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
  return key;
}

/** A readable stream of the blob. Throws (ENOENT) if the key does not exist on disk. */
export function openReadStream(storageKey: string): ReadStream {
  return createReadStream(pathFor(storageKey));
}

export async function fileExists(storageKey: string): Promise<boolean> {
  try {
    await stat(pathFor(storageKey));
    return true;
  } catch {
    return false;
  }
}

/** Best-effort delete: a blob that is already gone is not an error. */
export async function removeFile(storageKey: string): Promise<void> {
  try {
    await unlink(pathFor(storageKey));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
