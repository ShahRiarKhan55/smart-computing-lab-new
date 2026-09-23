# Phase 11 — Lab Forum / Research Community

Status: **done** (2026-09-22). Web-only new UI, server-only new routes; **no schema
migration** (the Forum tables were already created, empty and unused, in Phase 8 — see
`docs/architecture/phase8-platform-architecture.md` §9). `dev.db` byte-identical to before
this phase (`sha256 70d2f21d…62dc`, 7 team members / 4 publications / 3 news / 5 research
areas / 1 admin user, Forum tables still at 0 rows — nobody has posted yet).

This phase extends the existing architecture (permissions, visibility, audit, search,
navigation) exactly as Phase 9/9.1/10/10.1/10.5 established it. It does **not** introduce a
second policy system, a second design system, a second search backend, or a new role.

---

## 1. Architecture

```
React frontend (pages/community/*, components/Forum*)
    ↓
Express REST API (routes/forum.routes.ts)
    ↓
Prisma
    ↓
SQLite (ForumCategory, ForumPost, ForumComment, ForumReaction, ForumMention — Phase 8 schema)
```

New server files:

- `src/routes/forum.routes.ts` — every `/api/forum/*` endpoint.
- `src/lib/forumSerializers.ts` — response shaping shared by every read path (author, category ref,
  reaction aggregation, comment counts, status/visibility filters, pagination).
- `src/lib/forumMentions.ts` — resolves `@[Name](member:id)` tokens to accounts and keeps
  `ForumMention` rows in sync (only NEWLY mentioned users are notified on an edit).
- `src/lib/notify.ts` — the `notify()`/`notifyMany()` integration point (writes `Notification`
  rows; no reader exists yet — see §14).

New shared files:

- `packages/shared/src/schemas/forum.ts` — every forum Zod schema/type, the reaction/status enums,
  pagination constants, and the mention-token parser (`splitForumBody`, `plainTextForumBody`,
  `mentionedTeamMemberIds`, `mentionToken`) — used by **both** the server (excerpts, resolution) and
  the client (safe rendering, composer inserts).
- `permissions.ts` additions: `canManageForumCategories`, `canCreateForumTopic`, `canCommentForum`,
  `canReactForum`, `canMentionInForum`, `canEditForumPost/Comment`, `canDeleteForumPost/Comment`.
  Moderation (pin/lock/hide/move/manage-category) reuses `canModerate`, which Phase 9 already
  reserved for this ("Forum moderation (used by a later phase; defined here so the matrix lives in
  one place)").

New web files:

- `pages/community/{ForumIndexPage,ForumCategoryPage,ForumTopicPage}.tsx`.
- `components/Forum{Body,Category Card,TopicCard,TopicList,Comment,CommentList,CommentComposer,
  Composer,CategoryFormModal,ModerationControls,MoveTopicModal,ContextBadge,MentionPicker}.tsx`.
- `navConfig.ts`: a `community` group (`{ id: "community", label: "Community", items: [{ to:
  "/community/forum", label: "Forum" }] }`) inserted between People and Schedule — the smallest
  entry that gives the new route a place in the header, per Phase 10.1's own instruction ("Forum...
  will join a 'Community' group then").
- `styles/components.css` / `styles/pages.css`: forum-specific shapes only (`.topic-row`,
  `.comment`, `.reaction-btn`, `.mention-picker`, `.forum-*` page layout). Everything else — cards,
  badges, buttons, modals, forms, empty/loading/error states, `AdminBar` — is reused unchanged.

---

## 2. Database model (Phase 8, unchanged)

```
ForumCategory ─< ForumPost ─< ForumComment        (one level: no reply-to-reply)
                    │              │
                    ├─< ForumReaction (post OR comment, XOR by CHECK)
                    ├─< ForumMention (post OR comment, XOR by CHECK)
                    └─< ForumPostRevision (snapshot of the OLD title/body on every edit)
```

- **Visibility lives on the category only.** A post/comment is never more public than its
  category; moving a post to another category (manager-only) is the only way its audience
  changes — audited as `FORUM_POST_MOVED`.
- **Status**: `ACTIVE | HIDDEN | DELETED` on both posts and comments. `ACTIVE` is what a guest/
  member sees; a manager also sees `HIDDEN` (to review and restore it); **`DELETED` is never
  returned by any read endpoint, for any viewer** — a deleted topic/comment is gone, not merely
  hidden (`visibleForumStatus()` in `forumSerializers.ts` is the one function that decides this,
  reused everywhere a post/comment is read).
- **Author** is a `User` (account), not a `TeamMember`, because only accounts can be moderated/
  notified — but every response resolves it to the linked `TeamMember` (`toForumAuthor()`):
  a real profile → `{teamMemberId, name, initials}`; no linked profile → `"Lab member"`; deleted
  account (`authorId` is `SetNull`) → `"Former member"` (exactly the label Phase 8 §9 specifies).
  **The account id is never serialised** — same rule as `isOwn`/Phase 9.1.
- **Reactions**: `LIKE | LOVE | INSIGHTFUL | THANKS` (the set already documented on
  `ForumReaction.kind` in `schema.prisma`), one row per `(user, target, kind)`, enforced by the
  existing `@@unique` indexes — duplicate `POST /reactions` calls are an idempotent no-op (the
  route catches the resulting `P2002` and returns the current, unchanged counts).
- **No migration was needed or performed.** `prisma migrate diff --from-url file:dev.db
  --to-schema-datamodel schema.prisma --exit-code` reports "No difference detected" both before
  and after this phase.

---

## 3. Mentions — a deliberate change from the Phase 8 sketch

Phase 8 §9 sketched the canonical token as `@[Display Name](user:<id>)`. **This phase anchors it
on the TeamMember id instead: `@[Name](member:<id>)`.** Reason: the token is stored in `body` and
`body` is served back to clients verbatim (plain text, never HTML) — embedding a real **account**
id in text that reaches the browser would violate the single most important constraint in this
codebase ("no account IDs leak into public responses"). A TeamMember id is already public (it is
the same id every `/team/:id` URL and `PersonLink` use), so anchoring there is safe.

- **Client**: composes/display via `splitForumBody()` (shared) — the body is split into plain text
  and `{teamMemberId, name}` mention segments and rendered as `<Link>`s among ordinary text nodes.
  No `dangerouslySetInnerHTML` anywhere; line breaks are preserved by `white-space: pre-wrap`
  (`.forum-body` in `components.css`), not by injecting `<br>`.
- **Server**: `resolveMentions()` maps the mentioned TeamMember ids to accounts (only those with a
  linked login can be notified — an id that does not resolve is silently dropped, not rejected: the
  composer only ever inserts real ids from a picker, so this is defence in depth). `syncMentions()`
  makes the `ForumMention` rows match the resolved set and returns only the **newly** mentioned
  users, so re-saving a post with the same `@mention` does not re-notify (Phase 8 §9's reason the
  table exists instead of re-parsing on every read) — verified by `forum-regression.mjs`.
- Phase 11 skips live `@`-triggered autocomplete (explicitly allowed to by the brief): `+ Mention
  someone` opens a small selectable list (`ForumMentionPicker`) and inserts the token at the cursor.

---

## 4. Visibility & permissions

| | GUEST | MEMBER | LAB_MANAGER | ADMIN |
|---|---|---|---|---|
| Read PUBLIC categories/topics | ✔ | ✔ | ✔ | ✔ |
| Read LAB_ONLY categories/topics | ✘ | ✔ | ✔ | ✔ |
| Create topic / comment / react | ✘ | ✔ | ✔ | ✔ |
| Edit own topic/comment TEXT | ✘ | ✔ | ✔ (only if they are the author) | ✔ (only if they are the author) |
| Delete own topic/comment | ✘ | ✔ | ✔ | ✔ |
| Delete **anyone's** topic/comment | ✘ | ✘ | ✔ | ✔ |
| Pin / unpin / lock / unlock / hide / unhide / move | ✘ | ✘ | ✔ | ✔ |
| Manage categories (create/edit/delete) | ✘ | ✘ | ✔ | ✔ |

A deliberate, spec-driven split: **editing TEXT is author-only, even for a manager**
(`canEditForumPost(actor, isAuthor) = isMember(actor) && isAuthor` — a manager who is not the
author gets 403 on `PUT`). A manager **moderates** (hide/lock/pin/move/delete) rather than
silently rewriting someone's words; **deleting** is the author *or* a manager
(`canDeleteForumPost`). This is covered explicitly in the unit policy matrix
(`canEditForumPost (not the author)` is `false` for every role including ADMIN) and in
`forum-regression.mjs` ("even a manager cannot silently rewrite someone else's topic text").

Server-side, every route goes through the same primitives the rest of the app uses:
`visibleTo(viewer)` (now applied through the `category` relation for posts/comments, since they
have no `visibility` column of their own), `requireCan`, `requireEditor` (reused as-is: its
`canEdit(actor, isLead)` parameter is simply given `canEditForumPost`/`canDeleteForumPost`
instead of a project/group's lead check), and `recordAudit`. No inline `.role === "..."` exists
anywhere in `forum.routes.ts` (enforced by the same static scan `api-regression.mjs` already runs
on every `*.routes.ts` file).

---

## 5. API

```
GET    /api/forum/categories                      list (visibility-filtered, with topicCount/lastActivityAt)
POST   /api/forum/categories                       manager
GET    /api/forum/categories/:slug                 single (404 if hidden from the viewer)
PUT    /api/forum/categories/:id                    manager
DELETE /api/forum/categories/:id                    manager; 409 while it still holds any topic

GET    /api/forum/posts?category=&project=&page=&limit=   list (pinned DESC, lastActivityAt DESC, id DESC)
POST   /api/forum/posts                             member
GET    /api/forum/posts/:id?page=&limit=            detail + paginated comments
PUT    /api/forum/posts/:id                          author (title/body/project) and/or manager (categoryId only)
DELETE /api/forum/posts/:id                          author or manager (soft delete)
POST   /api/forum/posts/:id/{pin,unpin,lock,unlock,hide,unhide}   manager
POST   /api/forum/posts/:id/comments                 member (not on a locked/inaccessible topic)
POST   /api/forum/posts/:id/reactions  {kind}         member
DELETE /api/forum/posts/:id/reactions/:kind           member (own reaction only)

PUT    /api/forum/comments/:id                       author
DELETE /api/forum/comments/:id                        author or manager
POST   /api/forum/comments/:id/reactions  {kind}
DELETE /api/forum/comments/:id/reactions/:kind
```

All bodies validated with the shared Zod schemas in `schemas/forum.ts`; the author/actor always
comes from the session (`req.user`), never the request body (a forged `authorId` is ignored —
tested explicitly). Pagination: `page`/`limit` are clamped
(`FORUM_TOPICS_MAX_LIMIT = 50`, `FORUM_COMMENTS_MAX_LIMIT = 100`, `FORUM_MAX_PAGE = 10000`); an
out-of-range value is a 400, not a silently-clamped success.

**Ordering** (documented, deterministic): topics — `pinned DESC, lastActivityAt DESC, id DESC`;
comments — `createdAt ASC, id ASC`. `lastActivityAt` is bumped on the post whenever a comment is
added, so "recently active" naturally includes recently-discussed, not just recently-created,
topics.

---

## 6. Reactions, comment counts, moderation state — all computed once

`forumSerializers.ts` provides the batch loaders every list/detail endpoint uses
(`loadPostReactions`, `loadCommentReactions`, `loadCommentCounts`): one `groupBy` for aggregate
counts, one more for "the viewer's own reactions", for the whole page of results at once — never
N+1 per row. A `ForumReactions` response is always `{counts: {LIKE,LOVE,INSIGHTFUL,THANKS},
mine: [...]}`; only the viewer's **own** reaction kinds are ever named, never another user's.

---

## 7. Project / research context

`ForumPost.projectId` (already in the Phase 8 schema) links a topic to a `ResearchProject`.
Creating/editing a topic validates the project exists and is visible to the actor
(`assertProjectSelectable`); a response nulls the `project` field when the linked project is not
visible to *that* viewer (same pattern as a project's `group` field), so a public topic can never
be used to discover a hidden project's title. `ProjectDetailPage` shows a **Community Discussions**
section (`GET /forum/posts?project=<id>&limit=5`) only when at least one visible topic exists — no
empty section, no hard-coded data. Research-Area linking was intentionally **not** added: Phase 8's
own schema only modelled `ForumPost → ResearchProject` (see its "relationship cardinalities" note),
and adding a second FK would be exactly the kind of unrequested schema change §5/§27 of the brief
asks to avoid; it is a candidate for a later phase.

---

## 8. Search integration

Extended, not replaced: `SEARCH_TYPES` gained one entry, `"forum-topic"`, appended last (order is
still a compile-time-enforced invariant — `search.ts` throws at import if the `sources` array
order does not match `SEARCH_TYPES`). The new source's `base()` is `{ category: visibleTo(viewer),
...visibleForumStatus(viewer) }` — still only `visibleTo`, still zero raw SQL, still no
visibility/role literals in `search.ts` (the same static scan `search-regression.mjs` runs on that
file passes unchanged). A result's `meta` packs category · author · (optional) project, matching
how every other type packs its context into one string rather than growing the shared
`SearchResult` shape. Counts/pagination/tiering (title-prefix / title-contains-all-words / other)
work exactly as for every other type.

---

## 9. Audit logging

New `AuditAction`s: `FORUM_CATEGORY_{CREATED,UPDATED,DELETED}`,
`FORUM_POST_{CREATED,UPDATED,DELETED,PINNED,UNPINNED,LOCKED,UNLOCKED,HIDDEN,RESTORED,MOVED}`,
`FORUM_COMMENT_{CREATED,UPDATED,DELETED}`; new `AuditEntityType`s `FORUM_CATEGORY`, `FORUM_POST`,
`FORUM_COMMENT`. Every write goes through the existing `recordAudit()`/`recordVisibilityChange()`
inside the same transaction as the change (a rejected request leaves no row — verified). `details`
never holds a post/comment body (only `title`, ids, counts) — the existing forbidden-key tripwire
in `audit.ts` (`pass|hash|secret|token|cookie|session|body|content|message`) still applies
unmodified and is exercised by `forum-regression.mjs`.

---

## 10. Notifications — the integration point, not the feature

Phase 8 §10 designed `Notification` and a `notify()` helper; nothing used it yet. This phase adds
`src/lib/notify.ts` and calls it — inside the same transaction as the triggering change — for
`FORUM_MENTION` (a newly-mentioned user), `FORUM_COMMENT` (the post's author, when someone else
comments) and `FORUM_REACTION` (the post's/comment's author, when someone else reacts); never for
the actor's own action. **No notification center exists**: no bell, no list endpoint, no UI. This
is deliberately the smallest possible "integration point" — a future phase can read these rows
without any backfill.

---

## 11. UI / accessibility / responsive

Built entirely from Phase 10.5 primitives: `PageHeader` (breadcrumbs on category/topic pages,
eyebrow on the index), `SectionHeader`, `Badge`/`StatusBadge`-style `ForumContextBadge` (word
labels — "Pinned"/"Locked"/"Hidden" — never colour/icon alone), `Avatar`, `EmptyState`,
`LoadingState`, `ErrorState`, `Modal` (composer, category form, move-topic, delete confirmation —
**no `window.confirm`**), `AdminBar` (moderation controls render inside it, exactly like every
other detail page's edit bar), the shared `.btn`/`.form-group`/`.chips` classes. One `<main>`, one
`<h1>` per page (breadcrumbs replace the eyebrow on detail pages, matching every other detail
page). Reaction buttons and mention-picker items are ≥40px tall; every interactive element has a
real text accessible name — reactions read "Like (3)", never an emoji alone. Verified responsive
(no horizontal scroll) and screenshotted at 390/768/1024/1366/1440px.

---

## 12. Security

- **No `dangerouslySetInnerHTML` anywhere.** `ForumBody` renders text + `<Link>` segments only.
  A body/comment containing `<script>…</script>`, `<img src=x onerror=…>` or `javascript:` is
  stored and returned verbatim as a JSON string and rendered as inert text — proven both at the API
  layer (`forum-regression.mjs`: the hostile string round-trips unchanged) and in a real browser
  (`browser-regression.cjs`, `ONLY_FORUM=1`: no `<script>`/`<img>` element exists inside
  `.forum-body`, and the injected `onerror`/`<script>` never actually runs).
- Guests: 401 on every write; LAB_ONLY content and HIDDEN posts/comments: 404, identical to
  missing (never 403, so existence is never leaked to someone who cannot see it).
- Malformed ids (`assertValidId`/`requireEditor`'s built-in check) → 400 before any query;
  unknown ids → 404, never a 500.
- Client-provided `authorId`/role/visibility values are always ignored; ownership is always
  computed server-side from the session.
- No account id (`userId`) is ever present in a forum response — enforced by the same static scan
  that already covers every other shared schema and the whole web source
  (`\buserId\b` must not appear in `packages/shared/src/schemas/*` or `apps/web/src/**`).

---

## 13. Pagination

Documented in §5. Topics default to 20/page (max 50); comments default to 30/page (max 100).
Tested for: no duplicate/missing items across a full page sweep, a clamped over-large `limit`
(400), `page=0` (400).

---

## 14. Deferred (explicitly out of scope for this phase)

Private messaging, a notification **center** (bell/list UI), real-time delivery, file
attachments/gallery, translation of forum content, a second/nested reply level, Research-Area
linking on topics, a rich-text editor, FTS5/Elasticsearch, a new role, dark mode, deployment.
`StoredFile.entityType` already lists `FORUM_POST`/`FORUM_COMMENT` (Phase 8) as the attachment
integration point for whenever file uploads ship.

---

## 15. Testing

- **Unit** (`npm run test:unit`, pure functions, no DB): 267 checks (was 210) — 14 new
  permission-matrix rows plus the "unknown role" fail-closed sweep extended to cover them.
- **API regression** (`npm run test:api`, DB copy): 559 checks, unchanged — no regression.
- **Search regression** (`npm run test:search`, DB copy): 209 checks — extended for the 7th type
  (counts objects, a static-scan pass on the now-larger `search.ts`).
- **Search cost** (`npm run test:search-cost`): 10 checks — updated for 7 per-type COUNTs.
- **Forum regression** (`npm run test:forum`, new, DB copy): **90 checks** — PUBLIC visibility,
  AUTH, OWNERSHIP, MODERATION, LOCK, REACTIONS, MENTIONS, PROJECT CONTEXT, PAGINATION, SECURITY,
  AUDIT. Proven able to catch a real regression: a one-line mutation that made `HIDDEN` posts
  visible to everyone was caught (2 failures) by this suite before being reverted.
- **Browser** (`node scripts/browser-regression.cjs`, `ONLY_FORUM=1` for just this section, ~1 min;
  full run for the whole app): full run **722 checks, 0 failed** (was 671 before this phase, plus
  the pre-existing sections updated for the header's new width — see below). Screenshots at
  390/768/1024/1366/1440px for the forum index and a topic page.

### Baseline tests updated (not weakened) by this phase

Adding the Community/Forum nav entry legitimately changed some Phase 10.1 test fixtures — each was
updated to describe the new, correct state, never loosened:

- Top-level nav lists (`N1`, `K1`, `H5`, `SAME_TOP`, hamburger-mode section lists) now include
  `"community"`.
- The "no more than 6 top-level entries" cap became 7 (6 real entries + headroom), matching the
  cap's original margin.
- `search.ts`'s per-type filter chips and the keyboard-Tab-count test account for the 7th
  (`forum-topic`) chip.
- The **real** finding: at 901px (the narrowest "grouped, no hamburger" width, tested against the
  ADMIN header — the widest), the sixth top-level group left the header touching the logo (a real,
  if minor, layout regression). Fixed with a small padding reduction on `.nav__links > li > a,
  .nav__trigger` (`1.1rem → 0.85rem`) — not a breakpoint change, not a redesign; the hamburger
  threshold (900px) and every previously-passing exact-pixel assertion are unchanged.
- The static "navigation architecture intact" scan now asserts the Community group **exists** with
  a Forum link (previously it asserted the opposite — that Phase 10.1 shipped with none), and still
  asserts Messages/Notifications do not exist yet.

---

## 16. Verification summary

- `packages/shared`, `apps/server`, `apps/web`: all build clean (`tsc`, `vite build`).
- `prisma validate`: valid. `prisma migrate diff --exit-code`: no difference (no migration).
- SQLite `PRAGMA integrity_check`: `ok`. `PRAGMA foreign_key_check`: no violations.
- `dev.db` sha256 unchanged (`70d2f21d…62dc`) and every row count unchanged throughout this phase;
  Forum tables remain at 0 rows (real, unseeded — a genuine deployment starts by creating
  categories through the UI/API, not a seed script; see §17).
- Reference implementation (`Lab-Website/reference/`) untouched.
- No account id, credential, session id or password ever observed in a forum response, in ~2800
  real API response bodies scanned by the browser suite plus the API suite's explicit checks.

## 17. Seeding

No categories are seeded by default. If the project's seeding conventions ever want defaults
(Research Discussions, Technical Questions, FPGA/Hardware, Machine Learning, Publications, Lab
Announcements, General — the categories sketched in the brief), the idempotent pattern already
used by `prisma/seed.ts` (skip if `ForumCategory` count > 0) is the place to add it; this phase
deliberately leaves that decision to whoever first populates the real forum, per "do not
unexpectedly modify production-like data" / "seed only if the current project conventions allow
it".
