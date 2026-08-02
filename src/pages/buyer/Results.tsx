import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { readSearchParams, sameSearchState, writeSearchParams } from '@/lib/searchParams';
import { occasionLabel } from '@/lib/vocabulary';
import { usePageMeta } from '@/lib/pageMeta';
import { routes } from '@/lib/seo';
import { breadcrumbSchema, collectionSchema, graph, organizationSchema } from '@/lib/schema';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { CatalogError } from '@/components/buyer/CatalogError';
import { WishButton } from '@/components/buyer/WishButton';
import { CardLink } from '@/components/buyer/CardLink';
import { useShop, DEFAULT_FILTERS } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { useTaxonomy } from '@/state/TaxonomyContext';
import { SORTS, TONES, fmt, productSizes } from '@/data/demo';
import { useLiveAds } from '@/hooks/useLiveAds';
import { SponsoredStrip } from '@/components/buyer/SponsoredStrip';

const reviewsF = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

/** Fields a header search term is matched against. */
const searchable = (p: { title: string; cat: string; occasion: string; fabric: string; color: string; boutique: string }) =>
  [p.title, p.cat, p.occasion, p.fabric, p.color, p.boutique];

export function Results() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { filters, setFilters, toggleFilter, setSort, setMaxPrice, wishlist, toggleWish, query, setQuery } = useShop();
  const { products: PRODUCTS, error: catalogError, reload } = useCatalog();

  /**
   * Keep the address bar and the grid saying the same thing.
   *
   * Two effects, deliberately not one. The first is URL → state: it runs when
   * the location changes for a reason that did not come from us — a fresh load
   * of `/search?q=saree`, a pasted link, Back/Forward — and adopts whatever the
   * URL asks for. The second is state → URL: it runs when the buyer changes
   * something on the page and rewrites the query string to match.
   *
   * `appliedRef` is what stops them fighting. Each effect records the string it
   * just acted on, so the echo it provokes in the other is recognised and
   * ignored; without it the pair would ping-pong a new history entry per render.
   * The state → URL write is a `replace`, not a `push`, so tightening a filter
   * four times doesn't bury the previous page under four Back presses.
   */
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (appliedRef.current === search) return;
    appliedRef.current = search;
    const next = readSearchParams(search);
    if (sameSearchState(next, { query, filters })) return;
    setQuery(next.query);
    setFilters(next.filters);
    // Only `search` drives this: including the state it *writes* would make it
    // re-run on its own result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    const next = writeSearchParams({ query, filters });
    if (next === search) return;
    appliedRef.current = next;
    navigate({ pathname, search: next }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filters]);
  const { ads } = useLiveAds();
  // Facets are the admin's approved vocabulary (migration 0024), so a category
  // approved today is filterable today and a seller's typo never becomes a chip.
  const { names, rows, hexOf } = useTaxonomy();

  const q = query.trim().toLowerCase();

  let results = PRODUCTS.filter(
    (p) =>
      p.price <= filters.maxPrice &&
      (filters.cats.length === 0 || filters.cats.includes(p.cat)) &&
      (filters.colors.length === 0 || filters.colors.includes(p.color)) &&
      (filters.occasions.length === 0 || filters.occasions.includes(p.occasion)) &&
      (filters.sizes.length === 0 || productSizes(p).some((s) => filters.sizes.includes(s))) &&
      // The header search narrows the same grid rather than opening a separate
      // screen, so a term and a filter compose instead of fighting.
      (q === '' || searchable(p).some((f) => f?.toLowerCase().includes(q))),
  );
  if (filters.sort === 'Price: Low to High') results = [...results].sort((a, b) => a.price - b.price);
  else if (filters.sort === 'Price: High to Low') results = [...results].sort((a, b) => b.price - a.price);
  else if (filters.sort === 'Popularity') results = [...results].sort((a, b) => b.reviews - a.reviews);

  /**
   * What this page is actually showing, derived from the live state rather than
   * the hardcoded "Ethnic Wear" it used to claim regardless of the filters.
   * The same value titles the page and terminates the breadcrumb, so the two can
   * never disagree.
   */
  const filterCount =
    filters.cats.length + filters.colors.length + filters.occasions.length + filters.sizes.length +
    (filters.maxPrice < DEFAULT_FILTERS.maxPrice ? 1 : 0);

  const isBaseCollection = !query.trim() && filterCount === 0;
  const collectionTitle = query.trim()
    ? `“${query.trim()}”`
    : filters.cats.length === 1 && filters.occasions.length === 0
      ? filters.cats[0]
      : filters.occasions.length === 1 && filters.cats.length === 0
        ? occasionLabel(filters.occasions[0])
        : filters.cats.length > 1
          ? 'Selected categories'
          : filterCount > 0
            ? 'Filtered edit'
            : 'All collections';
  const eyebrow = query.trim() ? 'Search results' : isBaseCollection ? 'Every piece on MangaiMart' : 'The edit';

  /**
   * One component, two very different jobs as far as a crawler is concerned.
   *
   * `/shop` unfiltered is a real destination and should rank. Everything else
   * this component renders — a search term, an ad-hoc filter combination — is
   * an infinite space of near-identical pages generated by user input, which is
   * exactly what Google's guidance says to keep out of the index. Both are
   * therefore canonicalised to `/shop` and the non-base states are `noindex`,
   * so crawl budget goes to the category landing pages instead, which exist for
   * this purpose and carry unique copy.
   */
  const isSearchSurface = pathname.startsWith('/search') || !isBaseCollection;
  usePageMeta({
    title: isBaseCollection
      ? 'Shop All — Ethnic Wear from Verified Tamil Nadu Boutiques'
      : `${collectionTitle} — MangaiMart`,
    description: isBaseCollection
      ? 'Every piece listed by verified Tamil Nadu boutiques on MangaiMart. Filter by category, occasion, colour, size and budget.'
      : `${results.length} ${results.length === 1 ? 'piece' : 'pieces'} matching ${collectionTitle} on MangaiMart.`,
    canonical: '/shop',
    noindex: isSearchSurface,
    schema: isBaseCollection
      ? graph(
          organizationSchema(),
          collectionSchema({
            name: 'Shop all',
            description: 'Every piece listed by verified Tamil Nadu boutiques on MangaiMart.',
            path: '/shop',
            items: results,
          }),
          breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Shop', path: '/shop' }]),
        )
      : null,
  });

  /**
   * Back to the unfiltered grid — the "Collections" breadcrumb and empty state.
   * Clearing everything also returns to `/shop`: a bare `/search` is a robots-
   * disallowed surface with nothing to search, and `/shop` is the canonical home
   * of the full catalogue.
   */
  const resetCollection = () => {
    setQuery('');
    setFilters(DEFAULT_FILTERS);
    navigate('/shop');
  };

  const activeChips: { key: string; label: string; remove: () => void }[] = [];
  if (query.trim()) activeChips.push({ key: 'q', label: `“${query.trim()}”`, remove: () => setQuery('') });
  if (filters.maxPrice < 10000) activeChips.push({ key: 'price', label: 'Under ' + fmt(filters.maxPrice), remove: () => setFilters({ ...filters, maxPrice: 10000 }) });
  filters.cats.forEach((c) => activeChips.push({ key: 'cat:' + c, label: c, remove: () => toggleFilter('cats', c) }));
  filters.colors.forEach((c) => activeChips.push({ key: 'color:' + c, label: c, remove: () => toggleFilter('colors', c) }));
  filters.occasions.forEach((c) => activeChips.push({ key: 'occ:' + c, label: c, remove: () => toggleFilter('occasions', c) }));
  filters.sizes.forEach((c) => activeChips.push({ key: 'size:' + c, label: 'Size ' + c, remove: () => toggleFilter('sizes', c) }));

  const pricePlus = filters.maxPrice >= 10000 ? '+' : '';

  const stockFg = (stock: number) => (stock === 0 ? 'var(--ag-danger-text)' : stock <= 5 ? 'var(--ag-gold-text)' : 'var(--ag-good-text)');
  const stockLabel = (stock: number) => (stock === 0 ? 'Out of stock' : stock <= 5 ? `Low · ${stock} left` : 'In stock');

  return (
    <div className="agx-results-root" style={css('width:100vw;margin-left:calc(50% - 50vw);min-height:100%;background:var(--ag-surface);')}>
      <div className="agx-results-inner" style={css('max-width:1480px;margin:0 auto;padding:14px clamp(16px,4vw,44px) 140px;')}>
        <div style={css('flex:none;')}>
          {/* Breadcrumb: Home / Collections / <what you're looking at>. The last
              crumb is dropped on the unfiltered grid, where "Collections" is
              already the page you're on. */}
          <nav aria-label="Breadcrumb" style={css('display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ag-muted);flex-wrap:wrap;')}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }} style={css('color:var(--ag-muted);')}>Home</a>
            <span>/</span>
            {isBaseCollection ? (
              <span style={css('color:var(--ag-ink);font-weight:700;')}>Collections</span>
            ) : (
              <>
                <a href="/shop" onClick={(e) => { e.preventDefault(); resetCollection(); }} style={css('color:var(--ag-muted);')}>Collections</a>
                <span>/</span>
                <span style={css('color:var(--ag-ink);font-weight:700;')}>{collectionTitle}</span>
              </>
            )}
          </nav>

          <div style={css('display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-top:12px;')}>
            <div>
              <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>{eyebrow}</div>
              <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(28px,3.2vw,42px);line-height:1.06;letter-spacing:-.01em;margin:6px 0 0;")}>
                {collectionTitle}{' '}
                <span style={css("font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:500;color:var(--ag-muted);letter-spacing:0;")}>
                  · {results.length} {results.length === 1 ? 'piece' : 'pieces'}
                </span>
              </h1>
            </div>
            {/* Desktop sort chips — hidden on mobile in favour of the action bar. */}
            <div className="agx-res-sortbar" style={css('display:flex;align-items:center;gap:10px;background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:14px;padding:6px 8px 6px 14px;')}>
              <span className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-muted);white-space:nowrap;')}>Sort</span>
              <div className="agx-scroll" style={css('display:flex;align-items:center;gap:6px;overflow-x:auto;max-width:100%;')}>
                {SORTS.map((x) => {
                  const on = filters.sort === x;
                  return (
                    <button key={x} onClick={() => setSort(x)} style={css(`border:1.5px solid ${on ? 'var(--ag-crimson)' : 'var(--ag-border)'};background:${on ? 'var(--ag-crimson)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-label)'};border-radius:999px;padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;`)}>
                      {x}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {activeChips.length > 0 && (
            <div style={css('display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:16px;')}>
              <span className="agx-eyebrow" style={css('font-size:9.5px;color:var(--ag-muted);')}>Filtering by</span>
              {activeChips.map((c) => (
                <button key={c.key} onClick={c.remove} style={css('display:flex;align-items:center;gap:6px;background:var(--ag-surface-2);border:1px solid var(--ag-border);color:var(--ag-crimson);border-radius:999px;padding:7px 10px 7px 13px;font-size:12.5px;font-weight:700;cursor:pointer;')}>
                  {c.label}<span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>close</span>
                </button>
              ))}
              <button onClick={resetCollection} style={css('border:none;background:none;color:var(--ag-muted);font-weight:700;font-size:12px;cursor:pointer;text-decoration:underline;')}>Clear all</button>
            </div>
          )}
        </div>

        <div className="agx-res-body" style={css('display:flex;gap:36px;align-items:flex-start;margin-top:22px;')}>
          <aside className="agx-filters agx-res-aside" style={css('width:266px;flex:none;position:sticky;top:78px;max-height:calc(100vh - 104px);overflow-y:auto;padding:20px;background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:20px;')}>
            <div style={css('flex:none;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--ag-border);padding-bottom:14px;')}>
              <div className="agx-eyebrow" style={css('font-size:11px;color:var(--ag-ink);')}>Filters</div>
              <button onClick={resetCollection} style={css('border:none;background:none;color:var(--ag-crimson);font-weight:700;font-size:12px;cursor:pointer;')}>Clear all</button>
            </div>

            <div className="agx-res-aside-scroll agx-scroll">
              <div style={css('padding:18px 0;border-bottom:1px solid var(--ag-border);')}>
                <div className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-muted);')}>Price</div>
                <div style={css('display:flex;justify-content:space-between;font-size:12.5px;color:var(--ag-muted);font-weight:700;margin-top:12px;')}>
                  <span>₹0</span><span style={css('color:var(--ag-crimson);')}>{fmt(filters.maxPrice)}{pricePlus}</span>
                </div>
                <input type="range" min={0} max={10000} step={100} value={filters.maxPrice} onChange={(e) => setMaxPrice(+e.target.value)} aria-label="Maximum price" aria-valuetext={fmt(filters.maxPrice)} style={css('width:100%;accent-color:#D6336C;margin-top:8px;')} />
              </div>

              <div style={css('padding:18px 0;border-bottom:1px solid var(--ag-border);')}>
                <div className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-muted);')}>Category</div>
                <div style={css('display:flex;flex-direction:column;gap:6px;margin-top:14px;')}>
                  {names('category').map((c) => {
                    const on = filters.cats.includes(c);
                    return (
                      <label key={c} onClick={() => toggleFilter('cats', c)} style={css('display:flex;align-items:center;gap:11px;font-size:13.5px;font-weight:600;color:var(--ag-ink-2);cursor:pointer;')}>
                        <span style={css(`width:19px;height:19px;flex:none;border-radius:5px;border:1.5px solid ${on ? '#D6336C' : '#CBB0BC'};background:${on ? '#D6336C' : 'var(--ag-surface)'};display:flex;align-items:center;justify-content:center;`)}>
                          <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:14px;color:#fff;opacity:${on ? 1 : 0};`)}>check</span>
                        </span>{c}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={css('padding:18px 0;border-bottom:1px solid var(--ag-border);')}>
                <div className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-muted);')}>Size</div>
                <div style={css('display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;')}>
                  {names('size').map((s) => {
                    const on = filters.sizes.includes(s);
                    return (
                      <button key={s} onClick={() => toggleFilter('sizes', s)} style={css(`min-width:44px;height:40px;padding:0 12px;border-radius:11px;border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-ink-2)'};font-size:13px;font-weight:${on ? 800 : 700};cursor:pointer;`)}>{s}</button>
                    );
                  })}
                </div>
              </div>

              <div style={css('padding:18px 0;border-bottom:1px solid var(--ag-border);')}>
                <div className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-muted);')}>Colour</div>
                <div style={css('display:flex;flex-wrap:wrap;gap:14px;margin-top:15px;')}>
                  {rows('color').map((c) => (
                    <button key={c.name} onClick={() => toggleFilter('colors', c.name)} style={css('display:flex;flex-direction:column;align-items:center;gap:5px;border:none;background:none;cursor:pointer;')}>
                      <span style={css(`width:34px;height:34px;border-radius:50%;background:${hexOf(c.name)};box-shadow:0 0 0 ${filters.colors.includes(c.name) ? '3px #D6336C' : '1px var(--ag-border)'};`)} />
                      <span style={css('font-size:11px;font-weight:700;color:var(--ag-label);')}>{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div style={css('padding:18px 0 4px;')}>
                <div className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-muted);')}>Occasion</div>
                <div style={css('display:flex;flex-direction:column;gap:6px;margin-top:14px;')}>
                  {names('occasion').map((o) => {
                    const on = filters.occasions.includes(o);
                    return (
                      <label key={o} onClick={() => toggleFilter('occasions', o)} style={css('display:flex;align-items:center;gap:11px;font-size:13.5px;font-weight:600;color:var(--ag-ink-2);cursor:pointer;')}>
                        <span style={css(`width:19px;height:19px;flex:none;border-radius:5px;border:1.5px solid ${on ? '#D6336C' : '#CBB0BC'};background:${on ? '#D6336C' : 'var(--ag-surface)'};display:flex;align-items:center;justify-content:center;`)}>
                          <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:14px;color:#fff;opacity:${on ? 1 : 0};`)}>check</span>
                        </span>{o}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </aside>

          <div className="agx-res-grid" style={css('flex:1;min-width:0;')}>
            {/* Sponsored placements sit above the organic grid, clearly labelled. */}
            <SponsoredStrip ads={ads.sponsored_card} title="Sponsored" />
            <div className="agx-rgrid">
              {results.map((p) => (
                <CardLink key={p.id} to={routes.product(p)} label={p.title} className="agx-lift">
                  <div className="agx-prod-media agx-zoom" style={css(`background:${TONES[p.tone]};`)}>
                    <ImageSlot src={p.image} placeholder={p.title} className="agx-prod-fill" />
                    <WishButton
                      wished={!!wishlist[p.id]}
                      title={p.title}
                      onToggle={(e) => { e.stopPropagation(); toggleWish(p.id); }}
                      className="agx-card-wish"
                    />
                    {p.reviews > 0 && (
                      <div style={css('position:absolute;left:10px;bottom:10px;display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.96);border-radius:9px;padding:3px 9px;font-size:11.5px;font-weight:800;color:#241019;box-shadow:0 4px 12px rgba(0,0,0,.16);')}>
                        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:14px;color:var(--ag-star);")}>star</span>{p.rating}
                        <span style={css('width:1px;height:11px;background:#E8D7DF;')} />
                        <span style={css('color:#8A7078;font-weight:700;')}>{reviewsF(p.reviews)}</span>
                      </div>
                    )}
                  </div>
                  <div style={css('padding:11px 2px 0;')}>
                    <div className="agx-card-title" style={css('font-size:14px;font-weight:700;')}>{p.title}</div>
                    <div className="agx-card-sub" style={css('font-size:12.5px;color:var(--ag-muted);')}>{p.boutique}</div>
                    <div style={css('display:flex;align-items:center;gap:8px;margin-top:6px;')}>
                      <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:18px;")}>{fmt(p.price)}</span>
                      <span style={css(`font-size:11px;font-weight:800;color:${stockFg(p.stock)};`)}>{stockLabel(p.stock)}</span>
                    </div>
                  </div>
                </CardLink>
              ))}
            </div>

            {/* A failed load is not an empty catalogue — say which one it is. */}
            {results.length === 0 && catalogError && <CatalogError what="the collection" onRetry={reload} />}

            {results.length === 0 && !catalogError && (
              <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:70px 30px;')}>
                <div style={css('width:74px;height:74px;border-radius:24px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:38px;color:#D6336C;")}>search_off</span>
                </div>
                <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;margin-top:16px;")}>No matches found</div>
                <div style={css('color:var(--ag-muted);font-size:14px;margin-top:6px;max-width:320px;line-height:1.55;')}>
                  {query.trim()
                    ? `Nothing matched “${query.trim()}”. Try a different spelling, or browse the full collection.`
                    : 'Try widening your price range or clearing a filter.'}
                </div>
                <button onClick={resetCollection} style={css('margin-top:16px;background:#B02454;color:#fff;border:none;border-radius:12px;padding:11px 20px;font-weight:700;cursor:pointer;')}>
                  {query.trim() ? 'Browse all collections' : 'Reset filters'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* MOBILE FILTER / SORT BAR — floats above the dock on small screens. */}
        <div className="agx-mob-actionbar" style={css('position:fixed;left:0;right:0;bottom:96px;z-index:20;justify-content:center;gap:12px;padding:0 16px;pointer-events:none;')}>
          <button
            onClick={() => navigate('/shop/filter')}
            style={css('pointer-events:auto;flex:1;max-width:200px;height:52px;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--ag-border);border-radius:16px;background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:14.5px;cursor:pointer;box-shadow:0 16px 34px -14px rgba(107,20,54,.55);')}
          >
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>tune</span>
            Filter
            {activeChips.length > 0 && (
              <span style={css('min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#D6336C;color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;')}>{activeChips.length}</span>
            )}
          </button>
          <button
            onClick={() => navigate('/shop/sort')}
            style={css('pointer-events:auto;flex:1;max-width:200px;height:52px;display:flex;align-items:center;justify-content:center;gap:8px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14.5px;cursor:pointer;box-shadow:0 16px 34px -14px rgba(214,51,108,.75);')}
          >
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>swap_vert</span>
            Sort
          </button>
        </div>
      </div>
    </div>
  );
}
