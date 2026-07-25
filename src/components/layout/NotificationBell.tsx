import { useLocation, useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { countUnreadNotifications } from '@/data/notifications';

/**
 * Header notification bell with an unread badge.
 *
 * Lives in the AppBar so alerts are one tap from anywhere in the console. The
 * count is re-read on every navigation (the `pathname` dep), so opening the
 * Notifications page and reading an alert clears the badge without a reload.
 */
export function NotificationBell({ to }: { to: string }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { profile } = useAuth();
  const { data: unread } = useAsync(
    () => (profile ? countUnreadNotifications(profile.id) : Promise.resolve(0)),
    [profile?.id, pathname],
  );
  const count = unread ?? 0;

  return (
    <button
      onClick={() => navigate(to)}
      aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      title="Notifications"
      style={css('position:relative;width:44px;height:44px;flex:none;border-radius:14px;border:1px solid var(--ag-border-soft);background:var(--ag-surface);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px -16px rgba(107,20,54,.7);')}
    >
      <span style={css("font-family:'Material Symbols Outlined';font-size:23px;color:var(--ag-crimson);")}>notifications</span>
      {count > 0 && (
        <span style={css('position:absolute;top:-5px;right:-5px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:#D6336C;color:#fff;font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid var(--ag-bg);')}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
