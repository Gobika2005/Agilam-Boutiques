import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { useAsync } from '@/hooks/useAsync';
import { supabase } from '@/lib/supabase';
import { fetchDashboard, type WindowStat, type DashboardData } from '@/data/admin';
import { fetchEarnings, grossIncome, netProfit, blankWindow, type EarningsWindow } from '@/data/earnings';
import { fetchActivity } from '@/data/activityLog';
import { adminPath } from '@/lib/adminPath';
import { SectionCard, StatusPill, Avatar, Icon, EmptyState, TabBar, T } from '@/components/admin/kit';
import { Reports } from '@/pages/admin/Reports';
import { SkeletonTiles } from '@/components/ui/Skeleton';

const compactAbs = (n: number) =>
  n >= 10000000 ? '₹' + (n / 10000000).toFixed(2) + 'Cr' : n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L' : n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'k' : fmtInr(n);

/** Sign-aware, so a loss-making month reads "−₹4.2k" rather than "₹-4,200". */
const compactInr = (n: number) => (n < 0 ? '−' : '') + compactAbs(Math.abs(n));

const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/** Period-over-period trend as a signed percentage + direction, for coloured chips. */
const trend = (cur: number, prev: number): { label: string; dir: 'up' | 'down' | 'flat' } => {
  if (prev === 0) return cur > 0 ? { label: 'new', dir: 'up' } : { label: '—', dir: 'flat' };
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return { label: '0%', dir: 'flat' };
  return { label: `${Math.abs(pct)}%`, dir: pct > 0 ? 'up' : 'down' };
};

type RangeKey = 'today' | 'week' | 'month' | 'year';
type CurKey = 'today' | 'week' | 'month' | 'year';
type PrevKey = 'yesterday' | 'prevWeek' | 'prevMonth' | 'prevYear';
/** Both `DashboardData` and `EarningsData` key their windows the same way, so one
 *  range toolbar drives the platform books and the marketplace panel together. */
const RANGES: { key: RangeKey; label: string; cur: CurKey; prev: PrevKey; vs: string }[] = [
  { key: 'today', label: 'Today', cur: 'today', prev: 'yesterday', vs: 'vs yesterday' },
  { key: 'week', label: '7 days', cur: 'week', prev: 'prevWeek', vs: 'vs prev 7 days' },
  { key: 'month', label: 'Month', cur: 'month', prev: 'prevMonth', vs: 'vs last month' },
  { key: 'year', label: 'Year', cur: 'year', prev: 'prevYear', vs: 'vs last year' },
];

/**
 * Overview — MangaiMart's own books, with Reports & Analytics as a tab.
 *
 * The dashboard used to lead with GMV: the headline figures were the
 * marketplace's turnover, which is the sellers' money, and the platform's own
 * earning was one tile in the corner. It now leads with what the business
 * actually keeps — commission, ad income, the discounts and expenses it funds,
 * and the net — with the marketplace numbers demoted to a panel you open when
 * you want them (`MarketplaceActivity`, collapsed by default).
 *
 * The console's own `reports` path still resolves — App.tsx redirects it here.
 */
const OVERVIEW_TABS = [
  { key: 'health' as const, label: 'Overview' },
  { key: 'reports' as const, label: 'Reports & Analytics' },
];

export function Overview() {
  const [tab, setTab] = useState<'health' | 'reports'>('health');
  return (
    <div>
      <TabBar tabs={OVERVIEW_TABS} value={tab} onChange={setTab} />
      {tab === 'health' ? <PlatformBooks /> : <Reports />}
    </div>
  );
}

const MARKETPLACE_OPEN_KEY = 'ag_admin_marketplace_open';

function PlatformBooks() {
  const navigate = useNavigate();
  const { data: earn, loading: earnLoading, reload: reloadEarn } = useAsync(() => fetchEarnings(), []);
  const { data, loading, reload } = useAsync(() => fetchDashboard(), []);
  const { data: activity } = useAsync(() => fetchActivity(8), []);
  const [range, setRange] = useState<RangeKey>('today');
  const [showMarket, setShowMarket] = useState(() => {
    try { return localStorage.getItem(MARKETPLACE_OPEN_KEY) === '1'; } catch { return false; }
  });

  const toggleMarket = () => {
    setShowMarket((v) => {
      try { localStorage.setItem(MARKETPLACE_OPEN_KEY, v ? '0' : '1'); } catch { /* private mode */ }
      return !v;
    });
  };

  // Live counters — refresh when any order changes.
  useEffect(() => {
    const ch = supabase
      .channel('admin-dashboard-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { reload(); reloadEarn(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload, reloadEarn]);

  const rc = RANGES.find((r) => r.key === range)!;
  const e = earn?.[rc.cur] ?? blankWindow();
  const ePrev = earn?.[rc.prev] ?? blankWindow();
  const busy = loading || earnLoading;

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      {/* Range toolbar */}
      <div style={css('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;')}>
        <div style={css('display:flex;align-items:center;gap:8px;')}>
          <span style={css(`width:8px;height:8px;border-radius:50%;background:${busy ? 'var(--ag-warn-text)' : '#3FB27F'};box-shadow:0 0 0 4px ${busy ? 'var(--ag-warn-bg)' : 'var(--ag-good-bg)'};`)} />
          <span style={css(`font-size:12.5px;font-weight:700;color:${T.muted};`)}>{busy ? 'Syncing…' : 'Live'}</span>
        </div>
        <div style={css('display:flex;background:var(--ag-surface-2);border-radius:12px;padding:4px;gap:2px;')}>
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              style={css(`border:none;cursor:pointer;font-family:inherit;font-weight:800;font-size:12.5px;padding:7px 15px;border-radius:9px;transition:.15s;background:${range === r.key ? 'var(--ag-surface)' : 'transparent'};color:${range === r.key ? 'var(--ag-crimson)' : T.muted};box-shadow:${range === r.key ? '0 6px 16px -12px var(--ag-shadow)' : 'none'};`)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Hero band — MangaiMart's money only.
          On the very first load `earn` is null, so every figure below would
          compute to a real-looking ₹0. Skeletons instead: an empty platform and
          an unloaded one must not look the same. */}
      {earnLoading && !earn ? (
        <SkeletonTiles count={4} height={148} className="agx-adm-g4" />
      ) : (
        <div className="agx-adm-g4">
          <HeroCard
            label={`Platform earnings · ${rc.label}`}
            value={compactInr(e.commission)}
            icon="account_balance"
            tint="var(--ag-bad-bg)"
            ic="#D6336C"
            trend={trend(e.commission, ePrev.commission)}
            vs={rc.vs}
            foot={`${earn?.commissionPct ?? 0}% of ${e.deliveredOrders} delivered order${e.deliveredOrders === 1 ? '' : 's'}`}
          />
          <HeroCard
            label={`Ad earnings · ${rc.label}`}
            value={compactInr(e.ads)}
            icon="campaign"
            tint="var(--ag-warn-bg)"
            ic="var(--ag-gold-text)"
            trend={trend(e.ads, ePrev.ads)}
            vs={rc.vs}
            foot={`${e.paidCampaigns} paid campaign${e.paidCampaigns === 1 ? '' : 's'}`}
          />
          <HeroCard
            label={`Expenses · ${rc.label}`}
            value={compactInr(e.expenses)}
            icon="savings"
            tint="var(--ag-info-bg)"
            ic="var(--ag-info-text)"
            trend={trend(e.expenses, ePrev.expenses)}
            vs={rc.vs}
            invert
            foot={earn?.expensesUnavailable ? 'expenses table not yet created' : 'recorded platform spend'}
          />
          <HeroCard
            label={`Net profit · ${rc.label}`}
            value={compactInr(netProfit(e))}
            icon="trending_up"
            tint="var(--ag-good-bg)"
            ic="var(--ag-good-text)"
            trend={trend(netProfit(e), netProfit(ePrev))}
            vs={rc.vs}
            negative={netProfit(e) < 0}
            foot="income − coupons, refunds, expenses"
          />
        </div>
      )}

      {/* The books in full + the daily income trace */}
      <div className="agx-adm-split">
        <SectionCard
          title="Income & expenses"
          action={<span style={css(`font-size:11.5px;font-weight:700;color:${T.muted};`)}>{rc.label}</span>}
        >
          <PnlSheet w={e} />
          <div style={css(`margin-top:14px;padding-top:12px;border-top:1px solid ${T.border};display:flex;flex-direction:column;gap:7px;`)}>
            <Note icon="schedule">
              {compactInr(earn?.pipeline.commission ?? 0)} commission on {earn?.pipeline.orders ?? 0} order
              {(earn?.pipeline.orders ?? 0) === 1 ? '' : 's'} in flight — earned once delivered.
            </Note>
            {(earn?.undatedDelivered ?? 0) > 0 && (
              <Note icon="info">
                {earn?.undatedDelivered} older delivered order{(earn?.undatedDelivered ?? 0) === 1 ? '' : 's'} carry no
                delivery date, so they are booked on their order date.
              </Note>
            )}
            {earn?.expensesUnavailable && (
              <Note icon="warning">Expenses are not being counted — migration 0056 must be applied.</Note>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Earnings trend"
          action={
            <div style={css('display:flex;align-items:center;gap:14px;')}>
              <LegendDot color="#D6336C" label="Commission" />
              <LegendDot color="var(--ag-gold-text)" label="Ads" />
              <span style={css(`font-size:12px;color:${T.muted};font-weight:700;`)}>14 days</span>
            </div>
          }
        >
          <EarningsTrend rows={earn?.series ?? []} />
        </SectionCard>
      </div>

      {/* Quick-nav counters — the queues that need an admin, not marketplace stats */}
      <div className="agx-adm-g5">
        {[
          { label: 'Buyers', value: data?.counts.buyers ?? 0, icon: 'group', to: adminPath('users') },
          { label: 'Sellers', value: data?.counts.sellers ?? 0, icon: 'storefront', to: adminPath('users') },
          { label: 'Pending approvals', value: data?.counts.pendingApprovals ?? 0, icon: 'verified', to: adminPath('approvals'), hot: (data?.counts.pendingApprovals ?? 0) > 0 },
          { label: 'Pending orders', value: data?.counts.pendingOrders ?? 0, icon: 'local_shipping', to: adminPath('orders'), hot: (data?.counts.pendingOrders ?? 0) > 0 },
          { label: 'Low stock', value: data?.counts.lowStock ?? 0, icon: 'inventory_2', to: adminPath('products'), hot: (data?.counts.lowStock ?? 0) > 0 },
        ].map((c) => (
          <button key={c.label} onClick={() => navigate(c.to)} style={css(T.card + 'padding:16px;text-align:left;border:none;cursor:pointer;display:flex;align-items:center;gap:12px;font-family:inherit;position:relative;')}>
            <div style={css(`width:40px;height:40px;flex:none;border-radius:12px;background:${c.hot ? 'var(--ag-bad-bg)' : 'var(--ag-surface-2)'};display:flex;align-items:center;justify-content:center;`)}>
              <Icon name={c.icon} size={20} color={c.hot ? 'var(--ag-danger-text)' : 'var(--ag-crimson)'} />
            </div>
            <div style={css('min-width:0;')}>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;line-height:1;")}>{c.value}</div>
              <div style={css(`color:${T.muted};font-size:12px;font-weight:600;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)}>{c.label}</div>
            </div>
            {c.hot && <span style={css('position:absolute;top:12px;right:12px;width:8px;height:8px;border-radius:50%;background:var(--ag-danger-text);')} />}
          </button>
        ))}
      </div>

      <SectionCard title="Activity" action={<button onClick={() => navigate(adminPath('notifications'))} style={css(`border:none;background:none;color:${T.accent};font-weight:700;font-size:12.5px;cursor:pointer;`)}>All</button>}>
        {(activity ?? []).length === 0 ? <EmptyState icon="history" title="No admin actions yet" /> : (
          <div style={css('display:grid;gap:11px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));')}>
            {(activity ?? []).map((a) => (
              <div key={a.id} style={css('display:flex;gap:10px;')}>
                <div style={css('width:8px;height:8px;border-radius:50%;background:#D6336C;margin-top:5px;flex:none;')} />
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('font-weight:700;font-size:12.5px;')}>{a.action.replace(/[._]/g, ' ')}</div>
                  <div style={css(`font-size:11px;color:${T.muted};`)}>{a.actor_name} · {timeAgo(a.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Marketplace activity — the sellers' numbers. Kept, but out of the way:
          this is turnover the platform handles, not money it earns. */}
      <div style={css(T.card + 'padding:0;overflow:hidden;')}>
        <button
          onClick={toggleMarket}
          aria-expanded={showMarket}
          style={css('width:100%;display:flex;align-items:center;gap:12px;padding:18px 20px;background:none;border:none;cursor:pointer;font-family:inherit;text-align:left;')}
        >
          <div style={css('width:38px;height:38px;flex:none;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
            <Icon name="storefront" size={20} color={T.accent} />
          </div>
          <div style={css('flex:1;min-width:0;')}>
            <div style={css('font-weight:800;font-size:15px;')}>Marketplace activity</div>
            <div style={css(`font-size:12px;color:${T.muted};font-weight:600;margin-top:2px;`)}>
              {compactInr(data?.gmv ?? 0)} GMV all time · {data?.earnedOrders ?? 0} orders · seller turnover, not platform income
            </div>
          </div>
          <Icon name={showMarket ? 'expand_less' : 'expand_more'} size={22} color={T.muted} />
        </button>
        {showMarket && (
          <div style={css(`padding:0 20px 20px;border-top:1px solid ${T.border};`)}>
            <MarketplaceActivity d={data} loading={loading} range={rc} navigate={navigate} />
          </div>
        )}
      </div>
    </div>
  );
}

/** The P&L, as a plain sheet of lines rather than a wall of tiles. */
function PnlSheet({ w }: { w: EarningsWindow }) {
  const gross = grossIncome(w);
  const net = netProfit(w);
  return (
    <div style={css('display:flex;flex-direction:column;')}>
      <PnlRow label="Commission earned" value={w.commission} kind="in" />
      <PnlRow label="Ad placements sold" value={w.ads} kind="in" />
      <PnlRow label="Gross income" value={gross} kind="sub" />
      <PnlRow label="Platform coupons funded" value={-w.couponCost} kind="out" />
      <PnlRow label="Refund reversals" value={-w.refundReversal} kind="out" />
      <PnlRow label="Platform expenses" value={-w.expenses} kind="out" />
      <PnlRow label="Net profit" value={net} kind="total" />
    </div>
  );
}

function PnlRow({ label, value, kind }: { label: string; value: number; kind: 'in' | 'out' | 'sub' | 'total' }) {
  const total = kind === 'total';
  const sub = kind === 'sub';
  const strong = total || sub;
  const color = total
    ? (value < 0 ? 'var(--ag-danger-text)' : 'var(--ag-good-text)')
    : kind === 'out' && value !== 0
      ? 'var(--ag-bad-text)'
      : T.ink;
  return (
    <div style={css(`display:flex;align-items:center;justify-content:space-between;gap:12px;padding:${total ? '13px 0 2px' : '9px 0'};${strong ? `border-top:1px solid ${T.border};margin-top:${total ? '4px' : '2px'};` : ''}`)}>
      <span style={css(`font-size:${total ? '14px' : '13px'};font-weight:${strong ? 800 : 600};color:${strong ? T.ink : T.muted};`)}>{label}</span>
      <span style={css(`font-size:${total ? '19px' : '13.5px'};font-weight:800;color:${color};${total ? "font-family:'Playfair Display',serif;" : ''}`)}>
        {value < 0 ? '−' : ''}{fmtInr(Math.abs(value))}
      </span>
    </div>
  );
}

function Note({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div style={css(`display:flex;gap:7px;align-items:flex-start;font-size:11.5px;color:${T.muted};font-weight:600;line-height:1.45;`)}>
      <span style={css('flex:none;margin-top:1px;')}><Icon name={icon} size={14} color={T.muted} /></span>
      <span>{children}</span>
    </div>
  );
}

/** 14-day stacked bars: commission at the base, ad income on top. */
function EarningsTrend({ rows }: { rows: { label: string; commission: number; ads: number }[] }) {
  const max = Math.max(...rows.map((r) => r.commission + r.ads), 1);
  if (rows.length === 0 || max === 1) {
    return <EmptyState icon="account_balance" title="Nothing earned yet" sub="Commission books when an order is delivered." />;
  }
  return (
    <>
      <div style={css('position:relative;height:200px;')}>
        {[0, 1, 2, 3].map((g) => (
          <div key={g} style={css(`position:absolute;left:0;right:0;top:${(g / 3) * 100}%;height:1px;background:var(--ag-border-soft);`)} />
        ))}
        <div style={css('position:absolute;inset:0;display:flex;align-items:flex-end;gap:6px;')}>
          {rows.map((r, i) => {
            const totalPct = ((r.commission + r.ads) / max) * 100;
            const adsPct = r.commission + r.ads > 0 ? (r.ads / (r.commission + r.ads)) * 100 : 0;
            return (
              <div key={i} title={`${r.label}: ${fmtInr(r.commission)} commission + ${fmtInr(r.ads)} ads`} style={css('flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;')}>
                <div style={css(`width:100%;border-radius:6px 6px 3px 3px;overflow:hidden;display:flex;flex-direction:column;height:${Math.max(2, Math.round(totalPct))}%;transition:height .3s;`)}>
                  <div style={css(`height:${adsPct}%;background:var(--ag-gold-text);`)} />
                  <div style={css('flex:1;background:linear-gradient(180deg,#E7719F,#D6336C);')} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={css(`display:flex;justify-content:space-between;margin-top:10px;font-size:10.5px;color:${T.muted};`)}>
        <span>{rows[0]?.label}</span>
        <span>{rows[Math.floor((rows.length - 1) / 2)]?.label}</span>
        <span>{rows[rows.length - 1]?.label}</span>
      </div>
    </>
  );
}

/** Everything that belongs to the sellers rather than to MangaiMart. */
function MarketplaceActivity({
  d, loading, range, navigate,
}: {
  d: DashboardData | null;
  loading: boolean;
  range: { label: string; cur: CurKey; prev: PrevKey; vs: string };
  navigate: (to: string) => void;
}) {
  const cur = (d?.[range.cur] as WindowStat | undefined) ?? { revenue: 0, orders: 0 };
  const prev = (d?.[range.prev] as WindowStat | undefined) ?? { revenue: 0, orders: 0 };
  const aov = cur.orders > 0 ? cur.revenue / cur.orders : 0;
  const prevAov = prev.orders > 0 ? prev.revenue / prev.orders : 0;

  const revBars = (d?.revenueSeries ?? []).map((s) => s.value);
  const ordBars = (d?.orderSeries ?? []).map((s) => s.value);
  const maxRev = Math.max(...revBars, 1);
  const maxOrd = Math.max(...ordBars, 1);

  const fulfillRate = d && d.earnedOrders > 0 ? Math.round((d.fulfilledOrders / d.earnedOrders) * 100) : 0;
  const refundRate = d && d.earnedOrders + d.refunds.count > 0 ? Math.round((d.refunds.count / (d.earnedOrders + d.refunds.count)) * 100) : 0;
  const paidTotal = (d?.paymentSplit.online ?? 0) + (d?.paymentSplit.cod ?? 0);
  const onlinePct = paidTotal > 0 ? Math.round(((d?.paymentSplit.online ?? 0) / paidTotal) * 100) : 0;

  if (loading && !d) return <SkeletonTiles count={4} height={118} className="agx-adm-g4" />;

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;padding-top:16px;')}>
      <div className="agx-adm-g4">
        <InsightTile label={`GMV · ${range.label}`} value={compactInr(cur.revenue)} foot={`${trend(cur.revenue, prev.revenue).label} ${range.vs}`} icon="payments" />
        <InsightTile label={`Orders · ${range.label}`} value={String(cur.orders)} foot={`${trend(cur.orders, prev.orders).label} ${range.vs}`} icon="receipt_long" />
        <InsightTile label={`Avg. order · ${range.label}`} value={compactInr(aov)} foot={`${trend(aov, prevAov).label} ${range.vs}`} icon="shopping_cart" />
        <InsightTile label="GMV (all time)" value={compactInr(d?.gmv ?? 0)} foot={`${d?.earnedOrders ?? 0} earned orders`} icon="trending_up" />
      </div>

      <div className="agx-adm-g3">
        <InsightTile label="Fulfillment rate" value={`${fulfillRate}%`} foot={`${d?.fulfilledOrders ?? 0} shipped/delivered`} icon="local_shipping" bar={fulfillRate} good />
        <InsightTile label="Refund rate" value={`${refundRate}%`} foot={`${compactInr(d?.refunds.amount ?? 0)} refunded`} icon="undo" bar={refundRate} danger />
        {/* Below 100% only because of orders placed before cash on delivery
            was withdrawn (migration 0085) — every new order is prepaid. */}
        <InsightTile label="Online payments" value={`${onlinePct}%`} foot={`${paidTotal - (d?.paymentSplit.online ?? 0)} legacy cash orders`} icon="credit_card" bar={onlinePct} />
      </div>

      <div className="agx-adm-split">
        <SectionCard
          title="GMV & orders"
          action={
            <div style={css('display:flex;align-items:center;gap:14px;')}>
              <LegendDot color="#D6336C" label="GMV" />
              <LegendDot color="#9B7FC7" label="Orders" />
              <span style={css(`font-size:12px;color:${T.muted};font-weight:700;`)}>14 days</span>
            </div>
          }
        >
          <div style={css('position:relative;height:200px;')}>
            {[0, 1, 2, 3].map((g) => (
              <div key={g} style={css(`position:absolute;left:0;right:0;top:${(g / 3) * 100}%;height:1px;background:var(--ag-border-soft);`)} />
            ))}
            <div style={css('position:absolute;inset:0;display:flex;align-items:flex-end;gap:6px;')}>
              {revBars.map((b, i) => (
                <div key={i} title={`${d?.revenueSeries[i]?.label}: ${fmtInr(b)} · ${ordBars[i] ?? 0} orders`} style={css('flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;')}>
                  <div style={css(`width:100%;border-radius:6px 6px 3px 3px;background:linear-gradient(180deg,#E7719F,#D6336C);height:${Math.max(3, Math.round((b / maxRev) * 100))}%;transition:height .3s;`)} />
                </div>
              ))}
            </div>
            {ordBars.length > 1 && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={css('position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;')}>
                <polyline
                  fill="none"
                  stroke="#9B7FC7"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  points={ordBars.map((o, i) => `${(i + 0.5) / ordBars.length * 100},${100 - (o / maxOrd) * 88 - 6}`).join(' ')}
                />
              </svg>
            )}
          </div>
          <div style={css(`display:flex;justify-content:space-between;margin-top:10px;font-size:10.5px;color:${T.muted};`)}>
            <span>{d?.revenueSeries[0]?.label}</span>
            <span>{d?.revenueSeries[Math.floor((revBars.length - 1) / 2)]?.label}</span>
            <span>{d?.revenueSeries[revBars.length - 1]?.label}</span>
          </div>
        </SectionCard>

        <SectionCard title="Payment mix">
          <PaySplit online={d?.paymentSplit.online ?? 0} cod={d?.paymentSplit.cod ?? 0} />
          <div style={css('margin-top:16px;display:flex;flex-direction:column;gap:10px;')}>
            <Legend color="#D6336C" label="Online (Razorpay)" value={d?.paymentSplit.online ?? 0} />
            <Legend color="var(--ag-border)" label="Cash on delivery (withdrawn)" value={d?.paymentSplit.cod ?? 0} />
          </div>
        </SectionCard>
      </div>

      <div className="agx-adm-split2">
        <SectionCard title="Recent orders" action={<button onClick={() => navigate(adminPath('orders'))} style={css(`border:none;background:none;color:${T.accent};font-weight:700;font-size:12.5px;cursor:pointer;`)}>View all</button>}>
          {(d?.recentOrders ?? []).length === 0 ? (
            <EmptyState icon="receipt_long" title="No orders yet" />
          ) : (
            <div style={css('display:flex;flex-direction:column;')}>
              {(d?.recentOrders ?? []).map((o) => (
                <div key={o.id} onClick={() => navigate(adminPath('orders'))} style={css('display:flex;align-items:center;gap:11px;padding:10px 0;border-top:1px solid var(--ag-border-soft);cursor:pointer;')}>
                  <Avatar name={o.name} tone={o.order_number.charCodeAt(o.order_number.length - 1) % 8} />
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{o.order_number} · {o.name}</div>
                    <div style={css(`font-size:11.5px;color:${T.muted};`)}>{o.boutique} · {timeAgo(o.created_at)}</div>
                  </div>
                  <div style={css('text-align:right;flex:none;')}>
                    <div style={css('font-weight:800;font-size:13px;')}>{fmtInr(o.total)}</div>
                    <StatusPill status={o.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Top boutiques">
          {(d?.topBoutiques ?? []).length === 0 ? <EmptyState icon="storefront" title="No sales yet" /> : (
            <div style={css('display:flex;flex-direction:column;gap:12px;')}>
              {(d?.topBoutiques ?? []).map((b) => (
                <div key={b.id} style={css('display:flex;align-items:center;gap:11px;')}>
                  <Avatar name={b.name} tone={b.tone} />
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{b.name}</div>
                    <div style={css(`font-size:11.5px;color:${T.muted};`)}>{b.orders} orders</div>
                  </div>
                  <div style={css(`font-weight:800;font-size:12.5px;color:${T.accent};flex:none;`)}>{compactInr(b.revenue)}</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="agx-adm-g2">
        <SectionCard title="Top products">
          {(d?.topProducts ?? []).length === 0 ? <EmptyState icon="local_mall" title="No sales yet" /> : (
            <div style={css('display:flex;flex-direction:column;gap:11px;')}>
              {(d?.topProducts ?? []).map((p, i) => (
                <div key={p.title} style={css('display:flex;align-items:center;gap:10px;')}>
                  <span style={css(`width:22px;height:22px;flex:none;border-radius:7px;background:var(--ag-surface-2);color:${T.accent};font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center;`)}>{i + 1}</span>
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('font-weight:700;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{p.title}</div>
                    <div style={css(`font-size:11px;color:${T.muted};`)}>{p.qty} sold</div>
                  </div>
                  <div style={css('font-weight:800;font-size:12px;flex:none;')}>{compactInr(p.revenue)}</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Low stock" action={<button onClick={() => navigate(adminPath('products'))} style={css(`border:none;background:none;color:${T.accent};font-weight:700;font-size:12.5px;cursor:pointer;`)}>Manage</button>}>
          {(d?.lowStockList ?? []).length === 0 ? <EmptyState icon="check_circle" title="All stocked" /> : (
            <div style={css('display:flex;flex-direction:column;gap:10px;')}>
              {(d?.lowStockList ?? []).slice(0, 6).map((p) => (
                <div key={p.id} style={css('display:flex;align-items:center;gap:10px;')}>
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('font-weight:700;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{p.title}</div>
                    <div style={css(`font-size:11px;color:${T.muted};`)}>{p.boutique}</div>
                  </div>
                  <StatusPill status={p.stock === 0 ? 'rejected' : 'pending'} label={p.stock === 0 ? 'Out' : `${p.stock} left`} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/** Hero KPI card with a coloured period-over-period trend chip. */
function HeroCard({
  label, value, icon, tint, ic, trend: tr, vs, foot, invert, negative,
}: {
  label: string; value: string; icon: string; tint: string; ic: string;
  trend?: { label: string; dir: 'up' | 'down' | 'flat' }; vs?: string; foot?: string;
  /** For cost tiles, where spending more is the bad direction. */
  invert?: boolean;
  /** Paints the figure red — a negative net. */
  negative?: boolean;
}) {
  const good = invert ? 'down' : 'up';
  const trColor = tr?.dir === 'flat' ? T.muted : tr?.dir === good ? 'var(--ag-good-text)' : 'var(--ag-bad-text)';
  const trBg = tr?.dir === 'flat' ? 'var(--ag-surface-2)' : tr?.dir === good ? 'var(--ag-good-bg)' : 'var(--ag-bad-bg)';
  return (
    <div style={css(T.card + 'padding:18px;')}>
      <div style={css('display:flex;align-items:center;justify-content:space-between;')}>
        <div style={css(`width:38px;height:38px;border-radius:12px;background:${tint};display:flex;align-items:center;justify-content:center;`)}>
          <Icon name={icon} size={21} color={ic} />
        </div>
        {tr && (
          <span style={css(`display:inline-flex;align-items:center;gap:2px;font-size:11.5px;font-weight:800;padding:3px 8px;border-radius:8px;background:${trBg};color:${trColor};`)}>
            {tr.dir !== 'flat' && <Icon name={tr.dir === 'up' ? 'arrow_upward' : 'arrow_downward'} size={13} />}
            {tr.label}
          </span>
        )}
      </div>
      <div style={css(`font-family:'Playfair Display',serif;font-weight:700;font-size:30px;line-height:1;margin-top:14px;${negative ? 'color:var(--ag-danger-text);' : ''}`)}>{value}</div>
      <div style={css(`color:${T.muted};font-size:12.5px;font-weight:600;margin-top:3px;`)}>{label}</div>
      {vs && <div style={css(`color:${T.muted};font-size:10.5px;font-weight:600;margin-top:2px;opacity:.8;`)}>{vs}</div>}
      {foot && <div style={css(`color:${T.muted};font-size:10.5px;font-weight:600;margin-top:8px;opacity:.9;`)}>{foot}</div>}
    </div>
  );
}

/** Compact health tile with a value, a supporting line and an optional progress bar. */
function InsightTile({ label, value, foot, icon, bar, good, danger }: {
  label: string; value: string; foot: string; icon: string; bar?: number; good?: boolean; danger?: boolean;
}) {
  const barColor = danger ? 'var(--ag-bad-text)' : good ? 'var(--ag-good-text)' : '#D6336C';
  return (
    <div style={css(T.card + 'padding:16px;')}>
      <div style={css('display:flex;align-items:center;gap:8px;')}>
        <Icon name={icon} size={18} color={T.muted} />
        <span style={css(`font-size:12px;font-weight:700;color:${T.muted};`)}>{label}</span>
      </div>
      <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;line-height:1;margin-top:10px;")}>{value}</div>
      {bar !== undefined && (
        <div style={css('height:6px;border-radius:99px;background:var(--ag-surface-2);margin-top:10px;overflow:hidden;')}>
          <div style={css(`height:100%;border-radius:99px;background:${barColor};width:${Math.min(100, Math.max(2, bar))}%;`)} />
        </div>
      )}
      <div style={css(`color:${T.muted};font-size:11px;font-weight:600;margin-top:8px;`)}>{foot}</div>
    </div>
  );
}

function PaySplit({ online, cod }: { online: number; cod: number }) {
  const total = online + cod || 1;
  const pct = Math.round((online / total) * 100);
  return (
    <div style={css('display:flex;flex-direction:column;align-items:center;padding:8px 0;')}>
      <div style={css('position:relative;width:120px;height:120px;border-radius:50%;')}>
        <div style={css(`position:absolute;inset:0;border-radius:50%;background:conic-gradient(#D6336C ${pct}%, var(--ag-border) 0);`)} />
        <div style={css('position:absolute;inset:14px;border-radius:50%;background:var(--ag-surface);display:flex;flex-direction:column;align-items:center;justify-content:center;')}>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:22px;line-height:1;")}>{pct}%</div>
          <div style={css('font-size:10px;color:var(--ag-muted);')}>online</div>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div style={css('display:flex;align-items:center;gap:8px;')}>
      <span style={css(`width:10px;height:10px;border-radius:3px;background:${color};`)} />
      <span style={css('font-size:12.5px;font-weight:600;flex:1;')}>{label}</span>
      <span style={css('font-size:12.5px;font-weight:800;')}>{value}</span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={css(`display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;color:${T.muted};`)}>
      <span style={css(`width:9px;height:9px;border-radius:50%;background:${color};`)} />
      {label}
    </span>
  );
}
