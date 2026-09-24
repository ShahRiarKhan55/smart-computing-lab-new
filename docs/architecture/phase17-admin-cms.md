# Phase 17 — Advanced Admin / CMS Management

Phase 17 turns the Admin Dashboard into one management interface for the whole lab site. It is a
**management view over the systems that already exist** — the same tables, the same central
permission functions, the same audit trail, the same `Translation` table and the same design system.
It adds no table, no column, no migration, no new role and no new visibility state.

Contents: 1 [Goals and non-goals](#1-goals-and-non-goals) · 2 [Architecture](#2-architecture) ·
3 [Information architecture and routes](#3-information-architecture-and-routes) ·
4 [API](#4-api) · 5 [Permissions](#5-permissions) · 6 [Visibility and bulk operations](#6-visibility-and-bulk-operations) ·
7 [Content management, search and filters](#7-content-management-search-and-filters) ·
8 [Translation management](#8-translation-management) · 9 [Audit viewer](#9-audit-viewer) ·
10 [Accounts](#10-accounts) · 11 [Community, files and events](#11-community-files-and-events) ·
12 [Privacy boundaries](#12-privacy-boundaries) · 13 [Security](#13-security) · 14 [Localization](#14-localization) ·
15 [Accessibility](#15-accessibility) · 16 [Responsive behaviour](#16-responsive-behaviour) · 17 [Testing](#17-testing) ·
18 [Database impact](#18-database-impact) · 19 [Existing tests that changed](#19-existing-tests-that-changed) ·
20 [Known limitations](#20-known-limitations) · 21 [Explicitly deferred](#21-explicitly-deferred)

---

## 1. Goals and non-goals

**Goals.** One place where a lab manager or admin can: see real counts; find, inspect and (bulk) publish
or hide content; see and edit Japanese overrides; read the audit trail; see forum/gallery state; and (admin
only) manage accounts and link them to team profiles.

**Non-goals (deliberately not built).** A generic CMS table; a universal content model; a second search
engine; account disable/enable (needs a schema change, see §21); admin access to private messages or
notifications (never); bulk deletion; content ownership reassignment; analytics; email/SMS; cloud storage.

## 2. Architecture

```
web  /admin/*  (AdminLayout + 8 pages)  ──►  GET/POST/PUT /api/admin/*      (routes/admin.routes.ts)
                                       ──►  /api/users, /api/users/:id/link (routes/users.routes.ts, ADMIN only)
                                       ──►  the ordinary content routes for anything that edits a record
shared  permissions.ts  (canAccessAdmin, canBulkChangeVisibility, canManageTranslations, canViewAuditLog,
                         canViewAccountAudit, canLinkAccounts)           schemas/admin.ts (query/body/response shapes)
server  lib/adminContent.ts  one adapter per content type over ITS OWN Prisma model (no generic table)
        lib/search.ts        translationMatchIds() is now exported and reused for Japanese-override matching
        lib/audit.ts         + USER_LINKED, USER_UNLINKED, TRANSLATIONS_CHANGED
```

Design rules that kept this small and safe:

* **The admin API is a read model + three narrow writes.** Reads: overview, content list/detail,
  translations list, audit, community, files. Writes: bulk visibility, one translation field, account
  link/unlink. Every other edit (title, dates, members…) still goes through the record's own form and
  route, under that route's own permission — the admin list links to it.
* **No new powers.** A manager could already change visibility (per record), edit any translatable
  entity's Japanese fields, read every row, and moderate the forum. Phase 17 makes those reachable in one
  place; it does not widen who may do them.
* **Fail closed.** Strict zod schemas for every query and body (unknown enum, malformed id, page 0,
  impossible date, an array where text belongs → 400). A filter that does not apply to the chosen content
  type is a 400, never silently ignored.
* **The URL is the state.** Filters, type and page live in the query string (deep-linkable, Back works).

## 3. Information architecture and routes

The header's Account menu shows **Admin Dashboard** to managers and admins (`canAccessAdmin`). Inside it a
labelled `<nav>` of chips switches sections; the current one carries `aria-current="page"`.

| Route | Section | Who | Notes |
|---|---|---|---|
| `/admin` | A. Overview | manager, admin | real counts; account block only for admin |
| `/admin/people` | B. People & Accounts | **admin** | account list, filters, role change, delete, create login, **link / unlink profile** |
| `/admin/content` | C. Research content | manager, admin | research areas, projects, groups, publications, news, team profiles |
| `/admin/events` | D. Events | manager, admin | when / type / visibility / creator filters, bulk visibility |
| `/admin/community` | E. Community | manager, admin | forum categories + counts, hidden topics (titles only), links |
| `/admin/files` | F. Files & Gallery | manager, admin | gallery file metadata, filters |
| `/admin/translations` | G. Localization | manager, admin | Japanese overrides: view, search, filter, edit, clear |
| `/admin/audit` | H. Audit log | manager, admin | filtered, paginated, read-only |

Route guards in the browser (`ProtectedRoute`) are UX only. Every request is re-checked by the API.

## 4. API

All under `/api/admin`, all behind `requireCan(canAccessAdmin)` (401 guest, 403 member).

| Method + path | Purpose |
|---|---|
| `GET /overview` | counts (public vs lab-only where the table has visibility), upcoming events, overrides; `accounts` is `null` unless admin |
| `GET /content?type=&q=&visibility=&owner=&scope=&kind=&status=&newsType=&translation=&from=&to=&sort=&page=&limit=` | one page of one content type |
| `GET /content/:type/:id` | the record's summary, relationship counts, translation state |
| `POST /content/visibility` `{type, ids[≤100], visibility}` | bulk PUBLIC / LAB_ONLY, all-or-nothing |
| `GET /translations?type=&q=&state=&page=&limit=` | records with base text and Japanese override per field |
| `PUT /translations/:entityType/:entityId` `{field, value}` | set (non-empty) or clear (`""`/`null`) one Japanese field |
| `GET /audit?action=&entityType=&actor=&from=&to=&page=&limit=` | audit rows, newest first, `id` as the tiebreaker |
| `GET /community` | category counts + hidden topic titles |
| `GET /files?q=&visibility=&category=&page=&limit=` | gallery file metadata |

Plus, ADMIN only, in the existing users router: `PUT /api/users/:id/link {teamMemberId | null}`.

There is **no** `/api/admin/messages`, `/notifications` or `/conversations` (they 404, even for an admin).

Pagination: `page` 1..10000, `limit` 1..100 (default 25); responses carry `{page, limit, total, totalPages}`;
a page past the end is an empty list, not an error.

## 5. Permissions

Every rule is a pure function in `packages/shared/src/permissions.ts`, added to the unit matrix
(`unit-policy.test.ts`), enforced by the API and only mirrored by the UI.

| Capability | Guest | MEMBER | LAB_MANAGER | ADMIN |
|---|---|---|---|---|
| `canAccessAdmin` (dashboard, content, events, community, files) | – | – | ✔ | ✔ |
| `canBulkChangeVisibility` (= `canChangeVisibility`) | – | – | ✔ | ✔ |
| `canManageTranslations` | – | – | ✔ | ✔ |
| `canViewAuditLog` | – | – | ✔ | ✔ |
| `canViewAccountAudit` (USER events, actor emails, actor filter) | – | – | – | ✔ |
| `canManageUsers` (list/create/delete accounts, roles) — unchanged | – | – | – | ✔ |
| `canLinkAccounts` (link/unlink) | – | – | – | ✔ |
| Change your own role | – | – | – | – (`roleChangeError`, unchanged) |
| Read another user's messages / notifications | – | – | – | – (Phase 12, unchanged) |

Locale never enters any of these functions. `X-Locale` is only read to pick which language's *text* to
return; `locale-independence-regression.mjs` (46 checks) and the admin suite prove the status code of every
admin request is identical for `en`, `ja`, garbage, empty and missing headers.

## 6. Visibility and bulk operations

Visibility semantics are untouched: `PUBLIC` and `LAB_ONLY` only (no `PRIVATE` was invented). Six types
have a `visibility` column: research areas, projects, groups, publications, news, events. Team profiles are
always public and the UI shows no visibility control for them; the API rejects `type=team-member` for bulk.

`POST /content/visibility`:

* validated: 1–100 unique, well-formed ids; `visibility` exactly `PUBLIC`/`LAB_ONLY`; extra keys stripped.
* **all-or-nothing** in one transaction: if any id does not exist the whole request is a 404 and nothing
  changes (no partial publish).
* already-matching records are counted as `unchanged` and write **no** audit row.
* each changed record gets its ordinary `*_UPDATED` row (`changed: "visibility"`, `bulk: true`) **and** a
  `CONTENT_VISIBILITY_CHANGED` row (`from`, `to`, `bulk: true`) — exactly what changing it one at a time writes.
* nothing leaks: hidden rows are 404 for guests through every ordinary route, and hidden rows disappear
  from the public search as before (the search engine still uses `visibleTo`; nothing there changed).

In the UI: tick rows → *Apply to selected* → **confirmation dialog that states the count and the
consequence** ("logged-out visitors will …") → result in a live region. Focus starts on *Cancel*, Escape
cancels and returns focus to the button. **No bulk delete** was added: deletion stays per record in each
type's own page, under its existing rule (e.g. team profile deletion is admin only).

## 7. Content management, search and filters

`lib/adminContent.ts` has one adapter per type (`research-area`, `project`, `group`, `publication`, `news`,
`event`, `team-member`), each a thin wrapper over its own Prisma model: text columns, title column, how to
build a row, how to count relationships. There is no shared content table.

Filters (each valid only where it means something; otherwise 400): `visibility`, `status` (project),
`newsType`, `kind`/`scope`/`owner` (events), `translation=translated|untranslated`, `from`/`to` (record
*updated* date, inclusive day, real calendar dates only), `sort=updated|created|title`.

**Search.** `q` uses the global search's own recipe: `parseSearchText` words (NFKC; `%`, `_` and control
characters are separators; ≤ 8 words, ≤ 100 chars), every word must appear in some column (`AND` of `OR`),
Prisma `contains` — **no raw SQL, no FTS5, no second engine**. Japanese overrides are matched through the
same exported `translationMatchIds()` helper the global search uses, so the Phase 15 Japanese behaviour is
preserved — and the match is applied **whatever `X-Locale` is**, so the result set can never depend on the
language. The search *engine itself* (`lib/search.ts`) changed by one word: `export`.

Each row: title (shown in the admin's language where an override exists), subtitle, visibility, status,
date, owner, "JA n/m" translation progress, updated date, a link to the public page. The **Details** dialog
shows relationship counts (members, areas, publications, news, events, gallery, forum topics…) and which
fields have a Japanese override, and says that editing happens on the record's own page.

**Ownership.** Only events have an owner column (`createdById`). The admin shows the creator's *public team
profile name* and filters by that profile id; an event whose creator's account was deleted shows "No owner"
and is editable only by managers (Phase 16 rule). Reassigning owners is not supported by the schema's
existing endpoints and was not added.

## 8. Translation management

The existing `Translation` table (`entityType, entityId, locale, field, value`) and its allow-list
(`TRANSLATABLE_FIELDS`) are reused — no second table. Supported types: research areas, projects, groups,
news, **events**, team-member bios.

* List: per record the English base text (read-only, `lang="en"`) beside the Japanese override
  (`lang="ja"` textarea) per field; filter by type, text (English *or* Japanese) and state
  (all / with an override / without any).
* Edit: `PUT /translations/:entityType/:entityId {field, value}`. Only allow-listed fields; length caps are
  the very constants each entity's own form uses (`ADMIN_TRANSLATION_MAX` imports them, and a unit test fails
  if a field is added to the allow-list without a cap); a missing record is 404; the write goes through the
  existing `applyTranslationOverrides` (the same function the entities' own PUT bodies use) inside a
  transaction. It can only write `locale: "ja"` and never touches the English column.
* Authorization: a manager may already edit every one of these entities' forms, so `canManageTranslations`
  is the manager rule; nothing here lets a member (or a lower role) write.
* Audit: `TRANSLATIONS_CHANGED` (events keep `EVENT_TRANSLATIONS_CHANGED`) with `locale`, the field **name**
  and `cleared` — **never the translated text**. Re-saving an identical value writes nothing.
* The UI keeps an entry where it is after saving (updated in place), so a confirmation is never lost to a
  list re-filtering under you.

Raw ids are not displayed anywhere in the UI (only used in URLs/aria wiring).

## 9. Audit viewer

`GET /audit` — newest first (`createdAt desc, id desc`), paginated, filters: `action`, `entityType`, `actor`,
`from`/`to`. Facets (distinct actions and entity types) come back with the page to fill the selects.

| | LAB_MANAGER | ADMIN |
|---|---|---|
| Account events (`entityType = USER`: created, deleted, role changed, linked, unlinked) | hidden, also from the facets | shown |
| Actor | the person's *public profile name* (or none) | the email snapshot |
| `actor` filter | 403 | email substring |
| Detail keys named like an email | dropped (defence in depth) | shown |

Details are exactly what the audit convention already stores: flat, ids/roles/counts/**field names**, and the
existing `FORBIDDEN_KEY` tripwire (`pass|hash|secret|token|cookie|session|body|content|message`) still
throws for a bad key at write time. Nothing in Phase 17 writes a password, token, message or notification
body, or a translation value. Action and entity labels are localized (with a raw-code fallback for an action
added later).

**Limitation.** `AuditLog` stores an actor id/email snapshot, an action, an entity type/id and a small
JSON `details` string; there is no column for "record title" beyond what `details` happens to contain, so
the viewer shows the entity *type* and the details as recorded, not a live title lookup.

## 10. Accounts

`/admin/people` is the previous account UI (list, role change, delete, create login) plus:

* client-side filters (search by email/profile, role, linked / not linked);
* **Link profile** (dialog offering only *unlinked* team profiles) and **Unlink** (confirmation dialog).

`PUT /api/users/:id/link {teamMemberId}` / `{teamMemberId: null}` — ADMIN only via the router-level guard.
Linking requires the account to have no profile and the profile no account (409 otherwise, 400 for an unknown
profile, 404 for an unknown account); both directions are **conditional writes** (`updateMany … where userId
is null / = account`), so two concurrent requests can never claim one profile twice (tested: exactly one 200,
one 409). Audited as `USER_LINKED` / `USER_UNLINKED` (email + profile id). Unlinking keeps the profile on the
site; the login just stops being able to edit it.

Unchanged and re-tested: nobody changes their own role; a manager can neither create accounts nor promote
anyone (403); a demotion or deletion takes effect on the very next request (the session's user is re-read
each time).

## 11. Community, files and events

* **Community.** Category table (visibility, locked, topics, hidden topics, comments, hidden comments) and up
  to 20 hidden topics awaiting review (title, category, author *profile name*, date, link). No post or comment
  **body** is ever loaded. Moderation stays in the forum under `canModerate`; the author-only text-edit rule is
  untouched (a manager still gets 403 editing someone's post — asserted in the suite).
* **Files & gallery.** Gallery items only: original (sanitised) name, MIME type, size, caption, category,
  visibility, uploader's *profile name*, project, date. The response has exactly those keys — **no storage key,
  path, sha256 or file URL** — and files attached to anything else (e.g. `MESSAGE`) are excluded. Bytes remain
  behind `/api/files/:id` and its own access check; the storage directory is still never served.
* **Events.** The Events section reuses the Event model, its owner/manager rules, Japanese overrides, audit
  actions and search: filters upcoming/past (`eventScopeWhere`, the very function the public list uses),
  type, visibility, creator; bulk visibility; editing stays on the event's own page/form.

## 12. Privacy boundaries

* No admin endpoint touches `Conversation`, `Message` or `Notification`. There is no admin message search,
  conversation browser or notification viewer, and none can be added by accident: a static test fails if the
  admin code references those models.
* The privacy suite plants a message with a unique token, then asserts the token appears in **no** admin
  response (every section, every content type, translations, audit, files) and in no audit row, and that
  admin/manager cannot open the conversation through the messaging API either (Phase 12, unchanged).
* The overview never reports unread counts or message counts; it says so on the page.
* Account ids and emails: content/team lists never carry `userId`, an account id or an email; an event's
  owner is the creator's *public profile*. The one place an account email appears is the ADMIN audit actor.

## 13. Security

Reviewed and tested (`admin-regression.mjs`, `unit-admin.test.ts`, browser suite):

| Area | Result |
|---|---|
| guest / member / manager / admin → every admin endpoint | 401 / 403 / 200 / 200; write endpoints 401/403 and change nothing |
| self-role change, manager escalation, extra body keys (`role`, `userId`, `__proto__`, `constructor`) | refused or stripped; roles unchanged |
| locale switching | identical outcomes for `en`, `ja`, `fr`, garbage, empty, missing |
| hidden content | 404 identical to missing for guests through ordinary routes; bulk hide/publish verified against guest reads and search |
| deleted-account ownership | events keep working, owner becomes null; audit keeps the email snapshot (admin) / blank (manager) |
| deleted/demoted account with a live session | next request 401 / 403 |
| ID enumeration | guests get one identical 401 body for an existing and a missing id; members one identical 403 |
| malformed ids, pagination, filters, enums, dates | 400 with a message (≈45 cases) |
| Prisma/SQL-injection-style input (`' OR '1'='1`, `; DROP TABLE`, `UNION SELECT`, `{"$ne":null}`) | inert text; tables survive; no raw SQL anywhere (static scan) |
| XSS (hostile titles, translations, filenames, captions) | rendered as text; no element created; JSON served as `application/json` |
| long strings / Japanese / unbroken tokens | caps enforced (translation fields at the entity's cap, 100-char search); wrap in the UI |
| CSRF / session | unchanged architecture: HttpOnly, SameSite=Lax cookie; writes need `Content-Type: application/json` — a form-style `text/plain` / urlencoded POST is not parsed and is a 400 that changes nothing; GET never changes state; oversized bodies 413 |
| private messages/notifications | see §12 |

Known pre-existing items, unchanged and out of scope: no rate limiting; Express's default `X-Powered-By`.

## 14. Localization

All admin UI strings are in the existing dictionaries (`packages/shared/src/i18n/{en,ja}.ts`, 299 new `adm.*`
keys per language, no hard-coded user text): navigation, headings, filters, buttons, dialogs, empty/loading/
error states, status and content-type labels, every audit action and entity type, translation labels. Enum
labels go through `labels.ts` (`dictLabel()` for the open-ended sets — audit actions, relation names, field
names — with a raw fallback). Dates and numbers use `Intl` via `lib/format.ts` (`formatDate` added). The
language switch is unchanged. Server messages for the new account errors are mapped in `errorMessages.ts`;
other zod validation messages stay English in both languages, exactly as disclosed since Phase 14.

## 15. Accessibility

Lists are real `<ul>/<li>` (not tables); the section nav, the pager and the filter forms are labelled
landmarks; every checkbox and icon-less button has an accessible name (the record title is in the checkbox
label); the count/result lines are `role="status" aria-live="polite"`; busy lists set `aria-busy`; dialogs use
the shared `Modal` (focus in, trapped, Escape, focus returns) and destructive/visibility dialogs start on
*Cancel*. Keyboard walks (Tab, ring, not covered, named) run at 390 / 768 / 1280 px in both languages.

## 16. Responsive behaviour

Rows are stacked cards, filters a wrapping grid, the bulk bar wraps; nothing depends on a wide table. Long
Japanese text, long unbroken tokens (80+ chars) and hostile strings wrap (`overflow-wrap:anywhere`). The
sweep found and fixed one real defect: the Japanese-field label on the translations page contains the record
title and did not wrap. Verified at 390, 412, 768, 900, 1024, 1280, 1366, 1440 and 1920 px in EN and JA.

## 17. Testing

| Suite | Command | Checks |
|---|---|---|
| Policy matrix (6 new rows) | `npm run test:unit -w apps/server` (`unit-policy`) | 358 |
| **Admin unit** (schemas, drift guards, bulk targets, text-WHERE builder, audit convention, policy spot-checks) | `unit-admin.test.ts` | **49** |
| Other unit files (search 64, messages 34, files 64, i18n 36, events 105) | `test:unit` | 303 |
| API regression (Phases 1–9.1, incl. the static "no inline role check" scan over the new files) | `npm run test:api` | 559 |
| Search (Phase 10/15/16) + query-cost | `test:search`, `test:search-cost` | 220 + 10 |
| Forum · messages · files · gallery · events | `test:forum/messages/files/gallery/events` | 90 · 73 · 51 · 44 · 218 |
| i18n · locale independence | `test:i18n`, `test:locale-independence` | 36 · 46 |
| **Admin API** (`scripts/admin-regression.mjs`, `npm run test:admin`) | 16 sections | **291** |
| **Browser — Phase 17 section** (`ONLY_ADMIN=1`), all nine widths × EN/JA × manager/admin | `browser-regression.cjs` | **1,192** |
| Browser — whole suite (all phases; legacy sweeps at 390 & 1280) | `browser-regression.cjs` | **3,343** (0 failed) |

All server suites ran against fresh copies of `dev.db` (each suite has its own server), never the real database.

**Admin API suite sections:** access matrix (guest/member/manager/admin × every endpoint) · overview counts vs the
database · content list (every type, every filter, search, Japanese-override search, paging determinism, ~30
invalid-input cases, injection strings, no account ids) · content detail · bulk visibility (all-or-nothing,
audit rows, guest reads/search after, extra keys, ~12 invalid bodies) · translations (set/clear/audit-without-text,
every type, caps, XSS, hostile ids, locale independence) · audit (manager vs admin, filters, paging, no secrets,
planted email detail) · account link/unlink (409/400/404 cases, concurrent claim race, audit) · roles (no
escalation, stale-session demotion) · community · files/gallery (hostile filename, exact key set, no storage key,
message-attached file excluded) · deleted-account ownership · **message/notification privacy** (planted token appears
nowhere) · locale independence (8 header variants) · CSRF/session/body handling · source-level guards.

**Browser Phase 17 section:** roles (guest/member redirected + API 401/403; manager: seven sections, no People,
`/admin/people` bounced; admin: eight) · overview numbers equal the API · content filters/search/deep links/
pagination/empty states/hostile text · bulk selection, confirmation dialog (count, consequence, Cancel first,
Escape returns focus), result announcement, guest-visible effect · record inspector · events filters and bulk
publish/hide · translations view/edit/clear (English base unchanged, Japanese visitor sees it, audit has no text) ·
audit (manager vs admin, filters, paging) · people (filters, link/unlink dialogs, self-protection) · community/files
without private text or storage paths · Japanese labels · sweep of every section at **390, 412, 768, 900, 1024, 1280,
1366, 1440, 1920** px in **EN and JA** (overflow, clipped/overlapping text, named controls, one h1/main, no raw keys,
no untranslated aria/labels), detail + bulk dialogs (semantics, fit, trap, Escape, focus return) and keyboard walks.

**Mutation testing (both proved meaningful):**

* **Server — 32 mutants, 32 killed** against the admin API suite (guard removed, partial bulk, missing/incorrect audit
  rows, manager sees account events / emails / actor filter, translation allow-list and cap removed, audit stores the
  text, account block for managers, storage key / message-attached file / topic body exposed, owner id is the account
  id, `hasAccount` for everyone, visibility/date/AND/offset/Japanese-search filter bugs, link guards). The first
  round left 3 survivors, which exposed two weak assertions (a fixture that never exercised the message-attached
  filter; a status-only check that the DB's unique index alone satisfied) and one no-op mutant; the tests were
  strengthened and the mutant made real, then all were killed.
* **Web — 16 mutants, 16 killed** against the browser section (People section shown to managers, `/admin/people`
  open to managers, bulk Apply without confirmation, dialog not starting on Cancel, selection surviving, actor filter
  for managers, Save never enabling, own-role select enabled, link dialog offering linked profiles, file-bytes link,
  missing moderation/privacy notes, pager stuck, wrong bulk target, unnamed checkboxes, raw audit codes).

**Real defects found and fixed by the tests:** (1) the Japanese-field label on the translations page contains the
record title and did not wrap — an unbroken 80-character title overflowed the page at every width (fixed in CSS);
(2) a stale list stayed fully visible while a new filter loaded — the list is now `aria-busy` and dimmed; (3) the
"Created by" select did not show the URL's owner until its options arrived — it now remounts when they do; (4)
clearing an override under the "with an override" filter removed the row before its confirmation showed — entries now
update in place. Two further findings were harness issues (a second `role="search"` form in the header; real clicks
below the fold) and one legacy fixture (`D.mem` is promoted to manager by earlier steps, see §19).

## 18. Database impact

**None.** No migration, no schema change, no data written by the feature itself. Every table used already
existed: `AuditLog`, `Translation`, `Event`, `ForumCategory/Post/Comment`, `StoredFile/GalleryItem`, the
content tables and `User/TeamMember` (linking uses the existing nullable `TeamMember.userId`). New audit
actions are values in an existing string column. The real `dev.db` was never opened by any test (all runs
use copies) and is byte-identical (sha256 `70d2f21d…62dc`, integrity ok, FK clean). `Lab-Website/` is
byte-identical (tree hash `29036afe…0d27`, 27 files).

## 19. Existing tests that changed

Phase 17 legitimately changes two behaviours, so these `browser-regression.cjs` assertions were updated (each
carries a comment); nothing was weakened to make a test pass:

1. **A lab manager now reaches `/admin`** (a management view) and the header shows *Admin Dashboard*.
   Accounts are still admin-only: `/admin/people` still bounces a manager and `GET /api/users` is still 403 —
   both are now asserted explicitly. (Old: "manager is bounced from /admin", "no Admin link".)
2. **The account list moved from `/admin` to `/admin/people`.** The dashboard summary/role-select/create-login
   assertions now open `/admin/people`; the old "dashboard has six tile links" and "adds NO new features"
   assertions described the pre-Phase-17 page and were replaced by ones that still fail if the account section
   grows unrelated features.

Also: the a11y "raw translation key" scan learned the `adm.` prefix; the response-body leak scan exempts
`/api/admin/audit` for an ADMIN (whose USER rows name the account they are about, just like `/api/users`); the
expected-error list gained the deliberate 401/403 admin probes.

## 20. Known limitations

* Bulk visibility covers the six visibility-bearing content types; gallery item and forum-category visibility
  are changed on their own pages (gallery visibility lives on the file; categories in the forum UI).
* The content list shows the base record fields; titles use the admin's language only where an override exists.
* The audit viewer shows entity *type* and recorded details, not a live record title (see §9).
* Content-list search is per type (choose a type, then search) — there is no single cross-type admin search.
* News `type` values (Paper, Award…) are shown as stored, exactly as elsewhere on the site.
* Hidden-topic review lists the 20 most recent hidden topics only.
* The list refetches on filter/page changes; during that moment the old rows stay visible (dimmed, `aria-busy`).
* Zod validation messages remain English in both locales (Phase 14/15 disclosure).

## 21. Explicitly deferred

* **Account disable/enable.** The `User` table has no `disabledAt`/`active` column, and encoding "disabled"
  in `role` is unsafe (an unknown role is treated as `MEMBER`, i.e. *more* access than disabled). It needs a
  schema change: `User.disabledAt DateTime?` plus a check in `getSessionUser` and login. **Not done; would need
  an explicit migration decision.**
* Bulk delete, ownership reassignment, cross-type admin search, audit export, admin notifications, per-record
  edit forms inside the admin (they stay on each record's page), pagination of the hidden-topic list.
* Everything in the "do not expand scope" list (payments, analytics, cloud storage, OAuth, RSVP, …) and Phase 18.
