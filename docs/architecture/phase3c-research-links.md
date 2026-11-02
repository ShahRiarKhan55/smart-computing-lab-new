# Phase 3C: research profile links (Google Scholar, ResearchGate, ORCID)

Members and alumni can add up to three optional links to their research profiles. They are shown on the member profile page, on the
current-member team cards and on the published alumni cards. Nothing is fetched from those services: no scraping, no API, no OAuth,
no synchronisation, no keys. A link is only a validated URL that a person typed.

## Data
`TeamMember` gains three columns, each `TEXT NOT NULL DEFAULT ''` (`""` = none, the same convention as `photoUrl`):
`googleScholarUrl`, `researchGateUrl`, `orcidUrl`. Migration `20261027120000_team_member_research_links`
(SHA-256 `61e1bfbe7b159897cdb08c024b515fc8e74e94e978948dc2a4aae92e0cb69a44`, pinned in `REVIEWED_MIGRATIONS`): three `ALTER TABLE ... ADD COLUMN`
statements, metadata-only in SQLite, existing rows untouched and reading `''`. It is NOT applied anywhere by this change; applying it to a
hosted database is a separate, explicitly authorised, operator-run step (`phase3-release-runbook.md`). Code that is deployed before the
migration is applied would fail on the missing columns, so the order for a release is: migrate first (additive, safe for the old code), then deploy.

## Validation (`packages/shared/src/schemas/researchLinks.ts`)
One strict validator per service, used by the admin create/edit schemas and the own-profile schema, and re-run by the server on every write.
Each returns the canonical URL, which is what is stored. Empty (or blank) means no link. Input is hand-parsed with anchored patterns (not
`new URL()`): `http://` and `https://` are both accepted (scheme case-insensitive) and always normalised to `https://`; no other scheme, no credentials, no port, no backslashes
or whitespace, ASCII hostnames only, no trailing-dot host. The identifier is carried over unchanged (never altered into another profile); anything unexpected is refused, not repaired.

| Service | Accepted hosts (exact) | Accepted path | Canonical form |
|---|---|---|---|
| Google Scholar | `scholar.google.<tld>` for each of Google's published country domains (73 evidence-verified hostnames, `GOOGLE_SCHOLAR_HOSTS`; see below) | `/citations` with exactly one `user=<12 chars [A-Za-z0-9_-]>`; other params limited to `hl`, `view_op`, `oi`, `sciund`, `authuser` and dropped | `https://scholar.google.<tld>/citations?user=<id>` |
| ResearchGate | `researchgate.net`, `www.researchgate.net` | `/profile/<slug>`, slug `[A-Za-z0-9][A-Za-z0-9_.-]{1,99}`, optional trailing `/` | `https://www.researchgate.net/profile/<slug>` |
| ORCID | `orcid.org`, `www.orcid.org`, or a bare iD | `/<iD>`; the iD is `NNNN-NNNN-NNNN-NNN[N|X]` and its ISO 7064 MOD 11-2 check character must be right | `https://orcid.org/<iD>` |

### Google Scholar hostname evidence
Google's list of country domains (`https://www.google.com/supported_domains`, 187 entries, fetched 2026-10-27) names domains of Google **Search**; it does not show that Scholar
is served on each, so it was used only as the candidate set. Verification method (run 2026-10-27, from the development environment, public DNS only, no page was fetched
or scraped): for each candidate the name `scholar.google.<tld>` was resolved; a host is kept only if it is a CNAME to Google's own Scholar service name `scholar.l.google.com`.
Resolution was repeated twice per name with identical results, and the same resolver returned addresses for ordinary Google hosts such as `www.google.com.bd`, so a missing
Scholar name is a real absence and not a resolver fault.

* **Kept (73):** com, ae, com.ar, at, com.au, be, bg, com.bo, com.br, ca, ch, cl, com.co, co.cr, com.cu, cz, de, dk, com.do, com.ec, com.eg, es, fi, fr, gr, com.gt, com.hk, hn, hr, hu, co.id,
  co.il, co.in, is, it, co.jp, co.kr, li, lt, lu, lv, com.ly, com.mx, com.my, com.ni, nl, no, co.nz, com.pa, com.pe, com.ph, com.pk, pl, com.pr, pt, com.py, ro, ru, se, com.sg, si, sk, com.sv, co.th,
  com.tr, com.tw, com.ua, co.uk, com.uy, co.ve, com.vn, co.za, cat.
* **Excluded (114):** every other candidate (for example `scholar.google.ad`, `.com.bd`, `.al`, `.cn`); the name does not exist in DNS, so it is not accepted.
* **Limits of the evidence:** DNS shows the name is operated by Google for Scholar; it does not show that every profile page works on that host. A genuine link on an excluded country
  domain is refused with the usual message and can be pasted as its `scholar.google.com` form (same `user` id). If Google adds a domain, re-run the check and add it to `GOOGLE_SCHOLAR_TLDS`.
* Matching stays exact (a `Set` of full hostnames): no wildcard, suffix or substring rule.

Query strings and fragments are accepted on input only where harmless and are always dropped (tracking parameters never reach the database or a link). Refused outright:
`javascript:`, `data:`, `file:`, `ftp:` and every other non-http(s) scheme, scheme-relative URLs, credentials, ports, look-alike or unlisted hosts, other services' URLs (each validator
accepts only its own service), over-long input and non-strings.

Messages are fixed English strings (`RESEARCH_LINK_MESSAGES`) mapped to translation keys in `apps/web/src/i18n/errorMessages.ts` (EN and JA).

## API and privacy
* `POST /api/team`, `PUT /api/team/:id` and `PUT /api/profile` accept the three fields. On an update a link is written only if the request names it
  (same rule as `photoUrl`), so an ordinary edit can never put back a stale value. The audit trail records which fields changed, never the URLs.
* Authorisation is unchanged: the same actors may edit the same profiles as before.
* Output goes through the same visibility filters as the rest of the profile (`publishedMemberWhere` / `isMemberVisible`). An unpublished alumnus is
  not returned to anyone but an administrator, so neither is their link. `safeResearchLinks` additionally re-checks every stored value on read and
  returns `""` for anything that is not exactly the canonical URL of its service.

## UI
`components/ResearchLinks.tsx` renders nothing when no link is set, otherwise a list of circular 44 x 44 px links (`.research-link`): `target="_blank"`,
`rel="noopener noreferrer"`, accessible name "<person> on <service> (opens in a new tab)" (EN/JA), a `title`, the global `:focus-visible` ring, text contrast
of about 10:1. The own-profile page and the admin modal have a "Research profiles" fieldset with a label, hint and inline error per field; typed values are
kept on an error, and on an edit a link is sent only if the form changed it.

### Icons
**Update:** the links now show each service's own mark instead of the neutral text marks (`GS`, `RG`, `iD`) used when this phase shipped: `apps/web/src/components/BrandIcons.tsx` holds the three single-colour logos as inline SVG (paths from Simple Icons v13.21.0, whose files are CC0-1.0; no icon package was added), painted in the brand colours by `.research-link--<service>` in `styles/components.css` (Google Scholar `#4285F4`, ResearchGate `#00CCBB`, ORCID `#A6CE39`). The SVGs are decorative (`aria-hidden`, not focusable); the link keeps its `aria-label` and `title`.

**Brand-use caveat (unchanged from the original decision):** the marks remain trademarks of Google LLC, ResearchGate GmbH and ORCID, Inc. ORCID's brand guidelines limit the iD icon and logos to ORCID members and service providers and require unaltered use; no licence for the Google Scholar or ResearchGate marks was obtained or could be verified. The logos were adopted at the site owner's request, so confirm that this use is acceptable to you. `ResearchLinks.tsx` and `BrandIcons.tsx` are the only places to change if it is not.

## Tests
`unit-research-links.test.ts` (validators, http/https normalisation, host evidence and schemas, 351 checks), `research-links-regression.ts` (HTTP: create/edit/self-edit, authorisation, publication,
corrupted-value read defence, 60 checks), `research-links-ui.mjs` (Chromium: forms, links, cards, EN/JA, keyboard, size, brand logos, alumni, 39 checks), and the migration
checks in `unit-turso-migrate.test.ts`.

## Limitations
* Syntax and check-digit validation only: a link is not checked to exist, nor to belong to the person.
* The Google Scholar host list reflects DNS on 2026-10-27 and must be re-verified if Google adds a country domain.
* A person can paste someone else's valid profile URL; the same is true of every free-text link on the site.
