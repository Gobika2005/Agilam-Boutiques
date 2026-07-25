import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { TONES, fmt, statusStyle } from '@/data/demo';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchOrdersForBoutique } from '@/data/orders';
import { toOrderView } from '@/lib/orderView';
import { printInvoice } from '@/lib/printInvoice';

// "To collect" is not a fulfilment status — it is every COD order whose cash is
// still outstanding, which is the list a seller actually chases at end of day.
const TABS = ['All', 'Pending', 'Accepted', 'Shipped', 'Delivered', 'To collect'];
const PERIODS = ['All time', 'Today', 'This week', 'This month'] as const;
type Period = (typeof PERIODS)[number];

// Start-of-period cutoffs. Week starts Monday, matching how a shop reads "this
// week"; month is the calendar month.
function cutoff(period: Period): number {
  const now = new Date();
  if (period === 'Today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === 'This week') {
    const day = (now.getDay() + 6) % 7; // Mon = 0
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).getTime();
  }
  if (period === 'This month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return 0;
}

export function Orders() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('All');
  const [period, setPeriod] = useState<Period>('All time');
  const [search, setSearch] = useState('');
  const { boutique } = useMyBoutique();
  const { data: orderRows, loading } = useAsync(() => (boutique ? fetchOrdersForBoutique(boutique.id) : Promise.resolve([])), [boutique?.id]);

  // Keep created_at alongside the display view so the date filter has a real
  // timestamp to work with (the view only carries a short display date).
  const all = useMemo(
    () => (orderRows ?? []).map((o, i) => ({ view: toOrderView(o, i), at: new Date(o.created_at).getTime() })),
    [orderRows],
  );

  const q = search.trim().toLowerCase();
  const from = cutoff(period);
  const filtered = all.filter(({ view: o, at }) => {
    if (at < from) return false;
    if (tab !== 'All' && (tab === 'To collect' ? o.collectAmount <= 0 : o.status !== tab)) return false;
    if (!q) return true;
    // Search by order id, customer name, or any product name on the order.
    return (
      o.number.toLowerCase().includes(q) ||
      o.customer.toLowerCase().includes(q) ||
      (o.items ?? []).some((it) => it.title.toLowerCase().includes(q))
    );
  });

  const outstanding = all.reduce((sum, { view }) => sum + view.collectAmount, 0);

  const exportCsv = () => {
    const head = ['Order', 'Date', 'Customer', 'Phone', 'Items', 'Qty', 'Amount', 'Status', 'Payment'];
    const lines = filtered.map(({ view: o }) => {
      const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
      const items = (o.items ?? []).map((it) => `${it.title} x${it.qty}`).join('; ');
      return [o.number, o.date, o.customer, o.phone ?? '', items, o.qty, o.grandTotal, o.status, o.paymentMethod ?? 'Online']
        .map(cell)
        .join(',');
    });
    const csv = [head.join(','), ...lines].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('padding:6px 20px 8px;display:flex;align-items:center;justify-content:space-between;gap:10px;')}>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;")}>Orders</div>
        {all.length > 0 && (
          <button onClick={exportCsv} style={css('display:flex;align-items:center;gap:5px;height:38px;padding:0 13px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);border-radius:11px;font-weight:800;font-size:12.5px;cursor:pointer;')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>download</span>Export
          </button>
        )}
      </div>

      {/* Search */}
      <div style={css('padding:2px 20px 10px;')}>
        <div style={css('display:flex;align-items:center;gap:9px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:14px;padding:0 14px;height:46px;')}>
          <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);font-size:20px;")}>search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order ID, customer or product"
            style={css('flex:1;border:none;outline:none;background:none;font-family:inherit;font-size:14px;color:var(--ag-ink);')}
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search" style={css('border:none;background:none;cursor:pointer;display:flex;')}>
              <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);font-size:19px;")}>close</span>
            </button>
          )}
        </div>
      </div>

      {outstanding > 0 && (
        <div
          onClick={() => setTab('To collect')}
          style={css('margin:2px 20px 10px;background:var(--ag-gold-bg);border:1px solid var(--ag-gold-border);border-radius:16px;padding:12px 14px;display:flex;align-items:center;gap:11px;cursor:pointer;')}
        >
          <span style={css("font-family:'Material Symbols Outlined';color:#C99A3F;font-size:21px;")}>payments</span>
          <span style={css('flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--ag-gold-text);line-height:1.5;')}>
            <strong>{fmt(outstanding)}</strong> still to collect in cash across your open COD orders.
          </span>
          <span style={css("font-family:'Material Symbols Outlined';color:#C9AE7F;")}>chevron_right</span>
        </div>
      )}

      {/* Status tabs */}
      <div className="agx-scroll" style={css('display:flex;gap:8px;overflow-x:auto;padding:4px 20px 6px;')}>
        {TABS.map((t) => {
          const on = tab === t;
          return (
            <div key={t} onClick={() => setTab(t)} style={css(`flex:none;padding:7px 14px;border-radius:999px;font-size:12.5px;font-weight:700;background:${on ? 'var(--ag-crimson)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-label)'};cursor:pointer;`)}>
              {t}
            </div>
          );
        })}
      </div>

      {/* Date range */}
      <div className="agx-scroll" style={css('display:flex;gap:8px;overflow-x:auto;padding:2px 20px 10px;')}>
        {PERIODS.map((p) => {
          const on = period === p;
          return (
            <div key={p} onClick={() => setPeriod(p)} style={css(`flex:none;display:flex;align-items:center;gap:5px;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid ${on ? 'var(--ag-crimson)' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-muted)'};cursor:pointer;`)}>
              {on && <span style={css("font-family:'Material Symbols Outlined';font-size:15px;")}>event</span>}
              {p}
            </div>
          );
        })}
      </div>

      <div style={css('display:flex;flex-direction:column;gap:10px;padding:0 20px;')}>
        {!loading && filtered.length === 0 && (
          <div style={css('color:var(--ag-muted);font-size:14px;padding:8px 2px;')}>
            {q || period !== 'All time' || tab !== 'All' ? 'No orders match these filters.' : 'No orders yet.'}
          </div>
        )}
        {filtered.map(({ view: o }) => {
          const st = statusStyle(o.status);
          return (
            <div key={o.id} style={css('background:var(--ag-surface);border-radius:16px;padding:13px;box-shadow:0 10px 26px -22px rgba(107,20,54,.6);')}>
              <div onClick={() => navigate(`/seller/orders/${encodeURIComponent(o.id)}`)} style={css('cursor:pointer;')}>
                <div style={css('display:flex;align-items:center;justify-content:space-between;gap:8px;')}>
                  <span style={css('display:flex;align-items:center;gap:7px;')}>
                    <span style={css('font-weight:800;font-size:13px;color:var(--ag-muted);')}>{o.number}</span>
                    {o.channel === 'offline' && (
                      <span style={css('font-size:10px;font-weight:800;padding:2px 8px;border-radius:7px;background:var(--ag-purple-bg);color:#7B5FB0;')}>Offline</span>
                    )}
                    {o.channel === 'online' && o.paymentMethod && (
                      <span style={css(`font-size:10px;font-weight:800;padding:2px 8px;border-radius:7px;background:${o.collectAmount > 0 ? 'var(--ag-warn-bg)' : 'var(--ag-good-bg)'};color:${o.collectAmount > 0 ? '#B0862B' : 'var(--ag-good)'};`)}>
                        {!o.isCod ? 'Paid' : o.collectAmount > 0 ? `COD · collect ${fmt(o.collectAmount)}` : 'COD · collected'}
                      </span>
                    )}
                  </span>
                  <span style={css(`font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:8px;background:${st.bg};color:${st.fg};`)}>{o.status}</span>
                </div>
                <div style={css('display:flex;gap:11px;align-items:center;margin-top:10px;')}>
                  <div style={css(`width:44px;height:44px;flex:none;border-radius:12px;background:${TONES[o.tone]};position:relative;overflow:hidden;`)}>
                    <div style={css('position:absolute;inset:0;background:repeating-linear-gradient(135deg,rgba(255,255,255,.3) 0 1px,transparent 1px 12px);')} />
                  </div>
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{o.item}</div>
                    <div style={css('font-size:12px;color:var(--ag-muted);')}>{o.customer} · Qty {o.qty} · {o.date}</div>
                  </div>
                  <div style={css('font-weight:800;color:var(--ag-crimson);font-size:15px;')}>{fmt(o.amount)}</div>
                </div>
              </div>
              <div style={css('display:flex;justify-content:flex-end;margin-top:10px;padding-top:10px;border-top:1px solid var(--ag-border-soft);')}>
                <button
                  onClick={() => printInvoice(o, boutique?.name ?? 'Your boutique')}
                  style={css('display:flex;align-items:center;gap:5px;height:34px;padding:0 12px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);border-radius:10px;font-weight:800;font-size:12px;cursor:pointer;')}
                >
                  <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>print</span>Invoice
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
