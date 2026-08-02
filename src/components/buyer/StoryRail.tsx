import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import { StoryViewer, type Story } from '@/components/buyer/StoryViewer';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';

/**
 * The story rail above the Inspire feed.
 *
 * Stories are assembled from the catalogue rather than a separate uploads
 * pipeline — each ring is a boutique, and its slides are that shop's most recent
 * pieces. The rail is the buyer's own follows and nothing else, so it stays a
 * feed of shops they chose. Until they follow anyone there is nothing to show,
 * so it falls back to the most-followed shops — an empty rail on a first visit
 * teaches the buyer nothing.
 *
 * The badges are all real signals, not decoration:
 *   NEW      — this shop is among the most recent to list something
 *   OFFERS   — it has at least one piece marked down from MRP
 *   TRENDING — it is one of the most-followed shops on the platform
 *
 * There is deliberately no LIVE badge. The app has no live video, and a ring
 * promising a live stream that doesn't exist is a lie to the buyer — the rest of
 * this rail is honest, so that one would stand out.
 */

const SLIDES_PER_STORY = 5;
const MAX_STORIES = 12;
/** How many of the newest listings count as "this shop just posted". */
const NEW_WINDOW = 12;

/**
 * The rail's own height, hard-coded so it can be reserved before the catalogue
 * arrives: a 70px ring plus its 2.5px+2.5px gradient border, the 8px gap and two
 * lines of 11px/1.2 label, over the 2px/10px padding below.
 */
const RAIL_HEIGHT = 122;

export function StoryRail() {
  const { follows } = useShop();
  const { products, boutiques, loading } = useCatalog();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const stories = useMemo<Story[]>(() => {
    if (boutiques.length === 0 || products.length === 0) return [];

    // `products` arrives newest-first from the catalogue, so position in this
    // list is a usable recency signal without another round trip.
    const freshShops = new Set(products.slice(0, NEW_WINDOW).map((p) => p.boutique));
    const trendingShops = new Set(
      [...boutiques].sort((a, b) => b.followers - a.followers).slice(0, 3).map((b) => b.id),
    );

    // Followed shops only — falling back to the most-followed shops for a buyer
    // who hasn't followed anyone yet.
    const followed = boutiques.filter((b) => follows[b.id]);
    const pool = followed.length > 0 ? followed : boutiques;

    const ordered = [...pool].sort(
      (a, b) => b.followers - a.followers || b.rating - a.rating,
    );

    return ordered
      .map<Story | null>((b) => {
        const shopProducts = products.filter((p) => p.boutique === b.name);
        const slides = shopProducts
          .slice(0, SLIDES_PER_STORY)
          .map((p) => ({
            image: p.image || p.images?.[0] || '',
            productId: p.id,
            title: p.title,
            price: p.price,
            mrp: p.mrp ?? null,
            tone: p.tone,
          }))
          .filter((s) => !!s.image);

        // A ring with nothing behind it is a dead tap.
        if (slides.length === 0) return null;

        const badge = freshShops.has(b.name)
          ? 'NEW'
          : shopProducts.some((p) => p.mrp && p.mrp > p.price)
            ? 'OFFERS'
            : trendingShops.has(b.id)
              ? 'TRENDING'
              : undefined;

        return {
          boutiqueId: b.id,
          name: b.name,
          logo: b.logo || b.image,
          verified: b.verified,
          city: b.city,
          followed: !!follows[b.id],
          badge,
          slides,
        };
      })
      .filter((s): s is Story => s !== null)
      .slice(0, MAX_STORIES);
  }, [products, boutiques, follows]);

  /*
   * Hold the rail's height while the catalogue is still loading.
   *
   * The rail is the first thing on Inspire, and it builds from the same
   * catalogue query the feed does — so it rendered as nothing, then as 122px of
   * rings, pushing the tabs and the whole feed down mid-read. Measured at 0.12
   * CLS, on the one screen people scroll without looking away.
   *
   * `loading` distinguishes "not yet" from "genuinely nothing to show": once the
   * catalogue has landed and produced no stories, the rail collapses as before
   * rather than leaving an empty band.
   */
  if (stories.length === 0) {
    return loading ? <div aria-hidden="true" style={css(`height:${RAIL_HEIGHT}px;`)} /> : null;
  }

  const badgeColor = (badge: Story['badge']) =>
    badge === 'NEW' ? '#D6336C' : badge === 'OFFERS' ? 'var(--ag-bad-text)' : '#B0863B';

  return (
    <>
      <div className="agx-scroll" style={css('display:flex;gap:14px;overflow-x:auto;padding:2px 2px 10px;')}>
        {stories.map((s, i) => (
          <button
            key={s.boutiqueId}
            onClick={() => setOpenIndex(i)}
            aria-label={`View ${s.name}'s latest`}
            style={css('flex:none;width:74px;display:flex;flex-direction:column;align-items:center;gap:8px;border:none;background:none;padding:0;cursor:pointer;')}
          >
            <span style={css('position:relative;display:block;')}>
              {/* Gradient ring → page-coloured gap → logo, so it reads as a story
                  ring rather than a plain avatar. */}
              <span style={css('display:block;width:70px;height:70px;border-radius:50%;padding:2.5px;background:linear-gradient(140deg,#F0C7D8,#D6336C 48%,#8E1C44);')}>
                <span style={css('display:block;width:100%;height:100%;border-radius:50%;padding:2.5px;background:var(--ag-bg);')}>
                  <BoutiqueLogo name={s.name} src={s.logo} size={60} />
                </span>
              </span>
              {s.badge && (
                <span
                  style={css(
                    `position:absolute;left:50%;bottom:-4px;transform:translateX(-50%);background:${badgeColor(s.badge)};color:#fff;` +
                      "font-family:'IBM Plex Mono',monospace;font-size:7.5px;font-weight:600;letter-spacing:.1em;" +
                      'padding:3px 7px;border-radius:999px;border:1.5px solid var(--ag-bg);white-space:nowrap;',
                  )}
                >
                  {s.badge}
                </span>
              )}
            </span>
            <span style={css('font-size:11px;font-weight:700;color:var(--ag-ink-2);line-height:1.2;text-align:center;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;')}>
              {s.name}
            </span>
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <StoryViewer
          stories={stories}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  );
}
