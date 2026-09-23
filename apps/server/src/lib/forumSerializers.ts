import type { Prisma, PrismaClient } from "@prisma/client";
import { isManager } from "@scl/shared";
import type { ForumAuthorRef, ForumCategoryRef, ForumReactionCounts, ForumReactionKind, ForumReactions, PaginationMeta } from "@scl/shared";
import type { Viewer } from "./visibility.js";

type ForumDb = Prisma.TransactionClient | PrismaClient;

/** `ACTIVE` for everyone; managers also see `HIDDEN` (to review/restore it). `DELETED` is
 *  never returned by any read endpoint, for any viewer — see docs/architecture/phase11. */
export function visibleForumStatus(viewer: Viewer): { status: { in: string[] } } {
  return { status: { in: isManager(viewer) ? ["ACTIVE", "HIDDEN"] : ["ACTIVE"] } };
}

/** A post/comment author as the API shows it. Never includes the account id (userId). */
export function toForumAuthor(user: { teamMember: { id: string; name: string; initials: string } | null } | null): ForumAuthorRef {
  if (!user) return { teamMemberId: null, name: "Former member", initials: "—" };
  if (user.teamMember) return { teamMemberId: user.teamMember.id, name: user.teamMember.name, initials: user.teamMember.initials };
  return { teamMemberId: null, name: "Lab member", initials: "—" };
}

export const toForumCategoryRef = (c: { id: string; slug: string; name: string }): ForumCategoryRef => ({ id: c.id, slug: c.slug, name: c.name });

export function emptyReactionCounts(): ForumReactionCounts {
  return { LIKE: 0, LOVE: 0, INSIGHTFUL: 0, THANKS: 0 };
}

export function paginate(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) };
}

/** Reaction counts + the viewer's own reaction kinds, for a batch of posts in one pair of queries. */
export async function loadPostReactions(db: ForumDb, postIds: string[], viewer: Viewer): Promise<Map<string, ForumReactions>> {
  const out = new Map<string, ForumReactions>(postIds.map((id) => [id, { counts: emptyReactionCounts(), mine: [] as ForumReactionKind[] }]));
  if (postIds.length === 0) return out;

  const grouped = await db.forumReaction.groupBy({ by: ["postId", "kind"], where: { postId: { in: postIds } }, _count: true });
  for (const row of grouped) {
    const entry = row.postId && out.get(row.postId);
    if (entry) entry.counts[row.kind as ForumReactionKind] = row._count;
  }
  if (viewer) {
    const mine = await db.forumReaction.findMany({ where: { userId: viewer.id, postId: { in: postIds } }, select: { postId: true, kind: true } });
    for (const row of mine) {
      if (row.postId) out.get(row.postId)?.mine.push(row.kind as ForumReactionKind);
    }
  }
  return out;
}

/** Same as `loadPostReactions`, for comments. */
export async function loadCommentReactions(db: ForumDb, commentIds: string[], viewer: Viewer): Promise<Map<string, ForumReactions>> {
  const out = new Map<string, ForumReactions>(commentIds.map((id) => [id, { counts: emptyReactionCounts(), mine: [] as ForumReactionKind[] }]));
  if (commentIds.length === 0) return out;

  const grouped = await db.forumReaction.groupBy({ by: ["commentId", "kind"], where: { commentId: { in: commentIds } }, _count: true });
  for (const row of grouped) {
    const entry = row.commentId && out.get(row.commentId);
    if (entry) entry.counts[row.kind as ForumReactionKind] = row._count;
  }
  if (viewer) {
    const mine = await db.forumReaction.findMany({ where: { userId: viewer.id, commentId: { in: commentIds } }, select: { commentId: true, kind: true } });
    for (const row of mine) {
      if (row.commentId) out.get(row.commentId)?.mine.push(row.kind as ForumReactionKind);
    }
  }
  return out;
}

/** Number of VIEWER-VISIBLE comments on each post (never a hidden count). */
export async function loadCommentCounts(db: ForumDb, postIds: string[], viewer: Viewer): Promise<Map<string, number>> {
  const out = new Map<string, number>(postIds.map((id) => [id, 0]));
  if (postIds.length === 0) return out;
  const grouped = await db.forumComment.groupBy({ by: ["postId"], where: { postId: { in: postIds }, ...visibleForumStatus(viewer) }, _count: true });
  for (const row of grouped) out.set(row.postId, row._count);
  return out;
}
