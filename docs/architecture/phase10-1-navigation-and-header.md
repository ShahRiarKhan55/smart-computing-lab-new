# Phase 10.1 — Navigation & header architecture

Status: complete. No database, API, permission, route or `reference/` change. Web-only.

## 1. Why

Phase 10 reported that the header was tight at laptop widths: a logged-in admin had **12 top-level links** (Home, Research, Projects, Groups, Team,
Publications, News, Contact, Schedule, My Profile, Admin, Log out) plus the search box, and Phase 10 had to squeeze link padding and hide the search
behind a magnifier between 769px and 1359px. Every future feature (forum, messages, notifications, events…) would have made that worse.

This phase replaces "one link per page" with a small **grouped** header driven by data, so future destinations join an existing group instead of the bar.

## 2. Information architecture

| Entry | Type | Contents | Shown to |
|---|---|---|---|
| **Research** | dropdown | Research Areas `/research`, Projects `/projects`, Publications `/publications`, News `/news` | everyone |
| **People** | dropdown | Team `/team`, Groups `/groups` | everyone |
| **Schedule** | link `/schedule` | — | signed-in only (as before) |
| **Contact** | link `/contact` | — | everyone |
| Search | compact box (one shared `SearchForm`) | — | everyone |
| **Account** | dropdown | My Profile `/profile`, Admin Dashboard `/admin`, Log out (action) | signed-in; Admin Dashboard only when `usePolicy().canManageUsers` |
| **Log in** | link `/login` | — | guests |

* The logo (`SCL_`, accessible name "Smart Computing Lab, home") is the Home link; there is no separate "Home" entry.
* **Community** is deliberately *absent*: nothing that is a community feature exists yet (no Forum, Messages, Notifications, Events routes), and the brief
  forbids fake links. Groups are membership/organisation, so they sit under People. An empty group is never rendered; when a community feature ships, add
  a `{ id: "community", … }` group to `MAIN_NAV` in the same commit as its route.
* Admin gets **one** entry (Account → Admin Dashboard). Account management stays inside the dashboard; nothing internal is in the public header.
  A LAB_MANAGER's content controls (visibility, delete, projects, groups) already live on the pages themselves, so their header equals a member's.
* An admin's header went from 12 links to **5 entries + search**; a guest's from 9 to **4 + search**.

## 3. Structure (files)

| File | Role |
|---|---|
| `apps/web/src/components/navConfig.ts` *(new)* | The architecture as data: `MAIN_NAV`, `ACCOUNT_NAV`, `LOGIN_LINK`, `resolveNav` / `resolveGroup` (filter by visitor, drop empty groups), `groupContaining` (which trigger looks active). **Adding a destination = one entry here.** |
| `apps/web/src/components/NavGroup.tsx` *(new)* | One accessible dropdown (disclosure pattern), reused for desktop dropdowns AND the phone accordion. |
| `apps/web/src/components/Nav.tsx` | Renders the config; owns which menu/section is open, the hamburger, route-change reset, logout. |
| `apps/web/src/components/SearchForm.tsx` | Only the magnifier-opens-the-box handler was removed (see §5). Search engine, API and `/search` untouched. |
| `apps/web/src/index.css` | Section 3 rewritten for triggers/panels; Phase 10's laptop-magnifier block and the old 768px nav rules replaced by one "≤900px" block at the end of the file. |

`when` predicates in the config only decide what is **shown**. Protection is unchanged and independent: `ProtectedRoute` in the browser, `requireCan` /
`requireAuth` on the API. The static "no inline `role === "ADMIN"`" scan still passes (the config uses `usePolicy()`).

## 4. Behaviour by width

| Width | Header |
|---|---|
| **≥ 901px** (desktop: 901, 1024, 1280, 1366, 1440, 1536, 1920 all tested) | Logo · search box · Research ▾ · People ▾ · [Schedule] · Contact · Account ▾ / Log in. 64px tall. Dropdown panels drop under their trigger; the last (Account) is right-aligned so it never leaves the viewport. Widest header (admin, 901px) still has a 131px gap between logo and links. |
| **≤ 900px** (tablet portrait 768/820, phones 412/390, 200% zoom of a 1440 screen) | Logo + hamburger (44×44 tap target). The menu is a panel under the bar: search box first, then Research / People as expandable sections, Schedule, Contact, and the Account section set apart by a divider at the bottom. Opening the menu expands the section that contains the current page. One section open at a time. The panel scrolls inside itself (`max-height: 100dvh − 64px`) if it is ever taller than the screen. |

The 900px threshold (the old one was 768px) is where the *desktop* header stops having comfortable spare room; the rest of the site's layout breakpoints are unchanged.

## 5. Search integration

* Same `SearchForm`, same `/search?q=…`, same "nothing is requested while typing", same `clearOnSubmit` behaviour (the box empties and blurs so the phone keyboard drops).
* Desktop: the ordinary compact box at every width ≥ 901px. The Phase 10 magnifier that expanded on focus (769–1359px) existed only because 12 links left no room; with 5 entries it is unnecessary, so it was **removed** (CSS block and `clickButton`) rather than kept as dead behaviour. The 2 browser checks that asserted the magnifier opening and collapsing were removed with it, and the 2 laptop-width checks were reworded to assert that the normal box is visible and nothing overflows at 1200px.
* Phone/tablet: at the top of the hamburger menu, 42px tall, 16px font (no iOS zoom).

## 6. Accessibility

Pattern: **WAI-ARIA disclosure navigation** — real `<button>`s that show/hide a list of ordinary links. Deliberately *not* `role="menu"` (those are links, and menu roles change screen-reader browsing mode).

* `<nav aria-label="Main">`; each trigger has `aria-expanded` + `aria-controls`; each panel `id` + `aria-label="<Group> menu"`; closed panels use `hidden` (out of the tab order and the accessibility tree) plus a CSS `[hidden]{display:none}` guard; the current page's link has `aria-current="page"` and its group trigger is styled active.
* Hamburger: `aria-expanded`, `aria-controls="navLinks"`.
* Keyboard: **Tab / Shift+Tab** through the header in reading order (logo → search box → search button → Research → People → Schedule → Contact → Account); **Enter / Space** open a trigger (native button); **ArrowDown** on a closed trigger opens it and focuses the first link; **ArrowUp/Down, Home, End** move inside a panel (ArrowUp on the first link returns to the trigger); **Escape** closes the panel and returns focus to its trigger (on a phone a second Escape closes the menu and focuses the hamburger); **Tab out of the last link** closes the panel; **Enter on a link** navigates and folds the menus away.
* Mouse/touch: **click**-to-open only — never hover-only. A click outside closes it; opening another section closes the current one.
* Focus: one visible 2px green ring on the logo, links, triggers, panel items, the search box/button and the hamburger (`:focus-visible`); transitions are disabled under `prefers-reduced-motion`.
* Tap targets on phones: menu rows and panel links ≥ 44px; hamburger 44×44.

## 7. Two bugs the real-mouse tests found in the first implementation

1. Closing the open section on `pointerdown` (a "click outside") made the sections *below* it jump up between the press and the release, so a tap on "People" while "Research" was open landed on the wrong element. Fixed by closing on `click`.
2. Closing on `click` then made the hamburger's own click (which expands the current section) get caught by that section's just-registered listener and immediately close it. Fixed by ignoring a click whose `timeStamp` predates the listener.

Also fixed while there: the hamburger hit area was 30×24px (pre-existing); it is now 44×44 with a negative margin so the bars do not move.

## 8. Roles

| Role | Top level | Account menu |
|---|---|---|
| Guest | Research, People, Contact, Log in | — (no Schedule, no My Profile, no Admin, no Log out anywhere in the DOM) |
| MEMBER | Research, People, Schedule, Contact, Account | My Profile, Log out |
| LAB_MANAGER | same as MEMBER | My Profile, Log out (no Admin Dashboard; `/admin` is ADMIN-only and unchanged) |
| ADMIN | same five entries | My Profile, Admin Dashboard, Log out |

## 9. Route and security guarantees (unchanged, re-verified in the browser)

* No route renamed or added; `/`, `/research`, `/projects[/:id]`, `/groups[/:id]`, `/team[/:id]`, `/publications`, `/news`, `/search`, `/contact`, `/login`, `/schedule`, `/profile`, `/admin` all load directly and after refresh; Back/Forward re-syncs the open menu and active group.
* A guest opening `/schedule`, `/profile` or `/admin` directly is redirected to `/login`; logging in from a bounced `/schedule` returns to `/schedule`. A member/manager opening `/admin` is sent home. The API still answers 401 (anonymous) / 403 (member, manager) to `/api/users`. The header being hidden is never the check.

## 10. Tests (this phase)

| Suite | Result |
|---|---|
| Policy unit + search unit (`npm run test:unit`) | 210 + 64 passed |
| API regression (`npm run test:api`, DB copy) | 559 passed |
| Search API (`npm run test:search`, DB copy) | 209 passed |
| Search cost (`npm run test:search-cost`, DB copy) | 10 passed |
| **Browser regression** (`scripts/browser-regression.cjs`, DB copy) | **477 passed, 0 failed** = 247 earlier-phase checks (248 before: 2 magnifier-only checks removed, 1 mobile-menu check added) + 230 new Phase 10.1 checks |
| Builds | `npm run build` (shared, server, web) passes; `oxlint` reports only pre-existing warnings |

`ONLY_NAV=1 node scripts/browser-regression.cjs …` runs just the Phase 10.1 section (about a minute, still needs a FRESH DB copy because the suite seeds data).

New browser checks (real mouse clicks and real key events through CDP, so hit-testing/overlap problems surface): guest/member/manager/admin entries and menus; menu open/close, one-at-a-time, outside click, Escape, arrows/Home/End, Tab order and Tab-out, focus ring; active-group state incl. detail pages; refresh, Back/Forward with an open menu, direct URLs, protected-route redirects and login return; a width sweep of the **widest** (admin) header at 1920/1536/1440/1366/1280/1024/901 (no overflow, no wrap, ordered, clear of the logo, every dropdown inside the viewport and every panel link topmost at its centre); the hamburger at 390/412/768/900 for guest, plus member and admin at 390 (accordion, tap-not-lost-to-layout-shift, Escape ladder, search from the menu, Back with the menu open, logout by tap); 720px (≈200% zoom).

Existing checks that referred to the old flat header were updated: "nav shows Projects and Groups", "member/manager has no Admin link" (now also assert no `/admin` anchor anywhere in the header), the mobile-menu check (Research section is open on `/projects`, tapping People reveals Groups), the `logout()` helper (Log out is inside the Account panel), and the 1200px laptop checks (the normal box is visible; the 2 magnifier-only checks were removed because that behaviour was removed).

**Mutation testing** — 12 web mutations, each caught by the nav section: Admin Dashboard shown to every signed-in user (6 failing checks), Schedule shown to guests (15), Escape handling removed (10), `[hidden]` CSS rule removed so closed panels are drawn (27), outside click no longer closes (1), `aria-expanded` removed (68), route change no longer folds menus (29), `/schedule` `ProtectedRoute` removed (5), outside-close moved back to `pointerdown` (16), timestamp guard removed (4), arrow keys removed (3), a wrong link in the Research group (8). One mutation drafted as "one dropdown at a time removed" was a no-op and was dropped rather than counted.

## 11. Known limitations

* No hover-to-open (by design: click/keyboard/touch work identically everywhere).
* Focus is not moved after logging out (the Account menu unmounts, so keyboard focus returns to the top of the document).
* While the session is being restored on first load the header briefly shows "Log in" for a signed-in visitor (pre-existing behaviour of `AuthContext`).
* Outside-click and focus-out closing also apply to the phone accordion: tapping the search box collapses an open section (harmless, the search box is above the sections).
* Visual identity is untouched by design; broader modernisation is Phase 10.5.

## 12. Extending

```ts
// navConfig.ts — a future Community group, added together with its routes
{ id: "community", label: "Community", items: [{ to: "/forum", label: "Forum" }, { to: "/messages", label: "Messages", when: (c) => c.signedIn }] },
```
Add the `<Route>` in `App.tsx` (with `ProtectedRoute`/server guards as needed) in the same change, and a nav-section test for the new entry.
