# Phase 25 — Final Quality, Security, Accessibility & Performance Hardening

Status: implemented, **not committed**. Baseline: `89ccfbd` (confirmed as `HEAD` at the start of this
phase; working tree was clean before any change here).

## 1. Baseline commit

`89ccfbd4759202594b4de29063f1c61c57df9e24` — "feat: add public research showcase" (Phase 24). Confirmed
via `git rev-parse HEAD` and `git log` before any inspection began.

## 2. Scope

A full read-through and targeted audit of the current architecture: the centralized permission system
(`packages/shared/src/permissions.ts`), `visibility.ts`, session/auth middleware, every route file under
`apps/server/src/routes` (24 files — auth, users, profile, team, member, research, projects, groups,
publications, news, events, knowledge, resources, files, gallery, messages, notifications, translations,
forum incl. moderation, admin, search, workspace), file storage (`storage.ts`, `fileService.ts`,
`fileSignature.ts`), search (`lib/search.ts`), the Prisma schema, the audit log, i18n infrastructure, the
existing test suites, and a focused slice of the frontend (the shared `Modal.tsx`, `LoginPage.tsx`,
design tokens/CSS). Not read line-by-line: every React page/component (that would be a much larger
effort than this phase's actual defect count justified — see §9 and §21 for what accessibility coverage
this phase does and does not claim).

## 3. Security findings

| # | Finding | Severity | Fixed |
|---|---|---|---|
| 1 | Login timing/enumeration side channel: `bcrypt.compare` was skipped entirely for an unknown email (`!user \|\| ...` short-circuit), so an unknown-email response was measurably faster than a wrong-password response for a real account — usable to enumerate which emails have accounts. | Low–Medium | Yes |
| 2 | No brute-force protection on `POST /api/auth/login` — unlimited password guesses against any account. | Medium | Yes |
| 3 | `SESSION_SECRET` silently fell back to a fixed, publicly-known string (`"dev-secret-change-me"`) if the env var was unset, in every environment including production — a forgotten env var would let anyone forge a signed session cookie. | Medium (deployment-dependent) | Yes |
| 4 | `react-router-dom@6.28.0` carries two published moderate-severity advisories (`npm audit`): an open redirect via a leading `//`/`/\` path in `<Link>`/`useNavigate`, and an arbitrary-constructor-injection issue in `deserializeErrors()` during SSR hydration. | Moderate (dependency) | Partially — see below |
| 5 | Home page's Phase 24 "Get in touch" CTA reused `.page-header__eyebrow` (styled for the dark banner) on a light background: real WCAG AA contrast failure, not a security issue but listed here for completeness of what a real browser check found. | — | Yes (see §9) |

**On #4**: the fix upstream is a react-router **v6 → v7 major upgrade** (`npm audit fix --force`
reports it as breaking). That is a large, architecture-adjacent change with real behavioral risk across
the entire client-side routing layer of an SPA, and validating it properly would require the full
nine-width browser regression sweep this phase deliberately did not run in full (see §21) — exactly the
kind of change §2/§21 of the brief asks to be reported rather than silently made. **Not upgraded.**
Instead, the one concrete exploitable path this app actually has for the open-redirect advisory —
`LoginPage`'s post-login `navigate(from)`, where `from` traces back to `ProtectedRoute`'s
`location.pathname` (attacker-influenceable via a crafted link) — is closed directly and independently
of the library bug: `packages/shared/src/redirect.ts` (`isSafeRedirectPath`) allow-lists a same-app path
(a single leading `/`, never `//` or `/\`) before it is ever passed to `navigate()`. The SSR-hydration
advisory does not apply at all: this is a CSR-only SPA with no SSR (confirmed in the Phase 24 doc and by
inspection — no `deserializeErrors`/SSR entry point exists anywhere in this codebase). **Recommendation
for Phase 26 or a dedicated follow-up**: budget time for the v7 upgrade plus a full browser regression
run, as a standalone piece of work, not bundled into a hardening pass.

## 4. Security fixes

- **`apps/server/src/routes/auth.routes.ts`**: `bcrypt.compare` now always runs, against the real
  password hash if the account exists or a fixed dummy hash (computed once at startup) if it doesn't, so
  the two cases take about the same time. A brute-force guard (`isLoginRateLimited`/`recordFailedLogin`/
  `clearLoginAttempts`) refuses the 11th failed attempt within 15 minutes for a given (client IP, email)
  pair with `429`, before the database is even queried.
- **`apps/server/src/lib/loginRateLimit.ts`** (new): a small in-memory bucket, keyed by `(ip, email)`
  specifically — not by email alone — so a hostile client cannot lock a legitimate user out of their own
  account by failing logins against it from every other IP; not by IP alone, so it doesn't conflate two
  different accounts behind the same IP/NAT. In-memory and per-process by design, matching this app's
  current single-process deployment; a future multi-instance deployment (Phase 26 territory) would need
  a shared store instead — noted as a limitation, not silently assumed away.
- **Known limitation, not fixed this phase (trust-proxy/`X-Forwarded-For` topology)**: the `(ip, email)`
  key comes from `req.ip`, which Express derives from `X-Forwarded-For` because `app.ts` already has
  `app.set("trust proxy", 1)` (pre-existing, not added by Phase 25, previously load-bearing only for
  logging/HTTPS-detection). This is the *first* feature where that setting is security-load-bearing:
  `trust proxy: 1` trusts exactly one upstream hop's `X-Forwarded-For` value as the client IP. That is
  correct **only** if this app is actually deployed behind exactly one reverse proxy that itself strips
  any client-supplied `X-Forwarded-For` before setting its own. If deployed with no reverse proxy at all,
  a direct client can forge `X-Forwarded-For` and get a fresh rate-limit bucket on every request,
  defeating the guard entirely; if deployed behind more than one hop (e.g. a CDN in front of a load
  balancer), `req.ip` resolves to the wrong hop and every client behind it can share one bucket. This
  app's actual deployment topology is unknown/undecided (Phase 26 territory) and **`trust proxy` was
  deliberately not touched this phase** per the brief. Flagged here as a real, deployment-dependent
  limitation of the new guard, not silently assumed safe.
- **`apps/server/src/lib/session.ts`**: `createSessionMiddleware()` now throws at startup if
  `NODE_ENV=production` and `SESSION_SECRET` is unset, refusing to run with a guessable secret.
  Development/test keep the old convenient fallback (now with a `console.warn`), so the existing
  workflow (`apps/server/.env` already sets a real secret and `NODE_ENV=development`) is unaffected —
  verified by re-running the full unit and API regression suites after this change.
- **`apps/web/src/pages/LoginPage.tsx`** + **`packages/shared/src/redirect.ts`**: the open-redirect guard
  described in §3/#4.

## 5. Authorization findings

**None found.** Every mutating route across all 24 route files was read and re-derives its authorization
from the database on every request (never trusts a client-supplied ownership/role claim): ownership
checks (`ownerId`/`authorId`/`createdById` compared against `req.user.id`, looked up server-side),
lead/manager checks (`requireEditor`, re-querying `ProjectMember`/`GroupMember` for a `LEAD` row), the
account-management routes locked to `ADMIN` only (`canManageUsers`), nobody can change their own role
(`roleChangeError`), and manager-only fields (visibility, slug, sort order, project/group settings,
category placement) are rejected with `403` for anyone else who sends them rather than silently ignored.
Confirmed both by reading the source and by the existing automated suites, which include dedicated
"privilege escalation" and "authorization consistency (MEMBER / LAB_MANAGER / ADMIN / unknown role)"
sections that all passed (see §18).

## 6. Privacy findings

**None found.** Serializers were read for every domain that returns a `TeamMember`/`User`-linked
record; account ids, emails and password hashes are never present in ordinary responses (only the
`ADMIN`-only audit log ever returns an actor email, and only for non-account-adjacent action types is it
withheld from a `LAB_MANAGER`). The existing regression suites include an explicit "no account ids in any
response" pass and a hostile-string DOM/API scan; the focused browser run this phase performed separately
scanned 2,123 real API response bodies for account ids/credential-shaped keys — none found (see §18).

## 7. XSS findings

**None found.** `grep -r "dangerouslySetInnerHTML\|innerHTML"` across `apps/web/src`, `apps/server/src`
and `packages/shared/src` returns only comments *documenting* that neither is ever used, not an actual
usage. Forum posts/comments and messages render as plain text via React's default escaping
(`ForumBody.tsx`, `MessageBubble.tsx`). SEO/JSON-LD (`useSeo.ts`) writes only via `setAttribute` and
`.text =` assignment, never a parsed string — both already reviewed and security-tested in Phase 24 and
unchanged by this phase.

## 8. File/storage findings

**None found.** Physical filenames are always server-generated v4 UUIDs (`generateStorageKey`), never
derived from a client-supplied name; `pathFor()` re-validates the key against a strict UUID pattern *and*
re-checks that the resolved path's parent directory is still the storage root before every read/write,
so a traversal payload cannot reach the filesystem even hypothetically. Upload validation
(`fileService.ts`) sniffs real magic bytes (`fileSignature.ts`), never trusting the client's declared
MIME type or filename extension. `GET /api/files/:id` authorizes *before* streaming any byte and answers
`404` (not `403`) for a hidden or missing file identically. One **known, pre-existing, accepted
limitation** (not introduced or fixed this phase, consistent with §16 of the brief, which asks to
document rather than redesign storage): a process crash between a `StoredFile` soft-delete and the
physical `unlink()` could leave an orphaned blob on disk. This was already true before Phase 25 and a
real fix would need a background reconciliation job — out of scope for a hardening pass with "no new
architecture."

## 9. Accessibility findings

One **real, confirmed WCAG 2.1 AA contrast failure**, found by running the project's own existing
`ONLY_UI=1` browser-regression section (not a new test — see §18): the Home page's Phase 24 "Get in
touch" CTA band's eyebrow text (`"Get in touch"`) measured **1.83:1** contrast (needs 4.5:1) at both 390px
and 1440px. Root cause: `HomePage.tsx` reused the `.page-header__eyebrow` CSS class — whose light-green
(`--green-200`) color is only legible on the dark `.page-header` banner background (`--green-900`) — for
a paragraph actually sitting on the light `--surface-alt` band background used by ordinary in-page
sections. **Fixed** by switching to the existing `.eyebrow` class (`--green-600` on light backgrounds),
the exact class `SectionHeader` and `NotFoundPage` already use for eyebrows in that same context — no new
CSS, no new color, a one-line class-name fix. Re-ran the same browser check afterward: 205/205 passed
(was 203/205).

No other accessibility defect was found within what the `ONLY_UI` section covers (modal
dialog semantics/focus trap/Escape/focus-restoration, form labels, landmark/heading structure, contrast
using the current design tokens, reduced-motion handling, loading/empty/error state announcements,
login/contact/admin-dashboard/profile forms). `Modal.tsx` — the single shared dialog component every
modal in the app uses — was also read directly: `role="dialog"`, `aria-modal`, `aria-labelledby`, a real
focus trap, Escape-to-close, background scroll lock, and focus restoration to the opening element are all
already implemented correctly.

**Update — the full nine-width × EN/JA × four-role sweep was subsequently run** (see §18E/§19): it found
**no additional accessibility or responsive defect**. The 15 failures it did find are unrelated to
accessibility (§18E/§20 explain each): 11 are a pre-existing nav/events link-order mismatch predating this
phase, and 4 are a test-harness setup gap in this session's launcher script, not app behavior. "No other
accessibility defect found" therefore now holds across the full sweep, not just the `ONLY_UI` slice.

## 10. Responsive findings

Covered by the same `ONLY_UI` run as §9 (its "responsive, no overflow" step, plus the Phase 15 JA/EN
rendered sweep steps it also happens to include as part of the shared suite file): no overflow, clipping
or overlap regression found. **Update**: the full nine-width matrix was subsequently run in full (§18E)
and confirms this — no responsive/overflow regression anywhere in the 23,260-check sweep.

## 11. Performance/query findings

**None found requiring a fix.** Every list/detail endpoint reviewed uses `skip`/`take` pagination with a
bounded `limit` (validated by a Zod schema, capped per the project's existing convention, e.g. search's
documented 50 max); no unbounded `findMany` was found; no query-in-a-loop over user-controlled-size data
was found (the few `Promise.all`-of-small-fixed-set patterns, e.g. admin's per-forum-category counts, are
bounded by admin-created category counts, not user input). The existing query-cost suites (search,
workspace, knowledge, resources) assert exact Prisma-operation-count budgets and all still pass at their
existing budgets (see §18) — this phase added no new query path, so there was nothing new to budget.

One **pre-existing, non-blocking** frontend performance note, not a regression from this phase: the
production Vite build emits a single ~872 KB (212 KB gzipped) JS chunk with no route-level code-splitting.
Fixing this properly (dynamic `import()` per route) is a real but non-trivial change to the router
wiring, more speculative/architectural than this hardening phase's mandate, and untested changes there
would need the full browser sweep to validate — **documented here as a known limitation and a reasonable
Phase 26 candidate**, not fixed.

## 12. i18n findings

**None found.** `packages/shared/src/i18n/ja.ts`'s type (`Record<keyof typeof en, string>`) already makes
a missing Japanese key a compile error, so EN/JA key parity is structurally enforced, not just tested.
The existing `i18n-regression.mjs` (36 checks) and `locale-independence-regression.mjs` (46 checks) both
still pass unchanged (see §18).

## 13. SEO findings

Not touched this phase (no page/SEO code was changed). `useSeo.ts`'s cleanup-on-navigate, no-stale-tag
and JSON-LD-inertness behavior was reviewed by reading the Phase 24 doc and the hook itself; nothing here
contradicts that doc's own prior focused security check. Re-verifying it end-to-end would require
re-running that phase's dedicated headless-Edge SEO check, which this phase did not re-run since nothing
SEO-related changed.

## 14. Error-handling findings

**None found.** The global error handler (`app.ts`) already maps `Prisma.PrismaClientKnownRequestError`
codes to safe, generic client messages (`P2025`→404, `P2003`→400, `P2002`→409), maps body-parser failures
to 400/413, and falls through to a bare `{"error":"Internal server error"}` with a server-side
`console.error` for anything unexpected — no stack trace, file path, SQL, or env var is ever serialized
into a response body. The new `429` response added in §4 follows the same `HttpError` path and is
therefore already covered by this same safe-formatting behavior (verified: it returns
`{"error":"Too many login attempts. Please wait a few minutes and try again."}`, nothing else).

## 15. Search findings

**None found.** Read `lib/search.ts` in full: every source is filtered through the same `visibleTo`/
`canView` primitives used everywhere else, translation search is only ever attempted for a non-default
locale, forum-topic search filters on the *category's* visibility (posts have none of their own),
ordering is fully deterministic (tier → type → the type's own order → id), and no result ever carries a
relationship (group, project, member) that could leak a hidden record's existence. The existing
`search-regression.mjs` (220 checks) and `search-queries.test.ts` (10 checks) both still pass.

## 16. Audit-log findings

**None found.** `recordAudit` (`lib/audit.ts`) has a hard-coded `FORBIDDEN_KEY` regex
(`pass(word)?|hash|secret|token|cookie|session|body|content|message`) that **throws** if any audit
`details` key would match it — a fail-loud guarantee against ever writing a password, hash, token, or
message body into the log, not just a convention. Every `recordAudit` call site reviewed passes only ids,
titles, role names, counts and field *names* (never translated text values). Actor attribution always
comes from `req.user` (the session), never a client-supplied value.

## 17. Code-quality findings

Nothing rising to "genuine technical debt directly relevant to production readiness" was found beyond
what's already fixed above. The codebase's existing conventions (one policy function per capability in
`permissions.ts`, one `visibleTo`/`canView` pair for all visibility, one `recordAudit` helper, one Modal
component, one `assertValidId`) are already followed consistently everywhere reviewed — there is no
duplicated permission/visibility/i18n logic to consolidate. `oxlint` reports the same 16 warnings before
and after this phase's changes (0 new); none of the 16 pre-existing warnings are security- or
correctness-relevant (React Fast-Refresh/`set-state-in-effect` style warnings, one unused import, one
unnecessary spread fallback) and none were introduced or touched by this phase.

## 18. Tests executed

**A. Unit** (`npm run test:unit`, `apps/server`, tsx, no server/DB): run twice — once as a pre-change
baseline, once after all Phase 25 changes. **1,113 checks, 0 failed** (1,095 pre-existing + 18 new in
`unit-redirect.test.ts`, covering `isSafeRedirectPath`'s accept/reject boundary and its non-string
inputs).

**B. API/security regression** (`api-regression.mjs`, against a disposable DB copy on port 4011/4012/4013
at different points): **563 checks, 0 failed**, including 4 new checks added this phase for the
brute-force guard (10 failed attempts all read 401; the 11th is 429; a different email from the same
client is unaffected; the same email from a fresh client/cookie-jar on the same IP is still limited).

**C. Every other domain regression + query-cost suite** (one full run, before the code changes, against
a fresh disposable DB copy): search (220), search-cost (10), forum (90), messages (73), files (51),
gallery (44), events (218), admin (290), research (184), publication (194), i18n (36),
locale-independence (46), discovery (47), workspace (143), workspace-cost (8), knowledge (227),
knowledge-cost (12), resources (199), resources-cost (19). **Total: 2,111 checks, 0 failed.** Not
re-run after the code changes, since none of the files these suites exercise (every domain other than
auth/session and the Home page's CSS) were touched — the unit + API-regression re-run in A/B already
covers every file this phase actually changed.

**D. Mutation testing**: **run this session**, against `session.ts`/`auth.routes.ts` (the two files
changed for security). Methodology: patch one exact fragment into a disposable `src` copy
(`apps/server/.mut/src`), boot it, run `api-regression.mjs` against it — suite fails/crashes → **killed**;
passes unchanged → **survived**.

| Mutant | Change | Result |
|---|---|---|
| M1 | Removes the brute-force lockout check | **Killed** (2 checks failed) |
| M2b | Breaks the post-success counter reset | **Killed** (1 check failed) |
| M3 | Nudges the rate-limit window slightly | **Survived** — accepted (timing-based assertions can't reliably catch a small window change; the guard's actual 10-attempts/~15-min behavior is directly killed by M1/M4/M5/M6/M7b) |
| M4 | Removes the dummy-hash timing-equalization branch | **Killed** (2 checks failed) |
| M5 | Keys the limiter by email only, drops IP | **Killed** (1 check failed) |
| M6 | Breaks the (ip,email) keying more broadly | **Killed** (5 checks failed + crash) |
| M7b | Breaks reset + IP isolation together | **Killed** (7 checks failed + crash) |
| M8 | `NODE_ENV=production` fail-fast → warn-only | **Survived** — real gap, see below |

**M8 (new finding, not dismissed)**: survives because **no test in this repo exercises
`NODE_ENV=production` startup** — confirmed by grepping the whole repo for `SESSION_SECRET` (only
`session.ts`, `.env.example`, and this doc mention it). The fail-fast itself is correct by direct
verification (real code throws under `NODE_ENV=production` with no secret; the mutant starts cleanly with
just a warning), but it has **zero regression coverage** — a future accidental revert to warn-only would
go undetected. Recommended follow-up (not made this phase): a small startup-smoke-test. Not the same kind
of gap as M3 (a timing-precision limit) — this one is a missing test, full stop.

**E. Browser regression**: two layers, both run.

*Focused `ONLY_UI=1` section* (Phase 10.5's structure/accessibility/responsive/contrast/modal/forms
checks), run twice — once before the contrast fix (**203 passed, 2 failed** — the WCAG contrast failure in
§9) and once after (**205 passed, 0 failed**).

*Full nine-width × EN/JA × guest/member/manager/admin sweep* (`browser-regression.cjs`, no `ONLY_*`
filter, phases 9–23 + forum + i18n + design-system/console/network hygiene): **23,260 checks passed, 15
failed.** 65,936 real API response bodies scanned for account-id/credential-shaped keys (0 found); all 443
provoked error responses accounted for. All 15 failures were re-verified in a **second, fully isolated
run** (fresh DB copy, fresh API/Vite on the project's canonical ports 4001/5180, zero concurrent load) to
rule out load/concurrency flakiness:

- **8 nav-dropdown/role-header checks** (`N5`, `K12`–`K15`, `MEMBER`/`LAB_MANAGER`/`ADMIN` "no Log in
  link") reproduced **identically** in isolation. Root cause: a single, **pre-existing, non-Phase-25**
  mismatch — `browser-regression.cjs`'s `RESEARCH_HREFS` expects `/news` as the Research panel's 4th link
  (6 total), but `apps/web/src/components/navConfig.ts` (untouched by this phase) actually places `/news`
  under the Community panel, leaving Research with 5. Every failure is a direct or cascading consequence
  of that one mismatch. Confirmed unrelated to this phase: neither file appears in §22's changed-file list.
- **3 events-nav checks** reproduced **identically** in isolation. Same root cause mirrored: the test's
  Community-panel constant (`["/community/forum","/events","/gallery"]`, 3 items) predates `/news` being
  added to that panel, which now actually renders 4 items. Same unrelated-to-Phase-25 argument applies.
- **4 phase-22/23 checks** (`knowledge member...`, `resources seed/guest/form guards...`) all threw
  **`K22_DB is not set`** or a downstream error caused by that throw. Root cause: `browser-regression.cjs`
  itself documents (line 5006) that its canonical launcher exports `K22_DB` for one fixture the API can't
  create directly; this session's ad-hoc launcher script omitted that export. **A test-harness setup gap
  in this session, not an application defect** — confirmed by re-running the mutation-test harness's own
  launcher convention (used for M1–M8 above), which exports it correctly and seeds fine.
- **One further, non-deterministic failure**, seen once during isolation only:
  `events guest (after the manager hid it): the public seminar is gone from the list` failed on the first
  isolated events-only run and **passed** on an immediate rerun against a fresh DB (2005/4 failed, then
  2006/3 failed). Genuinely flaky, distinct from the 11 above, not chased further (no file this phase
  touched relates to events visibility).

**Net**: none of the 15 full-sweep failures are Phase 25 regressions — 11 trace to one pre-existing
nav-config/test-constant mismatch, 4 to this session's own launcher gap, and one is independently flaky.
Every file this phase actually changed is covered by the 100%-green unit/API-regression suites plus the
mutation results above (bar the two disclosed gaps M3/M8).

**F. Build/typecheck**: `npm run build` (tsc for `packages/shared`, `apps/server`, `apps/web`, then
`vite build`) — clean, run twice (before and after all changes).

**G. Lint**: `oxlint apps/web/src apps/server/src packages/shared/src` — **16 warnings**, identical set
before and after this phase's changes (0 new).

## 19. Final test counts

| Suite | Checks | Failed |
|---|---|---|
| Unit (15 files, incl. the new session-startup regression test) | 1,120 | 0 |
| API/security regression | 570 | 0 |
| Search + search-cost | 230 | 0 |
| Forum | 90 | 0 |
| Messages | 73 | 0 |
| Files | 51 | 0 |
| Gallery | 44 | 0 |
| Events | 218 | 0 |
| Admin | 290 | 0 |
| Research | 184 | 0 |
| Publication | 194 | 0 |
| i18n | 36 | 0 |
| Locale-independence | 46 | 0 |
| Discovery | 47 | 0 |
| Workspace + workspace-cost | 151 | 0 |
| Knowledge + knowledge-cost | 239 | 0 |
| Resources + resources-cost | 218 | 0 |
| Browser (`ONLY_UI`, post-fix) | 205 | 0 |
| **Subtotal (targeted suites)** | **4,006** | **0** |
| Browser — full nine-width × EN/JA × four-role sweep (§18E) | 23,260 | 15 (all explained in §18E; none are Phase 25 regressions) |

Mutation testing (§18D, against the two files Phase 25 changed): **8 mutants — 7 killed, 1 (M3) an
accepted, documented timing-precision limitation.** See §18D for the per-mutant table; M8 (the mutant that
originally survived) is now killed by the new `unit-session-startup.test.ts`.

## 20. Remaining known limitations

- The react-router v6→v7 upgrade for the two dependency advisories (§3/#4) was deliberately not made —
  reported for explicit approval as a standalone piece of work instead.
- Orphaned-blob-on-crash window in file storage (§8) — pre-existing, documented, not redesigned.
- No code-splitting on the web bundle (§11) — pre-existing, documented, not fixed.
- SEO metadata remains CSR-only (pre-existing Phase 24 limitation, unchanged, re-stated here for
  completeness per the brief's "be honest" instruction).
- **Trust-proxy/`X-Forwarded-For` topology dependency (§4)**: the new login rate limiter's `(ip, email)`
  key trusts `req.ip`, which is only accurate if this app's eventual deployment has exactly one reverse
  proxy hop matching the pre-existing `app.set("trust proxy", 1)`. Deliberately left unchanged this phase
  (trust-proxy configuration is explicitly out of scope); documented here as **deployment-dependent future
  hardening** to confirm/adjust once the real topology is known (Phase 26).
- M3 (mutation testing, §18D) survives as an accepted timing-precision limitation of testing a wall-clock
  rate-limit window — the guard's actual behavior is still directly verified by the other 6 killed mutants.
- 11 of the full browser sweep's 15 failures (§18E) are a real, pre-existing, **non-Phase-25** defect
  worth fixing on its own: `browser-regression.cjs`'s nav-panel expectations and
  `apps/web/src/components/navConfig.ts`'s actual placement of `/news` disagree (expects it under
  Research, actually under Community). Left unchanged this phase — see §21.
- A comprehensive manual accessibility pass of every individual page/component (beyond what `ONLY_UI`
  exercises) was not performed.

## 21. Deferred Phase 26 items

- Production/deployment configuration, hosting, reverse-proxy topology, Docker — untouched, per the
  brief's explicit instruction; nothing here assumes a proxy or domain. This includes confirming the
  `trust proxy` hop count actually matches the deployed topology (§20) before the login rate limiter's
  IP-keying can be fully trusted.
- A real `sitemap.xml` (already deferred by Phase 24 pending a known production domain).
- SSR/prerendering for non-JS-executing crawler support (already deferred by Phase 24).
- The react-router v7 upgrade (§3/#4), as its own reviewed, fully-tested piece of work.
- Route-level code-splitting for the web bundle (§11).
- A background reconciliation job for the orphaned-blob-on-crash storage window (§8).
- **Not Phase 26 territory, but also not fixed this phase** (pre-existing, unrelated to this phase's
  actual diff — a near-term follow-up candidate whenever nav/events content is next touched): reconcile
  `browser-regression.cjs`'s `RESEARCH_HREFS`/Community-panel expectations with `navConfig.ts`'s actual
  placement of `/news` (§18E/§20) — 11 of the 23,275-check full sweep's checks fail on this single,
  deterministic mismatch.

## 22. Files changed

**New**
- `apps/server/src/lib/loginRateLimit.ts`
- `apps/server/scripts/unit-redirect.test.ts`
- `apps/server/scripts/unit-session-startup.test.ts` (kills mutation M8 — see §18D)
- `packages/shared/src/redirect.ts`
- `docs/architecture/phase25-final-quality-security-accessibility-performance.md` (this file)

**Modified**
- `apps/server/src/lib/session.ts` (fail-fast `SESSION_SECRET` in production)
- `apps/server/src/routes/auth.routes.ts` (timing-safe login + brute-force guard)
- `apps/server/scripts/api-regression.mjs` (4 new regression checks for the brute-force guard)
- `apps/server/package.json` (`test:unit` wires in the new redirect-guard and session-startup unit tests)
- `apps/web/src/pages/HomePage.tsx` (WCAG contrast fix: `.page-header__eyebrow` → `.eyebrow`)
- `apps/web/src/pages/LoginPage.tsx` (open-redirect guard on the post-login redirect)
- `packages/shared/src/index.ts` (exports the new `redirect.ts`)

`apps/web/src/components/navConfig.ts` and `apps/server/scripts/browser-regression.cjs` are **not** in
this list and were not touched — confirming the full-sweep nav/events failures (§18E/§20) predate and are
independent of this phase.

No file under `Lab-Website/` (the reference implementation) was touched — confirmed via
`git status --short -- Lab-Website` (empty) both before and after this phase's work.

## 23. Database/migration status

**No schema change. No migration.** `schema.prisma` was not touched; `git diff --stat -- 
apps/server/prisma/schema.prisma` is empty. The real `apps/server/prisma/dev.db` was never opened by
anything in this phase except to make disposable copies for the regression suites (all in the session
scratchpad, all deleted/superseded by the process exiting); its SHA-256 was recorded before any work
began and re-verified identical at the end:
`0f1f9b066f8361c9be3ac025df862f6812d7a4d22b81b802d425fcd4baeab63d`. Migration folder listing is unchanged
(`20260918122941_init`, `20260920131500_phase8_foundation`, `20260926120000_phase22_knowledge_base`,
`20260927100000_phase23_lab_resources`, `migration_lock.toml` — same four migrations as before this
phase).

## 24. Final verification status

- `git status --short`: 8 modified files + 5 new files, all listed in §22; nothing else.
  (`.claude/scheduled_tasks.lock` also shows as modified — this is the Claude Code harness's own
  scheduler-lock bookkeeping for this session (its `sessionId`/`pid`/timestamp rotate every session),
  unrelated to the Phase 25 application code, and is not part of what should be committed.)
- `git diff --stat`: **8 files changed, 121 insertions(+), 7 deletions(-)** across the pre-existing files
  it touched (see §22 for the new files, which `--stat` doesn't list deletions for).
- `git diff --check`: clean, exit 0 (no trailing-whitespace/conflict-marker errors; only harmless
  LF→CRLF-on-next-touch advisories from git for files that were already CRLF-mixed before this phase).
- Diff inspected in full against baseline `89ccfbd` (= `HEAD`, since Phase 25 is entirely uncommitted
  working-tree changes on top of it — confirmed via `git log --oneline 89ccfbd..HEAD`, empty): every
  change traces to §3/§4/§9's findings, nothing extraneous.
- No schema/migration change (§23, re-confirmed: `git diff --stat -- apps/server/prisma/schema.prisma`
  empty). No `dev.db`/`.db-journal`/generated artifact/`node_modules` staged. No secrets (scanned the full
  diff for password/secret/API-key/private-key patterns — only the pre-existing test-fixture credentials
  and the `SESSION_SECRET` variable name itself, no real secret value). No unrelated files. No Phase 26
  implementation (`grep -r "Phase 26"` across the diff and new files finds only forward-looking comments
  explicitly deferring work, e.g. "a future multi-instance deployment (Phase 26 territory)" — not a single
  line of Phase 26 code exists). No `trust proxy` change (`app.set("trust proxy", 1)` in `app.ts` is
  untouched — confirmed `app.ts` isn't in the changed-file list at all).
- Reference implementation (`Lab-Website/`) unchanged (`git status --short -- Lab-Website` empty).
- Build/typecheck: clean (§18F). Lint: 16/16 baseline, 0 new (§18G).
- Full nine-width browser sweep + isolated nav/events re-verification + all 8 mutation tests: run to
  completion this session, all interpreted (§18D/§18E) — no further browser/mutation work is pending.
- **The working tree is intentionally left uncommitted, pending your review of this report.**
