/**
 * Structural inspection of an uploaded image (JPEG, PNG, GIF, WebP) WITHOUT decoding pixels.
 *
 * What this proves: the bytes follow the format's container structure well enough to read trustworthy dimensions (PNG: signature,
 * every chunk's CRC, IHDR fields, an IDAT and a closing IEND with nothing after it; JPEG: SOI, a well-formed marker walk to a
 * baseline/progressive SOF with sane sampling, an SOS and a closing EOI; GIF: header, descriptor, a well-formed block walk and a
 * trailer; WebP: RIFF size consistency and a VP8/VP8L/VP8X header). It then enforces dimension and pixel-count limits so a small
 * file cannot declare an enormous canvas (a decompression-bomb guard for whatever decodes it later, e.g. a browser).
 *
 * What it does NOT prove: that the compressed image data decodes. This is header and container validation only, not a decoder; a
 * file can pass and still fail to render. No pixel data is read or re-encoded. This inspector does not look at or remove metadata;
 * metadata handling for profile photos is done by imageSanitize.ts, which has its own documented limits.
 */

export const PROFILE_PHOTO_LIMITS = {
  /** Smallest accepted side in pixels (rejects 1x1 "pixel" files and obvious junk). */
  minSide: 16,
  /** Largest accepted side in pixels. */
  maxSide: 6000,
  /** Largest accepted width x height (24 megapixels). */
  maxPixels: 24_000_000,
} as const;

export type ImageFormat = "jpeg" | "png" | "gif" | "webp";

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
}

export type ImageHeaderReason =
  | "unsupported_format"
  | "truncated"
  | "malformed"
  | "bad_checksum"
  | "unsupported_variant"
  | "zero_dimension"
  | "too_small"
  | "too_large"
  | "too_many_pixels"
  | "animated"
  | "bad_orientation"
  | "too_complex";

/** A rejection with a stable reason. The message never contains file bytes. */
export class ImageHeaderError extends Error {
  constructor(
    readonly reason: ImageHeaderReason,
    message: string,
  ) {
    super(message);
    this.name = "ImageHeaderError";
  }
}

const fail = (reason: ImageHeaderReason, message: string): never => {
  throw new ImageHeaderError(reason, message);
};

const u16be = (b: Buffer, o: number) => b.readUInt16BE(o);
const u16le = (b: Buffer, o: number) => b.readUInt16LE(o);
const u32be = (b: Buffer, o: number) => b.readUInt32BE(o);
const ascii = (b: Buffer, o: number, n: number) => b.subarray(o, o + n).toString("latin1");

// ---- PNG ----------------------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

function readPng(b: Buffer): ImageInfo {
  if (b.length < 8 || !b.subarray(0, 8).equals(PNG_SIGNATURE)) return fail("malformed", "Not a valid PNG file.");
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let sawIdat = false;
  let sawPlte = false;
  let sawIend = false;
  let first = true;
  while (pos < b.length) {
    if (sawIend) return fail("malformed", "The PNG file has data after its end marker.");
    if (pos + 12 > b.length) return fail("truncated", "The PNG file is truncated.");
    const length = u32be(b, pos);
    const type = ascii(b, pos + 4, 4);
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    if (length > 0x7fffffff || dataEnd + 4 > b.length) return fail("truncated", "The PNG file is truncated.");
    if (!/^[A-Za-z]{4}$/.test(type)) return fail("malformed", "The PNG file has an invalid chunk.");
    if (crc32(b, pos + 4, dataEnd) !== u32be(b, dataEnd)) return fail("bad_checksum", "The PNG file is corrupt (checksum mismatch).");
    if (first) {
      if (type !== "IHDR" || length !== 13) return fail("malformed", "The PNG file does not start with a valid header chunk.");
      width = u32be(b, dataStart);
      height = u32be(b, dataStart + 4);
      const depth = b[dataStart + 8];
      colorType = b[dataStart + 9];
      const compression = b[dataStart + 10];
      const filter = b[dataStart + 11];
      const interlace = b[dataStart + 12];
      if (!PNG_DEPTHS[colorType]?.includes(depth)) return fail("unsupported_variant", "Unsupported PNG colour type or bit depth.");
      if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) return fail("malformed", "The PNG header has invalid fields.");
      first = false;
    } else if (type === "IHDR") {
      return fail("malformed", "The PNG file has a duplicate header chunk.");
    } else if (type === "PLTE") {
      sawPlte = true;
    } else if (type === "IDAT") {
      if (colorType === 3 && !sawPlte) return fail("malformed", "The PNG file is missing its palette.");
      sawIdat = true;
    } else if (type === "IEND") {
      if (length !== 0) return fail("malformed", "The PNG end marker is invalid.");
      sawIend = true;
    }
    pos = dataEnd + 4;
  }
  if (!sawIdat) return fail("malformed", "The PNG file contains no image data.");
  if (!sawIend) return fail("truncated", "The PNG file is truncated.");
  return { format: "png", width, height };
}

// ---- JPEG ---------------------------------------------------------------------------------------------------------------

function readJpeg(b: Buffer): ImageInfo {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return fail("malformed", "Not a valid JPEG file.");
  if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return fail("truncated", "The JPEG file is truncated (no end marker).");
  let pos = 2;
  let width = 0;
  let height = 0;
  let sawSof = false;
  let sawSos = false;
  while (pos < b.length && !sawSos) {
    if (b[pos] !== 0xff) return fail("malformed", "The JPEG file has an invalid marker.");
    while (pos < b.length && b[pos] === 0xff) pos++; // fill bytes
    if (pos >= b.length) return fail("truncated", "The JPEG file is truncated.");
    const marker = b[pos++];
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue; // standalone markers
    if (marker === 0xd9) return fail("malformed", "The JPEG file ends before any image data.");
    if (pos + 2 > b.length) return fail("truncated", "The JPEG file is truncated.");
    const length = u16be(b, pos);
    if (length < 2 || pos + length > b.length) return fail("truncated", "The JPEG file has a segment that runs past its end.");
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (sawSof) return fail("malformed", "The JPEG file has more than one frame header.");
      // Only baseline, extended-sequential and progressive Huffman are accepted (what browsers decode).
      if (marker !== 0xc0 && marker !== 0xc1 && marker !== 0xc2) return fail("unsupported_variant", "Unsupported JPEG encoding.");
      const precision = b[pos + 2];
      height = u16be(b, pos + 3);
      width = u16be(b, pos + 5);
      const components = b[pos + 7];
      if (precision !== 8) return fail("unsupported_variant", "Unsupported JPEG sample precision.");
      if (![1, 3, 4].includes(components) || length !== 8 + 3 * components) return fail("malformed", "The JPEG frame header is invalid.");
      sawSof = true;
    } else if (marker === 0xda) {
      if (!sawSof) return fail("malformed", "The JPEG scan comes before its frame header.");
      sawSos = true;
    }
    pos += length;
  }
  if (!sawSof) return fail("malformed", "The JPEG file has no frame header.");
  if (!sawSos) return fail("truncated", "The JPEG file has no image scan.");
  return { format: "jpeg", width, height };
}

// ---- GIF ----------------------------------------------------------------------------------------------------------------

function skipSubBlocks(b: Buffer, pos: number): number {
  for (;;) {
    if (pos >= b.length) return fail("truncated", "The GIF file is truncated.");
    const size = b[pos++];
    if (size === 0) return pos;
    pos += size;
    if (pos > b.length) return fail("truncated", "The GIF file is truncated.");
  }
}

function readGif(b: Buffer): ImageInfo {
  const header = b.length >= 6 ? ascii(b, 0, 6) : "";
  if (b.length < 14 || (header !== "GIF87a" && header !== "GIF89a")) return fail("malformed", "Not a valid GIF file.");
  const width = u16le(b, 6);
  const height = u16le(b, 8);
  const packed = b[10];
  let pos = 13;
  if (packed & 0x80) pos += 3 * (1 << ((packed & 0x07) + 1));
  let images = 0;
  for (;;) {
    if (pos >= b.length) return fail("truncated", "The GIF file is truncated (no trailer).");
    const block = b[pos++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      pos += 1; // extension label
      pos = skipSubBlocks(b, pos);
    } else if (block === 0x2c) {
      if (pos + 9 > b.length) return fail("truncated", "The GIF file is truncated.");
      const flags = b[pos + 8];
      pos += 9;
      if (flags & 0x80) pos += 3 * (1 << ((flags & 0x07) + 1));
      pos += 1; // LZW minimum code size
      pos = skipSubBlocks(b, pos);
      images++;
    } else {
      return fail("malformed", "The GIF file has an invalid block.");
    }
  }
  if (pos !== b.length) return fail("malformed", "The GIF file has data after its trailer.");
  if (images === 0) return fail("malformed", "The GIF file contains no image.");
  return { format: "gif", width, height };
}

// ---- WebP ---------------------------------------------------------------------------------------------------------------

/** Dimensions from the payload of a WebP "VP8 " (lossy) chunk. */
export function webpLossyDimensions(d: Buffer): { width: number; height: number } {
  if (d.length < 10 || d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) return fail("malformed", "The WebP image header is invalid.");
  return { width: d.readUInt16LE(6) & 0x3fff, height: d.readUInt16LE(8) & 0x3fff };
}

/** Dimensions from the payload of a WebP "VP8L" (lossless) chunk. */
export function webpLosslessDimensions(d: Buffer): { width: number; height: number } {
  if (d.length < 5 || d[0] !== 0x2f) return fail("malformed", "The WebP image header is invalid.");
  const bits = d.readUInt32LE(1);
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

function readWebp(b: Buffer): ImageInfo {
  if (b.length < 20 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return fail("malformed", "Not a valid WebP file.");
  if (b.readUInt32LE(4) + 8 !== b.length) return fail("malformed", "The WebP file's size does not match its header.");
  const type = ascii(b, 12, 4);
  const size = b.readUInt32LE(16);
  const data = 20;
  if (data + size > b.length) return fail("truncated", "The WebP file is truncated.");
  if (type === "VP8 ") {
    const d = webpLossyDimensions(b.subarray(data, data + size));
    return { format: "webp", width: d.width, height: d.height };
  }
  if (type === "VP8L") {
    const d = webpLosslessDimensions(b.subarray(data, data + size));
    return { format: "webp", width: d.width, height: d.height };
  }
  if (type === "VP8X") {
    if (size < 10) return fail("malformed", "The WebP image header is invalid.");
    const w = b[data + 4] | (b[data + 5] << 8) | (b[data + 6] << 16);
    const h = b[data + 7] | (b[data + 8] << 8) | (b[data + 9] << 16);
    return { format: "webp", width: w + 1, height: h + 1 };
  }
  return fail("malformed", "The WebP file has an unknown image chunk.");
}

// ---- public API ---------------------------------------------------------------------------------------------------------

/** Reads the container structure and dimensions. Throws ImageHeaderError; never reads pixel data. */
export function inspectImage(bytes: Buffer): ImageInfo {
  try {
    return inspectImageUnchecked(bytes);
  } catch (err) {
    // A read past the end of a malformed buffer surfaces as a RangeError: that is a truncated/corrupt file, not a server fault.
    if (err instanceof ImageHeaderError) throw err;
    if (err instanceof RangeError) throw new ImageHeaderError("truncated", "The image file is truncated or corrupt.");
    throw err;
  }
}

function inspectImageUnchecked(bytes: Buffer): ImageInfo {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return readJpeg(bytes);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return readPng(bytes);
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return readGif(bytes);
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return readWebp(bytes);
  return fail("unsupported_format", "Only JPEG, PNG, WebP and GIF images are accepted.");
}

/** Applies the dimension and pixel-count limits. Sides are checked before the product, so it cannot overflow. */
export function assertWithinLimits(info: ImageInfo, limits = PROFILE_PHOTO_LIMITS): void {
  if (!Number.isInteger(info.width) || !Number.isInteger(info.height) || info.width <= 0 || info.height <= 0) {
    fail("zero_dimension", "The image has no valid dimensions.");
  }
  if (info.width < limits.minSide || info.height < limits.minSide) fail("too_small", `The image is too small (at least ${limits.minSide} x ${limits.minSide} pixels).`);
  if (info.width > limits.maxSide || info.height > limits.maxSide) fail("too_large", `The image is too large (at most ${limits.maxSide} pixels on a side).`);
  if (info.width * info.height > limits.maxPixels) fail("too_many_pixels", `The image has too many pixels (at most ${Math.round(limits.maxPixels / 1_000_000)} megapixels).`);
}

/** Full check used by the profile-photo endpoint. The format found in the bytes must equal the signature-sniffed MIME type. */
export function inspectProfilePhoto(bytes: Buffer, sniffedMime: string): ImageInfo {
  const info = inspectImage(bytes);
  if (`image/${info.format}` !== sniffedMime) fail("malformed", "The image's contents do not match its type.");
  assertWithinLimits(info);
  return info;
}
