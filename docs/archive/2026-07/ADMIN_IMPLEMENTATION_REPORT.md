# MangaiMart — Admin Implementation Report

_Session date: 2026-07-29. Companion to `ADMIN_GAP_ANALYSIS.md`._

## 1. Executive summary

The admin console was mid-upgrade: a prior session had added migration `0048_admin_operations.sql`, three data layers (`settings.ts`, `broadcast.ts`, `adminReviews.ts`), a modified `reviews.ts`/`admin.ts`/`Overview.tsx`, and **six new admin pages** — but the work did not compile and was not reachable. This session completed the discovery/audit, **restored the build**, wired the new pages into routing and navigation, and fixed a runtime bug that would have made the Broadcast feature fail silently in production. The admin panel now builds clean (`tsc -b` and `vite build` both exit 0) and all six new surfaces are live and backed by real data. No production data was touched; no destructive operations were performed.

## 2. Existing admin audit

See `ADMIN_GAP_ANALYSIS.md §2`. 13 admin surfaces were already working (Overview, Approvals, Catalogue, Boutiques, Users, Products, Orders, Reports, Payouts, Ads, Coupons, Notifications, Live Presence), all on real Supabase data.

## 3. Existing database audit

48 migrations. Relevant confirmations: `reviews` (0014) has real FKs to `products`/`boutiques`; `admin_activity_log` (0006) backs the audit trail; `notifications` (0044) enforces `notifications_type_check IN ('Orders','Messages','Updates','Wishlist')`; `orders.refunded/refunded_at` (0006) back the refund workbench. **No duplicate tables were created.**

## 4. Features reused (not rebuilt)

`orders`, `order_items`, `profiles`, `boutiques`, `products`, `reviews`, `notifications`, `admin_activity_log`, `platform_settings`, plus the shared admin UI kit (`components/admin/kit`), `useAsync`, `AuthContext`, `ShopContext` toast, and the `logAdminAction` audit helper.

## 5. Features fixed

- **Build restored** — 8 TypeScript errors across 4 files (see §16).
- **Broadcast runtime bug** — `broadcast_notification` inserted `type='broadcast'`, which violates `notifications_type_check`; every broadcast would have failed. Changed to `type='Updates'` (an allowed, buyer-visible value).
- **Six admin pages made reachable** — added routes and sidebar/tab-bar nav entries.

## 6. Features added (now live)

Customer 360° list, Refunds workbench, Reviews moderation, Broadcast composer, Audit trail, Platform Settings — all pre-built by the prior session, now compiling, routed, navigable, and connected to real data with working actions, confirm dialogs, and audit logging.

## 7. Database tables added

None this session. (Migration `0048` — authored previously — adds `platform_settings`; edited this session to fix the broadcast type.)

## 8. Database columns added

None this session. (`reviews.hidden` comes from `0048`.)

## 9. Indexes added

None this session. (`0048` adds `idx_reviews_hidden`, `idx_reviews_created_at`.)

## 10. RPCs / functions added

None this session. (`broadcast_notification` comes from `0048`; its body was corrected here.)

## 11. RLS changes

None this session. (`0048` adds public-read/admin-write on `platform_settings` and admin read/update/delete on `reviews`.)

## 12. API changes

None. All admin operations run through the existing browser Supabase client under RLS / `SECURITY DEFINER` RPCs. No new server endpoints.

## 13. Admin routes added

`/admin/customers`, `/admin/refunds`, `/admin/reviews`, `/admin/broadcast`, `/admin/audit`, `/admin/settings` (in `src/App.tsx`), plus matching entries in `src/components/layout/AdminLayout.tsx` `NAV`.

## 14. Security improvements

- Broadcast fan-out stays behind the `is_admin()` re-check inside the `SECURITY DEFINER` RPC (writes only 4 safe columns).
- Every new sensitive admin action (settings save, refund toggle, review hide/delete, broadcast send) writes to `admin_activity_log`.
- Confirmed no service-role key or payment secret is present in frontend code.

## 15. Bugs found

1. Duplicate `const Customers` / `const Settings` in `App.tsx` (build break).
2. Four new pages imported but never routed (dead imports → build break under `noUnusedLocals`).
3. Stale generated types (`database.ts`) missing `0048`'s `platform_settings` table, `reviews.hidden` column, and `broadcast_notification` function (3 type errors).
4. `adminReviews.ts` embed cast rejected because `reviews.Relationships` is `[]` in the typegen.
5. **`broadcast_notification` CHECK-constraint violation** — the most impactful; a production dead-action.
6. Orphan `CustomersAdmin.tsx` (unused, superseded).

## 16. Bugs fixed

1–5 above are fixed. Verified by `tsc -b` (exit 0) and `vite build` (exit 0). Bug 6 (orphan file) left in place — deletion recommended as a separate cleanup (touching it wasn't required to ship).

## 17. Remaining issues

Documented as class C–E in `ADMIN_GAP_ANALYSIS.md §3/§4`. Highest: commission historical-rate snapshotting (finance correctness), buyer/seller 360 drill-downs, structured returns lifecycle.

## 18. Testing results

- `npx tsc -b` → **exit 0** (was 8 errors).
- `npm run build` (tsc + vite) → **exit 0**, built in ~20s, all admin chunks emitted.
- Static verification that each new page reads real data (`fetchRefunds`, `fetchCustomersAdmin`, `fetchAllReviews`, `fetchSettings`, `fetchAudienceSizes`, `fetchActivity`) and that every button routes to a real mutation with toast + audit + confirm.
- Verified the moderation loop is closed: `reviews.ts` buyer/seller reads filter `hidden`, so the admin Hide action has a real effect.

## 19. Failed tests

None. **Not run** (require a live DB / browser and are the manual-config items below): end-to-end broadcast delivery, settings persistence, review hide against a seeded review, RBAC enforcement, and Buyer→Seller→Admin regression. The code degrades gracefully if `0048` is unapplied (data layers detect the missing table/function and surface a clear "apply migration 0048" message rather than crashing).

## 20. Manual configuration required

1. **Apply `supabase/migrations/0048_admin_operations.sql`** in the Supabase SQL editor. Until then: Settings falls back to `company.ts` defaults and cannot save; Broadcast returns "not enabled yet"; Review hide/delete returns a clear message. Nothing crashes.
2. No email/SMS/push provider is wired — Broadcast is **in-app only** by design (Phase 25 note: do not fake unavailable channels).
3. Confirm an `admin`-role profile exists to reach `/admin`.

## 21. Production readiness

**Ready to ship** for the six new surfaces once `0048` is applied. They are additive, RLS-guarded, audited, and cannot affect buyer/seller flows (buyer/seller review reads were the only cross-cutting change, and they were made strictly more conservative). The broader 36-phase brief is **partially delivered** — see the feature matrix.

## 22. Recommended next steps

1. Apply `0048`; smoke-test Settings save, a test Broadcast, and a review Hide.
2. Snapshot `orders.commission_pct` at creation (finance correctness — highest-value remaining fix).
3. Add buyer/seller 360 detail drawers on the existing lists.
4. Delete orphan `CustomersAdmin.tsx`.
5. Scope class-E subsystems (Support, Inspire moderation, Search insights, Health, RBAC, Risk) individually — several need new data capture first.

---

## Feature matrix

| Feature | UI | Backend | DB | Tested | Status |
|---------|----|---------|----|--------|--------|
| Dashboard / Command Center | ✅ | ✅ | ✅ | build | READY |
| Boutique approvals / KYC | ✅ | ✅ | ✅ | build | READY |
| Catalogue vocabulary | ✅ | ✅ | ✅ | build | READY |
| Users (buyers/sellers) | ✅ | ✅ | ✅ | build | READY |
| Products moderation | ✅ | ✅ | ✅ | build | READY |
| Orders control | ✅ | ✅ | ✅ | build | READY |
| Seller payouts / settlement | ✅ | ✅ | ✅ | build | READY |
| Advertisements | ✅ | ✅ | ✅ | build | READY |
| Coupons | ✅ | ✅ | ✅ | build | READY |
| Notifications feed | ✅ | ✅ | ✅ | build | READY |
| **Customer 360° (list)** | ✅ | ✅ | ✅ | build | READY* |
| **Refunds workbench** | ✅ | ✅ | ✅ | build | READY* |
| **Reviews moderation** | ✅ | ✅ | ✅ | build | READY* |
| **Broadcast composer** | ✅ | ✅ | ✅ | build | READY* |
| **Audit trail** | ✅ | ✅ | ✅ | build | READY |
| **Platform settings** | ✅ | ✅ | ✅ | build | READY* |
| Commission historical rate | — | ⚠️ | ⚠️ | — | PARTIAL |
| Buyer/Seller 360 drill-down | ⚠️ | ⚠️ | ✅ | — | PARTIAL |
| Returns lifecycle | ⚠️ | ⚠️ | ⚠️ | — | PARTIAL |
| Granular RBAC | — | ⚠️ | — | — | PARTIAL |
| Action Required Center | — | — | ✅ | — | NOT IMPLEMENTED |
| Support center | — | — | — | — | NOT IMPLEMENTED |
| Inspire moderation | — | — | ✅ | — | NOT IMPLEMENTED |
| Homepage CMS | — | — | — | — | NOT IMPLEMENTED |
| Search insights | — | — | — | — | NOT IMPLEMENTED |
| Seller health score | — | — | ⚠️ | — | NOT IMPLEMENTED |
| Risk center | — | — | — | — | NOT IMPLEMENTED |
| System health page | — | — | — | — | NOT IMPLEMENTED |
| Webhook/job monitor | — | ⚠️ | ✅ | — | NOT IMPLEMENTED |

_`*` READY once migration `0048` is applied. `⚠️` = partial/exists-but-incomplete. `build` = verified by clean `tsc` + `vite build`; live DB/browser tests are manual-config items (§20)._
