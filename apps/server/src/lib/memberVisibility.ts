import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { ALUMNI_MESSAGES, canManageAlumni, isAdmin, type MaybeActor } from "@scl/shared";
import { HttpError } from "./validate.js";

/**
 * Public-display consent for team profiles (Phase 3B), the single place the rule lives.
 *
 * `TeamMember.isPublished` is true for every existing profile (migration default) and for every non-alumni profile the API
 * creates. An ALUMNI profile is created with `false` and only an administrator can set it to `true`.
 *
 * A profile is shown to a viewer only when `isPublished === true` (strict: any other value, including a missing or
 * unexpected one, is private), except that an ADMINISTRATOR sees every profile so they can review and publish alumni.
 * A lab manager is NOT an exception: they see exactly what the public sees.
 *
 * Every query that returns, counts, searches, links or names a team member for an HTTP response must go through
 * `publishedMemberWhere` (or `isMemberVisible` for a row already loaded). Unpublished profiles answer 404, never 403,
 * so their existence cannot be probed.
 */
export const seesUnpublishedMembers = (viewer: MaybeActor): boolean => isAdmin(viewer);

/** Prisma `where` fragment for a TeamMember (use it as `teamMember: publishedMemberWhere(viewer)` through a relation). */
export function publishedMemberWhere(viewer: MaybeActor): Prisma.TeamMemberWhereInput {
  return seesUnpublishedMembers(viewer) ? {} : { isPublished: true };
}

/** For an already-loaded row. Strict `=== true`: a missing or unexpected value is NOT visible. */
export function isMemberVisible(viewer: MaybeActor, row: { isPublished?: boolean | null }): boolean {
  return seesUnpublishedMembers(viewer) || row.isPublished === true;
}

/** How many of `ids` exist AND are visible to `viewer`: an unpublished profile counts as missing (no enumeration). */
export async function countVisibleMembers(
  tx: Pick<Prisma.TransactionClient, "teamMember">,
  viewer: MaybeActor,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  return tx.teamMember.count({ where: { id: { in: ids }, ...publishedMemberWhere(viewer) } });
}

/** Create/update payloads may never carry the publication flag: it is changed only by the explicit publish action. */
export function rejectPublicationField(body: unknown): void {
  if (body && typeof body === "object" && !Array.isArray(body) && Object.prototype.hasOwnProperty.call(body, "isPublished")) {
    throw new HttpError(400, ALUMNI_MESSAGES.publicationField);
  }
}

/** Alumni profiles may only be managed by `canManageAlumni` (admin). */
export const mayManageAlumni = (viewer: MaybeActor): boolean => canManageAlumni(viewer);

/**
 * Audit-log rows a NON-administrator must not see: events about team profiles that are alumni or unpublished (their `details` carry the
 * person's name), the publish / unpublish events, and any team-profile event that recorded the ALUMNI category. Nothing is deleted or
 * rewritten; this only narrows what a manager's query returns.
 *
 * A profile that has since been DELETED is still covered: its deletion row records the category it had (`"category":"ALUMNI"`), so every
 * row for that entity id is hidden too, including earlier plain "updated" rows. That is derived from a recorded fact, never from guessing
 * at names in text. Limit: a profile that was deleted while it was an alumnus BEFORE the deletion row recorded its category cannot be
 * identified this way (the deletion row has always carried it, so in practice this is every case).
 */
export async function auditHiddenFromManagers(): Promise<Prisma.AuditLogWhereInput> {
  const [hidden, deletedAlumni] = await Promise.all([
    prisma.teamMember.findMany({ where: { OR: [{ category: "ALUMNI" }, { isPublished: false }] }, select: { id: true } }),
    prisma.auditLog.findMany({ where: { entityType: "TEAM_MEMBER", action: "TEAM_MEMBER_DELETED", details: { contains: '"category":"ALUMNI"' } }, select: { entityId: true } }),
  ]);
  const ids = [...hidden.map((m) => m.id), ...deletedAlumni.flatMap((r) => (r.entityId ? [r.entityId] : []))];
  return {
    NOT: {
      entityType: "TEAM_MEMBER",
      OR: [
        { entityId: { in: ids } },
        { action: { in: ["TEAM_MEMBER_PUBLISHED", "TEAM_MEMBER_UNPUBLISHED"] } },
        { details: { contains: '"category":"ALUMNI"' } },
      ],
    },
  };
}
