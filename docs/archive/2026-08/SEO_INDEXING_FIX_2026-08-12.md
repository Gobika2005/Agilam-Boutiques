# SEO indexing — the 17 dead URLs, 2026-08-12

Follow-up to `SEO_INDEXING_FIX_2026-08-11.md`. That report fixed the hub pages
and told you to move Search Console to the apex. Both were right. This one is a
separate, larger fault found by fetching the live site as Googlebot: **every
boutique page in production was serving an empty shell**, and the boutique
sitemap was going out with zero URLs in it.

---

## What was actually broken

Migration **0073** (`contact_lockdown_and_data_integrity`) did this:

```sql
revoke select (email, phone, whatsapp) on boutiques from anon, authenticated;
```

Correct change — scrapers were lifting the whole seller contact book with one
REST call. But `middleware.js` still named `phone` in **both** of its boutique
column lists, and PostgREST does not drop a forbidden column, it refuses the
**entire query**:

```
GET /rest/v1/boutiques?select=id,name,slug,...,phone,...
→ 401  {"code":"42501","message":"permission denied for table boutiques"}
```

Same query without `phone` → `200`. Verified against the live database today.

So from the moment 0073 was applied, every boutique read at the edge returned
nothing. Measured live on `https://mangaimart.com` before the fix:

| URL | Was serving |
|---|---|
| `/boutique/<slug>` × 10 | `<title>MangaiMart</title>`, no description, no schema, no `<h1>` |
| `/boutiques/<city>` × 6 | same bare shell — and these are in `sitemap-pages.xml` |
| `/boutiques` | static title only, no crawlable body |
| `/top-boutiques` | static title only, no crawlable body |
| `sitemap-boutiques.xml` | `<urlset>` with **0 URLs** |

That is 17 URLs — including every local-intent page ("boutiques in Coimbatore"),
which is the traffic this site is actually positioned to win. A URL submitted in
a sitemap that answers with a contentless page is not merely unindexed: Google
files it as a soft 404 and slows its recrawl of the whole host.

Products were unaffected — the PDP reads the shop through the embed
`boutiques(name,slug,city)`, which names no revoked column.

### Why nothing caught it

Two independent guards should have, and neither did.

1. **The column fallback ladder never fired.** `dbBoutiquesTry` downgrades to a
   leaner column list when a query is rejected, but `isSchemaRejection()`
   recognised only **400** (unknown column, SQLSTATE 42703). A *revoked* column
   answers **401** (SQLSTATE 42501). The ladder saw a plain failure, correctly
   declined to treat it as transient — and had nowhere to go anyway, because the
   lean fallback list also contained `phone`.

2. **`npm run verify:seo` already asserts a crawlable `<h1>` on the boutique
   page, the city landing and the `/boutiques` hub.** All three would have
   failed. It simply was not run after 0073 was applied.

---

## Fixed

**`middleware.js`**

- `phone` removed from `BOUTIQUE_COLUMNS_CORE`, `whatsapp` from
  `BOUTIQUE_COLUMNS`, with a comment saying why they must never return.
- `telephone` dropped from the `ClothingStore` JSON-LD. The number is private
  now, and the platform support line is not the shop's number.
- `isSchemaRejection` → `isColumnRejection`, now matching 400 **and** 401/403.
  Both answers are deterministic, so the ladder downgrades on either and
  `dbTryTwice` stops wasting a retry on them. The next time a grant is revoked,
  the edge degrades a field instead of blanking a page.
- `/inspire` added to `hubNav`. It was in the sitemap and in no crawlable link
  anywhere on the site — a textbook orphan, which Google accepts, discounts and
  rarely recrawls.

**`scripts/verify-seo.mjs`**

- The hub check now covers all six DB-backed hubs — `/boutiques`, `/shop`,
  `/new-arrivals`, `/best-sellers`, `/top-boutiques`, `/inspire` — asserting
  200, indexable, a crawlable `<h1>` and ≥2 internal links each. Only
  `/boutiques` and `/shop` were checked before, which is exactly how
  `/top-boutiques` broke unnoticed.
- New check: a hub must link to `/inspire`, so the orphan cannot come back.
- The prerender block is exposed as `noscriptHtml` so a check can assert *which*
  links a page carries, not just how many.

### Verified, not assumed

`npm run verify:seo` — **ALL CHECKS PASSED**. `npm run lint` — 0 errors.

```
sitemap urls: 66          (was 55 live: the 10 boutique URLs were missing)
  /sitemap-pages.xml       39
  /sitemap-boutiques.xml   10   ← was 0
  /sitemap-products.xml    17

/boutique/menmai        h1 "Menmai"                title "Menmai — Boutique in Dharapuram"
/boutique/studio-mahil  h1 "Studio Mahil"          title "Studio Mahil — Boutique in Erode"
/boutiques/coimbatore   h1 "Boutiques in Coimbatore"
/boutiques/erode        h1 "Boutiques in Erode"
/boutiques              h1 "Boutiques in India"
/top-boutiques          h1 "Top Boutiques in India"
telephone in shop schema: false
```

Also re-checked live and already correct: all 7 hub URLs return 200 with
`index, follow` and a self-canonical; `www` 301s to the apex in one hop; the
Search Console verification file serves 200 on the apex; `robots.txt` lists all
four sitemaps; no product page links to an unreachable shop (all 17 products
resolve to one of the 10 approved boutiques).

**Not deployed.** This ships on the next Vercel deploy of `middleware.js`.

---

## The five you asked about

| URL | Before | Now |
|---|---|---|
| `/inspire` | fine, but orphaned — sitemap-only | linked from every hub |
| `/boutiques` | **no crawlable body** | 14 shop links + copy |
| `/collections` | fine | fine |
| `/shop` | fine | fine |
| `/new-arrivals` | fine | fine |
| `/best-sellers` | fine | fine |
| `/top-boutiques` | **no crawlable body** | 14 shop links + copy |

Two were genuinely broken. The other five were already technically sound — which
means for those five the reason they are not indexed is not the code. It is
still yesterday's Search Console problem, below.

---

## Still yours to do (nothing here is code)

These carried over from yesterday's report and, as far as I can tell from
outside, none has been done yet.

1. **Deploy.** Everything above is in the working tree only.
2. **Search Console: add `mangaimart.com` as a Domain property** (DNS TXT). The
   existing property is `https://www.mangaimart.com/`, and `www` 301s to the
   apex — so that property will report zero indexed pages forever, no matter
   what we ship. All the indexing data lives on the apex.
3. **Submit exactly `sitemap.xml`** on that new property. The entry currently
   submitted is `https://www.mangaimart.com/boutiques`, which is a page, not a
   sitemap — that is why the console said "Sitemap is HTML". Delete it.
4. **After the deploy, use URL Inspection → Request Indexing** on `/boutiques`,
   `/top-boutiques` and two or three `/boutique/<slug>` pages. Those URLs have
   been answering as empty pages for days; a manual recrawl is the fastest way
   to clear the soft-404 assessment rather than waiting for the natural cycle.
5. **Bing Webmaster Tools** — import from Search Console, submit the same
   sitemap. Feeds DuckDuckGo and ChatGPT search.
6. **Merchant Center** — daily fetch of `https://mangaimart.com/merchant-feed.xml`
   (17 items today).

## Note for whoever revokes the next column

`middleware.js` reads Supabase with the **anon** key and has no session, so it
can only ever see what `anon` may see. Any migration that revokes a column from
`anon` has to be paired with a check of `BOUTIQUE_COLUMNS` / `PRODUCT_COLUMNS`
in `middleware.js`, and a run of `npm run verify:seo`. This is the second time
(0021, then 0073) that a grant change silently emptied the storefront's
metadata. The `isColumnRejection` widening above makes the failure degrade
instead of blank, but it is a seatbelt, not a fix.

Stale note: `CLAUDE.md` says the next migration is `0074`; the tree is at
`0076`.

## Honest expectations

Unchanged from yesterday. 17 products and 10 boutiques on a young domain. This
work removes the reasons Google *cannot* index the site; it does not create
demand. The city pages are the ones with real intent behind them, and they are
now the ones that actually render.
