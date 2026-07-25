import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
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
import { newArrivals, daysSince, NEW_ARRIVAL_DAYS } from '@/lib/ranking';
import type { Product } from '@/data/demo';

const PAGE = 20;

/**
 * Age buckets, in the words a shopper would use.
 *
 * A flat "newest first" list answers "what is new" but not "is it worth coming
 * back this week", which is the question that makes a buyer return. Dating each
 * run of the list — Today, This week, Earlier — turns the page into a timeline
 * they can position themselves on.
 */
const BUCKETS = [
  { key: 'today', label: 'Today', max: 1 },
  { key: 'week', label: 'This week', max: 7 },
  { key: 'fortnight', label: 'Last two weeks', max: 14 },
  { key: 'month', label: 'This month', max: NEW_ARRIVAL_DAYS },
  { key: 'earlier', label: 'Recently added', max: Infinity },
];

const bucketOf = (p: Product) => {
  const d = daysSince(p.createdAt);
  return BUCKETS.find((b) => d < b.max) ?? BUCKETS[BUCKETS.length - 1];
};

/**
 * New arrivals — everything listed in the last 30 days, newest first.
 *
 * Deliberately *not* ranked. The moment a popularity signal is mixed into this
 * page it stops answering "what's landed since I last looked" and becomes a
 * second Best sellers — and the piece a boutique listed this morning, which is
 * the whole reason a seller bothers to list promptly, sinks out of sight.
 * See `newArrivals` in @/lib/ranking.
 */
export function NewArrivals() {
  const navigate = useNavigate();
  const { wishlist, toggleWish, setFilters, setQuery } = useShop();
  const { products: PRODUCTS, loading } = useCatalog();

  const [cat, setCat] = useState<string | null>(null);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const arrivals = useMemo(() => newArrivals(PRODUCTS), [PRODUCTS]);

  const cats = useMemo(() => {
    const counts = new Map<string, number>();
    arrivals.forEach((p) => counts.set(p.cat, (counts.get(p.cat) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [arrivals]);

  const list = useMemo(
    () => arrivals.filter((p) => (!cat || p.cat === cat) && (!inStockOnly || p.stock > 0)),
    [arrivals, cat, inStockOnly],
  );

  const page = list.slice(0, shown);

  const openProduct = (id: string) => navigate(`/buyer/product/${id}`);
  const setCategory = (name: string | null) => { setCat(name); setShown(PAGE); };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
      <DiscoveryHeader
        eyebrow="Fresh off the loom"
        title="New"
        accent="arrivals"
        subtitle={`Everything our boutiques have listed in the last ${NEW_ARRIVAL_DAYS} days, newest first. No ranking, no popularity — just the order they arrived in.`}
        count={list.length}
      />

      <RankingNote
        lines={[
          { term: 'Listing date', weight: '100%', why: `the only thing that decides the order here. A piece listed an hour ago sits above one listed yesterday, whatever its rating.` },
          { term: 'The window', why: `pieces stay on this page for ${NEW_ARRIVAL_DAYS} days. If a quiet month means fewer than a dozen landed, the next-newest are carried in so the page is never near-empty.` },
          { term: 'Sold out', why: 'stays visible, marked, and drops to the bottom of nothing — it is still news that it arrived, and it tells you what to watch for next time.' },
        ]}
      />

      {/* Category chips — a buyer looking for new sarees should not have to
          scroll past new kurtis to find out there are none. */}
      {cats.length > 1 && (
        <div className="agx-scroll" style={css('display:flex;gap:8px;overflow-x:auto;margin-top:18px;padding-bottom:4px;')}>
          <Chip on={!cat} onClick={() => setCategory(null)} label="All" count={arrivals.length} />
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
          onClick={() => { setQuery(''); setFilters({ ...DEFAULT_FILTERS, sort: 'Latest' }); navigate('/buyer/results'); }}
          style={css('display:flex;align-items:center;gap:6px;border:none;background:none;cursor:pointer;color:var(--ag-crimson);font-size:12.5px;font-weight:700;font-family:inherit;')}
        >
          Browse the full catalogue
          <span style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>arrow_forward</span>
        </button>
      </div>

      <div style={css('margin-top:22px;')}>
        {loading && PRODUCTS.length === 0 && <CardSkeletons />}

        {!loading && list.length === 0 && (
          <EmptyState
            icon="fiber_new"
            title={cat ? `Nothing new in ${cat} yet` : 'Nothing listed just yet'}
            body={cat ? 'Try another category, or browse everything our boutiques have in stock.' : 'New pieces land every week. Follow a boutique and its arrivals will show up in Inspire.'}
            action={
              <button
                onClick={() => (cat ? setCategory(null) : navigate('/buyer/boutiques'))}
                style={css('border:none;background:linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44);cursor:pointer;padding:11px 22px;border-radius:999px;font-size:13px;font-weight:700;color:#fff;font-family:inherit;')}
              >
                {cat ? 'Show all arrivals' : 'Find boutiques to follow'}
              </button>
            }
          />
        )}

        {/* One grid, with a dated heading wherever the list crosses into an
            older bucket — so the timeline survives "Show more". */}
        {page.length > 0 && (
          <BucketedGrid
            products={page}
            wishlist={wishlist}
            onToggleWish={toggleWish}
            onOpen={openProduct}
          />
        )}

        <ShowMore shown={page.length} total={list.length} onMore={() => setShown((s) => s + PAGE)} />
      </div>

      <SiteFooter />
    </div>
  );
}

function BucketedGrid({
  products,
  wishlist,
  onToggleWish,
  onOpen,
}: {
  products: Product[];
  wishlist: Record<string, boolean>;
  onToggleWish: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  // Group in order rather than sorting again — `products` is already newest
  // first, so a bucket change can only ever move forwards through the list.
  const groups: { label: string; items: Product[] }[] = [];
  for (const p of products) {
    const label = bucketOf(p).label;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(p);
    else groups.push({ label, items: [p] });
  }

  return (
    <>
      {groups.map((g, gi) => (
        <div key={`${g.label}-${gi}`}>
          <div style={css(`display:flex;align-items:center;gap:10px;margin:${gi === 0 ? '0' : '30px'} 2px 14px;`)}>
            <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:17px;color:var(--ag-ink);white-space:nowrap;")}>{g.label}</span>
            <span style={css('flex:1;height:1px;background:var(--ag-surface-3);')} />
            <span style={css("font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ag-muted-soft);")}>{g.items.length}</span>
          </div>
          <div className="agx-rgrid">
            {g.items.map((p) => (
              <CatalogCard
                key={p.id}
                product={p}
                onOpen={() => onOpen(p.id)}
                wished={!!wishlist[p.id]}
                onToggleWish={(e) => { e.stopPropagation(); onToggleWish(p.id); }}
                badge={{ icon: 'fiber_new', label: 'New' }}
              />
            ))}
          </div>
        </div>
      ))}
    </>
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
