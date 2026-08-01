import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { TONES, fmt, statusStyle } from '@/data/demo';
import { useAuth } from '@/auth/AuthContext';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchOrdersForBoutique } from '@/data/orders';
import { fetchProductsByBoutique } from '@/data/products';
import { countUnreadNotifications } from '@/data/notifications';
import { fetchReviewsForBoutique } from '@/data/reviews';
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
  const { data: reviewRows } = useAsync(
    () => (boutique ? fetchReviewsForBoutique(boutique.id) : Promise.resolve([])),
    [boutique?.id],
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
  // Summed from the shared order view rather than re-derived here: this tile used
  // to add only goods + handling and silently dropped the delivery fee, so it
  // under-reported by ₹79 an order against the Orders banner and the invoice —
  // the two numbers the seller actually counts cash against.
  const toCollect = orders.reduce((s, o) => s + o.collectAmount, 0);
  // Guest orders have no buyer_id, so fall back to the phone number before
  // giving up and counting the order itself as its own customer.
  const customerCount = new Set(rows.map((o) => o.buyer_id ?? o.guest_phone ?? o.id)).size;
  const lowStock = products.filter((p) => p.stock <= LOW_STOCK_AT).sort((a, b) => a.stock - b.stock);
  const recentOrders = orders.slice(0, 5);
  // Discovery/engagement surfaces the buyer app has that the seller reaches from
  // here: reviews awaiting a reply.
  const reviewsNeedingReply = (reviewRows ?? []).filter((r) => !r.seller_reply).length;

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
    { label: 'Total Products', value: String(products.length), icon: 'inventory_2', tint: 'var(--ag-surface-2)', ic: '#D6336C', to: '/seller/products' },
    { label: 'Total Orders', value: String(orders.length), icon: 'receipt_long', tint: 'var(--ag-info-bg)', ic: 'var(--ag-info-text)', to: '/seller/orders' },
    { label: 'Total Customers', value: String(customerCount), icon: 'group', tint: 'var(--ag-good-bg)', ic: 'var(--ag-good)', to: '/seller/customers' },
    { label: 'Total Revenue', value: fmt(totalRevenue), icon: 'payments', tint: 'var(--ag-purple-bg)', ic: '#9B7FC7', to: '/seller/earnings' },
  ];

  const QUICK = [
    { label: 'New Bill', sub: 'Create invoice', icon: 'receipt_long', tint: 'var(--ag-surface-2)', ic: '#D6336C', to: '/seller/billing', badge: 0 },
    { label: 'Notifications', sub: 'View alerts', icon: 'notifications', tint: 'var(--ag-gold-bg)', ic: 'var(--ag-gold-text)', to: '/seller/notifications', badge: unread ?? 0 },
    { label: 'Orders', sub: 'Manage orders', icon: 'shopping_bag', tint: 'var(--ag-purple-bg)', ic: '#9B7FC7', to: '/seller/orders', badge: pendingCount },
    { label: 'Add Product', sub: 'List a new piece', icon: 'add_box', tint: 'var(--ag-good-bg)', ic: 'var(--ag-good)', to: '/seller/add-product', badge: 0 },
  ];

  // Buyer-facing discovery & engagement surfaces the seller reaches from here.
  const GROW = [
    { label: 'Reviews', sub: reviewsNeedingReply ? `${reviewsNeedingReply} to reply` : 'Ratings', icon: 'reviews', ic: 'var(--ag-gold-text)', tint: 'var(--ag-gold-bg)', to: '/seller/reviews', badge: reviewsNeedingReply },
  ];

  const TODAY = [
    { label: "Today's orders", value: String(todaysOrders.length), ic: 'var(--ag-info-text)' },
    { label: "Today's revenue", value: fmt(todaysRevenue), ic: 'var(--ag-good)' },
    { label: 'Pending orders', value: String(pendingCount), ic: 'var(--ag-gold-text)' },
    { label: 'Cash to collect', value: fmt(toCollect), ic: 'var(--ag-gold-text)' },
    { label: 'Low stock', value: String(lowStock.length), ic: 'var(--ag-danger-text)' },
  ];

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      {/* The page's identity is carried visually by the boutique card; screen
          readers need an actual heading to navigate to. */}
      <h1 className="agx-sr-only">Seller dashboard</h1>
      {/* Boutique identity ------------------------------------------------- */}
      <button
        onClick={() => navigate('/seller/boutique')}
        className="agx-lift"
        style={css('width:100%;text-align:left;background:linear-gradient(135deg,var(--ag-surface-2),var(--ag-surface));border:1px solid var(--ag-border);border-radius:22px;padding:16px;display:flex;align-items:center;gap:14px;cursor:pointer;font-family:inherit;')}
      >
        <span style={css("width:56px;height:56px;flex:none;border-radius:18px;overflow:hidden;background:linear-gradient(135deg,#C62A60,#B02454);display:flex;align-items:center;justify-content:center;color:#fff;font-family:'Playfair Display',serif;font-weight:700;font-size:24px;")}>
          {boutique?.logo_url ? <img src={boutique.logo_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} /> : initial}
        </span>
        <span style={css('flex:1;min-width:0;')}>
          <span style={css("display:flex;align-items:center;gap:6px;font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(19px,2.4vw,25px);color:var(--ag-ink);")}>
            <span style={css('white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{boutiqueName}</span>
            {boutique?.verified && <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:var(--ag-info-text);")}>verified</span>}
          </span>
          <span style={css('display:block;font-size:12.5px;color:var(--ag-muted);font-weight:600;margin-top:2px;')}>
            {[boutique?.category, boutique?.area || boutique?.city].filter(Boolean).join(' · ') || 'Complete your boutique profile'}
          </span>
          {facts.length > 0 && (
            <span style={css('display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;')}>
              {facts.map((f) => (
                <span key={f.text} style={css('display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;background:var(--ag-surface-2);border:1px solid var(--ag-border);font-size:10.5px;font-weight:800;color:#8A5A72;')}>
                  <span style={css(`font-family:'Material Symbols Outlined';font-size:13px;color:${f.icon === 'verified' ? 'var(--ag-info-text)' : f.icon === 'star' ? 'var(--ag-star)' : 'var(--ag-crimson)'};`)}>{f.icon}</span>
                  {f.text}
                </span>
              ))}
            </span>
          )}
          <span style={css(`display:inline-flex;align-items:center;gap:5px;margin-top:7px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;background:${approved ? 'var(--ag-good-bg)' : 'var(--ag-warn-bg)'};color:${approved ? 'var(--ag-good-text)' : 'var(--ag-warn-text)'};`)}>
            <span style={css(`width:6px;height:6px;border-radius:50%;background:${approved ? 'var(--ag-good)' : 'var(--ag-gold-text)'};`)} />
            {approved ? 'Active seller' : 'Awaiting verification'}
          </span>
        </span>
        <span style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;")}>chevron_right</span>
      </button>

      {/* Greeting + what needs the seller right now. This sits directly under
          the boutique card because it answers the only question an owner opens
          the app with — "what needs me?". It used to sit ~700px down, below the
          paid-promotion banner. ------------------------------------------- */}
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
                  ? 'Add your first product to start selling on MangaiMart.'
                  : 'No new orders right now. Your storefront is live and listening.'}
          </div>
        </div>
      </div>

      {/* Quick actions ----------------------------------------------------- */}
      <div className="agx-sd-quick" style={css('margin-top:16px;')}>
        {QUICK.map((q) => (
          <button
            key={q.label}
            onClick={() => navigate(q.to)}
            className="agx-lift"
            style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:14px;display:flex;align-items:center;gap:11px;cursor:pointer;text-align:left;font-family:inherit;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);')}
          >
            <span style={css(`width:42px;height:42px;flex:none;border-radius:13px;background:${q.tint};display:flex;align-items:center;justify-content:center;position:relative;`)}>
              <span style={css(`font-family:'Material Symbols Outlined';font-size:22px;color:${q.ic};`)}>{q.icon}</span>
              {q.badge > 0 && (
                <span style={css('position:absolute;top:-5px;right:-5px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:#D6336C;color:#fff;font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid var(--ag-surface);')}>
                  {q.badge > 99 ? '99+' : q.badge}
                </span>
              )}
            </span>
            <span style={css('flex:1;min-width:0;')}>
              <span style={css('display:block;font-weight:800;font-size:14px;color:var(--ag-ink);')}>{q.label}</span>
              <span style={css('display:block;font-size:11.5px;color:var(--ag-muted);font-weight:600;')}>{q.sub}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Grow your shop — the buyer-facing discovery & engagement surfaces. */}
      <div style={css('margin-top:16px;')}>
        <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);margin:0 2px 10px;')}>Grow your shop</div>
        {/* Tracks follow the card count: the section once held three tiles, and
            leaving it at repeat(3,…) rendered the lone Reviews card a third of
            the width beside two empty columns. */}
        <div style={css(`display:grid;grid-template-columns:repeat(${Math.min(GROW.length, 3)},minmax(0,1fr));gap:10px;`)}>
          {GROW.map((g) => (
            <button
              key={g.label}
              onClick={() => navigate(g.to)}
              className="agx-lift"
              style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:13px 11px;display:flex;flex-direction:column;align-items:flex-start;gap:9px;cursor:pointer;text-align:left;font-family:inherit;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);')}
            >
              <span style={css(`width:40px;height:40px;flex:none;border-radius:12px;background:${g.tint};display:flex;align-items:center;justify-content:center;position:relative;`)}>
                <span style={css(`font-family:'Material Symbols Outlined';font-size:21px;color:${g.ic};`)}>{g.icon}</span>
                {g.badge > 0 && (
                  <span style={css('position:absolute;top:-5px;right:-5px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:#D6336C;color:#fff;font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid var(--ag-surface);')}>
                    {g.badge > 99 ? '99+' : g.badge}
                  </span>
                )}
              </span>
              <span style={css('min-width:0;')}>
                <span style={css('display:block;font-weight:800;font-size:13px;color:var(--ag-ink);')}>{g.label}</span>
                <span style={css('display:block;font-size:11px;color:var(--ag-muted);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{g.sub}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Promote CTA — an upsell, so it follows the seller's own numbers
          rather than outranking them. ---------------------------------------- */}
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

      {/* Business overview -------------------------------------------------- */}
      <div style={css('display:flex;align-items:flex-end;justify-content:space-between;margin:28px 0 14px;gap:12px;')}>
        <div>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Business overview</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(21px,2.4vw,28px);line-height:1.12;margin-top:5px;")}>Your numbers</div>
        </div>
        <div style={css('font-size:12px;color:var(--ag-muted);font-weight:700;white-space:nowrap;')}>
          {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </div>

      <div className="agx-sd-stats">
        {STATS.map((st) => (
          <button
            key={st.label}
            onClick={() => navigate(st.to)}
            className="agx-lift"
            style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:16px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);cursor:pointer;text-align:left;font-family:inherit;')}
          >
            <span style={css(`width:40px;height:40px;border-radius:13px;background:${st.tint};display:flex;align-items:center;justify-content:center;`)}>
              <span style={css(`font-family:'Material Symbols Outlined';font-size:21px;color:${st.ic};`)}>{st.icon}</span>
            </span>
            <span style={css("display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(24px,3vw,31px);line-height:1;margin-top:13px;color:var(--ag-ink);word-break:break-word;")}>{st.value}</span>
            <span style={css('display:block;color:var(--ag-muted);font-size:12.5px;font-weight:600;margin-top:5px;')}>{st.label}</span>
            <span style={css('display:flex;align-items:center;gap:3px;color:var(--ag-crimson);font-size:11.5px;font-weight:800;margin-top:8px;')}>
              View all<span style={css("font-family:'Material Symbols Outlined';font-size:15px;")}>chevron_right</span>
            </span>
          </button>
        ))}
      </div>

      {/* Today's summary ---------------------------------------------------- */}
      <div style={css('margin-top:16px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:16px 18px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);display:flex;gap:12px;flex-wrap:wrap;')}>
        {TODAY.map((s) => (
          <div key={s.label} style={css('flex:1;min-width:120px;')}>
            <div style={css('font-size:11.5px;color:var(--ag-muted);font-weight:700;')}>{s.label}</div>
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
              style={css('border:none;background:none;color:var(--ag-crimson);font-weight:800;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:3px;font-family:inherit;')}
            >
              View all<span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>chevron_right</span>
            </button>
          </div>

          <div style={css('display:flex;flex-direction:column;gap:10px;')}>
            {ordersLoading && <div style={css('color:var(--ag-muted);font-size:14px;padding:8px 2px;')}>Loading orders…</div>}
            {!ordersLoading && recentOrders.length === 0 && (
              <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:22px;text-align:center;')}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:30px;color:var(--ag-border);")}>receipt_long</span>
                <div style={css('font-weight:700;font-size:14px;margin-top:6px;color:var(--ag-ink);')}>No orders yet</div>
                <div style={css('font-size:12.5px;color:var(--ag-muted);font-weight:600;margin-top:3px;')}>
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
                  style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:13px;display:flex;gap:12px;align-items:center;cursor:pointer;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);')}
                >
                  <div style={css(`width:48px;height:48px;flex:none;border-radius:14px;background:${TONES[o.tone]};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:19px;color:rgba(42,26,32,.5);`)}>
                    {o.customer.charAt(0).toUpperCase()}
                  </div>
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('font-weight:700;font-size:14px;color:var(--ag-ink);')}>{o.customer}</div>
                    <div style={css('font-size:12.5px;color:var(--ag-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{o.item}</div>
                    <div style={css('font-size:11px;color:var(--ag-muted-soft);font-weight:700;margin-top:2px;')}>{o.number} · {o.date}</div>
                  </div>
                  <div style={css('text-align:right;flex:none;')}>
                    <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:var(--ag-crimson);")}>{fmt(o.amount)}</div>
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
              style={css('border:none;background:none;color:var(--ag-crimson);font-weight:800;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:3px;font-family:inherit;')}
            >
              Restock<span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>chevron_right</span>
            </button>
          </div>

          <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:8px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}>
            {lowStock.length === 0 && (
              <div style={css('padding:18px 12px;text-align:center;')}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:26px;color:#B6DCC6;")}>check_circle</span>
                <div style={css('font-size:13px;color:var(--ag-muted);font-weight:700;margin-top:5px;')}>
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
                  <span style={css('display:block;font-weight:700;font-size:13px;color:var(--ag-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{p.title}</span>
                  <span style={css('display:block;font-size:11.5px;color:var(--ag-muted);font-weight:600;')}>{fmt(Number(p.price))}</span>
                </span>
                <span style={css(`flex:none;font-size:11px;font-weight:800;padding:4px 9px;border-radius:8px;background:${p.stock === 0 ? 'var(--ag-bad-bg)' : 'var(--ag-warn-bg)'};color:${p.stock === 0 ? 'var(--ag-bad-text)' : 'var(--ag-warn-text)'};`)}>
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
