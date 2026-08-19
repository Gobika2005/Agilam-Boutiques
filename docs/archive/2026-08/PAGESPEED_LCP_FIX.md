# PageSpeed — mobile LCP 8.4 s

**2026-08-09** · branch `fix/seller-console-audit-2026-08`

PageSpeed Insights, `mangaimart.com`, mobile:

| | |
|---|---|
| Performance | **68** |
| Largest Contentful Paint | **8.4 s** 🔴 |
| Speed Index | 4.7 s 🟠 |
| First Contentful Paint | 2.6 s 🟠 |
| Total Blocking Time | 0 ms ✅ |
| Cumulative Layout Shift | 0.064 ✅ |
| SEO | 100 ✅ |

TBT of 0 ms and CLS of 0.064 say the JavaScript and the layout are both fine.
This is one problem: the LCP image starts downloading far too late.

Verified: `npm run build` ✅ · `npm run lint` (0 errors) ✅ ·
`npm run verify:seo` → **ALL CHECKS PASSED** ✅.
The PSI score itself is **not** re-measured — that needs the deploy (§5).

---

## 1. What the LCP element actually is

The home page hero — "Grace in Every Detail". It is not a static asset: it is
the creative of a live `home_hero` **paid ad campaign**, a row in
`ad_campaigns`.

That is the whole problem. The URL is only knowable after this chain:

```
1. HTML arrives                          (fast — the edge renders it)
2. download + parse ~240 kB of gzipped JS  index + react-vendor + supabase
3. React mounts
4. useLiveAds() → fetch ad_campaigns     ← new origin: DNS + TCP + TLS
5. row returns → the image URL is known
6. fetch the image                       ← same third-party origin
7. LCP paints
```

Six serial steps before the largest element on the page *begins* to download,
two of them opening a fresh connection to a third-party host. On PSI's throttled
mobile profile that is 8.4 s, and the image bytes are barely a part of it — the
page spends almost all of that time waiting for permission to start.

**What was already right, and is not the cause:** the client-side image
pipeline. `src/lib/imageUrl.ts` rewrites Storage URLs onto Supabase's image
transformer, and `ImageSlot` renders the hero with a full `srcset`,
`fetchpriority="high"`, `loading="eager"` and `decoding="sync"`. Measured on the
live object:

```
/object/public/…            2,117 kB   png     ← the raw upload
/render/image/…?width=480      33 kB   webp
/render/image/…?width=800      67 kB   webp    ← what a phone actually gets
/render/image/…?width=1280    103 kB   webp
```

A 31× reduction that is already shipping. Delivery was solved. **Discovery was
not.**

---

## 2. The fix — preload the LCP image from the edge

`middleware.js` already reads these exact rows from Supabase to build the page's
metadata, on every request, before a single byte of JavaScript is sent. So it
already knows the URL at step 1.

It now injects, into the `<head>` it was writing anyway:

```html
<link rel="preconnect" href="https://<project>.supabase.co" crossorigin />
<link rel="preconnect" href="https://<project>.supabase.co" />
<link rel="preload" as="image"
      href="…/render/image/public/…?width=800&quality=70&resize=contain"
      imagesrcset="…240w, …480w, …800w, …1280w"
      imagesizes="100vw"
      fetchpriority="high" />
```

Steps 2–5 stop being prerequisites. The image downloads **in parallel with the
JavaScript bundle** instead of behind it.

Applied to the two pages that have a known LCP image:

| Page | Preloaded | `imagesizes` |
|---|---|---|
| `/` | first live `home_hero` ad creative | `100vw` |
| `/products/*` | first gallery slide (`p.image_url`) | `(min-width: 768px) 320px, 50vw` |

### Two preconnects to one host is not a duplicate

Browsers pool sockets by *(origin, credentials mode)*. supabase-js calls
PostgREST with `fetch` in CORS mode; a plain `<img src>` is a no-CORS request.
A connection warmed for one is not reused by the other. Google Fonts is
preconnected the same way two lines below in `index.html`, for the same reason.

### The match has to be exact, so it is asserted

A preload whose chosen candidate differs from what the `<img>` later requests is
**worse than no preload** — it downloads an image nobody uses, and the real one
still starts late. So `imagesrcset` and `imagesizes` have to be
character-for-character what the component renders.

`middleware.js` mirrors `src/lib/imageUrl.ts` (the edge cannot import the app
bundle — the same constraint that already duplicates `NOINDEX_PREFIXES`).
`npm run verify:seo` now fails if they drift, checking that the preload:

- points at `/render/image/public/`, not the raw object
- uses `width=800&quality=70&resize=contain` — what `imageFallback()` produces
- offers exactly the widths in `imageUrl.ts` (`240/480/800/1280`)
- declares the `sizes` string the component actually renders

⚠️ **Change `WIDTHS`, `QUALITY` or `resize` in `imageUrl.ts` and you must change
`middleware.js` too.** The verifier will catch it, but only if it is run.

### Both sides now agree on which slide is first

`Home.tsx` marks `SLIDES[0]` as the priority image, and `fetchLiveAds()` was
selecting with no `ORDER BY` — so with two heroes live, PostgREST's row order
and the app's "first" slide could differ, and the edge would preload a slide the
app renders second. Both now order by `start_at` then `id`
(`src/data/ads.ts`, `middleware.js`).

---

## 3. Two other things taking bandwidth from the LCP

### 3.1 The favicon was 983 kB

`favicon.png` is 1107×1107 and **983 kB**, requested on every cold load, sharing
the connection with the JS bundle and the LCP image. It was also declared as
`sizes="512x512"`, which was simply untrue.

Now `/icon-500.png` — 500×500, **110 kB**, copied from the existing
`square no BG.png` artwork. **873 kB off every cold load.** `favicon.png` is left
in place; old bookmarks and cached manifests still point at it.

### 3.2 Every uploaded photo expired after an hour

`src/lib/uploadImage.ts` did not set `cacheControl`, so Storage served these on a
one-hour TTL — and the image transformer inherits the origin object's header, so
the resized WebP the catalogue actually serves expired hourly too. A returning
buyer re-downloaded every photo on the page.

Now `cacheControl: '31536000'` — a year, immutable. Safe because the path is
`${folder}/${randomId()}.${ext}` with `upsert: false`: a URL is minted once and
its bytes never change, and a replaced photo is a new random path.

⚠️ **This applies to new uploads only.** Existing objects keep the header they
were stored with. Nothing breaks — they just keep revalidating hourly until
re-uploaded.

---

## 4. What I did not change, and why

- **The 2,067 kB source PNG.** The hero's original upload is a 2 MB PNG. The
  transformer means buyers never receive it, so this is not costing LCP — but
  the first request for an uncached variant still has to fetch and resize 2 MB,
  and `uploadImage.ts` accepts up to 10 MB. Worth a line in the seller guidance
  rather than a code change.
- **The PDP's `sizes`.** The product page's LCP image renders `ImageSlot`
  without a `sizes` prop, so it inherits the component default
  `(min-width: 768px) 320px, 50vw` — which is a grid-tile value on a
  full-width image, so the browser picks a smaller candidate than the slot
  deserves. It is *faster* this way and fixing it would make LCP marginally
  worse while making the photo sharper. That is a design call, not a
  performance one, so I left it and matched the preload to it exactly.
- **Accessibility 90 / Best Practices 96 / Agentic browsing 1/3.** Real, but
  separate from the 8.4 s. Say the word and I'll take them next.

---

## 5. What needs you

1. **Deploy.** None of this is live. The middleware change is the entire fix.
2. **Re-run PageSpeed** after the deploy. I could not re-measure — Google's
   anonymous PSI API quota was exhausted, and the score only means anything
   against the deployed edge anyway.
3. **Maintenance mode is still switched on.** The PSI screenshot shows the
   banner — *"We're carrying out maintenance right now — some things may be
   slower or unavailable"* — at the top of the live site, above the hero. Every
   real visitor and every crawler is seeing that. It has been outstanding since
   the August audit; it is a `platform_settings` toggle, so it needs your hand,
   not a deploy.

### Expected effect

LCP should drop substantially — the image moves from the end of a six-step
serial chain to parallel with the bundle, and two connection setups disappear.
I am not going to put a number on it: PSI's throttled profile is variable, and
the honest answer is that it will be measured, not predicted.

---

## 6. Files touched

```
middleware.js              LCP preload + Supabase preconnect, imageUrl.ts mirror,
                           homeHeroImage() reader
src/data/ads.ts            deterministic hero ordering, matching the edge
src/lib/uploadImage.ts     cacheControl: 1 year immutable
index.html                 favicon 983 kB → 110 kB
public/icon-500.png        new (copy of the existing square artwork)
public/manifest.webmanifest  points at the new icon
scripts/verify-seo.mjs     asserts the preload matches imageUrl.ts exactly
```
