import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { css } from '@/lib/css';
import { imageUrl } from '@/lib/imageUrl';
import { timeAgo } from '@/lib/timeAgo';
import { useAsync } from '@/hooks/useAsync';
import { useCatalog } from '@/state/CatalogContext';
import { routes } from '@/lib/seo';
import { fetchReviewsForBoutique, type BoutiqueReviewRow } from '@/data/reviews';

/**
 * What buyers say about a boutique — every review across its catalogue.
 *
 * The profile header has always claimed a rating and a review count and given
 * the reader no way to read one, which is the least persuasive form a review
 * can take: a number a shop asserts about itself. This is the evidence behind
 * it, on the page where someone decides whether to trust a shop they have never
 * heard of.
 *
 * Read-only by design. A review belongs to a *piece* — it is written from the
 * product page after an order — so there is no form here; each card links back
 * to the piece it is about instead.
 *
 * The seller's public replies (migration 0045) are shown with the review they
 * answer. That is deliberate and it favours the honest shop: a boutique that
 * responds to a three-star review reads better than one with nothing but
 * five-star silence.
 */

const TONE_BG = ['#F4D6E2', '#E7D9F0', '#D6E4F0', 'var(--ag-gold-border)', '#D9F0E4', '#F0D9D9'];
const starsFor = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

/** Shown before the buyer asks for the rest. Enough to be evidence, short
 *  enough that the product grid above it is still the page. */
const PREVIEW_COUNT = 4;

export function BoutiqueReviews({ boutiqueId }: { boutiqueId: string }) {
  const { data, loading } = useAsync(() => fetchReviewsForBoutique(boutiqueId), [boutiqueId]);
  const { productById } = useCatalog();
  const [expanded, setExpanded] = useState(false);

  const reviews = useMemo<BoutiqueReviewRow[]>(() => data ?? [], [data]);

  /**
   * The average and the spread, computed from the rows on screen rather than
   * read off `boutiques.rating`.
   *
   * They are the same number in practice, but this one is arithmetic the reader
   * can check against the list underneath it — and it cannot drift if the
   * denormalised column is ever stale.
   */
  const summary = useMemo(() => {
    if (!reviews.length) return null;
    const buckets = [0, 0, 0, 0, 0]; // index 0 = 1★
    let total = 0;
    for (const r of reviews) {
      const n = Math.min(5, Math.max(1, Math.round(r.rating)));
      buckets[n - 1] += 1;
      total += n;
    }
    return { average: total / reviews.length, buckets, count: reviews.length };
  }, [reviews]);

  if (loading) {
    return (
      <div style={css('display:flex;flex-direction:column;gap:12px;margin-top:18px;')}>
        {[0, 1].map((i) => (
          <span key={i} className="agx-shimmer" style={css('display:block;height:96px;border-radius:16px;')} />
        ))}
      </div>
    );
  }

  // No reviews is a normal state for a new boutique, and saying so plainly beats
  // hiding the section — a shop with no reviews yet is not a shop with something
  // to hide.
  if (!summary) {
    return (
      <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:30px 24px;margin-top:14px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;')}>
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:32px;color:var(--ag-border);")}>rate_review</span>
        <div style={css('font-weight:800;font-size:15px;margin-top:10px;')}>No reviews yet</div>
        <div style={css('color:var(--ag-muted);font-size:13px;margin-top:4px;max-width:320px;line-height:1.55;')}>
          This boutique is new to MangaiMart. Reviews appear here once buyers have received their orders.
        </div>
      </div>
    );
  }

  const shown = expanded ? reviews : reviews.slice(0, PREVIEW_COUNT);

  return (
    <>
      {/* Summary — the average, then how it is distributed. The bars matter:
          4.6 from twenty reviews and 4.6 from two 5★ and one 4★ are different
          claims, and only the spread tells them apart. */}
      <div style={css('display:flex;flex-wrap:wrap;align-items:center;gap:clamp(16px,4vw,40px);margin-top:16px;padding:18px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;')}>
        <div style={css('text-align:center;flex:none;')}>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:38px;line-height:1;")}>
            {summary.average.toFixed(1)}
          </div>
          <div style={css('color:var(--ag-gold-text);font-size:14px;letter-spacing:2px;margin-top:4px;')}>
            {starsFor(Math.round(summary.average))}
          </div>
          <div style={css('color:var(--ag-muted);font-size:12px;margin-top:5px;font-weight:600;')}>
            {summary.count} {summary.count === 1 ? 'review' : 'reviews'}
          </div>
        </div>
        <div style={css('flex:1;min-width:180px;display:flex;flex-direction:column;gap:5px;')}>
          {[5, 4, 3, 2, 1].map((star) => {
            const n = summary.buckets[star - 1];
            const pct = Math.round((n / summary.count) * 100);
            return (
              <div key={star} style={css('display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--ag-muted);font-weight:700;')}>
                <span style={css('width:26px;flex:none;')}>{star} ★</span>
                <span style={css('flex:1;height:7px;border-radius:4px;background:var(--ag-surface-3);overflow:hidden;')}>
                  <span style={css(`display:block;width:${pct}%;height:100%;background:var(--ag-star);`)} />
                </span>
                <span style={css('width:22px;flex:none;text-align:right;')}>{n}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={css('display:flex;flex-direction:column;gap:12px;margin-top:14px;')}>
        {shown.map((rv) => {
          const name = rv.author_name?.trim() || 'MangaiMart buyer';
          const tone = TONE_BG[Math.abs(name.charCodeAt(0)) % TONE_BG.length];
          // The piece it is about. Looked up in the catalogue so the card can
          // link to it; the joined title is the fallback when the product has
          // since been delisted, which still reads correctly.
          const product = productById(rv.product_id);
          return (
            <div key={rv.id} style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:16px;padding:16px 18px;')}>
              <div style={css('display:flex;align-items:center;gap:12px;')}>
                <div style={css(`width:42px;height:42px;flex:none;border-radius:13px;background:${tone};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:18px;color:rgba(42,26,32,.55);`)}>{name[0].toUpperCase()}</div>
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('display:flex;align-items:center;gap:7px;flex-wrap:wrap;')}>
                    <span style={css('font-weight:700;font-size:14px;')}>{name}</span>
                    {rv.verified_purchase && (
                      <span style={css('display:inline-flex;align-items:center;gap:3px;background:var(--ag-good-bg);color:var(--ag-good);border-radius:7px;padding:2px 7px;font-size:10px;font-weight:800;')}>
                        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:12px;")}>verified</span>Verified
                      </span>
                    )}
                  </div>
                  <div style={css('color:var(--ag-muted);font-size:12px;margin-top:2px;')}>{timeAgo(rv.created_at)}</div>
                </div>
                <span style={css('color:var(--ag-gold-text);font-size:13px;letter-spacing:1px;')}>{starsFor(rv.rating)}</span>
              </div>

              {/* Which piece — the line the product page's own review list does
                  not need and this one cannot do without. */}
              {(product || rv.product_title) && (
                <div style={css('margin-top:11px;')}>
                  {product ? (
                    <Link
                      to={routes.product(product)}
                      style={css('display:inline-flex;align-items:center;gap:9px;padding:6px 12px 6px 6px;background:var(--ag-surface-2);border-radius:999px;text-decoration:none;color:var(--ag-ink-2);max-width:100%;')}
                    >
                      {rv.product_image && (
                        <img src={imageUrl(rv.product_image, 96)} alt="" width={28} height={28} loading="lazy" decoding="async" style={css('width:28px;height:28px;border-radius:999px;object-fit:cover;flex:none;')} />
                      )}
                      <span style={css('font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{rv.product_title ?? product.title}</span>
                    </Link>
                  ) : (
                    <span style={css('display:inline-block;font-size:12.5px;color:var(--ag-muted);font-weight:600;')}>On {rv.product_title}</span>
                  )}
                </div>
              )}

              {rv.body && <div style={css('color:var(--ag-ink-2);font-size:13.5px;line-height:1.6;margin-top:10px;')}>{rv.body}</div>}

              {rv.images?.length > 0 && (
                <div style={css('display:flex;gap:8px;margin-top:11px;flex-wrap:wrap;')}>
                  {rv.images.map((src) => (
                    <a key={src} href={src} target="_blank" rel="noreferrer noopener" style={css('display:block;width:64px;height:64px;border-radius:11px;overflow:hidden;flex:none;')}>
                      <img src={imageUrl(src, 192)} alt="Photo from a buyer's review" width={64} height={64} loading="lazy" decoding="async" style={css('width:100%;height:100%;object-fit:cover;display:block;')} />
                    </a>
                  ))}
                </div>
              )}

              {rv.seller_reply && (
                <div style={css('margin-top:12px;margin-left:14px;padding:12px 14px;background:var(--ag-surface-2);border-left:3px solid #D6336C;border-radius:0 12px 12px 0;')}>
                  <div style={css('display:flex;align-items:center;gap:6px;')}>
                    <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;color:var(--ag-crimson);")}>storefront</span>
                    <span style={css('font-weight:800;font-size:12px;color:var(--ag-crimson);')}>Reply from the boutique</span>
                    {rv.seller_reply_at && <span style={css('color:var(--ag-muted);font-size:11px;')}>· {timeAgo(rv.seller_reply_at)}</span>}
                  </div>
                  <div style={css('color:var(--ag-ink-2);font-size:13px;line-height:1.6;margin-top:6px;')}>{rv.seller_reply}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Expands in place rather than navigating: there is no per-boutique
          reviews page, and inventing one for a list already in memory would
          cost a round trip to show the same rows. */}
      {reviews.length > PREVIEW_COUNT && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={css('width:100%;margin-top:12px;padding:13px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;color:var(--ag-crimson);font-weight:800;font-size:13.5px;cursor:pointer;font-family:inherit;')}
        >
          {expanded ? 'Show fewer reviews' : `Read all ${reviews.length} reviews`}
        </button>
      )}
    </>
  );
}
