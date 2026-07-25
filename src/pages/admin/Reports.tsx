import { css } from '@/lib/css';
import { useAsync } from '@/hooks/useAsync';
import { fetchCategoryStats, fetchRevenueByCity } from '@/data/admin';

export function Reports() {
  const { data: catStats } = useAsync(() => fetchCategoryStats(), []);
  const { data: cityBars } = useAsync(() => fetchRevenueByCity(), []);
  const CAT_STATS = catStats ?? [];
  const CITY_BARS = cityBars ?? [];

  return (
    <div className="agx-adm-g2">
      <div style={css('background:var(--ag-surface);border-radius:18px;padding:20px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
        <div style={css('font-weight:800;font-size:15px;')}>Orders by category</div>
        <div style={css('display:flex;flex-direction:column;gap:12px;margin-top:18px;')}>
          {CAT_STATS.map((c) => (
            <div key={c.name}>
              <div style={css('display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:5px;')}>
                <span>{c.name}</span><span style={css('color:var(--ag-crimson);')}>{c.pct}%</span>
              </div>
              <div style={css('height:9px;border-radius:5px;background:var(--ag-surface-2);overflow:hidden;')}>
                <div style={css(`height:100%;width:${c.pct}%;border-radius:5px;background:linear-gradient(90deg,#E7719F,#D6336C);`)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={css('background:var(--ag-surface);border-radius:18px;padding:20px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
        <div style={css('font-weight:800;font-size:15px;')}>Revenue by city</div>
        <div style={css('display:flex;align-items:flex-end;gap:12px;height:220px;margin-top:20px;')}>
          {CITY_BARS.map((b) => (
            <div key={b.d} style={css('flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;justify-content:flex-end;height:100%;')}>
              <div style={css(`width:100%;border-radius:7px 7px 3px 3px;background:linear-gradient(180deg,#E7719F,#B02454);height:${b.h};`)} />
              <span style={css('font-size:11px;color:var(--ag-muted);font-weight:700;')}>{b.d}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
