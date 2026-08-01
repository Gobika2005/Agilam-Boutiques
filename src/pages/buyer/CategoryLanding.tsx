import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { CardLink } from '@/components/buyer/CardLink';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { WishButton } from '@/components/buyer/WishButton';
import { EmptyState, CardSkeletons, SectionLabel } from '@/components/buyer/DiscoveryPage';
import { SiteFooter } from '@/components/buyer/SiteFooter';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { useTaxonomy } from '@/state/TaxonomyContext';
import { TONES, fmt } from '@/data/demo';
import { compactCount } from '@/lib/ranking';
import { routes, slugify, clampDescription } from '@/lib/seo';
import {
  breadcrumbSchema,
  collectionSchema,
  faqSchema,
  graph,
  organizationSchema,
} from '@/lib/schema';
import type { Product } from '@/data/demo';

/**
 * A landing page per browsable term — `/collections/sarees`,
 * `/occasions/bridal`, `/fabrics/kanchipuram-silk`.
 *
 * These pages did not exist. Every tile on the Collections screen called
 * `setFilters()` and pushed the buyer to one shared results URL, so
 * the filter lived in React state: it could not be shared, could not be
 * bookmarked, did not survive a refresh, and — the expensive part — gave search
 * engines a single address for the entire catalogue. The forty-odd commercial
 * queries this marketplace should own ("silk sarees online Coimbatore",
 * "bridal lehenga Tamil Nadu") had nowhere to land.
 *
 * Each term now has a real URL with its own title, description, canonical,
 * heading, editorial intro, breadcrumb and `CollectionPage`/`ItemList` schema.
 * The vocabulary is the admin's (migration 0024), so a category approved this
 * morning is an indexable page this afternoon with no code change — and a term
 * with nothing listed under it renders an honest empty state rather than a thin
 * page Google would treat as low quality.
 */

export type LandingKind = 'category' | 'occasion' | 'fabric';

/** Which product field a kind filters on. */
const FIELD: Record<LandingKind, (p: Product) => string> = {
  category: (p) => p.cat,
  occasion: (p) => p.occasion,
  fabric: (p) => p.fabric,
};

const LABEL: Record<LandingKind, string> = {
  category: 'Category',
  occasion: 'Occasion',
  fabric: 'Fabric',
};

const HUB: Record<LandingKind, { name: string; path: string }> = {
  category: { name: 'Collections', path: '/collections' },
  occasion: { name: 'Occasions', path: '/collections' },
  fabric: { name: 'Fabrics', path: '/collections' },
};

const ROUTE_FOR: Record<LandingKind, (name: string) => string> = {
  category: routes.category,
  occasion: routes.occasion,
  fabric: routes.fabric,
};

/* ── Copy ────────────────────────────────────────────────────────────────── */

/**
 * The editorial paragraph under the heading.
 *
 * Written from the live catalogue rather than stored per term, so it is always
 * true and never goes stale: how many pieces, from how many boutiques, in which
 * towns, from what price. That is genuinely useful to a shopper *and* it is the
 * unique, substantive on-page text that stops forty landing pages reading as
 * forty copies of each other — which is what gets a category tree filtered out
 * as thin content.
 */
function introFor(kind: LandingKind, term: string, items: Product[]): string {
  if (!items.length) return '';
  const count = items.length;
  const shops = new Set(items.map((p) => p.boutique)).size;
  const cities = Array.from(new Set(items.map((p) => p.city).filter(Boolean)));
  const from = Math.min(...items.map((p) => p.price));
  const piece = count === 1 ? 'piece' : 'pieces';
  const where =
    cities.length === 0
      ? 'Tamil Nadu'
      : cities.length <= 3
        ? cities.join(', ')
        : `${cities.slice(0, 3).join(', ')} and ${cities.length - 3} more towns`;

  const opener: Record<LandingKind, string> = {
    category: `${count} ${term.toLowerCase()} ${piece} from ${shops} verified ${shops === 1 ? 'boutique' : 'boutiques'} across ${where}, from ${fmt(from)}.`,
    occasion: `${count} ${piece} picked for ${term.toLowerCase()}, listed by ${shops} verified ${shops === 1 ? 'boutique' : 'boutiques'} in ${where}, from ${fmt(from)}.`,
    fabric: `${count} ${term.toLowerCase()} ${piece} from ${shops} verified ${shops === 1 ? 'boutique' : 'boutiques'} across ${where}, from ${fmt(from)}.`,
  };

  return `${opener[kind]} Every shop on MangaiMart is verified before it can list, you can message the owner directly before you buy, and delivery is across India with cash on delivery available.`;
}

/** Questions a shopper actually types, answered on the page and in FAQ schema. */
function faqsFor(kind: LandingKind, term: string, items: Product[]): { q: string; a: string }[] {
  if (items.length < 3) return [];
  const from = Math.min(...items.map((p) => p.price));
  const to = Math.max(...items.map((p) => p.price));
  const cities = Array.from(new Set(items.map((p) => p.city).filter(Boolean))).slice(0, 4);
  const lower = term.toLowerCase();
  const noun = kind === 'occasion' ? `${lower} wear` : lower;

  return [
    {
      q: `How much does ${noun} cost on MangaiMart?`,
      a: `${noun.charAt(0).toUpperCase() + noun.slice(1)} on MangaiMart ranges from ${fmt(from)} to ${fmt(to)}. Prices are set by each boutique directly, so you pay the shop's own price with no markup.`,
    },
    {
      q: `Which boutiques sell ${noun}?`,
      a: `${new Set(items.map((p) => p.boutique)).size} verified boutiques currently list ${noun}${cities.length ? `, based in ${cities.join(', ')}` : ''}. Every one is checked and approved before it can list, and you can see its ratings and reviews on its profile.`,
    },
    {
      q: `Can I return ${noun} if it doesn't fit?`,
      a: `Yes. Every order is covered by a 7-day return window from delivery, and refunds are processed in 5–7 working days. Check the size guide on the product page, or message the boutique before ordering if you're unsure.`,
    },
    {
      q: `Do you deliver ${noun} outside Tamil Nadu?`,
      a: `Yes — MangaiMart delivers across India. Standard delivery takes 3–7 working days, 2–4 in metros, and cash on delivery is available on eligible orders.`,
    },
  ];
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function CategoryLanding({ kind }: { kind: LandingKind }) {
  const { slug } = useParams();
  const { products: PRODUCTS, boutiques: BOUTIQUES, loading } = useCatalog();
  const { wishlist, toggleWish } = useShop();
  const vocab = useTaxonomy();

  const pick = FIELD[kind];

  /**
   * Resolve the URL slug back to the admin's canonical term. Matching on the
   * slug rather than the raw name is what lets `/collections/kurta-sets` find
   * "Kurta Sets" — and what keeps the URL stable if the display name is later
   * recased.
   */
  const term = useMemo(() => {
    const wanted = (slug || '').toLowerCase();
    const fromVocab = vocab.rows(kind).find((r) => slugify(r.name) === wanted);
    if (fromVocab) return fromVocab.name;
    // A term the vocabulary hasn't loaded yet (or a legacy value only the
    // catalogue knows about) still resolves, so the page never 404s a URL that
    // has products behind it.
    return PRODUCTS.map(pick).find((v) => v && slugify(v) === wanted) ?? null;
  }, [slug, kind, vocab, PRODUCTS, pick]);

  const items = useMemo(
    () => (term ? PRODUCTS.filter((p) => slugify(pick(p) || '') === slugify(term)) : []),
    [PRODUCTS, term, pick],
  );

  /** The other terms of the same kind — the lateral links that spread crawl. */
  const siblings = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of PRODUCTS) {
      const v = pick(p);
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([name]) => slugify(name) !== slugify(term || ''))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
  }, [PRODUCTS, term, pick]);

  /** Boutiques that actually stock this term — product → shop internal links. */
  const shops = useMemo(() => {
    const names = new Set(items.map((p) => p.boutique));
    return BOUTIQUES.filter((b) => names.has(b.name)).slice(0, 8);
  }, [items, BOUTIQUES]);

  const path = term ? ROUTE_FOR[kind](term) : `/${kind}/${slug}`;
  const intro = introFor(kind, term || '', items);
  const faqs = faqsFor(kind, term || '', items);
  const hub = HUB[kind];

  const heading = kind === 'occasion' ? `${term} wear` : String(term);
  const title = term
    ? kind === 'occasion'
      ? `${term} Wear Online — ${items.length} Pieces from Tamil Nadu Boutiques`
      : `${term} Online — Buy from ${new Set(items.map((p) => p.boutique)).size} Verified Tamil Nadu Boutiques`
    : null;

  usePageMeta({
    title,
    description: term ? clampDescription(intro || `Shop ${term} on MangaiMart.`) : null,
    canonical: path,
    image: items[0]?.image ?? null,
    // Nothing listed under this term yet: a real page, but not one worth
    // indexing until it has stock behind it.
    noindex: !loading && items.length === 0,
    schema: term && items.length
      ? graph(
          organizationSchema(),
          collectionSchema({
            name: heading,
            description: intro,
            path,
            items,
          }),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: hub.name, path: hub.path },
            { name: heading, path },
          ]),
          faqs.length ? faqSchema(faqs) : null,
        )
      : null,
  });

  if (loading && !items.length) {
    return (
      <div style={css('min-height:100%;background:var(--ag-bg);padding:16px 0 24px;')}>
        <div className="agx-coll-grid"><CardSkeletons count={8} /></div>
      </div>
    );
  }

  if (!term || items.length === 0) {
    return (
      <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(26px,3.2vw,40px);margin:20px 2px 0;")}>
          Nothing listed under “{slug?.replace(/-/g, ' ')}” yet
        </h1>
        <EmptyState
          icon="storefront"
          title="No pieces here right now"
          body="Boutiques are onboarding all the time and new pieces land every week. Browse everything else in the meantime."
          action={
            <Link to={routes.collections()} style={css('display:inline-flex;align-items:center;min-height:44px;padding:0 22px;border-radius:12px;background:#B02454;color:#fff;font-weight:800;text-decoration:none;')}>
              Shop by collection
            </Link>
          }
        />
        <SiteFooter />
      </div>
    );
  }

  const cheapest = Math.min(...items.map((p) => p.price));

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
      {/* ── Breadcrumb ─────────────────────────────────────────────────── */}
      <nav aria-label="Breadcrumb" style={css('padding:2px 2px 0;')}>
        <ol style={css('display:flex;align-items:center;flex-wrap:wrap;gap:6px;list-style:none;margin:0;padding:0;font-size:12.5px;color:var(--ag-muted-soft);font-weight:600;')}>
          <li><Link to={routes.home()} style={css('color:var(--ag-crimson);text-decoration:none;')}>Home</Link></li>
          <li aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;")}>chevron_right</li>
          <li><Link to={hub.path} style={css('color:var(--ag-crimson);text-decoration:none;')}>{hub.name}</Link></li>
          <li aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;")}>chevron_right</li>
          <li aria-current="page" style={css('color:var(--ag-muted);')}>{heading}</li>
        </ol>
      </nav>

      {/* ── Heading + intro ────────────────────────────────────────────── */}
      <header style={css('margin-top:14px;')}>
        <p className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);margin:0;')}>
          {LABEL[kind]} · Tamil Nadu boutiques
        </p>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(28px,3.4vw,44px);line-height:1.08;margin:6px 0 0;letter-spacing:-.015em;text-wrap:balance;")}>
          {heading}
        </h1>
        <p style={css('color:var(--ag-muted);font-size:14.5px;line-height:1.65;max-width:660px;margin:12px 0 0;')}>
          {intro}
        </p>
        <p style={css("font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ag-muted-soft);letter-spacing:.04em;margin:10px 0 0;")}>
          {items.length} {items.length === 1 ? 'piece' : 'pieces'} · from {fmt(cheapest)}
        </p>
      </header>

      {/* ── The grid ───────────────────────────────────────────────────── */}
      <h2 className="agx-sr-only">All {heading.toLowerCase()}</h2>
      <div className="agx-coll-grid" style={css('margin-top:22px;')}>
        {items.map((p) => (
          <CardLink key={p.id} to={routes.product(p)} label={p.title} className="agx-lift agx-reveal">
            <div className="agx-prod-media agx-zoom" style={css(`background:${TONES[p.tone]};`)}>
              <ImageSlot src={p.image} alt={`${p.title} — ${p.cat} from ${p.boutique}, ${p.city}`} placeholder={p.title} className="agx-prod-fill" />
              <WishButton
                wished={!!wishlist[p.id]}
                title={p.title}
                onToggle={(e) => { e.preventDefault(); e.stopPropagation(); toggleWish(p.id); }}
                className="agx-card-wish"
              />
              {p.stock === 0 && (
                <div style={css('position:absolute;inset:0;background:rgba(36,16,25,.42);display:flex;align-items:center;justify-content:center;')}>
                  <span style={css('background:rgba(255,255,255,.95);color:var(--ag-deep);border-radius:999px;padding:7px 14px;font-size:12px;font-weight:800;')}>Sold out</span>
                </div>
              )}
            </div>
            <div style={css('padding:12px 2px 0;')}>
              <div className="agx-card-title" style={css('font-size:14.5px;font-weight:700;')}>{p.title}</div>
              <div style={css('font-size:12.5px;color:var(--ag-muted);margin-top:2px;')}>{p.boutique} · {p.city}</div>
              <div style={css('display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;')}>
                <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:19px;")}>{fmt(p.price)}</span>
                {p.reviews > 0 && (
                  <span style={css('display:flex;align-items:center;gap:3px;font-size:12px;font-weight:700;color:var(--ag-ink-2);')}>
                    <span style={css("font-family:'Material Symbols Outlined';font-size:15px;color:var(--ag-star);")} aria-hidden="true">star</span>
                    {p.rating}
                    <span style={css('color:var(--ag-muted-soft);font-weight:600;')}>({compactCount(p.reviews)})</span>
                  </span>
                )}
              </div>
            </div>
          </CardLink>
        ))}
      </div>

      {/* ── Boutiques stocking it — product ↔ shop internal links ──────── */}
      {shops.length > 0 && (
        <section>
          <SectionLabel icon="storefront" title={`Boutiques selling ${heading.toLowerCase()}`} note={`${shops.length} shops`} />
          <div style={css('display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;')}>
            {shops.map((b) => (
              <Link
                key={b.id}
                to={routes.boutique(b)}
                className="agx-lift"
                style={css('display:flex;align-items:center;gap:11px;padding:13px;border:1.5px solid var(--ag-border);border-radius:16px;background:var(--ag-surface);color:inherit;text-decoration:none;min-height:44px;')}
              >
                <span style={css("font-family:'Material Symbols Outlined';font-size:22px;color:var(--ag-crimson);flex:none;")} aria-hidden="true">storefront</span>
                <span style={css('min-width:0;')}>
                  <span style={css('display:block;font-weight:800;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{b.name}</span>
                  <span style={css('display:block;color:var(--ag-muted);font-size:11.5px;margin-top:1px;')}>{b.city}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Sibling terms — lateral crawl paths ────────────────────────── */}
      {siblings.length > 0 && (
        <section>
          <SectionLabel icon="grid_view" title={`More ${kind === 'category' ? 'categories' : kind === 'occasion' ? 'occasions' : 'fabrics'}`} />
          <div style={css('display:flex;flex-wrap:wrap;gap:8px;')}>
            {siblings.map(([name, n]) => (
              <Link
                key={name}
                to={ROUTE_FOR[kind](name)}
                style={css('display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:0 15px;border:1.5px solid var(--ag-border);border-radius:999px;background:var(--ag-surface);color:var(--ag-ink);text-decoration:none;font-size:13px;font-weight:700;')}
              >
                {name}
                <span style={css("font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--ag-muted-soft);")}>{n}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── FAQ — on the page and in FAQPage schema ────────────────────── */}
      {faqs.length > 0 && (
        <section>
          <SectionLabel icon="help" title={`${heading} — common questions`} />
          <div style={css('display:grid;gap:10px;')}>
            {faqs.map((f) => (
              <details key={f.q} style={css('border:1.5px solid var(--ag-border);border-radius:16px;background:var(--ag-surface);padding:14px 16px;')}>
                <summary style={css('cursor:pointer;font-weight:800;font-size:14px;color:var(--ag-ink);list-style:none;min-height:24px;')}>
                  <h3 style={css('display:inline;font-size:14px;font-weight:800;margin:0;')}>{f.q}</h3>
                </summary>
                <p style={css('color:var(--ag-muted);font-size:13.5px;line-height:1.65;margin:10px 0 0;')}>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <SiteFooter />
    </div>
  );
}
