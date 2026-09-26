# Phase 21 — Research Collaboration & Knowledge Workspace

Status: implemented, **not committed**. **No database migration.** Baseline: `125c11f`.

## 1. Purpose

Phases 18–20 made the research graph (areas, projects, groups, researchers, publications, news, events) browsable
and searchable for *visitors*. Phase 21 makes it *actionable for the researcher*: one page, `/workspace`, answers

* what research am I involved in (projects, groups, areas)?
* which publications, upcoming events and news are connected to that work?
* who do I work with?
* which of these relationships can I manage from here?

It is **not** a feed, a task board, a messaging surface or a second admin panel. It creates no new entity and no new
relationship: it is a **read model over relationships that already exist** plus three small single-relationship writes
for the two membership tables that already existed.

## 2. What already existed (inspected before coding; nothing below was duplicated)

| Need | Existing relationship / code | Reused as |
| --- | --- | --- |
| "my" researcher | `TeamMember.userId` (account ↔ public profile) | the only identity used, from the *session* |
| my projects / leads | `ProjectMember(role LEAD/MEMBER/COLLABORATOR)` | source of the projects section |
| my groups / leads | `GroupMember(role LEAD/MEMBER)` | source of the groups section |
| my areas | `ResearcherArea` (profile) + `ProjectArea` (through my projects) | areas section |
| my publications | `PublicationAuthor` | publications section (same `Publication` shape as Phase 19) |
| events / news of my work | `Event.projectId`, `NewsItem.projectId`, `NewsAuthor` | events / news sections |
| collaborators | `ProjectMember`, `GroupMember`, `ResearcherArea` of the same rows | research network |
| visibility | `visibleTo()` / `canView()` (`lib/visibility.ts`) | every read |
| permissions | `canEditProject`, `canEditGroup`, `isMember` (`shared/permissions.ts`) | aliased, not re-decided |
| audit | `PROJECT_MEMBERS_CHANGED`, `GROUP_MEMBERS_CHANGED`, `recordAudit` | same actions and detail keys |
| translation | `Translation`, `loadTranslations`, `localize`, `loadRefTranslations`, `pick` | unchanged |
| filters | `/projects?researcher=`, `/publications?researcher=` (Phase 19/20) | "All my …" links |
| dialog / states | `Modal`, `EmptyState`, `ErrorState`, `LoadingState`, `PersonLink`-style tiles | reused |

Not created: a second permission system, a second translation system, a second search, a relationship table, an activity
log, a cache, or a migration. `git diff` on `apps/server/prisma` is empty.

## 3. Architecture and data flow

```
GET /api/workspace ── requireCan(canViewWorkspace) ── loadWorkspace(viewer, locale)        (lib/workspace.ts)
   session account ─▶ TeamMember(userId) ─▶ { projects, groups, areas, publications, events, news, collaborators }
                                   every row selected through visibleTo(viewer) IN the query; counts are filtered relation counts
web:  /workspace (ProtectedRoute) ─▶ WorkspacePage ─▶ cards link to the existing detail pages
      "Manage members" (only where the SERVER set canManageMembers) ─▶ ManageMembersModal ─▶ POST/PUT/DELETE /{projects,groups}/:id/members[/:tm]
```

* **Identity is never taken from the request.** The handler reads no query, param, body or header except the locale header
  (`resolveLocale`). `?userId=…`, `?researcher=…`, `X-User-Id` are ignored (tested). A manager or admin gets *their own*
  workspace by the same lookup — it grants nothing extra.
* **No linked profile** (e.g. the seeded admin): `profile: null`, every section empty, and the page says so. No `TeamMember` is
  created (asserted by row count).

## 4. API

### `GET /api/workspace` (any signed-in account; 401 for guests; `Cache-Control: private, no-store`)

```
{ profile: {id,name,initials,role} | null,
  areas:{items,total}, projects:{items,total}, groups:{items,total},
  publications:{items,total}, events:{items,total}, news:{items,total}, collaborators:{items,total} }
```

`items` is capped per section (`WORKSPACE_LIMITS`: projects/groups/areas 12, publications/events 6, news 5, collaborators 24);
`total` is the true visible total, so the page can say "Showing 12 of 33" and link to the full list
(`/projects?researcher=`, `/publications?researcher=`, `/events`, `/news`, `/team`).

| Section | Definition (all rows visible to the viewer) |
| --- | --- |
| projects | `ProjectMember` rows of my profile; status, group (if visible), visible areas, LEAD names, member count, **visible** publication count, **visible upcoming** event count, my role, `canManageMembers` |
| groups | `GroupMember` rows of my profile; leads, member count, visible project count, distinct visible-area count (through the group's visible projects), my role, `canManageMembers` |
| areas | visible areas on my profile **or** on my visible projects; `linked` says which; visible project count, researcher count |
| publications | `PublicationAuthor` (authorship only — a publication linked to my project but not authored by me is not "mine") |
| events | upcoming, visible events whose project is *related* (below) |
| news | visible news of related projects, or authored by me |
| collaborators | see §7 |

*Related projects* (for events/news) = visible projects where I am a member, **or** whose group I belong to, **or** that carry an
area on my profile. All three are existing rows; each branch is tested on its own (member-only, group-only, area-only).

### Single-relationship writes (new, minimal)

The Phase 9 `PUT /:id/members` replaces the *whole* member set from the client's copy — right for a checkbox dialog, wrong for
"add Aiko" from a page whose list may be stale (it could silently undo a concurrent change). Three endpoints per parent, built
once (`lib/membership.ts`) and mounted on projects and groups:

| Request | Meaning | Errors |
| --- | --- | --- |
| `POST /api/projects/:id/members` `{teamMemberId, role?}` → 201 | add ONE researcher (role defaults to MEMBER) | 400 unknown team member / malformed body, **409 already a member** |
| `PUT /api/projects/:id/members/:teamMemberId` `{role}` → 200 | change ONE role (incl. lead) | 404 not a member, 409 same role, 400 bad role |
| `DELETE /api/projects/:id/members/:teamMemberId` → 200 | remove ONE researcher | 404 not a member |

Same three under `/api/groups/:id/members…` (roles LEAD/MEMBER). Common: 401 guest · 400 malformed id · **403 unless manager or LEAD of *that*
project/group (also for an unknown id, so ids cannot be probed)** · 404 unknown parent (managers). No bulk form exists (asserted: the
route file contains no `deleteMany/createMany/updateMany`, and `DELETE /:id/members` is not a route).

## 5. Permission model

Nothing new is authorised; two aliases and one new name keep the matrix in one file:

```ts
canViewWorkspace        = isMember          // it is the caller's OWN view
canManageProjectMembers = canEditProject    // manager, or LEAD of that project
canManageGroupMembers   = canEditGroup      // manager, or LEAD of that group
```

`ADMIN > LAB_MANAGER > MEMBER` is untouched. The guards are the existing `requireProjectEditor` / `requireGroupEditor`; there is no
inline role comparison in the new code (static test). Members cannot change visibility or anyone's account role (the workspace has
no such control; `PUT /users/:id` stays 403 for self-role changes by members and managers — tested). A LEAD may name another LEAD or
demote themself exactly as under Phase 9 (documented, unchanged).

## 6. Visibility behaviour

A guest never receives the workspace. A signed-in account sees PUBLIC and LAB_ONLY; `visibleTo` is an **allow-list**, so a row with any
other value is hidden from everyone. The regression suite therefore flips fixtures to such a value and proves, together:

* a hidden project disappears from the list, the total, the group card's project/area counts, the area card's project count, the
  project-related events/news and the collaborators reached through it;
* a hidden publication/event/news item disappears from lists, totals and the *project card counts* (`publicationCount`, `upcomingEventCount`);
* a hidden area disappears from areas, from every project's area chips, from group area counts and from collaborators-through-that-area;
* a hidden group disappears from groups, from `project.group` (it becomes `null`; id and name are not sent) and from collaborators;
* restoring visibility restores everything immediately (no cache).

Only accounts that may change visibility (managers/admins) receive a `visibility` field (`visibilityField`), exactly as everywhere else;
a member's response contains no `"visibility"` key (asserted in the API suite and in the browser).

## 7. Collaborator derivation and privacy

Collaborators are **other team profiles** on the same *visible* project, *visible* group or *visible* researcher-area link as the caller:
three bounded queries, merged in memory by profile id (no duplicates), with distinct-shared counts per kind. Order is total and
locale-independent: most shared first, then name by code-unit comparison, then id. Publications, forum posts and events are deliberately
**not** used to infer collaboration (the schema has no such relationship for news/events, and co-authorship would be inference).

Fields per collaborator: `id, name, initials, role` (the public lab role text) and three counts. Never an e-mail, account id, hash,
session, storage path, message or notification. The workspace code does not touch `Message`, `Notification`, `Conversation`, `StoredFile`,
`User`, `Session` or `AuditLog` models at all (static check + a Prisma-op allow-list in the query-cost test), so an admin or manager
looking at *their* workspace has no path to anyone's private data.

## 8. Localization

Typed keys `nav.workspace`, `workspace.*` (~75) and four `workspace.err.*` in `en.ts`/`ja.ts` (`Record<keyof en, string>` makes a
missing Japanese string a compile error). Titles come back already localized (`localize`, `loadRefTranslations`, `pick` — one batched
lookup per entity type, none per row). The four fixed API messages of the new endpoints are added to the existing known-error table
(`errorMessages.ts`), so a duplicate or missing relationship reads in Japanese in the dialog. Counts and lists go through
`Intl.NumberFormat` / `Intl.ListFormat`. `X-Locale` selects text only: en / ja / invalid / empty / missing / upper-case / tampered
(`ja,en;q=0.1`) return **identical ids and totals**; authorization is identical in every locale (guest 401, denied writes 403).

## 9. Audit

Reused, not extended: `PROJECT_MEMBERS_CHANGED` / `GROUP_MEMBERS_CHANGED`, written **in the same transaction** as the change with the
Phase 9 keys (`title|name, added, removed, roleChanged, leadChanged, leads`) — ids and counts only. Reads are not audited. A rejected
request leaves no row (asserted). No translated text, message, notification or credential ever enters a row (the `recordAudit`
tripwire and a suite scan).

## 10. Security

Covered in `workspace-regression.mjs` and the browser suite: guest/member/lead/manager/admin, no-profile and deleted-profile accounts,
deleted accounts (old session → 401, profile survives as a collaborator until the profile itself is deleted), malformed and unknown ids,
unauthorised add/role/remove, duplicate add, missing relationship, self-escalation (member adds themself as LEAD → 403; self-role change
→ 403), query/header identity spoofing, account-id / e-mail / credential scan of every response, private message/notification isolation
(a real conversation and notification exist; no workspace body contains them, and managers/admins cannot read the conversation),
hostile markup in every title/name (returned as JSON text; the browser proves no element/script is created, EN and JA), 110-character
unbroken tokens and 60+ character Japanese names, invalid pagination/filter query parameters (ignored, never a 400/500).

## 11. Performance / query strategy

`loadWorkspace` issues **16 database operations for English** (one profile lookup, then 15 in one `Promise.all`) and **24 for Japanese** (8 more,
all batched translation lookups: one per entity type, never per row); the count does not depend on data size. `workspace-queries.test.ts` inserts 10× more projects, groups, areas, publications, events, news and people and
asserts the operation count is *identical*, ≤ 17 for English, and that only the allow-listed models are touched, all reads.
Every section is a single `take`-bounded `findMany` (asserted statically: each `findMany` has a `take`) plus one `count`; counts inside
cards are filtered relation counts, not per-card queries. No Redis, cache or new database.

## 12. Search integration

None added, by design. The workspace links into the existing Phase 19/20 filters that the target pages **really read**
(`/projects?researcher=<my profile id>`, `/publications?researcher=…`). `/research` has no researcher filter, so no such link exists; the
`Explore this research` panels, search relations and Japanese `Translation` matching are untouched.

## 13. Admin CMS

Not changed. The workspace is the researcher-facing plane and is *own-only*, so a "view this user's workspace" link from the admin
people page would be either dead or a privacy bypass; none was added. The admin overview/audit/translation/account pages remain the
control plane and nothing they show was duplicated.

## 14. Accessibility

One `h1`, seven `h2` sections each labelled by its heading, a real `<ul>` for the network, cards with a single title link, "Manage
members" buttons whose accessible name includes the project/group name, the dialog is the shared `Modal` (role=dialog, aria-modal,
focus in, Tab trap, Escape closes, focus returns to the opener — verified with real key events at three widths per role and locale).
Inside the dialog every select and button is named, results of add/role/remove are announced through a polite `role=status` region,
errors through `role=alert`, removal is a two-step confirm whose confirming button takes focus and whose Cancel returns focus to the row's
Remove button, and focus returns to the picker after an add. Loading (skeleton with a live label), error (alert + Try again), empty
(seven per-section messages) and no-profile states all exist and are tested.

## 15. Testing

| Suite | Checks |
| --- | --- |
| `test:unit` (adds `unit-workspace.test.ts`) | 37 new (permission aliases, schemas, limits, dictionaries + placeholders, known-error table, static guards) |
| `workspace-regression.mjs` (API, DB copy) | 143 |
| `workspace-queries.test.ts` (query cost) | 8 |
| server mutation testing | 70 mutants (visibility at every site, relationship branches, caps, order, counts, locale, guards, audit, error contract) — all killed |
| web mutation testing | 28 mutants (page, dialog, route, nav, error table) — all killed |
| browser suite, Phase 21 section (`ONLY_WORKSPACE=1`, nine widths, EN + JA) | 670 |
| browser suite, **complete**, all nine widths, EN + JA, five roles | **15,335 passed, 0 failed** |
| all pre-existing suites re-run on fresh DB copies | unit 866 (11 files), API 2,195 (14 suites), search-cost 10 — 0 failed |

Mutation testing found real gaps in the *tests*, not the code: 8 server survivors (a hidden project inside a still-visible group / on a
still-visible area, a hidden area that was also the only shared area, no publication-cap or collaborator-order fixture, no group-audit
`leadChanged` assertions, an ambiguous patch) and 3 web survivors (no researcher with more than 12 projects, no colleague sharing only a
group, focus-return after Cancel). Fixtures/assertions were added — never weakened — and every mutant is now killed. The focus survivor
also exposed an *accident* in the UI: React reused the "Yes, remove" DOM node as the "Remove" button and so kept focus by chance;
the two branches now have distinct `key`s and the explicit refocus logic is what is tested.

## 16. Browser verification

Section "phase 21" (`workspace …` steps, `ONLY_WORKSPACE=1`): seed → guest gate → member → project lead (dialog: add, role, promote,
remove with confirm/cancel, stale-list duplicate, faked 403 and 500, Done/Escape/focus, group dialog) → manager and admin (visibility badge,
manage on every own card, real admin with no profile) → empty workspace → loading/error → Japanese → hostile text (EN+JA) → long text at 390 px →
nine-width × EN/JA sweeps for guest, member, lead, manager, admin, no-profile and empty accounts (with the dialog opened at every width for
the three roles that can manage) → Tab-walks → screenshots. Two legacy Account-menu assertions were updated because the Account menu
legitimately gained "My Workspace" (exact expected lists, not loosened), and the "no unexpected failed API requests" allow-list gained the
probes this section makes on purpose (guest 401 on `/api/workspace`, membership 401/403/409, faked 500). The complete suite, run after the
last source change: **15,335 checks, 0 failures**.

## 17. Database integrity

No schema or migration change. `dev.db` SHA-256 before and after: `70d2f21dd0252890f6a383584252a90de4791ae35cf553af368c4b98f79d62dc`
(identical). `PRAGMA integrity_check = ok`, `foreign_key_check` empty, row counts unchanged; every suite ran against a copy. The
`Lab-Website` reference tree hash is unchanged.

## 18. Limitations

* The collaborator list is capped at 24 with a total and a link to `/team`; there is no per-person page of "how we collaborate".
* Areas reached only through projects show a "Through your projects" badge; the schema has no direct researcher-area link for them.
* Events and news have no researcher relation in the schema, so they are related through *projects* (and news authorship), never invented.
* Member management is one relationship at a time; changing many at once still uses the Phase 9 whole-set dialog on the detail page.
* The members dialog lists every team profile in its picker (the `/team` list is public and small); very large labs would need search-as-you-type.
* Domain content does not refetch on a live language switch (existing behaviour, `useApiResource` keys on path); chrome flips live.

## 19. Explicitly deferred

AI assistant/summaries, recommendations, grants/funding, CV builder, ORCID/DOI, task boards/Kanban, budgeting, time tracking, activity feed,
comments, group chat, RSVP/ticketing, calendar sync, per-user workspace view for managers, bulk relationship operations, account
disable/enable, role-management redesign, and Phase 22.
