import { css } from '@/lib/css';
import { TONES, fmt } from '@/data/demo';
import { useAsync } from '@/hooks/useAsync';
import { fetchCustomersAdmin } from '@/data/orders';

const GRID = 'display:grid;grid-template-columns:2fr 1.2fr 1fr 1fr;';

export function CustomersAdmin() {
  const { data: rows, loading } = useAsync(() => fetchCustomersAdmin(), []);
  const CUSTOMERS = (rows ?? []).map((c) => ({ name: c.name, city: c.city ?? '—', orders: c.orders, spent: c.spent, tone: c.tone }));

  return (
    <div style={css('background:var(--ag-surface);border-radius:18px;overflow:hidden;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
      <div className="agx-adm-tablewrap">
        <div className="agx-adm-tablegrid">
          <div style={css(`${GRID}padding:14px 20px;background:var(--ag-surface-2);font-size:12px;font-weight:800;color:var(--ag-muted);`)}>
            <span>CUSTOMER</span><span>CITY</span><span>ORDERS</span><span>SPENT</span>
          </div>
          {!loading && CUSTOMERS.length === 0 && (
            <div style={css('padding:20px;color:var(--ag-muted);font-size:13.5px;')}>No customers yet.</div>
          )}
          {CUSTOMERS.map((c) => (
            <div key={c.name} style={css(`${GRID}padding:14px 20px;align-items:center;border-top:1px solid var(--ag-border-soft);`)}>
              <div style={css('display:flex;align-items:center;gap:10px;')}>
                <div style={css(`width:36px;height:36px;border-radius:11px;background:${TONES[c.tone]};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;color:rgba(42,26,32,.5);`)}>{c.name[0]}</div>
                <span style={css('font-weight:700;font-size:13.5px;')}>{c.name}</span>
              </div>
              <span style={css('font-size:13px;color:var(--ag-label);')}>{c.city}</span>
              <span style={css('font-size:13px;color:var(--ag-label);')}>{c.orders}</span>
              <span style={css('font-size:13px;font-weight:700;color:var(--ag-crimson);')}>{fmt(c.spent)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
