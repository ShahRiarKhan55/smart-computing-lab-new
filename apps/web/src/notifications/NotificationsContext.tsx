import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { UnreadCountResponse } from "@scl/shared";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";

interface NotificationsContextValue {
  /** 0 for a guest, or while the count has not loaded yet. */
  unreadCount: number;
  /** Re-fetches the count — call after visiting /notifications, marking one/all read, or after
   *  any action that could have changed it. This app is REST-only (Phase 12 §53): there is no
   *  live push, so the badge is only ever as fresh as the last refresh. */
  refresh: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    try {
      const data = await apiFetch<UnreadCountResponse>("/notifications/unread-count");
      setUnreadCount(data.count);
    } catch {
      // A transient failure just leaves the last-known count; the notifications page itself
      // shows a real error state if the user goes looking.
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => ({ unreadCount, refresh }), [unreadCount, refresh]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within a NotificationsProvider");
  return ctx;
}
