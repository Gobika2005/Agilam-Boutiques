# QA Test Artifacts — run of 2026-08-01

Everything this QA run created or changed in the database, so it can be reviewed
and cleaned up deliberately. **Nothing here has been deleted.**

> ⚠️ **These rows are live on the public site.** The deployed production app at
> `agilam-boutiques.vercel.app` reads the *same* Supabase project
> (`mtxmuaskmyhnqczctwlp`) that this run wrote to — see P0-1 in the QA report.
> So every artifact below is visible to real visitors right now.

No credentials appear in this file.

---

## 1. Accounts created

| Artifact | Identifier | Notes |
|---|---|---|
| QA buyer account | `qa.buyer.mangaimart+aug01@gmail.com` — uid `b5392947-83ec-45b2-9797-2a25949a6fde` | Created via the app's own signup, then email-confirmed through the Supabase admin API (confirmations are ON and the inbox was unreachable). Role `buyer`, auto-created by the migration-0030 trigger. Password held outside the repo. |

## 1b. New-seller journey artifacts — ⚠️ **LIVE AND PUBLIC**

The new-seller test required creating a boutique and taking it all the way
through admin approval. **It is now approved, verified and publicly visible** on
`agilam-boutiques.vercel.app`: the buyer directory went 9 → 10 boutiques and the
catalogue 17 → 18 pieces. A fake boutique is currently listed among your real
ones. **This is the artifact to clean up first.**

| Artifact | Identifier | State |
|---|---|---|
| QA seller account | `qa.seller.mangaimart+aug01@gmail.com` — uid `59d540a5-ee84-4887-903c-dfe505a218b7` | role `seller`, email confirmed via the admin API |
| QA boutique | "QA Boutique — DELETE AFTER TEST" — `9bb47d6c-2511-4dae-b339-1ed06a62260e` | **`approved`, `verified: true`** — publicly listed |
| QA product | "QA TEST PRODUCT — DELETE AFTER TEST" — `84cf1002-6756-42fb-800d-c4c1090c5e7c` | `active`, ₹1,499 (MRP ₹1,999), stock 7 — **live in the catalogue and purchasable** |
| Storage objects | 3 images in the `boutique-images` / product buckets (logo, cover, product photo) | uploaded by the wizard and product form |

Suggested reversal, least destructive first: set the boutique's status back to
`rejected` (migration 0038's cascade then auto-hides its product), or delete the
product → boutique → account outright. Say which and I'll do it.

## 2. Orders created

All three are **COD, unpaid**, against **Studio Mahil** (the seller test boutique).

| Order number | Row id | Amount | State | Why it exists |
|---|---|---|---|---|
| `AGL-9B69O3F86D` | `faff02ae-f79b-4de3-b8d5-0ac800e1447d` | ₹1,899 + ₹79 + ₹49 = **₹2,027** | `accepted` / payment `pending` | The main end-to-end journey order. Placed through the real UI, then accepted by the seller through the real seller console. |
| `AGL-9BKP7N87A8` | `720804fb-bee6-472c-b3b4-7401250fb7ec` | ₹1,500 + ₹79 + ₹49 = ₹1,628 | `pending` / `pending` | Side effect of the negative-quantity abuse probe (P3-1). The server clamped `qty: -5` to 1 and wrote a real order. |
| `AGL-9BKRCW3C38` | `6f935cea-1763-4390-b286-48cbbe131616` | ₹1,500 + ₹79 + ₹49 = ₹1,628 | `pending` / `pending` | Side effect of the invalid-coupon probe — confirmed the bogus code priced as a ₹0 discount. |

Each generated one seller notification (3 rows in `notifications`).

## 3. Inventory changed by those orders

| Product | Before | After | Cause |
|---|---|---|---|
| Sunshine Floral Cotton Kurta Set with Dupatta (`92f2e765…`) | stock 5, sold_count 0 | **stock 4, sold_count 1** | Journey order; `sold_count` incremented correctly when the seller accepted. |
| Indigo Floral Co-Ord Set (`9b3a7083…`) | stock 2 | **stock 0** | The two abuse-probe orders consumed both units. **This product now reads "sold out" to real buyers.** |

`boutiques.units_sold` for Studio Mahil went 0 → 1 (correct, on accept).

## 4. Buyer collections

| Artifact | Detail |
|---|---|
| Wishlist entry | "Midnight Black Cotton Kurta Set" saved to the QA buyer's wishlist (used to verify cross-reload persistence). |
| Cart | Emptied by checkout; no residual cart rows. |

## 5. Not created

For the record, this run did **not** create: QA Inspire posts, QA coupons, QA ad
campaigns, QA broadcasts, or QA refunds/payouts. No **existing** seller or admin
account was modified or deleted. No real payment, refund or payout was executed.

## 5b. Admin action taken

One admin action was performed, as part of testing the approval flow: the QA
boutique was **approved** through `/admin/approvals`. This wrote
`status=approved`, `verified=true`, `reviewed_at` on that boutique and one row in
`admin_activity_log`. No other boutique was touched.

## 6. Code and config changes (not data)

| File | Change |
|---|---|
| `.env` | `SUPABASE_SERVICE_ROLE_KEY` populated (gitignored). **The key was pasted into the tracked `.env.example`; it was moved to `.env` and the template's placeholder restored before any commit, so it never entered git history. Rotating it is still recommended.** |
| `src/pages/seller/Dashboard.tsx` | Fixed "Cash to collect" (P1-2). |
| `src/lib/orderHistory.ts`, `src/pages/buyer/TrackOrder.tsx` | Fixed buyer order deep-link by uuid (P1-1). |
| `src/data/admin.ts` | Cancelled orders excluded from GMV/revenue/commission (P2-1). |
| `api/health.js` | Health check now really authenticates against Razorpay (P2-2). |
| `src/state/CatalogContext.tsx` | Buyer-facing "Since &lt;year&gt;" now uses the same fallback chain as the seller console (P2-8). |
| `vite.config.ts` | `/api/health` and `/api/geo` added to the dev route table (P2-3). |
| `REAL_WORLD_TEST_PLAN.md`, `QA_TEST_ARTIFACTS.md`, `MANGAIMART_FULL_QA_REPORT.md` | New documents. |

---

## Cleanup — awaiting your decision

**I have not deleted anything.** Please tell me which of these you want removed:

1. **The QA boutique + product** (§1b) — **most urgent**: they are approved and
   publicly listed on the live site right now.
2. **Restore stock** — `Indigo Floral Co-Ord Set` back to 2 (it is currently 0
   and therefore sold-out to real buyers). **I would do this regardless**, since
   it suppresses a genuine seller's product.
3. **The three QA orders** — deleting them changes seller order history, the
   admin GMV/revenue tiles and `sold_count`/`units_sold` counters. Cancelling
   them through the UI instead is the reversible route, but leaves them visible
   as cancelled orders.
4. **The QA buyer and QA seller accounts** — safe to delete once their orders and
   boutique are dealt with.
5. **The wishlist entry and uploaded Storage images** — trivial, QA-owned only.

Because production and test share one database, treat all four as production
data changes.
