import type { Prisma } from "@prisma/client";
import { isManager } from "@scl/shared";
import { prisma } from "./prisma.js";
import { HttpError } from "./validate.js";
import type { Viewer } from "./visibility.js";

/**
 * Unpublished people (`TeamMember.isPublished = false`).
 *
 * Policy (owner-approved, Phase 27): lab managers/admins see everyone; an unpublished person sees
 * only themself; guests and every other account must not discover an unpublished person anywhere
 * a person is linked or attributed (authors, project/group members, area researchers, event /
 * knowledge / resource attributions, author-line text, search). A hidden person looks exactly like a
 * person who does not exist — never a 403, never a different message.
 *
 * Writes: an editor who cannot see a hidden link must never delete it by saving the list they were
 * shown. Whole-set editors therefore diff against `visibleIds(...)` only, so hidden links are neither
 * removed nor revealed (see `splitVisible`).
 */

/** Prisma `where` for a TeamMember row: `{}` for managers, otherwise published-or-own. */
export function personVisibleWhere(viewer: Viewer): Prisma.TeamMemberWhereInput {
  if (isManager(viewer)) return {};
  return { OR: [{ isPublished: true }, ...(viewer ? [{ userId: viewer.id }] : [])] };
}

/** `where` fragment for a join row that points at a person (`{ teamMember: ... }`). */
export const linkedPersonVisible = (viewer: Viewer): { teamMember: Prisma.TeamMemberWhereInput } => ({ teamMember: personVisibleWhere(viewer) });

/**
 * The viewer's own profile id, looked up ONLY when it can matter: a signed-in non-manager and at least one already-loaded person is
 * unpublished. Everyone else costs no query. (The account id of a person is never selected into a public payload.)
 */
export async function selfProfileIdIfNeeded(viewer: Viewer, people: (({ isPublished: boolean } | null | undefined))[]): Promise<string | null> {
  if (!viewer || isManager(viewer) || !people.some((p) => p && !p.isPublished)) return null;
  const me = await prisma.teamMember.findUnique({ where: { userId: viewer.id }, select: { id: true } });
  return me?.id ?? null;
}

/** Visibility for an already-loaded person (select `isPublished` with it); `selfId` from `selfProfileIdIfNeeded`. */
export function personVisible(viewer: Viewer, person: { id: string; isPublished: boolean }, selfId: string | null): boolean {
  return person.isPublished || isManager(viewer) || (selfId !== null && person.id === selfId);
}

/** `{id, name}` for an attribution, or `null` when the person is hidden from this viewer. */
export function visibleAttribution(
  viewer: Viewer,
  person: { id: string; name: string; isPublished: boolean } | null | undefined,
  selfId: string | null,
): { id: string; name: string } | null {
  return person && personVisible(viewer, person, selfId) ? { id: person.id, name: person.name } : null;
}

/** Of `ids`, those the viewer may see (managers: all that exist). */
export async function visiblePersonIds(tx: Prisma.TransactionClient, viewer: Viewer, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.teamMember.findMany({ where: { id: { in: ids }, ...personVisibleWhere(viewer) }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/**
 * Splits the CURRENT linked ids into those the editor may see and those hidden from them.
 * Callers diff the editor's request against `visible` only, so `hidden` links always survive.
 */
export async function splitVisible(tx: Prisma.TransactionClient, viewer: Viewer, currentIds: string[]): Promise<{ visible: string[]; hidden: string[] }> {
  const ok = await visiblePersonIds(tx, viewer, currentIds);
  return { visible: currentIds.filter((id) => ok.has(id)), hidden: currentIds.filter((id) => !ok.has(id)) };
}

/**
 * 400 unless every requested id is an existing person the editor may see. A hidden person gets the
 * same answer as a nonexistent id, so the endpoint cannot be used to probe for them.
 */
export async function assertPeopleVisibleAndExist(tx: Prisma.TransactionClient, viewer: Viewer, ids: string[]): Promise<void> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return;
  const found = await tx.teamMember.count({ where: { id: { in: unique }, ...personVisibleWhere(viewer) } });
  if (found !== unique.length) throw new HttpError(400, "One or more team members do not exist.");
}

/**
 * Whether searching `term` may match a free-text author line. If the term overlaps a hidden person's name the author line
 * is NOT searched, so a match can never confirm that a hidden person is on a (redacted) line.
 */
export function mayMatchAuthorText(term: string, hiddenNames: string[]): boolean {
  const t = term.toLowerCase();
  return !hiddenNames.some((n) => {
    const h = n.toLowerCase();
    return h.includes(t) || t.includes(h);
  });
}

// -- identities shown on communication surfaces (forum, notifications) ----------------------------------------------------------

/** What a masked identity looks like: the same shape the API already uses for an account without a profile. */
export const MASKED_NAME = "Lab member";

/**
 * May `viewer` see the identity of the account behind `teamMember`? Published profiles: everyone. Unpublished: managers and the person
 * themself (`accountId` is the author's/actor's USER id, compared with the viewer's — it is never returned). A missing flag fails closed.
 */
export function identityVisible(viewer: Viewer, teamMember: { isPublished?: boolean }, accountId: string | null | undefined): boolean {
  return teamMember.isPublished === true || isManager(viewer) || (viewer !== null && !!accountId && viewer.id === accountId);
}

// -- free-text author lines --------------------------------------------------------------------------------------------------

/** Names of unpublished people the viewer may not see (empty for managers). */
export async function hiddenNamesFor(viewer: Viewer): Promise<string[]> {
  if (isManager(viewer)) return [];
  const rows = await prisma.teamMember.findMany({
    where: { isPublished: false, ...(viewer ? { OR: [{ userId: null }, { userId: { not: viewer.id } }] } : {}) },
    select: { name: true },
  });
  return rows.map((r) => r.name.trim()).filter((n) => n.length >= 2);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Removes each hidden person's exact full name (whole-word, case-insensitive) from a free-text author line
 * and tidies the separators that are left behind. Only exact names are recognised: initials, reordered
 * names and mentions inside other prose are NOT rewritten (documented limitation).
 */
export function redactNames(text: string, names: string[]): string {
  if (names.length === 0 || text === "") return text;
  let out = text;
  for (const name of names) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(re, "");
  }
  if (out === text) return text;
  return out
    .replace(/\(\s*\)/g, "")
    .replace(/([,;、])(?:\s*[,;、])+/g, "$1")
    .replace(/\s+(?:and|&)\s*(?=[,;、]|$)/giu, "")
    .replace(/(?:^|(?<=[,;、]))\s*(?:and|&)\s+(?=\S)/giu, "")
    .replace(/^[\s,;、]+|[\s,;、]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,;、])/g, "$1")
    .trim();
}
