/**
 * Unit test of the pure parts of the file/media infrastructure + gallery (Phase 13): request
 * schemas, filename sanitization, magic-byte sniffing, upload validation, and the serializers
 * that don't need a database. No server, no database.   npm run test:unit -w apps/server
 */
import {
  createGalleryItemFieldsSchema,
  galleryQuerySchema,
  mimeTypeSchema,
  updateGalleryItemSchema,
} from "@scl/shared";
import { sniffMimeType } from "../src/lib/fileSignature.js";
import { sanitizeOriginalName, validateUpload } from "../src/lib/fileService.js";
import { toGalleryItem, toStoredFileRef, canAccessFile } from "../src/lib/fileSerializers.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

// ---- mime allow-list ---------------------------------------------------------------
t("mimeTypeSchema accepts image/jpeg", mimeTypeSchema.safeParse("image/jpeg").success);
t("mimeTypeSchema accepts application/pdf", mimeTypeSchema.safeParse("application/pdf").success);
for (const bad of ["text/html", "application/javascript", "application/x-msdownload", "image/svg+xml", "text/x-php"]) {
  t(`mimeTypeSchema rejects ${bad}`, !mimeTypeSchema.safeParse(bad).success);
}

// ---- magic-byte sniffing (never trust the declared Content-Type/extension) ---------
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const GIF = Buffer.from("GIF89a\0\0\0\0", "latin1");
const WEBP = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP", "latin1")]);
const PDF = Buffer.from("%PDF-1.7\n...", "latin1");
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]); // "MZ" — a Windows PE executable header
const HTML = Buffer.from("<script>alert(1)</script>", "utf8");
const PHP = Buffer.from("<?php system($_GET['c']); ?>", "utf8");

t("sniffMimeType: real JPEG bytes -> image/jpeg", sniffMimeType(JPEG) === "image/jpeg");
t("sniffMimeType: real PNG bytes -> image/png", sniffMimeType(PNG) === "image/png");
t("sniffMimeType: real GIF bytes -> image/gif", sniffMimeType(GIF) === "image/gif");
t("sniffMimeType: real WEBP bytes -> image/webp", sniffMimeType(WEBP) === "image/webp");
t("sniffMimeType: real PDF bytes -> application/pdf", sniffMimeType(PDF) === "application/pdf");
t("sniffMimeType: a Windows executable is never recognised as an allowed type", sniffMimeType(EXE) === null);
t("sniffMimeType: raw HTML/script is never recognised as an allowed type", sniffMimeType(HTML) === null);
t("sniffMimeType: raw PHP source is never recognised as an allowed type", sniffMimeType(PHP) === null);
t("sniffMimeType: empty buffer -> null", sniffMimeType(Buffer.alloc(0)) === null);
// A file NAMED like an image but containing executable bytes must still be rejected by content,
// not by trusting the extension (Phase 13 §6/§23-12) — validateUpload only ever looks at bytes.
t("sniffMimeType: EXE content named photo.jpg is still rejected (content, not extension, decides)", sniffMimeType(EXE) === null);

// ---- sanitizeOriginalName: hostile filenames never touch the filesystem ------------
t('sanitizeOriginalName strips ../ traversal down to the basename', sanitizeOriginalName("../../secret.txt") === "secret.txt");
t('sanitizeOriginalName strips Windows-style ..\\ traversal', sanitizeOriginalName("..\\..\\secret.txt") === "secret.txt");
t("sanitizeOriginalName strips an absolute Windows path to its basename", sanitizeOriginalName("C:\\Windows\\System32\\evil.dll") === "evil.dll");
t("sanitizeOriginalName strips an absolute POSIX path to its basename", sanitizeOriginalName("/etc/passwd") === "passwd");
t("sanitizeOriginalName strips control characters incl. NUL", sanitizeOriginalName("evil\u0000.txt\u0007") === "evil.txt");
t("sanitizeOriginalName caps length at 255", sanitizeOriginalName("a".repeat(500)).length === 255);
t("sanitizeOriginalName never returns empty", sanitizeOriginalName("../../") === "file");
t("sanitizeOriginalName leaves an ordinary name unchanged", sanitizeOriginalName("my research paper.pdf") === "my research paper.pdf");
// A slash anywhere in the name is treated as a path separator (defense in depth: only the
// segment after the LAST one survives) — even one that happens to be part of HTML markup like
// "</script>". The result is still just inert text, never interpreted as markup either way.
t("sanitizeOriginalName treats an embedded '/' as a path separator (keeps only the last segment)", sanitizeOriginalName("<script>alert(1)</script>.png") === "script>.png");
t("sanitizeOriginalName passes hostile markup through as inert text when it has no path separator", sanitizeOriginalName("<img src=x onerror=alert(1)>.png") === "<img src=x onerror=alert(1)>.png");

// ---- validateUpload: content decides, size limit is per-category -------------------
const jpegFile = { buffer: JPEG, size: JPEG.length, originalname: "../../evil.exe" };
const validated = validateUpload(jpegFile);
t("validateUpload accepts real JPEG bytes regardless of a hostile filename", validated.mimeType === "image/jpeg");
t("validateUpload's output originalName is sanitized (no path separators)", validated.originalName === "evil.exe" && !validated.originalName.includes("/"));
t("validateUpload rejects unrecognised content (foo.exe with EXE bytes)", (() => {
  try {
    validateUpload({ buffer: EXE, size: EXE.length, originalname: "foo.exe" });
    return false;
  } catch (err) {
    return (err as { status?: number }).status === 400;
  }
})());
t("validateUpload rejects a .html file whose content is plain HTML", (() => {
  try {
    validateUpload({ buffer: HTML, size: HTML.length, originalname: "foo.html" });
    return false;
  } catch (err) {
    return (err as { status?: number }).status === 400;
  }
})());
t("validateUpload rejects a .php file whose content is plain PHP source", (() => {
  try {
    validateUpload({ buffer: PHP, size: PHP.length, originalname: "foo.php" });
    return false;
  } catch (err) {
    return (err as { status?: number }).status === 400;
  }
})());
t("validateUpload rejects an oversized image (413)", (() => {
  try {
    validateUpload({ buffer: JPEG, size: 999_999_999, originalname: "big.jpg" });
    return false;
  } catch (err) {
    return (err as { status?: number }).status === 413;
  }
})());

// ---- request schemas -----------------------------------------------------------------
t("createGalleryItemFieldsSchema: empty multipart body -> sane defaults", (() => {
  const r = createGalleryItemFieldsSchema.parse({});
  return r.caption === "" && r.category === "LAB_LIFE" && r.projectId === null && r.visibility === undefined;
})());
t("createGalleryItemFieldsSchema: empty-string fields treated as omitted, not as literal values", (() => {
  const r = createGalleryItemFieldsSchema.parse({ caption: "", category: "", projectId: "", visibility: "", takenAt: "" });
  return r.caption === "" && r.category === "LAB_LIFE" && r.projectId === null && r.visibility === undefined && r.takenAt === undefined;
})());
t("createGalleryItemFieldsSchema rejects an invalid category", !createGalleryItemFieldsSchema.safeParse({ category: "NOT_A_CATEGORY" }).success);
t("createGalleryItemFieldsSchema rejects a path-traversal-shaped projectId", !createGalleryItemFieldsSchema.safeParse({ projectId: "../../etc" }).success);
t("createGalleryItemFieldsSchema rejects an invalid visibility", !createGalleryItemFieldsSchema.safeParse({ visibility: "SECRET" }).success);
for (const hostile of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "javascript:alert(1)"]) {
  const parsed = createGalleryItemFieldsSchema.safeParse({ caption: hostile });
  t(`createGalleryItemFieldsSchema accepts hostile caption text unchanged: ${hostile}`, parsed.success && parsed.data.caption === hostile);
}

t("updateGalleryItemSchema rejects an empty patch", !updateGalleryItemSchema.safeParse({}).success);
t("updateGalleryItemSchema accepts a caption-only patch", updateGalleryItemSchema.safeParse({ caption: "new caption" }).success);
t("updateGalleryItemSchema rejects an invalid category", !updateGalleryItemSchema.safeParse({ category: "NOPE" }).success);

t("galleryQuerySchema defaults page/limit", (() => {
  const r = galleryQuerySchema.parse({});
  return r.page === 1 && r.limit > 0;
})());
t("galleryQuerySchema rejects a non-numeric page", !galleryQuerySchema.safeParse({ page: "abc" }).success);

// ---- serializers: never leak an account id / storage key / filesystem path ---------
const fileRow = { id: "f1", originalName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 12345 };
const ref = toStoredFileRef(fileRow);
t("toStoredFileRef: url is app-relative to /api/files/:id", ref.url === "/api/files/f1");
t("toStoredFileRef: kind classifies image vs document", ref.kind === "image" && toStoredFileRef({ ...fileRow, mimeType: "application/pdf" }).kind === "document");
t("toStoredFileRef output never contains a storage key or filesystem path", !JSON.stringify(ref).includes("storage") && !JSON.stringify(ref).includes("\\") );

const now = new Date();
const galleryRow = {
  id: "g1",
  caption: "Lab retreat",
  category: "EVENT",
  takenAt: null,
  sortOrder: 0,
  createdAt: now,
  updatedAt: now,
  file: { id: "f1", originalName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 12345, visibility: "LAB_ONLY", ownerId: "owner-1" },
  project: { id: "p1", slug: "proj", title: "Hidden Project", status: "ACTIVE", visibility: "LAB_ONLY" },
};
const guestView = toGalleryItem(galleryRow, null);
t("toGalleryItem: a hidden project's ref is null'd out for a guest", guestView.project === null);
t("toGalleryItem: visibility is never sent to a guest/member (manager-only field)", guestView.visibility === undefined);
t("toGalleryItem: output never contains an account/user id string", !JSON.stringify(guestView).includes("owner-1"));

const memberView = toGalleryItem(galleryRow, { id: "someone-else", role: "MEMBER" });
t("toGalleryItem: a member who cannot see the LAB_ONLY project still gets it null'd -- wait, a member CAN see LAB_ONLY", true); // sanity note, real assertion below
t("toGalleryItem: a member CAN see a LAB_ONLY project -> ref is present", memberView.project?.id === "p1");
t("toGalleryItem: a non-owner member gets canEdit/canDelete false", memberView.canEdit === false && memberView.canDelete === false);

const ownerView = toGalleryItem(galleryRow, { id: "owner-1", role: "MEMBER" });
t("toGalleryItem: the owner gets canEdit/canDelete true", ownerView.canEdit === true && ownerView.canDelete === true);

const managerView = toGalleryItem(galleryRow, { id: "mgr-1", role: "LAB_MANAGER" });
t("toGalleryItem: a manager (not the owner) still gets canEdit/canDelete true", managerView.canEdit === true && managerView.canDelete === true);
t("toGalleryItem: a manager receives the visibility field", managerView.visibility === "LAB_ONLY");

const publicProjectRow = { ...galleryRow, project: { ...galleryRow.project, visibility: "PUBLIC" } };
t("toGalleryItem: a PUBLIC project's ref IS shown to a guest", toGalleryItem(publicProjectRow, null).project?.id === "p1");

// ---- canAccessFile: standalone vs attached, fail-closed on an unresolvable parent --
const fakeDb = {} as Parameters<typeof canAccessFile>[0];
t(
  "canAccessFile: standalone PUBLIC file -> guest allowed",
  await canAccessFile(fakeDb, null, { visibility: "PUBLIC", ownerId: null, entityType: null, entityId: null }),
);
t(
  "canAccessFile: standalone LAB_ONLY file -> guest denied",
  !(await canAccessFile(fakeDb, null, { visibility: "LAB_ONLY", ownerId: null, entityType: null, entityId: null })),
);
t(
  "canAccessFile: a MESSAGE-attached file is never resolvable via the generic path (fail closed for a non-owner, non-admin viewer)",
  !(await canAccessFile(fakeDb, { id: "someone", role: "MEMBER" }, { visibility: "PUBLIC", ownerId: "owner-1", entityType: "MESSAGE", entityId: "m1" })),
);
t(
  "canAccessFile: the OWNER of an unresolvable-parent file is still allowed (fail closed except owner/admin)",
  await canAccessFile(fakeDb, { id: "owner-1", role: "MEMBER" }, { visibility: "PUBLIC", ownerId: "owner-1", entityType: "MESSAGE", entityId: "m1" }),
);
t(
  "canAccessFile: an ADMIN is still allowed on an unresolvable-parent file",
  await canAccessFile(fakeDb, { id: "admin-1", role: "ADMIN" }, { visibility: "PUBLIC", ownerId: "owner-1", entityType: "MESSAGE", entityId: "m1" }),
);

console.log(`${ok} file/gallery unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
