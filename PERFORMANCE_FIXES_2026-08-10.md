# Performance — raising the Vercel Real Experience Score

**2026-08-10** · branch `fix/seller-console-audit-2026-08`

Starting point, Vercel Speed Insights, India, last 7 days, P75 — **field data from
real visitors**, not a lab run:

| | Mobile | Desktop |
|---|---|---|
| **Real Experience Score** | **84** | **72** |
| First Contentful Paint | 1.41 s ✅ | 1.61 s ✅ |
| **Largest Contentful Paint** | **2.74 s** 🟠 | **3.67 s** 🟠 |
| **Interaction to Next Paint** | **432 ms** 🟠 | **536 ms** 🔴 |
| Cumulative Layout Shift | 0.07 ✅ | 0.03 ✅ |
| First Input Delay | 33 ms ✅ | 3 ms ✅ |
| Time to First Byte | 0.30 s ✅ | 0.46 s ✅ |

Two metrics are holding the score down, and they are the two that carry the most
weight: **LCP and INP**. FCP, CLS and TTFB are already green — the server is not
the problem and never was. So the work below is aimed at exactly two things:
**bytes on the critical path** (LCP) and **main-thread work during an
interaction** (INP).

Everything here is measured. Where I give a number, the command that produced it
is in §6.

---

## 1. The icon font was 457 kB — it is now 32 kB

The single heaviest thing the site loaded, on every cold visit, ahead of the
hero image, was the complete Material Symbols set:

```
fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0
→ 457,264 bytes
```

For about 265 glyphs. Google Fonts will subset it to a named list with
`&icon_names=`:

```
…&icon_names=account_balance,account_balance_wallet,…,zoom_out&display=block
→  32,276 bytes
```

**425 kB off every cold load**, on the connection the LCP image is queued behind.
Both numbers come from fetching the two stylesheets and then their woff2.

### Why this had not already been done

The August audit flagged it as the biggest available win and stopped, for a good
reason: an icon left out of the list renders as its own name — the literal word
"shopping_bag" where the bag should be — and the app names icons in roughly four
hundred places across three consoles, 255 of them through a variable rather than
a literal.

So the list is **derived from the source on every build**, never written by hand:

- `scripts/icon-inventory.mjs` sweeps `src/**/*.{ts,tsx}` twice. First for the
  four shapes an icon name is actually written in (the ligature child of a
  Material-Symbols span, an `icon` prop or object field, `<Icon name>`, and any
  string literal inside a `{…}` expression in ligature position). Then, as the
  net underneath that, **every `lower_snake` string literal anywhere in the
  source that is a real Material Symbols name** — which catches icon names held
  in lookup tables and constants that no naming convention would have found.
- `scripts/material-symbols-names.json` is Google's published vocabulary (4,223
  names) and is what makes the second pass safe: a string that is not an icon
  name can never reach the URL. False positives (`home`, `search` and `pending`
  are also ordinary strings) cost a few dozen bytes each; false negatives are a
  visible bug. The trade only runs one way.
- `vite.config.ts` rewrites the two `<link>`s at build time and **throws if it
  finds none**, so a changed URL shape fails the build instead of silently
  shipping the full font again.

### The database question, settled

`taxonomy.icon` is a real column (migrations 0024, 0040), so icon names do reach
the buyer app from the database — which would make any static subset unsafe. It
is safe now because the admin screen that used to set it replaced its "type a
Material Symbols icon name" box with a photo picker
(`src/pages/admin/Catalogue.tsx`), so nothing can add a new value. The migrations'
seeded values are swept too.

### Verified, not assumed

A subset miss is measurable: a Material Symbols glyph is exactly 1em square, so
an unresolved ligature overflows the box `.msymbol` reserves for it. I drove a
real Chrome over the built app and compared `scrollWidth` to `clientWidth` on
every icon span on 22 routes:

```
778 icon spans rendered across 22 routes — 0 unresolved, 0 console errors
```

Routes covered: `/`, `/shop`, `/collections`, `/boutiques`, `/inspire`, `/cart`,
`/wishlist`, `/orders`, `/messages`, `/profile`, `/coupons`, `/notifications`,
`/checkout`, `/help`, `/privacy-policy`, `/new-arrivals`, `/best-sellers`,
`/top-boutiques`, `/auth/signin/buyer`, `/admin/login`, `/seller/register`, 404.

A static pass over the whole tree agrees: **0 real icons used but missing from
the subset.**

### One pre-existing bug this turned up

The audit found one name used as an icon that Google does not publish at all:
`feather`, on the **Lightweight** product badge
(`src/lib/productBadges.ts`). That badge has never drawn a glyph — it has been
rendering the clipped word "feather" on every PDP that carries it. Changed to
`weight`, which exists.

---

## 2. The buyer storefront was not code-split — 552 kB of it

The seller and admin consoles were split per route back in July. The buyer
storefront was not, so **every** buyer screen — checkout, the chat client, the
order tracker, the seven policy pages, the Inspire feed — was a static import
sitting in one entry chunk that a first-time visitor had to download, parse and
execute before the homepage could paint. None of it is reachable from the
homepage without a tap.

```
entry chunk:  552 kB  →  219 kB    (gzip 67 kB)
```

`Home` and `BuyerLayout` stay static deliberately: they are what `/` renders, and
making them lazy would trade bundle size for an extra round trip on the one route
that has to be fastest.

Two things make the split not cost anything on navigation:

- **`AppShell` owns the Suspense boundary**, wrapped around its `<Outlet>` rather
  than at the app root — so arriving at a screen whose chunk is still in flight
  swaps the page content while the header, search field and dock stay put. The
  fallback holds 60vh so the floating dock does not jump, and its spinner fades
  in only after 220 ms, because a warm chunk resolves faster than that and a
  spinner that flashes for one frame reads as jank rather than progress.
- **`RoutePrefetch`** warms the results grid and the product page on
  `requestIdleCallback` — the two screens almost every session reaches next.
  Idle, not on mount, so the LCP image and the catalogue queries are never made
  to compete with code for a screen nobody has asked for.

This is the INP half as much as the LCP half: 333 kB less JavaScript to parse and
execute is main-thread time that is no longer contending with the first taps.

---

## 3. INP — `ScrollReveal` was re-measuring the page on every DOM change

`ScrollReveal` observes `main` with `subtree: true` and was wired **straight to
its scan function**. That observer fires on every React commit, and a single
interaction — opening a sheet, typing in search, expanding an accordion, a rail's
data landing — is many commits. Each one dragged a full measuring pass into the
same task as the interaction, and the reveal's own class changes fed more commits
back in.

The scan itself measured each element three or four times over: once in
`eligible`, twice more while sorting a level by height, then again in `scan`.
Every one of those `getBoundingClientRect()` calls forces the browser to flush
layout synchronously.

So on a screen with a few dozen sections, one tap could mean dozens of forced
layouts inside the very handler the browser is timing for INP. Desktop INP is
536 ms — in the red band — and this is the most likely reason it is worse on
desktop than on mobile, where there are fewer sections on screen at once.

Two changes, both in `src/components/layout/ScrollReveal.tsx`:

1. **Coalesced to one scan per frame** via `requestAnimationFrame`. A hundred
   mutations now cost what one used to, and the cost lands outside the event
   handler.
2. **One `getBoundingClientRect()` per element per scan**, cached in a
   `WeakMap` that is thrown away at the end of the scan so it can never go stale.
   The tallest-child walk no longer sorts by re-measuring.

Behaviour is unchanged — same sections animate, same staggering, same
`prefers-reduced-motion` and `position:fixed` guards.

---

## 4. The brand images

| File | Before | After | Where it loads |
|---|---|---|---|
| `mangaimart-wordmark` | 93.5 kB PNG, 790×316 | **22.6 kB WebP, 480w** | header of every screen, all three consoles |
| admin sidebar mark | *the 1.7 MB master*, drawn at 44×44 | **2.3 kB WebP** (`mangaimart-logo-96.webp`) | admin console |
| loading splash | *the 1.7 MB master*, drawn at 380px | **17.4 kB WebP** (`mangaimart-logo-512.webp`) | `src/pages/Loading.tsx` |
| `mangaimart-logo.png` | **1.68 MB**, 1254² | **432 kB**, 1200² | OG image + `Organization.logo` JSON-LD |

The wordmark is the one that touches the score: it sits above the fold on every
page, sharing a connection with the LCP image, and it was a 93 kB PNG drawn into
a 240×84 box. `width`/`height` are now attributes as well as styles, so the box
is reserved from the HTML rather than from the stylesheet.

The 1.68 MB master was being loaded to draw a **44-pixel** sidebar icon. It stays
at its path for OG and JSON-LD, which name it in three places
(`middleware.js`, `src/lib/seo.ts`, `src/lib/schema.ts`) — re-encoded rather than
moved. As a side effect the social preview now fits under the ~600 kB ceiling
several chat apps impose, which it did not before.

---

## 5. What this adds up to

Measured on the home page, live production against this build:

| | Live today | This branch |
|---|---|---|
| Icon font | 457 kB | **32 kB** |
| Entry chunk (raw) | 552 kB | **219 kB** |
| JS over the wire | 248 kB | **198 kB** |
| Images | 101 kB | **30 kB** |

≈ **550 kB less on a cold home load**, most of it removed from in front of the
LCP image.

### What I am not going to claim

I am not putting a number on the resulting RES. It is a **field** metric — a P75
over real visitors on real connections — so it moves over days after a deploy,
not on a lab run, and predicting it would be guessing. What I can say with
confidence is the direction and the mechanism: LCP improves because the bytes
ahead of the hero image are gone; INP improves because the forced-layout storm
during interactions is gone and there is a third less JavaScript competing for
the main thread.

**None of this is live until the branch is deployed.** No migration is required.

---

## 6. Verification run

| Check | Result |
|---|---|
| `npm run build` | clean — `✓ icon subset — 266 icons, 2 link(s) rewritten` |
| `npm run lint` | **0 errors** (21 pre-existing `react-refresh` warnings) |
| `npm run verify:seo` | **ALL CHECKS PASSED** |
| Icon sweep, 22 routes in real Chrome | 778 icon spans, **0 unresolved**, 0 console errors |
| Static icon coverage audit | **0** real icons used but missing from the subset |
| Font sizes | fetched both stylesheets + woff2: 457,264 → 32,276 bytes |

---

## 7. Still on the table

Ordered by what is left on the critical path.

### A. Seven CORS preflights before the page can render *(the remaining LCP item)*

The app fires seven parallel `OPTIONS` preflights — `platform_settings`,
`ad_campaigns`, `reviews`, `coupons`, `taxonomy`, `products`, `boutiques` — then
the real queries, then the images those queries name. The edge preload already
rescues the hero from the back of that chain; nothing else on the page is
rescued. A single edge-cached bootstrap endpoint for the home page's first paint
is the fix, and it is a design change rather than a tweak.

### B. Text fonts — 3 families, 14 weights

Playfair Display is requested at six weights plus italic 700, Manrope at five,
IBM Plex Mono at three. That is a lot of files for a page that paints with two of
them. Trimming is a design call, not a performance one, so I have not touched it.

### C. Supabase images still cache for one hour

Flagged in the August audit and still true of every object uploaded before the
`cacheControl` fix. Existing objects keep the header they were stored with, so
returning buyers re-download the catalogue's photos hourly until those are
re-uploaded.

### D. Maintenance mode is still on

The banner — *"We're carrying out maintenance right now — some things may be
slower or unavailable"* — is on the live site, above the hero, and appears in the
screenshot I took during this work. It has been outstanding since the August
audit. It is a `platform_settings` toggle, so it needs your hand, not a deploy.

---

## 8. Files touched

```
vite.config.ts                          icon-subset build plugin
scripts/icon-inventory.mjs              new — derives the icon list from source
scripts/material-symbols-names.json     new — Google's icon vocabulary (4,223 names)

src/App.tsx                             buyer + auth routes code-split, RoutePrefetch
src/components/layout/AppShell.tsx      route Suspense boundary, wordmark → WebP
src/components/layout/ScrollReveal.tsx  rAF-coalesced scan, cached rects
src/index.css                           .agx-route-spinner
src/components/layout/AdminLayout.tsx   sidebar mark → 96px WebP
src/pages/Loading.tsx                   splash → 512px WebP
src/lib/productBadges.ts                'feather' → 'weight' (was never an icon)

public/mangaimart-wordmark.webp         new — 22.6 kB
public/mangaimart-logo-96.webp          new — 2.3 kB
public/mangaimart-logo-512.webp         new — 17.4 kB
public/mangaimart-logo.png              re-encoded 1.68 MB → 432 kB, same path
```

`public/mangaimart-wordmark.png` is left on disk — old caches still point at it.
