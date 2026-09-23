import type { Prisma } from "@prisma/client";
import { mentionedTeamMemberIds } from "@scl/shared";

/**
 * Resolves the TeamMember ids mentioned in a post/comment body (via the shared
 * `@[Name](member:<id>)` token — see schemas/forum.ts) to the accounts that can actually
 * be notified: only team members that have a linked login. Every team profile is already
 * public (TeamMember has no `visibility` column — see search.ts), so there is no separate
 * visibility check here; an id that does not resolve (typo, no account, member since
 * removed) is silently dropped rather than rejecting the whole save — the composer always
 * inserts real ids from a picker, so this is defence in depth, not the primary guard.
 */
export async function resolveMentions(tx: Prisma.TransactionClient, body: string): Promise<{ teamMemberId: string; userId: string }[]> {
  const ids = mentionedTeamMemberIds(body);
  if (ids.length === 0) return [];
  const rows = await tx.teamMember.findMany({
    where: { id: { in: ids }, userId: { not: null } },
    select: { id: true, userId: true },
  });
  return rows.map((r) => ({ teamMemberId: r.id, userId: r.userId as string }));
}

/**
 * Makes the ForumMention rows for a post/comment match `resolved`, and returns the user ids
 * that are NEWLY mentioned (so an edit that keeps the same @mention does not re-notify —
 * Phase 8 §9's reason this table exists instead of re-parsing on every read).
 */
export async function syncMentions(
  tx: Prisma.TransactionClient,
  target: { postId: string; commentId?: undefined } | { postId?: undefined; commentId: string },
  resolved: { teamMemberId: string; userId: string }[],
): Promise<string[]> {
  const where = target.postId ? { postId: target.postId } : { commentId: target.commentId! };
  const existing = await tx.forumMention.findMany({ where, select: { mentionedUserId: true } });
  const existingIds = new Set(existing.map((e) => e.mentionedUserId));
  const wantedIds = new Set(resolved.map((r) => r.userId));

  const toRemove = [...existingIds].filter((id) => !wantedIds.has(id));
  const toAdd = [...wantedIds].filter((id) => !existingIds.has(id));

  if (toRemove.length > 0) {
    await tx.forumMention.deleteMany({ where: { ...where, mentionedUserId: { in: toRemove } } });
  }
  if (toAdd.length > 0) {
    await tx.forumMention.createMany({ data: toAdd.map((mentionedUserId) => ({ mentionedUserId, ...where })) });
  }
  return toAdd;
}
