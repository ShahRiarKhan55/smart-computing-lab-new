# Phase 23 — Lab Resources & Reproducibility

Status: implemented, **not committed**. **One additive database migration** (`20260927100000_phase23_lab_resources`:
two `CREATE TABLE` statements and ten `CREATE INDEX` statements). Baseline: `533a3f7`.

## 1. Purpose

Phases 18–22 built the research graph (Area → Project → Group → Researcher, with Publications, News, Events and, in Phase 22,
Knowledge documents). What was still missing is the answer to *"what does it take to reproduce this research?"*: which datasets,
boards, tools, frameworks and environments a piece of work depends on, in which version and configuration.

Phase 23 adds a **structured record of research infrastructure** — a *lab resource* — linked into that graph, and a UI that answers
the reproducibility question from a project, a documentation page or a publication. It is deliberately **not**

* a file manager (a resource holds a link and text, never a file — see §11),
* an inventory or accounting system (no stock, purchasing, budget, reservations, maintenance),
* a second documentation system (long-form text stays in Phase 22 knowledge documents),
* a package manager or anything that installs or runs software,
* a social, task-management or AI feature.

## 2. Schema decision (why a migration was necessary)

Before writing code every existing table was checked. None could hold the requirement:

| Candidate | Why it does not fit |
| --- | --- |
| `KnowledgeDoc` | title / body / 10 categories and one link each to project, area, group, researcher; no version, vendor, URL or identifier; no `FPGA` / `BOARD` / `SENSOR` … types; no link to a publication or an event; and structured data inside `body` would have to be parsed back out of text (not validated, filtered, indexed or searched) |
| `StoredFile` / `GalleryItem` | file metadata only; `StoredFile.entityType` is an allow-list of parents and adding one would change Phase 13's file authorization (out of scope) |
| `Translation` | fits as-is — reused |

So one entity and **one** join table were approved and added, nothing else:

```prisma
model LabResource {
  id, name, resourceType (default OTHER), description, version, vendor, identifier, url, environment,
  metadata (JSON string, nullable), visibility (default LAB_ONLY),
  ownerId?, researchAreaId?, groupId?, knowledgeDocId?, publicationId?, eventId?, teamMemberId?,   // single nullable FKs, ON DELETE SET NULL
  createdAt, updatedAt
  @@index visibility+updatedAt, resourceType, ownerId, researchAreaId, groupId, knowledgeDocId, publicationId, eventId, teamMemberId
}
model ResourceProject {           // the ONLY many-to-many
  resourceId → LabResource (CASCADE), projectId → ResearchProject (CASCADE)
  @@id([resourceId, projectId]) @@index([projectId])
}
```

* **Why `ResourceProject` is a join table:** a tool or dataset ("Vivado", a shared benchmark) serves many projects and a project needs
  many resources — the canonical reproducibility case. With a single foreign key a shared tool would have to be duplicated per project.
  Every *other* link follows the Phases 18–22 rule (one nullable FK, `ON DELETE SET NULL`): deleting a project, area, group, document,
  publication, event, researcher or the owner's account **keeps the resource** and clears the link; deleting a resource or a project
  removes only the `ResourceProject` row.
* **Nothing else changed:** the migration SQL is exactly two `CREATE TABLE` + ten `CREATE INDEX` (verified before it was applied: no
  `ALTER`, `DROP`, `INSERT` or table rebuild). The other `schema.prisma` edits are the required Prisma back-relation lines and the
  `Translation.entityType` comment.
* `resourceType` and `visibility` are plain strings validated by allow-lists in `@scl/shared`, exactly like every other typed column here.
* **`metadata`** is a small JSON string whose keys are allow-listed **per type** (§4). It carries structured reproducibility facts
  without a column per fact; unknown keys are a `400`, and on read only the type's allow-listed keys with text values are ever returned.
* Applying it: tested on a copy of `dev.db` first; then `prisma migrate deploy` on the real database only after approval (results in §16).

## 3. Resource types

`packages/shared/src/schemas/resource.ts` (`RESOURCE_TYPES`), enforced by zod on every write and every filter and routed through
`RESOURCE_TYPE_LABEL_KEY` in `apps/web/src/i18n/labels.ts`:

`DATASET · HARDWARE · SOFTWARE · TOOL · FRAMEWORK · MODEL · FPGA · BOARD · SENSOR · MEASUREMENT_SETUP · EXPERIMENT_ENVIRONMENT · OTHER`

Hostile / unknown / mis-cased values (`dataset`, `'; DROP TABLE …`, `<script>`, `""`, `null`, arrays) are a `400`; a stored value outside the
list is shown as `OTHER`. For the reproducibility panel the types are grouped into four **families** (`RESOURCE_TYPE_FAMILY`):
Hardware (HARDWARE, FPGA, BOARD, SENSOR, MEASUREMENT_SETUP), Software & models (SOFTWARE, TOOL, FRAMEWORK, MODEL), Data (DATASET),
Environment & other (EXPERIMENT_ENVIRONMENT, OTHER).

## 4. Reproducibility model

A resource answers *what, which version, from whom, where, and under what configuration*:

| Field | Meaning | Limit |
| --- | --- | --- |
| `name` | what it is (translatable) | 200, required |
| `resourceType` | one of the twelve | — |
| `description` | what it is for (translatable, plain text) | 5000 |
| `version` | dataset / tool / firmware version | 200 |
| `vendor` | manufacturer or source | 200 |
| `identifier` | model, serial, DOI | 200 |
| `url` | link to the source / download / documentation — **http(s) only** | 2048 |
| `environment` | environment & configuration notes: seeds, settings, versions (translatable, plain text) | 5000 |
| `metadata` | structured details, **allow-listed per type** | 500 per value |
| `knowledgeDocId` | the long-form documentation (Phase 22) | — |

`metadata` keys by type: **DATASET** format, size, license, collectionMethod · **HARDWARE / FPGA / BOARD / SENSOR** hardwareRevision,
firmwareVersion, toolchain · **SOFTWARE / TOOL / FRAMEWORK / EXPERIMENT_ENVIRONMENT** platform, configuration, requirements · **MODEL**
format, license, requirements · **MEASUREMENT_SETUP** measurementConditions, configuration · **OTHER** none. A key that does not belong
to the type is a `400` with the offending keys named; changing the type without restating metadata is refused when the stored
metadata would no longer fit (the form always sends the metadata that fits the chosen type, so it never hits this).

Long free-form procedures are **not** duplicated here: they live in a Phase 22 document linked through `knowledgeDocId`, which the
resource page shows as "Documentation".

## 5. Relationships

`Resource → Project` (many, through `ResourceProject`) `| Research area | Group | Knowledge document | Publication | Event | Researcher`
(all optional, at most one of each). Reads work from the resource's side and from the graph's side with one mechanism —
`GET /api/resources?project=|area=|group=|researcher=|knowledge=|publication=`:

| Page | Section | "View all" |
| --- | --- | --- |
| Project detail | **Resources & reproducibility** panel: ≤ 12 newest, grouped by family | `/resources?project=<id>` |
| Research area detail | Lab resources (≤ 5) | `/resources?area=<id>` |
| Group detail | Lab resources (≤ 5) | `/resources?group=<id>` |
| Researcher detail | Lab resources (≤ 5, the ones naming them as contact) | `/resources?researcher=<id>` |
| Knowledge document | Lab resources (≤ 5, the ones it documents) | `/resources?knowledge=<id>` |
| Publication detail | Lab resources (≤ 5, the ones it relies on) | `/resources?publication=<id>` |
| Workspace | My research resources (≤ 5) | `/resources?mine=1` |

Every section renders nothing while loading, on error and when the viewer may see no resource, so a page without resources is
unchanged; no list is repeated inside a detail page and no section loads more than its cap. The existing detail endpoints were **not**
changed, so their responses, tests and query costs are untouched. Only relationships that exist are used (there is no Resource ↔ Resource,
Resource ↔ Publication-via-project or derived link).

## 6. Permissions (central policy)

`packages/shared/src/permissions.ts` gains four functions, all pure and shared by the API and the UI — exactly the Events / Gallery /
Knowledge ownership model:

| Function | guest | MEMBER | LAB_MANAGER | ADMIN |
| --- | :-: | :-: | :-: | :-: |
| `canCreateResource` | – | ✔ | ✔ | ✔ |
| `canEditResource(a, isOwner)` | – | own | any | any |
| `canDeleteResource(a, isOwner)` | – | own | any | any |
| `canFilterResourcesByVisibility` | – | – | ✔ | ✔ |

`isOwner` is computed **by the server** (`LabResource.ownerId === session account`); `ownerId` in a request body is stripped by the
schema and can never be asserted. A **project or group lead has no extra power** over a resource (the resource is not theirs): they get
only what the project / group policies already gave them, which does not include resources. An owner-less resource (its creator's
account was deleted) can only be changed by managers. Visibility can only be set by managers (`assertMayChangeVisibility`, `403`,
nothing written), so a member's resource stays `LAB_ONLY` until a manager publishes it. **Nobody gains account or role powers**: the
resources API has no path to `User`, roles or accounts (asserted with a privilege-escalation probe).

Linking a resource to a project / area / group / document / publication / event is allowed to any editor **for records they can see**;
a link to something they cannot see is answered `400 … not found`, indistinguishable from a missing id, and the messages are identical.
A link that is *not being changed* is not re-checked, so a resource whose project was later hidden stays editable. `projectIds` is the
**complete** project set; projects the editor cannot see are never offered, so an edit can neither remove nor reveal them — the server
keeps every existing link to a project the actor cannot see.

## 7. Visibility

There is exactly one visibility architecture (`PUBLIC | LAB_ONLY`, `visibleTo(viewer)` / `canView`) and resources use it unchanged.
`PRIVATE` is **not** a stored value in this codebase and was not introduced: a stored value outside the allow-list (e.g. `PRIVATE`) is
hidden from **everyone**, admins included (fail closed) — tested on resources, on linked projects and on linked areas/groups.

* **Resources.** Selected through `visibleTo(viewer)` *inside the query*: counts, totals and pages are computed after filtering. A hidden
  resource is a `404` byte-identical to a missing one (API and web not-found state); a malformed id is a `400`.
* **Relationships never leak.** A `PUBLIC` resource pointing at `LAB_ONLY` projects / area / group / document / publication / event names
  none of them to a guest — title *or* id — on the list, the detail page, search results, `related` links, the workspace and the admin-independent
  responses. Project links are filtered **in the query** (the project list and its count are `where: { project: visible }`), so a hidden
  project is neither listed nor counted.
* **Relationship filters cannot probe.** `?project=<hidden id>` also requires the *project* to be visible, so it returns the same empty
  result as an unknown id (same for area, group, knowledge, publication).
* **The visibility filter** (`?visibility=`) is a manager control: `403` for guests and members (and not rendered).
* **`visibility` in responses** is sent only to accounts that may change it. The owner is only ever the public team profile
  (`{id, name}` of the `TeamMember`), never an account id or e-mail; a deleted owner is `null`.

## 8. Translations (English base, Japanese override)

`LAB_RESOURCE: ["name", "description", "environment"]` was added to the existing `TRANSLATABLE_FIELDS` allow-list (and to the
admin field caps, `BASE_DELEGATE` for the English-base read and the admin label map); nothing else about localization changed. English
lives in the row; Japanese is an override in `Translation` (`entityType LAB_RESOURCE`, `locale ja`).

* Reads: `localize()` overlays the override; a missing/blank override falls back to English **per field**. Related project / area / group
  titles are localized in one batched lookup per kind; on a detail page also the document / publication / event titles.
* Writes: the Japanese fragment rides on the resource's own `POST`/`PUT` (`translations.ja.{name,description,environment}`), so it is authorized
  exactly like the English fields (a member cannot write a translation on someone else's resource — `403`, nothing stored). A non-empty
  value upserts, `""`/`null` clears, an absent field is untouched, unknown fields are stripped, lengths are capped like the English ones.
  Deleting a resource removes its `Translation` rows.
* **Japanese editing never overwrites English.** The form loads the English base **and** the Japanese override from
  `GET /api/translations/LAB_RESOURCE/:id` and the full record from `GET /api/resources/:id`; **Save is disabled until both have arrived**, and if
  either fails the form says so and does not save (browser-tested with faked 500s). Creating or editing while the UI is Japanese writes the typed
  text to the English columns and the Japanese fields to overrides.
* Locale never affects authorization: nine probes × five locale values (incl. tampered / empty / missing) return one status each.
* UI text is in `packages/shared/src/i18n/en.ts` / `ja.ts` (parity-checked); the fixed server messages are in the web's error-message allow-list.

## 9. Search (Phase 10/20 reused, not duplicated)

`resource` was appended to `SEARCH_TYPES` (source order = type order) with one `defineSource` in `lib/search.ts`: `base: visibleTo`; searched
columns name, description, type code, vendor, identifier, version and environment notes; the Japanese name/description/environment overrides
through the same `translationMatchIds` helper (Japanese requests only — the Phase 14 convention); deterministic order (name A–Z, id); `href
/resources/:id`; `related` links (Phase 20) for project / area / group each read through `visibleTo` / `canView`; `meta` is `version · vendor`
as typed (no English label, so a Japanese result contains no English words). `%` and `_` stay word separators (a query cannot become a wildcard).
`url` is not searched. The search query-cost test moved from 13 to 14 operations (one more `COUNT`, unchanged in kind).

## 10. Workspace, Admin, Audit

**Workspace.** `GET /api/workspace` gained `resources: { items (≤ 5), total }`: resources the researcher owns, that name them, or that are linked
to their projects, groups and areas — the *same* relationship definitions the Phase 21 workspace and Phase 22 knowledge use
(`researcherRelations`, extracted from `researcherScope`, each related record itself visible). It never accepts an id from the request; a
signed-in account with no profile gets the empty section. `GET /api/resources?mine=1` is the same definition behind "View all my resources (N)"
and the two totals are asserted equal. One member's `LAB_ONLY` resource never appears in another's workspace.

**Admin / CMS (Phase 17 reused).** `resource` is one more content type in the *Research content* area — no second dashboard, translation manager,
account view or permission: `type=resource` in `/api/admin/content` with the filters `resourceType`, `project` (through the join table), `area`,
`group`, `owner`, `visibility`, text (name, description, type, vendor, identifier, version, notes + Japanese overrides) and the existing
sort/date filters; a filter that does not apply to a type is still a `400`. Overview: a *Lab resources* count card. Bulk visibility: `resource`
joined `ADMIN_VISIBILITY_TYPES` with `RESOURCE_UPDATED` as its ordinary audit action (all-or-nothing, manager gate, per-record
`CONTENT_VISIBILITY_CHANGED`). Translations view: `LAB_RESOURCE` is a type there. There is still no admin surface for messages / notifications and **no bulk delete**.

**Audit.** Existing `recordAudit` inside the mutation transaction (a rejected write leaves no row; reads are never audited). New actions
`RESOURCE_CREATED`, `RESOURCE_UPDATED`, `RESOURCE_DELETED` (entity type `LAB_RESOURCE`); the generic `CONTENT_VISIBILITY_CHANGED` and
`TRANSLATIONS_CHANGED` are reused. Details hold the name, type, visibility and the **names** of changed fields (incl. `metadata`, `projectIds`) and
the locale/field **names** of translation edits — never a description, environment note, metadata value, URL or Japanese text (asserted against
the audit rows, and the existing `FORBIDDEN_KEY` guard rejects a `body`/`content`/`message` key).

## 11. Storage, files, datasets

* **No file storage was added and Phase 13 was not touched.** A resource references a dataset (or anything else) by a **link** and text
  (`url`, `identifier`, `format`, `size`, `license`, `collectionMethod`). `StoredFile.entityType` has no resource parent, and adding one would change
  Phase 13's file authorization, which the brief forbids — so file attachments on resources are a documented limitation, not a workaround.
* The link is validated on write (`http(s)` only; `javascript:`, `data:`, `file:`, `ftp:`, `//host`, malformed and oversized values are a
  `400`), **re-checked on read** (a tampered stored value is returned as `""`), and rendered as an `<a rel="noopener noreferrer" target="_blank">` only when it
  is an `http(s)` URL.

## 12. Content rendering and security

All fields are **plain text**. The web renders them as React text nodes (`white-space: pre-wrap`, `overflow-wrap: anywhere`), so line breaks survive and
nothing is ever parsed as markup. There is no `dangerouslySetInnerHTML`/`innerHTML` and **no Markdown** (it would need a sanitizer).

* Names, descriptions, versions, vendors, identifiers, notes, every metadata value, Japanese overrides and related-record names carrying `<script>`,
  `<img onerror>`, `javascript:` links, `<iframe>`, `<svg onload>` and event-handler attributes are stored verbatim and rendered as text on the list, detail,
  project panel / area / group pages, search, the admin list, the edit form (as an input *value*) and the tab title — EN and JA, guest and admin. The browser
  suite asserts that no such element exists, that no script ran and that no JS dialog opened.
* Responses are `application/json`; no account id, e-mail, credential material, storage key, `userId` or `ownerId` appears on any resource response
  (scanned on the wire in the API suite and by the browser suite's response scanner).
* IDs are validated by `ID_PATTERN` (malformed → `400`, hidden and missing → the same `404`); `ownerId` / `id` / `createdAt` / `role` in a body are stripped.
* Locale tampering (`X-Locale: ja-JP`, `JA`, garbage, empty) never changes an authorization outcome.

## 13. Performance

`test:resources-cost` (19 checks) inserts 85 resources (each with two projects and its own project) next to a 5-resource fixture and asserts that
operation counts do not depend on the data: **list** = 2 queries in English (rows + count), +≤ 4 batched `Translation` lookups in Japanese; **detail** =
1 row + ≤ 6 lookups; **project panel / knowledge section** = rows + count + ≤ 4 lookups; **search** identical for 5 and 85 resources; **workspace** identical
small vs big (+2 operations for the resources section); **admin list** identical small vs big. A text search adds one `Translation` query **per search word**
(the Phase 10 helper's documented cost), never per row. Everything is deterministic (`updatedAt desc, id asc`), capped (`limit ≤ 50`, sections ≤ 5, panel ≤ 12,
a card names ≤ 3 projects) and index-backed (visibility+updatedAt, one index per link). Only reads, only on `LabResource` / `Translation` (workspace/search
also on their usual models; never `User`, `Session`, `AuditLog`, messages, notifications or files).

## 14. Accessibility and responsive design

Same design system: `PageHeader` (breadcrumbs on detail), `SectionHeader`, `Card`, `Badge`, `VisibilityBadge`, `EmptyState`, `ErrorState`, `LoadingState`, `Modal`,
`AdminBar`, `CardEditControls`, the admin filter bar and the search pager. One `h1` and one `main` per page; the result count is a polite live region; the
filter form is a `role="search"` with real `<label>`s; validation errors are `role="alert"`, tied to the control with `aria-invalid` + `aria-describedby`, and move focus to
it; the project picker is a fieldset of checkboxes (real labels, scrollable when long); the pager is a labelled `nav`; state (lab-only, type) is text, never colour alone;
dialogs trap focus, close on Escape and return focus to the control that opened them. Long Japanese names, unbroken 150–3000-character tokens and 60-line Japanese
descriptions wrap inside cards, facts, the panel, dialogs and admin rows at 390 px. On phones the filter form folds behind a "Filters" summary (a real `<details>`, closed on
narrow screens unless a filter is active, with the number of active filters in its label); the reproducibility panel's groups reflow into one column.

## 15. Tests

| Suite | Covers |
| --- | --- |
| `unit-resources.test.ts` (in `test:unit`) | types / families / metadata allow-list, create / update / list schemas, permissions, serializer visibility (guest / member / manager / fail-closed), where / include / order builders, metadata storage, admin / search / translation registrations, i18n parity |
| `resources-regression.mjs` (`test:resources`) | guest / member / owner / lead / manager / admin API: list, detail, create, update, delete, projects, pagination, filters, validation, hidden resources and relations, ID enumeration, deleted relations / owner, translations (EN / JA / fallback / clear / locale tampering), hostile text, search, workspace, admin (counts, filters, bulk, translations), audit, privilege escalation |
| `resources-queries.test.ts` (`test:resources-cost`) | no N+1, bounded and data-independent operation counts (list, detail, project / knowledge sections, search, workspace, admin) |
| existing suites | all re-run; legacy assertions that this phase *legitimately* changes were updated, not weakened (below) |
| `browser-regression.cjs` (`ONLY_RESOURCES=1`) | see §16 |

Legacy assertions changed because a search type, a nav link, an admin type and a workspace section were added: search `counts` objects (`+ resource`), the search
page's chip count / Tab count / chip map, the Research nav group (N5, K9, K9b, K12 and the three role-header checks: six links), `unit-search / -i18n / -admin /
-research / -discovery / -knowledge` size assertions and the fake-row column set, the search query-cost budget (13 → 14, 9 → 10 counts) and the workspace budget (19 → 21,
27 → 29) and its model allow-list.

## 16. Results

### Database and migration

| Check | Result |
| --- | --- |
| Migration | `20260927100000_phase23_lab_resources`: **2 `CREATE TABLE` + 10 `CREATE INDEX`**, nothing else (SQL shown and approved before it was applied; applied to a copy first, then — after approval — to `dev.db`) |
| `dev.db` after `migrate deploy` | sha256 `4cc160b26ff4185fee7db1322fe06e67426e4bdd5d2d4fbf0881bcaee43fbdf3` (was `9b9b5652…70c1`; the only change is the two new empty tables, their indexes and one `_prisma_migrations` row) |
| Row counts before → after | every one of the 32 pre-existing tables identical (TeamMember 7, Publication 4, PublicationAuthor 2, NewsItem 3, NewsAuthor 1, ResearchArea 5, User 1, Session 36, the rest 0); `LabResource` 0; `ResourceProject` 0; `_prisma_migrations` 3 → 4 |
| `integrity_check` / `foreign_key_check` | `ok` / empty, re-checked on the copy, on `dev.db` right after the migration and again at the very end |
| `migrate status` / `migrate diff` vs `schema.prisma` | 4 migrations, all finished, "schema is up to date" / no drift (exit 0) |
| `Lab-Website/` reference tree | 27 files, git tree `92cb3c6bd575986b4e82fed47cbfb95bc91067cc`, unchanged and clean |
| Tests | ran only against copies of `dev.db`; the real file's hash was unchanged from the migration to the end |

### Automated tests

| Suite | Result |
| --- | --- |
| Unit (`npm run test:unit`, 13 files) | **1,081** checks, 0 failed — policy 385, search 64, messages 34, files 64, i18n 42, events 105, admin 49, research 43, publication 63, discovery 11, workspace 37, knowledge 80, **resources 104** |
| Resources API (`test:resources`) | **198** checks, 0 failed |
| Resources query cost (`test:resources-cost`) | **19** checks, 0 failed (list = 2 queries in English, +≤ 4 lookups in Japanese, identical for 5 and 85 resources; search / workspace / admin identical small vs big) |
| Search API / search cost / workspace cost | 220 / 10 / 8, 0 failed (budgets +1 and +2 for the added `COUNT` and the resources section) |
| Every other API suite, re-run on a fresh copy | api 559, forum 90, messages 73, files 51, gallery 44, events 218, admin 290, research 184, publication 194, i18n 36, locale-independence 46, discovery 47, workspace 143, knowledge 227 (+ knowledge cost 12) — all 0 failed (**2,620** API checks in total, 49 cost checks) |
| Type checks / builds | `packages/shared`, `apps/server` (`tsc --noEmit`) and `apps/web` (`tsc -b && vite build`) clean; `oxlint` (web + server + shared) **16 warnings before and after**, none in Phase 23 files |

### Mutation testing (no assertion was weakened; survivors were fixed by adding or strengthening assertions)

* **Server + shared: 137 mutants (99 server, 38 shared), all killed.** They cover: relationship visibility on the serializer (project / area / group / document / publication / event), project-link filtering and counting, ownership flags (incl. owner-less resources), `visibility` leaking to non-managers (resources and search results), the translation overlay (own and related titles), every where-clause filter (visibility, type, project / area / group / researcher / knowledge / publication, text words, Japanese overrides, identifier / environment), `mine` and each part of the researcher scope, ordering, paging, the section cap, create / update / delete authorization, the manager-only visibility rules, link validation against invisible and missing records (exact messages), hidden-project preservation, project add / remove, metadata validation and storage, translation cleanup and audit rows (create / update / delete / visibility / translations / project changes, and "no description in the audit"), search (`base`, translations, fields, href, meta, order, `related`), the workspace (scope, visibility, cap, empty workspace), admin (filters, join-table project filter, relation counts, bulk audit action, overview, translation label) and the shared schemas / permissions / constants / limits. 13 first-pass survivors exposed real test gaps (literal limit values, related-title localization, excerpt cut, visibility- and translation-audit rows on update, hidden documents / publications / events and unknown researchers hidden behind the generic foreign-key `400`, update audit type, admin translation label) and were fixed, then re-killed.
* **Web: 95 mutants, 92 killed, 3 equivalent.** They cover the card (edit / delete controls, version line, excerpt, "+N more", links, byline), the type badge, the related sections and the reproducibility panel (cap, empty, total, order, grouping, empty groups), the form (English-base / detail guards, changed-only links and projects, hidden-link preservation, visibility control, metadata that fits the type, presets, focus and error mapping, Japanese fields, already-linked picklist entry), the list page (guest filters, junk paging, pager ends, folded filters and their count, singular count, empty state, reload after create / delete), the detail page (manage bar, link rel / target / http(s) guard, metadata, notes, description, facts and links, not-found vs error, navigation after delete), the workspace / search / nav / admin integrations. 17 first-pass survivors (fractional page, guest filters, "+N more", section cap and true total, empty groups and order, hidden area / group links surviving an edit, a linked document beyond the picklist, the active-filter count, singular count, delete-from-detail navigation, the search glyph, the publication label, the exact admin project count, a foreign detail key in a response) were fixed with new browser steps, then re-killed. The three equivalent mutants cannot differ: `canDelete` shown wherever `canEdit` is (card and detail page — the policy defines `canDeleteResource = canEditResource`), and "always send the project set" (the server diffs the set and always keeps projects the editor cannot see, so an unchanged set is a no-op).

### Browser regression (headless Edge over CDP)

* **Complete suite: 23,285 checks, 0 failed** (Phase 22 finished at 19,082). Widths 390, 412, 768, 900, 1024, 1280, 1366, 1440, 1920 · locales EN and JA · roles guest, member, project lead, lab manager, admin. Earlier runs of the whole suite found and fixed: two real defects (a very long unbroken project title in the form's checklist widened the dialog — now wraps; a failed detail load was titled "Resource not found") and test-design issues (assertions that read the whole page while the picklists hold other phases' record names).
* The Phase 23 section (`ONLY_RESOURCES=1`, steps named `resources …`) covers: navigation, list, filters (incl. the folded phone layout and its count), paging, detail (details, reproducibility facts, notes, links), create / validation / edit / delete, per-type detail fields, projects, Japanese fields (create, edit, clear, English-base guard, JA UI), visibility and the leaky-relation cases, the project panel and the area / group / researcher / knowledge / publication sections with View all, search, workspace, admin (list, filters, inspect, overview, translations, bulk visibility), form guards (base / detail load failures, hidden links), empty / loading / error states, keyboard (Tab walks, Escape, focus return, dialog trap), hostile text (EN + JA, guest + admin, no element created, no script run, no JS dialog, javascript: link and foreign detail key in a response), long Japanese and unbroken text, and a nine-width sweep per role with the add / edit / delete dialogs.
* Legitimately changed legacy assertions (documented, not weakened): search chips 10 → 11 and the search-page Tab count, the Research menu now has six links (N5, K9, K9b, K12 and the three role-header checks), admin chip counts (content 7 → 8, translations 8 → 9), workspace sections 8 → 9, and the run-level allow-list for the deliberate 4xx/5xx probes.

### Cleanup

Only artifacts this phase created were removed: the mutation working copy (`apps/server/.mut`) and the 52 upload blobs the phase's own test runs wrote into `apps/server/storage/files` (gitignored; the real database has no `StoredFile` rows). Older blobs from earlier phases (72 files dated 2026-09-23 … 2026-09-25) were left in place. No test server, Vite dev server or Edge process is left running.

## 17. Limitations and deferred

* Plain-text fields only (no Markdown / rich text). **No file attachments and no upload** (§11): datasets are referenced by link and text.
* A resource has at most one research area, one group, one document, one publication, one event and one researcher; only projects are many-to-many.
* No per-resource sharing beyond `PUBLIC | LAB_ONLY`; no versions/history of a resource (only `updatedAt` and the audit trail); no comments; no drafts; no bulk delete.
* The form's document picker offers the newest 50 documents (an already-linked older one is always kept selectable); publications and events are loaded in full.
* Search is plain `LIKE` (fine at lab scale); the type code is searched in English only; `metadata` values and `url` are not searched.
* A Japanese *search* result's `meta` line is `version · vendor` as typed, with no localized label.
* Out of scope by the brief and **not started**: Phase 24 (public showcase), inventory/purchasing/reservations, cloud or external storage, file synchronization, PDF preview,
  package management, software execution, AI / RAG / embeddings / recommendations, real-time collaboration, version control, multi-tenancy, analytics, account disabling.
