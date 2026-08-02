import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchReviewsForBoutique, replyToReview, type BoutiqueReviewRow } from '@/data/reviews';

/**
 * Reviews inbox — every rating a buyer left on this boutique's pieces, with a
 * public reply the seller can post, edit or clear. The reply is written through
 * the `reply_to_review` RPC (migration 0045), which only lets the owning seller
 * touch the reply columns, so a seller can answer a review without being able to
 * rewrite the buyer's words.
 *
 * The default filter is "Needs reply" — the reviews with no answer yet, worst
 * ratings first — because that is the queue a seller actually works through.
 */

const starsFor = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const TONE_BG = ['#F4D6E2', '#E7D9F0', '#D6E4F0', 'var(--ag-gold-border)', '#D9F0E4', '#F0D9D9'];

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const FILTERS = ['Needs reply', 'All', 'Replied'] as const;
type Filter = (typeof FILTERS)[number];

export function Reviews() {
  const navigate = useNavigate();
  const { showToast } = useShop();
  const { boutique } = useMyBoutique();
  const { data, loading, reload } = useAsync(
    () => (boutique ? fetchReviewsForBoutique(boutique.id) : Promise.resolve([])),
    [boutique?.id],
  );
  const reviews = useMemo<BoutiqueReviewRow[]>(() => data ?? [], [data]);

  const [filter, setFilter] = useState<Filter>('Needs reply');
  // The review currently being answered, and the draft in its box.
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const summary = useMemo(() => {
    const count = reviews.length;
    const avg = count ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;
    const needsReply = reviews.filter((r) => !r.seller_reply).length;
    return { count, avg, needsReply };
  }, [reviews]);

  const shown = useMemo(() => {
    if (filter === 'Replied') return reviews.filter((r) => r.seller_reply);
    if (filter === 'All') return reviews;
    // Needs reply — unanswered first, lowest rating first (the ones that most
    // need a public response), then newest.
    return reviews
      .filter((r) => !r.seller_reply)
      .sort((a, b) => a.rating - b.rating || +new Date(b.created_at) - +new Date(a.created_at));
  }, [reviews, filter]);

  const openReply = (r: BoutiqueReviewRow) => {
    setOpenId(r.id);
    setDraft(r.seller_reply ?? '');
  };

  const send = async (r: BoutiqueReviewRow, clear = false) => {
    setBusyId(r.id);
    const res = await replyToReview(r.id, clear ? '' : draft);
    setBusyId(null);
    if (!res.ok) {
      showToast(res.error);
      return;
    }
    showToast(clear ? 'Reply removed' : 'Reply posted');
    setOpenId(null);
    setDraft('');
    reload();
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('padding:6px 20px 4px;')}>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;")}>Reviews</h1>
        <div style={css('font-size:12.5px;color:var(--ag-muted);font-weight:600;margin-top:2px;')}>
          What buyers say about your pieces — reply in public.
        </div>
      </div>

      {/* Summary ---------------------------------------------------------- */}
      <div style={css('margin:12px 20px 0;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:16px 18px;display:flex;gap:12px;flex-wrap:wrap;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}>
        <div style={css('flex:1;min-width:90px;')}>
          <div style={css('font-size:11.5px;color:var(--ag-muted);font-weight:700;')}>Average</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:23px;color:var(--ag-crimson);margin-top:3px;")}>
            {summary.count ? summary.avg.toFixed(1) : '—'} <span style={css('font-size:13px;color:var(--ag-star);')}>★</span>
          </div>
        </div>
        <div style={css('flex:1;min-width:90px;')}>
          <div style={css('font-size:11.5px;color:var(--ag-muted);font-weight:700;')}>Total reviews</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:23px;margin-top:3px;")}>{summary.count}</div>
        </div>
        <div style={css('flex:1;min-width:90px;')}>
          <div style={css('font-size:11.5px;color:var(--ag-muted);font-weight:700;')}>Needs reply</div>
          <div style={css(`font-family:'Playfair Display',serif;font-weight:700;font-size:23px;margin-top:3px;color:${summary.needsReply ? 'var(--ag-gold-text)' : 'var(--ag-good)'};`)}>{summary.needsReply}</div>
        </div>
      </div>

      {/* Filter ----------------------------------------------------------- */}
      <div style={css('display:flex;gap:8px;padding:14px 20px 6px;overflow-x:auto;')} className="agx-scroll">
        {FILTERS.map((f) => {
          const on = f === filter;
          const n = f === 'Needs reply' ? summary.needsReply : f === 'Replied' ? summary.count - summary.needsReply : summary.count;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={css(`flex:none;height:34px;padding:0 15px;border-radius:999px;border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'linear-gradient(135deg,#D6336C,#B02454)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-ink-2)'};font-weight:800;font-size:12.5px;cursor:pointer;`)}
            >
              {f} · {n}
            </button>
          );
        })}
      </div>

      <div style={css('display:flex;flex-direction:column;gap:10px;padding:6px 20px 0;')}>
        {loading && reviews.length === 0 && <div style={css('color:var(--ag-muted);font-size:14px;padding:8px 2px;')}>Loading reviews…</div>}

        {!loading && shown.length === 0 && (
          <div style={css('background:var(--ag-surface);border:1px dashed var(--ag-border);border-radius:18px;padding:30px 22px;text-align:center;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:32px;color:var(--ag-border);")}>reviews</span>
            <div style={css('font-weight:700;font-size:14.5px;margin-top:8px;color:var(--ag-ink);')}>
              {filter === 'Needs reply' && summary.count > 0 ? 'All caught up' : reviews.length === 0 ? 'No reviews yet' : 'Nothing here'}
            </div>
            <div style={css('font-size:12.5px;color:var(--ag-muted);font-weight:600;margin-top:4px;line-height:1.5;')}>
              {reviews.length === 0
                ? 'When buyers review your pieces, they show up here for you to reply to.'
                : filter === 'Needs reply'
                  ? "You've replied to everything that needs it."
                  : 'Try another filter.'}
            </div>
          </div>
        )}

        {shown.map((r) => {
          const name = r.author_name?.trim() || 'MangaiMart buyer';
          const tone = TONE_BG[Math.abs(name.charCodeAt(0)) % TONE_BG.length];
          const editing = openId === r.id;
          const busy = busyId === r.id;
          return (
            <div key={r.id} style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:14px 16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.55);')}>
              {/* Which product, tappable to its analytics. */}
              <button
                onClick={() => navigate(`/seller/products/${r.product_id}`)}
                style={css('width:100%;display:flex;align-items:center;gap:10px;border:none;background:none;cursor:pointer;text-align:left;padding:0 0 10px;font-family:inherit;border-bottom:1px solid var(--ag-border-soft);')}
              >
                <span style={css('width:38px;height:38px;flex:none;border-radius:11px;overflow:hidden;background:var(--ag-surface-2);display:block;')}>
                  {r.product_image && <img src={r.product_image} alt="" style={css('width:100%;height:100%;object-fit:cover;')} />}
                </span>
                <span style={css('flex:1;min-width:0;font-weight:700;font-size:12.5px;color:var(--ag-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{r.product_title ?? 'Product'}</span>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;color:#CBB0BC;")}>chevron_right</span>
              </button>

              {/* The review itself. */}
              <div style={css('display:flex;align-items:center;gap:11px;margin-top:11px;')}>
                <div style={css(`width:40px;height:40px;flex:none;border-radius:12px;background:${tone};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:17px;color:rgba(42,26,32,.55);`)}>{name[0].toUpperCase()}</div>
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('display:flex;align-items:center;gap:7px;flex-wrap:wrap;')}>
                    <span style={css('font-weight:700;font-size:13.5px;')}>{name}</span>
                    {r.verified_purchase && (
                      <span style={css('display:inline-flex;align-items:center;gap:3px;background:var(--ag-good-bg);color:var(--ag-good);border-radius:7px;padding:2px 6px;font-size:9.5px;font-weight:800;')}>
                        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:11px;")}>verified</span>Verified
                      </span>
                    )}
                  </div>
                  <div style={css('color:var(--ag-muted);font-size:11.5px;margin-top:1px;')}>{timeAgo(r.created_at)}</div>
                </div>
                <span style={css('color:var(--ag-gold-text);font-size:13px;letter-spacing:1px;flex:none;')}>{starsFor(r.rating)}</span>
              </div>
              {r.body && <div style={css('color:var(--ag-ink-2);font-size:13.5px;line-height:1.6;margin-top:9px;')}>{r.body}</div>}
              {r.images?.length > 0 && (
                <div style={css('display:flex;gap:7px;margin-top:10px;flex-wrap:wrap;')}>
                  {r.images.map((src) => (
                    <a key={src} href={src} target="_blank" rel="noreferrer noopener" style={css('display:block;width:58px;height:58px;border-radius:10px;overflow:hidden;flex:none;')}>
                      <img src={src} alt="" style={css('width:100%;height:100%;object-fit:cover;display:block;')} />
                    </a>
                  ))}
                </div>
              )}

              {/* Existing reply (when not editing). */}
              {r.seller_reply && !editing && (
                <div style={css('margin-top:12px;padding:11px 13px;background:var(--ag-surface-2);border-left:3px solid #D6336C;border-radius:0 12px 12px 0;')}>
                  <div style={css('display:flex;align-items:center;gap:6px;')}>
                    <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:14px;color:var(--ag-crimson);")}>storefront</span>
                    <span style={css('font-weight:800;font-size:11.5px;color:var(--ag-crimson);')}>Your reply</span>
                    {r.seller_reply_at && <span style={css('color:var(--ag-muted);font-size:11px;')}>· {timeAgo(r.seller_reply_at)}</span>}
                  </div>
                  <div style={css('color:var(--ag-ink-2);font-size:13px;line-height:1.55;margin-top:5px;')}>{r.seller_reply}</div>
                </div>
              )}

              {/* Reply editor. */}
              {editing ? (
                <div style={css('margin-top:12px;')}>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Thank them, or set something right — buyers see this publicly."
                    rows={3}
                    autoFocus
                    style={css('width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--ag-border);border-radius:12px;padding:10px 12px;font-family:inherit;font-size:13.5px;color:var(--ag-ink-2);background:var(--ag-bg);')}
                  />
                  <div style={css('display:flex;gap:8px;margin-top:9px;flex-wrap:wrap;')}>
                    <button
                      onClick={() => send(r)}
                      disabled={busy || draft.trim().length === 0}
                      style={css(`flex:1;min-width:120px;height:42px;border:none;border-radius:12px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13.5px;cursor:${busy || !draft.trim() ? 'not-allowed' : 'pointer'};opacity:${busy || !draft.trim() ? '.6' : '1'};`)}
                    >
                      {busy ? 'Saving…' : r.seller_reply ? 'Update reply' : 'Post reply'}
                    </button>
                    {r.seller_reply && (
                      <button onClick={() => send(r, true)} disabled={busy} style={css('height:42px;padding:0 14px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-danger-text);border-radius:12px;font-weight:800;font-size:12.5px;cursor:pointer;')}>Remove</button>
                    )}
                    <button onClick={() => { setOpenId(null); setDraft(''); }} disabled={busy} style={css('height:42px;padding:0 16px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-muted);border-radius:12px;font-weight:800;font-size:12.5px;cursor:pointer;')}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => openReply(r)}
                  style={css(`margin-top:12px;height:40px;width:100%;border:1.5px solid ${r.seller_reply ? 'var(--ag-border)' : '#D6336C'};background:var(--ag-surface);color:var(--ag-crimson);border-radius:12px;font-weight:800;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;`)}
                >
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>{r.seller_reply ? 'edit' : 'reply'}</span>
                  {r.seller_reply ? 'Edit reply' : 'Reply'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
