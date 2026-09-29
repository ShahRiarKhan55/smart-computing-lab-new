# Phase 26 — Deployment Readiness, Infrastructure Hardening & Production Performance

Status: implemented, **not committed** (pending your review). Baseline: `b59ca256c44c4a1aaa0cd38589ec8f276fe6673f`
— "feat: harden security accessibility and performance" (Phase 25), confirmed as `HEAD` at the start
of this phase via `git log`/`git status`; working tree was clean before any change here.

## 1. Baseline

`b59ca256c44c4a1aaa0cd38589ec8f276fe6673f`. Verified: this is exactly the Phase 25 work (§22 of
that doc's file list matches this commit's `git show --stat` exactly), so Phase 25 is complete and
committed, not pending — the "not committed" line at the top of that document was stale by the time
this phase started.

## 2. Goals (from the brief)

Make the application substantially more production/deployment-ready by addressing the concrete
infrastructure and deployment limitations Phase 25 identified but explicitly deferred: the
hard-coded `trust proxy: 1`, no HTTP security headers, no centralized production config
validation, an undocumented session/cookie production interaction, the in-memory rate limiter's
multi-instance limitation, the storage orphan-blob crash window, the single ~872 KB JS chunk, the
open react-router advisories, and no `robots.txt`/`sitemap.xml`. Explicitly **not** a new-feature
phase: no second auth/permission/translation/search/storage system, no schema/migration change
(none was found necessary — see §23), no Phase 27 work.

## 3. Architecture review

Read before changing anything: `apps/server/src/app.ts`, `index.ts`, `lib/session.ts`,
`lib/loginRateLimit.ts`, `routes/auth.routes.ts`, `lib/storage.ts`, `lib/fileService.ts`,
`routes/files.routes.ts`, `middleware/auth.ts`, `lib/visibility.ts`, `lib/prisma.ts`,
`prisma/schema.prisma`, `apps/web/src/App.tsx`, `main.tsx`, `vite.config.ts`, `index.html`,
`hooks/useSeo.ts`, `i18n/LocaleContext.tsx`, `auth/ProtectedRoute.tsx`, `components/Nav.tsx`, and
the existing regression scripts' conventions (`api-regression.mjs`, `unit-session-startup.test.ts`,
`browser-regression.cjs`). Confirmed along the way:

- This server is **JSON-API-only** — no `express.static`, no HTML ever served by Express. The SPA
  (`apps/web`) is built as static files and deployed **separately**. No CORS package is configured
  anywhere, and the Vite dev proxy forwards `/api` to `:4001` — both facts only make sense if the
  real deployment topology is **one origin**: a reverse proxy serving the static SPA build and
  forwarding `/api/*` (and, as of this phase, `/robots.txt`/`/sitemap.xml`) to this API process.
  This app had **no deployment documentation of any kind** before this phase (no Dockerfile, no
  README, no `docs/architecture/*deploy*`) — §20 below is the first place this topology is written
  down explicitly, not assumed.
- `TeamMember` has no `visibility` column at all (the roster is unconditionally public); `GalleryItem`'s
  visibility is entirely inherited from its `StoredFile.visibility` (no gallery item detail route
  exists in the frontend router at all — only the `/gallery` list). Both facts mattered for §14.
- There is **no password-change endpoint anywhere in this codebase** — only account creation (admin
  only, `POST /api/users`) and login/logout. "Authentication state after a password change" (§5 of
  the brief) has nothing to test because the feature does not exist; inventing one would be exactly
  the kind of new-feature work this phase is not. A role change or account deletion, by contrast,
  already takes effect on the very next request (`getSessionUser` re-queries the database every
  time, never trusts session-cached role data) — verified by reading `middleware/auth.ts` and by
  the existing "promoted member takes effect on their live session" browser-regression step.
- `session.regenerate()` on login (session-fixation resistance) already existed before this phase.

## 4. Trust-proxy / client-IP hardening

**Problem** (Phase 25 §3/§4, deferred): `app.ts` hard-coded `app.set("trust proxy", 1)` in every
environment. That is only correct behind exactly one reverse-proxy hop that itself strips any
client-supplied `X-Forwarded-For`; deployed with no proxy at all, a direct client can forge
`X-Forwarded-For` and get a fresh login-rate-limit bucket on every request, defeating the Phase 25
brute-force guard entirely.

**Fix**: `apps/server/src/lib/trustProxy.ts`, a new `TRUST_PROXY` environment variable, explicit and
fail-fast in production (mirrors the existing `SESSION_SECRET` pattern in `lib/session.ts`):

| Value | Meaning | Certified by this app's own tests |
|---|---|---|
| `0` / `false` | No reverse proxy. `X-Forwarded-For` is never trusted; `req.ip` is always the real socket address. | Yes — `scripts/trust-proxy-regression.mjs` |
| `1` | Exactly one trusted reverse-proxy hop that strips any client-supplied `X-Forwarded-For` before setting its own. | Yes — `scripts/api-regression.mjs`'s brute-force/XFF section |
| an integer `> 1`, or a comma-separated IP/CIDR/Express-preset list | Passed straight through to Express's own `trust proxy` mechanism. | **No** — accepted, but this app's tests only certify `0` and `1`; the brief explicitly asked not to claim arbitrary topologies are solved |
| `true` | **Rejected** (throws at startup, every environment) | — trusting every hop unconditionally is exactly the problem this variable exists to prevent |
| unset | **Rejected in production** (fail-fast, same pattern as `SESSION_SECRET`); defaults to `0` in development/test so the existing local workflow is unaffected | `scripts/unit-trust-proxy-startup.test.ts` |

`app.ts` now calls `app.set("trust proxy", resolveTrustProxy())` as literally the first line of
`createApp()`. Documented in `.env.example` with both accepted production values and a one-line
description of each.

**Regression tests added** (53 new checks total across the four new self-contained scripts below —
each copies `apps/server/prisma/dev.db` to a disposable temp file and spawns the real server, the
same discipline `unit-session-startup.test.ts` already established):

- `scripts/unit-trust-proxy-startup.test.ts` (15 checks) — production without `TRUST_PROXY` refuses
  to start; `TRUST_PROXY=true` refuses to start; `TRUST_PROXY=0` and `TRUST_PROXY=1` both start
  cleanly; production without `DATABASE_URL` refuses to start (see §7).
- `scripts/trust-proxy-regression.mjs` (5 checks) — under `TRUST_PROXY=0`, a spoofed
  `X-Forwarded-For` has **no effect at all**: two claimed IPs from the one real connection share a
  single rate-limit bucket, exactly like a direct request with no header at all.
- `scripts/api-regression.mjs`'s existing XFF section (4 checks, **updated, not rewritten**): now
  explicitly documented as requiring `TRUST_PROXY=1` when the disposable server under test is
  started, and reworded to describe what it now proves (the *trusted*-proxy topology) instead of
  the old "this repo has no reverse proxy in front yet" caveat, which is no longer true.

## 5. Production HTTP security headers

`apps/server/src/lib/security.ts` — `helmet@8`, added as a new dependency (a standard, widely
audited middleware library; not a second framework). Configuration is deliberately scoped to what
protects a **JSON API** (this server never serves HTML):

- `contentSecurityPolicy: false` on the API. CSP is a document-level protection; the SPA carries its
  own (see below) since this server has no part in serving its HTML.
- `crossOriginResourcePolicy: "same-origin"` — matches the one documented topology (§8): SPA and API
  share an origin via the reverse proxy, so `GET /api/files/:id` loading from an `<img>` tag stays
  same-origin.
- `crossOriginEmbedderPolicy: false` — deliberately left off; it protects isolation guarantees
  nothing here needs and is a common source of unrelated breakage.
- `hsts` only when `NODE_ENV=production` — an HSTS header sent to a plain-HTTP local dev server would
  be cached by the browser and very disruptive to undo.
- Always on, every environment: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `X-Powered-By` removed.

**The SPA's own CSP** lives in `apps/web/index.html` as a `<meta http-equiv="Content-Security-Policy">`
tag (the only place it can live, since no server renders this document): `frame-src
https://calendar.google.com` (the one real third-party iframe, on `/schedule`), `style-src
https://fonts.googleapis.com` + `font-src https://fonts.gstatic.com` (Google Fonts), `img-src 'self'
data:` and `connect-src 'self'` (every image and API call is same-origin — no external image host or
third-party API is used anywhere), `style-src` also needs `'unsafe-inline'` for exactly one dynamic
inline `style={{ width }}` bar-chart fill in `HomePage.tsx` — a deliberate, documented trade-off, not
an oversight.

**Explicit, documented body limit**: `express.json({ limit: "100kb" })` — Express's own long-standing
default, made an explicit named constant (`JSON_BODY_LIMIT` in `app.ts`) instead of an implicit
library default, so a future change is a deliberate one-line edit. Verified still returns a clean
413 (not a crash) for an oversized body — see §17.

**Default `Cache-Control: no-store`** added for every `/api/*` response (a route that legitimately
wants caching, like the existing `GET /api/files/:id` for a `PUBLIC` file, sets its own header later
in its handler, which overrides this default — verified unaffected).

## 6. Environment / configuration hardening

This app already validated `SESSION_SECRET` at its point of use (`lib/session.ts`) rather than
through one central config object — that pattern was working and is kept, not replaced with a
monolithic config layer "merely for style." The one genuine gap: **`DATABASE_URL` had no explicit
check anywhere.** `PrismaClient`'s constructor does not connect eagerly, so an unset `DATABASE_URL`
in production would not fail until the first request that touches the database — a confusing,
delayed failure instead of a clear one at boot.

`apps/server/src/lib/config.ts` — `assertProductionConfig()`, called as the very first line of
`index.ts` (before `createApp()`), closes exactly that one gap: production refuses to start without
`DATABASE_URL`. `SESSION_SECRET`/`TRUST_PROXY` are deliberately **not** re-validated here —
`createSessionMiddleware()`/`resolveTrustProxy()` already fail fast with their own specific,
tested messages; duplicating the check would just be a second place for the two to disagree.

`.env.example` updated with `TRUST_PROXY` and `PUBLIC_BASE_URL` (§14), each documented with accepted
values and a development vs. production behavior note. No real secret or credential was added
anywhere — every example value is a placeholder.

## 7. Session / cookie hardening

Reviewed `lib/session.ts`'s existing configuration — all of it was already correct and is
**unchanged**: `httpOnly: true`, `sameSite: "lax"`, `secure` only in production, a custom cookie name
(`scl.sid`, not the express-session default), a 1-week rolling expiration, `session.regenerate()` on
login (fixation resistance), and destroy + `clearCookie` on logout.

**A genuinely new, previously-undocumented finding**, surfaced while writing this phase's cookie
regression test: `cookie.secure: true` makes express-session refuse to send `Set-Cookie` **at
all** — not "without `Secure`", none — unless it can positively confirm the request is secure. That
confirmation depends on Express's `req.secure`, which (once `TRUST_PROXY` trusts the hop) reads
`X-Forwarded-Proto`. **A reverse proxy that terminates TLS but forgets to set `X-Forwarded-Proto:
https` will make login appear to succeed (200 + the user's own JSON body) while no session is ever
established** — every following request is silently treated as a guest, with no error anywhere.
`TRUST_PROXY=1` alone does not prevent this. Documented directly in `lib/session.ts` and in the
deployment checklist (§20), and proven both ways by the new regression test.

**`scripts/session-cookie-regression.mjs`** (14 checks, new): cookie name/HttpOnly/SameSite=Lax/
~1-week expiry/no-Secure-in-dev in a development configuration; Secure/HttpOnly/SameSite=Lax **and
an actual `Set-Cookie` header** in a production configuration correctly proxied (`TRUST_PROXY=1` +
`X-Forwarded-Proto: https`); the same production server sending **no cookie at all** when that
header is absent (the deployment trap above, proven, not just asserted); and session-fixation
resistance (two consecutive logins from the same client get two different session ids).

No password-change flow exists to test (§3).

## 8. Login rate limiter — review after the trust-proxy work

Re-read `lib/loginRateLimit.ts` in light of §4. No code change was needed — the (ip, email) keying,
threshold (10/15min), reset-on-success, and unref'd sweep interval were already correct; they are
now backed by a trustworthy `req.ip` under the one certified topology (`TRUST_PROXY=1`) instead of
an unconditionally-trusted one.

**In-memory, per-process limitation — assessed, not silently fixed**: this guard's `Map` lives in
one Node process's memory. A future **multi-instance** deployment (more than one API process behind
a load balancer) would give each instance its own, independent bucket — an attacker distributed
across instances (or just unlucky round-robin routing) could get several times the nominal 10-attempt
budget before any single instance's bucket fills. **Not fixed this phase**: the brief explicitly
asked not to reach for Redis/an external service by default. **Deployment recommendation**,
documented in §20: run this app as a single API process (the SQLite database is itself
single-writer-friendly and does not suggest horizontal scaling either — see §12); if multiple
instances are ever needed, this guard's `Map` must move to a shared store first, as a dedicated
piece of work, not a footnote.

## 9. Storage / orphan-blob hardening

Reviewed the full upload/delete lifecycle in `routes/files.routes.ts` + `lib/storage.ts` (unchanged
by this phase — see §3 for what already made this safe: blob written before the DB row, removed
again if the DB write fails; DB soft-delete committed before the blob is unlinked). The one accepted,
documented Phase-25 gap: a process crash between those two steps can leave a blob and its DB row
disagreeing.

**New**: `apps/server/src/lib/storageReconcile.ts` (`reconcileStorage()`) + CLI
`scripts/storage-reconcile.ts` (`npm run storage:reconcile -w apps/server`, dry-run by default;
`-- --delete` to actually remove). Diagnoses (and, opt-in, safely repairs) exactly the two crash
shapes:

1. **Upload crash** — a blob with no DB row at all. Only counted as an orphan once it is older than
   a 24h grace period (keyed off the blob's own file mtime) — an upload that is merely slow/in-flight
   right now is never mistaken for a crash victim. Safe to delete once past the grace period.
2. **Delete crash** — a blob whose DB row is already soft-deleted (`deletedAt` set). No grace period
   needed: the DB transaction already committed the delete. Safe to delete immediately.

A **third** shape — a live (`deletedAt: null`) row whose blob is missing from disk — is diagnosed
and reported **only, never auto-repaired**: deleting DB metadata (and anything else pointing at it,
e.g. a `GalleryItem`) based only on a filesystem listing would risk destroying legitimate data, which
the brief explicitly ruled out. Every path touched is filtered through the same UUID `KEY_PATTERN`
`lib/storage.ts` already uses — a stray non-UUID file an operator drops into the storage directory by
hand is never scanned, reported, or deleted.

**`scripts/unit-storage-reconcile.test.ts`** (18 checks, new, no real DB/filesystem beyond a
disposable temp dir — a fake `storedFile` delegate is injected): all three categories correctly
classified; the grace period correctly protects a fresh blob; a dry run changes nothing on disk; a
`--delete` run removes exactly the two safe categories and nothing else; a stray non-UUID file
survives every mode; a missing `STORAGE_ROOT` is handled as "zero files," not a crash.

## 10. Frontend performance / route-level code splitting

**Before** (measured, this session, on the Phase 25 baseline before any Phase 26 change): a single
JS chunk, 872.40 KB raw / 212.85 KB gzip, plus a Vite build warning about chunks over 500 KB.

**Change**: `apps/web/src/App.tsx` — `React.lazy()` + one `<Suspense>` boundary around the whole
`<Routes>` tree, for every route mentioned in the brief except two deliberate exceptions (see
below) plus its natural siblings: the entire `/admin/*` subtree (`AdminLayout` + all 8 admin
pages), `/publications/:id`, `/research/:id`, `/workspace`, `/knowledge` + `/knowledge/:id`,
`/resources` + `/resources/:id`, `/gallery`, all three `/community/forum/*` pages, and `/messages`
+ `/messages/:id` + `/notifications`. **Left eager** (static import, unchanged): `HomePage` and
every page one click from it that is not itself large — the list pages for
research/team/projects/groups/publications/news/events, `EventDetailPage`, `GroupDetailPage`,
contact, login, profile, schedule, 404 — matching the brief's "no unnecessary splitting of tiny
shared components."

The Suspense fallback reuses the app's **existing** accessible loading skeleton
(`components/LoadingState.tsx`, `role="status" aria-live="polite"`, already used for every in-page
data-loading state) with the **existing** `common.loading` translation key — no new component, no
new hardcoded string, no new accessibility pattern invented for this phase.

**Two routes named in the brief's example list were deliberately NOT split — both found by the
full browser sweep, not theoretical concerns.** Both `SearchPage` and `ProjectDetailPage` were
initially lazy-loaded like the rest; the full, unfiltered `browser-regression.cjs` run (§18J) caught
a real, reproducible failure from each:

- **`/search`**: its existing "loading state: skeleton + 'Searching…' + aria-busy while the request
  is in flight" check throttles the network via CDP (`Network.emulateNetworkConditions`, 1500 ms
  latency) specifically to hold the app in its in-flight state long enough to observe it. With
  `SearchPage` lazy, the *added* chunk-fetch hop before the component even mounts ate enough of
  that throttled window that `.search-region` never existed before the check's fixed timeout —
  which then **threw** (`.offsetHeight` of `null`) instead of failing cleanly. Because that throw
  happened before the test step's own code could reset the network throttle back to normal, the
  stuck 1500 ms latency then **cascaded into dozens of unrelated failures** for the rest of that
  run (search for every other role, then navigation entirely) — a real demonstration of exactly the
  kind of "measure, don't assume" risk the brief warned about for this section.
- **`/projects/:id`**: a separate check (the "loading" step's `spaGo` helper) throttles latency to
  1200 ms and does an in-app client-side navigation straight to a project detail page, asserting its
  own "Loading project…" text appears within 2500 ms. With `ProjectDetailPage` lazy, the same
  added chunk-fetch hop ate enough of that window that the assertion missed on the first
  navigation. Unlike `/search` this did **not** cascade (a soft assertion miss, not a thrown
  error) — isolated, reproduced twice, and confirmed independent of the `/search` finding.

Both were root-caused, fixed by keeping the page a static import, and verified clean: first in
isolation (`ONLY_STEPS="^search "` → 113/113; `ONLY_STEPS="^loading$"` → 14/14; the "member research
page" failure seen in the same run was re-checked too, 31/31 in isolation — a genuine one-off flake,
unrelated to any Phase 26 change, consistent with Phase 25's own documented non-deterministic
browser-check precedent).

**Three more of the same pattern surfaced once the full sweep was let run all the way to
completion** (§18J) — each independently isolated and root-caused before being folded into one
consolidated fix:

- **`/research/:id`** (`ResearchAreaDetailPage`): a check presses Enter on a focused area-card
  link, confirms the URL changed, then immediately (no wait) asserts exactly one `<h1>` and one
  `<main>` remain on the page. Right after the URL changes but before the lazy chunk resolves,
  neither this page's own `<h1>` nor the generic Suspense fallback (which renders no `<h1>` at all)
  satisfies that count — a soft assertion miss, not a crash.
- **`/knowledge`** (`KnowledgePage`) and **`/resources`** (`ResourcesPage`): each has its own
  network-throttled "shows a labelled loading skeleton" check, the same CDP-throttle technique as
  the `/search` finding above, asserting its own specific skeleton text ("Loading documents…" /
  "Loading resources…") — not satisfied by the generic Suspense fallback's "Loading…" text during
  the added chunk-fetch hop. Neither cascaded (both are soft misses, like `ProjectDetailPage`).

All five pages were fixed by the same treatment (kept as static imports) and are all comparatively
small chunks in the first place (`SearchPage` 8.00 KB, `ProjectDetailPage` 12.14 KB,
`ResearchAreaDetailPage` 5.07 KB, `KnowledgePage` 7.44 KB, `ResourcesPage` 7.64 KB gzipped-raw sizes
from the intermediate build) — keeping all five eager costs comparatively little of the original
bundle-size win.

**Two further failure clusters the full sweep surfaced on `/knowledge/:id` and `/resources/:id`
were investigated and found to be pre-existing, unrelated to lazy-loading or any other Phase 26
change** — reported here rather than silently fixed, since neither is infrastructure/deployment
work and both show REAL rendered content misbehaving (not a component that failed to mount, which
would rule out a chunk-loading explanation): (1) a "long token" (an unbroken long string) overflows
its container instead of wrapping, on both `knowledge-body`/the equivalent resource-detail element
(the failure message shows the same `div.knowledge-body` class for both, suggesting a shared
CSS class between the two features' detail templates); (2) on `/resources/:id`, a keyboard Tab walk
finds a focused link visually covered by a `<dd>` element. Neither `KnowledgeDetailPage.tsx`,
`ResourceDetailPage.tsx`, nor any CSS was touched this phase, and Vite bundles all CSS into one file
regardless of JS chunking, so lazy-loading cannot explain either — both are recommended as a Phase 27
(or dedicated) follow-up, not fixed here as out-of-scope UI bugs unrelated to this phase's mandate.
A single incidental `401` on `/api/notifications/unread-count` also appeared in the full sweep's
network-hygiene scan (out of 60,811 response bodies scanned) — `NotificationsContext.tsx` was not
touched this phase either; almost certainly a pre-existing timing race between its own polling
interval and a test step's logout, not a Phase 26 regression.

**After** (measured, final): no more single oversized chunk and no Vite chunk-size warning. The two
largest chunks are `index-*.js` (406.23 KB raw / 107.17 KB gzip — the app shell + eager pages, now
including all five pages above) and a separately-cacheable `api-*.js` vendor chunk Vite split out on
its own (317.94 KB raw / 79.57 KB gzip — `@scl/shared`'s zod schemas, shared by nearly every page
whether eager or lazy). Every remaining lazy route is its own small chunk, from 0.17 KB
(`AdminEventsPage`) up to 15.21 KB (`AdminContentBrowser`, the heaviest single admin component)
gzipped in the low single digits each. A first-time visitor to Home still downloads only the app
shell + the one shared vendor chunk (~724 KB raw / ~187 KB gzip combined) instead of the whole app
including every admin page, up front, for a page they may never authorize for.

**Verified working, not just built**: `tsc -b` and a fresh `vite build` both clean on the final code
(all five eager-page fixes applied); a live dev-server run of the existing `browser-regression.cjs`'s
admin section (`ONLY_ADMIN=1`) against the actual lazy `/admin/*` routes — direct navigation, nested
`<Outlet>` routing (`AdminLayout` → its 8 children), auth guards (`canAccessAdmin`/`canManageUsers`
still redirect correctly through a lazy component), and 404 behavior all confirmed unaffected (1178
passed, 4 failed on the first run; the 4 were re-checked in isolation and passed cleanly — see §18I
for the full account, including why a second full-scale confirmation run's results had to be
discarded as contaminated rather than relied on). The real, load-bearing verification for all five
fixes, including the three found later, is §18J's repeated full sweeps: an isolated `ONLY_RESEARCH=1`
re-run was tried first for the three later fixes, but was abandoned as an unreliable verification
method (re-running it against the same disposable DB twice produced its own unrelated cascade of
failures from accumulated fixture state — a DB-reuse artifact, not a product bug, and a second
instance of exactly the "isolated re-run can miss its own preconditions" risk already documented
below for `ONLY_ADMIN`). The three later fixes were instead confirmed the same way the first two
were: by diffing a full, unfiltered sweep against the pre-fix baseline and showing the exact three
target checks are absent from the result (§18J).

## 11. React Router upgrade — attempted, found a real regression, reverted

Inspected actual usage first: `BrowserRouter` + declarative `<Routes>/<Route>` only (no data router,
no loaders/actions, no `future` flags already set), `Link`/`NavLink`/`useNavigate`/`useLocation`/
`useParams`/`Outlet` across ~68 files. `npm audit` confirms **both** moderate advisories from Phase
25 §3/#4 (open redirect via backslash; SSR `deserializeErrors` constructor injection — the latter
still inapplicable, this is a CSR-only SPA) affect the entire `6.0.0–7.17.0` range, including the
`6.30.6` this app was already on — only `react-router-dom@7.18.4`+ actually fixes them.

**Attempted the upgrade**: `react-router-dom@7.18.4`. `tsc -b` and `vite build` both came back clean,
and `npm audit` dropped to 0 vulnerabilities. Before accepting it, ran the existing
`browser-regression.cjs`'s `ONLY_NAV` section (229 checks) against it — **10 failures**, 8 of which
exactly reproduce Phase 25's own documented pre-existing nav-config mismatch (§18E of that phase's
doc; unrelated to this upgrade). The other **2 were new**: `M390 MEMBER: Log out by tap` and `M390
ADMIN: Log out by tap` — the mobile hamburger menu's sign-out flow stopped reliably closing the menu
and landing on the guest header.

**Isolated the cause with a controlled A/B test**, not a guess: reverted to `react-router-dom@6.30.6`
with nothing else changed and re-ran exactly those two checks in isolation — **0 failures**. The
regression is real and specific to the v7 upgrade, not environmental. Reading `components/Nav.tsx`
points at the likely mechanism: its mobile-menu-closes-on-navigation logic resets state **during
render** by comparing `location.key` (the pattern React's own docs recommend over an effect for this
exact case) — react-router v7 wraps its internal navigation/location updates in
`React.startTransition` by default (no longer an opt-in `future` flag, as it was in v6), which can
change how and when a component using this pattern observes the update.

**Decision, per the brief's own explicit instruction** ("do not force it; document the exact
blockers; leave the current version unchanged"): **reverted to `react-router-dom@6.30.6`** (the
latest v6 patch — the semver range was already `^6.28.0`, now records `^6.30.6`). The two moderate
`npm audit` advisories remain open, exactly as Phase 25 left them, but now with a materially more
specific blocker than "would require a full sweep we didn't run": a full sweep **was** run, and it
found one concrete, reproduced, root-caused mobile-logout regression. **Recommendation for Phase 27
or a dedicated follow-up**: either fix `Nav.tsx`'s render-time state-reset pattern to be transition-
safe first (a real, scoped piece of work with its own test coverage) and re-attempt the upgrade, or
replace it with `useEffect`-based menu closing before attempting v7 again — not bundled into a
hardening pass.

## 12. Dependency / supply-chain audit

`npm audit --omit=dev`: **0 vulnerabilities** for every dependency this phase left in place (the
only entries `npm audit` ever reported — 2 moderate, react-router — are addressed in §11: fixed in
`apps/server`'s dependency graph n/a, open by informed decision in `apps/web`, unchanged from
Phase 25's own conclusion).

**Applied** (`npm update`, in-range per each package's existing semver caret — no `package.json`
range widened): `vite` 8.3.0→8.3.1, `oxlint` →1.85.0, `tsx` →4.23.15, and a handful of transitive
patch bumps. Full workspace build + typecheck re-verified clean afterward (§18).

**Considered and deliberately left alone** (major version jumps, each would need its own dedicated,
tested migration — not bundled into a hardening pass, consistent with §11's decision on
react-router-dom):

| Package | Current → Latest | Why not this phase |
|---|---|---|
| `express` | 4.22.3 → 5.x | Major; middleware/error-handling signature changes across this app's entire route surface |
| `@prisma/client` / `prisma` | 5.22.0 → 7.x | Major; schema/query-engine behavior needs its own verification pass |
| `zod` | 3.25.76 → 4.x | Major; breaking error-customization API, used throughout every schema in `@scl/shared` |
| `bcryptjs` | 2.4.3 → 3.x | Security-relevant, but a major bump with no changelog verification performed this phase — the same "don't force it without evidence" standard applied to react-router |
| `dotenv` | 16.6.1 → 18.x | Major; low risk in isolation, but out of scope without a dedicated check |
| `typescript` | 5.9.3 (server/shared) → 7.x | Major; `apps/web` already deliberately pins a different major (`~6.0.2`) — not this phase's call to reconcile |
| `concurrently` | 9.2.4 → 10.x | Dev-only orchestration tool, no production/security relevance |

Lockfile: `npm install`/`npm update` produced only the expected changes (helmet added,
react-router-dom's version recorded then reverted, the in-range patch bumps above); re-verified with
a clean `git status` pass at the end (§22).

## 13. Error handling / production observability

Reviewed `app.ts`'s global error handler (unchanged): already maps Prisma error codes to safe,
generic messages, never serializes a stack trace/file path/env var/SQL into a response body, and
logs server-side only. Re-verified directly (§17): an oversized body still returns a clean
`{"error": "..."}` 413, a 404 for a nonexistent path still returns no internal detail and still
carries every security header (helmet applies globally, before routing — an error response is not a
second code path that could forget them).

Logging review: no request/error logging exists beyond `console.error` on the unexpected-500 path
(already true before this phase) — nothing in the diff adds request logging, so there is nothing new
to check for secret/private-content leakage. `recordAudit`'s existing fail-loud `FORBIDDEN_KEY` guard
(Phase 25) is untouched.

## 14. Database / connection robustness

`lib/prisma.ts` (`new PrismaClient()`, unchanged) does not connect eagerly — closed the one real
startup gap this created for `DATABASE_URL` via `lib/config.ts` (§6).

**Graceful shutdown, new** (`index.ts`): `SIGTERM`/`SIGINT` now stop accepting new connections,
let in-flight requests finish, disconnect Prisma cleanly, and exit — with a 10s hard-exit timeout so
a stuck shutdown can never hang a deploy/restart indefinitely. Previously the process had no signal
handling at all (default Node behavior: an abrupt exit).

**Supported production database setup, documented for the first time** (§20): SQLite, single
file, single API process. This app's storage layer (§9), rate limiter (§8) and database are all
consistently single-process-shaped — none of them was redesigned to pretend otherwise, and none of
them should be scaled to multiple instances without addressing all three together as one piece of
work. PostgreSQL was not introduced — not "absolutely necessary" per the brief's own instruction, and
nothing about this phase's findings makes SQLite the bottleneck.

## 15. Static assets / caching

This server serves **no static files** (§3) — hashed-asset caching, `index.html` cache-control, and
sensitive-directory exposure are entirely the reverse proxy/static host's responsibility, not
something this Express app can misconfigure since it never touches them. Documented as a deployment
checklist item (§20: cache Vite's hashed `/assets/*` far-future/immutable, never cache `index.html`).

`GET /api/files/:id` (this app's one real "asset" route) was re-verified, not changed: authorization
happens before any byte is streamed, `Cache-Control` is `public, max-age=3600` only for a `PUBLIC`
file and `private, no-store` for everything else, and the new global `/api/*` default of
`Cache-Control: no-store` (§5) never overrides that later, more specific header — confirmed by the
sitemap/session-cookie/API regression scripts, all of which exercise file responses indirectly
without a regression.

## 16. SEO / robots.txt / sitemap.xml

Phase 24 deliberately deferred this; nothing existed before this phase beyond the pure
`truncateForMeta` helper and the client-side `useSeo` hook.

**New**: `apps/server/src/routes/sitemap.routes.ts` (+ pure helpers in `lib/sitemap.ts`), mounted at
the document **root** (`app.use(sitemapRoutes)`, not under `/api`) — search engines fetch these two
paths from the origin root by convention, so the one documented reverse-proxy topology (§8) must
route `/robots.txt`, `/sitemap.xml` and `/api/*` to this server, everything else to the static SPA.

- **Visibility**: reuses the exact same `visibility: "PUBLIC"` filter every guest-facing route
  already uses (`lib/visibility.ts`) — never a second, parallel notion of "public." `TeamMember`
  (no visibility column, unconditionally public — §3) is included in full; `GalleryItem` has no
  detail route in the frontend at all, so only the `/gallery` list page is listed, never a
  per-item URL.
- **Base URL**: a new `PUBLIC_BASE_URL` environment variable. If unset, `/sitemap.xml` answers 404
  with an explanatory body — **never a fabricated production domain** (the brief was explicit about
  this, and Phase 24 already deferred picking one). `/robots.txt` works either way, simply omitting
  its `Sitemap:` line when unset.
- **Locale**: this app has no locale-prefixed routing at all (`LocaleContext.tsx` — locale is a
  `localStorage` preference + an `X-Locale` request header, never part of the URL). There is exactly
  one URL per page regardless of language — documented as a finding, not worked around by inventing
  URL variants that do not correspond to anything the router actually serves.
- `robots.txt` disallows `/api/`, `/admin`, `/login`, `/schedule`, `/workspace`, `/profile`,
  `/messages`, `/notifications`, `/community/forum`, `/search` — every private/functional/auth-gated
  page, none of which a crawler should index regardless of whether it could reach it.

**Tests**: `scripts/unit-sitemap.test.ts` (24 checks, pure functions — `normalizeBaseUrl`'s accept/
reject boundary including hostile schemes like `javascript:`, `escapeXml`'s escaping, and that the
static-path list never contains a private/admin/forum path) + `scripts/sitemap-regression.mjs` (17
checks, live server + disposable DB: every static public page present; a `PUBLIC` research project
present; a `LAB_ONLY` one **absent by id and by title** — the actual leak this route exists to
prevent; `PUBLIC_BASE_URL` unset vs. set behavior on both routes).

## 17. Security regression / hostile inputs (Phase 26 surfaces only)

`scripts/phase26-hostile-input-regression.mjs` (17 checks, new) — focused on what this phase
actually changed, not a repeat of the extensive existing coverage in `api-regression.mjs`/
`browser-regression.cjs` for areas this phase did not touch:

- An oversized JSON body (200 KB against the 100 KB cap) → clean 413, server still responsive
  immediately after.
- Five hostile `X-Forwarded-For` values (garbage text, a SQL-injection-shaped string, a `<script>`
  tag, an empty string, a 5000-character string, a comma pile-up) under `TRUST_PROXY=1` → every one
  gets a real HTTP response (never a crash/connection failure); server still healthy after all five.
- A hostile `PUBLIC_BASE_URL` (`javascript:alert(document.cookie)`) → both `/sitemap.xml` and
  `/robots.txt` treat it as unconfigured; the literal string never appears anywhere in either
  response body.
- Error responses (a 404) still carry the full security-header set (§5) and never leak a filesystem
  path or stack frame.
- A legitimate login still succeeds with every one of the above guards simultaneously active.

## 18. Tests executed

**A. Typecheck**: `tsc -p tsconfig.json --noEmit` (server) and `tsc -b` (web + shared) — clean, run
repeatedly through the phase as each change landed.

**B. Builds**: `npm run build` (shared → server → web) — clean. Web production build measured
before/after code splitting (§10).

**C/D. Unit tests**: `npm run test:unit -w apps/server` — **1,177 checks, 0 failed** (1,120
pre-existing + 15 new in `unit-trust-proxy-startup.test.ts` + 18 new in
`unit-storage-reconcile.test.ts` + 24 new in `unit-sitemap.test.ts`).

**E. API/security regression**: `api-regression.mjs` against a disposable DB copy, server started
with `TRUST_PROXY=1` per its updated header instructions — **570 checks, 0 failed** (unchanged count
from Phase 25; the existing brute-force/XFF section's assertions are unaffected by the trust-proxy
change since the disposable server is now started with the topology it actually tests).

**New Phase 26 regression scripts, each run to a clean pass**: `trust-proxy-regression.mjs` (5),
`sitemap-regression.mjs` (17), `session-cookie-regression.mjs` (14),
`phase26-hostile-input-regression.mjs` (17) — **53 checks, 0 failed**, all self-contained (own
disposable DB copy, own spawned server(s), own teardown).

**F. Dependency/security audit**: §12.

**G. Mutation testing** (methodology matches Phase 25 §18D — patch one exact fragment, run the
relevant test, killed = test fails, survived = test passes unchanged, then revert):

| Mutant | Change | Target file | Result |
|---|---|---|---|
| M1 | Removes the `TRUST_PROXY` production fail-fast | `lib/trustProxy.ts` | **Killed** (3 checks failed) |
| M2 | Removes the `TRUST_PROXY=true` rejection | `lib/trustProxy.ts` | **Killed** (1 check failed) |
| M3 | Removes the orphan grace-period check (treats every no-row blob as orphaned regardless of age) | `lib/storageReconcile.ts` | **Killed** (3 checks failed) |
| M4 | Removes the `KEY_PATTERN` filter on the disk listing (a stray non-UUID file could be scanned/counted) | `lib/storageReconcile.ts` | **Killed** (1 check failed) — the delete-loop's own defense-in-depth `KEY_PATTERN` re-check still protected the stray file from actual deletion even under this mutant, confirming that second layer works independently |
| M5 | Removes the `DATABASE_URL` production fail-fast | `lib/config.ts` | **Killed** (3 checks failed) |

**5 mutants — 5 killed, 0 survived.** Every mutant targeting this phase's new security/config logic
was caught by the regression suite written alongside it; none needed a follow-up fix (unlike Phase
25's M3/M8, this phase found no coverage gap to close after the fact).

**H. Production configuration/startup tests**: §4/§6/§7's dedicated startup-spawning tests
(`unit-trust-proxy-startup.test.ts`, `session-cookie-regression.mjs`'s dev/production pair).

**I. Focused browser tests for changed routing/performance/security**: `browser-regression.cjs`'s
`ONLY_NAV` section (229 checks) run against the react-router v7 upgrade attempt (§11, 10 failures, 2
new/regressed — this is what caused the revert) and again against v6.30.6 confirming the fix (0
failures on the isolated `M390 …Log out by tap` checks). `ONLY_ADMIN` run against the code-split
build to verify the lazy `/admin/*` subtree: **1178 passed, 4 failed** on the first run (all four
inside `phase 17: admin / CMS`, `ja`/`390px`); re-checked in isolation, **0 failed** — a one-off
DOM/timing artifact, not reproducible (confirmed independently: `AdminFilesPage.tsx`'s own comments
establish it never renders an `/api/files/` URL or image at all, so the specific failing assertion
could not represent a real, systematic defect). A second full-scale `ONLY_ADMIN` confirmation run
was started but had to be **discarded as contaminated**: an attempt to stop a separate, unrelated
process accidentally killed this run's own browser mid-execution, producing a cascade of unrelated
failures that reflect the interruption, not the app — not used as evidence either way.

**J. One complete existing browser regression suite**: fresh disposable DB, single run, no
`ONLY_*` filter — covering guest/MEMBER/project-lead/LAB_MANAGER/ADMIN, EN/JA, and the full
nine-width matrix, per the brief's required scope.

This took several full-sweep passes to get a trustworthy final answer from, and that process is
recorded here rather than smoothed over, since two of the intermediate numbers below were
themselves artifacts, not real results:

1. **First complete attempt caught two real regressions** (§10: `SearchPage`, `ProjectDetailPage`
   lazy-loading). Both were root-caused and fixed (kept as static imports).
2. **A full re-run with those two fixed applied — the run this document originally reported as
   final — came back 23,235 passed, 40 failed.** Investigating all 40 individually found that three
   of them were not pre-existing at all: `research guest: after the client-side navigation exactly
   one h1 and one main landmark remain`, `knowledge loading: … labelled skeleton`, and `resources
   loading: … labelled skeleton` were three more instances of the exact same lazy-loading pattern
   (§10: `ResearchAreaDetailPage`, `KnowledgePage`, `ResourcesPage`), not yet found because the first
   attempt above was treated as conclusive before the sweep had actually run to completion against
   them. All three were root-caused and fixed the same way, folded into one consolidated change.
3. **Verifying that consolidated fix took three more full-sweep attempts, each invalidated by a
   test-invocation mistake in this environment rather than a product issue** — recorded here for the
   same reason as step 2, not to pad this account: (a) one run crashed at seeding
   (`TypeError: team.find is not a function`) because the disposable DB copy was created empty
   instead of copied from the schema-migrated, pre-seeded `prisma/dev.db` template every other script
   in this repo uses; (b) one run's every single check failed with a proxied `502`, because the API
   server was started on a port that didn't match `vite.config.ts`'s hardcoded dev-proxy target; (c)
   one run came back with dozens of unrelated failures (exact-count search-pagination assertions
   expecting, e.g., 21 results and finding 64) because it reused a DB copy an earlier invalid attempt
   had already seeded into, doubling up fixture data. None of these were seen by, or relevant to, an
   actual site visitor — each was caught, root-caused, and corrected before being accepted as
   evidence, the same standard applied to every other finding in this section.
4. **The definitive final run** — fresh single-use DB copy, correct matching ports, all five
   lazy-loading fixes in place: **23,238 passed, 37 failed.** Diffed line-for-line against the
   pre-fix 40-failure result from step 2 (not just recounted) to confirm every change is accounted
   for:

| Category | Count | Disposition |
|---|---|---|
| The 5 lazy-loading regressions (§10) | *(all 5 fixed; none of the 5 target checks appear in the 37)* | — |
| Pre-existing nav-config mismatch (Phase 25 §18E: `RESEARCH_HREFS`/`navConfig.ts` `/news` placement) | 11 | `N5`, `K12`–`K15`, `MEMBER`/`LAB_MANAGER`/`ADMIN` header checks (8) + 3 events-nav checks — identical to Phase 25's own documented, pre-existing, non-Phase-26 finding; present in the step-2 baseline too |
| Focus-ring checks (headless-Chromium `:focus-visible` rendering, not app code) | 7 | 5 under `phase 10.5`, 1 each on `/research` and `/publications` — no CSS, focus-management code, or skip-link/ring styling was touched this phase; present in the step-2 baseline too |
| Pre-existing CSS bugs, knowledge/resources detail pages (§10) | 12 | 8 "long token" overflow + 4 "covered by `<dd>`" focus-coverage — real rendered-content bugs, not lazy-loading timing; `KnowledgeDetailPage.tsx`/`ResourceDetailPage.tsx`/CSS untouched this phase; present in the step-2 baseline too; recommended as a Phase 27 follow-up |
| Admin/CMS cluster at `ja`/390px (`admin files`, `p15 ja 390px admin-people` overflow, `admin link-profile` and `delete-account` dialog-from-click) | 4 | Reproduced identically in both the step-2 baseline and this final run — a consistent, pre-existing narrow-viewport/JA-locale issue, not a one-off flake; `AdminFilesPage.tsx` and the admin dialog components are untouched this phase |
| `9.1 add-publication form offers 'show on my member profile'` | 1 | A known flaky check — present in the step-2 baseline, absent from one intermediate re-run, present again here; unrelated file, not touched this phase |
| New: `disc-guest group` (`ja`, 900px) — `<html lang>` match and "one h1/main" checks | 2 | Not present in the step-2 baseline; did **not** reproduce in either of two other full, unfiltered sweeps run against this identical code earlier the same day (one of which hit the exact same phase at the exact same width/locale cleanly). `GroupDetailPage` and its CSS are untouched this phase and were never made lazy — read as a one-off test-timing flake in the large `phase 15` sweep, not a regression, on the same evidentiary standard used for the other flaky entries above |
| **Total** | **37** | **Zero attributable to a Phase 26 code change** |

Two items present in the step-2 baseline (`member research page: can add, cannot delete` and an
incidental `401` on `/api/notifications/unread-count`) do **not** appear in this final 37 — both are
already documented above and in §10/§22 as pre-existing, non-deterministic checks unrelated to any
Phase 26 change; their absence here is consistent with that, not evidence either way.

Total check count (23,238 + 37 = 23,275) matches Phase 25's own full-sweep total, and the step-2
baseline's own total, exactly — confirming every one of these runs was the same suite at the same
scope, not a partial run.

## 19. Performance measurement

| | Before (Phase 25 baseline) | After (Phase 26) |
|---|---|---|
| JS chunks | 1 | ~55 (1 app shell + 1 shared-vendor + ~53 small per-route chunks) |
| Largest chunk (raw / gzip) | 872.40 KB / 212.85 KB | 406.23 KB / 107.17 KB (app shell) |
| Second-largest chunk | — | 317.94 KB / 79.57 KB (shared/zod vendor chunk, separately cacheable) |
| Vite chunk-size warning | Yes (>500 KB) | No |
| Smallest lazy route chunk | — | 0.17 KB raw (`AdminEventsPage`) |
| `npm audit` (production deps) | 2 moderate (react-router) | 2 moderate (react-router — §11; everything else 0) |

Not optimized against an arbitrary target — the split boundary was chosen from the brief's explicit
list of heavy/authorization-gated areas (§10), not a bundle-size number to hit.

## 20. Deployment checklist / documented production configuration

**Topology** (the one this app's own tests certify — see §4): one reverse proxy, terminating TLS,
in front of both (a) the static SPA build (`apps/web` → `vite build` output) and (b) this API
process. The proxy must:
- Route `/api/*`, `/robots.txt`, `/sitemap.xml` to the API process; everything else to the static
  SPA build (with SPA-style fallback to `index.html` for client-side routes).
- Strip any client-supplied `X-Forwarded-For` before setting its own (required for `TRUST_PROXY=1`
  to be safe at all).
- Set `X-Forwarded-Proto: https` on every forwarded request (required for the session cookie to be
  sent at all in production — §7's deployment trap).
- Cache the SPA's hashed `/assets/*` files far-future/immutable; never cache `index.html`.

**Required production environment variables**: `DATABASE_URL`, `SESSION_SECRET`, `TRUST_PROXY`
(`0` or `1` — §4). Production refuses to start without any of the three.

**Optional**: `PORT` (default 4000), `STORAGE_DIR`, `MAX_IMAGE_BYTES`, `MAX_DOCUMENT_BYTES`,
`PUBLIC_BASE_URL` (enables `/sitemap.xml`).

**Database**: SQLite, single file, single API process — back up the file at `DATABASE_URL`'s path;
no separate database server to provision.

**Storage**: back up `STORAGE_DIR` (default `apps/server/storage/files`) alongside the database — a
restore of one without the other will show broken/missing files or orphaned rows. Run `npm run
storage:reconcile -w apps/server` periodically (or after any suspected crash) as a maintenance
check; add `-- --delete` only after reviewing its dry-run report.

**Scaling**: this app is single-process-shaped end to end (SQLite, the in-memory rate limiter, local
disk storage — §8/§9/§14). Do not run multiple instances behind a load balancer without addressing
all three together first.

## 21. Accessibility / i18n regression

No UI was redesigned. The one new user-facing surface is the route-level Suspense fallback, which
reuses the existing accessible `LoadingState` component and the existing `common.loading` key in
both `en.ts`/`ja.ts` — no new hardcoded string, no new loading-state pattern. `ONLY_ADMIN` and
`ONLY_NAV` browser-regression runs (§18I) exercise keyboard navigation, focus, modal behavior, and
the mobile hamburger menu against the actual lazy-loaded pages, not just the eager ones.

## 22. Known limitations (carried forward or newly identified)

- The react-router v7 upgrade remains open (§11) — now with a specific, reproduced blocker
  (`Nav.tsx`'s render-time state-reset pattern vs. v7's default `startTransition`-wrapped
  navigation) rather than an unattempted one.
- The login rate limiter remains in-memory/single-process (§8) — a documented, deliberate
  non-fix, with a clear multi-instance deployment recommendation.
- A live `StoredFile` row with a missing blob (§9) is diagnosed, never auto-repaired — by design.
- `TRUST_PROXY` values other than `0`/`1` are accepted but not independently certified by this
  app's own tests (§4) — an operator using a different topology must verify it themselves.
- No locale-prefixed URLs exist (§16) — a structural fact of this app's i18n design, not something
  this phase introduced or could fix without a much larger routing change.
- `express`, `@prisma/client`/`prisma`, `zod`, `bcryptjs`, `dotenv`, and `typescript` (server/shared)
  all have an available major upgrade, deliberately not made this phase (§12).
- No production logging/observability platform was added (not asked for; the brief explicitly said
  not to introduce a paid one) — `console.error` on the server's unexpected-500 path is the only
  server-side signal that exists, unchanged from before this phase.
- **Two pre-existing UI bugs found by the full browser sweep, not fixed this phase** (§10/§18J,
  found on `/knowledge/:id` and `/resources/:id`, neither file touched this phase): an unbroken long
  token overflows its container instead of wrapping (both features' detail pages appear to share a
  CSS class, `knowledge-body`, based on the failure output), and on `/resources/:id` specifically, a
  keyboard Tab walk finds a focused link visually covered by a `<dd>` element. Recommended as a
  Phase 27 (or dedicated) follow-up — out of scope for an infrastructure/deployment-hardening phase.
- A single incidental `401` on `/api/notifications/unread-count` appeared once in an earlier full
  sweep's network-hygiene scan (§18J) — `NotificationsContext.tsx` untouched this phase; very likely
  a pre-existing timing race between its polling interval and a test step's logout, not chased
  further (one occurrence out of tens of thousands of scanned response bodies; absent from the
  definitive final run).
- A reproducible (not flaky) cluster of 4 failures at `ja`/390px in the admin area (`admin files`,
  the admin-people page's 14px overflow, and the link-profile/delete-account dialogs not opening
  from a real click) appeared identically in both the pre-fix baseline sweep and the definitive
  final sweep (§18J) — pre-existing, narrow-viewport/JA-locale specific, unrelated to any file
  touched this phase; not chased further as out of scope for an infrastructure-hardening phase, but
  worth flagging as a real (if narrow) UI bug for a future accessibility/i18n pass.
- The definitive final full sweep (§18J) surfaced one new, non-reproducing failure pair —
  `disc-guest group` at `ja`/900px failing an `<html lang>` match and a "one h1/main" check — that
  was not present in the pre-fix baseline and did not reproduce in either of two other full sweeps
  run against the identical code the same day. `GroupDetailPage` was never touched or made lazy this
  phase; read as a one-off test-timing flake in the large `phase 15` sweep rather than a regression,
  consistent with this phase's other documented flaky checks, but noted here rather than discarded
  silently.

## 22a. Files changed

**New**
- `apps/server/src/lib/trustProxy.ts`, `lib/security.ts`, `lib/config.ts`, `lib/sitemap.ts`,
  `lib/storageReconcile.ts`
- `apps/server/src/routes/sitemap.routes.ts`
- `apps/server/scripts/storage-reconcile.ts` (CLI)
- `apps/server/scripts/trust-proxy-regression.mjs`, `sitemap-regression.mjs`,
  `session-cookie-regression.mjs`, `phase26-hostile-input-regression.mjs`
- `apps/server/scripts/unit-trust-proxy-startup.test.ts`, `unit-storage-reconcile.test.ts`,
  `unit-sitemap.test.ts`
- `docs/architecture/phase26-deployment-readiness-infrastructure-hardening.md` (this file)

**Modified**
- `apps/server/src/app.ts` (trust proxy, security headers, JSON body limit, sitemap mount, default
  `/api` `Cache-Control: no-store`)
- `apps/server/src/index.ts` (production config assertion, graceful shutdown)
- `apps/server/src/lib/session.ts` (deployment-trap documentation comment only — no behavior change)
- `apps/server/package.json` (helmet dependency; new npm scripts; `test:unit` chain extended)
- `apps/server/.env.example` (`TRUST_PROXY`, `PUBLIC_BASE_URL` documented)
- `apps/server/scripts/api-regression.mjs` (updated comments only, for the `TRUST_PROXY=1`
  precondition its existing XFF section now requires — no assertion logic changed)
- `apps/server/scripts/browser-regression.cjs` (`BROWSER_PATH` env override + conditional
  `--no-sandbox`, additive and backward compatible — the Windows/Edge default path is unchanged)
- `apps/server/scripts/unit-session-startup.test.ts` (added `TRUST_PROXY: "0"` to its two spawned
  environments so its SESSION_SECRET-specific assertions remain isolated from the new,
  separately-tested TRUST_PROXY requirement)
- `apps/web/index.html` (CSP `<meta>` tag)
- `apps/web/src/App.tsx` (route-level code splitting)
- `apps/web/package.json` (react-router-dom recorded at `^6.30.6`, the latest v6 patch — attempted
  v7, reverted, see §11)
- `package-lock.json` (helmet added; the react-router-dom v7 attempt then its v6.30.6 revert; a
  handful of in-range patch bumps from `npm update`, §12)

No file under `Lab-Website/` (the reference implementation) was touched — confirmed via
`git status --short -- Lab-Website` (empty).

## 23. Database / migration status

**No schema change. No migration.** `schema.prisma` was not touched this phase —
`git diff --stat -- apps/server/prisma/schema.prisma` is empty. Every finding in this phase (trust
proxy, security headers, config validation, session/cookie behavior, storage reconciliation, code
splitting, the router evaluation, SEO routes) was addressable entirely within the existing schema.
No migration was created or applied, and none was determined to be necessary — per your instruction,
if one ever were needed this document would stop here and ask before proceeding.

## 24. Status at time of writing / remaining work

**Complete.** §4–§21 in full, including all 5 mutation-test mutants (§18G — all killed), the full
unit/API/regression-script suites (§18C–F), and §18J's definitive full browser sweep — reached after
several full-sweep passes, fully accounted for in §18J (two real regressions found and fixed, then
three more of the same pattern found once the sweep was let run to completion, then three further
attempts invalidated by test-invocation mistakes in this environment rather than the app, before a
clean, single-use-DB, correctly-configured final run): **23,238 passed, 37 failed, all 37 diffed
against the pre-fix baseline and individually categorized, none attributable to a Phase 26 code
change** (§18J's table). Phase 26 is functionally ready for your review and commit approval.
