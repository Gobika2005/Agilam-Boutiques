import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { TONES, fmt } from '@/data/demo';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchOrdersForBoutique, fetchCustomersForBoutique } from '@/data/orders';
import { fetchProductsByBoutique } from '@/data/products';

const CAT_COLORS = ['#D6336C', '#B0863B', '#9B7FC7', '#5FA37E', 'var(--ag-info-text)', 'var(--ag-star)'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const compactInr = (n: number) =>
  n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L' : n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'k' : fmt(n);

const RANGES = ['7 Days', '30 Days', '3 Months', '6 Months', '1 Year', 'Lifetime'] as const;
type Range = (typeof RANGES)[number];

type Bucket = { label: string; start: number; end: number };

// A trend is a run of time buckets. Short ranges read as days; longer ones as
// months, so the axis stays legible whether the shop is looking at a week or a
// year.
function buildBuckets(range: Range, earliest: number): Bucket[] {
  const now = new Date();
  const out: Bucket[] = [];
  if (range === '7 Days' || range === '30 Days') {
    const days = range === '7 Days' ? 7 : 30;
    for (let k = days - 1; k >= 0; k--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - k);
      const start = d.getTime();
      out.push({ label: String(d.getDate()), start, end: start + 86400000 });
    }
    return out;
  }
  let months = range === '3 Months' ? 3 : range === '6 Months' ? 6 : 12;
  if (range === 'Lifetime') {
    const first = new Date(earliest || now.getTime());
    const span = (now.getFullYear() - first.getFullYear()) * 12 + (now.getMonth() - first.getMonth()) + 1;
    months = Math.min(18, Math.max(3, span));
  }
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - k + 1, 1).getTime();
    out.push({ label: MONTHS[d.getMonth()], start: d.getTime(), end });
  }
  return out;
}

export function Analytics() {
  const navigate = useNavigate();
  const { boutique } = useMyBoutique();
  const [range, setRange] = useState<Range>('6 Months');

  const { data: orderRows } = useAsync(() => (boutique ? fetchOrdersForBoutique(boutique.id) : Promise.resolve([])), [boutique?.id]);
  const { data: productRows } = useAsync(() => (boutique ? fetchProductsByBoutique(boutique.id) : Promise.resolve([])), [boutique?.id]);
  const { data: customerRows } = useAsync(() => (boutique ? fetchCustomersForBoutique(boutique.id) : Promise.resolve([])), [boutique?.id]);

  const orders = useMemo(() => orderRows ?? [], [orderRows]);
  const products = productRows ?? [];

  const earliest = useMemo(
    () => orders.reduce((min, o) => Math.min(min, new Date(o.created_at).getTime()), Date.now()),
    [orders],
  );
  const buckets = useMemo(() => buildBuckets(range, earliest), [range, earliest]);
  const rangeStart = buckets[0]?.start ?? 0;

  // Everything below the header respects the selected window, except the
  // engagement counters (views/likes) which are lifetime totals — the schema
  // keeps a running count, not a dated event log.
  const inRange = orders.filter((o) => new Date(o.created_at).getTime() >= rangeStart);
  const totalOrders = inRange.length;
  const totalRevenue = inRange.reduce((s, o) => s + Number(o.total), 0);

  // Returning customers — buyers with two or more orders inside the window.
  const perCustomer = new Map<string, number>();
  inRange.forEach((o) => {
    const key = o.buyer_id ?? o.guest_phone ?? o.guest_name ?? o.id;
    perCustomer.set(key, (perCustomer.get(key) ?? 0) + 1);
  });
  const returning = [...perCustomer.values()].filter((n) => n >= 2).length;
  const uniqueCustomers = perCustomer.size;

  const totalViews = products.reduce((s, p) => s + (p.views_count ?? 0), 0);

  // Revenue + orders trend across the buckets.
  const trend = buckets.map((b) => {
    const rows = inRange.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= b.start && t < b.end;
    });
    return { label: b.label, revenue: rows.reduce((s, o) => s + Number(o.total), 0), orders: rows.length };
  });
  const maxRev = Math.max(...trend.map((t) => t.revenue), 1);
  const maxOrd = Math.max(...trend.map((t) => t.orders), 1);

  // Top categories by revenue. Order line items only carry a title, so map each
  // back to its product's category; unknown titles fall to "Other".
  const titleToCat = new Map(products.map((p) => [p.title, p.category]));
  const catRevenue = new Map<string, number>();
  inRange.forEach((o) => (o.items ?? []).forEach((it) => {
    const cat = titleToCat.get(it.title) ?? 'Other';
    catRevenue.set(cat, (catRevenue.get(cat) ?? 0) + Number(it.price) * it.qty);
  }));
  const topCats = [...catRevenue.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const catMax = topCats[0]?.[1] || 1;

  // Most viewed pieces — lifetime, straight off the engagement counters.
  const mostViewed = [...products].sort((a, b) => (b.views_count ?? 0) - (a.views_count ?? 0)).slice(0, 5).filter((p) => (p.views_count ?? 0) > 0);

  const topCustomers = (customerRows ?? []).slice(0, 3);

  const tiles = [
    { icon: 'account_balance_wallet', tint: 'var(--ag-surface-2)', ic: '#D6336C', value: compactInr(totalRevenue), label: 'Revenue', sub: range },
    { icon: 'shopping_bag', tint: 'var(--ag-gold-bg)', ic: 'var(--ag-warn-text)', value: String(totalOrders), label: 'Orders', sub: range },
    { icon: 'sync', tint: 'var(--ag-good-bg)', ic: 'var(--ag-good)', value: `${returning}/${uniqueCustomers}`, label: 'Returning customers', sub: 'Two or more orders' },
    { icon: 'visibility', tint: 'var(--ag-info-bg)', ic: 'var(--ag-info-text)', value: String(totalViews), label: 'Product views', sub: 'All time' },
  ];

  const Bars = ({ data, max, kind }: { data: typeof trend; max: number; kind: 'revenue' | 'orders' }) => (
    <div className="agx-scroll" style={css('display:flex;align-items:flex-end;gap:clamp(4px,2vw,18px);height:190px;margin-top:22px;padding:0 4px;overflow-x:auto;')}>
      {data.map((b, i) => {
        const val = kind === 'revenue' ? b.revenue : b.orders;
        const h = `${Math.max(6, Math.round((val / max) * 100))}%`;
        const grad = kind === 'revenue' ? 'linear-gradient(180deg,#E14A7E,#B02454)' : 'linear-gradient(180deg,#6FA8DC,var(--ag-info-text))';
        return (
          <div key={`${b.label}-${i}`} style={css('flex:1;min-width:16px;display:flex;flex-direction:column;align-items:center;gap:8px;height:100%;justify-content:flex-end;')}>
            <div style={css(`width:100%;max-width:42px;height:${h};border-radius:9px 9px 4px 4px;background:${grad};box-shadow:0 10px 22px -12px rgba(176,36,84,.6);`)} />
            <span style={css('font-size:10.5px;font-weight:800;color:var(--ag-muted);white-space:nowrap;')}>{b.label}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('max-width:1240px;margin:0 auto;')}>
        <div style={css('padding:6px 0 4px;')}>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Business insights</div>
          <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(28px,3vw,40px);line-height:1.05;margin-top:4px;")}>Analytics</h1>
        </div>

        {/* Time filter */}
        <div className="agx-scroll" style={css('display:flex;gap:7px;overflow-x:auto;padding:12px 0 4px;')}>
          {RANGES.map((r) => {
            const on = range === r;
            return (
              <button key={r} onClick={() => setRange(r)} style={css(`flex:none;padding:8px 14px;border:1px solid ${on ? 'var(--ag-crimson)' : 'var(--ag-surface-3)'};border-radius:11px;background:${on ? 'var(--ag-crimson)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-muted)'};font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit;`)}>
                {r}
              </button>
            );
          })}
        </div>

        {/* Stat tiles */}
        <div className="agx-rgrid" style={css('margin-top:14px;')}>
          {tiles.map((t) => (
            <div key={t.label} className="agx-lift" style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:18px;box-shadow:0 18px 40px -28px rgba(107,20,54,.55);')}>
              <div style={css(`width:42px;height:42px;border-radius:13px;background:${t.tint};display:flex;align-items:center;justify-content:center;`)}><span style={css(`font-family:'Material Symbols Outlined';color:${t.ic};`)}>{t.icon}</span></div>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:12px;")}>{t.value}</div>
              <div style={css('color:var(--ag-muted);font-size:12.5px;font-weight:700;')}>{t.label}</div>
              <div style={css('font-size:11.5px;font-weight:800;color:var(--ag-muted);margin-top:6px;')}>{t.sub}</div>
            </div>
          ))}
        </div>

        {/* Revenue + orders trend */}
        <div className="agx-an-grid" style={css('display:grid;gap:18px;margin-top:18px;align-items:start;')}>
          <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;padding:22px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}>
            <div style={css('display:flex;align-items:center;justify-content:space-between;')}>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Revenue trend</div>
              <span style={css('font-size:12px;font-weight:800;color:var(--ag-muted);')}>₹ · {range}</span>
            </div>
            <Bars data={trend} max={maxRev} kind="revenue" />
          </div>
          <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;padding:22px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}>
            <div style={css('display:flex;align-items:center;justify-content:space-between;')}>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Orders trend</div>
              <span style={css('font-size:12px;font-weight:800;color:var(--ag-muted);')}>Orders · {range}</span>
            </div>
            <Bars data={trend} max={maxOrd} kind="orders" />
          </div>
        </div>

        {/* Top categories + most viewed */}
        <div className="agx-an-grid" style={css('display:grid;gap:18px;margin-top:18px;align-items:start;')}>
          <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;padding:22px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Top categories</div>
            <div style={css('font-size:12px;color:var(--ag-muted);margin-top:2px;')}>By revenue · {range}</div>
            <div style={css('display:flex;flex-direction:column;gap:14px;margin-top:18px;')}>
              {topCats.length === 0 && <div style={css('color:var(--ag-muted);font-size:13px;')}>No sales in this period.</div>}
              {topCats.map(([name, rev], i) => (
                <div key={name}>
                  <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;')}>
                    <span style={css('display:flex;align-items:center;gap:8px;font-weight:800;font-size:13.5px;')}>
                      <span style={css(`width:11px;height:11px;border-radius:4px;background:${CAT_COLORS[i % CAT_COLORS.length]};`)} />{name}
                    </span>
                    <span style={css('font-weight:800;font-size:12.5px;color:var(--ag-crimson);')}>{compactInr(rev)}</span>
                  </div>
                  <div style={css('height:8px;border-radius:5px;background:var(--ag-surface-2);overflow:hidden;margin-top:7px;')}>
                    <span style={css(`display:block;height:100%;width:${Math.round((rev / catMax) * 100)}%;background:${CAT_COLORS[i % CAT_COLORS.length]};border-radius:5px;`)} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;padding:22px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Most viewed products</div>
            <div style={css('font-size:12px;color:var(--ag-muted);margin-top:2px;')}>All-time views</div>
            <div style={css('display:flex;flex-direction:column;gap:4px;margin-top:12px;')}>
              {mostViewed.length === 0 && <div style={css('color:var(--ag-muted);font-size:13px;margin-top:6px;')}>No views recorded yet.</div>}
              {mostViewed.map((p, i) => (
                <div key={p.id} onClick={() => navigate(`/seller/products/${p.id}`)} style={css('display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--ag-border-soft);cursor:pointer;')}>
                  <div style={css(`width:40px;height:40px;flex:none;border-radius:12px;background:${TONES[p.tone]};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:rgba(42,26,32,.55);`)}>{i + 1}</div>
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('font-weight:800;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{p.title}</div>
                    <div style={css('color:var(--ag-muted);font-size:12px;margin-top:2px;')}>{p.category}</div>
                  </div>
                  <div style={css('text-align:right;flex:none;')}>
                    <div style={css('display:flex;align-items:center;gap:4px;font-weight:800;color:var(--ag-info-text);font-size:13px;')}>
                      <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>visibility</span>{p.views_count ?? 0}
                    </div>
                    <div style={css('display:flex;align-items:center;gap:4px;font-size:11px;color:#D6336C;font-weight:700;margin-top:2px;justify-content:flex-end;')}>
                      <span style={css("font-family:'Material Symbols Outlined';font-size:13px;")}>favorite</span>{p.likes_count ?? 0}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top customers */}
        <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;padding:22px;margin-top:18px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Top customers</div>
          <div style={css('display:flex;flex-direction:column;gap:6px;margin-top:12px;')}>
            {topCustomers.length === 0 && <div style={css('color:var(--ag-muted);font-size:13px;margin-top:6px;')}>No customers yet.</div>}
            {topCustomers.map((c) => (
              <div key={c.name} style={css('display:flex;align-items:center;gap:13px;padding:11px 0;border-bottom:1px solid var(--ag-border-soft);')}>
                <div style={css(`width:44px;height:44px;flex:none;border-radius:13px;background:${TONES[c.tone]};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:19px;color:rgba(42,26,32,.55);`)}>{c.name[0]}</div>
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('font-weight:800;font-size:14px;')}>{c.name}</div>
                  <div style={css('color:var(--ag-muted);font-size:12px;margin-top:2px;')}>{c.orders} orders</div>
                </div>
                <div style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:17px;")}>{fmt(c.spent)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
