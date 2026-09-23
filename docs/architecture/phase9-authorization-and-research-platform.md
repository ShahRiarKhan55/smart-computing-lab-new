# Authorization, visibility, audit wiring, projects & groups (Phase 9)

Builds on `phase8-platform-architecture.md`, which stays the source of truth for the
architecture. This phase **implements** what Phase 8 designed; where it had to interpret
or deviate, that is listed in "Deviations" below. **No schema migration was needed**:
the Phase 8 tables already covered everything, and the real `dev.db` is byte-identical to
its pre-Phase-9 state.

## 1. Authorization architecture

One place decides who may do what: **`packages/shared/src/permissions.ts`** — pure functions of
`(actor | null, [isLead])`. The API enforces them; the UI imports the *same* functions
(`usePolicy()`) only to decide which controls to show.

```
request ──▶ requireAuth / requireCan(policyFn) / requireOwnerOrManager / requireEditor(policyFn, isLead)
        ──▶ handler: Zod parse ─▶ (visibility / field-level checks) ─▶ transaction { mutate + recordAudit }
```

| Guard (`apps/server/src/middleware/auth.ts`) | Meaning | Status codes |
|---|---|---|
| `optionalAuth` | public route whose result depends on the viewer | never rejects; bad/stale/forged session ⇒ guest |
| `requireAuth` | any account | 401 |
| `requireCan(fn)` | policy function on the acting account | 401 guest, 403 |
| `requireOwnerOrManager(param)` | own linked profile, or manager | 401, 400 bad id, 403 (also for a missing id: no probing) |
| `requireEditor(canEdit, isLead)` | manager, or LEAD of *this* project/group | 401, 400, 403 (no probing) |

* `getSessionUser` re-reads the user on **every** request ⇒ role changes, demotions and account
  deletion apply immediately. An **unknown role string in the DB is treated as MEMBER** (least
  privilege), never trusted.
* Inline `role === "ADMIN"` checks: **30 → 0**. The two remaining literals are inside
  `permissions.ts` itself. A static scan finds 36 mutating routes; only `POST /auth/login` and
  `/auth/logout` lack a guard, as they must.
* Field-level rules live in handlers: a **project/group LEAD** may edit content fields but a request
  containing `visibility`, `slug`, `sortOrder` or `groupId` is a **403**; a member sending
  `visibility` on any content is a **403** (previously silently ignored — see Deviations).

## 2. LAB_MANAGER

Roles are `ADMIN | LAB_MANAGER | MEMBER` (`ROLES` in shared). It is a plain string column, so
**no migration**. Role changes: `roleChangeError(actor, targetId)` — only **ADMIN** may change
roles; nobody may change their own. Therefore a lab manager can neither grant ADMIN nor
promote themself (the whole `/api/users` router is `requireCan(canManageUsers)`), and
self-demotion protection remains (400). Every role change is audited (`ROLE_CHANGED`, from/to).

## 3. Permission matrix

✔ = allowed · · = denied. "lead" = LEAD member of that project/group. Verified row-by-row by
`npm run test:unit -w apps/server` (189 checks) and end-to-end by the API suite.

| Operation | Guest | MEMBER | lead | LAB_MANAGER | ADMIN |
|---|---|---|---|---|---|
| Read PUBLIC content | ✔ | ✔ | ✔ | ✔ | ✔ |
| Read LAB_ONLY content | · | ✔ | ✔ | ✔ | ✔ |
| Receive the `visibility` field in responses | · | · | · | ✔ | ✔ |
| Create/edit publications, news, research areas | · | ✔ | ✔ | ✔ | ✔ |
| Set `visibility` on any content | · | · | · | ✔ | ✔ |
| Delete publications, news, research areas | · | · | · | ✔ *(was admin)* | ✔ |
| Edit own profile / history; link self as author | · | ✔ | ✔ | ✔ | ✔ |
| Edit another profile; set any author link | · | · | · | ✔ | ✔ |
| Create team member; change category / sort order | · | · | · | ✔ *(was admin)* | ✔ |
| Delete team member | · | · | · | · | ✔ |
| Create project / group | · | · | · | ✔ | ✔ |
| Edit project/group content fields; manage its members | · | · | ✔ | ✔ | ✔ |
| Link areas / publications / news to a project | · | · | ✔ | ✔ | ✔ |
| Change slug / sort order / group / visibility | · | · | · | ✔ | ✔ |
| Delete project / group | · | · | · | ✔ | ✔ |
| List / create / delete accounts; change roles | · | · | · | · | ✔ |

## 4. Visibility matrix

Rule (unchanged from Phase 8): allow-list `visibleTo(viewer)`; hidden ⇒ **404, byte-identical to a
missing id**. Nested data is filtered *in the query*, not after.

| Data | Guest | Account (any role) |
|---|---|---|
| `PUBLIC` project / group / publication / news / area | ✔ | ✔ |
| `LAB_ONLY` (same tables) | 404 / absent from lists | ✔ |
| Areas, publications, news linked **inside** a project | only the PUBLIC ones | all |
| A project's **group** | `group: null` unless the group is PUBLIC (id/name/slug never sent) | shown |
| A group's **projects** and `projectCount` | only PUBLIC projects, count matches | all |
| A researcher profile's projects / groups / publications / news | only PUBLIC | all |
| `…/authors` endpoints for a hidden publication/news | 404 | ✔ |

New projects and groups default to **LAB_ONLY** when `visibility` is omitted (fail closed); content
created by members without a visibility stays PUBLIC (existing behaviour).

## 5. Audit

`recordAudit(tx, …)` runs **inside the mutation's transaction**: a rejected or rolled-back request
leaves no row (tested). `details` is flat JSON of ids, roles, counts and **field names** (`changed:
"venue,year"`) — never text values of long fields, passwords, hashes, tokens, session ids or message
content; `recordAudit` throws on forbidden key names (tested) and the suite scans every row it produced.

| Action | When |
|---|---|
| `USER_CREATED` `ROLE_CHANGED` `USER_DELETED` | account admin (Phase 8) |
| `CONTENT_VISIBILITY_CHANGED` | any visibility change (from/to), in addition to the *_UPDATED row |
| `RESEARCH_*` `PUBLICATION_*` `NEWS_*` (`CREATED/UPDATED/DELETED`) | curated content; no-op updates write nothing |
| `PUBLICATION_AUTHORS_CHANGED` `NEWS_AUTHORS_CHANGED` `MEMBER_LINKS_CHANGED` | membership/link changes (added/removed ids) |
| `TEAM_MEMBER_CREATED/UPDATED/DELETED` | people (own-profile edits flagged `own`) |
| `PROJECT_CREATED/UPDATED/DELETED` `PROJECT_MEMBERS/AREAS/PUBLICATIONS/NEWS_CHANGED` | projects |
| `GROUP_CREATED/UPDATED/DELETED` `GROUP_MEMBERS_CHANGED` | groups |

Not audited (deliberately): a member's own history entries; reads; logins.

## 6. Research projects & groups

Schema: Phase 8 tables, unchanged (`ResearchProject`, `ProjectMember`, `ProjectArea`,
`ProjectPublication`, `NewsItem.projectId`, `ResearchGroup`, `GroupMember`).
`TeamMember` remains the researcher entity; nothing is duplicated.

API (all under `/api`, ids not slugs; slug is stored, unique, auto-generated from the title
and manager-editable, for future pretty URLs):

| Endpoint | Guard |
|---|---|
| `GET /projects`, `GET /projects/:id` | `optionalAuth` + `visibleTo` (`detail.canEdit` is a UX hint) |
| `POST /projects` | `canCreateProject` |
| `PUT /projects/:id` | `requireEditor` (manager or project lead) + manager-only fields |
| `DELETE /projects/:id` | `canDeleteProject` |
| `PUT /projects/:id/members` `{members:[{teamMemberId,role}]}` | editor |
| `PUT /projects/:id/areas` `{areaIds}` · `/publications` `{publicationIds}` · `/news` `{newsIds}` | editor |
| `GET/POST /groups`, `GET/PUT/DELETE /groups/:id`, `PUT /groups/:id/members` | same pattern with group leads |
| `GET /member/:id` | now also returns `projects` + `groups` (visibility-filtered) |
| `PUT /users/:id` etc. | admin only (unchanged) |

Relation `PUT`s replace the whole set (matches the existing checkbox-list UI), touch only join
rows and are audited. A news item belongs to one project: linking one that belongs to a **different**
project is a 409 (no silent moves). Deleting a project cascades members/areas/publication links,
keeps and unlinks its news, and removes its `Translation` rows; deleting a group ungroups its
projects. Deleting a team member cascades their memberships.

UI: `/projects`, `/projects/:id`, `/groups`, `/groups/:id` (+ nav links), create/edit/delete
modals, members/areas/publications/news pickers, status filter, "Lab only" badge (managers),
projects & groups on researcher profiles, role select with Lab manager on the admin dashboard.
Zod schemas from `@scl/shared` validate forms; loading/saving/error/empty states are handled.

## 7. Translation integration points (nothing built, nothing blocked)

* `Translation` entity types `RESEARCH_PROJECT` (`title, summary, description`) and `RESEARCH_GROUP`
  (`name, description`) are the allow-list to add to `packages/shared` with the first i18n endpoint.
* Hard-deleting a project/group (and a research area, news item, team member) **already deletes
  its `Translation` rows in the same transaction**, as Phase 8 required.
* The single overlay point for a future `?lang=`: `toSummary()` / `loadDetail()` in
  `projects.routes.ts` and `groups.routes.ts` (and `serializers.ts` for the older entities).

## 8. Search readiness

Predictable `LIKE`-able columns: projects `title, summary, description, slug`; groups `name,
description, slug`; already-existing entities unchanged. A Phase 10 search composes `visibleTo(viewer)`
per entity (so search can never disagree with authorization) and must also apply the *nested*
rules above (e.g. never return a group whose only match is a hidden project).

## 9. Deviations / interpretations of the Phase 8 document

1. **`visibility` is only *returned* to managers.** Phase 8 said the field isn't exposed to unauthorised
   users; "authorised" was read as "may change it" (LAB_MANAGER, ADMIN). Members see LAB_ONLY content but
   no badge.
2. **A member who sends `visibility` gets 403**, not a silent strip. Phase 8's regression check that
   asserted the strip was updated accordingly.
3. **LAB_MANAGER may create/edit team profiles and set category/sort order**; **deleting** a team member
   stays ADMIN-only (Phase 8's matrix was silent; deleting removes a person's profile and history).
4. **Group leads** get the same "own only" edit rights as project leads (Phase 8: "own only (project lead …)"),
   limited to content fields + membership.
5. **Project creation is manager-only** (Phase 8 said MEMBER "own only", which cannot include *creating*
   a project you don't yet lead).

## 10. Known limitations

* No pagination on `/projects`, `/groups` lists (fine at lab scale).
* No audit-log **reader** (API or UI); rows are written and queryable in the DB only.
* Concurrent edits are last-write-wins; no optimistic locking.
* `Translation`/i18n, project images/files and search are intentionally absent.
* **Fixed in Phase 9.1** (`phase9-1-profile-privacy-and-authorization-review.md`). Pre-existing (Phases 1–7):
  `GET /api/team` and `/api/member/:id` returned each profile's `userId` to everyone, which disclosed which
  profiles have accounts and the internal account id. The UI used it for "is this my profile" checks; both
  endpoints now return a server-computed `isOwn` and no account id.
* The web app's tsconfig is not `strict`; the policy hook narrows `SessionUser` at one boundary because of that.

## 11. Verification

`npm run test:unit -w apps/server` (189 policy checks) and `npm run test:api -w apps/server`
(434 API checks: 112 Phase 1–7 + 50 Phase 8 + 272 Phase 9), run against a **copy** of the database.
The suite was **mutation-tested**: breaking one safety property at a time (leaky `visibleTo`, no
visibility gate, unguarded editor, silent audit, lead may change visibility, leaky profile/group/project
nesting, any user may manage accounts, visibility field shown to all) is caught every time (2–40
failing checks each) while a no-op mutation stays green. A 118-check headless-browser pass drives the UI
as guest, member, project lead, lab manager and admin.
