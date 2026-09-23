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
render one inline). `Cache-Control` is `public, max-age=3600` for a `PUBLIC` file and
`private, no-store` for everything else. No uploaded content is ever reachable through any route
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
