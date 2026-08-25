# Brand SERP audit — MangaiMart vs Meesho

**Date:** 2026-08-25
**Trigger:** side-by-side Google results for `mangaimart` and `meesho`
**Scope:** why the two results look different, and which gaps are actually closeable

---

## 1. What the screenshots differ on

| # | Meesho has | We have | Cause | Whose fix |
|---|---|---|---|---|
| 1 | Header reads **Meesho** | reads `mangaimart.com` | Brand fell past the title truncation point | **Code — fixed** |
| 2 | — | "Did you mean: **mangamart**" | No brand entity in Google's spell layer | Volume + entity, not code |
| 3 | 5 sitelinks + "More results from…" | one bare result | Seller pages orphaned from crawlable nav; low click volume | **Code (partly) — fixed** |
| 4 | Knowledge panel | none | No Google Business Profile, thin `sameAs` | **Owner** |
| 5 | 4.1★ (1.9K) in panel | none | That is a **Play Store app rating** | Unavailable — no app |
| 6 | Clean logo thumbnail | a model photo | Google picked a page image over the logo | **Code — improved** |

**One thing already working in our favour:** the AI Overview fired for `mangaimart`, described the platform correctly, and cited mangaimart.com. Meesho's result has no AI Overview. Our structured data is doing its job — the gaps below are about *entity recognition*, not markup coverage.

---

## 2. Root cause of the header difference

`middleware.js` appended `· MangaiMart` to every title unconditionally:

```js
const title = meta ? `${meta.title} · ${SITE_NAME}` : SITE_NAME;
```

On `/` that produced a **68-character** title. Google truncates at roughly 60, so the brand was precisely the part that got cut — on the one query where the brand has to be legible. Meesho's title leads with `Meesho:`.

This was never a missing tag. `Organization` + `WebSite` schema with `name: "MangaiMart"`, `alternateName`, logo, address and `sameAs` were all already being emitted correctly at the edge.

---

## 3. Changes made (no migration required)

| File | Change |
|---|---|
| `middleware.js` | New `titleWithBrand()` — skips the brand suffix when a title already opens with it |
| `middleware.js` | Home title → `MangaiMart: Boutique Ethnic Wear Online in India` (48 chars, brand first) |
| `middleware.js` | Home `<h1>` → `MangaiMart — Boutique Ethnic Wear Online` (was brandless) |
| `middleware.js` | `hubNav` now links `/sell`, `/about`, `/help` — anchor text carries the brand |
| `middleware.js` | `Organization` → `["Organization", "OnlineStore"]`; logo as `ImageObject` 1200×1200; added `image`, `slogan`, `areaServed`, `knowsLanguage` |
| `src/lib/pageMeta.ts` | Mirrors the title rule (SPA half) |
| `src/lib/schema.ts` | Mirrors the Organization node |
| `scripts/verify-seo.mjs` | `orgProblems()` matched `@type === 'Organization'` by strict equality and went blind the moment a type array was used — now matches the way a parser does |

**Why `/sell` matters for sitelinks:** two of Meesho's five sitelinks are supplier pages. Ours were reachable only from the sitemap and the React footer — never from crawlable hub HTML, so they could not be sitelink candidates at all.

**Verification run:** `npm run lint` → 0 errors. `npm run build` → clean. `npm run verify:seo` → identical to the pre-change baseline (22 failures before, 22 after, same set), and `homepage` + `brand entity` both `[ok]`. The 22 are environmental — the local run has no database, so the merchant feed 503s and the DB-driven hub bodies and sitemaps come back empty.

**Incidental correction:** a comment in `middleware.js` stated `mangaimart-logo.png` is 1254×1254. It is 1200×1200. Corrected, since that number would matter if `og:image:width` is ever restored.

---

## 4. What needs the owner — ranked

1. **Create a Google Business Profile.** Free, and the single strongest knowledge-panel lever available to a brand this size. The Coimbatore address is already in our schema; a verified GBP is what turns it into a panel. Nothing in code substitutes for this.
2. **Search Console after deploy.** Request re-indexing of `/`. Then watch the `mangaimart` brand query — impressions rising is what eventually retires "Did you mean: mangamart".
3. **Widen `sameAs`.** Currently Instagram, Facebook, YouTube only. A LinkedIn company page and a Wikidata entry are the two Google leans on hardest for corroboration. Send me the URLs and I will add them to both mirrors.
4. **Keep posting.** Confirmed active, and it matters — Google checks that a `sameAs` profile is real before trusting the link.

---

## 5. Honest expectations

- **Header shows "MangaiMart":** plausible within weeks of re-crawl. This is the change most likely to land.
- **Sitelinks:** months, and never guaranteed — fully algorithmic, driven by click volume as much as structure. We have made our pages eligible; we cannot make Google grant them.
- **Knowledge panel:** a GBP can produce a local-business panel reasonably soon. A brand panel like Meesho's — Wikipedia blurb, founders, image carousel — reflects press coverage and notability we do not have yet.
- **The star rating is out of reach** until an Android app is published. Meesho's 4.1★ (1.9K) comes from its Play Store listing, not from review markup.

Meesho is a Bengaluru company with a Wikipedia article and years of press. The realistic target is not parity — it is a result headed **MangaiMart**, with our own name spelled back correctly.

---

## 6. Unrelated — repo state needs the owner's eye

The working tree was clean at session start. During the session, eight files appeared **staged** by something outside this session, including two migrations both numbered **0101**:

- `supabase/migrations/0101_daily_digest_payout_parity.sql`
- `supabase/migrations/0101_mangaimart_bill_prefix.sql` (newly staged)

Duplicate version numbers are exactly what CLAUDE.md flags as a collision risk. I did not touch any of those files, and I did not commit — my four files are unstaged and separable.
