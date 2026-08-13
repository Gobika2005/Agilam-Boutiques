# Agilam Boutique (package name: `mangaimart`)

A multi-boutique Indian ethnic-wear marketplace. Three consoles in one React app —
buyer storefront at the root URL, seller console, admin console — on Supabase,
deployed to Vercel.

## Stack

- React 18 + TypeScript + Vite 5, React Router 6. Node 24.x.
- Supabase (Postgres + Auth + Realtime + Storage) as the entire backend.
- Vercel serverless functions in `api/` (plain `.js`, ESM) + `middleware.js` (edge).
- Razorpay for payments, RazorpayX for seller payouts, Upstash for rate limiting.
- Tailwind is installed but the UI is overwhelmingly **inline styles** — match that.

## Layout

| Path | What lives there |
|---|---|
| `src/pages/{buyer,seller,admin,auth}` | The three consoles + login flows |
| `src/lib/` | Pure helpers — pricing, ranking, seo, tokens, schema |
| `src/state/` | Contexts; `ShopContext.tsx` holds cart/wishlist/follows |
| `src/data/` | DB access layer per domain (products, coupons, settings…) |
| `api/` | Serverless endpoints. `_`-prefixed files are helpers, not routes |
| `supabase/migrations/` | Numbered SQL, `0001`…`0070` |
| `supabase/functions/` | Deno Edge Functions — the escape hatch when `api/` is full |
| `middleware.js` | Injects SEO meta + JSON-LD, serves robots.txt & sitemap |

## Rules that bite

1. **Migrations are numbered and applied by hand.** The next one is `0082`. Writing
   a migration file does NOT put it in the database — the user runs it in Supabase.
   Never report a schema change as live; say "migration 00XX must be applied".
   (`0068a`/`0068b` are a split of two files that both shipped as `0068`; apply a
   before b. Both are idempotent.)
2. **Pricing is mirrored and must stay in step.** `src/lib/pricing.ts` (client) and
   `api/_pricing.js` (server) derive the same numbers, and `api/place-order.js`
   asserts the Razorpay payment matches to the paise. Change both together or
   legitimate checkouts start failing.
3. **Commercial terms split two ways.** The commission, returns window and payout
   hold are platform-wide, admin-editable in the `platform_settings` row via
   `api/_settings.js` / `src/data/settings.ts`. Delivery and cash-on-delivery are
   **the seller's** (0076) and priced **by distance** (0077): `delivery_charge`
   is the shop's own town, `delivery_charge_district` / `_state` / `_national`
   the wider bands (NULL = does not deliver there), plus `free_delivery_over`
   (local + district only), `cod_fee`, `cod_max_order`. The buyer's pincode
   picks the band via `resolveZone` (`src/lib/deliveryZone.ts`), mirrored by
   `zoneFor` in `api/_pricing.js`; both read district/state from the lazily
   filled `pincodes` table so they cannot disagree. Dispatch time and the
   change-of-mind return window are the seller's too (0078:
   `dispatch_days_min/max`, `return_window_days`) — the platform still owns the
   30-day cover for a faulty item, and transit time. Don't add a delivery fee or
   a returns promise to the admin console; nothing reads the old platform
   columns, and `platform_settings.return_window_days` is now only the default
   for a NEW shop.
4. **Colours are `--ag-*` CSS variables, never literal hex.** The app has a full
   light/dark theme; a hardcoded colour breaks dark mode. See `src/lib/tokens.ts`.
5. **`boutiques` cannot be read with `select('*')`** — column-level grants since
   the onboarding/verification work. Name the columns.
6. **`SUPABASE_URL` and `VITE_SUPABASE_URL` can point at different projects.**
   That failure is silent: the shop browses fine while every order dies. Check
   `GET /api/health` first when orders break.
7. **RLS is the security boundary.** Buyers browse anonymously; ownership is
   enforced by policy, not by client-side checks.
8. **`supabase/seed.sql` is locked.** Its rows are real rows in the live DB, which
   is why they show up in admin as "mock data". Purging is `purge_seed.sql`, run
   by the user.

## Commands

```bash
npm run dev            # local dev
npm run build          # tsc -b && vite build
npm run lint           # eslint
npm run verify:seo     # builds, then asserts crawler-visible meta
```

## Business model

Commission + ads only. **No subscriptions, no "Featured" tier** — deliberately
removed. Revenue is a percentage commission per order plus flat day-rate ad
placements. COD adds a per-delivery fee with a cart cap; the seller keeps the
cash and owes the commission.

## Working style

- The user applies migrations and holds the env secrets. Flag what needs their hand.
- Reports go in dated markdown at the repo root (`*_QA_REPORT.md`, `*_AUDIT.md`).
- Don't claim something is verified unless you ran it.
