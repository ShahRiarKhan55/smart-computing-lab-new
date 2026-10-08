/**
 * Unit checks for the profile link validators (ORCID checksum, per-service hosts) and the header-only
 * image dimension reader used by the profile-photo upload gate (Phase 27 / P27.3, P27.6).
 *
 *   npm run test:unit -w apps/server
 */
import { isGoogleScholarUrl, isResearchGateUrl, normalizeOrcid, orcidToUrl, profileLinksOf } from "@scl/shared";
import { readImageDimensions } from "../src/lib/imageInfo.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(`${name}${detail ? ` -- ${detail}` : ""}`));
const eq = (name: string, got: unknown, want: unknown) => t(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---- ORCID ---------------------------------------------------------------------------------------
eq("a valid iD (ORCID's documentation example)", normalizeOrcid("0000-0002-1825-0097"), "0000-0002-1825-0097");
eq("a valid iD ending in X (check digit 10)", normalizeOrcid("0000-0002-1694-233X"), "0000-0002-1694-233X");
eq("a lower-case x is normalised", normalizeOrcid("0000-0002-1694-233x"), "0000-0002-1694-233X");
eq("a dash-less iD gets its dashes", normalizeOrcid("0000000218250097"), "0000-0002-1825-0097");
eq("an https://orcid.org/ link", normalizeOrcid("https://orcid.org/0000-0002-1825-0097"), "0000-0002-1825-0097");
eq("a scheme-less / www / trailing-slash / query orcid.org link", normalizeOrcid("www.orcid.org/0000-0002-1825-0097/?x=1"), "0000-0002-1825-0097");
eq("a wrong check digit is refused", normalizeOrcid("0000-0002-1825-0098"), null);
eq("a stray dash is refused", normalizeOrcid("0000-00-021825-0097"), null);
eq("too short", normalizeOrcid("0000-0002-1825"), null);
eq("letters in the body", normalizeOrcid("0000-0002-18A5-0097"), null);
eq("a look-alike host", normalizeOrcid("https://orcid.org.evil.test/0000-0002-1825-0097"), null);
eq("another site's URL", normalizeOrcid("https://example.test/0000-0002-1825-0097"), null);
eq("empty / non-string", normalizeOrcid("") === null && normalizeOrcid(null) === null && normalizeOrcid(5) === null, true);
eq("orcidToUrl", orcidToUrl("0000-0002-1825-0097"), "https://orcid.org/0000-0002-1825-0097");

// ---- hosts -----------------------------------------------------------------------------------------
eq("Scholar: scholar.google.com", isGoogleScholarUrl("https://scholar.google.com/citations?user=abc"), true);
eq("Scholar: a country domain", isGoogleScholarUrl("https://scholar.google.co.jp/citations?user=abc"), true);
eq("Scholar: http is tolerated (the link is only ever opened by the visitor)", isGoogleScholarUrl("http://scholar.google.com/x"), true);
eq("Scholar: javascript:", isGoogleScholarUrl("javascript:alert(1)"), false);
eq("Scholar: a look-alike suffix host", isGoogleScholarUrl("https://scholar.google.com.evil.test/x"), false);
eq("Scholar: a look-alike prefix host", isGoogleScholarUrl("https://evilscholar.google.com/x"), false);
eq("Scholar: embedded credentials", isGoogleScholarUrl("https://user:pw@scholar.google.com/x"), false);
eq("Scholar: not google at all", isGoogleScholarUrl("https://example.test/scholar.google.com"), false);
eq("RG: www.researchgate.net", isResearchGateUrl("https://www.researchgate.net/profile/Some-One"), true);
eq("RG: researchgate.net", isResearchGateUrl("https://researchgate.net/profile/Some-One"), true);
eq("RG: a look-alike", isResearchGateUrl("https://researchgate.net.evil.test/profile/x"), false);
eq("RG: ftp", isResearchGateUrl("ftp://www.researchgate.net/profile/x"), false);

// ---- profileLinksOf -----------------------------------------------------------------------------------
eq("no links -> empty (nothing is rendered)", profileLinksOf({ scholarUrl: "", researchGateUrl: "", orcid: "" }).length, 0);
eq("one link", profileLinksOf({ scholarUrl: "", researchGateUrl: "", orcid: "0000-0002-1825-0097" }).map((l) => l.kind).join(), "orcid");
eq("all three, in display order", profileLinksOf({ scholarUrl: "https://scholar.google.com/citations?user=a", researchGateUrl: "https://www.researchgate.net/profile/a", orcid: "0000-0002-1825-0097" }).map((l) => l.kind).join(), "scholar,researchgate,orcid");
eq("a stale/unsafe stored value is dropped on read, not rendered", profileLinksOf({ scholarUrl: "javascript:alert(1)", researchGateUrl: "https://evil.test/", orcid: "garbage" }).length, 0);

// ---- image headers --------------------------------------------------------------------------------------
const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const dims = (b: Buffer, mime: string) => {
  const d = readImageDimensions(b, mime);
  return d ? `${d.width}x${d.height}` : null;
};
eq("PNG dimensions", dims(png(640, 480), "image/png"), "640x480");
eq("PNG truncated before IHDR data -> null", readImageDimensions(png(1, 1).subarray(0, 18), "image/png"), null);
eq("PNG without an IHDR tag -> null", readImageDimensions(Buffer.concat([png(1, 1).subarray(0, 12), Buffer.from("XXXX"), Buffer.alloc(20)]), "image/png"), null);
eq("PNG 0 x 0 -> null", readImageDimensions(png(0, 0), "image/png"), null);

const jpeg = (w: number, h: number, withApp0 = true) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    withApp0 ? Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]) : Buffer.alloc(0),
    Buffer.from([0xff, 0xc2, 0x00, 0x0b, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x01, 0x01, 0x11, 0x00]), // progressive SOF2
    Buffer.alloc(8),
  ]);
eq("JPEG dimensions (after an APP0 segment, progressive SOF2)", dims(jpeg(800, 600), "image/jpeg"), "800x600");
eq("JPEG with the frame header right after SOI", dims(jpeg(32, 48, false), "image/jpeg"), "32x48");
eq("JPEG with no frame header (EOI first) -> null", readImageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0]), "image/jpeg"), null);
eq("JPEG truncated mid-segment -> null", readImageDimensions(jpeg(10, 10).subarray(0, 16), "image/jpeg"), null);
eq("JPEG garbage after SOI -> null", readImageDimensions(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(40, 0x41)]), "image/jpeg"), null);

const riff = (fourcc: string, body: Buffer) => {
  const b = Buffer.alloc(20 + body.length);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(12 + body.length, 4);
  b.write("WEBP", 8, "latin1");
  b.write(fourcc, 12, "latin1");
  b.writeUInt32LE(body.length, 16);
  body.copy(b, 20);
  return b;
};
const vp8x = Buffer.alloc(10);
vp8x.writeUIntLE(1920 - 1, 4, 3);
vp8x.writeUIntLE(1080 - 1, 7, 3);
eq("WEBP VP8X dimensions", dims(riff("VP8X", vp8x), "image/webp"), "1920x1080");
const vp8l = Buffer.alloc(10);
vp8l[0] = 0x2f;
vp8l.writeUInt32LE((300 - 1) | ((200 - 1) << 14), 1);
eq("WEBP VP8L (lossless) dimensions", dims(riff("VP8L", vp8l), "image/webp"), "300x200");
const vp8 = Buffer.alloc(14);
vp8.set([0x9d, 0x01, 0x2a], 3);
vp8.writeUInt16LE(640, 6);
vp8.writeUInt16LE(360, 8);
eq("WEBP VP8 (lossy) dimensions", dims(riff("VP8 ", vp8), "image/webp"), "640x360");
eq("WEBP VP8 with a bad start code -> null", readImageDimensions(riff("VP8 ", Buffer.alloc(14)), "image/webp"), null);
eq("WEBP too short -> null", readImageDimensions(Buffer.alloc(16), "image/webp"), null);
eq("an unsupported mime (gif) -> null", readImageDimensions(png(1, 1), "image/gif"), null);

console.log(`\n${ok} profile link / image header unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
