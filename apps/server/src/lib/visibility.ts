import { canChangeVisibility, type Actor, type Visibility } from "@scl/shared";
import { HttpError } from "./validate.js";

/** The person making a request: a logged-in account, or null for a guest. */
export type Viewer = Actor | null;

/**
 * Prisma `where` fragment limiting rows to what `viewer` may see. Spread it into
 * every query on a table that has a `visibility` column:
 *
 *   prisma.newsItem.findMany({ where: { ...visibleTo(req.user ?? null) } })
 *
 * It is an allow-list on purpose. A guest matches only the literal "PUBLIC", and a
 * logged-in user only the two known values, so a mistyped or future value is hidden
 * from everybody rather than leaked. A hidden row should look exactly like a missing
 * one: answer 404, not 403.
 */
export function visibleTo(viewer: Viewer): { visibility: { in: Visibility[] } } {
  return { visibility: { in: viewer ? ["PUBLIC", "LAB_ONLY"] : ["PUBLIC"] } };
}

/** Same rule for a row that is already loaded (e.g. a to-one relation, or a file). */
export function canView(viewer: Viewer, visibility: string): boolean {
  return visibility === "PUBLIC" || (visibility === "LAB_ONLY" && viewer !== null);
}

/**
 * Write-side gate: only accounts that may change visibility may send the field at
 * all. Sending it without permission is a 403 (not silently ignored), so a client
 * never believes it published something it did not.
 */
export function assertMayChangeVisibility(actor: Viewer, requested: Visibility | undefined): void {
  if (requested !== undefined && !canChangeVisibility(actor)) {
    throw new HttpError(403, "Only lab managers and admins can change visibility.");
  }
}

/**
 * The `visibility` field of a response. Only accounts that can change visibility
 * ever receive it: a guest's content is all public, and an ordinary member has no
 * use for it (and no way to act on it).
 */
export function visibilityField(viewer: Viewer, value: string): { visibility?: Visibility } {
  return canChangeVisibility(viewer) ? { visibility: value as Visibility } : {};
}
