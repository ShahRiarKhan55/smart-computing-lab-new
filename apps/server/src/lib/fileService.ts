import multer from "multer";
import { ALLOWED_MIME_TYPES, DEFAULT_DOCUMENT_MAX_BYTES, DEFAULT_IMAGE_MAX_BYTES, ORIGINAL_NAME_MAX, isImageMime } from "@scl/shared";
import { HttpError } from "./validate.js";
import { sniffMimeType } from "./fileSignature.js";

/**
 * Upload configuration + validation, reused by every upload route (Phase 13 §"upload
 * security"/§"file size limits"/§"MIME/file type policy"). Never trust the client's declared
 * filename, extension or `Content-Type` — see `validateUpload`, which is the one place every
 * route funnels through.
 */

/** Env-configurable; falls back to the documented defaults in @scl/shared (see .env.example). */
function envBytes(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
/**
 * Vercel Functions reject any request body over 4.5 MB at the platform edge, BEFORE this app runs,
 * with a plain-text (non-JSON) 413. Capping our own limit just below it means an oversized upload
 * gets this app's clean JSON 413 and message instead of an opaque platform error. Elsewhere there is
 * no such cap, so the documented defaults apply unchanged.
 */
export const PLATFORM_UPLOAD_CAP_BYTES = process.env.VERCEL ? 4 * 1024 * 1024 : Number.POSITIVE_INFINITY;
export const IMAGE_MAX_BYTES = Math.min(envBytes("MAX_IMAGE_BYTES", DEFAULT_IMAGE_MAX_BYTES), PLATFORM_UPLOAD_CAP_BYTES);
export const DOCUMENT_MAX_BYTES = Math.min(envBytes("MAX_DOCUMENT_BYTES", DEFAULT_DOCUMENT_MAX_BYTES), PLATFORM_UPLOAD_CAP_BYTES);
const HARD_CAP_BYTES = Math.max(IMAGE_MAX_BYTES, DOCUMENT_MAX_BYTES);

/**
 * Shared multer instance: memory storage (uploads are small and bounded by `HARD_CAP_BYTES`, so
 * this never buffers an unbounded amount — see docs §"rate/resource protection"), exactly one
 * file per request, a hard cap enforced by multer itself before the category-specific limit is
 * re-checked in `validateUpload` (the real mime type, from magic bytes, is only known after
 * parsing). A malformed multipart body is rejected by multer with a 4xx before it reaches any
 * route handler (see the error middleware in app.ts).
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HARD_CAP_BYTES, files: 1, fields: 20, parts: 25 },
});
export const uploadSingleFile = upload.single("file");

/** Readable message for a multer failure (oversized body, too many files, ...); null if `err`
 *  is not a multer error at all. */
export function multerErrorMessage(err: unknown): string | null {
  if (!(err instanceof multer.MulterError)) return null;
  if (err.code === "LIMIT_FILE_SIZE") return "File is too large.";
  if (err.code === "LIMIT_UNEXPECTED_FILE") return "Only one file may be uploaded at a time, using the \"file\" field.";
  return "The upload could not be read.";
}

/**
 * Sanitizes a client-supplied display name into metadata-only text: strips any path component
 * (so `../../secret.txt`, `C:\Windows\System32\...` or `/etc/passwd` becomes just the trailing
 * segment) and control characters, and caps the length. The result is NEVER used to build a
 * filesystem path (see lib/storage.ts, which only ever uses a server-generated key) — only as
 * the original-name column and a download's `Content-Disposition` filename.
 */
export function sanitizeOriginalName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  // eslint-disable-next-line no-control-regex -- deliberately stripping control characters, incl. NUL
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned.length > 0 ? cleaned : "file").slice(0, ORIGINAL_NAME_MAX);
}

export interface ValidatedUpload {
  buffer: Buffer;
  mimeType: (typeof ALLOWED_MIME_TYPES)[number];
  originalName: string;
  sizeBytes: number;
}

/**
 * The one place every upload route validates a parsed multer file. Authoritative check is the
 * file's real bytes (magic-byte signature, `sniffMimeType`) — never the client's declared
 * `Content-Type` and never the filename/extension, both of which are trivially spoofable. A
 * file claiming to be a JPEG that is actually an executable, script or arbitrary binary fails
 * here because its bytes don't match any allowed signature, regardless of what it was named.
 * Throws `HttpError` (400 unsupported type, 413 too large) rather than returning a result the
 * caller could forget to check.
 */
export function validateUpload(file: { buffer: Buffer; size: number; originalname: string }): ValidatedUpload {
  const sniffed = sniffMimeType(file.buffer);
  if (!sniffed) {
    throw new HttpError(400, "Unsupported or unrecognised file type. Allowed: JPEG, PNG, WEBP, GIF images and PDF documents.");
  }
  const limit = isImageMime(sniffed) ? IMAGE_MAX_BYTES : DOCUMENT_MAX_BYTES;
  if (file.size > limit) {
    throw new HttpError(413, `File is too large (max ${(limit / (1024 * 1024)).toFixed(1)} MB for this file type).`);
  }
  return { buffer: file.buffer, mimeType: sniffed, originalName: sanitizeOriginalName(file.originalname), sizeBytes: file.size };
}

/** Extra gate for endpoints that only ever accept an image (the gallery never stores a PDF). */
export function assertIsImage(upload: ValidatedUpload): void {
  if (!isImageMime(upload.mimeType)) throw new HttpError(400, "Only image files (JPEG, PNG, WEBP, GIF) are accepted here.");
}
