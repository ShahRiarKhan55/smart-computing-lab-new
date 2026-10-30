# Publications

## Who can do what

| Action | Who |
|---|---|
| View public publications and details | everyone |
| Add a publication, edit any publication | any signed-in account |
| Delete a publication | lab manager, administrator |
| Choose or change visibility; confirm a duplicate warning | lab manager, administrator |
| Link authors (team members) to a publication | any signed-in account (`PUT /api/publications/:id/authors`) |

A new publication is `PUBLIC` unless a manager chooses otherwise. Details: [role-permissions.md](../technical/role-permissions.md).

## Add or edit a publication

Open **Research → Publications** (`/publications`), click **Add publication** (or open a publication and use its edit control), and fill in the form. The modal has these groups:

| Group | Fields (labels) |
|---|---|
| **Publication** | Year, Venue (journal / conference), Title, Authors (comma-separated, as printed on the paper) |
| **Links** | PDF URL, DOI URL, Extra link URL, Extra link label (all optional) |
| **Publication Metadata** | Status, Paper category, Journal list number, Volume, Starting page, Ending page, Publication month, Date of acceptance, all optional |
| Japanese | Title (Japanese), Venue (Japanese) |
| Visibility (managers and administrators only) | Public or lab-only |

### The eight Publication Metadata fields

| Form label | Stored as | Rule | "Not stated" |
|---|---|---|---|
| Status | `status` | one of Published, Accepted, Under submission (`PUBLISHED`, `ACCEPTED`, `SUBMITTED`) | blank |
| Paper category | `category` | free text, up to 100 characters | blank |
| Journal list number | `listNumber` | free text kept as typed, up to 100 characters (for example an ISSN or ISBN) | blank |
| Volume | `volume` | free text kept as typed, for example `E-107 A` or `7(2), 21` | blank |
| Starting page, Ending page | `startPage`, `endPage` | whole numbers 1 to 99999; the ending page cannot be before the starting page | blank (stored as 0) |
| Publication month | `month` | whole number 1 to 12 | blank (stored as 0) |
| Date of acceptance | `acceptedDate` | a real date written `YYYY-MM-DD` | blank |

Every box may stay empty: an empty value is stored as "not stated" and is **not shown** on the public pages, so existing publications look exactly as before. When editing, only the fields you send change; fields you do not touch keep their values. Validation messages are shown in English.

The worksheet's *journal name* is the existing **Venue** field and its *year* is the existing **Year** field.

## How publications appear

- **List** (`/publications`): newest year first, then most recently added. Each entry shows a compact "Label: value" line of the metadata that is stated. The month is not used for ordering.
- **Detail** (`/publications/:id`): a labelled **Publication details** list of the stated metadata, plus authors, venue, year and links.
- **Search engines:** a `PUBLISHED` paper keeps its year and `datePublished`. An `ACCEPTED` or `SUBMITTED` paper gets neither (no publication-date claim). A record with no status keeps the earlier behavior.
- The status is shown but cannot yet be used as a filter.

## Duplicate protection

- The same DOI (in any URL form) is always refused.
- The same title and year is refused unless a lab manager or administrator confirms that it is a different paper ("save anyway").
- Before adding a publication, search for it first; edit the existing record instead of adding a second one.

## Database and release notes

The eight columns were added by migration `20261030120000_publication_metadata_fields` (additive; existing rows read back as "not stated"). The migration must be applied to a database before code that reads the columns runs against it: [`docs/architecture/publication-metadata-release.md`](../architecture/publication-metadata-release.md), [database.md](../technical/database.md).

Publishing a long list by hand: [`docs/manual-publication-entry-checklist.md`](../manual-publication-entry-checklist.md) maps the lab's 23-paper workbook onto these form boxes and lists open questions. It has not been verified against publishers.
