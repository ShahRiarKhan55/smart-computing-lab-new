# Phase 27 — Lab website integrations and profile improvements

Status: implemented on branch `feat/phase-27-lab-website-integrations`; **not merged, not deployed, no production
migration run.** This document is the design record, the configuration reference and the honest list of what is and is
not verified.

## 0. Read this before deploying

1. **The database migration must be applied to the production (Turso) database BEFORE this code serves traffic.**
   `apps/server/prisma/migrations/20261008090552_phase27_integrations/` adds four columns to `TeamMember`
   (`scholarUrl`, `researchGateUrl`, `orcid`, `isPublished`) and four tables (`OAuthIdentity`, `PublicationCandidate`,
   `PublicationCandidateResearcher`, `SyncState`). Prisma selects every column of a model it reads, so the new code
   reading `TeamMember` against an un-migrated database cannot work.
   **Compatibility verdict: full backward compatibility with the old schema is not practical** (TeamMember is read in
   ~50 places, many through relations; making each query column-explicit would be a large, risky rewrite of unrelated
   code, and the new features themselves need the new tables). Instead:
   - A **deploy-order guard** (`lib/schemaGuard.ts`, mounted on `/api` and `/sitemap.xml`) probes for the Phase 27
     columns/tables. If (and only if) SQLite reports "no such column/table", every API route answers a clean, secret-free
     **503 `DB_SCHEMA_BEHIND`** (and logs one actionable line); `/api/health` keeps answering. It never writes. Any other
     probe failure is treated as "unknown" and requests proceed exactly as before (fail-open). Tested against a real
     pre-Phase-27 database file (`scripts/schema-compat-regression.mjs`).
   - **Rollback is safe**: the unmodified `origin/master` code runs against the migrated schema (master's
     `api-regression` passed 570/570 on it), because the migration only adds.
   - **Vercel Preview shares the production database**, so a Preview of this branch answers `DB_SCHEMA_BEHIND` until the
     migration is applied. The only ways to get a *working* Preview are (a) an explicitly approved production migration, or
     (b) an isolated Preview database (a separate Turso database + Preview-scoped `TURSO_*` variables, migrated there).
     Both are configuration/production decisions outside this PR; nothing here changes environment variables.
   - `vercel.json`'s build command does **not** run migrations; nothing applies this migration automatically.
2. The migration is additive only (proved by `schema-compat-regression.mjs`: applied with `prisma migrate deploy` to a
   copy of the pre-Phase-27 database, every existing table has identical row content, no foreign-key violation, the four
   new tables start empty, new TeamMember columns take their defaults, and the SQL contains no DROP/RENAME/DELETE/UPDATE/
   table rebuild). It was also reviewed by hand: the `TeamMember` changes are plain
   `ALTER TABLE … ADD COLUMN` statements (not Prisma's default "RedefineTables" copy/drop/rename, which is unsafe on
   Turso because `PRAGMA foreign_keys=OFF` has no effect inside a transaction and the drop would cascade-delete child
   rows). It was applied only to a disposable local SQLite file; `prisma migrate diff` against the schema shows no drift.
3. Everything external (Google OAuth client, ORCID credentials, Google Site URL, Blob store) is **optional and
   unconfigured**: with none of the new environment variables set the site behaves as before, and each feature hides
   itself rather than failing.

## 1. Audit summary (Stage A)

- Repo: npm-workspaces monorepo — `apps/web` (React 19 + Vite), `apps/server` (Express 4 + Prisma 5.22), `packages/shared`
  (Zod schemas, permissions, i18n). Baseline `master` = `f758afc`; baseline build and tests were green before changes.
- Production topology: Vercel (static SPA + one serverless function `api/index.ts`), Turso (libSQL) through the Prisma
  adapter, Vercel Blob for uploads. Sessions: `express-session` + a Prisma store, cookie `scl.sid`, `SameSite=Lax`.
- Existing protections that were preserved untouched: login rate limiter, invitation flow and its rate limiter,
  `SameSite=Lax` as the CSRF defence (no CSRF-token middleware exists), session regeneration on login, role/permission
  policy in `packages/shared/src/permissions.ts`, upload size/type limits, authorization-aware file streaming.

### Gallery upload "Internal Server Error" (P27.10)

- **Reproduced locally** (not on Preview — see "Verification status"): with `VERCEL` set and no `BLOB_READ_WRITE_TOKEN`
  the storage layer tried to `mkdir` on Vercel's read-only filesystem, and a Blob store that refuses the write threw from
  inside `@vercel/blob`; both surfaced as an unclassified exception → HTTP 500 "Internal server error".
- **What cannot be determined from here:** which of those two causes (Blob not attached / token missing, vs. Blob refusing
  the write) happens in production. That needs the Vercel function logs or the new diagnostic endpoint below.
- **Fix:** storage reports its configuration explicitly; backend failures become `StorageUnavailableError` with a
  sanitized `detail` (never the provider's message) and a stable `code` (`STORAGE_NOT_CONFIGURED`, `STORAGE_UNAVAILABLE`);
  the error handler answers a structured **503** `{ error, code }` and logs `[storage] CODE: detail` (no secrets);
  `ensureRoot()` no longer caches a rejected `mkdir` forever; upload limits are capped below Vercel's 4.5 MB request
  wall (4 MB when `VERCEL` is set) so oversize files get a clear 413 instead of a platform error; the gallery modal shows
  a specific, localized message instead of "Internal server error". Failed uploads leave no `StoredFile` row and no
  object (rows are written only after the object is stored; the existing cleanup is covered by the regression test).
- **Operator diagnostic:** `GET /api/files/storage-status` (ADMIN only) reports backend, configured/not, limits;
  `?probe=1` writes and deletes a tiny test object to prove the backend accepts writes. Neither prints a secret.
- **Regression test:** `scripts/gallery-upload-regression.mjs` (fails against the old code) + `unit-storage.test.ts`.

## 2. P27.1 — Google Sites as the public portal

- **Architecture:** the Google Site is a separate public front door that **links to** this application. The application
  is **not embedded** in the Site. Verified facts behind that decision:
  (a) the Express API sends `X-Frame-Options: SAMEORIGIN` (helmet default, verified by inspecting a live response; `apps/server/src/lib/security.ts`
  still carries an older comment that says DENY), so API responses cannot be framed by another origin; the static SPA shell is served by Vercel and `vercel.json` sets no framing header, so the *public pages* could
  technically be framed — but nothing here restricts *who* may frame them (no `frame-ancestors`), which is a clickjacking
  exposure we did **not** widen or "fix" in this phase;
  (b) the session cookie is `SameSite=Lax` (and browsers increasingly block third-party cookies), so inside a cross-site
  iframe on `sites.google.com` a visitor could not stay signed in: login, the admin area and every editing action would fail.
  Google's help documents that an external page can be embedded in a Site only if that page permits framing. Embedding the
  login or admin UI is therefore **not supported and not recommended**; link out instead. If the lab later wants a read-only
  embedded view of public pages, that is a separate decision that must also add an explicit `frame-ancestors` allow-list
  for the Google Sites origin.
- **Configuration:** `PORTAL_URL` (https only, no credentials; invalid values are ignored). `GET /api/site-config`
  returns `{ portalUrl }` and nothing else; the footer shows "Lab portal (Google Sites)" only when it is set. No portal
  or app URL is invented; the Google Site itself is created and edited by the lab in Google Sites (nothing in this repo
  can create it).
- **Authorization is independent of the portal:** every admin/editor API route re-checks the session and role
  server-side. The portal is just a hyperlink; it carries no trust.
- **What the portal owner does:** in Google Sites, add a link/button to the application's public origin
  (`PUBLIC_BASE_URL`), and (optionally) link to `/publications`, `/team`, `/alumni`. Do not paste credentials into Sites.

## 3. P27.2 — Homepage updates

- Provider-neutral model (`packages/shared/src/schemas/updates.ts`, `apps/server/src/lib/updates/index.ts`):
  `UpdateProvider { id, kind: "manual"|"external", isConfigured(), list() }`. `GET /api/updates?limit=` merges every
  configured provider newest-first, applies the viewer's visibility inside the provider, and tells each item's
  source. One failing provider never hides the others.
- Today's only active source is `manual` (the lab's own news items, entered by hand). The home page shows each item
  with "Posted by the lab" and an honest empty state ("No news yet.") when there are none.
- **Facebook: not connected, nothing fabricated.** There is no official Page URL or API credential in this project, so
  there is no link, no embed, no scraping, no sample posts. `facebookProvider` is a stub that is never configured and
  is reported as `not_configured`.
  *What a real integration would need (verified against Meta's Pages API documentation, Oct 2026 — re-check before
  building):* an official Facebook Page the lab controls; a Meta developer app; a Page access token obtained by a person
  with the CREATE_CONTENT/MANAGE/MODERATE tasks on that Page via Facebook Login with `pages_read_engagement` (advanced
  access needs App Review); Business Verification may be required; reading a Page the lab does **not** manage requires the
  "Page Public Content Access" feature (App Review + business verification). Tokens must be stored as server secrets and
  never reach the browser. Until the lab supplies the Page and approves that work, the provider stays disabled.

## 4. P27.3 / P27.8 / P27.6 — Profiles, alumni, photos

- Optional **Google Scholar / ResearchGate / ORCID** fields on `TeamMember` (`scholarUrl`, `researchGateUrl`, `orcid`).
  Validation is in `packages/shared/src/profileLinks.ts` and applied identically on the server and in the forms: Scholar
  must be a `scholar.google.*` https URL, ResearchGate a `researchgate.net` https URL, ORCID a valid iD (ISO 7064
  mod 11-2 checksum; an `orcid.org` link is accepted and stored as the bare iD). Rendered as accessible text links with
  icons under the name, **hidden when empty**, `target="_blank" rel="noopener noreferrer"`; ORCID also feeds JSON-LD `sameAs`.
- **Alumni directory** (`/alumni`): a new member category `ALUMNI`. Alumni have **no login accounts**: the server refuses
  to create a user, link a user, or issue an invitation for an alumni profile (`lib/alumni.ts`). Managers can
  add/edit/unpublish/remove; `isPublished` hides the profile page, its uploaded photo and the profile from the team/alumni lists, search
  and the sitemap (it is not a public field). **It does not remove the person's name from explicit relations** (project/group
  members, publication authors, research-area researchers) or free text: filtering those lists is a deliberate non-goal of this
  PR because the member/author editors replace the whole link set, so a filtered list could silently delete hidden links. The team page lists current members only.
- **Profile photo upload** from the computer: JPEG/PNG/WEBP only, validated by magic bytes (the client's MIME and file
  name are ignored), 2 MB default (`MAX_PROFILE_PHOTO_BYTES`, capped at 4 MB on Vercel), header-read dimension limits
  (6000 px / 24 MP — no image decoding library was added). Stored through the existing storage abstraction as a
  `StoredFile` and served by `/api/files/:id` with the existing authorization; the old photo is retired only **after**
  the new one is stored and the profile updated, so a failed upload never loses the current photo or leaves an orphan.
  Allowed by the owner or a manager. Exercised by `profiles-regression.mjs` and `unit-profile-media.test.ts`.
  *Known limit:* uploads are buffered in memory (multer) because of the small size cap; there is no EXIF stripping or
  re-encoding, so uploaded photos keep their metadata.

## 5. P27.4 — Google sign-in

- OpenID Connect authorization-code flow with **PKCE (S256)**; `state`, `nonce` and the code verifier live **server-side in
  the session**, are single-use and expire after 10 minutes. Endpoints were taken from Google's live discovery document.
  The ID token's RS256 signature is verified against Google's JWKS with `node:crypto` (no new dependency), plus
  `iss`, `aud`/`azp`, `exp`, `iat`, `nbf`, `nonce`, `sub`, and **`email_verified === true`**.
- **Admin policy:** an ADMIN session can be obtained through Google only for the verified identity
  `susmartcomputinglab@gmail.com` (constant in `lib/googleAuth.ts`). Policy, implemented in `resolveGoogleSignIn`:
  an existing identity is found by Google `sub` (never by email alone); that address can create the ADMIN account on
  first sign-in; an existing **password** account with that email is **never taken over** by an unverified or
  unlinked sign-in (the admin must be signed in with the password and link Google explicitly from the profile page);
  any other Google account without a previous link is denied; nothing is auto-linked by email.
- The session is **regenerated** on success; all failures redirect to `/login?error=…` with a generic code (no oracle
  about which check failed), failed callbacks are rate-limited, and tokens/codes/secrets are never logged.
- **Missing configuration is harmless:** unless `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
  `GOOGLE_OAUTH_REDIRECT_URI` are all set (redirect URI https in production and ending `/api/auth/google/callback`),
  `GET /api/auth/google/config` reports `{ enabled: false }` and the login page shows only the password form.
- **Invitations are unchanged:** invited researchers still accept by password; Google sign-in is an additional way in
  for already-linked accounts and for the designated admin only.
- **Setup (the operator does this in Google Cloud Console; never paste secrets into chat or commit them):**
  1. Create an OAuth consent screen and an OAuth client of type "Web application".
  2. Add authorized redirect URIs — one per environment: `http://localhost:<port>/api/auth/google/callback` (local),
     the Preview URL's `/api/auth/google/callback` if wanted, and the production origin's.
  3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` as Vercel environment variables (per
     environment). 4. Sign in once as the designated Google account.
- **Test hook:** `GOOGLE_OAUTH_BASE_URL` redirects the provider endpoints to a mock, and is honored **only when
  `NODE_ENV !== "production"`**.

## 6. P27.5 — Publication discovery

- **Sources chosen:** ORCID Public API (a researcher's public works) and Crossref (DOI metadata/authors). Google Scholar
  and ResearchGate were **not** integrated: neither offers an official public API, and scraping them is unreliable and
  against their terms. Their profile links (section 4) are the supported integration.
- **Flow:** a manager runs "Check ORCID now" (or `POST /api/publication-imports/sync`). For each current researcher with
  an ORCID iD (alumni skipped unless selected explicitly) the importer fetches the public works, normalizes them and
  stores **review candidates** — it never creates or edits a `Publication`. A manager approves (optionally correcting
  title/authors/venue/year, choosing visibility and author links) or rejects. Only an approval creates the public
  publication; every step is audited (`PUBLICATION_SYNC_RUN`, `PUBLICATION_IMPORT_APPROVED/REJECTED`).
- **Dedupe:** by normalized DOI (lower-cased bare DOI; `(provider, externalId)` is unique and equals `doi:<key>` when a
  DOI exists, so two co-authors' ORCID records collapse into one candidate linked to both). A candidate whose DOI
  already belongs to a stored publication is stored as `DUPLICATE` and never queued. Works without a DOI get an
  `orcid:<iD>:<put-code>` id and an exact title+year "possible duplicate" hint (the editor decides). Approval re-checks
  the DOI inside the transaction (a record entered by hand meanwhile makes it a duplicate).
- **Idempotent:** re-running only bumps `lastSeenAt`; it never rewrites an editor-touched candidate, never re-queues an
  approved/rejected one, and a later manual correction of a publication is never overwritten. One run at a time
  (`SyncState` lock taken with a conditional UPDATE, 10-minute expiry).
- **Limits / etiquette:** researchers are fetched sequentially with `PUBLICATION_SYNC_DELAY_MS` (1 s) between them;
  requests have a 10 s timeout, at most 2 retries (transient/429/5xx only), a 4 MB response cap, a fixed host allow-list
  (`pub.orcid.org`, `orcid.org`, `api.crossref.org`), `redirect: error`, and URLs built only from validated identifiers.
  Crossref lookups are capped per run and use the "polite pool" (`mailto`). A time budget
  (`PUBLICATION_SYNC_BUDGET_MS`) stops a run before a serverless timeout; the remainder is reported as `skipped`.
  A failing researcher is reported and the others continue.
- **Important caveats:** ORCID's documentation says a `/read-public` access token is required for the Public API and
  its terms limit use to non-commercial purposes; at the time of writing unauthenticated reads still work, so
  credentials are optional — but configure `ORCID_CLIENT_ID/SECRET` for a durable setup. The importer only sees what
  researchers have made public on their own ORCID record; **it cannot promise completeness**. ORCID work summaries carry
  no author list: authors are filled from Crossref when there is a DOI, otherwise the editor types them.
  Everything was tested against a mock; the live services were only inspected read-only during development.
- **"Fill from DOI"** in the publication form calls `GET /api/publication-imports/lookup?doi=` (any signed-in user;
  per-user limit of 30 per 10 minutes; 10-minute cache) and only pre-fills the form. Manual entry is unchanged.

## 7. P27.7 — DOI normalization

`packages/shared/src/doi.ts`: a bare DOI, `doi:` label, or any `doi.org`/`dx.doi.org` link (any case, doubled prefixes)
is accepted; the stored value is the canonical `https://doi.org/<doi>` in the existing `doiUrl` field (API shape
unchanged). Comparison uses a lower-cased key; the original case is preserved for display. Non-DOI URLs are rejected.
Applied by the server schema and the form (which now shows the bare DOI).

## 8. P27.9 — Copyright and academic-use notice

A short notice in the footer and a full page at `/copyright` (EN and JA via the existing dictionaries; also in the
sitemap). The wording is the supplied draft; it does **not** claim blanket ownership, says third-party material stays with
its rights holders, and adds that an academic purpose is not by itself permission to reuse copyrighted material. The
previous footer text "All rights reserved" was removed because it contradicted this. This is website wording, not a
legal opinion; the lab or its university should review it.

## 9. Security review (summary — see the PR for the checklist)

- Authz: review/sync/approve/reject = manager/admin (`canReviewPublicationImports`); DOI lookup = signed-in; photo
  upload/delete = owner or manager; storage diagnostics = ADMIN; alumni cannot gain accounts (three entry points guarded).
  All enforced server-side; the UI only hides controls.
- OAuth: PKCE, single-use server-side state/nonce, strict ID-token verification, no email auto-linking, session
  regeneration, generic failures, rate limiting, redirect URI validated, mock override disabled in production.
- SSRF: importer hosts are a fixed allow-list; identifiers are validated and percent-encoded before reaching a URL.
- Uploads: magic-byte validation, size/dimension caps, generic stored file name, no path from client input.
- Public API: `isPublished` and candidate data are never exposed publicly; unapproved candidates are not in any public
  list; the publication API shape is unchanged.
- Secrets: none committed; `.env.example` holds placeholders only; tokens/secrets are never logged or audited
  (the audit helper refuses keys matching secret-like names).
- Limitations: rate limiters are in-memory per serverless instance (same documented limitation as the login limiter);
  the in-memory token cache for ORCID is per instance.

## 10. Verification status (honest)

| Area | Automated (mock) | Local run | Real external / Preview |
|---|---|---|---|
| Gallery upload fix | yes (38 + 10 checks) | reproduced + fixed | **Not verified on Preview** (no authorized access) |
| Google OAuth | yes (mock Google: 82 + 70 checks) | — | **Not verified with real Google** (no client configured) |
| ORCID/Crossref importer | yes (mock: 71 + 29 checks) | — | **Not verified against live services** |
| Profile links / alumni / photo | yes | yes | not on Preview |
| Portal link / updates / notice | yes | yes | not on Preview |
| Production migration | — | disposable local DB only | **Not applied** |

## 11. Documented-but-not-done (needs the owner)

- Create the Google Cloud OAuth client and set the three Google variables per environment.
- Confirm that `susmartcomputinglab@gmail.com` is the intended administrator Google account.
- Attach a (private-capable) Vercel Blob store to the project, or confirm one is attached; use the storage diagnostic.
- Provide the Google Site URL (`PORTAL_URL`), build the Site, and link it to the application.
- Researchers add their ORCID iDs / profile links; optionally register ORCID API credentials.
- Provide an official Facebook Page (and approve the Meta app work) before any Facebook integration.
- Separately approve and perform the production migration, in the right order relative to the deploy.

## 12. Isolated Preview and real-integration verification (runbook — NOT performed)

**Status: nothing in this section has been executed.** Real Google sign-in, a live Blob upload, live ORCID/Crossref reads and
a Preview of this branch were not tested, because they need accounts, credentials or infrastructure that were not provided
for this work. Everything verified so far used local disposable SQLite files and mock providers.

### What is known about the Preview database target — and what is not
- The documentation and the earlier report say Preview deployments share the production Turso database. **This could not be
  verified from the development session**: it has no Vercel or Turso dashboard access. Treat any Preview of this branch as
  pointing at production until the steps below prove otherwise.
- The development session's own environment contains `TURSO_DATABASE_URL` (a `libsql://` URL) and `TURSO_AUTH_TOKEN`
  variables. They were **never used**: every test script clears them (`env -u …` / empty values; `unit-turso-env-isolation`
  asserts it), the guard and migration tests use `file:` URLs with a dummy token, and no command was run against them. Whether
  they are production credentials is unknown; they should be scoped out of development sessions.

### How to confirm the Preview target (no production change)
In Vercel → Project → Settings → Environment Variables, look at `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`BLOB_READ_WRITE_TOKEN`, `SESSION_SECRET`: for each, which environments (Production / Preview / Development) is it ticked for,
and is there a *separate* Preview-only value? If one value is ticked for both Production and Preview, Preview = production.

### Creating an isolated Preview (needs the owner's Turso + Vercel accounts)
1. **Build a local, data-free database file** (nothing production is involved): `DATABASE_URL=file:/tmp/preview.db npx prisma migrate deploy`
   in `apps/server`, then seed only the admin/sample rows if wanted (`npm run seed -w apps/server` with the same `DATABASE_URL`).
2. **Create a separate Turso database from that file**, e.g. `turso db create scl-preview --from-file /tmp/preview.db`, and a token
   for it (`turso db tokens create scl-preview`). (`prisma migrate deploy` cannot talk to Turso's HTTP endpoint, which is why the file
   route is used; production's own migration is a separate, explicitly approved one-off.)
3. **In Vercel, add Preview-scoped values only** (leave every Production value untouched): `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`
   (the Preview DB), a *different* `SESSION_SECRET`, `TRUST_PROXY=1`, a Blob store attached to the Preview environment
   (`BLOB_READ_WRITE_TOKEN`), and — for the sign-in test — a test Google OAuth client whose authorized redirect URI is the
   Preview alias `https://<project>-git-feat-phase-27-lab-website-integrations-<team>.vercel.app/api/auth/google/callback`
   (use the stable branch alias, not the per-deployment URL) with `GOOGLE_CLIENT_ID/SECRET/OAUTH_REDIRECT_URI`.
   Optional: `ORCID_CLIENT_ID/SECRET`, `PUBLICATION_SYNC_CONTACT_EMAIL`, `PORTAL_URL`.
4. **Prove the target**: after the Preview deploys, `GET /api/health` is 200, `GET /api/team` returns the Preview DB's (seed) data and
   *not* the lab's real roster, and an admin `GET /api/files/storage-status?probe=1` reports the Blob backend. Only then is the Preview
   isolated.
5. **Then verify, in this order** (record results, never paste cookies/tokens): password login → designated Google admin sign-in
   (the designated address is a hard-coded policy, so this needs that real Google account; a second, non-designated test account
   should be *denied*) → "Connect Google" from a signed-in member → profile photo upload and removal → gallery upload (expect a
   clear 503 code if Blob is misconfigured) → add ORCID iDs to two *test* profiles → "Check ORCID now" → review/approve one item →
   confirm it is public and a re-run does not duplicate it → `/alumni`, `/copyright`, footer portal link.

### What remains unverified until then
Real Google OAuth (consent screen, redirect URI registration, real ID-token claims), a live Vercel Blob write/read (including the
`access: "private"` behaviour), live ORCID/Crossref responses and rate limits, the libSQL adapter against a **remote** Turso
(only its local-file mode was exercised), and the behaviour of any Vercel Preview.
