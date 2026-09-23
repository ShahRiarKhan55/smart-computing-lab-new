import type { Prisma } from "@prisma/client";
import { ID_PATTERN, isManager, type Actor } from "@scl/shared";
import { HttpError } from "./validate.js";

export type LinkActor = Actor;

/** Throws 400 for a malformed :id route param, before it reaches the database. */
export function assertValidId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new HttpError(400, "Invalid id.");
}

/**
 * Who may change the set of team members linked to a publication/news item.
 *
 * Mirrors the reference (require_owner_or_admin on set_publications/set_news):
 *  - A lab manager or admin can change any link.
 *  - A MEMBER can only add or remove *their own* team member. Every other
 *    link on the item must stay exactly as it is, otherwise 403.
 */
export async function assertMayChangeLinks(
  tx: Prisma.TransactionClient,
  actor: LinkActor,
  currentIds: string[],
  requestedIds: string[],
): Promise<void> {
  if (isManager(actor)) return;

  const self = await tx.teamMember.findUnique({ where: { userId: actor.id }, select: { id: true } });
  const othersOf = (ids: string[]) => ids.filter((id) => id !== self?.id).sort();
  const before = othersOf(currentIds);
  const after = othersOf(requestedIds);

  const unchanged = before.length === after.length && before.every((id, i) => id === after[i]);
  if (!unchanged) {
    throw new HttpError(403, "You can only add or remove yourself as an author.");
  }
}

/** Throws 400 unless every id is an existing team member. */
export async function assertTeamMembersExist(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await tx.teamMember.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new HttpError(400, "One or more team members do not exist.");
}

/** What to insert/remove to turn `current` into `requested` without touching unchanged links. */
export function diffLinks(current: string[], requested: string[]) {
  const currentSet = new Set(current);
  const requestedSet = new Set(requested);
  return {
    toAdd: requested.filter((id) => !currentSet.has(id)),
    toRemove: current.filter((id) => !requestedSet.has(id)),
  };
}
