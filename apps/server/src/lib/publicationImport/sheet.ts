import type { Cell, Sheet } from "./xlsx.js";

/**
 * Parser for the "researcher achievements" FORM layout that the lab's publication list uses (see docs/architecture/publication-list-import.md).
 * It is NOT a table with a header row: every publication is a vertical block of labelled rows,
 *
 *     A: record label (e.g. 査読付き学術論文①)   B: field label        C..H: the value cells
 *     ...                                         著者 (authors)        C = text
 *                                                 題目 (title)          C = text
 *                                                 雑誌名 (journal/conference)  C = text
 *                                                 雑誌リスト番号 (journal list no. = ISSN/ISBN)  C = text
 *                                                 論文カテゴリー (category)    C = text
 *                                                 巻 (volume)           C = text
 *                                                 ページ (pages)        C = "始め"  D = start  E = "終り"  F = end
 *                                                 DOI                   C = text
 *                                                 発行年月 (issue date)  C = "年"  D = year  E = "月"  F = month
 *                                                 状況 (status)         C = text  F = "受理年月日"  H = acceptance date
 *
 * A block is recognised by its B-column LABELS, never by row numbers, so a list with more or fewer records, or blank rows between blocks,
 * parses the same way. Nothing is guessed: a label that is missing is reported, and a cell that is empty stays empty.
 */

/** Column of each value, by field. A label cell sits next to it; a mismatch is reported as layout drift, never silently accepted. */
export const COLUMNS = {
  recordLabel: "A",
  fieldLabel: "B",
  value: "C",
  pagesStart: "D",
  pagesEnd: "F",
  dateYear: "D",
  dateMonth: "F",
  acceptedDate: "H",
} as const;

/** The labelled rows of a block. */
type RowKey = "authors" | "title" | "venue" | "listNumber" | "category" | "volume" | "pages" | "doi" | "issueDate" | "status";

/** Source label (whitespace removed) -> the row it names. */
const FIELD_LABELS: Record<string, RowKey> = {
  著者: "authors",
  題目: "title",
  雑誌名: "venue",
  雑誌リスト番号: "listNumber",
  論文カテゴリー: "category",
  巻: "volume",
  ページ: "pages",
  DOI: "doi",
  発行年月: "issueDate",
  状況: "status",
};

export interface RawCell {
  ref: string;
  /** The cell's text exactly as stored (numbers rendered without a trailing ".0"), or "" when empty. */
  text: string;
  /** ISO date, when the cell holds a date-formatted number. */
  date?: string;
}

/** Every value cell of a record, always present (an empty cell has `text: ""`). */
export interface RawFields {
  authors: RawCell;
  title: RawCell;
  venue: RawCell;
  listNumber: RawCell;
  category: RawCell;
  volume: RawCell;
  pagesStart: RawCell;
  pagesEnd: RawCell;
  doi: RawCell;
  year: RawCell;
  month: RawCell;
  status: RawCell;
  acceptedDate: RawCell;
}

export interface SheetIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  cell?: string;
}

export interface RawRecord {
  /** 1-based position among the records of the whole workbook; the stable key used in reports and overrides. */
  ordinal: number;
  sheet: string;
  /** The label in column A of the first row (e.g. 査読付き学術論文①), or "" if absent. */
  label: string;
  startRow: number;
  endRow: number;
  cells: RawFields;
  issues: SheetIssue[];
  /** True when every value cell of the block is empty (a blank template block, not a publication). */
  empty: boolean;
}

export interface ParsedSheets {
  /** The person the list belongs to (氏名), if the sheet states one. Never used to link or create accounts. */
  owner: string;
  sheets: Array<{ name: string; state: string; cellCount: number; blocks: number; skipped?: string }>;
  records: RawRecord[];
  issues: SheetIssue[];
}

const strip = (s: string) => s.replace(/\s+/g, "");

function text(cell: Cell | undefined): string {
  if (!cell) return "";
  return String(cell.value);
}

export function parseFormSheets(sheets: Sheet[]): ParsedSheets {
  const out: ParsedSheets = { owner: "", sheets: [], records: [], issues: [] };
  for (const sheet of sheets) {
    const info = { name: sheet.name, state: sheet.state, cellCount: sheet.cells.size, blocks: 0 } as ParsedSheets["sheets"][number];
    out.sheets.push(info);
    if (sheet.state !== "visible") {
      info.skipped = `${sheet.state} sheet (not read)`;
      continue;
    }
    const at = (col: string, row: number) => sheet.cells.get(`${col}${row}`);
    const val = (col: string, row: number): RawCell => {
      const c = at(col, row);
      return { ref: `${col}${row}`, text: text(c), ...(c?.date ? { date: c.date } : {}) };
    };

    for (let r = 1; r <= sheet.maxRow; r++) {
      if (strip(text(at("A", r))) === "氏名" && !out.owner) out.owner = text(at(COLUMNS.value, r)).trim();
    }

    // A block starts at every row whose B label is 著者 (authors).
    const starts: number[] = [];
    for (let r = 1; r <= sheet.maxRow; r++) if (strip(text(at(COLUMNS.fieldLabel, r))) === "著者") starts.push(r);
    info.blocks = starts.length;
    starts.forEach((start, i) => {
      const end = (starts[i + 1] ?? sheet.maxRow + 1) - 1;
      const issues: SheetIssue[] = [];
      const rowOf = new Map<RowKey, number>();
      for (let r = start; r <= end; r++) {
        const key = FIELD_LABELS[strip(text(at(COLUMNS.fieldLabel, r)))];
        if (!key) continue;
        if (rowOf.has(key)) issues.push({ level: "warning", code: "duplicate-label", message: `The label in B${r} repeats an earlier row of this block; the first one is used.`, cell: `B${r}` });
        else rowOf.set(key, r);
      }
      for (const label of Object.keys(FIELD_LABELS)) {
        const key = FIELD_LABELS[label];
        if (!rowOf.has(key)) issues.push({ level: "warning", code: "missing-label", message: `The block starting at row ${start} has no "${label}" row; that field is treated as not stated.` });
      }
      const empty0: RawCell = { ref: "", text: "" };
      const get = (key: RowKey, col: string = COLUMNS.value): RawCell => (rowOf.has(key) ? val(col, rowOf.get(key)!) : empty0);

      const pagesRow = rowOf.get("pages");
      const dateRow = rowOf.get("issueDate");
      const statusRow = rowOf.get("status");
      // Sub-labels next to the numeric cells. Only a FILLED value cell under a label that does not match is reported: it means the form was
      // edited and the columns may no longer line up. (An empty value cell with a missing label misreads nothing.)
      const drift = (row: number | undefined, labelCol: string, valueCol: string, expect: RegExp, what: string) => {
        if (row === undefined || !at(valueCol, row)) return;
        const label = strip(text(at(labelCol, row)));
        if (!expect.test(label)) issues.push({ level: "warning", code: "layout-drift", message: `${valueCol}${row} is read as the ${what}, but its label cell ${labelCol}${row} reads "${label}".`, cell: `${valueCol}${row}` });
      };
      drift(pagesRow, "C", COLUMNS.pagesStart, /^始め/, "start page");
      drift(pagesRow, "E", COLUMNS.pagesEnd, /^終り/, "end page");
      drift(dateRow, "C", COLUMNS.dateYear, /^年/, "year");
      drift(dateRow, "E", COLUMNS.dateMonth, /^月/, "month");
      drift(statusRow, "F", COLUMNS.acceptedDate, /^受理年月日/, "acceptance date");

      const cells: RawFields = {
        authors: get("authors"),
        title: get("title"),
        venue: get("venue"),
        listNumber: get("listNumber"),
        category: get("category"),
        volume: get("volume"),
        pagesStart: pagesRow ? val(COLUMNS.pagesStart, pagesRow) : empty0,
        pagesEnd: pagesRow ? val(COLUMNS.pagesEnd, pagesRow) : empty0,
        doi: get("doi"),
        year: dateRow ? val(COLUMNS.dateYear, dateRow) : empty0,
        month: dateRow ? val(COLUMNS.dateMonth, dateRow) : empty0,
        status: get("status"),
        acceptedDate: statusRow ? val(COLUMNS.acceptedDate, statusRow) : empty0,
      };
      const valueCells = Object.values(cells);
      out.records.push({
        ordinal: out.records.length + 1,
        sheet: sheet.name,
        label: text(at(COLUMNS.recordLabel, start)).trim(),
        startRow: start,
        endRow: end,
        cells,
        issues,
        empty: valueCells.every((c) => c.text.trim() === "" && !c.date),
      });
    });
  }
  if (out.records.length === 0) {
    out.issues.push({
      level: "error",
      code: "unrecognised-layout",
      message: "No publication blocks were found: no visible sheet has a row labelled 著者 (authors) in column B. This importer reads the achievements-form layout only.",
    });
  }
  return out;
}
