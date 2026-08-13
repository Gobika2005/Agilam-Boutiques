import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { messagePreview } from '@/data/chat';
import { useNotifications } from '@/state/NotificationContext';

/**
 * One tab set for all three consoles.
 *
 * There used to be a fourth filter, "Wishlist", on the buyer and seller inboxes.
 * It is gone by request. Note that the notifications themselves are unaffected:
 * `notify_wishlist_price_drop` (migration 0044) still writes a `type:'Wishlist'`
 * row when a saved product's price drops, and those rows still render here under
 * "All" with their own icon — see STYLE below, which is why it keeps a Wishlist
 * entry. Only the filter chip is withdrawn.
 *
 * Dropping it for the seller too is not scope creep: that trigger inserts
 * `select w.buyer_id … from wishlist w`, so a seller has never been able to
 * receive this type, and their chip filtered a list that was empty by
 * construction. The admin console never showed it.
 */
const TABS = ['All', 'Orders', 'Messages', 'Updates'];

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

export type NotificationConsole = 'buyer' | 'seller' | 'admin';

/**
 * Where an `order_id` row opens, per console.
 *
 * Admin is the odd one out: it lists every order on a single screen with no
 * per-order route, so the nearest thing to "open this order" is landing on that
 * list already filtered to it. Previously admin passed no base path at all and
 * an order notification simply did nothing when tapped.
 */
const ORDER_PATH: Record<NotificationConsole, (id: string) => string> = {
  buyer: (id) => `/orders/${encodeURIComponent(id)}`,
  seller: (id) => `/seller/orders/${encodeURIComponent(id)}`,
  admin: (id) => `/admin/orders?q=${encodeURIComponent(id)}`,
};

/**
 * The last resort, by notification type.
 *
 * A "New message" row carries neither a link nor an order id — the trigger that
 * writes it never recorded which conversation it was about (migration 0081 now
 * does, but only for rows written after it is applied). Every one of those rows
 * was dead on tap. Sending them to the inbox is not as good as opening the
 * thread, but it is the difference between a notification that works and one
 * that does nothing, and it is what every old row will keep doing.
 *
 * `Updates` deliberately has no entry: an admin broadcast is free text with no
 * subject, so there is genuinely nowhere for it to go.
 */
const TYPE_FALLBACK: Record<NotificationConsole, Record<string, string>> = {
  buyer: { Messages: '/messages', Wishlist: '/wishlist' },
  seller: { Messages: '/seller/messages' },
  admin: {},
};

/**
 * Full notification inbox, shared by the buyer, seller and admin
 * "view all"/`/…/notifications` pages so there's one list UI instead of three.
 *
 * `console` decides where a tapped row goes — order routes and per-type
 * fallbacks differ per console, and the same notification row belongs to
 * exactly one of them.
 *
 * `embedded` drops the back button and page title for hosts that already draw a
 * header around the outlet — the admin console did, so the screen showed two
 * competing titles (its own "Notifications" under the layout's own heading).
 */
export function NotificationsInbox({ backTo, console: surface, embedded = false }: {
  backTo: string;
  console: NotificationConsole;
  embedded?: boolean;
}) {
  const navigate = useNavigate();
  const { items, loading, markRead, markAllRead, unreadCount } = useNotifications();
  const [tab, setTab] = useState('All');

  const notifs = items.filter((n) => tab === 'All' || n.type === tab);

  /**
   * Where a row goes when tapped, most specific first.
   *
   *  1. `link` (migration 0077, widened by 0081) — an explicit in-app path
   *     written by the notification's author. The exact thread, product or
   *     review screen the notification is about.
   *  2. `order_id` — the console's order screen.
   *  3. The type fallback above — the right *area* when the row predates the
   *     migration that would have given it a precise target.
   *
   * Only same-origin paths are followed. The column is written by triggers, not
   * by users, but a notification is a link the app clicks on the user's behalf,
   * and "starts with a single slash" is the whole guard needed to keep it from
   * ever becoming an off-site redirect.
   */
  const destination = (n: (typeof items)[number]): string | null => {
    if (n.link && /^\/[^/]/.test(n.link)) return n.link;
    if (n.order_id) return ORDER_PATH[surface](n.order_id);
    return TYPE_FALLBACK[surface][n.type] ?? null;
  };

  const open = async (n: (typeof items)[number]) => {
    if (!n.read) await markRead(n.id);
    const to = destination(n);
    if (to) navigate(to);
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
        {TABS.map((t) => {
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
              {surface === 'seller'
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
              style={css(`background:${n.read ? 'var(--ag-surface)' : 'var(--ag-unread)'};border-radius:16px;padding:13px;display:flex;gap:11px;align-items:flex-start;box-shadow:0 10px 26px -22px rgba(107,20,54,.6);cursor:${destination(n) ? 'pointer' : 'default'};`)}
            >
              <div style={css(`width:40px;height:40px;flex:none;border-radius:12px;background:${s.tint};display:flex;align-items:center;justify-content:center;`)}>
                <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:20px;color:${s.ic};`)}>{s.icon}</span>
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
