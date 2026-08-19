import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { useAsync } from '@/hooks/useAsync';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { fetchAllReviews, setReviewHidden, deleteReview, type AdminReviewRow } from '@/data/adminReviews';
import { logAdminAction } from '@/data/activityLog';
import { StatCard, Select, SearchInput, EmptyState, IconButton, ConfirmDialog, Icon, T } from '@/components/admin/kit';
import { useSeededSearch } from '@/hooks/useSeededSearch';

const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

function Stars({ n }: { n: number }) {
  return (
    <span style={css('display:inline-flex;gap:1px;')}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" size={14} color={i <= n ? '#E8A13C' : 'var(--ag-border)'} />
      ))}
    </span>
  );
}

type Filter = 'all' | 'low' | 'hidden';

export function ReviewsAdmin() {
  const { data, loading, reload } = useAsync(() => fetchAllReviews(), []);
  const { showToast } = useShop();
  const { profile } = useAuth();
  const [q, setQ] = useSeededSearch();
  const [filter, setFilter] = useState<Filter>('all');
  const [toDelete, setToDelete] = useState<AdminReviewRow | null>(null);
  const [busy, setBusy] = useState(false);

  const all = data ?? [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      if (filter === 'low' && r.rating > 2) return false;
      if (filter === 'hidden' && !r.hidden) return false;
      if (!needle) return true;
      return (r.body ?? '').toLowerCase().includes(needle) ||
        (r.product_title ?? '').toLowerCase().includes(needle) ||
        (r.boutique_name ?? '').toLowerCase().includes(needle) ||
        (r.author_name ?? '').toLowerCase().includes(needle);
    });
  }, [all, q, filter]);

  const avg = all.length ? (all.reduce((s, r) => s + r.rating, 0) / all.length).toFixed(1) : '—';
  const low = all.filter((r) => r.rating <= 2).length;
  const hidden = all.filter((r) => r.hidden).length;

  const toggleHide = async (r: AdminReviewRow) => {
    const res = await setReviewHidden(r.id, !r.hidden);
    if (!res.ok) { showToast(res.error); return; }
    void logAdminAction({ actor_id: profile?.id, actor_name: profile?.full_name ?? 'Admin', action: r.hidden ? 'review.unhide' : 'review.hide', entity_type: 'review', entity_id: r.id });
    showToast(r.hidden ? 'Review restored' : 'Review hidden');
    reload();
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    const res = await deleteReview(toDelete.id);
    setBusy(false);
    if (!res.ok) { showToast(res.error); return; }
    void logAdminAction({ actor_id: profile?.id, actor_name: profile?.full_name ?? 'Admin', action: 'review.delete', entity_type: 'review', entity_id: toDelete.id });
    showToast('Review deleted');
    setToDelete(null);
    reload();
  };

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      <div className="agx-adm-g4">
        <StatCard label="Total reviews" value={String(all.length)} icon="reviews" tint="var(--ag-surface-2)" ic="#D6336C" />
        <StatCard label="Average rating" value={String(avg)} icon="star" tint="var(--ag-warn-bg)" ic="#E8A13C" />
        <StatCard label="Low ratings" value={String(low)} icon="sentiment_dissatisfied" tint="var(--ag-bad-bg)" ic="var(--ag-bad-text)" sub={low ? 'needs a look' : 'none'} />
        <StatCard label="Hidden" value={String(hidden)} icon="visibility_off" tint="var(--ag-info-bg)" ic="var(--ag-info-text)" />
      </div>

      <div style={css('display:flex;gap:10px;flex-wrap:wrap;')}>
        <SearchInput value={q} onChange={setQ} placeholder="Search reviews, product, boutique…" />
        <Select value={filter} onChange={(v) => setFilter(v as Filter)} options={[
          { value: 'all', label: 'All reviews' },
          { value: 'low', label: `Low ratings (${low})` },
          { value: 'hidden', label: `Hidden (${hidden})` },
        ]} />
      </div>

      {loading && all.length === 0 ? (
        <div style={css(T.card + `padding:22px;color:${T.muted};font-size:13.5px;`)}>Loading reviews…</div>
      ) : rows.length === 0 ? (
        <div style={css(T.card + 'padding:8px;')}><EmptyState icon="reviews" title="No reviews here" sub="Buyer reviews across every boutique appear here for moderation." /></div>
      ) : (
        <div style={css('display:flex;flex-direction:column;gap:12px;')}>
          {rows.map((r) => (
            <div key={r.id} style={css(T.card + `padding:18px;${r.hidden ? 'opacity:.62;' : ''}`)}>
              <div style={css('display:flex;align-items:flex-start;gap:12px;')}>
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('display:flex;align-items:center;gap:10px;flex-wrap:wrap;')}>
                    <Stars n={r.rating} />
                    <span style={css('font-weight:700;font-size:13.5px;')}>{r.author_name ?? 'Anonymous'}</span>
                    {r.verified_purchase && <span style={css(`font-size:10.5px;font-weight:800;color:var(--ag-good-text);background:var(--ag-good-bg);padding:2px 7px;border-radius:6px;`)}>Verified</span>}
                    {r.hidden && <span style={css(`font-size:10.5px;font-weight:800;color:var(--ag-muted);background:var(--ag-surface-2);padding:2px 7px;border-radius:6px;`)}>Hidden</span>}
                    <span style={css(`font-size:11.5px;color:${T.muted};`)}>· {timeAgo(r.created_at)}</span>
                  </div>
                  <div style={css(`font-size:11.5px;color:${T.muted};margin-top:4px;`)}>
                    {r.product_title ?? 'Product'} · {r.boutique_name ?? 'Boutique'}
                  </div>
                  {r.body && <div style={css('font-size:13.5px;line-height:1.55;margin-top:10px;color:var(--ag-ink);')}>{r.body}</div>}
                  {r.images.length > 0 && (
                    <div style={css('display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;')}>
                      {r.images.slice(0, 5).map((src) => (
                        <img key={src} src={src} alt="" style={css('width:52px;height:52px;border-radius:10px;object-fit:cover;')} />
                      ))}
                    </div>
                  )}
                  {r.seller_reply && (
                    <div style={css('margin-top:10px;padding:10px 12px;background:var(--ag-surface-2);border-radius:10px;')}>
                      <div style={css(`font-size:10.5px;font-weight:800;color:${T.muted};text-transform:uppercase;letter-spacing:.04em;`)}>Seller reply</div>
                      <div style={css('font-size:12.5px;margin-top:3px;')}>{r.seller_reply}</div>
                    </div>
                  )}
                </div>
                <div style={css('display:flex;gap:8px;flex:none;')}>
                  <IconButton icon={r.hidden ? 'visibility' : 'visibility_off'} title={r.hidden ? 'Restore' : 'Hide'} onClick={() => toggleHide(r)} />
                  <IconButton icon="delete" tone="danger" title="Delete" onClick={() => setToDelete(r)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete this review?"
        message="This permanently removes the review and its photos. Hiding is usually enough — deletion cannot be undone."
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
