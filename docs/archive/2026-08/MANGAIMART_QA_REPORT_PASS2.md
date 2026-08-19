# MangaiMart — QA Report, Pass 2

**Date:** 2026-08-01
**Build:** `main` @ `0a98f00` + uncommitted working tree
**Targets:** local `http://localhost:5173` driven by real Chromium (Playwright 1.62), against the **real** Supabase project `mtxmuaskmyhnqczctwlp` and the real Razorpay account
**Method:** browser automation of the real UI, direct HTTP probes of every `/api/*` endpoint, read-only database verification with the service role, and permission probes with the public anon key.

> **Scope of this pass.** A full QA pass ran earlier today and produced
> `MANGAIMART_FULL_QA_REPORT.md`. This pass does two things that one did not:
> it **re-verifies the fixes that report claimed**, and it attacks the areas that
> report explicitly marked **NOT TESTED** — ads lifecycle, payouts execution,
> coupons, offline/POS billing, webhooks, storage buckets, rate limiting.
> Findings already documented there are cross-referenced, not repeated.

> ⚠️ **A second session was editing this repository while these tests ran.**
> ~58 files (a `--ag-*` colour-token refactor) and `MANGAIMART_UI_UX_AUDIT.md`
> were being written at 11:11–11:21, i.e. during and after the browser run. Those
> edits are **not mine** and I left them untouched. They are cosmetic (hardcoded
> hex → CSS variable), so the functional findings below stand, but the exact
> pixel/measurement results describe the tree as it was at ~11:10.

---

## Executive summary

The engineering here continues to hold up under attack. **44 of 47 permission
probes passed**, all six `/api/place-order` abuse probes were correctly refused
before any write, rate limiting is real (20 requests then `429`, confirmed on two
endpoints), and a sweep of **37 routes produced zero console errors, zero page
errors and zero failed requests**. Seven viewports across six pages produced
**zero horizontal overflow**.

The serious findings in this pass are not in the application logic — they are in
**commercial configuration and in two money-handling paths nobody had exercised.**

The headline is a live coupon. **`LANCHOFF` gives 90% off, is uncapped, has no
usage limit, and is advertised on the public coupons page to anonymous
visitors.** I priced it through the real UI: a ₹1,499 bag settles at **₹229**.
Because it is a *platform* coupon, the seller's order still records the full
₹1,499 — so the platform funds the entire ₹1,349 gap, on every use, without
limit, until 31 August.

Beyond that: **no ad can currently be bought at all** (the only enabled placement
is priced at ₹0/day, which falls below Razorpay's 100-paise minimum), the ad
lifecycle cron is inert so six campaigns are still flagged `live` up to six days
past their end date, and the automatic seller payout run could never verify a
bank account because it never read the two columns its own verification logic
branches on.

I fixed three defects in code and left every commercial/data decision to you.

### Scores

| Area | Score | Basis |
|---|---:|---|
| **Application logic & security** | 90 / 100 | 44/47 probes passed; server-side pricing, replay guards, signature checks and rate limits all verified working. Lost points for three anon read exposures and unrestricted storage buckets. |
| **Buyer front end** | 86 / 100 | 37 routes clean, no overflow at 7 viewports, no broken images, good a11y baseline. Lost points for no 404 page and sub-32px tap targets. |
| **Seller money paths** | 62 / 100 | Payouts verification broken, ads unsellable, POS discount unrecorded. All three now fixed or diagnosed. |
| **Ads product** | 35 / 100 | Cannot take a payment; lifecycle cron inert; stale `live` rows. |
| **Commercial configuration** | 30 / 100 | A 90%-off uncapped public coupon, ₹0 and ₹1/day ad rates, maintenance mode on in public. |
| **Ops / environment** | 45 / 100 | Prepaid still dead (Razorpay 401), no webhook secret, prod == test, local Node 20 vs pinned 24. |
| **Production readiness** | **58 / 100** | Down from the previous pass's 68 — not because the code got worse, but because this pass found money-losing configuration the previous pass had not looked at. |

### Launch recommendation

> ## 🔴 DO NOT LAUNCH YET — but the gap is hours, not weeks
>
> Every blocker below is **configuration or data**, not architecture. The
> software is genuinely well built: the pricing authority, the replay guards, the
> tenant isolation and the input validation all did exactly what they claim under
> direct attack. What is not ready is the *commercial setup around it*.
>
> **Delete or cap `LANCHOFF` before anything else** — it is live, public, and
> uncapped right now.

---

## 1. Critical bugs (P0)

### P0-A · `LANCHOFF` — a public, uncapped, unlimited 90%-off coupon the platform funds
- **Role:** Any anonymous visitor
- **Surface:** `/buyer/coupons`, `api/_pricing.js`, `coupons` table
- **Evidence — priced through the real UI, no sign-in:**
  ```
  Subtotal          ₹1,499
  Coupon discount  – ₹1,349      ← 90%, no cap
  Delivery            ₹79
  Total              ₹229
  ```
  On a ₹3,519 bag the same page advertises **"LANCHOFF SAVE ₹3,167"**.
- **The coupon row:** `type=pct, off=90, min_subtotal=0, max_discount=NULL, usage_limit=NULL, active=true, expires_at=2026-08-31, boutique_id=NULL`.
- **Why it is worse than it looks — three multipliers:**
  1. **`max_discount` is NULL** → `couponSavings()` caps at `Infinity` (`_pricing.js:132`). A ₹50,000 bag discounts by ₹45,000.
  2. **`usage_limit` is NULL** → `redeemCoupon` never refuses. Unlimited redemptions, per person, forever.
  3. **`boutique_id` is NULL → it is a PLATFORM coupon.** Per `_pricing.js:159-162`, `perBoutiqueDiscount` stays empty, so `place-order.js:502` writes the order with the boutique's **full** goods total. **The seller is still owed ₹1,499 and is still charged 10% commission on ₹1,499 — the platform absorbs 100% of the ₹1,349.**
  4. It is **not a secret code**. The anon API returns the whole `coupons` table, and the buyer app lists it on `/buyer/coupons` for logged-out visitors.
- **Net exposure:** ~₹1,270 lost per ₹1,499 order, unbounded in both order size and volume, for 30 more days.
- **It is worse on Cash on Delivery — see the addendum at the end of this report.** A platform coupon was never recorded on the order, so a COD buyer is quoted the discounted total at checkout and then asked for the **undiscounted** amount at the door. With `LANCHOFF` that is a ₹229 quote against ₹1,578 demanded on the doorstep.
- **Fix implemented:** **None — deliberately.** This is live production data and a commercial decision. I will not delete or edit a promotion you may have launched on purpose.
- **Exact fix, your choice of three:**
  ```sql
  -- (a) kill it
  update coupons set active = false where code = 'LANCHOFF';

  -- (b) keep the launch offer but bound the damage
  update coupons
     set off = 20, max_discount = 300, min_subtotal = 999, usage_limit = 500
   where code = 'LANCHOFF';

  -- (c) keep 90% but make it a genuinely limited launch stunt
  update coupons
     set max_discount = 500, usage_limit = 100, expires_at = current_date + 7
   where code = 'LANCHOFF';
  ```
  Separately, add a guard so this class of mistake cannot recur — see P2-C.
- **Status:** 🔴 **OPEN — needs your decision today.**

### P0-B · Prepaid payment is still entirely dead (carried, re-confirmed)
- `GET /api/health` → `{"checkoutReady":false,"razorpay":{"ok":false,"mode":"test","status":401,"error":"Authentication failed"}}`.
- Unchanged since the previous pass. UPI is the default-selected method, so most buyers cannot pay at all; only Cash on Delivery completes.
- **Status:** 🔴 **MANUAL ACTION REQUIRED** — issue working keys, confirm `checkoutReady: true`.

### P0-C · Production and "test" remain the same Supabase project (carried)
- `/api/health` reports project `mtxmuaskmyhnqczctwlp` — the same project the public site reads. Every probe in this report ran against production data.
- **Status:** 🔴 **MANUAL ACTION REQUIRED** (see `ENVIRONMENTS.md` §1).

### P0-D · Maintenance mode and the joke overlay are still live (carried)
- `platform_settings.maintenance_mode = true`. Captured verbatim from the real UI on the product page:
  > *"🍿 Popcorn Time: Bugs paakalaam nu vandheengala?…"*, *"Dummy products dhaan. Order pannadheenga… developer-ku unnecessary tension kudukadheenga."*, plus a **"DEV · not production"** badge and *"We're carrying out maintenance right now."*
- This renders on **every buyer page**, including the product and cart pages.
- **Status:** 🔴 **MANUAL ACTION REQUIRED.**

---

## 2. High-priority bugs (P1)

### P1-A · Automatic seller payouts could never verify a bank account — **FIXED**
- **Surface:** `api/run-payouts.js`
- **Root cause:** `BOUTIQUE_COLS` selected 12 columns but **not** `razorpayx_validation_id` or `payout_verification_status` — the two columns `ensurePayoutVerified()` branches on (`run-payouts.js:76, 87`). Both therefore read as `undefined` on every row.
- **Consequences:**
  1. `if (present(boutique.razorpayx_validation_id))` was **always false**, so the "a penny-drop is already running → poll it" branch was **unreachable**.
  2. Every nightly run therefore re-entered the "not started" branch and opened a **brand-new penny-drop validation** — a real, chargeable RazorpayX transaction — overwriting the previous id each time.
  3. Each overwrite orphaned the previous validation's webhook (`razorpayx-webhook.js:91` matches on that id), so a result arriving late updated nothing.
  4. With the RazorpayX webhook unconfigured, the polling fallback was the *only* route to `verified` — meaning **bank-payout sellers would never be paid automatically, indefinitely.**
- **Confirmed against the DB:** all 18 boutiques read `payout_verification_status = 'unverified'`, `payout_details_verified = false`, `razorpayx_validation_id = null`.
- **Fix implemented:** both columns added to `BOUTIQUE_COLS`, with a comment recording why they are load-bearing.
- **Status:** ✅ **FIXED** (`api/run-payouts.js`).

### P1-B · No ad can be purchased — the whole ads product cannot take money
- **Surface:** `ad_placements` rate card → `api/_adPricing.js` → `api/_ads.js`
- **The live rate card:**
  | code | daily_rate | max_active | active |
  |---|---:|---:|---|
  | `home_hero` | **₹0** | 10 | **true** |
  | `sponsored_card` | ₹1 | 8 | false |
  | `boutique_promo` | ₹1 | 6 | false |
- **What happens to a seller who tries to buy each one:**
  - `home_hero` — the only enabled placement. `priceCampaign` returns `paise = 0`; `createAdOrder` rejects anything under 100 paise → **400 "This campaign's price is below the minimum payable amount."** Razorpay cannot create a ₹0 order.
  - `sponsored_card` / `boutique_promo` — `priceCampaign` returns `UNKNOWN_PLACEMENT` for an inactive placement → **400 "That ad placement is no longer available."**
- **Corroboration:** one `home_hero` campaign sits stuck at `pending_payment` with `amount = 0`; the eight paid campaigns were bought at ₹1–₹14 total, i.e. at placeholder rates.
- **Fix implemented:** **None** — this is your rate card and pricing decision, editable at `/admin/ads`.
- **Exact fix:** set real rates and enable the placements:
  ```sql
  update ad_placements set daily_rate = 199, active = true where code = 'home_hero';
  update ad_placements set daily_rate =  99, active = true where code = 'sponsored_card';
  update ad_placements set daily_rate = 149, active = true where code = 'boutique_promo';
  ```
  Also add a guard in `_adPricing.js` so a ₹0 rate is refused as a misconfiguration rather than surfacing to the seller as a pricing error.
- **Status:** 🟠 **OPEN — needs your pricing decision.**

### P1-C · The ad lifecycle cron is inert — expired ads never expire, scheduled ads never start
- **Surface:** `api/_ads.js` → `runAdLifecycle`, `vercel.json` crons
- **Root cause:** `runAdLifecycle` returns an inert `200 {skipped}` when **neither** `AD_CRON_SECRET` nor `CRON_SECRET` is set (`_ads.js:363`). Neither is present in `.env`, and Vercel does not create `CRON_SECRET` for you. The cron in `vercel.json` fires and does nothing.
- **Proof from the database — six campaigns still `live` days after they ended:**
  ```
  home_hero       live  ended 2026-07-28   (4 days ago)
  home_hero       live  ended 2026-07-28
  home_hero       live  ended 2026-07-26   (6 days ago)
  sponsored_card  live  ended 2026-07-26
  boutique_promo  live  ended 2026-07-26
  home_hero       live  ended 2026-07-26
  ```
- **Mitigation that limits the blast radius:** the buyer feed does **not** serve them. `src/data/ads.ts:173` skips any row whose `end_at` has passed, and `effectiveAdStatus()` reports "Ended" regardless of stored status. So buyers are not seeing expired ads and sellers are not getting free impressions.
- **The real harm is the other direction:** `expire_and_activate_ads` is also what **activates** a `scheduled` campaign. With the cron inert, **an ad bought for a future start date will never go live** — the seller pays and nothing runs. Admin reporting on ad status is also wrong.
- **Fix implemented:** **None** — this is an environment variable, not code.
- **Exact fix:** set `CRON_SECRET` (or `AD_CRON_SECRET`) in Vercel → Project → Environment Variables, redeploy, then confirm:
  ```bash
  curl -s "https://<app>/api/ads?action=lifecycle" -H "x-cron-secret: <secret>"   # → {"ok":true}
  ```
  The **same fix is required for `/api/run-payouts`**, which is gated on `PAYOUT_CRON_SECRET`/`CRON_SECRET` in exactly the same way.
- **Status:** 🟠 **MANUAL ACTION REQUIRED.**

### P1-D · A coupon hitting its limit mid-checkout ate the stock and kept the money — **FIXED**
- **Surface:** `api/place-order.js`
- **Root cause:** the order of operations was `reserve_stock` → *(charge already captured)* → `redeemCoupon` → **`return 409`**. That early return skipped both `release_stock` and `refundPayment`, which every other failure path in the function performs.
- **Impact on the prepaid path:** buyer is charged, told *"That coupon has just reached its redemption limit"*, **no order is created, no refund is issued, and the reserved stock is never returned.** Money taken, inventory burned, nothing to show. On COD, inventory is burned silently.
- **Trigger:** two checkouts racing for the last redemption of a capped coupon. Narrow, but the failure mode is the worst kind — and `usage_limit` exists precisely so codes *do* run out.
- **Fix implemented:** the 409 branch now releases the reservation and refunds a prepaid payment before returning, mirroring the order-write failure handler immediately below it. The prepaid message now also tells the buyer their money is on its way back.
- **Status:** ✅ **FIXED** (`api/place-order.js`).

### P1-E · No Razorpay webhook secret — the captured-but-no-order backstop is switched off
- **Surface:** `api/razorpay-webhook.js`
- `RAZORPAY_WEBHOOK_SECRET` is absent from `.env`. Without it the handler returns an inert `200 {skipped: 'webhook not configured'}` (line 53) and reconciles nothing.
- That endpoint exists for exactly one scenario: **the buyer's payment is captured but the browser dies before `place-order` runs.** With it off, that money is captured with no order and nothing notices.
- `payment_events` currently holds 9 rows — I checked every one against `ad_campaigns` and `orders`: **8 are ad payments and 1 is a raced shop order. All benign, no money is currently lost.** (Those rows prove the webhook *is* configured on Vercel even though it is absent locally — so verify the deployed value rather than assuming.)
- **Exact fix:** set `RAZORPAY_WEBHOOK_SECRET` in every environment to match the Razorpay dashboard webhook secret, subscribed to `payment.captured` and `order.paid`.
- **Status:** 🟠 **MANUAL ACTION REQUIRED (verify deployed).**

---

## 3. Medium bugs (P2)

### P2-A · The POS discount was applied to the money but never recorded — **FIXED (migration)**
- **Surface:** `create_offline_sale()` (migration 0009) ← `src/pages/seller/Billing.tsx`
- **Root cause:** the function computes `v_total := v_subtotal - p_discount` and inserts `v_total`, but **never writes `p_discount` into `orders.discount`**.
- **Proof — four live orders whose books do not reconcile:**
  ```
  AGB-260720-8367   items ₹4,899  discount 0  total ₹4,699   (₹200 unexplained)
  AGB-260720-3550   items ₹4,899  discount 0  total ₹4,699
  AGB-260720-3882   items ₹4,899  discount 0  total ₹4,699
  AGB-260720-3246   items ₹5,299  discount 0  total ₹5,099
  ```
- **Why it matters:** the amount charged was correct — the *reason* was lost. A seller cannot answer "why was this bill ₹200 less?", and any reconciliation of `sum(order_items)` against `orders.total` shows a phantom gap on every discounted walk-in sale.
- **Fix implemented:** new migration `supabase/migrations/0052_offline_sale_discount.sql` — records the clamped discount, and repairs the four existing rows from data already present. **You must apply this migration.**
- **Status:** ✅ **FIXED — migration written, NOT YET APPLIED.**

### P2-B · POS bill numbers will start colliding — **FIXED in the same migration**
- `create_offline_sale` builds `'AGB-' || YYMMDD || '-' || floor(random()*9000+1000)` — only **9,000 numbers per day across the entire platform** — while `orders.order_number` is unique with **no retry**.
- By the birthday paradox a collision is roughly a coin-flip at ~110 bills/day platform-wide, and it surfaces as a hard error that **loses the seller's bill at the counter**, in front of a customer.
- **Fix implemented:** migration 0052 retries up to 10 times against existing numbers before inserting.
- **Status:** ✅ **FIXED — migration written, NOT YET APPLIED.**

### P2-C · Anonymous visitors can read the entire `coupons` table
- `anon SELECT coupons` returns every row — code, type, discount. This is presumably deliberate (it powers `/buyer/coupons`), but it means **MangaiMart cannot have a private, targeted or influencer code** — every code is public the moment it exists, and it is what turns P0-A from "someone might guess it" into "it is advertised".
- **Exact fix:** expose only codes intended for public listing, e.g. add `coupons.public boolean default false`, restrict the anon `select` policy to `public = true and active and expires_at >= current_date`, and keep validation server-side in `loadCoupon` (which uses the service role and is unaffected).
- **Status:** 🟡 OPEN.

### P2-D · Anonymous visitors can read `ad_campaigns`, including Razorpay payment ids
- `anon SELECT ad_campaigns` returned `{"id":…,"amount":14,"payment_id":"pay_TIrCF6nuYrbnfC"}`. The buyer app needs the **creative**, not what a seller paid or their payment id.
- **Exact fix:** restrict the anon policy to serving columns, or front the feed with a view exposing only `id, placement_code, product_id, boutique_id, creative fields, start_at, end_at`.
- **Status:** 🟡 OPEN.

### P2-E · All five storage buckets are public with no size limit and no MIME allowlist
```
post-images  product-images  boutique-images  catalogue-images  review-images
  → public = true, file_size_limit = none, allowed_mime_types = ANY
```
- Anonymous upload is correctly refused on all five (verified). But **any authenticated seller or buyer can upload a file of any type and any size** into a world-readable bucket.
- Two consequences: an unbounded storage bill from a single actor, and — because the buckets are public and serve any MIME type — a seller can host arbitrary `.html`/`.svg` content on your Supabase domain, which is a stored-XSS and phishing-hosting primitive against that origin.
- **Exact fix:** in Supabase → Storage → each bucket → set `file_size_limit` (e.g. 5 MB) and `allowed_mime_types` to `image/jpeg, image/png, image/webp, image/avif`.
- **Status:** 🟡 OPEN.

### P2-F · Unknown URLs silently redirect to the homepage — there is no 404 page
- `/nonexistent-route-qa-404` → lands on `/`, 200, no message. A mistyped or stale link gives no signal that the page does not exist, and it makes broken inbound links invisible in analytics.
- **Exact fix:** add a catch-all `<Route path="*" element={<NotFound />} />` with a real "page not found" screen and a route back into the catalogue.
- **Status:** 🟡 OPEN.

### P2-G · Signed-out seller deep links dump you on a blank root page
- Every `/seller/*` route when signed out → `/` with ~275 characters of content and no explanation. Compare `/admin/*`, which correctly redirects to `/admin/login`.
- **Exact fix:** mirror the admin behaviour — redirect `/seller/*` to the seller sign-in with a "sign in to continue" notice and a return-to parameter.
- **Status:** 🟡 OPEN.

### P2-H · Order state incoherences in live data
- 2 orders have `delivered_at` set while `status = 'rejected'`.
- 5 orders have `payment_method = NULL`.
- **Exact fix:** clear `delivered_at` when an order leaves `delivered`, and backfill `payment_method` (these predate the column's introduction in migration 0009). Consider a check constraint tying `delivered_at IS NOT NULL` to `status = 'delivered'`.
- **Status:** 🟡 OPEN.

### P2-I · Local Node is 20; `package.json` pins `engines.node: 24.x`
- `node -v` → **v20.11.1**. `api/_supabase.js` documents at length that supabase-js **throws** on Node 20 when constructing a client, which is why the transport placeholder exists. supabase-js also now prints a deprecation warning on every call.
- The workaround holds today, but local dev is running a runtime the project declares unsupported — so a Node-20-only failure would not reproduce for you and a Vercel runtime downgrade would reintroduce it in production.
- **Exact fix:** install Node 22+ locally (`nvm install 22 && nvm use 22`).
- **Status:** 🟡 OPEN.

---

## 4. Low bugs (P3)

| ID | Surface | Issue | Status |
|---|---|---|---|
| P3-a | `/buyer/home` mobile | **29 controls under the 32px tap-target floor** (toast close 28×28, "VIEW ALL →" 84×15, carousel dots 18×6). Cart 1, results 2. | OPEN (carried) |
| P3-b | `src/data/admin.ts` | `fetchOverviewMetrics()` / `fetchGmvBars()` still dead code with a **wrong** GMV definition. Delete them. | OPEN (carried) |
| P3-c | Repo | `vite-dev.out.log` **and** `vite-dev.err.log` still tracked in git. `git rm --cached vite-dev.*.log` + add `*.log` to `.gitignore`. | OPEN (carried) |
| P3-d | `boutiques` | `Littleshop dpm`'s slug is still `"Littleshop-dpm\r\n"` (stored CRLF); **12 of 18 boutiques have a NULL slug**. Either populate on create or drop the column. | OPEN (carried) |
| P3-e | Product data | Still 1 product with `mrp ₹2,199 < price ₹2,599`. Add `mrp >= price` validation to the product form. | OPEN (carried) |
| P3-f | `/buyer/home` | 1 button with no accessible name; `/buyer/results` has 1 unlabelled input. | OPEN |
| P3-g | `/buyer/results` | No `<footer>` landmark (home has one). | OPEN |
| P3-h | Lint | 20 warnings, 0 errors. 2 are real (`BoutiqueProfile.tsx:67,74` missing `ab` dependency); the rest are `react-refresh/only-export-components`. | OPEN |
| P3-i | `api/place-order.js` | `qty: -5` still clamps to 1 rather than returning 400. | OPEN (carried) |

---

## 5. Security issues

**44 of 47 probes passed.** Every probe asserted that an unauthorised action is *refused*; the three failures are read exposures, not write holes.

| Boundary | Probes | Result |
|---|---:|---|
| Anon reads of private tables (`profiles`, `orders`, `order_items`, `payouts`, `admin_activity_log`, `payment_events`, `messages`, `conversations`, `cart_items`, `notifications`) | 10 | ✅ all return 0 rows |
| Anon reads of public tables (`products`, `boutiques`, `reviews`, `taxonomy`, `ad_placements`) | 5 | ✅ readable, storefront intact |
| Sensitive columns (bank/GST/UPI on `boutiques`) | 3 | ✅ refused with `42501` |
| Anon writes (insert order, re-price product, delete product, rewrite order total, change commission, mint coupon, insert review/message/notification/payout/ad, self-promote to admin, approve own boutique, edit ad rate card) | 14 | ✅ all refused |
| Anon RPC abuse (`redeem_coupon`, `create_offline_sale`, `expire_and_activate_ads`, `open_auto_payout`, `mark_auto_payout_paid`, `activate_ad_campaign`) | 6 | ✅ `42501 permission denied` / `P0001 not authorized` |
| Storage: anon upload to all 5 buckets | 5 | ✅ refused by RLS |
| **Anon reads of `coupons`, `platform_settings`, `ad_campaigns`** | 3 | ⚠️ **readable** — see P2-C, P2-D |

**Endpoint hardening, separately verified against the running API:**

| Probe | Result |
|---|---|
| `POST /api/place-order` empty cart | `400 Cart is empty` |
| Prepaid with no payment object | `400 Payment is required to place an order` |
| Prepaid with **forged signature** | `400 Payment could not be verified` |
| COD with junk name/phone/address/pincode | `400` with the specific requirement message |
| **SQL injection** in `guest.name` (`Robert'); DROP TABLE orders;--`) | `400` — rejected by validation; PostgREST parameterises regardless |
| Non-existent product id | `400 None of the cart items are still available` |
| **Rate limiting** — 30 rapid calls to `/api/place-order` | `400 ×20` then **`429 ×10`** ✅ |
| **Rate limiting** — 25 rapid calls to `/api/create-order` | `400 ×20` then **`429 ×5`** ✅ |

**XSS:** `dangerouslySetInnerHTML` and `innerHTML =` appear **nowhere** in `src/`. All rendering goes through React's escaping. (`purify.es` in the bundle is a jsPDF dependency, not app code.)

**Investigated and cleared — not a vulnerability.** `anon RPC reserve_stock` *executed* rather than returning `permission denied`, which initially looked like an anonymous inventory-drain. It is not: `reserve_stock` is **not** `SECURITY DEFINER`, so its `UPDATE products` runs as the caller, RLS matches zero rows, and `IF NOT FOUND` raises `INSUFFICIENT_STOCK`. Anonymous callers cannot decrement stock. Worth noting only because a **permission failure is reported to the buyer as "sold out"** — if the products RLS ever changed, checkout would misdiagnose itself.

**Top security risks, in order:** (1) the `LANCHOFF` coupon — financial, live, and public; (2) unrestricted public storage buckets; (3) prod == test; (4) the service-role key that passed through a chat transcript in the previous session and **still wants rotating**.

---

## 6. Performance issues

Bundle analysis from a real production build (`npm run build`, clean, 16.25s):

| Chunk | Raw | Gzip | Note |
|---|---:|---:|---|
| `index-BXJTGqU7.js` | 505.6 kB | **123.8 kB** | Entry chunk — the one number to watch |
| `jspdf.es.min` | 390.5 kB | 128.8 kB | ✅ lazy (`await import` in `src/lib/billImage.ts:19`) |
| `supabase` | 214.8 kB | 55.6 kB | |
| `html2canvas.esm` | 201.4 kB | 48.0 kB | ✅ lazy (`billImage.ts:5`) |
| `react-vendor` | 163.3 kB | 53.3 kB | |
| ~40 route chunks | 7–30 kB each | 2–9 kB | ✅ route splitting works |

- **Good:** the two heavyweight libraries are genuinely dynamically imported, so a buyer never downloads jsPDF; route splitting is real and granular.
- **Issue:** the 505 kB / 124 kB-gzip entry chunk is large for a storefront whose routes are already split — worth a `rollup-plugin-visualizer` pass to find what is being pulled in eagerly.
- **Not measured:** LCP/CLS/FID. The dev server reports `LCP 0ms` and `transferSize 0` for module scripts, so **local dev numbers are meaningless** and I have not quoted them as results. Measure against `npm run preview` or the deployed site with Lighthouse.
- Carried from the previous pass: `/api/geo` is called repeatedly per navigation and should be cached per session.

---

## 7. UI problems

- The **maintenance banner + rotating joke card renders on every buyer page**, including the product page and the cart — the two screens where trust matters most (P0-D).
- Carried: the "Launching soon" card overlaps the "Shop by collection" heading.
- **Zero horizontal overflow** at 375/393/412/768/1024/1440/1920 across six pages — genuinely good, no regression.
- **Zero broken images** (35 on home, all load).

## 8. UX problems

- No 404 page (P2-F) — mistyped URLs silently become the homepage.
- Signed-out seller deep links land nowhere useful (P2-G).
- 29 sub-32px tap targets on mobile home (P3-a).
- Carried and still open: search state is lost on refresh (not URL-addressable).
- **P2-5 could not be reproduced this pass.** Direct navigation to `/buyer/checkout` with a populated bag stayed on `/buyer/checkout`; with an empty bag it correctly redirected to `/buyer/cart`. The previous report saw it for a *signed-in* buyer, where the cart hydrates from the database — so the race is likely specific to DB-backed hydration, not the anonymous localStorage cart I tested. **Treat as unconfirmed, not fixed.**

## 9. Database issues

- P2-A / P2-B: `create_offline_sale` discount and bill-number collisions (fixed in migration 0052, **not yet applied**).
- P2-H: `delivered_at` set on rejected orders; 5 NULL `payment_method`.
- P3-d: CRLF in a slug; 12 NULL slugs.
- **Verified healthy:** 0 orders with no items; 27/27 online order totals reconcile exactly against `sum(items) − discount`; 0 negative stock; 0 products priced ≤ 0; 0 ownerless boutiques; 0 profiles missing an email; 0 out-of-range review ratings; RLS enabled and behaviourally correct on all 10 private tables.
- `boutique_private`, `refunds`, `returns`, `wishlist_items`, `follows`, `product_engagement`, `broadcasts` are **not present** in the schema cache — those features store their data elsewhere (e.g. `product_likes`, `boutique_followers`). Worth confirming the returns/refunds console is reading a real table before launch, since that lifecycle remains untested.

## 10. Backend issues

P1-A (payouts verification), P1-D (coupon unwind) — both fixed. P1-C (inert crons), P1-E (webhook secret) — environment. Rate limiting falls back to a **per-instance in-memory** limiter because no Upstash credentials are configured; on Vercel that means the effective global limit is `20 × (number of warm instances)`. It worked in test because one instance served every request. Configure `UPSTASH_REDIS_REST_URL`/`_TOKEN` for a true global limit.

## 11. Frontend issues

Zero console errors, zero page errors, zero failed requests across **37 routes**. Lint: 0 errors, 20 warnings. All `setInterval`/`addEventListener` usages in `PresenceTracker`, `LivePresence`, `Home` and `liveRefresh` have matching cleanup — **no memory leaks found**. `tsc -b` clean before and after my changes.

## 12. Deployment issues

Prod == test (P0-C); no `CRON_SECRET` so **both** scheduled jobs are inert (P1-C); no `RAZORPAY_WEBHOOK_SECRET` locally (P1-E); no Upstash credentials; `RESEND_API_KEY` still empty so **no transactional email can send**; local Node 20 vs pinned 24 (P2-I).

## 13–15. Code / architecture / scalability improvements

1. **Delete the dead `fetchOverviewMetrics`/`fetchGmvBars`** — they encode a *wrong* GMV definition and are a trap.
2. **One revenue definition.** `isEarned()` in `admin.ts` and `earned()` in seller `Dashboard.tsx` still disagree on uncollected COD (carried P2-6 — still needs your ruling).
3. **Make invalid commercial configuration impossible**, not just correctable: a `check` constraint such as `off <= 50 or max_discount is not null` on `coupons` would have prevented P0-A outright, and a non-zero-rate guard in `_adPricing.js` would have prevented P1-B.
4. **Make cron auth failures loud.** Both schedulers currently answer `200 {skipped}` when unconfigured, which is indistinguishable from success — that is why P1-C went unnoticed for six days. Return `503` when a cron is scheduled but unconfigured, and surface it in `/api/health`.
5. **Paginate `/admin/orders`** and index `orders(boutique_id, created_at desc)` before order volume grows.
6. Analyse and shrink the 505 kB entry chunk.

## 16. Production readiness score

# **58 / 100**

Application logic and security score in the high 80s–90s and are genuinely
launch-grade. The score is held down almost entirely by **commercial
configuration**: a coupon that loses money on every use, an ads product that
cannot take money, dead payment credentials, and two schedulers that do nothing.

## 17. Launch recommendation

🔴 **Do not launch today. Every blocker is hours of work, none is a rewrite.**

**Before anything else — today:**
1. **Cap or disable `LANCHOFF`** (P0-A). One `UPDATE`.
2. **Turn off maintenance mode and remove the joke overlay** (P0-D).
3. **Issue working Razorpay keys**; confirm `/api/health` → `checkoutReady: true` (P0-B).
4. **Rotate the service-role key** (carried from the previous pass).

**Before taking real orders:**
5. Apply **migration 0052** (P2-A/B).
6. Set **`CRON_SECRET`** and verify both crons return `{"ok":true}` (P1-C).
7. Verify **`RAZORPAY_WEBHOOK_SECRET`** in every environment (P1-E).
8. Set the **ad rate card** to real prices and enable the placements (P1-B).
9. Set **storage bucket size limits and MIME allowlists** (P2-E).
10. Create the **separate test Supabase project** (P0-C).

## 18. Fixes applied in this pass

| File | Change | Verified |
|---|---|---|
| `api/run-payouts.js` | Added `payout_verification_status` + `razorpayx_validation_id` to `BOUTIQUE_COLS`, restoring the penny-drop polling branch (P1-A). | `node --check` ✅, eslint clean ✅ |
| `api/place-order.js` | The coupon-limit `409` now releases the stock reservation and refunds a captured prepaid payment before returning (P1-D). | `node --check` ✅, endpoint re-probed, no regression ✅ |
| `supabase/migrations/0052_offline_sale_discount.sql` | **New.** `create_offline_sale` now records the discount and retries on bill-number collision; repairs the 4 existing mismatched orders (P2-A, P2-B). | **NOT YET APPLIED — needs running in the Supabase SQL editor** |

`tsc -b` clean, `eslint` 0 errors, and the six `/api/place-order` validation
probes re-run identically after the edits.

**Not changed, deliberately:** every item touching production data or commercial
policy — the coupon, the ad rate card, maintenance mode, the QA artifacts from
the previous pass, and the ~58 files being edited concurrently by another session.

---

## Coverage — what this pass did NOT test

Stated plainly. **Prepaid checkout end-to-end** (Razorpay credentials are dead —
unchanged blocker). **The returns/refunds lifecycle** — no `returns`/`refunds`
table is visible in the schema cache, so this needs a design answer before it can
be tested. **Buyer↔seller messaging round trip** (68 messages and 19
conversations exist; RLS on both verified, the exchange itself not driven).
**Payout execution** — RazorpayX is not configured, so no transfer could be
attempted. **Admin write actions** — I performed none, to avoid mutating
production. **Email delivery** — `RESEND_API_KEY` is empty. **Lighthouse / Core
Web Vitals** — not measurable against a dev server; needs a run against
`preview` or production.

Everything reported above as a result was executed and observed. Items that could
not be executed are marked BLOCKED, OPEN, or MANUAL ACTION REQUIRED with the
reason.

---

## Addendum — the COD consequence of platform coupons (migration 0053)

While this pass was running, a parallel session shipped
`supabase/migrations/0053_platform_discount.sql`, which independently found the
**operational half of P0-A**. It is worth stating here because it changes who
gets hurt.

Migration 0036 deliberately keeps a platform coupon out of `orders.total`, so
that the seller's payout is computed on the full goods value — that part is
correct, and my P0-A analysis relied on it. What it never did was record the
discount *anywhere else*. Nothing downstream therefore knew the buyer owed less
than `total + shipping_fee + cod_fee`.

- **On a prepaid order this was invisible** — Razorpay had already taken the
  correct, discounted amount.
- **On Cash on Delivery it is real money.** The buyer is quoted the discounted
  total at checkout and then asked for the undiscounted one at the door. The
  migration cites a live example: `AGL-AHA91R1B58`, quoted **₹228** at checkout,
  recorded as **₹1,127** on the order — **₹899 too much.**

Applied to `LANCHOFF`, this is the worst-case version of P0-A: a COD buyer sees
**₹229** at checkout and the delivery person asks for **₹1,578**. That is not a
margin problem, it is an argument on a customer's doorstep and a refused
delivery — and it lands on the seller, who is holding the goods.

**This strengthens, rather than replaces, the P0-A recommendation.** Capping the
coupon bounds the size of the discrepancy; migration 0053's `platform_discount`
column is what makes the two figures agree at all. Both are needed:

- `_apply_qa_pass2.sql` §2 caps the coupon → the gap can never exceed ₹300.
- `0053_platform_discount.sql` records the discount → the gap becomes zero.

**Apply 0053 as well as 0052.** Note that the parallel session is still editing
`api/_pricing.js` and `api/place-order.js` to consume the new column, so confirm
that work is complete before deploying — a migration that adds
`platform_discount` without the server-side code to populate it leaves COD
quoting exactly as wrong as it is today.
