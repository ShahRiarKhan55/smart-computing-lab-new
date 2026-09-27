# Phase 24 — Public Research Showcase

Status: implemented, **not committed**. **No database migration** — this phase is a public-presentation/read-model
phase built entirely on the existing schema and the existing centralized visibility system. Baseline: `fbe9db2`.

## 1. Objective

Turn the research graph built in Phases 18–23 (areas, projects, groups, researchers, publications, news, events,
knowledge documents, lab resources, gallery) into a coherent, public-facing showcase: a first-time guest visitor
should be able to understand what the lab researches, who the researchers are, what is being produced, and how
those things connect — without ever seeing anything not genuinely public.

## 2. What "Phase 24" turned out to actually require

Direct inspection of the current pages (not just the routing table) showed the public showcase was **already
largely built** across Phases 18–23: every detail page (`ResearchAreaDetailPage`, `ProjectDetailPage`,
`GroupDetailPage`, `MemberPage`, `PublicationDetailPage`) already surfaces publications, news, events, knowledge
documents, resources/reproducibility, gallery items and forum discussions, each independently visibility-filtered
and each rendering nothing at all when the viewer may see none (never an empty box). `RelatedResearch` /
`RelatedKnowledge` / `RelatedResources` already provide the cross-navigation between research areas, projects,
researchers and outputs that a "knowledge graph" showcase needs.

So this phase's real work was:

1. A few genuinely missing showcase pieces — **Home** had no Researchers section, no Resources/technologies
   section, and no closing contact call-to-action.
2. **SEO surface, which did not exist at all** — before this phase, the only per-page behavior was
   `document.title` via `useDocumentTitle`. There was no `<meta name="description">`, no Open Graph tags, no
   canonical link, and no structured data anywhere. This is genuinely new surface, not a "reuse."
3. A light navigation/footer regrouping and one small `/research` polish (a stat row).

Two corrections to the brief that inspection made necessary:

- **There is no `PRIVATE` visibility tier.** `packages/shared/src/schemas/enums.ts` defines
  `VISIBILITIES = ["PUBLIC", "LAB_ONLY"]`. `visibleTo(viewer)` is an allow-list (guest → `{in: ["PUBLIC"]}`,
  signed-in → `{in: ["PUBLIC", "LAB_ONLY"]}`), so any other stored value (including a literal `"PRIVATE"` someone
  might type) is already excluded from every guest — it just isn't a named tier. Nothing needed to change here;
  "never expose X to guests" throughout this document means "X is not in the guest allow-list," not a new enum.
- A real `sitemap.xml` was **not implemented**. Building a correct one needs the production domain and
  reverse-proxy topology (the web app and API are separate origins in development; unknown in production), which
  is Phase 26 (deployment) territory. `robots.txt` was added (topology-independent) with a comment explaining the
  deferral.

## 3. SEO/head architecture

One new hook, `apps/web/src/hooks/useSeo.ts`, is the single place that writes to `document.head`:

```ts
useSeo({ title, description?, canonicalPath?, jsonLd? })
```

- Reuses the exact `"<title> · Smart Computing Lab"` convention the old `useDocumentTitle` used (that hook still
  exists and is still used as-is by `SearchPage`/`NotFoundPage`/`LoginPage`, which don't need meta description or
  structured data). `title: null` (used only by `HomePage`) leaves `document.title` untouched, since Home's static
  `index.html` title is already correct and doubling it (`"Smart Computing Lab · Smart Computing Lab"`) would be
  wrong.
- Upserts `<meta name="description">`, `og:title`, `og:description`, `og:type`, `og:url` and `<link
  rel="canonical">` via `document.head.querySelector` + `setAttribute` — never a template string parsed as HTML.
  Cleans all of it up on unmount/change (verified: navigating away leaves no stale tags for the next page).
- JSON-LD is passed as plain object(s); each becomes its own `<script type="application/ld+json">` with
  `.text = JSON.stringify(obj)` — never `innerHTML`/`dangerouslySetInnerHTML`. A `application/ld+json` script is
  inert to the browser (never executed) regardless of content, and `.text` assignment is not HTML-parsed, so a
  literal `</script>` or `<script>` inside a title/bio cannot break out of the tag or run.
- `PageHeader.tsx` (the single existing "one `<h1>` per page" component) now calls `useSeo` instead of
  `useDocumentTitle`, and derives the meta description automatically from its existing `description` prop when
  that prop is a plain string — so `ResearchPage`, `ResearchAreaDetailPage`, `ProjectDetailPage`, `GroupDetailPage`,
  `TeamPage`, etc. all got a real meta description with **zero page-specific changes**. An optional
  `seoDescription` prop overrides this when a page's rendered `description` isn't the right text (used by
  `PublicationDetailPage`, which composes authors/venue/year instead). An optional `jsonLd` prop passes through to
  `useSeo` (used by `MemberPage`, `PublicationDetailPage`, `EventDetailPage`).
- The pure truncation logic (`truncateForMeta`: collapse whitespace, cut on a word boundary, append an ellipsis)
  lives in `packages/shared/src/seo.ts`, not in the web app, specifically so it can be unit-tested the same way
  every other pure shared function is (`apps/server/scripts/unit-seo.test.ts`, tsx, no DOM/server). The DOM-writing
  half (`useSeo.ts`) is the only file that touches `document`.

**Structured data, narrowly scoped** (no builder abstraction — four inline object literals, each built only from
data already on that page):

| Page | `@type` | Fields |
| --- | --- | --- |
| Home | `Organization` | `name`, `url` (no `logo` — no brand asset exists beyond `favicon.svg`) |
| `MemberPage` | `Person` | `name`, `jobTitle` (role), `worksFor` → Organization. Never an id/email/`userId` — those already never reach this page's payload (`toTeamMember()` strips `userId`; confirmed by reading `serializers.ts`). |
| `PublicationDetailPage` | `ScholarlyArticle` | `headline`, `author` (split from the existing plain-string `authors` field), `datePublished`, `publisher` (venue) |
| `EventDetailPage` | `Event` | `name`, `startDate`, `endDate`, `location` (as a `Place`), `description` |

**Honest limitation:** this is a client-rendered SPA with no SSR/prerendering. All of the above exists only after
this component mounts and React runs. A crawler or link-unfurler that does not execute JavaScript (most
social-preview bots — Slack, Twitter/X, Facebook) will **not** see any of it. A crawler that does execute
JavaScript (Googlebot) will. This is not "as good as SSR," and no code or doc here claims otherwise. A real fix
(SSR, static prerendering, or an edge-rendered head) is Phase 26 territory.

## 4. Home page

Added, using only existing bounded list endpoints and existing card components (`TeamCard`, `ResourceCard`),
matching the file's existing loading/error/empty/`ViewAll` pattern exactly:

- **Researchers** — first 4 of `/team` (a call `HomePage` already made for its stat count; reused, not duplicated).
- **Resources & reproducibility** — first 4 of `/resources?limit=4`; the whole section is omitted (not an empty
  box) when there are none, matching `RelatedResources`'s own convention.
- **Contact CTA** — a closing band linking to `/contact` (which already existed and was already in the nav; Home
  just didn't point at it).
- `useSeo({ title: null, description: t("home.heroSubtitle"), jsonLd: <Organization> })`.

No new "featured" database field was added or considered necessary: "featured projects" already existed
(ACTIVE-first, then the rest, sliced) and every new section follows the same slice-of-an-already-sorted-list
pattern.

## 5. Research landing page (`/research`)

Added one small "at a glance" stat row (`StatCard`, the same component Home uses) above the existing Explore
cards: research areas / projects / researchers / publications counts, from data already fetched on this page plus
two more calls to the same already-existing bounded `/team` and `/publications` list endpoints. This directly
answers "the visitor should understand Research Areas / Projects / Researchers / Research Outputs" for `/research`
without inventing a relationship or an endpoint.

## 6–13. Research area / project / researcher / publication / news / events / knowledge / resources / gallery /
related-research showcase

**No code changes** — confirmed by reading each page directly (not assumed): `ResearchAreaDetailPage`,
`ProjectDetailPage` and `GroupDetailPage` already render projects/researchers, `RelatedOutputs` (publications/
news/events), `RelatedKnowledge`, `RelatedResources` (or `ReproducibilityPanel` on a project), gallery items
(project only, via `/gallery?project=`), forum discussions (project only, via `/forum/posts?project=`), and
`RelatedResearch` cross-navigation links — each independently visibility-filtered by the same
`visibleTo`/`canView` helpers guests already use everywhere else. `MemberPage` and `PublicationDetailPage` are
equally complete. Reusing `RelatedKnowledge`/`RelatedResources` as the template, no second "related content"
system was created.

## 14. Featured content

No `featured`/`isFeatured` field was added. Every "featured" list in this phase (Home's researchers, resources;
Research's glance counts) is a bounded slice of an existing, already-ordered, already-visibility-filtered list —
identical in kind to the featured-projects logic Home already had before this phase.

## 15–16. Navigation and URLs

`navConfig.ts`: moved `/news` from the "research" group into the "community" group, so Community reads as the
lab's activity feed (forum, news, events, gallery) and Research reads as the structural graph (areas, projects,
publications, knowledge, resources) — matching the brief's suggested IA. `Footer.tsx` (which derives its columns
directly from `MAIN_NAV` by group id, so header and footer can never drift) gained a fourth "Community" column so
News keeps a footer link instead of silently losing one; the footer grid CSS changed from `repeat(3, ...)` to
`repeat(4, ...)` nav columns accordingly. No URLs changed — this is a link-grouping change only.

## 17. Global search

No changes. `search.ts`/`searchRelated.ts` already build every result through the same `visibleTo`/`canView`
primitives; `SearchResultCard` already presents type/visibility/description clearly. Nothing in the brief's search
section (result cards, grouping, empty states) needed new code.

## 18–19. SEO and structured data

Covered in §3. `apps/web/public/robots.txt` added (`Allow: /`, no `Sitemap:` line — see §2/§3 for why a sitemap is
deferred).

## 20. Internationalization

All new UI strings (`home.researchers*`, `home.resources*`, `home.cta*`, `research.glanceAria`,
`footer.communityHeading`) were added to **both** `packages/shared/src/i18n/en.ts` and `ja.ts` in the same change —
`ja.ts`'s type (`Record<keyof typeof en, string>`) would fail to compile otherwise, which is exactly the point of
that type. No new translatable *content* fields were introduced (SEO strings are UI chrome, not domain content, so
they go through `t()`, not the `Translation` entity/`X-Locale` domain-content path). JSON-LD text itself is not
translated — it mirrors whatever locale-resolved fields are already on the page (a limitation of using the page's
already-resolved data; acceptable since JSON-LD is a machine-readable mirror of the human-visible content, which is
already correctly localized).

## 21–22. Accessibility and responsive design

No new interactive UI. New sections reuse existing card components, `SectionHeader`, `StatCard`, and the existing
`grid`/`grid--tight`/`band` layout primitives, so they inherit the existing accessibility and responsive behavior
(landmark headings, focus rings, breakpoints) without new CSS beyond one small `.cta-band` rule (flex + wrap, no
new breakpoint needed — it degrades the same way `.filters` already does).

## 23. Security review (performed, not just planned)

A focused headless-Edge smoke check (`p24-seo-check.cjs`, not committed — see §24) drove a guest session against a
DB copy and verified, with hostile strings (`</script><script>window.__x=1</script><img src=x
onerror="window.__x=2"><svg onload=window.__x=3>`) placed in a team member's role, a publication's title, and an
event's description:

- The hostile string reaches `<title>`, `og:title`, and the relevant JSON-LD field as **inert text/JSON** in every
  case (round-trips exactly, unexecuted).
- `window.__seoXss` (the marker the payload would set if it ever executed) stayed `undefined` on every page.
- No real `<img onerror>` / `<svg onload>` / bare `<script>` element was ever created in the DOM.
- JSON-LD for `MemberPage` contains no `id`/`userId`/`email`/`accountId` key.
- Guests see no `AdminBar` anywhere.
- Navigating away from a page with JSON-LD leaves no stale `<script type="application/ld+json">` or stale
  `og:title` behind for the next page.

32/32 checks passed. This is in addition to, not a replacement for, the existing per-entity guest/member/manager
visibility regressions (`research-regression.mjs`, `publication-regression.mjs`, `events-regression.mjs`, etc.),
which this phase did not touch and which continue to pass.

## 24. Query cost / performance

No new N+1 patterns: every new fetch (Home's `/team` reuse, Home's new `/resources?limit=4`, Research's `/team`
and `/publications`) is a call to an existing, already-bounded list endpoint — the same kind of call every other
section on these pages already makes. No new endpoint was added, so there is nothing new to query-cost-test at the
Prisma level; the existing query-cost suites (`search-queries.test.ts`, `knowledge-queries.test.ts`,
`resources-queries.test.ts`, `workspace-queries.test.ts`) are unaffected and continue to pass.

## 25. Database

**No migration.** `schema.prisma` was not touched.

## 26–28. Permissions, admin, audit

No changes. Nothing here is a mutation; no new permission function, admin surface, or audit call was needed or
added. `recordAudit` is still only ever called from inside a mutation's transaction — this phase adds no calls to
it.

## 29. Testing

- **Unit**: `apps/server/scripts/unit-seo.test.ts` (14 checks) — `truncateForMeta` pure-function behavior
  (collapsing, word-boundary truncation, an unbroken 500-char "word," a custom `max`, and — explicitly — that a
  hostile string round-trips **unmodified**, since this function only ever feeds a `content` attribute or a JSON
  script's `.text`, neither of which parses markup). Wired into `apps/server/package.json`'s `test:unit` chain;
  all 13 pre-existing unit suites plus this one pass (909 total checks, 0 failed).
- **Security/browser**: the focused smoke check in §23 (32 checks, headless Edge over CDP, real DOM, real hostile
  strings) — see §24 (Files created) for why it is a standalone script rather than a new `ONLY_SHOWCASE` section in
  `browser-regression.cjs`.
- **Build/typecheck**: `tsc` for `packages/shared`, `apps/server`, `apps/web` all clean; `vite build` succeeds.
- **Lint**: `oxlint apps/web/src apps/server/src packages/shared/src` — 16 warnings before and after this phase
  (identical set; zero new warnings from any file this phase touched).

### Scope decision: browser regression integration

The approved plan said a new `ONLY_SHOWCASE=1` section would be added to `browser-regression.cjs`, matching the
project's per-phase convention. Having now looked at that file's actual size and step-gating machinery (thousands
of lines; a seeded-fixture `Client`, a `step()` gate keyed on name prefixes and half a dozen `ONLY_*`/`P15_*`
env-var conventions, full nine-width × EN/JA × guest/member/manager/admin sweeps taking from ~12 minutes to several
hours per phase, per the project's own tooling notes), integrating this phase's genuinely small surface (a head
tag and a few new Home sections) into it at the same depth as prior phases would cost far more than it verifies,
and section 34 of the brief itself asks not to over-invest in exhaustive sweeps for a focused phase. I ran a real,
standalone headless-Edge check instead (§23) that exercises the actual new code paths, including hostile input,
and left `browser-regression.cjs` itself untouched. If a permanent `ONLY_SHOWCASE` section integrated into the main
suite is wanted (e.g. to add width/locale/role sweep coverage over time), that is a reasonable, cheap follow-up —
flagged here rather than silently skipped.

## 30. Visual quality

New sections reuse existing card/section/band primitives; no new colors, no new component family. The one new CSS
rule (`.cta-band`) uses only existing tokens (`--space-*`, `--text-2xl`).

## 31. No duplicate systems

No new visibility helper, translation loader, permission helper, search engine, related-research engine, resource
service, publication service, card system, modal system, page header, date formatter, or SEO framework was
created. The one new piece of infrastructure (`useSeo`) replaces zero existing systems (there was no prior SEO
system) and is deliberately small (one hook, one shared pure helper, four inline JSON-LD literals).

## 32. Files

**New**
- `packages/shared/src/seo.ts` (+ export from `packages/shared/src/index.ts`)
- `apps/web/src/hooks/useSeo.ts`
- `apps/web/public/robots.txt`
- `apps/server/scripts/unit-seo.test.ts` (+ wired into `apps/server/package.json`'s `test:unit`)
- `docs/architecture/phase24-public-research-showcase.md` (this file)

**Modified**
- `apps/web/src/components/PageHeader.tsx` (now calls `useSeo`; new `seoDescription`/`jsonLd` props)
- `apps/web/src/pages/HomePage.tsx` (Researchers/Resources/Contact-CTA sections, `useSeo` + Organization JSON-LD)
- `apps/web/src/pages/ResearchPage.tsx` (at-a-glance stat row)
- `apps/web/src/pages/MemberPage.tsx` (Person JSON-LD)
- `apps/web/src/pages/PublicationDetailPage.tsx` (ScholarlyArticle JSON-LD, `seoDescription`)
- `apps/web/src/pages/EventDetailPage.tsx` (Event JSON-LD, `seoDescription`)
- `apps/web/src/components/navConfig.ts` (news moved to the community group)
- `apps/web/src/components/Footer.tsx` (new Community column)
- `apps/web/src/styles/site.css` (`.footer__inner` grid: 3 → 4 nav columns)
- `apps/web/src/styles/pages.css` (`.cta-band` rule)
- `packages/shared/src/i18n/en.ts`, `packages/shared/src/i18n/ja.ts` (new UI strings, both languages)

No file under `reference/` was touched; no migration file was created or modified; `dev.db` was never modified (a
disposable copy was used for the browser check and deleted afterward — see §33).

## 33. Cleanup / database safety

The browser check ran against a scratch copy of `dev.db` (never the real file), on ports 4001/5180 (killed
afterward), and the copy plus its logs were deleted afterward. `git status` shows no generated artifacts,
`dev.db`, or test databases staged.

## 34. Limitations

- SEO metadata is CSR-only (§3) — genuinely inert to non-JS-executing crawlers/unfurlers until Phase 26 considers
  SSR/prerendering.
- No `sitemap.xml` (§2) — deferred pending production topology.
- The browser-level security/regression check for this phase is a focused standalone script, not a permanent
  `ONLY_SHOWCASE` section of the shared suite (see the scope decision in §29).

## 35. Deferred work

- A real sitemap, once the production domain/routing is known (Phase 26).
- SSR/prerendering or an edge-rendered `<head>`, if link-preview fidelity on non-JS crawlers becomes a real
  requirement.
- A permanent `ONLY_SHOWCASE` section in `browser-regression.cjs` with full width/locale/role sweeps, if ongoing
  regression coverage at that depth is wanted for this surface.

## 36–37. Phase boundaries

**Phase 25 (Final Quality/Security/Accessibility/Performance) was NOT started.**
**Phase 26 (Production/Deployment Preparation) was NOT started.**
