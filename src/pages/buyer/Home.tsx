import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useTaxonomy } from '@/state/TaxonomyContext';
import { useLiveAds } from '@/hooks/useLiveAds';
import { SponsoredStrip } from '@/components/buyer/SponsoredStrip';
import { trackAdClick, trackAdImpression } from '@/data/ads';
import { useAsync } from '@/hooks/useAsync';
import { fetchTopReviews } from '@/data/reviews';

const reviewsF = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

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

  const heroCta = (h: { adId: string; target: 'product' | 'boutique'; productId: string | null; boutiqueId: string }) => {
    void trackAdClick(h.adId);
    if (h.target === 'boutique') navigate(`/boutique/${h.boutiqueId}`);
    else if (h.productId) navigate(`/products/${h.productId}`);
    else navigate(`/boutique/${h.boutiqueId}`);
  };

  // A collection circle lands on results already filtered. Which field it maps
  // to is read off the catalogue rather than hardcoded, so a tile like "Bridal"
  // (an occasion, not a category) still resolves — and anything the catalogue
  // doesn't know, like "More", just opens the full grid.
  const openCategory = (name: string) => {
    setQuery('');
    if (PRODUCTS.some((p) => p.cat === name)) setFilters({ ...DEFAULT_FILTERS, cats: [name] });
    else if (PRODUCTS.some((p) => p.occasion === name)) setFilters({ ...DEFAULT_FILTERS, occasions: [name] });
    else setFilters(DEFAULT_FILTERS);
    navigate('/shop');
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
          Same box, same gradient, no creative and no impression — see
          `heroPending` in useLiveAds for why the ad itself is never restored
          from storage. */}
      {heroPending && SLIDES.length === 0 && (
        <div aria-hidden="true" style={css('width:100vw;margin-left:calc(50% - 50vw);')}>
          <div style={css('height:clamp(340px,42vw,560px);background:linear-gradient(120deg,#8E1C44,#B02454 55%,#D6336C);')} />
        </div>
      )}

      {/* Hero carousel — paid home_hero ads only; hidden when none are live. */}
      {SLIDES.length > 0 && (
      <div style={css('width:100vw;margin-left:calc(50% - 50vw);')}>
        <div className="agx-zoom" style={css('position:relative;height:clamp(340px,42vw,560px);overflow:hidden;background:linear-gradient(120deg,#8E1C44,#B02454 55%,#D6336C);')}>
          <div style={css(`display:flex;height:100%;transition:transform .6s cubic-bezier(.4,0,.2,1);transform:translateX(-${heroIndex * 100}%);`)}>
            {SLIDES.map((h, i) => (
              // Off-screen slides are hidden from assistive tech: without this the
              // carousel would announce every slide at once, and the page would
              // report one <h1> per slide instead of the one heading it has.
              <div
                key={h.slotId}
                aria-hidden={i !== heroIndex}
                style={css('flex:0 0 100%;position:relative;height:100%;')}
              >
                <div style={css('position:absolute;inset:0;')}>
                  {/* The visible hero slide is the homepage's LCP element. */}
                  <ImageSlot
                    src={h.image}
                    placeholder="Drop a collection photo"
                    alt={h.pre ? `${h.pre} — MangaiMart` : 'Featured collection on MangaiMart'}
                    priority={i === 0}
                    width={1600}
                    height={900}
                    sizes="100vw"
                    style={css('position:absolute;inset:0;')}
                  />
                </div>
                <div style={css('position:absolute;inset:0;background:linear-gradient(100deg,rgba(45,8,24,.86) 0%,rgba(110,22,56,.5) 46%,rgba(110,22,56,.05) 100%);pointer-events:none;')} />
                <div style={css('position:absolute;inset:0;display:flex;align-items:center;pointer-events:none;')}>
                  <div style={css('max-width:1440px;width:100%;margin:0 auto;padding:0 clamp(20px,4vw,56px);color:#fff;')}>
                    <div style={css('max-width:560px;')}>
                      {/* The seller's editable eyebrow tag. */}
                      {h.eyebrow && (
                        <div style={css('display:inline-flex;align-items:center;gap:7px;background:rgba(201,154,63,.2);border:1px solid rgba(226,190,120,.5);color:#F4D9A6;padding:6px 13px;border-radius:999px;backdrop-filter:blur(4px);')}>
                          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;")}>auto_awesome</span>
                          <span className="agx-eyebrow" style={css('font-size:10px;')}>{h.eyebrow}</span>
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
                      <h2 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(38px,6vw,76px);line-height:.98;margin:16px 0 0;letter-spacing:-.02em;text-shadow:0 2px 30px rgba(45,8,24,.45);text-wrap:balance;")}>
                        {h.pre}<span style={css('font-style:italic;color:#F4D9A6;')}>{h.accent}</span>{h.post}
                      </h2>
                      <div style={css('font-size:clamp(14px,1.4vw,17px);opacity:.9;margin-top:14px;font-weight:500;max-width:420px;text-shadow:0 1px 8px rgba(45,8,24,.5);')}>{h.sub}</div>
                      <button onClick={() => heroCta(h)} style={css('pointer-events:auto;margin-top:24px;background:var(--ag-surface);color:var(--ag-crimson);border:none;border-radius:15px;padding:14px 26px;font-weight:800;font-size:15px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;box-shadow:0 16px 36px -14px rgba(0,0,0,.5);')}>
                        {h.cta}<span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>arrow_forward</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={css('position:absolute;left:0;right:0;bottom:22px;z-index:3;')}>
            <div style={css('max-width:1440px;margin:0 auto;padding:0 clamp(20px,4vw,56px);display:flex;gap:6px;')}>
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goHero(i)}
                  style={css(`width:${i === heroIndex ? '18px' : '5px'};height:6px;border-radius:3px;border:none;padding:0;cursor:pointer;background:${i === heroIndex ? '#F4D9A6' : 'rgba(255,255,255,.55)'};transition:width .3s ease;`)}
                />
              ))}
            </div>
          </div>
        </div>
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
        <a href="/collections" onClick={(e) => { e.preventDefault(); navigate('/collections'); }} className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-crimson);display:inline-flex;align-items:center;min-height:44px;padding:0 4px;')}>View all →</a>
      </div>
      <div className="agx-scroll" style={css('display:flex;gap:clamp(14px,2.4vw,30px);overflow-x:auto;padding:2px 0 8px;')}>
        {CIRCLES.map((c) => (
          <button
            key={c.name}
            onClick={() => openCategory(c.name)}
            className="agx-circle"
            style={css('flex:none;display:flex;flex-direction:column;align-items:center;gap:11px;padding:0;border:none;background:none;cursor:pointer;')}
          >
            {/* Gradient ring → page-coloured gap → photo, so the circle reads as
                a framed piece instead of a cropped thumbnail. */}
            <span className="agx-circle-ring" style={css('display:block;width:clamp(84px,11vw,116px);height:clamp(84px,11vw,116px);border-radius:50%;padding:3px;background:linear-gradient(140deg,#F0C7D8,#D6336C 48%,#8E1C44);box-shadow:0 16px 32px -20px rgba(107,20,54,.85);')}>
              <span style={css('display:block;width:100%;height:100%;border-radius:50%;padding:3px;background:var(--ag-bg);')}>
                <span style={css(`position:relative;display:block;width:100%;height:100%;border-radius:50%;overflow:hidden;background:${c.toneHex};`)}>
                  <ImageSlot src={c.image} placeholder={c.name} sizes="116px" style={css('position:absolute;inset:0;')} />
                  <span style={css('position:absolute;inset:0;border-radius:50%;background:linear-gradient(180deg,rgba(30,8,18,0) 55%,rgba(30,8,18,.42) 100%);')} />
                  <span aria-hidden="true" style={css("position:absolute;left:0;right:0;bottom:8px;text-align:center;font-family:'Material Symbols Outlined';font-size:17px;color:#F4D9A6;text-shadow:0 2px 8px rgba(0,0,0,.5);")}>{c.icon}</span>
                </span>
              </span>
            </span>
            <span style={css('font-size:13px;font-weight:800;color:var(--ag-ink-2);letter-spacing:-.005em;white-space:nowrap;')}>{c.name}</span>
          </button>
        ))}

        {/* The design's "More" circle, now with somewhere real to go: the rail
            shows six, the page shows every collection there is. */}
        <button
          onClick={() => navigate('/collections')}
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
        <a href="/top-boutiques" onClick={(e) => { e.preventDefault(); navigate('/top-boutiques'); }} className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-crimson);display:inline-flex;align-items:center;min-height:44px;padding:0 4px;')}>View all →</a>
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
