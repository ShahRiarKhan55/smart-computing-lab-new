import type { Notification, NotificationType } from "@scl/shared";
import { toMessageParticipant } from "./messagingSerializers.js";

type NotificationRow = {
  id: string;
  type: string;
  actor: { teamMember: { id: string; name: string; initials: string; photoUrl: string } | null } | null;
  targetPath: string;
  payload: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/** A Notification row as the API shows it. Never the recipient's or actor's account id;
 *  `payload` is parsed back from the small JSON snapshot `notify()` wrote (never a message body —
 *  see the FORBIDDEN_KEY guard applied to audit details for the same principle). */
export function toNotification(row: NotificationRow): Notification {
  let payload: Notification["payload"] = {};
  if (row.payload) {
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = {};
    }
  }
  return {
    id: row.id,
    type: row.type as NotificationType,
    actor: row.actor ? toMessageParticipant(row.actor) : null,
    targetPath: row.targetPath,
    payload,
    read: Boolean(row.readAt),
    createdAt: row.createdAt.toISOString(),
  };
}
