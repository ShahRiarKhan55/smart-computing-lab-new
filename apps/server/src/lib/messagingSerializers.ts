import type { Prisma, PrismaClient } from "@prisma/client";
import type { ConversationSummary, Message, MessageParticipantRef } from "@scl/shared";

type MessagingDb = Prisma.TransactionClient | PrismaClient;

const PREVIEW_MAX = 80;

/** First ~80 characters of a message body, for a conversation-list preview. Never the full body. */
export function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX).trimEnd()}…` : flat;
}

/**
 * An account as the public API shows it for messaging/notifications — the same
 * {teamMemberId, name, initials} shape as a forum author (see toForumAuthor), plus a photo for
 * the avatar. Never includes the account id.
 */
export function toMessageParticipant(user: { teamMember: { id: string; name: string; initials: string; photoUrl: string } | null } | null): MessageParticipantRef {
  if (!user) return { teamMemberId: null, name: "Former member", initials: "—", photoUrl: "" };
  if (user.teamMember) return { teamMemberId: user.teamMember.id, name: user.teamMember.name, initials: user.teamMember.initials, photoUrl: user.teamMember.photoUrl };
  return { teamMemberId: null, name: "Lab member", initials: "—", photoUrl: "" };
}

export function toMessage(row: { id: string; senderId: string | null; body: string; deletedAt: Date | null; editedAt: Date | null; createdAt: Date }, viewerId: string): Message {
  return {
    id: row.id,
    mine: row.senderId === viewerId,
    body: row.deletedAt ? "" : row.body,
    deleted: Boolean(row.deletedAt),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Number of messages from the OTHER participant, newer than `lastReadAt`, excluding the viewer's
 * own — a participant is never "unread" on their own messages, even before they have ever called
 * the read endpoint (`lastReadAt: null`). This is the single source of truth for "unread": it
 * would be wrong to instead compare `conversation.lastMessageAt` against the viewer's own
 * `lastReadAt` directly, because that also counts as "unread" the viewer's own latest message
 * (they trivially haven't "read" something they just sent, but it should never show as unread).
 */
export async function countUnread(db: MessagingDb, conversationId: string, viewerId: string, lastReadAt: Date | null): Promise<number> {
  return db.message.count({
    where: {
      conversationId,
      senderId: { not: viewerId },
      deletedAt: null,
      ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
    },
  });
}

export function toConversationSummary(
  other: MessageParticipantRef,
  row: { id: string; lastMessageAt: Date | null },
  lastMessage: { body: string; deletedAt: Date | null } | null,
  unreadCount: number,
): ConversationSummary {
  return {
    id: row.id,
    other,
    lastMessagePreview: lastMessage && !lastMessage.deletedAt ? previewOf(lastMessage.body) : "",
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    unread: unreadCount > 0,
    unreadCount,
  };
}
