import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { TONES, fmt } from '@/data/demo';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchProductsByBoutique } from '@/data/products';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import { ImageSlot } from '@/components/ui/ImageSlot';
import type { ProductWithBoutique } from '@/data/types';

/**
 * Storefront preview — how the boutique shows up on the buyer's Inspire feed.
 *
 * Inspire is the platform's organic-discovery surface: a story rail plus a
 * scrolling feed, both assembled straight from the catalogue (there is no
 * separate posting step). Sellers had no window onto it — they couldn't see
 * their own story ring, the auto-badges it can earn, or how a listing reads as a
 * feed card. This page is that window: a read-only mirror of the buyer surface,
 * built from this boutique's own products, so the seller can see what buyers see
 * and understand the levers (list new pieces → NEW, mark down → OFFERS, grow
 * followers → TRENDING).
 */

const SLIDES = 5;
const NEW_DAYS = 7;

export function Storefront() {
  const navigate = useNavigate();
  const { boutique } = useMyBoutique();
  const { data, loading } = useAsync(
    () => (boutique ? fetchProductsByBoutique(boutique.id) : Promise.resolve([])),
    [boutique?.id],
  );
  const products = useMemo<ProductWithBoutique[]>(() => data ?? [], [data]);

  const imgOf = (p: ProductWithBoutique) => p.image_url ?? p.images?.[0] ?? undefined;
  const slides = products.filter((p) => imgOf(p)).slice(0, SLIDES);
  const feed = products.filter((p) => imgOf(p)).slice(0, 3);

  const followers = boutique?.followers_count ?? 0;
  const hasOffer = products.some((p) => p.mrp && p.mrp > p.price);
  const listedRecently = products.some((p) => Date.now() - new Date(p.created_at).getTime() < NEW_DAYS * 86_400_000);

  // The live badge the ring would carry right now, in the same priority the
  // buyer rail uses (NEW → OFFERS → TRENDING).
  const liveBadge = listedRecently ? 'NEW' : hasOffer ? 'OFFERS' : null;
  const badgeColor = (b: string) => (b === 'NEW' ? '#D6336C' : b === 'OFFERS' ? 'var(--ag-bad-text)' : '#B0863B');

  const BADGES = [
    { key: 'NEW', icon: 'auto_awesome', title: 'NEW', how: 'Shows when you’ve just listed a piece — you’re among the newest shops on the feed.', active: listedRecently, tip: 'List a new piece to earn it.' },
    { key: 'OFFERS', icon: 'sell', title: 'OFFERS', how: 'Shows when at least one piece is marked down from its MRP.', active: hasOffer, tip: 'Put a piece on offer to earn it.' },
    { key: 'TRENDING', icon: 'trending_up', title: 'TRENDING', how: 'Shows for the most-followed shops on the platform.', active: null, tip: `You have ${followers} follower${followers === 1 ? '' : 's'}. Grow your following to reach it.` },
  ] as const;

  const boutiqueName = boutique?.name ?? 'Your boutique';

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('padding:6px 20px 4px;')}>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;")}>Your storefront</div>
        <div style={css('font-size:12.5px;color:var(--ag-muted);font-weight:600;margin-top:2px;')}>
          How you appear on Inspire, the buyer’s discovery feed.
        </div>
      </div>

      {/* Story ring preview ------------------------------------------------ */}
      <div style={css('margin:14px 20px 0;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:18px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}>
        <div className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-crimson);')}>Your story ring</div>
        <div style={css('display:flex;align-items:center;gap:16px;margin-top:12px;')}>
          <span style={css('position:relative;display:block;flex:none;')}>
            <span style={css('display:block;width:74px;height:74px;border-radius:50%;padding:2.5px;background:linear-gradient(140deg,#F0C7D8,#D6336C 48%,#8E1C44);')}>
              <span style={css('display:block;width:100%;height:100%;border-radius:50%;padding:2.5px;background:var(--ag-surface);')}>
                <BoutiqueLogo name={boutiqueName} src={boutique?.logo_url ?? undefined} size={62} />
              </span>
            </span>
            {liveBadge && (
              <span style={css(`position:absolute;left:50%;bottom:-4px;transform:translateX(-50%);background:${badgeColor(liveBadge)};color:#fff;font-family:'IBM Plex Mono',monospace;font-size:7.5px;font-weight:600;letter-spacing:.1em;padding:3px 7px;border-radius:999px;border:1.5px solid var(--ag-surface);white-space:nowrap;`)}>
                {liveBadge}
              </span>
            )}
          </span>
          <div style={css('flex:1;min-width:0;')}>
            <div style={css('font-weight:800;font-size:15px;')}>{boutiqueName}</div>
            <div style={css('font-size:12px;color:var(--ag-muted);font-weight:600;margin-top:2px;line-height:1.5;')}>
              {slides.length > 0
                ? `Your ${slides.length} newest ${slides.length === 1 ? 'piece appears' : 'pieces appear'} as story slides for the buyers who follow you.`
                : 'Add product photos and your story ring appears on the feed.'}
            </div>
          </div>
        </div>

        {/* The slides behind the ring. */}
        {slides.length > 0 && (
          <div className="agx-scroll" style={css('display:flex;gap:9px;overflow-x:auto;margin-top:14px;padding-bottom:2px;')}>
            {slides.map((p) => (
              <div key={p.id} style={css(`position:relative;flex:none;width:88px;height:132px;border-radius:14px;overflow:hidden;background:${TONES[p.tone % TONES.length]};`)}>
                <ImageSlot src={imgOf(p)} placeholder={p.title} style={css('position:absolute;inset:0;')} />
                {p.mrp && p.mrp > p.price && (
                  <span style={css('position:absolute;top:6px;left:6px;background:var(--ag-bad-text);color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:6px;')}>
                    {Math.round((1 - p.price / p.mrp) * 100)}% OFF
                  </span>
                )}
                <span style={css('position:absolute;left:0;right:0;bottom:0;padding:14px 7px 6px;background:linear-gradient(transparent,rgba(20,8,12,.72));color:#fff;font-size:10px;font-weight:800;')}>{fmt(Number(p.price))}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Badges ------------------------------------------------------------ */}
      <div style={css('margin:16px 20px 0;')}>
        <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);margin:0 4px 8px;')}>Discovery badges</div>
        <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:6px;box-shadow:0 12px 30px -24px rgba(107,20,54,.55);')}>
          {BADGES.map((b, i) => (
            <div key={b.key} style={css(`display:flex;gap:12px;padding:13px 12px;border-bottom:${i < BADGES.length - 1 ? '1px solid var(--ag-border-soft)' : 'none'};`)}>
              <span style={css(`width:40px;height:40px;flex:none;border-radius:12px;background:${badgeColor(b.key)}1f;display:flex;align-items:center;justify-content:center;`)}>
                <span style={css(`font-family:'Material Symbols Outlined';font-size:21px;color:${badgeColor(b.key)};`)}>{b.icon}</span>
              </span>
              <div style={css('flex:1;min-width:0;')}>
                <div style={css('display:flex;align-items:center;gap:8px;flex-wrap:wrap;')}>
                  <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.08em;color:${badgeColor(b.key)};`)}>{b.title}</span>
                  {b.active === true && (
                    <span style={css('display:inline-flex;align-items:center;gap:3px;background:var(--ag-good-bg);color:var(--ag-good);border-radius:7px;padding:2px 7px;font-size:9.5px;font-weight:800;')}>
                      <span style={css("font-family:'Material Symbols Outlined';font-size:11px;")}>check</span>Showing now
                    </span>
                  )}
                  {b.active === false && (
                    <span style={css('background:var(--ag-surface-2);color:var(--ag-muted);border-radius:7px;padding:2px 7px;font-size:9.5px;font-weight:800;')}>Not yet</span>
                  )}
                </div>
                <div style={css('font-size:12px;color:var(--ag-ink-2);font-weight:600;margin-top:4px;line-height:1.5;')}>{b.how}</div>
                <div style={css('font-size:11.5px;color:var(--ag-muted);margin-top:3px;line-height:1.45;')}>{b.tip}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Feed-card preview ------------------------------------------------- */}
      <div style={css('margin:16px 20px 0;')}>
        <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);margin:0 4px 8px;')}>In the feed</div>
        {loading && products.length === 0 && <div style={css('color:var(--ag-muted);font-size:14px;padding:8px 2px;')}>Loading…</div>}
        {!loading && feed.length === 0 && (
          <div style={css('background:var(--ag-surface);border:1px dashed var(--ag-border);border-radius:18px;padding:26px 22px;text-align:center;')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:30px;color:var(--ag-border);")}>image</span>
            <div style={css('font-weight:700;font-size:14px;margin-top:7px;color:var(--ag-ink);')}>No pieces to preview yet</div>
            <div style={css('font-size:12.5px;color:#A98D99;font-weight:600;margin-top:4px;line-height:1.5;')}>Add a product with a photo and it appears here exactly as buyers see it in Inspire.</div>
            <button onClick={() => navigate('/seller/add-product')} style={css('margin-top:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;border:none;border-radius:12px;padding:11px 20px;font-weight:800;font-size:13px;cursor:pointer;')}>Add a product</button>
          </div>
        )}
        <div style={css('display:flex;flex-direction:column;gap:16px;')}>
          {feed.map((p) => (
            <div key={p.id} style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;overflow:hidden;box-shadow:0 16px 40px -30px rgba(107,20,54,.55);')}>
              <div style={css('display:flex;align-items:center;gap:11px;padding:12px 14px;')}>
                <span style={css('width:40px;height:40px;flex:none;')}>
                  <BoutiqueLogo name={boutiqueName} src={boutique?.logo_url ?? undefined} size={40} />
                </span>
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('display:flex;align-items:center;gap:5px;')}>
                    <span style={css('font-weight:800;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{boutiqueName}</span>
                    {boutique?.verified && <span style={css("font-family:'Material Symbols Outlined';font-size:15px;color:var(--ag-info-text);")}>verified</span>}
                  </div>
                  <div style={css('font-size:11.5px;color:var(--ag-muted);font-weight:600;')}>{boutique?.area || boutique?.city || ''}</div>
                </div>
                <span style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;")}>more_horiz</span>
              </div>
              <div style={css(`position:relative;width:100%;aspect-ratio:4/5;background:${TONES[p.tone % TONES.length]};`)}>
                <ImageSlot src={imgOf(p)} placeholder={p.title} style={css('position:absolute;inset:0;')} />
              </div>
              <div style={css('padding:13px 16px 16px;')}>
                <div style={css('display:flex;align-items:center;gap:14px;color:var(--ag-ink-2);')}>
                  <span style={css("font-family:'Material Symbols Outlined';font-size:22px;")}>favorite_border</span>
                  <span style={css("font-family:'Material Symbols Outlined';font-size:22px;")}>chat_bubble_outline</span>
                  <span style={css("font-family:'Material Symbols Outlined';font-size:22px;")}>send</span>
                  <span style={css("font-family:'Material Symbols Outlined';font-size:22px;margin-left:auto;")}>bookmark_border</span>
                </div>
                <div style={css('font-weight:800;font-size:14.5px;margin-top:11px;')}>{p.title}</div>
                <div style={css('display:flex;align-items:center;gap:8px;margin-top:4px;')}>
                  <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:17px;color:var(--ag-crimson);")}>{fmt(Number(p.price))}</span>
                  {p.mrp && p.mrp > p.price && (
                    <>
                      <span style={css('font-size:13px;color:var(--ag-muted);text-decoration:line-through;')}>{fmt(Number(p.mrp))}</span>
                      <span style={css('font-size:11px;font-weight:800;color:var(--ag-bad-text);')}>{Math.round((1 - p.price / p.mrp) * 100)}% off</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
