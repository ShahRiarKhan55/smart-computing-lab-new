# Stage 4, workstream 2: UI and accessibility quality

Phase 25 and 26 reported a group of UI/accessibility failures from the full browser sweep and left them open. Each was re-investigated on `master` at `647020c`
before anything was changed. **Only one was a product defect.** The rest were stale or mis-measuring test expectations; they were corrected in the test, not in the product.

| Reported item | Finding | Change |
|---|---|---|
| `/news` placement (`N5`, `K12`-`K15`, three role checks, events-nav) | Not a product bug. Phase 24 moved News from Research to Community on purpose (`phase24-public-research-showcase.md`). The sweep still expected the old order. | Sweep expectations updated (`RESEARCH_HREFS`, Community order, one keyboard path length) |
| Account menu checks (5 failures, not in the Phase 26 list) | Not a product bug. "Help & Documentation" (`/docs`) was added to the Account menu with the documentation hub. | Sweep expectations now include it |
| Long-token overflow on `/knowledge/:id`, `/resources/:id` | **Not a CSS defect.** `.knowledge-body` is `white-space: pre-wrap`; a space at the end of a wrapped line hangs about one space-width past the box by design (measured: box right edge 370px, text range 374px, `scrollWidth == clientWidth`). The sweep's range measurement counted that invisible space. No horizontal scroll, no clipped text. | Measurement for `pre*` boxes now asks whether anything is scrollable (`scrollWidth`). A mutation test (all wrapping disabled) makes the check fail with a 3,080px page overflow, so it still catches real overflow |
| Focused link covered by a `<dd>` on `/resources/:id` | **Not reproduced.** With the measurement taken after scroll and transitions settle, a Tab walk over both pages (EN/JA, 390/1280px) finds no covered focus. | None (kept as a regression check) |
| `admin files`: "no storage key, path or file URL on the page" | Not a leak. The check scanned the whole document and matched the CSP rationale **comment in `index.html`'s `<head>`** ("... /api/files/:id"). | The check scans `document.body` |
| Japanese admin people page overflows at 390px (14px) | **Product defect, fixed.** `.account-row__actions` was a non-wrapping flex row (role select + link/unlink + Delete); Japanese labels made it 13px wider than the screen. | `flex-wrap: wrap` on `.account-row__actions` (`pages.css`) |
| `link-profile` / `delete-account` dialogs not opening at ja/390px | Not reproduced; both open from a real click, fit the screen, and close on Escape. | None (kept as a regression check) |
| `ONLY_UI` skip-link and 44px-button checks | Timing artifacts, not defects: the skip link slides in (-60px -> 8px) and the modal scales 0.988 -> 1 on open (buttons measure 43.5px at t+0, 44px once settled). | Both checks wait for the transition |

## Tests
* `npm run test:ui-a11y -w apps/server` (new, `scripts/ui-a11y-regression.mjs`): temporary SQLite database, API on :4001, Vite on :5173, Playwright Chromium (not a repository dependency; exits 2 if absent, installs nothing). 33 checks: long-token wrapping and Tab-walk coverage on knowledge and resource detail pages (EN/JA at 390 and 1280px, with a check that the content is really rendered), and the Japanese 390px admin people page (no overflow, both dialogs open/fit/close).
  Before the CSS fix it failed exactly one check (the 13px overflow); after, 33 of 33.
* `scripts/browser-regression.cjs` (the full sweep) sections run after the changes: `ONLY_NAV` 239/0 (was 226/13), `ONLY_UI` 205/0 (was 203/2), `ONLY_ADMIN` at 390/412/768/1280/1920px 736/0, `ONLY_EVENTS` at 390/1280px 577/0.

## Not covered here
* The new browser test is not part of the CI workflow (it needs a browser that is not a repository dependency).
* The sweep sections for knowledge and resources (`ONLY_KNOWLEDGE`, `ONLY_RESOURCES`) stalled repeatedly in the container used for this work (API transaction timeouts under load, then a harness hang), so they were not used as evidence; the targeted test above covers the reported pages instead.
* The remaining Phase 26 items were not re-investigated: the focus-ring checks of the `ONLY_UI` section pass here (205/0), but the two single-page instances on `/research` and `/publications` belong to the full sweep, which was not run; likewise the intermittent `9.1` check and the one-off `disc-guest group` pair.
