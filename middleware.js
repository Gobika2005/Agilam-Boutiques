export const config = {
  /**
   * Skip anything that is not an HTML page request.
   *
   * `index.html` is excluded specifically: the injector fetches it to get the
   * shell, and matching it here would make that fetch re-enter the middleware.
   */
  matcher: ["/((?!api/|assets/|_vercel|index\\.html|.*\\.[a-zA-Z0-9]+$).*)", "/robots.txt", "/sitemap.xml"]
};
const SITE_NAME = "MangaiMart";
const DEFAULT_DESCRIPTION = "Shop verified Tamil Nadu boutiques in one place \u2014 sarees, kurta sets, kurtis and more, with direct chat to the shop.";
const DEFAULT_OG_IMAGE = "/mangaimart-logo.png";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const PAGE_CACHE_SECONDS = 300;
const SITEMAP_CACHE_SECONDS = 3600;
const DB_TIMEOUT_MS = 1500;
const NOINDEX_PREFIXES = [
  "/admin",
  "/seller",
  "/auth",
  "/cart",
  "/checkout",
  "/payment",
  "/order-confirmation",
  "/orders",
  "/profile",
  "/wishlist",
  "/messages",
  "/chat",
  "/notifications",
  "/coupons",
  "/search",
  "/buyer"
];
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function slugify(input, maxLength = 60) {
  return (input || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, maxLength).replace(/-+$/g, "");
}
function productPath(row) {
  // The database slug (migration 0057) is the authority; the computed form is
  // only a fallback for a database where it has not been applied.
  if (row.slug) return `/products/${row.slug}`;
  const base = slugify(row.title);
  const suffix = row.id.replace(/-/g, "").slice(0, 8);
  return `/products/${base ? `${base}-${suffix}` : suffix}`;
}
function clamp(text, max = 158) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.,;:\s]+$/, "")}\u2026`;
}
const inr = (n) => `\u20B9${Number(n).toLocaleString("en-IN")}`;
function isNoIndex(pathname) {
  const p = pathname.toLowerCase();
  return NOINDEX_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}
/**
 * One PostgREST read, reporting whether it actually succeeded.
 *
 * `ok` matters: an empty array is ambiguous — it means both "nothing matched"
 * and "that query was rejected". The products reader has to tell those apart to
 * know whether migration 0057 has been applied, and guessing by re-running the
 * query doubled the latency of the 5000-row sitemap read until it blew the
 * timeout and returned an empty sitemap.
 */
async function dbTry(path) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { ok: false, rows: [] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DB_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    if (!res.ok) return { ok: false, rows: [] };
    const rows = await res.json();
    return { ok: Array.isArray(rows), rows: Array.isArray(rows) ? rows : [] };
  } catch {
    // Timeout, network error, malformed JSON — all mean "serve the shell".
    return { ok: false, rows: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function db(path) {
  return (await dbTry(path)).rows;
}
/*
 * Migration 0057 adds `products.slug`. Naming a column PostgREST does not know
 * fails the ENTIRE query, not just that field — so on a deployment where 0057
 * has not been applied yet, asking for it would empty the sitemap and blank
 * every product page's metadata. The query falls back once to the legacy column
 * list and remembers, mirroring how src/data/boutiques.ts handles the migration
 * 0023 counter columns.
 */
let productSlugAvailable = true;
const PRODUCT_COLUMNS_LEGACY = "id,title,description,price,mrp,stock,category,occasion,color,fabric,image_url,rating,reviews_count,created_at,boutiques(name,slug,city)";
const PRODUCT_COLUMNS = "id,slug,title,description,price,mrp,stock,category,occasion,color,fabric,image_url,rating,reviews_count,created_at,boutiques(name,slug,city)";
const BOUTIQUE_COLUMNS = "id,name,slug,city,area,description,logo_url,cover_url,phone,rating,reviews_count,created_at";
function orgNode(origin) {
  return {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: SITE_NAME,
    url: origin,
    logo: `${origin}${DEFAULT_OG_IMAGE}`,
    description: DEFAULT_DESCRIPTION,
    address: {
      "@type": "PostalAddress",
      addressLocality: "Coimbatore",
      addressRegion: "Tamil Nadu",
      addressCountry: "IN"
    }
  };
}

/** A full UUID, as opposed to a title slug. Decides which column to filter on. */
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "");
}

/** Runs a products query, retrying without `slug` if the column is absent. */
async function dbProducts(build) {
  if (productSlugAvailable) {
    const attempt = await dbTry(build(PRODUCT_COLUMNS));
    // Succeeded — including a legitimate zero-row answer. Nothing to retry.
    if (attempt.ok) return attempt.rows;
    // Rejected. Almost always "column products.slug does not exist", i.e. 0057
    // is not applied. Drop to the legacy list and remember, so this costs one
    // extra round trip per cold edge instance rather than one per request.
    const legacy = await dbTry(build(PRODUCT_COLUMNS_LEGACY));
    if (legacy.ok) productSlugAvailable = false;
    return legacy.rows;
  }
  return db(build(PRODUCT_COLUMNS_LEGACY));
}

async function metaForProduct(slug, origin) {
  if (!slug) return null;
  /*
   * Filter on `slug`, not on a prefix of `id`.
   *
   * The URL carries only the first 8 characters of the uuid, and Postgres will
   * not compare a uuid to a text pattern at all — `id=like.4c5c667b*` fails with
   * "operator does not exist: uuid ~~ unknown", which took the WHOLE query down
   * and silently returned every product page as the generic shell. Migration
   * 0057 stores and uniquely indexes the slug precisely so this is one indexed
   * equality lookup.
   *
   * A bare uuid still arrives here from legacy `/buyer/product/:id` links, and
   * that one *can* be matched on the id column.
   */
  const filter = isUuid(slug)
    ? `id=eq.${slug}`
    : `slug=eq.${encodeURIComponent(slug)}`;
  const rows = await dbProducts(
    (cols) => `products?select=${cols}&status=eq.active&deleted_at=is.null&limit=1&${filter}`
  );
  const p = rows[0];
  if (!p) return null;
  const shop = p.boutiques?.name || SITE_NAME;
  const city = p.boutiques?.city || "Tamil Nadu";
  const canonicalPath = productPath(p);
  const url = `${origin}${canonicalPath}`;
  const inStock = (p.stock ?? 0) > 0;
  return {
    title: `${p.title} \u2014 ${shop}`,
    description: clamp(
      p.description?.trim() || `${p.title} from ${shop}, ${city}. ${inr(p.price)}${p.fabric ? ` \xB7 ${p.fabric}` : ""}${p.color ? ` \xB7 ${p.color}` : ""}. ${inStock ? "In stock, 7-day returns, cash on delivery available." : "Currently sold out."}`
    ),
    image: p.image_url || void 0,
    type: "product",
    // A bare id, or a stale title slug, is rewritten to the canonical URL.
    redirectTo: `/products/${slug}` !== canonicalPath ? canonicalPath : void 0,
    schema: {
      "@context": "https://schema.org",
      "@graph": [
        orgNode(origin),
        {
          "@type": "Product",
          "@id": `${url}#product`,
          name: p.title,
          url,
          image: p.image_url ? [p.image_url] : void 0,
          description: p.description?.trim() || `${p.title} from ${shop}, ${city}.`,
          sku: p.id,
          category: p.category || void 0,
          color: p.color || void 0,
          material: p.fabric || void 0,
          brand: { "@type": "Brand", name: shop },
          offers: {
            "@type": "Offer",
            url,
            price: p.price,
            priceCurrency: "INR",
            availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            itemCondition: "https://schema.org/NewCondition",
            seller: { "@type": "Organization", name: shop }
          },
          // Only when a rating is real — a fabricated one is a manual-action risk.
          aggregateRating: (p.reviews_count ?? 0) > 0 && (p.rating ?? 0) > 0 ? {
            "@type": "AggregateRating",
            ratingValue: Number(p.rating),
            reviewCount: p.reviews_count,
            bestRating: 5,
            worstRating: 1
          } : void 0
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: origin },
            { "@type": "ListItem", position: 2, name: "Collections", item: `${origin}/collections` },
            ...p.category ? [{ "@type": "ListItem", position: 3, name: p.category, item: `${origin}/collections/${slugify(p.category)}` }] : [],
            { "@type": "ListItem", position: p.category ? 4 : 3, name: p.title }
          ]
        }
      ]
    }
  };
}
async function metaForBoutique(slug, origin) {
  /*
   * Same trap as products: `or=(slug.eq.X,id.eq.X)` asks Postgres to compare a
   * uuid column against a title slug, which is an invalid-input error that
   * fails the entire query rather than just that branch. Pick the column.
   */
  const filter = isUuid(slug)
    ? `id=eq.${slug}`
    : `slug=eq.${encodeURIComponent(slug)}`;
  const rows = await db(
    `boutiques?select=${BOUTIQUE_COLUMNS}&status=eq.approved&limit=1&${filter}`
  );
  const b = rows[0];
  if (!b) return null;
  // Falls back to the id where migration 0057 has not been applied yet.
  const boutiquePath = `/boutique/${b.slug || b.id}`;
  const url = `${origin}${boutiquePath}`;
  return {
    title: `${b.name} \u2014 Boutique in ${b.city || "Tamil Nadu"}`,
    description: clamp(
      b.description?.trim() || `Shop ${b.name}, a verified boutique in ${b.city || "Tamil Nadu"}. Chat directly with the owner and get delivery across India.`
    ),
    image: b.logo_url || b.cover_url || void 0,
    type: "profile",
    redirectTo: `/boutique/${slug}` !== boutiquePath ? boutiquePath : void 0,
    schema: {
      "@context": "https://schema.org",
      "@graph": [
        orgNode(origin),
        {
          "@type": "ClothingStore",
          "@id": `${url}#boutique`,
          name: b.name,
          url,
          image: b.cover_url || b.logo_url || void 0,
          description: b.description?.trim() || `${b.name} is a verified boutique in ${b.city || "Tamil Nadu"}.`,
          telephone: b.phone || void 0,
          address: {
            "@type": "PostalAddress",
            streetAddress: b.area || void 0,
            addressLocality: b.city || void 0,
            addressRegion: "Tamil Nadu",
            addressCountry: "IN"
          },
          currenciesAccepted: "INR",
          parentOrganization: { "@id": `${origin}/#organization` },
          aggregateRating: (b.reviews_count ?? 0) > 0 && (b.rating ?? 0) > 0 ? {
            "@type": "AggregateRating",
            ratingValue: Number(b.rating),
            reviewCount: b.reviews_count,
            bestRating: 5,
            worstRating: 1
          } : void 0
        }
      ]
    }
  };
}
const STATIC_META = {
  "/": {
    title: "Boutique Ethnic Wear from Tamil Nadu \u2014 Sarees, Kurta Sets & More",
    description: "Shop verified Tamil Nadu boutiques in one place. Sarees, kurta sets, kurtis and lehengas from independent shops, with direct chat to the owner and delivery across India."
  },
  "/collections": {
    title: "Shop by Collection \u2014 Sarees, Kurta Sets & Ethnic Wear",
    description: "Browse every category, occasion, fabric, budget and colour Tamil Nadu boutiques are listing on MangaiMart right now."
  },
  "/shop": {
    title: "Shop All \u2014 Ethnic Wear from Verified Tamil Nadu Boutiques",
    description: "Every piece listed by verified Tamil Nadu boutiques on MangaiMart. Filter by category, occasion, colour, size and budget."
  },
  "/boutiques": {
    title: "Boutiques in Tamil Nadu \u2014 Verified Ethnic Wear Shops",
    description: "Browse every verified boutique on MangaiMart by city, rating and speciality. Independent shops across Tamil Nadu, each checked before it can list."
  },
  "/new-arrivals": {
    title: "New Arrivals \u2014 Latest Ethnic Wear from Tamil Nadu Boutiques",
    description: "Every piece MangaiMart boutiques have listed in the last 30 days, newest first."
  },
  "/best-sellers": {
    title: "Best Sellers \u2014 Most-Bought Ethnic Wear on MangaiMart",
    description: "The pieces MangaiMart buyers are actually taking home, ranked by units sold and how well they are rated."
  },
  "/top-boutiques": {
    title: "Best-Selling Boutiques in Tamil Nadu \u2014 Top Rated Shops",
    description: "The Tamil Nadu boutiques moving the most pieces, weighed against how well they are rated by real buyers."
  },
  "/inspire": {
    title: "Inspire \u2014 New Pieces from Tamil Nadu Boutiques",
    description: "A live feed of what MangaiMart boutiques are listing right now."
  }
};
async function metaForCategory(kind, slug, origin) {
  const rows = await dbProducts(
    (cols) => `products?select=${cols}&status=eq.active&deleted_at=is.null&limit=40`
  );
  const items = rows.filter((p) => {
    const value = kind === "category" ? p.category : kind === "occasion" ? p.occasion : p.fabric;
    return value && slugify(value) === slug;
  });
  if (!items.length) return null;
  const term = (kind === "category" ? items[0].category : kind === "occasion" ? items[0].occasion : items[0].fabric) || slug;
  const heading = kind === "occasion" ? `${term} wear` : term;
  const shops = new Set(items.map((p) => p.boutiques?.name).filter(Boolean)).size;
  const from = Math.min(...items.map((p) => p.price));
  const path = `/${kind === "category" ? "collections" : kind === "occasion" ? "occasions" : "fabrics"}/${slug}`;
  const url = `${origin}${path}`;
  const description = clamp(
    `${items.length} ${heading.toLowerCase()} ${items.length === 1 ? "piece" : "pieces"} from ${shops} verified ${shops === 1 ? "boutique" : "boutiques"} in Tamil Nadu, from ${inr(from)}. Direct chat with the shop, 7-day returns, delivery across India.`
  );
  return {
    title: `${heading} Online \u2014 Buy from Verified Tamil Nadu Boutiques`,
    description,
    image: items.find((p) => p.image_url)?.image_url || void 0,
    type: "website",
    schema: {
      "@context": "https://schema.org",
      "@graph": [
        orgNode(origin),
        {
          "@type": "CollectionPage",
          "@id": `${url}#collection`,
          name: heading,
          description,
          url,
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: items.length,
            itemListElement: items.slice(0, 30).map((p, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: `${origin}${productPath(p)}`,
              name: p.title
            }))
          }
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: origin },
            { "@type": "ListItem", position: 2, name: "Collections", item: `${origin}/collections` },
            { "@type": "ListItem", position: 3, name: heading }
          ]
        }
      ]
    }
  };
}
async function resolveMeta(pathname, origin) {
  const staticMeta = STATIC_META[pathname];
  if (staticMeta) {
    return {
      ...staticMeta,
      type: "website",
      schema: {
        "@context": "https://schema.org",
        "@graph": [
          orgNode(origin),
          {
            "@type": "WebSite",
            "@id": `${origin}/#website`,
            url: origin,
            name: SITE_NAME,
            inLanguage: "en-IN",
            potentialAction: {
              "@type": "SearchAction",
              target: { "@type": "EntryPoint", urlTemplate: `${origin}/search?q={search_term_string}` },
              "query-input": "required name=search_term_string"
            }
          }
        ]
      }
    };
  }
  const product = pathname.match(/^\/products\/([^/]+)$/);
  if (product) return metaForProduct(decodeURIComponent(product[1]), origin);
  const boutique = pathname.match(/^\/boutique\/([^/]+)$/);
  if (boutique) return metaForBoutique(decodeURIComponent(boutique[1]), origin);
  const category = pathname.match(/^\/collections\/([^/]+)$/);
  if (category) return metaForCategory("category", decodeURIComponent(category[1]), origin);
  const occasion = pathname.match(/^\/occasions\/([^/]+)$/);
  if (occasion) return metaForCategory("occasion", decodeURIComponent(occasion[1]), origin);
  const fabric = pathname.match(/^\/fabrics\/([^/]+)$/);
  if (fabric) return metaForCategory("fabric", decodeURIComponent(fabric[1]), origin);
  return null;
}
function headFor(meta, canonical, origin, pathname) {
  const title = meta ? `${meta.title} \xB7 ${SITE_NAME}` : SITE_NAME;
  const description = meta?.description || DEFAULT_DESCRIPTION;
  const image = meta?.image ? meta.image.startsWith("http") ? meta.image : `${origin}${meta.image}` : `${origin}${DEFAULT_OG_IMAGE}`;
  const robots = isNoIndex(pathname) ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
  const tags = [
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="en_IN" />`,
    `<meta property="og:type" content="${meta?.type || "website"}" />`,
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
    `<meta name="geo.placename" content="Tamil Nadu, India" />`
  ];
  if (meta?.schema) {
    tags.push(
      `<script type="application/ld+json" data-edge-schema>${JSON.stringify(meta.schema).replace(/</g, "\\u003c")}</script>`
    );
  }
  return `<title>${escapeHtml(title)}</title>
${tags.join("\n")}`;
}
function robotsTxt(origin) {
  return `# MangaiMart \u2014 ${origin}
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
# fabric landing pages are the indexable equivalents \u2014 unique copy, stable URLs.
Disallow: /search
Disallow: /shop/filter
Disallow: /shop/sort
Disallow: /*?q=

# Legacy paths (301 to their clean equivalents).
Disallow: /buyer/

# Assistants and AI search are welcome \u2014 the edge gives them real HTML.
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
function urlEntry(loc, opts = {}) {
  const parts = [`<loc>${escapeHtml(loc)}</loc>`];
  if (opts.lastmod) parts.push(`<lastmod>${opts.lastmod.slice(0, 10)}</lastmod>`);
  if (opts.changefreq) parts.push(`<changefreq>${opts.changefreq}</changefreq>`);
  if (opts.priority) parts.push(`<priority>${opts.priority}</priority>`);
  if (opts.image) {
    parts.push(
      `<image:image><image:loc>${escapeHtml(opts.image)}</image:loc>${opts.title ? `<image:title>${escapeHtml(opts.title)}</image:title>` : ""}</image:image>`
    );
  }
  return `<url>${parts.join("")}</url>`;
}
const POLICY_SLUGS = [
  "about",
  "help",
  "privacy-policy",
  "terms",
  "shipping-policy",
  "delivery-policy",
  "return-refund-policy",
  "cancellation-policy",
  "product-policy"
];
const LEGACY_BUYER_REDIRECTS = {
  "/buyer": "/",
  "/buyer/home": "/",
  "/buyer/results": "/shop",
  "/buyer/filter": "/shop",
  "/buyer/sort": "/shop",
  "/buyer/collections": "/collections",
  "/buyer/boutiques": "/boutiques",
  "/buyer/new-arrivals": "/new-arrivals",
  "/buyer/best-sellers": "/best-sellers",
  "/buyer/top-boutiques": "/top-boutiques",
  "/buyer/inspire": "/inspire",
  "/buyer/cart": "/cart",
  "/buyer/checkout": "/checkout",
  "/buyer/payment": "/payment",
  "/buyer/order-confirmation": "/order-confirmation",
  "/buyer/orders": "/orders",
  "/buyer/wishlist": "/wishlist",
  "/buyer/profile": "/profile",
  "/buyer/coupons": "/coupons",
  "/buyer/notifications": "/notifications",
  "/buyer/messages": "/messages"
};
function legacyRedirectPath(pathname) {
  if (LEGACY_BUYER_REDIRECTS[pathname]) return LEGACY_BUYER_REDIRECTS[pathname];
  let match = pathname.match(/^\/buyer\/product\/([^/]+)$/);
  if (match) return `/products/${match[1]}`;
  match = pathname.match(/^\/buyer\/boutique\/([^/]+)$/);
  if (match) return `/boutique/${match[1]}`;
  match = pathname.match(/^\/buyer\/policy\/([^/]+)$/);
  if (match) return `/${match[1]}`;
  match = pathname.match(/^\/buyer\/orders\/([^/]+)(\/track)?$/);
  if (match) return `/orders/${match[1]}${match[2] || ""}`;
  match = pathname.match(/^\/buyer\/chat\/([^/]+)$/);
  if (match) return `/chat/${match[1]}`;
  match = pathname.match(/^\/b\/([^/]+)$/);
  if (match) return `/boutique/${match[1]}`;
  return null;
}
async function sitemapXml(origin) {
  const [products, boutiques] = await Promise.all([
    dbProducts((cols) => `products?select=${cols}&status=eq.active&deleted_at=is.null&order=created_at.desc&limit=5000`),
    db(`boutiques?select=${BOUTIQUE_COLUMNS}&status=eq.approved&limit=2000`)
  ]);
  const entries = [
    urlEntry(`${origin}/`, { changefreq: "daily", priority: "1.0" }),
    urlEntry(`${origin}/collections`, { changefreq: "daily", priority: "0.9" }),
    urlEntry(`${origin}/shop`, { changefreq: "daily", priority: "0.8" }),
    urlEntry(`${origin}/boutiques`, { changefreq: "daily", priority: "0.9" }),
    urlEntry(`${origin}/new-arrivals`, { changefreq: "daily", priority: "0.8" }),
    urlEntry(`${origin}/best-sellers`, { changefreq: "daily", priority: "0.8" }),
    urlEntry(`${origin}/top-boutiques`, { changefreq: "weekly", priority: "0.7" }),
    urlEntry(`${origin}/inspire`, { changefreq: "daily", priority: "0.6" })
  ];
  const facets = {
    collections: /* @__PURE__ */ new Set(),
    occasions: /* @__PURE__ */ new Set(),
    fabrics: /* @__PURE__ */ new Set()
  };
  for (const p of products) {
    if (p.category) facets.collections.add(slugify(p.category));
    const occasion = p.occasion;
    if (occasion) facets.occasions.add(slugify(occasion));
    if (p.fabric) facets.fabrics.add(slugify(p.fabric));
  }
  for (const [prefix, values] of Object.entries(facets)) {
    for (const slug of values) {
      if (slug) entries.push(urlEntry(`${origin}/${prefix}/${slug}`, { changefreq: "daily", priority: "0.85" }));
    }
  }
  for (const b of boutiques) {
    entries.push(
      urlEntry(`${origin}/boutique/${b.slug || b.id}`, {
        lastmod: b.created_at || void 0,
        changefreq: "weekly",
        priority: "0.8",
        image: b.logo_url || b.cover_url || void 0,
        title: b.name
      })
    );
  }
  for (const p of products) {
    entries.push(
      urlEntry(`${origin}${productPath(p)}`, {
        lastmod: p.created_at || void 0,
        changefreq: "weekly",
        priority: "0.7",
        image: p.image_url || void 0,
        title: p.title
      })
    );
  }
  for (const slug of POLICY_SLUGS) {
    entries.push(urlEntry(`${origin}/${slug}`, { changefreq: "monthly", priority: "0.3" }));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join("\n")}
</urlset>`;
}
export default async function middleware(request) {
  try {
    const url = new URL(request.url);
    const { pathname, origin } = url;
    const legacyPath = legacyRedirectPath(pathname);
    if (legacyPath) {
      return new Response(null, {
        status: 301,
        headers: { location: `${origin}${legacyPath}${url.search}`, "cache-control": "public, max-age=3600" }
      });
    }
    if (pathname === "/robots.txt") {
      return new Response(robotsTxt(origin), {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": `public, max-age=0, s-maxage=${SITEMAP_CACHE_SECONDS}`
        }
      });
    }
    if (pathname === "/sitemap.xml") {
      return new Response(await sitemapXml(origin), {
        headers: {
          "content-type": "application/xml; charset=utf-8",
          "cache-control": `public, max-age=0, s-maxage=${SITEMAP_CACHE_SECONDS}, stale-while-revalidate=86400`
        }
      });
    }
    if (
      pathname.startsWith("/api/") ||
      pathname.startsWith("/assets/") ||
      pathname.startsWith("/_vercel") ||
      pathname === "/index.html" ||
      /\.[a-zA-Z0-9]+$/.test(pathname)
    ) {
      return void 0;
    }
    if (request.method !== "GET") return void 0;
    const meta = await resolveMeta(pathname, origin);
    if (meta?.redirectTo) {
      return new Response(null, {
        status: 301,
        headers: { location: `${origin}${meta.redirectTo}`, "cache-control": "public, max-age=3600" }
      });
    }
    const shell = await fetch(`${origin}/index.html`, { headers: { "x-edge-shell": "1" } });
    if (!shell.ok) return void 0;
    const html = await shell.text();
    const canonical = `${origin}${pathname === "/" ? "/" : pathname.replace(/\/+$/, "")}`;
    const injected = html.replace("<title>MangaiMart</title>", headFor(meta, canonical, origin, pathname)).replace('<html lang="en">', '<html lang="en-IN">');
    if (injected === html) return void 0;
    const headers = new Headers({
      "content-type": "text/html; charset=utf-8",
      "cache-control": `public, max-age=0, s-maxage=${PAGE_CACHE_SECONDS}, stale-while-revalidate=86400`
    });
    if (isNoIndex(pathname)) headers.set("x-robots-tag", "noindex, nofollow");
    return new Response(injected, { headers });
  } catch {
    return void 0;
  }
}
