# Phase 13 — File Management + Lab Gallery

Status: **done** (2026-09-22). **No schema migration** — `StoredFile` and `GalleryItem` were
already created, empty and unused, in Phase 8 (see `docs/architecture/phase8-platform-architecture.md`
§"Files + gallery"). `dev.db` untouched by this phase's work — every test ran on a disposable
copy (see §17).

This phase builds a controlled, reusable file/media infrastructure and a Lab Gallery on top of
it, exactly as Phases 9–12 established the permission, visibility, audit, serializer and design
conventions. It does **not** introduce events, message/forum attachments, cloud storage, a CMS,
or any new role.

---

## 1. Architecture

```
React frontend (pages/GalleryPage.tsx, components/Gallery*)
    ↓
Express REST API (routes/files.routes.ts, routes/gallery.routes.ts)
    ↓
Prisma (StoredFile metadata, GalleryItem)          lib/storage.ts (blob bytes on disk)
    ↓                                                        ↓
SQLite (Phase 8 schema)                     apps/server/storage/files/<uuid> (opaque keys)
```

New server files:

- `src/lib/storage.ts` — low-level blob storage: `saveFile`, `openReadStream`, `removeFile`,
  `fileExists`, `generateStorageKey`. The only code that ever touches a physical path.
- `src/lib/fileSignature.ts` — `sniffMimeType`: magic-byte detection for the allow-listed types.
- `src/lib/fileService.ts` — the shared `multer` instance (memory storage, size caps),
  `validateUpload` (the one place every route validates a parsed upload), `sanitizeOriginalName`,
  `assertIsImage`.
- `src/lib/fileSerializers.ts` — `toStoredFileRef`, `toGalleryItem` (nested project ref
  visibility-gated, same pattern as a forum topic's project link), `canAccessFile` (the
  "visibility AND parent" rule, including the future-attachment fail-closed path).
- `src/routes/files.routes.ts` — `POST/GET/DELETE /api/files*`, the generic reusable building
  block.
- `src/routes/gallery.routes.ts` — `GET/POST/PUT/DELETE /api/gallery*`.

New shared files:

- `packages/shared/src/schemas/files.ts` — MIME/size allow-lists, gallery category enum,
  `StoredFileRef`/`GalleryItem` response shapes, request schemas.
- `permissions.ts` additions: `canUploadFile`, `canCreateGalleryItem`, `canEditGalleryItem`,
  `canDeleteGalleryItem` (see §8).

New web files:

- `pages/GalleryPage.tsx`.
- `components/{GalleryCard,GalleryLightbox,GalleryUploadModal,GalleryFormModal}.tsx`.
- `lib/api.ts`: `apiUpload` (multipart, no manually-set `Content-Type`).
- `lib/format.ts`: `formatBytes`.
- `components/Icon.tsx`: two new glyphs (`image`, `upload`).
- `navConfig.ts`: `Gallery` added to the existing `community` group (alongside `Forum`).
- `styles/components.css`: `.gallery-grid`/`.gallery-tile`/`.lightbox` shapes only. Everything
  else (`Modal`, `PageHeader`, `SectionHeader`, `Badge`, `Avatar`, `EmptyState`, `LoadingState`,
  `ErrorState`, `CardEditControls`, `ConfirmDeleteModal`, `VisibilityField`, buttons, forms,
  chips, pagination) is reused unchanged.

Existing files extended, not duplicated:

- `src/app.ts` — one new branch in the error handler maps a `multer.MulterError` to a clean
  400/413 instead of a raw 500.
- `src/lib/audit.ts` — five new `AuditAction`s, two new `AuditEntityType`s.
- `src/routes/index.ts` — mounts `/files` and `/gallery`.
- `auth/usePolicy.ts` — `canCreateGalleryItem` added alongside every other creation permission.
- `pages/ProjectDetailPage.tsx` — a compact "Gallery" section (see §14).

---

## 2. Database

**No migration.** `StoredFile` and `GalleryItem` (schema.prisma "Files + gallery", Phase 8) sat
empty and unused until now. Verified before and after this phase's work: `prisma validate`
passes, `PRAGMA integrity_check` → `ok`, `PRAGMA foreign_key_check` → no violations, and
`apps/server/prisma/dev.db`'s SHA-256 and mtime are unchanged (no command in this phase ever
pointed at the real file).

`StoredFile` is **metadata only** — `storageKey`, `originalName`, `mimeType`, `sizeBytes`,
`sha256` (unused this phase — see §18), `visibility`, `ownerId`, `entityType`/`entityId`
(always `null` this phase), `deletedAt` (soft delete). `GalleryItem` wraps a `StoredFile`
(`fileId`, unique) and has **no visibility column of its own** — the file's visibility is the
single source of truth, so the two can never disagree (schema.prisma's own comment on the
model). `GalleryItem.eventId` exists in the schema for a future Events phase and is never set or
read here (Phase 13 §19/§37 non-goal).

---

## 3. Storage architecture

`src/lib/storage.ts` is the only code that ever builds a filesystem path. `STORAGE_ROOT`
(`STORAGE_DIR` env var, default `apps/server/storage/files`) sits **outside** `apps/web/dist` and
is **never** mounted by `express.static` — bytes are reachable only through
`GET /api/files/:id`, which authorizes before it streams a single byte (§7).

Every physical filename is `generateStorageKey()` — a v4 UUID — never derived from
`originalName`. `pathFor()` refuses to resolve anything that is not itself a bare UUID and
re-checks the resolved path's parent directory, so even a key that somehow bypassed every
upstream check cannot escape `STORAGE_ROOT`. Since the key is always server-generated, path
traversal has structurally nothing to act on: `../../secret.txt`, `C:\Windows\System32\...`,
`/etc/passwd` and a `<script>` string are all **display-only metadata** that never touches
`fs.*`. `sanitizeOriginalName()` (fileService.ts) still strips path separators and control
characters from `originalName` as defense in depth, purely for what a human/download sees.

`saveFile` uses `fs.open(..., "wx")` (fails on an existing key rather than overwriting — a
collision should be structurally impossible with a v4 UUID). `removeFile` is best-effort:
a missing blob is not an error.

---

## 4. Upload security

`fileService.ts` `validateUpload` is the one place every upload route funnels through. It never
trusts:

- the client's declared filename or extension,
- the client's declared `Content-Type` (multer's `fileFilter` is not even used for the final
  decision — see below),
- the client-supplied `ownerId` or `visibility` (owner is always `req.user!.id`; visibility is
  gated by `assertMayChangeVisibility`, the same helper every other Phase 8+ table uses).

The **authoritative** check is `sniffMimeType` (`fileSignature.ts`): real magic bytes for JPEG,
PNG, GIF, WEBP, PDF. A file that fails every signature is rejected (400) regardless of what its
name or declared type claimed — a `.php`/`.exe`/`.html` upload whose actual bytes are an
executable, script or arbitrary binary is refused; a real JPEG uploaded as `evil.exe` is
correctly **accepted** (content, not name, is the boundary — see §23 for the security tests
that pin this exact behaviour both ways).

Multer parses to memory (`multer.memoryStorage()`), one file per request, a hard byte cap
enforced up front; the real, sniffed category (image vs. document) determines the fine-grained
size limit re-checked immediately after (§5). A malformed/oversized multipart body is mapped to a
clean 4xx by a new branch in `app.ts`'s error handler (`multerErrorMessage`), never a raw 500 or
an exposed stack trace/filesystem error.

---

## 5. File size limits

Centralized in `packages/shared/src/schemas/files.ts` (`DEFAULT_IMAGE_MAX_BYTES` = 5 MB,
`DEFAULT_DOCUMENT_MAX_BYTES` = 15 MB) and read by `fileService.ts` via `MAX_IMAGE_BYTES` /
`MAX_DOCUMENT_BYTES` env vars (`.env.example`), falling back to those defaults. No route
hardcodes a limit. multer's own cap is `max(imageLimit, documentLimit)` (rejects an absurd
payload before it is even fully buffered); the category-specific limit is re-checked once the
real (sniffed) type is known.

---

## 6. MIME / file type policy

`ALLOWED_MIME_TYPES` (`@scl/shared/schemas/files.ts`) = `IMAGE_MIME_TYPES` (jpeg/png/webp/gif) ∪
`DOCUMENT_MIME_TYPES` (pdf) — one list, easy to extend. No executable/script/markup format is
ever accepted (`.svg` deliberately excluded — no sanitized-SVG pipeline exists in this phase).
Checking the declared MIME type alone is explicitly **not** treated as sufficient: §4's magic-byte
check is what actually decides.

---

## 7. File access API

```
GET    /api/files/:id     — stream bytes; authorization BEFORE any byte is sent
POST   /api/files         — generic standalone upload (any signed-in member)
DELETE /api/files/:id     — owner or manager; 409 if it backs a gallery item (delete via §12 instead)
```

`canAccessFile` (fileSerializers.ts): `canView(viewer, file.visibility)` AND, only if the file is
attached to something (`entityType`/`entityId` set — never true for a gallery file this phase),
the resolved parent's visibility too. An unresolvable parent (deleted, unrecognised type, or
`MESSAGE` — see §16) is denied to everyone except the file's owner and an admin: **fail closed**.
A hidden/inaccessible file answers 404, identical to a missing one, both from the file id lookup
and from `GET /api/gallery/:id` — no endpoint in this phase leaks "it exists but you can't see
it" through a different status code.

---

## 8. File ownership

Owner is always `req.user!.id` from the session; a client-supplied `ownerId` is never read by any
route (schema doesn't even accept the field). Deletion: the owner may delete their own file/item;
a manager may delete anyone's (moderation). `canEditGalleryItem`/`canDeleteGalleryItem`
(`permissions.ts`) = `isManager(a) || (isMember(a) && isOwner)`, the same "owned content" shape as
a forum post — `isOwner` always comes from a server-side lookup (`StoredFile.ownerId === actor.id`),
never the client.

---

## 9. Audit / privacy

Five new `AuditAction`s (`FILE_UPLOADED`, `FILE_DELETED`, `GALLERY_ITEM_CREATED/UPDATED/DELETED`),
two new `AuditEntityType`s (`STORED_FILE`, `GALLERY_ITEM`). Details are small and safe:
`mimeType`, `sizeBytes`, `visibility`, `category`, a truncated `caption`, a `changed` field list
— never file bytes, never a storage key. The existing `FORBIDDEN_KEY` tripwire in `recordAudit`
(rejects `body|content|message|...`) was left unchanged and continues to protect every audit row
in the system, including these new ones. Nothing in this phase touches Phase 12's private
messages — no file feature reads or writes `Conversation`/`Message` rows.

---

## 10. Visibility

Reuses the existing `PUBLIC`/`LAB_ONLY` model exactly — no new visibility system. A `GalleryItem`
has no visibility column; the **file's** visibility is the only source of truth. Nested
visibility: a gallery item's linked project is only ever shown when
`canView(viewer, project.visibility)` — a **public** photo linked to a **hidden** project still
shows the photo (the file's own visibility governs the photo) but the project's id/name/slug are
never included in the response (identical to how a forum topic's or news item's project link is
already handled). Verified directly by `gallery-regression.mjs` "HIDDEN PROJECT" section and by a
deliberate mutation (§17) that proves the test catches a regression here.

---

## 11. Gallery data model

`GalleryItem` (Phase 8 schema, reused as-is): `fileId` (unique, → `StoredFile`), `caption`,
`category` (`LAB_LIFE | EVENT | RESEARCH | OTHER`), `takenAt`, `projectId`, `sortOrder`. No
duplication of file metadata — every field the UI needs about the image comes from the joined
`StoredFile`. `eventId` exists in the schema and is never used (§2, §19).

---

## 12. Gallery API

```
GET    /api/gallery?category=&project=&page=&limit=   — paginated list, deterministic order
GET    /api/gallery/:id                                — single item
POST   /api/gallery                                    — multipart: file (image) + metadata fields
PUT    /api/gallery/:id                                — JSON metadata patch
DELETE /api/gallery/:id                                — removes the item AND its file together
```

`POST` validates the image (§4), writes the blob **before** the database transaction (see §15 for
why), then creates `StoredFile` + `GalleryItem` in one transaction; any failure after the blob is
written removes it immediately (no orphan blob with no DB row under normal failure modes — see
§15/§16 for the one gap that remains). Ordering is `sortOrder asc, createdAt desc, id desc`
(deterministic, documented, same tiebreak pattern as every other paginated list in this
codebase). `?project=` filters without itself gating on the project's visibility — the exact
precedent `GET /api/forum/posts?project=` already established in Phase 11; returned items are
still individually visibility-filtered either way.

`PUT`/`DELETE` use an inline existence-then-ownership check
(`loadEditableGalleryItem`, gallery.routes.ts) rather than the generic `requireEditor`
middleware used elsewhere (e.g. `projects.routes.ts`): `GalleryItem` is **hard-deleted** (no
`deletedAt` column, unlike `StoredFile`/forum posts), so a lookup keyed only on "is this account
the owner" can no longer find an already-deleted row. Checking existence first (404) and
ownership second (403) keeps a repeated `DELETE` correctly 404 for every role, not a misleading
403 for a non-manager — this exact case was caught by `gallery-regression.mjs` during development
(see §17) and fixed before this phase was called done.

---

## 13. Gallery permissions

All in `@scl/shared/permissions.ts`, added to the existing matrix (never an inline
`role === "..."` check — a static scan in the existing API/browser suites still enforces this
project-wide):

| Actor | Capability |
|---|---|
| Guest | view PUBLIC gallery items |
| MEMBER | view PUBLIC + LAB_ONLY; create an item; edit/delete **their own** |
| LAB_MANAGER / ADMIN | full management: edit/delete any item, change visibility |

`canUploadFile`/`canCreateGalleryItem` = `isMember` (any signed-in account — mirrors
`canCreateForumTopic`). Visibility changes are always manager-only
(`assertMayChangeVisibility`, `GALLERY_MANAGER_ONLY_KEYS` — the same `*_MANAGER_ONLY_KEYS`
pattern as `PROJECT_MANAGER_ONLY_KEYS`).

---

## 14. Gallery UI

`/gallery` — `PageHeader` (eyebrow "Community"), a `SectionHeader` with category filter chips
(reusing the search page's `.chip`/`.chip.active` pattern), a responsive image grid
(`GalleryCard`), pagination (the shared `.search-pager` pattern, button-driven like
`NotificationList`), `LoadingState`/`ErrorState`/`EmptyState`. "Add photo" only renders for
`policy.canCreateGalleryItem`.

**Project integration** (§18/§19 of the brief): `ProjectDetailPage` fetches
`/api/gallery?project=<id>&limit=6` independently of the project fetch (same pattern as its
existing "Community Discussions" forum section) and — only if any items come back — renders a
compact thumbnail row with a "View all" link to `/gallery?project=<id>` (`GalleryPage` reads that
query param to pre-filter its own fetch). Because the gallery endpoint resolves its own file
visibility, a LAB_ONLY photo never appears on a public project's page for a guest, and a hidden
project never leaks through the gallery either way (§10).

---

## 15. Lightbox

`GalleryLightbox` is built on the existing shared `Modal` (real `role="dialog"`, labelled by the
caption, focus trapped, Escape closes, focus returns to the trigger, scroll-locked background —
all inherited, not reimplemented) plus its own `ArrowLeft`/`ArrowRight` keydown handling for
Previous/Next, which only render when there is a neighbour in the **currently loaded page** (no
fetching across page boundaries — kept simple, per the brief's own "don't make the lightbox
unnecessarily complex"). Close is a real `<button>`; the image always has meaningful `alt` text
(the caption, or a generic fallback).

---

## 16. Upload UI

`GalleryUploadModal`: native file picker (required; drag/drop not implemented — the picker
covers the requirement, kept simple), filename + size shown once chosen, client-side
type/size pre-checks for fast feedback **only** (never authoritative — a rejected upload always
surfaces the *server's* error message, never a fabricated client-side success), a disabled
Cancel/Escape while submitting, "Uploading…" state, and the list is refreshed from the server
response after a real 2xx — never an optimistic fake record. `GalleryFormModal` (metadata-only
edit) follows the same shape as every other `*FormModal` in this codebase (`NewsFormModal`,
`ProjectFormModal`, ...).

---

## 17. Image preview

Thumbnails use `object-fit: cover` in a fixed-aspect tile (`.gallery-tile__img`, 4:3) to avoid
layout shift while images load; the lightbox uses `object-fit: contain` at up to 70vh. No image
processing/resizing pipeline was added (no such dependency existed in the stack, and the brief
explicitly asks not to introduce a heavy one) — the original upload is served as-is.

---

## 18. Profile / project integration

Only the lightweight project integration described in §14 was added.
`TeamMember.photoUrl` (a plain string column) was **not** wired to `StoredFile` in this phase —
turning profile photos into a StoredFile-backed feature is exactly the kind of "future feature
the infrastructure could support" the brief says not to build now. The building blocks
(`POST /api/files`, `lib/storage.ts`, `lib/fileService.ts`) are already generic enough for a
later phase to do this without any change to this phase's code.

---

## 19. Global search

**Not added.** Gallery items are not indexed and do not appear in `/api/search` results — verified
directly by `gallery-regression.mjs` ("SEARCH" section: a query that matches several seeded
gallery captions returns zero `gallery`-typed results). Adding a gallery source to
`lib/search.ts`/`SEARCH_TYPES` remains a clean, documented next step (the same shape as every
other source there) if a later phase wants it.

---

## 20. Forum integration

**Not implemented.** No forum post/comment can attach a file in this phase. The reusable pieces
are already in place for when it is: `StoredFile.entityType` already includes `FORUM_POST` /
`FORUM_COMMENT` in its documented value set (`@scl/shared/schemas/files.ts` `FILE_ENTITY_TYPES`),
and `fileSerializers.ts` `canAccessFile` already resolves both correctly (a file attached to a
hidden/deleted forum post or a post in a LAB_ONLY category is denied). No Phase 11 forum route,
schema or behaviour was touched; the full forum test suite (`test:forum`, 90 checks) still passes
unchanged.

---

## 21. Messaging integration

**Deliberately not implemented**, and deliberately **not even resolvable** through the generic
file-access path: `MESSAGE` is listed in `FILE_ENTITY_TYPES` for documentation purposes only,
and `fileSerializers.ts` `canViewParent` has **no case for it** — it falls through to the
`default: return false` branch, meaning a hypothetical message-attached file would fail closed
for everyone except its owner/an admin rather than silently "working" through a visibility check
that cannot express "only the conversation's two participants may see this." A real message
attachment feature must add its own participant-scoped authorization (mirroring
`loadOwnParticipant` in `messages.routes.ts`), must never become globally public, must never be
admin-readable merely by role (Phase 12 §11's rule, unweakened), and must never be added to
global search. No Phase 12 file was modified.

---

## 22. Security testing

All 20 scenarios from the brief were tested against a disposable database copy
(`test:files` / `test:gallery`, 95 checks total) plus targeted unit tests
(`unit-files.test.ts`, 64 checks) and a browser pass (§23):

| # | Scenario | Result |
|---|---|---|
| 1 | Guest cannot access a LAB_ONLY file | ✅ 404 |
| 2 | Guest cannot access a LAB_ONLY gallery item | ✅ 404 (list + detail) |
| 3 | Member can access a permitted LAB_ONLY file | ✅ 200 |
| 4 | Member cannot access another user's — N/A this phase: LAB_ONLY standalone files are lab-wide by design (like every other LAB_ONLY row); there is no "private to one member" file class in Phase 13 (that's message attachments, §21, deferred) | — |
| 5 | Admin cannot bypass private-message privacy | ✅ no file/gallery code path touches `Conversation`/`Message` at all |
| 6 | Forged `ownerId` cannot change ownership | ✅ owner is always session-derived; asserted directly against the DB |
| 7 | Forged visibility cannot bypass permissions | ✅ 403 for a non-manager on both `POST /files` and `POST/PUT /gallery` |
| 8 | Path traversal rejected | ✅ `../../secret.txt` etc. never reach the filesystem (metadata only) |
| 9 | Absolute path rejected | ✅ same — `sanitizeOriginalName` strips to a basename |
| 10 | Unsupported MIME rejected | ✅ 400 (plain text claiming `application/pdf`, etc.) |
| 11 | Oversized file rejected | ✅ 413 |
| 12 | Executable/script upload rejected | ✅ 400 (EXE/HTML/PHP payloads, by content) |
| 13 | Hidden project does not leak through gallery | ✅ verified + mutation-proven (§17) |
| 14 | Deleted file cannot be downloaded | ✅ 404 |
| 15 | Deleted gallery item cannot expose file | ✅ both the item AND its file 404 afterward |
| 16 | Unauthorized DELETE returns correct status | ✅ 401 guest, 403 non-owner/non-manager, 404 already-gone |
| 17 | Unauthorized PUT returns correct status | ✅ 401 / 403, manager-only fields 403 for an owner |
| 18 | File ids cannot be used to enumerate unauthorized content | ✅ hidden/missing both 404, identical shape |
| 19 | Original filename cannot control filesystem path | ✅ storage key is always a server UUID |
| 20 | Malicious HTML/script cannot execute through the gallery UI | ✅ literal text only, browser-verified (§23) |

Hostile filenames from the brief (`../../secret.txt`, `..\..\secret.txt`,
`C:\Windows\System32\...`, `/etc/passwd`, `<script>alert(1)</script>`, `foo.php`, `foo.exe`,
`foo.html`) were all uploaded with **real image bytes** and correctly **accepted** (name is
metadata only), and separately with **real hostile content** (an actual PE header, actual HTML,
actual PHP source) and correctly **rejected regardless of the name** — both directions are
asserted explicitly in `files-regression.mjs`.

**Mutation testing** (proving the tests can actually fail): two deliberate mutations were
applied and both were caught —
1. disabling the `canAccessFile` guard in `GET /api/files/:id` → `files-regression.mjs` caught
   the guest-can-now-read-a-LAB_ONLY-file regression;
2. removing the `canView` gate on a gallery item's project ref → `gallery-regression.mjs` caught
   the hidden-project-leak regression (3 assertions).

Both mutations were reverted before this phase was called done.

---

## 23. XSS

No `dangerouslySetInnerHTML` anywhere in the new code (`GalleryCard`, `GalleryLightbox`,
`GalleryUploadModal`, `GalleryFormModal`, `GalleryPage` all render captions/filenames as ordinary
React text children). Verified three ways: (1) `unit-files.test.ts` — hostile caption text
round-trips unchanged through the schema; (2) `gallery-regression.mjs` — `<script>alert(1)</script>`,
`<img src=x onerror=alert(1)>` and `javascript:alert(1)` captions are stored and returned as
literal strings; (3) the browser smoke pass (§23 below) uploaded a real caption containing
`<script>alert(1)</script>` through the actual UI, confirmed it is visible **as text** on the
page (screenshot reviewed), confirmed no real `<script>` DOM element was ever created, and
confirmed `window.alert` was never invoked.

---

## 24. Download / content headers

`GET /api/files/:id` sets `Content-Type` to the file's validated (sniffed) MIME type,
`X-Content-Type-Options: nosniff` (always — no uploaded content is ever sniffed into something
more dangerous by the browser), `Content-Length`, and a deliberate, simple `Content-Disposition`
policy: images are served `inline` (the gallery needs this), documents (PDF) are served
`attachment` (forced download — this phase has no document-preview page, so there is no reason to
render one inline). `Cache-Control` is `public, max-age=3600` for a `PUBLIC` file that is not a
profile photo, and `private, no-store` for everything else; an uploaded profile photo (Phase 3A) is always
`private, no-store` and is served only while its profile is visible to the viewer (see "Profile photos"). No uploaded content is ever reachable through any route
other than this one authorization-checked endpoint, so nothing uploaded can ever be served as
executable web content.

---

## 25. Rate / resource protection

No production rate-limiter was built (out of scope, same as every other phase). What exists:
multer's `fileSize`/`files`/`fields`/`parts` limits (one file per request, bounded field count),
memory-storage uploads bounded by the hard byte cap (never unbounded buffering), and the
category-specific size re-check. Deferred, as everywhere else in this codebase: IP-based rate
limiting, request throttling.

---

## 26. Database transactions / storage cleanup

**Chosen strategy** (documented here because SQLite + a local filesystem cannot be made
perfectly transactional together):

- **Create**: the blob is written to disk **first**, outside the database transaction. If the
  transaction that follows fails for *any* reason (a bad `projectId`, a DB error, a constraint
  violation), the just-written blob is deleted immediately in a `catch` around the whole
  operation. This means a "DB record with no blob" is impossible, and a "blob with no DB record"
  can only outlive a *hard crash* in the narrow window between the successful write and the
  transaction's own completion — there is no cleanup-worker/background job in this phase (matches
  the brief's own "do not build a background worker system"), so a crash in that exact window is
  the one known, accepted gap (see §27).
- **Delete**: the database row is updated/removed **first** (inside a transaction, so it commits
  atomically with any related row change, e.g. a `GalleryItem` delete + its `StoredFile`
  `deletedAt`). This is the security-critical step — the instant it commits, every read path
  (`GET /api/files/:id`, `GET /api/gallery*`) already treats the content as gone, regardless of
  what happens next. The physical blob is then removed in a best-effort step immediately after;
  if that unlink fails (logged to `console.error` with the file id — never silently swallowed),
  the row is still gone and inaccessible, so the *security* guarantee holds even though *storage*
  was not reclaimed. This detectable-but-non-fatal failure mode is the deliberate choice: failing
  the whole DELETE request just because disk cleanup hiccuped would be worse than logging it.

---

## 27. Known limitations / deferred features

- A blob can outlive its (never-created) database row only if the process crashes in the narrow
  window between a successful disk write and the transaction that follows it committing or
  failing — no background sweeper exists to reconcile this (explicitly out of scope, §25/§26).
- No document-preview page for PDFs (served as a forced download, §24).
- No drag-and-drop in the upload UI (a native file picker satisfies the requirement).
- No image resizing/thumbnailing — the original upload is served for both the grid and the
  lightbox.
- Gallery items are not part of global search (§19) or forum attachments (§20) or message
  attachments (§21) — all deliberately deferred, per the brief.
- `TeamMember.photoUrl` was not migrated onto `StoredFile` (§18).
- The full nine-breakpoint / full-keyboard-walk / per-page mutation-testing browser matrix from
  the original brief was **not** run — an ad hoc smoke pass covered 390/768/1024/1440px, the
  upload → lightbox → edit → delete flow, XSS-as-text, and project integration (38 checks, all
  passing); this mirrors the scope Phase 12 already set as precedent for its own browser pass.
- One PRE-EXISTING gap was discovered (not introduced by this phase) while running the committed
  `browser-regression.cjs` nav section: its Phase 10.1-era hardcoded "Account menu" assertions
  were never updated for the `Messages`/`Notifications` links Phase 12 added, so 6 checks in that
  script fail regardless of Phase 13 (confirmed by inspection: none of the 6 reference
  Community/Forum/Gallery, and this phase's `navConfig.ts` diff touches only the `community`
  group's own item list). Left as-is, per "Phase 13 only."

---

## 28. Future integration points

- `POST/GET/DELETE /api/files/:id` and `lib/storage.ts`/`lib/fileService.ts` are already generic:
  a future phase can attach a file to any entity in `FILE_ENTITY_TYPES` and `canAccessFile`
  already resolves `PUBLICATION`/`RESEARCH_PROJECT`/`EVENT`/`FORUM_POST`/`FORUM_COMMENT`
  correctly.
- Forum attachments: reuse `POST /api/files` with `entityType: "FORUM_POST" | "FORUM_COMMENT"`
  once a route sets that (currently no route ever does).
- Message attachments: must NOT reuse the generic visibility-based `canAccessFile` path as-is —
  add a participant-scoped check mirroring `loadOwnParticipant`, never index in search, never
  give admins a bypass (Phase 12 §11's rule).
- A gallery search source can be added to `lib/search.ts`/`SEARCH_TYPES` following the exact
  shape every other source already uses there (`visibleTo` as `base`, no relationship leakage).
- `TeamMember.photoUrl` could become `StoredFile`-backed by a later profile-media phase.

---

## 29. Confirmations

Phase 14 was **not** started. Nothing was deployed. No new role was introduced. The reference
implementation (`Lab-Website/reference/`) was not touched. `apps/server/prisma/dev.db` was not
modified by any command in this phase — every test ran against a disposable copy in the session
scratchpad (SHA-256 and mtime confirmed unchanged before and after this phase's entire session).

## Multi-image gallery entries (follow-up)

One upload submission with several images is ONE gallery entry, not one entry per image.

- **Model.** `GalleryItem.fileId` remains the entry's cover (first) image, so every pre-existing single-image row is already a complete entry. Further images are `GalleryImage` rows (`itemId`, unique `fileId`, `sortOrder`), added by the migration `20261011130000_gallery_item_images` (one new table; additive, nothing existing is altered).
- **API.** `POST /api/gallery` is unchanged (one image, creates the entry). `POST /api/gallery/:id/images` appends one image to an existing entry (entry owner or a manager; image files only; at most `GALLERY_BATCH_MAX_FILES` = 10 images per entry, 409 beyond that). It stays one image per request because Vercel rejects request bodies over 4.5 MB. `GET /api/gallery` and `GET /api/gallery/:id` return `images` (cover first; `file` is still the cover).
- **Client.** The dialog sends the first image to `POST /api/gallery` and the rest to `POST /api/gallery/:id/images` (`createEntryUploader` in `@scl/shared`). The entry id is remembered, so "retry" appends to the same entry and never creates a second one. Once the entry exists, its caption/category/project/visibility are locked in the dialog (change them later with Edit).
- **Visibility.** A new image takes the entry's visibility (any client value is ignored); a manager changing the entry's visibility updates every image's file, so an entry never mixes visibilities. Files are still served only through `GET /api/files/:id`; no Blob URL is ever returned.
- **Delete.** Deleting the entry soft-deletes every image's file, removes the `GalleryImage` rows and removes every blob. A single image of an entry cannot be deleted on its own (`DELETE /api/files/:id` answers 409), and there is no "remove one image" endpoint yet.
- **Failure handling.** Each append writes its blob first and removes it again if the database write fails (same as create), so a failed image leaves no row and no blob. If the process dies between the blob write and the cleanup, the blob is orphaned like any other failed upload (the Blob-aware reconciler remains a separate follow-up). Images already uploaded stay in the entry when a later one fails or the dialog is closed.
- **Deployment order.** The list/detail queries read `GalleryImage` and the upload routes read/write `GalleryUploadAttempt`, so BOTH migrations (`20261011130000_gallery_item_images`, `20261011140000_gallery_upload_attempts`) MUST be applied to the production database (the audited manual process in the site maintainer guide) BEFORE this code is deployed; the old code ignores the new tables, so applying them first is safe. Use the reviewed executor described in [turso-migration-executor.md](turso-migration-executor.md) (`npm run migrate:turso`).

### Upload idempotency (`Idempotency-Key`)

A request can be committed by the server while its response is lost (network drop, timeout, a 5xx after the commit). Without help, the retry would store the image twice, or create a second entry.

- **Client.** Each image gets one random key when it is first sent (`createKeyRing` in `@scl/shared`, `crypto.randomUUID()` in the browser) and re-sends the SAME key on every retry of that image, in the `Idempotency-Key` header of both `POST /api/gallery` and `POST /api/gallery/:id/images`. If creating the entry fails in a way that may still have committed (no status, or 5xx), that image stays the "pinned" creator: the dialog re-sends its create (same key) before anything else and never lets another image start a second entry (`createEntryUploader`).
- **Server.** `GalleryUploadAttempt(userId, key, operation, itemId, fileId, sha256)` has `@@unique([userId, key])` and is inserted in the SAME transaction as the entry/image it describes, so the key exists if and only if the work committed. A request whose key is already completed is answered `201` with the original entry (`Idempotent-Replayed: true`) before any blob is written; nothing is created. No in-memory state is used.
- **Binding.** Keys are scoped to the authenticated account (another account's identical key is simply its own new key and can never see or reuse yours). A key is bound to its operation (`CREATE`/`APPEND`), the target entry (`APPEND`) and the image's SHA-256: reuse for anything else is `409`. Authentication and authorization (entry owner or manager) run BEFORE the replay lookup, so a replay can never bypass them, and a replay is answered even at the 10-image cap. A malformed key is `400`; no key means the previous behaviour, unchanged.
- **Concurrency.** Duplicates that overlap resolve through the unique constraint: the loser's transaction rolls back (a unique violation on create, a rollback signal on append), its own blob is removed, and it answers with the winner's entry. Every upload transaction starts with a WRITE (create the file / touch the entry) so concurrent transactions queue instead of deadlocking on a SQLite read-then-write lock upgrade. On a plain SQLite file with the default connection pool, heavy contention can still surface as a lock timeout (500) for some duplicates; no duplicate is ever stored and the client's retry (same key) converges on the original. Turso's lock behaviour has not been exercised.
- **Failed attempts do not burn a key.** A request that fails validation, the cap, or its transaction records nothing, so the same key can be used again.
- **A deleted entry stays deleted.** The attempt row has no foreign key to the entry, so a retry after the entry was deleted answers `404` and creates nothing.
- **Unavoidable crash window.** The blob is written BEFORE the database transaction (a transaction cannot contain a Blob upload). If the process dies after the blob is stored and before the transaction commits or the cleanup runs, the blob is orphaned: no row names it, it is unreachable through the app, and nothing removes it (the reconciler only scans local disk; a Blob-aware one is still a follow-up). A retry with the same key does not reuse that blob; it writes a new one. Concurrent duplicates also each write a blob before one wins; the losers remove theirs (best effort, and silent on the Blob backend, see `removeFile`). The reverse failure (database committed, blob missing) cannot happen: the response is built only after the commit and nothing deletes a blob once the rows exist.
- **Housekeeping.** `GalleryUploadAttempt` rows are tiny and are not pruned automatically (`createdAt` is indexed for a future cleanup job); they are removed when the account is deleted.

### Ambiguous transaction failures never delete a committed image

A remote database can report an error for a COMMIT it actually applied. `routes/gallery.routes.ts` therefore tracks whether the transaction callback completed (`commitAttempted`, set as its last step; it means "a commit may have been issued", not "a commit was sent") and hands the decision to `lib/galleryBlobCleanup.ts` (`releaseUploadedBlob`):

- **Callback threw / transaction never started** (our own 4xx/409, a failed statement, a unique violation, the replay rollback signal): Prisma rolls back and never issues a commit, so the uploaded blob is removed.
- **Callback completed but the transaction then reported an error:** the callback finishing only means Prisma went on to commit; whether that commit was sent or applied is uncertain (it may have been applied, or never sent, e.g. the transaction expired first). The blob is therefore NEVER removed. The database is consulted only to log whether the row exists (committed) or not (unknown / unreadable); the blob is kept in all three cases. A keyed retry then replays the committed result with its image intact.
- Cleanup is best-effort and never throws, so it cannot mask the request's original error.
- **Trade-off:** if such a commit really failed, the kept blob is an orphan (a leak, recoverable by a future cleanup job) rather than a committed row with a missing image. The classification relies on where the failure happened in our own code, not on Prisma error codes.
- **Not covered by this rule:** `POST /api/files` (`routes/files.routes.ts`) keeps its older unconditional cleanup, and the Blob backend's `removeFile` still swallows failures silently.

In the upload dialog, removing the image that is "pinned" as the entry's uncertain creator clears the pin (`forget` in `createEntryUploader`), so the remaining images can create the entry; the user is warned that the removed image may already have been uploaded. The warning is kept in its own notice (not the error line), stays visible through the next Upload attempt and further file changes, and goes away only when dismissed, replaced by another such warning, or when the dialog is reopened.

## Profile photos (Phase 3A)

Members upload their own profile photo with `POST /api/profile/photo`. The file is a `StoredFile` with `visibility` PUBLIC, `entityType` `TEAM_MEMBER` and `entityId` the member's id, assigned by the server. Its visibility alone does not decide who can read it: access also requires the member's profile to be visible to the viewer (`canViewParent` in `lib/fileSerializers.ts`; an unpublished alumni profile, Phase 3B, is visible to administrators only, and a profile photo has no uploader exception); the client sends only the image. The previous uploaded photo is retired (soft-deleted, blob removed after the commit) when the photo is replaced, cleared, or the file or member is deleted (`lib/profilePhoto.ts`). Retired photos answer 404 immediately. Photo responses are `Cache-Control: private, no-store` with `Vary: Cookie`, so no cache is asked to keep them; a copy already fetched before a photo was retired or a profile was unpublished cannot be recalled.

**What the sanitizer (`lib/imageSanitize.ts`) guarantees, and what it does not.** Known metadata containers and unsupported ancillary/application structures are removed according to a per-format allowlist (EXIF, XMP, IPTC, comments, text chunks, MPF, application extensions, thumbnails, data after the end marker). A valid JPEG/PNG/WebP orientation is rebuilt as a new minimal block; malformed or ambiguous orientation, animation and malformed structure are rejected. Everything else that is accepted is preserved byte for byte.

It is **not** a re-encoder and **cannot** guarantee that all embedded information is removed. Opaque or retained structures may still carry arbitrary payloads: ICC profiles (description, copyright, private tags), compressed image data (including bytes after a compressed stream ends within the same chunk or scan), colour tables and palettes, Huffman/quantization tables and some binary fields. Their size and structure are checked where that is safe; their content is not inspected. Validation is structural only: pixels are never decoded, so an accepted file can still fail to render. Removing everything would require a decode-and-re-encode step (for example with an image library), which is a deliberate non-goal of this phase.

**Display and caching.** The web app's Content-Security-Policy is `img-src 'self' data:` (`apps/web/index.html`), so a photo given as an external `http(s)` URL is stored but does not render in the browser; only uploaded photos (served from `/api/files/:id`) display. Profile-photo responses are `private, no-store` (other public files keep `public, max-age=3600`), so a replaced, removed or unpublished photo stops being served on the next request; copies a browser or archive already holds are outside the server's control.

**Concurrency — verified only against embedded local databases; the hosted (remote Turso/libSQL) path is NOT verified.** Photo operations rely on database transactions. `scripts/profile-photo-concurrency.ts` runs simultaneous requests (upload vs profile save, vs clear, vs member delete; clear vs clear, three-way clear; upload vs upload; external-URL replacement; plus a control of two text-only profile saves) against disposable local databases and asserts lifecycle invariants (no member points at a retired or missing file, no live row without its blob, no leaked live file, a bystander's photo untouched; it also records left-behind database locks, 5xx responses and unreferenced blobs separately). Targets: plain SQLite, and an embedded libSQL file driven through the same `@prisma/adapter-libsql` adapter the hosted deployment uses, each with one server process and with two processes sharing the file (`npx tsx scripts/profile-photo-concurrency.ts <sqlite|libsql> <same|cross> [rounds]`; 9 scenarios; the npm script passes 12 rounds per scenario, and 4 for `libsql cross`, which is slow). The data invariants held in every run of every configuration. The results below are indicative: the runs are randomized.

*Embedded libSQL with several processes: a failed statement or commit could leave a lock behind.* Verified with the installed versions (`@libsql/client` 0.8.1, native `libsql` 0.3.19, `@prisma/adapter-libsql` 5.22.0; not independently confirmed or reported upstream): the client runs every statement as `db.prepare(sql).run()/.all()`, and when such a statement fails with `SQLITE_BUSY` the native statement is left un-reset. For a failed `COMMIT` this keeps the connection's lock for the life of the process, even after `ROLLBACK` succeeds (`inTransaction` becomes false) and after `close()`; the same `COMMIT` sent through `db.exec()` (what `Transaction.executeMultiple` uses) fails cleanly and a following `ROLLBACK` releases everything. The embedded connection also has no busy timeout, so a commit that meets another connection's momentary read lock fails at once. One such failure blocks every other writer of the file until that process restarts. This reproduces without the application and without Prisma, and on the unmodified baseline with a plain text-only `PUT /api/profile`: a lock was left behind in 6 of 6 control rounds (`libsql cross`, baseline checkout, `NO_PHOTO_FEATURE=1 ONLY_SCENARIO=control`).

*Mitigations.* (1) `PUT /api/profile`, `PUT /api/team/:id` and `DELETE /api/team/:id` begin their transaction with a write (as `POST /api/profile/photo` and the gallery routes already did), so it takes the write lock before it reads instead of reading first and then trying to upgrade; this also makes the "previous photo" it reads consistent. On its own this reduced the left-behind locks in the full `libsql cross` run (36 rounds) from 26 to between 11 and 16, and in the control from 6/6 to 1-2 of 6. (2) `lib/libsqlGuard.ts`, applied only to embedded `file:` clients in `lib/prisma.ts`: every connection the guard sees (the one handed to a transaction and the fresh one opened after it; not a statement run before the first transaction) gets a 2 s busy timeout, and `COMMIT` is sent through the exec path and re-issued on the same open transaction while SQLite reports BUSY (a BUSY commit leaves the transaction active and applies nothing; no statement or operation is ever retried; a re-issued COMMIT may wait only for what is left of the 2 s budget), then rolled back and rethrown if the budget is spent. With both in place the full `libsql cross` scenario run left no lock behind and returned no 5xx in 4 of 4 runs (144 rounds), and the control in 12 of 12 rounds. Deterministic two-process checks in `scripts/unit-libsql-guard.test.ts`: the guarded commit waits for the other process's read lock and succeeds, or after the budget fails with BUSY and the lock is released (what an unguarded client does in the same situation, failing at once and leaving the database locked, is printed by the test for information only, not asserted). (3) A `SQLITE_BUSY` ("database is locked") failure on the profile, team and file routes (including the libSQL client's own error from a commit that stayed BUSY after the guard rolled it back) answers `503` with `Retry-After: 1` and a fixed message (`transientContentionAs503`); the server never retries a request itself. Prisma's generic timeout class (`P1008`, "Timed out during query execution") is deliberately NOT mapped: against a remote database a timed-out commit may have been applied, so it stays a generic 500. The mapping is router-level on purpose: existing forum, messages and gallery routes keep their long-standing 500.

*What this does not cover.* A statement that fails with `SQLITE_BUSY` inside a read-then-write transaction (the lock-upgrade deadlock) still leaves the connection stuck, and no wrapper can reset the native statement: in a pure two-process repro with the guard, 11 of 12 read-first trials still left a lock behind. Other routes in the application still begin transactions with a read, so they remain exposed in an embedded multi-process deployment; hardening them is a separate follow-up and is deliberately not part of Phase 3A. By a scan of the first statement of each interactive transaction, the groups that begin with a read are: events, forum, gallery (update/delete), research groups, invitations, knowledge, member profile sections, messages, news, projects, publications, research areas, lab resources and admin user management; further read-first transactions were found in `routes/admin.routes.ts` (around lines 152 and 272), `lib/membership.ts` (around line 50) and `routes/googleAuth.routes.ts` (around line 354); the remaining account routes were not classified. The same applies to the wider transaction limits: every other transaction on the guarded client (including `POST /api/team` and `POST /api/files`) keeps Prisma's 5 s default and the same exposure to the "expired but applied" outcome. The 503 mapping is not restricted to embedded databases; whether a BUSY from a remote server is definitive is part of what remains unverified. While SQLite waits on the busy timeout the synchronous embedded driver blocks that whole process (observed: health pings stall for about 2 s per wait). Interaction with Prisma's interactive-transaction limits (defaults `timeout` 5 s, `maxWait` 2 s). `npx tsx scripts/profile-photo-expiry-probe.ts` shows the effect of the timer, scaled down (explicit 1 s timeout, then 15 s); `npx tsx scripts/profile-photo-stall-probe.ts` (one embedded-libSQL server, locks held by other processes for several seconds) measures the real routes, which already run with the wider limits described below, so it does not itself exercise the 5 s default: Prisma's timer runs in its compiled engine and is NOT paused while the synchronous driver blocks. **When it fires while the guard's COMMIT is still waiting and the commit then succeeds, Prisma throws `P2028` ("transaction expired") although the change was applied** (measured: timeout 1 s, lock released after 1.2 s and 1.9 s: error and row applied). That is an uncertain outcome for the caller (a plain 500, deliberately not mapped to 503, and the routes keep blobs in that case). Within the guard's own bounds a transaction waits at most about 2 s for its first write and 2 s for its commit, so about 4 s, only just under the 5 s default; the embedded write routes therefore pass wider limits (`interactiveTransactionOptions` from `lib/prisma.ts`: `timeout` 15 s, `maxWait` 8 s) for embedded databases only, and the expiry probe shows no expiry at that limit. A request can still take up to about 6 s, because the session-store write that ends it waits on the same lock, and a request queued behind a stalled transaction in the same process waits for it (up to `maxWait`). In every stall scenario the failed request applied nothing, no lock or transaction was left behind, the server kept answering, and no photo reference or blob was inconsistent; the only residue was the unreferenced blob of a failed upload, which is kept by design. A write-first statement that itself times out BUSY (another process holds the write lock longer than the 2 s busy timeout; probe scenario S8) answers a plain 500 (Prisma reports it as a generic timeout, which is deliberately not mapped to 503) and, in 3 of 3 runs, left no lock behind and the next request from the same member succeeded; that scenario is a diagnostic, not an automated check. Photo uploads that fail at commit keep their blob (an uncertain-commit rule), so an unreferenced blob can remain; the storage reconcile job removes it. *Where the stall-probe 503 comes from.* In scenario S4 (embedded libSQL, a second process holds a read lock) every statement of the upload transaction succeeds, the guard's `COMMIT` stays BUSY for its 2 s budget, the guard rolls back, and the client's own `LibsqlError` with code `SQLITE_BUSY` reaches the router-level handler, which classifies it and answers 503 with `Retry-After: 1` (traced with a script against the real client, adapter and Prisma; no injected error). The `ConnectorError ... Timed out during query execution` line in the server log is Prisma's own engine log of the failed commit, not the error the handler receives. That is the EMBEDDED shape only; the error shape of a remote Turso server is not verified and is a release condition. The 503 carries `Retry-After: 1` and a fixed message and is never produced for `P1008`, timeouts, `P2028` (expired, possibly applied), `SQLITE_LOCKED` or constraint errors (unit-tested); the server never retries, and the web client has no automatic retry for these writes.

*Remote Turso/libSQL server: not verified.* The hosted deployment talks to a remote server, whose lock, busy-timeout and transaction behaviour can differ from the embedded file. The guard does not touch remote clients. No isolated remote server was tested, so the production path is neither shown to be affected nor shown to be safe; nothing here is release approval.

**Known baseline issue (not part of this change): `npm run test:knowledge`.** The knowledge-base HTTP suite fails 3-4 of ~227 checks on the unmodified baseline as well as on this branch. `every category is accepted` (ten simultaneous creates) fails every time; up to three `... same status for every locale` checks fail intermittently, where the status flips between 403 and 500 because SQLite reports lock timeouts (Prisma `P1008`) under concurrent writes. The failures were compared on modified and unmodified code under the same conditions (same four names only, never others); the knowledge routes and tests were not changed.
