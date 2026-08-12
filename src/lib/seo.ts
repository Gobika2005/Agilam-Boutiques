/**
 * The one place that knows what MangaiMart's URLs are.
 *
 * Everything that needs to name a page — a canonical tag, an Open Graph URL, a
 * sitemap entry, a JSON-LD `@id`, an internal `<Link to>` — comes through here,
 * so a URL can never be spelled two ways in two files. The edge middleware
 * (`middleware.ts`) mirrors the pure functions in this module, because it has to
 * build the same URLs before React exists; the pair is kept in step by both
 * reading the same rules, and any change here must be repeated there.
 *
 * ── Slugs ────────────────────────────────────────────────────────────────
 * A product URL is `/products/<title-slug>-<id-prefix>`. The title carries the
 * keywords a shopper actually searches for; the id prefix makes it unique and
 * lets a renamed product keep resolving its old URL.
 *
 * That string is generated and uniquely indexed as `products.slug` by migration
 * 0057, and the column is the authority. It has to be: the browser can match an
 * id prefix because it holds the whole catalogue in memory, but the edge
 * middleware has to filter in SQL, and Postgres rejects `uuid LIKE 'text%'`
 * outright. Without the column every product page served crawlers a generic
 * shell. The locally computed form survives as a fallback so the app still
 * builds correct URLs before 0057 is applied.
 *
 * Boutiques carry their own unique slug — added by 0003, but left NULL on every
 * shop created by the 0021 onboarding wizard until 0057 backfilled them and
 * added the trigger that maintains them.
 */

/** How much of the UUID rides along in a product URL. 8 hex chars ≈ 4.3bn. */
const ID_PREFIX_LEN = 8;

/**
 * The canonical origin, without a trailing slash.
 *
 * Configured once via `VITE_SITE_URL`. Falls back to Vercel's deploy URL, then
 * to the browser's own origin, so preview deploys and local dev produce correct
 * (if non-canonical) absolute URLs instead of `undefined/products/...`.
 */
export const SITE_URL: string = (() => {
  const configured = import.meta.env?.VITE_SITE_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, '');
  const vercel = import.meta.env?.VITE_VERCEL_URL as string | undefined;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://mangaimart.com';
})();

export const SITE_NAME = 'MangaiMart';
export const SITE_LOCALE = 'en_IN';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/mangaimart-logo.png`;

/**
 * URL-safe slug: lowercase, accents stripped, runs of anything else collapsed
 * to a single hyphen. Capped so a boutique that names a saree in a paragraph
 * doesn't produce a 300-character URL.
 */
export function slugify(input: string, maxLength = 60): string {
  return (input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/**
 * `"Kanchipuram Silk Saree"` + `"1f2e3d4c-…"` → `kanchipuram-silk-saree-1f2e3d4c`.
 *
 * Migration 0057 generates and indexes exactly this string as `products.slug`,
 * and that column is the authority: the edge middleware resolves a product page
 * with a single `slug=eq.…` lookup, which is the only thing PostgREST can do
 * (Postgres refuses `uuid LIKE 'text%'`, so the id prefix cannot be matched in
 * SQL at all).
 *
 * The locally computed form is kept as the fallback so the app still produces
 * correct URLs on a database where 0057 has not been applied yet — it just
 * loses the server-rendered metadata until it is.
 */
export function productSlug(product: { id: string; title: string; slug?: string | null }): string {
  if (product.slug) return product.slug;
  const base = slugify(product.title);
  const suffix = product.id.replace(/-/g, '').slice(0, ID_PREFIX_LEN);
  return base ? `${base}-${suffix}` : suffix;
}

/**
 * Recover the id prefix from a product slug so the page can find its product
 * without a round-trip. Returns the trailing hex group, or the whole string
 * when a bare UUID was passed (which is what every legacy `/buyer/product/:id`
 * link carries).
 */
export function productIdFromSlug(slug: string | undefined): string | null {
  if (!slug) return null;
  // A full UUID pasted straight in — the legacy route shape.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)) return slug;
  const match = slug.match(/-([0-9a-f]{6,})$/i);
  return match ? match[1].toLowerCase() : slug.toLowerCase();
}

/** Does this product own this slug? Compares on the id prefix, not the title. */
export function matchesProductSlug(product: { id: string; slug?: string | null }, slug: string | undefined): boolean {
  if (!slug) return false;
  // The database slug is the authority once migration 0057 is applied.
  if (product.slug && product.slug.toLowerCase() === slug.toLowerCase()) return true;
  const wanted = productIdFromSlug(slug);
  if (!wanted) return false;
  const flat = product.id.replace(/-/g, '').toLowerCase();
  return product.id.toLowerCase() === wanted || flat.startsWith(wanted.replace(/-/g, ''));
}

/* ── Route builders ─────────────────────────────────────────────────────── */

export const routes = {
  home: () => '/',
  collections: () => '/collections',
  category: (name: string) => `/collections/${slugify(name)}`,
  occasion: (name: string) => `/occasions/${slugify(name)}`,
  fabric: (name: string) => `/fabrics/${slugify(name)}`,
  colour: (name: string) => `/colours/${slugify(name)}`,
  /**
   * A budget rung — `/budget/under-3000`.
   *
   * The number, not a slugified label: `slugify('Under ₹3,000')` gives
   * `under-3-000`, which is both ugly and fragile the moment the label's
   * punctuation changes. The URL is built from the rung itself, so the label can
   * be rewritten without breaking a link anyone has shared.
   */
  budget: (maxPrice: number | string) => `/budget/under-${Number(maxPrice)}`,
  product: (p: { id: string; title: string; slug?: string | null }) => `/products/${productSlug(p)}`,
  boutique: (b: { slug?: string; id: string }) => `/boutique/${b.slug || b.id}`,
  boutiques: () => '/boutiques',
  /**
   * The per-city boutique directory — `/boutiques/coimbatore`.
   *
   * "Boutiques in Coimbatore" is a query with real local intent, and the city
   * filter used to live only in React state: one national URL, nothing for a
   * crawler to reach and nothing to rank. Each city with an approved shop is now
   * its own page, and selecting a city navigates rather than setting state.
   */
  city: (name: string) => `/boutiques/${slugify(name)}`,
  newArrivals: () => '/new-arrivals',
  bestSellers: () => '/best-sellers',
  topBoutiques: () => '/top-boutiques',
  inspire: () => '/inspire',
  search: () => '/search',
  policy: (slug: string) => `/${slug}`,
} as const;

/** Absolute, canonical form of an in-app path. */
export function absoluteUrl(path: string): string {
  if (!path) return SITE_URL;
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * The canonical URL for a path: absolute, query string and hash stripped, and
 * no trailing slash (except the root).
 *
 * Dropping the query is what collapses `/collections?sort=price`,
 * `/collections?page=2` and every filter permutation onto the one URL that
 * should actually rank — the single largest duplicate-content source in the
 * audit.
 */
export function canonicalUrl(path: string): string {
  const clean = path.split('#')[0].split('?')[0];
  const trimmed = clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
  return absoluteUrl(trimmed || '/');
}

/* ── Indexability ───────────────────────────────────────────────────────── */

/**
 * Route prefixes that must never enter a search index: private to one buyer,
 * operator-only, or a transactional step with no standalone value.
 *
 * `robots.txt` blocks the same list at the crawl layer and the middleware emits
 * `X-Robots-Tag` for them; this is the third belt, because a page that is
 * linked from an indexed page can still be indexed despite a Disallow.
 */
export const NOINDEX_PREFIXES = [
  '/admin',
  '/seller',
  '/auth',
  '/cart',
  '/checkout',
  '/payment',
  '/order-confirmation',
  '/orders',
  '/profile',
  '/wishlist',
  '/messages',
  '/chat',
  '/notifications',
  '/coupons',
  '/search',
  '/buyer/cart',
  '/buyer/checkout',
  '/buyer/payment',
  '/buyer/order-confirmation',
  '/buyer/orders',
  '/buyer/profile',
  '/buyer/wishlist',
  '/buyer/messages',
  '/buyer/chat',
  '/buyer/notifications',
  '/buyer/coupons',
  '/buyer/filter',
  '/buyer/sort',
];

export function isNoIndexPath(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return NOINDEX_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/**
 * The `robots` content for a path.
 *
 * `max-image-preview:large` is what lets Google show a full-width product photo
 * in a result — on a clothing marketplace that is worth more than most on-page
 * tuning.
 */
export function robotsFor(pathname: string): string {
  return isNoIndexPath(pathname)
    ? 'noindex, nofollow'
    : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
}

/* ── Copy helpers ───────────────────────────────────────────────────────── */

/** Meta descriptions are truncated by search engines around 155–160 chars. */
export function clampDescription(text: string, max = 158): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:\s]+$/, '')}…`;
}

/** Titles are truncated around 60 characters including the site suffix. */
export function clampTitle(text: string, max = 60): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).replace(/[\s\-–—,]+$/, '')}…`;
}
