import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { messagePreview } from '@/data/chat';
import { useNotifications } from '@/state/NotificationContext';

const TABS = ['All', 'Orders', 'Messages', 'Wishlist', 'Updates'];
/** The admin console has no wishlist, so that filter is dropped there. */
const ADMIN_TABS = ['All', 'Orders', 'Messages', 'Updates'];

const STYLE: Record<string, { icon: string; tint: string; ic: string }> = {
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
 * Full notification inbox, shared by the buyer, seller and admin
 * "view all"/`/…/notifications` pages so there's one list UI instead of three.
 * `orderBasePath` (e.g. '/buyer' or '/seller') lets a row with an order_id
 * deep-link to that console's order screen; admin has none, so it's optional.
 *
 * `embedded` drops the back button and page title for hosts that already draw a
 * header around the outlet — the admin console did, so the screen showed two
 * competing titles (its own "Notifications" under the layout's own heading).
 */
export function NotificationsInbox({ backTo, orderBasePath, embedded = false }: {
  backTo: string;
  orderBasePath?: string;
  embedded?: boolean;
}) {
  const navigate = useNavigate();
  const { items, loading, markRead, markAllRead, unreadCount } = useNotifications();
  const [tab, setTab] = useState('All');

  const tabs = embedded ? ADMIN_TABS : TABS;
  const notifs = items.filter((n) => tab === 'All' || n.type === tab);

  const open = async (n: (typeof items)[number]) => {
    if (!n.read) await markRead(n.id);
    if (n.order_id && orderBasePath) navigate(`${orderBasePath}/orders/${encodeURIComponent(n.order_id)}`);
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css(`padding:6px 20px 8px;display:flex;align-items:center;gap:10px;${embedded ? 'justify-content:flex-end;min-height:0;' : ''}`)}>
        {!embedded && (
          <>
            <button onClick={() => navigate(backTo)} aria-label="Go back" style={css('width:42px;height:42px;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
            </button>
            <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;flex:1;margin:0;")}>Notifications</h1>
          </>
        )}
        {unreadCount > 0 && (
          <button onClick={() => markAllRead()} style={css('border:none;background:none;cursor:pointer;color:var(--ag-crimson);font-size:12.5px;font-weight:700;')}>
            Mark all read
          </button>
        )}
      </div>

      <div className="agx-scroll" style={css('display:flex;gap:8px;overflow-x:auto;padding:4px 20px 10px;')}>
        {tabs.map((t) => {
          const on = tab === t;
          return (
            <button key={t} onClick={() => setTab(t)} style={css(`flex:none;padding:7px 15px;border:none;border-radius:999px;font-size:12.5px;font-weight:700;cursor:pointer;background:${on ? 'var(--ag-crimson)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-label)'};`)}>
              {t}
            </button>
          );
        })}
      </div>

      <div style={css('display:flex;flex-direction:column;gap:10px;padding:0 20px;')}>
        {/* Every other empty state in the app gives an icon, a line explaining
            what will land here, and a way onward. This one was the bare string
            "Nothing here yet." — the only screen that stopped at a full stop. */}
        {!loading && notifs.length === 0 && (
          <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:48px 24px 40px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:44px;color:var(--ag-muted-soft);")}>
              notifications_none
            </span>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;margin-top:12px;")}>
              No notifications yet
            </div>
            <div style={css('color:var(--ag-muted);font-size:13.5px;margin-top:6px;max-width:330px;line-height:1.55;')}>
              {orderBasePath === '/seller'
                ? 'We’ll tell you the moment an order comes in, a buyer messages you, or a review needs a reply.'
                : 'We’ll tell you the moment a boutique confirms, packs or ships your order — and when something you saved comes back in stock.'}
            </div>
          </div>
        )}
        {notifs.map((n) => {
          const s = STYLE[n.type] ?? STYLE.Updates;
          return (
            <div
              key={n.id}
              onClick={() => open(n)}
              style={css(`background:${n.read ? 'var(--ag-surface)' : 'var(--ag-unread)'};border-radius:16px;padding:13px;display:flex;gap:11px;align-items:flex-start;box-shadow:0 10px 26px -22px rgba(107,20,54,.6);cursor:${n.order_id && orderBasePath ? 'pointer' : 'default'};`)}
            >
              <div style={css(`width:40px;height:40px;flex:none;border-radius:12px;background:${s.tint};display:flex;align-items:center;justify-content:center;`)}>
                <span style={css(`font-family:'Material Symbols Outlined';font-size:20px;color:${s.ic};`)}>{s.icon}</span>
              </div>
              <div style={css('flex:1;min-width:0;')}>
                <div style={css('display:flex;justify-content:space-between;align-items:center;gap:8px;')}>
                  <span style={css('font-weight:800;font-size:13.5px;')}>{n.title}</span>
                  <span style={css('font-size:11px;color:var(--ag-muted-soft);flex:none;')}>{relTime(n.created_at)}</span>
                </div>
                {/* `overflow-wrap` because a message body is arbitrary buyer text
                    — an unbroken run like a pasted URL used to push the row's
                    width out past the screen instead of wrapping. */}
                <div style={css('font-size:12.5px;color:var(--ag-muted);line-height:1.4;margin-top:2px;overflow-wrap:anywhere;')}>
                  {messagePreview(n.body)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
