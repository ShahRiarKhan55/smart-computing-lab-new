import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  FORUM_COMMENTS_DEFAULT_LIMIT,
  FORUM_TOPIC_MANAGER_ONLY_KEYS,
  canCommentForum,
  canCreateForumTopic,
  canDeleteForumComment,
  canDeleteForumPost,
  canEditForumComment,
  canEditForumPost,
  canManageForumCategories,
  canModerate,
  canReactForum,
  createForumCategorySchema,
  createForumCommentSchema,
  createForumTopicSchema,
  forumCommentsQuerySchema,
  forumReactionInputSchema,
  forumReactionKindSchema,
  forumTopicsQuerySchema,
  isManager,
  updateForumCategorySchema,
  updateForumCommentSchema,
  updateForumTopicSchema,
  type Actor,
  type ForumCategory,
  type ForumComment,
  type ForumReactionKind,
  type ForumReactions,
  type ForumTopicDetail,
  type ForumTopicSummary,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { optionalAuth, requireCan, requireEditor } from "../middleware/auth.js";
import { assertValidId } from "../lib/authorLinks.js";
import { canView, visibilityField, visibleTo, type Viewer } from "../lib/visibility.js";
import { asProjectStatus } from "../lib/serializers.js";
import { slugify, uniqueSlug } from "../lib/slug.js";
import { changedFields, recordAudit, recordVisibilityChange, type AuditAction } from "../lib/audit.js";
import {
  loadCommentCounts,
  loadCommentReactions,
  loadPostReactions,
  paginate,
  toForumAuthor,
  toForumCategoryRef,
  visibleForumStatus,
} from "../lib/forumSerializers.js";
import { resolveMentions, syncMentions } from "../lib/forumMentions.js";
import { notify, notifyMany } from "../lib/notify.js";

const router = Router();

const topicPath = (postId: string) => `/community/forum/topic/${postId}`;

/** `req.user` (see src/types/express.d.ts): an Actor plus the email `recordAudit` snapshots. */
type SessionActor = { id: string; email: string; role: Actor["role"] };

// ---------------------------------------------------------------------------
// Categories. Visibility lives HERE; posts/comments inherit it (§9 of the Phase 8 doc / the
// Phase 11 architecture doc) — a post is never more public than the category it lives in.
// ---------------------------------------------------------------------------
function toCategory(row: { id: string; slug: string; name: string; description: string; visibility: string; isLocked: boolean; sortOrder: number }, viewer: Viewer, topicCount: number, lastActivityAt: Date | null): ForumCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    ...visibilityField(viewer, row.visibility),
    isLocked: row.isLocked,
    sortOrder: row.sortOrder,
    topicCount,
    lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
    canManage: canManageForumCategories(viewer),
  };
}

// GET /api/forum/categories -> every category this viewer may see, with counts scoped to what THEY may see.
router.get(
  "/categories",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const rows = await prisma.forumCategory.findMany({ where: visibleTo(viewer), orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const ids = rows.map((r) => r.id);
    const [counts, latest] = await Promise.all([
      ids.length ? prisma.forumPost.groupBy({ by: ["categoryId"], where: { categoryId: { in: ids }, ...visibleForumStatus(viewer) }, _count: true }) : [],
      ids.length ? prisma.forumPost.groupBy({ by: ["categoryId"], where: { categoryId: { in: ids }, ...visibleForumStatus(viewer) }, _max: { lastActivityAt: true } }) : [],
    ]);
    const countMap = new Map(counts.map((c) => [c.categoryId, c._count]));
    const latestMap = new Map(latest.map((l) => [l.categoryId, l._max.lastActivityAt]));
    res.json(rows.map((r) => toCategory(r, viewer, countMap.get(r.id) ?? 0, latestMap.get(r.id) ?? null)));
  }),
);

// GET /api/forum/categories/:slug -> single category (a hidden one is a 404 for a non-member, like everywhere else)
router.get(
  "/categories/:slug",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const row = await prisma.forumCategory.findFirst({ where: { slug: req.params.slug, ...visibleTo(viewer) } });
    if (!row) throw new HttpError(404, "Not found");
    const where = { categoryId: row.id, ...visibleForumStatus(viewer) };
    const [topicCount, latest] = await Promise.all([prisma.forumPost.count({ where }), prisma.forumPost.aggregate({ where, _max: { lastActivityAt: true } })]);
    res.json(toCategory(row, viewer, topicCount, latest._max.lastActivityAt));
  }),
);

async function assertCategorySlugFree(tx: Prisma.TransactionClient, slug: string, exceptId?: string) {
  const taken = await tx.forumCategory.findUnique({ where: { slug }, select: { id: true } });
  if (taken && taken.id !== exceptId) throw new HttpError(409, "That slug is already in use.");
}

// POST /api/forum/categories -> create (lab manager or admin). New categories are LAB_ONLY unless a visibility is given.
router.post(
  "/categories",
  requireCan(canManageForumCategories),
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(createForumCategorySchema, req.body);
    const id = await prisma.$transaction(async (tx) => {
      let slug: string;
      if (body.slug) {
        await assertCategorySlugFree(tx, body.slug);
        slug = body.slug;
      } else {
        slug = await uniqueSlug(tx, "forumCategory", slugify(body.name, "category"));
      }
      const row = await tx.forumCategory.create({
        data: { slug, name: body.name, description: body.description, visibility: body.visibility ?? "LAB_ONLY", sortOrder: body.sortOrder, isLocked: body.isLocked },
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "FORUM_CATEGORY_CREATED",
        entityType: "FORUM_CATEGORY",
        entityId: row.id,
        details: { name: row.name, slug: row.slug, visibility: row.visibility },
      });
      return row.id;
    });
    const row = await prisma.forumCategory.findUniqueOrThrow({ where: { id } });
    res.status(201).json(toCategory(row, req.user!, 0, null));
  }),
);

// PUT /api/forum/categories/:id -> update (lab manager or admin).
router.put(
  "/categories/:id",
  requireCan(canManageForumCategories),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const body = parseOrThrow(updateForumCategorySchema, req.body);
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.forumCategory.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");
      if (body.slug !== undefined) await assertCategorySlugFree(tx, body.slug, existing.id);

      const row = await tx.forumCategory.update({ where: { id: existing.id }, data: body });
      const changed = changedFields(existing, body, ["name", "description", "visibility", "slug", "sortOrder", "isLocked"]);
      if (changed) {
        await recordAudit(tx, { actor: req.user!, action: "FORUM_CATEGORY_UPDATED", entityType: "FORUM_CATEGORY", entityId: row.id, details: { name: row.name, changed } });
      }
      await recordVisibilityChange(tx, req.user!, "FORUM_CATEGORY", row.id, existing.visibility, body.visibility);
      return row;
    });
    const where = { categoryId: updated.id, ...visibleForumStatus(req.user!) };
    const [topicCount, latest] = await Promise.all([prisma.forumPost.count({ where }), prisma.forumPost.aggregate({ where, _max: { lastActivityAt: true } })]);
    res.json(toCategory(updated, req.user!, topicCount, latest._max.lastActivityAt));
  }),
);

// DELETE /api/forum/categories/:id -> delete (lab manager or admin). Blocked while it still holds
// any topic (ACTIVE, HIDDEN or DELETED — the FK is ON DELETE RESTRICT): move or delete them first.
router.delete(
  "/categories/:id",
  requireCan(canManageForumCategories),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.forumCategory.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Not found");
      const postCount = await tx.forumPost.count({ where: { categoryId: existing.id } });
      if (postCount > 0) throw new HttpError(409, "This category still has topics; move or delete them first.");
      await tx.forumCategory.delete({ where: { id: existing.id } });
      await recordAudit(tx, { actor: req.user!, action: "FORUM_CATEGORY_DELETED", entityType: "FORUM_CATEGORY", entityId: existing.id, details: { name: existing.name, slug: existing.slug } });
    });
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Topics. Ordering is documented and deterministic: pinned first, then most recently active,
// then id (final tiebreaker) — see docs/architecture/phase11-forum-community.md.
// ---------------------------------------------------------------------------
function postInclude() {
  return {
    category: { select: { id: true, slug: true, name: true, visibility: true } },
    author: { select: { id: true, teamMember: { select: { id: true, name: true, initials: true, isPublished: true } } } },
    project: { select: { id: true, slug: true, title: true, status: true, visibility: true } },
  } satisfies Prisma.ForumPostInclude;
}

type PostRow = Prisma.ForumPostGetPayload<{ include: ReturnType<typeof postInclude> }>;
type CommentAuthorInclude = { author: { select: { id: true; teamMember: { select: { id: true; name: true; initials: true; isPublished: true } } } } };
type CommentRow = Prisma.ForumCommentGetPayload<{ include: CommentAuthorInclude }>;

function excerptOf(body: string): string {
  const flat = body.replace(/@\[([^[\]\n]{1,120})\]\(member:[A-Za-z0-9_-]{1,64}\)/g, "@$1").replace(/\s+/g, " ").trim();
  return flat.length <= 220 ? flat : `${flat.slice(0, 220).trimEnd()}…`;
}

function toTopicSummary(row: PostRow, viewer: Viewer, reactions: ForumReactions, commentCount: number): ForumTopicSummary {
  const isAuthor = viewer !== null && row.authorId === viewer.id;
  return {
    id: row.id,
    category: toForumCategoryRef(row.category),
    author: toForumAuthor(row.author, viewer),
    title: row.title,
    excerpt: excerptOf(row.body),
    status: row.status as "ACTIVE" | "HIDDEN",
    pinned: row.pinned,
    locked: row.locked,
    project: row.project && canView(viewer, row.project.visibility) ? { id: row.project.id, slug: row.project.slug, title: row.project.title, status: asProjectStatus(row.project.status) } : null,
    commentCount,
    reactions,
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    canEdit: canEditForumPost(viewer, isAuthor),
    canDelete: canDeleteForumPost(viewer, isAuthor),
    canModerate: canModerate(viewer),
  };
}

function toComment(row: CommentRow, viewer: Viewer, reactions: ForumReactions): ForumComment {
  const isAuthor = viewer !== null && row.authorId === viewer.id;
  return {
    id: row.id,
    author: toForumAuthor(row.author, viewer),
    body: row.body,
    status: row.status as "ACTIVE" | "HIDDEN",
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    reactions,
    canEdit: canEditForumComment(viewer, isAuthor),
    canDelete: canDeleteForumComment(viewer, isAuthor),
    canModerate: canModerate(viewer),
  };
}

async function loadTopicDetail(id: string, viewer: Viewer, commentsPage: number, commentsLimit: number): Promise<ForumTopicDetail | null> {
  const row = await prisma.forumPost.findFirst({ where: { id, category: visibleTo(viewer), ...visibleForumStatus(viewer) }, include: postInclude() });
  if (!row) return null;

  const commentWhere = { postId: row.id, ...visibleForumStatus(viewer) };
  const [commentTotal, commentRows] = await Promise.all([
    prisma.forumComment.count({ where: commentWhere }),
    prisma.forumComment.findMany({
      where: commentWhere,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (commentsPage - 1) * commentsLimit,
      take: commentsLimit,
      include: { author: { select: { id: true, teamMember: { select: { id: true, name: true, initials: true, isPublished: true } } } } },
    }),
  ]);
  const commentIds = commentRows.map((c) => c.id);
  const [postReactions, commentReactions, commentCounts] = await Promise.all([
    loadPostReactions(prisma, [row.id], viewer),
    loadCommentReactions(prisma, commentIds, viewer),
    loadCommentCounts(prisma, [row.id], viewer),
  ]);

  return {
    ...toTopicSummary(row, viewer, postReactions.get(row.id)!, commentCounts.get(row.id) ?? 0),
    body: row.body,
    comments: commentRows.map((c) => toComment(c, viewer, commentReactions.get(c.id)!)),
    commentsPagination: paginate(commentsPage, commentsLimit, commentTotal),
  };
}

// GET /api/forum/posts?category=&project=&page=&limit= -> topic list (public; category/status filtered by visibility)
router.get(
  "/posts",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const viewer = req.user ?? null;
    const query = parseOrThrow(forumTopicsQuerySchema, req.query);
    const where: Prisma.ForumPostWhereInput = { category: visibleTo(viewer), ...visibleForumStatus(viewer) };

    if (query.category) {
      const category = await prisma.forumCategory.findFirst({ where: { slug: query.category, ...visibleTo(viewer) }, select: { id: true } });
      if (!category) {
        res.json({ topics: [], pagination: paginate(query.page, query.limit, 0) });
        return;
      }
      where.categoryId = category.id;
    }
    if (query.project) where.projectId = query.project;

    const total = await prisma.forumPost.count({ where });
    const rows = await prisma.forumPost.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { lastActivityAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: postInclude(),
    });
    const ids = rows.map((r) => r.id);
    const [reactions, commentCounts] = await Promise.all([loadPostReactions(prisma, ids, viewer), loadCommentCounts(prisma, ids, viewer)]);
    res.json({
      topics: rows.map((r) => toTopicSummary(r, viewer, reactions.get(r.id)!, commentCounts.get(r.id) ?? 0)),
      pagination: paginate(query.page, query.limit, total),
    });
  }),
);

// GET /api/forum/posts/:id?page=&limit= -> topic + paginated comments (a HIDDEN/DELETED/inaccessible post is a 404)
router.get(
  "/posts/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const viewer = req.user ?? null;
    const query = parseOrThrow(forumCommentsQuerySchema, req.query);
    const detail = await loadTopicDetail(req.params.id, viewer, query.page, query.limit);
    if (!detail) throw new HttpError(404, "Not found");
    res.json(detail);
  }),
);

async function assertProjectSelectable(tx: Prisma.TransactionClient, actor: Actor, projectId: string | null | undefined) {
  if (!projectId) return;
  const project = await tx.researchProject.findUnique({ where: { id: projectId }, select: { visibility: true } });
  if (!project || !canView(actor, project.visibility)) throw new HttpError(400, "Selected project does not exist.");
}

// POST /api/forum/posts -> create a topic (any logged-in member). The author always comes from
// the session — never the request body.
router.post(
  "/posts",
  requireCan(canCreateForumTopic),
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(createForumTopicSchema, req.body);
    const id = await prisma.$transaction(async (tx) => {
      const category = await tx.forumCategory.findUnique({ where: { id: body.categoryId } });
      if (!category || !canView(req.user!, category.visibility)) throw new HttpError(400, "Selected category does not exist.");
      if (category.isLocked) throw new HttpError(403, "This category is locked: new topics are not accepted.");
      await assertProjectSelectable(tx, req.user!, body.projectId);

      const resolved = await resolveMentions(tx, body.body);
      const row = await tx.forumPost.create({
        data: { categoryId: category.id, authorId: req.user!.id, projectId: body.projectId, title: body.title, body: body.body, lastActivityAt: new Date() },
      });
      const newlyMentioned = await syncMentions(tx, { postId: row.id }, resolved);
      await notifyMany(tx, newlyMentioned, {
        type: "FORUM_MENTION",
        actorId: req.user!.id,
        entityType: "FORUM_POST",
        entityId: row.id,
        targetPath: topicPath(row.id),
        payload: { title: row.title },
      });
      await recordAudit(tx, {
        actor: req.user!,
        action: "FORUM_POST_CREATED",
        entityType: "FORUM_POST",
        entityId: row.id,
        details: { title: row.title, categoryId: category.id, projectId: row.projectId },
      });
      return row.id;
    });
    res.status(201).json(await loadTopicDetail(id, req.user!, 1, FORUM_COMMENTS_DEFAULT_LIMIT));
  }),
);

const isPostAuthor = async (postId: string, userId: string) => (await prisma.forumPost.count({ where: { id: postId, authorId: userId } })) > 0;
const isCommentAuthor = async (commentId: string, userId: string) => (await prisma.forumComment.count({ where: { id: commentId, authorId: userId } })) > 0;

// A manager may always reach the PUT handler (to move a topic to another category); the handler
// itself rejects a manager who is not the author from touching the title/body/project fields.
const canReachTopicEdit = (actor: Actor, isAuthor: boolean) => isManager(actor) || isAuthor;
const requireTopicPutAccess = requireEditor(canReachTopicEdit, isPostAuthor);
const requireTopicDeleteAccess = requireEditor(canDeleteForumPost, isPostAuthor);

// PUT /api/forum/posts/:id -> the author may edit title/body/project; only a manager may move it
// (categoryId) to a different category — sending it as anyone else is 403, matching the
// PROJECT_MANAGER_ONLY_KEYS pattern used elsewhere.
router.put(
  "/posts/:id",
  requireTopicPutAccess,
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(updateForumTopicSchema, req.body);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.forumPost.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.status === "DELETED") throw new HttpError(404, "Not found");
      const isAuthor = existing.authorId === req.user!.id;

      const sendingContent = body.title !== undefined || body.body !== undefined || body.projectId !== undefined;
      if (sendingContent && !canEditForumPost(req.user!, isAuthor)) throw new HttpError(403, "Only the author can edit this topic's text.");
      const deniedManagerField = FORUM_TOPIC_MANAGER_ONLY_KEYS.find((k) => body[k] !== undefined && !canModerate(req.user!));
      if (deniedManagerField) throw new HttpError(403, `Only lab managers and admins can change ${deniedManagerField}.`);

      if (body.categoryId !== undefined) {
        const category = await tx.forumCategory.findUnique({ where: { id: body.categoryId } });
        if (!category) throw new HttpError(400, "Selected category does not exist.");
      }
      await assertProjectSelectable(tx, req.user!, body.projectId);

      let resolved: { teamMemberId: string; userId: string }[] | null = null;
      if (body.body !== undefined) {
        resolved = await resolveMentions(tx, body.body);
        // Snapshot BEFORE the edit: a revision holds the OLD title/body (Phase 8 §9).
        await tx.forumPostRevision.create({ data: { postId: existing.id, editorId: req.user!.id, title: existing.title, body: existing.body } });
      }

      const updated = await tx.forumPost.update({
        where: { id: existing.id },
        data: {
          ...(body.title !== undefined && { title: body.title }),
          ...(body.body !== undefined && { body: body.body, editedAt: new Date() }),
          ...(body.projectId !== undefined && { projectId: body.projectId }),
          ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
        },
      });

      if (resolved) {
        const newlyMentioned = await syncMentions(tx, { postId: existing.id }, resolved);
        await notifyMany(tx, newlyMentioned, { type: "FORUM_MENTION", actorId: req.user!.id, entityType: "FORUM_POST", entityId: existing.id, targetPath: topicPath(existing.id), payload: { title: updated.title } });
      }

      const changed = changedFields(existing, body, ["title", "body", "projectId"]);
      if (changed) {
        await recordAudit(tx, { actor: req.user!, action: "FORUM_POST_UPDATED", entityType: "FORUM_POST", entityId: existing.id, details: { title: updated.title, changed } });
      }
      if (body.categoryId !== undefined && body.categoryId !== existing.categoryId) {
        await recordAudit(tx, { actor: req.user!, action: "FORUM_POST_MOVED", entityType: "FORUM_POST", entityId: existing.id, details: { title: updated.title, from: existing.categoryId, to: body.categoryId } });
      }
    });
    res.json(await loadTopicDetail(req.params.id, req.user!, 1, FORUM_COMMENTS_DEFAULT_LIMIT));
  }),
);

// DELETE /api/forum/posts/:id -> soft delete (the author, or a manager). Comments are kept but
// become unreachable through this post's normal endpoints (the post itself now 404s).
router.delete(
  "/posts/:id",
  requireTopicDeleteAccess,
  asyncHandler(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.forumPost.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.status === "DELETED") throw new HttpError(404, "Not found");
      await tx.forumPost.update({ where: { id: existing.id }, data: { status: "DELETED" } });
      await recordAudit(tx, { actor: req.user!, action: "FORUM_POST_DELETED", entityType: "FORUM_POST", entityId: existing.id, details: { title: existing.title, categoryId: existing.categoryId } });
      // Only notify when a MANAGER deleted someone else's topic (Phase 12 §23); an author deleting
      // their own is not a moderation event, and `notify()` already no-ops on self-notification.
      if (existing.authorId && canModerate(req.user!) && existing.authorId !== req.user!.id) {
        await notify(tx, { userId: existing.authorId, type: "FORUM_MODERATION", actorId: req.user!.id, entityType: "FORUM_POST", entityId: existing.id, targetPath: "", payload: { action: "deleted", title: existing.title } });
      }
    });
    res.json({ success: true });
  }),
);

// ---- moderation (pin / lock / hide — lab manager or admin only) -----------------------------
// `notifyLabel`, when given, tells the AUTHOR their content was moderated (Phase 12 §23) — only
// for actions that actually reduce what they or others can do with it (lock, hide, delete).
// Pin/unpin/unlock are reversible and cosmetic: notifying about those would just be noise
// ("Keep this simple" / "Do not build a complex moderation notification workflow" — Phase 12 §23).
async function moderatePost(id: string, actor: SessionActor, patch: Prisma.ForumPostUpdateInput, action: AuditAction, notifyLabel?: string) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.forumPost.findUnique({ where: { id } });
    if (!existing || existing.status === "DELETED") throw new HttpError(404, "Not found");
    await tx.forumPost.update({ where: { id }, data: patch });
    await recordAudit(tx, { actor, action, entityType: "FORUM_POST", entityId: id, details: { title: existing.title } });
    if (notifyLabel && existing.authorId) {
      await notify(tx, { userId: existing.authorId, type: "FORUM_MODERATION", actorId: actor.id, entityType: "FORUM_POST", entityId: id, targetPath: topicPath(id), payload: { action: notifyLabel, title: existing.title } });
    }
  });
}

router.post("/posts/:id/pin", requireCan(canModerate), asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  await moderatePost(req.params.id, req.user!, { pinned: true }, "FORUM_POST_PINNED");
  res.json(await loadTopicDetail(req.params.id, req.user!, 1, FORUM_COMMENTS_DEFAULT_LIMIT));
}));
router.post("/posts/:id/unpin", requireCan(canModerate), asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  await moderatePost(req.params.id, req.user!, { pinned: false }, "FORUM_POST_UNPINNED");
  res.json(await loadTopicDetail(req.params.id, req.user!, 1, FORUM_COMMENTS_DEFAULT_LIMIT));
}));
router.post("/posts/:id/lock", requireCan(canModerate), asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  await moderatePost(req.params.id, req.user!, { locked: true }, "FORUM_POST_LOCKED", "locked");
  res.json(await loadTopicDetail(req.params.id, req.user!, 1, FORUM_COMMENTS_DEFAULT_LIMIT));
}));
router.post("/posts/:id/unlock", requireCan(canModerate), asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  await moderatePost(req.params.id, req.user!, { locked: false }, "FORUM_POST_UNLOCKED");
  res.json(await loadTopicDetail(req.params.id, req.user!, 1, FORUM_COMMENTS_DEFAULT_LIMIT));
}));
// hide/unhide toggle ACTIVE <-> HIDDEN, reversible moderation (never touches DELETED rows).
router.post(
  "/posts/:id/hide",
  requireCan(canModerate),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.forumPost.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.status !== "ACTIVE") throw new HttpError(404, "Not found");
      await tx.forumPost.update({ where: { id: existing.id }, data: { status: "HIDDEN" } });
      await recordAudit(tx, { actor: req.user!, action: "FORUM_POST_HIDDEN", entityType: "FORUM_POST", entityId: existing.id, details: { title: existing.title } });
      if (existing.authorId) {
        await notify(tx, { userId: existing.authorId, type: "FORUM_MODERATION", actorId: req.user!.id, entityType: "FORUM_POST", entityId: existing.id, targetPath: topicPath(existing.id), payload: { action: "hidden", title: existing.title } });
      }
    });
    res.json(await loadTopicDetail(req.params.id, req.user!, 1, FORUM_COMMENTS_DEFAULT_LIMIT));
  }),
);
router.post(
  "/posts/:id/unhide",
  requireCan(canModerate),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.forumPost.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.status !== "HIDDEN") throw new HttpError(404, "Not found");
      await tx.forumPost.update({ where: { id: existing.id }, data: { status: "ACTIVE" } });
      await recordAudit(tx, { actor: req.user!, action: "FORUM_POST_RESTORED", entityType: "FORUM_POST", entityId: existing.id, details: { title: existing.title } });
    });
    res.json(await loadTopicDetail(req.params.id, req.user!, 1, FORUM_COMMENTS_DEFAULT_LIMIT));
  }),
);

// ---------------------------------------------------------------------------
// Comments. Flat (one level, no replies-to-replies — kept deliberately simple in Phase 11).
// ---------------------------------------------------------------------------
async function loadCommentDetail(id: string, viewer: Viewer): Promise<ForumComment | null> {
  const row = await prisma.forumComment.findFirst({
    where: { id, ...visibleForumStatus(viewer) },
    include: { author: { select: { id: true, teamMember: { select: { id: true, name: true, initials: true, isPublished: true } } } } },
  });
  if (!row) return null;
  const reactions = await loadCommentReactions(prisma, [row.id], viewer);
  return toComment(row, viewer, reactions.get(row.id)!);
}

// POST /api/forum/posts/:id/comments -> add a comment (any logged-in member; not on a locked/hidden/missing topic)
router.post(
  "/posts/:id/comments",
  requireCan(canCommentForum),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const body = parseOrThrow(createForumCommentSchema, req.body);
    const commentId = await prisma.$transaction(async (tx) => {
      const post = await tx.forumPost.findFirst({ where: { id: req.params.id, category: visibleTo(req.user!), ...visibleForumStatus(req.user!) } });
      if (!post) throw new HttpError(404, "Not found");
      if (post.locked) throw new HttpError(403, "This topic is locked: new comments are not accepted.");

      const resolved = await resolveMentions(tx, body.body);
      const row = await tx.forumComment.create({ data: { postId: post.id, authorId: req.user!.id, body: body.body } });
      await tx.forumPost.update({ where: { id: post.id }, data: { lastActivityAt: new Date() } });

      const newlyMentioned = await syncMentions(tx, { commentId: row.id }, resolved);
      await notifyMany(tx, newlyMentioned, { type: "FORUM_MENTION", actorId: req.user!.id, entityType: "FORUM_COMMENT", entityId: row.id, targetPath: topicPath(post.id), payload: { title: post.title } });
      if (post.authorId) {
        await notify(tx, { userId: post.authorId, type: "FORUM_COMMENT", actorId: req.user!.id, entityType: "FORUM_POST", entityId: post.id, targetPath: topicPath(post.id), payload: { title: post.title } });
      }
      await recordAudit(tx, { actor: req.user!, action: "FORUM_COMMENT_CREATED", entityType: "FORUM_COMMENT", entityId: row.id, details: { postId: post.id } });
      return row.id;
    });
    res.status(201).json(await loadCommentDetail(commentId, req.user!));
  }),
);

const requireCommentEditAccess = requireEditor(canEditForumComment, isCommentAuthor);
const requireCommentDeleteAccess = requireEditor(canDeleteForumComment, isCommentAuthor);

// PUT /api/forum/comments/:id -> edit own comment text.
router.put(
  "/comments/:id",
  requireCommentEditAccess,
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(updateForumCommentSchema, req.body);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.forumComment.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.status === "DELETED") throw new HttpError(404, "Not found");
      const resolved = await resolveMentions(tx, body.body);
      await tx.forumComment.update({ where: { id: existing.id }, data: { body: body.body, editedAt: new Date() } });
      const newlyMentioned = await syncMentions(tx, { commentId: existing.id }, resolved);
      await notifyMany(tx, newlyMentioned, { type: "FORUM_MENTION", actorId: req.user!.id, entityType: "FORUM_COMMENT", entityId: existing.id, targetPath: topicPath(existing.postId), payload: {} });
      await recordAudit(tx, { actor: req.user!, action: "FORUM_COMMENT_UPDATED", entityType: "FORUM_COMMENT", entityId: existing.id, details: { postId: existing.postId } });
    });
    res.json(await loadCommentDetail(req.params.id, req.user!));
  }),
);

// DELETE /api/forum/comments/:id -> soft delete (the author, or a manager).
router.delete(
  "/comments/:id",
  requireCommentDeleteAccess,
  asyncHandler(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.forumComment.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.status === "DELETED") throw new HttpError(404, "Not found");
      await tx.forumComment.update({ where: { id: existing.id }, data: { status: "DELETED" } });
      await recordAudit(tx, { actor: req.user!, action: "FORUM_COMMENT_DELETED", entityType: "FORUM_COMMENT", entityId: existing.id, details: { postId: existing.postId } });
      if (existing.authorId && canModerate(req.user!) && existing.authorId !== req.user!.id) {
        await notify(tx, { userId: existing.authorId, type: "FORUM_MODERATION", actorId: req.user!.id, entityType: "FORUM_COMMENT", entityId: existing.id, targetPath: topicPath(existing.postId), payload: { action: "deleted", title: "" } });
      }
    });
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Reactions. `userId` in every where-clause is always `req.user!.id` (the acting session), never
// a client-supplied value — a reaction can only ever be added/removed for yourself. Duplicates are
// prevented by the DB's own `@@unique([userId, postId, kind])` / `@@unique([userId, commentId, kind])`.
// ---------------------------------------------------------------------------
function isDuplicateReaction(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

router.post(
  "/posts/:id/reactions",
  requireCan(canReactForum),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { kind } = parseOrThrow(forumReactionInputSchema, req.body);
    await prisma.$transaction(async (tx) => {
      const post = await tx.forumPost.findFirst({ where: { id: req.params.id, category: visibleTo(req.user!), ...visibleForumStatus(req.user!) }, select: { id: true, authorId: true, title: true } });
      if (!post) throw new HttpError(404, "Not found");
      try {
        await tx.forumReaction.create({ data: { userId: req.user!.id, postId: post.id, kind } });
      } catch (err) {
        if (!isDuplicateReaction(err)) throw err;
        return; // already reacted with this kind: idempotent no-op
      }
      if (post.authorId) {
        await notify(tx, { userId: post.authorId, type: "FORUM_REACTION", actorId: req.user!.id, entityType: "FORUM_POST", entityId: post.id, targetPath: topicPath(post.id), payload: { kind, title: post.title } });
      }
    });
    const reactions = await loadPostReactions(prisma, [req.params.id], req.user!);
    res.json(reactions.get(req.params.id));
  }),
);

router.delete(
  "/posts/:id/reactions/:kind",
  requireCan(canReactForum),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const kind = parseOrThrow(forumReactionKindSchema, req.params.kind);
    await prisma.forumReaction.deleteMany({ where: { userId: req.user!.id, postId: req.params.id, kind } });
    const reactions = await loadPostReactions(prisma, [req.params.id], req.user!);
    res.json(reactions.get(req.params.id));
  }),
);

router.post(
  "/comments/:id/reactions",
  requireCan(canReactForum),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { kind } = parseOrThrow(forumReactionInputSchema, req.body);
    await prisma.$transaction(async (tx) => {
      const comment = await tx.forumComment.findFirst({
        where: { id: req.params.id, ...visibleForumStatus(req.user!), post: { category: visibleTo(req.user!) } },
        select: { id: true, authorId: true, postId: true },
      });
      if (!comment) throw new HttpError(404, "Not found");
      try {
        await tx.forumReaction.create({ data: { userId: req.user!.id, commentId: comment.id, kind } });
      } catch (err) {
        if (!isDuplicateReaction(err)) throw err;
        return;
      }
      if (comment.authorId) {
        await notify(tx, { userId: comment.authorId, type: "FORUM_REACTION", actorId: req.user!.id, entityType: "FORUM_COMMENT", entityId: comment.id, targetPath: topicPath(comment.postId), payload: { kind } });
      }
    });
    const reactions = await loadCommentReactions(prisma, [req.params.id], req.user!);
    res.json(reactions.get(req.params.id));
  }),
);

router.delete(
  "/comments/:id/reactions/:kind",
  requireCan(canReactForum),
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const kind = parseOrThrow(forumReactionKindSchema, req.params.kind);
    await prisma.forumReaction.deleteMany({ where: { userId: req.user!.id, commentId: req.params.id, kind } });
    const reactions = await loadCommentReactions(prisma, [req.params.id], req.user!);
    res.json(reactions.get(req.params.id));
  }),
);

export default router;
