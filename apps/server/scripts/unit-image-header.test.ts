/**
 * Tests of the structural image inspector (src/lib/imageHeader.ts). Pure functions over in-memory buffers: no database, no
 * network, no files. The fixtures are generated here; the PNG ones are real PNGs (deflated scanlines), the JPEG/GIF/WebP ones are
 * minimal container-valid files built byte by byte. The inspector validates structure and dimensions only; it does not decode
 * pixels, and these tests do not claim it does.
 *   npm run test:unit -w apps/server
 */
import zlib from "node:zlib";
import { ImageHeaderError, PROFILE_PHOTO_LIMITS, assertWithinLimits, inspectImage, inspectProfilePhoto, type ImageHeaderReason } from "../src/lib/imageHeader.ts";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));
const reasonOf = (fn: () => unknown): ImageHeaderReason | "no-error" | "other-error" => {
  try {
    fn();
    return "no-error";
  } catch (e) {
    return e instanceof ImageHeaderError ? e.reason : "other-error";
  }
};

// ---- fixtures -----------------------------------------------------------------------------------------------------------
const CRC = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tbl[n] = c >>> 0;
  }
  return (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = tbl[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = (w: number, h: number, depth = 8, color = 2, interlace = 0) => {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(w, 0);
  d.writeUInt32BE(h, 4);
  d[8] = depth;
  d[9] = color;
  d[12] = interlace;
  return chunk("IHDR", d);
};
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A REAL, decodable PNG (RGB, filter 0). */
function realPng(w: number, h: number): Buffer {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x7f)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([PNG_SIG, ihdr(w, h), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
/** Declares any canvas size with a tiny IDAT: the shape of a decompression bomb. Container-valid, not decodable. */
const claimedPng = (w: number, h: number) => Buffer.concat([PNG_SIG, ihdr(w, h), chunk("IDAT", Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])), chunk("IEND", Buffer.alloc(0))]);

const seg = (marker: number, body: Buffer) => {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
};
function jpeg(w: number, h: number, opts: { sof?: number; precision?: number; comps?: number; eoi?: boolean; noSos?: boolean } = {}): Buffer {
  const comps = opts.comps ?? 3;
  const sof = Buffer.alloc(6 + 3 * comps);
  sof[0] = opts.precision ?? 8;
  sof.writeUInt16BE(h, 1);
  sof.writeUInt16BE(w, 3);
  sof[5] = comps;
  const parts = [Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")), seg(opts.sof ?? 0xc0, sof)];
  if (!opts.noSos) parts.push(seg(0xda, Buffer.from([comps, 1, 0, 0, 63, 0])), Buffer.from([0x12, 0x34, 0x56]));
  if (opts.eoi !== false) parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

function gif(w: number, h: number, opts: { trailer?: boolean; extra?: Buffer; images?: number } = {}): Buffer {
  const head = Buffer.alloc(13);
  head.write("GIF89a", 0, "latin1");
  head.writeUInt16LE(w, 6);
  head.writeUInt16LE(h, 8);
  head[10] = 0x80; // global colour table, 2 entries
  const table = Buffer.alloc(6);
  const image = Buffer.concat([Buffer.from([0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0]), Buffer.from([2, 2, 0x44, 0x01, 0])]);
  const images = Array.from({ length: opts.images ?? 1 }, () => image);
  return Buffer.concat([head, table, ...(opts.extra ? [opts.extra] : []), ...images, ...(opts.trailer === false ? [] : [Buffer.from([0x3b])])]);
}

const riff = (payload: Buffer) => {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(4 + payload.length);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), size, Buffer.from("WEBP", "latin1"), payload]);
};
const wchunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from(type, "latin1"), len, data, ...(data.length % 2 ? [Buffer.alloc(1)] : [])]);
};
const webpLossy = (w: number, h: number) => {
  const d = Buffer.alloc(10);
  d[3] = 0x9d;
  d[4] = 0x01;
  d[5] = 0x2a;
  d.writeUInt16LE(w, 6);
  d.writeUInt16LE(h, 8);
  return riff(wchunk("VP8 ", d));
};
const webpLossless = (w: number, h: number) => {
  const d = Buffer.alloc(5);
  d[0] = 0x2f;
  d.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 1);
  return riff(wchunk("VP8L", d));
};
const webpExt = (w: number, h: number) => {
  const d = Buffer.alloc(10);
  d.writeUIntLE(w - 1, 4, 3);
  d.writeUIntLE(h - 1, 7, 3);
  return riff(wchunk("VP8X", d));
};

// ---- valid files ----------------------------------------------------------------------------------------------------------
{
  const png = inspectImage(realPng(40, 24));
  t("PNG: a real PNG is read (40x24)", png.format === "png" && png.width === 40 && png.height === 24);
  t("PNG: a container-valid file may declare a large canvas (inspection alone does not limit)", inspectImage(claimedPng(5000, 5000)).width === 5000);
  const jp = inspectImage(jpeg(640, 480));
  t("JPEG: baseline read (640x480)", jp.format === "jpeg" && jp.width === 640 && jp.height === 480);
  t("JPEG: progressive (SOF2) accepted", inspectImage(jpeg(100, 100, { sof: 0xc2 })).format === "jpeg");
  t("JPEG: grayscale (1 component) and CMYK (4) accepted", inspectImage(jpeg(64, 64, { comps: 1 })).width === 64 && inspectImage(jpeg(64, 64, { comps: 4 })).width === 64);
  const g = inspectImage(gif(48, 32));
  t("GIF: read (48x32)", g.format === "gif" && g.width === 48 && g.height === 32);
  t("GIF: multi-frame accepted", inspectImage(gif(48, 32, { images: 3 })).format === "gif");
  t("GIF: a well-formed extension block is skipped", inspectImage(gif(48, 32, { extra: Buffer.from([0x21, 0xf9, 4, 0, 0, 0, 0, 0]) })).format === "gif");
  t("WebP: lossy (VP8) read", inspectImage(webpLossy(300, 200)).width === 300);
  t("WebP: lossless (VP8L) read", inspectImage(webpLossless(321, 123)).height === 123);
  t("WebP: extended (VP8X) read", inspectImage(webpExt(1024, 768)).width === 1024);
  t("limits: a normal photo passes", reasonOf(() => inspectProfilePhoto(realPng(64, 64), "image/png")) === "no-error");
  t("limits: exactly the minimum side passes", reasonOf(() => assertWithinLimits({ format: "png", width: 16, height: 16 })) === "no-error");
  t("limits: exactly the maximum side and pixel count pass", reasonOf(() => assertWithinLimits({ format: "png", width: 6000, height: 4000 })) === "no-error");
}

// ---- dimension limits -----------------------------------------------------------------------------------------------------
{
  t("limits: below the minimum side is too_small", reasonOf(() => assertWithinLimits({ format: "png", width: 15, height: 200 })) === "too_small");
  t("limits: over the maximum side is too_large", reasonOf(() => inspectProfilePhoto(claimedPng(6001, 100), "image/png")) === "too_large");
  t("limits: a huge canvas in a tiny file is too_large", reasonOf(() => inspectProfilePhoto(claimedPng(60000, 60000), "image/png")) === "too_large");
  t("limits: sides within range but too many pixels", reasonOf(() => assertWithinLimits({ format: "png", width: 5000, height: 5000 })) === "too_many_pixels");
  t("limits: zero dimensions", reasonOf(() => assertWithinLimits({ format: "jpeg", width: 0, height: 100 })) === "zero_dimension");
  t("limits: a JPEG declaring 0 height is refused", reasonOf(() => inspectProfilePhoto(jpeg(100, 0), "image/jpeg")) === "zero_dimension");
  t("limits: the 32-bit PNG maximum cannot overflow the pixel product", reasonOf(() => inspectProfilePhoto(claimedPng(0x7fffffff, 0x7fffffff), "image/png")) === "too_large");
  t("limits: a JPEG at 65535x65535 is too_large", reasonOf(() => inspectProfilePhoto(jpeg(65535, 65535), "image/jpeg")) === "too_large");
  t("limits: a GIF at 65535x65535 is too_large", reasonOf(() => inspectProfilePhoto(gif(65535, 65535), "image/gif")) === "too_large");
  t("limits: a WebP at the 14-bit maximum is too_large", reasonOf(() => inspectProfilePhoto(webpLossless(16384, 16384), "image/webp")) === "too_large");
  t("limits: a VP8X canvas of 16 million pixels a side is too_large", reasonOf(() => inspectProfilePhoto(webpExt(16_000_000, 16_000_000), "image/webp")) === "too_large");
  t("limits are the documented ones", PROFILE_PHOTO_LIMITS.minSide === 16 && PROFILE_PHOTO_LIMITS.maxSide === 6000 && PROFILE_PHOTO_LIMITS.maxPixels === 24_000_000);
}

// ---- malformed / truncated / unsupported ----------------------------------------------------------------------------------
{
  const png = realPng(40, 24);
  t("PNG: truncated mid-file", reasonOf(() => inspectImage(png.subarray(0, png.length - 20))) !== "no-error");
  t("PNG: missing IEND is truncated", reasonOf(() => inspectImage(png.subarray(0, png.length - 12))) === "truncated");
  const flipped = Buffer.from(png);
  flipped[8 + 8 + 3] ^= 0xff; // a byte inside IHDR data
  t("PNG: corrupt header data fails its checksum", reasonOf(() => inspectImage(flipped)) === "bad_checksum");
  t("PNG: bytes after IEND are refused", reasonOf(() => inspectImage(Buffer.concat([png, Buffer.from("x")]))) === "malformed");
  t("PNG: no IDAT is refused", reasonOf(() => inspectImage(Buffer.concat([PNG_SIG, ihdr(40, 24), chunk("IEND", Buffer.alloc(0))]))) === "malformed");
  t("PNG: first chunk not IHDR is refused", reasonOf(() => inspectImage(Buffer.concat([PNG_SIG, chunk("IDAT", Buffer.from([1])), chunk("IEND", Buffer.alloc(0))]))) !== "no-error");
  t("PNG: invalid colour type / bit depth pair", reasonOf(() => inspectImage(Buffer.concat([PNG_SIG, ihdr(40, 24, 3, 2), chunk("IDAT", Buffer.from([1])), chunk("IEND", Buffer.alloc(0))]))) === "unsupported_variant");
  t("PNG: palette image without PLTE is refused", reasonOf(() => inspectImage(Buffer.concat([PNG_SIG, ihdr(40, 24, 8, 3), chunk("IDAT", Buffer.from([1])), chunk("IEND", Buffer.alloc(0))]))) === "malformed");
  t("PNG: a chunk length running past the file is truncated", reasonOf(() => inspectImage(Buffer.concat([PNG_SIG, ihdr(40, 24), Buffer.from([0x7f, 0xff, 0xff, 0xff, 0x49, 0x44, 0x41, 0x54])]))) === "truncated");

  const j = jpeg(100, 100);
  t("JPEG: no end marker is truncated", reasonOf(() => inspectImage(jpeg(100, 100, { eoi: false }))) === "truncated");
  t("JPEG: no scan is refused", reasonOf(() => inspectImage(jpeg(100, 100, { noSos: true }))) !== "no-error");
  t("JPEG: arithmetic-coded (SOF9) is unsupported", reasonOf(() => inspectImage(jpeg(100, 100, { sof: 0xc9 }))) === "unsupported_variant");
  t("JPEG: lossless (SOF3) is unsupported", reasonOf(() => inspectImage(jpeg(100, 100, { sof: 0xc3 }))) === "unsupported_variant");
  t("JPEG: 12-bit precision is unsupported", reasonOf(() => inspectImage(jpeg(100, 100, { precision: 12 }))) === "unsupported_variant");
  t("JPEG: 2 components is refused", reasonOf(() => inspectImage(jpeg(100, 100, { comps: 2 }))) === "malformed");
  const overrun = Buffer.from(j);
  overrun.writeUInt16BE(0xfff0, 4); // the APP0 segment length claims far more than exists
  t("JPEG: a segment running past the end is refused", reasonOf(() => inspectImage(overrun)) === "truncated");
  t("JPEG: a scan before any frame header is refused", reasonOf(() => inspectImage(Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([0xff, 0xd9])]))) === "malformed");

  t("GIF: no trailer is truncated", reasonOf(() => inspectImage(gif(48, 32, { trailer: false }))) === "truncated");
  t("GIF: bytes after the trailer are refused", reasonOf(() => inspectImage(Buffer.concat([gif(48, 32), Buffer.from("zz")]))) === "malformed");
  t("GIF: an invalid block introducer is refused", reasonOf(() => inspectImage(gif(48, 32, { extra: Buffer.from([0x99]) }))) === "malformed");
  t("GIF: no image block is refused", reasonOf(() => inspectImage(gif(48, 32, { images: 0 }))) === "malformed");

  const w = webpLossy(300, 200);
  t("WebP: RIFF size mismatch is refused", reasonOf(() => inspectImage(Buffer.concat([w, Buffer.from("x")]))) === "malformed");
  t("WebP: truncated is refused", reasonOf(() => inspectImage(w.subarray(0, w.length - 4))) !== "no-error");
  t("WebP: unknown image chunk is refused", reasonOf(() => inspectImage(riff(wchunk("ABCD", Buffer.alloc(12))))) === "malformed");
  t("WebP: wrong VP8 start code is refused", reasonOf(() => inspectImage(riff(wchunk("VP8 ", Buffer.alloc(10))))) === "malformed");

  for (const [name, bytes] of [
    ["empty", Buffer.alloc(0)],
    ["one byte", Buffer.from([0xff])],
    ["PDF", Buffer.from("%PDF-1.7\n1 0 obj\n")],
    ["SVG text", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["HTML", Buffer.from("<html><script>alert(1)</script></html>")],
    ["PHP", Buffer.from("<?php system($_GET['c']); ?>")],
    ["a shell script", Buffer.from("#!/bin/sh\nrm -rf /\n")],
    ["a GIF header followed by a script", Buffer.from("GIF89a<script>alert(1)</script>")],
    ["a JPEG signature followed by text", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("<script>alert(1)</script>")])],
    ["random bytes", Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 37 + 11) & 255))],
  ] as const) {
    t(`rejected: ${name}`, reasonOf(() => inspectImage(bytes)) !== "no-error" && reasonOf(() => inspectImage(bytes)) !== "other-error");
  }
  t("MIME: bytes of one format declared as another are refused", reasonOf(() => inspectProfilePhoto(realPng(64, 64), "image/jpeg")) === "malformed");
  t("rejections carry no file bytes in their message", (() => {
    try {
      inspectImage(Buffer.from("GIF89a<script>alert(1)</script>"));
    } catch (e) {
      return !String((e as Error).message).includes("script");
    }
    return false;
  })());
}

// ---- fuzz: whatever the bytes, the only outcomes are a result or an ImageHeaderError -------------------------------------
{
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const bases = [realPng(40, 24), jpeg(100, 100), gif(48, 32), webpLossy(300, 200), webpLossless(64, 64), webpExt(64, 64)];
  let crashes = 0;
  let runs = 0;
  for (const base of bases) {
    for (let i = 0; i < 400; i++) {
      const b = Buffer.from(base);
      const mode = i % 3;
      if (mode === 0) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
      else if (mode === 1) b.fill(Math.floor(rnd() * 256), Math.floor(rnd() * b.length));
      const cut = mode === 2 ? b.subarray(0, Math.floor(rnd() * b.length)) : b;
      runs++;
      const r = reasonOf(() => inspectProfilePhoto(cut, `image/${i % 2 ? "png" : "jpeg"}`));
      if (r === "other-error") crashes++;
    }
  }
  t(`fuzz: ${runs} mutated/truncated files produced only a result or an ImageHeaderError (never another exception)`, crashes === 0);
}

const out = process.stdout.write.bind(process.stdout);
out(`${ok} image-header unit checks passed, ${failures.length} failed.\n`);
if (failures.length) {
  out(`Failures:\n${failures.map((f) => ` - ${f}`).join("\n")}\n`);
  process.exitCode = 1;
}
