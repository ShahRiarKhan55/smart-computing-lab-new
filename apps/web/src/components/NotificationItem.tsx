import { Link } from "react-router-dom";
import type { Notification } from "@scl/shared";
import { Avatar } from "./Avatar";
import { formatDateTime } from "../lib/format";

/** Human-readable text for a notification, from its type + small safe payload — never the
 *  underlying private content (Phase 12 §25/§29: a forum excerpt or message body never
 *  appears here, only a title snapshot for forum events). */
function describe(n: Notification): string {
  const actorName = n.actor?.name ?? "Someone";
  const title = typeof n.payload.title === "string" && n.payload.title ? ` "${n.payload.title}"` : "";
  switch (n.type) {
    case "MESSAGE_RECEIVED":
      return `${actorName} sent you a message.`;
    case "FORUM_MENTION":
      return `${actorName} mentioned you in a forum discussion${title}.`;
    case "FORUM_COMMENT":
      return `${actorName} replied to your discussion${title}.`;
    case "FORUM_REACTION":
      return `${actorName} reacted to your forum post${title}.`;
    case "FORUM_MODERATION": {
      const action = typeof n.payload.action === "string" ? n.payload.action : "moderated";
      return `Your forum topic${title} was ${action} by a moderator.`;
    }
    case "PUBLICATION_LINKED":
      return `A publication was linked to your profile${title}.`;
    case "PROJECT_ACTIVITY":
      return `There's activity on a project you're part of${title}.`;
    default:
      return "You have a new notification.";
  }
}

export function NotificationItem({ notification, onMarkRead }: { notification: Notification; onMarkRead: (id: string) => void }) {
  const body = describe(notification);
  const content = (
    <>
      <Avatar size="sm" initials={notification.actor?.initials ?? "SCL"} photoUrl={notification.actor?.photoUrl || undefined} />
      <div className="notification-item__body">
        <p className="notification-item__text">
          {!notification.read && <span className="sr-only">Unread: </span>}
          {body}
        </p>
        <span className="notification-item__time">{formatDateTime(notification.createdAt)}</span>
      </div>
      {!notification.read && <span className="notification-item__dot" aria-hidden="true" />}
    </>
  );

  const className = `notification-item${notification.read ? "" : " notification-item--unread"}`;

  if (notification.targetPath) {
    return (
      <li>
        <Link to={notification.targetPath} className={className} onClick={() => !notification.read && onMarkRead(notification.id)}>
          {content}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <button type="button" className={`${className} notification-item--plain`} onClick={() => !notification.read && onMarkRead(notification.id)}>
        {content}
      </button>
    </li>
  );
}
