# Importing the complete publication list

Brings the lab's publication list (`publicationslist.xlsx`, an "achievements form" spreadsheet) onto the website: every record, every
bibliographic detail the sheet states, nothing invented. Code: `apps/server/src/lib/publicationImport/` (reader, parser, mapper, planner,
applier, report), the command `apps/server/scripts/import-publications.ts`, the migration
`20261029120000_publication_bibliographic_fields`, and the public/admin UI changes described at the end.

**There is no import web endpoint.** The import is an operator-run command on a database the operator names; nothing an unauthenticated
visitor can reach can import, modify or delete publications. Publications are still edited through the existing, authenticated admin forms.

## 1. What the spreadsheet is (audited)

| | |
|---|---|
| Worksheets | 1: `Sheet1` (visible, A1:J236, 594 non-empty cells). No hidden sheets. |
| Layout | **Not a table.** A vertical form: each publication is a 10-row block, labelled in column B (`著者` authors, `題目` title, `雑誌名` journal / conference, `雑誌リスト番号` journal list number, `論文カテゴリー` category, `巻` volume, `ページ` pages, `DOI`, `発行年月` issue date, `状況` status), values in C to H. There is no header row. |
| Owner | `氏名` (name): the lab PI. Reported only; never used to link publications to team members or accounts. |
| Publication records | **23** (blocks 1 to 23). 0 blank template blocks. 227 non-empty value cells. |
| Records the website can take as they are | **20**. The other **3** (records 8, 10, 16) state no year at all (no issue date, no acceptance date), so they are blocked until a person supplies one. |

The parser recognises a block by its labels, never by row numbers, so a sheet with more or fewer records, or blank rows between blocks, parses
the same way. A sheet in any other layout is refused with a clear message instead of being guessed at.

## 2. Column to schema mapping

All destinations are on `Publication`. Columns marked *new* were added by the migration in section 6; the rest already existed.

| Source (column B label, cells) | Destination | Notes |
|---|---|---|
| `著者` Authors (C) | `Publication.authors` | Order and names kept as written (including the source's own typos and affiliation markers). Only typography is normalised: whitespace, one space after a comma, none before it, no trailing comma. |
| `題目` Title (C) | `Publication.title` | As written; line breaks become spaces. A bracketed status note such as "(Accepted)" inside a title is kept and flagged. |
| `雑誌名` Journal / conference (C) | `Publication.venue` | As written (trailing comma removed). Required by the schema. A cell that holds an ISSN instead of a name (record 2) is kept and flagged. |
| `雑誌リスト番号` Journal list number (C) | `Publication.issn` or `Publication.isbn` (*new*) | ISSN pattern gives `issn`, ISBN pattern gives `isbn`. Anything else has no field and is reported as unresolved (record 6: `277`). |
| `論文カテゴリー` Category (C) | `Publication.category` (*new*) | Stored as written. It can include a manuscript number (`REGULAR PAPER JETT-D-25-00014R3`). |
| `巻` Volume (C) | `Publication.volume` (*new*) | Stored as written; it can include the issue and article number (`7(3), 53`, `Volume 41, Number 3`). Not split, because the sheet has no separate issue column. |
| `ページ` Pages, `始め` start (D) | `Publication.pageStart` (*new*) | As written. |
| `ページ` Pages, `終り` end (F) | `Publication.pageEnd` (*new*) | As written. |
| `DOI` (C) | `Publication.doiUrl` | A DOI link is kept as written; a bare DOI becomes `https://doi.org/<doi>` (reported). Anything else is unresolved. |
| `発行年月` Issue date, year (D) | `Publication.year` | Required. If the sheet states no year but states an acceptance date, the **year of that date** is used so the record can be ordered, and this is reported; the status is not changed and the website does not present that year as a publication year (see section 7). Otherwise the record is blocked. |
| `発行年月` Issue date, month (F) | `Publication.pubMonth` (*new*) | 1 to 12. Anything else is reported and left as "not stated" (0). |
| `状況` Status (C) | `Publication.status` (*new*) | `出版` gives PUBLISHED, `受理` gives ACCEPTED, `投稿中` gives SUBMITTED (under submission); empty stays "not stated". **Never inferred**: an accepted paper is never published, and a record without a status is not assumed to be published. |
| `受理年月日` Date of acceptance (H) | `Publication.acceptedDate` (*new*) | Date cells, `YYYY年MM月DD日` text and `d-Mon-yy` text are read to an ISO date. The form's unfilled `年 月 日` means none. |
| Record label (A) | none (report key only) | Used for the record's ordinal in reports. Not stored. |
| `氏名` Name (C3) | none | Whose list it is. Not stored. |

After the migration the schema has a place for every KIND of field the sheet states. Two individual VALUES in this file still cannot be stored, because
they are not valid for any field: record 6's journal list number `277` (neither an ISSN nor an ISBN) and record 11's month `2025` (not a month). Such
values are never dropped silently; they are listed per record in the report under "UNRESOLVED".

### Irregularities found in the source (reported by the importer, kept as written unless noted)

| Record | Observation |
|---|---|
| 2 | The journal-name cell holds an ISSN (`2073-431X`), not a name. |
| 6 | The journal list number `277` is neither an ISSN nor an ISBN (not stored). |
| 7 | The volume cell holds `REGULAR PAPER` and the category cell is empty: the text is placed in the category field (reported). Its year (2026) differs from the website's existing record for the same DOI (2025). |
| 8, 10, 16 | No year anywhere: blocked. (Record 8's venue name mentions 2017; this is shown as a hint in the report and is **not** applied.) |
| 9, 12, 13 | Status says "under submission" while a DOI (9, 12) or an acceptance date and the title's "(Accepted for Presentatin)" (13) say otherwise. Kept as written and flagged. |
| 10 | The title ends "(Accepted)" while the status says published; the DOI's volume (1582) differs from the volume cell (1651). |
| 11 | The month cell holds `2025`. Left as "not stated". |
| 12, 14 | Identical page ranges (553 to 567); 22, 23 likewise (1 to 17). Flagged as possible copy and paste. |
| 14, 15, 16 | No status stated. |
| 17, 18, 19, 23 | Accepted, with no issue date. 23's acceptance date is `15-Jul-26` (two-digit year read as 2026, flagged). |
| 20 | The record label is garbled (`...-20+B188:B207`); the venue reads `World（MDPI) DICTA 2024`. |

## 3. Running the import

Dry run is the default and writes **nothing**. The target comes only from `IMPORT_TARGET_URL` (and `IMPORT_TARGET_TOKEN` for a remote
database); `DATABASE_URL`, `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are never read, so an ambient application credential cannot select the
database. `--expect-target` must equal the real target (the file path, or the host) exactly.

```bash
# 1. Dry run against a disposable copy
IMPORT_TARGET_URL=file:/abs/path/copy.db \
  npm run import:publications -w apps/server -- \
  --file /abs/path/publicationslist.xlsx --expect-target file:/abs/path/copy.db --report-dir ./import-report

# 2. Apply to that same, explicitly chosen database
IMPORT_TARGET_URL=file:/abs/path/copy.db \
  npm run import:publications -w apps/server -- \
  --file /abs/path/publicationslist.xlsx --expect-target file:/abs/path/copy.db --apply --report-dir ./import-report
```

Options: `--visibility LAB_ONLY` creates the records visible to signed-in members only, so they can be reviewed before being made public
(default `PUBLIC`); `--fill-empty` (section 5); `--overrides <json>` (section 4); `--allow-remote` is required with `--apply` for a Turso
database. Exit codes: 0 finished, 1 some records failed to write, 2 refused before touching the database, 4 unexpected error.

The tool **only creates** records (and, with `--fill-empty`, fills empty bibliographic fields of an identical record). It never updates a
non-empty field on its own (the one exception is a field a person decided explicitly: section 4a), never deletes, never alters the schema (it refuses `--apply` on a database without the migration), and never links
publications to team members.

## 4. Reviewing the report and resolving conflicts

`report.md` / `report.json` list every record with one disposition:

| Disposition | Meaning | What you do |
|---|---|---|
| `new` | Nothing resembles it. | Nothing; it will be created. |
| `existing-match` | Already stored: identical title, year, venue and authors. | Nothing. (This is why a second run creates nothing.) |
| `conflict` | Matches a stored record by DOI, or by title and year, but differs in a core field. **Nothing is overwritten.** | See below. |
| `possible-match` | No rule fires exactly, but a stored title is contained in this one (for example an "(Accepted)" suffix). | See below. |
| `confirmed-match` | A review decision says this record **is** the stored publication with a given DOI. Never created; nothing stored changes. | Nothing. |
| `update-required` | A review decision prefers the spreadsheet value for named fields. **Reported only**, not applied by a plain `--apply`. | Run the explicit step (section 4a). |
| `duplicate-in-source` | Another record of the same file already stands for it. | Fix the file. |
| `invalid` | Cannot be imported as it stands (listed with the reason). | Supply the missing information. |

The duplicate rules are the application's own (`packages/shared/src/duplicates.ts`; see `duplicate-prevention.md`): an identical canonical DOI
is the same work; distinct DOIs are distinct publications even with the same title (a preprint, a conference paper and its journal extension);
without a DOI on both sides, the same normalised title and year is a likely duplicate. They are re-run inside each write transaction, so a
record added by someone else since the dry run is caught.

* **Conflict by DOI** (cannot be overridden): decide which side is right. If the file is right, correct the stored record in the admin interface
  (the edit form now has every field). If the stored record is right, do nothing.
* **Conflict by title and year, or possible match**: if it really is a *different* publication, list its number in `confirmDistinct`; if it is the
  same publication, do nothing.
* **Blocked record**: supply the missing year (after checking the source) in an overrides file, unless a review decision keeps it blocked (4a). An override must carry `expectTitle`, which has to
  match the start of the record's title, so it can never land on the wrong record:

```json
{
  "records": { "8": { "expectTitle": "Design of low power", "year": 2017 } },
  "confirmDistinct": ["13"]
}
```

Any destination field can be overridden the same way (`title`, `authors`, `venue`, `year`, `pubMonth`, `doiUrl`, `status`, `volume`, `pageStart`,
`pageEnd`, `issn`, `isbn`, `category`, `acceptedDate`); each value goes through the same validation as the API, and each override is listed in the
report. Re-run the dry run, then `--apply`.

## 4a. Review decisions (`--decisions`)

Decisions a person made about records the importer cannot settle live in a reviewed file,
`apps/server/scripts/fixtures/publication-list-review-decisions.json`, and are passed with `--decisions <json>`. The file is strict (unknown
keys or kinds are refused) and every entry names the record number **and** the start of its title, so a decision can never land on the wrong
record; a mismatch blocks the record. Three kinds exist:

| Decision | Effect |
|---|---|
| `same-as-existing` (`existingDoi`) | The record is the stored publication with that DOI: reported as `confirmed-match`, never created, nothing changed. Refused unless exactly one stored publication has that DOI. |
| `prefer-source` (`fields`, each with `expectExisting`) | The spreadsheet value is preferred for those fields. Reported as `update-required` with old and new value. Title and DOI cannot be decided this way. |
| `keep-blocked` (`reason`) | The record stays out of the import and the reason is printed. It wins over an overrides file. |

**Nothing is overwritten automatically.** A dry run and a plain `--apply` only report `update-required`. The change happens only with
`--apply --decisions <file> --apply-decided-updates`, and then per field only if the stored value is still exactly `expectExisting` (compare
and set), through the application's duplicate guard, in one transaction, changing only the decided fields, with a `PUBLICATION_UPDATED` audit row
(`"source":"xlsx-import-decision"`). Author links, translations and earlier audit history are untouched. If the stored value has changed, the
update is skipped and reported; a repeat run finds nothing to do.

Decisions in force for the example list:

| Record | Decision | Result |
|---|---|---|
| 7 | prefer-source: `year` 2026 (stored 2025) | explicit update required; its venue difference stays undecided and is not changed |
| 21 | prefer-source: `venue` "Signals" (stored "MDPI Signals") | explicit update required |
| 13 | same-as-existing: DOI `arXiv.2506.03556` | confirmed match, not created |
| 8, 10, 16 | keep-blocked: publication year unresolved | blocked, not imported |

Against the seeded database this gives 16 new, 1 identical (15), 1 confirmed match (13), 2 explicit updates (7, 21), 3 blocked (8, 10, 16).

```bash
IMPORT_TARGET_URL=file:/abs/path/copy.db npm run import:publications -w apps/server -- \
  --file /abs/path/publicationslist.xlsx --expect-target file:/abs/path/copy.db \
  --decisions apps/server/scripts/fixtures/publication-list-review-decisions.json --apply --apply-decided-updates
```

The explicit flag requires both `--apply` and `--decisions`. It was only ever exercised on disposable databases.

## 5. Verifying counts and completeness

After an apply, with the example file against a database seeded by `npm run seed` (4 existing publications): 23 source records give 16 created, 1
already stored (identical), 2 conflicts, 1 possible match, 3 blocked (without decisions; with the decisions of section 4a see there). A second `--apply` creates nothing and leaves the database file
byte-identical. To check a target yourself:

* publications created by the import carry an audit row `PUBLICATION_CREATED` with `"source":"xlsx-import"` (count them in the admin audit view);
* `SELECT COUNT(*) FROM "Publication"` before and after must differ by exactly the "new" count of the report;
* every non-empty source cell is either stored or listed as UNRESOLVED: `unit-publication-import.test.ts` asserts this for all 227 cells of the real list.

`--fill-empty` is the only way an existing record is touched: for a record that is already stored and identical, it fills the bibliographic fields
that are **empty** (`doiUrl`, `status`, `pubMonth`, `volume`, `pageStart`, `pageEnd`, `issn`, `isbn`, `category`, `acceptedDate`) and records
`PUBLICATION_UPDATED` in the audit log. Conflicting records (for this list: 7, 13 and 21 without decisions) are never filled, and neither are records with a review decision.

## 6. Schema change, roll-out and rollback

`prisma/migrations/20261029120000_publication_bibliographic_fields` adds **nine optional columns** to `Publication`, each with a constant default
(`''`, and `0` for the month): `status`, `pubMonth`, `volume`, `pageStart`, `pageEnd`, `issn`, `isbn`, `category`, `acceptedDate`. Existing rows
read back as "not stated"; nothing about any current publication changes, and old code keeps working against the migrated database. The
migration is in exactly the form the reviewed Turso executor accepts, and is pinned in `REVIEWED_MIGRATIONS` (SHA-256
`b6cdc2ce390cbdcfc2f82bd2d3aec6c7874cab9cd61fe7c171f442b50454212e`) with its tests. **It has not been applied to Production, Preview or any
shared database.**

Roll-out order: apply the migration (see `turso-migration-executor.md`: inspect first, then apply with a recovery point), then deploy the code,
then run the import. New code against a database without the columns answers 500 on the publication routes (fail-closed).
Rollback: roll the application back (the columns stay and are ignored). Import rollback: the created rows are identifiable by their audit rows;
remove them through the admin interface. There is no automated delete, by design.

## 7. What the public site shows

* **Sections by status**, in this order: Accepted (forthcoming), Under submission, Published, Status not stated. Within each, grouped by year, newest first
  (by year, then month). A single-status result is shown without section headings.
* **Filters**: search (title, authors, venue, DOI, ISSN, researcher), year, **status**, researcher, project, area, group, sort; all in the URL.
* **Each card**: title, the complete author list in the stored order, venue and date, a status badge, category, volume, pages, ISSN / ISBN, and the DOI / PDF
  links. **The publication page** has a "Bibliographic details" list with every field; a field the source did not supply reads "Not provided".
* **A year is never presented as a publication year when it may only be the acceptance year**: for a record that is not PUBLISHED, has no month, and
  whose acceptance date falls in its year, the card shows "Acceptance date: ..." instead, and the page's structured data omits `datePublished`
  (it is also omitted for every ACCEPTED or SUBMITTED paper).
* No internal identifier, note or administrative field is shown; the page size is 50 so a status section is not split across pages.
* The admin edit form has all the new fields, so a person can correct or complete any imported record.

## 8. Limitations

* The three blocked records (8, 10, 16) stay blocked by decision until a person resolves their year; the report states why and prints no override template for them.
* Record 7 also differs in venue from the stored record; only the year was decided, so the venue is reported as undecided and left alone.
* Record 6's list number `277` and record 11's month `2025` have no field and are reported, not stored.
* `volume` keeps the sheet's text (it can contain the issue and article number); there is no separate issue field.
* Publications are not linked to team members or accounts. The author list is text, in the original order; linking is done in the admin interface.
* The reader is a purpose-built, dependency-free `.xlsx` reader for this form layout (verified cell by cell against openpyxl on the real file: 593 of
  594 cells identical; the one difference is the decorative title-row formula, whose cached value is read). It is not a general spreadsheet library.
* The seed script is unchanged; re-seeding next to imported data can recreate the seed's own publications. See `duplicate-prevention.md`.
