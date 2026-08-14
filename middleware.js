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
const DEFAULT_DESCRIPTION = "Shop verified independent boutiques across India in one place \u2014 sarees, kurta sets, kurtis and more, with direct chat to the shop.";
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
// The admin console's URL segment, mirroring src/lib/adminPath.ts. Kept OUT of
// robots.txt on purpose — a Disallow line publishes the path to everyone who
// reads it, which is the opposite of why it was moved off /admin. An
// X-Robots-Tag header does the same job without announcing anything.
const ADMIN_SEGMENT = (process.env.VITE_ADMIN_PATH || "admin").trim().replace(/^\/+|\/+$/g, "") || "admin";
const NOINDEX_PREFIXES = [
  `/${ADMIN_SEGMENT}`,
  // No longer routed — the console moved — but still unindexable in case
  // anything old links it.
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
  // "Ask my people" boards (migration 0077). `/shortlists` is her own private
  // list; `/shortlist/<token>` is a link shared with four relatives, and a
  // private family conversation is the last thing that should be indexable —
  // the token is a credential, and an indexed one is a leaked one.
  "/shortlists",
  "/shortlist",
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
    description: "That page isn\u2019t available. Browse the full catalogue of verified independent boutiques on MangaiMart instead.",
    type: "website",
    noindex: true,
    // Suppresses the canonical + og:url tags in headFor(). A canonical that
    // points AT a URL whose subject does not exist is a contradiction: it tells
    // a crawler this is the preferred version of a page we are simultaneously
    // asking it not to index. `noindex` does the real work; the self-reference
    // was only ever noise.
    notFound: true
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
 * Did the server reject this query because of a column it names?
 *
 * Two ways that happens, and the fallbacks below have to key on both:
 *   · 400 (SQLSTATE 42703) — the column does not exist. A deployment running
 *     ahead of its migrations.
 *   · 401/403 (SQLSTATE 42501) — the column exists but this role may not read
 *     it. A migration revoked the grant; 0021 and 0073 both did exactly this.
 *
 * Only 400 was recognised, so when 0073 took `phone` away from anon the ladder
 * saw a plain failure, declined to downgrade, and every boutique page went
 * blank until someone fetched one by hand. Both answers are deterministic —
 * re-running the identical query cannot change either — which is also why
 * `dbTryTwice` must not waste its retry on them.
 *
 * Everything else that makes a query fail — the 1500 ms abort above, a network
 * blip, a 5xx from Supabase — is transient and says nothing about the columns.
 * The distinction matters because the two column fallbacks are sticky: they
 * remember the downgrade for the life of the edge instance. Treating "the
 * sitemap's 2000-row read timed out" as "this deployment predates migration
 * 0021" retired the rich columns permanently, and every shop page served by
 * that instance afterwards silently lost its address, hours and Instagram link.
 */
function isColumnRejection(attempt) {
  return attempt.status === 400 || attempt.status === 401 || attempt.status === 403;
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
  if (attempt.ok || isColumnRejection(attempt)) return attempt;
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
 *
 * ── `phone` and `whatsapp` are NOT here, and must never come back ────────
 * Migration 0073 revoked `select (email, phone, whatsapp)` on `boutiques` from
 * anon — scrapers were harvesting the seller contact book with a single REST
 * call. Both lists still named `phone`, and PostgREST answers a revoked column
 * by refusing the WHOLE query (401, SQLSTATE 42501), so from the moment 0073
 * was applied every boutique read at the edge returned nothing: all nine shop
 * pages and all six city landings served a bare shell with no title, and
 * `sitemap-boutiques.xml` went out empty. src/data/boutiques.ts already moved
 * these three to the `boutique_private()` RPC; the edge has no session to call
 * it with, and a public shop page has no business printing the number anyway.
 */
// The lean list: everything the sitemap and a link preview need. It doubles as
// the fallback for a database where 0021's column grant has not been applied.
const BOUTIQUE_COLUMNS_CORE = "id,name,slug,city,area,description,logo_url,cover_url,rating,reviews_count,created_at";
const BOUTIQUE_COLUMNS = `${BOUTIQUE_COLUMNS_CORE},instagram,established_year,address_line,district,state,pincode,open_time,close_time,working_days,delivery_areas,category`;
let boutiqueColumnsAvailable = true;

/** `dbProductsTry`, for boutiques. Retries once on the pre-0021 column list. */
async function dbBoutiquesTry(build) {
  if (boutiqueColumnsAvailable) {
    const attempt = await dbTryTwice(build(BOUTIQUE_COLUMNS));
    // Succeeded, or failed for a reason that has nothing to do with the schema
    // (see `isColumnRejection`) — either way, do not downgrade.
    if (attempt.ok || !isColumnRejection(attempt)) return attempt;
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
// MUST equal WIDTHS in src/lib/imageUrl.ts, in the same order. 1600 was added
// there for full-bleed heroes and never added here, so on any viewport wide
// enough to want it the <img> asked for 1600 while this preload had fetched
// 1280 — the home hero was downloaded twice and the LCP still started late,
// which is precisely the second download this whole module exists to avoid.
// verify:seo now reads the list out of imageUrl.ts rather than restating it.
const IMAGE_WIDTHS = [240, 480, 800, 1280, 1600];
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

/*
 * The spellings people actually type.
 *
 * "Mangai Mart" as two words is a substantial share of the brand's own-name
 * searches, and nothing on the site said the two strings are the same entity —
 * so the spaced form had no signal tying it to this domain. `alternateName` is
 * how a knowledge panel learns a brand's variants; it is not a keyword list,
 * so only genuine spellings of the name belong here.
 *
 * Mirrors `organizationSchema()` in src/lib/schema.ts — the same rule as
 * SOCIAL_PROFILES above: the edge copy is the one crawlers read, so the two
 * must be changed together or the entity drifts.
 */
const BRAND_ALTERNATE_NAMES = ["Mangai Mart", "MangaiMart Boutique", "MangaiMart India"];
// Mirrors COMPANY.email / COMPANY.phone in src/data/company.ts.
const SUPPORT_EMAIL = "support@mangaimart.com";
const SUPPORT_PHONE = "+91 93442 94969";

function orgNode(origin) {
  return {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: SITE_NAME,
    alternateName: BRAND_ALTERNATE_NAMES,
    url: origin,
    logo: `${origin}${DEFAULT_OG_IMAGE}`,
    description: DEFAULT_DESCRIPTION,
    email: SUPPORT_EMAIL,
    telephone: SUPPORT_PHONE,
    foundingDate: "2024",
    // A reachable contact is one of the trust signals Google weighs on a
    // commerce domain, and the only structured place a buyer-facing support
    // channel is stated. `availableLanguage` matters here: the catalogue is
    // Tamil Nadu-weighted and support genuinely answers in both languages.
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        telephone: SUPPORT_PHONE,
        email: SUPPORT_EMAIL,
        areaServed: "IN",
        availableLanguage: ["en", "ta"]
      }
    ],
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

/**
 * Every image for a product, cover first, as an array for a `Product` node.
 *
 * `images` is a text[] that may or may not already contain the cover, depending
 * on which version of the seller upload form wrote the row, so the two are
 * merged and deduplicated rather than concatenated.
 */
function productImages(p) {
  const all = [p.image_url, ...Array.isArray(p.images) ? p.images : []]
    .map((u) => String(u || "").trim())
    .filter(Boolean);
  const unique = [...new Set(all)];
  return unique.length ? unique : void 0;
}

/** One year out, as YYYY-MM-DD. See the `priceValidUntil` comment on Offer. */
function priceValidUntil() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The newest few real reviews of a product, as schema.org `Review` nodes.
 *
 * `aggregateRating` was already emitted and is what earns the star rich result,
 * but the individual reviews existed only in React state — fetched by
 * `ProductReviews`, which is inside a collapsed accordion, so it does not even
 * mount until a buyer opens it. Nothing a crawler or an AI assistant reads ever
 * contained a single word a customer had written about a piece.
 *
 * Read separately rather than joined onto the product query: PostgREST can only
 * embed `reviews` here if a foreign key is exposed, and naming a relationship
 * that isn't there fails the WHOLE product query — which would blank the page's
 * metadata, exactly the failure mode the column fallbacks above exist to avoid.
 * A failed or slow read simply yields no review nodes; the page is unaffected.
 *
 * `hidden` is filtered the same way `fetchReviews()` does, so a review an admin
 * has taken down (migration 0048) cannot reappear in the markup.
 */
async function productReviewNodes(productId) {
  const { rows } = await dbTry(
    `reviews?select=rating,body,author_name,created_at,hidden&product_id=eq.${productId}` +
      "&order=created_at.desc&limit=5"
  );
  return rows
    .filter((r) => !r.hidden && Number(r.rating) > 0 && String(r.body || "").trim())
    .map((r) => ({
      "@type": "Review",
      // Google requires a named author. Reviews are posted by signed-in buyers
      // and `author_name` is the display name they chose; where it is blank the
      // honest answer is that the reviewer is anonymous, not a fabricated name.
      author: { "@type": "Person", name: r.author_name?.trim() || "Verified buyer" },
      datePublished: r.created_at ? r.created_at.slice(0, 10) : void 0,
      reviewBody: clamp(r.body, 500),
      reviewRating: {
        "@type": "Rating",
        ratingValue: Number(r.rating),
        bestRating: 5,
        worstRating: 1
      }
    }));
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
    // builds from then on (see `isColumnRejection`).
    if (attempt.ok || !isColumnRejection(attempt)) return attempt;
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
function productPrerender(p, origin, url, shop, city, reviews = []) {
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
    p.description?.trim() || `${p.title} from ${shop}, ${city}. Sold on ${SITE_NAME} by a verified independent boutique.`
  )}</p>
${specs.length ? `<ul>\n${specs.map((s) => `<li>${escapeHtml(s)}</li>`).join("\n")}\n</ul>` : ""}
${
    /*
     * The reviews, in the body as well as in the JSON-LD.
     *
     * Review markup is only legitimate while the same review is visible on the
     * page — the same rule the /help FAQ block follows. The React app does render
     * these (inside the "Ratings & reviews" panel), so the markup was already
     * honest, but a crawler that does not run JavaScript could not see either
     * half. This is the same text, in the first response.
     */
    reviews.length
      ? `<h2>What buyers say about ${escapeHtml(p.title)}</h2>
${reviews
          .map(
            (r) =>
              `<p>${"★".repeat(Math.round(r.reviewRating.ratingValue))} — ${escapeHtml(r.reviewBody)} <em>${escapeHtml(r.author.name)}</em></p>`
          )
          .join("\n")}`
      : ""
  }
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
  // `images` is appended here rather than added to the shared column lists: this
  // is the only consumer that needs the gallery (the cards elsewhere show the
  // cover alone), and Google wants every image it can get on a Product node.
  // The column has existed since migration 0008 — well before `slug` (0057) —
  // so it is safe on the legacy fallback path too.
  const attempt = await dbProductsTry(
    (cols) => `products?select=${cols},images&status=eq.active&deleted_at=is.null&limit=1&${filter}`
  );
  const p = attempt.rows[0];
  // A failed read means "we don't know" — serve the generic shell and leave the
  // page indexable. Only a successful read that found nothing is a real 404.
  if (!p) return attempt.ok ? notFoundMeta() : null;
  const shop = p.boutiques?.name || SITE_NAME;
  const city = p.boutiques?.city || "India";
  // Only worth a round trip when the product actually has reviews on file —
  // `reviews_count` is maintained on the row, so an unreviewed piece (most of
  // the catalogue) costs nothing and the hot path is unchanged.
  const reviews = (p.reviews_count ?? 0) > 0 ? await productReviewNodes(p.id) : [];
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
    prerender: productPrerender(p, origin, url, shop, city, reviews),
    schema: {
      "@context": "https://schema.org",
      "@graph": [
        orgNode(origin),
        {
          "@type": "Product",
          "@id": `${url}#product`,
          name: p.title,
          url,
          // Cover first, then the gallery, deduplicated. Google treats `image`
          // as required for a merchant listing and explicitly prefers several
          // per product — this node used to carry exactly one.
          image: productImages(p),
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
            // Without this Google treats the price as valid only for the day it
            // was crawled and can drop the price from the result entirely. A
            // rolling year is the standard answer for a catalogue with no
            // scheduled price expiry.
            priceValidUntil: priceValidUntil(),
            seller: { "@type": "Organization", name: shop }
          },
          // Only when a rating is real — a fabricated one is a manual-action risk.
          aggregateRating: (p.reviews_count ?? 0) > 0 && (p.rating ?? 0) > 0 ? {
            "@type": "AggregateRating",
            ratingValue: Number(p.rating),
            reviewCount: p.reviews_count,
            bestRating: 5,
            worstRating: 1
          } : void 0,
          review: reviews.length ? reviews : void 0
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
  const city = [b.area, b.city].filter(Boolean).join(", ") || b.city || "India";
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
  const city = b.city || "India";
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
          // No `telephone`: 0073 made the shop's number private (see
          // BOUTIQUE_COLUMNS). The platform support line is not this shop's
          // number and must not be substituted here.
          sameAs: boutiqueSameAs(b),
          foundingDate: b.established_year ? String(b.established_year) : void 0,
          address: {
            "@type": "PostalAddress",
            streetAddress: [b.address_line, b.area].filter(Boolean).join(", ") || b.area || void 0,
            addressLocality: b.city || void 0,
            // Omitted rather than guessed. Sellers are no longer assumed to be
            // in one state, and a wrong addressRegion on a ClothingStore is a
            // structured-data error Google will flag.
            addressRegion: b.state || void 0,
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
    title: "Boutique Ethnic Wear Online \u2014 Sarees, Kurta Sets & More",
    description: "Shop verified independent boutiques across India in one place. Sarees, kurta sets, kurtis and lehengas from independent shops, with direct chat to the owner and delivery across India."
  },
  "/collections": {
    title: "Shop by Collection \u2014 Sarees, Kurta Sets & Ethnic Wear",
    description: "Browse every category, occasion, fabric, budget and colour independent boutiques are listing on MangaiMart right now."
  },
  "/shop": {
    title: "Shop All \u2014 Ethnic Wear from Verified Indian Boutiques",
    description: "Every piece listed by verified independent boutiques on MangaiMart. Filter by category, occasion, colour, size and budget."
  },
  "/boutiques": {
    title: "Boutiques in India \u2014 Verified Ethnic Wear Shops",
    description: "Browse every verified boutique on MangaiMart by city, rating and speciality. Independent shops across India, each checked before it can list."
  },
  "/new-arrivals": {
    title: "New Arrivals \u2014 Latest Ethnic Wear from Indian Boutiques",
    description: "Every piece MangaiMart boutiques have listed in the last 30 days, newest first."
  },
  "/best-sellers": {
    title: "Best Sellers \u2014 Most-Bought Ethnic Wear on MangaiMart",
    description: "The pieces MangaiMart buyers are actually taking home, ranked by units sold and how well they are rated."
  },
  "/top-boutiques": {
    title: "Best-Selling Boutiques in India \u2014 Top Rated Shops",
    description: "The independent boutiques moving the most pieces, weighed against how well they are rated by real buyers."
  },
  "/inspire": {
    title: "Inspire \u2014 New Pieces from Indian Boutiques",
    description: "A live feed of what MangaiMart boutiques are listing right now."
  },
  // \u2500\u2500 The written pages \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // These are in the sitemap, so crawlers ask for them \u2014 but they had no entry
  // here, which meant all nine shared one title ("MangaiMart") and one generic
  // description. Nine indexable URLs competing as duplicates of each other, and
  // the policy pages in particular are what a cautious buyer (and a payment
  // gateway's review) actually reads before trusting a new marketplace.
  "/about": {
    title: "About MangaiMart \u2014 One Place for India\u2019s Boutiques",
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

/**
 * Which product field each facet kind reads, and where it lives in the URL.
 *
 * `colour` and `budget` are the two the hub used to open as a filtered grid
 * rather than a page of their own \u2014 see src/pages/buyer/CategoryLanding.tsx.
 * Budget is the odd one: its "term" is a price ceiling parsed out of the slug
 * (`under-3000`), so it filters on `price` and has no column of its own.
 */
const FACET_PREFIX = {
  category: "collections",
  occasion: "occasions",
  fabric: "fabrics",
  colour: "colours",
  budget: "budget"
};
const BUDGET_RUNGS = [1500, 3e3, 5e3, 1e4];
const budgetCeiling = (slug) => {
  const m = /^under-(\d+)$/.exec(String(slug).toLowerCase());
  const max = m ? Number(m[1]) : NaN;
  return BUDGET_RUNGS.includes(max) ? max : null;
};
const facetValue = (p, kind) =>
  kind === "category" ? p.category : kind === "occasion" ? p.occasion : kind === "fabric" ? p.fabric : p.color;

async function metaForCategory(kind, slug, origin) {
  const ceiling = kind === "budget" ? budgetCeiling(slug) : null;
  if (kind === "budget" && ceiling === null) return notFoundMeta();
  const attempt = await dbProductsTry(
    (cols) => `products?select=${cols}&status=eq.active&deleted_at=is.null&limit=40`
  );
  if (!attempt.ok) return null;
  const items = attempt.rows.filter((p) => {
    if (kind === "budget") return typeof p.price === "number" && p.price <= ceiling;
    const value = facetValue(p, kind);
    return value && slugify(value) === slug;
  });
  if (!items.length) return notFoundMeta();
  const term = (kind === "budget" ? String(ceiling) : facetValue(items[0], kind)) || slug;
  const heading =
    kind === "occasion" ? occasionHeading(term)
      : kind === "budget" ? `Under ${inr(ceiling)}`
      : titleCase(term);
  const shops = new Set(items.map((p) => p.boutiques?.name).filter(Boolean)).size;
  const from = Math.min(...items.map((p) => p.price));
  const path = `/${FACET_PREFIX[kind]}/${slug}`;
  const url = `${origin}${path}`;
  const description = clamp(
    kind === "budget"
      ? `${items.length} ethnic wear ${items.length === 1 ? "piece" : "pieces"} under ${inr(ceiling)} from ${shops} verified independent ${shops === 1 ? "boutique" : "boutiques"}, starting at ${inr(from)}. Direct chat with the shop, 7-day returns, delivery across India.`
      : `${items.length} ${heading.toLowerCase()} ${items.length === 1 ? "piece" : "pieces"} from ${shops} verified independent ${shops === 1 ? "boutique" : "boutiques"}, from ${inr(from)}. Direct chat with the shop, 7-day returns, delivery across India.`
  );
  return {
    // "Under \u20b93,000 Online" reads as nonsense \u2014 the rung needs a subject.
    title: kind === "budget"
      ? `Ethnic Wear ${heading} \u2014 Buy from Verified Indian Boutiques`
      : `${heading} Online \u2014 Buy from Verified Indian Boutiques`,
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

  const rows = boutiqueLinkRows(shops, origin, 60);
  const prerender = `<noscript>
<h1>${escapeHtml(cityName ? `Boutiques in ${cityName}` : "Boutiques in India")}</h1>
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
          name: cityName ? `Boutiques in ${cityName}` : "Boutiques in India",
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

/* ── The hub pages ────────────────────────────────────────────────────────
 *
 * `/`, `/collections`, `/new-arrivals`, `/best-sellers`, `/top-boutiques` and
 * `/inspire` had a head and nothing under it. Product, boutique and facet pages
 * were given a `<noscript>` body (see `boutiquePrerender` for the reasoning);
 * these six were not, so the pages every other page links UP to — and the ones
 * a crawler reaches first — offered a title, a description, and then an empty
 * `<div id="root">`. On `/` that is the whole home page.
 *
 * The links matter more than the prose. The facet landings under
 * /collections/*, /occasions/* and /fabrics/* were reachable from the sitemap
 * and from nowhere else in crawlable HTML, and a URL that only a sitemap knows
 * about is an orphan: Google will take it, but it discounts it and is slow to
 * come back. `/collections` below is what actually links to them.
 *
 * Each hub costs ONE database read, inside the same 1500 ms abort as everything
 * else here, and returns `undefined` if that read fails — a hub without its
 * body is the status quo, whereas a hub that times out is a page that does not
 * load at all.
 */

/** One live-catalogue read, ordered however the hub ranks. */
async function hubProducts(order, limit) {
  return dbProducts(
    (cols) => `products?select=${cols}&status=eq.active&deleted_at=is.null&order=${order}&limit=${limit}`
  );
}

/** `<li>` links for a run of products. Every hub below builds the same rows. */
function productLinkRows(items, origin, limit = 30) {
  return items.slice(0, limit).map(
    (p) => `<li><a href="${escapeHtml(`${origin}${productPath(p)}`)}">${escapeHtml(p.title)}</a> — ${escapeHtml(inr(p.price))}${p.boutiques?.name ? ` · ${escapeHtml(p.boutiques.name)}` : ""}</li>`
  );
}

/** `productLinkRows`, for shops. Shared with the `/boutiques` directory. */
function boutiqueLinkRows(items, origin, limit = 30) {
  return items.slice(0, limit).map(
    (b) => `<li><a href="${escapeHtml(`${origin}/boutique/${b.slug || b.id}`)}">${escapeHtml(b.name)}</a>${b.city ? ` — ${escapeHtml([b.area, b.city].filter(Boolean).join(", "))}` : ""}</li>`
  );
}

function linkList(rows) {
  return rows.length ? `<ul>\n${rows.join("\n")}\n</ul>` : "";
}

/**
 * The trailing line of internal links every hub carries.
 *
 * Self-excluded: a page linking to itself is noise, and on `/` it would be a
 * second link to the root from the root.
 */
function hubNav(origin, self) {
  return [
    ["/shop", "Shop all"],
    ["/collections", "Shop by collection"],
    ["/boutiques", "All boutiques"],
    ["/new-arrivals", "New arrivals"],
    ["/best-sellers", "Best sellers"],
    ["/top-boutiques", "Top boutiques"],
    // /inspire was in the sitemap and in no crawlable link anywhere, which is
    // the definition of an orphan: Google will take the URL and then discount
    // and rarely recrawl it. Every other hub carries it now.
    ["/inspire", "Inspire feed"]
  ]
    .filter(([path]) => path !== self)
    .map(([path, label]) => `<a href="${origin}${path}">${label}</a>`)
    .join(" · ");
}

/** One H1, the page's own written copy, its sections, then the nav. */
function hubDocument(heading, description, sections, origin, self) {
  return `<noscript>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(description)}</p>
${sections.filter(Boolean).join("\n")}
<p>${hubNav(origin, self)}</p>
</noscript>`;
}

/**
 * `/` — the page with the most inbound authority and, until now, no body.
 *
 * One read serves both halves: the newest pieces are the links into the
 * catalogue, and their `category` values are the links into the facet landings,
 * so the home page finally passes something down to the pages built to rank.
 */
async function homeHubPrerender(origin) {
  const products = await hubProducts("created_at.desc", 40);
  if (!products.length) return void 0;
  const categories = /* @__PURE__ */ new Map();
  for (const p of products) {
    const slug = slugify(p.category || "");
    if (slug) categories.set(slug, titleCase(p.category));
  }
  const categoryRows = [...categories].map(
    ([slug, name]) => `<li><a href="${escapeHtml(`${origin}/collections/${slug}`)}">${escapeHtml(name)}</a></li>`
  );
  return hubDocument(
    "Boutique Ethnic Wear Online",
    STATIC_META["/"].description,
    [
      categoryRows.length ? `<h2>Shop by category</h2>\n${linkList(categoryRows)}` : "",
      `<h2>New from our boutiques</h2>\n${linkList(productLinkRows(products, origin, 24))}`
    ],
    origin,
    "/"
  );
}

/**
 * `/shop` — the everything grid.
 *
 * Its only job here is discovery: 40 product links in the first response give a
 * non-rendering crawler a path into the catalogue that does not depend on
 * executing an infinite-scroll grid.
 */
async function shopHubPrerender(origin) {
  const products = await hubProducts("created_at.desc", 40);
  if (!products.length) return void 0;
  return hubDocument(
    "Shop All Ethnic Wear",
    STATIC_META["/shop"].description,
    [linkList(productLinkRows(products, origin, 40))],
    origin,
    "/shop"
  );
}

/**
 * `/collections` — the index of every facet landing page.
 *
 * This is the one that repays the read. It names each category, occasion and
 * fabric page in HTML, which is the only crawlable route to them that is not
 * the sitemap. Reads three columns, so it never touches the migration-0057
 * fallback and stays well inside the abort budget.
 */
async function collectionsHubPrerender(origin) {
  const { ok, rows } = await dbTryTwice(
    "products?select=category,occasion,fabric,color,price&status=eq.active&deleted_at=is.null&limit=5000"
  );
  if (!ok || !rows.length) return void 0;
  // Slug → display name. A Map rather than a Set because the heading has to be
  // the seller's own term, cased — the slug alone reads as "raw-silk".
  const groups = {
    collections: { label: "Categories", terms: /* @__PURE__ */ new Map() },
    occasions: { label: "Occasions", terms: /* @__PURE__ */ new Map() },
    fabrics: { label: "Fabrics", terms: /* @__PURE__ */ new Map() },
    colours: { label: "Colours", terms: /* @__PURE__ */ new Map() },
    budget: { label: "Budgets", terms: /* @__PURE__ */ new Map() }
  };
  for (const p of rows) {
    if (p.category) groups.collections.terms.set(slugify(p.category), titleCase(p.category));
    if (p.occasion) groups.occasions.terms.set(slugify(p.occasion), occasionHeading(p.occasion));
    if (p.fabric) groups.fabrics.terms.set(slugify(p.fabric), titleCase(p.fabric));
    if (p.color) groups.colours.terms.set(slugify(p.color), titleCase(p.color));
  }
  // Budget rungs are a fixed ladder, not a value read off the rows — but only
  // the ones with something under them, so the hub never links to a page the
  // router would answer with a 404.
  for (const max of BUDGET_RUNGS) {
    if (rows.some((p) => typeof p.price === "number" && p.price <= max)) {
      groups.budget.terms.set(`under-${max}`, `Under ${inr(max)}`);
    }
  }
  const sections = Object.entries(groups).map(([prefix, { label, terms }]) => {
    const items = [...terms].filter(([slug]) => slug);
    if (!items.length) return "";
    const links = items.map(
      ([slug, name]) => `<li><a href="${escapeHtml(`${origin}/${prefix}/${slug}`)}">${escapeHtml(name)}</a></li>`
    );
    return `<h2>${label}</h2>\n${linkList(links)}`;
  });
  return hubDocument(
    "Shop by Collection",
    STATIC_META["/collections"].description,
    sections,
    origin,
    "/collections"
  );
}

/**
 * `/new-arrivals` and `/inspire` — the same read, ordered newest first.
 *
 * Two pages rather than one because they are two URLs in the sitemap with two
 * descriptions; the body differs only in its heading.
 */
async function newestHubPrerender(origin, path, heading) {
  const products = await hubProducts("created_at.desc", 30);
  if (!products.length) return void 0;
  return hubDocument(
    heading,
    STATIC_META[path].description,
    [linkList(productLinkRows(products, origin))],
    origin,
    path
  );
}

/**
 * `/best-sellers` — ordered by `products.sold_count` (migration 0023).
 *
 * On a database where 0023 has not been applied, PostgREST rejects the order
 * clause and the read comes back empty, so the page keeps its old bodyless
 * shell rather than being served a list ranked by nothing.
 */
async function bestSellersPrerender(origin) {
  const products = await hubProducts("sold_count.desc,rating.desc", 30);
  if (!products.length) return void 0;
  return hubDocument(
    "Best Sellers",
    STATIC_META["/best-sellers"].description,
    [linkList(productLinkRows(products, origin))],
    origin,
    "/best-sellers"
  );
}

/** `/top-boutiques` — `boutiques.units_sold` (0023), then rating. */
async function topBoutiquesPrerender(origin) {
  const { rows } = await dbTryTwice(
    `boutiques?select=${BOUTIQUE_COLUMNS_CORE}&status=eq.approved&order=units_sold.desc,rating.desc&limit=30`
  );
  if (!rows.length) return void 0;
  return hubDocument(
    "Top Boutiques in India",
    STATIC_META["/top-boutiques"].description,
    [linkList(boutiqueLinkRows(rows, origin))],
    origin,
    "/top-boutiques"
  );
}

const HUB_PRERENDERERS = {
  "/": homeHubPrerender,
  "/shop": shopHubPrerender,
  "/collections": collectionsHubPrerender,
  "/new-arrivals": (origin) => newestHubPrerender(origin, "/new-arrivals", "New Arrivals"),
  "/best-sellers": bestSellersPrerender,
  "/top-boutiques": topBoutiquesPrerender,
  "/inspire": (origin) => newestHubPrerender(origin, "/inspire", "Inspire")
};

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
      prerender: HUB_PRERENDERERS[pathname] ? await HUB_PRERENDERERS[pathname](origin) : void 0,
      // The hero is an inset card a little narrower than the viewport, but it
      // still declares `sizes="100vw"` in Home.tsx and this must be the same
      // string character-for-character or the preload picks a different
      // candidate from the <img> and the image is fetched twice.
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
  const colour = pathname.match(/^\/colours\/([^/]+)$/);
  if (colour) return metaForCategory("colour", decodeURIComponent(colour[1]), origin);
  const budget = pathname.match(/^\/budget\/([^/]+)$/);
  if (budget) return metaForCategory("budget", decodeURIComponent(budget[1]), origin);
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
    // Carried over from the shell block this injection replaces. Every tag named
    // between the `ag:shell-meta` markers in index.html has to be re-emitted
    // here, or it is simply lost on the pages crawlers actually read.
    `<meta name="author" content="${SITE_NAME}" />`,
    ...(meta?.notFound ? [] : [`<link rel="canonical" href="${escapeHtml(canonical)}" />`]),
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="en_IN" />`,
    `<meta property="og:type" content="${meta?.type || "website"}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    ...(meta?.notFound ? [] : [`<meta property="og:url" content="${escapeHtml(canonical)}" />`]),
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    // No og:image:width/height. They were hardcoded to 1200x630, which is not
    // the shape of ANY image this actually serves: a product photo is portrait,
    // a boutique logo is square, and the brand fallback (mangaimart-logo.png)
    // is 1254x1254. A declared size that does not match the file is worse than
    // none — the scraper reserves the wrong box and crops or drops the preview.
    // Restore these only alongside a purpose-built 1.91:1 share image.
    `<meta property="og:image:alt" content="${escapeHtml(meta?.title || SITE_NAME)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<meta name="geo.region" content="IN" />`,
    `<meta name="geo.placename" content="India" />`
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
    dbTryTwice("products?select=category,occasion,fabric,color,price,created_at&status=eq.active&deleted_at=is.null&order=created_at.desc&limit=5000"),
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
    fabrics: /* @__PURE__ */ new Set(),
    colours: /* @__PURE__ */ new Set(),
    budget: /* @__PURE__ */ new Set()
  };
  for (const p of products) {
    if (p.category) facets.collections.add(slugify(p.category));
    if (p.occasion) facets.occasions.add(slugify(p.occasion));
    if (p.fabric) facets.fabrics.add(slugify(p.fabric));
    if (p.color) facets.colours.add(slugify(p.color));
  }
  // Only rungs with stock under them: a sitemap must never advertise a page the
  // router answers with a 404.
  for (const max of BUDGET_RUNGS) {
    if (products.some((p) => typeof p.price === "number" && p.price <= max)) facets.budget.add(`under-${max}`);
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
        `${feedText(p.title, 120)} from ${shop || "a verified independent boutique"} on ${SITE_NAME}.`
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
<title>${SITE_NAME} — Boutique Ethnic Wear Online</title>
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
    // Drop the shell's fallback metadata now that the real thing is in the head.
    // Done AFTER the guard above, which needs `injected === html` to mean "the
    // title was not replaced" — stripping first would make that always false.
    // A shell without the markers strips nothing and merely restores the old
    // duplicate-tag behaviour, which is why verify:seo asserts the count.
    injected = injected.replace(/\n?<!-- ag:shell-meta:start -->[\s\S]*?<!-- ag:shell-meta:end -->/, "");
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
