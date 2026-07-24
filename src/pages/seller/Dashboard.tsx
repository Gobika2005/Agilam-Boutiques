import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { TONES, fmt, statusStyle } from '@/data/demo';
import { useAuth } from '@/auth/AuthContext';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchOrdersForBoutique } from '@/data/orders';
import { fetchProductsByBoutique } from '@/data/products';
import { countUnreadNotifications } from '@/data/notifications';
import { toOrderView } from '@/lib/orderView';
import { resolveDisplayName } from '@/lib/displayName';

/**
 * Seller home. Every figure here is computed from the boutique's own orders and
 * catalogue — no sample data — so a new boutique reads as genuinely empty
 * rather than as a business that already turned over ₹39,592.
 */

const LOW_STOCK_AT = 5;

const isToday = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

export function Dashboard() {
  const navigate = useNavigate();
  const { profile, session } = useAuth();
  const { boutique } = useMyBoutique();

  const { data: orderRows, loading: ordersLoading } = useAsync(
    () => (boutique ? fetchOrdersForBoutique(boutique.id) : Promise.resolve([])),
    [boutique?.id],
  );
  const { data: productRows } = useAsync(
    () => (boutique ? fetchProductsByBoutique(boutique.id) : Promise.resolve([])),
    [boutique?.id],
  );
  const { data: unread } = useAsync(
    () => (profile ? countUnreadNotifications(profile.id) : Promise.resolve(0)),
    [profile?.id],
  );

  const rows = orderRows ?? [];
  const products = productRows ?? [];
  const orders = rows.map((o, i) => toOrderView(o, i));

  // Revenue counts only money that actually landed: a rejected or cancelled
  // order earned nothing, and a COD order whose cash the seller has not yet
  // collected is a promise, not revenue. Counting either would flatter the tile.
  const earned = (o: (typeof rows)[number]) =>
    o.status !== 'rejected' &&
    o.status !== 'cancelled' &&
    (o.payment_method !== 'COD' || (o.payment_status ?? 'paid') === 'paid');

  const totalRevenue = rows.filter(earned).reduce((s, o) => s + Number(o.total), 0);
  const todaysOrders = rows.filter((o) => isToday(o.created_at));
  const todaysRevenue = todaysOrders.filter(earned).reduce((s, o) => s + Number(o.total), 0);
  const pendingCount = rows.filter((o) => o.status === 'pending').length;
  // Cash the seller still has to collect at the door, across all open COD orders.
  const toCollect = rows
    .filter((o) => o.payment_method === 'COD' && (o.payment_status ?? 'paid') === 'pending' && o.status !== 'rejected' && o.status !== 'cancelled')
    .reduce((s, o) => s + Number(o.total) + Number(o.cod_fee ?? 0), 0);
  // Guest orders have no buyer_id, so fall back to the phone number before
  // giving up and counting the order itself as its own customer.
  const customerCount = new Set(rows.map((o) => o.buyer_id ?? o.guest_phone ?? o.id)).size;
  const lowStock = products.filter((p) => p.stock <= LOW_STOCK_AT).sort((a, b) => a.stock - b.stock);
  const recentOrders = orders.slice(0, 5);

  const ownerName = boutique?.owner_name || resolveDisplayName(profile, session);
  const boutiqueName = boutique?.name ?? 'Your boutique';
  const initial = boutiqueName.trim().charAt(0).toUpperCase() || 'B';
  const approved = boutique?.status === 'approved';

  // "Since {year}" — the boutique's own established year, else derived from the
  // years-in-business the seller gave during onboarding.
  const sinceYear =
    boutique?.established_year ??
    (boutique?.years_in_business ? new Date().getFullYear() - boutique.years_in_business : null);
  const rating = boutique?.rating ?? 0;
  const followers = boutique?.followers_count ?? 0;
  // Small facts shown as chips under the boutique name.
  const facts: { icon: string; text: string }[] = [
    ...(sinceYear ? [{ icon: 'calendar_today', text: `Since ${sinceYear}` }] : []),
    ...(rating > 0 ? [{ icon: 'star', text: `${rating.toFixed(1)} rating` }] : []),
    ...(followers > 0 ? [{ icon: 'group', text: `${followers} follower${followers === 1 ? '' : 's'}` }] : []),
  ];

  const STATS = [
    { label: 'Total Products', value: String(products.length), icon: 'inventory_2', tint: '#FCE0EC', ic: '#D6336C', to: '/seller/products' },
    { label: 'Total Orders', value: String(orders.length), icon: 'receipt_long', tint: '#E6F0FA', ic: '#3A6EA5', to: '/seller/orders' },
    { label: 'Total Customers', value: String(customerCount), icon: 'group', tint: '#E5F3EC', ic: '#2FA36B', to: '/seller/customers' },
    { label: 'Total Revenue', value: fmt(totalRevenue), icon: 'payments', tint: '#F3EAF5', ic: '#9B7FC7', to: '/seller/earnings' },
  ];

  const QUICK = [
    { label: 'New Bill', sub: 'Create invoice', icon: 'receipt_long', tint: '#FCE0EC', ic: '#D6336C', to: '/seller/billing', badge: 0 },
    { label: 'Notifications', sub: 'View alerts', icon: 'notifications', tint: '#FFF1D6', ic: '#C99A3F', to: '/seller/notifications', badge: unread ?? 0 },
    { label: 'Orders', sub: 'Manage orders', icon: 'shopping_bag', tint: '#F3EAF5', ic: '#9B7FC7', to: '/seller/orders', badge: pendingCount },
    { label: 'Add Product', sub: 'List a new piece', icon: 'add_box', tint: '#E5F3EC', ic: '#2FA36B', to: '/seller/add-product', badge: 0 },
  ];

  const TODAY = [
    { label: "Today's orders", value: String(todaysOrders.length), ic: '#3A6EA5' },
    { label: "Today's revenue", value: fmt(todaysRevenue), ic: '#2FA36B' },
    { label: 'Pending orders', value: String(pendingCount), ic: '#C99A3F' },
    { label: 'Cash to collect', value: fmt(toCollect), ic: '#B9862F' },
    { label: 'Low stock', value: String(lowStock.length), ic: '#D6455A' },
  ];

  return (
    <div style={css('min-height:100%;background:#FBF6F2;padding-bottom:20px;')}>
      {/* Boutique identity ------------------------------------------------- */}
      <button
        onClick={() => navigate('/seller/boutique')}
        className="agx-lift"
        style={css('width:100%;text-align:left;background:linear-gradient(135deg,#FDF0F5,#FFFDFC);border:1px solid #F5E1EA;border-radius:22px;padding:16px;display:flex;align-items:center;gap:14px;cursor:pointer;font-family:inherit;')}
      >
        <span style={css("width:56px;height:56px;flex:none;border-radius:18px;overflow:hidden;background:linear-gradient(135deg,#E14A7E,#B02454);display:flex;align-items:center;justify-content:center;color:#fff;font-family:'Playfair Display',serif;font-weight:700;font-size:24px;")}>
          {boutique?.logo_url ? <img src={boutique.logo_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} /> : initial}
        </span>
        <span style={css('flex:1;min-width:0;')}>
          <span style={css("display:flex;align-items:center;gap:6px;font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(19px,2.4vw,25px);color:#2A1A20;")}>
            <span style={css('white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{boutiqueName}</span>
            {boutique?.verified && <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:#3A6EA5;")}>verified</span>}
          </span>
          <span style={css('display:block;font-size:12.5px;color:#8A7078;font-weight:600;margin-top:2px;')}>
            {[boutique?.category, boutique?.area || boutique?.city].filter(Boolean).join(' · ') || 'Complete your boutique profile'}
          </span>
          {facts.length > 0 && (
            <span style={css('display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;')}>
              {facts.map((f) => (
                <span key={f.text} style={css('display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;background:#FBF0F5;border:1px solid #F3DCE7;font-size:10.5px;font-weight:800;color:#8A5A72;')}>
                  <span style={css(`font-family:'Material Symbols Outlined';font-size:13px;color:${f.icon === 'verified' ? '#3A6EA5' : f.icon === 'star' ? '#E0B84B' : '#B02454'};`)}>{f.icon}</span>
                  {f.text}
                </span>
              ))}
            </span>
          )}
          <span style={css(`display:inline-flex;align-items:center;gap:5px;margin-top:7px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;background:${approved ? '#E5F3EC' : '#FBF0DA'};color:${approved ? '#218456' : '#B8860B'};`)}>
            <span style={css(`width:6px;height:6px;border-radius:50%;background:${approved ? '#2FA36B' : '#C99A3F'};`)} />
            {approved ? 'Active seller' : 'Awaiting verification'}
          </span>
        </span>
        <span style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;")}>chevron_right</span>
      </button>

      {/* Promote CTA ------------------------------------------------------- */}
      <button
        onClick={() => navigate('/seller/promote')}
        className="agx-lift"
        style={css('width:100%;text-align:left;margin-top:16px;background:linear-gradient(135deg,#D6336C,#B02454);border:none;border-radius:18px;padding:15px 16px;display:flex;align-items:center;gap:13px;cursor:pointer;font-family:inherit;color:#fff;')}
      >
        <span style={css('width:42px;height:42px;flex:none;border-radius:13px;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:23px;")}>campaign</span>
        </span>
        <span style={css('flex:1;min-width:0;')}>
          <span style={css('display:block;font-weight:800;font-size:14.5px;')}>Promote your boutique</span>
          <span style={css('display:block;font-size:12px;opacity:.85;margin-top:1px;')}>Book an ad slot and reach more buyers</span>
        </span>
        <span style={css("font-family:'Material Symbols Outlined';")}>chevron_right</span>
      </button>

      {/* Quick actions ----------------------------------------------------- */}
      <div className="agx-sd-quick" style={css('margin-top:16px;')}>
        {QUICK.map((q) => (
          <button
            key={q.label}
            onClick={() => navigate(q.to)}
            className="agx-lift"
            style={css('background:#fff;border:1px solid #F2E4EA;border-radius:18px;padding:14px;display:flex;align-items:center;gap:11px;cursor:pointer;text-align:left;font-family:inherit;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);')}
          >
            <span style={css(`width:42px;height:42px;flex:none;border-radius:13px;background:${q.tint};display:flex;align-items:center;justify-content:center;position:relative;`)}>
              <span style={css(`font-family:'Material Symbols Outlined';font-size:22px;color:${q.ic};`)}>{q.icon}</span>
              {q.badge > 0 && (
                <span style={css('position:absolute;top:-5px;right:-5px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:#D6336C;color:#fff;font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff;')}>
                  {q.badge > 99 ? '99+' : q.badge}
                </span>
              )}
            </span>
            <span style={css('flex:1;min-width:0;')}>
              <span style={css('display:block;font-weight:800;font-size:14px;color:#2A1A20;')}>{q.label}</span>
              <span style={css('display:block;font-size:11.5px;color:#A98D99;font-weight:600;')}>{q.sub}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Welcome banner ---------------------------------------------------- */}
      <div style={css('margin-top:16px;border-radius:22px;background:linear-gradient(135deg,#8E1C44 0%,#B02454 52%,#D6336C 100%);color:#fff;padding:20px 22px;position:relative;overflow:hidden;')}>
        <div style={css('position:absolute;top:-70px;right:-40px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(244,217,166,.22),transparent 70%);pointer-events:none;')} />
        <div style={css('position:relative;')}>
          <div style={css('font-size:13px;opacity:.85;')}>{greeting()},</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(23px,3vw,32px);line-height:1.1;margin-top:3px;")}>
            {ownerName || boutiqueName}
          </div>
          <div style={css('font-size:13.5px;opacity:.9;margin-top:8px;max-width:520px;line-height:1.55;')}>
            {pendingCount > 0
              ? `${pendingCount} order${pendingCount > 1 ? 's are' : ' is'} waiting for you to accept.`
              : todaysOrders.length > 0
                ? `${todaysOrders.length} order${todaysOrders.length > 1 ? 's' : ''} came in today — everything is up to date.`
                : products.length === 0
                  ? 'Add your first product to start selling on Agilam.'
                  : 'No new orders right now. Your storefront is live and listening.'}
          </div>
        </div>
      </div>

      {/* Business overview -------------------------------------------------- */}
      <div style={css('display:flex;align-items:flex-end;justify-content:space-between;margin:28px 0 14px;gap:12px;')}>
        <div>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:#B02454;')}>Business overview</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(21px,2.4vw,28px);line-height:1.12;margin-top:5px;")}>Your numbers</div>
        </div>
        <div style={css('font-size:12px;color:#A98D99;font-weight:700;white-space:nowrap;')}>
          {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </div>

      <div className="agx-sd-stats">
        {STATS.map((st) => (
          <button
            key={st.label}
            onClick={() => navigate(st.to)}
            className="agx-lift"
            style={css('background:#fff;border:1px solid #F2E4EA;border-radius:20px;padding:16px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);cursor:pointer;text-align:left;font-family:inherit;')}
          >
            <span style={css(`width:40px;height:40px;border-radius:13px;background:${st.tint};display:flex;align-items:center;justify-content:center;`)}>
              <span style={css(`font-family:'Material Symbols Outlined';font-size:21px;color:${st.ic};`)}>{st.icon}</span>
            </span>
            <span style={css("display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(24px,3vw,31px);line-height:1;margin-top:13px;color:#2A1A20;word-break:break-word;")}>{st.value}</span>
            <span style={css('display:block;color:#8A7078;font-size:12.5px;font-weight:600;margin-top:5px;')}>{st.label}</span>
            <span style={css('display:flex;align-items:center;gap:3px;color:#B02454;font-size:11.5px;font-weight:800;margin-top:8px;')}>
              View all<span style={css("font-family:'Material Symbols Outlined';font-size:15px;")}>chevron_right</span>
            </span>
          </button>
        ))}
      </div>

      {/* Today's summary ---------------------------------------------------- */}
      <div style={css('margin-top:16px;background:#fff;border:1px solid #F2E4EA;border-radius:20px;padding:16px 18px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);display:flex;gap:12px;flex-wrap:wrap;')}>
        {TODAY.map((s) => (
          <div key={s.label} style={css('flex:1;min-width:120px;')}>
            <div style={css('font-size:11.5px;color:#A98D99;font-weight:700;')}>{s.label}</div>
            <div style={css(`font-family:'Playfair Display',serif;font-weight:700;font-size:23px;line-height:1.1;margin-top:4px;color:${s.ic};`)}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Recent orders + low stock ------------------------------------------ */}
      <div className="agx-sd-split" style={css('margin-top:16px;')}>
        <div>
          <div style={css('display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Recent orders</div>
            <button
              onClick={() => navigate('/seller/orders')}
              style={css('border:none;background:none;color:#B02454;font-weight:800;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:3px;font-family:inherit;')}
            >
              View all<span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>chevron_right</span>
            </button>
          </div>

          <div style={css('display:flex;flex-direction:column;gap:10px;')}>
            {ordersLoading && <div style={css('color:#8A7078;font-size:14px;padding:8px 2px;')}>Loading orders…</div>}
            {!ordersLoading && recentOrders.length === 0 && (
              <div style={css('background:#fff;border:1px solid #F2E4EA;border-radius:18px;padding:22px;text-align:center;')}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:30px;color:#E0C2CE;")}>receipt_long</span>
                <div style={css('font-weight:700;font-size:14px;margin-top:6px;color:#2A1A20;')}>No orders yet</div>
                <div style={css('font-size:12.5px;color:#A98D99;font-weight:600;margin-top:3px;')}>
                  Orders from buyers and your offline bills both show up here.
                </div>
              </div>
            )}
            {recentOrders.map((o) => {
              const st = statusStyle(o.status);
              return (
                <div
                  key={o.id}
                  onClick={() => navigate(`/seller/orders/${encodeURIComponent(o.id)}`)}
                  className="agx-lift"
                  style={css('background:#fff;border:1px solid #F2E4EA;border-radius:18px;padding:13px;display:flex;gap:12px;align-items:center;cursor:pointer;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);')}
                >
                  <div style={css(`width:48px;height:48px;flex:none;border-radius:14px;background:${TONES[o.tone]};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:19px;color:rgba(42,26,32,.5);`)}>
                    {o.customer.charAt(0).toUpperCase()}
                  </div>
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('font-weight:700;font-size:14px;color:#2A1A20;')}>{o.customer}</div>
                    <div style={css('font-size:12.5px;color:#8A7078;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{o.item}</div>
                    <div style={css('font-size:11px;color:#B79AA6;font-weight:700;margin-top:2px;')}>{o.number} · {o.date}</div>
                  </div>
                  <div style={css('text-align:right;flex:none;')}>
                    <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:#B02454;")}>{fmt(o.amount)}</div>
                    <span style={css(`display:inline-block;margin-top:4px;font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:8px;background:${st.bg};color:${st.fg};`)}>{o.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div style={css('display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Low stock</div>
            <button
              onClick={() => navigate('/seller/products')}
              style={css('border:none;background:none;color:#B02454;font-weight:800;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:3px;font-family:inherit;')}
            >
              Restock<span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>chevron_right</span>
            </button>
          </div>

          <div style={css('background:#fff;border:1px solid #F2E4EA;border-radius:20px;padding:8px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}>
            {lowStock.length === 0 && (
              <div style={css('padding:18px 12px;text-align:center;')}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:26px;color:#B6DCC6;")}>check_circle</span>
                <div style={css('font-size:13px;color:#8A7078;font-weight:700;margin-top:5px;')}>
                  {products.length === 0 ? 'No products listed yet' : 'Everything is well stocked'}
                </div>
              </div>
            )}
            {lowStock.slice(0, 6).map((p) => (
              <button
                key={p.id}
                onClick={() => navigate('/seller/products')}
                style={css('width:100%;display:flex;align-items:center;gap:11px;padding:9px 8px;border:none;background:none;cursor:pointer;text-align:left;font-family:inherit;')}
              >
                <span style={css(`width:40px;height:40px;flex:none;border-radius:12px;overflow:hidden;background:${TONES[p.tone % TONES.length]};display:block;`)}>
                  {p.image_url && <img src={p.image_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} />}
                </span>
                <span style={css('flex:1;min-width:0;')}>
                  <span style={css('display:block;font-weight:700;font-size:13px;color:#2A1A20;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{p.title}</span>
                  <span style={css('display:block;font-size:11.5px;color:#A98D99;font-weight:600;')}>{fmt(Number(p.price))}</span>
                </span>
                <span style={css(`flex:none;font-size:11px;font-weight:800;padding:4px 9px;border-radius:8px;background:${p.stock === 0 ? '#FBE3E3' : '#FBF0DA'};color:${p.stock === 0 ? '#C0392B' : '#B8860B'};`)}>
                  {p.stock === 0 ? 'Out of stock' : `${p.stock} left`}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
