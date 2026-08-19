# MangaiMart — Full Functionality Test

**Date:** 2026-08-11
**Branch:** `fix/seller-console-audit-2026-08` (@ `b8e8be2`)
**Target:** production — `https://mangaimart.com` + Supabase project `mtxmuaskmyhnqczctwlp`

> **Remediation pass — same day.** Of the 24 findings: **16 fixed in the working
> tree** (two of which need migrations `0073` and `0074` run before they take
> effect), **5 need the owner's hand**, **2 deliberately deferred**, and 1 (M-6)
> is a local-machine setting. See **[Fix status](#fix-status)** at the end.
> Verified after the changes: `tsc -b` 0 errors, `eslint` 0 errors, `vite build`
> clean, `npm run verify:seo` ALL CHECKS PASSED.

---

## Scope & honesty note

Read this before the score.

**What was actually executed:** the build and lint toolchain; live HTTP probes against every
`/api/*` endpoint and every Supabase Edge Function; live PostgREST queries against the
production database with the anonymous key (the same credential the browser holds); crawler-visible
HTML for the public routes; and the shipped `dist/` bundle.

**What was NOT executed:** I have no buyer, seller or admin credentials, so no authenticated
screen was clicked through. Everything behind a login — the seller console, the admin console,
checkout past the sign-in gate — was assessed by reading the code and by probing the RLS
boundary from outside. **No order was placed and nothing was written to production.**

**Unverifiable from outside:** whether migration `0072` has been applied. It adds triggers and
storage-bucket limits, neither of which is observable through the public API. Per the house rule,
I am not calling it live. **Confirm `0072` in the Supabase SQL editor.**

---

## Functionality Score: **72 / 100**

| Area | Score | Note |
|---|---|---|
| Build & type safety | 10/10 | Clean |
| Payments & pricing integrity | 10/10 | Client/server mirror verified in step |
| Security & RLS | 9/10 | One PII over-grant |
| API layer | 9/10 | Correct validation, auth, rate limits |
| SEO & crawlability | 9/10 | Machinery is right; catalogue is thin |
| Catalogue & discovery | 7/10 | Taxonomy hygiene, unfilterable colours |
| Auth | 8/10 | Works; some stale dead code |
| Orders & tracking | 7/10 | Built, untested with real data |
| **Returns & refunds** | **2/10** | **No buyer-facing flow exists** |
| **Notifications (email)** | **3/10** | **No transactional email at all** |
| Robustness | 6/10 | No error boundary on buyer/seller |
| Production content readiness | 4/10 | Test data live, maintenance mode on |

The commerce engine is in good shape. The score is held down by one entirely missing feature
(returns), one missing channel (transactional email), and a live configuration/content state that
is not launch-ready.

---

## Passed — 41 checks

### Build & static analysis
1. `tsc -b` — **0 errors**
2. `eslint` — **0 errors** (25 warnings, all `react-refresh/only-export-components` + 4 `exhaustive-deps`)
3. `vite build` — succeeds in 9.32s, code-splitting intact (largest buyer route chunk 58 kB / 14 kB gzip)

### Production health
4. `GET /api/health` → `checkoutReady: true`
5. All 5 DB probes pass (`products.select`, `products.in`, `boutiques.select`, `orders.select`, `rpc.reserve_stock`)
6. No `SUPABASE_URL` / `VITE_SUPABASE_URL` project split — functions and browser on the same project
7. Service-role key is the current `sb_secret_` format
8. Both Razorpay merchant accounts respond `200` in **live** mode; active account = `backup`

### API layer (11 endpoints probed live)
9. Method guards — every POST-only endpoint returns `405` on `GET` with a correct `Allow` header
10. `create-order` empty body → `400 ITEMS_REQUIRED`
11. `place-order` empty body → `400 Cart is empty`
12. `verify-payment` empty body → `400 Missing payment verification fields`
13. `razorpay-webhook` unsigned → `400 Invalid webhook signature` (fails **closed**)
14. `razorpayx-webhook` unauthenticated → `401`
15. `admin-list-users` / `admin-create-user` / `admin-delete-user` → `401 Missing admin session`
16. `run-payouts` → inert `200`, short-circuited by `AUTO_PAYOUTS_ENABLED = false` before any auth or money path. Correct and deliberate.
17. `geo` → resolves correctly (`Erode, Tamil Nadu, IN`)
18. No stack traces, SQL, or key material in any error body
19. **Rate limiting works** — 30 sequential `/api/health` calls returned `200`, calls 31–36 returned `429`

### Security & RLS (probed with the public anon key)
20. `orders`, `order_items`, `payouts`, `expenses`, `messages`, `conversations`, `shipments`, `shipment_events`, `notifications`, `platform_feedback` — all return **0 rows** to anon
21. `boutiques.bank_account_number`, `bank_ifsc`, `bank_account_name`, `razorpayx_contact_id`, `payout_details_verified` → **`401` permission denied** (column grants from 0021/0025 holding)
22. `boutiques` bare `select('*')` correctly fails — matches the documented rule
23. `shiprocket_auth` → `401` permission denied
24. Anonymous auth sign-ups **disabled** project-wide, consistent with migration 0069
25. `create-order` rejects `is_anonymous` sessions server-side — sign-in-to-order is enforced on the server, not just the UI
26. `safeNext()` blocks open redirects (`//evil.example`, absolute URLs) on the post-sign-in bounce

### Pricing & coupons — CLAUDE.md rule 2
27. `src/lib/pricing.ts` and `api/_pricing.js` **verified in step**: identical `couponBase`, `isEligible`, `couponSavings`, ship-fee and COD-fee derivation
28. Order total floored at zero — `Math.max(0, cartSubtotal - discount) + shipFee + codFee` on both sides
29. Flat coupons clamped to their applicable base; percentage coupons clamped to `max_discount`
30. Only one coupon applies — no stacking path
31. Server re-derives the amount from the DB; there is no client-amount fallback
32. Coupon redemption caps re-checked atomically at order write (`redeem_coupon`), and `usage_limit`/`used_count` are deliberately withheld from the buyer's column list

### Schema state
33. Migrations **0063–0071 confirmed applied** by column/table probe (courier tracking, parcel dimensions, prepaid default, Shiprocket, pickup auto-register, sign-in requirement, house ads, order feedback)
34. Taxonomy is populated and approved — 14 categories, 10 occasions, 17 fabrics, 29 colours

### Edge Functions
35. `shiprocket-book`, `shiprocket-pickup` — deployed, JWT-gated (`UNAUTHORIZED_NO_AUTH_HEADER`), correct for console-invoked functions
36. `tracking` — deployed with JWT verification off and its own constant-time `x-api-key` guard, which fails closed. Correct posture for a courier webhook receiver.

### SEO
37. Home, PDP, `/collections`, `/shop`, `/inspire`, `/new-arrivals`, city pages — all serve correct crawler-visible `<title>`, description, canonical and `index, follow`
38. PDP emits valid `Product` JSON-LD with `availability: InStock`; home emits `Organization` + `WebSite` + `SearchAction`
39. `/search?q=` is `noindex, nofollow` — correct, query-space crawl budget protected
40. `sitemap.xml` serves a valid index pointing at pages/boutiques/products children

### UI foundations
41. Viewport meta correct; 63 media queries; every fixed width ≥ 400px is paired with `max-width:100%` (only exception is the PDF receipt, deliberately fixed). Division guards (`|| 1`, `Math.max(…, 1)`) present in every dashboard chart, so the current zero-order state produces no `NaN`.

---

## Failed / Missing — 24 findings

## Critical

### C-1 — Published policy pages contradict what the platform actually charges

`src/data/policies.ts` renders the frozen constants in `src/data/company.ts`, while checkout prices
from the live `platform_settings` row. They have drifted. Both values below are verified — the
left column extracted from the **shipped `dist/` bundle**, the right column read from the **live
database**.

| Term | Policy page states | Actually applied |
|---|---|---|
| Standard shipping | **₹79** | **₹89** |
| COD maximum order | **₹10,000** | **₹5,000** |
| Return window | **7 days** | **0 days** |
| Commission | **10%** | **15%** |
| Free delivery over | ₹2,000 | ₹2,000 ✅ |
| COD fee | ₹49 | ₹49 ✅ |

Every buyer with a bag under ₹2,000 is charged **₹10 more than the published Delivery Policy**.
The Return & Refund Policy advertises "7-day returns on eligible items" against a configured
window of zero. For an Indian marketplace taking real money these are published contractual
terms, so this carries consumer-law exposure, not just an inconsistency.

The comment in `company.ts` says these must be kept aligned by hand — that has failed, and it will
fail again. Fix by making the policy pages read `useSettings()`.

**Files:** [company.ts:104-116](src/data/company.ts#L104-L116), [policies.ts:81](src/data/policies.ts#L81), [policies.ts:149](src/data/policies.ts#L149), [policies.ts:406](src/data/policies.ts#L406)

### C-2 — There is no returns or refund-request flow

`return_window_days` is editable in Platform Settings and read by exactly nothing. There is no
`src/data/returns.ts`, no buyer "Return this item" path, and `/admin/refunds` is a manual
admin-initiated screen only. A buyer whose item arrives damaged has no in-app route to a return —
the Return Policy tells them to message the boutique.

This is the same class of defect that `maintenance_mode` had before it was wired up: a setting the
console presents as functional that changes nothing.

**Evidence:** `return_window_days` appears only in `admin/Settings.tsx`, `data/settings.ts`,
`api/_settings.js`, `types/database.ts` — never in a buyer surface.

### C-3 — Maintenance mode is ON in production right now

`platform_settings.maintenance_mode = true`. Every shopper on the public storefront is currently
seeing the banner *"We're carrying out maintenance right now — some things may be slower or
unavailable."* Orders still complete (it is deliberately a banner, not a block), but it suppresses
conversion on every page.

If this is intentional pre-launch, ignore. If it was left on after the 2026-08-10 settings edit,
turn it off. **Owner decision.**

---

## High

### H-1 — No transactional email to buyers or sellers

Resend is wired into exactly three places: `api/admin-create-user.js` (welcome mail),
`api/razorpayx-webhook.js` (payout notice), and `scripts/daily-report.mjs` (owner digest).

There is **no email** for: order confirmation, new-order-to-seller, dispatch, delivery, or refund.
A buyer who pays receives nothing outside the app. In-app notifications do work — `place-order`
inserts a seller "New order" row and the 0018 triggers cover buyer status changes — but the
marketplace has no email channel for the order lifecycle.

### H-2 — No error boundary on the buyer or seller trees

`RouteErrorBoundary` exists and is mounted **only** in `AdminLayout`. Neither the buyer storefront
nor the seller console is wrapped. Any render-time exception on a buyer route unmounts the React
tree and leaves a white screen on the revenue-critical surface.

**Files:** [RouteErrorBoundary.tsx](src/components/layout/RouteErrorBoundary.tsx), [AdminLayout.tsx:136](src/components/layout/AdminLayout.tsx#L136)

### H-3 — Seller contact details are bulk-scrapeable with the public anon key

`BOUTIQUE_COLUMNS` grants anon `email`, `phone` and `whatsapp`. One unauthenticated request returns
every seller's email and mobile number:

```
Studio Mahil  studiomahil@gmail.com  6379007829
lilium        selvasami03@gmail.com  6379007829
Sirpaa        selvaswami19@gmail.com 9003379819 / 9789955441
Eval Nila's   evalnila2122@gmail.com 6379782558
… all 9 boutiques
```

Grepping the buyer surface shows **none of these three columns is ever rendered to a buyer** —
`BoutiqueProfile.tsx` does not reference them. They are granted because the seller console reuses
the same column list for its own shop. Split `BOUTIQUE_COLUMNS` into a public list and an
owner-only list, and revoke the three columns from `anon` in a new migration.

**File:** [boutiques.ts:14-27](src/data/boutiques.ts#L14-L27)

### H-4 — Production is populated with test data presented as verified

- **6 of 9 boutiques share the phone number `6379007829`**, with obvious test emails
  (`ritaryatest@`, `arhatest@agilam.com`, `svaraatest@`, `kulyiltest@`). All 9 are
  `status: approved`, `verified: true`.
- **Three test listings are live and buyable:** "Raw Silk" ₹10 (stock 0), "Classic Brown Cotton
  Kurta Set" ₹19 (MRP ₹99, stock 49), "Elegant Floral Printed Soft Silk Saree" ₹50.
- A buyer sees nine "verified" shops, most of which are not real.

The ₹10–₹50 listings were already flagged in the 2026-08 live-audit remediation and are still live.

### H-5 — Admin live-presence labels are broken by the root-URL migration

`describePage()` in `src/lib/presence.ts` still matches the pre-migration route shapes. Four
matchers are wrong:

| Line | Matcher | Actual route | Effect |
|---|---|---|---|
| 55 | `p === '/'` → **"Signing in"**, section `auth` | `/` is the **buyer home page** | Every shopper on the busiest page in the app is reported to admin as signing in |
| 58 | `/product/` (singular), `/b/` | `/products/:slug`, `/boutique/:slug` | "Viewing a product" is unreachable dead code |
| 66 | `/results` | `/shop`, `/search` | Search traffic reports as generic "Browsing" |
| 73 | `/home` | route no longer exists | Dead |

The Users-page roster is actively misleading, not merely imprecise.

**File:** [presence.ts:51-75](src/lib/presence.ts#L51-L75)

### H-6 — Shiprocket is fully built and deployed but switched off

All three Edge Functions are deployed and correctly gated; migrations 0065–0068 are applied. But
`platform_settings.shiprocket_enabled = false`, and **no boutique** has
`shiprocket_enabled`, `shiprocket_pickup_location`, or `shiprocket_pickup_registered_at` set.
The `shipments` and `shipment_events` tables are empty. The integration has never carried a real
booking. Nothing is broken — it is dormant, and it has never been exercised end to end.

### H-7 — WhatsApp automation does not exist

`WHATSAPP_AUTOMATION_PLAN.md` describes a Meta Cloud API outbox. There is no `whatsapp_outbox`
table (confirmed: `PGRST205` on the live DB) and no sending function. `src/lib/whatsapp.ts` is a
`wa.me` click-to-chat link builder used by seller Billing/OrderDetail/Help and admin Approvals —
manual, human-initiated, one message at a time. Automated WhatsApp notification is **not
implemented**.

### H-8 — Company legal identity is still placeholder

`src/data/company.ts` ships with `cin: ''`, `gstin: ''` and a `TODO` registered-office address, and
those blanks render on the live policy and contact pages. An Indian marketplace collecting payments
needs the registered entity, address and GSTIN published. **Needs the owner's real details.**

---

## Medium

### M-1 — Admin-approved taxonomy terms are malformed and buyer-facing

Every term below is `status: approved`, so each one is a live filter chip and an indexable
`/occasions/…` or `/fabrics/…` landing page:

- occasion: **`"Casual, Festive, Office Wear, Daily Wear"`** — four occasions approved as one term
- occasion: `"office wear"` (lowercase) duplicating the intent of the blob above; alongside
  `"For all"` and `"Aadi collection"`
- fabric: **`"Loomed  Cotton"`** — double space, will slug and de-duplicate badly
- fabric: `"Soft Silk Sarees"` — a category name in the fabric list
- fabric: `"Cogchi silk"` — probable typo
- fabric casing is inconsistent: `Silk`, `Art Silk`, `Raw silk`, `Kanchipuram Silk`

### M-2 — Product colour is free text, so 5 of 16 products are unfilterable by colour

`ProductForm` validates colour as non-empty but does not constrain it to the approved list. Live
values outside the 29-term taxonomy: `"Black, vine"`, `"Mulberry wine with Dusty blue"`,
`"Desert Rose"`, `"Violet"`, `"Olive Brown with Orange Floral Design"`.

The filter is exact-match (`filters.colors.includes(p.color)`) and only renders swatches for
taxonomy colours present in the catalogue, so these products degrade gracefully — no broken chip —
but **31% of the catalogue can never be reached through the colour filter**. `"Violet"` is
particularly avoidable: `Purple` and `Lavender` both exist in the taxonomy.

### M-3 — MRP-below-price is client-validated only

`ProductForm.validate()` correctly enforces `MRP ≥ price`, but there is no DB `CHECK` and no
server-side guard, and one row predates it: *"Charcoal Ajrakh Print Kurta Set with Dupatta"* at
price **₹2,599** / MRP **₹2,199**. Display is safe — every render site guards on `mrp > price`, so
the strikethrough and discount badge are simply hidden — but the row is wrong and any non-form
write path (CSV import, admin, SQL) can reproduce it.

### M-4 — Ratings and reviews have never been exercised

The `reviews` table is empty and all 9 boutiques carry `rating: 0.0`. The review machinery has
existed since 0014 and the 0071 post-delivery prompt is applied, but with zero orders and zero
reviews, none of the rating aggregation, the review inbox, or the seller public-reply feature has
run against real data.

### M-5 — Duplicate migration number `0068`

Two files claim it: `0068_fix_price_drop_trigger.sql` and `0068_pickup_autoregister.sql`. Since
migrations are applied by hand in filename order, a duplicate number is exactly how one silently
gets skipped. Also, `CLAUDE.md` says "the next one is `0071`" while `0071` and `0072` both exist —
the doc needs bumping to `0073`.

### M-6 — Local dev environment is on Node 20, which `_supabase.js` documents as fatal

Local Node is **v20.11.1**; `package.json` pins `engines.node: 24.x`. The header comment in
`api/_supabase.js` explains that Node 20 throws *"native WebSocket not found"* inside
`createClient()` — and that in `place-order.js` this lands *after* the payment is captured. Vercel
runs 24 so production is fine, but anyone running the functions locally hits this on every
checkout.

---

## Minor

### m-1 — 758 hardcoded hex colours against the `--ag-*` rule
CLAUDE.md rule 4 says colours are always CSS variables. Actual count in `src/pages` + `src/components`:
**758** six-digit literals, led by `#D6336C` (253) and `#B02454` (158) — the light-theme values of
`--ag-crimson`, which is `#E85088` in dark mode.

Calibrating this honestly: most are gradients and backgrounds on brand buttons that are meant to be
theme-invariant, and the ~39 foreground `color:#D6336C` uses are 24–44px empty-state icons, where
~4:1 against the dark surface still clears the 3:1 bar for large graphics. So this is a
**consistency and maintenance** problem — brand accents freeze at their light-mode value instead of
brightening — not a serious accessibility break. Worth noting because the token layer was clearly
built with measured contrast ratios (the comments in `index.css` cite them) and 758 literals bypass
that work.

### m-2 — Dead anonymous-chat code with a stale docstring
`ensureBuyerIdentity()` calls `supabase.auth.signInAnonymously()`, which the project now rejects —
verified live: `422 anonymous_provider_disabled`. It is **not** a live break: `Chat.tsx:48` holds
on `if (!boutiqueId || !signedIn) return;`, so the call is unreachable. But the docstring still
says *"Requires Anonymous sign-ins to be enabled"* and `SignInGate.tsx:22-25` still describes chat
as minting anonymous sessions. Both are now false and will mislead the next reader.

Related: `Chat.tsx:36` uses `const signedIn = !!session` where the codebase's own rule
(`SignInGate.tsx:27`) is to use `isSignedIn(session)`. Equivalent today only because anonymous auth
is off.

### m-3 — A coupon that zeroes the payable total dead-ends checkout
`create-order` rejects amounts under 100 paise with *"amount must be an integer of at least 100
paise"*. A 100%-off coupon with no `max_discount` on a bag over the free-delivery threshold
produces `total = 0` and surfaces that raw message to the buyer. Not reachable with the three live
coupons; nothing stops an admin creating one.

### m-4 — Exhausted coupons show a discount that will not apply
By design, `usage_limit`/`used_count` are withheld from the buyer's coupon columns to avoid leaking
redemption counts. The consequence is that a capped-out code still previews its discount in the
bag, and the server then prices without it. The buyer is charged the correct (higher) amount with
no explicit "this code is no longer available" message.

### m-5 — `platform_settings.updated_by` is anon-readable
Exposes an admin's auth UUID (`1dc8d1d8-…`) to any unauthenticated reader. Low impact — a UUID
alone is not actionable — but it is gratuitous.

### m-6 — Soft-404 canonical self-reference
Unknown routes correctly return `noindex, nofollow` but also emit
`<link rel="canonical" href="https://mangaimart.com/this-page-does-not-exist">`. Vercel's SPA
rewrite means the HTTP status is 200. The `noindex` does the real work; the self-canonical on a
non-existent URL should be dropped.

### m-7 — Two advertised features are "coming soon" toasts
Chat photo sharing (`ChatView.tsx:434`) and Apple sign-in (`SignIn.tsx:150`) both render a button
that only shows a toast. The Apple button sits next to a working Google button and looks equally
live.

### m-8 — Local `.env` is missing server-side keys
No `SUPABASE_URL`, `RAZORPAY_WEBHOOK_SECRET`, `UPSTASH_REDIS_REST_*`, or `VITE_SITE_URL`. Production
has them (`/api/health` and the 429 test both prove it), and `health.js` falls back to
`VITE_SUPABASE_URL`, so this only affects local function development.

---

## Recommended fixes, in order

**Before taking real orders**

1. **C-1** — Make `src/data/policies.ts` read `useSettings()` instead of `POLICY_TERMS`, so the
   published terms are the charged terms by construction. Then reconcile the four drifted values:
   decide whether shipping is ₹79 or ₹89, whether the COD cap is ₹5,000 or ₹10,000, and set
   `return_window_days` to the window you actually intend to honour.
2. **C-3** — Confirm whether maintenance mode is meant to be on. Turn it off if not.
3. **H-4** — Purge or unpublish the test boutiques and the ₹10/₹19/₹50 listings, or drop them to
   `status: draft`. Nine "verified" shops sharing one phone number will not survive scrutiny.
4. **H-8** — Supply the registered entity name, office address, CIN and GSTIN for
   `src/data/company.ts`.
5. **Confirm migration `0072` is applied** — it is the fix for sellers being able to un-settle
   their own payouts. I could not verify it from outside.

**Next**

6. **C-2** — Build the return-request flow, or remove the return window from Platform Settings and
   the 7-day promise from the policy page. Shipping a setting that does nothing is worse than
   shipping neither.
7. **H-1** — Wire Resend into `place-order` for buyer order confirmation and seller new-order
   notification. That is the minimum viable email set; dispatch and delivery can follow.
8. **H-2** — Wrap the buyer and seller outlets in `RouteErrorBoundary`. It already exists; it is a
   two-line change per layout.
9. **H-3** — Split `BOUTIQUE_COLUMNS` and revoke `email`/`phone`/`whatsapp` from `anon` in
   migration `0073`.

**Then**

10. **H-5** — Fix the four stale matchers in `describePage()`.
11. **M-1 / M-2** — Clean the taxonomy (`"Casual, Festive, Office Wear, Daily Wear"`,
    `"Loomed  Cotton"`, the casing) and constrain the product colour field to the approved list.
12. **M-5** — Renumber one of the two `0068` files and bump `CLAUDE.md` to `0073`.
13. **M-3** — Add a DB `CHECK (mrp is null or mrp >= price)` and correct the Charcoal Ajrakh row.
14. **H-6** — Run one real Shiprocket booking end to end before relying on it.
15. **m-2** — Delete the dead anonymous-sign-in branch and correct the two stale docstrings.

---

## Not production-ready — but close on the parts that are hard

The machinery that is genuinely difficult to get right is right: the pricing mirror holds to the
paise, RLS and column grants withstand direct probing with the public key, the webhooks fail closed,
rate limiting works under test, and the SEO layer emits correct structured data. Nothing in the
payment path is broken.

What stands between this and production is not architecture. It is one missing feature (returns),
one missing channel (email), a handful of stale matchers and grants, and a database still holding
the test data it was built against — plus a set of published commercial terms that no longer match
what the checkout charges. That last one is the item I would not ship past.


---

# Fix status

Remediation pass, 2026-08-11. Verified after the changes: `tsc -b` **0 errors**,
`eslint` **0 errors**, `vite build` **clean**, `npm run verify:seo`
**ALL CHECKS PASSED** (run against live production).

## Fixed in code - 16

| # | Finding | What changed |
|---|---|---|
| **C-1** | Policy pages contradicted what is charged | `src/data/policies.ts` now builds from the **live `platform_settings` row**, not the frozen `POLICY_TERMS`. `POLICIES` became `buildPolicies(terms)` plus `usePolicies()` / `usePolicy()` / `useLegalPages()` hooks; `Policy.tsx` and `App.tsx` rewired. The promise and the charge are now the same value by construction. The Return Policy also handles a **zero window** properly instead of printing "the 0-day window" - it switches to fault-only copy. |
| **C-2** | No returns flow | **Built.** Migration `0074`: `return_requests` table, RLS with **no write policy at all**, and two SECURITY DEFINER functions. `request_return()` re-derives the boutique from the order, checks ownership, and enforces the window server-side - **fault reasons bypass the goodwill window** (capped at 30 days), goodwill reasons do not and are refused when the window is 0. `resolve_return_request()` requires a reason to reject. Buyer UI: `ReturnRequestSheet` + a card on the order page. Seller UI: an approve/reject card on `seller/OrderDetail`. Both sides get in-app notifications. New `src/data/returns.ts`. |
| **H-1** | No transactional email | New `api/_email.js` (underscore-prefixed - **costs no Vercel function slot**, and the project is at the 12-function ceiling). `place-order.js` now emails the **buyer a confirmation** and **each seller their new order**, one per boutique order. Best-effort throughout: `sendEmail` never throws, has an 8s timeout, and a failure is logged, never surfaced. Order data is HTML-escaped. |
| **H-2** | No error boundary on buyer/seller | `RouteErrorBoundary` generalised (was admin-flavoured) and mounted in **`AppShell`**, which both the storefront and seller console render through - one change covers both. **Keyed on `pathname`** so navigating away from a crashed screen recovers; the admin one was missing that key too and is now fixed. |
| **H-3** | Seller PII bulk-scrapeable | Migration `0073` revokes `email`/`phone`/`whatsapp` from `anon` **and** `authenticated`, and extends `boutique_private()` with them. Client: removed from `BASE_COLUMNS`; `fetchMyBoutique` merges them back from the private read (best-effort, so an un-migrated deploy degrades to blanks rather than an error); admin Approvals reads them off the `priv` object it already loads. |
| **H-5** | Live-presence labels broken | All four stale matchers in `describePage()` fixed - `/` is the storefront home (was reported as "Signing in"), `/products/`, `/shop`+`/search`, and the dead `/home`. Switched from `includes` to `startsWith` with `/` matched last, and added notifications/coupons/occasions/fabrics. |
| **M-1** | Malformed approved taxonomy | Migration `0073` moves the comma-blob occasion back to `pending` (removing it from the filter sheet and its landing page) and fixes the casing/whitespace on `office wear`, `Loomed  Cotton`, `Raw silk`. **Three left alone on purpose** with the reasoning written into the migration - `Cogchi silk` and `Soft Silk Sarees` need a human decision, and the five off-list product colours would be mislabelled by a bulk guess. |
| **M-2** | Free-text colour, 5 products unfilterable | `ProductForm` now rejects a colour that is not in the approved taxonomy. The picker was already a combobox, so this catches the real case: **editing an old listing** that predates it. |
| **M-3** | MRP could sit below price | Migration `0073` adds `CHECK (mrp is null or mrp >= price)`, after nulling existing bad rows. **Nulling rather than raising** is deliberate - we know the price is real and we do not know what the MRP should have been, so inventing one would fabricate a discount. |
| **M-5** | Duplicate migration `0068` | Split into `0068a` / `0068b` with a numbering note in each header. Both are idempotent and already applied, so re-running either is a no-op - stated in the files. `CLAUDE.md` bumped to `0074`. |
| **m-2** | Dead anonymous-chat code | The `signInAnonymously()` branch is **removed** (it can only throw - verified live: `422 anonymous_provider_disabled`) and replaced with a clear message. Stale docstrings in `chat.ts` and `SignInGate.tsx` corrected. `Chat.tsx` switched from `!!session` to `isSignedIn(session)`, the codebase's own rule. |
| **m-3** | Coupon zeroing the total dead-ended | `create-order` now distinguishes the two cases and says which, instead of surfacing Razorpay's "amount must be an integer of at least 100 paise". |
| **m-4** | Exhausted coupon silently overcharged | `create-order` returns `couponApplied`; the client **aborts before the payment modal opens** if the code did not survive the server's re-check. Previously the modal opened for more than the total the buyer had agreed to. |
| **m-5** | `platform_settings.updated_by` leaked | Revoked from `anon`/`authenticated` in `0073`. |
| **m-6** | Self-canonical on soft-404s | `middleware.js` suppresses `canonical` and `og:url` when the meta is `notFound`. A canonical pointing at a page we are asking crawlers not to index was a contradiction. |
| **m-7** | Non-functional Apple button | Removed. It sat beside a working Google button at the same weight and only toasted "coming soon". |

Type honesty note: `BoutiqueRow.phone/email/whatsapp` are now **optional**, because
after 0073 a buyer-facing read genuinely does not return them - the type said
`string | null` while the value was `undefined`.

## Migration run log

Two failures on the first attempt, both mine, both corrected. Neither left any
partial state: the Supabase SQL editor runs a script as one transaction, so each
failure rolled the whole file back. Verified against the live database after the
first failure - `boutiques.email` still anon-readable, the inverted-MRP row still
present, the comma-blob occasion still approved. Clean re-runs.

1. **`0073` - `ERROR: P0001 taxonomy: approval is admin-managed`.** 0024 guards
   `taxonomy.status` changes behind `is_admin()`, and a SQL-editor session has no
   `auth.uid()`, so that is false whoever is typing. Only the status line trips
   it; the three renames do not touch a guarded column. Fixed by disabling that
   one trigger around the block and re-enabling after - with restoration left to
   Postgres's transactional DDL rather than an exception handler, so a failure
   mid-block puts the guard back automatically. A `pg_trigger` check was added to
   the verify block: `tgenabled` must read `'O'`.

2. **`0074` - `ERROR: 42704 unrecognized exception condition "format"`.**
   `RAISE EXCEPTION format('...', v_window)` is invalid: PL/pgSQL reads the first
   token after `EXCEPTION` as a condition name. `RAISE` carries its own format
   string, so it is `raise exception 'The %-day ...', v_window`. This is a
   COMPILE-time failure of the function, not a runtime one, which is why it took
   the whole migration down.

   Audited afterwards for the same and adjacent classes: no other
   `RAISE ... format(` anywhere in `supabase/migrations/`; all three `errcode`
   condition names valid; the only `%` in a RAISE literal is the intentional
   placeholder; `revoke`/`grant` signatures match both function signatures; and
   every `v_order.*` / `v_req.*` record field resolves to a column actually in
   its SELECT list - the runtime bug class that `0068a` exists to fix.

   Not compiled locally: there is no Postgres, `psql` or Docker on this machine.
   The above is line-by-line review, not execution.

## Needs you to run the migrations - 2

Neither `0073` nor `0074` is live until you run it in the Supabase SQL editor.
Both are idempotent. **Apply `0073` before `0074`.**

- **`0073_contact_lockdown_and_data_integrity.sql`** - contact-column revoke,
  `boutique_private()` extension, MRP check, taxonomy tidy, `updated_by` revoke.
- **`0074_returns.sql`** - the returns table and its two functions.

Also still unconfirmed from the original pass: **`0072`** (the payout/rating
lockdown). I could not verify it from outside then and still cannot.

## Needs your hand - 5

| # | Finding | What is needed |
|---|---|---|
| **C-3** | Maintenance mode is ON | One toggle in Platform Settings. Only you know whether it is intentional. |
| **H-4** | Test data live and "verified" | Purge or unpublish the test boutiques and the Rs 10 / Rs 19 / Rs 50 listings. Nine "verified" shops sharing one phone number is a judgement call about your own data, not a code change. |
| **H-6** | Shiprocket dormant | Set `platform_settings.shiprocket_enabled`, then register pickup locations. Run one real booking end to end before relying on it. |
| **H-8** | Company legal identity blank | `src/data/company.ts` needs your registered entity name, office address, CIN and GSTIN. I will not invent these. |
| **M-4** | Reviews/ratings never exercised | Needs real orders. Nothing to fix. |

## Deliberately not done - 2

- **H-7 - WhatsApp automation.** This is not a fix, it is building the feature in
  `WHATSAPP_AUTOMATION_PLAN.md` from scratch: Meta Cloud API onboarding, a
  business number migration, template approval, an outbox table and an Edge
  Function. It needs your Meta Business account and decisions I cannot make for
  you. Say the word and I will build it as its own piece of work.

- **m-1 - 758 hardcoded hex colours.** Left alone on purpose. My own assessment
  was that the practical impact is cosmetic - most are theme-invariant brand
  gradients, and the ~39 foreground uses are large icons that still clear the 3:1
  bar on dark. A mechanical sweep across 100+ files to fix a consistency issue
  with no user-visible symptom is a poor risk trade, and several instances
  (`BillReceipt`, the new email templates) are **correctly** literal because they
  render outside the theme. Worth doing as its own reviewed pass, not folded into
  a bug-fix batch.
