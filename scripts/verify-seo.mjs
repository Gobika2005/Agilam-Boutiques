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
    schema: (() => {
      const m = body.match(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s);
      if (!m) return null;
      try { const j = JSON.parse(m[1].replace(/\\u003c/g, '<')); return (j['@graph'] ?? [j]).map((n) => n['@type']).join(','); }
      catch (e) { return 'PARSE_ERROR: ' + e.message; }
    })(),
    bodyLen: body.length,
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
      };
    })(),
  };
  const problems = (assertions || []).filter((a) => !a.ok(out)).map((a) => a.name);
  if (problems.length) out.FAIL = problems.join('; ');
  results.push(out);
}

const is = (n, f) => ({ name: n, ok: f });

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
await check('homepage', '/', [
  is('200', (o) => o.status === 200),
  is('real title', (o) => o.title && o.title !== 'MangaiMart'),
  is('canonical', (o) => !!o.canonical),
  is('indexable', (o) => (o.robots || '').startsWith('index')),
  is('WebSite schema', (o) => (o.schema || '').includes('WebSite')),
]);
await check('collections hub', '/collections', [is('200', (o) => o.status === 200), is('title', (o) => !!o.title)]);
await check('checkout is noindex', '/checkout', [
  is('noindex meta', (o) => (o.robots || '').includes('noindex')),
  is('X-Robots-Tag', (o) => (o.xRobots || '').includes('noindex')),
]);
await check('admin is noindex', '/admin/overview', [is('noindex', (o) => (o.robots || '').includes('noindex'))]);

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

if (productUrl) {
  await check('product page', productUrl, [
    is('200', (o) => o.status === 200),
    is('og:type=product', (o) => o.ogType === 'product'),
    is('Product schema', (o) => (o.schema || '').includes('Product')),
    is('Breadcrumb', (o) => (o.schema || '').includes('BreadcrumbList')),
    // The whole point of the prerender: a crawler that does not run JavaScript
    // must leave with the product's name and a way onward.
    is('crawlable <h1>', (o) => !!o.noscriptH1),
    is('internal links', (o) => o.noscriptLinks >= 2),
  ]);
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

// The two hubs that gained a database-backed body.
await check('boutiques hub', '/boutiques', [
  is('200', (o) => o.status === 200),
  is('ItemList schema', (o) => (o.schema || '').includes('CollectionPage')),
  is('crawlable <h1>', (o) => !!o.noscriptH1),
]);
await check('shop hub', '/shop', [
  is('200', (o) => o.status === 200),
  is('crawlable <h1>', (o) => !!o.noscriptH1),
]);

// FAQ rich results on /help. The markup is only legitimate while the same Q&A
// is rendered on the page — see HELP_FAQ in middleware.js.
await check('help FAQ schema', '/help', [
  is('FAQPage', (o) => (o.schema || '').includes('FAQPage')),
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
