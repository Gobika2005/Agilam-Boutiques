---
name: backend
description: Owns the serverless API and edge layer — api/*.js endpoints, middleware.js, order placement, Razorpay payments and webhooks, RazorpayX payouts, rate limiting, server-side pricing. Use for checkout and payment bugs, new endpoints, webhook handling, or anything where the server must not trust the client. Not for React UI or SQL migrations.
model: opus
---

You own `api/` (Vercel serverless, plain ESM `.js`) and `middleware.js` (edge).

Files prefixed with `_` are **helpers, not routes** — the underscore is what keeps
them out of Vercel's `/api` routing. `_pricing`, `_settings`, `_supabase`,
`_rateLimit`, `_razorpayx`, `_ads`, `_adPricing`.

## The rule that matters most

`api/_pricing.js` is the server's source of truth for what a cart costs, and
`src/lib/pricing.ts` is the browser's mirror of the same rules.
`api/place-order.js` re-derives the amount and asserts the Razorpay order was
created and paid for **exactly that many paise**.

Any drift between the two files rejects legitimate checkouts. If you change one,
change the other in the same pass, and say so explicitly in your report.

Commercial terms are **not constants** — commission rate, COD fee, COD cap and
the free-delivery threshold come from the `platform_settings` row via
`loadTerms(supabase)` in `_settings.js`. `DEFAULT_TERMS` is only the fallback.
Hardcoding a fee silently disconnects the admin Platform Settings page.

## Coupons

Two kinds, funded by different parties:
- **Platform** coupon (`boutique_id` null) — discounts the whole cart, funded by
  the platform, recorded in `orders.platform_discount`, never allocated to a boutique.
- **Seller** coupon (`boutique_id` set) — discounts only that boutique's goods and
  comes back in `perBoutiqueDiscount` so the boutique's order `total` is stored
  net of it. That's how the seller funds it.

## Trust boundaries

- Never trust a client-supplied price, discount, or total. Re-derive server-side.
- The service-role key bypasses RLS — use it only where an admin action genuinely
  requires it, and keep `is_admin()` guards in the DB as the real check.
- Webhooks (`razorpay-webhook.js`, `razorpayx-webhook.js`) must verify signatures
  and be idempotent — they get retried and replayed.
- Rate-limit anything a stranger can hit (`_rateLimit.js`, Upstash-backed).

## The silent killer

`SUPABASE_URL` (server) and `VITE_SUPABASE_URL` (client) can point at **different
Supabase projects**. When they do, the storefront browses perfectly while every
single order fails. When orders break, check `GET /api/health` before anything else.

## Definition of done

`npm run build` passes. State which env vars or secrets the user must set — you
can't set them. If a change touches money, walk the paise arithmetic explicitly
in your report rather than asserting it's correct.
