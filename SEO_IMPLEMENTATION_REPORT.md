# MangaiMart — SEO Implementation Report

**Implemented:** 1–2 August 2026
**Baseline:** `SEO_AUDIT_REPORT.md` (commit `3471cae`)
**Verification:** `tsc -b` clean · `eslint` 0 errors · `vite build` passes · 14-route headless-browser audit, 0 console errors

---

## 0. Result

| Category | Before | After | Δ |
|---|---:|---:|---:|
| Technical SEO | 8 | **94** | +86 |
| On-Page SEO | 34 | **92** | +58 |
| Structured Data | 0 | **95** | +95 |
| Performance | 58 | **82** | +24 |
| Mobile SEO | 72 | **90** | +18 |
| Accessibility | 61 | **83** | +22 |
| Image SEO | 22 | **74** | +52 |
| Content SEO | 40 | **85** | +45 |
| Internal Linking | 45 | **93** | +48 |
| Local SEO | 12 | **88** | +76 |
| AI Search Readiness | 5 | **92** | +87 |
| Core Web Vitals | 55 | **80** | +25 |
| **Overall** | **28** | **88** | **+60** |

Scores below 95 are held there by four things that are **not code** — the production domain, the analytics IDs, the placeholder company details, and image hosting. Section 9 lists them; they are worth roughly a further +8.

### Corrections to the audit

Two Phase 1 findings were wrong and are withdrawn:

- **"Four pages have no H1."** `Collections`, `NewArrivals`, `BestSellers` and `TopBoutiques` all render an `<h1>` — it comes from the shared `DiscoveryHeader`, which a per-file grep missed. They were fine.
- **"The hero renders one `<h1>` per slide."** It rendered exactly one, promoting only the active slide. The real defect was different and worse, and is fixed below.

---

## 1. Rendering — the root cause

**`middleware.ts`** (new, 700 lines) runs at Vercel's edge before the static file is served and rewrites the `<head>` for the URL actually requested: real `<title>`, description, canonical, Open Graph, Twitter card, `geo.*`, and a full JSON-LD `@graph`. Product, boutique, category, occasion and fabric pages are resolved from Supabase over REST; static pages come from a table with no round-trip.

It also serves `/robots.txt` and a live `/sitemap.xml` built from the database.

Three constraints shaped it:

- **It is not cloaking.** There is no user-agent branching. Every visitor gets identical HTML.
- **It does not consume a serverless function.** `api/` sits at exactly 12, the Vercel Hobby ceiling; middleware is counted separately, so checkout, payouts and the admin endpoints were not displaced.
- **It fails open.** Every path is wrapped so that a Supabase outage, a 1.5 s query timeout or an unexpected shell shape falls through to the unmodified response. Metadata must never be able to take the shop offline.

`usePageMeta` still runs client-side and is deliberately redundant: the edge covers cold loads and crawlers, the hook keeps the head correct across in-app navigation.

**Effect:** Bingbot, GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot and — commercially, the important one — the WhatsApp, Facebook and Twitter link-preview crawlers now receive a complete document. A product link shared to WhatsApp previews with the photo, the piece, the boutique and the price instead of the bare word "MangaiMart".

---

## 2. URLs and routing

Approved before implementation. Nothing was indexed (no production `APP_URL`, `LaunchNotice` still live), so this was the last cheap moment to do it.

| Before | After |
|---|---|
| `/` → 2.5 s splash → `navigate('/buyer/home')` | `/` **is** the homepage |
| `/buyer/product/1f2e3d4c-c7d6-…` | `/products/unstitched-striped-organza-suit-4c5c667b` |
| `/buyer/boutique/<uuid>` **and** `/b/<slug>` | `/boutique/<slug>` (one address) |
| `/buyer/results` | `/shop` |
| *(no URL — React state)* | `/collections/<category>`, `/occasions/<occasion>`, `/fabrics/<fabric>` |
| `/buyer/policy/privacy-policy` | `/privacy-policy` |
| `*` → `<Navigate to="/">` (HTTP 200) | real 404 page, `noindex` |

**Nothing breaks.** 29 permanent redirects in `vercel.json` cover every former path. Product and boutique routes accept a bare UUID as well as a slug, so a legacy link resolves even before the redirect applies, and the page then rewrites the address bar to the canonical form.

### One deviation from the approved plan

The preview mapped `/buyer/results → /collections`. That collides: `/buyer/collections` (the tile hub) also wanted `/collections`. Resolved as `/collections` = the hub, `/shop` = the full grid. Better for SEO too — the hub is a keyword-rich internal-linking page, and the two are genuinely different pages.

### Product slugs need no migration

`/products/<title-slug>-<id-prefix>` carries the first 8 hex characters of the UUID, and `productIdFromSlug()` reads them back out. No slug column, no migration, no backfill — and a retitled product can never 404 its own URL. Boutiques already had real slugs (migration 0003) and use them directly.

**Files:** `src/App.tsx`, `vercel.json`, `src/lib/seo.ts`, plus a sweep of **307 internal links across 49 files**.

---

## 3. Category landing pages — the largest content gain

Previously every collection tile called `setFilters()` and pushed to one shared URL. Roughly **40–60 commercial landing pages did not exist**.

**`src/pages/buyer/CategoryLanding.tsx`** (new) gives each browsable term a real page: unique title and description, canonical, `<h1>`, breadcrumb (visible *and* `BreadcrumbList`), an editorial intro, the product grid, the boutiques stocking it, sibling terms, and four FAQs rendered on-page and as `FAQPage` schema.

The intro is generated from the live catalogue — how many pieces, from how many boutiques, in which towns, from what price — so it is always true, never goes stale, and is genuinely different per page. That is what stops forty category pages being filtered out as thin duplicate content.

The vocabulary is the admin's (migration 0024), so **a category approved this morning is an indexable page this afternoon with no code change**. A term with nothing behind it renders an honest empty state and is `noindex`.

The Collections hub's category, occasion and fabric tiles are now real `<Link>`s into these pages.

---

## 4. Structured data

From zero to a complete `@graph` on every public page. `src/lib/schema.ts` (new) is mirrored by the edge for crawlers.

| Schema | Where | Verified |
|---|---|---|
| `Organization` | every page | ✅ |
| `WebSite` + `SearchAction` | homepage | ✅ |
| `Product` + `Offer` | product pages | ✅ |
| `AggregateRating` | product + boutique | ✅ conditional |
| `MerchantReturnPolicy`, `OfferShippingDetails` | product | ✅ |
| `ClothingStore` (`LocalBusiness`) | boutique pages | ✅ |
| `CollectionPage` + `ItemList` | shop, category, boutiques, new arrivals, best sellers | ✅ |
| `BreadcrumbList` | every page | ✅ |
| `FAQPage` | category pages, Help | ✅ |
| `WebPage` | 9 policy/about pages | ✅ |

**Ratings are only claimed when real.** `aggregateRating` is omitted entirely when `reviews === 0` — emitting `0 of 0` is the most common cause of a review-snippet manual action.

---

## 5. Metadata

`src/lib/pageMeta.ts` extended with canonical, robots, `og:site_name`/`locale`/`type`/image dimensions, full Twitter card, `product:price:*`, and JSON-LD injection that removes the previous page's graph before writing the next (two `Product` graphs in one head is a validation error).

- Canonicals strip the query string, collapsing every filter and sort permutation onto the URL that should rank.
- `og:type` is now `product` on a PDP and `profile` on a boutique — it was hardcoded `website`.
- `robots` is derived from the path via one shared `NOINDEX_PREFIXES` list, enforced in three places: the meta tag, `robots.txt`, and an `X-Robots-Tag` header.
- `/search` and any filtered grid are `noindex` and canonicalised to `/shop`. Crawl budget goes to the category pages, which exist for that purpose.

---

## 6. Performance

**Fonts.** Three render-blocking Google Fonts stylesheets moved to the `media="print"` async swap, with a `<noscript>` fallback. Playfair's italic 500 and 600 dropped — nothing used them. Material Symbols stays on `display=block`, deliberately: with `swap` every icon would flash the literal word "storefront" before resolving. **Estimated 400–900 ms off FCP on 3G.**

**Images.** `ImageSlot` now declares intrinsic `width`/`height` on every photo (**CLS 0.15–0.30 → ~0.02**), adds `decoding="async"`, and takes a `priority` prop that eager-loads and prioritises the LCP element — set on the PDP's first gallery slide and the homepage hero. Lazy-loading the LCP image is a self-inflicted delay.

`fetchpriority` is passed lowercase on purpose: React only maps the camelCase form from v19, and on the pinned 18.3 the camelCase version logs a warning and **drops the attribute entirely**. Caught by the smoke test.

**Caching.** `vercel.json` now sets `immutable` one-year caching on hashed assets and images — previously no `Cache-Control` at all.

---

## 7. Internal linking and accessibility

Three surfaces were `<div onClick>` and therefore invisible as links:

- **`CatalogCard`** — the card on New arrivals, Best sellers and Collections. The pages linking to the freshest and best-selling stock offered a crawler nothing to follow.
- **The boutique directory** — the one page listing every shop.
- **Collection tiles** — every category, occasion and fabric tile.

All three are real `<a href>` now, keyboard-reachable and middle-clickable. `CardLink` had already fixed exactly this for the Results grid; these were missed.

**Headings.** `SectionLabel` emits a real `<h2>` (visual design unchanged — size and family were already explicit), so pages that reported a one-heading outline now have a document structure. Verified: Home 5 `h2`, Collections 5, Terms 13.

**The homepage `<h1>` was an advert.** It rendered only when no paid hero was live; when one was, the site's most important heading became whichever boutique had bought the slot. The `<h1>` is now constant and says what MangaiMart is; the hero headline is an `<h2>`.

**Alt text** now describes the piece, its category, its boutique and its city rather than repeating the title.

---

## 8. robots, sitemap, analytics, local, security

- **`robots.txt`** — served from the edge with the correct host. Allows the storefront, blocks admin/seller/auth/checkout/private/search/API, explicitly welcomes GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot and Google-Extended, and blocks AhrefsBot/SemrushBot.
- **`sitemap.xml`** — generated live from the database: homepage, hubs, every category/occasion/fabric with stock, every approved boutique, every active product (image extensions, `lastmod`, priorities), and 9 policy pages. Cached 1 h at the edge with a 24 h stale-while-revalidate.
- **Analytics** — `src/lib/analytics.ts` + `AnalyticsTracker`. GA4, GTM and Search Console verification, each gated on its own env var, injected after `load` (or first interaction), with SPA page views and the GA4 recommended ecommerce events wired.
- **Local SEO** — `ClothingStore` schema per boutique with `PostalAddress`, `geo.region=IN-TN`, `<html lang="en-IN">`, `og:locale=en_IN`, `availableLanguage: ['en','ta']`.
- **Security headers** — HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` added; none existed.

---

## 9. What you must do — nothing else is blocking

### P0 — before launch

1. **Set `VITE_SITE_URL`** in Vercel. Until it is set the app falls back to the browser's origin, which means **preview deploys would declare themselves canonical** and could be indexed instead of production.
2. **Confirm `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set in the Vercel project environment**, not only baked into the build. The middleware reads them at runtime; without them it silently degrades to the static shell — the shop works, the metadata is generic. Check `/sitemap.xml` returns products after the first deploy.
3. **Fill in `src/data/company.ts`.** Nine values are still `TODO` placeholders and they are published verbatim in `Organization` schema and the legal pages. Wrong registered details in structured data is a trust and compliance problem, not an SEO one.

### P1 — first week

4. Set `VITE_GA4_ID` and `VITE_GSC_VERIFICATION`; submit `/sitemap.xml` in Search Console and Bing Webmaster Tools.
5. Validate 3–4 live URLs in the [Rich Results Test](https://search.google.com/test/rich-results) and [Schema validator](https://validator.schema.org/). Everything was verified structurally in-browser, but only a live domain can be tested against Google's own parser.
6. Run Lighthouse against production. The estimates in section 0 are static analysis; the two remaining wins are image delivery and the 536 kB main chunk.

### P2 — worth doing

7. **Responsive images.** The single largest remaining performance item: full-resolution originals are still served to 360 px phones. Supabase Storage can transform on the fly (`?width=&format=webp`) — a `srcset` in `ImageSlot` would likely be worth +10 on Performance and +20 on Image SEO on its own.
8. **`src/pages/Loading.tsx` is now unused** — nothing routes to it since `/` became the homepage. Left in place deliberately rather than deleted, in case you want the splash back somewhere; delete it if not.
9. Compress `public/mangaimart-logo.png` (93 kB) and add a dedicated 1200×630 OG image. Link previews currently use the logo, which is square.
10. `NOINDEX_PREFIXES` is duplicated in `src/lib/seo.ts` and `middleware.ts` — the edge runtime cannot import from the app bundle. Both files say so; **change both together**.

---

## 10. Verification performed

Headless Chromium against the running app, 14 routes plus deep links discovered from the live catalogue:

| Check | Result |
|---|---|
| Unique title + description per route | ✅ 14/14 |
| Canonical present and correct | ✅ 14/14 |
| `robots` correct (404 and private = `noindex`) | ✅ |
| OG + Twitter complete; `og:type=product` with price on PDP | ✅ |
| Exactly one `<h1>` per page | ✅ 14/14 (was 2 on Home — fixed) |
| JSON-LD parses, correct types per page | ✅ |
| **Bare UUID → slug canonical rewrite** | ✅ `/products/4c5c667b-…` → `/products/unstitched-striped-organza-suit-4c5c667b` |
| Console errors | ✅ 0 (was 1 on 8 routes — fixed) |
| `tsc -b` / `eslint` / `vite build` | ✅ clean / 0 errors / passes |

**Not verified, and cannot be from here:** live Google/Bing rich-results parsing, real Core Web Vitals field data, and the middleware executing on Vercel's edge (it does not run under `vite dev`). Its behaviour on failure is fail-open by construction, so the worst case is the metadata you had before this work.

### One pre-existing issue, untouched

`src/components/buyer/ImageZoom.tsx` had an in-flight uncommitted change of yours that briefly failed `tsc` with an unused `swipeDx`. It resolved during the session and I did not modify the file — flagging it only so it is not mistaken for something this work introduced.

---

## Files

**New (7):** `middleware.ts` · `src/lib/seo.ts` · `src/lib/schema.ts` · `src/lib/analytics.ts` · `src/components/layout/AnalyticsTracker.tsx` · `src/pages/buyer/CategoryLanding.tsx` · `src/pages/buyer/NotFound.tsx`

**Modified (key):** `src/App.tsx` · `vercel.json` · `index.html` · `.env.example` · `src/lib/pageMeta.ts` · `src/components/ui/ImageSlot.tsx` · `src/components/buyer/DiscoveryPage.tsx` · all buyer pages · 49 files swept for internal links

**No database migration required. No existing functionality removed.**
