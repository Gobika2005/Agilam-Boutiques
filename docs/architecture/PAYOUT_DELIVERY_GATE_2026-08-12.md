# Seller payouts — delivered-only, on an 8-hour clock, with the seller told

**Date:** 2026-08-12
**Branch:** `fix/seller-console-audit-2026-08`
**Migration:** `0078a_payout_delivery_gate.sql` — **must be applied by hand**
**Edge Function:** `supabase/functions/payout-advice` — **must be deployed**

---

## What was asked

Make the admin payouts console state plainly that (a) only delivered orders are
paid out, (b) the payout follows within 8 hours of delivery, and (c) the seller
gets a clear per-product and total breakdown plus a clear message when the payout
happens.

Confirmed with the owner before building:

| Decision | Choice |
|---|---|
| How the 8 hours is enforced | Manual settlement, 8h-clocked — admin still transfers by hand, the console counts down and flags overdue |
| Delivered-only | Enforced in the database; 8h is the published target, not a lock (paying early is allowed) |
| Statement detail | Per-order lines, each expandable to the products in that order |
| Seller message | In-app + email + WhatsApp |

---

## Three defects found on the way

### 1. Manual settlement never checked delivery — money could leave for undelivered goods

The automatic sweep (`api/run-payouts.js`) has always required
`status = 'delivered'` plus a hold window. But automatic payouts are switched off
by decision (`AUTO_PAYOUTS_ENABLED = false`), so every real payout goes through
`settle_boutique_payout` — which required only `payment_status = 'paid'`.

A prepaid order placed an hour ago and never accepted was therefore payable. The
two code paths disagreed about what "settleable" meant, and the one actually in
use was the permissive one.

**Fixed:** `is_settleable()` in 0078 is now the single definition, requiring
`status = 'delivered'` and a `delivered_at` stamp on top of the money being real.
Both `settle_boutique_payout` and the admin list read it.

### 2. Migration 0063 silently reverted 0053's COD coupon credit — sellers underpaid

0053 added `v_cod_platform_discount`: on a COD order carrying a platform-funded
coupon, the seller collects `total − discount` in cash but is settled on the full
`total`, so the platform owes that gap back. 0063 re-declared the whole function
to add the dispute guard and **dropped the variable**, reinstating the 0025
arithmetic.

Since then the admin console has *displayed* the credit
([`src/data/payouts.ts`](src/data/payouts.ts) computes `codPlatformDiscount`) while
the database has not *paid* it. The screen and the money disagreed, in the
seller's disfavour.

**Fixed:** the credit is restored in 0078's `settle_boutique_payout`.

> **Worth the owner's attention:** any COD order with a platform coupon settled
> between 0063 and today was underpaid by the coupon amount. Whether that is
> worth reconciling depends on how many platform coupons have been redeemed on
> COD orders — likely few or none, but it is real money if not.

### 3. A hand-settled seller was never told anything

0044's `notify_payout_paid` fires `after update of status`. That is correct for
the automatic path, which opens a payout as `processing` and later flips it to
`paid`. A manual settlement **inserts** a row that is already `paid`, so the
trigger never ran — the seller learned about their money from their bank
statement, if at all.

**Fixed:** the trigger now covers `insert or update of status`, guarded on
`TG_OP` because `OLD` is unassigned on insert. The message now carries the amount,
the delivered-order count, the commission deducted, any COD net-off and the bank
reference.

---

## What was built

### Database — `0078a_payout_delivery_gate.sql`

- `platform_settings.payout_sla_hours` (default **8**) — the published promise.
  Deliberately *not* a settlement lock: refusing to pay until a timestamp matures
  would strand real money when a courier scan lands late, and paying a seller
  early harms nobody.
- `is_settleable(orders)` — one definition of payable, used by the settle
  function and mirrored by the console.
- `settle_boutique_payout` rewritten: delivery required, COD coupon credit
  restored, and a distinct error when a boutique has money outstanding but
  undelivered (`"N paid order(s) are not delivered yet"`) rather than a flat
  "nothing to settle".
- `notify_payout_paid` rewritten and its trigger widened to `insert or update`.
- `idx_orders_settlement` for the two statement screens.

### Admin console — `/admin/payments`

- A rule banner stating delivered-only and the {N}-hour promise.
- **PAYOUT DUE** column: a live countdown per boutique (`due in 5h 12m` /
  `3h 04m overdue`), ticking each minute, measured from that boutique's
  longest-waiting delivery.
- Two new tiles: **Past the 8h promise** and **Held — not delivered**; an overdue
  banner listing who is waiting.
- Each row now reads `N delivered orders · M held (₹X)`.
- The payout drawer itemises the orders being paid for — expandable to the
  products in each — using the same component the seller reads.
- After settling, a **Tell the seller** step opens with the bank reference still
  in hand: in-app (already sent, automatic), email (one tap), WhatsApp (wa.me
  link, composed).

### Seller console — `/seller/earnings`

- **Your payouts**: every payout, expandable to its orders, each expandable to
  its items, with the full arithmetic (order value → commission → COD fees →
  coupon refunds → transferred).
- A "How you get paid" card: delivered-only, within 8 hours, and why COD works in
  reverse.
- Two tiles renamed for honesty — "Pending payout" → **Held until delivered**,
  "Settled to you" → **Released after delivery**. The old labels claimed a
  transfer that may not have happened.
- Help FAQ now reads live settings instead of the frozen `POLICY_TERMS`, and no
  longer claims payouts wait for a return window (they never did), plus a new
  "Why is my payout less than I expected?" answer.

### Email — `supabase/functions/payout-advice`

An itemised payout advice, admin-triggered. It lives in a Supabase Edge Function
because `api/` is at exactly 12 routes — Vercel's Hobby ceiling — and a
thirteenth fails the deploy. Admin-only, checked by calling `is_admin()` with the
caller's own JWT. It moves no money and marks nothing paid; a failed send is a
toast, never a failed payout.

---

## What needs the owner's hand

1. **Apply `supabase/migrations/0078a_payout_delivery_gate.sql`** in the Supabase
   SQL editor. It is idempotent. Until it is applied, undelivered orders remain
   payable and hand-settled sellers stay silent.
2. **Deploy the Edge Function:** `supabase functions deploy payout-advice`.
3. **Set these Supabase project secrets** for the email to send (it is inert, not
   broken, without them): `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`.
4. **Decide on the COD coupon reconciliation** described in defect 2 above.
5. Optionally adjust **Payout promise** (hours) at `/admin/settings` — it defaults
   to 8.

WhatsApp remains a manual `wa.me` link. The Meta Cloud API automation (migration
0061) is still planned and unbuilt, so automating it here would have been a
promise the seller would notice was false.

---

## Verification

Run and passing:

- `npx tsc -b` — clean.
- `npm run lint` — 0 errors; the 25 warnings are all pre-existing and in files
  this work did not touch.
- `npm run build` — succeeds.

**Not verified:** the SQL in 0078 has not been executed — there is no local
Postgres in this environment, and per house rules the owner applies migrations.
The delivered-only gate, the restored coupon credit and the notification trigger
are therefore reviewed, not tested. Nothing in this change was exercised against
the live database.
