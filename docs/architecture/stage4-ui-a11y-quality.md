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

## Follow-up: the remaining sweep gaps (verification pass)

The items above left four things open. They were re-run on `master` at `261076f` with a hardened runner (disposable DB copy, `connection_limit=1`, built web via `vite preview`,
isolated ports, process-group teardown, single-instance lock). **Lesson about the sweep itself:** it prints only failures, so a long passing run is silent; the earlier "stalls" of the knowledge and
resources sections were slow runs killed by a no-output watchdog, not hangs. Use `P15_LOG=1` (one line per page) and `P15_W=390,1280` to bound the time (about 10 minutes per section).

| Item | Result |
|---|---|
| `ONLY_KNOWLEDGE` (390/1280px) | **1,017 passed, 0 failed.** The long-token failures reported there no longer occur (they were the `pre-wrap` measurement fixed above) |
| `ONLY_RESOURCES` (390/1280px) | Before: **1,126 passed, 9 failed** - a real product defect, see below. After the fix: **1,135 passed, 0 failed** |
| focus-ring checks on `/research` and `/publications` | **Not reproduced.** `ONLY_RESEARCH` 206/0 and `ONLY_PUBS` 176/0 (guest, 1280px) pass, as do the five in `ONLY_UI` (205/0). One mechanism was tested: a script-driven `.focus()` loses its `:focus-visible` ring only if the page has just received a *mouse click* (it keeps it after no input or a key press). These steps focus right after a fresh navigation, so that does not explain the reported failures; they remain unexplained and unchanged |
| `9.1 add-publication form offers 'show on my member profile'` | **Reproduced and fixed (test only).** The button exists only after `/api/auth/me` resolves; the sweep clicked as soon as the page header was visible, so with the session lookup slower than ~300-600ms the click did nothing and the check waited in vain. Reproduced with the sweep's own primitives (no latency passes; `/api/auth/me` +600ms fails; waiting for the button passes even at +1500ms). The check now waits for the button |
| `disc-guest group` (`ja`, 900px: `<html lang>`, one `h1`/`main`) | **Not reproduced.** Three natural runs of `ONLY_DISCOVERY` at 900px (guest): 144 passed, 0 failed each. Three constructed races were tested and ruled out: a slow lazy route chunk (the `aria-busy` wait covers the fallback), a stale previous document, and an unmounted `index.html` shell (the sweep's readiness probes wait for the mounted nav). No change was made; the original one-off remains unexplained |

### Product defect found: global Prisma client used inside a transaction (resources, events)
Running the resources section with a single database connection produced 9 deterministic failures, all downstream of `500 PUT /api/resources/:id`. `assertLinks` was called inside `prisma.$transaction`
but queried through the **shared** client, so it waited for the connection the transaction itself held until Prisma's 5 s timeout (`P2028`) - the same bug class as the knowledge route fixed in Phase 3. On Turso's
serialized adapter the same wait is expected in production (runbook scenario 13), i.e. adding a link or project to a resource would have answered 500 after ~5 s. A mechanical scan of every `$transaction`
callback found one more site: `PUT /api/events/:id` when an event is linked to a project (`assertMayLinkProject`). Both helpers now take the client explicitly (`db`), as the knowledge route does:
`prisma` outside a transaction, `tx` inside. The Phase 3 runbook's earlier scan could not see helper functions; this one follows them.

* Regression: `test:transaction-client` (single connection) gained 12 checks for the two routes: 27 passed / 8 failed before the fix (requests took ~5.0 s and answered 500, or answered the correct 400 only after the timeout), 35 / 0 after.
* Guard: `scripts/unit-tx-client-scan.test.ts`, part of `test:unit` (and so of CI), fails when any `$transaction` callback uses the global client directly or through a helper that is not handed `tx`. It is tested on synthetic sources, and restoring the original route files makes it fail naming both sites.

## Not covered here
* The new browser test (`test:ui-a11y`) is not part of the CI workflow (it needs a browser that is not a repository dependency); the sweep sections are manual.
* The full unfiltered sweep (all sections, nine widths, every role) was not run; the sections above were run narrowed to 390/1280px (or 1280px / 900px where stated).
* Not reproduced and unexplained: the two single-page focus-ring failures and the `disc-guest group` pair. They are left as they are rather than "fixed" without evidence.
