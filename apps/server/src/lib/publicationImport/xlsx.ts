import { inflateRawSync } from "node:zlib";

/**
 * A small, dependency-free reader for the parts of an .xlsx workbook the publication import needs: sheet names and states, every cell's
 * value (shared strings, inline strings, numbers, booleans) and which numeric cells are DATES (so a date cell reads back as an ISO date, not
 * a serial number). An .xlsx is a zip of XML parts; this reads only the handful of parts below with Node's own zlib.
 *
 * Deliberately NOT a general spreadsheet library: no formulas (the cached value is read), no styles beyond "is this a date format", no
 * writing. Hostile input is bounded: entry and output sizes are capped, only the named parts are ever inflated, and every parse is a linear
 * scan. The import is an administrator-run command on a file the administrator chose, but it still must not hang or exhaust memory.
 */

const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_PART_BYTES = 20 * 1024 * 1024;

export type CellValue = string | number | boolean;

export interface Cell {
  /** A1-style reference, e.g. "C14". */
  ref: string;
  value: CellValue;
  /** Set for a numeric cell whose number format is a date: the ISO date (YYYY-MM-DD, time dropped) the serial stands for. */
  date?: string;
}

export interface Sheet {
  name: string;
  state: "visible" | "hidden" | "veryHidden";
  cells: Map<string, Cell>;
  /** Highest row number that holds a cell. */
  maxRow: number;
}

export interface Workbook {
  sheets: Sheet[];
}

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxError";
  }
}

// ---- zip -------------------------------------------------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function readZipDirectory(buf: Buffer): Map<string, ZipEntry> {
  if (buf.length > MAX_ZIP_BYTES) throw new XlsxError("The file is too large to be a publication list.");
  // End of central directory record: signature 0x06054b50, at most 22 + 65535 bytes from the end.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("Not an .xlsx file (no zip directory found).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError("Corrupt zip directory.");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipPart(buf: Buffer, entries: Map<string, ZipEntry>, name: string): string | null {
  const e = entries.get(name);
  if (!e) return null;
  if (e.uncompressedSize > MAX_PART_BYTES) throw new XlsxError(`The part ${name} is unreasonably large.`);
  const h = e.localOffset;
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== 0x04034b50) throw new XlsxError("Corrupt zip entry.");
  const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data.toString("utf8");
  if (e.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES }).toString("utf8");
  throw new XlsxError(`Unsupported zip compression method ${e.method}.`);
}

// ---- XML helpers -----------------------------------------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, g: string) => {
    switch (g) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const code = g[1] === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
    }
  });
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeEntities(m[2]);
  return out;
}

/** The text of a <t> run list (shared string item or inline string). Phonetic guides (<rPh>, furigana) are not part of the text. */
function textOf(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").replace(/<phoneticPr\b[^>]*\/>/g, "");
  let out = "";
  for (const m of withoutPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += decodeEntities(m[1] ?? "");
  // XML 1.0 end-of-line handling: a literal CRLF or CR in the document reads as LF (an escaped &#13; stays a CR, as decoded above).
  return out.replace(/\r\n?/g, "\n");
}

// ---- styles: which number formats are dates --------------------------------------------------------------------------------

const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormatCode(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/_./g, "")
    .replace(/\*./g, "");
  return /[ymdhs]/i.test(stripped) && !/^general$/i.test(code.trim());
}

function dateStyleIndexes(stylesXml: string | null): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    if (a.numFmtId !== undefined && a.formatCode !== undefined) custom.set(Number(a.numFmtId), a.formatCode);
  }
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!cellXfs) return out;
  let index = 0;
  for (const m of cellXfs[1].matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const id = Number(attrs(m[1]).numFmtId ?? 0);
    if (BUILT_IN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormatCode(custom.get(id)!))) out.add(index);
    index++;
  }
  return out;
}

/** Excel serial -> ISO date. The 1900 system treats 1900 as a leap year, so serials >= 61 are shifted by one day (epoch 1899-12-30). */
export function excelSerialToIso(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + Math.floor(serial) * 86400000);
  return d.toISOString().slice(0, 10);
}

// ---- workbook --------------------------------------------------------------------------------------------------------------

export function readWorkbook(buf: Buffer): Workbook {
  const entries = readZipDirectory(buf);
  const workbookXml = readZipPart(buf, entries, "xl/workbook.xml");
  if (!workbookXml) throw new XlsxError("Not an .xlsx workbook (xl/workbook.xml is missing).");
  const relsXml = readZipPart(buf, entries, "xl/_rels/workbook.xml.rels") ?? "";
  const sharedXml = readZipPart(buf, entries, "xl/sharedStrings.xml");
  const dateStyles = dateStyleIndexes(readZipPart(buf, entries, "xl/styles.xml"));
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/i.test(workbookXml);

  const shared: string[] = [];
  if (sharedXml) for (const m of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) shared.push(textOf(m[1] ?? ""));

  const targets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    if (a.Id && a.Target) targets.set(a.Id, a.Target.startsWith("/") ? a.Target.slice(1) : `xl/${a.Target}`);
  }

  const sheets: Sheet[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    const target = targets.get(a["r:id"] ?? "");
    if (!a.name || !target) continue;
    const xml = readZipPart(buf, entries, target);
    if (xml === null) throw new XlsxError(`The worksheet part ${target} is missing.`);
    const state = a.state === "hidden" || a.state === "veryHidden" ? a.state : "visible";
    const cells = new Map<string, Cell>();
    let maxRow = 0;
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attrs(c[1]);
      const ref = ca.r;
      if (!ref || !/^[A-Z]{1,3}[1-9]\d*$/.test(ref)) continue;
      const body = c[2] ?? "";
      const type = ca.t ?? "n";
      let value: CellValue | undefined;
      let date: string | undefined;
      if (type === "inlineStr") {
        value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v === undefined) continue;
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "str" || type === "e") value = decodeEntities(v);
        else if (type === "b") value = v === "1";
        else {
          const n = Number(v);
          value = Number.isFinite(n) ? n : decodeEntities(v);
          if (typeof value === "number" && ca.s !== undefined && dateStyles.has(Number(ca.s))) date = excelSerialToIso(value, date1904) ?? undefined;
        }
      }
      if (value === undefined || value === "") continue;
      cells.set(ref, { ref, value, ...(date ? { date } : {}) });
      maxRow = Math.max(maxRow, Number(ref.replace(/^[A-Z]+/, "")));
    }
    sheets.push({ name: a.name, state, cells, maxRow });
  }
  if (sheets.length === 0) throw new XlsxError("The workbook has no worksheets.");
  return { sheets };
}
