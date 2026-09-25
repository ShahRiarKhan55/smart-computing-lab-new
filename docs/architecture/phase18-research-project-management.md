# Phase 18 — Advanced Research & Project Management

Phase 18 makes the lab's research structure understandable and navigable:

```
Research Areas ─▶ Projects ─▶ Groups ─▶ Researchers
        └────────── Publications · News · Events · Gallery (through projects) ──────────┘
```

It is a **read-model and navigation phase built on tables that already existed**. Phase 8 created every
relationship this phase needs; Phase 18 gives them public detail pages, cross-links, the one missing write
path (Researcher ↔ Research area), and locale-correct, visibility-correct related titles. It adds **no table,
no column, no migration, no role and no visibility state**.

Contents: 1 [Goals and non-goals](#1-goals-and-non-goals) · 2 [Research architecture](#2-research-architecture) ·
3 [Entities and relationships](#3-entities-and-relationships) · 4 [API](#4-api) · 5 [Public pages](#5-public-pages) ·
6 [Forms and translation editing](#6-forms-and-translation-editing) · 7 [Admin integration](#7-admin-integration) ·
8 [Permissions](#8-permissions) · 9 [Visibility propagation](#9-visibility-propagation) · 10 [Localization](#10-localization) ·
11 [Search](#11-search) · 12 [Audit](#12-audit) · 13 [Security](#13-security) · 14 [Accessibility](#14-accessibility) ·
15 [Responsive behaviour](#15-responsive-behaviour) · 16 [Database impact](#16-database-impact) · 17 [Testing](#17-testing) ·
18 [Existing tests that changed](#18-existing-tests-that-changed) · 19 [Bugs found and fixed](#19-bugs-found-and-fixed) ·
20 [Known limitations](#20-known-limitations) · 21 [Explicitly deferred](#21-explicitly-deferred)

---

## 1. Goals and non-goals

**Goals.** A visitor can start at any research entity and reach every related one they are allowed to see:

| From | To |
|---|---|
| Research area | projects · researchers · publications · news · events |
| Project | area(s) · lead · members · group · publications · news · events · gallery · forum topics |
| Group | lead · members · projects · research areas · publications · news · events |
| Researcher | research areas · projects · groups · publications · news · events |

A manager can maintain the structure (areas, projects, groups, leads, memberships, visibility, Japanese text)
from the same pages and the Phase 17 admin.

**Non-goals** (unchanged from the brief): grants/funding, budgets, task boards, CV generation, ORCID/DOI sync,
external publication APIs, AI features, RSVP, analytics, deployment.

## 2. Research architecture

The graph is stored exactly as Phase 8 designed it (`schema.prisma`, "Research domain"):

```
ResearchArea ──< ProjectArea >── ResearchProject >── ResearchGroup (groupId, N:1)
      └───────< ResearcherArea >── TeamMember ──< ProjectMember (LEAD|MEMBER|COLLABORATOR)
                                        └───────< GroupMember   (LEAD|MEMBER)
ResearchProject ──< ProjectPublication >── Publication ──< PublicationAuthor >── TeamMember
ResearchProject ──< NewsItem (projectId)      ──< NewsAuthor >── TeamMember
ResearchProject ──< Event (projectId)         Event.createdById → User → TeamMember (organizer)
ResearchProject ──< GalleryItem (projectId)   ──< ForumPost (projectId)
```

Design decisions:

1. **One visibility fragment.** Every related row is read through `visibleTo(viewer)` *inside its own query*
   (`apps/server/src/lib/researchGraph.ts` never spells a visibility literal — a unit test enforces it). Counts
   are `list.length` of an already-filtered list, so a hidden record cannot be counted, named or linked.
2. **Derived, not invented.** The schema links publications, news, events and gallery items to a **Project**, not
   to an Area or a Group. So an area's or group's publications/news/events are those of its **visible projects**,
   and the pages say so ("…belong to the projects listed above"). No relationship was fabricated from text.
3. **Related titles are localized.** `loadRefTranslations()` batches the Japanese overrides for the areas, projects
   and groups a page names (one query per entity type, none for English), and `pick()` falls back to English.
4. **Locale never selects rows.** `X-Locale` only chooses which language's text comes back.

## 3. Entities and relationships

| Relationship | Table / column | Read path (visible only) | Write path | Who may write |
|---|---|---|---|---|
| Project → areas | `ProjectArea` | project + area + member pages | `PUT /api/projects/:id/areas` | manager, project lead (Phase 9) |
| Project → members, **lead** | `ProjectMember.role` | project, profile, area pages | `PUT /api/projects/:id/members` | manager, project lead |
| Project → group | `ResearchProject.groupId` | project + group pages | `PUT /api/projects/:id` (`groupId`) | **manager only** |
| Project → publications | `ProjectPublication` | project, area, group pages | `PUT /api/projects/:id/publications` | manager, lead |
| Project → news | `NewsItem.projectId` | project, area, group pages | `PUT /api/projects/:id/news` | manager, lead |
| Project → events | `Event.projectId` | project, area, group, profile | `POST/PUT /api/events` (`projectId`) | **manager only** (Phase 16) |
| Project → gallery | `GalleryItem.projectId` | project page (Phase 13 endpoint) | gallery routes | owner / manager |
| Group → members, **lead** | `GroupMember.role` | group + profile pages | `PUT /api/groups/:id/members` | manager, group lead |
| Researcher → areas | `ResearcherArea` | profile + area pages | **new** `PUT /api/member/:id/areas` and `PUT /api/research/:id/researchers` | see §8 |
| Researcher → publications / news | `PublicationAuthor` / `NewsAuthor` | profile | Phase 8/9 routes | owner / manager |

**Project status** already exists (`ResearchProject.status`: PLANNED · ACTIVE · COMPLETED · ARCHIVED — a research
lifecycle, deliberately *not* visibility). It is now shown consistently (`StatusBadge`) on every project card,
including the ones on the new area and group pages; the Projects page keeps its status filter. No field was added.

**Relationships that do not exist and were not invented** (see §20): Event ↔ Area, Event ↔ Group, Publication ↔ Area,
Publication ↔ Group, News ↔ Area, News ↔ Group (all are reachable *through a project*), and researcher visibility.

## 4. API

New / changed responses (all under `/api`, all use `optionalAuth` and `Vary: Cookie`):

| Endpoint | Change |
|---|---|
| `GET /research/:id` | now the **area detail**: `projects[]` (id, slug, title, summary, status), `researchers[]` (public profile id, name, initials, title), `publications[]`, `news[]`, `events[]`, plus `canEdit`, `canDelete`, `canManageResearchers`. The list `GET /research` and the POST/PUT bodies are unchanged. |
| `PUT /research/:id/researchers` | **new.** `{ teamMemberIds }` replaces the set (managers). Existence-checked (400 with a specific message), duplicate-checked, audited only when something changed. |
| `PUT /member/:id/areas` | **new.** `{ areaIds }` replaces the set (owner or manager, same guard as the profile's publication/news links). |
| `GET /projects/:id` | adds `events[]` (visible ones); area chips, group name and news are now localized. |
| `GET /projects` | area chips and group name localized (batched). |
| `GET /groups/:id` | adds `areas[]`, `publications[]`, `news[]`, `events[]` (all through the group's **visible** projects); project titles localized. |
| `GET /member/:id` | adds `areas[]` and `events[]` (events they organised + events of their visible projects); project, group, area and news labels localized. |
| `GET /translations/:type/:id` | adds `base` — the entity's own **English** text per allow-listed field (see §6). |
| `GET /search` | research-area results now link to `/research/:id` (§11). |

Response shapes live in `packages/shared` (`ResearchAreaDetail`, `ResearcherRef`, `ProjectBrief`,
`setAreaResearchersSchema`, `setMemberAreasSchema`, and the `events` / `areas` fields on the project, group and
member schemas). Events are typed through `labEventListSchema`, because the web `tsconfig` is not strict and
would otherwise make every inferred field optional.

No response contains an account id, `userId`, email or storage key; relationship lists carry the **public
team-profile id** only. A test scans every new response body for the fixtures' account ids.

## 5. Public pages

| Route | Page | What it answers |
|---|---|---|
| `/research` | `ResearchPage` (card titles now link) | which areas exist |
| `/research/:id` | **`ResearchAreaDetailPage`** (new) | projects · researchers · publications · news · events of an area |
| `/projects/:id` | `ProjectDetailPage` | what, who leads, who works on it, which areas, output, events, gallery, discussion |
| `/groups/:id` | `GroupDetailPage` | who leads/belongs, which projects, which areas, output |
| `/team/:id` | `MemberPage` | areas, projects, groups, publications, news, events |
| Home | area titles link to their pages | |

One information architecture: `PageHeader` (one `<h1>`, breadcrumb ending at the record, `aria-current="page"`,
tab title from the localized title) → optional `AdminBar` (only when the server says the viewer may edit) →
`detail-meta` (badges) → `detail-layout` (main sections + an aside `panel`) → `SectionHeader` sections with the
visible count in the heading. Empty and error states use `EmptyState` / `ErrorState`; a hidden or missing record is the
same not-found page ("doesn't exist, or you don't have access") with a way back, and its title/breadcrumb never
name the hidden record.

New components: `RelatedOutputs` (publications / news / events sections shared by the area and group pages).
Reused: `PageHeader`, `SectionHeader`, `Card`s, `Badge`/`StatusBadge`, `PersonLink`, `EmptyState`, `Modal`,
`LinkItemsModal`, `ConfirmDeleteModal`, `EventCard`, `NewsCard`, `PublicationItem`, `ProjectCard`.

Cross-links (all real `<a>` elements, so keyboard-reachable and never hover-only): area card → area; area →
project → area chip → area; area/project/group → person → profile → area chip → area; project → group;
group → area chip; search result → area; Home → area. A link exists only for a record the API returned.

Project page details: a **Project lead** panel (the `LEAD` member(s), or "No lead assigned yet"), a **Team** panel
listing the *other* members (the lead is not repeated), area chips that link to the area, an **Events** section.

Long Japanese titles and unbroken strings wrap (`overflow-wrap: anywhere` on `.tag` / `.person`, the existing rules
on cards and headings); the sweep verifies no horizontal overflow at all nine widths.

## 6. Forms and translation editing

Forms are the existing ones (`ResearchFormModal`, `ProjectFormModal`, `GroupFormModal`) — English fields, a
"Japanese translation" section (the Phase 14 `useEntityTranslations` pattern; no second translation system),
visibility only for managers, validation with the shared zod schemas on the client and again on the server.
Authorization never depends on the locale (tested: a member sending `visibility` under `X-Locale: ja` is still 403).

**A pre-existing data-corruption bug was found and fixed for these three forms.** A page fetched in Japanese
already carries the Japanese override in `title`/`description`; the edit form prefilled its *English* inputs from that
response, so saving anything overwrote the English column with Japanese. Fix: `GET /api/translations/:type/:id` now
also returns `base` (the entity's own English text, selected through the same allow-list as the overrides, and
covered by a unit test that the `select` is *exactly* the allow-listed fields), and the three forms replace the
prefill with it when it arrives. The identical defect exists in the News, Team-member and Event forms (completed
phases, outside this phase's brief) — see §20.

## 7. Admin integration

There is **no second admin interface**. The Phase 17 content browser already lists research areas, projects and
groups with visibility, status, Japanese-override coverage, filters, pagination, the record dialog (relation
counts) and bulk visibility, all audited. Phase 18's integration:

* the record dialog's "Open page" link for a research area now goes to `/research/:id` (it was the list), so the
  page that manages the area's researchers is one click away; project and group links were already detail pages;
* relationship counts (projects, researchers, members, areas, publications, news, events, gallery, groups) were
  already there and are unchanged — they are manager-only, so counting hidden rows is correct there;
* translation editing and visibility stay in the Phase 17 translations and bulk views;
* every relationship change (area researchers, profile areas, project/group members, leads) is in the audit viewer
  through the existing action labels.

## 8. Permissions

Central helpers only (`packages/shared/src/permissions.ts`); no inline role checks in routes (a unit test scans
the four touched route files). One new helper: `canLinkResearchersToArea = isManager`.

| Action | Guest | MEMBER | Project/group LEAD | LAB_MANAGER | ADMIN |
|---|---|---|---|---|---|
| Read PUBLIC structure | ✔ | ✔ | ✔ | ✔ | ✔ |
| Read LAB_ONLY structure | ✘ (404) | ✔ | ✔ | ✔ | ✔ |
| Create / edit a research area (existing "reference" rule) | ✘ | ✔ (no visibility) | ✔ | ✔ + visibility | ✔ + visibility |
| Delete a research area | ✘ | ✘ | ✘ | ✔ | ✔ |
| Set an **area's researchers** (new) | ✘ 401 | ✘ 403 | ✘ 403 | ✔ | ✔ |
| Set **own** research areas (new) | ✘ | ✔ own profile | ✔ own | ✔ any | ✔ any |
| Edit project content, members, **lead**, areas, publications, news | ✘ | ✘ | ✔ their project | ✔ | ✔ |
| Project slug / sort / **group** / visibility | ✘ | ✘ | ✘ (403) | ✔ | ✔ |
| Edit group content, members, lead | ✘ | ✘ | ✔ their group | ✔ | ✔ |
| Delete project / group | ✘ | ✘ | ✘ | ✔ | ✔ |
| Link an event to a project | ✘ | ✘ | ✘ | ✔ | ✔ |
| Change a role | ✘ | ✘ | ✘ | ✘ (403) | ✔ (never own) |

Nobody can elevate themselves, change their own role, read other people's messages or notifications, or reach
hidden content through a relationship endpoint (all tested). `canEdit` / `canDelete` / `canManageResearchers`
on responses are UX hints computed by the server with the same functions; every write is re-checked.

## 9. Visibility propagation

The rule: **a related record appears only if the viewer may see *that record*, and only through a parent the viewer
may see.** Implemented by filtering in the query, never after.

| Scenario | Result (tested at API and browser level) |
|---|---|
| PUBLIC project linked to a LAB_ONLY **area** | guest sees the project; the area's title/id/icon are absent from the project (list and detail) |
| PUBLIC project in a LAB_ONLY **group** | project detail says `group: null`; the group's name never appears |
| LAB_ONLY **project** linked to a PUBLIC publication/news/event | guest gets 404 for the project; the publication/news/event responses carry no project reference; a hidden project's outputs do **not** roll up into its area or group pages |
| PUBLIC event whose project is hidden | the event is public by its own visibility (Phase 16); its `project` is `null` (title never sent) |
| LAB_ONLY publication/news/event on a PUBLIC project | absent from the project, area, group and profile pages for guests, present for signed-in users |
| Counts (headings, `projectCount`, search totals) | computed from filtered lists; hidden rows are never counted |
| Researchers | `TeamMember` has **no visibility column** — profiles are public by design (the Team page is public), so "PUBLIC project linked to a LAB_ONLY researcher" cannot exist. Documented, not worked around |
| Hidden id / missing id | byte-identical 404 bodies (ID enumeration), malformed id 400 |
| Locale | identical status and identical relationship ids for missing / `en` / `ja` / invalid `X-Locale` |

Search results, cards, breadcrumbs, document titles and API errors are covered by tests for the same rule.

## 10. Localization

Everything added supports EN and JA: `rs.*` keys (39) in `packages/shared/src/i18n/{en,ja}.ts` (headings with
counts, empty states, dialogs, notes, ARIA labels), no new hard-coded strings, `Intl`-based dates through the
existing `format.ts`. Domain content follows the Phase 14 model: English in the entity's own columns, Japanese in
`Translation`. New in this phase: related **project / area / group / news titles are localized** wherever they
appear on the new or touched pages (they were English-only on the project, group and profile pages before). Enum
labels still go through `*_LABEL_KEY` maps. The search CTA for a research-area result now reads "View research
area" (`研究分野を見る` already). Per-field zod validation messages remain English (disclosed since Phase 14).

## 11. Search

No engine change. The research-area source's `href` is now `/research/:id`. Everything else is inherited and
re-verified: visibility through `visibleTo` as the base of each source, results matched by an entity's **own**
columns only (so a public publication is findable even if its project is hidden, and no relationship is ever
searched or returned), Japanese overrides matched for `X-Locale: ja`, deterministic ordering, pagination. Tests run
guest/member search with missing, `en`, `ja` and invalid locales and assert identical result ids.

## 12. Audit

Existing conventions; only names, ids and counts; no translation values, messages, passwords or tokens (the
tripwire in `recordAudit` rejects forbidden keys, and a test proves it).

| Change | Action (existing) | Entity | New details |
|---|---|---|---|
| Area / project / group created, updated, deleted | `RESEARCH_*`, `PROJECT_*`, `GROUP_*` | area / project / group | unchanged |
| Visibility | `CONTENT_VISIBILITY_CHANGED` | same | unchanged |
| Project or group **membership / lead change** | `PROJECT_MEMBERS_CHANGED`, `GROUP_MEMBERS_CHANGED` | project / group | **`leadChanged`** (bool) and **`leads`** (ids after the change) added |
| **Area's researchers** changed | `MEMBER_LINKS_CHANGED` (reused) | `RESEARCH_AREA` | `kind: "researchers"`, `added`, `removed` |
| **A researcher's areas** changed | `MEMBER_LINKS_CHANGED` (reused) | `TEAM_MEMBER` | `kind: "area"`, `added`, `removed` |

No new audit action was created. An unchanged replace writes no row.

## 13. Security

Dedicated tests cover: guest/member/lead/manager/admin, hidden entity access, relationship leakage, ID enumeration,
malformed and oversized ids, privilege escalation (settings, role, area researchers, other people's profile areas),
self-role change, XSS (title/description/tag rendered as text — no injected `<img>`/`<script>`/`<b>`, `window.__x`
never set), 300-character and 190-character unbroken strings, Japanese content, invalid JSON, invalid/duplicate/
unknown relationship ids (asserting *our* message, not the generic foreign-key fallback), locale independence,
deleted accounts (relations are to the *profile*; the project, its lead entry and its events survive) and deleted
projects/groups/areas (they vanish from every relationship list, translations are deleted with them).

## 14. Accessibility

Verified in the rendered DOM at all widths and both languages: one `<h1>` and one `<main>`; breadcrumb `<nav>`
with `aria-current="page"`; every control has an accessible name (also in Japanese — no untranslated ARIA text);
no raw translation keys (the detector now knows the `rs.` prefix); dialogs are `role="dialog"` + `aria-modal`, named,
trap Tab/Shift+Tab, close on Escape and return focus to the opener (`p15Dialog` on the edit-area, researchers,
delete, own-areas and admin record dialogs); a Tab walk on the area, project and own-profile pages at 390/768/1280
checks every stop is visible, named, ringed and uncovered; relationship cards are links (the focus ring is drawn on the
card by the existing `.card:has(a:focus-visible)` rule); nothing is hover-only.

## 15. Responsive behaviour

The browser sweep loads each page at 390, 412, 768, 900, 1024, 1280, 1366, 1440 and 1920 px in EN and JA as
guest, member, manager and admin, and fails on horizontal page overflow, clipped or spilling text, overlapping
controls, unnamed controls or raw keys. Long Japanese titles, a 90-character unbroken area title and a
220-character unbroken description are part of the fixtures. A CSS mutant that removes the wrapping rule is caught.

## 16. Database impact

**None.** No schema change, no migration, no data written to `dev.db` by any test (all suites run on copies).
Verified: `prisma validate` OK; `prisma migrate diff --from-url <copy> --to-schema-datamodel schema.prisma --exit-code`
= 0 (no drift); `git status` shows no change under `apps/server/prisma`; the real `dev.db` sha256 is unchanged
(`70d2f21d…62dc`), `PRAGMA integrity_check` = ok, `foreign_key_check` = empty, row counts identical; the
`Lab-Website/` reference tree hash is unchanged (`29036afe…0d27`, 27 files).

## 17. Testing

| Suite | Result |
|---|---|
| `npm run test:unit -w apps/server` — policy 358, search 64, messages 34, files 64, i18n 36, events 105, admin 49, **research 43 (new)** = 753 | all pass |
| `npm run test:research` (`research-regression.mjs`, **165 checks**, new) | all pass |
| Legacy API suites: api 559, search 220, forum 90, messages 73, files 51, gallery 44, events 218, admin 291, i18n 36, locale-independence 46, search-cost 10 | all pass (fresh DB copy each) |
| Browser `ONLY_RESEARCH=1` (**1,869 checks** new: 9 widths × EN/JA × guest/member/manager/admin, dialogs, keyboard, hostile text) | all pass |
| Whole browser suite, all nine widths, EN + JA (all phases) | 12,192 passed; 2 legacy assertions failed and were updated for this phase's legitimate changes (§18), re-verified 91/91 |
| Mutation testing | **22/22 server** and **12/12 web** mutants killed (two survivors/weak spots found and fixed, below) |

`unit-research.test.ts`: the new permission and its relation to the existing lead/owner rules, both write schemas
(caps, duplicates, foreign ids, unknown keys dropped), `pick()` fallback, the English-base `select` allow-list,
audit legality and the forbidden-key tripwire, dictionary parity (placeholders, non-empty, actually Japanese), and
static guards (the graph code uses `visibleTo` and no literals/raw SQL/`userId`; every visibility-bearing query
spreads the fragment; routes use the central guards, no inline role checks).

Mutants (server) break, one at a time: a hidden project / area / publication / news / event / profile area / group
area leaking; outputs of a hidden project rolling up; the two write guards; the permission widened to `isMember`;
locale changing authorization; unknown-member acceptance; duplicate acceptance; a missing audit entity id; the lead
change flag; Japanese overrides ignored; the English base missing; search linking to the list; news not localized.
Mutants (web): buttons shown to the wrong roles, chips/cards not linking, the events/publications sections dropped,
the lead repeated, a heading left English, the flags ignored, the base-text fix removed, the wrapping rule removed.

Two weak spots the mutants exposed, both fixed: (1) an "unknown team member" write was rejected by the generic
foreign-key fallback (also a 400), so the check could not tell the real guard from the fallback → the test now
asserts the specific message; (2) a profile of someone belonging to a hidden project was never viewed as a guest →
added.

## 18. Existing tests that changed

Legitimate behaviour changes only; no assertion was weakened.

* `search-regression.mjs`: research-area result href `"/research"` → `` `/research/${id}` `` (the page now exists).
* `api-regression.mjs`: the `GET /member/:id` allow-list of profile fields gained `areas` and `events`.
* `browser-regression.cjs`, Phase 10 search: a research-area result now links to `/research/:id` (was `/research`).
* `browser-regression.cjs`, Phase 10.5 project page: the lead has its own **Project lead** panel and the Team panel lists the *other* members, so the check that "the team panel lists the lead and members" now asserts the lead panel names the lead, the Team panel lists the other members with roles, and the lead is not repeated.
* Browser suite: additions only (a new section, and provoked-error patterns for the new 400/401/403/404 probes).
* Copy: the search CTA for research areas reads "View research area" (no test referenced the old text).

## 19. Bugs found and fixed

1. **English text overwritten by Japanese when editing in the Japanese UI** (pre-existing; §6). Fixed for the area,
   project and group forms; regression-tested through the real dialog in the browser and through the API round trip.
2. **Related titles English-only under `X-Locale: ja`** on the project (areas, group, news), group (projects) and
   profile (projects, groups, news) pages. Fixed with batched overrides.
3. **`GET /research/:id` was only the flat area** — there was no place to see an area's projects/researchers.
4. **`ResearcherArea` had no write path** — the relation existed and was counted by the admin but could not be edited.
5. The lead was shown twice on the project page while adding a lead panel — fixed before release; a mutant guards it.
6. Test-authoring defects caught while building the suites (not product bugs): innerText upper-casing on badges and
   panel titles, the card (not the link) drawing the focus ring, search matching only own columns.

## 20. Known limitations

* **Researchers have no visibility** (`TeamMember` has no such column), so a researcher cannot be hidden from a
  public project; the whole Team page is public by design since Phase 9.
* An area's or group's publications/news/events are **derived through projects**; there is no direct
  Area/Group ↔ Publication/News/Event link and none was invented. Events have `projectId` only.
* Roll-ups are capped at 100 rows per type (`ROLLUP_LIMIT`), so headings show at most 100 for a very large group.
* Project **status** is filtered on the Projects page client-side; there is no `?status=` API filter.
* Project → group assignment stays manager-only, from the project form; the group page has no project picker.
* A project/group **lead may promote or demote other leads** (Phase 9 rule; audited with `leadChanged`).
* Creating/editing a research area remains open to any signed-in member (the reference site's rule, Phase 9).
* **The same English-overwrite defect (§6) still exists in the News, Team-member and Event edit forms.** The fix is
  the same few lines per form (`base` is already returned for those entity types); it was left out because those
  forms belong to completed phases.
* The Phase 16 rule that a PUBLIC event is public even when its project is hidden is unchanged (its project is `null`).
* Per-field zod validation messages are still English in both languages.
* Two `api-regression` runs failed transiently early on (a user-deletion check, then a fixture crash) and did not
  reproduce in the three later runs on the same code; the suite and the server share one SQLite file, so lock contention under load is the
  likely cause. Not investigated further.

## 21. Explicitly deferred

AI research assistant/summaries, citation recommendations, grant/funding/budget management, CV generation,
ORCID/DOI/Google Scholar sync, external publication APIs, time tracking, tasks/Kanban, CRM, multi-tenancy,
analytics dashboards, deployment, cloud storage, RSVP, payments, email campaigns; direct Area/Group ↔ Event links;
researcher visibility; a group-side project picker; a status API filter; fixing the Japanese-prefill defect in the
News, Team-member and Event forms.
