import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { useAsync } from '@/hooks/useAsync';
import { supabase } from '@/lib/supabase';
import { fetchDashboard, type WindowStat, type DashboardData } from '@/data/admin';
import { useSettings } from '@/data/settings';
import { fetchActivity } from '@/data/activityLog';
import { SectionCard, StatusPill, Avatar, Icon, EmptyState, T } from '@/components/admin/kit';

const compactInr = (n: number) =>
  n >= 10000000 ? '₹' + (n / 10000000).toFixed(2) + 'Cr' : n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L' : n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'k' : fmtInr(n);

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
const RANGES: { key: RangeKey; label: string; cur: keyof DashboardData; prev: keyof DashboardData; vs: string }[] = [
  { key: 'today', label: 'Today', cur: 'today', prev: 'yesterday', vs: 'vs yesterday' },
  { key: 'week', label: '7 days', cur: 'week', prev: 'prevWeek', vs: 'vs prev 7 days' },
  { key: 'month', label: 'Month', cur: 'month', prev: 'prevMonth', vs: 'vs last month' },
  { key: 'year', label: 'Year', cur: 'year', prev: 'prevYear', vs: 'vs last year' },
];

export function Overview() {
  const { commission_pct: commissionPct } = useSettings();
  const navigate = useNavigate();
  const { data, loading, reload } = useAsync(() => fetchDashboard(), []);
  const { data: activity } = useAsync(() => fetchActivity(8), []);
  const [range, setRange] = useState<RangeKey>('today');

  // Live counters — refresh when any order changes.
  useEffect(() => {
    const ch = supabase
      .channel('admin-dashboard-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);

  const d = data;
  const rc = RANGES.find((r) => r.key === range)!;
  const cur = (d?.[rc.cur] as WindowStat | undefined) ?? { revenue: 0, orders: 0 };
  const prev = (d?.[rc.prev] as WindowStat | undefined) ?? { revenue: 0, orders: 0 };
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

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      {/* Range toolbar */}
      <div style={css('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;')}>
        <div style={css('display:flex;align-items:center;gap:8px;')}>
          <span style={css(`width:8px;height:8px;border-radius:50%;background:${loading ? 'var(--ag-warn-text)' : '#3FB27F'};box-shadow:0 0 0 4px ${loading ? 'var(--ag-warn-bg)' : 'var(--ag-good-bg)'};`)} />
          <span style={css(`font-size:12.5px;font-weight:700;color:${T.muted};`)}>{loading ? 'Syncing…' : 'Live'}</span>
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

      {/* Hero KPI band — reacts to the selected range */}
      <div className="agx-adm-g4">
        <HeroCard label={`Revenue · ${rc.label}`} value={compactInr(cur.revenue)} icon="payments" tint="var(--ag-bad-bg)" ic="#D6336C" trend={trend(cur.revenue, prev.revenue)} vs={rc.vs} bars={ordBars} />
        <HeroCard label={`Orders · ${rc.label}`} value={String(cur.orders)} icon="receipt_long" tint="var(--ag-info-bg)" ic="var(--ag-info-text)" trend={trend(cur.orders, prev.orders)} vs={rc.vs} bars={revBars} />
        <HeroCard label={`Avg. order · ${rc.label}`} value={compactInr(aov)} icon="shopping_cart" tint="#F3EAF5" ic="#9B7FC7" trend={trend(aov, prevAov)} vs={rc.vs} />
        <HeroCard label={`Platform earning · ${rc.label}`} value={compactInr(cur.revenue * (commissionPct / 100))} icon="account_balance" tint="var(--ag-warn-bg)" ic="#C99A3F" sub={`${commissionPct}% commission`} />
      </div>

      {/* Health-insight tiles + quick-nav counters */}
      <div className="agx-adm-g4">
        <InsightTile label="GMV (all time)" value={compactInr(d?.gmv ?? 0)} foot={`${d?.earnedOrders ?? 0} earned orders`} icon="trending_up" />
        <InsightTile label="Fulfillment rate" value={`${fulfillRate}%`} foot={`${d?.fulfilledOrders ?? 0} shipped/delivered`} icon="local_shipping" bar={fulfillRate} good />
        <InsightTile label="Refund rate" value={`${refundRate}%`} foot={`${compactInr(d?.refunds.amount ?? 0)} refunded`} icon="undo" bar={refundRate} danger />
        <InsightTile label="Online payments" value={`${onlinePct}%`} foot={`${paidTotal - (d?.paymentSplit.online ?? 0)} COD orders`} icon="credit_card" bar={onlinePct} />
      </div>

      {/* Quick-nav counters */}
      <div className="agx-adm-g5">
        {[
          { label: 'Buyers', value: d?.counts.buyers ?? 0, icon: 'group', to: '/admin/users' },
          { label: 'Sellers', value: d?.counts.sellers ?? 0, icon: 'storefront', to: '/admin/users' },
          { label: 'Pending approvals', value: d?.counts.pendingApprovals ?? 0, icon: 'verified', to: '/admin/approvals', hot: (d?.counts.pendingApprovals ?? 0) > 0 },
          { label: 'Pending orders', value: d?.counts.pendingOrders ?? 0, icon: 'local_shipping', to: '/admin/orders', hot: (d?.counts.pendingOrders ?? 0) > 0 },
          { label: 'Low stock', value: d?.counts.lowStock ?? 0, icon: 'inventory_2', to: '/admin/products', hot: (d?.counts.lowStock ?? 0) > 0 },
        ].map((c) => (
          <button key={c.label} onClick={() => navigate(c.to)} style={css(T.card + 'padding:16px;text-align:left;border:none;cursor:pointer;display:flex;align-items:center;gap:12px;font-family:inherit;position:relative;')}>
            <div style={css(`width:40px;height:40px;flex:none;border-radius:12px;background:${c.hot ? 'var(--ag-bad-bg)' : 'var(--ag-surface-2)'};display:flex;align-items:center;justify-content:center;`)}>
              <Icon name={c.icon} size={20} color={c.hot ? '#D6455A' : 'var(--ag-crimson)'} />
            </div>
            <div style={css('min-width:0;')}>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;line-height:1;")}>{c.value}</div>
              <div style={css(`color:${T.muted};font-size:12px;font-weight:600;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)}>{c.label}</div>
            </div>
            {c.hot && <span style={css('position:absolute;top:12px;right:12px;width:8px;height:8px;border-radius:50%;background:#D6455A;')} />}
          </button>
        ))}
      </div>

      {/* Revenue + orders chart + payment split */}
      <div className="agx-adm-split">
        <SectionCard
          title="Revenue & orders"
          action={
            <div style={css('display:flex;align-items:center;gap:14px;')}>
              <LegendDot color="#D6336C" label="Revenue" />
              <LegendDot color="#9B7FC7" label="Orders" />
              <span style={css(`font-size:12px;color:${T.muted};font-weight:700;`)}>14 days</span>
            </div>
          }
        >
          <div style={css('position:relative;height:200px;')}>
            {/* horizontal gridlines */}
            {[0, 1, 2, 3].map((g) => (
              <div key={g} style={css(`position:absolute;left:0;right:0;top:${(g / 3) * 100}%;height:1px;background:var(--ag-border-soft);`)} />
            ))}
            {/* revenue bars */}
            <div style={css('position:absolute;inset:0;display:flex;align-items:flex-end;gap:6px;')}>
              {revBars.map((b, i) => (
                <div key={i} title={`${d?.revenueSeries[i]?.label}: ${fmtInr(b)} · ${ordBars[i] ?? 0} orders`} style={css('flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;')}>
                  <div style={css(`width:100%;border-radius:6px 6px 3px 3px;background:linear-gradient(180deg,#E7719F,#D6336C);height:${Math.max(3, Math.round((b / maxRev) * 100))}%;transition:height .3s;`)} />
                </div>
              ))}
            </div>
            {/* orders overlay line */}
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
            <Legend color="var(--ag-border)" label="Cash on delivery" value={d?.paymentSplit.cod ?? 0} />
          </div>
        </SectionCard>
      </div>

      {/* Recent orders + top boutiques */}
      <div className="agx-adm-split2">
        <SectionCard title="Recent orders" action={<button onClick={() => navigate('/admin/orders')} style={css(`border:none;background:none;color:${T.accent};font-weight:700;font-size:12.5px;cursor:pointer;`)}>View all</button>}>
          {(d?.recentOrders ?? []).length === 0 ? (
            <EmptyState icon="receipt_long" title="No orders yet" />
          ) : (
            <div style={css('display:flex;flex-direction:column;')}>
              {(d?.recentOrders ?? []).map((o) => (
                <div key={o.id} onClick={() => navigate('/admin/orders')} style={css('display:flex;align-items:center;gap:11px;padding:10px 0;border-top:1px solid var(--ag-border-soft);cursor:pointer;')}>
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

        <SectionCard title="Top boutiques" action={<button onClick={() => navigate('/admin/reports')} style={css(`border:none;background:none;color:${T.accent};font-weight:700;font-size:12.5px;cursor:pointer;`)}>Reports</button>}>
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

      {/* Top products + low stock + activity */}
      <div className="agx-adm-g3">
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

        <SectionCard title="Low stock" action={<button onClick={() => navigate('/admin/products')} style={css(`border:none;background:none;color:${T.accent};font-weight:700;font-size:12.5px;cursor:pointer;`)}>Manage</button>}>
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

        <SectionCard title="Activity" action={<button onClick={() => navigate('/admin/notifications')} style={css(`border:none;background:none;color:${T.accent};font-weight:700;font-size:12.5px;cursor:pointer;`)}>All</button>}>
          {(activity ?? []).length === 0 ? <EmptyState icon="history" title="No admin actions yet" /> : (
            <div style={css('display:flex;flex-direction:column;gap:11px;')}>
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
      </div>
    </div>
  );
}

/** Hero KPI card with a coloured period-over-period trend chip + optional sparkline. */
function HeroCard({
  label, value, icon, tint, ic, trend: tr, vs, sub, bars,
}: {
  label: string; value: string; icon: string; tint: string; ic: string;
  trend?: { label: string; dir: 'up' | 'down' | 'flat' }; vs?: string; sub?: string; bars?: number[];
}) {
  const max = bars && bars.length ? Math.max(...bars, 1) : 1;
  const trColor = tr?.dir === 'up' ? 'var(--ag-good-text)' : tr?.dir === 'down' ? 'var(--ag-bad-text)' : T.muted;
  const trBg = tr?.dir === 'up' ? 'var(--ag-good-bg)' : tr?.dir === 'down' ? 'var(--ag-bad-bg)' : 'var(--ag-surface-2)';
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
        {!tr && sub && <span style={css(`font-size:12px;font-weight:800;color:${T.muted};`)}>{sub}</span>}
      </div>
      <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:30px;line-height:1;margin-top:14px;")}>{value}</div>
      <div style={css(`color:${T.muted};font-size:12.5px;font-weight:600;margin-top:3px;`)}>{label}</div>
      {vs && <div style={css(`color:${T.muted};font-size:10.5px;font-weight:600;margin-top:2px;opacity:.8;`)}>{vs}</div>}
      {bars && bars.length > 0 && (
        <div style={css('display:flex;align-items:flex-end;gap:3px;height:30px;margin-top:12px;')}>
          {bars.map((b, i) => (
            <div key={i} style={css(`flex:1;border-radius:3px 3px 1px 1px;background:linear-gradient(180deg,#E7719F,#D6336C);opacity:${0.35 + (i / bars.length) * 0.65};height:${Math.max(6, Math.round((b / max) * 100))}%;`)} />
          ))}
        </div>
      )}
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
