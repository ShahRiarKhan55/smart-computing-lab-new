import type { Notification, NotificationType } from "@scl/shared";
import { toMessageParticipant } from "./messagingSerializers.js";
import { identityVisible, MASKED_NAME } from "./hiddenPeople.js";
import type { Viewer } from "./visibility.js";

type NotificationRow = {
  id: string;
  type: string;
  actor: { id?: string; teamMember: { id: string; name: string; initials: string; photoUrl: string; isPublished?: boolean } | null } | null;
  targetPath: string;
  payload: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/**
 * An unpublished member's identity is masked like the public content the notification points at ("Lab member", no profile id), for
 * everyone except managers and that member. The one exception is a DIRECT message: its recipient is a participant of a private thread
 * with the sender, so the sender stays visible there (the thread itself already shows them).
 */
function actorFor(row: NotificationRow, viewer: Viewer) {
  const actor = row.actor!;
  if (row.type === "MESSAGE_RECEIVED" || !actor.teamMember || identityVisible(viewer, actor.teamMember, actor.id)) return toMessageParticipant(actor);
  return { teamMemberId: null, name: MASKED_NAME, initials: "—", photoUrl: "" };
}

/** A Notification row as the API shows it. Never the recipient's or actor's account id;
 *  `payload` is parsed back from the small JSON snapshot `notify()` wrote (never a message body —
 *  see the FORBIDDEN_KEY guard applied to audit details for the same principle). */
export function toNotification(row: NotificationRow, viewer: Viewer = null): Notification {
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
    actor: row.actor ? actorFor(row, viewer) : null,
    targetPath: row.targetPath,
    payload,
    read: Boolean(row.readAt),
    createdAt: row.createdAt.toISOString(),
  };
}
