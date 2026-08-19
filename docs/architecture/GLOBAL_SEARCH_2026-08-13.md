# Global search — buyer, seller, admin

**2026-08-13** · branch `fix/seller-console-audit-2026-08`

One search engine, three consoles. Replaces three unrelated implementations, one of
which had never worked.

---

## What was there before

| Console | State |
|---|---|
| Buyer | Worked. Filtered whatever `CatalogContext` had already loaded in memory. |
| Seller | A separate page at `/seller/search`; the header icon just navigated to it. Pulled the whole catalogue, order book and inbox into the browser and filtered the arrays. Covered 4 things. |
| **Admin** | **`<input placeholder="Search…">` wired to nothing.** No state, no handler, no results. It had never searched anything — this is what you tested. |

## What it is now

A shared engine in `src/lib/search/`, one `<GlobalSearchBox>`, and a per-console
list of sources. All server-side against Supabase, so results are complete and
live rather than limited to what the page happened to have fetched.

- **Dropdown** as you type (grouped, keyboard-navigable, debounced 180 ms),
  **full results page** on Enter or "See all".
- Terms live in the URL: `/search?q=`, `/seller/search?q=`, `/admin/search?q=` —
  a result set is a link you can paste into a ticket.
- Picking a row lands on the console page that can **act** on it, already
  filtered to it (`?q=` → `useSeededSearch`).
- Desktop gets a header field; phones get an icon and a full-screen sheet. The
  admin console previously had **no** search at all below 900 px.
- Recent searches per console, stored device-locally and cleared on sign-out.

### Coverage

| Console | Sources |
|---|---|
| Buyer | collections (taxonomy), products, boutiques |
| Seller | pages, products, orders, customers, chats, coupons, reviews, ad campaigns |
| Admin | pages, orders, products, users, boutiques, coupons, refunds, payouts, expenses, reviews, ads, catalogue terms |

Admin orders match on **`payment_id`** too — when Razorpay flags a payment the
only identifier support has is `pay_XXXX`, and there was previously no way back
from that to an order.

"Broadcasts" is not searchable as data: `broadcast_notification` is an RPC that
fans rows into `notifications`, there is no broadcast table. The Broadcast
*page* is reachable through the navigation source instead.

---

## Migration `0080_search_indexes.sql` — must be applied

`pg_trgm` + GIN trigram indexes on every column the search matches, plus
`boutique_id` indexes on `coupons`/`reviews`/`ad_campaigns`.

**Search works without it.** What it changes is cost: a leading-wildcard
`ilike '%term%'` cannot use a btree index, so today it is a sequential scan on
`orders` and `profiles` fired on every keystroke. At current volumes that is a
few milliseconds. Apply it before the order book grows.

Renumbered from 0079 → 0080; `0079_chat_photos.sql` landed while this was being
built. `CLAUDE.md` now says the next one is `0081`.

---

## The two things most likely to have broken

**1. PostgREST `or=(…)` injection.** `or=(a.ilike.x,b.ilike.y)` is a
comma-and-parenthesis grammar parsed *before* any value is looked at. A shopper
typing `Kanchipuram, red` or an admin pasting `Anitha (Salem)` would silently
corrupt the filter list — no error, just wrong rows. `likeValue()` wraps values
in double quotes and strips the two characters that can escape that quoting.

Verified by building the real queries through `@supabase/postgrest-js` and
reading the generated URLs. With the term `Anitha (Salem), R.K. "gold" \ 50%`:

```
/orders?select=id,order_number&or=(order_number.ilike."%Anitha (Salem), R.K. gold  50%%",…)
```

Three intact filters, one value. `%` and `_` are deliberately left as wildcards —
they only ever widen a match, never reach a row RLS would have refused.

**2. Seller scope.** Sources carry the *owner* id (already in `AuthContext`) and
resolve the boutique lazily, caching the **promise** so eight parallel sources
share one lookup. The obvious alternative — passing the boutique in from
`useMyBoutique` — meant a seller who typed before it resolved got "nothing
matched", which is a wrong answer rather than a slow one. It also added a
duplicate boutique fetch to every seller screen. The cache is cleared in
`signOut()`.

---

## Verified / not verified

**Ran:** `tsc -b` clean · `npm run lint` 0 errors (28 pre-existing warnings, none
in the new files) · `npm run build` clean · `npm run verify:seo` ALL CHECKS
PASSED · query-shape check against the real PostgREST builder (above).

**Not run:** no query has been executed against the live database — I have no
credentials. Two shapes are worth a first-run check specifically:

- `payouts` → `boutiques!inner(name)` filtered as `boutique.name`
- `conversations` → `profiles!conversations_buyer_id_fkey!inner(full_name)`
  filtered as `buyer.full_name`

Both generate correct PostgREST URLs. If either is rejected by the server, it
degrades to that one group returning nothing and the dropdown says so out loud —
it cannot take the search down. Every source is caught individually for exactly
this reason (an unapplied migration, a revoked column grant).

**Known limit, unchanged by this work:** the buyer's `/search` *results grid*
still filters `CatalogContext`, which is capped by PostgREST's row ceiling. The
buyer's *suggestions* are now server-backed and complete; the grid behind them is
not. Rebuilding `Results.tsx` onto server-side pagination would mean redoing its
filters and sort, so it was left alone. At 16 products this is invisible.

---

## Files

**New** — `src/lib/search/{types,query,engine,recent,buyerSources,sellerSources,adminSources}.ts`,
`src/components/search/{GlobalSearchBox,SearchRow,SearchResultsView,SeededTermChip}.tsx`,
`src/hooks/{useGlobalSearch,useSeededSearch}.ts`, `src/pages/admin/AdminSearch.tsx`,
`supabase/migrations/0080_search_indexes.sql`

**Changed** — `AdminLayout`, `SellerLayout`, `buyer/GlobalSearch`, `seller/Search`,
`AuthContext` (cache reset), `index.css`, `App.tsx` (route), and the eleven
destination pages that now seed from `?q=`: admin Orders, Products, Users,
Boutiques, Coupons, Expenses, Reviews, Catalogue, Refunds, Payments, Ads;
seller Customers, Coupons, Reviews.

On Payments the search narrows **only the settlement table** — the tiles, the
totals and "select all" keep counting every outstanding boutique, or filtering
the view would silently change what a bulk payout pays.
