# SEO & Indexing — diagnosis and fix, 2026-08-11

## Short version

The sitemaps were never broken. Search Console was pointed at the wrong host and
fed the wrong URL. Two console-side corrections (yours to make) plus one real
code gap (fixed here).

Adding that missing body to the home page then surfaced a **separate, severe
production bug that had been live since 2026-08-06** — see section 0.

---

## 0. P1 — the storefront was stuck behind the loading splash

**Symptom:** the page never finishes loading. A full-screen spinner sits over
everything, forever. The app underneath had actually mounted and painted — it
was covered.

**Cause.** `index.html` paints a boot splash (`#ag-boot`) and retires it with
pure CSS the moment React fills `#root`:

```css
#root:not(:empty)+#ag-boot { opacity:0; pointer-events:none; visibility:hidden }
```

`+` is the *next-sibling* combinator. Commit `ab37ab0` (2026-08-06) started
injecting the crawlable `<noscript>` body between those two elements:

```html
<div id="root"></div>
<noscript>…the prerendered body…</noscript>   <!-- injected here -->
<div id="ag-boot">…spinner…</div>
```

`<noscript>` is a real element node even with scripting enabled, so `#ag-boot`
stopped being `#root`'s next sibling and the rule silently stopped matching. The
splash is `position:fixed; inset:0; z-index:9999`, so the site became unusable
on every page that had a prerender.

**Affected since 2026-08-06:** `/shop`, `/products/*`, `/boutique/*`,
`/boutiques`, `/boutiques/*`, `/collections/*`, `/occasions/*`, `/fabrics/*`.
The home page had no prerender, which is the only reason the site looked alive
at all. Adding one today (section 3) put `/` behind the spinner too — which is
how it finally got noticed.

**Fix.** One character, plus a comment explaining why it must stay:

```css
#root:not(:empty)~#ag-boot { … }
```

The general sibling combinator matches wherever `#ag-boot` sits after `#root`,
so nothing injected between them can break it again.

**Regression guard.** `npm run verify:seo` now asserts, on *every* HTML page it
checks, that the splash rule still matches against the DOM order actually
served. Reverting `~` to `+` fails 11 checks immediately. Nothing else in that
suite could have caught this: the metadata was perfect, the prerender was
present, the `<h1>` was there — and the page was unusable.

**Not yet deployed.** `index.html` is the fix; it ships on the next Vercel
deploy.

---

## 1. Why Search Console said "Sitemap is HTML"

The sitemap submitted was:

```
https://www.mangaimart.com/boutiques
```

That is the **boutiques page**, not a sitemap. Google fetched it, got HTML back,
and reported exactly that. Nothing was wrong with the file — the wrong file was
submitted.

The real sitemaps, verified live on 2026-08-11:

| URL | Status | Content-Type | URLs |
|---|---|---|---|
| `/sitemap.xml` (index) | 200 | `application/xml` | 3 children |
| `/sitemap-pages.xml` | 200 | `application/xml` | 39 |
| `/sitemap-boutiques.xml` | 200 | `application/xml` | 9 |
| `/sitemap-products.xml` | 200 | `application/xml` | 16 |
| `/merchant-feed.xml` | 200 | `application/xml` | 27 KB |
| `/robots.txt` | 200 | `text/plain` | lists all four sitemaps |

All 64 sitemap URLs were fetched as Googlebot: **every one returns 200 with
`index, follow`**. No soft 404s, no stray `noindex`, no broken links.

## 2. The bigger problem — the property is on the wrong host

The Search Console property is `https://www.mangaimart.com/`.

The site canonicalises to the **apex**, `https://mangaimart.com` — `middleware.js`
301-redirects every `www` request away:

```
https://www.mangaimart.com/sitemap.xml  →  301  →  https://mangaimart.com/sitemap.xml
```

That redirect is correct and should stay: apex and `www` answering separately is
how a site ends up indexed twice. But it means the `www` property will report
**zero indexed pages forever** — every URL in it is "Page with redirect". All the
indexing data lives on the apex property.

This is why `site:mangaimart.com` returns one result: Google has the homepage and
essentially nothing else, because no valid sitemap ever reached the property that
owns the canonical URLs.

## 3. Code gap found and fixed — hub pages had no crawlable body

Product, boutique and category pages have shipped a `<noscript>` body for a while
(so non-rendering crawlers get real HTML). Seven hub pages were left out. Before:

```
/                -> no <h1>, 0 links
/collections     -> no <h1>, 0 links
/new-arrivals    -> no <h1>, 0 links
/best-sellers    -> no <h1>, 0 links
/top-boutiques   -> no <h1>, 0 links
/inspire         -> no <h1>, 0 links
/shop            -> ok
```

The home page — the page with the most inbound authority — was serving a title, a
description, and an empty `<div id="root">`.

The links mattered more than the prose: the 16 facet landing pages under
`/collections/*`, `/occasions/*` and `/fabrics/*` were reachable **from the
sitemap and nowhere else** in crawlable HTML. A URL only a sitemap knows about is
an orphan; Google takes it but discounts it and is slow to recrawl.

After (verified against the live database):

```
/                h1="Boutique Ethnic Wear Online"  30 links  (categories + 24 newest pieces)
/shop            h1="Shop All Ethnic Wear"         21 links
/collections     h1="Shop by Collection"           21 links  (all 16 facet landings)
/new-arrivals    h1="New Arrivals"                 21 links
/best-sellers    h1="Best Sellers"                 21 links
/top-boutiques   h1="Top Boutiques in India"       14 links
/inspire         h1="Inspire"                      22 links
```

Each hub costs one database read inside the existing 1500 ms abort, and returns
no body rather than a slow page if that read fails. `npm run verify:seo` passes;
`npm run lint` is clean (0 errors).

**This is not deployed.** It ships on the next Vercel deploy of `middleware.js`.

---

## What you need to do in Search Console

1. **Add the right property.** Add `mangaimart.com` as a **Domain property**
   (DNS TXT verification) — it covers apex, `www`, http and https in one place.
   Failing that, add the URL-prefix property `https://mangaimart.com/`; the
   verification file `public/google6c05c29f545eb176.html` already serves 200 on
   the apex, so that route should verify immediately.

2. **On that new property, submit exactly one sitemap:**
   ```
   sitemap.xml
   ```
   Google follows the index and picks up all three children. Do not submit page
   URLs. (`robots.txt` also lists all four, which is what Bing reads.)

3. **Delete the bad entry** — remove `boutiques` from the Sitemaps list on the
   `www` property. Keep or remove the `www` property itself; it will never show
   data either way.

4. **Request indexing** for the homepage and a handful of product and boutique
   URLs via URL Inspection, to prime the first crawl.

5. **Bing** — add the site at Bing Webmaster Tools (it can import from Search
   Console) and submit the same `sitemap.xml`. Bing feeds DuckDuckGo and ChatGPT
   search.

6. **Merchant Center** — point the feed at `https://mangaimart.com/merchant-feed.xml`
   on a daily fetch schedule. It is live and returning 27 KB today. Free Shopping
   listings are a separate index from web search and this is the only route in.

## Data cleanup worth doing

Two city landing pages are built from what sellers typed into their boutique's
city field, so the URLs and headings are as good as that text:

- `/boutiques/cbe` — the boutique's city is literally `CBE`. Renders "Boutiques
  in Cbe". Set it to `Coimbatore` and the page becomes one that can actually win
  "boutiques in Coimbatore".
- `/boutiques/tirupur` — spelled `Tirupur`; the common spelling is `Tiruppur`.

Fixing the `boutiques.city` values regenerates both the URL and the heading on
the next crawl.

## Honest expectations

The catalogue is 16 products and 9 boutiques on a young domain. Correct
technical SEO gets those 64 URLs crawled and indexed over the next few weeks — it
does not manufacture demand. Ranking will follow catalogue size and the city
pages, which is where the sellers' listings do the work.
