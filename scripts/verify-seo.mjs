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
  };
  const problems = (assertions || []).filter((a) => !a.ok(out)).map((a) => a.name);
  if (problems.length) out.FAIL = problems.join('; ');
  results.push(out);
}

const is = (n, f) => ({ name: n, ok: f });

await check('robots.txt', '/robots.txt', [
  is('200', (o) => o.status === 200),
  is('text/plain', (o) => (o.contentType || '').includes('text/plain')),
  is('has Sitemap with origin', (o) => o.bodyLen > 200),
]);
await check('sitemap.xml', '/sitemap.xml', [
  is('200', (o) => o.status === 200),
  is('xml', (o) => (o.contentType || '').includes('xml')),
]);
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

// A real product + boutique, discovered from the sitemap.
const sm = await middleware(new Request(`${origin}/sitemap.xml`));
const xml = await sm.text();
const productUrl = (xml.match(/<loc>[^<]*(\/products\/[^<]+)<\/loc>/) || [])[1];
const boutiqueUrl = (xml.match(/<loc>[^<]*(\/boutique\/[^<]+)<\/loc>/) || [])[1];

if (productUrl) {
  await check('product page', productUrl, [
    is('200', (o) => o.status === 200),
    is('og:type=product', (o) => o.ogType === 'product'),
    is('Product schema', (o) => (o.schema || '').includes('Product')),
    is('Breadcrumb', (o) => (o.schema || '').includes('BreadcrumbList')),
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
  ]);
} else results.push({ label: 'boutique page', FAIL: 'no boutique in sitemap' });

console.log('matcher:', JSON.stringify(config.matcher));
console.log('sitemap urls:', (xml.match(/<loc>/g) || []).length);
for (const r of results) {
  const tag = r.FAIL ? 'FAIL' : ' ok ';
  console.log(`[${tag}] ${String(r.label).padEnd(26)} status=${r.status ?? '-'} ${r.FAIL ? '<<< ' + r.FAIL : (r.title || r.location || r.contentType || '')}`);
  if (r.schema) console.log(`        schema: ${r.schema}`);
}
console.log(results.some((r) => r.FAIL) ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
server.close();
