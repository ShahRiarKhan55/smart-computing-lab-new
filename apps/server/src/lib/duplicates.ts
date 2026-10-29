import type { Prisma } from "@prisma/client";
import {
  DUPLICATE_CODE,
  DUPLICATE_MESSAGES,
  INVITATION_DUPLICATE_MESSAGE,
  canOverrideDuplicate,
  canonicalDoi,
  findNameMatches,
  findNewsMatches,
  findPublicationMatches,
  findResearchAreaMatches,
  normalizeText,
  personNameKey,
  researchTitleKey,
  type Actor,
  type DuplicateCandidate,
  type DuplicateConflictBody,
  type DuplicateKind,
} from "@scl/shared";
import { asLockWait } from "./dbErrors.js";
import { publishedMemberWhere } from "./memberVisibility.js";
import { HttpError } from "./validate.js";

/**
 * Duplicate guard for curated content, run INSIDE the transaction that creates or edits the record (see packages/shared/src/duplicates.ts
 * for the rules and for why a match is a warning, not proof).
 *
 * Contract of every `guard*` function:
 *  - it returns `null` when nothing matches (or an EDIT does not change the compared fields: an existing duplicate never blocks an
 *    unrelated edit);
 *  - it returns the {@link DuplicateKind} that was knowingly overridden (so the caller can note it in the audit row) when the requester is
 *    allowed to override (`canOverrideDuplicate`) and sent `confirmDuplicate: true`;
 *  - otherwise it throws a 409 whose JSON body is a {@link DuplicateConflictBody};
 *  - the record being edited is always excluded from the comparison.
 *
 * CONCURRENCY. `lockForDuplicateCheck` takes the database write lock BEFORE the comparison is read, using the technique this codebase
 * already uses for profile writes ("the first statement of the transaction is a write", see PUT /api/profile): an UPDATE that matches no
 * row still takes SQLite's write lock. Two overlapping creates of the same record are therefore serialised, and the second one reads the
 * first one's committed row and answers 409. Contention that outlasts the transaction timeout surfaces as LockWaitTimeoutError, which the
 * routers answer with 503 + Retry-After (transientContentionAs503). There is deliberately NO database constraint (none can express these
 * rules in Prisma/SQLite without a migration, see the pull request notes); this is a best-effort application check.
 *
 * COST. The comparison loads a few small columns of the candidate rows (a lab has tens to hundreds of each) and compares in memory; it
 * runs only on create and on an edit that changes a compared field.
 */

type Tx = Prisma.TransactionClient;
type Model = "teamMember" | "publication" | "newsItem" | "researchArea";

/** Not a cuid, so it can never match a real row: the UPDATE below changes nothing and exists only to take the write lock. */
const NO_ROW = "duplicate-check-write-lock";
const MAX_CANDIDATES = 5;

export async function lockForDuplicateCheck(tx: Tx, model: Model): Promise<void> {
  const now = new Date();
  switch (model) {
    case "teamMember":
      await asLockWait(tx.teamMember.updateMany({ where: { id: NO_ROW }, data: { updatedAt: now } }));
      return;
    case "publication":
      await asLockWait(tx.publication.updateMany({ where: { id: NO_ROW }, data: { updatedAt: now } }));
      return;
    case "newsItem":
      await asLockWait(tx.newsItem.updateMany({ where: { id: NO_ROW }, data: { updatedAt: now } }));
      return;
    case "researchArea":
      await asLockWait(tx.researchArea.updateMany({ where: { id: NO_ROW }, data: { updatedAt: now } }));
      return;
  }
}

interface Decision {
  kind: DuplicateKind;
  overridable: boolean;
  candidates: DuplicateCandidate[];
}

/** Applies the override rule: returns the overridden kind, or throws the 409. */
function resolve(actor: Actor | null, confirm: boolean | undefined, decision: Decision): DuplicateKind {
  const canOverride = canOverrideDuplicate(actor);
  if (decision.overridable && canOverride && confirm === true) return decision.kind;
  const body: Omit<DuplicateConflictBody, "error"> = {
    code: DUPLICATE_CODE,
    kind: decision.kind,
    overridable: decision.overridable,
    canOverride: decision.overridable && canOverride,
    candidates: decision.candidates.slice(0, MAX_CANDIDATES),
  };
  throw new HttpError(409, DUPLICATE_MESSAGES[decision.kind], body);
}

// ---- team profile names -----------------------------------------------------------------------------------------------------

/**
 * A new or renamed team profile. Compared against the profiles the REQUESTER may see (`publishedMemberWhere`): an unpublished or alumni
 * profile is invisible to a lab manager and to a member, and answering 409 for it would let them probe for it by typing names (the app
 * answers 404, never 403, for exactly that reason). An administrator sees them all, so an admin is warned about those too.
 *
 * `previousName`: pass the current name on an EDIT; the check is skipped when the comparison key does not change (a case or punctuation
 * only change to a name that already matches something stays allowed, and so does any edit that leaves the name alone).
 */
export async function guardTeamName(
  tx: Tx,
  actor: Actor,
  input: { name: string; excludeId?: string; previousName?: string; confirm?: boolean },
): Promise<DuplicateKind | null> {
  if (input.previousName !== undefined && personNameKey(input.previousName) === personNameKey(input.name)) return null;
  const rows = await tx.teamMember.findMany({
    where: publishedMemberWhere(actor),
    select: { id: true, name: true, category: true },
  });
  const matches = findNameMatches(input.name, rows, input.excludeId);
  if (matches.length === 0) return null;
  return resolve(actor, input.confirm, {
    kind: "team-name",
    overridable: true,
    candidates: matches.map((m) => ({ id: m.id, label: m.name, detail: m.category })),
  });
}

/**
 * Invitation ACCEPTANCE creates the invited person's profile with the name the administrator typed when issuing the invitation. That name
 * was already checked (and, if need be, overridden by an administrator) at issue time, and the invitee is not allowed to override, so only
 * profiles created AFTER the invitation was issued count here. Nothing about the matching profile is revealed.
 */
export async function guardInvitedProfileName(tx: Tx, input: { name: string; invitedAt: Date }): Promise<void> {
  const rows = await tx.teamMember.findMany({
    where: { createdAt: { gt: input.invitedAt } },
    select: { id: true, name: true },
  });
  if (findNameMatches(input.name, rows).length === 0) return;
  const body: Omit<DuplicateConflictBody, "error"> = {
    code: DUPLICATE_CODE,
    kind: "team-name",
    overridable: false,
    canOverride: false,
    candidates: [],
  };
  throw new HttpError(409, INVITATION_DUPLICATE_MESSAGE, body);
}

// ---- publications -----------------------------------------------------------------------------------------------------------

export interface PublicationFields {
  title: string;
  year: number;
  doiUrl: string;
}

/** Same compared fields (title key, year, canonical DOI) before and after: the edit cannot have created a duplicate. */
function publicationUnchanged(a: PublicationFields, b: PublicationFields): boolean {
  return normalizeText(a.title) === normalizeText(b.title) && a.year === b.year && canonicalDoi(a.doiUrl) === canonicalDoi(b.doiUrl);
}

export async function guardPublication(
  tx: Tx,
  actor: Actor,
  input: { next: PublicationFields; previous?: PublicationFields; excludeId?: string; confirm?: boolean },
): Promise<DuplicateKind | null> {
  if (input.previous && publicationUnchanged(input.previous, input.next)) return null;
  // Same-year rows (title match) plus every row that has a DOI (DOI match, whatever the URL form or year).
  const rows = await tx.publication.findMany({
    where: { OR: [{ year: input.next.year }, { NOT: { doiUrl: "" } }] },
    select: { id: true, title: true, year: true, doiUrl: true },
  });
  const matches = findPublicationMatches(input.next, rows, input.excludeId);
  if (matches.length === 0) return null;
  const doi = matches.filter((m) => m.kind === "doi");
  const chosen = doi.length > 0 ? doi : matches;
  return resolve(actor, input.confirm, {
    kind: doi.length > 0 ? "publication-doi" : "publication-title-year",
    overridable: doi.length === 0,
    candidates: chosen.map((m) => ({ id: m.record.id, label: m.record.title, detail: String(m.record.year) })),
  });
}

// ---- news -------------------------------------------------------------------------------------------------------------------

export interface NewsFields {
  title: string;
  dateLabel: string;
  sortDate: string;
}

export async function guardNews(
  tx: Tx,
  actor: Actor,
  input: { next: NewsFields; previous?: NewsFields; excludeId?: string; confirm?: boolean },
): Promise<DuplicateKind | null> {
  const p = input.previous;
  if (p && normalizeText(p.title) === normalizeText(input.next.title) && normalizeText(p.dateLabel) === normalizeText(input.next.dateLabel) && p.sortDate === input.next.sortDate) {
    return null;
  }
  const rows = await tx.newsItem.findMany({ select: { id: true, title: true, dateLabel: true, sortDate: true } });
  const matches = findNewsMatches(input.next, rows, input.excludeId);
  if (matches.length === 0) return null;
  return resolve(actor, input.confirm, {
    kind: "news-title-date",
    overridable: true,
    candidates: matches.map((m) => ({ id: m.id, label: m.title, detail: m.dateLabel })),
  });
}

// ---- research areas ---------------------------------------------------------------------------------------------------------

export interface ResearchFields {
  title: string;
}

export async function guardResearchArea(
  tx: Tx,
  actor: Actor,
  input: { next: ResearchFields; previous?: ResearchFields; excludeId?: string; confirm?: boolean },
): Promise<DuplicateKind | null> {
  if (input.previous && researchTitleKey(input.previous.title) === researchTitleKey(input.next.title)) return null;
  const rows = await tx.researchArea.findMany({ select: { id: true, title: true, tag: true } });
  const matches = findResearchAreaMatches(input.next, rows, input.excludeId);
  if (matches.length === 0) return null;
  return resolve(actor, input.confirm, {
    kind: "research-title",
    overridable: true,
    candidates: matches.map((m) => ({ id: m.id, label: m.title, detail: m.tag })),
  });
}

/** Audit-detail fragment for a knowingly overridden warning (empty otherwise), so an override is always visible in the audit log. */
export const overrideDetails = (overridden: DuplicateKind | null): { duplicateOverride?: string } =>
  overridden ? { duplicateOverride: overridden } : {};
