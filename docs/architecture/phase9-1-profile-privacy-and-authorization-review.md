# Phase 9.1 — Profile privacy & authorization review

A cleanup phase on top of `phase9-authorization-and-research-platform.md`. **No schema change, no
migration, no new feature.** The real `dev.db` is byte-identical to its pre-9.1 state.

## 1. What changed

**Internal account ids no longer leave the server.** `GET /api/team`, `GET /api/team/:id`,
`GET /api/member/:id`, `GET/PUT /api/profile` and the `POST/PUT /api/team` responses used to carry each
profile's `userId` (which disclosed *which profiles have accounts* and the internal account id). They now
carry a server-computed boolean instead:

```json
{ "id": "…", "isOwn": true, "name": "…", "initials": "…", "role": "…", "category": "…",
  "department": "…", "bio": "…", "photoUrl": "…", "sortOrder": 0 }
```

* `isOwn` is `true` only when the request's session belongs to the account linked to that profile.
  Guests, unlinked profiles, other members' profiles and stale/forged/deleted sessions are all `false`.
  Managers get `false` on other people's profiles too (they may *edit* them, but they don't *own* them).
* One serializer, `toTeamMember(row, viewer)` in `apps/server/src/lib/serializers.ts` (previously duplicated in
  `team.routes.ts` and `profile.routes.ts`), and one helper, `isOwnProfile(viewer, userId)`, which delegates to
  the existing central `canEditOwnProfile`. The `userId` column is still read internally (ownership, lead checks,
  account linking) but never serialised.
* `GET /team`, `GET /team/:id` are now behind `optionalAuth` (they need the viewer to compute `isOwn`), and
  `optionalAuth` sets `Vary: Cookie`, because these bodies now differ per session.
* Shared schemas: `teamMemberSchema` / `memberProfileSchema` replace `userId` with `isOwn: boolean`.

**The UI uses `isOwn` for UX only.** `usePolicy().canEditProfile(isOwn)` calls the new central
`canEditProfileView(actor, isOwn)` in `permissions.ts` (`(actor && isOwn) || canEditOtherProfile`), so a visitor who
logs out while a profile is still on screen loses the controls immediately, even though the loaded data still says
`isOwn: true`. Replaced call sites: `TeamPage`, `MemberPage`, `PublicationsPage`, `NewsPage`. The admin dashboard's
"unlinked members" list is now derived from the admin-only `/users` list (`teamMemberId`), not from the public team list.
The server still authorises every write (`requireOwnerOrManager` → `canEditProfile`).

**One inline role check removed from the web app:** `ProtectedRoute` compared `user.role !== "ADMIN"`; it now takes a
policy function (`allow={canManageUsers}`).

## 2. Reviewed and unchanged (verified, not modified)

* **Project lead / group lead** — symmetric by construction (`requireEditor` + `canEdit*` + `*_MANAGER_ONLY_KEYS`):
  content fields and membership only; `visibility`, `slug`, `sortOrder` (and `groupId` for projects) are 403 even when the
  value is a no-op or falsy (`0`, `null`); a mixed body is rejected whole; delete is manager-only; leading one resource
  grants nothing on another. Groups have no parent, so "move a group" does not exist; moving a *project* between groups
  is manager-only and covered.
* **Visibility** — unchanged Phase 9 model; hidden ⇒ 404 byte-identical to a missing id; nested data and counts are
  filtered in the query.
* **Audit** — unchanged; rejected requests write nothing; no secret material in any row.
* **Roles** — unknown role string ⇒ MEMBER; only ADMIN changes roles; nobody changes their own; a client-sent
  `userId`/`role` on profile/team writes is ignored (no re-linking, no account role change).

## 3. Tests

| Suite | Before | After |
|---|---|---|
| `npm run test:unit -w apps/server` | 189 | **210** (+`canEditProfileView` rows, `isOwnProfile`/`toTeamMember`) |
| `npm run test:api -w apps/server` (DB copy) | 434 | **559** (+125: section "phase 9.1") |
| `scripts/browser-regression.cjs` (headless Edge, DB copy) | 118 | **141** (+23) |

The API section covers: no `userId`/account id/credential key in any profile or nested response for every viewer, exact
field allow-lists for `/team` and `/member/:id`, `isOwn` for own/other/unlinked/guest/manager/admin, logout, replayed
session id, deleted-account session, forged cookie, `Vary: Cookie`, mass-assignment of `userId`/`role`; group- and
project-lead allowed/forbidden matrices; guest visibility for projects, groups, publications, news and research areas;
hidden nested resources and counts; MEMBER / LAB_MANAGER / ADMIN / unknown-role operations; self-role changes; static scans
(no inline role comparison, no `userId` in web code or shared schemas, every mutating route guarded); audit presence,
absence-on-rejection and secret scan (incl. real password hashes, session ids and cookies from the run).
`ONLY_PHASE91=1 node scripts/api-regression.mjs` runs just that section (used for mutation testing).

**Mutation-tested:** 18 deliberate breakages (leaky `userId` in each serializer, `isOwn` true for everyone / for any
linked profile / never, ignored session, dropped `Vary`, lead may change settings (group and project), any account may
delete a group/project or edit any resource, `visibleTo` leak, unknown role promoted to ADMIN, hidden group leaking through a
project, group count ignoring visibility, audit row on a rejected request, self-role guard off, accounts router open to
everyone, team delete open to everyone, and a broken UI ownership check in the browser suite) are each caught by 2–53 failing
checks; no-op controls stay green.

## 4. Known limitations (unchanged)

No audit-log reader; no pagination; concurrent edits are last-write-wins; the web tsconfig is not strict; an account id is
still returned to its own owner by `/api/auth/me` and `/api/auth/login` (their own session), and admins receive account ids
from `/api/users` by design. `GET /api/team` still reveals nothing about *which* profiles have accounts.
