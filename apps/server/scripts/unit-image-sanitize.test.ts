/**
 * Tests of the lossless image sanitizer (src/lib/imageSanitize.ts). Pure functions over generated in-memory fixtures
 * (scripts/imageFixtures.ts): no database, network, files or real photographs.
 *
 * What these tests establish (about KNOWN metadata containers only; see "documented limits" below for what is retained): for every accepted input, none of the sentinel strings planted in KNOWN metadata containers survive, only allowlisted structures
 * remain (checked by an INDEPENDENT lister written here, not by the sanitizer's own parser), the compressed image payload bytes
 * are identical, sanitizing twice gives identical bytes, and output is never larger than the input. For every malformed or
 * unsupported input the only outcome is a typed ImageHeaderError. What they do NOT establish: that any image decodes (the fixtures'
 * JPEG/GIF/WebP payloads are arbitrary bytes, and the sanitizer is structural by design).
 *   npm run test:unit -w apps/server
 */
import zlib from "node:zlib";
import { ImageHeaderError, inspectImage, type ImageHeaderReason } from "../src/lib/imageHeader.ts";
import { SANITIZER_LIMITS, readExifOrientation, sanitizeImage } from "../src/lib/imageSanitize.ts";
import * as F from "./imageFixtures.ts";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

type Outcome = { kind: "ok"; out: Buffer; changed: boolean } | { kind: "rejected"; reason: ImageHeaderReason } | { kind: "crash"; error: unknown };
const run = (input: Buffer, mime: string): Outcome => {
  try {
    const r = sanitizeImage(input, mime);
    return { kind: "ok", out: r.bytes, changed: r.changed };
  } catch (e) {
    return e instanceof ImageHeaderError ? { kind: "rejected", reason: e.reason } : { kind: "crash", error: e };
  }
};
const MIME = { jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" } as const;
const rejects = (input: Buffer, mime: string, reason?: ImageHeaderReason) => {
  const o = run(input, mime);
  return o.kind === "rejected" && (reason === undefined || o.reason === reason);
};
const accepted = (input: Buffer, mime: string): Buffer => {
  const o = run(input, mime);
  if (o.kind !== "ok") throw new Error(`expected acceptance, got ${o.kind}${o.kind === "rejected" ? ` (${o.reason})` : ""}`);
  return o.out;
};
const hasText = (b: Buffer, s: string) => b.includes(Buffer.from(s, "latin1"));
const noSentinels = (b: Buffer) => F.ALL_SENTINEL_STRINGS.every((s) => !hasText(b, s));
const idempotent = (out: Buffer, mime: string) => {
  const again = run(out, mime);
  return again.kind === "ok" && again.out.equals(out);
};

// ---- independent structure listers (NOT the sanitizer's code) ----------------------------------------------------------------
interface Item {
  name: string;
  data: Buffer;
}
function listJpeg(b: Buffer): { items: Item[]; endsAt: number } {
  const items: Item[] = [];
  let i = 2;
  for (;;) {
    while (b[i] === 0xff && b[i + 1] === 0xff) i++;
    if (b[i] !== 0xff) throw new Error(`lister: no marker at ${i}`);
    const m = b[i + 1];
    i += 2;
    if (m === 0xd9) return { items, endsAt: i };
    const len = b.readUInt16BE(i);
    const seg = b.subarray(i + 2, i + len);
    items.push({ name: m.toString(16).toUpperCase(), data: seg });
    i += len;
    if (m === 0xda) {
      const start = i;
      for (;;) {
        if (b[i] === 0xff && b[i + 1] !== 0x00 && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7) && b[i + 1] !== 0xff) break;
        i++;
      }
      items.push({ name: "SCAN", data: b.subarray(start, i) });
    }
  }
}
function listPng(b: Buffer): Item[] {
  const items: Item[] = [];
  let i = 8;
  while (i < b.length) {
    const len = b.readUInt32BE(i);
    items.push({ name: b.subarray(i + 4, i + 8).toString("latin1"), data: b.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
  }
  return items;
}
function listWebp(b: Buffer): Item[] {
  const items: Item[] = [];
  let i = 12;
  while (i < b.length) {
    const len = b.readUInt32LE(i + 4);
    items.push({ name: b.subarray(i, i + 4).toString("latin1"), data: b.subarray(i + 8, i + 8 + len) });
    i += 8 + len + (len % 2);
  }
  return items;
}
function listGif(b: Buffer): { lead: Buffer; blocks: Item[] } {
  const packed = b[10];
  let i = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
  const lead = b.subarray(0, i);
  const blocks: Item[] = [];
  const skip = (p: number) => {
    while (b[p] !== 0) p += b[p] + 1;
    return p + 1;
  };
  while (b[i] !== 0x3b) {
    const start = i;
    if (b[i] === 0x21) {
      const label = b[i + 1];
      i = skip(i + 2);
      blocks.push({ name: `EXT${label.toString(16)}`, data: b.subarray(start, i) });
    } else {
      const flags = b[i + 9];
      let p = i + 10 + (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0) + 1;
      i = skip(p);
      blocks.push({ name: "IMAGE", data: b.subarray(start, i) });
    }
  }
  if (i + 1 !== b.length) throw new Error("lister: data after GIF trailer");
  return { lead, blocks };
}
const names = (items: Item[]) => items.map((x) => x.name);
const same = (a: Buffer[], b: Buffer[]) => a.length === b.length && a.every((x, i) => x.equals(b[i]));
const orientationOf = (tiff: Buffer) => readExifOrientation(tiff);

// =========================================================================================================================
// JPEG
{
  const input = F.jpegWithEverything(6);
  t("fixture sanity: the JPEG fixture really carries the sentinels", F.ALL_SENTINEL_STRINGS.filter((s) => hasText(input, s)).length >= 9);
  const out = accepted(input, MIME.jpeg);
  t("JPEG: no sentinel string from a known metadata container survives (EXIF GPS/make/model/maker note/thumbnail/description/artist, XMP, IPTC, comment, MPF, JFIF thumbnail, appended payload)", noSentinels(out));
  const { items, endsAt } = listJpeg(out);
  t("JPEG: the output ends exactly at the first end marker; nothing follows it", endsAt === out.length);
  const allowed = new Set(["E0", "E1", "E2", "EE", "DB", "C4", "DD", "C0", "C1", "C2", "DA", "SCAN"]);
  t("JPEG: only allowlisted segments remain (independent lister)", items.every((x) => allowed.has(x.name)));
  t("JPEG: exactly one scan and one frame header, no second image", items.filter((x) => x.name === "DA").length === 1 && items.filter((x) => ["C0", "C1", "C2"].includes(x.name)).length === 1 && endsAt === out.length);
  const app1 = items.filter((x) => x.name === "E1");
  t("JPEG: exactly one APP1 remains and it is the 34-byte minimal orientation block", app1.length === 1 && app1[0].data.length === 32 && app1[0].data.subarray(0, 6).toString("latin1") === "Exif\0\0" && orientationOf(app1[0].data.subarray(6)) === 6);
  t("JPEG: the minimal EXIF holds a single entry (nothing but Orientation)", app1[0].data.subarray(6).readUInt16BE(8) === 1);
  const jfif = items.find((x) => x.name === "E0");
  t("JPEG: JFIF header rebuilt without its thumbnail (16 bytes, thumbnail 0x0), version and density kept", !!jfif && jfif.data.length === 14 && jfif.data[12] === 0 && jfif.data[13] === 0 && jfif.data.subarray(5, 7).equals(Buffer.from([1, 1])) && jfif.data.readUInt16BE(8) === 72);
  t("JPEG: ICC profile segment kept byte-for-byte", hasText(out, F.ICC_PAYLOAD) && items.filter((x) => x.name === "E2").length === 1);
  t("JPEG: Adobe APP14 kept", items.some((x) => x.name === "EE"));
  const inItems = listJpeg(input).items;
  const pick = (list: Item[], ...n: string[]) => list.filter((x) => n.includes(x.name)).map((x) => x.data);
  t("JPEG: quantization/Huffman/frame/scan header segments are byte-identical", same(pick(inItems, "DB", "C4", "C0", "DA"), pick(items, "DB", "C4", "C0", "DA")));
  t("JPEG: entropy-coded scan data (with FF00 stuffing and RSTn markers) is byte-identical", same(pick(inItems, "SCAN"), pick(items, "SCAN")) && hasText(pick(items, "SCAN")[0], String.fromCharCode(0xff, 0xd0)));
  t("JPEG: output is smaller than the input and still passes the structural inspector", out.length < input.length && inspectImage(out).format === "jpeg" && inspectImage(out).width === 64);
  t("JPEG: sanitizing the output again gives identical bytes (idempotent)", idempotent(out, MIME.jpeg));
  t("JPEG: deterministic (same input twice gives identical bytes)", accepted(input, MIME.jpeg).equals(out));
}
{
  // orientation matrix, both byte orders
  for (const little of [false, true]) {
    for (let o = 1; o <= 8; o++) {
      const input = F.jpegFile({ before: [F.jpegApp1Exif(F.exifTiff({ orientation: o, little, rich: true }))] });
      const out = accepted(input, MIME.jpeg);
      const app1 = listJpeg(out).items.filter((x) => x.name === "E1");
      const good = o === 1 ? app1.length === 0 : app1.length === 1 && orientationOf(app1[0].data.subarray(6)) === o && app1[0].data.length === 32;
      t(`JPEG orientation ${o} (${little ? "little" : "big"}-endian EXIF): ${o === 1 ? "default needs no block" : "preserved in a minimal block"}`, good && noSentinels(out));
    }
  }
  const none = accepted(F.jpegFile({ before: [F.jpegApp1Exif(F.exifTiff({ rich: true, orientation: null }))] }), MIME.jpeg);
  t("JPEG: rich EXIF without an Orientation tag leaves no EXIF at all", listJpeg(none).items.every((x) => x.name !== "E1") && noSentinels(none));
  const bytesOut = accepted(F.jpegFile({ before: [F.jpegApp1Exif(F.exifTiff({ orientation: 8 }))] }), MIME.jpeg);
  t("JPEG: a photo that already has only the minimal block comes out identical", bytesOut.equals(accepted(bytesOut, MIME.jpeg)));
}
{
  // malformed / ambiguous orientation data is rejected, never silently dropped
  const exif = (tiff: Buffer) => F.jpegFile({ before: [F.jpegApp1Exif(tiff)] });
  const good = F.exifTiff({ orientation: 6 });
  const patched = (fn: (b: Buffer) => void) => {
    const b = Buffer.from(good);
    fn(b);
    return b;
  };
  const cases: [string, Buffer][] = [
    ["a TIFF header that is neither II nor MM", patched((b) => b.write("XX", 0, "latin1"))],
    ["a wrong TIFF magic number", patched((b) => b.writeUInt16BE(43, 2))],
    ["an IFD offset past the end of the block", patched((b) => b.writeUInt32BE(0xffff, 4))],
    ["an IFD offset inside the header", patched((b) => b.writeUInt32BE(4, 4))],
    ["an entry count that runs past the block", patched((b) => b.writeUInt16BE(500, 8))],
    ["an absurd entry count", patched((b) => b.writeUInt16BE(60000, 8))],
    ["a block too short to hold a header", Buffer.from("MM\0*")],
    ["an Orientation of the wrong type (LONG)", F.exifTiff({ orientation: 6, orientationType: 4 })],
    ["an Orientation with count 2", F.exifTiff({ orientation: 6, orientationCount: 2 })],
    ["an Orientation value of 0", F.exifTiff({ orientation: 0 })],
    ["an Orientation value of 9", F.exifTiff({ orientation: 9 })],
    ["an Orientation value of 65535", F.exifTiff({ orientation: 65535 })],
    ["two Orientation entries (even equal ones)", F.exifTiff({ orientation: 6, duplicateOrientation: true })],
  ];
  for (const [name, tiff] of cases) t(`JPEG rejects malformed orientation: ${name}`, rejects(exif(tiff), MIME.jpeg, "bad_orientation"));
  t("JPEG rejects two Exif APP1 segments (ambiguous orientation)", rejects(F.jpegFile({ before: [F.jpegApp1Exif(F.exifTiff({ orientation: 6 })), F.jpegApp1Exif(F.exifTiff({ orientation: 3 }))] }), MIME.jpeg, "bad_orientation"));
  // Partial or damaged EXIF signatures are never silently discarded (they may hold an Orientation).
  const app1 = (payload: Buffer) => F.jpegFile({ before: [F.jpegSeg(0xe1, payload)] });
  const valid6 = F.exifTiff({ orientation: 6 });
  const partial: [string, Buffer][] = [
    ['"Exif\\0" followed by a TIFF block (one NUL missing)', Buffer.concat([Buffer.from("Exif\0", "latin1"), valid6])],
    ['"Exif\\0" followed by a stray byte and a TIFF block', Buffer.concat([Buffer.from("Exif\0X", "latin1"), valid6])],
    ['"Exif" alone', Buffer.from("Exif", "latin1")],
    ['"Exif" followed directly by a TIFF block', Buffer.concat([Buffer.from("Exif", "latin1"), valid6])],
    ['"Exif\\0" alone', Buffer.from("Exif\0", "latin1")],
    ['a complete signature with an empty TIFF block', Buffer.from("Exif\0\0", "latin1")],
  ];
  for (const [name, payload] of partial) t(`JPEG rejects a partial/damaged EXIF signature: ${name}`, rejects(app1(payload), MIME.jpeg, "bad_orientation"));
  t("JPEG: a valid Exif APP1 followed by a partial-signature APP1 is a conflict and is rejected", rejects(F.jpegFile({ before: [F.jpegApp1Exif(valid6), F.jpegSeg(0xe1, Buffer.concat([Buffer.from("Exif\0", "latin1"), valid6]))] }), MIME.jpeg, "bad_orientation"));
  t("JPEG: a partial-signature APP1 followed by a valid Exif APP1 is a conflict and is rejected", rejects(F.jpegFile({ before: [F.jpegSeg(0xe1, Buffer.concat([Buffer.from("Exif\0", "latin1"), valid6])), F.jpegApp1Exif(valid6)] }), MIME.jpeg, "bad_orientation"));
  t("JPEG: an XMP APP1 (not an EXIF signature) is still just dropped", accepted(F.jpegFile({ before: [F.jpegXmp()] }), MIME.jpeg).length > 0 && noSentinels(accepted(F.jpegFile({ before: [F.jpegXmp()] }), MIME.jpeg)));
  const lenOf = valid6.length;
  const offsets: [string, number][] = [
    ["an IFD offset exactly at the end of the block", lenOf],
    ["an IFD offset one byte before the end (count field would straddle the end)", lenOf - 1],
    ["an IFD offset of 0xFFFFFFFF", 0xffffffff],
    ["an IFD offset of 7 (inside the header)", 7],
  ];
  for (const [name, off] of offsets) t(`JPEG rejects malformed TIFF offsets: ${name}`, rejects(exif(patched((b) => b.writeUInt32BE(off, 4))), MIME.jpeg, "bad_orientation"));
  t("JPEG rejects a little-endian TIFF with a bad IFD offset too", rejects(exif(Buffer.from((() => { const b = Buffer.from(F.exifTiff({ orientation: 6, little: true })); b.writeUInt32LE(9999, 4); return b; })())), MIME.jpeg, "bad_orientation"));
  t("JPEG rejects a duplicate orientation whose values CONFLICT (6 and 3)", rejects(exif((() => { const b = Buffer.from(F.exifTiff({ orientation: 6, duplicateOrientation: true })); b.writeUInt16BE(3, 8 + 2 + 12 + 8); return b; })()), MIME.jpeg, "bad_orientation"));
  t("JPEG: a non-Exif APP1 (XMP) is simply dropped, not parsed as orientation", noSentinels(accepted(F.jpegFile({ before: [F.jpegXmp()] }), MIME.jpeg)));
}
{
  // trailing data, structure and bounds
  const second = F.jpegFile({ before: [F.jpegApp1Exif(F.exifTiff({ rich: true, orientation: 1 }))] });
  const plain = F.jpegFile();
  const withSecond = Buffer.concat([plain, second]);
  const cleaned = accepted(withSecond, MIME.jpeg);
  t("JPEG: an appended second complete JPEG is cut off at the first end marker", cleaned.equals(accepted(plain, MIME.jpeg)) && noSentinels(cleaned) && cleaned.length === plain.length);
  t("JPEG: arbitrary appended bytes (a ZIP-like tail) are cut off", accepted(Buffer.concat([plain, Buffer.from("PK\u0003\u0004SENTINEL-APPENDED-PAYLOAD")]), MIME.jpeg).equals(plain));
  t("JPEG: fill bytes (FF FF) before markers are accepted and normalised", (() => { const o = run(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xff]), plain.subarray(2)]), MIME.jpeg); return o.kind === "ok" && o.out.equals(plain); })());
  t("JPEG: progressive (SOF2) with a second scan, tables between scans kept, a comment between scans dropped", (() => {
    const dht = F.jpegSeg(0xc4, Buffer.concat([Buffer.from([0x10, 1]), Buffer.alloc(15, 0), Buffer.from([0])]));
    const sos2 = F.jpegSeg(0xda, Buffer.from([3, 1, 0, 2, 0, 3, 0, 0, 63, 0]));
    const input = F.jpegFile({ sof: 0xc2, after: [F.jpegComment(), dht, sos2, Buffer.from([0x99, 0xff, 0x00, 0x88])] });
    const out = accepted(input, MIME.jpeg);
    const l = names(listJpeg(out).items);
    return noSentinels(out) && l.filter((x) => x === "SCAN").length === 2 && l.filter((x) => x === "DA").length === 2 && l.includes("C2") && idempotent(out, MIME.jpeg);
  })());
  t("JPEG: a two-chunk ICC profile is kept in order", (() => { const o = accepted(F.jpegFile({ before: [F.jpegIcc(1, 2, "AAAA"), F.jpegIcc(2, 2, "BBBB")] }), MIME.jpeg); return hasText(o, "AAAA") && o.indexOf("AAAA") < o.indexOf("BBBB"); })());

  const seg = F.jpegSeg;
  const rej: [string, Buffer, ImageHeaderReason?][] = [
    ["no end marker", F.jpegFile({ noEoi: true }), "truncated"],
    ["a truncated file", plain.subarray(0, 40)],
    ["a segment length running past the end", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0xff, 0xf0]), Buffer.alloc(10)]), "truncated"],
    ["a segment length below 2", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]), Buffer.alloc(10)])],
    ["an unsupported marker (JPG0)", F.jpegFile({ before: [seg(0xf0, Buffer.alloc(4))] }), "unsupported_variant"],
    ["lossless/arithmetic encodings (SOF3)", F.jpegFile({ sof: 0xc3 }), "unsupported_variant"],
    ["a DNL marker", F.jpegFile({ after: [seg(0xdc, Buffer.from([0, 1]))] }), "unsupported_variant"],
    ["two frame headers", F.jpegFile({ before: [seg(0xc0, Buffer.from([8, 0, 20, 0, 20, 1, 1, 0x11, 0]))] }), "malformed"],
    ["a scan before any frame header", Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([1, 2]), Buffer.from([0xff, 0xd9])]), "malformed"],
    ["a restart-interval segment of the wrong size", F.jpegFile({ before: [seg(0xdd, Buffer.from([0, 1, 2]))] }), "malformed"],
    ["an Adobe segment of the wrong size", F.jpegFile({ before: [seg(0xee, Buffer.concat([Buffer.from("Adobe", "latin1"), Buffer.alloc(3)]))] }), "malformed"],
    ["two JFIF headers", F.jpegFile({ before: [F.jpegJfif(false), F.jpegJfif(false)] }), "malformed"],
    ["an ICC chunk numbered beyond its count", F.jpegFile({ before: [F.jpegIcc(3, 2)] }), "malformed"],
    ["an ICC profile with a missing chunk", F.jpegFile({ before: [F.jpegIcc(1, 2)] }), "malformed"],
    ["duplicate ICC chunk numbers", F.jpegFile({ before: [F.jpegIcc(1, 2), F.jpegIcc(1, 2)] }), "malformed"],
    ["inconsistent ICC chunk counts", F.jpegFile({ before: [F.jpegIcc(1, 2), F.jpegIcc(2, 3)] }), "malformed"],
    ["a standalone restart marker in the header", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd0]), plain.subarray(2)]), "malformed"],
    ["an entropy segment that never reaches a marker", Buffer.concat([plain.subarray(0, plain.length - 2), Buffer.from([0x12, 0x34])]), "truncated"],
    ["a file that is only SOI + EOI", Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "malformed"],
    ["too many segments", F.jpegFile({ before: Array.from({ length: SANITIZER_LIMITS.jpegSegments + 5 }, () => F.jpegComment()) }), "too_complex"],
  ];
  for (const [name, bytes, reason] of rej) t(`JPEG rejects: ${name}`, rejects(bytes, MIME.jpeg, reason));
  t("JPEG rejects an oversized canvas even though it is otherwise clean", rejects(F.jpegFile({ w: 7000, h: 100 }), MIME.jpeg, "too_large"));
  // Retained table and header segments are checked against their structure (the segment must be consumed exactly).
  {
    const J = F.jpegSeg;
    const base = F.jpegFile();
    const dqtOk = Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 3)]);
    const dhtOk = Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(15, 0), Buffer.from([0])]);
    const frame = (mut: (b: Buffer) => void, comps = 3) => {
      const b = Buffer.alloc(6 + 3 * comps);
      b[0] = 8; b.writeUInt16BE(48, 1); b.writeUInt16BE(64, 3); b[5] = comps;
      for (let i = 0; i < comps; i++) b.set([i + 1, 0x11, 0], 6 + 3 * i);
      mut(b);
      return b;
    };
    const sosBody = (mut: (b: Buffer) => void) => { const b = Buffer.from([3, 1, 0, 2, 0, 3, 0, 0, 63, 0]); mut(b); return b; };
    const build = (parts: { dqt?: Buffer | null; sof?: Buffer; dht?: Buffer; sos?: Buffer; sofMarker?: number }) =>
      Buffer.concat([Buffer.from([0xff, 0xd8]), ...(parts.dqt === null ? [] : [J(0xdb, parts.dqt ?? dqtOk)]), J(parts.sofMarker ?? 0xc0, parts.sof ?? frame(() => {})), J(0xc4, parts.dht ?? dhtOk), J(0xda, parts.sos ?? sosBody(() => {})), F.SCAN_DATA, Buffer.from([0xff, 0xd9])]);
    t("JPEG fixture builder sanity: the spec-valid parts are accepted", accepted(build({}), MIME.jpeg).length > 0);
    t("JPEG accepts two DQT tables in one segment (8-bit and 16-bit) and an extended-sequential frame", accepted(build({ dqt: Buffer.concat([dqtOk, Buffer.from([0x11]), Buffer.alloc(128, 3)]), sofMarker: 0xc1 }), MIME.jpeg).length > 0);
    t("JPEG accepts a DHT segment with two tables", accepted(build({ dht: Buffer.concat([dhtOk, Buffer.from([0x10, 1]), Buffer.alloc(15, 0), Buffer.from([5])]) }), MIME.jpeg).length > 0);
    const bad: [string, Buffer][] = [
      ["a DQT with trailing bytes after its table (arbitrary data riding along)", build({ dqt: Buffer.concat([dqtOk, Buffer.from("SENTINEL-DQT-PAYLOAD")]) })],
      ["a DQT that is too short for its table", build({ dqt: dqtOk.subarray(0, 40) })],
      ["a DQT with precision 2", build({ dqt: Buffer.concat([Buffer.from([0x20]), Buffer.alloc(64, 3)]) })],
      ["a DQT with table id 4", build({ dqt: Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 3)]) })],
      ["an empty DQT", build({ dqt: Buffer.alloc(0) })],
      ["no DQT before the scan", build({ dqt: null })],
      ["a DHT with trailing bytes after its table", build({ dht: Buffer.concat([dhtOk, Buffer.from("SENTINEL-DHT-PAYLOAD")]) })],
      ["a DHT shorter than its declared symbol count", build({ dht: Buffer.concat([Buffer.from([0, 5]), Buffer.alloc(15, 0), Buffer.from([0])]) })],
      ["a DHT with zero symbols", build({ dht: Buffer.concat([Buffer.from([0]), Buffer.alloc(16, 0)]) })],
      ["a DHT with more than 256 symbols", build({ dht: Buffer.concat([Buffer.from([0]), Buffer.alloc(16, 255)]) })],
      ["a DHT with class 2", build({ dht: Buffer.concat([Buffer.from([0x20, 1]), Buffer.alloc(15, 0), Buffer.from([0])]) })],
      ["a DHT shorter than its header", build({ dht: Buffer.alloc(10) })],
      ["a frame header with precision 3", build({ sof: frame((b) => (b[0] = 3)) })],
      ["a frame header with precision 12 (not decodable by browsers)", build({ sof: frame((b) => (b[0] = 12)), sofMarker: 0xc1 })],
      ["a frame header with zero width", build({ sof: frame((b) => b.writeUInt16BE(0, 3)) })],
      ["a frame header with zero height", build({ sof: frame((b) => b.writeUInt16BE(0, 1)) })],
      ["a frame header with 0 components", build({ sof: frame(() => {}, 0) })],
      ["a frame header with 5 components", build({ sof: frame(() => {}, 5) })],
      ["a frame header whose length does not match its component count", build({ sof: Buffer.concat([frame(() => {}), Buffer.from("SENTINEL")]) })],
      ["a frame header with a sampling factor of 0", build({ sof: frame((b) => (b[7] = 0x01)) })],
      ["a frame header with a sampling factor of 5", build({ sof: frame((b) => (b[7] = 0x51)) })],
      ["a frame header with quantization table id 4", build({ sof: frame((b) => (b[8] = 4)) })],
      ["a frame header with duplicate component ids", build({ sof: frame((b) => (b[9] = b[6])) })],
      ["a scan header whose length does not match its components", build({ sos: Buffer.concat([sosBody(() => {}), Buffer.from("SENTINEL")]) })],
      ["a scan header with 0 components", build({ sos: Buffer.from([0, 0, 63, 0]) })],
      ["a scan header with a table selector of 4", build({ sos: sosBody((b) => (b[2] = 0x04)) })],
      ["a scan header with Ss > Se", build({ sos: sosBody((b) => { b[7] = 40; b[8] = 10; }) })],
      ["a scan header with Se of 64", build({ sos: sosBody((b) => (b[8] = 64)) })],
    ];
    for (const [name, bytes] of bad) t(`JPEG rejects: ${name}`, rejects(bytes, MIME.jpeg, "malformed"));
    const withScan = (after: Buffer) => Buffer.concat([base.subarray(0, base.length - 2), after]);
    t("JPEG rejects entropy data followed by a reserved marker (FF 01) instead of EOI", rejects(withScan(Buffer.from([0xff, 0x01, 0xff, 0xd9])), MIME.jpeg, "malformed"));
    t("JPEG rejects entropy data followed by a DNL marker (unsupported) instead of EOI", rejects(withScan(Buffer.from([0xff, 0xdc, 0, 4, 0, 1, 0xff, 0xd9])), MIME.jpeg));
    t("JPEG: entropy data runs right up to EOI and every byte of it is preserved", (() => {
      const out = accepted(base, MIME.jpeg);
      return out.subarray(out.length - 2 - F.SCAN_DATA.length, out.length - 2).equals(F.SCAN_DATA);
    })());
    t("JPEG: kept table/frame/scan segments are copied byte for byte", (() => {
      const out = accepted(base, MIME.jpeg);
      return listJpeg(base).items.filter((x) => ["DB", "C4", "C0", "DA"].includes(x.name)).every((x) => out.includes(x.data));
    })());
  }
}

// =========================================================================================================================
// PNG
{
  const input = F.pngWithEverything(6);
  t("fixture sanity: the PNG fixture carries the sentinels", F.ALL_SENTINEL_STRINGS.filter((s) => hasText(input, s)).length >= 5);
  const out = accepted(input, MIME.png);
  const items = listPng(out);
  t("PNG: no sentinel string from a known metadata container survives (tEXt, iTXt, GPS eXIf, private chunk, ...)", noSentinels(out));
  const allowed = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "bKGD", "eXIf"]);
  t("PNG: only allowlisted chunks remain (independent lister)", names(items).every((n) => allowed.has(n)));
  t("PNG: text, compressed text, XMP, timestamp, density and private chunks are gone", ["tEXt", "zTXt", "iTXt", "tIME", "pHYs", "prVt"].every((n) => !names(items).includes(n)));
  t("PNG: rendering chunks (gAMA, sRGB, sBIT, tRNS, bKGD) are kept", ["gAMA", "sRGB", "sBIT", "tRNS", "bKGD"].every((n) => names(items).includes(n)));
  const exif = items.filter((x) => x.name === "eXIf");
  t("PNG: a single minimal eXIf with orientation 6 only, placed before the image data", exif.length === 1 && exif[0].data.length === 26 && orientationOf(exif[0].data) === 6 && names(items).indexOf("eXIf") < names(items).indexOf("IDAT"));
  const idatIn = listPng(input).filter((x) => x.name === "IDAT").map((x) => x.data);
  const idatOut = items.filter((x) => x.name === "IDAT").map((x) => x.data);
  t("PNG: IDAT payload is byte-identical, with the same chunk boundaries (3 chunks)", idatOut.length === 3 && same(idatIn, idatOut));
  const raw = (idats: Buffer[]) => zlib.inflateSync(Buffer.concat(idats));
  t("PNG: the image data inflates to identical scanlines", raw(idatIn).equals(raw(idatOut)));
  t("PNG: smaller than the input, passes the inspector, idempotent, deterministic", out.length < input.length && inspectImage(out).format === "png" && idempotent(out, MIME.png) && accepted(input, MIME.png).equals(out));
  t("PNG: a colour profile (iCCP) is kept", names(listPng(accepted(F.pngFile({ before: [F.pngIccp()] }), MIME.png))).includes("iCCP"));
}
{
  const cleanPng = F.pngFile();
  t("PNG: a file with nothing to remove comes out identical", accepted(cleanPng, MIME.png).equals(cleanPng) && run(cleanPng, MIME.png).kind === "ok" && (run(cleanPng, MIME.png) as { changed: boolean }).changed === false);
  for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const out = accepted(F.pngFile({ before: [F.pngExif(F.exifTiff({ orientation: o, rich: true }))] }), MIME.png);
    const e = listPng(out).filter((x) => x.name === "eXIf");
    t(`PNG orientation ${o}: ${o === 1 ? "no eXIf kept" : "preserved in a minimal eXIf"}`, noSentinels(out) && (o === 1 ? e.length === 0 : e.length === 1 && orientationOf(e[0].data) === o));
  }
  const late = accepted(F.pngFile({ afterIdat: [F.pngExif(F.exifTiff({ orientation: 8, rich: true }))] }), MIME.png);
  const lateItems = listPng(late);
  t("PNG: an eXIf AFTER the image data keeps its orientation (placed just before IEND)", noSentinels(late) && orientationOf(lateItems.find((x) => x.name === "eXIf")!.data) === 8 && names(lateItems).at(-2) === "eXIf");
  t("PNG: an eXIf with the optional 'Exif\\0\\0' prefix is understood", orientationOf(listPng(accepted(F.pngFile({ before: [F.pngExif(Buffer.concat([Buffer.from("Exif\0\0", "latin1"), F.exifTiff({ orientation: 3 })]))] }), MIME.png)).find((x) => x.name === "eXIf")!.data) === 3);

  const bad = Buffer.from(F.exifTiff({ orientation: 6 }));
  bad.writeUInt16BE(9, 18);
  t("PNG rejects a malformed eXIf orientation (value 9)", rejects(F.pngFile({ before: [F.pngExif(bad)] }), MIME.png, "bad_orientation"));
  t("PNG rejects an eXIf that is not a TIFF block", rejects(F.pngFile({ before: [F.pngChunk("eXIf", Buffer.from("garbage-not-exif-data"))] }), MIME.png, "bad_orientation"));
  t("PNG rejects two eXIf chunks", rejects(F.pngFile({ before: [F.pngExif(F.exifTiff({ orientation: 6 })), F.pngExif(F.exifTiff({ orientation: 6 }))] }), MIME.png, "bad_orientation"));
  t("PNG rejects animation (APNG: acTL/fcTL/fdAT) with the still-image message", rejects(F.apngFile(), MIME.png, "animated"));
  t("PNG rejects a stray fcTL as well", rejects(F.pngFile({ before: [F.pngChunk("fcTL", Buffer.alloc(26))] }), MIME.png, "animated"));
  try {
    sanitizeImage(F.apngFile(), MIME.png);
  } catch (e) {
    t("PNG: the animation refusal tells the user to upload a still image", /still image/.test((e as Error).message));
  }

  const flip = (b: Buffer, at: number) => {
    const c = Buffer.from(b);
    c[at] ^= 0xff;
    return c;
  };
  const withText = F.pngFile({ before: [F.pngText()] });
  const textStart = 8 + 25; // after signature + IHDR
  t("PNG rejects a CRC failure even inside a chunk that would have been dropped", rejects(flip(withText, textStart + 10), MIME.png, "bad_checksum"));
  t("PNG rejects a CRC failure in IHDR", rejects(flip(cleanPng, 8 + 10), MIME.png, "bad_checksum"));
  t("PNG rejects a CRC failure in IDAT", rejects(flip(cleanPng, 8 + 25 + 12), MIME.png, "bad_checksum"));
  const idats = F.pngIdat(40, 24);
  const rej: [string, Buffer, ImageHeaderReason?][] = [
    ["a file truncated mid-chunk", cleanPng.subarray(0, 60), "truncated"],
    ["a file without IEND", cleanPng.subarray(0, cleanPng.length - 12), "truncated"],
    ["data after IEND", Buffer.concat([cleanPng, Buffer.from("x")]), "malformed"],
    ["IHDR not first", Buffer.concat([F.PNG_SIG, F.pngText(), F.pngIhdr(40, 24), ...idats, F.pngChunk("IEND")])],
    ["a duplicate IHDR", Buffer.concat([F.PNG_SIG, F.pngIhdr(40, 24), F.pngIhdr(40, 24), ...idats, F.pngChunk("IEND")]), "malformed"],
    ["a chunk length of 0x7fffffff", Buffer.concat([F.PNG_SIG, F.pngIhdr(40, 24), Buffer.from([0x7f, 0xff, 0xff, 0xff, 0x49, 0x44, 0x41, 0x54])]), "truncated"],
    ["a chunk length beyond 2^31", Buffer.concat([F.PNG_SIG, F.pngIhdr(40, 24), Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 0x44, 0x41, 0x54, 0, 0, 0, 0])]), "truncated"],
    ["a palette image without PLTE", Buffer.concat([F.PNG_SIG, F.pngIhdr(40, 24, 8, 3), ...idats, F.pngChunk("IEND")]), "malformed"],
    ["a PLTE after the image data", Buffer.concat([F.PNG_SIG, F.pngIhdr(40, 24), ...idats, F.pngChunk("PLTE", Buffer.alloc(3)), F.pngChunk("IEND")]), "malformed"],
    ["an unknown CRITICAL chunk", F.pngFile({ before: [F.pngChunk("ABCD", Buffer.alloc(4))] }), "unsupported_variant"],
    ["IDAT chunks that are not contiguous", Buffer.concat([F.PNG_SIG, F.pngIhdr(40, 24), ...F.pngIdat(40, 24, 0x40, 2).slice(0, 1), F.pngText(), ...F.pngIdat(40, 24, 0x40, 2).slice(1), F.pngChunk("IEND")]), "malformed"],
    ["transparency data on a colour type that cannot have it (RGBA)", Buffer.concat([F.PNG_SIG, F.pngIhdr(40, 24, 8, 6), F.pngChunk("tRNS", Buffer.alloc(6)), ...idats, F.pngChunk("IEND")]), "malformed"],
    ["both sRGB and iCCP (ambiguous colour information)", F.pngFile({ before: [F.pngChunk("sRGB", Buffer.from([0])), F.pngIccp()] }), "malformed"],
    ["a gAMA chunk of the wrong length", F.pngFile({ before: [F.pngChunk("gAMA", Buffer.alloc(3))] }), "malformed"],
    ["a duplicated gAMA chunk", F.pngFile({ before: [F.pngChunk("gAMA", Buffer.alloc(4)), F.pngChunk("gAMA", Buffer.alloc(4))] }), "malformed"],
    ["a kept chunk after the image data (gAMA)", F.pngFile({ afterIdat: [F.pngChunk("gAMA", Buffer.alloc(4))] }), "malformed"],
    ["no image data", Buffer.concat([F.PNG_SIG, F.pngIhdr(40, 24), F.pngChunk("IEND")]), "malformed"],
    ["too many chunks", F.pngFile({ before: Array.from({ length: SANITIZER_LIMITS.pngChunks + 5 }, () => F.pngChunk("tEXt", Buffer.from("a\0b", "latin1"))) }), "too_complex"],
    ["an unsupported colour type/bit depth pair", Buffer.concat([F.PNG_SIG, F.pngIhdr(40, 24, 3, 2), ...idats, F.pngChunk("IEND")])],
  ];
  for (const [name, bytes, reason] of rej) t(`PNG rejects: ${name}`, rejects(bytes, MIME.png, reason));
  t("PNG: an unknown ANCILLARY chunk is dropped (not rejected)", noSentinels(accepted(F.pngFile({ before: [F.pngPrivate()] }), MIME.png)));
  t("PNG rejects a 60000 x 60000 claim (decompression-bomb shape)", rejects(Buffer.concat([F.PNG_SIG, F.pngIhdr(60000, 60000), ...F.pngIdat(8, 8), F.pngChunk("IEND")]), MIME.png, "too_large"));
  // Retained ancillary chunks are checked against the PNG specification (length per colour type, value ranges, order).
  {
    const ch = F.pngChunk;
    const idat = F.pngIdat(40, 24);
    const png = (color: number, depth: number, mid: Buffer[], tail: Buffer[] = []) => Buffer.concat([F.PNG_SIG, F.pngIhdr(40, 24, depth, color), ...mid, ...idat, ...tail, ch("IEND")]);
    const plte = (n: number) => ch("PLTE", Buffer.alloc(3 * n, 9));
    const iccp = (name: string, method: number, z: Buffer) => ch("iCCP", Buffer.concat([Buffer.from(name, "latin1"), Buffer.from([0, method]), z]));
    const zok = zlib.deflateSync(Buffer.from("profile"));
    const ok: [string, Buffer][] = [
      ["RGB tRNS (3 x 16-bit samples within 8-bit range)", png(2, 8, [ch("tRNS", Buffer.from([0, 255, 0, 0, 0, 7]))])],
      ["grayscale 16-bit tRNS and bKGD", png(0, 16, [ch("tRNS", Buffer.from([0xff, 0xff])), ch("bKGD", Buffer.from([0x12, 0x34]))])],
      ["indexed image with PLTE, tRNS (fewer entries than the palette) and bKGD (a valid index)", png(3, 8, [plte(4), ch("tRNS", Buffer.from([0, 128])), ch("bKGD", Buffer.from([3]))])],
      ["a 4-bit indexed image with a 16-entry palette", png(3, 4, [plte(16)])],
      ["sBIT for RGBA", png(6, 8, [ch("sBIT", Buffer.from([8, 8, 8, 1]))])],
      ["a well-formed iCCP", png(2, 8, [iccp("icc", 0, zok)])],
    ];
    for (const [name, bytes] of ok) t(`PNG accepts and keeps a well-formed retained chunk: ${name}`, accepted(bytes, MIME.png).length > 0);
    const big = ch("tRNS", Buffer.alloc(3 * 1024 * 1024, 1));
    const rejects2: [string, Buffer][] = [
      ["a multi-megabyte tRNS on an RGB image (carries arbitrary bytes)", png(2, 8, [big])],
      ["a multi-megabyte bKGD on an RGB image", png(2, 8, [ch("bKGD", Buffer.alloc(2 * 1024 * 1024))])],
      ["a multi-megabyte sBIT", png(2, 8, [ch("sBIT", Buffer.alloc(1024 * 1024, 1))])],
      ["tRNS of the wrong length for grayscale", png(0, 8, [ch("tRNS", Buffer.alloc(6))])],
      ["tRNS of the wrong length for RGB", png(2, 8, [ch("tRNS", Buffer.alloc(2))])],
      ["tRNS sample above the bit depth's range (8-bit, 0x0100)", png(2, 8, [ch("tRNS", Buffer.from([1, 0, 0, 0, 0, 0]))])],
      ["indexed tRNS with more entries than the palette", png(3, 8, [plte(2), ch("tRNS", Buffer.alloc(3))])],
      ["indexed tRNS before the palette", png(3, 8, [ch("tRNS", Buffer.alloc(1)), plte(2)])],
      ["indexed bKGD with an index outside the palette", png(3, 8, [plte(2), ch("bKGD", Buffer.from([2]))])],
      ["bKGD of the wrong length for RGB", png(2, 8, [ch("bKGD", Buffer.alloc(2))])],
      ["bKGD of the wrong length for grayscale", png(0, 8, [ch("bKGD", Buffer.alloc(6))])],
      ["sBIT of the wrong length", png(2, 8, [ch("sBIT", Buffer.from([8, 8]))])],
      ["sBIT value of 0", png(2, 8, [ch("sBIT", Buffer.from([0, 8, 8]))])],
      ["sBIT value above the bit depth", png(2, 8, [ch("sBIT", Buffer.from([9, 8, 8]))])],
      ["gAMA of zero", png(2, 8, [ch("gAMA", Buffer.alloc(4))])],
      ["cHRM of the wrong length", png(2, 8, [ch("cHRM", Buffer.alloc(31))])],
      ["sRGB rendering intent 4", png(2, 8, [ch("sRGB", Buffer.from([4]))])],
      ["sRGB of the wrong length", png(2, 8, [ch("sRGB", Buffer.alloc(2))])],
      ["iCCP without a name terminator within 80 bytes", png(2, 8, [ch("iCCP", Buffer.alloc(100, 0x61))])],
      ["iCCP with an empty profile name", png(2, 8, [iccp("", 0, zok)])],
      ["iCCP with an 80-byte profile name", png(2, 8, [iccp("a".repeat(80), 0, zok)])],
      ["iCCP name with a leading space", png(2, 8, [iccp(" icc", 0, zok)])],
      ["iCCP name containing a control character", png(2, 8, [iccp("ic\x01c", 0, zok)])],
      ["iCCP with compression method 1", png(2, 8, [iccp("icc", 1, zok)])],
      ["iCCP whose payload is not a zlib stream", png(2, 8, [iccp("icc", 0, Buffer.from("SENTINEL-NOT-ZLIB-DATA"))])],
      ["iCCP with a truncated zlib stream header", png(2, 8, [iccp("icc", 0, Buffer.from([0x78]))])],
      ["a colour-space chunk (gAMA) after the palette", png(3, 8, [plte(2), ch("gAMA", Buffer.from([0, 0, 0xb1, 0x8f]))])],
      ["a palette with more entries than the bit depth allows (5 entries at 2 bits)", png(3, 2, [plte(5)])],
      ["an interlace method of 2", Buffer.concat([F.PNG_SIG, ch("IHDR", Buffer.concat([Buffer.from([0, 0, 0, 40, 0, 0, 0, 24]), Buffer.from([8, 2, 0, 0, 2])])), ...idat, ch("IEND")])],
      ["a non-zero compression method in IHDR", Buffer.concat([F.PNG_SIG, ch("IHDR", Buffer.concat([Buffer.from([0, 0, 0, 40, 0, 0, 0, 24]), Buffer.from([8, 2, 1, 0, 0])])), ...idat, ch("IEND")])],
    ];
    for (const [name, bytes] of rejects2) t(`PNG rejects: ${name}`, rejects(bytes, MIME.png, "malformed"));
    t("PNG: accepted output keeps the IDAT payload bytes exactly (tightened validation does not alter image data)", (() => {
      const out = accepted(png(2, 8, [ch("gAMA", Buffer.from([0, 0, 0xb1, 0x8f]))]), MIME.png);
      return Buffer.concat(listPng(out).filter((x) => x.name === "IDAT").map((x) => x.data)).equals(Buffer.concat(listPng(png(2, 8, [])).filter((x) => x.name === "IDAT").map((x) => x.data)));
    })());
  }
}

// =========================================================================================================================
// WebP
{
  for (const lossless of [false, true]) {
    const label = lossless ? "lossless (VP8L)" : "lossy (VP8)";
    const input = F.webpWithEverything(6, { lossless });
    t(`fixture sanity (${label}): carries EXIF/XMP/unknown sentinels`, hasText(input, F.SENTINELS.webpXmp) && hasText(input, F.SENTINELS.gps) && hasText(input, F.SENTINELS.unknown));
    const out = accepted(input, MIME.webp);
    const items = listWebp(out);
    t(`WebP ${label}: no sentinel string from a known metadata container survives`, noSentinels(out));
    t(`WebP ${label}: only VP8X, ICCP, the image chunk and the minimal EXIF remain`, names(items).join() === ["VP8X", "ICCP", lossless ? "VP8L" : "VP8 ", "EXIF"].join());
    const flags = items[0].data[0];
    t(`WebP ${label}: container flags rewritten (ICC kept, EXIF set for orientation, XMP and animation clear)`, (flags & 0x20) === 0x20 && (flags & 0x08) === 0x08 && (flags & 0x04) === 0 && (flags & 0x02) === 0 && items[0].data.subarray(1, 4).equals(Buffer.alloc(3)));
    t(`WebP ${label}: the EXIF chunk is the 26-byte minimal block with orientation 6`, items.at(-1)!.data.length === 26 && orientationOf(items.at(-1)!.data) === 6);
    t(`WebP ${label}: ICC profile and image payload are byte-identical`, items[1].data.toString("latin1") === F.WEBP_ICC && items[2].data.equals(listWebp(input)[2].data));
    t(`WebP ${label}: RIFF size equals the file length minus 8 and every chunk is padded to even length`, out.readUInt32LE(4) + 8 === out.length && out.length % 2 === 0);
    t(`WebP ${label}: smaller, passes the inspector with the right size, idempotent, deterministic`, out.length < input.length && inspectImage(out).width === 64 && idempotent(out, MIME.webp) && accepted(input, MIME.webp).equals(out));
  }
  const odd = F.riff(Buffer.concat([F.webpChunk("VP8X", F.vp8x(64, 48, 0)), F.webpChunk("VP8 ", F.vp8Payload(64, 48, 21)), F.webpChunk("XMP ", Buffer.from(F.SENTINELS.webpXmp, "latin1"))]));
  const oddOut = accepted(odd, MIME.webp);
  t("WebP: an odd-length image chunk keeps its padding byte and a consistent RIFF size", oddOut.readUInt32LE(4) + 8 === oddOut.length && listWebp(oddOut)[1].data.length === 10 + 21 && noSentinels(oddOut));
  for (const o of [1, null]) {
    const out = accepted(F.riff(Buffer.concat([F.webpChunk("VP8X", F.vp8x(64, 48, 0x08)), F.webpChunk("VP8 ", F.vp8Payload(64, 48, 20)), F.webpChunk("EXIF", F.exifTiff({ rich: true, orientation: o }))])), MIME.webp);
    t(`WebP: orientation ${o === null ? "absent" : "1 (default)"} leaves no EXIF chunk and clears the flag`, noSentinels(out) && !names(listWebp(out)).includes("EXIF") && (listWebp(out)[0].data[0] & 0x08) === 0);
  }
  for (let o = 2; o <= 8; o++) {
    const out = accepted(F.webpWithEverything(o), MIME.webp);
    t(`WebP orientation ${o} preserved in a minimal EXIF chunk`, orientationOf(listWebp(out).at(-1)!.data) === o);
  }
  const simpleLossy = F.riff(F.webpChunk("VP8 ", F.vp8Payload(64, 48, 20)));
  const simpleLossless = F.riff(F.webpChunk("VP8L", F.vp8lPayload(64, 48, 20)));
  t("WebP: simple lossy and lossless files come out identical", accepted(simpleLossy, MIME.webp).equals(simpleLossy) && accepted(simpleLossless, MIME.webp).equals(simpleLossless));
  const alpha = F.riff(Buffer.concat([F.webpChunk("VP8X", F.vp8x(64, 48, 0x10 | 0x04)), F.webpChunk("ALPH", Buffer.alloc(9, 3)), F.webpChunk("VP8 ", F.vp8Payload(64, 48, 20)), F.webpChunk("XMP ", Buffer.from(F.SENTINELS.webpXmp))]));
  const alphaOut = accepted(alpha, MIME.webp);
  t("WebP: alpha (ALPH + VP8) is kept with its flag; XMP removed", names(listWebp(alphaOut)).join() === "VP8X,ALPH,VP8 " && (listWebp(alphaOut)[0].data[0] & 0x10) === 0x10 && noSentinels(alphaOut));

  const x = (flags: number) => F.webpChunk("VP8X", F.vp8x(64, 48, flags));
  const img = F.webpChunk("VP8 ", F.vp8Payload(64, 48, 20));
  const rej: [string, Buffer, ImageHeaderReason?][] = [
    ["the animation flag", F.riff(Buffer.concat([x(0x02), img])), "animated"],
    ["an ANIM chunk", F.riff(Buffer.concat([x(0), F.webpChunk("ANIM", Buffer.alloc(6)), img])), "animated"],
    ["an ANMF frame chunk", F.riff(Buffer.concat([x(0), F.webpChunk("ANMF", Buffer.alloc(30))])), "animated"],
    ["a malformed EXIF orientation (value 9)", F.riff(Buffer.concat([x(0x08), img, F.webpChunk("EXIF", F.exifTiff({ orientation: 9 }))])), "bad_orientation"],
    ["an EXIF chunk that is not a TIFF block", F.riff(Buffer.concat([x(0x08), img, F.webpChunk("EXIF", Buffer.from("SENTINEL-WEBP-EXIF"))])), "bad_orientation"],
    ["two EXIF chunks", F.riff(Buffer.concat([x(0x08), img, F.webpChunk("EXIF", F.exifTiff({ orientation: 6 })), F.webpChunk("EXIF", F.exifTiff({ orientation: 6 }))])), "bad_orientation"],
    ["an EXIF chunk without an extended header", F.riff(Buffer.concat([img, F.webpChunk("EXIF", F.exifTiff({ orientation: 6 }))])), "malformed"],
    ["a RIFF size that does not match the file", Buffer.concat([F.riff(img), Buffer.from("xx")]), "malformed"],
    ["a chunk running past the end", (() => { const b = Buffer.from(F.riff(img)); b.writeUInt32LE(500, 16); return b; })(), "truncated"],
    ["a chunk length beyond 2^31", (() => { const b = Buffer.from(F.riff(img)); b.writeUInt32LE(0xffffffff, 16); return b; })(), "truncated"],
    ["an ICC flag without an ICC chunk", F.riff(Buffer.concat([x(0x20), img])), "malformed"],
    ["an ICC chunk without the flag", F.riff(Buffer.concat([x(0), F.webpChunk("ICCP", Buffer.alloc(8)), img])), "malformed"],
    ["a canvas that does not match the image", F.riff(Buffer.concat([F.webpChunk("VP8X", F.vp8x(65, 48, 0)), img])), "malformed"],
    ["two image chunks", F.riff(Buffer.concat([x(0), img, img])), "malformed"],
    ["alpha data with a lossless image", F.riff(Buffer.concat([x(0x10), F.webpChunk("ALPH", Buffer.alloc(4)), F.webpChunk("VP8L", F.vp8lPayload(64, 48, 20))])), "malformed"],
    ["no image chunk", F.riff(x(0)), "malformed"],
    ["an unknown first chunk", F.riff(F.webpChunk("ABCD", Buffer.alloc(8))), "malformed"],
    ["a wrong VP8 start code", F.riff(F.webpChunk("VP8 ", Buffer.alloc(14))), "malformed"],
    ["a duplicated VP8X", F.riff(Buffer.concat([x(0), x(0), img])), "malformed"],
    ["too many chunks", F.riff(Buffer.concat([x(0), ...Array.from({ length: SANITIZER_LIMITS.webpChunks + 5 }, () => F.webpChunk("UNKN", Buffer.alloc(2))), img])), "too_complex"],
  ];
  for (const [name, bytes, reason] of rej) t(`WebP rejects: ${name}`, rejects(bytes, MIME.webp, reason));
  t("WebP: an unknown chunk after the image is dropped (not rejected)", noSentinels(accepted(F.riff(Buffer.concat([x(0), img, F.webpChunk("UNKN", Buffer.from(F.SENTINELS.unknown))])), MIME.webp)));
}

// =========================================================================================================================
// GIF
{
  const input = F.gifFile({ gce: true, extras: [F.gifNetscape(), F.gifComment(), F.gifXmp(), F.gifPlainText()] });
  t("fixture sanity: the GIF fixture carries comment, XMP and plain-text sentinels", [F.SENTINELS.gifComment, F.SENTINELS.gifXmp, F.SENTINELS.gifText].every((s) => hasText(input, s)));
  const out = accepted(input, MIME.gif);
  const { lead, blocks } = listGif(out);
  const inGif = listGif(input);
  t("GIF: no sentinel string from a known metadata container survives", noSentinels(out));
  t("GIF: only the control block and the image remain (comment, XMP, looping and plain-text extensions removed)", names(blocks).join() === "EXTf9,IMAGE");
  t("GIF: header, screen descriptor and colour table are byte-identical", lead.equals(inGif.lead));
  t("GIF: the image block (descriptor + LZW data) and the control block are byte-identical", same(blocks.map((x) => x.data), inGif.blocks.filter((x) => ["EXTf9", "IMAGE"].includes(x.name)).map((x) => x.data)));
  t("GIF: smaller, ends with the trailer, passes the inspector, idempotent, deterministic", out.length < input.length && out.at(-1) === 0x3b && inspectImage(out).width === 48 && idempotent(out, MIME.gif) && accepted(input, MIME.gif).equals(out));
  const clean = F.gifFile();
  t("GIF: a still GIF with nothing to remove comes out identical", accepted(clean, MIME.gif).equals(clean));
  t("GIF: a looping extension on a single frame is dropped (still image)", !hasText(accepted(F.gifFile({ extras: [F.gifNetscape()] }), MIME.gif), "NETSCAPE"));
  const rej: [string, Buffer, ImageHeaderReason?][] = [
    ["two frames (animation)", F.gifFile({ frames: 2 }), "animated"],
    ["an animated GIF with a looping extension", F.gifFile({ frames: 3, extras: [F.gifNetscape()] }), "animated"],
    ["a missing trailer", F.gifFile({ trailer: false }), "truncated"],
    ["data after the trailer", Buffer.concat([F.gifFile(), Buffer.from("xx")]), "malformed"],
    ["an invalid block introducer", F.gifFile({ extras: [Buffer.from([0x99])] }), "malformed"],
    ["an unknown extension label", F.gifFile({ extras: [Buffer.from([0x21, 0x77, 1, 0, 0])] }), "unsupported_variant"],
    ["a control block of the wrong size", F.gifFile({ extras: [Buffer.from([0x21, 0xf9, 3, 0, 0, 0, 0])] }), "malformed"],
    ["two control blocks before one image", F.gifFile({ extras: [F.gifGce(1), F.gifGce(2)] }), "malformed"],
    ["a truncated sub-block", Buffer.concat([F.gifFile().subarray(0, F.gifFile().length - 6)]), "truncated"],
    ["no image at all", Buffer.concat([F.gifFile().subarray(0, 19), Buffer.from([0x3b])]), "malformed"],
    ["too many blocks", F.gifFile({ extras: Array.from({ length: SANITIZER_LIMITS.gifBlocks + 5 }, () => F.gifComment()) }), "too_complex"],
    ["a file shorter than its header", Buffer.from("GIF89a\u0001\u0000"), "malformed"],
  ];
  for (const [name, bytes, reason] of rej) t(`GIF rejects: ${name}`, rejects(bytes, MIME.gif, reason));
  t("GIF: the animation refusal tells the user to upload a still image", (() => { try { sanitizeImage(F.gifFile({ frames: 2 }), MIME.gif); return false; } catch (e) { return /still image/.test((e as Error).message); } })());
}

// =========================================================================================================================
// Cross-format: unsupported types, mismatches, fuzz
{
  // DOCUMENTED LIMITS: the sanitizer removes KNOWN metadata containers; it is not a re-encoder. Opaque bytes inside retained
  // structures are preserved by design. These checks pin that behaviour so nobody mistakes the sanitizer for a full scrub.
  {
    const MARK = Buffer.from("OPAQUE-PAYLOAD-INSIDE-RETAINED-STRUCTURE");
    const survives = (input: Buffer, mime: string) => accepted(input, mime).includes(MARK);
    const counts = Buffer.alloc(17);
    counts[16] = MARK.length;
    t("documented limit (JPEG): marker-free bytes inside the entropy-coded data are retained", survives(F.jpegFile({ scan: Buffer.concat([F.SCAN_DATA, MARK]) }), MIME.jpeg));
    t("documented limit (JPEG): the body of an ICC profile segment is retained and not inspected", survives(F.jpegFile({ before: [F.jpegIcc(1, 1, MARK.toString())] }), MIME.jpeg));
    t("documented limit (JPEG): Huffman table symbol bytes are retained", survives(F.jpegFile({ before: [F.jpegSeg(0xc4, Buffer.concat([counts, MARK]))] }), MIME.jpeg));
    t("documented limit (PNG): bytes after the end of the zlib stream inside IDAT are retained", survives(Buffer.concat([F.PNG_SIG, F.pngIhdr(40, 24), F.pngChunk("IDAT", Buffer.concat([zlib.deflateSync(Buffer.alloc((40 * 3 + 1) * 24, 0x40)), MARK])), F.pngChunk("IEND")]), MIME.png));
    t("documented limit (PNG): an iCCP profile stored in a (valid) uncompressed deflate block is retained", survives(F.pngFile({ before: [F.pngChunk("iCCP", Buffer.concat([Buffer.from("icc\0\0"), zlib.deflateSync(MARK, { level: 0 })]))] }), MIME.png));
    t("documented limit (WebP): bytes after the bitstream inside the VP8 / VP8L chunk are retained", survives(F.riff(F.webpChunk("VP8 ", Buffer.concat([F.vp8Payload(64, 48), MARK]))), MIME.webp) && survives(F.riff(F.webpChunk("VP8L", Buffer.concat([F.vp8lPayload(64, 48), MARK]))), MIME.webp));
  }

  t("sanitizer: an unsupported type is refused", rejects(Buffer.from("%PDF-1.4"), "application/pdf", "unsupported_format"));
  t("sanitizer: bytes of one format declared as another are refused", rejects(F.pngFile(), MIME.jpeg) && rejects(F.jpegFile(), MIME.png) && rejects(F.gifFile(), MIME.webp));
  t("sanitizer: empty input is refused", rejects(Buffer.alloc(0), MIME.jpeg) && rejects(Buffer.alloc(0), MIME.png) && rejects(Buffer.alloc(0), MIME.gif) && rejects(Buffer.alloc(0), MIME.webp));
  t("sanitizer: oversized claimed dimensions are refused by the same limits as before", rejects(F.jpegFile({ w: 100, h: 7000 }), MIME.jpeg, "too_large") && rejects(F.jpegFile({ w: 8, h: 8 }), MIME.jpeg, "too_small"));

  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const bases: [Buffer, string][] = [
    [F.jpegWithEverything(6), MIME.jpeg],
    [F.jpegFile({ sof: 0xc2, after: [F.jpegComment()] }), MIME.jpeg],
    [F.pngWithEverything(6), MIME.png],
    [F.webpWithEverything(6), MIME.webp],
    [F.webpWithEverything(3, { lossless: true }), MIME.webp],
    [F.gifFile({ gce: true, extras: [F.gifNetscape(), F.gifComment(), F.gifXmp()] }), MIME.gif],
  ];
  let runs = 0;
  let crashes = 0;
  let accepts = 0;
  let badAccepts = 0;
  for (const [base, mime] of bases) {
    for (let i = 0; i < 700; i++) {
      const b = Buffer.from(base);
      const mode = i % 5;
      if (mode === 0) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
      else if (mode === 1) for (let k = 0; k < 4; k++) b[Math.floor(rnd() * b.length)] ^= 1 << Math.floor(rnd() * 8);
      else if (mode === 2) b.fill(Math.floor(rnd() * 256), Math.floor(rnd() * b.length), Math.min(b.length, Math.floor(rnd() * b.length) + 8));
      const input = mode === 3 ? b.subarray(0, Math.floor(rnd() * b.length)) : mode === 4 ? Buffer.concat([b.subarray(0, Math.floor(rnd() * b.length)), b.subarray(Math.floor(rnd() * b.length))]) : b;
      runs++;
      const o = run(input, mime);
      if (o.kind === "crash") crashes++;
      if (o.kind === "ok") {
        accepts++;
        // anything accepted must be well-formed output: never larger, passes the inspector, stable under a second pass
        let fine = o.out.length <= input.length;
        try {
          inspectImage(o.out);
        } catch {
          fine = false;
        }
        if (!idempotent(o.out, mime)) fine = false;
        if (!fine) badAccepts++;
      }
    }
  }
  t(`fuzz: ${runs} mutated/truncated/spliced inputs ended only in a result or a typed ImageHeaderError (${crashes} crashes)`, crashes === 0);
  t(`fuzz: all ${accepts} accepted outputs were no larger than their input, structurally valid and idempotent (${badAccepts} bad)`, badAccepts === 0 && accepts > 0);
}

const out = process.stdout.write.bind(process.stdout);
out(`${ok} image-sanitize unit checks passed, ${failures.length} failed.\n`);
if (failures.length) {
  out(`Failures:\n${failures.map((f) => ` - ${f}`).join("\n")}\n`);
  process.exitCode = 1;
}
