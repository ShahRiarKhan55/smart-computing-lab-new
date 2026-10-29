import {
  MAX_PUBLICATION_YEAR,
  MIN_PUBLICATION_YEAR,
  canonicalDoi,
  createPublicationSchema,
  isIsbn,
  isIsoDate,
  isIssn,
  type PublicationStatusOrNone,
} from "@scl/shared";
import type { RawCell, RawRecord, SheetIssue } from "./sheet.js";

/**
 * Raw spreadsheet cells -> validated publication fields, with a complete account of what was done.
 *
 * Principles (the same as the import brief):
 *  - NOTHING is invented. A missing value stays missing ("" / 0). A status is only what the source says; an accepted paper is never
 *    treated as published; a year is only the stated publication year, or (for a record that states none) the year of a stated
 *    acceptance date, which is reported as a normalisation.
 *  - NOTHING is silently dropped. A value that cannot be stored is listed in `unresolved` with its cell; a doubtful value is a warning.
 *  - Titles, venues and identifiers are kept as written. Only typography is normalised (whitespace, spaces around commas, a trailing comma).
 */

export interface MappedFields {
  title: string;
  authors: string;
  venue: string;
  year: number | null;
  pubMonth: number;
  doiUrl: string;
  status: PublicationStatusOrNone;
  volume: string;
  pageStart: string;
  pageEnd: string;
  issn: string;
  isbn: string;
  category: string;
  acceptedDate: string;
}

export interface Unresolved {
  field: string;
  cell: string;
  value: string;
  reason: string;
}

export interface Candidate {
  ordinal: number;
  label: string;
  sheet: string;
  rows: string;
  fields: MappedFields;
  /** Destination field -> the source cell(s) it was read from. */
  sources: Record<string, string>;
  /** Typographic or documented normalisations applied to this record. */
  normalizations: string[];
  warnings: SheetIssue[];
  errors: SheetIssue[];
  unresolved: Unresolved[];
  /** Fields a human supplied through the overrides file (for the report). */
  overridden: string[];
}

export const STATUS_BY_SOURCE: Record<string, PublicationStatusOrNone> = {
  出版: "PUBLISHED",
  受理: "ACCEPTED",
  投稿中: "SUBMITTED",
  published: "PUBLISHED",
  accepted: "ACCEPTED",
  submitted: "SUBMITTED",
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Authors: whitespace collapsed, no space before a comma, one space after it, no trailing comma. Names, spelling and ORDER are untouched. */
export function cleanAuthors(s: string): string {
  return oneLine(s).replace(/\s+,/g, ",").replace(/,(?=\S)/g, ", ").replace(/[,\s]+$/, "");
}

/** A venue/title: whitespace collapsed; a trailing comma or semicolon (a stray list separator) removed. */
export function cleanLine(s: string): string {
  return oneLine(s).replace(/[,;\s]+$/, "");
}

/** The acceptance date a cell states, as ISO, or why it cannot be read. "年 月 日" (the unfilled form placeholder) is "no date". */
export function parseAcceptanceDate(cell: RawCell): { iso: string; note?: string } | { iso: ""; unreadable?: true } {
  if (cell.date) return { iso: cell.date };
  const raw = cell.text.trim();
  if (raw === "") return { iso: "" };
  if (/^年\s*月\s*日$/.test(raw.replace(/\s|　/g, ""))) return { iso: "" }; // the template's blank "YYYY年 MM月 DD日"
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.exec(raw);
  if (m && isIsoDate(`${m[1]}-${m[2]}-${m[3]}`)) return { iso: `${m[1]}-${m[2]}-${m[3]}` };
  m = /(\d{4})\D{1,4}(\d{1,2})\D{1,4}(\d{1,2})/.exec(raw);
  if (m) {
    const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    if (isIsoDate(iso)) return { iso };
  }
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2}|\d{4})$/.exec(raw);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const twoDigit = m[3].length === 2;
    const iso = `${twoDigit ? 2000 + Number(m[3]) : Number(m[3])}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (isIsoDate(iso)) return { iso, ...(twoDigit ? { note: `two-digit year "${m[3]}" read as ${2000 + Number(m[3])}` } : {}) };
  }
  return { iso: "", unreadable: true };
}

function wholeNumber(cell: RawCell): number | null {
  const t = cell.text.trim();
  return /^\d{1,4}$/.test(t) ? Number(t) : null;
}

export interface Overrides {
  /** Keyed by the record's ordinal (as a string). `expectTitle` must be a prefix of the record's title, so an override can never land on the wrong record. */
  records?: Record<string, { expectTitle?: string } & Partial<Record<keyof MappedFields, unknown>>>;
  /** Ordinals a human confirms are DISTINCT from the existing record they resemble (applied only where the duplicate rules allow an override). */
  confirmDistinct?: string[];
}

const OVERRIDABLE: ReadonlyArray<keyof MappedFields> = ["title", "authors", "venue", "year", "pubMonth", "doiUrl", "status", "volume", "pageStart", "pageEnd", "issn", "isbn", "category", "acceptedDate"];

export function mapRecord(raw: RawRecord, overrides?: Overrides): Candidate {
  const c = raw.cells;
  const warnings: SheetIssue[] = raw.issues.filter((i) => i.level === "warning");
  const errors: SheetIssue[] = raw.issues.filter((i) => i.level === "error");
  const normalizations: string[] = [];
  const unresolved: Unresolved[] = [];
  const sources: Record<string, string> = {};
  const warn = (code: string, message: string, cell?: string) => warnings.push({ level: "warning", code, message, cell });
  const fail = (code: string, message: string, cell?: string) => errors.push({ level: "error", code, message, cell });
  const note = (n: string) => normalizations.push(n);
  const src = (field: string, ...cells: RawCell[]) => {
    const refs = cells.filter((x) => x.ref).map((x) => x.ref);
    if (refs.length) sources[field] = refs.join(", ");
  };

  // ---- text fields -------------------------------------------------------------------------------------------------------
  const title = cleanLine(c.title.text);
  if (title !== c.title.text.trim()) note(`title: line breaks / repeated spaces collapsed (${c.title.ref})`);
  src("title", c.title);
  const authors = cleanAuthors(c.authors.text);
  if (authors !== c.authors.text.trim()) note(`authors: spacing around commas normalised, order and names unchanged (${c.authors.ref})`);
  src("authors", c.authors);
  const venue = cleanLine(c.venue.text);
  if (venue !== c.venue.text.trim()) note(`venue: line breaks / repeated spaces / trailing comma normalised (${c.venue.ref})`);
  src("venue", c.venue);
  if (!title) fail("missing-title", "The title (題目) is empty.", c.title.ref);
  if (!authors) fail("missing-authors", "The author list (著者) is empty.", c.authors.ref);
  if (!venue) fail("missing-venue", "The journal / conference name (雑誌名) is empty.", c.venue.ref);
  if (venue && isIssn(venue)) warn("venue-is-issn", `The journal name cell holds an ISSN ("${venue}"), not a name. Imported as written; correct it in the source or on the site.`, c.venue.ref);
  if (/\((accepted|submitted|in press|under review)[^)]*\)\s*$/i.test(title)) warn("title-status-note", "The title ends with a status note in brackets. Kept as written.", c.title.ref);

  // ---- identifiers -------------------------------------------------------------------------------------------------------
  let doiUrl = "";
  const doiRaw = oneLine(c.doi.text);
  src("doiUrl", c.doi);
  if (doiRaw) {
    if (/^https?:\/\//i.test(doiRaw) && canonicalDoi(doiRaw)) doiUrl = doiRaw;
    else if (/^10\.\d{4,9}\/\S+$/.test(doiRaw)) {
      doiUrl = `https://doi.org/${doiRaw}`;
      note(`doiUrl: bare DOI "${doiRaw}" written as the URL https://doi.org/${doiRaw} (${c.doi.ref})`);
    } else {
      unresolved.push({ field: "doiUrl", cell: c.doi.ref, value: doiRaw, reason: "not a DOI or a DOI link" });
      warn("invalid-doi", `The DOI cell "${doiRaw}" is not a DOI or a DOI link; not stored.`, c.doi.ref);
    }
  }

  let issn = "";
  let isbn = "";
  const list = oneLine(c.listNumber.text);
  src("issn / isbn", c.listNumber);
  if (list) {
    if (isIssn(list)) issn = list;
    else if (isIsbn(list)) isbn = list;
    else {
      unresolved.push({ field: "issn / isbn", cell: c.listNumber.ref, value: list, reason: "the 雑誌リスト番号 value is neither an ISSN nor an ISBN" });
      warn("unclassified-list-number", `The journal list number "${list}" is neither an ISSN nor an ISBN, so it has no field; not stored.`, c.listNumber.ref);
    }
  }

  // ---- category / volume (with the one recognised column slip) -----------------------------------------------------------------
  let category = oneLine(c.category.text);
  let volume = oneLine(c.volume.text);
  src("category", c.category);
  src("volume", c.volume);
  if (!category && /^(REGULAR PAPER|Technical Report)\b/i.test(volume)) {
    category = volume;
    volume = "";
    sources.category = [sources.category, c.volume.ref].filter(Boolean).join(", ");
    note(`category / volume: the volume cell ${c.volume.ref} holds the paper category "${category}" and the category cell is empty; the text was placed in the category field`);
    warn("volume-holds-category", `The volume cell holds "${category}" (a paper category) while the category cell is empty; moved to the category field.`, c.volume.ref);
  }

  // ---- pages -------------------------------------------------------------------------------------------------------------
  const pageStart = oneLine(c.pagesStart.text);
  const pageEnd = oneLine(c.pagesEnd.text);
  src("pageStart", c.pagesStart);
  src("pageEnd", c.pagesEnd);
  if ((pageStart && !pageEnd) || (!pageStart && pageEnd)) warn("partial-pages", "Only one of the start / end page cells is filled; stored as given.", (pageStart ? c.pagesStart : c.pagesEnd).ref);
  if (/^\d+$/.test(pageStart) && /^\d+$/.test(pageEnd) && Number(pageEnd) < Number(pageStart)) warn("pages-reversed", `The end page (${pageEnd}) is before the start page (${pageStart}).`, c.pagesEnd.ref);

  // ---- date --------------------------------------------------------------------------------------------------------------
  src("year", c.year);
  src("pubMonth", c.month);
  let year = wholeNumber(c.year);
  if (c.year.text.trim() && (year === null || year < MIN_PUBLICATION_YEAR || year > MAX_PUBLICATION_YEAR)) {
    warn("invalid-year", `The year cell "${c.year.text.trim()}" is not a year between ${MIN_PUBLICATION_YEAR} and ${MAX_PUBLICATION_YEAR}; ignored.`, c.year.ref);
    unresolved.push({ field: "year", cell: c.year.ref, value: c.year.text.trim(), reason: "not a valid year" });
    year = null;
  }
  let pubMonth = 0;
  const monthN = wholeNumber(c.month);
  if (c.month.text.trim()) {
    if (monthN !== null && monthN >= 1 && monthN <= 12 && year !== null) pubMonth = monthN;
    else {
      warn("invalid-month", `The month cell "${c.month.text.trim()}" is ${year === null ? "given without a year" : "not a month from 1 to 12"}; the month is left as not stated.`, c.month.ref);
      unresolved.push({ field: "pubMonth", cell: c.month.ref, value: c.month.text.trim(), reason: year === null ? "month without a year" : "not a month from 1 to 12" });
    }
  }

  // ---- status and acceptance date ----------------------------------------------------------------------------------------------
  src("status", c.status);
  src("acceptedDate", c.acceptedDate);
  const statusText = oneLine(c.status.text);
  let status: PublicationStatusOrNone = "";
  if (statusText) {
    status = STATUS_BY_SOURCE[statusText] ?? STATUS_BY_SOURCE[statusText.toLowerCase()] ?? "";
    if (!status) {
      warn("unknown-status", `The status "${statusText}" is not one of 出版 (published), 受理 (accepted) or 投稿中 (under submission); left as not stated.`, c.status.ref);
      unresolved.push({ field: "status", cell: c.status.ref, value: statusText, reason: "unrecognised status" });
    }
  }
  let acceptedDate = "";
  const accepted = parseAcceptanceDate(c.acceptedDate);
  if (accepted.iso) {
    acceptedDate = accepted.iso;
    if ("note" in accepted && accepted.note) {
      note(`acceptedDate: ${accepted.note} (${c.acceptedDate.ref})`);
      warn("two-digit-year", `The acceptance date "${c.acceptedDate.text.trim()}" has a two-digit year; read as ${accepted.iso}.`, c.acceptedDate.ref);
    }
  } else if ("unreadable" in accepted && accepted.unreadable) {
    warn("unreadable-date", `The acceptance date "${c.acceptedDate.text.trim()}" could not be read; not stored.`, c.acceptedDate.ref);
    unresolved.push({ field: "acceptedDate", cell: c.acceptedDate.ref, value: c.acceptedDate.text.trim(), reason: "unreadable date" });
  }
  if (status === "SUBMITTED" && acceptedDate) warn("status-vs-acceptance", "The status says the paper is under submission but an acceptance date is given. Both are kept as written.", c.status.ref);
  if (status === "PUBLISHED" && acceptedDate) note(`status: PUBLISHED with a stated acceptance date ${acceptedDate} (both kept)`);
  if (status === "SUBMITTED" && c.doi.text.trim()) warn("submitted-with-doi", "The status says the paper is under submission but a DOI is given. Both are kept as written.", c.status.ref);
  if (!status) warn("status-not-stated", "No publication status is stated for this record; it is shown as 'status not stated'.", c.status.ref);

  // ---- year fallback: the only date the source states --------------------------------------------------------------------------
  let yearSource = "the stated publication year";
  if (year === null && acceptedDate) {
    year = Number(acceptedDate.slice(0, 4));
    yearSource = "the stated acceptance date";
    sources.year = c.acceptedDate.ref;
    note(`year: no publication year is stated; the year of the stated acceptance date (${acceptedDate}, ${c.acceptedDate.ref}) is used for ordering. The status is NOT changed and the paper is not described as published.`);
  }

  let fields: MappedFields = { title, authors, venue, year, pubMonth, doiUrl, status, volume, pageStart, pageEnd, issn, isbn, category, acceptedDate };

  // ---- human overrides (never applied unless the title assertion matches) ------------------------------------------------------------
  const overridden: string[] = [];
  const ov = overrides?.records?.[String(raw.ordinal)];
  if (ov) {
    if (!ov.expectTitle || !title.toLowerCase().startsWith(String(ov.expectTitle).toLowerCase())) {
      fail("override-mismatch", `An override exists for record ${raw.ordinal} but its expectTitle does not match this record's title; nothing was applied.`);
    } else {
      for (const key of OVERRIDABLE) {
        if (key in ov) {
          (fields as unknown as Record<string, unknown>)[key] = ov[key];
          overridden.push(key);
        }
      }
      if (overridden.includes("year")) yearSource = "a human override";
    }
  }

  // ---- final validation: the very same rules the API applies ---------------------------------------------------------------------
  if (fields.year === null) {
    fail("no-year", `No year can be determined: the issue-date year (発行年月) is empty and no acceptance date is stated. Supply one in the overrides file after checking the source.${venueYearHint(venue)}`, c.year.ref);
  } else {
    const parsed = createPublicationSchema.safeParse({ ...fields, year: fields.year });
    if (!parsed.success) for (const issue of parsed.error.issues) fail("invalid-field", `${issue.path.join(".") || "record"}: ${issue.message}`);
  }

  return {
    ordinal: raw.ordinal,
    label: raw.label,
    sheet: raw.sheet,
    rows: `${raw.startRow}-${raw.endRow}`,
    fields,
    sources,
    normalizations,
    warnings,
    errors,
    unresolved,
    overridden,
  };
}

/** A HINT for the person reading the report, never applied: the venue text mentions a year. */
function venueYearHint(venue: string): string {
  const m = /\b(19|20)\d{2}\b/.exec(venue);
  return m ? ` (Hint only, not applied: the venue name mentions ${m[0]}.)` : "";
}

/** Records that state the very same page range (a common copy-and-paste slip in a hand-filled form). */
export function crossRecordWarnings(candidates: Candidate[]): void {
  const byPages = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (c.fields.pageStart && c.fields.pageEnd) {
      const k = `${c.fields.pageStart}-${c.fields.pageEnd}`;
      byPages.set(k, [...(byPages.get(k) ?? []), c]);
    }
  }
  for (const [k, group] of byPages) {
    if (group.length < 2) continue;
    for (const c of group) {
      const others = group.filter((o) => o !== c).map((o) => o.ordinal).join(", ");
      c.warnings.push({ level: "warning", code: "same-pages-as-other-record", message: `The page range ${k} is identical to that of record ${others}; check it was not copied.` });
    }
  }
}
