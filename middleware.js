/**
 * Which requests reach this middleware.
 *
 * Skips anything that is not an HTML page request. `index.html` is excluded
 * specifically: the injector fetches it to get the shell, and matching it here
 * would make that fetch re-enter the middleware.
 *
 * ── Do not put a `/** … *\/` comment on a property below ──────────────────
 * Vercel reads this object statically with `@vercel/static-config`, which does
 * `const [name, colon, value] = prop.getChildren()`. A JSDoc comment attached
 * to a property becomes an extra leading child, so that destructuring shifts by
 * one and `value` ends up being the `:` itself. The build then dies with
 *
 *     Error: Unhandled type: "ColonToken" :
 *
 * which is emitted after Vite reports success, names no file, and does not
 * reproduce locally — `npm run build` passes and only the deploy fails. Line
 * comments and plain block comments are safe; JSDoc is not. Keep prose up here.
 */
export const config = {
  matcher: ["/((?!api/|assets/|_vercel|index\\.html|.*\\.[a-zA-Z0-9]+$).*)", "/robots.txt", "/sitemap.xml", "/sitemap-pages.xml", "/sitemap-boutiques.xml", "/sitemap-products.xml", "/merchant-feed.xml"]
};
const SITE_NAME = "MangaiMart";
const DEFAULT_DESCRIPTION = "Shop verified Tamil Nadu boutiques in one place \u2014 sarees, kurta sets, kurtis and more, with direct chat to the shop.";
const DEFAULT_OG_IMAGE = "/mangaimart-logo.png";
// Mirrors COMPANY.social in src/data/company.ts. Duplicated rather than
// imported because the edge runtime cannot pull in the TypeScript source —
// change both together, or the crawler-visible sameAs drifts from the footer.
const SOCIAL_PROFILES = [
  "https://www.instagram.com/mangaimartt",
  "https://www.facebook.com/share/194ncrSXck/",
  "https://www.youtube.com/@MangaiMart-n6u"
];
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const PAGE_CACHE_SECONDS = 300;
const SITEMAP_CACHE_SECONDS = 3600;
// The live domain, as a bare hostname. Same VITE_SITE_URL the client reads in
// src/lib/seo.ts, so the edge and the app can never disagree about who we are.
//
// The literal is a FALLBACK, not a default-empty string, and mirrors the last
// line of the SITE_URL resolver in src/lib/seo.ts. Every guard below keys on
// "are we on the canonical host?", and with this empty they all quietly answer
// "yes" — which is exactly how agilam-boutiques.vercel.app came to serve the
// whole catalogue as an indexable, self-canonical duplicate of mangaimart.com.
// Setting VITE_SITE_URL is still the right thing to do; this makes forgetting
// it survivable rather than silently un-branding the site.
const CANONICAL_HOST = (process.env.VITE_SITE_URL || "https://mangaimart.com")
  .replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
// Vercel sets this on every deployment: "production" | "preview" | "development".
// It is the only reliable way to tell a PRODUCTION alias that happens to end in
// .vercel.app — which must be redirected away — from a branch preview, which
// must stay reachable so it can be tested. Unset locally, so `npm run dev` and
// `npm run verify:seo` are untouched by anything that keys on it.
const VERCEL_ENV = process.env.VERCEL_ENV || "";
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
  return (input || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, maxLength).replace(/-+$/g, "");
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
// Sellers type their own vocabulary, so a term arrives however they left it \u2014
// "office wear", "SAREES", "raw silk". Titles and headings are rendered from it
// verbatim, so it gets cased here rather than in five call sites.
function titleCase(term) {
  return String(term || "").replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}
/**
 * An occasion reads as "<occasion> wear" \u2014 "Casual wear", "Office wear".
 *
 * Blindly appending produced "office wear wear" on every `/occasions/*` page,
 * in the title, the H1, the breadcrumb and the meta description, because the
 * seller had already written the word into the term. Only add what is missing.
 */
function occasionHeading(term) {
  const cased = titleCase(term);
  return /\bwear$/i.test(cased) ? cased : `${cased} Wear`;
}
/**
 * Meta for a URL whose subject does not exist \u2014 a deleted product, a mistyped
 * boutique handle, a category with nothing in it.
 *
 * These paths return the SPA shell with HTTP 200 (there is no origin that could
 * return a 404 for them), so without this they were served as indexable pages
 * with a self-referencing canonical: a soft 404, and an unbounded supply of
 * them. `noindex` is what actually keeps them out, and the `x-robots-tag` set
 * alongside it covers crawlers that never parse the head.
 */
function notFoundMeta() {
  return {
    title: "Page Not Found",
    description: "That page isn\u2019t available. Browse the full catalogue of verified Tamil Nadu boutiques on MangaiMart instead.",
    type: "website",
    noindex: true
  };
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
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { ok: false, rows: [], status: 0 };
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
    if (!res.ok) return { ok: false, rows: [], status: res.status };
    const rows = await res.json();
    return { ok: Array.isArray(rows), rows: Array.isArray(rows) ? rows : [], status: res.status };
  } catch {
    // Timeout, network error, malformed JSON — all mean "serve the shell".
    // `status: 0` distinguishes them from a rejection the server actually sent,
    // which is what the column fallbacks below key on.
    return { ok: false, rows: [], status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Did the server reject this query because it named a column that isn't there?
 *
 * PostgREST answers an unknown column with 400 (SQLSTATE 42703). Everything
 * else that makes a query fail — the 1500 ms abort above, a network blip, a 5xx
 * from Supabase — is transient and says nothing about the schema.
 *
 * The distinction matters because the two column fallbacks are sticky: they
 * remember the downgrade for the life of the edge instance. Treating "the
 * sitemap's 2000-row read timed out" as "this deployment predates migration
 * 0021" retired the rich columns permanently, and every shop page served by
 * that instance afterwards silently lost its address, hours and Instagram link.
 */
function isSchemaRejection(attempt) {
  return attempt.status === 400;
}

/**
 * One read, retried once if it failed for a reason that might not repeat.
 *
 * The 1500 ms abort is tight enough that a cold connection loses to it now and
 * then, and the cost of losing is a page served with no metadata or a sitemap
 * served with no shops. The column fallbacks below used to supply this second
 * attempt as a side effect — by asking for fewer columns, which fixed the
 * symptom and corrupted the schema flag. This is the same second attempt,
 * asking for the same thing.
 */
async function dbTryTwice(path) {
  const attempt = await dbTry(path);
  if (attempt.ok || isSchemaRejection(attempt)) return attempt;
  return dbTry(path);
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
const PRODUCT_COLUMNS_LEGACY = "id,boutique_id,title,description,price,mrp,stock,category,occasion,color,fabric,image_url,rating,reviews_count,created_at,boutiques(name,slug,city)";
const PRODUCT_COLUMNS = "id,slug,boutique_id,title,description,price,mrp,stock,category,occasion,color,fabric,image_url,rating,reviews_count,created_at,boutiques(name,slug,city)";
/*
 * Two boutique column lists, for the same reason products have two.
 *
 * A shop page has to win a search for the shop's OWN name — against that shop's
 * Instagram, its Facebook page and its Google Business listing, all of which
 * carry the address, the hours and the phone number. Migration 0021 revoked the
 * blanket SELECT on `boutiques` and granted back a named public list, and that
 * list already contains everything needed to match them: the full postal
 * address, opening hours, the Instagram handle, the founding year. Only the
 * first twelve of those were ever being read, so the markup a search engine got
 * was a name and a city.
 *
 * The rich list is tried first and remembered, exactly like PRODUCT_COLUMNS: on
 * a deployment where 0021 has not been applied, naming a column PostgREST does
 * not know fails the WHOLE query and would blank every shop page rather than
 * just dropping a field.
 */
// The lean list: everything the sitemap and a link preview need. It doubles as
// the fallback for a database where 0021's column grant has not been applied.
const BOUTIQUE_COLUMNS_CORE = "id,name,slug,city,area,description,logo_url,cover_url,phone,rating,reviews_count,created_at";
const BOUTIQUE_COLUMNS = `${BOUTIQUE_COLUMNS_CORE},instagram,whatsapp,established_year,address_line,district,state,pincode,open_time,close_time,working_days,delivery_areas,category`;
let boutiqueColumnsAvailable = true;

/** `dbProductsTry`, for boutiques. Retries once on the pre-0021 column list. */
async function dbBoutiquesTry(build) {
  if (boutiqueColumnsAvailable) {
    const attempt = await dbTryTwice(build(BOUTIQUE_COLUMNS));
    // Succeeded, or failed for a reason that has nothing to do with the schema
    // (see `isSchemaRejection`) — either way, do not downgrade.
    if (attempt.ok || !isSchemaRejection(attempt)) return attempt;
    const legacy = await dbTry(build(BOUTIQUE_COLUMNS_CORE));
    if (legacy.ok) boutiqueColumnsAvailable = false;
    return legacy;
  }
  return dbTry(build(BOUTIQUE_COLUMNS_CORE));
}
/* ── The LCP image ────────────────────────────────────────────────────────
 *
 * Mirrors src/lib/imageUrl.ts, which the edge cannot import. Any change to the
 * widths, the quality or the `resize` mode must be made in both files: a
 * preload that does not resolve to the byte-identical URL the `<img>` later
 * requests is not a head start, it is a second download.
 */
const PUBLIC_OBJECT = "/storage/v1/object/public/";
const RENDER_IMAGE = "/storage/v1/render/image/public/";
const IMAGE_WIDTHS = [240, 480, 800, 1280];
const IMAGE_QUALITY = 70;

function transformedImage(src, width) {
  if (!src || !src.includes(PUBLIC_OBJECT)) return src;
  return `${src.replace(PUBLIC_OBJECT, RENDER_IMAGE)}?width=${width}&quality=${IMAGE_QUALITY}&resize=contain`;
}

function imageSrcSet(src) {
  if (!src || !src.includes(PUBLIC_OBJECT)) return void 0;
  return IMAGE_WIDTHS.map((w) => `${transformedImage(src, w)} ${w}w`).join(", ");
}

/**
 * `<link rel="preload">` for the image that will be the Largest Contentful Paint.
 *
 * ── Why this is the single biggest performance fix available here ────────
 * The LCP image on both the home page and a product page is only *discoverable*
 * after a chain of four serial round trips: download and parse ~240 kB of
 * gzipped JavaScript, mount React, fetch the row from Supabase over a
 * connection that has to be opened from scratch, and only then learn the image
 * URL — which lives on that same third-party origin. Measured by PageSpeed on a
 * throttled mobile profile, that put LCP at 8.4 s with the image bytes barely
 * mattering; almost all of it was waiting.
 *
 * The edge already reads exactly these rows to build the metadata, so it knows
 * the URL before a single byte of JavaScript has been sent. Preloading it moves
 * the download from the end of that chain to the very start, in parallel with
 * the bundle rather than behind it.
 *
 * ── The match has to be exact ───────────────────────────────────────────
 * `imagesrcset` and `imagesizes` must be character-for-character what the
 * `<img>` will carry, because the browser picks a candidate from the preload
 * using the same rules and then has to recognise the result as already in
 * flight. A mismatched `sizes` is worse than no preload: it downloads one
 * candidate for nothing and then fetches another.
 */
function lcpPreload(src, sizes) {
  if (!src) return "";
  const srcset = imageSrcSet(src);
  // `imageFallback()` in src/lib/imageUrl.ts is width 800 — same value here.
  const href = transformedImage(src, 800);
  return `<link rel="preload" as="image" href="${escapeHtml(href)}"${
    srcset ? ` imagesrcset="${escapeHtml(srcset)}" imagesizes="${escapeHtml(sizes)}"` : ""
  } fetchpriority="high" />`;
}

/**
 * `preconnect` to Supabase.
 *
 * One origin serves both the PostgREST API the app calls on mount and the
 * Storage/transformer host every photo comes from, so this one hint covers the
 * DNS lookup, the TCP handshake and the TLS negotiation for both — roughly two
 * round trips that were otherwise spent after the bundle had already run.
 *
 * Emitted from the edge rather than written into index.html because the origin
 * is an environment variable; hardcoding it there would break the moment the
 * project moves.
 */
function supabasePreconnect() {
  if (!SUPABASE_URL) return "";
  try {
    const origin = escapeHtml(new URL(SUPABASE_URL).origin);
    /*
     * Both modes, deliberately — this is not a duplicate.
     *
     * Browsers pool sockets by (origin, credentials mode). supabase-js calls
     * PostgREST with `fetch` in CORS mode, while a plain `<img src>` is a
     * no-CORS request; a connection warmed for one is not reused by the other.
     * Google Fonts is preconnected the same way two lines below, for the same
     * reason. `dns-prefetch` is not included: it is strictly a subset of
     * preconnect and only ever mattered for browsers that lack it.
     */
    return `<link rel="preconnect" href="${origin}" crossorigin />\n<link rel="preconnect" href="${origin}" />`;
  } catch {
    return "";
  }
}

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
    },
    // Ties the domain to the brand's own profiles. This is the copy a crawler
    // actually reads — the client-rendered one in src/lib/schema.ts is behind
    // JS and is not what the knowledge panel is built from.
    sameAs: SOCIAL_PROFILES
  };
}

/** A full UUID, as opposed to a title slug. Decides which column to filter on. */
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "");
}

/**
 * Runs a products query, retrying without `slug` if the column is absent.
 *
 * Returns `{ ok, rows }` rather than bare rows because the callers that decide
 * whether a page is `noindex` must not treat "the database timed out" as "this
 * product does not exist" — that would quietly de-index the live catalogue for
 * the length of a Supabase blip.
 */
async function dbProductsTry(build) {
  if (productSlugAvailable) {
    const attempt = await dbTryTwice(build(PRODUCT_COLUMNS));
    // Succeeded — including a legitimate zero-row answer. Nothing to retry.
    // A timeout or a 5xx is not retried either: it is not evidence about the
    // schema, and acting on it would strip `slug` from every URL this instance
    // builds from then on (see `isSchemaRejection`).
    if (attempt.ok || !isSchemaRejection(attempt)) return attempt;
    // Rejected with 400 — "column products.slug does not exist", i.e. 0057 is
    // not applied. Drop to the legacy list and remember, so this costs one
    // extra round trip per cold edge instance rather than one per request.
    const legacy = await dbTry(build(PRODUCT_COLUMNS_LEGACY));
    if (legacy.ok) productSlugAvailable = false;
    return legacy;
  }
  return dbTry(build(PRODUCT_COLUMNS_LEGACY));
}

async function dbProducts(build) {
  return (await dbProductsTry(build)).rows;
}

/**
 * The crawlable body for a product page, served inside `<noscript>`.
 *
 * Same reasoning as `boutiquePrerender`, applied to the pages that actually
 * convert. The head has always described the piece; the body shipped as an
 * empty `<div id="root">`, so every crawler that does not execute JavaScript —
 * Bing, WhatsApp's link preview, GPTBot, PerplexityBot, ClaudeBot — saw a
 * product page with a title and no text under it. Google does render, but on a
 * second pass that is queued separately and can trail the crawl by days, which
 * on a catalogue where pieces sell out in a week is most of the page's life.
 *
 * Everything here is the same text React paints, so there is no cloaking. As on
 * shop pages it goes in `<noscript>` rather than `#root`, which must stay empty
 * until React mounts or the `#root:not(:empty)` rule never retires the splash.
 */
function productPrerender(p, origin, url, shop, city) {
  const inStock = (p.stock ?? 0) > 0;
  const specs = [
    p.category && `Category: ${p.category}`,
    p.occasion && `Occasion: ${p.occasion}`,
    p.fabric && `Fabric: ${p.fabric}`,
    p.color && `Colour: ${p.color}`
  ].filter(Boolean);
  // The MRP is only worth printing when it is genuinely above the asking price;
  // sellers leave it equal to `price` more often than not.
  const savings = Number(p.mrp) > Number(p.price)
    ? ` (MRP ${inr(p.mrp)})`
    : "";
  const shopPath = p.boutiques?.slug ? `/boutique/${p.boutiques.slug}` : null;
  return `<noscript>
<h1>${escapeHtml(p.title)}</h1>
<p>${escapeHtml(inr(p.price))}${escapeHtml(savings)} · ${inStock ? "In stock" : "Sold out"}</p>
<p>${escapeHtml(
    p.description?.trim() || `${p.title} from ${shop}, ${city}. Sold on ${SITE_NAME} by a verified Tamil Nadu boutique.`
  )}</p>
${specs.length ? `<ul>\n${specs.map((s) => `<li>${escapeHtml(s)}</li>`).join("\n")}\n</ul>` : ""}
<p>Sold by ${shopPath ? `<a href="${escapeHtml(`${origin}${shopPath}`)}">${escapeHtml(shop)}</a>` : escapeHtml(shop)}, ${escapeHtml(city)}.</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(p.title)} on ${SITE_NAME}</a>${p.category ? ` · <a href="${escapeHtml(`${origin}/collections/${slugify(p.category)}`)}">More ${escapeHtml(titleCase(p.category))}</a>` : ""} · <a href="${origin}/shop">Shop all</a></p>
</noscript>`;
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
  const attempt = await dbProductsTry(
    (cols) => `products?select=${cols}&status=eq.active&deleted_at=is.null&limit=1&${filter}`
  );
  const p = attempt.rows[0];
  // A failed read means "we don't know" — serve the generic shell and leave the
  // page indexable. Only a successful read that found nothing is a real 404.
  if (!p) return attempt.ok ? notFoundMeta() : null;
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
    // The first gallery slide is the product page's LCP element. `ImageSlot` is
    // rendered there without a `sizes` prop, so it falls back to the component
    // default — repeated verbatim, because the preload has to match it exactly.
    lcpImage: p.image_url || void 0,
    lcpSizes: "(min-width: 768px) 320px, 50vw",
    type: "product",
    // A bare id, or a stale title slug, is rewritten to the canonical URL.
    redirectTo: `/products/${slug}` !== canonicalPath ? canonicalPath : void 0,
    prerender: productPrerender(p, origin, url, shop, city),
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
/** `working_days` is stored as 'Mon'\u2026'Sun'; schema.org wants the full name. */
const DAY_NAMES = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday"
};

function openingHoursSpec(b) {
  const days = (Array.isArray(b.working_days) ? b.working_days : [])
    .map((d) => DAY_NAMES[d])
    .filter(Boolean);
  if (!days.length || !b.open_time || !b.close_time) return void 0;
  return [{ "@type": "OpeningHoursSpecification", dayOfWeek: days, opens: b.open_time, closes: b.close_time }];
}

/**
 * The shop's own profiles elsewhere on the web.
 *
 * `sameAs` is how a search engine is told "this page and that Instagram account
 * are the same business" \u2014 without it the two compete as unrelated results for
 * the shop's name; with it they consolidate, and this page is the one on a
 * domain that also carries the catalogue, the address and the ratings.
 *
 * The column holds either a full URL or a bare handle, depending on which
 * onboarding screen filled it in, so both are normalised to a URL.
 */
function boutiqueSameAs(b) {
  const links = [];
  const instagram = b.instagram?.trim();
  if (instagram) {
    links.push(
      /^https?:\/\//i.test(instagram)
        ? instagram
        : `https://www.instagram.com/${instagram.replace(/^@/, "")}`
    );
  }
  return links.length ? links : void 0;
}

/**
 * The crawlable body for a shop page, served inside `<noscript>`.
 *
 * The head has always been written server-side, but the body shipped as an
 * empty `<div id="root">`: every word about the shop existed only after React
 * had mounted and fetched. Google renders JavaScript and would eventually get
 * there; Bing, WhatsApp, Slack, GPTBot and the rest largely do not, and even
 * for Google the rendered pass is queued separately and can trail the crawl by
 * days. A shop that is searched for by name deserves an answer in the first
 * response.
 *
 * `<noscript>` rather than pre-filling `#root`: the content is identical to
 * what the app paints, so there is no cloaking either way, but anything placed
 * in `#root` is visible to real users until React replaces it \u2014 an unstyled
 * flash of the same text \u2014 and would trip the `#root:not(:empty)` rule that
 * retires the splash screen.
 */
function boutiquePrerender(b, products, origin, url) {
  const city = [b.area, b.city].filter(Boolean).join(", ") || b.city || "Tamil Nadu";
  /*
   * Deduplicated: `city`, `area`, `district` and `address_line` overlap on most
   * rows — a shop in Dharapuram with nothing else filled in rendered "Boutique
   * in Dharapuram · Dharapuram". Compared case-insensitively because the
   * onboarding form does not normalise what the seller types.
   */
  const addressParts = [];
  let addressSoFar = city.toLowerCase();
  for (const raw of [b.address_line, b.district, b.state, b.pincode]) {
    const part = String(raw || "").trim();
    // Substring, not equality: `address_line` is free text and usually already
    // contains the town and the state ("75/35, Weavers Colony, Tiruppur, Tamil
    // Nadu"), so appending those columns repeated them a second time.
    if (!part || addressSoFar.includes(part.toLowerCase())) continue;
    addressParts.push(part);
    addressSoFar += `, ${part.toLowerCase()}`;
  }
  const address = addressParts.join(", ");
  const hours = b.open_time && b.close_time
    ? `${(Array.isArray(b.working_days) ? b.working_days : []).join(", ") || "Open"} \u00b7 ${b.open_time}\u2013${b.close_time}`
    : "";
  const rows = products.slice(0, 24).map(
    (p) => `<li><a href="${escapeHtml(`${origin}${productPath(p)}`)}">${escapeHtml(p.title)}</a> \u2014 ${escapeHtml(inr(p.price))}</li>`
  );
  return `<noscript>
<h1>${escapeHtml(b.name)}</h1>
<p>${escapeHtml(
    b.description?.trim() || `${b.name} is a verified boutique in ${city} selling ethnic wear on ${SITE_NAME}.`
  )}</p>
<p>Boutique in ${escapeHtml(city)}${address ? ` \u00b7 ${escapeHtml(address)}` : ""}${hours ? ` \u00b7 ${escapeHtml(hours)}` : ""}</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(b.name)} on ${SITE_NAME}</a> \u00b7 <a href="${origin}/boutiques">All boutiques</a></p>
${rows.length ? `<h2>Pieces from ${escapeHtml(b.name)}</h2>
<ul>
${rows.join("\n")}
</ul>` : ""}
</noscript>`;
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
  const attempt = await dbBoutiquesTry(
    (cols) => `boutiques?select=${cols}&status=eq.approved&limit=1&${filter}`
  );
  const b = attempt.rows[0];
  // As in metaForProduct: only a successful empty answer means "no such shop".
  if (!b) return attempt.ok ? notFoundMeta() : null;
  // Falls back to the id where migration 0057 has not been applied yet.
  const boutiquePath = `/boutique/${b.slug || b.id}`;
  const url = `${origin}${boutiquePath}`;
  /*
   * What the shop actually sells, second round trip.
   *
   * A store page that lists nothing is a thin page, and thin pages lose to the
   * shop's own Instagram. These titles are also the only text tying the shop's
   * name to what it stocks, which is what turns "<shop name>" into a match and
   * "<shop name> sarees" into one too.
   */
  const products = await dbProducts(
    (cols) => `products?select=${cols}&boutique_id=eq.${b.id}&status=eq.active&deleted_at=is.null&order=created_at.desc&limit=24`
  );
  const prices = products.map((p) => Number(p.price)).filter((n) => Number.isFinite(n) && n > 0);
  const city = b.city || "Tamil Nadu";
  const locality = [b.area, city].filter(Boolean).join(", ");
  return {
    // The shop's own name leads, unqualified and unabbreviated, because that is
    // the string being typed into the search box.
    title: `${b.name} \u2014 Boutique in ${city}`,
    description: clamp(
      b.description?.trim() || `Shop ${b.name}, a verified boutique in ${locality || city}. ${products.length ? `${products.length} pieces listed. ` : ""}Chat directly with the owner and get delivery across India.`
    ),
    image: b.logo_url || b.cover_url || void 0,
    type: "profile",
    redirectTo: `/boutique/${slug}` !== boutiquePath ? boutiquePath : void 0,
    prerender: boutiquePrerender(b, products, origin, url),
    schema: {
      "@context": "https://schema.org",
      "@graph": [
        orgNode(origin),
        {
          "@type": "ClothingStore",
          "@id": `${url}#boutique`,
          name: b.name,
          legalName: b.name,
          url,
          image: [b.cover_url, b.logo_url].filter(Boolean).length ? [b.cover_url, b.logo_url].filter(Boolean) : void 0,
          logo: b.logo_url || void 0,
          description: b.description?.trim() || `${b.name} is a verified boutique in ${locality || city}.`,
          telephone: b.phone || void 0,
          sameAs: boutiqueSameAs(b),
          foundingDate: b.established_year ? String(b.established_year) : void 0,
          address: {
            "@type": "PostalAddress",
            streetAddress: [b.address_line, b.area].filter(Boolean).join(", ") || b.area || void 0,
            addressLocality: b.city || void 0,
            addressRegion: b.state || "Tamil Nadu",
            postalCode: b.pincode || void 0,
            addressCountry: "IN"
          },
          areaServed: b.delivery_areas?.trim() || city,
          openingHoursSpecification: openingHoursSpec(b),
          currenciesAccepted: "INR",
          paymentAccepted: "Cash on Delivery, UPI, Card, Netbanking",
          priceRange: prices.length
            ? Math.min(...prices) === Math.max(...prices)
              ? inr(prices[0])
              : `${inr(Math.min(...prices))}\u2013${inr(Math.max(...prices))}`
            : void 0,
          parentOrganization: { "@id": `${origin}/#organization` },
          aggregateRating: (b.reviews_count ?? 0) > 0 && (b.rating ?? 0) > 0 ? {
            "@type": "AggregateRating",
            ratingValue: Number(b.rating),
            reviewCount: b.reviews_count,
            bestRating: 5,
            worstRating: 1
          } : void 0,
          hasOfferCatalog: products.length ? {
            "@type": "OfferCatalog",
            name: `${b.name} catalogue`,
            numberOfItems: products.length,
            itemListElement: products.map((p, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: `${origin}${productPath(p)}`,
              name: p.title
            }))
          } : void 0
        },
        // Breadcrumbs were on products and category pages but not here, so a
        // result for the shop had no path under it and no way to show Google
        // that a boutique sits inside a boutique directory.
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: origin },
            { "@type": "ListItem", position: 2, name: "Boutiques", item: `${origin}/boutiques` },
            { "@type": "ListItem", position: 3, name: b.name }
          ]
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
  },
  // \u2500\u2500 The written pages \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // These are in the sitemap, so crawlers ask for them \u2014 but they had no entry
  // here, which meant all nine shared one title ("MangaiMart") and one generic
  // description. Nine indexable URLs competing as duplicates of each other, and
  // the policy pages in particular are what a cautious buyer (and a payment
  // gateway's review) actually reads before trusting a new marketplace.
  "/about": {
    title: "About MangaiMart \u2014 One Place for Tamil Nadu\u2019s Boutiques",
    description: "Why MangaiMart exists, who runs it, and how we verify every boutique before it can list a single piece."
  },
  "/help": {
    title: "Help & Support \u2014 Orders, Delivery, Returns",
    description: "Answers on ordering, delivery timelines, returns, refunds and payments \u2014 plus how to reach a person if you still need one."
  },
  "/privacy-policy": {
    title: "Privacy Policy \u2014 What We Collect and Why",
    description: "What personal data MangaiMart collects, how it is used and stored, who it is shared with, and how to have it removed."
  },
  "/terms": {
    title: "Terms & Conditions",
    description: "The terms you agree to when you buy on MangaiMart, and the terms boutiques agree to when they sell here."
  },
  "/shipping-policy": {
    title: "Shipping Policy \u2014 Charges and Coverage",
    description: "What delivery costs on MangaiMart, when it is free, where we ship, and who handles the parcel."
  },
  "/delivery-policy": {
    title: "Delivery Policy \u2014 Timelines and Tracking",
    description: "How long a MangaiMart order takes to reach you, how dispatch works across boutiques, and how to track it."
  },
  "/return-refund-policy": {
    title: "Return & Refund Policy",
    description: "How to return a piece bought on MangaiMart, what qualifies, how long a refund takes and how it reaches you."
  },
  "/cancellation-policy": {
    title: "Cancellation Policy",
    description: "When a MangaiMart order can be cancelled, how to do it, and what happens to a payment already made."
  },
  "/product-policy": {
    title: "Product Policy \u2014 What Boutiques May List",
    description: "The listing standards every MangaiMart boutique agrees to: accurate photos, honest sizing, real stock and lawful goods."
  }
};
/**
 * The crawlable body for a category, occasion or fabric landing page.
 *
 * These are the pages built to win the head terms — "silk sarees online",
 * "office wear", "cotton kurta sets" — and they were shipping an empty body, so
 * the only text a non-rendering crawler could weigh against those queries was
 * the meta description. The product titles below are also the internal links
 * that let a crawler reach a piece without executing the grid.
 */
function collectionPrerender(heading, items, origin, url, description) {
  const rows = items.slice(0, 30).map(
    (p) => `<li><a href="${escapeHtml(`${origin}${productPath(p)}`)}">${escapeHtml(p.title)}</a> — ${escapeHtml(inr(p.price))}${p.boutiques?.name ? ` · ${escapeHtml(p.boutiques.name)}` : ""}</li>`
  );
  return `<noscript>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(description)}</p>
<ul>
${rows.join("\n")}
</ul>
<p><a href="${escapeHtml(url)}">${escapeHtml(heading)} on ${SITE_NAME}</a> · <a href="${origin}/collections">All collections</a> · <a href="${origin}/boutiques">All boutiques</a></p>
</noscript>`;
}

async function metaForCategory(kind, slug, origin) {
  const attempt = await dbProductsTry(
    (cols) => `products?select=${cols}&status=eq.active&deleted_at=is.null&limit=40`
  );
  if (!attempt.ok) return null;
  const items = attempt.rows.filter((p) => {
    const value = kind === "category" ? p.category : kind === "occasion" ? p.occasion : p.fabric;
    return value && slugify(value) === slug;
  });
  if (!items.length) return notFoundMeta();
  const term = (kind === "category" ? items[0].category : kind === "occasion" ? items[0].occasion : items[0].fabric) || slug;
  const heading = kind === "occasion" ? occasionHeading(term) : titleCase(term);
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
    prerender: collectionPrerender(heading, items, origin, url, description),
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
function websiteNode(origin) {
  return {
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
  };
}

/*
 * The /help questions, mirrored from the `help` entry in src/data/policies.ts.
 *
 * FAQPage markup is only legitimate when the same question and answer are
 * visible on the page, so these are the rendered headings and their first
 * paragraph verbatim. The two answers that interpolate company constants are
 * written with the constants' current values (support@mangaimart.com, a 7-day
 * return window) — if those change in src/data/company.ts they must change here
 * too, the same mirroring rule that applies to pricing.
 */
const HELP_FAQ = [
  {
    q: "Where is my order?",
    a: "Open My Orders and tap Track order. The timeline shows the stage your order has reached and updates as the boutique fulfils it. If it has not moved in more than two working days, message the boutique."
  },
  {
    q: "I paid but there is no order",
    a: "This is rare and it is recoverable. Your payment is captured and held against your session — reopen the payment screen and you will be offered “Complete my order”, which finishes the order without charging you a second time."
  },
  {
    q: "How do I return something?",
    a: "Within 7 days of delivery, open the order and message the boutique with photographs. See the Return & Refund Policy for what is eligible."
  },
  {
    q: "How do I change my address?",
    a: "Profile → Edit updates your saved delivery address for future orders. To change the address on an order already placed, message the boutique before it is dispatched."
  }
];

function faqNode(origin) {
  return {
    "@type": "FAQPage",
    "@id": `${origin}/help#faq`,
    mainEntity: HELP_FAQ.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a }
    }))
  };
}

/**
 * `/boutiques`, and `/boutiques/<city>` — the city landing pages.
 *
 * "Boutiques in Coimbatore" is a query with real local intent that the site had
 * no page for: the directory existed only as one national list whose city
 * filter lived in React state, so there was no URL to rank and nothing for a
 * crawler to reach. Each city with at least one approved shop now gets its own
 * indexable page, listed in the sitemap, with the shops named in the body.
 *
 * A city with no shops returns `notFoundMeta()` rather than an empty page, so
 * the space of `/boutiques/<anything>` cannot become a soft-404 farm.
 */
async function metaForBoutiquesHub(citySlug, origin) {
  const attempt = await dbBoutiquesTry(
    (cols) => `boutiques?select=${cols}&status=eq.approved&order=rating.desc&limit=200`
  );
  // A failed read is "we don't know", not "no such city": the directory falls
  // back to its written copy, and a city page serves the plain shell rather
  // than being marked `noindex` because Supabase blinked.
  if (!attempt.ok) {
    return citySlug ? null : {
      ...STATIC_META["/boutiques"],
      type: "website",
      schema: { "@context": "https://schema.org", "@graph": [orgNode(origin), websiteNode(origin)] }
    };
  }
  const all = attempt.rows;
  const shops = citySlug ? all.filter((b) => b.city && slugify(b.city) === citySlug) : all;
  if (citySlug && !shops.length) return notFoundMeta();

  const cityName = citySlug ? titleCase(shops[0].city) : null;
  const path = citySlug ? `/boutiques/${citySlug}` : "/boutiques";
  const url = `${origin}${path}`;
  const title = cityName
    ? `Boutiques in ${cityName} — Verified Ethnic Wear Shops`
    : STATIC_META["/boutiques"].title;
  const description = cityName
    ? clamp(
        `${shops.length} verified ${shops.length === 1 ? "boutique" : "boutiques"} in ${cityName} listing sarees, kurta sets and ethnic wear on ${SITE_NAME}. Chat directly with the shop and get delivery across India.`
      )
    : STATIC_META["/boutiques"].description;

  const rows = shops.slice(0, 60).map(
    (b) => `<li><a href="${escapeHtml(`${origin}/boutique/${b.slug || b.id}`)}">${escapeHtml(b.name)}</a>${b.city ? ` — ${escapeHtml([b.area, b.city].filter(Boolean).join(", "))}` : ""}</li>`
  );
  const prerender = `<noscript>
<h1>${escapeHtml(cityName ? `Boutiques in ${cityName}` : "Boutiques in Tamil Nadu")}</h1>
<p>${escapeHtml(description)}</p>
<ul>
${rows.join("\n")}
</ul>
<p><a href="${origin}/boutiques">All boutiques</a> · <a href="${origin}/collections">Shop by collection</a></p>
</noscript>`;

  return {
    title,
    description,
    image: shops.find((b) => b.logo_url || b.cover_url)?.logo_url || void 0,
    type: "website",
    prerender,
    schema: {
      "@context": "https://schema.org",
      "@graph": [
        orgNode(origin),
        {
          "@type": "CollectionPage",
          "@id": `${url}#collection`,
          name: cityName ? `Boutiques in ${cityName}` : "Boutiques in Tamil Nadu",
          description,
          url,
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: shops.length,
            itemListElement: shops.slice(0, 60).map((b, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: `${origin}/boutique/${b.slug || b.id}`,
              name: b.name
            }))
          }
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: origin },
            { "@type": "ListItem", position: 2, name: "Boutiques", item: `${origin}/boutiques` },
            ...cityName ? [{ "@type": "ListItem", position: 3, name: cityName }] : []
          ]
        }
      ]
    }
  };
}

/**
 * `/shop` — the everything grid.
 *
 * Its only job here is discovery: 40 product links in the first response give a
 * non-rendering crawler a path into the catalogue that does not depend on
 * executing an infinite-scroll grid.
 */
async function shopHubPrerender(origin) {
  const products = await dbProducts(
    (cols) => `products?select=${cols}&status=eq.active&deleted_at=is.null&order=created_at.desc&limit=40`
  );
  if (!products.length) return void 0;
  const rows = products.map(
    (p) => `<li><a href="${escapeHtml(`${origin}${productPath(p)}`)}">${escapeHtml(p.title)}</a> — ${escapeHtml(inr(p.price))}</li>`
  );
  return `<noscript>
<h1>Shop All Ethnic Wear</h1>
<p>${escapeHtml(STATIC_META["/shop"].description)}</p>
<ul>
${rows.join("\n")}
</ul>
<p><a href="${origin}/collections">Shop by collection</a> · <a href="${origin}/boutiques">All boutiques</a> · <a href="${origin}/new-arrivals">New arrivals</a></p>
</noscript>`;
}

/**
 * The home page's LCP element: the image of the first live `home_hero` ad.
 *
 * The hero is a paid placement, so there is nothing static to preload — the URL
 * is a database row. `fetchLiveAds()` in src/data/ads.ts reads the same rows
 * through RLS (which already restricts anonymous reads to live campaigns inside
 * their window); the filters are repeated here because the edge has to answer
 * before the app exists.
 *
 * ── Both sides must agree on which slide is FIRST ───────────────────────
 * The app marks `SLIDES[0]` as the priority image, and `fetchLiveAds()` used to
 * return rows in whatever order PostgREST happened to produce. With more than
 * one hero live that is not stable, so the edge could preload a slide the app
 * then renders second — paying for an image that is not the LCP and still
 * discovering the real one late. Both now order by `start_at` then `id`.
 */
async function homeHeroImage() {
  const now = new Date().toISOString();
  const { rows } = await dbTryTwice(
    "ad_campaigns?select=id,placement_code,status,image_url,start_at,end_at" +
      "&placement_code=eq.home_hero&status=eq.live&order=start_at.asc.nullslast,id.asc&limit=8"
  );
  const live = rows.find(
    (a) => a.image_url && (!a.start_at || a.start_at <= now) && (!a.end_at || a.end_at > now)
  );
  return live?.image_url || void 0;
}

async function resolveMeta(pathname, origin) {
  // Handled before STATIC_META: these two hubs keep their written copy but gain
  // a database-backed body and ItemList, so a crawler leaves with links.
  if (pathname === "/boutiques") return metaForBoutiquesHub(null, origin);
  const city = pathname.match(/^\/boutiques\/([^/]+)$/);
  if (city) return metaForBoutiquesHub(decodeURIComponent(city[1]).toLowerCase(), origin);

  const staticMeta = STATIC_META[pathname];
  if (staticMeta) {
    const graph = [orgNode(origin), websiteNode(origin)];
    if (pathname === "/help") graph.push(faqNode(origin));
    return {
      ...staticMeta,
      type: "website",
      prerender: pathname === "/shop" ? await shopHubPrerender(origin) : void 0,
      // The hero carousel is full-bleed — `sizes="100vw"` in Home.tsx.
      lcpImage: pathname === "/" ? await homeHeroImage() : void 0,
      lcpSizes: "100vw",
      schema: { "@context": "https://schema.org", "@graph": graph }
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
  // Nothing recognised the path, and it is not one of the private prefixes that
  // `isNoIndex` already covers — so the router will land on the 404 screen.
  // Say so in the head rather than serving it as another indexable page.
  return isNoIndex(pathname) ? null : notFoundMeta();
}
// A publicly reachable deploy that is not the live domain — i.e. a Vercel
// preview URL, which serves the identical catalogue from the identical
// database. Crawled, every product exists at two addresses and a throwaway
// preview can outrank mangaimart.com for its own stock.
//
// Only *.vercel.app is treated this way. Localhost is deliberately exempt: no
// crawler can reach it, and `npm run verify:seo` drives this middleware over
// 127.0.0.1 with the production .env loaded, so pinning on host alone would
// make every page in that run assert as noindex.
function isPreviewHost(url) {
  // Vercel's own word for it, where we have it. A branch preview is a preview
  // whatever host it answers on.
  if (VERCEL_ENV === "preview") return true;
  const host = url.hostname.toLowerCase();
  // Otherwise only *.vercel.app. Localhost stays exempt (see above).
  if (!host.endsWith(".vercel.app")) return false;
  // `!!CANONICAL_HOST &&` used to lead this expression, which meant the guard
  // switched itself off whenever VITE_SITE_URL was unset — precisely the
  // configuration in which nothing else is protecting the live domain either.
  // A *.vercel.app host is a deploy URL by construction and never the custom
  // domain, so it is a preview unless it somehow IS the canonical host.
  return host !== CANONICAL_HOST;
}

/**
 * Is this request arriving on a host that is not the one we want to rank?
 *
 * Two live examples, both of which put a second copy of the entire catalogue
 * into Google under a name that is not the brand:
 *
 *   · `agilam-boutiques.vercel.app` — the Vercel production alias. It served
 *     the identical catalogue from the identical database with a canonical tag
 *     pointing at itself, so "Agilam" appeared in search results for a shop
 *     called MangaiMart, competing with mangaimart.com for its own stock.
 *   · `www.mangaimart.com` — answered 200 with no redirect, making the apex and
 *     the www host two separate indexable sites.
 *
 * A 301 rather than a canonical tag or `noindex`: a redirect is the only signal
 * that both removes the duplicate from the index AND passes its accumulated
 * ranking to the address that should have it. Anything already indexed under
 * the old host drops out on its own once Google recrawls it.
 *
 * Production only. A branch preview must keep answering on its own URL or it
 * cannot be tested before release; `isPreviewHost` keeps that one out of the
 * index instead. Locally VERCEL_ENV is unset, so nothing here ever fires.
 */
function isNonCanonicalHost(url) {
  if (VERCEL_ENV !== "production") return false;
  return url.hostname.toLowerCase() !== CANONICAL_HOST;
}
function headFor(meta, canonical, origin, pathname, forceNoindex) {
  const title = meta ? `${meta.title} \xB7 ${SITE_NAME}` : SITE_NAME;
  const description = meta?.description || DEFAULT_DESCRIPTION;
  const image = meta?.image ? meta.image.startsWith("http") ? meta.image : `${origin}${meta.image}` : `${origin}${DEFAULT_OG_IMAGE}`;
  const robots = forceNoindex || isNoIndex(pathname) || meta?.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
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
  // Performance hints, not metadata — but they belong in the same injection
  // because this is the only place that knows the LCP image before React does.
  const preconnect = supabasePreconnect();
  if (preconnect) tags.push(preconnect);
  if (meta?.lcpImage) tags.push(lcpPreload(meta.lcpImage, meta.lcpSizes));
  if (meta?.schema) {
    tags.push(
      `<script type="application/ld+json" data-edge-schema>${JSON.stringify(meta.schema).replace(/</g, "\\u003c")}</script>`
    );
  }
  return `<title>${escapeHtml(title)}</title>
${tags.join("\n")}`;
}
function previewRobotsTxt(origin) {
  return `# MangaiMart \u2014 preview deploy (${origin})
#
# Not the live site. This deploy serves the same catalogue from the same
# database, so indexing it would duplicate every product page and compete with
# https://${CANONICAL_HOST}. No Sitemap: line either, for the same reason.

User-agent: *
Disallow: /
`;
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

# The index is enough for Google, which follows it. The children are named as
# well because Bing and several smaller crawlers historically read only the
# first Sitemap: line and never expand a <sitemapindex>.
Sitemap: ${origin}/sitemap.xml
${SITEMAP_CHILDREN.map((path) => `Sitemap: ${origin}${path}`).join("\n")}
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
/*
 * ── Why the sitemap is an index of three ─────────────────────────────────
 *
 * It used to be one document, which meant one edge request did the 5000-row
 * product read AND the 2000-row boutique read, each against the 1500 ms abort
 * in `dbTry`. Losing either one served a sitemap missing a whole section, and
 * the odds of losing one of two reads are roughly twice the odds of losing one.
 *
 * Split, each child does a single read — and the lightest of them, the page
 * sitemap, no longer needs the wide column lists at all, because a facet only
 * needs `category/occasion/fabric` and a city only needs `city`.
 *
 * It also makes Search Console useful: "Pages: 41 discovered, 39 indexed" for
 * one blob says nothing, whereas the same numbers per section say whether it is
 * the catalogue or the directory that is not getting in.
 */
const SITEMAP_CHILDREN = ["/sitemap-pages.xml", "/sitemap-boutiques.xml", "/sitemap-products.xml"];

function sitemapIndexXml(origin, lastmod) {
  const entries = SITEMAP_CHILDREN.map(
    (path) => `<sitemap><loc>${escapeHtml(`${origin}${path}`)}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ""}</sitemap>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</sitemapindex>`;
}

function wrapUrlset(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join("\n")}
</urlset>`;
}

/** The newest live product's date — every hub is exactly as fresh as that. */
async function newestProductDate() {
  const { rows } = await dbTryTwice(
    "products?select=created_at&status=eq.active&deleted_at=is.null&order=created_at.desc&limit=1"
  );
  return rows[0]?.created_at || void 0;
}

/**
 * Hubs, facet landings, city landings and the written pages.
 *
 * Reads only the four columns it actually needs, so it never touches the
 * migration-0057 column fallback and stays well inside the abort budget.
 */
async function sitemapPagesXml(origin) {
  const [facetRead, cityRead] = await Promise.all([
    dbTryTwice("products?select=category,occasion,fabric,created_at&status=eq.active&deleted_at=is.null&order=created_at.desc&limit=5000"),
    dbTryTwice("boutiques?select=city&status=eq.approved&limit=2000")
  ]);
  const products = facetRead.rows;
  /*
   * Every URL gets a `lastmod`.
   *
   * Google states plainly that it ignores `<changefreq>` and `<priority>` and
   * uses `<lastmod>` — when it is consistently accurate — to decide what is
   * worth re-crawling. A hub is only as fresh as the newest thing in it, which
   * for every page in this file is the newest live product, so that date is both
   * honest and exactly what "has this page changed?" means here. The written
   * pages get the same date rather than a fabricated one: they genuinely do
   * change when the catalogue behind their examples does, and an invented daily
   * timestamp is the thing that teaches Google to stop trusting the field.
   */
  const newest = products.reduce(
    (latest, p) => (p.created_at && p.created_at > latest ? p.created_at : latest),
    ""
  ) || void 0;

  const entries = [
    urlEntry(`${origin}/`, { lastmod: newest, changefreq: "daily", priority: "1.0" }),
    urlEntry(`${origin}/collections`, { lastmod: newest, changefreq: "daily", priority: "0.9" }),
    urlEntry(`${origin}/shop`, { lastmod: newest, changefreq: "daily", priority: "0.8" }),
    urlEntry(`${origin}/boutiques`, { lastmod: newest, changefreq: "daily", priority: "0.9" }),
    urlEntry(`${origin}/new-arrivals`, { lastmod: newest, changefreq: "daily", priority: "0.8" }),
    urlEntry(`${origin}/best-sellers`, { lastmod: newest, changefreq: "daily", priority: "0.8" }),
    urlEntry(`${origin}/top-boutiques`, { lastmod: newest, changefreq: "weekly", priority: "0.7" }),
    urlEntry(`${origin}/inspire`, { lastmod: newest, changefreq: "daily", priority: "0.6" })
  ];

  const facets = {
    collections: /* @__PURE__ */ new Set(),
    occasions: /* @__PURE__ */ new Set(),
    fabrics: /* @__PURE__ */ new Set()
  };
  for (const p of products) {
    if (p.category) facets.collections.add(slugify(p.category));
    if (p.occasion) facets.occasions.add(slugify(p.occasion));
    if (p.fabric) facets.fabrics.add(slugify(p.fabric));
  }
  for (const [prefix, values] of Object.entries(facets)) {
    for (const slug of values) {
      if (slug) entries.push(urlEntry(`${origin}/${prefix}/${slug}`, { lastmod: newest, changefreq: "daily", priority: "0.85" }));
    }
  }

  // One landing page per city that actually has an approved shop — the set the
  // middleware will serve, so the sitemap can never advertise a soft 404.
  const cities = /* @__PURE__ */ new Set();
  for (const b of cityRead.rows) {
    const slug = slugify(b.city || "");
    if (slug) cities.add(slug);
  }
  for (const slug of cities) {
    entries.push(urlEntry(`${origin}/boutiques/${slug}`, { lastmod: newest, changefreq: "weekly", priority: "0.75" }));
  }

  for (const slug of POLICY_SLUGS) {
    entries.push(urlEntry(`${origin}/${slug}`, { lastmod: newest, changefreq: "monthly", priority: "0.3" }));
  }
  return wrapUrlset(entries);
}

async function sitemapBoutiquesXml(origin) {
  // Deliberately the lean list, not `dbBoutiquesTry`: a sitemap row needs an
  // id, a slug, a name and a date. The rich columns are for the shop page.
  const boutiques = (await dbTryTwice(`boutiques?select=${BOUTIQUE_COLUMNS_CORE}&status=eq.approved&limit=2000`)).rows;
  /*
   * A shop page changes when that shop lists something, so its `lastmod` is the
   * date of its own newest piece — not a catalogue-wide date, which would be
   * the fabricated daily timestamp this file warns about, and not its
   * `created_at`, which froze on the day it signed up.
   */
  const newestPerBoutique = /* @__PURE__ */ new Map();
  for (const p of (await dbTryTwice("products?select=boutique_id,created_at&status=eq.active&deleted_at=is.null&order=created_at.desc&limit=5000")).rows) {
    if (!p.boutique_id || !p.created_at) continue;
    const seen = newestPerBoutique.get(p.boutique_id);
    if (!seen || p.created_at > seen) newestPerBoutique.set(p.boutique_id, p.created_at);
  }
  return wrapUrlset(
    boutiques.map((b) =>
      urlEntry(`${origin}/boutique/${b.slug || b.id}`, {
        lastmod: newestPerBoutique.get(b.id) || b.created_at || void 0,
        changefreq: "daily",
        priority: "0.9",
        image: b.logo_url || b.cover_url || void 0,
        title: b.name
      })
    )
  );
}

async function sitemapProductsXml(origin) {
  const products = await dbProducts(
    (cols) => `products?select=${cols}&status=eq.active&deleted_at=is.null&order=created_at.desc&limit=5000`
  );
  return wrapUrlset(
    products.map((p) =>
      urlEntry(`${origin}${productPath(p)}`, {
        lastmod: p.created_at || void 0,
        changefreq: "weekly",
        priority: "0.7",
        image: p.image_url || void 0,
        title: p.title
      })
    )
  );
}

const SITEMAP_HANDLERS = {
  "/sitemap-pages.xml": sitemapPagesXml,
  "/sitemap-boutiques.xml": sitemapBoutiquesXml,
  "/sitemap-products.xml": sitemapProductsXml
};

/* ── The Google Merchant Center feed ──────────────────────────────────────
 *
 * `/merchant-feed.xml` — RSS 2.0 with the `g:` namespace, one <item> per live
 * product. Merchant Center is pointed at it on a daily schedule and pulls the
 * whole catalogue; a piece that sells out or is delisted drops out of Shopping
 * within a day, with nothing uploaded by hand.
 *
 * Free Shopping listings are a separate index from web search, with their own
 * surface and considerably more commercial intent per impression. None of the
 * on-page work in this file reaches it — Google will not build a Shopping
 * listing from `Product` markup on a marketplace it has no verified merchant
 * relationship with. This is the only route in.
 *
 * ── Why it lives at the edge and not in api/ ────────────────────────────
 * `api/` holds exactly 12 serverless functions, which IS the Vercel Hobby
 * ceiling — a 13th fails the deploy. Written as `api/merchant-feed.js` first,
 * which is why this comment exists. It is the same reason the sitemap is here
 * rather than at `/api/sitemap`, and the fit is just as good: this is a public,
 * anonymous, cacheable read of the same catalogue the sitemap already walks.
 *
 * ── Fields ──────────────────────────────────────────────────────────────
 * Google's apparel requirements (`gender`, `age_group`, `size`) bind only in a
 * handful of target countries, and India is not among them — so they are
 * emitted where the data is genuinely known and omitted otherwise rather than
 * guessed. A wrong `age_group` is an item disapproval; a missing one is not.
 *
 * One item per product, NOT one per size. Apparel feeds usually emit a variant
 * per size sharing an `item_group_id`, which requires per-size stock that this
 * catalogue does not track — every variant would carry the parent's
 * availability and Merchant Center would eventually flag the mismatch against
 * the landing page.
 */

// `sizes` and `images` are not in the shared column lists because every other
// consumer (sitemap, page metadata) would then carry two arrays it never reads,
// on queries that fetch up to 5000 rows. Appended here so the feed still goes
// through `dbProductsTry` and inherits its migration-0057 `slug` fallback.
const FEED_EXTRA_COLUMNS = "sizes,images";

/**
 * The single Google taxonomy node that is true of every piece in this catalogue.
 *
 * Deliberately not mapped per category. A category Google does not recognise is
 * an item-level error, and the seller-typed vocabulary ("Half saree", "Office
 * wear" — see [[catalogue-vocabulary]]) does not map onto the taxonomy cleanly
 * enough to risk it catalogue-wide. The seller's own terms go into
 * `product_type`, which is free text and is not validated against the taxonomy.
 */
const GOOGLE_PRODUCT_CATEGORY = "Apparel & Accessories > Clothing";

/**
 * Google rejects a description containing markup and truncates at 5000 chars.
 *
 * `[^\P{C}\n\r\t]` reads as "in Unicode category C, but not tab/newline/CR" —
 * C being control, format, unassigned, private-use and surrogate. That covers
 * both what sellers paste out of WhatsApp and Word and the zero-width and bidi
 * format characters that make an XML feed unparseable. Tab, newline and CR are
 * spared so the `\s+` collapse below turns them into spaces rather than welding
 * two words together.
 */
function feedText(value, max) {
  const clean = String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\P{C}\n\r\t]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Google wants `1299.00 INR` — two decimals, a space, the ISO code. */
function feedPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(2)} INR` : null;
}

function feedTag(name, value) {
  return value === null || value === void 0 || value === "" ? "" : `<${name}>${escapeHtml(value)}</${name}>`;
}

function feedItem(p, origin) {
  const image = p.image_url;
  // No photo means no listing — Merchant Center rejects the item outright, and
  // an error rate across a large slice of the feed can suspend the account.
  if (!image) return null;

  const price = Number(p.price);
  const mrp = Number(p.mrp);
  // Google's contract: `price` is the regular price and `sale_price` the
  // discounted one. Sellers routinely leave MRP equal to (or below) the asking
  // price, in which case there is no sale to declare.
  const onSale = Number.isFinite(mrp) && mrp > price;
  const regular = feedPrice(onSale ? mrp : price);
  if (!regular) return null;

  const sizes = (Array.isArray(p.sizes) ? p.sizes : []).filter(Boolean);
  const extraImages = (Array.isArray(p.images) ? p.images : [])
    .filter((src) => src && src !== image)
    .slice(0, 10);
  const shop = feedText(p.boutiques?.name, 70);

  return [
    "<item>",
    feedTag("g:id", p.id),
    feedTag("g:title", feedText(p.title, 150)),
    feedTag(
      "g:description",
      feedText(p.description, 5000) ||
        `${feedText(p.title, 120)} from ${shop || "a verified Tamil Nadu boutique"} on ${SITE_NAME}.`
    ),
    feedTag("g:link", `${origin}${productPath(p)}`),
    feedTag("g:image_link", image),
    ...extraImages.map((src) => feedTag("g:additional_image_link", src)),
    feedTag("g:availability", (p.stock ?? 0) > 0 ? "in_stock" : "out_of_stock"),
    feedTag("g:condition", "new"),
    feedTag("g:price", regular),
    onSale ? feedTag("g:sale_price", feedPrice(price)) : "",
    feedTag("g:brand", shop || SITE_NAME),
    // No GTIN or MPN exists for a one-off boutique piece, and saying so is what
    // stops Google treating the item as missing a required identifier.
    feedTag("g:identifier_exists", "no"),
    feedTag("g:google_product_category", GOOGLE_PRODUCT_CATEGORY),
    feedTag("g:product_type", [p.category, p.occasion].filter(Boolean).map((s) => feedText(s, 60)).join(" > ")),
    feedTag("g:color", feedText(p.color, 40)),
    feedTag("g:material", feedText(p.fabric, 40)),
    // Only when the piece comes in exactly one size. A list would have to be a
    // variant group, which needs the per-size stock described above.
    sizes.length === 1 ? feedTag("g:size", feedText(sizes[0], 20)) : "",
    "</item>"
  ].filter(Boolean).join("\n");
}

async function merchantFeedXml(origin) {
  const attempt = await dbProductsTry(
    (cols) => `products?select=${cols},${FEED_EXTRA_COLUMNS}&status=eq.active&deleted_at=is.null&order=created_at.desc&limit=5000`
  );
  // A failed read must not become an empty feed: an empty feed tells Merchant
  // Center the catalogue was withdrawn and it delists every product. Returning
  // null makes the caller answer 503, which makes it keep the last good one.
  if (!attempt.ok) return null;
  const items = attempt.rows.map((p) => feedItem(p, origin)).filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${SITE_NAME} — Boutique Ethnic Wear from Tamil Nadu</title>
<link>${escapeHtml(origin)}</link>
<description>${escapeHtml(DEFAULT_DESCRIPTION)}</description>
${items.join("\n")}
</channel>
</rss>`;
}
export default async function middleware(request) {
  try {
    const url = new URL(request.url);
    const { pathname, origin } = url;
    const legacyPath = legacyRedirectPath(pathname);
    // The two rewrites are resolved together so a legacy path arriving on a
    // non-canonical host costs ONE redirect rather than a chain of two. Google
    // follows chains, but it discounts them, and every hop is a round trip on
    // the 3G connections most of this marketplace's buyers are on.
    if (isNonCanonicalHost(url)) {
      return new Response(null, {
        status: 301,
        headers: {
          location: `https://${CANONICAL_HOST}${legacyPath || pathname}${url.search}`,
          "cache-control": "public, max-age=3600"
        }
      });
    }
    if (legacyPath) {
      return new Response(null, {
        status: 301,
        headers: { location: `${origin}${legacyPath}${url.search}`, "cache-control": "public, max-age=3600" }
      });
    }
    const preview = isPreviewHost(url);
    if (pathname === "/robots.txt") {
      return new Response(preview ? previewRobotsTxt(origin) : robotsTxt(origin), {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": `public, max-age=0, s-maxage=${SITEMAP_CACHE_SECONDS}`
        }
      });
    }
    const sitemapHeaders = {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": `public, max-age=0, s-maxage=${SITEMAP_CACHE_SECONDS}, stale-while-revalidate=86400`
    };
    if (pathname === "/sitemap.xml") {
      return new Response(sitemapIndexXml(origin, await newestProductDate()), { headers: sitemapHeaders });
    }
    const sitemapChild = SITEMAP_HANDLERS[pathname];
    if (sitemapChild) {
      return new Response(await sitemapChild(origin), { headers: sitemapHeaders });
    }
    if (pathname === "/merchant-feed.xml") {
      const feed = await merchantFeedXml(origin);
      // 503 rather than an empty feed — see `merchantFeedXml`. Preview deploys
      // are refused outright: pointed at one, Merchant Center would take
      // *.vercel.app URLs as the landing pages for the whole catalogue.
      if (!feed || preview) {
        return new Response("Feed unavailable", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      return new Response(feed, { headers: sitemapHeaders });
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
    let injected = html.replace("<title>MangaiMart</title>", headFor(meta, canonical, origin, pathname, preview)).replace('<html lang="en">', '<html lang="en-IN">');
    // Nothing was replaced: the shell is not the one this expects, so serve it
    // untouched rather than a page with a made-up head. Checked before the body
    // injection below, so a changed shell can never be served with a prerender
    // block but no metadata.
    if (injected === html) return void 0;
    // Crawlable body content, where the page has any (shop pages do). Anchored
    // on the boot splash rather than on `#root`, which must stay empty until
    // React mounts — see `boutiquePrerender`.
    if (meta?.prerender) {
      injected = injected.replace('<div id="ag-boot"', `${meta.prerender}\n<div id="ag-boot"`);
    }
    const headers = new Headers({
      "content-type": "text/html; charset=utf-8",
      "cache-control": `public, max-age=0, s-maxage=${PAGE_CACHE_SECONDS}, stale-while-revalidate=86400`
    });
    if (preview || isNoIndex(pathname) || meta?.noindex) headers.set("x-robots-tag", "noindex, nofollow");
    return new Response(injected, { headers });
  } catch {
    return void 0;
  }
}
