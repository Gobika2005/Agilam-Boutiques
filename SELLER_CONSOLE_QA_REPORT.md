# Seller Console — Live Production Test Report

**Date:** 2026-08-03
**Target:** `https://agilam-boutiques.vercel.app` (Vercel Production, prod Supabase, Razorpay live mode)
**Account:** Studio Mahil (`studiomahil@gmail.com`) — the designated seller test boutique, approved + verified
**Method:** Real browser (Chromium) against the deployed build, signed in with a real session. 19 seller routes × 2 viewports (390×844 mobile, 1440×900 desktop), plus interactive passes on the detail, write and payment flows, plus direct PostgREST probes with the seller's own JWT and with the public anon key.
**Authorised scope:** reversible writes, including acting on orders. Everything written was reverted — see §6.

> No credentials appear in this report.

---

## 1. Verdict

The seller console is in **good structural health** — 19 routes render at both viewports with no crashes, no page errors, no layout overflow and no broken images, and row-level security holds up under direct probing. The damage is concentrated in **two features that are completely non-functional in production**, both of which a seller would hit on their first attempt to use them, and neither of which shows an error when it fails.

| | |
|---|---|
| Routes swept | 19 × 2 viewports = 38 loads |
| Crashes / error boundaries | 0 |
| Uncaught page errors | 0 |
| Console errors | 1, on `/seller/coupons` only (both viewports, reproducible) |
| Horizontal overflow | 0 |
| Broken images | 0 |
| **P1 — feature dead in production** | **2** |
| P2 — wrong numbers shown to seller | 1 |
| P3 — over-exposure / polish | 2 |

---

## 2. P1 findings

### P1-1 — Seller Coupons is entirely non-functional, and fails silently

**What a seller sees:** `/seller/coupons` always reads *"No coupons yet."* Creating a coupon does nothing — the form stays open, no error, no toast, and no coupon is created. A seller would reasonably conclude they mis-filled the form and try again forever.

**What actually happens:**

```
GET  /rest/v1/coupons?select=…,created_by,usage_limit,used_count  → 403  (42501)
POST /rest/v1/coupons?select=…,created_by,usage_limit,used_count  → 403  (42501)
```

PostgREST's own hint: `Grant the required privileges to the current role with: GRANT SELECT ON public.coupons TO authenticated;`

**Verified live:** filled the form (code `QATEST0803`, 10% off, expiry 2026-08-31), hit Save, observed the 403, and confirmed `select * from coupons where code = 'QATEST0803'` returns **zero rows**. Nothing was created.

**Cause.** Migration `0058_coupon_column_lockdown.sql` does:

```sql
revoke select on coupons from anon, authenticated;
grant select (id, code, boutique_id, …) on coupons to anon, authenticated;
```

The migration's header comment reasons that this is safe because *"`src/data/coupons.ts` selects them for the seller and admin consoles, which run as the owner or an admin."* That reasoning does not hold: a signed-in seller **is** the `authenticated` role, and PostgreSQL checks column privileges *before* RLS. Revoking the columns from `authenticated` locks out the seller and admin consoles exactly as hard as it locks out a buyer.

Two supporting facts:

- [`src/data/coupons.ts:72`](src/data/coupons.ts#L72) still builds `COLUMNS` with `created_by, usage_limit, used_count`, and [`fetchBoutiqueCoupons`](src/data/coupons.ts#L153) / [`createCoupon`](src/data/coupons.ts#L180) still request them.
- 0058 created `coupon_private(uuid)` as the sanctioned way to reach those three columns. **It is never called** — `grep -rn "coupon_private" src/ api/` returns nothing. The migration shipped its own remedy and the app was never wired to it.

The failure is silent because [`selectCoupons`](src/data/coupons.ts#L94) only degrades on `42703` ("column does not exist", the un-migrated-project case) and rethrows everything else, and [`Coupons.tsx:53`](src/pages/seller/Coupons.tsx#L53) does `const rows = mine ?? []` — so a thrown error renders as an empty list.

**Blast radius.** The same code path backs `/admin/coupons` (`fetchAllCoupons` uses the identical `COLUMNS`). Since the revoke is on the `authenticated` *role*, the admin console is broken in the same way. Buyer-side coupon redemption is unaffected — `fetchActiveCoupons` correctly asks for `BASE_COLUMNS` only, and `redeem_coupon` is `SECURITY DEFINER`.

**Fix — pick one:**
1. Call `coupon_private()` for the three withheld columns (what 0058 intended).
2. Add `42501` to `isMissingUsageColumns` so the console degrades to buyer-safe columns instead of showing a false empty state. *Cheapest, but the seller silently loses redemption counts.*
3. Grant the three columns back to `authenticated` and let RLS do the filtering. *Undoes 0058's security intent — the anon key would read them again.*

Whichever is chosen, `Coupons.tsx` should surface the error rather than rendering an empty list.

---

### P1-2 — Seller ads cannot be bought; the only offered slot is priced at ₹0

The "Create an ad" wizard offers exactly **one** placement: *"Home hero banner — ₹0/day"*. The rate card in production is:

| Placement | Daily rate | Active | Max slots |
|---|---|---|---|
| `sponsored_card` (Sponsored product) | ₹1/day | **false** | 8 |
| `home_hero` (Home hero banner) | **₹0/day** | true | 10 |
| `boutique_promo` (Boutique promotion) | ₹1/day | **false** | 6 |

Two problems compound:

1. The two paid placements are switched **off**, so they never appear in the wizard.
2. The one active placement is priced at **₹0/day** — the most visible slot on the buyer home screen, free.

And ₹0 does not actually mean free ads, because [`api/_ads.js:154`](api/_ads.js#L154) rejects anything under one rupee:

```js
if (!Number.isFinite(priced.paise) || priced.paise < 100) {
  return res.status(400).json({ error: 'This campaign's price is below the minimum payable amount.' });
}
```

So every booking attempt on the only offered placement dead-ends at payment. **The seller ads product — half of the stated revenue model — is closed for business in production.**

This is configuration, not code: set real rates and re-activate `sponsored_card` and `boutique_promo` at `/admin/ads`. Worth also deciding whether a ₹0 rate should be rejected at the admin end, since today it silently disables the placement it's set on.

---

## 3. P2 finding

### P2-1 — Analytics counts cancelled orders as revenue

`/seller/analytics` reports **₹7.9k revenue / 5 orders** for Studio Mahil. The correct figure is **₹6,399 / 4 orders** — the ₹1,500 cancelled order `AGL-0NZ4K4E47A` is being counted.

[`Analytics.tsx:71-73`](src/pages/seller/Analytics.tsx#L71-L73) filters on date alone:

```ts
const inRange = orders.filter((o) => new Date(o.created_at).getTime() >= rangeStart);
const totalOrders = inRange.length;
const totalRevenue = inRange.reduce((s, o) => s + Number(o.total), 0);
```

Two other screens get this right and therefore contradict Analytics:

- [`Earnings.tsx:94`](src/pages/seller/Earnings.tsx#L94) — `filter(o => o.status !== 'rejected' && o.status !== 'cancelled')`, with a comment explaining exactly why.
- `/seller/orders` — *"₹5,283 still to collect in cash"* is arithmetically correct **only because** it excludes the cancelled order (₹2,027 + ₹1,628 + ₹1,628).

Fix: apply the same `rejected`/`cancelled` exclusion in `Analytics.tsx`. It also feeds the trend bars and the top-categories table, so those are overstated too. Separately, decide whether offline walk-in bills belong in the Analytics revenue figure — Earnings deliberately reports them separately, Analytics folds them in.

---

## 4. P3 findings

### P3-1 — A chat counterpart's email and phone are readable by the seller

Probing `/rest/v1/profiles` with the seller's own JWT returns 2 rows: their own, plus the buyer they have an open conversation with — including `email` and `phone`:

```
{"id":"6da69755-…","email":"6633lakshmanan@gmail.com","role":"seller",
 "full_name":"sakthi Udhaya Lakshmanan N","phone":"6374248158"}
```

The scoping itself is right (no access to the other 20-odd profiles), and the seller legitimately needs a display name for the chat header. But `email` is not needed for any seller surface, and delivery contact already travels on the order (`guest_phone`). Consider narrowing the policy to the columns the chat actually renders. Low severity — it is one counterparty, not an enumeration.

### P3-2 — A buyer marketing broadcast landed in the seller's notifications

Studio Mahil's notification list includes *"Festive Offers Are Here 🎉 — Celebrate in style with exclusive festive collections and special discounts"* (type `Updates`, 2026-08-01), alongside their three genuine order notifications. That is buyer-facing marketing copy delivered to a seller. Worth confirming the audience selector on `/admin/broadcast` excludes sellers, or that this was a deliberate send-to-everyone.

---

## 5. Verified working

Things actively tested that behave correctly — recorded so they don't get re-tested:

**Security**
- Anonymous (public anon key only) reads return **zero rows** for `profiles`, `orders`, `conversations`, `messages`.
- The seller JWT sees **only their own 5 orders** — no cross-boutique leakage. `payouts`, `expenses`, `admin_activity_log` all return empty for a seller.
- `coupons` correctly refuses the operator-only columns to a non-privileged select (0058 working as designed — it is only the app that wasn't updated).

**Correctness**
- Orders "₹5,283 still to collect in cash" — correct to the rupee, cancelled order excluded.
- Earnings "Orders this month 4" — **correct**. Three orders timestamped `2026-07-31T19:0x UTC` fall on 1 Aug in IST, which is the browser's timezone. Not a bug.
- Earnings "₹0" — correct: all three COD orders are `payment_status: pending` (uncollected), and the ₹1,500 walk-in bill is `channel: offline`, which Earnings deliberately reports separately.
- Add-product validation: empty submit is blocked, per-field *Required* / *Enter a valid price* / *Enter valid stock* messages render, page does not navigate.
- Order status advance: `accepted → shipped` wrote `status` and `shipped_at`, and generated the buyer notification. *(Reverted — see §6.)*
- "Reject" appearing on an already-accepted order is **deliberate and documented** — [`OrderDetail.tsx:316`](src/pages/seller/OrderDetail.tsx#L316) allows reject while `pending` or `accepted` and withdraws it once shipped.
- `/seller/verification` redirecting an approved boutique to the dashboard is **deliberate** — [`Verification.tsx:82`](src/pages/seller/Verification.tsx#L82).
- Theme toggle: Light → Dark applied immediately and persisted across navigation. Restored to System afterwards.
- Boutique profile form is correctly prefilled from the DB (name, boutique, city, area, phone, description).
- Expired ad campaigns stuck at `status: 'live'` (because the lifecycle cron has no `CRON_SECRET`) **do not serve** — [`api/_ads.js:116-129`](api/_ads.js#L116-L129) trusts `end_at` over the stored status for both serving and slot-occupancy counting. A genuinely well-handled edge case; the stale rows are cosmetic.
- Product analytics, order detail with WhatsApp bill preview, customer list, chat thread, seller search, notifications, billing/POS, help — all render real data correctly.

**Performance** (deployed build, unthrottled)

| Viewport | Min | Median | Max |
|---|---|---|---|
| Mobile 390×844 | 3,192 ms | 4,096 ms | 5,365 ms (`/seller/boutique`) |
| Desktop 1440×900 | 3,179 ms | 3,831 ms | 6,407 ms (`/seller/billing`) |

No route is pathological, but a ~4 s median to interactive on an operator console is worth a look; `/seller/billing` and `/seller/analytics` are the two outliers.

---

## 6. Everything this test wrote, and its current state

| Write | State now |
|---|---|
| Order `AGL-9B69O3F86D` advanced `accepted → shipped` | **Reverted** — `status: accepted`, `shipped_at: null` |
| Buyer notification *"Your order has shipped"* generated by that action (recipient: the fake QA Buyer account from the Aug-1 run) | **Deleted** |
| Coupon `QATEST0803` | **Never created** — the 403 aborted the insert. Confirmed zero rows. |
| Theme preference set to Dark | **Restored to System** |
| Ad campaign | None created; the wizard was walked but never taken to payment |

No product, boutique, customer, payout or real buyer order was created or modified. No payment was taken. All QA harness scripts have been deleted from the repo.

---

## 7. Still outstanding from the 2026-08-02 buyer audit

Re-checked today and unchanged:

- **`platform_settings.maintenance_mode` is still `true`.** Every buyer and crawler still sees the maintenance banner. Seller and admin consoles are exempt by design, so this did not affect the tests above. Turn it off at `/admin/settings`.
- `CRON_SECRET` still unset — ad campaigns still never auto-expire in the DB (harmless for serving, per §5).
- Upstash rate-limit vars still unset.

---

## 8. Fixes applied (2026-08-03, same day)

### P1-1 coupons — **fixed and verified**

| | |
|---|---|
| `supabase/migrations/0059_coupon_console_access.sql` | New. Adds `coupon_private_all()` — the set-returning form of 0058's `coupon_private(uuid)`, same entitlement check, one round trip instead of an N+1. **Must be applied** (see §9). |
| `src/data/coupons.ts` | Console reads and writes now ask `coupons` for `BASE_COLUMNS` only and graft the three operator columns on from the RPC. `fetchActiveCoupons` deliberately skips the RPC — the buyer app loads it on every screen and has no use for those columns. `createCoupon`/`updateCoupon` no longer put the revoked columns in their `RETURNING` clause, which is what was aborting the insert. |
| `src/pages/seller/Coupons.tsx` | A failed load now renders an error card with a Retry button instead of "No coupons yet". |
| `src/pages/admin/Coupons.tsx` | Same: the table distinguishes "none exist" from "couldn't read them". |
| `src/types/database.ts` | RPC signature for `coupon_private_all`. |

**Verified live** against the production database: the list request went `403 → 200`, and creating a coupon went `403 / no row` → `201` with the row present and correct (`QAFIX0803`, 15% off, right `boutique_id`) and rendering in the list. The test coupon was deleted afterwards.

Worth knowing: **the console starts working the moment this code deploys, before 0059 is applied.** The 403 is gone because the app no longer asks for the revoked columns at all; until the migration lands, the RPC 404s once per page load and the redemption counters simply show as unlimited/0.

### P1-2 ads — **fixed**

Rate card updated in production to the rates you chose, and all three placements switched on:

| Placement | Was | Now |
|---|---|---|
| Home hero banner | ₹0/day, active | **₹99/day**, active |
| Sponsored product | ₹1/day, **inactive** | **₹49/day**, active |
| Boutique promotion | ₹1/day, **inactive** | **₹79/day**, active |

`src/pages/admin/Ads.tsx` also now refuses to save an *active* placement priced under ₹1, since that is the state that silently dead-ends every seller at payment. Taking a placement off sale is what the Active tick is for.

### P2-1 analytics — **fixed and verified**

[`Analytics.tsx`](src/pages/seller/Analytics.tsx#L71) now excludes `cancelled` and `rejected` at `inRange`, so revenue, order count, the trend bars, top categories and the returning-customer count all agree with Earnings and Orders. Studio Mahil's tile went **₹7.9k / 5 orders → ₹6.4k / 4 orders**, matching the database.

### Not changed, by your decision

- **P3-1** (a chat buyer's email/phone readable via a hand-crafted API call) — left as documented. The app itself only ever selects `full_name`; closing it properly means replacing the 0007 RLS policy with a definer function and rewriting the two chat joins, which touches the Messages inbox.
- **P3-2** turned out **not to be a bug.** `broadcast_notification` (migration 0050) defines audience `'all'` as buyers *and* sellers by design — 0050 exists precisely to stop it also hitting admins. The festive broadcast reached the seller because it was sent to everyone.
- **Maintenance mode** left on at your request.

### Checked and confirmed unaffected

`api/_pricing.js` still selects `usage_limit, used_count` when resolving a coupon at checkout — that runs under the **service-role** key, which 0058's `revoke … from anon, authenticated` never touched. Buyer coupon redemption was never broken. Confirmed empirically, not just by reading.

`npm run build` and `eslint` both clean.

---

## 9. What still needs your hand

1. **Apply `supabase/migrations/0059_coupon_console_access.sql`** in the Supabase SQL editor. It is idempotent. Without it the coupon consoles work but show no redemption counters.
2. **Deploy** — the coupon and analytics fixes are code.
3. **Maintenance mode** — still `true`, your call.
4. `CRON_SECRET` and the Upstash vars, carried over from the 2026-08-02 audit.
