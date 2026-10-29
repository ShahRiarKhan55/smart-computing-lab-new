# Duplicate warnings for curated content

Prevents the same real-world thing being entered twice (a team profile, a publication, a news item, a research area) without ever
treating a name or title match as proof. **Application-level only: no database constraint and no migration** (see "Why not a
constraint"). Code: `packages/shared/src/duplicates.ts` (pure normalisers and matchers), `apps/server/src/lib/duplicates.ts` (the
transaction-scoped guard), wired into the create/update routes listed below. Tests: `apps/server/scripts/unit-duplicates.test.ts` and
`apps/server/scripts/duplicate-prevention-regression.ts` (`npm run test:unit` / `npm run test:duplicates`, both in CI).

## Behaviour

A create or an edit that resembles an existing record answers **409** with a machine-readable body:

```json
{ "error": "<fixed English message>", "code": "DUPLICATE_CANDIDATE", "kind": "team-name",
  "overridable": true, "canOverride": true,
  "candidates": [{ "id": "…", "label": "…", "detail": "…" }] }
```

`canOverride` is true only for a **lab manager or admin** (`canOverrideDuplicate` in `packages/shared/src/permissions.ts`). They repeat the
same request with `"confirmDuplicate": true` to record the item anyway; the override is written into that action's audit row
(`duplicateOverride: "<kind>"`). A member who sends the flag is answered with the same 409 (it is ignored). The message never repeats the
name or title; the matching records travel in `candidates`, limited to what the requester may already see.

| Entity | What counts as a match | Overridable | Routes |
|---|---|---|---|
| Team profile name | Same name after normalisation, word order and honorifics ignored (`Wang Weiquan` = `Weiquan Wang`, `Assistant Prof. X` = `X`) | yes | `POST/PUT /api/team`, `PUT /api/profile`, `POST /api/users` (new-profile mode), `POST /api/invitations` (new-profile mode), invitation acceptance |
| Publication | Same **canonical DOI** (any URL form) | **no** (a DOI names one work) | `POST/PUT /api/publications` |
| Publication | Same normalised title **and** year when either side has no DOI | yes | same |
| News | Same normalised title on the same display date, or the same sort date | yes | `POST/PUT /api/news` |
| Research area | Same normalised title, word order ignored (`&` = `and`) | yes | `POST/PUT /api/research` |

**Legitimate repeats stay possible.** A preprint, a conference paper and its journal extension have different DOIs and are never flagged
against each other, even with the same title and year. The same title in another year is allowed. A recurring announcement on a different
date is allowed. Two people can share a name (a manager confirms). The research-area **tag is not a duplicate signal**: it is a shared
category label, and every rule tried (same tag plus a large word overlap, plus a one-word difference) flagged distinct areas that this
repository's own regression fixtures create (`ZZ Test hidden area` / `ZZ Test P9 area hidden`). The tag is shown beside each candidate.

**Edits.** The record being edited is always excluded. An edit is compared only if it changes a compared field (name; title/year/DOI;
title/dates; title) **to a different normalised value**, so an already-duplicated record can still be edited for anything else and
re-saved unchanged. `confirmDuplicate` alone is still "Nothing to update."

**Invisible profiles are not compared.** Team names are compared against the profiles the requester may see (`publishedMemberWhere`):
only an administrator sees unpublished/alumni profiles, and answering 409 for one would let anyone probe for it by typing names (the app
answers 404, never 403, for exactly that reason). An administrator is warned about those too.

**Invitations.** The name is checked when the invitation is issued, where an administrator can confirm it. At acceptance only profiles
created **after** the invitation was issued count, the invitee cannot override, nothing about the other profile is revealed, and the whole
acceptance (including marking the invitation used) rolls back. `TeamMember.userId` uniqueness and account linking are untouched.

## Concurrency

Every check runs **inside the transaction that writes**, and (for creates, and for edits that change a compared field) the transaction's
first statement is a no-op write that takes the SQLite write lock — the technique `PUT /api/profile` already uses ("write first, then
read"). Overlapping creates of one name therefore serialise: the second reads the first's committed row and answers 409. Lock waits
that outlast the transaction timeout surface as `LockWaitTimeoutError`, answered **503 + Retry-After** (`transientContentionAs503`,
now also installed on the publications, news, research, users and invitations routers). Verified on local SQLite only
(`duplicate-prevention-regression.ts`, concurrent sections); **not verified against a remote Turso database**, where lock behaviour is
documented in `turso-migration-executor.md`.

## Why not a constraint

A constraint would block legitimate repeats with no override, and the useful ones are expression or partial indexes (normalised name or
DOI, only where non-empty) that Prisma cannot model and the migration executor (`tursoMigrate.ts`) is not documented to accept (only
plain `CREATE INDEX` and constant-default `ADD COLUMN`). A normalised-key column would be empty for every existing row and cannot be
back-filled by the executor. Revisit a DOI-only partial unique index once existing data is clean.

## Known limitations

- **Cost.** Each check loads a few small columns of the candidate rows and compares in memory (O(rows) per create or compared edit). Fine
  at lab scale (tens to hundreds of rows); revisit with an index or a stored key if a table grows to many thousands.
- **Not exhaustive.** Accent folding applies to Latin letters only; no transliteration (`Weiquan` vs `魏全`), no initials expansion
  (`K.M Adib` vs `Kazi M. Adib`), no fuzzy typos. Misses are expected; the check is a safety net.
- **Seed script unchanged.** `apps/server/prisma/seed.ts` guards each table with "skip when it already has rows" and inserts with
  `createMany`. If a table is emptied and re-seeded next to imported data, duplicates can still appear. Not changed here: it cannot be
  tested against a representative state in this task.
- **Existing duplicates are not detected or touched.** This only guards new writes.

## Rollback

Application-only: revert the change and redeploy. No schema, data or setting is involved. Audit rows that carry `duplicateOverride` stay
valid history.
