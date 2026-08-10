# Performance Audit — mangaimart.com home page
**2026-08-10** · branch `fix/seller-console-audit-2026-08`

The PageSpeed links could not be read back (the keyless PSI API is over its
daily quota), so these are **Lighthouse 12.8.2 runs I ran locally against the
live site** — same engine PSI uses. Lab data only; no CrUX field data.

## Scores

| | Mobile | Desktop |
|---|---|---|
| **Performance** | **35** | **79** |
| Accessibility | 93 | 94 |
| Best Practices | 100 | 100 |
| SEO | 100 | 100 |

| Metric | Mobile | Desktop |
|---|---|---|
| First Contentful Paint | 6.4 s | 0.5 s |
| **Largest Contentful Paint** | **9.2 s** | **2.4 s** |
| Total Blocking Time | 950 ms | 90 ms |
| Cumulative Layout Shift | 0 | 0.027 |
| Speed Index | 9.4 s | 2.9 s |
| Server response | 30 ms | 30 ms |

**The server is not the problem.** The root document returns in 30 ms. Every
second lost is client-side: JavaScript, fonts and images.

---

## Fixed in this branch

### 1. The home hero was downloaded twice — LCP preload was preloading the wrong width

The headline finding. Desktop network log, live site:

```
1309ms  High   78kB  aca54a49….png?width=1280   ← the preload
2794ms  High  105kB  aca54a49….png?width=1600   ← what the <img> actually fetched
```

78 kB paid for and thrown away, and the real LCP element started 1.5 s late —
the exact failure the module's own header comment warns about ("a preload that
does not resolve to the byte-identical URL the `<img>` later requests is not a
head start, it is a second download").

Cause was a three-way drift:

| Source | Widths |
|---|---|
| `src/lib/imageUrl.ts:46` — the source of truth | 240, 480, 800, 1280, **1600** |
| `middleware.js:260` — the preload | 240, 480, 800, 1280 |
| `scripts/verify-seo.mjs:225` — the guard | 240, 480, 800, 1280 |

`1600` was added to `imageUrl.ts` deliberately, for exactly this case ("a
desktop hero or a tablet at DPR 2 wants more"). The preload never got it. On any
viewport wide enough to want 1600 the `<img>` asked for 1600 while the preload
had fetched 1280.

**The guard could never have caught this**: it hardcoded its own copy of the
same stale list, so it compared the bug against itself and passed.

Fixed:
- `middleware.js` now emits all five widths.
- `verify-seo.mjs` now **reads `WIDTHS` out of `src/lib/imageUrl.ts`** instead of
  restating it, so this class of drift is structurally impossible.

Proven, not assumed — reverting the edge list to the old four now fails:

```
[FAIL] home LCP preload     <<< imagesrcset widths 240/480/800/1280 != imageUrl.ts WIDTHS 240/480/800/1280/1600
[FAIL] product LCP preload  <<< imagesrcset widths 240/480/800/1280 != imageUrl.ts WIDTHS 240/480/800/1280/1600
```

Restored, and `npm run verify:seo` → ALL CHECKS PASSED.

### 2. Accessibility 93 → 100

Verified with a local Lighthouse pass over the built app: both audits now score
1, and no binary accessibility audit fails.

- **`button-name`** — the hero carousel dot buttons had no text, no icon and no
  label, so they reached a screen reader as unnamed "button". Added `type`,
  `aria-label` and `aria-current` (`Home.tsx`).
- **`image-redundant-alt`** — the six category tiles announced their name twice.
  `ImageSlot` defaults `alt` to the visible-fallback `placeholder`, and the
  category name is also rendered as real text directly below the image. Marked
  the image decorative with `alt=""`; the placeholder is untouched because it is
  still the visible fallback when a category has no photo.

---

## Not fixed — needs a decision

### A. The Material Symbols icon font is 447 kB *(biggest single win)*

One request, 447 kB, `VeryHigh` priority, and `font-display-insight` puts it at
**790 ms** on mobile. It is by far the heaviest thing the page loads. It is
requested as the *complete* icon set:

```
fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0&display=block
```

Google Fonts supports `&icon_names=…` to subset this to only the icons you use.
The app uses ~101 distinct icons, which would take this from 447 kB to roughly
10 kB — **a ~437 kB saving on every cold load.**

**Why I did not just do it:** 255 icon usages take their name from a runtime
variable rather than a literal. Any icon missed by a subset renders as its
literal ligature text ("shopping_cart" as words) — highly visible and easy to
miss in review. Doing this safely needs a complete inventory (static literals
*plus* every `icon:` field in code, plus a check that no icon name comes from
the database) and a visual pass over all three consoles.

Say the word and I will do it properly. It is the highest-value change available.

### B. `mangaimart-wordmark.png` — 94 kB for a header logo

790×316 PNG, displayed far smaller. Lighthouse: 86 kB wasted on dimensions,
76 kB wasted on format. It is the second-heaviest asset and it is *your own*
static file, not a seller photo. Needs a resized WebP — the repo has no image
tooling installed, so this is a one-off export rather than a code change.

### C. Supabase images cache for only 1 hour

13 resources, all `ttl=3600s`. Every returning visitor re-downloads the whole
catalogue's photos. These are content-addressed files under a uuid path that
never change, so this should be a year. Set `cacheControl` at upload time in the
storage upload path. Note this only affects **newly uploaded** objects; existing
ones keep their stored header.

### D. Unused JavaScript — 122 kB

94 kB of `index-KHj24N53.js` (124 kB total) and 28 kB of the Supabase client go
unused on the home page. Code splitting already exists; this is the next layer.

### E. Seven CORS preflights before the page can render

At ~3.25 s the app fires seven `OPTIONS` preflights in parallel —
`platform_settings`, `ad_campaigns`, `reviews`, `coupons`, `taxonomy`,
`products`, `boutiques` — then the real queries, then the images those queries
name. This is the chain that pushes mobile LCP out. Worth considering a single
edge-cached bootstrap endpoint for the home page's first paint.

---

## What to expect from the fix

The double-download fix removes a wasted 78 kB request and lets the hero start
at the preload rather than after React mounts. It will help desktop LCP (2.4 s)
most directly.

**Mobile at 35 will not become green from this alone.** Mobile is dominated by
the 447 kB icon font, 122 kB of unused JS and the seven-query bootstrap — items
A, D and E above. Those are the real mobile budget.

## Verification run

- `npm run build` — clean
- `npm run lint` — 0 errors (21 pre-existing `react-refresh` warnings)
- `npm run verify:seo` — ALL CHECKS PASSED
- Local Lighthouse accessibility pass — 100, both target audits fixed

Nothing here is live until the branch is deployed. No migration required.
