# SEO Completion — MangaiMart

**2026-08-08** · branch `fix/seller-console-audit-2026-08`
Follows `SEO_AUDIT_REPORT.md` and `SEO_IMPLEMENTATION_REPORT.md`, which built the
edge SEO layer. This pass closes what that work left open.

**No migration.** Nothing here touches the schema. `0060` is still the next number.

Verified locally: `npm run build` ✅ · `npm run lint` (0 errors) ✅ ·
`npm run verify:seo` → **ALL CHECKS PASSED** against the live database ✅ ·
the Merchant Center feed handler executed against the live catalogue, emitting
16 valid items ✅. Production behaviour is **not** verified — see §3.

---

## 0. "Agilam" in Google — where it was coming from

Checked against the live web, not guessed:

| Host | Before |
|---|---|
| `mangaimart.com` | 200, correct, self-canonical ✅ |
| `agilam-boutiques.vercel.app` | **200, identical catalogue, `index, follow`, canonical pointing at itself** |
| `www.mangaimart.com` | **200, no redirect — a third indexable copy** |

The Vercel production alias was serving your entire shop from the same database
under a name that is not the brand, and telling Google it was the original. That
is the "Agilam" in the results. `www` was the same problem without the name.

**Fixed** — `CANONICAL_HOST` now falls back to `mangaimart.com` instead of empty
(§1), and any request on the production deployment arriving at a host that is
not the canonical one gets a **301 to the same path on `mangaimart.com`**.

A 301, not a canonical tag and not `noindex`: a redirect is the only signal that
both drops the duplicate from the index *and* passes whatever ranking it had
accumulated to the address that should have it. The legacy `/buyer/*` rewrite is
resolved in the same hop, so no request ever takes two redirects.

Branch previews are deliberately **not** redirected — they must stay reachable
to be tested. They are held out of the index by `isPreviewHost` instead, which
now also trusts Vercel's own `VERCEL_ENV=preview`.

Verified in a child process with `VERCEL_ENV=production`:
`agilam-boutiques.vercel.app/products/… → mangaimart.com/products/…`,
`www.mangaimart.com/boutiques → mangaimart.com/boutiques`,
`agilam-boutiques.vercel.app/buyer/collections → mangaimart.com/collections`
(one hop), and `mangaimart.com/shop` does **not** redirect — no loop.

**Nothing named "Agilam" reaches a browser.** `src/`, `index.html`, `public/`,
`api/` and the built `dist/` bundle are clean; the only occurrences left in
shipped code are explanatory comments inside `middleware.js`, which is never
served as content.

Three things still need you — the **Vercel project name** itself, which is what
generates the `agilam-boutiques.vercel.app` domain (§3.5); an **active coupon
code `AGILAM100`** in the live database (§3.6); and clearing the already-indexed
URLs out of Google faster than a recrawl would (§3.7).

---

## 1. The other one that was actively costing you

### Preview deploys were fully indexable

`isPreviewHost()` in `middleware.js` read:

```js
return !!CANONICAL_HOST && host !== CANONICAL_HOST && host.endsWith(".vercel.app");
```

`CANONICAL_HOST` comes from `VITE_SITE_URL`, **which is not set** (§3). With it
empty, the leading `!!CANONICAL_HOST` was false, so the function returned false
for every host — the guard switched itself off in exactly the configuration
where nothing else was protecting the live domain either.

Consequence: every `*.vercel.app` deploy served the whole catalogue as
indexable, from the same database, with self-referencing canonicals. Every
product existed at two or more addresses and a throwaway preview could outrank
`mangaimart.com` for its own stock.

Now, two changes:

1. `CANONICAL_HOST` falls back to the literal `mangaimart.com` rather than an
   empty string, mirroring the last line of the `SITE_URL` resolver in
   `src/lib/seo.ts`. Every guard that asks "are we on the canonical host?"
   answers correctly again, with or without the env var.
2. A `*.vercel.app` host is a deploy URL by construction and never the custom
   domain, so it is a preview unless it somehow *is* the canonical host —
   and `VERCEL_ENV=preview`, Vercel's own word for it, is trusted first.

`npm run verify:seo` drives the middleware over a real preview-shaped host and
asserts the walled-off `robots.txt` comes back.

> Setting `VITE_SITE_URL` (§3) is still worth doing — it is what makes canonical
> URLs, `og:url` and the sitemap absolute and correct on any future domain. The
> fallback means forgetting it is no longer *also* a duplicate-content leak.

---

## 2. What changed

### 2.1 Crawlable page bodies — the biggest content gap

Boutique pages already shipped a `<noscript>` body. **Product and category pages
did not** — they sent `<div id="root"></div>` and nothing else, so every crawler
that does not execute JavaScript saw a title and no text beneath it. That is
Bing, WhatsApp's link preview, GPTBot, OAI-SearchBot, PerplexityBot and
ClaudeBot — all of which `robots.txt` explicitly welcomes. Google does render,
but on a second pass queued separately from the crawl, which on a catalogue
where pieces sell out in a week is most of a page's useful life.

Added, all mirroring the existing `boutiquePrerender()`:

| Page | New `<noscript>` body |
|---|---|
| `/products/*` | H1 title, price + MRP, stock, description, category/occasion/fabric/colour list, link to the shop, link to the category |
| `/collections/*`, `/occasions/*`, `/fabrics/*` | H1 heading, the written description, up to 30 products as links with price and shop |
| `/boutiques` | H1, description, every approved shop as a link with its city |
| `/boutiques/<city>` | as above, that city only |
| `/shop` | H1, description, the 40 newest products as links |

Identical to what React paints, so no cloaking. In `<noscript>` rather than
`#root` for the reason the existing code documents: anything in `#root` is
visible to real users until React replaces it, and would trip the
`#root:not(:empty)` rule that retires the boot splash.

### 2.2 City landing pages — `/boutiques/<city>`

"Boutiques in Coimbatore" is a query with real local intent that the site had no
page for. The city filter lived in React state on `/boutiques`: one national
URL, nothing a crawler could reach, nothing to rank.

- `src/App.tsx` — new route `boutiques/:citySlug` (note the plural;
  `/boutique/:slug` singular is still a single shop).
- `src/pages/buyer/Boutiques.tsx` — the city is now read from the URL rather than
  `useState`, and the city chips **navigate** instead of setting state. Same
  screen, same behaviour for a human; every city is now a real URL.
- `middleware.js` — per-city title, description, `CollectionPage` + `ItemList` +
  breadcrumb schema, and the prerendered body.
- Every city with at least one approved shop is in the sitemap. A city with none
  returns the existing `notFoundMeta()` — so `/boutiques/<anything>` cannot
  become an unbounded supply of indexable empty pages. Asserted by the verifier.

### 2.3 Sitemap split into an index

`/sitemap.xml` is now a `<sitemapindex>` over:

- `/sitemap-pages.xml` — hubs, category/occasion/fabric landings, city landings, the 9 written pages
- `/sitemap-boutiques.xml`
- `/sitemap-products.xml`

One document meant one edge request did the 5000-row product read **and** the
2000-row boutique read, each against the 1500 ms abort in `dbTry()`. Losing
either served a sitemap missing a whole section, and the odds of losing one of
two reads are roughly twice the odds of losing one. Split, each child does a
single read — and the page sitemap no longer needs the wide column lists at all,
because a facet only needs `category/occasion/fabric` and a city only needs
`city`.

It also makes Search Console useful: "64 discovered, 61 indexed" for one blob
says nothing; the same split per section says whether it is the catalogue or the
directory that is not getting in.

`robots.txt` names the index **and** all three children — Bing and several
smaller crawlers historically read only the first `Sitemap:` line and never
expand a `<sitemapindex>`.

### 2.4 `FAQPage` schema on `/help`

The four Q&A headings already rendered on `/help` are now marked up, which is
what makes them eligible for an expanded FAQ result. The questions and answers
are mirrored verbatim from the `help` entry in `src/data/policies.ts` — **FAQ
markup is only legitimate while the same text is visible on the page.**

⚠️ Two answers interpolate constants (`support@mangaimart.com`, the 7-day return
window). If `src/data/company.ts` changes, `HELP_FAQ` in `middleware.js` must
change with it — the same mirroring discipline `api/_pricing.js` needs.

### 2.5 Google Merchant Center feed — `/merchant-feed.xml`

RSS 2.0 with the `g:` namespace, one `<item>` per live product, rebuilt on every
fetch and CDN-cached for an hour. Served by `middleware.js`.

> **It was written as `api/merchant-feed.js` first, and that would have failed
> the deploy.** `api/` already holds exactly 12 serverless functions, which *is*
> the Vercel Hobby ceiling; a 13th is a build failure. Moved to the edge, which
> is the same reason the sitemap lives there rather than at `/api/sitemap`, and
> the fit is just as good — this is a public, anonymous, cacheable read of the
> same catalogue the sitemap already walks. `api/` is back at 12.

Free Shopping listings are a **separate index** from web search with their own
surface and far more commercial intent per impression. None of the on-page work
above reaches it — Google will not build a Shopping listing from `Product`
markup on a marketplace it has no verified merchant relationship with. This is
the only route in.

Design notes worth knowing:

- **Anon key, not service-role.** It goes through the same anonymous PostgREST
  read the rest of the middleware uses. A credential that bypasses RLS has no
  business behind an endpoint whose purpose is to be fetched by a third party.
- **The path matters.** Google's scheduled feed fetch obeys `robots.txt`, and
  `robots.txt` carries a blanket `Disallow: /api/`. At `/merchant-feed.xml` the
  feed sits under the plain `Allow: /`; under `/api/` it would have been
  permanently unfetchable — a silent, total failure. The verifier now fails if
  anything ever disallows it.
- **Preview deploys are refused with a 503.** Pointed at one, Merchant Center
  would take `*.vercel.app` URLs as the landing pages for the entire catalogue.
- **One item per product, not per size.** Apparel feeds normally emit a variant
  per size sharing an `item_group_id`; that needs per-size stock, which this
  catalogue does not track. Every variant would carry the parent's availability
  and Merchant Center would eventually flag the mismatch against the landing
  page. Revisit if `products` gains per-size stock.
- **`google_product_category` is the single value `Apparel & Accessories >
  Clothing` for everything.** An unrecognised category is an item-level error,
  and the seller-typed vocabulary ("Half saree", "Office wear") does not map onto
  Google's taxonomy cleanly enough to risk it catalogue-wide. The seller's own
  terms go in `product_type`, which is free text and is not validated.
- **A failed read returns 503, not an empty feed.** An empty feed tells Merchant
  Center the catalogue was withdrawn and it delists everything; a failed fetch
  makes it keep serving the last good one.
- Products with no photo are dropped — Merchant Center rejects them, and an
  error rate across a large slice of the feed can suspend the account.

### 2.6 Smaller items

- **`public/manifest.webmanifest`** + `<link rel="manifest">`, with name,
  description, `lang: en-IN`, theme colours matching the light theme, and
  shortcuts to Shop / Boutiques / Orders.
- **`<link rel="icon" sizes="512x512">` was wrong** — `favicon.png` is
  1107×1107. Now `sizes="any"`, which is honest. See §3 for the resize still owed.
- **`routes.city()`** added to `src/lib/seo.ts`, so the city URL is spelled in
  one place like every other route.
- **`scripts/verify-seo.mjs`** gained checks for: the sitemap index and all three
  children (including "not empty", which is what a lost race against the abort
  looks like), the crawlable `<h1>` and internal-link count on every prerendered
  page type, the city landing, the unknown-city soft 404, the two enriched hubs,
  `FAQPage` on `/help`, the preview `robots.txt`, and the presence of every
  `Sitemap:` and `Allow:` line in `robots.txt`.

---

## 3. What needs your hand

Ordered by cost of leaving it undone.

### 3.1 Set four environment variables — **none of them are currently set**

In **Vercel → Project → Settings → Environment Variables** (Production), and in
your local `.env`. All four are already documented in `.env.example`.

| Variable | Value | What breaks without it |
|---|---|---|
| `VITE_SITE_URL` | `https://mangaimart.com` | Canonicals, `og:url` and sitemap URLs fall back to the request host. §1's fix stops the duplicate-content leak, but correct absolute URLs still need this. |
| `VITE_GA4_ID` | `G-XXXXXXXXXX` | `src/lib/analytics.ts` is written, deferred past `load` so it stays out of LCP, and completely **inert**. You currently have no measurement of organic traffic at all. |
| `VITE_GSC_VERIFICATION` | the token from Search Console | Optional — `public/google6c05c29f545eb176.html` suggests you already verified by file. Set it only if you want the meta-tag method too. |
| `VITE_GTM_ID` | `GTM-XXXXXXX` | Only if you want Tag Manager alongside or instead of GA4. |

A Vercel env var change needs a **redeploy** to reach the client bundle.

### 3.2 Google Merchant Center

The endpoint is built and returns valid XML. The account is not something I can
create.

1. Create a Merchant Center account for the registered business entity.
2. Verify and claim `mangaimart.com` (Search Console verification carries over).
3. **Business information → Shipping**: configure delivery cost and speed, and
   **Returns**: the 7-day window. Merchant Center will not approve items until
   both exist.
4. **Products → Feeds → Add feed** → *Scheduled fetch* →
   `https://mangaimart.com/merchant-feed.xml`, daily.
5. Opt into **free listings** (Growth → Manage programmes).

Expect items to sit in "Pending" for a few days on a new account, and expect
some disapprovals on the first pass — that is normal and the messages are
specific.

⚠️ **Do not point the feed at a preview URL.** The middleware refuses one with a
503, but the address you paste into Merchant Center is the one it will keep
fetching — make it the live domain.

⚠️ Merchant Center needs GST/business details consistent with what is in
`src/data/company.ts` — and that file is still carrying **placeholder values**
(see the `company-details-placeholder` note). Settle those before you apply,
because a mismatch between the feed's domain and the registered entity is the
usual reason a new account is refused.

### 3.3 Bing Webmaster Tools

Free, five minutes, and imports your Search Console property wholesale. Bing is
also the index behind ChatGPT search, so it now matters more than its share
suggests. `https://www.bing.com/webmasters` → Import from GSC → submit
`https://mangaimart.com/sitemap.xml`.

### 3.4 Resize the icons

`public/favicon.png` is **983 kB** and `public/mangaimart-logo.png` is **1.68 MB**.
The favicon is fetched on every cold load, and the logo is the default OG image
— WhatsApp and Slack will fetch that 1.68 MB file for every link preview, and
some will time out rather than show a card.

Export from the existing artwork:
- `favicon-192.png` (192×192), `favicon-512.png` (512×512) → reference from the
  manifest and `index.html`
- `og-image.png` at **1200×630** (the middleware already declares those
  dimensions) under 300 kB → make it `DEFAULT_OG_IMAGE`

I did not do this: it needs an image library that is not a dependency of this
project, and adding one for a build-time asset resize is not a trade I'd make
without asking.

### 3.5 Rename the Vercel project — the root of `agilam-boutiques.vercel.app`

The 301 in §0 removes that domain from Google, but the domain itself is
generated from the **Vercel project name**, which is still `agilam-boutiques`.
Every deployment URL, every preview link you paste to someone, and the
`x-vercel-*` headers still carry it.

**Vercel → Project → Settings → General → Project Name** → `mangaimart`. The
alias becomes `mangaimart.vercel.app`; the custom domain is unaffected and the
site does not go down.

⚠️ **After renaming, keep the redirect.** `agilam-boutiques.vercel.app` will stop
resolving, and Google needs to keep seeing the 301 for a while to drop those
URLs cleanly — the code in §0 is host-generic (anything that is not the
canonical host redirects), so it keeps working without edits.

⚠️ Several files reference the old domain as a test target — `QA_TEST_ARTIFACTS.md`,
`MANGAIMART_FULL_QA_REPORT.md`, `MANGAIMART_UI_UX_AUDIT.md`,
`ADMIN_CONSOLE_QA_REPORT.md`, `SELLER_CONSOLE_QA_REPORT.md`. They are historical
records of runs against that host, so I left them as written rather than
rewriting history. Nothing reads them at runtime.

### 3.6 The `AGILAM100` coupon is live

```
code: AGILAM100    active: true
```

It is in the production `coupons` table and is the last customer-facing string
carrying the name. I did not change it: someone may be holding that code, and
invalidating a discount a buyer already has is your call, not mine.

Two options, in `/admin/coupons`:

- **Safer** — create `MANGAI100` with the same terms, stop promoting `AGILAM100`,
  and let it expire on its own. Nobody is turned away at checkout.
- **Cleaner** — deactivate `AGILAM100` now. Anyone who tries it gets an invalid-code
  error.

It is not in `seed.sql`, so `purge_seed.sql` will not remove it.

### 3.7 Getting the already-indexed URLs out of Google faster

The 301 does this on its own, but Google re-crawls on its own schedule and it
can take weeks.

To force it: add `https://agilam-boutiques.vercel.app` as a **separate property**
in Search Console (it will verify off the same deployment), then
**Removals → New request → Remove all URLs with this prefix**. That hides them
within a day. It is a ~6-month hide, not a delete — but the 301 will have done
the permanent work long before it lapses.

Do **not** use the removal tool on `mangaimart.com`.

### 3.8 Content — the highest-leverage thing left

`middleware.js` is now doing everything markup can do. What it cannot do is
invent text.

- **Product descriptions are being pasted in unformatted.** A live example:
  `"Fabric & Design FeaturesMaterial: Sheer, airy soft organza silk…"` — headings
  welded to body text with no separator, because that is exactly how it is
  stored. This is what Google reads, what the PDP renders, and what now goes into
  the Merchant Center feed. Worth a line in the seller listing guidance.
- **16 live products, 64 sitemap URLs.** No amount of technical SEO outranks a
  competitor with 400 products. Catalogue depth is the constraint now, not markup.

---

## 4. Deliberately not done

- **`hreflang`** — one locale (`en-IN`), one market. Adding it would be noise.
- **IndexNow / instant Bing submission** — worth it once listing volume is
  higher; today the daily sitemap re-crawl is faster than the products appear.
- **Per-size feed variants** — see §2.5; needs per-size stock first.
- **Programmatic category×city pages** (`/collections/sarees/coimbatore`) — with
  16 products these would be near-empty pages competing with the pages that do
  have stock, which is the doorway-page pattern Google penalises. Revisit at a
  few hundred listings per city.
- **A `Review` schema block per product** — `aggregateRating` is already emitted
  when the rating is real. Individual review markup adds little and the existing
  code is right to refuse to fabricate ratings.

---

## 5. Files touched

```
middleware.js                      canonical-host 301, preview guard,
                                   product/collection/hub prerender, city
                                   landings, FAQPage, sitemap index,
                                   Merchant Center feed, robots.txt
scripts/daily-report.mjs           owner email now says MangaiMart, not Agilam
public/manifest.webmanifest        new
index.html                         manifest link, honest favicon sizes
src/App.tsx                        /boutiques/:citySlug route
src/lib/seo.ts                     routes.city()
src/pages/buyer/Boutiques.tsx      city filter moved from state to the URL
scripts/verify-seo.mjs             checks for all of the above
```

No new serverless function; `api/` stays at 12.

## 6. New public URLs

```
/boutiques/<city>        one per city with an approved shop, in the sitemap
/sitemap.xml             now a <sitemapindex>
/sitemap-pages.xml       new
/sitemap-boutiques.xml   new
/sitemap-products.xml    new
/merchant-feed.xml       new — Google Merchant Center
/manifest.webmanifest    new
```

Currently 64 sitemap URLs and 16 feed items against the live database.
