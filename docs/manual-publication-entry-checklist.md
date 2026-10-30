# Manual-entry checklist: 23 publications from `publicationslist.xlsx`

Prepared on branch `feature/publication-metadata-fields` (the form with the new **Publication Metadata** section). This is a reference document for entering the publications by hand through the website's existing admin form. It adds no code.

## Before you start

1. **The Publication Metadata boxes exist only after this feature is released.** The feature needs a database migration (`20261030120000_publication_metadata_fields`) applied **before** the new code is deployed; until then the boxes do not exist and the publication pages would fail. Enter the publications after both steps are done.
2. You need a Lab Manager or Admin account to set Visibility. Any signed-in member can add or edit a publication.
3. Nothing in this document has been verified against the live site or the publishers. See 'How to read this document'.

## How to read this document

- **Source values** are copied from the workbook cells. The only change is that a line break inside a cell is shown as one space and leading/trailing spaces are trimmed; spelling, punctuation and inner spacing are untouched. They are shown in `code` style so the exact spacing is visible.
- **Form entries** say which box to type each value into. They are the same values, only re-formatted where the box needs it (for example the workbook's `2025年　04月　13日` becomes `2025-04-13` in the date box; both are shown). Nothing is guessed: a box is left **blank** when the source does not state it.
- **UNKNOWN** means the source does not say. **Pending** means a box depends on a question you must answer first.
- **Verified** is not claimed for any paper. The workbook's 状況 (status) is the *spreadsheet's statement*, not independent verification. A DOI that resolves is not by itself proof of publication status; check the publisher's metadata.
- The workbook has one sheet (`Sheet1`), 23 blocks of 10 rows (block *n* starts at row `7 + 10×(n−1)`). Its status words: 出版 = published, 受理 = accepted, 投稿中 = under submission; a blank means not stated.

## The form (with the new section)

| Form box | Workbook field | Rule |
|---|---|---|
| Year | 発行年月 年 | required, whole number 1900–2100 |
| Venue (journal / conference) | 雑誌名 (journal name) | required, up to 500 characters; **type the journal name exactly as in the workbook** (volume, pages and so on now have their own boxes) |
| Title | 題目 | required, up to 500 characters |
| Authors | 著者 | required, up to 1000 characters |
| DOI URL | DOI | optional; must start with `http://` or `https://` |
| PDF URL, extra link and label, Japanese title/venue | not in the workbook | leave empty |
| **Publication Metadata → Status** | 状況 | Not stated / Published / Accepted / Under submission |
| Paper category | 論文カテゴリー | optional text, up to 100 characters |
| Journal list number | 雑誌リスト番号 | optional text, up to 100 characters; type as in the workbook (it may be an ISSN, an ISBN or a plain number) |
| Volume | 巻 | optional text, up to 100 characters; type as in the workbook |
| Starting page / Ending page | ページ 始め / 終り | optional whole numbers 1–99999; the end must not be before the start |
| Publication month | 発行年月 月 | optional, 1–12 |
| Date of acceptance | 受理年月日 | optional date |
| Visibility | (not in the workbook) | managers and admins only: Public or Lab only |

Every Publication Metadata box may stay blank. A blank box is stored as *not stated* and is **not displayed**. Duplicates: an identical DOI is refused; the same title and year is refused unless a manager or admin confirms.

## Existing records: do not assume the starter data matches the live site

The repository's starter data (`apps/server/prisma/seed.ts`) contains four publications. **Nothing here assumes the live (Production) site has them, has them unchanged, or lacks others.** Records marked VERIFY EXISTING or mentioning the starter data must be checked on the live site by you. To check: open the **Publications** page, type a few distinctive title words in the search box (it searches title, authors and venue, not the DOI) and look at the year; or try to add the paper with its DOI link, because the form refuses an identical DOI and names the existing entry. If it exists, edit it (pencil icon) instead of adding a new one; the Publication Metadata boxes can then be filled in on the existing entry.

The four starter-data papers, for reference: (a) *Optimizing FPGA and Wafer Test Coverage with Spatial Sampling and Machine Learning: Analysis of Local Spatial Consistency* (2026, DOI 10.3390/signals7030053); (b) *Enhanced detection of recycled FPGAs using Gaussian process regression with LHS and active sampling* (2026, DOI 10.1145/3765907); (c) *A progressive self-training semi-supervised model to enhance discontinuous change detection* (2025, DOI 10.1016/j.vlsi.2025.102609); (d) *Optimizing FPGA and wafer test coverage with spatial sampling and machine learning* (2025, authors `Wang WeiQuan`, ICECET, DOI 10.48550/arXiv.2506.03556).

## Summary

| # | Status | Year (source) | Recommended visibility | Open questions |
|---|---|---|---|---|
| 1 | READY | 2023 | PUBLIC | 0 |
| 2 | NEEDS CLARIFICATION | 2021 | UNDECIDED until the venue is known | 1 |
| 3 | READY | 2021 | PUBLIC | 0 |
| 4 | READY | 2019 | PUBLIC | 0 |
| 5 | READY | 2018 | PUBLIC | 0 |
| 6 | READY | 2021 | PUBLIC | 0 |
| 7 | CONFLICT | 2026 | UNDECIDED until the questions are answered | 3 |
| 8 | NEEDS CLARIFICATION | UNKNOWN | UNDECIDED until the year is known | 1 |
| 9 | CONFLICT | 2025 | LAB_ONLY until resolved | 2 |
| 10 | CONFLICT | UNKNOWN | LAB_ONLY until resolved | 4 |
| 11 | READY | 2025 | PUBLIC | 0 |
| 12 | CONFLICT | 2025 | LAB_ONLY until resolved | 3 |
| 13 | NEEDS CLARIFICATION | UNKNOWN | LAB_ONLY until resolved | 3 |
| 14 | READY | 2024 | LAB_ONLY until you confirm it is published | 2 |
| 15 | VERIFY EXISTING | 2026 | keep the existing entry's visibility; if you add it, UNDECIDED (status is blank) | 1 |
| 16 | NEEDS CLARIFICATION | UNKNOWN | UNDECIDED until the status and year are known | 2 |
| 17 | NEEDS CLARIFICATION | UNKNOWN | UNDECIDED (accepted, not published) | 1 |
| 18 | NEEDS CLARIFICATION | UNKNOWN | UNDECIDED (accepted, not published) | 1 |
| 19 | NEEDS CLARIFICATION | UNKNOWN | UNDECIDED (accepted, not published) | 1 |
| 20 | NEEDS CLARIFICATION | 2026 | UNDECIDED until the venue is confirmed | 1 |
| 21 | VERIFY EXISTING | 2026 | keep the existing entry's visibility; if you add it, PUBLIC after confirming on the publisher's page | 1 |
| 22 | READY | 2026 | PUBLIC | 0 |
| 23 | READY | 2026 | LAB_ONLY (accepted, not yet published) | 1 |

Totals: READY 9, VERIFY EXISTING 2, NEEDS CLARIFICATION 8, CONFLICT 4 (= 23). Open questions in total: 28.

Suggested order: enter the READY records first; resolve the questions for the others, then enter them.

## The 23 records

### Record 1 — READY

*Spreadsheet block 1, starting at row 7; block label in the sheet: `査読付き学術論文①`.*

**Source values (exact):**

- Title: `Efficient Wafer-level Spatial Variation Modeling for Multi-site RF IC Testing`
- Authors: `Riaza-ul-haque MIAN, Tomoki NAKAMURA, Masuo KAJIYAMA, Makoto EIKI,  and Michihiro SHINTANI`
- Publication year: `2023`
- Month: `11`
- Journal / conference name: `IEICE Transactions on Fundamentals of Electronics, Communications and Computer Sciences`
- Volume: `E-107 A`
- Pages: `1139–1150`
- List number (雑誌リスト番号): `1745-1337` — ISSN 1745-1337
- Category: `REGULAR PAPER 2023EAP1115`
- Acceptance date (受理年月日): not supplied
- DOI / URL: `https://doi.org/10.1587/transfun.2023EAP1115`
- Status (状況): `出版` = 出版 (published)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2023
- Venue: `IEICE Transactions on Fundamentals of Electronics, Communications and Computer Sciences`
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.1587/transfun.2023EAP1115` (as in the source)
- **Publication Metadata:**
  - Status: Published (as stated in the spreadsheet)
  - Paper category: `REGULAR PAPER 2023EAP1115`
  - Journal list number: `1745-1337`
  - Volume: `E-107 A`
  - Starting page: `1139`
  - Ending page: `1150`
  - Publication month: `11`
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **PUBLIC** — The source marks it 出版 (published). That is the spreadsheet's statement, not independent verification; confirm on the publisher's page, and choose LAB_ONLY if you are unsure.

**Questions you must answer before entry:**

- None.

### Record 2 — NEEDS CLARIFICATION

*Spreadsheet block 2, starting at row 17; block label in the sheet: `査読付き学術論文②`.*

**Source values (exact):**

- Title: `Hardware–Software Co-design for Decimal Multiplication`
- Authors: `Riaz-ul-haque Mian 1,Michihiro ShintanI , and Michiko Inoue`
- Publication year: `2021`
- Month: `1`
- Journal / conference name: `2073-431X`
- Volume: `10`
- Pages: `1–15`
- List number (雑誌リスト番号): `2073-431X` — ISSN 2073-431X
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): not supplied
- DOI / URL: `https://doi.org/10.3390/computers10020017`
- Status (状況): `出版` = 出版 (published)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2021
- Venue: UNKNOWN until the question below is answered
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.3390/computers10020017` (as in the source)
- **Publication Metadata:**
  - Status: Published (as stated in the spreadsheet)
  - Paper category: `REGULAR PAPER`
  - Journal list number: `2073-431X`
  - Volume: `10`
  - Starting page: `1`
  - Ending page: `15`
  - Publication month: `1`
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **UNDECIDED until the venue is known** — The source marks it 出版 (published), but the venue is missing, so it cannot be entered yet.
- Note: Venue cell holds only an ISSN-shaped value; the venue name is MISSING in the source.

**Questions you must answer before entry:**

- [ ] The 'journal name' cell contains only `2073-431X` (an ISSN-shaped value). What is the journal name for this paper? (The DOI prefix may suggest a publisher, but the source does not state a journal, so none is assumed.)

### Record 3 — READY

*Spreadsheet block 3, starting at row 27; block label in the sheet: `査読付き学術論文③`.*

**Source values (exact):**

- Title: `Wafer-level Variation Modeling for Multi-site RF IC Testing via Hierarchical Gaussian Process`
- Authors: `Michihiro Shintani, Mian Riaz-ul-haque, Michiko Inoue, Tomoki Nakamura, Masuo Kajiyama, Makoto Eiki`
- Publication year: `2021`
- Month: `2`
- Journal / conference name: `2021 IEEE International Test Conference (ITC)`
- Volume: not supplied
- Pages: `103–112`
- List number (雑誌リスト番号): `2378-2250` — ISSN 2378-2250
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): not supplied
- DOI / URL: `https://doi.org/10.1109/ITC50571.2021.00018`
- Status (状況): `出版` = 出版 (published)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2021
- Venue: `2021 IEEE International Test Conference (ITC)`
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.1109/ITC50571.2021.00018` (as in the source)
- **Publication Metadata:**
  - Status: Published (as stated in the spreadsheet)
  - Paper category: `REGULAR PAPER`
  - Journal list number: `2378-2250`
  - Volume: leave blank
  - Starting page: `103`
  - Ending page: `112`
  - Publication month: `2`
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **PUBLIC** — The source marks it 出版 (published). That is the spreadsheet's statement, not independent verification; confirm on the publisher's page, and choose LAB_ONLY if you are unsure.

**Questions you must answer before entry:**

- None.

### Record 4 — READY

*Spreadsheet block 4, starting at row 37; block label in the sheet: `査読付き学術論文④`.*

**Source values (exact):**

- Title: `Cycle-Accurate Evaluation of Software-Hardware Co-Design of Decimal Computation in RISC-V Ecosystem`
- Authors: `Riaz-ul-haque Mian 1,Michihiro ShintanI , and Michiko Inoue`
- Publication year: `2019`
- Month: `9`
- Journal / conference name: `2019 32nd IEEE International System-on-Chip Conference (SOCC)`
- Volume: not supplied
- Pages: `412–417`
- List number (雑誌リスト番号): `2164-1706` — ISSN 2164-1706
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): not supplied
- DOI / URL: `https://doi.org/10.1109/SOCC46988.2019.1570559752`
- Status (状況): `出版` = 出版 (published)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2019
- Venue: `2019 32nd IEEE International System-on-Chip Conference (SOCC)`
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.1109/SOCC46988.2019.1570559752` (as in the source)
- **Publication Metadata:**
  - Status: Published (as stated in the spreadsheet)
  - Paper category: `REGULAR PAPER`
  - Journal list number: `2164-1706`
  - Volume: leave blank
  - Starting page: `412`
  - Ending page: `417`
  - Publication month: `9`
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **PUBLIC** — The source marks it 出版 (published). That is the spreadsheet's statement, not independent verification; confirm on the publisher's page, and choose LAB_ONLY if you are unsure.
- Note: The author text contains a stray `1` and `ShintanI` (capital I) exactly as in the source; enter as-is or correct it yourself if you know the intended spelling.

**Questions you must answer before entry:**

- None.

### Record 5 — READY

*Spreadsheet block 5, starting at row 47; block label in the sheet: `査読付き学術論文⑤`.*

**Source values (exact):**

- Title: `Decimal Multiplication Using Combination of Software and Hardware`
- Authors: `Riaz-ul-Haque Mian, Michihiro Shintani, Michiko Inoue`
- Publication year: `2018`
- Month: `10`
- Journal / conference name: `2018 IEEE Asia Pacific Conference on Circuits and Systems (APCCAS)`
- Volume: not supplied
- Pages: `239–242`
- List number (雑誌リスト番号): `978-1-5386-8241-8` — ISBN 978-1-5386-8241-8
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): not supplied
- DOI / URL: `https://doi.org/10.1109/APCCAS.2018.8605711`
- Status (状況): `出版` = 出版 (published)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2018
- Venue: `2018 IEEE Asia Pacific Conference on Circuits and Systems (APCCAS)`
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.1109/APCCAS.2018.8605711` (as in the source)
- **Publication Metadata:**
  - Status: Published (as stated in the spreadsheet)
  - Paper category: `REGULAR PAPER`
  - Journal list number: `978-1-5386-8241-8`
  - Volume: leave blank
  - Starting page: `239`
  - Ending page: `242`
  - Publication month: `10`
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **PUBLIC** — The source marks it 出版 (published). That is the spreadsheet's statement, not independent verification; confirm on the publisher's page, and choose LAB_ONLY if you are unsure. The list number is shaped like an ISBN, which fits conference proceedings.

**Questions you must answer before entry:**

- None.

### Record 6 — READY

*Spreadsheet block 6, starting at row 57; block label in the sheet: `査読付き学術論文⑥`.*

**Source values (exact):**

- Title: `Wafer-level Variation Modeling for Multi-site Testing of RF Circuits`
- Authors: `Riaz-ul-haque Mian , Michihiro Shintani`
- Publication year: `2021`
- Month: `12`
- Journal / conference name: `IEICE Technical Report; IEICE Tech. Rep.`
- Volume: `121`
- Pages: `144–149`
- List number (雑誌リスト番号): `277` — 277 (neither an ISSN nor an ISBN pattern; meaning not stated by the source)
- Category: `Technical Report`
- Acceptance date (受理年月日): not supplied
- DOI / URL: none in the source
- Status (状況): `出版` = 出版 (published)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2021
- Venue: `IEICE Technical Report; IEICE Tech. Rep.`
- Title / Authors: exactly as in the source values above
- DOI URL: leave empty (no DOI in the source)
- **Publication Metadata:**
  - Status: Published (as stated in the spreadsheet)
  - Paper category: `Technical Report`
  - Journal list number: `277`
  - Volume: `121`
  - Starting page: `144`
  - Ending page: `149`
  - Publication month: `12`
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **PUBLIC** — The source marks it 出版 (published). That is the spreadsheet's statement, not independent verification; confirm on the publisher's page, and choose LAB_ONLY if you are unsure.
- Note: No DOI in the source. The list number `277` is not ISSN/ISBN-shaped and its meaning is not stated by the source; it is typed into the Journal list number box exactly as written, with no interpretation.

**Questions you must answer before entry:**

- None.

### Record 7 — CONFLICT

*Spreadsheet block 7, starting at row 67; block label in the sheet: `査読付き学術論文⑦`.*

**Source values (exact):**

- Title: `A progressive self-training semi-supervised model to enhance discontinuous change detection`
- Authors: `Yamane Soma, Sakai Yuwa, Riaz-ul-haque Mian`
- Publication year: `2026`
- Month: `3`
- Journal / conference name: `Integration`
- Volume: `REGULAR PAPER`
- Pages: `7–11`
- List number (雑誌リスト番号): `1872-7522` — ISSN 1872-7522
- Category: not supplied
- Acceptance date (受理年月日): not supplied
- DOI / URL: `https://doi.org/10.1016/j.vlsi.2025.102609`
- Status (状況): `出版` = 出版 (published)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2026
- Venue: `Integration` — *pending your answers*
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.1016/j.vlsi.2025.102609` (as in the source)
- **Publication Metadata:**
  - Status: Published (as stated in the spreadsheet)
  - Paper category: leave blank
  - Journal list number: `1872-7522`
  - Volume: pending — the volume cell holds the category text `REGULAR PAPER`; leave blank until you answer
  - Starting page: `7`
  - Ending page: `11`
  - Publication month: `3`
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **UNDECIDED until the questions are answered** — The source marks it 出版 (published), but the year and volume cells need a decision first.
- Note: Checked against starter data only (see 'Existing records').

**Questions you must answer before entry:**

- [ ] The starter data (if it matches the live site) lists this DOI with year 2025; the source says 2026, month 3. Which year is correct?
- [ ] The volume cell contains `REGULAR PAPER` (which is a category value). Is there a real volume number? Until you answer, leave the Volume box blank.
- [ ] If a live entry with this DOI exists, edit it rather than adding a new one (the form refuses a duplicate DOI).

### Record 8 — NEEDS CLARIFICATION

*Spreadsheet block 8, starting at row 77; block label in the sheet: `査読付き学術論文⑧`.*

**Source values (exact):**

- Title: `Design of low power decimal logarithmic converter`
- Authors: `Riaz-ul-Haque Mian, Md Liakot Ali`
- Publication year: UNKNOWN (cell empty)
- Month: not supplied
- Journal / conference name: `2017 International Conference on Electrical, Computer and Communication Engineering (ECCE)`
- Volume: not supplied
- Pages: `152–157`
- List number (雑誌リスト番号): `978-1-5090-5628-6` — ISBN 978-1-5090-5628-6
- Category: not supplied
- Acceptance date (受理年月日): not supplied
- DOI / URL: `https://doi.org/10.1109/ECACE.2017.7912897`
- Status (状況): `出版` = 出版 (published)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: UNKNOWN — the form requires a year (see the questions)
- Venue: `2017 International Conference on Electrical, Computer and Communication Engineering (ECCE)` — *pending your answers*
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.1109/ECACE.2017.7912897` (as in the source)
- **Publication Metadata:**
  - Status: Published (as stated in the spreadsheet)
  - Paper category: leave blank
  - Journal list number: `978-1-5090-5628-6`
  - Volume: leave blank
  - Starting page: `152`
  - Ending page: `157`
  - Publication month: leave blank
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **UNDECIDED until the year is known** — The source marks it 出版 (published), but the year (required by the form) is not given.
- Note: Year and month cells are empty.

**Questions you must answer before entry:**

- [ ] What is the publication year? The venue name and DOI text contain `2017`, but the source's year and month cells are empty, so no year is assumed.

### Record 9 — CONFLICT

*Spreadsheet block 9, starting at row 87; block label in the sheet: `査読付き学術論文9`.*

**Source values (exact):**

- Title: `Custom Adaptive Kernel Strategies for Gaussian Process Regression in Wafer-Level Modeling and FPGA Delay Analysis`
- Authors: `Riaz-ul-haque Mian  *,Foisal Ahmed,Yoshito Hagihara,Yamane Souma`
- Publication year: `2025`
- Month: `2`
- Journal / conference name: `Journal of Electronic Testing`
- Volume: `Volume 41, Number 3`
- Pages: not supplied
- List number (雑誌リスト番号): `1573-0727` — ISSN 1573-0727
- Category: `REGULAR PAPER JETT-D-25-00014R3`
- Acceptance date (受理年月日): `2025年　04月　13日`
- DOI / URL: `https://doi.org/10.1007/s10836-025-06180-8`
- Status (状況): `投稿中` = 投稿中 (under submission)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2025
- Venue: `Journal of Electronic Testing` — *pending your answers*
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.1007/s10836-025-06180-8` (as in the source)
- **Publication Metadata:**
  - Status: pending your decision (the source says Under submission, which conflicts with other data; see the questions)
  - Paper category: `REGULAR PAPER JETT-D-25-00014R3`
  - Journal list number: `1573-0727`
  - Volume: `Volume 41, Number 3`
  - Starting page: leave blank
  - Ending page: leave blank
  - Publication month: `2`
  - Date of acceptance: `2025-04-13` (source: `2025年　04月　13日`)
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **LAB_ONLY until resolved** — The source says 投稿中 (under submission) yet gives a DOI; its true status is not established by the source.

**Questions you must answer before entry:**

- [ ] Status is 投稿中 (under submission) but a DOI is given, and the acceptance date is 2025年　04月　13日. Is the paper published or still under submission? Please check the publisher's metadata (a DOI that resolves is not by itself proof of publication status).
- [ ] The Volume box can take the source text `Volume 41, Number 3` as written; confirm that is how you want it shown.

### Record 10 — CONFLICT

*Spreadsheet block 10, starting at row 97; block label in the sheet: `査読付き学術論文-10`.*

**Source values (exact):**

- Title: `Green Building certification suitable for Bangladesh: Insights from worldwide certification system (Accepted)`
- Authors: `M S Osmani1, R H Main, Y K Nguyen Tran`
- Publication year: UNKNOWN (cell empty)
- Month: not supplied
- Journal / conference name: `Earth and Environmental Science`
- Volume: `1651`
- Pages: not supplied
- List number (雑誌リスト番号): `1755-1315` — ISSN 1755-1315
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): not supplied
- DOI / URL: `https://doi.org/10.1088/1755-1315/1582/1/012092`
- Status (状況): `出版` = 出版 (published)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: UNKNOWN — the form requires a year (see the questions)
- Venue: `Earth and Environmental Science` — *pending your answers*
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.1088/1755-1315/1582/1/012092` (as in the source)
- **Publication Metadata:**
  - Status: pending your decision (the source says Published, which conflicts with other data; see the questions)
  - Paper category: `REGULAR PAPER`
  - Journal list number: `1755-1315`
  - Volume: `1651`
  - Starting page: leave blank
  - Ending page: leave blank
  - Publication month: leave blank
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **LAB_ONLY until resolved** — The source says 出版 (published) but the title says "(Accepted)"; its true status is not established by the source.
- Note: Year and month cells are empty.

**Questions you must answer before entry:**

- [ ] Status 出版 (published) conflicts with the title text `(Accepted)`. Which is right?
- [ ] What is the publication year (empty in the source)?
- [ ] The volume cell says `1651` but the DOI path contains `1582`. Which is correct?
- [ ] Is the author text `R H Main` spelled as intended? (Reported as written; no correction made.)

### Record 11 — READY

*Spreadsheet block 11, starting at row 107; block label in the sheet: `査読付き学術論文-11`.*

**Source values (exact):**

- Title: `Approach to Visual Attractiveness of Event Space Through Data-Driven Environment and Spatial Perception Classification`
- Authors: `Aliffi Majiid, Riaz-Ul-Haque Mian, Kouki Kurohara, Yen-Khang Nguyen-Tran`
- Publication year: `2025`
- Month: `2025` — not a valid month (1–12); not used
- Journal / conference name: `International Civil Engineering and Architecture Conference (CEAC 2025),Lecture Notes in Civil Engineering`
- Volume: not supplied
- Pages: `358–368`
- List number (雑誌リスト番号): not supplied
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): not supplied
- DOI / URL: none in the source
- Status (状況): `出版` = 出版 (published)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2025
- Venue: `International Civil Engineering and Architecture Conference (CEAC 2025),Lecture Notes in Civil Engineering`
- Title / Authors: exactly as in the source values above
- DOI URL: leave empty (no DOI in the source)
- **Publication Metadata:**
  - Status: Published (as stated in the spreadsheet)
  - Paper category: `REGULAR PAPER`
  - Journal list number: leave blank
  - Volume: leave blank
  - Starting page: `358`
  - Ending page: `368`
  - Publication month: leave blank (the source cell `2025` is not a month)
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **PUBLIC** — The source marks it 出版 (published). That is the spreadsheet's statement, not independent verification; confirm on the publisher's page, and choose LAB_ONLY if you are unsure.
- Note: No DOI in the source. The month cell contains `2025`, which is not a month, so the Publication month box is left blank; the year cell (2025) is used as the year.

**Questions you must answer before entry:**

- None.

### Record 12 — CONFLICT

*Spreadsheet block 12, starting at row 117; block label in the sheet: `査読付き学術論文12`.*

**Source values (exact):**

- Title: `Data-Driven Spatial Analysis: A Multi-Stage Framework to Enhance Temporary Event Space Attractiveness Classification`
- Authors: `Yen-Khang Nguyen-Tran , Aliffi Majiid, Riaz-ul-haque Mian`
- Publication year: `2025`
- Month: `4`
- Journal / conference name: `World（MDPI) DICTA 2024`
- Volume: not supplied
- Pages: `553–567`
- List number (雑誌リスト番号): `2673-4060` — ISSN 2673-4060
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): not supplied
- DOI / URL: `https://doi.org/10.3390/world6020054`
- Status (状況): `投稿中` = 投稿中 (under submission)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2025
- Venue: `World（MDPI) DICTA 2024` — *pending your answers*
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.3390/world6020054` (as in the source)
- **Publication Metadata:**
  - Status: pending your decision (the source says Under submission, which conflicts with other data; see the questions)
  - Paper category: `REGULAR PAPER`
  - Journal list number: `2673-4060`
  - Volume: leave blank
  - Starting page: pending — the pages are identical to record 14; confirm first (source: `553`)
  - Ending page: pending — the pages are identical to record 14; confirm first (source: `567`)
  - Publication month: `4`
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **LAB_ONLY until resolved** — The source says 投稿中 (under submission) yet gives a DOI; its true status is not established by the source.
- Note: Acceptance-date cell is a blank template (年　月　日).

**Questions you must answer before entry:**

- [ ] Status 投稿中 (under submission) conflicts with the DOI and with year 2025 / month 4. Is it published or still submitted? (Check publisher metadata.)
- [ ] The venue cell reads `World（MDPI) DICTA 2024`, which names two things. What is the correct venue text?
- [ ] Pages `553–567` are identical to record 14 (a different paper). Which paper do these pages belong to?

### Record 13 — NEEDS CLARIFICATION

*Spreadsheet block 13, starting at row 127; block label in the sheet: `査読付き学術論文13`.*

**Source values (exact):**

- Title: `Optimizing FPGA and Wafer Test Coverage with Spatial Sampling and Machine Learning Classification (Accepted for Presentatin)`
- Authors: `Wang WeiQuan, Riaz-ul-Haque Mian`
- Publication year: UNKNOWN (cell empty)
- Month: not supplied
- Journal / conference name: `International Conference on Electrical, Computer and Energy Technologies (ICECET 2025)`
- Volume: not supplied
- Pages: not supplied
- List number (雑誌リスト番号): not supplied
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): `2025年04　月04　日`
- DOI / URL: none in the source
- Status (状況): `投稿中` = 投稿中 (under submission)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: UNKNOWN — the form requires a year (see the questions)
- Venue: `International Conference on Electrical, Computer and Energy Technologies (ICECET 2025)` — *pending your answers*
- Title / Authors: exactly as in the source values above
- DOI URL: leave empty (no DOI in the source)
- **Publication Metadata:**
  - Status: pending your decision (the source says Under submission, which conflicts with other data; see the questions)
  - Paper category: `REGULAR PAPER`
  - Journal list number: leave blank
  - Volume: leave blank
  - Starting page: leave blank
  - Ending page: leave blank
  - Publication month: leave blank
  - Date of acceptance: `2025-04-04` (source: `2025年04　月04　日`)
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **LAB_ONLY until resolved** — The source says 投稿中 (under submission) with an acceptance date; no year is given.
- Note: Year and month cells are empty; no DOI.

**Questions you must answer before entry:**

- [ ] The title ends `(Accepted for Presentatin)`, the status is 投稿中 (under submission), and the acceptance date is `2025年04 月04 日`. What is the true status?
- [ ] No publication year in the source. What year should the form carry?
- [ ] This title begins like the starter-data ICECET 2025 paper (authors `Wang WeiQuan`, year 2025). If the live site already has that paper, is this the same paper (skip) or a different one?

### Record 14 — READY

*Spreadsheet block 14, starting at row 137; block label in the sheet: `著書（総説）又は査読付き学術論文-14`.*

**Source values (exact):**

- Title: `Hierarchical Active Learning for Efficient Semi-Supervised Seagrass Image`
- Authors: `Farah Afifah Binti Mohd Nawayai, Syed Mohammed Shamsul Islam, Md Kislu Noman,Riaz-ul-Haque Mian`
- Publication year: `2024`
- Month: `10`
- Journal / conference name: `Digital Image Computing: Techniques & Applications DICTA 2024`
- Volume: not supplied
- Pages: `553–567`
- List number (雑誌リスト番号): `979-8-3503-7903-7` — ISBN 979-8-3503-7903-7
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): not supplied
- DOI / URL: `https://doi.org/10.1109/DICTA63115.2024.00086`
- Status (状況): blank (not stated)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2024
- Venue: `Digital Image Computing: Techniques & Applications DICTA 2024`
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.1109/DICTA63115.2024.00086` (as in the source)
- **Publication Metadata:**
  - Status: Not stated (the source is blank)
  - Paper category: `REGULAR PAPER`
  - Journal list number: `979-8-3503-7903-7`
  - Volume: leave blank
  - Starting page: pending — the pages are identical to record 12; confirm first (source: `553`)
  - Ending page: pending — the pages are identical to record 12; confirm first (source: `567`)
  - Publication month: `10`
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **LAB_ONLY until you confirm it is published** — The status cell is blank, so the source does not say whether it is published.

**Questions you must answer before entry:**

- [ ] Status is blank. Is the paper published? (Needed only to choose PUBLIC; it can be entered as LAB_ONLY first.)
- [ ] Pages `553–567` are identical to record 12 (a different paper). Confirm the pages before entering them, or omit pages.

### Record 15 — VERIFY EXISTING

*Spreadsheet block 15, starting at row 147; block label in the sheet: `著書（総説）又は査読付き学術論文-15`.*

**Source values (exact):**

- Title: `Enhanced detection of recycled FPGAs using Gaussian process regression with LHS and active sampling`
- Authors: `Yoshito Hagihara, Foisal Ahmed, Yamane Shoma, Riaz-Ul-Haque Mian`
- Publication year: `2026`
- Month: `3`
- Journal / conference name: `ACM Transactions on Design Automation of Electronic Systems,`
- Volume: `31(4)`
- Pages: `1–21`
- List number (雑誌リスト番号): `1084-4309` — ISSN 1084-4309
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): not supplied
- DOI / URL: `https://doi.org/10.1145/3765907`
- Status (状況): blank (not stated)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2026
- Venue: `ACM Transactions on Design Automation of Electronic Systems,`  (the source value ends with a comma; typed as in the source)
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.1145/3765907` (as in the source)
- **Publication Metadata:**
  - Status: Not stated (the source is blank)
  - Paper category: `REGULAR PAPER`
  - Journal list number: `1084-4309`
  - Volume: `31(4)`
  - Starting page: `1`
  - Ending page: `21`
  - Publication month: `3`
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **keep the existing entry's visibility; if you add it, UNDECIDED (status is blank)** — The status cell is blank, so the source does not say whether it is published.
- Note: Same DOI as a starter-data record; whether the LIVE site has it is unknown.

**Questions you must answer before entry:**

- [ ] Search the live site for this paper (title words, or try adding the DOI and read the duplicate message). If it exists, do not add it again.

### Record 16 — NEEDS CLARIFICATION

*Spreadsheet block 16, starting at row 157; block label in the sheet: `著書（総説）又は査読付き学術論文-16`.*

**Source values (exact):**

- Title: `HALT-ViT: A Semi-Supervised Vision Transformer with Adaptive Per-Class Pseudo-Labeling for Underwater Image Classification`
- Authors: `Farah Afifah Binti Mohd Nawayai, Syed Mohammed Shamsul Islam, Riaz-ul-Haque Mian,`
- Publication year: UNKNOWN (cell empty)
- Month: not supplied
- Journal / conference name: `14th IIAE International Conference on Industrial Application Engineering 2026`
- Volume: not supplied
- Pages: not supplied
- List number (雑誌リスト番号): not supplied
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): not supplied
- DOI / URL: `https://doi.org/10.12792/iciae2026.012`
- Status (状況): blank (not stated)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: UNKNOWN — the form requires a year (see the questions)
- Venue: `14th IIAE International Conference on Industrial Application Engineering 2026` — *pending your answers*
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.12792/iciae2026.012` (as in the source)
- **Publication Metadata:**
  - Status: Not stated (the source is blank)
  - Paper category: `REGULAR PAPER`
  - Journal list number: leave blank
  - Volume: leave blank
  - Starting page: leave blank
  - Ending page: leave blank
  - Publication month: leave blank
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **UNDECIDED until the status and year are known** — The status cell is blank and there is no year.
- Note: Year and month cells are empty; status blank; no pages.

**Questions you must answer before entry:**

- [ ] What is the publication year (empty in the source; the venue name contains `2026`, which is not used as a year)?
- [ ] Is it published or accepted?

### Record 17 — NEEDS CLARIFICATION

*Spreadsheet block 17, starting at row 167; block label in the sheet: `著書（総説）又は査読付き学術論文-17`.*

**Source values (exact):**

- Title: `Explainable AI Driven Differentially Expressed Gene Prioritization from RNA-seq Data for Type II Diabetes`
- Authors: `Arpa Kar Puza,Abu Mohammad Noor,Toufique Al Imran,Nitun Kumar Podder,Riaz-ul-haque Mian,Md Abdur Rahim`
- Publication year: UNKNOWN (cell empty)
- Month: not supplied
- Journal / conference name: `2026 IEEE International Conference on Signal Processing, Information, Communication and Systems (SPICSCON)`
- Volume: not supplied
- Pages: not supplied
- List number (雑誌リスト番号): not supplied
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): `2026-07-29`
- DOI / URL: none in the source
- Status (状況): `受理` = 受理 (accepted)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: UNKNOWN — the form requires a year (see the questions)
- Venue: `2026 IEEE International Conference on Signal Processing, Information, Communication and Systems (SPICSCON)` — *pending your answers*
- Title / Authors: exactly as in the source values above
- DOI URL: leave empty (no DOI in the source)
- **Publication Metadata:**
  - Status: Accepted (as stated in the spreadsheet)
  - Paper category: `REGULAR PAPER`
  - Journal list number: leave blank
  - Volume: leave blank
  - Starting page: leave blank
  - Ending page: leave blank
  - Publication month: leave blank
  - Date of acceptance: `2026-07-29` (source: `2026-07-29`)
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **UNDECIDED (accepted, not published)** — The source marks it 受理 (accepted), not published; it has no publication year.
- Note: No DOI, no pages.

**Questions you must answer before entry:**

- [ ] What year should the form carry? The form requires a year; the acceptance date `2026-07-29` is a different fact and is not used as one. Alternatively, hold this paper back until it is published.

### Record 18 — NEEDS CLARIFICATION

*Spreadsheet block 18, starting at row 177; block label in the sheet: `著書（総説）又は査読付き学術論文-18`.*

**Source values (exact):**

- Title: `Dual-Modal Analysis of Visitor Engagement in a Small-Scale Temporary Event: Integrating Perceptual and Behavioral Data`
- Authors: `Mohamad Shahrizal bin Mohd Jamil, Yen-Khang Nguyen-Tran, Mian Riaz ul Haque`
- Publication year: UNKNOWN (cell empty)
- Month: not supplied
- Journal / conference name: `2026 IEEE International Conference on Future Machine Learning And Data Science (FMLDS)`
- Volume: not supplied
- Pages: not supplied
- List number (雑誌リスト番号): not supplied
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): `2026-07-15`
- DOI / URL: none in the source
- Status (状況): `受理` = 受理 (accepted)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: UNKNOWN — the form requires a year (see the questions)
- Venue: `2026 IEEE International Conference on Future Machine Learning And Data Science (FMLDS)` — *pending your answers*
- Title / Authors: exactly as in the source values above
- DOI URL: leave empty (no DOI in the source)
- **Publication Metadata:**
  - Status: Accepted (as stated in the spreadsheet)
  - Paper category: `REGULAR PAPER`
  - Journal list number: leave blank
  - Volume: leave blank
  - Starting page: leave blank
  - Ending page: leave blank
  - Publication month: leave blank
  - Date of acceptance: `2026-07-15` (source: `2026-07-15`)
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **UNDECIDED (accepted, not published)** — The source marks it 受理 (accepted), not published; it has no publication year.
- Note: No DOI, no pages.

**Questions you must answer before entry:**

- [ ] What year should the form carry? Acceptance date `2026-07-15` is not used as a year. Or hold this paper back until it is published.

### Record 19 — NEEDS CLARIFICATION

*Spreadsheet block 19, starting at row 187; block label in the sheet: `著書（総説）又は査読付き学術論文-19`.*

**Source values (exact):**

- Title: `A Noise-Augmented Semi-Supervised Few-Shot Framework for Underwater Seagrass Classification`
- Authors: `Matin Wazir Ahmad, Md. Abdur Rahim, Syed Mohammed Shamsul Islam, Riaz-ul-Haque Mian`
- Publication year: UNKNOWN (cell empty)
- Month: not supplied
- Journal / conference name: `2026 IEEE International Conference on Future Machine Learning And Data Science (FMLDS)`
- Volume: not supplied
- Pages: not supplied
- List number (雑誌リスト番号): not supplied
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): `2026-07-15`
- DOI / URL: none in the source
- Status (状況): `受理` = 受理 (accepted)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: UNKNOWN — the form requires a year (see the questions)
- Venue: `2026 IEEE International Conference on Future Machine Learning And Data Science (FMLDS)` — *pending your answers*
- Title / Authors: exactly as in the source values above
- DOI URL: leave empty (no DOI in the source)
- **Publication Metadata:**
  - Status: Accepted (as stated in the spreadsheet)
  - Paper category: `REGULAR PAPER`
  - Journal list number: leave blank
  - Volume: leave blank
  - Starting page: leave blank
  - Ending page: leave blank
  - Publication month: leave blank
  - Date of acceptance: `2026-07-15` (source: `2026-07-15`)
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **UNDECIDED (accepted, not published)** — The source marks it 受理 (accepted), not published; it has no publication year.
- Note: No DOI, no pages.

**Questions you must answer before entry:**

- [ ] What year should the form carry? Acceptance date `2026-07-15` is not used as a year. Or hold this paper back until it is published.

### Record 20 — NEEDS CLARIFICATION

*Spreadsheet block 20, starting at row 197; block label in the sheet: `著書（総説）又は査読付き学術論文-20+B188:B207`.*

**Source values (exact):**

- Title: `AI-Driven Multi-Modal Assessment of Visual Impression in Architectural Event Spaces: A Cross-Cultural Behavioral and Sentiment Analysis`
- Authors: `Riaz-ul-haque Mian, Yen-Khang Nguyen-Tran`
- Publication year: `2026`
- Month: `1`
- Journal / conference name: `World（MDPI) DICTA 2024`
- Volume: `7(2), 21`
- Pages: not supplied
- List number (雑誌リスト番号): `2673-4060` — ISSN 2673-4060
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): not supplied
- DOI / URL: `10.3390/world7020021`
- Status (状況): `出版` = 出版 (published)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2026
- Venue: `World（MDPI) DICTA 2024` — *pending your answers*
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.3390/world7020021` (the source has no `https://doi.org/` prefix; only the prefix is added)
- **Publication Metadata:**
  - Status: Published (as stated in the spreadsheet)
  - Paper category: `REGULAR PAPER`
  - Journal list number: `2673-4060`
  - Volume: `7(2), 21`
  - Starting page: leave blank
  - Ending page: leave blank
  - Publication month: `1`
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **UNDECIDED until the venue is confirmed** — The source marks it 出版 (published), but the venue text looks unreliable.
- Note: The DOI is written without `https://doi.org/` in the source.

**Questions you must answer before entry:**

- [ ] The venue cell reads `World（MDPI) DICTA 2024`, the same text as record 12. Is that the correct venue for this paper? (Source: year 2026, volume cell `7(2), 21`.)

### Record 21 — VERIFY EXISTING

*Spreadsheet block 21, starting at row 207; block label in the sheet: `著書（総説）又は査読付き学術論文-21`.*

**Source values (exact):**

- Title: `Optimizing FPGA and Wafer Test Coverage with Spatial Sampling and Machine Learning: Analysis of Local Spatial Consistency`
- Authors: `Weiquan Wang  , K.M Shahriar Alam Adib  , Foisal Ahmed, Riaz-ul-haque Mian`
- Publication year: `2026`
- Month: `6`
- Journal / conference name: `Signals`
- Volume: `7(3), 53`
- Pages: `1–27`
- List number (雑誌リスト番号): `2624-6120` — ISSN 2624-6120
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): not supplied
- DOI / URL: `10.3390/signals7030053`
- Status (状況): `出版` = 出版 (published)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2026
- Venue: `Signals`
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.3390/signals7030053` (the source has no `https://doi.org/` prefix; only the prefix is added)
- **Publication Metadata:**
  - Status: Published (as stated in the spreadsheet)
  - Paper category: `REGULAR PAPER`
  - Journal list number: `2624-6120`
  - Volume: `7(3), 53`
  - Starting page: `1`
  - Ending page: `27`
  - Publication month: `6`
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **keep the existing entry's visibility; if you add it, PUBLIC after confirming on the publisher's page** — The source marks it 出版 (published). That is the spreadsheet's statement, not independent verification; confirm on the publisher's page, and choose LAB_ONLY if you are unsure.
- Note: Same DOI, title and authors as a starter-data record; whether the LIVE site has it is unknown. The DOI is written without `https://doi.org/` in the source.

**Questions you must answer before entry:**

- [ ] Search the live site for this paper. If it exists, skip it, or edit it and fill in its Publication Metadata boxes (volume, pages, month, list number, category, status).

### Record 22 — READY

*Spreadsheet block 22, starting at row 217; block label in the sheet: `著書（総説）又は査読付き学術論文-22`.*

**Source values (exact):**

- Title: `An Open-Source Evaluation Framework for RISC-V Co-Design-Based Decimal Arithmetic`
- Authors: `Nguyen Trung Luong,Riaz-ul-Haque Mian, Nguyen-Tran Yen-Khang`
- Publication year: `2026`
- Month: `8`
- Journal / conference name: `Signals`
- Volume: `7(4), 75`
- Pages: `1–17`
- List number (雑誌リスト番号): `2624-6120` — ISSN 2624-6120
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): not supplied
- DOI / URL: `10.3390/signals7040075`
- Status (状況): `出版` = 出版 (published)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2026
- Venue: `Signals`
- Title / Authors: exactly as in the source values above
- DOI URL: `https://doi.org/10.3390/signals7040075` (the source has no `https://doi.org/` prefix; only the prefix is added)
- **Publication Metadata:**
  - Status: Published (as stated in the spreadsheet)
  - Paper category: `REGULAR PAPER`
  - Journal list number: `2624-6120`
  - Volume: `7(4), 75`
  - Starting page: `1`
  - Ending page: `17`
  - Publication month: `8`
  - Date of acceptance: leave blank
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **PUBLIC** — The source marks it 出版 (published). That is the spreadsheet's statement, not independent verification; confirm on the publisher's page, and choose LAB_ONLY if you are unsure.
- Note: The DOI is written without `https://doi.org/` in the source.

**Questions you must answer before entry:**

- None.

### Record 23 — READY

*Spreadsheet block 23, starting at row 227; block label in the sheet: `著書（総説）又は査読付き学術論文-23`.*

**Source values (exact):**

- Title: `A Hybrid Design-to-Computation Pipeline for Ageing Cities: Reconstructing Walkability for Autonomous Transit in Matsue`
- Authors: `Riaz-ul-Haque Mian, Michiko Inoue`
- Publication year: `2026`
- Month: `8`
- Journal / conference name: `2026 IEEE International Conference on Future Machine Learning And Data Science (FMLDS)`
- Volume: not supplied
- Pages: `1–17`
- List number (雑誌リスト番号): not supplied
- Category: `REGULAR PAPER`
- Acceptance date (受理年月日): `15-Jul-26`
- DOI / URL: none in the source
- Status (状況): `受理` = 受理 (accepted)

**Enter into the form (same values, re-formatted only where a box needs it):**

- Year: 2026
- Venue: `2026 IEEE International Conference on Future Machine Learning And Data Science (FMLDS)`
- Title / Authors: exactly as in the source values above
- DOI URL: leave empty (no DOI in the source)
- **Publication Metadata:**
  - Status: Accepted (as stated in the spreadsheet)
  - Paper category: `REGULAR PAPER`
  - Journal list number: leave blank
  - Volume: leave blank
  - Starting page: `1`
  - Ending page: `17`
  - Publication month: `8`
  - Date of acceptance: `2026-07-15` (source: `15-Jul-26`)
- PDF URL, extra link, Japanese title/venue: leave empty (not in the source)
- Visibility: **LAB_ONLY (accepted, not yet published)** — The source marks it 受理 (accepted), not published.
- Note: No DOI. The acceptance date cell is `15-Jul-26`. The year (2026) and month (8) cells are filled.

**Questions you must answer before entry:**

- [ ] Confirm Status = Accepted (the source says 受理, acceptance date 2026-07-15). Note the Year (2026) and Publication month (8) are the source's stated values for this accepted, not-yet-published paper; confirm you want them shown.

## Cosmetic oddities in the source author lists (typed as-is unless you decide to tidy them)

- Records 2 and 4: `Riaz-ul-haque Mian 1,Michihiro ShintanI , and ...` has a stray `1` and a capital `I` in `ShintanI`.
- Record 9: `Riaz-ul-haque Mian  *,...`; record 10: `M S Osmani1, R H Main, ...`; record 16: the list ends with a comma.
These are source values; correct them only if you know the intended text.

## After entering

1. Open each new entry and check the DOI link opens the right paper, the author order is as above, the year is right, and the Publication details list shows exactly the values you typed (blank boxes show nothing).
2. View the Publications page signed out: only PUBLIC entries should appear.
3. Tick off the records here as you go.
