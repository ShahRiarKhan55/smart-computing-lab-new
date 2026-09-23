/** "Notifications (3)" — an unread count next to a nav link. Text, never colour alone (Phase 12
 *  §26/§41), and capped so a big backlog doesn't stretch the menu. */
export function NotificationBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="notification-badge" aria-hidden="true">
      {count > 99 ? "99+" : count}
    </span>
  );
}
