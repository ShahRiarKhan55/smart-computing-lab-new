/**
 * Lossless, allowlist-based removal of KNOWN metadata containers from uploaded still images (JPEG, PNG, WebP, GIF).
 *
 * HOW IT WORKS. Each format's container is walked once, with explicit bounds. Only structures on a per-format ALLOWLIST are
 * copied, byte for byte, into a freshly assembled output; everything else is dropped. The compressed image data (JPEG scan data,
 * PNG IDAT, WebP VP8/VP8L/ALPH payloads, GIF image blocks) is never decoded, re-encoded or altered, so pixels are exactly what the
 * encoder wrote. Anything malformed, ambiguous, unsupported or animated is REJECTED (an ImageHeaderError with a client-safe
 * message); nothing is guessed. The output must pass the structural inspector (src/lib/imageHeader.ts) including the dimension and
 * pixel limits, and may never be larger than the input.
 *
 * ORIENTATION. Phone photos carry an EXIF Orientation tag that browsers use to rotate them. When the tag is present, valid and not
 * the default (1), a NEW minimal orientation block is written (one tag, nothing else) so the photo still displays upright. If the
 * orientation data is malformed, duplicated or out of range, the upload is rejected rather than risk showing it sideways or
 * keeping bytes we did not understand. JPEG (APP1 Exif), PNG (eXIf) and WebP (EXIF) all follow this rule.
 *
 * ALLOWLISTS
 *  - JPEG: SOI, a rebuilt JFIF APP0 (thumbnail removed), Adobe APP14 (colour transform), ICC profile APP2 segments (sequence
 *    checked), DQT, DHT, DRI, one SOF0/1/2 frame header, each SOS with its entropy-coded data, the minimal orientation APP1, EOI.
 *    Dropped: every other APPn (EXIF, XMP, IPTC, MPF, ...), comments, and anything after the first real EOI.
 *  - PNG: IHDR, PLTE, IDAT, IEND, tRNS, gAMA, cHRM, sRGB, iCCP, sBIT, bKGD (+ the minimal eXIf). Dropped: tEXt, zTXt, iTXt, eXIf
 *    (original), tIME, pHYs, hIST, sPLT and any unknown ancillary chunk. APNG (acTL/fcTL/fdAT) is rejected.
 *  - WebP: RIFF header, VP8X (EXIF/XMP/animation flags cleared), ICCP, ALPH, VP8 / VP8L (+ the minimal EXIF). Dropped: EXIF, XMP and
 *    unknown chunks. Animated WebP is rejected.
 *  - GIF: header, logical screen descriptor, global colour table, the Graphic Control Extension of the single image, that image's
 *    descriptor/local table/data. Dropped: comment, plain-text and application extensions (incl. XMP and looping). More than one
 *    image (animation) is rejected.
 *
 * THE GUARANTEE, PRECISELY.
 *  - Known metadata containers and unsupported ancillary/application structures are removed according to each format's allowlist
 *    (EXIF, XMP, IPTC, comments, text chunks, MPF, application extensions, JPEG/EXIF thumbnails, data after the end marker).
 *  - A valid orientation is rebuilt as a new minimal block; malformed or ambiguous orientation is rejected.
 *  - Accepted structures and payloads are otherwise preserved byte for byte, exactly as the encoder wrote them.
 *  - Retained opaque structures MAY STILL CONTAIN ARBITRARY INFORMATION: ICC profiles (their description, copyright and private
 *    tags), compressed image data (including bytes after a compressed stream ends but inside the same chunk or scan), colour
 *    tables and palettes, Huffman/quantization tables and certain fixed binary fields. These are bounded and structurally checked
 *    where that is safe, but their CONTENT is not inspected or removed.
 *  - Validation is structural only. The image is not decoded or re-encoded (no pixel pass, no downscale), so this cannot
 *    guarantee that all embedded information is gone, and a file that passes may still fail to decode or render.
 * Removing everything would need a decode-and-re-encode step, which is deliberately out of scope here. See
 * docs/architecture/phase13-files-and-gallery.md ("Profile photos").
 */
import { ImageHeaderError, crc32, inspectProfilePhoto, webpLosslessDimensions, webpLossyDimensions, type ImageInfo } from "./imageHeader.js";

const fail = (reason: ImageHeaderError["reason"], message: string): never => {
  throw new ImageHeaderError(reason, message);
};

const ANIMATED_MESSAGE = "Animated images are not supported for profile photos. Please upload a still image.";
const ORIENTATION_MESSAGE =
  "This photo's rotation information is damaged or ambiguous, so it cannot be used safely. Please re-save the photo (or take a screenshot of it) and upload that.";

/** Explicit traversal bounds (the 5 MB upload cap already bounds total work; these bound the structure). */
export const SANITIZER_LIMITS = { jpegSegments: 2000, pngChunks: 20_000, gifBlocks: 1000, webpChunks: 64, exifEntries: 512 } as const;

// ---- orientation --------------------------------------------------------------------------------------------------------

/**
 * Reads the Orientation (0x0112) of IFD0 from a TIFF block (starting at its "II"/"MM" header), strictly. Returns 1..8, or null when
 * IFD0 has no Orientation entry (= default). Throws bad_orientation for anything malformed or ambiguous.
 */
export function readExifOrientation(tiff: Buffer): number | null {
  const bad = () => fail("bad_orientation", ORIENTATION_MESSAGE);
  if (tiff.length < 8) return bad();
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return bad();
  const u16 = (o: number) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  if (u16(2) !== 42) return bad();
  const ifd = u32(4);
  if (ifd < 8 || ifd + 2 > tiff.length) return bad();
  const count = u16(ifd);
  if (count > SANITIZER_LIMITS.exifEntries || ifd + 2 + count * 12 > tiff.length) return bad();
  let found: number | null = null;
  for (let i = 0; i < count; i++) {
    const o = ifd + 2 + i * 12;
    if (u16(o) !== 0x0112) continue;
    if (found !== null) return bad(); // two Orientation entries: ambiguous
    if (u16(o + 2) !== 3 || u32(o + 4) !== 1) return bad(); // must be one SHORT
    const value = u16(o + 8);
    if (value < 1 || value > 8) return bad();
    found = value;
  }
  return found;
}

/** A fresh 26-byte big-endian TIFF block holding ONLY the Orientation tag. */
export function minimalOrientationTiff(orientation: number): Buffer {
  const b = Buffer.alloc(26);
  b.write("MM", 0, "latin1");
  b.writeUInt16BE(42, 2);
  b.writeUInt32BE(8, 4); // IFD0 offset
  b.writeUInt16BE(1, 8); // one entry
  b.writeUInt16BE(0x0112, 10); // tag
  b.writeUInt16BE(3, 12); // type SHORT
  b.writeUInt32BE(1, 14); // count
  b.writeUInt16BE(orientation, 18); // value (left-justified)
  b.writeUInt32BE(0, 22); // no next IFD
  return b;
}

/** Accepts an EXIF payload with or without the "Exif\0\0" prefix some writers add outside JPEG. */
function tiffOf(payload: Buffer): Buffer {
  return payload.length >= 6 && payload.subarray(0, 6).equals(Buffer.from("Exif\0\0", "latin1")) ? payload.subarray(6) : payload;
}

// ---- JPEG ---------------------------------------------------------------------------------------------------------------

/** DQT: one or more tables, each `Pq|Tq` + 64 (or 128) bytes, consuming the segment exactly. */
function checkJpegDqt(d: Buffer): void {
  let o = 0;
  let tables = 0;
  while (o < d.length) {
    const pq = d[o] >> 4;
    const tq = d[o] & 0x0f;
    if (pq > 1 || tq > 3) return fail("malformed", "The JPEG file has an invalid quantization table.");
    o += 1 + 64 * (pq + 1);
    tables++;
  }
  if (o !== d.length || tables === 0) return fail("malformed", "The JPEG file has an invalid quantization table.");
}

/** DHT: one or more tables, each `Tc|Th` + 16 code counts + that many symbols, consuming the segment exactly. */
function checkJpegDht(d: Buffer): void {
  const bad = () => fail("malformed", "The JPEG file has an invalid Huffman table.");
  let o = 0;
  let tables = 0;
  while (o < d.length) {
    if (o + 17 > d.length) return bad();
    const tc = d[o] >> 4;
    const th = d[o] & 0x0f;
    if (tc > 1 || th > 3) return bad();
    let symbols = 0;
    for (let i = 1; i <= 16; i++) symbols += d[o + i];
    if (symbols === 0 || symbols > 256) return bad();
    o += 17 + symbols;
    tables++;
  }
  if (o !== d.length || tables === 0) return bad();
}

/** SOF0/1/2: precision, non-zero size, 1..4 components with sampling factors 1..4 and a quantization table id 0..3. */
function checkJpegSof(d: Buffer): void {
  const bad = () => fail("malformed", "The JPEG frame header is invalid.");
  if (d.length < 6) return bad();
  const precision = d[0];
  const components = d[5];
  if (precision !== 8) return bad(); // 12-bit JPEG is not decodable by browsers (the inspector refuses it as well)
  if (d.readUInt16BE(1) === 0 || d.readUInt16BE(3) === 0) return bad();
  if (components < 1 || components > 4 || d.length !== 6 + 3 * components) return bad();
  const ids = new Set<number>();
  for (let i = 0; i < components; i++) {
    const o = 6 + 3 * i;
    const h = d[o + 1] >> 4;
    const v = d[o + 1] & 0x0f;
    if (h < 1 || h > 4 || v < 1 || v > 4 || d[o + 2] > 3 || ids.has(d[o])) return bad();
    ids.add(d[o]);
  }
}

/** SOS header: 1..4 components, a length that matches, table selectors 0..3, a sane spectral range. */
function checkJpegSos(d: Buffer): void {
  const bad = () => fail("malformed", "The JPEG scan header is invalid.");
  if (d.length < 1) return bad();
  const n = d[0];
  if (n < 1 || n > 4 || d.length !== 1 + 2 * n + 3) return bad();
  for (let i = 0; i < n; i++) if ((d[2 + 2 * i] >> 4) > 3 || (d[2 + 2 * i] & 0x0f) > 3) return bad();
  const se = d[1 + 2 * n + 1];
  if (d[1 + 2 * n] > 63 || se > 63 || d[1 + 2 * n] > se) return bad();
}

function sanitizeJpeg(b: Buffer): Buffer {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return fail("malformed", "Not a valid JPEG file.");
  let pos = 2;
  let segments = 0;
  let jfif: Buffer | null = null;
  let exifSeen = false;
  let orientation: number | null = null;
  let adobe = false;
  let sof = false;
  let dqt = false;
  let scans = 0;
  let eoiEnd = -1;
  const iccSeq = new Set<number>();
  let iccCount = -1;
  const body: Buffer[] = [];

  while (pos < b.length) {
    if (b[pos] !== 0xff) return fail("malformed", "The JPEG file has an invalid marker.");
    while (pos < b.length && b[pos] === 0xff) pos++; // fill bytes
    if (pos >= b.length) return fail("truncated", "The JPEG file is truncated.");
    const m = b[pos++];
    if (++segments > SANITIZER_LIMITS.jpegSegments) return fail("too_complex", "The JPEG file has too many segments.");
    if (m === 0xd9) {
      if (!sof || scans === 0) return fail("malformed", "The JPEG file ends before any image data.");
      eoiEnd = pos;
      break;
    }
    if (m === 0x00 || m === 0x01 || (m >= 0xd0 && m <= 0xd8)) return fail("malformed", "The JPEG file has an unexpected marker.");
    if (pos + 2 > b.length) return fail("truncated", "The JPEG file is truncated.");
    const length = b.readUInt16BE(pos);
    if (length < 2 || pos + length > b.length) return fail("truncated", "The JPEG file has a segment that runs past its end.");
    const segment = b.subarray(pos - 2, pos + length); // FF m <len> <data>
    const data = b.subarray(pos + 2, pos + length);
    const starts = (text: string) => data.length >= text.length && data.subarray(0, text.length).equals(Buffer.from(text, "latin1"));

    switch (m) {
      case 0xe0: // APP0
        if (starts("JFIF\0")) {
          if (jfif) return fail("malformed", "The JPEG file has more than one JFIF header.");
          if (data.length < 14) return fail("malformed", "The JPEG file's JFIF header is invalid.");
          // Rebuilt without the embedded thumbnail: version, units and densities are kept, thumbnail size is 0 x 0.
          jfif = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0", "latin1"), data.subarray(5, 12), Buffer.from([0, 0])]);
        }
        break; // JFXX and anything else: dropped
      case 0xe1: // APP1: EXIF is parsed only for Orientation; XMP and the rest are dropped
        if (starts("Exif\0\0")) {
          if (exifSeen) return fail("bad_orientation", ORIENTATION_MESSAGE);
          exifSeen = true;
          orientation = readExifOrientation(data.subarray(6));
        } else if (starts("Exif")) {
          // A partial or damaged EXIF signature (e.g. "Exif\0" + something else): it may well carry an Orientation, so it is
          // neither parsed nor silently discarded.
          return fail("bad_orientation", ORIENTATION_MESSAGE);
        }
        break;
      case 0xe2: // APP2: keep ICC profile chunks (sequence checked); MPF and others are dropped
        if (starts("ICC_PROFILE\0")) {
          if (data.length < 14) return fail("malformed", "The JPEG file's colour profile is invalid.");
          const seq = data[12];
          const count = data[13];
          if (count < 1 || seq < 1 || seq > count || iccSeq.has(seq) || (iccCount !== -1 && iccCount !== count)) {
            return fail("malformed", "The JPEG file's colour profile is inconsistent.");
          }
          iccSeq.add(seq);
          iccCount = count;
          body.push(segment);
        }
        break;
      case 0xee: // APP14: Adobe colour transform is needed to display CMYK/YCCK correctly
        if (starts("Adobe")) {
          if (adobe || length !== 14) return fail("malformed", "The JPEG file's Adobe header is invalid.");
          adobe = true;
          body.push(segment);
        }
        break;
      case 0xe3: case 0xe4: case 0xe5: case 0xe6: case 0xe7: case 0xe8: case 0xe9: case 0xea: case 0xeb: case 0xec: case 0xed: case 0xef:
      case 0xfe: // other APPn (IPTC, Photoshop, ...) and comments: dropped
        break;
      case 0xdb: // DQT
        checkJpegDqt(data);
        dqt = true;
        body.push(segment);
        break;
      case 0xc4: // DHT
        checkJpegDht(data);
        body.push(segment);
        break;
      case 0xdd: // DRI
        if (length !== 4) return fail("malformed", "The JPEG file has an invalid restart interval.");
        body.push(segment);
        break;
      case 0xc0: case 0xc1: case 0xc2: // baseline, extended sequential, progressive (Huffman)
        if (sof) return fail("malformed", "The JPEG file has more than one frame header.");
        checkJpegSof(data);
        sof = true;
        body.push(segment);
        break;
      case 0xda: { // SOS: the header, then entropy-coded data up to the next real marker
        if (!sof) return fail("malformed", "The JPEG scan comes before its frame header.");
        if (!dqt) return fail("malformed", "The JPEG file has no quantization table.");
        checkJpegSos(data);
        scans++;
        body.push(segment);
        let j = pos + length;
        const start = j;
        for (;;) {
          j = b.indexOf(0xff, j);
          if (j === -1) return fail("truncated", "The JPEG file is truncated.");
          let k = j + 1;
          while (k < b.length && b[k] === 0xff) k++; // fill bytes before a marker
          if (k >= b.length) return fail("truncated", "The JPEG file is truncated.");
          const next = b[k];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            j = k + 1; // stuffed byte or restart marker: still entropy-coded data
            continue;
          }
          break; // a real marker begins at j (+ fill)
        }
        body.push(b.subarray(start, j));
        pos = j;
        continue; // the loop re-reads the marker at pos
      }
      default:
        return fail("unsupported_variant", "This JPEG uses an encoding that is not supported.");
    }
    pos += length;
  }
  if (eoiEnd === -1) return fail("truncated", "The JPEG file is truncated (no end marker).");
  if (iccCount !== -1 && iccSeq.size !== iccCount) return fail("malformed", "The JPEG file's colour profile is incomplete.");

  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (jfif) parts.push(jfif);
  if (orientation !== null && orientation !== 1) {
    parts.push(Buffer.from([0xff, 0xe1, 0x00, 0x22]), Buffer.from("Exif\0\0", "latin1"), minimalOrientationTiff(orientation));
  }
  parts.push(...body, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

// ---- PNG ----------------------------------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Ancillary chunks kept (all must precede IDAT and occur at most once). */
const PNG_KEEP_ANCILLARY = new Set(["tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "bKGD"]);
const PNG_DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME", "pHYs", "hIST", "sPLT"]);
const PNG_ANIMATION = new Set(["acTL", "fcTL", "fdAT"]);

const PNG_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

/**
 * Length and value constraints of a RETAINED ancillary chunk, from the PNG specification. Everything checked here is bounded
 * (fixed lengths, or a scan of at most 80 bytes). Throws "malformed" when the chunk cannot be right for this image.
 */
function checkPngAncillary(type: string, data: Buffer, colorType: number, depth: number, paletteEntries: number): void {
  const bad = () => fail("malformed", `The PNG file has an invalid ${type} chunk.`);
  const maxSample = depth >= 16 ? 0xffff : (1 << depth) - 1;
  switch (type) {
    case "gAMA":
      if (data.length !== 4 || data.readUInt32BE(0) === 0) bad();
      return;
    case "cHRM":
      if (data.length !== 32) bad();
      return;
    case "sRGB":
      if (data.length !== 1 || data[0] > 3) bad();
      return;
    case "sBIT": {
      const need = { 0: 1, 2: 3, 3: 3, 4: 2, 6: 4 }[colorType];
      if (data.length !== need) bad();
      const limit = colorType === 3 ? 8 : depth;
      for (const v of data) if (v < 1 || v > limit) bad();
      return;
    }
    case "tRNS":
      if (colorType === 0) {
        if (data.length !== 2 || data.readUInt16BE(0) > maxSample) bad();
      } else if (colorType === 2) {
        if (data.length !== 6) bad();
        for (let i = 0; i < 6; i += 2) if (data.readUInt16BE(i) > maxSample) bad();
      } else if (colorType === 3) {
        if (data.length < 1 || data.length > paletteEntries) bad();
      } else bad();
      return;
    case "bKGD":
      if (colorType === 0 || colorType === 4) {
        if (data.length !== 2 || data.readUInt16BE(0) > maxSample) bad();
      } else if (colorType === 2 || colorType === 6) {
        if (data.length !== 6) bad();
        for (let i = 0; i < 6; i += 2) if (data.readUInt16BE(i) > maxSample) bad();
      } else if (data.length !== 1 || data[0] >= paletteEntries) bad();
      return;
    case "iCCP": {
      const nul = data.subarray(0, 80).indexOf(0);
      if (nul < 1 || nul > 79) bad(); // profile name: 1..79 bytes
      const name = data.subarray(0, nul);
      for (const c of name) if (c < 32 || (c > 126 && c < 161)) bad();
      if (name[0] === 32 || name[nul - 1] === 32 || name.includes(Buffer.from("  "))) bad();
      if (data.length < nul + 1 + 1 + 2 + 4 || data[nul + 1] !== 0) bad(); // compression method 0, a zlib stream (header + checksum)
      const cmf = data[nul + 2];
      const flg = data[nul + 3];
      if ((cmf & 0x0f) !== 8 || ((cmf << 8) | flg) % 31 !== 0 || (flg & 0x20) !== 0) bad();
      return;
    }
  }
}

function sanitizePng(b: Buffer): Buffer {
  if (b.length < 8 || !b.subarray(0, 8).equals(PNG_SIGNATURE)) return fail("malformed", "Not a valid PNG file.");
  let pos = 8;
  let count = 0;
  let colorType = -1;
  let depth = 0;
  let paletteEntries = 0;
  let sawIdat = false;
  let idatEnded = false;
  let sawPlte = false;
  let sawIend = false;
  let exifSeen = false;
  let orientation: number | null = null;
  const seen = new Set<string>();
  const out: Buffer[] = [PNG_SIGNATURE];
  let minimalExifPlaced = false;
  const exifChunk = (): Buffer => {
    const data = minimalOrientationTiff(orientation as number);
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write("eXIf", 4, "latin1");
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk, 4, 8 + data.length), 8 + data.length);
    return chunk;
  };

  while (pos < b.length) {
    if (sawIend) return fail("malformed", "The PNG file has data after its end marker.");
    if (++count > SANITIZER_LIMITS.pngChunks) return fail("too_complex", "The PNG file has too many chunks.");
    if (pos + 12 > b.length) return fail("truncated", "The PNG file is truncated.");
    const length = b.readUInt32BE(pos);
    const type = b.subarray(pos + 4, pos + 8).toString("latin1");
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    if (length > 0x7fffffff || dataEnd + 4 > b.length) return fail("truncated", "The PNG file is truncated.");
    if (!/^[A-Za-z]{4}$/.test(type)) return fail("malformed", "The PNG file has an invalid chunk.");
    if (crc32(b, pos + 4, dataEnd) !== b.readUInt32BE(dataEnd)) return fail("bad_checksum", "The PNG file is corrupt (checksum mismatch).");
    const chunk = b.subarray(pos, dataEnd + 4);
    const data = b.subarray(dataStart, dataEnd);

    if (count === 1) {
      if (type !== "IHDR" || length !== 13) return fail("malformed", "The PNG file does not start with a valid header chunk.");
      colorType = data[9];
      depth = data[8];
      if (!(PNG_DEPTHS[colorType] ?? []).includes(depth) || data[10] !== 0 || data[11] !== 0 || data[12] > 1) return fail("malformed", "The PNG header has invalid fields.");
      out.push(chunk);
      seen.add("IHDR");
      pos = dataEnd + 4;
      continue;
    }
    if (PNG_ANIMATION.has(type)) return fail("animated", ANIMATED_MESSAGE);
    if (type === "IHDR") return fail("malformed", "The PNG file has a duplicate header chunk.");

    if (type === "IDAT") {
      if (idatEnded) return fail("malformed", "The PNG image data is not contiguous.");
      if (colorType === 3 && !sawPlte) return fail("malformed", "The PNG file is missing its palette.");
      if (!sawIdat && orientation !== null && orientation !== 1 && !minimalExifPlaced) {
        out.push(exifChunk());
        minimalExifPlaced = true;
      }
      sawIdat = true;
      out.push(chunk);
    } else {
      if (sawIdat) idatEnded = true;
      if (type === "IEND") {
        if (length !== 0 || !sawIdat) return fail("malformed", "The PNG end marker is invalid.");
        sawIend = true;
        // An eXIf that came AFTER the image data (allowed by the format) still has its orientation preserved, just before IEND.
        if (orientation !== null && orientation !== 1 && !minimalExifPlaced) {
          out.push(exifChunk());
          minimalExifPlaced = true;
        }
        out.push(chunk);
      } else if (type === "PLTE") {
        if (sawIdat || sawPlte || length === 0 || length % 3 !== 0 || length > 768 || colorType === 0 || colorType === 4) return fail("malformed", "The PNG palette is invalid.");
        if (colorType === 3 && length / 3 > 1 << depth) return fail("malformed", "The PNG palette is invalid.");
        sawPlte = true;
        paletteEntries = length / 3;
        out.push(chunk);
      } else if (type === "eXIf") {
        if (exifSeen) return fail("bad_orientation", ORIENTATION_MESSAGE);
        exifSeen = true;
        orientation = readExifOrientation(tiffOf(data));
      } else if (PNG_KEEP_ANCILLARY.has(type)) {
        if (sawIdat || seen.has(type)) return fail("malformed", "The PNG file's chunks are out of order.");
        if (type === "tRNS" && (colorType === 4 || colorType === 6)) return fail("malformed", "The PNG transparency chunk is invalid.");
        // Colour-space chunks precede the palette; transparency and background follow it (and an indexed image needs it first).
        if (sawPlte && ["gAMA", "cHRM", "sRGB", "iCCP", "sBIT"].includes(type)) return fail("malformed", "The PNG file's chunks are out of order.");
        if (colorType === 3 && (type === "tRNS" || type === "bKGD") && !sawPlte) return fail("malformed", "The PNG file's chunks are out of order.");
        checkPngAncillary(type, data, colorType, depth, paletteEntries);
        if (type === "iCCP" && (seen.has("sRGB") || length < 3)) return fail("malformed", "The PNG colour information is ambiguous.");
        if (type === "sRGB" && seen.has("iCCP")) return fail("malformed", "The PNG colour information is ambiguous.");
        seen.add(type);
        out.push(chunk);
      } else if (PNG_DROP.has(type)) {
        // metadata: dropped
      } else if (type.charCodeAt(0) >= 0x41 && type.charCodeAt(0) <= 0x5a) {
        return fail("unsupported_variant", "The PNG file uses a chunk that is not supported."); // unknown CRITICAL chunk
      } // unknown ANCILLARY chunk: dropped
    }
    pos = dataEnd + 4;
  }
  if (!sawIend) return fail("truncated", "The PNG file is truncated.");
  if (colorType === 3 && !sawPlte) return fail("malformed", "The PNG file is missing its palette.");
  return Buffer.concat(out);
}

// ---- GIF ----------------------------------------------------------------------------------------------------------------

function sanitizeGif(b: Buffer): Buffer {
  const header = b.length >= 6 ? b.subarray(0, 6).toString("latin1") : "";
  if (b.length < 14 || (header !== "GIF87a" && header !== "GIF89a")) return fail("malformed", "Not a valid GIF file.");
  const packed = b[10];
  let pos = 13;
  if (packed & 0x80) pos += 3 * (1 << ((packed & 0x07) + 1));
  if (pos > b.length) return fail("truncated", "The GIF file is truncated.");
  const out: Buffer[] = [b.subarray(0, pos)];
  const skipSubBlocks = (p: number): number => {
    for (;;) {
      if (p >= b.length) return fail("truncated", "The GIF file is truncated.");
      const size = b[p++];
      if (size === 0) return p;
      p += size;
      if (p > b.length) return fail("truncated", "The GIF file is truncated.");
    }
  };
  let images = 0;
  let blocks = 0;
  let pendingGce: Buffer | null = null;
  let sawTrailer = false;
  while (pos < b.length) {
    if (++blocks > SANITIZER_LIMITS.gifBlocks) return fail("too_complex", "The GIF file has too many blocks.");
    const introducer = b[pos];
    if (introducer === 0x3b) {
      pos++;
      sawTrailer = true;
      break;
    }
    if (introducer === 0x21) {
      if (pos + 2 > b.length) return fail("truncated", "The GIF file is truncated.");
      const label = b[pos + 1];
      const end = skipSubBlocks(pos + 2);
      if (label === 0xf9) {
        // Graphic Control Extension: exactly 4 bytes of data, kept only if it belongs to the (single) image that follows.
        if (b[pos + 2] !== 4 || end !== pos + 2 + 1 + 4 + 1 || pendingGce) return fail("malformed", "The GIF file has an invalid control block.");
        pendingGce = b.subarray(pos, end);
      } else if (label !== 0xfe && label !== 0xff && label !== 0x01) {
        return fail("unsupported_variant", "The GIF file uses an extension that is not supported."); // unknown extension label
      } // comment (FE), application (FF, incl. XMP and looping) and plain text (01): dropped
      pos = end;
    } else if (introducer === 0x2c) {
      if (pos + 10 > b.length) return fail("truncated", "The GIF file is truncated.");
      images++;
      if (images > 1) return fail("animated", ANIMATED_MESSAGE);
      const flags = b[pos + 9];
      let p = pos + 10;
      if (flags & 0x80) p += 3 * (1 << ((flags & 0x07) + 1));
      p += 1; // LZW minimum code size
      if (p > b.length) return fail("truncated", "The GIF file is truncated.");
      const end = skipSubBlocks(p);
      if (pendingGce) out.push(pendingGce);
      pendingGce = null;
      out.push(b.subarray(pos, end));
      pos = end;
    } else {
      return fail("malformed", "The GIF file has an invalid block.");
    }
  }
  if (!sawTrailer) return fail("truncated", "The GIF file is truncated (no trailer).");
  if (pos !== b.length) return fail("malformed", "The GIF file has data after its trailer.");
  if (images === 0) return fail("malformed", "The GIF file contains no image.");
  out.push(Buffer.from([0x3b]));
  return Buffer.concat(out);
}

// ---- WebP ---------------------------------------------------------------------------------------------------------------

function sanitizeWebp(b: Buffer): Buffer {
  if (b.length < 20 || b.subarray(0, 4).toString("latin1") !== "RIFF" || b.subarray(8, 12).toString("latin1") !== "WEBP") return fail("malformed", "Not a valid WebP file.");
  if (b.readUInt32LE(4) + 8 !== b.length) return fail("malformed", "The WebP file's size does not match its header.");
  let pos = 12;
  let count = 0;
  let vp8x: Buffer | null = null;
  let iccp: Buffer | null = null;
  let alph: Buffer | null = null;
  let image: { type: string; data: Buffer } | null = null;
  let exifSeen = false;
  let orientation: number | null = null;

  while (pos < b.length) {
    if (++count > SANITIZER_LIMITS.webpChunks) return fail("too_complex", "The WebP file has too many chunks.");
    if (pos + 8 > b.length) return fail("truncated", "The WebP file is truncated.");
    const type = b.subarray(pos, pos + 4).toString("latin1");
    const size = b.readUInt32LE(pos + 4);
    const dataStart = pos + 8;
    const dataEnd = dataStart + size;
    const next = dataEnd + (size % 2); // chunks are padded to an even length
    if (dataEnd > b.length || next > b.length) return fail("truncated", "The WebP file is truncated.");
    const data = b.subarray(dataStart, dataEnd);

    if (count === 1 && type !== "VP8X" && type !== "VP8 " && type !== "VP8L") return fail("malformed", "The WebP file has an unknown image chunk.");
    switch (type) {
      case "VP8X":
        if (count !== 1 || size !== 10) return fail("malformed", "The WebP header is invalid.");
        if (data[0] & 0x02) return fail("animated", ANIMATED_MESSAGE);
        vp8x = data;
        break;
      case "ANIM": case "ANMF":
        return fail("animated", ANIMATED_MESSAGE);
      case "ICCP":
        if (iccp || image || !vp8x) return fail("malformed", "The WebP colour profile is out of place.");
        iccp = data;
        break;
      case "ALPH":
        if (alph || image || !vp8x) return fail("malformed", "The WebP alpha data is out of place.");
        alph = data;
        break;
      case "VP8 ": case "VP8L":
        if (image) return fail("malformed", "The WebP file has more than one image.");
        image = { type, data };
        break;
      case "EXIF":
        if (exifSeen) return fail("bad_orientation", ORIENTATION_MESSAGE);
        exifSeen = true;
        orientation = readExifOrientation(tiffOf(data));
        break;
      default:
        break; // XMP and unknown chunks: dropped
    }
    pos = next;
  }
  if (!image) return fail("malformed", "The WebP file contains no image.");
  if (exifSeen && !vp8x) return fail("malformed", "The WebP file has metadata without an extended header.");
  if (alph && image.type !== "VP8 ") return fail("malformed", "The WebP alpha data does not match its image.");

  const dims = image.type === "VP8 " ? webpLossyDimensions(image.data) : webpLosslessDimensions(image.data);
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "latin1");
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, ...(data.length % 2 ? [Buffer.alloc(1)] : [])]);
  };
  const needsExif = orientation !== null && orientation !== 1;
  const parts: Buffer[] = [];
  if (vp8x) {
    const canvasW = (vp8x[4] | (vp8x[5] << 8) | (vp8x[6] << 16)) + 1;
    const canvasH = (vp8x[7] | (vp8x[8] << 8) | (vp8x[9] << 16)) + 1;
    if (canvasW !== dims.width || canvasH !== dims.height) return fail("malformed", "The WebP canvas size does not match its image.");
    if (Boolean(vp8x[0] & 0x20) !== Boolean(iccp)) return fail("malformed", "The WebP colour profile flag is inconsistent.");
    const flags = (vp8x[0] & 0x30) | (needsExif ? 0x08 : 0); // keep ICC and alpha flags; clear XMP and animation; EXIF only for orientation
    const header = Buffer.from(vp8x);
    header[0] = flags;
    header[1] = 0;
    header[2] = 0;
    header[3] = 0; // reserved bits must be zero
    parts.push(chunk("VP8X", header));
    if (iccp) parts.push(chunk("ICCP", iccp));
    if (alph) parts.push(chunk("ALPH", alph));
    parts.push(chunk(image.type, image.data));
    if (needsExif) parts.push(chunk("EXIF", minimalOrientationTiff(orientation as number)));
  } else {
    parts.push(chunk(image.type, image.data));
  }
  const payload = Buffer.concat(parts);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(4 + payload.length, 4);
  riff.write("WEBP", 8, "latin1");
  return Buffer.concat([riff, payload]);
}

// ---- public API ---------------------------------------------------------------------------------------------------------

export interface SanitizedImage {
  bytes: Buffer;
  mimeType: string;
  info: ImageInfo;
  /** False when the input was already exactly the sanitized form. */
  changed: boolean;
}

/**
 * Sanitizes `input` (whose real type, from its signature, is `sniffedMime`) and returns the bytes to store. Throws ImageHeaderError
 * (client-safe message) for anything it will not accept. The result has passed the structural inspector and the dimension/pixel
 * limits and is never larger than the input.
 */
export function sanitizeImage(input: Buffer, sniffedMime: string): SanitizedImage {
  let bytes: Buffer;
  try {
    switch (sniffedMime) {
      case "image/jpeg":
        bytes = sanitizeJpeg(input);
        break;
      case "image/png":
        bytes = sanitizePng(input);
        break;
      case "image/gif":
        bytes = sanitizeGif(input);
        break;
      case "image/webp":
        bytes = sanitizeWebp(input);
        break;
      default:
        return fail("unsupported_format", "Only JPEG, PNG, WebP and GIF images are accepted.");
    }
  } catch (err) {
    if (err instanceof ImageHeaderError) throw err;
    // A read past the end of a malformed buffer is a corrupt file, not a server fault.
    if (err instanceof RangeError) throw new ImageHeaderError("truncated", "The image file is truncated or corrupt.");
    throw err;
  }
  if (bytes.length > input.length) return fail("malformed", "The image could not be cleaned safely.");
  const info = inspectProfilePhoto(bytes, sniffedMime);
  return { bytes, mimeType: sniffedMime, info, changed: !bytes.equals(input) };
}
