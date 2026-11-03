# 09. File storage and media

## Where files live (VERIFIED)
| Environment | Backend | Selection |
|---|---|---|
| Local, tests | files on the application's disk under `apps/server/storage/files` (or `STORAGE_DIR`) | no Blob token set |
| Production | **Vercel Blob, private store** | `LAB_BLOB_READ_WRITE_TOKEN` (preferred) or `BLOB_READ_WRITE_TOKEN` set and non-blank (`lib/storage.ts`) |

Files are **not** in the database or the application filesystem in production. The database holds only metadata (`StoredFile`: opaque `storageKey`, original name, MIME, size, owner, visibility, `deletedAt`, optional entity link). Browsers never get a Blob URL: they use `GET /api/files/:id`, which streams the file after a visibility check.

## Upload mechanisms
| Upload | Route | Who |
|---|---|---|
| Generic file | `POST /api/files` | any signed-in account |
| Gallery item and extra images (one image per request) | `POST /api/gallery`, `POST /api/gallery/:id/images` | any member creates; owner or manager appends |
| Profile photo | `POST /api/profile/photo` | the profile's own account |

Pipeline (doc 03 diagram 6): multer in-memory, one file, size cap (`fileService.ts:30-32`) → magic-byte sniffing against the allow-list JPEG, PNG, WebP, GIF, PDF (`fileSignature.ts:11`; the client's declared type and file extension are ignored) → size limit by type (5 MB images, 15 MB PDF, overridable by `MAX_IMAGE_BYTES`/`MAX_DOCUMENT_BYTES`) → file name sanitised for display only → random UUID storage key (`storage.ts:111-127`) → metadata row and audit row in one transaction; the blob is deleted again if the transaction fails (`files.routes.ts:75-77`).

## Validation and malicious files
- **Type validation:** content-based; SVG, HTML, scripts and archives are not allow-listed. VERIFIED.
- **Metadata:** only **profile photos** are rewritten by the lossless sanitiser that removes EXIF/XMP/IPTC and rejects animated or malformed images (`routes/profile.routes.ts:128`, `lib/imageSanitize.ts:664`). Gallery and generic uploads are stored as received (F-05).
- **Path traversal:** impossible through names; keys are UUIDs validated by a pattern before any path is built.
- **Malware:** no scanning (F-11). PDFs are served as `attachment` with `X-Content-Type-Options: nosniff`; images inline.
- **Size/abuse:** per-request caps; no per-user quota (F-14).

## Access control and URLs
`GET /api/files/:id`: `canAccessFile` (own visibility and the parent record's visibility, for example an unpublished alumni photo). Unauthorised or deleted answers 404. Public files: `Cache-Control: public, max-age=3600`; everything else `private, no-store` (F-10). Stored photo URLs look like `/api/files/<id>`.

## Deletion
`DELETE /api/files/:id`: owner or manager (gallery files must be deleted through the gallery item). The row is soft-deleted (`deletedAt`) and the blob removed; failures to remove the blob are logged and leave an orphan. `npm run storage:reconcile -w apps/server` finds orphans. Profile photo replacement retires the old file in the same transaction.

## Storage unavailable
If no persistent backend is configured (no Blob token on Vercel), upload routes answer a controlled **503** "File storage is not available right now" and the rest of the site works (`storage.ts:149,165`). If Blob itself is down, existing images fail to load (the API answers 404 when the stream errors, `files.routes.ts:110-113`) while the rest of the page renders.

## Backup implications
Blob content is **not** part of any database backup. Restoring the database does not restore files, and restoring a database to an earlier time can leave rows pointing to blobs that were since deleted or blobs without rows. No automated backup of Blob is in the repository (**Unknown** at the vendor).

## Limits
Platform request body cap (about 4.5 MB per Vercel; F-12), storage quota of the Blob plan (**Unknown**), 5 MB and 15 MB configured caps, 10 images per gallery batch (`GALLERY_BATCH_MAX_FILES`).
