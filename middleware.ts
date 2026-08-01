/**
 * Vercel Edge Middleware — the layer that makes MangaiMart legible to anything
 * that does not run JavaScript.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * The app is a client-rendered SPA behind a catch-all rewrite, so every URL on
 * the domain returned the same static `index.html`: an empty `<div id="root">`
 * and one hardcoded `<title>MangaiMart</title>`. Googlebot renders JavaScript
 * and could eventually see past that, but nothing else does — Bingbot, GPTBot,
 * PerplexityBot, and (the one that costs real money) the WhatsApp, Facebook and
 * Twitter link-preview crawlers. A product link shared to WhatsApp previewed as
 * the bare word "MangaiMart" with no picture and no price, which
 * `src/lib/share.ts` documents and works around by attaching the photo to the
 * share sheet — a fix that helps in-app sharing and does nothing for a link
 * pasted into a browser or a search result.
 *
 * This runs before the static file is served and rewrites the `<head>` of the
 * HTML with the real title, description, canonical, Open Graph, Twitter card
 * and JSON-LD for whatever URL was asked for. It also serves `robots.txt` and a
 * live `sitemap.xml` built from the database.
 *
 * ── Why the edge and not a serverless function ───────────────────────────
 * `api/` already holds exactly 12 functions, which is the Vercel Hobby ceiling.
 * Middleware is counted separately, so this adds the capability without
 * displacing checkout, payouts or the admin endpoints.
 *
 * ── This is not cloaking ─────────────────────────────────────────────────
 * Every visitor gets identical HTML — there is no user-agent branching in the
 * injection path. The React app then hydrates over it and `usePageMeta` keeps
 * the same tags in step across client-side navigations.
 *
 * ── Fail-open, always ────────────────────────────────────────────────────
 * Every path through this file is wrapped so that any failure — Supabase down,
 * a malformed row, a fetch timeout — falls through to the unmodified response.
 * A metadata problem must never be able to take the shop offline.
 */

export const config = {
  /**
   * Skip anything that is not an HTML page request.
   *
   * `index.html` is excluded specifically: the injector fetches it to get the
   * shell, and matching it here would make that fetch re-enter the middleware.
   */
  matcher: ['/((?!api/|assets/|_vercel|index\\.html|.*\\.[a-zA-Z0-9]+$).*)', '/robots.txt', '/sitemap.xml'],
};

/* ── Configuration ──────────────────────────────────────────────────────── */

const SITE_NAME = 'MangaiMart';
const DEFAULT_DESCRIPTION =
  'Shop verified Tamil Nadu boutiques in one place — sarees, kurta sets, kurtis and more, with direct chat to the shop.';
const DEFAULT_OG_IMAGE = '/mangaimart-logo.png';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

/** How long the edge may reuse a rendered head before asking the DB again. */
const PAGE_CACHE_SECONDS = 300;
const SITEMAP_CACHE_SECONDS = 3600;

/** A slow database must not hold up the page. Past this, serve the shell. */
const DB_TIMEOUT_MS = 1500;

/**
 * Paths that must never be indexed. Mirrors `NOINDEX_PREFIXES` in
 * `src/lib/seo.ts`; the two are deliberately duplicated because this file runs
 * on the edge runtime and cannot import from the app bundle. Change both.
 */
const NOINDEX_PREFIXES = [
  '/admin', '/seller', '/auth', '/cart', '/checkout', '/payment',
  '/order-confirmation', '/orders', '/profile', '/wishlist', '/messages',
  '/chat', '/notifications', '/coupons', '/search', '/buyer',
];

/* ── Small helpers ──────────────────────────────────────────────────────── */

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Mirrors `slugify` in `src/lib/seo.ts`. */
function slugify(input: string, maxLength = 60): string {
  return (input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

function productPath(row: { id: string; title: string }): string {
  const base = slugify(row.title);
  const suffix = row.id.replace(/-/g, '').slice(0, 8);
  return `/products/${base ? `${base}-${suffix}` : suffix}`;
}

/** Mirrors `productIdFromSlug` in `src/lib/seo.ts`. */
function idFromSlug(slug: string): string | null {
  if (!slug) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)) return slug;
  const m = slug.match(/-([0-9a-f]{6,})$/i);
  return m ? m[1].toLowerCase() : null;
}

function clamp(text: string, max = 158): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.,;:\s]+$/, '')}…`;
}

const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;

function isNoIndex(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return NOINDEX_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/* ── Supabase (REST, no SDK — the edge runtime keeps this tiny) ─────────── */

async function db<T>(path: string): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DB_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch {
    // Timeout, network error, malformed JSON — all mean "serve the shell".
    return [];
  } finally {
    clearTimeout(timer);
  }
}

type ProductRow = {
  id: string;
  title: string;
  description: string | null;
  occasion: string | null;
  price: number;
  mrp: number | null;
  stock: number;
  category: string | null;
  color: string | null;
  fabric: string | null;
  image_url: string | null;
  rating: number | null;
  reviews_count: number | null;
  created_at?: string | null;
  boutiques?: { name: string; slug: string; city: string } | null;
};

type BoutiqueRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  area: string | null;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  phone: string | null;
  rating: number | null;
  reviews_count: number | null;
  created_at?: string | null;
};

const PRODUCT_COLUMNS =
  'id,title,description,price,mrp,stock,category,occasion,color,fabric,image_url,rating,reviews_count,created_at,boutiques(name,slug,city)';
const BOUTIQUE_COLUMNS =
  'id,name,slug,city,area,description,logo_url,cover_url,phone,rating,reviews_count,created_at';

/* ── Per-route metadata ─────────────────────────────────────────────────── */

type Meta = {
  title: string;
  description: string;
  image?: string;
  type: 'website' | 'product' | 'profile' | 'article';
  schema?: unknown;
  /** Where this URL should have been — issued as a 301 before rendering. */
  redirectTo?: string;
};

function orgNode(origin: string) {
  return {
    '@type': 'Organization',
    '@id': `${origin}/#organization`,
    name: SITE_NAME,
    url: origin,
    logo: `${origin}${DEFAULT_OG_IMAGE}`,
    description: DEFAULT_DESCRIPTION,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Coimbatore',
      addressRegion: 'Tamil Nadu',
      addressCountry: 'IN',
    },
  };
}

async function metaForProduct(slug: string, origin: string): Promise<Meta | null> {
  const id = idFromSlug(slug);
  if (!id) return null;

  // The URL carries an 8-char prefix, so match on a prefix rather than equality.
  const rows = await db<ProductRow>(
    `products?select=${PRODUCT_COLUMNS}&status=eq.active&deleted_at=is.null&limit=1&or=(id.eq.${id},id.like.${id.slice(0, 8)}*)`,
  );
  const p = rows[0];
  if (!p) return null;

  const shop = p.boutiques?.name || SITE_NAME;
  const city = p.boutiques?.city || 'Tamil Nadu';
  const canonicalPath = productPath(p);
  const url = `${origin}${canonicalPath}`;
  const inStock = (p.stock ?? 0) > 0;

  return {
    title: `${p.title} — ${shop}`,
    description: clamp(
      p.description?.trim() ||
        `${p.title} from ${shop}, ${city}. ${inr(p.price)}${p.fabric ? ` · ${p.fabric}` : ''}${p.color ? ` · ${p.color}` : ''}. ${inStock ? 'In stock, 7-day returns, cash on delivery available.' : 'Currently sold out.'}`,
    ),
    image: p.image_url || undefined,
    type: 'product',
    // A bare id, or a stale title slug, is rewritten to the canonical URL.
    redirectTo: `/products/${slug}` !== canonicalPath ? canonicalPath : undefined,
    schema: {
      '@context': 'https://schema.org',
      '@graph': [
        orgNode(origin),
        {
          '@type': 'Product',
          '@id': `${url}#product`,
          name: p.title,
          url,
          image: p.image_url ? [p.image_url] : undefined,
          description: p.description?.trim() || `${p.title} from ${shop}, ${city}.`,
          sku: p.id,
          category: p.category || undefined,
          color: p.color || undefined,
          material: p.fabric || undefined,
          brand: { '@type': 'Brand', name: shop },
          offers: {
            '@type': 'Offer',
            url,
            price: p.price,
            priceCurrency: 'INR',
            availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            itemCondition: 'https://schema.org/NewCondition',
            seller: { '@type': 'Organization', name: shop },
          },
          // Only when a rating is real — a fabricated one is a manual-action risk.
          aggregateRating:
            (p.reviews_count ?? 0) > 0 && (p.rating ?? 0) > 0
              ? {
                  '@type': 'AggregateRating',
                  ratingValue: Number(p.rating),
                  reviewCount: p.reviews_count,
                  bestRating: 5,
                  worstRating: 1,
                }
              : undefined,
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
            { '@type': 'ListItem', position: 2, name: 'Collections', item: `${origin}/collections` },
            ...(p.category
              ? [{ '@type': 'ListItem', position: 3, name: p.category, item: `${origin}/collections/${slugify(p.category)}` }]
              : []),
            { '@type': 'ListItem', position: p.category ? 4 : 3, name: p.title },
          ],
        },
      ],
    },
  };
}

async function metaForBoutique(slug: string, origin: string): Promise<Meta | null> {
  const rows = await db<BoutiqueRow>(
    `boutiques?select=${BOUTIQUE_COLUMNS}&status=eq.approved&limit=1&or=(slug.eq.${slug},id.eq.${slug})`,
  );
  const b = rows[0];
  if (!b) return null;

  const url = `${origin}/boutique/${b.slug}`;
  return {
    title: `${b.name} — Boutique in ${b.city || 'Tamil Nadu'}`,
    description: clamp(
      b.description?.trim() ||
        `Shop ${b.name}, a verified boutique in ${b.city || 'Tamil Nadu'}. Chat directly with the owner and get delivery across India.`,
    ),
    image: b.logo_url || b.cover_url || undefined,
    type: 'profile',
    redirectTo: slug !== b.slug ? `/boutique/${b.slug}` : undefined,
    schema: {
      '@context': 'https://schema.org',
      '@graph': [
        orgNode(origin),
        {
          '@type': 'ClothingStore',
          '@id': `${url}#boutique`,
          name: b.name,
          url,
          image: b.cover_url || b.logo_url || undefined,
          description: b.description?.trim() || `${b.name} is a verified boutique in ${b.city || 'Tamil Nadu'}.`,
          telephone: b.phone || undefined,
          address: {
            '@type': 'PostalAddress',
            streetAddress: b.area || undefined,
            addressLocality: b.city || undefined,
            addressRegion: 'Tamil Nadu',
            addressCountry: 'IN',
          },
          currenciesAccepted: 'INR',
          parentOrganization: { '@id': `${origin}/#organization` },
          aggregateRating:
            (b.reviews_count ?? 0) > 0 && (b.rating ?? 0) > 0
              ? {
                  '@type': 'AggregateRating',
                  ratingValue: Number(b.rating),
                  reviewCount: b.reviews_count,
                  bestRating: 5,
                  worstRating: 1,
                }
              : undefined,
        },
      ],
    },
  };
}

/** Static pages — no database round-trip, so these cost nothing. */
const STATIC_META: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Boutique Ethnic Wear from Tamil Nadu — Sarees, Kurta Sets & More',
    description:
      'Shop verified Tamil Nadu boutiques in one place. Sarees, kurta sets, kurtis and lehengas from independent shops, with direct chat to the owner and delivery across India.',
  },
  '/collections': {
    title: 'Shop by Collection — Sarees, Kurta Sets & Ethnic Wear',
    description: 'Browse every category, occasion, fabric, budget and colour Tamil Nadu boutiques are listing on MangaiMart right now.',
  },
  '/shop': {
    title: 'Shop All — Ethnic Wear from Verified Tamil Nadu Boutiques',
    description: 'Every piece listed by verified Tamil Nadu boutiques on MangaiMart. Filter by category, occasion, colour, size and budget.',
  },
  '/boutiques': {
    title: 'Boutiques in Tamil Nadu — Verified Ethnic Wear Shops',
    description: 'Browse every verified boutique on MangaiMart by city, rating and speciality. Independent shops across Tamil Nadu, each checked before it can list.',
  },
  '/new-arrivals': {
    title: 'New Arrivals — Latest Ethnic Wear from Tamil Nadu Boutiques',
    description: 'Every piece MangaiMart boutiques have listed in the last 30 days, newest first.',
  },
  '/best-sellers': {
    title: 'Best Sellers — Most-Bought Ethnic Wear on MangaiMart',
    description: 'The pieces MangaiMart buyers are actually taking home, ranked by units sold and how well they are rated.',
  },
  '/top-boutiques': {
    title: 'Best-Selling Boutiques in Tamil Nadu — Top Rated Shops',
    description: 'The Tamil Nadu boutiques moving the most pieces, weighed against how well they are rated by real buyers.',
  },
  '/inspire': {
    title: 'Inspire — New Pieces from Tamil Nadu Boutiques',
    description: 'A live feed of what MangaiMart boutiques are listing right now.',
  },
};

async function metaForCategory(kind: 'category' | 'occasion' | 'fabric', slug: string, origin: string): Promise<Meta | null> {
  const rows = await db<ProductRow>(
    `products?select=${PRODUCT_COLUMNS}&status=eq.active&deleted_at=is.null&limit=40`,
  );
  const items = rows.filter((p) => {
    const value = kind === 'category' ? p.category : kind === 'occasion' ? p.occasion : p.fabric;
    return value && slugify(value) === slug;
  });
  if (!items.length) return null;

  const term = (kind === 'category' ? items[0].category : kind === 'occasion' ? items[0].occasion : items[0].fabric) || slug;
  const heading = kind === 'occasion' ? `${term} wear` : term;
  const shops = new Set(items.map((p) => p.boutiques?.name).filter(Boolean)).size;
  const from = Math.min(...items.map((p) => p.price));
  const path = `/${kind === 'category' ? 'collections' : kind === 'occasion' ? 'occasions' : 'fabrics'}/${slug}`;
  const url = `${origin}${path}`;

  const description = clamp(
    `${items.length} ${heading.toLowerCase()} ${items.length === 1 ? 'piece' : 'pieces'} from ${shops} verified ${shops === 1 ? 'boutique' : 'boutiques'} in Tamil Nadu, from ${inr(from)}. Direct chat with the shop, 7-day returns, delivery across India.`,
  );

  return {
    title: `${heading} Online — Buy from Verified Tamil Nadu Boutiques`,
    description,
    image: items.find((p) => p.image_url)?.image_url || undefined,
    type: 'website',
    schema: {
      '@context': 'https://schema.org',
      '@graph': [
        orgNode(origin),
        {
          '@type': 'CollectionPage',
          '@id': `${url}#collection`,
          name: heading,
          description,
          url,
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: items.length,
            itemListElement: items.slice(0, 30).map((p, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              url: `${origin}${productPath(p)}`,
              name: p.title,
            })),
          },
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
            { '@type': 'ListItem', position: 2, name: 'Collections', item: `${origin}/collections` },
            { '@type': 'ListItem', position: 3, name: heading },
          ],
        },
      ],
    },
  };
}

async function resolveMeta(pathname: string, origin: string): Promise<Meta | null> {
  const staticMeta = STATIC_META[pathname];
  if (staticMeta) {
    return {
      ...staticMeta,
      type: 'website',
      schema: {
        '@context': 'https://schema.org',
        '@graph': [
          orgNode(origin),
          {
            '@type': 'WebSite',
            '@id': `${origin}/#website`,
            url: origin,
            name: SITE_NAME,
            inLanguage: 'en-IN',
            potentialAction: {
              '@type': 'SearchAction',
              target: { '@type': 'EntryPoint', urlTemplate: `${origin}/search?q={search_term_string}` },
              'query-input': 'required name=search_term_string',
            },
          },
        ],
      },
    };
  }

  const product = pathname.match(/^\/products\/([^/]+)$/);
  if (product) return metaForProduct(decodeURIComponent(product[1]), origin);

  const boutique = pathname.match(/^\/boutique\/([^/]+)$/);
  if (boutique) return metaForBoutique(decodeURIComponent(boutique[1]), origin);

  const category = pathname.match(/^\/collections\/([^/]+)$/);
  if (category) return metaForCategory('category', decodeURIComponent(category[1]), origin);

  const occasion = pathname.match(/^\/occasions\/([^/]+)$/);
  if (occasion) return metaForCategory('occasion', decodeURIComponent(occasion[1]), origin);

  const fabric = pathname.match(/^\/fabrics\/([^/]+)$/);
  if (fabric) return metaForCategory('fabric', decodeURIComponent(fabric[1]), origin);

  return null;
}

/* ── HTML injection ─────────────────────────────────────────────────────── */

function headFor(meta: Meta | null, canonical: string, origin: string, pathname: string): string {
  const title = meta ? `${meta.title} · ${SITE_NAME}` : SITE_NAME;
  const description = meta?.description || DEFAULT_DESCRIPTION;
  const image = meta?.image
    ? meta.image.startsWith('http') ? meta.image : `${origin}${meta.image}`
    : `${origin}${DEFAULT_OG_IMAGE}`;
  const robots = isNoIndex(pathname)
    ? 'noindex, nofollow'
    : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

  const tags = [
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="en_IN" />`,
    `<meta property="og:type" content="${meta?.type || 'website'}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(meta?.title || SITE_NAME)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<meta name="geo.region" content="IN-TN" />`,
    `<meta name="geo.placename" content="Tamil Nadu, India" />`,
  ];

  if (meta?.schema) {
    // `<` is escaped so a product title containing markup cannot break out.
    tags.push(
      `<script type="application/ld+json" data-edge-schema>${JSON.stringify(meta.schema).replace(/</g, '\\u003c')}</script>`,
    );
  }

  return `<title>${escapeHtml(title)}</title>\n${tags.join('\n')}`;
}

/* ── robots.txt ─────────────────────────────────────────────────────────── */

function robotsTxt(origin: string): string {
  return `# MangaiMart — ${origin}
#
# The storefront is public and should be crawled. Anything private to one buyer,
# part of a checkout, or an operator console is not: it has no search value and
# burns crawl budget that belongs to the catalogue.
#
# This is a crawl instruction, not access control. Blocked paths are also marked
# noindex in the page head, which is what actually keeps them out of an index.

User-agent: *
Allow: /

Disallow: /admin
Disallow: /seller
Disallow: /auth/
Disallow: /cart
Disallow: /checkout
Disallow: /payment
Disallow: /order-confirmation
Disallow: /orders
Disallow: /profile
Disallow: /wishlist
Disallow: /messages
Disallow: /chat/
Disallow: /notifications
Disallow: /coupons
Disallow: /api/

# An unbounded space of near-identical result pages. The category, occasion and
# fabric landing pages are the indexable equivalents — unique copy, stable URLs.
Disallow: /search
Disallow: /shop/filter
Disallow: /shop/sort
Disallow: /*?q=

# Legacy paths (301 to their clean equivalents).
Disallow: /buyer/

# Assistants and AI search are welcome — the edge gives them real HTML.
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Google-Extended
Allow: /

# Catalogue scrapers resold as competitor data.
User-agent: AhrefsBot
Disallow: /

User-agent: SemrushBot
Disallow: /

Sitemap: ${origin}/sitemap.xml
`;
}

/* ── sitemap.xml ────────────────────────────────────────────────────────── */

function urlEntry(loc: string, opts: { lastmod?: string; changefreq?: string; priority?: string; image?: string; title?: string } = {}): string {
  const parts = [`<loc>${escapeHtml(loc)}</loc>`];
  if (opts.lastmod) parts.push(`<lastmod>${opts.lastmod.slice(0, 10)}</lastmod>`);
  if (opts.changefreq) parts.push(`<changefreq>${opts.changefreq}</changefreq>`);
  if (opts.priority) parts.push(`<priority>${opts.priority}</priority>`);
  if (opts.image) {
    parts.push(
      `<image:image><image:loc>${escapeHtml(opts.image)}</image:loc>${opts.title ? `<image:title>${escapeHtml(opts.title)}</image:title>` : ''}</image:image>`,
    );
  }
  return `<url>${parts.join('')}</url>`;
}

const POLICY_SLUGS = [
  'about', 'help', 'privacy-policy', 'terms', 'shipping-policy',
  'delivery-policy', 'return-refund-policy', 'cancellation-policy', 'product-policy',
];

async function sitemapXml(origin: string): Promise<string> {
  const [products, boutiques] = await Promise.all([
    db<ProductRow>(`products?select=${PRODUCT_COLUMNS}&status=eq.active&deleted_at=is.null&order=created_at.desc&limit=5000`),
    db<BoutiqueRow>(`boutiques?select=${BOUTIQUE_COLUMNS}&status=eq.approved&limit=2000`),
  ]);

  const entries: string[] = [
    urlEntry(`${origin}/`, { changefreq: 'daily', priority: '1.0' }),
    urlEntry(`${origin}/collections`, { changefreq: 'daily', priority: '0.9' }),
    urlEntry(`${origin}/shop`, { changefreq: 'daily', priority: '0.8' }),
    urlEntry(`${origin}/boutiques`, { changefreq: 'daily', priority: '0.9' }),
    urlEntry(`${origin}/new-arrivals`, { changefreq: 'daily', priority: '0.8' }),
    urlEntry(`${origin}/best-sellers`, { changefreq: 'daily', priority: '0.8' }),
    urlEntry(`${origin}/top-boutiques`, { changefreq: 'weekly', priority: '0.7' }),
    urlEntry(`${origin}/inspire`, { changefreq: 'daily', priority: '0.6' }),
  ];

  // Category, occasion and fabric landing pages, derived from what is actually
  // listed — a term with nothing behind it is not submitted.
  const facets: Record<'collections' | 'occasions' | 'fabrics', Set<string>> = {
    collections: new Set(),
    occasions: new Set(),
    fabrics: new Set(),
  };
  for (const p of products) {
    if (p.category) facets.collections.add(slugify(p.category));
    const occasion = p.occasion;
    if (occasion) facets.occasions.add(slugify(occasion));
    if (p.fabric) facets.fabrics.add(slugify(p.fabric));
  }
  for (const [prefix, values] of Object.entries(facets)) {
    for (const slug of values) {
      if (slug) entries.push(urlEntry(`${origin}/${prefix}/${slug}`, { changefreq: 'daily', priority: '0.85' }));
    }
  }

  for (const b of boutiques) {
    if (!b.slug) continue;
    entries.push(
      urlEntry(`${origin}/boutique/${b.slug}`, {
        lastmod: b.created_at || undefined,
        changefreq: 'weekly',
        priority: '0.8',
        image: b.logo_url || b.cover_url || undefined,
        title: b.name,
      }),
    );
  }

  for (const p of products) {
    entries.push(
      urlEntry(`${origin}${productPath(p)}`, {
        lastmod: p.created_at || undefined,
        changefreq: 'weekly',
        priority: '0.7',
        image: p.image_url || undefined,
        title: p.title,
      }),
    );
  }

  for (const slug of POLICY_SLUGS) {
    entries.push(urlEntry(`${origin}/${slug}`, { changefreq: 'monthly', priority: '0.3' }));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join('\n')}
</urlset>`;
}

/* ── Entry point ────────────────────────────────────────────────────────── */

export default async function middleware(request: Request): Promise<Response | undefined> {
  try {
    const url = new URL(request.url);
    const { pathname, origin } = url;

    if (pathname === '/robots.txt') {
      return new Response(robotsTxt(origin), {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': `public, max-age=0, s-maxage=${SITEMAP_CACHE_SECONDS}`,
        },
      });
    }

    if (pathname === '/sitemap.xml') {
      return new Response(await sitemapXml(origin), {
        headers: {
          'content-type': 'application/xml; charset=utf-8',
          'cache-control': `public, max-age=0, s-maxage=${SITEMAP_CACHE_SECONDS}, stale-while-revalidate=86400`,
        },
      });
    }

    // Only GET page loads are worth rendering a head for.
    if (request.method !== 'GET') return undefined;

    const meta = await resolveMeta(pathname, origin);

    // A legacy or non-canonical URL that resolved to a real record — send the
    // crawler (and the visitor) to the one address that should rank.
    if (meta?.redirectTo) {
      return new Response(null, {
        status: 301,
        headers: { location: `${origin}${meta.redirectTo}`, 'cache-control': 'public, max-age=3600' },
      });
    }

    const shell = await fetch(`${origin}/index.html`, { headers: { 'x-edge-shell': '1' } });
    if (!shell.ok) return undefined;
    const html = await shell.text();

    const canonical = `${origin}${pathname === '/' ? '/' : pathname.replace(/\/+$/, '')}`;
    const injected = html
      .replace('<title>MangaiMart</title>', headFor(meta, canonical, origin, pathname))
      .replace('<html lang="en">', '<html lang="en-IN">');

    // Nothing was replaced — the shell is not the shape this expects, so don't
    // risk serving a half-rewritten document.
    if (injected === html) return undefined;

    const headers = new Headers({
      'content-type': 'text/html; charset=utf-8',
      'cache-control': `public, max-age=0, s-maxage=${PAGE_CACHE_SECONDS}, stale-while-revalidate=86400`,
    });
    // Belt and braces with the `robots` meta tag: a header cannot be missed by a
    // crawler that gives up before parsing the document.
    if (isNoIndex(pathname)) headers.set('x-robots-tag', 'noindex, nofollow');

    return new Response(injected, { headers });
  } catch {
    // Any failure at all: serve the app exactly as it would have been served
    // without this middleware. SEO metadata is never worth an outage.
    return undefined;
  }
}
