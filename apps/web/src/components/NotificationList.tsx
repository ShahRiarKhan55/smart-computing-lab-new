import type { Notification, PaginationMeta } from "@scl/shared";
import { NotificationItem } from "./NotificationItem";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";

interface NotificationListProps {
  notifications: Notification[];
  pagination: PaginationMeta;
  onMarkRead: (id: string) => void;
  onPageChange: (page: number) => void;
}

export function NotificationList({ notifications, pagination, onMarkRead, onPageChange }: NotificationListProps) {
  if (pagination.total === 0) {
    return <EmptyState title="No notifications yet.">You'll see messages, forum replies and mentions here.</EmptyState>;
  }

  return (
    <>
      <ul className="notification-list">
        {notifications.map((n) => (
          <NotificationItem key={n.id} notification={n} onMarkRead={onMarkRead} />
        ))}
      </ul>
      {pagination.totalPages > 1 && (
        <nav className="search-pager" aria-label="Notification pages">
          {pagination.page > 1 ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => onPageChange(pagination.page - 1)}>
              <Icon name="arrow-left" size={14} /> Previous
            </button>
          ) : (
            <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
              <Icon name="arrow-left" size={14} /> Previous
            </span>
          )}
          <span className="search-pager__pos">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          {pagination.page < pagination.totalPages ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => onPageChange(pagination.page + 1)}>
              Next <Icon name="arrow-right" size={14} />
            </button>
          ) : (
            <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
              Next <Icon name="arrow-right" size={14} />
            </span>
          )}
        </nav>
      )}
    </>
  );
}
