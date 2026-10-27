# Phase 3B — Alumni directory and team-profile publication consent

Status: implemented and verified **locally** (disposable SQLite files only). Not applied to, or tested against, Turso, Preview or
Production. Release needs the steps under "Release conditions".

## What it does
* `ALUMNI` is a team category (`packages/shared/src/schemas/enums.ts`). It is **not** in `CATEGORY_ORDER` (the team page roster). Alumni
  have their own public page, `/alumni`, linked from the team page, served by `GET /api/alumni` (`routes/alumni.routes.ts`).
  `GET /api/team` keeps listing only the current team, so every existing consumer of that list (home-page counts, team page, account-link
  dropdowns, ...) behaves exactly as before. The relationship pickers opt in to published alumni with `?includeAlumni=1` (see "Known limits").
* `TeamMember.isPublished` (new column, default `true`) is the public-display consent signal. An alumni profile is created
  **unpublished**; an administrator publishes it with an explicit action (`PUT /api/team/:id/publication`). Creating or editing a
  profile never publishes it.
* Alumni profiles can never have a login account.

## Migration
`apps/server/prisma/migrations/20261020120000_team_member_is_published/migration.sql` is one statement:
`ALTER TABLE "TeamMember" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true;` (metadata-only; no table copy, DROP or data rewrite;
the same form as the Phase 8 `visibility` columns). Prisma's own generated SQL for this change is a table rebuild
(`RedefineTables`), which was deliberately not used. Verified locally (`scripts/unit-alumni.test.ts`): existing rows read back as
published, child rows survive, no foreign-key violations, an INSERT from code that does not know the column takes the default, and
`prisma migrate diff` reports no drift against `schema.prisma`.

**Rollout order: migrate first, deploy code second.** Old code keeps working against the migrated database (it never names the column).
New code against an un-migrated database fails on every `TeamMember` query, so deploying code first is not safe. Rolling back the code
after the migration is safe and leaves the column in place.

**Turso:** the reviewed executor (`docs/architecture/turso-migration-executor.md`, "Column additions") now accepts exactly this one form of
`ALTER TABLE ... ADD COLUMN` (BOOLEAN/INTEGER, `NOT NULL`, constant default; nothing broader) and pins the migration file by SHA-256
(`502f8fc34ad05d596084f980c12908c3b01b09eea5e80bb6fd8841b1bf18ce4b`). Locally tested on disposable SQLite files only (accepted and refused statements,
hash edits, apply, idempotency, divergence, missing table, injected COMMIT failure; every existing row must hold the default inside the write
transaction or the run rolls back). **It has not been run against any remote database**: whether Turso applies the `ALTER` transactionally and how
it reports a lost COMMIT is unverified, and applying it remains a separately authorized operator step.

## Who may do what
| Action | Guest | Member | Lab manager | Admin |
|---|---|---|---|---|
| See published profiles (including alumni) | yes | yes | yes | yes |
| See an unpublished profile | no (404) | no (404) | no (404) | yes |
| Create / edit / delete a non-alumni profile | no | own profile only | yes (as before) | yes |
| Create, edit, move into or out of ALUMNI | no | no | no (403) | yes |
| Publish / unpublish (`canPublishMember`) | no | no | no | yes |
| Change `isPublished` through any other payload | refused with 400 (`isPublished` in a create/update body) |

`isPublished` is returned only to administrators; the response shape for everyone else is unchanged. Only ALUMNI profiles can be
unpublished (publishing a non-alumni profile answers 409), and moving a profile out of ALUMNI makes it published again (a current member
is a normal public roster entry), so a non-alumni profile is never hidden.

## Where the rule is applied (`apps/server/src/lib/memberVisibility.ts`)
A profile is shown only when `isPublished === true` (strict; a missing or unexpected value is private), except to an administrator. An
unpublished profile answers 404, never 403.
* Team roster (`/api/team`), alumni directory (`/api/alumni`), team detail, member profile page and its data, `/api/translations/TEAM_MEMBER/:id`.
* Global search (name, bio, history, Japanese text) and the author-name match for publications; the publication list filter by
  researcher; the knowledge and resource researcher filters and researcher references.
* Sitemap (`/alumni` is a static public path; unpublished profiles are never listed).
* Publication detail authors, `GET /api/publications/:id/authors`, `GET /api/news/:id/authors`, project/group members, research-area
  researchers, workspace leads/collaborators/member counts, search-related links.
* Admin content browser, admin translation editor and the overview count: non-administrators see only published, non-alumni profiles.
* **Writes** by someone who cannot see a hidden link: replace-the-set routes (publication/news authors, project/group members, area
  researchers) only consider links the actor can see, so a lab manager saving a list never removes a hidden alumnus's link, and cannot
  add one (the id looks nonexistent).
* Surfaces reached through an **account** (forum authors, messages, notifications, events' organiser, resource owner, knowledge author)
  need no filter: they resolve a profile through `User.teamMember`, and an alumni profile never has an account.

## Account invariant
Enforced on the server, in addition to validation (`accountCategorySchema` excludes ALUMNI for profiles created with an account or an
invitation):
* `POST /api/users` (link an existing profile; create a new profile): `assertProfileMayHaveAccount`, plus a conditional write
  (`NOT category = ALUMNI`) so a concurrent change cannot slip through.
* `PUT /api/users/:id/link`: same.
* `POST /api/invitations`: refuses an alumni profile. `POST /api/invitations/token/:token/accept` re-checks (a profile can become an
  alumnus after the invitation was sent), and the link is conditional.
* `PUT /api/team/:id` moving a profile into ALUMNI: refused with 409 while it has an account; the write is conditional on `userId IS NULL`.
* Google sign-in only signs in an *existing* account and creates neither accounts nor profiles (static check in `unit-alumni.test.ts`);
  an alumni profile has no account, so it cannot sign in through it.

## Tests
`npm run test:unit -w apps/server` (includes `unit-alumni.test.ts`), `npm run test:alumni -w apps/server` (HTTP, 100+ checks including
negative authorization for guest / member / manager / admin), `npm run test:alumni-ui -w apps/server` (Chromium, English and Japanese).
Existing suites that pinned the old shapes were adjusted only where they pinned the researcher reference (`unit-knowledge`,
`unit-resources`).

## Known limits
* Remote Turso is **not** verified: the migration form, the new filters on a remote driver and the transaction behaviour are untested there.
* **Caching (audited).** Every `/api` response defaults to `Cache-Control: no-store` (`app.ts`), and the routes that depend on who is asking add
  `Vary: Cookie` (`optionalAuth`); none of the member-data routes overrides that, so the server and a compliant cache never reuse a JSON response
  and an unpublish takes effect on the very next request (regression-tested). The sitemap is the exception that is public: it is now
  `public, max-age=0, must-revalidate` (it was `max-age=3600`) so a cache revalidates it every time. Not covered, and not claimed: a copy a
  user already has open or saved, a search engine's index, a third-party archive, and a CDN that ignores `no-store`.
* **Pickers.** `GET /api/team` is unchanged by default. The relationship pickers (publication authors, project and group members, research-area
  researchers) call `GET /api/team?includeAlumni=1`, which adds the **published** alumni (an administrator also gets unpublished ones, as
  everywhere); nothing else changed. The other `/api/team` consumers (home and research counts, news/publication filters, forum mentions, knowledge
  and resource researcher options, account-link dropdowns) stay roster-only on purpose.
* **Audit log.** A lab manager's view of the audit log omits events about alumni and unpublished profiles and the publish/unpublish events (their
  `details` carry the name). A profile that was later *deleted* while it was an alumnus is covered as well: its deletion row records
  `"category":"ALUMNI"`, and every row for that entity id is then hidden from managers (nothing is deleted or rewritten; administrators still see
  the whole history). Limit: this relies on the recorded category, never on text; an alumnus whose profile was moved back to a normal category
  before it was deleted is, correctly, treated as an ordinary member.
* **Free text (not solved; manual review only).** The person's name can appear in free text that is not tied to the profile: a publication's
  `authors` string, news, project, group, event, knowledge and resource text, other members' bios, and forum posts. Rewriting those automatically is
  unreliable (a name is not an identity) and could destroy legitimate history, so nothing is rewritten and unpublishing never edits text.
  Review path that exists today: the admin content browser (`/admin`, content search) matches a word against the text fields of research areas,
  projects, groups, publications (title, **authors**, venue), news, events, knowledge, resources and team-member bios, including Japanese
  overrides, with a case-insensitive substring match for Latin text. Its limits: it does **not** search forum posts/comments, messages or
  gallery captions; a name spelled differently (nickname, initials, romanisation) will not match; it finds text, it does not edit it.
  Safest mitigation: search the person's name (all spellings you know) there before publishing or after unpublishing, then edit the hits by hand.
  A forum-wide mention report would be a separate, designed feature.
* Unpublishing hides the profile from listings and APIs; it does not delete it, and administrators still see it.

## Integration with Phase 3A (profile photos)
Verified by `scripts/integration-photos-alumni-regression.ts` (`npm run test:integration-photos-alumni`).
* **Photo access follows the profile.** A `TEAM_MEMBER` photo is served only if the profile is visible to the viewer, checked on every request;
  an unpublished profile's photo is a 404 (identical to a missing file) for guests, members, lab managers and even the account that uploaded it;
  administrators can still read it. Photo responses are `Cache-Control: private, no-store` with `Vary: Cookie`.
* **Generic file deletion respects the alumni rules.** `DELETE /api/files/:id` on a profile photo: a profile hidden from the requester answers 404,
  an alumni profile may be changed by an administrator only (403 otherwise). Other managers' abilities for ordinary members are unchanged.
* **Team update.** `PUT /api/team/:id` takes 3A's write-first lock, but the lock statement only matches a profile the requester may see and (for
  non-admins) may manage, so a hidden profile's `updatedAt` is not written on their behalf; a refused request throws inside the transaction and rolls
  everything back. `photoUrl` is written only when the request names it, in both write branches; `isPublished` only on a category transition; a
  replaced or cleared uploaded photo is retired in the same transaction and its blob removed only after the commit.
* **No alumni photo upload.** `POST /api/profile/photo` needs an account, and alumni have none, so alumni get initials or an external URL (which the
  CSP does not render). A new upload path for alumni is out of scope.
* **Not changed:** `PUT /api/team/:id/publication` and the account-linking transactions remain read-first with the default 5 s limit (the documented
  read-first class); the 503 mapping and embedded-libSQL guard of 3A apply only where 3A mounted them.
