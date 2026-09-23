import { z } from "zod";
import { visibilitySchema } from "./enums.js";
import { idSchema, optionalText, sortOrderField } from "./common.js";
import { intQueryParam, paginationMetaSchema } from "./forum.js";
import { optionalDateSchema, projectRefSchema } from "./project.js";

/**
 * File/media infrastructure (Phase 13), built on the StoredFile/GalleryItem tables Phase 8
 * already created (see docs/architecture/phase8-platform-architecture.md §"Files + gallery" and
 * phase13-files-and-gallery.md). `StoredFile` is metadata only — the bytes live outside SQLite,
 * outside apps/web/dist, and are only ever reachable through the authorization-aware
 * `GET /api/files/:id` route (see apps/server/src/lib/storage.ts). This module is the single
 * source of truth for the allow-lists, limits and response/request shapes both the server and
 * the web app use.
 *
 * GalleryItem has NO visibility of its own: the FILE's visibility is the single source of
 * truth (see schema.prisma), so the two can never disagree. A gallery item's `project` link, if
 * any, is independently visibility-gated the same way a forum topic's or news item's is — a
 * hidden project's name/id is never sent to a viewer who cannot see it (see ../permissions.ts
 * and apps/server/src/lib/fileSerializers.ts).
 */

// ---- allow-lists / limits ----------------------------------------------------------
/** Extend these two lists ONLY to add a supported type; every validator reads from them. */
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const DOCUMENT_MIME_TYPES = ["application/pdf"] as const;
export const ALLOWED_MIME_TYPES = [...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const mimeTypeSchema = z.enum(ALLOWED_MIME_TYPES, {
  errorMap: () => ({ message: `File type must be one of: ${ALLOWED_MIME_TYPES.join(", ")}.` }),
});

export const isImageMime = (m: string): m is (typeof IMAGE_MIME_TYPES)[number] => (IMAGE_MIME_TYPES as readonly string[]).includes(m);
export const isDocumentMime = (m: string): m is (typeof DOCUMENT_MIME_TYPES)[number] => (DOCUMENT_MIME_TYPES as readonly string[]).includes(m);

/**
 * Default size limits, in bytes. The server may override either via `MAX_IMAGE_BYTES` /
 * `MAX_DOCUMENT_BYTES` env vars (see apps/server/.env.example) — these constants are the
 * documented defaults and what the web app shows in the upload form's hint text.
 */
export const DEFAULT_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const DEFAULT_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export const ORIGINAL_NAME_MAX = 255;
export const CAPTION_MAX = 300;

/** What a `StoredFile` is attached to (Phase 13 §"future integration points"). Every file this
 *  phase creates is standalone (`entityType: null` — a gallery item or, later, a library file);
 *  the other values are documented here so a future phase (forum attachments, message
 *  attachments — explicitly deferred, see docs) reuses this allow-list instead of inventing a
 *  second one. `MESSAGE` is intentionally NOT resolvable by the generic file-access check (see
 *  fileSerializers.ts `canAccessFile`): message attachments need participant-level privacy that
 *  a simple visibility lookup cannot express, so that integration must fail closed until a
 *  future phase implements it properly — never silently "work" via the generic path.
 */
export const FILE_ENTITY_TYPES = ["PUBLICATION", "RESEARCH_PROJECT", "EVENT", "FORUM_POST", "FORUM_COMMENT", "MESSAGE"] as const;
export type FileEntityType = (typeof FILE_ENTITY_TYPES)[number];

export const GALLERY_CATEGORIES = ["LAB_LIFE", "EVENT", "RESEARCH", "OTHER"] as const;
export const galleryCategorySchema = z.enum(GALLERY_CATEGORIES, {
  errorMap: () => ({ message: `Category must be one of: ${GALLERY_CATEGORIES.join(", ")}.` }),
});
export type GalleryCategory = z.infer<typeof galleryCategorySchema>;
export const GALLERY_CATEGORY_LABELS: Record<GalleryCategory, string> = {
  LAB_LIFE: "Lab life",
  EVENT: "Event",
  RESEARCH: "Research",
  OTHER: "Other",
};

export const GALLERY_DEFAULT_LIMIT = 24;
export const GALLERY_MAX_LIMIT = 60;
const MAX_PAGE = 10000;

// ---- response shapes ----------------------------------------------------------------
/** A file exactly as the public API shows it. `url` is app-relative (`/api/files/:id`) and is
 *  the ONLY way a client ever reaches the bytes — never a filesystem path, never the storage
 *  key. */
export const storedFileRefSchema = z.object({
  id: z.string(),
  url: z.string(),
  originalName: z.string(),
  mimeType: mimeTypeSchema,
  sizeBytes: z.number(),
  kind: z.enum(["image", "document"]),
});
export type StoredFileRef = z.infer<typeof storedFileRefSchema>;

export const galleryItemSchema = z.object({
  id: z.string(),
  file: storedFileRefSchema,
  caption: z.string(),
  category: galleryCategorySchema,
  /** "YYYY-MM-DD", or null when not set. */
  takenAt: z.string().nullable(),
  /** null when there is no linked project OR it is not visible to this viewer. */
  project: projectRefSchema.nullable(),
  sortOrder: z.number(),
  /** Only sent to accounts that may change visibility (lab managers, admins) — the file's own
   *  visibility, since a gallery item has none of its own. */
  visibility: visibilitySchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** UX hints only; the API re-checks ownership/role on every write. */
  canEdit: z.boolean(),
  canDelete: z.boolean(),
});
export type GalleryItem = z.infer<typeof galleryItemSchema>;

export const galleryListResponseSchema = z.object({
  items: z.array(galleryItemSchema),
  pagination: paginationMetaSchema,
});
export type GalleryListResponse = z.infer<typeof galleryListResponseSchema>;

export const galleryQuerySchema = z.object({
  page: intQueryParam("Page", 1, MAX_PAGE, 1),
  limit: intQueryParam("Limit", 1, GALLERY_MAX_LIMIT, GALLERY_DEFAULT_LIMIT),
  category: galleryCategorySchema.optional(),
  project: idSchema.optional(),
});
export type GalleryQuery = z.infer<typeof galleryQuerySchema>;

// ---- write shapes -------------------------------------------------------------------
/**
 * Metadata fields sent alongside the multipart upload (`POST /api/gallery`). Multer parses
 * every non-file field as a plain string, so `""` means "omitted" here (never coerced into a
 * misleading value) and numeric/date fields are validated as strings first.
 */
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

export const createGalleryItemFieldsSchema = z.object({
  caption: z.preprocess(emptyToUndefined, optionalText("Caption", CAPTION_MAX).optional()).transform((v) => v ?? ""),
  category: z.preprocess(emptyToUndefined, galleryCategorySchema.optional()).transform((v) => v ?? "LAB_LIFE"),
  projectId: z.preprocess(emptyToUndefined, idSchema.optional()).transform((v) => v ?? null),
  /** Manager-only, like everywhere else; enforced server-side (assertMayChangeVisibility). */
  visibility: z.preprocess(emptyToUndefined, visibilitySchema.optional()),
  takenAt: z.preprocess(emptyToUndefined, optionalDateSchema.optional()),
});
export type CreateGalleryItemFields = z.infer<typeof createGalleryItemFieldsSchema>;

export const updateGalleryItemFields = {
  caption: optionalText("Caption", CAPTION_MAX),
  category: galleryCategorySchema,
  projectId: idSchema.nullable(),
  takenAt: optionalDateSchema,
  sortOrder: sortOrderField,
};
/** Manager-only field, exactly like `PROJECT_MANAGER_ONLY_KEYS` — the owner of a gallery item
 *  may edit its caption/category/project, but only a manager may change its visibility. */
export const galleryManagerFields = { visibility: visibilitySchema };
export const GALLERY_MANAGER_ONLY_KEYS = Object.keys(galleryManagerFields) as (keyof typeof galleryManagerFields)[];

export const updateGalleryItemSchema = z
  .object({
    caption: updateGalleryItemFields.caption.optional(),
    category: updateGalleryItemFields.category.optional(),
    projectId: updateGalleryItemFields.projectId.optional(),
    takenAt: updateGalleryItemFields.takenAt.optional(),
    sortOrder: updateGalleryItemFields.sortOrder.optional(),
    visibility: galleryManagerFields.visibility.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");
export type UpdateGalleryItemInput = z.infer<typeof updateGalleryItemSchema>;
