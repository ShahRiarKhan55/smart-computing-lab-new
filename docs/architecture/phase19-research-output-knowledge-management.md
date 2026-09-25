# Phase 19 — Advanced Research Output & Knowledge Management

Phase 19 turns Publications from a flat list into a research-output **knowledge hub**: a filterable, sortable,
paged index; a real detail page at `/publications/:id`; the relationships a publication genuinely has; Japanese
title/venue; search, admin and audit integration. It is a **read-model, navigation and localization phase over
tables that already existed**. It adds **no table, no column, no migration, no role and no visibility state**.

Contents: 1 [Goal](#1-goal) · 2 [Existing architecture inspected](#2-existing-architecture-inspected) ·
3 [Publication architecture](#3-publication-architecture) · 4 [Relationship model](#4-relationship-model) ·
5 [Pages and routes](#5-pages-and-routes) · 6 [API endpoints](#6-api-endpoints) · 7 [Permissions](#7-permissions) ·
8 [Visibility propagation](#8-visibility-propagation) · 9 [Localization](#9-localization) · 10 [Search](#10-search) ·
11 [Admin integration](#11-admin-integration) · 12 [Audit behavior](#12-audit-behavior) · 13 [Security](#13-security) ·
14 [Tests](#14-tests) · 15 [Browser coverage](#15-browser-coverage) · 16 [Database and reference integrity](#16-database-and-reference-integrity) ·
17 [Known limitations](#17-known-limitations) · 18 [Deferred work](#18-deferred-work) ·
19 [Existing tests that changed](#19-existing-tests-that-changed) · 20 [Bugs found and fixed](#20-bugs-found-and-fixed) · 21 [Git status](#21-git-status)

---

## 1. Goal

A visitor can open any publication, see who wrote it and what it belongs to, and move from it to every related
record they are allowed to see; and can find publications by year, researcher, project, research area, group and
text, with stable URLs. A manager can maintain a publication's Japanese title/venue from the same form and from the
Phase 17 admin.

**Non-goals** (unchanged from the brief): DOI/ORCID/external synchronisation, citation scraping, grants/funding,
tasks/Kanban, analytics, AI, multi-tenancy, cloud storage, deployment.

## 2. Existing architecture inspected

Before writing code the schema, migrations, routes, permissions, serializers, search, admin CMS, Phase 18 graph,
translation design, file architecture, i18n dictionaries, formatting helpers and every test harness were read.
The facts that shaped the design:

| Question | Finding |
|---|---|
| What is a `Publication`? | `year`, `title`, `authors` (free text), `venue`, `pdfUrl`/`doiUrl`/`extraUrl`/`extraLabel`, `visibility`. **No type, no abstract, no date beyond the year.** |
| Which relations are real? | `PublicationAuthor` (publication ↔ TeamMember) and `ProjectPublication` (publication ↔ ResearchProject). |
| Area / group / news / event ↔ publication? | **None directly.** They exist only through Project (`ProjectArea`, `ResearchProject.groupId`, `NewsItem.projectId`, `Event.projectId`). |
| Is a publication translatable? | Not before this phase (`TRANSLATABLE_FIELDS` had six types). `Translation` is generic (`entityType` is a string), so a seventh needs no migration. |
| Files? | `StoredFile.entityType` already lists `PUBLICATION` and `canAccessFile` already resolves its parent's visibility, **but no upload/attach route accepts an `entityType`** (`/api/files` is standalone only). |
| Existing audit | `PUBLICATION_CREATED/UPDATED/DELETED/AUTHORS_CHANGED`, `PROJECT_PUBLICATIONS_CHANGED`, `CONTENT_VISIBILITY_CHANGED`, `TRANSLATIONS_CHANGED`. Nothing new was needed. |
| Existing surfaces that already list publications | Project, research-area, group, researcher pages and Home (all through `PublicationItem`). |

Consequences: **no migration is required** for anything this phase delivers. Two things the brief lists "where
supported" are *not* supported and were **not** invented: a publication **type** and an **abstract/description**
(both would need new columns), and **attachments** (no attach path). See §17–§18.

## 3. Publication architecture

```
apps/server/src/lib/publicationHub.ts        browsePublications(), loadPublicationDetail()   (reads only)
apps/server/src/lib/researchGraph.ts         localizedPublications(), loadProjectNewsAndEvents() (shared with Phase 18)
apps/server/src/routes/publications.routes.ts  list · /browse · /:id · authors · create · update · delete
packages/shared/src/schemas/publication.ts   schemas, the browse query, PublicationDetail / PublicationListResponse
apps/web/src/pages/PublicationsPage.tsx      the hub (URL is the source of truth)
apps/web/src/pages/PublicationDetailPage.tsx the detail page
apps/web/src/components/PublicationItem.tsx  the compact row (title now links to the detail page)
apps/web/src/components/PublicationFormModal.tsx  grouped fields + Japanese title/venue + English-base guard
```

Design decisions:

1. **One entity.** No second publication table. `PublicationDetail` is the existing `Publication` plus
   read-only relationship lists.
2. **One visibility fragment.** Every read goes through `visibleTo(viewer)` inside its own query (a unit test
   forbids visibility literals, raw SQL, `userId`/`email` in `publicationHub.ts`).
3. **The list endpoint keeps its shape.** `GET /api/publications` is still the plain, newest-first array (used by
   the Home page and the "link publications" pickers). The hub uses the new `GET /api/publications/browse`
   envelope, so no existing caller changed.
4. **Deterministic order.** Every sort ends in `id`; paging is `skip/take` on that total order.
5. **The URL is the state.** Filters, sort and page live in the query string; malformed values are dropped by the
   page (with a polite notice) and rejected with `400` by the API, never silently coerced.

## 4. Relationship model

| Relationship | Kind | Source of truth |
|---|---|---|
| Publication → Researchers | **direct** | `PublicationAuthor` (public profile card only: id, name, initials, role) |
| Publication → Projects | **direct** | `ProjectPublication`, filtered to projects the viewer may see |
| Publication → Research areas | **derived through its visible projects** | `ProjectArea`, area itself must be visible |
| Publication → Groups | **derived through its visible projects** | `ResearchProject.groupId`, group itself must be visible |
| Publication → News / Events | **derived through its visible projects** | `NewsItem.projectId` / `Event.projectId`, each row's own visibility; capped at 6 |
| Publication → Files | *not supported* | deferred (§18) |

"Derived" is stated on the page itself ("Research areas, groups, news and events come from the projects this
publication belongs to"). No `ResearchAreaPublication` or `GroupPublication` relation was created.

The reverse directions were already in place from Phase 18 and now link to the detail page:

```
Research area  → projects · researchers · publications (through visible projects)
Project        → publications ("Research outputs")
Group          → projects · publications (through visible projects)
Researcher     → publications
Publication    → researchers · projects · areas · groups · news · events
```

## 5. Pages and routes

| Route | Page | Notes |
|---|---|---|
| `/publications` | hub | `?q&year&researcher&project&area&group&visibility&sort&page` |
| `/publications/:id` | detail | breadcrumb, one `h1`, tab title = the title, loading / error / not-found states |
| `/projects/:id` | project | section renamed **Research outputs (n)**, rows link to the detail page |
| `/research/:id`, `/groups/:id`, `/team/:id`, `/` | unchanged layout | rows now link to the detail page; titles/venues localized |

Hub: labelled filter form (`role=form`, every control has a real `<label>`), result count announced with
`role=status`, year headings under date sorts (a flat A–Z list under `sort=title`), a labelled pager
(`Previous`/`Next` are real links with `rel`), empty states (no publications / no match / page past the end with a
"Back to the first page" link), an "ignored filters" notice for malformed URLs. `visibility` is offered to
managers only.

Detail: a hidden publication, an unknown id and a malformed id render the **same** not-found state (no title,
breadcrumb or tab title of a hidden record; the API returns identical 404 bodies).

## 6. API endpoints

| Method + path | Who | Behaviour |
|---|---|---|
| `GET /api/publications` | public | plain array, newest first, localized, viewer-scoped |
| `GET /api/publications/browse` | public | `{ items, total, page, limit, pageCount, years }`; filters `q year researcher project area group visibility sort page limit`; 400 on any malformed value; `visibility` filter → 403 unless manager/admin |
| `GET /api/publications/:id` | public | `PublicationDetail` (§4) or the same 404 for hidden/missing, 400 for a malformed id |
| `GET /api/publications/:id/authors` | public | unchanged |
| `PUT /api/publications/:id/authors` | signed in | unchanged (a member may only add/remove *themself*) |
| `POST /api/publications` | signed in | now accepts `translations: { ja: { title, venue } }` |
| `PUT /api/publications/:id` | signed in | now accepts `translations`; `visibility` still managers-only (403) |
| `DELETE /api/publications/:id` | manager/admin | now also removes the publication's `Translation` rows |
| `GET /api/translations/PUBLICATION/:id` | signed in | `{ ja, base }` — `base` is the English text (see §9) |
| `GET/PUT /api/admin/…` | manager/admin | `publication` content type gained translation state; `PUBLICATION` in the translations view |

Filter semantics: `year` exact; `researcher` = linked author; `project`, `area`, `group` require **one visible
linked project** satisfying all project-side filters at once (and a visible area/group); `q` = words AND-ed across
title/authors/venue/linked researcher names (+ year for a 4-digit word, + Japanese overrides when `X-Locale: ja`).
`%` and `_` are word separators, exactly as in global search.

## 7. Permissions

Nothing about the role hierarchy changed (`ADMIN > LAB_MANAGER > MEMBER`; guests public only). No new permission
function was needed: the detail's `canEdit`/`canDelete` are computed **on the server** from the existing central
`canEditContent` (any signed-in account, the reference's rule) and `canDeleteContent` (managers), and the web reads
them through `usePolicy().canEditContent`. There is no role string in React and none in the new server code (a unit
test scans both). Every write endpoint enforces its rule server-side; hiding a button is only a courtesy.

- Guest: public rows only; no visibility filter; no writes (401).
- Member: LAB_ONLY rows; may create/edit; may not delete (403) or send `visibility` (403); may only add/remove
  *themself* as an author.
- Manager/admin: everything above plus `visibility`, delete, any author set, the admin views.
- Only ADMIN manages accounts/roles; nobody changes their own role; managers reach no messages/notifications.

## 8. Visibility propagation

A hidden record can appear through no related surface; counts are the length of an already-filtered list.

| Hidden thing | Publication detail | Hub / filters / years | Project page | Area page | Group page | Researcher page | Search |
|---|---|---|---|---|---|---|---|
| the publication | 404 | absent, uncounted, its year absent from the facet | absent | absent | absent | absent | absent |
| a project | absent from `projects`; its area/group/news/events not reached through it | a filter on it matches nothing (same as an unknown id) | 404 | its publications do not roll up | its publications do not roll up | absent | (entities match by their own columns) |
| a research area | absent from `areas` | area filter matches nothing | not listed | 404 | not listed | not listed | absent |
| a group | absent from `groups` | group filter matches nothing | not shown | — | 404 | not listed | absent |
| a news item / event | absent | — | absent | absent | absent | absent | absent |

A public publication whose only project is hidden stays visible by **its own** visibility (search and the hub
match an entity by its own columns) but shows no project, area or group.

## 9. Localization

- `PUBLICATION: ["title", "venue"]` joined `TRANSLATABLE_FIELDS` (authors, links, year and visibility are never
  translated). `Translation` rows are written in the create/update transaction and deleted with the publication.
- Localized everywhere a publication is rendered: list, browse, detail, project, area, group, researcher and Home
  (one batched lookup per response, none for English). Related project/area/group titles on the detail page use
  the Phase 18 `loadRefTranslations`/`pick`.
- ~55 UI keys (`publications.hub.*`, `publications.detail.*`, `publications.form.*`, `adm.field.venue`,
  `adm.tr.type.PUBLICATION`) in `en.ts` and `ja.ts`; the `ja` dictionary is typed against the English keys.
  Section headings, breadcrumbs, filters, sort options, empty states, notices and dialogs all go through `t()`;
  counts use `Intl.NumberFormat` via `formatNumber`.
- **The English-base guard.** The publication form applies the Phase 18 pattern: in a Japanese session the page's
  `title`/`venue` are already the Japanese overrides, so the English inputs are refilled from
  `GET /api/translations/PUBLICATION/:id` (`base`) before saving. Tested at the API (a translations-only update and
  an update sent from a `ja` session never change the English columns) and in a real browser (manager edits in
  Japanese; English unchanged).
- Locale never affects authorization: `X-Locale` is validated (`en`/`ja`, anything else → English) and only
  selects text. Tested for `en`, `ja`, `xx`, empty, `JA`, an injection string, a 500-character value and no header.

## 10. Search

The existing `publication` source now links to `/publications/:id` and is `translatable: "PUBLICATION"`, so a
Japanese title/venue override is matched (and shown) for `X-Locale: ja`, ranked no higher than tier 2, and ANDed
with the same `visibleTo` as every other match. Parser, tiers, paging and the visibility base are untouched; no
FTS5. A hidden publication is absent from results, counts and its Japanese text is not searchable by guests.

## 11. Admin integration

The Phase 17 admin was extended, not duplicated: the `publication` content adapter now carries
`entity: "PUBLICATION"`, so the content browser's **translated / untranslated** filter, the record detail's
translation state and the **Translations** view (title + venue, 500-character caps, audit) work for publications.
Rows link to `/publications/:id`, where Edit / Manage authors / Delete live under the same policy. Bulk
visibility (all-or-nothing) was already supported. Managers/admins receive only what the existing admin routes
already gave them; nothing for messages or notifications.

## 12. Audit behavior

Existing actions were reused: `PUBLICATION_CREATED/UPDATED/DELETED`, `PUBLICATION_AUTHORS_CHANGED`,
`CONTENT_VISIBILITY_CHANGED`, and the existing `TRANSLATIONS_CHANGED` for Japanese changes made from the
publication's own create/update (field NAMES and the locale only, one row only when something changed). No new
action. Titles are recorded as before (short, English); no abstract exists, no translated text, no file contents,
no message content. The audit tripwire still refuses content-style keys.

## 13. Security

Covered by `publication-regression.mjs`, `unit-publication.test.ts` and the browser section: hidden-ID enumeration
(identical 404 bodies for hidden/missing, identical empty answers for a hidden/unknown filter id), malformed ids
(400), unauthorized edit/delete/author changes (401/403), visibility escalation (403, no partial write), the
manager-only visibility filter (403 for guests **and** members, so it cannot reveal which rows are LAB_ONLY), XSS
in title/authors/venue/Japanese overrides (stored verbatim, served as JSON, rendered as inert text on the list,
detail, project, researcher, area, group, search and Home pages — no injected element, no script ran),
long/unbroken strings, `javascript:`/`data:` link URLs (400), deleted accounts and profiles, invalid pagination and
filter values, locale manipulation, search leakage, and account-id/e-mail scans of every response body.

## 14. Tests

| Suite | Command | Result |
|---|---|---|
| Unit (policy 358, search 64, messages 34, files 64, i18n 38, events 105, admin 49, research 43, **publication 63**) | `npm run test:unit` | 818 checks, 0 failed |
| **Phase 19 API** | `npm run test:publication` (`scripts/publication-regression.mjs`, DB copy only) | 194 checks |
| Phase 19 unit | `scripts/unit-publication.test.ts` | 63 checks |
| Existing API suites | `test:api` 559 · `test:search` 220 · `test:forum` 90 · `test:messages` 73 · `test:files` 51 · `test:gallery` 44 · `test:events` 218 · `test:admin` 290 · `test:research` 184 · `test:i18n` 36 · `test:locale-independence` 46 | all green |
| Search cost | `test:search-cost` (DB copy) | 10 checks |
| Browser | whole suite, all nine widths, EN + JA | 13,823 checks; 4 failures, all understood and fixed (§20), targeted re-run green |
| Browser, Phase 19 only | `ONLY_PUBS=1` at all nine widths, EN + JA, after the CSS fix | 1,586 checks, 0 failed |
| Mutation | 28 server + 13 web mutants | all 41 killed (one server mutant initially survived; test strengthened, §20) |

## 15. Browser coverage

`ONLY_PUBS=1` runs the "publications …" steps: seed; guest hub (filters, sorts, paging, URL state, invalid
parameters, hidden/unknown filter ids, keyboard/focus ring); guest detail (relationships, hidden/unknown/malformed
not-found, real-click navigation project → area → group → researcher → back); member (edit dialog, fieldsets,
Escape/focus return, create with a Japanese override); manager (visibility filter, the Japanese-edit regression,
English edit keeps Japanese, manage authors + audit, delete with confirmation); search + admin; Japanese; hostile
text; and a sweep at all nine widths (390 412 768 900 1024 1280 1366 1440 1920) × EN/JA × guest/member/manager
with the shared responsive/accessibility audit, dialog checks and Tab-walks.

Result: the first whole-suite run (13,823 checks) had 4 failures — two legacy assertions that legitimately changed
(the project page's section is now "Research outputs"; the admin Translations view has seven type chips), one real
finding (a wrapped, inline title link is not hit-testable at its bounding-box centre, so the guest Home keyboard
walk at 768 px reported "covered by h3.pub-item__title"; fixed by making `.pub-item__link` `inline-block`), and
nothing else. The Phase 18 research section reported no failure inside the whole run.

## 16. Database and reference integrity

Captured before implementation and re-checked after (see the final report): `dev.db` SHA-256
`70d2f21d…62dc`, integrity_check `ok`, foreign_key_check empty, row counts unchanged; `schema.prisma` and
`migrations/` unchanged; `Lab-Website/reference` tree hash `29036afe…0d27`. Every mutating test ran on a copy.

## 17. Known limitations

- **No publication type and no abstract.** The brief's type badge/filter and abstract are unsupported by the
  schema and were not invented; the detail page shows year, authors, venue and links.
- **Publication ↔ project links are edited from the project page** (`PUT /api/projects/:id/publications`, existing).
  There is no publication-side project picker.
- Related news/events on a publication are "from its projects", capped at six each.
- `sort=title` orders by the English title in every locale (deterministic, locale-independent).
- The researcher page lists a researcher's publications without a per-row project chip (the detail page shows it).
- Zod validation messages remain English in both locales (the existing, disclosed Phase 14/15 limitation).
- `POST/PUT` responses return the English row regardless of `X-Locale`, as before; pages reload after saving.

## 18. Deferred work

- Publication **type**, **abstract/description**, an explicit **publication date**: each needs a column
  (`Publication.type`, `Publication.abstract`, …). *Would need a migration; not approved, not applied.*
- Publication **attachments**: needs an attach route that accepts `entityType`/`entityId` (the read-side access
  rule already exists in `canAccessFile`). Gallery was deliberately not turned into a document store.
- A publication-side "link to project" control; a per-row project chip on the researcher page.
- DOI/ORCID/external sync, citation counts, BibTeX export.

## 19. Existing tests that changed

Each is a consequence of the intended change, none was weakened:

- `unit-i18n.test.ts`: the allow-list now has seven types (adds `PUBLICATION`).
- `unit-admin.test.ts`: `translation` is now a valid filter for `publication` (it was the only "not translatable"
  example; all seven content types are translatable now), so the negative case was replaced by a positive one; the
  text-search builder test stubs `entity` off so it still needs no database.
- `admin-regression.mjs`: removed the "translation on publication → 400" row (now valid; covered positively in
  `publication-regression.mjs`).
- `unit-research.test.ts`: the fake row for `getEntityBase` gained `venue`.
- `search-regression.mjs` and `browser-regression.cjs`: a publication's search `href` is `/publications/:id`.
- `browser-regression.cjs`: the empty-list fake returns the `/browse` envelope; the Phase 10.5 "L." publications
  check now drives the year `<select>` + Apply instead of year chips; the network-error watcher allows the
  deliberate 400/404/401/403 publication probes; `ONLY_PUBS` was added.

## 20. Bugs found and fixed

- **Empty-page dead end.** `?page=999` showed an empty state with no way back (found by the browser suite); the
  empty state now offers "Back to the first page".
- **Wrapped title link not hit-testable.** The shared Tab-walk found the publication title link "covered" by its own
  `h3` at 768 px when the title wrapped to two lines (an inline box's centre can fall in the gap between lines).
  Fixed in CSS (`display: inline-block`), re-verified at all nine widths.
- **Weak audit assertion.** A mutant that removed the publication route's own translation audit survived because
  the admin route writes the same action; the test now requires the route's own rows for a specific record.
- **Same defect class as Phase 18**, avoided by construction: the publication form takes the English base from
  `GET /api/translations/PUBLICATION/:id` rather than from the localized page.
- (Phase 18 disclosed that the News/TeamMember/Event forms still prefilled English inputs with the Japanese
  override; the Phase 18 browser section covers them and was re-run green.)

## 21. Git status

Nothing was committed, pushed or deployed; Phase 20 was not started. See the final report for `git status`.
