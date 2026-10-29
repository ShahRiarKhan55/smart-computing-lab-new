/**
 * Unit checks for the publication-list import (src/lib/publicationImport): the .xlsx reader, the achievements-form parser and header
 * (label) detection, the mapping of every supported source column, preservation of author order and bibliographic details, missing and
 * malformed values, published / accepted / submitted handling, the duplicate classification, the report, and the documentation of the mapping.
 * The 23 fixture records are the real list's raw cell values (scripts/fixtures/publication-list-records.json); expected values below are written
 * from reading the spreadsheet, not copied from the importer's output. No server, no database, no network.   npm run test:unit -w apps/server
 *
 * Set PUBLICATIONS_XLSX=/path/to/the/real.xlsx to also check that the real file parses to exactly the fixture (not done in CI: the file is not in the repository).
 */
import fs from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanAuthors, cleanLine, crossRecordWarnings, FIELD_MAP, mapRecord, parseAcceptanceDate, parseFormSheets, planImport, readWorkbook, XlsxError, buildMarkdownReport, buildJsonReport, excelSerialToIso, type Candidate, type ExistingPublication } from "../src/lib/publicationImport/index.ts";
import { buildXlsx, formWorkbook, loadFixtureRecords } from "./lib/xlsxFixture.ts";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean, detail = "") => (cond ? ok++ : failures.push(name + (detail ? ` -- ${detail}` : "")));
const here = path.dirname(fileURLToPath(import.meta.url));

const file = loadFixtureRecords();
const records = file.records;
const workbook = formWorkbook(file);
const parsed = parseFormSheets(readWorkbook(workbook).sheets);
const candidates = parsed.records.map((r) => mapRecord(r));
crossRecordWarnings(candidates);
const c = (n: number): Candidate => candidates[n - 1];

// ---- the reader ---------------------------------------------------------------------------------------------------------------
{
  const wb = readWorkbook(buildXlsx({ sheets: [{ name: "S", cells: { A1: "plain", B1: 42, C1: 3.5, D1: true, E1: { date: "2026-07-29" }, F1: "a & b < c \"q\"", G1: "line1\r\nline2" } }] }));
  const cell = (ref: string) => wb.sheets[0].cells.get(ref);
  t("reader: a shared string", cell("A1")?.value === "plain");
  t("reader: integers and decimals", cell("B1")?.value === 42 && cell("C1")?.value === 3.5);
  t("reader: a boolean", cell("D1")?.value === true);
  t("reader: a date-formatted number reads as an ISO date (not a serial)", cell("E1")?.date === "2026-07-29" && typeof cell("E1")?.value === "number");
  t("reader: XML entities are decoded", cell("F1")?.value === 'a & b < c "q"');
  t("reader: CRLF reads as LF (XML end-of-line rule)", cell("G1")?.value === "line1\nline2");
  t("reader: a non-date number is not a date", cell("B1")?.date === undefined);
  const inline = readWorkbook(buildXlsx({ inlineStrings: true, sheets: [{ name: "S", cells: { A1: "inline text", B1: "x" } }] }));
  t("reader: inline strings", inline.sheets[0].cells.get("A1")?.value === "inline text");
  const stored = readWorkbook(buildXlsx({ stored: true, sheets: [{ name: "S", cells: { A1: "stored entry" } }] }));
  t("reader: stored (uncompressed) zip entries", stored.sheets[0].cells.get("A1")?.value === "stored entry");
  const phonetic = readWorkbook(buildXlsx({ phonetic: true, sheets: [{ name: "S", cells: { A1: "漢字" } }] }));
  t("reader: Japanese phonetic guides (furigana) are not part of the text", phonetic.sheets[0].cells.get("A1")?.value === "漢字");
  const multi = readWorkbook(buildXlsx({ sheets: [{ name: "One", cells: { A1: "a" } }, { name: "Hidden", state: "hidden", cells: { A1: "b" } }] }));
  t("reader: sheet names and visibility", multi.sheets.map((s) => `${s.name}:${s.state}`).join() === "One:visible,Hidden:hidden");
  t("reader: maxRow", readWorkbook(buildXlsx({ sheets: [{ name: "S", cells: { A9: "x", B3: "y" } }] })).sheets[0].maxRow === 9);
  let threw = "";
  try { readWorkbook(Buffer.from("this is not a zip file at all")); } catch (e) { threw = e instanceof XlsxError ? "XlsxError" : String(e); }
  t("reader: a file that is not an .xlsx is refused with a clear error", threw === "XlsxError");
  threw = "";
  try { readWorkbook(Buffer.alloc(26 * 1024 * 1024)); } catch (e) { threw = e instanceof XlsxError ? "XlsxError" : String(e); }
  t("reader: an oversized file is refused", threw === "XlsxError");
  t("reader: Excel serial dates (1900 system)", excelSerialToIso(46232, false) === "2026-07-29" && excelSerialToIso(1, false) === "1899-12-31" && excelSerialToIso(0, false) === null);
  t("reader: the 1904 date system", excelSerialToIso(1, true) === "1904-01-02");
}

// ---- header (label) detection and structure ------------------------------------------------------------------------------------
{
  t("parse: 23 publication blocks are found", parsed.records.length === 23);
  t("parse: the list owner is read (and is only reported)", parsed.owner === "MIAN RIAZ UL HAQUE");
  t("parse: ordinals follow the order in the sheet", parsed.records.every((r, i) => r.ordinal === i + 1));
  t("parse: no blank template blocks and no sheet-level issue", parsed.records.every((r) => !r.empty) && parsed.issues.length === 0);
  t("parse: block labels are kept as written (including the garbled one)", parsed.records[0].label === "査読付き学術論文①" && parsed.records[19].label === "著書（総説）又は査読付き学術論文-20+B188:B207");
  const spaced = parseFormSheets(readWorkbook(formWorkbook(file, { gap: 3, startRow: 20 })).sheets);
  t("header detection: blank rows between blocks and a different start row change nothing", spaced.records.length === 23 && spaced.records.every((r, i) => r.cells.title.text === parsed.records[i].cells.title.text));
  const none = parseFormSheets(readWorkbook(buildXlsx({ sheets: [{ name: "S", cells: { A1: "Title", B1: "Authors", A2: "x", B2: "y" } }] })).sheets);
  t("header detection: a sheet in another layout is reported as unrecognised, never guessed", none.records.length === 0 && none.issues[0]?.code === "unrecognised-layout" && none.issues[0].level === "error");
  const hidden = parseFormSheets(readWorkbook(buildXlsx({ sheets: [{ name: "H", state: "hidden", cells: { B7: "著者", C7: "A. Author", B8: "題目", C8: "T" } }] })).sheets);
  t("header detection: a hidden sheet is not read (and says so)", hidden.records.length === 0 && /hidden/.test(hidden.sheets[0].skipped ?? ""));
  const blank = parseFormSheets(readWorkbook(buildXlsx({ sheets: [{ name: "S", cells: { A7: "査読付き学術論文①", B7: "著者", B8: "題目", B9: "雑誌名" } }] })).sheets);
  t("parse: a block with no value at all is a blank template, not a publication", blank.records.length === 1 && blank.records[0].empty);
  const missing = parseFormSheets(readWorkbook(buildXlsx({ sheets: [{ name: "S", cells: { B7: "著者", C7: "A", B8: "題目", C8: "T", B9: "雑誌名", C9: "V" } }] })).sheets);
  t("parse: absent label rows are reported as warnings and the field reads as not stated", missing.records[0].issues.filter((i) => i.code === "missing-label").length === 7 && missing.records[0].cells.doi.text === "");
  const shifted = parseFormSheets(readWorkbook(buildXlsx({ sheets: [{ name: "S", cells: { B7: "著者", C7: "A", B8: "題目", C8: "T", B9: "雑誌名", C9: "V", B13: "ページ", C13: "Start", D13: 5, E13: "End", F13: 9 } }] })).sheets);
  t("parse: a filled page cell under a wrong sub-label is reported as layout drift", shifted.records[0].issues.some((i) => i.code === "layout-drift"));
  // parity with the real file, when it is available
  if (process.env.PUBLICATIONS_XLSX) {
    const real = parseFormSheets(readWorkbook(fs.readFileSync(process.env.PUBLICATIONS_XLSX)).sheets);
    const same = real.records.length === records.length && real.records.every((r, i) => r.cells.title.text.replace(/\s+/g, " ") === String(records[i].title).replace(/\s+/g, " ") && r.cells.doi.text === (records[i].doi ?? ""));
    t("the real file parses to exactly the fixture's records", same);
  }
}

// ---- cleaning helpers ----------------------------------------------------------------------------------------------------------
t("cleanAuthors: spacing around commas, order untouched", cleanAuthors("Riaz-ul-haque Mian 1,Michihiro ShintanI , and Michiko Inoue") === "Riaz-ul-haque Mian 1, Michihiro ShintanI, and Michiko Inoue");
t("cleanAuthors: a trailing comma goes, names stay", cleanAuthors("A One, B Two,") === "A One, B Two");
t("cleanAuthors: repeated spaces and line breaks", cleanAuthors("A  One,\n B   Two") === "A One, B Two");
t("cleanLine: line breaks and a trailing comma", cleanLine("World（MDPI) \nDICTA 2024,") === "World（MDPI) DICTA 2024");
const D = (text: string, date?: string) => parseAcceptanceDate({ ref: "H1", text, ...(date ? { date } : {}) });
t("acceptance date: a date cell", D("46232", "2026-07-29").iso === "2026-07-29");
t("acceptance date: Japanese text with stray spaces", D("2025年　04月　13日").iso === "2025-04-13" && D("2025年04　月04　日").iso === "2025-04-04");
t("acceptance date: ISO text with a time", D("2026-07-29 00:00:00").iso === "2026-07-29");
t("acceptance date: d-Mon-yy (two-digit year is flagged)", D("15-Jul-26").iso === "2026-07-15" && "note" in D("15-Jul-26"));
t("acceptance date: the unfilled form placeholder means none", D("年　月　日").iso === "" && !("unreadable" in D("年　月　日")));
t("acceptance date: empty means none", D("").iso === "");
t("acceptance date: garbage is unreadable, not guessed", D("sometime in spring").iso === "" && "unreadable" in D("sometime in spring"));
t("acceptance date: an impossible date is unreadable", D("2025-02-30").iso === "" && "unreadable" in D("2025-02-30"));

// ---- mapping of every supported source column ------------------------------------------------------------------------------------
{
  const a = c(1).fields;
  t("map #1: title, authors (original order, source typo kept), venue", a.title === "Efficient Wafer-level Spatial Variation Modeling for Multi-site RF IC Testing" && a.authors === "Riaza-ul-haque MIAN, Tomoki NAKAMURA, Masuo KAJIYAMA, Makoto EIKI, and Michihiro SHINTANI" && a.venue === "IEICE Transactions on Fundamentals of Electronics, Communications and Computer Sciences");
  t("map #1: ISSN, category, volume", a.issn === "1745-1337" && a.isbn === "" && a.category === "REGULAR PAPER 2023EAP1115" && a.volume === "E-107 A");
  t("map #1: pages, DOI, year, month", a.pageStart === "1139" && a.pageEnd === "1150" && a.doiUrl === "https://doi.org/10.1587/transfun.2023EAP1115" && a.year === 2023 && a.pubMonth === 11);
  t("map #1: status published, no acceptance date, no warnings", a.status === "PUBLISHED" && a.acceptedDate === "" && c(1).warnings.length === 0 && c(1).errors.length === 0);
  t("map #2: the journal-name cell holds an ISSN: kept, flagged", c(2).fields.venue === "2073-431X" && c(2).warnings.some((w) => w.code === "venue-is-issn") && c(2).fields.issn === "2073-431X");
  t("map #2: author affiliation marker and spelling kept", c(2).fields.authors === "Riaz-ul-haque Mian 1, Michihiro ShintanI, and Michiko Inoue");
  t("map #3: a conference with no volume", c(3).fields.volume === "" && c(3).fields.venue === "2021 IEEE International Test Conference (ITC)" && c(3).fields.pubMonth === 2);
  t("map #4/#5: ISSN and ISBN classified by pattern", c(4).fields.issn === "2164-1706" && c(5).fields.isbn === "978-1-5386-8241-8" && c(5).fields.issn === "");
  t("map #6: a technical report: category, volume, no DOI; the unclassifiable list number is reported, not stored", c(6).fields.category === "Technical Report" && c(6).fields.volume === "121" && c(6).fields.doiUrl === "" && c(6).fields.issn === "" && c(6).fields.isbn === "" && c(6).unresolved.some((u) => u.field === "issn / isbn" && u.value === "277"));
  t("map #7: the volume cell holds the paper category with the category cell empty: moved, reported", c(7).fields.category === "REGULAR PAPER" && c(7).fields.volume === "" && c(7).normalizations.some((n) => /category \/ volume/.test(n)));
  t("map #8: no year anywhere: blocked, with the venue-year hint but NOT applied", c(8).errors.some((e) => e.code === "no-year" && /Hint only, not applied/.test(e.message) && /2017/.test(e.message)) && c(8).fields.year === null);
  t("map #9: status under submission is not published; acceptance date from Japanese text", c(9).fields.status === "SUBMITTED" && c(9).fields.acceptedDate === "2025-04-13" && c(9).fields.year === 2025 && c(9).fields.pubMonth === 2);
  t("map #9: the contradictions are warned about, not resolved", c(9).warnings.some((w) => w.code === "status-vs-acceptance") && c(9).warnings.some((w) => w.code === "submitted-with-doi"));
  t("map #9: volume and issue text and category with manuscript number kept verbatim", c(9).fields.volume === "Volume 41, Number 3" && c(9).fields.category === "REGULAR PAPER JETT-D-25-00014R3");
  t("map #10: a status note in the title is kept and flagged; no year: blocked", c(10).fields.title.endsWith("(Accepted)") && c(10).warnings.some((w) => w.code === "title-status-note") && c(10).errors.some((e) => e.code === "no-year"));
  t("map #11: a month of 2025 is invalid: left as not stated and reported; no DOI; pages kept", c(11).fields.pubMonth === 0 && c(11).fields.year === 2025 && c(11).unresolved.some((u) => u.field === "pubMonth" && u.value === "2025") && c(11).fields.pageStart === "358");
  t("map #12: submitted with a DOI; the unfilled acceptance placeholder is ignored", c(12).fields.status === "SUBMITTED" && c(12).fields.acceptedDate === "" && c(12).fields.pubMonth === 4);
  t("map #13: no issue year, an acceptance date: the year comes from it and is reported; status stays as written", c(13).fields.year === 2025 && c(13).fields.acceptedDate === "2025-04-04" && c(13).fields.status === "SUBMITTED" && c(13).normalizations.some((n) => /year: no publication year is stated/.test(n)));
  t("map #13: the multi-line title is joined", c(13).fields.title === "Optimizing FPGA and Wafer Test Coverage with Spatial Sampling and Machine Learning Classification (Accepted for Presentatin)");
  t("map #14: an empty status stays 'not stated' (never assumed published); ISBN; two-line venue joined", c(14).fields.status === "" && c(14).fields.isbn === "979-8-3503-7903-7" && c(14).fields.venue === "Digital Image Computing: Techniques & Applications DICTA 2024" && c(14).warnings.some((w) => w.code === "status-not-stated"));
  t("map #15: trailing comma on the venue removed; volume(issue) kept", c(15).fields.venue === "ACM Transactions on Design Automation of Electronic Systems" && c(15).fields.volume === "31(4)" && c(15).fields.status === "");
  t("map #16: trailing comma on the authors removed; no dates at all: blocked", c(16).fields.authors === "Farah Afifah Binti Mohd Nawayai, Syed Mohammed Shamsul Islam, Riaz-ul-Haque Mian" && c(16).errors.some((e) => e.code === "no-year"));
  for (const [n, date] of [[17, "2026-07-29"], [18, "2026-07-15"], [19, "2026-07-15"]] as const) {
    t(`map #${n}: accepted, acceptance date from a date cell, NOT treated as published`, c(n).fields.status === "ACCEPTED" && c(n).fields.acceptedDate === date && c(n).fields.pubMonth === 0 && c(n).fields.year === Number(date.slice(0, 4)));
  }
  t("map #20: a bare DOI becomes a DOI link (reported); volume with article number kept", c(20).fields.doiUrl === "https://doi.org/10.3390/world7020021" && c(20).fields.volume === "7(2), 21" && c(20).normalizations.some((n) => /bare DOI/.test(n)) && c(20).fields.pubMonth === 1);
  t("map #21/#22: Signals papers", c(21).fields.volume === "7(3), 53" && c(21).fields.pageEnd === "27" && c(21).fields.pubMonth === 6 && c(22).fields.volume === "7(4), 75" && c(22).fields.pubMonth === 8);
  t("map #23: accepted with a d-Mon-yy date: read, flagged; year and month as stated", c(23).fields.status === "ACCEPTED" && c(23).fields.acceptedDate === "2026-07-15" && c(23).warnings.some((w) => w.code === "two-digit-year") && c(23).fields.year === 2026 && c(23).fields.pubMonth === 8 && c(23).fields.doiUrl === "");
  t("map: exactly the three records without any usable year are blocked", candidates.filter((x) => x.errors.length > 0).map((x) => x.ordinal).join() === "8,10,16");
  t("map: 20 of the 23 records are importable", candidates.filter((x) => x.errors.length === 0).length === 20);
  t("map: no record is labelled PUBLISHED unless the source says 出版", candidates.every((x, i) => (x.fields.status === "PUBLISHED") === (records[i].status === "出版")));
  t("map: statuses are exactly 出版/受理/投稿中 translated, or empty", candidates.every((x, i) => ({ 出版: "PUBLISHED", 受理: "ACCEPTED", 投稿中: "SUBMITTED", "": "" } as Record<string, string>)[records[i].status ?? ""] === x.fields.status));
  t("map: records stating an identical page range are cross-flagged (a copy-and-paste slip in the form)", [12, 14, 22, 23].every((n) => c(n).warnings.some((w) => w.code === "same-pages-as-other-record")) && !c(1).warnings.some((w) => w.code === "same-pages-as-other-record"));
}

// ---- nothing is silently dropped ----------------------------------------------------------------------------------------------------
{
  let unaccounted = 0;
  const detail: string[] = [];
  for (const raw of parsed.records) {
    const cand = candidates[raw.ordinal - 1];
    const dest = (ref: string) => Object.entries(cand.sources).filter(([, refs]) => refs.split(", ").includes(ref)).map(([k]) => k);
    for (const cell of Object.values(raw.cells)) {
      if (cell.text.trim() === "" && !cell.date) continue;
      if (/^年\s*月\s*日$/.test(cell.text.replace(/\s|　/g, ""))) continue; // the form's blank placeholder
      const stored = dest(cell.ref).some((d) => {
        if (d === "issn / isbn") return cand.fields.issn !== "" || cand.fields.isbn !== "";
        const value = (cand.fields as unknown as Record<string, unknown>)[d];
        return value !== "" && value !== 0 && value !== null && value !== undefined;
      });
      const reported = cand.unresolved.some((u) => u.cell === cell.ref) || cand.errors.some((e) => e.cell === cell.ref);
      if (!stored && !reported) {
        unaccounted++;
        detail.push(`record ${raw.ordinal} ${cell.ref} "${cell.text.slice(0, 30)}"`);
      }
    }
  }
  t("completeness: every non-empty source cell is stored in a field or reported as unresolved", unaccounted === 0, detail.join("; "));
  const cellCount = parsed.records.reduce((n, r) => n + Object.values(r.cells).filter((x) => x.text.trim() !== "" || x.date).length, 0);
  t("completeness: the value-cell count equals the fixture's 227 non-empty cells", cellCount === 227, String(cellCount));
}

// ---- overrides (human decisions) -----------------------------------------------------------------------------------------------------
{
  const raw8 = parsed.records[7];
  const fixed = mapRecord(raw8, { records: { "8": { expectTitle: "Design of low power", year: 2017 } } });
  t("override: a person-supplied year unblocks the record and is reported", fixed.errors.length === 0 && fixed.fields.year === 2017 && fixed.overridden.includes("year"));
  const wrong = mapRecord(raw8, { records: { "8": { expectTitle: "Some other paper", year: 2017 } } });
  t("override: it is refused when the title assertion does not match (it can never land on the wrong record)", wrong.errors.some((e) => e.code === "override-mismatch") && wrong.fields.year === null);
  const bad = mapRecord(raw8, { records: { "8": { expectTitle: "Design", year: 3000 } } });
  t("override: a supplied value is validated by the same rules as the API", bad.errors.length > 0);
  const noAssert = mapRecord(raw8, { records: { "8": { year: 2017 } } });
  t("override: an override without expectTitle is refused", noAssert.errors.some((e) => e.code === "override-mismatch"));
}

// ---- classification against what is already stored ------------------------------------------------------------------------------------
{
  const existing = (o: Partial<ExistingPublication> & { id: string; title: string; year: number }): ExistingPublication => ({ authors: "", venue: "", doiUrl: "", status: "", pubMonth: 0, volume: "", pageStart: "", pageEnd: "", issn: "", isbn: "", category: "", acceptedDate: "", ...o });
  const cand = (n: number) => candidates[n - 1];
  const f1 = cand(1).fields;
  const same = existing({ id: "e1", title: f1.title, year: 2023, venue: f1.venue, authors: f1.authors, doiUrl: "http://dx.doi.org/10.1587/TRANSFUN.2023EAP1115" });
  const plan1 = planImport(candidates, [same]);
  const d = (n: number) => plan1.entries[n - 1];
  t("plan: an identical record under another DOI URL form is an existing match (nothing to do)", d(1).disposition === "existing-match" && d(1).matches[0].id === "e1");
  t("plan: records matching nothing are new", d(2).disposition === "new" && d(3).disposition === "new");
  t("plan: blocked records are invalid", [8, 10, 16].every((n) => d(n).disposition === "invalid"));
  t("plan: counts add up to the number of records", plan1.counts.total === 23 && plan1.counts.new + plan1.counts["existing-match"] + plan1.counts.conflict + plan1.counts["possible-match"] + plan1.counts["duplicate-in-source"] + plan1.counts.invalid === 23);

  const yearDiffers = planImport(candidates, [existing({ id: "e7", title: cand(7).fields.title, year: 2025, venue: cand(7).fields.venue, authors: cand(7).fields.authors, doiUrl: cand(7).fields.doiUrl })]).entries[6];
  t("plan: same DOI but a different year is a conflict that cannot be confirmed as distinct (nothing overwritten)", yearDiffers.disposition === "conflict" && yearDiffers.diffs.some((x) => x.field === "year" && x.existing === "2025" && x.incoming === "2026") && !yearDiffers.confirmable);
  const venueDiffers = planImport(candidates, [existing({ id: "e21", title: cand(21).fields.title, year: 2026, venue: "MDPI Signals", authors: cand(21).fields.authors, doiUrl: cand(21).fields.doiUrl })]).entries[20];
  t("plan: same DOI with a differently written venue is a conflict listing exactly that field", venueDiffers.disposition === "conflict" && venueDiffers.diffs.map((x) => x.field).join() === "venue");

  const noDoiTitleYear = planImport(candidates, [existing({ id: "e6", title: cand(6).fields.title.toUpperCase(), year: 2021, venue: "Another venue", authors: cand(6).fields.authors })]).entries[5];
  t("plan: no DOI, same normalised title + year, other venue: a conflict a human may confirm as distinct", noDoiTitleYear.disposition === "conflict" && noDoiTitleYear.confirmable && noDoiTitleYear.matches[0].via === "title-year");
  const noDoiSame = planImport(candidates, [existing({ id: "e6", title: cand(6).fields.title, year: 2021, venue: cand(6).fields.venue, authors: cand(6).fields.authors })]).entries[5];
  t("plan: no DOI, identical record already stored (a previous import): existing match, so a re-run creates nothing", noDoiSame.disposition === "existing-match");

  // the audit's distinct pair: the conference/preprint version and the journal version are different publications
  const preprint = existing({ id: "pre", title: "Optimizing FPGA and wafer test coverage with spatial sampling and machine learning", year: 2025, venue: "ICECET", authors: "Wang WeiQuan", doiUrl: "https://doi.org/10.48550/arXiv.2506.03556" });
  const planPair = planImport(candidates, [preprint]);
  t("plan: the journal version (other DOI, other year, longer title) is NOT matched with the earlier preprint", planPair.entries[20].disposition === "new");
  t("plan: the conference paper without a DOI whose title contains the preprint's is only a POSSIBLE match, left to a human", planPair.entries[12].disposition === "possible-match" && planPair.entries[12].confirmable && planPair.entries[12].matches[0].via === "contained-title");
  const distinctDois = planImport([cand(21)], [existing({ id: "x", title: cand(21).fields.title, year: 2026, venue: "Signals", authors: "x", doiUrl: "https://doi.org/10.3390/signals7040075" })]);
  t("plan: the same title and year but DIFFERENT DOIs are distinct publications", distinctDois.entries[0].disposition === "new");

  // duplicates inside the file
  const dup: Candidate = { ...cand(1), ordinal: 99, label: "copy" };
  const withDup = planImport([cand(1), dup, cand(2)], []);
  t("plan: a second record with the same DOI in the same file is a duplicate-in-source (the first stands)", withDup.entries[1].disposition === "duplicate-in-source" && withDup.entries[0].disposition === "new");
  const dupNoDoi = planImport([cand(6), { ...cand(6), ordinal: 98 }], []);
  t("plan: the same title and year without a DOI, twice in a file, is a duplicate-in-source", dupNoDoi.entries[1].disposition === "duplicate-in-source");

  // the report
  const summary = { file: "publicationslist.xlsx", target: "file:/tmp/x.db", mode: "dry-run" as const, owner: parsed.owner, sheets: parsed.sheets, sourceRecords: 23, emptyBlocks: 0, counts: plan1.counts };
  const md = buildMarkdownReport(summary, plan1);
  const js = buildJsonReport(summary, plan1);
  t("report: lists every record and the field mapping", md.includes("| 23 |") && md.includes("Source field mapping") && js.records.length === 23);
  t("report: blocked records come with an overrides template that has no value filled in", md.includes("FILL IN AFTER CHECKING THE SOURCE") && md.includes("Design of low power"));
  t("report: it never contains a credential-looking value", !/(token|password|secret)\s*[:=]/i.test(md) && !/libsql:\/\//.test(md));
  t("report: JSON carries the dispositions", js.records[0].disposition === "existing-match" && js.records.filter((r) => r.disposition === "invalid").length === 3);
}

// ---- the documented mapping covers every destination ---------------------------------------------------------------------------------------
{
  const doc = readFileSync(path.resolve(here, "..", "..", "..", "docs", "architecture", "publication-list-import.md"), "utf8");
  const destinations = ["authors", "title", "venue", "issn", "isbn", "category", "volume", "pageStart", "pageEnd", "doiUrl", "year", "pubMonth", "status", "acceptedDate"];
  t("docs: every destination field of the mapping is documented", destinations.every((d) => doc.includes(`\`${d}\``) || doc.includes(`Publication.${d}`)));
  t("docs: FIELD_MAP and the documentation name the same destinations", FIELD_MAP.filter((m) => m.destination.startsWith("Publication.")).every((m) => m.destination.split(" or ").every((x) => doc.includes(x.replace("Publication.", "")))));
}

console.log(`${ok} publication-import unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
