# MangaiMart — Real-World End-to-End Test Plan

**Prepared:** 2026-08-01
**Tester role:** Production QA / full-stack / security / DB / UX
**Nature:** Live application testing (real UI → real API → real Supabase), not a code review.

> No credentials appear in this document or in any file produced by this run.

---

## 1. System under test

**MangaiMart** — a women's boutique marketplace for Tamil Nadu ethnic wear. One
React SPA serving three audiences from one codebase and one database.

| Layer | Technology |
|---|---|
| Frontend | Vite 5 + React 18 + React Router 6, Tailwind + inline styles over a `--ag-*` token layer |
| Backend | Vercel serverless functions in `/api` (18 handlers) |
| Database | Supabase Postgres, 51 migrations, RLS-enforced |
| Auth | Supabase Auth — email+password, email OTP, Google OAuth |
| Storage | Supabase Storage (product images, boutique branding, review photos) |
| Payments | Razorpay (prepaid) + Cash on Delivery |
| Payouts | Manual admin console + automatic RazorpayX transfer on delivery |
| Realtime | Supabase Realtime (chat, admin live presence) |
| Cron | Vercel crons — `/api/run-payouts` daily 02:00, `/api/ads?action=lifecycle` daily 00:15 |

### Environments

| | Production | Test / staging |
|---|---|---|
| Branch | `main` | `staging` |
| Supabase | prod project | separate test project |
| Razorpay | live keys | test keys |

**This run targets the test/dev environment** (confirmed safe for writes by the
project owner): local dev server on `http://localhost:5173`, Supabase project
`mtxmuaskmyhnqczctwlp`, Razorpay in `rzp_test_` mode. A deployed-URL smoke pass
follows the local pass.

### Route map

| Surface | Routes |
|---|---|
| Public / buyer | `/`, `/buyer/home`, `results`, `filter`, `sort`, `boutiques`, `collections`, `new-arrivals`, `best-sellers`, `top-boutiques`, `inspire`, `boutique/:id`, `product/:id`, `wishlist`, `cart`, `checkout`, `payment`, `order-confirmation`, `orders`, `orders/:id`, `coupons`, `notifications`, `messages`, `chat/:id`, `profile`, `policy/:slug`, `/b/:slug` |
| Auth | `/auth/signin/:role`, `/auth/signup/:role`, `/auth/otp/:role`, `/auth/callback`, `/auth/reset-password` |
| Seller (gated) | `/seller/` dashboard, add-product, products, products/:id, reviews, search, orders, orders/:id, customers, billing, notifications, messages, chat/:id, earnings, analytics, promote, coupons, boutique, profile, settings, help, verification; plus `/seller/register` + `/seller/onboarding` wizard |
| Admin (gated) | `/admin/login`, `/admin/` overview, approvals, catalogue, boutiques, users, products, orders, reports, payments, ads, coupons, notifications, customers, refunds, reviews, broadcast, audit, settings |

### API surface

`create-order`, `place-order`, `verify-payment`, `razorpay-webhook`,
`razorpayx-webhook`, `run-payouts`, `ads`, `admin-create-user`,
`admin-delete-user`, `admin-list-users`, `geo`, `health`
(+ helpers `_pricing`, `_settings`, `_supabase`, `_rateLimit`, `_razorpayx`, `_adPricing`, `_ads`).

### Intended marketplace lifecycle

```
seller signs up → 7-step onboarding wizard → admin approves boutique
   → seller lists products → products visible to buyers
buyer browses (no login needed) → cart → checkout → COD or Razorpay prepaid
   → order rows written per boutique → seller sees order → status transitions
   → delivery → 10% platform commission → seller payout (manual or RazorpayX)
   → admin reconciles
```

**Order status vocabulary actually implemented** (`src/types/database.ts`):
`pending → accepted → shipped → delivered`, plus terminal `rejected` /
`cancelled`. There is **no** Preparing / Packed / Ready-for-Pickup state —
tests assert against the six implemented states.

**Payment status is separate from order status** (migration 0022) so a COD
order can be `delivered` + `paid` independently.

### Money rules to verify

- Platform commission **10%**, deducted at payout.
- COD fee **per delivery** (per boutique order); COD **cart cap**; delivery fee flat, once per cart, free over a threshold — all admin-editable via `platform_settings`.
- Platform coupons are platform-funded (not allocated to any boutique order); seller coupons are seller-funded (netted off that boutique's `order.total`).
- `api/_pricing.js` and `src/lib/pricing.ts` **must agree to the rupee** — `place-order` re-derives the amount and rejects mismatches.

---

## 2. Test accounts

Three roles, held as temporary secrets outside the repo. `RequireRole` permits
exactly **one role per account**, so each role needs its own login.

| Role | Provenance | Status |
|---|---|---|
| Admin | supplied | verified `role = admin` |
| Seller | supplied | verified `role = seller`, owns approved boutique |
| Buyer | **created by this QA run** via the app's own signup | tracked in `QA_TEST_ARTIFACTS.md` |

Credential-handling rules for this run: never printed in reports, never
committed, never written to source or to any `*.example` env file, never
captured in a screenshot.

---

## 3. Phase schedule

| # | Phase | Method |
|---|---|---|
| 1 | System understanding | repo + schema audit, role verification |
| 2 | Health check | headless Chromium; console, network, storage, HTTP≥400 collectors |
| 3 | First-time visitor | signed-out walkthrough of every entry surface |
| 4 | Responsive | 1920×1080, 1440×900, 1366×768, tablet, iPhone, Android; portrait + landscape; horizontal-overflow detector |
| 5 | Buyer auth | signup, login, session persistence, logout, re-login, protected routes, back-nav |
| 6–8 | Home, search, filters | click every CTA; realistic + adversarial queries; filter combinations verified against rendered results |
| 9–12 | PDP, boutique, Inspire, wishlist | data cross-checked against DB rows; engagement persistence across refresh |
| 13–17 | Cart → checkout → order | cart arithmetic, COD order, Razorpay **test-mode** payment, order history |
| 18–26 | Seller console | dashboard figures vs DB, product CRUD, inventory/overselling, order transitions, chat, finance |
| 27–35 | Admin console | metrics vs DB, user/seller/product/order management, refunds, payouts, notifications |
| 36 | DB validation | every write cross-checked for correct FK ownership, amounts, stock, timestamps |
| 37 | RLS / isolation | **safe, non-destructive** cross-tenant read/write attempts as seller, buyer and anon |
| 38–44 | UX, visual, perf, a11y, errors, dead controls, cross-role consistency | manual audit + instrumented checks |

## 4. Cross-role consistency matrix (the point of the whole run)

Every material action is verified in **all** the places it should appear:

| Action | Buyer | Seller | Admin | DB |
|---|---|---|---|---|
| Order placed | confirmation + order history | order inbox | orders table | `orders` + `order_items` rows, correct `buyer_id` / `boutique_id` |
| Status changed | tracking timeline | order detail | admin order view | status + per-milestone timestamp |
| Stock changed | availability on PDP | inventory | product record | `products.stock` |
| Product created | visible only when approved | my products | approvals queue | `products` row |
| Boutique rejected | products disappear | notice | boutique record | `products.auto_hidden` |
| Coupon redeemed | discount on total | order total net of seller-funded discount | coupon usage | `coupons.used_count` |

## 5. Safety rules for this run

**Permitted:** QA products, QA orders, QA Inspire content, status transitions,
Razorpay **test-mode** payments, safe RLS probes, reversible admin actions.

**Requires the owner's explicit approval first:** any real-money payment,
refund or payout; deleting customer/order/seller data; dropping tables or
columns; resetting the database; changing live credentials or production
secrets; bulk destructive operations; financial architecture changes.

**Security probes are read/permission-boundary tests only** — confirming a
cross-tenant request is *refused*. No destructive exploitation, no data
exfiltration, no attacks on other tenants' data.

Every artifact created is logged in `QA_TEST_ARTIFACTS.md`; nothing is deleted
without asking first.

## 6. Evidence standard

A test is reported only in one of these states:

- **PASS** — executed and observed to behave correctly
- **FAIL** — executed, with route, steps, expected, actual, console/network evidence, DB row, root cause
- **PARTIAL** — works with defects
- **BLOCKED — reason** — could not run
- **NOT TESTED — reason** — out of reach in this environment
- **MANUAL ACTION REQUIRED** — needs owner-only configuration

"Tested successfully" is never written for anything not actually executed.
A fix is marked **FIXED** only after the original reproduction is re-run and
observed to pass.

## 7. Deliverables

- `REAL_WORLD_TEST_PLAN.md` (this file)
- `QA_TEST_ARTIFACTS.md` — every artifact created, with cleanup status
- `MANGAIMART_FULL_QA_REPORT.md` — executive summary, scores, P0–P3 issues with
  reproductions and fixes, feature matrix, end-to-end journey verdict,
  recommendations, launch classification
