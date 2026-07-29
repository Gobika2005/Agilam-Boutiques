# MangaiMart — Admin Control Center Gap Analysis

_Generated 2026-07-29. Scope: audit of the existing admin panel + Supabase schema against the 36-phase Marketplace Control Center brief, with a per-requirement A–G classification._

## Classification key

| Code | Meaning |
|------|---------|
| **A** | Exists and works |
| **B** | Exists but needs UI |
| **C** | Exists but backend incomplete |
| **D** | Exists but DB needs extension |
| **E** | Completely missing |
| **F** | Duplicate / unnecessary |
| **G** | Security / architecture problem |

---

## 1. Repository architecture (discovery)

| Concern | Finding |
|---------|---------|
| Framework | React 18 + TypeScript + Vite 5, React Router 6. No Next.js / server framework. |
| Routing | Single `src/App.tsx`. Buyer routes public; `/seller` and `/admin` gated by `RequireRole`. Admin console lazy-split per route. |
| Supabase client | One browser client `src/lib/supabase.ts`. **No server-side / service-role client in the repo** — all admin writes go through the browser client under RLS. |
| Auth / roles | `AuthContext` + `profiles.role` (`buyer`/`seller`/`admin`). RLS `is_admin()` helper (migration 0006/0010) is the server-side gate. |
| Payments | Razorpay (`razorpay` npm dep) — order placement/webhook logic referenced in migrations 0014/0015; **no serverless functions in this repo** (they live in a separate API surface, per memory `service-role-key-silent-failure`). |
| Payouts | Manual admin Payouts console + `settle_boutique_payout` RPC (0025) + auto RazorpayX transfer (0026/0027). |
| Storage | Supabase Storage buckets for product/review images (0016/0017/0041). |
| Migrations | 48 SQL files `supabase/migrations/0001–0048`, applied manually in the Supabase SQL editor. |
| Audit log | `admin_activity_log` table (0006) + `src/data/activityLog.ts` (`logAdminAction`, `fetchActivity`). |

**Architecture note (G-class, pre-existing):** every admin mutation runs from the browser under RLS `is_admin()`. This is acceptable for the current feature set because RLS enforces authorization server-side, but any future admin feature that needs to bypass per-owner RLS must use a `SECURITY DEFINER` RPC (the pattern already used by `broadcast_notification`, `settle_boutique_payout`, etc.) — never a service-role key in frontend code.

---

## 2. Existing admin inventory

| Admin feature | UI | Backend | DB source | Status |
|---------------|----|---------|-----------|--------|
| Overview / dashboard | `Overview.tsx` | `data/admin.ts fetchDashboard` | `orders`, `order_items`, `profiles`, `boutiques`, `products` | **A** |
| Boutique approvals / KYC | `Approvals.tsx` | `data/admin.ts`, `boutique_private` RPC | `boutiques` | **A** |
| Catalogue vocabulary | `Catalogue.tsx` | `data/taxonomy.ts` | `taxonomy` (0024) | **A** |
| Boutiques table | `BoutiquesTable.tsx` | `data/boutiques.ts` | `boutiques` | **A** |
| Users (buyers/sellers) | `Users.tsx` | `data/adminUsers.ts` | `profiles` | **A** |
| Products moderation | `ProductsAdmin.tsx` | `data/adminProducts.ts` | `products` | **A** |
| Orders control | `OrdersAdmin.tsx` | `data/orders.ts` | `orders`, `order_items` | **A** |
| Reports | `Reports.tsx` | `data/admin.ts` | aggregates | **A** |
| Seller payouts | `Payments.tsx` | `data/payouts.ts`, `settle_boutique_payout` | `payouts` (0025) | **A** |
| Advertisements | `Ads.tsx` | `data/ads.ts` + admin RPCs | `ad_campaigns` (0032) | **A** |
| Coupons | `Coupons.tsx` | `data/coupons.ts` | `coupons` (0036) | **A** |
| Notifications feed | `Notifications.tsx` | `data/notifications.ts` | `notifications` (0044) | **A** |
| Live presence | `LivePresence.tsx` | Realtime channel | (ephemeral) | **A** |

### In-progress work (uncommitted before this session)

| Admin feature | UI | Backend | DB source | Status on arrival | After this session |
|---------------|----|---------|-----------|-------------------|--------------------|
| Customer 360° list | `Customers.tsx` | `data/orders.ts fetchCustomersAdmin` | `orders`+`profiles` | built, **unrouted, build-breaking** | **A** (routed) |
| Refunds workbench | `Refunds.tsx` | `data/admin.ts fetchRefunds/setOrderRefunded` | `orders.refunded` (0006) | built, unrouted | **A** |
| Reviews moderation | `ReviewsAdmin.tsx` | `data/adminReviews.ts` | `reviews.hidden` (0048) | built, **type errors** | **A** |
| Broadcast composer | `Broadcast.tsx` | `data/broadcast.ts` → `broadcast_notification` RPC (0048) | `notifications` | built, **RPC CHECK bug** | **A** |
| Audit trail | `Audit.tsx` | `data/activityLog.ts fetchActivity` | `admin_activity_log` (0006) | built, unrouted | **A** |
| Platform settings | `Settings.tsx` | `data/settings.ts` | `platform_settings` (0048) | built, **type errors** | **A** |

**Orphan file (F):** `src/pages/admin/CustomersAdmin.tsx` is committed but not imported/routed anywhere — superseded by the new `Customers.tsx`. Recommend deletion in a follow-up.

---

## 3. Requirement gap analysis (36-phase brief)

| Phase | Requirement | Class | Notes |
|-------|-------------|-------|-------|
| 4 | Command Center dashboard | **A** | `fetchDashboard` already computes GMV, revenue, order windows, top boutiques/products, low stock, payment split. |
| — | Action Required Center | **E** | No unified attention queue. Pieces exist (pending approvals, low stock, refund candidates) but not aggregated. |
| 5 | Buyer 360° | **B/C** | List + lifetime spend/AOV shipped (`Customers.tsx`). Per-buyer drill-down (addresses, wishlist, tickets, block/suspend) still missing. |
| 6 | Boutique/Seller 360° | **B** | Approvals + Boutiques tables exist; a single consolidated seller health/earnings/actions view does not. |
| 7 | Seller verification states | **A** | `boutiques.status` + `boutique_private` RPC cover KYC metadata & document notes. |
| 8 | Product control center | **A** | `ProductsAdmin` supports approve/hide/reject/feature via `products.status` — no redundant approval table needed. |
| 9 | Category/collection mgmt | **A** | `taxonomy` (0024) admin-managed, reflected buyer/seller side. |
| 10 | Order control center | **A** | `OrdersAdmin` respects the existing status state-machine. |
| — | Multi-boutique orders | **A (already)** | Architecture already splits one checkout into per-boutique `orders` rows (see `orders` type comments). Independent fulfillment/settlement already modeled. **No schema rewrite required.** |
| 11 | Payment control | **B** | `Payments.tsx` shows settlement view; a raw payment-event ledger view (`payment_events`, 0015) is not surfaced. |
| 12 | Commission engine | **C/D** | Global rate from `platform_settings.commission_pct` (0048). **Per-order historical rate is NOT snapshotted** — reports recompute with the current rate. Needs `orders.commission_pct` column to be correct historically. |
| 13 | Settlement/payout center | **A** | Manual + auto payouts (0025–0027). |
| 14 | Immutable seller ledger | **E** | No append-only ledger; payouts recompute from orders. Acceptable now, required before scale. |
| 15 | Returns/refunds | **B/C** | Refund _flag_ workbench shipped (`Refunds.tsx`). No structured return-request lifecycle table. |
| 18 | Inspire admin moderation | **E** | Inspire feed is built from the product catalogue; no separate moderation surface. |
| 19 | Homepage CMS | **E** | Home rails are code/ranking-driven, not admin-editable. |
| 20 | Coupons & promotions | **A** | `coupons` (0036). |
| 21 | Advertisement mgmt | **A** | `ad_campaigns` (0032). |
| 22 | Search insights | **E** | No search-event capture. |
| 23 | Reviews moderation | **A** | `ReviewsAdmin.tsx` + `reviews.hidden` (0048); buyer/seller reads now filter hidden. |
| 24 | Support center | **E** | No ticketing tables. Chat exists buyer↔seller only. |
| 25 | Notifications / broadcast | **A** | `Broadcast.tsx` + `broadcast_notification` RPC (0048). In-app only (no email/SMS/push provider wired — do not fake). |
| 26 | Analytics | **A/B** | Dashboard + Reports cover sales/customer/seller basics. |
| 27 | Seller health score | **E** | Data exists (cancellation/return rates) but no score computed. |
| 28 | Risk center | **E** | No rule engine. |
| 29 | Finance/reports + CSV export | **B** | Reports view exists; CSV export not implemented. |
| 30 | Admin RBAC (granular roles) | **C/G** | Single `admin` role only. No sub-roles/permissions. Server-side gate is binary `is_admin()`. |
| 31 | Audit log | **A** | `admin_activity_log` (0006) + `Audit.tsx`. Now wired into settings/refund/review/broadcast actions. |
| 32 | System health | **E** | No status page (health endpoint lives in the external API per memory). |
| 33 | Webhook/job monitor | **E** | `payment_events` (0015) exists but no monitor UI. |
| 34 | Feature flags | **C** | `platform_settings.maintenance_mode` is the only flag. No general flag table. |
| 35 | Global settings | **A** | `platform_settings` (0048) + `Settings.tsx`. |
| 36 | Emergency controls | **C** | Maintenance mode only; no COD/prepaid/registration kill-switches. |

---

## 4. Highest-value remaining gaps (recommended priority)

1. **P1 — Commission historical accuracy (Phase 12, class C/D).** Add `orders.commission_pct` snapshotted at order creation; back-compute reports from it instead of the live global rate. This is a correctness/finance risk today.
2. **P1 — Buyer/Seller 360° drill-down (Phases 5/6, class B).** Detail drawers with block/suspend/notes actions on top of the existing list views.
3. **P2 — Return-request lifecycle (Phase 15, class C).** A `return_requests` table behind the existing refund flag.
4. **P2 — Action Required Center (class E)** aggregating the signals the dashboard already queries.
5. **P3 — Granular RBAC (Phase 30, class C/G)** if multiple staff will operate the console.

Phases 18/19/22/24/27/28/32/33 are genuinely new subsystems (class E) and should each be scoped as their own project rather than bundled — several depend on capturing data that is not yet collected (search events, support tickets, health inputs).
