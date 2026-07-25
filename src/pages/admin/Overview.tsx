import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { useAsync } from '@/hooks/useAsync';
import { supabase } from '@/lib/supabase';
import { fetchDashboard, type WindowStat } from '@/data/admin';
import { POLICY_TERMS } from '@/data/company';
import { fetchActivity } from '@/data/activityLog';
import { StatCard, SectionCard, StatusPill, Avatar, Icon, EmptyState, T } from '@/components/admin/kit';

const compactInr = (n: number) =>
  n >= 10000000 ? '₹' + (n / 10000000).toFixed(2) + 'Cr' : n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L' : n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'k' : fmtInr(n);

const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const delta = (a: number, b: number) => {
  if (b === 0) return a > 0 ? '▲ new' : '—';
  const pct = Math.round(((a - b) / b) * 100);
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}%`;
};

export function Overview() {
  const navigate = useNavigate();
  const { data, loading, reload } = useAsync(() => fetchDashboard(), []);
  const { data: activity } = useAsync(() => fetchActivity(8), []);

  // Live counters — refresh when any order changes.
  useEffect(() => {
    const ch = supabase
      .channel('admin-dashboard-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);

  const d = data;
  const win: Record<string, WindowStat> = {
    today: d?.today ?? { revenue: 0, orders: 0 },
    yesterday: d?.yesterday ?? { revenue: 0, orders: 0 },
    week: d?.week ?? { revenue: 0, orders: 0 },
    month: d?.month ?? { revenue: 0, orders: 0 },
    year: d?.year ?? { revenue: 0, orders: 0 },
  };
  const revBars = (d?.revenueSeries ?? []).map((s) => s.value);
  const ordBars = (d?.orderSeries ?? []).map((s) => s.value);
  const maxRev = Math.max(...revBars, 1);

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      {loading && !d && <div style={css(`color:${T.muted};font-size:13.5px;`)}>Loading live metrics…</div>}

      {/* Top KPI row — real time-window revenue with sparklines */}
      <div className="agx-adm-g4">
        <StatCard label="Today's sales" value={compactInr(win.today.revenue)} icon="payments" tint="var(--ag-surface-2)" ic="#D6336C" sub={delta(win.today.revenue, win.yesterday.revenue)} bars={ordBars} />
        <StatCard label="This month" value={compactInr(win.month.revenue)} icon="calendar_month" tint="var(--ag-info-bg)" ic="var(--ag-info-text)" sub={`${win.month.orders} orders`} bars={revBars} />
        <StatCard label="GMV (all time)" value={compactInr(d?.gmv ?? 0)} icon="trending_up" tint="#F3EAF5" ic="#9B7FC7" sub="gross" />
        <StatCard label="Platform revenue" value={compactInr(d?.platformRevenue ?? 0)} icon="account_balance" tint="var(--ag-warn-bg)" ic="#C99A3F" sub={`${POLICY_TERMS.commissionPct}% commission`} />
      </div>

      {/* Counters row */}
      <div className="agx-adm-g5">
        {[
          { label: 'Buyers', value: d?.counts.buyers ?? 0, icon: 'group', to: '/admin/users' },
          { label: 'Sellers', value: d?.counts.sellers ?? 0, icon: 'storefront', to: '/admin/users' },
          { label: 'Pending approvals', value: d?.counts.pendingApprovals ?? 0, icon: 'verified', to: '/admin/approvals', hot: (d?.counts.pendingApprovals ?? 0) > 0 },
          { label: 'Pending orders', value: d?.counts.pendingOrders ?? 0, icon: 'local_shipping', to: '/admin/orders' },
          { label: 'Low stock', value: d?.counts.lowStock ?? 0, icon: 'inventory_2', to: '/admin/products', hot: (d?.counts.lowStock ?? 0) > 0 },
        ].map((c) => (
          <button key={c.label} onClick={() => navigate(c.to)} style={css(T.card + 'padding:16px;text-align:left;border:none;cursor:pointer;display:flex;align-items:center;gap:12px;font-family:inherit;')}>
            <div style={css(`width:40px;height:40px;flex:none;border-radius:12px;background:${c.hot ? 'var(--ag-bad-bg)' : 'var(--ag-surface-2)'};display:flex;align-items:center;justify-content:center;`)}>
              <Icon name={c.icon} size={20} color={c.hot ? '#D6455A' : 'var(--ag-crimson)'} />
            </div>
            <div>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;line-height:1;")}>{c.value}</div>
              <div style={css(`color:${T.muted};font-size:12px;font-weight:600;margin-top:2px;`)}>{c.label}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Revenue chart + payment split */}
      <div className="agx-adm-split">
        <SectionCard title="Revenue" action={<span style={css(`font-size:12px;color:${T.muted};font-weight:700;`)}>Last 14 days</span>}>
          <div style={css('display:flex;align-items:flex-end;gap:6px;height:190px;')}>
            {revBars.map((b, i) => (
              <div key={i} title={`${d?.revenueSeries[i]?.label}: ${fmtInr(b)}`} style={css('flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;')}>
                <div style={css(`width:100%;border-radius:6px 6px 3px 3px;background:linear-gradient(180deg,#E7719F,#D6336C);height:${Math.max(4, Math.round((b / maxRev) * 100))}%;`)} />
              </div>
            ))}
          </div>
          <div style={css(`display:flex;justify-content:space-between;margin-top:8px;font-size:10.5px;color:${T.muted};`)}>
            <span>{d?.revenueSeries[0]?.label}</span>
            <span>{d?.revenueSeries[Math.floor((revBars.length - 1) / 2)]?.label}</span>
            <span>{d?.revenueSeries[revBars.length - 1]?.label}</span>
          </div>
        </SectionCard>

        <SectionCard title="Payments">
          <PaySplit online={d?.paymentSplit.online ?? 0} cod={d?.paymentSplit.cod ?? 0} />
          <div style={css('margin-top:16px;display:flex;flex-direction:column;gap:10px;')}>
            <Legend color="#D6336C" label="Online (Razorpay)" value={d?.paymentSplit.online ?? 0} />
            <Legend color="#E7C3D3" label="Cash on delivery" value={d?.paymentSplit.cod ?? 0} />
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
                <div key={o.id} onClick={() => navigate('/admin/orders')} style={css('display:flex;align-items:center;gap:11px;padding:10px 0;border-top:1px solid #F0E3EA;cursor:pointer;')}>
                  <Avatar name={o.name} tone={o.order_number.charCodeAt(o.order_number.length - 1) % 8} />
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('font-weight:700;font-size:13px;')}>{o.order_number} · {o.name}</div>
                    <div style={css(`font-size:11.5px;color:${T.muted};`)}>{o.boutique} · {timeAgo(o.created_at)}</div>
                  </div>
                  <div style={css('text-align:right;')}>
                    <div style={css('font-weight:800;font-size:13px;')}>{fmtInr(o.total)}</div>
                    <StatusPill status={o.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <div style={css('display:flex;flex-direction:column;gap:16px;')}>
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
                    <div style={css(`font-weight:800;font-size:12.5px;color:${T.accent};`)}>{compactInr(b.revenue)}</div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
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
                  <div style={css('font-weight:800;font-size:12px;')}>{compactInr(p.revenue)}</div>
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

        <SectionCard title="Activity">
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

function PaySplit({ online, cod }: { online: number; cod: number }) {
  const total = online + cod || 1;
  const pct = Math.round((online / total) * 100);
  return (
    <div style={css('display:flex;flex-direction:column;align-items:center;padding:8px 0;')}>
      <div style={css('position:relative;width:120px;height:120px;border-radius:50%;')}>
        <div style={css(`position:absolute;inset:0;border-radius:50%;background:conic-gradient(#D6336C ${pct}%, #E7C3D3 0);`)} />
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
