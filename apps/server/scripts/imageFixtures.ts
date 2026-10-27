/**
 * Generated image fixtures for the sanitizer and profile-photo tests. Nothing here is a real photograph or contains real personal
 * data: every "private" value is an obvious SENTINEL string so a test can prove it was removed. The PNG files are real, decodable
 * PNGs (deflated scanlines); the JPEG, GIF and WebP files are container-valid byte sequences whose compressed payloads are
 * arbitrary (the inspector and sanitizer never decode them, and these fixtures do not claim to be decodable photos).
 */
import zlib from "node:zlib";

// ---- shared ---------------------------------------------------------------------------------------------------------------
export const SENTINELS = {
  make: "SENTINEL-MAKE-CANON",
  model: "SENTINEL-MODEL-EOS-R5",
  description: "SENTINEL-DESCRIPTION",
  artist: "SENTINEL-ARTIST-NAME",
  date: "2024:01:02 03:04:05",
  makerNote: "SENTINEL-MAKERNOTE-SERIAL-12345",
  gps: "SENTINEL-GPS-35.6895N-139.6917E",
  thumbnail: "SENTINEL-EXIF-THUMBNAIL",
  xmp: "SENTINEL-XMP-GEO-LOCATION",
  iptc: "SENTINEL-IPTC-CAPTION",
  comment: "SENTINEL-COMMENT",
  mpf: "SENTINEL-MPF-SECOND-IMAGE",
  jfifThumb: "SENTINEL-JFIF-THUMB",
  appended: "SENTINEL-APPENDED-PAYLOAD",
  text: "SENTINEL-PNG-TEXT",
  itxt: "SENTINEL-PNG-XMP",
  priv: "SENTINEL-PRIVATE-CHUNK",
  gifComment: "SENTINEL-GIF-COMMENT",
  gifXmp: "SENTINEL-GIF-XMP",
  gifText: "SENTINEL-GIF-PLAINTEXT",
  webpExif: "SENTINEL-WEBP-EXIF",
  webpXmp: "SENTINEL-WEBP-XMP",
  unknown: "SENTINEL-UNKNOWN-CHUNK",
} as const;
export const ALL_SENTINEL_STRINGS = Object.values(SENTINELS).filter((v) => v !== SENTINELS.date);

const ascii = (s: string) => Buffer.from(s, "latin1");
const u16 = (n: number, little = false) => {
  const b = Buffer.alloc(2);
  little ? b.writeUInt16LE(n) : b.writeUInt16BE(n);
  return b;
};
const u32 = (n: number, little = false) => {
  const b = Buffer.alloc(4);
  little ? b.writeUInt32LE(n) : b.writeUInt32BE(n);
  return b;
};

// ---- EXIF / TIFF ----------------------------------------------------------------------------------------------------------
export interface ExifOptions {
  orientation?: number | null; // null/undefined: no Orientation tag
  little?: boolean;
  /** Include the privacy-sensitive tags (description, make, model, date, artist, maker note, GPS IFD, thumbnail IFD). */
  rich?: boolean;
  /** Write the Orientation entry twice (ambiguous). */
  duplicateOrientation?: boolean;
  /** Orientation entry type/count override (to make it invalid). */
  orientationType?: number;
  orientationCount?: number;
}

/** A TIFF block (starting at "II"/"MM") with an IFD0 whose entries are sorted by tag. */
export function exifTiff(o: ExifOptions = {}): Buffer {
  const little = o.little ?? false;
  const w16 = (n: number) => u16(n, little);
  const w32 = (n: number) => u32(n, little);
  type Entry = { tag: number; type: number; count: number; value: Buffer | number }; // Buffer = out-of-line data, number = inline value
  const entries: Entry[] = [];
  if (o.rich) {
    entries.push({ tag: 0x010e, type: 2, count: SENTINELS.description.length + 1, value: Buffer.concat([ascii(SENTINELS.description), Buffer.from([0])]) });
    entries.push({ tag: 0x010f, type: 2, count: SENTINELS.make.length + 1, value: Buffer.concat([ascii(SENTINELS.make), Buffer.from([0])]) });
    entries.push({ tag: 0x0110, type: 2, count: SENTINELS.model.length + 1, value: Buffer.concat([ascii(SENTINELS.model), Buffer.from([0])]) });
  }
  if (o.orientation !== null && o.orientation !== undefined) {
    const e: Entry = { tag: 0x0112, type: o.orientationType ?? 3, count: o.orientationCount ?? 1, value: o.orientation };
    entries.push(e);
    if (o.duplicateOrientation) entries.push({ ...e });
  }
  if (o.rich) {
    entries.push({ tag: 0x0132, type: 2, count: 20, value: Buffer.concat([ascii(SENTINELS.date), Buffer.from([0])]) });
    entries.push({ tag: 0x013b, type: 2, count: SENTINELS.artist.length + 1, value: Buffer.concat([ascii(SENTINELS.artist), Buffer.from([0])]) });
    entries.push({ tag: 0x8825, type: 4, count: 1, value: -1 }); // GPS IFD pointer, patched below
    entries.push({ tag: 0x927c, type: 7, count: SENTINELS.makerNote.length, value: ascii(SENTINELS.makerNote) });
  }
  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let dataPos = ifdOffset + ifdSize;
  const data: Buffer[] = [];
  const place = (b: Buffer) => {
    const at = dataPos;
    data.push(b.length % 2 ? Buffer.concat([b, Buffer.from([0])]) : b);
    dataPos += b.length + (b.length % 2);
    return at;
  };
  // GPS IFD (one text entry holding the sentinel, plus a reference) and a thumbnail IFD1 with an embedded "JPEG".
  let gpsOffset = 0;
  if (o.rich) {
    const gpsText = Buffer.concat([ascii(SENTINELS.gps), Buffer.from([0])]);
    const gpsDataAt = ifdOffset + ifdSize + 0; // computed after IFD0 data below; use a two-step placement
    void gpsDataAt;
    const textAt = place(gpsText);
    const gps = Buffer.concat([w16(1), w16(0x0001), w16(2), w32(gpsText.length), w32(textAt), w32(0)]);
    gpsOffset = place(gps);
  }
  const rendered = entries.map((e) => {
    const head = Buffer.concat([w16(e.tag), w16(e.type), w32(e.count)]);
    if (e.tag === 0x8825) return Buffer.concat([head, w32(gpsOffset)]);
    if (typeof e.value === "number") return Buffer.concat([head, e.type === 3 ? Buffer.concat([w16(e.value), Buffer.alloc(2)]) : w32(e.value)]);
    if (e.value.length <= 4) return Buffer.concat([head, e.value, Buffer.alloc(4 - e.value.length)]);
    return Buffer.concat([head, w32(place(e.value))]);
  });
  let ifd1 = 0;
  if (o.rich) {
    const thumb = Buffer.concat([Buffer.from([0xff, 0xd8]), ascii(SENTINELS.thumbnail), Buffer.from([0xff, 0xd9])]);
    const thumbAt = place(thumb);
    ifd1 = place(Buffer.concat([w16(1), w16(0x0201), w16(4), w32(1), w32(thumbAt), w32(0)]));
  }
  const header = Buffer.concat([ascii(little ? "II" : "MM"), w16(42), w32(ifdOffset)]);
  const ifd0 = Buffer.concat([w16(entries.length), ...rendered, w32(ifd1)]);
  return Buffer.concat([header, ifd0, ...data]);
}

// ---- JPEG -----------------------------------------------------------------------------------------------------------------
export const jpegSeg = (marker: number, body: Buffer) => Buffer.concat([Buffer.from([0xff, marker]), u16(body.length + 2), body]);
export const jpegApp1Exif = (tiff: Buffer) => jpegSeg(0xe1, Buffer.concat([ascii("Exif\0\0"), tiff]));
export const jpegXmp = () => jpegSeg(0xe1, Buffer.concat([ascii("http://ns.adobe.com/xap/1.0/\0"), ascii(`<x:xmpmeta>${SENTINELS.xmp}</x:xmpmeta>`)]));
export const jpegIptc = () => jpegSeg(0xed, Buffer.concat([ascii("Photoshop 3.0\0"), ascii("8BIM"), ascii(SENTINELS.iptc)]));
export const jpegComment = () => jpegSeg(0xfe, ascii(SENTINELS.comment));
export const jpegMpf = () => jpegSeg(0xe2, Buffer.concat([ascii("MPF\0"), ascii(SENTINELS.mpf)]));
export const ICC_PAYLOAD = "KEEP-ICC-PROFILE-BYTES";
export const jpegIcc = (seq = 1, count = 1, payload = ICC_PAYLOAD) => jpegSeg(0xe2, Buffer.concat([ascii("ICC_PROFILE\0"), Buffer.from([seq, count]), ascii(payload)]));
export const jpegAdobe = () => jpegSeg(0xee, Buffer.concat([ascii("Adobe"), Buffer.from([0, 100, 0, 0, 0, 0, 2])]));
export const jpegJfif = (withThumb = true) =>
  jpegSeg(0xe0, Buffer.concat([ascii("JFIF\0"), Buffer.from([1, 1, 1]), u16(72), u16(72), withThumb ? Buffer.from([2, 2]) : Buffer.from([0, 0]), withThumb ? ascii(SENTINELS.jfifThumb) : Buffer.alloc(0)]));

export interface JpegOptions {
  w?: number;
  h?: number;
  comps?: number;
  sof?: number;
  /** Segments placed after SOI (APPn, COM, ...). */
  before?: Buffer[];
  /** Entropy-coded bytes of the first scan (may contain FF00 stuffing and RSTn markers). */
  scan?: Buffer;
  /** Extra segments + scans after the first scan (progressive-style): each is [segment, scanBytes?]. */
  after?: Buffer[];
  /** Bytes appended after the first real EOI. */
  trailing?: Buffer;
  noEoi?: boolean;
}
export const SCAN_DATA = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78, 0xff, 0x00, 0x9a, 0xff, 0xd1, 0xbc, 0xde]);
export function jpegFile(o: JpegOptions = {}): Buffer {
  const comps = o.comps ?? 3;
  const sof = Buffer.alloc(6 + 3 * comps);
  sof[0] = 8;
  sof.writeUInt16BE(o.h ?? 48, 1);
  sof.writeUInt16BE(o.w ?? 64, 3);
  sof[5] = comps;
  for (let i = 0; i < comps; i++) sof.set([i + 1, 0x11, 0], 6 + 3 * i);
  const dqt = jpegSeg(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 3)]));
  const dht = jpegSeg(0xc4, Buffer.concat([Buffer.from([0]), Buffer.from([1]), Buffer.alloc(15, 0), Buffer.from([0])]));
  const sos = jpegSeg(0xda, Buffer.from([comps, ...Array.from({ length: comps }, (_, i) => [i + 1, 0]).flat(), 0, 63, 0]));
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...(o.before ?? []), dqt, jpegSeg(o.sof ?? 0xc0, sof), dht, sos, o.scan ?? SCAN_DATA, ...(o.after ?? []), ...(o.noEoi ? [] : [Buffer.from([0xff, 0xd9])]), o.trailing ?? Buffer.alloc(0)]);
}
/** A JPEG that carries every kind of metadata (and an appended second JPEG with its own metadata). */
export function jpegWithEverything(orientation: number | null = 6): Buffer {
  const second = jpegFile({ before: [jpegApp1Exif(exifTiff({ rich: true, orientation: 1 })), jpegComment()] });
  return jpegFile({
    before: [jpegJfif(true), jpegApp1Exif(exifTiff({ rich: true, orientation })), jpegXmp(), jpegIptc(), jpegComment(), jpegMpf(), jpegIcc(), jpegAdobe()],
    trailing: Buffer.concat([ascii(SENTINELS.appended), second]),
  });
}

// ---- PNG ------------------------------------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
export const pngChunk = (type: string, data: Buffer = Buffer.alloc(0)) => {
  const body = Buffer.concat([ascii(type), data]);
  return Buffer.concat([u32(data.length), body, u32(crc(body))]);
};
export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const pngIhdr = (w: number, h: number, depth = 8, color = 2) => pngChunk("IHDR", Buffer.concat([u32(w), u32(h), Buffer.from([depth, color, 0, 0, 0])]));
export function pngIdat(w: number, h: number, shade = 0x40, splits = 1): Buffer[] {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, shade)]);
  const z = zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)));
  const size = Math.ceil(z.length / splits);
  return Array.from({ length: splits }, (_, i) => pngChunk("IDAT", z.subarray(i * size, (i + 1) * size))).filter((c) => c.length > 12);
}
export const pngText = () => pngChunk("tEXt", Buffer.concat([ascii("Comment\0"), ascii(SENTINELS.text)]));
export const pngZtxt = () => pngChunk("zTXt", Buffer.concat([ascii("Comment\0\0"), zlib.deflateSync(ascii(SENTINELS.text))]));
export const pngItxt = () => pngChunk("iTXt", Buffer.concat([ascii("XML:com.adobe.xmp\0\0\0\0\0"), ascii(`<x:xmpmeta>${SENTINELS.itxt}</x:xmpmeta>`)]));
export const pngExif = (tiff: Buffer) => pngChunk("eXIf", tiff);
export const pngTime = () => pngChunk("tIME", Buffer.from([0x07, 0xe8, 1, 2, 3, 4, 5]));
export const pngPhys = () => pngChunk("pHYs", Buffer.concat([u32(2835), u32(2835), Buffer.from([1])]));
export const pngPrivate = () => pngChunk("prVt", ascii(SENTINELS.priv));
export const pngIccp = () => pngChunk("iCCP", Buffer.concat([ascii("icc\0\0"), zlib.deflateSync(ascii(ICC_PAYLOAD))]));
export function pngFile(o: { w?: number; h?: number; before?: Buffer[]; afterIdat?: Buffer[]; splits?: number; color?: number } = {}): Buffer {
  const w = o.w ?? 40;
  const h = o.h ?? 24;
  return Buffer.concat([PNG_SIG, pngIhdr(w, h), ...(o.before ?? []), ...pngIdat(w, h, 0x40, o.splits ?? 1), ...(o.afterIdat ?? []), pngChunk("IEND")]);
}
export function pngWithEverything(orientation: number | null = 6): Buffer {
  return pngFile({
    before: [pngChunk("gAMA", u32(45455)), pngChunk("sRGB", Buffer.from([0])), pngChunk("sBIT", Buffer.from([8, 8, 8])), pngChunk("tRNS", Buffer.from([0, 1, 0, 1, 0, 1])), pngChunk("bKGD", Buffer.from([0, 2, 0, 2, 0, 2])), pngText(), pngZtxt(), pngItxt(), ...(orientation === null ? [] : [pngExif(exifTiff({ rich: true, orientation }))]), pngTime(), pngPhys(), pngPrivate()],
    afterIdat: [pngText()],
    splits: 3,
  });
}
export const apngFile = () =>
  Buffer.concat([PNG_SIG, pngIhdr(40, 24), pngChunk("acTL", Buffer.concat([u32(2), u32(0)])), pngChunk("fcTL", Buffer.alloc(26)), ...pngIdat(40, 24), pngChunk("fdAT", Buffer.alloc(8)), pngChunk("IEND")]);

// ---- GIF ------------------------------------------------------------------------------------------------------------------
const subBlocks = (b: Buffer) => {
  const parts: Buffer[] = [];
  for (let i = 0; i < b.length; i += 255) parts.push(Buffer.from([Math.min(255, b.length - i)]), b.subarray(i, i + 255));
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
};
export const gifComment = () => Buffer.concat([Buffer.from([0x21, 0xfe]), subBlocks(ascii(SENTINELS.gifComment))]);
export const gifApp = (id: string, auth: string, data: Buffer) => Buffer.concat([Buffer.from([0x21, 0xff, 11]), ascii(id.padEnd(8).slice(0, 8)), ascii(auth.padEnd(3).slice(0, 3)), subBlocks(data)]);
export const gifNetscape = () => gifApp("NETSCAPE", "2.0", Buffer.from([1, 0, 0]));
export const gifXmp = () => gifApp("XMP Data", "XMP", ascii(SENTINELS.gifXmp));
export const gifPlainText = () => Buffer.concat([Buffer.from([0x21, 0x01, 12]), Buffer.alloc(12), subBlocks(ascii(SENTINELS.gifText))]);
export const gifGce = (delay = 0) => Buffer.from([0x21, 0xf9, 4, 0x01, delay & 255, delay >> 8, 0, 0]);
export function gifFile(o: { w?: number; h?: number; extras?: Buffer[]; frames?: number; gce?: boolean; trailer?: boolean } = {}): Buffer {
  const w = o.w ?? 48;
  const h = o.h ?? 32;
  const head = Buffer.concat([ascii("GIF89a"), u16(w, true), u16(h, true), Buffer.from([0x80, 0, 0]), Buffer.alloc(6, 0x55)]);
  const frame = Buffer.concat([...(o.gce ? [gifGce(10)] : []), Buffer.from([0x2c, 0, 0, 0, 0]), u16(w, true), u16(h, true), Buffer.from([0]), Buffer.from([2]), subBlocks(Buffer.from([0x44, 0x01, 0x02, 0x03]))]);
  return Buffer.concat([head, ...(o.extras ?? []), ...Array.from({ length: o.frames ?? 1 }, () => frame), ...(o.trailer === false ? [] : [Buffer.from([0x3b])])]);
}

// ---- WebP -----------------------------------------------------------------------------------------------------------------
export const webpChunk = (type: string, data: Buffer) => Buffer.concat([ascii(type), u32(data.length, true), data, ...(data.length % 2 ? [Buffer.alloc(1)] : [])]);
export const riff = (payload: Buffer) => Buffer.concat([ascii("RIFF"), u32(4 + payload.length, true), ascii("WEBP"), payload]);
export const vp8Payload = (w: number, h: number, extra = 0) => Buffer.concat([Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a]), u16(w, true), u16(h, true), Buffer.alloc(extra, 7)]);
export const vp8lPayload = (w: number, h: number, extra = 0) => Buffer.concat([Buffer.from([0x2f]), u32(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), true), Buffer.alloc(extra, 9)]);
export function vp8x(w: number, h: number, flags: number) {
  const d = Buffer.alloc(10);
  d[0] = flags;
  d.writeUIntLE(w - 1, 4, 3);
  d.writeUIntLE(h - 1, 7, 3);
  return d;
}
export const WEBP_ICC = "KEEP-WEBP-ICC-BYTES";
export function webpWithEverything(orientation: number | null = 6, o: { lossless?: boolean; w?: number; h?: number } = {}): Buffer {
  const w = o.w ?? 64;
  const h = o.h ?? 48;
  const img = o.lossless ? webpChunk("VP8L", vp8lPayload(w, h, 21)) : webpChunk("VP8 ", vp8Payload(w, h, 21));
  return riff(
    Buffer.concat([
      webpChunk("VP8X", vp8x(w, h, 0x20 | 0x08 | 0x04)),
      webpChunk("ICCP", ascii(WEBP_ICC)),
      img,
      webpChunk("EXIF", Buffer.concat([ascii("Exif\0\0"), exifTiff({ rich: true, orientation })])),
      webpChunk("XMP ", ascii(`<x:xmpmeta>${SENTINELS.webpXmp}</x:xmpmeta>`)),
      webpChunk("UNKN", ascii(SENTINELS.unknown)),
    ]),
  );
}
