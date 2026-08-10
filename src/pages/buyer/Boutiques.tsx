import { Fragment, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { routes, slugify } from '@/lib/seo';
import { boutiqueListSchema, breadcrumbSchema, graph, organizationSchema } from '@/lib/schema';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { CatalogError } from '@/components/buyer/CatalogError';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import { AdImpression } from '@/components/buyer/AdImpression';
import { PromotedBadge } from '@/components/buyer/PromotedBadge';
import { useLiveAds } from '@/hooks/useLiveAds';
import { trackAdClick } from '@/data/ads';

/** Compact review counts the way the design shows them: 2100 → "2.1k". */
function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

type SortKey = 'rating' | 'reviews' | 'products' | 'name';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'rating', label: 'Top rated' },
  { key: 'reviews', label: 'Most reviewed' },
  { key: 'products', label: 'Most styles' },
  { key: 'name', label: 'A – Z' },
];

export function Boutiques() {
  // Follows are shared through the shop context: persisted to the buyer's
  // account when signed in, or to local storage as a guest — always in sync
  // with the boutique profile page.
  const { showToast, follows: following, toggleFollow: toggleFollowAccount } = useShop();
  const { boutiques: BOUTIQUES, error: catalogError, reload } = useCatalog();

  /*
   * The city filter is the URL, not component state.
   *
   * This screen serves both `/boutiques` and `/boutiques/:citySlug`. Making the
   * route the single source of truth is what gives every city a page that can be
   * linked, shared, sitemapped and ranked for "boutiques in <city>" — as state
   * it was one national URL with a chip nobody outside the session could reach.
   */
  const { citySlug } = useParams<{ citySlug?: string }>();
  const navigate = useNavigate();

  const cities = useMemo(
    () => Array.from(new Set(BOUTIQUES.map((b) => b.city))).sort(),
    [BOUTIQUES],
  );

  const city = useMemo(
    () => (citySlug ? cities.find((c) => slugify(c) === citySlug) ?? null : null),
    [cities, citySlug],
  );

  /** Selecting a city navigates; `null` returns to the national directory. */
  const selectCity = (next: string | null) =>
    navigate(next ? routes.city(next) : routes.boutiques());

  // The catalogue arrives asynchronously, so on a cold load of a city URL the
  // city is briefly unresolved. Passing `null` leaves the head exactly as the
  // edge middleware wrote it rather than flashing the national copy over it.
  const cityPending = !!citySlug && !city && BOUTIQUES.length === 0;

  usePageMeta({
    title: cityPending
      ? null
      : city
        ? `Boutiques in ${city} — Verified Ethnic Wear Shops`
        : 'Boutiques in India — Verified Ethnic Wear Shops',
    description: cityPending
      ? null
      : city
        ? `Verified boutiques in ${city} listing sarees, kurta sets and ethnic wear on MangaiMart. Chat directly with the shop and get delivery across India.`
        : 'Browse every verified boutique on MangaiMart by city, rating and speciality. Independent shops across India, each checked before it can list.',
    canonical: city ? routes.city(city) : routes.boutiques(),
    schema: graph(
      organizationSchema(),
      boutiqueListSchema({
        name: city ? `Boutiques in ${city}` : 'Boutiques on MangaiMart',
        description: city
          ? `Verified independent ethnic-wear boutiques in ${city}.`
          : 'Verified independent ethnic-wear boutiques across India.',
        path: city ? routes.city(city) : routes.boutiques(),
        boutiques: city ? BOUTIQUES.filter((b) => b.city === city) : BOUTIQUES,
      }),
      breadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Boutiques', path: routes.boutiques() },
        ...(city ? [{ name: city, path: routes.city(city) }] : []),
      ]),
    ),
  });
  const { ads } = useLiveAds();

  // Promoted boutiques (paid boutique_promo campaigns) are boosted to the top of
  // the list and tagged, whatever the current sort. One ad id per boutique is
  // kept for impression/click tracking.
  const adByBoutique = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of ads.boutique_promo) if (a.boutique_id && !m.has(a.boutique_id)) m.set(a.boutique_id, a.id);
    return m;
  }, [ads.boutique_promo]);

  const [query, setQuery] = useState('');

  // Browse mode + filter state
  const [followingOnly, setFollowingOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<SortKey>('rating');
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const followingCount = useMemo(
    () => BOUTIQUES.filter((b) => following[b.id]).length,
    [BOUTIQUES, following],
  );

  const activeFilters =
    (city ? 1 : 0) + (verifiedOnly ? 1 : 0) + (sort !== 'rating' ? 1 : 0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = BOUTIQUES.filter((b) => {
      if (followingOnly && !following[b.id]) return false;
      if (q && !b.name.toLowerCase().includes(q) && !b.city.toLowerCase().includes(q)) return false;
      if (city && b.city !== city) return false;
      if (verifiedOnly && !b.verified) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'reviews':
          return b.reviews - a.reviews;
        case 'products':
          return b.products - a.products;
        case 'name':
          return a.name.localeCompare(b.name);
        case 'rating':
        default:
          return b.rating - a.rating;
      }
    });
    return list;
  }, [BOUTIQUES, query, city, verifiedOnly, sort, followingOnly, following]);

  // Promoted boutiques bubble to the top while still respecting the active
  // filters/search (a promoted shop that doesn't match is not forced in).
  const display = useMemo(() => {
    if (adByBoutique.size === 0) return filtered;
    const promoted = filtered.filter((b) => adByBoutique.has(b.id));
    const rest = filtered.filter((b) => !adByBoutique.has(b.id));
    return [...promoted, ...rest];
  }, [filtered, adByBoutique]);

  function toggleFollow(e: MouseEvent, id: string, name: string) {
    e.stopPropagation();
    const next = toggleFollowAccount(id);
    showToast(next ? 'Following ' + name : 'Unfollowed ' + name);
  }

  function clearFilters() {
    setSort('rating');
    setVerifiedOnly(false);
    // The city lives in the URL now, so clearing it is a navigation back to the
    // national directory — and only when there is one to clear, or "Clear all"
    // on `/boutiques` would push a duplicate history entry.
    if (citySlug) selectCity(null);
  }

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      {/* Screen header */}
      <div style={css('padding:2px 0 4px;')}>
        <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>The directory</div>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(26px,3.2vw,40px);line-height:1.1;margin:6px 0 0;letter-spacing:-.01em;")}>Boutiques</h1>
      </div>

      {/* Search bar with a filter action on the right, per the design */}
      <div style={css('display:flex;align-items:center;gap:10px;background:var(--ag-surface);border:1px solid var(--ag-border-soft);border-radius:16px;padding:0 8px 0 14px;height:52px;box-shadow:0 10px 26px -18px rgba(107,20,54,.5);margin-top:16px;')}>
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);font-size:21px;")}>search</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search boutiques by name…"
          aria-label="Search boutiques by name"
          style={css('border:none;background:none;flex:1;font-size:14px;font-weight:500;color:var(--ag-ink);min-width:0;')}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            style={css('width:38px;height:38px;flex:none;border-radius:12px;border:none;background:var(--ag-surface-2);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
          >
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);font-size:20px;")}>close</span>
          </button>
        )}
        <button
          onClick={() => setShowFilters((s) => !s)}
          aria-label={showFilters ? 'Hide boutique filters' : 'Filter boutiques'}
          aria-expanded={showFilters}
          style={css(`position:relative;width:44px;height:44px;flex:none;border-radius:12px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:${showFilters || activeFilters ? 'linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44)' : 'var(--ag-surface-2)'};box-shadow:${showFilters || activeFilters ? '0 8px 18px -8px rgba(176,36,84,.7)' : 'none'};`)}
        >
          <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:20px;color:${showFilters || activeFilters ? '#fff' : 'var(--ag-crimson)'};`)}>tune</span>
          {!!activeFilters && (
            <span style={css('position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 3px;border-radius:8px;background:var(--ag-surface);color:var(--ag-crimson);font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;border:1.5px solid #B02454;')}>
              {activeFilters}
            </span>
          )}
        </button>
      </div>

      {/* Browse mode — All vs. the boutiques this buyer follows */}
      <div style={css('display:flex;gap:8px;background:var(--ag-surface-2);border-radius:14px;padding:4px;margin-top:12px;')}>
        <button
          onClick={() => setFollowingOnly(false)}
          style={css(`flex:1;display:flex;align-items:center;justify-content:center;gap:6px;border:none;cursor:pointer;padding:9px 12px;border-radius:11px;font-size:13px;font-weight:700;font-family:inherit;background:${!followingOnly ? 'var(--ag-surface)' : 'transparent'};color:${!followingOnly ? 'var(--ag-crimson)' : 'var(--ag-muted)'};box-shadow:${!followingOnly ? '0 6px 16px -10px rgba(107,20,54,.5)' : 'none'};`)}
        >
          All boutiques
        </button>
        <button
          onClick={() => setFollowingOnly(true)}
          style={css(`flex:1;display:flex;align-items:center;justify-content:center;gap:6px;border:none;cursor:pointer;padding:9px 12px;border-radius:11px;font-size:13px;font-weight:700;font-family:inherit;background:${followingOnly ? 'var(--ag-surface)' : 'transparent'};color:${followingOnly ? 'var(--ag-crimson)' : 'var(--ag-muted)'};box-shadow:${followingOnly ? '0 6px 16px -10px rgba(107,20,54,.5)' : 'none'};`)}
        >
          <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:18px;color:${followingOnly ? 'var(--ag-crimson)' : 'var(--ag-muted)'};`)}>how_to_reg</span>
          Following
          <span style={css(`min-width:18px;height:18px;padding:0 5px;border-radius:9px;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;background:${followingOnly ? 'var(--ag-surface-2)' : 'var(--ag-border)'};color:var(--ag-crimson);`)}>{followingCount}</span>
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:16px;margin-top:12px;box-shadow:0 18px 40px -32px rgba(107,20,54,.55);')}>
          <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:15px;color:var(--ag-ink);")}>Filters</div>
            {!!activeFilters && (
              <button onClick={clearFilters} style={css('border:none;background:none;cursor:pointer;color:var(--ag-crimson);font-size:12.5px;font-weight:700;font-family:inherit;')}>
                Clear all
              </button>
            )}
          </div>

          {/* Sort */}
          <div style={css('font-size:10px;color:var(--ag-muted-soft);letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin:14px 0 8px;')}>Sort by</div>
          <div style={css('display:flex;flex-wrap:wrap;gap:8px;')}>
            {SORTS.map((s) => {
              const on = sort === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setSort(s.key)}
                  style={css(`border:1px solid ${on ? 'transparent' : 'var(--ag-border-soft)'};background:${on ? 'linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-ink-3)'};cursor:pointer;padding:8px 14px;border-radius:999px;font-size:12.5px;font-weight:700;font-family:inherit;`)}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* City */}
          <div style={css('font-size:10px;color:var(--ag-muted-soft);letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin:16px 0 8px;')}>City</div>
          <div style={css('display:flex;flex-wrap:wrap;gap:8px;')}>
            <button
              onClick={() => selectCity(null)}
              style={css(`border:1px solid ${!city ? 'transparent' : 'var(--ag-border-soft)'};background:${!city ? 'linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44)' : 'var(--ag-surface)'};color:${!city ? '#fff' : 'var(--ag-ink-3)'};cursor:pointer;padding:8px 14px;border-radius:999px;font-size:12.5px;font-weight:700;font-family:inherit;`)}
            >
              All cities
            </button>
            {cities.map((c) => {
              const on = city === c;
              return (
                <button
                  key={c}
                  onClick={() => selectCity(on ? null : c)}
                  style={css(`border:1px solid ${on ? 'transparent' : 'var(--ag-border-soft)'};background:${on ? 'linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-ink-3)'};cursor:pointer;padding:8px 14px;border-radius:999px;font-size:12.5px;font-weight:700;font-family:inherit;`)}
                >
                  {c}
                </button>
              );
            })}
          </div>

          {/* Toggles */}
          <div style={css('display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;')}>
            <button
              onClick={() => setVerifiedOnly((v) => !v)}
              style={css(`display:flex;align-items:center;gap:6px;border:1px solid ${verifiedOnly ? 'transparent' : 'var(--ag-border-soft)'};background:${verifiedOnly ? 'linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44)' : 'var(--ag-surface)'};color:${verifiedOnly ? '#fff' : 'var(--ag-ink-3)'};cursor:pointer;padding:8px 14px;border-radius:999px;font-size:12.5px;font-weight:700;font-family:inherit;`)}
            >
              <span aria-hidden="true" style={css('font-family:\'Material Symbols Outlined\';font-size:16px;')}>verified</span>
              Verified only
            </button>
          </div>
        </div>
      )}

      {/* Section label */}
      <div style={css('display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:20px 2px 6px;')}>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:var(--ag-ink);")}>
          {followingOnly ? 'Following' : query || activeFilters ? 'Results' : 'All Boutiques'}
        </div>
        <div style={css("font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ag-muted-soft);letter-spacing:.04em;")}>
          {filtered.length} {filtered.length === 1 ? 'boutique' : 'boutiques'}
        </div>
      </div>

      {/* Vertical list */}
      <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;overflow:hidden;box-shadow:0 18px 40px -32px rgba(107,20,54,.55);')}>
        {display.map((b, i) => {
          const adId = adByBoutique.get(b.id);
          const row = (
          /*
           * A real link, not a click handler.
           *
           * The whole directory was `<div onClick>`, so the one page that lists
           * every boutique offered a crawler no links to follow — the shops were
           * reachable only by running the app. It also could not be tabbed to,
           * middle-clicked or opened in a new tab. The ad click is still counted
           * on the way through; the anchor does the navigating.
           */
          <Link
            to={routes.boutique(b)}
            onClick={() => { if (adId) void trackAdClick(adId); }}
            aria-label={`${b.name} — boutique in ${b.city}`}
            className="agx-lift"
            style={css(`display:flex;align-items:center;gap:14px;padding:14px 16px;cursor:pointer;color:inherit;text-decoration:none;${i > 0 ? 'border-top:1px solid var(--ag-surface-2);' : ''}`)}
          >
            {/* The shop's own logo is the boutique's identity in the directory —
                it falls back to the cover photo, then to a monogram. */}
            <BoutiqueLogo name={b.name} src={b.logo || b.image} size={74} radius={18} className="agx-zoom" />

            <div style={css('flex:1;min-width:0;')}>
              <div style={css('display:flex;align-items:center;gap:6px;')}>
                <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:17px;line-height:1.15;color:var(--ag-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{b.name}</span>
                {b.verified && <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;color:#3E9BE0;flex:none;")}>verified</span>}
                {adId && <PromotedBadge label="Promoted" style={{ flex: 'none' }} />}
              </div>
              <div style={css('display:flex;align-items:center;gap:5px;margin-top:5px;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;color:var(--ag-star);")}>star</span>
                <span style={css('font-size:13px;font-weight:700;color:var(--ag-ink);')}>{b.rating}</span>
                <span style={css('font-size:12.5px;color:var(--ag-muted-soft);font-weight:600;')}>({formatCount(b.reviews)})</span>
              </div>
              <div style={css('display:flex;align-items:center;gap:4px;margin-top:5px;color:var(--ag-muted);font-size:12.5px;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;")}>location_on</span>
                <span style={css('white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{b.area && b.area !== b.city ? `${b.area}, ${b.city}` : b.city}</span>
              </div>
            </div>

            <button
              onClick={(e: MouseEvent) => toggleFollow(e, b.id, b.name)}
              aria-label={following[b.id] ? `Unfollow ${b.name}` : `Follow ${b.name}`}
              aria-pressed={following[b.id]}
              style={css(`width:42px;height:42px;flex:none;border-radius:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;border:1px solid ${following[b.id] ? 'transparent' : 'var(--ag-border-soft)'};background:${following[b.id] ? 'linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44)' : 'var(--ag-surface)'};box-shadow:${following[b.id] ? '0 8px 18px -8px rgba(176,36,84,.7)' : 'none'};`)}
            >
              <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:22px;color:${following[b.id] ? '#fff' : 'var(--ag-crimson)'};`)}>{following[b.id] ? 'how_to_reg' : 'person_add'}</span>
            </button>
          </Link>
          );
          return adId ? (
            <AdImpression key={b.id} adId={adId}>{row}</AdImpression>
          ) : (
            <Fragment key={b.id}>{row}</Fragment>
          );
        })}

        {filtered.length === 0 && followingOnly && followingCount === 0 && (
          <div style={css('padding:40px 20px;text-align:center;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:40px;color:rgba(176,36,84,.3);")}>person_add</span>
            <div style={css('color:var(--ag-ink);font-size:15px;font-weight:700;margin-top:10px;')}>No boutiques followed yet</div>
            <div style={css('color:var(--ag-muted);font-size:13.5px;margin-top:4px;')}>Tap the follow button on any boutique to find it here.</div>
            <button
              onClick={() => setFollowingOnly(false)}
              style={css('margin-top:14px;border:none;background:linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44);cursor:pointer;padding:10px 20px;border-radius:999px;font-size:13px;font-weight:700;color:#fff;font-family:inherit;')}
            >
              Browse all boutiques
            </button>
          </div>
        )}

        {/* A failed load is not "no boutiques match your filters". */}
        {filtered.length === 0 && catalogError && <CatalogError what="the boutiques" onRetry={reload} />}

        {filtered.length === 0 && !catalogError && !(followingOnly && followingCount === 0) && (
          <div style={css('padding:40px 20px;text-align:center;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:40px;color:rgba(107,20,54,.2);")}>storefront</span>
            <div style={css('color:var(--ag-muted);font-size:14px;margin-top:10px;')}>No boutiques match your filters.</div>
            {(query || activeFilters) && (
              <button
                onClick={() => { setQuery(''); clearFilters(); }}
                style={css('margin-top:14px;border:1px solid var(--ag-border-soft);background:var(--ag-surface);cursor:pointer;padding:9px 18px;border-radius:999px;font-size:13px;font-weight:700;color:var(--ag-crimson);font-family:inherit;')}
              >
                Reset
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
