import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useNotifications } from '@/state/NotificationContext';
import type { NotificationRow } from '@/data/notifications';

const ICON: Record<string, { icon: string; tint: string; ic: string }> = {
  Orders: { icon: 'shopping_bag', tint: 'var(--ag-surface-2)', ic: '#D6336C' },
  Messages: { icon: 'chat_bubble', tint: 'var(--ag-info-bg)', ic: 'var(--ag-info-text)' },
  Updates: { icon: 'notifications', tint: 'var(--ag-purple-bg)', ic: '#9B7FC7' },
  Wishlist: { icon: 'favorite', tint: 'var(--ag-gold-bg)', ic: 'var(--ag-gold-text)' },
};

const relTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h';
  return Math.round(h / 24) + 'd';
};

/**
 * Bell icon + dropdown, shared by the buyer, seller and admin headers so the
 * three consoles read one live notification stream instead of three separate
 * bells. `viewAllTo` is the full inbox route each console already has (or
 * gets from this feature): /notifications, /seller/notifications,
 * /admin/notifications.
 */
export function NotificationBellMenu({ viewAllTo, orderBasePath }: { viewAllTo: string; orderBasePath?: string }) {
  const navigate = useNavigate();
  const { items, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);

  const open8 = items.slice(0, 8);

  const openRow = async (n: NotificationRow) => {
    if (!n.read) await markRead(n.id);
    setOpen(false);
    if (n.order_id && orderBasePath) navigate(`${orderBasePath}/orders/${encodeURIComponent(n.order_id)}`);
    else navigate(viewAllTo);
  };

  return (
    <div style={css('position:relative;')}>
      <button
        onClick={() => setOpen((o) => !o)}
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

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={css('position:fixed;inset:0;z-index:60;background:transparent;')} />
          <div
            style={css(
              'position:absolute;top:52px;right:0;z-index:61;width:min(340px,calc(100vw - 24px));max-height:70vh;overflow-y:auto;background:var(--ag-surface);border:1px solid var(--ag-border-soft);border-radius:18px;box-shadow:0 26px 60px -22px var(--ag-shadow);',
            )}
          >
            <div style={css('display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;')}>
              <span style={css('font-weight:800;font-size:14px;')}>Notifications</span>
              {unreadCount > 0 && (
                <button onClick={() => markAllRead()} style={css('border:none;background:none;cursor:pointer;color:var(--ag-crimson);font-size:12px;font-weight:700;')}>
                  Mark all read
                </button>
              )}
            </div>

            {open8.length === 0 && (
              <div style={css('padding:10px 16px 20px;color:var(--ag-muted);font-size:13px;')}>You're all caught up.</div>
            )}

            <div style={css('display:flex;flex-direction:column;gap:2px;padding:0 8px 8px;')}>
              {open8.map((n) => {
                const s = ICON[n.type] ?? ICON.Updates;
                return (
                  <div
                    key={n.id}
                    onClick={() => openRow(n)}
                    style={css(`display:flex;gap:10px;align-items:flex-start;padding:9px 8px;border-radius:12px;cursor:pointer;background:${n.read ? 'transparent' : 'var(--ag-surface-2)'};`)}
                  >
                    <div style={css(`width:32px;height:32px;flex:none;border-radius:10px;background:${s.tint};display:flex;align-items:center;justify-content:center;`)}>
                      <span style={css(`font-family:'Material Symbols Outlined';font-size:17px;color:${s.ic};`)}>{s.icon}</span>
                    </div>
                    <div style={css('flex:1;min-width:0;')}>
                      <div style={css('display:flex;justify-content:space-between;gap:8px;')}>
                        <span style={css('font-weight:700;font-size:12.5px;')}>{n.title}</span>
                        <span style={css('font-size:10.5px;color:var(--ag-muted-soft);flex:none;')}>{relTime(n.created_at)}</span>
                      </div>
                      <div style={css('font-size:12px;color:var(--ag-muted);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{n.body}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => {
                setOpen(false);
                navigate(viewAllTo);
              }}
              style={css('width:100%;padding:11px;border:none;border-top:1px solid var(--ag-border-soft);background:none;cursor:pointer;color:var(--ag-crimson);font-size:12.5px;font-weight:700;')}
            >
              View all
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Unread chat count from the same stream (type === 'Messages') — for badging the existing bottom-dock Messages tab instead of a second, redundant header icon. */
export function useUnreadMessageCount() {
  const { items } = useNotifications();
  return items.filter((n) => n.type === 'Messages' && !n.read).length;
}
