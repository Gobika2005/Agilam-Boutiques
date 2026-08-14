/**
 * Verifies the edge SEO layer — `npm run verify:seo`.
 *
 * Vercel middleware does not run under `vite dev`, and its failure mode is
 * deliberately silent: any error serves the plain app, so a broken query looks
 * exactly like a working site while every crawler quietly gets a blank shell.
 * The only way to know it works is to execute it.
 *
 * This runs `middleware.js` exactly as the edge will — real built `index.html`,
 * real database, real `Request` objects — and asserts on what comes back. It
 * has already caught three bugs that were invisible from the browser:
 *
 *   · `id=like.<prefix>` on a uuid column, which Postgres rejects outright
 *     ("operator does not exist: uuid ~~ unknown"), taking every product page's
 *     metadata down with it
 *   · `or=(slug.eq.X,id.eq.X)` comparing a uuid column against a title slug,
 *     which fails the whole query rather than just that branch
 *   · every boutique's `slug` being NULL, so the sitemap listed none of them
 *
 * Run it after any deploy, migration, or change to middleware.js.
 * Requires `.env` with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Load .env so the Supabase-backed paths behave as they will in production.
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

// Serve dist/ so the middleware's `fetch(origin + '/index.html')` resolves.
const server = http.createServer((req, res) => {
  const file = req.url.split('?')[0] === '/index.html' ? 'index.html' : null;
  if (!file) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', 'text/html');
  res.end(fs.readFileSync(path.join('dist', file)));
});
await new Promise((r) => server.listen(0, r));
const origin = `http://127.0.0.1:${server.address().port}`;

const { default: middleware, config } = await import('../middleware.js');

const results = [];
async function check(label, pathname, assertions) {
  let res;
  try {
    res = await middleware(new Request(`${origin}${pathname}`, { method: 'GET' }));
  } catch (e) {
    results.push({ label, pathname, FAIL: `threw: ${e.message}` });
    return;
  }
  if (!res) { results.push({ label, pathname, result: 'passthrough (no Response)' }); return; }
  const body = res.status === 301 ? '' : await res.text();
  const out = {
    label,
    pathname,
    status: res.status,
    location: res.headers.get('location'),
    contentType: res.headers.get('content-type'),
    xRobots: res.headers.get('x-robots-tag'),
    title: (body.match(/<title>([^<]*)<\/title>/) || [])[1],
    canonical: (body.match(/<link rel="canonical" href="([^"]*)"/) || [])[1],
    robots: (body.match(/<meta name="robots" content="([^"]*)"/) || [])[1],
    ogType: (body.match(/<meta property="og:type" content="([^"]*)"/) || [])[1],
    // Counted, not just read. The edge injects its own description/robots/geo
    // where the shell's <title> was, but for a long time it did not remove the
    // shell's own copies — so every crawled page carried two `description` and
    // two `geo.region` tags, and Google was free to prefer the generic
    // fallback over the page's real copy. `headFor()` strips the
    // `ag:shell-meta` block; these counts are what proves it still does.
    descriptionCount: (body.match(/<meta name="description"/g) || []).length,
    geoRegionCount: (body.match(/<meta name="geo\.region"/g) || []).length,
    schema: (() => {
      const m = body.match(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s);
      if (!m) return null;
      try { const j = JSON.parse(m[1].replace(/\\u003c/g, '<')); return (j['@graph'] ?? [j]).map((n) => n['@type']).join(','); }
      catch (e) { return 'PARSE_ERROR: ' + e.message; }
    })(),
    // The parsed graph, so a check can assert on a node's CONTENTS rather than
    // just which @types are present — `schema` above collapses to a type list,
    // which cannot tell a complete Organization from a hollow one.
    graph: (() => {
      const m = body.match(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s);
      if (!m) return [];
      try { const j = JSON.parse(m[1].replace(/\\u003c/g, '<')); return j['@graph'] ?? [j]; }
      catch { return []; }
    })(),
    bodyLen: body.length,
    // Entity-decoded: `&` is correctly written as `&amp;` inside an attribute,
    // so the raw match never equals the URL the browser will actually request.
    preconnect: attr(body, /<link rel="preconnect" href="([^"]*supabase[^"]*)"/),
    preloadHref: attr(body, /<link rel="preload" as="image" href="([^"]*)"/),
    preloadSrcSet: attr(body, /<link rel="preload"[^>]*imagesrcset="([^"]*)"/),
    preloadSizes: attr(body, /<link rel="preload"[^>]*imagesizes="([^"]*)"/),
    // The crawlable <noscript> body. Its absence is invisible from a browser —
    // the React app paints the same words either way — so the only way to catch
    // a page that regressed to shipping an empty <div id="root"> is to look for
    // the heading here.
    //
    // Every block is scanned and the one carrying an <h1> is the prerender:
    // index.html already ships a <noscript> in the head holding the blocking
    // font stylesheets, and it comes first, so matching a single block found
    // that one and reported every page as having no links.
    ...(() => {
      const block = [...body.matchAll(/<noscript>[\s\S]*?<\/noscript>/g)]
        .map((m) => m[0])
        .find((b) => b.includes('<h1>')) || '';
      return {
        noscriptH1: (block.match(/<h1>([^<]*)<\/h1>/) || [])[1],
        noscriptLinks: block.match(/<a href=/g)?.length || 0,
        // The block itself, for checks that care WHICH links it carries rather
        // than how many — internal linking is the only crawl path to a page
        // that is otherwise sitemap-only.
        noscriptHtml: block,
      };
    })(),
    splashRetires: splashRetires(body),
  };
  // Asserted on every HTML page rather than per caller: the splash covers the
  // whole viewport at z-index 9999, so a page that fails this is unusable no
  // matter how good its metadata is — and the pages that broke were exactly the
  // ones nobody thought to write a splash assertion for.
  const builtin = out.status === 200 && (out.contentType || '').includes('text/html')
    ? [is('boot splash retires', (o) => o.splashRetires)]
    : [];
  const problems = [...builtin, ...(assertions || [])].filter((a) => !a.ok(out)).map((a) => a.name);
  if (problems.length) out.FAIL = problems.join('; ');
  results.push(out);
  // Returned so a caller can assert on fields that need more than a boolean —
  // the LCP preload compares its candidate list against imageUrl.ts.
  return out;
}

const is = (n, f) => ({ name: n, ok: f });

/**
 * Will the boot splash actually go away on this page?
 *
 * index.html paints a full-screen `#ag-boot` splash at z-index 9999 and retires
 * it with pure CSS the moment React fills `#root`. That rule is a sibling
 * selector, and the edge injects the crawlable `<noscript>` body BETWEEN the
 * two elements — so while the rule used `+` (next sibling) it quietly stopped
 * matching on every prerendered page, and the site sat under a spinner forever
 * with the app mounted and painted underneath.
 *
 * Nothing else in this file could have caught that: the metadata was perfect,
 * the prerender was present, the `<h1>` was there, and the page was unusable.
 * So the check is "given the DOM order actually served, does the rule still
 * match?" — which fails both if someone reverts `~` to `+` and if someone adds
 * another element between `#root` and `#ag-boot` while the rule needs adjacency.
 */
function splashRetires(body) {
  const rule = (body.match(/#root:not\(:empty\)\s*([+~])\s*#ag-boot/) || [])[1];
  // No splash in this shell at all — nothing to retire, nothing to break.
  if (!rule) return !/id="ag-boot"/.test(body);
  const root = body.indexOf('<div id="root"></div>');
  const boot = body.indexOf('<div id="ag-boot"');
  if (root < 0 || boot < 0) return false;
  const between = body.slice(root + '<div id="root"></div>'.length, boot);
  // `~` matches wherever the splash sits after #root; `+` only if nothing
  // intervenes. A comment or whitespace is not an element and does not count.
  return rule === '~' || !/<[a-zA-Z]/.test(between);
}

/** First capture of `re` in `body`, with HTML entities decoded. */
function attr(body, re) {
  const raw = (body.match(re) || [])[1];
  return raw === undefined
    ? undefined
    : raw.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/*
 * robots.txt is checked on its text, not just its length.
 *
 * The child sitemap lines are load-bearing and easy to lose: Bing and several
 * smaller crawlers read only the first Sitemap: line and never expand a
 * <sitemapindex>, so dropping them quietly halves what those engines discover.
 *
 * The Merchant Center feed must also stay crawlable — Google's scheduled feed
 * fetch obeys robots.txt — which is why it lives at /merchant-feed.xml, under
 * the blanket `Allow: /`, rather than behind the `Disallow: /api/`.
 */
{
  const res = await middleware(new Request(`${origin}/robots.txt`));
  const body = await res.text();
  const problems = [
    ['sitemap index', `Sitemap: ${origin}/sitemap.xml`],
    ['sitemap-pages', `Sitemap: ${origin}/sitemap-pages.xml`],
    ['sitemap-boutiques', `Sitemap: ${origin}/sitemap-boutiques.xml`],
    ['sitemap-products', `Sitemap: ${origin}/sitemap-products.xml`],
  ].filter(([, line]) => !body.includes(line)).map(([name]) => `missing ${name}`);
  if (/^Disallow: \/merchant-feed/m.test(body)) problems.push('the Merchant Center feed is disallowed');
  results.push(
    res.status === 200 && (res.headers.get('content-type') || '').includes('text/plain') && !problems.length
      ? { label: 'robots.txt', status: res.status, title: `${body.split('\n').length} lines, all Sitemap lines present` }
      : { label: 'robots.txt', status: res.status, FAIL: problems.length ? problems.join('; ') : 'bad status or content-type' },
  );
}

/*
 * The Google Merchant Center feed.
 *
 * Served from the edge, not api/, because api/ is already at the 12-function
 * Vercel Hobby ceiling and a 13th fails the deploy. Checked here for the same
 * reason as everything else in this file: it is generated live from Supabase and
 * a failed read is indistinguishable from a healthy empty catalogue unless
 * something asserts on it.
 */
{
  const res = await middleware(new Request(`${origin}/merchant-feed.xml`));
  const body = await res.text();
  const items = (body.match(/<item>/g) || []).length;
  const problems = [];
  if (res.status !== 200) problems.push(`status ${res.status}`);
  if (!(res.headers.get('content-type') || '').includes('xml')) problems.push('not xml');
  if (!items) problems.push('no <item> elements — DB unreachable, or every product lacks a photo');
  // Every item Google requires. A missing one is an item-level disapproval.
  for (const required of ['g:id', 'g:title', 'g:link', 'g:image_link', 'g:price', 'g:availability', 'g:condition', 'g:brand']) {
    if (!body.includes(`<${required}>`)) problems.push(`no ${required}`);
  }
  // The landing pages must be the canonical product URLs, not preview or
  // relative ones — Merchant Center indexes exactly what this says.
  if (!/<g:link>https?:\/\/[^<]+\/products\//.test(body)) problems.push('g:link is not an absolute product URL');
  results.push(
    problems.length
      ? { label: 'merchant feed', status: res.status, FAIL: problems.join('; ') }
      : { label: 'merchant feed', status: res.status, title: `${items} items, all required fields present` },
  );
}
/*
 * The sitemap is an index of three children, so each has to be fetched and
 * checked in its own right. A child that silently returns an empty <urlset> —
 * which is exactly what a lost race against the 1500 ms abort looks like —
 * would still be a well-formed 200 to any check that only asserts on the index.
 */
await check('sitemap.xml (index)', '/sitemap.xml', [
  is('200', (o) => o.status === 200),
  is('xml', (o) => (o.contentType || '').includes('xml')),
]);
for (const child of ['/sitemap-pages.xml', '/sitemap-boutiques.xml', '/sitemap-products.xml']) {
  await check(`sitemap child ${child}`, child, [
    is('200', (o) => o.status === 200),
    is('xml', (o) => (o.contentType || '').includes('xml')),
    is('not empty', (o) => o.bodyLen > 300),
  ]);
}
/*
 * The brand entity.
 *
 * `MangaiMart` has to win searches for its own name in every spelling people
 * use it in — "Mangai Mart" as two words is a real share of them, and nothing
 * on the site tied that string to this domain until `alternateName` did. The
 * Organization node is also what a knowledge panel and an AI assistant read to
 * answer "what is MangaiMart", so a hollow one (a name, a URL and nothing else)
 * is a brand-SEO failure that no amount of product markup makes up for.
 *
 * Asserted on the CONTENTS of the node, not its presence: it was present and
 * hollow for the whole of the previous audit.
 */
function orgProblems(o) {
  const org = (o.graph || []).find((n) => n['@type'] === 'Organization');
  if (!org) return ['no Organization node'];
  const problems = [];
  if (org.name !== 'MangaiMart') problems.push(`name is "${org.name}", expected MangaiMart`);
  const alts = [].concat(org.alternateName || []);
  if (!alts.includes('Mangai Mart')) problems.push('alternateName does not include the spaced "Mangai Mart"');
  for (const field of ['email', 'telephone', 'logo', 'description', 'sameAs', 'contactPoint', 'address']) {
    if (!org[field]) problems.push(`no ${field}`);
  }
  return problems;
}

const home = await check('homepage', '/', [
  is('200', (o) => o.status === 200),
  is('real title', (o) => o.title && o.title !== 'MangaiMart'),
  is('canonical', (o) => !!o.canonical),
  is('indexable', (o) => (o.robots || '').startsWith('index')),
  is('WebSite schema', (o) => (o.schema || '').includes('WebSite')),
  is('complete Organization', (o) => !orgProblems(o).length),
]);
// Reported separately so a failure names the missing field rather than just
// "complete Organization".
{
  const problems = orgProblems(home);
  results.push(
    problems.length
      ? { label: 'brand entity', FAIL: problems.join('; ') }
      : { label: 'brand entity', status: 200, title: 'Organization: name, alternateName, contacts, sameAs all present' },
  );
}
await check('collections hub', '/collections', [is('200', (o) => o.status === 200), is('title', (o) => !!o.title)]);

/*
 * The LCP preload.
 *
 * The home page and a product page both paint an image that the browser cannot
 * discover until ~240 kB of JavaScript has run, React has mounted and a fetch
 * to a third-party origin has returned — four serial round trips, which is what
 * put mobile LCP at 8.4 s. The edge knows the URL before any of that, so it
 * preloads it.
 *
 * The candidate list and `sizes` are asserted, not just the presence of a tag:
 * a preload whose chosen candidate differs from the one the `<img>` later asks
 * for is WORSE than none — it downloads an image nobody uses and the real one
 * still starts late. `imageSrcSet()` in src/lib/imageUrl.ts is the contract.
 */
/*
 * Read out of imageUrl.ts, never restated here.
 *
 * This constant used to be a literal `[240, 480, 800, 1280]` — a copy of the
 * list as it stood when this check was written. When 1600 was later added to
 * imageUrl.ts for full-bleed heroes, both this check and the edge preload kept
 * the stale four, so the assertion compared the bug against itself and passed
 * while the live home page downloaded its hero twice (1280 preloaded, 1600
 * rendered). A check that hardcodes the thing it is checking cannot catch drift.
 */
const EXPECTED_WIDTHS = (() => {
  const src = fs.readFileSync(new URL('../src/lib/imageUrl.ts', import.meta.url), 'utf8');
  const m = src.match(/const WIDTHS = \[([^\]]+)\]/);
  if (!m) throw new Error('verify-seo: cannot find WIDTHS in src/lib/imageUrl.ts');
  return m[1].split(',').map((n) => Number(n.trim()));
})();
function preloadProblems(o, expectedSizes) {
  const problems = [];
  if (!o.preconnect) problems.push('no preconnect to the Supabase origin');
  if (!o.preloadHref) return [...problems, 'no LCP image preload'];
  if (!o.preloadHref.includes('/storage/v1/render/image/public/')) {
    problems.push('preload points at the raw object, not the transformer');
  }
  if (!/[?&]width=800&quality=70&resize=contain/.test(o.preloadHref)) {
    problems.push(`href is not imageFallback()'s width=800&quality=70&resize=contain: ${o.preloadHref}`);
  }
  const widths = (o.preloadSrcSet || '').split(',').map((c) => Number((c.trim().match(/ (\d+)w$/) || [])[1]));
  if (widths.join() !== EXPECTED_WIDTHS.join()) {
    problems.push(`imagesrcset widths ${widths.join('/')} != imageUrl.ts WIDTHS ${EXPECTED_WIDTHS.join('/')}`);
  }
  if (o.preloadSizes !== expectedSizes) {
    problems.push(`imagesizes "${o.preloadSizes}" != what the <img> renders ("${expectedSizes}")`);
  }
  return problems;
}
await check('checkout is noindex', '/checkout', [
  is('noindex meta', (o) => (o.robots || '').includes('noindex')),
  is('X-Robots-Tag', (o) => (o.xRobots || '').includes('noindex')),
]);
// The console lives at VITE_ADMIN_PATH, not /admin (src/lib/adminPath.ts). Both
// are asserted: the real address because that is the page that exists, and the
// old one because it must not become an indexable 404 either.
const adminSegment = (process.env.VITE_ADMIN_PATH || 'admin').trim().replace(/^\/+|\/+$/g, '') || 'admin';
await check('admin console is noindex', `/${adminSegment}/overview`, [is('noindex', (o) => (o.robots || '').includes('noindex'))]);
if (adminSegment !== 'admin') {
  await check('old /admin is noindex', '/admin/overview', [is('noindex', (o) => (o.robots || '').includes('noindex'))]);
}

/*
 * "Ask my people" boards (migration 0077).
 *
 * A shared board is a private family conversation reached by an unguessable
 * token, and that token IS the credential — an indexed one is a leaked one.
 * Asserted here rather than trusted to the prefix list, because the cost of
 * someone later reordering NOINDEX_PREFIXES is not a ranking wobble, it is
 * every buyer's shortlist in a search index.
 */
await check('shared shortlist is noindex', '/shortlist/00000000000000000000000000000000', [
  is('noindex meta', (o) => (o.robots || '').includes('noindex')),
  is('X-Robots-Tag', (o) => (o.xRobots || '').includes('noindex')),
]);
await check('my shortlists is noindex', '/shortlists', [
  is('noindex meta', (o) => (o.robots || '').includes('noindex')),
  is('X-Robots-Tag', (o) => (o.xRobots || '').includes('noindex')),
]);

/*
 * Soft 404s.
 *
 * A path whose subject does not exist still returns the SPA shell with HTTP
 * 200 — there is no origin that could 404 it. Left alone, that is an indexable
 * page with a self-referencing canonical, and the supply of them is unbounded
 * (any string after /products/ is one). `noindex` is what actually keeps them
 * out; the header covers crawlers that never parse the head.
 */
for (const [label, p] of [
  ['unknown product', '/products/definitely-not-a-real-product-slug-zz99'],
  ['unknown boutique', '/boutique/definitely-not-a-real-boutique-zz99'],
  ['unknown category', '/collections/definitely-not-a-category-zz99'],
  ['unknown route', '/definitely-not-a-route-zz99'],
]) {
  await check(`soft 404: ${label}`, p, [
    is('noindex meta', (o) => (o.robots || '').includes('noindex')),
    is('X-Robots-Tag', (o) => (o.xRobots || '').includes('noindex')),
    is('not the generic title', (o) => o.title !== 'MangaiMart'),
  ]);
}

/*
 * The written pages. They are in the sitemap, so they are crawled; without a
 * STATIC_META entry all nine served one shared title and description and
 * competed as duplicates of each other.
 */
for (const p of ['/about', '/help', '/privacy-policy', '/terms', '/shipping-policy',
                 '/delivery-policy', '/return-refund-policy', '/cancellation-policy', '/product-policy']) {
  await check(`static meta ${p}`, p, [
    is('own title', (o) => !!o.title && o.title !== 'MangaiMart'),
    is('indexable', (o) => (o.robots || '').startsWith('index')),
    is('canonical', (o) => !!o.canonical),
  ]);
}

// Legacy 301s
for (const [from, to] of [
  ['/buyer/home', '/'],
  ['/buyer/results', '/shop'],
  ['/buyer/collections', '/collections'],
  ['/buyer/policy/privacy-policy', '/privacy-policy'],
  ['/buyer/orders/abc123/track', '/orders/abc123/track'],
  ['/b/some-boutique', '/boutique/some-boutique'],
  ['/buyer/product/1f2e3d4c-aaaa-bbbb-cccc-ddddeeeeffff', '/products/1f2e3d4c-aaaa-bbbb-cccc-ddddeeeeffff'],
]) {
  await check(`301 ${from}`, from, [
    is('301', (o) => o.status === 301),
    is(`→ ${to}`, (o) => o.location === `${origin}${to}`),
  ]);
}

// Real URLs, discovered from the sitemap children.
const fetchXml = async (path) => (await middleware(new Request(`${origin}${path}`))).text();
const [pagesXml, boutiquesXml, productsXml] = await Promise.all([
  fetchXml('/sitemap-pages.xml'),
  fetchXml('/sitemap-boutiques.xml'),
  fetchXml('/sitemap-products.xml'),
]);
const xml = pagesXml + boutiquesXml + productsXml;
const productUrl = (productsXml.match(/<loc>[^<]*(\/products\/[^<]+)<\/loc>/) || [])[1];
const boutiqueUrl = (boutiquesXml.match(/<loc>[^<]*(\/boutique\/[^<]+)<\/loc>/) || [])[1];
const cityUrl = (pagesXml.match(/<loc>[^<]*(\/boutiques\/[^<]+)<\/loc>/) || [])[1];

/*
 * Home hero preload. The hero is a paid `home_hero` ad, so this only asserts
 * when one is actually live — with no campaign running there is no hero on the
 * page and correctly nothing to preload.
 */
{
  const problems = home.preloadHref
    ? preloadProblems(home, '100vw')
    : home.preconnect
      ? []
      : ['no preconnect to the Supabase origin'];
  results.push(
    problems.length
      ? { label: 'home LCP preload', FAIL: problems.join('; ') }
      : {
          label: 'home LCP preload',
          status: 200,
          title: home.preloadHref ? 'hero preloaded + preconnect' : 'no live hero ad — preconnect only',
        },
  );
}

if (productUrl) {
  const pdp = await check('product page', productUrl, [
    is('200', (o) => o.status === 200),
    is('og:type=product', (o) => o.ogType === 'product'),
    is('one description tag', (o) => o.descriptionCount === 1),
    is('one geo.region tag', (o) => o.geoRegionCount === 1),
    is('Product schema', (o) => (o.schema || '').includes('Product')),
    is('Breadcrumb', (o) => (o.schema || '').includes('BreadcrumbList')),
    // The whole point of the prerender: a crawler that does not run JavaScript
    // must leave with the product's name and a way onward.
    is('crawlable <h1>', (o) => !!o.noscriptH1),
    is('internal links', (o) => o.noscriptLinks >= 2),
  ]);
  // The PDP's first gallery slide renders `ImageSlot` with no `sizes` prop, so
  // the component default is what the preload has to declare.
  const problems = preloadProblems(pdp, '(min-width: 768px) 320px, 50vw');
  results.push(
    problems.length
      ? { label: 'product LCP preload', FAIL: problems.join('; ') }
      : { label: 'product LCP preload', status: 200, title: 'first gallery slide preloaded + preconnect' },
  );
} else results.push({ label: 'product page', FAIL: 'no product in sitemap — DB unreachable?' });

// The uuid branch needs no migration, so it proves the resolve/render path.
await check('product by uuid', '/products/4c5c667b-c7d6-4979-83c1-c4e9b6c7b7a4', [
  is('301 to canonical slug', (o) => o.status === 301 && /\/products\/.+-4c5c667b$/.test(o.location || '')),
]);

if (boutiqueUrl) {
  await check('boutique page', boutiqueUrl, [
    is('200', (o) => o.status === 200),
    is('ClothingStore schema', (o) => (o.schema || '').includes('ClothingStore')),
    is('crawlable <h1>', (o) => !!o.noscriptH1),
  ]);
} else results.push({ label: 'boutique page', FAIL: 'no boutique in sitemap' });

/*
 * The city landing pages.
 *
 * `/boutiques/<city>` and `/boutique/<slug>` differ by one character, and the
 * router resolves them with two separate regexes — so the check that matters is
 * that a city URL is NOT being answered as a missing shop.
 */
if (cityUrl) {
  await check('city landing', cityUrl, [
    is('200', (o) => o.status === 200),
    is('indexable', (o) => (o.robots || '').startsWith('index')),
    is('city in title', (o) => /Boutiques in \S/.test(o.title || '')),
    is('CollectionPage schema', (o) => (o.schema || '').includes('CollectionPage')),
    is('crawlable <h1>', (o) => !!o.noscriptH1),
  ]);
} else results.push({ label: 'city landing', FAIL: 'no /boutiques/<city> in the page sitemap' });

// A city with no approved shop must be a soft 404, or `/boutiques/<anything>`
// becomes an unbounded supply of indexable empty pages.
await check('unknown city', '/boutiques/definitely-not-a-city-zz99', [
  is('noindex meta', (o) => (o.robots || '').includes('noindex')),
  is('X-Robots-Tag', (o) => (o.xRobots || '').includes('noindex')),
]);

/*
 * Every hub that gained a database-backed body.
 *
 * Only /boutiques and /shop were checked here, which is how the migration-0073
 * breakage stayed invisible: /top-boutiques lost its body at the same moment
 * /boutiques did, and nothing asked. A hub serving its <head> and an empty
 * <div id="root"> is, to a crawler that does not run JavaScript, a blank page —
 * indistinguishable from the soft 404s three checks up. Each of these is a URL
 * in the sitemap, so each has to prove it carries a heading and a way onward.
 */
for (const [label, pathname, schemaType] of [
  ['boutiques hub', '/boutiques', 'CollectionPage'],
  ['shop hub', '/shop', null],
  ['new-arrivals hub', '/new-arrivals', null],
  ['best-sellers hub', '/best-sellers', null],
  ['top-boutiques hub', '/top-boutiques', null],
  ['inspire hub', '/inspire', null],
]) {
  await check(label, pathname, [
    is('200', (o) => o.status === 200),
    is('indexable', (o) => (o.robots || '').startsWith('index')),
    is('crawlable <h1>', (o) => !!o.noscriptH1),
    is('internal links', (o) => o.noscriptLinks >= 2),
    ...(schemaType ? [is(`${schemaType} schema`, (o) => (o.schema || '').includes(schemaType))] : []),
  ]);
}

/*
 * /inspire shipped in the sitemap and in no crawlable link on the site, which
 * is an orphan: Google accepts the URL, discounts it, and recrawls it rarely.
 * `hubNav` in middleware.js is what fixed it, and this is what keeps it fixed.
 */
await check('inspire is linked, not orphaned', '/new-arrivals', [
  is('a hub links to /inspire', (o) => /href="[^"]*\/inspire"/.test(o.noscriptHtml || '')),
]);

// FAQ rich results on /help. The markup is only legitimate while the same Q&A
// is rendered on the page — see HELP_FAQ in middleware.js.
await check('help FAQ schema', '/help', [
  is('FAQPage', (o) => (o.schema || '').includes('FAQPage')),
]);

/*
 * The public seller site.
 *
 * The failure this guards against is specific and silent: `/seller` is a
 * noindex prefix, and `isNoIndex` matches on prefixes. Anything that widened
 * that rule — or a rename of these routes to sit under /seller — would make
 * the recruitment pages `noindex, nofollow` while they still rendered
 * perfectly in a browser. Nobody would notice until the traffic never came.
 */
for (const path of ['/sell', '/sell/pricing', '/sell/faq']) {
  await check(`seller site ${path}`, path, [
    is('200', (o) => o.status === 200),
    is('indexable', (o) => (o.robots || '').startsWith('index') && !(o.xRobots || '').includes('noindex')),
    is('has its own title', (o) => !!o.title && !/^MangaiMart$/.test(o.title)),
    is('canonical is itself', (o) => (o.canonical || '').endsWith(path)),
  ]);
}
await check('seller site is in the page sitemap', '/sitemap-pages.xml', [
  is('/sell listed', () => pagesXml.includes('/sell</loc>')),
  is('/sell/pricing listed', () => pagesXml.includes('/sell/pricing</loc>')),
]);

// A category landing, discovered from the page sitemap.
const collectionUrl = (pagesXml.match(/<loc>[^<]*(\/collections\/[^<]+)<\/loc>/) || [])[1];
if (collectionUrl) {
  await check('collection landing', collectionUrl, [
    is('200', (o) => o.status === 200),
    is('CollectionPage schema', (o) => (o.schema || '').includes('CollectionPage')),
    is('crawlable <h1>', (o) => !!o.noscriptH1),
    is('product links', (o) => o.noscriptLinks >= 2),
  ]);
} else results.push({ label: 'collection landing', FAIL: 'no /collections/<slug> in the page sitemap' });

/*
 * Colour and budget landings.
 *
 * These two facets were the last tiles on /collections that only set a filter
 * and pushed the buyer to the shared grid — no URL, nothing to share, nothing to
 * rank, while category/occasion/fabric each had a real page. They are route
 * families now, so they are checked like the others: in the sitemap, answering
 * 200, with the same schema and a crawlable heading.
 */
for (const [label, prefix] of [['colour landing', '/colours/'], ['budget landing', '/budget/']]) {
  const url = (pagesXml.match(new RegExp(`<loc>[^<]*(${prefix}[^<]+)</loc>`)) || [])[1];
  if (url) {
    await check(label, url, [
      is('200', (o) => o.status === 200),
      is('CollectionPage schema', (o) => (o.schema || '').includes('CollectionPage')),
      is('crawlable <h1>', (o) => !!o.noscriptH1),
      is('product links', (o) => o.noscriptLinks >= 2),
    ]);
  } else results.push({ label, FAIL: `no ${prefix}<slug> in the page sitemap` });
}

// A budget rung that does not exist must not be served as a page — otherwise
// /budget/under-7 is an indexable soft 404 for every number anyone types.
await check('unknown budget rung 404s', '/budget/under-7', [
  is('noindex', (o) => (o.robots || '').includes('noindex')),
]);

/*
 * The preview guard.
 *
 * `isPreviewHost` used to lead with `!!CANONICAL_HOST &&`, so with VITE_SITE_URL
 * unset it disabled itself — and a *.vercel.app deploy served the entire
 * catalogue as indexable, competing with the live domain for its own stock.
 * Driven over a real preview-shaped host rather than 127.0.0.1, which stays
 * exempt on purpose so this very script can run.
 */
{
  const res = await middleware(new Request('https://mangaimart-git-preview.vercel.app/robots.txt'));
  const body = res ? await res.text() : '';
  results.push(
    /User-agent: \*\s*\nDisallow: \/\s*$/m.test(body)
      ? { label: 'preview robots.txt', status: res.status, title: 'Disallow: / — preview is walled off' }
      : { label: 'preview robots.txt', FAIL: 'a *.vercel.app deploy is serving the crawlable robots.txt' },
  );
}

/*
 * The canonical-host redirect, checked in a child process.
 *
 * `VERCEL_ENV` is read into a module-level const when middleware.js is
 * imported, so it cannot be changed after the fact — and setting it in THIS
 * process would make every check above redirect 127.0.0.1 to the live domain.
 * A child with the production environment is the only way to exercise it.
 *
 * What it protects: `agilam-boutiques.vercel.app` was serving the identical
 * catalogue, indexable and self-canonical, putting a second copy of the whole
 * shop into Google under a name that is not the brand. `www.mangaimart.com`
 * answered 200 with no redirect and was a third. Both must 301 to the apex.
 */
{
  const probe = `
    const { default: mw } = await import(${JSON.stringify(pathToFileURL(path.resolve('middleware.js')).href)});
    const out = [];
    for (const from of [
      'https://agilam-boutiques.vercel.app/products/some-piece-1a2b3c4d',
      'https://www.mangaimart.com/boutiques',
      'https://agilam-boutiques.vercel.app/buyer/collections',
    ]) {
      const res = await mw(new Request(from));
      out.push([from, res ? res.status : 0, res ? res.headers.get('location') : null]);
    }
    // The canonical host itself must NOT redirect, or the site is a loop.
    const same = await mw(new Request('https://mangaimart.com/shop'));
    out.push(['https://mangaimart.com/shop', same ? same.status : 0, same ? same.headers.get('location') : null]);
    console.log(JSON.stringify(out));
  `;
  const raw = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
    env: { ...process.env, VERCEL_ENV: 'production' },
    encoding: 'utf8',
  });
  const rows = JSON.parse(raw.trim().split('\n').pop());
  const problems = [];
  for (const [from, status, location] of rows.slice(0, 3)) {
    if (status !== 301) problems.push(`${from} → ${status}, expected 301`);
    else if (!location?.startsWith('https://mangaimart.com/')) problems.push(`${from} → ${location}`);
  }
  // The legacy path and the host rewrite must collapse into ONE hop.
  const legacy = rows[2];
  if (legacy[2] && legacy[2] !== 'https://mangaimart.com/collections') {
    problems.push(`legacy path not resolved in the same hop: ${legacy[2]}`);
  }
  const canonicalSelf = rows[3];
  if (canonicalSelf[1] === 301) problems.push('the canonical host redirects to itself — redirect loop');
  results.push(
    problems.length
      ? { label: 'canonical host 301', FAIL: problems.join('; ') }
      : { label: 'canonical host 301', status: 301, title: 'vercel.app + www → mangaimart.com, one hop, no loop' },
  );
}

/*
 * Occasion headings. Sellers type the vocabulary, so a term can already end in
 * "wear" — appending unconditionally published "office wear wear" in the title,
 * the H1, the breadcrumb and the description of every such page.
 */
for (const occasionUrl of [...xml.matchAll(/<loc>[^<]*(\/occasions\/[^<]+)<\/loc>/g)].map((m) => m[1])) {
  await check(`occasion heading ${occasionUrl}`, occasionUrl, [
    is('no doubled "wear"', (o) => !/wear\s+wear/i.test(o.title || '')),
    is('title-cased', (o) => !/^[a-z]/.test(o.title || '')),
  ]);
}

/*
 * Guard: no JSDoc inside `export const config`.
 *
 * Vercel reads that object with @vercel/static-config, which destructures
 * `prop.getChildren()` as [name, colon, value]. A JSDoc comment attached to a
 * property adds a leading child, so `value` becomes the `:` token and the
 * deploy dies with `Unhandled type: "ColonToken" :` — after Vite reports
 * success, naming no file, and never reproducing locally. Checked with a plain
 * string scan so this costs no dependency.
 */
{
  const src = fs.readFileSync('middleware.js', 'utf8');
  const start = src.indexOf('export const config');
  const open = src.indexOf('{', start);
  const close = src.indexOf('\n};', open);
  const objectBody = start === -1 ? '' : src.slice(open, close);
  if (start === -1) {
    results.push({ label: 'config export', FAIL: 'no `export const config` in middleware.js' });
  } else if (objectBody.includes('/**')) {
    results.push({
      label: 'config has no JSDoc',
      FAIL: 'JSDoc comment inside `export const config` — Vercel will fail the build with `Unhandled type: "ColonToken"`. Use // or move the prose above the export.',
    });
  } else {
    results.push({ label: 'config has no JSDoc', status: 200, title: 'safe for @vercel/static-config' });
  }
}

console.log('matcher:', JSON.stringify(config.matcher));
console.log('sitemap urls:', (xml.match(/<loc>/g) || []).length);
for (const r of results) {
  const tag = r.FAIL ? 'FAIL' : ' ok ';
  console.log(`[${tag}] ${String(r.label).padEnd(26)} status=${r.status ?? '-'} ${r.FAIL ? '<<< ' + r.FAIL : (r.title || r.location || r.contentType || '')}`);
  if (r.schema) console.log(`        schema: ${r.schema}`);
}
console.log(results.some((r) => r.FAIL) ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
server.close();
