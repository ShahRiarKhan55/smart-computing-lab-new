import { z } from "zod";
import { idSchema, requiredText } from "./common.js";
import { forumAuthorRefSchema, intQueryParam, paginationMetaSchema } from "./forum.js";

/**
 * Private one-to-one messaging (Phase 12), built on the Conversation/ConversationParticipant/
 * Message tables Phase 8 already created (see docs/architecture/phase8-platform-architecture.md
 * §"Private messaging"). ONE-TO-ONE ONLY: every conversation has exactly two participants
 * (`kind` stays "DIRECT"; "GROUP" is reserved for a later phase and is never created here).
 *
 * Server enforces (never the client):
 *   - the authenticated user is always the sender, never a client-supplied id;
 *   - only a participant may read a conversation or its messages (no admin/manager override —
 *     see canModerate's absence from this file: management roles have NO extra reach here);
 *   - a user cannot message themselves;
 *   - the target of "start a conversation" is a TeamMember id (the same public-safe id every
 *     PersonLink/mention already uses), resolved server-side to the linked account, exactly
 *     like forum @mentions (see lib/forumMentions.ts) — an account id never appears in a request.
 */

export const MESSAGE_BODY_MAX = 4000;
export const messageBodySchema = requiredText("Message", MESSAGE_BODY_MAX);

export const CONVERSATIONS_DEFAULT_LIMIT = 20;
export const CONVERSATIONS_MAX_LIMIT = 50;
export const MESSAGES_DEFAULT_LIMIT = 30;
export const MESSAGES_MAX_LIMIT = 100;
const MAX_PAGE = 10000;

export const conversationsQuerySchema = z.object({
  page: intQueryParam("Page", 1, MAX_PAGE, 1),
  limit: intQueryParam("Limit", 1, CONVERSATIONS_MAX_LIMIT, CONVERSATIONS_DEFAULT_LIMIT),
});
export type ConversationsQuery = z.infer<typeof conversationsQuerySchema>;

export const messagesQuerySchema = z.object({
  page: intQueryParam("Page", 1, MAX_PAGE, 1),
  limit: intQueryParam("Limit", 1, MESSAGES_MAX_LIMIT, MESSAGES_DEFAULT_LIMIT),
});
export type MessagesQuery = z.infer<typeof messagesQuerySchema>;

/** Reuses the same {teamMemberId, name, initials} shape as a forum author — a generic
 *  "account as the public API shows it" ref, never the account id. */
export const messageParticipantSchema = forumAuthorRefSchema.extend({
  photoUrl: z.string(),
});
export type MessageParticipantRef = z.infer<typeof messageParticipantSchema>;

export const messageSchema = z.object({
  id: z.string(),
  /** True when the CURRENT viewer sent this message (never the other participant's identity). */
  mine: z.boolean(),
  /** "" once the message has been deleted; the row is kept so ordering/tombstone still render. */
  body: z.string(),
  deleted: z.boolean(),
  editedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

export const conversationSummarySchema = z.object({
  id: z.string(),
  other: messageParticipantSchema,
  /** Short plain-text preview of the latest message, or "" if none yet / it was deleted. */
  lastMessagePreview: z.string(),
  lastMessageAt: z.string().nullable(),
  unread: z.boolean(),
  unreadCount: z.number(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema),
  pagination: paginationMetaSchema,
});
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

export const conversationDetailSchema = z.object({
  id: z.string(),
  other: messageParticipantSchema,
  messages: z.array(messageSchema),
  messagesPagination: paginationMetaSchema,
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

// ---- write shapes -----------------------------------------------------------------
/** Start (or reuse) a direct conversation with this TeamMember. */
export const createConversationSchema = z.object({ teamMemberId: idSchema });
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const createMessageSchema = z.object({ body: messageBodySchema });
export type CreateMessageInput = z.infer<typeof createMessageSchema>;
