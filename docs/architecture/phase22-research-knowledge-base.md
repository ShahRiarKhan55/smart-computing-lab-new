# Phase 22 — Research Knowledge Base & Lab Documentation Hub

Status: implemented, **not committed**. **One additive database migration** (`20260926120000_phase22_knowledge_base`,
a single `CREATE TABLE` plus its indexes). Baseline: `369b92d`.

## 1. Purpose

Phases 18–21 built and exposed the research graph — Research Area → Project → Group → Researcher, with Publications, News
and Events hanging off projects. That graph had no natural home for the *working knowledge* around the research: how a board
is set up, how an experiment is run, what a dataset contains, how to reproduce a result, lab procedures, useful resources.

Phase 22 adds that home: a **structured, permissioned, localized documentation hub** whose documents are attached to the
existing graph. It is deliberately **not**

* a blogging platform or a second CMS (there is no feed, no drafts, no comments, no tags);
* a wiki (no arbitrary or public editing; a document has an owner and the usual roles);
* a replacement for publications, or for the Gallery / file storage (no attachments, no uploads);
* a task manager, or an AI feature (no summaries, embeddings, recommendations).

## 2. Schema decision (why a migration was necessary)

Before writing any code every existing table was checked for a fit. None could hold a document:

| Candidate | Why it does not fit |
| --- | --- |
| `ForumPost` | visibility comes from its **category**, no own visibility; no area / group / researcher link; carries forum semantics (pinned, locked, comments, reactions, mentions, `HIDDEN/DELETED` status); would put lab docs into the forum feed and forum search |
| `NewsItem` | a dated announcement (`dateLabel`, `sortDate`, `emoji`, `type`), short-form `description`, no category enum |
| `ResearchProject.description` etc. | one column per record, not a set of documents |
| `StoredFile` / `GalleryItem` | file metadata; a second file system is out of scope |
| `Translation` | fine as-is — reused (see §7) |

So one new table was approved and added, and **only** that:

```prisma
model KnowledgeDoc {
  id, title, body, category, visibility (default LAB_ONLY),
  authorId?, projectId?, researchAreaId?, groupId?, teamMemberId?,   // single nullable FKs, ON DELETE SET NULL
  createdAt, updatedAt
  @@index([visibility, updatedAt]) @@index([projectId]) @@index([researchAreaId]) @@index([groupId]) @@index([teamMemberId]) @@index([authorId])
}
```

* The migration SQL is exactly one `CREATE TABLE "KnowledgeDoc"` and six `CREATE INDEX` statements (verified before it was
  applied: no `ALTER`, `DROP`, `INSERT` or table rebuild). The other `schema.prisma` edits are the required Prisma
  back-relation lines on five models plus the `Translation.entityType` comment.
* **No join tables.** Every link is one nullable foreign key, the same cardinality rule News/Event/Gallery already follow.
  Deleting a project, area, group, researcher or the author's account **keeps the document** and clears the link
  (`ON DELETE SET NULL`); an author-less document has no owner, so only managers can change it.
* `category` and `visibility` are plain strings validated by allow-lists, exactly like every other typed column in this schema.
* No speculative columns: no slug (documents are addressed by id, like events), no revision counter, no attachment column.
* After applying: every pre-existing table kept its row count, `integrity_check = ok`, `foreign_key_check` empty,
  `migrate diff` against `schema.prisma` reports **no drift**, and the `Lab-Website/reference` tree hash is unchanged.

## 3. Categories

A small controlled vocabulary in `packages/shared/src/schemas/knowledge.ts` (`KNOWLEDGE_CATEGORIES`), enforced by zod on every
write and every filter, and mapped to localized labels through `KNOWLEDGE_CATEGORY_LABEL_KEY` (`apps/web/src/i18n/labels.ts`):

`PROJECT_DOCUMENTATION · RESEARCH_NOTE · METHODOLOGY · EXPERIMENT · HARDWARE · SOFTWARE · DATASET · REPRODUCIBILITY · LAB_PROCEDURE · RESOURCE`

Hostile / unknown / mis-cased values (`method`, `'; DROP TABLE …`, `<script>`, `""`, `null`, arrays) are a `400`; a stored
value outside the list is shown as `RESOURCE` rather than trusted.

## 4. Relationships

`Knowledge → Project | Research Area | Group | Researcher` (all optional, at most one of each). Nothing else is invented: there is
no Knowledge ↔ Publication link, because no real relationship justifies one (a publication reaches a document through their
shared project).

Reads are made from the document's side *and* from the graph's side, with one mechanism — `GET /api/knowledge?project=|area=|group=|researcher=`:

| Page | Section | "View all" |
| --- | --- | --- |
| Project detail | Knowledge & documentation (≤ 5 newest) | `/knowledge?project=<id>` |
| Research area detail | same | `/knowledge?area=<id>` |
| Group detail | same | `/knowledge?group=<id>` |
| Researcher (team member) detail | same | `/knowledge?researcher=<id>` |
| Workspace | Recent documentation (≤ 5) | `/knowledge?mine=1` |

`RelatedKnowledge` renders nothing while loading, on error and when the viewer may see no document, so a page without
documentation is unchanged. The full list is never repeated inside a detail page and no section loads more than 5 rows.

The existing detail endpoints (`/api/projects/:id`, …) were **not** changed, so their responses, tests and query costs are untouched.

## 5. Permissions (central policy, no scattered role checks)

`packages/shared/src/permissions.ts` gains four functions, all pure and shared by the API and the UI:

| Function | guest | MEMBER | LAB_MANAGER | ADMIN |
| --- | :-: | :-: | :-: | :-: |
| `canCreateKnowledge` | – | ✔ | ✔ | ✔ |
| `canEditKnowledge(a, isOwner)` | – | own | any | any |
| `canDeleteKnowledge(a, isOwner)` | – | own | any | any |
| `canFilterKnowledgeByVisibility` | – | – | ✔ | ✔ |

This is exactly the Events / Gallery ownership model. `isOwner` is computed **by the server** from `KnowledgeDoc.authorId ===
session account`; the client can never assert it, and `authorId` in a request body is stripped by the schema. A project *lead*
has no extra power over documents. Visibility can only be set by managers (`assertMayChangeVisibility`, `403` otherwise, nothing
written), so a member's document stays `LAB_ONLY` until a manager publishes it. Linking a document to a project / area / group is
allowed to any editor **for records they can see**; a link to something they cannot see is answered `400 … not found`,
indistinguishable from a missing id. A link that is *not being changed* is not re-checked, so a document whose project was later
hidden stays editable. Roles can never be changed through this API.

## 6. Visibility

There is exactly one visibility architecture (`PUBLIC | LAB_ONLY`, `visibleTo(viewer)` / `canView`) and knowledge uses it unchanged.

* **Documents.** Selected through `visibleTo(viewer)` *inside the query* — counts, totals and pages are computed after
  filtering. A hidden document is a `404` byte-identical to a missing one (list, detail, and the web not-found state). A stored
  visibility outside the allow-list is hidden from **everyone**, including admins (fail closed).
* **Relationships never leak.** A `PUBLIC` document that points at a `LAB_ONLY` project/area/group names none of them to a guest
  (title *or* id), on the list, the detail page, search results, the workspace and the admin-independent responses. The
  researcher and author are public team profiles (no visibility column, exactly as everywhere else).
* **Relationship filters cannot probe.** `?project=<hidden id>` also requires the *project* to be visible, so it returns the same
  empty result as an unknown id and cannot reveal which public documents hang off a hidden record.
* **The visibility filter** (`?visibility=`) is a manager control: `403` for guests and members (and not rendered in the UI).
* **`visibility` in responses** is sent only to accounts that may change it (as for every other entity).
* **Workspace / "mine"** re-use the same `visibleTo` and the workspace's own relationship definitions (own projects, their groups'
  projects, projects in their areas — each itself visible).

## 7. Translations (English base, Japanese override)

`KNOWLEDGE_DOC: ["title", "body"]` was added to the existing allow-list (`TRANSLATABLE_FIELDS`); nothing else about localization
changed. English lives in the row; Japanese is an override in `Translation` (`entityType KNOWLEDGE_DOC`, `locale ja`), one row per
field, unique by `(entityType, entityId, locale, field)` — so duplicates are impossible.

* Reads: `localize()` overlays the override; a missing/blank override falls back to English per field (title-only overrides leave
  the body in English). Related project/area/group titles are localized in one batched lookup per kind.
* Writes: the Japanese fragment rides on the document's own `POST`/`PUT` (`translations.ja.{title,body}`), so it is authorized
  exactly like the English fields. A non-empty value upserts, `""`/`null` clears, an absent field is untouched, unknown fields
  are stripped, lengths are capped like the English ones. Deleting a document removes its `Translation` rows.
* Editing: the form loads the English base **and** the Japanese override from `GET /api/translations/KNOWLEDGE_DOC/:id`
  (`getEntityBase` gained the `knowledgeDoc` delegate), so editing while the UI is Japanese never writes Japanese into the
  English columns. Saving is disabled until the base has loaded; if it fails to load the form says so and does not save.
* Locale never affects authorization: every guest/member/manager probe returns the same status for `en`, `ja`, a garbage locale,
  an empty locale and a missing header (tested for nine probes × five locale values).
* New UI text is in `packages/shared/src/i18n/en.ts` / `ja.ts` (100 keys, parity-checked); the fixed server messages
  (`Body is required.`, `Research area not found.`, …) are in the web's error-message allow-list so they read in Japanese.

## 8. Search (Phase 10/20 reused, not duplicated)

`knowledge` was appended to `SEARCH_TYPES` (source order = type order) with one `defineSource` in `lib/search.ts`:

* `base: visibleTo`, so counts, totals, pagination and the filter chips never include a hidden document;
* fields: English title, **body**, and the Japanese title/body overrides through the same `translationMatchIds` helper;
* deterministic order (title A–Z, id), tiered ranking like every other type, `href /knowledge/:id`, no HTML in the excerpt;
* `related` links (Phase 20) for project / area / group, each read through `canView`;
* `meta` is empty on purpose (a category label would put English words into a Japanese result).

Body search is plain `LIKE` on a column capped at 20,000 characters and always ANDed with the visibility clause. `%` and `_` are word
separators (the Phase 10 rule), so a query cannot be turned into a wildcard. The search query-cost test moved from 12 to 13
operations (one more `COUNT`, unchanged in kind).

## 9. Workspace and discovery

* `GET /api/workspace` gained `knowledge: { items (≤ 5), total }`: documents the researcher wrote, that name them, or that belong
  to their projects, groups and areas. Same identity rule as Phase 21 (the session's team profile only; an injected
  `userId`/`teamMemberId` changes nothing). A signed-in account with no profile still gets the Phase 21 empty workspace.
* `GET /api/knowledge?mine=1` is the same definition (`researcherScope`) behind the "View all my documents (N)" link, and the two
  totals are asserted equal. `mine` needs a session (`401` for a guest).
* Phase 20 `RelatedResearch` was reused untouched; the knowledge UI stays a list + detail with plain relationship links — there
  is no graph view.

## 10. Admin / CMS (Phase 17 reused)

Knowledge is one more content type in the existing engine, in the *Research content* area, with **no** second dashboard,
translation manager, account view or permission:

* `type=knowledge` in `/api/admin/content` (list, detail with relationship counts and translation state), with filters
  `category`, `project`, `area`, `group`, `owner`, `visibility`, text (title + body + Japanese overrides) and the existing sort/date
  filters; a filter that does not apply to the chosen type is still a `400`.
* Overview: a *Knowledge documents* count card (total / public / lab-only) linking to the filtered list.
* Bulk visibility: `knowledge` joined `ADMIN_VISIBILITY_TYPES` with `KNOWLEDGE_UPDATED` as its ordinary audit action — the
  existing all-or-nothing rule, manager gate and per-record `CONTENT_VISIBILITY_CHANGED` row apply unchanged. **No bulk delete.**
* Translations view: `KNOWLEDGE_DOC` is a type there (title/body, with the same length caps).
* Deep links go to `/knowledge/:id`.

## 11. Audit

Existing `recordAudit` inside the mutation transaction (a rejected write leaves no row; reads are never audited). New actions:
`KNOWLEDGE_CREATED`, `KNOWLEDGE_UPDATED`, `KNOWLEDGE_DELETED` (entity type `KNOWLEDGE_DOC`); the generic `CONTENT_VISIBILITY_CHANGED`
and `TRANSLATIONS_CHANGED` are reused. Details hold the title, category, visibility, the **names** of changed fields and the
locale/field **names** of translation edits — never a body, never Japanese text (asserted against the audit rows, and the
existing `FORBIDDEN_KEY` guard already rejects a `body`/`content` key).

## 12. Content rendering and security

The body is **plain text**. The web renders `{doc.body}` as a React text node inside `.knowledge-body` (`white-space: pre-wrap`,
`overflow-wrap: anywhere`), so line breaks and indentation survive and nothing is ever parsed as markup. There is no
`dangerouslySetInnerHTML` anywhere in the feature and **no Markdown**: adding it would need a sanitizer, and the brief forbids
unsafe HTML for convenience. (Limitation: no headings/links/code formatting in bodies.)

* Titles, bodies, Japanese overrides and related-record names carrying `<script>`, `<img onerror>`, `javascript:` links,
  `<iframe>` and event-handler attributes are stored verbatim and rendered as text on the list, detail, project/area/group pages,
  search, admin list, the edit form (as an input *value*) and the tab title — in EN and JA, as guest and admin. The browser suite
  asserts that no such element exists, that no script ran and that no JS dialog opened.
* API responses are `application/json`; no account id, e-mail, credential material or storage key appears on any knowledge
  response (scanned on the wire in the API suite and by the browser suite's response scanner). The author is only ever the public
  team profile; a deleted author is `null`.
* IDs are validated by `ID_PATTERN` (malformed → `400`, hidden and missing → the same `404`).

## 13. Files, attachments, versions

* **Attachments: deliberately left out.** `StoredFile.entityType` is an allow-list of parents, and adding a parent would touch
  Phase 13's authorization for files; the brief says not to redesign it. Documents link to files only by text.
* **Version history: out of scope.** `ForumPostRevision` is forum-specific and there is no generic revision architecture, so
  none was built. `updatedAt` plus the audit trail (who changed which fields, when) is what is kept.

## 14. Performance

* List: exactly **2** queries (rows + count) for English, +≤4 batched `Translation` lookups for Japanese (documents, projects,
  areas, groups), identical for 5 and 85 rows and for 12 and 50 rows per page. Detail: 1 row + ≤4 lookups. A research-page section
  and the workspace section: bounded `take` (5) + count.
* A text search adds one `Translation` query **per search word** (the Phase 10 helper's documented cost), never per row.
* Everything is deterministic (`updatedAt desc, id asc`), capped (`limit ≤ 50`, sections ≤ 5) and index-backed
  (`visibility+updatedAt`, one index per link).
* `test:knowledge-cost` (12 checks) asserts all of this against 85 inserted documents and only-reads on only-allowed models; the
  workspace and search cost tests were re-baselined by exactly the operations this phase adds (+2 and +1).

## 15. Accessibility and responsive design

Same design system: `PageHeader` (breadcrumbs on detail), `SectionHeader`, `Card`, `Badge`, `VisibilityBadge`, `EmptyState`,
`ErrorState`, `LoadingState`, `Modal`, `AdminBar`, `CardEditControls`, the admin filter bar and the search pager. One `h1` and one
`main` per page; the result count is a polite live region; the filter form is a `role="search"` with real `<label>`s; validation
errors are `role="alert"`, tied to the control with `aria-invalid`, and move focus to it; the pager is a labelled `nav` whose
disabled ends are `aria-disabled`; state (lab-only, category) is text + icon, never colour alone; dialogs trap focus, close on
Escape and return focus to the control that opened them (checked at every width for the add, edit and delete dialogs). Long
Japanese titles, unbroken 150–3000-character tokens and 60-line Japanese bodies wrap inside cards, facts, dialogs and the admin
rows at 390 px. On phones the filter form folds behind a "Filters" summary (a real `<details>`, closed on narrow screens unless a filter is active, with the number of active filters in its label) so eight controls never push the results off the screen, and the related-research tags wrap under the excerpt.

## 16. Tests

See §17 for the final numbers.

| Suite | Covers |
| --- | --- |
| `unit-knowledge.test.ts` | shared schemas (create / update / list query), category allow-list, excerpt, permissions, serializer visibility (guest / member / manager / fail-closed), where-builders, admin / search / translation registrations, i18n parity |
| `knowledge-regression.mjs` (`test:knowledge`) | guest / member / manager / admin API: list, detail, create, update, delete, pagination, filters, validation, visibility, hidden relations, ID enumeration, deleted author / project / area / group / researcher, translations (EN / JA / fallback / clear / locale tampering), search, workspace, admin (counts, filters, bulk, translations), audit, hostile input, privilege escalation |
| `knowledge-queries.test.ts` (`test:knowledge-cost`) | no N+1, bounded and data-independent operation counts |
| existing suites | `unit-policy/-search/-i18n/-admin/-research/-discovery` (+ knowledge rows), `search-regression`, `search-queries`, `workspace-queries`, `admin`, `discovery`, `workspace`, `locale-independence` … all re-run |
| `browser-regression.cjs` (`ONLY_KNOWLEDGE=1`) | see §17 |

Legacy assertions that this phase *legitimately* changes were updated, not weakened: the search chip count (`+ knowledge`), the
Research nav group (`+ Knowledge`), type-count / ops-count expectations, `TRANSLATABLE_FIELDS` and `SEARCH_TYPES` sizes.

## 17. Results

### Database and migration

| Check | Result |
| --- | --- |
| Migration | `20260926120000_phase22_knowledge_base`: **1 `CREATE TABLE` + 6 `CREATE INDEX`**, nothing else (verified before applying) |
| `dev.db` after `migrate deploy` | sha256 `9b9b5652d8202893beba10bad31fc0217c07285a01db056030a89839b4dc70c1` (was `70d2f21d…62dc`; the only change is the new empty table and its `_prisma_migrations` row) |
| Row counts before → after | every pre-existing table identical (TeamMember 7, Publication 4, NewsItem 3, ResearchArea 5, User 1, Session 36, …); `KnowledgeDoc` 0; `_prisma_migrations` 2 → 3 |
| `integrity_check` / `foreign_key_check` | `ok` / empty, re-checked after every test run and at the very end |
| `prisma migrate diff --from-url dev.db --to-schema-datamodel schema.prisma` | no drift |
| `Lab-Website/` reference tree | 27 files, tree hash `19e30eb3…5e08`, unchanged |
| Tests | ran only against copies of `dev.db`; the real file's hash was unchanged from the migration to the end |

### Automated tests

| Suite | Result |
| --- | --- |
| Unit (`npm run test:unit`, 12 files) | **975** checks, 0 failed — policy 385, search 64, messages 34, files 64, i18n 40, events 105, admin 49, research 43, publication 63, discovery 11, workspace 37, **knowledge 80** |
| Knowledge API (`test:knowledge`) | **227** checks, 0 failed |
| Knowledge query cost (`test:knowledge-cost`) | **12** checks, 0 failed (list = 2 queries for English, +≤4 lookups for Japanese, independent of 5 vs 85 rows) |
| Search API / search cost / workspace cost | 220 / 10 / 8, 0 failed |
| Every other API suite, re-run on a fresh copy | api 559, forum 90, messages 73, files 51, gallery 44, events 218, admin 290, research 184, publication 194, i18n 36, locale-independence 46, discovery 47, workspace 143 — all 0 failed (**2,422** API checks in total) |
| Type checks / builds | `packages/shared`, `apps/server` (`tsc --noEmit`) and `apps/web` (`tsc -b && vite build`) clean; `oxlint` 13 warnings before and after (none new) |

### Mutation testing (no assertion was weakened; survivors were fixed by strengthening fixtures/assertions)

* **Server + shared: 84 mutants, all killed.** They cover: relationship visibility on the serializer (project / area / group), ownership flags (incl. author-less documents), `visibility` leaking to non-managers (documents and search results), the translation overlay, every where-clause filter (visibility, project / area / group / researcher / category, body and title search, Japanese overrides), `mine` and the researcher scope, ordering, paging, the section cap, create/update/delete authorization, the manager-only visibility rules, link validation against invisible records, translation cleanup and audit rows (incl. "no body in the audit"), search (`base`, translations, body, href, related), the workspace (scope, visibility, cap, empty workspace), admin (filters, relation counts, bulk audit, overview) and the shared schemas/permissions/constants. 15 first-pass survivors exposed real test gaps (author-less `canEdit`, Japanese related titles, Japanese-override search, a doc that only names the researcher, PRIVATE group/area scope and links, PUT visibility audit rows, search `visibility` key, profile-less workspace, admin relation counts, bulk audit action, `body: ""`, section constants) and were fixed, then re-killed.
* **Web: 51 mutants, 49 killed, 2 equivalent.** They cover the empty state, permission controls (edit / delete icons, the manage bar, add bar, visibility and "mine" filters), delete confirmation and its navigation, the filters and pager, localized labels (category, search type, CTA, error messages), relationship rendering and links, the related section (empty, View all, total, cap), the body/title rendered as HTML (XSS), the English-base guard on the edit form, link preservation, the workspace link/empty state and the admin knowledge UI. 7 first-pass survivors (last-page "Next", not-found wording, delete-from-detail navigation, base-not-loaded save, English title reset while editing in Japanese, hidden-link preservation, raw admin category code) were fixed with new browser steps, then re-killed. The two equivalent mutants (`canDelete` shown wherever `canEdit` is, on the card and on the detail page) cannot differ because the policy defines `canDeleteKnowledge = canEditKnowledge`.

### Browser regression (headless Edge over CDP)

* **Complete suite: 19,082 checks, 0 failed** (run 2 after one test-only fix: an assertion matched the substring "Project Lab", which the Phase 21 fixture "ZZ B9 W21 Project Lab" also contains, so it failed only in a full run — now an exact title).
* Widths 390, 412, 768, 900, 1024, 1280, 1366, 1440, 1920 · locales EN and JA · roles guest, member, project lead, lab manager, admin.
* The Phase 22 section (`ONLY_KNOWLEDGE=1`, steps named `knowledge …`) covers: navigation, list, filters (incl. the folded phone layout), paging, detail, create / validation / edit / delete, Japanese fields (create, edit, clear, English-base guard, JA UI), visibility and the leaky-relation cases, project / area / group / researcher integration, search, workspace, admin (list, filters, inspect, overview, translations), empty / loading / error states, keyboard (Tab walks, Escape, focus return, dialog trap), hostile text (EN + JA, guest + admin, no element created, no script run, no JS dialog), long Japanese and unbroken text, and a nine-width sweep per role with the add / edit / delete dialogs.
* Legitimately changed legacy assertions (documented, not weakened): search chips 9 → 10, the search-page Tab count, the Research menu now has five links (N5, K9, K9b, K12, the three role-header checks), admin chip counts (content 6 → 7, translations 7 → 8), workspace sections 7 → 8, the run-level allow-list for the deliberate 4xx/5xx probes, and the layout audit now ignores the content of a *closed* `<details>`.

## 18. Limitations and deferred

* Body is plain text (no Markdown / rich text); no attachments; no version history or diff; no comments; no drafts or review
  workflow; a document has at most one project, one area, one group and one researcher; no per-document sharing beyond
  `PUBLIC | LAB_ONLY`; no bulk delete; no full-text index (plain `LIKE`, fine at lab scale); no automatic link suggestions; a
  Japanese *search* result's `meta` line is empty.
* Any editor may link a document to any project/area/group they can see (no per-project approval) — a manager can unlink or delete.
* Out of scope by the brief and not started: AI features, semantic search, external knowledge APIs, wiki-style public editing,
  real-time collaboration, file redesign, Phase 23.
