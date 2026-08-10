# Search Visibility — Fixes Shipped & Plan
**2026-08-10** · branch `fix/seller-console-audit-2026-08`

Raised from a live Google result for "mangaimart": the `.vercel.app` domain still
ranking, no logo on the `mangaimart.com` result, "Tamil Nadu" everywhere, no
product images in search, and boutique pages not reachable by shop name.

Decision taken: **positioning goes pan-India.** "Tamil Nadu" is removed from all
marketing and SEO copy; it stays only where it is a fact (the registered
address, the seller state dropdown, geolocation parsing).

---

## Part 1 — Done in code (verified, awaiting deploy)

`npm run build`, `npm run lint` (0 errors) and `npm run verify:seo`
(ALL CHECKS PASSED) all run against these changes.

### 1.1 Pan-India rewrite
77 occurrences reviewed across 25 files; ~50 rewritten, 7 deliberately kept.

| Was | Now |
|---|---|
| `Boutique Ethnic Wear from Tamil Nadu — Sarees, Kurta Sets & More` | `Boutique Ethnic Wear Online — Sarees, Kurta Sets & More` |
| `Boutiques in Tamil Nadu — Verified Ethnic Wear Shops` | `Boutiques in India — Verified Ethnic Wear Shops` |
| `Shop All — Ethnic Wear from Verified Tamil Nadu Boutiques` | `Shop All — Ethnic Wear from Verified Indian Boutiques` |
| `Best-Selling Boutiques in Tamil Nadu` | `Best-Selling Boutiques in India` |
| `geo.region: IN-TN` / `geo.placename: Tamil Nadu, India` | `IN` / `India` |
| `addressRegion: "Tamil Nadu"` on every boutique | omitted unless the seller set a real state |

Edge (`middleware.js`) and client (buyer pages, `pageMeta.ts`, `schema.ts`) were
changed together — they mirror each other and must not drift.

**Kept on purpose:** the registered address in `src/data/company.ts` and the
matching `Organization` node in `middleware.js` (Coimbatore, Tamil Nadu is where
the company actually is), the state dropdown in seller onboarding, and
geolocation code comments.

**One open item for you:** `src/lib/productBadges.ts` still offers a
`made_in_tn` → "Made in Tamil Nadu" badge. It is a truthful provenance claim a
TN seller can make, and the id is stored on product rows, so renaming it would
orphan existing data. Left alone — tell me if you want it generalised to
"Made in India" (needs a migration to remap the stored ids).

### 1.2 Duplicate meta tags on every crawled page — *fixed*
Found while checking the boutique page. The edge injected its own metadata where
the shell's `<title>` was, but never removed the shell's own tags, so **every
product and boutique page shipped two `<meta name="description">` and two
`<meta name="geo.region">`** — one page-specific, one generic. Google was free
to pick the generic one, which is a direct cause of bland snippets.

Confirmed live before the fix:

```
$ curl -s https://mangaimart.com/boutique/eval-nila-s | grep -c '<meta name="description"'
2
```

`index.html` now wraps that block in `ag:shell-meta` markers, the edge strips it
during injection, and `verify:seo` asserts exactly one of each on the product
page so it cannot silently return. Verified across `/`, `/shop`,
`/boutique/eval-nila-s` and a product page: 1 of each, `author` preserved.

### 1.3 Product structured data
- **Gallery images.** The `Product` node carried exactly one image. It now
  carries the cover plus every gallery shot, deduplicated — verified emitting
  **3 images** for the organza suit, up from 1. `image` is *required* for a
  Google merchant listing and more images is explicitly better.
- **`priceValidUntil`.** Absent, so Google could treat the price as valid only
  on the crawl date and drop it from the result. Now a rolling year.

### 1.4 `og:image` dimensions were false on every page
Every page declared `og:image:width 1200` / `height 630`. No image the site
serves is that shape: product photos are portrait, boutique logos square, and
the brand fallback `mangaimart-logo.png` is **1254×1254**. A wrong declared size
makes a scraper reserve the wrong box and crop or skip the preview. The two tags
are removed rather than corrected, because the correct value differs per page.

---

## Part 2 — Needs your hand

### 2.1 The `.vercel.app` result — your call was 404 + GSC removal

Current state, checked live today:

```
$ curl -sI https://agilam-boutiques.vercel.app/
404   →  DEPLOYMENT_NOT_FOUND
```

The alias has already been removed from the Vercel project. The 301 logic in
`middleware.js` is therefore **unreachable** — the request never gets to our
code. Google keeps showing the old result until it recrawls.

**Important caveat on the option you picked:** a Search Console removal request
can only be filed by someone who has verified *that* property. You would need to
add `agilam-boutiques.vercel.app` as a separate GSC property and verify it — but
verification requires serving a file or a meta tag from that host, and the host
now 404s everything. **In practice this route is not available.**

So the realistic choice is:

- **Do nothing.** The 404 drops the URLs out of the index on its own, typically
  a few weeks. Any accumulated ranking is lost rather than transferred.
- **Re-add the alias in Vercel** (Project → Settings → Domains → add
  `agilam-boutiques.vercel.app`). The existing middleware then 301s it to
  `mangaimart.com`, which both removes the duplicate *and* passes its ranking
  across. This is what I recommend, and it is ~2 minutes of your time.

### 2.2 The missing logo on the search result

**The favicon itself is fine.** Verified live:

```
$ curl -s -o /dev/null -w "%{http_code} %{content_type} %{size_download}" https://mangaimart.com/favicon.ico
200 image/vnd.microsoft.icon 6780
```

`<link rel="icon">` is present in `index.html`, the file is at the root, the MIME
type is right, and it is square. The proof it works is in your own screenshot:
the *old* vercel.app result shows the M logo correctly.

The cause is timing. The favicon was replaced yesterday (commit `74e4f2b`,
2026-08-09) and Google's favicon crawler is a separate, slow crawler from
Googlebot — it commonly takes **days to several weeks** to pick up a change.
The globe is what it shows meanwhile.

What to do:
1. **Do not change the favicon again.** Every change restarts the clock.
2. In Search Console → URL Inspection → enter `https://mangaimart.com/` →
   **Request Indexing**. This nudges the homepage recrawl the favicon follows.
3. Wait. There is no faster lever and no code change that helps.

### 2.3 Product images in search results

Structured data alone rarely produces image thumbnails for a small site. The
mechanism that actually does it is **Google Merchant Center free listings**.

You already serve a valid feed — `verify:seo` confirms *16 items, all required
fields present* at `https://mangaimart.com/merchant-feed.xml`. Nothing consumes
it, because there is no Merchant Center account.

Steps, in order:
1. Create a Merchant Center account at `merchants.google.com`.
2. Verify and claim `mangaimart.com` (it will reuse your existing GSC
   verification, which is already live — `/google6c05c29f545eb176.html` returns
   200).
3. Products → Feeds → add a scheduled fetch of
   `https://mangaimart.com/merchant-feed.xml`, daily.
4. Opt in to **free listings** (Growth → Manage programmes).
5. Fill in the business details Merchant Center requires but the feed cannot
   supply: shipping rates and returns policy. These must match what
   `platform_settings` actually charges or listings get disapproved.

Expect 3–5 days for the first review pass.

**Follow-on code work once the account exists** (say the word and I will do it):
add `shippingDetails` and `hasMerchantReturnPolicy` to the product `Offer`
node. I left these out deliberately — the real values live in `platform_settings`
and are admin-editable, so hardcoding them into structured data would drift the
moment you change a fee. Doing it properly needs a settings read at the edge.

### 2.4 Ranking a boutique by its own name ("eval nila")

I checked the live page. **It is already built correctly:**

- URL: `https://mangaimart.com/boutique/eval-nila-s`
- Title: `Eval Nila's — Boutique in Pethapampatti · MangaiMart` — the shop name
  leads, which is the right shape for a brand query.
- `ClothingStore` JSON-LD with address, hours, price range and the shop's own
  photos.
- `sameAs: ["https://www.instagram.com/evalnila"]` — this is the single
  strongest signal for a brand query, and it is already there.
- Listed in `sitemap-boutiques.xml`.

Nothing is technically missing. What is missing is **indexation and authority**.
Actions, all yours:

1. **Confirm it is indexed.** GSC → URL Inspection → paste the URL. If it says
   "URL is not on Google", hit Request Indexing.
2. **Get a link from the shop's own Instagram bio** to
   `mangaimart.com/boutique/eval-nila-s`. A link from the account Google already
   associates with "evalnila" is worth more than anything else on this list, and
   costs the seller one edit.
3. **Naming consistency.** The shop is "Eval Nila's" in our DB and "Evalnila" in
   its own bio. Pick one spelling and use it in both places.
4. Repeat for the other eight boutiques: `menmai`, `sirpaa`, `lilium`,
   `studio-mahil`, `arha-fashion`, `svaraa`, `ritarya`, `the-kuyil-closet`.

### 2.5 The constraint behind all of the above

Your sitemaps currently contain **16 products across 9 boutiques.**

That is the ceiling on every item in this document. Merchant Center with 16
products yields 16 possible image results. Category pages like "silk sarees
online" cannot outrank established retailers on a catalogue that small, whatever
the markup says. Going pan-India *widens* the set of queries you are competing
for while the inventory to compete with stays the same — the copy change is
correct for the business direction, but on its own it will not add traffic.

The highest-leverage action available to you is not SEO work. It is seller
recruitment and getting existing sellers to list more. Brand queries
("mangaimart", "eval nila") are winnable now; category queries need inventory.

---

## Deploy checklist

1. Merge and deploy this branch. Every Part 1 fix is inert until then.
2. Vercel → Settings → Domains → re-add `agilam-boutiques.vercel.app` (§2.1).
3. GSC → URL Inspection → Request Indexing on `https://mangaimart.com/` (§2.2).
4. Create Merchant Center and point it at the existing feed (§2.3).
5. GSC → check indexation of all 9 boutique URLs (§2.4).

No migration is required for anything in this document.

## Note on tooling

`npm run verify:seo` crashed once mid-session with
`TypeError: Cannot read properties of undefined (reading 'preconnect')` when a
DB read timed out — it throws instead of reporting a FAIL row. It passed on
re-run and on every run since. Cosmetic, but worth hardening if it recurs.
