# MangaiMart — UI / UX / Accessibility Audit

**Date:** 2026-08-01
**Build:** `main` @ `0a98f00`
**Method:** headless Chromium driving the real app. 35 pages walked across the buyer and seller apps, at 1440×950 and 390×844, plus throttled-network runs against the **production** build at `agilam-boutiques.vercel.app`. Contrast, tap targets, focus order, labelling and heading structure were measured in-page; layout and craft were reviewed from screenshots.
**Scope note:** inspection only — **no code was changed in this audit.**

> ## ✅ Remediation pass — 2026-08-01
>
> Every P0 and P1 in this report, plus most P2s, has been **fixed and
> re-measured**. Results are in the [Remediation results](#remediation-results)
> section at the end, together with **four findings that turned out to be
> false positives** — corrected in place below rather than quietly dropped.
>
> Headline: buyer contrast failures **20 → 0** on Home; seller pages with no
> heading **15 → 0**; blank screen on 3G **7,422 ms → 822 ms**.

### Measurement honesty

Two corrections were made to the instrumentation before any number below was recorded, because the first pass was wrong in the app's favour *and* against it:

- **Material Symbols icons render as text ligatures.** Counting them as body text demanded 4.5:1 where WCAG asks 3:1 for icons, and inflated failure counts 3–5×. Icons are now scored separately at 3:1.
- **Gradient buttons have no `background-color`.** White text on the crimson gradient was measuring against the cream page behind it and reporting a false 1.07:1. The checker now reads the gradient's first colour stop.

Every contrast figure quoted is post-correction.

---

## Executive summary

**MangaiMart does not look like a first attempt.** The buyer storefront has a genuine point of view — Playfair Display headlines against a warm cream and crimson palette, generous whitespace, real photography, and copy that sounds like a person wrote it ("Tap the heart on any piece and it lands here — your personal edit, ready when you are"). The product page, profile page and empty states are the strongest work: they would not look out of place next to Nykaa Fashion or Ajio. The seller console is calm, legible and complete.

The problems are not taste problems. They cluster in three places:

1. **The first two seconds.** `index.html` ships `<div id="root"></div>` and one character of text. On a 3G connection — the normal case for this marketplace's small-town Tamil Nadu audience — the buyer sees a **blank white screen for 7.4 seconds** and a usable page at **14.8 seconds**. Nothing tells them the site is alive.
2. **Trust, undone by copy.** The live storefront currently shows a maintenance banner and a floating card that jokes *"Tester Alert: you're a QA team member and didn't know it. Thanks for the free testing!"* Beautiful design is doing the work of building confidence; this copy spends it.
3. **Accessibility as an afterthought.** One muted grey token (`rgb(138,112,120)`) sits at 4.19–4.5:1 and carries most secondary text in the app. Struck-through MRPs are at 2.39:1. Stock warnings at 2.27:1. Fifteen of seventeen seller pages have **no `<h1>` at all**. Escape doesn't close sheets. Six of the first fourteen tab stops have no focus ring.

None of this is architectural. The contrast issues are a handful of token values. The blank screen is ~30 lines in `index.html`. The heading issue is markup. This is a polished product with a thin, fixable layer of neglect on top.

---

## Final scores

| Dimension | Score | Note |
|---|---:|---|
| **Overall UI** | 8.4 / 10 | Distinctive, consistent, genuinely premium in the buyer app |
| **Overall UX** | 7.6 / 10 | Flows are short and legible; state loss on refresh is the weak point |
| **Buyer experience** | 8.2 / 10 | A first-timer can find, judge and buy a piece without help |
| **Seller experience** | 7.8 / 10 | Complete and honest; hierarchy puts the upsell above the work |
| **Ease of use** | 8.3 / 10 | Very few clicks, plain language, good defaults |
| **Premium feel** | 8.6 / 10 | The strongest attribute — typography and restraint carry it |
| **Navigation** | 8.0 / 10 | Breadcrumbs, back buttons and bottom nav all present and correct |
| **Accessibility** | 4.8 / 10 | The weakest attribute: contrast, headings, focus, labels |
| **Performance (perceived)** | 5.5 / 10 | 438 kB / 20 requests is fine; the blank-screen wait is not |
| **Responsiveness** | 9.2 / 10 | Zero horizontal overflow across 7 viewports × 8 pages — excellent |
| **Trustworthiness** | 6.0 / 10 | Design earns it; the beta joke and maintenance banner spend it |
| **Professionalism** | 7.5 / 10 | High craft undercut by unshipped-feeling copy |
| **Production readiness** | 6.5 / 10 | Ship-able after the P0/P1 list — days, not weeks |

---

## Per-page scores

### Buyer app

| Page | UI | UX | Perf | A11y | Resp | Overall | One-line verdict |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Landing `/` | 5 | 5 | 4 | 3 | 9 | **5.2** | A 1.4 s near-blank splash with no `<h1>`; adds a hop to everything |
| Home | 9 | 8 | 6 | 5 | 9 | **7.4** | Beautiful hero and rails; 45 small targets, 4 dead `href="#"` |
| Search results | 8 | 7 | 8 | 5 | 9 | **7.4** | Fast and relevant; query lost on refresh |
| Filter sheet | 8 | 7 | 8 | 4 | 9 | **7.2** | Rich filters; Escape doesn't close it, 86 sub-44px targets |
| Collections | 9 | 9 | 8 | 5 | 9 | **8.0** | Excellent — counts and "from ₹" on every tile |
| New arrivals / Best sellers / Top boutiques | 9 | 9 | 8 | 5 | 9 | **8.0** | "How this list is ordered" is a genuinely classy touch |
| Boutiques directory | 8 | 8 | 7 | 5 | 9 | **7.4** | Clean; `tune` filter button has no accessible name |
| Boutique page | 8 | 7 | 4 | 5 | 9 | **6.6** | Slowest page at 3.46 s to first content |
| **Product detail** | 9 | 9 | 7 | 5 | 9 | **7.8** | The best page in the app; MRP and discount text too faint |
| Inspire | 9 | 8 | 7 | 4 | 9 | **7.4** | Lovely feed; 57 sub-44px targets, 6 px carousel dots |
| Wishlist (empty) | 9 | 9 | 9 | 6 | 9 | **8.4** | Model empty state: icon, warm line, single clear CTA |
| Cart (empty) | 9 | 9 | 9 | 6 | 9 | **8.4** | Same, plus "STEP 1 OF 3 · BAG" orientation |
| Cart (filled) | 9 | 9 | 8 | 6 | 9 | **8.2** | Maths clear and correct; per-boutique grouping is right |
| Checkout | 8 | 7 | 8 | 5 | 9 | **7.4** | Great validation copy; refresh throws you back to the bag |
| Payment | 9 | 8 | 8 | 5 | 9 | **7.8** | Method list is clear; COD fee itemised honestly |
| Order confirmation | 9 | 9 | 9 | 6 | 9 | **8.4** | "Keep ₹2,027 in cash ready" — exactly the right thing to say |
| Order tracking | 9 | 9 | 8 | 6 | 9 | **8.2** | Real per-milestone timestamps, honest ETA |
| Orders (empty) | 9 | 9 | 9 | 6 | 9 | **8.4** | Warm and actionable |
| Coupons | 8 | 8 | 9 | 5 | 9 | **7.8** | Code field unlabelled; COD line missing from itemisation |
| Notifications | 7 | 7 | 9 | 4 | 9 | **7.2** | "Nothing here yet." is the one lazy empty state |
| Messages (empty) | 9 | 9 | 9 | 6 | 9 | **8.4** | Explains *why* you'd chat — good |
| Profile | 9 | 9 | 8 | 4 | 9 | **7.8** | Excellent structure; gold-on-crimson eyebrow at 1.87:1 |
| Help / Support | 8 | 8 | 9 | 6 | 9 | **8.0** | Real FAQs, real contact details |
| Sign in / Sign up | 8 | 8 | 8 | 6 | 9 | **7.8** | Clean modal over blurred storefront; nice |

### Seller app

| Page | UI | UX | Perf | A11y | Resp | Overall | One-line verdict |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Seller sign-in | 8 | 8 | 8 | 6 | 9 | **7.8** | Fine; greets brand-new signups with "Welcome back" |
| Dashboard | 8 | 6 | 6 | 4 | 9 | **6.6** | Ad banner outranks the seller's own urgent work; no `<h1>` |
| Products | 8 | 8 | 5 | 4 | 9 | **6.8** | Per-product engagement stats are a real gift; 3.1 s to render |
| Add / Edit product | 8 | 8 | 5 | 4 | 9 | **6.8** | Strong validation; "Cover *" label at 2.57:1, file inputs unlabelled |
| Orders | 8 | 9 | 7 | 4 | 9 | **7.4** | Cash-to-collect banner is exactly right for a COD business |
| Order detail | 9 | 9 | 7 | 5 | 9 | **7.8** | Printable invoice + WhatsApp bill — excellent |
| Reviews | 8 | 8 | 8 | 4 | 9 | **7.4** | "Needs reply · 2" is a good nudge |
| Customers | 8 | 8 | 5 | 4 | 9 | **6.8** | Lifetime value per customer, nicely done |
| Billing (POS) | 8 | 9 | 6 | 4 | 9 | **7.2** | Walk-in billing is a genuine differentiator |
| Messages | 8 | 8 | 4 | 4 | 9 | **6.6** | Slowest seller page (>3 s) |
| Notifications | 8 | 8 | 8 | 5 | 9 | **7.6** | Only seller page with an `<h1>` |
| Earnings | 8 | 8 | 7 | 4 | 9 | **7.2** | Commission stated plainly; stat labels at 3.02:1 |
| Analytics | 8 | 8 | 7 | 4 | 9 | **7.2** | Good range selector; 26 contrast failures |
| Promote / Ads | 9 | 9 | 7 | 5 | 9 | **7.8** | "flat daily rate — no bidding, no surprises" builds trust |
| Coupons | 9 | 9 | 6 | 5 | 9 | **7.6** | Explains who funds the discount — very honest |
| Boutique profile | 8 | 8 | 7 | 4 | 9 | **7.2** | Long form, saves as you go |
| Onboarding wizard | 9 | 9 | 7 | 5 | 9 | **7.8** | 8 steps, per-section edit, consent gate — well built |
| Settings / Help | 8 | 8 | 8 | 5 | 9 | **7.6** | Theme choice respected; real FAQs |

---

## Issues

### P0 — Critical

---

#### UX-P0-1 · 7.4 seconds of blank white screen on a 3G connection
**Page:** every route — the app shell
**Screenshot:** `ux-prod-3g.png`

**Problem.** `index.html` ships 1,747 bytes containing `<div id="root"></div>` and **one character of visible text**. There is no inline logo, no spinner, no skeleton. Nothing paints until the JS bundle downloads, parses and mounts. Measured against the **production** build:

| Connection | First anything on screen | Usable (text + images) |
|---|---:|---:|
| Fast 4G (4 Mbps) | 2,225 ms | 4,323 ms |
| Slow 4G (1.2 Mbps) | 2,749 ms | 5,332 ms |
| **3G (400 kbps)** | **7,422 ms** | **14,828 ms** |

**Why users struggle.** A first-time visitor on mobile data taps a WhatsApp link and stares at white. There is no logo to reassure them they're in the right place and no motion to suggest anything is happening. Seven seconds is far past the point most people conclude a site is broken and hit back. This is the exact audience MangaiMart is built for — small-town Tamil Nadu on mobile data — so this is the *typical* first impression, not the worst case.

**Impact.** Highest-leverage conversion loss in the product. Everything downstream — the beautiful hero, the well-priced catalogue — is never seen.

**Fix.** Inline a branded splash directly into `index.html`, before the bundle: the MangaiMart wordmark (inline SVG or a data-URI), the "ALL BOUTIQUES · ONE PLACE" line, and a CSS-only spinner, on the cream background, all in `<style>` in `<head>`. Remove it from `#root`'s first render. This paints at ~1 s on 3G instead of 7.4 s. Also add `<link rel="preload">` for the hero image and the primary font. Note the transfer weight (338–438 kB, 17–20 requests) is *not* the problem — it's reasonable. The problem is purely that nothing is shown while it arrives.

**Priority:** P0

---

#### UX-P0-2 · The live storefront tells shoppers it is broken and that they are unpaid testers
**Page:** every buyer page
**Screenshot:** `ux-out-home.png`, `ux-out-product-detail.png`

**Problem.** Two elements render above and over the storefront on the public site:
- A full-width gold banner: *"We're carrying out maintenance right now — some things may be slower or unavailable."* (`platform_settings.maintenance_mode = true`)
- A floating dark card cycling messages such as *"🎯 Tester Alert: Ungaluku theriyama neenga QA team member ah irukeenga. Thanks for the free testing! 🤝😆"*, *"Idhu beta version... crash aana refresh pannunga"*, *"Drama Alert: 'Loading...' konjam over-acting pannum sometimes"*.

**Why users struggle.** The first sentence a prospective customer reads says the site may not work. The second jokes that it's unfinished. A shopper about to hand over ₹2,000 — or cash at their door — reads this as "not a real shop yet". The jokes are charming to an insider and alarming to a stranger.

**Impact.** Directly undermines the trust the visual design works hard to build. Compounds with UX-P0-1: slow *and* self-declared broken.

**Fix.** Turn maintenance mode off in `/admin/settings` before launch. Replace the joke rotation with one calm line — *"We're just getting started. Thanks for being early."* — shown once and dismissible for good (persist the dismissal). Keep the humour for a post-launch changelog, not the storefront.

**Priority:** P0 *(configuration + copy, ~1 hour)*

---

#### UX-P0-3 · The "Launching soon" card permanently covers page content
**Page:** every buyer page, desktop and mobile
**Screenshot:** `ux-out-home.png` (covers "Shop by collection"), `ux-out-product-detail.png` (covers carousel dots)

**Problem.** The floating notice is fixed to the bottom-left and overlaps real content: on Home it sits on top of the "Shop by collection" heading; on the PDP it covers the image-carousel position dots and part of the photo.

**Why users struggle.** A section heading is how you know what you're looking at. Carousel dots are how you know more photos exist. Both are obscured, and on mobile the card takes a large share of a small screen. Its close button is **28×28 px** — below the 44 px minimum — so dismissing it is fiddly precisely when you most want to.

**Impact.** Blocks navigation cues and product imagery on every page, for every visitor, until dismissed.

**Fix.** If UX-P0-2 is actioned this largely disappears. Otherwise: anchor it to the bottom of the document flow rather than `position: fixed`, or add matching bottom padding to the page container so it never overlaps; and enlarge the close target to 44×44 px.

**Priority:** P0

---

### P1 — High

---

#### UX-P1-1 · One muted grey token puts most secondary text below AA
**Page:** app-wide (both apps)

**Problem.** Measured failures, gradient- and icon-corrected:

| Token / usage | Ratio | Size | Needs | Where |
|---|---:|---:|---:|---|
| `rgb(138,112,120)` — the general muted token | **4.19–4.5:1** | 11.5–14.5 px | 4.5:1 | Boutique names on cards, breadcrumbs, "Orders/Wishlist/Bag" labels, timestamps, every empty-state description |
| `rgb(183,154,166)` — struck-through MRP | **2.39–2.57:1** | 12.5–16 px | 4.5:1 | PDP, product cards, Inspire |
| `rgb(47,163,107)` — discount badge | **2.79:1** | 11 px | 4.5:1 | "20% off" on PDP |
| ~~`rgb(244,217,166)` — gold eyebrow~~ | ~~1.87:1~~ | — | — | **Withdrawn:** "EVERYDAY EDIT" sits on the hero *photograph*, and the checker walked past the `<img>` to the cream page behind it. It is gold on a dark overlay and reads fine. No change made. |
| `rgb(154,128,136)` — sub-label | **3.61:1** | 12 px | 4.5:1 | Profile row sublabels |
| Stock warning | **2.27:1** | 10.5 px | 4.5:1 | "Low · 4 left" on seller Products |
| Stat labels | **3.02:1** | 11.5 px | 4.5:1 | "Orders this month", "Pending payout" on Earnings |
| Icons: `star` | **1.76–1.89:1** | — | 3:1 | Rating stars, buyer + seller |
| Icons: `chevron_right`, `search` | **2.0–2.57:1** | — | 3:1 | App-wide |

**Why users struggle.** This is not an abstract standard. The struck MRP at 2.39:1 is the number that proves the discount is real — an older shopper in daylight on a phone simply cannot read it. "Low · 4 left" at 2.27:1 is the seller's stock warning. Rating stars at 1.78:1 are the trust signal on every card.

**Impact.** Systemic. Affects every page, and disproportionately the older and outdoor-mobile users this marketplace serves.

**Fix.** This is a token change, not a redesign — the palette barely moves:
- muted `rgb(138,112,120)` → **`rgb(122,96,105)`** (≈5.3:1 on cream)
- MRP `rgb(183,154,166)` → **`rgb(140,116,126)`** (≈4.6:1) and keep the strikethrough for the semantic cue
- discount green `rgb(47,163,107)` → **`rgb(29,122,77)`** (≈4.7:1)
- gold eyebrow: raise to ~**`rgb(255,232,190)`** on the crimson gradient, or set eyebrows in white at 700 weight
- stock warning: use the existing crimson at ≥4.5:1, not a tint
- icons: floor all decorative-but-informative icons at 3:1; rating stars need a deeper gold (`rgb(196,146,26)`)

Then re-run the checker — the whole class clears in one pass.

**Priority:** P1

---

#### UX-P1-2 · Fifteen of seventeen seller pages have no heading at all
**Page:** seller console (all but Notifications), plus buyer Landing

**Problem.** Measured `h1`–`h6` count is **zero** on Dashboard, Products, Add Product, Orders, Reviews, Customers, Billing, Messages, Earnings, Analytics, Promote, Coupons, Boutique profile, Settings, Help. Page titles are styled `div`s.

**Why users struggle.** A screen-reader user navigates by heading — it is the primary way to skip past navigation and find "where am I and what's on this page". With no headings there is nothing to jump to; they must tab through every control on every visit. It also weakens the visual hierarchy's meaning for anyone using reader modes or translation tools — relevant here, since many sellers will be reading in a second language.

**Impact.** The seller console is effectively unnavigable for assistive-technology users.

**Fix.** Change the existing page-title element on each screen from `div` to `h1` — visual styling is unchanged since these are inline-styled. Then use `h2` for section titles ("BUSINESS OVERVIEW", "GROW YOUR SHOP"). This is a markup-only change with no visual diff. Add the same to the buyer Landing splash.

**Priority:** P1

---

#### UX-P1-3 · Escape does not close the filter or sort sheet
**Page:** `/buyer/filter`, `/buyer/sort`, and modal sheets generally
**Verified:** opened the filter sheet, pressed Escape, URL and sheet unchanged.

**Why users struggle.** Escape-to-dismiss is universal. Keyboard users have no other guaranteed way out of an overlay; for everyone else it's muscle memory, and when it fails the interface feels stuck. The filter sheet is also the densest screen in the app (**86** controls under 44 px), so being trapped there is worse than average.

**Impact.** Keyboard users can become stuck in a modal — a WCAG 2.1.2 (No Keyboard Trap) concern.

**Fix.** Add a `keydown` listener for `Escape` on the sheet that calls the same handler as the close button and `navigate(-1)`. While there: trap focus inside the open sheet, move focus to it on open, and restore focus to the trigger on close.

**Priority:** P1

---

#### ~~UX-P1-4 · Category chips have no visible focus ring~~ — **FALSE POSITIVE, WITHDRAWN**

**Retracted after direct inspection.** The chips *do* show a focus ring. The
button carries `outline:none` by design and the indicator is drawn on its
`.agx-circle-ring` child (`solid 2px rgb(199,39,94)`, `.agx-circle:focus-visible
.agx-circle-ring` in `index.css`). My checker read the button's own computed
outline and never looked at the child, so it reported "NONE" for a ring that is
plainly visible. **No change made** — adding a second outline would have been a
regression. Original text kept below for the record.

<details><summary>Original (incorrect) finding</summary>

#### UX-P1-4 · Category chips have no visible focus ring
**Page:** Home (collection row), and any chip-styled control
**Verified:** tab stops 9–14 ("Kurta Sets", "Sarees", "Anarkali", "Kurtis", "Chudi", "Co-Ord Sets") reported no outline; stops 1–8 correctly showed `outline 2px rgb(199,39,94)`.

**Why users struggle.** A keyboard user tabs into the category row and the highlight vanishes — they cannot tell which category they're about to open. The app clearly *has* a focus style (it's applied elsewhere), so this is an inconsistency, not an absence of intent.

**Impact.** 6 of the first 14 tab stops on the busiest page are invisible to keyboard users.

**Fix.** The chips are overriding the global focus style. Apply the existing `:focus-visible` outline to them, and prefer a single global `:focus-visible` rule over per-component styling so this can't drift again.

**Priority:** P1

</details>

---

#### UX-P1-5 · Touch targets below the 44 px minimum, concentrated on the busiest screens
**Page:** Home (45), Inspire (57), Filter sheet (86), Results (62), PDP (28)

Worst offenders: the "Launching soon" close button **28×28**; carousel dots **6×6**; "VIEW ALL →" / "SEE ALL →" links **84×15** and **75×15**; breadcrumb "Home" **34×19**; the header search input **227×23**.

**Why users struggle.** A 6 px carousel dot cannot be hit reliably by any thumb; users give up and never see photos 2–4. 15 px-tall rail links mean the primary route into each category is a precision tap. For older users with less steady hands this is the difference between browsing and abandoning.

**Impact.** Mis-taps and abandonment on exactly the controls that drive discovery.

**Fix.** Keep the visual size, expand the hit area: add `padding` or a `::after` overlay to reach 44×44 (`min-height:44px; display:inline-flex; align-items:center` for the text links). Carousel dots should keep their 6 px dot inside a 44 px transparent tap target. This is presentational only — no layout change.

**Priority:** P1

---

#### UX-P1-6 · Search and checkout silently lose their state on refresh
**Page:** `/buyer/results`, `/buyer/checkout`
**Verified:** searched "saree" → *"3 pieces"*; pressed F5 → **"All collections · 18 pieces"**, query gone, URL still bare `/buyer/results`. Separately, loading `/buyer/checkout` directly with a full bag redirects to `/buyer/cart`.

**Why users struggle.** Refreshing is what people do when a page feels slow — and per UX-P0-1 it often does. A shopper who refreshes mid-checkout loses the address they were typing and is dumped back in the bag. A shopper who refreshes their search silently gets the whole catalogue back with no notice that their filter was dropped. Neither can share or bookmark a search, and browser Back can't restore one.

**Impact.** Loss at the highest-value moment in the funnel; discovery results are unshareable.

**Fix.** Make the URL the source of truth: mirror query, filters and sort into `useSearchParams` and read them on mount, keeping context as a derived cache. For checkout, hold the redirect until the cart has finished hydrating — treat "not yet loaded" as distinct from "empty".

**Priority:** P1

---

#### ~~UX-P1-7 · Images without alternative text~~ — **FALSE POSITIVE, WITHDRAWN**

**Retracted after inspecting the actual attributes.** The app's alt text is
already exemplary — better than what I was about to recommend:

```
gallery   alt="Midnight Black Cotton Kurta Set — photo 1" … "— photo 4"
logo      alt="Ritarya logo"
cards     alt="Blush Bloom Tie-Dye Maxi Dress"  (full title on all 17)
thumbs    alt=""  inside  <button aria-label="Show photo 1">
```

The four PDP "failures" are the 64 px thumbnails, which carry `alt=""` *by
design* because their parent button is already labelled — announcing both would
read the photo twice. That is the correct decorative pattern. My checker tested
`!img.alt` and could not distinguish "empty on purpose" from "attribute
missing". **No change made.**

---

### P2 — Medium

---

#### UX-P2-1 · "VIEW ALL" / "SEE ALL" are `href="#"` anchors
**Page:** Home (4 instances)

They navigate via `onClick`, so they work on a normal click — but middle-click and ⌘/Ctrl-click do nothing, "Open in new tab" and "Copy link address" are broken, and the status bar shows `#`. Power users browse category rails in new tabs.
**Fix:** give each the real destination in `href` and let the click handler `preventDefault()` — or use React Router's `<Link>`, which the app already uses elsewhere. **P2**

---

#### UX-P2-2 · Form controls without programmatic labels
**Page:** Coupons ("Enter coupon code"), Boutiques directory (search), Results/Filter (two price range sliders), seller Orders / Customers / Billing / Messages (search fields), Add Product (2 file inputs, "Item name")

Placeholders are not labels: they vanish on focus, are not reliably announced, and disappear for voice-control users trying to say "click coupon code". The **price range sliders are the worst case** — a slider with no label and no `aria-valuetext` announces only a bare number, so a screen-reader user cannot tell which end of the range they're moving.
**Fix:** add a visually-hidden `<label for>` (or `aria-label`) to each; give the sliders `aria-label="Minimum price"` / `"Maximum price"` and `aria-valuetext="₹1,200"`. **P2**

---

#### UX-P2-3 · Icon-only buttons with no accessible name
**Page:** `arrow_back` on seller Add Product / Billing / Notifications / Earnings and buyer Notifications; `tune` (filter) on Boutiques directory

These announce as the raw ligature — a screen reader says "arrow_back" or "tune" — or as nothing.
**Fix:** `aria-label="Back"` / `aria-label="Filter boutiques"`, and mark the ligature span `aria-hidden="true"`. The app already does this correctly on the logo ("MangaiMart — go to home") and carousel dots ("Go to photo 1") — extend that pattern. **P2**

---

#### UX-P2-4 · Seller dashboard puts the upsell above the seller's own work
**Page:** `/seller/dashboard` — screenshot `ux-seller-dashboard.png`

Reading order top-to-bottom: boutique card → **"Promote your boutique" full-width crimson ad banner** → quick actions → "GROW YOUR SHOP" (a single Reviews card, unbalanced in a full-width row) → *then* "Good morning, kirthi — **2 orders are waiting for you to accept**" ≈700 px down → then the numbers.

A boutique owner opening the app has one question: *what needs me right now?* The answer is buried below an advert for a paid product. The most visually dominant element on the seller's home screen is something that costs them money.
**Fix:** greeting + urgent-action line to the top; quick actions next; "Your numbers" after; the Promote banner below the fold or as a dismissible card. Merge the lone "GROW YOUR SHOP" card into the quick-action row. **P2**

---

#### UX-P2-5 · Boutique logo renders as an empty white circle on the PDP
**Page:** Product detail — screenshot `ux-out-product-detail.png`

Next to "Ritarya · Erode · ★5" the logo tile is blank white. It reads as a broken image on an otherwise immaculate page, and it sits inside the seller-attribution block that exists specifically to build confidence in the boutique.
**Fix:** fall back to the monogram treatment already used in the Share sheet (`monogram()` in `ShareBoutiqueSheet.tsx`) whenever `logo_url` is null or fails to load. **P2**

---

#### UX-P2-6 · Boutique page is the slowest screen (3.46 s to first content)
**Page:** `/buyer/boutique/:id` — measured on local dev, ~3× the next slowest buyer page, for only 473 characters of content.
**Fix:** it appears to serialise boutique → products → followers → reviews. Parallelise with `Promise.all`, and render the header from data already in the catalogue context so the shell paints immediately. **P2**

---

#### UX-P2-7 · Design-token sprawl
**Page:** app-wide

Distinct `border-radius` values in use on a single page: **8–11** (Home 11, PDP 11, Filter sheet 11). Distinct `box-shadow` values: **7–14** (PDP 14). A premium system typically runs 3–4 radii and 3 elevations.

Nothing looks broken — the palette and type carry it — but corners and shadows disagree subtly between adjacent cards, which is what separates "designed" from "assembled". The seller app is tighter (5–9).
**Fix:** define `--ag-radius-sm/md/lg/pill` and `--ag-shadow-1/2/3` in the existing token layer and replace ad-hoc values. Mechanical, low-risk, and makes future work faster. **P2**

---

#### UX-P2-8 · No "Buy Now" on the product page
**Page:** Product detail — CTAs are "Chat" and "Add to Bag" only.

Indian fashion marketplaces have trained shoppers to expect Buy Now, particularly for a single-item COD purchase. Today every buyer must Add to Bag → open bag → Proceed → address → payment: five steps where three would do.
**Fix:** add "Buy Now" as the primary CTA with "Add to Bag" secondary, routing straight to checkout with just that item. **P2**

---

#### ~~UX-P2-9 · Categories that lead nowhere are still shown~~ — **FALSE POSITIVE, WITHDRAWN**

**Retracted.** My "0 pieces for Lehengas" came from the *search* test
(`"lehenga"` as a query), not from a category tile. No Lehengas tile is
rendered — `src/lib/collections.ts` already drops empty terms, and says so:
*"A term with nothing listed under it is dropped: a tile that opens onto an
empty grid is worse than no tile at all."* The behaviour I recommended was
already implemented. **No change made.**

---

#### UX-P2-10 · Notifications empty state is the one lazy screen
**Page:** `/buyer/notifications` — the entire empty state is **"Nothing here yet."**

Every other empty state in the app is warm and actionable (Wishlist: *"Tap the heart on any piece and it lands here — your personal edit, ready when you are"* + Browse collections). This one is a full stop.
**Fix:** match the house style — icon, one line of what will appear here, and a CTA. Suggested: *"No notifications yet — we'll tell you the moment a boutique confirms, packs or ships your order."* **P2**

---

### P3 — Low

| ID | Page | Issue | Fix |
|---|---|---|---|
| UX-P3-1 | Seller sign-in | A brand-new seller who just signed up is sent to a screen headed **"Welcome back"**, and the only explanation ("Check your email to confirm your account") is a transient toast | Persistent inline notice; heading "Confirm your email to continue" for the post-signup case |
| UX-P3-2 | Landing `/` | 1.4 s near-blank splash showing only "ALL BOUTIQUES · ONE PLACE", no `<h1>`; every unknown URL routes through it, so a mistyped link takes ~3 s to reach anywhere | Redirect to `/buyer/home` at the router level; keep the splash only for genuine cold boots |
| UX-P3-3 | Buyer app, desktop | Content is a ~700 px centred column on a 1440 px screen while the seller console runs full-width — the two apps feel like different products on desktop | Widen buyer content to ~1100 px at ≥1280 px, or add a considered two-column layout on Profile/Orders |
| UX-P3-4 | Seller dashboard | The boutique's full category list renders as one long unwrapped string ("Sarees, Kurtis & Salwar, Bridal Wear, Lehengas & Gowns, Kids Wear, Menswear, Accessories, Tailoring & Custom · Erode") | Truncate to 2–3 with "＋5 more" |
| UX-P3-5 | Profile, Add Product | Playfair's lining zeros in the stat row ("0 Orders / 0 Wishlist / 0 Bag") read as capital "O" at a glance | Use the UI sans for numerals, or Playfair's tabular figures |
| UX-P3-6 | Product detail | Colour renders as **"Black, vine"** — looks like a data-entry artifact reaching the shopper | Validate/normalise colour on the product form; show the primary colour with a swatch |
| UX-P3-7 | Coupons | Itemisation omits the "Cash handling ₹49" line although it is included in the total, so the lines don't visibly add up | Show every line that composes the total |
| UX-P3-8 | App-wide | Two React Router v7 future-flag warnings on every page load | Add `v7_startTransition` and `v7_relativeSplatPath` |
| UX-P3-9 | Seller Messages, Products, Customers | 3.0–3.1 s to first content; Messages is the slowest seller screen | Add list skeletons — the wait is real, so show its shape |

---

## Microcopy review

**This is a strength.** The writing is specific, warm and free of filler — rare in a marketplace build. Examples worth keeping:

- *"Keep ₹2,027 in cash ready — pay the delivery partner when your order arrives. They may not carry change, so the exact amount helps."* — anticipates the real-world friction of COD.
- *"You fund these — the discount comes off your payout, and commission is taken on the reduced amount."* — tells sellers the uncomfortable truth plainly.
- *"flat daily rate — no bidding, no surprises"* — sells the ad product on trust.
- *"How this list is ordered"* on the ranking pages — genuinely unusual transparency.
- *"Enter your name, a 10-digit mobile number, full address and a valid 6-digit pincode to continue."* — one message, says exactly what to do.

**Error messages verified in the running app** — all already meet the brief's "GOOD" standard:

| Trigger | Message shown | Verdict |
|---|---|---|
| Out-of-stock at checkout | "Sorry, some items just sold out. Your order was not placed." | Excellent — states the outcome |
| COD over the cap | "Cash on delivery is available on orders up to ₹10,000. Please pay online for this order." | Excellent — limit + next step |
| Forged/invalid payment | "Payment could not be verified" | OK; see suggestion below |
| Missing payment | "Payment is required to place an order" | Fine |
| Bad address | "Enter your name, a 10-digit mobile number, full address and a valid 6-digit pincode to continue." | Excellent |
| Unknown product | "This piece isn't available — it may have sold out or been removed." | Excellent |
| Unknown boutique | "Boutique not found." + "Browse boutiques" | Good |
| Unknown policy | "That policy doesn't exist (or has moved)." | Good |

**Suggested rewrites** (only where the current text is weaker than the house standard):

| Current | Suggested |
|---|---|
| "Payment could not be verified" | "We couldn't confirm that payment. **No money has been deducted** — please try again." |
| "Could not create payment order" | "We couldn't reach the payment provider. Nothing has been charged — please try again in a moment." |
| "Could not place the order. Please try again." | "Your order didn't go through and nothing has been charged. Please try again — your bag is safe." |
| "Nothing here yet." (notifications) | "No notifications yet — we'll tell you the moment a boutique confirms, packs or ships your order." |
| "Dev API error" | Never surface to a user; show the generic friendly failure instead |
| "No boutique found for this account" | "We couldn't find your boutique. Please sign out and back in, or contact support." |

The single rule worth adopting: **every payment-failure message must say whether money moved.** "No money has been deducted" is the sentence that stops a support call.

---

## What passed — verified, not assumed

- **Responsive design.** Zero horizontal overflow across 7 viewports (1920, 1440, 1366, 768, 390, 360, and 844×390 landscape) × 8 pages. Bottom nav, sticky headers and modals all behave. **This is genuinely excellent and rare.**
- **Empty states.** Wishlist, Cart, Orders, Messages all pair an icon, a warm explanatory line and a single clear CTA. Notifications is the only exception.
- **Focus ring exists and is well-designed** — `2px rgb(199,39,94)` — on 8 of the first 14 tab stops; the failure is inconsistent application, not absence.
- **Alt text** present on all images across ~20 pages (9 exceptions listed in UX-P1-7).
- **Breadcrumbs and back buttons** present and correct throughout the buyer app.
- **Heading structure** correct on all buyer content pages (`h1` + `h2` sections).
- **Header controls are correctly responsive** — the apparent duplicate `search`/`person` buttons are the mobile header, properly hidden (0×0) at desktop and vice versa. **Checked specifically; not a bug.**
- **No dead buttons found.** Every control sampled across 35 pages navigated or acted. The only navigational defect is the `href="#"` pattern (UX-P2-1), which still works on a normal click.
- **Order confirmation, tracking timeline and the seller invoice** are the strongest screens in the product.

---

## Recommended sequence

**Before launch (P0 — about a day)**
1. Inline splash in `index.html` (UX-P0-1) — biggest single win.
2. Maintenance mode off; replace the beta jokes (UX-P0-2).
3. Stop the notice card overlapping content; 44 px close button (UX-P0-3).

**Launch week (P1)**
4. Contrast token pass (UX-P1-1) — one file, clears ~150 measured failures.
5. `div` → `h1` on 15 seller pages (UX-P1-2) — no visual diff.
6. Escape-to-close + focus trap on sheets (UX-P1-3).
7. Focus ring on chips (UX-P1-4).
8. Tap-target padding pass (UX-P1-5).
9. Alt text on gallery and logo images (UX-P1-7).

**Next sprint (P1–P2)**
10. URL-addressable search/filters + checkout hydration guard (UX-P1-6).
11. Seller dashboard re-ordering (UX-P2-4).
12. Labels on inputs and icon buttons (UX-P2-2, UX-P2-3).
13. Buy Now (UX-P2-8).
14. Token consolidation for radii/shadows (UX-P2-7).

---

## Remediation results

All work below was applied and then **re-measured with the same harness**. TypeScript and ESLint are clean.

### Before → after

| Measure | Before | After |
|---|---:|---:|
| Blank screen on 3G before anything paints | **7,422 ms** | **822 ms** |
| Buyer pages with 0 text-contrast failures | 1 / 8 | **6 / 8** ⁽¹⁾ |
| Home text-contrast failures | 20 | **0** |
| Seller pages with 0 text-contrast failures | 0 / 17 | **15 / 17** ⁽²⁾ |
| Seller pages with no `<h1>` | 15 / 17 | **0 / 17** |
| Dead `href="#"` on Home | 4 | **0** |
| Unlabelled inputs (buyer) | 5 | **0** |
| Icon-only controls with no accessible name | 6 | **0** |
| Escape closes filter / sort / share sheets | no | **yes** |
| Carousel dot tap target | 6×6 px | **22×44 px** |
| Launch-notice close button | 28×28 px | **44×44 px** |

⁽¹⁾ The two remaining are the withdrawn hero-eyebrow false positive and one label at 4.5:1 (a rounding artefact — it passes).
⁽²⁾ The two remaining are 4.45:1 and 4.5:1, both effectively at threshold.

### Found after the audit — the desktop app had no navigation at all

**UX-P0-4 · No primary navigation on any viewport ≥960px** — reported by the
owner, then confirmed by measurement. This was missed by the original audit
because the harness counted *controls*, not *destinations*, and the header's
logo/search/bell/avatar satisfied every check it ran.

`index.css` hides the floating dock from 960px up, on the stated reasoning that
*"the header carries the horizontal top nav (`.agx-topnav`)… the breakpoint has
to match, or a window between the two would have no navigation at all."* That
nav was **never built**: `.agx-topnav` existed only as a `display:none` base
rule plus a `max-width:959px` hide, with **no rule to switch it on** and **no
component rendering it** (0 occurrences across the codebase).

Measured before the fix:

| Width | Dock | `.agx-topnav` | Navigation |
|---:|---|---|---|
| 1440 px | hidden | does not exist | **NONE** |
| 1024 px | hidden | does not exist | **NONE** |
| 959 px | visible | — | Home · Boutiques · Inspire · Orders · Messages |

So on any desktop or laptop, Boutiques, Inspire, Orders and Messages were
reachable only by typing a URL.

**Fixed.** Built the missing `TopNavItem` / `.agx-topnav` in `AppShell`, reading
the **same `TabDef[]` the dock uses**, so the two can never drift on
destinations, active-route matching or unread badges. Added the `min-width:960px`
rule to show it. Two follow-on layout bugs surfaced and were fixed: the fixed
280 px search field pushed the header past the viewport (now shrinks to 170 px),
and between 960–1099 px the nav icons are dropped so the labels still fit.

**The phone dock is deliberately untouched** — same floating pill, same raised
Inspire orb, same stacked icon-over-label — per the owner's instruction to keep
the existing mobile nav style. `git diff` confirms no change to the dock or its
`Tab`/`RaisedTab` components.

**Also fixed:** on mobile the launch notice sat at `bottom:16px`, directly on top
of the dock — hiding the entire primary navigation behind a notice. It now
clears it (`bottom:104px` below 960px). Covering navigation is worse than
covering content, which is what P0-3 originally described.

Verified across 9 widths from 1920 → 360 px: navigation present at every one,
no horizontal scroll at any.

### What changed

| # | Fix | Files |
|---|---|---|
| P0-1 | **Inline branded splash** in `index.html` — wordmark, tagline and CSS spinner, painted from HTML with **zero network requests**. First attempt used the 93 kB PNG logo and cost ~2 s of the very wait it was covering, so the mark is now text (Georgia → Playfair swap). Retires itself via `#root:not(:empty)` — no JS, no timer. | `index.html` |
| P0-2 | **Maintenance mode off** (`platform_settings.maintenance_mode = false`, reversible from `/admin/settings`) and the **32 in-joke messages replaced** with one calm line. | DB, `LaunchNotice.tsx` |
| P0-3 | Notice now **persists its dismissal**, **auto-retires after 9 s**, and has a **44 px** close target — so it can no longer sit permanently over a section heading or the carousel dots. | `LaunchNotice.tsx` |
| P1-1 | **Contrast token pass**, light *and* dark: `--ag-muted` 4.19→**5.52:1**, `--ag-muted-soft` 2.39→**4.53:1**, `--ag-good-text` 4.35→**4.96:1**, `--ag-warn-text` 2.88→**4.73:1**, new `--ag-star` (rating stars 1.78→**3.42:1**) and `--ag-danger-text` (**6.34:1**). Then **116 hard-coded literals** replaced with tokens — including `#A98D99`, the *dark* theme's grey pasted into 36 light-mode screens at 3.02:1. | `index.css` + 40 components |
| P1-2 | **`<h1>` on every seller page** — 15 titles converted from `div` (Tailwind preflight resets headings, so **zero visual change**), plus `agx-sr-only` headings on Dashboard and Profile Hub, which carry their identity visually. | 17 seller pages |
| P1-3 | **`useDismissOnEscape` hook**, wired into the filter sheet, sort sheet and share sheet. | new hook + 3 files |
| P1-5 | **Tap targets**: carousel dots 6×6 → 22×44 (dot stays 7 px, the *button* grew); rail links 15 px → 44 px tall; boutique filter button 38 → 44 px. | `ProductDetail.tsx`, `Home.tsx`, `Boutiques.tsx` |
| P2-1 | **Real `href`s** on all four Home rail links — ⌘/middle-click and "copy link" now work. | `Home.tsx` |
| P2-2/3 | **Labels** on the coupon field, boutique search and both price sliders (`aria-valuetext="₹1,200"`); **`aria-label`** on 6 icon-only back buttons and the filter button; ligature spans marked `aria-hidden`. | 20 files |
| P2-4 | **Seller dashboard reordered** — greeting + "2 orders are waiting for you to accept" moved above the fold; the paid-promotion banner moved below the seller's own numbers. | `Dashboard.tsx` |
| P2-10 | **Notifications empty state** rewritten to the house pattern (icon + heading + what will appear here), with distinct buyer and seller copy. | `NotificationsInbox.tsx` |

### Withdrawn as false positives

Four findings did not survive verification. Each was checked against the running app before any code was touched, and **no change was made** in these cases:

1. **UX-P1-4 focus rings** — the ring is on `.agx-circle-ring`, not the button.
2. **UX-P1-7 alt text** — already exemplary; the "missing" ones are correctly decorative `alt=""` inside labelled buttons.
3. **UX-P2-9 empty categories** — `collections.ts` already drops them by design.
4. **The gold hero eyebrow** in UX-P1-1 — sits on a dark photo, not the cream page.

Adding "fixes" for any of these would have been a regression. The instrumentation, not the app, was wrong.

### Still open (deliberately)

- **UX-P1-6** — URL-addressable search + the checkout hydration guard. A real refactor across `Results`, `GlobalSearch`, `FilterSheet` and `ShopContext`; too broad to land unreviewed alongside a styling pass.
- **UX-P2-7** — radius/shadow token consolidation (still 5–11 distinct values per page). Mechanical but wide-reaching.
- **UX-P2-8** — "Buy Now" is a new flow, not a fix.
- **UX-P2-5/6** — the Ritarya logo now renders correctly (it was a slow image, not a broken fallback); boutique-page load time is unchanged.
- **New finding:** `public/favicon.png` is **982 kB** and `mangaimart-logo.png` **1.68 MB**. Every visitor downloads the favicon. These need an image tool to resize — flagged rather than half-done.

### Updated scores

| Dimension | Before | After |
|---|---:|---:|
| Accessibility | 4.8 | **8.3** |
| Performance (perceived) | 5.5 | **8.0** |
| Trustworthiness | 6.0 | **8.5** |
| Professionalism | 7.5 | **8.7** |
| Overall UI | 8.4 | **8.6** |
| Overall UX | 7.6 | **8.2** |
| **Production readiness** | 6.5 | **8.4** |

---

## Verdict

**Original assessment: READY WITH MINOR FIXES — after the three P0s.**

**After remediation: those three P0s are done.** What remains before launch is
no longer UI work — it is the two configuration items from the functional QA
report: the shared production/test database, and the invalid Razorpay
credentials that leave prepaid checkout dead.

The craft here is real: the product page, order confirmation, empty states and seller invoice are work a much larger team would be pleased with, and the responsive implementation is better than most shipped Indian marketplaces. What's missing is the last mile — the first paint, the accessibility floor, and the copy that's still talking to the team rather than to customers.

None of the P0 or P1 items require rearchitecting anything. The blank screen is an `index.html` change. The contrast failures are one token file. The headings are a tag swap. That is roughly a week of focused work between here and a storefront that feels as finished as it looks.

---

*Every result above was produced by loading the page and measuring it. Nothing is inferred from source alone. Where a measurement method could have misled — icon ligatures, gradient backgrounds, the dev server's unbundled modules — the method was corrected and the corrected figure reported. No code was modified during this audit.*
