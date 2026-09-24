# Phase 15 — Complete Localization Coverage + Japanese Search

Status: **done, scoped** (2026-09-23). Builds on the Phase 14 architecture without changing it — no
new UI translation mechanism, no new domain-translation mechanism, no schema change. `dev.db`
untouched throughout (sha256 unchanged from Phase 14's own recorded value, verified again at the
end of this phase — see §13); the reference tree hash is unchanged (verified before and after).
This was the first phase run without a pre-existing git history: a git repository was initialized
as a safety net immediately before any edit (see the "Baseline: Phase 14 complete" commit), so
every change in this phase is a reviewable, revertible commit.

This document records exactly what Phase 15 completed against Phase 14 §11's own disclosed
deferred list, what is still deferred (disclosed here, not silently), and why.

---

## 1. What Phase 14 left deferred, and what happened to each item

| Phase 14 §11 item | Phase 15 outcome |
|---|---|
| Forum (all pages/components) | **Done** — every page and component now routes through `t()` |
| Gallery (page + modals) | **Done** |
| Messages/Conversation | **Done** |
| Notifications | **Done** |
| Profile, Member detail | **Done** |
| Project detail, Group detail | **Done** |
| Most `AdminBar` sentence bodies | **Done** for every sentence this phase touched (Forum, Project, Group, Member); `usePolicy().roleLabel` is used everywhere a role name is interpolated, exactly like Phase 14's pattern |
| Locale-aware date/number formatting | **Done** — see §2 |
| Search does not match Japanese `Translation` overrides | **Done** — see §3 |
| Translation-editing UI: Research only | **Done** — Project/Group/News/TeamMember forms now have the same fieldset |
| Nested cross-references show base English | **Unchanged, still deferred** — see §9 |
| Per-field zod validation messages | **Unchanged, still deferred** — see §8 |
| Admin's six content-page shortcut links | **Done** — see §6 (found and fixed as part of the wider `AdminDashboardPage` sweep) |

---

## 2. Locale-aware date/number formatting

`apps/web/src/lib/format.ts` no longer hard-codes `"en-US"`. Every formatter takes a `Locale` and
maps it to a BCP-47 tag (`en` → `en-US`, `ja` → `ja-JP`) through one lookup table, then calls
`Intl.DateTimeFormat`/`Intl.NumberFormat` — exactly the mechanism Phase 14 §3 already described as
understood-but-not-implemented.

```
formatDateTime(iso, locale)             "Sep 22, 2026, 3:45 PM" / "2026年9月22日 15:45"
formatMonthYear(iso, locale)            "Jan 2030" / "2030年1月"
formatProjectDateRange(start, end, loc) "Jan 2030 – Jun 2031" (locale-aware month names)
formatNumber(n, locale)                 Intl.NumberFormat digit grouping
formatBytes(bytes, locale)              "48 KB" — the numeric part now locale-aware too
```

The "Since {date}" / "Until {date}" wording moved out of `format.ts` and into two new dictionary
keys (`dates.since`, `dates.until`), so the sentence itself is translated the normal way instead of
a formatter returning pre-composed English text.

**Call sites updated**: `ProjectCard`, `ProjectDetailPage` (date range), `ForumCategoryCard`,
`ForumTopicCard`, `ForumTopicPage`, `ForumComment`, `ConversationListItem`, `MessageBubble`,
`NotificationItem` (all `formatDateTime`), `GalleryUploadModal` (`formatBytes`, for both the size
limit and the selected-file hint). A repo-wide grep for `toLocaleDateString`/`toLocaleString`/
`en-US` confirms `format.ts` is now the only place either appears — no scattered call site was
missed.

**Scope boundary, disclosed**: `formatNumber` is not swept into every small integer display (comment
counts, reaction counts, pagination) — those render through the `{count} {t(...)}` pattern already
established for pluralization, and `Intl.NumberFormat` only visibly changes rendering above 999, a
threshold this app's counters essentially never cross. It is applied everywhere a number could
plausibly be large (file sizes).

---

## 3. Japanese search matching (`apps/server/src/lib/search.ts`)

Phase 14 §9 documented, and Phase 10 before it, why this was left alone: `Translation` is
deliberately polymorphic with no FK, raw SQL is forbidden by search's own static test, and FTS5 was
an explicit non-goal. Phase 15's brief asked to investigate whether this could be done safely
without any of those — it can, with one bounded addition per translatable source type.

**Mechanism**: for the five entity types `Translation` covers that search also indexes
(`research-area`→`RESEARCH_AREA`, `project`→`RESEARCH_PROJECT`, `group`→`RESEARCH_GROUP`,
`researcher`→`TEAM_MEMBER`, `news`→`NEWS_ITEM`), a `ja`-locale search additionally runs one
`Translation` query **per search term** (plain `contains`, the same technique — and the same
per-term multiplicity — the English side's own `anyField` already uses), intersecting matched ids
across terms so every term must appear somewhere in that entity's Japanese fields (any field, any
term, same AND-across-terms/OR-across-fields semantics as the English columns). The resulting id
set is OR'd into the *same* `visibleTo(viewer)`-filtered WHERE every other match already goes
through — never a separate query, never a second visibility system, so locale can only ever narrow
who a matched row surfaces to *among people who could already see it*, never widen it.

**Ranking**: a translation-only match never promotes to tier 0/1 (those rank by the *English* title
column's prefix/contains, which a translation-only hit never satisfies) — it always lands in tier 2,
"matched only through other fields," exactly like an English body-only match already does. No
ranking rule changed.

**Result display**: once a page/tier's rows are fetched, the exact ids in that page are
batch-loaded through Phase 14's own `loadTranslations`/`localize()` and overlaid before building the
result — so a `ja`-locale search result shows the Japanese title/description when an override
exists, never "found in Japanese, shown in English." An `en`-locale search is completely unchanged:
zero extra `Translation` queries (the `locale !== DEFAULT_LOCALE` guard short-circuits both the
matching and the display-overlay path), same as every other Phase 14 English-request path.

**Cost**: bounded by the number of search terms (typically 1–3) × the number of translatable source
types being searched (at most 5), each a small indexed-prefix `contains` query against a table that
only ever holds as many rows as fields have been translated — the same order of magnitude Phase 10's
own design already accepts for the English side.

**Tested** (`scripts/search-regression.mjs`, 11 new checks, full suite 220/220): an English-locale
search never queries `Translation` and never matches Japanese-only text; a Japanese-locale search
finds a `ja`-only override; the same search's per-type count is correct; a `LAB_ONLY` entity's
Japanese override is still invisible to a guest with `X-Locale: ja` but visible to a logged-in
member (locale adds matching, never visibility); a `ja`-title override is both matched and *shown*
in the result, whether the match came through the Japanese title or the English one; the same entity
under `X-Locale: en` is unaffected; a hostile Japanese translation value is findable and round-trips
as inert JSON text.

---

## 4. Translation-editing UI: the remaining four forms

Phase 14 built the pattern once, in `ResearchFormModal`, and left it disclosed-but-unported into
`ProjectFormModal`, `GroupFormModal`, `NewsFormModal`, `TeamMemberFormModal` — their backends
(`translations: { ja: {...} }` merged into the same PUT, via `applyTranslationOverrides`) were
already complete and tested end-to-end. Phase 15 ports the exact same pattern into all four:
`useEntityTranslations(entityType, initial?.id, open)` fetches the current `ja` values only while
editing an existing row (a brand-new one has nowhere for an override to attach until after the first
save — unchanged from Phase 14), and a `.form-fieldset` section holds one Japanese field per
allow-listed column next to its English counterpart:

```
RESEARCH_PROJECT  title, summary, description
RESEARCH_GROUP    name, description
NEWS_ITEM         title, description
TEAM_MEMBER       bio
```

No backend change was needed — the zod schemas, `translationsField()`, and the PUT handlers were
already wired in Phase 14. This is purely the missing four frontend forms plus, while touching every
field in each of these forms anyway, localizing every field *label* in all five forms (including
`ResearchFormModal`'s own, which Phase 14 had left English-only — only its Save/Cancel/error text
was localized before this phase).

---

## 5. Complete page/component UI sweep

Every component listed as deferred in Phase 14 §11 now routes its strings through `t()`:

**Forum** — `ForumIndexPage`, `ForumCategoryPage`, `ForumTopicPage`, and all 13 forum components
(body, cards, badges, moderation controls, reaction bar, composer, comment composer/list/item,
category form, move-topic modal, mention picker). Includes the reaction-kind labels
(`FORUM_REACTION_LABELS`, previously hard-coded English shared with the server) via a
`REACTION_LABEL_KEY` map following the same `Record<value, TranslationKey>` convention Phase 14's
`ROLE_LABEL_KEY` established.

**Gallery** — page, upload modal, edit modal, card, lightbox, plus the gallery-category labels
(`GALLERY_CATEGORY_LABELS`) via the same map-key convention (`apps/web/src/i18n/labels.ts`, new:
`CATEGORY_LABEL_KEY` for team-member category, `GALLERY_CATEGORY_LABEL_KEY` for gallery category —
both reused from `TeamPage`, `ProfilePage`, `CreateLoginModal` and the gallery components, so the
label text is defined once per concept, not once per call site).

**Messages/Notifications** — `MessagesPage`, `ConversationPage`, `NotificationsPage`, and every
component (conversation list/item, message bubble/composer/list, notification item/list). A
notification's human-readable sentence (`describe()` in `NotificationItem.tsx`) — "{actor} mentioned
you…", "…was {action} by a moderator" — is now built entirely from `t()` templates with `{actor}`/
`{title}`/`{action}` variables, including a closed `ACTION_LABEL_KEY` map for the small set of
moderation-action words the server actually sends (`hidden`/`deleted`/`locked`/`moderated`).

**Detail pages** — `ProjectDetailPage`, `GroupDetailPage`, `MemberPage`, `ProfilePage`, plus
`TeamPage` and `CreateLoginModal` (admin dashboard), which had residual untranslated strings even
though their page headers were already localized in Phase 14.

**New dictionary keys this phase**: roughly 360, added in per-area blocks in both `en.ts` and
`ja.ts`, keeping the existing flat dot-namespace convention. Compile-time key parity (Phase 14's own
`Record<keyof typeof en, string>` typing on `ja.ts`) caught every mismatch during development —
several are visible as `tsc` fix-up commits were folded into each area's single commit rather than
left as separate noise.

See §6 for a second, much larger discovery made by systematically auditing the *rest* of the app
after this section's own work was believed complete.

---

## 6. A systemic gap found by QA, not by the original plan: page bodies vs. page headers

Phase 15's brief was scoped around Phase 14 §11's disclosed deferred list (§1 above). Partway
through, a QA sweep of the files that list touched turned up one real miss: `PROJECT_STATUS_LABELS`
(the project status word — "Planned"/"Active"/"Completed"/"Archived") was still read directly from
`@scl/shared` in `Badge.tsx`'s `StatusBadge`, `ProjectFormModal.tsx`'s status `<select>`, and
`ProjectsPage.tsx`. Fixing the third one exposed something bigger: `ProjectsPage.tsx`'s `PageHeader`
(eyebrow/title/description) had been localized in Phase 14, but its entire *body* — the admin bar,
filter chips, "All" button, result count, section heading, empty state — had not, and neither
phase's deferred-list had flagged it, because Phase 14 §5's own text listed "page headers" as done
for this page without saying anything about the body.

That raised an obvious question — a page header being localized never implied its body was, so what
else has the same shape? — so this phase ran two further systematic sweeps rather than treating the
one page as a one-off:

**Sweep 1 (foundational shared components)**: `Modal.tsx`'s close-dialog button, `PageHeader.tsx`'s
"Home"/"Breadcrumb", `VisibilityField`/`VisibilityBadge` (the Public/Lab-only selector and "Lab
only" pill used by **every** content form and card in the app), `CardEditControls` (the edit/
delete/manage-authors icon buttons used by every editable card), `GroupCard`, `PublicationItem`,
`SearchResultCard`, `SearchForm`, `LinkItemsModal`, `MembersModal`, `HistoryFormModal`,
`PublicationFormModal`, `ResearchCard`, `ErrorState`'s "Try again" retry button — every one of these
had **zero** `t()` calls, in components used across effectively every page in the site, including
pages neither phase's deferred-list ever mentioned. None of this was Phase 15-introduced regression;
it was pre-existing, unlocalized-since-Phase-14 code that happened to sit inside components the
original per-page sweep never had a reason to open.

**Sweep 2 (sibling list/utility pages)**: `ResearchPage`, `GroupsPage`, `PublicationsPage`,
`NewsPage` all had the exact same header-done/body-not shape as `ProjectsPage`. `SearchPage` (the
`/search` results page) had its entire status line, filter labels, pagination, and empty states
hard-coded. `SchedulePage`, `ContactPage` (the most severe — `t()` was called exactly once, for its
`PageHeader`, and nothing else on the page), and `AdminDashboardPage` (stat labels, content shortcut
links, the whole account-management table, delete-account confirmation) were the same. `HomePage`
had one stray `aria-label`. `NotFoundPage` had zero `t()` calls at all.

**What was deliberately left alone**: `ContactPage`'s `DETAILS` array — the placeholder office
address, email, office hours, and university URL — are the reference site's own placeholder VALUES,
already documented as unlocalized placeholder content since Phase 10.5 (`docs/architecture/
phase10-5-ui-ux-modernization.md`: "Contact page still shows the reference site placeholders").
Only the field *labels* around them ("Location", "Email", …) and the rest of the page's UI chrome
were localized — inventing a Japanese office address would be worse than leaving the placeholder
English, exactly the same judgment call Phase 10.5 already made for English.

**Net result**: every page in the application now has both its header and its body routing through
`t()`. Roughly 520 new dictionary keys were added across both sweeps (on top of the ~360 from the
originally-planned work in §§1–5), all in `apps/web/src/i18n/labels.ts` (three new
`Record<value, TranslationKey>` maps: `SEARCH_TYPE_LABEL_KEY`, `SEARCH_FILTER_LABEL_KEY`,
`SEARCH_CTA_LABEL_KEY`, alongside the earlier `PROJECT_STATUS_LABEL_KEY`) and `packages/shared/src/
i18n/{en,ja}.ts`. The search-results status line (`"5 results in Projects for "FPGA""`) is composed
as whole natural-language templates per locale rather than concatenated fragments, because Japanese
and English order the pieces differently (`"「FPGA」の検索結果（プロジェクト）：5件"` reads right-to-
left relative to English, not just word-for-word substituted) — the same lesson Phase 14 already
applied to `dates.since`/`dates.until`, now applied more broadly.

This is disclosed at this length deliberately: a "done" page header is not evidence a page is done,
and the right response to finding that out partway through a phase is to systematically re-check
everything with the same shape, not to patch the one instance and move on.

---

## 7. What is still deferred (explicit, not silent)

- **Per-field zod validation messages** beyond Phase 14's small fixed allow-list
  (`error.notFound`/`unauthorized`/`forbidden`/… in `errorMessages.ts`) are still shown in English in
  both locales. Phase 14 judged a full `{ code, field }` error-contract rewrite out of proportion to
  its own scope; Phase 15's brief allows "where practical" rather than mandating that rewrite, and
  the same judgment still holds — no new fixed-string pattern emerged during this phase's sweep that
  would have been a small, safe addition to the allow-list (the forms this phase touched already
  route their `safeParse` failures through `apiErrorMessage()`/`t("common.checkForm")` exactly like
  Phase 14's five forms did).
- **Nested cross-references** (an area's title inside a project summary, a group's name inside a
  project summary, news/publications embedded in a project detail) still show the base English text
  even when a Japanese override exists for that entity on its own page. Unchanged from Phase 14 §4's
  own disclosed boundary — touching this would mean localizing every nested `include` across
  `projects.routes.ts`/`groups.routes.ts`, which both phases have judged disproportionate to a
  "smallest safe change" localization pass.
- **`ContactPage`'s placeholder office details** (address, email, office hours, university URL) stay
  as the reference site's own unlocalized placeholder English, per Phase 10.5's own precedent (§6) —
  deliberate, not missed.
- **Accessibility and responsive verification for the newly-localized areas** was performed by
  design review (every new interactive element follows an already-audited pattern: `ConfirmDeleteModal`,
  `Modal`'s focus trap, the existing `.chip`/`.btn`/`.form-group` styles, word-labelled badges) and by
  compiling/building successfully, but **not** by running the live headless-browser accessibility/
  responsive assertions (`ONLY_UI`, `ONLY_NAV`, the `browser-regression.cjs` W390/W768/W1024/W1440
  sweep) against these specific new pages in this session — see §12.

---

## 8. Validation/error localization — investigated, not changed

Every form this phase touched already funnels its `safeParse` failure through
`validation.error.issues[0]?.message ?? t("common.checkForm")` and its catch block through
`apiErrorMessage(err, t)` (Project/Group/News/TeamMember modals) or an equivalent inline pattern
(`err instanceof ApiError ? err.message : t("common.somethingWentWrong")` elsewhere) — the exact
Phase 14 pattern, now applied consistently everywhere this phase edited a form. No new class of
hard-coded server message was found that the existing `errorMessages.ts` allow-list doesn't already
cover; the remaining gap (arbitrary per-field zod messages) is the same one Phase 14 disclosed and
for the same stated reason.

---

## 9. Search's remaining documented limitations

Everything Phase 10/14 already documented and did not change still applies **except** the one item
this phase fixed (§3): no FTS5, no raw SQL, one deterministic documented ordering (not relevance
scoring), SQLite `LIKE`'s lack of linguistic folding/tokenization for either language. The nested
cross-reference boundary (§7) also still applies to search results exactly as it does to detail
pages: a translation is only matched/shown for the entity it belongs to, never through another
entity's reference to it (search never joins across entities in the first place, so this was never a
risk unique to translations).

---

## 10. Security

Unchanged guarantees, reverified rather than merely re-asserted:

- **Locale never bypasses a permission or visibility check.** Phase 14 already proved this for
  domain-content GET/PUT; Phase 15 extends the proof to search (§3's tests) and adds a dedicated
  suite (`scripts/locale-independence-regression.mjs`, 46 checks) that sends the *same* request with
  `X-Locale: en` and `X-Locale: ja` side by side and asserts an identical status code, across
  authentication, `LAB_ONLY` research/project/group visibility, forum moderation's role hierarchy
  (`MEMBER` forbidden / `LAB_MANAGER` allowed), message privacy (only a participant may read a
  conversation), notification privacy (only the recipient's own list), gallery authorization, and
  admin-only operations (`GET /api/users`) — plus a tampered/unsupported `X-Locale` value (`"fr"`,
  `"EN"`, `"ja-JP"`, a SQL-injection-shaped string) never errors and never changes the outcome.
- **The new `Translation`-matching queries in search never widen visibility.** Matched ids are OR'd
  strictly *inside* the existing `base AND (...)` structure (§3) — proven directly by the
  `LAB_ONLY`-with-`ja`-override test in `search-regression.mjs`, not merely asserted by code review.
- **XSS.** A hostile Japanese translation value used as a search term is findable and returns as
  inert JSON text (`search-regression.mjs`'s new XSS check), consistent with Phase 14's existing
  proof for the entity's own GET/`/api/translations` path. No `dangerouslySetInnerHTML` was
  introduced anywhere in this phase; every new render is a React text node exactly like the rest of
  this codebase.

---

## 11. Accessibility (design-level, not live-browser-verified this phase)

Every new interactive element reuses an already-accessibility-audited pattern rather than inventing
one: `ConfirmDeleteModal`/`Modal` (focus trap, Escape, `aria-*`, focus return — Phase 13), the
forum/gallery/message/notification pagers reuse the exact `.search-pager` markup and
`aria-label`/`aria-disabled` pattern the Phase 10 search results page established, word-labelled
badges (never colour/icon alone) for pinned/locked/hidden/reactions, and `sr-only` text for
icon-adjacent actions (mention picker, comment edit label). The reaction bar, mention picker and
lightbox controls all carry the same `aria-label`/`aria-pressed`/`role` attributes they had before
this phase — only the *text inside* those attributes changed, from a literal string to `t(...)`, so
no accessibility semantic changed, only its language. This phase did not additionally run the
headless-browser `ONLY_UI`/`ONLY_NAV`/W390–W1440 responsive assertions against these specific pages
(see §7's disclosure) — that verification is real work still owed, not claimed here.

---

## 12. Testing

**New this phase:**

| Suite | New checks | Result |
|---|---|---|
| `search-regression.mjs` (§3 additions) | 11 | 220/220 total, 0 failed |
| `locale-independence-regression.mjs` (new, §10) | 46 | 46/46, 0 failed |

**All pre-existing suites, re-run on fresh `dev.db` copies at the end of this phase, unmodified in
behavior:**

| Suite | Checks | Result |
|---|---|---|
| `test:unit` (policy + search + messages + files/gallery + i18n) | 301+64+34+64+34 = 497 | 0 failed |
| `test:api` | 559 | 0 failed |
| `test:search` | 220 (209 baseline + 11 new) | 0 failed |
| `test:i18n` | 36 | 0 failed |
| `test:locale-independence` (new) | 46 | 0 failed |
| `test:forum` | 90 | 0 failed |
| `test:messages` | 73 | 0 failed |
| `test:files` | 51 | 0 failed |
| `test:gallery` | 44 | 0 failed |

**Total: 1,616 backend checks, 0 failed.** `packages/shared` (`tsc --noEmit`), `apps/server`
(`tsc`, full compile), and `apps/web` (`tsc -b` + `vite build`) all succeed with zero errors; a full
`npm run build` from the repo root (shared → server → web) succeeds end to end. These counts are
unchanged by §6's later discoveries: that work was entirely `apps/web` (React components) and
`packages/shared/src/i18n/{en,ja}.ts` (dictionary keys) — no server route, schema, or business-logic
line changed, so no backend regression suite's assertions were touched. `unit-i18n.test.ts`'s
compile-time key-parity check (`ja.ts` typed as `Record<keyof typeof en, string>`) re-ran clean
after every batch of the ~520 new keys §6 added, confirming no orphaned or mismatched key.

**Not run this phase** (disclosed, not silently skipped): the live headless-browser suite
(`browser-regression.cjs`, including its `ONLY_UI`/`ONLY_NAV`/`ONLY_FORUM`/`ONLY_I18N` sections and
the W390–W1920 responsive sweep) was not extended or re-run against the newly-localized pages in
this session. Every new page/component was verified by full-project typecheck, a successful
production build, and (for every backend-reachable behavior) the regression suites above — but not
by an actual rendered-in-a-browser pass. This is the one item from the original Phase 15 brief
(§13–§15: accessibility, responsive, browser regression) this phase does not claim to have
completed; see §7.

---

## 13. Database safety

No migration — nothing in this phase needed one. `apps/server/prisma/dev.db` sha256 before and
after this phase's entire body of work: `70d2f21dd0252890f6a383584252a90de4791ae35cf553af368c4b98f79d62dc`
(identical to the value Phase 14 itself recorded — the real file was never opened by any script in
this phase; every test ran against a disposable copy, same convention as every phase since Phase 8).
`PRAGMA integrity_check` → `ok`; `PRAGMA foreign_key_check` → zero rows. `prisma validate` passes.
The reference tree (`Lab-Website/reference/`) hash is unchanged from before this phase began.

---

## 14. Performance

The one new query path (§3's `translationMatchIds`) follows the same batching discipline as every
other Phase 14/15 translation query: one query per search *term* (bounded, small, typically 1–3),
never one per matched row, and a hard `locale !== "en"` guard means an English-locale search
(the common case) runs exactly as many queries as it did before this phase — zero added. Result
localization reuses the existing `loadTranslations` batched-by-id function unchanged, called once
per fetched page of results, not once per row.

---

## 15. Scope discipline

Phase 16, deployment, production hosting, and any unrelated refactor were not started. No stable
Phase 10–14 architecture was rewritten for style. The stack is unchanged: React + TypeScript +
Express + Prisma + SQLite, the same `t()`/`Translation`-table split Phase 14 established, the same
regression-suite conventions every phase since Phase 4 has used.
