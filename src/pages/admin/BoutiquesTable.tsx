import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { TONES, statusStyle } from '@/data/demo';
import { useShop } from '@/state/ShopContext';
import { useAsync } from '@/hooks/useAsync';
import { fetchAllBoutiquesAdmin, setBoutiqueStatus, type AdminBoutiqueRow } from '@/data/boutiques';
import { BOUTIQUE_STATUS_LABEL, type BoutiqueStatus } from '@/data/types';
import { SearchInput, Select, T } from '@/components/admin/kit';

const GRID = 'display:grid;grid-template-columns:1.8fr 1fr .8fr .8fr 1fr .8fr;';
/** Every cell truncates rather than spilling into the next column. Long
 *  boutique names ("sakthi Udhaya Lakshmanan N's Boutique") used to run straight
 *  over the CITY value because grid items default to min-width:auto. */
const CELL = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

type StatusFilter = 'all' | BoutiqueStatus;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'approved', label: BOUTIQUE_STATUS_LABEL.approved },
  { value: 'pending', label: BOUTIQUE_STATUS_LABEL.pending },
  { value: 'changes_requested', label: BOUTIQUE_STATUS_LABEL.changes_requested },
  { value: 'draft', label: BOUTIQUE_STATUS_LABEL.draft },
  { value: 'rejected', label: BOUTIQUE_STATUS_LABEL.rejected },
];

export function BoutiquesTable() {
  const { showToast } = useShop();
  const { data: rows, loading, reload } = useAsync(() => fetchAllBoutiquesAdmin(), []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const all = rows ?? [];

  // Products and Orders both filter and search; this table listed every row with
  // no way to narrow it, which stops being usable past a page of boutiques.
  const boutiques = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((b) => {
      if (status !== 'all' && b.status !== status) return false;
      if (!needle) return true;
      return (
        b.name.toLowerCase().includes(needle) ||
        (b.city ?? '').toLowerCase().includes(needle) ||
        (b.owner?.full_name ?? '').toLowerCase().includes(needle)
      );
    });
  }, [all, q, status]);

  const run = async (fn: () => Promise<void>, msg: string) => {
    try {
      await fn();
      showToast(msg);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const toggleActive = (b: AdminBoutiqueRow) =>
    b.status === 'approved'
      ? run(() => setBoutiqueStatus(b.id, 'pending'), `${b.name} suspended`)
      : run(() => setBoutiqueStatus(b.id, 'approved'), `${b.name} activated`);

  return (
    <div style={css('display:flex;flex-direction:column;gap:14px;')}>
      <div style={css('display:flex;gap:10px;flex-wrap:wrap;align-items:center;')}>
        <SearchInput value={q} onChange={setQ} placeholder="Search boutique, owner or city…" />
        <Select value={status} onChange={(v) => setStatus(v as StatusFilter)} options={STATUS_OPTIONS} />
        <div style={css('flex:1;')} />
        <span style={css(`font-size:12px;font-weight:600;color:${T.muted};`)}>
          {boutiques.length} of {all.length}
        </span>
      </div>

      <div style={css('background:var(--ag-surface);border-radius:18px;overflow:hidden;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
        <div className="agx-adm-tablewrap">
          <div className="agx-adm-tablegrid">
            <div style={css(`${GRID}padding:14px 20px;background:var(--ag-surface-2);font-size:12px;font-weight:800;color:var(--ag-muted);`)}>
              <span>BOUTIQUE</span><span>CITY</span><span>RATING</span><span>REVIEWS</span><span>STATUS</span><span style={css('text-align:right;')}>ACTIONS</span>
            </div>
            {loading && <div style={css('padding:20px;color:var(--ag-muted);font-size:13.5px;')}>Loading boutiques…</div>}
            {!loading && all.length === 0 && (
              <div style={css('padding:20px;color:var(--ag-muted);font-size:13.5px;')}>No boutiques yet.</div>
            )}
            {!loading && all.length > 0 && boutiques.length === 0 && (
              <div style={css('padding:20px;color:var(--ag-muted);font-size:13.5px;')}>No boutiques match this search or filter.</div>
            )}
            {boutiques.map((b, i) => {
              // The same wording the Approvals screen uses. This table used to
              // relabel 'approved' as "Active", so one state had two names
              // depending on which page you were looking at.
              const label = BOUTIQUE_STATUS_LABEL[b.status];
              const st = statusStyle(b.status === 'approved' ? 'Approved' : b.status === 'rejected' ? 'Rejected' : 'Pending');
              return (
                <div key={b.id} style={css(`${GRID}padding:14px 20px;align-items:center;border-top:1px solid var(--ag-border-soft);`)}>
                  <div style={css('display:flex;align-items:center;gap:10px;min-width:0;')}>
                    <div style={css(`width:36px;height:36px;flex:none;border-radius:11px;background:${TONES[b.tone ?? i % TONES.length]};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;color:rgba(42,26,32,.5);`)}>{b.name[0]}</div>
                    <div style={css('min-width:0;')}>
                      <div style={css(`font-weight:700;font-size:13.5px;${CELL}`)}>{b.name}</div>
                      <div style={css(`font-size:11.5px;color:var(--ag-muted);${CELL}`)}>{b.owner?.full_name ?? '—'}</div>
                    </div>
                  </div>
                  <span style={css(`font-size:13px;color:var(--ag-label);${CELL}`)}>{b.city || '—'}</span>
                  {/* "⭐ 0" read as a zero-star rating rather than "no ratings
                      yet", which is what an unreviewed boutique actually is. */}
                  <span style={css(`font-size:13px;font-weight:700;color:${b.reviews_count > 0 ? 'var(--ag-crimson)' : 'var(--ag-muted)'};${CELL}`)}>
                    {b.reviews_count > 0 ? `⭐ ${b.rating}` : '—'}
                  </span>
                  <span style={css(`font-size:13px;color:var(--ag-label);${CELL}`)}>{b.reviews_count}</span>
                  <span style={css('min-width:0;')}>
                    <span style={css(`display:inline-block;max-width:100%;font-size:11px;font-weight:800;padding:4px 10px;border-radius:8px;background:${st.bg};color:${st.fg};${CELL}`)}>{label}</span>
                  </span>
                  <div style={css('display:flex;gap:8px;justify-content:flex-end;')}>
                    {/* The "featured" star toggle used to live here. It wrote
                        boutiques.featured, which no buyer surface reads —
                        src/lib/ranking.ts deliberately excludes it as paid
                        placement — so it was a control that did nothing. */}
                    <button
                      onClick={() => toggleActive(b)}
                      title={b.status === 'approved' ? 'Suspend boutique' : 'Activate boutique'}
                      style={css(`width:34px;height:34px;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;border:none;background:${b.status === 'approved' ? 'var(--ag-bad-bg)' : 'var(--ag-good-bg)'};color:${b.status === 'approved' ? 'var(--ag-danger-text)' : 'var(--ag-good-text)'};`)}
                    >
                      <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>{b.status === 'approved' ? 'pause' : 'check'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
