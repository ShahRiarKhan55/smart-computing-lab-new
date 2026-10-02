# Phase 10.5 — UI/UX modernization

Status: complete. Web-only: **no** database, API, permission, route, backend or `reference/` change. The Phase 10.1 navigation architecture is untouched (only its look was polished).

## 1. Direction

"Research lab × modern engineering dashboard": calm, technical, credible. The Smart Computing Lab green stays the identity; what changed is structure, hierarchy and consistency.

* **Restrained technical accents**: a faint engineering grid behind page headers and the hero, a mono-type (Space Mono) voice for page titles/labels/numbers, a chip-and-circuit hero illustration. No gradients beyond the grid fade, no glass, no stock imagery.
* **Body copy in DM Sans** at readable sizes (16px body, 14px secondary, 12px metadata minimum). Card headings moved from 13px mono to 18px sans; running text is capped at ~68 characters.
* **Denser where it should be** (publications are a ruled academic list, not marketing cards) and **airier where it should be** (one page grid, one spacing scale).

## 2. Design system

The 2,125-line `index.css` is now five files, imported in dependency order from `index.css`:

| File | Owns |
|---|---|
| `styles/tokens.css` | every colour, type size, spacing step, radius, shadow, container width, motion duration and z-layer (breakpoints are documented there because CSS variables cannot be used in `@media`) |
| `styles/base.css` | reset, type scale, focus ring, layout primitives (`.container`, `.band`, `.grid`, `.detail-layout`), utilities, skip link, page fade, **reduced-motion rules** |
| `styles/components.css` | buttons, badges, cards, avatars, chips, toolbar, forms, pick-lists, modals, skeleton/empty/error states, stat cards, the search box |
| `styles/site.css` | header/navigation (Phase 10.1 structure, restyled), page header + breadcrumbs, footer |
| `styles/pages.css` | page layouts only (home, detail pages, publications list, contact, login, admin, search results, hero illustration) |

**Colour**: the brand ramp is unchanged (`--green-50 … --green-900`); semantic tokens sit on top (`--primary`, `--surface`, `--muted`, success/info/warning/danger triples, `--border` for decoration and the darker `--border-strong` for form controls so they meet WCAG 1.4.11). `gray-400` (3.5:1) is no longer used for text. Only 3 one-off hex values remain outside `tokens.css`.

**Scale**: type `12/14/16/18/22/26–30/30–44/40–64px` (display fluid); spacing 4px base (`--space-1…20`); radius 6 (controls) / 8 (cards) / 12 (modals) / pill (badges, chips only — cards are no longer over-rounded); four shadows; container 1120px (720 narrow), gutter 40px → 20px on phones.

**Components** (React, `apps/web/src/components/`): new — `Icon` (one inline-SVG set, ~30 icons, no library), `PageHeader` (h1 + eyebrow **or** breadcrumbs + description; also sets the tab title), `SectionHeader`, `Badge`/`StatusBadge`, `Avatar`, `StatCard`, `EmptyState`, `PersonLink`; rebuilt — `LoadingState` (skeleton), `ErrorState` (alert + retry), `Modal`, `ResearchCard`, `ProjectCard`, `GroupCard`, `TeamCard`, `NewsCard`, `PublicationItem`, `SearchResultCard`, `Footer`, `HeroCircuit`. Removed: `PageBanner` (→ `PageHeader`), `StatBlock` (→ `StatCard`), `PlaceholderPage` (dead code). Buttons, inputs and selects are a **class system** (`.btn--primary|secondary|ghost|danger|link`, `.form-group`) rather than wrapper components: no abstraction was added where a class already does the job.

## 3. Page by page

* **Home** — hero (headline, statement, "Explore Research" / "Meet Our Researchers"), live statistics (researchers, projects, publications, research areas), research areas, current projects (active first), **Research at a glance** (each area with its project and researcher counts — built only from real project↔area links; hidden when none exist), recent publications, latest news. Nothing is hard-coded; the unsupported "Est. 2024" badge was dropped.
* **Research** — cards with icon, tag, description and the projects the API links to each area (count + up to three links).
* **Projects** — status filter chips (`aria-pressed`), count line, cards. **Project detail** — breadcrumb, description, status/dates/group, a Team panel with roles, Research-areas panel, then Publications and News with counts. Desktop: panels beside the text; phone: about → team → output.
* **Groups / group detail** — group cards; detail shows members (`PersonLink`) and its project cards.
* **Team / profile** — category sections with counts; a researcher page has Biography, History (timeline), Publications, News, and a side summary (avatar, role, projects & groups). No account ids are rendered.
* **Publications** — year headings (newest first), a dense ruled list: title, authors, venue + year, external links (new tab, `noopener`, announced to screen readers).
* **News** — uniform cards: date, type, title, summary.
* **Search** — presentation only (chips with counts, type-labelled compact cards, pager, empty/skeleton/error states, a distinct tab title per query); the engine and API are untouched.
* **Contact** — the same details as before (they are the reference site's placeholders; the lab must supply real ones) as a definition list with icons, plus the same not-connected form.
* **Login** — brand mark, labelled fields with autocomplete hints, alert on failure, loading label; authentication unchanged.
* **Schedule** — same calendar and id, framed and responsive.
* **Admin dashboard** — summary cards from real data (accounts, per-role counts, profiles without a login), quick links to the six content pages, the account list with the same controls. No audit viewer, no CMS.
* **My Profile** — the form beside a live preview panel; field errors tied to fields.
* **Footer** — built from the same `navConfig` as the header (Research, People, Lab), the existing tagline, copyright. No invented addresses or accounts.

## 4. Navigation

Architecture unchanged (Research ▾, People ▾, Schedule, Contact, Search, Account ▾ / Log in; no Community group; route protection untouched). Visual polish only: the header lines up with the page grid, the logo shows the lab's name on wide screens, animated dropdown, hamburger → close icon, one focus ring. One behavioural fix: while the session loads the account slot is held empty (`data-auth="loading"`), so a signed-in visitor no longer sees "Log in" flash.

## 5. Accessibility

Single `<main id="main">` per page (App-level) with a **skip link**; one `<h1>`; headings never skip a level (list pages carry a visually hidden `h2`); breadcrumbs as `nav aria-label="Breadcrumb"`; every field labelled; icon buttons named (`Edit <title>`); tab title per page; **modal**: `role="dialog"` + `aria-modal` + `aria-labelledby`, initial focus (Cancel on destructive dialogs), Tab trap, Escape, backdrop click only when the press *and* release are on the backdrop, focus returns to the opener, scroll lock, bottom-sheet on phones; state is never colour alone (status/visibility badges carry words and icons); WCAG AA contrast verified by computed styles on every page; 40–44px touch targets on phones; `prefers-reduced-motion` honoured (page fade, transitions, hero pulse, skeleton shimmer).

Two real defects this phase found and fixed: the page fade's fill-mode kept `<main>` a stacking context, so the sticky header painted **over** modal backdrops; and the footer sat inside the first screen during loading, causing a 0.3–0.5 layout shift on every list page (now 0).

## 6. Motion

Subtle and finite: a 0.28s page fade/slide, a 0.2s dropdown, a 0.28s modal rise, 1px card lift, button/link colour transitions, and **one** quiet signal pulse on the hero circuit (the only looping animation besides loading skeletons). All of it stops under `prefers-reduced-motion: reduce`.

## 7. Responsive

Tested at 390, 412, 768, 900, 1024, 1280, 1366, 1440, 1536, 1920 (browser suite) and reviewed visually at 390/768/1024/1366/1440: grids use `minmax(min(280px,100%),1fr)` (never wider than the screen), detail pages collapse to one column with the important panel first, forms go single-column at 16px (no iOS zoom), modals become bottom sheets, the footer folds to 2 then 1 column.

## 8. Tests

| Suite | Result |
|---|---|
| Unit (policy 210 + search 64) | passed |
| API regression | 559 passed |
| Search API / search cost | 209 / 10 passed |
| **Browser regression** | **671 passed, 0 failed** = 477 earlier + 194 new (`ONLY_UI`: 197 incl. shared checks) |
| Builds / Prisma validate | shared, server, web build; schema valid |

**Mutation testing**: 20 web mutations against the UI section (skip-link target, modal focus trap / Escape / focus return, page-fade stacking, footer layout shift, contrast token, hard-coded statistic, missing heading, external-link `rel`, delete-dialog default focus, reduced-motion rule, hard-coded colour, wrong connection count, autocomplete hint, changed contact details, phone panel order, tab title, wrong admin count, edit controls shown too widely). 19 were caught at once; one **survived** (delete confirmation no longer starting on Cancel) because the check accepted any focused element whose text contained "Cancel" (including the dialog itself) — the assertion now requires the Cancel *button*, and the mutation is caught.

New: `ONLY_UI=1 node scripts/browser-regression.cjs …` runs only the Phase 10.5 section. It covers structure and accessibility of all 15 guest pages, computed contrast, page-grid alignment, overflow at nine widths, touch targets, modal behaviour (focus, trap, Escape, backdrop, mobile fit), loading/empty/error states (faked API responses), layout shift, reduced motion, live home data vs the API for guest and admin, project/research/group/researcher/publication relationships, forms, admin dashboard numbers, profile form, security regression through the new UI, and a static scan of the source (no hard-coded colours or inline styles, tokens present, Phase 10.1 navigation intact).

Existing checks changed only where the DOM class names changed (`.member-pick`→`.pick-item`, `.member-list`→`.panel__list`, `.chip-row`→`.chips`) or where a check raced the new loading skeleton (waits added; nothing was removed or loosened).

## 9. Known limitations / deferred

* The contact page still shows the reference site's placeholder details ("[University Name]", `lab@university.edu`); the form is not connected to email. The lab must supply real details. **Update:** resolved by the Shimane University content update — `ContactPage` now shows the real Interdisciplinary Faculty of Science and Engineering / Matsue Campus address and `susmartcomputinglab@gmail.com`; the contact form itself is still not connected to an email service.
* Dark mode, i18n UI, events, notifications, messaging, forum, files/gallery, CMS, audit viewer: not started (Phase 11+).
* Publication ↔ project relationships are shown on project and profile pages, not on the publications list (the list API does not carry them, and no extra requests were added).
* Fonts still load from Google Fonts (unchanged); without them the fallbacks are system fonts.
