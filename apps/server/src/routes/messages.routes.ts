import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  conversationsQuerySchema,
  createConversationSchema,
  createMessageSchema,
  messagesQuerySchema,
  type ConversationDetail,
  type ConversationListResponse,
  type Message,
} from "@scl/shared";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseOrThrow, HttpError } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { assertValidId } from "../lib/authorLinks.js";
import { paginate } from "../lib/forumSerializers.js";
import { countUnread, toConversationSummary, toMessage, toMessageParticipant } from "../lib/messagingSerializers.js";
import { notify } from "../lib/notify.js";

const router = Router();

const conversationPath = (id: string) => `/messages/${id}`;

/**
 * Every conversation endpoint below re-derives access from `ConversationParticipant`, never from
 * the URL alone: a conversation that exists but the caller does not belong to answers 404 (Phase
 * 12 §11) — the same "don't reveal it exists" convention the forum uses for a category a guest
 * cannot see. There is NO manager/admin override anywhere in this file.
 */
async function loadOwnParticipant(conversationId: string, userId: string) {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!participant) throw new HttpError(404, "Not found");
  return participant;
}

// ---------------------------------------------------------------------------
// GET /api/messages/conversations -> the caller's own conversations, most recent first.
// Never loads full message history here — only a preview of the latest message (Phase 12 §12/§47).
// ---------------------------------------------------------------------------
router.get(
  "/conversations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, limit } = parseOrThrow(conversationsQuerySchema, req.query);
    const userId = req.user!.id;

    const where: Prisma.ConversationParticipantWhereInput = { userId, archivedAt: null };
    const total = await prisma.conversationParticipant.count({ where });
    const rows = await prisma.conversationParticipant.findMany({
      where,
      orderBy: [{ conversation: { lastMessageAt: "desc" } }, { conversationId: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        conversation: {
          include: {
            participants: {
              where: { userId: { not: userId } },
              include: { user: { select: { teamMember: { select: { id: true, name: true, initials: true, photoUrl: true } } } } },
            },
            messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, deletedAt: true } },
          },
        },
      },
    });

    const conversations = await Promise.all(
      rows.map(async (p) => {
        const other = p.conversation.participants[0]?.user ?? null;
        // Skip the count query entirely for a conversation with no messages at all.
        const unreadCount = p.conversation.lastMessageAt ? await countUnread(prisma, p.conversationId, userId, p.lastReadAt) : 0;
        return toConversationSummary(toMessageParticipant(other), p.conversation, p.conversation.messages[0] ?? null, unreadCount);
      }),
    );

    const response: ConversationListResponse = { conversations, pagination: paginate(page, limit, total) };
    res.json(response);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/messages/conversations -> start (or reuse) a direct conversation with a TeamMember.
// The target is a public-safe TeamMember id, resolved to its account server-side — exactly like a
// forum @mention (see lib/forumMentions.ts) — never an account id from the client.
// ---------------------------------------------------------------------------
router.post(
  "/conversations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { teamMemberId } = parseOrThrow(createConversationSchema, req.body);
    const target = await prisma.teamMember.findUnique({ where: { id: teamMemberId }, select: { userId: true } });
    if (!target?.userId) throw new HttpError(404, "Not found");
    if (target.userId === req.user!.id) throw new HttpError(400, "You can't start a conversation with yourself.");

    const conversation = await getOrCreateDirectConversation(req.user!.id, target.userId);
    res.status(201).json(await loadConversationDetail(conversation.id, req.user!.id, 1, 30));
  }),
);

/**
 * Race-safe "one direct conversation per pair" (Phase 12 §10): `directKey` is the two participant
 * ids sorted and joined, with a UNIQUE index (see schema.prisma). Two concurrent requests both
 * attempt the create; the loser's insert fails the unique constraint and it simply re-reads the
 * winner's row, rather than a check-then-create that a race could still duplicate.
 */
async function getOrCreateDirectConversation(userIdA: string, userIdB: string) {
  const directKey = [userIdA, userIdB].sort().join(":");
  try {
    return await prisma.conversation.create({
      data: { directKey, participants: { create: [{ userId: userIdA }, { userId: userIdB }] } },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.conversation.findUnique({ where: { directKey } });
      if (existing) return existing;
    }
    throw err;
  }
}

async function loadConversationDetail(conversationId: string, viewerId: string, page: number, limit: number): Promise<ConversationDetail> {
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: {
      participants: {
        where: { userId: { not: viewerId } },
        include: { user: { select: { teamMember: { select: { id: true, name: true, initials: true, photoUrl: true } } } } },
      },
    },
  });
  const other = toMessageParticipant(conversation.participants[0]?.user ?? null);

  const total = await prisma.message.count({ where: { conversationId } });
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  });
  const messages: Message[] = rows.map((r) => toMessage(r, viewerId)).reverse(); // chronological order for display

  return { id: conversation.id, other, messages, messagesPagination: paginate(page, limit, total) };
}

// ---------------------------------------------------------------------------
// GET /api/messages/conversations/:id -> message history (paginated; newest page by default).
// ---------------------------------------------------------------------------
router.get(
  "/conversations/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { page, limit } = parseOrThrow(messagesQuerySchema, req.query);
    await loadOwnParticipant(req.params.id, req.user!.id);
    res.json(await loadConversationDetail(req.params.id, req.user!.id, page, limit));
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/messages/conversations/:id/read -> mark everything in this conversation read so far.
// Idempotent: repeating it is always safe (Phase 12 §18/§32).
// ---------------------------------------------------------------------------
router.patch(
  "/conversations/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await loadOwnParticipant(req.params.id, req.user!.id);
    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: req.params.id, userId: req.user!.id } },
      data: { lastReadAt: new Date() },
    });
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/messages/conversations/:id/messages -> send a message. Sender is always the session.
// ---------------------------------------------------------------------------
router.post(
  "/conversations/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { body } = parseOrThrow(createMessageSchema, req.body);
    await loadOwnParticipant(req.params.id, req.user!.id);

    const message = await prisma.$transaction(async (tx) => {
      const other = await tx.conversationParticipant.findFirst({ where: { conversationId: req.params.id, userId: { not: req.user!.id } } });
      const row = await tx.message.create({ data: { conversationId: req.params.id, senderId: req.user!.id, body } });
      await tx.conversation.update({ where: { id: req.params.id }, data: { lastMessageAt: row.createdAt } });
      if (other) {
        await notify(tx, {
          userId: other.userId,
          type: "MESSAGE_RECEIVED",
          actorId: req.user!.id,
          entityType: "CONVERSATION",
          entityId: req.params.id,
          targetPath: conversationPath(req.params.id),
        });
      }
      return row;
    });

    res.status(201).json(toMessage(message, req.user!.id));
  }),
);

// ---------------------------------------------------------------------------
// PUT/DELETE /api/messages/messages/:id -> author only, ever. Not the other participant, not a
// manager, not an admin (Phase 12 §16/§17: no role gains message-edit/delete permission).
// ---------------------------------------------------------------------------
async function loadOwnMessage(id: string, userId: string) {
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message || message.deletedAt) throw new HttpError(404, "Not found");
  if (message.senderId !== userId) throw new HttpError(403, "Forbidden");
  return message;
}

router.put(
  "/messages/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    const { body } = parseOrThrow(createMessageSchema, req.body);
    await loadOwnMessage(req.params.id, req.user!.id);
    const updated = await prisma.message.update({ where: { id: req.params.id }, data: { body, editedAt: new Date() } });
    res.json(toMessage(updated, req.user!.id));
  }),
);

router.delete(
  "/messages/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertValidId(req.params.id);
    await loadOwnMessage(req.params.id, req.user!.id);
    // Body is blanked at deletion time (schema.prisma "Private messaging" note): the row stays for
    // ordering and a "message deleted" tombstone, but nothing private lingers in the database.
    const updated = await prisma.message.update({ where: { id: req.params.id }, data: { body: "", deletedAt: new Date() } });
    res.json(toMessage(updated, req.user!.id));
  }),
);

export default router;
