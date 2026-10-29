import { crc32, deflateRawSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test helper: writes a small but genuine .xlsx (a zip of XML parts) so the importer's reader is exercised on the real file format, in CI,
 * without committing the lab's spreadsheet. Shared strings, inline strings, numbers, booleans, a date-formatted number, hidden sheets,
 * stored and deflated zip entries, and the CRLF / entity / phonetic-guide details of real Excel output are all covered by options.
 */

export type FixtureValue = string | number | boolean | { date: string };

export interface FixtureSheet {
  name: string;
  state?: "visible" | "hidden" | "veryHidden";
  cells: Record<string, FixtureValue>;
}

export interface BuildOptions {
  sheets: FixtureSheet[];
  /** Write text as shared strings (Excel's own way, default) or as inline strings. */
  inlineStrings?: boolean;
  /** Deflate the parts (default) or store them. */
  stored?: boolean;
  /** Add a Japanese phonetic guide (<rPh>) to every shared string, as Excel does for Japanese text. */
  phonetic?: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function serialOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

function zip(files: Array<[string, string]>, stored: boolean): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, "utf8");
    const comp = stored ? data : deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(stored ? 0 : 8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

export function buildXlsx(opts: BuildOptions): Buffer {
  const shared: string[] = [];
  const sharedIndex = (s: string) => {
    let i = shared.indexOf(s);
    if (i < 0) i = shared.push(s) - 1;
    return i;
  };
  const sheetXml = opts.sheets.map((sheet) => {
    const rows = new Map<number, string[]>();
    for (const [ref, value] of Object.entries(sheet.cells)) {
      const row = Number(ref.replace(/^[A-Z]+/, ""));
      let cell: string;
      if (typeof value === "object") cell = `<c r="${ref}" s="1"><v>${serialOf(value.date)}</v></c>`;
      else if (typeof value === "number") cell = `<c r="${ref}"><v>${value}</v></c>`;
      else if (typeof value === "boolean") cell = `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
      else if (opts.inlineStrings) cell = `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
      else cell = `<c r="${ref}" t="s"><v>${sharedIndex(value)}</v></c>`;
      rows.set(row, [...(rows.get(row) ?? []), cell]);
    }
    const body = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([r, cells]) => `<row r="${r}">${cells.join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  });
  const files: Array<[string, string]> = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${opts.sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.state && s.state !== "visible" ? ` state="${s.state}"` : ""} r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${opts.sheets
        .map((_s, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}</Relationships>`,
    ],
    // xf 0 = General, xf 1 = built-in date format 14.
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`],
  ];
  sheetXml.forEach((xml, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, xml]));
  if (!opts.inlineStrings) {
    files.push([
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
        .map((s) => `<si><t xml:space="preserve">${esc(s)}</t>${opts.phonetic ? `<rPh sb="0" eb="1"><t>ふりがな</t></rPh>` : ""}</si>`)
        .join("")}</sst>`,
    ]);
  }
  return zip(files, opts.stored === true);
}

// ---- the achievements-form layout, built from the fixture records --------------------------------------------------------------

export interface FixtureRecord {
  label: string | null;
  authors: string | null;
  title: string | null;
  venue: string | null;
  listNumber: string | null;
  category: string | null;
  volume: string | number | null;
  pagesStart: string | number | null;
  pagesEnd: string | number | null;
  doi: string | null;
  year: string | number | null;
  month: string | number | null;
  status: string | null;
  acceptedDate: string | number | { date: string } | null;
  acceptedLabel: string | null;
}

export interface FixtureFile {
  owner: string;
  records: FixtureRecord[];
}

export function loadFixtureRecords(): FixtureFile {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(fs.readFileSync(path.join(here, "..", "fixtures", "publication-list-records.json"), "utf8")) as FixtureFile;
}

/** The cells of one achievements-form block starting at `row`, laid out exactly as the lab's sheet does. */
export function formBlock(r: FixtureRecord, row: number): Record<string, FixtureValue> {
  const cells: Record<string, FixtureValue> = {};
  const put = (ref: string, v: FixtureValue | null | undefined) => {
    if (v !== null && v !== undefined && v !== "") cells[ref] = v;
  };
  put(`A${row}`, r.label);
  put(`B${row}`, "著者");
  put(`C${row}`, r.authors);
  put(`B${row + 1}`, "題目");
  put(`C${row + 1}`, r.title);
  put(`B${row + 2}`, "雑誌名");
  put(`C${row + 2}`, r.venue);
  put(`B${row + 3}`, "雑誌リスト番号");
  put(`C${row + 3}`, r.listNumber);
  put(`B${row + 4}`, "論文カテゴリー");
  put(`C${row + 4}`, r.category);
  put(`B${row + 5}`, "巻");
  put(`C${row + 5}`, r.volume);
  put(`B${row + 6}`, "ページ");
  put(`C${row + 6}`, "始め \nStart");
  put(`D${row + 6}`, r.pagesStart);
  put(`E${row + 6}`, "終り\n End");
  put(`F${row + 6}`, r.pagesEnd);
  put(`B${row + 7}`, "DOI");
  put(`C${row + 7}`, r.doi);
  put(`B${row + 8}`, "発行年月");
  put(`C${row + 8}`, "年 Year");
  put(`D${row + 8}`, r.year);
  put(`E${row + 8}`, "月 Month");
  put(`F${row + 8}`, r.month);
  put(`B${row + 9}`, "状況");
  put(`C${row + 9}`, r.status);
  put(`F${row + 9}`, r.acceptedLabel ?? "受理年月日");
  put(`H${row + 9}`, r.acceptedDate as FixtureValue | null);
  return cells;
}

/** A whole workbook in the achievements-form layout (header rows like the real sheet, `gap` blank rows between blocks). */
export function formWorkbook(file: FixtureFile, opts: { gap?: number; owner?: string; startRow?: number } & Omit<BuildOptions, "sheets"> = {}): Buffer {
  const cells: Record<string, FixtureValue> = { A3: "氏名", C3: opts.owner ?? file.owner };
  let row = opts.startRow ?? 7;
  for (const r of file.records) {
    Object.assign(cells, formBlock(r, row));
    row += 10 + (opts.gap ?? 0);
  }
  return buildXlsx({ ...opts, sheets: [{ name: "Sheet1", cells }] });
}
