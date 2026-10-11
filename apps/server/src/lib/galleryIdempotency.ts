import type { Request } from "express";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_KEY_PATTERN } from "@scl/shared";
import { createHash } from "node:crypto";
import { prisma } from "./prisma.js";
import { HttpError } from "./validate.js";

/**
 * Idempotency for the two gallery upload requests (`POST /api/gallery` creates an entry,
 * `POST /api/gallery/:id/images` appends an image). A client generates one key per logical image
 * upload and re-sends it when it retries that image — typically because the first response was lost
 * after the server had already committed. The key is persisted in `GalleryUploadAttempt`, inserted in
 * the SAME transaction as the entry/image it describes, under `@@unique([userId, key])`, so:
 *   - a retry (or a concurrent duplicate) resolves to the ORIGINAL entry instead of creating another;
 *   - keys are scoped to the authenticated account, so one account can never see or reuse another's;
 *   - the stored operation (CREATE | APPEND), target entry and image checksum bind a key to what it
 *     first did — reusing it for a different operation, entry or image is a 409.
 * No in-memory state is involved: any server instance sees the same table.
 */

export type UploadOperation = "CREATE" | "APPEND";

/** The request's Idempotency-Key, or null when the header is absent (behaviour then unchanged). */
export function readIdempotencyKey(req: Request): string | null {
  const raw = req.get(IDEMPOTENCY_KEY_HEADER);
  if (raw === undefined) return null;
  if (!IDEMPOTENCY_KEY_PATTERN.test(raw)) throw new HttpError(400, `${IDEMPOTENCY_KEY_HEADER} must be 16-64 characters: letters, digits, "-" or "_".`);
  return raw;
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The entry id a previous, COMPLETED attempt with this key stored its image in, or null if the key is
 * unused. Throws 409 if the key was first used for a different operation, another entry, or another
 * image. `db` may be the transaction client (re-check inside the write transaction).
 */
export async function findCompletedAttempt(
  db: Pick<typeof prisma, "galleryUploadAttempt">,
  userId: string,
  key: string,
  operation: UploadOperation,
  targetItemId: string | null,
  sha256: string,
): Promise<string | null> {
  const row = await db.galleryUploadAttempt.findUnique({ where: { userId_key: { userId, key } } });
  if (!row) return null;
  if (row.operation !== operation || (operation === "APPEND" && row.itemId !== targetItemId) || row.sha256 !== sha256) {
    throw new HttpError(409, `This ${IDEMPOTENCY_KEY_HEADER} was already used for a different upload. Use a new key for a new image.`);
  }
  return row.itemId;
}

/** A unique-constraint violation (P2002) — the signature of a concurrent duplicate losing the race. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}
