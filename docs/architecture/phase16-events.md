# Phase 16 — Events & Lab Event Management

Status: **implemented and verified** (see §14 for the exact numbers). **No database migration was
required.** The `Event` table (and the `EVENT` entry in the `Translation` allow-list comment) were
created in Phase 8; this phase only puts an API and a UI on top of them. `dev.db` was never opened
for writing — every test ran on a disposable copy (§13).

The Google Calendar **Schedule page is unchanged**. Events are the lab's own, in-site event
content; the Schedule remains the shared external calendar. Nothing here talks to Google.

---

## 1. Architecture

```
React (pages/EventsPage, pages/EventDetailPage, components/EventCard, components/EventFormModal,
       HomePage "Upcoming events" section, SchedulePage link)
    ↓ apiFetch (X-Locale header, credentials)
Express  routes/events.routes.ts        lib/eventSerializers.ts
    ↓                                        (scope query, ordering, serializer, all-day normalisation)
Prisma → Event, Translation, AuditLog   (Phase 8 schema, unchanged)
```

New files

| Layer | File |
|---|---|
| shared | `packages/shared/src/schemas/event.ts` — `EVENT_KINDS`, `EVENT_SCOPES`, request schemas (`createEventSchema`, `updateEventSchema`, `eventListQuerySchema`), the `LabEvent` API shape, and the pure date helpers (`parseEventInstant`, `eventRangeInvalid`, `eventEndInstant`, `isEventPast`, `toUtcMidnight`) |
| shared | `permissions.ts` additions: `canCreateEvent`, `canEditEvent`, `canDeleteEvent`, `canLinkEventToProject`; `translatableFields.ts`: `EVENT: ["title","description"]`; `schemas/search.ts`: the `event` search type; 87 UI keys (74 `events.*`, plus `nav.events`, three `search.*`, two `schedule.*`, six `home.*`, `error.visibilityForbidden`) in both `i18n/en.ts` and `ja.ts` |
| server | `src/routes/events.routes.ts`, `src/lib/eventSerializers.ts`; edits to `lib/audit.ts` (4 actions + `EVENT` entity type), `lib/search.ts` (event source), `routes/index.ts` |
| web | `pages/EventsPage.tsx`, `pages/EventDetailPage.tsx`, `components/EventCard.tsx`, `components/EventFormModal.tsx`; edits to `App.tsx`, `navConfig.ts`, `HomePage.tsx`, `SchedulePage.tsx`, `SearchResultCard.tsx`, `i18n/labels.ts`, `i18n/errorMessages.ts`, `lib/format.ts`, and CSS (`pages.css`, `components.css`, `site.css`) |

## 2. The existing `Event` model, and how each field is used

```prisma
model Event {
  id, title, description, location, url, kind, startsAt, endsAt, allDay, visibility,
  projectId?, createdById?, createdAt, updatedAt
  project ResearchProject? (onDelete: SetNull)   createdBy User? (onDelete: SetNull)   galleryItems GalleryItem[]
}
```

| Column | Use |
|---|---|
| `title`, `description` | Base (English) text; **translatable** (Japanese override in `Translation`) |
| `location`, `url` | Plain text / http(s) link (`optionalHttpUrl`) |
| `kind` | Allow-listed to the five values the schema documents: `SEMINAR`, `MEETING`, `DEADLINE`, `SOCIAL`, `OTHER` |
| `startsAt`, `endsAt`, `allDay` | Range; `endsAt` optional; all-day events are calendar dates stored as UTC midnight |
| `visibility` | `PUBLIC` / `LAB_ONLY`, same allow-list semantics as every other content type |
| `projectId` | Optional related project |
| `createdById` | **Ownership** (creator); never sent to the browser |
| `galleryItems` | Untouched by this phase (a deleted event clears their `eventId` by `SET NULL`) |

Not supported by the schema, therefore **not implemented** (no speculative columns): a separate
"organizer" column (the organizer shown is the creator's public team profile), a group relation,
attendee/RSVP data, recurrence, time zone per event, more than five kinds.

## 3. API

Base path `/api/events`. All responses are JSON; errors are `{ "error": "<message>" }`.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/events?scope=upcoming\|past\|all&limit=&page=` | guest+ | `scope` default `upcoming`; `limit` 1–200 (default 100); `page` ≥ 1. Ordering: upcoming = soonest first; past/all = newest first; `id` tiebreak, so the order is total and repeatable. Visibility-filtered in the query itself. |
| GET | `/events/:id` | guest+ | A hidden event is a **404**, byte-identical to a missing one. |
| POST | `/events` | any signed-in account | `visibility` and `projectId` are manager/admin only (403 otherwise). Without `visibility` the event is `LAB_ONLY`. |
| PUT | `/events/:id` | creator, manager, admin | Partial update. Includes `translations: { ja: { title?, description? } }`. |
| DELETE | `/events/:id` | creator, manager, admin | Removes the event's `Translation` rows in the same transaction. |
| GET | `/translations/EVENT/:id` | signed-in | Existing Phase 14 route (prefill for the form); no new endpoint. |

Response shape (`LabEvent`): `id, title, description, location, url, kind, startsAt, endsAt, allDay,
project: {id,title}|null, organizer: {id,name}|null, canEdit, canDelete, visibility?`.
`visibility` is present only for managers/admins (`visibilityField`); `canEdit/canDelete` are computed
server-side with the central policy so the UI never re-derives them; no account id or e-mail is ever
serialized (`createdById` stays on the server).

**Validation** (server-side, Zod in `@scl/shared`, the same schema the form runs): title required ≤ 200;
description ≤ 5000; location ≤ 200; `kind` allow-list; `startsAt` required and `endsAt` optional, both
must be real ISO instants with a zone (`2030-02-30T10:00:00Z`, hour 24, `+25:00` are rejected — `Date.parse`
would silently roll them over, so the calendar and clock parts are checked explicitly), years 1970–2099;
end may equal but not precede start (also enforced against the *stored* value on a partial update);
`url` must be `http://` or `https://` (no `javascript:`, `data:`, `ftp:`, scheme-less); Japanese title ≤ 200 and
description ≤ 5000; `allDay` boolean. Unknown keys (`createdById`, `id`) are stripped.

**Upcoming vs past** (`eventScopeWhere`): an event is over when its end (or start) — plus one whole day
for an all-day event — is before *now*. An event in progress, and an all-day event on its last day,
are *upcoming*. `upcoming` and `past` are written as exact `gte`/`lt` complements rather than
`NOT(…)`, because SQL `NOT(NULL)` would silently drop rows with a null `endsAt`.

## 4. Permissions (central policy, `packages/shared/src/permissions.ts`)

| Capability | Guest | MEMBER | LAB_MANAGER | ADMIN |
|---|---|---|---|---|
| see PUBLIC events | ✔ | ✔ | ✔ | ✔ |
| see LAB_ONLY events | · | ✔ | ✔ | ✔ |
| `canCreateEvent` | · | ✔ | ✔ | ✔ |
| `canEditEvent` / `canDeleteEvent` — own | · | ✔ | ✔ | ✔ |
| — someone else's | · | · | ✔ | ✔ |
| set `visibility` (`canChangeVisibility`) | · | · | ✔ | ✔ |
| link a project (`canLinkEventToProject`) | · | · | ✔ | ✔ |

Events are *owned* content like gallery items (creator or manager), not open like news. An event whose
creator's account was deleted (`createdById` null) has no owner, so only managers can change it.
`isOwner` always comes from the server's own `createdById === session user` comparison, never from
the client. There are no role checks in the route beyond calling these functions. The UI copies
(`canEdit`/`canDelete` in the response, the hidden project select) are cosmetic; every write is
re-checked on the server (§10).

## 5. Visibility

* List and detail apply `visibleTo(viewer)` inside the Prisma `where` (allow-list: a guest matches only the
  literal `PUBLIC`), so counts, pages and search totals are computed *after* filtering.
* A hidden event is a 404 (not 403) on `/events/:id`; the web page shows the same "Event not found" for a
  hidden and a missing id (compared byte-for-byte in the browser suite).
* **Project relation inheritance**: the linked project is included in a response only when
  `canView(viewer, project.visibility)` — otherwise `project` is `null` and the title is never loaded into the
  JSON. An unexpected project visibility value fails closed. A public event linked to a hidden project shows no
  project to a guest; the project link is never searched.
* Deleting a project clears the link (`SET NULL`), verified.
* Hidden events are not reachable through counts, navigation, previews (Home shows only what the API returns to
  that viewer), search, related pages, or the Japanese `Translation` lookups.
* The project/group/person pages do **not** list events (not built), so there is no second path to leak through.

## 6. Translations (Phase 14/15 architecture, reused)

`Translation(entityType="EVENT", entityId, locale="ja", field ∈ {title, description}, value)` — **no duplicate
event rows**. `TRANSLATABLE_FIELDS.EVENT = ["title","description"]`; `localize()` overlays the override and falls back to
the English column per field. `location`, `url`, `kind`, dates, visibility and project are never translated.

* `X-Locale: en` (or absent, or unsupported) → base text; `ja` → override when present, English otherwise.
* Writing: `translations.ja` inside the event's own `PUT`/`POST`; a non-empty string upserts, `""`/`null` **deletes the
  row** (so clearing restores the English fallback and leaves no blank override), an absent field is untouched.
  It is authorised exactly like the rest of the body (creator/manager). A non-owner's translation write is a 403 and
  changes nothing (mutation-tested).
* Nothing is machine-translated. Two batched `Translation` queries per list (events, then linked projects).
* The Japanese fields in the form are editable on create as well as edit (unlike the Phase 14 news form, they
  are sent with the create body).
* Like every other content type, domain text follows the stored locale on the **next load**; the UI chrome flips
  live (existing Phase 14 behaviour, not changed here).

## 7. Search

`event` is a new `SEARCH_TYPES` entry (chip "Events", card type "Event", CTA "View event", href `/events/:id`).
Same plain-`LIKE` architecture as Phase 10 (no FTS5): title, description and location are matched; `base: visibleTo`
in the same query that counts and fetches; Japanese overrides are matched and displayed only under `X-Locale: ja`
(English never searches `Translation`); ordering is newest event first, then id (repeatable). The result `meta` is
language-neutral (ISO date + location) so a Japanese result has no English words. Past events stay searchable.
The linked project is neither searched nor returned. `visibility` appears on results only for managers.
`counts.event` is a new key, so the search suites that hard-code the count object were updated (§12).

## 8. Web

* `/events` — Upcoming / Past as two chips (real links: `?view=past`, back button and deep links work; the current one is
  `aria-current`). Cards: type badge, "Happening now" / "Past" / "All day" badges (state is never colour alone), title link,
  `<time datetime>`, location, 3-line description, creator's team-profile name · project. Past cards are muted and dashed.
* `/events/:id` — breadcrumb Home / Events / title, one `<h1>`, type + visibility badges, description, and a Details panel
  (When, Where, Organized by, Related project, More information as a `noopener noreferrer` new-tab link that says so to screen
  readers). Edit / Delete for those allowed. Deleting returns to `/events`.
* Form (`EventFormModal`, existing `Modal`/`ConfirmDeleteModal`): title, type, all-day, start, end, location, description, link,
  related project (managers), visibility (managers; members get an explanatory note), and a 日本語 fieldset (title,
  description). Validation reuses the shared schema; the first error *in form order* is shown in an `role="alert"`, the invalid
  control gets `aria-invalid` + `aria-describedby`, and focus moves to it. Known messages are localized through the
  `errorMessages.ts` allow-list (`events.err.*`); an unknown server message is shown as sent.
* Dates: `formatEventWhen` (locale-aware `Intl.DateTimeFormat.formatRange`). Timed events show in the **viewer's** time zone;
  all-day events are calendar dates and are formatted in UTC so they never slip a day in any zone (tested in Tokyo, Los Angeles and
  UTC+14). The form's date-time control reads/writes the viewer's local time; all-day values are sent as `YYYY-MM-DDT00:00:00.000Z`.
* Navigation: `Events` added to the existing **Community** group (Forum · Events · Gallery), data-driven in `navConfig.ts`; the
  hamburger, keyboard model and Account menu are unchanged. Home: an "Upcoming events" section (≤ 3, soonest first, "View all
  events"), independent of the data (empty state, friendly failure message, no raw error). Schedule: a link to Events.

## 9. Schedule relationship

`/schedule` (Google Calendar embed, sign-in only) is untouched apart from one added line linking to `/events`. There is no OAuth,
no Google API and no synchronisation in either direction.

## 10. Audit log (existing `recordAudit`, inside the mutation's transaction)

`EVENT_CREATED`, `EVENT_UPDATED` (changed field *names* only), `EVENT_DELETED`, `EVENT_TRANSLATIONS_CHANGED` (`{locale, fields}` — names,
never values), plus the existing `CONTENT_VISIBILITY_CHANGED` (one row per real change). `details` never holds description text or a
translation value (the helper also rejects password/token/body/content/message keys). A rejected write leaves no row; a no-op `PUT`
writes none.

## 11. Security model

* Authentication: `requireCan(canCreateEvent)` / `requireAuth` (401 for guests).
* Authorization inside the write transaction: existence (404) → `canEditEvent/DeleteEvent(actor, isOwner)` (403) → visibility guard (403)
  → project-link guard (403, and 400 for an unknown project). Locale is never an input: the same request under `X-Locale: en` and `ja`
  gives the same status for 14 request shapes (guest/member/manager, hidden/public, translation-only writes) — see the suite.
* Input: Zod; `url` allow-list; text rendered by React as text (`querySelectorAll('script, img')` is empty on a page full of
  `<img onerror>` / `<script>` payloads in title, description, location and the Japanese override, in both locales, list + detail + search).
* No account id/e-mail on the wire (scanned in the API suite and by the browser suite over 15,357 real API responses in the full run).

## 12. Tests

| Suite | Command (`apps/server`) | Covers |
|---|---|---|
| Unit | `npm run test:unit` (`scripts/unit-events.test.ts`, 105 checks; policy matrix gained 6 event rows) | schemas, date/time rules, all-day, scope `where`, list query, policy, translation fallback, serializer visibility/ownership/project/locale |
| API | `npm run test:events` (`scripts/events-regression.mjs`, 218 checks) | CRUD, authz, visibility, validation, pagination, scopes, translations, search (EN/JA), hostile input, locale-independence, audit |
| Browser | `ONLY_EVENTS=1 node scripts/browser-regression.cjs …` (section "phase 16: events"; `ONLY_STEPS=<regex>` runs any steps) | guest/member/manager/admin, EN/JA, create/edit/delete, translation editing, detail, search, hidden direct URL, empty/error states, past/upcoming, time zones, XSS, nav, then a nine-width × EN/JA sweep with dialogs and Tab-walks |

Existing suites that hard-code the set of search types were updated for the new `event` key (a deliberate expansion, not a weakening):
`search-regression` (count objects), `search-queries.test` (8 per-type COUNTs, `Event` allowed), `unit-search` (8 types), `unit-i18n`
(six translatable entities), `browser-regression` (nine chips, Tab count, chip→API map). `logout()` in the browser suite now verifies the
server ended the session (a navigation could cancel the in-flight request and turn later "guest" steps into signed-in ones).

Mutation testing: 21 server mutants (visibility, ownership, project leak, locale-as-authz, translation write order, URL scheme, range,
audit, cascade, scope arithmetic, search visibility/translations, id leak, …) and 10 web mutants (past style, `aria-invalid`, all-day time zone,
HTML injection, nav entry, guest add button, edit controls, Japanese title, not-found leak, delete focus) were each **killed**. Two
weaknesses found that way were fixed in the tests (an all-day *range* fixture for the second scope clause; a crash-safe assertion).

Bugs the new tests found in this phase's own code: `2030-02-30` accepted (Date roll-over) → explicit calendar check; empty form reported
the start before the title and focus never moved (`requestAnimationFrame`) → issues sorted in form order + `useEffect` focus; the two date-time
pickers overflowed the 472 px dialog → stacked; a very long unbroken token in a title pushed the breadcrumb 287 px past a 390 px screen →
`.breadcrumbs li { overflow-wrap: anywhere }` (fixes it for every detail page).

## 13. Database

**No database migration was required.** `prisma validate` passes; the schema file was not modified. `apps/server/prisma/dev.db` sha256 before
and after are identical (`70d2f21d…62dc`), `PRAGMA integrity_check` = `ok`, `PRAGMA foreign_key_check` = no rows, `Event` = 0 rows before and
after, all other table counts unchanged. The reference tree (`Lab-Website/`, 27 files) hash is unchanged.

## 14. Verification summary

Last full run: unit 328 policy + 64 search + 34 messaging + 64 files/gallery + 36 i18n + 105 events; API 559 + 220 (search) + 90 (forum) + 73 (messages) + 51 (files) + 44 (gallery) + 36 (i18n) + 46 (locale-independence) + 218 (events); search-cost 10; browser **9,147 checks, 0 failures** (Phase 15 closed at 7,138) with the sweep at all nine widths in EN and JA; `npm run build` (shared + server + web) clean; `prisma validate` ok.

## 15. Limitations / deferred

* Only the five documented `kind` values; adding more is a one-line change to `EVENT_KINDS` (no migration — `kind` is a string column) plus labels.
* No separate organizer column: "Organized by" is the creator's public team profile, absent if the creator has none or the account was deleted.
* No group relation (not in the schema). Project / group / member pages do not list their events yet.
* Members cannot link a project or publish an event (manager-only by design); a member's event is `LAB_ONLY` until a manager publishes it.
* List endpoint is paged by `limit`/`page` (default 100, max 200); the UI shows the first page of each tab (no "load more").
* Timed events have no per-event time zone; they are shown in the viewer's zone.
* Domain text (like every other translatable content) follows the locale on the next load, not on the live language switch.
* Not built, by scope: RSVP/attendance, reminders, e-mail/push notifications, ticketing/payments, recurrence, Google Calendar OAuth/API/sync.
