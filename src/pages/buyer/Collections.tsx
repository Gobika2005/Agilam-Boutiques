import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { routes } from '@/lib/seo';
import { breadcrumbSchema, graph, organizationSchema } from '@/lib/schema';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { SiteFooter } from '@/components/buyer/SiteFooter';
import { DiscoveryHeader, SectionLabel, EmptyState } from '@/components/buyer/DiscoveryPage';
import { useShop, DEFAULT_FILTERS } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { useTaxonomy } from '@/state/TaxonomyContext';
import { buildCollections } from '@/lib/collections';
import { fmt } from '@/data/demo';

/**
 * Shop by collection — every way into the catalogue, on one page.
 *
 * The Home rail shows six circles because a rail has room for six. This page is
 * where the buyer who did not see their thing in those six goes, so it is built
 * from the live catalogue rather than from the design's fixed list: whatever
 * sellers have actually listed is what appears, with a live count on every tile
 * and nothing that would open onto an empty grid.
 *
 * The four groupings are the four questions buyers actually arrive with:
 *   what kind of garment · what am I dressing for · what can I spend · what colour
 * Fabric comes last because it is the connoisseur's cut, not the beginner's.
 */
export function Collections() {
  usePageMeta({
    title: 'Shop by Collection — Sarees, Kurta Sets & Ethnic Wear',
    description: 'Browse every category, occasion, fabric, budget and colour Tamil Nadu boutiques are listing on MangaiMart right now.',
    canonical: routes.collections(),
    schema: graph(
      organizationSchema(),
      breadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Collections', path: routes.collections() },
      ]),
    ),
  });
  const navigate = useNavigate();
  const { setFilters, setQuery } = useShop();
  const { products: PRODUCTS, loading } = useCatalog();
  // Which terms are browsable is the admin's call (migration 0024); how many
  // pieces sit under each is the catalogue's.
  const vocab = useTaxonomy();

  const { categories, occasions, budgets, colours, fabrics } = useMemo(
    () => buildCollections(PRODUCTS, vocab),
    [PRODUCTS, vocab],
  );

  /** Every tile lands on a clean, single-facet grid — never on leftovers from
   *  the buyer's last visit to Results. */
  const open = (patch: Partial<typeof DEFAULT_FILTERS>) => {
    setQuery('');
    setFilters({ ...DEFAULT_FILTERS, ...patch });
    navigate('/shop');
  };

  if (!loading && PRODUCTS.length === 0) {
    return (
      <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
        <DiscoveryHeader
          eyebrow="Browse every edit"
          title="Shop by collection"
          subtitle="Every category, occasion, budget and colour in the catalogue."
        />
        <EmptyState
          icon="storefront"
          title="The catalogue is still filling up"
          body="Boutiques are being onboarded right now. Check back shortly — new pieces land every week."
        />
      </div>
    );
  }

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
      <DiscoveryHeader
        eyebrow="Browse every edit"
        title="Shop by"
        accent="collection"
        subtitle="Every category, occasion, budget and colour our boutiques are listing right now. Each tile opens the full grid, already filtered."
        count={PRODUCTS.length}
        countLabel="pieces in all"
      />

      {/* ── Category ─────────────────────────────────────────────────────── */}
      <SectionLabel icon="checkroom" title="Shop by category" note={`${categories.length} categories`} />
      <div className="agx-coll-grid">
        {categories.map((c) => (
          <Link
            key={c.name}
            to={routes.category(c.name)}
            aria-label={`${c.name} — ${c.count} pieces from ${fmt(c.from)}`}
            className="agx-lift"
            style={css(`position:relative;display:block;width:100%;padding:0;border:none;cursor:pointer;border-radius:22px;overflow:hidden;text-align:left;text-decoration:none;background:${c.toneHex};box-shadow:0 18px 40px -32px rgba(107,20,54,.55);`)}
          >
            <div className="agx-zoom" style={css('position:relative;aspect-ratio:4/5;')}>
              <ImageSlot src={c.image} placeholder={c.name} style={css('position:absolute;inset:0;')} />
              <span style={css('position:absolute;inset:0;background:linear-gradient(180deg,rgba(30,8,18,0) 38%,rgba(30,8,18,.78) 100%);')} />
              <span style={css('position:absolute;left:14px;right:14px;bottom:14px;color:#fff;')}>
                <span style={css('display:flex;align-items:center;gap:6px;')}>
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;color:#F4D9A6;")}>{c.icon}</span>
                  <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:19px;line-height:1.1;")}>{c.name}</span>
                </span>
                <span style={css('display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;font-weight:600;opacity:.92;')}>
                  <span>{c.count} {c.count === 1 ? 'piece' : 'pieces'}</span>
                  <span style={css('width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.6;')} />
                  <span>from {fmt(c.from)}</span>
                </span>
              </span>
            </div>
          </Link>
        ))}
      </div>

      {/* ── Occasion ─────────────────────────────────────────────────────── */}
      {occasions.length > 0 && (
        <>
          <SectionLabel icon="celebration" title="Shop by occasion" note="what are you dressing for?" />
          <div className="agx-occ-grid">
            {occasions.map((o) => (
              <Link
                key={o.name}
                to={routes.occasion(o.name)}
                className="agx-lift"
                style={css(`display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;border:1px solid var(--ag-surface-3);background:var(--ag-surface);border-radius:18px;cursor:pointer;text-align:left;text-decoration:none;color:inherit;font-family:inherit;box-shadow:0 14px 32px -28px rgba(107,20,54,.6);`)}
              >
                <span style={css(`position:relative;width:44px;height:44px;flex:none;border-radius:14px;overflow:hidden;background:${o.toneHex};display:flex;align-items:center;justify-content:center;`)}>
                  {o.image ? (
                    <ImageSlot src={o.image} placeholder={o.name} sizes="44px" style={css('position:absolute;inset:0;')} />
                  ) : (
                    <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:22px;color:var(--ag-deep);")}>{o.icon}</span>
                  )}
                </span>
                <span style={css('min-width:0;flex:1;')}>
                  <span style={css('display:block;font-size:14.5px;font-weight:800;color:var(--ag-ink);')}>{o.name}</span>
                  <span style={css('display:block;font-size:12px;color:var(--ag-muted);margin-top:2px;')}>{o.count} {o.count === 1 ? 'piece' : 'pieces'}</span>
                </span>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;color:#D8BFCA;flex:none;")}>chevron_right</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ── Budget ───────────────────────────────────────────────────────────
          A ladder rather than bands: someone with ₹3,000 wants everything they
          can afford, not only the things that cost close to it. */}
      {budgets.length > 0 && (
        <>
          <SectionLabel icon="savings" title="Shop by budget" note="everything you can afford" />
          <div className="agx-occ-grid">
            {budgets.map((b) => (
              <button
                key={b.maxPrice}
                onClick={() => open({ maxPrice: b.maxPrice })}
                className="agx-lift"
                style={css('display:flex;align-items:center;gap:12px;width:100%;padding:16px;border:1px solid var(--ag-surface-3);background:linear-gradient(140deg,var(--ag-surface),var(--ag-surface-2));border-radius:18px;cursor:pointer;text-align:left;font-family:inherit;box-shadow:0 14px 32px -28px rgba(107,20,54,.6);')}
              >
                <span style={css('min-width:0;flex:1;')}>
                  <span style={css("display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:20px;color:var(--ag-crimson);line-height:1.1;")}>{b.label}</span>
                  <span style={css('display:block;font-size:12px;color:var(--ag-muted);margin-top:4px;')}>{b.count} {b.count === 1 ? 'piece' : 'pieces'}</span>
                </span>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;color:#D8BFCA;flex:none;")}>arrow_forward</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Colour ───────────────────────────────────────────────────────── */}
      {colours.length > 0 && (
        <>
          <SectionLabel icon="palette" title="Shop by colour" />
          <div className="agx-scroll" style={css('display:flex;gap:14px;overflow-x:auto;padding:2px 0 8px;')}>
            {colours.map((c) => (
              <button
                key={c.name}
                onClick={() => open({ colors: [c.name] })}
                className="agx-circle"
                style={css('flex:none;display:flex;flex-direction:column;align-items:center;gap:9px;padding:0;border:none;background:none;cursor:pointer;width:78px;')}
              >
                <span className="agx-circle-ring" style={css(`display:block;width:62px;height:62px;border-radius:50%;background:${c.hex};box-shadow:0 12px 26px -14px ${c.hex};border:3px solid #fff;`)} />
                <span style={css('font-size:12.5px;font-weight:800;color:var(--ag-ink-2);')}>{c.name}</span>
                <span style={css("font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--ag-muted-soft);margin-top:-5px;")}>{c.count}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Fabric ───────────────────────────────────────────────────────── */}
      {fabrics.length > 0 && (
        <>
          <SectionLabel icon="texture" title="Shop by fabric" note="for the ones who ask first" />
          {/* Fabric used to have no facet in the filter model, so a tile ran a
              free-text search and landed on the shared grid. Each fabric now has
              its own indexable landing page, so the chip is a real link. */}
          <div style={css('display:flex;flex-wrap:wrap;gap:9px;')}>
            {fabrics.map((f) => (
              <Link
                key={f.name}
                to={routes.fabric(f.name)}
                style={css('display:flex;align-items:center;gap:7px;border:1px solid var(--ag-border-soft);background:var(--ag-surface);color:var(--ag-ink-3);cursor:pointer;padding:10px 16px;border-radius:999px;font-size:13px;font-weight:700;font-family:inherit;text-decoration:none;')}
              >
                {f.name}
                <span style={css("font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ag-muted-soft);")}>{f.count}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <SiteFooter />
    </div>
  );
}
