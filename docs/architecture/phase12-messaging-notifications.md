# Phase 12 — Private Messaging + Notifications

Status: **done** (2026-09-22). Web-only new UI, server-only new routes; **no schema migration**
(Conversation/ConversationParticipant/Message/Notification were already created, empty and
unused, in Phase 8 — see `docs/architecture/phase8-platform-architecture.md` §"Private
messaging"/§"Notifications, audit log, translations"). `dev.db` untouched by this phase's work —
every test run in a copy (see §20).

This phase extends the existing architecture (permissions, visibility, audit, serializers,
navigation, Phase 10.5 design system) exactly as Phases 9–11 established it. It does **not**
introduce a second policy system, a second design system, a new role, real-time transport, or
email/push notifications.

---

## 1. Architecture

```
React frontend (pages/{Messages,Conversation,Notifications}Page.tsx, components/{Message,Conversation,Notification}*)
    ↓
Express REST API (routes/messages.routes.ts, routes/notifications.routes.ts)
    ↓
Prisma
    ↓
SQLite (Conversation, ConversationParticipant, Message, Notification — Phase 8 schema)
```

New server files:

- `src/routes/messages.routes.ts` — every `/api/messages/*` endpoint (conversations, messages,
  read state).
- `src/routes/notifications.routes.ts` — every `/api/notifications/*` endpoint.
- `src/lib/messagingSerializers.ts` — `toMessageParticipant` (the same `{teamMemberId, name,
  initials}` shape as a forum author, plus a photo), `toMessage`, `toConversationSummary`,
  `previewOf` (message-list preview truncation), `countUnread`.
- `src/lib/notificationSerializers.ts` — `toNotification` (row → API shape, parses the small
  JSON `payload` snapshot).
- `src/lib/notify.ts` — **unchanged code**, only its `NotificationType` now comes from
  `@scl/shared` instead of a local union, so the value set lives in exactly one place. This is
  the same integration point Phase 8/11 already wrote through (`notify`/`notifyMany`); Phase 12
  is the first phase that actually *reads* what it wrote.

New shared files:

- `packages/shared/src/schemas/messages.ts` — conversation/message Zod schemas, pagination
  constants, `MESSAGE_BODY_MAX`.
- `packages/shared/src/schemas/notifications.ts` — `NOTIFICATION_TYPES` (the single source of
  truth for the type enum), notification response/query schemas.
- `permissions.ts` additions: `canMessage`, `canViewNotifications` (both `= isMember`). These
  only gate UI affordances (nav links, the profile "Message" button) — see §5 for why the real
  authorization is membership-based, not role-based.
- `schemas/member.ts`: `MemberProfile` gained one field, `canMessage: boolean`, decided
  server-side (signed in, target has a linked account, not the viewer's own profile).

New web files:

- `pages/{MessagesPage,ConversationPage,NotificationsPage}.tsx`.
- `components/{ConversationList,ConversationListItem,MessageList,MessageBubble,MessageComposer,
  NotificationList,NotificationItem,NotificationBadge}.tsx`.
- `notifications/NotificationsContext.tsx` — holds the unread notification count for the
  signed-in session; fetched once on login and refreshed after actions that can change it
  (visiting `/notifications`, marking one/all read). No polling (see §17).
- `navConfig.ts`: `Messages` and `Notifications` added to the existing `ACCOUNT_NAV` group
  (`My Profile`, `Messages`, `Notifications`, `Admin Dashboard`, `Log out`) — both private,
  never shown to a guest.
- `components/Icon.tsx`: two new glyphs (`message`, `bell`), same 24px/2px-stroke set as every
  other icon.
- `styles/components.css` / `styles/pages.css`: messaging/notification-specific shapes only
  (`.conversation-item`, `.message-bubble`, `.notification-item`, `.notification-badge`,
  `.conversation-header`). The message composer and message-edit controls **reuse** the forum's
  existing `.comment-composer` / `.comment__actions` classes rather than duplicating them.
  Everything else (buttons, badges, forms, `PageHeader`, `EmptyState`, `LoadingState`,
  `ErrorState`, `Avatar`, `PersonLink`, pagination) is reused unchanged.

Forum integration (existing files, extended, not duplicated):

- `src/routes/forum.routes.ts` — the notification calls Phase 11 already made
  (`FORUM_MENTION`/`FORUM_COMMENT`/`FORUM_REACTION` on mention/reply/reaction) are untouched.
  Phase 12 adds exactly three new calls: locking a topic, hiding a topic, and a manager deleting
  someone else's topic/comment now also write a `FORUM_MODERATION` notification to the author
  (never to the actor doing the moderating, and never for the cosmetic/reversible actions
  pin/unpin/unlock — see §9).
- `src/routes/member.routes.ts` — `GET /api/member/:id` now includes `canMessage`.

---

## 2. Database

No migration. The four tables below were created (and documented) in Phase 8 and sat unused
until now:

**Conversation** — `id`, `kind` (`"DIRECT"` always, in this phase), `directKey` (the two
participant account ids, sorted and joined with `:`, **unique** — this is what makes "one direct
conversation per pair" race-safe, see §6), `lastMessageAt`, timestamps.

**ConversationParticipant** — composite key `(conversationId, userId)`, `joinedAt`,
`lastReadAt` (drives unread state, see §8), `archivedAt` (reserved for "delete for me"; not
exposed by any Phase 12 endpoint — every fixture's conversations are simply left in the list).

**Message** — `id`, `conversationId`, `senderId` (nullable: `SetNull` if the account is later
deleted), `body`, `editedAt`, `deletedAt` (soft delete — see §10), `createdAt`.

**Notification** — `id`, `userId` (recipient), `type`, `actorId` (nullable), `entityType` +
`entityId` (polymorphic reference, never a second FK per feature), `targetPath`, `payload`
(small JSON), `readAt`.

Only doc-comment changes were made to `schema.prisma`: the `Notification.type` comment now lists
`FORUM_MODERATION` and points at `@scl/shared` as the source of truth. No column, index, or
table changed.

---

## 3. Conversation model

**One-to-one only.** `Conversation.kind` stays `"DIRECT"`; nothing in this phase ever sets it to
anything else, and every service function assumes exactly two participants. `directKey` is the
enforced invariant: a `DIRECT` conversation with a given pair of accounts can exist at most once,
because the column is `@unique`.

## 4. Participant model

`ConversationParticipant` rows are created exactly once, at conversation creation, for both
accounts, and never afterwards (no one is added to or removed from a direct conversation).
`lastReadAt` is the only field either participant's own actions change.

## 5. Message model

Plain text, always. `body` is never HTML and the frontend never uses
`dangerouslySetInnerHTML` — `MessageBubble` renders it as an ordinary React text child, so
`<script>`, `<img onerror>`, `<iframe>` and `javascript:` all render as inert text (verified in
both the unit and API regression suites, see §20). Editing sets `editedAt`; deleting sets
`deletedAt` **and blanks `body` in the database at the same time** — the row survives (so
ordering and a "message deleted" tombstone still render) but nothing private lingers on disk.

## 6. Notification model

See §2. `payload` is restricted by convention (mirrored from the `AuditLog` `FORBIDDEN_KEY`
guard) to small non-sensitive values — a forum post title, a moderation action word, a reaction
kind — **never** a message body or forum body text. `toNotification` parses it defensively: a
malformed JSON string never throws, it just falls back to `{}`.

---

## 7. Read/unread behaviour

Unread is **derived, not stored per-message**: a participant is unread on a conversation when
`countUnread` (messages from the *other* participant, not soft-deleted, newer than the viewer's
own `lastReadAt`) is greater than zero. This was deliberately chosen over comparing
`Conversation.lastMessageAt` to the viewer's `lastReadAt` directly — that naive comparison marks
a conversation "unread" for the person who just sent the latest message themselves, since they
have not called the read endpoint either (a real bug caught by the API regression suite, fixed
before this phase was called done — see §20). Opening a conversation
(`PATCH /messages/conversations/:id/read`) sets `lastReadAt = now()`; repeating it is always
safe. Notification read state (`Notification.readAt`) is a **separate** concern from conversation
read state — marking a conversation read does not touch any `Notification` row, and vice versa,
matching how forum notifications were never auto-cleared by visiting the topic either.

---

## 8. Forum integration

Phase 11 already wrote `notify()`/`notifyMany()` calls for mention/reply/reaction; Phase 12
changes none of that logic. What's new is **moderation** notifications: locking a topic, hiding
a topic, or a manager deleting someone else's topic/comment now notifies the author
(`FORUM_MODERATION`, `payload: { action, title }`). Deliberately **not** notified: pin/unpin
(cosmetic, reversible, cannot reduce anyone's access) and unlock/unhide (restorative — "keep this
simple" / "don't build a complex moderation workflow", Phase 12 §23). `notify()` already no-ops
on self-notification, so an author moderating their own content is silent by construction.

## 9. Profile integration

A "Message" button appears on `/team/:id` (`MemberPage.tsx`) when `profile.canMessage` is true —
computed server-side as *signed in, target has a linked account, target is not the viewer*. It
starts (or reuses) a direct conversation via `POST /api/messages/conversations` with the
profile's **TeamMember id** (never an account id) and navigates straight to the resulting
conversation.

---

## 10. Permissions

`canMessage` and `canViewNotifications` are both `isMember` — any signed-in account. This is
correct and complete for *whether messaging/notifications exist for you at all*; it is
deliberately **not** where the real privacy rule lives (see §11). Both are added to the
`usePolicy()` hook and the pure-function unit test table (`unit-policy.test.ts`) alongside every
other policy function, including the "unknown role still gets at least this" exemption list they
share with `isMember`/`canCommentForum`.

## 11. Privacy / security

**The real rule is membership, not role**, and it is enforced identically for every endpoint in
`messages.routes.ts` and `notifications.routes.ts`:

- Every conversation/message read or write starts from `loadOwnParticipant` /
  `loadOwnMessage` — a lookup keyed on `(conversationId, req.user.id)` (or `message.senderId ===
  req.user.id`). A conversation/message that exists but the caller does not own returns **404**,
  identical to "does not exist", so a third party (including a manager or admin) can never even
  confirm a private conversation is there — matching the same "safe not-found" convention the
  forum uses for a hidden category.
- Every notification query is scoped to `userId: req.user!.id` in the `where` clause. A
  `?userId=` query parameter, if sent, is never read — the recipient always comes from the
  session. `PATCH /notifications/:id/read` uses `updateMany({ where: { id, userId } })` so an id
  belonging to someone else affects zero rows and answers 404, the same as a nonexistent id.
- **There is no admin/manager override anywhere in this file set.** This was explicitly tested:
  a `LAB_MANAGER` and an `ADMIN` both get 404 reading another user's conversation and an empty
  result (never another user's rows) from `GET /notifications`.
- Sender/recipient are never trusted from the client. `senderId`/`recipientId`/`userId` fields
  in a request body are ignored; a spoofing attempt is asserted against directly in the API
  suite (`sender is always the session`).
- Message/edit/delete authorization is **author-only, unconditionally** — not even a manager may
  rewrite or delete another participant's message (unlike forum moderation, which does let a
  manager delete someone else's post). There is no admin message viewer in this phase.

## 12. API endpoints

```
GET    /api/messages/conversations              — own conversations, paginated, newest first
POST   /api/messages/conversations               { teamMemberId }  — start/reuse a direct conversation
GET    /api/messages/conversations/:id            — message history, paginated
PATCH  /api/messages/conversations/:id/read       — mark read up to now
POST   /api/messages/conversations/:id/messages   { body }  — send
PUT    /api/messages/messages/:id                 { body }  — author edits their own message
DELETE /api/messages/messages/:id                 — author soft-deletes their own message

GET    /api/notifications                        — own notifications, paginated (?filter=unread)
GET    /api/notifications/unread-count           — { count }
PATCH  /api/notifications/:id/read                — mark one of the caller's own read
POST   /api/notifications/read-all               — mark all of the caller's own read
```

## 13. UI components

`ConversationList` / `ConversationListItem`, `MessageList` / `MessageBubble` /
`MessageComposer`, `NotificationList` / `NotificationItem`, `NotificationBadge` — all built from
`Avatar`, `EmptyState`, `LoadingState`, `ErrorState`, `PageHeader`, the shared `.search-pager`
pagination pattern, and the forum's `.comment-composer`/`.comment__actions` classes. No second
design system, no new base components duplicated.

## 14. Navigation

`ACCOUNT_NAV` (signed-in only, per `navConfig.ts`) gained `Messages` and `Notifications` between
`My Profile` and `Admin Dashboard`. `NavGroup` renders a live unread-count `NotificationBadge`
next to the `Notifications` link, reading `useNotifications()` from `NotificationsContext` — a
guest is never in that context tree with a signed-in user, and the count resets to 0 on logout.

## 15. Responsive behaviour

Verified at 390px and 768px via a headless-Edge smoke pass (`/messages`, `/notifications`,
conversation detail): no horizontal overflow, the conversation list becomes full-width rows, the
composer remains usable, and the hamburger nav still opens. The full Phase 12 breakpoint/matrix
sweep (1024–1920px, keyboard-nav walk, mutation testing) described in the original brief was
**not** run in this pass — see §22 "Known limitations".

## 16. Accessibility

One `<h1>` per page (`PageHeader`), a labelled composer (`<label htmlFor>` on the textarea, never
a bare placeholder), keyboard-operable buttons throughout (native `<button>`/`<a>`, no
`div onClick`), an accessible unread indicator (a screen-reader-only "Unread:" prefix ahead of
each unread notification's text — never colour/a dot alone), and touch targets kept ≥44px
(`.conversation-item`, `.notification-item` `min-height: 44px`). No new live regions were added
(a full page reload/refetch is how new messages appear, per §17), so no risk of noisy
announcements.

## 17. No real-time yet

Strictly REST. No WebSocket/SSE/polling loop anywhere in this phase — `NotificationsContext`
fetches the unread count once on login and on explicit refresh calls (visiting
`/notifications`, marking read), never on an interval. A user must revisit or reload a
conversation/notification list to see something new arrive. The service/route boundary
(`messages.routes.ts` / `notifications.routes.ts` / `notify()`) is written so a future real-time
layer (e.g., an SSE stream keyed on the same `Notification`/`Message` rows) could be added
without touching the database or the existing REST contract.

## 18. Audit logging

**No conversation, message, or notification create/edit/delete is ever written to `AuditLog`.**
This was a deliberate choice, not an oversight: `AuditLog` is visible to admins, and logging even
the *structural* fact "user A started a conversation with user B" would leak who is privately
talking to whom to a role this phase explicitly promises has no reach into private messages —
undermining §11 in spirit even without ever storing a message body. The existing
`FORBIDDEN_KEY` tripwire in `recordAudit` (rejects any details key matching
`/pass|hash|secret|token|cookie|session|body|content|message/i`) was left completely unchanged
and continues to protect the forum's own audit rows (moderation actions, which *are* audited, as
before). The API regression suite asserts directly against the database that zero `AuditLog`
rows with `entityType` `MESSAGE`/`CONVERSATION` are ever created, and that no recent audit row's
`details` contains message text.

## 19. Pagination / performance

Conversation list, message history, and notification list are all paginated (`paginate()`,
reused from `forumSerializers.ts`) with documented default/max limits
(`CONVERSATIONS_*`/`MESSAGES_*`/`NOTIFICATIONS_*` in `@scl/shared`). The conversation list never
loads message bodies beyond the single latest-message preview per row (`take: 1`), and never
loads more than the requested page of participants. Unread-count is a single `COUNT` query, not
a list fetch. The one accepted N+1-shaped cost: computing each conversation-list row's
`unreadCount` is one `COUNT` query per row (bounded by the page size, max 50, and skipped
entirely for a conversation with no messages yet) — a possible future optimization is a
denormalized counter, deferred as unnecessary at this scale (see §22).

---

## 20. Testing

**Unit** (`npm run test:unit`, pure functions, no server/database): `unit-messages.test.ts` (38
checks) — request-schema validation (empty/oversized/non-string bodies, hostile content accepted
as literal text), `toMessageParticipant`/`toMessage`/`toNotification` never emit an account id,
deletion blanks the body, `notificationTypeSchema` accepts `FORUM_MODERATION`. `canMessage` /
`canViewNotifications` added to the existing policy table (`unit-policy.test.ts`, now 275
checks). All pass.

**API regression** (`npm run test:messages`, `scripts/messages-regression.mjs`, against a DB
copy): 73 checks — guest 401s, self-message rejection, conversation dedup + a real concurrent
create race (3 simultaneous requests resolve to one row), participant-only access (404 for a
non-participant, a manager, and an admin alike), message validation (empty/oversized/non-string),
sender-spoofing ignored, hostile content stored/returned as an inert literal, author-only
edit/delete (a manager gets 403), unread state (set on send, cleared on read, idempotent, never
true for your own messages), notification creation + privacy (own-only lists, unread-count,
mark-one/mark-all, another user's notification untouched), the forum
mention/reply/reaction/moderation → notification pipeline, "pinning never notifies", private
message text absent from `/api/search` results, and zero message/conversation `AuditLog` rows.
All pass. Existing suites re-run against the same build with **zero regressions**:
`test:unit` (275+64+38), `test:api` (559, after updating one field allow-list to include the new
`canMessage` key), `test:forum` (90), `test:search` (209).

**Browser** (headless Edge / CDP, ad hoc smoke script — not committed to `scripts/`): 17 checks —
login, the profile "Message" button, composing and sending, no injected `<script>` element in a
message bubble, the recipient's unread nav badge, the notifications page rendering and
mark-read-on-click, opening the conversation from the notification, a reply from the second
account, the conversation list, and a 390px responsive pass (no horizontal overflow) on both
`/messages` and `/notifications` — with zero browser console errors and zero failed (5xx)
requests across the whole run. Three screenshots were reviewed visually (desktop conversation
view, notifications list, 390px mobile) and match the Phase 10.5 design language.

**Not run in this pass** — see §22.

**Database integrity**: `prisma validate` passes; `PRAGMA integrity_check` → `ok`; `PRAGMA
foreign_key_check` → no violations, on the test copy. The real `apps/server/prisma/dev.db` was
never pointed at by any test run in this phase (its mtime is unchanged from before this session)
and required no migration.

---

## 21. Security response scan

Every response shape emitted by the new routes was checked (both by direct inspection of the
serializers and via the API/browser test assertions) for: account ids (`toMessageParticipant`
never includes `userId`; asserted in both the unit and API suites), session ids, password
hashes, credentials/tokens (none of these fields exist anywhere in the messaging/notification
code path), and another user's private content (participant-only 404s, own-notifications-only
scoping). `payload` JSON is limited by convention to small safe values (titles, action words,
reaction kinds) and never a message/forum body.

## 22. Known limitations / deferred features

- The full Phase 12 responsive/accessibility/mutation-testing matrix from the original brief
  (nine breakpoints, full keyboard-navigation walk, deliberately-broken-guard mutation testing)
  was **not** run — only a 390px/768px spot check plus the assertions already listed in §20/§16.
- `ConversationParticipant.archivedAt` ("delete for me") exists in the schema and is documented,
  but no endpoint sets or reads it in this phase — every conversation a user has ever started
  stays in their list.
- No message search, no message attachments/files, no group conversations, no rich text, no
  read receipts beyond the coarse per-conversation `lastReadAt`, no notification batching/digest,
  no email/push/SSE/WebSocket — all explicitly out of scope for Phase 12.
- The `unreadCount` per conversation-list row costs one query per row (see §19); acceptable at
  the current scale, worth revisiting if conversation lists grow very large.

## 23. Future real-time integration points

`notify()`/`notifyMany()` remain the single place a notification is created; a later phase could
add a push/SSE fan-out there without changing any caller. `Conversation.lastMessageAt` and
`ConversationParticipant.lastReadAt` are already the exact primitives a live "typing"/"delivered"
layer would need — no schema change would be required to add one.

## 24. Confirmations

Phase 13 was **not** started. Nothing was deployed. No new role was introduced. The reference
implementation (`Lab-Website/`) was not touched. `apps/server/prisma/dev.db` was not modified by
any command in this phase — every test ran against a disposable copy in the session scratchpad.
