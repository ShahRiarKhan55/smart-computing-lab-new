import type { Notification, PaginationMeta } from "@scl/shared";
import { NotificationItem } from "./NotificationItem";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { useT } from "../i18n/LocaleContext";

interface NotificationListProps {
  notifications: Notification[];
  pagination: PaginationMeta;
  onMarkRead: (id: string) => void;
  onPageChange: (page: number) => void;
}

export function NotificationList({ notifications, pagination, onMarkRead, onPageChange }: NotificationListProps) {
  const t = useT();
  if (pagination.total === 0) {
    return <EmptyState title={t("notifications.empty")}>{t("notifications.emptyBody")}</EmptyState>;
  }

  return (
    <>
      <ul className="notification-list">
        {notifications.map((n) => (
          <NotificationItem key={n.id} notification={n} onMarkRead={onMarkRead} />
        ))}
      </ul>
      {pagination.totalPages > 1 && (
        <nav className="search-pager" aria-label={t("notifications.pagesAria")}>
          {pagination.page > 1 ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => onPageChange(pagination.page - 1)}>
              <Icon name="arrow-left" size={14} /> {t("common.previous")}
            </button>
          ) : (
            <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
              <Icon name="arrow-left" size={14} /> {t("common.previous")}
            </span>
          )}
          <span className="search-pager__pos">{t("common.pageOf", { page: pagination.page, total: pagination.totalPages })}</span>
          {pagination.page < pagination.totalPages ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => onPageChange(pagination.page + 1)}>
              {t("common.next")} <Icon name="arrow-right" size={14} />
            </button>
          ) : (
            <span className="btn btn--secondary btn--sm is-disabled" aria-disabled="true">
              {t("common.next")} <Icon name="arrow-right" size={14} />
            </span>
          )}
        </nav>
      )}
    </>
  );
}
