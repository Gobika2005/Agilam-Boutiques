import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthContext';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeToNotifications,
  type NotificationRow,
} from '@/data/notifications';

/**
 * One shared notification stream for buyer, seller and admin alike — all three
 * read/write the same `notifications` table keyed on `profile_id`, so a single
 * provider mounted once at the app root (next to PresenceTracker) covers every
 * header bell instead of three separate copies polling the same data.
 */

type NotificationContextValue = {
  items: NotificationRow[];
  unreadCount: number;
  loading: boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  reload: () => Promise<void>;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const profileId = profile?.id ?? null;
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!profileId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      setItems(await fetchNotifications(profileId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    if (!profileId) return;
    return subscribeToNotifications(profileId, (row) => {
      setItems((prev) => [row, ...prev.filter((n) => n.id !== row.id)]);
    });
  }, [profileId]);

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await markNotificationRead(id);
    } catch {
      /* the badge will resync on the next reload */
    }
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    if (!profileId) return;
    try {
      await markAllNotificationsRead(profileId);
    } catch {
      /* the badge will resync on the next reload */
    }
  };

  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider value={{ items, unreadCount, loading, markRead, markAllRead, reload: load }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
