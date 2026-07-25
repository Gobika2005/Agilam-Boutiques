import { css } from '@/lib/css';
import { TONES, statusStyle } from '@/data/demo';
import { useShop } from '@/state/ShopContext';
import { useAsync } from '@/hooks/useAsync';
import { fetchAllBoutiquesAdmin, setBoutiqueStatus, setBoutiqueFeatured, type AdminBoutiqueRow } from '@/data/boutiques';
import { BOUTIQUE_STATUS_LABEL } from '@/data/types';

const GRID = 'display:grid;grid-template-columns:1.8fr 1fr .8fr .8fr 1fr 1.1fr;';

export function BoutiquesTable() {
  const { showToast } = useShop();
  const { data: rows, loading, reload } = useAsync(() => fetchAllBoutiquesAdmin(), []);
  const boutiques = rows ?? [];

  const run = async (fn: () => Promise<void>, msg: string) => {
    try {
      await fn();
      showToast(msg);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const toggleFeatured = (b: AdminBoutiqueRow) =>
    run(() => setBoutiqueFeatured(b.id, !b.featured), `${b.name} ${b.featured ? 'unfeatured' : 'featured'}`);

  const toggleActive = (b: AdminBoutiqueRow) =>
    b.status === 'approved'
      ? run(() => setBoutiqueStatus(b.id, 'pending'), `${b.name} suspended`)
      : run(() => setBoutiqueStatus(b.id, 'approved'), `${b.name} activated`);

  return (
    <div style={css('background:var(--ag-surface);border-radius:18px;overflow:hidden;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
      <div className="agx-adm-tablewrap">
        <div className="agx-adm-tablegrid">
      <div style={css(`${GRID}padding:14px 20px;background:var(--ag-surface-2);font-size:12px;font-weight:800;color:var(--ag-muted);`)}>
        <span>BOUTIQUE</span><span>CITY</span><span>RATING</span><span>REVIEWS</span><span>STATUS</span><span style={css('text-align:right;')}>ACTIONS</span>
      </div>
      {loading && <div style={css('padding:20px;color:var(--ag-muted);font-size:13.5px;')}>Loading boutiques…</div>}
      {!loading && boutiques.length === 0 && (
        <div style={css('padding:20px;color:var(--ag-muted);font-size:13.5px;')}>No boutiques yet.</div>
      )}
      {boutiques.map((b, i) => {
        const label = b.status === 'approved' ? 'Active' : BOUTIQUE_STATUS_LABEL[b.status];
        const st = statusStyle(b.status === 'approved' ? 'Approved' : b.status === 'rejected' ? 'Rejected' : 'Pending');
        return (
          <div key={b.id} style={css(`${GRID}padding:14px 20px;align-items:center;border-top:1px solid var(--ag-border-soft);`)}>
            <div style={css('display:flex;align-items:center;gap:10px;min-width:0;')}>
              <div style={css(`width:36px;height:36px;flex:none;border-radius:11px;background:${TONES[b.tone ?? i % TONES.length]};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;color:rgba(42,26,32,.5);`)}>{b.name[0]}</div>
              <div style={css('min-width:0;')}>
                <div style={css('font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{b.name}</div>
                <div style={css('font-size:11.5px;color:var(--ag-muted);')}>{b.owner?.full_name ?? '—'}</div>
              </div>
              {b.featured && <span title="Featured" style={css("font-family:'Material Symbols Outlined';font-size:16px;color:#C99A3F;")}>star</span>}
            </div>
            <span style={css('font-size:13px;color:var(--ag-label);')}>{b.city || '—'}</span>
            <span style={css('font-size:13px;font-weight:700;color:var(--ag-crimson);')}>⭐ {b.rating}</span>
            <span style={css('font-size:13px;color:var(--ag-label);')}>{b.reviews_count}</span>
            <span><span style={css(`font-size:11px;font-weight:800;padding:4px 10px;border-radius:8px;background:${st.bg};color:${st.fg};`)}>{label}</span></span>
            <div style={css('display:flex;gap:8px;justify-content:flex-end;')}>
              <button
                onClick={() => toggleFeatured(b)}
                title={b.featured ? 'Remove from featured' : 'Mark as featured'}
                style={css(`width:34px;height:34px;border-radius:10px;border:1.5px solid ${b.featured ? 'var(--ag-gold-border)' : 'var(--ag-border)'};background:${b.featured ? 'var(--ag-warn-bg)' : 'var(--ag-surface)'};color:#C99A3F;cursor:pointer;display:flex;align-items:center;justify-content:center;`)}
              >
                <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>{b.featured ? 'star' : 'star_outline'}</span>
              </button>
              <button
                onClick={() => toggleActive(b)}
                title={b.status === 'approved' ? 'Suspend boutique' : 'Activate boutique'}
                style={css(`width:34px;height:34px;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;border:none;background:${b.status === 'approved' ? 'var(--ag-bad-bg)' : 'var(--ag-good-bg)'};color:${b.status === 'approved' ? '#D6455A' : 'var(--ag-good-text)'};`)}
              >
                <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>{b.status === 'approved' ? 'pause' : 'check'}</span>
              </button>
            </div>
          </div>
        );
      })}
        </div>
      </div>
    </div>
  );
}
