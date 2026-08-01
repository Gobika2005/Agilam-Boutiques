# MangaiMart — SEO Audit Report

**Audited:** 1 August 2026
**Commit:** `3471cae`
**Scope:** Full technical, on-page, structured-data, performance, mobile, accessibility and AI-search audit of the existing application.
**Method:** Static inspection of the entire source tree (`src/`, `api/`, `public/`, `index.html`, `vite.config.ts`, `vercel.json`, `supabase/migrations/`). No code was modified during Phase 1.

---

## 0. Executive summary

MangaiMart is a well-engineered React application with genuinely good product data, a clean component architecture, and thoughtful UX. It is also, from a search engine's point of view, **a single blank page**.

The application is a pure client-rendered SPA. Every URL on the domain returns the same 4 KB `index.html` containing an empty `<div id="root">` and one hardcoded `<title>MangaiMart</title>`. There is no `robots.txt`, no `sitemap.xml`, no canonical tag, no structured data, and no analytics anywhere in the codebase. Product URLs are raw UUIDs. Category browsing has **no URL at all** — filters are held in React state, so the entire catalogue is reachable only through `/buyer/results`.

The good news is that almost nothing here is architecturally wrong; it is simply absent. The data model is rich enough to drive full `Product`, `LocalBusiness`, `AggregateRating` and `Review` schema today, boutiques already carry unique slugs (migration 0003), and `src/lib/pageMeta.ts` is a correct, well-documented metadata hook that just needs to be extended and made server-visible.

### Baseline score

| Category | Score | Notes |
|---|---:|---|
| Technical SEO | **8 / 100** | No robots, sitemap, canonical, or crawlable HTML |
| On-Page SEO | **34 / 100** | Titles/descriptions on 20 pages; no H2s, no breadcrumbs, no category pages |
| Structured Data | **0 / 100** | Zero JSON-LD of any kind |
| Performance | **58 / 100** | Good code splitting; render-blocking fonts, no image optimisation |
| Mobile SEO | **72 / 100** | Genuinely responsive, correct viewport, 44px targets observed |
| Accessibility | **61 / 100** | Good `CardLink` work; heading hierarchy broken, alt text generic |
| Image SEO | **22 / 100** | `loading="lazy"` present; no dimensions, no responsive srcset, no modern formats |
| Content SEO | **40 / 100** | Strong product copy; no category/collection editorial content |
| Internal Linking | **45 / 100** | Real `<a href>` cards; no breadcrumbs, no cross-linking, footer partial |
| Local SEO | **12 / 100** | City data exists in the model but is never marked up |
| AI Search Readiness | **5 / 100** | Non-JS crawlers see an empty document |
| **Overall** | **28 / 100** | |

---

## 1. Framework and architecture

| Aspect | Finding |
|---|---|
| **Framework** | Vite 5.4 + React 18.3, TypeScript 5.5 |
| **Routing** | `react-router-dom` 6.26, `BrowserRouter`, all routes declared in [App.tsx](src/App.tsx) |
| **Rendering** | **100% client-side.** No SSR, no SSG, no prerendering, no hydration |
| **Hosting** | Vercel. [vercel.json](vercel.json) rewrites `/((?!api/).*)` → `/` |
| **Backend** | Supabase (Postgres + RLS + Realtime), 55 migrations |
| **Serverless** | 12 functions in [api/](api/) — **exactly at the Vercel Hobby ceiling** |
| **Styling** | Inline styles via `css()` helper + Tailwind + a `--ag-*` CSS variable token layer |
| **Build** | `manualChunks` splits `react-vendor` and `supabase`; seller/admin consoles lazy-loaded |

### 1.1 The root cause — P0

`vercel.json` serves the identical static `index.html` for every non-API path. That file contains:

```html
<title>MangaiMart</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#FBF6F2" />
<div id="root"></div>
```

That is the complete extent of what a crawler receives for **every** URL — homepage, every product, every boutique, every policy page.

Googlebot does execute JavaScript, so pages *can* eventually be indexed via its render queue, but this costs crawl budget, delays indexing by days-to-weeks, and degrades ranking quality. Every other consumer fails outright:

| Crawler | Executes JS? | What it sees today |
|---|---|---|
| Googlebot | Yes (deferred) | Content, after a render-queue delay |
| Bingbot | Limited | Effectively an empty page |
| WhatsApp / Facebook | **No** | "MangaiMart", no image, no description |
| Twitter / X | **No** | No card |
| ChatGPT (OAI-SearchBot) | **No** | Empty page |
| Perplexity | **No** | Empty page |
| Google AI Overview | Partial | Unreliable |

The codebase already knows this. [src/lib/share.ts:6-9](src/lib/share.ts#L6-L9) documents it explicitly:

> *"WhatsApp and Instagram then show whatever `<meta og:image>` their crawler finds, and this is a client-rendered SPA, so they find nothing: the recipient gets a naked link with no picture and no context."*

The share flow works around this by attaching the image as a `File` to the Web Share API — an excellent mitigation for in-app sharing, but it does nothing for a link pasted into a browser, a Slack message, or a search result.

---

## 2. Routing and URL structure

### 2.1 Current URL map

| Route | Component | Indexable? | Assessment |
|---|---|---|---|
| `/` | `Loading` | Should be | **P0 — 2.5s splash then `navigate('/buyer/home', {replace:true})`.** The homepage is a redirect |
| `/buyer/home` | `Home` | Yes | Real homepage, buried one level deep |
| `/buyer/results` | `Results` | Yes | **One URL for the entire catalogue** |
| `/buyer/filter`, `/buyer/sort` | `Results` + sheet | No | **Duplicate content** — same grid, three URLs |
| `/buyer/collections` | `Collections` | Yes | Tile index; tiles do not link anywhere |
| `/buyer/product/:id` | `ProductDetail` | Yes | **UUID URL** — zero keyword value |
| `/buyer/boutique/:id` | `BoutiqueProfile` | Yes | UUID URL |
| `/b/:slug` | `BoutiqueProfile` | Yes | Clean, good — but **duplicates** `/buyer/boutique/:id` |
| `/buyer/new-arrivals` | `NewArrivals` | Yes | Good URL |
| `/buyer/best-sellers` | `BestSellers` | Yes | Good URL |
| `/buyer/top-boutiques` | `TopBoutiques` | Yes | Good URL |
| `/buyer/boutiques` | `Boutiques` | Yes | Good URL |
| `/buyer/inspire` | `Inspire` | Yes | Good URL |
| `/buyer/policy/:slug` | `Policy` | Yes | Nine legal/about pages buried under `/buyer/policy/` |
| `/buyer/cart`, `checkout`, `payment` | — | **No** | Must be blocked |
| `/buyer/orders`, `profile`, `wishlist`, `chat/:id`, `messages`, `notifications`, `coupons` | — | **No** | Private; must be blocked |
| `/seller/*` (28 routes) | — | **No** | Must be blocked |
| `/admin/*` (19 routes) | — | **No** | Must be blocked |
| `/auth/*` | — | **No** | Must be blocked |
| `*` | `<Navigate to="/" replace />` | — | **P1 — no 404.** Every bad URL soft-redirects to the splash |

### 2.2 Category pages do not exist — P0

This is the largest single content gap. [Collections.tsx:44-46](src/pages/buyer/Collections.tsx#L44-L46):

```ts
const open = (patch) => {
  setFilters({ ...DEFAULT_FILTERS, ...patch });
  navigate('/buyer/results');
};
```

Every category, occasion, colour, fabric and budget tile funnels to the same URL with the filter held in React state. Consequences:

- There is no `/collections/sarees` for Google to rank for "silk sarees online Tamil Nadu".
- Filter state is lost on refresh, cannot be shared, cannot be bookmarked.
- The back button does not restore a filtered view.
- Roughly **40–60 high-intent commercial landing pages** that should exist, do not.

The vocabulary to build them is already in the database — migration 0024 gives an admin-managed `category`/`occasion`/`fabric`/`color` list, and [src/lib/collections.ts](src/lib/collections.ts) already computes counts and cheapest price per term.

### 2.3 Duplicate content — P1

Four distinct duplication sources, none with a canonical to resolve them:

1. `/buyer/results`, `/buyer/filter`, `/buyer/sort` — the same grid at three URLs.
2. `/buyer/boutique/:id` and `/b/:slug` — the same profile at two URLs.
3. `/` and `/buyer/home` — the homepage at two URLs (one being a JS redirect).
4. The `*` wildcard means `/anything-at-all` returns HTTP 200 with the splash — infinite soft-404 surface.

---

## 3. Metadata

### 3.1 What exists

[src/lib/pageMeta.ts](src/lib/pageMeta.ts) is a genuinely good hook — it sets `<title>`, `description`, `og:title`, `og:description`, `og:type`, `og:url`, `og:image` and `twitter:card`, restores the previous title on unmount, and correctly no-ops while data is loading. It is called on 20 screens with hand-written, non-templated copy.

### 3.2 What is missing

| Tag | Status | Priority |
|---|---|---|
| `<link rel="canonical">` | **Absent everywhere** | P0 |
| `<meta name="robots">` | **Absent everywhere** — private pages are indexable | P0 |
| `og:site_name`, `og:locale` | Absent | P1 |
| `og:image:width` / `:height` / `:alt` | Absent — previews render small | P1 |
| `product:price:amount` / `:currency` / `availability` | Absent | P1 |
| `twitter:title` / `:description` / `:image` | Absent (only `twitter:card`) | P1 |
| `<meta name="keywords">` | Absent | P3 |
| `<meta name="author">` | Absent | P3 |
| `<html lang>` | Present (`en`) — should be `en-IN` | P2 |
| `theme-color` | Present, correctly switched for dark mode | ✅ |
| Favicon / apple-touch-icon | Present | ✅ |
| `og:type="product"` on PDP | Wrong — hardcoded `"website"` | P1 |

### 3.3 Pages with no metadata at all

`Collections` has metadata; these do not: `TrackOrder`, `OrderConfirmation`, `Chat`, `FilterSheet`, `SortSheet`, and every `/seller/*` and `/admin/*` route. The seller and admin consoles inherit whatever title the last buyer page set.

---

## 4. Structured data

**Zero JSON-LD exists in the codebase.** `grep -ril "application/ld+json\|schema.org"` returns nothing.

Every schema type below is fully supported by data already in the model and is simply not being emitted:

| Schema | Data available | Source |
|---|---|---|
| `Organization` | ✅ Complete | [src/data/company.ts](src/data/company.ts) — name, logo, address, phone, email, social |
| `WebSite` + `SearchAction` | ✅ | Search exists via `ShopContext.query` |
| `Product` | ✅ Rich | title, description, image[], sku, colour, material, size[] |
| `Offer` | ✅ | price, mrp, INR, stock → availability |
| `AggregateRating` | ✅ | `rating`, `reviews` on every product |
| `Review` | ✅ | Full reviews table (migration 0041/0045, with seller replies) |
| `BreadcrumbList` | ✅ Derivable | Category → boutique → product |
| `LocalBusiness` | ✅ | Boutique name, city, area, phone, Instagram, `mapUrl`, rating |
| `CollectionPage` + `ItemList` | ✅ | All grid pages |
| `FAQPage` | ⚠️ Needs copy | Policy pages are Q&A-shaped |
| `Article` | ⚠️ | Policy/About pages |

**Business impact:** no rich snippets. No star ratings, no price, no stock status in Google results — on a marketplace, this is typically a 20–35% CTR loss against competitors who have them.

---

## 5. Sitemap and robots

| Item | Status |
|---|---|
| `robots.txt` | **Absent.** `public/` contains only images |
| `sitemap.xml` | **Absent** |
| Search Console verification | **Absent** |
| Bing Webmaster verification | **Absent** |

Without `robots.txt`, `/admin/*`, `/seller/*`, `/buyer/checkout`, `/buyer/profile` and `/auth/*` are all crawlable. Without a sitemap, discovery depends entirely on internal links — which, for products, means Googlebot must render `/buyer/results` in JavaScript before it can find a single product URL.

**Constraint noted:** `api/` currently holds exactly 12 serverless functions (`admin-create-user`, `admin-delete-user`, `admin-list-users`, `ads`, `create-order`, `geo`, `health`, `place-order`, `razorpay-webhook`, `razorpayx-webhook`, `run-payouts`, `verify-payment`). Vercel's Hobby plan caps at 12, so a sitemap **cannot** be added as a 13th function. It must be generated at build time or served from Edge Middleware.

---

## 6. On-page audit by page

Legend: ✅ present · ⚠️ weak · ❌ missing

| Page | Title | Desc | Canon | Robots | H1 | H2 | Breadcrumb | Schema |
|---|---|---|---|---|---|---|---|---|
| `/` (splash) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Home | ✅ | ✅ | ❌ | ❌ | ⚠️ sr-only | ✅ 4 | ❌ | ❌ |
| Results | ⚠️ static | ⚠️ static | ❌ | ❌ | ✅ | ❌ | ⚠️ visual only | ❌ |
| Collections | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Category page | — | — | — | — | — | — | — | **page does not exist** |
| Product | ✅ dynamic | ✅ dynamic | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Boutique | ✅ dynamic | ✅ dynamic | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Boutiques | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| New Arrivals | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Best Sellers | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Top Boutiques | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Inspire | ✅ | ✅ | ❌ | ❌ | ⚠️ sr-only | ❌ | ❌ | ❌ |
| Policy ×9 | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Cart / Checkout / Payment | ✅ | ✅ | ❌ | **❌ indexable** | ✅ | ❌ | ❌ | ❌ |
| Orders / Profile / Wishlist | ✅ | ✅ | ❌ | **❌ indexable** | ✅ | ❌ | ❌ | ❌ |
| Seller ×28 | ❌ | ❌ | ❌ | **❌ indexable** | ? | ? | ❌ | ❌ |
| Admin ×19 | ❌ | ❌ | ❌ | **❌ indexable** | ? | ? | ❌ | ❌ |

### 6.1 Heading hierarchy — P1

Only **5 files in the entire buyer app contain an `<h2>`** (4 in `Home`, 1 in `Policy`). Every other section heading — "Shop by collection", "New arrivals", "More from this boutique", "You may also like", "Ratings & reviews" — is a styled `<div>`. Search engines and screen readers get a page with a single heading and no document outline.

Four pages have **no `<h1>` at all**: `Collections`, `NewArrivals`, `BestSellers`, `TopBoutiques`.

`Home` and `Inspire` hide their `<h1>` in `.agx-sr-only` — valid, but a visible keyword-bearing H1 would rank better.

### 6.2 Breadcrumbs — P1

No `BreadcrumbList` schema anywhere. `Results` renders a visual breadcrumb but it is not marked up. Product and boutique pages have no breadcrumb at all.

---

## 7. Image SEO

| Check | Status | Detail |
|---|---|---|
| `loading="lazy"` | ⚠️ Partial | Present in [ImageSlot.tsx:75](src/components/ui/ImageSlot.tsx#L75) and `BoutiqueLogo` only. 40 raw `<img>` tags across `src/` |
| `width` / `height` | ❌ **None** | No `<img>` in the codebase declares intrinsic dimensions → guaranteed CLS |
| `decoding="async"` | ❌ None | |
| `fetchpriority="high"` on LCP | ❌ None | Hero and PDP main image compete with everything else |
| Responsive `srcset` | ❌ None | Full-resolution originals served to 360px phones |
| Modern formats (WebP/AVIF) | ❌ None | Supabase Storage can transform on the fly; unused |
| Alt text | ⚠️ Weak | `ImageSlot` falls back to `placeholder ?? ''`. Product cards pass the title (good), decorative images pass nothing |
| Compression | ❌ | `public/mangaimart-logo.png` is **93 kB** — already identified in [index.html:24](index.html#L24) as costing ~2s on 3G |

The logo problem was noticed and worked around with a text-based boot splash — good instinct, but the underlying assets were never optimised, and `Loading.tsx` still loads the 93 kB PNG.

---

## 8. Performance / Core Web Vitals

Measured statically; the app has `@vercel/speed-insights` installed but **no field data configured**.

| Metric | Estimated | Cause |
|---|---|---|
| **LCP** | ⚠️ 3.2–4.5s (3G) | Render-blocking Google Fonts; full-res unoptimised hero image; content requires JS + a Supabase round-trip |
| **CLS** | ❌ 0.15–0.30 | No image dimensions anywhere; boot splash → React swap |
| **INP** | ✅ ~120ms | Light interaction model |
| **TTFB** | ✅ ~180ms | Vercel edge static |
| **FCP** | ✅ ~0.9s | The inline boot splash is an excellent mitigation |

### 8.1 Render-blocking fonts — P1

[index.html:13-16](index.html#L13-L16) loads **three** Google Fonts stylesheets. `preconnect` is correctly in place, but:

- Playfair Display requests **9 weights** including 3 italics; the app uses ~2.
- Manrope requests 5 weights.
- Material Symbols uses `display=block`, which **blocks icon rendering entirely** until the font arrives — a `<link rel="stylesheet">` in `<head>` is render-blocking, adding ~400–900ms to FCP on 3G.

### 8.2 Bundle

Code splitting is well done — `react-vendor` and `supabase` are separated, seller/admin are lazy, `jspdf`/`html2canvas` split via dynamic import. Main concern is that `CatalogProvider` appears to fetch the **entire product catalogue** on app boot for every visitor, which will not scale past a few hundred products.

### 8.3 Caching

`vercel.json` sets **no `Cache-Control` headers**. Vite's hashed asset filenames make them safely immutable-cacheable; that is currently left on the table.

---

## 9. Mobile SEO

| Check | Status |
|---|---|
| Viewport meta | ✅ Correct, includes `viewport-fit=cover` |
| Responsive | ✅ Genuinely mobile-first, `clamp()` typography throughout |
| Touch targets | ✅ 44px minimum observed and commented in `LaunchNotice` |
| Tap delay | ✅ No 300ms delay |
| Horizontal scroll | ✅ Snap-scrollers correctly contained |
| Dark mode | ✅ Full token layer, `theme-color` switched pre-paint |
| Font legibility | ✅ |

Mobile is the strongest area of the audit. The main mobile risk is LCP on 3G, covered above.

---

## 10. Accessibility

| Check | Status |
|---|---|
| Links are real `<a href>` | ✅ [CardLink.tsx](src/components/buyer/CardLink.tsx) fixed this deliberately and well |
| Heading order | ❌ h1 → div; no h2s |
| Alt text | ⚠️ Present but often generic/empty |
| `aria-label` on icon buttons | ⚠️ Partial |
| `prefers-reduced-motion` | ✅ Honoured in the boot splash |
| Keyboard navigation | ⚠️ Cards fixed; sheets/overlays unverified |
| Focus indicators | ⚠️ Inline styles frequently omit `:focus-visible` |
| Colour contrast | ⚠️ `--ag-muted` on `--ag-surface` is borderline at small sizes |
| Skip-to-content link | ❌ Absent |
| Landmarks (`<main>`, `<nav>`) | ⚠️ Mostly `<div>` |

---

## 11. Local SEO

The data model is unusually well suited to local SEO and **none of it is exploited**. Every boutique carries `city`, `area`, `phone`, `insta`, `mapUrl`, `rating`, `reviews`, `since`, and a `verified` flag. Every product carries `city`.

Missing: `LocalBusiness` schema, city landing pages, `geo.region=IN-TN` meta, Tamil Nadu keyword targeting in copy, `hreflang`, and any `ta-IN` consideration for a Tamil-speaking audience.

---

## 12. Analytics

**Nothing is installed.** No GA4, no GTM, no Search Console verification, no Clarity, no Meta Pixel. `@vercel/speed-insights` is mounted in [App.tsx:269](src/App.tsx#L269) and is the only telemetry in the product.

There is therefore currently no way to measure any SEO work, no conversion tracking, no ecommerce funnel, and no keyword data.

---

## 13. Security / HTTPS

| Check | Status |
|---|---|
| HTTPS | ✅ Vercel default |
| HSTS | ❌ Not configured |
| `X-Content-Type-Options` | ❌ |
| `X-Frame-Options` / `frame-ancestors` | ❌ |
| `Referrer-Policy` | ❌ |
| `Permissions-Policy` | ❌ |
| CSP | ❌ |

Not direct ranking factors, but they are trust signals and part of a "production-ready" posture.

---

## 14. AI search readiness

| Engine | Ready? | Blocker |
|---|---|---|
| Google AI Overview | ❌ | No schema, no crawlable HTML |
| ChatGPT Search | ❌ | `OAI-SearchBot` does not run JS |
| Perplexity | ❌ | Does not run JS |
| Gemini | ❌ | Depends on Google's index |
| Bing Copilot | ❌ | Bingbot JS support is limited |

AI crawlers do not render JavaScript. They fetch HTML, parse semantic structure and JSON-LD, and move on. MangaiMart currently returns a document with no text, no headings, and no schema to all of them. **AI search readiness is effectively 0% and cannot be improved by any amount of client-side work.**

---

## 15. Prioritised findings

### P0 — Critical (blocks indexing)

| # | Finding | Impact |
|---|---|---|
| 1 | No crawler-visible HTML — SPA serves an empty shell to every URL | Nothing indexes reliably; all AI/social crawlers see nothing |
| 2 | No `robots.txt` | Admin, seller, checkout, auth all crawlable |
| 3 | No `sitemap.xml` | Products undiscoverable without JS rendering |
| 4 | No canonical tags | Four active duplicate-content sources |
| 5 | Zero structured data | No rich results, no AI comprehension |
| 6 | Category pages do not exist | ~40–60 commercial landing pages missing |
| 7 | `/` is a 2.5s JS splash redirect | The homepage is not a page |
| 8 | Private routes indexable | Checkout/profile/admin can enter the index |

### P1 — High

| # | Finding |
|---|---|
| 9 | Product URLs are UUIDs |
| 10 | No breadcrumbs or `BreadcrumbList` |
| 11 | No image dimensions → CLS 0.15–0.30 |
| 12 | Broken heading hierarchy; 4 pages with no H1 |
| 13 | Render-blocking fonts, 9 unused weights |
| 14 | No analytics of any kind |
| 15 | `og:type` always `website`; no product OG tags |
| 16 | `*` wildcard redirects instead of 404 |
| 17 | No `LocalBusiness` schema despite complete data |

### P2 — Medium

| # | Finding |
|---|---|
| 18 | No responsive images / WebP |
| 19 | No `Cache-Control` headers |
| 20 | `lang="en"` should be `en-IN` |
| 21 | No security headers |
| 22 | No SEO intro copy on collection pages |
| 23 | Search results pages not `noindex`-ed |
| 24 | 93 kB logo PNG |
| 25 | Filter state absent from URL |

### P3 — Low

| # | Finding |
|---|---|
| 26 | No `keywords` / `author` meta |
| 27 | No `hreflang` / Tamil consideration |
| 28 | No skip-to-content link |
| 29 | No RSS/feed for Inspire |
| 30 | `COMPANY` details still TODO placeholders — blocks accurate `Organization` schema |

---

## 16. What is already good

Worth stating plainly, because it shapes the implementation:

- **`CardLink`** was deliberately built to make cards real anchors — an SEO/a11y fix already done right, and it means the internal link graph exists.
- **`pageMeta.ts`** is correct and well-documented; it needs extending, not replacing.
- **Boutique slugs** already exist and are unique (migration 0003).
- **The boot splash** is a thoughtful, zero-request FCP mitigation.
- **Code splitting** is properly configured.
- **`company.ts`** is a single source of truth, ready to drive `Organization` schema.
- **Mobile and dark mode** are genuinely well executed.
- **The taxonomy system** (migration 0024) is exactly the right foundation for category landing pages.

---

## 17. Recommended approach

Confirmed with the project owner before implementation:

1. **Canonical origin** — read from `VITE_SITE_URL`, single point of configuration.
2. **Clean URLs with 301 redirects** — `/` becomes the real homepage; `/products/:slug`, `/boutique/:slug`, `/collections/:category`, `/occasions/:occasion`; every legacy `/buyer/*` path permanently redirected so no link breaks.
3. **Vercel Edge Middleware** — injects real `<title>`, description, canonical, OG/Twitter and JSON-LD into the HTML shell per request. Does not count against the 12-function limit; requires no change to React code; serves identical content to users and bots.
4. **GA4 + GTM + Search Console**, each gated behind an env var.

Implementation and verification are recorded in `SEO_IMPLEMENTATION_REPORT.md`.
