# Cash on Delivery — removal from MangaiMart

**Date:** 2026-08-14
**Branch:** `fix/seller-console-audit-2026-08`
**Migration:** `0085_remove_cash_on_delivery.sql` — **must be applied by hand**
**Verified:** `npm run build` ✅ · `npm run lint` ✅ (0 errors) · `npm run verify:seo` ✅ ALL CHECKS PASSED

---

## What changed, in one line

Cash on delivery is gone as a *choice* everywhere — buyer, seller, admin, server
and database — while every cash order already in the database keeps its fee, its
invoice and its payout arithmetic intact.

That split was the brief: **code out, data kept**, with **no COD orders in
flight**. Everything below follows from it.

---

## 1. The gate: no new cash order can exist

Three independent refusals, in order of how far a request has to get:

| Layer | Refusal |
|---|---|
| Buyer UI | The "Cash on Delivery" tile is gone from [`PAY_METHODS`](src/data/demo.ts). There is nothing to select. |
| Server | [`api/place-order.js`](api/place-order.js) answers `paymentMethod: 'COD'` with **400 `COD_WITHDRAWN`** before it touches the database. Every other path now requires a verified Razorpay signature — the `isCod` branch that wrote an unpaid order is deleted, not disabled. |
| Database | Migration `0085` adds `trg_orders_no_cod`, a `BEFORE INSERT` trigger that raises `COD_WITHDRAWN` on any row with `payment_method = 'COD'`. |

The third exists because the first two are code. A stale cached bundle, a
replayed request, a service-role script or a hand-rolled PostgREST call all hit
the trigger.

## 2. The pricing mirror moved together

`src/lib/pricing.ts` and `api/_pricing.js` must derive the same paise or
legitimate checkouts get rejected as underpaid. Both lost the same things in the
same commit:

- `ShopTerms.codFee` / `codMaxOrder` — removed from the type and the default
- `baseCodFee()` / `codFeeFor()` — deleted
- `codBlockedReason()` — deleted (nothing to block)
- `computeTotals(…, payingCash, …)` and `computeCartPricing(…, payingCash, …)` —
  the `payingCash` parameter is gone from both signatures; all three call sites
  (`ShopContext`, `create-order.js`, `place-order.js`) updated
- `perBoutiqueCodFee` — gone from the returned shape; `place-order.js` no longer
  writes `cod_fee` on insert, so the column takes its `0` default

`loadShopTerms` no longer selects `cod_fee, cod_max_order`; `loadCodSwitch()` is
deleted from `api/_settings.js`.

## 3. Seller console

- **Onboarding step 6** and **Settings → Payments accepted**: the COD toggle,
  cash-handling fee and cash-order-limit fields are replaced by a fixed
  "Online payment only" card. There is no toggle left to get wrong.
- Neither screen writes `cod_enabled` any more. Migration `0085` pins it false
  with `trg_boutiques_no_cod` — a **trigger, not a column revoke**, because
  revoking a column from `authenticated` is exactly what made coupons 403-dead
  for sellers *and* admins in `0058`.
- **Orders**: the "To collect" tab and the "₹X still to collect in cash" banner
  are removed.
- **Order detail**: the gold "COLLECT ON DELIVERY / I collected ₹X" block and
  `markCashCollected()` are removed.
- **Dashboard**: the "Cash to collect" tile is removed.

## 4. Admin console

- **Deliveries → Shiprocket**: the platform-wide COD master switch is gone;
  `fetchPlatformSwitches` no longer reads `platform_settings.cod_enabled`.
- **Payments**: the "COD OWED" column, the "Owed to platform (COD)" tile and the
  five COD lines in the settle drawer are removed. `PayoutSummary` lost
  `codGoods / codCommission / codFees / codPlatformDiscount / codOwed`; `net` is
  now simply `prepaidPayout`.
- **Approvals / Orders / Overview**: COD is relabelled as historical, not
  removed — an old order still reads as what it actually was.
- **Settings**: the explanatory card now says COD was withdrawn rather than
  pointing at the Deliveries switch.

## 5. Buyer app

- **Payment screen**: method list, the COD fee preview, the "Cash handling" total
  line, the multi-delivery cash warning and the "Pay on delivery" button state
  are all gone. `placeCodOrder()` is removed from `ShopContext` along with
  `payingCash`, `codFee`, `codUnavailableReason` and `codDeliveries`.
- **Order confirmation**: the "Keep ₹X in cash ready" panel is gone.
- **Track order**: the "Keep ₹X ready" panel is gone.
- **My orders**: the "Pay ₹X in cash on delivery" line and the self-service
  "Cancel order" button (which only ever applied to an un-dispatched cash order)
  are removed, along with `cancelCodOrder()` and `isCancellable()`.
- **Inspire filters**: the "Cash on delivery" shop filter is removed
  (`FeedFilters.codOnly` deleted).

## 6. Copy, legal and SEO

| File | Change |
|---|---|
| [`src/data/policies.ts`](src/data/policies.ts) | The Terms' **"Cash on delivery"** section is replaced by **"How you pay"**: paid in full online, no COD, cancelling means a refund. |
| [`src/data/company.ts`](src/data/company.ts) | `POLICY_TERMS` note updated — no COD fee or cap to fall back to. |
| [`src/lib/schema.ts`](src/lib/schema.ts) | JSON-LD `paymentAccepted` drops "Cash on Delivery". |
| [`CategoryLanding.tsx`](src/pages/buyer/CategoryLanding.tsx) | The city/category blurb and the delivery FAQ answer no longer promise COD. |
| [`ProductDetail.tsx`](src/pages/buyer/ProductDetail.tsx) | Product meta description no longer says "cash on delivery available". |
| [`scripts/daily-report.mjs`](scripts/daily-report.mjs) | "COD receivable" line relabelled legacy; it should now never appear. |

**This matters:** those were published contractual promises. Until now the Terms
page offered cash on delivery while checkout was about to stop doing so — the
exact class of mismatch the 2026-08-11 functional test flagged (₹89 charged
against a published ₹79).

## 7. Seller notification

Migration `0085` inserts one `Updates` notification per boutique owner:

> **Cash on delivery has been withdrawn** — From today every MangaiMart order is
> paid in full online … The cash-on-delivery switch, handling fee and cash limit
> have been removed from your Settings. Your delivery charges, dispatch time and
> return window are unchanged.

Guarded on the title, so re-running the migration does not send it twice.
`type` must be `'Updates'` — `notifications_type_check` (0044) allows only
Orders / Messages / Updates / Wishlist.

---

## What was deliberately NOT removed — and why

This is the part worth reading before anyone "tidies up" later.

### Nothing was dropped from the schema

`boutiques.cod_enabled / cod_fee / cod_max_order`, `platform_settings.cod_enabled`,
`orders.cod_fee`, `payouts.cod_adjustment` and `cancel_cod_order()` all stay.

Orders placed before today carry a real `cod_fee`, and that fee is **part of what
the buyer actually paid**. Drop the column and every one of those orders' invoices,
payout statements and monthly reports stops adding up. You would be destroying the
record of money that genuinely moved.

### Four places still do COD arithmetic, on purpose

| Where | Why it stays |
|---|---|
| `settle_boutique_payout` (SQL) | The authority when money is recorded. A legacy cash order must net against the payout, not be paid out at full value — that would pay for those goods twice. |
| `toStatementOrder()` in [`payouts.ts`](src/data/payouts.ts) | This renders a payout statement from *before* the withdrawal. Drop the branch and those orders show as `goods − 10%` when they actually netted the other way, and the statement stops adding up to the payout it belongs to. |
| Seller **Earnings** COD card | Self-hides at zero. On a shop that traded before today, removing it would silently restate their lifetime earnings. |
| `orders.cod_fee > 0` rows in invoices / bills / track-order totals | Conditional. Renders never for a new order, correctly for an old one. |

### Two legacy guards kept as safety nets

- `api/run-payouts.js` keeps `.neq('payment_method', 'COD')`. You confirmed no
  outstanding cash orders; if that turns out to be wrong, this is what stops an
  automatic full-value transfer on money the seller already holds.
- `ShipSheet` still refuses courier booking on a legacy cash order — Shiprocket
  remits collected cash to the wallet holder (us).

---

## One thing I removed that you should know about

The COD branch in `place-order.js` also carried the only **"is this boutique
approved?"** check in the whole endpoint. It went with the branch.

No regression: the prepaid path never had that check, and the products query
already filters to `status = 'active'`, which migration `0038` cascades — a
rejected boutique's products are auto-hidden and so unorderable. Say the word if
you'd rather have it back as an explicit guard on every checkout; it costs one
extra query.

---

## What needs your hand

1. **Apply `supabase/migrations/0085_remove_cash_on_delivery.sql`** in the
   Supabase SQL editor. Until you do, the app-side removal is live but the
   database still accepts a COD insert and still carries `cod_enabled = true` on
   whichever shops had it on. It is idempotent; run it after `0084`.
2. **Check the notification landed** — after applying, sellers should see the
   "Cash on delivery has been withdrawn" message in their inbox.
3. **Nothing to deploy for the Edge Functions.** `payout-advice` and
   `shiprocket-book` are untouched; both already render COD lines conditionally.

### Sanity check after applying

```sql
-- Should return 0 rows.
select id, name from boutiques where cod_enabled;
select id from platform_settings where cod_enabled;

-- Should raise COD_WITHDRAWN.
insert into orders (order_number, boutique_id, total, status, payment_method)
values ('AGL-TEST', (select id from boutiques limit 1), 1, 'pending', 'COD');

-- Historical cash orders — these SHOULD still be here, untouched.
select count(*), sum(cod_fee) from orders where payment_method = 'COD';
```

---

## Working-tree note

The branch already carried unrelated in-progress work when this started —
platform-feedback publication (`0084`, `OrderFeedbackSheet`, `admin/Feedback`,
`buyer/Home`) and seller delivery-rate warnings (`DeliveryRateCard`, `FormKit`).
Those are untouched by this change; the COD removal sits on top of them.
