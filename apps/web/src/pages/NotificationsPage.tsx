import { useSearchParams } from "react-router-dom";
import type { NotificationListResponse } from "@scl/shared";
import { useApiResource } from "../hooks/useApiResource";
import { apiFetch } from "../lib/api";
import { useNotifications } from "../notifications/NotificationsContext";
import { PageHeader } from "../components/PageHeader";
import { LoadingState } from "../components/LoadingState";
import { ErrorState } from "../components/ErrorState";
import { NotificationList } from "../components/NotificationList";

/** /notifications — the current user's own notifications, and nothing else (Phase 12 §24/§25). */
export function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const page = /^\d{1,5}$/.test(params.get("page") ?? "") ? Number(params.get("page")) : 1;
  const { refresh: refreshUnreadCount } = useNotifications();

  const { data, loading, error, reload } = useApiResource<NotificationListResponse>(`/notifications?page=${page}&limit=20`);

  async function markRead(id: string) {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
      reload();
      refreshUnreadCount();
    } catch {
      // Best-effort: the notification still opens its target even if marking it read fails.
    }
  }

  async function markAllRead() {
    await apiFetch("/notifications/read-all", { method: "POST" });
    reload();
    refreshUnreadCount();
  }

  const hasUnread = Boolean(data?.notifications.some((n) => !n.read));

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Notifications"
        description="Messages, forum replies, mentions and moderation updates."
        actions={
          hasUnread && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={markAllRead}>
              Mark all as read
            </button>
          )
        }
      />
      <div className="container container--narrow">
        {loading && !data ? (
          <LoadingState label="Loading notifications…" variant="list" />
        ) : error && !data ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          data && <NotificationList notifications={data.notifications} pagination={data.pagination} onMarkRead={markRead} onPageChange={(p) => setParams(p > 1 ? { page: String(p) } : {})} />
        )}
      </div>
    </>
  );
}
