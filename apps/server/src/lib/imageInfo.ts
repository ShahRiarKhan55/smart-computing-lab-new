/**
 * Header-only image inspection (Phase 27 / P27.6). Reads the pixel dimensions straight out of the
 * file's own header for the three formats profile photos may use (JPEG, PNG, WEBP) — no decoder, no
 * native dependency, no pixel buffers. It answers exactly two questions an upload gate needs: "is
 * this really a well-formed image header of the type its bytes claim?" and "is it a sane size?"
 * (a 60,000 x 60,000 px file is a decompression bomb for whoever later decodes it, whatever its
 * byte size). It returns `null` for anything malformed or truncated rather than guessing.
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

function png(buf: Buffer): ImageDimensions | null {
  // 8-byte signature, then the IHDR chunk: length(4) "IHDR"(4) width(4) height(4)
  if (buf.length < 24 || buf.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpeg(buf: Buffer): ImageDimensions | null {
  let i = 2; // after SOI (FF D8)
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    let marker = buf[i + 1];
    while (marker === 0xff && i + 2 < buf.length) {
      i++; // fill bytes
      marker = buf[i + 1];
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // standalone markers carry no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS reached without a frame header
    if (i + 4 > buf.length) return null;
    const length = buf.readUInt16BE(i + 2);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 9 > buf.length) return null;
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function webp(buf: Buffer): ImageDimensions | null {
  if (buf.length < 30) return null;
  const kind = buf.subarray(12, 16).toString("latin1");
  if (kind === "VP8 ") {
    // lossy: frame tag(3) start code 9D 01 2A, then 14-bit width / height
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (kind === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  return null;
}

/** The pixel dimensions in `buf`'s header, or `null` if it is not a well-formed JPEG/PNG/WEBP header. */
export function readImageDimensions(buf: Buffer, mime: string): ImageDimensions | null {
  try {
    const dims = mime === "image/png" ? png(buf) : mime === "image/jpeg" ? jpeg(buf) : mime === "image/webp" ? webp(buf) : null;
    if (!dims || !Number.isInteger(dims.width) || !Number.isInteger(dims.height) || dims.width < 1 || dims.height < 1) return null;
    return dims;
  } catch {
    return null; // a read past the end of a truncated buffer
  }
}
