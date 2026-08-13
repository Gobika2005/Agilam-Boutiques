import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { cityKey } from '@/lib/cities';
import { clampDescription, routes } from '@/lib/seo';
import { boutiqueSchema, breadcrumbSchema, graph, organizationSchema } from '@/lib/schema';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { shareBoutique } from '@/lib/share';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import { BoutiqueReviews } from '@/components/buyer/BoutiqueReviews';
import { WishButton } from '@/components/buyer/WishButton';
import { CardLink } from '@/components/buyer/CardLink';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { subscribeToBoutiqueFollowers } from '@/data/boutiques';
import { TONES, fmt } from '@/data/demo';

/**
 * Buyer-facing boutique profile — premium layout from design mock "09".
 *
 * Full-bleed cover, an overlapping monogram avatar and a centred identity block
 * (name · rating · location), followed by tag pills, a description, a
 * three-up stats row (followers · products · positive rating), Follow / Chat
 * actions, a quick-action bar (shop location · share) and the boutique's
 * collection grid.
 *
 * It reads live data from `useCatalog()` (approved boutiques + their products
 * are public, so this works for anonymous buyers) and wires every control to a
 * real flow: back, wishlist, cart, follow (persisted to the buyer's account
 * when signed in, or local storage as a guest — via the shop context), chat,
 * call, share and product nav.
 */

/** Compact count: 1240 → "1.2K", 999 → "999". */
function compact(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + 'K';
}

export function BoutiqueProfile() {
  const navigate = useNavigate();
  /**
   * One route, `/boutique/:slug`, which accepts either the boutique's real slug
   * (migration 0003) or its id. Both `/b/:slug` and `/buyer/boutique/:id` 301
   * here, and the effect below settles the address bar on the slug so a shop
   * has exactly one canonical URL rather than three.
   */
  const { slug } = useParams();
  const { showToast, follows, toggleFollow: toggleFollowAccount, wishlist, toggleWish } = useShop();
  const { products: PRODUCTS, boutiques: BOUTIQUES, loading } = useCatalog();
  const [bqFilter, setBqFilter] = useState('All');
  const [liveFollowers, setLiveFollowers] = useState(0);

  // The slug is preferred; the id is accepted so legacy links keep working.
  const ab = BOUTIQUES.find((b) => b.slug === slug || b.id === slug);

  /**
   * A boutique link shared to WhatsApp or an Instagram bio should preview the
   * shop, not the app's name — and a boutique is a real shop in a real Tamil
   * Nadu town, so it is marked up as a `ClothingStore`. That is what makes
   * "boutiques in Coimbatore" a query this page can answer, and it is the one
   * piece of local SEO the data model always supported and never emitted.
   */
  const shopProductCount = ab ? PRODUCTS.filter((p) => p.boutique === ab.name).length : 0;
  usePageMeta({
    title: ab ? `${ab.name} — Boutique in ${ab.city}` : null,
    description: ab
      ? clampDescription(
          ab.desc?.trim() ||
            `Shop ${ab.name}, a verified boutique in ${ab.city}. ${shopProductCount} ${shopProductCount === 1 ? 'piece' : 'pieces'} listed, direct chat with the owner, delivery across India.`,
        )
      : null,
    image: ab?.logo ?? ab?.image ?? null,
    canonical: ab ? routes.boutique(ab) : null,
    type: 'profile',
    schema: ab
      ? graph(
          organizationSchema(),
          boutiqueSchema(ab, shopProductCount),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Boutiques', path: routes.boutiques() },
            { name: ab.name, path: routes.boutique(ab) },
          ]),
        )
      : null,
  });

  /** Settle on the slug URL — one shop, one address. */
  useEffect(() => {
    if (!ab) return;
    const canonical = routes.boutique(ab);
    if (`/boutique/${slug}` !== canonical) navigate(canonical, { replace: true });
  }, [ab, slug, navigate]);

  // Follow state comes straight from the shared context (account- or
  // device-backed), so it stays in sync with the boutique directory.
  const following = ab ? !!follows[ab.id] : false;

  // Seed the baseline count once the boutique resolves (the slug route has no
  // id until the catalogue loads).
  useEffect(() => {
    if (!ab) return;
    setLiveFollowers(ab.followers);
  }, [ab?.id, ab?.followers]);

  // Live follower count — updates in real time as any account follows/unfollows
  // (the DB trigger keeps boutiques.followers_count accurate).
  useEffect(() => {
    if (!ab) return;
    return subscribeToBoutiqueFollowers(ab.id, setLiveFollowers);
  }, [ab?.id]);

  const toggleFollow = useCallback(() => {
    if (!ab) return;
    // Persist through the context (account when signed in, else local) and nudge
    // the count optimistically; the realtime subscription reconciles it to the
    // authoritative total the trigger writes.
    const next = toggleFollowAccount(ab.id);
    setLiveFollowers((c) => Math.max(0, c + (next ? 1 : -1)));
    showToast(next ? `Following ${ab.name}` : `Unfollowed ${ab.name}`);
  }, [ab, toggleFollowAccount, showToast]);

  const bqCats = useMemo(
    () => (ab ? ['All', ...Array.from(new Set(PRODUCTS.filter((p) => p.boutique === ab.name).map((p) => p.cat)))] : ['All']),
    [PRODUCTS, ab],
  );
  const boutiqueProducts = useMemo(
    () => (ab ? PRODUCTS.filter((p) => p.boutique === ab.name && (bqFilter === 'All' || p.cat === bqFilter)) : []),
    [PRODUCTS, ab, bqFilter],
  );

  /**
   * Other shops to look at — the rail that stops this page being a dead end.
   *
   * Same city first, because that is what a buyer means by "who else is near
   * me", and it is the strongest reason to pick a second shop (one delivery
   * area, one set of terms). If the city has nobody else, it widens to the
   * marketplace rather than showing nothing: a shop with no neighbours is
   * common on a young marketplace and is not a reason to strand the reader.
   *
   * Only shops with something listed — an empty boutique is not a
   * recommendation — and best-rated first.
   */
  const { nearby, nearbyInCity } = useMemo(() => {
    if (!ab) return { nearby: [], nearbyInCity: false };
    const others = BOUTIQUES.filter((b) => b.id !== ab.id && b.products > 0);
    const sameCity = others.filter((b) => cityKey(b.city) === cityKey(ab.city));
    const pool = sameCity.length > 0 ? sameCity : others;
    return {
      nearby: [...pool].sort((a, b) => b.rating - a.rating || b.products - a.products).slice(0, 10),
      nearbyInCity: sameCity.length > 0,
    };
  }, [BOUTIQUES, ab]);

  if (!ab) {
    return (
      <div style={css('min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:var(--ag-muted);')}>
        {loading ? (
          <>
            <span className="agx-shimmer" style={css('width:56px;height:56px;border-radius:50%;')} />
            <span style={css('font-size:14px;')}>Loading boutique…</span>
          </>
        ) : (
          <>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:44px;color:var(--ag-border);")}>storefront</span>
            <span style={css('font-size:15px;')}>Boutique not found.</span>
            <button onClick={() => navigate('/boutiques')} style={css('margin-top:4px;background:#B02454;color:#fff;border:none;border-radius:12px;padding:10px 20px;font-weight:700;cursor:pointer;')}>
              Browse boutiques
            </button>
          </>
        )}
      </div>
    );
  }

  const followerLabel = compact(liveFollowers);
  const shareLink = `${window.location.origin}/b/${ab.slug}`;

  /**
   * Straight to the device's own share sheet — no intermediate popup.
   *
   * There used to be a branded in-app sheet in between (a preview card, the
   * link, and a row of WhatsApp/Instagram/Facebook/X buttons), so sharing took
   * two steps and the second one was the real share sheet anyway. The logo and
   * caption now travel with the share itself, which is what that preview was
   * standing in for.
   */
  const onShare = async () => {
    const result = await shareBoutique({
      name: ab.name,
      url: shareLink,
      logo: ab.logo,
      cover: ab.image,
      city: ab.area && ab.area !== ab.city ? `${ab.area}, ${ab.city}` : ab.city,
      desc: ab.desc,
    });
    if (result === 'copied') showToast('Boutique details copied — paste to share');
    else if (result === 'failed') showToast("Couldn't share this boutique", 'error');
  };

  // Quick-action destinations. The location opens the seller's Google Maps
  // link, or a maps search on the shop's address when they haven't added one.
  const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
  const mapUrl =
    ab.mapUrl?.trim() ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([ab.name, ab.area, ab.city].filter(Boolean).join(', '))}`;

  return (
    <div style={css('width:100vw;margin-left:calc(50% - 50vw);min-height:100%;background:var(--ag-bg);padding-bottom:40px;')}>
      {/* ---------- Cover ---------- */}
      <div className="agx-zoom" style={css(`position:relative;height:clamp(210px,36vw,360px);background:${TONES[ab.tone]};overflow:hidden;`)}>
        {/* Full-bleed cover — it spans the viewport at every width. */}
        <ImageSlot src={ab.image} placeholder={ab.name} fallback="brand" sizes="100vw" detail style={css('position:absolute;inset:0;')} />
        <div style={css('position:absolute;inset:0;background:linear-gradient(180deg,rgba(30,8,18,.3) 0%,rgba(30,8,18,0) 30%,rgba(30,8,18,0) 62%,var(--ag-cover-fade) 100%);pointer-events:none;')} />

        <button
          onClick={() => navigate('/boutiques')}
          aria-label="Back to boutiques"
          style={css('position:absolute;left:clamp(14px,3vw,28px);top:16px;width:42px;height:42px;border-radius:14px;border:none;background:rgba(255,255,255,.92);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 26px -12px rgba(0,0,0,.5);')}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
        </button>
      </div>

      {/* ---------- Identity (flush white panel, no card) ---------- */}
      <div
        className="agx-reveal"
        style={css('position:relative;margin-top:-26px;background:var(--ag-surface);border-radius:30px 30px 0 0;padding:64px clamp(18px,4vw,28px) 30px;')}
      >
        <div style={css('max-width:560px;margin:0 auto;')}>
          {/* Shop logo, overlapping the panel's top edge — the boutique's own
              branding is the first thing on its profile. Falls back to a
              monogram on the brand gradient when no logo has been uploaded. */}
          <div style={css('position:absolute;top:-50px;left:50%;transform:translateX(-50%);')}>
            <BoutiqueLogo name={ab.name} src={ab.logo} size={100} ring={4} />
          </div>

          {/* Name + verified */}
          <div style={css('display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;text-align:center;')}>
            <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(24px,3.4vw,34px);line-height:1.1;letter-spacing:-.01em;margin:0;")}>{ab.name}</h1>
            {ab.verified && (
              <span aria-hidden="true" title="Verified boutique" style={css("font-family:'Material Symbols Outlined';font-size:22px;color:#3A9BE0;")}>verified</span>
            )}
          </div>

          {/* Rating */}
          <div style={css('display:flex;align-items:center;justify-content:center;gap:6px;margin-top:9px;font-size:15px;font-weight:700;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;color:var(--ag-star);")}>star</span>
            {ab.rating}
            <span style={css('color:var(--ag-muted);font-weight:600;')}>({compact(ab.reviews)} Reviews)</span>
          </div>

          {/* Location */}
          <div style={css('display:flex;align-items:center;justify-content:center;gap:5px;margin-top:8px;color:var(--ag-muted);font-size:14px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;color:var(--ag-crimson);")}>location_on</span>
            {ab.area && ab.area !== ab.city ? `${ab.area}, ${ab.city}` : ab.city}
          </div>

          {/* Tag pills */}
          <div style={css('display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:14px;')}>
            <span style={css('background:var(--ag-surface-2);color:var(--ag-crimson);font-size:12px;font-weight:800;padding:6px 14px;border-radius:999px;')}>
              Boutique
            </span>
            {ab.since && (
              <span style={css('background:var(--ag-purple-bg);color:#7A4FB0;font-size:12px;font-weight:800;padding:6px 14px;border-radius:999px;')}>
                Since {ab.since}
              </span>
            )}
          </div>

          {/* Description */}
          <p style={css("text-align:center;color:var(--ag-ink-2);font-size:clamp(14px,1.3vw,16px);line-height:1.6;margin:16px auto 0;max-width:420px;font-family:'Playfair Display',serif;font-style:italic;")}>
            {ab.desc}
          </p>

          {/* Stats */}
          <div style={css('display:flex;align-items:stretch;margin-top:22px;padding-top:22px;border-top:1px solid var(--ag-border-soft);')}>
            {[
              { value: followerLabel, label: 'Followers' },
              { value: `${ab.products}+`, label: 'Products' },
              { value: `${ab.positiveRating}%`, label: 'Positive Rating' },
            ].map((s, i) => (
              <div key={s.label} style={css(`flex:1;text-align:center;${i > 0 ? 'border-left:1px solid var(--ag-border-soft);' : ''}`)}>
                <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(20px,2.6vw,26px);color:var(--ag-ink);line-height:1;")}>{s.value}</div>
                <div style={css('font-size:12px;color:var(--ag-muted);margin-top:6px;font-weight:600;')}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Follow / Chat */}
          <div style={css('display:flex;gap:12px;margin-top:22px;')}>
            <button
              onClick={toggleFollow}
              aria-pressed={following}
              style={css(
                following
                  ? 'flex:1;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--ag-surface);color:var(--ag-crimson);border:1.5px solid #B02454;border-radius:16px;padding:14px;font-weight:800;font-size:15px;cursor:pointer;'
                  : 'flex:1;display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;border:none;border-radius:16px;padding:14px;font-weight:800;font-size:15px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.9);',
              )}
            >
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>{following ? 'check' : 'add'}</span>
              {following ? 'Following' : 'Follow'}
            </button>
            <button
              onClick={() => navigate(`/chat/${ab.id}`)}
              aria-label={`Chat with ${ab.name}`}
              style={css('flex:1;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--ag-surface);color:var(--ag-crimson);border:1.5px solid var(--ag-border);border-radius:16px;padding:14px;font-weight:800;font-size:15px;cursor:pointer;')}
            >
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>chat</span>
              Chat
            </button>
          </div>

          {/* Quick actions */}
          <div style={css('display:flex;margin-top:18px;padding-top:18px;border-top:1px solid var(--ag-border-soft);')}>
            {[
              { icon: 'location_on', label: 'Shop Location', onClick: () => openExternal(mapUrl) },
              { icon: 'share', label: 'Share', onClick: onShare },
            ].map((a) => (
              <button
                key={a.label}
                onClick={a.onClick}
                aria-label={a.label}
                style={css('flex:1;display:flex;flex-direction:column;align-items:center;gap:7px;background:none;border:none;cursor:pointer;padding:4px;')}
              >
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:22px;color:var(--ag-crimson);")}>{a.icon}</span>
                <span style={css('font-size:11.5px;color:var(--ag-label);font-weight:700;')}>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- Collections ---------- */}
      <div style={css('max-width:900px;margin:0 auto;padding:0 clamp(14px,4vw,28px);')}>
        <div style={css('display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:32px;')}>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(21px,2.6vw,28px);line-height:1.1;")}>
            Collections
            <span style={css("font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:500;color:var(--ag-muted);letter-spacing:0;margin-left:8px;")}>· {ab.products} styles</span>
          </div>
          {bqFilter !== 'All' && (
            <button onClick={() => setBqFilter('All')} style={css('border:none;background:none;color:var(--ag-crimson);font-weight:800;font-size:13.5px;cursor:pointer;white-space:nowrap;')}>
              View All
            </button>
          )}
        </div>

        {/* Category chips */}
        {bqCats.length > 2 && (
          <div className="agx-scroll" style={css('display:flex;gap:9px;overflow-x:auto;padding:16px 0 4px;')}>
            {bqCats.map((c) => {
              const on = bqFilter === c;
              return (
                <button
                  key={c}
                  onClick={() => setBqFilter(c)}
                  style={css(`flex:none;border:1.5px solid ${on ? 'var(--ag-crimson)' : 'var(--ag-border)'};background:${on ? 'var(--ag-crimson)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-label)'};border-radius:999px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;`)}
                >
                  {c}
                </button>
              );
            })}
          </div>
        )}

        {/* Product grid */}
        {boutiqueProducts.length > 0 ? (
          <div className="agx-rgrid" style={css('margin-top:18px;')}>
            {boutiqueProducts.map((p) => (
              <CardLink key={p.id} to={routes.product(p)} label={p.title} className="agx-lift agx-reveal">
                <div className="agx-prod-media agx-zoom" style={css(`background:${TONES[p.tone]};`)}>
                  <ImageSlot src={p.image} placeholder={p.title} className="agx-prod-fill" />
                  <WishButton
                    wished={!!wishlist[p.id]}
                    title={p.title}
                    onToggle={(e) => { e.stopPropagation(); toggleWish(p.id); }}
                    className="agx-card-wish"
                  />
                  {/* The rating used to sit here as a badge over the photo. It
                      now lives opposite the price in the caption, the way every
                      other grid in the app shows it — keeping both would print
                      the same number twice on one card. */}
                  {p.stock === 0 && (
                    <div style={css('position:absolute;inset:0;background:rgba(255,255,255,.55);display:flex;align-items:center;justify-content:center;')}>
                      <span style={css('background:#241019;color:#fff;font-size:11px;font-weight:800;padding:5px 12px;border-radius:999px;')}>Sold out</span>
                    </div>
                  )}
                </div>
                {/* Caption matches the Home rails and every other product grid:
                    left-aligned title, then price left / rating right on one
                    row. This page was the last surface still centring its
                    caption and boxing the price in a bordered chip, which made
                    a boutique's own shelf read as a different product card from
                    the one the buyer had just tapped on Home.
                    The boutique name is the one line deliberately NOT carried
                    over — on a boutique's own page it would repeat the shop
                    name under every single tile. */}
                <div style={css('padding:12px 2px 0;')}>
                  <div className="agx-card-title" style={css('font-size:14.5px;font-weight:700;')}>{p.title}</div>
                  <div style={css('display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;')}>
                    <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:19px;")}>{fmt(p.price)}</span>
                    {/* Guarded on `reviews`, as the old badge was: an unrated
                        piece would otherwise advertise "★ 0". */}
                    {p.reviews > 0 && (
                      <span style={css('display:flex;align-items:center;gap:3px;font-size:12px;font-weight:700;color:var(--ag-ink-2);')}>
                        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;color:var(--ag-star);")}>star</span>
                        {p.rating}
                      </span>
                    )}
                  </div>
                </div>
              </CardLink>
            ))}
          </div>
        ) : (
          <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:54px 24px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:40px;color:var(--ag-border);")}>checkroom</span>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;margin-top:12px;")}>Nothing here yet</div>
            <div style={css('color:var(--ag-muted);font-size:13.5px;margin-top:5px;')}>
              {bqFilter === 'All' ? 'This boutique hasn’t listed any styles yet.' : `No ${bqFilter.toLowerCase()} in this collection.`}
            </div>
            {bqFilter !== 'All' && (
              <button onClick={() => setBqFilter('All')} style={css('margin-top:14px;background:#B02454;color:#fff;border:none;border-radius:12px;padding:10px 20px;font-weight:700;cursor:pointer;')}>
                View all styles
              </button>
            )}
          </div>
        )}

        {/* ---------- Reviews ---------- */}
        <div style={css("display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:38px;")}>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(21px,2.6vw,28px);line-height:1.1;")}>
            What buyers say
          </div>
        </div>
        <BoutiqueReviews boutiqueId={ab.id} />

        {/* ---------- Other boutiques ---------- */}
        {nearby.length > 0 && (
          <>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(21px,2.6vw,28px);line-height:1.1;margin-top:38px;")}>
              {nearbyInCity ? `More boutiques in ${ab.city}` : 'More boutiques'}
            </div>
            <div className="agx-scroll" style={css('display:flex;gap:12px;overflow-x:auto;padding:16px 0 8px;')}>
              {nearby.map((b) => (
                <Link
                  key={b.id}
                  to={routes.boutique(b)}
                  className="agx-lift"
                  style={css('flex:none;width:150px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:9px;padding:16px 12px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;text-decoration:none;color:inherit;box-shadow:0 14px 32px -28px rgba(107,20,54,.6);')}
                >
                  <BoutiqueLogo name={b.name} src={b.logo} size={54} ring={2} />
                  <span style={css('font-weight:800;font-size:13.5px;line-height:1.25;color:var(--ag-ink);width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{b.name}</span>
                  <span style={css('display:flex;align-items:center;gap:4px;font-size:11.5px;color:var(--ag-muted);font-weight:700;')}>
                    {b.reviews > 0 && (
                      <>
                        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:13px;color:var(--ag-star);")}>star</span>
                        {b.rating} ·
                      </>
                    )}
                    {b.products} {b.products === 1 ? 'style' : 'styles'}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

    </div>
  );
}
