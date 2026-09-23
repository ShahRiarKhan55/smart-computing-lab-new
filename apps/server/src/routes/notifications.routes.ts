import { Router } from "express";
import { notificationsQuerySchema, type NotificationListResponse, type UnreadCountResponse } from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { assertValidId } from "../lib/authorLinks.js";
import { paginate } from "../lib/forumSerializers.js";
import { toNotification } from "../lib/notificationSerializers.js";

const router = Router();

/**
 * A user's own notifications, and nothing else (Phase 12 §24). Every query below is scoped to
 * `userId: req.user!.id` — there is no admin/manager override and the client never supplies a
 * recipient id (a `?userId=` query param, if sent, is simply ignored: the session decides).
 */

// GET /api/notifications -> the caller's own notifications, newest first.
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, filter } = parseOrThrow(notificationsQuerySchema, req.query);
    const where = { userId: req.user!.id, ...(filter === "unread" ? { readAt: null } : {}) };
    const total = await prisma.notification.count({ where });
    const rows = await prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: { actor: { select: { teamMember: { select: { id: true, name: true, initials: true, photoUrl: true } } } } },
    });
    const response: NotificationListResponse = {
      notifications: rows.map(toNotification),
      pagination: paginate(page, limit, total),
    };
    res.json(response);
  }),
);

// GET /api/notifications/unread-count -> an efficient count query, never the full list.
router.get(
  "/unread-count",
  requireAuth,
  asyncHandler(async (req, res) => {
    const count = await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } });
    const response: UnreadCountResponse = { count };
    res.json(response);
  }),
);

// PATCH /api/notifications/:id/read -> mark one of the caller's own notifications read. An id that
// does not exist, or belongs to someone else, gets the same 404 either way (never reveal which).
router.patch(
  "/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { count } = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { readAt: new Date() },
    });
    if (count === 0) throw new HttpError(404, "Not found");
    res.json({ success: true });
  }),
);

// POST /api/notifications/read-all -> mark every unread notification of the caller's own read.
router.post(
  "/read-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
    res.json({ success: true });
  }),
);

export default router;
