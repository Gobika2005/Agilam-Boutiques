import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { fetchReviews, submitReview, type ReviewRow } from '@/data/reviews';

/**
 * Customer reviews for a product. Reads the real `reviews` table (public via
 * RLS, so anonymous buyers see them) and lets a signed-in buyer write one.
 * Replaces the previous hard-coded review list on the product page.
 */

const TONE_BG = ['#F4D6E2', '#E7D9F0', '#D6E4F0', '#F0E4D6', '#D9F0E4', '#F0D9D9'];
const starsFor = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export function ProductReviews({ productId, boutiqueId }: { productId: string; boutiqueId: string }) {
  const navigate = useNavigate();
  const { session, profile } = useAuth();
  const { data, loading, reload } = useAsync(() => fetchReviews(productId), [productId]);
  const reviews = useMemo<ReviewRow[]>(() => data ?? [], [data]);

  const [formOpen, setFormOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signedIn = !!session;
  const buyerId = session?.user?.id ?? '';
  const myReview = reviews.find((r) => r.buyer_id === buyerId);

  // Real rating summary — the average, count and per-star spread are all derived
  // from the reviews actually on file, so an unreviewed product reads 0/0% rather
  // than a hard-coded distribution.
  const summary = useMemo(() => {
    const count = reviews.length;
    const avg = count ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;
    const bars = [5, 4, 3, 2, 1].map((stars) => {
      const n = reviews.filter((r) => r.rating === stars).length;
      return { stars, pct: count ? Math.round((n / count) * 100) : 0 };
    });
    return { count, avg, bars };
  }, [reviews]);

  const onWriteClick = () => {
    if (!signedIn) {
      navigate('/auth/signin/buyer');
      return;
    }
    // Pre-fill the form when editing an existing review.
    if (myReview) {
      setRating(myReview.rating);
      setBody(myReview.body);
    }
    setError(null);
    setFormOpen((v) => !v);
  };

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await submitReview({
      productId,
      boutiqueId,
      buyerId,
      rating,
      body,
      authorName: profile?.full_name ?? null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFormOpen(false);
    setBody('');
    reload();
  };

  return (
    <div style={css('display:flex;flex-direction:column;gap:12px;')}>
      {/* Rating summary — real average + spread over the reviews on file. */}
      <div style={css('background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:16px;padding:18px;')}>
        <div style={css('display:flex;align-items:center;gap:18px;')}>
          <div style={css('text-align:center;')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:44px;line-height:1;color:var(--ag-crimson);")}>
              {summary.count ? summary.avg.toFixed(1) : '—'}
            </div>
            <div style={css('color:#E0B84B;font-size:15px;letter-spacing:2px;margin-top:4px;')}>
              {summary.count ? starsFor(Math.round(summary.avg)) : '☆☆☆☆☆'}
            </div>
            <div style={css('color:var(--ag-muted);font-size:12px;margin-top:6px;')}>
              {summary.count} review{summary.count === 1 ? '' : 's'}
            </div>
          </div>
          <div style={css('flex:1;display:flex;flex-direction:column;gap:7px;')}>
            {summary.bars.map((r) => (
              <div key={r.stars} style={css('display:flex;align-items:center;gap:9px;')}>
                <span style={css('font-size:11px;font-weight:700;color:var(--ag-muted);width:10px;')}>{r.stars}</span>
                <span style={css("font-family:'Material Symbols Outlined';font-size:13px;color:#E0B84B;")}>star</span>
                <span style={css('flex:1;height:7px;border-radius:4px;background:var(--ag-border-soft);overflow:hidden;')}>
                  <span style={css(`display:block;height:100%;width:${r.pct}%;background:linear-gradient(90deg,#D6336C,#B02454);border-radius:4px;`)} />
                </span>
                <span style={css("font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--ag-muted);width:30px;text-align:right;")}>{r.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={onWriteClick}
        style={css('height:44px;border:1.5px solid #D6336C;background:var(--ag-surface);color:var(--ag-crimson);border-radius:13px;font-weight:800;font-size:13.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;')}
      >
        <span style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>rate_review</span>
        {myReview ? 'Edit your review' : signedIn ? 'Write a review' : 'Sign in to write a review'}
      </button>

      {formOpen && (
        <div style={css('background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:16px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;')}>
          <div style={css('display:flex;align-items:center;gap:8px;')}>
            <span style={css('font-weight:800;font-size:13px;color:var(--ag-ink-2);')}>Your rating</span>
            <div style={css('display:flex;gap:2px;')}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  style={css(`background:none;border:none;cursor:pointer;font-size:22px;line-height:1;padding:0 1px;color:${n <= rating ? '#E0B84B' : '#E0CBD3'};`)}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share what you loved — fit, fabric, delivery…"
            rows={3}
            style={css("width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--ag-border);border-radius:12px;padding:10px 12px;font-family:inherit;font-size:13.5px;color:#3A2A30;background:var(--ag-surface);")}
          />
          {error && <div style={css('color:#C0344A;font-size:12.5px;font-weight:700;')}>{error}</div>}
          <div style={css('display:flex;gap:9px;')}>
            <button
              onClick={onSubmit}
              disabled={submitting || body.trim().length === 0}
              style={css(`flex:1;height:42px;border:none;border-radius:12px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13.5px;cursor:${submitting || body.trim().length === 0 ? 'not-allowed' : 'pointer'};opacity:${submitting || body.trim().length === 0 ? '.6' : '1'};`)}
            >
              {submitting ? 'Saving…' : myReview ? 'Update review' : 'Post review'}
            </button>
            <button
              onClick={() => setFormOpen(false)}
              style={css('height:42px;padding:0 16px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-muted);border-radius:12px;font-weight:800;font-size:13px;cursor:pointer;')}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && reviews.length === 0 ? (
        <div style={css('color:var(--ag-muted);font-size:13px;padding:8px 2px;')}>Loading reviews…</div>
      ) : reviews.length === 0 ? (
        <div style={css('background:var(--ag-surface);border:1px dashed #EAD3DD;border-radius:16px;padding:22px;text-align:center;color:var(--ag-muted);font-size:13.5px;')}>
          No reviews yet. Be the first to share your experience.
        </div>
      ) : (
        reviews.map((rv) => {
          const name = rv.author_name?.trim() || 'Agilam buyer';
          const tone = TONE_BG[Math.abs(name.charCodeAt(0)) % TONE_BG.length];
          return (
            <div key={rv.id} style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:16px;padding:16px 18px;')}>
              <div style={css('display:flex;align-items:center;gap:12px;')}>
                <div style={css(`width:42px;height:42px;flex:none;border-radius:13px;background:${tone};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:18px;color:rgba(42,26,32,.55);`)}>{name[0].toUpperCase()}</div>
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('display:flex;align-items:center;gap:7px;flex-wrap:wrap;')}>
                    <span style={css('font-weight:700;font-size:14px;')}>{name}</span>
                    {rv.verified_purchase && (
                      <span style={css('display:inline-flex;align-items:center;gap:3px;background:var(--ag-good-bg);color:var(--ag-good);border-radius:7px;padding:2px 7px;font-size:10px;font-weight:800;')}>
                        <span style={css("font-family:'Material Symbols Outlined';font-size:12px;")}>verified</span>Verified
                      </span>
                    )}
                    {rv.buyer_id === buyerId && (
                      <span style={css('background:var(--ag-surface-2);color:var(--ag-crimson);border-radius:7px;padding:2px 7px;font-size:10px;font-weight:800;')}>You</span>
                    )}
                  </div>
                  <div style={css('color:var(--ag-muted);font-size:12px;margin-top:2px;')}>{timeAgo(rv.created_at)}</div>
                </div>
                <span style={css('color:#E0B84B;font-size:13px;letter-spacing:1px;')}>{starsFor(rv.rating)}</span>
              </div>
              {rv.body && <div style={css('color:var(--ag-ink-2);font-size:13.5px;line-height:1.6;margin-top:10px;')}>{rv.body}</div>}
            </div>
          );
        })
      )}
    </div>
  );
}
