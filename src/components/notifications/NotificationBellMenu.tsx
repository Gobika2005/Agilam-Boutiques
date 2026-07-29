import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useNotifications } from '@/state/NotificationContext';

/**
 * Bell icon, shared by the buyer, seller and admin headers so the three
 * consoles read one live notification stream instead of three separate bells.
 * Tapping it opens the full inbox page directly (no dropdown). `viewAllTo` is
 * the inbox route each console already has: /notifications,
 * /seller/notifications, /admin/notifications.
 */
export function NotificationBellMenu({ viewAllTo }: { viewAllTo: string; orderBasePath?: string }) {
  const navigate = useNavigate();
  const { unreadCount } = useNotifications();

  return (
    <button
      onClick={() => navigate(viewAllTo)}
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      title="Notifications"
      style={css('position:relative;width:44px;height:44px;flex:none;border-radius:14px;border:1px solid var(--ag-border-soft);background:var(--ag-surface);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px -16px rgba(107,20,54,.7);')}
    >
      <span style={css("font-family:'Material Symbols Outlined';font-size:23px;color:var(--ag-crimson);")}>notifications</span>
      {unreadCount > 0 && (
        <span style={css('position:absolute;top:-5px;right:-5px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:#D6336C;color:#fff;font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid var(--ag-bg);')}>
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}

/** Unread chat count from the same stream (type === 'Messages') — for badging the existing bottom-dock Messages tab instead of a second, redundant header icon. */
export function useUnreadMessageCount() {
  const { items } = useNotifications();
  return items.filter((n) => n.type === 'Messages' && !n.read).length;
}
