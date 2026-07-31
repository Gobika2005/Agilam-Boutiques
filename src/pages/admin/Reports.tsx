import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { useAsync } from '@/hooks/useAsync';
import { fetchCategoryStats, fetchRevenueByCity, fetchDashboard } from '@/data/admin';
import { StatCard, Card, Select, GhostButton, T } from '@/components/admin/kit';

/**
 * Reports & Analytics.
 *
 * Was two static cards — a category mix and a city bar chart — with no totals,
 * no time dimension and no way to get the numbers out. The trend and headline
 * figures come from `fetchDashboard()`, which the Overview already loads, so
 * this adds a view rather than another round of queries.
 */

const compactInr = (n: number) =>
  n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L' : n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'k' : fmtInr(n);

type Range = 'week' | 'month' | 'year';

const RANGES: { value: Range; label: string }[] = [
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
];

const panel = 'background:var(--ag-surface);border-radius:18px;padding:20px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);';

/** Downloads rows as a CSV file, quoting every field so commas survive. */
function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  // Leading BOM so Excel opens the ₹ symbol and Tamil names as UTF-8.
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const { data: catStats, loading: catLoading } = useAsync(() => fetchCategoryStats(), []);
  const { data: cityBars } = useAsync(() => fetchRevenueByCity(), []);
  const { data: dash, loading: dashLoading } = useAsync(() => fetchDashboard(), []);
  const [range, setRange] = useState<Range>('week');

  const CAT_STATS = catStats ?? [];
  const CITY_BARS = cityBars ?? [];

  const window = dash ? dash[range] : { revenue: 0, orders: 0 };
  const prev = dash ? (range === 'week' ? dash.prevWeek : range === 'month' ? dash.prevMonth : dash.prevYear) : { revenue: 0, orders: 0 };
  const aov = window.orders ? window.revenue / window.orders : 0;
  const delta = prev.revenue > 0 ? Math.round(((window.revenue - prev.revenue) / prev.revenue) * 100) : null;

  // The dashboard's series is a 14-day daily revenue trace; "This month"/"This
  // year" reuse it as the recent-activity shape rather than claiming a
  // granularity the query does not actually provide.
  const series = useMemo(() => dash?.revenueSeries ?? [], [dash]);
  const peak = useMemo(() => Math.max(...series.map((p) => p.value), 1), [series]);

  const exportSummary = () => {
    downloadCsv(
      `mangaimart-report-${range}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Section', 'Label', 'Value'],
      [
        ['Summary', 'Revenue', window.revenue],
        ['Summary', 'Orders', window.orders],
        ['Summary', 'Average order', Math.round(aov)],
        ['Summary', 'Previous period revenue', prev.revenue],
        ...series.map((p) => ['Revenue trend', p.label, p.value] as (string | number)[]),
        ...CAT_STATS.map((c) => ['Units by category', c.name, `${c.pct}%`] as (string | number)[]),
        ...CITY_BARS.map((b) => ['Revenue by city', b.d, b.h] as (string | number)[]),
      ],
    );
  };

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      <div style={css('display:flex;gap:10px;flex-wrap:wrap;align-items:center;')}>
        <Select value={range} onChange={(v) => setRange(v as Range)} options={RANGES} />
        <div style={css('flex:1;')} />
        <GhostButton icon="download" onClick={exportSummary}>Export CSV</GhostButton>
      </div>

      <div className="agx-adm-g4">
        <StatCard
          label={`Revenue · ${RANGES.find((r) => r.value === range)?.label}`}
          value={compactInr(window.revenue)}
          icon="payments"
          tint="var(--ag-surface-2)"
          ic="#D6336C"
          sub={delta == null ? 'no prior period' : `${delta >= 0 ? '+' : ''}${delta}% vs previous`}
        />
        <StatCard label="Orders" value={String(window.orders)} icon="receipt_long" tint="var(--ag-info-bg)" ic="var(--ag-info-text)" />
        <StatCard label="Average order" value={compactInr(aov)} icon="shopping_cart" tint="var(--ag-purple-bg)" ic="#9B7FC7" />
        <StatCard label="GMV · all time" value={compactInr(dash?.gmv ?? 0)} icon="trending_up" tint="var(--ag-good-bg)" ic="var(--ag-good-text)" sub={`${dash?.earnedOrders ?? 0} earned orders`} />
      </div>

      <Card>
        <div style={css('display:flex;align-items:baseline;justify-content:space-between;gap:10px;')}>
          <span style={css('font-weight:800;font-size:15px;')}>Revenue trend</span>
          <span style={css(`font-size:11.5px;font-weight:700;color:${T.muted};`)}>last 14 days</span>
        </div>
        {dashLoading && <div style={css(`padding:24px 0;color:${T.muted};font-size:13.5px;`)}>Loading…</div>}
        {!dashLoading && series.length === 0 && (
          <div style={css(`padding:24px 0;color:${T.muted};font-size:13.5px;`)}>No orders yet.</div>
        )}
        {!dashLoading && series.length > 0 && (
          <div style={css('display:flex;align-items:flex-end;gap:5px;height:180px;margin-top:18px;')}>
            {series.map((p) => (
              <div key={p.label} title={`${p.label} · ${fmtInr(p.value)}`} style={css('flex:1;display:flex;flex-direction:column;align-items:center;gap:7px;justify-content:flex-end;height:100%;min-width:0;')}>
                <div style={css(`width:100%;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,#E7719F,#B02454);height:${Math.max(3, Math.round((p.value / peak) * 100))}%;`)} />
                <span style={css(`font-size:9.5px;color:${T.muted};font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;`)}>{p.label}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="agx-adm-g2">
        <div style={css(panel)}>
          <div style={css('display:flex;align-items:baseline;justify-content:space-between;gap:10px;')}>
            <span style={css('font-weight:800;font-size:15px;')}>Units sold by category</span>
            <span style={css(`font-size:11.5px;font-weight:700;color:${T.muted};`)}>all time</span>
          </div>
          {catLoading && <div style={css(`padding:20px 0;color:${T.muted};font-size:13.5px;`)}>Loading…</div>}
          {!catLoading && CAT_STATS.length === 0 && (
            <div style={css(`padding:20px 0;color:${T.muted};font-size:13.5px;`)}>Nothing sold yet.</div>
          )}
          <div style={css('display:flex;flex-direction:column;gap:12px;margin-top:18px;')}>
            {CAT_STATS.map((c) => (
              <div key={c.name}>
                <div style={css('display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:5px;gap:10px;')}>
                  <span style={css('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{c.name}</span>
                  <span style={css('color:var(--ag-crimson);flex:none;')}>{c.pct}%</span>
                </div>
                <div style={css('height:9px;border-radius:5px;background:var(--ag-surface-2);overflow:hidden;')}>
                  <div style={css(`height:100%;width:${c.pct}%;border-radius:5px;background:linear-gradient(90deg,#E7719F,#D6336C);`)} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={css(panel)}>
          <div style={css('font-weight:800;font-size:15px;')}>Revenue by city</div>
          {CITY_BARS.length === 0 && (
            <div style={css(`padding:20px 0;color:${T.muted};font-size:13.5px;`)}>No city data yet.</div>
          )}
          <div style={css('display:flex;align-items:flex-end;gap:12px;height:220px;margin-top:20px;')}>
            {CITY_BARS.map((b) => (
              <div key={b.d} style={css('flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;justify-content:flex-end;height:100%;min-width:0;')}>
                <div style={css(`width:100%;border-radius:7px 7px 3px 3px;background:linear-gradient(180deg,#E7719F,#B02454);height:${b.h};`)} />
                <span style={css(`font-size:11px;color:${T.muted};font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;`)}>{b.d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
