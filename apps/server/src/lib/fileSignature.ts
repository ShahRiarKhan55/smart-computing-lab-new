import type { AllowedMimeType } from "@scl/shared";

/**
 * Minimal magic-byte sniffing for the Phase 13 allow-list. This is deliberately NOT a general
 * file-type detector — it only has to answer "does this buffer actually look like one of our
 * allowed types", so that a renamed executable/script cannot pass an upload just because the
 * client declared a friendly `Content-Type` or the filename ends in `.jpg` (never trusted — see
 * fileService.ts). A file that fails every signature here is rejected outright, regardless of
 * what its name or declared MIME type claimed.
 */
export function sniffMimeType(buf: Buffer): AllowedMimeType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 6 && ["GIF87a", "GIF89a"].includes(buf.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}
