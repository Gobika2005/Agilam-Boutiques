import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { csvDocument } from '@/lib/csv';
import { fmtInr } from '@/lib/tokens';
import { useAsync } from '@/hooks/useAsync';
import { fetchCategoryStats, fetchRevenueByCity, fetchDashboard } from '@/data/admin';
import { fetchEarnings, grossIncome, totalCosts, netProfit, blankWindow, type PeriodRow } from '@/data/earnings';
import { StatCard, Card, Select, GhostButton, DataTable, Icon, T, type Column } from '@/components/admin/kit';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Reports & Analytics — MangaiMart's books over time.
 *
 * This was a GMV report: revenue, orders, average order and a category/city mix,
 * i.e. how the *sellers* did. The headline is now the platform's own P&L — what
 * it earned in commission and ads, what it funded in coupons and refunds, what
 * it spent — with a 12-month table that exports as the CSV an accountant can
 * actually use. The marketplace mix is still here, in a panel below.
 *
 * Windows come from `fetchEarnings()`; the marketplace panel keeps using
 * `fetchDashboard()`, which the Overview already loads.
 */

const compactAbs = (n: number) =>
  n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L' : n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'k' : fmtInr(n);
const compactInr = (n: number) => (n < 0 ? '−' : '') + compactAbs(Math.abs(n));

/** Signed rupees for the P&L cells — a cost reads as "−₹1,200", never "₹-1200". */
const signed = (n: number) => (n < 0 ? '−' : '') + fmtInr(Math.abs(n));

type Range = 'week' | 'month' | 'year';

const RANGES: { value: Range; label: string }[] = [
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
];
const PREV: Record<Range, 'prevWeek' | 'prevMonth' | 'prevYear'> = {
  week: 'prevWeek', month: 'prevMonth', year: 'prevYear',
};

const panel = 'background:var(--ag-surface);border-radius:18px;padding:20px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);';

/**
 * Downloads rows as a CSV file. Every field is quoted so commas survive, and
 * formula-neutralised so a category or city name a seller chose cannot execute
 * in the admin's spreadsheet (src/lib/csv.ts).
 */
function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const csv = csvDocument(header, rows);
  // Leading BOM so Excel opens the ₹ symbol and Tamil names as UTF-8.
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const { data: earn, loading: earnLoading } = useAsync(() => fetchEarnings(), []);
  const { data: catStats, loading: catLoading } = useAsync(() => fetchCategoryStats(), []);
  const { data: cityBars } = useAsync(() => fetchRevenueByCity(), []);
  const { data: dash, loading: dashLoading } = useAsync(() => fetchDashboard(), []);
  const [range, setRange] = useState<Range>('week');
  const [showMarket, setShowMarket] = useState(false);

  const CAT_STATS = catStats ?? [];
  const CITY_BARS = cityBars ?? [];

  const w = earn?.[range] ?? blankWindow();
  const prev = earn?.[PREV[range]] ?? blankWindow();
  const allTime = earn?.allTime ?? blankWindow();
  const rangeLabel = RANGES.find((r) => r.value === range)?.label ?? '';

  const delta = (cur: number, before: number) =>
    before === 0 ? (cur > 0 ? 'new this period' : 'no prior period') : `${cur >= before ? '+' : ''}${Math.round(((cur - before) / Math.abs(before)) * 100)}% vs previous`;

  const monthly = useMemo(() => earn?.monthly ?? [], [earn]);
  const peak = useMemo(() => Math.max(...monthly.map((m) => grossIncome(m)), 1), [monthly]);

  const exportSummary = () => {
    downloadCsv(
      `mangaimart-earnings-${range}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Section', 'Label', 'Value'],
      [
        [`Platform · ${rangeLabel}`, 'Commission earned', Math.round(w.commission)],
        [`Platform · ${rangeLabel}`, 'Ad earnings', Math.round(w.ads)],
        [`Platform · ${rangeLabel}`, 'Gross income', Math.round(grossIncome(w))],
        [`Platform · ${rangeLabel}`, 'Platform coupons funded', -Math.round(w.couponCost)],
        [`Platform · ${rangeLabel}`, 'Refund reversals', -Math.round(w.refundReversal)],
        [`Platform · ${rangeLabel}`, 'Platform expenses', -Math.round(w.expenses)],
        [`Platform · ${rangeLabel}`, 'Net profit', Math.round(netProfit(w))],
        [`Platform · ${rangeLabel}`, 'Delivered orders', w.deliveredOrders],
        [`Platform · ${rangeLabel}`, 'Paid ad campaigns', w.paidCampaigns],
        ['Platform · all time', 'Net profit', Math.round(netProfit(allTime))],
        ['Platform · all time', 'Commission rate applied', `${earn?.commissionPct ?? 0}%`],
        ['Platform · pipeline', 'Commission not yet earned', Math.round(earn?.pipeline.commission ?? 0)],
        ['Platform · pipeline', 'Orders in flight', earn?.pipeline.orders ?? 0],
        ...monthly.flatMap((m) => ([
          ['Monthly P&L', `${m.label} · commission`, Math.round(m.commission)],
          ['Monthly P&L', `${m.label} · ads`, Math.round(m.ads)],
          ['Monthly P&L', `${m.label} · coupons funded`, -Math.round(m.couponCost)],
          ['Monthly P&L', `${m.label} · refund reversals`, -Math.round(m.refundReversal)],
          ['Monthly P&L', `${m.label} · expenses`, -Math.round(m.expenses)],
          ['Monthly P&L', `${m.label} · net`, Math.round(netProfit(m))],
        ] as (string | number)[][])),
        ['Marketplace', 'GMV all time', Math.round(dash?.gmv ?? 0)],
        ['Marketplace', 'Earned orders all time', dash?.earnedOrders ?? 0],
        ...(dash?.revenueSeries ?? []).map((p) => ['Marketplace · GMV trend', p.label, Math.round(p.value)] as (string | number)[]),
        ...CAT_STATS.map((c) => ['Marketplace · units by category', c.name, `${c.pct}%`] as (string | number)[]),
        ...CITY_BARS.map((b) => ['Marketplace · GMV by city', b.d, b.h] as (string | number)[]),
      ],
    );
  };

  const columns: Column<PeriodRow>[] = [
    { key: 'month', header: 'Month', width: '1.3fr', render: (m) => <span style={css('font-weight:700;')}>{m.label}</span> },
    { key: 'commission', header: 'Commission', align: 'right', render: (m) => <span>{fmtInr(m.commission)}</span> },
    { key: 'ads', header: 'Ads', align: 'right', render: (m) => <span>{fmtInr(m.ads)}</span> },
    { key: 'coupons', header: 'Coupons', align: 'right', render: (m) => <Cost v={m.couponCost} /> },
    { key: 'refunds', header: 'Refunds', align: 'right', render: (m) => <Cost v={m.refundReversal} /> },
    { key: 'expenses', header: 'Expenses', align: 'right', render: (m) => <Cost v={m.expenses} /> },
    {
      key: 'net',
      header: 'Net',
      align: 'right',
      render: (m) => {
        const n = netProfit(m);
        return <span style={css(`font-weight:800;color:${n < 0 ? 'var(--ag-danger-text)' : n > 0 ? 'var(--ag-good-text)' : T.muted};`)}>{signed(n)}</span>;
      },
    },
  ];

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      <div style={css('display:flex;gap:10px;flex-wrap:wrap;align-items:center;')}>
        <Select value={range} onChange={(v) => setRange(v as Range)} options={RANGES} />
        <div style={css('flex:1;')} />
        <GhostButton icon="download" onClick={exportSummary}>Export CSV</GhostButton>
      </div>

      <div className="agx-adm-g4">
        <StatCard
          label={`Platform earnings · ${rangeLabel}`}
          value={compactInr(w.commission)}
          icon="account_balance"
          tint="var(--ag-surface-2)"
          ic="#D6336C"
          sub={delta(w.commission, prev.commission)}
        />
        <StatCard
          label={`Ad earnings · ${rangeLabel}`}
          value={compactInr(w.ads)}
          icon="campaign"
          tint="var(--ag-warn-bg)"
          ic="var(--ag-gold-text)"
          sub={delta(w.ads, prev.ads)}
        />
        <StatCard
          label={`Net profit · ${rangeLabel}`}
          value={compactInr(netProfit(w))}
          icon="trending_up"
          tint="var(--ag-good-bg)"
          ic="var(--ag-good-text)"
          sub={`${compactInr(grossIncome(w))} in, ${compactInr(totalCosts(w))} out`}
        />
        <StatCard
          label="Net profit · all time"
          value={compactInr(netProfit(allTime))}
          icon="savings"
          tint="var(--ag-info-bg)"
          ic="var(--ag-info-text)"
          sub={`${allTime.deliveredOrders} delivered orders`}
        />
      </div>

      <Card>
        <div style={css('display:flex;align-items:baseline;justify-content:space-between;gap:10px;')}>
          <span style={css('font-weight:800;font-size:15px;')}>Gross income</span>
          <span style={css(`font-size:11.5px;font-weight:700;color:${T.muted};`)}>commission + ads · last 12 months</span>
        </div>
        {earnLoading && (
          <div role="status" aria-busy="true" style={css('display:flex;align-items:flex-end;gap:5px;height:180px;margin-top:18px;')}>
            <span className="agx-visually-hidden">Loading earnings…</span>
            {Array.from({ length: 12 }, (_, i) => (
              // Varying heights so the placeholder reads as a chart rather than a block.
              <Skeleton key={i} w="100%" h={`${28 + ((i * 37) % 62)}%`} radius={7} style="align-self:flex-end;" />
            ))}
          </div>
        )}
        {!earnLoading && peak === 1 && (
          <div style={css(`padding:24px 0;color:${T.muted};font-size:13.5px;`)}>Nothing earned yet — commission books when an order is delivered.</div>
        )}
        {!earnLoading && peak > 1 && (
          <div style={css('display:flex;align-items:flex-end;gap:5px;height:180px;margin-top:18px;')}>
            {monthly.map((m) => {
              const total = grossIncome(m);
              const adsPct = total > 0 ? (m.ads / total) * 100 : 0;
              return (
                <div key={m.label} title={`${m.label} · ${fmtInr(m.commission)} commission + ${fmtInr(m.ads)} ads`} style={css('flex:1;display:flex;flex-direction:column;align-items:center;gap:7px;justify-content:flex-end;height:100%;min-width:0;')}>
                  <div style={css(`width:100%;border-radius:6px 6px 2px 2px;overflow:hidden;display:flex;flex-direction:column;height:${Math.max(2, Math.round((total / peak) * 100))}%;`)}>
                    <div style={css(`height:${adsPct}%;background:var(--ag-gold-text);`)} />
                    <div style={css('flex:1;background:linear-gradient(180deg,#E7719F,#B02454);')} />
                  </div>
                  <span style={css(`font-size:9.5px;color:${T.muted};font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;`)}>{m.label.split(' ')[0]}</span>
                </div>
              );
            })}
          </div>
        )}
        <div style={css(`display:flex;gap:14px;margin-top:14px;font-size:11.5px;font-weight:700;color:${T.muted};`)}>
          <LegendDot color="#D6336C" label="Commission" />
          <LegendDot color="var(--ag-gold-text)" label="Ads" />
        </div>
      </Card>

      <div>
        <div style={css('display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px;')}>
          <span style={css('font-weight:800;font-size:15px;')}>Profit &amp; loss by month</span>
          <span style={css(`font-size:11.5px;font-weight:700;color:${T.muted};`)}>
            commission at {earn?.commissionPct ?? 0}%
          </span>
        </div>
        <DataTable columns={columns} rows={monthly} loading={earnLoading} getId={(m) => m.label} />
        {earn?.expensesUnavailable && (
          <div style={css(`display:flex;gap:7px;align-items:center;margin-top:10px;font-size:11.5px;font-weight:600;color:${T.muted};`)}>
            <Icon name="warning" size={14} color={T.muted} />
            Expenses read as ₹0 — migration 0056 must be applied.
          </div>
        )}
      </div>

      {/* Marketplace mix — the sellers' side, kept but out of the headline. */}
      <div style={css('background:var(--ag-surface);border-radius:18px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);overflow:hidden;')}>
        <button
          onClick={() => setShowMarket((v) => !v)}
          aria-expanded={showMarket}
          style={css('width:100%;display:flex;align-items:center;gap:12px;padding:18px 20px;background:none;border:none;cursor:pointer;font-family:inherit;text-align:left;')}
        >
          <div style={css('width:38px;height:38px;flex:none;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
            <Icon name="storefront" size={20} color={T.accent} />
          </div>
          <div style={css('flex:1;min-width:0;')}>
            <div style={css('font-weight:800;font-size:15px;')}>Marketplace mix</div>
            <div style={css(`font-size:12px;color:${T.muted};font-weight:600;margin-top:2px;`)}>
              {compactInr(dash?.gmv ?? 0)} GMV all time · what sells, and where
            </div>
          </div>
          <Icon name={showMarket ? 'expand_less' : 'expand_more'} size={22} color={T.muted} />
        </button>

        {showMarket && (
          <div style={css(`padding:16px 20px 20px;border-top:1px solid ${T.border};display:flex;flex-direction:column;gap:16px;`)}>
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
                <div style={css('font-weight:800;font-size:15px;')}>GMV by city</div>
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

            <div style={css(panel)}>
              <div style={css('display:flex;align-items:baseline;justify-content:space-between;gap:10px;')}>
                <span style={css('font-weight:800;font-size:15px;')}>GMV trend</span>
                <span style={css(`font-size:11.5px;font-weight:700;color:${T.muted};`)}>last 14 days · seller turnover</span>
              </div>
              {dashLoading && (
                <div role="status" aria-busy="true" style={css('display:flex;align-items:flex-end;gap:5px;height:160px;margin-top:18px;')}>
                  <span className="agx-visually-hidden">Loading GMV trend…</span>
                  {Array.from({ length: 14 }, (_, i) => (
                    <Skeleton key={i} w="100%" h={`${28 + ((i * 37) % 62)}%`} radius={7} style="align-self:flex-end;" />
                  ))}
                </div>
              )}
              {!dashLoading && <GmvTrend series={dash?.revenueSeries ?? []} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A cost cell: shown as a negative, muted to zero when there is nothing to report. */
function Cost({ v }: { v: number }) {
  if (!v) return <span style={css(`color:${T.muted};`)}>—</span>;
  return <span style={css('color:var(--ag-bad-text);')}>−{fmtInr(v)}</span>;
}

function GmvTrend({ series }: { series: { label: string; value: number }[] }) {
  const peak = Math.max(...series.map((p) => p.value), 1);
  if (series.length === 0 || peak === 1) {
    return <div style={css(`padding:24px 0;color:${T.muted};font-size:13.5px;`)}>No orders yet.</div>;
  }
  return (
    <div style={css('display:flex;align-items:flex-end;gap:5px;height:160px;margin-top:18px;')}>
      {series.map((p) => (
        <div key={p.label} title={`${p.label} · ${fmtInr(p.value)}`} style={css('flex:1;display:flex;flex-direction:column;align-items:center;gap:7px;justify-content:flex-end;height:100%;min-width:0;')}>
          <div style={css(`width:100%;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,#E7719F,#B02454);height:${Math.max(3, Math.round((p.value / peak) * 100))}%;`)} />
          <span style={css(`font-size:9.5px;color:${T.muted};font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;`)}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={css('display:inline-flex;align-items:center;gap:5px;')}>
      <span style={css(`width:9px;height:9px;border-radius:50%;background:${color};`)} />
      {label}
    </span>
  );
}
