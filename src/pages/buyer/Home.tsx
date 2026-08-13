import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { graph, organizationSchema, websiteSchema } from '@/lib/schema';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { SiteFooter } from '@/components/buyer/SiteFooter';
import { WishButton } from '@/components/buyer/WishButton';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import { useShop, DEFAULT_FILTERS } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { TONES, fmt, img } from '@/data/demo';
import { newArrivals, bestSellers, bestSellingBoutiques } from '@/lib/ranking';
import { buildCollections } from '@/lib/collections';
import { shopPath } from '@/lib/searchParams';
import { sameTerm } from '@/lib/vocabulary';
import { useTaxonomy } from '@/state/TaxonomyContext';
import { useLiveAds } from '@/hooks/useLiveAds';
import { SponsoredStrip } from '@/components/buyer/SponsoredStrip';
import { trackAdClick, trackAdImpression } from '@/data/ads';
import { useAsync } from '@/hooks/useAsync';
import { fetchTopReviews } from '@/data/reviews';

const reviewsF = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

/**
 * The hero's shape, in one place because three things have to agree on it: the
 * live carousel, the placeholder that holds its space while the ads load, and
 * the copy's side padding (which has to clear the curve).
 *
 * The same generous radius on all four corners — it scales with the viewport so
 * the curve stays proportional rather than shrinking to a hairline on a wide
 * screen.
 *
 * The height is the number that matters on a phone. A floor of 300px against a
 * ~355px-wide card gave a nearly square slab that ate the fold; 236px keeps it
 * a banner — wider than it is tall at every width — which is why the type below
 * scales down with it rather than sitting at desktop size in a shorter box.
 */
const HERO_H = 'clamp(236px,42vw,470px)';
const HERO_R = 'clamp(26px,3.2vw,44px)';
/** The copy's inset from the card edge. Enough to clear the curve, no more —
 *  the corners are rounded, but the edge beside the text is straight, so a
 *  gutter sized to the radius only pushed the headline into the middle. */
const HERO_PAD = 'clamp(18px,3vw,40px)';

export function Home() {
  /**
   * The homepage carries the two site-wide entities — `Organization` and
   * `WebSite` — plus the `SearchAction` that can put a search box straight into
   * a Google result. They are emitted here rather than everywhere because this
   * is the URL Google treats as the site's root entity.
   */
  usePageMeta({
    title: 'Boutique Ethnic Wear Online — Sarees, Kurta Sets & More',
    description:
      'Shop verified independent boutiques across India in one place. Sarees, kurta sets, kurtis and lehengas from independent shops, with direct chat to the owner and delivery across India.',
    canonical: '/',
    schema: graph(organizationSchema(), websiteSchema()),
  });
  const navigate = useNavigate();
  const { wishlist, toggleWish, setFilters, setQuery } = useShop();
  const { products: PRODUCTS, boutiques: BOUTIQUES } = useCatalog();
  const { ads, heroPending } = useLiveAds();
  const { data: topReviews } = useAsync(() => fetchTopReviews(3), []);
  const REVIEWS = topReviews ?? [];

  // The hero carousel is now purely paid placements: only live `home_hero`
  // campaigns become slides, so there are no fabricated editorial banners. When
  // no ad is running the whole hero is hidden (see the render below).
  const SLIDES = useMemo(
    () =>
      ads.home_hero.map((ad) => ({
        slotId: `ad-${ad.id}`,
        // The seller's editable eyebrow tag; a "Sponsored" pill is shown too.
        eyebrow: ad.tag || '',
        pre: ad.headline || 'Featured',
        accent: '',
        post: '',
        sub: ad.subtext || '',
        cta: ad.cta_label || 'Shop now',
        image: ad.image_url || img('1602210901882-071c6b9e239d', 1600),
        adId: ad.id as string,
        // The hero links to a product or the boutique, depending on the ad.
        target: ad.subject_type === 'boutique' ? ('boutique' as const) : ('product' as const),
        productId: ad.product_id ?? null,
        boutiqueId: ad.boutique_id,
      })),
    [ads.home_hero],
  );

  // Each rail is the top of its own See-all page, computed by the same rules —
  // so the first six here are exactly the first six there. Ranking lives in
  // @/lib/ranking; nothing on this screen decides an order of its own.
  const NEW_ARRIVALS = newArrivals(PRODUCTS).slice(0, 6);
  const BEST_SELLERS = bestSellers(PRODUCTS).slice(0, 6);
  const TOP_BOUTIQUES = bestSellingBoutiques(BOUTIQUES).slice(0, 8);

  // The collection rail used to be six fixed circles from the design file, so a
  // category the admin approved was invisible here until someone edited the
  // code. It is now the busiest approved categories, drawn with the design's
  // art where the names still line up — and a "More" circle for the rest.
  // Memoised: the hero rotates every 4.2s, and this walks the whole catalogue.
  const vocab = useTaxonomy();
  const CIRCLES = useMemo(
    () => buildCollections(PRODUCTS, vocab).categories.slice(0, 6),
    [PRODUCTS, vocab],
  );
  const [heroIndex, setHeroIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // The rotation reads the live slide count off a ref so a sponsored slide
  // appearing after the ads load extends the loop without re-arming the timer.
  const countRef = useRef(SLIDES.length);
  countRef.current = SLIDES.length;

  useEffect(() => {
    timer.current = setInterval(() => setHeroIndex((i) => (i + 1) % Math.max(1, countRef.current)), 4200);
    return () => clearInterval(timer.current);
  }, []);

  // Keep the index in range if the slide count shrinks (an ad expired).
  useEffect(() => {
    setHeroIndex((i) => (i >= SLIDES.length ? 0 : i));
  }, [SLIDES.length]);

  // Count an impression whenever a sponsored slide becomes the active one.
  useEffect(() => {
    const s = SLIDES[heroIndex];
    if (s?.adId) void trackAdImpression(s.adId);
  }, [heroIndex, SLIDES]);

  // Picking a dot restarts the rotation, as in the design.
  const goHero = (i: number) => {
    setHeroIndex(i);
    clearInterval(timer.current);
    timer.current = setInterval(() => setHeroIndex((x) => (x + 1) % Math.max(1, countRef.current)), 4200);
  };

  /* ── Swipe ────────────────────────────────────────────────────────────────
     The hero looks like a carousel, so on a phone it gets swiped — and until
     now a swipe did nothing but open whichever ad happened to be showing,
     because the whole slide is a click target. Pointer events cover finger and
     mouse-drag alike; `touch-action:pan-y` on the track lets the page keep
     scrolling vertically while horizontal movement comes to us.

     A drag past the threshold moves one slide and restarts the rotation (same
     as tapping a dot). It also arms `swiped`, which the CTA checks — otherwise
     the click the browser fires at the end of every drag would open the ad the
     buyer was swiping away from. */
  const SWIPE_MIN_PX = 44;
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);

  const stepHero = (dir: 1 | -1) => {
    const n = Math.max(1, countRef.current);
    goHero((heroIndex + dir + n) % n);
  };

  const onHeroPointerDown = (e: ReactPointerEvent) => {
    // Ignore secondary buttons and multi-touch (a pinch-zoom is not a swipe).
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiped.current = false;
  };

  const onHeroPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || SLIDES.length < 2) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // Horizontal intent only: a diagonal flick while scrolling the page must
    // not steal a slide.
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return;
    swiped.current = true;
    stepHero(dx < 0 ? 1 : -1);
  };

  const heroCta = (h: { adId: string; target: 'product' | 'boutique'; productId: string | null; boutiqueId: string }) => {
    if (swiped.current) { swiped.current = false; return; }
    void trackAdClick(h.adId);
    if (h.target === 'boutique') navigate(`/boutique/${h.boutiqueId}`);
    else if (h.productId) navigate(`/products/${h.productId}`);
    else navigate(`/boutique/${h.boutiqueId}`);
  };

  /**
   * A collection circle opens the results grid, already filtered to it — the
   * same screen "View all" opens, with one filter on.
   *
   * Which field it maps to is read off the catalogue rather than hardcoded, so a
   * tile like "Bridal" (an occasion, not a category) still resolves.
   *
   * The matching is `sameTerm`, not `===`, and that is the whole point. The
   * circles are built by `buildCollections`, which counts a tile's pieces
   * case-insensitively — so "Kurta Set" from the admin's vocabulary appears the
   * moment a seller lists a "kurta set". This function compared exactly, found
   * nothing, and fell through to a branch that cleared the filters and opened
   * the grid: tapping one collection showed the buyer *every* collection. There
   * is no such branch now. A tile only exists when it has pieces behind it, and
   * if the catalogue somehow disagrees the grid filters to the category anyway
   * and says it is empty — which is at least true.
   *
   * The collection landing pages (`/collections/kurta-sets`) are still live and
   * still linked from the Collections hub, the sitemap and the edge's own
   * prerender of this rail — they are the site's search surface. This rail just
   * isn't the way buyers reach them.
   */
  const openCategory = (name: string) => {
    const isOccasion =
      !PRODUCTS.some((p) => sameTerm(p.cat, name)) && PRODUCTS.some((p) => sameTerm(p.occasion, name));
    const next = { ...DEFAULT_FILTERS, ...(isOccasion ? { occasions: [name] } : { cats: [name] }) };
    setQuery('');
    setFilters(next);
    // The filter goes in the URL, not just in context — see `shopPath`. Setting
    // the state as well is what stops a frame of unfiltered grid before the
    // page reads the address.
    navigate(shopPath({ filters: next }));
  };

  /**
   * The whole catalogue, with nothing left over from wherever the buyer has
   * been. Filters are global session state, so without the reset "View all"
   * would open the grid still narrowed to the collection they tapped a minute
   * ago — and it would be the one control on the page that doesn't do what it
   * says.
   */
  const openShopUnfiltered = () => {
    setQuery('');
    setFilters(DEFAULT_FILTERS);
    navigate(shopPath());
  };
  const openProduct = (id: string) => navigate(`/products/${id}`);
  const openBoutique = (id: string) => navigate(`/boutique/${id}`);

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);')}>
      {/*
        The homepage's <h1>.

        It used to render only when no paid hero was live, on the reasoning that
        the hero headline was the heading otherwise. But the hero is an *advert*
        — whichever boutique bought the slot that week — so on a good sales week
        the homepage's most important heading became a third party's slogan, and
        on a very good week the page had no <h1> at all. The heading is now
        constant and says what the site is; the hero sells alongside it rather
        than instead of it.

        Visually hidden because the design leads with imagery, not a headline.
      */}
      <h1 className="agx-sr-only">
        MangaiMart — boutique ethnic wear from across India
      </h1>
      {/* The hero's space, held open while we find out whether an ad is live.
          Same box, same shape, same gradient, no creative and no impression —
          see `heroPending` in useLiveAds for why the ad itself is never
          restored from storage. Every number here mirrors the live hero below;
          they have to move together or the page shifts when the ad lands. */}
      {heroPending && SLIDES.length === 0 && (
        <div aria-hidden="true" style={css(`height:${HERO_H};border-radius:${HERO_R};background:linear-gradient(120deg,#8E1C44,#B02454 55%,#D6336C);`)} />
      )}

      {/* Hero carousel — paid home_hero ads only; hidden when none are live.

          It is a contained card rather than a full-bleed band: the page's rose
          ground shows down both sides and all four corners carry a deep curve,
          which is what makes it read as a boutique placement instead of a web
          banner. */}
      {SLIDES.length > 0 && (
        <div
          className="agx-zoom"
          onPointerDown={onHeroPointerDown}
          onPointerUp={onHeroPointerUp}
          onPointerCancel={() => { drag.current = null; }}
          // A mouse drag across a photo would otherwise start a native image
          // drag, which cancels the pointer stream before we see the release.
          onDragStart={(e) => e.preventDefault()}
          style={css(`position:relative;height:${HERO_H};border-radius:${HERO_R};overflow:hidden;background:linear-gradient(120deg,#8E1C44,#B02454 55%,#D6336C);box-shadow:0 26px 54px -32px var(--ag-shadow),inset 0 0 0 1px rgba(226,190,120,.3);touch-action:pan-y;user-select:none;-webkit-user-select:none;`)}
        >
          <div style={css(`display:flex;height:100%;transition:transform .6s cubic-bezier(.4,0,.2,1);transform:translateX(-${heroIndex * 100}%);`)}>
            {SLIDES.map((h, i) => (
              // Off-screen slides are hidden from assistive tech: without this the
              // carousel would announce every slide at once, and the page would
              // report one <h1> per slide instead of the one heading it has.
              //
              // The whole slide is the click target, not just the pill. A
              // full-bleed photograph with a headline over it reads as one
              // banner, so tapping the picture — which is what most people tap —
              // did nothing, and the buyer had to find the small pill to reach
              // the boutique that paid for the slot. Only the on-screen slide
              // takes the click, or a stray tap could open the ad either side.
              //
              // No `role`/`tabIndex` here on purpose: the pill inside is already
              // a real, focusable, named button to the same destination, and
              // wrapping it in a second control would announce the placement
              // twice and put an unnamed stop in the tab order.
              <div
                key={h.slotId}
                aria-hidden={i !== heroIndex}
                onClick={i === heroIndex ? () => heroCta(h) : undefined}
                style={css(`flex:0 0 100%;position:relative;height:100%;${i === heroIndex ? 'cursor:pointer;' : ''}`)}
              >
                <div style={css('position:absolute;inset:0;')}>
                  {/* The visible hero slide is the homepage's LCP element.

                      `objectPosition` is what stops the crop eating heads on a
                      laptop. Sellers are asked for a 16:10 banner, but the slot
                      is close to 3:1 once the window is wide, so `cover` scales
                      the photo well past the box and a centred crop takes ~19%
                      off the top — which is exactly where the model's face is.
                      Biasing to 25% keeps the top of the frame and spends the
                      crop on the floor instead. It has no effect on a phone,
                      where the card is narrow enough that the photo is cropped
                      horizontally rather than vertically. */}
                  <ImageSlot
                    src={h.image}
                    placeholder="Drop a collection photo"
                    alt={h.pre ? `${h.pre} — MangaiMart` : 'Featured collection on MangaiMart'}
                    priority={i === 0}
                    width={1600}
                    height={900}
                    sizes="100vw"
                    objectPosition="center 25%"
                    style={css('position:absolute;inset:0;')}
                  />
                </div>
                {/* Two scrims, not one: a soft wash across the copy side keeps
                    the text legible on a pale creative, and a low vignette
                    keeps the dots off a bright hem. Both stop well short of the
                    trailing edge so the photograph is still the thing you see. */}
                <div style={css('position:absolute;inset:0;background:linear-gradient(100deg,rgba(38,6,20,.82) 0%,rgba(74,12,38,.44) 44%,rgba(74,12,38,.02) 82%);pointer-events:none;')} />
                <div style={css('position:absolute;inset:0;background:linear-gradient(0deg,rgba(38,6,20,.34) 0%,rgba(38,6,20,0) 26%);pointer-events:none;')} />
                <div style={css('position:absolute;inset:0;display:flex;align-items:center;pointer-events:none;')}>
                  <div style={css(`width:100%;padding:0 ${HERO_PAD};color:#fff;`)}>
                    <div style={css('max-width:560px;')}>
                      {/* The seller's editable eyebrow tag. */}
                      {h.eyebrow && (
                        <div style={css('display:inline-flex;align-items:center;gap:6px;background:rgba(201,154,63,.2);border:1px solid rgba(226,190,120,.5);color:#F4D9A6;padding:clamp(4px,.5vw,6px) clamp(10px,1.2vw,13px);border-radius:999px;backdrop-filter:blur(4px);')}>
                          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:clamp(13px,1.2vw,15px);")}>auto_awesome</span>
                          <span className="agx-eyebrow" style={css('font-size:clamp(8.5px,.85vw,10px);')}>{h.eyebrow}</span>
                        </div>
                      )}
                      {/*
                        The active slide used to be promoted to <h1>. That made
                        the homepage's primary heading whichever boutique had
                        bought the hero slot — and gave the page two <h1>s once
                        the constant one above was added. An advert's slogan is
                        an <h2> at most: the page still has exactly one <h1>,
                        which says what MangaiMart is.
                      */}
                      <h2 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(27px,4.6vw,60px);line-height:1.04;margin:clamp(9px,1.2vw,14px) 0 0;letter-spacing:-.02em;text-shadow:0 2px 30px rgba(45,8,24,.45);text-wrap:balance;")}>
                        {h.pre}<span style={css('font-style:italic;color:#F4D9A6;')}>{h.accent}</span>{h.post}
                      </h2>
                      <div style={css('font-size:clamp(12.5px,1.25vw,16px);line-height:1.4;opacity:.92;margin-top:clamp(7px,1vw,12px);font-weight:500;max-width:420px;text-shadow:0 1px 8px rgba(45,8,24,.5);')}>{h.sub}</div>
                      {/*
                        A full pill, not a rounded rectangle: it echoes the
                        curve of the card it sits in.

                        Deliberately literal colours, against the usual rule.
                        Everything inside the hero sits on a photograph under a
                        dark scrim in BOTH themes, so the theme tokens are the
                        wrong ground here: `--ag-surface` is white on light and
                        near-black on dark, which turned this button into dark
                        text on a dark pill over a dark photo. The hero's
                        interior is always "on dark" — it is the one surface in
                        the app that does not flip.
                      */}
                      {/* stopPropagation: the slide behind it now handles the
                          same click, and without this one tap would track two
                          clicks and navigate twice. */}
                      <button onClick={(e) => { e.stopPropagation(); heroCta(h); }} style={css('pointer-events:auto;margin-top:clamp(14px,2vw,22px);background:#FFFFFF;color:#A81F4E;border:none;border-radius:999px;padding:clamp(7px,.9vw,10px) clamp(8px,1vw,12px) clamp(7px,.9vw,10px) clamp(18px,2vw,26px);font-weight:800;font-size:clamp(13px,1.2vw,14.5px);cursor:pointer;display:inline-flex;align-items:center;gap:clamp(8px,1vw,12px);box-shadow:0 18px 38px -16px rgba(0,0,0,.65);')}>
                        {h.cta}
                        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:clamp(15px,1.4vw,17px);width:clamp(26px,2.6vw,30px);height:clamp(26px,2.6vw,30px);border-radius:999px;background:#FDE7EF;display:inline-flex;align-items:center;justify-content:center;flex:none;")}>arrow_forward</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* One live ad is the common case, and a carousel of one is just a
              stray dash in the corner — the dots only appear once there is
              somewhere to go. */}
          {SLIDES.length > 1 && (
          <div style={css('position:absolute;left:0;right:0;bottom:22px;z-index:3;')}>
            <div style={css(`padding:0 ${HERO_PAD};display:flex;gap:6px;`)}>
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goHero(i)}
                  // The dot has no text and no icon, so without these it reaches
                  // a screen reader as an unnamed "button" — Lighthouse's
                  // `button-name` failure on the home page.
                  type="button"
                  aria-label={`Show slide ${i + 1} of ${SLIDES.length}`}
                  aria-current={i === heroIndex}
                  style={css(`width:${i === heroIndex ? '18px' : '5px'};height:6px;border-radius:3px;border:none;padding:0;cursor:pointer;background:${i === heroIndex ? '#F4D9A6' : 'rgba(255,255,255,.55)'};transition:width .3s ease;`)}
                />
              ))}
            </div>
          </div>
          )}
        </div>
      )}

      {/* Sponsored — paid product placements, clearly labelled. Hidden when none. */}
      <SponsoredStrip ads={ads.sponsored_card} />

      {/* SHOP BY COLLECTION — the first thing under the hero: one tap from
          landing to a filtered edit, in a ringed circle rail that reads as
          jewellery rather than as a row of buttons. */}
      <div style={css('display:flex;align-items:flex-end;justify-content:space-between;margin:28px 0 16px;')}>
        <div>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Browse every edit</div>
          <h2 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(24px,2.6vw,34px);line-height:1.12;padding-bottom:2px;margin:6px 0 0;")}>Shop by collection</h2>
        </div>
        {/* "View all" is the whole catalogue, unfiltered — the opposite of a
            circle, which is one collection. It used to open the Collections
            hub, which meant neither control on this row actually showed the
            buyer the shop. The hub is still one tap away: it is what the "More"
            circle at the end of the rail opens. */}
        <a href="/shop" onClick={(e) => { e.preventDefault(); openShopUnfiltered(); }} className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-crimson);display:inline-flex;align-items:center;min-height:44px;padding:0 4px;')}>View all →</a>
      </div>
      <div className="agx-scroll" style={css('display:flex;gap:clamp(14px,2.4vw,30px);overflow-x:auto;padding:2px 0 8px;')}>
        {CIRCLES.map((c) => (
          <button
            key={c.name}
            onClick={() => openCategory(c.name)}
            aria-label={`${c.name} — ${c.count} ${c.count === 1 ? 'piece' : 'pieces'}`}
            className="agx-circle"
            style={css('flex:none;display:flex;flex-direction:column;align-items:center;gap:11px;padding:0;border:none;background:none;cursor:pointer;')}
          >
            {/* Gradient ring → page-coloured gap → photo, so the circle reads as
                a framed piece instead of a cropped thumbnail. */}
            <span className="agx-circle-ring" style={css('display:block;width:clamp(84px,11vw,116px);height:clamp(84px,11vw,116px);border-radius:50%;padding:3px;background:linear-gradient(140deg,#F0C7D8,#D6336C 48%,#8E1C44);box-shadow:0 16px 32px -20px rgba(107,20,54,.85);')}>
              <span style={css('display:block;width:100%;height:100%;border-radius:50%;padding:3px;background:var(--ag-bg);')}>
                <span style={css(`position:relative;display:block;width:100%;height:100%;border-radius:50%;overflow:hidden;background:${c.toneHex};`)}>
                  {/* Decorative: the category name is rendered as real text
                      directly below, so `ImageSlot`'s default of reusing
                      `placeholder` as the alt made a screen reader announce it
                      twice (Lighthouse `image-redundant-alt`). The placeholder
                      is still needed — it is the visible fallback when a
                      category has no photo. */}
                  <ImageSlot src={c.image} placeholder={c.name} alt="" sizes="116px" style={css('position:absolute;inset:0;')} />
                  <span style={css('position:absolute;inset:0;border-radius:50%;background:linear-gradient(180deg,rgba(30,8,18,0) 55%,rgba(30,8,18,.42) 100%);')} />
                  <span aria-hidden="true" style={css("position:absolute;left:0;right:0;bottom:8px;text-align:center;font-family:'Material Symbols Outlined';font-size:17px;color:#F4D9A6;text-shadow:0 2px 8px rgba(0,0,0,.5);")}>{c.icon}</span>
                </span>
              </span>
            </span>
            <span style={css('font-size:13px;font-weight:800;color:var(--ag-ink-2);letter-spacing:-.005em;white-space:nowrap;')}>{c.name}</span>
          </button>
        ))}

        {/* The design's "More" circle, and now the way to the Collections hub:
            the rail shows six categories, that page shows every category,
            occasion, fabric, colour and budget there is.

            "More" alone is a poor accessible name for the one link to it — and
            since "View all" now goes to the grid instead, this is the only one
            on the page. The label stays as drawn; the aria-label says where it
            actually goes. */}
        <button
          onClick={() => navigate('/collections')}
          aria-label="Shop by collection — every category, occasion, fabric, colour and budget"
          className="agx-circle"
          style={css('flex:none;display:flex;flex-direction:column;align-items:center;gap:11px;padding:0;border:none;background:none;cursor:pointer;')}
        >
          <span className="agx-circle-ring" style={css('display:block;width:clamp(84px,11vw,116px);height:clamp(84px,11vw,116px);border-radius:50%;padding:3px;background:linear-gradient(140deg,#F0C7D8,#D6336C 48%,#8E1C44);box-shadow:0 16px 32px -20px rgba(107,20,54,.85);')}>
            <span style={css('display:block;width:100%;height:100%;border-radius:50%;padding:3px;background:var(--ag-bg);')}>
              <span style={css('display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:linear-gradient(140deg,var(--ag-surface-2),var(--ag-surface-3));')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:30px;color:var(--ag-crimson);")}>grid_view</span>
              </span>
            </span>
          </span>
          <span style={css('font-size:13px;font-weight:800;color:var(--ag-ink-2);letter-spacing:-.005em;white-space:nowrap;')}>More</span>
        </button>
      </div>

      {/* NEW ARRIVALS */}
      <div style={css('display:flex;align-items:flex-end;justify-content:space-between;margin:38px 0 16px;')}>
        <div>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Fresh off the loom</div>
          <h2 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(24px,2.6vw,34px);line-height:1.12;padding-bottom:2px;margin:6px 0 0;")}>New arrivals</h2>
        </div>
        <a href="/new-arrivals" onClick={(e) => { e.preventDefault(); navigate('/new-arrivals'); }} className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-crimson);display:inline-flex;align-items:center;min-height:44px;padding:0 4px;')}>See all →</a>
      </div>
      <div className="agx-scroll" style={css('display:flex;gap:18px;overflow-x:auto;padding-bottom:6px;')}>
        {NEW_ARRIVALS.map((p) => (
          <div key={p.id} onClick={() => openProduct(p.id)} className="agx-lift" style={css('flex:none;width:230px;cursor:pointer;')}>
            <div className="agx-prod-media agx-zoom" style={css(`background:${TONES[p.tone]};`)}>
              <ImageSlot src={p.image} placeholder={p.title} className="agx-prod-fill" sizes="230px" />
              <div style={css('position:absolute;left:10px;top:10px;display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.94);color:var(--ag-crimson);padding:5px 10px;border-radius:999px;box-shadow:0 4px 12px rgba(0,0,0,.14);')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:13px;")}>fiber_new</span>
                <span className="agx-eyebrow" style={css('font-size:8.5px;letter-spacing:.14em;')}>New</span>
              </div>
              <WishButton
                wished={!!wishlist[p.id]}
                title={p.title}
                onToggle={(e) => { e.stopPropagation(); toggleWish(p.id); }}
                className="agx-card-wish"
              />
            </div>
            <div style={css('padding:12px 2px 0;')}>
              <div className="agx-card-title" style={css('font-size:14.5px;font-weight:700;')}>{p.title}</div>
              <div style={css('font-size:12.5px;color:var(--ag-muted);margin-top:2px;')}>{p.boutique}</div>
              <div style={css('display:flex;align-items:center;justify-content:space-between;margin-top:7px;')}>
                <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:19px;")}>{fmt(p.price)}</span>
                <span style={css('display:flex;align-items:center;gap:3px;font-size:12px;font-weight:700;color:var(--ag-ink-2);')}>
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;color:var(--ag-star);")}>star</span>{p.rating}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* BEST SELLERS */}
      <div style={css('display:flex;align-items:flex-end;justify-content:space-between;margin:40px 0 18px;')}>
        <div>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Most-loved right now</div>
          <h2 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(24px,2.6vw,34px);line-height:1.12;padding-bottom:2px;margin:6px 0 0;")}>Best sellers</h2>
        </div>
        <a href="/best-sellers" onClick={(e) => { e.preventDefault(); navigate('/best-sellers'); }} className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-crimson);display:inline-flex;align-items:center;min-height:44px;padding:0 4px;')}>See all →</a>
      </div>
      <div className="agx-rgrid">
        {BEST_SELLERS.map((p) => (
          <div key={p.id} onClick={() => openProduct(p.id)} className="agx-lift" style={css('cursor:pointer;')}>
            <div className="agx-prod-media agx-zoom" style={css(`background:${TONES[p.tone]};`)}>
              <ImageSlot src={p.image} placeholder={p.title} className="agx-prod-fill" />
              <WishButton
                wished={!!wishlist[p.id]}
                title={p.title}
                onToggle={(e) => { e.stopPropagation(); toggleWish(p.id); }}
                className="agx-card-wish"
              />
            </div>
            {/* Same footer shape as New arrivals: price on the left, rating
                opposite it on the right — so the two rails read as one style.
                The review count stays, since popularity is what makes it a
                best seller. */}
            <div style={css('padding:12px 2px 0;')}>
              <div className="agx-card-title" style={css('font-size:14.5px;font-weight:700;')}>{p.title}</div>
              <div style={css('display:flex;align-items:center;justify-content:space-between;margin-top:7px;')}>
                <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:19px;")}>{fmt(p.price)}</span>
                <span style={css('display:flex;align-items:center;gap:3px;font-size:12px;font-weight:700;color:var(--ag-ink-2);')}>
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;color:var(--ag-star);")}>star</span>{p.rating}
                  <span style={css('color:var(--ag-muted-soft);font-weight:600;')}>· {reviewsF(p.reviews)}</span>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* BEST-SELLING BOUTIQUES */}
      <div style={css('display:flex;align-items:flex-end;justify-content:space-between;margin:40px 0 16px;')}>
        <div>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Shops buyers love</div>
          <h2 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(24px,2.6vw,34px);line-height:1.12;padding-bottom:2px;margin:6px 0 0;")}>Best-selling boutiques</h2>
        </div>
        {/* "View all" is the full directory, not a longer version of this rail.
            It used to open /top-boutiques — the same eight shops in the same
            order, just taller — so a buyer who wanted to see who else is on the
            marketplace was given the identical answer twice. /boutiques is the
            page with search, city, sort and every approved shop.
            /top-boutiques is still live and still linked from the edge's hub
            nav and the sitemap. */}
        <a href="/boutiques" onClick={(e) => { e.preventDefault(); navigate('/boutiques'); }} className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-crimson);display:inline-flex;align-items:center;min-height:44px;padding:0 4px;')}>View all →</a>
      </div>
      <div className="agx-scroll" style={css('display:flex;gap:18px;overflow-x:auto;padding-bottom:6px;')}>
        {TOP_BOUTIQUES.map((b) => (
          <div key={b.id} onClick={() => openBoutique(b.id)} className="agx-lift" style={css('flex:none;width:300px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;overflow:hidden;cursor:pointer;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}>
            {/* Cover — image only, no name overlay */}
            <div className="agx-zoom" style={css(`position:relative;aspect-ratio:16/10;background:${TONES[b.tone]};overflow:hidden;`)}>
              <ImageSlot src={b.image} placeholder={`${b.name} — cover`} sizes="300px" style={css('position:absolute;inset:0;')} />
            </div>
            {/* Identity — logo + name shown separately below the cover */}
            <div style={css('padding:14px 16px 16px;')}>
              <div style={css('display:flex;align-items:center;gap:11px;')}>
                <BoutiqueLogo name={b.name} src={b.logo} size={44} />
                <div style={css('min-width:0;flex:1;')}>
                  <div style={css('display:flex;align-items:center;gap:5px;')}>
                    <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:17px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{b.name}</span>
                    {b.verified && <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;color:#3A9BE0;flex:none;")}>verified</span>}
                  </div>
                  <div style={css('color:var(--ag-muted);font-size:12px;display:flex;align-items:center;gap:3px;margin-top:2px;')}>
                    <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:14px;")}>location_on</span>{b.city}
                  </div>
                </div>
              </div>
              <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:13px;padding-top:12px;border-top:1px solid var(--ag-border-soft);')}>
                <div style={css("font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ag-muted-soft);letter-spacing:.04em;")}>{b.products} styles</div>
                <div style={css('display:flex;align-items:center;gap:4px;font-size:13px;font-weight:700;background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:10px;padding:5px 10px;white-space:nowrap;')}>
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;color:var(--ag-star);")}>star</span>{b.rating} <span style={css('color:var(--ag-muted-soft);font-weight:600;')}>· {b.reviews}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* CUSTOMER REVIEWS (full-bleed)
          Real reviews pulled from the `reviews` table (highest-rated, with
          written feedback), not invented testimonials — so the section quietly
          disappears rather than lying when the catalogue has none yet. Each
          card is a proper pull-quote: the mark, the words, then the person —
          equal height whatever the quote length. */}
      {REVIEWS.length > 0 && (
      <div style={css('width:100vw;margin-left:calc(50% - 50vw);background:linear-gradient(180deg,var(--ag-bg) 0%,var(--ag-surface-2) 100%);margin-top:44px;border-top:1px solid var(--ag-surface-3);')}>
        <div style={css('max-width:1180px;margin:0 auto;padding:clamp(36px,4.5vw,64px) clamp(20px,4vw,56px);')}>
          <div style={css('text-align:center;max-width:600px;margin:0 auto;')}>
            <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Loved across India</div>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(26px,3vw,40px);line-height:1.08;margin-top:8px;text-wrap:balance;")}>
              What shoppers say about {' '}<span style={css('font-style:italic;color:var(--ag-crimson);')}>MangaiMart</span>
            </div>
            <div style={css('color:var(--ag-muted);font-size:14px;margin-top:10px;line-height:1.6;')}>
              Real reviews from buyers who found their piece through a local boutique.
            </div>
          </div>

          <div className="agx-testimonials" style={css('margin-top:clamp(24px,3vw,38px);')}>
            {REVIEWS.map((r) => {
              const name = r.author_name?.trim() || 'MangaiMart buyer';
              const tone = TONES[Math.abs(name.charCodeAt(0)) % TONES.length];
              return (
                <figure
                  key={r.id}
                  style={css('margin:0;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;padding:clamp(22px,2.4vw,28px);box-shadow:0 18px 44px -34px rgba(107,20,54,.5);display:flex;flex-direction:column;height:100%;')}
                >
                  {/* Opening mark — anchors the quote without shouting. */}
                  <span style={css("font-family:'Playfair Display',serif;font-size:52px;line-height:.6;color:var(--ag-border);height:26px;")}>“</span>

                  <blockquote style={css('margin:14px 0 0;font-size:15px;line-height:1.65;color:var(--ag-ink-2);text-wrap:pretty;flex:1;')}>
                    {r.body}
                  </blockquote>

                  {/* Stars as glyphs rather than characters, so the row lines up. */}
                  {/* role="img" so the label is actually announced — ARIA
                      ignores aria-label on a generic <div>, so the rating was
                      read as five repetitions of the word "star". */}
                  <div role="img" style={css('display:flex;align-items:center;gap:2px;margin-top:18px;')} aria-label={`${r.rating} out of 5 stars`}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <span
                        key={i}
                        aria-hidden="true"
                        className={i <= r.rating ? 'agx-heart agx-heart-on' : 'agx-heart'}
                        style={css(`font-size:17px;color:${i <= r.rating ? 'var(--ag-star)' : '#E8D7DF'};`)}
                      >
                        star
                      </span>
                    ))}
                  </div>

                  <figcaption style={css('display:flex;align-items:center;gap:12px;margin-top:16px;padding-top:16px;border-top:1px solid var(--ag-surface-2);')}>
                    <span style={css(`width:44px;height:44px;flex:none;border-radius:50%;background:${tone};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:19px;color:#5C1E38;`)}>
                      {name[0].toUpperCase()}
                    </span>
                    <span style={css('min-width:0;')}>
                      <span style={css('display:block;font-size:14.5px;font-weight:800;color:var(--ag-ink);')}>{name}</span>
                      {(r.product_title || r.boutique_name) && (
                        <span style={css('display:block;font-size:12.5px;color:var(--ag-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>
                          {r.product_title}{r.product_title && r.boutique_name ? ' · ' : ''}{r.boutique_name}
                        </span>
                      )}
                    </span>
                    {r.verified_purchase && (
                      <span style={css('margin-left:auto;display:flex;align-items:center;gap:4px;flex:none;font-size:11px;font-weight:800;color:var(--ag-good);background:var(--ag-good-bg);border-radius:999px;padding:5px 10px;')} title="Verified purchase">
                        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:14px;")}>verified</span>Verified
                      </span>
                    )}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      </div>
      )}

      <SiteFooter />
    </div>
  );
}
