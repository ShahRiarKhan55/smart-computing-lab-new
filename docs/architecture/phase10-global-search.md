# Phase 10 — Global search & discovery

Status: implemented and verified. No database migration, no schema change, no new dependency.

> **SQLite LIKE-based search is used in Phase 10; FTS5/search-engine infrastructure is intentionally deferred.**
> The Phase 8 review flagged FTS5 problems (Prisma emits `DROP TABLE` for FTS shadow tables, migrations, Japanese
> tokenisation). Plain `LIKE` through Prisma's `contains` / `startsWith` needs none of that, works for Japanese
> (a substring match needs no tokeniser) and is fast enough for a lab-sized dataset. A later phase can replace the
> matching layer without touching the API, the result shape or the UI.

---

## 1. Architecture

```
GET /api/search?q=&type=&page=&limit=
        │
        ▼
routes/search.routes.ts   optionalAuth → viewer (session ONLY) → parseOrThrow(searchQuerySchema, req.query)
        │
        ▼
lib/search.ts  runSearch(viewer, query)
        ├─ one SOURCE per entity (defineSource): title column, other columns, base restriction, count(), find()
        ├─ base restriction = visibleTo(viewer)          ← the SAME helper every list endpoint uses
        ├─ COUNT per type  (filter-chip numbers, after visibility)
        ├─ COUNT of the two upper ranking tiers per selected type that has matches
        └─ SELECT only the tier/type "buckets" that overlap the requested page
```

| File | Role |
|---|---|
| `packages/shared/src/schemas/search.ts` | Types, limits, `parseSearchText()`, `searchQuerySchema`, response schemas (used by server, web and tests) |
| `apps/server/src/lib/search.ts` | The engine: sources, tiered WHERE builder, paging across types, excerpts |
| `apps/server/src/routes/search.routes.ts` | The endpoint (13 lines) |
| `apps/web/src/pages/SearchPage.tsx` | `/search` |
| `apps/web/src/components/{SearchForm,SearchResultCard,Highlight}.tsx`, `hooks/useSearchResults.ts` | Reusable UI parts |

### One source of truth for visibility
Search does **not** contain a visibility rule. Every source's `base` is `visibleTo` from `lib/visibility.ts`, and
`visibility` is only ever serialised through `visibilityField(viewer, …)` — exactly like `/api/publications`,
`/api/news`, `/api/research`, `/api/projects`, `/api/groups`. `search.ts` contains no `"PUBLIC"` / `"LAB_ONLY"` literal and no
role comparison (a static check in the API suite fails if one appears). Fixing or changing `visibleTo` changes search too.

## 2. Searchable entities and fields

| Type (`type=`) | Table | Title | Other searched columns | Visibility column |
|---|---|---|---|---|
| `research-area` | ResearchArea | `title` | `description`, `tag` | yes |
| `project` | ResearchProject | `title` | `slug`, `summary`, `description` | yes |
| `group` | ResearchGroup | `name` | `slug`, `description` | yes |
| `researcher` | TeamMember | `name` | `role` (position), `department`, `bio`, **history entries** (`title`, `description`) | none (profiles are public in `/api/team`) |
| `publication` | Publication | `title` | `authors`, `venue`, `doiUrl`, **linked authors' names**, a 4-digit word also matches `year` | yes |
| `news` | NewsItem | `title` | `description`, `type` (category) | yes |

**Never selected, searched or returned:** `userId`, the linked account, its email, password hash, sessions, `slug` of a
result, group/project/member relationships, per-record counts. `isOwn` is not part of a result either.

Events exist in the schema but have no API or data yet, so they are **not** searched (Phase 11+). Forum, messages,
files, gallery, notifications and translations are likewise out of scope.

`TeamMember` has no `visibility` column, so "researcher visibility" is not a thing today: a profile is exactly as public as
`/api/team` already makes it. Search only reads what that endpoint already returns (name, role, department, bio) plus the
public history entries shown on `/team/:id`.

## 3. API

`GET /api/search` — public (no login), viewer taken from the session cookie (`optionalAuth`, which also sets `Vary: Cookie`).

| Parameter | Rule | Default |
|---|---|---|
| `q` | required; trimmed; 1–100 chars; must contain at least one word after parsing (§5); at most 8 distinct words | — |
| `type` | `all` \| `research-area` \| `project` \| `group` \| `researcher` \| `publication` \| `news` | `all` |
| `page` | digits only, 1–10000 | `1` |
| `limit` | digits only, 1–50 (a bigger value is a **400**, not silently clamped) | `20` |

Unknown parameters (`role`, `visibility`, `userId`, …) are ignored. Repeated parameters (`?q=a&q=b`) and `q[x]=…` are 400.
Errors use the project's existing `{ "error": "…" }` shape: 400 for any validation problem, generic 500 for a database
failure (Prisma errors never reach the client). There is no 401/404 on this endpoint. `POST/PUT/DELETE /api/search` do not exist.

### Response
```jsonc
{
  "query": "FPGA aging",              // normalised phrase (trimmed, single spaces, NFKC)
  "type": "all",
  "results": [
    { "type": "project", "id": "…", "title": "…", "description": "…excerpt…", "meta": "Active · 2026-03-01 – 2027-09-30",
      "href": "/projects/…" }          // + "visibility": "PUBLIC" | "LAB_ONLY" ONLY for LAB_MANAGER / ADMIN
  ],
  "pagination": { "page": 1, "limit": 20, "total": 37, "totalPages": 2 },
  "counts": { "all": 37, "research-area": 1, "project": 12, "group": 0, "researcher": 4, "publication": 15, "news": 5 }
}
```
* `total` = matches in the **selected** type(s); `counts` = matches per type; `counts.all` is their sum. Both are computed **after** visibility filtering, so a guest never sees a total that includes hidden rows.
* `totalPages` is `ceil(total / limit)` (0 when there is nothing). A page past the end returns `results: []` with the true totals.
* `description` is a plain-text excerpt (≤ ~200 chars, started shortly before the first match). It is data, never HTML.
* `href`: `/projects/:id`, `/groups/:id`, `/team/:id`. Research areas, publications and news have no detail page yet, so they link to `/research`, `/publications`, `/news`.

## 4. Visibility

| Viewer | Sees | `visibility` key in results |
|---|---|---|
| Guest | `PUBLIC` only | never |
| MEMBER (and project/group lead — a lead is a MEMBER) | `PUBLIC` + `LAB_ONLY` | never (Phase 9 rule: members do not receive it) |
| LAB_MANAGER, ADMIN | `PUBLIC` + `LAB_ONLY` | yes |
| Unknown/garbage role in the DB | treated as MEMBER (`getSessionUser` already does this) | never |

A hidden row behaves as if it did not exist: it is absent from `results`, from `total`, from `totalPages` and from every entry of
`counts`. The viewer is read only from the server-side session: role/visibility/user id in the query string, headers or cookies
are ignored.

### Nested visibility
An entity is matched **only by its own columns** (plus data that is public to everyone: linked authors' names, history
entries). Results carry **no relationships**. Consequently:

* Hidden project "Wombat" inside a PUBLIC group → a guest searching "Wombat" gets nothing; the group is not returned (it does not match by itself).
* PUBLIC project inside a LAB_ONLY group → the guest finds the project; the group's id, name, slug and description appear nowhere in the JSON.
* A PUBLIC group is found by its own name/description only; a hidden project's text neither adds nor removes it.
* A researcher who is linked to a hidden publication is found normally, but the guest gets only the PUBLIC linked publications.

## 5. Matching

* Query text is NFKC-normalised (full-width `ＦＰＧＡ` → `FPGA`, `U+3000` → space), then split into **words** on whitespace.
* **Every word must match** (AND), each in *any* searched column of the entity (OR across columns). Order does not matter.
  `FPGA エージング` finds a record containing both, in any fields.
* A run of Japanese with no spaces is one word and is matched as a **substring**, so `半導体`, `データ`, `研究` work without tokenisation.
* Matching is case-insensitive for ASCII (SQLite `LIKE`). Quotes, backslash, HTML, `;`, `--`, emoji are literal text.
* **`%` and `_` are word separators.** SQLite `LIKE` treats them as wildcards, and Prisma's `contains` cannot escape them, so they cannot be matched literally; making them separators means a query can never become "match everything". A query consisting only of separators is a 400.
* Everything goes through Prisma's parameterised filters. There is no raw SQL and no string-built SQL.

## 6. Ordering and pagination

Deterministic, **documented ordering — not relevance scoring**. Results are sorted by

1. **tier** — 0: title/name *starts with* the whole query; 1: title/name contains every word; 2: matched only through other columns
2. **type** — research-area, project, group, researcher, publication, news
3. the type's own order — title/name A–Z (binary collation); publications newest year first; news newest first
4. `id` — final tiebreaker

An exact title match is not distinguished from a prefix match (Prisma/SQLite offer no case-insensitive `=`); both are tier 0.

Each `(tier, type)` pair is a *bucket* with its own `ORDER BY`. The engine counts the buckets and then queries only those that overlap
`[offset, offset+limit)` with the right `skip`/`take`, so paging across six tables needs no loading and merging in JavaScript. Cost:
6 COUNTs (one per type), +2 COUNTs for each selected type that has matches, +one SELECT per overlapping bucket (a page normally touches 1–3).
No per-result queries. A search with no matches costs exactly 6 COUNTs. Counts and rows are separate statements (not one transaction): a
write between them can make a page momentarily one row off; the next request is consistent.

## 7. Security notes

* Input: validated by one Zod schema (length, words, type, digits-only page/limit, max 50 per page, max page 10000); malformed → 400, never a 500.
* Injection: parameterised Prisma only; SQL-injection strings return 200/0 results and were checked to leave the database untouched. HTML in a query or in a record is rendered as React text; results are JSON.
* No account data can leave: the researcher source never selects `userId`; mutation tests confirm the suite catches it if it did.
* Public + session-dependent: `Vary: Cookie` keeps a shared cache from serving a member's results to a guest.
* No rate limiting exists anywhere in the API yet; search inherits that (bounded work per request: ≤ 50 rows, ≤ 8 words, ≤ 100 chars).

## 8. Frontend

* **Route `/search`** — the URL is the only source of truth: `?q=`, `?type=`, `?page=`. Unknown/invalid `type`/`page` fall back to defaults. Shareable, refresh-safe, Back/Forward-safe.
* **Header search** (`Nav.tsx`, one shared `SearchForm`): *(as shipped in Phase 10: ≥1360px a compact visible box; 769–1359px a magnifier that opens the box on focus because a logged-in admin's header had 12 links; ≤768px the box at the top of the hamburger menu. **Phase 10.1 superseded this**: the grouped header leaves room for the normal box at every desktop width, so the magnifier mode was removed, and the hamburger now starts at ≤900px — see `phase10-1-navigation-and-header.md`.)* Submitting goes to `/search?q=…`. Nothing is requested while typing; the primary flow is type → submit → results page.
* **Search page**: title, labelled search box + button, type chips (`role="group"`, links with `aria-current`, counts from the API), result count in a `role="status"` live region, ordered list of result cards, Previous/Next pager, skeleton while loading (previous results stay dimmed when only the page/type changes; results of an old query are never shown under a new one), empty landing (no API call), no-results panel with suggestions, `role="alert"` error with "Try again" (server validation messages are shown; anything else is a generic message).
* **Result card**: type badge (emoji + text), title link (the only interactive element; a stretched `::after` makes the card the click target and the focus ring lands on the card), meta line, highlighted excerpt, "View …" call to action, "Lab only" badge only when the API sent `visibility`.
* Highlighting is done with React text nodes (`<mark>`), never `dangerouslySetInnerHTML`.
* No new dependency (inline SVG icon, emoji type glyphs).

## 9. Tests (exact counts; all run in this phase)

| Suite | Command (in `apps/server`) | Result |
|---|---|---|
| Policy unit matrix (unchanged) | `npm run test:unit` | 210 passed |
| Search unit (parser, schema, excerpt) | `npm run test:unit` | 64 passed |
| Existing API regression (Phases 1–9.1, unchanged) | `npm run test:api` | 559 passed |
| **Search API regression** | `npm run test:search` | **209 passed** |
| Search query cost / no N+1 | `npm run test:search-cost` | 10 passed |
| Browser regression (Edge/CDP) | `node scripts/browser-regression.cjs …` | **248 passed** (141 earlier checks + 107 for Phase 10) |

API and cost suites run only against a **copy** of the database. The search API suite treats the ordinary list/detail endpoints as an oracle:
for guest, MEMBER, lead, LAB_MANAGER, ADMIN and unknown role the ids search returns per type must equal what `/projects`, `/groups`,
`/publications`, `/news`, `/research`, `/team` return, every returned id must open through its normal detail endpoint, and every hidden id/name/slug/text
must be absent from the **raw JSON** of 126 guest responses. It also covers validation (over 30 malformed inputs plus repeated/array parameters), pagination at 7 page sizes, ordering,
Japanese/mixed/full-width input, SQL-injection/HTML/special characters, visibility flips, deletion, logout/stale/garbage cookies, forged role/headers,
static "no raw SQL / no visibility literal / no userId" checks.

**Mutation testing** (as in earlier phases): 16 server-side mutations (visibility dropped per entity, counts ignoring visibility, group matched via hidden
project, slug/group-name/userId leaked into results, forged role trusted, `optionalAuth` removed, total ignoring the filter, off-by-one paging, order changes…)
were each caught by the API suite (1–63 failing checks each; the first attempt at "leak a slug" was a no-op mutation and was redone properly).
Six browser-level mutations (2 server, 4 web) were run against the browser suite; one initially **survived** (stale results of the previous query under a new
one) because the test navigated away first — checks 11d/11e were added and it is now caught.

Because the shared header now contains a `<form>`, the browser suite's `login()` helper (which submitted `document.querySelector('form')`) was changed to
submit the login form by its own field. No assertion was weakened or removed.

## 10. Known limitations / deliberately deferred

* LIKE-based only: no stemming, no typo tolerance, no synonym or relevance scoring. FTS5 / a search engine is deferred.
* Case-insensitivity is ASCII-only (SQLite `LIKE`); hiragana vs katakana and other script variants are not folded (NFKC handles full/half-width only).
* `%` and `_` cannot be searched literally (they separate words).
* Ordering is documented tiers, not relevance; "exact title" is not ranked above "title starts with".
* Research areas, publications and news have no detail pages, so those results link to their list page (no anchor/scroll to the item).
* Researchers are always visible (no visibility column exists); if a later phase adds one, add it to the researcher source's `base` using `visibleTo`.
* Events (no API/data yet), forum, messages, files, gallery, notifications, translations (Japanese *translation rows* are not searched) are not searchable.
* Search text is not logged and no search analytics exist.
* No rate limiting (none exists elsewhere in the API).
* Counts and rows are separate statements (see §6).
