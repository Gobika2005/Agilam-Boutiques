import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { TONES, fmt, statusStyle } from '@/data/demo';
import { useAuth } from '@/auth/AuthContext';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchOrdersForBoutique } from '@/data/orders';
import { fetchProductsByBoutique } from '@/data/products';
import { fetchBoutiquePrivate } from '@/data/boutiques';
import { countUnreadNotifications } from '@/data/notifications';
import { fetchReviewsForBoutique } from '@/data/reviews';
import { toOrderView } from '@/lib/orderView';
import { resolveDisplayName } from '@/lib/displayName';
import { SkeletonRows } from '@/components/ui/Skeleton';

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
  // Bank details live in `boutique_private`, which is fetched separately from
  // the boutique row — a null result (not-yet-loaded, or no row) must NOT flash
  // the warning, so this stays false until we actually know.
  const [needsBankDetails, setNeedsBankDetails] = useState(false);
  const boutiqueId = boutique?.id;
  useEffect(() => {
    if (!boutiqueId) return;
    let cancelled = false;
    fetchBoutiquePrivate(boutiqueId)
      .then((p) => {
        if (cancelled || !p) return;
        setNeedsBankDetails(!p.bank_account_number || !p.bank_ifsc);
      })
      .catch(() => { /* never block the dashboard on a supporting lookup */ });
    return () => { cancelled = true; };
  }, [boutiqueId]);

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

  // The single line in the welcome card that says what needs the seller right
  // now — and where tapping it takes them, when there is something to do.
  const nudge: { text: string; to: string | null } =
    pendingCount > 0
      ? { text: `${pendingCount} order${pendingCount > 1 ? 's are' : ' is'} waiting for you to accept.`, to: '/seller/orders' }
      : todaysOrders.length > 0
        ? { text: `${todaysOrders.length} order${todaysOrders.length > 1 ? 's' : ''} came in today — everything is up to date.`, to: '/seller/orders' }
        : products.length === 0
          ? { text: 'Add your first product to start selling on MangaiMart.', to: '/seller/add-product' }
          : { text: 'No new orders right now. Your storefront is live and listening.', to: null };
  // Bound to a const so the narrowing survives into the click handler's closure.
  const nudgeTo = nudge.to;

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

      {/* One welcome card ---------------------------------------------------
          This was two stacked cards — a boutique identity card and, right below
          it, a crimson greeting card. Between them they said who you are twice
          and filled the whole first screen before showing a single action. They
          are now one card: greeting, boutique, its standing, and the one line
          about what needs the seller right now. */}
      <div style={css('border-radius:22px;background:linear-gradient(135deg,#8E1C44 0%,#B02454 52%,#D6336C 100%);color:#fff;padding:18px;position:relative;overflow:hidden;')}>
        <div style={css('position:absolute;top:-70px;right:-40px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(244,217,166,.22),transparent 70%);pointer-events:none;')} />
        <div style={css('position:relative;')}>
          <div style={css('font-size:13px;opacity:.85;')}>{greeting()}, {ownerName || boutiqueName}</div>

          <button
            onClick={() => navigate('/seller/boutique')}
            style={css('width:100%;margin-top:11px;text-align:left;background:none;border:none;padding:0;display:flex;align-items:center;gap:13px;cursor:pointer;font-family:inherit;color:inherit;')}
          >
            <span style={css("width:54px;height:54px;flex:none;border-radius:17px;overflow:hidden;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-family:'Playfair Display',serif;font-weight:700;font-size:23px;")}>
              {boutique?.logo_url ? <img src={boutique.logo_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} /> : initial}
            </span>
            <span style={css('flex:1;min-width:0;')}>
              <span style={css("display:flex;align-items:center;gap:6px;font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(21px,2.8vw,28px);line-height:1.15;")}>
                <span style={css('white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{boutiqueName}</span>
                {boutique?.verified && <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;flex:none;opacity:.9;")}>verified</span>}
              </span>
              <span style={css('display:block;font-size:12.5px;opacity:.85;font-weight:600;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>
                {[boutique?.category, boutique?.area || boutique?.city].filter(Boolean).join(' · ') || 'Complete your boutique profile'}
              </span>
            </span>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';flex:none;opacity:.75;")}>chevron_right</span>
          </button>

          {/* Standing and the small facts, as one wrapped row of translucent
              pills — legible on the gradient without fighting it. */}
          <div style={css('display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;')}>
            <span style={css('display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28);font-size:11px;font-weight:800;')}>
              <span style={css(`width:6px;height:6px;border-radius:50%;background:${approved ? '#5BE0A0' : '#F4D9A6'};`)} />
              {approved ? 'Active seller' : 'Awaiting verification'}
            </span>
            {facts.map((f) => (
              <span key={f.text} style={css('display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22);font-size:11px;font-weight:800;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:13px;opacity:.9;")}>{f.icon}</span>
                {f.text}
              </span>
            ))}
          </div>

          {/* The one line that answers "what needs me?" — and, when there is
              something to do, tapping it goes straight there. */}
          {nudgeTo ? (
            <button
              onClick={() => navigate(nudgeTo)}
              style={css('width:100%;margin-top:14px;text-align:left;display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:15px;padding:12px 14px;cursor:pointer;font-family:inherit;color:inherit;')}
            >
              <span style={css('flex:1;min-width:0;font-size:13.5px;font-weight:700;line-height:1.5;')}>{nudge.text}</span>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;flex:none;opacity:.8;")}>chevron_right</span>
            </button>
          ) : (
            <div style={css('margin-top:14px;font-size:13.5px;opacity:.9;line-height:1.55;max-width:520px;')}>{nudge.text}</div>
          )}
        </div>
      </div>

      {/* Payouts go to a bank account only. A seller who onboarded under the old
          "UPI or bank" rule can be fully approved and selling while having no
          bank account on file — so they would earn money we have no way to send
          them. This is the one nudge that cannot be dismissed, because the cost
          of missing it is unpaid earnings. ------------------------------------ */}
      {boutique && needsBankDetails && (
        <button
          onClick={() => navigate('/seller/onboarding')}
          style={css('width:100%;margin-top:14px;display:flex;align-items:center;gap:12px;text-align:left;border:1px solid var(--ag-warn-border,var(--ag-surface-3));background:var(--ag-warn-bg);border-radius:18px;padding:14px 16px;cursor:pointer;font-family:inherit;')}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-gold-text);font-size:22px;flex:none;")}>account_balance</span>
          <span style={css('flex:1;min-width:0;')}>
            <span style={css('display:block;font-size:13.5px;font-weight:800;color:var(--ag-warn-text);')}>Add your bank account to get paid</span>
            <span style={css('display:block;margin-top:3px;font-size:12px;font-weight:600;color:var(--ag-warn-text);opacity:.9;line-height:1.5;')}>
              MangaiMart settles earnings by bank transfer only. We can’t send your money until you add an account.
            </span>
          </span>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-gold-text);flex:none;")}>chevron_right</span>
        </button>
      )}

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
              <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:22px;color:${q.ic};`)}>{q.icon}</span>
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

      {/* Reviews. This used to be a lone tile under a "Grow your shop" eyebrow —
          a section heading over one card, with the card's own label repeating
          what the heading already said. It is now just the row it always was,
          in the same shape as the quick actions above it, saying in words what
          is waiting rather than only carrying a badge. -------------------- */}
      <button
        onClick={() => navigate('/seller/reviews')}
        className="agx-lift"
        style={css('width:100%;margin-top:12px;text-align:left;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:14px;display:flex;align-items:center;gap:11px;cursor:pointer;font-family:inherit;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);')}
      >
        <span style={css('width:42px;height:42px;flex:none;border-radius:13px;background:var(--ag-gold-bg);display:flex;align-items:center;justify-content:center;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:22px;color:var(--ag-gold-text);")}>reviews</span>
        </span>
        <span style={css('flex:1;min-width:0;')}>
          <span style={css('display:block;font-weight:800;font-size:14px;color:var(--ag-ink);')}>Reviews</span>
          <span style={css('display:block;font-size:11.5px;color:var(--ag-muted);font-weight:600;margin-top:1px;')}>
            {reviewsNeedingReply > 0
              ? `${reviewsNeedingReply} review${reviewsNeedingReply > 1 ? 's are' : ' is'} waiting for your reply`
              : rating > 0
                ? `${rating.toFixed(1)} out of 5 from your buyers`
                : 'See what buyers say about your pieces'}
          </span>
        </span>
        {reviewsNeedingReply > 0 && (
          <span style={css('flex:none;min-width:22px;height:22px;padding:0 7px;border-radius:11px;background:#D6336C;color:#fff;font-size:11.5px;font-weight:800;display:flex;align-items:center;justify-content:center;')}>
            {reviewsNeedingReply > 99 ? '99+' : reviewsNeedingReply}
          </span>
        )}
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;flex:none;")}>chevron_right</span>
      </button>

      {/* Promote CTA — an upsell, so it follows the seller's own numbers
          rather than outranking them. ---------------------------------------- */}
      <button
        onClick={() => navigate('/seller/promote')}
        className="agx-lift"
        style={css('width:100%;text-align:left;margin-top:16px;background:linear-gradient(135deg,#D6336C,#B02454);border:none;border-radius:18px;padding:15px 16px;display:flex;align-items:center;gap:13px;cursor:pointer;font-family:inherit;color:#fff;')}
      >
        <span style={css('width:42px;height:42px;flex:none;border-radius:13px;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:23px;")}>campaign</span>
        </span>
        <span style={css('flex:1;min-width:0;')}>
          <span style={css('display:block;font-weight:800;font-size:14.5px;')}>Promote your boutique</span>
          <span style={css('display:block;font-size:12px;opacity:.85;margin-top:1px;')}>Book an ad slot and reach more buyers</span>
        </span>
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';")}>chevron_right</span>
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
              <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:21px;color:${st.ic};`)}>{st.icon}</span>
            </span>
            <span style={css("display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(24px,3vw,31px);line-height:1;margin-top:13px;color:var(--ag-ink);word-break:break-word;")}>{st.value}</span>
            <span style={css('display:block;color:var(--ag-muted);font-size:12.5px;font-weight:600;margin-top:5px;')}>{st.label}</span>
            <span style={css('display:flex;align-items:center;gap:3px;color:var(--ag-crimson);font-size:11.5px;font-weight:800;margin-top:8px;')}>
              View all<span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;")}>chevron_right</span>
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
              View all<span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>chevron_right</span>
            </button>
          </div>

          <div style={css('display:flex;flex-direction:column;gap:10px;')}>
            {ordersLoading && <SkeletonRows rows={3} height={76} thumb={false} label="Loading orders…" />}
            {!ordersLoading && recentOrders.length === 0 && (
              <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:22px;text-align:center;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:30px;color:var(--ag-border);")}>receipt_long</span>
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
              Restock<span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>chevron_right</span>
            </button>
          </div>

          <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:8px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}>
            {lowStock.length === 0 && (
              <div style={css('padding:18px 12px;text-align:center;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:26px;color:#B6DCC6;")}>check_circle</span>
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
