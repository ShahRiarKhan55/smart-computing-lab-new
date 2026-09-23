import { z } from "zod";
import { intQueryParam, paginationMetaSchema } from "./forum.js";
import { messageParticipantSchema } from "./messages.js";

/**
 * The Notification table Phase 8 already created, now surfaced as a real API + UI (Phase 12).
 * `type` is the single source of truth for the value set: the server's notification service
 * (src/lib/notify.ts) imports it from here rather than declaring its own, so a new type is
 * added in exactly one place.
 *
 * Privacy (Phase 12 §24): a user may only ever retrieve/modify THEIR OWN notifications. There
 * is no admin/manager override and no client-supplied recipient — the server always derives the
 * recipient from the session, the same rule messaging follows for the sender.
 */
export const NOTIFICATION_TYPES = [
  "MESSAGE_RECEIVED",
  "FORUM_MENTION",
  "FORUM_COMMENT",
  "FORUM_REACTION",
  "FORUM_MODERATION",
  "PUBLICATION_LINKED",
  "PROJECT_ACTIVITY",
  "ANNOUNCEMENT",
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES, {
  errorMap: () => ({ message: `Notification type must be one of: ${NOTIFICATION_TYPES.join(", ")}.` }),
});
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const NOTIFICATIONS_DEFAULT_LIMIT = 20;
export const NOTIFICATIONS_MAX_LIMIT = 50;
const MAX_PAGE = 10000;

export const notificationsQuerySchema = z.object({
  page: intQueryParam("Page", 1, MAX_PAGE, 1),
  limit: intQueryParam("Limit", 1, NOTIFICATIONS_MAX_LIMIT, NOTIFICATIONS_DEFAULT_LIMIT),
  /** "unread" narrows the list; omitted returns every notification (read and unread). */
  filter: z.enum(["all", "unread"]).optional().default("all"),
});
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;

/** A small, non-sensitive payload snapshot (e.g. a post title, a reaction kind) — never a
 *  message body or other private free text; see the FORBIDDEN_KEY guard in lib/audit.ts for
 *  the same rule applied to audit details. */
export type NotificationPayload = Record<string, string | number | boolean | null>;

export const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  /** null for a system notification with no acting account. */
  actor: messageParticipantSchema.nullable(),
  /** Safe, app-relative link to the relevant content, or "" when there is nothing to link to. */
  targetPath: z.string(),
  payload: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  read: z.boolean(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  pagination: paginationMetaSchema,
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const unreadCountResponseSchema = z.object({ count: z.number() });
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;
