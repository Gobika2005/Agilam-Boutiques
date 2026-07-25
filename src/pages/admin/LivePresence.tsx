import { useEffect, useState } from 'react';
import { css } from '@/lib/css';
import { subscribeToOnlineUsers, type OnlineUser, type PresenceRole } from '@/lib/presence';
import { Avatar, Icon, EmptyState, T } from '@/components/admin/kit';

const ROLE_PILL: Record<PresenceRole, { bg: string; fg: string; label: string }> = {
  guest: { bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)', label: 'Guest' },
  buyer: { bg: 'var(--ag-info-bg)', fg: 'var(--ag-info-text)', label: 'Buyer' },
  seller: { bg: 'var(--ag-purple-bg)', fg: '#9B7FC7', label: 'Seller' },
  admin: { bg: 'var(--ag-surface-2)', fg: '#D6336C', label: 'Admin' },
};

const PAGE_ICON: Record<string, string> = {
  'Viewing a product': 'local_mall',
  'Viewing a boutique': 'storefront',
  'At checkout': 'shopping_cart_checkout',
  'Paying': 'credit_card',
  'Order placed': 'check_circle',
  'Viewing orders': 'receipt_long',
  'In their cart': 'shopping_cart',
  'Browsing wishlist': 'favorite',
  'Searching products': 'search',
  'Chatting': 'chat',
  'On the Inspire feed': 'auto_awesome',
  'Exploring collections': 'grid_view',
  'On their profile': 'person',
  'Browsing home': 'home',
  'Admin console': 'shield_person',
  'Seller console': 'storefront',
  'Signing in': 'login',
};

const relative = (iso: string, now: number) => {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 12) return 'active now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

export function LivePresence() {
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(true);

  useEffect(() => subscribeToOnlineUsers(setUsers), []);

  // Re-render every 10s so the "active … ago" labels stay honest.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  const shoppers = users.filter((u) => u.role === 'guest' || u.role === 'buyer').length;
  const sellers = users.filter((u) => u.role === 'seller').length;
  const admins = users.filter((u) => u.role === 'admin').length;

  return (
    <div style={css(T.card + 'padding:0;overflow:hidden;margin-bottom:16px;')}>
      <div style={css('display:flex;align-items:center;gap:12px;padding:16px 20px;flex-wrap:wrap;')}>
        <span className="agx-online-dot" style={css('width:12px;height:12px;border-radius:50%;background:var(--ag-good);flex:none;')} />
        <div style={css('font-weight:800;font-size:15px;')}>
          {users.length} online now
        </div>
        <div style={css('display:flex;gap:8px;flex-wrap:wrap;')}>
          <Chip icon="shopping_bag" label={`${shoppers} shopping`} />
          {sellers > 0 && <Chip icon="storefront" label={`${sellers} seller${sellers === 1 ? '' : 's'}`} />}
          {admins > 0 && <Chip icon="shield_person" label={`${admins} admin${admins === 1 ? '' : 's'}`} />}
        </div>
        <div style={css('flex:1;')} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={css(`border:1.5px solid ${T.field};background:var(--ag-surface);color:var(--ag-label);height:34px;border-radius:10px;padding:0 12px;font-weight:700;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit;`)}
        >
          {open ? 'Hide' : 'Show'}
          <Icon name={open ? 'expand_less' : 'expand_more'} size={18} />
        </button>
      </div>

      {open && (
        <div style={css(`border-top:1px solid ${T.border};padding:16px 20px;background:var(--ag-bg);`)}>
          {users.length === 0 ? (
            <EmptyState icon="visibility_off" title="Nobody on the site right now" sub="Live sessions appear here the moment someone opens the app." />
          ) : (
            <div style={css('display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;')}>
              {users.map((u) => {
                const pill = ROLE_PILL[u.role] ?? ROLE_PILL.guest;
                return (
                  <div key={u.id} style={css('background:var(--ag-surface);border-radius:14px;padding:12px 14px;display:flex;align-items:center;gap:11px;box-shadow:0 8px 20px -18px rgba(107,20,54,.6);')}>
                    <div style={css('position:relative;flex:none;')}>
                      <Avatar name={u.name} tone={u.name.charCodeAt(0) % 8} />
                      <span className="agx-online-dot" style={css('position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;background:var(--ag-good);border:2px solid #fff;')} />
                    </div>
                    <div style={css('flex:1;min-width:0;')}>
                      <div style={css('display:flex;align-items:center;gap:6px;min-width:0;')}>
                        <span style={css('font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{u.name}</span>
                        <span style={css(`flex:none;font-size:10px;font-weight:800;padding:2px 7px;border-radius:7px;background:${pill.bg};color:${pill.fg};`)}>{pill.label}</span>
                      </div>
                      <div style={css(`display:flex;align-items:center;gap:5px;font-size:11.5px;color:${T.muted};margin-top:3px;`)}>
                        <Icon name={PAGE_ICON[u.page] ?? 'travel_explore'} size={14} color="var(--ag-muted-soft)" />
                        <span style={css('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{u.page}</span>
                      </div>
                      {u.location && (
                        <div style={css(`display:flex;align-items:center;gap:5px;font-size:11.5px;color:${T.muted};margin-top:2px;`)}>
                          <Icon name="location_on" size={14} color="var(--ag-muted-soft)" />
                          <span style={css('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{u.location}</span>
                        </div>
                      )}
                      <div style={css('font-size:11px;color:var(--ag-good);font-weight:700;margin-top:2px;')}>{relative(u.at, now)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ icon, label }: { icon: string; label: string }) {
  return (
    <span style={css(`display:inline-flex;align-items:center;gap:5px;background:${T.head};color:var(--ag-label);font-size:11.5px;font-weight:700;padding:5px 10px;border-radius:9px;`)}>
      <Icon name={icon} size={14} color="#B02454" />
      {label}
    </span>
  );
}
