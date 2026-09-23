import { Link } from "react-router-dom";
import type { Notification } from "@scl/shared";
import { Avatar } from "./Avatar";
import { formatDateTime } from "../lib/format";
import { useLocale } from "../i18n/LocaleContext";
import type { TranslationKey } from "@scl/shared";

const ACTION_LABEL_KEY: Record<string, TranslationKey> = {
  hidden: "notifications.action.hidden",
  deleted: "notifications.action.deleted",
  locked: "notifications.action.locked",
  moderated: "notifications.action.moderated",
};

/** Human-readable text for a notification, from its type + small safe payload — never the
 *  underlying private content (Phase 12 §25/§29: a forum excerpt or message body never
 *  appears here, only a title snapshot for forum events). */
function describe(n: Notification, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  const actorName = n.actor?.name ?? t("notifications.someone");
  const rawTitle = typeof n.payload.title === "string" && n.payload.title ? n.payload.title : "";
  const title = rawTitle ? ` ${t("notifications.quotedTitle", { title: rawTitle })}` : "";
  switch (n.type) {
    case "MESSAGE_RECEIVED":
      return t("notifications.sentMessage", { actor: actorName });
    case "FORUM_MENTION":
      return t("notifications.mentionedYou", { actor: actorName, title });
    case "FORUM_COMMENT":
      return t("notifications.repliedToDiscussion", { actor: actorName, title });
    case "FORUM_REACTION":
      return t("notifications.reactedToPost", { actor: actorName, title });
    case "FORUM_MODERATION": {
      const actionKey = typeof n.payload.action === "string" ? (ACTION_LABEL_KEY[n.payload.action] ?? "notifications.action.moderated") : "notifications.action.moderated";
      return t("notifications.topicModerated", { title, action: t(actionKey) });
    }
    case "PUBLICATION_LINKED":
      return t("notifications.publicationLinked", { title });
    case "PROJECT_ACTIVITY":
      return t("notifications.projectActivity", { title });
    default:
      return t("notifications.generic");
  }
}

export function NotificationItem({ notification, onMarkRead }: { notification: Notification; onMarkRead: (id: string) => void }) {
  const { locale, t } = useLocale();
  const body = describe(notification, t);
  const content = (
    <>
      <Avatar size="sm" initials={notification.actor?.initials ?? "SCL"} photoUrl={notification.actor?.photoUrl || undefined} />
      <div className="notification-item__body">
        <p className="notification-item__text">
          {!notification.read && <span className="sr-only">{t("notifications.unreadSr")}</span>}
          {body}
        </p>
        <span className="notification-item__time">{formatDateTime(notification.createdAt, locale)}</span>
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
