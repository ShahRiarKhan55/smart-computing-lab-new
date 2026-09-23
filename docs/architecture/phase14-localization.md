# Phase 14 — English / Japanese Localization

Status: **done, scoped** (2026-09-23). **No schema migration** — `Translation` (entityType,
entityId, locale, field, value) and the `Locale`/`LOCALES`/`DEFAULT_LOCALE` types already existed,
empty and unused, from Phase 8 (see `phase8-platform-architecture.md` and `enums.ts`'s
`LOCALES`/`localeSchema` comment: *"English is the base: it lives in the entity's own columns;
other locales live in Translation rows."*). This phase is the first to actually read and write
that table, and the first UI translation layer the app has ever had. `dev.db` untouched — every
test ran on a disposable copy (see §12).

This document is deliberately explicit about what got full UI coverage, what got the
architecture-plus-a-representative-slice, and what is documented as deferred. Phase 14 is the
largest single phase to date by page count touched; rather than a shallow pass over every string
in the app, the priority was: (1) a correct, reusable architecture that the rest of the app can be
filled in against incrementally without redesign, and (2) genuine, tested depth on the highest-
traffic surfaces (navigation, home, auth, the five translatable content types end-to-end, common
buttons/errors). §11 lists exactly what still shows English-only text.

---

## 1. Two different problems, two different mechanisms

**A. UI translation** (`nav.research`, `common.save`, `error.notFound`, …) — static strings that
exist independently of any database row. Lives in `packages/shared/src/i18n/{en,ja}.ts`, a flat,
dot-namespaced dictionary. Never touches the database.

**B. Domain-content translation** (a research area's title, a news item's body, a bio) — text that
already lives in an entity's own English column. Never duplicates the entity. An optional override
row in `Translation` supplies the Japanese text for a specific `(entityType, entityId, field)`;
absence of that row means "no Japanese text yet," which falls back to the English column — never a
blank field.

These are intentionally two separate, non-overlapping systems, per the phase brief: no "uncontrolled
JSON blob," no mixing arbitrary user content into the UI dictionary.

---

## 2. UI translation architecture

```
packages/shared/src/i18n/
  en.ts                the base dictionary (~250 keys); values here are BYTE-IDENTICAL to what
                       every English call site rendered before this phase, so no existing browser-
                       regression assertion on English text needed to change
  ja.ts                typed as Record<keyof typeof en, string> — a key present in one file and
                       missing in the other is a COMPILE ERROR, not a runtime surprise
  translatableFields.ts  the domain-content allow-list (§4)
  index.ts             translate(locale, key, vars?), DICTIONARIES, isSupportedLocale
```

`Locale` is `"en" | "ja"` (`packages/shared/src/schemas/enums.ts`, already existed). Default is
`"en"`, per that file's own comment — Phase 14 didn't need to decide this, it was already decided
in Phase 8 and never implemented.

`apps/web/src/i18n/LocaleContext.tsx` — `LocaleProvider` (wraps `<App>` in `main.tsx`, outside
`AuthProvider` so the language survives login/logout), `useLocale()` (`{ locale, setLocale, t }`),
`useT()` (just the translator). `t(key, vars?)` calls `translate()` from the shared dictionary; a
`{name}`-style placeholder in a value is substituted from `vars`.

No scattered `if (locale === "ja") …` anywhere in the codebase — every localized string goes
through `t()`.

### Persistence

`localStorage["scl.locale"]`, validated on every read (`isSupportedLocale`) — an unsupported,
tampered, or pre-Phase-14 value silently becomes English, never a crash and never trusted into a
query. Not tied to the session: survives login, logout, and a direct URL load, exactly as required.
`document.documentElement.lang` is kept in sync for assistive technology.

### Transport to the server

`apps/web/src/lib/api.ts`'s `apiFetch`/`apiUpload` attach `X-Locale: <locale>` to every request,
read synchronously from storage (`currentStoredLocale()` — no React context needed in a plain
function). The server (`apps/server/src/lib/translations.ts`, `resolveLocale(req)`) validates the
header the same way (`isSupportedLocale`) and only ever uses it to choose which language's text to
return — **never** to decide what is visible (see §7).

### Language switcher

`apps/web/src/components/LanguageSwitcher.tsx` — one more `nav__group`-style disclosure button,
reusing Nav's existing WAI-ARIA pattern (Phase 10.1) instead of inventing a second one: a trigger
showing the current locale ("EN" / "日本語"), `aria-expanded`/`aria-controls`, a panel with the two
options (`aria-current="true"` on the active one), Escape closes it and returns focus, a click
outside closes it. Placed in `Nav.tsx` right after the main links and before the account/login
slot, so it appears in the desktop header and — because it is the same `<li>` inside `.nav__links`
— folds into the hamburger menu on mobile automatically, no separate mobile code path.

Adding it as a seventh `.nav__links` item quietly ate the last few free pixels in the already-tight
901px/ADMIN header (a known fragility since Phase 11 added the Community group — see that phase's
memory note). Fixed the same way Phase 11 was: trimmed `.nav__links > li > a, .nav__trigger`
padding (0.85rem → 0.65rem → **0.55rem**) and gave the switcher its own tighter padding
(0.45rem, 2px icon gap). Proven with the real `W 901px (ADMIN)` browser assertion, not by eye.

### Document titles

`useDocumentTitle` (Phase 10.5) is untouched — it just sets `document.title` from whatever string
it's given. Pages now pass `t("title.xxx")` (or a page-appropriate key) instead of a literal
string; because `t()` returns a new string when the locale changes, and the effect's dependency is
that string, the tab title updates **live** when the visitor switches language without navigating —
verified by the browser suite (§10).

---

## 3. Locale-aware formatting

Not implemented this phase. `apps/web/src/lib/format.ts`'s `formatProjectDates`/`formatDateTime`
still call `toLocaleDateString("en-US", …)` unconditionally. This is a deliberate, disclosed
deferral (see §11) rather than a partial, untested `Intl` wiring — changing date formatting touches
every place a project/forum/news date is shown and deserved its own verification pass that there
was no time left for in this phase. The mechanism to fix it is straightforward (pass `locale` from
`useLocale()` into `Intl.DateTimeFormat(locale, …)`) and does not require any further architecture.

---

## 4. Domain-content translation

### The allow-list

`packages/shared/src/i18n/translatableFields.ts`:

```ts
RESEARCH_AREA:    ["title", "description"]
RESEARCH_PROJECT: ["title", "summary", "description"]
RESEARCH_GROUP:   ["name", "description"]
NEWS_ITEM:        ["title", "description"]
TEAM_MEMBER:      ["bio"]
```

This is the allow-list the `Translation` model's own docstring said would live in
`packages/shared` — it didn't exist before this phase. Structural fields (id, slug, sortOrder,
visibility, category, dates, relationships, role, initials, photoUrl, …) are **never** in it and
can never carry an override, in every locale, forever.

### Server (`apps/server/src/lib/translations.ts`)

- `resolveLocale(req)` — the `X-Locale` header, validated (§2).
- `loadTranslations(db, entityType, ids[], locale)` — **one batched query** for a whole list page
  (never one query per row — Phase 14 §38's performance rule). Short-circuits to an empty map with
  **zero queries** when `locale === "en"`, since English is never stored — an English visitor's
  request does exactly the same work as before this phase existed.
- `localize(row, entityType, translations)` — overlays the override onto the allow-listed fields
  only; a missing override, or an empty-string override, means "use the row's own value" — a
  localized field is never blank/`null`/`undefined` because a Japanese override hasn't been
  written yet.
- `applyTranslationOverrides(tx, entityType, entityId, ja)` — inside the caller's own transaction.
  Per field: a non-empty string upserts; `""` or `null` **deletes** the row (falls back to
  English); a field simply absent from the payload is left untouched.
- `getEntityTranslations(db, entityType, entityId)` — the current ja value for every allow-listed
  field (`null` where none exists), for an edit form's prefill.

Wired into the GET (list + detail) and POST/PUT of `research.routes.ts`, `projects.routes.ts`,
`groups.routes.ts`, `news.routes.ts`, `team.routes.ts`. Each route's create/update zod schema
(`research.ts`, `project.ts`, `group.ts`, `news.ts`, `team.ts`) gained an optional
`translations: { ja: { <field>?: string | null } }` fragment via the shared
`translationsField(fieldMax)` builder (`packages/shared/src/schemas/translations.ts`), with the
same max length as the mirrored English field.

**Scope boundary, disclosed:** only the entity a route's own list/detail endpoint returns is
localized. A cross-reference embedded inside another entity's response — a research area's title
shown inside a *project's* summary, a group's name shown inside a project's summary, news/
publications embedded in a *project detail* response — is **not** independently localized this
phase; it shows the base English text there, even if a Japanese override exists and is correctly
returned by that item's *own* endpoint. This is a bounded, intentional simplification (visiting the
item's own page/list shows the localized version) rather than an attempt to localize every nested
reference across every route, which would have meant touching the visibility-sensitive nested
`include`s in `projects.routes.ts`/`groups.routes.ts` far more invasively than the smallest-change
principle in the brief allowed for.

### `GET /api/translations/:entityType/:entityId`

A small, reusable, generic endpoint (`translations.routes.ts`) — the same "one small building
block" precedent as `/api/files`. Returns `{ ja: { field: string | null } }`. Gated by
`requireAuth` only: any logged-in account may read it, because it is exactly the text a
Japanese-locale visitor already sees once published (never a privileged draft), and every
translatable entity type here is PUBLIC or LAB_ONLY — `requireAuth` already grants LAB_ONLY-level
access, so this adds no visibility beyond what the entity's own GET already allows. **Writing**
happens only through the entity's own PUT alongside its other fields, so it is authorized exactly
like every other field on that entity — this route never accepts a write, and there is no new
permission surface to reason about. An `entityType` outside the allow-list is a 404 before any
database access (not even AuditEntityType values like `USER`/`FORUM_CATEGORY` are accepted); a
malformed id is a 400 via the existing `ID_PATTERN`.

### Translation-editing UI (§33: "minimum practical editing UI")

Implemented in full for **`ResearchFormModal`** as the reference implementation:
`useEntityTranslations(entityType, entityId, open)` (`apps/web/src/hooks/useEntityTranslations.ts`)
fetches the current ja values when editing an existing area (never for a brand-new one — it has no
id yet for an override to attach to), and a `.form-fieldset` section holds a plain Japanese
title/description pair next to the English fields. On save, `translations: { ja: {...} }` merges
into the same PUT the English fields already go through — one request, one transaction.

**Disclosed gap:** the same UI pattern was **not** replicated into `ProjectFormModal`,
`GroupFormModal`, `NewsFormModal`, or `TeamMemberFormModal` — their forms only gained the localized
Save/Cancel buttons and error handling (§6). The *backend* for all five entity types is complete and
tested end-to-end (§12); an admin can already set a project/group/news/team-member's Japanese text
today via the entity's own PUT (e.g. from a REST client, or a future UI pass), it just isn't
reachable from those four forms yet. `useEntityTranslations` and the `.form-fieldset` markup are
written to be dropped into each of them with the same few lines `ResearchFormModal` uses.

### Fallback policy (documented once, applied everywhere)

**Domain content:** requested locale → English (the base column) → *(the base column is never
empty for a required field, so there is no further fallback tier)*. **UI dictionary:** requested
locale → English → the raw key string (so a genuinely missing key is visible mistake-text in
testing, never a blank label). Never `undefined`/`null`/empty unless the underlying English content
itself is intentionally empty (e.g. an optional bio).

---

## 5. Navigation, home, and the rest of the UI sweep

**Fully localized:** `Nav`/`NavGroup`/`Footer` (navConfig.ts's `label` → `labelKey`, translated at
render — the architecture stays "navConfig is data," Phase 10.1's own rule, just localized data),
`LanguageSwitcher`, `LoginPage`, `HomePage` (hero, stat labels, every section's eyebrow/title/
loading/error/empty text), page headers (`eyebrow`/`title`/`description`) and their
loading/empty/modal-title/delete-confirmation strings for: Research, Projects, Groups,
Publications, News, Team, Search (landing heading + document title), Contact, Schedule, and the
Admin Dashboard's header/role labels/delete button. `ConfirmDeleteModal` and all five content
`FormModal`s (`Research/Project/Group/News/TeamMember`) share localized
Save/Saving/Cancel/"please check the form" text and route their API-error fallback through
`apiErrorMessage()` (§6).

`usePolicy().roleLabel` — used by every `AdminBar` that shows "{role}: create/edit/delete …" — is
now locale-aware (`ROLE_LABEL_KEY`, exported from `usePolicy.ts`), so Admin/Lab manager/Member
became 管理者/ラボ管理者/メンバー **automatically** everywhere that string was already being
interpolated, without touching each page that uses it. The stored role *value* in the database and
every API response is unchanged in every locale (`ADMIN`/`LAB_MANAGER`/`MEMBER`), per §25's explicit
instruction.

**Deferred, disclosed (still English-only):** ProjectDetailPage, GroupDetailPage, MemberPage,
ProfilePage, the Forum pages/components, GalleryPage and its modals, MessagesPage/
ConversationPage, NotificationsPage, most of ContactPage's body (the contact details themselves are
the reference site's placeholder data, per Phase 10.5's own note — nothing here invents a Japanese
address), and most `AdminBar` action sentences (their English text is unaffected; only the role
name inside them is now localized, as above). None of this is a half-finished attempt — it is
simply not started, and every one of these pages already reads `useT()`-free code that a future
pass can localize with the exact same `t("namespace.key")` pattern used everywhere else, without
any architectural change.

---

## 6. Validation and error messages

Full re-architecture of the API's error contract (moving every one of ~12 schema files' zod
messages to stable codes) was judged out of proportion to this phase (§27's own "make the smallest
clean change needed" instruction, and §26's "avoid... arbitrary text" is about not *guessing*
translations for open-ended messages, not a mandate to rewrite the contract).

What shipped instead (`apps/web/src/i18n/errorMessages.ts`):

- A small, **enumerable allow-list** of the API's actual fixed strings for the generic,
  high-frequency cases (`"Not found"`, `"Unauthorized"`, `"Forbidden"`, `"Conflict"`,
  `"Bad request"`, `"Nothing to update."`, `"Request body must be a JSON object."`, the login
  route's `"Incorrect email or password."`) → a translation key.
- `apiErrorMessage(err, t)`: an `ApiError` whose message matches the allow-list is translated; a
  network failure (`TypeError`, thrown by `fetch` before any response exists) becomes the localized
  "can't reach the server" message; anything else is shown **exactly as the server sent it** — in
  English, in both locales. This is the honest limitation: the open-ended set of per-field zod
  validation messages ("Title is required.", "End date can't be before the start date.", …) is
  **not** translated this phase, and is not machine-translated to paper over that. Wiring these
  properly means the smallest real fix is moving to `{ code, field }` responses (§27), which is
  future work, not this phase's.
- Used from `LoginPage`, `ConfirmDeleteModal`, and all five content `FormModal`s' catch blocks in
  place of the old `err instanceof ApiError ? err.message : "Something went wrong."` pattern —
  same shape, now localized where a mapping exists.

---

## 7. Security

- **Locale never bypasses a permission or visibility check.** `resolveLocale`/`isSupportedLocale`
  only choose which language's *text* comes back from an already-authorized, already-filtered
  query; the `visibleTo(viewer)` predicate that decides *whether a row is even in the result set*
  never sees the locale. Proven, not asserted: `i18n-regression.mjs` requests a hidden `LAB_ONLY`
  area as a guest with `X-Locale: ja` and confirms it is still a 404 (§12), and the browser suite's
  new i18n section confirms a guest with `ja` selected is still bounced from `/profile` to
  `/login`.
- **`GET /api/translations/:entityType/:entityId` cannot be used to discover a hidden entity's
  content**, because it never reveals the base English column — only whatever ja override text was
  already written, which (per the point above) any logged-in account can already see through that
  entity's own localized GET for LAB_ONLY content, or any guest for PUBLIC content. It adds no new
  oracle.
- **XSS.** A translation value is data, end to end: stored as a plain string, returned as a plain
  string, and never rendered through `dangerouslySetInnerHTML` anywhere it's displayed — React text
  nodes escape it exactly like every other user-authored field already on this site (forum posts,
  messages, gallery captions). `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` are
  proven, not assumed, to round-trip byte-for-byte as inert text through both the entity's own GET
  and `/api/translations` (`i18n-regression.mjs`), and through the `translationsField()` zod
  schema in isolation (`unit-i18n.test.ts`).
- **`?lang=`/localStorage manipulation.** There is no `?lang=` query parameter at all — locale is
  never read from the URL. A tampered `localStorage["scl.locale"]` value outside `LOCALES`
  (`isSupportedLocale`) silently becomes English on the client; a tampered `X-Locale` header
  outside `LOCALES` silently becomes English on the server. Neither path reaches a query or a
  permission check with an unvalidated value.

---

## 8. Accessibility

- The language switcher follows Nav's existing WAI-ARIA disclosure pattern exactly
  (`aria-expanded`/`aria-controls`, a panel labelled `"<trigger text> menu"` — the same convention
  N4's general assertion already enforces for every `.nav__trigger`, so the switcher had to satisfy
  it, not get a special case), keyboard-operable (Enter/Space to open, Escape to close and return
  focus), and screen-reader-legible (`aria-current="true"` on the active language, real text labels
  "English"/"日本語", never an icon alone).
- `document.documentElement.lang` tracks the chosen locale, so assistive technology gets the right
  pronunciation/language rules for the page content, including after a live switch (no reload
  needed).
- Verified at 390/768/1024/1440px in Japanese with no horizontal overflow (browser suite §10);
  Japanese labels are not assumed to be shorter than English (per §29) — the 901px/ADMIN header fix
  in §2 exists precisely because that assumption would have been wrong.

---

## 9. Search

**Unchanged, deliberately.** Phase 10's LIKE-based engine (`apps/server/src/lib/search.ts`) still
matches only each entity's own English columns; it was not extended to also match `Translation`
rows. Reasons, all from the brief itself: the table is deliberately polymorphic with **no FK**
(schema.prisma's own comment), so an efficient join without raw SQL is not straightforward and
raw SQL is explicitly forbidden by Phase 10's own static test (`lib/search.ts`'s `base` must stay
exactly `visibleTo(viewer)`, no second visibility system); "do not introduce FTS5"; "do not redesign
search ranking"; and "preserve the documented Phase 10 limitations." A Japanese override on a
research area's title is therefore **not** found by `/api/search`, even though it *is* what a
ja-locale visitor sees on that area's own page. This is the same class of limitation Phase 10
already documented for Japanese text in general (SQLite `LIKE` has no linguistic
tokenization/folding) — Phase 14 does not make it worse, and does not pretend to fix it.

The search **UI** (`SearchForm`, the results page's own heading/document title/landing text) is
localized where already covered by §5's PageHeader/title sweep; the result cards' own content
(titles, snippets) is whatever the (English) search engine matched, in every locale.

---

## 10. Testing

**All pre-existing suites, unmodified in behavior, still green** (proves zero regression from this
phase's server and shared-package changes):

| Suite | Checks | Result |
|---|---|---|
| `test:unit` (policy + search + messages + files/gallery) | 301+64+34+64 = 463 | 0 failed |
| `test:api` (`api-regression.mjs`) | 559 | 0 failed |
| `test:search` | 209 | 0 failed |
| `test:search-cost` | 10 | 0 failed |
| `test:forum` | 90 | 0 failed |
| `test:messages` | 73 | 0 failed |
| `test:files` | 51 | 0 failed |
| `test:gallery` | 44 | 0 failed |
| Browser regression, full run | see run log | 0 failed |

New this phase:

- **`unit-i18n.test.ts`** (34 checks, added to `npm run test:unit`) — dictionary key-parity and
  non-empty/non-placeholder values (runtime proof of what the type system already enforces at
  compile time), `translate()` lookup/fallback/interpolation, the `TRANSLATABLE_FIELDS` allow-list
  shape, and `translationsField()`'s validation (length limits, clearing via `""`/`null`, unknown
  fields silently stripped like every other zod object in this codebase, hostile text preserved
  byte-for-byte).
- **`i18n-regression.mjs`** (36 checks, `npm run test:i18n`) — the full domain-content lifecycle
  against a real DB copy: English-default unaffected, ja fallback before any override exists, ja
  override applied (list *and* detail), clearing an override, `GET /api/translations` (editor read,
  guest 401, a non-translatable entityType 404, a malformed id 400, a missing entity id → nulls not
  a crash), permissions carried over unchanged (a plain MEMBER may set a translation exactly where
  they may already edit the base fields; a guest's write attempt is refused and changes nothing),
  visibility independent of locale (a hidden area is hidden with **and** without `X-Locale: ja`),
  XSS-as-inert-data, a second entity type end-to-end (`NEWS_ITEM`) and a third
  (`TEAM_MEMBER`, proving only `bio` — not `name` — is ever overridden), and that deleting an
  entity still deletes its `Translation` rows (the pre-existing Phase 8 guarantee).
- **Browser regression, `ONLY_I18N=1`** (a new, self-contained section, same convention as
  `ONLY_NAV`/`ONLY_UI`/`ONLY_FORUM`): the switcher's accessibility (open/close, `aria-current`,
  Escape-returns-focus), live translation of the header and a page's own heading *and browser tab
  title* without a reload, persistence across a full page reload / login / logout / a direct (not
  client-routed) URL load, silent fallback for a tampered stored locale value ("fr"), locale never
  bypassing `ProtectedRoute`, and no horizontal overflow in Japanese at 390/768/1024/1440px.

### Test-maintenance changes (not new features — see §46's explicit instruction)

Two navConfig-derived assertions in `browser-regression.cjs` were still asserting the
**pre-Phase-12** Account menu shape (`My Profile, [Admin Dashboard,] Log out`) and had never picked
up Phase 12's Messages/Notifications links — the "6 stale Account-menu assertions" flagged in the
Phase 13 memory note. Updated both (desktop and the M390 mobile variant) to the shape that has
actually shipped since Phase 12: `My Profile, Messages, Notifications, [Admin Dashboard,] Log out`.
A third, closely related static-scan assertion (`"Z. the navigation architecture is intact"`) had
the *same* staleness — its own description literally said "no Messages/Notifications yet" — plus
needed updating for Phase 14's `label` → `labelKey` rename; both are fixed together with an
explanatory comment. None of these three assertions was weakened: each still fails if a group, the
Schedule/Contact links, `ACCOUNT_NAV`, or `LOGIN_LINK` disappeared — they now check for what is
actually true instead of what was true before Phase 12.

Two `.nav__links`-child-count/selector assertions were updated to exclude the new
`.lang-switch` item, the same way they already excluded `.nav__search` — a control, not a
navigation destination, exactly like the search box already was. The keyboard tab-order assertion
(`K1`) gained one more expected stop (`"en"`, the switcher, between Contact and Log in) and one more
`Tab` in the loop that walks it.

### Builds

`packages/shared` (`tsc --noEmit`), `apps/server` (`tsc -p tsconfig.json`, full compile, not just a
check), and `apps/web` (`tsc -b` + `vite build`) all succeed with zero errors and zero new warnings.

---

## 11. Known limitations / deferred (explicit, not silent)

- Locale-aware date/number formatting (`Intl.DateTimeFormat`/`Intl.NumberFormat`) — `format.ts`
  still hard-codes `"en-US"`. Mechanism is understood (§3); not implemented.
- Search does not match Japanese `Translation` overrides — only the base English columns (§9).
- Nested cross-references (an area's title inside a project summary, a group's name inside a
  project summary, news/publications embedded in a project detail) show the base English text even
  when a Japanese override exists for that entity elsewhere (§4).
- Per-field zod validation messages beyond the small fixed allow-list are shown in English in both
  locales (§6) — not machine-translated, not guessed.
- Translation-editing UI exists in `ResearchFormModal` only; the backend for Project/Group/News/
  TeamMember translations is complete and tested, but not yet wired into their own forms (§4).
- Not localized this phase: Forum (all pages/components), Gallery (page + modals), Messages/
  Conversation, Notifications, Profile, Member detail, Project detail, Group detail, and most
  AdminBar sentence bodies (only the role name inside them is localized, via `usePolicy().roleLabel`).
- Admin's account-role picker (`AdminDashboardPage`'s `<select>` of `ROLES`) shows localized role
  labels via the same `ROLE_LABEL_KEY` mapping used elsewhere; the six "Edit Research/Projects/…"
  content-page shortcut links on that page are still English-only.
- No third language, no machine translation, no translator role/workflow, no FTS5, no autocomplete,
  no new search engine — all explicit non-goals (§43) and none were touched.

---

## 12. Database safety

No migration. `Translation`'s schema was unchanged (it already had exactly the shape this phase
needed — `entityType, entityId, locale, field, value` with the right unique constraint — from
Phase 8). Every test in §10 ran against a disposable copy of `dev.db`; the real file was never
opened. `apps/server/prisma/dev.db` sha256 before and after this phase's work:
`70d2f21dd0252890f6a383584252a90de4791ae35cf553af368c4b98f79d62dc` (unchanged — confirmed by
re-hashing after all work in this phase).

---

## 13. Future translation-CMS possibilities (not built, per §33's explicit non-goal)

The current editing surface (a plain Japanese field next to each English one, in the same form) is
the ceiling for this phase. A real future translation workflow — a dedicated translator role,
draft/review/approve states, bulk import/export, machine-translation-assisted drafts a human then
edits — would build on the same `Translation` table and `TRANSLATABLE_FIELDS` allow-list without
any schema change; none of that exists today and none of it was started.
