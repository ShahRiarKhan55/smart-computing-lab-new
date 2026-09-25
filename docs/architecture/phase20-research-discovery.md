# Phase 20 — Advanced Research Discovery & Knowledge Navigation

Status: implemented, **not committed**. No database migration. Baseline: `804c002`.

## 1. Goal

Make the existing research graph (areas, projects, groups, researchers, publications, news, events, forum)
easier to explore, without a second content architecture, without new infrastructure and without any new
way to see hidden data. Everything here is **read-side**: no new table, no new write endpoint, no audit row.

## 2. Existing architecture (what was already there)

Inspected before coding; nothing below was duplicated.

| Capability | Where | State at Phase 20 start |
| --- | --- | --- |
| Global search over 8 types (`research-area, project, group, researcher, publication, news, forum-topic, event`) | `apps/server/src/lib/search.ts`, `GET /api/search` | complete: tiered ordering, per-type counts, pagination, `type` filter, ja `Translation` matching |
| Search page (chips with counts, URL state `?q&type&page`, empty states, pager) | `SearchPage.tsx`, `useSearchResults.ts` | complete |
| Research graph reads through `visibleTo()` | `researchGraph.ts` | complete |
| Publication hub filters `?area ?project ?group ?researcher ?year ?q ?sort ?page` | `publicationHub.ts`, `PublicationsPage.tsx` | complete |
| Detail pages with all neighbours listed | area / project / group / member / publication pages | complete (Phases 18–19) |
| Breadcrumbs (`PageHeader crumbs`) with `overflow-wrap:anywhere` | `PageHeader.tsx`, `site.css` | complete |
| Home discovery (areas, featured projects, recent publications, news, upcoming events, "at a glance") | `HomePage.tsx` | already satisfies §10 — **not changed** |

The audit found these real gaps, and Phase 20 closes exactly these:

1. Search results carried **no relationship context** (a deliberate Phase 10 rule, because relations are the classic leak path).
2. Detail pages list neighbours but offer **no jump to a filtered list** ("all publications of this area").
3. `/projects` had **no URL filters** (`?area`, `?group`, `?researcher`) for such a jump to land on.
4. The `/research` page was only the areas grid: **no path to Projects / Publications / Researchers**.
5. An empty typed search offered only "search all categories", not **which other categories match**.
6. The search hook's generic error string was hard-coded English.

## 3. Search architecture

Unchanged: `runSearch` (counts → tier sizes → only the bucket pages that overlap the request). Matching,
counting, tiers, ordering and pagination are untouched, so *which* records a query finds cannot change.

Added (display-only) in `apps/server/src/lib/searchRelated.ts`, called once on the page's rows:

* `attachRelated(results, viewer, locale)` adds an optional `related: [{type, id, title, href}]` (max
  `SEARCH_RELATED_MAX = 3`) to each result.
* **One query per result type present** (≤ 7), on that entity's own model, keyed by the ids already returned; plus
  ≤ 3 `Translation` queries for a Japanese request (`loadRefTranslations`, one per referenced kind). Never per result.
* Related kinds are only **direct relations**:

| Result | `related` |
| --- | --- |
| research-area | visible projects (`ProjectArea`) |
| project | its group (if visible), then visible areas |
| group | visible projects |
| researcher | visible areas (`ResearcherArea`) |
| publication | visible projects (`ProjectPublication`) |
| news / event | its project (if visible) |
| forum-topic | none (category/project are already in `meta`) |

Order is `(sortOrder, title, id)`, the group leading a project's list; then cut to 3 — deterministic.

Existing behaviour kept and reused, not re-implemented: type filters (`type=`), URL state, tiered ordering
(exact/prefix/contains + type + own order + id — this *is* the lightweight relevance ordering the brief allows),
counts, Japanese `Translation` matching, forum visibility (`visibleTo` on the category + `visibleForumStatus`),
no message/notification search (not in `SEARCH_TYPES`; `type=message` is a 400).

UI (`SearchResultCard`, `SearchPage`): a labelled "Related:" list of real links above the card's stretched title
link; when a typed search is empty but other categories match, the empty state lists those categories with their
(visibility-aware) counts as links to `type=`. No new filter mechanism was created.

## 4. Discovery / navigation architecture

* `RelatedResearch` (`components/RelatedResearch.tsx`) — the reusable "Explore this research" panel. It renders
  **only links to filtered lists**, makes no request, dedupes by target, and renders nothing when empty. Used on the area,
  project, group, researcher and publication pages.
* `/projects` accepts `?area=`, `?group=`, `?researcher=` (validated with `ID_PATTERN`; a malformed value is dropped and never
  echoed). The filter runs client-side over the list the API already filtered for the viewer.
* `/research` gets a labelled strip of three cards (Projects, Publications, Researchers) — no statistics.
* Breadcrumbs are **unchanged** (already only real, single-parent links; long/unbroken text already wraps). Projects, publications
  and researchers have several parents (many areas / projects), so inventing a single "Research → Area → Project" chain
  would misstate the graph; the Explore panel is the many-to-many navigation instead.

Query parameters used by links (all pre-existing or added here, none invented):

| Link | Target | Supported by |
| --- | --- | --- |
| area → projects / publications | `/projects?area=` / `/publications?area=` | ProjectsPage (new) / publication hub |
| project → publications, sibling projects | `/publications?project=`, `/projects?area=`, `/projects?group=` | hub / ProjectsPage |
| group → projects / publications | `/projects?group=` / `/publications?group=` | ProjectsPage / hub |
| researcher → publications / projects | `/publications?researcher=` / `/projects?researcher=` | hub / ProjectsPage |
| publication → more by researcher/project/area/group | `/publications?researcher|project|area|group=` | hub |
| search chips / suggestions | `/search?q=…&type=` | SearchPage |

## 5. Related-content logic — direct vs derived vs search-only

* **Direct** (a row/link exists): Project↔Area (`ProjectArea`), Project→Group (`groupId`), Publication↔Project
  (`ProjectPublication`), Publication↔Researcher (`PublicationAuthor`), Researcher↔Area (`ResearcherArea`), Project↔Researcher
  (`ProjectMember`), News→Project, Event→Project, Forum post→Project.
* **Derived** (through Project; unchanged from Phases 18–19 and labelled as such on the pages): an area's or group's
  publications/news/events; a publication's areas/groups/news/events.
* **Search-only** (used to *find*, never shown as a relation): a publication is found by its linked authors' names; a researcher
  by history entries; Japanese `Translation` values. Search results never present these as relationships.

News and events have no researcher/publication relation in the schema (news has authors, but that is not surfaced here), so none is invented.

## 6. Visibility propagation

* Every related record is read through the same `visibleTo(viewer)` (to-many, inside the query) or `canView` (to-one). A hidden
  area/group/project is therefore absent, not filtered afterwards, and cannot be counted or inferred.
* A public publication/news/event whose only project is hidden is still found and simply has no `related` (correct; search matches by
  an entity's own columns).
* Filter links carry ids the viewer already sees; a hidden or unknown id on `/projects?…` or `/publications?…` renders the identical
  "no match / not available" state and names nothing.
* Locale only selects text (`pick()` of the `Translation` override); the same ids come back for `en`, `ja` and a tampered `X-Locale`.

## 7. Permissions

No permission was added or changed. `ADMIN > LAB_MANAGER > MEMBER` untouched. No endpoint, no write path, no admin UI change.

## 8. Localization

New typed keys in `en.ts` / `ja.ts` (`Record<keyof typeof en,string>` makes a missing one a compile error): `search.related*`,
`search.otherMatches`, `search.unavailable`, `explore.*`, `projects.filter.*`, `research.explore.*`. Related titles come back from
the API already localized. `explore.more*` Japanese strings are publication-specific by design (they only appear on the publication page).
No form or editable content was touched, so there is no Japanese-prefill risk.

## 9. Performance

`attachRelated`: ≤ 7 model queries (+≤ 3 Translation queries for ja) per request regardless of page size; no per-result query, no table
scan (`id IN (page ids)`). `search-queries.test.ts` (unchanged assertions): 50 results ≤ 12 ops; model allow-list unchanged because
each relation is read through the entity's own model. The Explore panels and filters make **no** extra request.

## 10. Security

`discovery-regression.mjs` scans raw response bodies for hidden ids/names/text, `userId|email|passwordHash|slug|visibility|isOwn`
keys, and covers: invalid/hostile `type`, `page`, `limit`, sort and filter ids (400, never 500); XSS in query, entity titles and Japanese
overrides (JSON text; browser suite proves no element/script is created); visibility flips and deleted relationships take effect
immediately; locale tampering; no message/notification type. The existing search assertion "no result exposes relationship data" was
narrowed, not weakened (see §17).

## 11. Accessibility

One `h1` per page (asserted); the panel is a `<section aria-labelledby>` with an `h2`; related links are a labelled `<ul>`; the strip is
a labelled `<nav>`; the filter tag group is labelled and "Clear filter" is a real link; related links sit above the stretched title link
(`.card a{z-index:1}`) and show the standard focus ring. Enter submits the search (existing form). The Phase 15 audit (named controls,
overlap, clipping, raw keys) and the Tab-walk run over every new surface.

## 12. Browser coverage

`browser-regression.cjs` section "phase 20" (steps `discovery …`, `ONLY_DISCOVERY=1`): seed; guest search related; typed empty-state
suggestions; Explore panels + filtered lists + hidden/unknown/hostile filters + landing strip; keyboard; member (LAB_ONLY neighbours);
Japanese; hostile text (EN+JA); 110-character unbroken title at 390px; nine-width × EN/JA sweeps for guest and member; Tab-walks; screenshots.

## 13. Tests

`npm run test:discovery` (API, DB copy), `tsx scripts/unit-discovery.test.ts` (in `test:unit`), plus the existing suites (unit, api,
search, search-cost, forum, messages, files, gallery, events, admin, research, publication, i18n, locale-independence, browser, mutation).
See the final report for counts.

## 14. Database / reference integrity

No schema change, no migration, `dev.db` byte-identical (SHA-256 before/after), `Lab-Website` tree hash identical. All mutating tests
ran on DB copies.

## 15. Known limitations

* Breadcrumbs remain single-parent (see §4).
* `related` shows at most 3 records per result; there is no "+N more".
* `/projects?…` filters are client-side over the visible list (fine at lab scale; the list endpoint is unpaginated today).
* News results still link to `/news` (there is no news detail route).
* Forum results have no relationship context beyond category/project already in `meta`.

## 16. Deferred work

Server-side project filtering if `/projects` is ever paginated; a news detail page; researcher↔publication "co-author" navigation;
FTS5 (only if `LIKE` cost becomes a problem — not the case today).

## 17. Existing tests changed and why

1. `search-regression.mjs` — "no result exposes relationship data …": the forbidden-key regex is **kept unchanged**; an added clause
   requires every `related` entry to have exactly `type,id,title,href`. Phase 20 legitimately introduces `related`, and the check now
   also constrains its shape.
2. `browser-regression.cjs` — "cards: the link is the only interactive element": a search card may now also contain `related` links.
   The assertion now requires the **title** link to be the only stretched (`::after`) interactive element and every related link to sit
   above it (`position:relative`, `z-index ≥ 1`).
3. `discovery-regression.mjs`, `unit-discovery.test.ts`, the browser section and `test:discovery`/`test:unit` wiring are new.

## 18. Git status

Uncommitted working tree; see the final report for the file list. Nothing committed, pushed or deployed.
