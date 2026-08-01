import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { routes } from '@/lib/seo';
import { breadcrumbSchema, collectionSchema, graph, organizationSchema } from '@/lib/schema';
import { SiteFooter } from '@/components/buyer/SiteFooter';
import {
  DiscoveryHeader,
  RankingNote,
  CatalogCard,
  CardSkeletons,
  EmptyState,
  ShowMore,
} from '@/components/buyer/DiscoveryPage';
import { useShop, DEFAULT_FILTERS } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { scoreProducts, salesProof, RATING_CONFIDENCE_PRODUCT } from '@/lib/ranking';

const PAGE = 20;

/**
 * Best sellers — the catalogue ranked by how fast pieces are actually moving.
 *
 * The ranking itself lives in `scoreProducts` (@/lib/ranking); this screen is
 * what makes it legible. Two things it deliberately does:
 *
 *  · It shows the *reason* a piece is here ("212 sold") on the card, so the
 *    ranking is checkable rather than magic.
 *  · It publishes its own weights in the ranking note. On a commission
 *    marketplace, an unexplained top slot reads as a paid one.
 */
export function BestSellers() {
  const navigate = useNavigate();
  const { wishlist, toggleWish, setFilters, setQuery } = useShop();
  const { products: PRODUCTS, loading } = useCatalog();

  const [cat, setCat] = useState<string | null>(null);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const ranked = useMemo(() => scoreProducts(PRODUCTS), [PRODUCTS]);

  const cats = useMemo(() => {
    const counts = new Map<string, number>();
    PRODUCTS.forEach((p) => counts.set(p.cat, (counts.get(p.cat) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [PRODUCTS]);

  /**
   * Filtering re-ranks *within* the filter rather than filtering a global
   * ranking, so "Best-selling sarees" is a real leaderboard numbered 1, 2, 3 —
   * not the global list with the gaps left in.
   */
  const list = useMemo(
    () => ranked.filter((r) => (!cat || r.product.cat === cat) && (!inStockOnly || r.product.stock > 0)),
    [ranked, cat, inStockOnly],
  );

  usePageMeta({
    title: 'Best Sellers — Most-Bought Ethnic Wear on MangaiMart',
    description: 'The pieces MangaiMart buyers are actually taking home, ranked by units sold and how well they are rated. Updated as orders come in.',
    canonical: routes.bestSellers(),
    schema: graph(
      organizationSchema(),
      // The page *is* a ranked list, so it says so — an ItemList is what lets
      // Google read it as an ordered set of products rather than a wall of links.
      collectionSchema({
        name: 'Best sellers',
        description: 'The pieces MangaiMart buyers are actually taking home, ranked by units sold and rating.',
        path: routes.bestSellers(),
        items: list.map((r) => r.product),
      }),
      breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Best sellers', path: routes.bestSellers() }]),
    ),
  });

  const page = list.slice(0, shown);
  const anySalesData = ranked.some((r) => (r.product.soldCount ?? 0) > 0);

  const setCategory = (name: string | null) => { setCat(name); setShown(PAGE); };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
      <DiscoveryHeader
        eyebrow="Most-loved right now"
        title="Best"
        accent="sellers"
        subtitle={cat
          ? `The ${cat.toLowerCase()} our buyers are actually taking home, fastest movers first.`
          : 'What our buyers are actually taking home. Ranked by how fast pieces sell, weighed against how well they are rated — not by how long they have been listed.'}
        count={list.length}
      />

      <RankingNote
        lines={[
          { term: 'Sales pace', weight: '55%', why: 'units sold per day since the piece was listed. A rate, not a total — so something listed last week can out-rank something that has been on the shelf for two years.' },
          { term: 'Rating', weight: '25%', why: `weighed by confidence: a single 5★ review counts for far less than two hundred at 4.6★. Ratings settle only after about ${RATING_CONFIDENCE_PRODUCT} reviews.` },
          { term: 'Review count', weight: '15%', why: 'proof that real buyers, plural, have been through it and come back to say so.' },
          { term: 'Recency', weight: '5%', why: 'a light thumb on the scale, so one evergreen hit cannot hold the top slot forever.' },
          { term: 'Sold out', why: 'drops to 40% of its score — still worth seeing that it is in demand, never worth a wasted tap.' },
        ]}
      />

      {/* Until the first orders land there is nothing to rank on, and pretending
          otherwise would be dishonest — say so instead. */}
      {!loading && !anySalesData && PRODUCTS.length > 0 && (
        <div style={css('display:flex;gap:10px;align-items:flex-start;background:var(--ag-gold-bg);border:1px solid var(--ag-gold-border);border-radius:16px;padding:13px 15px;margin-top:14px;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:#B8892B;flex:none;")}>hourglass_top</span>
          <span style={css('font-size:12.5px;color:#7A5C1E;line-height:1.55;')}>
            Not enough orders yet to rank by sales, so this list is ordered by ratings and reviews for now. It will start moving as soon as buyers do.
          </span>
        </div>
      )}

      {cats.length > 1 && (
        <div className="agx-scroll" style={css('display:flex;gap:8px;overflow-x:auto;margin-top:18px;padding-bottom:4px;')}>
          <Chip on={!cat} onClick={() => setCategory(null)} label="All" count={PRODUCTS.length} />
          {cats.map(([name, n]) => (
            <Chip key={name} on={cat === name} onClick={() => setCategory(cat === name ? null : name)} label={name} count={n} />
          ))}
        </div>
      )}

      <div style={css('display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;')}>
        <button
          onClick={() => { setInStockOnly((v) => !v); setShown(PAGE); }}
          style={css(`display:flex;align-items:center;gap:7px;border:1px solid ${inStockOnly ? 'transparent' : 'var(--ag-border-soft)'};background:${inStockOnly ? 'linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44)' : 'var(--ag-surface)'};color:${inStockOnly ? '#fff' : 'var(--ag-ink-3)'};cursor:pointer;padding:9px 15px;border-radius:999px;font-size:12.5px;font-weight:700;font-family:inherit;`)}
        >
          <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>inventory_2</span>
          In stock only
        </button>
        <button
          onClick={() => { setQuery(''); setFilters({ ...DEFAULT_FILTERS, sort: 'Popularity' }); navigate('/shop'); }}
          style={css('display:flex;align-items:center;gap:6px;border:none;background:none;cursor:pointer;color:var(--ag-crimson);font-size:12.5px;font-weight:700;font-family:inherit;')}
        >
          Filter by price, colour, size
          <span style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>tune</span>
        </button>
      </div>

      <div style={css('margin-top:22px;')}>
        {loading && PRODUCTS.length === 0 && <CardSkeletons />}

        {!loading && list.length === 0 && (
          <EmptyState
            icon="local_fire_department"
            title={cat ? `No ${cat.toLowerCase()} to rank yet` : 'Nothing to rank yet'}
            body={cat ? 'Try another category, or see what is selling across the whole catalogue.' : 'Once boutiques list and buyers order, the fastest movers appear here automatically.'}
            action={
              <button
                onClick={() => (cat ? setCategory(null) : navigate('/collections'))}
                style={css('border:none;background:linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44);cursor:pointer;padding:11px 22px;border-radius:999px;font-size:13px;font-weight:700;color:#fff;font-family:inherit;')}
              >
                {cat ? 'Show every best seller' : 'Browse collections'}
              </button>
            }
          />
        )}

        {page.length > 0 && (
          <div className="agx-rgrid">
            {page.map((r, i) => (
              <CatalogCard
                key={r.product.id}
                product={r.product}
                rank={i + 1}
                proof={salesProof(r.product)}
                wished={!!wishlist[r.product.id]}
                onToggleWish={(e) => { e.stopPropagation(); toggleWish(r.product.id); }}
              />
            ))}
          </div>
        )}

        <ShowMore shown={page.length} total={list.length} onMore={() => setShown((s) => s + PAGE)} />
      </div>

      <SiteFooter />
    </div>
  );
}

function Chip({ label, count, on, onClick }: { label: string; count: number; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={css(`flex:none;display:flex;align-items:center;gap:6px;border:1px solid ${on ? 'transparent' : 'var(--ag-border-soft)'};background:${on ? 'linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-ink-3)'};cursor:pointer;padding:9px 15px;border-radius:999px;font-size:12.5px;font-weight:700;font-family:inherit;white-space:nowrap;`)}
    >
      {label}
      <span style={css(`font-family:'IBM Plex Mono',monospace;font-size:11px;color:${on ? 'rgba(255,255,255,.75)' : 'var(--ag-muted-soft)'};`)}>{count}</span>
    </button>
  );
}
