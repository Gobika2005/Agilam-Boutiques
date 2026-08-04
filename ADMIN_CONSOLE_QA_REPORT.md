# Admin Console — Live Production Test Report

**Date:** 2026-08-04
**Target:** `https://agilam-boutiques.vercel.app` (Vercel Production, prod Supabase, Razorpay live mode)
**Account:** `selvaswami19@gmail.com` — the platform admin (the owner's own account)
**Method:** Real browser (Chromium) against the deployed build, signed in with a real session. 19 admin routes × 2 viewports (390×844, 1440×900), plus interactive passes and write tests on every console that changes state, plus direct PostgREST probes with the admin JWT, the public anon key, and the service role.
**Authorised scope:** all writes, including money movement and broadcasts. Everything written was verified and reverted — see §6.

> No credentials appear in this report.

---

## 1. Verdict

The admin console is the **healthiest surface of the three tested so far**. 19 routes render at both viewports with no crashes, no page errors, no layout overflow and no broken images; every headline number I cross-checked against the database was correct; and the authorisation model held up under deliberate probing — including refusing *my own* service-role writes, which is the right answer.

There is **no P1**. The findings are one governance gap, one performance problem, and two smaller correctness/config items.

| | |
|---|---|
| Routes swept | 19 × 2 viewports = 38 loads |
| Crashes / error boundaries | 0 |
| Uncaught page errors | 0 |
| Console errors | 1, on `/admin/coupons` — already fixed on `fix/seller-console-audit-2026-08`, not yet deployed |
| Horizontal overflow | 0 |
| Broken images | 0 |
| Headline numbers cross-checked | 14, all correct |
| **P1** | **0** |
| P2 | 2 |
| P3 | 2 |

---

## 2. P2 findings

### P2-1 — The audit trail misses the most consequential admin actions

`/admin/audit` is headed **"Every sensitive admin action, logged."** It isn't. Six admin surfaces never call `logAdminAction`:

| Surface | Actions that go unrecorded | Why it matters |
|---|---|---|
| `Approvals.tsx` | approve / reject / needs-changes | **Who is allowed to trade on the marketplace.** Also silently hides or restores that seller's entire catalogue via the 0038 cascade. |
| `BoutiquesTable.tsx` | suspend / reinstate | Takes a live shop off the storefront. |
| `Payments.tsx` | payout runs, settlements | **Money leaving the platform.** |
| `Coupons.tsx` | create / edit / delete | Platform-funded discounts — direct P&L impact. |
| `Ads.tsx` | campaign approve / reject, rate-card edits | **Pricing.** Yesterday's ₹0 hero rate would have left no trace of who set it or when. |
| `Catalogue.tsx` | add / approve / delete a term | Reshapes buyer navigation. |

Verified live, not just read: I approved, suspended and rejected a boutique through the UI, and added and deleted a catalogue term. The only row written to `admin_activity_log` during the whole session was the `settings.update` from my settings test — plus `broadcast.send` and `user.create` when I exercised those. A full tally of the table confirms it: every action type ever recorded is `user.*`, `product.*`, `order.*`, `settings.update`, `review.*`, `expense.create`, `broadcast.send`. **No `boutique.*`, `payout.*`, `coupon.*`, `ad.*` or `taxonomy.*` row has ever existed.**

The logging helper already exists and eight pages use it correctly — this is six missing call sites, not a design problem.

### P2-2 — `/admin/overview` takes 9–17 seconds to load

| Route | Mobile | Desktop |
|---|---|---|
| `/admin/overview` | 9.5 s | **17.1 s** |
| `/admin/products` | **10.4 s** | 6.0 s |
| `/admin/users` | 7.2 s | 5.7 s |
| Everything else | 3.2–4.3 s | 2.9–5.7 s |

Overview is the console's landing page and the slowest thing in the app. `fetchDashboard()` fires eight queries in parallel, and two of them are unbounded: `orders` with three embedded joins and **no limit**, and `order_items` selected in full. At 17 orders that is already 17 s on a cold desktop load; it grows linearly with the marketplace.

The dashboard only renders six recent orders, the top three boutiques, the top five products and aggregate totals — none of which needs every order row shipped to the browser. Aggregates belong in a database view or an RPC; the "recent orders" list needs `.limit(20)`.

---

## 3. P3 findings

### P3-1 — Offline cash bills appear as platform refund liability

`/admin/refunds` states its own rule plainly: *"Only orders the platform actually collected money for can be refunded."* Its "Awaiting refund" tab then lists **AGB-260722-6379** — a walk-in cash bill (`channel: offline`, `payment_method: Cash`) for ₹10 from Eval Nila's, rejected — and counts it under **"₹10 Owed to buyers."**

The platform never touched that money. The seller took cash across the counter, so the refund liability is the seller's, not MangaiMart's. Including it contradicts the screen's stated rule and overstates platform liability. The fix is a `channel <> 'offline'` filter on that tab, or a separate "seller to settle directly" bucket.

Worth noting the screen is otherwise careful and honest: *"Marking one records the decision; the Razorpay movement is a separate settlement step."* **No button in this console moves real money** — which is why the money-movement authorisation you granted went unused (see §6).

### P3-2 — Transactional email is not configured in production

Creating a user succeeded (`201 admin-create-user`) but the console reported *"The welcome email could not be sent, so give the new user their sign-in details directly"* and displayed a temporary password to copy. The fallback is well-designed — a genuinely good failure mode — but it means `RESEND_API_KEY` is unset in Vercel Production.

Scope is small: Resend is only used by `admin-create-user.js` and `razorpayx-webhook.js`. The app sends buyers **no** transactional email at all — order confirmations and shipping updates are in-app notifications only. So the impact is limited to admin-created accounts and payout notifications, but it is worth a deliberate decision rather than an accident.

---

## 4. Verified working

Actively tested, correct — recorded so it isn't re-tested.

**Authorisation — the strongest result of this audit**

- Anonymous (public anon key) sees **16 of 17 products**; the seventeenth belongs to a rejected boutique and is correctly withheld. No product from a non-approved boutique is reachable.
- The `boutiques` guard trigger refused **my own service-role PATCH** with `P0001: boutiques: verified/featured are admin-managed`, because `is_admin()` is false without an auth session. `broadcast_notification` refused it too (`not authorized`). Privileged actions genuinely require an admin *session*, not merely the service key — a meaningfully stronger position than "service role can do anything".
- The seller-side RLS results from 2026-08-03 still hold.

**Correctness — every number cross-checked against the database**

| Screen | Shows | DB | ✓ |
|---|---|---|---|
| Reports / Overview | GMV all-time ₹13.6k, 11 earned orders | ₹13,635 across 11 orders excluding cancelled, rejected **and refunded** | ✓ |
| Overview | 5 buyers, 12 sellers, 0 pending, 5 low stock | identical | ✓ |
| Overview | payment mix 9% online (1 online / 10 COD) | identical | ✓ |
| Approvals | 9 approved, 2 rejected, 2 setting up | 13 boutiques | ✓ |
| Refunds | 4 issued, ₹5.6k refunded | 4 rows, ₹5,597 | ✓ |
| Reviews | 7 total, 4.3 avg, 1 low, 1 hidden | 7 rows | ✓ |
| Ads | ad revenue ₹24 | ₹31 booked less the ₹7 refunded campaign | ✓ |
| Broadcast | Everyone 17, Buyers 5, Sellers 12 | identical; admins correctly excluded per 0050 | ✓ |
| Payouts | nothing outstanding | correct — every settled COD order has a `payout_id`, and uncollected COD owes nothing yet | ✓ |
| Customers | 7 customers, 3 repeat, 11 orders | consistent with guest+registered buyers | ✓ |

**Write paths exercised end to end**

- **Catalogue** — added "QA Audit Term" (`kind: category`, auto-approved), verified in DB, deleted.
- **Settings** — changed a numeric field (2000 → 2001), confirmed the DB write, restored. Maintenance mode untouched throughout.
- **Broadcast** — sent to Sellers: **12 notifications created**, type `Updates`, audit-logged as `broadcast.send`, all 12 rows deleted within seconds. The two-step confirm ("This reaches 12 sellers… It can't be recalled") is a good guard and correctly blocked my first, unconfirmed attempt.
- **Users** — created via `admin-create-user` (201), profile + auth row both present, `user.create` logged, then deleted from both. The migration-0029 fix still holds.
- **Boutique approval + the 0038 cascade** — verified in **both** directions, which is the first time this has been proven live: approving flipped its product `hidden(auto_hidden=true)` → `active(false)`, and rejecting flipped it back. Suspending to `pending` leaves `products.status` as `active`, but the RLS policy from 0034 requires `boutiques.status = 'approved'`, so buyers still cannot see them — verified empirically, not assumed.

**Two false alarms I chased down and cleared** (so they don't get re-filed):

- The five `ERR_ABORTED` requests on Overview and Reports are **not failures**. Each returns `200` with a correct `content-range` (e.g. `0-4/5`); Playwright additionally emits `requestfailed` for HEAD requests because there is no body to read. The counts are right and the requests succeed.
- The "Loading MangaiMart…" text appearing under several pages is the boot splash in `index.html`, correctly hidden (`visibility: hidden`, `opacity: 0`) once React mounts. It only showed up because my extraction cloned the DOM node, which defeats computed style.

---

## 5. Known, already fixed, not re-reported

`/admin/coupons` returns `403` on production. This is the same migration-0058 column-revoke found in yesterday's seller audit; the fix is committed on **`fix/seller-console-audit-2026-08`** and is not yet deployed. Migration 0059 **is** applied to the production database, so the console will work fully as soon as that branch ships.

---

## 6. Everything this test wrote, and its current state

| Write | State now |
|---|---|
| Catalogue term "QA Audit Term" | **Deleted** |
| `platform_settings.free_delivery_over` 2000 → 2001 | **Restored to 2000** |
| Broadcast to 12 sellers ("QA audit check") | **All 12 notification rows deleted** |
| Boutique "lakshmanan 3366's" → approved → suspended → rejected | **Restored to `rejected` / `verified: false`** |
| Its product "Festive series" (moved by the cascade) | **Restored to `hidden` / `auto_hidden: true`** |
| Admin user `qa.audit.0804@example.com` | **Deleted** from both `profiles` and Supabase Auth |

Final verification: 13 boutiques (9 approved / 2 rejected / 2 draft), 17 orders, 17 products, zero stray QA rows in `taxonomy`, `notifications`, `profiles`, `coupons` or Auth. Settings identical to the pre-test values. Ad rate card unchanged from yesterday's fix (hero ₹99 / sponsored ₹49 / boutique promo ₹79, all active).

**No real money moved, and none could have.** The Refunds console records decisions rather than calling Razorpay, and Payouts had nothing outstanding to transfer. The money-movement authorisation was not needed.

One irreversible thing did happen as authorised: 12 sellers may have briefly seen a notification titled "QA audit check" if they had the app open in the ~15 seconds before I deleted the rows.

---

## 7. Still outstanding

Unchanged from the previous two audits:

- **`platform_settings.maintenance_mode` is still `true`** — every buyer and crawler still sees the maintenance banner. Confirmed again today at `/admin/settings`.
- The seller-console fix branch is **committed but not deployed**.
- `CRON_SECRET` and the Upstash rate-limit variables are still unset.

---

## 8. Suggested order of work

1. **Deploy `fix/seller-console-audit-2026-08`** — clears the last console error and restores both coupon consoles.
2. **Turn off maintenance mode.**
3. **P2-1 audit logging** — six `logAdminAction` call sites, starting with Approvals and Payments. Small change, and it is the difference between an audit trail and the appearance of one.
4. **P2-2 Overview performance** — put a `.limit()` on the recent-orders query and move the aggregates server-side.
5. P3-1 refund tab filter, P3-2 decide on Resend.
