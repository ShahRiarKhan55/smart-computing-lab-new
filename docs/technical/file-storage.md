# File uploads and media storage

## What can be uploaded

| Upload | Endpoint | Who | Notes |
|---|---|---|---|
| Generic file | `POST /api/files` | any signed-in account | images and PDFs |
| Gallery item (one or more images) | `POST /api/gallery`, `POST /api/gallery/:id/images` | any signed-in account creates; owner or manager adds images | up to 10 images per batch (`GALLERY_BATCH_MAX_FILES`); categories Lab life, Event, Research, Other |
| Own profile photo | `POST /api/profile/photo` | the profile's own account | shown on the Team page and profile |

Allowed types: JPEG, PNG, WebP and GIF images, and PDF documents (`packages/shared/src/schemas/files.ts`). Default size limits: **5 MB** per image and **15 MB** per document, overridable with `MAX_IMAGE_BYTES` and `MAX_DOCUMENT_BYTES`. Animated GIF, animated WebP and APNG images are rejected.

## Image handling

Uploaded still images are stripped of metadata (EXIF, XMP, IPTC, comments, thumbnails) by an allowlist-based, lossless rewriter (`apps/server/src/lib/imageSanitize.ts`). Pixels are never re-encoded. A valid EXIF orientation is preserved so phone photos stay upright. Malformed or ambiguous images are rejected rather than guessed at. File signatures are checked against the declared type (`fileSignature.ts`).

## Where files live

| Environment | Backend | Selected by |
|---|---|---|
| Local development | files on disk under `apps/server/storage/files` (or `STORAGE_DIR`) | no Blob token set |
| Production (Vercel) | a **private** Vercel Blob store | `LAB_BLOB_READ_WRITE_TOKEN` (preferred) or `BLOB_READ_WRITE_TOKEN` is set and not blank |

Metadata (owner, type, size, visibility, the opaque `storageKey`) is in the `StoredFile` table; the bytes are in the storage backend. File names and paths supplied by users are never used for storage.

Files are **not** served directly by the storage backend or by `express.static`. Browsers receive them through `GET /api/files/:id`, which enforces `PUBLIC` or `LAB_ONLY` visibility and answers 404 otherwise. API responses are `no-store` by default; a route may set its own caching (public files do).

## Operational notes

- A Vercel function's filesystem is read-only, so production uploads need the Blob backend. Without a Blob token, `POST /api/files` and `POST /api/gallery` answer a controlled **503** ("File storage is not available right now…") and the rest of the site keeps working.
- The app writes every file with private access, which works only against a **Private** Blob store. A project that also has an older Public store keeps that store's token in `BLOB_READ_WRITE_TOKEN`, which is why `LAB_BLOB_READ_WRITE_TOKEN` exists. Never print or log either value; changing one affects new deployments only.
- `npm run storage:reconcile -w apps/server` finds and reports orphaned blobs and rows.
- Failed or abandoned gallery uploads are cleaned up by `galleryBlobCleanup.ts`.

Design records: [`docs/architecture/phase13-files-and-gallery.md`](../architecture/phase13-files-and-gallery.md).
